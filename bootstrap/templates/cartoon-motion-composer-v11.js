'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { runFFmpeg, checkFFmpeg, ffmpegInstallHint } = require('./ffmpeg');

const VERSION = '11.5';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, number));
}

function safePart(value, fallback = 'item') {
  const cleaned = String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || fallback;
}

function profileForShot(shot = {}) {
  const type = String(shot.shotType || 'medium').toLowerCase();
  if (type === 'wide') return Number(shot.shotIndex || 0) % 2 === 0 ? 'drift_right' : 'drift_left';
  if (type === 'close_up') return 'gentle_push';
  if (type === 'reaction') return 'gentle_push';
  if (type === 'action') return Number(shot.shotIndex || 0) % 2 === 0 ? 'drift_left' : 'drift_right';
  if (type === 'ending') return 'gentle_pull';
  return Number(shot.shotIndex || 0) % 2 === 0 ? 'gentle_push' : 'gentle_pull';
}

function splitShotDuration(duration, transition) {
  const total = Math.max(0.6, Number(duration || 0));
  const t = Math.max(0, Math.min(Number(transition || 0), total * 0.12, 0.35));
  const clipDuration = (total + (2 * t)) / 3;
  return {
    total: Number(total.toFixed(3)),
    transition: Number(t.toFixed(3)),
    clipDuration: Number(clipDuration.toFixed(3))
  };
}

