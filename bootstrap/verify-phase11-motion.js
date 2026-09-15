'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cartoon-motion-composer-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.5 runtime is not materialized: utils/cartoon-motion-composer-v11.js');

const {
  CARTOON_MOTION_COMPOSER_VERSION,
  CartoonMotionComposerV11,
  profileForShot,
  splitShotDuration,
  motionFilter
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const logger = { info() {}, warn() {}, error() {} };

class FakeDb {
  constructor(scenes, shots, keyframes) {
    this.scenes = scenes.map(item => ({ ...item }));
    this.shots = shots.map(item => ({ ...item }));
    this.keyframes = keyframes.map(item => ({ ...item }));
    this.segments = new Map();
    this.motionScenes = new Map();
  }
  async listProductionScenes() { return this.scenes.map(item => ({ ...item })); }
  async listSceneShots(_productionId, sceneId = null) {
    return this.shots.filter(item => !sceneId || item.sceneId === sceneId).map(item => ({ ...item }));
  }
  async listShotKeyframes(_productionId, shotId = null) {
    return this.keyframes.filter(item => !shotId || item.shotId === shotId).map(item => ({ ...item }));
  }
  async getCartoonMotionSegment(productionId, shotId) {
    const value = this.segments.get(`${productionId}:${shotId}`);
    return value ? { ...value } : null;
  }
  async saveCartoonMotionSegment(input) {
    const key = `${input.productionId}:${input.shotId}`;
    const current = this.segments.get(key) || {};
    const value = { id: current.id || `segment_${this.segments.size + 1}`, ...current, ...input };
    this.segments.set(key, value);
    return { ...value };
  }
  async listCartoonMotionSegments(productionId) {
    return [...this.segments.values()].filter(item => item.productionId === productionId).map(item => ({ ...item }));
  }
  async getCartoonMotionScene(productionId, sceneId) {
    const value = this.motionScenes.get(`${productionId}:${sceneId}`);
    return value ? { ...value } : null;
  }
  async saveCartoonMotionScene(input) {
    const key = `${input.productionId}:${input.sceneId}`;
    const current = this.motionScenes.get(key) || {};
    const value = { id: current.id || `motion_scene_${this.motionScenes.size + 1}`, ...current, ...input };
    this.motionScenes.set(key, value);
    return { ...value };
  }
  async listCartoonMotionScenes(productionId) {
    return [...this.motionScenes.values()].filter(item => item.productionId === productionId).map(item => ({ ...item }));
  }
}

check('motion composer contract is version 11.5', () => assert.strictEqual(CARTOON_MOTION_COMPOSER_VERSION, '11.5'));
check('wide shots receive lateral motion', () => assert(['drift_left', 'drift_right'].includes(profileForShot({ shotType: 'wide', shotIndex: 0 }))));
check('close ups receive a gentle push', () => assert.strictEqual(profileForShot({ shotType: 'close_up', shotIndex: 0 }), 'gentle_push'));
check('ending shots receive a gentle pull', () => assert.strictEqual(profileForShot({ shotType: 'ending', shotIndex: 0 }), 'gentle_pull'));
check('action shots alternate lateral direction', () => assert.notStrictEqual(profileForShot({ shotType: 'action', shotIndex: 0 }), profileForShot({ shotType: 'action', shotIndex: 1 })));
check('duration split preserves exact shot duration after two overlaps', () => {
  const timing = splitShotDuration(6, 0.16);
  assert(Math.abs((timing.clipDuration * 3) - (timing.transition * 2) - timing.total) < 0.01);
});
check('transition is bounded for short shots', () => assert(splitShotDuration(0.8, 0.5).transition <= 0.0961));
check('motion filter uses zoompan', () => assert(motionFilter('gentle_push', 90).includes('zoompan=')));
check('motion filter fixes output size', () => assert(motionFilter('gentle_push', 90, 1280, 720).includes('s=1280x720')));
check('motion filter records requested fps', () => assert(motionFilter('gentle_push', 90, 1280, 720, 30).includes('fps=30')));
check('lateral motion has an x-axis expression', () => assert(motionFilter('drift_right', 90).includes("x='(iw-iw/zoom)*on/")));

check('composer renders and persists motion segments plus scene output', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-5-'));
  const productionId = 'prod_motion_test';
  const scene = { id: 'scene_a', position: 0, duration: 8 };
  const shots = [
    { id: 'shot_a', sceneId: scene.id, shotIndex: 0, shotType: 'wide', duration: 4, fingerprint: 'shot-fp-a' },
    { id: 'shot_b', sceneId: scene.id, shotIndex: 1, shotType: 'close_up', duration: 4, fingerprint: 'shot-fp-b' }
  ];
  const keyframes = [];
  for (const shot of shots) {
    for (const [index, role] of ['start', 'middle', 'end'].entries()) {
      const asset = path.join(temp, `${shot.id}_${role}.png`);
      await fsp.writeFile(asset, Buffer.from(`${shot.id}-${role}-v1`));
      keyframes.push({ id: `kf_${shot.id}_${role}`, productionId, sceneId: scene.id, shotId: shot.id, shotIndex: shot.shotIndex, keyframeIndex: index, keyframeRole: role, status: 'ready', assetPath: asset, fingerprint: `${shot.id}-${role}` });
    }
  }
  const db = new FakeDb([scene], shots, keyframes);
  let ffmpegCalls = 0;
  const fakeRunFFmpeg = async args => {
    ffmpegCalls += 1;
    const output = args.at(-1);
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await fsp.writeFile(output, Buffer.from(`video-${ffmpegCalls}`));
    return { stdout: '', stderr: '' };
  };
  const composer = new CartoonMotionComposerV11(db, { logger, dataRoot: temp, runFFmpeg: fakeRunFFmpeg, checkFFmpeg: async () => true, fps: 30, transitionSeconds: 0.16 });
  const result = await composer.composeProduction(productionId);
  assert.strictEqual(result.sceneCount, 1);
  assert.strictEqual(result.segmentCount, 2);
  assert.strictEqual((await db.listCartoonMotionSegments(productionId)).filter(item => item.status === 'ready').length, 2);
  assert.strictEqual((await db.listCartoonMotionScenes(productionId)).filter(item => item.status === 'ready').length, 1);
  assert(result.scenes[0].outputPath && fs.existsSync(result.scenes[0].outputPath));
  assert(ffmpegCalls >= 9, 'two shots require keyframe clips, shot composition, and scene composition');
  const firstCalls = ffmpegCalls;
  const resumed = await composer.composeProduction(productionId);
  assert.strictEqual(resumed.segmentCount, 2);
  assert.strictEqual(ffmpegCalls, firstCalls, 'Resume must reuse matching motion outputs');

  await fsp.writeFile(keyframes[0].assetPath, Buffer.from('changed-keyframe-content'));
  await composer.composeProduction(productionId);
  assert(ffmpegCalls > firstCalls, 'changed keyframe bytes must invalidate the affected motion fingerprint');
  await fsp.rm(temp, { recursive: true, force: true });
});

