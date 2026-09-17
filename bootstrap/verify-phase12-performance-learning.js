'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
let checks = 0;
function check(condition, message) { checks += 1; assert(condition, message); }

function report(videoId, subject, options = {}) {
  const analyzedAt = options.analyzedAt || '2026-09-17T12:00:00.000Z';
  const publishedAt = options.publishedAt || '2026-09-16T12:00:00.000Z';
  const views = options.views ?? 1200;
  const impressions = options.impressions ?? 8000;
  const ctr = options.ctr ?? 7;
  const retention = options.retention ?? 55;
  const comments = options.comments ?? 50;
  return {
    videoId,
    analyzedAt,
    videoDetails: {
      id: videoId,
      title: `${subject} explained`,
      publishedAt,
      statistics: { viewCount: views, likeCount: Math.round(views * 0.05), commentCount: comments }
    },
    analytics: {
      simulated: Boolean(options.simulated),
      views: { totalViews: views, totalImpressions: impressions, averageCTR: ctr, dailyData: [['2026-09-16', Math.round(views * 0.4), Math.round(impressions * 0.4), ctr], ['2026-09-17', Math.round(views * 0.6), Math.round(impressions * 0.6), ctr]] },
      watchTime: { totalWatchTime: views * 3, averageViewDuration: 180, averageViewPercentage: retention },
      engagement: { engagementRate: comments > 20 ? 6 : 1.5 }
    },
    thumbnailMetrics: { impressions, clickThroughRate: ctr },
    performance: { score: options.performanceScore ?? 70 }
  };
}

function context(subject, productionId, format = 'explainer') {
  return {
    productionId,
    contentFormat: 'long',
    strategy: {
      topic: subject,
      contentPillar: subject,
      requestedStyle: format,
      keywords: subject.split(/\s+/)
    }
  };
}

function candidate(id, concept, performanceLearning = null, options = {}) {
  return {
    cluster: {
      id: `cluster_${id}`,
      canonicalTitle: `${concept} latest development`,
      materialFingerprint: `material_${id}`,
      scores: {
        globalScore: options.globalScore ?? 78,
        confidenceScore: options.confidenceScore ?? 86,
        velocityScore: options.velocityScore ?? 72,
        freshnessScore: options.freshnessScore ?? 92,
        geographyScore: options.geographyScore ?? 76,
        sourceCount: options.sourceCount ?? 8,
        regionCount: options.regionCount ?? 4,
        independentEvidenceUnits: options.independentEvidenceUnits ?? 5
      }
    },
    event: {
      id: `event_${id}`,
      revisionNumber: 1,
      confidenceScore: options.confidenceScore ?? 86,
      evolutionScore: 72,
      concepts: [concept],
      locations: ['Global'],
      changeClassification: { kind: 'new_event', changed: true }
    },
    importance: { importanceScore: 75, confidenceScore: 88, impactTier: 'global' },
    performanceLearning
  };
}

