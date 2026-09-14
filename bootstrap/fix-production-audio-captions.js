'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

function patch(rel, mutator) {
  const file = path.join(upstream, rel);
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const next = mutator(source);
  if (next === source) {
    console.log(`${rel}: already patched`);
    return;
  }
  fs.writeFileSync(file, next, 'utf8');
  console.log(`${rel}: patched`);
}

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

// 1) Gemini TTS: split long narration into sentence-aware chunks, request audio
// sequentially, concatenate raw PCM (same format), and encode once with FFmpeg.
patch('utils/ai-video-generator.js', source => {
  const from = `  async generateGeminiTTS(text, outputPath) {\n    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';\n    const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';\n\n    const response = await this.gemini.models.generateContent({\n      model,\n      contents: [{ parts: [{ text }] }],\n      config: {\n        responseModalities: ['AUDIO'],\n        speechConfig: {\n          voiceConfig: {\n            prebuiltVoiceConfig: { voiceName }\n          }\n        }\n      }\n    });\n\n    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;\n    if (!audioData) {\n      throw new Error('Gemini TTS returned no audio data');\n    }\n\n    // Gemini returns raw PCM (24kHz, mono, 16-bit); encode to the requested container via FFmpeg\n    const pcmPath = outputPath + '.pcm';\n    await fs.writeFile(pcmPath, Buffer.from(audioData, 'base64'));\n    await runFFmpeg(['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outputPath]);\n    await fs.unlink(pcmPath).catch(() => {});\n\n    this.logger.info('Gemini TTS generation complete');\n    return outputPath;\n  }`;

  const to = `  async generateGeminiTTS(text, outputPath) {\n    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';\n    const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';\n    const chunks = this.splitTTSChunks(text, 3000);\n    if (chunks.length === 0) throw new Error('Gemini TTS received empty narration text');\n\n    this.logger.info(\`Gemini TTS narration split into \${chunks.length} chunk(s).\`);\n    const pcmBuffers = [];\n\n    for (let index = 0; index < chunks.length; index++) {\n      const response = await this.gemini.models.generateContent({\n        model,\n        contents: [{ parts: [{ text: chunks[index] }] }],\n        config: {\n          responseModalities: ['AUDIO'],\n          speechConfig: {\n            voiceConfig: {\n              prebuiltVoiceConfig: { voiceName }\n            }\n          }\n        }\n      });\n\n      const audioData = response.candidates?.[0]?.content?.parts?.find(part => part?.inlineData?.data)?.inlineData?.data;\n      if (!audioData) {\n        throw new Error(\`Gemini TTS returned no audio data for chunk \${index + 1}/\${chunks.length}\`);\n      }\n      pcmBuffers.push(Buffer.from(audioData, 'base64'));\n      this.logger.info(\`Gemini TTS chunk \${index + 1}/\${chunks.length} complete.\`);\n    }\n\n    // Every Gemini TTS chunk uses the same PCM format, so concatenating the raw\n    // PCM buffers is lossless and avoids MP3 concat/container edge cases.\n    const pcmPath = outputPath + '.pcm';\n    await fs.writeFile(pcmPath, Buffer.concat(pcmBuffers));\n    try {\n      await runFFmpeg(['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outputPath]);\n    } finally {\n      await fs.unlink(pcmPath).catch(() => {});\n    }\n\n    this.logger.info('Gemini TTS generation complete');\n    return outputPath;\n  }\n\n  splitTTSChunks(text, maxChars = 3000) {\n    const normalized = String(text || '').replace(/\\r/g, '').trim();\n    if (!normalized) return [];\n    if (normalized.length <= maxChars) return [normalized];\n\n    const sentences = normalized.split(/(?<=[.!?])\\s+/).filter(Boolean);\n    const chunks = [];\n    let current = '';\n\n    const pushCurrent = () => {\n      const value = current.trim();\n      if (value) chunks.push(value);\n      current = '';\n    };\n\n    for (const sentence of sentences) {\n      if (sentence.length > maxChars) {\n        pushCurrent();\n        for (let offset = 0; offset < sentence.length; offset += maxChars) {\n          chunks.push(sentence.slice(offset, offset + maxChars).trim());\n        }\n        continue;\n      }\n\n      const candidate = current ? \`\${current} \${sentence}\` : sentence;\n      if (candidate.length > maxChars) pushCurrent();\n      current = current ? \`\${current} \${sentence}\` : sentence;\n    }\n    pushCurrent();\n    return chunks.filter(Boolean);\n  }`;

  return replaceOnce(source, from, to, 'chunked Gemini TTS');
});

// 2) Captions: support both the legacy recap shape and the hardened keyPoints /
// summary conclusion shape. Also avoid passing undefined text into processText.
patch('agents/production-management-agent.js', source => {
  let next = source;

  next = replaceOnce(
    next,
    `    const processText = (text, startTime, duration) => {\n      const words = text.split(' ');`,
    `    const processText = (text, startTime, duration) => {\n      const normalizedText = String(text || '').trim();\n      if (!normalizedText) return;\n      const words = normalizedText.split(/\\s+/);`,
    'caption text normalization'
  );

  next = replaceOnce(
    next,
    `    // Conclusion\n    if (script.conclusion) {\n      const conclusionText = script.conclusion.recap.join(' ') + ' ' + script.conclusion.finalThought;\n      processText(conclusionText, currentTime, 30);\n      currentTime += 30;\n    }`,
    `    // Conclusion — support legacy recap and newer keyPoints/summary shapes.\n    if (script.conclusion) {\n      const conclusionLines = Array.isArray(script.conclusion.recap)\n        ? script.conclusion.recap\n        : Array.isArray(script.conclusion.keyPoints)\n          ? script.conclusion.keyPoints\n          : script.conclusion.summary ? [script.conclusion.summary] : [];\n      const conclusionText = [...conclusionLines, script.conclusion.finalThought]\n        .filter(value => typeof value === 'string' && value.trim())\n        .join(' ');\n      if (conclusionText) {\n        processText(conclusionText, currentTime, 30);\n        currentTime += 30;\n      }\n    }`,
    'caption conclusion shape normalization'
  );

  return next;
});

console.log('Production audio/captions hardening applied.');