check('composer blocks a shot with incomplete keyframes', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-5-missing-'));
  const productionId = 'prod_missing';
  const scene = { id: 'scene_missing', position: 0, duration: 3 };
  const shot = { id: 'shot_missing', sceneId: scene.id, shotIndex: 0, shotType: 'medium', duration: 3, fingerprint: 'fp' };
  const asset = path.join(temp, 'only.png');
  await fsp.writeFile(asset, 'one');
  const db = new FakeDb([scene], [shot], [{ id: 'kf_only', productionId, sceneId: scene.id, shotId: shot.id, shotIndex: 0, keyframeIndex: 0, keyframeRole: 'start', status: 'ready', assetPath: asset }]);
  const composer = new CartoonMotionComposerV11(db, { logger, dataRoot: temp, runFFmpeg: async () => {}, checkFFmpeg: async () => true });
  await assert.rejects(() => composer.composeProduction(productionId), error => error.code === 'CARTOON_MOTION_KEYFRAMES_INCOMPLETE');
  await fsp.rm(temp, { recursive: true, force: true });
});

check('composer blocks a non-ready continuity keyframe', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-5-status-'));
  const productionId = 'prod_status';
  const scene = { id: 'scene_status', position: 0, duration: 3 };
  const shot = { id: 'shot_status', sceneId: scene.id, shotIndex: 0, shotType: 'medium', duration: 3, fingerprint: 'fp' };
  const frames = [];
  for (const [index, role] of ['start', 'middle', 'end'].entries()) {
    const asset = path.join(temp, `${role}.png`);
    await fsp.writeFile(asset, role);
    frames.push({ id: `kf_${role}`, productionId, sceneId: scene.id, shotId: shot.id, shotIndex: 0, keyframeIndex: index, keyframeRole: role, status: role === 'middle' ? 'continuity_failed' : 'ready', assetPath: asset });
  }
  const db = new FakeDb([scene], [shot], frames);
  const composer = new CartoonMotionComposerV11(db, { logger, dataRoot: temp, runFFmpeg: async () => {}, checkFFmpeg: async () => true });
  await assert.rejects(() => composer.composeProduction(productionId), error => error.code === 'CARTOON_MOTION_KEYFRAME_NOT_READY');
  await fsp.rm(temp, { recursive: true, force: true });
});

