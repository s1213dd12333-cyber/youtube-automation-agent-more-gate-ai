'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.10.3';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const LOCAL_PROVIDER_KEYS = new Set(['local', 'local-renderer', 'local_renderer', 'fallback', 'generic', 'slideshow']);

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (base.startsWith('visual_local_') || base.startsWith('thumbnail_local_') || base.startsWith('object_local_')) return false;
  return true;
}

function propLockIsPersistent(lock = {}) {
  const marker = value => {
    if (value === true) return true;
    const text = normalize(value);
    return ['persistent', 'world', 'global', 'canonical', 'cross video', 'cross_video'].includes(text);
  };
  return lock.worldPersistent === true || lock.persistent === true || lock.crossVideo === true || marker(lock.persistence) || marker(lock.scope) || marker(lock.continuityScope);
}

function assetMetadata(raw = {}) {
  const nested = raw.canonicalAsset && typeof raw.canonicalAsset === 'object' ? raw.canonicalAsset :
    raw.canonicalReference && typeof raw.canonicalReference === 'object' ? raw.canonicalReference : {};
  const sourcePath = clean(nested.path || nested.assetPath || raw.canonicalAssetPath || raw.canonicalReferencePath || raw.objectReferencePath || '', 4000) || null;
  if (!sourcePath) return null;
  return {
    sourcePath,
    provider: clean(nested.provider || raw.canonicalAssetProvider || raw.canonicalReferenceProvider || '', 240) || null,
    model: clean(nested.model || raw.canonicalAssetModel || raw.canonicalReferenceModel || '', 240) || null,
    sourceKind: clean(nested.sourceKind || raw.canonicalAssetSourceKind || 'explicit-canonical-object-reference', 240),
    canonical: nested.canonical !== false && raw.canonicalAsset !== false
  };
}

function declarationFromRaw(raw, context = {}) {
  if (!raw) return null;
  const value = typeof raw === 'string' ? { name: raw } : raw;
  const asset = assetMetadata(value);
  if (!asset || !asset.canonical) return null;
  return {
    ...asset,
    environmentId: clean(context.environmentId || value.environmentId || '', 240) || null,
    explicitObjectKey: clean(value.objectKey || value.persistentObjectKey || value.worldObjectKey || value.canonicalObjectKey || value.key || '', 240) || null,
    displayName: clean(value.displayName || value.name || value.originalName || '', 240) || null,
    objectType: clean(value.objectType || value.type || '', 160) || 'object',
    sourceRef: clean(value.id || value.sourceRef || '', 240) || null,
    propLockId: context.propLockId || value.propLockId || null
  };
}

function collectAssetDeclarations(environmentBible = null, propLocks = []) {
  const out = [];
  for (const environment of environmentBible?.environments || []) {
    for (const field of ['persistentObjects', 'worldObjects', 'canonicalObjects']) {
      for (const raw of Array.isArray(environment[field]) ? environment[field] : []) {
        const declaration = declarationFromRaw(raw, { environmentId: environment.environmentId });
        if (declaration) out.push(declaration);
      }
    }
  }
  for (const raw of environmentBible?.persistentObjects || []) {
    const declaration = declarationFromRaw(raw, {});
    if (declaration) out.push(declaration);
  }
  for (const lock of Array.isArray(propLocks) ? propLocks : []) {
    if (!propLockIsPersistent(lock)) continue;
    const declaration = declarationFromRaw(lock, { environmentId: lock.environmentId, propLockId: lock.id });
    if (declaration) out.push(declaration);
  }
  return out;
}

function objectBindings(objectPlan = null) {
  return (objectPlan?.objects || []).filter(item => item?.object?.id).map(item => ({ object: item.object, usage: item.usage || null, matchMode: item.matchMode || item.usage?.matchMode || null }));
}

function bindingForDeclaration(declaration = {}, bindings = []) {
  const list = Array.isArray(bindings) ? bindings : [];
  let matches = [];
  if (declaration.explicitObjectKey) {
    const key = safeSegment(declaration.explicitObjectKey);
    matches = list.filter(item => safeSegment(item.object?.objectKey) === key);
  } else if (declaration.propLockId) {
    matches = list.filter(item => item.usage?.propLockId === declaration.propLockId);
  } else if (declaration.sourceRef) {
    matches = list.filter(item => item.usage?.sourceRef === declaration.sourceRef);
  } else {
    matches = list.filter(item => {
      if (declaration.environmentId && item.usage?.environmentId !== declaration.environmentId) return false;
      if (declaration.displayName && normalize(item.object?.displayName) !== normalize(declaration.displayName)) return false;
      const incomingType = normalize(declaration.objectType || 'object');
      const actualType = normalize(item.object?.objectType || 'object');
      return !incomingType || incomingType === 'object' || actualType === incomingType;
    });
  }
  if (matches.length === 1) return { status: 'resolved', binding: matches[0], candidates: matches };
  if (matches.length > 1) return { status: 'ambiguous', binding: null, candidates: matches };
  return { status: 'unresolved', binding: null, candidates: [] };
}

function assetKey(objectId, role = 'object_reference') {
  return `${safeSegment(objectId)}::${safeSegment(role)}`;
}

class CanonicalWorldObjectAssetRegistryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.CANONICAL_WORLD_OBJECT_ASSETS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireProvider = String(options.requireProvider ?? process.env.CANONICAL_WORLD_OBJECT_ASSET_REQUIRE_PROVIDER ?? 'true').toLowerCase() !== 'false';
    this.dataRoot = options.dataRoot || path.resolve(__dirname, '..', 'data');
  }

  async persistAssetFile(sourcePath, object = {}, role = 'object_reference') {
    if (!await fileExists(sourcePath)) return { status: 'rejected', reason: 'source_file_missing' };
    const ext = path.extname(String(sourcePath)).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return { status: 'rejected', reason: 'unsupported_image_extension' };
    const target = path.join(this.dataRoot, 'assets', 'object-library', safeSegment(object.namespace || 'default'), safeSegment(object.id), `${safeSegment(role)}${ext}`);
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
    const object = binding?.object || null;
    const usage = binding?.usage || null;
    if (!object?.id || !object.identityFingerprint) return { status: 'unresolved', object: null, asset: null, reused: false, reason: 'object_binding_missing' };
    const key = assetKey(object.id, 'object_reference');
    const existing = this.db?.getPersistentWorldObjectAssetByKey ? await this.db.getPersistentWorldObjectAssetByKey(key) : null;
    if (existing) {
      if (existing.identityFingerprint !== object.identityFingerprint) return { status: 'conflict', object, asset: existing, reused: false, reason: 'asset_identity_fingerprint_conflict' };
      if (existing.status !== 'ready' || !existing.assetPath || !await fileExists(existing.assetPath)) return { status: 'conflict', object, asset: existing, reused: false, reason: 'existing_canonical_asset_missing' };
      return { status: 'ready', object, asset: existing, reused: true, reason: 'existing_canonical_asset' };
    }
    if (this.requireProvider && !providerIsCanonical(declaration.provider, declaration.sourcePath)) return { status: 'rejected', object, asset: null, reused: false, reason: declaration.provider ? 'local_or_generic_provider_rejected' : 'provider_missing' };
    if (!this.requireProvider && declaration.provider && !providerIsCanonical(declaration.provider, declaration.sourcePath)) return { status: 'rejected', object, asset: null, reused: false, reason: 'local_or_generic_provider_rejected' };
    const persisted = await this.persistAssetFile(declaration.sourcePath, object, 'object_reference');
    if (persisted.status !== 'ready') return { status: persisted.status, object, asset: null, reused: false, reason: persisted.reason };
    const asset = this.db?.savePersistentWorldObjectAsset ? await this.db.savePersistentWorldObjectAsset({
      assetKey: key,
      objectId: object.id,
      assetRole: 'object_reference',
      version: VERSION,
      identityFingerprint: object.identityFingerprint,
      canonical: true,
      status: 'ready',
      assetPath: persisted.path,
      assetSha256: persisted.sha256,
      sourceKind: declaration.sourceKind || 'explicit-canonical-object-reference',
      sourceProductionId: production.id || null,
      sourceEnvironmentId: declaration.environmentId || usage?.environmentId || null,
      sourceRef: declaration.sourceRef || usage?.sourceRef || null,
      sourcePropLockId: declaration.propLockId || usage?.propLockId || null,
      provider: declaration.provider || null,
      model: declaration.model || null
    }) : null;
    return { status: 'ready', object, asset, reused: false, reason: 'provider_backed_canonical_reference_promoted' };
  }

  async ensureProductionAssets(production = {}, environmentBible = null, propLocks = [], objectPlan = null) {
    if (!this.enabled || !production?.id) return { version: VERSION, active: this.enabled, assets: [], decisions: [], summary: { total: 0, ready: 0, reused: 0, rejected: 0, ambiguous: 0, conflicts: 0 } };
    const declarations = collectAssetDeclarations(environmentBible, propLocks);
    const bindings = objectBindings(objectPlan);
    const decisions = [];
    const assets = [];
    const seenObjects = new Set();
    for (const declaration of declarations) {
      const resolved = bindingForDeclaration(declaration, bindings);
      if (resolved.status !== 'resolved') {
        decisions.push({ status: resolved.status, declaration, object: null, asset: null, reused: false, reason: resolved.status === 'ambiguous' ? 'asset_declaration_matches_multiple_objects' : 'asset_declaration_object_not_found' });
        continue;
      }
      const objectId = resolved.binding.object.id;
      if (seenObjects.has(objectId)) {
        decisions.push({ status: 'reused_declaration', declaration, object: resolved.binding.object, asset: null, reused: true, reason: 'object_asset_already_processed_in_production' });
        continue;
      }
      const decision = await this.registerDeclaration(production, declaration, resolved.binding);
      decisions.push({ ...decision, declaration });
      if (decision.status === 'ready' || decision.status === 'conflict') seenObjects.add(objectId);
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
    this.logger.info(`Canonical World Object Assets v${VERSION}: ready=${summary.ready}, reused=${summary.reused}, rejected=${summary.rejected}, ambiguous=${summary.ambiguous}, conflicts=${summary.conflicts}.`);
    return { version: VERSION, active: true, assets, decisions, summary };
  }
}

module.exports = {
  CANONICAL_WORLD_OBJECT_ASSETS_VERSION: VERSION,
  CanonicalWorldObjectAssetRegistryV11,
  IMAGE_EXTENSIONS,
  providerIsCanonical,
  assetMetadata,
  declarationFromRaw,
  collectAssetDeclarations,
  objectBindings,
  bindingForDeclaration,
  assetKey,
  fileExists,
  fileSha256,
  safeSegment
};
