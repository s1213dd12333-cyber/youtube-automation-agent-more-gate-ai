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
  if (index === -1) throw new Error(`Phase 12.4 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.4 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/global-importance-engine-v124.js', template('global-importance-engine-v124.js'));
  write('dashboard/newsroom-importance-v124.js', template('global-importance-engine-dashboard-v124.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('global-importance-engine-db-tables-v124.txt')}\n`,
    'Global Importance tables'
  );
  write('database/db.js', s);
}

function patchRadar() {
  let s = read('utils/global-news-radar-v121.js');
  s = replaceOnce(
    s,
    "const { EditorialDecisionBrainV123 } = require('./autonomous-editorial-decision-brain-v123');\n",
    "const { EditorialDecisionBrainV123 } = require('./autonomous-editorial-decision-brain-v123');\nconst { GlobalImportanceEngineV124 } = require('./global-importance-engine-v124');\n",
    'Global Importance import'
  );
  s = replaceOnce(
    s,
    "    this.editorialBrain = options.editorialBrain || new EditorialDecisionBrainV123(this.db, { logger: this.logger, policy: options.editorialPolicy });\n",
    "    this.editorialBrain = options.editorialBrain || new EditorialDecisionBrainV123(this.db, { logger: this.logger, policy: options.editorialPolicy });\n    this.globalImportance = options.globalImportance || new GlobalImportanceEngineV124(this.db, { logger: this.logger, policy: options.importancePolicy });\n",
    'Global Importance initialization'
  );
  s = replaceOnce(
    s,
    "      editorialCandidates.push({ cluster, event, previous, previousAssigned: Boolean(event?.previousAssigned) });\n",
    [
      "      let importance = null;",
      "      if (this.globalImportance) {",
      "        try {",
      "          importance = await this.globalImportance.assessCandidate({ cluster, event }, { scanId });",
      "          if (importance) cluster.importance = importance;",
      "        } catch (error) {",
      "          this.logger.warn(`Global Importance could not assess cluster ${cluster.id}: ${error.message}`);",
      "        }",
      "      }",
      "      editorialCandidates.push({ cluster, event, previous, importance, previousAssigned: Boolean(event?.previousAssigned) });"
    ].join('\n') + '\n',
    'importance assessment before editorial competition'
  );
  s = replaceOnce(
    s,
    "      finalClusters.push({ ...cluster, decision, promotion, event, editorialBrainDecision: brainDecision });\n",
    "      finalClusters.push({ ...cluster, decision, promotion, event, importanceAssessment: candidate.importance || null, editorialBrainDecision: brainDecision });\n",
    'scan result includes importance assessment'
  );
  s = replaceOnce(
    s,
    "      event: cluster.event || null,\n      editorialBrainDecision: cluster.editorialBrainDecision || null\n",
    "      event: cluster.event || null,\n      importanceAssessment: cluster.importanceAssessment || cluster.importance || null,\n      editorialBrainDecision: cluster.editorialBrainDecision || null\n",
    'serialized cluster exposes importance assessment'
  );
  write('utils/global-news-radar-v121.js', s);
}

function patchEditorialBrain() {
  let s = read('utils/autonomous-editorial-decision-brain-v123.js');
  s = replaceOnce(
    s,
    "  const evolution = clamp(event.evolutionScore, 0, 100, change === 'observation' ? 15 : 65);\n",
    "  const evolution = clamp(event.evolutionScore, 0, 100, change === 'observation' ? 15 : 65);\n  const importanceAssessment = candidate?.importance || candidate?.cluster?.importance || candidate?.cluster?.importanceAssessment || null;\n  const importance = clamp(importanceAssessment?.importanceScore, 0, 100, global);\n  const importanceConfidence = clamp(importanceAssessment?.confidenceScore, 0, 100, confidence);\n",
    'editorial brain reads structural importance'
  );
  s = replaceOnce(
    s,
    "  const raw = global * 0.32 + confidence * 0.28 + velocity * 0.15 + freshness * 0.10 + geography * 0.08 + evolution * 0.07 + evolutionBonus;\n",
    "  const raw = global * 0.20 + importance * 0.22 + confidence * 0.25 + velocity * 0.13 + freshness * 0.08 + geography * 0.06 + evolution * 0.06 + evolutionBonus;\n",
    'editorial priority includes structural importance distinct from repercussion'
  );
  s = replaceOnce(
    s,
    "    evolutionScore: Math.round(evolution),\n    evolutionBonus,\n",
    "    evolutionScore: Math.round(evolution),\n    importanceScore: Math.round(importance),\n    importanceConfidenceScore: Math.round(importanceConfidence),\n    impactTier: importanceAssessment?.impactTier || null,\n    evolutionBonus,\n",
    'importance signals included in audit payload'
  );
  s = replaceOnce(
    s,
    "  if (signals.diversityPenalty > 0) reasonCodes.push('recent_coverage_diversity_penalty');\n",
    "  if (signals.importanceScore >= 74) reasonCodes.push('high_structural_global_importance');\n  if (signals.diversityPenalty > 0) reasonCodes.push('recent_coverage_diversity_penalty');\n",
    'importance reason code'
  );
  s = replaceOnce(
    s,
    "    `Repercussion ${signals.globalScore}/100, coverage-confidence ${signals.confidenceScore}/100, velocity ${signals.velocityScore}/100, freshness ${signals.freshnessScore}/100, geography ${signals.geographyScore}/100.`,\n",
    "    `Repercussion ${signals.globalScore}/100, structural importance ${signals.importanceScore}/100, coverage-confidence ${signals.confidenceScore}/100, velocity ${signals.velocityScore}/100, freshness ${signals.freshnessScore}/100, geography ${signals.geographyScore}/100.`,\n",
    'rationale separates popularity from importance'
  );
  write('utils/autonomous-editorial-decision-brain-v123.js', s);
}

