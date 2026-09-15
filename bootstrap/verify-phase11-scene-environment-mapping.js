'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'scene-environment-mapper-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.7.4 runtime is not materialized: utils/scene-environment-mapper-v11.js');

const {
  SCENE_ENVIRONMENT_MAPPER_VERSION,
  SceneEnvironmentMapperV11,
  detectZone,
  lexicalScore,
  mapScene,
  masterFor
} = require(runtimePath);

const house = {
  environmentId: 'env_house_fixture', fingerprint: 'env-house-fp', name: 'Wooden Family House', category: 'house',
  description: 'furnished wooden house with living room and compact kitchen', construction: 'natural wood construction',
  architecturalStyle: 'cozy rustic family home', materials: ['natural wood', 'soft fabric'],
  signatureElements: ['beige sofa', 'coffee table', 'bookshelf', 'large window'],
  sourceEvidence: [{ source: 'explicit_instruction', text: 'Environment: furnished wooden house with beige sofa and rustic table.' }]
};
const garden = {
  environmentId: 'env_garden_fixture', fingerprint: 'env-garden-fp', name: 'Colorful Garden', category: 'garden',
  description: 'colorful flower garden with garden path and open sky', architecturalStyle: 'storybook garden',
  materials: ['grass', 'soil', 'wood'], signatureElements: ['garden path', 'flower bed', 'open sky'],
  sourceEvidence: [{ source: 'production_text', text: 'The colorful garden has a flower bed and garden path.' }]
};
const bible = { version: '11.7.1', productionId: 'prod_map_fixture', fingerprint: 'env-bible-fp', environments: [house, garden] };
const masterFrames = [{
  environmentId: house.environmentId, status: 'ready', canonical: true,
  masterFramePath: 'C:/fixture/master-house.png', assetSha256: 'a'.repeat(64)
}];
const scenes = [
  { id: 'scene_1', position: 0, label: 'Living room', scriptText: 'Benny sits beside the beige sofa inside the wooden house.' },
  { id: 'scene_2', position: 1, label: 'Kitchen lesson', scriptText: 'He continues into the kitchen of the same house and points to a blue cup.' },
  { id: 'scene_3', position: 2, label: 'Garden colors', scriptText: 'Later Benny walks to the colorful garden path and sees the flower bed.' },
  { id: 'scene_4', position: 3, label: 'A quiet beat', scriptText: 'The friends smile together with no clear location words.' }
];

const service = new SceneEnvironmentMapperV11({ enabled: true, minimumScore: 0.18 });
const plan = service.mapProduction({ id: 'prod_map_fixture' }, scenes, bible, masterFrames);
const again = service.mapProduction({ id: 'prod_map_fixture' }, scenes, bible, masterFrames);
const first = plan.mappings.find(item => item.sceneId === 'scene_1');
const second = plan.mappings.find(item => item.sceneId === 'scene_2');
const third = plan.mappings.find(item => item.sceneId === 'scene_3');
const fourth = plan.mappings.find(item => item.sceneId === 'scene_4');

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('version is 11.7.4', () => assert.strictEqual(SCENE_ENVIRONMENT_MAPPER_VERSION, '11.7.4'));
check('living room zone detected', () => assert.strictEqual(detectZone('inside the living room'), 'living_room'));
check('Portuguese kitchen zone detected', () => assert.strictEqual(detectZone('na cozinha da casa'), 'kitchen'));
check('garden zone detected', () => assert.strictEqual(detectZone('walk through the garden'), 'garden'));
check('unknown zone stays null', () => assert.strictEqual(detectZone('characters smile together'), null));
check('house lexical score beats garden for sofa scene', () => assert(lexicalScore(scenes[0], house).score > lexicalScore(scenes[0], garden).score));
check('garden lexical score beats house for garden scene', () => assert(lexicalScore(scenes[2], garden).score > lexicalScore(scenes[2], house).score));
check('first scene maps to house', () => assert.strictEqual(first.environmentId, house.environmentId));
check('first scene maps living room zone', () => assert.strictEqual(first.zone, 'living_room'));
check('first scene is mapped', () => assert.strictEqual(first.status, 'mapped'));
check('first scene carries confidence', () => assert(first.confidence > 0.5));
check('first scene master is canonical', () => assert.strictEqual(first.masterCanonical, true));
check('first scene carries master path', () => assert.strictEqual(first.masterFramePath, masterFrames[0].masterFramePath));
check('second scene reuses same house', () => assert.strictEqual(second.environmentId, house.environmentId));
check('second scene maps kitchen zone', () => assert.strictEqual(second.zone, 'kitchen'));
check('garden scene changes environment', () => assert.strictEqual(third.environmentId, garden.environmentId));
check('garden scene does not claim house master', () => assert.strictEqual(third.masterCanonical, false));
check('adjacent ambiguous scene reuses previous garden', () => assert.strictEqual(fourth.environmentId, garden.environmentId));
check('adjacent ambiguous reuse records reason', () => assert.strictEqual(fourth.reason, 'adjacent_scene_continuity'));
check('plan covers all scenes', () => assert.strictEqual(plan.summary.sceneCount, scenes.length));
check('plan reports all mapped', () => assert.strictEqual(plan.summary.mappedCount, scenes.length));
check('plan reports two reused environments', () => assert.strictEqual(plan.summary.reusedEnvironmentCount, 2));
check('plan reports master-backed house scenes', () => assert(plan.summary.masterBackedCount >= 2));
check('plan fingerprint deterministic', () => assert.strictEqual(plan.fingerprint, again.fingerprint));
check('mapping fingerprints deterministic', () => assert.deepStrictEqual(plan.mappings.map(item => item.fingerprint), again.mappings.map(item => item.fingerprint)));
check('plan fingerprint propagated to mappings', () => assert(plan.mappings.every(item => item.planFingerprint === plan.fingerprint)));
check('masterFor finds only canonical ready frame', () => assert.strictEqual(masterFor(masterFrames, house.environmentId).masterFramePath, masterFrames[0].masterFramePath));
check('masterFor returns null for missing garden master', () => assert.strictEqual(masterFor(masterFrames, garden.environmentId), null));

