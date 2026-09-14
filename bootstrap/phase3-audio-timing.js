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

function copyNarrationService() {
  const template = path.join(root, 'bootstrap', 'templates', 'scene-narration-v3.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/scene-narration-v3.js');
  write('utils/scene-narration-v3.js', fs.readFileSync(template, 'utf8'));
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { buildInitialSceneManifest } = require('./scene-repair-service');\n",
    "const { buildInitialSceneManifest } = require('./scene-repair-service');\nconst { SceneNarrationV3 } = require('./scene-narration-v3');\n",
    'scene narration v3 import'
  );
  s = replaceOnce(
    s,
    "    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');\n",
    "    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');\n    this.sceneNarration = new SceneNarrationV3(videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'scene narration v3 constructor'
  );

  const oldBlock = `        const generatedPath = await this.videoGenerator.generateTTSAudio(scene.scriptText, audioPath);\n        const evidence = this.videoGenerator.lastNarrationResult || {};\n        if (!await this.videoGenerator.isUsableAudioFile(generatedPath)) {\n          throw this.error('TTS provider returned no usable narration audio', 'SCENE_NARRATION_UNAVAILABLE');\n        }\n        scene = await this.db.updateProductionScene(productionId, sceneId, {\n          audioPath: generatedPath,\n          narrationStatus: 'current',\n          narrationProvider: evidence.provider || 'configured-tts',\n          narrationModel: evidence.model || null,\n          narrationTaskId: evidence.externalTaskId || null,\n          narrationError: null,\n          narrationGeneratedAt: evidence.generatedAt || new Date().toISOString(),\n          narrationCost: evidence.cost || {},\n          status: 'ready'\n        });\n        await this.db.saveProductionSceneRevision({\n          productionId, sceneId, action: 'initial_narration', before, after: scene,\n          costEvidence: evidence.cost || {}\n        });`;
  const newBlock = `        const narration = await this.sceneNarration.generate(productionId, scene);\n        const evidence = {\n          provider: narration.provider,\n          model: narration.model,\n          externalTaskId: narration.externalTaskId,\n          generatedAt: narration.generatedAt,\n          cost: { ...(narration.cost || {}), phase3: narration.manifest }\n        };\n        scene = await this.db.updateProductionScene(productionId, sceneId, {\n          audioPath: narration.path,\n          duration: narration.duration,\n          narrationStatus: 'current',\n          narrationProvider: evidence.provider || 'configured-tts',\n          narrationModel: evidence.model || null,\n          narrationTaskId: evidence.externalTaskId || null,\n          narrationError: null,\n          narrationGeneratedAt: evidence.generatedAt || new Date().toISOString(),\n          narrationCost: evidence.cost || {},\n          status: 'ready'\n        });\n        await this.db.saveProductionSceneRevision({\n          productionId, sceneId, action: 'initial_narration', before, after: scene,\n          costEvidence: evidence.cost || {}\n        });`;
  s = replaceOnce(s, oldBlock, newBlock, 'scene-first narration v3 generation');

  s = replaceOnce(
    s,
    "        generatedWith: 'scene-pipeline-v2'\n",
    "        generatedWith: 'scene-pipeline-v2',\n        narrationTiming: 'measured-audio-v3'\n",
    'scene media summary timing marker'
  );
  write(rel, s);
}

