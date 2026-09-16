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

function source(id, domain, sentence, sourceClass = 'web') {
  return {
    id,
    url: `https://${domain}/story`,
    publisher: domain,
    sourceClass,
    status: 'verified',
    evidenceText: `${sentence} Additional context explains the verified timeline, affected regions, response details, and publication timing without adding unsupported conclusions.`
  };
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'claim-verification-engine-v127.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-claims-v127.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.7 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/claim-verification-engine-v127.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const dashboardSource = read('dashboard/newsroom-claims-v127.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.7'",
    "const VERIFIED = 'VERIFIED'",
    "const NEEDS_RESEARCH = 'NEEDS_RESEARCH'",
    "const BLOCK = 'BLOCK'",
    "const CLAIM_SUPPORTED = 'SUPPORTED'",
    "const CLAIM_CONTESTED = 'CONTESTED'",
    "const CLAIM_INSUFFICIENT = 'INSUFFICIENT'",
    'minimumSupportingDomains',
    'buildClaimForQuestion',
    'synthesizeClaims',
    'assessPacket',
    'packet_fingerprint'
  ]) check(serviceSource.includes(needle), `Claim Verification runtime missing contract: ${needle}`);

  for (const table of ['newsroom_claim_verification_packets','newsroom_claim_verification_claims']) check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  check(dbSource.includes("CHECK(status IN ('VERIFIED','NEEDS_RESEARCH','BLOCK'))"), 'packet status enum must be constrained');
  check(dbSource.includes("CHECK(status IN ('SUPPORTED','CONTESTED','INSUFFICIENT'))"), 'claim status enum must be constrained');
  check(dbSource.includes('packet_fingerprint TEXT NOT NULL UNIQUE'), 'claim packet must be immutable/idempotent');
  check(dbSource.includes('UNIQUE(packet_id, ordinal)'), 'claim ordinals must be unique per packet');

  for (const needle of [
    "require('./claim-verification-engine-v127')",
    'this.claimVerification',
    'await this.claimVerification.verifyResearch',
    "autonomousResearch?.status === 'EVIDENCE_READY'",
    "claimVerification?.status === 'VERIFIED'",
    'claimVerification: cluster.claimVerification || null',
    'promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification)'
  ]) check(radarSource.includes(needle), `Global News Radar missing Phase 12.7 integration: ${needle}`);
  check(radarSource.includes('factual claims still require the Research & Provenance Desk before publication'), '12.7 must preserve downstream Research & Provenance gate');

  for (const route of [
    "'/api/newsroom/claims/status', protect",
    "'/api/newsroom/claims/packets', protect",
    "'/api/newsroom/claims/packets/:packetId', protect"
  ]) check(indexSource.includes(route), `protected claim verification API missing ${route}`);
  check(htmlSource.includes('CLAIM VERIFICATION 12.7'), 'dashboard missing claim verification panel');
  check(htmlSource.includes('/newsroom-claims-v127.js'), 'dashboard missing claim verification client');
  check(dashboardSource.includes("api('/api/newsroom/claims/status')"), 'claim dashboard must read live status API');

  for (const key of [
    'NEWSROOM_CLAIM_VERIFICATION_ENABLED=true',
    'NEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS=2',
    'NEWSROOM_CLAIM_MIN_TOKEN_COVERAGE=0.22',
    'NEWSROOM_CLAIM_MIN_CONFIDENCE=62',
    'NEWSROOM_CLAIM_INSUFFICIENT_RATIO=0.45'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:claim-verification'] === 'node ../bootstrap/verify-phase12-claim-verification-engine.js', 'package missing Phase 12.7 test command');

  const {
    VERSION, VERIFIED, NEEDS_RESEARCH, BLOCK,
    CLAIM_SUPPORTED, CLAIM_CONTESTED, CLAIM_INSUFFICIENT,
    defaultPolicy, normalizePolicy, bestSentence, buildClaimForQuestion,
    synthesizeClaims, assessPacket, ClaimVerificationEngineV127
  } = require(servicePath);
  check(VERSION === '12.7', 'claim verification version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.minimumSupportingDomains === 2 && policy.minimumClaimConfidence === 62, 'default claim policy mismatch');

  const question = 'What is the verified timeline?';
  const run = {
    id: 'research_ready_fixture',
    status: 'EVIDENCE_READY',
    planId: 'plan_fixture',
    decisionId: 'decision_fixture',
    clusterId: 'cluster_fixture',
    fingerprint: 'research_fp_fixture',
    requirements: { minimumIndependentSources: 3, primarySourceRequired: true },
    questions: [question, 'Which affected regions are confirmed?'],
    sources: [
      source('a', 'one.example', 'The verified timeline began Tuesday and emergency response started within one hour.'),
      source('b', 'two.example', 'The verified timeline began Tuesday and emergency response started within one hour.'),
      source('c', 'agency.gov', 'The verified timeline began Tuesday and emergency response started within one hour.', 'official'),
      source('d', 'region.example', 'The confirmed affected regions are Region A and Region B.'),
      source('e', 'agency.gov', 'The confirmed affected regions are Region A and Region B.', 'official')
    ]
  };
  const match = bestSentence(question, run.sources[0]);
  check(match && match.score > 0, 'claim verifier must bind question to evidence sentence');
  const firstClaim = buildClaimForQuestion(question, run, policy);
  check(firstClaim.status === CLAIM_SUPPORTED, 'corroborated claim with official support should be SUPPORTED');
  check(firstClaim.supportDomains.length >= 2, 'supported claim must carry independent domains');
  check(firstClaim.evidenceExcerpts.length >= 2, 'supported claim must preserve evidence excerpts');
  check(firstClaim.supportingSources.some(item => item.sourceClass === 'official'), 'primary-required claim must retain official support');

  const claims = synthesizeClaims(run, { id: 'plan_fixture', research: { questions: run.questions } }, policy);
  check(claims.length === 2, 'each planned research question should produce a claim target');
  check(claims.every(claim => claim.status === CLAIM_SUPPORTED), 'fixture claims should all be supported');
  const packetAssessment = assessPacket(claims, policy);
  check(packetAssessment.status === VERIFIED, 'all supported claims should make packet VERIFIED');

  const sparse = buildClaimForQuestion(question, { ...run, requirements: { primarySourceRequired: false }, sources: [run.sources[0]] }, policy);
  check(sparse.status === CLAIM_INSUFFICIENT, 'single-domain claim must remain INSUFFICIENT');
  check(assessPacket([firstClaim, sparse], policy).status === NEEDS_RESEARCH, 'high insufficient ratio should request more research');

  const contestedRun = {
    ...run,
    requirements: { primarySourceRequired: false },
    questions: [question],
    sources: [
      source('pos', 'positive.example', 'The verified timeline began Tuesday and emergency response started within one hour.'),
      source('neg', 'negative.example', 'The verified timeline did not begin Tuesday and the reported emergency response timing is disputed.')
    ]
  };
  const contested = buildClaimForQuestion(question, contestedRun, policy);
  check(contested.status === CLAIM_CONTESTED, 'direct polarity conflict without sufficient corroboration must be CONTESTED');
  check(contested.contradictingSources.length >= 1, 'contested claim must identify contradicting source');
  check(assessPacket([contested], policy).status === BLOCK, 'contested mandatory claim must BLOCK packet');

  const noMatch = buildClaimForQuestion('What is the unrelated satellite orbit?', run, policy);
  check(noMatch.status === CLAIM_INSUFFICIENT, 'unmatched question must be INSUFFICIENT, never invented');

  const politicalA = { ...run, id: 'research_actor_a', questions: ['What is the verified election timeline?'], requirements: { primarySourceRequired: false }, sources: [source('pa','one.example','The verified election timeline began Tuesday according to the published schedule.'), source('pb','two.example','The verified election timeline began Tuesday according to the published schedule.')] };
  const politicalB = { ...politicalA, id: 'research_actor_b' };
  const a = buildClaimForQuestion(politicalA.questions[0], politicalA, policy);
  const b = buildClaimForQuestion(politicalB.questions[0], politicalB, policy);
  check(a.status === b.status && a.confidenceScore === b.confidenceScore, 'political actor identity must not alter verification outcome when evidence is identical');

  const tempDb = path.join(os.tmpdir(), `agenttube-claim-verification-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const engine = new ClaimVerificationEngineV127(db);
  const plan = { id: 'plan_fixture', research: { questions: run.questions } };
  const packet = await engine.verifyResearch({ researchRun: run, editorialPlan: plan, decision: { id: 'decision_fixture' } });
  check(packet.status === VERIFIED, 'persisted verified fixture must reach VERIFIED');
  check(packet.claimCount === 2 && packet.supportedCount === 2, 'persisted packet counters mismatch');
  const stored = await engine.getPacket(packet.id);
  check(stored && stored.claims.length === 2, 'claim packet and claim rows must round-trip');
  check(stored.claims[0].supportDomains.length >= 2, 'stored claim must retain source-domain provenance');
  const reused = await engine.verifyResearch({ researchRun: run, editorialPlan: plan, decision: { id: 'decision_fixture' } });
  check(reused.id === packet.id, 'same evidence snapshot must reuse deterministic claim packet');
  check((await engine.listPackets(20)).length === 1, 'idempotent claim packet must persist once');

  let rejected = false;
  try { await engine.verifyResearch({ researchRun: { ...run, id: 'not_ready', status: 'BLOCK' }, editorialPlan: plan }); } catch (error) { rejected = error.code === 'evidence_ready_research_run_required'; }
  check(rejected, 'claim verification must fail closed for non-EVIDENCE_READY research');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}
  console.log(`Phase 12.7 Claim Verification & Evidence Synthesis verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
