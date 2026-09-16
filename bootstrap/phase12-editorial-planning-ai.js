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
  if (index === -1) throw new Error(`Phase 12.5 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/editorial-planning-ai-v125.js', template('editorial-planning-ai-v125.js'));
  write('dashboard/newsroom-planning-v125.js', template('editorial-planning-ai-dashboard-v125.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('editorial-planning-ai-db-tables-v125.txt')}\n`,
    'Editorial Planning AI tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const { GlobalImportanceEngineV124 } = require('./global-importance-engine-v124');\n",
    "const { GlobalImportanceEngineV124 } = require('./global-importance-engine-v124');\nconst { EditorialPlanningAIV125 } = require('./editorial-planning-ai-v125');\n",
    'Editorial Planning AI import'
  );
  s = replaceOnce(
    s,
    "    this.globalImportance = options.globalImportance || new GlobalImportanceEngineV124(this.db, { logger: this.logger, policy: options.importancePolicy });\n",
    "    this.globalImportance = options.globalImportance || new GlobalImportanceEngineV124(this.db, { logger: this.logger, policy: options.importancePolicy });\n    this.editorialPlanner = options.editorialPlanner || new EditorialPlanningAIV125(this.db, { logger: this.logger, policy: options.planningPolicy });\n",
    'Editorial Planning AI initialization'
  );

  s = replaceOnce(
    s,
    "  async promoteDecision(decisionId) {\n",
    "  async promoteDecision(decisionId, editorialPlan = null) {\n",
    'promotion accepts editorial plan'
  );
  s = replaceOnce(
    s,
    "    const topic = this.assignmentTopic(cluster, decision.action);\n",
    "    const topic = clean(editorialPlan?.topic || this.assignmentTopic(cluster, decision.action), 200);\n    const angle = clean(editorialPlan?.angle || this.assignmentAngle(decision.action), 1600);\n    const assignmentFormat = clean(editorialPlan?.format || 'explainer', 80);\n",
    'promotion uses planned topic angle and format'
  );
  s = replaceOnce(
    s,
    "        angle: this.assignmentAngle(decision.action),\n",
    "        angle,\n",
    'content idea uses planned angle'
  );
  s = replaceOnce(
    s,
    "        rationale: `${decision.rationale} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    'content idea retains planning rationale and downstream factual gate'
  );
  s = replaceOnce(
    s,
    "      [assignmentId, decision.id, cluster.id, idea.id, decision.action, topic, this.assignmentAngle(decision.action), 'explainer', JSON.stringify(cluster.articles.map(item => item.url)), JSON.stringify(cluster.sourceKeys || [])]\n",
    "      [assignmentId, decision.id, cluster.id, idea.id, decision.action, topic, angle, assignmentFormat, JSON.stringify(cluster.articles.map(item => item.url)), JSON.stringify(cluster.sourceKeys || [])]\n",
    'assignment persists planned format'
  );

  const oldSelection = [
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
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision });"
  ].join('\n');

  const newSelection = [
    "      const brainDecision = brainByCluster.get(cluster.id) || null;",
    "      const decision = await this.persistDecision(cluster, scanId, decisionPrevious, brainDecision);",
    "      let promotion = null;",
    "      let editorialPlan = null;",
    "      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;",
    "      if (selectedByBrain && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action) && this.editorialPlanner) {",
    "        try {",
    "          editorialPlan = await this.editorialPlanner.createPlan({ cluster, event, importance: candidate.importance || null }, brainDecision, decision, { scanId });",
    "        } catch (error) {",
    "          this.logger.warn(`Editorial Planning AI could not plan decision ${decision.id}: ${error.message}`);",
    "        }",
    "      }",
    "      if (autoPromote && selectedByBrain && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try {",
    "          promotion = await this.promoteDecision(decision.id, editorialPlan);",
    "          if (editorialPlan?.id && promotion && this.editorialPlanner) await this.editorialPlanner.linkPromotion(editorialPlan.id, promotion);",
    "          if (event?.id && promotion && this.eventIntelligence) await this.eventIntelligence.recordAssignment(event.id, decision.id, promotion);",
    "        } catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan });"
  ].join('\n');
  s = replaceOnce(s, oldSelection, newSelection, 'selected story receives editorial plan before backlog promotion');

  s = replaceOnce(
    s,
    "      importanceAssessment: cluster.importanceAssessment || cluster.importance || null,\n      editorialBrainDecision: cluster.editorialBrainDecision || null\n",
    "      importanceAssessment: cluster.importanceAssessment || cluster.importance || null,\n      editorialBrainDecision: cluster.editorialBrainDecision || null,\n      editorialPlan: cluster.editorialPlan || null\n",
    'serialized cluster exposes Editorial Planning AI plan'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/planning/status', protect, async (_req, res) => {",
    "      try {",
    "        const planner = this.globalNewsRadarService?.editorialPlanner;",
    "        if (!planner) return res.status(503).json({ success: false, error: 'Editorial Planning AI unavailable' });",
    "        return res.json({ success: true, result: await planner.status() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/planning/plans', protect, async (req, res) => {",
    "      try {",
    "        const planner = this.globalNewsRadarService?.editorialPlanner;",
    "        if (!planner) return res.status(503).json({ success: false, error: 'Editorial Planning AI unavailable' });",
    "        return res.json({ success: true, result: await planner.listPlans(req.query.limit || 100, req.query.format || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/planning/plans/:planId', protect, async (req, res) => {",
    "      try {",
    "        const planner = this.globalNewsRadarService?.editorialPlanner;",
    "        const result = planner ? await planner.getPlan(req.params.planId) : null;",
    "        return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Editorial plan not found' });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/planning/policy', protect, async (_req, res) => {",
    "      try {",
    "        const planner = this.globalNewsRadarService?.editorialPlanner;",
    "        if (!planner) return res.status(503).json({ success: false, error: 'Editorial Planning AI unavailable' });",
    "        return res.json({ success: true, result: await planner.getPolicy() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/planning/policy', protect, async (req, res) => {",
    "      try {",
    "        const planner = this.globalNewsRadarService?.editorialPlanner;",
    "        if (!planner) return res.status(503).json({ success: false, error: 'Editorial Planning AI unavailable' });",
    "        const actor = req.body?.actor || req.user?.email || req.user?.name || 'operator';",
    "        const result = await planner.setPolicy(req.body?.policy || {}, actor, req.body?.reason || '');",
    "        return res.status(201).json({ success: true, result });",
    "      } catch (error) { return res.status(error.code === 'editorial_planning_policy_reason_required' ? 400 : 500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Editorial Planning AI protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">EDITORIAL PLANNING AI 12.5</p><h2>Production plan</h2></div></div><div id="newsroom-editorial-planning" class="activity-list"><div class="empty">The selected story will receive a research, format, duration and visual plan here.</div></div></article>\n        </div>\n`;
  html = insertBefore(
    html,
    '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.',
    panel,
    'Editorial Planning AI dashboard panel'
  );
  html = replaceOnce(
    html,
    '  <script src="/newsroom-importance-v124.js" defer></script>\n',
    '  <script src="/newsroom-importance-v124.js" defer></script>\n  <script src="/newsroom-planning-v125.js" defer></script>\n',
    'Editorial Planning AI dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:editorial-planning'] = 'node ../bootstrap/verify-phase12-editorial-planning-ai.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_EDITORIAL_PLANNING_ENABLED=')) {
    env += `\n# Phase 12.5 — Editorial Planning AI.\nNEWSROOM_EDITORIAL_PLANNING_ENABLED=true\nNEWSROOM_PLANNING_DEEP_DIVE_IMPORTANCE=78\nNEWSROOM_PLANNING_RAPID_VELOCITY=80\nNEWSROOM_PLANNING_ORDINARY_MIN_SOURCES=3\nNEWSROOM_PLANNING_SENSITIVE_MIN_SOURCES=5\nNEWSROOM_PLANNING_BREAKING_MINUTES=4\nNEWSROOM_PLANNING_STANDARD_MINUTES=8\nNEWSROOM_PLANNING_DEEP_DIVE_MINUTES=12\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.5 ativa: Editorial Planning AI converte a pauta selecionada em plano auditavel de formato, duracao, pesquisa, fontes, visuais e handoff sem contornar gates factuais.');
