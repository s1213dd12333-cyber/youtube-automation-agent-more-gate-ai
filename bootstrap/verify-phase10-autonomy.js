'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const servicePath = path.join(upstream, 'utils', 'autonomy-observability-v10.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 10 service is not materialized: utils/autonomy-observability-v10.js');

const {
  AUTONOMY_OBSERVABILITY_VERSION,
  AutonomyObservabilityV10,
  normalizeTopic,
  topicSimilarity,
  publicationBlockers,
  repairDecision
} = require(servicePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

function fakeBundle(overrides = {}) {
  return {
    id: 'prod_job_test',
    review_status: 'approved',
    qualityAgentReport: { status: 'passed', blockingFindings: [] },
    provenance: { status: 'verified' },
    assets: { finalVideo: { path: 'video.mp4', simulated: false }, audio: { path: 'audio.mp3', simulated: false } },
    scenes: [{ id: 's1', assetOrigin: 'licensed-source', rightsConfirmed: true, narrationStatus: 'current' }],
    schedule: { status: 'scheduled' },
    ...overrides
  };
}

check('Phase 10 contract version is 10', () => assert.strictEqual(AUTONOMY_OBSERVABILITY_VERSION, 10));
check('topic normalization removes filler punctuation and case', () => {
  assert.strictEqual(normalizeTopic('The Signal FROM Space: Why It Matters?'), 'signal space it matters');
});
check('near-identical topics receive high similarity', () => {
  const score = topicSimilarity('Why atomic clocks reveal gravitational time dilation', 'Atomic clocks and gravitational time dilation explained');
  assert(score >= 0.70, `similarity=${score}`);
});
check('unrelated topics remain below duplicate threshold', () => {
  const score = topicSimilarity('How atomic clocks reveal gravitational time dilation', 'Hidden history of ancient Roman roads');
  assert(score < 0.40, `similarity=${score}`);
});
check('publication blockers pass a fully approved bundle', () => {
  assert.deepStrictEqual(publicationBlockers(fakeBundle(), true), []);
});
check('human approval is a hard publication blocker', () => {
  const blockers = publicationBlockers(fakeBundle({ review_status: 'needs_review' }), true);
  assert(blockers.includes('human_approval'));
});
check('quality agent failure is a hard publication blocker', () => {
  const blockers = publicationBlockers(fakeBundle({ qualityAgentReport: { status: 'blocked' } }), true);
  assert(blockers.includes('quality_agents'));
});
check('unresolved provenance is a hard publication blocker', () => {
  const blockers = publicationBlockers(fakeBundle({ provenance: { status: 'pending' } }), true);
  assert(blockers.includes('provenance'));
});
check('unresolved source rights block publication', () => {
  const item = fakeBundle(); item.scenes[0].rightsConfirmed = false;
  assert(publicationBlockers(item, true).includes('media_rights'));
});
check('SEO blockers map to safe automatic SEO retry', () => {
  const result = repairDecision({ blockingFindings: [{ id: 'seo_false_freshness', agentId: 'seo' }] }, { enabled: true, attempts: 0, maxAttempts: 1 });
  assert.deepStrictEqual({ automatic: result.automatic, stage: result.stage }, { automatic: true, stage: 'seo' });
});
check('retention blockers map to safe script retry', () => {
  const result = repairDecision({ blockingFindings: [{ id: 'retention_missing_hook', agentId: 'retention' }] }, { enabled: true, attempts: 0, maxAttempts: 1 });
  assert.strictEqual(result.stage, 'script');
  assert.strictEqual(result.automatic, true);
});
check('thumbnail repair stays manual because media can cost credits', () => {
  const result = repairDecision({ blockingFindings: [{ id: 'thumbnail_missing_asset', agentId: 'thumbnail' }] }, { enabled: true, attempts: 0, maxAttempts: 1 });
  assert.strictEqual(result.automatic, false);
  assert.strictEqual(result.reason, 'media_cost_confirmation_required');
});
check('automatic repair attempt limit is enforced', () => {
  const result = repairDecision({ blockingFindings: [{ id: 'seo_false_freshness', agentId: 'seo' }] }, { enabled: true, attempts: 1, maxAttempts: 1 });
  assert.strictEqual(result.automatic, false);
  assert.strictEqual(result.reason, 'attempt_limit');
});
check('topic novelty detects recent near-duplicate rows', async () => {
  const db = { async getAllRows() { return [{ topic: 'Atomic clocks and gravitational time dilation', source: 'strategy', created_at: '2026-01-01' }]; } };
  const service = new AutonomyObservabilityV10(db, { topicThreshold: 0.65 });
  const result = await service.topicNovelty('Why atomic clocks reveal gravitational time dilation');
  assert.strictEqual(result.duplicate, true);
  assert(result.match);
});
check('assertTopicNovel fails closed for automated near-duplicates', async () => {
  const db = { async getAllRows() { return [{ topic: 'Atomic clocks and gravitational time dilation', source: 'job', created_at: '2026-01-01' }]; } };
  const service = new AutonomyObservabilityV10(db, { topicThreshold: 0.65 });
  let code = null;
  try { await service.assertTopicNovel('Why atomic clocks reveal gravitational time dilation'); } catch (error) { code = error.code; }
  assert.strictEqual(code, 'SEMANTIC_TOPIC_DUPLICATE');
});
check('withSpan persists successful stage timing', async () => {
  const calls = [];
  const db = {
    async startAutonomyTraceSpan(span) { calls.push(['start', span]); },
    async finishAutonomyTraceSpan(id, changes) { calls.push(['finish', id, changes]); }
  };
  const service = new AutonomyObservabilityV10(db);
  const value = await service.withSpan({ jobId: 'j1', stage: 'script' }, async () => 42);
  assert.strictEqual(value, 42);
  assert.strictEqual(calls[0][0], 'start');
  assert.strictEqual(calls[1][2].status, 'succeeded');
});
check('withSpan persists failed stage timing', async () => {
  const calls = [];
  const db = {
    async startAutonomyTraceSpan(span) { calls.push(['start', span]); },
    async finishAutonomyTraceSpan(id, changes) { calls.push(['finish', id, changes]); }
  };
  const service = new AutonomyObservabilityV10(db);
  await assert.rejects(() => service.withSpan({ jobId: 'j1', stage: 'seo' }, async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(calls[1][2].status, 'failed');
  assert.strictEqual(calls[1][2].error, 'boom');
});
check('publicationState exposes approval-safe scheduling state', async () => {
  const db = {
    async getProductionBundle() { return fakeBundle({ review_status: 'needs_review' }); },
    async getSetting() { return 'true'; }
  };
  const service = new AutonomyObservabilityV10(db);
  const state = await service.publicationState('prod_job_test');
  assert.strictEqual(state.canSchedule, false);
  assert(state.blockers.includes('human_approval'));
});
check('doctor makes no network calls and reports core DB state', async () => {
  const db = {
    async getRow(sql) { if (sql.includes('SELECT 1')) return { ok: 1 }; return null; },
    async getAllRows() { return []; },
    async getLatestReadinessRun() { return { status: 'passed', summary: { passed: 6 } }; },
    async getAIUsageSummary() { return { totals: { requests: 3, errors: 0 } }; }
  };
  const service = new AutonomyObservabilityV10(db);
  const report = await service.doctor();
  assert.strictEqual(report.networkCallsMade, false);
  assert.strictEqual(report.status, 'passed');
});
check('SQLite Phase 10 trace tables and methods are installed', () => {
  const source = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
  assert(source.includes('CREATE TABLE IF NOT EXISTS autonomy_trace_spans'));
  assert(source.includes('CREATE TABLE IF NOT EXISTS autonomy_events'));
  assert(source.includes('async startAutonomyTraceSpan'));
  assert(source.includes('async listAutonomyTraceSpans'));
});
check('generation stages are wrapped in Phase 10 tracing', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes("new AutonomyObservabilityV10(this.db"));
  assert(source.includes('this.observability.withSpan({ jobId, stage, operation: stage }'));
  assert(source.includes("'/api/content/:productionId/observability'"));
  assert(source.includes("'/api/doctor'"));
});
check('automated topic generation has near-duplicate guard', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes('await this.observability.assertTopicNovel(validation.value.topic'));
  assert(source.includes("['scheduler', 'autonomous_operator'].includes(input.source)"));
});
check('completed jobs reopen only for explicit Phase 10 quality repair', () => {
  const source = fs.readFileSync(path.join(upstream, 'index.js'), 'utf8');
  assert(source.includes("const qualityRepair = job.status === 'completed' && options.qualityRepair === true && Boolean(options.stage);"));
  assert(source.includes("!['failed', 'interrupted'].includes(job.status) && !qualityRepair"));
});
check('autonomous operator supports text repair and post-approval reconciliation', () => {
  const source = fs.readFileSync(path.join(upstream, 'utils', 'autonomous-channel-operator.js'), 'utf8');
  assert(source.includes('planAutomaticRepair(record.productionId'));
  assert(source.includes('this.resumeGenerationJob(job.id, { stage: repair.stage, qualityRepair: true })'));
  assert(source.includes('async reconcile(runId)'));
  assert(source.includes('async reconcileByProduction(productionId)'));
});
check('publishing is fail-closed on approval and Quality Agents', () => {
  const source = fs.readFileSync(path.join(upstream, 'agents', 'publishing-scheduling-agent.js'), 'utf8');
  assert(source.includes("error.code = 'PUBLISH_APPROVAL_REQUIRED'"));
  assert(source.includes("error.code = 'QUALITY_BLOCKED'"));
});
check('Phase 10 CLI commands are materialized', () => {
  assert(fs.existsSync(path.join(upstream, 'scripts', 'doctor-v10.js')));
  assert(fs.existsSync(path.join(upstream, 'scripts', 'e2e-safe-v10.js')));
  const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts.doctor, 'node scripts/doctor-v10.js');
  assert.strictEqual(pkg.scripts['e2e:safe'], 'node scripts/e2e-safe-v10.js');
  assert.strictEqual(pkg.scripts['test:autonomy'], 'node ../bootstrap/verify-phase10-autonomy.js');
});

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 10 autonomy/observability OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
