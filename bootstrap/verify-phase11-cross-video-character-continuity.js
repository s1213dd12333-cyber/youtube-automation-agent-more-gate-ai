'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cross-video-character-continuity-gate-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.6 runtime is not materialized');
const {
  CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION,
  CrossVideoCharacterContinuityGateV11,
  visibleCharacterBindings,
  appearanceStateSummary,
  buildCharacterContinuityPrompt,
  normalizeCharacterVisionResponse,
  characterVisionDecision,
  extractJson,
  mimeForPath
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.11.6', () => assert.strictEqual(CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION, '11.11.6'));
check('visible bindings include visible', () => assert.strictEqual(visibleCharacterBindings([{ status:'resolved', characterId:'c', visibility:'visible' }]).length, 1));
check('visible bindings include occluded', () => assert.strictEqual(visibleCharacterBindings([{ status:'resolved', characterId:'c', visibility:'occluded' }]).length, 1));
check('visible bindings exclude offscreen', () => assert.strictEqual(visibleCharacterBindings([{ status:'resolved', characterId:'c', visibility:'offscreen' }]).length, 0));
check('visible bindings exclude mentioned', () => assert.strictEqual(visibleCharacterBindings([{ status:'resolved', characterId:'c', visibility:'mentioned' }]).length, 0));
check('visible bindings exclude conflicts', () => assert.strictEqual(visibleCharacterBindings([{ status:'conflict', characterId:'c', visibility:'visible' }]).length, 0));
check('visible bindings require character id', () => assert.strictEqual(visibleCharacterBindings([{ status:'resolved', visibility:'visible' }]).length, 0));

check('appearance summary detects wardrobe', () => assert(appearanceStateSummary({ status:'active', wardrobe:'yellow raincoat' }).appearanceChangeExpected));
check('appearance summary detects injuries', () => assert(appearanceStateSummary({ status:'active', injuries:['bandage'] }).appearanceChangeExpected));
check('appearance summary detects temporary accessories', () => assert(appearanceStateSummary({ status:'active', temporaryAccessories:['party hat'] }).summary.includes('party hat')));
check('appearance summary neutral does not invent change', () => assert.strictEqual(appearanceStateSummary({ status:'neutral' }).appearanceChangeExpected, false));
check('appearance summary absent is neutral', () => assert.strictEqual(appearanceStateSummary(null).active, false));

const samplePrompt = buildCharacterContinuityPrompt({
  character:{ id:'char_luna', characterKey:'luna_main', displayName:'Luna', speciesType:'rabbit', canonicalIdentity:{ palette:['cream','gold'], proportions:'small rounded rabbit', face:'large brown eyes', shapeLanguage:'round ears', outfit:'blue dress', markings:['gold ear tip'] } },
  binding:{ visibility:'visible', placement:'foreground', action:'wave', expression:'happy' },
  state:{ status:'active', wardrobe:'yellow raincoat', injuries:['bandage'] },
  canonicalAsset:{ assetSha256:'sha_luna' }
});
check('prompt identifies two image roles', () => assert(samplePrompt.includes('IMAGE 1') && samplePrompt.includes('IMAGE 2')));
check('prompt ignores pose expression and camera as identity mismatch', () => assert(samplePrompt.includes('pose, action, expression')));
check('prompt includes character id', () => assert(samplePrompt.includes('CHARACTER ID: char_luna')));
check('prompt includes canonical face', () => assert(samplePrompt.includes('CANONICAL FACE: large brown eyes')));
check('prompt includes canonical palette', () => assert(samplePrompt.includes('cream / gold')));
check('prompt includes appearance state', () => assert(samplePrompt.includes('wardrobe=yellow raincoat')));
check('prompt permits wardrobe override only through state', () => assert(samplePrompt.includes('Base outfit may be visually replaced only')));
check('prompt includes canonical asset hash', () => assert(samplePrompt.includes('sha_luna')));
check('prompt demands exact JSON contract', () => assert(samplePrompt.includes('"sameCanonicalCharacter"')));

const goodNormalized = normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:true, confidence:.93, identityMismatches:[], notes:'same Luna' });
check('good vision response contract valid', () => assert.strictEqual(goodNormalized.contractValid, true));
check('good vision response verifies', () => assert.strictEqual(goodNormalized.verified, true));
check('malformed response invalid', () => assert.strictEqual(normalizeCharacterVisionResponse({ characterPresent:true }).contractValid, false));
check('identity mismatch array hardens canonical verdict', () => assert.strictEqual(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:true, confidence:.95, identityMismatches:['different eye shape'] }).canonicalIdentityConsistent, false));
check('confidence clamps high values', () => assert.strictEqual(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:null, confidence:3, identityMismatches:[] }).confidence, 1));

