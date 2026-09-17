'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'ai-video-generator.js');

function assert(condition, message) {
  if (!condition) throw new Error(`Gemini TTS transient fallback regression: ${message}`);
}

async function main() {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert(source.includes("const transientGeminiUnavailable = provider === 'gemini'"), 'runtime must classify persistent transient Gemini failures');
  assert(source.includes("error?.code === 'GEMINI_TTS_RETRY_EXHAUSTED'"), 'runtime must recognize exhausted Gemini TTS retries');
  assert(source.includes('const shouldUseLocalFallback = hardGeminiQuota || transientGeminiUnavailable;'), 'transient failures must join local fallback path');
  assert(source.includes('remained unavailable after bounded retries; switching this narration to local Windows SAPI'), 'operator log must distinguish transient outage fallback');

  const { AIVideoGenerator } = require(runtimePath);
  const previous = {
    retries: process.env.GEMINI_TTS_RETRIES,
    delay: process.env.GEMINI_TTS_RETRY_MS,
    fallback: process.env.LOCAL_TTS_FALLBACK_ENABLED
  };
  process.env.GEMINI_TTS_RETRIES = '1';
  process.env.GEMINI_TTS_RETRY_MS = '0';
  process.env.LOCAL_TTS_FALLBACK_ENABLED = 'true';

  try {
    const generator = new AIVideoGenerator({});
    let fallbackCalls = 0;
    generator.isUsableAudioFile = async () => true;
    generator.generateWindowsSapiTTS = async (_text, outputPath) => {
      fallbackCalls += 1;
      return outputPath;
    };
    generator.gemini = {
      models: {
        generateContent: async () => {
          const error = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
          error.status = 503;
          throw error;
        }
      }
    };

    const outputPath = path.join(upstream, 'data', 'tmp-gemini-tts-fallback.mp3');
    const result = await generator.generateTTSAudio('Transient outage fallback verification.', outputPath);
    assert(result === outputPath, '503 outage must return the local fallback narration path');
    assert(fallbackCalls === 1, '503 outage must invoke Windows SAPI exactly once after bounded Gemini retries');
    assert(generator.lastNarrationResult?.status === 'ready', 'fallback narration must be marked ready');
    assert(generator.lastNarrationResult?.provider === 'windows-sapi', 'fallback narration provider must be windows-sapi');
    assert(generator.lastNarrationResult?.fallbackFrom === 'gemini', 'fallback provenance must record Gemini');
    assert(generator.lastNarrationResult?.fallbackReason === 'GEMINI_TTS_RETRY_EXHAUSTED', 'fallback reason must preserve exhausted retry evidence');

    generator.gemini = {
      models: {
        generateContent: async () => {
          const error = new Error('{"error":{"code":400,"message":"Invalid request","status":"INVALID_ARGUMENT"}}');
          error.status = 400;
          throw error;
        }
      }
    };

    let permanentFailedClosed = false;
    try {
      await generator.generateTTSAudio('Permanent error verification.', outputPath);
    } catch (error) {
      permanentFailedClosed = true;
      assert(error.status === 400, 'permanent Gemini request error should preserve status');
    }
    assert(permanentFailedClosed, 'permanent 4xx request errors must remain fail-closed');
    assert(fallbackCalls === 1, 'permanent 4xx request errors must not invoke local fallback');

    console.log('Gemini TTS transient fallback verified: 503/high-demand retry exhaustion falls back locally; permanent 4xx errors remain fail-closed.');
  } finally {
    if (previous.retries == null) delete process.env.GEMINI_TTS_RETRIES; else process.env.GEMINI_TTS_RETRIES = previous.retries;
    if (previous.delay == null) delete process.env.GEMINI_TTS_RETRY_MS; else process.env.GEMINI_TTS_RETRY_MS = previous.delay;
    if (previous.fallback == null) delete process.env.LOCAL_TTS_FALLBACK_ENABLED; else process.env.LOCAL_TTS_FALLBACK_ENABLED = previous.fallback;
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
