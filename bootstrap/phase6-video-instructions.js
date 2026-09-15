'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function insertAfterAny(text, anchors, block, label) {
  if (text.includes(block.trim())) return text;
  for (const anchor of anchors) {
    const index = text.indexOf(anchor);
    if (index !== -1) {
      const insertAt = index + anchor.length;
      return text.slice(0, insertAt) + block + text.slice(insertAt);
    }
  }
  throw new Error(`Anchor not found for ${label}`);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'video-instructions-v6.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/video-instructions-v6.js');
  write('utils/video-instructions-v6.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    '      strategyContext: input.strategyContext || {},\n',
    "      strategyContext: input.strategyContext || {},\n      videoInstructions: typeof input.instructions === 'string' ? input.instructions.trim().slice(0, 4000) : '',\n      instructionVersion: 6,\n",
    'persist video instructions in generation job details'
  );
  write(rel, s);
}

function patchIndex() {
  const rel = 'index.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { normalizeGenerationArtifact } = require('./utils/content-contracts');\n",
    "const { normalizeGenerationArtifact } = require('./utils/content-contracts');\nconst { normalizeVideoInstructions, instructionEnvelope } = require('./utils/video-instructions-v6');\n",
    'video instruction runtime import'
  );

  s = replaceOnce(
    s,
    "      length: typeof body.length === 'string' ? body.length.toLowerCase() : 'medium',\n      strategyContext: null\n",
    "      length: typeof body.length === 'string' ? body.length.toLowerCase() : 'medium',\n      instructions: '',\n      strategyContext: null\n",
    'generation request instruction field'
  );

  const strategyContextAnchor = '    if (body.strategyContext !== undefined && body.strategyContext !== null) {\n';
  const instructionValidation = `    if (body.instructions !== undefined && body.instructions !== null) {\n      try {\n        value.instructions = normalizeVideoInstructions(body.instructions);\n      } catch (error) {\n        return { valid: false, status: error.status || 400, error: error.message };\n      }\n    }\n\n`;
  s = insertBefore(s, strategyContextAnchor, instructionValidation, 'video instruction request validation');

  s = replaceOnce(
    s,
    "        const { topic, style, length } = validation.value;\n        const result = await this.startGenerationJob({ topic, style, length, source: 'manual' });\n",
    "        const result = await this.startGenerationJob({ ...validation.value, source: 'manual' });\n",
    'manual generate forwards instructions'
  );

  s = replaceOnce(
    s,
    "      length: job.length || 'medium',\n      strategyContext: job.details?.strategyContext || {}\n",
    "      length: job.length || 'medium',\n      instructions: job.details?.videoInstructions || '',\n      strategyContext: job.details?.strategyContext || {}\n",
    'resume restores video instructions'
  );

  s = replaceOnce(
    s,
    "        jobId,\n        strategyContext: input.strategyContext\n      });\n",
    "        jobId,\n        strategyContext: input.strategyContext,\n        instructions: input.instructions\n      });\n",
    'run job forwards video instructions'
  );

  const instructionBootstrap = "    const videoInstructions = normalizeVideoInstructions(options.instructions || strategyContext.videoInstructions || '');\n    const instructionContext = instructionEnvelope(videoInstructions);\n";
  s = insertAfterAny(
    s,
    [
      "    const { jobId = null } = options;\n    const strategyContext = options.strategyContext || {};\n",
      "    const { jobId = null, strategyContext = {} } = options;\n"
    ],
    instructionBootstrap,
    'normalize instructions at pipeline boundary'
  );

  s = replaceOnce(
    s,
    '      generated.callToAction = profile.call_to_action || null;\n',
    "      generated.callToAction = profile.call_to_action || null;\n      generated.videoInstructions = videoInstructions;\n      generated.instructionContext = instructionContext;\n",
    'attach instructions to canonical strategy'
  );

  s = replaceOnce(
    s,
    '          jobId, topic: generated.topic, seedSources: generated.researchSources\n',
    '          jobId, topic: generated.topic, seedSources: generated.researchSources, instructions: generated.videoInstructions\n',
    'research receives new-job instructions'
  );
  s = replaceOnce(
    s,
    '        jobId, topic: strategy.topic, seedSources: strategy.researchSources || []\n',
    '        jobId, topic: strategy.topic, seedSources: strategy.researchSources || [], instructions: strategy.videoInstructions || videoInstructions\n',
    'research migration receives instructions'
  );

  s = replaceOnce(
    s,
    '      job.researchEvidence = await this.db.getResearchEvidencePack(job.id);\n',
    "      job.videoInstructions = job.details?.videoInstructions || '';\n      job.researchEvidence = await this.db.getResearchEvidencePack(job.id);\n",
    'job detail exposes instructions'
  );
  write(rel, s);
}

