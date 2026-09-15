'use strict';

const {
  normalize,
  normalizeLocationType,
  referenceDescriptor,
  compatibleType,
  locationReferenceText
} = require('./location-resolver-v11');

const VERSION = '11.9.7';

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizedArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalize).filter(Boolean))].sort();
}

function jaccard(a = [], b = []) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size) return null;
  const intersection = [...left].filter(item => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function requiredPropNames(identity = {}) {
  return normalizedArray((identity.requiredProps || []).map(item => item?.name || item?.type || ''));
}

function canonicalReady(location = {}) {
  return location.status === 'canonical_ready' || Boolean(location.canonicalMasterFramePath);
}

function scoreCandidate(identity = {}, location = {}, requestedType = 'location') {
  if (!compatibleType(location, requestedType)) {
    return { eligible: false, score: 0, evidenceCount: 0, matchedDimensions: [], metrics: {}, reason: 'location_type_mismatch' };
  }
  const candidate = location.canonicalIdentity || {};
  const metrics = {};
  const weighted = [];
  const addScalar = (key, incoming, current, weight) => {
    const a = normalize(incoming || '');
    if (!a) return;
    const b = normalize(current || '');
    const value = b && a === b ? 1 : 0;
    metrics[key] = value;
    weighted.push({ key, value, weight });
  };
  const addSet = (key, incoming, current, weight) => {
    const left = normalizedArray(incoming || []);
    if (!left.length) return;
    const value = jaccard(left, normalizedArray(current || [])) ?? 0;
    metrics[key] = value;
    weighted.push({ key, value, weight });
  };

  addScalar('construction', identity.construction, candidate.construction, 0.18);
  addScalar('architecturalStyle', identity.architecturalStyle, candidate.architecturalStyle, 0.14);
  addSet('materials', identity.materials, candidate.materials, 0.16);
  addSet('palette', identity.palette, candidate.palette, 0.08);
  addScalar('layout', identity.layout, candidate.layout, 0.20);
  addSet('signatureElements', identity.signatureElements, candidate.signatureElements, 0.14);
  addSet('requiredProps', requiredPropNames(identity), requiredPropNames(candidate), 0.10);

  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
  const score = weightTotal ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal : 0;
  const matchedDimensions = weighted.filter(item => item.value >= 0.75).map(item => item.key);
  return {
    eligible: true,
    score: Number(score.toFixed(4)),
    evidenceCount: weighted.length,
    matchedDimensions,
    metrics,
    canonicalReady: canonicalReady(location),
    reason: weighted.length ? 'stable_identity_similarity' : 'insufficient_identity_evidence'
  };
}

function rankLocations(identity = {}, locations = [], requestedType = 'location') {
  return (Array.isArray(locations) ? locations : [])
    .map(location => ({ location, ...scoreCandidate(identity, location, requestedType) }))
    .filter(item => item.eligible)
    .sort((a, b) =>
      Number(b.score) - Number(a.score) ||
      Number(b.canonicalReady) - Number(a.canonicalReady) ||
      String(a.location?.id || '').localeCompare(String(b.location?.id || ''))
    );
}

class LocationLibraryManagerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.REUSABLE_LOCATION_AUTO_SELECTION_ENABLED ?? 'true').toLowerCase() !== 'false';
    const threshold = Number(options.minScore ?? process.env.REUSABLE_LOCATION_AUTO_SELECTION_MIN_SCORE ?? 0.78);
    this.minScore = Number.isFinite(threshold) ? Math.max(0.55, Math.min(0.98, threshold)) : 0.78;
    const margin = Number(options.minMargin ?? process.env.REUSABLE_LOCATION_AUTO_SELECTION_MIN_MARGIN ?? 0.12);
    this.minMargin = Number.isFinite(margin) ? Math.max(0.02, Math.min(0.5, margin)) : 0.12;
    const dimensions = Number(options.minEvidenceDimensions ?? process.env.REUSABLE_LOCATION_AUTO_SELECTION_MIN_EVIDENCE_DIMENSIONS ?? 3);
    this.minEvidenceDimensions = Number.isFinite(dimensions) ? Math.max(2, Math.min(7, Math.floor(dimensions))) : 3;
    this.maxCandidates = 8;
  }

  async persistDecision(input = {}, result = {}) {
    if (!input.production?.id || !input.environment?.environmentId || !this.db?.saveReusableLocationAutoSelection) return null;
    await this.db.saveReusableLocationAutoSelection({
      namespace: input.namespace || 'default',
      productionId: input.production.id,
      environmentId: input.environment.environmentId,
      referenceText: input.referenceText || locationReferenceText(input.environment),
      requestedType: result.requestedType || null,
      status: result.status,
      selectedLocationId: result.location?.id || null,
      score: result.score || 0,
      runnerUpScore: result.runnerUpScore || 0,
      margin: result.margin || 0,
      candidates: (result.candidates || []).map(item => ({
        locationId: item.location?.id || null,
        displayName: item.location?.displayName || null,
        score: item.score,
        evidenceCount: item.evidenceCount,
        matchedDimensions: item.matchedDimensions,
        canonicalReady: item.canonicalReady === true
      })),
      reason: result.reason || null
    });

    if (this.db?.saveReusableLocationResolution && ['resolved', 'ambiguous'].includes(result.status)) {
      await this.db.saveReusableLocationResolution({
        namespace: input.namespace || 'default',
        productionId: input.production.id,
        environmentId: input.environment.environmentId,
        referenceText: input.referenceText || locationReferenceText(input.environment),
        referenceKey: result.referenceKey || null,
        requestedType: result.requestedType || null,
        status: result.status,
        locationId: result.location?.id || null,
        matchMode: result.status === 'resolved' ? 'library_auto_select' : 'library_auto_select_ambiguous',
        confidence: result.score || 0,
        candidateLocationIds: (result.candidates || []).map(item => item.location?.id).filter(Boolean),
        reason: result.reason || null,
        identityFingerprint: input.identityFingerprint || null
      });
    }
    return result;
  }

  async autoSelectEnvironment(input = {}) {
    const namespace = input.namespace || 'default';
    const environment = input.environment || {};
    const identity = input.identity || {};
    const referenceText = input.referenceText || locationReferenceText(environment);
    const descriptor = referenceDescriptor(referenceText, identity.category || environment.category || '');
    const requestedType = descriptor.type || normalizeLocationType(identity.category || environment.category || '');
    const base = { version: VERSION, active: this.enabled, referenceText, referenceKey: descriptor.key, requestedType };

    if (!this.enabled) return { ...base, status: 'disabled', location: null, score: 0, candidates: [], reason: 'auto_selection_disabled' };
    if (!descriptor.generic) {
      const result = { ...base, status: 'unresolved', location: null, score: 0, runnerUpScore: 0, margin: 0, candidates: [], reason: 'explicit_reference_requires_exact_resolver_match' };
      await this.persistDecision(input, result);
      return result;
    }

    const locations = this.db?.listReusableLocations ? await this.db.listReusableLocations(namespace) : [];
    if (!locations.length) {
      const result = { ...base, status: 'unresolved', location: null, score: 0, runnerUpScore: 0, margin: 0, candidates: [], reason: 'library_empty' };
      await this.persistDecision(input, result);
      return result;
    }

    const ranked = rankLocations(identity, locations, requestedType).slice(0, this.maxCandidates);
    const top = ranked[0] || null;
    const second = ranked[1] || null;
    if (!top || top.evidenceCount < this.minEvidenceDimensions || top.score < this.minScore) {
      const result = {
        ...base, status: 'unresolved', location: null, score: top?.score || 0, runnerUpScore: second?.score || 0,
        margin: top ? Number((top.score - (second?.score || 0)).toFixed(4)) : 0, candidates: ranked,
        reason: !top ? 'no_type_compatible_candidates' : top.evidenceCount < this.minEvidenceDimensions ? 'insufficient_stable_evidence' : 'top_candidate_below_threshold'
      };
      await this.persistDecision(input, result);
      return result;
    }

    const margin = Number((top.score - (second?.score || 0)).toFixed(4));
    if (second && second.score >= this.minScore && margin < this.minMargin) {
      const result = { ...base, status: 'ambiguous', location: null, score: top.score, runnerUpScore: second.score, margin, candidates: ranked, reason: 'top_candidates_too_close' };
      await this.persistDecision(input, result);
      return result;
    }

    const result = {
      ...base, status: 'resolved', location: top.location, score: top.score, runnerUpScore: second?.score || 0,
      margin, candidates: ranked, matchMode: 'library_auto_select', reason: 'unique_high_confidence_library_candidate'
    };
    await this.persistDecision(input, result);
    this.logger.info(`Location Library Auto Selection v${VERSION}: ${environment.environmentId || 'environment'} -> ${top.location.id} score=${top.score.toFixed(3)} margin=${margin.toFixed(3)}.`);
    return result;
  }

  async detail(locationId) {
    if (!locationId || !this.db?.getReusableLocation) return null;
    const location = await this.db.getReusableLocation(locationId);
    if (!location) return null;
    const [zones, assets, aliases, usages] = await Promise.all([
      this.db.listReusableLocationZones ? this.db.listReusableLocationZones(locationId) : [],
      this.db.listReusableLocationAssets ? this.db.listReusableLocationAssets(locationId) : [],
      this.db.listReusableLocationAliases ? this.db.listReusableLocationAliases(locationId) : [],
      this.db.listReusableLocationUsages ? this.db.listReusableLocationUsages(locationId) : []
    ]);
    return {
      ...location,
      zones,
      assets: assets.map(asset => ({ ...asset, assetUrl: asset.status === 'ready' && asset.assetPath ? `/api/location-library/assets/${encodeURIComponent(asset.id)}` : null })),
      aliases,
      usages,
      usageCount: usages.length,
      crossVideoUsageCount: new Set(usages.map(item => item.productionId).filter(Boolean)).size,
      canonicalAssetCount: assets.filter(asset => asset.canonical === true && asset.status === 'ready').length
    };
  }

  async getSnapshot(namespace = 'default') {
    const locations = this.db?.listReusableLocations ? await this.db.listReusableLocations(namespace) : [];
    const details = [];
    for (const location of locations.slice(0, 200)) {
      const detail = await this.detail(location.id);
      if (detail) details.push(detail);
    }
    const selections = this.db?.listReusableLocationAutoSelections ? await this.db.listReusableLocationAutoSelections(namespace, 100) : [];
    return {
      version: VERSION,
      namespace,
      locations: details,
      selections,
      summary: {
        locationCount: details.length,
        canonicalReady: details.filter(item => canonicalReady(item)).length,
        zoneCount: details.reduce((sum, item) => sum + item.zones.length, 0),
        canonicalAssetCount: details.reduce((sum, item) => sum + item.canonicalAssetCount, 0),
        aliasCount: details.reduce((sum, item) => sum + item.aliases.length, 0),
        crossVideoLocations: details.filter(item => item.crossVideoUsageCount > 1).length,
        autoSelected: selections.filter(item => item.status === 'resolved').length,
        autoAmbiguous: selections.filter(item => item.status === 'ambiguous').length
      }
    };
  }
}

module.exports = {
  LOCATION_LIBRARY_MANAGER_VERSION: VERSION,
  LocationLibraryManagerV11,
  scoreCandidate,
  rankLocations,
  jaccard,
  requiredPropNames,
  canonicalReady
};
