'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-world-object-registry-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.1 runtime is not materialized: utils/persistent-world-object-registry-v11.js');

const {
  PERSISTENT_WORLD_OBJECT_VERSION,
  PersistentWorldObjectRegistryV11,
  propLockIsPersistent,
  normalizeObjectCandidate,
  candidateFromPropLock,
  explicitObjectsForEnvironment,
  objectIdentity,
  objectIdentityFingerprint,
  objectKeyFor,
  objectPromptContext,
  locationForEnvironment,
  zoneForCandidate
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.10.1', () => assert.strictEqual(PERSISTENT_WORLD_OBJECT_VERSION, '11.10.1'));
check('unmarked prop lock is not persistent', () => assert.strictEqual(propLockIsPersistent({ id: 'p1' }), false));
check('worldPersistent prop lock is persistent', () => assert.strictEqual(propLockIsPersistent({ id: 'p1', worldPersistent: true }), true));
check('persistent scope marker is accepted', () => assert.strictEqual(propLockIsPersistent({ id: 'p1', scope: 'persistent' }), true));
check('temporary explicit object is rejected', () => assert.strictEqual(normalizeObjectCandidate({ name: 'Christmas tree', temporary: true }), null));
check('scene-scoped explicit object is rejected', () => assert.strictEqual(normalizeObjectCandidate({ name: 'Moving boxes', scope: 'scene' }), null));
check('persistent=false explicit object is rejected', () => assert.strictEqual(normalizeObjectCandidate({ name: 'Disposable cup', persistent: false }), null));
check('unmarked prop lock candidate is rejected', () => assert.strictEqual(candidateFromPropLock({ id: 'p2', name: 'chair' }), null));
check('marked prop lock becomes candidate', () => assert.strictEqual(candidateFromPropLock({ id: 'p2', name: 'family television', worldPersistent: true }).displayName, 'family television'));
check('environment persistentObjects are collected', () => assert.strictEqual(explicitObjectsForEnvironment({ environmentId: 'env1', persistentObjects: [{ objectKey: 'family_car', name: 'Family Car' }] }).length, 1));
check('environment worldObjects are collected', () => assert.strictEqual(explicitObjectsForEnvironment({ environmentId: 'env1', worldObjects: ['Ancient Sword'] }).length, 1));

const globalA = normalizeObjectCandidate({ objectKey: 'miller_family_car', name: 'Family Car', type: 'vehicle', color: 'red', material: 'metal' }, { environmentId: 'env_a' });
const globalB = normalizeObjectCandidate({ objectKey: 'miller_family_car', name: 'Family Car', type: 'vehicle', color: 'red', material: 'metal', description: 'now dirty' }, { environmentId: 'env_b' });
const anon = normalizeObjectCandidate({ name: 'Blue Sofa', type: 'furniture', color: 'blue', material: 'fabric' }, { environmentId: 'env_a' });
check('explicit object key ignores location for identity', () => assert.strictEqual(
  objectIdentityFingerprint(globalA, { namespace: 'series', locationId: 'loc_a' }),
  objectIdentityFingerprint(globalB, { namespace: 'series', locationId: 'loc_b' })
));
check('anonymous object is location scoped', () => assert.notStrictEqual(
  objectIdentityFingerprint(anon, { namespace: 'series', locationId: 'loc_a' }),
  objectIdentityFingerprint(anon, { namespace: 'series', locationId: 'loc_b' })
));
check('temporary description is excluded from identity', () => assert.strictEqual(
  objectIdentityFingerprint(globalA, { namespace: 'series', locationId: 'loc_a' }),
  objectIdentityFingerprint({ ...globalA, description: 'scratched and wet tonight' }, { namespace: 'series', locationId: 'loc_a' })
));
check('color is canonical identity', () => assert.notStrictEqual(
  objectIdentityFingerprint(globalA, { namespace: 'series', locationId: 'loc_a' }),
  objectIdentityFingerprint({ ...globalA, color: 'blue' }, { namespace: 'series', locationId: 'loc_a' })
));
check('object key is deterministic', () => {
  const fp = objectIdentityFingerprint(globalA, { namespace: 'series', locationId: 'loc_a' });
  assert.strictEqual(objectKeyFor(globalA, fp), 'miller_family_car');
});
check('prompt forbids temporary state promotion', () => assert(objectPromptContext({ id: 'o1', objectKey: 'family_car', displayName: 'Family Car', canonicalIdentity: objectIdentity(globalA, { namespace: 'series', locationId: 'loc_a' }) }).includes('do not promote temporary scene props')));
check('prompt says location is usage context for keyed object', () => assert(objectPromptContext({ id: 'o1', objectKey: 'family_car', displayName: 'Family Car', canonicalIdentity: objectIdentity(globalA, { namespace: 'series', locationId: 'loc_a' }) }).includes('location and zone are usage context')));

const locationBindings = [
  { id: 'loc_a', usage: { environmentId: 'env_a' } },
  { id: 'loc_b', usage: { environmentId: 'env_b' } }
];
const zones = [
  { id: 'zone_living', zoneKey: 'living_room', locationId: 'loc_a' },
  { id: 'zone_garage', zoneKey: 'garage', locationId: 'loc_a' }
];
check('location binding resolves by environment', () => assert.strictEqual(locationForEnvironment(locationBindings, 'env_b').id, 'loc_b'));
check('zone candidate resolves explicit zone key', () => assert.strictEqual(zoneForCandidate(zones, { zoneKey: 'garage' }).id, 'zone_garage'));
check('zone candidate without zone evidence stays null', () => assert.strictEqual(zoneForCandidate(zones, {}), null));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns persistent_world_objects', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_objects'],
  ['database owns persistent_world_object_usages', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_usages'],
  ['object identity unique per namespace', dbSource, 'UNIQUE(namespace, identity_fingerprint)'],
  ['object key unique per namespace', dbSource, 'UNIQUE(namespace, object_key)'],
  ['usage unique by object production scope', dbSource, 'UNIQUE(object_id, production_id, scope_key)'],
  ['object references reusable location', dbSource, 'FOREIGN KEY (canonical_location_id) REFERENCES reusable_locations(id) ON DELETE SET NULL'],
  ['object references reusable zone', dbSource, 'FOREIGN KEY (canonical_zone_id) REFERENCES reusable_location_zones(id) ON DELETE SET NULL'],
  ['database saves persistent object', dbSource, 'async savePersistentWorldObject(input = {})'],
  ['database reads object by fingerprint', dbSource, 'async getPersistentWorldObjectByFingerprint(namespace, fingerprint)'],
  ['database saves object usage', dbSource, 'async savePersistentWorldObjectUsage(input = {})'],
  ['bundle loads persistent objects', dbSource, 'const persistentWorldObjects = await this.listProductionPersistentWorldObjects(productionId);'],
  ['bundle exposes persistent objects', dbSource, 'persistentWorldObjects,'],
  ['pipeline imports registry', pipelineSource, "PersistentWorldObjectRegistryV11 } = require('./persistent-world-object-registry-v11')"],
  ['pipeline constructs registry', pipelineSource, 'this.persistentWorldObjects = options.persistentWorldObjects || new PersistentWorldObjectRegistryV11'],
  ['pipeline ensures production objects', pipelineSource, 'this.persistentWorldObjects.ensureProductionObjects(production, environmentBible, objectLocks, objectLocationBindings, objectZoneBindings)'],
  ['pipeline registers objects before temp state', pipelineSource, 'let persistentWorldObjectPlan = null;'],
  ['dashboard renders object registry', dashboardSource, 'PERSISTENT WORLD OBJECTS V11.10.1'],
  ['dashboard explains temporary exclusion', dashboardSource, 'Temporary props from 11.9.5 are excluded'],
  ['env enables persistent objects', envSource, 'PERSISTENT_WORLD_OBJECTS_ENABLED=true'],
  ['env has object namespace', envSource, 'PERSISTENT_WORLD_OBJECT_NAMESPACE=default']
]) check(name, () => assert(source.includes(token)));
check('package exposes object verifier', () => assert.strictEqual(pkg.scripts['test:persistent-world-objects'], 'node ../bootstrap/verify-phase11-persistent-world-objects.js'));
check('persistent object plan is before temporary state plan', () => assert(pipelineSource.indexOf('let persistentWorldObjectPlan = null;') < pipelineSource.indexOf('let temporaryLocationStatePlan = null;')));

