'use strict';

const crypto = require('crypto');

const VERSION = '12.3';
const ACTIONS = new Set(['COVER','WAIT','IGNORE','UPDATE','BREAKING','FOLLOW_UP','DEFER']);
const LEGACY_ACTIONS = new Set(['COVER','WAIT','IGNORE','UPDATE','BREAKING','FOLLOW_UP']);
const ACTIONABLE = new Set(['COVER','UPDATE','BREAKING','FOLLOW_UP']);
const HIGH_SENSITIVITY_CONCEPTS = new Set([
  'election','attack','death','injury','arrest','emergency','ceasefire','ban'
]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clean(value, limit = 1200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
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
    mission: 'Cover globally relevant developments quickly while preserving evidence quality, geographic diversity, non-duplication and downstream factual verification.',
    targetCadenceMinutes: 120,
    maxSelectionsPerScan: 1,
    minIndependentSources: 3,
    minConfidence: 58,
    sensitiveMinIndependentSources: 4,
    sensitiveMinConfidence: 72,
    coverThreshold: 65,
    breakingThreshold: 88,
    followUpThreshold: 56,
    ignoreThreshold: 44,
    breakingVelocityThreshold: 68,
    diversityWindowHours: 6,
    sameLocationSoftLimit: 2,
    sameConceptSoftLimit: 3,
    diversityPenaltyPerRepeat: 4,
    maxDiversityPenalty: 16,
    breakingCooldownOverride: true,
    requireMaterialChangeForAssignedEvent: true
  };
}

function normalizePolicy(input = {}) {
  const base = defaultPolicy();
  const source = { ...base, ...(input || {}) };
  return {
    mission: clean(source.mission || base.mission, 1000),
    targetCadenceMinutes: clamp(source.targetCadenceMinutes, 15, 1440, base.targetCadenceMinutes),
    maxSelectionsPerScan: Math.round(clamp(source.maxSelectionsPerScan, 1, 10, base.maxSelectionsPerScan)),
    minIndependentSources: Math.round(clamp(source.minIndependentSources, 2, 12, base.minIndependentSources)),
    minConfidence: Math.round(clamp(source.minConfidence, 30, 95, base.minConfidence)),
    sensitiveMinIndependentSources: Math.round(clamp(source.sensitiveMinIndependentSources, 3, 15, base.sensitiveMinIndependentSources)),
    sensitiveMinConfidence: Math.round(clamp(source.sensitiveMinConfidence, 50, 98, base.sensitiveMinConfidence)),
    coverThreshold: Math.round(clamp(source.coverThreshold, 45, 95, base.coverThreshold)),
    breakingThreshold: Math.round(clamp(source.breakingThreshold, 65, 100, base.breakingThreshold)),
    followUpThreshold: Math.round(clamp(source.followUpThreshold, 35, 90, base.followUpThreshold)),
    ignoreThreshold: Math.round(clamp(source.ignoreThreshold, 0, 70, base.ignoreThreshold)),
    breakingVelocityThreshold: Math.round(clamp(source.breakingVelocityThreshold, 30, 100, base.breakingVelocityThreshold)),
    diversityWindowHours: clamp(source.diversityWindowHours, 1, 48, base.diversityWindowHours),
    sameLocationSoftLimit: Math.round(clamp(source.sameLocationSoftLimit, 1, 10, base.sameLocationSoftLimit)),
    sameConceptSoftLimit: Math.round(clamp(source.sameConceptSoftLimit, 1, 12, base.sameConceptSoftLimit)),
    diversityPenaltyPerRepeat: Math.round(clamp(source.diversityPenaltyPerRepeat, 0, 15, base.diversityPenaltyPerRepeat)),
    maxDiversityPenalty: Math.round(clamp(source.maxDiversityPenalty, 0, 40, base.maxDiversityPenalty)),
    breakingCooldownOverride: Boolean(source.breakingCooldownOverride),
    requireMaterialChangeForAssignedEvent: Boolean(source.requireMaterialChangeForAssignedEvent)
  };
}

function eventConcepts(candidate) {
  return uniq(candidate?.event?.concepts || candidate?.event?.signature?.concepts || [], 50);
}

function eventLocations(candidate) {
  return uniq(candidate?.event?.locations || candidate?.event?.signature?.locations || candidate?.cluster?.scores?.sourceRegions || [], 50);
}