function patchIndex() {
  let s = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/importance/status', protect, async (_req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.globalImportance;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Global Importance Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.status() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/importance/assessments', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.globalImportance;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Global Importance Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.listAssessments(req.query.limit || 100, req.query.tier || null) });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/importance/policy', protect, async (_req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.globalImportance;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Global Importance Engine unavailable' });",
    "        return res.json({ success: true, result: await engine.getPolicy() });",
    "      } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/importance/policy', protect, async (req, res) => {",
    "      try {",
    "        const engine = this.globalNewsRadarService?.globalImportance;",
    "        if (!engine) return res.status(503).json({ success: false, error: 'Global Importance Engine unavailable' });",
    "        const actor = req.body?.actor || req.user?.email || req.user?.name || 'operator';",
    "        const result = await engine.setPolicy(req.body?.policy || {}, actor, req.body?.reason || '');",
    "        return res.status(201).json({ success: true, result });",
    "      } catch (error) { return res.status(error.code === 'importance_policy_reason_required' ? 400 : 500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Global Importance protected API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const panel = `\n        <div class="overview-grid lower">\n          <article class="panel"><div class="panel-heading"><div><p class="eyebrow">GLOBAL IMPORTANCE 12.4</p><h2>Structural impact</h2></div></div><div id="newsroom-global-importance" class="activity-list"><div class="empty">Run a world scan to measure structural global importance.</div></div></article>\n        </div>\n`;
  html = insertBefore(
    html,
    '        <p class="callout">Repercussion score measures coverage breadth, geography, freshness and velocity.',
    panel,
    'Global Importance dashboard panel'
  );
  html = replaceOnce(
    html,
    '  <script src="/newsroom-editor-v123.js" defer></script>\n',
    '  <script src="/newsroom-editor-v123.js" defer></script>\n  <script src="/newsroom-importance-v124.js" defer></script>\n',
    'Global Importance dashboard script'
  );
  write('dashboard/index.html', html);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:global-importance'] = 'node ../bootstrap/verify-phase12-global-importance-engine.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('NEWSROOM_GLOBAL_IMPORTANCE_ENABLED=')) {
    env += `\n# Phase 12.4 — Global Importance Engine.\nNEWSROOM_GLOBAL_IMPORTANCE_ENABLED=true\n# Structural impact remains distinct from raw media repercussion/popularity.\nNEWSROOM_IMPORTANCE_LOW_CONFIDENCE_DAMPING=0.82\nNEWSROOM_IMPORTANCE_LOW_CONFIDENCE_THRESHOLD=52\nNEWSROOM_IMPORTANCE_TIER_REGIONAL=42\nNEWSROOM_IMPORTANCE_TIER_INTERNATIONAL=58\nNEWSROOM_IMPORTANCE_TIER_GLOBAL=74\nNEWSROOM_IMPORTANCE_TIER_SYSTEMIC=88\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchRadar();
patchEditorialBrain();
patchIndex();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 12.4 ativa: Global Importance Engine separa repercussao de impacto estrutural global, com dimensoes auditaveis, confianca de evidencia e integracao ao Editorial Brain.');
