'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'canonical-character-assets-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.3 runtime is not materialized');
const {
  CANONICAL_CHARACTER_ASSETS_VERSION,
  CanonicalCharacterAssetRegistryV11,
  providerIsCanonical,
  assetMetadata,
  declarationFromRaw,
  collectAssetDeclarations,
  characterBindings,
  bindingForDeclaration,
  assetKey,
  fileSha256
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.11.3', () => assert.strictEqual(CANONICAL_CHARACTER_ASSETS_VERSION, '11.11.3'));
check('provider-backed reference accepted', () => assert.strictEqual(providerIsCanonical('openai-image', '/tmp/character.png'), true));
check('local renderer rejected', () => assert.strictEqual(providerIsCanonical('local-renderer', '/tmp/character.png'), false));
check('missing provider rejected', () => assert.strictEqual(providerIsCanonical('', '/tmp/character.png'), false));
check('character_local filename rejected', () => assert.strictEqual(providerIsCanonical('provider-x', '/tmp/character_local_luna.png'), false));
check('nested canonical character asset extracted', () => assert.strictEqual(assetMetadata({ canonicalCharacterAsset: { path: '/tmp/a.png', provider: 'provider-x' } }).provider, 'provider-x'));
check('nested canonical asset extracted', () => assert.strictEqual(assetMetadata({ canonicalAsset: { path: '/tmp/a.png', provider: 'provider-y' } }).provider, 'provider-y'));
check('flat canonical character asset extracted', () => assert.strictEqual(assetMetadata({ canonicalCharacterAssetPath: '/tmp/a.png', canonicalCharacterAssetProvider: 'provider-z' }).provider, 'provider-z'));
check('plain assetPath not silently canonical', () => assert.strictEqual(assetMetadata({ assetPath: '/tmp/a.png', provider: 'provider-y' }), null));
check('declaration keeps character key', () => assert.strictEqual(declarationFromRaw({ characterKey: 'luna_main', name: 'Luna', canonicalCharacterAssetPath: '/tmp/a.png', canonicalCharacterAssetProvider: 'provider-x' }).explicitCharacterKey, 'luna_main'));
check('declaration keeps source character id', () => assert.strictEqual(declarationFromRaw({ id: 'char_luna', name: 'Luna', canonicalAssetPath: '/tmp/a.png', canonicalAssetProvider: 'provider-x' }).sourceCharacterId, 'char_luna'));
check('asset key deterministic', () => assert.strictEqual(assetKey('persistent_character_123'), assetKey('persistent_character_123')));
check('asset key role is character reference', () => assert(assetKey('persistent_character_123').endsWith('character_reference')));
check('non cartoon bible ignored', () => assert.strictEqual(collectAssetDeclarations({ mode: 'documentary', characters: [{ name: 'Luna', canonicalAssetPath: '/tmp/a.png', canonicalAssetProvider: 'provider-x' }] }).length, 0));
check('character without canonical asset ignored', () => assert.strictEqual(collectAssetDeclarations({ mode: 'kids_cartoon_2d', characters: [{ name: 'Luna' }] }).length, 0));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns character asset table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_character_assets'],
  ['asset key unique', dbSource, 'asset_key TEXT NOT NULL UNIQUE'],
  ['one canonical role per character', dbSource, 'UNIQUE(character_id, asset_role)'],
  ['asset references persistent character', dbSource, 'FOREIGN KEY (character_id) REFERENCES persistent_characters(id) ON DELETE CASCADE'],
  ['database saves character asset', dbSource, 'async savePersistentCharacterAsset(input = {})'],
  ['database reads character asset by key', dbSource, 'async getPersistentCharacterAssetByKey(assetKey)'],
  ['database reads character asset by character', dbSource, 'async getPersistentCharacterAssetByCharacter(characterId'],
  ['database lists production character assets', dbSource, 'async listProductionPersistentCharacterAssets(productionId)'],
  ['bundle loads character assets', dbSource, 'const persistentCharacterAssets = await this.listProductionPersistentCharacterAssets(productionId);'],
  ['bundle exposes character assets', dbSource, 'persistentCharacterAssets,'],
  ['pipeline imports asset registry', pipelineSource, "CanonicalCharacterAssetRegistryV11 } = require('./canonical-character-assets-v11')"],
  ['pipeline constructs asset registry', pipelineSource, 'this.canonicalCharacterAssets = options.canonicalCharacterAssets || new CanonicalCharacterAssetRegistryV11'],
  ['pipeline ensures character assets', pipelineSource, 'this.canonicalCharacterAssets.ensureProductionAssets(production, cartoonBible, persistentCharacterPlan)'],
  ['dashboard exposes canonical character assets', dashboardSource, 'CANONICAL CHARACTER ASSETS V11.11.3'],
  ['dashboard documents provider-backed rule', dashboardSource, 'Only explicit provider-backed canonical references are promoted'],
  ['env enables canonical character assets', envSource, 'CANONICAL_CHARACTER_ASSETS_ENABLED=true'],
  ['env requires provider provenance', envSource, 'CANONICAL_CHARACTER_ASSET_REQUIRE_PROVIDER=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes character asset verifier', () => assert.strictEqual(pkg.scripts['test:canonical-character-assets'], 'node ../bootstrap/verify-phase11-canonical-character-assets.js'));
check('character assets after persistent character plan', () => assert(pipelineSource.indexOf('let persistentCharacterPlan = null;') < pipelineSource.indexOf('let canonicalCharacterAssetPlan = null;')));
check('character assets before visual planning', () => assert(pipelineSource.indexOf('let canonicalCharacterAssetPlan = null;') < pipelineSource.indexOf('if (!scenes.length || scriptChanged) {')));

async function runtimeChecks() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'phase-11113-'));
  const dataRoot = path.join(tmp, 'data');
  const sourceA = path.join(tmp, 'luna-a.png');
  const sourceB = path.join(tmp, 'luna-b.png');
  const localFile = path.join(tmp, 'character_local_pip.png');
  const noProviderFile = path.join(tmp, 'nova.png');
  const unsupported = path.join(tmp, 'robot.gif');
  await fsp.writeFile(sourceA, Buffer.from('canonical-luna-origin'));
  await fsp.writeFile(sourceB, Buffer.from('later-luna-image-must-not-overwrite'));
  await fsp.writeFile(localFile, Buffer.from('local-fallback'));
  await fsp.writeFile(noProviderFile, Buffer.from('missing-provider'));
  await fsp.writeFile(unsupported, Buffer.from('gif-like-bytes'));

  const assets = new Map();
  const db = {
    async getPersistentCharacterAssetByKey(key) { return assets.get(key) ? { ...assets.get(key) } : null; },
    async savePersistentCharacterAsset(input) {
      const existing = assets.get(input.assetKey);
      if (existing) return { ...existing };
      const row = { id: `character_asset_${assets.size + 1}`, createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z', ...input };
      assets.set(input.assetKey, row);
      return { ...row };
    }
  };

  const luna = { id: 'pc_luna', namespace: 'series', characterKey: 'luna_main', displayName: 'Luna', speciesType: 'bunny', identityFingerprint: 'fp_luna', createdFromProductionId: 'episode_a' };
  const planA = { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_a', sourceCharacterId: 'char_luna', sourceRef: 'char_luna' }, matchMode: 'identity_fingerprint_exact_register' }] };
  const bibleA = { id: 'bible_a', mode: 'kids_cartoon_2d', characters: [{ id: 'char_luna', characterKey: 'luna_main', name: 'Luna', speciesType: 'bunny', canonicalCharacterAsset: { path: sourceA, provider: 'provider-x', model: 'image-v1' } }] };
  const registry = new CanonicalCharacterAssetRegistryV11(db, { enabled: true, requireProvider: true, dataRoot });
  const resultA = await registry.ensureProductionAssets({ id: 'episode_a' }, bibleA, planA);
  check('A promotes one canonical character asset', () => assert.strictEqual(resultA.summary.ready, 1));
  check('A canonical asset not reuse', () => assert.strictEqual(resultA.summary.reused, 0));
  const assetA = resultA.assets[0];
  check('A stores provider provenance', () => assert.strictEqual(assetA.provider, 'provider-x'));
  check('A stores model provenance', () => assert.strictEqual(assetA.model, 'image-v1'));
  check('A stores origin production', () => assert.strictEqual(assetA.sourceProductionId, 'episode_a'));
  check('A stores bible provenance', () => assert.strictEqual(assetA.sourceBibleId, 'bible_a'));
  check('A stores source character provenance', () => assert.strictEqual(assetA.sourceCharacterId, 'char_luna'));
  check('A canonical file exists', () => assert(fs.existsSync(assetA.assetPath)));
  check('A canonical path is character library', () => assert(assetA.assetPath.includes(path.join('assets', 'character-library'))));
  const shaA = await fileSha256(sourceA);
  check('A canonical hash matches source bytes', () => assert.strictEqual(assetA.assetSha256, shaA));

  const planB = { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_b', sourceCharacterId: 'char_luna_b', sourceRef: 'char_luna_b' }, matchMode: 'character_alias_exact' }] };
  const bibleB = { id: 'bible_b', mode: 'kids_cartoon_2d', characters: [{ id: 'char_luna_b', characterKey: 'luna_main', name: 'Lua', speciesType: 'bunny', canonicalCharacterAsset: { path: sourceB, provider: 'provider-y', model: 'image-v2' } }] };
  const resultB = await registry.ensureProductionAssets({ id: 'episode_b' }, bibleB, planB);
  check('B reuses existing canonical character asset', () => assert.strictEqual(resultB.summary.reused, 1));
  check('B keeps origin hash immutable', () => assert.strictEqual(resultB.assets[0].assetSha256, shaA));
  check('B keeps origin provider immutable', () => assert.strictEqual(resultB.assets[0].provider, 'provider-x'));
  check('B keeps origin model immutable', () => assert.strictEqual(resultB.assets[0].model, 'image-v1'));
  check('B keeps origin production immutable', () => assert.strictEqual(resultB.assets[0].sourceProductionId, 'episode_a'));

  const pip = { id: 'pc_pip', namespace: 'series', characterKey: 'pip_bird', displayName: 'Pip', speciesType: 'bird', identityFingerprint: 'fp_pip' };
  const localResult = await registry.ensureProductionAssets({ id: 'episode_local' }, { id: 'bible_local', mode: 'kids_cartoon_2d', characters: [{ characterKey: 'pip_bird', name: 'Pip', speciesType: 'bird', canonicalCharacterAssetPath: localFile, canonicalCharacterAssetProvider: 'local-renderer' }] }, { active: true, characters: [{ character: pip, usage: {} }] });
  check('local renderer asset rejected', () => assert.strictEqual(localResult.summary.rejected, 1));
  check('local renderer creates no asset row', () => assert.strictEqual(assets.size, 1));

  const nova = { id: 'pc_nova', namespace: 'series', characterKey: 'nova_star', displayName: 'Nova', speciesType: 'star', identityFingerprint: 'fp_nova' };
  const missingProvider = await registry.ensureProductionAssets({ id: 'episode_nova' }, { id: 'bible_nova', mode: 'kids_cartoon_2d', characters: [{ characterKey: 'nova_star', name: 'Nova', speciesType: 'star', canonicalCharacterAssetPath: noProviderFile }] }, { active: true, characters: [{ character: nova, usage: {} }] });
  check('missing provider rejected', () => assert.strictEqual(missingProvider.summary.rejected, 1));

  const robot = { id: 'pc_robot', namespace: 'series', characterKey: 'robot_x', displayName: 'Robot X', speciesType: 'robot', identityFingerprint: 'fp_robot' };
  const unsupportedResult = await registry.ensureProductionAssets({ id: 'episode_robot' }, { id: 'bible_robot', mode: 'kids_cartoon_2d', characters: [{ characterKey: 'robot_x', name: 'Robot X', speciesType: 'robot', canonicalCharacterAssetPath: unsupported, canonicalCharacterAssetProvider: 'provider-x' }] }, { active: true, characters: [{ character: robot, usage: {} }] });
  check('unsupported image extension rejected', () => assert.strictEqual(unsupportedResult.summary.rejected, 1));

  const bunny1 = { id: 'pc_bunny_1', namespace: 'series', characterKey: 'bunny_1', displayName: 'Moon Bunny', speciesType: 'bunny', identityFingerprint: 'fp_bunny_1' };
  const bunny2 = { id: 'pc_bunny_2', namespace: 'series', characterKey: 'bunny_2', displayName: 'Moon Bunny', speciesType: 'bunny', identityFingerprint: 'fp_bunny_2' };
  const ambiguousBible = { id: 'bible_amb', mode: 'kids_cartoon_2d', characters: [{ name: 'Moon Bunny', speciesType: 'bunny', canonicalAssetPath: sourceA, canonicalAssetProvider: 'provider-x' }] };
  const ambiguousPlan = { active: true, characters: [{ character: bunny1, usage: {} }, { character: bunny2, usage: {} }] };
  const ambiguousResult = await registry.ensureProductionAssets({ id: 'episode_amb' }, ambiguousBible, ambiguousPlan);
  check('ambiguous character binding fails closed', () => assert.strictEqual(ambiguousResult.summary.ambiguous, 1));
  check('ambiguous binding creates no extra asset', () => assert.strictEqual(assets.size, 1));

  const keyedBinding = bindingForDeclaration({ explicitCharacterKey: 'luna_main' }, characterBindings(planA));
  check('explicit character key binds deterministically', () => assert.strictEqual(keyedBinding.binding.character.id, luna.id));
  const sourceBinding = bindingForDeclaration({ sourceCharacterId: 'char_luna' }, characterBindings(planA));
  check('source character id binds deterministically', () => assert.strictEqual(sourceBinding.binding.character.id, luna.id));

  const missingSource = await registry.ensureProductionAssets({ id: 'episode_missing' }, { id: 'bible_missing', mode: 'kids_cartoon_2d', characters: [{ characterKey: 'new_one', name: 'New One', canonicalAssetPath: path.join(tmp, 'missing.png'), canonicalAssetProvider: 'provider-x' }] }, { active: true, characters: [{ character: { id: 'pc_new', namespace: 'series', characterKey: 'new_one', displayName: 'New One', speciesType: 'character', identityFingerprint: 'fp_new' }, usage: {} }] });
  check('missing source file rejected', () => assert.strictEqual(missingSource.summary.rejected, 1));

  const disabled = await new CanonicalCharacterAssetRegistryV11(db, { enabled: false, dataRoot }).ensureProductionAssets({ id: 'episode_disabled' }, bibleA, planA);
  check('disabled registry inactive', () => assert.strictEqual(disabled.active, false));
  check('disabled registry creates nothing', () => assert.strictEqual(disabled.assets.length, 0));

  await fsp.rm(tmp, { recursive: true, force: true });
}

runtimeChecks().then(() => console.log(`Phase 11.11.3 Canonical Character Assets OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
