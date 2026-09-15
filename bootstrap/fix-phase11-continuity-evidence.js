'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

function patch(rel, replacements) {
  const target = path.join(upstream, rel);
  let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const [from, to, label] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) throw new Error(`Phase 11.4 evidence anchor not found: ${label}`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(target, source, 'utf8');
}

patch('utils/ai-video-generator.js', [[
  '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n',
  '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    this.lastReferenceConditionedGeneration = false;\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n',
  'initialize reference-conditioning evidence'
], [
  '    return localPaths;\n  }\n\n  async generateGeminiImageWithReference',
  '    this.lastReferenceConditionedGeneration = true;\n    return localPaths;\n  }\n\n  async generateGeminiImageWithReference',
  'mark real Gemini reference conditioning'
]]);

patch('utils/cartoon-keyframe-pipeline-v11.js', [[
  "        const referenceConditioned = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = referenceConditioned\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
  "        const canUseReference = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = canUseReference\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
  'truthful initial reference-conditioning evidence'
], [
  "            continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned: Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function'), attempt: repairAttempt });\n",
  "            continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned: Boolean(referenceAssetPath && this.videoGenerator.lastReferenceConditionedGeneration === true), attempt: repairAttempt });\n",
  'truthful repair reference-conditioning evidence'
]]);

console.log('Phase 11.4 continuity evidence hardened: referenceConditioned is true only when the reference image was actually sent to the image provider.');
