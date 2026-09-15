'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, source) => fs.writeFileSync(path.join(upstream, rel), source, 'utf8');

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Phase 11.4 evidence anchor not found: ${label}`);
  return source.replace(from, to);
}

function ensureGeneratorRuntime() {
  const rel = 'utils/ai-video-generator.js';
  let source = read(rel);

  if (!source.includes('  async generateVisualAssetsWithReference(')) {
    const anchor = '  async generateVisualAssets(prompt, style = "ethereal", count = 1) {\n';
    if (!source.includes(anchor)) throw new Error('Phase 11.4 generator anchor not found: generateVisualAssets');
    const block = [
      '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {',
      '    this.lastReferenceConditionedGeneration = false;',
      '    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);',
      '    if (!this.gemini) {',
      "      this.logger.warn('Reference-conditioned image generation is unavailable for the active image provider; continuity validation will still run after generation.');",
      '      return this.generateVisualAssets(prompt, style, count);',
      '    }',
      '    const enhancedPrompt = this.enhanceVisualPrompt(prompt, style);',
      '    const extension = path.extname(referenceAssetPath).toLowerCase();',
      "    const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';",
      "    const referenceData = (await fs.readFile(referenceAssetPath)).toString('base64');",
      '    const localPaths = [];',
      '    for (let i = 0; i < count; i++) {',
      "      const imagePath = path.join(__dirname, '..', 'data', 'assets', 'visual_ref_' + Date.now() + '_' + i + '.png');",
      '      await this.generateGeminiImageWithReference(enhancedPrompt, referenceData, mimeType, imagePath);',
      '      localPaths.push(imagePath);',
      '    }',
      '    this.lastReferenceConditionedGeneration = true;',
      '    return localPaths;',
      '  }',
      '',
      '  async generateGeminiImageWithReference(prompt, referenceData, mimeType, imagePath) {',
      '    await fs.mkdir(path.dirname(imagePath), { recursive: true });',
      "    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';",
      '    const response = await this.gemini.models.generateContent({',
      '      model,',
      "      contents: [{ role: 'user', parts: [",
      '        { inlineData: { mimeType, data: referenceData } },',
      "        { text: 'Use the supplied image as the strict continuity reference. Preserve character identity and established visual state.\\n\\n' + prompt }",
      '      ] }],',
      "      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } }",
      '    });',
      '    const parts = response.candidates?.[0]?.content?.parts || [];',
      "    const imageParts = parts.filter(part => part.inlineData?.data && (!part.inlineData.mimeType || part.inlineData.mimeType.startsWith('image/')));",
      '    const rendered = imageParts.filter(part => part.thought !== true);',
      '    const imagePart = (rendered.length ? rendered : imageParts).at(-1);',
      "    if (!imagePart) throw new Error('Gemini reference-conditioned image generation returned no image data');",
      "    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');",
      "    await sharp(imageBuffer, { failOn: 'error' }).png().toFile(imagePath);",
      '    return imagePath;',
      '  }',
      '',
    ].join('\n');
    source = source.replace(anchor, block + anchor);
  }

  source = replaceRequired(
    source,
    '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n',
    '  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    this.lastReferenceConditionedGeneration = false;\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n',
    'initialize reference-conditioning evidence'
  );

  if (!source.includes('this.lastReferenceConditionedGeneration = true;')) {
    source = replaceRequired(
      source,
      '    return localPaths;\n  }\n\n  async generateGeminiImageWithReference',
      '    this.lastReferenceConditionedGeneration = true;\n    return localPaths;\n  }\n\n  async generateGeminiImageWithReference',
      'mark real Gemini reference conditioning'
    );
  }

  write(rel, source);
}

function ensureKeyframeContinuityRuntime() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let source = read(rel);

  if (!source.includes('this.continuityEngine = options.continuityEngine || null;')) {
    source = replaceRequired(
      source,
      "    this.generationEnabled = String(options.generationEnabled ?? process.env.CARTOON_KEYFRAME_GENERATION_ENABLED ?? 'true').toLowerCase() !== 'false';\n",
      "    this.generationEnabled = String(options.generationEnabled ?? process.env.CARTOON_KEYFRAME_GENERATION_ENABLED ?? 'true').toLowerCase() !== 'false';\n    this.continuityEngine = options.continuityEngine || null;\n",
      'continuity engine option after downgraded 11.3 runtime'
    );
  }

  if (!source.includes('generateVisualAssetsWithReference(current.prompt, referenceAssetPath')) {
    source = replaceRequired(
      source,
      "        const assets = await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        const sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
      "        const canUseReference = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = canUseReference\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
      'restore reference-conditioned keyframe provider call after downgraded 11.3 runtime'
    );
  } else {
    source = source.replace(
      "        const referenceConditioned = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = referenceConditioned\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
      "        const canUseReference = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = canUseReference\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        const referenceConditioned = canUseReference && this.videoGenerator.lastReferenceConditionedGeneration === true;\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n"
    );
  }

  if (!source.includes('let continuityResult = null;')) {
    source = replaceRequired(
      source,
      "        const local = path.basename(sourcePath).startsWith('visual_local_');\n        const assetPath = await this.persistAsset(sourcePath, current);\n        await this.db.updateShotKeyframe(current.id, {\n",
      "        let local = path.basename(sourcePath).startsWith('visual_local_');\n        let assetPath = await this.persistAsset(sourcePath, current);\n        let continuityResult = null;\n        if (this.continuityEngine) {\n          continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned, attempt: 0 });\n          let repairAttempt = 0;\n          while (!continuityResult.accepted && this.continuityEngine.autoRepair && repairAttempt < this.continuityEngine.maxRepairAttempts) {\n            repairAttempt += 1;\n            const repairPrompt = this.continuityEngine.repairPrompt(current, continuityResult);\n            const canRepairWithReference = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n            const repairAssets = canRepairWithReference\n              ? await this.videoGenerator.generateVisualAssetsWithReference(repairPrompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n              : await this.videoGenerator.generateVisualAssets(repairPrompt, 'kids_cartoon_2d', 1);\n            sourcePath = Array.isArray(repairAssets) ? repairAssets[0] : null;\n            if (!sourcePath || !IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) || !await this.pathExists(sourcePath)) break;\n            local = path.basename(sourcePath).startsWith('visual_local_');\n            assetPath = await this.persistAsset(sourcePath, current);\n            const repairReferenceConditioned = canRepairWithReference && this.videoGenerator.lastReferenceConditionedGeneration === true;\n            continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned: repairReferenceConditioned, attempt: repairAttempt });\n          }\n          if (!continuityResult.accepted) {\n            await this.db.updateShotKeyframe(current.id, { status: 'continuity_failed', assetPath, error: 'Continuity score ' + Number(continuityResult.score || 0).toFixed(3) + ' below ' + Number(continuityResult.threshold || 0).toFixed(3) });\n            const continuityError = new Error('Continuity validation failed for keyframe ' + current.id + ': score=' + Number(continuityResult.score || 0).toFixed(3) + ' threshold=' + Number(continuityResult.threshold || 0).toFixed(3));\n            continuityError.code = 'CARTOON_CONTINUITY_FAILED';\n            throw continuityError;\n          }\n        }\n        await this.db.updateShotKeyframe(current.id, {\n",
      'restore continuity validation loop after downgraded 11.3 runtime'
    );
  }

  const required = [
    'this.continuityEngine = options.continuityEngine || null;',
    'generateVisualAssetsWithReference(current.prompt, referenceAssetPath',
    'this.videoGenerator.lastReferenceConditionedGeneration === true',
    'this.continuityEngine.evaluate({ productionId, sceneId',
    'repairAttempt < this.continuityEngine.maxRepairAttempts',
    "status: 'continuity_failed'",
    "continuityError.code = 'CARTOON_CONTINUITY_FAILED'"
  ];
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`Phase 11.4 continuity runtime repair incomplete: ${marker}`);
  }

  write(rel, source);
}

ensureGeneratorRuntime();
ensureKeyframeContinuityRuntime();

console.log('Phase 11.4 continuity evidence hardened: downgraded 11.3 keyframe runtimes are repaired, and referenceConditioned is true only when the reference image was actually sent to the image provider.');
