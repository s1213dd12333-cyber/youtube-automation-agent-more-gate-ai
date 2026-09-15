'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'semantic-prop-verifier-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.8 runtime is not materialized: utils/semantic-prop-verifier-v11.js');

const {
  SEMANTIC_PROP_VERIFIER_VERSION,
  SemanticPropVerifierV11,
  buildSemanticPrompt,
  normalizeSemanticResponse,
  requiredLocks,
  extractJson
} = require(runtimePath);

const environment = {
  environmentId: 'env_house_fixture',
  name: 'Wooden Family House',
  category: 'house',
  construction: 'natural wood construction',
  architecturalStyle: 'cozy rustic family home',
  layout: 'living room connected to compact kitchen',
  materials: ['natural wood', 'soft fabric'],
  palette: ['warm brown', 'beige', 'cream']
};
const mapping = { environmentId: environment.environmentId, zone: 'living_room' };
const locks = [
  { id: 'prop_sofa', name: 'sofa', type: 'furniture', required: true, lockedAttributes: { color: 'beige', material: 'soft fabric' } },
  { id: 'prop_table', name: 'coffee table', type: 'furniture', required: true, lockedAttributes: { color: null, material: 'natural wood' } },
  { id: 'prop_vase', name: 'vase', type: 'prop', required: false, lockedAttributes: {} }
];
const goodPayload = {
  environmentMatches: true,
  layoutConsistent: true,
  confidence: 0.91,
  props: [
    { id: 'prop_sofa', name: 'sofa', present: true, confidence: 0.94, colorMatches: true, materialMatches: true, notes: 'beige sofa visibly present' },
    { id: 'prop_table', name: 'coffee table', present: true, confidence: 0.90, colorMatches: null, materialMatches: true, notes: 'wooden coffee table visibly present' }
  ],
  notes: 'same wooden living room identity'
};

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const prompt = buildSemanticPrompt(environment, mapping, locks);
const normalized = normalizeSemanticResponse(goodPayload, locks, 0.72);

