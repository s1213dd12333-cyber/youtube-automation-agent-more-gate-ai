'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.11.3';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const LOCAL_PROVIDER_KEYS = new Set(['local', 'local-renderer', 'local_renderer', 'fallback', 'generic', 'slideshow']);

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function safeSegment(value) {
  return normalize(value).replace(/\s+/g, '_') || 'asset';
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

async function fileSha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function providerIsCanonical(provider = '', sourcePath = '') {
  const key = normalize(provider).replace(/\s+/g, '-');
  if (!key || LOCAL_PROVIDER_KEYS.has(key)) return false;
  const base = path.basename(String(sourcePath || '')).toLowerCase();
  if (base.startsWith('visual_local_') || base.startsWith('thumbnail_local_') || base.startsWith('character_local_')) return false;
  return true;
}

function assetMetadata(raw = {}) {
  const nested = raw.canonicalCharacterAsset && typeof raw.canonicalCharacterAsset === 'object' ? raw.canonicalCharacterAsset :
    raw.canonicalAsset && typeof raw.canonicalAsset === 'object' ? raw.canonicalAsset :
    raw.canonicalReference && typeof raw.canonicalReference === 'object' ? raw.canonicalReference :
    raw.characterReference && typeof raw.characterReference === 'object' ? raw.characterReference : {};
  const sourcePath = clean(
    nested.path || nested.assetPath ||
    raw.canonicalCharacterAssetPath || raw.canonicalAssetPath || raw.canonicalReferencePath || raw.characterReferencePath || '',
    4000
  ) || null;
  if (!sourcePath) return null;
  return {
    sourcePath,
    provider: clean(nested.provider || raw.canonicalCharacterAssetProvider || raw.canonicalAssetProvider || raw.canonicalReferenceProvider || raw.characterReferenceProvider || '', 240) || null,
    model: clean(nested.model || raw.canonicalCharacterAssetModel || raw.canonicalAssetModel || raw.canonicalReferenceModel || raw.characterReferenceModel || '', 240) || null,
    sourceKind: clean(nested.sourceKind || raw.canonicalCharacterAssetSourceKind || raw.canonicalAssetSourceKind || 'explicit-canonical-character-reference', 240),
    canonical: nested.canonical !== false && raw.canonicalCharacterAsset !== false && raw.canonicalAsset !== false
  };
}

function declarationFromRaw(raw = {}, context = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const asset = assetMetadata(raw);
  if (!asset || !asset.canonical) return null;
  return {
    ...asset,
    explicitCharacterKey: clean(raw.characterKey || raw.persistentCharacterKey || raw.canonicalCharacterKey || '', 240) || null,
    displayName: clean(raw.name || raw.displayName || raw.characterName || '', 240) || null,
    speciesType: clean(raw.speciesType || raw.species || raw.type || 'character', 160) || 'character',
    sourceCharacterId: clean(raw.id || raw.sourceCharacterId || '', 240) || null,
    sourceBibleId: clean(context.sourceBibleId || raw.sourceBibleId || '', 240) || null,
    sourceRef: clean(raw.sourceRef || '', 240) || null
  };
}

function collectAssetDeclarations(cartoonBible = null) {
  if (!cartoonBible || cartoonBible.mode !== 'kids_cartoon_2d') return [];
  const out = [];
  for (const raw of Array.isArray(cartoonBible.characters) ? cartoonBible.characters : []) {
    const declaration = declarationFromRaw(raw, { sourceBibleId: cartoonBible.id });
    if (declaration) out.push(declaration);
  }
  return out;
}

function characterBindings(characterPlan = null) {
  return (characterPlan?.characters || []).filter(item => item?.character?.id).map(item => ({
    character: item.character,
    usage: item.usage || null,
    matchMode: item.matchMode || item.usage?.matchMode || null
  }));
}

function bindingForDeclaration(declaration = {}, bindings = []) {
  const list = Array.isArray(bindings) ? bindings : [];
  let matches = [];
  if (declaration.explicitCharacterKey) {
    const key = safeSegment(declaration.explicitCharacterKey);
    matches = list.filter(item => safeSegment(item.character?.characterKey) === key);
  } else if (declaration.sourceCharacterId) {
    matches = list.filter(item => item.usage?.sourceCharacterId === declaration.sourceCharacterId);
  } else if (declaration.sourceRef) {
    matches = list.filter(item => item.usage?.sourceRef === declaration.sourceRef);
  } else {
    matches = list.filter(item => {
      if (declaration.displayName && normalize(item.character?.displayName) !== normalize(declaration.displayName)) return false;
      const incomingSpecies = normalize(declaration.speciesType || 'character');
      const actualSpecies = normalize(item.character?.speciesType || 'character');
      return !incomingSpecies || incomingSpecies === 'character' || incomingSpecies === actualSpecies;
    });
  }
  if (matches.length === 1) return { status: 'resolved', binding: matches[0], candidates: matches };
  if (matches.length > 1) return { status: 'ambiguous', binding: null, candidates: matches };
  return { status: 'unresolved', binding: null, candidates: [] };
}

function assetKey(characterId, role = 'character_reference') {
  return `${safeSegment(characterId)}::${safeSegment(role)}`;
}

class CanonicalCharacterAssetRegistryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.CANONICAL_CHARACTER_ASSETS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireProvider = String(options.requireProvider ?? process.env.CANONICAL_CHARACTER_ASSET_REQUIRE_PROVIDER ?? 'true').toLowerCase() !== 'false';
    this.dataRoot = options.dataRoot || path.resolve(__dirname, '..', 'data');
  }

  async persistAssetFile(sourcePath, character = {}, role = 'character_reference') {
    if (!await fileExists(sourcePath)) return { status: 'rejected', reason: 'source_file_missing' };
    const ext = path.extname(String(sourcePath)).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return { status: 'rejected', reason: 'unsupported_image_extension' };
    const target = path.join(this.dataRoot, 'assets', 'character-library', safeSegment(character.namespace || 'default'), safeSegment(character.id), `${safeSegment(role)}${ext}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const sourceSha = await fileSha256(sourcePath);
    if (await fileExists(target)) {
      const targetSha = await fileSha256(target);
      if (targetSha !== sourceSha) return { status: 'conflict', reason: 'canonical_target_hash_conflict', path: target, sha256: targetSha };
      return { status: 'ready', path: target, sha256: targetSha, copied: false };
    }
    if (path.resolve(sourcePath) !== path.resolve(target)) await fs.copyFile(sourcePath, target);
    return { status: 'ready', path: target, sha256: sourceSha, copied: true };
  }

  async registerDeclaration(production = {}, declaration = {}, binding = null) {
    const character = binding?.character || null;
    const usage = binding?.usage || null;
    if (!character?.id || !character.identityFingerprint) {
      return { status: 'unresolved', character: null, asset: null, reused: false, reason: 'character_binding_missing' };
    }
    const key = assetKey(character.id, 'character_reference');
    const existing = this.db?.getPersistentCharacterAssetByKey ? await this.db.getPersistentCharacterAssetByKey(key) : null;
    if (existing) {
      if (existing.identityFingerprint !== character.identityFingerprint) {
        return { status: 'conflict', character, asset: existing, reused: false, reason: 'asset_identity_fingerprint_conflict' };
      }
      if (existing.status !== 'ready' || !existing.assetPath || !await fileExists(existing.assetPath)) {
        return { status: 'conflict', character, asset: existing, reused: false, reason: 'existing_canonical_asset_missing' };
      }
      return { status: 'ready', character, asset: existing, reused: true, reason: 'existing_canonical_asset' };
    }
    if (this.requireProvider && !providerIsCanonical(declaration.provider, declaration.sourcePath)) {
      return { status: 'rejected', character, asset: null, reused: false, reason: declaration.provider ? 'local_or_generic_provider_rejected' : 'provider_missing' };
    }
    if (!this.requireProvider && declaration.provider && !providerIsCanonical(declaration.provider, declaration.sourcePath)) {
      return { status: 'rejected', character, asset: null, reused: false, reason: 'local_or_generic_provider_rejected' };
    }
    const persisted = await this.persistAssetFile(declaration.sourcePath, character, 'character_reference');
    if (persisted.status !== 'ready') {
      return { status: persisted.status, character, asset: null, reused: false, reason: persisted.reason };
    }
    const asset = this.db?.savePersistentCharacterAsset ? await this.db.savePersistentCharacterAsset({
      assetKey: key,
      characterId: character.id,
      assetRole: 'character_reference',
      version: VERSION,
      identityFingerprint: character.identityFingerprint,
      canonical: true,
      status: 'ready',
      assetPath: persisted.path,
      assetSha256: persisted.sha256,
      sourceKind: declaration.sourceKind || 'explicit-canonical-character-reference',
      sourceProductionId: production.id || null,
      sourceBibleId: declaration.sourceBibleId || usage?.sourceBibleId || null,
      sourceCharacterId: declaration.sourceCharacterId || usage?.sourceCharacterId || null,
      sourceRef: declaration.sourceRef || usage?.sourceRef || null,
      provider: declaration.provider || null,
      model: declaration.model || null
    }) : null;
    return { status: 'ready', character, asset, reused: false, reason: 'provider_backed_canonical_reference_promoted' };
  }

  async ensureProductionAssets(production = {}, cartoonBible = null, characterPlan = null) {
    if (!this.enabled || !production?.id) {
      return { version: VERSION, active: this.enabled, assets: [], decisions: [], summary: { total: 0, ready: 0, reused: 0, rejected: 0, ambiguous: 0, conflicts: 0 } };
    }
    const declarations = collectAssetDeclarations(cartoonBible);
    const bindings = characterBindings(characterPlan);
    const decisions = [];
    const assets = [];
    const seenCharacters = new Set();
    for (const declaration of declarations) {
      const resolved = bindingForDeclaration(declaration, bindings);
      if (resolved.status !== 'resolved') {
        decisions.push({ status: resolved.status, declaration, character: null, asset: null, reused: false,
          reason: resolved.status === 'ambiguous' ? 'asset_declaration_matches_multiple_characters' : 'asset_declaration_character_not_found' });
        continue;
      }
      const characterId = resolved.binding.character.id;
      if (seenCharacters.has(characterId)) {
        decisions.push({ status: 'reused_declaration', declaration, character: resolved.binding.character, asset: null, reused: true, reason: 'character_asset_already_processed_in_production' });
        continue;
      }
      const decision = await this.registerDeclaration(production, declaration, resolved.binding);
      decisions.push({ ...decision, declaration });
      if (decision.status === 'ready' || decision.status === 'conflict') seenCharacters.add(characterId);
      if (decision.asset) assets.push(decision.asset);
    }
    const summary = {
      total: decisions.length,
      ready: decisions.filter(item => item.status === 'ready').length,
      reused: decisions.filter(item => item.status === 'ready' && item.reused).length,
      rejected: decisions.filter(item => item.status === 'rejected').length,
      ambiguous: decisions.filter(item => item.status === 'ambiguous').length,
      conflicts: decisions.filter(item => item.status === 'conflict').length
    };
    this.logger.info(`Canonical Character Assets v${VERSION}: ready=${summary.ready}, reused=${summary.reused}, rejected=${summary.rejected}, ambiguous=${summary.ambiguous}, conflicts=${summary.conflicts}.`);
    return { version: VERSION, active: true, assets, decisions, summary };
  }
}

module.exports = {
  CANONICAL_CHARACTER_ASSETS_VERSION: VERSION,
  CanonicalCharacterAssetRegistryV11,
  IMAGE_EXTENSIONS,
  providerIsCanonical,
  assetMetadata,
  declarationFromRaw,
  collectAssetDeclarations,
  characterBindings,
  bindingForDeclaration,
  assetKey,
  fileExists,
  fileSha256,
  safeSegment
};
