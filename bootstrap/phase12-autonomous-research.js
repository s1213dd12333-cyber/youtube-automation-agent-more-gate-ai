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
  if (index === -1) throw new Error(`Phase 12.6 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.6 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/autonomous-research-v126.js', template('autonomous-research-v126.js'));
  write('dashboard/newsroom-research-v126.js', template('autonomous-research-dashboard-v126.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('autonomous-research-db-tables-v126.txt')}\n`,
    'Autonomous Research tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const { EditorialPlanningAIV125 } = require('./editorial-planning-ai-v125');\n",
    "const { EditorialPlanningAIV125 } = require('./editorial-planning-ai-v125');\nconst { AutonomousResearchV126 } = require('./autonomous-research-v126');\n",
    'Autonomous Research import'
  );
  s = replaceOnce(
    s,
    "    this.editorialPlanner = options.editorialPlanner || new EditorialPlanningAIV125(this.db, { logger: this.logger, policy: options.planningPolicy });\n",
    "    this.editorialPlanner = options.editorialPlanner || new EditorialPlanningAIV125(this.db, { logger: this.logger, policy: options.planningPolicy });\n    this.autonomousResearch = options.autonomousResearch || new AutonomousResearchV126(this.db, { logger: this.logger, policy: options.researchPolicy });\n",
    'Autonomous Research initialization'
  );

  s = replaceOnce(
    s,
    "  async promoteDecision(decisionId, editorialPlan = null) {\n",
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null) {\n",
    'promotion receives research run'
  );
  s = replaceOnce(
    s,
    "    const assignmentFormat = clean(editorialPlan?.format || 'explainer', 80);\n",
    "    const assignmentFormat = clean(editorialPlan?.format || 'explainer', 80);\n    const researchSources = Array.isArray(researchRun?.sources) ? researchRun.sources.filter(source => source?.status === 'verified' && source?.url) : [];\n    const assignmentSourceUrls = researchSources.length ? researchSources.map(source => source.url) : cluster.articles.map(item => item.url);\n    const assignmentSourceDomains = researchSources.length ? [...new Set(researchSources.map(source => { try { return new URL(source.url).hostname.toLowerCase().replace(/^www\\./, ''); } catch (_error) { return ''; } }).filter(Boolean))] : (cluster.sourceKeys || []);\n",
    'promotion uses autonomous research evidence sources'
  );
  s = replaceOnce(
    s,
    "      [assignmentId, decision.id, cluster.id, idea.id, decision.action, topic, angle, assignmentFormat, JSON.stringify(cluster.articles.map(item => item.url)), JSON.stringify(cluster.sourceKeys || [])]\n",
    "      [assignmentId, decision.id, cluster.id, idea.id, decision.action, topic, angle, assignmentFormat, JSON.stringify(assignmentSourceUrls), JSON.stringify(assignmentSourceDomains)]\n",
    'assignment receives verified research URLs'
  );

  const oldSelection = [
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

  const newSelection = [
    "      const brainDecision = brainByCluster.get(cluster.id) || null;",
    "      const decision = await this.persistDecision(cluster, scanId, decisionPrevious, brainDecision);",
    "      let promotion = null;",
    "      let editorialPlan = null;",
    "      let autonomousResearch = null;",
    "      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;",
    "      if (selectedByBrain && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action) && this.editorialPlanner) {",
    "        try {",
    "          editorialPlan = await this.editorialPlanner.createPlan({ cluster, event, importance: candidate.importance || null }, brainDecision, decision, { scanId });",
    "        } catch (error) {",
    "          this.logger.warn(`Editorial Planning AI could not plan decision ${decision.id}: ${error.message}`);",
    "        }",
    "      }",
    "      if (editorialPlan?.id && this.autonomousResearch?.getConfig()?.enabled) {",
    "        try {",
    "          autonomousResearch = await this.autonomousResearch.researchSelected({ candidate: { cluster, event, importance: candidate.importance || null }, editorialPlan, brainDecision, decision, scanId });",
    "        } catch (error) {",
    "          this.logger.warn(`Autonomous Research could not complete plan ${editorialPlan.id}: ${error.message}`);",
    "        }",
    "      }",
    "      const researchGatePassed = !this.autonomousResearch?.getConfig()?.enabled || autonomousResearch?.status === 'EVIDENCE_READY';",
    "      if (autoPromote && selectedByBrain && researchGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try {",
    "          promotion = autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan);",
    "          if (editorialPlan?.id && promotion && this.editorialPlanner) await this.editorialPlanner.linkPromotion(editorialPlan.id, promotion);",
    "          if (autonomousResearch?.id && promotion && this.autonomousResearch) await this.autonomousResearch.linkPromotion(autonomousResearch.id, promotion);",
    "          if (event?.id && promotion && this.eventIntelligence) await this.eventIntelligence.recordAssignment(event.id, decision.id, promotion);",
    "        } catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch });"
  ].join('\n');
  s = replaceOnce(s, oldSelection, newSelection, 'selected story runs autonomous evidence acquisition before promotion');

  s = replaceOnce(
    s,
    "      editorialBrainDecision: cluster.editorialBrainDecision || null,\n      editorialPlan: cluster.editorialPlan || null\n",
    "      editorialBrainDecision: cluster.editorialBrainDecision || null,\n      editorialPlan: cluster.editorialPlan || null,\n      autonomousResearch: cluster.autonomousResearch || null\n",
    'serialized cluster exposes autonomous research result'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/research/status', protect, async (_req, res) => {",
    "      try {",
    "        const research = this.globalNewsRadarService?.autonomousResearch;",
    "        if (!research) return res.status(503).json({ success: false, error: 'Autonomous Research unavailable' });",
    "        return res.json({ success: true, result: await research.status() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/research/runs', protect, async (req, res) => {",
    "      try {",
    "        const research = this.globalNewsRadarService?.autonomousResearch;",
    "        if (!research) return res.status(503).json({ success: false, error: 'Autonomous Research unavailable' });",
    "        return res.json({ success: true, result: await research.listRuns(req.query.limit || 100, req.query.status || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/research/runs/:runId', protect, async (req, res) => {",
    "      try {",
    "        const research = this.globalNewsRadarService?.autonomousResearch;",
    "        const result = research ? await research.getRun(req.params.runId) : null;",
    "        return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Autonomous research run not found' });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/research/policy', protect, async (_req, res) => {",
    "      try {",
    "        const research = this.globalNewsRadarService?.autonomousResearch;",
    "        if (!research) return res.status(503).json({ success: false, error: 'Autonomous Research unavailable' });",
    "        return res.json({ success: true, result: await research.getPolicy() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/research/policy', protect, async (req, res) => {",
    "      try {",
    "        const research = this.globalNewsRadarService?.autonomousResearch;",
    "        if (!research) return res.status(503).json({ success: false, error: 'Autonomous Research unavailable' });",
    "        const actor = req.body?.actor || req.user?.email || req.user?.name || 'operator';",
    "        const result = await research.setPolicy(req.body?.policy || {}, actor, req.body?.reason || '');",
    "        return res.status(201).json({ success: true, result });",
    "      } catch (error) { return res.status(error.code === 'autonomous_research_policy_reason_required' ? 400 : 500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Autonomous Research protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">AUTONOMOUS RESEARCH 12.6</p><h2>Evidence acquisition</h2></div></div><div id="newsroom-autonomous-research" class="activity-list"><div class="empty">A selected story will research itself until evidence is ready or the evidence gate blocks it.</div></div></article>\n        </div>\n`;
  html = insertBefore(
    html,
    '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.',
    panel,
    'Autonomous Research dashboard panel'
  );
  html = replaceOnce(
    html,
    '  <script src="/newsroom-planning-v125.js" defer></script>\n',
    '  <script src="/newsroom-planning-v125.js" defer></script>\n  <script src="/newsroom-research-v126.js" defer></script>\n',
    'Autonomous Research dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:autonomous-research'] = 'node ../bootstrap/verify-phase12-autonomous-research.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_AUTONOMOUS_RESEARCH_ENABLED=')) {
    env += `\n# Phase 12.6 — Autonomous Research / Evidence Acquisition.\nNEWSROOM_AUTONOMOUS_RESEARCH_ENABLED=true\nNEWSROOM_RESEARCH_MAX_ROUNDS=3\nNEWSROOM_RESEARCH_MAX_SOURCES=16\nNEWSROOM_RESEARCH_HTTP_TIMEOUT_MS=7000\nNEWSROOM_RESEARCH_MIN_EVIDENCE_CHARS=180\nNEWSROOM_RESEARCH_MIN_COVERAGE_RATIO=0.55\nNEWSROOM_RESEARCH_MIN_EVIDENCE_SCORE=62\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.6 ativa: Autonomous Research executa rodadas de busca/evidencia, mede lacunas e bloqueia promocao ate EVIDENCE_READY sem contornar Research/Provenance ou quality gates.');
