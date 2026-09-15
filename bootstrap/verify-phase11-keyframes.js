'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const keyframePath = path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js');
const plannerPath = path.join(upstream, 'utils', 'cartoon-shot-planner-v11.js');
const biblePath = path.join(upstream, 'utils', 'cartoon-bible-v11.js');
for (const target of [keyframePath, plannerPath, biblePath]) {
  if (!fs.existsSync(target)) throw new Error(`Phase 11 dependency is not materialized: ${target}`);
}

const {
  CARTOON_KEYFRAME_PIPELINE_VERSION,
  CARTOON_KEYFRAME_ROLES,
  CartoonKeyframePipelineV11,
  keyframePrompt,
  roleProgress
} = require(keyframePath);
const { CartoonShotPlannerV11 } = require(plannerPath);
const { CartoonBibleV11 } = require(biblePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const production = {
  id: 'prod_phase11_3',
  strategy: {
    topic: 'Luna the Little Star Learns to Share',
    videoInstructions: `Create an original animated-style children's video for ages 4 to 7.
Main character: Luna, a small smiling star.
Supporting characters: Milo, a shy little cloud; Tico, a cheerful bird.
Use bright colorful cartoon visuals with a soft 2D children's illustration style.`
  },
  script: { title: 'Luna the Little Star Learns to Share', mainContent: { sections: [] } }
};
const scenes = [
  {
    id: 'scene_luna_milo', position: 0, label: 'Luna notices Milo', duration: 12,
    scriptText: 'Luna floats through the bright sky. She notices Milo sitting alone. Luna moves closer and smiles gently.'
  },
  {
    id: 'scene_sharing', position: 1, label: 'Sharing', duration: 15,
    scriptText: 'Luna opens her basket. She shares a star cookie with Milo. Tico lands beside them and everyone smiles.'
  }
];
const logger = { info() {}, warn() {}, error() {} };
const bible = new CartoonBibleV11({ mode: 'auto', logger }).buildProductionBible(production);
const shotPlan = new CartoonShotPlannerV11({ minShots: 3, maxShots: 4, logger }).planProduction(production, scenes, bible);

class FakeDb {
  constructor() { this.frames = new Map(); }
  async replaceShotKeyframes(productionId, sceneId, shotId, keyframes) {
    for (const [id, frame] of [...this.frames.entries()]) {
      if (frame.productionId === productionId && frame.shotId === shotId) this.frames.delete(id);
    }
    for (const frame of keyframes) this.frames.set(frame.id, { ...frame, productionId, sceneId, shotId });
    return this.listShotKeyframes(productionId, shotId);
  }
  async listShotKeyframes(productionId, shotId = null) {
    return [...this.frames.values()]
      .filter(frame => frame.productionId === productionId && (!shotId || frame.shotId === shotId))
      .sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0) || Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0))
      .map(frame => ({ ...frame }));
  }
  async listSceneKeyframes(productionId, sceneId) {
    return [...this.frames.values()]
      .filter(frame => frame.productionId === productionId && frame.sceneId === sceneId)
      .sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0) || Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0))
      .map(frame => ({ ...frame }));
  }
  async getShotKeyframe(id) { return this.frames.has(id) ? { ...this.frames.get(id) } : null; }
  async updateShotKeyframe(id, changes) {
    const current = this.frames.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.frames.set(id, next);
    return { ...next };
  }
}

check('keyframe pipeline contract is version 11.3', () => assert.strictEqual(CARTOON_KEYFRAME_PIPELINE_VERSION, '11.3'));
check('default roles are exactly start middle end', () => assert.deepStrictEqual([...CARTOON_KEYFRAME_ROLES], ['start', 'middle', 'end']));
check('start progress is zero', () => assert.strictEqual(roleProgress('start'), 0));
check('middle progress is one half', () => assert.strictEqual(roleProgress('middle'), 0.5));
check('end progress is one', () => assert.strictEqual(roleProgress('end'), 1));
check('keyframe prompt declares the v11.3 contract', () => {
  const prompt = keyframePrompt(shotPlan.shots[0], 'middle', 'kf_previous');
  assert(prompt.includes('KEYFRAME PIPELINE V11.3:'));
  assert(prompt.includes('KEYFRAME ROLE: MIDDLE'));
});
check('keyframe prompt records a continuity reference id', () => assert(keyframePrompt(shotPlan.shots[0], 'end', 'kf_previous').includes('kf_previous')));
check('keyframe prompt explicitly documents Phase 11.4 image conditioning boundary', () => assert(keyframePrompt(shotPlan.shots[0], 'start').includes('Phase 11.4')));

