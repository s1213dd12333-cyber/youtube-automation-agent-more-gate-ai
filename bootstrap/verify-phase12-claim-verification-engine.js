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
    url: `https://${domain}/story-${id}`,
    publisher: domain,
    sourceClass,
    status: 'verified',
    evidenceText: `${sentence} Additional context explains the timeline, affected regions, response details, and publication timing without adding unsupported conclusions.`
  };
}

function readyRun(id, questions, sources, requirements = {}) {
  return {
    id: `research_${id}`,
    status: 'EVIDENCE_READY',
    planId: `plan_${id}`,
    decisionId: `decision_${id}`,
    clusterId: `cluster_${id}`,
    fingerprint: `research_fp_${id}`,
    requirements: { minimumIndependentSources: 2, primarySourceRequired: false, ...requirements },
    questions,
    sources
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
    "const CLAIM_CONFIRMED = 'confirmed'",
    "const CLAIM_REPORTED = 'reported'",
    "const CLAIM_CLAIMED = 'claimed'",
    "const CLAIM_DISPUTED = 'disputed'",
    "const CLAIM_UNVERIFIED = 'unverified'",
    "const CLAIM_FALSE = 'false'",
    "const CLAIM_UNKNOWN = 'unknown'",
    'class EvidenceTruthEngineV127',
    'classificationCounts',
    'buildClaimForQuestion',
    'synthesizeClaims',
    'assessPacket',
    'packet_fingerprint'
  ]) check(serviceSource.includes(needle), `Evidence / Truth runtime missing contract: ${needle}`);

  for (const table of ['newsroom_claim_verification_packets','newsroom_claim_verification_claims']) check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  check(dbSource.includes("CHECK(status IN ('VERIFIED','NEEDS_RESEARCH','BLOCK'))"), 'packet status enum must be constrained');
  check(dbSource.includes("CHECK(classification IN ('confirmed','reported','claimed','disputed','unverified','false','unknown'))"), 'truth classification enum must be constrained');
  check(dbSource.includes('classification_counts_json TEXT NOT NULL'), 'packet must persist exact classification counts');
  check(dbSource.includes('packet_fingerprint TEXT NOT NULL UNIQUE'), 'truth packet must be immutable/idempotent');
  check(dbSource.includes('UNIQUE(packet_id, ordinal)'), 'claim ordinals must be unique per packet');

  for (const needle of [
    "require('./claim-verification-engine-v127')",
    'EvidenceTruthEngineV127',
    'this.claimVerification',
    'await this.claimVerification.verifyResearch',
    "autonomousResearch?.status === 'EVIDENCE_READY'",
    "claimVerification?.status === 'VERIFIED'",
    'claimVerification: cluster.claimVerification || null',
    'promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification)'
  ]) check(radarSource.includes(needle), `Global News Radar missing Phase 12.7 integration: ${needle}`);
  check(radarSource.includes('factual claims still require the Research & Provenance Desk before publication'), '12.7 must preserve downstream Research & Provenance gate');
  check(radarSource.includes('classificationCounts?.confirmed'), 'backlog rationale must expose confirmed truth count');

  for (const route of [
    "'/api/newsroom/claims/status', protect",
    "'/api/newsroom/claims/packets', protect",
    "'/api/newsroom/claims/packets/:packetId', protect"
  ]) check(indexSource.includes(route), `protected Evidence / Truth API missing ${route}`);
  check(htmlSource.includes('EVIDENCE / TRUTH 12.7'), 'dashboard missing Evidence / Truth panel');
  check(htmlSource.includes('/newsroom-claims-v127.js'), 'dashboard missing Evidence / Truth client');
  check(dashboardSource.includes("api('/api/newsroom/claims/status')"), 'truth dashboard must read live status API');
  for (const classification of ['confirmed','reported','claimed','disputed','unverified','false','unknown']) check(dashboardSource.includes(classification), `dashboard missing ${classification} classification`);

  for (const key of [
    'NEWSROOM_CLAIM_VERIFICATION_ENABLED=true',
    'NEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS=2',
    'NEWSROOM_CLAIM_MIN_TOKEN_COVERAGE=0.22',
    'NEWSROOM_CLAIM_MIN_CONFIDENCE=62',
    'NEWSROOM_CLAIM_UNRESOLVED_RATIO=0.01'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:claim-verification'] === 'node ../bootstrap/verify-phase12-claim-verification-engine.js', 'package missing Phase 12.7 test command');

  const {
    VERSION, VERIFIED, NEEDS_RESEARCH, BLOCK,
    CLAIM_CONFIRMED, CLAIM_REPORTED, CLAIM_CLAIMED, CLAIM_DISPUTED,
    CLAIM_UNVERIFIED, CLAIM_FALSE, CLAIM_UNKNOWN,
    defaultPolicy, normalizePolicy, bestSentence, buildClaimForQuestion,
    synthesizeClaims, classificationCounts, assessPacket, EvidenceTruthEngineV127
  } = require(servicePath);
  check(VERSION === '12.7', 'truth engine version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.minimumSupportingDomains === 2 && policy.minimumClaimConfidence === 62, 'default truth policy mismatch');

  const timelineQuestion = 'What is the verified timeline?';
  const confirmedRun = readyRun('confirmed', [timelineQuestion], [
    source('a','one.example','The verified timeline began Tuesday and emergency response started within one hour.'),
    source('b','two.example','The verified timeline began Tuesday and emergency response started within one hour.'),
    source('c','agency.gov','The verified timeline began Tuesday and emergency response started within one hour.','official')
  ], { primarySourceRequired: true });
  const match = bestSentence(timelineQuestion, confirmedRun.sources[0]);
  check(match && match.score > 0, 'truth engine must bind a verification target to evidence text');
  const confirmed = buildClaimForQuestion(timelineQuestion, confirmedRun, policy);
  check(confirmed.classification === CLAIM_CONFIRMED, 'independently corroborated claim with required official support must be confirmed');
  check(confirmed.supportDomains.length >= 2, 'confirmed claim must retain independent supporting domains');

  const reportedQuestion = 'When did the telescope launch occur?';
  const reported = buildClaimForQuestion(reportedQuestion, readyRun('reported', [reportedQuestion], [
    source('r1','reference.example','The telescope launch occurred Monday after a weather delay.','reference')
  ]), policy);
  check(reported.classification === CLAIM_REPORTED, 'credible source-bound but not corroborated evidence must remain reported');

  const claimedQuestion = 'When did the company announce the acquisition?';
  const claimed = buildClaimForQuestion(claimedQuestion, readyRun('claimed', [claimedQuestion], [
    source('c1','companywatch.example','The company claimed the acquisition was announced Monday during private negotiations.')
  ]), policy);
  check(claimed.classification === CLAIM_CLAIMED, 'explicitly attributed assertion without corroboration must remain claimed');

  const unverifiedQuestion = 'When did the prototype test begin?';
  const unverified = buildClaimForQuestion(unverifiedQuestion, readyRun('unverified', [unverifiedQuestion], [
    source('u1','single.example','The prototype test began Monday at the remote facility before sunrise.')
  ]), policy);
  check(unverified.classification === CLAIM_UNVERIFIED, 'weak single-source assertion must remain unverified');

  const unknown = buildClaimForQuestion('What is the unrelated satellite orbit?', confirmedRun, policy);
  check(unknown.classification === CLAIM_UNKNOWN, 'missing relevant evidence must be unknown, never invented');

  const disputedRun = readyRun('disputed', [timelineQuestion], [
    source('d1','positive-one.example','The verified timeline began Tuesday and emergency response started within one hour.'),
    source('d2','positive-two.example','The verified timeline began Tuesday and emergency response started within one hour.'),
    source('d3','negative-one.example','The verified timeline did not begin Tuesday and the emergency response timing is disputed.'),
    source('d4','negative-two.example','The verified timeline did not begin Tuesday and the emergency response timing is disputed.')
  ]);
  const disputed = buildClaimForQuestion(timelineQuestion, disputedRun, policy);
  check(disputed.classification === CLAIM_DISPUTED, 'independently supported opposing camps must be disputed');
  check(disputed.contradictionDomains.length >= 2, 'disputed claim must preserve independent contradiction domains');

  const falseRun = readyRun('false', [timelineQuestion], [
    source('f1','rumor.example','The verified timeline began Tuesday and emergency response started within one hour.'),
    source('f2','agency.gov','The verified timeline did not begin Tuesday and the published record contradicts that timing.','official'),
    source('f3','records.example','The verified timeline did not begin Tuesday and the official record contradicts that timing.')
  ]);
  const falsified = buildClaimForQuestion(timelineQuestion, falseRun, policy);
  check(falsified.classification === CLAIM_FALSE, 'weak proposition contradicted by independent authoritative evidence must be false');
  check(falsified.contradictingSources.some(item => item.sourceClass === 'official'), 'false classification must retain authoritative contradiction provenance');

  const repeatedRun = readyRun('repetition', [timelineQuestion], [
    source('same1','syndicated.example','The verified timeline began Tuesday and emergency response started within one hour.'),
    source('same2','syndicated.example','The verified timeline began Tuesday and emergency response started within one hour.')
  ]);
  const repeated = buildClaimForQuestion(timelineQuestion, repeatedRun, policy);
  check(repeated.supportDomains.length === 1, 'repetition from the same domain must not count as independent corroboration');
  check(repeated.classification !== CLAIM_CONFIRMED, 'repetition alone must never turn a claim into confirmed fact');

  const counts = classificationCounts([confirmed, reported, claimed, disputed, unverified, falsified, unknown]);
  for (const classification of ['confirmed','reported','claimed','disputed','unverified','false','unknown']) check(counts[classification] === 1, `classification count mismatch for ${classification}`);
  check(assessPacket([confirmed], policy).status === VERIFIED, 'all-confirmed packet must be VERIFIED');
  check(assessPacket([confirmed, reported], policy).status === NEEDS_RESEARCH, 'reported claim must keep packet in NEEDS_RESEARCH');
  check(assessPacket([confirmed, claimed], policy).status === NEEDS_RESEARCH, 'claimed assertion must keep packet in NEEDS_RESEARCH');
  check(assessPacket([disputed], policy).status === BLOCK, 'disputed claim must BLOCK automatic promotion');
  check(assessPacket([falsified], policy).status === BLOCK, 'false claim must BLOCK automatic promotion');

  const plan = { id: 'plan_persisted', research: { questions: [timelineQuestion] } };
  const tempDb = path.join(os.tmpdir(), `agenttube-truth-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database(); db.dbPath = tempDb; await db.initialize();
  const engine = new EvidenceTruthEngineV127(db);
  const packet = await engine.verifyResearch({ researchRun: confirmedRun, editorialPlan: plan, decision: { id: 'decision_persisted' } });
  check(packet.status === VERIFIED, 'persisted confirmed fixture must reach VERIFIED');
  check(packet.classificationCounts.confirmed === 1 && packet.claimCount === 1, 'persisted packet classification counters mismatch');
  const stored = await engine.getPacket(packet.id);
  check(stored && stored.claims.length === 1, 'truth packet and claim rows must round-trip');
  check(stored.claims[0].classification === CLAIM_CONFIRMED, 'stored claim must retain truth classification');
  check(stored.claims[0].supportDomains.length >= 2, 'stored claim must retain source-domain provenance');
  const reused = await engine.verifyResearch({ researchRun: confirmedRun, editorialPlan: plan, decision: { id: 'decision_persisted' } });
  check(reused.id === packet.id, 'same research snapshot must reuse deterministic truth packet');
  check((await engine.listPackets(20)).length === 1, 'idempotent truth packet must persist once');

  let rejected = false;
  try { await engine.verifyResearch({ researchRun: { ...confirmedRun, id: 'not_ready', status: 'BLOCK' }, editorialPlan: plan }); } catch (error) { rejected = error.code === 'evidence_ready_research_run_required'; }
  check(rejected, 'Evidence / Truth Engine must fail closed for non-EVIDENCE_READY research');

  const neutralA = buildClaimForQuestion(timelineQuestion, { ...confirmedRun, publicActor: 'A' }, policy);
  const neutralB = buildClaimForQuestion(timelineQuestion, { ...confirmedRun, publicActor: 'B' }, policy);
  check(neutralA.classification === neutralB.classification && neutralA.confidenceScore === neutralB.confidenceScore, 'actor metadata must not influence truth classification');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}
  console.log(`Phase 12.7 Evidence / Truth Engine verified: ${checks} checks passed.`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
