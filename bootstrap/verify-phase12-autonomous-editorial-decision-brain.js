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
  const concepts = options.concepts || ['market'];
  const locations = options.locations || ['Brazil'];
  const previousAssigned = Boolean(options.previousAssigned);
  const changeKind = options.changeKind || (previousAssigned ? 'material_update' : 'new_event');
  return {
    cluster: {
      id: `cluster_${id}`,
      canonicalTitle: options.title || `Global development ${id}`,
      materialFingerprint: `material_${id}`,
      materialChange: { changed: options.materialChanged ?? true, reason: 'fixture' },
      scores: {
        globalScore: options.globalScore ?? 82,
        confidenceScore: options.confidenceScore ?? 86,
        velocityScore: options.velocityScore ?? 76,
        freshnessScore: options.freshnessScore ?? 94,
        geographyScore: options.geographyScore ?? 80,
        sourceCount: options.sourceCount ?? 7,
        regionCount: options.regionCount ?? 4,
        independentEvidenceUnits: options.independentEvidenceUnits ?? 5
      }
    },
    event: {
      id: `event_${id}`,
      revisionNumber: options.revisionNumber ?? 1,
      previousAssigned,
      confidenceScore: options.confidenceScore ?? 86,
      evolutionScore: options.evolutionScore ?? 78,
      concepts,
      locations,
      changeClassification: { kind: changeKind, changed: options.materialChanged ?? true }
    },
    previous: previousAssigned ? { status: 'assigned' } : null
  };
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'autonomous-editorial-decision-brain-v123.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardClient = path.join(upstream, 'dashboard', 'newsroom-editor-v123.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardClient]) {
    check(fs.existsSync(file), `missing materialized Phase 12.3 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/autonomous-editorial-decision-brain-v123.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.3'",
    "['COVER','WAIT','IGNORE','UPDATE','BREAKING','FOLLOW_UP','DEFER']",
    'targetCadenceMinutes: 120',
    'maxSelectionsPerScan: 1',
    'sensitive_topic_stricter_evidence_gate',
    'higher_priority_story_selected_for_this_scan',
    'editorial_cadence_cooldown',
    'breaking_cadence_override',
    'BEGIN IMMEDIATE',
    'global_news_event_assignments'
  ]) check(serviceSource.includes(needle), `editorial brain runtime missing contract: ${needle}`);

  for (const table of ['global_news_editorial_policy_revisions','global_news_editorial_brain_runs','global_news_editorial_brain_decisions']) {
    check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  }
  check(dbSource.includes("CHECK(action IN ('COVER','WAIT','IGNORE','UPDATE','BREAKING','FOLLOW_UP','DEFER'))"), 'brain decision table must support explicit DEFER');
  check(dbSource.includes('decision_fingerprint TEXT NOT NULL UNIQUE'), 'brain decisions must be idempotent by fingerprint');

  for (const needle of [
    "require('./autonomous-editorial-decision-brain-v123')",
    'this.editorialBrain',
    'await this.editorialBrain.planScan(editorialCandidates, { scanId })',
    'brainByCluster',
    'selectedByBrain',
    'editorialBrainDecision'
  ]) check(radarSource.includes(needle), `Global News Radar missing brain integration: ${needle}`);

  for (const route of [
    "'/api/newsroom/editor/status', protect",
    "'/api/newsroom/editor/decisions', protect",
    "'/api/newsroom/editor/policy', protect"
  ]) check(indexSource.includes(route), `protected editorial brain API missing ${route}`);
  check(indexSource.includes("this.app.post('/api/newsroom/editor/policy', protect"), 'audited editorial policy update endpoint missing');
  check(indexSource.includes('editorial_policy_reason_required'), 'policy update must require an audit reason');

  check(htmlSource.includes('EDITORIAL BRAIN 12.3'), 'dashboard missing Editorial Brain panel');
  check(htmlSource.includes('/newsroom-editor-v123.js'), 'dashboard missing Phase 12.3 client');
  check(read('dashboard/newsroom-editor-v123.js').includes("api('/api/newsroom/editor/status')"), 'dashboard client must use live editorial status API');
  check(read('dashboard/newsroom-editor-v123.js').includes("api('/api/newsroom/editor/decisions?limit=20')"), 'dashboard client must use live decision API');

  for (const key of [
    'NEWSROOM_EDITORIAL_BRAIN_ENABLED=true',
    'NEWSROOM_EDITORIAL_TARGET_CADENCE_MINUTES=120',
    'NEWSROOM_EDITORIAL_MAX_SELECTIONS_PER_SCAN=1',
    'NEWSROOM_EDITORIAL_SENSITIVE_MIN_SOURCES=4',
    'NEWSROOM_EDITORIAL_SENSITIVE_MIN_CONFIDENCE=72',
    'NEWSROOM_EDITORIAL_BREAKING_COOLDOWN_OVERRIDE=true'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:autonomous-editorial-brain'] === 'node ../bootstrap/verify-phase12-autonomous-editorial-decision-brain.js', 'package missing Phase 12.3 test command');

  const {
    VERSION, defaultPolicy, normalizePolicy, isSensitive,
    scoreCandidate, classifyCandidate, allocateCandidates, EditorialDecisionBrainV123
  } = require(servicePath);
  check(VERSION === '12.3', 'runtime version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.targetCadenceMinutes === 120, 'default editorial cadence must be 120 minutes');
  check(policy.maxSelectionsPerScan === 1, 'default must choose at most one story per scan');

  const strong = candidate('strong');
  const strongDecision = classifyCandidate(strong, { policy, recentSelections: [] });
  check(['COVER','BREAKING'].includes(strongDecision.action), `strong story should be actionable, got ${strongDecision.action}`);
  check(strongDecision.priorityScore >= policy.coverThreshold, 'strong story priority should clear cover threshold');

  const weak = candidate('weak', { globalScore: 76, confidenceScore: 42, sourceCount: 1, regionCount: 1, independentEvidenceUnits: 1 });
  const weakDecision = classifyCandidate(weak, { policy, recentSelections: [] });
  check(weakDecision.action === 'WAIT', 'weakly corroborated story must WAIT');
  check(weakDecision.reasonCodes.includes('wait_for_more_evidence'), 'weak story must explain evidence wait');

  const election = candidate('election', { concepts: ['election'], confidenceScore: 68, independentEvidenceUnits: 3, sourceCount: 5, globalScore: 90 });
  check(isSensitive(election) === true, 'election fixture must trigger stricter sensitive-topic evidence gate');
  const electionDecision = classifyCandidate(election, { policy, recentSelections: [] });
  check(electionDecision.action === 'WAIT', 'sensitive political story below stricter evidence threshold must WAIT');
  check(electionDecision.reasonCodes.includes('sensitive_topic_stricter_evidence_gate'), 'sensitive evidence gate must be auditable');

  const alreadyCovered = candidate('covered', { previousAssigned: true, changeKind: 'observation', materialChanged: false });
  const coveredDecision = classifyCandidate(alreadyCovered, { policy, recentSelections: [] });
  check(coveredDecision.action === 'IGNORE', 'already covered event without material evolution must not duplicate coverage');

  const update = candidate('update', { previousAssigned: true, changeKind: 'correction', materialChanged: true, globalScore: 88 });
  const updateDecision = classifyCandidate(update, { policy, recentSelections: [] });
  check(updateDecision.action === 'UPDATE', 'material correction on covered event should become UPDATE');

  const diversityHistory = [
    { locations: ['Brazil'], concepts: ['market'] },
    { locations: ['Brazil'], concepts: ['market'] },
    { locations: ['Brazil'], concepts: ['market'] }
  ];
  const noPenalty = scoreCandidate(strong, { policy, recentSelections: [] });
  const repeated = scoreCandidate(strong, { policy, recentSelections: diversityHistory });
  check(repeated.diversityPenalty > 0, 'repeated regional/topic coverage should receive a soft diversity penalty');
  check(repeated.priorityScore < noPenalty.priorityScore, 'diversity penalty must lower priority without fabricating a hard ban');

  const a = classifyCandidate(candidate('a', { globalScore: 95, velocityScore: 80 }), { policy, recentSelections: [] });
  const b = classifyCandidate(candidate('b', { globalScore: 86, velocityScore: 65 }), { policy, recentSelections: [] });
  a.clusterId = 'cluster_a'; a.eventId = 'event_a';
  b.clusterId = 'cluster_b'; b.eventId = 'event_b';
  const competitive = allocateCandidates([a, b], { policy, now: '2026-09-16T14:00:00.000Z' });
  check(competitive.selectedCount === 1, 'competitive allocation must select exactly one normal editorial winner');
  check(competitive.decisions.filter(item => item.selected).length === 1, 'exactly one decision must carry selected=true');
  check(competitive.decisions.some(item => item.action === 'DEFER'), 'lower actionable story must explicitly DEFER instead of entering backlog');

  const normal = classifyCandidate(candidate('cooldown_normal', { globalScore: 80, velocityScore: 55 }), { policy, recentSelections: [] });
  normal.clusterId = 'cluster_cooldown_normal'; normal.eventId = 'event_cooldown_normal';
  const cooled = allocateCandidates([normal], { policy, lastAssignmentAt: '2026-09-16T13:00:00.000Z', now: '2026-09-16T14:00:00.000Z' });
  check(cooled.cooldownActive === true, 'one-hour-old assignment must keep the two-hour cooldown active');
  check(cooled.decisions[0].action === 'DEFER', 'normal story during cooldown must DEFER');
  check(cooled.nextEligibleAt === '2026-09-16T15:00:00.000Z', 'cooldown must expose exact next normal slot');

  const breaking = classifyCandidate(candidate('breaking', { globalScore: 100, confidenceScore: 96, velocityScore: 100, freshnessScore: 100, geographyScore: 100, evolutionScore: 100, independentEvidenceUnits: 7, sourceCount: 12, regionCount: 6 }), { policy, recentSelections: [] });
  breaking.clusterId = 'cluster_breaking'; breaking.eventId = 'event_breaking';
  check(breaking.action === 'BREAKING', `fixture should classify as BREAKING, got ${breaking.action}`);
  const preempt = allocateCandidates([breaking], { policy, lastAssignmentAt: '2026-09-16T13:30:00.000Z', now: '2026-09-16T14:00:00.000Z' });
  check(preempt.decisions[0].selected === true, 'high-confidence breaking story may pre-empt normal cooldown');
  check(preempt.decisions[0].reasonCodes.includes('breaking_cadence_override'), 'breaking override must be explicit and auditable');

  const tempDb = path.join(os.tmpdir(), `agenttube-editorial-brain-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const brain = new EditorialDecisionBrainV123(db);
  const policyState = await brain.setPolicy({ targetCadenceMinutes: 120, maxSelectionsPerScan: 1 }, 'ci-fixture', 'Validate append-only editorial policy revision');
  check(policyState.revisionNumber === 1, 'first persisted policy must be revision 1');
  const loadedPolicy = await brain.getPolicy();
  check(loadedPolicy.revisionNumber === 1 && loadedPolicy.source === 'persisted', 'persisted policy must load back exactly');

  const scanId = 'scan_editorial_brain_fixture';
  await db.executeQuery(`INSERT INTO global_news_scans (id, status, started_at, completed_at, config_json) VALUES (?, 'completed', ?, ?, '{}')`, [scanId, '2026-09-16T12:00:00.000Z', '2026-09-16T12:05:00.000Z']);
  for (const c of [candidate('persist_a'), candidate('persist_b', { globalScore: 78, velocityScore: 55 })]) {
    await db.executeQuery(`INSERT INTO global_news_clusters (id, cluster_key, canonical_title, status, first_seen_at, material_fingerprint, last_scan_id) VALUES (?, ?, ?, 'active', ?, ?, ?)`, [c.cluster.id, c.cluster.id, c.cluster.canonicalTitle, '2026-09-16T12:00:00.000Z', c.cluster.materialFingerprint, scanId]);
  }
  const persistedPlan = await brain.planScan([candidate('persist_a'), candidate('persist_b', { globalScore: 78, velocityScore: 55 })], { scanId, now: '2026-09-16T12:05:00.000Z' });
  check(Boolean(persistedPlan.id), 'persisted editorial plan must have a stable run id');
  check(persistedPlan.decisions.length === 2, 'persisted plan must audit every candidate, not only the winner');
  const stored = await brain.listDecisions(10);
  check(stored.length === 2, 'immutable brain decision rows must persist');
  check(stored.filter(item => item.selected).length === 1, 'database audit must persist exactly one selected story');
  const reused = await brain.planScan([candidate('persist_a')], { scanId, now: '2026-09-16T12:06:00.000Z' });
  check(reused.reused === true, 'same scan must reuse its immutable editorial plan');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.3 Autonomous Editorial Decision Brain verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
