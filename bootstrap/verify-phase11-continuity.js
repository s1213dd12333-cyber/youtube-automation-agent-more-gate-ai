'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

// Keep the materialized runtime honest before any Phase 11.4 assertions.
require('./fix-phase11-continuity-evidence.js');

const upstream = path.resolve(__dirname, '..', 'upstream');
const sharp = require(path.join(upstream, 'node_modules', 'sharp'));
const runtimePath = path.join(upstream, 'utils', 'cartoon-continuity-engine-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.4 runtime is not materialized: utils/cartoon-continuity-engine-v11.js');

const {
  CARTOON_CONTINUITY_VERSION,
  CartoonContinuityEngineV11,
  imageSignature,
  scoreSignatures,
  repairPrompt,
  hammingSimilarity,
  gridSimilarity
} = require(runtimePath);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const logger = { info() {}, warn() {}, error() {} };

class FakeDb {
  constructor() { this.checks = []; }
  async saveKeyframeContinuityCheck(input) { this.checks.push({ ...input }); return input; }
}

check('continuity engine contract is version 11.4', () => assert.strictEqual(CARTOON_CONTINUITY_VERSION, '11.4'));
check('identical perceptual hashes score one', () => assert.strictEqual(hammingSimilarity('1010', '1010'), 1));
check('opposite perceptual hashes score zero', () => assert.strictEqual(hammingSimilarity('1111', '0000'), 0));
check('identical composition grids score one', () => assert.strictEqual(gridSimilarity([10, 20, 30], [10, 20, 30]), 1));
check('opposite composition grids score low', () => assert(gridSimilarity([0, 0, 0], [255, 255, 255]) < 0.05));

const signatureA = { aspect: 16 / 9, rgbMean: [40, 80, 120], luminance: 75, grid: Array(48).fill(80), dhash: '1'.repeat(64) };
const signatureB = { ...signatureA };
const signatureDrift = { aspect: 1, rgbMean: [255, 240, 230], luminance: 245, grid: Array(48).fill(255), dhash: '0'.repeat(64) };
check('identical signatures receive perfect continuity', () => assert(scoreSignatures(signatureA, signatureB).score > 0.99));
check('large palette/composition redesign receives a low score', () => assert(scoreSignatures(signatureA, signatureDrift).score < 0.45));
check('continuity scoring exposes component metrics', () => {
  const result = scoreSignatures(signatureA, signatureDrift);
  for (const key of ['aspect', 'palette', 'luminance', 'compositionGrid', 'perceptualHash']) assert(Object.hasOwn(result.metrics, key));
});

check('repair prompt explicitly freezes identity and outfit', () => {
  const prompt = repairPrompt({ prompt: 'shot prompt' }, { score: 0.3 });
  assert(prompt.includes('CONTINUITY REPAIR V11.4:'));
  assert(prompt.includes('facial landmarks'));
  assert(prompt.includes('outfit'));
});

check('image signature reads a real PNG and produces perceptual metadata', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-4-signature-'));
  const file = path.join(temp, 'frame.png');
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 30, g: 120, b: 220 } } }).png().toFile(file);
  const signature = await imageSignature(file);
  assert.strictEqual(signature.width, 320);
  assert.strictEqual(signature.height, 180);
  assert.strictEqual(signature.dhash.length, 64);
  assert.strictEqual(signature.grid.length, 48);
  assert(/^[a-f0-9]{64}$/.test(signature.fingerprint));
  await fsp.rm(temp, { recursive: true, force: true });
});

check('first keyframe is accepted as the scene continuity anchor', async () => {
  const db = new FakeDb();
  const engine = new CartoonContinuityEngineV11(db, { logger, threshold: 0.48 });
  const result = await engine.evaluate({ productionId: 'p', sceneId: 's', keyframe: { id: 'kf1', shotId: 'sh1', referenceKeyframeId: null }, assetPath: 'unused.png' });
  assert.strictEqual(result.status, 'anchor');
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(db.checks.length, 1);
});

check('missing expected reference fails closed', async () => {
  const db = new FakeDb();
  const engine = new CartoonContinuityEngineV11(db, { logger, threshold: 0.48 });
  const result = await engine.evaluate({ productionId: 'p', sceneId: 's', keyframe: { id: 'kf2', shotId: 'sh1', referenceKeyframeId: 'kf1' }, assetPath: 'unused.png', referenceAssetPath: null });
  assert.strictEqual(result.accepted, false);
  assert(result.reasons.includes('CONTINUITY_REFERENCE_MISSING'));
});

