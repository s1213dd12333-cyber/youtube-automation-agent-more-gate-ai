'use strict';

const crypto = require('crypto');

const VERSION = 10;
const DEFAULT_TOPIC_THRESHOLD = 0.72;

function clean(value, limit = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeTopic(value) {
  return clean(value, 500)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an|and|or|of|to|in|on|for|with|from|what|why|how|when|where|is|are|was|were)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function topicTokens(value) {
  return normalizeTopic(value).split(/\s+/).filter(token => token.length >= 2);
}

function ngrams(tokens, size = 2) {
  if (tokens.length < size) return tokens;
  const output = [];
  for (let i = 0; i <= tokens.length - size; i++) output.push(tokens.slice(i, i + size).join(' '));
  return output;
}

function dice(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return (2 * common) / (a.size + b.size);
}

function topicSimilarity(a, b) {
  const left = topicTokens(a);
  const right = topicTokens(b);
  if (!left.length || !right.length) return 0;
  const tokenScore = dice(left, right);
  const bigramScore = dice(ngrams(left, 2), ngrams(right, 2));
  const exact = normalizeTopic(a) === normalizeTopic(b) ? 1 : 0;
  return Number(Math.max(exact, tokenScore * 0.72 + bigramScore * 0.28).toFixed(4));
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || value === true;
}

function publicationBlockers(bundle = {}, approvalRequired = true) {
  const blockers = [];
  if (!bundle?.id) return ['production_missing'];
  if (approvalRequired && bundle.review_status !== 'approved') blockers.push('human_approval');
  if (bundle.qualityAgentReport?.status === 'blocked') blockers.push('quality_agents');
  if (!['verified', 'not_required'].includes(bundle.provenance?.status || 'not_required')) blockers.push('provenance');
  const unresolvedRights = (bundle.scenes || []).filter(scene =>
    ['uploaded', 'licensed-source', 'source'].includes(scene.assetOrigin) && !scene.rightsConfirmed
  );
  if (unresolvedRights.length) blockers.push('media_rights');
  if (!bundle.assets?.finalVideo?.path || bundle.assets?.finalVideo?.simulated) blockers.push('final_video');
  const audio = bundle.assets?.audio || {};
  const intentionalSilence = audio.intentionalSilence === true && clean(audio.silenceReason).length >= 10 && Boolean(audio.silenceConfirmedAt);
  const sceneNarration = (bundle.scenes || []).length > 0 && (bundle.scenes || []).every(scene =>
    ['current', 'intentional_silence'].includes(scene.narrationStatus)
  );
  if (!intentionalSilence && !audio.path && !sceneNarration) blockers.push('narration');
  return blockers;
}

function repairDecision(report = {}, options = {}) {
  const enabled = options.enabled !== undefined ? Boolean(options.enabled) : asBool(process.env.AUTONOMY_AUTO_REPAIR, true);
  const attempts = Number(options.attempts || 0);
  const maxAttempts = Math.max(0, Number(options.maxAttempts ?? process.env.AUTONOMY_AUTO_REPAIR_MAX_ATTEMPTS ?? 1));
  const blockers = Array.isArray(report.blockingFindings) ? report.blockingFindings : [];
  if (!enabled || !blockers.length || attempts >= maxAttempts) {
    return { automatic: false, stage: null, reason: !enabled ? 'disabled' : attempts >= maxAttempts ? 'attempt_limit' : 'no_blockers' };
  }

  const ids = blockers.map(item => String(item.id || item.findingId || '')).filter(Boolean);
  const agents = new Set(blockers.map(item => String(item.agentId || item.agent || '')).filter(Boolean));
  const has = pattern => ids.some(value => pattern.test(value));

  // Text-only repairs are allowed automatically. Media regeneration can consume image/video credits and stays manual.
  if (has(/^seo_/) || agents.has('seo')) return { automatic: true, stage: 'seo', reason: 'text_only_seo_repair' };
  if (has(/^retention_/) || has(/^fact_/) || agents.has('retention') || agents.has('fact')) {
    return { automatic: true, stage: 'script', reason: 'text_only_script_repair' };
  }
  if (has(/^visual_missing/) || has(/^visual_stale/)) return { automatic: true, stage: 'production', reason: 'resume_missing_media_only' };
  if (has(/^thumbnail_/) || agents.has('thumbnail')) return { automatic: false, stage: 'thumbnail', reason: 'media_cost_confirmation_required' };
  if (has(/^visual_/) || agents.has('visual')) return { automatic: false, stage: 'production', reason: 'visual_cost_or_rights_review_required' };
  return { automatic: false, stage: null, reason: 'no_safe_repair_mapping' };
}

class AutonomyObservabilityV10 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.topicThreshold = Math.max(0.3, Math.min(0.98, Number(options.topicThreshold ?? process.env.TOPIC_NEAR_DUPLICATE_THRESHOLD ?? DEFAULT_TOPIC_THRESHOLD)));
    this.topicWindowDays = Math.max(7, Math.min(3650, Number(options.topicWindowDays ?? process.env.TOPIC_LIBRARY_WINDOW_DAYS ?? 365)));
  }

  async withSpan(input = {}, producer) {
    const traceId = input.traceId || `trace_${input.jobId || input.operatorRunId || Date.now()}`;
    const spanId = id('span');
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    await this.db?.startAutonomyTraceSpan?.({
      id: spanId, traceId, parentSpanId: input.parentSpanId || null,
      operatorRunId: input.operatorRunId || null, jobId: input.jobId || null,
      productionId: input.productionId || null, stage: input.stage || 'unknown',
      operation: input.operation || input.stage || 'unknown', status: 'running',
      metadata: input.metadata || {}, startedAt
    });
    try {
      const result = await producer();
      await this.db?.finishAutonomyTraceSpan?.(spanId, {
        status: 'succeeded', durationMs: Date.now() - startedMs, completedAt: new Date().toISOString()
      });
      return result;
    } catch (error) {
      await this.db?.finishAutonomyTraceSpan?.(spanId, {
        status: 'failed', durationMs: Date.now() - startedMs,
        error: clean(error.message, 2000), completedAt: new Date().toISOString()
      }).catch(() => {});
      throw error;
    }
  }

  async recordEvent(input = {}) {
    if (!this.db?.saveAutonomyEvent) return null;
    return this.db.saveAutonomyEvent({
      id: input.id || id('autonomy_event'),
      operatorRunId: input.operatorRunId || null,
      jobId: input.jobId || null,
      productionId: input.productionId || null,
      eventType: input.eventType || 'state_change',
      stage: input.stage || null,
      status: input.status || null,
      data: input.data || {},
      createdAt: input.createdAt || new Date().toISOString()
    });
  }

  async topicNovelty(topic, options = {}) {
    const threshold = Math.max(0.3, Math.min(0.98, Number(options.threshold ?? this.topicThreshold)));
    if (!clean(topic)) return { duplicate: false, score: 0, threshold, match: null, candidates: 0 };
    const days = Math.max(7, Math.min(3650, Number(options.days ?? this.topicWindowDays)));
    const rows = await this.db.getAllRows(
      `SELECT topic, created_at, 'strategy' AS source FROM content_strategies WHERE created_at >= datetime('now', ?)
       UNION ALL
       SELECT topic, created_at, 'job' AS source FROM generation_jobs WHERE topic IS NOT NULL AND created_at >= datetime('now', ?)`,
      [`-${days} days`, `-${days} days`]
    );
    let best = null;
    for (const row of rows) {
      const score = topicSimilarity(topic, row.topic);
      if (!best || score > best.score) best = { topic: row.topic, score, source: row.source, createdAt: row.created_at };
    }
    return {
      duplicate: Boolean(best && best.score >= threshold),
      score: best?.score || 0,
      threshold,
      match: best,
      candidates: rows.length,
      method: 'deterministic-token-bigram-proxy-v10'
    };
  }

  async assertTopicNovel(topic, options = {}) {
    if (options.allowDuplicate === true || asBool(process.env.ALLOW_NEAR_DUPLICATE_TOPICS, false)) return this.topicNovelty(topic, options);
    const result = await this.topicNovelty(topic, options);
    if (result.duplicate) {
      const error = new Error(`Topic is too similar to a recent topic (${Math.round(result.score * 100)}% similarity): ${result.match.topic}`);
      error.status = 409;
      error.code = 'SEMANTIC_TOPIC_DUPLICATE';
      error.details = result;
      throw error;
    }
    return result;
  }

  async usageForProduction(productionId) {
    const job = await this.db.getRow(
      'SELECT id FROM generation_jobs WHERE production_id = ? ORDER BY created_at DESC LIMIT 1',
      [productionId]
    );
    const jobId = job?.id || null;
    const where = jobId ? '(production_id = ? OR job_id = ?)' : 'production_id = ?';
    const params = jobId ? [productionId, jobId] : [productionId];
    const totals = await this.db.getRow(
      `SELECT COUNT(*) AS requests,
       SUM(CASE WHEN request_status != 'succeeded' THEN 1 ELSE 0 END) AS errors,
       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
       SUM(reasoning_tokens) AS reasoning_tokens, SUM(total_tokens) AS total_tokens,
       SUM(input_units) AS input_units, SUM(output_units) AS output_units,
       SUM(COALESCE(estimated_cost, 0)) AS estimated_cost, AVG(latency_ms) AS avg_latency_ms
       FROM ai_usage WHERE ${where}`,
      params
    );
    const providers = await this.db.getAllRows(
      `SELECT provider, resource_type, COUNT(*) AS requests, SUM(total_tokens) AS total_tokens,
       SUM(input_units) AS input_units, SUM(output_units) AS output_units,
       SUM(COALESCE(estimated_cost, 0)) AS estimated_cost
       FROM ai_usage WHERE ${where} GROUP BY provider, resource_type ORDER BY requests DESC`,
      params
    );
    return {
      productionId, jobId,
      totals: {
        requests: Number(totals?.requests || 0), errors: Number(totals?.errors || 0),
        inputTokens: Number(totals?.input_tokens || 0), outputTokens: Number(totals?.output_tokens || 0),
        reasoningTokens: Number(totals?.reasoning_tokens || 0), totalTokens: Number(totals?.total_tokens || 0),
        inputUnits: Number(totals?.input_units || 0), outputUnits: Number(totals?.output_units || 0),
        estimatedCost: Number(totals?.estimated_cost || 0), avgLatencyMs: Math.round(Number(totals?.avg_latency_ms || 0))
      },
      providers: providers.map(row => ({
        provider: row.provider, resourceType: row.resource_type, requests: Number(row.requests || 0),
        totalTokens: Number(row.total_tokens || 0), inputUnits: Number(row.input_units || 0),
        outputUnits: Number(row.output_units || 0), estimatedCost: Number(row.estimated_cost || 0)
      }))
    };
  }

  async publicationState(productionId) {
    const bundle = await this.db.getProductionBundle(productionId);
    if (!bundle) return { productionId, exists: false, canSchedule: false, canPublish: false, blockers: ['production_missing'] };
    const approvalRequired = await this.db.getSetting('approval_required') !== 'false';
    const blockers = publicationBlockers(bundle, approvalRequired);
    const schedule = bundle.schedule || null;
    return {
      productionId, exists: true, approvalRequired, reviewStatus: bundle.review_status || null,
      qualityStatus: bundle.qualityAgentReport?.status || null,
      provenanceStatus: bundle.provenance?.status || 'not_required',
      scheduleStatus: schedule?.status || null,
      blockers,
      canSchedule: blockers.length === 0,
      canPublish: blockers.length === 0 && Boolean(schedule && ['scheduled', 'paused', 'uploaded', 'published'].includes(schedule.status))
    };
  }

  async planAutomaticRepair(productionId, attempts = 0) {
    const bundle = await this.db.getProductionBundle(productionId);
    const decision = repairDecision(bundle?.qualityAgentReport || {}, { attempts });
    return { productionId, ...decision, report: bundle?.qualityAgentReport || null };
  }

  async doctor() {
    const checks = [];
    const add = (id, status, message, blocking = false, data = null) => checks.push({ id, status, message, blocking, data });
    try {
      const ping = await this.db.getRow('SELECT 1 AS ok');
      add('database', ping?.ok === 1 ? 'passed' : 'failed', ping?.ok === 1 ? 'SQLite responded.' : 'SQLite did not return the expected response.', true);
    } catch (error) {
      add('database', 'failed', error.message, true);
    }

    const readiness = await this.db.getLatestReadinessRun?.().catch(() => null);
    if (!readiness) add('readiness', 'warning', 'No Production Readiness run is recorded.', false);
    else if (readiness.status === 'failed') add('readiness', 'failed', 'The latest Production Readiness run failed.', true, readiness.summary || null);
    else add('readiness', readiness.status === 'warning' ? 'warning' : 'passed', `Latest Production Readiness status: ${readiness.status}.`, false, readiness.summary || null);

    const stuck = await this.db.getAllRows(
      `SELECT id, status, stage, updated_at FROM generation_jobs
       WHERE status IN ('queued', 'running') AND updated_at < datetime('now', '-2 hours') ORDER BY updated_at ASC LIMIT 20`
    ).catch(() => []);
    add('stuck_jobs', stuck.length ? 'warning' : 'passed', stuck.length ? `${stuck.length} generation job(s) have been active for more than two hours.` : 'No stale running generation jobs detected.', false, stuck);

    const unknownUploads = await this.db.getAllRows(
      `SELECT id, production_id, status, error_message FROM publish_schedule WHERE status = 'reconciliation_required' LIMIT 20`
    ).catch(() => []);
    add('upload_reconciliation', unknownUploads.length ? 'failed' : 'passed', unknownUploads.length ? `${unknownUploads.length} upload(s) require reconciliation before retry.` : 'No ambiguous YouTube upload outcomes detected.', true, unknownUploads);

    const waiting = await this.db.getAllRows(
      `SELECT p.id, cr.status AS review_status FROM productions p
       LEFT JOIN content_reviews cr ON cr.production_id = p.id
       WHERE cr.status IN ('needs_review', 'needs_attention') ORDER BY p.created_at DESC LIMIT 50`
    ).catch(() => []);
    add('editorial_queue', waiting.length ? 'warning' : 'passed', waiting.length ? `${waiting.length} production(s) are waiting for review or repair.` : 'Editorial queue has no unresolved reviews.', false, waiting);

    const ai = await this.db.getAIUsageSummary?.(24).catch(() => null);
    if (ai) add('ai_usage', ai.totals?.errors ? 'warning' : 'passed', `${ai.totals?.requests || 0} AI request(s) in 24h; ${ai.totals?.errors || 0} error(s).`, false, ai.totals || null);
    else add('ai_usage', 'warning', 'AI usage summary is unavailable.', false);

    const failed = checks.filter(item => item.status === 'failed');
    const blocking = failed.filter(item => item.blocking);
    return {
      version: VERSION,
      status: blocking.length ? 'failed' : failed.length || checks.some(item => item.status === 'warning') ? 'warning' : 'passed',
      checks,
      summary: {
        passed: checks.filter(item => item.status === 'passed').length,
        warnings: checks.filter(item => item.status === 'warning').length,
        failed: failed.length,
        blocking: blocking.length
      },
      completedAt: new Date().toISOString(),
      networkCallsMade: false
    };
  }
}

module.exports = {
  AUTONOMY_OBSERVABILITY_VERSION: VERSION,
  AutonomyObservabilityV10,
  normalizeTopic,
  topicSimilarity,
  publicationBlockers,
  repairDecision
};
