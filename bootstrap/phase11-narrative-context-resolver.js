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
  if (index === -1) throw new Error(`Phase 11.12.7 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.12.7 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  let service = template('narrative-context-resolver-v12.js');
  // Keep the checked-in template deterministic even if an older draft used an unnamed object-literal expression.
  service = service.replace(
    "promptContext = buildPromptContext({ bible, targetEpisode, focus, selected, hash(JSON.stringify(stable(fingerprintSeed))).slice(0, 32), maxPromptChars: this.maxPromptChars, sourceValidation });",
    "promptContext = buildPromptContext({ bible, targetEpisode, focus, selected, fingerprint: hash(JSON.stringify(stable(fingerprintSeed))).slice(0, 32), maxPromptChars: this.maxPromptChars, sourceValidation });"
  );
  write('utils/narrative-context-resolver-v12.js', service);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(
    s,
    "const { PlotThreadRegistryServiceV12 } = require('./utils/plot-thread-registry-v12');\n",
    "const { PlotThreadRegistryServiceV12 } = require('./utils/plot-thread-registry-v12');\nconst { NarrativeContextResolverV12 } = require('./utils/narrative-context-resolver-v12');\n",
    'Narrative Context Resolver API import'
  );
  s = replaceOnce(
    s,
    "    this.plotThreadRegistryService = null;\n",
    "    this.plotThreadRegistryService = null;\n    this.narrativeContextResolverService = null;\n",
    'Narrative Context Resolver API property'
  );
  s = replaceOnce(
    s,
    "      this.plotThreadRegistryService = new PlotThreadRegistryServiceV12(this.db, { logger: this.logger });\n",
    "      this.plotThreadRegistryService = new PlotThreadRegistryServiceV12(this.db, { logger: this.logger });\n      this.narrativeContextResolverService = new NarrativeContextResolverV12(this.db, { logger: this.logger });\n",
    'Narrative Context Resolver initialization'
  );

  const routes = [
    "    this.app.post('/api/series-bibles/:seriesId/narrative-context/resolve', protect, async (req, res) => {",
    "      try {",
    "        const bible = await this.db.getSerializedSeriesBible(req.params.seriesId);",
    "        if (!bible) return res.status(404).json({ success: false, error: 'Series Bible not found' });",
    "        const episodeNumber = Math.max(1, Number(req.body?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);",
    "        const serializedSeriesContext = { active: bible.status === 'active', bible, binding: { episodeNumber } };",
    "        const result = await this.narrativeContextResolverService.resolveContext(serializedSeriesContext, { ...(req.body || {}), episodeNumber });",
    "        return res.json({ success: true, result });",
    "      } catch (error) {",
    "        const code = String(error?.code || error?.message || '').startsWith('narrative_context_') ? 409 : 400;",
    "        return res.status(code).json({ success: false, error: error.code || error.message, details: { source: error.source || null, blockers: error.blockers || [], missing: error.missing || [], dependency: error.dependency || null, dependencies: error.dependencies || [] } });",
    "      }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Narrative Context Resolver API route');
  write('index.js', s);
}

function patchScriptWriter() {
  let s = read('agents/script-writer-agent.js');
  s = replaceOnce(
    s,
    "const { PlotThreadRegistryServiceV12 } = require('../utils/plot-thread-registry-v12');\n",
    "const { PlotThreadRegistryServiceV12 } = require('../utils/plot-thread-registry-v12');\nconst { NarrativeContextResolverV12 } = require('../utils/narrative-context-resolver-v12');\n",
    'Narrative Context Resolver Script Writer import'
  );
  s = replaceOnce(
    s,
    "    this.plotThreadRegistry = new PlotThreadRegistryServiceV12(db, { logger: this.logger });\n",
    "    this.plotThreadRegistry = new PlotThreadRegistryServiceV12(db, { logger: this.logger });\n    this.narrativeContextResolver = new NarrativeContextResolverV12(db, { logger: this.logger });\n",
    'Narrative Context Resolver Script Writer service'
  );

  const oldContextBlock = [
    "    const serializedSeriesContext = await this.serializedSeriesBible.getScriptContext(strategy);",
    "    const serializedSeriesPrompt = serializedSeriesContext.promptContext || '';",
    "    const canonicalTimelineContext = await this.canonicalTimeline.getScriptContext(serializedSeriesContext);",
    "    const canonicalTimelinePrompt = canonicalTimelineContext.promptContext || '';",
    "    const episodeMemoryContext = await this.episodeMemory.getScriptContext(serializedSeriesContext);",
    "    const episodeMemoryPrompt = episodeMemoryContext.promptContext || '';",
    "    const characterArcContext = await this.characterArcMemory.getScriptContext(serializedSeriesContext);",
    "    const characterArcPrompt = characterArcContext.promptContext || '';",
    "    const relationshipGraphContext = await this.relationshipStateGraph.getScriptContext(serializedSeriesContext);",
    "    const relationshipGraphPrompt = relationshipGraphContext.promptContext || '';",
    "    const plotThreadContext = await this.plotThreadRegistry.getScriptContext(serializedSeriesContext);",
    "    const plotThreadPrompt = plotThreadContext.promptContext || '';",
    ""
  ].join('\n');
  const newContextBlock = [
    "    const serializedSeriesContext = await this.serializedSeriesBible.getScriptContext(strategy);",
    "    const narrativeContext = await this.narrativeContextResolver.resolveForScript(serializedSeriesContext, strategy);",
    "    const narrativeContextPrompt = narrativeContext.promptContext || '';",
    ""
  ].join('\n');
  s = replaceOnce(s, oldContextBlock, newContextBlock, 'replace six independent narrative prompt dumps with one resolved packet');
  s = replaceOnce(
    s,
    '${evidencePolicy}\\n${serializedSeriesPrompt}\\n${canonicalTimelinePrompt}\\n${episodeMemoryPrompt}\\n${characterArcPrompt}\\n${relationshipGraphPrompt}\\n${plotThreadPrompt}\\nEvidence packet:',
    '${evidencePolicy}\\n${narrativeContextPrompt}\\nEvidence packet:',
    'inject unified Narrative Context packet into AI script prompt'
  );
  write('agents/script-writer-agent.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:narrative-context-resolver'] = 'node ../bootstrap/verify-phase11-narrative-context-resolver.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  let env = read('.env.example');
  if (!env.includes('SERIALIZED_NARRATIVE_CONTEXT_RESOLVER_ENABLED=')) {
    env += `\n# Phase 11.12.7 — deterministic read-only resolver across all serialized narrative memory layers.\nSERIALIZED_NARRATIVE_CONTEXT_RESOLVER_ENABLED=true\n# Global character budget for the unified narrative context packet.\nSERIALIZED_NARRATIVE_CONTEXT_MAX_CHARS=56000\n# Maximum selected memory items across all source layers.\nSERIALIZED_NARRATIVE_CONTEXT_MAX_ITEMS=80\n# Exact focus references fail closed instead of fuzzy-matching another canonical entity.\nSERIALIZED_NARRATIVE_CONTEXT_STRICT_FOCUS=true\n`;
  }
  write('.env.example', env);
}

copyService();
patchIndexApi();
patchScriptWriter();
patchPackageAndEnv();
console.log('FASE 11.12.7 ativa: Narrative Context Resolver deterministico, historico as-of, provenance-aware, global-budgeted e read-only no roteirista.');
