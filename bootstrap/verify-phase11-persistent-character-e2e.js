'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtime = name => path.join(upstream, 'utils', name);

for (const name of [
  'persistent-character-registry-v11.js',
  'persistent-character-resolver-v11.js',
  'canonical-character-assets-v11.js',
  'persistent-character-appearance-state-v11.js',
  'persistent-character-binding-v11.js',
  'cross-video-character-continuity-gate-v11.js',
  'persistent-character-library-manager-v11.js'
]) {
  if (!fs.existsSync(runtime(name))) throw new Error(`11.11.8 prerequisite missing: ${name}`);
}

const { PersistentCharacterRegistryV11, PERSISTENT_CHARACTER_VERSION } = require(runtime('persistent-character-registry-v11.js'));
const { PERSISTENT_CHARACTER_RESOLVER_VERSION } = require(runtime('persistent-character-resolver-v11.js'));
const { CanonicalCharacterAssetRegistryV11, CANONICAL_CHARACTER_ASSETS_VERSION } = require(runtime('canonical-character-assets-v11.js'));
const { PersistentCharacterAppearanceStateLayerV11, PERSISTENT_CHARACTER_APPEARANCE_STATE_VERSION } = require(runtime('persistent-character-appearance-state-v11.js'));
const { PersistentCharacterBindingV11, PERSISTENT_CHARACTER_BINDING_VERSION } = require(runtime('persistent-character-binding-v11.js'));
const { CrossVideoCharacterContinuityGateV11, CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION } = require(runtime('cross-video-character-continuity-gate-v11.js'));
const { PersistentCharacterLibraryManagerV11, PERSISTENT_CHARACTER_LIBRARY_VERSION } = require(runtime('persistent-character-library-manager-v11.js'));
const { MemoryCharacterDb } = require('./e2e/character-system-memory-db');
const { shotPlan, scene, bible, luna, nova, createFixtureFiles } = require('./e2e/character-system-fixtures');

