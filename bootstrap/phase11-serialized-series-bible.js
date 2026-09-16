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
  if (index === -1) throw new Error(`Phase 11.12.1 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.1 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/serialized-series-bible-v12.js', template('serialized-series-bible-v12.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('serialized-series-bible-db-tables-v12.txt')}\n`,
    'Serialized Series Bible tables'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('serialized-series-bible-db-methods-v12.txt')}\n`,
    'Serialized Series Bible DB methods'
  );
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { PersistentCharacterLibraryManagerV11 } = require('./utils/persistent-character-library-manager-v11');\n",
    "const { PersistentCharacterLibraryManagerV11 } = require('./utils/persistent-character-library-manager-v11');\nconst { SerializedSeriesBibleServiceV12 } = require('./utils/serialized-series-bible-v12');\n",
    'Series Bible API import'
  );
  s = replaceOnce(
    s,
    "    this.characterLibrary = null;\n",
    "    this.characterLibrary = null;\n    this.seriesBibleService = null;\n",
    'Series Bible API property'
  );
  s = replaceOnce(
    s,
    "      this.characterLibrary = new PersistentCharacterLibraryManagerV11(this.db, { logger: this.logger });\n",
    "      this.characterLibrary = new PersistentCharacterLibraryManagerV11(this.db, { logger: this.logger });\n      this.seriesBibleService = new SerializedSeriesBibleServiceV12(this.db, { logger: this.logger });\n",
    'Series Bible service initialization'
  );

  const routes = [
    "    this.app.get('/api/series-bibles', protect, async (req, res) => {",
    "      try { const namespace = String(req.query.namespace || process.env.SERIALIZED_STORY_NAMESPACE || 'default').trim() || 'default'; const result = await this.db.listSerializedSeriesBibles(namespace, req.query.limit || 250); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.seriesBibleService.createBible(req.body || {}, { actor, reason: req.body?.reason }); return res.status(result.status === 'created' ? 201 : result.status === 'exists' ? 200 : 400).json({ success: ['created', 'exists'].includes(result.status), result }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId', protect, async (req, res) => {",
    "      try { const result = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!result) return res.status(404).json({ success: false, error: 'Series Bible not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/revisions', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedSeriesBibleRevisions(req.params.seriesId, req.query.limit || 100); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.patch('/api/series-bibles/:seriesId', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.seriesBibleService.updateBible(req.params.seriesId, req.body || {}, { actor, expectedRevisionNumber: req.body?.expectedRevisionNumber, allowRetcon: req.body?.allowRetcon === true, reason: req.body?.retconReason || req.body?.changeReason }); const code = result.status === 'not_found' ? 404 : ['conflict', 'retcon_required'].includes(result.status) ? 409 : 200; return res.status(code).json({ success: ['updated', 'retconned'].includes(result.status), result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/advance', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.seriesBibleService.advanceEpisode(req.params.seriesId, req.body?.episodeNumber, { actor, reason: req.body?.reason }); const code = result.status === 'not_found' ? 404 : result.status === 'conflict' ? 409 : 200; return res.status(code).json({ success: result.status === 'updated', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/bind-strategy', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.seriesBibleService.bindStrategy(req.params.seriesId, req.body || {}, { actor, allowRebind: req.body?.allowRebind === true, reason: req.body?.reason }); const code = result.status === 'not_found' ? 404 : result.status === 'conflict' ? 409 : 200; return res.status(code).json({ success: ['bound', 'rebound'].includes(result.status), result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Series Bible API routes');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { isExplicitFictionalNarrative, fictionEvidencePrompt } = require('../utils/fiction-evidence-policy-v5');\n",
    "const { isExplicitFictionalNarrative, fictionEvidencePrompt } = require('../utils/fiction-evidence-policy-v5');\nconst { SerializedSeriesBibleServiceV12 } = require('../utils/serialized-series-bible-v12');\n",
    'Series Bible Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});\n",
    "    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});\n    this.serializedSeriesBible = new SerializedSeriesBibleServiceV12(db, { logger: this.logger });\n",
    'Series Bible Script Writer service'
  );
  s = replaceOnce(
    s,
    "    if (!this.aiTextService.isAvailable()) {\n      this.logger.info('Using template script generation because no AI text provider is configured');\n      return null;\n    }\n",
    "    if (!this.aiTextService.isAvailable()) {\n      const serializedUnavailableContext = await this.serializedSeriesBible.getScriptContext(strategy);\n      if (serializedUnavailableContext.active) {\n        throw new Error('Serialized Series Bible is active but no AI text provider is available; refusing canon-unaware template fallback.');\n      }\n      this.logger.info('Using template script generation because no AI text provider is configured');\n      return null;\n    }\n",
    'fail closed when serialized series has no AI provider'
  );
  s = replaceOnce(
    s,
    "    const evidencePolicy = fictionEvidencePrompt(strategy);\n    const prompt = `You are writing a YouTube script plan.\n",
    "    const evidencePolicy = fictionEvidencePrompt(strategy);\n    const serializedSeriesContext = await this.serializedSeriesBible.getScriptContext(strategy);\n    const serializedSeriesPrompt = serializedSeriesContext.promptContext || '';\n    const prompt = `You are writing a YouTube script plan.\n",
    'resolve Series Bible before AI script prompt'
  );
  s = replaceOnce(
    s,
    '${evidencePolicy}\\nEvidence packet:',
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\nEvidence packet:',
    'inject Series Bible context into AI script prompt'
  );
  s = replaceOnce(
    s,
    "      this.logger.warn(`AI script generation failed; using template fallback: ${error.message}`);\n      return null;\n",
    "      if (serializedSeriesContext.active) {\n        this.logger.error(`Serialized script generation failed; refusing canon-unaware template fallback: ${error.message}`);\n        throw error;\n      }\n      this.logger.warn(`AI script generation failed; using template fallback: ${error.message}`);\n      return null;\n",
    'fail closed when serialized AI generation fails'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:series-bible'] = 'node ../bootstrap/verify-phase11-serialized-series-bible.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_SERIES_BIBLE_ENABLED=')) {
    env += `\n# Phase 11.12.1 — persistent Series Bible for serialized channels/stories.\nSERIALIZED_SERIES_BIBLE_ENABLED=true\n# Keep unrelated story universes in separate namespaces.\nSERIALIZED_STORY_NAMESPACE=default\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.1 ativa: Series Bible persistente, revisionado, retcon-explicito e injetado no roteirista somente por referencia/binding explicito.');
