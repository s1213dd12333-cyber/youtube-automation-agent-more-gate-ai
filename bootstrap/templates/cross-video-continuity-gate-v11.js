'use strict';

const { imageSignature, scoreEnvironment, pathExists } = require('./environment-continuity-validator-v11');

const VERSION = '11.9.6';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function weightedScore(metrics = {}, weights = {}) {
  let total = 0;
  let weightTotal = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (metrics[key] == null) continue;
    total += clamp01(metrics[key]) * weight;
    weightTotal += weight;
  }
  return weightTotal ? clamp01(total / weightTotal) : 0;
}

function temporaryAllowance(state = null) {
  if (!state || state.status !== 'active') return { active: false, structureRelaxation: 0, appearanceRequired: true };
  const hasSpatialOverlay = (state.temporaryProps || []).length > 0 || (state.temporaryChanges || []).some(item => ['messy', 'under_renovation'].includes(item));
  return {
    active: true,
    structureRelaxation: hasSpatialOverlay ? 0.04 : 0.02,
    appearanceRequired: false
  };
}

function scoreCrossVideoContinuity(referenceSignature, candidateSignature, state = null, options = {}) {
  const scored = scoreEnvironment(referenceSignature, candidateSignature);
  const structuralScore = weightedScore(scored.metrics, {
    aspect: 0.10,
    compositionGrid: 0.38,
    perceptualHash: 0.32,
    edgeDensity: 0.20
  });
  const appearanceScore = weightedScore(scored.metrics, {
    palette: 0.62,
    luminance: 0.38
  });
  const structuralThreshold = Number.isFinite(Number(options.structuralThreshold)) ? Number(options.structuralThreshold) : 0.44;
  const appearanceThreshold = Number.isFinite(Number(options.appearanceThreshold)) ? Number(options.appearanceThreshold) : 0.35;
  const allowance = temporaryAllowance(state);
  const effectiveStructuralThreshold = Math.max(0.30, structuralThreshold - allowance.structureRelaxation);
  const structuralAccepted = structuralScore >= effectiveStructuralThreshold;
  const appearanceAccepted = !allowance.appearanceRequired || appearanceScore >= appearanceThreshold;
  const reasons = [];
  if (!structuralAccepted) reasons.push('CROSS_VIDEO_STRUCTURE_DRIFT');
  if (Number(scored.metrics.compositionGrid || 0) < 0.22) reasons.push('CROSS_VIDEO_LAYOUT_DRIFT');
  if (Number(scored.metrics.edgeDensity || 0) < 0.24) reasons.push('CROSS_VIDEO_EDGE_STRUCTURE_DRIFT');
  if (!appearanceAccepted) reasons.push('CROSS_VIDEO_APPEARANCE_DRIFT');
  return {
    accepted: structuralAccepted && appearanceAccepted,
    score: structuralScore,
    structuralScore,
    appearanceScore,
    fullPerceptualScore: scored.score,
    structuralThreshold: effectiveStructuralThreshold,
    configuredStructuralThreshold: structuralThreshold,
    appearanceThreshold,
    appearanceRequired: allowance.appearanceRequired,
    temporaryStateActive: allowance.active,
    metrics: scored.metrics,
    reasons
  };
}

function canonicalAssetFor(assets = [], zoneId = null, options = {}) {
  const ready = (Array.isArray(assets) ? assets : []).filter(asset => asset?.canonical === true && asset.status === 'ready' && asset.assetPath);
  if (zoneId) {
    const zoneAsset = ready.find(asset => asset.zoneId === zoneId && asset.scope === 'zone' && asset.assetRole === 'zone_reference');
    if (zoneAsset) return { asset: zoneAsset, mode: 'zone_reference' };
    if (options.allowLocationFallbackForZone === true) {
      const locationAsset = ready.find(asset => asset.scope === 'location' && asset.assetRole === 'location_master');
      if (locationAsset) return { asset: locationAsset, mode: 'location_master_fallback' };
    }
    return { asset: null, mode: 'zone_reference_missing' };
  }
  const locationAsset = ready.find(asset => asset.scope === 'location' && asset.assetRole === 'location_master');
  return { asset: locationAsset || null, mode: locationAsset ? 'location_master' : 'location_master_missing' };
}

