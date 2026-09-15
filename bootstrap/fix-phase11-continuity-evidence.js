'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');

function patch(rel, replacements) {
  const target = path.join(upstream, rel);
  let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let changed = false;

  for (const replacement of replacements) {
    const { from, to, label, satisfiedBy = [] } = replacement;
    const satisfied = [to, ...satisfiedBy].some(marker => marker && source.includes(marker));
    if (satisfied) continue;
    if (!source.includes(from)) {
      throw new Error(`Phase 11.4 evidence anchor not found: ${label}`);
    }
    source = source.replace(from, to);
    changed = true;
  }

  if (changed) fs.writeFileSync(target, source, 'utf8');
}

patch('utils/ai-video-generator.js', [{
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

patch('utils/cartoon-keyframe-pipeline-v11.js', [{
  from: "        const referenceConditioned = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = referenceConditioned\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
  to: "        const canUseReference = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = canUseReference\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
  label: 'truthful initial reference-conditioning evidence',
  satisfiedBy: [
    'const canUseReference = Boolean(referenceAssetPath',
    'const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;'
  ]
}, {
  from: "            continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned: Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function'), attempt: repairAttempt });\n",
  to: "            continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned: Boolean(referenceAssetPath && this.videoGenerator.lastReferenceConditionedGeneration === true), attempt: repairAttempt });\n",
  label: 'truthful repair reference-conditioning evidence',
  satisfiedBy: [
    'referenceConditioned: Boolean(referenceAssetPath && this.videoGenerator.lastReferenceConditionedGeneration === true)'
  ]
}]);

console.log('Phase 11.4 continuity evidence hardened: referenceConditioned is true only when the reference image was actually sent to the image provider.');
