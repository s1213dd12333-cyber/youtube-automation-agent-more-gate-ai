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

function copyGateway() {
  const template = path.join(root, 'bootstrap', 'templates', 'ai-gateway-v4.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/ai-gateway-v4.js');
  write('utils/ai-gateway-v4.js', fs.readFileSync(template, 'utf8'));
}

function patchAITextService() {
  const rel = 'utils/ai-text-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { Logger } = require('./logger');\n",
    "const { Logger } = require('./logger');\nconst { AIGatewayV4 } = require('./ai-gateway-v4');\n",
    'AI gateway import'
  );
  s = replaceOnce(
    s,
    "    this.providerName = null;\n\n    this._init(credentials);\n",
    "    this.providerName = null;\n    this.gateway = new AIGatewayV4(credentials, PROVIDERS, { models: GEMINI_MODELS, defaultModel: GEMINI_DEFAULT_MODEL }, { logger: this.logger });\n    this.lastRequestMeta = null;\n\n    this._init(credentials);\n",
    'AI gateway construction'
  );
  s = replaceOnce(
    s,
    "    const temperature = options.temperature ?? 0.7;\n\n    if (this.gemini) {\n",
    "    const temperature = options.temperature ?? 0.7;\n\n    if (this.gateway?.isAvailable(options)) {\n      const routed = await this.gateway.generateText(prompt, { ...options, maxTokens, temperature });\n      this.providerName = routed.providerName;\n      this.model = routed.model;\n      this.lastRequestMeta = routed;\n      return routed.text;\n    }\n\n    if (this.gemini) {\n",
    'route text generation through phase 4 gateway'
  );
  s = replaceOnce(
    s,
    "  isAvailable() {\n    return !!(this.client || this.gemini);\n  }\n",
    "  isAvailable() {\n    return Boolean(this.gateway?.isAvailable() || this.client || this.gemini);\n  }\n",
    'gateway availability'
  );
  write(rel, s);
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tableBlock = [
    "      // AI provider usage and quota evidence",
    "      `CREATE TABLE IF NOT EXISTS ai_usage (",
    "        id TEXT PRIMARY KEY,",
    "        job_id TEXT,",
    "        production_id TEXT,",
    "        provider TEXT NOT NULL,",
    "        model TEXT,",
    "        operation TEXT NOT NULL DEFAULT 'text',",
    "        resource_type TEXT NOT NULL DEFAULT 'text',",
    "        input_tokens INTEGER NOT NULL DEFAULT 0,",
    "        output_tokens INTEGER NOT NULL DEFAULT 0,",
    "        reasoning_tokens INTEGER NOT NULL DEFAULT 0,",
    "        total_tokens INTEGER NOT NULL DEFAULT 0,",
    "        input_units REAL NOT NULL DEFAULT 0,",
    "        output_units REAL NOT NULL DEFAULT 0,",
    "        estimated_cost REAL,",
    "        request_status TEXT NOT NULL DEFAULT 'succeeded',",
    "        latency_ms INTEGER NOT NULL DEFAULT 0,",
    "        rate_limit_remaining REAL,",
    "        rate_limit_limit REAL,",
    "        rate_limit_reset TEXT,",
    "        error_code TEXT,",
    "        metadata TEXT NOT NULL DEFAULT '{}',",
    "        created_at TEXT DEFAULT CURRENT_TIMESTAMP",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage(provider, resource_type, created_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_ai_usage_job ON ai_usage(job_id, operation, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tableBlock, 'AI usage table');

  const methods = [
    "  async saveAIUsageEvent(event = {}) {",
    "    const id = this.generateId('ai_usage');",
    "    await this.executeQuery(",
    "      `INSERT INTO ai_usage (",
    "        id, job_id, production_id, provider, model, operation, resource_type,",
    "        input_tokens, output_tokens, reasoning_tokens, total_tokens, input_units, output_units,",
    "        estimated_cost, request_status, latency_ms, rate_limit_remaining, rate_limit_limit,",
    "        rate_limit_reset, error_code, metadata",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [",
    "        id, event.jobId || null, event.productionId || null, event.provider || 'unknown', event.model || null,",
    "        event.operation || 'text', event.resourceType || 'text', Number(event.inputTokens || 0),",
    "        Number(event.outputTokens || 0), Number(event.reasoningTokens || 0), Number(event.totalTokens || 0),",
    "        Number(event.inputUnits || 0), Number(event.outputUnits || 0),",
    "        event.estimatedCost === null || event.estimatedCost === undefined ? null : Number(event.estimatedCost),",
    "        event.requestStatus || 'succeeded', Number(event.latencyMs || 0),",
    "        event.rateLimitRemaining === null || event.rateLimitRemaining === undefined ? null : Number(event.rateLimitRemaining),",
    "        event.rateLimitLimit === null || event.rateLimitLimit === undefined ? null : Number(event.rateLimitLimit),",
    "        event.rateLimitReset || null, event.errorCode || null, JSON.stringify(event.metadata || {})",
    "      ]",
    "    );",
    "    return id;",
    "  }",
    "",
    "  async listAIUsageEvents(limit = 100, hours = 24) {",
    "    const safeLimit = Math.min(1000, Math.max(1, Number(limit || 100)));",
    "    const safeHours = Math.min(24 * 90, Math.max(1, Number(hours || 24)));",
    "    const rows = await this.getAllRows(",
    "      `SELECT * FROM ai_usage WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT ?`,",
    "      [`-${safeHours} hours`, safeLimit]",
    "    );",
    "    return rows.map(row => ({",
    "      id: row.id, jobId: row.job_id, productionId: row.production_id, provider: row.provider, model: row.model,",
    "      operation: row.operation, resourceType: row.resource_type, inputTokens: Number(row.input_tokens || 0),",
    "      outputTokens: Number(row.output_tokens || 0), reasoningTokens: Number(row.reasoning_tokens || 0),",
    "      totalTokens: Number(row.total_tokens || 0), inputUnits: Number(row.input_units || 0),",
    "      outputUnits: Number(row.output_units || 0), estimatedCost: row.estimated_cost === null ? null : Number(row.estimated_cost),",
    "      requestStatus: row.request_status, latencyMs: Number(row.latency_ms || 0),",
    "      rateLimitRemaining: row.rate_limit_remaining === null ? null : Number(row.rate_limit_remaining),",
    "      rateLimitLimit: row.rate_limit_limit === null ? null : Number(row.rate_limit_limit),",
    "      rateLimitReset: row.rate_limit_reset, errorCode: row.error_code, metadata: JSON.parse(row.metadata || '{}'),",
    "      createdAt: row.created_at",
    "    }));",
    "  }",
    "",
    "  async getAIUsageSummary(hours = 24) {",
    "    const safeHours = Math.min(24 * 90, Math.max(1, Number(hours || 24)));",
    "    const since = `-${safeHours} hours`;",
    "    const totalsRow = await this.getRow(",
    "      `SELECT COUNT(*) AS requests,",
    "       SUM(CASE WHEN request_status != 'succeeded' THEN 1 ELSE 0 END) AS errors,",
    "       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,",
    "       SUM(reasoning_tokens) AS reasoning_tokens, SUM(total_tokens) AS total_tokens,",
    "       SUM(input_units) AS input_units, SUM(output_units) AS output_units,",
    "       SUM(COALESCE(estimated_cost, 0)) AS estimated_cost, AVG(latency_ms) AS avg_latency_ms",
    "       FROM ai_usage WHERE created_at >= datetime('now', ?)`, [since]",
    "    );",
    "    const providerRows = await this.getAllRows(",
    "      `SELECT provider, COUNT(*) AS requests,",
    "       SUM(CASE WHEN request_status != 'succeeded' THEN 1 ELSE 0 END) AS errors,",
    "       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,",
    "       SUM(reasoning_tokens) AS reasoning_tokens, SUM(total_tokens) AS total_tokens,",
    "       SUM(input_units) AS input_units, SUM(output_units) AS output_units, AVG(latency_ms) AS avg_latency_ms",
    "       FROM ai_usage WHERE created_at >= datetime('now', ?) GROUP BY provider ORDER BY total_tokens DESC, requests DESC`, [since]",
    "    );",
    "    const resourceRows = await this.getAllRows(",
    "      `SELECT resource_type, COUNT(*) AS requests, SUM(total_tokens) AS total_tokens,",
    "       SUM(input_units) AS input_units, SUM(output_units) AS output_units",
    "       FROM ai_usage WHERE created_at >= datetime('now', ?) GROUP BY resource_type ORDER BY requests DESC`, [since]",
    "    );",
    "    const mapUsage = row => ({",
    "      requests: Number(row?.requests || 0), errors: Number(row?.errors || 0),",
    "      inputTokens: Number(row?.input_tokens || 0), outputTokens: Number(row?.output_tokens || 0),",
    "      reasoningTokens: Number(row?.reasoning_tokens || 0), totalTokens: Number(row?.total_tokens || 0),",
    "      inputUnits: Number(row?.input_units || 0), outputUnits: Number(row?.output_units || 0),",
    "      estimatedCost: Number(row?.estimated_cost || 0), avgLatencyMs: Math.round(Number(row?.avg_latency_ms || 0))",
    "    });",
    "    return {",
    "      totals: mapUsage(totalsRow || {}),",
    "      providers: providerRows.map(row => ({ provider: row.provider, ...mapUsage(row) })),",
    "      resources: resourceRows.map(row => ({ resourceType: row.resource_type, requests: Number(row.requests || 0), totalTokens: Number(row.total_tokens || 0), inputUnits: Number(row.input_units || 0), outputUnits: Number(row.output_units || 0) })),",
    "      recent: await this.listAIUsageEvents(100, safeHours)",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'AI usage database methods');
  write(rel, s);
}

function patchIndex() {
  const rel = 'index.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { AITextService } = require('./utils/ai-text-service');\n",
    "const { AITextService } = require('./utils/ai-text-service');\nconst { configureAIGatewayRuntime, withAIUsageContext } = require('./utils/ai-gateway-v4');\n",
    'AI gateway runtime import'
  );
  s = replaceOnce(
    s,
    "    this.discoverability = null;\n    this.setupRequired = false;\n",
    "    this.discoverability = null;\n    this.aiUsage = null;\n    this.setupRequired = false;\n",
    'AI usage runtime field'
  );
  s = replaceOnce(
    s,
    "      await this.db.initialize();\n      await this.db.markInterruptedJobs();\n",
    "      await this.db.initialize();\n      this.aiUsage = configureAIGatewayRuntime({ db: this.db, logger: this.logger });\n      await this.db.markInterruptedJobs();\n",
    'configure AI usage database runtime'
  );
  s = replaceOnce(
    s,
    "        if (this.telemetry) void this.telemetry.sync(activation);\n        res.json({\n",
    "        const aiUsage = this.aiUsage\n          ? await this.aiUsage.summary(24)\n          : { periodHours: 24, totals: {}, providers: [], resources: [], recent: [], circuits: [] };\n        if (this.telemetry) void this.telemetry.sync(activation);\n        res.json({\n",
    'dashboard AI usage aggregate'
  );
  s = replaceOnce(
    s,
    "          channelStrategy, operatorRuns, readiness, engagement, experiments,\n          system: {\n",
    "          channelStrategy, operatorRuns, readiness, engagement, experiments, aiUsage,\n          system: {\n",
    'dashboard AI usage payload'
  );

  const routeBlock = [
    "    this.app.get('/api/ai/usage', async (req, res) => {",
    "      try {",
    "        const hours = Math.min(24 * 90, Math.max(1, Number(req.query?.hours || 24)));",
    "        const result = this.aiUsage",
    "          ? await this.aiUsage.summary(hours)",
    "          : { periodHours: hours, totals: {}, providers: [], resources: [], recent: [], circuits: [] };",
    "        return res.json({ success: true, result });",
    "      } catch (error) {",
    "        return res.status(500).json({ success: false, error: error.message });",
    "      }",
    "    });",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routeBlock, 'AI usage API route');

  s = replaceOnce(
    s,
    "      return normalizeGenerationArtifact(stage, await producer());\n",
    "      return withAIUsageContext({ jobId: null, stage, operation: stage }, async () =>\n        normalizeGenerationArtifact(stage, await producer())\n      );\n",
    'AI usage context for direct generation stage'
  );
  s = replaceOnce(
    s,
    "    return this.recovery.run(jobId, stage, progress, producer);\n",
    "    return withAIUsageContext({ jobId, stage, operation: stage }, () =>\n      this.recovery.run(jobId, stage, progress, producer)\n    );\n",
    'AI usage context for recoverable generation stage'
  );
  write(rel, s);
}

function patchSceneNarration() {
  const rel = 'utils/scene-narration-v3.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { runFFmpeg } = require('./ffmpeg');\n",
    "const { runFFmpeg } = require('./ffmpeg');\nconst { recordAIUsage } = require('./ai-gateway-v4');\n",
    'TTS usage import'
  );
  s = replaceOnce(
    s,
    "          evidence.push({ ...last, reused: false, chunkIndex: index, attempt });\n          this.logger.info(`Scene ${scene.position + 1} TTS chunk ${index + 1}/${chunks.length} complete.`);\n",
    "          evidence.push({ ...last, reused: false, chunkIndex: index, attempt });\n          await recordAIUsage({\n            productionId, provider: last.provider || entry.provider || 'tts', model: last.model || entry.model || null,\n            operation: 'narration', resourceType: 'tts', inputUnits: chunk.length, outputUnits: Number(entry.duration || 0),\n            requestStatus: 'succeeded', metadata: { sceneId: scene.id, scenePosition: scene.position, chunkIndex: index, attempt }\n          });\n          this.logger.info(`Scene ${scene.position + 1} TTS chunk ${index + 1}/${chunks.length} complete.`);\n",
    'record successful TTS chunk usage'
  );
  s = replaceOnce(
    s,
    "          lastError = error;\n          entry.status = attempt >= this.maxAttempts ? 'failed' : 'retrying';\n",
    "          lastError = error;\n          const failedEvidence = this.videoGenerator.lastNarrationResult || {};\n          await recordAIUsage({\n            productionId, provider: failedEvidence.provider || entry.provider || 'tts', model: failedEvidence.model || entry.model || null,\n            operation: 'narration', resourceType: 'tts', inputUnits: chunk.length, requestStatus: 'failed',\n            errorCode: error.code || (error.status ? `HTTP_${error.status}` : 'TTS_REQUEST_FAILED'),\n            metadata: { sceneId: scene.id, scenePosition: scene.position, chunkIndex: index, attempt }\n          });\n          entry.status = attempt >= this.maxAttempts ? 'failed' : 'retrying';\n",
    'record failed TTS chunk usage'
  );
  write(rel, s);
}

