'use strict';

const crypto = require('crypto');

const VERSION = '12.5';
const FORMATS = new Set(['breaking_brief','update_brief','follow_up_explainer','rapid_explainer','standard_explainer','deep_dive']);
const URGENCIES = new Set(['critical','high','standard','deep']);
const ACTIONABLE = new Set(['COVER','BREAKING','UPDATE','FOLLOW_UP']);
const SENSITIVE_CONCEPTS = new Set(['election','attack','death','injury','arrest','emergency','ceasefire','ban']);
const DATA_CONCEPTS = new Set(['market','rate','funding','deal']);
const CIVIC_CONCEPTS = new Set(['election','approve','ban','arrest','resign','deal','ceasefire']);

function clean(value, limit = 1600) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clamp(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
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
    breakingMinutes: 4,
    updateMinutes: 5,
    followUpMinutes: 7,
    standardMinutes: 8,
    deepDiveMinutes: 12,
    deepDiveImportanceThreshold: 78,
    rapidVelocityThreshold: 80,
    ordinaryMinResearchSources: 3,
    sensitiveMinResearchSources: 5,
    globalImpactMinResearchSources: 5,
    requirePrimaryForSensitive: true,
    requirePrimaryForGlobalImpact: true,
    mapLocationThreshold: 2,
    maxResearchQuestions: 8
  };
}

function normalizePolicy(input = {}) {
  const base = defaultPolicy();
  const source = { ...base, ...(input || {}) };
  return {
    breakingMinutes: Math.round(clamp(source.breakingMinutes, 2, 10, base.breakingMinutes)),
    updateMinutes: Math.round(clamp(source.updateMinutes, 3, 12, base.updateMinutes)),
    followUpMinutes: Math.round(clamp(source.followUpMinutes, 4, 15, base.followUpMinutes)),
    standardMinutes: Math.round(clamp(source.standardMinutes, 4, 20, base.standardMinutes)),
    deepDiveMinutes: Math.round(clamp(source.deepDiveMinutes, 8, 30, base.deepDiveMinutes)),
    deepDiveImportanceThreshold: Math.round(clamp(source.deepDiveImportanceThreshold, 55, 95, base.deepDiveImportanceThreshold)),
    rapidVelocityThreshold: Math.round(clamp(source.rapidVelocityThreshold, 50, 100, base.rapidVelocityThreshold)),
    ordinaryMinResearchSources: Math.round(clamp(source.ordinaryMinResearchSources, 2, 10, base.ordinaryMinResearchSources)),
    sensitiveMinResearchSources: Math.round(clamp(source.sensitiveMinResearchSources, 3, 15, base.sensitiveMinResearchSources)),
    globalImpactMinResearchSources: Math.round(clamp(source.globalImpactMinResearchSources, 3, 15, base.globalImpactMinResearchSources)),
    requirePrimaryForSensitive: Boolean(source.requirePrimaryForSensitive),
    requirePrimaryForGlobalImpact: Boolean(source.requirePrimaryForGlobalImpact),
    mapLocationThreshold: Math.round(clamp(source.mapLocationThreshold, 1, 6, base.mapLocationThreshold)),
    maxResearchQuestions: Math.round(clamp(source.maxResearchQuestions, 3, 15, base.maxResearchQuestions))
  };
}

function eventConcepts(candidate) {
  return uniq(candidate?.event?.concepts || candidate?.event?.signature?.concepts || candidate?.cluster?.topicTokens || [], 60).map(value => value.toLowerCase());
}

function eventLocations(candidate) {
  return uniq(candidate?.event?.locations || candidate?.event?.signature?.locations || [], 40);
}

function actionOf(brainDecision, decision) {
  return clean(brainDecision?.action || decision?.action || 'WAIT', 40).toUpperCase();
}

function changeKind(candidate) {
  return clean(candidate?.event?.changeClassification?.kind || candidate?.event?.change_kind || candidate?.cluster?.materialChange?.kind || (candidate?.cluster?.materialChange?.changed ? 'material_update' : 'observation'), 80).toLowerCase();
}

function isSensitive(candidate, brainDecision) {
  if (brainDecision?.signals?.sensitive) return true;
  return eventConcepts(candidate).some(concept => SENSITIVE_CONCEPTS.has(concept));
}

