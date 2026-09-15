'use strict';

const VERSION = '11.10.2';

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

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => clean(value, 240)).filter(Boolean))];
}

const GENERIC_WORDS = new Set([
  'the','a','an','this','that','their','his','her','our','my','your','its','family','families',
  'o','a','os','as','um','uma','este','esta','esse','essa','aquele','aquela','seu','sua','dele','dela','nosso','nossa','familia','de','da','do','das','dos'
]);

const TYPE_SYNONYMS = new Map([
  ['car', 'vehicle'], ['vehicle', 'vehicle'], ['automobile', 'vehicle'], ['auto', 'vehicle'], ['carro', 'vehicle'], ['veiculo', 'vehicle'],
  ['truck', 'vehicle'], ['van', 'vehicle'], ['motorcycle', 'vehicle'], ['moto', 'vehicle'],
  ['sword', 'weapon'], ['espada', 'weapon'], ['weapon', 'weapon'], ['arma', 'weapon'],
  ['phone', 'phone'], ['smartphone', 'phone'], ['telephone', 'phone'], ['telefone', 'phone'], ['celular', 'phone'],
  ['television', 'television'], ['tv', 'television'], ['televisao', 'television'],
  ['sofa', 'furniture'], ['couch', 'furniture'], ['chair', 'furniture'], ['cadeira', 'furniture'], ['table', 'furniture'], ['mesa', 'furniture'],
  ['book', 'book'], ['livro', 'book'], ['necklace', 'jewelry'], ['colar', 'jewelry'], ['ring', 'jewelry'], ['anel', 'jewelry']
]);

function normalizeType(value) {
  const key = normalize(value);
  return TYPE_SYNONYMS.get(key) || slug(key || 'object');
}

function typeForReference(referenceText = '', fallback = 'object') {
  const tokens = normalize(referenceText).split(' ').filter(Boolean);
  for (const token of tokens) if (TYPE_SYNONYMS.has(token)) return TYPE_SYNONYMS.get(token);
  return normalizeType(fallback);
}

function referenceDescriptor(referenceText = '', fallbackType = 'object') {
  const normalized = normalize(referenceText);
  const tokens = normalized.split(' ').filter(Boolean);
  const requestedType = typeForReference(referenceText, fallbackType);
  const typeTokens = new Set([...TYPE_SYNONYMS.entries()].filter(([, type]) => type === requestedType).map(([token]) => token));
  const significant = tokens.filter(token => !GENERIC_WORDS.has(token) && !typeTokens.has(token));
  const generic = significant.length === 0;
  return {
    text: clean(referenceText, 1000),
    key: normalized,
    requestedType,
    generic,
    significant
  };
}

function candidateAliases(candidate = {}) {
  const aliases = unique([
    candidate.displayName,
    candidate.explicitObjectKey ? candidate.explicitObjectKey.replace(/[_-]+/g, ' ') : '',
    ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])
  ]);
  return aliases.map(text => ({ text, key: normalize(text) })).filter(item => item.key);
}

function canonicalAliases(object = {}) {
  const aliases = unique([
    object.displayName,
    object.objectKey ? String(object.objectKey).replace(/[_-]+/g, ' ') : ''
  ]);
  return aliases.map(text => ({ text, key: normalize(text) })).filter(item => item.key);
}

function objectScopeCompatible(object = {}, candidate = {}, context = {}) {
  const identity = object.canonicalIdentity || {};
  const scopeKind = identity.scopeKind || null;
  const scopeAnchor = identity.scopeAnchor || null;
  const owner = normalize(candidate.ownerKey);
  const explicitKey = normalize(candidate.explicitObjectKey);
  const locationId = clean(context.locationId || candidate.locationId || '', 240) || null;

  if (scopeKind === 'explicit_object_key') {
    if (explicitKey) return scopeAnchor === explicitKey;
    return true;
  }
  if (scopeKind === 'owner') return Boolean(owner && scopeAnchor === owner);
  if (scopeKind === 'location') return Boolean(locationId && scopeAnchor === locationId);
  return true;
}

