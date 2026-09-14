'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const servicePath = path.resolve(__dirname, '..', 'upstream', 'utils', 'scene-narration-v3.js');
if (!fs.existsSync(servicePath)) throw new Error('Phase 3 service is not materialized: utils/scene-narration-v3.js');
const { SceneNarrationV3 } = require(servicePath);

async function main() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lumen-phase3-'));
  let generateCalls = 0;
  let failOnce = true;
  const generator = {
    lastNarrationResult: null,
    async generateTTSAudio(text, outputPath) {
      generateCalls += 1;
      if (failOnce) {
        failOnce = false;
        const error = new Error('temporary upstream timeout');
        error.status = 503;
        throw error;
      }
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, Buffer.from(`audio:${text.slice(0, 20)}`));
      this.lastNarrationResult = {
        provider: 'fake-tts', model: 'fake-model', generatedAt: new Date().toISOString(),
        cost: { billed: false }
      };
      return outputPath;
    },
    async isUsableAudioFile(filePath) {
      try { return (await fsp.stat(filePath)).size > 0; } catch (_error) { return false; }
    }
  };

  const fakeFFmpeg = async args => {
    if (args.includes('-filter_complex')) {
      const output = args[args.length - 1];
      await fsp.writeFile(output, Buffer.from('combined-audio'));
      return { stdout: '', stderr: '' };
    }
    if (args[0] === '-hide_banner') {
      return { stdout: '', stderr: 'Duration: 00:00:04.250, start: 0.000000, bitrate: 128 kb/s' };
    }
    return { stdout: '', stderr: '' };
  };

  const service = new SceneNarrationV3(generator, {
    dataRoot: temp,
    maxChars: 500,
    maxAttempts: 2,
    retryBaseMs: 0,
    runFFmpeg: fakeFFmpeg,
    sleep: async () => {},
    logger: { info() {}, warn() {}, error() {} }
  });

  const paragraph = Array.from({ length: 36 }, (_, index) =>
    `Sentence ${index + 1} explains a specific scientific detail clearly and without unnecessary filler.`
  ).join(' ');
  const scene = { id: 'scene_phase3', position: 0, revision: 1, scriptText: paragraph };
  const chunks = service.splitText(scene.scriptText);
  assert(chunks.length >= 3, 'long scene narration must be split into multiple provider-sized chunks');
  assert(chunks.every(chunk => chunk.length <= 500), 'every TTS chunk must respect the configured size limit');

  const first = await service.generate('prod_phase3', scene);
  assert.strictEqual(first.duration, 4.25, 'final scene duration must come from measured audio, not script estimates');
  assert.strictEqual(first.manifest.chunkCount, chunks.length, 'manifest must persist every TTS chunk');
  assert.strictEqual(generateCalls, chunks.length + 1, 'one transient failure must retry only the failed chunk');
  assert.strictEqual(first.provider, 'fake-tts');
  assert(await generator.isUsableAudioFile(first.path), 'final concatenated narration must be a usable file');

  const callsBeforeResume = generateCalls;
  const resumed = await service.generate('prod_phase3', scene);
  assert.strictEqual(generateCalls, callsBeforeResume, 'resume must reuse completed chunk files instead of calling TTS again');
  assert.strictEqual(resumed.manifest.reusedChunks, chunks.length, 'resume must report all persisted chunks as reused');

  assert.strictEqual(service.isRetriable({ status: 503, message: 'service unavailable' }), true);
  assert.strictEqual(service.isRetriable({ status: 401, message: 'unauthorized' }), false);
  assert.strictEqual(service.isRetriable({ status: 429, message: 'RESOURCE_EXHAUSTED quota limit: 0' }), false);

  const pipelineSource = fs.readFileSync(path.resolve(__dirname, '..', 'upstream', 'utils', 'scene-pipeline-v2.js'), 'utf8');
  const repairSource = fs.readFileSync(path.resolve(__dirname, '..', 'upstream', 'utils', 'scene-repair-service.js'), 'utf8');
  assert(pipelineSource.includes("const { SceneNarrationV3 } = require('./scene-narration-v3');"));
  assert(pipelineSource.includes('await this.sceneNarration.generate(productionId, scene)'));
  assert(pipelineSource.includes('duration: narration.duration'));
  assert(repairSource.includes("timingSource: 'measured-scene-audio'"));

  await fsp.rm(temp, { recursive: true, force: true });
  console.log('Phase 3 audio timing OK: 14 regression checks passed.');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
