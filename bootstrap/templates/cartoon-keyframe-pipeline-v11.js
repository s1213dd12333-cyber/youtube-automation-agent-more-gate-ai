'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.3';
const KEYFRAME_ROLES = Object.freeze(['start', 'middle', 'end']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function clean(value, limit = 14000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function roleDirection(role) {
  if (role === 'start') {
    return 'Establish the exact pose, staging, character placement, screen direction, props, and background landmarks before the shot action develops.';
  }
  if (role === 'middle') {
    return 'Show the clearest midpoint of the shot action. Advance body pose and expression while preserving identity, costume, palette, camera axis, props, and location geography.';
  }
  return 'Show the completed action or reaction in a clean handoff pose that can transition into the next shot without changing character design or location arbitrarily.';
}

function roleProgress(role) {
  if (role === 'start') return 0;
  if (role === 'middle') return 0.5;
  return 1;
}

function keyframePrompt(shot, role, referenceKeyframeId = null) {
  return [
    shot.prompt || '',
    '',
    'KEYFRAME PIPELINE V11.3:',
    `KEYFRAME ROLE: ${role.toUpperCase()}`,
    `SHOT PROGRESS: ${roleProgress(role)}`,
    `KEYFRAME DIRECTION: ${roleDirection(role)}`,
    referenceKeyframeId
      ? `CONTINUITY REFERENCE: ${referenceKeyframeId}. Preserve the established design and visual state from the prior planned keyframe.`
      : 'CONTINUITY REFERENCE: first planned keyframe in this scene; establish a stable state for subsequent frames.',
    'CONSISTENCY RULES: same character silhouette, facial landmarks, palette, costume, markings, props, background geography, and screen direction unless the story beat explicitly changes them.',
    'FRAME RULES: one readable action state; no embedded text; no random objects; no extra limbs; no duplicate characters; no unmotivated redesign; no camera jump unrelated to the shot plan.',
    'REFERENCE LIMITATION: V11.3 persists continuity references and prompts, but provider-level image conditioning is handled by the Continuity Engine in Phase 11.4.'
  ].filter(Boolean).join('\n').slice(0, 18000);
}

class CartoonKeyframePipelineV11 {
  constructor(db, videoGenerator, options = {}) {
    this.db = db;
    this.videoGenerator = videoGenerator;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');
    this.generationEnabled = String(options.generationEnabled ?? process.env.CARTOON_KEYFRAME_GENERATION_ENABLED ?? 'true').toLowerCase() !== 'false';
    const configuredMax = Number(options.maxKeyframes ?? process.env.CARTOON_KEYFRAME_MAX_PER_PRODUCTION ?? 180);
    this.maxKeyframes = Number.isFinite(configuredMax) ? Math.max(3, Math.min(600, Math.round(configuredMax))) : 180;
  }

  planShot(production, scene, shot, previousKeyframeId = null) {
    const planFingerprint = hash(JSON.stringify({
      version: VERSION,
      productionId: production?.id || null,
      sceneId: scene?.id || shot.sceneId,
      shotId: shot.id,
      shotFingerprint: shot.fingerprint,
      shotPrompt: shot.prompt,
      roles: KEYFRAME_ROLES
    }));
    const keyframes = [];
    let referenceId = previousKeyframeId;
    for (let index = 0; index < KEYFRAME_ROLES.length; index += 1) {
      const role = KEYFRAME_ROLES[index];
      const id = `kf_${hash(`${shot.id}\u0000${planFingerprint}\u0000${role}`).slice(0, 24)}`;
      const prompt = keyframePrompt(shot, role, referenceId);
      const fingerprint = hash(JSON.stringify({
        planFingerprint,
        id,
        role,
        referenceId,
        prompt
      }));
      const keyframe = {
        version: VERSION,
        id,
        productionId: production?.id || null,
        sceneId: scene?.id || shot.sceneId,
        shotId: shot.id,
        shotIndex: Number(shot.shotIndex || 0),
        keyframeIndex: index,
        keyframeRole: role,
        progress: roleProgress(role),
        prompt,
        fingerprint,
        planFingerprint,
        referenceKeyframeId: referenceId,
        referenceAssetPath: null,
        assetPath: null,
        provider: null,
        model: null,
        status: 'planned',
        error: null,
        containsSyntheticMedia: false,
        generatedAt: null,
        createdAt: new Date().toISOString()
      };
      keyframes.push(keyframe);
      referenceId = id;
    }
    return {
      version: VERSION,
      shotId: shot.id,
      sceneId: scene?.id || shot.sceneId,
      fingerprint: planFingerprint,
      keyframeCount: keyframes.length,
      keyframes,
      endKeyframeId: keyframes.at(-1)?.id || previousKeyframeId
    };
  }

  planProduction(production = {}, scenes = [], shots = [], bible = null) {
    if (!bible || bible.mode !== 'kids_cartoon_2d' || !Array.isArray(shots) || !shots.length) return null;
    const sceneById = new Map((scenes || []).map(scene => [scene.id, scene]));
    const sceneOrder = new Map((scenes || []).map(scene => [scene.id, Number(scene.position || 0)]));
    const orderedShots = [...shots].sort((a, b) => {
      const sceneDelta = (sceneOrder.get(a.sceneId) ?? 0) - (sceneOrder.get(b.sceneId) ?? 0);
      return sceneDelta || Number(a.shotIndex || 0) - Number(b.shotIndex || 0);
    });

    const shotPlans = [];
    const keyframes = [];
    const previousEndByScene = new Map();
    for (const shot of orderedShots) {
      const scene = sceneById.get(shot.sceneId) || { id: shot.sceneId, position: 0, label: shot.sceneId };
      const previous = previousEndByScene.get(shot.sceneId) || null;
      const plan = this.planShot(production, scene, shot, previous);
      shotPlans.push(plan);
      keyframes.push(...plan.keyframes);
      previousEndByScene.set(shot.sceneId, plan.endKeyframeId);
    }

    if (keyframes.length > this.maxKeyframes) {
      const error = new Error(`Phase 11.3 planned ${keyframes.length} keyframes, exceeding CARTOON_KEYFRAME_MAX_PER_PRODUCTION=${this.maxKeyframes}`);
      error.code = 'CARTOON_KEYFRAME_LIMIT_EXCEEDED';
      throw error;
    }

    const fingerprint = hash(shotPlans.map(plan => plan.fingerprint).join('\u0000'));
    return {
      version: VERSION,
      productionId: production.id || null,
      fingerprint,
      shotCount: shotPlans.length,
      keyframeCount: keyframes.length,
      keyframesPerShot: KEYFRAME_ROLES.length,
      roles: [...KEYFRAME_ROLES],
      shots: shotPlans,
      keyframes,
      summary: {
        shotCount: shotPlans.length,
        keyframeCount: keyframes.length,
        keyframesPerShot: KEYFRAME_ROLES.length,
        generationEnabled: this.generationEnabled,
        continuityMode: 'planned-reference-metadata'
      },
      createdAt: new Date().toISOString()
    };
  }

  async ensurePlan(production = {}, scenes = [], shots = [], bible = null) {
    const plan = this.planProduction(production, scenes, shots, bible);
    if (!plan) return null;
    for (const shotPlan of plan.shots) {
      const existing = await this.db.listShotKeyframes(production.id, shotPlan.shotId);
      const matches = existing.length === shotPlan.keyframeCount && existing.every((item, index) =>
        item.fingerprint === shotPlan.keyframes[index]?.fingerprint &&
        item.planFingerprint === shotPlan.fingerprint &&
        item.keyframeRole === shotPlan.keyframes[index]?.keyframeRole
      );
      if (!matches) {
        await this.db.replaceShotKeyframes(production.id, shotPlan.sceneId, shotPlan.shotId, shotPlan.keyframes);
      }
    }
    const persisted = await this.db.listShotKeyframes(production.id);
    this.logger.info(`Cartoon Keyframe Pipeline v11.3 planned ${persisted.length} keyframe(s) for ${plan.shotCount} shot(s).`);
    return { ...plan, keyframes: persisted };
  }

  async sceneReady(productionId, sceneId) {
    const keyframes = await this.db.listSceneKeyframes(productionId, sceneId);
    if (!keyframes.length) return false;
    for (const keyframe of keyframes) {
      if (keyframe.status !== 'ready' || !keyframe.assetPath || !await this.pathExists(keyframe.assetPath)) return false;
    }
    return true;
  }

  async generateScene(productionId, sceneId) {
    if (!this.generationEnabled) {
      const error = new Error('Cartoon keyframe generation is disabled by CARTOON_KEYFRAME_GENERATION_ENABLED=false');
      error.code = 'CARTOON_KEYFRAME_GENERATION_DISABLED';
      throw error;
    }
    let keyframes = await this.db.listSceneKeyframes(productionId, sceneId);
    if (!keyframes.length) {
      const error = new Error(`No Phase 11.3 keyframe plan exists for scene ${sceneId}`);
      error.code = 'CARTOON_KEYFRAME_PLAN_MISSING';
      throw error;
    }
    keyframes = [...keyframes].sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0) || Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0));

    for (const planned of keyframes) {
      const current = await this.db.getShotKeyframe(planned.id) || planned;
      if (current.status === 'ready' && current.assetPath && await this.pathExists(current.assetPath)) continue;
      let referenceAssetPath = null;
      if (current.referenceKeyframeId) {
        const reference = await this.db.getShotKeyframe(current.referenceKeyframeId);
        if (reference?.status === 'ready' && reference.assetPath && await this.pathExists(reference.assetPath)) {
          referenceAssetPath = reference.assetPath;
        }
      }
      await this.db.updateShotKeyframe(current.id, {
        status: 'generating',
        error: null,
        referenceAssetPath
      });
      try {
        const assets = await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);
        const sourcePath = Array.isArray(assets) ? assets[0] : null;
        if (!sourcePath || !IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) || !await this.pathExists(sourcePath)) {
          const error = new Error(`Visual provider returned no usable image for keyframe ${current.id}`);
          error.code = 'CARTOON_KEYFRAME_ASSET_UNAVAILABLE';
          throw error;
        }
        const local = path.basename(sourcePath).startsWith('visual_local_');
        const assetPath = await this.persistAsset(sourcePath, current);
        await this.db.updateShotKeyframe(current.id, {
          status: 'ready',
          assetPath,
          provider: local ? 'local-renderer' : 'image-provider',
          model: null,
          error: null,
          containsSyntheticMedia: !local,
          referenceAssetPath,
          generatedAt: new Date().toISOString()
        });
        this.logger.info(`Cartoon keyframe ready: scene=${sceneId} shot=${Number(current.shotIndex) + 1} ${current.keyframeRole}.`);
      } catch (error) {
        await this.db.updateShotKeyframe(current.id, {
          status: 'failed',
          error: error.message,
          referenceAssetPath
        }).catch(() => {});
        const wrapped = new Error(`Phase 11.3 keyframe ${current.id} failed: ${error.message}`);
        wrapped.code = error.code || 'CARTOON_KEYFRAME_GENERATION_FAILED';
        wrapped.keyframeId = current.id;
        wrapped.shotId = current.shotId;
        wrapped.sceneId = sceneId;
        throw wrapped;
      }
    }

    const ready = await this.db.listSceneKeyframes(productionId, sceneId);
    const representative = ready.find(item => item.shotIndex === 0 && item.keyframeRole === 'middle') || ready.find(item => item.status === 'ready');
    const containsSyntheticMedia = ready.some(item => item.containsSyntheticMedia === true);
    return {
      version: VERSION,
      sceneId,
      keyframeCount: ready.length,
      readyCount: ready.filter(item => item.status === 'ready').length,
      representativeAssetPath: representative?.assetPath || null,
      containsSyntheticMedia,
      keyframes: ready
    };
  }

  async persistAsset(sourcePath, keyframe) {
    const extension = IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) ? path.extname(sourcePath).toLowerCase() : '.png';
    const outputPath = path.join(
      this.dataRoot,
      'assets',
      'keyframes',
      String(keyframe.productionId || 'production').replace(/[^a-zA-Z0-9_-]/g, '_'),
      String(keyframe.sceneId || 'scene').replace(/[^a-zA-Z0-9_-]/g, '_'),
      String(keyframe.shotId || 'shot').replace(/[^a-zA-Z0-9_-]/g, '_'),
      `${String(keyframe.keyframeIndex || 0).padStart(2, '0')}_${keyframe.keyframeRole}${extension}`
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    if (path.resolve(sourcePath) !== path.resolve(outputPath)) await fs.copyFile(sourcePath, outputPath);
    return outputPath;
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

module.exports = {
  CARTOON_KEYFRAME_PIPELINE_VERSION: VERSION,
  CARTOON_KEYFRAME_ROLES: KEYFRAME_ROLES,
  CartoonKeyframePipelineV11,
  keyframePrompt,
  roleDirection,
  roleProgress
};
