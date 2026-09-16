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

function longEvidence(label) {
  return `${label}. Verified timeline and affected regions are described here. Officials published a statement with confirmed facts, publication timing, response details and the geographic areas directly affected. Independent reporting corroborates the timeline and affected regions. This evidence text is deliberately long enough for the automated evidence-depth threshold and does not ask the system to infer unsupported facts.`;
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'autonomous-research-v126.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-research-v126.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.6 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/autonomous-research-v126.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const envSource = read('.env.example');
  const dashboardSource = read('dashboard/newsroom-research-v126.js');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.6'",
    "const READY = 'EVIDENCE_READY'",
    "const MORE = 'RESEARCH_MORE'",
    "const BLOCK = 'BLOCK'",
    'safeExternalUrl',
    'maxRedirects: 0',
    'buildResearchQueries',
    'assessReadiness',
    'minimumIndependentSources',
    'primary_or_official_source_required',
    'research_question_coverage_below_threshold',
    'run_fingerprint'
  ]) check(serviceSource.includes(needle), `Autonomous Research runtime missing contract: ${needle}`);

  for (const table of ['newsroom_autonomous_research_policy_revisions','newsroom_autonomous_research_runs','newsroom_autonomous_research_rounds']) {
    check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  }
  check(dbSource.includes("CHECK(status IN ('RESEARCH_MORE','EVIDENCE_READY','BLOCK'))"), 'research status enum must be constrained');
  check(dbSource.includes('run_fingerprint TEXT NOT NULL UNIQUE'), 'research run snapshot must be immutable/idempotent');
  check(dbSource.includes('UNIQUE(run_id, round_number)'), 'research rounds must be idempotent per run/round');

  for (const needle of [
    "require('./autonomous-research-v126')",
    'this.autonomousResearch',
    'await this.autonomousResearch.researchSelected',
    "autonomousResearch?.status === 'EVIDENCE_READY'",
    'promoteDecision(decision.id, editorialPlan, autonomousResearch)',
    'assignmentSourceUrls',
    'autonomousResearch: cluster.autonomousResearch || null'
  ]) check(radarSource.includes(needle), `Global News Radar missing Phase 12.6 integration: ${needle}`);

  for (const route of [
    "'/api/newsroom/research/status', protect",
    "'/api/newsroom/research/runs', protect",
    "'/api/newsroom/research/runs/:runId', protect",
    "'/api/newsroom/research/policy', protect"
  ]) check(indexSource.includes(route), `protected Autonomous Research API missing ${route}`);
  check(indexSource.includes("this.app.post('/api/newsroom/research/policy', protect"), 'audited research policy update endpoint missing');
  check(indexSource.includes('autonomous_research_policy_reason_required'), 'research policy update must require audit reason');

  check(htmlSource.includes('AUTONOMOUS RESEARCH 12.6'), 'dashboard missing Autonomous Research panel');
  check(htmlSource.includes('/newsroom-research-v126.js'), 'dashboard missing Phase 12.6 client');
  check(dashboardSource.includes("api('/api/newsroom/research/status')"), 'research dashboard must read live status API');

  for (const key of [
    'NEWSROOM_AUTONOMOUS_RESEARCH_ENABLED=true',
    'NEWSROOM_RESEARCH_MAX_ROUNDS=3',
    'NEWSROOM_RESEARCH_MAX_SOURCES=16',
    'NEWSROOM_RESEARCH_MIN_EVIDENCE_CHARS=180',
    'NEWSROOM_RESEARCH_MIN_COVERAGE_RATIO=0.55',
    'NEWSROOM_RESEARCH_MIN_EVIDENCE_SCORE=62'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:autonomous-research'] === 'node ../bootstrap/verify-phase12-autonomous-research.js', 'package missing Phase 12.6 test command');

  const {
    VERSION, READY, BLOCK, defaultPolicy, normalizePolicy, safeExternalUrl,
    sourceClassFor, buildResearchQueries, assessReadiness, AutonomousResearchV126
  } = require(servicePath);
  check(VERSION === '12.6', 'runtime version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.maxRounds === 3 && policy.maxSources === 16, 'default research policy mismatch');

  check(safeExternalUrl('http://127.0.0.1:3000/secret') === '', 'localhost/private IPv4 must be rejected');
  check(safeExternalUrl('http://10.0.0.8/internal') === '', 'RFC1918 source URL must be rejected');
  check(safeExternalUrl('file:///etc/passwd') === '', 'non-http protocol must be rejected');
  check(safeExternalUrl('https://example.com/story').startsWith('https://example.com/'), 'public HTTPS source must be accepted');
  check(sourceClassFor({ url: 'https://example.gov/statement' }) === 'official', 'government domain must classify as official');

  const plan = {
    id: 'plan_ready',
    topic: 'International infrastructure emergency',
    research: {
      minimumIndependentSources: 3,
      primarySourceRequired: true,
      questions: ['What is the verified timeline?', 'Which affected regions are confirmed?']
    }
  };
  const candidate = {
    cluster: { id: 'cluster_ready', canonicalTitle: plan.topic, topicTokens: ['infrastructure','emergency'], articles: [] },
    event: { id: 'event_ready', revisionNumber: 1, concepts: ['emergency'], locations: ['Region A','Region B'] }
  };
  const queries = buildResearchQueries(plan, candidate, policy);
  check(queries.length >= 3 && queries.some(query => query.includes('official statement')), 'research query planner must include primary-source search');

  const readySources = [
    { id: 'a', url: 'https://one.example/story', title: 'Verified timeline', status: 'verified', sourceClass: 'web', evidenceText: longEvidence('One') },
    { id: 'b', url: 'https://two.example/story', title: 'Affected regions', status: 'verified', sourceClass: 'web', evidenceText: longEvidence('Two') },
    { id: 'c', url: 'https://example.gov/statement', title: 'Official statement', status: 'verified', sourceClass: 'official', evidenceText: longEvidence('Official') }
  ];
  const readyAssessment = assessReadiness(plan, readySources, { ...policy, minimumCoverageRatio: 0.5 });
  check(readyAssessment.ready === true, 'three-domain corroborated evidence including official source should be ready');
  check(readyAssessment.independentSourceCount === 3, 'independent-domain count mismatch');
  check(readyAssessment.primarySourceCount === 1, 'primary/official count mismatch');
  check(readyAssessment.coverageRatio === 1, 'research questions should be covered by fixture evidence');

  const insufficient = assessReadiness({ ...plan, research: { ...plan.research, minimumIndependentSources: 5 } }, readySources, policy);
  check(insufficient.ready === false, 'insufficient source breadth must not pass');
  check(insufficient.gaps.some(gap => gap.includes('more_independent_source')), 'source breadth gap must be explicit');

  const politicalA = { ...plan, topic: 'Candidate A election development' };
  const politicalB = { ...plan, topic: 'Candidate B election development' };
  const aReady = assessReadiness(politicalA, readySources, policy);
  const bReady = assessReadiness(politicalB, readySources, policy);
  check(aReady.evidenceScore === bReady.evidenceScore && aReady.ready === bReady.ready, 'named political actor must not change evidence readiness when evidence/requirements are identical');

  const htmlByUrl = new Map([
    ['https://one.example/story', `<html><body>${longEvidence('One')}</body></html>`],
    ['https://two.example/story', `<html><body>${longEvidence('Two')}</body></html>`],
    ['https://example.gov/statement', `<html><body>${longEvidence('Official')}</body></html>`],
    ['https://only.example/story', `<html><body>${longEvidence('Only')}</body></html>`]
  ]);
  const http = {
    async get(url) {
      if (htmlByUrl.has(url)) return { data: htmlByUrl.get(url), headers: { 'content-type': 'text/html' } };
      throw new Error(`Unexpected network request in offline verifier: ${url}`);
    }
  };
  const noReference = { async research() { throw new Error('reference adapter should be disabled in this fixture'); } };

  const tempDb = path.join(os.tmpdir(), `agenttube-autonomous-research-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();

  const engine = new AutonomousResearchV126(db, {
    http,
    referenceResearch: noReference,
    policy: { maxRounds: 1, maxSources: 8, useGdeltDiscovery: false, useReferenceResearch: false, minimumCoverageRatio: 0.5, minimumEvidenceScore: 55 }
  });
  const policyState = await engine.setPolicy({ maxRounds: 1, useGdeltDiscovery: false, useReferenceResearch: false, minimumCoverageRatio: 0.5, minimumEvidenceScore: 55 }, 'ci-fixture', 'Validate autonomous research policy audit');
  check(policyState.revisionNumber === 1, 'first research policy revision must be 1');

  const readyCandidate = {
    ...candidate,
    cluster: {
      ...candidate.cluster,
      articles: [
        { id: 'seed1', url: 'https://one.example/story', title: 'Verified timeline', sourceName: 'One', publishedAt: '2026-09-16T10:00:00Z' },
        { id: 'seed2', url: 'https://two.example/story', title: 'Affected regions', sourceName: 'Two', publishedAt: '2026-09-16T10:02:00Z' },
        { id: 'seed3', url: 'https://example.gov/statement', title: 'Official statement', sourceName: 'Government', publishedAt: '2026-09-16T10:03:00Z' }
      ]
    }
  };
  const run = await engine.researchSelected({ editorialPlan: plan, candidate: readyCandidate, brainDecision: { id: 'brain1', action: 'COVER', selected: true }, decision: { id: 'decision1', action: 'COVER' }, scanId: 'scan_ready' });
  check(run.status === READY, 'fully corroborated fixture must reach EVIDENCE_READY');
  check(run.roundCount === 1, 'ready fixture should stop after first round');
  check(run.independentSourceCount === 3 && run.primarySourceCount === 1, 'ready run must persist evidence breadth');
  const reused = await engine.researchSelected({ editorialPlan: plan, candidate: readyCandidate, brainDecision: { id: 'brain1', action: 'COVER', selected: true }, decision: { id: 'decision1', action: 'COVER' }, scanId: 'scan_ready' });
  check(reused.id === run.id, 'same plan/evidence snapshot must reuse deterministic research run');
  check((await engine.listRuns(20)).length === 1, 'idempotent research run must persist once');
  const rounds = await db.getAllRows('SELECT * FROM newsroom_autonomous_research_rounds WHERE run_id = ? ORDER BY round_number', [run.id]);
  check(rounds.length === 1 && rounds[0].status === READY, 'round audit must persist EVIDENCE_READY');

  const blockedPlan = { id: 'plan_blocked', topic: 'Sparse developing story', research: { minimumIndependentSources: 3, primarySourceRequired: true, questions: ['What is the verified timeline?'] } };
  const blockedCandidate = { cluster: { id: 'cluster_blocked', canonicalTitle: blockedPlan.topic, articles: [{ id: 'only', url: 'https://only.example/story', title: 'Single report', sourceName: 'Only' }] }, event: { id: 'event_blocked', revisionNumber: 1 } };
  const blocked = await engine.researchSelected({ editorialPlan: blockedPlan, candidate: blockedCandidate, decision: { id: 'decision2', action: 'COVER' }, brainDecision: { id: 'brain2', action: 'COVER', selected: true }, scanId: 'scan_blocked' });
  check(blocked.status === BLOCK, 'exhausted research without required corroboration must BLOCK');
  check(blocked.gaps.includes('primary_or_official_source_required'), 'blocked run must expose missing primary-source gap');
  check(blocked.independentSourceCount === 1, 'blocked run source count mismatch');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.6 Autonomous Research verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