function patchResearch() {
  const rel = 'utils/research-evidence-v5.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const axios = require('axios');\n",
    "const axios = require('axios');\nconst { instructionEnvelope } = require('./video-instructions-v6');\n",
    'research instruction import'
  );
  s = replaceOnce(
    s,
    "    const topic = cleanText(input.topic, 300);\n",
    "    const topic = cleanText(input.topic, 300);\n    const instructionContext = instructionEnvelope(input.instructions);\n    const researchQuery = [topic, instructionContext.researchFocus].filter(Boolean).join(' ');\n",
    'research instruction context'
  );
  s = replaceOnce(s, "['wikipedia', () => this.searchWikipedia(topic)],\n      ['crossref', () => this.searchCrossref(topic)],\n      ['openalex', () => this.searchOpenAlex(topic)]", "['wikipedia', () => this.searchWikipedia(researchQuery)],\n      ['crossref', () => this.searchCrossref(researchQuery)],\n      ['openalex', () => this.searchOpenAlex(researchQuery)]", 'instruction-aware research queries');
  s = replaceOnce(
    s,
    '      topic,\n      status: verified > 0',
    '      topic,\n      instructionContext,\n      status: verified > 0',
    'persist instruction context in evidence pack'
  );
  write(rel, s);
}

function patchScriptWriter() {
  const rel = 'agents/script-writer-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { EvidenceDeskV5 } = require('../utils/research-evidence-v5');\n",
    "const { EvidenceDeskV5 } = require('../utils/research-evidence-v5');\nconst { promptInstructionBlock } = require('../utils/video-instructions-v6');\n",
    'script instruction import'
  );
  s = replaceOnce(
    s,
    '    const prompt = `You are writing a YouTube script plan.\n',
    "    const instructionBlock = promptInstructionBlock(strategy.videoInstructions);\n    const prompt = `You are writing a YouTube script plan.\n",
    'script instruction block construction'
  );
  s = replaceOnce(
    s,
    'Evidence packet: ${JSON.stringify((strategy.evidencePack?.sources || strategy.researchSources || []).slice(0, 12).map(source => ({',
    '${instructionBlock}\nEvidence packet: ${JSON.stringify((strategy.evidencePack?.sources || strategy.researchSources || []).slice(0, 12).map(source => ({',
    'script prompt receives video instructions'
  );
  s = replaceOnce(
    s,
    "      this.logger.info('Using template script generation');\n",
    "      if (strategy.videoInstructions) {\n        const error = new Error('Video-specific instructions could not be applied because AI script generation failed; refusing generic template fallback.');\n        error.code = 'VIDEO_INSTRUCTIONS_UNAPPLIED';\n        error.status = 422;\n        throw error;\n      }\n      this.logger.info('Using template script generation');\n",
    'do not silently ignore instructions in script fallback'
  );
  write(rel, s);
}

function patchSEO() {
  const rel = 'agents/seo-optimizer-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { AITextService } = require('../utils/ai-text-service');\n",
    "const { AITextService } = require('../utils/ai-text-service');\nconst { promptInstructionBlock } = require('../utils/video-instructions-v6');\n",
    'SEO instruction import'
  );
  s = replaceOnce(
    s,
    '    const prompt = `You are optimizing YouTube metadata.\n',
    "    const instructionBlock = promptInstructionBlock(strategy.videoInstructions);\n    const prompt = `You are optimizing YouTube metadata.\n",
    'SEO instruction block construction'
  );
  s = replaceOnce(
    s,
    'Video title: ${script.title}\n',
    '${instructionBlock}\nVideo title: ${script.title}\n',
    'SEO prompt receives instructions'
  );
  write(rel, s);
}

