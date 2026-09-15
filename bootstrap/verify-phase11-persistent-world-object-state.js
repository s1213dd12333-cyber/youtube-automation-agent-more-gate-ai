'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-world-object-state-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.4 runtime is not materialized');
const {
  PERSISTENT_WORLD_OBJECT_STATE_VERSION,
  PersistentWorldObjectStateLayerV11,
  normalizePersistence,
  stateDeclaration,
  bindingForState,
  normalizeState,
  stateFingerprint,
  statePromptFragment
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.10.4', () => assert.strictEqual(PERSISTENT_WORLD_OBJECT_STATE_VERSION, '11.10.4'));
check('default persistence is scene', () => assert.strictEqual(normalizePersistence(), 'scene'));
check('durable maps to until_changed', () => assert.strictEqual(normalizePersistence('durable'), 'until_changed'));
check('persistent maps to until_changed', () => assert.strictEqual(normalizePersistence('persistent'), 'until_changed'));
check('scene stays scene', () => assert.strictEqual(normalizePersistence('scene'), 'scene'));
check('nested objectState is collected', () => assert(stateDeclaration({ objectKey: 'car', objectState: { condition: 'damaged' } }).stateRaw.condition === 'damaged'));
check('plain object with no state is ignored', () => assert.strictEqual(stateDeclaration({ objectKey: 'car', name: 'Car' }), null));
check('inline state is collected', () => assert(stateDeclaration({ objectKey: 'car', cleanliness: 'muddy' }).stateRaw.cleanliness === 'muddy'));

const normalized = normalizeState({ condition: 'damaged', damage: ['dent'], cleanliness: 'muddy', openState: 'closed', operationalState: 'off', contents: ['toolbox'], holderKey: 'miller', placement: 'garage', storyState: ['evidence'], statePersistence: 'until_changed' });
check('active state detected', () => assert.strictEqual(normalized.status, 'active'));
check('durable state preserved', () => assert.strictEqual(normalized.persistence, 'until_changed'));
check('damage preserved', () => assert.deepStrictEqual(normalized.state.damage, ['dent']));
check('contents preserved', () => assert.deepStrictEqual(normalized.state.contents, ['toolbox']));
check('holder preserved', () => assert.strictEqual(normalized.state.holderKey, 'miller'));
check('reset becomes neutral', () => assert.strictEqual(normalizeState({ clearState: true, statePersistence: 'until_changed' }).status, 'neutral'));
check('conflicting openness fails closed', () => {
  const result = normalizeState({ openStates: ['open', 'closed'] });
  assert.strictEqual(result.status, 'conflict'); assert.strictEqual(result.state.openness, null); assert(result.conflicts[0].includes('openness'));
});
check('conflicting condition fails closed', () => assert.strictEqual(normalizeState({ conditions: ['damaged', 'repaired'] }).status, 'conflict'));
check('state fingerprint deterministic', () => assert.strictEqual(stateFingerprint('obj1', normalized), stateFingerprint('obj1', normalized)));
check('different state changes fingerprint', () => assert.notStrictEqual(stateFingerprint('obj1', normalized), stateFingerprint('obj1', normalizeState({ condition: 'repaired' }))));
check('prompt forbids canonical identity rewrite', () => assert(statePromptFragment({ objectId: 'obj1', status: 'active', persistence: 'scene', damage: ['dent'] }).includes('Do not rewrite objectId')));
check('prompt documents durable semantics', () => assert(statePromptFragment({ objectId: 'obj1', status: 'active', persistence: 'until_changed' }).includes('until an explicit later durable state or reset replaces it')));

const bindings = [
  { object: { id: 'obj_car', objectKey: 'family_car', displayName: 'Family Car', objectType: 'vehicle' }, usage: { environmentId: 'env_a', sourceRef: 'car_decl' } },
  { object: { id: 'obj_sofa', objectKey: 'sofa_x', displayName: 'Blue Sofa', objectType: 'furniture' }, usage: { environmentId: 'env_a', sourceRef: 'sofa_decl' } }
];
check('explicit key binds state', () => assert.strictEqual(bindingForState({ explicitObjectKey: 'family_car' }, bindings).binding.object.id, 'obj_car'));
check('source ref binds state', () => assert.strictEqual(bindingForState({ sourceRef: 'sofa_decl' }, bindings).binding.object.id, 'obj_sofa'));
check('unknown state binding unresolved', () => assert.strictEqual(bindingForState({ explicitObjectKey: 'missing' }, bindings).status, 'unresolved'));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns object state table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_states'],
  ['state uniqueness is production object scope', dbSource, 'UNIQUE(production_id, object_id, scope_key)'],
  ['state references object', dbSource, 'FOREIGN KEY (object_id) REFERENCES persistent_world_objects(id) ON DELETE CASCADE'],
  ['state supports parent state', dbSource, 'FOREIGN KEY (parent_state_id) REFERENCES persistent_world_object_states(id) ON DELETE SET NULL'],
  ['database saves object state', dbSource, 'async savePersistentWorldObjectState(input = {})'],
  ['database reads durable state', dbSource, 'async getLatestDurablePersistentWorldObjectState(objectId, excludeProductionId = null)'],
  ['bundle loads object states', dbSource, 'const persistentWorldObjectStates = await this.listProductionPersistentWorldObjectStates(productionId);'],
  ['bundle exposes object states', dbSource, 'persistentWorldObjectStates,'],
  ['pipeline imports state layer', pipelineSource, "PersistentWorldObjectStateLayerV11 } = require('./persistent-world-object-state-v11')"],
  ['pipeline constructs state layer', pipelineSource, 'this.persistentWorldObjectStates = options.persistentWorldObjectStates || new PersistentWorldObjectStateLayerV11'],
  ['pipeline ensures object states', pipelineSource, 'this.persistentWorldObjectStates.ensureProductionStates(production, environmentBible, stateObjectLocks, persistentWorldObjectPlan)'],
  ['dashboard shows object state', dashboardSource, 'OBJECT STATE / LIFECYCLE V11.10.4'],
  ['dashboard explains canonical protection', dashboardSource, 'never rewrite objectId, canonical fingerprint or the 11.10.3 canonical asset'],
  ['env enables object state', envSource, 'PERSISTENT_WORLD_OBJECT_STATES_ENABLED=true'],
  ['env enables durable inheritance', envSource, 'PERSISTENT_WORLD_OBJECT_STATE_INHERIT_DURABLE=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes object state verifier', () => assert.strictEqual(pkg.scripts['test:persistent-world-object-state'], 'node ../bootstrap/verify-phase11-persistent-world-object-state.js'));
check('state runs after canonical object assets', () => assert(pipelineSource.indexOf('let canonicalWorldObjectAssetPlan = null;') < pipelineSource.indexOf('let persistentWorldObjectStatePlan = null;')));
check('state runs before location temporary state', () => assert(pipelineSource.indexOf('let persistentWorldObjectStatePlan = null;') < pipelineSource.indexOf('let temporaryLocationStatePlan = null;')));

async function runtimeChecks() {
  const rows = [];
  const db = {
    async savePersistentWorldObjectState(input) {
      let row = rows.find(item => item.productionId === input.productionId && item.objectId === input.objectId && item.scopeKey === input.scopeKey);
      if (row) Object.assign(row, input); else { row = { ...input, createdAt: `${String(rows.length + 1).padStart(4, '0')}` }; rows.push(row); }
      return { ...row };
    },
    async getLatestDurablePersistentWorldObjectState(objectId, excludeProductionId) {
      const candidates = rows.filter(item => item.objectId === objectId && item.persistence === 'until_changed' && item.productionId !== excludeProductionId);
      return candidates.length ? { ...candidates[candidates.length - 1] } : null;
    }
  };

  const car = { id: 'obj_car', objectKey: 'family_car', displayName: 'Family Car', objectType: 'vehicle', identityFingerprint: 'fp_car' };
  const sofa = { id: 'obj_sofa', objectKey: 'sofa_x', displayName: 'Blue Sofa', objectType: 'furniture', identityFingerprint: 'fp_sofa' };
  const planA = { active: true, objects: [
    { object: car, usage: { environmentId: 'env_a', sourceRef: 'car_decl' } },
    { object: sofa, usage: { environmentId: 'env_a', sourceRef: 'sofa_decl' } }
  ] };
  const layer = new PersistentWorldObjectStateLayerV11(db, { enabled: true, inheritDurable: true });
  const bibleA = { environments: [{ environmentId: 'env_a', persistentObjects: [
    { id: 'car_decl', objectKey: 'family_car', name: 'Family Car', objectState: { condition: 'damaged', damage: ['rear dent'], cleanliness: 'muddy', openState: 'closed', operationalState: 'off', contents: ['toolbox'], statePersistence: 'until_changed' } },
    { id: 'sofa_decl', objectKey: 'sofa_x', name: 'Blue Sofa', state: { cleanliness: 'messy', statePersistence: 'scene', sceneId: 'scene_a' } }
  ] }] };
  const A = await layer.ensureProductionStates({ id: 'video_a' }, bibleA, [], planA);
  check('A stores two explicit states', () => assert.strictEqual(A.states.length, 2));
  const carA = A.states.find(row => row.objectId === car.id);
  const sofaA = A.states.find(row => row.objectId === sofa.id);
  check('A car state is durable', () => assert.strictEqual(carA.persistence, 'until_changed'));
  check('A car damage active', () => assert(carA.damage.includes('rear dent')));
  check('A canonical fingerprint copied for audit', () => assert.strictEqual(carA.canonicalIdentityFingerprint, 'fp_car'));
  check('A sofa scene state is not durable', () => assert.strictEqual(sofaA.persistence, 'scene'));

  const planB = { active: true, objects: [
    { object: car, usage: { environmentId: 'env_b', sourceRef: 'car_b' } },
    { object: sofa, usage: { environmentId: 'env_b', sourceRef: 'sofa_b' } }
  ] };
  const B = await layer.ensureProductionStates({ id: 'video_b' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{ id: 'car_b', objectKey: 'family_car', name: 'Family Car' }, { id: 'sofa_b', objectKey: 'sofa_x', name: 'Blue Sofa' }] }] }, [], planB);
  check('B inherits only durable car state', () => assert.strictEqual(B.states.length, 1));
  check('B inherited car is marked inherited', () => assert.strictEqual(B.states[0].inherited, true));
  check('B inherited car keeps damage', () => assert(B.states[0].damage.includes('rear dent')));
  check('B does not inherit scene sofa state', () => assert(!B.states.some(row => row.objectId === sofa.id)));
  check('B points to parent durable state', () => assert.strictEqual(B.states[0].parentStateId, carA.id));

  const resetBible = { environments: [{ environmentId: 'env_c', persistentObjects: [{ objectKey: 'family_car', name: 'Family Car', objectState: { clearState: true, statePersistence: 'until_changed' } }] }] };
  const planC = { active: true, objects: [{ object: car, usage: { environmentId: 'env_c' } }] };
  const C = await layer.ensureProductionStates({ id: 'video_c' }, resetBible, [], planC);
  check('C durable reset writes neutral state', () => assert.strictEqual(C.states[0].status, 'neutral'));
  check('C durable reset remains until_changed', () => assert.strictEqual(C.states[0].persistence, 'until_changed'));

  const D = await layer.ensureProductionStates({ id: 'video_d' }, { environments: [{ environmentId: 'env_d', persistentObjects: [{ objectKey: 'family_car', name: 'Family Car' }] }] }, [], { active: true, objects: [{ object: car, usage: { environmentId: 'env_d' } }] });
  check('D inherits the latest neutral reset', () => assert.strictEqual(D.states[0].status, 'neutral'));
  check('D does not resurrect old damage', () => assert.strictEqual(D.states[0].damage.length, 0));

  const conflict = await layer.ensureProductionStates({ id: 'video_conflict' }, { environments: [{ environmentId: 'env_x', persistentObjects: [{ objectKey: 'family_car', name: 'Family Car', objectState: { openStates: ['open', 'closed'], statePersistence: 'scene' } }] }] }, [], { active: true, objects: [{ object: car, usage: { environmentId: 'env_x' } }] });
  check('conflicting state is audited', () => assert.strictEqual(conflict.states[0].status, 'conflict'));
  check('conflicting dimension is omitted', () => assert.strictEqual(conflict.states[0].openness, null));

  const ambiguousPlan = { active: true, objects: [
    { object: { id: 'obj_a', objectKey: 'a', displayName: 'Key', objectType: 'artifact', identityFingerprint: 'fa' }, usage: { environmentId: 'env_z' } },
    { object: { id: 'obj_b', objectKey: 'b', displayName: 'Key', objectType: 'artifact', identityFingerprint: 'fb' }, usage: { environmentId: 'env_z' } }
  ] };
  const ambiguous = await layer.ensureProductionStates({ id: 'video_amb' }, { environments: [{ environmentId: 'env_z', objectStates: [{ name: 'Key', type: 'artifact', state: { condition: 'damaged' } }] }] }, [], ambiguousPlan);
  check('ambiguous state binding fails closed', () => assert.strictEqual(ambiguous.summary.ambiguous, 1));
  check('ambiguous state binding creates no state', () => assert.strictEqual(ambiguous.states.length, 0));

  const disabled = await new PersistentWorldObjectStateLayerV11(db, { enabled: false }).ensureProductionStates({ id: 'video_off' }, bibleA, [], planA);
  check('disabled state layer inactive', () => assert.strictEqual(disabled.active, false));
  check('disabled state layer creates nothing', () => assert.strictEqual(disabled.states.length, 0));
}

runtimeChecks().then(() => console.log(`Phase 11.10.4 Persistent World Object State OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