function changeKind(candidate) {
  return clean(
    candidate?.event?.changeClassification?.kind ||
    candidate?.event?.change_kind ||
    candidate?.changeKind ||
    (candidate?.cluster?.materialChange?.changed ? 'material_update' : 'observation'),
    80
  ).toLowerCase();
}

function isMaterialEvolution(kind) {
  return ['new_event','material_update','escalation','resolution','correction'].includes(String(kind || '').toLowerCase());
}

function isSensitive(candidate) {
  const concepts = eventConcepts(candidate).map(value => value.toLowerCase());
  return concepts.some(concept => HIGH_SENSITIVITY_CONCEPTS.has(concept));
}

function diversityPenalty(candidate, recentSelections, policy) {
  const locations = eventLocations(candidate).map(value => value.toLowerCase());
  const concepts = eventConcepts(candidate).map(value => value.toLowerCase());
  if (!locations.length && !concepts.length) return { penalty: 0, locationRepeats: 0, conceptRepeats: 0 };

  let locationRepeats = 0;
  let conceptRepeats = 0;
  for (const previous of recentSelections || []) {
    const previousLocations = (previous.locations || []).map(value => String(value).toLowerCase());
    const previousConcepts = (previous.concepts || []).map(value => String(value).toLowerCase());
    if (locations.some(value => previousLocations.includes(value))) locationRepeats += 1;
    if (concepts.some(value => previousConcepts.includes(value))) conceptRepeats += 1;
  }

  const locationOver = Math.max(0, locationRepeats - policy.sameLocationSoftLimit + 1);
  const conceptOver = Math.max(0, conceptRepeats - policy.sameConceptSoftLimit + 1);
  const penalty = Math.min(policy.maxDiversityPenalty, (locationOver + conceptOver) * policy.diversityPenaltyPerRepeat);
  return { penalty, locationRepeats, conceptRepeats };
}

function scoreCandidate(candidate, context = {}) {
  const policy = normalizePolicy(context.policy);
  const scores = candidate?.cluster?.scores || {};
  const event = candidate?.event || {};
  const change = changeKind(candidate);
  const global = clamp(scores.globalScore, 0, 100, 0);
  const confidence = clamp(scores.confidenceScore ?? event.confidenceScore, 0, 100, 0);
  const velocity = clamp(scores.velocityScore, 0, 100, 0);
  const freshness = clamp(scores.freshnessScore, 0, 100, 50);
  const geography = clamp(scores.geographyScore, 0, 100, Math.min(100, Number(scores.regionCount || 0) * 24));
  const evolution = clamp(event.evolutionScore, 0, 100, change === 'observation' ? 15 : 65);

  let evolutionBonus = 0;
  if (change === 'escalation') evolutionBonus = 12;
  else if (change === 'correction') evolutionBonus = 10;
  else if (change === 'material_update') evolutionBonus = 8;
  else if (change === 'resolution') evolutionBonus = 7;
  else if (change === 'new_event') evolutionBonus = 5;

  const diversity = diversityPenalty(candidate, context.recentSelections || [], policy);
  const raw = global * 0.32 + confidence * 0.28 + velocity * 0.15 + freshness * 0.10 + geography * 0.08 + evolution * 0.07 + evolutionBonus;
  const priorityScore = Math.round(Math.max(0, Math.min(100, raw - diversity.penalty)));
  return {
    priorityScore,
    globalScore: Math.round(global),
    confidenceScore: Math.round(confidence),
    velocityScore: Math.round(velocity),
    freshnessScore: Math.round(freshness),
    geographyScore: Math.round(geography),
    evolutionScore: Math.round(evolution),
    evolutionBonus,
    diversityPenalty: diversity.penalty,
    locationRepeats: diversity.locationRepeats,
    conceptRepeats: diversity.conceptRepeats,
    independentEvidenceUnits: Number(scores.independentEvidenceUnits || 0),
    sourceCount: Number(scores.sourceCount || 0),
    regionCount: Number(scores.regionCount || 0),
    changeKind: change,
    sensitive: isSensitive(candidate),
    locations: eventLocations(candidate),
    concepts: eventConcepts(candidate)
  };
}

