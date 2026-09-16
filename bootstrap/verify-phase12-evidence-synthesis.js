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

function evidence(label, extra = '') {
  return `${label}. Officials confirmed the verified timeline and the affected regions in a published statement. Independent reporting corroborated the verified timeline and the affected regions. ${extra} The available evidence preserves attribution and does not ask the system to infer facts outside the cited source.`;
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'evidence-synthesis-v127.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-synthesis-v127.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.7 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/evidence-synthesis-v127.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const dashboardSource = read('dashboard/newsroom-synthesis-v127.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.7'",
    "const READY = 'SYNTHESIS_READY'",
    "const BLOCK = 'BLOCK'",
    'buildCitations',
    'buildQuestionClaims',
    'explicitContradictions',
    'synthesizeBrief',
    'preserveUncertaintyLabels',
    'brief_fingerprint'
  ]) check(serviceSource.includes(needle), `Evidence Synthesis runtime missing contract: ${needle}`);

  for (const table of ['newsroom_evidence_synthesis_policy_revisions','newsroom_research_briefs','newsroom_research_brief_claims']) {
    check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  }
  check(dbSource.includes("CHECK(status IN ('SYNTHESIS_READY','BLOCK'))"), 'brief status enum must be constrained');
  check(dbSource.includes('brief_fingerprint TEXT NOT NULL UNIQUE'), 'brief snapshot must be immutable/idempotent');
  check(dbSource.includes('UNIQUE(brief_id, claim_fingerprint)'), 'brief claims must be idempotent');

  for (const needle of [
    "require('./evidence-synthesis-v127')",
    'this.evidenceSynthesis',
    'await this.evidenceSynthesis.synthesize',
    "researchBrief?.status === 'SYNTHESIS_READY'",
    'synthesisGatePassed',
    'promoteDecision(decision.id, editorialPlan, autonomousResearch, researchBrief)',
    'researchBrief: cluster.researchBrief || null'
  ]) check(radarSource.includes(needle), `Global News Radar missing Phase 12.7 integration: ${needle}`);
  check(radarSource.includes('promoteDecision(decision.id, editorialPlan, autonomousResearch)'), 'Phase 12.6 promotion contract must remain available');
  check(radarSource.includes('promoteDecision(decision.id, editorialPlan)'), 'Phase 12.5 disabled-mode promotion contract must remain available');
  check(radarSource.includes('factual claims still require the Research & Provenance Desk before publication'), 'research brief must not bypass downstream Research & Provenance');

  for (const route of [
    "'/api/newsroom/synthesis/status', protect",
    "'/api/newsroom/synthesis/briefs', protect",
    "'/api/newsroom/synthesis/briefs/:briefId', protect",
    "'/api/newsroom/synthesis/policy', protect"
  ]) check(indexSource.includes(route), `protected Evidence Synthesis API missing ${route}`);
  check(indexSource.includes("this.app.post('/api/newsroom/synthesis/policy', protect"), 'audited synthesis policy endpoint missing');
  check(indexSource.includes('evidence_synthesis_policy_reason_required'), 'synthesis policy changes must require audit reason');

  check(htmlSource.includes('EVIDENCE SYNTHESIS 12.7'), 'dashboard missing Evidence Synthesis panel');
  check(htmlSource.includes('/newsroom-synthesis-v127.js'), 'dashboard missing Phase 12.7 client');
  check(dashboardSource.includes("api('/api/newsroom/synthesis/status')"), 'synthesis dashboard must read live status API');

  for (const key of [
    'NEWSROOM_EVIDENCE_SYNTHESIS_ENABLED=true',
    'NEWSROOM_SYNTHESIS_MAX_CLAIMS=16',
    'NEWSROOM_SYNTHESIS_MIN_CLAIMS=2',
    'NEWSROOM_SYNTHESIS_MIN_QUESTION_SUPPORT=0.60',
    'NEWSROOM_SYNTHESIS_MIN_CONFIDENCE=62'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:evidence-synthesis'] === 'node ../bootstrap/verify-phase12-evidence-synthesis.js', 'package missing Phase 12.7 test command');

  const {
    VERSION, READY, BLOCK, defaultPolicy, normalizePolicy, buildCitations,
    buildQuestionClaims, explicitContradictions, synthesizeBrief, EvidenceSynthesisV127
  } = require(servicePath);
  check(VERSION === '12.7', 'runtime version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.maxClaims === 16 && policy.minimumClaims === 2, 'default synthesis policy mismatch');

  const plan = {
    id: 'plan_synthesis_ready',
    topic: 'International infrastructure emergency',
    research: {
      minimumIndependentSources: 3,
      primarySourceRequired: true,
      questions: ['What is the verified timeline?', 'Which affected regions are confirmed?']
    }
  };
  const sources = [
    { id: 's1', url: 'https://one.example/story', title: 'Verified timeline', publisher: 'One', status: 'verified', sourceClass: 'web', evidenceText: evidence('Source one') },
    { id: 's2', url: 'https://two.example/story', title: 'Affected regions', publisher: 'Two', status: 'verified', sourceClass: 'web', evidenceText: evidence('Source two') },
    { id: 's3', url: 'https://agency.gov/statement', title: 'Official statement', publisher: 'Agency', status: 'verified', sourceClass: 'official', evidenceText: evidence('Official source') }
  ];
  const findings = plan.research.questions.map((question, index) => ({ index, question, covered: true, matches: sources.map(source => ({ sourceId: source.id, url: source.url, matchedTokens: ['verified','timeline'] })) }));
  const run = {
    id: 'run_ready', status: 'EVIDENCE_READY', evidenceScore: 88, coverageRatio: 1,
    independentSourceCount: 3, primarySourceCount: 1, sources, findings, runFingerprint: 'run_fp_ready'
  };
  const citations = buildCitations(run, policy);
  check(citations.length === 3 && citations[0].id === 'C1', 'verified sources must become deterministic citations');
  const questionClaims = buildQuestionClaims(plan, run, policy);
  check(questionClaims.claims.length === 2, 'each covered research question should yield a source-grounded claim');
  check(questionClaims.claims.every(claim => claim.sourceIds.length === 3), 'claim provenance must retain every matching source');
  check(questionClaims.claims.every(claim => sources.some(source => source.evidenceText.includes(claim.text))), 'claim text must be an excerpt from source evidence');

  const brief = synthesizeBrief({ editorialPlan: plan, researchRun: run, candidate: { cluster: { id: 'cluster1', canonicalTitle: plan.topic }, event: { id: 'event1' } } }, policy);
  check(brief.status === READY, 'corroborated EVIDENCE_READY research must reach SYNTHESIS_READY');
  check(brief.claimCount === 2 && brief.corroboratedClaimCount === 2, 'brief claim counts mismatch');
  check(brief.confidenceScore >= policy.minimumBriefConfidence, 'ready brief confidence must pass threshold');
  check(brief.citations.length === 3, 'ready brief must preserve citation catalog');
  check(brief.uncertainties.every(item => !item.startsWith('unresolved_question:')), 'fully supported questions must not be marked unresolved');

  const blocked = synthesizeBrief({ editorialPlan: plan, researchRun: { ...run, status: 'BLOCK' } }, policy);
  check(blocked.status === BLOCK && blocked.confidenceScore === 0, 'non-ready Autonomous Research must fail closed');

  const contradictions = explicitContradictions([{ question: 'Was service restored?', supported: true, evidenceExcerpts: [
    'Officials confirmed the service was restored after the verified inspection process concluded.',
    'Officials did not confirm the service was restored after the verified inspection process concluded.'
  ] }]);
  check(contradictions.length === 1 && contradictions[0].type === 'explicit_polarity_conflict', 'explicit polarity conflict must be detected conservatively');

  const politicalA = synthesizeBrief({ editorialPlan: { ...plan, topic: 'Candidate A election development' }, researchRun: run }, policy);
  const politicalB = synthesizeBrief({ editorialPlan: { ...plan, topic: 'Candidate B election development' }, researchRun: run }, policy);
  check(politicalA.status === politicalB.status && politicalA.confidenceScore === politicalB.confidenceScore, 'actor name alone must not change evidence synthesis readiness or confidence');

  const tempDb = path.join(os.tmpdir(), `agenttube-evidence-synthesis-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const engine = new EvidenceSynthesisV127(db, { policy });
  const policyState = await engine.setPolicy({ minimumBriefConfidence: 62 }, 'ci-fixture', 'Validate synthesis policy audit');
  check(policyState.revisionNumber === 1, 'first synthesis policy revision must be 1');

  const input = {
    editorialPlan: plan,
    researchRun: run,
    candidate: { cluster: { id: 'cluster1', canonicalTitle: plan.topic }, event: { id: 'event1' } },
    decision: { id: 'decision1', action: 'COVER' },
    brainDecision: { id: 'brain1', selected: true },
    scanId: 'scan1'
  };
  const first = await engine.synthesize(input);
  const second = await engine.synthesize(input);
  check(first.id === second.id, 'identical synthesis snapshot must reuse deterministic brief');
  check(first.status === READY, 'persisted ready brief status mismatch');
  check(first.claims.length === 2, 'persisted claim ledger must round-trip');
  check((await engine.listBriefs(20)).length === 1, 'idempotent brief must persist once');
  await engine.linkPromotion(first.id, { idea: { id: 'idea1' }, assignmentId: 'assignment1' });
  const linked = await engine.getBrief(first.id);
  check(linked.promotedIdeaId === 'idea1' && linked.assignmentId === 'assignment1', 'brief must retain promotion linkage');
  const status = await engine.status();
  check(status.totals.SYNTHESIS_READY === 1, 'status API model must count ready brief');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.7 Evidence Synthesis verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
