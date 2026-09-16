'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');
const template = name => fs.readFileSync(path.join(root, 'bootstrap', 'templates', name), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 12.1 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.1 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function insertAfter(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.1 anchor not found: ${label}`);
  const end = index + anchor.length;
  return text.slice(0, end) + block + text.slice(end);
}

function copyRuntime() {
  let service = template('global-news-radar-v121.js');

  // A minute-level scheduler may wake while an HTTP scan is still running. Keep one
  // process-local scan promise so we never fan out duplicate discovery requests.
  service = replaceOnce(
    service,
    "    this.rssSources = options.rssSources || parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', []);\n",
    "    this.rssSources = options.rssSources || parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', []);\n    this.activeScan = null;\n",
    'newsroom scan lock state'
  );
  service = replaceOnce(
    service,
    "  async scanIfDue(options = {}) {\n    if (String(process.env.NEWSROOM_ENABLED || 'true').toLowerCase() === 'false') return { skipped: true, reason: 'newsroom_disabled' };\n",
    "  async scanIfDue(options = {}) {\n    if (this.activeScan) return { skipped: true, reason: 'scan_in_progress' };\n    if (String(process.env.NEWSROOM_ENABLED || 'true').toLowerCase() === 'false') return { skipped: true, reason: 'newsroom_disabled' };\n",
    'newsroom due scan lock check'
  );
  service = replaceOnce(
    service,
    "  async scanAndDecide(options = {}) {\n    const scanId = `news_scan_${hash(`${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).slice(0, 24)}`;\n",
    "  async scanAndDecide(options = {}) {\n    if (this.activeScan) return this.activeScan;\n    this.activeScan = this._scanAndDecide(options).finally(() => { this.activeScan = null; });\n    return this.activeScan;\n  }\n\n  async _scanAndDecide(options = {}) {\n    const scanId = `news_scan_${hash(`${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).slice(0, 24)}`;\n",
    'newsroom atomic scan wrapper'
  );

  write('utils/global-news-radar-v121.js', service);
  write('dashboard/newsroom-v121.js', template('newsroom-dashboard-v121.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('global-news-radar-db-tables-v121.txt')}\n`,
    'newsroom database tables'
  );
  write('database/db.js', s);
}

function patchIndex() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { CrossEpisodeNarrativeContinuityGateV12 } = require('./utils/cross-episode-narrative-continuity-gate-v12');\n",
    "const { CrossEpisodeNarrativeContinuityGateV12 } = require('./utils/cross-episode-narrative-continuity-gate-v12');\nconst { GlobalNewsRadarServiceV121 } = require('./utils/global-news-radar-v121');\n",
    'Global News Radar import'
  );
  s = replaceOnce(
    s,
    "    this.narrativeContinuityGateService = null;\n",
    "    this.narrativeContinuityGateService = null;\n    this.globalNewsRadarService = null;\n",
    'Global News Radar property'
  );
  s = replaceOnce(
    s,
    "      await this.db.markInterruptedJobs();\n",
    "      await this.db.markInterruptedJobs();\n      this.globalNewsRadarService = new GlobalNewsRadarServiceV121(this.db, { logger: this.logger });\n",
    'Global News Radar initialization'
  );
  s = replaceOnce(
    s,
    "        experiments: this.experiments\n      });\n",
    "        experiments: this.experiments,\n        newsroom: this.globalNewsRadarService\n      });\n",
    'scheduler newsroom dependency'
  );

  const routes = [
    "    this.app.get('/api/newsroom/config', protect, async (_req, res) => {",
    "      try { return res.json({ success: true, result: this.globalNewsRadarService.getConfig() }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/status', protect, async (_req, res) => {",
    "      try { return res.json({ success: true, result: await this.globalNewsRadarService.status() }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/scan', protect, async (req, res) => {",
    "      try {",
    "        const result = await this.globalNewsRadarService.scanAndDecide({ autoPromote: req.body?.autoPromote !== false });",
    "        return res.json({ success: true, result });",
    "      } catch (error) { return res.status(error.status || 502).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/clusters', protect, async (req, res) => {",
    "      try { return res.json({ success: true, result: await this.globalNewsRadarService.listClusters(req.query.limit || 50) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/clusters/:clusterId', protect, async (req, res) => {",
    "      try { const result = await this.globalNewsRadarService.getCluster(req.params.clusterId); return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Newsroom cluster not found' }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/decisions', protect, async (req, res) => {",
    "      try { return res.json({ success: true, result: await this.globalNewsRadarService.listDecisions(req.query.limit || 100, req.query.action || null) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/decisions/:decisionId/promote', protect, async (req, res) => {",
    "      try { return res.status(201).json({ success: true, result: await this.globalNewsRadarService.promoteDecision(req.params.decisionId) }); }",
    "      catch (error) { return res.status(error.status || 400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'newsroom protected API routes');
  write('index.js', s);
}

function patchScheduler() {
  let s = read('schedules/daily-automation.js');
  s = replaceOnce(
    s,
    "    this.experiments = options.experiments || null;\n",
    "    this.experiments = options.experiments || null;\n    this.newsroom = options.newsroom || null;\n",
    'scheduler newsroom property'
  );

  const task = [
    "",
    "    // Phase 12.1 — wake the global newsroom every minute; the service enforces its own",
    "    // scan interval and single-flight lock so slow HTTP scans never overlap.",
    "    this.scheduledTasks.set('global-news-radar',",
    "      cron.schedule('* * * * *', async () => {",
    "        if (this.isEnabled) await this.runGlobalNewsRadar();",
    "      }, { scheduled: false })",
    "    );",
    ""
  ].join('\n');
  s = insertBefore(s, "    // Daily content generation at 6:00 AM\n", task, 'newsroom scheduler task');

  const method = [
    "  async runGlobalNewsRadar() {",
    "    if (!this.newsroom) return null;",
    "    try {",
    "      const result = await this.newsroom.scanIfDue({ autoPromote: true });",
    "      if (result?.skipped) {",
    "        if (!['not_due', 'scan_in_progress'].includes(result.reason)) this.logger.info(`Global News Radar skipped: ${result.reason}`);",
    "        return result;",
    "      }",
    "      await this.logAutomationEvent('global_news_radar', result.status === 'failed' ? 'error' : 'success', {",
    "        scanId: result.id, status: result.status, articleCount: result.articleCount, clusterCount: result.clusterCount, actionableCount: result.actionableCount",
    "      });",
    "      return result;",
    "    } catch (error) {",
    "      this.logger.error('Global News Radar failed:', error);",
    "      await this.logAutomationEvent('global_news_radar', 'error', { error: error.message });",
    "      return { status: 'failed', error: error.message };",
    "    }",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, "  async runDailyContentGeneration() {\n", method, 'newsroom scheduler method');
  write('schedules/daily-automation.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const operatorNav = '<button class="nav-item" data-view="operator"><svg';
  const navIndex = html.indexOf(operatorNav);
  if (navIndex === -1 && !html.includes('data-view="newsroom"')) throw new Error('Phase 12.1 anchor not found: newsroom nav operator');
  if (!html.includes('data-view="newsroom"')) {
    const end = html.indexOf('</button>', navIndex) + '</button>'.length;
    const newsroomNav = '\n        <button class="nav-item" data-view="newsroom"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 5h18v14H3z"/><path d="M7 9h4M7 13h10M7 16h7M14 9h3"/></svg> Global newsroom</button>';
    html = html.slice(0, end) + newsroomNav + html.slice(end);
  }

  const newsroomView = `\n      <section id="newsroom-view" class="view">\n        <div class="section-intro"><div><h2>Global Newsroom</h2><p>Discover global coverage, cluster the same event, and make auditable editorial decisions before production.</p></div><button id="newsroom-scan-button" class="button primary">Scan world now</button></div>\n        <div class="stats-grid">\n          <article class="stat"><span>Last scan</span><strong id="newsroom-last-scan">—</strong><small id="newsroom-config-summary">Global radar</small></article>\n          <article class="stat"><span>Articles observed</span><strong id="newsroom-article-count">0</strong><small>metadata-only discovery</small></article>\n          <article class="stat"><span>Story clusters</span><strong id="newsroom-cluster-count">0</strong><small>deduplicated events</small></article>\n          <article class="stat"><span>Actionable</span><strong id="newsroom-actionable-count">0</strong><small>cover / breaking / update</small></article>\n        </div>\n        <div class="overview-grid">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">GLOBAL RADAR</p><h2>Most repercussive story clusters</h2></div></div><div id="newsroom-clusters" class="card-list"></div></article>\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">AUTONOMOUS EDITOR</p><h2>Recent decisions</h2></div></div><div id="newsroom-decisions" class="idea-list"></div></article>\n        </div>\n        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity. It is not a truth score or political recommendation. Every factual claim still passes the Research &amp; Provenance Desk before publication.</p>\n      </section>\n\n`;
  html = insertBefore(html, '      <section id="readiness-view" class="view">\n', newsroomView, 'newsroom dashboard view');
  html = replaceOnce(
    html,
    '  <script src="/app.js" defer></script>\n  <script src="/enhance.js" defer></script>',
    '  <script src="/app.js" defer></script>\n  <script src="/newsroom-v121.js" defer></script>\n  <script src="/enhance.js" defer></script>',
    'newsroom dashboard script'
  );
  write('dashboard/index.html', html);

  let app = read('dashboard/app.js');
  app = replaceOnce(
    app,
    "    operator: ['AUTONOMOUS OPERATOR', 'Give Lumen the strategy.'],\n",
    "    operator: ['AUTONOMOUS OPERATOR', 'Give Lumen the strategy.'],\n    newsroom: ['GLOBAL NEWSROOM', 'See what the world is talking about.'],\n",
    'newsroom view title'
  );
  app = replaceOnce(
    app,
    "  location.hash = view;\n",
    "  location.hash = view;\n  if (view === 'newsroom' && typeof window.loadNewsroom === 'function') window.loadNewsroom(true);\n",
    'newsroom view lazy load'
  );
  write('dashboard/app.js', app);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:global-news-radar'] = 'node ../bootstrap/verify-phase12-global-news-radar.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_ENABLED=')) {
    env += `\n# Phase 12.1 — Global News Radar + Autonomous Editor.\nNEWSROOM_ENABLED=true\n# The minute scheduler only wakes the service; actual scans are due-gated by this interval.\nNEWSROOM_SCAN_INTERVAL_MINUTES=10\nNEWSROOM_LOOKBACK_HOURS=6\nNEWSROOM_HTTP_TIMEOUT_MS=9000\nNEWSROOM_CLUSTER_THRESHOLD=0.36\n# Minimum coverage corroboration breadth before COVER/BREAKING can become actionable.\nNEWSROOM_MIN_INDEPENDENT_SOURCES=3\nNEWSROOM_MIN_COVERAGE_CONFIDENCE=58\nNEWSROOM_BREAKING_THRESHOLD=82\nNEWSROOM_COVER_THRESHOLD=66\nNEWSROOM_FOLLOW_UP_THRESHOLD=58\n# Actionable decisions create backlog assignments only; they do not bypass research, review or publishing gates.\nNEWSROOM_AUTO_PROMOTE=true\n# Optional JSON override for GDELT lanes. Leave unset to use English/Spanish/Portuguese/French global lanes.\n# NEWSROOM_GDELT_LANES_JSON=[]\n# Optional RSS feeds. Add only feeds whose terms permit your commercial workflow. No publisher RSS feeds ship by default.\nNEWSROOM_RSS_SOURCES_JSON=[]\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchIndex();
patchScheduler();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.1 ativa: Global News Radar + Autonomous Editor com GDELT global, clustering deterministico, ranking auditavel, decisions e backlog autonomo.');
