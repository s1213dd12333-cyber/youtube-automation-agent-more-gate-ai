'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cross-video-object-continuity-gate-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.6 runtime is not materialized');
const {
  CROSS_VIDEO_OBJECT_CONTINUITY_VERSION,
  CrossVideoObjectContinuityGateV11,
  visibleBindings,
  stateSummary,
  buildObjectContinuityPrompt,
  normalizeVisionResponse,
  visionDecision,
  extractJson,
  mimeForPath
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.10.6', () => assert.strictEqual(CROSS_VIDEO_OBJECT_CONTINUITY_VERSION, '11.10.6'));
check('visible bindings include visible', () => assert.strictEqual(visibleBindings([{ status: 'resolved', objectId: 'o', visibility: 'visible' }]).length, 1));
check('visible bindings include occluded', () => assert.strictEqual(visibleBindings([{ status: 'resolved', objectId: 'o', visibility: 'occluded' }]).length, 1));
check('visible bindings exclude offscreen', () => assert.strictEqual(visibleBindings([{ status: 'resolved', objectId: 'o', visibility: 'offscreen' }]).length, 0));
check('visible bindings exclude mentioned', () => assert.strictEqual(visibleBindings([{ status: 'resolved', objectId: 'o', visibility: 'mentioned' }]).length, 0));
check('visible bindings exclude conflicts', () => assert.strictEqual(visibleBindings([{ status: 'conflict', objectId: 'o', visibility: 'visible' }]).length, 0));
check('state summary detects damage', () => assert(stateSummary({ status: 'active', damage: ['dent'] }).appearanceChangeExpected));
check('state summary neutral does not invent change', () => assert.strictEqual(stateSummary({ status: 'neutral' }).appearanceChangeExpected, false));
const prompt = buildObjectContinuityPrompt({ object: { id: 'o', objectKey: 'car', displayName: 'Family Car', canonicalIdentity: { color: 'red', material: 'metal' } }, binding: { visibility: 'visible' }, state: { status: 'active', damage: ['rear dent'] }, canonicalAsset: { assetSha256: 'abc' } });
check('prompt identifies two image roles', () => assert(prompt.includes('IMAGE 1') && prompt.includes('IMAGE 2')));
check('prompt ignores camera/background as identity mismatch', () => assert(prompt.includes('Do not compare scene composition')));
check('prompt includes lifecycle allowance', () => assert(prompt.includes('Lifecycle state may legitimately change')));
check('prompt includes object id', () => assert(prompt.includes('OBJECT ID: o')));
check('prompt includes canonical asset hash', () => assert(prompt.includes('abc')));
check('vision response validates good contract', () => assert(normalizeVisionResponse({ objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: true, confidence: .9, identityMismatches: [] }).contractValid));
check('vision response rejects malformed contract', () => assert.strictEqual(normalizeVisionResponse({ objectPresent: true }).contractValid, false));
check('explicit missing object blocks non-strict mode', () => assert.strictEqual(visionDecision(normalizeVisionResponse({ objectPresent: false, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: null, confidence: .9, identityMismatches: [] }), { requireVision: false, requiredBinding: true, minConfidence: .72 }).accepted, false));
check('explicit replacement blocks', () => assert(visionDecision(normalizeVisionResponse({ objectPresent: true, sameCanonicalObject: false, canonicalIdentityConsistent: false, stateConsistent: null, confidence: .9, identityMismatches: ['different grille'] }), { requireVision: false, requiredBinding: true, minConfidence: .72 }).reasons.includes('CROSS_VIDEO_OBJECT_REPLACED')));
check('state mismatch blocks', () => assert(visionDecision(normalizeVisionResponse({ objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: false, confidence: .9, identityMismatches: [] }), { requireVision: false, requiredBinding: true, minConfidence: .72 }).reasons.includes('CROSS_VIDEO_OBJECT_STATE_DRIFT')));
check('low confidence non-strict accepts unverified', () => assert.strictEqual(visionDecision(normalizeVisionResponse({ objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: true, confidence: .51, identityMismatches: [] }), { requireVision: false, requiredBinding: true, minConfidence: .72 }).accepted, true));
check('low confidence strict blocks', () => assert.strictEqual(visionDecision(normalizeVisionResponse({ objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: true, confidence: .51, identityMismatches: [] }), { requireVision: true, requiredBinding: true, minConfidence: .72 }).accepted, false));
check('extractJson handles fenced response', () => assert.strictEqual(extractJson('```json\n{"a":1}\n```').a, 1));
check('mime maps webp', () => assert.strictEqual(mimeForPath('/tmp/a.webp'), 'image/webp'));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns object continuity table', dbSource, 'CREATE TABLE IF NOT EXISTS cross_video_object_continuity_checks'],
  ['table binds keyframe', dbSource, 'FOREIGN KEY (keyframe_id) REFERENCES shot_keyframes(id) ON DELETE CASCADE'],
  ['table binds object binding', dbSource, 'FOREIGN KEY (binding_id) REFERENCES persistent_world_object_bindings(id) ON DELETE SET NULL'],
  ['table binds canonical asset', dbSource, 'FOREIGN KEY (canonical_asset_id) REFERENCES persistent_world_object_assets(id) ON DELETE SET NULL'],
  ['table binds lifecycle state', dbSource, 'FOREIGN KEY (state_id) REFERENCES persistent_world_object_states(id) ON DELETE SET NULL'],
  ['database saves object continuity check', dbSource, 'async saveCrossVideoObjectContinuityCheck(input = {})'],
  ['database reads latest object continuity check', dbSource, 'async getLatestCrossVideoObjectContinuityCheck(productionId, keyframeId, objectId = null)'],
  ['database lists object continuity checks', dbSource, 'async listCrossVideoObjectContinuityChecks(productionId)'],
  ['bundle loads object continuity checks', dbSource, 'const crossVideoObjectContinuityChecks = await this.listCrossVideoObjectContinuityChecks(productionId);'],
  ['bundle exposes object continuity checks', dbSource, 'crossVideoObjectContinuityChecks,'],
  ['scene pipeline imports object gate', pipelineSource, "CrossVideoObjectContinuityGateV11 } = require('./cross-video-object-continuity-gate-v11')"],
  ['scene pipeline constructs object gate', pipelineSource, 'this.crossVideoObjectContinuityGate = options.crossVideoObjectContinuityGate || new CrossVideoObjectContinuityGateV11'],
  ['scene pipeline passes object gate to keyframes', pipelineSource, 'crossVideoObjectContinuityGate: this.crossVideoObjectContinuityGate'],
  ['keyframe runtime receives object gate', keyframeSource, 'this.crossVideoObjectContinuityGate = options.crossVideoObjectContinuityGate || null;'],
  ['keyframe runtime evaluates object gate', keyframeSource, 'this.crossVideoObjectContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })'],
  ['keyframe runtime blocks object drift', keyframeSource, "status: 'cross_video_object_continuity_failed'"],
  ['keyframe runtime exposes object error code', keyframeSource, "crossVideoObjectError.code = 'CROSS_VIDEO_OBJECT_CONTINUITY_FAILED'"],
  ['dashboard exposes object continuity panel', dashboardSource, 'CROSS-VIDEO OBJECT CONTINUITY GATE V11.10.6'],
  ['dashboard says only visible bindings evaluated', dashboardSource, 'Only resolved visible/occluded bindings are evaluated'],
  ['env enables object continuity', envSource, 'CROSS_VIDEO_OBJECT_CONTINUITY_ENABLED=true'],
  ['env requires canonical asset', envSource, 'CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_CANONICAL_ASSET=true'],
  ['env defaults non-strict vision', envSource, 'CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_VISION=false'],
  ['env sets confidence', envSource, 'CROSS_VIDEO_OBJECT_CONTINUITY_MIN_CONFIDENCE=0.72'],
  ['env documents semantic provider fallback', envSource, 'the gate reuses SEMANTIC_PROP_VISION_* provider settings']
]) check(name, () => assert(source.includes(token)));
check('package exposes object continuity verifier', () => assert.strictEqual(pkg.scripts['test:cross-video-object-continuity'], 'node ../bootstrap/verify-phase11-cross-video-object-continuity.js'));
check('object gate runs before ready status', () => assert(keyframeSource.indexOf('this.crossVideoObjectContinuityGate.evaluate') < keyframeSource.indexOf("status: 'ready'")));
check('location gate remains before object gate', () => assert(keyframeSource.indexOf('this.crossVideoContinuityGate.evaluate') < keyframeSource.indexOf('this.crossVideoObjectContinuityGate.evaluate')));

