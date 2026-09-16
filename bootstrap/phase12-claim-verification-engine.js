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
  write('utils/claim-verification-engine-v127.js', template('claim-verification-engine-v127.js'));
  write('dashboard/newsroom-claims-v127.js', template('claim-verification-dashboard-v127.js'));
}
function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('claim-verification-db-tables-v127.txt')}\n`, 'Evidence / Truth tables');
  write('database/db.js', s);
}
function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(s,
    "const { AutonomousResearchV126 } = require('./autonomous-research-v126');\n",
    "const { AutonomousResearchV126 } = require('./autonomous-research-v126');\nconst { EvidenceTruthEngineV127 } = require('./claim-verification-engine-v127');\n",
    'Evidence / Truth import');
  s = replaceOnce(s,
    "    this.autonomousResearch = options.autonomousResearch || new AutonomousResearchV126(this.db, { logger: this.logger, policy: options.researchPolicy });\n",
    "    this.autonomousResearch = options.autonomousResearch || new AutonomousResearchV126(this.db, { logger: this.logger, policy: options.researchPolicy });\n    this.claimVerification = options.claimVerification || new EvidenceTruthEngineV127(this.db, { logger: this.logger, policy: options.claimPolicy });\n",
    'Evidence / Truth initialization');
  s = replaceOnce(s,
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null) {\n",
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null, claimPacket = null) {\n",
    'promotion receives truth packet');
  s = replaceOnce(s,
    "    const assignmentSourceDomains = researchSources.length ? [...new Set(researchSources.map(source => { try { return new URL(source.url).hostname.toLowerCase().replace(/^www\\./, ''); } catch (_error) { return ''; } }).filter(Boolean))] : (cluster.sourceKeys || []);\n",
    "    const assignmentSourceDomains = researchSources.length ? [...new Set(researchSources.map(source => { try { return new URL(source.url).hostname.toLowerCase().replace(/^www\\./, ''); } catch (_error) { return ''; } }).filter(Boolean))] : (cluster.sourceKeys || []);\n    const claimSummary = claimPacket ? ` Evidence/Truth ${claimPacket.status}: ${Number(claimPacket.classificationCounts?.confirmed || 0)}/${claimPacket.claimCount} confirmed; ${claimPacket.unresolvedCount || 0} unresolved; ${claimPacket.blockingCount || 0} blocking; confidence ${claimPacket.confidenceScore}/100.` : '';\n",
    'promotion truth summary');
  s = replaceOnce(s,
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''}${claimSummary} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    'backlog rationale exposes truth summary');

  const oldBlock = [
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
  const newBlock = [
    "      let autonomousResearch = null;",
    "      let claimVerification = null;",
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
    "      if (autonomousResearch?.status === 'EVIDENCE_READY' && this.claimVerification?.getConfig()?.enabled) {",
    "        try {",
    "          claimVerification = await this.claimVerification.verifyResearch({ candidate: { cluster, event, importance: candidate.importance || null }, editorialPlan, autonomousResearch, brainDecision, decision, scanId });",
    "        } catch (error) {",
    "          this.logger.warn(`Evidence / Truth Engine could not verify research ${autonomousResearch.id}: ${error.message}`);",
    "        }",
    "      }",
    "      const researchGatePassed = !this.autonomousResearch?.getConfig()?.enabled || autonomousResearch?.status === 'EVIDENCE_READY';",
    "      const claimGatePassed = !this.claimVerification?.getConfig()?.enabled || claimVerification?.status === 'VERIFIED';",
    "      if (autoPromote && selectedByBrain && researchGatePassed && claimGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {",
    "        try {",
    "          promotion = claimVerification ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification) : (autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan));",
    "          if (editorialPlan?.id && promotion && this.editorialPlanner) await this.editorialPlanner.linkPromotion(editorialPlan.id, promotion);",
    "          if (autonomousResearch?.id && promotion && this.autonomousResearch) await this.autonomousResearch.linkPromotion(autonomousResearch.id, promotion);",
    "          if (event?.id && promotion && this.eventIntelligence) await this.eventIntelligence.recordAssignment(event.id, decision.id, promotion);",
    "        } catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }",
    "      }",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch, claimVerification });"
  ].join('\n');
  s = replaceOnce(s, oldBlock, newBlock, 'Evidence / Truth gate before promotion');
  s = replaceOnce(s,
    "      autonomousResearch: cluster.autonomousResearch || null\n",
    "      autonomousResearch: cluster.autonomousResearch || null,\n      claimVerification: cluster.claimVerification || null\n",
    'serialized cluster exposes truth packet');
  write('utils/global-news-radar-v121.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/claims/status', protect, async (_req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.claimVerification;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Evidence / Truth Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.status() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/claims/packets', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.claimVerification;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Evidence / Truth Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.listPackets(req.query.limit || 100, req.query.status || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/claims/packets/:packetId', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.claimVerification;",
    "        const result = engine ? await engine.getPacket(req.params.packetId) : null;",
    "        return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Evidence / Truth packet not found' });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Evidence / Truth API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">EVIDENCE / TRUTH 12.7</p><h2>Claim truth state</h2></div></div><div id="newsroom-claim-verification" class="activity-list"><div class="empty">Evidence-ready research will be classified as confirmed, reported, claimed, disputed, unverified, false or unknown.</div></div></article>\n        </div>\n`;
  html = insertBefore(html, '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.', panel, 'Evidence / Truth dashboard panel');
  html = replaceOnce(html, '  <script src="/newsroom-research-v126.js" defer></script>\n', '  <script src="/newsroom-research-v126.js" defer></script>\n  <script src="/newsroom-claims-v127.js" defer></script>\n', 'Evidence / Truth dashboard script');
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:claim-verification'] = 'node ../bootstrap/verify-phase12-claim-verification-engine.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('NEWSROOM_CLAIM_VERIFICATION_ENABLED=')) {
    env += `\n# Phase 12.7 — Evidence / Truth Engine.\nNEWSROOM_CLAIM_VERIFICATION_ENABLED=true\nNEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS=2\nNEWSROOM_CLAIM_MIN_TOKEN_COVERAGE=0.22\nNEWSROOM_CLAIM_MIN_CONFIDENCE=62\nNEWSROOM_CLAIM_UNRESOLVED_RATIO=0.01\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.7 ativa: Evidence / Truth Engine separa confirmed/reported/claimed/disputed/unverified/false/unknown e so libera auto-promocao quando todas as claims obrigatorias estao confirmed.');