async function runtimeChecks() {
  const objects = new Map();
  const usages = [];
  const db = {
    async getPersistentWorldObjectByFingerprint(namespace, fp) {
      return [...objects.values()].find(item => item.namespace === namespace && item.identityFingerprint === fp) || null;
    },
    async getPersistentWorldObjectByKey(namespace, objectKey) {
      return [...objects.values()].find(item => item.namespace === namespace && item.objectKey === objectKey) || null;
    },
    async savePersistentWorldObject(input) {
      const existing = await this.getPersistentWorldObjectByFingerprint(input.namespace, input.identityFingerprint);
      const saved = existing ? { ...existing, lastSeenAt: new Date().toISOString() } : { ...input, firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z' };
      objects.set(saved.id, saved);
      return { ...saved };
    },
    async savePersistentWorldObjectUsage(input) {
      const existing = usages.find(item => item.objectId === input.objectId && item.productionId === input.productionId && item.scopeKey === input.scopeKey);
      if (existing) Object.assign(existing, input);
      else usages.push({ id: `usage_${usages.length + 1}`, ...input });
      return { ...(existing || usages.at(-1)) };
    }
  };

  const registry = new PersistentWorldObjectRegistryV11(db, { enabled: true, namespace: 'series' });
  const bibleA = { environments: [{ environmentId: 'env_a', persistentObjects: [
    { objectKey: 'miller_family_car', name: 'Family Car', type: 'vehicle', color: 'red', material: 'metal' },
    { name: 'Blue Sofa', type: 'furniture', color: 'blue', material: 'fabric', zoneKey: 'living_room' },
    { name: 'Party balloons', temporary: true }
  ] }] };
  const locksA = [
    { id: 'prop_tv', environmentId: 'env_a', name: 'Family Television', type: 'electronics', worldPersistent: true, lockedAttributes: { identity: 'Family Television', type: 'electronics', color: 'black' } },
    { id: 'prop_chair', environmentId: 'env_a', name: 'Chair', type: 'furniture', lockedAttributes: { identity: 'Chair' } }
  ];
  const planA = await registry.ensureProductionObjects({ id: 'video_a' }, bibleA, locksA, locationBindings.slice(0, 1), zones);
  check('video A registers three persistent objects', () => assert.strictEqual(planA.summary.registered, 3));
  check('video A excludes temporary balloons', () => assert(!planA.objects.some(item => item.object.displayName === 'Party balloons')));
  check('video A excludes unmarked chair lock', () => assert(!planA.objects.some(item => item.usage?.propLockId === 'prop_chair')));
  check('video A includes marked TV lock', () => assert(planA.objects.some(item => item.usage?.propLockId === 'prop_tv')));
  const carA = planA.objects.find(item => item.object.objectKey === 'miller_family_car');
  const sofaA = planA.objects.find(item => item.object.displayName === 'Blue Sofa');
  check('car canonical location is recorded without becoming key identity', () => assert.strictEqual(carA.object.canonicalLocationId, 'loc_a'));
  check('sofa explicit zone is recorded', () => assert.strictEqual(sofaA.object.canonicalZoneId, 'zone_living'));

  const bibleB = { environments: [{ environmentId: 'env_b', persistentObjects: [
    { objectKey: 'miller_family_car', name: 'Family Car', type: 'vehicle', color: 'red', material: 'metal', description: 'parked outside in rain' },
    { name: 'Blue Sofa', type: 'furniture', color: 'blue', material: 'fabric' }
  ] }] };
  const planB = await registry.ensureProductionObjects({ id: 'video_b' }, bibleB, [], locationBindings.slice(1), []);
  const carB = planB.objects.find(item => item.object.objectKey === 'miller_family_car');
  const sofaB = planB.objects.find(item => item.object.displayName === 'Blue Sofa');
  check('global keyed car reuses across locations/videos', () => assert(carB.reused && carB.object.id === carA.object.id));
  check('anonymous sofa in another location becomes distinct', () => assert(!sofaB.reused && sofaB.object.id !== sofaA.object.id));
  check('canonical keyed car location remains origin location', () => assert.strictEqual(carB.object.canonicalLocationId, 'loc_a'));
  check('car second usage records new location', () => assert(usages.some(item => item.objectId === carA.object.id && item.productionId === 'video_b' && item.locationId === 'loc_b')));
  check('registry now has four canonical objects', () => assert.strictEqual(objects.size, 4));

  const conflictBible = { environments: [{ environmentId: 'env_b', persistentObjects: [
    { objectKey: 'miller_family_car', name: 'Family Car', type: 'vehicle', color: 'blue', material: 'metal' }
  ] }] };
  const conflictPlan = await registry.ensureProductionObjects({ id: 'video_conflict' }, conflictBible, [], locationBindings.slice(1), []);
  check('explicit key identity mutation fails closed', () => assert.strictEqual(conflictPlan.summary.conflicts, 1));
  check('explicit key conflict creates no new canonical object', () => assert.strictEqual(objects.size, 4));
  check('explicit key conflict is not counted as reuse', () => assert.strictEqual(conflictPlan.summary.reused, 0));

  const disabled = await new PersistentWorldObjectRegistryV11(db, { enabled: false }).ensureProductionObjects({ id: 'video_c' }, bibleA, locksA, locationBindings, zones);
  check('disabled registry is inactive', () => assert.strictEqual(disabled.active, false));
  check('disabled registry creates nothing', () => assert.strictEqual(disabled.objects.length, 0));
}

runtimeChecks().then(() => console.log(`Phase 11.10.1 Persistent World Object Registry OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
