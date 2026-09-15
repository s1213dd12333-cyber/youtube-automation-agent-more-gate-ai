'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.9.1';

function clean(value, limit = 6000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slug(value) {
  return clean(value, 160)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'location';
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function uniqueSorted(values = [], limit = 40) {
  const map = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw, 240);
    if (!value) continue;
    const key = value.toLowerCase();
    if (!map.has(key)) map.set(key, value);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableObject(value[key]);
    return out;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function propSnapshot(propLocks = [], environmentId = null) {
  return (Array.isArray(propLocks) ? propLocks : [])
    .filter(lock => lock && (!environmentId || lock.environmentId === environmentId) && lock.required === true)
    .map(lock => ({
      id: lock.id || null,
      name: clean(lock.name || lock.originalName || 'prop', 180),
      type: clean(lock.type || 'prop', 80),
      continuityPriority: clean(lock.continuityPriority || 'normal', 80),
      lockedAttributes: {
        color: clean(lock.lockedAttributes?.color || '', 120) || null,
        material: clean(lock.lockedAttributes?.material || '', 120) || null,
        silhouette: clean(lock.lockedAttributes?.silhouette || '', 240) || null,
        relativePlacement: clean(lock.lockedAttributes?.relativePlacement || '', 300) || null
      },
      forbiddenChanges: uniqueSorted(lock.forbiddenChanges || [], 12)
    }))
    .sort((a, b) => String(a.id || a.name).localeCompare(String(b.id || b.name)));
}

function buildLocationIdentity(environment = {}, propLocks = []) {
  const environmentId = environment.environmentId || environment.id || null;
  const stableProps = propSnapshot(propLocks, environmentId).map(item => ({
    name: item.name,
    type: item.type,
    lockedAttributes: item.lockedAttributes,
    forbiddenChanges: item.forbiddenChanges
  }));
  return {
    category: clean(environment.category || 'location', 100),
    name: clean(environment.name || environment.category || 'Location', 180),
    construction: clean(environment.construction || '', 500),
    architecturalStyle: clean(environment.architecturalStyle || '', 500),
    materials: uniqueSorted(environment.materials || [], 16),
    palette: uniqueSorted(environment.palette || [], 16),
    layout: clean(environment.layout || '', 1200),
    signatureElements: uniqueSorted(environment.signatureElements || [], 32),
    forbiddenChanges: uniqueSorted(environment.forbiddenChanges || [], 24),
    requiredProps: stableProps
  };
}

function identityFingerprint(environment = {}, propLocks = []) {
  return hash(stableJson(buildLocationIdentity(environment, propLocks)));
}

function locationKeyFor(environment = {}, fingerprint = '') {
  const explicit = clean(
    environment.reusableLocationKey || environment.locationKey || environment.canonicalLocationKey || '',
    180
  );
  if (explicit) return slug(explicit);
  const base = slug(environment.name || environment.category || 'location');
  return `${base}_${String(fingerprint || '').slice(0, 12)}`;
}

function canonicalPromptContext(identity = {}) {
  return [
    `REUSABLE LOCATION V${VERSION}`,
    `NAME: ${identity.name || 'Location'}`,
    `TYPE: ${identity.category || 'location'}`,
    `CONSTRUCTION: ${identity.construction || 'unspecified'}`,
    `ARCHITECTURAL STYLE: ${identity.architecturalStyle || 'unspecified'}`,
    `MATERIALS: ${(identity.materials || []).join(', ') || 'unspecified'}`,
    `PALETTE: ${(identity.palette || []).join(', ') || 'unspecified'}`,
    `LAYOUT IDENTITY: ${identity.layout || 'unspecified'}`,
    `SIGNATURE ELEMENTS: ${(identity.signatureElements || []).join(', ') || 'unspecified'}`,
    `REQUIRED PROPS: ${(identity.requiredProps || []).map(item => item.name).join(', ') || 'none'}`,
    `FORBIDDEN CHANGES: ${(identity.forbiddenChanges || []).join(' | ') || 'none'}`,
    'This identity is production-independent. Do not inject time of day, weather, temporary clutter, characters, or shot-specific camera language into the canonical location identity.'
  ].join('\n').slice(0, 20000);
}

function frameForEnvironment(masterFrames = [], environmentId = null) {
  return (Array.isArray(masterFrames) ? masterFrames : []).find(frame =>
    frame && frame.environmentId === environmentId && frame.canonical === true && frame.status === 'ready'
  ) || null;
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

function extensionFor(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|svg)$/.test(ext)) return ext;
  return '.png';
}

class ReusableLocationLibraryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.REUSABLE_LOCATION_LIBRARY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.namespace = slug(options.namespace ?? process.env.REUSABLE_LOCATION_NAMESPACE ?? 'default');
    this.dataRoot = options.dataRoot || path.join(process.cwd(), 'data');
  }

  async persistCanonicalAsset(locationId, masterFrame = {}, existing = null) {
    if (existing?.canonicalMasterFramePath && await fileExists(existing.canonicalMasterFramePath)) {
      return {
        path: existing.canonicalMasterFramePath,
        sha256: existing.canonicalMasterFrameSha256 || null,
        sourceMasterFrameId: existing.canonicalMasterFrameId || null,
        copied: false,
        available: true
      };
    }

    const source = masterFrame?.masterFramePath;
    if (!masterFrame || masterFrame.canonical !== true || masterFrame.status !== 'ready' || !await fileExists(source)) {
      return { path: null, sha256: null, sourceMasterFrameId: null, copied: false, available: false };
    }

    const dir = path.join(this.dataRoot, 'assets', 'location-library', this.namespace, locationId);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `master${extensionFor(source)}`);
    const bytes = await fs.readFile(source);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    let shouldWrite = true;
    try {
      const current = await fs.readFile(target);
      shouldWrite = crypto.createHash('sha256').update(current).digest('hex') !== digest;
    } catch (_error) {}
    if (shouldWrite) await fs.writeFile(target, bytes);
    return { path: target, sha256: digest, sourceMasterFrameId: masterFrame.id || null, copied: shouldWrite, available: true };
  }

  async registerEnvironment(production = {}, environment = {}, masterFrames = [], propLocks = []) {
    if (!this.enabled || !production?.id || !environment?.environmentId) return null;
    const identity = buildLocationIdentity(environment, propLocks);
    const fingerprint = hash(stableJson(identity));
    const locationKey = locationKeyFor(environment, fingerprint);
    const existing = await this.db.getReusableLocationByFingerprint(this.namespace, fingerprint);
    const locationId = existing?.id || `location_${hash(`${this.namespace}:${fingerprint}`).slice(0, 18)}`;
    const masterFrame = frameForEnvironment(masterFrames, environment.environmentId);
    const canonicalAsset = await this.persistCanonicalAsset(locationId, masterFrame, existing);
    const canonicalStatus = canonicalAsset.available ? 'canonical_ready' : (existing?.canonicalMasterFramePath ? 'canonical_missing' : 'registered_unanchored');
    const now = new Date().toISOString();
    const location = await this.db.saveReusableLocation({
      id: locationId,
      namespace: this.namespace,
      locationKey: existing?.locationKey || locationKey,
      displayName: existing?.displayName || identity.name,
      locationType: existing?.locationType || identity.category,
      version: VERSION,
      identityFingerprint: fingerprint,
      canonicalIdentity: existing?.canonicalIdentity || identity,
      canonicalPromptContext: existing?.canonicalPromptContext || canonicalPromptContext(identity),
      canonicalEnvironmentId: existing?.canonicalEnvironmentId || environment.environmentId,
      canonicalEnvironmentFingerprint: existing?.canonicalEnvironmentFingerprint || environment.fingerprint || null,
      canonicalMasterFrameId: canonicalAsset.sourceMasterFrameId || existing?.canonicalMasterFrameId || null,
      canonicalMasterFramePath: canonicalAsset.path || existing?.canonicalMasterFramePath || null,
      canonicalMasterFrameSha256: canonicalAsset.sha256 || existing?.canonicalMasterFrameSha256 || null,
      propLockSnapshot: existing?.propLockSnapshot || identity.requiredProps,
      status: canonicalStatus,
      createdFromProductionId: existing?.createdFromProductionId || production.id,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      createdAt: existing?.createdAt || now
    });

    const usage = await this.db.saveReusableLocationUsage({
      locationId: location.id,
      productionId: production.id,
      environmentId: environment.environmentId,
      environmentFingerprint: environment.fingerprint || null,
      masterFrameId: masterFrame?.id || null,
      masterFramePath: masterFrame?.masterFramePath || null,
      masterFrameSha256: masterFrame?.assetSha256 || null,
      matchMode: existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register',
      createdAt: now
    });

    return {
      location,
      usage,
      reused: Boolean(existing),
      matchMode: usage?.matchMode || (existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register')
    };
  }

  async ensureProductionLocations(production = {}, environmentBible = {}, masterFrames = [], propLocks = []) {
    const environments = Array.isArray(environmentBible?.environments) ? environmentBible.environments : [];
    if (!this.enabled || !production?.id || !environments.length) {
      return { version: VERSION, active: this.enabled, namespace: this.namespace, locations: [], summary: { total: 0, registered: 0, reused: 0, canonicalReady: 0 } };
    }

    const locations = [];
    for (const environment of environments) {
      const result = await this.registerEnvironment(production, environment, masterFrames, propLocks);
      if (result) locations.push(result);
    }
    return {
      version: VERSION,
      active: true,
      namespace: this.namespace,
      locations,
      summary: {
        total: locations.length,
        registered: locations.filter(item => !item.reused).length,
        reused: locations.filter(item => item.reused).length,
        canonicalReady: locations.filter(item => item.location?.status === 'canonical_ready').length
      }
    };
  }
}

module.exports = {
  REUSABLE_LOCATION_LIBRARY_VERSION: VERSION,
  ReusableLocationLibraryV11,
  buildLocationIdentity,
  identityFingerprint,
  locationKeyFor,
  canonicalPromptContext,
  propSnapshot,
  frameForEnvironment,
  stableJson,
  slug
};
