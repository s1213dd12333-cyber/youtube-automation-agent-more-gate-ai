'use strict';

const crypto = require('crypto');

const VERSION = '11.10.1';

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, '_') || 'object';
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
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

function unique(values = [], limit = 64) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw, 240);
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeObjectType(value) {
  const type = normalize(value);
  return type ? slug(type) : 'object';
}

function isPersistentMarker(value) {
  if (value === true) return true;
  const text = normalize(value);
  return ['persistent', 'world', 'global', 'canonical', 'cross video', 'cross_video'].includes(text);
}

function propLockIsPersistent(lock = {}) {
  return lock.worldPersistent === true || lock.persistent === true || lock.crossVideo === true ||
    isPersistentMarker(lock.persistence) || isPersistentMarker(lock.scope) || isPersistentMarker(lock.continuityScope);
}

function normalizeObjectCandidate(raw, options = {}) {
  if (!raw) return null;
  const sourceKind = options.sourceKind || 'explicit_world_object';
  const environmentId = clean(options.environmentId || raw.environmentId || '', 240) || null;
  const explicitObjectKey = clean(raw.objectKey || raw.persistentObjectKey || raw.worldObjectKey || raw.canonicalObjectKey || raw.key || '', 240) || null;
  const ownerKey = clean(raw.ownerKey || raw.ownerId || raw.owner || '', 240) || null;
  const attributes = raw.lockedAttributes && typeof raw.lockedAttributes === 'object' ? raw.lockedAttributes : {};
  const displayName = clean(raw.displayName || raw.name || attributes.identity || raw.originalName || explicitObjectKey || '', 240);
  if (!displayName) return null;
  if (raw.temporary === true || raw.ephemeral === true || normalize(raw.scope) === 'scene' || raw.persistent === false) return null;

  const distinguishingMarks = unique([
    ...(Array.isArray(raw.distinguishingMarks) ? raw.distinguishingMarks : []),
    ...(Array.isArray(raw.signatureElements) ? raw.signatureElements : []),
    ...(Array.isArray(raw.identityMarks) ? raw.identityMarks : [])
  ]);

  return {
    sourceKind,
    sourceRef: clean(raw.id || raw.sourceRef || '', 240) || null,
    environmentId,
    explicitObjectKey,
    ownerKey,
    displayName,
    objectType: normalizeObjectType(raw.objectType || raw.type || attributes.type || 'object'),
    brand: clean(raw.brand || attributes.brand || '', 160) || null,
    model: clean(raw.model || attributes.model || '', 160) || null,
    color: clean(raw.color || attributes.color || '', 160) || null,
    material: clean(raw.material || attributes.material || '', 160) || null,
    silhouette: clean(raw.silhouette || attributes.silhouette || '', 500) || null,
    distinguishingMarks,
    description: clean(raw.description || raw.sourceEvidence || '', 1600) || null,
    locationId: clean(options.locationId || raw.locationId || '', 240) || null,
    zoneId: clean(options.zoneId || raw.zoneId || '', 240) || null,
    zoneKey: clean(raw.zoneKey || raw.zone || raw.room || '', 160) || null,
    propLockId: options.propLockId || raw.propLockId || (sourceKind === 'persistent_prop_lock' ? raw.id : null) || null
  };
}

function candidateFromPropLock(lock = {}) {
  if (!lock?.id || !propLockIsPersistent(lock)) return null;
  return normalizeObjectCandidate(lock, {
    sourceKind: 'persistent_prop_lock',
    environmentId: lock.environmentId,
    propLockId: lock.id
  });
}

function explicitObjectsForEnvironment(environment = {}) {
  const groups = [
    ['persistentObjects', environment.persistentObjects],
    ['worldObjects', environment.worldObjects],
    ['canonicalObjects', environment.canonicalObjects]
  ];
  const out = [];
  for (const [field, values] of groups) {
    for (const raw of Array.isArray(values) ? values : []) {
      const normalized = typeof raw === 'string' ? { name: raw } : raw;
      const candidate = normalizeObjectCandidate(normalized, {
        sourceKind: `environment_${field}`,
        environmentId: environment.environmentId
      });
      if (candidate) out.push(candidate);
    }
  }
  return out;
}

function locationForEnvironment(locationBindings = [], environmentId = null) {
  if (!environmentId) return null;
  for (const item of Array.isArray(locationBindings) ? locationBindings : []) {
    const location = item?.location || item;
    const usage = item?.usage || location?.usage;
    if (location?.id && usage?.environmentId === environmentId) return location;
  }
  return null;
}

