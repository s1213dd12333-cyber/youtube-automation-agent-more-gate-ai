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
  if (index === -1) throw new Error(`Phase 11.12.5 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/relationship-state-graph-v12.js', template('relationship-state-graph-v12.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('relationship-state-graph-db-tables-v12.txt')}\n`,
    'Relationship State Graph tables'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('relationship-state-graph-db-methods-v12.txt')}\n`,
    'Relationship State Graph DB methods'
  );
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { CharacterArcMemoryServiceV12 } = require('./utils/character-arc-memory-v12');\n",
    "const { CharacterArcMemoryServiceV12 } = require('./utils/character-arc-memory-v12');\nconst { RelationshipStateGraphServiceV12 } = require('./utils/relationship-state-graph-v12');\n",
    'Relationship State Graph API import'
  );
  s = replaceOnce(
    s,
    "    this.characterArcMemoryService = null;\n",
    "    this.characterArcMemoryService = null;\n    this.relationshipStateGraphService = null;\n",
    'Relationship State Graph API property'
  );
  s = replaceOnce(
    s,
    "      this.characterArcMemoryService = new CharacterArcMemoryServiceV12(this.db, { logger: this.logger });\n",
    "      this.characterArcMemoryService = new CharacterArcMemoryServiceV12(this.db, { logger: this.logger });\n      this.relationshipStateGraphService = new RelationshipStateGraphServiceV12(this.db, { logger: this.logger });\n",
    'Relationship State Graph service initialization'
  );

  const routes = [
    "    this.app.get('/api/series-bibles/:seriesId/relationships', protect, async (req, res) => {",
    "      try { const bible = await this.db.getSerializedSeriesBible(req.params.seriesId); if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' }); const result = await this.db.listSerializedRelationshipStates(req.params.seriesId, req.query.limit || 500, req.query.includeArchived === 'true'); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/relationships/:sourceCharacterKey/:targetCharacterKey', protect, async (req, res) => {",
    "      try { const helper = require('./utils/relationship-state-graph-v12'); const sourceKey = helper.slug(req.params.sourceCharacterKey); const targetKey = helper.slug(req.params.targetCharacterKey); const result = await this.db.getSerializedRelationshipState(req.params.seriesId, sourceKey, targetKey); if (!result) return res.status(404).json({ success: false, error: 'Relationship state not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/relationships/commit', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.relationshipStateGraphService.commitEpisodeRelationships(req.params.seriesId, Number(req.params.episodeNumber), req.body?.updates || [], { actor, reason: req.body?.reason, allowBackfill: req.body?.allowBackfill === true }); const code = result.status === 'committed' ? 201 : result.status === 'not_found' ? 404 : 409; return res.status(code).json({ success: result.status === 'committed', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber/relationships/:sourceCharacterKey/:targetCharacterKey', protect, async (req, res) => {",
    "      try { const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator'; const result = await this.relationshipStateGraphService.amendEpisodeRelationship(req.params.seriesId, req.params.sourceCharacterKey, req.params.targetCharacterKey, Number(req.params.episodeNumber), req.body || {}, { actor, reason: req.body?.amendmentReason || req.body?.changeReason, allowAmendment: req.body?.allowAmendment === true, expectedRevision: req.body?.expectedRevision }); const code = result.status === 'amended' ? 200 : result.status === 'not_found' ? 404 : 409; return res.status(code).json({ success: result.status === 'amended', result, error: code >= 400 ? result.reason || result.status : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/relationships/:sourceCharacterKey/:targetCharacterKey/revisions', protect, async (req, res) => {",
    "      try { const helper = require('./utils/relationship-state-graph-v12'); const relationship = await this.db.getSerializedRelationshipState(req.params.seriesId, helper.slug(req.params.sourceCharacterKey), helper.slug(req.params.targetCharacterKey)); if (!relationship) return res.status(404).json({ success: false, error: 'Relationship state not found' }); return res.json({ success: true, result: await this.db.listSerializedRelationshipRevisions(relationship.id, req.query.limit || 250) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/relationships/:sourceCharacterKey/:targetCharacterKey/commits', protect, async (req, res) => {",
    "      try { const helper = require('./utils/relationship-state-graph-v12'); const relationship = await this.db.getSerializedRelationshipState(req.params.seriesId, helper.slug(req.params.sourceCharacterKey), helper.slug(req.params.targetCharacterKey)); if (!relationship) return res.status(404).json({ success: false, error: 'Relationship state not found' }); return res.json({ success: true, result: await this.db.listSerializedRelationshipCommits(relationship.id, req.query.limit || 250) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/relationships/validate', protect, async (req, res) => {",
    "      try { const result = await this.relationshipStateGraphService.validateSeries(req.params.seriesId); return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : 'relationship_state_graph_invalid' }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Relationship State Graph API routes');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { CharacterArcMemoryServiceV12 } = require('../utils/character-arc-memory-v12');\n",
    "const { CharacterArcMemoryServiceV12 } = require('../utils/character-arc-memory-v12');\nconst { RelationshipStateGraphServiceV12 } = require('../utils/relationship-state-graph-v12');\n",
    'Relationship State Graph Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.characterArcMemory = new CharacterArcMemoryServiceV12(db, { logger: this.logger });\n",
    "    this.characterArcMemory = new CharacterArcMemoryServiceV12(db, { logger: this.logger });\n    this.relationshipStateGraph = new RelationshipStateGraphServiceV12(db, { logger: this.logger });\n",
    'Relationship State Graph Script Writer service'
  );
  s = replaceOnce(
    s,
    "    const characterArcContext = await this.characterArcMemory.getScriptContext(serializedSeriesContext);\n    const characterArcPrompt = characterArcContext.promptContext || '';\n",
    "    const characterArcContext = await this.characterArcMemory.getScriptContext(serializedSeriesContext);\n    const characterArcPrompt = characterArcContext.promptContext || '';\n    const relationshipGraphContext = await this.relationshipStateGraph.getScriptContext(serializedSeriesContext);\n    const relationshipGraphPrompt = relationshipGraphContext.promptContext || '';\n",
    'resolve Relationship State Graph before AI script prompt'
  );
  s = replaceOnce(
    s,
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\n${characterArcPrompt}\\nEvidence packet:',
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\n${characterArcPrompt}\\n${relationshipGraphPrompt}\\nEvidence packet:',
    'inject Relationship State Graph into AI script prompt'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:relationship-state-graph'] = 'node ../bootstrap/verify-phase11-relationship-state-graph.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_RELATIONSHIP_STATE_GRAPH_ENABLED=')) {
    env += `\n# Phase 11.12.5 — directed relationship continuity graph.\nSERIALIZED_RELATIONSHIP_STATE_GRAPH_ENABLED=true\n# Maximum active directed relationship edges injected into a serialized script prompt.\nSERIALIZED_RELATIONSHIP_PROMPT_LIMIT=60\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.5 ativa: Relationship State Graph direcionado, versionado, pos-Episode Memory e read-only no roteirista.');