function patchSceneRepair() {
  const rel = 'utils/scene-repair-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { ProvenanceService } = require('./provenance-service');\n",
    "const { ProvenanceService } = require('./provenance-service');\nconst { SceneNarrationV3 } = require('./scene-narration-v3');\n",
    'scene repair narration v3 import'
  );
  s = replaceOnce(
    s,
    "    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');\n",
    "    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');\n    this.sceneNarration = new SceneNarrationV3(videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'scene repair narration v3 constructor'
  );

  const oldNarrationRepair = `      const generatedPath = await this.videoGenerator.generateTTSAudio(scene.scriptText, outputPath);\n      const evidence = this.videoGenerator.lastNarrationResult || {};\n      if (!await this.videoGenerator.isUsableAudioFile(generatedPath)) {\n        throw this.error('Narration regeneration returned no usable audio; configure a live TTS provider and retry', 422, 'NARRATION_UNAVAILABLE');\n      }\n      const cost = evidence.cost || {\n        provider: evidence.provider || 'configured-tts', amount: null, currency: null, invoiceRequired: true\n      };`;
  const newNarrationRepair = `      const narration = await this.sceneNarration.generate(\n        productionId,\n        { ...scene, revision: scene.revision + 1 },\n        { force: scene.narrationStatus === 'current' }\n      );\n      const generatedPath = narration.path;\n      const evidence = {\n        provider: narration.provider,\n        model: narration.model,\n        externalTaskId: narration.externalTaskId,\n        generatedAt: narration.generatedAt,\n        cost: { ...(narration.cost || {}), phase3: narration.manifest }\n      };\n      const cost = evidence.cost || {\n        provider: evidence.provider || 'configured-tts', amount: null, currency: null, invoiceRequired: true\n      };`;
  s = replaceOnce(s, oldNarrationRepair, newNarrationRepair, 'manual narration regeneration through phase 3');
  s = replaceOnce(
    s,
    "        audioPath: generatedPath,\n        narrationStatus: 'current',\n",
    "        audioPath: generatedPath,\n        duration: narration.duration,\n        narrationStatus: 'current',\n",
    'manual narration measured duration'
  );

  const oldRegenerateNarration = `        const generatedPath = await this.videoGenerator.generateTTSAudio(scene.scriptText, audioPath);\n        if (!await this.videoGenerator.isUsableAudioFile(generatedPath)) {\n          throw this.error('Narration regeneration returned a simulation; configure a live TTS provider before rebuilding edited narration', 422, 'NARRATION_UNAVAILABLE');\n        }\n        const evidence = this.videoGenerator.lastNarrationResult || {};\n        narration = {\n          audioPath: generatedPath, narrationStatus: 'current',\n          narrationProvider: evidence.provider || 'configured-tts', narrationModel: evidence.model || null,\n          narrationTaskId: evidence.externalTaskId || null, narrationError: null,\n          narrationGeneratedAt: evidence.generatedAt || new Date().toISOString(), narrationCost: evidence.cost || {}\n        };`;
  const newRegenerateNarration = `        const narrationResult = await this.sceneNarration.generate(\n          productionId,\n          { ...scene, revision: scene.revision + 1 },\n          { force: scene.narrationStatus === 'current' && input.regenerateNarration === true }\n        );\n        narration = {\n          audioPath: narrationResult.path, duration: narrationResult.duration, narrationStatus: 'current',\n          narrationProvider: narrationResult.provider || 'configured-tts', narrationModel: narrationResult.model || null,\n          narrationTaskId: narrationResult.externalTaskId || null, narrationError: null,\n          narrationGeneratedAt: narrationResult.generatedAt || new Date().toISOString(),\n          narrationCost: { ...(narrationResult.cost || {}), phase3: narrationResult.manifest }\n        };`;
  s = replaceOnce(s, oldRegenerateNarration, newRegenerateNarration, 'scene regenerate narration through phase 3');

  s = replaceOnce(
    s,
    "      captions: { path: captionsPath, format: 'srt', language: 'en', autoGenerated: true, sceneAware: true },\n",
    "      captions: { path: captionsPath, format: 'srt', language: 'en', autoGenerated: true, sceneAware: true, timingSource: 'measured-scene-audio', alignment: 'scene-proportional' },\n",
    'caption timing metadata'
  );
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:scenes'] = 'node ../bootstrap/verify-phase2-scenes-v3.js';
  pkg.scripts['test:audio-scenes'] = 'node ../bootstrap/verify-phase3-audio.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyNarrationService();
patchScenePipeline();
patchSceneRepair();
patchPackage();

console.log('Phase 3 audio timing installed: persistent TTS chunks, retry/backoff, measured scene duration, audio-timed captions, and repair-path integration.');
