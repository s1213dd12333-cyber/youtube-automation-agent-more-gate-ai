'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-world-object-binding-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.5 runtime is not materialized');
const {
  PERSISTENT_WORLD_OBJECT_BINDING_VERSION,
  PersistentWorldObjectBindingV11,
  normalizeVisibility,
  normalizeInteraction,
  declarationFromRaw,
  collectSceneDeclarations,
  shotTargets,
  resolveObjectReference,
  bindingFingerprint,
  bindingPromptFragment,
  mergeRowsForShot
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.10.5', () => assert.strictEqual(PERSISTENT_WORLD_OBJECT_BINDING_VERSION, '11.10.5'));
check('not visible normalizes offscreen', () => assert.strictEqual(normalizeVisibility('not visible'), 'offscreen'));
check('partial normalizes occluded', () => assert.strictEqual(normalizeVisibility('partial'), 'occluded'));
check('mention normalizes mentioned', () => assert.strictEqual(normalizeVisibility('mention'), 'mentioned'));
check('holding normalizes held', () => assert.strictEqual(normalizeInteraction('holding'), 'held'));
check('driving normalizes operated', () => assert.strictEqual(normalizeInteraction('driving'), 'operated'));
check('declaration accepts shot indexes', () => assert.deepStrictEqual(declarationFromRaw({ objectKey: 'car', shotIndexes: [2, 0, 2] }).shotIndexes, [0, 2]));
check('declaration defaults visible', () => assert.strictEqual(declarationFromRaw({ objectKey: 'car' }).visibility, 'visible'));
check('declaration can explicitly forbid visual presence', () => assert.strictEqual(declarationFromRaw({ objectKey: 'car', visible: false }).visibility, 'offscreen'));

const sceneDecls = collectSceneDeclarations([{ id: 's1', position: 0, objectBindings: [{ objectKey: 'car' }], shotObjectBindings: [{ objectKey: 'phone', shotIndex: 1 }] }], null);
check('scene declarations collected', () => assert.strictEqual(sceneDecls.length, 2));
check('scene id injected into declarations', () => assert(sceneDecls.every(item => item.sceneId === 's1')));

const miniPlan = { scenes: [{ sceneId: 's1', scenePosition: 0, shots: [{ id: 'a', shotIndex: 0 }, { id: 'b', shotIndex: 1 }] }] };
check('scene binding targets all shots by default', () => assert.strictEqual(shotTargets(declarationFromRaw({ objectKey: 'car' }, { sceneId: 's1' }), miniPlan).shots.length, 2));
check('shot-specific binding targets one shot', () => assert.strictEqual(shotTargets(declarationFromRaw({ objectKey: 'car', shotIndex: 1 }, { sceneId: 's1' }), miniPlan).shots[0].id, 'b'));
check('unknown shot index fails closed', () => assert.strictEqual(shotTargets(declarationFromRaw({ objectKey: 'car', shotIndex: 9 }, { sceneId: 's1' }), miniPlan).status, 'unresolved'));

const fpRow = { objectId: 'o1', sceneId: 's1', shotId: 'a', visibility: 'visible', interaction: 'held', stateFingerprint: 'sf', canonicalAssetSha256: 'sha' };
check('binding fingerprint deterministic', () => assert.strictEqual(bindingFingerprint(fpRow), bindingFingerprint(fpRow)));
check('visibility changes binding fingerprint', () => assert.notStrictEqual(bindingFingerprint(fpRow), bindingFingerprint({ ...fpRow, visibility: 'offscreen' })));
check('visible prompt requires exact object', () => assert(bindingPromptFragment({ ...fpRow, status: 'resolved', objectKey: 'car' }).includes('Render this exact persistent object identity')));
check('offscreen prompt forbids rendering', () => assert(bindingPromptFragment({ ...fpRow, status: 'resolved', visibility: 'offscreen' }).includes('Do NOT render this object')));
check('conflicting duplicate bindings fail closed', () => assert.strictEqual(mergeRowsForShot([{ ...fpRow, status: 'resolved' }, { ...fpRow, status: 'resolved', visibility: 'offscreen' }]).conflicts.length, 1));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns binding table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_bindings'],
  ['binding references persistent object', dbSource, 'FOREIGN KEY (object_id) REFERENCES persistent_world_objects(id) ON DELETE SET NULL'],
  ['binding references state', dbSource, 'FOREIGN KEY (state_id) REFERENCES persistent_world_object_states(id) ON DELETE SET NULL'],
  ['binding references canonical asset', dbSource, 'FOREIGN KEY (canonical_asset_id) REFERENCES persistent_world_object_assets(id) ON DELETE SET NULL'],
  ['database saves binding', dbSource, 'async savePersistentWorldObjectBinding(input = {})'],
  ['database lists production bindings', dbSource, 'async listProductionPersistentWorldObjectBindings(productionId)'],
  ['bundle loads bindings', dbSource, 'const persistentWorldObjectBindings = await this.listProductionPersistentWorldObjectBindings(productionId);'],
  ['bundle exposes bindings', dbSource, 'persistentWorldObjectBindings,'],
  ['pipeline imports binder', pipelineSource, "PersistentWorldObjectBindingV11 } = require('./persistent-world-object-binding-v11')"],
  ['pipeline constructs binder', pipelineSource, 'this.persistentWorldObjectBindings = options.persistentWorldObjectBindings || new PersistentWorldObjectBindingV11'],
  ['pipeline calls binder after shot planning', pipelineSource, 'this.persistentWorldObjectBindings.bindShotPlan({ production, scenes, shotPlan, environmentBible, objectPlan: persistentWorldObjectPlan, statePlan: persistentWorldObjectStatePlan, assetPlan: canonicalWorldObjectAssetPlan })'],
  ['dashboard shows binding panel', dashboardSource, 'SCENE / SHOT OBJECT BINDING V11.10.5'],
  ['dashboard states narrative mention does not imply presence', dashboardSource, 'Narrative mention alone never creates visual presence'],
  ['env enables bindings', envSource, 'PERSISTENT_WORLD_OBJECT_BINDINGS_ENABLED=true'],
  ['env requires explicit binding', envSource, 'PERSISTENT_WORLD_OBJECT_BINDINGS_REQUIRE_EXPLICIT=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes binding verifier', () => assert.strictEqual(pkg.scripts['test:persistent-world-object-binding'], 'node ../bootstrap/verify-phase11-persistent-world-object-binding.js'));
check('binder runs after shot planner', () => assert(pipelineSource.indexOf('shotPlan = this.shotPlanner.planProduction') < pipelineSource.indexOf('this.persistentWorldObjectBindings.bindShotPlan')));
check('binder runs before shot persistence', () => assert(pipelineSource.indexOf('this.persistentWorldObjectBindings.bindShotPlan') < pipelineSource.indexOf('await this.db.replaceSceneShots')));

async function runtimeChecks() {
  const saved = [];
  const aliases = [
    { namespace: 'series', aliasKey: 'family car', objectId: 'obj_car' },
    { namespace: 'series', aliasKey: 'phone', objectId: 'obj_phone' }
  ];
  const db = {
    async listPersistentWorldObjectAliasesByKey(namespace, aliasKey) { return aliases.filter(row => row.namespace === namespace && row.aliasKey === aliasKey); },
    async savePersistentWorldObjectBinding(row) { saved.push({ ...row }); return { ...row }; }
  };
  const binder = new PersistentWorldObjectBindingV11(db, { enabled: true, requireExplicit: true });
  const production = { id: 'video_a' };
  const scenes = [{
    id: 'scene_1', position: 0,
    objectBindings: [
      { reference: 'family car', visibility: 'visible', interaction: 'operated', holderKey: 'miller', placement: 'foreground', shotIndexes: [0] },
      { objectKey: 'phone_x', visibility: 'mentioned', shotIndexes: [1] }
    ]
  }];
  const shotPlan = { version: '11.2', productionId: 'video_a', fingerprint: 'prod_fp', scenes: [{ sceneId: 'scene_1', scenePosition: 0, fingerprint: 'scene_fp', shots: [
    { id: 'shot_0', sceneId: 'scene_1', shotIndex: 0, prompt: 'BASE 0', fingerprint: 'fp0', planFingerprint: 'scene_fp' },
    { id: 'shot_1', sceneId: 'scene_1', shotIndex: 1, prompt: 'BASE 1', fingerprint: 'fp1', planFingerprint: 'scene_fp' }
  ] }] };
  const objectPlan = { active: true, objects: [
    { object: { id: 'obj_car', namespace: 'series', objectKey: 'miller_family_car', displayName: 'Miller Family Car', identityFingerprint: 'ifp_car' }, usage: {} },
    { object: { id: 'obj_phone', namespace: 'series', objectKey: 'phone_x', displayName: 'Family Phone', identityFingerprint: 'ifp_phone' }, usage: {} }
  ] };
  const statePlan = { active: true, states: [{ id: 'state_car', objectId: 'obj_car', sceneId: 'scene_1', stateFingerprint: 'state_fp_car' }] };
  const assetPlan = { active: true, assets: [{ id: 'asset_car', objectId: 'obj_car', status: 'ready', canonical: true, assetSha256: 'sha_car' }] };
  const out = await binder.bindShotPlan({ production, scenes, shotPlan, objectPlan, statePlan, assetPlan });
  check('two explicit bindings resolve', () => assert.strictEqual(out.summary.resolved, 2));
  check('one visible binding counted', () => assert.strictEqual(out.summary.visible, 1));
  check('one nonvisual binding counted', () => assert.strictEqual(out.summary.nonvisual, 1));
  check('car alias resolves to canonical object', () => assert(saved.some(row => row.objectId === 'obj_car' && row.matchMode === 'object_alias_exact')));
  check('phone key resolves exactly', () => assert(saved.some(row => row.objectId === 'obj_phone' && row.matchMode === 'object_key_exact')));
  const first = out.shotPlan.scenes[0].shots[0];
  const second = out.shotPlan.scenes[0].shots[1];
  check('visible shot prompt includes car object id', () => assert(first.prompt.includes('OBJECT ID: obj_car')));
  check('visible shot carries canonical asset', () => assert(first.prompt.includes('CANONICAL OBJECT ASSET: asset_car')));
  check('visible shot carries state fingerprint', () => assert(first.prompt.includes('state_fp_car')));
  check('mentioned shot explicitly forbids rendering phone', () => assert(second.prompt.includes('Do NOT render this object')));
  check('shot fingerprint changes when binding added', () => assert.notStrictEqual(first.fingerprint, 'fp0'));
  check('scene fingerprint changes when binding added', () => assert.notStrictEqual(out.shotPlan.scenes[0].fingerprint, 'scene_fp'));
  check('shot plan fingerprint changes when binding added', () => assert.notStrictEqual(out.shotPlan.fingerprint, 'prod_fp'));
  check('shot plan records binding version', () => assert.strictEqual(out.shotPlan.objectBindingVersion, '11.10.5'));

  const noExplicit = await binder.bindShotPlan({ production: { id: 'video_no_bind' }, scenes: [{ id: 's2', position: 0, scriptText: 'The family car appears in narration.' }], shotPlan: { fingerprint: 'x', scenes: [{ sceneId: 's2', scenePosition: 0, fingerprint: 'y', shots: [{ id: 'sx', shotIndex: 0, prompt: 'BASE', fingerprint: 'z', planFingerprint: 'y' }] }] }, objectPlan, statePlan: null, assetPlan: null });
  check('narrative mention alone creates zero bindings', () => assert.strictEqual(noExplicit.summary.resolved, 0));
  check('narrative mention alone leaves prompt unchanged', () => assert.strictEqual(noExplicit.shotPlan.scenes[0].shots[0].prompt, 'BASE'));

  const ambiguousObjects = { active: true, objects: [
    { object: { id: 'oa', namespace: 'series', objectKey: 'key_a', displayName: 'Key', identityFingerprint: 'fa' }, usage: {} },
    { object: { id: 'ob', namespace: 'series', objectKey: 'key_b', displayName: 'Key', identityFingerprint: 'fb' }, usage: {} }
  ] };
  const ambiguous = await binder.bindShotPlan({ production: { id: 'video_amb' }, scenes: [{ id: 's3', objectBindings: [{ reference: 'Key' }] }], shotPlan: { fingerprint: 'p', scenes: [{ sceneId: 's3', scenePosition: 0, fingerprint: 'sp', shots: [{ id: 'sh', shotIndex: 0, prompt: 'BASE', fingerprint: 'f', planFingerprint: 'sp' }] }] }, objectPlan: ambiguousObjects });
  check('ambiguous name fails closed', () => assert.strictEqual(ambiguous.summary.ambiguous, 1));
  check('ambiguous name creates no persisted binding', () => assert(!saved.some(row => row.productionId === 'video_amb')));

  const conflictScene = [{ id: 's4', objectBindings: [
    { objectId: 'obj_car', visibility: 'visible', shotIndex: 0 },
    { objectId: 'obj_car', visibility: 'offscreen', shotIndex: 0 }
  ] }];
  const conflict = await binder.bindShotPlan({ production: { id: 'video_conflict' }, scenes: conflictScene, shotPlan: { fingerprint: 'p4', scenes: [{ sceneId: 's4', scenePosition: 0, fingerprint: 'sp4', shots: [{ id: 'sh4', shotIndex: 0, prompt: 'BASE', fingerprint: 'f4', planFingerprint: 'sp4' }] }] }, objectPlan });
  check('contradictory same-object binding becomes conflict', () => assert.strictEqual(conflict.summary.conflicts, 1));
  check('conflicting binding does not enrich shot prompt', () => assert.strictEqual(conflict.shotPlan.scenes[0].shots[0].prompt, 'BASE'));

  const disabled = await new PersistentWorldObjectBindingV11(db, { enabled: false }).bindShotPlan({ production, scenes, shotPlan, objectPlan });
  check('disabled binder inactive', () => assert.strictEqual(disabled.active, false));
}

runtimeChecks().then(() => console.log(`Phase 11.10.5 Scene / Shot Object Binding OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