const ambiguousScene = { id: 'ambiguous', position: 0, label: 'Story beat', scriptText: 'The friends talk and smile.' };
const ambiguous = mapScene(ambiguousScene, [house, garden], null, masterFrames, { minimumScore: 0.18 });
check('multi-environment ambiguity fails closed', () => assert.strictEqual(ambiguous.status, 'unresolved'));
check('ambiguous mapping invents no environment id', () => assert.strictEqual(ambiguous.environmentId, null));
check('ambiguous mapping claims no master path', () => assert.strictEqual(ambiguous.masterFramePath, null));

const single = mapScene(ambiguousScene, [house], null, masterFrames, { minimumScore: 0.18 });
check('single environment can be reused conservatively', () => assert.strictEqual(single.environmentId, house.environmentId));
check('single environment fallback reason is explicit', () => assert.strictEqual(single.reason, 'single_environment_reuse'));
check('single environment confidence is moderate', () => assert(single.confidence >= 0.5 && single.confidence < 0.7));
check('disabled mapper returns null', () => assert.strictEqual(new SceneEnvironmentMapperV11({ enabled: false }).mapProduction({}, scenes, bible, masterFrames), null));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns scene_environments table', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS scene_environments')));
check('database persists scene mappings', () => assert(dbSource.includes('async replaceProductionSceneEnvironments(productionId, plan = {})')));
check('database lists scene mappings', () => assert(dbSource.includes('async listSceneEnvironments(productionId)')));
check('database gets one scene mapping', () => assert(dbSource.includes('async getSceneEnvironment(productionId, sceneId)')));
check('bundle exposes sceneEnvironments', () => assert(dbSource.includes('const sceneEnvironments = await this.listSceneEnvironments(productionId);') && dbSource.includes('sceneEnvironments,')));
check('pipeline imports mapper', () => assert(pipelineSource.includes("const { SceneEnvironmentMapperV11 } = require('./scene-environment-mapper-v11');")));
check('pipeline constructs mapper', () => assert(pipelineSource.includes('this.sceneEnvironmentMapper = options.sceneEnvironmentMapper || new SceneEnvironmentMapperV11')));
check('pipeline maps after final scene planning', () => assert(pipelineSource.includes('this.sceneEnvironmentMapper.mapProduction(production, scenes, environmentBible, latestMasterFrames)'));
check('pipeline persists mapping plan', () => assert(pipelineSource.includes('replaceProductionSceneEnvironments(production.id, sceneEnvironmentPlan)'));
check('dashboard renders mapper panel', () => assert(dashboardSource.includes('SCENE → ENVIRONMENT V11.7.4')));
check('dashboard exposes unresolved state', () => assert(dashboardSource.includes("'UNRESOLVED'")));
check('package exposes mapping test', () => assert.strictEqual(pkg.scripts['test:scene-environments'], 'node ../bootstrap/verify-phase11-scene-environment-mapping.js'));
check('mapping enabled in env example', () => assert(envSource.includes('SCENE_ENVIRONMENT_MAPPING_ENABLED=true'));
check('minimum score is explicit in env example', () => assert(envSource.includes('SCENE_ENVIRONMENT_MIN_SCORE=0.18'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.7.4 Scene Environment Mapping OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
