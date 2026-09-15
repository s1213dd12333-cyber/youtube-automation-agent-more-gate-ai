'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

function read(rel) {
  return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function write(rel, source) {
  fs.writeFileSync(path.join(upstream, rel), source, 'utf8');
}

function patchSimple(rel, replacements) {
  let source = read(rel);
  let changed = false;
  for (const { from, to, label, satisfiedBy = [] } of replacements) {
    if ([to, ...satisfiedBy].some(marker => marker && source.includes(marker))) continue;
    if (!source.includes(from)) throw new Error(`Phase 11.4 evidence anchor not found: ${label}`);
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) write(rel, source);
}

function normalizeInitialKeyframeEvidence() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let source = read(rel);
  const finalMarker = 'const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;';
  if (source.includes(finalMarker)) return;

  const referenceCall = "await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)";
  const callIndex = source.indexOf(referenceCall);
  if (callIndex === -1) throw new Error('Phase 11.4 evidence anchor not found: reference-conditioned keyframe provider call');

  let assetsLineStart = source.lastIndexOf('\n        const assets =', callIndex);
  if (assetsLineStart === -1) throw new Error('Phase 11.4 evidence anchor not found: keyframe assets assignment');
  assetsLineStart += 1;

  let blockStart = assetsLineStart;
  const previousLineStartRaw = source.lastIndexOf('\n', Math.max(0, assetsLineStart - 2));
  const previousLineStart = previousLineStartRaw === -1 ? 0 : previousLineStartRaw + 1;
  const previousLine = source.slice(previousLineStart, assetsLineStart);
  if (/^        const (?:referenceConditioned|canUseReference)\s*=/.test(previousLine)) blockStart = previousLineStart;

  const sourcePathRegex = /        (?:let|const) sourcePath = Array\.isArray\(assets\) \? assets\[0\] : null;\n/g;
  sourcePathRegex.lastIndex = callIndex;
  const sourcePathMatch = sourcePathRegex.exec(source);
  if (!sourcePathMatch || sourcePathMatch.index - callIndex > 1200) {
    throw new Error('Phase 11.4 evidence anchor not found: keyframe sourcePath assignment');
  }
  const blockEnd = sourcePathMatch.index + sourcePathMatch[0].length;

  const canonical = [
    "        const canUseReference = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');",
    '        const assets = canUseReference',
    "          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)",
    "          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);",
    '        const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;',
    '        let sourcePath = Array.isArray(assets) ? assets[0] : null;',
    ''
  ].join('\n');

  source = source.slice(0, blockStart) + canonical + source.slice(blockEnd);
  if (!source.includes(finalMarker)) throw new Error('Phase 11.4 evidence normalization failed: truthful initial reference evidence missing');
  write(rel, source);
}

function normalizeRepairEvidence() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let source = read(rel);
  const finalMarker = 'referenceConditioned: Boolean(referenceAssetPath && this.videoGenerator.lastReferenceConditionedGeneration === true)';
  if (source.includes(finalMarker)) return;

  const legacyMarker = "referenceConditioned: Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function')";
  if (source.includes(legacyMarker)) {
    source = source.replaceAll(legacyMarker, finalMarker);
    write(rel, source);
    return;
  }

  const repairAttemptIndex = source.indexOf('attempt: repairAttempt');
  if (repairAttemptIndex !== -1) {
    const windowStart = Math.max(0, repairAttemptIndex - 700);
    const window = source.slice(windowStart, repairAttemptIndex + 200);
    if (window.includes('referenceConditioned:') && window.includes('lastReferenceConditionedGeneration === true')) return;
  }
  throw new Error('Phase 11.4 evidence anchor not found: truthful repair reference-conditioning evidence');
}

patchSimple('utils/ai-video-generator.js', [{
  from: '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n',
  to: '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    this.lastReferenceConditionedGeneration = false;\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n',
  label: 'initialize reference-conditioning evidence',
  satisfiedBy: ['this.lastReferenceConditionedGeneration = false;']
}, {
  from: '    return localPaths;\n  }\n\n  async generateGeminiImageWithReference',
  to: '    this.lastReferenceConditionedGeneration = true;\n    return localPaths;\n  }\n\n  async generateGeminiImageWithReference',
  label: 'mark real Gemini reference conditioning',
  satisfiedBy: ['this.lastReferenceConditionedGeneration = true;']
}]);

normalizeInitialKeyframeEvidence();
normalizeRepairEvidence();

console.log('Phase 11.4 continuity evidence hardened: runtime normalized and referenceConditioned is true only when the reference image was actually sent to the image provider.');
