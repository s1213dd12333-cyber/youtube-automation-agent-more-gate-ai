'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'location-resolver-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.4 runtime is not materialized: utils/location-resolver-v11.js');

const {
  LOCATION_RESOLVER_VERSION,
  LocationResolverV11,
  normalize,
  normalizeLocationType,
  referenceDescriptor,
  explicitEnvironmentAliases,
  aliasVariants,
  structuralFingerprint,
  candidateNameDescriptors
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('version is 11.9.4', () => assert.strictEqual(LOCATION_RESOLVER_VERSION, '11.9.4'));
check('normalization removes accents and punctuation', () => assert.strictEqual(normalize('  Casa dos Millér! '), 'casa dos miller'));
check('house class normalizes to dwelling', () => assert.strictEqual(normalizeLocationType('Family House'), 'dwelling'));
check('Portuguese casa normalizes to dwelling', () => assert.strictEqual(normalizeLocationType('Casa'), 'dwelling'));
check('Miller House descriptor extracts owner token', () => assert.strictEqual(referenceDescriptor('Miller House').core, 'miller'));
check('Miller home has same core', () => assert.strictEqual(referenceDescriptor('Miller home').core, 'miller'));
check('Casa dos Miller has same core', () => assert.strictEqual(referenceDescriptor('Casa dos Miller').core, 'miller'));
check('their house is generic', () => assert.strictEqual(referenceDescriptor('their house').generic, true));
check('their house still has dwelling type', () => assert.strictEqual(referenceDescriptor('their house').type, 'dwelling'));
check('Miller Guest House remains distinct', () => assert.notStrictEqual(referenceDescriptor('Miller Guest House').core, referenceDescriptor('Miller House').core));
check('alias variants include house/home/casa', () => {
  const aliases = aliasVariants('Miller House');
  assert(aliases.includes('miller house'));
  assert(aliases.includes('miller home'));
  assert(aliases.includes('miller casa'));
});
check('environment aliases include explicit aliases', () => assert.deepStrictEqual(
  explicitEnvironmentAliases({ name: 'Miller House', aliases: ['Miller home'], locationAliases: ['Casa dos Miller'] }),
  ['Miller House', 'Miller home', 'Casa dos Miller']
));
check('candidate descriptors normalize canonical display name', () => assert(candidateNameDescriptors({ displayName: 'Miller House', locationType: 'house' }).some(item => item.core === 'miller' && item.type === 'dwelling')));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const librarySource = fs.readFileSync(path.join(upstream, 'utils', 'reusable-location-library-v11.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns reusable_location_aliases', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_aliases')));
check('database owns reusable_location_resolutions', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_resolutions')));
check('alias uniqueness is scoped', () => assert(dbSource.includes('UNIQUE(namespace, location_id, alias_key)')));
check('resolution is unique per production/environment', () => assert(dbSource.includes('UNIQUE(production_id, environment_id)')));
check('database persists aliases', () => assert(dbSource.includes('async saveReusableLocationAlias(input = {})')));
check('database looks up aliases by key', () => assert(dbSource.includes('async listReusableLocationAliasesByKey(namespace, aliasKey)')));
check('database persists resolver audit', () => assert(dbSource.includes('async saveReusableLocationResolution(input = {})')));
check('production bundle exposes resolver decisions', () => assert(dbSource.includes('reusableLocationResolutions,')));
check('library imports resolver', () => assert(librarySource.includes("const { LocationResolverV11 } = require('./location-resolver-v11');")));
check('library constructs resolver', () => assert(librarySource.includes('this.locationResolver = options.locationResolver || new LocationResolverV11')));
check('resolver runs before new location id', () => assert(librarySource.indexOf('this.locationResolver.resolveEnvironment') < librarySource.indexOf('const locationId = existing?.id')));
check('ambiguous resolution fails closed', () => assert(librarySource.includes("resolution?.status === 'ambiguous'") && librarySource.includes("return { status: 'ambiguous'")));
check('resolver reuse preserves canonical fingerprint', () => assert(librarySource.includes('identityFingerprint: existing?.identityFingerprint || fingerprint')));
check('successful binding seeds aliases', () => assert(librarySource.includes('await this.locationResolver.ensureLocationAliases(location, environment);')));
check('usage stores resolver mode', () => assert(librarySource.includes('resolution?.location ? resolution.matchMode')));
check('summary exposes resolver reuse', () => assert(librarySource.includes('resolverReused:')));
check('summary exposes ambiguity', () => assert(librarySource.includes('ambiguous: locations.filter')));
check('dashboard renders resolver panel', () => assert(dashboardSource.includes('LOCATION RESOLVER V11.9.4')));
check('dashboard states generic fail-closed behavior', () => assert(dashboardSource.includes('Generic references resolve only with one compatible contextual candidate')));
check('resolver enabled by default', () => assert(envSource.includes('REUSABLE_LOCATION_RESOLVER_ENABLED=true')));
check('confidence threshold configurable', () => assert(envSource.includes('REUSABLE_LOCATION_RESOLVER_MIN_CONFIDENCE=0.82')));
check('generic contextual mode configurable', () => assert(envSource.includes('REUSABLE_LOCATION_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true')));
check('package exposes resolver test', () => assert.strictEqual(pkg.scripts['test:location-resolver'], 'node ../bootstrap/verify-phase11-location-resolver.js'));

const canonicalIdentity = {
  category: 'house', name: 'Miller House', construction: 'two story wooden family home', architecturalStyle: 'suburban cottage',
  materials: ['wood', 'stone'], palette: ['cream', 'brown'], layout: 'central hallway with living room left and kitchen rear',
  signatureElements: ['front porch', 'red door'],
  requiredProps: [{ name: 'blue sofa', type: 'furniture', lockedAttributes: { color: 'blue', material: 'fabric', relativePlacement: 'left wall' } }]
};
const renamedIdentity = { ...canonicalIdentity, name: 'Miller home' };
check('structural fingerprint ignores display name', () => assert.strictEqual(structuralFingerprint(canonicalIdentity), structuralFingerprint(renamedIdentity)));
check('structural fingerprint changes with layout', () => assert.notStrictEqual(structuralFingerprint(canonicalIdentity), structuralFingerprint({ ...canonicalIdentity, layout: 'single room loft' })));

function fakeDbFactory(initial = {}) {
  const locations = new Map((initial.locations || []).map(item => [item.id, { ...item }]));
  const aliases = [];
  const resolutions = [];
  const usagesByProduction = new Map(Object.entries(initial.productionLocations || {}));
  return {
    aliases, resolutions,
    async listReusableLocations(namespace) { return [...locations.values()].filter(item => (item.namespace || 'default') === (namespace || 'default')); },
    async getReusableLocation(id) { return locations.get(id) || null; },
    async listReusableLocationAliasesByKey(namespace, aliasKey) { return aliases.filter(item => item.namespace === namespace && item.aliasKey === aliasKey); },
    async saveReusableLocationAlias(input) {
      const existing = aliases.find(item => item.namespace === input.namespace && item.locationId === input.locationId && item.aliasKey === input.aliasKey);
      if (existing) { Object.assign(existing, input); return { ...existing }; }
      const saved = { id: `alias_${aliases.length + 1}`, ...input }; aliases.push(saved); return { ...saved };
    },
    async saveReusableLocationResolution(input) { const saved = { id: `resolution_${resolutions.length + 1}`, ...input }; resolutions.push(saved); return { ...saved }; },
    async listProductionReusableLocations(productionId) { return usagesByProduction.get(productionId) || []; }
  };
}

const miller = {
  id: 'location_miller', namespace: 'series_alpha', locationKey: 'miller_house_abc123', displayName: 'Miller House', locationType: 'house',
  identityFingerprint: 'fp-miller', canonicalIdentity
};
const parker = {
  id: 'location_parker', namespace: 'series_alpha', locationKey: 'parker_house_def456', displayName: 'Parker House', locationType: 'house',
  identityFingerprint: 'fp-parker', canonicalIdentity: { ...canonicalIdentity, name: 'Parker House', palette: ['white', 'gray'], layout: 'open-plan ground floor' }
};

async function runtimeChecks() {
  {
    const db = fakeDbFactory({ locations: [miller] });
    const resolver = new LocationResolverV11(db, { enabled: true });
    const aliases = await resolver.ensureLocationAliases(miller, { name: 'Miller House' });
    check('canonical seeding creates variants', () => assert(aliases.length >= 4));
    check('generic bare home is not persisted', () => assert(!db.aliases.some(item => item.aliasKey === 'home')));
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_b' }, environment: { environmentId: 'env_b', name: 'Miller home', category: 'house' }, identity: renamedIdentity, identityFingerprint: 'new-fp' });
    check('persisted alias resolves Miller home', () => assert.strictEqual(result.location.id, miller.id));
    check('persisted alias uses alias_exact', () => assert.strictEqual(result.matchMode, 'alias_exact'));
    check('alias resolution is audited', () => assert.strictEqual(db.resolutions.at(-1).locationId, miller.id));
  }
  {
    const db = fakeDbFactory({ locations: [miller] });
    const resolver = new LocationResolverV11(db, { enabled: true });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_b' }, environment: { environmentId: 'env_b', name: 'Casa dos Miller', category: 'casa' }, identity: { ...canonicalIdentity, name: 'Casa dos Miller' }, identityFingerprint: 'new-fp' });
    check('cross-language name resolves', () => assert.strictEqual(result.location.id, miller.id));
    check('cross-language mode is normalized entity/type', () => assert.strictEqual(result.matchMode, 'normalized_entity_type_match'));
  }
  {
    const db = fakeDbFactory({ locations: [miller] });
    const resolver = new LocationResolverV11(db, { enabled: true });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_b' }, environment: { environmentId: 'env_b', name: 'their house', category: 'house' }, identity: { ...renamedIdentity, name: 'their house' }, identityFingerprint: 'changed-name-fp' });
    check('unique exact structure resolves generic wording', () => assert.strictEqual(result.location.id, miller.id));
    check('structural mode is explicit', () => assert.strictEqual(result.matchMode, 'structural_identity_exact_without_name'));
  }
  {
    const db = fakeDbFactory({ locations: [miller], productionLocations: { prod_b: [miller] } });
    const resolver = new LocationResolverV11(db, { enabled: true });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_b' }, environment: { environmentId: 'env_b', name: 'their house', category: 'house' }, identity: { category: 'house', name: 'their house' }, identityFingerprint: 'minimal-fp' });
    check('generic reference uses one production-bound house', () => assert.strictEqual(result.location.id, miller.id));
    check('generic context mode is explicit', () => assert.strictEqual(result.matchMode, 'context_unique_production_location'));
  }
  {
    const db = fakeDbFactory({ locations: [miller, parker], productionLocations: { prod_b: [miller, parker] } });
    const resolver = new LocationResolverV11(db, { enabled: true });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_b' }, environment: { environmentId: 'env_b', name: 'their house', category: 'house' }, identity: { category: 'house', name: 'their house' }, identityFingerprint: 'minimal-fp' });
    check('two contextual houses fail closed', () => assert.strictEqual(result.status, 'ambiguous'));
    check('ambiguous generic does not choose a location', () => assert.strictEqual(result.location, null));
    check('ambiguous generic records candidates', () => assert.strictEqual(result.candidates.length, 2));
  }
  {
    const twin = { ...parker, id: 'location_twin', displayName: 'Miller Residence', canonicalIdentity: { ...canonicalIdentity, name: 'Miller Residence' } };
    const db = fakeDbFactory({ locations: [miller, twin] });
    const resolver = new LocationResolverV11(db, { enabled: true });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_c' }, environment: { environmentId: 'env_c', name: 'their home', category: 'house' }, identity: { ...renamedIdentity, name: 'their home' }, identityFingerprint: 'generic-fp' });
    check('duplicate structures fail closed', () => assert.strictEqual(result.status, 'ambiguous'));
    check('structural ambiguity reason is explicit', () => assert.strictEqual(result.reason, 'multiple_locations_share_structural_identity'));
  }
  {
    const db = fakeDbFactory({ locations: [miller, parker] });
    const resolver = new LocationResolverV11(db, { enabled: true });
    await db.saveReusableLocationAlias({ namespace: 'series_alpha', locationId: miller.id, aliasText: 'Old family home', aliasKey: 'old family home', locationType: 'dwelling', confidence: 0.95 });
    await db.saveReusableLocationAlias({ namespace: 'series_alpha', locationId: parker.id, aliasText: 'Old family home', aliasKey: 'old family home', locationType: 'dwelling', confidence: 0.95 });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_d' }, environment: { environmentId: 'env_d', name: 'Old family home', category: 'house' }, identity: { category: 'house', name: 'Old family home' }, identityFingerprint: 'x' });
    check('alias collisions fail closed', () => assert.strictEqual(result.status, 'ambiguous'));
    check('alias collision never chooses first row', () => assert.strictEqual(result.location, null));
  }
  {
    const db = fakeDbFactory({ locations: [miller] });
    const resolver = new LocationResolverV11(db, { enabled: true, minConfidence: 0.95 });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_e' }, environment: { environmentId: 'env_e', name: 'their home', category: 'house' }, identity: { ...renamedIdentity, name: 'their home' }, identityFingerprint: 'x' });
    check('high threshold can reject structural-only reuse', () => assert.strictEqual(result.status, 'unresolved'));
  }
  {
    const db = fakeDbFactory({ locations: [miller] });
    const resolver = new LocationResolverV11(db, { enabled: false });
    const result = await resolver.resolveEnvironment({ namespace: 'series_alpha', production: { id: 'prod_f' }, environment: { environmentId: 'env_f', name: 'Miller home', category: 'house' }, identity: renamedIdentity });
    check('disabled resolver does no matching', () => assert.strictEqual(result.status, 'disabled'));
    check('disabled resolver does not audit', () => assert.strictEqual(db.resolutions.length, 0));
  }

  for (const item of checks) await item.fn();
  console.log(`Phase 11.9.4 Location Resolver OK: ${checks.length} regression checks passed.`);
}

runtimeChecks().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
