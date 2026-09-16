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

async function main() {
  const servicePath = path.join(upstream, 'utils', 'autonomous-production-director-v128.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-production-director-v128.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.8 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/autonomous-production-director-v128.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const dashboardSource = read('dashboard/newsroom-production-director-v128.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.8'",
    "const PLAN_READY = 'PLAN_READY'",
    "const PLAN_BLOCKED = 'PLAN_BLOCKED'",
    'selectProductionMode',
    'selectVisualStrategy',
    'selectProviderTier',
    'buildFactLocks',
    'buildDirective',
    'class AutonomousProductionDirectorV128',
    'generatedVisualsCannotDepictUnverifiedFacts',
    'upgrade_reported_to_confirmed'
  ]) check(serviceSource.includes(needle), `production director runtime missing contract: ${needle}`);

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS newsroom_production_directives'), 'database missing production directives');
  check(dbSource.includes("CHECK(status IN ('PLAN_READY','PLAN_BLOCKED'))"), 'production directive status enum must be constrained');
  check(dbSource.includes("CHECK(mode IN ('speed_first','balanced','depth_first'))"), 'production mode enum must be constrained');
  check(dbSource.includes('directive_fingerprint TEXT NOT NULL UNIQUE'), 'production directives must be idempotent');

  for (const needle of [
    "require('./autonomous-production-director-v128')",
    'AutonomousProductionDirectorV128',
    'this.productionDirector',
    'await this.productionDirector.createDirective',
    "claimVerification?.status === 'VERIFIED'",
    "productionDirective?.status === 'PLAN_READY'",
    'productionDirective: cluster.productionDirective || null',
    'promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification, productionDirective)'
  ]) check(radarSource.includes(needle), `Global News Radar missing Phase 12.8 integration: ${needle}`);
  check(radarSource.includes('promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification)'), '12.8 must preserve Phase 12.7 fallback contract');
  check(radarSource.includes('factual claims still require the Research & Provenance Desk before publication'), '12.8 must preserve downstream factual gates');

  for (const route of [
    "'/api/newsroom/production-director/status', protect",
    "'/api/newsroom/production-director/directives', protect",
    "'/api/newsroom/production-director/directives/:directiveId', protect"
  ]) check(indexSource.includes(route), `protected production director API missing ${route}`);
  check(htmlSource.includes('AUTONOMOUS PRODUCTION 12.8'), 'dashboard missing production director panel');
  check(htmlSource.includes('/newsroom-production-director-v128.js'), 'dashboard missing production director client');
  check(dashboardSource.includes("/api/newsroom/production-director/directives?limit=20"), 'production director dashboard must use live API');

  for (const key of [
    'NEWSROOM_PRODUCTION_DIRECTOR_ENABLED=true',
    'NEWSROOM_PRODUCTION_LOCAL_FIRST=true',
    'NEWSROOM_PRODUCTION_PREMIUM_BREAKING=true',
    'NEWSROOM_PRODUCTION_PREMIUM_IMPORTANCE=82',
    'NEWSROOM_PRODUCTION_PREMIUM_BREAKING_IMPORTANCE=72',
    'NEWSROOM_PRODUCTION_MAX_PREMIUM_USD=8'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:autonomous-production-director'] === 'node ../bootstrap/verify-phase12-autonomous-production-director.js', 'package missing Phase 12.8 test command');

  const {
    VERSION, PLAN_READY, PLAN_BLOCKED, defaultPolicy, normalizePolicy,
    selectProductionMode, selectVisualStrategy, selectProviderTier,
    buildScenePlan, buildFactLocks, buildDirective, AutonomousProductionDirectorV128
  } = require(servicePath);
  check(VERSION === '12.8', 'production director version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.localFirst === true && policy.maxPremiumBudgetUsd === 8, 'default production policy mismatch');

  const verifiedTruth = {
    id: 'truth_verified', status: 'VERIFIED', fingerprint: 'truth_fp',
    claims: [
      { id: 'claim_1', classification: 'confirmed', claimText: 'Official agencies confirmed the evacuation order.', supportingSources: [{ url: 'https://agency.gov/update' }] },
      { id: 'claim_2', classification: 'confirmed', claimText: 'Two independent monitors confirmed the timeline.', supportingSources: [{ url: 'https://one.example/a' }, { url: 'https://two.example/b' }] }
    ]
  };
  const basePlan = { id: 'plan_base', format: 'standard_explainer', targetDurationSeconds: 480, visuals: { needsMap: true, needsTimeline: true } };
  const normal = buildDirective({ editorialPlan: basePlan, claimVerification: verifiedTruth, brainDecision: { urgency: 'standard' }, importance: { importanceScore: 68 } }, policy);
  check(normal.status === PLAN_READY, 'verified packet should yield PLAN_READY');
  check(normal.mode === 'balanced', 'ordinary report should use balanced mode');
  check(normal.visualStrategy === 'evidence_first_hybrid', 'map/timeline report should be evidence-first hybrid');
  check(normal.providerTier === 'local_first', 'ordinary report should remain local-first');
  check(normal.factLocks.length === 2, 'all verified claims must become fact locks');
  check(normal.forbidden.includes('upgrade_reported_to_confirmed'), 'director must prohibit truth-state upgrades');
  check(normal.visuals.generatedVisualsCannotDepictUnverifiedFacts === true, 'generated visuals must preserve truth discipline');

  const breaking = buildDirective({ editorialPlan: { ...basePlan, format: 'breaking_brief', targetDurationSeconds: 240 }, claimVerification: verifiedTruth, brainDecision: { urgency: 'critical' }, importance: { importanceScore: 90 } }, policy);
  check(breaking.mode === 'speed_first', 'breaking report must use speed_first');
  check(breaking.providerTier === 'premium_allowed', 'high-importance breaking report may authorize premium tier');
  check(breaking.maxBudgetUsd <= policy.maxPremiumBudgetUsd, 'breaking budget may not exceed cap');
  check(breaking.sceneSeconds < normal.sceneSeconds, 'speed_first must use shorter scene cadence');

  const deep = buildDirective({ editorialPlan: { ...basePlan, format: 'deep_dive', targetDurationSeconds: 720, visuals: { needsDataChart: true } }, claimVerification: verifiedTruth, importance: { importanceScore: 88 } }, policy);
  check(deep.mode === 'depth_first', 'deep dive must use depth_first');
  check(deep.providerTier === 'premium_allowed', 'high-importance deep dive may authorize premium tier');
  check(deep.sceneCount >= 4, 'deep dive must have bounded scene plan');

  const blocked = buildDirective({ editorialPlan: basePlan, claimVerification: { status: 'NEEDS_RESEARCH' }, importance: { importanceScore: 95 } }, policy);
  check(blocked.status === PLAN_BLOCKED && blocked.reason === 'verified_truth_packet_required', 'non-VERIFIED truth packet must fail closed');

  const modeA = selectProductionMode(basePlan, { urgency: 'standard', actor: 'A' }, { importanceScore: 68 });
  const modeB = selectProductionMode(basePlan, { urgency: 'standard', actor: 'B' }, { importanceScore: 68 });
  check(modeA === modeB, 'public actor identity must not change production mode');
  check(selectVisualStrategy({ visuals: {} }, 'speed_first') === 'source_first', 'speed mode without structured visuals should prefer source-first');
  check(selectProviderTier('balanced', { importanceScore: 99 }, policy) === 'local_first', 'ordinary balanced mode remains local-first even at high importance');
  check(buildScenePlan(basePlan, 'balanced', policy).sceneCount <= policy.maxScenes, 'scene count must remain bounded');
  check(buildFactLocks(verifiedTruth, policy).every(lock => lock.mayParaphrase === false), 'fact locks must preserve verified wording under default policy');

  const tempDb = path.join(os.tmpdir(), `agenttube-production-director-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database(); db.dbPath = tempDb; await db.initialize();
  const director = new AutonomousProductionDirectorV128(db);
  const input = { editorialPlan: basePlan, claimVerification: verifiedTruth, decision: { id: 'decision_fixture' }, candidate: { cluster: { id: 'cluster_fixture' }, importance: { importanceScore: 68 } }, importance: { importanceScore: 68 } };
  const first = await director.createDirective(input);
  const second = await director.createDirective(input);
  check(first.id === second.id, 'same evidence/plan snapshot must reuse deterministic directive');
  check((await director.listDirectives(20)).length === 1, 'idempotent directive must persist once');
  check((await director.getDirective(first.id)).factLocks.length === 2, 'persisted fact locks must round-trip');
  await director.linkPromotion(first.id, { assignmentId: 'assignment_fixture' });
  check((await director.getDirective(first.id)).assignmentId === 'assignment_fixture', 'directive must retain assignment linkage');
  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.8 Autonomous Production Director verified: ${checks} checks passed.`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
