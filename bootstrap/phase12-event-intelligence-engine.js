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
  if (index === -1) throw new Error(`Phase 12.2 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.2 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/event-intelligence-engine-v122.js', template('event-intelligence-engine-v122.js'));
  write('dashboard/newsroom-v122.js', template('newsroom-dashboard-v122.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('event-intelligence-db-tables-v122.txt')}\n`,
    'Event Intelligence tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const axios = require('axios');\n",
    "const axios = require('axios');\nconst { EventIntelligenceEngineV122 } = require('./event-intelligence-engine-v122');\n",
    'Event Intelligence import into Global News Radar'
  );
  s = replaceOnce(
    s,
    "    this.activeScan = null;\n",
    "    this.activeScan = null;\n    this.eventIntelligence = options.eventIntelligence || (this.db ? new EventIntelligenceEngineV122(this.db, { logger: this.logger }) : null);\n",
    'Event Intelligence service initialization'
  );

  const oldLoop = [
    "      const previous = this.findPreviousCluster(raw, previousRows);",
    "      const cluster = await this.persistCluster(raw, scanId, previous);",
    "      const decision = await this.persistDecision(cluster, scanId, previous);",
    "      let promotion = null;",
    "      if (autoPromote && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try { promotion = await this.promoteDecision(decision.id); }",
    "        catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion });",
    "      decisions.push(decision);"
  ].join('\n');
  const newLoop = [
    "      const previous = this.findPreviousCluster(raw, previousRows);",
    "      const cluster = await this.persistCluster(raw, scanId, previous);",
    "      let event = null;",
    "      if (this.eventIntelligence) {",
    "        try {",
    "          event = await this.eventIntelligence.analyzeCluster(cluster, { scanId });",
    "          if (event?.materialChange) cluster.materialChange = event.materialChange;",
    "          if (event) cluster.event = event;",
    "        } catch (error) {",
    "          this.logger.warn(`Event Intelligence could not resolve cluster ${cluster.id}: ${error.message}`);",
    "        }",
    "      }",
    "      const decisionPrevious = event?.previousAssigned ? { ...(previous || {}), status: 'assigned' } : previous;",
    "      const decision = await this.persistDecision(cluster, scanId, decisionPrevious);",
    "      let promotion = null;",
    "      if (autoPromote && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try {",
    "          promotion = await this.promoteDecision(decision.id);",
    "          if (event?.id && promotion && this.eventIntelligence) await this.eventIntelligence.recordAssignment(event.id, decision.id, promotion);",
    "        } catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion, event });",
    "      decisions.push(decision);"
  ].join('\n');
  s = replaceOnce(s, oldLoop, newLoop, 'resolve stable event before autonomous editor decision');

  s = replaceOnce(
    s,
    "      decision: cluster.decision || null,\n      promotion: cluster.promotion || null\n",
    "      decision: cluster.decision || null,\n      promotion: cluster.promotion || null,\n      event: cluster.event || null\n",
    'serialize Event Intelligence result with scan clusters'
  );
  s = replaceOnce(
    s,
    "    if (!this.db) return { config: this.getConfig(), latestScan: null, clusters: [], decisions: [] };\n",
    "    if (!this.db) return { config: this.getConfig(), latestScan: null, clusters: [], decisions: [], events: [], eventIntelligence: this.eventIntelligence?.getConfig?.() || null };\n",
    'status without persistence includes Event Intelligence state'
  );
  s = replaceOnce(
    s,
    "    const decisions = await this.listDecisions(30);\n    return { config: this.getConfig(), latestScan: latest, clusters, decisions };\n",
    "    const decisions = await this.listDecisions(30);\n    const events = this.eventIntelligence ? await this.eventIntelligence.listEvents(30) : [];\n    return { config: this.getConfig(), latestScan: latest, clusters, decisions, events, eventIntelligence: this.eventIntelligence?.getConfig?.() || null };\n",
    'status includes persistent Event Intelligence events'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/events', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.eventIntelligence;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Event Intelligence Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.listEvents(req.query.limit || 50, req.query.status || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/events/:eventId', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.eventIntelligence;",
    "        const result = engine ? await engine.getEvent(req.params.eventId) : null;",
    "        return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Newsroom event not found' });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/events/:eventId/timeline', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.eventIntelligence;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Event Intelligence Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.listTimeline(req.params.eventId, req.query.limit || 100) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/events/:eventId/relations', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.eventIntelligence;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Event Intelligence Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.listRelations(req.params.eventId) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/events/:eventId/validate', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.eventIntelligence;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Event Intelligence Engine unavailable' });",
    "        const result = await engine.validateEvent(req.params.eventId);",
    "        return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : 'event_intelligence_validation_failed' });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Event Intelligence protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panels = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">EVENT INTELLIGENCE</p><h2>Persistent events</h2></div></div><div id="newsroom-events" class="card-list"></div></article>\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">EVENT MEMORY</p><h2>Evolution timeline</h2></div></div><div id="newsroom-event-detail" class="activity-list"><div class="empty">Select an event to inspect revisions and related events.</div></div></article>\n        </div>\n`;
  html = insertBefore(
    html,
    '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.',
    panels,
    'Event Intelligence dashboard panels'
  );
  html = replaceOnce(
    html,
    '  <script src="/newsroom-v121.js" defer></script>',
    '  <script src="/newsroom-v122.js" defer></script>',
    'Event Intelligence newsroom dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:event-intelligence'] = 'node ../bootstrap/verify-phase12-event-intelligence-engine.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_EVENT_INTELLIGENCE_ENABLED=')) {
    env += `\n# Phase 12.2 — Event Intelligence Engine.\nNEWSROOM_EVENT_INTELLIGENCE_ENABLED=true\n# Cross-language event identity threshold. Ambiguous matches fail closed and create a separate event.\nNEWSROOM_EVENT_MATCH_THRESHOLD=0.62\nNEWSROOM_EVENT_AMBIGUITY_MARGIN=0.08\n# Events outside this recency window are not silently merged with new coverage.\nNEWSROOM_EVENT_RECENT_DAYS=14\n# Distinct events may be linked as related/follow-up only; causal relations are never inferred.\nNEWSROOM_EVENT_RELATION_THRESHOLD=0.44\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.2 ativa: Event Intelligence Engine com identidade persistente, normalizacao multilingue, revisoes append-only, evolucao material e relacoes nao-causais.');