function zoneForCandidate(zoneBindings = [], candidate = {}) {
  if (!candidate?.zoneKey && !candidate?.zoneId) return null;
  const wantedKey = normalize(candidate.zoneKey).replace(/\s+/g, '_');
  for (const item of Array.isArray(zoneBindings) ? zoneBindings : []) {
    const zone = item?.zone || item;
    if (!zone?.id) continue;
    if (candidate.locationId && zone.locationId && zone.locationId !== candidate.locationId) continue;
    if (candidate.zoneId && zone.id === candidate.zoneId) return zone;
    if (wantedKey && normalize(zone.zoneKey).replace(/\s+/g, '_') === wantedKey) return zone;
  }
  return null;
}

function objectIdentity(candidate = {}, context = {}) {
  const explicitKey = normalize(candidate.explicitObjectKey);
  const ownerKey = normalize(candidate.ownerKey);
  const locationId = clean(context.locationId || candidate.locationId || '', 240) || null;
  const scopeKind = explicitKey ? 'explicit_object_key' : ownerKey ? 'owner' : locationId ? 'location' : 'namespace';
  const scopeAnchor = explicitKey || ownerKey || locationId || clean(context.namespace || 'default', 240);
  return {
    scopeKind,
    scopeAnchor,
    identityName: explicitKey ? '' : normalize(candidate.displayName),
    objectType: normalizeObjectType(candidate.objectType),
    brand: normalize(candidate.brand),
    model: normalize(candidate.model),
    color: normalize(candidate.color),
    material: normalize(candidate.material),
    silhouette: normalize(candidate.silhouette),
    distinguishingMarks: unique(candidate.distinguishingMarks || []).map(normalize).filter(Boolean).sort()
  };
}

function objectIdentityFingerprint(candidate = {}, context = {}) {
  return hash(stableJson(objectIdentity(candidate, context)));
}

function objectKeyFor(candidate = {}, fingerprint = '') {
  if (candidate.explicitObjectKey) return slug(candidate.explicitObjectKey);
  return `${slug(candidate.displayName)}_${String(fingerprint).slice(0, 10)}`;
}

function objectPromptContext(object = {}) {
  const identity = object.canonicalIdentity || {};
  return [
    `PERSISTENT WORLD OBJECT V${VERSION}:`,
    `OBJECT ID: ${object.id || 'pending'}`,
    `OBJECT KEY: ${object.objectKey || 'pending'}`,
    `NAME: ${object.displayName || identity.identityName || 'object'}`,
    `TYPE: ${object.objectType || identity.objectType || 'object'}`,
    `BRAND/MODEL: ${identity.brand || 'unspecified'} / ${identity.model || 'unspecified'}`,
    `COLOR/MATERIAL: ${identity.color || 'preserve once established'} / ${identity.material || 'preserve once established'}`,
    `FORM: ${identity.silhouette || 'preserve the same recognizable form and proportions'}`,
    `DISTINGUISHING MARKS: ${(identity.distinguishingMarks || []).join(', ') || 'none specified'}`,
    '',
    'PERSISTENT OBJECT RULES:',
    '- reuse this object identity across later videos when the same world object is referenced;',
    '- location and zone are usage context, not the global object identity when an explicit object key or owner exists;',
    '- do not promote temporary scene props from Temporary State Layers into this registry;',
    '- temporary condition, damage, open/closed state, contents, lighting and momentary placement must not rewrite canonical identity;',
    '- do not silently replace this object with a different object that merely has the same generic type.'
  ].join('\n').slice(0, 12000);
}