const planningPipeline = new CartoonKeyframePipelineV11(new FakeDb(), null, { logger, maxKeyframes: 180, generationEnabled: false });
const plan = planningPipeline.planProduction(production, scenes, shotPlan.shots, bible);
check('production plan creates three keyframes per shot', () => assert.strictEqual(plan.keyframeCount, shotPlan.shotCount * 3));
check('production plan reports three keyframes per shot', () => assert.strictEqual(plan.keyframesPerShot, 3));
check('every shot plan contains exactly three frames', () => assert(plan.shots.every(item => item.keyframeCount === 3)));
check('each shot uses start middle end roles in order', () => assert(plan.shots.every(item => item.keyframes.map(frame => frame.keyframeRole).join(',') === 'start,middle,end')));
check('keyframe ids are stable hashed ids', () => assert(plan.keyframes.every(frame => /^kf_[a-f0-9]{24}$/.test(frame.id))));
check('all keyframe ids are unique', () => assert.strictEqual(new Set(plan.keyframes.map(frame => frame.id)).size, plan.keyframes.length));
check('middle references the start frame of the same shot', () => assert(plan.shots.every(item => item.keyframes[1].referenceKeyframeId === item.keyframes[0].id)));
check('end references the middle frame of the same shot', () => assert(plan.shots.every(item => item.keyframes[2].referenceKeyframeId === item.keyframes[1].id)));
check('next shot start references previous shot end within the scene', () => {
  const sceneShots = plan.shots.filter(item => item.sceneId === scenes[0].id);
  assert(sceneShots.length >= 2);
  assert.strictEqual(sceneShots[1].keyframes[0].referenceKeyframeId, sceneShots[0].keyframes[2].id);
});
check('first keyframe in a scene has no image continuity predecessor', () => {
  const first = plan.shots.find(item => item.sceneId === scenes[0].id).keyframes[0];
  assert.strictEqual(first.referenceKeyframeId, null);
});
check('keyframe plan fingerprints are stable', () => {
  const rebuilt = planningPipeline.planProduction(production, scenes, shotPlan.shots, bible);
  assert.strictEqual(rebuilt.fingerprint, plan.fingerprint);
});
check('keyframe ids are stable for identical input', () => {
  const rebuilt = planningPipeline.planProduction(production, scenes, shotPlan.shots, bible);
  assert.deepStrictEqual(rebuilt.keyframes.map(frame => frame.id), plan.keyframes.map(frame => frame.id));
});
check('changing a shot prompt invalidates its keyframe plan', () => {
  const changedShots = shotPlan.shots.map((shot, index) => index === 0 ? { ...shot, prompt: `${shot.prompt}\nNEW ACTION` } : shot);
  const changed = planningPipeline.planProduction(production, scenes, changedShots, bible);
  assert.notStrictEqual(changed.fingerprint, plan.fingerprint);
});
check('planner is inactive without Cartoon Bible', () => assert.strictEqual(planningPipeline.planProduction(production, scenes, shotPlan.shots, null), null));
check('runaway keyframe count fails closed', () => {
  const capped = new CartoonKeyframePipelineV11(new FakeDb(), null, { logger, maxKeyframes: 6, generationEnabled: false });
  assert.throws(() => capped.planProduction(production, scenes, shotPlan.shots, bible), error => error.code === 'CARTOON_KEYFRAME_LIMIT_EXCEEDED');
});

check('ensurePlan persists the deterministic plan', async () => {
  const db = new FakeDb();
  const pipeline = new CartoonKeyframePipelineV11(db, null, { logger, generationEnabled: false });
  const persisted = await pipeline.ensurePlan(production, scenes, shotPlan.shots, bible);
  assert.strictEqual((await db.listShotKeyframes(production.id)).length, persisted.keyframeCount);
});
check('ensurePlan reuses unchanged persisted keyframes', async () => {
  const db = new FakeDb();
  const pipeline = new CartoonKeyframePipelineV11(db, null, { logger, generationEnabled: false });
  await pipeline.ensurePlan(production, scenes, shotPlan.shots, bible);
  const first = await db.listShotKeyframes(production.id);
  first[0].status = 'ready';
  first[0].assetPath = 'already-ready.png';
  db.frames.set(first[0].id, first[0]);
  await pipeline.ensurePlan(production, scenes, shotPlan.shots, bible);
  assert.strictEqual((await db.getShotKeyframe(first[0].id)).status, 'ready');
});

check('generateScene creates missing keyframes sequentially and Resume skips ready frames', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-3-'));
  const db = new FakeDb();
  let calls = 0;
  const generator = {
    async generateVisualAssets(_prompt, style, count) {
      assert.strictEqual(style, 'kids_cartoon_2d');
      assert.strictEqual(count, 1);
      calls += 1;
      const asset = path.join(temp, `source_${calls}.png`);
      await fsp.writeFile(asset, Buffer.from(`frame-${calls}`));
      return [asset];
    }
  };
  const pipeline = new CartoonKeyframePipelineV11(db, generator, { logger, dataRoot: temp, generationEnabled: true });
  await pipeline.ensurePlan(production, scenes, shotPlan.shots, bible);
  const expected = (await db.listSceneKeyframes(production.id, scenes[0].id)).length;
  const result = await pipeline.generateScene(production.id, scenes[0].id);
  assert.strictEqual(calls, expected);
  assert.strictEqual(result.readyCount, expected);
  assert(result.representativeAssetPath && fs.existsSync(result.representativeAssetPath));
  const firstPass = calls;
  await pipeline.generateScene(production.id, scenes[0].id);
  assert.strictEqual(calls, firstPass, 'Resume must not regenerate ready keyframes');
  await fsp.rm(temp, { recursive: true, force: true });
});

