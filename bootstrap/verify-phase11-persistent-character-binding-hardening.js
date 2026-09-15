'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-character-binding-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.5 runtime is not materialized');
const { PersistentCharacterBindingV11, mergeRowsForShot, bindingFingerprint } = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

check('database exposes production binding prune', () => assert(dbSource.includes('async pruneProductionPersistentCharacterBindings(productionId, keepIds = [])')));
check('empty keep-set deletes every stale binding for production', () => assert(dbSource.includes("DELETE FROM persistent_character_bindings WHERE production_id = ?")));
check('non-empty keep-set prunes ids outside current set', () => assert(dbSource.includes('id NOT IN (${placeholders})')));
check('runtime invokes prune after binding persistence', () => assert(runtimeSource.includes('pruneProductionPersistentCharacterBindings(production.id, persisted.map(row => row?.id).filter(Boolean))')));
check('runtime records conflicting explicit fields', () => assert(runtimeSource.includes('conflictFields')));
check('runtime recomputes merged binding fingerprint', () => assert(runtimeSource.includes('merged.bindingFingerprint = bindingFingerprint(merged)')));

const base = {
  id:'b1', productionId:'video', sceneId:'scene', shotId:'shot', shotIndex:0,
  characterId:'char_luna', characterKey:'luna_main', status:'resolved', referenceText:'Luna', referenceKey:'luna',
  matchMode:'character_id_exact', confidence:1, visibility:'visible', placement:null, action:null, expression:null,
  required:true, stateId:null, stateFingerprint:null, canonicalAssetId:null, canonicalAssetSha256:null,
  sourceKind:'scene_characterBindings', sourceRef:null, reason:null
};
base.bindingFingerprint = bindingFingerprint(base);

const complementary = mergeRowsForShot([
  { ...base, id:'c1', placement:'foreground', bindingFingerprint:bindingFingerprint({ ...base, placement:'foreground' }) },
  { ...base, id:'c2', expression:'happy', bindingFingerprint:bindingFingerprint({ ...base, expression:'happy' }) }
]);
check('complementary explicit rows merge to one binding', () => assert.strictEqual(complementary.resolved.length, 1));
check('complementary merge preserves placement', () => assert.strictEqual(complementary.resolved[0].placement, 'foreground'));
check('complementary merge preserves expression', () => assert.strictEqual(complementary.resolved[0].expression, 'happy'));
check('complementary merge recomputes fingerprint', () => assert.strictEqual(complementary.resolved[0].bindingFingerprint, bindingFingerprint(complementary.resolved[0])));
check('complementary merge has no conflict', () => assert.strictEqual(complementary.conflicts.length, 0));

const conflict = mergeRowsForShot([
  { ...base, id:'v1', visibility:'visible' },
  { ...base, id:'v2', visibility:'offscreen', sourceKind:'scene_shotCharacterBindings' }
]);
check('contradictory visibility remains fail-closed', () => assert.strictEqual(conflict.resolved.length, 0));
check('contradictory visibility creates one conflict', () => assert.strictEqual(conflict.conflicts.length, 1));
check('conflict identifies visibility field', () => assert(conflict.conflicts[0].conflictFields.includes('visibility')));

