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

function truthPacket(overrides = {}) {
  const claims = overrides.claims || [
    { id: 'claim_1', claimText: 'Authorities confirmed the event.', classification: 'confirmed', supportingSources: [{ url: 'https://official.example/report' }] },
    { id: 'claim_2', claimText: 'Independent reporting corroborated the timeline.', classification: 'confirmed', supportingSources: [{ url: 'https://news.example/story' }] }
  ];
  return { id: 'packet_fixture', status: 'VERIFIED', claims, claimCount: claims.length, fingerprint: 'truth_fp', ...overrides };
}
function directive(packet = truthPacket(), overrides = {}) {
  return {
    id: 'directive_fixture', status: 'PLAN_READY', mode: 'balanced', visualStrategy: 'evidence_first_hybrid', providerTier: 'local_first',
    maxBudgetUsd: 2, targetDurationSeconds: 480, sceneSeconds: 18, sceneCount: 27,
    visuals: { needsMap: true, needsTimeline: true, needsDataChart: false, needsDocuments: false, generatedVisualsCannotDepictUnverifiedFacts: true },
    factLocks: packet.claims.map(claim => ({ claimId: claim.id, classification: claim.classification, text: claim.claimText, mustAttribute: true, supportingSources: claim.supportingSources.map(source => source.url) })),
    forbidden: ['invent_facts','upgrade_reported_to_confirmed','remove_required_attribution','depict_unverified_claim_as_observed_fact'],
    ...overrides
  };
}
function production(overrides = {}) {
  return {
    id: 'production_fixture',
    script: { title: 'International Event Explained', fullScript: 'A'.repeat(600) },
    seo: { title: 'International Event Explained', description: 'A detailed factual description of the international event and the verified timeline.', tags: ['world','news','explainer'] },
    assets: { finalVideo: { path: 'C:/tmp/final.mp4', simulated: false }, thumbnail: { path: 'C:/tmp/thumb.png' } },
    scenes: [{ id: 'scene_1', assetOrigin: 'generated', rightsConfirmed: false }],
    provenance: { status: 'verified', summary: { unresolvedClaims: 0, resolvedClaims: 2 } },
    ...overrides
  };
}
function quality(overrides = {}) {
  return {
    passed: true,
    score: 100,
    blockingFailures: [],
    checks: [
      { id: 'narration', passed: true, blocking: true, message: 'Narration ready' },
      { id: 'scene_integrity', passed: true, blocking: true, message: 'Scenes ready' },
      { id: 'scene_rights', passed: true, blocking: true, message: 'Rights ready' },
      { id: 'provenance', passed: true, blocking: true, message: 'Provenance ready' }
    ],
    ...overrides
  };
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'autonomous-quality-council-v129.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-quality-council-v129.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.9 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/autonomous-quality-council-v129.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const dashboardSource = read('dashboard/newsroom-quality-council-v129.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.9'", "const PASS = 'PASS'", "const REPAIR = 'REPAIR'", "const BLOCK = 'BLOCK'",
    'truth_integrity', 'fact_lock_guard', 'attribution_guard', 'visual_truth_guard', 'production_feasibility', 'editorial_safety',
    'factual_quality', 'provenance_guard', 'script_and_metadata', 'visual_integrity', 'media_rights', 'publish_readiness'
  ]) check(serviceSource.includes(needle), `Quality Council runtime missing contract: ${needle}`);

  for (const table of ['newsroom_quality_council_policy_revisions','newsroom_quality_council_reviews']) {
    check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  }
  check(dbSource.includes("CHECK(status IN ('PASS','REPAIR','BLOCK'))"), 'Quality Council status enum must be constrained');
  check(dbSource.includes('review_fingerprint TEXT NOT NULL UNIQUE'), 'Quality Council review fingerprint must be unique');

  for (const needle of [
    "require('./autonomous-quality-council-v129')",
    'this.qualityCouncil',
    'await this.qualityCouncil.reviewPreProduction',
    "qualityCouncilReview?.status === 'PASS'",
    'await this.qualityCouncil.linkPromotion',
    'qualityCouncilReview: cluster.qualityCouncilReview || null'
  ]) check(radarSource.includes(needle), `Global News Radar missing Quality Council integration: ${needle}`);

  for (const needle of [
    "require('./utils/autonomous-quality-council-v129')",
    'this.qualityCouncil = new AutonomousQualityCouncilV129',
    "stage: 'generation'",
    "stage: 'approval'",
    'Autonomous Quality Council did not pass the production',
    "id: 'autonomous_quality_council'"
  ]) check(indexSource.includes(needle), `main runtime missing post-production council integration: ${needle}`);

  for (const route of [
    "'/api/newsroom/quality-council/status', protect",
    "'/api/newsroom/quality-council/reviews', protect",
    "'/api/newsroom/quality-council/reviews/:reviewId', protect",
    "'/api/newsroom/quality-council/policy', protect"
  ]) check(indexSource.includes(route), `protected Quality Council API missing ${route}`);
  check(indexSource.includes("this.app.post('/api/newsroom/quality-council/policy', protect"), 'Quality Council policy update endpoint missing');
  check(indexSource.includes('quality_council_policy_reason_required'), 'Quality Council policy changes must require a reason');
  check(htmlSource.includes('AUTONOMOUS QUALITY COUNCIL 12.9'), 'dashboard missing Quality Council panel');
  check(htmlSource.includes('/newsroom-quality-council-v129.js'), 'dashboard missing Quality Council client');
  check(dashboardSource.includes("api('/api/newsroom/quality-council/status')"), 'Quality Council dashboard must read live status');

  for (const key of [
    'NEWSROOM_QUALITY_COUNCIL_ENABLED=true', 'NEWSROOM_QUALITY_PRE_MIN_SCORE=88', 'NEWSROOM_QUALITY_POST_MIN_SCORE=90',
    'NEWSROOM_QUALITY_BLOCK_TRUTH=true', 'NEWSROOM_QUALITY_BLOCK_RIGHTS=true', 'NEWSROOM_QUALITY_REQUIRE_REAL_VIDEO=true',
    'NEWSROOM_QUALITY_REQUIRE_THUMBNAIL=true', 'NEWSROOM_QUALITY_REQUIRE_PROVENANCE=true'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:autonomous-quality-council'] === 'node ../bootstrap/verify-phase12-autonomous-quality-council.js', 'package missing 12.9 test command');

  const {
    VERSION, PASS, REPAIR, BLOCK, defaultPolicy, normalizePolicy,
    buildPreProductionReview, buildPostProductionReview, AutonomousQualityCouncilV129
  } = require(servicePath);
  check(VERSION === '12.9', 'Quality Council version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.preProductionMinScore === 88 && policy.postProductionMinScore === 90, 'default council score thresholds mismatch');

  const packet = truthPacket();
  const readyDirective = directive(packet);
  const prePass = buildPreProductionReview({
    claimVerification: packet,
    productionDirective: readyDirective,
    editorialPlan: { visuals: { needsMap: true, needsTimeline: true } }
  }, policy);
  check(prePass.status === PASS, 'verified truth + safe production directive must PASS pre-production council');
  check(prePass.members.length === 6, 'pre-production council must have six independent reviewers');

  const unverified = buildPreProductionReview({
    claimVerification: truthPacket({ status: 'NEEDS_RESEARCH' }), productionDirective: readyDirective, editorialPlan: { visuals: {} }
  }, policy);
  check(unverified.status === BLOCK, 'non-VERIFIED truth must BLOCK pre-production council');

  const tamperedPacket = truthPacket({ claims: [{ id: 'claim_bad', claimText: 'Unverified allegation', classification: 'reported', supportingSources: [{ url: 'https://news.example/a' }] }] });
  const tampered = buildPreProductionReview({ claimVerification: tamperedPacket, productionDirective: directive(tamperedPacket), editorialPlan: { visuals: {} } }, policy);
  check(tampered.status === BLOCK, 'reported/unverified claim cannot pass fact-lock council');

  const missingAttributionDirective = directive(packet, { factLocks: packet.claims.map(claim => ({ claimId: claim.id, classification: 'confirmed', text: claim.claimText, mustAttribute: true, supportingSources: [] })) });
  const attribution = buildPreProductionReview({ claimVerification: packet, productionDirective: missingAttributionDirective, editorialPlan: { visuals: {} } }, policy);
  check(attribution.status === REPAIR, 'missing mandatory attribution must require REPAIR');

  const unsafeVisualDirective = directive(packet, { visuals: { generatedVisualsCannotDepictUnverifiedFacts: false }, forbidden: ['invent_facts'] });
  const unsafeVisual = buildPreProductionReview({ claimVerification: packet, productionDirective: unsafeVisualDirective, editorialPlan: { visuals: {} } }, policy);
  check(unsafeVisual.status === BLOCK, 'lost visual truth safeguards must BLOCK');

  const postPass = buildPostProductionReview({ production: production(), builtInQuality: quality(), editorData: { rightsConfirmed: true } }, policy);
  check(postPass.status === PASS, 'production with real assets, provenance and passing built-in quality must PASS');
  check(postPass.members.length === 6, 'post-production council must have six independent reviewers');

  const simulated = buildPostProductionReview({ production: production({ assets: { finalVideo: { path: 'C:/tmp/final.mp4', simulated: true }, thumbnail: { path: 'C:/tmp/thumb.png' } } }), builtInQuality: quality(), editorData: { rightsConfirmed: true } }, policy);
  check(simulated.status === BLOCK, 'simulated final video must BLOCK');

  const noThumbnail = buildPostProductionReview({ production: production({ assets: { finalVideo: { path: 'C:/tmp/final.mp4', simulated: false }, thumbnail: {} } }), builtInQuality: quality(), editorData: { rightsConfirmed: true } }, policy);
  check(noThumbnail.status === REPAIR, 'missing thumbnail must require REPAIR');

  const provenanceBlocked = buildPostProductionReview({ production: production({ provenance: { status: 'blocked', summary: { unresolvedClaims: 2 } } }), builtInQuality: quality(), editorData: { rightsConfirmed: true } }, policy);
  check(provenanceBlocked.status === BLOCK, 'blocked provenance must BLOCK council');

  const rightsBlocked = buildPostProductionReview({ production: production({ scenes: [{ id: 'scene_upload', assetOrigin: 'uploaded', rightsConfirmed: false }] }), builtInQuality: quality({ checks: [{ id: 'scene_rights', passed: false, blocking: true, message: 'Uploaded scene lacks rights' }] }), editorData: {} }, policy);
  check(rightsBlocked.status === BLOCK, 'uploaded media without rights confirmation must BLOCK');

  const builtInFailure = buildPostProductionReview({ production: production(), builtInQuality: quality({ passed: false, score: 75, blockingFailures: ['video'] }), editorData: { rightsConfirmed: true } }, policy);
  check(builtInFailure.status === BLOCK, 'built-in blocking quality failure must BLOCK council');

  const tempDb = path.join(os.tmpdir(), `agenttube-quality-council-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const council = new AutonomousQualityCouncilV129(db);
  const first = await council.reviewPreProduction({ decision: { id: 'decision_fixture' }, claimVerification: packet, productionDirective: readyDirective, editorialPlan: { visuals: { needsMap: true, needsTimeline: true } } });
  const second = await council.reviewPreProduction({ decision: { id: 'decision_fixture' }, claimVerification: packet, productionDirective: readyDirective, editorialPlan: { visuals: { needsMap: true, needsTimeline: true } } });
  check(first.id === second.id, 'same council snapshot must be idempotent');
  const stored = await council.listReviews(10);
  check(stored.length === 1 && stored[0].status === PASS, 'idempotent council review must persist once');
  await council.linkPromotion(first.id, { assignmentId: 'assignment_fixture' });
  check((await council.getReview(first.id)).assignmentId === 'assignment_fixture', 'council review must retain assignment linkage');

  let reasonRequired = false;
  try { await council.setPolicy({ preProductionMinScore: 90 }, 'ci-fixture', ''); } catch (error) { reasonRequired = error.code === 'quality_council_policy_reason_required'; }
  check(reasonRequired, 'policy mutation without reason must fail');
  const policyState = await council.setPolicy({ preProductionMinScore: 90 }, 'ci-fixture', 'Validate append-only Quality Council policy');
  check(policyState.revisionNumber === 1 && policyState.policy.preProductionMinScore === 90, 'persisted Quality Council policy revision mismatch');
  const status = await council.status();
  check(status.version === '12.9' && status.total === 1 && status.pass === 1, 'Quality Council status summary mismatch');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.9 Autonomous Quality Council verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
