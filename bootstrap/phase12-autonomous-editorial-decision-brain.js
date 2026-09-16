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
  if (index === -1) throw new Error(`Phase 12.3 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.3 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/autonomous-editorial-decision-brain-v123.js', template('autonomous-editorial-decision-brain-v123.js'));
  write('dashboard/newsroom-editor-v123.js', template('autonomous-editorial-decision-brain-dashboard-v123.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('autonomous-editorial-decision-brain-db-tables-v123.txt')}\n`,
    'Autonomous Editorial Brain tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const { EventIntelligenceEngineV122 } = require('./event-intelligence-engine-v122');\n",
    "const { EventIntelligenceEngineV122 } = require('./event-intelligence-engine-v122');\nconst { EditorialDecisionBrainV123 } = require('./autonomous-editorial-decision-brain-v123');\n",
    'editorial brain import'
  );
  s = replaceOnce(
    s,
    "    this.eventIntelligence = options.eventIntelligence || (this.db ? new EventIntelligenceEngineV122(this.db, { logger: this.logger }) : null);\n",
    "    this.eventIntelligence = options.eventIntelligence || (this.db ? new EventIntelligenceEngineV122(this.db, { logger: this.logger }) : null);\n    this.editorialBrain = options.editorialBrain || new EditorialDecisionBrainV123(this.db, { logger: this.logger, policy: options.editorialPolicy });\n",
    'editorial brain initialization'
  );
  s = replaceOnce(
    s,
    "  async persistDecision(cluster, scanId, previous) {\n    const decision = editorDecision(cluster, previous, {\n",
    "  async persistDecision(cluster, scanId, previous, editorialBrainDecision = null) {\n    const decision = editorialBrainDecision ? {\n      action: editorialBrainDecision.legacyAction || 'WAIT',\n      rationale: editorialBrainDecision.rationale,\n      scores: cluster.scores || {},\n      materialChange: cluster.materialChange || null,\n      editorialBrain: editorialBrainDecision\n    } : editorDecision(cluster, previous, {\n",
    'legacy decision persistence accepts brain decision'
  );
  s = replaceOnce(
    s,
    "    const fingerprint = hash(`${cluster.id}:${decision.action}:${cluster.materialFingerprint}:${VERSION}`).slice(0, 32);\n",
    "    const brainFingerprint = editorialBrainDecision?.fingerprint || editorialBrainDecision?.id || '';\n    const fingerprint = hash(`${cluster.id}:${decision.action}:${cluster.materialFingerprint}:${VERSION}:${brainFingerprint}`).slice(0, 32);\n",
    'legacy decision fingerprint binds editorial brain decision'
  );

  const oldLoop = [
    "    const finalClusters = [];",
    "    const decisions = [];",
    "    for (const raw of rawClusters) {",
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
    "      decisions.push(decision);",
    "    }"
  ].join('\n');

  const newLoop = [
    "    const editorialCandidates = [];",
    "    for (const raw of rawClusters) {",
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
    "      editorialCandidates.push({ cluster, event, previous, previousAssigned: Boolean(event?.previousAssigned) });",
    "    }",
    "    const editorialPlan = this.editorialBrain ? await this.editorialBrain.planScan(editorialCandidates, { scanId }) : null;",
    "    const brainByCluster = new Map((editorialPlan?.decisions || []).map(item => [item.clusterId, item]));",
    "    const finalClusters = [];",
    "    const decisions = [];",
    "    for (const candidate of editorialCandidates) {",
    "      const { cluster, event, previous } = candidate;",
    "      const decisionPrevious = event?.previousAssigned ? { ...(previous || {}), status: 'assigned' } : previous;",
    "      const brainDecision = brainByCluster.get(cluster.id) || null;",
    "      const decision = await this.persistDecision(cluster, scanId, decisionPrevious, brainDecision);",
    "      let promotion = null;",
    "      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;",
    "      if (autoPromote && selectedByBrain && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try {",
    "          promotion = await this.promoteDecision(decision.id);",
    "          if (event?.id && promotion && this.eventIntelligence) await this.eventIntelligence.recordAssignment(event.id, decision.id, promotion);",
    "        } catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion, event, editorialBrainDecision: brainDecision });",
    "      decisions.push(decision);",
    "    }"
  ].join('\n');
  s = replaceOnce(s, oldLoop, newLoop, 'competitive editorial planning before promotion');

  s = replaceOnce(
    s,
    "      autoPromote\n    };\n",
    "      autoPromote,\n      editorialPlan: editorialPlan ? { id: editorialPlan.id, version: editorialPlan.version, selectedCount: editorialPlan.selectedCount, cooldownActive: editorialPlan.cooldownActive, nextEligibleAt: editorialPlan.nextEligibleAt, policyRevision: editorialPlan.policyRevision } : null\n    };\n",
    'scan result exposes editorial plan summary'
  );
  s = replaceOnce(
    s,
    "      event: cluster.event || null\n",
    "      event: cluster.event || null,\n      editorialBrainDecision: cluster.editorialBrainDecision || null\n",
    'serialized cluster exposes brain decision'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/editor/status', protect, async (_req, res) => {",
    "      try {",
    "        const brain = this.globalNewsRadarService?.editorialBrain;",
    "        if (!brain) return res.status(503).json({ success: false, error: 'Editorial Decision Brain unavailable' });",
    "        return res.json({ success: true, result: await brain.status() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/editor/decisions', protect, async (req, res) => {",
    "      try {",
    "        const brain = this.globalNewsRadarService?.editorialBrain;",
    "        if (!brain) return res.status(503).json({ success: false, error: 'Editorial Decision Brain unavailable' });",
    "        return res.json({ success: true, result: await brain.listDecisions(req.query.limit || 100, req.query.action || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/editor/policy', protect, async (_req, res) => {",
    "      try {",
    "        const brain = this.globalNewsRadarService?.editorialBrain;",
    "        if (!brain) return res.status(503).json({ success: false, error: 'Editorial Decision Brain unavailable' });",
    "        return res.json({ success: true, result: await brain.getPolicy() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/editor/policy', protect, async (req, res) => {",
    "      try {",
    "        const brain = this.globalNewsRadarService?.editorialBrain;",
    "        if (!brain) return res.status(503).json({ success: false, error: 'Editorial Decision Brain unavailable' });",
    "        const actor = req.body?.actor || req.user?.email || req.user?.name || 'operator';",
    "        const result = await brain.setPolicy(req.body?.policy || {}, actor, req.body?.reason || '');",
    "        return res.status(201).json({ success: true, result });",
    "      } catch (error) { return res.status(error.code === 'editorial_policy_reason_required' ? 400 : 500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'editorial brain protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">EDITORIAL BRAIN 12.3</p><h2>Autonomous decision memory</h2></div></div><div id="newsroom-editorial-brain" class="activity-list"><div class="empty">Run a world scan to create an editorial plan.</div></div></article>\n        </div>\n`;
  html = insertBefore(
    html,
    '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.',
    panel,
    'editorial brain dashboard panel'
  );
  html = replaceOnce(
    html,
    '  <script src="/newsroom-v122.js" defer></script>\n',
    '  <script src="/newsroom-v122.js" defer></script>\n  <script src="/newsroom-editor-v123.js" defer></script>\n',
    'editorial brain dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:autonomous-editorial-brain'] = 'node ../bootstrap/verify-phase12-autonomous-editorial-decision-brain.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_EDITORIAL_BRAIN_ENABLED=')) {
    env += `\n# Phase 12.3 — Autonomous Editorial Decision Brain.\nNEWSROOM_EDITORIAL_BRAIN_ENABLED=true\n# Normal editorial cadence: one selected story every two hours. The radar can still scan every 10 minutes.\nNEWSROOM_EDITORIAL_TARGET_CADENCE_MINUTES=120\nNEWSROOM_EDITORIAL_MAX_SELECTIONS_PER_SCAN=1\nNEWSROOM_EDITORIAL_MIN_INDEPENDENT_SOURCES=3\nNEWSROOM_EDITORIAL_MIN_CONFIDENCE=58\n# Higher evidence floor for sensitive/high-impact coverage.\nNEWSROOM_EDITORIAL_SENSITIVE_MIN_SOURCES=4\nNEWSROOM_EDITORIAL_SENSITIVE_MIN_CONFIDENCE=72\nNEWSROOM_EDITORIAL_COVER_THRESHOLD=65\nNEWSROOM_EDITORIAL_BREAKING_THRESHOLD=88\n# A sufficiently strong breaking story may pre-empt the normal two-hour cooldown.\nNEWSROOM_EDITORIAL_BREAKING_COOLDOWN_OVERRIDE=true\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.3 ativa: Autonomous Editorial Decision Brain com missao versionada, ranking competitivo, cadence de 120 minutos, diversidade, gates de evidencia e breaking override auditavel.');
