'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-world-object-library-manager-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.7 runtime is not materialized');
const {
  PERSISTENT_WORLD_OBJECT_LIBRARY_VERSION,
  PersistentWorldObjectLibraryManagerV11,
  normalize,
  uniqueProductionCount,
  latestByCreatedAt
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.10.7', () => assert.strictEqual(PERSISTENT_WORLD_OBJECT_LIBRARY_VERSION, '11.10.7'));
check('normalize strips accents', () => assert.strictEqual(normalize('Carro da Família'), 'carro da familia'));
check('production count deduplicates productions', () => assert.strictEqual(uniqueProductionCount([{ productionId: 'a' }, { productionId: 'a' }, { productionId: 'b' }]), 2));
check('latest helper returns newest row', () => assert.strictEqual(latestByCreatedAt([{ id: 'a', createdAt: '2026-01-01' }, { id: 'b', createdAt: '2026-02-01' }]).id, 'b'));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(upstream, 'dashboard', 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const dashboardRuntime = fs.readFileSync(path.join(upstream, 'dashboard', 'persistent-world-object-library-v11.js'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(upstream, 'dashboard', 'persistent-world-object-library-v11.css'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns operator audit table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_operator_actions'],
  ['operator audit table references persistent object', dbSource, 'FOREIGN KEY (object_id) REFERENCES persistent_world_objects(id) ON DELETE SET NULL'],
  ['database fetches one resolution by id', dbSource, 'async getPersistentWorldObjectResolution(id)'],
  ['database lists pending resolutions', dbSource, 'async listPendingPersistentWorldObjectResolutions(namespace = \'default\', limit = 100)'],
  ['database lists bindings by object', dbSource, 'async listPersistentWorldObjectBindingsByObject(objectId, limit = 250)'],
  ['database lists continuity by object', dbSource, 'async listCrossVideoObjectContinuityChecksByObject(objectId, limit = 250)'],
  ['database saves operator action', dbSource, 'async savePersistentWorldObjectOperatorAction(input = {})'],
  ['database lists operator actions', dbSource, 'async listPersistentWorldObjectOperatorActions(objectId = null, namespace = \'default\', limit = 250)'],
  ['index imports object library manager', indexSource, "PersistentWorldObjectLibraryManagerV11 } = require('./utils/persistent-world-object-library-manager-v11')"],
  ['index initializes object library', indexSource, 'this.objectLibrary = new PersistentWorldObjectLibraryManagerV11'],
  ['index exposes object library snapshot', indexSource, "this.app.get('/api/object-library'"],
  ['index exposes canonical object assets safely', indexSource, "this.app.get('/api/object-library/assets/:assetId'"],
  ['index protects alias mutation', indexSource, "this.app.post('/api/object-library/:objectId/aliases', protect"],
  ['index protects resolution linking', indexSource, "this.app.post('/api/object-library/resolutions/:resolutionId/link', protect"],
  ['asset route is restricted to object-library root', indexSource, "path.resolve(__dirname, 'data', 'assets', 'object-library')"],
  ['dashboard has Object Library nav', htmlSource, 'data-view="objects"'],
  ['dashboard has object view', htmlSource, 'id="objects-view"'],
  ['dashboard loads object library stylesheet', htmlSource, '/persistent-world-object-library-v11.css'],
  ['dashboard loads object library runtime', htmlSource, '/persistent-world-object-library-v11.js'],
  ['app title knows object library', appSource, "objects: ['OBJECT LIBRARY'"],
  ['dashboard runtime has safe alias control', dashboardRuntime, 'Alias creation is rejected if that alias already points to another object.'],
  ['dashboard runtime links explicit resolver decisions', dashboardRuntime, 'data-object-link-resolution'],
  ['dashboard runtime labels canonical identity read-only', dashboardRuntime, 'Canonical identity (read-only)'],
  ['dashboard CSS styles object library layout', dashboardCss, '.object-library-layout'],
  ['env enables object library', envSource, 'PERSISTENT_WORLD_OBJECT_LIBRARY_ENABLED=true'],
  ['env enables audited operator controls', envSource, 'PERSISTENT_WORLD_OBJECT_OPERATOR_CONTROLS_ENABLED=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes 11.10.7 verifier', () => assert.strictEqual(pkg.scripts['test:persistent-world-object-library-ui'], 'node ../bootstrap/verify-phase11-persistent-world-object-library-ui.js'));

async function runtimeChecks() {
  const objects = [
    { id: 'obj_car', namespace: 'series', objectKey: 'miller_family_car', displayName: 'Miller Family Car', objectType: 'vehicle', status: 'registered', identityFingerprint: 'fp_car', canonicalIdentity: { color: 'red', material: 'metal' }, createdFromProductionId: 'video_a' },
    { id: 'obj_phone', namespace: 'series', objectKey: 'family_phone', displayName: 'Family Phone', objectType: 'phone', status: 'registered', identityFingerprint: 'fp_phone', canonicalIdentity: { color: 'black' }, createdFromProductionId: 'video_a' }
  ];
  const aliases = [
    { id: 'a1', namespace: 'series', objectId: 'obj_car', aliasText: 'family car', aliasKey: 'family car', canonical: false },
    { id: 'a2', namespace: 'series', objectId: 'obj_phone', aliasText: 'phone', aliasKey: 'phone', canonical: false }
  ];
  const assets = [{ id: 'asset_car', objectId: 'obj_car', canonical: true, status: 'ready', assetRole: 'object_reference', assetSha256: 'sha_car', provider: 'vision-provider', sourceProductionId: 'video_a' }];
  const usages = [
    { objectId: 'obj_car', productionId: 'video_a', matchMode: 'identity_fingerprint_exact_register' },
    { objectId: 'obj_car', productionId: 'video_b', matchMode: 'object_alias_exact' },
    { objectId: 'obj_phone', productionId: 'video_a', matchMode: 'identity_fingerprint_exact_register' }
  ];
  const states = [{ id: 'state_car', objectId: 'obj_car', productionId: 'video_b', status: 'active', persistence: 'until_changed', stateFingerprint: 'state_fp', createdAt: '2026-09-15T10:00:00Z' }];
  const bindings = [{ id: 'binding_car', objectId: 'obj_car', productionId: 'video_b', sceneId: 's1', shotId: 'sh1', visibility: 'visible' }];
  const continuity = [{ id: 'check_car', objectId: 'obj_car', productionId: 'video_b', accepted: false, status: 'blocked', reasons: ['CROSS_VIDEO_OBJECT_REPLACED'], createdAt: '2026-09-15T11:00:00Z' }];
  const resolutions = [
    { id: 'r1', namespace: 'series', productionId: 'video_c', scopeKey: 'env1', referenceText: 'their car', referenceKey: 'their car', requestedType: 'vehicle', status: 'ambiguous', objectId: null, candidateObjectIds: ['obj_car', 'other'], reason: 'multiple_candidates', updatedAt: '2026-09-15T12:00:00Z' },
    { id: 'r2', namespace: 'series', productionId: 'video_c', scopeKey: 'env2', referenceText: 'mystery phone', referenceKey: 'mystery phone', requestedType: 'phone', status: 'unresolved', objectId: null, candidateObjectIds: [], reason: 'not_found', updatedAt: '2026-09-15T12:10:00Z' },
    { id: 'r3', namespace: 'series', productionId: 'video_d', scopeKey: 'env3', referenceText: 'phone', referenceKey: 'phone', requestedType: 'phone', status: 'resolved', objectId: 'obj_phone', candidateObjectIds: ['obj_phone'], reason: null, updatedAt: '2026-09-15T12:20:00Z' }
  ];
  const actions = [];
  let serial = 0;
  const db = {
    async listPersistentWorldObjects(namespace) { return objects.filter(row => row.namespace === namespace); },
    async getPersistentWorldObject(id) { return objects.find(row => row.id === id) || null; },
    async listPersistentWorldObjectAliases(objectId) { return aliases.filter(row => row.objectId === objectId); },
    async listPersistentWorldObjectAliasesByKey(namespace, aliasKey) { return aliases.filter(row => row.namespace === namespace && row.aliasKey === aliasKey); },
    async savePersistentWorldObjectAlias(input) {
      const existing = aliases.find(row => row.namespace === input.namespace && row.objectId === input.objectId && row.aliasKey === input.aliasKey);
      if (existing) return existing;
      const row = { id: `alias_${++serial}`, ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      aliases.push(row); return row;
    },
    async listPersistentWorldObjectAssets(objectId) { return assets.filter(row => row.objectId === objectId); },
    async listPersistentWorldObjectUsages(objectId) { return usages.filter(row => row.objectId === objectId); },
    async listPersistentWorldObjectStates(objectId) { return states.filter(row => row.objectId === objectId); },
    async listPersistentWorldObjectBindingsByObject(objectId) { return bindings.filter(row => row.objectId === objectId); },
    async listCrossVideoObjectContinuityChecksByObject(objectId) { return continuity.filter(row => row.objectId === objectId); },
    async listPersistentWorldObjectResolutionsByObject(objectId) { return resolutions.filter(row => row.objectId === objectId); },
    async listPendingPersistentWorldObjectResolutions(namespace) { return resolutions.filter(row => row.namespace === namespace && ['unresolved', 'ambiguous'].includes(row.status)); },
    async getPersistentWorldObjectResolution(id) { return resolutions.find(row => row.id === id) || null; },
    async savePersistentWorldObjectResolution(input) {
      const index = resolutions.findIndex(item => item.productionId === input.productionId && item.scopeKey === input.scopeKey && item.referenceKey === input.referenceKey);
      if (index < 0) throw new Error('resolution row missing in fake DB');
      const next = { ...resolutions[index], ...input, updatedAt: new Date().toISOString() };
      resolutions[index] = next;
      return { ...next };
    },
    async savePersistentWorldObjectOperatorAction(input) { const row = { id: `action_${++serial}`, ...input, createdAt: new Date().toISOString() }; actions.unshift(row); return row; },
    async listPersistentWorldObjectOperatorActions(objectId, namespace) { return actions.filter(row => row.namespace === namespace && (!objectId || row.objectId === objectId)); }
  };

  const manager = new PersistentWorldObjectLibraryManagerV11(db, { enabled: true, operatorControls: true, allowAlias: true, allowLink: true });
  const snapshot = await manager.getSnapshot('series');
  check('snapshot includes both objects', () => assert.strictEqual(snapshot.summary.objectCount, 2));
  check('snapshot counts canonical ready object', () => assert.strictEqual(snapshot.summary.canonicalReady, 1));
  check('snapshot detects cross-video object', () => assert.strictEqual(snapshot.summary.crossVideoObjects, 1));
  check('snapshot detects blocked latest continuity', () => assert.strictEqual(snapshot.summary.blockedContinuity, 1));
  check('snapshot exposes pending resolver decisions', () => assert.strictEqual(snapshot.pendingResolutions.length, 2));
  check('asset URL routes through guarded API', () => assert(snapshot.objects.find(row => row.id === 'obj_car').assets[0].assetUrl.includes('/api/object-library/assets/asset_car')));

  const detail = await manager.detail('obj_car');
  check('detail exposes immutable identity object', () => assert.strictEqual(detail.object.identityFingerprint, 'fp_car'));
  check('detail exposes lifecycle state', () => assert.strictEqual(detail.states[0].stateFingerprint, 'state_fp'));
  check('detail exposes shot binding history', () => assert.strictEqual(detail.bindings[0].id, 'binding_car'));
  check('detail exposes object continuity history', () => assert.strictEqual(detail.continuityChecks[0].accepted, false));

  const aliasResult = await manager.addAlias({ objectId: 'obj_car', aliasText: 'Carro da Família Miller', actor: 'tester' });
  check('safe alias is applied', () => assert.strictEqual(aliasResult.status, 'applied'));
  check('safe alias uses normalized key', () => assert.strictEqual(aliasResult.alias.aliasKey, 'carro da familia miller'));
  check('safe alias is audited', () => assert(actions.some(row => row.actionType === 'add_alias' && row.status === 'applied')));

  const duplicateAlias = await manager.addAlias({ objectId: 'obj_car', aliasText: 'Carro da Família Miller', actor: 'tester' });
  check('same-object alias is idempotent', () => assert.strictEqual(duplicateAlias.status, 'no_change'));

  const collision = await manager.addAlias({ objectId: 'obj_car', aliasText: 'phone', actor: 'tester' });
  check('foreign alias collision fails closed', () => assert.strictEqual(collision.status, 'conflict'));
  check('foreign alias collision names conflicting object', () => assert.deepStrictEqual(collision.conflictingObjectIds, ['obj_phone']));
  check('foreign alias collision is audited as rejected', () => assert(actions.some(row => row.actionType === 'add_alias' && row.status === 'rejected' && row.reason === 'alias_key_already_points_to_other_object')));

  const linked = await manager.linkResolution({ resolutionId: 'r1', objectId: 'obj_car', persistAlias: true, actor: 'tester' });
  check('ambiguous resolution can be explicitly linked', () => assert.strictEqual(linked.status, 'applied'));
  check('operator link uses explicit match mode', () => assert.strictEqual(linked.resolution.matchMode, 'operator_explicit_link'));
  check('operator link records confidence one', () => assert.strictEqual(linked.resolution.confidence, 1));
  check('operator link pins target object only', () => assert.deepStrictEqual(linked.resolution.candidateObjectIds, ['obj_car']));
  check('operator link can persist non-colliding alias', () => assert(aliases.some(row => row.objectId === 'obj_car' && row.aliasKey === 'their car')));
  check('operator link is audited', () => assert(actions.some(row => row.actionType === 'link_resolution' && row.status === 'applied')));

  const wrongRelink = await manager.linkResolution({ resolutionId: 'r3', objectId: 'obj_car', actor: 'tester' });
  check('already-resolved different object cannot be silently retargeted', () => assert.strictEqual(wrongRelink.status, 'conflict'));
  check('wrong relink preserves original object', () => assert.strictEqual(resolutions.find(row => row.id === 'r3').objectId, 'obj_phone'));

  const aliasCollisionLink = await manager.linkResolution({ resolutionId: 'r2', objectId: 'obj_car', persistAlias: true, actor: 'tester' });
  check('unresolved safe alias link applies when alias is unique', () => assert.strictEqual(aliasCollisionLink.status, 'applied'));
  check('resolution identity fingerprint is target canonical fingerprint', () => assert.strictEqual(aliasCollisionLink.resolution.identityFingerprint, 'fp_car'));

  const disabledAliasManager = new PersistentWorldObjectLibraryManagerV11(db, { operatorControls: false });
  let disabledAliasError = null;
  try { await disabledAliasManager.addAlias({ objectId: 'obj_car', aliasText: 'x' }); } catch (error) { disabledAliasError = error; }
  check('disabled operator controls reject mutation', () => assert(disabledAliasError && /disabled/.test(disabledAliasError.message)));
}

runtimeChecks().then(() => console.log(`Phase 11.10.7 Object Library UI + Operator Controls OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
