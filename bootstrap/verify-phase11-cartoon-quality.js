'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cartoon-quality-gate-v11.js');
const qualityAgentsPath = path.join(upstream, 'utils', 'quality-agents-v9.js');
for (const target of [runtimePath, qualityAgentsPath]) {
  if (!fs.existsSync(target)) throw new Error(`Phase 11.6 dependency is not materialized: ${target}`);
}

const {
  CARTOON_QUALITY_GATE_VERSION,
  CARTOON_QUALITY_KEYFRAME_ROLES,
  evaluateCartoonQualityV11,
  latestContinuityByKeyframe,
  fileDigest,
  isCartoonProduction
} = require(runtimePath);
const { QualityAgentsV9, visualAgent } = require(qualityAgentsPath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

async function writeAsset(dir, name, content) {
  const target = path.join(dir, name);
  await fsp.writeFile(target, Buffer.from(content));
  return target;
}

async function goodCartoon(temp) {
  const sceneId = 'scene_cartoon_1';
  const sceneMotion = await writeAsset(temp, 'scene_motion.mp4', 'scene-motion-v1');
  const production = {
    id: 'prod_phase11_6',
    strategy: {
      topic: 'Luna learns to share',
      requestedStyle: 'kids_cartoon_2d',
      evidencePack: { sources: [] }
    },
    script: {
      title: 'Luna Learns to Share',
      hook: { text: 'Luna has one bright basket and three friends who want to play. What will she do?' },
      introduction: { topicIntro: 'A gentle story about sharing.', valueProposition: 'Watch Luna solve a small friendship problem.' },
      mainContent: { sections: [{ title: 'Sharing', content: ['Luna sees Milo and Tico and decides to share her star cookies.'], duration: 12 }] },
      conclusion: { recap: ['Luna learns that sharing can make playtime happier.'], finalThought: 'Kind choices help friends feel included.' },
      callToAction: { text: 'Tell us one kind thing you like to share.' },
      claims: []
    },
    seo: {
      title: 'Luna Learns to Share With Friends',
      description: 'A gentle original cartoon story for young children about sharing, kindness, and friendship through Luna, Milo, and Tico.',
      tags: ['sharing', 'friendship', 'kids story', 'cartoon', 'kindness']
    },
    thumbnail: { path: 'thumbnail.png', concept: { subject: 'Luna smiling with friends', composition: 'three friendly characters together' } },
    assets: {
      thumbnail: { path: 'thumbnail.png' },
      finalVideo: { path: path.join(temp, 'final.mp4'), simulated: false },
      sceneManifest: {
        visualBriefs: {
          [sceneId]: { visualType: 'kids_cartoon_2d', quality: { accepted: true, specificity: 92, genericAiRisk: 8 } }
        }
      }
    },
    cartoonBible: {
      version: '11.1',
      mode: 'kids_cartoon_2d',
      fingerprint: 'bible_fp',
      characters: [
        { id: 'luna', name: 'Luna', role: 'main' },
        { id: 'milo', name: 'Milo', role: 'supporting' }
      ]
    },
    scenes: [{
      id: sceneId,
      position: 0,
      label: 'Sharing',
      duration: 12,
      revision: 1,
      status: 'ready',
      narrationStatus: 'current',
      assetType: 'video',
      assetOrigin: 'generated-motion',
      assetPath: sceneMotion,
      provider: 'cartoon-motion-v11',
      rightsConfirmed: true
    }],
    shots: [],
    keyframes: [],
    continuityChecks: [],
    motionSegments: [],
    motionScenes: [{
      id: 'motion_scene_1',
      productionId: 'prod_phase11_6',
      sceneId,
      version: '11.5',
      fingerprint: 'motion_scene_fp',
      duration: 12,
      segmentIds: [],
      outputPath: sceneMotion,
      status: 'ready'
    }],
    provenance: { status: 'verified', summary: { claimCount: 0, resolvedClaims: 0, unresolvedClaims: 0, verifiedSources: 0 } }
  };

  let previousId = null;
  const durations = [4, 4, 4];
  for (let shotIndex = 0; shotIndex < 3; shotIndex += 1) {
    const shotId = `shot_${shotIndex}`;
    const shot = {
      id: shotId,
      sceneId,
      shotIndex,
      shotCount: 3,
      shotType: shotIndex === 0 ? 'wide' : shotIndex === 2 ? 'ending' : 'medium',
      duration: durations[shotIndex],
      storyBeat: shotIndex === 0 ? 'Luna notices her friends.' : shotIndex === 1 ? 'Luna shares a star cookie.' : 'Everyone smiles together.',
      action: shotIndex === 0 ? 'Visually show Luna noticing her friends.' : shotIndex === 1 ? 'Visually show Luna sharing a star cookie.' : 'Visually show the friends smiling together.',
      fingerprint: `shot_fp_${shotIndex}`,
      status: 'planned'
    };
    shot.prompt = [
      'SHOT PLAN V11.2:',
      `SHOT: ${shotIndex + 1}/3`,
      'ACTION: one concrete child-safe action',
      'CHARACTERS: Luna and friends with fixed Character Bible identity',
      'CAMERA: readable child-eye-level composition',
      'CONTINUITY: preserve palette, costume, props, and scene geography'
    ].join('\n');
    production.shots.push(shot);

    const segmentPath = await writeAsset(temp, `motion_${shotIndex}.mp4`, `motion-${shotIndex}`);
    production.motionSegments.push({
      id: `motion_${shotIndex}`,
      productionId: production.id,
      sceneId,
      shotId,
      version: '11.5',
      shotIndex,
      fingerprint: `motion_fp_${shotIndex}`,
      duration: durations[shotIndex],
      profile: 'gentle_push',
      keyframeIds: [],
      outputPath: segmentPath,
      status: 'ready'
    });

    for (let keyframeIndex = 0; keyframeIndex < 3; keyframeIndex += 1) {
      const role = CARTOON_QUALITY_KEYFRAME_ROLES[keyframeIndex];
      const id = `kf_${shotIndex}_${role}`;
      const assetPath = await writeAsset(temp, `${id}.png`, `unique-frame-${shotIndex}-${role}`);
      const frame = {
        id,
        productionId: production.id,
        sceneId,
        shotId,
        shotIndex,
        keyframeIndex,
        keyframeRole: role,
        fingerprint: `frame_fp_${shotIndex}_${role}`,
        status: 'ready',
        assetPath,
        generatedAt: '2026-09-15T04:00:00.000Z',
        referenceKeyframeId: previousId,
        prompt: `KEYFRAME PIPELINE V11.3:\nKEYFRAME ROLE: ${role.toUpperCase()}\nACTION: progress the planned shot`
      };
      production.keyframes.push(frame);
      production.motionSegments.at(-1).keyframeIds.push(id);
      if (previousId) {
        production.continuityChecks.push({
          id: `check_${id}`,
          productionId: production.id,
          sceneId,
          shotId,
          keyframeId: id,
          keyframe_id: id,
          referenceKeyframeId: previousId,
          attempt: 0,
          score: 0.84,
          threshold: 0.48,
          status: 'accepted',
          metrics: { compositionGrid: 0.81, palette: 0.82, perceptualHash: 0.80 },
          referenceConditioned: true,
          createdAt: '2026-09-15T04:00:01.000Z'
        });
      }
      previousId = id;
    }
  }

  production.motionScenes[0].segmentIds = production.motionSegments.map(item => item.id);
  return production;
}

check('Phase 11.6 contract version is 11.6', () => assert.strictEqual(CARTOON_QUALITY_GATE_VERSION, '11.6'));
check('Phase 11.6 keyframe roles are start middle end', () => assert.deepStrictEqual([...CARTOON_QUALITY_KEYFRAME_ROLES], ['start', 'middle', 'end']));
check('non-cartoon production is not applicable', () => {
  const result = evaluateCartoonQualityV11({ id: 'non_cartoon' });
  assert.strictEqual(result.active, false);
  assert.strictEqual(result.status, 'not_applicable');
  assert.strictEqual(result.passed, true);
});
check('cartoon detector requires kids_cartoon_2d bible mode', () => {
  assert.strictEqual(isCartoonProduction({ cartoonBible: { mode: 'kids_cartoon_2d' } }), true);
  assert.strictEqual(isCartoonProduction({ cartoonBible: { mode: 'documentary' } }), false);
});
check('latest continuity uses the highest repair attempt', () => {
  const map = latestContinuityByKeyframe([
    { keyframeId: 'a', attempt: 0, status: 'repair_needed' },
    { keyframeId: 'a', attempt: 1, status: 'accepted' }
  ]);
  assert.strictEqual(map.get('a').status, 'accepted');
});
check('fileDigest changes when file bytes change', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-digest-'));
  const target = await writeAsset(dir, 'asset.bin', 'one');
  const first = fileDigest(target);
  await fsp.writeFile(target, Buffer.from('two'));
  const second = fileDigest(target);
  assert(first && second && first !== second);
  await fsp.rm(dir, { recursive: true, force: true });
});