function chooseFormat(candidate, brainDecision, decision, policyInput) {
  const policy = normalizePolicy(policyInput);
  const action = actionOf(brainDecision, decision);
  const importance = clamp(candidate?.importance?.importanceScore || candidate?.cluster?.importance?.importanceScore, 0, 100, 0);
  const confidence = clamp(candidate?.importance?.confidenceScore || candidate?.cluster?.scores?.confidenceScore, 0, 100, 0);
  const velocity = clamp(candidate?.cluster?.scores?.velocityScore, 0, 100, 0);
  if (action === 'BREAKING') return 'breaking_brief';
  if (action === 'UPDATE') return 'update_brief';
  if (action === 'FOLLOW_UP') return 'follow_up_explainer';
  if (importance >= policy.deepDiveImportanceThreshold && confidence >= 65) return 'deep_dive';
  if (velocity >= policy.rapidVelocityThreshold) return 'rapid_explainer';
  return 'standard_explainer';
}

function durationFor(format, policyInput) {
  const policy = normalizePolicy(policyInput);
  const minutes = format === 'breaking_brief' ? policy.breakingMinutes
    : format === 'update_brief' ? policy.updateMinutes
      : format === 'follow_up_explainer' ? policy.followUpMinutes
        : format === 'deep_dive' ? policy.deepDiveMinutes
          : format === 'rapid_explainer' ? Math.max(4, Math.min(policy.standardMinutes, 6))
            : policy.standardMinutes;
  return minutes * 60;
}

function urgencyFor(format, brainDecision) {
  if (format === 'breaking_brief') return 'critical';
  if (format === 'update_brief' || brainDecision?.urgency === 'high') return 'high';
  if (format === 'deep_dive') return 'deep';
  return 'standard';
}

function neutralAngle(action, format) {
  if (action === 'BREAKING') return 'Explain only what is confirmed so far, what remains uncertain, the verified timeline, and why the development matters internationally.';
  if (action === 'UPDATE') return 'Focus on material changes since the previous coverage, clearly separating newly confirmed facts, corrections, unresolved claims, and what has not changed.';
  if (action === 'FOLLOW_UP') return 'Explain the latest verified developments, how they connect to the earlier event, and what remains unresolved without predicting outcomes.';
  if (format === 'deep_dive') return 'Build a sourced international explainer covering the verified timeline, structural impact, affected regions, key institutions, uncertainties, and competing factual interpretations where relevant.';
  if (format === 'rapid_explainer') return 'Give a concise verified account of what happened, what is known, why attention is rising, and which facts still require confirmation.';
  return 'Explain what happened, the verified timeline, the main factual context, the structural international impact, and the important uncertainties.';
}

function researchRequirements(candidate, brainDecision, format, policyInput) {
  const policy = normalizePolicy(policyInput);
  const sensitive = isSensitive(candidate, brainDecision);
  const importanceScore = clamp(candidate?.importance?.importanceScore, 0, 100, 0);
  const impactTier = clean(candidate?.importance?.impactTier, 40).toLowerCase();
  const globalImpact = ['global','systemic'].includes(impactTier) || importanceScore >= policy.deepDiveImportanceThreshold;
  let minimumIndependentSources = policy.ordinaryMinResearchSources;
  if (sensitive) minimumIndependentSources = Math.max(minimumIndependentSources, policy.sensitiveMinResearchSources);
  if (globalImpact) minimumIndependentSources = Math.max(minimumIndependentSources, policy.globalImpactMinResearchSources);
  if (format === 'deep_dive') minimumIndependentSources = Math.max(minimumIndependentSources, 5);
  const primarySourceRequired = (sensitive && policy.requirePrimaryForSensitive) || (globalImpact && policy.requirePrimaryForGlobalImpact);
  const concepts = eventConcepts(candidate);
  const questions = [
    'What facts are independently confirmed right now?',
    'What is the earliest verifiable point in the event timeline?',
    'Which claims remain unverified, disputed, corrected, or based on a single source?',
    'What primary or official evidence is available?',
    'What changed materially since the previous known event revision?',
    'Which regions or populations are directly affected?',
    'What structural consequences are supported by evidence rather than speculation?',
    'What facts would materially change this report if confirmed later?'
  ].slice(0, policy.maxResearchQuestions);
  return {
    minimumIndependentSources,
    primarySourceRequired,
    crossSourceConfirmationRequired: true,
    preserveUncertaintyLabels: true,
    requirePublicationTimestampCheck: true,
    requireSourceProvenance: true,
    sensitive,
    globalImpact,
    concepts,
    questions
  };
}

