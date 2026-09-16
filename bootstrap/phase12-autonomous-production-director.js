'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');
const template = name => fs.readFileSync(path.join(root, 'bootstrap', 'templates', name), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
function replaceOnce(text, from, to, label) { if (text.includes(to)) return text; const i = text.indexOf(from); if (i < 0) throw new Error(`Phase 12.8 anchor not found: ${label}`); return text.slice(0, i) + to + text.slice(i + from.length); }
function insertBefore(text, anchor, block, label) { if (text.includes(block.trim())) return text; const i = text.indexOf(anchor); if (i < 0) throw new Error(`Phase 12.8 anchor not found: ${label}`); return text.slice(0, i) + block + text.slice(i); }

function copyRuntime() {
  write('utils/autonomous-production-director-v128.js', template('autonomous-production-director-v128.js'));
  write('dashboard/newsroom-production-director-v128.js', template('autonomous-production-director-dashboard-v128.js'));
}
function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('autonomous-production-director-db-tables-v128.txt')}\n`, 'production director tables');
  write('database/db.js', s);
}
function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(s,
    "const { EvidenceTruthEngineV127 } = require('./claim-verification-engine-v127');\n",
    "const { EvidenceTruthEngineV127 } = require('./claim-verification-engine-v127');\nconst { AutonomousProductionDirectorV128 } = require('./autonomous-production-director-v128');\n",
    'production director import');
  s = replaceOnce(s,
    "    this.claimVerification = options.claimVerification || new EvidenceTruthEngineV127(this.db, { logger: this.logger, policy: options.claimPolicy });\n",
    "    this.claimVerification = options.claimVerification || new EvidenceTruthEngineV127(this.db, { logger: this.logger, policy: options.claimPolicy });\n    this.productionDirector = options.productionDirector || new AutonomousProductionDirectorV128(this.db, { logger: this.logger, policy: options.productionPolicy });\n",
    'production director init');
  s = replaceOnce(s,
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null, claimPacket = null) {\n",
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null, claimPacket = null, productionDirective = null) {\n",
    'promotion receives production directive');
  s = replaceOnce(s,
    "    const claimSummary = claimPacket ? ` Evidence/Truth ${claimPacket.status}: ${Number(claimPacket.classificationCounts?.confirmed || 0)}/${claimPacket.claimCount} confirmed; ${claimPacket.unresolvedCount || 0} unresolved; ${claimPacket.blockingCount || 0} blocking; confidence ${claimPacket.confidenceScore}/100.` : '';\n",
    "    const claimSummary = claimPacket ? ` Evidence/Truth ${claimPacket.status}: ${Number(claimPacket.classificationCounts?.confirmed || 0)}/${claimPacket.claimCount} confirmed; ${claimPacket.unresolvedCount || 0} unresolved; ${claimPacket.blockingCount || 0} blocking; confidence ${claimPacket.confidenceScore}/100.` : '';\n    const productionSummary = productionDirective ? ` Production 12.8: ${productionDirective.mode}; ${productionDirective.visualStrategy}; ${productionDirective.providerTier}; ${productionDirective.sceneCount} scenes; budget cap $${Number(productionDirective.maxBudgetUsd || 0).toFixed(2)}.` : '';\n",
    'promotion production summary');
  s = replaceOnce(s,
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''}${claimSummary} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''}${claimSummary}${productionSummary} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    'backlog rationale production summary');

  s = replaceOnce(s,
    "      let claimVerification = null;\n      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;\n",
    "      let claimVerification = null;\n      let productionDirective = null;\n      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;\n",
    'production directive local');
  s = replaceOnce(s,
    "      const researchGatePassed = !this.autonomousResearch?.getConfig()?.enabled || autonomousResearch?.status === 'EVIDENCE_READY';\n      const claimGatePassed = !this.claimVerification?.getConfig()?.enabled || claimVerification?.status === 'VERIFIED';\n",
    "      if (claimVerification?.status === 'VERIFIED' && this.productionDirector?.getConfig()?.enabled) {\n        try {\n          productionDirective = await this.productionDirector.createDirective({ candidate: { cluster, event, importance: candidate.importance || null }, editorialPlan, claimVerification, autonomousResearch, brainDecision, decision, scanId, importance: candidate.importance || null });\n        } catch (error) {\n          this.logger.warn(`Autonomous Production Director could not plan decision ${decision.id}: ${error.message}`);\n        }\n      }\n      const researchGatePassed = !this.autonomousResearch?.getConfig()?.enabled || autonomousResearch?.status === 'EVIDENCE_READY';\n      const claimGatePassed = !this.claimVerification?.getConfig()?.enabled || claimVerification?.status === 'VERIFIED';\n      const productionGatePassed = !this.productionDirector?.getConfig()?.enabled || productionDirective?.status === 'PLAN_READY';\n",
    'production director creation and gate');
  s = replaceOnce(s,
    "      if (autoPromote && selectedByBrain && researchGatePassed && claimGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {\n",
    "      if (autoPromote && selectedByBrain && researchGatePassed && claimGatePassed && productionGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {\n",
    'production gate before promotion');
  s = replaceOnce(s,
    "          promotion = claimVerification ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification) : (autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan));\n",
    "          promotion = productionDirective ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification, productionDirective) : (claimVerification ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification) : (autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan)));\n",
    'promotion receives production directive while preserving 12.7 fallback');
  s = replaceOnce(s,
    "          if (autonomousResearch?.id && promotion && this.autonomousResearch) await this.autonomousResearch.linkPromotion(autonomousResearch.id, promotion);\n",
    "          if (autonomousResearch?.id && promotion && this.autonomousResearch) await this.autonomousResearch.linkPromotion(autonomousResearch.id, promotion);\n          if (productionDirective?.id && promotion && this.productionDirector) await this.productionDirector.linkPromotion(productionDirective.id, promotion);\n",
    'link production directive to assignment');
  s = replaceOnce(s,
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch, claimVerification });\n",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch, claimVerification, productionDirective });\n",
    'cluster exposes production directive');
  s = replaceOnce(s,
    "      claimVerification: cluster.claimVerification || null\n",
    "      claimVerification: cluster.claimVerification || null,\n      productionDirective: cluster.productionDirective || null\n",
    'serialized cluster exposes production directive');
  write('utils/global-news-radar-v121.js', s);
}
function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/production-director/status', protect, async (_req, res) => {",
    "      try { const director = this.globalNewsRadarService?.productionDirector; if (!director) return res.status(503).json({ success: false, error: 'Autonomous Production Director unavailable' }); return res.json({ success: true, result: await director.status() }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/production-director/directives', protect, async (req, res) => {",
    "      try { const director = this.globalNewsRadarService?.productionDirector; if (!director) return res.status(503).json({ success: false, error: 'Autonomous Production Director unavailable' }); return res.json({ success: true, result: await director.listDirectives(req.query.limit || 100) }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/production-director/directives/:directiveId', protect, async (req, res) => {",
    "      try { const director = this.globalNewsRadarService?.productionDirector; const result = director ? await director.getDirective(req.params.directiveId) : null; return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Production directive not found' }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'production director routes');
  write('index.js', s);
}
function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">AUTONOMOUS PRODUCTION 12.8</p><h2>Production director</h2></div></div><div id="newsroom-production-director" class="activity-list"><div class="empty">Verified stories will receive an auditable production directive here.</div></div></article>\n        </div>\n`;
  html = insertBefore(html, '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.', panel, 'production director panel');
  html = replaceOnce(html, '  <script src="/newsroom-claims-v127.js" defer></script>\n', '  <script src="/newsroom-claims-v127.js" defer></script>\n  <script src="/newsroom-production-director-v128.js" defer></script>\n', 'production director dashboard script');
  write('dashboard/index.html', html);
}
function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json')); pkg.scripts = pkg.scripts || {}; pkg.scripts['test:autonomous-production-director'] = 'node ../bootstrap/verify-phase12-autonomous-production-director.js'; write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('NEWSROOM_PRODUCTION_DIRECTOR_ENABLED=')) env += `\n# Phase 12.8 — Autonomous Production Director.\nNEWSROOM_PRODUCTION_DIRECTOR_ENABLED=true\nNEWSROOM_PRODUCTION_LOCAL_FIRST=true\nNEWSROOM_PRODUCTION_PREMIUM_BREAKING=true\nNEWSROOM_PRODUCTION_PREMIUM_IMPORTANCE=82\nNEWSROOM_PRODUCTION_PREMIUM_BREAKING_IMPORTANCE=72\nNEWSROOM_PRODUCTION_MAX_PREMIUM_USD=8\nNEWSROOM_PRODUCTION_STANDARD_BUDGET_USD=2\nNEWSROOM_PRODUCTION_BREAKING_BUDGET_USD=4\nNEWSROOM_PRODUCTION_DEEP_DIVE_BUDGET_USD=6\n`;
  write('.env.example', env);
}
copyRuntime(); patchDatabase(); patchRadar(); patchIndex(); patchDashboard(); patchPackageAndEnv();
console.log('FASE 12.8 ativa: Autonomous Production Director converte apenas pacotes VERIFIED em diretivas auditaveis de modo, cenas, visuais, TTS, provider tier e budget, preservando fact locks e gates downstream.');
