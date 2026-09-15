'use strict';

const crypto = require('crypto');

const VERSION = '11.9.4';

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 2000)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, '_') || 'location';
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

const TYPE_TERMS = Object.freeze({
  dwelling: new Set(['house', 'home', 'residence', 'residential', 'casa', 'lar', 'moradia', 'apartamento', 'apartment']),
  school: new Set(['school', 'escola', 'classroom', 'colegio', 'college', 'campus']),
  workplace: new Set(['office', 'workplace', 'studio', 'escritorio', 'empresa', 'workshop', 'oficina']),
  outdoor: new Set(['park', 'garden', 'forest', 'beach', 'yard', 'jardim', 'floresta', 'praia', 'quintal']),
  commercial: new Set(['store', 'shop', 'market', 'restaurant', 'cafe', 'loja', 'mercado', 'restaurante'])
});

const GENERIC_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'their', 'his', 'her', 'our', 'my', 'your',
  'de', 'da', 'do', 'das', 'dos', 'uma', 'um', 'o', 'a', 'esta', 'essa', 'seu', 'sua', 'nosso', 'nossa',
  'family', 'familys', 'familia', 'familias', 'place', 'local', 'location'
]);

function normalizeLocationType(value) {
  const normalized = normalize(value);
  if (!normalized) return 'location';
  const words = normalized.split(' ');
  for (const [type, terms] of Object.entries(TYPE_TERMS)) {
    if (words.some(word => terms.has(word))) return type;
  }
  if (['room', 'indoor', 'interior'].some(word => words.includes(word))) return 'indoor';
  return slug(normalized);
}

function typeForReference(value, fallback = '') {
  const normalized = normalize(value);
  const words = normalized.split(' ').filter(Boolean);
  for (const [type, terms] of Object.entries(TYPE_TERMS)) {
    if (words.some(word => terms.has(word))) return type;
  }
  return normalizeLocationType(fallback);
}

function referenceDescriptor(value, fallbackType = '') {
  const normalized = normalize(value);
  const words = normalized.split(' ').filter(Boolean);
  const inferredType = typeForReference(normalized, fallbackType);
  const typeWords = new Set();
  for (const terms of Object.values(TYPE_TERMS)) for (const term of terms) typeWords.add(term);
  const ownerTokens = words.filter(word => !typeWords.has(word) && !GENERIC_WORDS.has(word));
  const core = [...new Set(ownerTokens)].sort().join(' ');
  const generic = !core;
  return {
    raw: clean(value, 500),
    normalized,
    type: inferredType || 'location',
    core,
    generic,
    key: `${core || '*'}::${inferredType || 'location'}`
  };
}

