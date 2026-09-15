'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const videoPath = path.join(upstream, 'utils', 'ai-video-generator.js');
const narrationPath = path.join(upstream, 'utils', 'scene-narration-v3.js');

if (!fs.existsSync(videoPath)) throw new Error('ai-video-generator.js is not materialized');
if (!fs.existsSync(narrationPath)) throw new Error('scene-narration-v3.js is not materialized');

const video = fs.readFileSync(videoPath, 'utf8');
const narration = fs.readFileSync(narrationPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

assert(video.includes("process.env.GEMINI_TTS_RETRIES || 3"));
assert(video.includes("process.env.GEMINI_TTS_RETRY_MS || 750"));
assert(video.includes('Synthesize speech only from the transcript below.'));
assert(video.includes("error.code = 'GEMINI_TTS_RETRY_EXHAUSTED'"));
assert(video.includes("'GEMINI_TTS_QUOTA_ZERO'"));
assert(video.includes('TTS generation failed via ${provider}/${model'));
assert(narration.includes("if (error?.code === 'GEMINI_TTS_RETRY_EXHAUSTED') return false;"));
assert.strictEqual(pkg.scripts['test:tts-hardening'], 'node ../bootstrap/verify-gemini-tts-hardening.js');

console.log('Gemini TTS hardening OK: 8 regression checks passed.');
