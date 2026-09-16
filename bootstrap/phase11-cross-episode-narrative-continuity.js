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
  if (index === -1) throw new Error(`Phase 11.12.8 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.8 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  let service = template('cross-episode-narrative-continuity-gate-v12.js');
  service = replaceOnce(
    service,
    "function statementsContradict(a, b) {\n",
    "function coverageSimilarity(a, b) {\n  const left = new Set(contentTokens(a));\n  const right = new Set(contentTokens(b));\n  if (!left.size || !right.size) return 0;\n  let overlap = 0;\n  for (const token of left) if (right.has(token)) overlap += 1;\n  return overlap / Math.min(left.size, right.size);\n}\n\nfunction statementsContradict(a, b) {\n",
    'containment-oriented semantic coverage helper'
  );
  service = replaceOnce(
    service,
    "      && similarity([event.summary, ...(event.consequences || [])].join(' '), fact) >= 0.45);",
    "      && coverageSimilarity([event.summary, ...(event.consequences || [])].join(' '), fact) >= 0.75);",
    'target-episode knowledge evidence uses fact coverage'
  );
  service = replaceOnce(
    service,
    "        const missingPayoffs = (thread.requiredPayoffs || []).filter(payoff => similarity(payoff, corpus) < 0.2);",
    "        const missingPayoffs = (thread.requiredPayoffs || []).filter(payoff => coverageSimilarity(payoff, corpus) < 0.66);",
    'required payoff uses obligation coverage'
  );
  service = replaceOnce(
    service,
    "    const reportId = `narrative_continuity_${hash(`${seriesId}:${targetEpisode}:${context.fingerprint}:${fingerprint}:${VERSION}`).slice(0, 24)}`;",
    "    const reviewFingerprint = hash(JSON.stringify(stable(manifest))).slice(0, 24);\n    const reportId = `narrative_continuity_${hash(`${seriesId}:${targetEpisode}:${context.fingerprint}:${fingerprint}:${reviewFingerprint}:${VERSION}`).slice(0, 24)}`;",
    'immutable review identity includes manifest fingerprint'
  );
  write('utils/cross-episode-narrative-continuity-gate-v12.js', service);
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(
    s,
    "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n",
    `${template('narrative-continuity-gate-db-tables-v12.txt')}\n`,
    'Narrative Continuity report table'
  );
  s = insertBefore(
    s,
    '  // Content Strategy methods\n',
    `${template('narrative-continuity-gate-db-methods-v12.txt')}\n`,
    'Narrative Continuity report DB methods'
  );
  write('database/db.js', s);
}

function patchEpisodeMemoryApprovalGate() {
  let s = read('utils/episode-memory-v12.js');
  s = replaceOnce(
    s,
    "    this.maxPromptEpisodes = Math.max(3, Math.min(100, Number(options.maxPromptEpisodes || process.env.SERIALIZED_EPISODE_MEMORY_PROMPT_EPISODES || 20)));\n",
    "    this.maxPromptEpisodes = Math.max(3, Math.min(100, Number(options.maxPromptEpisodes || process.env.SERIALIZED_EPISODE_MEMORY_PROMPT_EPISODES || 20)));\n    this.continuityGate = options.continuityGate || null;\n    this.requireContinuityGate = options.requireContinuityGate ?? String(process.env.SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_PASS || 'true').toLowerCase() !== 'false';\n",
    'Episode Memory continuity gate constructor state'
  );

  const oldBlock = [
    "    if (JSON.stringify(expectedTimelineIds) !== JSON.stringify(suppliedTimelineIds)) {",
    "      return { status: 'conflict', reason: 'episode_memory_timeline_set_mismatch', expectedTimelineIds, suppliedTimelineIds };",
    "    }",
    "",
    "    if (!memory.sourceFingerprint) {"
  ].join('\n');
  const newBlock = [
    "    if (JSON.stringify(expectedTimelineIds) !== JSON.stringify(suppliedTimelineIds)) {",
    "      return { status: 'conflict', reason: 'episode_memory_timeline_set_mismatch', expectedTimelineIds, suppliedTimelineIds };",
    "    }",
    "",
    "    if (this.requireContinuityGate) {",
    "      try {",
    "        const { CrossEpisodeNarrativeContinuityGateV12 } = require('./cross-episode-narrative-continuity-gate-v12');",
    "        const continuityGate = this.continuityGate || new CrossEpisodeNarrativeContinuityGateV12(this.db, { logger: this.logger });",
    "        const continuity = await continuityGate.verifyPassingReport(seriesId, memory.episodeNumber, memory);",
    "        if (!continuity.valid) {",
    "          return { status: 'conflict', reason: continuity.reason || 'narrative_continuity_pass_required', continuityGate: continuity };",
    "        }",
    "        if (!memory.sourceFingerprint && continuity.candidateFingerprint) memory.sourceFingerprint = continuity.candidateFingerprint;",
    "      } catch (error) {",
    "        return { status: 'conflict', reason: error.code || error.message || 'narrative_continuity_gate_failed', continuityGate: { valid: false } };",
    "      }",
    "    }",
    "",
    "    if (!memory.sourceFingerprint) {"
  ].join('\n');
  s = replaceOnce(s, oldBlock, newBlock, 'Episode Memory finalize requires current PASS continuity report');
  write('utils/episode-memory-v12.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { NarrativeContextResolverV12 } = require('./utils/narrative-context-resolver-v12');\n",
    "const { NarrativeContextResolverV12 } = require('./utils/narrative-context-resolver-v12');\nconst { CrossEpisodeNarrativeContinuityGateV12 } = require('./utils/cross-episode-narrative-continuity-gate-v12');\n",
    'Narrative Continuity Gate API import'
  );
  s = replaceOnce(
    s,
    "    this.narrativeContextResolverService = null;\n",
    "    this.narrativeContextResolverService = null;\n    this.narrativeContinuityGateService = null;\n",
    'Narrative Continuity Gate API property'
  );
  s = replaceOnce(
    s,
    "      this.narrativeContextResolverService = new NarrativeContextResolverV12(this.db, { logger: this.logger });\n",
    "      this.narrativeContextResolverService = new NarrativeContextResolverV12(this.db, { logger: this.logger });\n      this.narrativeContinuityGateService = new CrossEpisodeNarrativeContinuityGateV12(this.db, { logger: this.logger, resolver: this.narrativeContextResolverService });\n",
    'Narrative Continuity Gate service initialization'
  );

  const routes = [
    "    this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/check', protect, async (req, res) => {",
    "      try {",
    "        const actor = req.body?.actor || req.user?.email || req.user?.id || 'dashboard_operator';",
    "        const result = await this.narrativeContinuityGateService.evaluateEpisode(req.params.seriesId, Number(req.params.episodeNumber), req.body || {}, { actor });",
    "        return res.status(result.verdict === 'pass' ? 200 : 409).json({ success: result.verdict === 'pass', result, error: result.verdict === 'pass' ? undefined : 'narrative_continuity_blocked' });",
    "      } catch (error) {",
    "        const code = String(error?.code || error?.message || '').startsWith('narrative_continuity_') ? 409 : 400;",
    "        return res.status(code).json({ success: false, error: error.code || error.message, details: { expectedEpisode: error.expectedEpisode || null, requestedEpisode: error.requestedEpisode || null, dependencies: error.dependencies || [] } });",
    "      }",
    "    });",
    "    this.app.get('/api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/reports', protect, async (req, res) => {",
    "      try { const result = await this.narrativeContinuityGateService.listReports(req.params.seriesId, Number(req.params.episodeNumber), req.query.limit || 100); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    "    this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/verify-pass', protect, async (req, res) => {",
    "      try { const result = await this.narrativeContinuityGateService.verifyPassingReport(req.params.seriesId, Number(req.params.episodeNumber), req.body || {}); return res.status(result.valid ? 200 : 409).json({ success: result.valid, result, error: result.valid ? undefined : result.reason }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.code || error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Narrative Continuity Gate API routes');
  write('index.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:narrative-continuity-gate'] = 'node ../bootstrap/verify-phase11-cross-episode-narrative-continuity.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_NARRATIVE_CONTINUITY_GATE_ENABLED=')) {
    env += `\n# Phase 11.12.8 — approval-blocking cross-episode narrative continuity gate.\nSERIALIZED_NARRATIVE_CONTINUITY_GATE_ENABLED=true\n# Episode Memory finalization requires an exact, fresh PASS report.\nSERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_PASS=true\n# Optional structured manifest can be made mandatory for channels that require strict character/relationship transition declarations.\nSERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_MANIFEST=false\n# Open plot threads at/above this priority block if neither addressed nor explicitly deferred.\nSERIALIZED_NARRATIVE_CONTINUITY_BLOCK_THREAD_PRIORITY=90\n# Open plot threads at/above this lower priority emit warnings when not addressed.\nSERIALIZED_NARRATIVE_CONTINUITY_WARN_THREAD_PRIORITY=70\n`;
  }
  write('.env.example', env);
}

copyService();
patchDatabase();
patchEpisodeMemoryApprovalGate();
patchIndexApi();
patchPackageAndEnv();
console.log('FASE 11.12.8 ativa: Cross-Episode Narrative Continuity Gate auditado, fail-closed e obrigatorio antes da finalizacao de Episode Memory.');