async function main() {
  const runtimePath = path.join(upstream, 'utils', 'performance-learning-engine-v1211.js');
  const brainPath = path.join(upstream, 'utils', 'autonomous-editorial-decision-brain-v123.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const analyticsPath = path.join(upstream, 'agents', 'analytics-optimization-agent.js');
  const strategyPath = path.join(upstream, 'agents', 'content-strategy-agent.js');
  const indexPath = path.join(upstream, 'index.js');
  for (const file of [runtimePath, brainPath, dbPath, analyticsPath, strategyPath, indexPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.11 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const runtimeSource = read('utils/performance-learning-engine-v1211.js');
  const analyticsSource = read('agents/analytics-optimization-agent.js');
  const strategySource = read('agents/content-strategy-agent.js');
  const brainSource = read('utils/autonomous-editorial-decision-brain-v123.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.11'",
    'commentsPerThousandViews',
    'viewsPerHour',
    'performanceIndex',
    'maxPriorityAdjustment: 6',
    'simulated_analytics_excluded',
    'Only real, sufficiently exposed YouTube analytics can generate decision signals.'
  ]) check(runtimeSource.includes(needle), `performance learning runtime missing contract: ${needle}`);

  for (const table of [
    'newsroom_performance_learning_snapshots',
    'newsroom_performance_learning_signals',
    'newsroom_performance_learning_applications'
  ]) check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  check(dbSource.includes("CHECK(confidence IN ('low','medium','high'))"), 'snapshot confidence must be constrained');
  check(dbSource.includes("CHECK(signal_type IN ('subject','pillar','format'))"), 'signal type must be constrained');

  check(analyticsSource.includes('PerformanceLearningEngineV1211'), 'analytics agent must initialize Phase 12.11 engine');
  check(analyticsSource.includes('performanceLearningSnapshot = await this.performanceLearning.capture'), 'analytics agent must capture post-publication learning');
  check(strategySource.includes('getPlanningProfile()'), 'content strategy must read autonomous performance profile');
  check(strategySource.includes('Autonomous post-publication performance learning'), 'AI planning prompt must receive performance learning');
  check(strategySource.includes('const learningScore = topic =>'), 'fallback planning must also be influenced without an AI provider');
  check(brainSource.includes('performanceAdjustment'), 'editorial brain must consume bounded performance adjustment');
  check(brainSource.includes('historical_subject_performance_positive'), 'editorial audit must expose positive performance influence');
  check(brainSource.includes('never bypasses evidence gates'), 'editorial rationale must state the evidence-gate boundary');

  for (const route of [
    "'/api/newsroom/performance-learning/status', protect",
    "'/api/newsroom/performance-learning/signals', protect",
    "'/api/newsroom/performance-learning/snapshots', protect"
  ]) check(indexSource.includes(route), `protected Performance Learning API missing ${route}`);
  for (const key of [
    'PERFORMANCE_LEARNING_ENABLED=true',
    'PERFORMANCE_LEARNING_MIN_VIEWS=20',
    'PERFORMANCE_LEARNING_MIN_IMPRESSIONS=100',
    'PERFORMANCE_LEARNING_MIN_SAMPLES=2',
    'PERFORMANCE_LEARNING_MAX_PRIORITY_ADJUSTMENT=6'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:performance-learning'] === 'node ../bootstrap/verify-phase12-performance-learning.js', 'package missing Phase 12.11 test command');

  const { Database } = require(dbPath);
  const { VERSION, defaultPolicy, PerformanceLearningEngineV1211 } = require(runtimePath);
  check(VERSION === '12.11', 'runtime version mismatch');
  check(defaultPolicy().maxPriorityAdjustment === 6, 'default editorial influence must be bounded to +/-6');

  const tempDb = path.join(os.tmpdir(), `agenttube-performance-learning-${process.pid}-${Date.now()}.db`);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const engine = new PerformanceLearningEngineV1211(db);

  const simulated = await engine.capture(
    report('simulated_video', 'artificial intelligence', { simulated: true, views: 5000, impressions: 20000 }),
    context('artificial intelligence', 'prod_simulated'),
    '24h'
  );
  check(simulated.ignored === true && simulated.reason === 'simulated_analytics_excluded', 'simulated analytics must never teach the system');

  const highFixtures = [
    report('ai_high_1', 'artificial intelligence', { views: 2200, impressions: 11000, ctr: 8.2, retention: 62, comments: 130 }),
    report('ai_high_2', 'artificial intelligence', { views: 1900, impressions: 9800, ctr: 7.8, retention: 59, comments: 105 })
  ];
  const lowFixtures = [
    report('garden_low_1', 'home gardening', { views: 220, impressions: 2600, ctr: 2.1, retention: 24, comments: 2 }),
    report('garden_low_2', 'home gardening', { views: 260, impressions: 2900, ctr: 2.4, retention: 27, comments: 3 })
  ];
  for (let i = 0; i < highFixtures.length; i++) await engine.capture(highFixtures[i], context('artificial intelligence', `prod_ai_${i}`), '24h');
  for (let i = 0; i < lowFixtures.length; i++) await engine.capture(lowFixtures[i], context('home gardening', `prod_garden_${i}`), '24h');

  const signals = await engine.listSignals(200);
  const aiSignal = signals.find(item => item.signalType === 'subject' && item.signalKey === 'artificial_intelligence');
  const gardenSignal = signals.find(item => item.signalType === 'subject' && item.signalKey === 'home_gardening');
  check(aiSignal && aiSignal.sampleCount === 2, 'subject performance must aggregate repeated artificial-intelligence videos');
  check(gardenSignal && gardenSignal.sampleCount === 2, 'subject performance must aggregate repeated gardening videos');
  check(aiSignal.priorityAdjustment > 0, 'strong historical subject performance must create a positive bounded signal');
  check(gardenSignal.priorityAdjustment < 0, 'weak historical subject performance must create a negative bounded signal');
  check(Math.abs(aiSignal.priorityAdjustment) <= 6 && Math.abs(gardenSignal.priorityAdjustment) <= 6, 'all automatic priority adjustments must stay within +/-6');
  check(aiSignal.averageCtr > gardenSignal.averageCtr, 'CTR must materially contribute to learned subject performance');
  check(aiSignal.averageRetention > gardenSignal.averageRetention, 'retention must materially contribute to learned subject performance');
  check(aiSignal.averageCommentsPerThousandViews > gardenSignal.averageCommentsPerThousandViews, 'comments must materially contribute to learned subject performance');
  check(aiSignal.averageViewsPerHour > gardenSignal.averageViewsPerHour, 'growth velocity must materially contribute to learned subject performance');

  const positiveCandidate = await engine.scoreCandidate(candidate('ai', 'artificial intelligence'), { targetId: 'cluster_ai' });
  const negativeCandidate = await engine.scoreCandidate(candidate('garden', 'home gardening'), { targetId: 'cluster_garden' });
  check(positiveCandidate.priorityAdjustment > 0, 'future matching subject must receive positive learned adjustment');
  check(negativeCandidate.priorityAdjustment < 0, 'future weak subject must receive negative learned adjustment');
  check(positiveCandidate.matchedSignals.length > 0, 'decision influence must retain evidence signal identifiers');

  const planning = await engine.getPlanningProfile();
  check(planning.preferredSubjects.some(item => item.key === 'artificial_intelligence'), 'planning profile must expose historically strong subjects');
  check(planning.deprioritizedSubjects.some(item => item.key === 'home_gardening'), 'planning profile must expose historically weak subjects');

  const { scoreCandidate, classifyCandidate } = require(brainPath);
  const neutral = scoreCandidate(candidate('neutral', 'unrelated topic', { priorityAdjustment: 0, matchedSignals: [], confidence: null }), { recentSelections: [] });
  const boosted = scoreCandidate(candidate('boosted', 'unrelated topic', { priorityAdjustment: 6, matchedSignals: [{ id: 'signal_fixture' }], confidence: 'high' }), { recentSelections: [] });
  check(boosted.priorityScore > neutral.priorityScore, 'Phase 12.11 must actually alter future editorial priority');
  check(boosted.priorityScore - neutral.priorityScore <= 6, 'editorial influence must remain bounded');
  const insufficientEvidence = candidate('unsafe_boost', 'artificial intelligence', { priorityAdjustment: 6, matchedSignals: [{ id: 'signal_fixture' }], confidence: 'high' }, { independentEvidenceUnits: 1, sourceCount: 1 });
  const classified = classifyCandidate(insufficientEvidence, { recentSelections: [] });
  check(classified.action === 'WAIT', 'positive historical performance must never bypass independent-evidence requirements');
  check(classified.reasonCodes.includes('insufficient_independent_sources'), 'evidence failure must remain explicit after learning influence');

  const applicationRows = await db.getAllRows('SELECT * FROM newsroom_performance_learning_applications ORDER BY created_at ASC', []);
  check(applicationRows.length >= 2, 'every non-zero automatic decision influence must be auditable');
  const status = await engine.status();
  check(status.snapshots === 4, 'only four real learning snapshots should be persisted');
  check(status.signals > 0 && status.applications >= 2, 'status must expose learned signals and applications');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.11 Performance Learning verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
