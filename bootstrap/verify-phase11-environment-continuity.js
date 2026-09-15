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
  sceneId: 'scene_house', environmentId: environment.environmentId, environmentName: environment.name,
  zone: 'living_room', status: 'mapped', confidence: 0.9
};
const propLocks = [
  { id: 'prop_sofa', environmentId: environment.environmentId, name: 'sofa', required: true },
  { id: 'prop_table', environmentId: environment.environmentId, name: 'coffee table', required: true }
];

class FakeDb {
  constructor(master) { this.master = master; this.checks = []; this.mapping = mapping; }
  async getSceneEnvironment() { return this.mapping; }
  async getLatestEnvironmentBible() { return { productionId: 'prod', environments: [environment] }; }
  async listPropLocks() { return propLocks; }
  async getLatestEnvironmentMasterFrame() { return this.master; }
  async saveEnvironmentContinuityCheck(input) { this.checks.push({ ...input }); return input; }
}

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const characterContinuitySource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-continuity-engine-v11.js'), 'utf8');
const qualitySource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-quality-gate-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

const staticChecks = [
  () => assert.strictEqual(ENVIRONMENT_CONTINUITY_VERSION, '11.7.6'),
  () => assert.strictEqual(hammingSimilarity('1010', '1010'), 1),
  () => assert(gridSimilarity([0, 0, 0], [255, 255, 255]) < 0.05),
  () => assert(scoreEnvironment({ aspect: 1.77, rgbMean: [100, 80, 60], luminance: 80, grid: Array(48).fill(80), dhash: '1'.repeat(64), edgeDensity: 18 }, { aspect: 1.77, rgbMean: [100, 80, 60], luminance: 80, grid: Array(48).fill(80), dhash: '1'.repeat(64), edgeDensity: 18 }).score > 0.99),
  () => assert(scoreEnvironment({ aspect: 1.77, rgbMean: [100, 80, 60], luminance: 80, grid: Array(48).fill(80), dhash: '1'.repeat(64), edgeDensity: 18 }, { aspect: 1, rgbMean: [250, 250, 250], luminance: 250, grid: Array(48).fill(250), dhash: '0'.repeat(64), edgeDensity: 2 }).score < 0.42),
  () => assert.strictEqual(requiredPropPromptCoverage('sofa and coffee table', propLocks).coverage, 1),
  () => assert.strictEqual(requiredPropPromptCoverage('sofa only', propLocks).coverage, 0.5),
  () => assert(repairPrompt({ prompt: 'shot' }, { mapping, environment, propLocks }, { score: 0.3 }).includes('ENVIRONMENT CONTINUITY REPAIR V11.7.6:')),
  () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS environment_continuity_checks')),
  () => assert(dbSource.includes('async saveEnvironmentContinuityCheck(input = {})')),
  () => assert(dbSource.includes('async listEnvironmentContinuityChecks(productionId)')),
  () => assert(dbSource.includes('async getLatestEnvironmentContinuityCheck(productionId, keyframeId)')),
  () => assert(dbSource.includes('const environmentContinuityChecks = await this.listEnvironmentContinuityChecks(productionId);')),
  () => assert(pipelineSource.includes("const { EnvironmentContinuityValidatorV11 } = require('./environment-continuity-validator-v11');")),
  () => assert(pipelineSource.includes('this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11')),
  () => assert(pipelineSource.includes('environmentContinuityValidator: this.environmentContinuityValidator')),
  () => assert(keyframeSource.includes('this.environmentContinuityValidator = options.environmentContinuityValidator || null')),
  () => assert(keyframeSource.includes('this.environmentContinuityValidator.assertSceneReady(productionId, sceneId)')),
  () => assert(keyframeSource.includes('this.environmentContinuityValidator.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })')),
  () => assert(keyframeSource.includes("status: 'environment_continuity_failed'")),
  () => assert(keyframeSource.includes("environmentError.code = 'ENVIRONMENT_CONTINUITY_FAILED'")),
  () => assert(characterContinuitySource.includes('if (!keyframe.referenceKeyframeId) {')),
  () => assert(!characterContinuitySource.includes('if (!keyframe.referenceKeyframeId && !referenceAssetPath) {')),
  () => assert(qualitySource.includes('const environmentContinuityChecks = Array.isArray(production.environmentContinuityChecks)')),
  () => assert(qualitySource.includes('cartoon_environment_continuity_missing')),
  () => assert(qualitySource.includes('cartoon_environment_continuity_rejected')),
  () => assert(qualitySource.includes('environmentContinuity: [...latestEnvironmentContinuity.entries()]')),
  () => assert(qualitySource.includes("environmentPropPresenceMode: 'prompt-contract-only'")),
  () => assert(dashboardSource.includes('function renderEnvironmentContinuity(item)')),
  () => assert(dashboardSource.includes('semantic object presence is not claimed without a vision detector')),
  () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_ENABLED=true')),
  () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_REQUIRE_MASTER=true')),
  () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_MIN_SCORE=0.42')),
  () => assert(envSource.includes('ENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE=1')),
  () => assert.strictEqual(pkg.scripts['test:environment-continuity'], 'node ../bootstrap/verify-phase11-environment-continuity.js')
];