function patchEnvironment() {
  const rel = '.env.example';
  let s = read(rel);
  const anchor = '# GEMINI_API_KEY=your-gemini-api-key-here\n';
  const block = [
    "",
    "# AI Provider Router & Usage Center",
    "# Keep 'explicit' to preserve the selected provider. Set to 'auto' to allow failover.",
    "AI_PROVIDER_MODE=explicit",
    "AI_ROUTER_STRATEGY=free_first",
    "# AI_PROVIDER_ORDER=groq,gemini,nvidia,openrouter,cerebras,openai,kimi,mimo,glm",
    "AI_BUDGET_WARNING_PERCENT=80",
    "AI_BUDGET_CRITICAL_PERCENT=95",
    "AI_PROVIDER_COOLDOWN_MS=60000",
    "AI_QUOTA_COOLDOWN_MS=3600000",
    "# Optional local budgets. Leave blank when the provider limit is unknown.",
    "# GROQ_DAILY_TOKEN_BUDGET=",
    "# GEMINI_DAILY_TOKEN_BUDGET=",
    "# NVIDIA_DAILY_TOKEN_BUDGET=",
    "# OPENROUTER_DAILY_TOKEN_BUDGET=",
    "# CEREBRAS_DAILY_TOKEN_BUDGET=",
    "# OPENAI_DAILY_TOKEN_BUDGET=",
    "# GEMINI_DAILY_CHARACTER_BUDGET=",
    "",
    ""
  ].join('\n');
  s = s.includes('AI_PROVIDER_MODE=explicit') ? s : s.replace(anchor, anchor + block);
  write(rel, s);
}

