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

function copyScenePipeline() {
  const template = path.join(root, 'bootstrap', 'templates', 'scene-pipeline-v2.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/scene-pipeline-v2.js');
  write('utils/scene-pipeline-v2.js', fs.readFileSync(template, 'utf8'));
}

function patchProductionManagement() {
  const rel = 'agents/production-management-agent.js';
  let s = read(rel);

  s = replaceOnce(
    s,
    "const { SceneRepairService } = require('../utils/scene-repair-service');\n",
    "const { SceneRepairService } = require('../utils/scene-repair-service');\nconst { ScenePipelineV2 } = require('../utils/scene-pipeline-v2');\n",
    'scene pipeline import'
  );

  s = replaceOnce(
    s,
    "    this.sceneRepair = new SceneRepairService(db, this.aiVideoGenerator, { logger: this.logger });\n",
    "    this.sceneRepair = new SceneRepairService(db, this.aiVideoGenerator, { logger: this.logger });\n    this.scenePipeline = new ScenePipelineV2(db, this.aiVideoGenerator, this.sceneRepair, { logger: this.logger });\n",
    'scene pipeline constructor'
  );

  s = replaceOnce(
    s,
    "      const productionId = this.generateProductionId();\n",
    "      const productionId = jobId\n        ? `prod_${String(jobId).replace(/[^a-zA-Z0-9_-]/g, '_')}`\n        : this.generateProductionId();\n      const existingProduction = jobId ? await this.db.getProductionBundle(productionId) : null;\n",
    'stable production id per generation job'
  );

  s = replaceOnce(
    s,
    `        assets: {\n          script: await this.processScript(script),\n          thumbnail: await this.processThumbnail(thumbnail, script),\n          audio: null, // Will be generated later\n          video: null, // Will be generated later\n          captions: null // Will be generated later\n        },\n        timeline: {\n          created: new Date().toISOString(),\n          scriptReady: new Date().toISOString(),\n          thumbnailReady: new Date().toISOString(),\n          audioGenerated: null,\n          videoGenerated: null,\n          captionsGenerated: null,\n          readyForUpload: null\n        },`,
    `        assets: {\n          ...(existingProduction?.assets || {}),\n          script: await this.processScript(script),\n          thumbnail: await this.processThumbnail(thumbnail, script),\n          audio: existingProduction?.assets?.audio || null,\n          video: existingProduction?.assets?.video || null,\n          captions: existingProduction?.assets?.captions || null\n        },\n        timeline: existingProduction?.timeline || {\n          created: new Date().toISOString(),\n          scriptReady: new Date().toISOString(),\n          thumbnailReady: new Date().toISOString(),\n          audioGenerated: null,\n          videoGenerated: null,\n          captionsGenerated: null,\n          readyForUpload: null\n        },`,
    'preserve scene artifacts across production resume'
  );

  s = replaceOnce(
    s,
    `      // Save to database\n      await this.db.saveProductionData(productionData);\n      \n      // Generate video content\n      await this.generateVideoContent(productionData);\n      \n      // Generate audio narration\n      await this.generateAudioNarration(productionData);\n      \n      // Generate captions\n      await this.generateCaptions(productionData);\n      \n      // Final assembly\n      await this.assembleVideo(productionData);\n\n      // Persist a scene-addressable production manifest for selective review and repair.\n      await this.sceneRepair.initializeProduction(productionData, this.aiVideoGenerator.lastVideoResult || {});\n`,
    `      // Persist before scene work so every generated scene has a stable production parent.\n      if (existingProduction) {\n        await this.db.updateProductionData(productionData);\n      } else {\n        await this.db.saveProductionData(productionData);\n      }\n      if (jobId) {\n        await this.db.updateGenerationJob(jobId, { productionId });\n      }\n\n      // Scene-first production: each scene owns its visual/narration state and can resume independently.\n      await this.scenePipeline.run(productionData);\n      const refreshed = await this.db.getProductionBundle(productionId);\n      if (!refreshed) throw new Error(`Scene pipeline completed but production ${productionId} could not be reloaded`);\n      productionData.assets = refreshed.assets || productionData.assets;\n      productionData.timeline = refreshed.timeline || productionData.timeline;\n      productionData.status = refreshed.status || productionData.status;\n      productionData.containsSyntheticMedia = Boolean(\n        (refreshed.scenes || []).some(scene => scene.containsSyntheticMedia)\n      );\n`,
    'replace monolithic production with scene-first pipeline'
  );

  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:scenes'] = 'node ../bootstrap/verify-phase2-scenes.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyScenePipeline();
patchProductionManagement();
patchPackage();

console.log('Phase 2 scene pipeline installed: stable production ids, persistent per-scene states, granular resume, and scene-first rebuild.');