async function runtimeChecks() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-7-6-'));
  let count = 0;
  try {
    const masterPath = path.join(temp, 'master.png');
    const candidatePath = path.join(temp, 'candidate.png');
    const driftPath = path.join(temp, 'drift.png');
    const furnitureSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="30" y="95" width="105" height="50" fill="#d8c7a1"/><rect x="165" y="110" width="75" height="24" fill="#6d4728"/><rect x="255" y="28" width="42" height="92" fill="#f3d98b"/></svg>');
    await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 125, g: 91, b: 58 } } }).composite([{ input: furnitureSvg, top: 0, left: 0 }]).png().toFile(masterPath);
    await fsp.copyFile(masterPath, candidatePath);
    await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 245, g: 248, b: 250 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><circle cx="160" cy="90" r="60" fill="#9ed8ff"/></svg>'), top: 0, left: 0 }]).png().toFile(driftPath);

    const master = { environmentId: environment.environmentId, status: 'ready', canonical: true, masterFramePath: masterPath, assetSha256: 'master-sha-fixture' };
    const db = new FakeDb(master);
    const validator = new EnvironmentContinuityValidatorV11(db, { logger, threshold: 0.42, requireMaster: true, minPropPromptCoverage: 1 });

    const context = await validator.assertSceneReady('prod', 'scene_house');
    assert.strictEqual(context.masterReady, true); count += 1;

    const signature = await imageSignature(masterPath);
    assert.strictEqual(signature.grid.length, 48); assert.strictEqual(signature.dhash.length, 64); assert(Number.isFinite(signature.edgeDensity)); count += 1;

    const good = await validator.evaluate({ productionId: 'prod', sceneId: 'scene_house', keyframe: { id: 'kf_good', shotId: 'shot_good', prompt: 'keep the sofa and coffee table in the wooden room' }, assetPath: candidatePath });
    assert.strictEqual(good.accepted, true); assert(good.score > 0.99); assert.strictEqual(good.metrics.semanticPropPresenceVerified, false); count += 1;

    assert(db.checks.some(item => item.keyframeId === 'kf_good' && item.status === 'accepted')); count += 1;

    const strict = new EnvironmentContinuityValidatorV11(new FakeDb(master), { logger, threshold: 0.75, requireMaster: true, minPropPromptCoverage: 1 });
    const drift = await strict.evaluate({ productionId: 'prod', sceneId: 'scene_house', keyframe: { id: 'kf_drift', shotId: 'shot_drift', prompt: 'sofa coffee table' }, assetPath: driftPath });
    assert.strictEqual(drift.accepted, false); assert(drift.reasons.includes('ENVIRONMENT_SCORE_BELOW_THRESHOLD')); count += 1;

    const missingProp = await validator.evaluate({ productionId: 'prod', sceneId: 'scene_house', keyframe: { id: 'kf_missing_prop', shotId: 'shot_missing_prop', prompt: 'sofa only' }, assetPath: candidatePath });
    assert.strictEqual(missingProp.accepted, false); assert(missingProp.missingPropLockIds.includes('prop_table')); count += 1;

    const missingMaster = new EnvironmentContinuityValidatorV11(new FakeDb(null), { logger, requireMaster: true });
    await assert.rejects(() => missingMaster.assertSceneReady('prod', 'scene_house'), error => error.code === 'ENVIRONMENT_MASTER_REQUIRED'); count += 1;

    const unresolvedDb = new FakeDb(master); unresolvedDb.mapping = { sceneId: 'scene_house', environmentId: null, status: 'unresolved' };
    const unresolved = new EnvironmentContinuityValidatorV11(unresolvedDb, { logger, requireMaster: true });
    await assert.rejects(() => unresolved.assertSceneReady('prod', 'scene_house'), error => error.code === 'ENVIRONMENT_MAPPING_REQUIRED'); count += 1;

    const optional = new EnvironmentContinuityValidatorV11(new FakeDb(null), { logger, requireMaster: false });
    const skipped = await optional.evaluate({ productionId: 'prod', sceneId: 'scene_house', keyframe: { id: 'kf_optional', shotId: 'shot_optional', prompt: 'sofa coffee table' }, assetPath: candidatePath });
    assert.strictEqual(skipped.accepted, true); assert.strictEqual(skipped.status, 'skipped_no_master'); count += 1;

    return count;
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}

(async () => {
  for (const fn of staticChecks) await fn();
  const runtimeCount = await runtimeChecks();
  console.log(`Phase 11.7.6 Environment Continuity OK: ${staticChecks.length + runtimeCount} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
