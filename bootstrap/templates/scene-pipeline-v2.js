'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { buildInitialSceneManifest } = require('./scene-repair-service');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

class ScenePipelineV2 {
  constructor(db, videoGenerator, sceneRepair, options = {}) {
    this.db = db;
    this.videoGenerator = videoGenerator;
    this.sceneRepair = sceneRepair;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');
  }

  scriptFingerprint(script = {}) {
    const canonical = JSON.stringify({
      title: script.title || '',
      hook: script.hook || {},
      introduction: script.introduction || {},
      mainContent: script.mainContent || {},
      conclusion: script.conclusion || {},
      callToAction: script.callToAction || {}
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async run(production) {
    if (!production?.id) throw this.error('Scene pipeline requires a production id', 'SCENE_PIPELINE_INVALID');
    const fingerprint = this.scriptFingerprint(production.script || {});
    let bundle = await this.db.getProductionBundle(production.id);
    if (!bundle) throw this.error(`Production ${production.id} was not persisted before scene planning`, 'SCENE_PIPELINE_NOT_PERSISTED');

    let scenes = await this.db.listProductionScenes(production.id);
    const previousFingerprint = bundle.assets?.sceneManifest?.scriptFingerprint || null;
    const scriptChanged = scenes.length > 0 && previousFingerprint && previousFingerprint !== fingerprint;

    if (!scenes.length || scriptChanged) {
      if (scriptChanged) {
        this.logger.warn(`Script contract changed for ${production.id}; rebuilding the scene plan while preserving the production id.`);
      }
      const cleanProduction = {
        ...production,
        assets: {
          ...(production.assets || {}),
          audio: null,
          video: null,
          captions: null,
          finalVideo: null
        }
      };
      scenes = buildInitialSceneManifest(cleanProduction, {});
      scenes = await this.db.replaceProductionScenes(production.id, scenes);
      await this.recordPlanRevision(production.id, scenes, scriptChanged ? 'replan' : 'plan');
      bundle = await this.db.getProductionBundle(production.id) || bundle;
    }

    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged);

    for (const scene of scenes) {
      await this.produceScene(production.id, scene.id);
    }

    scenes = await this.db.listProductionScenes(production.id);
    const blockers = await this.findBlockers(scenes);
    if (blockers.length) {
      const error = this.error(`Scene production is incomplete: ${blockers.join('; ')}`, 'SCENE_PIPELINE_INCOMPLETE');
      error.details = { blockers };
      throw error;
    }

    bundle = await this.db.getProductionBundle(production.id);
    await this.persistMediaSummary(bundle, scenes, fingerprint);
    const rebuildResult = await this.sceneRepair.rebuild(production.id);
    const refreshed = await this.db.getProductionBundle(production.id);
    return { production: refreshed, rebuild: rebuildResult, scenes };
  }

  async produceScene(productionId, sceneId) {
    let scene = (await this.db.listProductionScenes(productionId)).find(item => item.id === sceneId);
    if (!scene) throw this.error(`Scene ${sceneId} no longer exists`, 'SCENE_NOT_FOUND');

    const visualReady = await this.visualReady(scene);
    if (!visualReady) {
      const before = scene;
      await this.db.updateProductionScene(productionId, sceneId, { status: 'generating_visual' });
      try {
        const assets = await this.videoGenerator.generateVisualAssets(scene.prompt, 'documentary', 1);
        const assetPath = Array.isArray(assets) ? assets[0] : null;
        if (!assetPath || !IMAGE_EXTENSIONS.has(path.extname(assetPath).toLowerCase()) || !await this.pathExists(assetPath)) {
          throw this.error('Visual provider returned no usable image', 'SCENE_VISUAL_UNAVAILABLE');
        }
        const local = path.basename(assetPath).startsWith('visual_local_');
        scene = await this.db.updateProductionScene(productionId, sceneId, {
          assetType: 'image',
          assetOrigin: 'generated',
          assetPath,
          provider: local ? 'local-renderer' : 'image-provider',
          model: null,
          externalTaskId: null,
          status: 'visual_ready',
          rightsConfirmed: true,
          containsSyntheticMedia: !local
        });
        await this.db.saveProductionSceneRevision({
          productionId, sceneId, action: 'initial_visual', before, after: scene,
          costEvidence: { billed: false, provider: scene.provider }
        });
      } catch (error) {
        await this.db.updateProductionScene(productionId, sceneId, { status: 'visual_failed' }).catch(() => {});
        await this.db.saveProductionSceneRevision({
          productionId, sceneId, action: 'initial_visual', status: 'failed', before, after: {},
          costEvidence: {}, error: error.message
        }).catch(() => {});
        throw this.sceneError(scene, 'visual', error);
      }
    }

    scene = (await this.db.listProductionScenes(productionId)).find(item => item.id === sceneId);
    const narrationReady = await this.narrationReady(scene);
    if (!narrationReady) {
      const before = scene;
      const audioPath = path.join(
        this.dataRoot,
        'audio',
        'scenes',
        productionId,
        `${String(scene.position).padStart(3, '0')}_r${scene.revision || 1}.mp3`
      );
      await fs.mkdir(path.dirname(audioPath), { recursive: true });
      await this.db.updateProductionScene(productionId, sceneId, {
        status: 'generating_narration', narrationStatus: 'generating', narrationError: null
      });
      try {
        const generatedPath = await this.videoGenerator.generateTTSAudio(scene.scriptText, audioPath);
        const evidence = this.videoGenerator.lastNarrationResult || {};
        if (!await this.videoGenerator.isUsableAudioFile(generatedPath)) {
          throw this.error('TTS provider returned no usable narration audio', 'SCENE_NARRATION_UNAVAILABLE');
        }
        scene = await this.db.updateProductionScene(productionId, sceneId, {
          audioPath: generatedPath,
          narrationStatus: 'current',
          narrationProvider: evidence.provider || 'configured-tts',
          narrationModel: evidence.model || null,
          narrationTaskId: evidence.externalTaskId || null,
          narrationError: null,
          narrationGeneratedAt: evidence.generatedAt || new Date().toISOString(),
          narrationCost: evidence.cost || {},
          status: 'ready'
        });
        await this.db.saveProductionSceneRevision({
          productionId, sceneId, action: 'initial_narration', before, after: scene,
          costEvidence: evidence.cost || {}
        });
      } catch (error) {
        const evidence = this.videoGenerator.lastNarrationResult || {};
        await this.db.updateProductionScene(productionId, sceneId, {
          status: 'narration_failed', narrationStatus: 'failed', narrationError: error.message,
          narrationProvider: evidence.provider || scene.narrationProvider || null,
          narrationModel: evidence.model || scene.narrationModel || null,
          narrationGeneratedAt: evidence.generatedAt || new Date().toISOString(),
          narrationCost: evidence.cost || scene.narrationCost || {}
        }).catch(() => {});
        await this.db.saveProductionSceneRevision({
          productionId, sceneId, action: 'initial_narration', status: 'failed', before, after: {},
          costEvidence: evidence.cost || {}, error: error.message
        }).catch(() => {});
        throw this.sceneError(scene, 'narration', error);
      }
    } else if (scene.status !== 'ready') {
      await this.db.updateProductionScene(productionId, sceneId, { status: 'ready' });
    }

    return (await this.db.listProductionScenes(productionId)).find(item => item.id === sceneId);
  }

  async visualReady(scene) {
    if (!scene || scene.status === 'visual_stale') return false;
    if (!scene.assetPath || scene.assetType === 'missing') return false;
    return this.pathExists(scene.assetPath);
  }

  async narrationReady(scene) {
    if (!scene) return false;
    if (scene.narrationStatus === 'intentional_silence') return true;
    return scene.narrationStatus === 'current' && Boolean(scene.audioPath) && await this.pathExists(scene.audioPath);
  }

  async findBlockers(scenes) {
    const blockers = [];
    for (const scene of scenes) {
      if (!await this.visualReady(scene)) blockers.push(`${scene.label}: visual not ready`);
      if (!await this.narrationReady(scene)) blockers.push(`${scene.label}: narration not ready`);
    }
    return blockers;
  }

  async persistManifest(bundle, production, scenes, fingerprint, resetMedia) {
    const currentAssets = bundle.assets || production.assets || {};
    const assets = {
      ...currentAssets,
      ...(resetMedia ? { audio: null, video: null, captions: null, finalVideo: null } : {}),
      sceneManifest: {
        count: scenes.length,
        version: 2,
        mode: 'scene-first',
        scriptFingerprint: fingerprint,
        updatedAt: new Date().toISOString()
      }
    };
    await this.db.updateProductionData({
      id: production.id,
      status: 'processing',
      assets,
      timeline: bundle.timeline || production.timeline || {},
      scheduledPublishTime: bundle.scheduled_publish_time || production.scheduledPublishTime,
      priority: bundle.priority ?? production.priority
    });
  }

  async persistMediaSummary(bundle, scenes, fingerprint) {
    const assets = {
      ...(bundle.assets || {}),
      video: {
        ...(bundle.assets?.video || {}),
        sceneBased: true,
        pipelineVersion: 2,
        visualAssets: scenes.map(scene => scene.assetPath).filter(Boolean),
        duration: scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0),
        format: 'mp4',
        resolution: '1920x1080',
        generatedWith: 'scene-pipeline-v2'
      },
      sceneManifest: {
        count: scenes.length,
        version: 2,
        mode: 'scene-first',
        scriptFingerprint: fingerprint,
        updatedAt: new Date().toISOString()
      }
    };
    await this.db.updateProductionData({
      id: bundle.id,
      status: 'processing',
      assets,
      timeline: bundle.timeline || {},
      scheduledPublishTime: bundle.scheduled_publish_time,
      priority: bundle.priority
    });
  }

  async recordPlanRevision(productionId, scenes, action) {
    if (!scenes.length) return;
    await this.db.saveProductionSceneRevision({
      productionId,
      sceneId: scenes[0].id,
      action,
      before: {},
      after: { sceneIds: scenes.map(scene => scene.id), count: scenes.length },
      costEvidence: { billed: false }
    });
  }

  sceneError(scene, stage, cause) {
    const error = this.error(
      `Scene ${Number(scene.position) + 1} (${scene.label}) failed during ${stage}: ${cause.message}`,
      'SCENE_PRODUCTION_FAILED'
    );
    error.cause = cause;
    error.sceneId = scene.id;
    error.scenePosition = scene.position;
    error.sceneStage = stage;
    return error;
  }

  error(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async pathExists(filePath) {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() && stat.size > 0;
    } catch (_error) {
      return false;
    }
  }
}

module.exports = { ScenePipelineV2 };
