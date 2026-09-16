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
  if (index === -1) throw new Error(`Phase 11.12.3 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.3 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/episode-memory-v12.js', template('episode-memory-v12.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('episode-memory-db-tables-v12.txt')}\n`,
    'Episode Memory tables'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('episode-memory-db-methods-v12.txt')}\n`,
    'Episode Memory DB methods'
  );
  write('database/db.js', s);
}

function patchSeriesBibleAdvance() {
  let s = read('utils/serialized-series-bible-v12.js');
  s = replaceOnce(
    s,
    "  async advanceEpisode(seriesId, episodeNumber, options = {}) {\n    const existing = await this.db.getSerializedSeriesBible(seriesId);\n    if (!existing) return { status: 'not_found', bible: null };\n",
    "  async advanceEpisode(seriesId, episodeNumber, options = {}) {\n    const existing = await this.db.getSerializedSeriesBible(seriesId);\n    if (!existing) return { status: 'not_found', bible: null };\n    if (typeof this.db?.getSerializedEpisodeMemory === 'function' && options.allowEpisodeMemoryBypass !== true) {\n      return { status: 'conflict', reason: 'episode_memory_finalize_required', bible: existing };\n    }\n",
    'disable legacy episode advance when Episode Memory is materialized'
  );
  write('utils/serialized-series-bible-v12.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { CanonicalTimelineServiceV12 } = require('./utils/canonical-timeline-v12');\n",
    "const { CanonicalTimelineServiceV12 } = require('./utils/canonical-timeline-v12');\nconst { EpisodeMemoryServiceV12 } = require('./utils/episode-memory-v12');\n",
    'Episode Memory API import'
  );
  s = replaceOnce(
    s,
    "    this.canonicalTimelineService = null;\n",
    "    this.canonicalTimelineService = null;\n    this.episodeMemoryService = null;\n",
    'Episode Memory API property'
  );
  s = replaceOnce(
    s,
    "      this.canonicalTimelineService = new CanonicalTimelineServiceV12(this.db, { logger: this.logger });\n",
    "      this.canonicalTimelineService = new CanonicalTimelineServiceV12(this.db, { logger: this.logger });\n      this.episodeMemoryService = new EpisodeMemoryServiceV12(this.db, { logger: this.logger });\n",
    'Episode Memory service initialization'
  );

  const routes = [
    "    this.app.get('/api/series-bibles/:seriesId/episodes', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedEpisodeMemories(req.params.seriesId, req.query.limit || 250); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/episodes/:episodeNumber', protect, async (req, res) => {",
    "      try { const result = await this.db.getSerializedEpisodeMemory(req.params.seriesId, req.params.episodeNumber); if (!result) return res.status(404).json({ success: false, error: 'Episode Memory not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/finalize', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.episodeMemoryService.finalizeEpisode(req.params.seriesId, { ...(req.body || {}), episodeNumber: Number(req.params.episodeNumber) }, { actor, approved: req.body?.approved === true, reason: req.body?.reason || req.body?.approvalReason, expectedBibleRevision: req.body?.expectedBibleRevision }); const code = result.status === 'not_found' ? 404 : ['conflict', 'approval_required', 'invalid'].includes(result.status) ? 409 : result.status === 'finalized' ? 201 : 400; return res.status(code).json({ success: result.status === 'finalized', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.episodeMemoryService.amendEpisode(req.params.seriesId, Number(req.params.episodeNumber), req.body || {}, { actor, allowAmendment: req.body?.allowAmendment === true, reason: req.body?.amendmentReason || req.body?.changeReason, expectedRevision: req.body?.expectedRevision }); const code = result.status === 'not_found' ? 404 : ['conflict', 'amendment_required', 'invalid'].includes(result.status) ? 409 : 200; return res.status(code).json({ success: result.status === 'amended', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/episodes/:episodeNumber/revisions', protect, async (req, res) => {",
    "      try { const memory = await this.db.getSerializedEpisodeMemory(req.params.seriesId, req.params.episodeNumber); if (!memory) return res.status(404).json({ success: false, error: 'Episode Memory not found' }); const result = await this.db.listSerializedEpisodeMemoryRevisions(memory.id, req.query.limit || 100); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/episode-memory/commits', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedEpisodeMemoryCommits(req.params.seriesId, req.query.limit || 250); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/episode-memory/validate', protect, async (req, res) => {",
    "      try { const result = await this.episodeMemoryService.validateSeries(req.params.seriesId); return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : 'episode_memory_invalid' }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Episode Memory API routes');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { CanonicalTimelineServiceV12 } = require('../utils/canonical-timeline-v12');\n",
    "const { CanonicalTimelineServiceV12 } = require('../utils/canonical-timeline-v12');\nconst { EpisodeMemoryServiceV12 } = require('../utils/episode-memory-v12');\n",
    'Episode Memory Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.canonicalTimeline = new CanonicalTimelineServiceV12(db, { logger: this.logger });\n",
    "    this.canonicalTimeline = new CanonicalTimelineServiceV12(db, { logger: this.logger });\n    this.episodeMemory = new EpisodeMemoryServiceV12(db, { logger: this.logger });\n",
    'Episode Memory Script Writer service'
  );
  s = replaceOnce(
    s,
    "    const canonicalTimelineContext = await this.canonicalTimeline.getScriptContext(serializedSeriesContext);\n    const canonicalTimelinePrompt = canonicalTimelineContext.promptContext || '';\n",
    "    const canonicalTimelineContext = await this.canonicalTimeline.getScriptContext(serializedSeriesContext);\n    const canonicalTimelinePrompt = canonicalTimelineContext.promptContext || '';\n    const episodeMemoryContext = await this.episodeMemory.getScriptContext(serializedSeriesContext);\n    const episodeMemoryPrompt = episodeMemoryContext.promptContext || '';\n",
    'resolve Episode Memory before AI script prompt'
  );
  s = replaceOnce(
    s,
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\nEvidence packet:',
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\nEvidence packet:',
    'inject Episode Memory into AI script prompt'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:episode-memory'] = 'node ../bootstrap/verify-phase11-episode-memory.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_EPISODE_MEMORY_ENABLED=')) {
    env += `\n# Phase 11.12.3 — post-approval Episode Memory / Ledger.\nSERIALIZED_EPISODE_MEMORY_ENABLED=true\n# Maximum finalized prior episode ledgers injected into a serialized script prompt.\nSERIALIZED_EPISODE_MEMORY_PROMPT_EPISODES=20\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchSeriesBibleAdvance();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.3 ativa: Episode Memory pos-aprovacao, finalize atomico, timeline-set exato, audit trail e contexto read-only no roteirista.');