check('explicit missing character blocks non-strict mode', () => assert.strictEqual(characterVisionDecision(normalizeCharacterVisionResponse({ characterPresent:false, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:null, confidence:.9, identityMismatches:[] }), { requireVision:false, requiredBinding:true, minConfidence:.72 }).accepted, false));
check('replacement blocks', () => assert(characterVisionDecision(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:false, canonicalIdentityConsistent:false, appearanceStateConsistent:true, confidence:.9, identityMismatches:['different rabbit'] }), { requireVision:false, requiredBinding:true, minConfidence:.72 }).reasons.includes('CROSS_VIDEO_CHARACTER_REPLACED')));
check('identity drift blocks', () => assert(characterVisionDecision(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:false, appearanceStateConsistent:true, confidence:.9, identityMismatches:['different eyes'] }), { requireVision:false, requiredBinding:true, minConfidence:.72 }).reasons.includes('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT')));
check('appearance-state drift blocks', () => assert(characterVisionDecision(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:false, confidence:.9, identityMismatches:[] }), { requireVision:false, requiredBinding:true, minConfidence:.72 }).reasons.includes('CROSS_VIDEO_CHARACTER_APPEARANCE_STATE_DRIFT')));
check('low confidence non-strict accepts unverified', () => assert.strictEqual(characterVisionDecision(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:true, confidence:.51, identityMismatches:[] }), { requireVision:false, requiredBinding:true, minConfidence:.72 }).accepted, true));
check('low confidence strict blocks', () => assert.strictEqual(characterVisionDecision(normalizeCharacterVisionResponse({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:true, confidence:.51, identityMismatches:[] }), { requireVision:true, requiredBinding:true, minConfidence:.72 }).accepted, false));
check('missing vision non-strict audit only', () => assert.strictEqual(characterVisionDecision(null, { requireVision:false }).accepted, true));
check('missing vision strict blocks', () => assert.strictEqual(characterVisionDecision(null, { requireVision:true }).accepted, false));
check('extractJson handles fenced response', () => assert.strictEqual(extractJson('```json\n{"a":1}\n```').a, 1));
check('mime maps webp', () => assert.strictEqual(mimeForPath('/tmp/a.webp'), 'image/webp'));
check('mime maps jpeg', () => assert.strictEqual(mimeForPath('/tmp/a.jpeg'), 'image/jpeg'));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns character continuity table', dbSource, 'CREATE TABLE IF NOT EXISTS cross_video_character_continuity_checks'],
  ['table binds keyframe', dbSource, 'FOREIGN KEY (keyframe_id) REFERENCES shot_keyframes(id) ON DELETE CASCADE'],
  ['table binds character binding', dbSource, 'FOREIGN KEY (binding_id) REFERENCES persistent_character_bindings(id) ON DELETE SET NULL'],
  ['table binds persistent character', dbSource, 'FOREIGN KEY (character_id) REFERENCES persistent_characters(id) ON DELETE SET NULL'],
  ['table binds canonical character asset', dbSource, 'FOREIGN KEY (canonical_asset_id) REFERENCES persistent_character_assets(id) ON DELETE SET NULL'],
  ['table binds appearance state', dbSource, 'FOREIGN KEY (state_id) REFERENCES persistent_character_appearance_states(id) ON DELETE SET NULL'],
  ['database saves character continuity check', dbSource, 'async saveCrossVideoCharacterContinuityCheck(input = {})'],
  ['database reads latest character continuity check', dbSource, 'async getLatestCrossVideoCharacterContinuityCheck(productionId, keyframeId, characterId = null)'],
  ['database lists character continuity checks', dbSource, 'async listCrossVideoCharacterContinuityChecks(productionId)'],
  ['bundle loads character continuity checks', dbSource, 'const crossVideoCharacterContinuityChecks = await this.listCrossVideoCharacterContinuityChecks(productionId);'],
  ['bundle exposes character continuity checks', dbSource, 'crossVideoCharacterContinuityChecks,'],
  ['scene pipeline imports character gate', pipelineSource, "CrossVideoCharacterContinuityGateV11 } = require('./cross-video-character-continuity-gate-v11')"],
  ['scene pipeline constructs character gate', pipelineSource, 'this.crossVideoCharacterContinuityGate = options.crossVideoCharacterContinuityGate || new CrossVideoCharacterContinuityGateV11'],
  ['scene pipeline passes character gate to keyframes', pipelineSource, 'crossVideoCharacterContinuityGate: this.crossVideoCharacterContinuityGate'],
  ['keyframe runtime receives character gate', keyframeSource, 'this.crossVideoCharacterContinuityGate = options.crossVideoCharacterContinuityGate || null;'],
  ['keyframe runtime evaluates character gate', keyframeSource, 'this.crossVideoCharacterContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })'],
  ['keyframe runtime blocks character drift', keyframeSource, "status: 'cross_video_character_continuity_failed'"],
  ['keyframe runtime exposes character error code', keyframeSource, "crossVideoCharacterError.code = 'CROSS_VIDEO_CHARACTER_CONTINUITY_FAILED'"],
  ['dashboard exposes character continuity panel', dashboardSource, 'CROSS-VIDEO CHARACTER CONTINUITY GATE V11.11.6'],
  ['dashboard documents visible-only evaluation', dashboardSource, 'Only resolved visible/occluded bindings are evaluated'],
  ['dashboard documents appearance tolerance', dashboardSource, 'Declared 11.11.4 wardrobe/appearance state may vary'],
  ['env enables character continuity', envSource, 'CROSS_VIDEO_CHARACTER_CONTINUITY_ENABLED=true'],
  ['env requires canonical character asset', envSource, 'CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_CANONICAL_ASSET=true'],
  ['env defaults non-strict vision', envSource, 'CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_VISION=false'],
  ['env sets character confidence', envSource, 'CROSS_VIDEO_CHARACTER_CONTINUITY_MIN_CONFIDENCE=0.72'],
  ['env documents semantic provider fallback', envSource, 'the gate reuses SEMANTIC_PROP_VISION_* provider settings']
]) check(name, () => assert(source.includes(token)));
check('package exposes character continuity verifier', () => assert.strictEqual(pkg.scripts['test:cross-video-character-continuity'], 'node ../bootstrap/verify-phase11-cross-video-character-continuity.js'));
check('character gate runs before ready status', () => assert(keyframeSource.indexOf('this.crossVideoCharacterContinuityGate.evaluate') < keyframeSource.indexOf("status: 'ready'")));
check('location gate remains before object gate', () => assert(keyframeSource.indexOf('this.crossVideoContinuityGate.evaluate') < keyframeSource.indexOf('this.crossVideoObjectContinuityGate.evaluate')));
check('object gate remains before character gate', () => assert(keyframeSource.indexOf('this.crossVideoObjectContinuityGate.evaluate') < keyframeSource.indexOf('this.crossVideoCharacterContinuityGate.evaluate')));

