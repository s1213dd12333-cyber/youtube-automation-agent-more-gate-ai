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

function fixture(id, options = {}) {
  return {
    cluster: {
      id: `cluster_${id}`,
      canonicalTitle: options.title || `Observed international event ${id}`,
      materialFingerprint: `material_${id}`,
      topicTokens: options.topicTokens || [],
      scores: {
        globalScore: options.globalScore ?? 78,
        confidenceScore: options.confidenceScore ?? 86,
        velocityScore: options.velocityScore ?? 72,
        freshnessScore: options.freshnessScore ?? 92,
        geographyScore: options.geographyScore ?? 76,
        sourceCount: options.sourceCount ?? 8,
        regionCount: options.regionCount ?? 4,
        independentEvidenceUnits: options.independentEvidenceUnits ?? 5
      },
      materialChange: { changed: options.changed ?? true, kind: options.changeKind || 'new_event' }
    },
    event: {
      id: `event_${id}`,
      revisionNumber: options.revisionNumber ?? 1,
      concepts: options.concepts || ['market'],
      locations: options.locations || ['Brazil'],
      changeClassification: { kind: options.changeKind || 'new_event', changed: options.changed ?? true }
    },
    importance: {
      id: `importance_${id}`,
      importanceScore: options.importanceScore ?? 70,
      confidenceScore: options.importanceConfidence ?? 86,
      impactTier: options.impactTier || 'international'
    }
  };
}

function brain(action = 'COVER', options = {}) {
  return { id: `brain_${action.toLowerCase()}`, action, legacyAction: action, selected: options.selected ?? true, urgency: options.urgency || 'standard', signals: { sensitive: options.sensitive ?? false }, fingerprint: `brain_fp_${action}` };
}