function visualRequirements(candidate, format, policyInput) {
  const policy = normalizePolicy(policyInput);
  const locations = eventLocations(candidate);
  const concepts = eventConcepts(candidate);
  const change = changeKind(candidate);
  const needsMap = locations.length >= policy.mapLocationThreshold || clamp(candidate?.cluster?.scores?.geographyScore, 0, 100, 0) >= 70;
  const needsTimeline = ['breaking_brief','update_brief','follow_up_explainer','deep_dive'].includes(format) || ['material_update','escalation','resolution','correction'].includes(change);
  const needsDataChart = concepts.some(concept => DATA_CONCEPTS.has(concept));
  const needsDocumentEvidence = concepts.some(concept => CIVIC_CONCEPTS.has(concept));
  return {
    needsMap,
    needsTimeline,
    needsDataChart,
    needsDocumentEvidence,
    locations,
    avoidUnlicensedPublisherMedia: true,
    preferSourceLinkedGraphics: true,
    generatedVisualsMustNotImplyUnverifiedFacts: true,
    visualEvidenceMustMatchNarration: true
  };
}

function buildPlan(candidate, brainDecision, decision, context = {}) {
  const policy = normalizePolicy(context.policy);
  const action = actionOf(brainDecision, decision);
  if (!ACTIONABLE.has(action) || brainDecision?.selected === false) return null;
  const format = chooseFormat(candidate, brainDecision, decision, policy);
  const targetDurationSeconds = durationFor(format, policy);
  const urgency = urgencyFor(format, brainDecision);
  const title = clean(candidate?.cluster?.canonicalTitle || 'International development', 180);
  const topic = action === 'UPDATE' ? `${title} — What Changed`.slice(0, 200)
    : action === 'FOLLOW_UP' ? `${title} — Latest Developments`.slice(0, 200)
      : title.slice(0, 200);
  const angle = neutralAngle(action, format);
  const research = researchRequirements(candidate, brainDecision, format, policy);
  const visuals = visualRequirements(candidate, format, policy);
  const audience = 'International general audience seeking a concise, evidence-led explanation without assumed specialist knowledge.';
  const handoff = {
    research: `Verify the event using at least ${research.minimumIndependentSources} independent sources${research.primarySourceRequired ? ' including a primary or official source when available' : ''}. Keep disputed and unverified claims explicitly labeled.`,
    script: `Write a ${Math.round(targetDurationSeconds / 60)} minute ${format.replace(/_/g, ' ')}. Use the verified timeline and distinguish confirmed facts, attributed claims, uncertainty and analysis.`,
    visuals: `Use only rights-safe or generated visuals that do not imply unverified facts.${visuals.needsMap ? ' Include a sourced map.' : ''}${visuals.needsTimeline ? ' Include a timeline.' : ''}${visuals.needsDataChart ? ' Include a sourced data chart when the data is verified.' : ''}`,
    publishing: urgency === 'critical' ? 'Prioritize speed after factual and quality gates pass; do not bypass approval/publishing controls.' : 'Use the normal editorial queue after factual and quality gates pass.'
  };
  const rationale = `Editorial Planning AI selected ${format}, ${Math.round(targetDurationSeconds / 60)} minutes, urgency ${urgency}. Action ${action}; structural importance ${Math.round(clamp(candidate?.importance?.importanceScore, 0, 100, 0))}/100; coverage confidence ${Math.round(clamp(candidate?.cluster?.scores?.confidenceScore, 0, 100, 0))}/100; velocity ${Math.round(clamp(candidate?.cluster?.scores?.velocityScore, 0, 100, 0))}/100. Research requires ${research.minimumIndependentSources} independent sources${research.primarySourceRequired ? ' plus primary/official evidence when available' : ''}.`;
  return {
    version: VERSION,
    action,
    topic,
    angle,
    format,
    urgency,
    targetDurationSeconds,
    targetLengthMinutes: Math.round(targetDurationSeconds / 60),
    audience,
    research,
    visuals,
    handoff,
    rationale,
    policy
  };
}