check('partial generation failure persists completed frames and failed frame for granular Resume', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-3-fail-'));
  const db = new FakeDb();
  let calls = 0;
  const generator = {
    async generateVisualAssets() {
      calls += 1;
      if (calls === 2) throw new Error('synthetic provider failure');
      const asset = path.join(temp, `source_${calls}.png`);
      await fsp.writeFile(asset, Buffer.from(`frame-${calls}`));
      return [asset];
    }
  };
  const oneShot = shotPlan.shots.filter(shot => shot.sceneId === scenes[0].id).slice(0, 1);
  const pipeline = new CartoonKeyframePipelineV11(db, generator, { logger, dataRoot: temp, generationEnabled: true });
  await pipeline.ensurePlan(production, scenes.slice(0, 1), oneShot, bible);
  await assert.rejects(() => pipeline.generateScene(production.id, scenes[0].id), /Phase 11.3 keyframe/);
  const frames = await db.listSceneKeyframes(production.id, scenes[0].id);
  assert.strictEqual(frames[0].status, 'ready');
  assert.strictEqual(frames[1].status, 'failed');
  assert.strictEqual(frames[2].status, 'planned');
  await fsp.rm(temp, { recursive: true, force: true });
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns persistent shot_keyframes', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS shot_keyframes')));
check('database replaces keyframes per changed shot', () => assert(dbSource.includes('async replaceShotKeyframes(productionId, sceneId, shotId, keyframes = [])')));
check('database exposes per-scene keyframes', () => assert(dbSource.includes('async listSceneKeyframes(productionId, sceneId)')));
check('database can update one keyframe without replacing siblings', () => assert(dbSource.includes('async updateShotKeyframe(id, changes = {})')));
check('changed shot plans delete stale keyframes before replacing shots', () => assert(dbSource.includes("DELETE FROM shot_keyframes WHERE production_id = ? AND scene_id = ?")));
check('production bundle exposes keyframes', () => assert(dbSource.includes('const keyframes = await this.listShotKeyframes(productionId);')));
check('scene pipeline imports Phase 11.3 runtime', () => assert(pipelineSource.includes("const { CartoonKeyframePipelineV11 } = require('./cartoon-keyframe-pipeline-v11');")));
check('scene pipeline constructs Phase 11.3 runtime', () => assert(pipelineSource.includes('this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11')));
check('scene pipeline plans keyframes from persisted shots', () => assert(pipelineSource.includes('await this.keyframePipeline.ensurePlan(production, scenes, shotPlan.shots, cartoonBible)')));
check('incomplete keyframes make a cartoon visual stale for Resume', () => assert(pipelineSource.includes("status: 'visual_stale'")));
check('cartoon visual generation calls generateScene keyframes', () => assert(pipelineSource.includes('await this.keyframePipeline.generateScene(productionId, sceneId)')));
check('scene compatibility asset is marked generated-keyframes', () => assert(pipelineSource.includes("assetOrigin: keyframeResult ? 'generated-keyframes'")));
check('scene compatibility asset records keyframe pipeline provider', () => assert(pipelineSource.includes("provider: keyframeResult ? 'keyframe-pipeline-v11'")));
check('manifest records keyframe version fingerprint and count', () => {
  assert(pipelineSource.includes('keyframePipelineVersion: keyframePlan?.version'));
  assert(pipelineSource.includes('keyframePlanFingerprint: keyframePlan?.fingerprint'));
  assert(pipelineSource.includes('keyframeCount: keyframePlan?.keyframeCount'));
});
check('media summary exposes keyframe assets separately from scene visualAssets', () => assert(pipelineSource.includes('keyframeAssets: (bundle.keyframes || [])')));
check('Review Studio renders Phase 11.3 keyframe status', () => assert(dashboardSource.includes('function renderCartoonKeyframes(item)')));
check('Review Studio exposes start middle end contract', () => assert(dashboardSource.includes('Start → Middle → End')));
check('environment enables keyframe generation by default', () => assert(envSource.includes('CARTOON_KEYFRAME_GENERATION_ENABLED=true')));
check('environment has a finite production frame cap', () => assert(envSource.includes('CARTOON_KEYFRAME_MAX_PER_PRODUCTION=180')));
check('package exposes Phase 11.3 regression command', () => assert.strictEqual(pkg.scripts['test:keyframes'], 'node ../bootstrap/verify-phase11-keyframes.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.3 Keyframe Pipeline OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