check('identical real frames pass continuity validation', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-v11-4-pass-'));
  const reference = path.join(temp, 'reference.png');
  const candidate = path.join(temp, 'candidate.png');
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 220, g: 180, b: 40 } } }).png().toFile(reference);
  await fsp.copyFile(reference, candidate);
  const db = new FakeDb();
  const engine = new CartoonContinuityEngineV11(db, { logger, threshold: 0.48 });
  const result = await engine.evaluate({ productionId: 'p', sceneId: 's', keyframe: { id: 'kf2', shotId: 'sh1', referenceKeyframeId: 'kf1' }, assetPath: candidate, referenceAssetPath: reference, referenceConditioned: true });
  assert.strictEqual(result.accepted, true);
  assert(result.score > 0.99);
  assert.strictEqual(result.referenceConditioned, true);
  await fsp.rm(temp, { recursive: true, force: true });
});

check('configured threshold is clamped to a safe range', () => {
  assert.strictEqual(new CartoonContinuityEngineV11(new FakeDb(), { threshold: 2 }).threshold, 0.9);
  assert.strictEqual(new CartoonContinuityEngineV11(new FakeDb(), { threshold: 0 }).threshold, 0.2);
});
check('auto repair defaults on', () => assert.strictEqual(new CartoonContinuityEngineV11(new FakeDb(), {}).autoRepair, true));
check('repair attempts are bounded', () => assert.strictEqual(new CartoonContinuityEngineV11(new FakeDb(), { maxRepairAttempts: 99 }).maxRepairAttempts, 3));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const generatorSource = fs.readFileSync(path.join(upstream, 'utils', 'ai-video-generator.js'), 'utf8');
const keyframeSource = fs.readFileSync(path.join(upstream, 'utils', 'cartoon-keyframe-pipeline-v11.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

check('database owns continuity audit records', () => assert(dbSource.includes('CREATE TABLE IF NOT EXISTS keyframe_continuity_checks')));
check('database persists continuity score attempts', () => assert(dbSource.includes('async saveKeyframeContinuityCheck(input = {})')));
check('production bundle exposes continuity checks', () => assert(dbSource.includes('const continuityChecks = await this.listKeyframeContinuityChecks(productionId);')));
check('image generator exposes reference-conditioned generation', () => assert(generatorSource.includes('async generateVisualAssetsWithReference(')));
check('Gemini reference generation includes the prior image as inline data', () => assert(generatorSource.includes('{ inlineData: { mimeType, data: referenceData } }')));
check('generator records real conditioning explicitly', () => assert(generatorSource.includes('this.lastReferenceConditionedGeneration = true')));
check('keyframe runtime accepts a continuity engine', () => assert(keyframeSource.includes('this.continuityEngine = options.continuityEngine || null')));
check('keyframe runtime prefers reference-conditioned generation when available', () => assert(keyframeSource.includes('generateVisualAssetsWithReference(current.prompt, referenceAssetPath')));
check('keyframe runtime records truthful provider conditioning evidence', () => assert(keyframeSource.includes('this.videoGenerator.lastReferenceConditionedGeneration === true')));
check('keyframe runtime validates each generated frame', () => assert(keyframeSource.includes('this.continuityEngine.evaluate({ productionId, sceneId')));
check('keyframe runtime has bounded continuity repair loop', () => assert(keyframeSource.includes('repairAttempt < this.continuityEngine.maxRepairAttempts')));
check('failed continuity blocks the frame', () => assert(keyframeSource.includes("status: 'continuity_failed'")));
check('failed continuity exposes a stable error code', () => assert(keyframeSource.includes("continuityError.code = 'CARTOON_CONTINUITY_FAILED'")));
check('scene pipeline imports Phase 11.4 runtime', () => assert(pipelineSource.includes("const { CartoonContinuityEngineV11 } = require('./cartoon-continuity-engine-v11');")));
check('scene pipeline wires continuity into keyframe generation', () => assert(pipelineSource.includes('continuityEngine: this.continuityEngine')));
check('Review Studio renders continuity status', () => assert(dashboardSource.includes('function renderCartoonContinuity(item)')));
check('Review Studio states the semantic recognition limitation', () => assert(dashboardSource.includes('not a semantic face-recognition model')));
check('environment documents continuity threshold', () => assert(envSource.includes('CARTOON_CONTINUITY_MIN_SCORE=0.48')));
check('environment enables bounded auto repair', () => assert(envSource.includes('CARTOON_CONTINUITY_MAX_REPAIR_ATTEMPTS=1')));
check('package exposes Phase 11.4 regression command', () => assert.strictEqual(pkg.scripts['test:continuity'], 'node ../bootstrap/verify-phase11-continuity.js'));

(async () => {
  for (const item of checks) await item.fn();
  console.log(`Phase 11.4 Continuity Engine OK: ${checks.length} regression checks passed.`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
