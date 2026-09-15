'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'reusable-location-library-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.1 runtime is not materialized: utils/reusable-location-library-v11.js');

const {
  REUSABLE_LOCATION_LIBRARY_VERSION,
  ReusableLocationLibraryV11,
  buildLocationIdentity,
  identityFingerprint,
  locationKeyFor,
  canonicalPromptContext,
  propSnapshot
} = require(runtimePath);

const houseA = {
  environmentId: 'env_house_video_a',
  fingerprint: 'environment-fingerprint-a',
  name: 'Woodland Home',
  category: 'house',
  description: 'Tom walks into his familiar house on a sunny morning.',
  construction: 'natural wood construction',
  architecturalStyle: 'cozy rustic family home',
  materials: ['natural wood', 'soft fabric'],
  palette: ['warm natural brown', 'soft beige', 'cream'],
  lighting: 'warm soft daylight',
  layout: 'living room connected to compact kitchen',
  signatureElements: ['main seating area', 'wooden table', 'windows', 'shelving or storage'],
  forbiddenChanges: ['do not redesign the room layout between adjacent shots']
};
const houseB = {
  ...houseA,
  environmentId: 'env_house_video_b',
  fingerprint: 'environment-fingerprint-b',
  description: 'The same home is shown during a storm at night.',
  lighting: 'television glow and rainy night ambience'
};
const houseChangedLayout = {
  ...houseB,
  environmentId: 'env_house_changed',
  layout: 'open-plan loft with staircase in the center'
};
const locks = [
  {
    id: 'prop_sofa', environmentId: houseA.environmentId, name: 'sofa', type: 'furniture', required: true,
    continuityPriority: 'critical', lockedAttributes: { color: 'beige', material: 'soft fabric', silhouette: 'stable sofa form', relativePlacement: 'left of the coffee table' },
    forbiddenChanges: ['do not replace sofa']
  },
  {
    id: 'prop_table', environmentId: houseA.environmentId, name: 'coffee table', type: 'furniture', required: true,
    continuityPriority: 'critical', lockedAttributes: { color: null, material: 'natural wood', silhouette: 'low rectangular table', relativePlacement: 'in front of sofa' },
    forbiddenChanges: ['do not replace coffee table']
  }
];
const locksB = locks.map((lock, index) => ({ ...lock, id: `video_b_prop_${index}`, environmentId: houseB.environmentId }));
const changedLocks = locks.map(lock => ({ ...lock, environmentId: houseChangedLayout.environmentId }));

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('version is 11.9.1', () => assert.strictEqual(REUSABLE_LOCATION_LIBRARY_VERSION, '11.9.1'));
check('canonical identity excludes description', () => assert(!Object.prototype.hasOwnProperty.call(buildLocationIdentity(houseA, locks), 'description')));
check('canonical identity excludes lighting', () => assert(!Object.prototype.hasOwnProperty.call(buildLocationIdentity(houseA, locks), 'lighting')));
check('canonical identity includes layout', () => assert.strictEqual(buildLocationIdentity(houseA, locks).layout, houseA.layout));
check('canonical identity includes required props', () => assert.strictEqual(buildLocationIdentity(houseA, locks).requiredProps.length, 2));
check('optional/nonmatching props are not smuggled into snapshot', () => {
  const snapshot = propSnapshot([...locks, { id: 'optional', environmentId: houseA.environmentId, name: 'lamp', required: false }], houseA.environmentId);
  assert.deepStrictEqual(snapshot.map(item => item.id), ['prop_sofa', 'prop_table']);
});
check('same physical house survives description, lighting, and production-local prop IDs', () => assert.strictEqual(identityFingerprint(houseA, locks), identityFingerprint(houseB, locksB)));
check('layout change creates a different identity', () => assert.notStrictEqual(identityFingerprint(houseA, locks), identityFingerprint(houseChangedLayout, changedLocks)));
check('location key is deterministic for same identity', () => {
  const fp = identityFingerprint(houseA, locks);
  assert.strictEqual(locationKeyFor(houseA, fp), locationKeyFor(houseB, fp));
});
check('explicit reusable location key wins', () => {
  const env = { ...houseA, reusableLocationKey: 'Miller House' };
  assert.strictEqual(locationKeyFor(env, identityFingerprint(env, locks)), 'miller_house');
});
check('prompt labels production-independent identity', () => assert(canonicalPromptContext(buildLocationIdentity(houseA, locks)).includes('production-independent')));
check('prompt forbids temporary state in canonical identity', () => assert(canonicalPromptContext(buildLocationIdentity(houseA, locks)).includes('time of day, weather, temporary clutter')));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns reusable_locations', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_locations')));
check('database owns reusable_location_usages', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_usages')));
check('location identity is unique per namespace', () => assert(dbSource.includes('UNIQUE(namespace, identity_fingerprint)')));
check('usage link is unique per location/video/environment', () => assert(dbSource.includes('UNIQUE(location_id, production_id, environment_id)')));
check('database persists reusable locations', () => assert(dbSource.includes('async saveReusableLocation(input = {})')));
check('database gets location by fingerprint', () => assert(dbSource.includes('async getReusableLocationByFingerprint(namespace, identityFingerprint)')));
check('database gets location by stable key', () => assert(dbSource.includes('async getReusableLocationByKey(namespace, locationKey)')));
check('database lists library locations', () => assert(dbSource.includes("async listReusableLocations(namespace = 'default')")));
check('database persists per-video usage', () => assert(dbSource.includes('async saveReusableLocationUsage(input = {})')));
check('production bundle exposes reusable location bindings', () => assert(dbSource.includes('const reusableLocations = await this.listProductionReusableLocations(productionId);') && dbSource.includes('reusableLocations,')));
check('scene pipeline imports ReusableLocationLibrary', () => assert(pipelineSource.includes("const { ReusableLocationLibraryV11 } = require('./reusable-location-library-v11');")));
check('scene pipeline constructs ReusableLocationLibrary', () => assert(pipelineSource.includes('this.reusableLocationLibrary = options.reusableLocationLibrary || new ReusableLocationLibraryV11')));
check('scene pipeline captures production locations', () => assert(pipelineSource.includes('this.reusableLocationLibrary.ensureProductionLocations(production, environmentBible, locationMasterFrames, locationLocks)')));
check('Review Studio renders reusable location panel', () => assert(dashboardSource.includes('REUSABLE LOCATION LIBRARY V11.9.1')));
check('dashboard explicitly distinguishes exact reuse from future resolver', () => assert(dashboardSource.includes('Semantic/alias resolution belongs to 11.9.4')));
check('library is enabled by default', () => assert(envSource.includes('REUSABLE_LOCATION_LIBRARY_ENABLED=true')));
check('namespace is explicit', () => assert(envSource.includes('REUSABLE_LOCATION_NAMESPACE=default')));
check('package exposes reusable location test', () => assert.strictEqual(pkg.scripts['test:reusable-locations'], 'node ../bootstrap/verify-phase11-reusable-location-library.js'));

async function runtimeChecks() {
  const tempRoot = path.join(upstream, 'data', `test-reusable-locations-${process.pid}-${Date.now()}`);
  await fsp.mkdir(tempRoot, { recursive: true });
  const sourceMaster = path.join(tempRoot, 'provider-master.svg');
  await fsp.writeFile(sourceMaster, '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#8b6f47"/></svg>', 'utf8');

  const locations = new Map();
  const usages = new Map();
  const fakeDb = {
    async getReusableLocationByFingerprint(namespace, fingerprint) {
      return locations.get(`${namespace}:${fingerprint}`) || null;
    },
    async saveReusableLocation(input) {
      const key = `${input.namespace}:${input.identityFingerprint}`;
      const existing = locations.get(key);
      const saved = existing ? {
        ...existing,
        ...input,
        id: existing.id,
        locationKey: existing.locationKey,
        createdFromProductionId: existing.createdFromProductionId,
        firstSeenAt: existing.firstSeenAt,
        canonicalMasterFrameId: existing.canonicalMasterFrameId || input.canonicalMasterFrameId,
        canonicalMasterFramePath: existing.canonicalMasterFramePath || input.canonicalMasterFramePath,
        canonicalMasterFrameSha256: existing.canonicalMasterFrameSha256 || input.canonicalMasterFrameSha256,
        status: existing.canonicalMasterFramePath || input.canonicalMasterFramePath ? 'canonical_ready' : input.status
      } : { ...input };
      locations.set(key, saved);
      return { ...saved };
    },
    async saveReusableLocationUsage(input) {
      const key = `${input.locationId}:${input.productionId}:${input.environmentId}`;
      const saved = { id: usages.get(key)?.id || `usage_${usages.size + 1}`, ...input };
      usages.set(key, saved);
      return { ...saved };
    }
  };

  const masterA = [{
    id: 'master_a', environmentId: houseA.environmentId, canonical: true, status: 'ready',
    masterFramePath: sourceMaster, assetSha256: 'source-sha-a'
  }];
  const service = new ReusableLocationLibraryV11(fakeDb, { enabled: true, namespace: 'series-alpha', dataRoot: tempRoot });
  const first = await service.ensureProductionLocations({ id: 'prod_a' }, { environments: [houseA] }, masterA, locks);
  const firstLocation = first.locations[0].location;
  const firstMasterBytes = await fsp.readFile(firstLocation.canonicalMasterFramePath, 'utf8');
  const firstMasterExistsBeforeCleanup = fs.existsSync(firstLocation.canonicalMasterFramePath);

  check('first video registers one location', () => assert.strictEqual(first.summary.registered, 1));
  check('first video does not claim reuse', () => assert.strictEqual(first.summary.reused, 0));
  check('provider-backed master is copied into location library', () => assert(firstLocation.canonicalMasterFramePath.includes(path.join('location-library', 'series_alpha'))));
  check('library-owned master exists before cleanup', () => assert.strictEqual(firstMasterExistsBeforeCleanup, true));
  check('library-owned master preserves bytes', () => assert(firstMasterBytes.includes('<svg')));
  check('library-owned master has sha256', () => assert(/^[a-f0-9]{64}$/.test(firstLocation.canonicalMasterFrameSha256)));
  check('first location becomes canonical_ready', () => assert.strictEqual(firstLocation.status, 'canonical_ready'));

  const second = await service.ensureProductionLocations({ id: 'prod_b' }, { environments: [houseB] }, [], locksB);
  const secondLocation = second.locations[0].location;
  check('second video reuses exact physical identity', () => assert.strictEqual(second.summary.reused, 1));
  check('second video points to same location id', () => assert.strictEqual(secondLocation.id, firstLocation.id));
  check('second video preserves first canonical master', () => assert.strictEqual(secondLocation.canonicalMasterFramePath, firstLocation.canonicalMasterFramePath));
  check('second usage is recorded separately', () => assert([...usages.values()].some(usage => usage.productionId === 'prod_b' && usage.locationId === firstLocation.id)));
  check('cross-video reuse mode is explicit', () => assert([...usages.values()].some(usage => usage.productionId === 'prod_b' && usage.matchMode === 'identity_fingerprint_exact_reuse')));

  const third = await service.ensureProductionLocations({ id: 'prod_c' }, { environments: [houseChangedLayout] }, [], changedLocks);
  check('changed layout registers a different location', () => assert.strictEqual(third.summary.registered, 1));
  check('changed layout does not collapse into house A', () => assert.notStrictEqual(third.locations[0].location.id, firstLocation.id));
  check('unanchored location stays truthful', () => assert.strictEqual(third.locations[0].location.status, 'registered_unanchored'));
  check('unanchored location does not fabricate master path', () => assert.strictEqual(third.locations[0].location.canonicalMasterFramePath, null));

  const disabled = await new ReusableLocationLibraryV11(fakeDb, { enabled: false, namespace: 'series-alpha', dataRoot: tempRoot })
    .ensureProductionLocations({ id: 'prod_disabled' }, { environments: [houseA] }, masterA, locks);
  check('disabled library performs no registration', () => assert.strictEqual(disabled.summary.total, 0));
  check('disabled library reports inactive state', () => assert.strictEqual(disabled.active, false));

  await fsp.rm(tempRoot, { recursive: true, force: true });
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.9.1 Reusable Location Library OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
