'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'environment-prompt-enricher-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.7.5 runtime is not materialized: utils/environment-prompt-enricher-v11.js');

const {
  ENVIRONMENT_PROMPT_ENRICHER_VERSION,
  EnvironmentPromptEnricherV11,
  environmentById,
  locksFor,
  masterFor,
  buildEnvironmentPromptFragment,
  enrichShot
} = require(runtimePath);

const environment = {
  environmentId: 'env_house_01', fingerprint: 'env-fp-01', name: 'Wooden House', category: 'house',
  description: 'cozy furnished wooden house', construction: 'natural wood construction', architecturalStyle: 'rustic cozy',
  palette: ['warm brown', 'beige', 'cream'], lighting: 'warm afternoon light', layout: 'living room connected to kitchen',
  materials: ['natural wood', 'soft fabric'], signatureElements: ['beige sofa', 'rustic coffee table', 'large window'],
  forbiddenChanges: ['do not redesign layout'], sourceEvidence: []
};
const environmentBible = { version: '11.7.1', fingerprint: 'env-bible-fp', environments: [environment] };
const mapping = {
  version: '11.7.4', sceneId: 'scene_1', environmentId: environment.environmentId, environmentFingerprint: environment.fingerprint,
  environmentName: environment.name, zone: 'living_room', status: 'mapped', confidence: 0.92, reason: 'lexical_match',
  fingerprint: 'mapping-fp', masterFramePath: 'C:/fixture/master.png', masterCanonical: true
};
const propLocks = [
  { id: 'prop_sofa', environmentId: environment.environmentId, name: 'sofa', required: true, fingerprint: 'lock-sofa', continuityPriority: 'critical', lockedAttributes: { color: 'beige', material: 'soft fabric' }, allowedChanges: [], forbiddenChanges: ['do not replace sofa'] },
  { id: 'prop_table', environmentId: environment.environmentId, name: 'coffee table', required: true, fingerprint: 'lock-table', continuityPriority: 'critical', lockedAttributes: { material: 'natural wood' }, allowedChanges: [], forbiddenChanges: ['do not replace table'] },
  { id: 'prop_vase', environmentId: environment.environmentId, name: 'vase', required: false, fingerprint: 'lock-vase', continuityPriority: 'low', lockedAttributes: {}, allowedChanges: [], forbiddenChanges: [] }
];
const master = { environmentId: environment.environmentId, status: 'ready', canonical: true, masterFramePath: 'C:/fixture/master.png', assetSha256: 'a'.repeat(64) };
const shot = {
  id: 'shot_1', sceneId: 'scene_1', shotIndex: 0, shotCount: 3, shotType: 'wide', planFingerprint: 'planner-fp', fingerprint: 'base-shot-fp',
  prompt: 'CHARACTER BIBLE\nSHOT PLAN V11.2:\nACTION: Benny enters the room.', background: 'same established location', continuityNotes: ['preserve Character Bible identity exactly']
};

const fragment = buildEnvironmentPromptFragment(mapping, environment, propLocks, master);
const enrichedA = enrichShot(shot, mapping, environment, propLocks, master);
const enrichedB = enrichShot(shot, mapping, environment, propLocks, master);
const unresolved = enrichShot(shot, { sceneId: 'scene_1', status: 'unresolved', environmentId: null }, null, [], null);
const service = new EnvironmentPromptEnricherV11({ enabled: true });
const plan = service.enrichProduction(
  { id: 'prod_fixture' },
  { fingerprint: 'shot-plan-fp', shots: [shot], scenes: [{ sceneId: 'scene_1', fingerprint: 'scene-plan-fp', shots: [shot] }] },
  { fingerprint: 'scene-env-fp', mappings: [mapping] },
  environmentBible,
  propLocks,
  [master]
);

