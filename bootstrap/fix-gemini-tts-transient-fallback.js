'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtimePath = path.join(upstream, 'utils', 'ai-video-generator.js');
const envPath = path.join(upstream, '.env.example');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function write(file, value) {
  fs.writeFileSync(file, value.replace(/\r\n/g, '\n'), 'utf8');
}

let source = read(runtimePath);

const oldBlock = `      const hardGeminiQuota = provider === 'gemini' && (\n        error?.code === 'GEMINI_TTS_DAILY_QUOTA_EXHAUSTED' ||\n        error?.code === 'GEMINI_TTS_QUOTA_ZERO' ||\n        error?.geminiTTS?.dailyQuota === true ||\n        error?.geminiTTS?.quotaZero === true\n      );\n\n      if (hardGeminiQuota && localFallbackEnabled) {\n        this.logger.warn('Gemini TTS quota exhausted; switching this narration to local Windows SAPI (no network, no provider charge).');\n`;

const newBlock = `      const hardGeminiQuota = provider === 'gemini' && (\n        error?.code === 'GEMINI_TTS_DAILY_QUOTA_EXHAUSTED' ||\n        error?.code === 'GEMINI_TTS_QUOTA_ZERO' ||\n        error?.geminiTTS?.dailyQuota === true ||\n        error?.geminiTTS?.quotaZero === true\n      );\n      const geminiStatus = Number(error?.status || error?.statusCode || error?.response?.status || 0);\n      const geminiReason = reason.toLowerCase();\n      const transientGeminiUnavailable = provider === 'gemini' &&\n        error?.code === 'GEMINI_TTS_RETRY_EXHAUSTED' && (\n          geminiStatus >= 500 ||\n          [408, 409, 425, 429].includes(geminiStatus) ||\n          /high demand|temporar(?:y|ily)|unavailable|service unavailable|overloaded|econnreset|econnrefused|etimedout|eai_again|socket hang up|fetch failed/.test(geminiReason)\n        );\n      const shouldUseLocalFallback = hardGeminiQuota || transientGeminiUnavailable;\n\n      if (shouldUseLocalFallback && localFallbackEnabled) {\n        this.logger.warn(transientGeminiUnavailable\n          ? 'Gemini TTS remained unavailable after bounded retries; switching this narration to local Windows SAPI (no network, no provider charge).'\n          : 'Gemini TTS quota exhausted; switching this narration to local Windows SAPI (no network, no provider charge).');\n`;

if (!source.includes('const transientGeminiUnavailable = provider === \'gemini\'')) {
  const index = source.indexOf(oldBlock);
  if (index === -1) throw new Error('Gemini transient fallback anchor not found in ai-video-generator.js');
  source = source.slice(0, index) + newBlock + source.slice(index + oldBlock.length);
}

write(runtimePath, source);

if (fs.existsSync(envPath)) {
  let env = read(envPath);
  env = env.replace(
    '# Windows-only zero-cost narration fallback when Gemini TTS hard quota is exhausted.',
    '# Windows-only zero-cost narration fallback when Gemini TTS hard quota is exhausted or remains transiently unavailable after bounded retries.'
  );
  write(envPath, env);
}

console.log('Gemini TTS transient fallback active: persistent 5xx/high-demand failures now fall back to Windows SAPI after bounded retries, while permanent request/auth errors remain fail-closed.');