async function runtimeChecks() {
  const dir = path.join(__dirname, '.tmp-object-continuity');
  fs.mkdirSync(dir, { recursive: true });
  const referencePath = path.join(dir, 'reference.png');
  const candidatePath = path.join(dir, 'candidate.png');
  fs.writeFileSync(referencePath, Buffer.from('canonical-object-reference'));
  fs.writeFileSync(candidatePath, Buffer.from('generated-scene'));
  const saved = [];
  const objects = {
    origin: { id: 'origin', objectKey: 'origin_car', displayName: 'Origin Car', objectType: 'vehicle', createdFromProductionId: 'video_b', canonicalIdentity: { color: 'blue', material: 'metal' } },
    reused: { id: 'reused', objectKey: 'family_car', displayName: 'Family Car', objectType: 'vehicle', createdFromProductionId: 'video_a', canonicalIdentity: { color: 'red', material: 'metal', silhouette: 'compact wagon' } },
    missing_asset: { id: 'missing_asset', objectKey: 'missing_car', displayName: 'Missing Asset Car', objectType: 'vehicle', createdFromProductionId: 'video_a', canonicalIdentity: {} }
  };
  const assets = {
    reused: { id: 'asset_reused', objectId: 'reused', assetRole: 'object_reference', status: 'ready', canonical: true, assetPath: referencePath, assetSha256: 'sha_ref', sourceProductionId: 'video_a' }
  };
  const states = {
    state_reused: { id: 'state_reused', objectId: 'reused', productionId: 'video_b', status: 'active', damage: ['rear dent'], stateFingerprint: 'state_fp' }
  };
  let currentBindings = [];
  const db = {
    async listShotPersistentWorldObjectBindings() { return currentBindings; },
    async getPersistentWorldObject(id) { return objects[id] || null; },
    async getPersistentWorldObjectAsset(id) { return Object.values(assets).find(item => item.id === id) || null; },
    async getPersistentWorldObjectAssetByObject(id) { return assets[id] || null; },
    async getPersistentWorldObjectState(id) { return states[id] || null; },
    async saveCrossVideoObjectContinuityCheck(row) { saved.push({ ...row }); return row; }
  };
  const input = { productionId: 'video_b', sceneId: 'scene_1', keyframe: { id: 'kf_1', shotId: 'shot_1' }, assetPath: candidatePath, attempt: 0 };

  const goodPayload = { objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: true, confidence: .94, identityMismatches: [], notes: 'same red wagon with allowed rear dent' };
  const gate = new CrossVideoObjectContinuityGateV11(db, { analyzer: async () => goodPayload, requireVision: false, pathExists: async p => fs.existsSync(p) });

  currentBindings = [{ id: 'bind_origin', productionId: 'video_b', sceneId: 'scene_1', shotId: 'shot_1', objectId: 'origin', status: 'resolved', visibility: 'visible', required: true }];
  let result = await gate.evaluate(input);
  check('origin production object accepted without cross-video compare', () => assert.strictEqual(result.accepted, true));
  check('origin production recorded', () => assert(saved.some(row => row.objectId === 'origin' && row.status === 'origin_production')));

  currentBindings = [{ id: 'bind_reused', productionId: 'video_b', sceneId: 'scene_1', shotId: 'shot_1', objectId: 'reused', status: 'resolved', visibility: 'visible', required: true, stateId: 'state_reused', stateFingerprint: 'state_fp', canonicalAssetId: 'asset_reused', canonicalAssetSha256: 'sha_ref' }];
  result = await gate.evaluate(input);
  check('reused canonical object accepted with good vision evidence', () => assert.strictEqual(result.accepted, true));
  check('reused summary counts reused object', () => assert.strictEqual(result.summary.reused, 1));
  check('accepted check persisted provider evidence', () => assert(saved.some(row => row.objectId === 'reused' && row.providerUsed === true && row.visionConfidence > .9)));
  check('accepted check persisted lifecycle state', () => assert(saved.some(row => row.objectId === 'reused' && row.stateFingerprint === 'state_fp')));

  const replacementGate = new CrossVideoObjectContinuityGateV11(db, { analyzer: async () => ({ objectPresent: true, sameCanonicalObject: false, canonicalIdentityConsistent: false, stateConsistent: true, confidence: .95, identityMismatches: ['different grille and body'] }), requireVision: false, pathExists: async p => fs.existsSync(p) });
  result = await replacementGate.evaluate(input);
  check('explicit object replacement blocks even non-strict mode', () => assert.strictEqual(result.accepted, false));
  check('replacement reason propagated', () => assert(result.reasons.includes('CROSS_VIDEO_OBJECT_REPLACED')));

  const missingGate = new CrossVideoObjectContinuityGateV11(db, { analyzer: async () => goodPayload, requireVision: false, pathExists: async p => fs.existsSync(p) });
  currentBindings = [{ id: 'bind_missing', productionId: 'video_b', sceneId: 'scene_1', shotId: 'shot_1', objectId: 'missing_asset', status: 'resolved', visibility: 'visible', required: true }];
  result = await missingGate.evaluate(input);
  check('reused object without canonical asset blocks by default', () => assert.strictEqual(result.accepted, false));
  check('missing asset reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_OBJECT_CANONICAL_ASSET_MISSING')));

  currentBindings = [{ id: 'bind_off', objectId: 'reused', status: 'resolved', visibility: 'offscreen', required: true }, { id: 'bind_mention', objectId: 'reused', status: 'resolved', visibility: 'mentioned', required: true }];
  result = await gate.evaluate(input);
  check('offscreen and mentioned bindings produce no visual checks', () => assert.strictEqual(result.status, 'no_visible_object_bindings'));

  currentBindings = [{ id: 'bind_reused', productionId: 'video_b', sceneId: 'scene_1', shotId: 'shot_1', objectId: 'reused', status: 'resolved', visibility: 'occluded', required: true, canonicalAssetId: 'asset_reused' }];
  const nonStrictNoProvider = new CrossVideoObjectContinuityGateV11(db, { baseURL: '', model: '', requireVision: false, pathExists: async p => fs.existsSync(p) });
  result = await nonStrictNoProvider.evaluate(input);
  check('vision unavailable is audit-only in non-strict mode', () => assert.strictEqual(result.accepted, true));
  check('vision unavailable status persisted', () => assert(saved.some(row => row.objectId === 'reused' && row.status === 'vision_unavailable')));

  const strictNoProvider = new CrossVideoObjectContinuityGateV11(db, { baseURL: '', model: '', requireVision: true, pathExists: async p => fs.existsSync(p) });
  result = await strictNoProvider.evaluate(input);
  check('vision unavailable blocks strict mode', () => assert.strictEqual(result.accepted, false));
  check('strict reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_OBJECT_VISION_REQUIRED')));

  const stateMismatchGate = new CrossVideoObjectContinuityGateV11(db, { analyzer: async () => ({ objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: false, confidence: .91, identityMismatches: [] }), requireVision: false, pathExists: async p => fs.existsSync(p) });
  currentBindings = [{ id: 'bind_reused', productionId: 'video_b', sceneId: 'scene_1', shotId: 'shot_1', objectId: 'reused', status: 'resolved', visibility: 'visible', required: true, stateId: 'state_reused', canonicalAssetId: 'asset_reused' }];
  result = await stateMismatchGate.evaluate(input);
  check('explicit lifecycle state mismatch blocks', () => assert.strictEqual(result.accepted, false));
  check('state drift reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_OBJECT_STATE_DRIFT')));

  const optionalMissingGate = new CrossVideoObjectContinuityGateV11(db, { analyzer: async () => ({ objectPresent: false, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: null, confidence: .9, identityMismatches: [] }), requireVision: false, pathExists: async p => fs.existsSync(p) });
  currentBindings = [{ id: 'bind_reused', productionId: 'video_b', sceneId: 'scene_1', shotId: 'shot_1', objectId: 'reused', status: 'resolved', visibility: 'visible', required: false, canonicalAssetId: 'asset_reused' }];
  result = await optionalMissingGate.evaluate(input);
  check('optional binding may be absent without blocking', () => assert.strictEqual(result.accepted, true));

  fs.rmSync(dir, { recursive: true, force: true });
}

runtimeChecks().then(() => console.log(`Phase 11.10.6 Cross-Video Object Continuity Gate OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});