function classifyCandidate(candidate, context = {}) {
  const policy = normalizePolicy(context.policy);
  const signals = scoreCandidate(candidate, context);
  const previousAssigned = Boolean(candidate?.event?.previousAssigned || candidate?.previousAssigned || ['assigned','covered'].includes(candidate?.previous?.status));
  const materialChanged = isMaterialEvolution(signals.changeKind) && signals.changeKind !== 'new_event' || Boolean(candidate?.cluster?.materialChange?.changed && signals.changeKind !== 'observation');
  const minSources = signals.sensitive ? policy.sensitiveMinIndependentSources : policy.minIndependentSources;
  const minConfidence = signals.sensitive ? policy.sensitiveMinConfidence : policy.minConfidence;
  const reasonCodes = [];

  if (signals.sensitive) reasonCodes.push('sensitive_topic_stricter_evidence_gate');
  if (signals.independentEvidenceUnits < minSources) reasonCodes.push('insufficient_independent_sources');
  if (signals.confidenceScore < minConfidence) reasonCodes.push('coverage_confidence_below_threshold');

  let action = 'WAIT';
  if (previousAssigned && policy.requireMaterialChangeForAssignedEvent && !materialChanged) {
    action = 'IGNORE';
    reasonCodes.push('already_covered_without_material_change');
  } else if (signals.independentEvidenceUnits < minSources || signals.confidenceScore < minConfidence) {
    action = 'WAIT';
    reasonCodes.push('wait_for_more_evidence');
  } else if (previousAssigned) {
    if (signals.priorityScore >= policy.followUpThreshold) {
      action = signals.changeKind === 'observation' ? 'FOLLOW_UP' : 'UPDATE';
      reasonCodes.push(action === 'UPDATE' ? 'material_event_evolution' : 'follow_up_worth_monitoring');
    } else {
      action = 'WAIT';
      reasonCodes.push('follow_up_priority_below_threshold');
    }
  } else if (signals.priorityScore >= policy.breakingThreshold && signals.velocityScore >= policy.breakingVelocityThreshold) {
    action = 'BREAKING';
    reasonCodes.push('high_priority_fast_rising_event');
  } else if (signals.priorityScore >= policy.coverThreshold) {
    action = 'COVER';
    reasonCodes.push('editorial_priority_above_cover_threshold');
  } else if (signals.priorityScore < policy.ignoreThreshold) {
    action = 'IGNORE';
    reasonCodes.push('editorial_priority_below_ignore_threshold');
  } else {
    action = 'WAIT';
    reasonCodes.push('monitor_until_priority_or_evidence_improves');
  }

  if (signals.diversityPenalty > 0) reasonCodes.push('recent_coverage_diversity_penalty');
  const urgency = action === 'BREAKING' ? 'critical' : ['UPDATE','COVER'].includes(action) && signals.priorityScore >= 78 ? 'high' : ACTIONABLE.has(action) ? 'standard' : action === 'WAIT' ? 'monitor' : 'low';
  const format = action === 'BREAKING' ? 'breaking_explainer' : action === 'UPDATE' ? 'news_update' : action === 'FOLLOW_UP' ? 'follow_up' : 'explainer';
  const targetLengthMinutes = action === 'BREAKING' ? 5 : action === 'UPDATE' ? 6 : action === 'FOLLOW_UP' ? 7 : 8;
  const rationale = [
    `Editorial brain ${action}.`,
    `Priority ${signals.priorityScore}/100.`,
    `Repercussion ${signals.globalScore}/100, coverage-confidence ${signals.confidenceScore}/100, velocity ${signals.velocityScore}/100, freshness ${signals.freshnessScore}/100, geography ${signals.geographyScore}/100.`,
    `${signals.independentEvidenceUnits} independent evidence unit(s), ${signals.sourceCount} source domain(s), ${signals.regionCount} source region(s).`,
    `Event evolution: ${signals.changeKind}.`,
    signals.diversityPenalty ? `Diversity penalty ${signals.diversityPenalty}.` : 'No diversity penalty.',
    previousAssigned ? 'The event has prior coverage.' : 'No prior event-level coverage.'
  ].join(' ');

  return {
    action,
    legacyAction: LEGACY_ACTIONS.has(action) ? action : 'WAIT',
    selected: false,
    priorityScore: signals.priorityScore,
    urgency,
    format,
    targetLengthMinutes,
    rationale,
    reasonCodes: uniq(reasonCodes, 30),
    signals,
    previousAssigned,
    materialChanged
  };
}