check('version is 11.8', () => assert.strictEqual(SEMANTIC_PROP_VERIFIER_VERSION, '11.8'));
check('requiredLocks excludes optional props', () => assert.deepStrictEqual(requiredLocks(locks).map(item => item.id), ['prop_sofa', 'prop_table']));
check('prompt names Phase 11.8', () => assert(prompt.includes('SEMANTIC PROP & LAYOUT VERIFICATION V11.8')));
check('prompt carries persistent Environment ID', () => assert(prompt.includes('env_house_fixture')));
check('prompt carries scene zone', () => assert(prompt.includes('living_room')));
check('prompt carries sofa ID', () => assert(prompt.includes('prop_sofa')));
check('prompt carries locked beige color', () => assert(prompt.includes('beige')));
check('prompt explicitly forbids invisible-object inference', () => assert(prompt.includes('Do not infer invisible objects')));
check('prompt demands JSON contract', () => assert(prompt.includes('Return ONLY one JSON object')));
check('good structured response is contract-valid', () => assert.strictEqual(normalized.contractValid, true));
check('good structured response verifies prop presence', () => assert.strictEqual(normalized.semanticPropPresenceVerified, true));
check('good structured response preserves environment match', () => assert.strictEqual(normalized.environmentMatches, true));
check('good structured response preserves layout match', () => assert.strictEqual(normalized.layoutConsistent, true));
check('good structured response has no missing props', () => assert.deepStrictEqual(normalized.missingPropLockIds, []));
check('good structured response has no attribute mismatches', () => assert.deepStrictEqual(normalized.mismatchedPropLockIds, []));
check('missing required prop fails semantic verification', () => {
  const payload = JSON.parse(JSON.stringify(goodPayload));
  payload.props = payload.props.filter(item => item.id !== 'prop_table');
  assert.strictEqual(normalizeSemanticResponse(payload, locks, 0.72).semanticPropPresenceVerified, false);
});
check('low-confidence required prop fails semantic verification', () => {
  const payload = JSON.parse(JSON.stringify(goodPayload));
  payload.props[0].confidence = 0.4;
  assert.strictEqual(normalizeSemanticResponse(payload, locks, 0.72).semanticPropPresenceVerified, false);
});
check('locked color mismatch fails semantic verification', () => {
  const payload = JSON.parse(JSON.stringify(goodPayload));
  payload.props[0].colorMatches = false;
  assert.strictEqual(normalizeSemanticResponse(payload, locks, 0.72).semanticPropPresenceVerified, false);
});
check('locked material mismatch fails semantic verification', () => {
  const payload = JSON.parse(JSON.stringify(goodPayload));
  payload.props[1].materialMatches = false;
  assert.strictEqual(normalizeSemanticResponse(payload, locks, 0.72).semanticPropPresenceVerified, false);
});
check('layout mismatch fails semantic verification', () => {
  const payload = { ...goodPayload, layoutConsistent: false };
  assert.strictEqual(normalizeSemanticResponse(payload, locks, 0.72).semanticPropPresenceVerified, false);
});
check('environment mismatch fails semantic verification', () => {
  const payload = { ...goodPayload, environmentMatches: false };
  assert.strictEqual(normalizeSemanticResponse(payload, locks, 0.72).semanticPropPresenceVerified, false);
});
check('invalid response cannot create semantic truth', () => assert.strictEqual(normalizeSemanticResponse({ props: [] }, locks, 0.72).semanticPropPresenceVerified, false));
check('extractJson handles fenced JSON', () => assert.deepStrictEqual(extractJson('```json\n{"ok":true}\n```'), { ok: true }));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const continuitySource = fs.readFileSync(path.join(upstream, 'utils', 'environment-continuity-validator-v11.js'), 'utf8');
const qualitySource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-quality-gate-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns semantic_prop_checks', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS semantic_prop_checks')));
check('database persists semantic prop checks', () => assert(dbSource.includes('async saveSemanticPropCheck(input = {})')));
check('database can load latest semantic prop check', () => assert(dbSource.includes('async getLatestSemanticPropCheck(productionId, keyframeId)')));
check('database lists semantic prop checks', () => assert(dbSource.includes('async listSemanticPropChecks(productionId)')));
check('production bundle exposes semanticPropChecks', () => assert(dbSource.includes('const semanticPropChecks = await this.listSemanticPropChecks(productionId);') && dbSource.includes('semanticPropChecks,')));
check('scene pipeline imports SemanticPropVerifier', () => assert(pipelineSource.includes("const { SemanticPropVerifierV11 } = require('./semantic-prop-verifier-v11');")));
check('scene pipeline constructs SemanticPropVerifier', () => assert(pipelineSource.includes('this.semanticPropVerifier = options.semanticPropVerifier || new SemanticPropVerifierV11')));
check('Environment Continuity receives SemanticPropVerifier', () => assert(pipelineSource.includes('semanticPropVerifier: this.semanticPropVerifier')));
check('Environment Continuity owns semantic required flag', () => assert(continuitySource.includes("SEMANTIC_PROP_REQUIRE_VERIFICATION")));
check('Environment Continuity calls real semantic verifier', () => assert(continuitySource.includes('await this.semanticPropVerifier.verify({')));
check('Environment Continuity exposes vision-verified mode', () => assert(continuitySource.includes("'vision-verified'")));
check('Environment Continuity persists semantic truth from metrics', () => assert(continuitySource.includes('result.metrics?.semanticPropPresenceVerified === true')));
check('Cartoon Quality loads semantic prop checks', () => assert(qualitySource.includes('production.semanticPropChecks')));
check('Cartoon Quality has semantic latest-decision helper', () => assert(qualitySource.includes('function latestSemanticPropByKeyframe')));
check('Cartoon Quality can fail closed when semantic verification is required', () => assert(qualitySource.includes('SEMANTIC_PROP_REQUIRE_VERIFICATION')));
check('Cartoon Quality blocks missing required semantic evidence', () => assert(qualitySource.includes('cartoon_semantic_prop_missing')));
check('Cartoon Quality blocks rejected required semantic evidence', () => assert(qualitySource.includes('cartoon_semantic_prop_rejected')));
check('Cartoon Quality fingerprints semantic decisions', () => assert(qualitySource.includes('semanticPropChecks: [...latestSemanticProp.entries()]')));
check('dashboard renders Semantic Prop panel', () => assert(dashboardSource.includes('SEMANTIC PROP & LAYOUT V11.8')));
check('dashboard truthfully explains vision evidence', () => assert(dashboardSource.includes('real semantic vision evidence')));
check('semantic verification enabled by default', () => assert(envSource.includes('SEMANTIC_PROP_VERIFICATION_ENABLED=true')));
check('semantic fail-closed mode defaults off until provider is configured', () => assert(envSource.includes('SEMANTIC_PROP_REQUIRE_VERIFICATION=false')));
check('semantic confidence threshold is explicit', () => assert(envSource.includes('SEMANTIC_PROP_MIN_CONFIDENCE=0.72')));
check('vision base URL is configurable', () => assert(envSource.includes('SEMANTIC_PROP_VISION_BASE_URL=')));
check('vision model is configurable', () => assert(envSource.includes('SEMANTIC_PROP_VISION_MODEL=')));
check('package exposes semantic prop test', () => assert.strictEqual(pkg.scripts['test:semantic-props'], 'node ../bootstrap/verify-phase11-semantic-prop-verification.js'));