check('healthy cartoon passes the Phase 11.6 gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-good-'));
  const item = await goodCartoon(dir);
  const result = evaluateCartoonQualityV11(item);
  assert.strictEqual(result.active, true);
  assert.strictEqual(result.passed, true);
  assert.notStrictEqual(result.status, 'blocked');
  assert.strictEqual(result.blockers.length, 0);
  assert.strictEqual(result.metrics.sceneCount, 1);
  assert.strictEqual(result.metrics.shotCount, 3);
  assert.strictEqual(result.metrics.keyframeCount, 9);
  assert.strictEqual(result.metrics.motionSegmentCount, 3);
  assert.strictEqual(result.metrics.motionSceneCount, 1);
  assert(result.metrics.averageContinuityScore >= 0.8);
  await fsp.rm(dir, { recursive: true, force: true });
});

check('quality fingerprint changes when keyframe bytes change at the same path', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-fp-'));
  const item = await goodCartoon(dir);
  const first = evaluateCartoonQualityV11(item).fingerprint;
  await fsp.writeFile(item.keyframes[1].assetPath, Buffer.from('changed-frame-bytes'));
  const second = evaluateCartoonQualityV11(item).fingerprint;
  assert.notStrictEqual(first, second);
  await fsp.rm(dir, { recursive: true, force: true });
});