function allocateCandidates(classified, context = {}) {
  const policy = normalizePolicy(context.policy);
  const lastAssignmentAt = context.lastAssignmentAt ? new Date(context.lastAssignmentAt) : null;
  const now = context.now ? new Date(context.now) : new Date();
  const sinceMinutes = lastAssignmentAt && !Number.isNaN(lastAssignmentAt.getTime()) ? (now.getTime() - lastAssignmentAt.getTime()) / 60000 : Infinity;
  const cooldownActive = sinceMinutes >= 0 && sinceMinutes < policy.targetCadenceMinutes;
  const nextEligibleAt = cooldownActive ? new Date(lastAssignmentAt.getTime() + policy.targetCadenceMinutes * 60000).toISOString() : null;

  const ordered = (classified || []).map(item => ({ ...item, reasonCodes: [...(item.reasonCodes || [])] })).sort((a, b) => {
    if (a.action === 'BREAKING' && b.action !== 'BREAKING') return -1;
    if (b.action === 'BREAKING' && a.action !== 'BREAKING') return 1;
    return Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
  });

  let selectedCount = 0;
  for (const decision of ordered) {
    if (!ACTIONABLE.has(decision.action)) continue;
    const mayBreakCooldown = decision.action === 'BREAKING' && policy.breakingCooldownOverride;
    if (cooldownActive && !mayBreakCooldown) {
      decision.action = 'DEFER';
      decision.legacyAction = 'WAIT';
      decision.selected = false;
      decision.nextEligibleAt = nextEligibleAt;
      decision.reasonCodes.push('editorial_cadence_cooldown');
      decision.rationale += ` Editorial cadence is cooling down; next normal slot ${nextEligibleAt}.`;
      continue;
    }
    if (selectedCount >= policy.maxSelectionsPerScan) {
      decision.action = 'DEFER';
      decision.legacyAction = 'WAIT';
      decision.selected = false;
      decision.reasonCodes.push('higher_priority_story_selected_for_this_scan');
      decision.rationale += ' Deferred because a higher-priority story already won the available editorial slot.';
      continue;
    }
    decision.selected = true;
    selectedCount += 1;
    decision.reasonCodes.push(mayBreakCooldown && cooldownActive ? 'breaking_cadence_override' : 'selected_for_editorial_slot');
  }

  return {
    decisions: ordered,
    cooldownActive,
    nextEligibleAt,
    selectedCount,
    targetCadenceMinutes: policy.targetCadenceMinutes,
    maxSelectionsPerScan: policy.maxSelectionsPerScan
  };
}

