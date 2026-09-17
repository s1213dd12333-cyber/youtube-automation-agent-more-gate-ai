'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');
const template = name => fs.readFileSync(path.join(root, 'bootstrap', 'templates', name), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 12.11 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.11 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/performance-learning-engine-v1211.js', template('performance-learning-engine-v1211.js'));
}

function patchDatabase() {
  let source = read('database/db.js');
  source = insertBefore(
    source,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('performance-learning-db-tables-v1211.txt')}\n`,
    'performance learning tables'
  );
  write('database/db.js', source);
}

function patchAnalyticsAgent() {
  let source = read('agents/analytics-optimization-agent.js');
  source = replaceOnce(
    source,
    "const { ChannelLearningEngine } = require('../utils/channel-learning-engine');\n",
    "const { ChannelLearningEngine } = require('../utils/channel-learning-engine');\nconst { PerformanceLearningEngineV1211 } = require('../utils/performance-learning-engine-v1211');\n",
    'analytics performance learning import'
  );
  source = replaceOnce(
    source,
    "    this.learning = new ChannelLearningEngine(db);\n",
    "    this.learning = new ChannelLearningEngine(db);\n    this.performanceLearning = new PerformanceLearningEngineV1211(db, { logger: this.logger });\n",
    'analytics performance learning initialization'
  );
  source = insertBefore(
    source,
    "      this.logger.info(`Analysis complete. Performance score: ${performanceReport.performance.score}/100`);\n",
    "      performanceReport.performanceLearningSnapshot = await this.performanceLearning.capture(\n        performanceReport,\n        context,\n        measurementWindow\n      );\n\n",
    'capture post-publication performance learning'
  );
  write('agents/analytics-optimization-agent.js', source);
}

function patchContentStrategyAgent() {
  let source = read('agents/content-strategy-agent.js');
  source = replaceOnce(
    source,
    "const { AITextService } = require('../utils/ai-text-service');\n",
    "const { AITextService } = require('../utils/ai-text-service');\nconst { PerformanceLearningEngineV1211 } = require('../utils/performance-learning-engine-v1211');\n",
    'content strategy performance learning import'
  );
  source = replaceOnce(
    source,
    "    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});\n",
    "    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});\n    this.performanceLearning = new PerformanceLearningEngineV1211(db, { logger: this.logger });\n",
    'content strategy performance learning initialization'
  );
  const approvedBlock = [
    "    const approvedLearnings = this.db.listLearningRecommendations",
    "      ? await this.db.listLearningRecommendations({ status: 'approved', limit: 10 })",
    "      : [];"
  ].join('\n');
  source = replaceOnce(
    source,
    approvedBlock,
    `${approvedBlock}\n    const performanceLearning = this.performanceLearning\n      ? await this.performanceLearning.getPlanningProfile()\n      : { preferredSubjects: [], deprioritizedSubjects: [], preferredFormats: [], deprioritizedFormats: [] };`,
    'load autonomous bounded performance learning profile'
  );
  source = replaceOnce(
    source,
    "      ...(approvedLearnings.length ? ['Operator-approved channel performance learnings'] : [])\n",
    "      ...(approvedLearnings.length ? ['Operator-approved channel performance learnings'] : []),\n      ...((performanceLearning.preferredSubjects?.length || performanceLearning.deprioritizedSubjects?.length || performanceLearning.preferredFormats?.length || performanceLearning.deprioritizedFormats?.length) ? ['Autonomous Performance Learning from real YouTube analytics'] : [])\n",
    'research sources expose performance learning provenance'
  );
  source = replaceOnce(
    source,
    "      competitorChannelsAnalyzed: this.competitorData.length,\n      approvedLearnings: approvedLearnings.map(item => ({\n",
    "      competitorChannelsAnalyzed: this.competitorData.length,\n      performanceLearning,\n      approvedLearnings: approvedLearnings.map(item => ({\n",
    'research payload contains performance learning'
  );
  source = replaceOnce(
    source,
    "Operator-approved performance learnings to apply: ${JSON.stringify(research.approvedLearnings)}\n",
    "Operator-approved performance learnings to apply: ${JSON.stringify(research.approvedLearnings)}\nAutonomous post-publication performance learning: ${JSON.stringify(research.performanceLearning || {})}\n",
    'planning prompt contains bounded autonomous performance signals'
  );
  source = replaceOnce(
    source,
    "Do not invent trend data, statistics, sources, URLs, or factual claims. Use only exact URLs from the supplied source catalog. Apply only the supplied approved learnings; pending or rejected recommendations are not authorized. Prefer evergreen topics when the supplied signals are weak.",
    "Do not invent trend data, statistics, sources, URLs, or factual claims. Use only exact URLs from the supplied source catalog. Apply only the supplied operator-approved legacy learnings; pending or rejected legacy recommendations are not authorized. Autonomous post-publication performance learning is separately authorized only when the supplied profile exposes medium/high-confidence signals derived from real YouTube analytics, and it may influence prioritization only within its bounded adjustment. It must never override channel objectives, factual evidence, safety, quality, or publication gates. Prefer evergreen topics when the supplied signals are weak.",
    'planning prompt safety contract'
  );
  source = replaceOnce(
    source,
    "    const candidates = [...readableSignals, ...pillarTopics, ...this.getEvergreenFallbackTopics()];\n\n    return candidates.slice(0, targetCount).map((topic, index) => ({\n",
    "    const candidates = [...readableSignals, ...pillarTopics, ...this.getEvergreenFallbackTopics()];\n    const preferred = (research.performanceLearning?.preferredSubjects || []).map(item => ({ key: String(item.key || '').replaceAll('_', ' ').toLowerCase(), adjustment: Number(item.adjustment || 0) }));\n    const deprioritized = (research.performanceLearning?.deprioritizedSubjects || []).map(item => ({ key: String(item.key || '').replaceAll('_', ' ').toLowerCase(), adjustment: Number(item.adjustment || 0) }));\n    const learningScore = topic => [...preferred, ...deprioritized].reduce((score, signal) => signal.key && String(topic).toLowerCase().includes(signal.key) ? score + signal.adjustment : score, 0);\n    const rankedCandidates = [...candidates].sort((a, b) => learningScore(b) - learningScore(a));\n\n    return rankedCandidates.slice(0, targetCount).map((topic, index) => ({\n",
    'fallback planning is actually influenced by performance learning'
  );
  write('agents/content-strategy-agent.js', source);
}

function patchEditorialBrain() {
  let source = read('utils/autonomous-editorial-decision-brain-v123.js');
  source = replaceOnce(
    source,
    "const crypto = require('crypto');\n",
    "const crypto = require('crypto');\nconst { PerformanceLearningEngineV1211 } = require('./performance-learning-engine-v1211');\n",
    'editorial brain performance learning import'
  );
  source = replaceOnce(
    source,
    "  const importanceConfidence = clamp(importanceAssessment?.confidenceScore, 0, 100, confidence);\n",
    "  const importanceConfidence = clamp(importanceAssessment?.confidenceScore, 0, 100, confidence);\n  const performanceLearning = candidate?.performanceLearning || null;\n  const performanceAdjustment = clamp(performanceLearning?.priorityAdjustment, -6, 6, 0);\n",
    'editorial score reads bounded performance learning'
  );
  source = replaceOnce(
    source,
    "  const priorityScore = Math.round(Math.max(0, Math.min(100, raw - diversity.penalty)));\n",
    "  const priorityScore = Math.round(Math.max(0, Math.min(100, raw + performanceAdjustment - diversity.penalty)));\n",
    'editorial priority consumes bounded performance adjustment'
  );
  source = replaceOnce(
    source,
    "    impactTier: importanceAssessment?.impactTier || null,\n    evolutionBonus,\n",
    "    impactTier: importanceAssessment?.impactTier || null,\n    performanceAdjustment: Math.round(performanceAdjustment),\n    performanceLearningConfidence: performanceLearning?.confidence || null,\n    performanceLearningMatches: performanceLearning?.matchedSignals || [],\n    evolutionBonus,\n",
    'editorial audit signals retain performance learning evidence'
  );
  source = replaceOnce(
    source,
    "  if (signals.importanceScore >= 74) reasonCodes.push('high_structural_global_importance');\n  if (signals.diversityPenalty > 0) reasonCodes.push('recent_coverage_diversity_penalty');\n",
    "  if (signals.importanceScore >= 74) reasonCodes.push('high_structural_global_importance');\n  if (signals.performanceAdjustment > 0) reasonCodes.push('historical_subject_performance_positive');\n  if (signals.performanceAdjustment < 0) reasonCodes.push('historical_subject_performance_negative');\n  if (signals.diversityPenalty > 0) reasonCodes.push('recent_coverage_diversity_penalty');\n",
    'editorial reason codes expose learning influence'
  );
  source = replaceOnce(
    source,
    "    `Repercussion ${signals.globalScore}/100, structural importance ${signals.importanceScore}/100, coverage-confidence ${signals.confidenceScore}/100, velocity ${signals.velocityScore}/100, freshness ${signals.freshnessScore}/100, geography ${signals.geographyScore}/100.`,\n",
    "    `Repercussion ${signals.globalScore}/100, structural importance ${signals.importanceScore}/100, coverage-confidence ${signals.confidenceScore}/100, velocity ${signals.velocityScore}/100, freshness ${signals.freshnessScore}/100, geography ${signals.geographyScore}/100.`,\n    `Post-publication performance learning adjustment ${signals.performanceAdjustment >= 0 ? '+' : ''}${signals.performanceAdjustment}/6; this is a bounded prioritization signal and never bypasses evidence gates.`,\n",
    'editorial rationale explains bounded learning adjustment'
  );
  source = replaceOnce(
    source,
    "    this.policyOverride = options.policy || null;\n",
    "    this.policyOverride = options.policy || null;\n    this.performanceLearning = options.performanceLearning || new PerformanceLearningEngineV1211(this.db, { logger: this.logger });\n",
    'editorial brain initializes performance learning'
  );
  const oldClassified = [
    "    const classified = (candidates || []).map(candidate => ({",
    "      clusterId: candidate?.cluster?.id || null,",
    "      eventId: candidate?.event?.id || null,",
    "      eventRevision: Number(candidate?.event?.revisionNumber || 0),",
    "      materialFingerprint: candidate?.cluster?.materialFingerprint || null,",
    "      ...classifyCandidate(candidate, { policy, recentSelections })",
    "    }));"
  ].join('\n');
  const newClassified = [
    "    const classified = [];",
    "    for (const candidate of candidates || []) {",
    "      let performanceLearning = { priorityAdjustment: 0, matchedSignals: [], confidence: null, version: '12.11' };",
    "      try {",
    "        performanceLearning = await this.performanceLearning.scoreCandidate(candidate, { targetType: 'editorial_candidate', targetId: candidate?.cluster?.id || candidate?.event?.id || 'unknown' });",
    "      } catch (error) {",
    "        this.logger.warn(`Performance Learning could not score candidate ${candidate?.cluster?.id || 'unknown'}: ${error.message}`);",
    "      }",
    "      const enriched = { ...candidate, performanceLearning };",
    "      classified.push({",
    "        clusterId: candidate?.cluster?.id || null,",
    "        eventId: candidate?.event?.id || null,",
    "        eventRevision: Number(candidate?.event?.revisionNumber || 0),",
    "        materialFingerprint: candidate?.cluster?.materialFingerprint || null,",
    "        ...classifyCandidate(enriched, { policy, recentSelections })",
    "      });",
    "    }"
  ].join('\n');
  source = replaceOnce(source, oldClassified, newClassified, 'editorial scan applies performance learning per candidate');
  write('utils/autonomous-editorial-decision-brain-v123.js', source);
}

function patchApi() {
  let source = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/performance-learning/status', protect, async (_req, res) => {",
    "      try { const engine = this.agents?.analytics?.performanceLearning || this.agents?.strategy?.performanceLearning; if (!engine) return res.status(503).json({ success: false, error: 'Performance Learning unavailable' }); return res.json({ success: true, result: await engine.status() }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/performance-learning/signals', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.performanceLearning || this.agents?.strategy?.performanceLearning; if (!engine) return res.status(503).json({ success: false, error: 'Performance Learning unavailable' }); return res.json({ success: true, result: await engine.listSignals(req.query.limit || 100) }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/performance-learning/snapshots', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.performanceLearning || this.agents?.strategy?.performanceLearning; if (!engine) return res.status(503).json({ success: false, error: 'Performance Learning unavailable' }); return res.json({ success: true, result: await engine.listSnapshots(req.query.limit || 100) }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  source = insertBefore(source, "    this.app.get('/api/newsroom/publishing-brain/status', protect, async (_req, res) => {\n", routes, 'protected performance learning APIs');
  write('index.js', source);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:performance-learning'] = 'node ../bootstrap/verify-phase12-performance-learning.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('PERFORMANCE_LEARNING_ENABLED=')) {
    env += `\n# Phase 12.11 — Performance Learning. Only real YouTube analytics are eligible.\nPERFORMANCE_LEARNING_ENABLED=true\nPERFORMANCE_LEARNING_MIN_VIEWS=20\nPERFORMANCE_LEARNING_MIN_IMPRESSIONS=100\nPERFORMANCE_LEARNING_MIN_SAMPLES=2\n# Historical performance may influence future priority only within this bounded range.\nPERFORMANCE_LEARNING_MAX_PRIORITY_ADJUSTMENT=6\nPERFORMANCE_LEARNING_MAX_PLANNING_SIGNALS=8\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchAnalyticsAgent();
patchContentStrategyAgent();
patchEditorialBrain();
patchApi();
patchPackageAndEnv();
console.log('Phase 12.11 Performance Learning materialized: CTR, retention, views, comments, growth velocity and subject performance now create bounded evidence-backed signals for future decisions.');
