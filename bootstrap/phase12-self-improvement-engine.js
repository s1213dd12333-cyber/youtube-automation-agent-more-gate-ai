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
  if (index === -1) throw new Error(`Phase 12.12 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 12.12 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyRuntime() {
  write('utils/self-improvement-engine-v1212.js', template('self-improvement-engine-v1212.js'));
}

function patchDatabase() {
  let source = read('database/db.js');
  source = insertBefore(
    source,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('self-improvement-db-tables-v1212.txt')}\n`,
    'self-improvement tables'
  );
  write('database/db.js', source);
}

function patchAnalyticsAgent() {
  let source = read('agents/analytics-optimization-agent.js');
  source = replaceOnce(
    source,
    "const { PerformanceLearningEngineV1211 } = require('../utils/performance-learning-engine-v1211');\n",
    "const { PerformanceLearningEngineV1211 } = require('../utils/performance-learning-engine-v1211');\nconst { SelfImprovementEngineV1212 } = require('../utils/self-improvement-engine-v1212');\n",
    'analytics self-improvement import'
  );
  source = replaceOnce(
    source,
    "    this.performanceLearning = new PerformanceLearningEngineV1211(db, { logger: this.logger });\n",
    "    this.performanceLearning = new PerformanceLearningEngineV1211(db, { logger: this.logger });\n    this.selfImprovement = new SelfImprovementEngineV1212(db, { logger: this.logger });\n",
    'analytics self-improvement initialization'
  );
  source = replaceOnce(
    source,
    "      performanceReport.performanceLearningSnapshot = await this.performanceLearning.capture(\n        performanceReport,\n        context,\n        measurementWindow\n      );\n\n",
    "      performanceReport.performanceLearningSnapshot = await this.performanceLearning.capture(\n        performanceReport,\n        context,\n        measurementWindow\n      );\n      performanceReport.selfImprovementInspection = await this.selfImprovement.inspectPerformance(performanceReport, context);\n\n",
    'analytics automatic self-inspection'
  );
  write('agents/analytics-optimization-agent.js', source);
}

function patchApi() {
  let source = read('index.js');
  const routes = [
    "    this.app.get('/api/newsroom/self-improvement/status', protect, async (_req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); return res.json({ success: true, result: await engine.status() }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.get('/api/newsroom/self-improvement/proposals', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); return res.json({ success: true, result: await engine.listProposals(req.query.limit || 100) }); } catch (error) { return res.status(500).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/self-improvement/observe', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); return res.json({ success: true, result: await engine.observe(req.body || {}) }); } catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/self-improvement/proposals', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); return res.json({ success: true, result: await engine.propose(req.body || {}) }); } catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/self-improvement/proposals/:id/approve', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); const actor = req.user?.email || req.user?.username || 'operator'; return res.json({ success: true, result: await engine.approve(req.params.id, actor) }); } catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/self-improvement/proposals/:id/reject', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); const actor = req.user?.email || req.user?.username || 'operator'; return res.json({ success: true, result: await engine.reject(req.params.id, actor) }); } catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/newsroom/self-improvement/proposals/:id/open-pr', protect, async (req, res) => {",
    "      try { const engine = this.agents?.analytics?.selfImprovement; if (!engine) return res.status(503).json({ success: false, error: 'Self-Improvement Engine unavailable' }); return res.json({ success: true, result: await engine.openCodePullRequest(req.params.id) }); } catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  source = insertBefore(source, "    this.app.get('/api/newsroom/performance-learning/status', protect, async (_req, res) => {\n", routes, 'protected self-improvement APIs');
  write('index.js', source);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:self-improvement'] = 'node ../bootstrap/verify-phase12-self-improvement-engine.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SELF_IMPROVEMENT_ENABLED=')) {
    env += `\n# Phase 12.12 — Self-Improvement Engine. Human approval is mandatory for every proposal.\nSELF_IMPROVEMENT_ENABLED=true\n# GitHub execution is opt-in. Code proposals can open a draft PR after approval, but the engine never merges.\nSELF_IMPROVEMENT_GITHUB_ENABLED=false\nSELF_IMPROVEMENT_GITHUB_REPOSITORY=\nSELF_IMPROVEMENT_GITHUB_BASE_BRANCH=main\nSELF_IMPROVEMENT_GITHUB_TOKEN=\n`;
  }
  write('.env.example', env);
}

copyRuntime();
patchDatabase();
patchAnalyticsAgent();
patchApi();
patchPackageAndEnv();
console.log('Phase 12.12 Self-Improvement Engine materialized successfully.');