function explicitEnvironmentAliases(environment = {}) {
  const values = [
    environment.name,
    environment.locationName,
    environment.reusableLocationKey,
    environment.locationKey,
    environment.canonicalLocationKey,
    environment.ownerName,
    ...(Array.isArray(environment.aliases) ? environment.aliases : []),
    ...(Array.isArray(environment.locationAliases) ? environment.locationAliases : []),
    ...(Array.isArray(environment.aka) ? environment.aka : [])
  ];
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const text = clean(raw, 300);
    if (!text) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function aliasVariants(value, fallbackType = '') {
  const descriptor = referenceDescriptor(value, fallbackType);
  if (!descriptor.normalized) return [];
  const variants = new Set([descriptor.normalized]);
  if (!descriptor.generic && descriptor.type === 'dwelling') {
    for (const suffix of ['house', 'home', 'residence', 'casa', 'lar']) variants.add(`${descriptor.core} ${suffix}`);
  }
  return [...variants].map(item => normalize(item)).filter(Boolean);
}

function structuralIdentity(identity = {}) {
  return {
    category: normalizeLocationType(identity.category || identity.locationType || ''),
    construction: normalize(identity.construction || ''),
    architecturalStyle: normalize(identity.architecturalStyle || ''),
    materials: [...new Set((identity.materials || []).map(normalize).filter(Boolean))].sort(),
    palette: [...new Set((identity.palette || []).map(normalize).filter(Boolean))].sort(),
    layout: normalize(identity.layout || ''),
    signatureElements: [...new Set((identity.signatureElements || []).map(normalize).filter(Boolean))].sort(),
    requiredProps: (identity.requiredProps || []).map(item => ({
      name: normalize(item?.name || ''),
      type: normalize(item?.type || ''),
      color: normalize(item?.lockedAttributes?.color || ''),
      material: normalize(item?.lockedAttributes?.material || ''),
      silhouette: normalize(item?.lockedAttributes?.silhouette || ''),
      relativePlacement: normalize(item?.lockedAttributes?.relativePlacement || '')
    })).sort((a, b) => stableJson(a).localeCompare(stableJson(b)))
  };
}

function structuralFingerprint(identity = {}) {
  const structural = structuralIdentity(identity);
  const meaningful = Boolean(
    structural.construction || structural.architecturalStyle || structural.layout ||
    structural.materials.length || structural.palette.length || structural.signatureElements.length || structural.requiredProps.length
  );
  return meaningful ? hash(stableJson(structural)) : null;
}

function locationReferenceText(environment = {}) {
  return clean(
    environment.locationReference ||
    environment.locationName ||
    environment.name ||
    environment.reusableLocationKey ||
    environment.locationKey ||
    environment.category ||
    '',
    500
  );
}

function compatibleType(location = {}, requestedType = 'location') {
  const candidateType = normalizeLocationType(location.locationType || location.canonicalIdentity?.category || '');
  if (!requestedType || requestedType === 'location') return true;
  return candidateType === requestedType;
}

function candidateNameDescriptors(location = {}) {
  const values = [location.displayName, location.locationKey, location.canonicalIdentity?.name].filter(Boolean);
  return values.map(value => referenceDescriptor(value, location.locationType)).filter(item => item.normalized);
}

function uniqueLocationMatches(items = []) {
  const byId = new Map();
  for (const item of items) {
    const location = item?.location || item;
    if (!location?.id) continue;
    const current = byId.get(location.id);
    if (!current || Number(item.confidence || 0) > Number(current.confidence || 0)) byId.set(location.id, item.location ? item : { location, confidence: 0 });
  }
  return [...byId.values()];
}

class LocationResolverV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.REUSABLE_LOCATION_RESOLVER_ENABLED ?? 'true').toLowerCase() !== 'false';
    const configured = Number(options.minConfidence ?? process.env.REUSABLE_LOCATION_RESOLVER_MIN_CONFIDENCE ?? 0.82);
    this.minConfidence = Number.isFinite(configured) ? Math.max(0.7, Math.min(0.99, configured)) : 0.82;
    this.allowContextualGeneric = String(options.allowContextualGeneric ?? process.env.REUSABLE_LOCATION_RESOLVER_ALLOW_CONTEXTUAL_GENERIC ?? 'true').toLowerCase() !== 'false';
  }

  async aliasesByKey(namespace, aliasKey) {
    if (!this.db?.listReusableLocationAliasesByKey || !aliasKey) return [];
    return this.db.listReusableLocationAliasesByKey(namespace, aliasKey);
  }

  async ensureLocationAliases(location = {}, environment = {}) {
    if (!this.enabled || !location?.id || !this.db?.saveReusableLocationAlias) return [];
    const aliases = [];
    const canonicalValues = [location.displayName, location.locationKey, location.canonicalIdentity?.name].filter(Boolean);
    const environmentValues = explicitEnvironmentAliases(environment);
    const candidates = [
      ...canonicalValues.map(text => ({ text, sourceKind: 'canonical_location', canonical: true, confidence: 1 })),
      ...environmentValues.map(text => ({ text, sourceKind: 'observed_environment_reference', canonical: false, confidence: 0.95 }))
    ];
    const seen = new Set();
    for (const candidate of candidates) {
      for (const aliasKey of aliasVariants(candidate.text, location.locationType)) {
        const descriptor = referenceDescriptor(aliasKey, location.locationType);
        if (descriptor.generic) continue;
        const dedupe = `${location.id}:${aliasKey}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const saved = await this.db.saveReusableLocationAlias({
          namespace: location.namespace || 'default',
          locationId: location.id,
          aliasText: candidate.text,
          aliasKey,
          locationType: descriptor.type || normalizeLocationType(location.locationType),
          sourceKind: candidate.sourceKind,
          canonical: candidate.canonical,
          confidence: candidate.confidence
        });
        if (saved) aliases.push(saved);
      }
    }
    return aliases;
  }

  async persistResolution(input = {}, result = {}) {
    if (!this.db?.saveReusableLocationResolution) return null;
    return this.db.saveReusableLocationResolution({
      namespace: input.namespace || 'default',
      productionId: input.production?.id || null,
      environmentId: input.environment?.environmentId || input.environment?.id || null,
      referenceText: input.referenceText || locationReferenceText(input.environment || {}),
      referenceKey: result.referenceKey || null,
      requestedType: result.requestedType || null,
      status: result.status || 'unresolved',
      locationId: result.location?.id || null,
      matchMode: result.matchMode || null,
      confidence: Number(result.confidence || 0),
      candidateLocationIds: (result.candidates || []).map(item => item?.location?.id || item?.id).filter(Boolean),
      reason: result.reason || null,
      identityFingerprint: input.identityFingerprint || null
    });
  }

  async finish(input, result) {
    await this.persistResolution(input, result);
    return result;
  }

  async resolveEnvironment(input = {}) {
    const namespace = input.namespace || 'default';
    const environment = input.environment || {};
    const identity = input.identity || {};
    const referenceText = input.referenceText || locationReferenceText(environment);
    const descriptor = referenceDescriptor(referenceText, identity.category || environment.category || '');
    const requestedType = descriptor.type || normalizeLocationType(identity.category || environment.category || '');
    const base = { version: VERSION, active: this.enabled, referenceText, referenceKey: descriptor.key, requestedType };

    if (!this.enabled) return { ...base, status: 'disabled', location: null, matchMode: null, confidence: 0, candidates: [], reason: 'resolver_disabled' };

    const knownLocations = this.db?.listReusableLocations ? await this.db.listReusableLocations(namespace) : [];
    if (!knownLocations.length) {
      return this.finish(input, { ...base, status: 'unresolved', location: null, matchMode: null, confidence: 0, candidates: [], reason: 'library_empty' });
    }

    const aliasKeys = aliasVariants(referenceText, requestedType);
    const aliasHits = [];
    for (const aliasKey of aliasKeys) {
      const rows = await this.aliasesByKey(namespace, aliasKey);
      for (const row of rows) {
        const location = knownLocations.find(item => item.id === row.locationId) || (this.db?.getReusableLocation ? await this.db.getReusableLocation(row.locationId) : null);
        if (location && compatibleType(location, requestedType)) aliasHits.push({ location, confidence: Math.max(0.99, Number(row.confidence || 0)), source: row });
      }
    }
    const uniqueAliasHits = uniqueLocationMatches(aliasHits);
    if (uniqueAliasHits.length === 1 && uniqueAliasHits[0].confidence >= this.minConfidence) {
      return this.finish(input, { ...base, status: 'resolved', location: uniqueAliasHits[0].location, matchMode: 'alias_exact', confidence: uniqueAliasHits[0].confidence, candidates: uniqueAliasHits, reason: 'single_persisted_alias_match' });
    }
    if (uniqueAliasHits.length > 1) {
      return this.finish(input, { ...base, status: 'ambiguous', location: null, matchMode: 'alias_exact_ambiguous', confidence: 0, candidates: uniqueAliasHits, reason: 'alias_maps_to_multiple_locations' });
    }

    if (!descriptor.generic) {
      const nameHits = [];
      for (const location of knownLocations) {
        if (!compatibleType(location, requestedType)) continue;
        for (const candidate of candidateNameDescriptors(location)) {
          if (!candidate.generic && candidate.core === descriptor.core && candidate.type === descriptor.type) {
            nameHits.push({ location, confidence: 0.97, source: candidate });
            break;
          }
        }
      }
      const uniqueNameHits = uniqueLocationMatches(nameHits);
      if (uniqueNameHits.length === 1 && uniqueNameHits[0].confidence >= this.minConfidence) {
        return this.finish(input, { ...base, status: 'resolved', location: uniqueNameHits[0].location, matchMode: 'normalized_entity_type_match', confidence: uniqueNameHits[0].confidence, candidates: uniqueNameHits, reason: 'same_named_entity_and_location_type' });
      }
      if (uniqueNameHits.length > 1) {
        return this.finish(input, { ...base, status: 'ambiguous', location: null, matchMode: 'normalized_entity_type_ambiguous', confidence: 0, candidates: uniqueNameHits, reason: 'multiple_locations_share_normalized_entity_type' });
      }
    }

    const incomingStructural = structuralFingerprint(identity);
    if (incomingStructural) {
      const structuralHits = knownLocations
        .filter(location => compatibleType(location, requestedType))
        .filter(location => structuralFingerprint(location.canonicalIdentity || {}) === incomingStructural)
        .map(location => ({ location, confidence: 0.92 }));
      const uniqueStructuralHits = uniqueLocationMatches(structuralHits);
      if (uniqueStructuralHits.length === 1 && uniqueStructuralHits[0].confidence >= this.minConfidence) {
        return this.finish(input, { ...base, status: 'resolved', location: uniqueStructuralHits[0].location, matchMode: 'structural_identity_exact_without_name', confidence: uniqueStructuralHits[0].confidence, candidates: uniqueStructuralHits, reason: 'single_exact_structural_identity_match' });
      }
      if (uniqueStructuralHits.length > 1) {
        return this.finish(input, { ...base, status: 'ambiguous', location: null, matchMode: 'structural_identity_ambiguous', confidence: 0, candidates: uniqueStructuralHits, reason: 'multiple_locations_share_structural_identity' });
      }
    }

    if (descriptor.generic && this.allowContextualGeneric && input.production?.id && this.db?.listProductionReusableLocations) {
      const productionLocations = await this.db.listProductionReusableLocations(input.production.id);
      const compatible = uniqueLocationMatches(
        productionLocations.filter(location => compatibleType(location, requestedType)).map(location => ({ location, confidence: 0.84 }))
      );
      if (compatible.length === 1 && compatible[0].confidence >= this.minConfidence) {
        return this.finish(input, { ...base, status: 'resolved', location: compatible[0].location, matchMode: 'context_unique_production_location', confidence: compatible[0].confidence, candidates: compatible, reason: 'generic_reference_has_one_compatible_location_in_production' });
      }
      if (compatible.length > 1) {
        return this.finish(input, { ...base, status: 'ambiguous', location: null, matchMode: 'context_generic_ambiguous', confidence: 0, candidates: compatible, reason: 'generic_reference_has_multiple_compatible_locations_in_production' });
      }
    }

    return this.finish(input, { ...base, status: 'unresolved', location: null, matchMode: null, confidence: 0, candidates: [], reason: descriptor.generic ? 'generic_reference_without_unique_context' : 'no_safe_location_match' });
  }
}

module.exports = {
  LOCATION_RESOLVER_VERSION: VERSION,
  LocationResolverV11,
  normalize,
  slug,
  normalizeLocationType,
  typeForReference,
  referenceDescriptor,
  explicitEnvironmentAliases,
  aliasVariants,
  structuralIdentity,
  structuralFingerprint,
  locationReferenceText,
  compatibleType,
  candidateNameDescriptors,
  uniqueLocationMatches,
  stableJson
};
