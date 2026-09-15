'use strict';

const crypto = require('crypto');
const sharp = require('sharp');

const VERSION = '11.4';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function similarity(a, b, range = 255) {
  return clamp01(1 - Math.abs(Number(a || 0) - Number(b || 0)) / Math.max(1, range));
}

function hammingSimilarity(a = '', b = '') {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let same = 0;
  for (let i = 0; i < length; i += 1) if (a[i] === b[i]) same += 1;
  return same / length;
}

function gridSimilarity(a = [], b = []) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let total = 0;
  for (let i = 0; i < length; i += 1) total += similarity(a[i], b[i], 255);
  return total / length;
}

async function imageSignature(filePath) {
  const metadata = await sharp(filePath, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Continuity image has invalid dimensions: ${filePath}`);

  const { data } = await sharp(filePath, { failOn: 'error' })
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = 3;
  const sums = [0, 0, 0];
  for (let i = 0; i < data.length; i += channels) {
    sums[0] += data[i];
    sums[1] += data[i + 1];
    sums[2] += data[i + 2];
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

  return {
    width: metadata.width,
    height: metadata.height,
    aspect: metadata.width / metadata.height,
    rgbMean,
    luminance,
    grid,
    dhash,
    fingerprint: hash(JSON.stringify({ width: metadata.width, height: metadata.height, rgbMean, luminance, grid, dhash }))
  };
}

function scoreSignatures(reference, candidate) {
  const aspectRatio = Math.max(reference.aspect, candidate.aspect) / Math.max(0.0001, Math.min(reference.aspect, candidate.aspect));
  const aspect = clamp01(1 - Math.min(1, Math.abs(Math.log(aspectRatio))));
  const palette = mean(reference.rgbMean.map((value, index) => similarity(value, candidate.rgbMean[index], 255)));
  const luminance = similarity(reference.luminance, candidate.luminance, 255);
  const grid = gridSimilarity(reference.grid, candidate.grid);
  const perceptual = hammingSimilarity(reference.dhash, candidate.dhash);
  const score = clamp01(
    aspect * 0.10 +
    palette * 0.20 +
    luminance * 0.10 +
    grid * 0.35 +
    perceptual * 0.25
  );
  return {
    score,
    metrics: {
      aspect: Number(aspect.toFixed(4)),
      palette: Number(palette.toFixed(4)),
      luminance: Number(luminance.toFixed(4)),
      compositionGrid: Number(grid.toFixed(4)),
      perceptualHash: Number(perceptual.toFixed(4))
    }
  };
}

function repairPrompt(keyframe, result) {
  return [
    keyframe.prompt || '',
    '',
    'CONTINUITY REPAIR V11.4:',
    `Previous continuity score: ${Number(result.score || 0).toFixed(3)}.`,
    'Use the supplied reference image as the identity anchor, not merely as inspiration.',
    'Preserve the exact character silhouette, facial landmarks, eye shape, palette, costume, markings, props, background landmarks, and screen direction.',
    'Change only the pose/expression/action required by this keyframe role.',
    'Do not redesign the character, do not change species, outfit, colors, proportions, face shape, or location unless the story explicitly requires it.'
  ].join('\n').slice(0, 20000);
}

class CartoonContinuityEngineV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    const configured = Number(options.threshold ?? process.env.CARTOON_CONTINUITY_MIN_SCORE ?? 0.48);
    this.threshold = Number.isFinite(configured) ? Math.max(0.2, Math.min(0.9, configured)) : 0.48;
    this.autoRepair = String(options.autoRepair ?? process.env.CARTOON_CONTINUITY_AUTO_REPAIR ?? 'true').toLowerCase() !== 'false';
    const attempts = Number(options.maxRepairAttempts ?? process.env.CARTOON_CONTINUITY_MAX_REPAIR_ATTEMPTS ?? 1);
    this.maxRepairAttempts = Number.isFinite(attempts) ? Math.max(0, Math.min(3, Math.round(attempts))) : 1;
  }

  async evaluate(input = {}) {
    const { productionId, sceneId, keyframe, assetPath, referenceAssetPath, referenceConditioned = false, attempt = 0 } = input;
    if (!keyframe?.id || !assetPath) throw new Error('Continuity evaluation requires keyframe and assetPath');

    if (!keyframe.referenceKeyframeId) {
      const result = {
        version: VERSION,
        status: 'anchor',
        accepted: true,
        score: 1,
        threshold: this.threshold,
        metrics: { anchor: true },
        reasons: [],
        referenceConditioned: false,
        attempt
      };
      await this.persist({ productionId, sceneId, keyframe, result });
      return result;
    }

    if (!referenceAssetPath) {
      const result = {
        version: VERSION,
        status: 'repair_needed',
        accepted: false,
        score: 0,
        threshold: this.threshold,
        metrics: { referenceMissing: true },
        reasons: ['CONTINUITY_REFERENCE_MISSING'],
        referenceConditioned,
        attempt
      };
      await this.persist({ productionId, sceneId, keyframe, result });
      return result;
    }

    const [reference, candidate] = await Promise.all([
      imageSignature(referenceAssetPath),
      imageSignature(assetPath)
    ]);
    const scored = scoreSignatures(reference, candidate);
    const accepted = scored.score >= this.threshold;
    const reasons = [];
    if (!accepted) reasons.push('CONTINUITY_SCORE_BELOW_THRESHOLD');
    if (scored.metrics.palette < 0.55) reasons.push('PALETTE_DRIFT');
    if (scored.metrics.compositionGrid < 0.35) reasons.push('COMPOSITION_DRIFT');
    if (scored.metrics.perceptualHash < 0.30) reasons.push('PERCEPTUAL_DRIFT');

    const result = {
      version: VERSION,
      status: accepted ? 'accepted' : 'repair_needed',
      accepted,
      score: scored.score,
      threshold: this.threshold,
      metrics: scored.metrics,
      reasons,
      referenceConditioned,
      attempt,
      referenceFingerprint: reference.fingerprint,
      candidateFingerprint: candidate.fingerprint
    };
    await this.persist({ productionId, sceneId, keyframe, result });
    return result;
  }

  async persist({ productionId, sceneId, keyframe, result }) {
    if (!this.db?.saveKeyframeContinuityCheck) return null;
    return this.db.saveKeyframeContinuityCheck({
      productionId,
      sceneId,
      shotId: keyframe.shotId,
      keyframeId: keyframe.id,
      referenceKeyframeId: keyframe.referenceKeyframeId || null,
      attempt: result.attempt || 0,
      score: result.score,
      threshold: result.threshold,
      status: result.status,
      metrics: result.metrics,
      reasons: result.reasons,
      referenceConditioned: result.referenceConditioned,
      version: VERSION
    });
  }

  repairPrompt(keyframe, result) {
    return repairPrompt(keyframe, result);
  }
}

module.exports = {
  CARTOON_CONTINUITY_VERSION: VERSION,
  CartoonContinuityEngineV11,
  imageSignature,
  scoreSignatures,
  repairPrompt,
  hammingSimilarity,
  gridSimilarity
};