check('too few shots blocks cartoon quality', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-shots-'));
  const item = await goodCartoon(dir);
  item.shots = item.shots.slice(0, 2);
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_shot_count' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('missing keyframe role blocks the gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-role-'));
  const item = await goodCartoon(dir);
  item.keyframes = item.keyframes.filter(frame => !(frame.shotId === 'shot_1' && frame.keyframeRole === 'middle'));
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_keyframe_contract' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('missing keyframe file blocks the gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-file-'));
  const item = await goodCartoon(dir);
  await fsp.unlink(item.keyframes[2].assetPath);
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_keyframe_not_ready' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('missing continuity decision blocks the gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-cont-missing-'));
  const item = await goodCartoon(dir);
  const target = item.keyframes.find(frame => frame.referenceKeyframeId);
  item.continuityChecks = item.continuityChecks.filter(check => (check.keyframeId || check.keyframe_id) !== target.id);
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_continuity_missing' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('rejected continuity blocks the gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-cont-reject-'));
  const item = await goodCartoon(dir);
  item.continuityChecks[0].status = 'repair_needed';
  item.continuityChecks[0].score = 0.2;
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_continuity_rejected' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('missing motion segment blocks the gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-motion-seg-'));
  const item = await goodCartoon(dir);
  await fsp.unlink(item.motionSegments[0].outputPath);
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_motion_segment_missing' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('missing scene motion composition blocks the gate', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-motion-scene-'));
  const item = await goodCartoon(dir);
  item.motionScenes[0].status = 'failed';
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_motion_scene_missing' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('scene must be bound to generated motion instead of a slideshow image', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-binding-'));
  const item = await goodCartoon(dir);
  item.scenes[0].assetType = 'image';
  item.scenes[0].provider = 'image-provider';
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_scene_not_motion_bound' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('byte-identical start middle end blocks a static shot', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-static-'));
  const item = await goodCartoon(dir);
  const frames = item.keyframes.filter(frame => frame.shotId === 'shot_0');
  for (const frame of frames) await fsp.writeFile(frame.assetPath, Buffer.from('same-static-frame'));
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_static_shot' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('high generic AI risk blocks cartoon quality', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-generic-'));
  const item = await goodCartoon(dir);
  item.assets.sceneManifest.visualBriefs.scene_cartoon_1.quality.genericAiRisk = 82;
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_generic_visual_risk' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('high-risk child-directed story term requires manual review', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-safe-'));
  const item = await goodCartoon(dir);
  item.shots[1].storyBeat = 'A gun appears in the playroom.';
  const result = evaluateCartoonQualityV11(item);
  assert(result.findings.some(entry => entry.id === 'cartoon_child_safety_lexical' && entry.blocking));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('Visual Quality Agent absorbs Phase 11.6 blockers without adding a sixth Phase 9 weight', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-visual-'));
  const item = await goodCartoon(dir);
  item.motionSegments[0].status = 'failed';
  const visual = visualAgent(item);
  assert.strictEqual(visual.id, 'visual');
  assert.strictEqual(visual.passed, false);
  assert(visual.cartoonQuality && visual.cartoonQuality.active);
  assert(visual.findings.some(entry => entry.id === 'cartoon_motion_segment_missing'));
  await fsp.rm(dir, { recursive: true, force: true });
});