async function runtimeChecks() {
  const dir = path.join(__dirname, '.tmp-character-continuity');
  fs.mkdirSync(dir, { recursive:true });
  const referencePath = path.join(dir, 'reference.png');
  const candidatePath = path.join(dir, 'candidate.png');
  fs.writeFileSync(referencePath, Buffer.from('canonical-character-reference'));
  fs.writeFileSync(candidatePath, Buffer.from('generated-scene'));

  const saved = [];
  const characters = {
    origin:{ id:'origin', characterKey:'origin_luna', displayName:'Origin Luna', speciesType:'rabbit', createdFromProductionId:'video_b', canonicalIdentity:{ palette:['cream'], face:'brown eyes', shapeLanguage:'round ears' } },
    reused:{ id:'reused', characterKey:'luna_main', displayName:'Luna', speciesType:'rabbit', createdFromProductionId:'video_a', identityFingerprint:'ifp_luna', canonicalIdentity:{ palette:['cream','gold'], proportions:'small rounded rabbit', face:'large brown eyes', shapeLanguage:'round ears', outfit:'blue dress', markings:['gold ear tip'] } },
    missing_asset:{ id:'missing_asset', characterKey:'star_main', displayName:'Star', speciesType:'rabbit', createdFromProductionId:'video_a', canonicalIdentity:{} }
  };
  const assets = {
    reused:{ id:'asset_reused', characterId:'reused', assetRole:'character_reference', status:'ready', canonical:true, assetPath:referencePath, assetSha256:'sha_ref', sourceProductionId:'video_a' }
  };
  const states = {
    state_reused:{ id:'state_reused', characterId:'reused', productionId:'video_b', status:'active', wardrobe:'yellow raincoat', injuries:['bandage'], stateFingerprint:'state_fp' }
  };
  let currentBindings = [];
  const db = {
    async listShotPersistentCharacterBindings() { return currentBindings; },
    async getPersistentCharacter(id) { return characters[id] || null; },
    async getPersistentCharacterAsset(id) { return Object.values(assets).find(item => item.id === id) || null; },
    async getPersistentCharacterAssetByCharacter(id) { return assets[id] || null; },
    async getPersistentCharacterAppearanceState(id) { return states[id] || null; },
    async saveCrossVideoCharacterContinuityCheck(row) { saved.push({ ...row }); return { ...row }; }
  };
  const input = { productionId:'video_b', sceneId:'scene_1', keyframe:{ id:'kf_1', shotId:'shot_1' }, assetPath:candidatePath, attempt:0 };
  const goodPayload = { characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:true, confidence:.94, identityMismatches:[], notes:'same Luna wearing allowed raincoat' };
  const gate = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => goodPayload, requireVision:false, pathExists:async p => fs.existsSync(p) });

  currentBindings = [{ id:'bind_origin', productionId:'video_b', sceneId:'scene_1', shotId:'shot_1', characterId:'origin', status:'resolved', visibility:'visible', required:true }];
  let result = await gate.evaluate(input);
  check('origin production character accepted without cross-video compare', () => assert.strictEqual(result.accepted, true));
  check('origin production status recorded', () => assert(saved.some(row => row.characterId === 'origin' && row.status === 'origin_production')));
  check('origin does not invoke cross-video verification', () => assert.strictEqual(result.summary.reused, 0));

  currentBindings = [{ id:'bind_reused', productionId:'video_b', sceneId:'scene_1', shotId:'shot_1', characterId:'reused', status:'resolved', visibility:'visible', required:true, stateId:'state_reused', stateFingerprint:'state_fp', canonicalAssetId:'asset_reused', canonicalAssetSha256:'sha_ref' }];
  result = await gate.evaluate(input);
  check('reused canonical character accepted with good vision evidence', () => assert.strictEqual(result.accepted, true));
  check('reused summary counts character', () => assert.strictEqual(result.summary.reused, 1));
  check('reused summary verified', () => assert.strictEqual(result.summary.verified, 1));
  check('accepted check persists provider evidence', () => assert(saved.some(row => row.characterId === 'reused' && row.providerUsed === true && row.visionConfidence > .9)));
  check('accepted check persists appearance state', () => assert(saved.some(row => row.characterId === 'reused' && row.stateFingerprint === 'state_fp')));
  check('accepted check persists canonical asset', () => assert(saved.some(row => row.characterId === 'reused' && row.canonicalAssetId === 'asset_reused')));

  const replacementGate = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => ({ characterPresent:true, sameCanonicalCharacter:false, canonicalIdentityConsistent:false, appearanceStateConsistent:true, confidence:.95, identityMismatches:['different face and ear shape'] }), requireVision:false, pathExists:async p => fs.existsSync(p) });
  result = await replacementGate.evaluate(input);
  check('explicit character replacement blocks even non-strict mode', () => assert.strictEqual(result.accepted, false));
  check('replacement reason propagated', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_REPLACED')));
  check('identity drift reason propagated', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT')));

  const contradictoryGate = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => ({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:true, confidence:.95, identityMismatches:['different eye shape'] }), requireVision:false, pathExists:async p => fs.existsSync(p) });
  result = await contradictoryGate.evaluate(input);
  check('identity mismatch list overrides contradictory true flag', () => assert.strictEqual(result.accepted, false));
  check('identity mismatch list produces drift reason', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT')));

  const stateDriftGate = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => ({ characterPresent:true, sameCanonicalCharacter:true, canonicalIdentityConsistent:true, appearanceStateConsistent:false, confidence:.92, identityMismatches:[] }), requireVision:false, pathExists:async p => fs.existsSync(p) });
  result = await stateDriftGate.evaluate(input);
  check('appearance-state mismatch blocks', () => assert.strictEqual(result.accepted, false));
  check('appearance-state reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_APPEARANCE_STATE_DRIFT')));

  currentBindings = [{ id:'bind_missing', productionId:'video_b', sceneId:'scene_1', shotId:'shot_1', characterId:'missing_asset', status:'resolved', visibility:'visible', required:true }];
  result = await gate.evaluate(input);
  check('reused character without canonical asset blocks by default', () => assert.strictEqual(result.accepted, false));
  check('missing asset reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_CANONICAL_ASSET_MISSING')));

  currentBindings = [{ id:'bind_off', characterId:'reused', status:'resolved', visibility:'offscreen', required:true }, { id:'bind_mention', characterId:'reused', status:'resolved', visibility:'mentioned', required:true }];
  result = await gate.evaluate(input);
  check('offscreen and mentioned bindings produce no visual checks', () => assert.strictEqual(result.status, 'no_visible_character_bindings'));
  check('offscreen and mentioned summary visible zero', () => assert.strictEqual(result.summary.visible, 0));

  currentBindings = [{ id:'bind_reused', productionId:'video_b', sceneId:'scene_1', shotId:'shot_1', characterId:'reused', status:'resolved', visibility:'occluded', required:true, canonicalAssetId:'asset_reused' }];
  const nonStrictNoProvider = new CrossVideoCharacterContinuityGateV11(db, { baseURL:'', model:'', requireVision:false, pathExists:async p => fs.existsSync(p) });
  result = await nonStrictNoProvider.evaluate(input);
  check('vision unavailable is audit-only in non-strict mode', () => assert.strictEqual(result.accepted, true));
  check('vision unavailable yields unverified summary', () => assert.strictEqual(result.summary.unverified, 1));
  check('vision unavailable status persisted', () => assert(saved.some(row => row.characterId === 'reused' && row.status === 'vision_unavailable')));

  const strictNoProvider = new CrossVideoCharacterContinuityGateV11(db, { baseURL:'', model:'', requireVision:true, pathExists:async p => fs.existsSync(p) });
  result = await strictNoProvider.evaluate(input);
  check('vision unavailable blocks in strict mode', () => assert.strictEqual(result.accepted, false));
  check('strict missing vision reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_VISION_REQUIRED')));

  const lowConfidenceNonStrict = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => ({ ...goodPayload, confidence:.55 }), requireVision:false, pathExists:async p => fs.existsSync(p) });
  result = await lowConfidenceNonStrict.evaluate(input);
  check('low confidence accepted but unverified in non-strict mode', () => assert.strictEqual(result.status, 'accepted_unverified'));

  const lowConfidenceStrict = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => ({ ...goodPayload, confidence:.55 }), requireVision:true, pathExists:async p => fs.existsSync(p) });
  result = await lowConfidenceStrict.evaluate(input);
  check('low confidence blocks in strict mode', () => assert.strictEqual(result.accepted, false));
  check('low confidence strict reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_CONFIDENCE_BELOW_THRESHOLD'));

  const missingCandidateGate = new CrossVideoCharacterContinuityGateV11(db, { analyzer:async () => goodPayload, requireVision:false, pathExists:async p => p === referencePath });
  result = await missingCandidateGate.evaluate(input);
  check('missing generated keyframe always blocks', () => assert.strictEqual(result.accepted, false));
  check('missing generated keyframe reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_KEYFRAME_MISSING')));

  currentBindings = [{ id:'bind_missing_row', characterId:'no_such_character', status:'resolved', visibility:'visible', required:true }];
  result = await gate.evaluate(input);
  check('missing persistent character record blocks', () => assert.strictEqual(result.accepted, false));
  check('missing character record reason explicit', () => assert(result.reasons.includes('CROSS_VIDEO_CHARACTER_RECORD_MISSING')));

  const disabled = new CrossVideoCharacterContinuityGateV11(db, { enabled:false });
  result = await disabled.evaluate(input);
  check('disabled gate accepts without claiming verification', () => assert(result.accepted && result.status === 'disabled' && !result.verified));

  fs.rmSync(dir, { recursive:true, force:true });
}

runtimeChecks().then(() => console.log(`Phase 11.11.6 Cross-Video Character Continuity Gate OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