class EditorialPlanningAIV125 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_EDITORIAL_PLANNING_ENABLED || 'true').toLowerCase() !== 'false',
      defaultPolicy: normalizePolicy(this.policyOverride || {
        breakingMinutes: process.env.NEWSROOM_PLANNING_BREAKING_MINUTES,
        standardMinutes: process.env.NEWSROOM_PLANNING_STANDARD_MINUTES,
        deepDiveMinutes: process.env.NEWSROOM_PLANNING_DEEP_DIVE_MINUTES,
        deepDiveImportanceThreshold: process.env.NEWSROOM_PLANNING_DEEP_DIVE_IMPORTANCE,
        rapidVelocityThreshold: process.env.NEWSROOM_PLANNING_RAPID_VELOCITY,
        ordinaryMinResearchSources: process.env.NEWSROOM_PLANNING_ORDINARY_MIN_SOURCES,
        sensitiveMinResearchSources: process.env.NEWSROOM_PLANNING_SENSITIVE_MIN_SOURCES
      })
    };
  }

  async getPolicy() {
    const base = this.getConfig().defaultPolicy;
    if (!this.db) return { revisionNumber: 0, policy: base, source: 'default' };
    const row = await this.db.getRow('SELECT * FROM newsroom_editorial_plan_policy_revisions ORDER BY revision_number DESC LIMIT 1');
    if (!row) return { revisionNumber: 0, policy: base, source: 'default' };
    return { revisionNumber: Number(row.revision_number || 0), policy: normalizePolicy({ ...base, ...parseJson(row.policy_json, {}) }), reason: row.reason, createdBy: row.created_by, createdAt: row.created_at, source: 'persisted' };
  }

  async setPolicy(patch, actor = 'operator', reason = '') {
    if (!this.db) throw Object.assign(new Error('editorial_planning_policy_persistence_required'), { code: 'editorial_planning_policy_persistence_required' });
    const explanation = clean(reason, 500);
    if (explanation.length < 8) throw Object.assign(new Error('editorial_planning_policy_reason_required'), { code: 'editorial_planning_policy_reason_required' });
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      const current = await this.db.getRow('SELECT * FROM newsroom_editorial_plan_policy_revisions ORDER BY revision_number DESC LIMIT 1');
      const currentPolicy = current ? parseJson(current.policy_json, {}) : this.getConfig().defaultPolicy;
      const nextPolicy = normalizePolicy({ ...currentPolicy, ...(patch || {}) });
      const revisionNumber = Number(current?.revision_number || 0) + 1;
      const fingerprint = hash(JSON.stringify(nextPolicy)).slice(0, 32);
      const id = `news_plan_policy_${revisionNumber}_${fingerprint.slice(0, 16)}`;
      await this.db.executeQuery('INSERT INTO newsroom_editorial_plan_policy_revisions (id, revision_number, policy_json, policy_fingerprint, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', [id, revisionNumber, JSON.stringify(nextPolicy), fingerprint, explanation, clean(actor, 200) || 'operator']);
      await this.db.executeQuery('COMMIT');
      return { id, revisionNumber, policy: nextPolicy, fingerprint, reason: explanation, createdBy: clean(actor, 200) || 'operator' };
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
  }

  async createPlan(candidate, brainDecision, decision, context = {}) {
    if (String(process.env.NEWSROOM_EDITORIAL_PLANNING_ENABLED || 'true').toLowerCase() === 'false') return null;
    const policyState = await this.getPolicy();
    const plan = buildPlan(candidate, brainDecision, decision, { policy: policyState.policy });
    if (!plan) return null;
    const scanId = clean(context.scanId, 200) || null;
    const clusterId = clean(candidate?.cluster?.id, 200) || null;
    const eventId = clean(candidate?.event?.id, 200) || null;
    const eventRevision = Number(candidate?.event?.revisionNumber || 0);
    const decisionId = clean(decision?.id, 200) || null;
    const brainDecisionId = clean(brainDecision?.id, 200) || null;
    const importanceId = clean(candidate?.importance?.id, 200) || null;
    const fingerprint = hash(JSON.stringify({ version: VERSION, scanId, clusterId, eventId, eventRevision, decisionId, brainDecisionId, importanceId, materialFingerprint: candidate?.cluster?.materialFingerprint || null, policyRevision: policyState.revisionNumber, format: plan.format, targetDurationSeconds: plan.targetDurationSeconds, research: plan.research, visuals: plan.visuals })).slice(0, 32);
    const id = `news_editorial_plan_${fingerprint.slice(0, 24)}`;
    const result = { ...plan, id, fingerprint, scanId, clusterId, eventId, eventRevision, decisionId, brainDecisionId, importanceId, policyRevision: policyState.revisionNumber, promotedIdeaId: null, assignmentId: null };
    if (this.db && clusterId) {
      await this.db.executeQuery(`INSERT OR IGNORE INTO newsroom_editorial_plans (id, scan_id, cluster_id, event_id, event_revision, decision_id, brain_decision_id, importance_assessment_id, planner_version, action, topic, angle, format, urgency, target_duration_seconds, audience, research_json, visuals_json, handoff_json, rationale, policy_revision, plan_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [id, scanId, clusterId, eventId, eventRevision, decisionId, brainDecisionId, importanceId, VERSION, plan.action, plan.topic, plan.angle, plan.format, plan.urgency, plan.targetDurationSeconds, plan.audience, JSON.stringify(plan.research), JSON.stringify(plan.visuals), JSON.stringify(plan.handoff), plan.rationale, policyState.revisionNumber, fingerprint]);
    }
    return result;
  }

  async linkPromotion(planId, promotion) {
    if (!this.db || !planId || !promotion) return null;
    await this.db.executeQuery('UPDATE newsroom_editorial_plans SET promoted_idea_id = COALESCE(promoted_idea_id, ?), assignment_id = COALESCE(assignment_id, ?) WHERE id = ?', [promotion?.idea?.id || null, promotion?.assignmentId || null, planId]);
    return this.getPlan(planId);
  }

  async getPlan(planId) {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT * FROM newsroom_editorial_plans WHERE id = ?', [planId]);
    return row ? this.serialize(row) : null;
  }

  serialize(row) {
    return {
      id: row.id, scanId: row.scan_id, clusterId: row.cluster_id, eventId: row.event_id,
      eventRevision: Number(row.event_revision || 0), decisionId: row.decision_id, brainDecisionId: row.brain_decision_id,
      importanceId: row.importance_assessment_id, version: row.planner_version, action: row.action, topic: row.topic,
      angle: row.angle, format: row.format, urgency: row.urgency, targetDurationSeconds: Number(row.target_duration_seconds || 0),
      targetLengthMinutes: Math.round(Number(row.target_duration_seconds || 0) / 60), audience: row.audience,
      research: parseJson(row.research_json, {}), visuals: parseJson(row.visuals_json, {}), handoff: parseJson(row.handoff_json, {}),
      rationale: row.rationale, policyRevision: Number(row.policy_revision || 0), fingerprint: row.plan_fingerprint,
      promotedIdeaId: row.promoted_idea_id || null, assignmentId: row.assignment_id || null, createdAt: row.created_at
    };
  }

  async listPlans(limit = 100, format = null) {
    if (!this.db) return [];
    const params = [];
    let sql = 'SELECT * FROM newsroom_editorial_plans';
    if (format && FORMATS.has(String(format).toLowerCase())) { sql += ' WHERE format = ?'; params.push(String(format).toLowerCase()); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const rows = await this.db.getAllRows(sql, params);
    return rows.map(row => this.serialize(row));
  }

  async status() {
    return { version: VERSION, enabled: this.getConfig().enabled, policy: await this.getPolicy(), recentPlans: await this.listPlans(30) };
  }
}

module.exports = {
  VERSION, FORMATS, URGENCIES, ACTIONABLE, defaultPolicy, normalizePolicy, eventConcepts, eventLocations,
  chooseFormat, durationFor, urgencyFor, researchRequirements, visualRequirements, buildPlan, EditorialPlanningAIV125
};
