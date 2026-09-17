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
  if (index === -1) throw new Error(`Phase 12.9 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.9 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/autonomous-quality-council-v129.js', template('autonomous-quality-council-v129.js'));
  write('dashboard/newsroom-quality-council-v129.js', template('autonomous-quality-council-dashboard-v129.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('autonomous-quality-council-db-tables-v129.txt')}\n`,
    'Quality Council persistence tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const { AutonomousProductionDirectorV128 } = require('./autonomous-production-director-v128');\n",
    "const { AutonomousProductionDirectorV128 } = require('./autonomous-production-director-v128');\nconst { AutonomousQualityCouncilV129 } = require('./autonomous-quality-council-v129');\n",
    'Quality Council import'
  );
  s = replaceOnce(
    s,
    "    this.productionDirector = options.productionDirector || new AutonomousProductionDirectorV128(this.db, { logger: this.logger, policy: options.productionPolicy });\n",
    "    this.productionDirector = options.productionDirector || new AutonomousProductionDirectorV128(this.db, { logger: this.logger, policy: options.productionPolicy });\n    this.qualityCouncil = options.qualityCouncil || new AutonomousQualityCouncilV129(this.db, { logger: this.logger, policy: options.qualityPolicy });\n",
    'Quality Council initialization'
  );
  s = replaceOnce(
    s,
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null, claimPacket = null, productionDirective = null) {\n",
    "  async promoteDecision(decisionId, editorialPlan = null, researchRun = null, claimPacket = null, productionDirective = null, qualityCouncilReview = null) {\n",
    'promotion receives council review'
  );
  s = replaceOnce(
    s,
    "    const productionSummary = productionDirective ? ` Production 12.8: ${productionDirective.mode}; ${productionDirective.visualStrategy}; ${productionDirective.providerTier}; ${productionDirective.sceneCount} scenes; budget cap $${Number(productionDirective.maxBudgetUsd || 0).toFixed(2)}.` : '';\n",
    "    const productionSummary = productionDirective ? ` Production 12.8: ${productionDirective.mode}; ${productionDirective.visualStrategy}; ${productionDirective.providerTier}; ${productionDirective.sceneCount} scenes; budget cap $${Number(productionDirective.maxBudgetUsd || 0).toFixed(2)}.` : '';\n    const qualitySummary = qualityCouncilReview ? ` Quality Council 12.9: ${qualityCouncilReview.status}; score ${qualityCouncilReview.score}/100.` : '';\n",
    'promotion council summary'
  );
  s = replaceOnce(
    s,
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''}${claimSummary}${productionSummary} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    "        rationale: `${decision.rationale}${editorialPlan?.rationale ? ` ${editorialPlan.rationale}` : ''}${claimSummary}${productionSummary}${qualitySummary} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`\n",
    'backlog rationale council summary'
  );
  s = replaceOnce(
    s,
    "      let productionDirective = null;\n      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;\n",
    "      let productionDirective = null;\n      let qualityCouncilReview = null;\n      const selectedByBrain = brainDecision ? Boolean(brainDecision.selected) : true;\n",
    'Quality Council local state'
  );
  s = replaceOnce(
    s,
    "      const researchGatePassed = !this.autonomousResearch?.getConfig()?.enabled || autonomousResearch?.status === 'EVIDENCE_READY';\n      const claimGatePassed = !this.claimVerification?.getConfig()?.enabled || claimVerification?.status === 'VERIFIED';\n      const productionGatePassed = !this.productionDirector?.getConfig()?.enabled || productionDirective?.status === 'PLAN_READY';\n",
    "      if (productionDirective?.status === 'PLAN_READY' && this.qualityCouncil?.getConfig()?.enabled) {\n        try {\n          qualityCouncilReview = await this.qualityCouncil.reviewPreProduction({ candidate: { cluster, event, importance: candidate.importance || null }, editorialPlan, claimVerification, productionDirective, autonomousResearch, brainDecision, decision, scanId });\n        } catch (error) {\n          this.logger.warn(`Autonomous Quality Council could not review decision ${decision.id}: ${error.message}`);\n        }\n      }\n      const researchGatePassed = !this.autonomousResearch?.getConfig()?.enabled || autonomousResearch?.status === 'EVIDENCE_READY';\n      const claimGatePassed = !this.claimVerification?.getConfig()?.enabled || claimVerification?.status === 'VERIFIED';\n      const productionGatePassed = !this.productionDirector?.getConfig()?.enabled || productionDirective?.status === 'PLAN_READY';\n      const qualityCouncilGatePassed = !this.qualityCouncil?.getConfig()?.enabled || qualityCouncilReview?.status === 'PASS';\n",
    'Quality Council pre-production execution and gate'
  );
  s = replaceOnce(
    s,
    "      if (autoPromote && selectedByBrain && researchGatePassed && claimGatePassed && productionGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {\n",
    "      if (autoPromote && selectedByBrain && researchGatePassed && claimGatePassed && productionGatePassed && qualityCouncilGatePassed && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {\n",
    'Quality Council promotion gate'
  );
  s = replaceOnce(
    s,
    "          promotion = productionDirective ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification, productionDirective) : (claimVerification ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification) : (autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan)));\n",
    "          promotion = qualityCouncilReview ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification, productionDirective, qualityCouncilReview) : (productionDirective ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification, productionDirective) : (claimVerification ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch, claimVerification) : (autonomousResearch ? await this.promoteDecision(decision.id, editorialPlan, autonomousResearch) : await this.promoteDecision(decision.id, editorialPlan))));\n",
    'promotion receives Quality Council review'
  );
  s = replaceOnce(
    s,
    "          if (productionDirective?.id && promotion && this.productionDirector) await this.productionDirector.linkPromotion(productionDirective.id, promotion);\n",
    "          if (productionDirective?.id && promotion && this.productionDirector) await this.productionDirector.linkPromotion(productionDirective.id, promotion);\n          if (qualityCouncilReview?.id && promotion && this.qualityCouncil) await this.qualityCouncil.linkPromotion(qualityCouncilReview.id, promotion);\n",
    'link council review to assignment'
  );
  s = replaceOnce(
    s,
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch, claimVerification, productionDirective });\n",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision, editorialPlan, autonomousResearch, claimVerification, productionDirective, qualityCouncilReview });\n",
    'cluster exposes Quality Council review'
  );
  s = replaceOnce(
    s,
    "      productionDirective: cluster.productionDirective || null\n",
    "      productionDirective: cluster.productionDirective || null,\n      qualityCouncilReview: cluster.qualityCouncilReview || null\n",
    'serialized cluster exposes Quality Council review'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchMainRuntime() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { DiscoverabilityService } = require('./utils/discoverability-service');\n",
    "const { DiscoverabilityService } = require('./utils/discoverability-service');\nconst { AutonomousQualityCouncilV129 } = require('./utils/autonomous-quality-council-v129');\n",
    'main Quality Council import'
  );
  s = replaceOnce(
    s,
    "    this.discoverability = null;\n",
    "    this.discoverability = null;\n    this.qualityCouncil = null;\n",
    'main Quality Council property'
  );
  s = replaceOnce(
    s,
    "      this.discoverability = new DiscoverabilityService(this.db, { logger: this.logger });\n",
    "      this.discoverability = new DiscoverabilityService(this.db, { logger: this.logger });\n      this.qualityCouncil = new AutonomousQualityCouncilV129(this.db, { logger: this.logger });\n",
    'main Quality Council initialization'
  );

  s = replaceOnce(
    s,
    "      const quality = await this.operator.runQualityChecks(productionData, profile);\n      const reviewStatus = quality.passed\n        ? (approvalRequired ? 'needs_review' : 'approved')\n        : 'needs_attention';\n",
    "      const quality = await this.operator.runQualityChecks(productionData, profile);\n      const councilReview = this.qualityCouncil?.getConfig()?.enabled\n        ? await this.qualityCouncil.reviewProduction({ production: productionData, builtInQuality: quality, profile, stage: 'generation' })\n        : null;\n      const councilPassed = !this.qualityCouncil?.getConfig()?.enabled || councilReview?.status === 'PASS';\n      const overallQualityPassed = quality.passed && councilPassed;\n      const reviewStatus = overallQualityPassed\n        ? (approvalRequired ? 'needs_review' : 'approved')\n        : 'needs_attention';\n",
    'generation Quality Council execution'
  );
  s = replaceOnce(
    s,
    "        qualityChecks: quality.checks,\n        editorData: packagingExperiment ? {\n",
    "        qualityChecks: councilReview ? [...quality.checks, { id: 'autonomous_quality_council', passed: councilReview.status === 'PASS', blocking: true, message: `Quality Council ${councilReview.status} (${councilReview.score}/100)` }] : quality.checks,\n        editorData: packagingExperiment ? {\n",
    'generation persists council check'
  );
  s = replaceOnce(
    s,
    "        reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,\n",
    "        reviewNotes: overallQualityPassed ? null : (quality.passed ? `Autonomous Quality Council: ${councilReview?.status || 'BLOCK'} (${councilReview?.score || 0}/100)` : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`),\n",
    'generation council review notes'
  );
  s = replaceOnce(
    s,
    "          level: quality.passed ? 'info' : 'warning',\n          title: quality.passed ? 'Content ready for review' : 'Content needs attention',\n          message: `${script.title} ${quality.passed ? 'is ready for approval' : 'failed one or more quality checks'}`,\n",
    "          level: overallQualityPassed ? 'info' : 'warning',\n          title: overallQualityPassed ? 'Content ready for review' : 'Content needs attention',\n          message: `${script.title} ${overallQualityPassed ? 'is ready for approval' : 'failed one or more quality council checks'}`,\n",
    'generation council notification'
  );

  const approvalCouncil = [
    "    const councilReview = this.qualityCouncil?.getConfig()?.enabled",
    "      ? await this.qualityCouncil.reviewProduction({ production: productionData, builtInQuality: quality, editorData, profile, stage: 'approval' })",
    "      : null;",
    "    if (councilReview && councilReview.status !== 'PASS') {",
    "      await this.db.saveContentReview(bundle.id, {",
    "        status: 'needs_attention', editorData,",
    "        qualityChecks: [...quality.checks, { id: 'autonomous_quality_council', passed: false, blocking: true, message: `Quality Council ${councilReview.status} (${councilReview.score}/100)` }],",
    "        reviewNotes: `Autonomous Quality Council ${councilReview.status}: ${councilReview.members.flatMap(member => member.findings || []).join('; ')}`",
    "      });",
    "      const error = new Error('Autonomous Quality Council did not pass the production');",
    "      error.status = 409;",
    "      error.qualityCouncil = councilReview;",
    "      throw error;",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    let scheduleEntry = bundle.schedule;\n", approvalCouncil, 'approval Quality Council gate');
  s = replaceOnce(
    s,
    "      status: 'approved', editorData, qualityChecks: quality.checks,\n      reviewNotes: input.reviewNotes || 'Approved by operator', reviewedAt: new Date().toISOString()\n",
    "      status: 'approved', editorData, qualityChecks: councilReview ? [...quality.checks, { id: 'autonomous_quality_council', passed: true, blocking: true, message: `Quality Council PASS (${councilReview.score}/100)` }] : quality.checks,\n      reviewNotes: input.reviewNotes || 'Approved by operator after Autonomous Quality Council', reviewedAt: new Date().toISOString()\n",
    'approved review stores council result'
  );
  write('index.js', s);
}

