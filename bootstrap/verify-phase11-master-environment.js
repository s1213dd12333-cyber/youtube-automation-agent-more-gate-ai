'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'master-environment-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.7.3 runtime is not materialized: utils/master-environment-v11.js');

const {
  MASTER_ENVIRONMENT_VERSION,
  MasterEnvironmentGeneratorV11,
  buildMasterPrompt,
  planMasterFrame,
  locksForEnvironment,
  isGenericLocalFallback
} = require(runtimePath);

const environment = {
  environmentId: 'env_house_fixture',
  fingerprint: 'env-fixture-fingerprint',
  name: 'Wooden Family House',
  category: 'house',
  description: 'a furnished wooden house with a beige sofa, rustic wooden coffee table, bookshelf and large window',
  construction: 'natural wood construction',
  architecturalStyle: 'cozy rustic family home',
  materials: ['natural wood', 'soft fabric'],
  palette: ['warm natural brown', 'beige', 'cream'],
  lighting: 'warm soft daylight',
  layout: 'stable readable domestic layout',
  signatureElements: ['sofa', 'coffee table', 'bookshelf', 'window'],
  forbiddenChanges: ['do not redesign the room layout'],
  masterFramePath: null
};
const environmentBible = {
  version: '11.7.1', productionId: 'prod_master_fixture', fingerprint: 'bible-fixture', environments: [environment]
};
const propLocks = [
  {
    id: 'prop_sofa', environmentId: environment.environmentId, name: 'sofa', type: 'furniture', required: true,
    continuityPriority: 'critical', fingerprint: 'lock-sofa', lockedAttributes: { color: 'beige', material: 'soft fabric', silhouette: 'stable sofa form', relativePlacement: 'preserve room relationship' },
    forbiddenChanges: ['do not replace sofa']
  },
  {
    id: 'prop_table', environmentId: environment.environmentId, name: 'coffee table', type: 'furniture', required: true,
    continuityPriority: 'critical', fingerprint: 'lock-table', lockedAttributes: { color: null, material: 'natural wood', silhouette: 'stable table form', relativePlacement: 'preserve room relationship' },
    forbiddenChanges: ['do not replace coffee table']
  }
];
const production = { id: 'prod_master_fixture' };
const prompt = buildMasterPrompt(environment, propLocks);
const planA = planMasterFrame(production, environment, propLocks);
const planB = planMasterFrame(production, environment, propLocks);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('Master Environment version is 11.7.3', () => assert.strictEqual(MASTER_ENVIRONMENT_VERSION, '11.7.3'));
check('master prompt names canonical purpose', () => assert(prompt.includes('MASTER ENVIRONMENT FRAME V11.7.3')));
check('master prompt carries Environment ID', () => assert(prompt.includes(environment.environmentId)));
check('master prompt carries wooden construction', () => assert(prompt.includes('natural wood construction')));
check('master prompt carries required sofa', () => assert(prompt.includes('PROP LOCK: sofa')));
check('master prompt carries required coffee table', () => assert(prompt.includes('PROP LOCK: coffee table')));
check('master prompt requests wide establishing composition', () => assert(prompt.includes('wide establishing view')));
check('master prompt excludes characters', () => assert(prompt.includes('no characters, people, animals')));
check('master prompt requires one clean 16:9 image', () => assert(prompt.includes('one clean 16:9 canonical environment image')));
check('master plan is deterministic', () => assert.strictEqual(planA.promptFingerprint, planB.promptFingerprint));
check('planned frame starts non-canonical', () => assert.strictEqual(planA.canonical, false));
check('planned frame has no fabricated path', () => assert.strictEqual(planA.masterFramePath, null));
check('locksForEnvironment filters correctly', () => assert.strictEqual(locksForEnvironment([...propLocks, { environmentId: 'other' }], environment.environmentId).length, 2));
check('visual_local filename is generic fallback', () => assert.strictEqual(isGenericLocalFallback('C:/tmp/visual_local_123.png'), true));
check('provider-looking filename is not generic fallback', () => assert.strictEqual(isGenericLocalFallback('C:/tmp/provider_master.png'), false));
check('historical Gemini breaker cannot misclassify an asset emitted by another provider', () => {
  const generatorState = { geminiImageDisabledReason: 'Gemini quota zero' };
  assert.strictEqual(isGenericLocalFallback('C:/tmp/openai_master.png', generatorState), false);
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns environment master frames', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS environment_master_frames')));
check('database persists master frames', () => assert(dbSource.includes('async saveEnvironmentMasterFrame(frame = {})')));
check('database gets latest master frame', () => assert(dbSource.includes('async getLatestEnvironmentMasterFrame(productionId, environmentId)')));
check('database lists latest master frames', () => assert(dbSource.includes('async listEnvironmentMasterFrames(productionId)')));
check('database records truthful prop reference status', () => assert(dbSource.includes("placement_status = 'master_reference_ready_unverified'")));
check('production bundle exposes master frames', () => assert(dbSource.includes('const environmentMasterFrames = await this.listEnvironmentMasterFrames(productionId);') && dbSource.includes('environmentMasterFrames,')));
check('scene pipeline imports Master Environment runtime', () => assert(pipelineSource.includes("const { MasterEnvironmentGeneratorV11 } = require('./master-environment-v11');")));
check('scene pipeline constructs Master Environment generator', () => assert(pipelineSource.includes('this.masterEnvironment = options.masterEnvironment || new MasterEnvironmentGeneratorV11')));
check('scene pipeline generates environment frames', () => assert(pipelineSource.includes('this.masterEnvironment.ensureProductionFrames(production, environmentBible, masterLocks)')));
check('Review Studio renders master frames', () => assert(dashboardSource.includes('function renderMasterEnvironmentFrames(item)')));
check('Review Studio distinguishes noncanonical generic fallback', () => assert(dashboardSource.includes('GENERIC FALLBACK — NOT CANONICAL')));
check('package exposes master environment test', () => assert.strictEqual(pkg.scripts['test:master-environment'], 'node ../bootstrap/verify-phase11-master-environment.js'));
check('master generation enabled in env example', () => assert(envSource.includes('MASTER_ENVIRONMENT_GENERATION_ENABLED=true')));
check('provider-backed canonical reference is required by default', () => assert(envSource.includes('MASTER_ENVIRONMENT_REQUIRE_PROVIDER=true')));