function compatibleCanonicalIdentity(object = {}, candidate = {}, context = {}) {
  if (!objectScopeCompatible(object, candidate, context)) return { compatible: false, reason: 'scope_mismatch' };
  const identity = object.canonicalIdentity || {};
  const checks = [
    ['objectType', normalizeType(candidate.objectType), normalizeType(object.objectType || identity.objectType)],
    ['brand', normalize(candidate.brand), normalize(identity.brand)],
    ['model', normalize(candidate.model), normalize(identity.model)],
    ['color', normalize(candidate.color), normalize(identity.color)],
    ['material', normalize(candidate.material), normalize(identity.material)],
    ['silhouette', normalize(candidate.silhouette), normalize(identity.silhouette)]
  ];
  const mismatches = [];
  for (const [field, incoming, canonical] of checks) {
    if (!incoming || incoming === 'object') continue;
    if (field === 'objectType' && canonical && canonical !== 'object' && incoming !== canonical) mismatches.push(field);
    else if (field !== 'objectType' && canonical && incoming !== canonical) mismatches.push(field);
  }
  const incomingMarks = new Set((candidate.distinguishingMarks || []).map(normalize).filter(Boolean));
  const canonicalMarks = new Set((identity.distinguishingMarks || []).map(normalize).filter(Boolean));
  if (incomingMarks.size && canonicalMarks.size) {
    for (const mark of incomingMarks) if (!canonicalMarks.has(mark)) mismatches.push('distinguishingMarks');
  }
  return { compatible: mismatches.length === 0, reason: mismatches.length ? `canonical_attribute_mismatch:${[...new Set(mismatches)].join('|')}` : null };
}

function objectTypeCompatible(object = {}, requestedType = 'object') {
  const wanted = normalizeType(requestedType);
  if (!wanted || wanted === 'object') return true;
  const actual = normalizeType(object.objectType || object.canonicalIdentity?.objectType || 'object');
  return actual === wanted;
}

async function uniqueObjectsForAliases(db, namespace, aliasKey) {
  if (!db?.listPersistentWorldObjectAliasesByKey) return [];
  const rows = await db.listPersistentWorldObjectAliasesByKey(namespace, aliasKey);
  const seen = new Set();
  const objects = [];
  for (const row of rows || []) {
    const objectId = row.objectId || row.object?.id;
    if (!objectId || seen.has(objectId)) continue;
    const object = row.object || (db.getPersistentWorldObject ? await db.getPersistentWorldObject(objectId) : null);
    if (!object) continue;
    seen.add(objectId);
    objects.push(object);
  }
  return objects;
}