check('Quality Agents still return exactly five categories and persist Phase 11.6 separately', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase11-6-review-'));
  const item = await goodCartoon(dir);
  let savedCartoon = null;
  let savedQuality = null;
  const db = {
    async saveCartoonQualityReport(report) { savedCartoon = report; return report; },
    async saveQualityAgentReport(report) { savedQuality = report; return report; }
  };
  const service = new QualityAgentsV9(db, { logger: { info() {}, warn() {}, error() {} } });
  const report = await service.review(item);
  assert.strictEqual(report.agents.length, 5);
  assert(report.cartoonQuality && report.cartoonQuality.active);
  assert(savedCartoon && savedCartoon.version === '11.6');
  assert(savedQuality && savedQuality.fingerprint === report.fingerprint);
  await fsp.rm(dir, { recursive: true, force: true });
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const qualitySource = fs.readFileSync(path.join(upstream, 'utils', 'quality-agents-v9.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('SQLite persists cartoon quality reports', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS cartoon_quality_reports')));
check('SQLite exposes saveCartoonQualityReport', () => assert(dbSource.includes('async saveCartoonQualityReport(report = {})')));
check('production bundle exposes cartoonQualityReport', () => assert(dbSource.includes('cartoonQualityReport = await this.getLatestCartoonQualityReport(productionId)')));
check('Phase 9 imports the Phase 11.6 evaluator', () => assert(qualitySource.includes("const { evaluateCartoonQualityV11 } = require('./cartoon-quality-gate-v11');")));
check('Phase 9 visual agent evaluates cartoon quality', () => assert(qualitySource.includes('const cartoonQuality = evaluateCartoonQualityV11(production);')));
check('Phase 9 fingerprint includes cartoon byte-sensitive quality fingerprint', () => assert(qualitySource.includes('cartoonQualityFingerprint: evaluateCartoonQualityV11(production).fingerprint')));
check('Phase 9 persists the dedicated cartoon quality report', () => assert(qualitySource.includes('saveCartoonQualityReport')));
check('Review Studio renders Cartoon Quality Gate v11.6', () => assert(dashboardSource.includes('CARTOON QUALITY GATE V11.6')));
check('Review Studio uses persisted or embedded cartoon quality report', () => assert(dashboardSource.includes('item.cartoonQualityReport || item.qualityAgentReport?.cartoonQuality')));
check('package exposes Phase 11.6 regression command', () => assert.strictEqual(pkg.scripts['test:cartoon-quality'], 'node ../bootstrap/verify-phase11-cartoon-quality.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.6 Cartoon Quality Gate OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
