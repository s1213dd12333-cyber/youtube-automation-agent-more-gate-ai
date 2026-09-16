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
  if (index === -1) throw new Error(`Phase 11.12.2 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.2 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/canonical-timeline-v12.js', template('canonical-timeline-v12.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('canonical-timeline-db-tables-v12.txt')}\n`,
    'Canonical Timeline tables'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('canonical-timeline-db-methods-v12.txt')}\n`,
    'Canonical Timeline DB methods'
  );
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { SerializedSeriesBibleServiceV12 } = require('./utils/serialized-series-bible-v12');\n",
    "const { SerializedSeriesBibleServiceV12 } = require('./utils/serialized-series-bible-v12');\nconst { CanonicalTimelineServiceV12 } = require('./utils/canonical-timeline-v12');\n",
    'Canonical Timeline API import'
  );
  s = replaceOnce(
    s,
    "    this.seriesBibleService = null;\n",
    "    this.seriesBibleService = null;\n    this.canonicalTimelineService = null;\n",
    'Canonical Timeline API property'
  );
  s = replaceOnce(
    s,
    "      this.seriesBibleService = new SerializedSeriesBibleServiceV12(this.db, { logger: this.logger });\n",
    "      this.seriesBibleService = new SerializedSeriesBibleServiceV12(this.db, { logger: this.logger });\n      this.canonicalTimelineService = new CanonicalTimelineServiceV12(this.db, { logger: this.logger });\n",
    'Canonical Timeline service initialization'
  );

  const routes = [
    "    this.app.get('/api/series-bibles/:seriesId/timeline', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const [state, events, validation] = await Promise.all([this.db.getSerializedTimelineState(req.params.seriesId), this.db.listSerializedTimelineEvents(req.params.seriesId, req.query.limit || 2000), this.canonicalTimelineService.validateTimeline(req.params.seriesId)]); return res.json({ success: validation.valid, result: { state, events, validation } }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/timeline/events', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const events = Array.isArray(req.body?.events) ? req.body.events : [req.body?.event || req.body]; const result = await this.canonicalTimelineService.commitEvents(req.params.seriesId, events, { actor, reason: req.body?.reason, allowBackfill: req.body?.allowBackfill === true, expectedTimelineRevision: req.body?.expectedTimelineRevision, episodeNumber: req.body?.episodeNumber }); const code = result.status === 'not_found' ? 404 : ['conflict', 'invalid', 'backfill_required', 'reason_required'].includes(result.status) ? 409 : result.status === 'committed' ? 201 : 400; return res.status(code).json({ success: result.status === 'committed', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.patch('/api/series-bibles/:seriesId/timeline/events/:eventId', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.canonicalTimelineService.retconEvent(req.params.seriesId, req.params.eventId, req.body || {}, { actor, allowRetcon: req.body?.allowRetcon === true, reason: req.body?.retconReason || req.body?.changeReason, expectedEventRevision: req.body?.expectedEventRevision, expectedTimelineRevision: req.body?.expectedTimelineRevision }); const code = result.status === 'not_found' ? 404 : ['conflict', 'invalid', 'retcon_required'].includes(result.status) ? 409 : 200; return res.status(code).json({ success: ['retconned', 'unchanged'].includes(result.status), result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/timeline/events/:eventId/revisions', protect, async (req, res) => {",
    "      try { const event = await this.db.getSerializedTimelineEvent(req.params.eventId); if (!event || event.seriesId !== req.params.seriesId) return res.status(404).json({ success: false, error: 'Timeline event not found' }); const result = await this.db.listSerializedTimelineEventRevisions(req.params.eventId, req.query.limit || 100); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/timeline/commits', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedTimelineCommits(req.params.seriesId, req.query.limit || 250); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/timeline/validate', protect, async (req, res) => {",
    "      try { const result = await this.canonicalTimelineService.validateTimeline(req.params.seriesId); return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : 'canonical_timeline_invalid' }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Canonical Timeline API routes');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { SerializedSeriesBibleServiceV12 } = require('../utils/serialized-series-bible-v12');\n",
    "const { SerializedSeriesBibleServiceV12 } = require('../utils/serialized-series-bible-v12');\nconst { CanonicalTimelineServiceV12 } = require('../utils/canonical-timeline-v12');\n",
    'Canonical Timeline Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.serializedSeriesBible = new SerializedSeriesBibleServiceV12(db, { logger: this.logger });\n",
    "    this.serializedSeriesBible = new SerializedSeriesBibleServiceV12(db, { logger: this.logger });\n    this.canonicalTimeline = new CanonicalTimelineServiceV12(db, { logger: this.logger });\n",
    'Canonical Timeline Script Writer service'
  );
  s = replaceOnce(
    s,
    "    const serializedSeriesContext = await this.serializedSeriesBible.getScriptContext(strategy);\n    const serializedSeriesPrompt = serializedSeriesContext.promptContext || '';\n",
    "    const serializedSeriesContext = await this.serializedSeriesBible.getScriptContext(strategy);\n    const serializedSeriesPrompt = serializedSeriesContext.promptContext || '';\n    const canonicalTimelineContext = await this.canonicalTimeline.getScriptContext(serializedSeriesContext);\n    const canonicalTimelinePrompt = canonicalTimelineContext.promptContext || '';\n",
    'resolve Canonical Timeline before AI script prompt'
  );
  s = replaceOnce(
    s,
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\nEvidence packet:',
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\nEvidence packet:',
    'inject Canonical Timeline into AI script prompt'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:canonical-timeline'] = 'node ../bootstrap/verify-phase11-canonical-timeline.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_CANONICAL_TIMELINE_ENABLED=')) {
    env += `\n# Phase 11.12.2 — ordered canonical story-world timeline.\nSERIALIZED_CANONICAL_TIMELINE_ENABLED=true\n# Maximum prior committed events injected into a serialized script prompt.\nSERIALIZED_TIMELINE_PROMPT_EVENTS=60\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.2 ativa: Canonical Timeline atomica, append-only, backfill/retcon explicitos, constraints cronologicas e contexto read-only no roteirista.');
