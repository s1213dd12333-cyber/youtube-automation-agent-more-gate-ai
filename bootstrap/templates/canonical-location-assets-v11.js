'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.9.3';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeSegment(value) {
  return clean(value, 200).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'asset';
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

function latestByKeyframe(checks = []) {
  const latest = new Map();
  for (const check of Array.isArray(checks) ? checks : []) {
    const key = check?.keyframeId || check?.keyframe_id;
    if (!key) continue;
    const current = latest.get(key);
    const attempt = Number(check.attempt || 0);
    const currentAttempt = current ? Number(current.attempt || 0) : -1;
    const created = String(check.createdAt || check.created_at || '');
    const currentCreated = current ? String(current.createdAt || current.created_at || '') : '';
    if (!current || attempt > currentAttempt || (attempt === currentAttempt && created >= currentCreated)) latest.set(key, check);
  }
  return latest;
}

function assetKey({ locationId, zoneId = null, role }) {
  return [safeSegment(locationId), zoneId ? safeSegment(zoneId) : 'location', safeSegment(role || 'reference')].join('::');
}

function locationBindingMap(bundle = {}) {
  const map = new Map();
  for (const item of bundle.reusableLocations || []) {
    if (!item?.id) continue;
    map.set(item.id, item);
  }
  return map;
}

function uniqueZoneBindings(bundle = {}) {
  const map = new Map();
  for (const zone of bundle.reusableLocationZones || []) {
    if (!zone?.id || !zone?.locationId || !zone?.usage?.sceneId) continue;
    const key = `${zone.id}:${zone.usage.sceneId}`;
    if (!map.has(key)) map.set(key, zone);
  }
  return [...map.values()];
}

function candidateRank(keyframe = {}) {
  const roleRank = keyframe.keyframeRole === 'start' ? 0 : keyframe.keyframeRole === 'middle' ? 1 : 2;
  return Number(keyframe.shotIndex || 0) * 10 + roleRank;
}

function selectZoneCandidate(zoneBinding = {}, bundle = {}, options = {}) {
  const requireContinuity = options.requireContinuity !== false;
  const requireSemantic = options.requireSemantic === true;
  const sceneId = zoneBinding?.usage?.sceneId;
  const keyframes = (bundle.keyframes || [])
    .filter(item => item?.sceneId === sceneId && item.status === 'ready' && item.assetPath && IMAGE_EXTENSIONS.has(path.extname(String(item.assetPath)).toLowerCase()))
    .sort((a, b) => candidateRank(a) - candidateRank(b) || String(a.id).localeCompare(String(b.id)));

  const continuityByKeyframe = latestByKeyframe(bundle.environmentContinuityChecks || []);
  const semanticByKeyframe = latestByKeyframe(bundle.semanticPropChecks || []);
  const rejected = [];

  for (const keyframe of keyframes) {
    const base = path.basename(String(keyframe.assetPath || '')).toLowerCase();
    if (keyframe.provider === 'local-renderer' || base.startsWith('visual_local_') || base.startsWith('thumbnail_local_')) {
      rejected.push({ keyframeId: keyframe.id, reason: 'generic_local_fallback' });
      continue;
    }
    const continuity = continuityByKeyframe.get(keyframe.id) || null;
    const semantic = semanticByKeyframe.get(keyframe.id) || null;
    const continuityAccepted = continuity?.status === 'accepted' || continuity?.accepted === true;
    if (requireContinuity && !continuityAccepted) {
      rejected.push({ keyframeId: keyframe.id, reason: continuity ? 'continuity_not_accepted' : 'continuity_missing' });
      continue;
    }
    const semanticVerified = semantic?.semanticPropPresenceVerified === true || semantic?.verified === true || semantic?.verified === 1 || semantic?.status === 'verified';
    const semanticRejected = semantic && semantic.status !== 'unavailable' && semantic.status !== 'disabled' && !semanticVerified;
    if (requireSemantic && !semanticVerified) {
      rejected.push({ keyframeId: keyframe.id, reason: semantic ? 'semantic_not_verified' : 'semantic_missing' });
      continue;
    }
    if (!requireSemantic && semanticRejected) {
      rejected.push({ keyframeId: keyframe.id, reason: 'semantic_rejected' });
      continue;
    }
    return { keyframe, continuity, semantic, rejected };
  }
  return { keyframe: null, continuity: null, semantic: null, rejected };
}

class CanonicalLocationAssetRegistryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.CANONICAL_LOCATION_ASSETS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireContinuity = String(options.requireContinuity ?? process.env.CANONICAL_LOCATION_ASSET_REQUIRE_CONTINUITY ?? 'true').toLowerCase() !== 'false';
    const canonicalSemantic = String(options.requireSemantic ?? process.env.CANONICAL_LOCATION_ASSET_REQUIRE_SEMANTIC ?? 'false').toLowerCase() === 'true';
    const globalSemantic = String(process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';
    this.requireSemantic = canonicalSemantic || globalSemantic;
    this.dataRoot = options.dataRoot || path.resolve(__dirname, '..', 'data');
  }

  async persistAssetFile(sourcePath, location, zone, role) {
    if (!await fileExists(sourcePath)) return null;
    const ext = IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) ? path.extname(sourcePath).toLowerCase() : '.png';
    const namespace = safeSegment(location?.namespace || 'default');
    const locationId = safeSegment(location?.id || zone?.locationId || 'location');
    const base = path.join(this.dataRoot, 'assets', 'location-library', namespace, locationId);
    const target = zone
      ? path.join(base, 'zones', safeSegment(zone.zoneKey || zone.id), `${safeSegment(role)}${ext}`)
      : path.join(base, `${safeSegment(role)}${ext}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const sourceSha = await fileSha256(sourcePath);
    let targetSha = null;
    if (await fileExists(target)) targetSha = await fileSha256(target);
    if (sourceSha !== targetSha && path.resolve(sourcePath) !== path.resolve(target)) await fs.copyFile(sourcePath, target);
    return { path: target, sha256: sourceSha, copied: sourceSha !== targetSha };
  }

  async registerLocationMaster(location = {}, productionId = null) {
    if (!location?.id || !location.canonicalMasterFramePath || !await fileExists(location.canonicalMasterFramePath)) return null;
    const key = assetKey({ locationId: location.id, role: 'location_master' });
    const existing = await this.db.getReusableLocationAssetByKey(key);
    if (existing?.status === 'ready' && existing.assetPath && await fileExists(existing.assetPath) && existing.identityFingerprint === location.identityFingerprint) {
      return { asset: existing, reused: true };
    }
    const persisted = await this.persistAssetFile(location.canonicalMasterFramePath, location, null, 'location_master');
    if (!persisted) return null;
    const asset = await this.db.saveReusableLocationAsset({
      assetKey: key,
      locationId: location.id,
      zoneId: null,
      scope: 'location',
      assetRole: 'location_master',
      version: VERSION,
      identityFingerprint: location.identityFingerprint || null,
      canonical: true,
      status: 'ready',
      assetPath: persisted.path,
      assetSha256: persisted.sha256,
      sourceKind: 'reusable-location-master',
      sourceProductionId: location.createdFromProductionId || productionId || null,
      sourceSceneId: null,
      sourceKeyframeId: null,
      sourceEnvironmentId: location.canonicalEnvironmentId || null,
      provider: null,
      model: null,
      continuityCheckId: null,
      continuityScore: null,
      semanticCheckId: null,
      semanticStatus: null,
      semanticVerified: false
    });
    return { asset, reused: false };
  }

  async registerZoneReference(zone = {}, location = {}, bundle = {}) {
    if (!zone?.id || !zone?.locationId || !zone?.usage?.sceneId) return { status: 'unresolved', zone, asset: null, reason: 'zone_binding_incomplete' };
    const key = assetKey({ locationId: zone.locationId, zoneId: zone.id, role: 'zone_reference' });
    const existing = await this.db.getReusableLocationAssetByKey(key);
    if (existing?.status === 'ready' && existing.assetPath && await fileExists(existing.assetPath) && existing.identityFingerprint === zone.identityFingerprint) {
      return { status: 'ready', zone, asset: existing, reused: true, reason: 'existing_canonical_asset' };
    }

    const selected = selectZoneCandidate(zone, bundle, { requireContinuity: this.requireContinuity, requireSemantic: this.requireSemantic });
    if (!selected.keyframe || !await fileExists(selected.keyframe.assetPath)) {
      return { status: 'unanchored', zone, asset: null, reused: false, reason: selected.rejected.at(-1)?.reason || 'no_verified_keyframe_candidate', rejected: selected.rejected };
    }

    const persisted = await this.persistAssetFile(selected.keyframe.assetPath, location, zone, 'zone_reference');
    const semanticVerified = selected.semantic?.semanticPropPresenceVerified === true || selected.semantic?.verified === true || selected.semantic?.verified === 1 || selected.semantic?.status === 'verified';
    const asset = await this.db.saveReusableLocationAsset({
      assetKey: key,
      locationId: zone.locationId,
      zoneId: zone.id,
      scope: 'zone',
      assetRole: 'zone_reference',
      version: VERSION,
      identityFingerprint: zone.identityFingerprint || null,
      canonical: true,
      status: 'ready',
      assetPath: persisted.path,
      assetSha256: persisted.sha256,
      sourceKind: 'verified-keyframe-promotion',
      sourceProductionId: bundle.id || zone.usage.productionId || null,
      sourceSceneId: zone.usage.sceneId,
      sourceKeyframeId: selected.keyframe.id,
      sourceEnvironmentId: zone.usage.environmentId || null,
      provider: selected.keyframe.provider || null,
      model: selected.keyframe.model || null,
      continuityCheckId: selected.continuity?.id || null,
      continuityScore: selected.continuity?.score == null ? null : Number(selected.continuity.score),
      semanticCheckId: selected.semantic?.id || null,
      semanticStatus: selected.semantic?.status || null,
      semanticVerified
    });
    return { status: 'ready', zone, asset, reused: false, reason: 'verified_keyframe_promoted' };
  }

  async ensureProductionAssets(bundle = {}) {
    if (!this.enabled || !bundle?.id) return { version: VERSION, active: this.enabled, assets: [], zones: [], summary: { locationMasters: 0, zoneReady: 0, zoneReused: 0, zoneUnanchored: 0 } };
    const locations = locationBindingMap(bundle);
    const assets = [];
    const seenLocations = new Set();
    for (const location of locations.values()) {
      if (seenLocations.has(location.id)) continue;
      seenLocations.add(location.id);
      const result = await this.registerLocationMaster(location, bundle.id);
      if (result?.asset) assets.push(result.asset);
    }

    const zones = [];
    const zoneGroups = new Map();
    for (const zone of uniqueZoneBindings(bundle)) {
      if (!zoneGroups.has(zone.id)) zoneGroups.set(zone.id, []);
      zoneGroups.get(zone.id).push(zone);
    }
    for (const bindings of zoneGroups.values()) {
      const first = bindings[0];
      const location = locations.get(first.locationId) || await this.db.getReusableLocation(first.locationId);
      if (!location) {
        zones.push({ status: 'unanchored', zone: first, asset: null, reused: false, reason: 'parent_location_missing' });
        continue;
      }
      let result = null;
      for (const zone of bindings) {
        result = await this.registerZoneReference(zone, location, bundle);
        if (result.status === 'ready') break;
      }
      result = result || { status: 'unanchored', zone: first, asset: null, reused: false, reason: 'no_zone_usage_candidate' };
      zones.push(result);
      if (result.asset) assets.push(result.asset);
    }

    const summary = {
      locationMasters: assets.filter(item => item.scope === 'location' && item.status === 'ready').length,
      zoneReady: zones.filter(item => item.status === 'ready').length,
      zoneReused: zones.filter(item => item.status === 'ready' && item.reused).length,
      zoneUnanchored: zones.filter(item => item.status !== 'ready').length
    };
    this.logger.info(`Canonical Location Assets v11.9.3: locationMasters=${summary.locationMasters}, zoneReady=${summary.zoneReady}, reused=${summary.zoneReused}, unanchored=${summary.zoneUnanchored}.`);
    return { version: VERSION, active: true, assets, zones, summary };
  }
}

module.exports = {
  CANONICAL_LOCATION_ASSETS_VERSION: VERSION,
  CanonicalLocationAssetRegistryV11,
  assetKey,
  latestByKeyframe,
  selectZoneCandidate,
  locationBindingMap,
  uniqueZoneBindings,
  candidateRank,
  fileExists,
  fileSha256,
  safeSegment
};