function patchDashboard() {
  const htmlRel = 'dashboard/index.html';
  let html = read(htmlRel);
  const nav = '        <button class="nav-item" data-view="ai-usage">AI usage</button>\n';
  html = insertBefore(html, '        <button class="nav-item" data-view="readiness">', nav, 'AI usage navigation');
  const section = [
    '      <section id="ai-usage-view" class="view">',
    '        <div class="section-intro"><div><h2>AI Usage &amp; Quota Center</h2><p>Provider-reported token usage, routing health, and configured budget headroom.</p></div><span id="ai-usage-mode" class="status">explicit</span></div>',
    '        <div class="stats-grid">',
    '          <article class="stat"><span>Tokens · 24h</span><strong id="ai-usage-tokens">0</strong><small>provider-reported only</small></article>',
    '          <article class="stat"><span>Requests · 24h</span><strong id="ai-usage-requests">0</strong><small>text + tracked media calls</small></article>',
    '          <article class="stat"><span>Errors · 24h</span><strong id="ai-usage-errors">0</strong><small>provider request failures</small></article>',
    '          <article class="stat"><span>Avg latency</span><strong id="ai-usage-latency">0 ms</strong><small>tracked requests</small></article>',
    '        </div>',
    '        <article class="panel">',
    '          <div class="panel-heading"><div><p class="eyebrow">PROVIDERS</p><h2>Consumption and headroom</h2></div></div>',
    '          <div id="ai-provider-list" class="card-list"></div>',
    '        </article>',
    '        <p id="ai-quota-note" class="callout">Remaining quota is unknown until a provider reports it or a local budget is configured.</p>',
    '      </section>',
    '',
    ''
  ].join('\n');
  html = insertBefore(html, '      <section id="settings-view" class="view">\n', section, 'AI usage dashboard view');
  write(htmlRel, html);

  const appRel = 'dashboard/app.js';
  let app = read(appRel);
  app = replaceOnce(
    app,
    '  renderReadiness(state.readiness);\n',
    '  renderReadiness(state.readiness);\n  renderAIUsage(state.aiUsage || {});\n',
    'render AI usage dashboard'
  );
  const renderFn = [
    'function renderAIUsage(usage = {}) {',
    "  const totals = usage.totals || {};",
    "  const number = value => new Intl.NumberFormat().format(Number(value || 0));",
    "  $('#ai-usage-mode').textContent = `${label(usage.mode || 'explicit')} · ${label(usage.strategy || 'free_first')}`;",
    "  $('#ai-usage-tokens').textContent = number(totals.totalTokens);",
    "  $('#ai-usage-requests').textContent = number(totals.requests);",
    "  $('#ai-usage-errors').textContent = number(totals.errors);",
    "  $('#ai-usage-latency').textContent = `${number(totals.avgLatencyMs)} ms`;",
    "  $('#ai-quota-note').textContent = usage.quotaNote || 'Remaining quota is unknown until a provider reports it or a local budget is configured.';",
    "  const providers = Array.isArray(usage.providers) ? usage.providers : [];",
    "  $('#ai-provider-list').innerHTML = providers.length ? providers.map(provider => {",
    "    const remaining = provider.remaining === null || provider.remaining === undefined ? 'unknown' : number(provider.remaining);",
    "    const budget = provider.budget === null || provider.budget === undefined ? 'not configured' : number(provider.budget);",
    "    const utilization = provider.utilizationPercent === null || provider.utilizationPercent === undefined ? '' : ` · ${provider.utilizationPercent.toFixed(1)}% local budget`;",
    "    return `<article class=\"job-card\"><div class=\"job-meta\"><strong>${escapeHTML(label(provider.provider))}</strong><div class=\"meta-line\">${number(provider.totalTokens)} tokens · ${number(provider.requests)} requests · ${number(provider.errors)} errors</div><div class=\"checkpoint-line\">Remaining: ${escapeHTML(remaining)} · source ${escapeHTML(provider.remainingSource || 'unknown')} · local budget ${escapeHTML(budget)}${escapeHTML(utilization)}</div></div>${statusChip(provider.budgetLevel || 'unknown')}</article>`;",
    "  }).join('') : empty('No AI usage has been recorded yet.');",
    '}',
    '',
    ''
  ].join('\n');
  app = insertBefore(app, 'function renderReadiness(readiness = {}) {\n', renderFn, 'AI usage renderer');
  app = replaceOnce(
    app,
    "    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.'],\n    settings:",
    "    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.'],\n    'ai-usage': ['AI USAGE & QUOTA', 'Know what every provider consumed.'],\n    settings:",
    'AI usage view title'
  );
  write(appRel, app);

  const enhanceRel = 'dashboard/enhance.js';
  let enhance = read(enhanceRel);
  enhance = replaceOnce(
    enhance,
    "    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.', 'Readiness'],\n    settings:",
    "    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.', 'Readiness'],\n    'ai-usage': ['AI USAGE & QUOTA', 'Know what every provider consumed.', 'AI Usage'],\n    settings:",
    'enhanced AI usage view metadata'
  );
  write(enhanceRel, enhance);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:ai-usage'] = 'node ../bootstrap/verify-phase4-provider-usage.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyGateway();
patchAITextService();
patchDatabase();
patchIndex();
patchSceneNarration();
patchEnvironment();
patchDashboard();
patchPackage();

console.log('Phase 4 provider router and usage center installed: explicit/auto routing, failover circuits, token telemetry, local budgets, TTS units, API, and dashboard.');
