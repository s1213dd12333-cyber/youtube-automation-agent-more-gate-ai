'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const Module = require('module');

const servicePath = path.resolve(__dirname, '..', 'upstream', 'utils', 'scene-pipeline-v2.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 2 service is not materialized: utils/scene-pipeline-v2.js');

let planGeneration = 0;
function fakeBuildInitialSceneManifest(production) {
  planGeneration += 1;
  return (production.script?.mainContent?.sections || []).map((section, position) => ({
    id: `scene_plan${planGeneration}_${position + 1}`,
    position,
    label: section.title,
    scriptText: Array.isArray(section.content) ? section.content.join(' ') : String(section.content || ''),
    prompt: `${section.title}. ${Array.isArray(section.content) ? section.content.join(' ') : section.content || ''}`,
    duration: Number(section.duration || 10),
    assetType: 'missing',
    assetOrigin: 'generated',
    assetPath: null,
    audioPath: null,
    provider: null,
    model: null,
    externalTaskId: null,
    status: 'planned',
    narrationStatus: 'pending',
    narrationProvider: null,
    narrationModel: null,
    narrationTaskId: null,
    narrationError: null,
    narrationGeneratedAt: null,
    narrationCost: {},
    revision: 1,
    locked: false,
    rightsConfirmed: true,
    provenanceSourceIds: [],
    containsSyntheticMedia: false,
    estimatedCost: {},
    actualCost: {}
  }));
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './scene-repair-service' && parent?.filename === servicePath) {
    return { buildInitialSceneManifest: fakeBuildInitialSceneManifest };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { ScenePipelineV2 } = require(servicePath);
Module._load = originalLoad;

const clone = value => JSON.parse(JSON.stringify(value));

async function main() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-phase2-'));
  const state = {
    scenes: [],
    revisions: [],
    bundle: {
      id: 'prod_job_phase2',
      status: 'processing',
      assets: {},
      timeline: {},
      priority: 50,
      scheduled_publish_time: null
    }
  };

  const db = {
    async getProductionBundle() {
      return { ...clone(state.bundle), scenes: clone(state.scenes) };
    },
    async listProductionScenes() {
      return clone(state.scenes);
    },
    async replaceProductionScenes(_productionId, scenes) {
      state.scenes = clone(scenes);
      return clone(state.scenes);
    },
    async updateProductionScene(_productionId, sceneId, changes) {
      const index = state.scenes.findIndex(scene => scene.id === sceneId);
      if (index < 0) return null;
      state.scenes[index] = { ...state.scenes[index], ...clone(changes) };
      return clone(state.scenes[index]);
    },
    async saveProductionSceneRevision(input) {
      state.revisions.push(clone(input));
      return input;
    },
    async updateProductionData(input) {
      state.bundle = {
        ...state.bundle,
        status: input.status ?? state.bundle.status,
        assets: clone(input.assets ?? state.bundle.assets),
        timeline: clone(input.timeline ?? state.bundle.timeline),
        priority: input.priority ?? state.bundle.priority,
        scheduled_publish_time: input.scheduledPublishTime ?? state.bundle.scheduled_publish_time
      };
      return state.bundle;
    }
  };

  let visualCalls = 0;
  let narrationCalls = 0;
  let failSecondNarrationOnce = true;
  const videoGenerator = {
    lastNarrationResult: null,
    async generateVisualAssets(_prompt) {
      visualCalls += 1;
      const output = path.join(temp, `visual_${visualCalls}.png`);
      await fsp.writeFile(output, Buffer.from('real-image-placeholder-for-contract-test'));
      return [output];
    },
    async generateTTSAudio(text, outputPath) {
      narrationCalls += 1;
      if (text.includes('Second') && failSecondNarrationOnce) {
        failSecondNarrationOnce = false;
        this.lastNarrationResult = { provider: 'fake-tts', model: 'fake', generatedAt: new Date().toISOString(), cost: {} };
        throw new Error('intentional narration failure');
      }
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, Buffer.from(`audio:${text}`));
      this.lastNarrationResult = { provider: 'fake-tts', model: 'fake', generatedAt: new Date().toISOString(), cost: {} };
      return outputPath;
    },
    async isUsableAudioFile(filePath) {
      try { return (await fsp.stat(filePath)).size > 0; } catch (_error) { return false; }
    }
  };

  let rebuildCalls = 0;
  const sceneRepair = {
    async rebuild() {
      rebuildCalls += 1;
      const finalPath = path.join(temp, `final_${rebuildCalls}.mp4`);
      await fsp.writeFile(finalPath, Buffer.from('video'));
      state.bundle.status = 'ready';
      state.bundle.assets = { ...state.bundle.assets, finalVideo: { path: finalPath, simulated: false } };
      return { finalVideo: finalPath, scenes: state.scenes.length };
    }
  };

  const pipeline = new ScenePipelineV2(db, videoGenerator, sceneRepair, {
    dataRoot: temp,
    logger: { info() {}, warn() {}, error() {} }
  });

  const production = {
    id: 'prod_job_phase2',
    status: 'processing',
    assets: {},
    timeline: {},
    priority: 50,
    script: {
      title: 'Phase 2 test',
      mainContent: {
        sections: [
          { title: 'Scene One', content: ['First narration'], duration: 8 },
          { title: 'Scene Two', content: ['Second narration'], duration: 9 }
        ]
      }
    }
  };

  let failed = false;
  try {
    await pipeline.run(production);
  } catch (error) {
    failed = error.code === 'SCENE_PRODUCTION_FAILED' && error.scenePosition === 1 && error.sceneStage === 'narration';
  }
  assert.strictEqual(failed, true, 'first run must persist and surface the failed second-scene narration');
  assert.strictEqual(state.scenes.length, 2, 'scene plan must be persisted');
  const stableIds = state.scenes.map(scene => scene.id);
  assert.strictEqual(state.scenes[0].status, 'ready', 'completed scene must remain ready');
  assert.strictEqual(state.scenes[1].status, 'narration_failed', 'failed scene stage must be explicit');
  assert.strictEqual(visualCalls, 2, 'both visuals should be generated once');
  assert.strictEqual(narrationCalls, 2, 'both narrations should be attempted once');
  assert.strictEqual(rebuildCalls, 0, 'final rebuild must not run while a scene is incomplete');

  const resumed = await pipeline.run(production);
  assert.deepStrictEqual(state.scenes.map(scene => scene.id), stableIds, 'resume must preserve scene ids');
  assert.strictEqual(visualCalls, 2, 'resume must not regenerate completed visuals');
  assert.strictEqual(narrationCalls, 3, 'resume must retry only the failed narration');
  assert.ok(state.scenes.every(scene => scene.status === 'ready'), 'all scenes must be ready after granular resume');
  assert.strictEqual(rebuildCalls, 1, 'final video must rebuild exactly once after all scenes are ready');
  assert.strictEqual(resumed.production.status, 'ready', 'production must become ready after rebuild');

  const changed = clone(production);
  changed.script.mainContent.sections[1].content = ['Second narration changed'];
  await pipeline.run(changed);
  assert.notDeepStrictEqual(state.scenes.map(scene => scene.id), stableIds, 'script changes must create a fresh scene plan');
  assert.strictEqual(visualCalls, 4, 'script replan must regenerate the new scene visuals');
  assert.strictEqual(narrationCalls, 5, 'script replan must regenerate the new scene narrations');
  assert.strictEqual(rebuildCalls, 2, 'replanned production must rebuild once');

  const source = fs.readFileSync(path.resolve(__dirname, '..', 'upstream', 'agents', 'production-management-agent.js'), 'utf8');
  assert.ok(source.includes('new ScenePipelineV2'), 'ProductionManagement must instantiate ScenePipelineV2');
  assert.ok(source.includes('await this.scenePipeline.run(productionData)'), 'ProductionManagement must execute scene-first pipeline');
  assert.ok(source.includes('prod_${String(jobId)'), 'production id must be stable per generation job');

  await fsp.rm(temp, { recursive: true, force: true });
  console.log('Phase 2 scene pipeline OK: 12 regression checks passed.');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
