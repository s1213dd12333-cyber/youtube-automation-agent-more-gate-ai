'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  const copies = [
    ['bootstrap/templates/autonomy-observability-v10.js', 'utils/autonomy-observability-v10.js'],
    ['bootstrap/templates/doctor-v10.js', 'scripts/doctor-v10.js'],
    ['bootstrap/templates/e2e-safe-v10.js', 'scripts/e2e-safe-v10.js']
  ];
  fs.mkdirSync(file('scripts'), { recursive: true });
  for (const [source, target] of copies) {
    const full = path.join(root, source);
    if (!fs.existsSync(full)) throw new Error(`Missing ${source}`);
    write(target, fs.readFileSync(full, 'utf8'));
  }
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 10 autonomy traces and state-transition audit",
    "      `CREATE TABLE IF NOT EXISTS autonomy_trace_spans (",
    "        id TEXT PRIMARY KEY,",
    "        trace_id TEXT NOT NULL,",
    "        parent_span_id TEXT,",
    "        operator_run_id TEXT,",
    "        job_id TEXT,",
    "        production_id TEXT,",
    "        stage TEXT NOT NULL,",
    "        operation TEXT NOT NULL,",
    "        status TEXT NOT NULL DEFAULT 'running',",
    "        duration_ms INTEGER NOT NULL DEFAULT 0,",
    "        metadata TEXT NOT NULL DEFAULT '{}',",
    "        error TEXT,",
    "        started_at TEXT NOT NULL,",
    "        completed_at TEXT",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_autonomy_spans_trace ON autonomy_trace_spans(trace_id, started_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_autonomy_spans_job ON autonomy_trace_spans(job_id, started_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_autonomy_spans_production ON autonomy_trace_spans(production_id, started_at)`,",
    "      `CREATE TABLE IF NOT EXISTS autonomy_events (",
    "        id TEXT PRIMARY KEY,",
    "        operator_run_id TEXT,",
    "        job_id TEXT,",
    "        production_id TEXT,",
    "        event_type TEXT NOT NULL,",
    "        stage TEXT,",
    "        status TEXT,",
    "        data TEXT NOT NULL DEFAULT '{}',",
    "        created_at TEXT NOT NULL",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_autonomy_events_run ON autonomy_events(operator_run_id, created_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_autonomy_events_production ON autonomy_events(production_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'Phase 10 autonomy trace tables');

  const methods = [
    "  async startAutonomyTraceSpan(span = {}) {",
    "    await this.executeQuery(",
    "      `INSERT OR REPLACE INTO autonomy_trace_spans (",
    "        id, trace_id, parent_span_id, operator_run_id, job_id, production_id, stage, operation, status, duration_ms, metadata, error, started_at, completed_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [span.id, span.traceId, span.parentSpanId || null, span.operatorRunId || null, span.jobId || null, span.productionId || null,",
    "       span.stage || 'unknown', span.operation || span.stage || 'unknown', span.status || 'running', Number(span.durationMs || 0),",
    "       JSON.stringify(span.metadata || {}), span.error || null, span.startedAt || new Date().toISOString(), span.completedAt || null]",
    "    );",
    "    return span.id;",
    "  }",
    "",
    "  async finishAutonomyTraceSpan(id, changes = {}) {",
    "    await this.executeQuery(",
    "      `UPDATE autonomy_trace_spans SET status = ?, duration_ms = ?, error = ?, completed_at = ? WHERE id = ?`,",
    "      [changes.status || 'succeeded', Number(changes.durationMs || 0), changes.error || null, changes.completedAt || new Date().toISOString(), id]",
    "    );",
    "    return this.getRow('SELECT * FROM autonomy_trace_spans WHERE id = ?', [id]);",
    "  }",
    "",
    "  async listAutonomyTraceSpans(options = {}) {",
    "    const where = [];",
    "    const params = [];",
    "    if (options.traceId) { where.push('trace_id = ?'); params.push(options.traceId); }",
    "    if (options.jobId) { where.push('job_id = ?'); params.push(options.jobId); }",
    "    if (options.productionId) {",
    "      const job = await this.getRow('SELECT id FROM generation_jobs WHERE production_id = ? ORDER BY created_at DESC LIMIT 1', [options.productionId]);",
    "      if (job?.id) { where.push('(production_id = ? OR job_id = ?)'); params.push(options.productionId, job.id); }",
    "      else { where.push('production_id = ?'); params.push(options.productionId); }",
    "    }",
    "    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));",
    "    const rows = await this.getAllRows(`SELECT * FROM autonomy_trace_spans ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC LIMIT ?`, [...params, limit]);",
    "    return rows.map(row => ({ ...row, traceId: row.trace_id, parentSpanId: row.parent_span_id, operatorRunId: row.operator_run_id,",
    "      jobId: row.job_id, productionId: row.production_id, durationMs: Number(row.duration_ms || 0), metadata: JSON.parse(row.metadata || '{}'),",
    "      startedAt: row.started_at, completedAt: row.completed_at }));",
    "  }",
    "",
    "  async saveAutonomyEvent(event = {}) {",
    "    await this.executeQuery(",
    "      `INSERT INTO autonomy_events (id, operator_run_id, job_id, production_id, event_type, stage, status, data, created_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [event.id, event.operatorRunId || null, event.jobId || null, event.productionId || null, event.eventType || 'state_change',",
    "       event.stage || null, event.status || null, JSON.stringify(event.data || {}), event.createdAt || new Date().toISOString()]",
    "    );",
    "    return event.id;",
    "  }",
    "",
    "  async listAutonomyEvents(options = {}) {",
    "    const where = []; const params = [];",
    "    if (options.operatorRunId) { where.push('operator_run_id = ?'); params.push(options.operatorRunId); }",
    "    if (options.productionId) { where.push('production_id = ?'); params.push(options.productionId); }",
    "    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));",
    "    const rows = await this.getAllRows(`SELECT * FROM autonomy_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, [...params, limit]);",
    "    return rows.map(row => ({ ...row, operatorRunId: row.operator_run_id, jobId: row.job_id, productionId: row.production_id,",
    "      eventType: row.event_type, data: JSON.parse(row.data || '{}'), createdAt: row.created_at }));",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 10 autonomy DB methods');
  write(rel, s);
}

function patchIndex() {
  const rel = 'index.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { DiscoverabilityService } = require('./utils/discoverability-service');\n",
    "const { DiscoverabilityService } = require('./utils/discoverability-service');\nconst { AutonomyObservabilityV10 } = require('./utils/autonomy-observability-v10');\n",
    'Phase 10 observability import'
  );
  s = replaceOnce(
    s,
    "    this.aiUsage = null;\n    this.setupRequired = false;\n",
    "    this.aiUsage = null;\n    this.observability = null;\n    this.setupRequired = false;\n",
    'Phase 10 runtime field'
  );
  s = replaceOnce(
    s,
    "      this.aiUsage = configureAIGatewayRuntime({ db: this.db, logger: this.logger });\n      await this.db.markInterruptedJobs();\n",
    "      this.aiUsage = configureAIGatewayRuntime({ db: this.db, logger: this.logger });\n      this.observability = new AutonomyObservabilityV10(this.db, { logger: this.logger });\n      await this.db.markInterruptedJobs();\n",
    'initialize Phase 10 observability'
  );
  s = replaceOnce(
    s,
    "        notify: notification => this.operator.notify(notification)\n",
    "        notify: notification => this.operator.notify(notification),\n        observability: this.observability\n",
    'pass observability to autonomous operator'
  );

  const noveltyBlock = [
    "    if (validation.value.topic && this.observability) {",
    "      const automated = ['scheduler', 'autonomous_operator'].includes(input.source);",
    "      if (automated || input.enforceNovelty === true) {",
    "        await this.observability.assertTopicNovel(validation.value.topic, { allowDuplicate: input.allowDuplicate === true });",
    "      } else {",
    "        await this.observability.topicNovelty(validation.value.topic).catch(() => null);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, '    const job = await this.db.createGenerationJob({\n', noveltyBlock, 'near-duplicate topic guard before job creation');

  s = replaceOnce(
    s,
    "      return withAIUsageContext({ jobId: null, stage, operation: stage }, async () =>\n        normalizeGenerationArtifact(stage, await producer())\n      );\n",
    "      return this.observability.withSpan({ jobId: null, stage, operation: stage }, () =>\n        withAIUsageContext({ jobId: null, stage, operation: stage }, async () =>\n          normalizeGenerationArtifact(stage, await producer())\n        )\n      );\n",
    'trace direct generation stage'
  );
  s = replaceOnce(
    s,
    "    return withAIUsageContext({ jobId, stage, operation: stage }, () =>\n      this.recovery.run(jobId, stage, progress, producer)\n    );\n",
    "    return this.observability.withSpan({ jobId, stage, operation: stage }, () =>\n      withAIUsageContext({ jobId, stage, operation: stage }, () =>\n        this.recovery.run(jobId, stage, progress, producer)\n      )\n    );\n",
    'trace recoverable generation stage'
  );

  const routes = [
    "    this.app.get('/api/doctor', async (_req, res) => {",
    "      try { return res.json({ success: true, result: await this.observability.doctor() }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "",
    "    this.app.get('/api/content/:productionId/observability', async (req, res) => {",
    "      try {",
    "        const productionId = req.params.productionId;",
    "        const [publication, usage, traces, events] = await Promise.all([",
    "          this.observability.publicationState(productionId),",
    "          this.observability.usageForProduction(productionId),",
    "          this.db.listAutonomyTraceSpans({ productionId, limit: 100 }),",
    "          this.db.listAutonomyEvents({ productionId, limit: 100 })",
    "        ]);",
    "        return res.json({ success: true, result: { publication, usage, traces, events } });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "",
    "    this.app.get('/api/topics/novelty', async (req, res) => {",
    "      try {",
    "        const topic = String(req.query?.topic || '').trim();",
    "        if (!topic) return res.status(400).json({ success: false, error: 'topic is required' });",
    "        return res.json({ success: true, result: await this.observability.topicNovelty(topic) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "",
    "    this.app.post('/api/operator/:runId/reconcile', async (req, res) => {",
    "      try { return res.json({ success: true, result: await this.autonomous.reconcile(req.params.runId) }); }",
    "      catch (error) { return res.status(error.status || 500).json({ success: false, error: error.message }); }",
    "    });",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/ai/usage', async (req, res) => {\n", routes, 'Phase 10 observability API routes');

  s = replaceOnce(
    s,
    "    await this.operator.notify({\n      type: 'content_approved', level: 'success', title: 'Content approved',\n      message: `${productionData.script.title} is scheduled for ${scheduleEntry.publishTime}`,\n      data: { productionId, publishTime: scheduleEntry.publishTime }\n    });\n    return { productionId, reviewStatus: 'approved', qualityScore: quality.score, schedule: scheduleEntry };\n",
    "    await this.operator.notify({\n      type: 'content_approved', level: 'success', title: 'Content approved',\n      message: `${productionData.script.title} is scheduled for ${scheduleEntry.publishTime}`,\n      data: { productionId, publishTime: scheduleEntry.publishTime }\n    });\n    await this.autonomous?.reconcileByProduction?.(productionId).catch(error => this.logger.warn(`Autonomous reconciliation failed: ${error.message}`));\n    return { productionId, reviewStatus: 'approved', qualityScore: quality.score, schedule: scheduleEntry };\n",
    'reconcile autonomous run after human approval'
  );
  write(rel, s);
}

function patchAutonomousOperator() {
  const rel = 'utils/autonomous-channel-operator.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    this.notify = options.notify || (async () => null);\n    this.logger = new Logger('AutonomousOperator');\n",
    "    this.notify = options.notify || (async () => null);\n    this.observability = options.observability || null;\n    this.logger = new Logger('AutonomousOperator');\n",
    'autonomous observability dependency'
  );
  s = replaceOnce(
    s,
    "          const completed = job.status === 'completed' ? job : await this.waitForGenerationJob(job.id);\n",
    "          let completed = job.status === 'completed' ? job : await this.waitForGenerationJob(job.id);\n",
    'allow completed job refresh after automatic repair'
  );
  const repairAnchor = "          record.error = completed.error || null;\n          if (ideaId) await this.db.updateContentIdea(ideaId, {\n";
  const repairBlock = [
    "          record.error = completed.error || null;",
    "          if (record.status === 'completed' && record.reviewStatus === 'needs_attention' && record.productionId && this.observability) {",
    "            const attempts = Number(record.autoRepairAttempts || 0);",
    "            const repair = await this.observability.planAutomaticRepair(record.productionId, attempts);",
    "            record.repairPlan = { automatic: repair.automatic, stage: repair.stage, reason: repair.reason };",
    "            if (repair.automatic && repair.stage) {",
    "              record.autoRepairAttempts = attempts + 1;",
    "              await this.observability.recordEvent({ operatorRunId: runId, jobId: job.id, productionId: record.productionId,",
    "                eventType: 'auto_repair_started', stage: repair.stage, status: 'running', data: record.repairPlan });",
    "              job = await this.resumeGenerationJob(job.id, { stage: repair.stage });",
    "              completed = job.status === 'completed' ? job : await this.waitForGenerationJob(job.id);",
    "              record.status = completed.status;",
    "              record.productionId = completed.production_id || record.productionId;",
    "              record.reviewStatus = completed.details?.reviewStatus || null;",
    "              record.error = completed.error || null;",
    "              await this.observability.recordEvent({ operatorRunId: runId, jobId: job.id, productionId: record.productionId,",
    "                eventType: 'auto_repair_completed', stage: repair.stage, status: record.status, data: { reviewStatus: record.reviewStatus } });",
    "            }",
    "          }",
    "          if (ideaId) await this.db.updateContentIdea(ideaId, {",
  ].join('\n') + '\n';
  s = replaceOnce(s, repairAnchor, repairBlock, 'conservative autonomous repair loop');

  const reconcileMethods = [
    "  async reconcile(runId) {",
    "    const run = await this.db.getOperatorRun(runId);",
    "    if (!run) { const error = new Error('Operator run not found'); error.status = 404; throw error; }",
    "    const generatedJobs = Array.isArray(run.generatedJobs) ? run.generatedJobs.map(item => ({ ...item })) : [];",
    "    for (const record of generatedJobs) {",
    "      if (!record.productionId) continue;",
    "      const bundle = await this.db.getProductionBundle(record.productionId);",
    "      if (!bundle) continue;",
    "      record.reviewStatus = bundle.review_status || record.reviewStatus || null;",
    "      record.scheduleStatus = bundle.schedule?.status || null;",
    "      record.qualityStatus = bundle.qualityAgentReport?.status || null;",
    "    }",
    "    const completed = generatedJobs.filter(item => item.status === 'completed');",
    "    const waiting = completed.filter(item => ['needs_review', 'needs_attention'].includes(item.reviewStatus));",
    "    const failed = generatedJobs.filter(item => item.status !== 'completed');",
    "    const status = waiting.length ? 'waiting_review' : failed.length ? 'completed_with_issues' : 'completed';",
    "    const updated = await this.update(runId, {",
    "      status, stage: waiting.length ? 'waiting_for_review' : 'complete', progress: 100, generatedJobs,",
    "      summary: { planned: generatedJobs.length, generated: completed.length, needsReview: waiting.length, failed: failed.length },",
    "      error: null, completedAt: waiting.length ? null : (run.completedAt || new Date().toISOString())",
    "    });",
    "    return updated;",
    "  }",
    "",
    "  async reconcileByProduction(productionId) {",
    "    const runs = await this.db.listOperatorRuns(50);",
    "    const matches = runs.filter(run => ['waiting_review', 'completed_with_issues'].includes(run.status) &&",
    "      (run.generatedJobs || []).some(item => item.productionId === productionId));",
    "    const updated = [];",
    "    for (const run of matches) updated.push(await this.reconcile(run.id));",
    "    return updated;",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  async cancel(runId) {\n', reconcileMethods, 'autonomous review reconciliation methods');

  s = replaceOnce(
    s,
    "  update(runId, changes) {\n    return this.db.updateOperatorRun(runId, changes);\n  }\n",
    "  async update(runId, changes) {\n    const updated = await this.db.updateOperatorRun(runId, changes);\n    await this.observability?.recordEvent?.({ operatorRunId: runId, eventType: 'operator_state', stage: changes.stage || updated?.stage,\n      status: changes.status || updated?.status, data: { progress: changes.progress ?? updated?.progress, error: changes.error || null } }).catch(() => {});\n    return updated;\n  }\n",
    'persist autonomous operator state events'
  );
  write(rel, s);
}

function patchPublishing() {
  const rel = 'agents/publishing-scheduling-agent.js';
  let s = read(rel);
  const scheduleGuard = [
    "      const approvalRequired = await this.db.getSetting('approval_required') !== 'false';",
    "      const gateBundle = await this.db.getProductionBundle?.(productionData.id);",
    "      if (gateBundle) {",
    "        if (approvalRequired && gateBundle.review_status !== 'approved') {",
    "          const error = new Error('Scheduling is blocked until the production is explicitly approved');",
    "          error.status = 409; error.code = 'PUBLISH_APPROVAL_REQUIRED'; throw error;",
    "        }",
    "        if (gateBundle.qualityAgentReport?.status === 'blocked') {",
    "          const error = new Error('Scheduling is blocked by Phase 9 Quality Agents');",
    "          error.status = 409; error.code = 'QUALITY_BLOCKED'; throw error;",
    "        }",
    "      }",
    ""
  ].join('\n');
  s = insertBefore(s, '      const finalVideo = productionData.assets?.finalVideo;\n', scheduleGuard, 'approval/quality gate before scheduling');

  s = replaceOnce(
    s,
    "        productionBundle = await this.db.getProductionBundle(contentId);\n        if (productionBundle && !['verified', 'not_required'].includes(productionBundle.provenance?.status || 'not_required')) {\n",
    "        productionBundle = await this.db.getProductionBundle(contentId);\n        const approvalRequired = await this.db.getSetting('approval_required') !== 'false';\n        if (productionBundle && approvalRequired && productionBundle.review_status !== 'approved') {\n          const error = new Error('Publishing is blocked until the production is explicitly approved');\n          error.status = 409; error.code = 'PUBLISH_APPROVAL_REQUIRED'; throw error;\n        }\n        if (productionBundle?.qualityAgentReport?.status === 'blocked') {\n          const error = new Error('Publishing is blocked by Phase 9 Quality Agents');\n          error.status = 409; error.code = 'QUALITY_BLOCKED'; throw error;\n        }\n        if (productionBundle && !['verified', 'not_required'].includes(productionBundle.provenance?.status || 'not_required')) {\n",
    'approval/quality gate before YouTube upload'
  );
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:autonomy'] = 'node ../bootstrap/verify-phase10-autonomy.js';
  pkg.scripts['doctor'] = 'node scripts/doctor-v10.js';
  pkg.scripts['doctor:strict'] = 'node scripts/doctor-v10.js --strict';
  pkg.scripts['e2e:safe'] = 'node scripts/e2e-safe-v10.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyRuntime();
patchDatabase();
patchIndex();
patchAutonomousOperator();
patchPublishing();
patchPackage();

console.log('Phase 10 autonomy/observability installed: traces, doctor, safe E2E, near-duplicate guard, conservative auto-repair, approval-safe publication and operator reconciliation.');