function patchThumbnail() {
  const rel = 'agents/thumbnail-designer-agent.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    '      effects: this.selectEffects()\n',
    "      effects: this.selectEffects(),\n      videoInstructions: script.metadata?.strategy?.videoInstructions || ''\n",
    'thumbnail concept retains instructions'
  );
  s = replaceOnce(
    s,
    '    Format: High contrast, bold text, clear imagery`;\n',
    "    Format: High contrast, bold text, clear imagery\n    Video-specific direction: ${concept.videoInstructions || 'none'}\n    Apply that direction only when compatible with factual accuracy, rights, safety, and platform requirements.`;\n",
    'thumbnail prompt receives instructions'
  );
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { buildInitialSceneManifest } = require('./scene-repair-service');\n",
    "const { buildInitialSceneManifest } = require('./scene-repair-service');\nconst { visualInstructionSuffix } = require('./video-instructions-v6');\n",
    'scene visual instruction import'
  );
  s = replaceOnce(
    s,
    '      scenes = buildInitialSceneManifest(cleanProduction, {});\n      scenes = await this.db.replaceProductionScenes(production.id, scenes);\n',
    "      scenes = buildInitialSceneManifest(cleanProduction, {});\n      const visualDirection = visualInstructionSuffix(production.strategy?.videoInstructions || production.script?.metadata?.strategy?.videoInstructions || '');\n      if (visualDirection) scenes = scenes.map(scene => ({ ...scene, prompt: `${scene.prompt || scene.label || ''}${visualDirection}` }));\n      scenes = await this.db.replaceProductionScenes(production.id, scenes);\n",
    'scene prompts receive video-specific visual direction'
  );
  write(rel, s);
}

function patchDashboard() {
  const htmlRel = 'dashboard/index.html';
  let html = read(htmlRel);
  html = replaceOnce(
    html,
    '      <label><span>Topic <small>optional—leave blank for agent selection</small></span><input name="topic" maxlength="200" placeholder="How small teams can automate repetitive work"></label>\n      <div class="form-grid two">',
    '      <label><span>Topic <small>optional—leave blank for agent selection</small></span><input name="topic" maxlength="200" placeholder="How small teams can automate repetitive work"></label>\n      <label><span>Instructions <small>optional—applies only to this video</small></span><textarea name="instructions" rows="5" maxlength="4000" placeholder="Example: Focus on NIST atomic-clock experiments, explain for a non-technical audience, avoid speculative claims, prefer diagrams over generic sci-fi imagery."></textarea><small>Preferences travel through research, script, SEO, thumbnail, visuals, resume, and review. Evidence, safety, rights, and approval rules always take priority.</small></label>\n      <div class="form-grid two">',
    'new generation instruction field'
  );
  write(htmlRel, html);

  const appRel = 'dashboard/app.js';
  let app = read(appRel);
  app = replaceOnce(
    app,
    "    const publishTime = data.publishTime || item.schedule?.publish_time || item.scheduled_publish_time;\n",
    "    const publishTime = data.publishTime || item.schedule?.publish_time || item.scheduled_publish_time;\n    const videoInstructions = item.strategy?.videoInstructions || item.script?.metadata?.strategy?.videoInstructions || '';\n",
    'review instruction value'
  );
  app = replaceOnce(
    app,
    '        ${renderSceneEditor(item, canReview)}\n',
    '        ${videoInstructions ? `<section class="panel instruction-review"><div class="panel-heading"><div><p class="eyebrow">VIDEO INSTRUCTIONS</p><h3>Per-video direction</h3></div></div><p>${escapeHTML(videoInstructions)}</p><small>These preferences never override evidence, safety, rights, platform, approval, or publishing guardrails.</small></section>` : \'\'}\n        ${renderSceneEditor(item, canReview)}\n',
    'review displays per-video instructions'
  );
  write(appRel, app);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:instructions'] = 'node ../bootstrap/verify-phase6-video-instructions.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyService();
patchDatabase();
patchIndex();
patchResearch();
patchScriptWriter();
patchSEO();
patchThumbnail();
patchScenePipeline();
patchDashboard();
patchPackage();

console.log('Phase 6 video instructions installed: validated per-video direction, persistence/resume, research/script/SEO/media propagation, and review visibility.');
