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
  if (index === -1) throw new Error(`Phase 11.12.4 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.4 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/character-arc-memory-v12.js', template('character-arc-memory-v12.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('character-arc-memory-db-tables-v12.txt')}\n`,
    'Character Arc Memory tables'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('character-arc-memory-db-methods-v12.txt')}\n`,
    'Character Arc Memory DB methods'
  );
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { EpisodeMemoryServiceV12 } = require('./utils/episode-memory-v12');\n",
    "const { EpisodeMemoryServiceV12 } = require('./utils/episode-memory-v12');\nconst { CharacterArcMemoryServiceV12 } = require('./utils/character-arc-memory-v12');\n",
    'Character Arc API import'
  );
  s = replaceOnce(
    s,
    "    this.episodeMemoryService = null;\n",
    "    this.episodeMemoryService = null;\n    this.characterArcMemoryService = null;\n",
    'Character Arc API property'
  );
  s = replaceOnce(
    s,
    "      this.episodeMemoryService = new EpisodeMemoryServiceV12(this.db, { logger: this.logger });\n",
    "      this.episodeMemoryService = new EpisodeMemoryServiceV12(this.db, { logger: this.logger });\n      this.characterArcMemoryService = new CharacterArcMemoryServiceV12(this.db, { logger: this.logger });\n",
    'Character Arc service initialization'
  );

  const routes = [
    "    this.app.get('/api/series-bibles/:seriesId/character-arcs', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedCharacterArcs(req.params.seriesId, req.query.limit || 250, req.query.includeRetired === 'true'); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/character-arcs/:characterKey', protect, async (req, res) => {",
    "      try { const key = require('./utils/character-arc-memory-v12').slug(req.params.characterKey); const result = await this.db.getSerializedCharacterArc(req.params.seriesId, key); if (!result) return res.status(404).json({ success: false, error: 'Character Arc not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/character-arcs/commit', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.characterArcMemoryService.commitEpisodeArcs(req.params.seriesId, Number(req.params.episodeNumber), req.body?.updates || [], { actor, reason: req.body?.reason, allowBackfill: req.body?.allowBackfill === true, allowRebind: req.body?.allowRebind === true, rebindReason: req.body?.rebindReason }); const code = result.status === 'committed' ? 201 : result.status === 'not_found' ? 404 : 409; return res.status(code).json({ success: result.status === 'committed', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber/character-arcs/:characterKey', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.characterArcMemoryService.amendEpisodeArc(req.params.seriesId, req.params.characterKey, Number(req.params.episodeNumber), req.body || {}, { actor, reason: req.body?.amendmentReason || req.body?.changeReason, allowAmendment: req.body?.allowAmendment === true, expectedRevision: req.body?.expectedRevision, allowRebind: req.body?.allowRebind === true, rebindReason: req.body?.rebindReason }); const code = result.status === 'amended' ? 200 : result.status === 'not_found' ? 404 : 409; return res.status(code).json({ success: result.status === 'amended', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/character-arcs/:characterKey/revisions', protect, async (req, res) => {",
    "      try { const key = require('./utils/character-arc-memory-v12').slug(req.params.characterKey); const arc = await this.db.getSerializedCharacterArc(req.params.seriesId, key); if (!arc) return res.status(404).json({ success: false, error: 'Character Arc not found' }); return res.json({ success: true, result: await this.db.listSerializedCharacterArcRevisions(arc.id, req.query.limit || 250) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/character-arcs/:characterKey/commits', protect, async (req, res) => {",
    "      try { const key = require('./utils/character-arc-memory-v12').slug(req.params.characterKey); const arc = await this.db.getSerializedCharacterArc(req.params.seriesId, key); if (!arc) return res.status(404).json({ success: false, error: 'Character Arc not found' }); return res.json({ success: true, result: await this.db.listSerializedCharacterArcCommits(arc.id, req.query.limit || 250) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/character-arcs/validate', protect, async (req, res) => {",
    "      try { const result = await this.characterArcMemoryService.validateSeries(req.params.seriesId); return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : 'character_arc_memory_invalid' }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Character Arc API routes');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { EpisodeMemoryServiceV12 } = require('../utils/episode-memory-v12');\n",
    "const { EpisodeMemoryServiceV12 } = require('../utils/episode-memory-v12');\nconst { CharacterArcMemoryServiceV12 } = require('../utils/character-arc-memory-v12');\n",
    'Character Arc Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.episodeMemory = new EpisodeMemoryServiceV12(db, { logger: this.logger });\n",
    "    this.episodeMemory = new EpisodeMemoryServiceV12(db, { logger: this.logger });\n    this.characterArcMemory = new CharacterArcMemoryServiceV12(db, { logger: this.logger });\n",
    'Character Arc Script Writer service'
  );
  s = replaceOnce(
    s,
    "    const episodeMemoryContext = await this.episodeMemory.getScriptContext(serializedSeriesContext);\n    const episodeMemoryPrompt = episodeMemoryContext.promptContext || '';\n",
    "    const episodeMemoryContext = await this.episodeMemory.getScriptContext(serializedSeriesContext);\n    const episodeMemoryPrompt = episodeMemoryContext.promptContext || '';\n    const characterArcContext = await this.characterArcMemory.getScriptContext(serializedSeriesContext);\n    const characterArcPrompt = characterArcContext.promptContext || '';\n",
    'resolve Character Arc Memory before AI script prompt'
  );
  s = replaceOnce(
    s,
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\nEvidence packet:',
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\n${characterArcPrompt}\\nEvidence packet:',
    'inject Character Arc Memory into AI script prompt'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:character-arc-memory'] = 'node ../bootstrap/verify-phase11-character-arc-memory.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_CHARACTER_ARC_MEMORY_ENABLED=')) {
    env += `\n# Phase 11.12.4 — per-character serialized narrative state.\nSERIALIZED_CHARACTER_ARC_MEMORY_ENABLED=true\n# Maximum active character arcs injected into a serialized script prompt.\nSERIALIZED_CHARACTER_ARC_PROMPT_LIMIT=40\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.4 ativa: Character Arc Memory versionada, pos-Episode Memory, knowledge-safe e read-only no roteirista.');
