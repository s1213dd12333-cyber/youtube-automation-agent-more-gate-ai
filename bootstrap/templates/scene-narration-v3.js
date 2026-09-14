'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { runFFmpeg } = require('./ffmpeg');

class SceneNarrationV3 {
  constructor(videoGenerator, options = {}) {
    this.videoGenerator = videoGenerator;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');
    this.maxChars = this.clampInt(options.maxChars ?? process.env.TTS_SCENE_CHUNK_CHARS, 1800, 500, 5000);
    this.maxAttempts = this.clampInt(options.maxAttempts ?? process.env.TTS_SCENE_RETRIES, 3, 1, 5);
    this.retryBaseMs = this.clampInt(options.retryBaseMs ?? process.env.TTS_SCENE_RETRY_MS, 750, 0, 10000);
    this.runFFmpeg = options.runFFmpeg || runFFmpeg;
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  clampInt(value, fallback, min, max) {
    const parsed = Number(value);
    const number = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
    return Math.max(min, Math.min(max, number));
  }

  hash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
  }

  splitText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) || [normalized];
    const chunks = [];
    let current = '';
    const flush = () => {
      const value = current.trim();
      if (value) chunks.push(value);
      current = '';
    };
    for (const rawSentence of sentences) {
      let sentence = rawSentence.trim();
      if (!sentence) continue;
      while (sentence.length > this.maxChars) {
        if (current) flush();
        let cut = sentence.lastIndexOf(' ', this.maxChars);
        if (cut < Math.floor(this.maxChars * 0.5)) cut = this.maxChars;
        chunks.push(sentence.slice(0, cut).trim());
        sentence = sentence.slice(cut).trim();
      }
      if (!sentence) continue;
      if (current && `${current} ${sentence}`.length > this.maxChars) flush();
      current = current ? `${current} ${sentence}` : sentence;
    }
    flush();
    return chunks;
  }

  isRetriable(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    const message = String(error?.message || '').toLowerCase();
    if (/quota[^\n]*(?:limit|remaining)[^\n]*0|(?:limit|remaining)[^\n]*[:=]\s*0/.test(message)) return false;
    if ([400, 401, 403, 404, 422].includes(status)) return false;
    if ([408, 409, 425, 429].includes(status) || status >= 500) return true;
    return status === 0;
  }

  async generate(productionId, scene, options = {}) {
    const chunks = this.splitText(scene?.scriptText);
    if (!chunks.length) {
      const error = new Error('Scene narration text is empty');
      error.code = 'SCENE_NARRATION_TEXT_EMPTY';
      throw error;
    }

    const sceneDir = path.join(this.dataRoot, 'audio', 'scenes', productionId, scene.id);
    const manifestPath = path.join(sceneDir, 'manifest.json');
    const finalPath = path.join(sceneDir, `narration_r${Number(scene.revision || 1)}.mp3`);
    await fs.mkdir(sceneDir, { recursive: true });

    const textHash = this.hash(scene.scriptText);
    let manifest = options.force === true ? null : await this.loadManifest(manifestPath);
    if (!manifest || manifest.textHash !== textHash || manifest.maxChars !== this.maxChars) {
      manifest = {
        version: 3,
        productionId,
        sceneId: scene.id,
        textHash,
        maxChars: this.maxChars,
        chunks: chunks.map((text, index) => ({
          index,
          textHash: this.hash(text),
          status: 'pending',
          outputPath: path.join(sceneDir, `chunk_${String(index + 1).padStart(3, '0')}.mp3`),
          attempts: 0,
          duration: null,
          provider: null,
          model: null,
          error: null
        })),
        updatedAt: new Date().toISOString()
      };
      await this.saveManifest(manifestPath, manifest);
    }

    if (manifest.chunks.length !== chunks.length) {
      manifest.chunks = chunks.map((text, index) => ({
        index,
        textHash: this.hash(text),
        status: 'pending',
        outputPath: path.join(sceneDir, `chunk_${String(index + 1).padStart(3, '0')}.mp3`),
        attempts: 0,
        duration: null,
        provider: null,
        model: null,
        error: null
      }));
    }

    const evidence = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const expectedHash = this.hash(chunk);
      const entry = manifest.chunks[index];
      entry.textHash = expectedHash;
      entry.outputPath = entry.outputPath || path.join(sceneDir, `chunk_${String(index + 1).padStart(3, '0')}.mp3`);

      const reusable = entry.status === 'ready' && entry.textHash === expectedHash && await this.isUsableAudio(entry.outputPath);
      if (reusable) {
        this.logger.info(`Scene ${scene.position + 1} TTS chunk ${index + 1}/${chunks.length} reused.`);
        evidence.push({ provider: entry.provider, model: entry.model, reused: true });
        continue;
      }

      let lastError = null;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        entry.status = 'generating';
        entry.attempts = Number(entry.attempts || 0) + 1;
        entry.error = null;
        manifest.updatedAt = new Date().toISOString();
        await this.saveManifest(manifestPath, manifest);
        try {
          const generatedPath = await this.videoGenerator.generateTTSAudio(chunk, entry.outputPath);
          if (!await this.isUsableAudio(generatedPath)) {
            const unavailable = new Error('TTS provider returned no usable audio');
            unavailable.code = 'SCENE_TTS_CHUNK_UNAVAILABLE';
            throw unavailable;
          }
          if (generatedPath !== entry.outputPath) {
            await fs.copyFile(generatedPath, entry.outputPath);
          }
          const last = this.videoGenerator.lastNarrationResult || {};
          entry.status = 'ready';
          entry.provider = last.provider || 'configured-tts';
          entry.model = last.model || null;
          entry.error = null;
          entry.duration = await this.probeDuration(entry.outputPath).catch(() => null);
          manifest.updatedAt = new Date().toISOString();
          await this.saveManifest(manifestPath, manifest);
          evidence.push({ ...last, reused: false, chunkIndex: index, attempt });
          this.logger.info(`Scene ${scene.position + 1} TTS chunk ${index + 1}/${chunks.length} complete.`);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          entry.status = attempt >= this.maxAttempts ? 'failed' : 'retrying';
          entry.error = error.message;
          manifest.updatedAt = new Date().toISOString();
          await this.saveManifest(manifestPath, manifest);
          if (attempt < this.maxAttempts && this.isRetriable(error)) {
            const delay = this.retryBaseMs * Math.pow(2, attempt - 1);
            this.logger.warn(`Scene ${scene.position + 1} TTS chunk ${index + 1}/${chunks.length} failed (attempt ${attempt}/${this.maxAttempts}); retrying in ${delay}ms: ${error.message}`);
            if (delay > 0) await this.sleep(delay);
          } else if (attempt < this.maxAttempts) {
            break;
          }
        }
      }

      if (lastError) {
        const error = new Error(`Scene ${scene.position + 1} narration chunk ${index + 1}/${chunks.length} failed: ${lastError.message}`);
        error.code = 'SCENE_TTS_CHUNK_FAILED';
        error.chunkIndex = index;
        error.chunkCount = chunks.length;
        error.cause = lastError;
        throw error;
      }
    }

    await this.combineChunks(manifest.chunks.map(chunk => chunk.outputPath), finalPath);
    const duration = await this.probeDuration(finalPath);
    manifest.status = 'ready';
    manifest.finalPath = finalPath;
    manifest.duration = duration;
    manifest.updatedAt = new Date().toISOString();
    await this.saveManifest(manifestPath, manifest);

    const lastEvidence = [...evidence].reverse().find(item => item && item.provider) || this.videoGenerator.lastNarrationResult || {};
    return {
      path: finalPath,
      duration,
      provider: lastEvidence.provider || 'configured-tts',
      model: lastEvidence.model || null,
      externalTaskId: lastEvidence.externalTaskId || null,
      generatedAt: new Date().toISOString(),
      cost: lastEvidence.cost || {},
      manifest: {
        version: 3,
        path: manifestPath,
        textHash,
        chunkCount: manifest.chunks.length,
        reusedChunks: evidence.filter(item => item.reused).length,
        attempts: manifest.chunks.reduce((sum, chunk) => sum + Number(chunk.attempts || 0), 0)
      }
    };
  }

  async combineChunks(paths, outputPath) {
    if (paths.length === 1) {
      await fs.copyFile(paths[0], outputPath);
      return outputPath;
    }
    const args = ['-y'];
    for (const input of paths) args.push('-i', input);
    const filters = paths.map((_, index) => `[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
    filters.push(`${paths.map((_, index) => `[a${index}]`).join('')}concat=n=${paths.length}:v=0:a=1[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[aout]', '-c:a', 'libmp3lame', outputPath);
    await this.runFFmpeg(args);
    return outputPath;
  }

  async probeDuration(filePath) {
    const result = await this.runFFmpeg(['-hide_banner', '-i', filePath, '-f', 'null', '-']);
    const stderr = String(result?.stderr || '');
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) {
      const error = new Error(`Could not determine narration duration for ${path.basename(filePath)}`);
      error.code = 'AUDIO_DURATION_UNAVAILABLE';
      throw error;
    }
    const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    if (!Number.isFinite(duration) || duration <= 0) {
      const error = new Error(`Invalid narration duration for ${path.basename(filePath)}`);
      error.code = 'AUDIO_DURATION_INVALID';
      throw error;
    }
    return Number(duration.toFixed(3));
  }

  async isUsableAudio(filePath) {
    if (!filePath) return false;
    if (typeof this.videoGenerator?.isUsableAudioFile === 'function') {
      return this.videoGenerator.isUsableAudioFile(filePath);
    }
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() && stat.size > 0;
    } catch (_error) {
      return false;
    }
  }

  async loadManifest(filePath) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (_error) {
      return null;
    }
  }

  async saveManifest(filePath, manifest) {
    const temp = `${filePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rename(temp, filePath).catch(async () => {
      await fs.copyFile(temp, filePath);
      await fs.unlink(temp).catch(() => {});
    });
  }
}

module.exports = { SceneNarrationV3 };
