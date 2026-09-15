'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const videoPath = path.join(upstream, 'utils', 'ai-video-generator.js');

let source = fs.readFileSync(videoPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const start = source.indexOf('  async generateGeminiTTS(text, outputPath) {');
const end = source.indexOf('  splitTTSChunks(text, maxChars = 3000) {', start);
if (start === -1 || end === -1) {
  throw new Error('Gemini TTS hardening anchors not found in ai-video-generator.js');
}

const hardenedMethod = `  async generateGeminiTTS(text, outputPath) {
    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
    const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';
    const chunks = this.splitTTSChunks(text, 3000);
    if (chunks.length === 0) throw new Error('Gemini TTS received empty narration text');

    const configuredAttempts = Number(process.env.GEMINI_TTS_RETRIES || 3);
    const maxAttempts = Number.isFinite(configuredAttempts)
      ? Math.max(1, Math.min(5, Math.round(configuredAttempts)))
      : 3;
    const configuredDelay = Number(process.env.GEMINI_TTS_RETRY_MS || 750);
    const retryBaseMs = Number.isFinite(configuredDelay)
      ? Math.max(0, Math.min(10000, Math.round(configuredDelay)))
      : 750;

    const errorInfo = error => {
      const rawStatus = error?.status ?? error?.statusCode ?? error?.httpStatusCode ?? error?.response?.status;
      let status = Number(rawStatus || 0);
      const message = String(error?.message || error?.response?.data?.error?.message || error || 'Gemini TTS request failed');
      if (!status) {
        const statusMatch = message.match(/\\b(4\\d\\d|5\\d\\d)\\b/);
        if (statusMatch) status = Number(statusMatch[1]);
      }
      const lower = message.toLowerCase();
      const quotaZero = /(?:quota|limit|remaining)[^\\n]{0,160}(?:[:=]\\s*)?0\\b/.test(lower) || /limit\\s*:\\s*0\\b/.test(lower);
      const network = /econnreset|econnrefused|etimedout|eai_again|enotfound|socket hang up|fetch failed/.test(lower);
      const retryable = !quotaZero && (network || [408, 409, 425, 429].includes(status) || status >= 500);
      return { status, message, quotaZero, retryable };
    };

    this.logger.info(\`Gemini TTS narration split into \${chunks.length} chunk(s).\`);
    const pcmBuffers = [];

    for (let index = 0; index < chunks.length; index++) {
      const spokenPrompt = [
        'Synthesize speech only from the transcript below.',
        'Read the transcript as natural documentary narration.',
        'Do not read these instructions, XML tags, or add commentary.',
        '<transcript>',
        chunks[index],
        '</transcript>'
      ].join('\\n');

      let audioData = null;
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await this.gemini.models.generateContent({
            model,
            contents: [{ parts: [{ text: spokenPrompt }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName }
                }
              }
            }
          });

          audioData = response.candidates?.[0]?.content?.parts?.find(part => part?.inlineData?.data)?.inlineData?.data || null;
          if (!audioData) {
            const finishReason = response.candidates?.[0]?.finishReason || response.candidates?.[0]?.finish_reason || 'unknown';
            const returnedText = (response.candidates?.[0]?.content?.parts || [])
              .map(part => typeof part?.text === 'string' ? part.text : '')
              .filter(Boolean)
              .join(' ')
              .slice(0, 160);
            const noAudio = new Error(\`Gemini TTS returned no audio data for chunk \${index + 1}/\${chunks.length} (finishReason=\${finishReason}\${returnedText ? ', textResponse=true' : ''})\`);
            noAudio.status = 502;
            noAudio.code = 'GEMINI_TTS_NO_AUDIO';
            throw noAudio;
          }

          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const info = errorInfo(error);
          const canRetry = info.retryable && attempt < maxAttempts;
          if (canRetry) {
            const delay = retryBaseMs * Math.pow(2, attempt - 1);
            this.logger.warn(\`Gemini TTS chunk \${index + 1}/\${chunks.length} failed (attempt \${attempt}/\${maxAttempts}); retrying in \${delay}ms: \${info.message}\`);
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          if (info.retryable && attempt >= maxAttempts) error.code = 'GEMINI_TTS_RETRY_EXHAUSTED';
          else if (!error.code) error.code = info.quotaZero ? 'GEMINI_TTS_QUOTA_ZERO' : 'GEMINI_TTS_REQUEST_FAILED';
          if (!error.status && info.status) error.status = info.status;
          error.geminiTTS = { model, voiceName, chunkIndex: index, chunkCount: chunks.length, attempt, maxAttempts, retryable: info.retryable, quotaZero: info.quotaZero };
          throw error;
        }
      }

      if (!audioData && lastError) throw lastError;
      pcmBuffers.push(Buffer.from(audioData, 'base64'));
      this.logger.info(\`Gemini TTS chunk \${index + 1}/\${chunks.length} complete.\`);
    }

    const pcmPath = outputPath + '.pcm';
    await fs.writeFile(pcmPath, Buffer.concat(pcmBuffers));
    try {
      await runFFmpeg(['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outputPath]);
    } finally {
      await fs.unlink(pcmPath).catch(() => {});
    }

    this.logger.info('Gemini TTS generation complete');
    return outputPath;
  }

`;
source = source.slice(0, start) + hardenedMethod + source.slice(end);

const oldLog = "      this.logger.error('TTS generation failed:', error);";
const newLog = "      const reason = error && error.message ? error.message : String(error);\n      this.logger.error(`TTS generation failed via ${provider}/${model || 'unknown'}: ${reason}`, error);";
if (!source.includes(newLog)) {
  if (!source.includes(oldLog)) throw new Error('TTS error logging anchor not found');
  source = source.replace(oldLog, newLog);
}
fs.writeFileSync(videoPath, source, 'utf8');

const narrationPath = path.join(upstream, 'utils', 'scene-narration-v3.js');
if (fs.existsSync(narrationPath)) {
  let narration = fs.readFileSync(narrationPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const retryAnchor = "  isRetriable(error) {\n    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);";
  const retryReplacement = "  isRetriable(error) {\n    if (error?.code === 'GEMINI_TTS_RETRY_EXHAUSTED') return false;\n    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);";
  if (!narration.includes(retryReplacement)) {
    if (!narration.includes(retryAnchor)) throw new Error('Scene narration retry anchor not found');
    narration = narration.replace(retryAnchor, retryReplacement);
  }
  fs.writeFileSync(narrationPath, narration, 'utf8');
}

const envPath = path.join(upstream, '.env.example');
if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!env.includes('GEMINI_TTS_RETRIES=')) {
    env += '\n# Gemini TTS transient retry policy. Quota-zero/auth/invalid requests remain fail-closed.\nGEMINI_TTS_RETRIES=3\nGEMINI_TTS_RETRY_MS=750\n';
    fs.writeFileSync(envPath, env, 'utf8');
  }
}

const packagePath = path.join(upstream, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.scripts = pkg.scripts || {};
pkg.scripts['test:tts-hardening'] = 'node ../bootstrap/verify-gemini-tts-hardening.js';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log('Gemini TTS hardened: explicit speech prompt, bounded transient retry, fail-closed quota/auth behavior, and actionable console diagnostics.');
