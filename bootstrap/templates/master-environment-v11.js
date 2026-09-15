'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { environmentPrompt } = require('./environment-bible-v11');
const { lockPrompt } = require('./prop-lock-v11');

const VERSION = '11.7.3';

function clean(value, limit = 12000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeSegment(value) {
  return clean(value, 180).toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'environment';
}

async function exists(filePath) {
  if (!filePath) return false;
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function fileSha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function locksForEnvironment(propLocks = [], environmentId) {
  return (Array.isArray(propLocks) ? propLocks : []).filter(lock => lock.environmentId === environmentId);
}

function buildMasterPrompt(environment = {}, propLocks = []) {
  const required = propLocks.filter(lock => lock.required === true);
  const optional = propLocks.filter(lock => lock.required !== true);
  return [
    'MASTER ENVIRONMENT FRAME V11.7.3',
    'PURPOSE: create one canonical reusable visual reference for this location. This is not a story shot.',
    '',
    environmentPrompt(environment),
    '',
    'MASTER COMPOSITION RULES:',
    '- wide establishing view that clearly reveals the spatial layout;',
    '- show every required locked prop that would normally be visible in this environment;',
    '- preserve a practical, readable arrangement that can be reused from multiple camera angles;',
    '- no characters, people, animals, captions, logos, watermarks, random text, or unrelated decorative clutter;',
    '- do not redesign, modernize, replace, or omit the defining architecture/material identity;',
    '- prioritize environment identity and locked props over cinematic novelty;',
    '',
    required.length ? 'REQUIRED PROP LOCKS:' : 'REQUIRED PROP LOCKS: none explicitly source-backed',
    ...required.map(lock => lockPrompt(lock)),
    optional.length ? 'OPTIONAL/INFERRED PROP LOCKS (include only when natural to the composition):' : '',
    ...optional.map(lock => lockPrompt(lock)),
    '',
    'OUTPUT CONTRACT: one clean 16:9 canonical environment image suitable as the reference for future scene/shot generation.'
  ].filter(Boolean).join('\n').slice(0, 24000);
}

function planMasterFrame(production = {}, environment = {}, propLocks = []) {
  const prompt = buildMasterPrompt(environment, propLocks);
  const promptFingerprint = hash(JSON.stringify({
    version: VERSION,
    productionId: production.id || null,
    environmentId: environment.environmentId,
    environmentFingerprint: environment.fingerprint || null,
    propLocks: propLocks.map(lock => ({ id: lock.id, fingerprint: lock.fingerprint, required: lock.required })),
    prompt
  }));
  return {
    version: VERSION,
    productionId: production.id || null,
    environmentId: environment.environmentId,
    environmentFingerprint: environment.fingerprint || null,
    prompt,
    promptFingerprint,
    status: 'planned',
    canonical: false,
    masterFramePath: null,
    candidatePath: null,
    provider: null,
    sourceKind: null,
    assetSha256: null,
    width: null,
    height: null,
    error: null
  };
}

function isGenericLocalFallback(filePath) {
  const base = path.basename(String(filePath || '')).toLowerCase();
  return base.startsWith('visual_local_') || base.startsWith('thumbnail_local_');
}

class MasterEnvironmentGeneratorV11 {
  constructor(db, videoGenerator, options = {}) {
    this.db = db;
    this.videoGenerator = videoGenerator;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.MASTER_ENVIRONMENT_GENERATION_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireProvider = String(options.requireProvider ?? process.env.MASTER_ENVIRONMENT_REQUIRE_PROVIDER ?? 'true').toLowerCase() !== 'false';
    this.dataRoot = options.dataRoot || path.resolve(__dirname, '..', 'data');
  }

  outputPath(productionId, environmentId) {
    return path.join(this.dataRoot, 'assets', 'environments', safeSegment(productionId), safeSegment(environmentId), 'master.png');
  }

  async ensureProductionFrames(production = {}, environmentBible = null, propLocks = []) {
    if (!this.enabled || !environmentBible || !Array.isArray(environmentBible.environments) || !environmentBible.environments.length) return null;
    const frames = [];
    for (const environment of environmentBible.environments) {
      const locks = locksForEnvironment(propLocks, environment.environmentId);
      frames.push(await this.ensureEnvironmentFrame(production, environment, locks));
    }
    return {
      version: VERSION,
      productionId: production.id || null,
      frames,
      summary: {
        environmentCount: frames.length,
        readyCount: frames.filter(frame => frame.status === 'ready' && frame.canonical).length,
        fallbackCount: frames.filter(frame => frame.status === 'fallback_unanchored').length,
        failedCount: frames.filter(frame => frame.status === 'failed').length,
        pendingCount: frames.filter(frame => ['planned', 'generation_disabled'].includes(frame.status)).length
      }
    };
  }

  async ensureEnvironmentFrame(production = {}, environment = {}, propLocks = []) {
    const plan = planMasterFrame(production, environment, propLocks);
    const existing = this.db?.getLatestEnvironmentMasterFrame
      ? await this.db.getLatestEnvironmentMasterFrame(production.id, environment.environmentId)
      : null;
    if (existing && existing.promptFingerprint === plan.promptFingerprint && existing.canonical === true && await exists(existing.masterFramePath)) {
      return { ...existing, reused: true };
    }
    if (!this.videoGenerator || typeof this.videoGenerator.generateVisualAssets !== 'function') {
      const record = { ...plan, status: 'generation_disabled', error: 'No image generator is available for master environment generation.' };
      if (this.db?.saveEnvironmentMasterFrame) await this.db.saveEnvironmentMasterFrame(record);
      return record;
    }

    try {
      const assets = await this.videoGenerator.generateVisualAssets(plan.prompt, 'kids_cartoon_2d', 1);
      const sourcePath = Array.isArray(assets) ? assets[0] : null;
      if (!sourcePath || !await exists(sourcePath)) throw new Error('Master environment generator returned no readable image asset');

      const localFallback = isGenericLocalFallback(sourcePath);
      if (this.requireProvider && localFallback) {
        const record = {
          ...plan,
          status: 'fallback_unanchored',
          canonical: false,
          candidatePath: sourcePath,
          provider: 'local-renderer',
          sourceKind: 'generic-local-fallback',
          error: 'Local generic fallback is not accepted as a canonical environment master frame.'
        };
        if (this.db?.saveEnvironmentMasterFrame) await this.db.saveEnvironmentMasterFrame(record);
        this.logger.warn(`Master Environment v11.7.3 could not anchor ${environment.environmentId}: generic local fallback is non-canonical.`);
        return record;
      }

      const destination = this.outputPath(production.id, environment.environmentId);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await sharp(sourcePath, { failOn: 'error' }).png().toFile(destination);
      const metadata = await sharp(destination).metadata();
      const record = {
        ...plan,
        status: 'ready',
        canonical: true,
        masterFramePath: destination,
        candidatePath: sourcePath,
        provider: localFallback ? 'local-renderer' : 'image-provider',
        sourceKind: localFallback ? 'local-renderer-explicitly-allowed' : 'generated-master-reference',
        assetSha256: await fileSha256(destination),
        width: metadata.width || null,
        height: metadata.height || null,
        generatedAt: new Date().toISOString(),
        error: null
      };
      const saved = this.db?.saveEnvironmentMasterFrame ? await this.db.saveEnvironmentMasterFrame(record) : record;
      if (this.db?.markPropLocksMasterReference) {
        await this.db.markPropLocksMasterReference(production.id, environment.environmentId, destination);
      }
      this.logger.info(`Master Environment v11.7.3 ready for ${environment.environmentId}: ${metadata.width || '?'}x${metadata.height || '?'}, sha256=${record.assetSha256.slice(0, 12)}.`);
      return saved || record;
    } catch (error) {
      const record = { ...plan, status: 'failed', canonical: false, error: error.message || String(error) };
      if (this.db?.saveEnvironmentMasterFrame) await this.db.saveEnvironmentMasterFrame(record);
      this.logger.error(`Master Environment v11.7.3 failed for ${environment.environmentId}:`, error);
      return record;
    }
  }
}

module.exports = {
  MASTER_ENVIRONMENT_VERSION: VERSION,
  MasterEnvironmentGeneratorV11,
  buildMasterPrompt,
  planMasterFrame,
  locksForEnvironment,
  isGenericLocalFallback,
  fileSha256
};
