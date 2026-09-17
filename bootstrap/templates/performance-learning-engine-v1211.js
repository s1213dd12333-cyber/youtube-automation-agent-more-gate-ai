'use strict';

const crypto = require('crypto');

const VERSION = '12.11';
const STOP_WORDS = new Set([
  'about','after','again','against','also','among','and','are','because','been','before','being','between','both','but','can','could','does','doing','for','from','had','has','have','how','into','its','more','most','not','only','other','our','out','over','same','should','some','such','than','that','the','their','them','then','there','these','they','this','those','through','too','under','very','was','were','what','when','where','which','while','who','why','will','with','would','you','your'
]);

function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function parseJson(value, fallback = null) { try { return value == null ? fallback : JSON.parse(value); } catch (_error) { return fallback; } }
function slug(value) { return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120); }
function uniq(values, limit = 40) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const key = slug(value);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}
function tokens(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(word => word.length >= 4 && !STOP_WORDS.has(word));
}
function defaultPolicy() {
  return {
    minViewsForSignal: 20,
    minImpressionsForSignal: 100,
    minSamplesPerSignal: 2,
    maxPriorityAdjustment: 6,
    maxPlanningSignals: 8,
    minimumMeaningfulIndex: 0.08
  };
}
function normalizePolicy(input = {}) {
  const source = { ...defaultPolicy(), ...(input || {}) };
  return {
    minViewsForSignal: Math.round(clamp(source.minViewsForSignal, 1, 1000000, 20)),
    minImpressionsForSignal: Math.round(clamp(source.minImpressionsForSignal, 1, 100000000, 100)),
    minSamplesPerSignal: Math.round(clamp(source.minSamplesPerSignal, 2, 50, 2)),
    maxPriorityAdjustment: Math.round(clamp(source.maxPriorityAdjustment, 1, 10, 6)),
    maxPlanningSignals: Math.round(clamp(source.maxPlanningSignals, 1, 25, 8)),
    minimumMeaningfulIndex: clamp(source.minimumMeaningfulIndex, 0.01, 0.5, 0.08)
  };
}
function confidenceFor(metrics = {}) {
  if (number(metrics.impressions) >= 1000 && number(metrics.views) >= 100) return 'high';
  if (number(metrics.impressions) >= 100 && number(metrics.views) >= 20) return 'medium';
  return 'low';
}
function relative(value, baseline) {
  const current = number(value);
  const reference = number(baseline);
  if (!reference) return 0;
  return clamp((current - reference) / Math.abs(reference), -1, 1, 0);
}
function metricComposite(metrics, baseline) {
  return relative(metrics.ctr, baseline.ctr) * 0.25 +
    relative(metrics.retention, baseline.retention) * 0.30 +
    relative(metrics.views, baseline.views) * 0.15 +
    relative(metrics.commentsPerThousandViews, baseline.commentsPerThousandViews) * 0.10 +
    relative(metrics.viewsPerHour, baseline.viewsPerHour) * 0.20;
}