async function runtimeChecks() {
  const tempRoot = path.join(upstream, 'data', `test-master-environment-${process.pid}-${Date.now()}`);
  await fsp.mkdir(tempRoot, { recursive: true });
  const providerAsset = path.join(tempRoot, 'provider_master.svg');
  const localAsset = path.join(tempRoot, 'visual_local_fixture.svg');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#8b6f47"/><rect x="40" y="90" width="90" height="45" fill="#d8c8a8"/><rect x="155" y="105" width="70" height="25" fill="#6b4b2a"/></svg>';
  await fsp.writeFile(providerAsset, svg, 'utf8');
  await fsp.writeFile(localAsset, svg, 'utf8');

  const records = new Map();
  let anchorCalls = 0;
  const fakeDb = {
    async getLatestEnvironmentMasterFrame(productionId, environmentId) { return records.get(`${productionId}:${environmentId}`) || null; },
    async saveEnvironmentMasterFrame(frame) { records.set(`${frame.productionId}:${frame.environmentId}`, { ...frame }); return { ...frame }; },
    async markPropLocksMasterReference() { anchorCalls += 1; }
  };
  const providerGenerator = { async generateVisualAssets() { return [providerAsset]; } };
  const providerService = new MasterEnvironmentGeneratorV11(fakeDb, providerGenerator, { dataRoot: tempRoot, requireProvider: true, enabled: true });
  const providerResult = await providerService.ensureProductionFrames(production, environmentBible, propLocks);
  const ready = providerResult.frames[0];
  const readyExistsBeforeCleanup = Boolean(ready.masterFramePath && fs.existsSync(ready.masterFramePath));
  const anchorCallsBeforeReuse = anchorCalls;
  const reused = await providerService.ensureEnvironmentFrame(production, environment, propLocks);
  const anchorCallsAfterReuse = anchorCalls;

  check('provider frame becomes canonical', () => assert.strictEqual(ready.canonical, true));
  check('provider frame becomes ready', () => assert.strictEqual(ready.status, 'ready'));
  check('canonical master frame is persisted on disk before test cleanup', () => assert.strictEqual(readyExistsBeforeCleanup, true));
  check('canonical master frame has SHA-256 evidence', () => assert(/^[a-f0-9]{64}$/.test(ready.assetSha256)));
  check('canonical master frame records image dimensions', () => assert.strictEqual(ready.width, 320));
  check('canonical master frame anchors prop reference state once', () => assert.strictEqual(anchorCallsBeforeReuse, 1));
  check('provider frame can be reused deterministically', () => {
    assert.strictEqual(reused.reused, true);
    assert.strictEqual(anchorCallsAfterReuse, anchorCallsBeforeReuse);
  });

  const fallbackRecords = new Map();
  let fallbackAnchorCalls = 0;
  const fallbackDb = {
    async getLatestEnvironmentMasterFrame() { return null; },
    async saveEnvironmentMasterFrame(frame) { fallbackRecords.set(frame.environmentId, { ...frame }); return { ...frame }; },
    async markPropLocksMasterReference() { fallbackAnchorCalls += 1; }
  };
  const fallbackGenerator = { async generateVisualAssets() { return [localAsset]; } };
  const fallbackService = new MasterEnvironmentGeneratorV11(fallbackDb, fallbackGenerator, { dataRoot: tempRoot, requireProvider: true, enabled: true });
  const fallback = (await fallbackService.ensureProductionFrames(production, environmentBible, propLocks)).frames[0];
  check('generic local fallback is rejected as canonical', () => assert.strictEqual(fallback.canonical, false));
  check('generic local fallback is marked fallback_unanchored', () => assert.strictEqual(fallback.status, 'fallback_unanchored'));
  check('generic local fallback does not fabricate master path', () => assert.strictEqual(fallback.masterFramePath, null));
  check('generic local fallback does not anchor prop placement', () => assert.strictEqual(fallbackAnchorCalls, 0));
  check('generic fallback candidate remains auditable', () => assert.strictEqual(fallback.candidatePath, localAsset));

  await fsp.rm(tempRoot, { recursive: true, force: true });
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.7.3 Master Environment OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
