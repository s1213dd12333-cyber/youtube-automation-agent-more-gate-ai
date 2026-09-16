'use strict';

const crypto = require('crypto');

const VERSION = '12.4';
const TIERS = ['limited','regional','international','global','systemic'];

const IMPACT_CONCEPTS = Object.freeze({
  humanSafety: new Set(['attack','earthquake','wildfire','flood','death','injury','emergency','ceasefire']),
  economicSystemic: new Set(['market','rate','funding','deal','ban']),
  infrastructure: new Set(['close','reopen','emergency','attack','flood','earthquake','wildfire']),
  civicInstitutional: new Set(['election','approve','ban','arrest','resign','deal','ceasefire']),
  persistence: new Set(['earthquake','wildfire','flood','attack','ceasefire','market','rate','ban']),
  acuteUrgency: new Set(['attack','earthquake','wildfire','flood','death','injury','emergency','correction','expand'])
});

function clean(value, limit = 1200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clamp(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function uniq(values, limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = clean(value, 300);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function defaultPolicy() {
  return {
    geographicWeight: 0.18,
    humanSafetyWeight: 0.21,
    economicSystemicWeight: 0.13,
    infrastructureWeight: 0.11,
    civicInstitutionalWeight: 0.08,
    persistenceWeight: 0.10,
    urgencyWeight: 0.11,
    crossBorderWeight: 0.08,
    lowConfidenceDamping: 0.82,
    lowConfidenceThreshold: 52,
    tierRegional: 42,
    tierInternational: 58,
    tierGlobal: 74,
    tierSystemic: 88
  };
}

function normalizePolicy(input = {}) {
  const base = defaultPolicy();
  const source = { ...base, ...(input || {}) };
  const rawWeights = {
    geographicWeight: clamp(source.geographicWeight, 0, 1, base.geographicWeight),
    humanSafetyWeight: clamp(source.humanSafetyWeight, 0, 1, base.humanSafetyWeight),
    economicSystemicWeight: clamp(source.economicSystemicWeight, 0, 1, base.economicSystemicWeight),
    infrastructureWeight: clamp(source.infrastructureWeight, 0, 1, base.infrastructureWeight),
    civicInstitutionalWeight: clamp(source.civicInstitutionalWeight, 0, 1, base.civicInstitutionalWeight),
    persistenceWeight: clamp(source.persistenceWeight, 0, 1, base.persistenceWeight),
    urgencyWeight: clamp(source.urgencyWeight, 0, 1, base.urgencyWeight),
    crossBorderWeight: clamp(source.crossBorderWeight, 0, 1, base.crossBorderWeight)
  };
  const total = Object.values(rawWeights).reduce((sum, value) => sum + value, 0) || 1;
  const normalized = {};
  for (const [key, value] of Object.entries(rawWeights)) normalized[key] = value / total;
  return {
    ...normalized,
    lowConfidenceDamping: clamp(source.lowConfidenceDamping, 0.5, 1, base.lowConfidenceDamping),
    lowConfidenceThreshold: Math.round(clamp(source.lowConfidenceThreshold, 20, 90, base.lowConfidenceThreshold)),
    tierRegional: Math.round(clamp(source.tierRegional, 20, 70, base.tierRegional)),
    tierInternational: Math.round(clamp(source.tierInternational, 35, 82, base.tierInternational)),
    tierGlobal: Math.round(clamp(source.tierGlobal, 50, 94, base.tierGlobal)),
    tierSystemic: Math.round(clamp(source.tierSystemic, 65, 100, base.tierSystemic))
  };
}

function concepts(candidate) {
  return uniq(candidate?.event?.concepts || candidate?.event?.signature?.concepts || [], 80).map(value => value.toLowerCase());
}

function locations(candidate) {
  return uniq(candidate?.event?.locations || candidate?.event?.signature?.locations || [], 80);
}

function scoreConceptGroup(candidateConcepts, group, base = 8, each = 22, cap = 88) {
  let hits = 0;
  for (const concept of candidateConcepts) if (group.has(concept)) hits += 1;
  return Math.min(cap, base + hits * each);
}

function evidenceConfidence(candidate) {
  const scores = candidate?.cluster?.scores || {};
  const independent = clamp(scores.independentEvidenceUnits, 0, 20, 0);
  const domains = clamp(scores.sourceCount, 0, 40, 0);
  const regions = clamp(scores.regionCount, 0, 10, 0);
  const coverageConfidence = clamp(scores.confidenceScore ?? candidate?.event?.confidenceScore, 0, 100, 0);
  return Math.round(Math.min(100,
    coverageConfidence * 0.58 +
    Math.min(100, independent * 14) * 0.20 +
    Math.min(100, domains * 6) * 0.12 +
    Math.min(100, regions * 20) * 0.10
  ));
}

function computeDimensions(candidate) {
  const scores = candidate?.cluster?.scores || {};
  const event = candidate?.event || {};
  const c = concepts(candidate);
  const locs = locations(candidate);
  const regionCount = clamp(scores.regionCount, 0, 10, 0);
  const sourceCount = clamp(scores.sourceCount, 0, 100, 0);
  const independent = clamp(scores.independentEvidenceUnits, 0, 30, 0);
  const velocity = clamp(scores.velocityScore, 0, 100, 0);
  const freshness = clamp(scores.freshnessScore, 0, 100, 50);
  const evolution = clamp(event.evolutionScore, 0, 100, 20);
  const revision = clamp(event.revisionNumber, 0, 50, 0);
  const changeKind = clean(event?.changeClassification?.kind || event?.change_kind || 'observation', 80).toLowerCase();

  const geographicReach = Math.round(Math.min(100,
    regionCount * 19 +
    Math.min(30, locs.length * 8) +
    Math.min(20, independent * 3)
  ));

  let humanSafety = scoreConceptGroup(c, IMPACT_CONCEPTS.humanSafety, 6, 24, 94);
  if (c.includes('death')) humanSafety += 10;
  if (c.includes('injury')) humanSafety += 6;
  if (c.includes('emergency')) humanSafety += 8;
  humanSafety = Math.round(Math.min(100, humanSafety));

  let economicSystemic = scoreConceptGroup(c, IMPACT_CONCEPTS.economicSystemic, 5, 20, 82);
  economicSystemic += Math.min(18, regionCount * 4);
  economicSystemic = Math.round(Math.min(100, economicSystemic));

  let infrastructure = scoreConceptGroup(c, IMPACT_CONCEPTS.infrastructure, 4, 19, 82);
  if (c.includes('close')) infrastructure += 8;
  if (c.includes('reopen')) infrastructure += 5;
  infrastructure = Math.round(Math.min(100, infrastructure));

  let civicInstitutional = scoreConceptGroup(c, IMPACT_CONCEPTS.civicInstitutional, 4, 16, 76);
  civicInstitutional += Math.min(14, regionCount * 3);
  civicInstitutional = Math.round(Math.min(100, civicInstitutional));

  let persistence = scoreConceptGroup(c, IMPACT_CONCEPTS.persistence, 8, 13, 72);
  persistence += Math.min(16, revision * 4);
  if (['escalation','resolution','correction','material_update'].includes(changeKind)) persistence += 10;
  persistence = Math.round(Math.min(100, persistence));

  let urgency = Math.round(velocity * 0.52 + freshness * 0.28 + evolution * 0.20);
  if (c.some(concept => IMPACT_CONCEPTS.acuteUrgency.has(concept))) urgency += 8;
  if (changeKind === 'escalation') urgency += 8;
  if (changeKind === 'correction') urgency += 4;
  urgency = Math.round(Math.min(100, urgency));

  const crossBorder = Math.round(Math.min(100,
    regionCount * 22 +
    Math.min(28, locs.length * 9) +
    Math.min(18, sourceCount * 2)
  ));

  return {
    geographicReach,
    humanSafety,
    economicSystemic,
    infrastructure,
    civicInstitutional,
    persistence,
    urgency,
    crossBorder,
    observedRegionCount: Number(scores.regionCount || 0),
    observedSourceCount: Number(scores.sourceCount || 0),
    independentEvidenceUnits: Number(scores.independentEvidenceUnits || 0),
    changeKind,
    concepts: c,
    locations: locs
  };
}

function tierFor(score, policy) {
  if (score >= policy.tierSystemic) return 'systemic';
  if (score >= policy.tierGlobal) return 'global';
  if (score >= policy.tierInternational) return 'international';
  if (score >= policy.tierRegional) return 'regional';
  return 'limited';
}

function assessImportance(candidate, context = {}) {
  const policy = normalizePolicy(context.policy);
  const dimensions = computeDimensions(candidate);
  const confidenceScore = evidenceConfidence(candidate);
  const weighted =
    dimensions.geographicReach * policy.geographicWeight +
    dimensions.humanSafety * policy.humanSafetyWeight +
    dimensions.economicSystemic * policy.economicSystemicWeight +
    dimensions.infrastructure * policy.infrastructureWeight +
    dimensions.civicInstitutional * policy.civicInstitutionalWeight +
    dimensions.persistence * policy.persistenceWeight +
    dimensions.urgency * policy.urgencyWeight +
    dimensions.crossBorder * policy.crossBorderWeight;
  const damped = confidenceScore < policy.lowConfidenceThreshold ? weighted * policy.lowConfidenceDamping : weighted;
  const importanceScore = Math.round(Math.max(0, Math.min(100, damped)));
  const impactTier = tierFor(importanceScore, policy);
  const reasons = [];
  if (dimensions.geographicReach >= 70) reasons.push('broad_geographic_reach');
  if (dimensions.humanSafety >= 65) reasons.push('human_safety_impact');
  if (dimensions.economicSystemic >= 65) reasons.push('economic_systemic_impact');
  if (dimensions.infrastructure >= 60) reasons.push('critical_infrastructure_impact');
  if (dimensions.civicInstitutional >= 60) reasons.push('civic_institutional_impact');
  if (dimensions.persistence >= 60) reasons.push('persistent_event');
  if (dimensions.urgency >= 75) reasons.push('high_urgency');
  if (dimensions.crossBorder >= 70) reasons.push('cross_border_spillover');
  if (confidenceScore < policy.lowConfidenceThreshold) reasons.push('importance_score_damped_for_low_evidence_confidence');
  if (!reasons.length) reasons.push('limited_structural_impact_signals');

  const evidence = {
    independentEvidenceUnits: dimensions.independentEvidenceUnits,
    sourceCount: dimensions.observedSourceCount,
    regionCount: dimensions.observedRegionCount,
    coverageConfidence: Math.round(clamp(candidate?.cluster?.scores?.confidenceScore ?? candidate?.event?.confidenceScore, 0, 100, 0)),
    globalRepercussionScore: Math.round(clamp(candidate?.cluster?.scores?.globalScore, 0, 100, 0)),
    concepts: dimensions.concepts,
    locations: dimensions.locations,
    eventRevision: Number(candidate?.event?.revisionNumber || 0),
    changeKind: dimensions.changeKind
  };
  const rationale = `Global importance ${importanceScore}/100 (${impactTier}); evidence confidence ${confidenceScore}/100. Structural dimensions: geographic ${dimensions.geographicReach}, human safety ${dimensions.humanSafety}, economic/systemic ${dimensions.economicSystemic}, infrastructure ${dimensions.infrastructure}, civic/institutional ${dimensions.civicInstitutional}, persistence ${dimensions.persistence}, urgency ${dimensions.urgency}, cross-border ${dimensions.crossBorder}.`;
  return { version: VERSION, importanceScore, impactTier, confidenceScore, dimensions, evidence, reasonCodes: reasons, rationale };
}

class GlobalImportanceEngineV124 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_GLOBAL_IMPORTANCE_ENABLED || 'true').toLowerCase() !== 'false',
      defaultPolicy: normalizePolicy(this.policyOverride || {
        lowConfidenceDamping: process.env.NEWSROOM_IMPORTANCE_LOW_CONFIDENCE_DAMPING,
        lowConfidenceThreshold: process.env.NEWSROOM_IMPORTANCE_LOW_CONFIDENCE_THRESHOLD,
        tierRegional: process.env.NEWSROOM_IMPORTANCE_TIER_REGIONAL,
        tierInternational: process.env.NEWSROOM_IMPORTANCE_TIER_INTERNATIONAL,
        tierGlobal: process.env.NEWSROOM_IMPORTANCE_TIER_GLOBAL,
        tierSystemic: process.env.NEWSROOM_IMPORTANCE_TIER_SYSTEMIC
      })
    };
  }

  async getPolicy() {
    const base = this.getConfig().defaultPolicy;
    if (!this.db) return { revisionNumber: 0, policy: base, source: 'default' };
    const row = await this.db.getRow('SELECT * FROM global_news_importance_policy_revisions ORDER BY revision_number DESC LIMIT 1');
    if (!row) return { revisionNumber: 0, policy: base, source: 'default' };
    return {
      revisionNumber: Number(row.revision_number || 0),
      policy: normalizePolicy({ ...base, ...parseJson(row.policy_json, {}) }),
      reason: row.reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
      source: 'persisted'
    };
  }

  async setPolicy(patch, actor = 'operator', reason = '') {
    if (!this.db) throw Object.assign(new Error('importance_policy_persistence_required'), { code: 'importance_policy_persistence_required' });
    const explanation = clean(reason, 500);
    if (explanation.length < 8) throw Object.assign(new Error('importance_policy_reason_required'), { code: 'importance_policy_reason_required' });
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      const current = await this.db.getRow('SELECT * FROM global_news_importance_policy_revisions ORDER BY revision_number DESC LIMIT 1');
      const currentPolicy = current ? parseJson(current.policy_json, {}) : this.getConfig().defaultPolicy;
      const nextPolicy = normalizePolicy({ ...currentPolicy, ...(patch || {}) });
      const revisionNumber = Number(current?.revision_number || 0) + 1;
      const fingerprint = hash(JSON.stringify(nextPolicy)).slice(0, 32);
      const id = `news_importance_policy_${revisionNumber}_${fingerprint.slice(0, 16)}`;
      await this.db.executeQuery(
        `INSERT INTO global_news_importance_policy_revisions (id, revision_number, policy_json, policy_fingerprint, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, revisionNumber, JSON.stringify(nextPolicy), fingerprint, explanation, clean(actor, 200) || 'operator']
      );
      await this.db.executeQuery('COMMIT');
      return { id, revisionNumber, policy: nextPolicy, fingerprint, reason: explanation, createdBy: clean(actor, 200) || 'operator' };
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
  }

  async assessCandidate(candidate, context = {}) {
    if (String(process.env.NEWSROOM_GLOBAL_IMPORTANCE_ENABLED || 'true').toLowerCase() === 'false') return null;
    const policyState = await this.getPolicy();
    const assessment = assessImportance(candidate, { policy: policyState.policy });
    const scanId = clean(context.scanId, 200) || null;
    const eventId = clean(candidate?.event?.id, 200) || null;
    const clusterId = clean(candidate?.cluster?.id, 200) || null;
    const eventRevision = Number(candidate?.event?.revisionNumber || 0);
    const materialFingerprint = clean(candidate?.cluster?.materialFingerprint, 200);
    const fingerprint = hash(JSON.stringify({
      version: VERSION,
      scanId,
      eventId,
      clusterId,
      eventRevision,
      materialFingerprint,
      policyRevision: policyState.revisionNumber,
      importanceScore: assessment.importanceScore,
      dimensions: assessment.dimensions,
      evidence: assessment.evidence
    })).slice(0, 32);
    const id = `news_importance_${fingerprint.slice(0, 24)}`;
    const result = { ...assessment, id, fingerprint, scanId, eventId, clusterId, eventRevision, policyRevision: policyState.revisionNumber };

    if (this.db && clusterId) {
      await this.db.executeQuery(
        `INSERT OR IGNORE INTO global_news_importance_assessments (id, scan_id, event_id, cluster_id, event_revision, engine_version, importance_score, impact_tier, confidence_score, dimensions_json, evidence_json, reason_codes_json, rationale, policy_revision, assessment_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, scanId, eventId, clusterId, eventRevision, VERSION, assessment.importanceScore, assessment.impactTier, assessment.confidenceScore, JSON.stringify(assessment.dimensions), JSON.stringify(assessment.evidence), JSON.stringify(assessment.reasonCodes), assessment.rationale, policyState.revisionNumber, fingerprint]
      );
    }
    return result;
  }

  async listAssessments(limit = 100, tier = null) {
    if (!this.db) return [];
    const params = [];
    let sql = 'SELECT * FROM global_news_importance_assessments';
    if (tier && TIERS.includes(String(tier).toLowerCase())) { sql += ' WHERE impact_tier = ?'; params.push(String(tier).toLowerCase()); }
    sql += ' ORDER BY created_at DESC, importance_score DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const rows = await this.db.getAllRows(sql, params);
    return rows.map(row => ({
      id: row.id,
      scanId: row.scan_id,
      eventId: row.event_id,
      clusterId: row.cluster_id,
      eventRevision: Number(row.event_revision || 0),
      version: row.engine_version,
      importanceScore: Number(row.importance_score || 0),
      impactTier: row.impact_tier,
      confidenceScore: Number(row.confidence_score || 0),
      dimensions: parseJson(row.dimensions_json, {}),
      evidence: parseJson(row.evidence_json, {}),
      reasonCodes: parseJson(row.reason_codes_json, []),
      rationale: row.rationale,
      policyRevision: Number(row.policy_revision || 0),
      fingerprint: row.assessment_fingerprint,
      createdAt: row.created_at
    }));
  }

  async status() {
    const policy = await this.getPolicy();
    return {
      version: VERSION,
      enabled: this.getConfig().enabled,
      policy,
      recentAssessments: await this.listAssessments(30)
    };
  }
}

module.exports = {
  VERSION,
  TIERS,
  IMPACT_CONCEPTS,
  defaultPolicy,
  normalizePolicy,
  evidenceConfidence,
  computeDimensions,
  tierFor,
  assessImportance,
  GlobalImportanceEngineV124
};
