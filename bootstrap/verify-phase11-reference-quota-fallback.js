'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const generator = fs.readFileSync(path.join(upstream, 'utils', 'ai-video-generator.js'), 'utf8');
const logger = fs.readFileSync(path.join(upstream, 'utils', 'logger.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

const checks = [
  () => assert(generator.includes('if (!this.gemini || this.geminiImageDisabledReason)')),
  () => assert(generator.includes("this.geminiImageDisabledReason = 'Gemini image free-tier quota is zero for this run'")),
  () => assert(generator.includes("Reference-conditioned Gemini Images disabled after quota=0 response")),
  () => assert(generator.includes('return this.generateVisualAssets(prompt, style, count);')),
  () => assert(logger.includes("error.code ? '[' + error.code + '] ' : ''")),
  () => assert(logger.includes('error.message || String(error)')),
  () => assert.strictEqual(pkg.scripts['test:reference-fallback'], 'node ../bootstrap/verify-phase11-reference-quota-fallback.js')
];

for (const check of checks) check();
console.log(`Phase 11 Reference Quota Fallback OK: ${checks.length} regression checks passed.`);
