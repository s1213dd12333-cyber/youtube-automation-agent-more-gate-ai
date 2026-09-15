'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 11 reference fallback anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function patchGenerator() {
  const rel = 'utils/ai-video-generator.js';
  let source = read(rel);

  source = replaceOnce(
    source,
    `    if (!this.gemini) {\n      this.logger.warn('Reference-conditioned image generation is unavailable for the active image provider; continuity validation will still run after generation.');\n      return this.generateVisualAssets(prompt, style, count);\n    }\n`,
    `    if (!this.gemini || this.geminiImageDisabledReason) {\n      this.lastReferenceConditionedGeneration = false;\n      const reason = this.geminiImageDisabledReason\n        ? 'Reference-conditioned Gemini Images are disabled for this run after the image quota breaker opened; using the normal local/provider fallback before continuity validation.'\n        : 'Reference-conditioned image generation is unavailable for the active image provider; continuity validation will still run after generation.';\n      this.logger.warn(reason);\n      return this.generateVisualAssets(prompt, style, count);\n    }\n`,
    'respect Gemini image circuit breaker before reference generation'
  );

  source = replaceOnce(
    source,
    `      await this.generateGeminiImageWithReference(enhancedPrompt, referenceData, mimeType, imagePath);\n      localPaths.push(imagePath);\n`,
    `      try {\n        await this.generateGeminiImageWithReference(enhancedPrompt, referenceData, mimeType, imagePath);\n        localPaths.push(imagePath);\n      } catch (error) {\n        const quotaZero = typeof this.isGeminiImageQuotaZeroError === 'function' && this.isGeminiImageQuotaZeroError(error);\n        if (!quotaZero) throw error;\n        this.geminiImageDisabledReason = 'Gemini image free-tier quota is zero for this run';\n        this.lastReferenceConditionedGeneration = false;\n        this.logger.warn('Reference-conditioned Gemini Images disabled after quota=0 response; using the normal local/provider fallback before continuity validation.');\n        return this.generateVisualAssets(prompt, style, count);\n      }\n`,
    'open image breaker when reference generation receives quota zero'
  );

  write(rel, source);
}

function patchLogger() {
  const rel = 'utils/logger.js';
  let source = read(rel);
  source = replaceOnce(
    source,
    `    console.log(this.formatConsoleMessage('ERROR', message, chalk.red));\n`,
    `    const errorDetail = error\n      ? \`\${error.code ? '[' + error.code + '] ' : ''}\${error.message || String(error)}\`\n      : '';\n    console.log(this.formatConsoleMessage('ERROR', errorDetail ? \`\${message} \${errorDetail}\` : message, chalk.red));\n`,
    'show error code and message in console diagnostics'
  );
  write(rel, source);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:reference-fallback'] = 'node ../bootstrap/verify-phase11-reference-quota-fallback.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchGenerator();
patchLogger();
patchPackage();

console.log('Phase 11 reference fallback hardened: Gemini image quota breaker is honored by reference-conditioned keyframes, with actionable console errors.');