async function runtimeChecks() {
  const tempDir = path.join(upstream, 'data', `test-semantic-props-${process.pid}-${Date.now()}`);
  await fsp.mkdir(tempDir, { recursive: true });
  const assetPath = path.join(tempDir, 'frame.png');
  await fsp.writeFile(assetPath, Buffer.from('semantic-verifier-fixture'));

  const saved = [];
  const fakeDb = {
    async saveSemanticPropCheck(result) { saved.push({ ...result }); return { ...result }; }
  };
  const keyframe = { id: 'kf_fixture', sceneId: 'scene_fixture', shotId: 'shot_fixture' };

  const unavailable = await new SemanticPropVerifierV11(fakeDb, { enabled: true, baseURL: '', model: '' }).verify({
    productionId: 'prod_fixture', sceneId: 'scene_fixture', shotId: 'shot_fixture', keyframe, assetPath, environment, mapping, propLocks: locks
  });
  check('unconfigured provider stays unavailable', () => assert.strictEqual(unavailable.status, 'unavailable'));
  check('unconfigured provider never claims semantic verification', () => assert.strictEqual(unavailable.semanticPropPresenceVerified, false));
  check('unconfigured provider records providerUsed=false', () => assert.strictEqual(unavailable.providerUsed, false));

  const goodVerifier = new SemanticPropVerifierV11(fakeDb, { enabled: true, minConfidence: 0.72, analyzer: async () => goodPayload });
  const verified = await goodVerifier.verify({
    productionId: 'prod_fixture', sceneId: 'scene_fixture', shotId: 'shot_fixture', keyframe, assetPath, environment, mapping, propLocks: locks
  });
  check('injected vision analyzer can verify visible props', () => assert.strictEqual(verified.status, 'verified'));
  check('verified result sets semanticPropPresenceVerified=true', () => assert.strictEqual(verified.semanticPropPresenceVerified, true));
  check('verified result records providerUsed=true', () => assert.strictEqual(verified.providerUsed, true));
  check('verified result has response fingerprint', () => assert(/^[a-f0-9]{64}$/.test(verified.responseFingerprint)));

  const rejectedVerifier = new SemanticPropVerifierV11(fakeDb, { enabled: true, minConfidence: 0.72, analyzer: async () => ({ ...goodPayload, layoutConsistent: false }) });
  const rejected = await rejectedVerifier.verify({
    productionId: 'prod_fixture', sceneId: 'scene_fixture', shotId: 'shot_fixture', keyframe, assetPath, environment, mapping, propLocks: locks
  });
  check('layout mismatch produces rejected status', () => assert.strictEqual(rejected.status, 'rejected'));
  check('layout mismatch never claims semantic verification', () => assert.strictEqual(rejected.semanticPropPresenceVerified, false));
  check('semantic decisions are persisted', () => assert(saved.length >= 3));

  await fsp.rm(tempDir, { recursive: true, force: true });
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.8 Semantic Prop Verification OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