function patchAPI() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/quality-council/status', protect, async (_req, res) => {",
    "      try { if (!this.qualityCouncil) return res.status(503).json({ success: false, error: 'Autonomous Quality Council unavailable' }); return res.json({ success: true, result: await this.qualityCouncil.status() }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/quality-council/reviews', protect, async (req, res) => {",
    "      try { if (!this.qualityCouncil) return res.status(503).json({ success: false, error: 'Autonomous Quality Council unavailable' }); return res.json({ success: true, result: await this.qualityCouncil.listReviews(req.query.limit || 100, req.query.phase || null) }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/quality-council/reviews/:reviewId', protect, async (req, res) => {",
    "      try { const result = this.qualityCouncil ? await this.qualityCouncil.getReview(req.params.reviewId) : null; return result ? res.json({ success: true, result }) : res.status(404).json({ success: false, error: 'Quality Council review not found' }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/quality-council/policy', protect, async (_req, res) => {",
    "      try { if (!this.qualityCouncil) return res.status(503).json({ success: false, error: 'Autonomous Quality Council unavailable' }); return res.json({ success: true, result: await this.qualityCouncil.getPolicy() }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/quality-council/policy', protect, async (req, res) => {",
    "      try { if (!this.qualityCouncil) return res.status(503).json({ success: false, error: 'Autonomous Quality Council unavailable' }); const actor = req.body?.actor || req.user?.email || req.user?.name || 'operator'; const result = await this.qualityCouncil.setPolicy(req.body?.policy || {}, actor, req.body?.reason || ''); return res.status(201).json({ success: true, result }); } catch (error) { return res.status(error.code === 'quality_council_policy_reason_required' ? 400 : 500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Quality Council protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">AUTONOMOUS QUALITY COUNCIL 12.9</p><h2>Multi-agent quality gate</h2></div></div><div id="newsroom-quality-council" class="activity-list"><div class="empty">Council reviews appear here before backlog promotion and before final scheduling.</div></div></article>\n        </div>\n`;
  html = insertBefore(html, '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.', panel, 'Quality Council dashboard panel');
  html = replaceOnce(
    html,
    '  <script src="/newsroom-production-director-v128.js" defer></script>\n',
    '  <script src="/newsroom-production-director-v128.js" defer></script>\n  <script src="/newsroom-quality-council-v129.js" defer></script>\n',
    'Quality Council dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:autonomous-quality-council'] = 'node ../bootstrap/verify-phase12-autonomous-quality-council.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_QUALITY_COUNCIL_ENABLED=')) {
    env += `\n# Phase 12.9 — Autonomous Quality Council.\nNEWSROOM_QUALITY_COUNCIL_ENABLED=true\nNEWSROOM_QUALITY_PRE_MIN_SCORE=88\nNEWSROOM_QUALITY_POST_MIN_SCORE=90\nNEWSROOM_QUALITY_BLOCK_TRUTH=true\nNEWSROOM_QUALITY_BLOCK_RIGHTS=true\nNEWSROOM_QUALITY_REQUIRE_REAL_VIDEO=true\nNEWSROOM_QUALITY_REQUIRE_THUMBNAIL=true\nNEWSROOM_QUALITY_REQUIRE_PROVENANCE=true\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchMainRuntime();
patchAPI();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.9 ativa: Autonomous Quality Council aplica revisores independentes pre-production e post-production, com PASS/REPAIR/BLOCK e gates fail-closed antes de backlog e scheduling.');