function motionFilter(profile, frames, width = 1280, height = 720, fps = 30) {
  const d = Math.max(2, Math.round(frames));
  const size = `${Math.round(width)}x${Math.round(height)}`;
  const centerX = 'iw/2-(iw/zoom/2)';
  const centerY = 'ih/2-(ih/zoom/2)';
  let zoom = "min(zoom+0.0008,1.06)";
  let x = centerX;
  let y = centerY;

  if (profile === 'gentle_pull') zoom = "if(eq(on,0),1.06,max(1.0,zoom-0.0008))";
  if (profile === 'drift_right') {
    zoom = '1.05';
    x = `(iw-iw/zoom)*on/${Math.max(1, d - 1)}`;
  }
  if (profile === 'drift_left') {
    zoom = '1.05';
    x = `(iw-iw/zoom)-((iw-iw/zoom)*on/${Math.max(1, d - 1)})`;
  }
  if (profile === 'hold') zoom = '1.02';

  return [
    `scale=${Math.round(width)}:${Math.round(height)}:force_original_aspect_ratio=increase`,
    `crop=${Math.round(width)}:${Math.round(height)}`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${d}:s=${size}:fps=${Math.round(fps)}`,
    'format=yuv420p'
  ].join(',');
}

class CartoonMotionComposerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');
    this.runFFmpeg = options.runFFmpeg || runFFmpeg;
    this.checkFFmpeg = options.checkFFmpeg || checkFFmpeg;
    this.ffmpegInstallHint = options.ffmpegInstallHint || ffmpegInstallHint;
    this.enabled = String(options.enabled ?? process.env.CARTOON_MOTION_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.fps = Math.round(clampNumber(options.fps ?? process.env.CARTOON_MOTION_FPS, 30, 12, 60));
    this.width = Math.round(clampNumber(options.width ?? process.env.CARTOON_MOTION_WIDTH, 1280, 640, 3840));
    this.height = Math.round(clampNumber(options.height ?? process.env.CARTOON_MOTION_HEIGHT, 720, 360, 2160));
    this.transitionSeconds = clampNumber(options.transitionSeconds ?? process.env.CARTOON_MOTION_TRANSITION_SECONDS, 0.16, 0, 0.5);
  }

  async composeProduction(productionId) {
    if (!this.enabled) return { version: VERSION, productionId, enabled: false, sceneCount: 0, segmentCount: 0, scenes: [] };
    if (!await this.checkFFmpeg()) {
      const error = new Error(this.ffmpegInstallHint());
      error.code = 'CARTOON_MOTION_FFMPEG_UNAVAILABLE';
      throw error;
    }

    const [scenes, shots, keyframes] = await Promise.all([
      this.db.listProductionScenes(productionId),
      this.db.listSceneShots(productionId),
      this.db.listShotKeyframes(productionId)
    ]);
    if (!shots.length) return { version: VERSION, productionId, enabled: true, sceneCount: 0, segmentCount: 0, scenes: [] };

    const sceneOutputs = [];
    let segmentCount = 0;
    for (const scene of [...scenes].sort((a, b) => Number(a.position || 0) - Number(b.position || 0))) {
      const sceneShots = shots
        .filter(shot => shot.sceneId === scene.id)
        .sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0));
      if (!sceneShots.length) continue;
      const segments = [];
      for (const shot of sceneShots) {
        const shotFrames = keyframes
          .filter(frame => frame.shotId === shot.id)
          .sort((a, b) => Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0));
        const segment = await this.renderShot(productionId, scene, shot, shotFrames);
        segments.push(segment);
        segmentCount += 1;
      }
      const composed = await this.renderScene(productionId, scene, segments);
      sceneOutputs.push(composed);
    }

    const fingerprint = hash(sceneOutputs.map(item => item.fingerprint).join('\u0000'));
    return {
      version: VERSION,
      productionId,
      enabled: true,
      fingerprint,
      sceneCount: sceneOutputs.length,
      segmentCount,
      scenes: sceneOutputs,
      summary: {
        sceneCount: sceneOutputs.length,
        segmentCount,
        fps: this.fps,
        width: this.width,
        height: this.height,
        transitionSeconds: this.transitionSeconds,
        renderer: 'local-ffmpeg-motion'
      }
    };
  }

  async renderShot(productionId, scene, shot, keyframes) {
    if (keyframes.length !== 3 || keyframes.map(item => item.keyframeRole).join(',') !== 'start,middle,end') {
      const error = new Error(`Shot ${shot.id} requires exactly start/middle/end keyframes before motion composition`);
      error.code = 'CARTOON_MOTION_KEYFRAMES_INCOMPLETE';
      throw error;
    }
    for (const frame of keyframes) {
      if (frame.status !== 'ready' || !frame.assetPath || !await this.pathExists(frame.assetPath)) {
        const error = new Error(`Shot ${shot.id} keyframe ${frame.keyframeRole} is not ready for motion composition`);
        error.code = 'CARTOON_MOTION_KEYFRAME_NOT_READY';
        throw error;
      }
    }

    const profile = profileForShot(shot);
    const duration = splitShotDuration(shot.duration, this.transitionSeconds);
    const assetDigests = [];
    for (const frame of keyframes) assetDigests.push(await this.fileDigest(frame.assetPath));
    const fingerprint = hash(JSON.stringify({
      version: VERSION,
      shotId: shot.id,
      shotFingerprint: shot.fingerprint,
      keyframeIds: keyframes.map(item => item.id),
      assetDigests,
      duration,
      profile,
      fps: this.fps,
      width: this.width,
      height: this.height
    }));

    const existing = await this.db.getCartoonMotionSegment(productionId, shot.id);
    if (existing?.status === 'ready' && existing.fingerprint === fingerprint && existing.outputPath && await this.pathExists(existing.outputPath)) {
      return { ...existing, reused: true };
    }

    const directory = path.join(
      this.dataRoot,
      'videos',
      'cartoon-motion',
      safePart(productionId, 'production'),
      safePart(scene.id, 'scene')
    );
    await fs.mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, `${String(Number(shot.shotIndex || 0)).padStart(3, '0')}_${safePart(shot.id, 'shot')}.mp4`);
    const tempDir = path.join(directory, `.tmp_${safePart(shot.id, 'shot')}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });

    await this.db.saveCartoonMotionSegment({
      productionId,
      sceneId: scene.id,
      shotId: shot.id,
      version: VERSION,
      shotIndex: Number(shot.shotIndex || 0),
      fingerprint,
      duration: duration.total,
      profile,
      keyframeIds: keyframes.map(item => item.id),
      outputPath,
      status: 'rendering',
      error: null
    });

    try {
      const clips = [];
      for (let index = 0; index < keyframes.length; index += 1) {
        const frame = keyframes[index];
        const clipPath = path.join(tempDir, `${String(index).padStart(2, '0')}_${frame.keyframeRole}.mp4`);
        await this.renderStillClip(frame.assetPath, clipPath, duration.clipDuration, profile, index);
        clips.push(clipPath);
      }
      await this.combineKeyframeClips(clips, outputPath, duration);
      if (!await this.pathExists(outputPath)) throw new Error(`FFmpeg produced no usable motion segment for ${shot.id}`);
      const ready = await this.db.saveCartoonMotionSegment({
        productionId,
        sceneId: scene.id,
        shotId: shot.id,
        version: VERSION,
        shotIndex: Number(shot.shotIndex || 0),
        fingerprint,
        duration: duration.total,
        profile,
        keyframeIds: keyframes.map(item => item.id),
        outputPath,
        status: 'ready',
        error: null,
        generatedAt: new Date().toISOString()
      });
      this.logger.info(`Cartoon motion segment ready: scene=${scene.id} shot=${Number(shot.shotIndex || 0) + 1} profile=${profile}.`);
      return { ...ready, reused: false };
    } catch (error) {
      await this.db.saveCartoonMotionSegment({
        productionId,
        sceneId: scene.id,
        shotId: shot.id,
        version: VERSION,
        shotIndex: Number(shot.shotIndex || 0),
        fingerprint,
        duration: duration.total,
        profile,
        keyframeIds: keyframes.map(item => item.id),
        outputPath,
        status: 'failed',
        error: error.message
      }).catch(() => {});
      const wrapped = new Error(`Phase 11.5 motion composition failed for shot ${shot.id}: ${error.message}`);
      wrapped.code = error.code || 'CARTOON_MOTION_RENDER_FAILED';
      wrapped.shotId = shot.id;
      wrapped.sceneId = scene.id;
      throw wrapped;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async renderStillClip(assetPath, outputPath, seconds, profile, index) {
    const frames = Math.max(2, Math.round(seconds * this.fps));
    const profileForFrame = index === 1 && profile === 'hold' ? 'gentle_push' : profile;
    const filter = motionFilter(profileForFrame, frames, this.width, this.height, this.fps);
    await this.runFFmpeg([
      '-y',
      '-loop', '1',
      '-i', assetPath,
      '-vf', filter,
      '-frames:v', String(frames),
      '-r', String(this.fps),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      outputPath
    ]);
  }

  async combineKeyframeClips(clips, outputPath, timing) {
    const args = ['-y'];
    for (const clip of clips) args.push('-i', clip);
    if (timing.transition > 0.01) {
      const firstOffset = Math.max(0, timing.clipDuration - timing.transition);
      const secondOffset = Math.max(0, (2 * timing.clipDuration) - (2 * timing.transition));
      const filter = [
        `[0:v][1:v]xfade=transition=fade:duration=${timing.transition.toFixed(3)}:offset=${firstOffset.toFixed(3)}[v01]`,
        `[v01][2:v]xfade=transition=fade:duration=${timing.transition.toFixed(3)}:offset=${secondOffset.toFixed(3)}[v]`
      ].join(';');
      try {
        await this.runFFmpeg([
          ...args,
          '-filter_complex', filter,
          '-map', '[v]',
          '-t', timing.total.toFixed(3),
          '-r', String(this.fps),
          '-an',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p',
          outputPath
        ]);
        return;
      } catch (error) {
        this.logger.warn(`FFmpeg xfade failed; falling back to deterministic concat: ${error.message}`);
      }
    }
    await this.concatVideos(clips, outputPath, timing.total);
  }

  async renderScene(productionId, scene, segments) {
    if (!segments.length) throw new Error(`Scene ${scene.id} has no motion segments`);
    const fingerprint = hash(JSON.stringify({
      version: VERSION,
      sceneId: scene.id,
      duration: Number(scene.duration || 0),
      segments: segments.map(item => ({ id: item.id, fingerprint: item.fingerprint, duration: item.duration }))
    }));
    const existing = await this.db.getCartoonMotionScene(productionId, scene.id);
    if (existing?.status === 'ready' && existing.fingerprint === fingerprint && existing.outputPath && await this.pathExists(existing.outputPath)) {
      return { ...existing, reused: true };
    }

    const directory = path.join(
      this.dataRoot,
      'videos',
      'cartoon-motion',
      safePart(productionId, 'production'),
      safePart(scene.id, 'scene')
    );
    await fs.mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, 'scene.mp4');
    const totalDuration = segments.reduce((sum, item) => sum + Number(item.duration || 0), 0);
    await this.db.saveCartoonMotionScene({
      productionId,
      sceneId: scene.id,
      version: VERSION,
      fingerprint,
      duration: totalDuration,
      segmentIds: segments.map(item => item.id),
      outputPath,
      status: 'rendering',
      error: null
    });

    try {
      await this.concatVideos(segments.map(item => item.outputPath), outputPath, totalDuration);
      if (!await this.pathExists(outputPath)) throw new Error(`FFmpeg produced no usable scene motion output for ${scene.id}`);
      const ready = await this.db.saveCartoonMotionScene({
        productionId,
        sceneId: scene.id,
        version: VERSION,
        fingerprint,
        duration: totalDuration,
        segmentIds: segments.map(item => item.id),
        outputPath,
        status: 'ready',
        error: null,
        generatedAt: new Date().toISOString()
      });
      return { ...ready, reused: false };
    } catch (error) {
      await this.db.saveCartoonMotionScene({
        productionId,
        sceneId: scene.id,
        version: VERSION,
        fingerprint,
        duration: totalDuration,
        segmentIds: segments.map(item => item.id),
        outputPath,
        status: 'failed',
        error: error.message
      }).catch(() => {});
      throw error;
    }
  }

  async concatVideos(inputs, outputPath, totalDuration = null) {
    const args = ['-y'];
    for (const input of inputs) args.push('-i', input);
    const labels = inputs.map((_, index) => `[${index}:v]`).join('');
    const filter = `${labels}concat=n=${inputs.length}:v=1:a=0[v]`;
    args.push(
      '-filter_complex', filter,
      '-map', '[v]',
      '-r', String(this.fps),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p'
    );
    if (Number(totalDuration) > 0) args.push('-t', Number(totalDuration).toFixed(3));
    args.push(outputPath);
    await this.runFFmpeg(args);
  }

  async fileDigest(filePath) {
    return hash(await fs.readFile(filePath));
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
  CARTOON_MOTION_COMPOSER_VERSION: VERSION,
  CartoonMotionComposerV11,
  profileForShot,
  splitShotDuration,
  motionFilter
};