function dedupeCandidates(candidates = []) {
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = [candidate.environmentId || '', candidate.explicitObjectKey || '', candidate.ownerKey || '', normalize(candidate.displayName), candidate.propLockId || ''].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

class PersistentWorldObjectRegistryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_WORLD_OBJECTS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.namespace = clean(options.namespace ?? process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE ?? process.env.REUSABLE_LOCATION_NAMESPACE ?? 'default', 160) || 'default';
  }

  async registerCandidate(production = {}, candidate = {}, locationBindings = [], zoneBindings = []) {
    if (!this.enabled || !production?.id || !candidate?.displayName) return null;
    const location = candidate.locationId ? { id: candidate.locationId } : locationForEnvironment(locationBindings, candidate.environmentId);
    const scopedCandidate = { ...candidate, locationId: location?.id || candidate.locationId || null };
    const zone = zoneForCandidate(zoneBindings, scopedCandidate);
    const context = { namespace: this.namespace, locationId: location?.id || null };
    const identity = objectIdentity(scopedCandidate, context);
    const fingerprint = objectIdentityFingerprint(scopedCandidate, context);
    let existing = this.db?.getPersistentWorldObjectByFingerprint ? await this.db.getPersistentWorldObjectByFingerprint(this.namespace, fingerprint) : null;
    if (!existing && candidate.explicitObjectKey && this.db?.getPersistentWorldObjectByKey) {
      const keyExisting = await this.db.getPersistentWorldObjectByKey(this.namespace, slug(candidate.explicitObjectKey));
      if (keyExisting && keyExisting.identityFingerprint !== fingerprint) {
        this.logger.warn(`Persistent World Objects v${VERSION}: explicit object key ${candidate.explicitObjectKey} conflicts with existing canonical identity ${keyExisting.id}; refusing silent mutation.`);
        return { status: 'identity_conflict', object: null, usage: null, reused: false, conflict: true, existingObject: keyExisting, candidateFingerprint: fingerprint, reason: 'explicit_object_key_identity_conflict' };
      }
      existing = keyExisting || null;
    }
    const id = existing?.id || `world_object_${hash(`${this.namespace}:${fingerprint}`).slice(0, 20)}`;
    const objectKey = existing?.objectKey || objectKeyFor(candidate, fingerprint);
    const draft = {
      id,
      namespace: this.namespace,
      objectKey,
      displayName: existing?.displayName || candidate.displayName,
      objectType: candidate.objectType || existing?.objectType || 'object',
      version: VERSION,
      identityFingerprint: existing?.identityFingerprint || fingerprint,
      canonicalIdentity: existing?.canonicalIdentity || identity,
      canonicalPromptContext: existing?.canonicalPromptContext || '',
      canonicalLocationId: existing?.canonicalLocationId || location?.id || null,
      canonicalZoneId: existing?.canonicalZoneId || zone?.id || null,
      canonicalPropLockId: existing?.canonicalPropLockId || candidate.propLockId || null,
      status: existing?.status || 'registered',
      createdFromProductionId: existing?.createdFromProductionId || production.id
    };
    draft.canonicalPromptContext = existing?.canonicalPromptContext || objectPromptContext(draft);
    const saved = this.db?.savePersistentWorldObject ? await this.db.savePersistentWorldObject(draft) : draft;
    const scopeKey = candidate.environmentId || zone?.id || location?.id || 'production';
    const usage = this.db?.savePersistentWorldObjectUsage ? await this.db.savePersistentWorldObjectUsage({
      objectId: saved.id,
      productionId: production.id,
      scopeKey,
      environmentId: candidate.environmentId || null,
      sceneId: null,
      locationId: location?.id || null,
      zoneId: zone?.id || null,
      propLockId: candidate.propLockId || null,
      sourceKind: candidate.sourceKind || 'explicit_world_object',
      sourceRef: candidate.sourceRef || null,
      matchMode: existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register',
      identityFingerprint: saved.identityFingerprint
    }) : null;
    return { object: saved, usage, reused: Boolean(existing), matchMode: existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register' };
  }

  collectCandidates(environmentBible = null, propLocks = []) {
    const candidates = [];
    for (const environment of environmentBible?.environments || []) candidates.push(...explicitObjectsForEnvironment(environment));
    for (const raw of environmentBible?.persistentObjects || []) {
      const candidate = normalizeObjectCandidate(typeof raw === 'string' ? { name: raw } : raw, { sourceKind: 'environment_bible_persistent_object' });
      if (candidate) candidates.push(candidate);
    }
    for (const lock of Array.isArray(propLocks) ? propLocks : []) {
      const candidate = candidateFromPropLock(lock);
      if (candidate) candidates.push(candidate);
    }
    return dedupeCandidates(candidates);
  }

  async ensureProductionObjects(production = {}, environmentBible = null, propLocks = [], locationBindings = [], zoneBindings = []) {
    if (!this.enabled || !production?.id) {
      return { version: VERSION, active: this.enabled, productionId: production?.id || null, objects: [], summary: { total: 0, registered: 0, reused: 0 } };
    }
    const candidates = this.collectCandidates(environmentBible, propLocks);
    const objects = [];
    for (const candidate of candidates) {
      const result = await this.registerCandidate(production, candidate, locationBindings, zoneBindings);
      if (result) objects.push(result);
    }
    const summary = {
      total: objects.length,
      registered: objects.filter(item => item.object && !item.reused).length,
      reused: objects.filter(item => item.object && item.reused).length,
      conflicts: objects.filter(item => item.conflict === true).length
    };
    this.logger.info(`Persistent World Objects v${VERSION}: total=${summary.total}, registered=${summary.registered}, reused=${summary.reused}, conflicts=${summary.conflicts}.`);
    return { version: VERSION, active: true, productionId: production.id, objects, summary };
  }
}

module.exports = {
  PERSISTENT_WORLD_OBJECT_VERSION: VERSION,
  PersistentWorldObjectRegistryV11,
  normalize,
  slug,
  stableJson,
  normalizeObjectType,
  propLockIsPersistent,
  normalizeObjectCandidate,
  candidateFromPropLock,
  explicitObjectsForEnvironment,
  locationForEnvironment,
  zoneForCandidate,
  objectIdentity,
  objectIdentityFingerprint,
  objectKeyFor,
  objectPromptContext,
  dedupeCandidates
};