function latestSemantic(checks = [], keyframeId = null) {
  return (Array.isArray(checks) ? checks : [])
    .filter(check => check?.keyframeId === keyframeId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

function semanticDecision(check = null, requireSemantic = false) {
  const verified = check?.semanticPropPresenceVerified === true || check?.verified === true || check?.verified === 1;
  const explicitMismatch = check?.environmentMatches === false || check?.layoutConsistent === false || (Array.isArray(check?.mismatchedPropLockIds) && check.mismatchedPropLockIds.length > 0);
  if (explicitMismatch) return { accepted: false, verified, reason: 'CROSS_VIDEO_SEMANTIC_DRIFT' };
  if (requireSemantic && !verified) {
    return { accepted: false, verified, reason: check?.status === 'unavailable' ? 'CROSS_VIDEO_SEMANTIC_PROVIDER_UNAVAILABLE' : 'CROSS_VIDEO_SEMANTIC_REQUIRED' };
  }
  return { accepted: true, verified, reason: null };
}

class CrossVideoContinuityGateV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.CROSS_VIDEO_CONTINUITY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireCanonicalAsset = String(options.requireCanonicalAsset ?? process.env.CROSS_VIDEO_CONTINUITY_REQUIRE_CANONICAL_ASSET ?? 'true').toLowerCase() !== 'false';
    this.allowLocationFallbackForZone = String(options.allowLocationFallbackForZone ?? process.env.CROSS_VIDEO_CONTINUITY_ALLOW_LOCATION_FALLBACK_FOR_ZONE ?? 'false').toLowerCase() === 'true';
    const structural = Number(options.structuralThreshold ?? process.env.CROSS_VIDEO_CONTINUITY_STRUCTURAL_MIN_SCORE ?? 0.44);
    this.structuralThreshold = Number.isFinite(structural) ? Math.max(0.30, Math.min(0.90, structural)) : 0.44;
    const appearance = Number(options.appearanceThreshold ?? process.env.CROSS_VIDEO_CONTINUITY_APPEARANCE_MIN_SCORE ?? 0.35);
    this.appearanceThreshold = Number.isFinite(appearance) ? Math.max(0.20, Math.min(0.90, appearance)) : 0.35;
    const localSemantic = String(options.requireSemantic ?? process.env.CROSS_VIDEO_CONTINUITY_REQUIRE_SEMANTIC ?? 'false').toLowerCase() === 'true';
    const globalSemantic = String(process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';
    this.requireSemantic = localSemantic || globalSemantic;
    this.signatureLoader = options.signatureLoader || imageSignature;
    this.pathExists = options.pathExists || pathExists;
  }

  async contextFor(productionId, sceneId, keyframeId = null) {
    const locations = this.db?.listProductionReusableLocations ? await this.db.listProductionReusableLocations(productionId) : [];
    const zones = this.db?.listProductionReusableLocationZones ? await this.db.listProductionReusableLocationZones(productionId) : [];
    const state = this.db?.getReusableLocationStateLayer ? await this.db.getReusableLocationStateLayer(productionId, sceneId) : null;
    const zone = zones.find(item => item?.usage?.sceneId === sceneId) || null;
    const location = state?.locationId
      ? locations.find(item => item.id === state.locationId) || (this.db?.getReusableLocation ? await this.db.getReusableLocation(state.locationId) : null)
      : zone?.locationId
        ? locations.find(item => item.id === zone.locationId) || (this.db?.getReusableLocation ? await this.db.getReusableLocation(zone.locationId) : null)
        : null;
    const assets = location?.id && this.db?.listReusableLocationAssets ? await this.db.listReusableLocationAssets(location.id) : [];
    const semantic = keyframeId && this.db?.getLatestSemanticPropCheck ? await this.db.getLatestSemanticPropCheck(productionId, keyframeId) : null;
    return { location, zone, state, assets, semantic };
  }

  async persist(input, context, result) {
    if (!this.db?.saveCrossVideoContinuityCheck) return null;
    return this.db.saveCrossVideoContinuityCheck({
      productionId: input.productionId,
      sceneId: input.sceneId,
      shotId: input.keyframe?.shotId,
      keyframeId: input.keyframe?.id,
      locationId: context.location?.id || result.locationId || null,
      zoneId: context.zone?.id || context.state?.zoneId || result.zoneId || null,
      canonicalAssetId: result.canonicalAsset?.id || null,
      canonicalAssetPath: result.canonicalAsset?.assetPath || null,
      canonicalAssetSha256: result.canonicalAsset?.assetSha256 || null,
      canonicalSourceProductionId: result.canonicalAsset?.sourceProductionId || context.location?.createdFromProductionId || null,
      currentProductionId: input.productionId,
      reusedAcrossVideos: result.reusedAcrossVideos === true,
      stateLayerId: context.state?.id || null,
      stateFingerprint: context.state?.stateFingerprint || null,
      version: VERSION,
      attempt: input.attempt || 0,
      status: result.status,
      accepted: result.accepted,
      score: result.score || 0,
      structuralScore: result.structuralScore || 0,
      appearanceScore: result.appearanceScore || 0,
      threshold: result.structuralThreshold ?? this.structuralThreshold,
      metrics: result.metrics || {},
      reasons: result.reasons || [],
      anchorMode: result.anchorMode || null,
      semanticVerified: result.semanticVerified === true,
      semanticStatus: context.semantic?.status || null,
      referenceFingerprint: result.referenceFingerprint || null,
      candidateFingerprint: result.candidateFingerprint || null
    });
  }

  async evaluate(input = {}) {
    const { productionId, sceneId, keyframe, assetPath } = input;
    if (!productionId || !sceneId || !keyframe?.id || !assetPath) throw new Error('Cross-video continuity evaluation requires productionId, sceneId, keyframe and assetPath');
    if (!this.enabled) return { version: VERSION, active: false, accepted: true, status: 'disabled', reasons: [] };

    const context = await this.contextFor(productionId, sceneId, keyframe.id);
    if (!context.location?.id) {
      const result = { version: VERSION, active: true, accepted: false, status: 'location_unresolved', score: 0, structuralScore: 0, appearanceScore: 0, reusedAcrossVideos: false, reasons: ['CROSS_VIDEO_LOCATION_UNRESOLVED'] };
      await this.persist(input, context, result);
      return result;
    }

    const reusedAcrossVideos = Boolean(
      context.location.reusedAcrossVideos === true ||
      (context.location.createdFromProductionId && context.location.createdFromProductionId !== productionId)
    );
    if (!reusedAcrossVideos) {
      const result = { version: VERSION, active: true, accepted: true, status: 'origin_production', score: 1, structuralScore: 1, appearanceScore: 1, reusedAcrossVideos: false, reasons: [], locationId: context.location.id, zoneId: context.zone?.id || context.state?.zoneId || null };
      await this.persist(input, context, result);
      return result;
    }

    const zoneId = context.zone?.id || context.state?.zoneId || null;
    const selected = canonicalAssetFor(context.assets, zoneId, { allowLocationFallbackForZone: this.allowLocationFallbackForZone });
    if (!selected.asset || !await this.pathExists(selected.asset.assetPath)) {
      const accepted = !this.requireCanonicalAsset;
      const result = {
        version: VERSION, active: true, accepted, status: accepted ? 'skipped_no_canonical_asset' : 'canonical_asset_missing',
        score: accepted ? 1 : 0, structuralScore: accepted ? 1 : 0, appearanceScore: accepted ? 1 : 0,
        structuralThreshold: this.structuralThreshold, reusedAcrossVideos: true, anchorMode: selected.mode,
        locationId: context.location.id, zoneId, reasons: accepted ? [] : [zoneId ? 'CROSS_VIDEO_ZONE_REFERENCE_MISSING' : 'CROSS_VIDEO_LOCATION_MASTER_MISSING']
      };
      await this.persist(input, context, result);
      return result;
    }

    const [reference, candidate] = await Promise.all([
      this.signatureLoader(selected.asset.assetPath),
      this.signatureLoader(assetPath)
    ]);
    const scored = scoreCrossVideoContinuity(reference, candidate, context.state, {
      structuralThreshold: this.structuralThreshold,
      appearanceThreshold: this.appearanceThreshold
    });
    const semantic = semanticDecision(context.semantic, this.requireSemantic);
    const accepted = scored.accepted && semantic.accepted;
    const reasons = [...scored.reasons];
    if (semantic.reason) reasons.push(semantic.reason);
    const result = {
      version: VERSION,
      active: true,
      accepted,
      status: accepted ? 'accepted' : 'blocked',
      ...scored,
      accepted,
      reusedAcrossVideos: true,
      anchorMode: selected.mode,
      canonicalAsset: selected.asset,
      locationId: context.location.id,
      zoneId,
      semanticVerified: semantic.verified,
      reasons,
      referenceFingerprint: reference.fingerprint || null,
      candidateFingerprint: candidate.fingerprint || null
    };
    await this.persist(input, context, result);
    this.logger[accepted ? 'info' : 'warn'](`Cross-Video Continuity v11.9.6 ${accepted ? 'accepted' : 'blocked'} ${keyframe.id}: structure=${result.structuralScore.toFixed(3)} appearance=${result.appearanceScore.toFixed(3)} anchor=${selected.mode}.`);
    return result;
  }
}

module.exports = {
  CROSS_VIDEO_CONTINUITY_VERSION: VERSION,
  CrossVideoContinuityGateV11,
  scoreCrossVideoContinuity,
  canonicalAssetFor,
  semanticDecision,
  temporaryAllowance,
  weightedScore,
  latestSemantic
};