async function main() {
  const servicePath = path.join(upstream, 'utils', 'editorial-planning-ai-v125.js');
  const radarPath = path.join(upstream, 'utils', 'global-news-radar-v121.js');
  const dbPath = path.join(upstream, 'database', 'db.js');
  const indexPath = path.join(upstream, 'index.js');
  const dashboardPath = path.join(upstream, 'dashboard', 'newsroom-planning-v125.js');
  for (const file of [servicePath, radarPath, dbPath, indexPath, dashboardPath]) {
    check(fs.existsSync(file), `missing materialized Phase 12.5 file: ${file}`);
    if (file.endsWith('.js')) childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }

  const serviceSource = read('utils/editorial-planning-ai-v125.js');
  const radarSource = read('utils/global-news-radar-v121.js');
  const dbSource = read('database/db.js');
  const indexSource = read('index.js');
  const htmlSource = read('dashboard/index.html');
  const dashboardSource = read('dashboard/newsroom-planning-v125.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  for (const needle of [
    "const VERSION = '12.5'",
    "breaking_brief",
    "deep_dive",
    'minimumIndependentSources',
    'primarySourceRequired',
    'preserveUncertaintyLabels: true',
    'generatedVisualsMustNotImplyUnverifiedFacts: true',
    'BEGIN IMMEDIATE',
    'plan_fingerprint'
  ]) check(serviceSource.includes(needle), `planner runtime missing contract: ${needle}`);

  for (const table of ['newsroom_editorial_plan_policy_revisions','newsroom_editorial_plans']) check(dbSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `database missing ${table}`);
  check(dbSource.includes('plan_fingerprint TEXT NOT NULL UNIQUE'), 'editorial plans must be immutable/idempotent by fingerprint');
  check(dbSource.includes("CHECK(action IN ('COVER','BREAKING','UPDATE','FOLLOW_UP'))"), 'only actionable decisions may receive plans');
  check(dbSource.includes("CHECK(format IN ('breaking_brief','update_brief','follow_up_explainer','rapid_explainer','standard_explainer','deep_dive'))"), 'planner format enum must be constrained');

  for (const needle of [
    "require('./editorial-planning-ai-v125')",
    'this.editorialPlanner',
    'await this.editorialPlanner.createPlan',
    'await this.promoteDecision(decision.id, editorialPlan)',
    'await this.editorialPlanner.linkPromotion(editorialPlan.id, promotion)',
    'editorialPlan: cluster.editorialPlan || null'
  ]) check(radarSource.includes(needle), `Global News Radar missing planning integration: ${needle}`);
  check(radarSource.includes("const angle = clean(editorialPlan?.angle || this.assignmentAngle(decision.action)"), 'backlog promotion must consume planned angle');
  check(radarSource.includes("const assignmentFormat = clean(editorialPlan?.format || 'explainer'"), 'newsroom assignment must persist planned format');
  check(radarSource.includes('factual claims still require the Research & Provenance Desk before publication'), 'planner must not bypass Research & Provenance');

  for (const route of [
    "'/api/newsroom/planning/status', protect",
    "'/api/newsroom/planning/plans', protect",
    "'/api/newsroom/planning/plans/:planId', protect",
    "'/api/newsroom/planning/policy', protect"
  ]) check(indexSource.includes(route), `protected Editorial Planning API missing ${route}`);
  check(indexSource.includes("this.app.post('/api/newsroom/planning/policy', protect"), 'audited planning policy update endpoint missing');
  check(indexSource.includes('editorial_planning_policy_reason_required'), 'planning policy changes must require an audit reason');

  check(htmlSource.includes('EDITORIAL PLANNING AI 12.5'), 'dashboard missing 12.5 planning panel');
  check(htmlSource.includes('/newsroom-planning-v125.js'), 'dashboard missing 12.5 client');
  check(dashboardSource.includes("api('/api/newsroom/planning/status')"), 'planning dashboard must read live planning status');

  for (const key of [
    'NEWSROOM_EDITORIAL_PLANNING_ENABLED=true',
    'NEWSROOM_PLANNING_DEEP_DIVE_IMPORTANCE=78',
    'NEWSROOM_PLANNING_RAPID_VELOCITY=80',
    'NEWSROOM_PLANNING_ORDINARY_MIN_SOURCES=3',
    'NEWSROOM_PLANNING_SENSITIVE_MIN_SOURCES=5',
    'NEWSROOM_PLANNING_BREAKING_MINUTES=4',
    'NEWSROOM_PLANNING_STANDARD_MINUTES=8',
    'NEWSROOM_PLANNING_DEEP_DIVE_MINUTES=12'
  ]) check(envSource.includes(key), `env missing ${key}`);
  check(pkg.scripts?.['test:editorial-planning'] === 'node ../bootstrap/verify-phase12-editorial-planning-ai.js', 'package missing Phase 12.5 test command');

  const {
    VERSION, defaultPolicy, normalizePolicy, chooseFormat, durationFor,
    researchRequirements, visualRequirements, buildPlan, EditorialPlanningAIV125
  } = require(servicePath);
  check(VERSION === '12.5', 'planner runtime version mismatch');
  const policy = normalizePolicy(defaultPolicy());
  check(policy.breakingMinutes === 4 && policy.standardMinutes === 8 && policy.deepDiveMinutes === 12, 'default duration policy mismatch');

  const breakingCandidate = fixture('breaking', { concepts: ['earthquake','emergency'], locations: ['Japan','South Korea'], velocityScore: 96, importanceScore: 92, impactTier: 'systemic' });
  const breakingPlan = buildPlan(breakingCandidate, brain('BREAKING', { urgency: 'critical' }), { action: 'BREAKING', id: 'decision_breaking' }, { policy });
  check(breakingPlan.format === 'breaking_brief', 'BREAKING must create breaking_brief');
  check(breakingPlan.targetLengthMinutes === 4, 'breaking brief must default to four minutes');
  check(breakingPlan.urgency === 'critical', 'breaking plan must be critical urgency');
  check(breakingPlan.visuals.needsMap === true, 'multi-location breaking story should require a map');
  check(breakingPlan.visuals.needsTimeline === true, 'breaking story should require a timeline');
  check(breakingPlan.research.minimumIndependentSources >= 5, 'systemic breaking story must require stronger research breadth');
  check(breakingPlan.research.primarySourceRequired === true, 'systemic breaking story should require primary/official evidence when available');

  const deepCandidate = fixture('deep', { importanceScore: 86, impactTier: 'global', confidenceScore: 88, velocityScore: 62, concepts: ['market','rate'], locations: ['United States','Europe'] });
  const deepPlan = buildPlan(deepCandidate, brain('COVER'), { action: 'COVER', id: 'decision_deep' }, { policy });
  check(deepPlan.format === 'deep_dive', 'high structural importance COVER should become deep_dive');
  check(deepPlan.targetLengthMinutes === 12, 'deep dive must use deep-dive duration policy');
  check(deepPlan.visuals.needsDataChart === true, 'market/rate deep dive should request a data chart');
  check(deepPlan.research.minimumIndependentSources >= 5, 'global deep dive should request at least five independent sources');

  const rapidCandidate = fixture('rapid', { importanceScore: 55, impactTier: 'regional', velocityScore: 90, confidenceScore: 84, concepts: ['model'], locations: ['United States'] });
  check(chooseFormat(rapidCandidate, brain('COVER'), { action: 'COVER' }, policy) === 'rapid_explainer', 'fast-rising lower-importance COVER should become rapid explainer');
  check(durationFor('rapid_explainer', policy) <= policy.standardMinutes * 60, 'rapid explainer must not be longer than standard explainer');

  const updateCandidate = fixture('update', { changeKind: 'correction', concepts: ['correction'], locations: ['France'] });
  const updatePlan = buildPlan(updateCandidate, brain('UPDATE'), { action: 'UPDATE', id: 'decision_update' }, { policy });
  check(updatePlan.format === 'update_brief', 'UPDATE must become update_brief');
  check(updatePlan.topic.includes('What Changed'), 'UPDATE topic must clearly identify changed coverage');
  check(updatePlan.research.preserveUncertaintyLabels === true, 'update research must preserve uncertainty labels');

  const sensitiveCandidate = fixture('sensitive', { concepts: ['election'], locations: ['Brazil'], importanceScore: 65, impactTier: 'international' });
  const sensitiveResearch = researchRequirements(sensitiveCandidate, brain('COVER', { sensitive: true }), 'standard_explainer', policy);
  check(sensitiveResearch.minimumIndependentSources >= policy.sensitiveMinResearchSources, 'sensitive coverage must use stricter research source floor');
  check(sensitiveResearch.primarySourceRequired === true, 'sensitive coverage should require primary/official evidence when available');

  const actorA = fixture('actor_a', { title: 'Candidate A election development', concepts: ['election'], locations: ['Brazil'], importanceScore: 65 });
  const actorB = fixture('actor_b', { title: 'Candidate B election development', concepts: ['election'], locations: ['Brazil'], importanceScore: 65 });
  const planA = buildPlan(actorA, brain('COVER', { sensitive: true }), { action: 'COVER' }, { policy });
  const planB = buildPlan(actorB, brain('COVER', { sensitive: true }), { action: 'COVER' }, { policy });
  check(planA.format === planB.format && planA.targetDurationSeconds === planB.targetDurationSeconds, 'political actor name alone must not change format or duration');
  check(JSON.stringify(planA.research) === JSON.stringify(planB.research), 'identical evidence signals must produce identical research requirements regardless of political actor');
  check(planA.angle === planB.angle, 'identical action/evidence must use the same neutral angle regardless of political actor');

  const notSelected = buildPlan(fixture('deferred'), { ...brain('COVER'), selected: false }, { action: 'COVER' }, { policy });
  check(notSelected === null, 'unselected candidate must not consume planning resources or receive a production plan');
  check(visualRequirements(updateCandidate, 'update_brief', policy).needsTimeline === true, 'correction/update should require timeline visuals');

  const tempDb = path.join(os.tmpdir(), `agenttube-editorial-planning-${process.pid}-${Date.now()}.db`);
  const { Database } = require(dbPath);
  const db = new Database();
  db.dbPath = tempDb;
  await db.initialize();
  const planner = new EditorialPlanningAIV125(db);
  const policyState = await planner.setPolicy({ deepDiveImportanceThreshold: 78 }, 'ci-fixture', 'Validate append-only editorial planning policy');
  check(policyState.revisionNumber === 1, 'first planning policy revision must be 1');
  const loadedPolicy = await planner.getPolicy();
  check(loadedPolicy.revisionNumber === 1 && loadedPolicy.source === 'persisted', 'persisted planning policy must load exactly');

  const candidate = fixture('persisted', { importanceScore: 84, impactTier: 'global', concepts: ['earthquake','emergency'], locations: ['Japan','South Korea'] });
  const brainDecision = { ...brain('COVER'), id: 'brain_persisted', fingerprint: 'brain_persisted_fp' };
  const decision = { id: 'decision_persisted', action: 'COVER' };
  const first = await planner.createPlan(candidate, brainDecision, decision, { scanId: 'scan_planning_fixture' });
  const second = await planner.createPlan(candidate, brainDecision, decision, { scanId: 'scan_planning_fixture' });
  check(first.id === second.id, 'same planning snapshot must produce deterministic plan id');
  const stored = await planner.listPlans(10);
  check(stored.length === 1, 'idempotent editorial plan must persist once');
  check(stored[0].format === first.format && stored[0].targetDurationSeconds === first.targetDurationSeconds, 'persisted editorial plan must round-trip');
  await planner.linkPromotion(first.id, { idea: { id: 'idea_fixture' }, assignmentId: 'assignment_fixture' });
  const linked = await planner.getPlan(first.id);
  check(linked.promotedIdeaId === 'idea_fixture' && linked.assignmentId === 'assignment_fixture', 'plan must retain exact backlog promotion linkage');

  await db.close();
  try { fs.unlinkSync(tempDb); } catch (_error) {}

  console.log(`Phase 12.5 Editorial Planning AI verified: ${checks} checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
