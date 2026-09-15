'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'canonical-location-assets-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.9.3 runtime is not materialized: utils/canonical-location-assets-v11.js');

const {
  CANONICAL_LOCATION_ASSETS_VERSION,
  CanonicalLocationAssetRegistryV11,
  assetKey,
  latestByKeyframe,
  selectZoneCandidate,
  locationBindingMap,
  uniqueZoneBindings,
  candidateRank,
  fileSha256,
  safeSegment
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('version is 11.9.3', () => assert.strictEqual(CANONICAL_LOCATION_ASSETS_VERSION, '11.9.3'));
check('asset key is deterministic', () => assert.strictEqual(assetKey({ locationId: 'loc-1', zoneId: 'zone-1', role: 'zone_reference' }), 'loc-1::zone-1::zone_reference'));
check('location asset key has explicit location scope token', () => assert.strictEqual(assetKey({ locationId: 'loc-1', role: 'location_master' }), 'loc-1::location::location_master'));
check('safe segment strips unsafe path characters', () => assert.strictEqual(safeSegment('../Miller House'), '.._miller_house'));
check('start keyframe outranks middle', () => assert(candidateRank({ shotIndex: 0, keyframeRole: 'start' }) < candidateRank({ shotIndex: 0, keyframeRole: 'middle' })));
check('earlier shot outranks later shot', () => assert(candidateRank({ shotIndex: 0, keyframeRole: 'end' }) < candidateRank({ shotIndex: 1, keyframeRole: 'start' })));
check('latest continuity prefers greater attempt', () => {
  const latest = latestByKeyframe([
    { id: 'old', keyframeId: 'kf1', attempt: 0, status: 'repair_needed', createdAt: '2026-01-01' },
    { id: 'new', keyframeId: 'kf1', attempt: 1, status: 'accepted', createdAt: '2026-01-01' }
  ]);
  assert.strictEqual(latest.get('kf1').id, 'new');
});
check('latest semantic decision breaks same-attempt ties by createdAt', () => {
  const latest = latestByKeyframe([
    { id: 'old', keyframeId: 'kf1', attempt: 0, createdAt: '2026-01-01' },
    { id: 'new', keyframeId: 'kf1', attempt: 0, createdAt: '2026-01-02' }
  ]);
  assert.strictEqual(latest.get('kf1').id, 'new');
});

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns reusable_location_assets', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS reusable_location_assets')));
check('asset_key is globally unique', () => assert(dbSource.includes('asset_key TEXT NOT NULL UNIQUE')));
check('asset references parent reusable location', () => assert(dbSource.includes('FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE')));
check('zone asset references reusable location zone', () => assert(dbSource.includes('FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE CASCADE')));
check('database persists canonical location asset', () => assert(dbSource.includes('async saveReusableLocationAsset(input = {})')));
check('database retrieves asset by stable key', () => assert(dbSource.includes('async getReusableLocationAssetByKey(assetKey)')));
check('database lists assets by location/zone', () => assert(dbSource.includes('async listReusableLocationAssets(locationId, zoneId = null)')));
check('production bundle lists referenced canonical assets', () => assert(dbSource.includes('async listProductionReusableLocationAssets(productionId)')));
check('production bundle exposes reusableLocationAssets', () => assert(dbSource.includes('const reusableLocationAssets = await this.listProductionReusableLocationAssets(productionId);') && dbSource.includes('reusableLocationAssets,')));
check('pipeline imports canonical asset registry', () => assert(pipelineSource.includes("const { CanonicalLocationAssetRegistryV11 } = require('./canonical-location-assets-v11');")));
check('pipeline constructs canonical asset registry', () => assert(pipelineSource.includes('this.canonicalLocationAssets = options.canonicalLocationAssets || new CanonicalLocationAssetRegistryV11')));
check('pipeline promotes assets only after scene blockers pass', () => assert(pipelineSource.indexOf('const blockers = await this.findBlockers(scenes);') < pipelineSource.indexOf('this.canonicalLocationAssets.ensureProductionAssets(bundle')));
check('pipeline reloads bundle after canonical asset promotion', () => assert(pipelineSource.includes('bundle = await this.db.getProductionBundle(production.id) || bundle;')));
check('dashboard renders Phase 11.9.3 panel', () => assert(dashboardSource.includes('CANONICAL LOCATION ASSETS V11.9.3')));
check('dashboard explains continuity evidence', () => assert(dashboardSource.includes('accepted Environment Continuity')));
check('dashboard explains semantic fail-closed behavior', () => assert(dashboardSource.includes('semantic verification remains fail-closed')));
check('canonical assets enabled by default', () => assert(envSource.includes('CANONICAL_LOCATION_ASSETS_ENABLED=true')));
check('continuity required by default', () => assert(envSource.includes('CANONICAL_LOCATION_ASSET_REQUIRE_CONTINUITY=true')));
check('semantic requirement has explicit override', () => assert(envSource.includes('CANONICAL_LOCATION_ASSET_REQUIRE_SEMANTIC=false')));
check('package exposes canonical asset test', () => assert.strictEqual(pkg.scripts['test:canonical-location-assets'], 'node ../bootstrap/verify-phase11-canonical-location-assets.js'));
check('runtime propagates global semantic strict mode', () => assert(fs.readFileSync(runtimePath, 'utf8').includes('canonicalSemantic || globalSemantic')));
check('runtime blocks generic local fallback promotion', () => assert(fs.readFileSync(runtimePath, 'utf8').includes("reason: 'generic_local_fallback'")));
check('runtime stores library-owned location master role', () => assert(fs.readFileSync(runtimePath, 'utf8').includes("assetRole: 'location_master'")));
check('runtime stores verified keyframe zone reference role', () => assert(fs.readFileSync(runtimePath, 'utf8').includes("assetRole: 'zone_reference'")));
check('runtime stores source provenance', () => assert(fs.readFileSync(runtimePath, 'utf8').includes("sourceKind: 'verified-keyframe-promotion'")));
check('runtime stores continuity evidence identifiers', () => assert(fs.readFileSync(runtimePath, 'utf8').includes('continuityCheckId: selected.continuity?.id || null')));
check('runtime stores semantic evidence identifiers', () => assert(fs.readFileSync(runtimePath, 'utf8').includes('semanticCheckId: selected.semantic?.id || null')));