check('disabled composer performs no rendering', async () => {
  const composer = new CartoonMotionComposerV11(new FakeDb([], [], []), { logger, enabled: false, checkFFmpeg: async () => { throw new Error('must not run'); } });
  const result = await composer.composeProduction('prod_disabled');
  assert.strictEqual(result.enabled, false);
});

check('missing FFmpeg fails with a dedicated code', async () => {
  const composer = new CartoonMotionComposerV11(new FakeDb([], [], []), { logger, enabled: true, checkFFmpeg: async () => false, ffmpegInstallHint: () => 'install ffmpeg' });
  await assert.rejects(() => composer.composeProduction('prod_no_ffmpeg'), error => error.code === 'CARTOON_MOTION_FFMPEG_UNAVAILABLE');
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns cartoon_motion_segments', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cartoon_motion_segments')));
check('database owns cartoon_motion_scenes', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cartoon_motion_scenes')));
check('database can save one motion segment', () => assert(dbSource.includes('async saveCartoonMotionSegment(input = {})')));
check('database can save one scene motion composition', () => assert(dbSource.includes('async saveCartoonMotionScene(input = {})')));
check('production bundle exposes motion segments', () => assert(dbSource.includes('const motionSegments = await this.listCartoonMotionSegments(productionId);')));
check('production bundle exposes motion scenes', () => assert(dbSource.includes('const motionScenes = await this.listCartoonMotionScenes(productionId);')));
check('keyframe plan changes invalidate shot motion', () => assert(dbSource.includes("DELETE FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?")));
check('keyframe changes invalidate scene motion', () => assert(dbSource.includes("DELETE FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?")));
check('scene pipeline imports Phase 11.5 composer', () => assert(pipelineSource.includes("const { CartoonMotionComposerV11 } = require('./cartoon-motion-composer-v11');")));
check('scene pipeline constructs Phase 11.5 composer', () => assert(pipelineSource.includes('this.motionComposer = options.motionComposer || new CartoonMotionComposerV11')));
check('scene pipeline composes cartoon production after keyframes', () => assert(pipelineSource.includes('await this.motionComposer.composeProduction(production.id)')));
check('scene motion becomes the actual scene video asset', () => assert(pipelineSource.includes("assetOrigin: 'generated-motion'")));
check('scene motion records local FFmpeg provider', () => assert(pipelineSource.includes("provider: 'cartoon-motion-v11'")));
check('media summary exposes motion assets', () => assert(pipelineSource.includes('motionAssets: (bundle.motionScenes || [])')));
check('Review Studio renders the motion panel', () => assert(dashboardSource.includes('function renderCartoonMotion(item)')));
check('Review Studio describes motion honestly as local FFmpeg', () => assert(dashboardSource.includes('not AI optical-flow character animation')));
check('environment enables motion by default', () => assert(envSource.includes('CARTOON_MOTION_ENABLED=true')));
check('environment defaults to 30 fps', () => assert(envSource.includes('CARTOON_MOTION_FPS=30')));
check('environment defaults to 1280x720', () => assert(envSource.includes('CARTOON_MOTION_WIDTH=1280') && envSource.includes('CARTOON_MOTION_HEIGHT=720')));
check('package exposes Phase 11.5 regression command', () => assert.strictEqual(pkg.scripts['test:motion'], 'node ../bootstrap/verify-phase11-motion.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.5 Motion Composer OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
