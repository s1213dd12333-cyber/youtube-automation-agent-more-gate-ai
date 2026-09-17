'use strict';

const crypto = require('crypto');

const VERSION = '12.8';
const PLAN_READY = 'PLAN_READY';
const PLAN_BLOCKED = 'PLAN_BLOCKED';

function clean(value, limit = 4000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function clamp(value, min, max, fallback) {
  const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function uniq(values) {
  const out = []; const seen = new Set();
  for (const value of values || []) { const v = clean(value, 600); const k = v.toLowerCase(); if (v && !seen.has(k)) { seen.add(k); out.push(v); } }
  return out;
}

function defaultPolicy() {
  return {
    localFirst: true,
    allowPremiumForBreaking: true,
    premiumImportanceThreshold: 82,
    premiumBreakingImportanceThreshold: 72,
    maxPremiumBudgetUsd: 8,
    standardBudgetUsd: 2,
    breakingBudgetUsd: 4,
    deepDiveBudgetUsd: 6,
    sceneSeconds: 18,
    maxScenes: 40,
    requireVerifiedTruthPacket: true,
    generatedVisualsCannotDepictUnverifiedFacts: true,
    preserveClaimWording: true,
    requireSourceAttributionForSensitiveClaims: true
  };
}
function normalizePolicy(input = {}) {
  const p = { ...defaultPolicy(), ...(input || {}) };
  return {
    localFirst: Boolean(p.localFirst),
    allowPremiumForBreaking: Boolean(p.allowPremiumForBreaking),
    premiumImportanceThreshold: Math.round(clamp(p.premiumImportanceThreshold, 50, 100, 82)),
    premiumBreakingImportanceThreshold: Math.round(clamp(p.premiumBreakingImportanceThreshold, 50, 100, 72)),
    maxPremiumBudgetUsd: clamp(p.maxPremiumBudgetUsd, 0, 100, 8),
    standardBudgetUsd: clamp(p.standardBudgetUsd, 0, 100, 2),
    breakingBudgetUsd: clamp(p.breakingBudgetUsd, 0, 100, 4),
    deepDiveBudgetUsd: clamp(p.deepDiveBudgetUsd, 0, 100, 6),
    sceneSeconds: Math.round(clamp(p.sceneSeconds, 8, 45, 18)),
    maxScenes: Math.round(clamp(p.maxScenes, 4, 80, 40)),
    requireVerifiedTruthPacket: Boolean(p.requireVerifiedTruthPacket),
    generatedVisualsCannotDepictUnverifiedFacts: Boolean(p.generatedVisualsCannotDepictUnverifiedFacts),
    preserveClaimWording: Boolean(p.preserveClaimWording),
    requireSourceAttributionForSensitiveClaims: Boolean(p.requireSourceAttributionForSensitiveClaims)
  };
}

function selectProductionMode(plan = {}, brainDecision = {}, importance = {}) {
  const format = String(plan.format || 'standard_explainer');
  const urgency = String(brainDecision.urgency || plan.urgency || 'standard');
  const score = Number(importance.importanceScore || 0);
  if (format === 'breaking_brief' || urgency === 'critical') return 'speed_first';
  if (format === 'deep_dive' || score >= 82) return 'depth_first';
  return 'balanced';
}

function selectVisualStrategy(plan = {}, mode = 'balanced') {
  const visuals = plan.visuals || {};
  const requiresEvidenceVisuals = Boolean(visuals.needsMap || visuals.needsTimeline || visuals.needsDataChart || visuals.needsDocuments);
  if (requiresEvidenceVisuals) return 'evidence_first_hybrid';
  if (mode === 'speed_first') return 'source_first';
  return 'hybrid';
}

function selectProviderTier(mode, importance = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput); const score = Number(importance.importanceScore || 0);
  if (mode === 'speed_first' && policy.allowPremiumForBreaking && score >= policy.premiumBreakingImportanceThreshold) return 'premium_allowed';
  if (mode === 'depth_first' && score >= policy.premiumImportanceThreshold) return 'premium_allowed';
  return policy.localFirst ? 'local_first' : 'standard';
}

function chooseBudget(mode, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const raw = mode === 'speed_first' ? policy.breakingBudgetUsd : mode === 'depth_first' ? policy.deepDiveBudgetUsd : policy.standardBudgetUsd;
  return Number(Math.min(policy.maxPremiumBudgetUsd, raw).toFixed(2));
}

function buildScenePlan(editorialPlan = {}, mode = 'balanced', policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const targetSeconds = Math.max(60, Number(editorialPlan.targetDurationSeconds || Number(editorialPlan.targetLengthMinutes || 8) * 60));
  const sceneSeconds = mode === 'speed_first' ? Math.max(10, Math.round(policy.sceneSeconds * 0.72)) : mode === 'depth_first' ? Math.min(30, Math.round(policy.sceneSeconds * 1.25)) : policy.sceneSeconds;
  const sceneCount = Math.max(4, Math.min(policy.maxScenes, Math.ceil(targetSeconds / sceneSeconds)));
  return { targetSeconds, sceneSeconds, sceneCount };
}

function buildFactLocks(claimPacket = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const claims = Array.isArray(claimPacket.claims) ? claimPacket.claims : [];
  return claims.map(claim => ({
    claimId: claim.id || null,
    classification: claim.classification,
    text: clean(claim.claimText || claim.question, 1200),
    mayParaphrase: policy.preserveClaimWording ? false : true,
    mustAttribute: policy.requireSourceAttributionForSensitiveClaims || claim.classification !== 'confirmed',
    supportingSources: Array.isArray(claim.supportingSources) ? claim.supportingSources.map(source => source.url).filter(Boolean).slice(0, 6) : []
  }));
}

function buildDirective(input = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const plan = input.editorialPlan || {};
  const truth = input.claimVerification || input.claimPacket || {};
  const importance = input.importance || input.candidate?.importance || {};
  const brainDecision = input.brainDecision || {};
  if (policy.requireVerifiedTruthPacket && truth.status !== 'VERIFIED') {
    return { status: PLAN_BLOCKED, reason: 'verified_truth_packet_required', version: VERSION };
  }
  const mode = selectProductionMode(plan, brainDecision, importance);
  const scenePlan = buildScenePlan(plan, mode, policy);
  const visuals = plan.visuals || {};
  const factLocks = buildFactLocks(truth, policy);
  const directive = {
    status: PLAN_READY,
    version: VERSION,
    mode,
    format: clean(plan.format || 'standard_explainer', 80),
    urgency: clean(brainDecision.urgency || plan.urgency || 'standard', 40),
    visualStrategy: selectVisualStrategy(plan, mode),
    providerTier: selectProviderTier(mode, importance, policy),
    maxBudgetUsd: chooseBudget(mode, policy),
    targetDurationSeconds: scenePlan.targetSeconds,
    sceneSeconds: scenePlan.sceneSeconds,
    sceneCount: scenePlan.sceneCount,
    tts: {
      priority: mode === 'speed_first' ? 'latency' : 'naturalness',
      fallbackAllowed: true,
      narrationMustMatchVerifiedClaims: true
    },
    visuals: {
      needsMap: Boolean(visuals.needsMap),
      needsTimeline: Boolean(visuals.needsTimeline),
      needsDataChart: Boolean(visuals.needsDataChart),
      needsDocuments: Boolean(visuals.needsDocuments),
      sourceFirst: true,
      generatedVisualsCannotDepictUnverifiedFacts: policy.generatedVisualsCannotDepictUnverifiedFacts
    },
    factLocks,
    forbidden: [
      'invent_facts',
      'upgrade_reported_to_confirmed',
      'remove_required_attribution',
      'depict_unverified_claim_as_observed_fact'
    ]
  };
  directive.fingerprint = hash(JSON.stringify({ version: VERSION, planId: plan.id || null, truth: truth.fingerprint || truth.id || null, importance: importance.id || importance.importanceScore || null, directive }));
  return directive;
}

class AutonomousProductionDirectorV128 {
  constructor(db, options = {}) { this.db = db || null; this.logger = options.logger || { info() {}, warn() {}, error() {} }; this.policyOverride = options.policy || null; }
  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_PRODUCTION_DIRECTOR_ENABLED || 'true').toLowerCase() !== 'false',
      policy: normalizePolicy(this.policyOverride || {
        localFirst: String(process.env.NEWSROOM_PRODUCTION_LOCAL_FIRST || 'true').toLowerCase() !== 'false',
        allowPremiumForBreaking: String(process.env.NEWSROOM_PRODUCTION_PREMIUM_BREAKING || 'true').toLowerCase() !== 'false',
        premiumImportanceThreshold: process.env.NEWSROOM_PRODUCTION_PREMIUM_IMPORTANCE,
        premiumBreakingImportanceThreshold: process.env.NEWSROOM_PRODUCTION_PREMIUM_BREAKING_IMPORTANCE,
        maxPremiumBudgetUsd: process.env.NEWSROOM_PRODUCTION_MAX_PREMIUM_USD,
        standardBudgetUsd: process.env.NEWSROOM_PRODUCTION_STANDARD_BUDGET_USD,
        breakingBudgetUsd: process.env.NEWSROOM_PRODUCTION_BREAKING_BUDGET_USD,
        deepDiveBudgetUsd: process.env.NEWSROOM_PRODUCTION_DEEP_DIVE_BUDGET_USD
      })
    };
  }
  rowToDirective(row) {
    if (!row) return null;
    const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch (_e) { return fallback; } };
    return {
      id: row.id, planId: row.plan_id, claimPacketId: row.claim_packet_id, decisionId: row.decision_id,
      clusterId: row.cluster_id, status: row.status, version: row.engine_version, mode: row.mode,
      format: row.format, urgency: row.urgency, visualStrategy: row.visual_strategy, providerTier: row.provider_tier,
      maxBudgetUsd: Number(row.max_budget_usd || 0), targetDurationSeconds: Number(row.target_duration_seconds || 0),
      sceneSeconds: Number(row.scene_seconds || 0), sceneCount: Number(row.scene_count || 0),
      tts: parse(row.tts_json, {}), visuals: parse(row.visuals_json, {}), factLocks: parse(row.fact_locks_json, []),
      forbidden: parse(row.forbidden_json, []), fingerprint: row.directive_fingerprint, assignmentId: row.assignment_id || null,
      createdAt: row.created_at
    };
  }
  async createDirective(input = {}) {
    if (!this.getConfig().enabled) return null;
    const built = buildDirective(input, this.getConfig().policy);
    if (built.status !== PLAN_READY) return built;
    if (!this.db) return built;
    const plan = input.editorialPlan || {}; const truth = input.claimVerification || input.claimPacket || {}; const decision = input.decision || {}; const cluster = input.candidate?.cluster || input.cluster || {};
    const id = `prod_${built.fingerprint.slice(0, 24)}`;
    await this.db.executeQuery(
      `INSERT OR IGNORE INTO newsroom_production_directives (id, plan_id, claim_packet_id, decision_id, cluster_id, engine_version, status, mode, format, urgency, visual_strategy, provider_tier, max_budget_usd, target_duration_seconds, scene_seconds, scene_count, tts_json, visuals_json, fact_locks_json, forbidden_json, directive_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, plan.id || null, truth.id || null, decision.id || null, cluster.id || null, VERSION, PLAN_READY, built.mode, built.format, built.urgency, built.visualStrategy, built.providerTier, built.maxBudgetUsd, built.targetDurationSeconds, built.sceneSeconds, built.sceneCount, JSON.stringify(built.tts), JSON.stringify(built.visuals), JSON.stringify(built.factLocks), JSON.stringify(built.forbidden), built.fingerprint]
    );
    const row = await this.db.getRow('SELECT * FROM newsroom_production_directives WHERE directive_fingerprint = ?', [built.fingerprint]);
    return this.rowToDirective(row);
  }
  async linkPromotion(id, promotion = {}) {
    if (!this.db || !id) return null;
    await this.db.executeQuery('UPDATE newsroom_production_directives SET assignment_id = COALESCE(assignment_id, ?) WHERE id = ?', [promotion.assignmentId || null, id]);
    return this.getDirective(id);
  }
  async getDirective(id) { if (!this.db) return null; return this.rowToDirective(await this.db.getRow('SELECT * FROM newsroom_production_directives WHERE id = ?', [id])); }
  async listDirectives(limit = 100) { if (!this.db) return []; const rows = await this.db.getAllRows('SELECT * FROM newsroom_production_directives ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(500, Number(limit) || 100))]); return rows.map(row => this.rowToDirective(row)); }
  async status() { const rows = await this.listDirectives(100); return { version: VERSION, enabled: this.getConfig().enabled, total: rows.length, ready: rows.filter(r => r.status === PLAN_READY).length, latest: rows[0] || null, policy: this.getConfig().policy }; }
}

module.exports = { VERSION, PLAN_READY, PLAN_BLOCKED, defaultPolicy, normalizePolicy, selectProductionMode, selectVisualStrategy, selectProviderTier, chooseBudget, buildScenePlan, buildFactLocks, buildDirective, AutonomousProductionDirectorV128 };