let checks = 0;
const ok = (name, fn) => {
  try { fn(); checks += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
};

async function main() {
  for (const [actual, expected] of [
    [PERSISTENT_CHARACTER_VERSION, '11.11.1'],
    [PERSISTENT_CHARACTER_RESOLVER_VERSION, '11.11.2'],
    [CANONICAL_CHARACTER_ASSETS_VERSION, '11.11.3'],
    [PERSISTENT_CHARACTER_APPEARANCE_STATE_VERSION, '11.11.4'],
    [PERSISTENT_CHARACTER_BINDING_VERSION, '11.11.5'],
    [CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION, '11.11.6'],
    [PERSISTENT_CHARACTER_LIBRARY_VERSION, '11.11.7']
  ]) ok(`runtime ${expected}`, () => assert.strictEqual(actual, expected));

  const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  ok('character e2e npm script', () => assert.strictEqual(pkg.scripts['test:persistent-character:e2e'], 'node ../bootstrap/verify-phase11-persistent-character-e2e.js'));
  ok('character full script includes e2e', () => assert((pkg.scripts['test:persistent-character:full'] || '').includes('test:persistent-character:e2e')));
  ok('character full script includes 11.11.7', () => assert((pkg.scripts['test:persistent-character:full'] || '').includes('test:persistent-character-library-ui')));
  ok('character full script includes binding hardening', () => assert((pkg.scripts['test:persistent-character:full'] || '').includes('verify-phase11-persistent-character-binding-hardening.js')));

  const db = new MemoryCharacterDb();
  const fx = await createFixtureFiles();
  const F = fx.files;
  const registry = new PersistentCharacterRegistryV11(db, { enabled: true, namespace: 'series' });
  const assets = new CanonicalCharacterAssetRegistryV11(db, { enabled: true, requireProvider: true, dataRoot: fx.dataRoot });
  const states = new PersistentCharacterAppearanceStateLayerV11(db, { enabled: true, inheritDurable: true });
  const binder = new PersistentCharacterBindingV11(db, { enabled: true, useShotPlannerCast: true });
  const manager = new PersistentCharacterLibraryManagerV11(db, { enabled: true, operatorControls: true, allowAlias: true, allowLink: true });
  const analyzer = async ({ candidatePath }) => String(candidatePath).includes('wrong-rabbit')
    ? { characterPresent: true, sameCanonicalCharacter: false, canonicalIdentityConsistent: false, appearanceStateConsistent: true, confidence: 0.99, identityMismatches: ['different face and silhouette'], notes: 'replacement rabbit' }
    : { characterPresent: true, sameCanonicalCharacter: true, canonicalIdentityConsistent: true, appearanceStateConsistent: true, confidence: 0.97, identityMismatches: [], notes: 'same canonical character' };
  const gate = new CrossVideoCharacterContinuityGateV11(db, { enabled: true, requireCanonicalAsset: true, requireVision: true, minConfidence: 0.72, analyzer });

  const bind = async (productionId, sourceCharacterIds, characterPlan, statePlan, assetList, explicitBindings = [], customPlan = null) => {
    const sceneId = `scene_${productionId}`;
    const plan = customPlan || shotPlan(sceneId, `shot_${productionId}`, sourceCharacterIds);
    return binder.bindShotPlan({
      production: { id: productionId },
      scenes: [scene(sceneId, explicitBindings)],
      shotPlan: plan,
      characterPlan,
      statePlan,
      assetPlan: { assets: assetList || [] }
    });
  };
  const evalGate = (productionId, file) => gate.evaluate({
    productionId,
    sceneId: `scene_${productionId}`,
    keyframe: { id: `kf_${productionId}`, shotId: `shot_${productionId}` },
    assetPath: file
  });

  const A = { id: 'A' };
  const aDecl = luna({ id: 'luna_a', characterKey: 'luna_main', aliases: ['Luna Bunny', 'Coelhinha Luna'], canonicalCharacterAsset: { path: F.lunaCanonical, provider: 'fixture-vision', model: 'v1', canonical: true } });
  const aBible = bible('bible_A', [aDecl]);
  const aPlan = await registry.ensureProductionCharacters(A, aBible);
  const lunaCharacter = aPlan.characters[0].character;
  const lunaId = lunaCharacter.id;
  const lunaFingerprint = lunaCharacter.identityFingerprint;
  ok('A registers Luna', () => assert.strictEqual(aPlan.summary.registered, 1));
  ok('A character key stable', () => assert.strictEqual(lunaCharacter.characterKey, 'luna_main'));
  ok('A namespace stable', () => assert.strictEqual(lunaCharacter.namespace, 'series'));
  ok('A species stable', () => assert.strictEqual(lunaCharacter.speciesType, 'rabbit'));
  ok('A canonical face exists', () => assert(lunaCharacter.canonicalIdentity.face.includes('wide brown eyes')));
  ok('A aliases seeded', () => assert(db.aliases.some(x => x.aliasKey === 'coelhinha luna') && db.aliases.some(x => x.aliasKey === 'luna bunny')));
  const aAssets = await assets.ensureProductionAssets(A, aBible, aPlan);
  const lunaAnchor = (await db.listPersistentCharacterAssets(lunaId))[0];
  const lunaSha = lunaAnchor.assetSha256;
  ok('A canonical asset ready', () => assert(aAssets.summary.ready === 1 && lunaAnchor.sourceProductionId === 'A' && fs.existsSync(lunaAnchor.assetPath)));
  ok('A canonical sha is sha256', () => assert.strictEqual(lunaSha.length, 64));
  const aBind = await bind('A', ['luna_a'], aPlan, { states: [] }, [lunaAnchor]);
  ok('A visible binding', () => assert(aBind.summary.visible === 1 && aBind.bindings[0].characterId === lunaId));
  ok('A binding has canonical asset', () => assert.strictEqual(aBind.bindings[0].canonicalAssetSha256, lunaSha));
  const ga = await evalGate('A', F.lunaFrameB);
  ok('A origin audit accepted', () => assert(ga.accepted && ga.checks[0].status === 'origin_production'));
  ok('A origin not cross-video verified', () => assert.strictEqual(ga.checks[0].verified, false));

  const B = { id: 'B' };
  const bDecl = { id: 'luna_b', name: 'Coelhinha Luna', species: 'rabbit', canonicalCharacterAsset: { path: F.lunaAlternative, provider: 'fixture-vision', model: 'v2', canonical: true }, appearanceState: { wardrobe: 'yellow raincoat', carriedItems: ['red backpack'], statePersistence: 'until_changed' } };
  const bBible = bible('bible_B', [bDecl]);
  const bPlan = await registry.ensureProductionCharacters(B, bBible);
  ok('B alias reuses Luna', () => assert(bPlan.characters[0].character.id === lunaId && bPlan.characters[0].matchMode === 'character_alias_exact'));
  ok('B usage records alias mode', () => assert(db.usages.some(x => x.productionId === 'B' && x.characterId === lunaId && x.matchMode === 'character_alias_exact')));
  const bAssets = await assets.ensureProductionAssets(B, bBible, bPlan);
  const anchorB = (await db.listPersistentCharacterAssets(lunaId))[0];
  ok('B canonical asset reused', () => assert(bAssets.summary.reused >= 1));
  ok('B asset hash immutable', () => assert.strictEqual(anchorB.assetSha256, lunaSha));
  ok('B asset origin immutable', () => assert.strictEqual(anchorB.sourceProductionId, 'A'));
  const bStates = await states.ensureProductionStates(B, bBible, bPlan);
  const stateB = bStates.states[0];
  ok('B durable wardrobe active', () => assert(stateB.status === 'active' && stateB.persistence === 'until_changed' && stateB.wardrobe === 'yellow raincoat'));
  ok('B carried item persisted', () => assert(stateB.carriedItems.includes('red backpack')));
  ok('B state preserves canonical fingerprint', () => assert.strictEqual(stateB.canonicalIdentityFingerprint, lunaFingerprint));
  const bBind = await bind('B', ['luna_b'], bPlan, bStates, [anchorB], [
    { characterKey: 'luna_main', shotIndex: 0, visibility: 'visible', placement: 'foreground' },
    { characterKey: 'luna_main', shotIndex: 0, visibility: 'visible', expression: 'cheerful smile' }
  ]);
  ok('B complementary declarations merge', () => assert(bBind.bindings.length === 1 && bBind.bindings[0].placement === 'foreground' && bBind.bindings[0].expression === 'cheerful smile'));
  ok('B binding carries state', () => assert.strictEqual(bBind.bindings[0].stateFingerprint, stateB.stateFingerprint));
  ok('B binding carries canonical asset', () => assert.strictEqual(bBind.bindings[0].canonicalAssetSha256, lunaSha));
  const gb = await evalGate('B', F.lunaFrameB);
  ok('B cross-video passes', () => assert(gb.accepted && gb.verified));
  ok('B same canonical character', () => assert(gb.checks[0].sameCanonicalCharacter && gb.checks[0].canonicalIdentityConsistent));
  ok('B appearance state accepted', () => assert.strictEqual(gb.checks[0].appearanceStateConsistent, true));

  const C = { id: 'C' };
  const cBible = bible('bible_C', [{ id: 'luna_c', name: 'the bunny', species: 'rabbit' }]);
  const cPlan = await registry.ensureProductionCharacters(C, cBible);
  ok('C contextual unique reuse', () => assert(cPlan.characters[0].character.id === lunaId && cPlan.characters[0].matchMode === 'character_context_unique'));
  ok('C generic phrase not auto alias', () => assert(!db.aliases.some(x => x.aliasKey === 'the bunny')));
  const cStates = await states.ensureProductionStates(C, cBible, cPlan);
  const stateC = cStates.states[0];
  ok('C inherits durable raincoat', () => assert(stateC.inherited && stateC.persistence === 'until_changed' && stateC.wardrobe === 'yellow raincoat'));
  ok('C parent state lineage', () => assert.strictEqual(stateC.parentStateId, stateB.id));
  const cBind = await bind('C', ['luna_c'], cPlan, cStates, [lunaAnchor]);
  ok('C derived Shot Planner binding resolves', () => assert(cBind.summary.visible === 1 && cBind.bindings[0].matchMode === 'source_character_id_exact'));
  const gc = await evalGate('C', F.lunaFrameC);
  ok('C continuity passes', () => assert(gc.accepted && gc.verified));

  const D = { id: 'D' };
  const dDecl = nova({ id: 'nova_d', characterKey: 'nova_main', aliases: ['Nova Bunny'], canonicalCharacterAsset: { path: F.novaCanonical, provider: 'fixture-vision', model: 'v1', canonical: true } });
  const dBible = bible('bible_D', [dDecl]);
  const dPlan = await registry.ensureProductionCharacters(D, dBible);
  const novaCharacter = dPlan.characters[0].character;
  ok('D registers Nova', () => assert(dPlan.summary.registered === 1));
  ok('D Nova distinct from Luna', () => assert(novaCharacter.id !== lunaId && db.characters.length === 2));
  const dAssets = await assets.ensureProductionAssets(D, dBible, dPlan);
  ok('D Nova canonical asset ready', () => assert.strictEqual(dAssets.summary.ready, 1));
  ok('D separate canonical asset row', () => assert(db.assets.some(x => x.characterId === novaCharacter.id && x.sourceProductionId === 'D')));

  const E = { id: 'E' };
  const eBible = bible('bible_E', [{ id: 'generic_e', name: 'the bunny', species: 'rabbit' }]);
  const ePlan = await registry.ensureProductionCharacters(E, eBible);
  const resolutionE = db.resolutions.find(x => x.productionId === 'E' && x.status === 'ambiguous');
  const beforeCandidates = [...(resolutionE?.candidateCharacterIds || [])];
  ok('E ambiguity fail closed', () => assert(ePlan.summary.total === 1 && ePlan.characters.length === 0 && ePlan.conflicts.length === 0));
  ok('E resolver has two candidates', () => assert(resolutionE && beforeCandidates.length === 2 && beforeCandidates.includes(lunaId) && beforeCandidates.includes(novaCharacter.id)));
  ok('E ambiguity creates no third character', () => assert.strictEqual(db.characters.length, 2));
  const linked = await manager.linkResolution({ resolutionId: resolutionE.id, characterId: lunaId, persistAlias: true, actor: 'e2e' });
  ok('E operator link applied', () => assert(linked.status === 'applied' && linked.resolution.characterId === lunaId && linked.resolution.matchMode === 'operator_explicit_link'));
  ok('E operator alias persisted', () => assert(db.aliases.some(x => x.characterId === lunaId && x.aliasKey === 'the bunny')));
  ok('E link audited', () => assert(db.actions.some(x => x.actionType === 'link_resolution' && x.characterId === lunaId && x.status === 'applied')));
  const collision = await manager.addAlias({ characterId: novaCharacter.id, aliasText: 'the bunny', actor: 'e2e' });
  ok('E alias collision fail closed', () => assert(collision.status === 'conflict' && collision.conflictingCharacterIds.includes(lunaId)));
  const retarget = await manager.linkResolution({ resolutionId: resolutionE.id, characterId: novaCharacter.id, actor: 'e2e' });
  ok('E resolved reference cannot retarget', () => assert(retarget.status === 'conflict' && retarget.currentCharacterId === lunaId));

  const FP = { id: 'F' };
  const fDecl = { id: 'luna_f', name: 'the bunny', species: 'rabbit', appearanceState: { wardrobe: 'star pajamas', statePersistence: 'scene' } };
  const fBible = bible('bible_F', [fDecl]);
  const fPlan = await registry.ensureProductionCharacters(FP, fBible);
  ok('F operator alias reuses Luna', () => assert(fPlan.characters[0].character.id === lunaId && fPlan.characters[0].matchMode === 'character_alias_exact'));
  const fStates = await states.ensureProductionStates(FP, fBible, fPlan);
  const stateF = fStates.states[0];
  ok('F pajamas are scene-only', () => assert(stateF.wardrobe === 'star pajamas' && stateF.persistence === 'scene' && !stateF.inherited));
  const firstF = await bind('F', ['luna_f'], fPlan, fStates, [lunaAnchor]);
  ok('F initially visible', () => assert(firstF.summary.visible === 1));
  const secondF = await bind('F', ['luna_f'], fPlan, fStates, [lunaAnchor], [{ characterKey: 'luna_main', shotIndex: 0, visibility: 'offscreen' }]);
  const persistedF = await db.listProductionPersistentCharacterBindings('F');
  ok('F explicit offscreen overrides derived cast', () => assert(secondF.summary.nonvisual === 1 && secondF.bindings[0].visibility === 'offscreen'));
  ok('F stale visible binding pruned', () => assert(persistedF.length === 1 && persistedF[0].visibility === 'offscreen'));
  ok('F nonvisual prompt forbids render', () => assert(secondF.bindings[0].promptFragment.includes('Do NOT render')));
  const gf = await evalGate('F', F.offscreenFrame);
  ok('F excluded from visual gate', () => assert(gf.accepted && gf.status === 'no_visible_character_bindings' && gf.checks.length === 0));

  const G = { id: 'G' };
  const gBible = bible('bible_G', [{ id: 'luna_g', name: 'the bunny', species: 'rabbit' }]);
  const gPlan = await registry.ensureProductionCharacters(G, gBible);
  const gStates = await states.ensureProductionStates(G, gBible, gPlan);
  const stateG = gStates.states[0];
  ok('G alias reuse stable', () => assert(gPlan.characters[0].character.id === lunaId));
  ok('G inherits durable raincoat not scene pajamas', () => assert(stateG.inherited && stateG.wardrobe === 'yellow raincoat' && stateG.wardrobe !== 'star pajamas'));
  const gBind = await bind('G', ['luna_g'], gPlan, gStates, [lunaAnchor], [{ characterKey: 'luna_main', shotIndex: 0, visibility: 'occluded', placement: 'behind tree' }]);
  ok('G occluded remains visual', () => assert(gBind.summary.visible === 1 && gBind.bindings[0].visibility === 'occluded'));
  const gg = await evalGate('G', F.lunaFrameG);
  ok('G occluded continuity passes', () => assert(gg.accepted && gg.verified));
  ok('G gate carries appearance state', () => assert.strictEqual(gg.checks[0].state?.stateFingerprint, stateG.stateFingerprint));

  const H = { id: 'H' };
  const hBible = bible('bible_H', [{ id: 'luna_h', name: 'the bunny', species: 'rabbit', appearanceState: { clearState: true, statePersistence: 'until_changed' } }]);
  const hPlan = await registry.ensureProductionCharacters(H, hBible);
  const hStates = await states.ensureProductionStates(H, hBible, hPlan);
  const stateH = hStates.states[0];
  ok('H durable reset neutral', () => assert(stateH.status === 'neutral' && stateH.persistence === 'until_changed' && stateH.wardrobe === null && stateH.carriedItems.length === 0));
  const hBind = await bind('H', ['luna_h'], hPlan, hStates, [lunaAnchor], [{ characterKey: 'luna_main', shotIndex: 0, visibility: 'mentioned' }]);
  ok('H mentioned binding nonvisual', () => assert(hBind.summary.nonvisual === 1 && hBind.bindings[0].visibility === 'mentioned'));
  const gh = await evalGate('H', F.resetFrame);
  ok('H mentioned excluded from gate', () => assert(gh.accepted && gh.status === 'no_visible_character_bindings'));
  ok('H reset row preserves identity fingerprint', () => assert.strictEqual(stateH.canonicalIdentityFingerprint, lunaFingerprint));

  const I = { id: 'I' };
  const iBible = bible('bible_I', [{ id: 'luna_i', name: 'the bunny', species: 'rabbit' }]);
  const iPlan = await registry.ensureProductionCharacters(I, iBible);
  const iStates = await states.ensureProductionStates(I, iBible, iPlan);
  const stateI = iStates.states[0];
  ok('I inherits neutral reset', () => assert(stateI.inherited && stateI.status === 'neutral' && stateI.wardrobe === null && stateI.parentStateId === stateH.id));
  ok('I old raincoat does not resurrect', () => assert(!stateI.wardrobe && !stateI.carriedItems.includes('red backpack')));
  await bind('I', ['luna_i'], iPlan, iStates, [lunaAnchor]);
  const gi = await evalGate('I', F.lunaReplacement);
  ok('I replacement blocked', () => assert(!gi.accepted && gi.reasons.includes('CROSS_VIDEO_CHARACTER_REPLACED') && gi.reasons.includes('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT')));
  ok('I mismatch persisted', () => assert(db.cross.some(x => x.productionId === 'I' && (x.identityMismatches || []).length > 0)));
  ok('I provider confidence recorded', () => assert(gi.checks[0].visionConfidence >= 0.72));

  const J = { id: 'J' };
  const jDecl = luna({ id: 'luna_j', characterKey: 'luna_main', palette: ['black fur', 'neon green ears'] });
  delete jDecl.canonicalCharacterAsset;
  const jPlan = await registry.ensureProductionCharacters(J, bible('bible_J', [jDecl]));
  ok('J explicit identity conflict blocked', () => assert(jPlan.summary.conflicts === 1 && jPlan.characters.length === 0));
  ok('J does not create another character', () => assert.strictEqual(db.characters.length, 2));
  const finalLuna = await db.getPersistentCharacter(lunaId);
  const finalAsset = (await db.listPersistentCharacterAssets(lunaId))[0];
  ok('J canonical identity immutable', () => assert(finalLuna.identityFingerprint === lunaFingerprint && finalLuna.canonicalIdentity.palette.includes('cream fur')));
  ok('J canonical asset immutable', () => assert(finalAsset.assetSha256 === lunaSha && finalAsset.sourceProductionId === 'A'));

  const detail = await manager.detail(lunaId);
  const snapshot = await manager.getSnapshot('series');
  ok('UI exposes alias and asset history', () => assert(detail.aliases.some(x => x.aliasKey === 'the bunny') && detail.assets.some(x => x.assetSha256 === lunaSha)));
  ok('UI exposes durable and scene appearance states', () => assert(detail.states.some(x => x.productionId === 'B' && x.wardrobe === 'yellow raincoat') && detail.states.some(x => x.productionId === 'F' && x.wardrobe === 'star pajamas')));
  ok('UI exposes durable reset', () => assert(detail.states.some(x => x.productionId === 'H' && x.status === 'neutral' && x.persistence === 'until_changed')));
  ok('UI exposes visual and nonvisual bindings', () => assert(detail.bindings.some(x => x.productionId === 'G' && x.visibility === 'occluded') && detail.bindings.some(x => x.productionId === 'F' && x.visibility === 'offscreen')));
  ok('UI exposes gate block', () => assert(detail.continuityChecks.some(x => x.productionId === 'I' && !x.accepted)));
  ok('UI exposes operator audit', () => assert(detail.operatorActions.some(x => x.actionType === 'link_resolution' && x.status === 'applied')));
  ok('snapshot has two characters', () => assert.strictEqual(snapshot.summary.characterCount, 2));
  ok('snapshot reports Luna cross-video', () => assert(snapshot.characters.some(x => x.id === lunaId && x.crossVideo)));
  ok('snapshot reports blocked continuity', () => assert(snapshot.summary.blockedContinuity >= 1));

  ok('Luna usage spans many episodes', () => assert(db.usages.filter(x => x.characterId === lunaId).length >= 7));
  ok('resolver audit includes contextual unique', () => assert(db.resolutions.some(x => x.productionId === 'C' && x.matchMode === 'character_context_unique')));
  ok('resolver audit includes operator link', () => assert(db.resolutions.some(x => x.productionId === 'E' && x.matchMode === 'operator_explicit_link')));
  ok('resolver audit includes alias exact after operator correction', () => assert(db.resolutions.some(x => x.productionId === 'F' && x.matchMode === 'character_alias_exact')));
  ok('gate audit includes origin', () => assert(db.cross.some(x => x.productionId === 'A' && x.status === 'origin_production')));
  ok('gate audit includes verified reuse', () => assert(db.cross.some(x => x.productionId === 'B' && x.accepted && x.reusedAcrossVideos)));
  ok('gate audit includes blocked replacement', () => assert(db.cross.some(x => x.productionId === 'I' && !x.accepted)));
  ok('all Luna state rows preserve canonical fingerprint', () => assert(db.states.filter(x => x.characterId === lunaId).every(x => x.canonicalIdentityFingerprint === lunaFingerprint)));
  ok('only two canonical character identities exist', () => assert.strictEqual(new Set(db.characters.map(x => x.id)).size, 2));
  ok('only one canonical Luna reference exists', () => assert.strictEqual(db.assets.filter(x => x.characterId === lunaId && x.assetRole === 'character_reference').length, 1));

  console.log(`Phase 11.11.8 Persistent Character E2E OK: ${checks} regression checks passed across 10 productions.`);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
