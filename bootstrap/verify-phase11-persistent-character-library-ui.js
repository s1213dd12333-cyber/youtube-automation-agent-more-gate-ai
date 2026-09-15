'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-character-library-manager-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.7 runtime is not materialized');
const { PERSISTENT_CHARACTER_LIBRARY_VERSION, PersistentCharacterLibraryManagerV11, normalize, uniqueProductionCount, latestByCreatedAt } = require(runtimePath);
let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.11.7', () => assert.strictEqual(PERSISTENT_CHARACTER_LIBRARY_VERSION, '11.11.7'));
check('normalize folds accents', () => assert.strictEqual(normalize('Lúna!'), 'luna'));
check('normalize converts separators', () => assert.strictEqual(normalize('Luna_Main'), 'luna main'));
check('unique production count deduplicates', () => assert.strictEqual(uniqueProductionCount([{productionId:'a'},{productionId:'a'},{productionId:'b'}]), 2));
check('latest row chosen by createdAt', () => assert.strictEqual(latestByCreatedAt([{id:'a',createdAt:'2026-01-01'},{id:'b',createdAt:'2026-02-01'}]).id, 'b'));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(upstream, 'dashboard', 'index.html'), 'utf8');
const dashboardApp = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const browserSource = fs.readFileSync(path.join(upstream, 'dashboard', 'persistent-character-library-v11.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(upstream, 'dashboard', 'persistent-character-library-v11.css'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns character operator audit table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_character_operator_actions'],
  ['operator action table references character', dbSource, 'FOREIGN KEY (character_id) REFERENCES persistent_characters(id) ON DELETE SET NULL'],
  ['database gets character resolution by id', dbSource, 'async getPersistentCharacterResolution(id)'],
  ['database lists pending character resolutions', dbSource, 'async listPendingPersistentCharacterResolutions(namespace ='],
  ['database lists character bindings', dbSource, 'async listPersistentCharacterBindingsByCharacter(characterId'],
  ['database lists character continuity checks', dbSource, 'async listCrossVideoCharacterContinuityChecksByCharacter(characterId'],
  ['database has atomic operator alias insert', dbSource, 'async savePersistentCharacterOperatorAlias(input = {})'],
  ['atomic alias insert checks foreign character', dbSource, 'character_id <> ?'],
  ['database has atomic resolution link', dbSource, 'async linkPersistentCharacterResolutionOperator(input = {})'],
  ['atomic resolution link compare and set', dbSource, "status IN ('unresolved','ambiguous') OR (status='resolved' AND character_id=?)"],
  ['database saves character operator action', dbSource, 'async savePersistentCharacterOperatorAction(input = {})'],
  ['database lists character operator actions', dbSource, 'async listPersistentCharacterOperatorActions(characterId = null'],
  ['index imports character library manager', indexSource, "PersistentCharacterLibraryManagerV11 } = require('./utils/persistent-character-library-manager-v11')"],
  ['index stores character library', indexSource, 'this.characterLibrary = null;'],
  ['index initializes character library', indexSource, 'this.characterLibrary = new PersistentCharacterLibraryManagerV11'],
  ['index exposes character library snapshot API', indexSource, "this.app.get('/api/character-library'"],
  ['index exposes character detail API', indexSource, "this.app.get('/api/character-library/:characterId'"],
  ['index exposes character asset API', indexSource, "this.app.get('/api/character-library/assets/:assetId'"],
  ['index protects character alias mutation', indexSource, "this.app.post('/api/character-library/:characterId/aliases', protect"],
  ['index protects character resolution mutation', indexSource, "this.app.post('/api/character-library/resolutions/:resolutionId/link', protect"],
  ['asset route restricts character library root', indexSource, "data', 'assets', 'character-library'"],
  ['asset route rejects traversal', indexSource, "relative.startsWith('..')"],
  ['dashboard has character nav', dashboardHtml, 'data-view="characters"'],
  ['dashboard has character view', dashboardHtml, 'id="characters-view"'],
  ['dashboard loads character css', dashboardHtml, '/persistent-character-library-v11.css'],
  ['dashboard loads character browser runtime', dashboardHtml, '/persistent-character-library-v11.js'],
  ['dashboard title registered', dashboardApp, "characters: ['CHARACTER LIBRARY'"],
  ['browser fetches character library', browserSource, "request('/api/character-library')"],
  ['browser displays canonical identity read only', browserSource, 'Canonical identity (read-only)'],
  ['browser exposes canonical reference', browserSource, 'Canonical character reference'],
  ['browser exposes appearance state', browserSource, 'Latest appearance state'],
  ['browser exposes cross video continuity', browserSource, 'Cross-video continuity'],
  ['browser can add alias', browserSource, 'data-character-add-alias'],
  ['browser can link resolution', browserSource, 'data-character-link-resolution'],
  ['browser supports persisted alias link', browserSource, 'data-character-persist-alias'],
  ['css defines library layout', cssSource, '.character-library-layout'],
  ['css defines detail blocks', cssSource, '.character-detail-block'],
  ['env enables character library', envSource, 'PERSISTENT_CHARACTER_LIBRARY_ENABLED=true'],
  ['env enables character controls', envSource, 'PERSISTENT_CHARACTER_OPERATOR_CONTROLS_ENABLED=true'],
  ['env enables alias controls', envSource, 'PERSISTENT_CHARACTER_OPERATOR_ALIAS_ENABLED=true'],
  ['env enables link controls', envSource, 'PERSISTENT_CHARACTER_OPERATOR_LINK_ENABLED=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes character library verifier', () => assert.strictEqual(pkg.scripts['test:persistent-character-library-ui'], 'node ../bootstrap/verify-phase11-persistent-character-library-ui.js'));

async function runtimeChecks() {
  const characters = {
    luna:{ id:'luna', namespace:'default', characterKey:'luna_main', displayName:'Luna', speciesType:'rabbit', identityFingerprint:'fp_luna', canonicalIdentity:{ face:'brown eyes' }, createdFromProductionId:'video_a' },
    star:{ id:'star', namespace:'default', characterKey:'star_main', displayName:'Star', speciesType:'rabbit', identityFingerprint:'fp_star', canonicalIdentity:{ face:'blue eyes' }, createdFromProductionId:'video_b' }
  };
  const aliases = [
    {id:'a1',namespace:'default',characterId:'luna',aliasText:'Luna',aliasKey:'luna',canonical:true,sourceKind:'character_registration'},
    {id:'a2',namespace:'default',characterId:'star',aliasText:'Star',aliasKey:'star',canonical:true,sourceKind:'character_registration'}
  ];
  const usages = { luna:[{productionId:'video_a'},{productionId:'video_b'}], star:[{productionId:'video_b'}] };
  const assets = { luna:[{id:'asset_luna',characterId:'luna',assetRole:'character_reference',canonical:true,status:'ready',assetPath:'x',assetSha256:'sha'}], star:[] };
  const states = { luna:[{id:'state_luna',characterId:'luna',status:'active',wardrobe:'raincoat',createdAt:'2026-02-01'}], star:[] };
  const bindings = { luna:[{id:'bind_luna',characterId:'luna',visibility:'visible'}], star:[] };
  const checks = { luna:[{id:'check_luna',characterId:'luna',accepted:false,status:'blocked',createdAt:'2026-03-01'}], star:[] };
  const resolutions = {
    r1:{id:'r1',namespace:'default',productionId:'video_c',scopeKey:'scene_1',referenceText:'the bunny',referenceKey:'the bunny',requestedSpecies:'rabbit',status:'ambiguous',characterId:null,matchMode:'character_context_ambiguous',confidence:0,candidateCharacterIds:['luna','star'],reason:'multiple'},
    r2:{id:'r2',namespace:'default',productionId:'video_c',scopeKey:'scene_2',referenceText:'Luna hero',referenceKey:'luna hero',requestedSpecies:'rabbit',status:'unresolved',characterId:null,matchMode:null,confidence:0,candidateCharacterIds:[],reason:'none'}
  };
  const actions=[];
  const db = {
    async listPersistentCharacters(){ return Object.values(characters); }, async getPersistentCharacter(id){ return characters[id]||null; },
    async listPersistentCharacterAliases(id){ return aliases.filter(a=>a.characterId===id); }, async listPersistentCharacterAliasesByKey(ns,key){ return aliases.filter(a=>a.namespace===ns&&a.aliasKey===key); },
    async listPersistentCharacterAssets(id){ return assets[id]||[]; }, async listPersistentCharacterUsages(id){ return usages[id]||[]; }, async listPersistentCharacterAppearanceStates(id){ return states[id]||[]; },
    async listPersistentCharacterBindingsByCharacter(id){ return bindings[id]||[]; }, async listCrossVideoCharacterContinuityChecksByCharacter(id){ return checks[id]||[]; },
    async listPersistentCharacterResolutionsByCharacter(id){ return Object.values(resolutions).filter(r=>r.characterId===id); }, async getPersistentCharacterResolution(id){ return resolutions[id] ? {...resolutions[id]} : null; },
    async listPendingPersistentCharacterResolutions(){ return Object.values(resolutions).filter(r=>['unresolved','ambiguous'].includes(r.status)).map(r=>({...r})); },
    async savePersistentCharacterOperatorAlias(input){ const foreign=aliases.filter(a=>a.namespace===input.namespace&&a.aliasKey===input.aliasKey&&a.characterId!==input.characterId); if(foreign.length)return{status:'conflict',alias:null,conflictingCharacterIds:foreign.map(a=>a.characterId)}; const same=aliases.find(a=>a.namespace===input.namespace&&a.aliasKey===input.aliasKey&&a.characterId===input.characterId); if(same)return{status:'no_change',alias:{...same},conflictingCharacterIds:[]}; const row={id:`a${aliases.length+1}`,...input}; aliases.push(row); return{status:'applied',alias:{...row},conflictingCharacterIds:[]}; },
    async linkPersistentCharacterResolutionOperator(input){ const before=resolutions[input.resolutionId]; if(!before)return{status:'not_found',resolution:null}; if(before.status==='resolved'&&before.characterId!==input.characterId)return{status:'conflict',resolution:{...before},reason:'resolution_concurrently_linked_to_different_character',currentCharacterId:before.characterId}; const same=before.status==='resolved'&&before.characterId===input.characterId; Object.assign(before,{status:'resolved',characterId:input.characterId,matchMode:'operator_explicit_link',confidence:1,candidateCharacterIds:[input.characterId],reason:'operator_confirmed_reference_link',identityFingerprint:input.identityFingerprint}); return{status:same?'no_change':'applied',resolution:{...before}}; },
    async savePersistentCharacterOperatorAction(row){ const saved={id:`op${actions.length+1}`,createdAt:new Date().toISOString(),...row}; actions.push(saved); return {...saved}; }, async listPersistentCharacterOperatorActions(characterId){ return characterId?actions.filter(a=>a.characterId===characterId):actions; }
  };
  const manager = new PersistentCharacterLibraryManagerV11(db, {});
  let snapshot = await manager.getSnapshot('default');
  check('snapshot active', () => assert.strictEqual(snapshot.active,true));
  check('snapshot sees two characters', () => assert.strictEqual(snapshot.summary.characterCount,2));
  check('snapshot counts canonical ready', () => assert.strictEqual(snapshot.summary.canonicalReady,1));
  check('snapshot counts cross video characters', () => assert.strictEqual(snapshot.summary.crossVideoCharacters,1));
  check('snapshot counts blocked continuity', () => assert.strictEqual(snapshot.summary.blockedContinuity,1));
  check('snapshot includes pending resolutions', () => assert.strictEqual(snapshot.pendingResolutions.length,2));
  const detail = await manager.detail('luna');
  check('detail exposes canonical character unchanged', () => assert.strictEqual(detail.character.identityFingerprint,'fp_luna'));
  check('detail exposes appearance state', () => assert.strictEqual(detail.states[0].wardrobe,'raincoat'));
  check('detail exposes shot bindings', () => assert.strictEqual(detail.bindings.length,1));
  check('detail exposes continuity checks', () => assert.strictEqual(detail.continuityChecks.length,1));
  let result = await manager.addAlias({characterId:'luna',aliasText:'Moon Bunny',actor:'tester'});
  check('safe alias applied', () => assert.strictEqual(result.status,'applied'));
  check('safe alias stored on Luna', () => assert(aliases.some(a=>a.aliasKey==='moon bunny'&&a.characterId==='luna')));
  result = await manager.addAlias({characterId:'luna',aliasText:'Moon Bunny',actor:'tester'});
  check('duplicate same alias no change', () => assert.strictEqual(result.status,'no_change'));
  aliases.push({id:'a_foreign',namespace:'default',characterId:'star',aliasText:'Hero Bunny',aliasKey:'hero bunny'});
  result = await manager.addAlias({characterId:'luna',aliasText:'Hero Bunny',actor:'tester'});
  check('foreign alias collision fails closed', () => assert.strictEqual(result.status,'conflict'));
  check('alias collision audited rejected', () => assert(actions.some(a=>a.actionType==='add_alias'&&a.status==='rejected')));
  const originalFingerprint=characters.luna.identityFingerprint; const originalIdentity=JSON.stringify(characters.luna.canonicalIdentity);
  result = await manager.linkResolution({resolutionId:'r1',characterId:'luna',persistAlias:false,actor:'tester'});
  check('ambiguous resolution explicitly linked', () => assert.strictEqual(result.status,'applied'));
  check('resolution becomes operator explicit link', () => assert.strictEqual(resolutions.r1.matchMode,'operator_explicit_link'));
  check('operator link confidence is one', () => assert.strictEqual(resolutions.r1.confidence,1));
  check('operator link does not mutate fingerprint', () => assert.strictEqual(characters.luna.identityFingerprint,originalFingerprint));
  check('operator link does not mutate canonical identity', () => assert.strictEqual(JSON.stringify(characters.luna.canonicalIdentity),originalIdentity));
  result = await manager.linkResolution({resolutionId:'r1',characterId:'star',actor:'tester'});
  check('retarget of resolved reference blocked', () => assert.strictEqual(result.status,'conflict'));
  result = await manager.linkResolution({resolutionId:'r2',characterId:'luna',persistAlias:true,actor:'tester'});
  check('resolution can persist safe alias', () => assert.strictEqual(result.status,'applied'));
  check('resolution alias persisted', () => assert(aliases.some(a=>a.aliasKey==='luna hero'&&a.characterId==='luna')));
  check('operator link actions audited', () => assert(actions.some(a=>a.actionType==='link_resolution'&&a.status==='applied')));
}

runtimeChecks().then(() => console.log(`Phase 11.11.7 Character Library UI + Operator Controls OK: ${count} regression checks passed.`)).catch(error => { console.error(error); process.exitCode=1; });
