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
  if (index === -1) throw new Error(`Phase 12.7 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.7 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/evidence-synthesis-v127.js', template('evidence-synthesis-v127.js'));
  write('dashboard/newsroom-synthesis-v127.js', template('evidence-synthesis-dashboard-v127.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('evidence-synthesis-db-tables-v127.txt')}\n`,
    'Evidence Synthesis tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const { AutonomousResearchV126 } = require('./autonomous-research-v126');\n",
    "const { AutonomousResearchV126 } = require('./autonomous-research-v126');\nconst { EvidenceSynthesisV127 } = require('./evidence-synthesis-v127');\n",
    'Evidence Synthesis import'
  );
  s = replaceOnce(
    s,
    "    this.autonomousResearch = options.autonomousResearch || new AutonomousResearchV126(this.db, { logger: this.logger, policy: options.researchPolicy });\n",
    "    this.autonomousResearch = options.autonomousResearch || new AutonomousResearchV126(this.db, { logger: this.logger, policy: options.researchPolicy });\n    this.evidenceSynthesis = options.evidenceSynthesis || new EvidenceSynthesisV127(this.db, { logger: this.logger, policy: options.synthesisPolicy });\n",
    'Evidence Synthesis initialization'
  );
  s = replaceOnce(
    s,
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null) {\n",
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null, researchBrief = null) {\n",
    'promotion receives research brief'
  );
  s = replaceOnce(
    s,
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''}${researchBrief?.summary ? ` Research brief: ${researchBrief.summary}` : ''} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    'promotion carries research brief summary without bypassing downstream evidence gate'
  );

  const oldSelection = [
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

  const newSelection = [
    "      const brainDecision = brainByCluster.get(cluster.id) || null;",
    "      const decision = await this.persistDecision(cluster, scanId, decisionPrevious, brainDecision);",
    "      let promotion = null;",
    "      let editorialPlan = null;",
    "      let autonomousResearch = null;",
    "      let researchBrief = null;",
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
    "      if (researchGatePassed && autonomousResearch?.status === 'EVIDENCE_READY' && this.evidenceSynthesis?.getConfig()?.enabled) {",
    "        try {",
    "          researchBrief = await this.evidenceSynthesis.synthesize({ candidate: { cluster, event, importance: candidate.importance || null }, editorialPlan, researchRun: autonomousResearch, brainDecision, decision, scanId });",
    "        } catch (error) {",
    "          this.logger.warn(`Evidence Synthesis could not create brief for ${autonomousResearch.id}: ${error.message}`);",
    "        }",
    "      }",
    "      const synthesisGatePassed = !this.evidenceSynthesis?.getConfig()?.enabled || researchBrief?.status === 'SYNTHESIS_READY';",
    "      if (autoPromote && selectedByBrain && researchGatePassed && synthesisGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try {",
    "          promotion = researchBrief ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, researchBrief) : autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan);",
    "          if (editorialPlan?.id && promotion && this.editorialPlanner) await this.editorialPlanner.linkPromotion(editorialPlan.id, promotion);",
    "          if (autonomousResearch?.id && promotion && this.autonomousResearch) await this.autonomousResearch.linkPromotion(autonomousResearch.id, promotion);",
    "          if (researchBrief?.id && promotion && this.evidenceSynthesis) await this.evidenceSynthesis.linkPromotion(researchBrief.id, promotion);",
    "          if (event?.id && promotion && this.eventIntelligence) await this.eventIntelligence.recordAssignment(event.id, decision.id, promotion);",
    "        } catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch, researchBrief });"
  ].join('\n');

  s = replaceOnce(s, oldSelection, newSelection, 'Evidence Synthesis runs after EVIDENCE_READY and gates promotion');
  s = replaceOnce(
    s,
    "      editorialPlan: cluster.editorialPlan || null,\n      autonomousResearch: cluster.autonomousResearch || null\n",
    "      editorialPlan: cluster.editorialPlan || null,\n      autonomousResearch: cluster.autonomousResearch || null,\n      researchBrief: cluster.researchBrief || null\n",
    'serialized cluster exposes research brief'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/synthesis/status', protect, async (_req, res) => {",
    "      try {",
    "        const synthesis = this.globalNewsRadarService?.evidenceSynthesis;",
    "        if (!synthesis) return res.status(503).json({ success: false, error: 'Evidence Synthesis unavailable' });",
    "        return res.json({ success: true, result: await synthesis.status() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/synthesis/briefs', protect, async (req, res) => {",
    "      try {",
    "        const synthesis = this.globalNewsRadarService?.evidenceSynthesis;",
    "        if (!synthesis) return res.status(503).json({ success: false, error: 'Evidence Synthesis unavailable' });",
    "        return res.json({ success: true, result: await synthesis.listBriefs(req.query.limit || 100, req.query.status || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/synthesis/briefs/:briefId', protect, async (req, res) => {",
    "      try {",
    "        const synthesis = this.globalNewsRadarService?.evidenceSynthesis;",
    "        const result = synthesis ? await synthesis.getBrief(req.params.briefId) : null;",
    "        return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Research brief not found' });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/synthesis/policy', protect, async (_req, res) => {",
    "      try {",
    "        const synthesis = this.globalNewsRadarService?.evidenceSynthesis;",
    "        if (!synthesis) return res.status(503).json({ success: false, error: 'Evidence Synthesis unavailable' });",
    "        return res.json({ success: true, result: await synthesis.getPolicy() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/synthesis/policy', protect, async (req, res) => {",
    "      try {",
    "        const synthesis = this.globalNewsRadarService?.evidenceSynthesis;",
    "        if (!synthesis) return res.status(503).json({ success: false, error: 'Evidence Synthesis unavailable' });",
    "        const actor = req.body?.actor || req.user?.email || req.user?.name || 'operator';",
    "        const result = await synthesis.setPolicy(req.body?.policy || {}, actor, req.body?.reason || '');",
    "        return res.status(201).json({ success: true, result });",
    "      } catch (error) { return res.status(error.code === 'evidence_synthesis_policy_reason_required' ? 400 : 500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Evidence Synthesis protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">EVIDENCE SYNTHESIS 12.7</p><h2>Research brief</h2></div></div><div id="newsroom-evidence-synthesis" class="activity-list"><div class="empty">EVIDENCE_READY research will be converted into source-grounded claims, citations, uncertainty and contradiction checks.</div></div></article>\n        </div>\n`;
  html = insertBefore(html, '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.', panel, 'Evidence Synthesis dashboard panel');
  html = replaceOnce(
    html,
    '  <script src="/newsroom-research-v126.js" defer></script>\n',
    '  <script src="/newsroom-research-v126.js" defer></script>\n  <script src="/newsroom-synthesis-v127.js" defer></script>\n',
    'Evidence Synthesis dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:evidence-synthesis'] = 'node ../bootstrap/verify-phase12-evidence-synthesis.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_EVIDENCE_SYNTHESIS_ENABLED=')) {
    env += `\n# Phase 12.7 — Evidence Synthesis / Research Brief AI.\nNEWSROOM_EVIDENCE_SYNTHESIS_ENABLED=true\nNEWSROOM_SYNTHESIS_MAX_CLAIMS=16\nNEWSROOM_SYNTHESIS_MIN_CLAIMS=2\nNEWSROOM_SYNTHESIS_MIN_QUESTION_SUPPORT=0.60\nNEWSROOM_SYNTHESIS_MIN_CONFIDENCE=62\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.7 ativa: Evidence Synthesis transforma EVIDENCE_READY em Research Brief auditavel com claims source-grounded, citations, incertezas, contradicoes e gate SYNTHESIS_READY.');