async function runtimeChecks() {
  const rows = new Map();
  const pruneCalls = [];
  const db = {
    async listPersistentCharacterAliasesByKey() { return []; },
    async savePersistentCharacterBinding(row) { rows.set(row.id, { ...row }); return { ...row }; },
    async pruneProductionPersistentCharacterBindings(productionId, keepIds) {
      pruneCalls.push({ productionId, keepIds:[...keepIds] });
      const keep = new Set(keepIds);
      for (const [id, row] of rows) if (row.productionId === productionId && !keep.has(id)) rows.delete(id);
      return true;
    }
  };
  const characterPlan = { active:true, characters:[{
    character:{ id:'char_luna', namespace:'series', characterKey:'luna_main', displayName:'Luna', speciesType:'rabbit', identityFingerprint:'ifp_luna' },
    usage:{ sourceCharacterId:'bible_luna', sourceBibleId:'bible_a' }
  }]};
  const makePlan = characters => ({ fingerprint:'prod_fp', scenes:[{ sceneId:'scene_1', scenePosition:0, fingerprint:'scene_fp', shots:[{
    id:'shot_1', sceneId:'scene_1', shotIndex:0, characters, action:'wave', expression:'happy', prompt:'BASE', fingerprint:'shot_fp', planFingerprint:'scene_fp'
  }] }] });
  const binder = new PersistentCharacterBindingV11(db, { enabled:true, useShotPlannerCast:true });

  const first = await binder.bindShotPlan({ production:{id:'video_replace'}, scenes:[{id:'scene_1',position:0}], shotPlan:makePlan(['bible_luna']), characterPlan });
  check('first plan persists one current binding', () => assert.strictEqual(first.bindings.length, 1));
  check('first plan leaves one row in storage', () => assert.strictEqual([...rows.values()].filter(row => row.productionId === 'video_replace').length, 1));
  check('first plan prunes using its persisted id', () => assert.strictEqual(pruneCalls.at(-1).keepIds.length, 1));

  const second = await binder.bindShotPlan({ production:{id:'video_replace'}, scenes:[{id:'scene_1',position:0}], shotPlan:makePlan([]), characterPlan });
  check('second plan has zero current bindings after cast removal', () => assert.strictEqual(second.bindings.length, 0));
  check('second plan prunes stale prior binding', () => assert.strictEqual([...rows.values()].filter(row => row.productionId === 'video_replace').length, 0));
  check('empty current plan calls prune with empty keep-set', () => assert.deepStrictEqual(pruneCalls.at(-1).keepIds, []));

  await binder.bindShotPlan({ production:{id:'video_conflict'}, scenes:[{id:'scene_1',position:0}], shotPlan:makePlan(['bible_luna']), characterPlan });
  check('conflict scenario starts with persisted visible binding', () => assert.strictEqual([...rows.values()].filter(row => row.productionId === 'video_conflict').length, 1));
  const conflictPlan = makePlan([]);
  const conflicted = await binder.bindShotPlan({
    production:{id:'video_conflict'},
    scenes:[{ id:'scene_1', position:0, characterBindings:[
      { characterId:'char_luna', visibility:'visible', shotIndex:0 },
      { characterId:'char_luna', visibility:'offscreen', shotIndex:0 }
    ]}],
    shotPlan:conflictPlan,
    characterPlan
  });
  check('contradictory rerun reports conflict', () => assert.strictEqual(conflicted.summary.conflicts, 1));
  check('contradictory rerun persists no resolved binding', () => assert.strictEqual(conflicted.bindings.length, 0));
  check('contradictory rerun removes stale previously valid row', () => assert.strictEqual([...rows.values()].filter(row => row.productionId === 'video_conflict').length, 0));

  const complementaryPlan = makePlan([]);
  const merged = await binder.bindShotPlan({
    production:{id:'video_merge'},
    scenes:[{ id:'scene_1', position:0, characterBindings:[
      { characterId:'char_luna', visibility:'visible', placement:'foreground', shotIndex:0 },
      { characterId:'char_luna', visibility:'visible', expression:'happy', shotIndex:0 }
    ]}],
    shotPlan:complementaryPlan,
    characterPlan
  });
  check('complementary runtime declarations persist one binding', () => assert.strictEqual(merged.bindings.length, 1));
  check('complementary runtime binding keeps placement', () => assert.strictEqual(merged.bindings[0].placement, 'foreground'));
  check('complementary runtime binding keeps expression', () => assert.strictEqual(merged.bindings[0].expression, 'happy'));
  check('complementary runtime prompt includes placement', () => assert(merged.shotPlan.scenes[0].shots[0].prompt.includes('PLACEMENT: foreground')));
  check('complementary runtime prompt includes expression', () => assert(merged.shotPlan.scenes[0].shots[0].prompt.includes('EXPRESSION: happy')));
}

runtimeChecks().then(() => console.log(`Phase 11.11.5 Character Binding Hardening OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