class EditorialDecisionBrainV123 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_EDITORIAL_BRAIN_ENABLED || 'true').toLowerCase() !== 'false',
      defaultPolicy: normalizePolicy(this.policyOverride || {
        targetCadenceMinutes: process.env.NEWSROOM_EDITORIAL_TARGET_CADENCE_MINUTES,
        maxSelectionsPerScan: process.env.NEWSROOM_EDITORIAL_MAX_SELECTIONS_PER_SCAN,
        minIndependentSources: process.env.NEWSROOM_EDITORIAL_MIN_INDEPENDENT_SOURCES,
        minConfidence: process.env.NEWSROOM_EDITORIAL_MIN_CONFIDENCE,
        sensitiveMinIndependentSources: process.env.NEWSROOM_EDITORIAL_SENSITIVE_MIN_SOURCES,
        sensitiveMinConfidence: process.env.NEWSROOM_EDITORIAL_SENSITIVE_MIN_CONFIDENCE,
        coverThreshold: process.env.NEWSROOM_EDITORIAL_COVER_THRESHOLD,
        breakingThreshold: process.env.NEWSROOM_EDITORIAL_BREAKING_THRESHOLD,
        breakingCooldownOverride: String(process.env.NEWSROOM_EDITORIAL_BREAKING_COOLDOWN_OVERRIDE || 'true').toLowerCase() !== 'false'
      })
    };
  }

  async getPolicy() {
    const base = this.getConfig().defaultPolicy;
    if (!this.db) return { revisionNumber: 0, policy: base, source: 'default' };
    const row = await this.db.getRow('SELECT * FROM global_news_editorial_policy_revisions ORDER BY revision_number DESC LIMIT 1');
    if (!row) return { revisionNumber: 0, policy: base, source: 'default' };
    return { revisionNumber: Number(row.revision_number || 0), policy: normalizePolicy({ ...base, ...parseJson(row.policy_json, {}) }), reason: row.reason, createdBy: row.created_by, createdAt: row.created_at, source: 'persisted' };
  }

  async setPolicy(patch, actor = 'operator', reason = '') {
    if (!this.db) throw Object.assign(new Error('editorial_policy_persistence_required'), { code: 'editorial_policy_persistence_required' });
    const explanation = clean(reason, 500);
    if (explanation.length < 8) throw Object.assign(new Error('editorial_policy_reason_required'), { code: 'editorial_policy_reason_required' });
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      const current = await this.db.getRow('SELECT * FROM global_news_editorial_policy_revisions ORDER BY revision_number DESC LIMIT 1');
      const currentPolicy = current ? parseJson(current.policy_json, {}) : this.getConfig().defaultPolicy;
      const nextPolicy = normalizePolicy({ ...currentPolicy, ...(patch || {}) });
      const revisionNumber = Number(current?.revision_number || 0) + 1;
      const fingerprint = hash(JSON.stringify(nextPolicy)).slice(0, 32);
      const id = `news_editorial_policy_${revisionNumber}_${fingerprint.slice(0, 16)}`;
      await this.db.executeQuery(
        `INSERT INTO global_news_editorial_policy_revisions (id, revision_number, policy_json, policy_fingerprint, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, revisionNumber, JSON.stringify(nextPolicy), fingerprint, explanation, clean(actor, 200) || 'operator']
      );
      await this.db.executeQuery('COMMIT');
      return { id, revisionNumber, policy: nextPolicy, fingerprint, reason: explanation, createdBy: clean(actor, 200) || 'operator' };
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
  }

  async recentSelections(policy) {
    if (!this.db) return [];
    const rows = await this.db.getAllRows(
      `SELECT signal_json FROM global_news_editorial_brain_decisions WHERE selected = 1 AND created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 100`,
      [`-${Math.max(1, Number(policy.diversityWindowHours || 6))} hours`]
    );
    return rows.map(row => {
      const signal = parseJson(row.signal_json, {});
      return { locations: signal.locations || [], concepts: signal.concepts || [] };
    });
  }

  async lastAssignmentAt() {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT created_at FROM global_news_event_assignments ORDER BY created_at DESC LIMIT 1');
    return row?.created_at || null;
  }

  async getRunForScan(scanId) {
    if (!this.db || !scanId) return null;
    const run = await this.db.getRow('SELECT * FROM global_news_editorial_brain_runs WHERE scan_id = ? LIMIT 1', [scanId]);
    if (!run) return null;
    const decisions = await this.listDecisions(200, null, run.id);
    return {
      id: run.id,
      scanId: run.scan_id,
      policyRevision: run.policy_revision,
      selectedCount: run.selected_count,
      cooldownActive: Boolean(run.cooldown_active),
      nextEligibleAt: run.next_eligible_at,
      createdAt: run.created_at,
      reused: true,
      decisions
    };
  }

  async planScan(candidates, context = {}) {
    if (String(process.env.NEWSROOM_EDITORIAL_BRAIN_ENABLED || 'true').toLowerCase() === 'false') return null;
    const scanId = clean(context.scanId, 200);
    if (this.db && scanId) {
      const reused = await this.getRunForScan(scanId);
      if (reused) return reused;
    }

    const policyState = await this.getPolicy();
    const policy = policyState.policy;
    const recentSelections = await this.recentSelections(policy);
    const lastAssignmentAt = await this.lastAssignmentAt();
    const classified = (candidates || []).map(candidate => ({
      clusterId: candidate?.cluster?.id || null,
      eventId: candidate?.event?.id || null,
      eventRevision: Number(candidate?.event?.revisionNumber || 0),
      materialFingerprint: candidate?.cluster?.materialFingerprint || null,
      ...classifyCandidate(candidate, { policy, recentSelections })
    }));
    const allocation = allocateCandidates(classified, { policy, lastAssignmentAt, now: context.now || new Date() });
    const runFingerprint = hash(JSON.stringify({ version: VERSION, scanId, policyRevision: policyState.revisionNumber, decisions: allocation.decisions.map(item => [item.clusterId, item.eventId, item.action, item.priorityScore, item.materialFingerprint, item.eventRevision]) })).slice(0, 32);
    const runId = `news_editorial_run_${runFingerprint.slice(0, 24)}`;

    if (this.db) {
      await this.db.executeQuery(
        `INSERT OR IGNORE INTO global_news_editorial_brain_runs (id, scan_id, brain_version, policy_revision, policy_json, selected_count, cooldown_active, next_eligible_at, run_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [runId, scanId || null, VERSION, policyState.revisionNumber, JSON.stringify(policy), allocation.selectedCount, allocation.cooldownActive ? 1 : 0, allocation.nextEligibleAt || null, runFingerprint]
      );
      for (const decision of allocation.decisions) {
        const fingerprint = hash(JSON.stringify({ runId, clusterId: decision.clusterId, eventId: decision.eventId, action: decision.action, priorityScore: decision.priorityScore, materialFingerprint: decision.materialFingerprint, eventRevision: decision.eventRevision, policyRevision: policyState.revisionNumber })).slice(0, 32);
        const id = `news_editorial_brain_decision_${fingerprint.slice(0, 24)}`;
        await this.db.executeQuery(
          `INSERT OR IGNORE INTO global_news_editorial_brain_decisions (id, run_id, scan_id, event_id, cluster_id, action, legacy_action, selected, priority_score, urgency, recommended_format, target_length_minutes, rationale, reason_codes_json, signal_json, policy_revision, decision_fingerprint, next_eligible_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [id, runId, scanId || null, decision.eventId || null, decision.clusterId, decision.action, decision.legacyAction, decision.selected ? 1 : 0, decision.priorityScore, decision.urgency, decision.format, decision.targetLengthMinutes, decision.rationale, JSON.stringify(decision.reasonCodes || []), JSON.stringify(decision.signals || {}), policyState.revisionNumber, fingerprint, decision.nextEligibleAt || null]
        );
        decision.id = id;
        decision.fingerprint = fingerprint;
      }
    }

    return {
      id: runId,
      scanId: scanId || null,
      version: VERSION,
      policyRevision: policyState.revisionNumber,
      policy,
      selectedCount: allocation.selectedCount,
      cooldownActive: allocation.cooldownActive,
      nextEligibleAt: allocation.nextEligibleAt,
      decisions: allocation.decisions,
      reused: false
    };
  }

  async listDecisions(limit = 100, action = null, runId = null) {
    if (!this.db) return [];
    const params = [];
    const where = [];
    if (action && ACTIONS.has(String(action).toUpperCase())) { where.push('action = ?'); params.push(String(action).toUpperCase()); }
    if (runId) { where.push('run_id = ?'); params.push(runId); }
    let sql = 'SELECT * FROM global_news_editorial_brain_decisions';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC, priority_score DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const rows = await this.db.getAllRows(sql, params);
    return rows.map(row => ({
      id: row.id,
      runId: row.run_id,
      scanId: row.scan_id,
      eventId: row.event_id,
      clusterId: row.cluster_id,
      action: row.action,
      legacyAction: row.legacy_action,
      selected: Boolean(row.selected),
      priorityScore: Number(row.priority_score || 0),
      urgency: row.urgency,
      format: row.recommended_format,
      targetLengthMinutes: row.target_length_minutes,
      rationale: row.rationale,
      reasonCodes: parseJson(row.reason_codes_json, []),
      signals: parseJson(row.signal_json, {}),
      policyRevision: Number(row.policy_revision || 0),
      nextEligibleAt: row.next_eligible_at,
      createdAt: row.created_at
    }));
  }

  async status() {
    const policy = await this.getPolicy();
    if (!this.db) return { version: VERSION, policy, recentDecisions: [], lastRun: null };
    const run = await this.db.getRow('SELECT * FROM global_news_editorial_brain_runs ORDER BY created_at DESC LIMIT 1');
    return {
      version: VERSION,
      enabled: this.getConfig().enabled,
      policy,
      lastAssignmentAt: await this.lastAssignmentAt(),
      lastRun: run ? { id: run.id, scanId: run.scan_id, selectedCount: run.selected_count, cooldownActive: Boolean(run.cooldown_active), nextEligibleAt: run.next_eligible_at, createdAt: run.created_at } : null,
      recentDecisions: await this.listDecisions(30)
    };
  }
}

module.exports = {
  VERSION,
  ACTIONS,
  ACTIONABLE,
  defaultPolicy,
  normalizePolicy,
  isSensitive,
  scoreCandidate,
  classifyCandidate,
  allocateCandidates,
  EditorialDecisionBrainV123
};
