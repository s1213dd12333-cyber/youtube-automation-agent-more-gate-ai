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

function candidate(id, options = {}) {
  return {
    cluster: {
      id: `cluster_${id}`,
      canonicalTitle: options.title || `Observed world event ${id}`,
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
      id: options.eventId === undefined ? `event_${id}` : options.eventId,
      revisionNumber: options.revisionNumber ?? 1,
      confidenceScore: options.confidenceScore ?? 86,
      evolutionScore: options.evolutionScore ?? 72,
      concepts: options.concepts || ['market'],
      locations: options.locations || ['Brazil'],
      changeClassification: { kind: options.changeKind || 'new_event', changed: true }
    }
  };
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'global-importance-engine-v124.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const brainPath = path.join(upstream, 'utils', 'autonomous-editorial-decision-brain-v123.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-importance-v124.js');
  for (const file of [servicePath, radarPath, brainPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.4 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/global-importance-engine-v124.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const brainSource = read('utils/autonomous-editorial-decision-brain-v123.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const envSource = read('.env.example');
  const dashboardSource = read('dashboard/newsroom-importance-v124.js');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.4'",
    "['limited','regional','international','global','systemic']",
    'geographicWeight: 0.18',
    'humanSafetyWeight: 0.21',
    'lowConfidenceDamping: 0.82',
    'importance_score_damped_for_low_evidence_confidence',
    'assessment_fingerprint',
    'BEGIN IMMEDIATE'
  ]) check(serviceSource.includes(needle), `importance runtime missing contract: ${needle}`);

  for (const table of ['global_news_importance_policy_revisions','global_news_importance_assessments']) {
    check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  }
  check(dbSource.includes("CHECK(impact_tier IN ('limited','regional','international','global','systemic'))"), 'impact tier enum must be constrained');
  check(dbSource.includes('assessment_fingerprint TEXT NOT NULL UNIQUE'), 'importance assessments must be immutable/idempotent');

  for (const needle of [
    "require('./global-importance-engine-v124')",
    'this.globalImportance',
    'await this.globalImportance.assessCandidate({ cluster, event }, { scanId })',
    'importanceAssessment: candidate.importance || null'
  ]) check(radarSource.includes(needle), `Global News Radar missing importance integration: ${needle}`);

  for (const needle of [
    'const importanceAssessment = candidate?.importance',
    'importanceScore: Math.round(importance)',
    'high_structural_global_importance',
    'structural importance ${signals.importanceScore}/100'
  ]) check(brainSource.includes(needle), `Editorial Brain missing importance integration: ${needle}`);

  for (const route of [
    "'/api/newsroom/importance/status', protect",
    "'/api/newsroom/importance/assessments', protect",
    "'/api/newsroom/importance/policy', protect"
  ]) check(indexSource.includes(route), `protected Global Importance API missing ${route}`);
  check(indexSource.includes("this.app.post('/api/newsroom/importance/policy', protect"), 'audited importance policy update endpoint missing');
  check(indexSource.includes('importance_policy_reason_required'), 'importance policy update must require audit reason');

  check(htmlSource.includes('GLOBAL IMPORTANCE 12.4'), 'dashboard missing Global Importance panel');
  check(htmlSource.includes('/newsroom-importance-v124.js'), 'dashboard missing Phase 12.4 client');
  check(dashboardSource.includes("api('/api/newsroom/importance/status')"), 'importance dashboard must read live status API');

  for (const key of [
    'NEWSROOM_GLOBAL_IMPORTANCE_ENABLED=true',
    'NEWSROOM_IMPORTANCE_LOW_CONFIDENCE_DAMPING=0.82',
    'NEWSROOM_IMPORTANCE_LOW_CONFIDENCE_THRESHOLD=52',
    'NEWSROOM_IMPORTANCE_TIER_GLOBAL=74',
    'NEWSROOM_IMPORTANCE_TIER_SYSTEMIC=88'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:global-importance'] === 'node ../bootstrap/verify-phase12-global-importance-engine.js', 'package missing Phase 12.4 test command');

  const {
    VERSION, defaultPolicy, normalizePolicy, evidenceConfidence,
    computeDimensions, assessImportance, GlobalImportanceEngineV124
  } = require(servicePath);
  check(VERSION === '12.4', 'runtime version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  const weightTotal = policy.geographicWeight + policy.humanSafetyWeight + policy.economicSystemicWeight + policy.infrastructureWeight + policy.civicInstitutionalWeight + policy.persistenceWeight + policy.urgencyWeight + policy.crossBorderWeight;
  check(Math.abs(weightTotal - 1) < 0.0001, 'importance dimension weights must normalize to 1');

  const viral = candidate('viral', {
    globalScore: 98, confidenceScore: 92, velocityScore: 96, freshnessScore: 100,
    sourceCount: 22, regionCount: 1, independentEvidenceUnits: 8,
    concepts: ['model'], locations: ['United States']
  });
  const disaster = candidate('disaster', {
    globalScore: 75, confidenceScore: 88, velocityScore: 78, freshnessScore: 96,
    sourceCount: 9, regionCount: 4, independentEvidenceUnits: 6,
    concepts: ['earthquake','death','injury','emergency'], locations: ['Japan','South Korea']
  });
  const viralAssessment = assessImportance(viral, { policy });
  const disasterAssessment = assessImportance(disaster, { policy });
  check(viralAssessment.evidence.globalRepercussionScore > disasterAssessment.evidence.globalRepercussionScore, 'fixture must have more repercussion for viral story');
  check(disasterAssessment.importanceScore > viralAssessment.importanceScore, 'structural disaster impact must outrank high-repercussion low-impact fixture');
  check(viralAssessment.impactTier === 'limited', 'raw virality alone must not automatically become global importance');
  check(['international','global','systemic'].includes(disasterAssessment.impactTier), 'broad corroborated disaster should register international-or-higher structural impact');

  const lowEvidence = candidate('low_evidence', {
    globalScore: 90, confidenceScore: 24, velocityScore: 90, freshnessScore: 100,
    sourceCount: 1, regionCount: 4, independentEvidenceUnits: 1,
    concepts: ['earthquake','emergency'], locations: ['Japan','South Korea']
  });
  const lowAssessment = assessImportance(lowEvidence, { policy });
  check(lowAssessment.confidenceScore < policy.lowConfidenceThreshold, 'low-evidence fixture must fall below importance confidence threshold');
  check(lowAssessment.reasonCodes.includes('importance_score_damped_for_low_evidence_confidence'), 'low-evidence importance must be explicitly damped');

  const actorA = candidate('civic_a', { title: 'Candidate A election coverage', concepts: ['election'], locations: ['Brazil'], globalScore: 80 });
  const actorB = candidate('civic_b', { title: 'Candidate B election coverage', concepts: ['election'], locations: ['Brazil'], globalScore: 80 });
  const aAssessment = assessImportance(actorA, { policy });
  const bAssessment = assessImportance(actorB, { policy });
  check(aAssessment.importanceScore === bAssessment.importanceScore, 'importance score must not change merely because political actor/title changes while evidence signals are identical');
  check(JSON.stringify(aAssessment.dimensions) === JSON.stringify(bAssessment.dimensions), 'structural dimensions must be viewpoint/actor-neutral for identical evidence');

  const dims = computeDimensions(disaster);
  check(dims.humanSafety >= 90, 'human-safety concepts must be visible in dimension audit');
  check(dims.crossBorder >= 70, 'multi-region fixture must register cross-border signal');
  check(evidenceConfidence(disaster) >= 70, 'corroborated fixture should have strong evidence confidence');

  const { scoreCandidate } = require(brainPath);
  const lowImportanceCandidate = candidate('brain_low', { globalScore: 82, confidenceScore: 86, velocityScore: 70, freshnessScore: 92, regionCount: 3, concepts: ['model'] });
  const highImportanceCandidate = candidate('brain_high', { globalScore: 82, confidenceScore: 86, velocityScore: 70, freshnessScore: 92, regionCount: 3, concepts: ['model'] });
  lowImportanceCandidate.importance = { importanceScore: 20, confidenceScore: 90, impactTier: 'limited' };
  highImportanceCandidate.importance = { importanceScore: 90, confidenceScore: 90, impactTier: 'systemic' };
  const brainLow = scoreCandidate(lowImportanceCandidate, { policy: undefined, recentSelections: [] });
  const brainHigh = scoreCandidate(highImportanceCandidate, { policy: undefined, recentSelections: [] });
  check(brainHigh.priorityScore > brainLow.priorityScore, 'Editorial Brain priority must consume structural importance signal');
  check(brainHigh.importanceScore === 90 && brainHigh.impactTier === 'systemic', 'Editorial Brain audit signals must retain importance score/tier');

  const tempDb = path.join(os.tmpdir(), `agenttube-global-importance-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const engine = new GlobalImportanceEngineV124(db);
  const policyState = await engine.setPolicy({ lowConfidenceThreshold: 52 }, 'ci-fixture', 'Validate append-only global importance policy');
  check(policyState.revisionNumber === 1, 'first persisted importance policy must be revision 1');
  const loadedPolicy = await engine.getPolicy();
  check(loadedPolicy.revisionNumber === 1 && loadedPolicy.source === 'persisted', 'persisted importance policy must load exactly');

  const scanId = 'scan_importance_fixture';
  await db.executeQuery(`INSERT INTO global_news_scans (id, status, started_at, completed_at, config_json) VALUES (?, 'completed', ?, ?, '{}')`, [scanId, '2026-09-16T14:00:00.000Z', '2026-09-16T14:05:00.000Z']);
  const persisted = candidate('persisted', { eventId: null, concepts: ['earthquake','emergency'], locations: ['Japan'], regionCount: 3 });
  await db.executeQuery(`INSERT INTO global_news_clusters (id, cluster_key, canonical_title, status, first_seen_at, material_fingerprint, last_scan_id) VALUES (?, ?, ?, 'active', ?, ?, ?)`, [persisted.cluster.id, persisted.cluster.id, persisted.cluster.canonicalTitle, '2026-09-16T14:00:00.000Z', persisted.cluster.materialFingerprint, scanId]);
  const first = await engine.assessCandidate(persisted, { scanId });
  const second = await engine.assessCandidate(persisted, { scanId });
  check(first.id === second.id, 'same evidence snapshot must produce deterministic importance assessment id');
  const stored = await engine.listAssessments(10);
  check(stored.length === 1, 'idempotent importance assessment must persist once');
  check(stored[0].importanceScore === first.importanceScore, 'persisted importance score must round-trip');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.4 Global Importance Engine verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
