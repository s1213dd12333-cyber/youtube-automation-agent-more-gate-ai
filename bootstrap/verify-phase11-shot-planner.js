'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const plannerPath = path.join(upstream, 'utils', 'cartoon-shot-planner-v11.js');
const biblePath = path.join(upstream, 'utils', 'cartoon-bible-v11.js');
if (!fs.existsSync(plannerPath)) throw new Error('Phase 11.2 service is not materialized: utils/cartoon-shot-planner-v11.js');
if (!fs.existsSync(biblePath)) throw new Error('Phase 11.1 dependency is not materialized: utils/cartoon-bible-v11.js');

const {
  CARTOON_SHOT_PLANNER_VERSION,
  CartoonShotPlannerV11,
  splitBeats,
  desiredShotCount,
  shotSequence
} = require(plannerPath);
const { CartoonBibleV11 } = require(biblePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const production = {
  id: 'prod_phase11_2',
  strategy: {
    topic: 'Luna the Little Star Learns to Share',
    videoInstructions: `Create an original animated-style children's video for ages 4 to 7.
Main character: Luna, a small smiling star.
Supporting characters: Milo, a shy little cloud; Tico, a cheerful bird.
Use bright colorful cartoon visuals with a soft 2D children's illustration style.`
  },
  script: {
    title: 'Luna the Little Star Learns to Share',
    mainContent: { sections: [] }
  }
};

const bible = new CartoonBibleV11({ mode: 'auto', logger: { info() {}, warn() {}, error() {} } }).buildProductionBible(production);
const planner = new CartoonShotPlannerV11({ minShots: 3, maxShots: 6, logger: { info() {}, warn() {}, error() {} } });
const sceneA = {
  id: 'scene_luna_milo', position: 0, label: 'Luna notices Milo', duration: 18,
  scriptText: 'Luna floats through the bright sky and notices Milo sitting alone. Luna moves closer and asks why he looks sad. Milo looks up, and Luna smiles gently.'
};
const sceneB = {
  id: 'scene_sharing', position: 1, label: 'Sharing makes room for friendship', duration: 26,
  scriptText: 'Luna opens her basket. She shares a star cookie with Milo. Tico swoops in and lands beside them. Milo smiles. The three friends laugh together and wave at the glowing sky.'
};

check('shot planner contract is version 11.2', () => assert.strictEqual(CARTOON_SHOT_PLANNER_VERSION, '11.2'));
check('beat splitter extracts multiple visual beats', () => assert(splitBeats(sceneA.scriptText).length >= 3));
check('18-second scene plans five shots by default', () => assert.strictEqual(desiredShotCount(sceneA, 3, 6), 5));
check('long scene is capped at six shots', () => assert.strictEqual(desiredShotCount(sceneB, 3, 6), 6));
check('six-shot sequence establishes and resolves the scene', () => {
  const sequence = shotSequence(6);
  assert.strictEqual(sequence[0], 'wide');
  assert.strictEqual(sequence[sequence.length - 1], 'ending');
});

const planA = planner.planScene(production, sceneA, bible);
const planB = planner.planScene(production, sceneB, bible);

check('scene plan stays inside the configured 3-6 shot range', () => assert(planA.shotCount >= 3 && planA.shotCount <= 6));
check('every shot has a stable id', () => assert(planA.shots.every(shot => /^shot_[a-f0-9]{22}$/.test(shot.id))));
check('shot ids are unique inside a scene', () => assert.strictEqual(new Set(planA.shots.map(shot => shot.id)).size, planA.shots.length));
check('shot types vary instead of repeating one generic framing', () => assert(new Set(planA.shots.map(shot => shot.shotType)).size >= 3));
check('every shot has a concrete story beat', () => assert(planA.shots.every(shot => shot.storyBeat && shot.storyBeat.length > 5)));
check('every shot has a visual action', () => assert(planA.shots.every(shot => shot.action.startsWith('Visually show:'))));
check('every shot has an explicit storytelling goal', () => assert(planA.shots.every(shot => shot.goal.length > 20)));
check('every shot has camera direction', () => assert(planA.shots.every(shot => shot.camera.length > 20)));
check('continuity rules are present on every shot', () => assert(planA.shots.every(shot => shot.continuityNotes.length >= 4)));
check('character references resolve to Character Bible ids', () => {
  const ids = new Set(bible.characters.map(character => character.id));
  assert(planA.shots.flatMap(shot => shot.characters).every(id => ids.has(id)));
});
check('shot prompts carry Character Bible context', () => assert(planA.shots.every(shot => shot.prompt.includes('CARTOON BIBLE V11.1:')));
check('shot prompts identify the Phase 11.2 shot contract', () => assert(planA.shots.every(shot => shot.prompt.includes('SHOT PLAN V11.2:')));
check('shot prompts explicitly prohibit random changes', () => assert(planA.shots.every(shot => shot.prompt.includes('no unmotivated costume/location changes')));
check('shot durations preserve total scene duration', () => {
  const total = planA.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  assert(Math.abs(total - sceneA.duration) < 0.01);
});
check('same creative input produces the same scene plan fingerprint', () => {
  const rebuilt = planner.planScene(production, sceneA, bible);
  assert.strictEqual(rebuilt.fingerprint, planA.fingerprint);
});
check('same creative input produces the same shot ids', () => {
  const rebuilt = planner.planScene(production, sceneA, bible);
  assert.deepStrictEqual(rebuilt.shots.map(shot => shot.id), planA.shots.map(shot => shot.id));
});
check('changing scene narration invalidates the shot plan fingerprint', () => {
  const changed = planner.planScene(production, { ...sceneA, scriptText: `${sceneA.scriptText} Tico arrives with a tiny bell.` }, bible);
  assert.notStrictEqual(changed.fingerprint, planA.fingerprint);
});
check('custom four-shot minimum is honored', () => {
  const custom = new CartoonShotPlannerV11({ minShots: 4, maxShots: 6, logger: { info() {}, warn() {}, error() {} } });
  const short = custom.planScene(production, { ...sceneA, duration: 3, scriptText: 'Luna smiles.' }, bible);
  assert(short.shotCount >= 4);
});
check('planner is inactive without an active cartoon bible', () => assert.strictEqual(planner.planProduction(production, [sceneA], null), null));

const productionPlan = planner.planProduction(production, [sceneA, sceneB], bible);
check('production shot plan covers every scene', () => assert.strictEqual(productionPlan.sceneCount, 2));
check('flat shot list equals the sum of per-scene shots', () => {
  const nested = productionPlan.scenes.reduce((sum, item) => sum + item.shotCount, 0);
  assert.strictEqual(productionPlan.shotCount, nested);
  assert.strictEqual(productionPlan.shots.length, nested);
});
check('production summary reports average shots per scene', () => assert(productionPlan.summary.averageShotsPerScene >= 3));
check('production fingerprint is stable', () => {
  const rebuilt = planner.planProduction(production, [sceneA, sceneB], bible);
  assert.strictEqual(rebuilt.fingerprint, productionPlan.fingerprint);
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns a persistent scene_shots table', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS scene_shots')));
check('database can deterministically replace one scene shot plan', () => assert(dbSource.includes('async replaceSceneShots(productionId, sceneId, shots = [])')));
check('database can list persisted shots', () => assert(dbSource.includes('async listSceneShots(productionId, sceneId = null)')));
check('production bundle exposes shots to review and later keyframe phases', () => assert(dbSource.includes('const shots = await this.listSceneShots(productionId);')));
check('scene pipeline imports the Phase 11.2 planner', () => assert(pipelineSource.includes("const { CartoonShotPlannerV11 } = require('./cartoon-shot-planner-v11');")));
check('scene pipeline constructs the shot planner', () => assert(pipelineSource.includes('this.shotPlanner = options.shotPlanner || new CartoonShotPlannerV11')));
check('scene pipeline persists changed scene plans before visual production', () => assert(pipelineSource.includes('await this.db.replaceSceneShots(production.id, scenePlan.sceneId, scenePlan.shots);')));
check('scene pipeline reuses a matching persisted shot plan on Resume', () => assert(pipelineSource.includes('currentPlanFingerprint !== scenePlan.fingerprint')));
check('scene manifest records Phase 11.2 planner identity and shot count', () => {
  assert(pipelineSource.includes('shotPlannerVersion: shotPlan?.version'));
  assert(pipelineSource.includes('shotPlanFingerprint: shotPlan?.fingerprint'));
  assert(pipelineSource.includes('shotCount: shotPlan?.shotCount'));
});
check('Phase 11.1 activation no longer reuses stale cartoon bible state', () => {
  assert(pipelineSource.includes('let cartoonBible = null;'));
  assert(pipelineSource.includes('const plannedCartoonBible = this.cartoonBible.buildProductionBible(production);'));
});
check('active Cartoon Bible is passed into persistManifest instead of relying on out-of-scope state', () => {
  assert(pipelineSource.includes('persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan)'));
});
check('persistManifest explicitly receives Cartoon Bible and Shot Plan', () => {
  assert(pipelineSource.includes('visualPlan = null, cartoonBible = null, shotPlan = null'));
});
check('Review Studio renders the per-scene shot plan', () => assert(dashboardSource.includes('function renderCartoonShotPlan(item)')));
check('Review Studio states that keyframes begin in Phase 11.3', () => assert(dashboardSource.includes('Multi-keyframe generation begins in Phase 11.3')));
check('package exposes the Phase 11.2 regression command', () => assert.strictEqual(pkg.scripts['test:shot-planner'], 'node ../bootstrap/verify-phase11-shot-planner.js'));
check('environment documents three-shot default minimum', () => assert(envSource.includes('CARTOON_SHOTS_PER_SCENE_MIN=3')));
check('environment documents six-shot default maximum', () => assert(envSource.includes('CARTOON_SHOTS_PER_SCENE_MAX=6')));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.2 Shot Planner OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
