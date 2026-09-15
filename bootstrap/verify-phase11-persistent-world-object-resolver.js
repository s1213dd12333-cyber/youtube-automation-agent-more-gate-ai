'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const resolverPath = path.join(upstream, 'utils', 'persistent-world-object-resolver-v11.js');
const registryPath = path.join(upstream, 'utils', 'persistent-world-object-registry-v11.js');
if (!fs.existsSync(resolverPath)) throw new Error('Phase 11.10.2 resolver runtime is not materialized');
if (!fs.existsSync(registryPath)) throw new Error('Phase 11.10.1 registry runtime is not materialized');

const {
  PERSISTENT_WORLD_OBJECT_RESOLVER_VERSION,
  PersistentWorldObjectResolverV11,
  normalize,
  referenceDescriptor,
  candidateAliases,
  compatibleCanonicalIdentity,
  objectTypeCompatible
} = require(resolverPath);
const {
  PERSISTENT_WORLD_OBJECT_VERSION,
  PersistentWorldObjectRegistryV11
} = require(registryPath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('registry version remains 11.10.1', () => assert.strictEqual(PERSISTENT_WORLD_OBJECT_VERSION, '11.10.1'));
check('resolver version is 11.10.2', () => assert.strictEqual(PERSISTENT_WORLD_OBJECT_RESOLVER_VERSION, '11.10.2'));
check('their car is generic vehicle', () => {
  const d = referenceDescriptor('their car', 'vehicle');
  assert.strictEqual(d.generic, true); assert.strictEqual(d.requestedType, 'vehicle');
});
check('carro da familia is generic vehicle in Portuguese', () => {
  const d = referenceDescriptor('o carro da família', 'vehicle');
  assert.strictEqual(d.generic, true); assert.strictEqual(d.requestedType, 'vehicle');
});
check('named family car alias stays normalized', () => assert.strictEqual(normalize('Carro da Família Miller'), 'carro da familia miller'));
check('candidate aliases include explicit aliases', () => assert(candidateAliases({ displayName: 'Family Car', aliases: ['Carro da Família Miller'] }).some(item => item.key === 'carro da familia miller')));
check('type compatibility accepts car vs vehicle', () => assert.strictEqual(objectTypeCompatible({ objectType: 'vehicle' }, 'car'), true));
check('canonical mismatch blocks color rewrite', () => {
  const result = compatibleCanonicalIdentity({ objectType: 'vehicle', canonicalIdentity: { scopeKind: 'explicit_object_key', scopeAnchor: 'miller_family_car', objectType: 'vehicle', color: 'red' } }, { displayName: 'Family Car', objectType: 'vehicle', color: 'blue' }, {});
  assert.strictEqual(result.compatible, false); assert(result.reason.includes('color'));
});
check('location-scoped object requires same location', () => {
  const object = { objectType: 'furniture', canonicalIdentity: { scopeKind: 'location', scopeAnchor: 'loc_a', objectType: 'furniture' } };
  assert.strictEqual(compatibleCanonicalIdentity(object, { objectType: 'furniture' }, { locationId: 'loc_b' }).compatible, false);
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const registrySource = fs.readFileSync(registryPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns aliases table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_aliases'],
  ['database owns resolutions table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_resolutions'],
  ['alias uniqueness is per object', dbSource, 'UNIQUE(namespace, object_id, alias_key)'],
  ['resolution audit is unique by production scope reference', dbSource, 'UNIQUE(production_id, scope_key, reference_key)'],
  ['database saves alias', dbSource, 'async savePersistentWorldObjectAlias(input = {})'],
  ['database lists aliases by key', dbSource, 'async listPersistentWorldObjectAliasesByKey(namespace, aliasKey)'],
  ['database saves resolver audit', dbSource, 'async savePersistentWorldObjectResolution(input = {})'],
  ['bundle loads resolver audits', dbSource, 'const persistentWorldObjectResolutions = await this.listPersistentWorldObjectResolutions(productionId);'],
  ['bundle exposes resolver audits', dbSource, 'persistentWorldObjectResolutions,'],
  ['registry imports resolver', registrySource, "PersistentWorldObjectResolverV11 } = require('./persistent-world-object-resolver-v11')"],
  ['registry collects aliases', registrySource, 'localizedNames'],
  ['registry calls resolver before registration', registrySource, 'this.objectResolver.resolveCandidate({'],
  ['registry fails closed on ambiguity', registrySource, "resolution?.status === 'ambiguous'"],
  ['registry fails closed on resolver conflict', registrySource, "resolution?.status === 'conflict'"],
  ['registry records truthful new registration', registrySource, 'this.objectResolver.recordRegistration('],
  ['registry uses resolver match mode in usage', registrySource, "resolution?.matchMode || 'identity_fingerprint_exact_reuse'"],
  ['dashboard shows resolver panel', dashboardSource, 'OBJECT ALIASES + RESOLVER V11.10.2'],
  ['resolver enabled by default', envSource, 'PERSISTENT_WORLD_OBJECT_RESOLVER_ENABLED=true'],
  ['contextual generic enabled by default', envSource, 'PERSISTENT_WORLD_OBJECT_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes resolver verifier', () => assert.strictEqual(pkg.scripts['test:persistent-world-object-resolver'], 'node ../bootstrap/verify-phase11-persistent-world-object-resolver.js'));

async function runtimeChecks() {
  const objects = new Map();
  const usages = [];
  const aliases = [];
  const resolutions = new Map();
  const db = {
    async getPersistentWorldObject(id) { return objects.get(id) ? { ...objects.get(id) } : null; },
    async getPersistentWorldObjectByFingerprint(namespace, fp) { return [...objects.values()].find(item => item.namespace === namespace && item.identityFingerprint === fp) || null; },
    async getPersistentWorldObjectByKey(namespace, key) { return [...objects.values()].find(item => item.namespace === namespace && item.objectKey === key) || null; },
    async listPersistentWorldObjects(namespace) { return [...objects.values()].filter(item => item.namespace === namespace).map(item => ({ ...item })); },
    async savePersistentWorldObject(input) {
      const existing = await this.getPersistentWorldObjectByFingerprint(input.namespace, input.identityFingerprint);
      const saved = existing ? { ...existing, lastSeenAt: '2026-09-15T00:00:00Z' } : { ...input, firstSeenAt: '2026-09-15T00:00:00Z', lastSeenAt: '2026-09-15T00:00:00Z' };
      objects.set(saved.id, saved); return { ...saved };
    },
    async savePersistentWorldObjectUsage(input) {
      let row = usages.find(item => item.objectId === input.objectId && item.productionId === input.productionId && item.scopeKey === input.scopeKey);
      if (row) Object.assign(row, input); else { row = { id: `usage_${usages.length + 1}`, ...input }; usages.push(row); }
      return { ...row };
    },
    async savePersistentWorldObjectAlias(input) {
      let row = aliases.find(item => item.namespace === input.namespace && item.objectId === input.objectId && item.aliasKey === input.aliasKey);
      if (row) Object.assign(row, input); else { row = { id: `alias_${aliases.length + 1}`, ...input }; aliases.push(row); }
      return { ...row };
    },
    async listPersistentWorldObjectAliasesByKey(namespace, aliasKey) { return aliases.filter(item => item.namespace === namespace && item.aliasKey === aliasKey).map(item => ({ ...item })); },
    async savePersistentWorldObjectResolution(input) {
      const key = `${input.productionId}:${input.scopeKey}:${input.referenceKey}`;
      const row = { ...(resolutions.get(key) || {}), ...input, id: resolutions.get(key)?.id || `resolution_${resolutions.size + 1}` };
      resolutions.set(key, row); return { ...row };
    }
  };

  const registry = new PersistentWorldObjectRegistryV11(db, { enabled: true, namespace: 'series' });
  const locA = [{ id: 'loc_miller', usage: { environmentId: 'env_a' } }];
  const locB = [{ id: 'loc_street', usage: { environmentId: 'env_b' } }];

  const planA = await registry.ensureProductionObjects({ id: 'video_a' }, { environments: [{ environmentId: 'env_a', persistentObjects: [{
    objectKey: 'miller_family_car', name: 'Miller Family Car', type: 'vehicle', color: 'red', material: 'metal', aliases: ['family car', 'Carro da Família Miller']
  }] }] }, [], locA, []);
  check('A registers one canonical car', () => assert.strictEqual(planA.summary.registered, 1));
  const car = planA.objects[0].object;
  check('A stores canonical + explicit aliases', () => assert(aliases.some(row => row.objectId === car.id && row.aliasKey === 'family car') && aliases.some(row => row.aliasKey === 'carro da familia miller')));
  check('A resolver audit ends registered_new', () => assert([...resolutions.values()].some(row => row.productionId === 'video_a' && row.status === 'registered_new' && row.objectId === car.id)));

  const planB = await registry.ensureProductionObjects({ id: 'video_b' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    name: 'family car', type: 'vehicle', color: 'red', material: 'metal'
  }] }] }, [], locB, []);
  check('B exact alias reuses canonical car', () => assert(planB.objects[0].reused && planB.objects[0].object.id === car.id));
  check('B match mode is object_alias_exact', () => assert.strictEqual(planB.objects[0].matchMode, 'object_alias_exact'));
  check('B usage carries alias match mode', () => assert(usages.some(row => row.productionId === 'video_b' && row.objectId === car.id && row.matchMode === 'object_alias_exact')));

  const planPt = await registry.ensureProductionObjects({ id: 'video_pt' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    name: 'Carro da Família Miller', type: 'vehicle', color: 'red', material: 'metal'
  }] }] }, [], locB, []);
  check('localized exact alias reuses car', () => assert(planPt.objects[0].reused && planPt.objects[0].object.id === car.id && planPt.objects[0].matchMode === 'object_alias_exact'));

  const planC = await registry.ensureProductionObjects({ id: 'video_c' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    name: 'their car', type: 'vehicle'
  }] }] }, [], locB, []);
  check('C generic unique vehicle resolves', () => assert(planC.objects[0].reused && planC.objects[0].object.id === car.id));
  check('C uses contextual unique mode', () => assert.strictEqual(planC.objects[0].matchMode, 'object_context_unique'));

  const planD = await registry.ensureProductionObjects({ id: 'video_d' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    objectKey: 'parker_family_car', name: 'Parker Family Car', type: 'vehicle', color: 'black', material: 'metal', aliases: ['family car']
  }] }] }, [], locB, []);
  check('D registers second named car', () => assert.strictEqual(planD.summary.registered, 1));
  const parker = planD.objects[0].object;
  check('D car is distinct', () => assert.notStrictEqual(parker.id, car.id));

  const planE = await registry.ensureProductionObjects({ id: 'video_e' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    name: 'their car', type: 'vehicle'
  }] }] }, [], locB, []);
  check('E generic car fails closed as ambiguous', () => assert.strictEqual(planE.objects[0].status, 'ambiguous'));
  check('E ambiguity creates no object', () => assert.strictEqual(planE.objects[0].object, null));
  check('E ambiguity is audited', () => assert([...resolutions.values()].some(row => row.productionId === 'video_e' && row.status === 'ambiguous' && row.matchMode === 'object_context_ambiguous')));

  const planAliasAmb = await registry.ensureProductionObjects({ id: 'video_alias_amb' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    name: 'family car', type: 'vehicle'
  }] }] }, [], locB, []);
  check('duplicate exact alias fails closed', () => assert.strictEqual(planAliasAmb.objects[0].status, 'ambiguous'));
  check('duplicate exact alias mode is audited', () => assert([...resolutions.values()].some(row => row.productionId === 'video_alias_amb' && row.matchMode === 'object_alias_ambiguous')));

  const before = objects.size;
  const planNew = await registry.ensureProductionObjects({ id: 'video_new' }, { environments: [{ environmentId: 'env_b', persistentObjects: [{
    name: 'Ancient Compass', type: 'artifact', material: 'brass', aliases: ['Bússola Antiga']
  }] }] }, [], locB, []);
  check('unmatched named object registers new', () => assert.strictEqual(planNew.summary.registered, 1));
  check('new registration increases canonical count once', () => assert.strictEqual(objects.size, before + 1));
  check('new object audit is truthful registered_new', () => assert([...resolutions.values()].some(row => row.productionId === 'video_new' && row.status === 'registered_new' && row.matchMode === 'resolver_unresolved_register_new')));

  const direct = new PersistentWorldObjectResolverV11(db, { enabled: true });
  const conflict = await direct.resolveCandidate({ namespace: 'series', production: { id: 'video_conflict' }, scopeKey: 'env_b', locationId: 'loc_street', candidate: {
    explicitObjectKey: 'miller_family_car', displayName: 'Miller Family Car', objectType: 'vehicle', color: 'blue'
  }, referenceText: 'Miller Family Car', identityFingerprint: 'incoming_conflict' });
  check('explicit object key canonical mismatch is conflict', () => assert.strictEqual(conflict.status, 'conflict'));
  check('explicit object key conflict does not resolve', () => assert.strictEqual(conflict.object, null));

  const disabled = await new PersistentWorldObjectResolverV11(db, { enabled: false }).resolveCandidate({ namespace: 'series', production: { id: 'video_disabled' }, candidate: { displayName: 'their car', objectType: 'vehicle' } });
  check('disabled resolver remains unresolved', () => assert.strictEqual(disabled.status, 'unresolved'));
}

runtimeChecks().then(() => console.log(`Phase 11.10.2 Persistent World Object Resolver OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
