'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const sharp = require('sharp');

const VERSION = '11.7.6';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function similarity(a, b, range = 255) {
  return clamp01(1 - Math.abs(Number(a || 0) - Number(b || 0)) / Math.max(1, range));
}

function hammingSimilarity(a = '', b = '') {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let same = 0;
  for (let index = 0; index < length; index += 1) if (a[index] === b[index]) same += 1;
  return same / length;
}

function gridSimilarity(a = [], b = []) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) total += similarity(a[index], b[index], 255);
  return total / length;
}

async function pathExists(filePath) {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

async function imageSignature(filePath) {
  const metadata = await sharp(filePath, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Environment continuity image has invalid dimensions: ${filePath}`);

  const { data } = await sharp(filePath, { failOn: 'error' })
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = 3;
  const sums = [0, 0, 0];
  for (let index = 0; index < data.length; index += channels) {
    sums[0] += data[index];
    sums[1] += data[index + 1];
    sums[2] += data[index + 2];
  }
  const pixels = data.length / channels;
  const rgbMean = sums.map(value => value / Math.max(1, pixels));
  const luminance = 0.2126 * rgbMean[0] + 0.7152 * rgbMean[1] + 0.0722 * rgbMean[2];

  const grid = [];
  const cellSize = 8;
  for (let gy = 0; gy < 4; gy += 1) {
    for (let gx = 0; gx < 4; gx += 1) {
      const cell = [0, 0, 0];
      let count = 0;
      for (let y = gy * cellSize; y < (gy + 1) * cellSize; y += 1) {
        for (let x = gx * cellSize; x < (gx + 1) * cellSize; x += 1) {
          const offset = (y * 32 + x) * channels;
          cell[0] += data[offset];
          cell[1] += data[offset + 1];
          cell[2] += data[offset + 2];
          count += 1;
        }
      }
      grid.push(...cell.map(value => value / Math.max(1, count)));
    }
  }

  const dhashBuffer = await sharp(filePath, { failOn: 'error' })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  let dhash = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = dhashBuffer[y * 9 + x];
      const right = dhashBuffer[y * 9 + x + 1];
      dhash += left > right ? '1' : '0';
    }
  }

  const edgeBuffer = await sharp(filePath, { failOn: 'error' })
    .greyscale()
    .resize(32, 32, { fit: 'fill' })
    .raw()
    .toBuffer();
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const current = edgeBuffer[y * 32 + x];
      if (x < 31) { edgeTotal += Math.abs(current - edgeBuffer[y * 32 + x + 1]); edgeCount += 1; }
      if (y < 31) { edgeTotal += Math.abs(current - edgeBuffer[(y + 1) * 32 + x]); edgeCount += 1; }
    }
  }
  const edgeDensity = edgeTotal / Math.max(1, edgeCount);

  return {
    width: metadata.width,
    height: metadata.height,
    aspect: metadata.width / metadata.height,
    rgbMean,
    luminance,
    grid,
    dhash,
    edgeDensity,
    fingerprint: hash(JSON.stringify({ width: metadata.width, height: metadata.height, rgbMean, luminance, grid, dhash, edgeDensity }))
  };
}

function scoreEnvironment(reference, candidate) {
  const aspectRatio = Math.max(reference.aspect, candidate.aspect) / Math.max(0.0001, Math.min(reference.aspect, candidate.aspect));
  const aspect = clamp01(1 - Math.min(1, Math.abs(Math.log(aspectRatio))));
  const palette = mean(reference.rgbMean.map((value, index) => similarity(value, candidate.rgbMean[index], 255)));
  const luminance = similarity(reference.luminance, candidate.luminance, 255);
  const compositionGrid = gridSimilarity(reference.grid, candidate.grid);
  const perceptualHash = hammingSimilarity(reference.dhash, candidate.dhash);
  const edgeDensity = similarity(reference.edgeDensity, candidate.edgeDensity, Math.max(32, reference.edgeDensity, candidate.edgeDensity));
  const score = clamp01(
    aspect * 0.08 +
    palette * 0.27 +
    luminance * 0.12 +
    compositionGrid * 0.28 +
    perceptualHash * 0.15 +
    edgeDensity * 0.10
  );
  return {
    score,
    metrics: {
      aspect: Number(aspect.toFixed(4)),
      palette: Number(palette.toFixed(4)),
      luminance: Number(luminance.toFixed(4)),
      compositionGrid: Number(compositionGrid.toFixed(4)),
      perceptualHash: Number(perceptualHash.toFixed(4)),
      edgeDensity: Number(edgeDensity.toFixed(4))
    }
  };
}

function requiredPropPromptCoverage(prompt, propLocks = []) {
  const required = (Array.isArray(propLocks) ? propLocks : []).filter(lock => lock.required === true);
  if (!required.length) return { coverage: 1, missing: [], requiredCount: 0 };
  const normalizedPrompt = normalize(prompt);
  const missing = required.filter(lock => {
    const name = normalize(lock.name || lock.originalName || '');
    return name && !normalizedPrompt.includes(name);
  });
  return {
    coverage: Number(((required.length - missing.length) / required.length).toFixed(4)),
    missing: missing.map(lock => lock.id || lock.name).filter(Boolean),
    requiredCount: required.length
  };
}

function repairPrompt(keyframe = {}, context = {}, result = {}) {
  const environment = context.environment || {};
  const required = (context.propLocks || []).filter(lock => lock.required === true);
  return [
    keyframe.prompt || '',
    '',
    'ENVIRONMENT CONTINUITY REPAIR V11.7.6:',
    `Persistent Environment ID: ${context.mapping?.environmentId || environment.environmentId || 'unknown'}.`,
    `Zone: ${context.mapping?.zone || 'whole_environment'}.`,
    `Previous environment continuity score: ${Number(result.score || 0).toFixed(3)}.`,
    `Construction must remain: ${environment.construction || 'the established construction from the Environment Bible'}.`,
    `Materials must remain: ${(environment.materials || []).join(', ') || 'the established materials'}.`,
    `Palette must remain: ${(environment.palette || []).join(', ') || 'the established palette'}.`,
    `Lighting logic must remain: ${environment.lighting || 'the established lighting'}.`,
    `Required props: ${required.map(lock => lock.name).join(', ') || 'none explicitly required'}.`,
    'Use the canonical Master Environment as the location identity anchor.',
    'Do not redesign the room, replace its construction material, remove required furniture, or invent a new persistent layout.',
    'Camera angle, character pose, and action may change; the location identity must not.'
  ].join('\n').slice(0, 26000);
}

class EnvironmentContinuityValidatorV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.ENVIRONMENT_CONTINUITY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireMaster = String(options.requireMaster ?? process.env.ENVIRONMENT_CONTINUITY_REQUIRE_MASTER ?? 'true').toLowerCase() !== 'false';
    const threshold = Number(options.threshold ?? process.env.ENVIRONMENT_CONTINUITY_MIN_SCORE ?? 0.42);
    this.threshold = Number.isFinite(threshold) ? Math.max(0.2, Math.min(0.9, threshold)) : 0.42;
    const propCoverage = Number(options.minPropPromptCoverage ?? process.env.ENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE ?? 1);
    this.minPropPromptCoverage = Number.isFinite(propCoverage) ? Math.max(0, Math.min(1, propCoverage)) : 1;
  }

  async contextFor(productionId, sceneId) {
    const mapping = this.db?.getSceneEnvironment ? await this.db.getSceneEnvironment(productionId, sceneId) : null;
    const environmentBible = this.db?.getLatestEnvironmentBible ? await this.db.getLatestEnvironmentBible(productionId) : null;
    const environment = mapping?.environmentId && Array.isArray(environmentBible?.environments)
      ? environmentBible.environments.find(item => item.environmentId === mapping.environmentId) || null
      : null;
    const propLocks = mapping?.environmentId && this.db?.listPropLocks
      ? await this.db.listPropLocks(productionId, mapping.environmentId)
      : [];
    const master = mapping?.environmentId && this.db?.getLatestEnvironmentMasterFrame
      ? await this.db.getLatestEnvironmentMasterFrame(productionId, mapping.environmentId)
      : null;
    return { mapping, environmentBible, environment, propLocks, master };
  }

  async assertSceneReady(productionId, sceneId) {
    if (!this.enabled) return { active: false };
    const context = await this.contextFor(productionId, sceneId);
    if (!context.mapping || context.mapping.status !== 'mapped' || !context.mapping.environmentId || !context.environment) {
      const error = new Error(`Environment continuity requires a resolved Environment mapping for scene ${sceneId}`);
      error.code = 'ENVIRONMENT_MAPPING_REQUIRED';
      error.sceneId = sceneId;
      throw error;
    }
    const masterReady = Boolean(
      context.master && context.master.status === 'ready' && context.master.canonical === true &&
      context.master.masterFramePath && await pathExists(context.master.masterFramePath)
    );
    if (this.requireMaster && !masterReady) {
      const error = new Error(`Environment continuity requires a canonical Master Environment for ${context.mapping.environmentId}`);
      error.code = 'ENVIRONMENT_MASTER_REQUIRED';
      error.sceneId = sceneId;
      error.environmentId = context.mapping.environmentId;
      throw error;
    }
    return { ...context, active: true, masterReady };
  }

  async evaluate(input = {}) {
    const { productionId, sceneId, keyframe, assetPath, attempt = 0 } = input;
    if (!keyframe?.id || !assetPath) throw new Error('Environment continuity evaluation requires keyframe and assetPath');
    if (!this.enabled) return { version: VERSION, active: false, accepted: true, status: 'disabled', score: 1, threshold: this.threshold, reasons: [], metrics: {} };

    const context = await this.contextFor(productionId, sceneId);
    const mapping = context.mapping;
    if (!mapping || mapping.status !== 'mapped' || !mapping.environmentId || !context.environment) {
      const result = {
        version: VERSION, active: true, accepted: false, status: 'unresolved_environment', score: 0, threshold: this.threshold,
        metrics: { environmentMappingResolved: false, semanticPropPresenceVerified: false, propVerificationMode: 'prompt-contract-only' },
        reasons: ['ENVIRONMENT_MAPPING_UNRESOLVED'], attempt, environmentId: mapping?.environmentId || null
      };
      await this.persist({ productionId, sceneId, keyframe, context, result });
      return result;
    }

    const masterReady = Boolean(
      context.master && context.master.status === 'ready' && context.master.canonical === true &&
      context.master.masterFramePath && await pathExists(context.master.masterFramePath)
    );
    if (!masterReady) {
      const accepted = !this.requireMaster;
      const result = {
        version: VERSION, active: true, accepted, status: accepted ? 'skipped_no_master' : 'master_missing', score: accepted ? 1 : 0, threshold: this.threshold,
        metrics: { masterReady: false, semanticPropPresenceVerified: false, propVerificationMode: 'prompt-contract-only' },
        reasons: accepted ? [] : ['ENVIRONMENT_MASTER_MISSING'], attempt, environmentId: mapping.environmentId
      };
      await this.persist({ productionId, sceneId, keyframe, context, result });
      return result;
    }

    const [reference, candidate] = await Promise.all([
      imageSignature(context.master.masterFramePath),
      imageSignature(assetPath)
    ]);
    const scored = scoreEnvironment(reference, candidate);
    const propCoverage = requiredPropPromptCoverage(keyframe.prompt || '', context.propLocks);
    const visualAccepted = scored.score >= this.threshold;
    const promptAccepted = propCoverage.coverage >= this.minPropPromptCoverage;
    const accepted = visualAccepted && promptAccepted;
    const reasons = [];
    if (!visualAccepted) reasons.push('ENVIRONMENT_SCORE_BELOW_THRESHOLD');
    if (scored.metrics.palette < 0.50) reasons.push('ENVIRONMENT_PALETTE_DRIFT');
    if (scored.metrics.compositionGrid < 0.28) reasons.push('ENVIRONMENT_LAYOUT_DRIFT');
    if (scored.metrics.edgeDensity < 0.35) reasons.push('ENVIRONMENT_STRUCTURE_DRIFT');
    if (!promptAccepted) reasons.push('REQUIRED_PROP_PROMPT_COVERAGE_MISSING');

    const result = {
      version: VERSION,
      active: true,
      accepted,
      status: accepted ? 'accepted' : 'repair_needed',
      score: scored.score,
      threshold: this.threshold,
      metrics: {
        ...scored.metrics,
        masterReady: true,
        propPromptCoverage: propCoverage.coverage,
        requiredPropCount: propCoverage.requiredCount,
        semanticPropPresenceVerified: false,
        propVerificationMode: 'prompt-contract-only'
      },
      reasons,
      attempt,
      environmentId: mapping.environmentId,
      zone: mapping.zone || null,
      missingPropLockIds: propCoverage.missing,
      masterFingerprint: reference.fingerprint,
      candidateFingerprint: candidate.fingerprint,
      masterFramePath: context.master.masterFramePath,
      masterAssetSha256: context.master.assetSha256 || null
    };
    await this.persist({ productionId, sceneId, keyframe, context, result });
    return result;
  }

  async persist({ productionId, sceneId, keyframe, context, result }) {
    if (!this.db?.saveEnvironmentContinuityCheck) return null;
    return this.db.saveEnvironmentContinuityCheck({
      productionId,
      sceneId,
      shotId: keyframe.shotId,
      keyframeId: keyframe.id,
      environmentId: result.environmentId || context.mapping?.environmentId || null,
      attempt: result.attempt || 0,
      score: result.score,
      threshold: result.threshold,
      status: result.status,
      metrics: result.metrics,
      reasons: result.reasons,
      masterFramePath: result.masterFramePath || context.master?.masterFramePath || null,
      masterAssetSha256: result.masterAssetSha256 || context.master?.assetSha256 || null,
      masterFingerprint: result.masterFingerprint || null,
      candidateFingerprint: result.candidateFingerprint || null,
      propPromptCoverage: result.metrics?.propPromptCoverage ?? null,
      missingPropLockIds: result.missingPropLockIds || [],
      semanticPropPresenceVerified: false,
      version: VERSION
    });
  }

  repairPrompt(keyframe, result, context) {
    return repairPrompt(keyframe, context, result);
  }
}

module.exports = {
  ENVIRONMENT_CONTINUITY_VERSION: VERSION,
  EnvironmentContinuityValidatorV11,
  imageSignature,
  scoreEnvironment,
  requiredPropPromptCoverage,
  repairPrompt,
  pathExists,
  hammingSimilarity,
  gridSimilarity
};
