'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'location-zone-registry-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.2 runtime is not materialized: utils/location-zone-registry-v11.js');

const {
  REUSABLE_LOCATION_ZONES_VERSION,
  LocationZoneRegistryV11,
  normalizeZoneName,
  zoneDefinition,
  detectExplicitZones,
  resolveSceneZone,
  buildZoneIdentity,
  zoneFingerprint,
  canonicalZonePrompt,
  bindingForEnvironment
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const location = {
  id: 'location_miller_house',
  locationKey: 'miller_house',
  displayName: 'Miller House',
  identityFingerprint: 'location-fingerprint',
  canonicalPromptContext: 'same wooden family home; stable architecture and layout'
};

check('version is 11.9.2', () => assert.strictEqual(REUSABLE_LOCATION_ZONES_VERSION, '11.9.2'));
check('living room alias normalizes', () => assert.strictEqual(normalizeZoneName('Sala de estar'), 'living_room'));
check('corridor alias normalizes to hallway', () => assert.strictEqual(normalizeZoneName('corridor'), 'hallway'));
check('backyard alias normalizes to yard', () => assert.strictEqual(normalizeZoneName('backyard'), 'yard'));
check('unknown zone does not fabricate identity', () => assert.strictEqual(normalizeZoneName('mysterious chamber'), null));
check('living room has room type', () => assert.strictEqual(zoneDefinition('living_room').type, 'room'));
check('garden has outdoor type', () => assert.strictEqual(zoneDefinition('garden').type, 'outdoor_area'));
check('hallway has transition type', () => assert.strictEqual(zoneDefinition('hallway').type, 'transition_area'));
check('single explicit room resolves', () => assert.strictEqual(detectExplicitZones({ scriptText: 'Tom waits in the kitchen.' }).zoneKey, 'kitchen'));
check('multiple explicit rooms are ambiguous', () => assert.strictEqual(detectExplicitZones({ scriptText: 'Tom leaves the kitchen and enters the living room.' }).status, 'ambiguous'));
check('no room evidence stays none', () => assert.strictEqual(detectExplicitZones({ scriptText: 'Tom smiles at his friend.' }).status, 'none'));
check('persisted mapper zone is accepted', () => assert.strictEqual(resolveSceneZone({ zone: 'living_room', confidence: 0.8 }, { scriptText: 'Tom sits down.' }).zoneKey, 'living_room'));
check('scene text can recover an explicit missing mapper zone', () => assert.strictEqual(resolveSceneZone({ zone: null }, { scriptText: 'Tom walks through the hallway.' }).zoneKey, 'hallway'));
check('ambiguous text overrides first-match temptation', () => assert.strictEqual(resolveSceneZone({ zone: 'kitchen' }, { scriptText: 'From the kitchen Tom enters the living room.' }).status, 'ambiguous'));
check('zone identity carries parent location', () => assert.strictEqual(buildZoneIdentity(location, 'living_room').parentLocationId, location.id));
check('zone identity carries parent fingerprint', () => assert.strictEqual(buildZoneIdentity(location, 'living_room').parentIdentityFingerprint, location.identityFingerprint));
check('same zone alias yields same cross-video fingerprint', () => assert.strictEqual(zoneFingerprint(location, 'living_room'), zoneFingerprint(location, 'Sala de estar')));
check('different rooms yield different fingerprints', () => assert.notStrictEqual(zoneFingerprint(location, 'living_room'), zoneFingerprint(location, 'kitchen')));
check('canonical zone prompt names parent', () => assert(canonicalZonePrompt(location, 'living_room').includes('Miller House')));
check('canonical zone prompt forbids temporary state', () => assert(canonicalZonePrompt(location, 'living_room').includes('time of day, weather, temporary clutter')));
check('canonical zone prompt forbids unsupported spatial invention', () => assert(canonicalZonePrompt(location, 'living_room').includes('Do not invent adjacency, dimensions, doors, furniture, or props')));
check('environment binding resolves current production environment to shared location', () => {
  const binding = bindingForEnvironment([{ ...location, usage: { environmentId: 'env_video_b' } }], 'env_video_b');
  assert.strictEqual(binding.location.id, location.id);
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns reusable_location_zones', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_zones')));
check('database owns reusable_location_zone_usages', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_zone_usages')));
check('zone key is unique inside parent location', () => assert(dbSource.includes('UNIQUE(location_id, zone_key)')));
check('scene has one canonical zone binding per production', () => assert(dbSource.includes('UNIQUE(production_id, scene_id)')));
check('zone table references reusable location', () => assert(dbSource.includes('FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE')));
check('database persists reusable location zone', () => assert(dbSource.includes('async saveReusableLocationZone(input = {})')));
check('database gets zone by stable parent/key pair', () => assert(dbSource.includes('async getReusableLocationZoneByKey(locationId, zoneKey)')));
check('database lists zones for a location', () => assert(dbSource.includes('async listReusableLocationZones(locationId)')));
check('database persists scene to zone usage', () => assert(dbSource.includes('async saveReusableLocationZoneUsage(input = {})')));
check('production bundle exposes reusableLocationZones', () => assert(dbSource.includes('const reusableLocationZones = await this.listProductionReusableLocationZones(productionId);') && dbSource.includes('reusableLocationZones,')));
check('pipeline imports LocationZoneRegistry', () => assert(pipelineSource.includes("const { LocationZoneRegistryV11 } = require('./location-zone-registry-v11');")));
check('pipeline constructs LocationZoneRegistry', () => assert(pipelineSource.includes('this.locationZoneRegistry = options.locationZoneRegistry || new LocationZoneRegistryV11')));
check('pipeline resolves zones after scene environment mapping', () => assert(pipelineSource.includes('this.locationZoneRegistry.ensureProductionZones(production, locationBindings, latestSceneEnvironmentMappings, scenes)')));
check('pipeline can use 11.9.1 bindings directly', () => assert(pipelineSource.includes('reusableLocationPlan?.locations?.map')));
check('dashboard renders Location Zones 11.9.2', () => assert(dashboardSource.includes('LOCATION ZONES V11.9.2')));
check('dashboard states locationId plus zoneId behavior', () => assert(dashboardSource.includes('stable locationId + zoneId')));
check('dashboard documents ambiguity fail-closed', () => assert(dashboardSource.includes('Multi-zone scenes remain ambiguous')));
check('zone registry is enabled by default', () => assert(envSource.includes('REUSABLE_LOCATION_ZONES_ENABLED=true')));
check('package exposes location zone test', () => assert.strictEqual(pkg.scripts['test:location-zones'], 'node ../bootstrap/verify-phase11-location-zones.js'));

async function runtimeChecks() {
  const zones = new Map();
  const usages = new Map();
  const fakeDb = {
    async getReusableLocationZoneByKey(locationId, zoneKey) {
      return zones.get(`${locationId}:${zoneKey}`) || null;
    },
    async saveReusableLocationZone(input) {
      const key = `${input.locationId}:${input.zoneKey}`;
      const existing = zones.get(key);
      const saved = existing ? {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        firstSeenAt: existing.firstSeenAt,
        firstSourceKind: existing.firstSourceKind,
        firstSourceSceneId: existing.firstSourceSceneId
      } : { ...input };
      zones.set(key, saved);
      return { ...saved };
    },
    async saveReusableLocationZoneUsage(input) {
      const key = `${input.productionId}:${input.sceneId}`;
      const saved = { id: usages.get(key)?.id || `usage_${usages.size + 1}`, ...input };
      usages.set(key, saved);
      return { ...saved };
    }
  };

  const bindingsA = [{ location, usage: { environmentId: 'env_house_a' } }];
  const mappingsA = [
    { id: 'map_a1', sceneId: 'scene_a1', environmentId: 'env_house_a', status: 'mapped', zone: 'living_room', confidence: 0.85, fingerprint: 'map-fp-a1' },
    { id: 'map_a2', sceneId: 'scene_a2', environmentId: 'env_house_a', status: 'mapped', zone: 'kitchen', confidence: 0.9, fingerprint: 'map-fp-a2' },
    { id: 'map_a3', sceneId: 'scene_a3', environmentId: 'env_house_a', status: 'mapped', zone: null, confidence: 0.7, fingerprint: 'map-fp-a3' },
    { id: 'map_a4', sceneId: 'scene_a4', environmentId: 'env_house_a', status: 'mapped', zone: 'kitchen', confidence: 0.7, fingerprint: 'map-fp-a4' },
    { id: 'map_a5', sceneId: 'scene_a5', environmentId: 'env_house_a', status: 'mapped', zone: null, confidence: 0.7, fingerprint: 'map-fp-a5' }
  ];
  const scenesA = [
    { id: 'scene_a1', scriptText: 'Tom relaxes quietly.' },
    { id: 'scene_a2', scriptText: 'Tom prepares dinner.' },
    { id: 'scene_a3', scriptText: 'Tom walks down the hallway.' },
    { id: 'scene_a4', scriptText: 'Tom leaves the kitchen and enters the living room.' },
    { id: 'scene_a5', scriptText: 'Tom looks at the clock.' }
  ];

  const service = new LocationZoneRegistryV11(fakeDb, { enabled: true });
  const first = await service.ensureProductionZones({ id: 'prod_a' }, bindingsA, mappingsA, scenesA);
  check('first video resolves three unambiguous zones', () => assert.strictEqual(first.summary.resolvedCount, 3));
  check('first video creates three canonical zone identities', () => assert.strictEqual(first.summary.createdCount, 3));
  check('first video records one ambiguous transition scene', () => assert.strictEqual(first.summary.ambiguousCount, 1));
  check('first video leaves no-evidence scene unresolved', () => assert.strictEqual(first.summary.unresolvedCount, 1));
  check('library contains living room, kitchen, and hallway', () => assert.deepStrictEqual([...zones.values()].map(zone => zone.zoneKey).sort(), ['hallway', 'kitchen', 'living_room']));
  check('ambiguous scene is not persisted as a zone usage', () => assert(!usages.has('prod_a:scene_a4')));
  check('no-evidence scene is not persisted as a zone usage', () => assert(!usages.has('prod_a:scene_a5')));
  check('scene usage carries locationId and zoneId', () => {
    const usage = usages.get('prod_a:scene_a1');
    assert.strictEqual(usage.locationId, location.id);
    assert(usage.zoneId);
  });

  const livingA = [...zones.values()].find(zone => zone.zoneKey === 'living_room');
  const bindingsB = [{ location, usage: { environmentId: 'env_house_b' } }];
  const second = await service.ensureProductionZones(
    { id: 'prod_b' },
    bindingsB,
    [{ id: 'map_b1', sceneId: 'scene_b1', environmentId: 'env_house_b', status: 'mapped', zone: 'sala de estar', confidence: 0.88, fingerprint: 'map-fp-b1' }],
    [{ id: 'scene_b1', scriptText: 'Night. Rain outside. Tom sits near the television.' }]
  );
  check('second video reuses living room instead of creating another room', () => assert.strictEqual(second.summary.reusedCount, 1));
  check('cross-video living room preserves same zoneId', () => assert.strictEqual(second.zones[0].zone.id, livingA.id));
  check('temporary night/rain wording does not change zone identity', () => assert.strictEqual(second.zones[0].zone.identityFingerprint, livingA.identityFingerprint));
  check('second video gets independent scene usage pointing at shared zone', () => assert.strictEqual(usages.get('prod_b:scene_b1').zoneId, livingA.id));

  const missingLocation = await service.ensureProductionZones(
    { id: 'prod_c' },
    [],
    [{ id: 'map_c1', sceneId: 'scene_c1', environmentId: 'env_missing', status: 'mapped', zone: 'bedroom', confidence: 0.8 }],
    [{ id: 'scene_c1', scriptText: 'Bedroom.' }]
  );
  check('missing reusable location binding is counted truthfully', () => assert.strictEqual(missingLocation.summary.missingLocationCount, 1));
  check('missing location never fabricates a zone', () => assert.strictEqual(missingLocation.zones[0].zone, null));

  const disabled = await new LocationZoneRegistryV11(fakeDb, { enabled: false }).ensureProductionZones(
    { id: 'prod_disabled' }, bindingsA, mappingsA, scenesA
  );
  check('disabled registry performs no zone work', () => assert.strictEqual(disabled.zones.length, 0));
  check('disabled registry reports inactive state', () => assert.strictEqual(disabled.active, false));
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.9.2 Reusable Location Zones OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
