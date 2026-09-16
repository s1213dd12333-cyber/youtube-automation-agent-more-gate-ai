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
  if (index === -1) throw new Error(`Phase 11.12.6 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.6 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/plot-thread-registry-v12.js', template('plot-thread-registry-v12.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('plot-thread-registry-db-tables-v12.txt')}\n`,
    'Plot Thread Registry tables'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('plot-thread-registry-db-methods-v12.txt')}\n`,
    'Plot Thread Registry DB methods'
  );
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { RelationshipStateGraphServiceV12 } = require('./utils/relationship-state-graph-v12');\n",
    "const { RelationshipStateGraphServiceV12 } = require('./utils/relationship-state-graph-v12');\nconst { PlotThreadRegistryServiceV12 } = require('./utils/plot-thread-registry-v12');\n",
    'Plot Thread Registry API import'
  );
  s = replaceOnce(
    s,
    "    this.relationshipStateGraphService = null;\n",
    "    this.relationshipStateGraphService = null;\n    this.plotThreadRegistryService = null;\n",
    'Plot Thread Registry API property'
  );
  s = replaceOnce(
    s,
    "      this.relationshipStateGraphService = new RelationshipStateGraphServiceV12(this.db, { logger: this.logger });\n",
    "      this.relationshipStateGraphService = new RelationshipStateGraphServiceV12(this.db, { logger: this.logger });\n      this.plotThreadRegistryService = new PlotThreadRegistryServiceV12(this.db, { logger: this.logger });\n",
    'Plot Thread Registry service initialization'
  );

  const routes = [
    "    this.app.get('/api/series-bibles/:seriesId/plot-threads', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedPlotThreads(req.params.seriesId, req.query.limit || 500, req.query.includeTerminal === 'true'); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/plot-threads/:threadKey', protect, async (req, res) => {",
    "      try { const helper = require('./utils/plot-thread-registry-v12'); const result = await this.db.getSerializedPlotThread(req.params.seriesId, helper.slug(req.params.threadKey)); if (!result) return res.status(404).json({ success: false, error: 'Plot thread not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/plot-threads/commit', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.plotThreadRegistryService.commitEpisodeThreads(req.params.seriesId, Number(req.params.episodeNumber), req.body?.updates || [], { actor, reason: req.body?.reason, allowBackfill: req.body?.allowBackfill === true }); const code = result.status === 'committed' ? 201 : result.status === 'not_found' ? 404 : 409; return res.status(code).json({ success: result.status === 'committed', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber/plot-threads/:threadKey', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.plotThreadRegistryService.amendEpisodeThread(req.params.seriesId, req.params.threadKey, Number(req.params.episodeNumber), req.body || {}, { actor, reason: req.body?.amendmentReason || req.body?.changeReason, allowAmendment: req.body?.allowAmendment === true, expectedRevision: req.body?.expectedRevision }); const code = result.status === 'amended' ? 200 : result.status === 'not_found' ? 404 : 409; return res.status(code).json({ success: result.status === 'amended', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/plot-threads/:threadKey/revisions', protect, async (req, res) => {",
    "      try { const helper = require('./utils/plot-thread-registry-v12'); const thread = await this.db.getSerializedPlotThread(req.params.seriesId, helper.slug(req.params.threadKey)); if (!thread) return res.status(404).json({ success: false, error: 'Plot thread not found' }); return res.json({ success: true, result: await this.db.listSerializedPlotThreadRevisions(thread.id, req.query.limit || 250) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/plot-threads/:threadKey/commits', protect, async (req, res) => {",
    "      try { const helper = require('./utils/plot-thread-registry-v12'); const thread = await this.db.getSerializedPlotThread(req.params.seriesId, helper.slug(req.params.threadKey)); if (!thread) return res.status(404).json({ success: false, error: 'Plot thread not found' }); return res.json({ success: true, result: await this.db.listSerializedPlotThreadCommits(thread.id, req.query.limit || 250) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/plot-threads/validate', protect, async (req, res) => {",
    "      try { const result = await this.plotThreadRegistryService.validateSeries(req.params.seriesId); return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : 'plot_thread_registry_invalid' }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Plot Thread Registry API routes');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { RelationshipStateGraphServiceV12 } = require('../utils/relationship-state-graph-v12');\n",
    "const { RelationshipStateGraphServiceV12 } = require('../utils/relationship-state-graph-v12');\nconst { PlotThreadRegistryServiceV12 } = require('../utils/plot-thread-registry-v12');\n",
    'Plot Thread Registry Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.relationshipStateGraph = new RelationshipStateGraphServiceV12(db, { logger: this.logger });\n",
    "    this.relationshipStateGraph = new RelationshipStateGraphServiceV12(db, { logger: this.logger });\n    this.plotThreadRegistry = new PlotThreadRegistryServiceV12(db, { logger: this.logger });\n",
    'Plot Thread Registry Script Writer service'
  );
  s = replaceOnce(
    s,
    "    const relationshipGraphContext = await this.relationshipStateGraph.getScriptContext(serializedSeriesContext);\n    const relationshipGraphPrompt = relationshipGraphContext.promptContext || '';\n",
    "    const relationshipGraphContext = await this.relationshipStateGraph.getScriptContext(serializedSeriesContext);\n    const relationshipGraphPrompt = relationshipGraphContext.promptContext || '';\n    const plotThreadContext = await this.plotThreadRegistry.getScriptContext(serializedSeriesContext);\n    const plotThreadPrompt = plotThreadContext.promptContext || '';\n",
    'resolve Plot Thread Registry before AI script prompt'
  );
  s = replaceOnce(
    s,
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\n${characterArcPrompt}\\n${relationshipGraphPrompt}\\nEvidence packet:',
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\n${characterArcPrompt}\\n${relationshipGraphPrompt}\\n${plotThreadPrompt}\\nEvidence packet:',
    'inject Plot Thread Registry into AI script prompt'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:plot-thread-registry'] = 'node ../bootstrap/verify-phase11-plot-thread-registry.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_PLOT_THREAD_REGISTRY_ENABLED=')) {
    env += `\n# Phase 11.12.6 — persistent lifecycle registry for unresolved/resolved narrative threads.\nSERIALIZED_PLOT_THREAD_REGISTRY_ENABLED=true\n# Maximum open/dormant threads injected into a serialized script prompt.\nSERIALIZED_PLOT_THREAD_PROMPT_LIMIT=40\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.6 ativa: Plot Thread Registry versionado, pos-Episode Memory, referencialmente validado e read-only no roteirista.');
