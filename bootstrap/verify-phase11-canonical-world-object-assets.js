'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'canonical-world-object-assets-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.10.3 runtime is not materialized');
const {
  CANONICAL_WORLD_OBJECT_ASSETS_VERSION,
  CanonicalWorldObjectAssetRegistryV11,
  providerIsCanonical,
  assetMetadata,
  declarationFromRaw,
  collectAssetDeclarations,
  bindingForDeclaration,
  assetKey,
  fileSha256
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.10.3', () => assert.strictEqual(CANONICAL_WORLD_OBJECT_ASSETS_VERSION, '11.10.3'));
check('provider-backed reference is accepted', () => assert.strictEqual(providerIsCanonical('openai-image', '/tmp/object.png'), true));
check('local renderer is rejected', () => assert.strictEqual(providerIsCanonical('local-renderer', '/tmp/object.png'), false));
check('missing provider is rejected', () => assert.strictEqual(providerIsCanonical('', '/tmp/object.png'), false));
check('visual_local filename is rejected even with provider', () => assert.strictEqual(providerIsCanonical('provider-x', '/tmp/visual_local_object.png'), false));
check('nested canonical asset metadata is extracted', () => assert.strictEqual(assetMetadata({ canonicalAsset: { path: '/tmp/a.png', provider: 'provider-x' } }).provider, 'provider-x'));
check('flat canonical asset metadata is extracted', () => assert.strictEqual(assetMetadata({ canonicalAssetPath: '/tmp/a.png', canonicalAssetProvider: 'provider-y' }).provider, 'provider-y'));
check('plain assetPath is not silently canonical', () => assert.strictEqual(assetMetadata({ assetPath: '/tmp/a.png', provider: 'provider-y' }), null));
check('declaration keeps explicit object key', () => assert.strictEqual(declarationFromRaw({ objectKey: 'family_car', name: 'Family Car', canonicalAssetPath: '/tmp/a.png', canonicalAssetProvider: 'provider-x' }).explicitObjectKey, 'family_car'));
check('asset key is deterministic', () => assert.strictEqual(assetKey('world_object_123'), assetKey('world_object_123')));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns object asset table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_world_object_assets'],
  ['asset key is unique', dbSource, 'asset_key TEXT NOT NULL UNIQUE'],
  ['one canonical role per object', dbSource, 'UNIQUE(object_id, asset_role)'],
  ['asset references persistent object', dbSource, 'FOREIGN KEY (object_id) REFERENCES persistent_world_objects(id) ON DELETE CASCADE'],
  ['database saves object asset', dbSource, 'async savePersistentWorldObjectAsset(input = {})'],
  ['database reads object asset by key', dbSource, 'async getPersistentWorldObjectAssetByKey(assetKey)'],
  ['database lists production object assets', dbSource, 'async listProductionPersistentWorldObjectAssets(productionId)'],
  ['bundle loads object assets', dbSource, 'const persistentWorldObjectAssets = await this.listProductionPersistentWorldObjectAssets(productionId);'],
  ['bundle exposes object assets', dbSource, 'persistentWorldObjectAssets,'],
  ['pipeline imports asset registry', pipelineSource, "CanonicalWorldObjectAssetRegistryV11 } = require('./canonical-world-object-assets-v11')"],
  ['pipeline constructs asset registry', pipelineSource, 'this.canonicalWorldObjectAssets = options.canonicalWorldObjectAssets || new CanonicalWorldObjectAssetRegistryV11'],
  ['pipeline ensures object assets', pipelineSource, 'this.canonicalWorldObjectAssets.ensureProductionAssets(production, environmentBible, canonicalObjectLocks, persistentWorldObjectPlan)'],
  ['dashboard exposes canonical object assets', dashboardSource, 'CANONICAL OBJECT ASSETS V11.10.3'],
  ['dashboard documents provider-backed rule', dashboardSource, 'Only explicitly canonical, provider-backed references are promoted'],
  ['env enables canonical object assets', envSource, 'CANONICAL_WORLD_OBJECT_ASSETS_ENABLED=true'],
  ['env requires provider provenance', envSource, 'CANONICAL_WORLD_OBJECT_ASSET_REQUIRE_PROVIDER=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes canonical object asset verifier', () => assert.strictEqual(pkg.scripts['test:canonical-world-object-assets'], 'node ../bootstrap/verify-phase11-canonical-world-object-assets.js'));
check('canonical assets run after persistent object registry', () => assert(pipelineSource.indexOf('let persistentWorldObjectPlan = null;') < pipelineSource.indexOf('let canonicalWorldObjectAssetPlan = null;')));
check('canonical assets run before temporary state', () => assert(pipelineSource.indexOf('let canonicalWorldObjectAssetPlan = null;') < pipelineSource.indexOf('let temporaryLocationStatePlan = null;')));

async function runtimeChecks() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase-11103-'));
  const dataRoot = path.join(tmp, 'data');
  const sourceA = path.join(tmp, 'car-a.png');
  const sourceB = path.join(tmp, 'car-b.png');
  const localFile = path.join(tmp, 'object_local_tv.png');
  const noProviderFile = path.join(tmp, 'compass.png');
  const unsupported = path.join(tmp, 'artifact.gif');
  await fsp.writeFile(sourceA, Buffer.from('canonical-car-origin'));
  await fsp.writeFile(sourceB, Buffer.from('later-car-image-must-not-overwrite'));
  await fsp.writeFile(localFile, Buffer.from('local-fallback'));
  await fsp.writeFile(noProviderFile, Buffer.from('missing-provider'));
  await fsp.writeFile(unsupported, Buffer.from('gif-like-bytes'));

  const assets = new Map();
  const db = {
    async getPersistentWorldObjectAssetByKey(key) { return assets.get(key) ? { ...assets.get(key) } : null; },
    async savePersistentWorldObjectAsset(input) {
      const existing = assets.get(input.assetKey);
      if (existing) return { ...existing };
      const row = { id: `asset_${assets.size + 1}`, createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z', ...input };
      assets.set(input.assetKey, row);
      return { ...row };
    }
  };

  const car = { id: 'obj_car', namespace: 'series', objectKey: 'miller_family_car', displayName: 'Miller Family Car', objectType: 'vehicle', identityFingerprint: 'fp_car', createdFromProductionId: 'video_a' };
  const planA = { active: true, objects: [{ object: car, usage: { environmentId: 'env_a', sourceRef: 'car_decl' }, matchMode: 'identity_fingerprint_exact_register' }] };
  const bibleA = { environments: [{ environmentId: 'env_a', persistentObjects: [{ id: 'car_decl', objectKey: 'miller_family_car', name: 'Miller Family Car', type: 'vehicle', canonicalAsset: { path: sourceA, provider: 'provider-x', model: 'image-v1' } }] }] };
  const registry = new CanonicalWorldObjectAssetRegistryV11(db, { enabled: true, requireProvider: true, dataRoot });
  const resultA = await registry.ensureProductionAssets({ id: 'video_a' }, bibleA, [], planA);
  check('A promotes one canonical object asset', () => assert.strictEqual(resultA.summary.ready, 1));
  check('A canonical asset is not reuse', () => assert.strictEqual(resultA.summary.reused, 0));
  const assetA = resultA.assets[0];
  check('A stores provider provenance', () => assert.strictEqual(assetA.provider, 'provider-x'));
  check('A stores model provenance', () => assert.strictEqual(assetA.model, 'image-v1'));
  check('A stores origin production', () => assert.strictEqual(assetA.sourceProductionId, 'video_a'));
  check('A canonical file exists', () => assert(fs.existsSync(assetA.assetPath)));
  const shaA = await fileSha256(sourceA);
  check('A canonical hash matches source bytes', () => assert.strictEqual(assetA.assetSha256, shaA));

  const planB = { active: true, objects: [{ object: car, usage: { environmentId: 'env_b', sourceRef: 'car_decl_b' }, matchMode: 'object_alias_exact' }] };
  const bibleB = { environments: [{ environmentId: 'env_b', persistentObjects: [{ id: 'car_decl_b', objectKey: 'miller_family_car', name: 'Family Car', type: 'vehicle', canonicalAsset: { path: sourceB, provider: 'provider-y', model: 'image-v2' } }] }] };
  const resultB = await registry.ensureProductionAssets({ id: 'video_b' }, bibleB, [], planB);
  check('B reuses existing canonical object asset', () => assert.strictEqual(resultB.summary.reused, 1));
  check('B keeps origin hash immutable', () => assert.strictEqual(resultB.assets[0].assetSha256, shaA));
  check('B keeps origin provider immutable', () => assert.strictEqual(resultB.assets[0].provider, 'provider-x'));
  check('B keeps origin production immutable', () => assert.strictEqual(resultB.assets[0].sourceProductionId, 'video_a'));

  const tv = { id: 'obj_tv', namespace: 'series', objectKey: 'family_tv', displayName: 'Family TV', objectType: 'television', identityFingerprint: 'fp_tv', createdFromProductionId: 'video_local' };
  const localResult = await registry.ensureProductionAssets({ id: 'video_local' }, { environments: [{ environmentId: 'env_l', persistentObjects: [{ objectKey: 'family_tv', name: 'Family TV', type: 'television', canonicalAssetPath: localFile, canonicalAssetProvider: 'local-renderer' }] }] }, [], { active: true, objects: [{ object: tv, usage: { environmentId: 'env_l' } }] });
  check('local renderer asset is rejected', () => assert.strictEqual(localResult.summary.rejected, 1));
  check('local renderer creates no asset row', () => assert.strictEqual(assets.size, 1));

  const compass = { id: 'obj_compass', namespace: 'series', objectKey: 'ancient_compass', displayName: 'Ancient Compass', objectType: 'artifact', identityFingerprint: 'fp_compass', createdFromProductionId: 'video_compass' };
  const missingProvider = await registry.ensureProductionAssets({ id: 'video_compass' }, { environments: [{ environmentId: 'env_c', persistentObjects: [{ objectKey: 'ancient_compass', name: 'Ancient Compass', type: 'artifact', canonicalAssetPath: noProviderFile }] }] }, [], { active: true, objects: [{ object: compass, usage: { environmentId: 'env_c' } }] });
  check('missing provider is rejected', () => assert.strictEqual(missingProvider.summary.rejected, 1));

  const artifact = { id: 'obj_artifact', namespace: 'series', objectKey: 'artifact_x', displayName: 'Artifact X', objectType: 'artifact', identityFingerprint: 'fp_artifact', createdFromProductionId: 'video_art' };
  const unsupportedResult = await registry.ensureProductionAssets({ id: 'video_art' }, { environments: [{ environmentId: 'env_art', persistentObjects: [{ objectKey: 'artifact_x', name: 'Artifact X', canonicalAssetPath: unsupported, canonicalAssetProvider: 'provider-x' }] }] }, [], { active: true, objects: [{ object: artifact, usage: { environmentId: 'env_art' } }] });
  check('unsupported image extension is rejected', () => assert.strictEqual(unsupportedResult.summary.rejected, 1));

  const sofa1 = { id: 'obj_sofa_1', namespace: 'series', objectKey: 'sofa_1', displayName: 'Blue Sofa', objectType: 'furniture', identityFingerprint: 'fp_sofa_1' };
  const sofa2 = { id: 'obj_sofa_2', namespace: 'series', objectKey: 'sofa_2', displayName: 'Blue Sofa', objectType: 'furniture', identityFingerprint: 'fp_sofa_2' };
  const ambiguousDeclaration = { name: 'Blue Sofa', type: 'furniture', canonicalAssetPath: sourceA, canonicalAssetProvider: 'provider-x' };
  const ambiguousPlan = { active: true, objects: [{ object: sofa1, usage: { environmentId: 'env_sofa' } }, { object: sofa2, usage: { environmentId: 'env_sofa' } }] };
  const ambiguousResult = await registry.ensureProductionAssets({ id: 'video_sofa' }, { environments: [{ environmentId: 'env_sofa', persistentObjects: [ambiguousDeclaration] }] }, [], ambiguousPlan);
  check('ambiguous object binding fails closed', () => assert.strictEqual(ambiguousResult.summary.ambiguous, 1));
  check('ambiguous object binding creates no extra asset', () => assert.strictEqual(assets.size, 1));

  const declarations = collectAssetDeclarations({ environments: [{ environmentId: 'env_x', persistentObjects: [{ name: 'No visual reference' }] }] }, []);
  check('object without canonical visual declaration is ignored', () => assert.strictEqual(declarations.length, 0));
  const keyedBinding = bindingForDeclaration({ explicitObjectKey: 'miller_family_car' }, planA.objects);
  check('explicit object key binds deterministically', () => assert.strictEqual(keyedBinding.binding.object.id, car.id));

  const disabled = await new CanonicalWorldObjectAssetRegistryV11(db, { enabled: false, dataRoot }).ensureProductionAssets({ id: 'video_disabled' }, bibleA, [], planA);
  check('disabled asset registry is inactive', () => assert.strictEqual(disabled.active, false));
  check('disabled asset registry creates nothing', () => assert.strictEqual(disabled.assets.length, 0));

  await fsp.rm(tmp, { recursive: true, force: true });
}

runtimeChecks().then(() => console.log(`Phase 11.10.3 Canonical World Object Assets OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
