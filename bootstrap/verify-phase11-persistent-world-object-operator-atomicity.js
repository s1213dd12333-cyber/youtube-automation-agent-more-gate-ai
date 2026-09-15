'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-world-object-library-manager-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.7 Object Library runtime is not materialized');
const { PersistentWorldObjectLibraryManagerV11 } = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const managerSource = fs.readFileSync(runtimePath, 'utf8');

for (const [name, source, token] of [
  ['DB has atomic operator alias writer', dbSource, 'async savePersistentWorldObjectOperatorAlias(input = {})'],
  ['operator alias SQL uses conditional insert', dbSource, 'WHERE NOT EXISTS ('],
  ['operator alias SQL excludes foreign object id', dbSource, 'alias_key = ? AND object_id <> ?'],
  ['DB has atomic operator resolution linker', dbSource, 'async linkPersistentWorldObjectResolutionOperator(input = {})'],
  ['resolution link is compare-and-set guarded', dbSource, "status IN ('unresolved','ambiguous') OR (status='resolved' AND object_id=?)"],
  ['manager uses atomic alias writer', managerSource, 'savePersistentWorldObjectOperatorAlias'],
  ['manager audits concurrent alias collision', managerSource, 'alias_key_concurrent_collision'],
  ['manager protects alias during resolution link', managerSource, 'requested_alias_concurrent_collision'],
  ['manager uses atomic resolution linker', managerSource, 'linkPersistentWorldObjectResolutionOperator'],
  ['manager audits concurrent resolution conflict', managerSource, 'resolution_concurrently_linked_to_different_object']
]) check(name, () => assert(source.includes(token)));

async function runtimeChecks() {
  const objects = [
    { id: 'obj_car', namespace: 'series', objectKey: 'car', objectType: 'vehicle', identityFingerprint: 'fp_car' },
    { id: 'obj_phone', namespace: 'series', objectKey: 'phone', objectType: 'phone', identityFingerprint: 'fp_phone' }
  ];
  const resolutions = [
    { id: 'r_alias_race', namespace: 'series', productionId: 'p1', scopeKey: 's1', referenceText: 'their car', referenceKey: 'their car', requestedType: 'vehicle', status: 'ambiguous', objectId: null },
    { id: 'r_link_race', namespace: 'series', productionId: 'p2', scopeKey: 's2', referenceText: 'vehicle', referenceKey: 'vehicle', requestedType: 'vehicle', status: 'ambiguous', objectId: null },
    { id: 'r_success', namespace: 'series', productionId: 'p3', scopeKey: 's3', referenceText: 'our car', referenceKey: 'our car', requestedType: 'vehicle', status: 'unresolved', objectId: null }
  ];
  const actions = [];
  let aliasRace = true;
  let linkRace = true;
  const db = {
    async getPersistentWorldObject(id) { return objects.find(row => row.id === id) || null; },
    async listPersistentWorldObjectAliasesByKey() { return []; },
    async savePersistentWorldObjectOperatorAlias(input) {
      if (aliasRace) return { status: 'conflict', alias: null, conflictingObjectIds: ['obj_phone'] };
      return { status: 'applied', alias: { id: 'a_ok', ...input } };
    },
    async getPersistentWorldObjectResolution(id) { return { ...(resolutions.find(row => row.id === id) || null) }; },
    async linkPersistentWorldObjectResolutionOperator(input) {
      if (linkRace && input.resolutionId === 'r_link_race') {
        const row = resolutions.find(item => item.id === input.resolutionId);
        row.status = 'resolved'; row.objectId = 'obj_phone';
        return { status: 'conflict', resolution: { ...row }, reason: 'resolution_concurrently_linked_to_different_object', currentObjectId: 'obj_phone' };
      }
      const row = resolutions.find(item => item.id === input.resolutionId);
      row.status = 'resolved'; row.objectId = input.objectId; row.matchMode = 'operator_explicit_link'; row.confidence = 1; row.candidateObjectIds = [input.objectId]; row.identityFingerprint = input.identityFingerprint;
      return { status: 'applied', resolution: { ...row } };
    },
    async savePersistentWorldObjectOperatorAction(input) { const row = { id: `act_${actions.length + 1}`, ...input }; actions.push(row); return row; }
  };

  const manager = new PersistentWorldObjectLibraryManagerV11(db, { operatorControls: true, allowAlias: true, allowLink: true });

  const aliasCollision = await manager.addAlias({ objectId: 'obj_car', aliasText: 'family vehicle', actor: 'race-test' });
  check('post-precheck atomic alias conflict fails closed', () => assert.strictEqual(aliasCollision.status, 'conflict'));
  check('atomic alias conflict reports foreign object', () => assert.deepStrictEqual(aliasCollision.conflictingObjectIds, ['obj_phone']));
  check('atomic alias conflict is audited', () => assert(actions.some(row => row.actionType === 'add_alias' && row.status === 'rejected' && row.reason === 'alias_key_concurrent_collision')));

  const aliasLinkCollision = await manager.linkResolution({ resolutionId: 'r_alias_race', objectId: 'obj_car', persistAlias: true, actor: 'race-test' });
  check('atomic alias collision during resolution link fails closed', () => assert.strictEqual(aliasLinkCollision.status, 'conflict'));
  check('alias race does not resolve target row', () => assert.strictEqual(resolutions.find(row => row.id === 'r_alias_race').objectId, null));
  check('alias race link is audited', () => assert(actions.some(row => row.actionType === 'link_resolution' && row.status === 'rejected' && row.reason === 'requested_alias_concurrent_collision')));

  aliasRace = false;
  const linkCollision = await manager.linkResolution({ resolutionId: 'r_link_race', objectId: 'obj_car', persistAlias: false, actor: 'race-test' });
  check('atomic resolution compare-and-set conflict fails closed', () => assert.strictEqual(linkCollision.status, 'conflict'));
  check('atomic resolution conflict preserves winner', () => assert.strictEqual(resolutions.find(row => row.id === 'r_link_race').objectId, 'obj_phone'));
  check('atomic resolution conflict exposes current object', () => assert.strictEqual(linkCollision.currentObjectId, 'obj_phone'));
  check('atomic resolution conflict is audited', () => assert(actions.some(row => row.actionType === 'link_resolution' && row.status === 'rejected' && row.reason === 'resolution_concurrently_linked_to_different_object')));

  linkRace = false;
  const linked = await manager.linkResolution({ resolutionId: 'r_success', objectId: 'obj_car', persistAlias: false, actor: 'race-test' });
  check('atomic resolution link succeeds when uncontested', () => assert.strictEqual(linked.status, 'applied'));
  check('successful atomic link uses operator match mode', () => assert.strictEqual(linked.resolution.matchMode, 'operator_explicit_link'));
  check('successful atomic link pins one object', () => assert.deepStrictEqual(linked.resolution.candidateObjectIds, ['obj_car']));
  check('successful atomic link keeps canonical fingerprint for audit', () => assert.strictEqual(linked.resolution.identityFingerprint, 'fp_car'));
}

runtimeChecks().then(() => console.log(`Phase 11.10.7 operator atomicity hardening OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