async function runtimeChecks() {
  const tempRoot = path.join(upstream, 'data', `test-canonical-location-assets-${process.pid}-${Date.now()}`);
  await fsp.mkdir(tempRoot, { recursive: true });
  const masterPath = path.join(tempRoot, 'source-master.png');
  const startPath = path.join(tempRoot, 'scene-start.png');
  const middlePath = path.join(tempRoot, 'scene-middle.png');
  const fallbackPath = path.join(tempRoot, 'visual_local_fallback.png');
  await fsp.writeFile(masterPath, Buffer.from('canonical-master-image-bytes'));
  await fsp.writeFile(startPath, Buffer.from('verified-living-room-start'));
  await fsp.writeFile(middlePath, Buffer.from('verified-living-room-middle'));
  await fsp.writeFile(fallbackPath, Buffer.from('generic-local-fallback'));

  const location = {
    id: 'location_miller_house', namespace: 'series-alpha', locationKey: 'miller_house', displayName: 'Miller House',
    identityFingerprint: 'location-fingerprint', canonicalMasterFramePath: masterPath, canonicalEnvironmentId: 'env_house_a',
    createdFromProductionId: 'prod_origin'
  };
  const livingZoneA = {
    id: 'zone_living_room', locationId: location.id, zoneKey: 'living_room', displayName: 'Living Room', identityFingerprint: 'zone-living-fp',
    usage: { productionId: 'prod_a', sceneId: 'scene_a1', environmentId: 'env_house_a' }
  };
  const livingZoneSecondScene = {
    ...livingZoneA,
    usage: { productionId: 'prod_a', sceneId: 'scene_a2', environmentId: 'env_house_a' }
  };
  const kitchenZone = {
    id: 'zone_kitchen', locationId: location.id, zoneKey: 'kitchen', displayName: 'Kitchen', identityFingerprint: 'zone-kitchen-fp',
    usage: { productionId: 'prod_a', sceneId: 'scene_kitchen', environmentId: 'env_house_a' }
  };

  const baseBundle = {
    id: 'prod_a',
    reusableLocations: [location],
    reusableLocationZones: [livingZoneA, livingZoneSecondScene, kitchenZone],
    keyframes: [
      { id: 'kf_middle', sceneId: 'scene_a1', shotIndex: 0, keyframeIndex: 1, keyframeRole: 'middle', status: 'ready', assetPath: middlePath, provider: 'image-provider', model: 'model-a' },
      { id: 'kf_start', sceneId: 'scene_a1', shotIndex: 0, keyframeIndex: 0, keyframeRole: 'start', status: 'ready', assetPath: startPath, provider: 'image-provider', model: 'model-a' },
      { id: 'kf_scene2', sceneId: 'scene_a2', shotIndex: 0, keyframeIndex: 0, keyframeRole: 'start', status: 'ready', assetPath: middlePath, provider: 'image-provider', model: 'model-a' },
      { id: 'kf_kitchen_local', sceneId: 'scene_kitchen', shotIndex: 0, keyframeIndex: 0, keyframeRole: 'start', status: 'ready', assetPath: fallbackPath, provider: 'local-renderer', model: null }
    ],
    environmentContinuityChecks: [
      { id: 'ec_start', keyframeId: 'kf_start', attempt: 0, status: 'accepted', score: 0.88, createdAt: '2026-01-01' },
      { id: 'ec_middle', keyframeId: 'kf_middle', attempt: 0, status: 'accepted', score: 0.90, createdAt: '2026-01-01' },
      { id: 'ec_scene2', keyframeId: 'kf_scene2', attempt: 0, status: 'accepted', score: 0.86, createdAt: '2026-01-01' },
      { id: 'ec_kitchen', keyframeId: 'kf_kitchen_local', attempt: 0, status: 'accepted', score: 0.92, createdAt: '2026-01-01' }
    ],
    semanticPropChecks: []
  };

  check('location binding map indexes stable location id', () => assert.strictEqual(locationBindingMap(baseBundle).get(location.id).locationKey, 'miller_house'));
  check('zone binding extraction preserves multiple scenes for one zone', () => assert.strictEqual(uniqueZoneBindings(baseBundle).filter(zone => zone.id === livingZoneA.id).length, 2));
  check('candidate selector prefers first-shot start', () => assert.strictEqual(selectZoneCandidate(livingZoneA, baseBundle, { requireContinuity: true, requireSemantic: false }).keyframe.id, 'kf_start'));
  check('candidate selector rejects missing continuity when required', () => assert.strictEqual(selectZoneCandidate(livingZoneA, { ...baseBundle, environmentContinuityChecks: [] }, { requireContinuity: true }).keyframe, null));
  check('candidate selector accepts without continuity only when explicitly disabled', () => assert.strictEqual(selectZoneCandidate(livingZoneA, { ...baseBundle, environmentContinuityChecks: [] }, { requireContinuity: false }).keyframe.id, 'kf_start'));
  check('candidate selector rejects explicit semantic rejection', () => assert.strictEqual(selectZoneCandidate(livingZoneA, { ...baseBundle, semanticPropChecks: [{ id: 'sem_bad', keyframeId: 'kf_start', status: 'rejected' }, { id: 'sem_bad2', keyframeId: 'kf_middle', status: 'rejected' }] }, { requireContinuity: true, requireSemantic: false }).keyframe, null));
  check('candidate selector requires semantic truth in strict mode', () => assert.strictEqual(selectZoneCandidate(livingZoneA, baseBundle, { requireContinuity: true, requireSemantic: true }).keyframe, null));
  check('generic local renderer never becomes zone canonical', () => assert.strictEqual(selectZoneCandidate(kitchenZone, baseBundle, { requireContinuity: true, requireSemantic: false }).keyframe, null));

  const assets = new Map();
  const fakeDb = {
    async getReusableLocationAssetByKey(key) { return assets.get(key) || null; },
    async saveReusableLocationAsset(input) {
      const existing = assets.get(input.assetKey);
      const saved = { id: existing?.id || `asset_${assets.size + 1}`, createdAt: existing?.createdAt || new Date().toISOString(), ...input };
      assets.set(input.assetKey, saved);
      return { ...saved };
    },
    async getReusableLocation(id) { return id === location.id ? location : null; }
  };

  const service = new CanonicalLocationAssetRegistryV11(fakeDb, { dataRoot: tempRoot, enabled: true, requireContinuity: true, requireSemantic: false });
  const first = await service.ensureProductionAssets(baseBundle);
  const locationAsset = [...assets.values()].find(asset => asset.scope === 'location');
  const zoneAsset = [...assets.values()].find(asset => asset.scope === 'zone');
  const locationBytes = await fsp.readFile(locationAsset.assetPath, 'utf8');
  const locationActualSha = await fileSha256(locationAsset.assetPath);
  const zoneActualSha = await fileSha256(zoneAsset.assetPath);
  check('first run registers one library-owned location master', () => assert.strictEqual(first.summary.locationMasters, 1));
  check('first run promotes living room zone', () => assert.strictEqual(first.summary.zoneReady, 1));
  check('duplicate living-room scene does not count as a second canonical zone', () => assert.strictEqual(first.zones.filter(item => item.zone?.id === livingZoneA.id).length, 1));
  check('generic local kitchen remains unanchored', () => assert.strictEqual(first.summary.zoneUnanchored, 1));
  check('location master is canonical', () => assert.strictEqual(locationAsset.canonical, true));
  check('location master owns location_master role', () => assert.strictEqual(locationAsset.assetRole, 'location_master'));
  check('location master path is inside persistent library', () => assert(locationAsset.assetPath.includes(path.join('location-library', 'series-alpha', 'location_miller_house'))));
  check('location master bytes are copied', () => assert.strictEqual(locationBytes, 'canonical-master-image-bytes'));
  check('location master sha matches real bytes', () => assert.strictEqual(locationAsset.assetSha256, locationActualSha));
  check('zone asset is canonical', () => assert.strictEqual(zoneAsset.canonical, true));
  check('zone asset owns zone_reference role', () => assert.strictEqual(zoneAsset.assetRole, 'zone_reference'));
  check('zone asset path is nested under zone key', () => assert(zoneAsset.assetPath.includes(path.join('zones', 'living_room', 'zone_reference.png'))));
  check('zone asset promotes start keyframe', () => assert.strictEqual(zoneAsset.sourceKeyframeId, 'kf_start'));
  check('zone asset persists continuity check id', () => assert.strictEqual(zoneAsset.continuityCheckId, 'ec_start'));
  check('zone asset persists continuity score', () => assert.strictEqual(zoneAsset.continuityScore, 0.88));
  check('zone asset source production is recorded', () => assert.strictEqual(zoneAsset.sourceProductionId, 'prod_a'));
  check('zone asset source scene is recorded', () => assert.strictEqual(zoneAsset.sourceSceneId, 'scene_a1'));
  check('zone asset sha is real', () => assert.strictEqual(zoneAsset.assetSha256, zoneActualSha));

  const secondBundle = {
    ...baseBundle,
    id: 'prod_b',
    reusableLocationZones: [{ ...livingZoneA, usage: { productionId: 'prod_b', sceneId: 'scene_b1', environmentId: 'env_house_b' } }],
    keyframes: [{ id: 'kf_b1', sceneId: 'scene_b1', shotIndex: 0, keyframeIndex: 0, keyframeRole: 'start', status: 'ready', assetPath: middlePath, provider: 'image-provider' }],
    environmentContinuityChecks: [{ id: 'ec_b1', keyframeId: 'kf_b1', attempt: 0, status: 'accepted', score: 0.95, createdAt: '2026-01-02' }]
  };
  const second = await service.ensureProductionAssets(secondBundle);
  check('later video reuses existing living-room canonical asset', () => assert.strictEqual(second.summary.zoneReused, 1));
  check('later video does not create duplicate asset records', () => assert.strictEqual([...assets.values()].filter(asset => asset.scope === 'zone').length, 1));
  check('later video cannot overwrite original canonical source merely by reuse', () => assert.strictEqual([...assets.values()].find(asset => asset.scope === 'zone').sourceKeyframeId, 'kf_start'));

  const strictAssets = new Map();
  const strictDb = {
    async getReusableLocationAssetByKey(key) { return strictAssets.get(key) || null; },
    async saveReusableLocationAsset(input) { const saved = { id: `strict_${strictAssets.size + 1}`, ...input }; strictAssets.set(input.assetKey, saved); return saved; },
    async getReusableLocation(id) { return id === location.id ? location : null; }
  };
  const strictService = new CanonicalLocationAssetRegistryV11(strictDb, { dataRoot: path.join(tempRoot, 'strict'), enabled: true, requireContinuity: true, requireSemantic: true });
  const strictBlocked = await strictService.ensureProductionAssets({ ...baseBundle, reusableLocationZones: [livingZoneA] });
  check('semantic strict mode blocks zone asset without vision truth', () => assert.strictEqual(strictBlocked.summary.zoneReady, 0));
  const semVerifiedBundle = {
    ...baseBundle,
    reusableLocationZones: [livingZoneA],
    semanticPropChecks: [{ id: 'sem_ok', keyframeId: 'kf_start', status: 'verified', semanticPropPresenceVerified: true, confidence: 0.91, createdAt: '2026-01-01' }]
  };
  const strictReady = await strictService.ensureProductionAssets(semVerifiedBundle);
  const strictZone = [...strictAssets.values()].find(asset => asset.scope === 'zone');
  check('semantic strict mode promotes verified zone', () => assert.strictEqual(strictReady.summary.zoneReady, 1));
  check('verified semantic truth is persisted', () => assert.strictEqual(strictZone.semanticVerified, true));
  check('semantic evidence id is persisted', () => assert.strictEqual(strictZone.semanticCheckId, 'sem_ok'));

  const missingParent = await service.ensureProductionAssets({ ...baseBundle, id: 'prod_missing', reusableLocations: [], reusableLocationZones: [{ ...livingZoneA, locationId: 'missing_location' }] });
  check('missing parent location stays unanchored', () => assert.strictEqual(missingParent.summary.zoneUnanchored, 1));

  const disabled = await new CanonicalLocationAssetRegistryV11(fakeDb, { dataRoot: tempRoot, enabled: false }).ensureProductionAssets(baseBundle);
  check('disabled registry performs no work', () => assert.strictEqual(disabled.active, false));
  check('disabled registry returns empty assets', () => assert.strictEqual(disabled.assets.length, 0));

  await fsp.rm(tempRoot, { recursive: true, force: true });
}

(async () => {
  await runtimeChecks();
  for (const item of checks) await item.fn();
  console.log(`Phase 11.9.3 Canonical Location Assets OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
