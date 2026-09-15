'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-character-binding-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.5 runtime is not materialized');
const {
  PERSISTENT_CHARACTER_BINDING_VERSION,
  PersistentCharacterBindingV11,
  normalizeVisibility,
  declarationFromRaw,
  collectExplicitDeclarations,
  collectShotPlannerDeclarations,
  shotTargets,
  bindingFingerprint,
  bindingPromptFragment,
  mergeRowsForShot
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.11.5', () => assert.strictEqual(PERSISTENT_CHARACTER_BINDING_VERSION, '11.11.5'));
check('not visible normalizes offscreen', () => assert.strictEqual(normalizeVisibility('not visible'), 'offscreen'));
check('partial normalizes occluded', () => assert.strictEqual(normalizeVisibility('partial'), 'occluded'));
check('mention normalizes mentioned', () => assert.strictEqual(normalizeVisibility('mention'), 'mentioned'));
check('declaration accepts string reference', () => assert.strictEqual(declarationFromRaw('Luna').reference, 'Luna'));
check('declaration accepts shot indexes', () => assert.deepStrictEqual(declarationFromRaw({ characterKey:'luna', shotIndexes:[2,0,2] }).shotIndexes, [0,2]));
check('declaration defaults visible', () => assert.strictEqual(declarationFromRaw({ characterKey:'luna' }).visibility, 'visible'));
check('declaration can explicitly forbid visual presence', () => assert.strictEqual(declarationFromRaw({ characterKey:'luna', visible:false }).visibility, 'offscreen'));
check('declaration preserves source character id', () => assert.strictEqual(declarationFromRaw({ sourceCharacterId:'bible_luna' }).sourceCharacterId, 'bible_luna'));

const explicit = collectExplicitDeclarations([{ id:'s1', position:0, characterBindings:[{ characterKey:'luna' }], shotCharacterBindings:[{ characterKey:'star', shotIndex:1 }] }]);
check('explicit scene declarations collected', () => assert.strictEqual(explicit.length, 2));
check('explicit scene id injected', () => assert(explicit.every(row => row.sceneId === 's1')));

const miniPlan = { scenes:[{ sceneId:'s1', scenePosition:0, shots:[
  { id:'a', shotIndex:0, characters:['bible_luna'], action:'wave', expression:'happy' },
  { id:'b', shotIndex:1, characters:['bible_star'], action:'look', expression:'curious' }
]}]};
const plannerDecls = collectShotPlannerDeclarations(miniPlan);
check('shot planner cast becomes declarations', () => assert.strictEqual(plannerDecls.length, 2));
check('shot planner declaration is visible', () => assert(plannerDecls.every(row => row.visibility === 'visible')));
check('shot planner declaration targets exact shot', () => assert.deepStrictEqual(plannerDecls[1].shotIndexes, [1]));
check('shot planner action preserved', () => assert.strictEqual(plannerDecls[0].action, 'wave'));
check('scene binding targets all shots by default', () => assert.strictEqual(shotTargets(declarationFromRaw({ characterKey:'luna' }, { sceneId:'s1' }), miniPlan).shots.length, 2));
check('shot-specific binding targets one shot', () => assert.strictEqual(shotTargets(declarationFromRaw({ characterKey:'luna', shotIndex:1 }, { sceneId:'s1' }), miniPlan).shots[0].id, 'b'));
check('unknown shot index fails closed', () => assert.strictEqual(shotTargets(declarationFromRaw({ characterKey:'luna', shotIndex:9 }, { sceneId:'s1' }), miniPlan).status, 'unresolved'));

const fp = { characterId:'char_luna', sceneId:'s1', shotId:'a', visibility:'visible', placement:'foreground', action:'wave', expression:'happy', stateFingerprint:'sf', canonicalAssetSha256:'sha' };
check('binding fingerprint deterministic', () => assert.strictEqual(bindingFingerprint(fp), bindingFingerprint(fp)));
check('visibility changes fingerprint', () => assert.notStrictEqual(bindingFingerprint(fp), bindingFingerprint({ ...fp, visibility:'offscreen' })));
check('appearance state changes fingerprint', () => assert.notStrictEqual(bindingFingerprint(fp), bindingFingerprint({ ...fp, stateFingerprint:'sf2' })));
check('canonical asset changes fingerprint', () => assert.notStrictEqual(bindingFingerprint(fp), bindingFingerprint({ ...fp, canonicalAssetSha256:'sha2' })));
check('visible prompt requires exact character', () => assert(bindingPromptFragment({ ...fp, status:'resolved', characterKey:'luna_main' }).includes('Render this exact persistent character identity')));
check('visible prompt protects canonical face', () => assert(bindingPromptFragment({ ...fp, status:'resolved' }).includes('canonical face')));
check('offscreen prompt forbids rendering', () => assert(bindingPromptFragment({ ...fp, status:'resolved', visibility:'offscreen' }).includes('Do NOT render this character')));
check('prompt rejects similar replacement', () => assert(bindingPromptFragment({ ...fp, status:'resolved' }).includes('merely similar same-species character')));

const derived = { ...fp, status:'resolved', sourceKind:'shot_planner_character' };
const override = { ...fp, status:'resolved', sourceKind:'scene_characterBindings', visibility:'offscreen' };
check('explicit binding overrides derived shot-planner cast', () => assert.strictEqual(mergeRowsForShot([derived, override]).resolved[0].visibility, 'offscreen'));
check('derived row is dropped when explicit override exists', () => assert.strictEqual(mergeRowsForShot([derived, override]).resolved.length, 1));
check('contradictory explicit bindings fail closed', () => assert.strictEqual(mergeRowsForShot([override, { ...override, visibility:'visible', sourceKind:'scene_shotCharacterBindings' }]).conflicts.length, 1));
check('identical duplicate explicit bindings dedupe', () => assert.strictEqual(mergeRowsForShot([override, { ...override }]).resolved.length, 1));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns character binding table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_character_bindings'],
  ['binding references persistent character', dbSource, 'FOREIGN KEY (character_id) REFERENCES persistent_characters(id) ON DELETE SET NULL'],
  ['binding references appearance state', dbSource, 'FOREIGN KEY (state_id) REFERENCES persistent_character_appearance_states(id) ON DELETE SET NULL'],
  ['binding references canonical character asset', dbSource, 'FOREIGN KEY (canonical_asset_id) REFERENCES persistent_character_assets(id) ON DELETE SET NULL'],
  ['database saves character binding', dbSource, 'async savePersistentCharacterBinding(input = {})'],
  ['database lists production character bindings', dbSource, 'async listProductionPersistentCharacterBindings(productionId)'],
  ['database lists shot character bindings', dbSource, 'async listShotPersistentCharacterBindings(productionId, shotId)'],
  ['bundle loads character bindings', dbSource, 'const persistentCharacterBindings = await this.listProductionPersistentCharacterBindings(productionId);'],
  ['bundle exposes character bindings', dbSource, 'persistentCharacterBindings,'],
  ['pipeline imports character binder', pipelineSource, "PersistentCharacterBindingV11 } = require('./persistent-character-binding-v11')"],
  ['pipeline constructs character binder', pipelineSource, 'this.persistentCharacterBindings = options.persistentCharacterBindings || new PersistentCharacterBindingV11'],
  ['pipeline calls character binder', pipelineSource, 'this.persistentCharacterBindings.bindShotPlan({ production, scenes, shotPlan, characterPlan: persistentCharacterPlan, statePlan: persistentCharacterAppearanceStatePlan, assetPlan: canonicalCharacterAssetPlan })'],
  ['dashboard shows character binding panel', dashboardSource, 'SCENE / SHOT CHARACTER BINDING V11.11.5'],
  ['dashboard documents shot planner cast resolution', dashboardSource, 'Shot Planner cast is resolved to persistent characterId'],
  ['env enables character bindings', envSource, 'PERSISTENT_CHARACTER_BINDINGS_ENABLED=true'],
  ['env enables shot planner cast binding', envSource, 'PERSISTENT_CHARACTER_BINDINGS_USE_SHOT_PLANNER_CAST=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes character binding verifier', () => assert.strictEqual(pkg.scripts['test:persistent-character-binding'], 'node ../bootstrap/verify-phase11-persistent-character-binding.js'));
check('character binder runs after shot planner', () => assert(pipelineSource.indexOf('shotPlan = this.shotPlanner.planProduction') < pipelineSource.indexOf('this.persistentCharacterBindings.bindShotPlan')));
check('character binder runs after object binder', () => assert(pipelineSource.indexOf('this.persistentWorldObjectBindings.bindShotPlan') < pipelineSource.indexOf('this.persistentCharacterBindings.bindShotPlan')));
check('character binder runs before shot persistence', () => assert(pipelineSource.indexOf('this.persistentCharacterBindings.bindShotPlan') < pipelineSource.indexOf('await this.db.replaceSceneShots')));

async function runtimeChecks() {
  const saved = [];
  const aliases = [
    { namespace:'series', aliasKey:'lua', characterId:'char_luna' },
    { namespace:'series', aliasKey:'estrela', characterId:'char_star' }
  ];
  const db = {
    async listPersistentCharacterAliasesByKey(namespace, aliasKey) { return aliases.filter(row => row.namespace === namespace && row.aliasKey === aliasKey); },
    async savePersistentCharacterBinding(row) { saved.push({ ...row }); return { ...row }; }
  };
  const luna = { id:'char_luna', namespace:'series', characterKey:'luna_main', displayName:'Luna', speciesType:'rabbit', identityFingerprint:'ifp_luna' };
  const star = { id:'char_star', namespace:'series', characterKey:'star_main', displayName:'Star', speciesType:'rabbit', identityFingerprint:'ifp_star' };
  const characterPlan = { active:true, characters:[
    { character:luna, usage:{ sourceCharacterId:'bible_luna', sourceBibleId:'bible_a' } },
    { character:star, usage:{ sourceCharacterId:'bible_star', sourceBibleId:'bible_a' } }
  ]};
  const production = { id:'video_a' };
  const scenes = [{ id:'scene_1', position:0, characterBindings:[
    { reference:'lua', visibility:'occluded', placement:'behind tree', shotIndex:1 }
  ]}];
  const shotPlan = { version:'11.2', productionId:'video_a', fingerprint:'prod_fp', scenes:[{
    sceneId:'scene_1', scenePosition:0, fingerprint:'scene_fp', shots:[
      { id:'shot_0', sceneId:'scene_1', shotIndex:0, characters:['bible_luna'], action:'Luna waves', expression:'happy', prompt:'BASE 0', fingerprint:'fp0', planFingerprint:'scene_fp' },
      { id:'shot_1', sceneId:'scene_1', shotIndex:1, characters:['bible_luna','bible_star'], action:'They hide', expression:'curious', prompt:'BASE 1', fingerprint:'fp1', planFingerprint:'scene_fp' },
      { id:'shot_2', sceneId:'scene_1', shotIndex:2, characters:[], action:'Empty room', expression:'', prompt:'BASE 2', fingerprint:'fp2', planFingerprint:'scene_fp' }
    ]
  }]};
  const statePlan = { active:true, states:[
    { id:'state_luna', characterId:'char_luna', sceneId:'scene_1', stateFingerprint:'state_fp_luna', wardrobe:'yellow raincoat' }
  ]};
  const assetPlan = { active:true, assets:[
    { id:'asset_luna', characterId:'char_luna', status:'ready', canonical:true, assetSha256:'sha_luna' },
    { id:'asset_star', characterId:'char_star', status:'ready', canonical:true, assetSha256:'sha_star' }
  ]};
  const binder = new PersistentCharacterBindingV11(db, { enabled:true, useShotPlannerCast:true });
  const out = await binder.bindShotPlan({ production, scenes, shotPlan, characterPlan, statePlan, assetPlan });

  check('shot planner cast resolves to persistent characters', () => assert(saved.some(row => row.characterId === 'char_luna' && row.matchMode === 'source_character_id_exact')));
  check('alias resolves explicit override', () => assert(saved.some(row => row.characterId === 'char_luna' && row.matchMode === 'character_alias_exact')));
  check('star source id resolves', () => assert(saved.some(row => row.characterId === 'char_star' && row.matchMode === 'source_character_id_exact')));
  check('visible shot prompt includes Luna character id', () => assert(out.shotPlan.scenes[0].shots[0].prompt.includes('CHARACTER ID: char_luna')));
  check('visible shot includes canonical character asset', () => assert(out.shotPlan.scenes[0].shots[0].prompt.includes('CANONICAL CHARACTER ASSET: asset_luna')));
  check('visible shot includes appearance state fingerprint', () => assert(out.shotPlan.scenes[0].shots[0].prompt.includes('state_fp_luna')));
  check('explicit occluded override wins on shot 1 Luna', () => assert(saved.some(row => row.shotId === 'shot_1' && row.characterId === 'char_luna' && row.visibility === 'occluded' && row.sourceKind !== 'shot_planner_character')));
  check('shot 1 still binds Star visibly', () => assert(saved.some(row => row.shotId === 'shot_1' && row.characterId === 'char_star' && row.visibility === 'visible')));
  check('empty shot receives no character prompt', () => assert.strictEqual(out.shotPlan.scenes[0].shots[2].prompt, 'BASE 2'));
  check('shot fingerprint changes when binding added', () => assert.notStrictEqual(out.shotPlan.scenes[0].shots[0].fingerprint, 'fp0'));
  check('scene fingerprint changes when binding added', () => assert.notStrictEqual(out.shotPlan.scenes[0].fingerprint, 'scene_fp'));
  check('production fingerprint changes when binding added', () => assert.notStrictEqual(out.shotPlan.fingerprint, 'prod_fp'));
  check('shot plan records character binding version', () => assert.strictEqual(out.shotPlan.characterBindingVersion, '11.11.5'));
  check('summary counts visual bindings', () => assert(out.summary.visible >= 3));
  check('summary has no unresolved references', () => assert.strictEqual(out.summary.unresolved, 0));

  const offscreenScenes = [{ id:'s2', characterBindings:[{ characterId:'char_luna', visibility:'offscreen', shotIndex:0 }] }];
  const offscreenPlan = { fingerprint:'p2', scenes:[{ sceneId:'s2', scenePosition:0, fingerprint:'sp2', shots:[{ id:'sh2', shotIndex:0, characters:['bible_luna'], prompt:'BASE', fingerprint:'f2', planFingerprint:'sp2' }] }] };
  const offscreen = await binder.bindShotPlan({ production:{id:'video_off'}, scenes:offscreenScenes, shotPlan:offscreenPlan, characterPlan, statePlan, assetPlan });
  check('explicit offscreen overrides derived visibility', () => assert(offscreen.bindings.some(row => row.characterId === 'char_luna' && row.visibility === 'offscreen')));
  check('offscreen shot forbids rendering character', () => assert(offscreen.shotPlan.scenes[0].shots[0].prompt.includes('Do NOT render this character')));
  check('offscreen binding counted nonvisual', () => assert.strictEqual(offscreen.summary.nonvisual, 1));

  const noCastPlan = { fingerprint:'pn', scenes:[{ sceneId:'sn', scenePosition:0, fingerprint:'spn', shots:[{ id:'shn', shotIndex:0, characters:[], prompt:'BASE', fingerprint:'fn', planFingerprint:'spn' }] }] };
  const noCast = await binder.bindShotPlan({ production:{id:'video_narrative'}, scenes:[{ id:'sn', scriptText:'Luna is mentioned in narration.' }], shotPlan:noCastPlan, characterPlan });
  check('narrative text alone creates no binding', () => assert.strictEqual(noCast.summary.resolved, 0));
  check('narrative text alone leaves prompt unchanged', () => assert.strictEqual(noCast.shotPlan.scenes[0].shots[0].prompt, 'BASE'));

  const ambiguousPlan = { active:true, characters:[
    { character:{ id:'ca', namespace:'series', characterKey:'a', displayName:'Twin', identityFingerprint:'fa' }, usage:{} },
    { character:{ id:'cb', namespace:'series', characterKey:'b', displayName:'Twin', identityFingerprint:'fb' }, usage:{} }
  ]};
  const amb = await binder.bindShotPlan({
    production:{id:'video_amb'}, scenes:[{ id:'sa', characterBindings:[{ reference:'Twin', shotIndex:0 }] }],
    shotPlan:{ fingerprint:'pa', scenes:[{ sceneId:'sa', scenePosition:0, fingerprint:'spa', shots:[{ id:'sha', shotIndex:0, characters:[], prompt:'BASE', fingerprint:'fa', planFingerprint:'spa' }] }] },
    characterPlan:ambiguousPlan
  });
  check('ambiguous character name fails closed', () => assert.strictEqual(amb.summary.ambiguous, 1));
  check('ambiguous character name persists no binding', () => assert(!saved.some(row => row.productionId === 'video_amb')));

  const conflict = await binder.bindShotPlan({
    production:{id:'video_conflict'}, scenes:[{ id:'sc', characterBindings:[
      { characterId:'char_luna', visibility:'visible', shotIndex:0 },
      { characterId:'char_luna', visibility:'offscreen', shotIndex:0 }
    ]}],
    shotPlan:{ fingerprint:'pc', scenes:[{ sceneId:'sc', scenePosition:0, fingerprint:'spc', shots:[{ id:'shc', shotIndex:0, characters:[], prompt:'BASE', fingerprint:'fc', planFingerprint:'spc' }] }] },
    characterPlan
  });
  check('contradictory explicit character bindings conflict', () => assert.strictEqual(conflict.summary.conflicts, 1));
  check('conflicting character binding does not enrich prompt', () => assert.strictEqual(conflict.shotPlan.scenes[0].shots[0].prompt, 'BASE'));

  const disabled = await new PersistentCharacterBindingV11(db, { enabled:false }).bindShotPlan({ production, scenes, shotPlan, characterPlan });
  check('disabled character binder inactive', () => assert.strictEqual(disabled.active, false));
}

runtimeChecks().then(() => console.log(`Phase 11.11.5 Scene / Shot Character Binding OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