class PersistentWorldObjectResolverV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_WORLD_OBJECT_RESOLVER_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.allowContextualGeneric = String(options.allowContextualGeneric ?? process.env.PERSISTENT_WORLD_OBJECT_RESOLVER_ALLOW_CONTEXTUAL_GENERIC ?? 'true').toLowerCase() !== 'false';
  }

  async persistResolution(input = {}, result = {}) {
    if (!this.db?.savePersistentWorldObjectResolution || !input.production?.id) return result;
    await this.db.savePersistentWorldObjectResolution({
      namespace: input.namespace || 'default',
      productionId: input.production.id,
      scopeKey: input.scopeKey || input.candidate?.environmentId || input.candidate?.sourceRef || 'production',
      referenceText: input.referenceText || input.candidate?.displayName || '',
      referenceKey: result.referenceKey || normalize(input.referenceText || input.candidate?.displayName || ''),
      requestedType: result.requestedType || normalizeType(input.candidate?.objectType || 'object'),
      status: result.status,
      objectId: result.object?.id || null,
      matchMode: result.matchMode || null,
      confidence: Number(result.confidence || 0),
      candidateObjectIds: (result.candidates || []).map(item => item.id || item.object?.id).filter(Boolean),
      reason: result.reason || null,
      identityFingerprint: input.identityFingerprint || null
    });
    return result;
  }

  async ensureAliases(object = {}, candidate = {}, sourceKind = 'object_registration') {
    if (!object?.id || !this.db?.savePersistentWorldObjectAlias) return [];
    const aliases = [...canonicalAliases(object), ...candidateAliases(candidate)];
    const seen = new Set();
    const saved = [];
    for (const alias of aliases) {
      if (!alias.key || seen.has(alias.key)) continue;
      seen.add(alias.key);
      const row = await this.db.savePersistentWorldObjectAlias({
        namespace: object.namespace || 'default',
        objectId: object.id,
        aliasText: alias.text,
        aliasKey: alias.key,
        canonical: normalize(alias.text) === normalize(object.displayName) || normalize(alias.text) === normalize(String(object.objectKey || '').replace(/[_-]+/g, ' ')),
        sourceKind
      });
      if (row) saved.push(row);
    }
    return saved;
  }

  async recordRegistration(input = {}, object = null, candidate = {}) {
    if (!object) return null;
    await this.ensureAliases(object, candidate, 'registered_new');
    return this.persistResolution(input, {
      status: 'registered_new', object, matchMode: 'resolver_unresolved_register_new', confidence: 1,
      referenceKey: normalize(input.referenceText || candidate.displayName || ''), requestedType: normalizeType(candidate.objectType || object.objectType || 'object'),
      candidates: [], reason: 'no_safe_existing_object_match'
    });
  }

  async resolveCandidate(input = {}) {
    const namespace = input.namespace || 'default';
    const candidate = input.candidate || {};
    const referenceText = input.referenceText || candidate.displayName || candidate.explicitObjectKey || '';
    const descriptor = referenceDescriptor(referenceText, candidate.objectType || 'object');
    const base = { version: VERSION, active: this.enabled, referenceKey: descriptor.key, requestedType: descriptor.requestedType };

    if (!this.enabled) return { ...base, status: 'unresolved', object: null, candidates: [], matchMode: null, confidence: 0, reason: 'resolver_disabled' };
    if (!referenceText) return this.persistResolution(input, { ...base, status: 'unresolved', object: null, candidates: [], confidence: 0, reason: 'reference_missing' });

    if (candidate.explicitObjectKey && this.db?.getPersistentWorldObjectByKey) {
      const exactKey = await this.db.getPersistentWorldObjectByKey(namespace, slug(candidate.explicitObjectKey));
      if (exactKey) {
        const compatible = compatibleCanonicalIdentity(exactKey, candidate, input);
        const result = compatible.compatible
          ? { ...base, status: 'resolved', object: exactKey, candidates: [exactKey], matchMode: 'object_key_exact', confidence: 1, reason: 'explicit_object_key_exact' }
          : { ...base, status: 'conflict', object: null, candidates: [exactKey], matchMode: 'object_key_conflict', confidence: 1, reason: compatible.reason };
        await this.persistResolution(input, result);
        return result;
      }
    }

    const aliasObjects = await uniqueObjectsForAliases(this.db, namespace, descriptor.key);
    const aliasCompatible = aliasObjects.filter(object => objectTypeCompatible(object, descriptor.requestedType) && compatibleCanonicalIdentity(object, candidate, input).compatible);
    if (aliasCompatible.length === 1) {
      const result = { ...base, status: 'resolved', object: aliasCompatible[0], candidates: aliasCompatible, matchMode: 'object_alias_exact', confidence: 0.99, reason: 'persisted_alias_exact' };
      await this.persistResolution(input, result);
      return result;
    }
    if (aliasCompatible.length > 1) {
      const result = { ...base, status: 'ambiguous', object: null, candidates: aliasCompatible, matchMode: 'object_alias_ambiguous', confidence: 0, reason: 'alias_points_to_multiple_compatible_objects' };
      await this.persistResolution(input, result);
      return result;
    }

    const objects = this.db?.listPersistentWorldObjects ? await this.db.listPersistentWorldObjects(namespace) : [];
    const exactNamed = (objects || []).filter(object => {
      if (!objectTypeCompatible(object, descriptor.requestedType)) return false;
      if (!compatibleCanonicalIdentity(object, candidate, input).compatible) return false;
      return normalize(object.displayName) === descriptor.key || normalize(String(object.objectKey || '').replace(/[_-]+/g, ' ')) === descriptor.key;
    });
    if (exactNamed.length === 1) {
      const result = { ...base, status: 'resolved', object: exactNamed[0], candidates: exactNamed, matchMode: 'object_name_type_exact', confidence: 0.97, reason: 'normalized_name_type_exact' };
      await this.persistResolution(input, result);
      return result;
    }
    if (exactNamed.length > 1) {
      const result = { ...base, status: 'ambiguous', object: null, candidates: exactNamed, matchMode: 'object_name_ambiguous', confidence: 0, reason: 'normalized_name_matches_multiple_objects' };
      await this.persistResolution(input, result);
      return result;
    }

    if (descriptor.generic && this.allowContextualGeneric) {
      const compatible = (objects || []).filter(object => objectTypeCompatible(object, descriptor.requestedType) && compatibleCanonicalIdentity(object, candidate, input).compatible);
      if (compatible.length === 1) {
        const result = { ...base, status: 'resolved', object: compatible[0], candidates: compatible, matchMode: 'object_context_unique', confidence: 0.84, reason: 'single_compatible_generic_candidate' };
        await this.persistResolution(input, result);
        return result;
      }
      if (compatible.length > 1) {
        const result = { ...base, status: 'ambiguous', object: null, candidates: compatible, matchMode: 'object_context_ambiguous', confidence: 0, reason: 'multiple_compatible_generic_candidates' };
        await this.persistResolution(input, result);
        return result;
      }
    }

    const result = { ...base, status: 'unresolved', object: null, candidates: [], matchMode: null, confidence: 0, reason: descriptor.generic ? 'no_unique_contextual_candidate' : 'no_exact_alias_or_name_match' };
    await this.persistResolution(input, result);
    return result;
  }
}

module.exports = {
  PERSISTENT_WORLD_OBJECT_RESOLVER_VERSION: VERSION,
  PersistentWorldObjectResolverV11,
  normalize,
  slug,
  normalizeType,
  typeForReference,
  referenceDescriptor,
  candidateAliases,
  canonicalAliases,
  objectScopeCompatible,
  compatibleCanonicalIdentity,
  objectTypeCompatible,
  uniqueObjectsForAliases
};
