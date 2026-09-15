'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const sharp = require(path.join(upstream, 'node_modules', 'sharp'));
const runtimePath = path.join(upstream, 'utils', 'environment-continuity-validator-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.7.6 runtime is not materialized: utils/environment-continuity-validator-v11.js');

const {
  ENVIRONMENT_CONTINUITY_VERSION,
  EnvironmentContinuityValidatorV11,
  imageSignature,
  scoreEnvironment,
  requiredPropPromptCoverage,
  repairPrompt,
  hammingSimilarity,
  gridSimilarity
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const logger = { info() {}, warn() {}, error() {} };

const environment = {
  environmentId: 'env_house_fixture',
  fingerprint: 'env-fixture',
  name: 'Wooden Family House',
  category: 'house',
  construction: 'natural wood construction',
  materials: ['natural wood', 'soft fabric'],
  palette: ['warm brown', 'beige', 'cream'],
  lighting: 'warm afternoon light'
};
const mapping = {
  sceneId: 'scene_house',
  environmentId: environment.environmentId,
  environmentName: environment.name,
  zone: 'living_room',
  status: 'mapped',
  confidence: 0.9
};
const propLocks = [
  { id: 'prop_sofa', environmentId: environment.environmentId, name: 'sofa', required: true },
  { id: 'prop_table', environmentId: environment.environmentId, name: 'coffee table', required: true }
];

class FakeDb {
  constructor(master) {
    this.master = master;
    this.checks = [];
    this.mapping = mapping;
  }
  async getSceneEnvironment() { return this.mapping; }
  async getLatestEnvironmentBible() { return { productionId: 'prod', environments: [environment] }; }
  async listPropLocks() { return propLocks; }
  async getLatestEnvironmentMasterFrame() { return this.master; }
  async saveEnvironmentContinuityCheck(input) { this.checks.push({ ...input }); return input; }
}

check('environment continuity contract is version 11.7.6', () => assert.strictEqual(ENVIRONMENT_CONTINUITY_VERSION, '11.7.6'));
check('identical perceptual hashes score one', () => assert.strictEqual(hammingSimilarity('1010', '1010'), 1));
check('different perceptual hashes score lower', () => assert(hammingSimilarity('1111', '0000') < 0.01));
check('identical environment grids score one', () => assert.strictEqual(gridSimilarity([10, 20, 30], [10, 20, 30]), 1));
check('different environment grids score low', () => assert(gridSimilarity([0, 0, 0], [255, 255, 255]) < 0.05));

const signatureA = { aspect: 16 / 9, rgbMean: [110, 85, 55], luminance: 86, grid: Array(48).fill(90), dhash: '1'.repeat(64), edgeDensity: 18 };
const signatureB = { ...signatureA };
const signatureDrift = { aspect: 1, rgbMean: [245, 245, 250], luminance: 246, grid: Array(48).fill(245), dhash: '0'.repeat(64), edgeDensity: 2 };
check('identical signatures score nearly one', () => assert(scoreEnvironment(signatureA, signatureB).score > 0.99));
check('major environment redesign scores below default threshold', () => assert(scoreEnvironment(signatureA, signatureDrift).score < 0.42));
check('environment score exposes all structural metrics', () => {
  const metrics = scoreEnvironment(signatureA, signatureDrift).metrics;
  for (const key of ['aspect', 'palette', 'luminance', 'compositionGrid', 'perceptualHash', 'edgeDensity']) assert(Object.hasOwn(metrics, key));
});

check('required prop prompt coverage passes when every lock is named', () => {
  const result = requiredPropPromptCoverage('keep the beige sofa and coffee table in the same room', propLocks);
  assert.strictEqual(result.coverage, 1);
  assert.deepStrictEqual(result.missing, []);
});
check('required prop prompt coverage reports a missing lock', () => {
  const result = requiredPropPromptCoverage('keep the sofa in the same room', propLocks);
  assert.strictEqual(result.coverage, 0.5);
  assert(result.missing.includes('prop_table'));
});
check('no required props yields full prompt coverage', () => assert.strictEqual(requiredPropPromptCoverage('anything', []).coverage, 1));
check('repair prompt freezes persistent environment identity', () => {
  const prompt = repairPrompt(
    { prompt: 'SHOT' },
    { mapping, environment, propLocks },
    { score: 0.3 }
  );
  assert(prompt.includes('ENVIRONMENT CONTINUITY REPAIR V11.7.6:'));
  assert(prompt.includes(environment.environmentId));
  assert(prompt.includes('natural wood construction'));
  assert(prompt.includes('sofa'));
  assert(prompt.includes('coffee table'));
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const characterContinuitySource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-continuity-engine-v11.js'), 'utf8');
const qualitySource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-quality-gate-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns environment continuity audit records', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS environment_continuity_checks')));
check('database persists environment continuity decisions', () => assert(dbSource.includes('async saveEnvironmentContinuityCheck(input = {})')));
check('database lists environment continuity history', () => assert(dbSource.includes('async listEnvironmentContinuityChecks(productionId)')));
check('database gets latest environment decision by keyframe', () => assert(dbSource.includes('async getLatestEnvironmentContinuityCheck(productionId, keyframeId)')));
check('production bundle exposes environment continuity checks', () => assert(dbSource.includes('const environmentContinuityChecks = await this.listEnvironmentContinuityChecks(productionId);') && dbSource.includes('environmentContinuityChecks,')));
check('scene pipeline imports Environment Continuity Validator', () => assert(pipelineSource.includes("const { EnvironmentContinuityValidatorV11 } = require('./environment-continuity-validator-v11');")));
check('scene pipeline constructs Environment Continuity Validator', () => assert(pipelineSource.includes('this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11')));
check('scene pipeline wires validator into keyframe pipeline', () => assert(pipelineSource.includes('environmentContinuityValidator: this.environmentContinuityValidator')));
check('keyframe pipeline accepts environment validator', () => assert(keyframeSource.includes('this.environmentContinuityValidator = options.environmentContinuityValidator || null')));
check('keyframe generation preflights canonical environment', () => assert(keyframeSource.includes('this.environmentContinuityValidator.assertSceneReady(productionId, sceneId)')));
check('every generated keyframe receives environment validation', () => assert(keyframeSource.includes('this.environmentContinuityValidator.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })')));
check('failed environment continuity blocks keyframe readiness', () => assert(keyframeSource.includes("status: 'environment_continuity_failed'")));
check('environment continuity exposes stable failure code', () => assert(keyframeSource.includes("environmentError.code = 'ENVIRONMENT_CONTINUITY_FAILED'")));
check('character continuity still anchors first character keyframe', () => assert(characterContinuitySource.includes('if (!keyframe.referenceKeyframeId) {')));
check('character continuity does not use Master Environment as character similarity gate', () => assert(!characterContinuitySource.includes('if (!keyframe.referenceKeyframeId && !referenceAssetPath) {')));
check('Cartoon Quality loads environment continuity checks', () => assert(qualitySource.includes('const environmentContinuityChecks = Array.isArray(production.environmentContinuityChecks)')));
check('Cartoon Quality requires environment decisions for mapped shots', () => assert(qualitySource.includes('cartoon_environment_continuity_missing')));
check('Cartoon Quality blocks rejected environment continuity', () => assert(qualitySource.includes('cartoon_environment_continuity_rejected')));
check('Cartoon Quality fingerprint includes environment continuity', () => assert(qualitySource.includes('environmentContinuity: [...latestEnvironmentContinuity.entries()]')));
check('Cartoon Quality fingerprint includes shot environment context', () => assert(qualitySource.includes('shotEnvironmentContexts: shotEnvironmentContexts.map')));
check('Cartoon Quality reports semantic prop limitation truthfully', () => assert(qualitySource.includes("environmentPropPresenceMode: 'prompt-contract-only'")));
check('Review Studio renders Environment Continuity panel', () => assert(dashboardSource.includes('function renderEnvironmentContinuity(item)')));
check('Review Studio does not claim semantic prop recognition', () => assert(dashboardSource.includes('semantic object presence is not claimed without a vision detector')));
check('environment enables Environment Continuity', () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_ENABLED=true')));
check('environment requires canonical Master Environment by default', () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_REQUIRE_MASTER=true')));
check('environment documents default continuity threshold', () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_MIN_SCORE=0.42')));
check('environment requires full required-prop prompt coverage', () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE=1')));
check('package exposes Phase 11.7.6 regression command', () => assert.strictEqual(pkg.scripts['test:environment-continuity'], 'node ../bootstrap/verify-phase11-environment-continuity.js'));

async function runtimeChecks() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-7-6-'));
  const masterPath = path.join(temp, 'master.png');
  const candidatePath = path.join(temp, 'candidate.png');
  const driftPath = path.join(temp, 'drift.png');

  const base = sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 125, g: 91, b: 58 } } })
    .composite([
      { input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="30" y="95" width="105" height="50" fill="#d8c7a1"/><rect x="165" y="110" width="75" height="24" fill="#6d4728"/><rect x="255" y="28" width="42" height="92" fill="#f3d98b"/></svg>'), top: 0, left: 0 }
    ]);
  await base.png().toFile(masterPath);
  await fsp.copyFile(masterPath, candidatePath);
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 245, g: 248, b: 250 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><circle cx="160" cy="90" r="60" fill="#9ed8ff"/></svg>'), top: 0, left: 0 }])
    .png().toFile(driftPath);

  const master = {
    environmentId: environment.environmentId,
    status: 'ready',
    canonical: true,
    masterFramePath: masterPath,
    assetSha256: 'master-sha-fixture'
  };
  const db = new FakeDb(master);
  const validator = new EnvironmentContinuityValidatorV11(db, { logger, threshold: 0.42, requireMaster: true, minPropPromptCoverage: 1 });

  check('canonical mapped scene passes preflight', async () => {
    const context = await validator.assertSceneReady('prod', 'scene_house');
    assert.strictEqual(context.masterReady, true);
    assert.strictEqual(context.mapping.environmentId, environment.environmentId);
  });
  check('real image signature exposes structural evidence', async () => {
    const signature = await imageSignature(masterPath);
    assert.strictEqual(signature.width, 320);
    assert.strictEqual(signature.height, 180);
    assert.strictEqual(signature.grid.length, 48);
    assert.strictEqual(signature.dhash.length, 64);
    assert(Number.isFinite(signature.edgeDensity));
    assert(/^[a-f0-9]{64}$/.test(signature.fingerprint));
  });
  check('identical master-backed keyframe passes environment validation', async () => {
    const result = await validator.evaluate({
      productionId: 'prod', sceneId: 'scene_house',
      keyframe: { id: 'kf_good', shotId: 'shot_good', prompt: 'keep the sofa and coffee table in the wooden room' },
      assetPath: candidatePath
    });
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.status, 'accepted');
    assert(result.score > 0.99);
    assert.strictEqual(result.metrics.propPromptCoverage, 1);
    assert.strictEqual(result.metrics.semanticPropPresenceVerified, false);
  });
  check('environment decision is persisted', () => assert(db.checks.some(item => item.keyframeId === 'kf_good' && item.status === 'accepted')));
  check('large visual redesign fails environment validation', async () => {
    const strictDb = new FakeDb(master);
    const strict = new EnvironmentContinuityValidatorV11(strictDb, { logger, threshold: 0.75, requireMaster: true, minPropPromptCoverage: 1 });
    const result = await strict.evaluate({
      productionId: 'prod', sceneId: 'scene_house',
      keyframe: { id: 'kf_drift', shotId: 'shot_drift', prompt: 'keep the sofa and coffee table in the wooden room' },
      assetPath: driftPath
    });
    assert.strictEqual(result.accepted, false);
    assert.strictEqual(result.status, 'repair_needed');
    assert(result.reasons.includes('ENVIRONMENT_SCORE_BELOW_THRESHOLD'));
  });
  check('missing required prop name blocks even an identical image', async () => {
    const result = await validator.evaluate({
      productionId: 'prod', sceneId: 'scene_house',
      keyframe: { id: 'kf_prompt_missing', shotId: 'shot_prompt_missing', prompt: 'keep the sofa in the wooden room' },
      assetPath: candidatePath
    });
    assert.strictEqual(result.accepted, false);
    assert(result.reasons.includes('REQUIRED_PROP_PROMPT_COVERAGE_MISSING'));
    assert(result.missingPropLockIds.includes('prop_table'));
  });
  check('missing canonical master fails scene preflight', async () => {
    const missing = new EnvironmentContinuityValidatorV11(new FakeDb(null), { logger, requireMaster: true });
    await assert.rejects(() => missing.assertSceneReady('prod', 'scene_house'), error => error.code === 'ENVIRONMENT_MASTER_REQUIRED');
  });
  check('unresolved environment mapping fails scene preflight', async () => {
    const unresolvedDb = new FakeDb(master);
    unresolvedDb.mapping = { sceneId: 'scene_house', environmentId: null, status: 'unresolved' };
    const unresolved = new EnvironmentContinuityValidatorV11(unresolvedDb, { logger, requireMaster: true });
    await assert.rejects(() => unresolved.assertSceneReady('prod', 'scene_house'), error => error.code === 'ENVIRONMENT_MAPPING_REQUIRED');
  });
  check('explicit non-required master mode stays auditable', async () => {
    const optional = new EnvironmentContinuityValidatorV11(new FakeDb(null), { logger, requireMaster: false });
    const result = await optional.evaluate({
      productionId: 'prod', sceneId: 'scene_house',
      keyframe: { id: 'kf_no_master', shotId: 'shot_no_master', prompt: 'sofa coffee table' },
      assetPath: candidatePath
    });
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.status, 'skipped_no_master');
  });

  await fsp.rm(temp, { recursive: true, force: true });
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.7.6 Environment Continuity OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