const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const continuitySource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-continuity-engine-v11.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('version is 11.7.5', () => assert.strictEqual(ENVIRONMENT_PROMPT_ENRICHER_VERSION, '11.7.5'));
check('environmentById resolves mapped environment', () => assert.strictEqual(environmentById(environmentBible, environment.environmentId)?.name, 'Wooden House'));
check('environmentById does not invent unknown environment', () => assert.strictEqual(environmentById(environmentBible, 'missing'), null));
check('locksFor filters environment locks', () => assert.strictEqual(locksFor([...propLocks, { environmentId: 'other' }], environment.environmentId).length, 3));
check('masterFor accepts canonical ready master only', () => assert.strictEqual(masterFor([master], environment.environmentId)?.masterFramePath, master.masterFramePath));
check('masterFor rejects noncanonical frame', () => assert.strictEqual(masterFor([{ ...master, canonical: false }], environment.environmentId), null));
check('fragment names Phase 11.7.5', () => assert(fragment.includes('ENVIRONMENT CONTINUITY V11.7.5')));
check('fragment carries Environment ID', () => assert(fragment.includes('ENVIRONMENT ID: env_house_01')));
check('fragment carries living-room zone', () => assert(fragment.includes('ZONE: living_room')));
check('fragment carries wooden construction', () => assert(fragment.includes('natural wood construction')));
check('fragment carries sofa prop lock', () => assert(fragment.includes('PROP LOCK: sofa')));
check('fragment carries table prop lock', () => assert(fragment.includes('PROP LOCK: coffee table')));
check('fragment carries canonical master SHA', () => assert(fragment.includes('sha256=' + 'a'.repeat(64))));
check('fragment forbids location redesign', () => assert(fragment.includes('must not be redesigned between shots')));
check('enriched prompt preserves Character Bible', () => assert(enrichedA.prompt.includes('CHARACTER BIBLE')));
check('enriched prompt preserves Shot Planner contract', () => assert(enrichedA.prompt.includes('SHOT PLAN V11.2')));
check('enriched prompt adds environment contract', () => assert(enrichedA.prompt.includes('ENVIRONMENT CONTINUITY V11.7.5')));
check('enriched shot carries environmentId', () => assert.strictEqual(enrichedA.environmentId, environment.environmentId));
check('enriched shot carries zone', () => assert.strictEqual(enrichedA.environmentZone, 'living_room'));
check('enriched shot carries master path', () => assert.strictEqual(enrichedA.masterEnvironmentPath, master.masterFramePath));
check('enriched shot marks master canonical', () => assert.strictEqual(enrichedA.masterEnvironmentCanonical, true));
check('enriched shot carries required locks only', () => assert.deepStrictEqual(enrichedA.requiredPropLockIds.sort(), ['prop_sofa', 'prop_table'].sort()));
check('enrichment is deterministic', () => assert.strictEqual(enrichedA.fingerprint, enrichedB.fingerprint));
check('environment context fingerprint is deterministic', () => assert.strictEqual(enrichedA.environmentPromptFingerprint, enrichedB.environmentPromptFingerprint));
check('planner planFingerprint remains untouched for Resume stability', () => assert.strictEqual(enrichedA.planFingerprint, shot.planFingerprint));
check('background names persistent environment', () => assert(enrichedA.background.includes('env_house_01')));
check('continuity notes preserve required sofa', () => assert(enrichedA.continuityNotes.some(note => note.includes('required prop: sofa'))));
check('unresolved mapping is explicit', () => assert(unresolved.prompt.includes('STATUS: unresolved')));
check('unresolved mapping does not fabricate Environment ID', () => assert.strictEqual(unresolved.environmentId, null));
check('production plan returns one shot', () => assert.strictEqual(plan.summary.shotCount, 1));
check('production plan reports mapped shot', () => assert.strictEqual(plan.summary.mappedShotCount, 1));
check('production plan reports master-backed shot', () => assert.strictEqual(plan.summary.masterBackedShotCount, 1));
check('production plan preserves scene wrapper', () => assert.strictEqual(plan.scenes[0].shots[0].environmentId, environment.environmentId));
check('database owns shot environment contexts', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS shot_environment_contexts')));
check('database persists shot environment contexts', () => assert(dbSource.includes('async replaceShotEnvironmentContexts(productionId, plan = {})')));
check('database lists shot environment contexts', () => assert(dbSource.includes('async listShotEnvironmentContexts(productionId, sceneId = null)')));
check('production bundle exposes shot environment contexts', () => assert(dbSource.includes('const shotEnvironmentContexts = await this.listShotEnvironmentContexts(productionId);') && dbSource.includes('shotEnvironmentContexts,')));
check('scene pipeline imports environment prompt enricher', () => assert(pipelineSource.includes("const { EnvironmentPromptEnricherV11 } = require('./environment-prompt-enricher-v11');")));
check('scene pipeline constructs environment prompt enricher', () => assert(pipelineSource.includes('this.environmentPromptEnricher = options.environmentPromptEnricher || new EnvironmentPromptEnricherV11')));
check('scene pipeline enriches before keyframes', () => assert(pipelineSource.indexOf('this.environmentPromptEnricher.enrichProduction') < pipelineSource.indexOf('this.keyframePipeline.ensurePlan')));
check('changed enriched shot invalidates old keyframes through replaceSceneShots', () => assert(pipelineSource.includes('if (changed) await this.db.replaceSceneShots(production.id, scenePlan.sceneId, scenePlan.shots);'));
check('keyframe runtime can load Scene Environment mapping', () => assert(keyframeSource.includes('this.db?.getSceneEnvironment')));
check('keyframe runtime uses canonical master for first start', () => assert(keyframeSource.includes("current.keyframeRole === 'start' && !current.referenceKeyframeId")));
check('keyframe runtime verifies master file exists', () => assert(keyframeSource.includes('await this.pathExists(sceneEnvironment.masterFramePath)'));
check('continuity engine does not auto-anchor when external master exists', () => assert(continuitySource.includes('if (!keyframe.referenceKeyframeId && !referenceAssetPath)'));
check('dashboard renders environment prompt enrichment', () => assert(dashboardSource.includes('ENVIRONMENT PROMPT ENRICHMENT V11.7.5')));
check('dashboard states master reference activity', () => assert(dashboardSource.includes('MASTER REFERENCE ACTIVE')));
check('environment prompt enrichment enabled by default', () => assert(envSource.includes('ENVIRONMENT_PROMPT_ENRICHMENT_ENABLED=true')));
check('package exposes environment prompt test', () => assert.strictEqual(pkg.scripts['test:environment-prompts'], 'node ../bootstrap/verify-phase11-environment-prompt-enrichment.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.7.5 Environment Prompt Enrichment OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