class PerformanceLearningEngineV1211 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.PERFORMANCE_LEARNING_ENABLED || 'true').toLowerCase() !== 'false',
      policy: normalizePolicy(this.policyOverride || {
        minViewsForSignal: process.env.PERFORMANCE_LEARNING_MIN_VIEWS,
        minImpressionsForSignal: process.env.PERFORMANCE_LEARNING_MIN_IMPRESSIONS,
        minSamplesPerSignal: process.env.PERFORMANCE_LEARNING_MIN_SAMPLES,
        maxPriorityAdjustment: process.env.PERFORMANCE_LEARNING_MAX_PRIORITY_ADJUSTMENT,
        maxPlanningSignals: process.env.PERFORMANCE_LEARNING_MAX_PLANNING_SIGNALS
      })
    };
  }

  dimensionsFrom(report = {}, context = {}) {
    const strategy = context.strategy || {};
    const event = context.event || context.newsroomEvent || context.newsroom?.event || {};
    const rawSubjects = [
      strategy.topic,
      context.topic,
      ...(Array.isArray(strategy.keywords) ? strategy.keywords : []),
      ...(Array.isArray(event.concepts) ? event.concepts : []),
      ...(Array.isArray(context.newsroom?.concepts) ? context.newsroom.concepts : [])
    ].filter(Boolean);
    const title = report.videoDetails?.title || context.title || context.script?.title || '';
    const explicit = uniq(rawSubjects.flatMap(value => [value, ...tokens(value)]), 30);
    const subjectKeys = explicit.length ? explicit : uniq(tokens(title), 16);
    return {
      subjectKeys,
      pillarKey: slug(strategy.contentPillar || strategy.pillar || context.pillar || ''),
      formatKey: slug(context.contentFormat === 'short' ? 'shorts' : strategy.requestedStyle || strategy.contentType || context.format || 'unknown') || 'unknown'
    };
  }

  metricsFrom(report = {}, measurementWindow = 'rolling') {
    const analytics = report.analytics || {};
    const views = analytics.views || {};
    const watchTime = analytics.watchTime || {};
    const video = report.videoDetails || {};
    const totalViews = Math.max(0, number(views.totalViews));
    const impressions = Math.max(0, number(views.totalImpressions || report.thumbnailMetrics?.impressions));
    const comments = Math.max(0, number(video.statistics?.commentCount));
    const publishedAt = new Date(video.publishedAt || report.publishedAt || 0);
    const measuredAt = new Date(report.analyzedAt || Date.now());
    const windowCap = measurementWindow === '24h' ? 24 : measurementWindow === '7d' ? 168 : 720;
    const rawElapsed = Number.isFinite(publishedAt.getTime()) && Number.isFinite(measuredAt.getTime())
      ? Math.max(1, (measuredAt.getTime() - publishedAt.getTime()) / 3600000)
      : windowCap;
    const elapsedHours = Math.max(1, Math.min(windowCap, rawElapsed));
    return {
      views: totalViews,
      impressions,
      ctr: Math.max(0, number(report.thumbnailMetrics?.clickThroughRate ?? views.averageCTR)),
      retention: Math.max(0, number(watchTime.averageViewPercentage)),
      comments,
      commentsPerThousandViews: totalViews > 0 ? Number(((comments / totalViews) * 1000).toFixed(4)) : 0,
      viewsPerHour: Number((totalViews / elapsedHours).toFixed(4)),
      engagementRate: Math.max(0, number(analytics.engagement?.engagementRate)),
      elapsedHours: Number(elapsedHours.toFixed(3))
    };
  }

  async capture(report = {}, context = {}, measurementWindow = 'rolling') {
    const config = this.getConfig();
    if (!config.enabled) return { ignored: true, reason: 'performance_learning_disabled', version: VERSION };
    if (report.analytics?.simulated) {
      this.logger.warn(`Performance Learning ignored simulated analytics for ${report.videoId || 'unknown video'}`);
      return { ignored: true, reason: 'simulated_analytics_excluded', version: VERSION };
    }
    if (!this.db) return { ignored: true, reason: 'persistence_unavailable', version: VERSION };

    const metrics = this.metricsFrom(report, measurementWindow);
    const dimensions = this.dimensionsFrom(report, context);
    const confidence = confidenceFor(metrics);
    const eligible = confidence !== 'low' && metrics.views >= config.policy.minViewsForSignal && metrics.impressions >= config.policy.minImpressionsForSignal;
    const videoId = String(report.videoId || report.videoDetails?.id || context.videoId || '').trim();
    if (!videoId) throw Object.assign(new Error('performance_learning_video_id_required'), { code: 'performance_learning_video_id_required' });
    const measuredAt = new Date(report.analyzedAt || Date.now()).toISOString();
    const publishedAt = report.videoDetails?.publishedAt || context.publishedAt || null;
    const fingerprint = hash(JSON.stringify({ version: VERSION, videoId, measurementWindow, measuredAt, metrics, dimensions }));
    const id = `plsnap_${fingerprint.slice(0, 24)}`;
    await this.db.executeQuery(
      `INSERT OR IGNORE INTO newsroom_performance_learning_snapshots (id, engine_version, video_id, production_id, measurement_window, published_at, measured_at, confidence, simulated, eligible, views, impressions, ctr, retention, comments, comments_per_thousand_views, views_per_hour, metrics_json, dimensions_json, snapshot_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, VERSION, videoId, context.productionId || null, measurementWindow, publishedAt, measuredAt, confidence, eligible ? 1 : 0, metrics.views, metrics.impressions, metrics.ctr, metrics.retention, metrics.comments, metrics.commentsPerThousandViews, metrics.viewsPerHour, JSON.stringify(metrics), JSON.stringify(dimensions), fingerprint]
    );
    await this.rebuildSignals();
    return { id, videoId, measurementWindow, confidence, eligible, metrics, dimensions, version: VERSION };
  }

  preferredSnapshots(rows = []) {
    const rank = { '7d': 3, '24h': 2, rolling: 1 };
    const chosen = new Map();
    for (const row of rows) {
      const current = chosen.get(row.video_id);
      if (!current || (rank[row.measurement_window] || 0) > (rank[current.measurement_window] || 0) || ((rank[row.measurement_window] || 0) === (rank[current.measurement_window] || 0) && String(row.measured_at) > String(current.measured_at))) {
        chosen.set(row.video_id, row);
      }
    }
    return [...chosen.values()];
  }

  baselineFor(rows = []) {
    const parsed = rows.map(row => parseJson(row.metrics_json, {}));
    return {
      views: median(parsed.map(item => number(item.views)).filter(value => value > 0)),
      ctr: median(parsed.map(item => number(item.ctr)).filter(value => value > 0)),
      retention: median(parsed.map(item => number(item.retention)).filter(value => value > 0)),
      commentsPerThousandViews: median(parsed.map(item => number(item.commentsPerThousandViews)).filter(value => value >= 0)),
      viewsPerHour: median(parsed.map(item => number(item.viewsPerHour)).filter(value => value > 0))
    };
  }

  async rebuildSignals() {
    if (!this.db) return [];
    const policy = this.getConfig().policy;
    const raw = await this.db.getAllRows('SELECT * FROM newsroom_performance_learning_snapshots WHERE simulated = 0 ORDER BY measured_at DESC', []);
    const preferred = this.preferredSnapshots(raw || []);
    const reliable = preferred.filter(row => Boolean(row.eligible) && ['medium','high'].includes(String(row.confidence)));
    await this.db.executeQuery('DELETE FROM newsroom_performance_learning_signals', []);
    if (reliable.length < policy.minSamplesPerSignal) return [];
    const baseline = this.baselineFor(reliable);
    const groups = new Map();
    const add = (type, key, row) => {
      if (!key || key === 'unknown') return;
      const id = `${type}:${key}`;
      if (!groups.has(id)) groups.set(id, { type, key, rows: [] });
      groups.get(id).rows.push(row);
    };
    for (const row of reliable) {
      const dimensions = parseJson(row.dimensions_json, {});
      for (const key of dimensions.subjectKeys || []) add('subject', key, row);
      add('pillar', dimensions.pillarKey, row);
      add('format', dimensions.formatKey, row);
    }

    const saved = [];
    for (const group of groups.values()) {
      if (group.rows.length < policy.minSamplesPerSignal) continue;
      const metrics = group.rows.map(row => parseJson(row.metrics_json, {}));
      const totalViews = metrics.reduce((sum, item) => sum + number(item.views), 0);
      const totalImpressions = metrics.reduce((sum, item) => sum + number(item.impressions), 0);
      if (totalViews < policy.minViewsForSignal * group.rows.length || totalImpressions < policy.minImpressionsForSignal * group.rows.length) continue;
      const performanceIndex = Number(average(metrics.map(item => metricComposite(item, baseline))).toFixed(4));
      const bounded = Math.abs(performanceIndex) < policy.minimumMeaningfulIndex ? 0 : Math.round(clamp(performanceIndex * policy.maxPriorityAdjustment, -policy.maxPriorityAdjustment, policy.maxPriorityAdjustment, 0));
      const confidence = group.rows.length >= 4 && totalViews >= 400 && totalImpressions >= 4000 ? 'high' : 'medium';
      const averages = {
        ctr: Number(average(metrics.map(item => number(item.ctr))).toFixed(4)),
        retention: Number(average(metrics.map(item => number(item.retention))).toFixed(4)),
        commentsPerThousandViews: Number(average(metrics.map(item => number(item.commentsPerThousandViews))).toFixed(4)),
        viewsPerHour: Number(average(metrics.map(item => number(item.viewsPerHour))).toFixed(4))
      };
      const evidence = {
        baseline,
        videoIds: group.rows.map(row => row.video_id),
        measurementWindows: [...new Set(group.rows.map(row => row.measurement_window))],
        metricWeights: { ctr: 0.25, retention: 0.30, views: 0.15, commentsPerThousandViews: 0.10, viewsPerHour: 0.20 },
        evidencePolicy: 'Only real, sufficiently exposed YouTube analytics can generate decision signals.'
      };
      const fingerprint = hash(JSON.stringify({ version: VERSION, type: group.type, key: group.key, sampleCount: group.rows.length, totalViews, totalImpressions, performanceIndex, bounded, confidence, averages, evidence }));
      const id = `plsig_${hash(`${group.type}:${group.key}`).slice(0, 24)}`;
      await this.db.executeQuery(
        `INSERT OR REPLACE INTO newsroom_performance_learning_signals (id, engine_version, signal_type, signal_key, sample_count, total_views, total_impressions, average_ctr, average_retention, average_comments_per_thousand_views, average_views_per_hour, performance_index, priority_adjustment, confidence, evidence_json, signal_fingerprint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, VERSION, group.type, group.key, group.rows.length, totalViews, totalImpressions, averages.ctr, averages.retention, averages.commentsPerThousandViews, averages.viewsPerHour, performanceIndex, bounded, confidence, JSON.stringify(evidence), fingerprint]
      );
      saved.push({ id, signalType: group.type, signalKey: group.key, sampleCount: group.rows.length, totalViews, totalImpressions, performanceIndex, priorityAdjustment: bounded, confidence, averages, evidence });
    }
    return saved;
  }

  async listSignals(limit = 100) {
    if (!this.db) return [];
    const rows = await this.db.getAllRows('SELECT * FROM newsroom_performance_learning_signals ORDER BY ABS(priority_adjustment) DESC, sample_count DESC, updated_at DESC LIMIT ?', [Math.max(1, Math.min(500, Number(limit) || 100))]);
    return (rows || []).map(row => ({
      id: row.id,
      signalType: row.signal_type,
      signalKey: row.signal_key,
      sampleCount: Number(row.sample_count || 0),
      totalViews: Number(row.total_views || 0),
      totalImpressions: Number(row.total_impressions || 0),
      averageCtr: number(row.average_ctr),
      averageRetention: number(row.average_retention),
      averageCommentsPerThousandViews: number(row.average_comments_per_thousand_views),
      averageViewsPerHour: number(row.average_views_per_hour),
      performanceIndex: number(row.performance_index),
      priorityAdjustment: Number(row.priority_adjustment || 0),
      confidence: row.confidence,
      evidence: parseJson(row.evidence_json, {}),
      updatedAt: row.updated_at
    }));
  }

  candidateKeys(candidate = {}) {
    const event = candidate.event || {};
    const cluster = candidate.cluster || {};
    const phrases = [
      ...(Array.isArray(event.concepts) ? event.concepts : []),
      ...(Array.isArray(event.signature?.concepts) ? event.signature.concepts : []),
      cluster.canonicalTitle,
      cluster.title,
      cluster.label
    ].filter(Boolean);
    return new Set(uniq(phrases.flatMap(value => [value, ...tokens(value)]), 40));
  }

  async scoreCandidate(candidate = {}, options = {}) {
    const policy = this.getConfig().policy;
    const keys = this.candidateKeys(candidate);
    if (!keys.size) return { priorityAdjustment: 0, matchedSignals: [], confidence: null, version: VERSION };
    const signals = (await this.listSignals(250)).filter(signal => signal.signalType === 'subject' && signal.priorityAdjustment !== 0 && ['medium','high'].includes(signal.confidence));
    const matched = signals.filter(signal => keys.has(signal.signalKey)).slice(0, 5);
    if (!matched.length) return { priorityAdjustment: 0, matchedSignals: [], confidence: null, version: VERSION };
    const weighted = matched.map(signal => ({ signal, weight: signal.confidence === 'high' ? 2 : 1 }));
    const raw = weighted.reduce((sum, item) => sum + item.signal.priorityAdjustment * item.weight, 0) / weighted.reduce((sum, item) => sum + item.weight, 0);
    const priorityAdjustment = Math.round(clamp(raw, -policy.maxPriorityAdjustment, policy.maxPriorityAdjustment, 0));
    const confidence = matched.some(signal => signal.confidence === 'high') ? 'high' : 'medium';
    const result = {
      priorityAdjustment,
      matchedSignals: matched.map(signal => ({ id: signal.id, type: signal.signalType, key: signal.signalKey, adjustment: signal.priorityAdjustment, confidence: signal.confidence, sampleCount: signal.sampleCount })),
      confidence,
      maxPriorityAdjustment: policy.maxPriorityAdjustment,
      evidencePolicy: 'Performance learning may only make a bounded prioritization adjustment and cannot bypass evidence, truth, quality, or publication gates.',
      version: VERSION
    };
    const targetId = String(options.targetId || candidate.cluster?.id || candidate.event?.id || '').trim();
    if (this.db && targetId && priorityAdjustment !== 0) {
      const targetType = String(options.targetType || 'editorial_candidate');
      const fingerprint = hash(JSON.stringify({ version: VERSION, targetType, targetId, priorityAdjustment, matched: result.matchedSignals.map(item => item.id) }));
      const id = `plapp_${fingerprint.slice(0, 24)}`;
      await this.db.executeQuery('INSERT OR IGNORE INTO newsroom_performance_learning_applications (id, engine_version, target_type, target_id, applied_adjustment, signal_json, application_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, VERSION, targetType, targetId, priorityAdjustment, JSON.stringify(result), fingerprint]);
    }
    return result;
  }

  async getPlanningProfile() {
    const policy = this.getConfig().policy;
    const signals = (await this.listSignals(250)).filter(signal => signal.priorityAdjustment !== 0 && ['medium','high'].includes(signal.confidence));
    const subject = signals.filter(signal => signal.signalType === 'subject');
    const format = signals.filter(signal => signal.signalType === 'format');
    const sortPositive = list => list.filter(item => item.priorityAdjustment > 0).sort((a, b) => b.priorityAdjustment - a.priorityAdjustment || b.sampleCount - a.sampleCount).slice(0, policy.maxPlanningSignals);
    const sortNegative = list => list.filter(item => item.priorityAdjustment < 0).sort((a, b) => a.priorityAdjustment - b.priorityAdjustment || b.sampleCount - a.sampleCount).slice(0, policy.maxPlanningSignals);
    return {
      preferredSubjects: sortPositive(subject).map(item => ({ key: item.signalKey, adjustment: item.priorityAdjustment, confidence: item.confidence, sampleCount: item.sampleCount })),
      deprioritizedSubjects: sortNegative(subject).map(item => ({ key: item.signalKey, adjustment: item.priorityAdjustment, confidence: item.confidence, sampleCount: item.sampleCount })),
      preferredFormats: sortPositive(format).map(item => ({ key: item.signalKey, adjustment: item.priorityAdjustment, confidence: item.confidence, sampleCount: item.sampleCount })),
      deprioritizedFormats: sortNegative(format).map(item => ({ key: item.signalKey, adjustment: item.priorityAdjustment, confidence: item.confidence, sampleCount: item.sampleCount })),
      maxPriorityAdjustment: policy.maxPriorityAdjustment,
      evidencePolicy: 'Only real YouTube measurements with sufficient exposure are auto-applied; low-confidence and simulated data never alter planning.',
      version: VERSION
    };
  }

  async listSnapshots(limit = 100) {
    if (!this.db) return [];
    return this.db.getAllRows('SELECT * FROM newsroom_performance_learning_snapshots ORDER BY measured_at DESC LIMIT ?', [Math.max(1, Math.min(500, Number(limit) || 100))]);
  }

  async status() {
    if (!this.db) return { version: VERSION, enabled: this.getConfig().enabled, policy: this.getConfig().policy, snapshots: 0, signals: 0 };
    const [snapshotRow, signalRow, applicationRow, signals] = await Promise.all([
      this.db.getRow('SELECT COUNT(*) AS count FROM newsroom_performance_learning_snapshots', []),
      this.db.getRow('SELECT COUNT(*) AS count FROM newsroom_performance_learning_signals', []),
      this.db.getRow('SELECT COUNT(*) AS count FROM newsroom_performance_learning_applications', []),
      this.listSignals(12)
    ]);
    return {
      version: VERSION,
      enabled: this.getConfig().enabled,
      policy: this.getConfig().policy,
      snapshots: Number(snapshotRow?.count || 0),
      signals: Number(signalRow?.count || 0),
      applications: Number(applicationRow?.count || 0),
      strongestSignals: signals,
      evidencePolicy: 'CTR, retention, views, comments and growth velocity are learned only from real post-publication YouTube analytics.'
    };
  }
}

module.exports = {
  VERSION,
  defaultPolicy,
  normalizePolicy,
  confidenceFor,
  metricComposite,
  PerformanceLearningEngineV1211
};
