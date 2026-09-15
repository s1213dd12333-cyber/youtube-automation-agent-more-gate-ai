'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'cartoon-continuity-engine-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cartoon-continuity-engine-v11.js');
  write('utils/cartoon-continuity-engine-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.4 continuity audit trail",
    "      `CREATE TABLE IF NOT EXISTS keyframe_continuity_checks (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        shot_id TEXT NOT NULL,",
    "        keyframe_id TEXT NOT NULL,",
    "        reference_keyframe_id TEXT,",
    "        version TEXT NOT NULL DEFAULT '11.4',",
    "        attempt INTEGER NOT NULL DEFAULT 0,",
    "        score REAL NOT NULL,",
    "        threshold REAL NOT NULL,",
    "        status TEXT NOT NULL,",
    "        metrics TEXT NOT NULL DEFAULT '{}',",
    "        reasons TEXT NOT NULL DEFAULT '[]',",
    "        reference_conditioned INTEGER NOT NULL DEFAULT 0,",
    "        created_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (keyframe_id) REFERENCES shot_keyframes(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_keyframe_continuity_prod ON keyframe_continuity_checks(production_id, scene_id, shot_id, keyframe_id, attempt)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Phase 11.4 continuity table');

  const methods = [
    "  async saveKeyframeContinuityCheck(input = {}) {",
    "    const id = input.id || this.generateId('continuity');",
    "    await this.executeQuery(",
    "      `INSERT INTO keyframe_continuity_checks (",
    "        id, production_id, scene_id, shot_id, keyframe_id, reference_keyframe_id, version, attempt, score, threshold, status, metrics, reasons, reference_conditioned, created_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [id, input.productionId, input.sceneId, input.shotId, input.keyframeId, input.referenceKeyframeId || null, String(input.version || '11.4'),",
    "       Number(input.attempt || 0), Number(input.score || 0), Number(input.threshold || 0), input.status || 'unknown',",
    "       JSON.stringify(input.metrics || {}), JSON.stringify(input.reasons || []), input.referenceConditioned ? 1 : 0, input.createdAt || new Date().toISOString()]",
    "    );",
    "    return this.getRow('SELECT * FROM keyframe_continuity_checks WHERE id = ?', [id]);",
    "  }",
    "",
    "  async listKeyframeContinuityChecks(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM keyframe_continuity_checks WHERE production_id = ? ORDER BY created_at, attempt', [productionId]);",
    "    return rows.map(row => ({ ...row, score: Number(row.score || 0), threshold: Number(row.threshold || 0), attempt: Number(row.attempt || 0),",
    "      metrics: JSON.parse(row.metrics || '{}'), reasons: JSON.parse(row.reasons || '[]'), referenceConditioned: Boolean(row.reference_conditioned) }));",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 11.4 continuity DB methods');
  s = replaceOnce(
    s,
    "    const keyframes = await this.listShotKeyframes(productionId);\n",
    "    const keyframes = await this.listShotKeyframes(productionId);\n    const continuityChecks = await this.listKeyframeContinuityChecks(productionId);\n",
    'load continuity checks in production bundle'
  );
  s = replaceOnce(
    s,
    "      keyframes,\n",
    "      keyframes,\n      continuityChecks,\n",
    'expose continuity checks in production bundle'
  );
  write(rel, s);
}

function patchGenerator() {
  const rel = 'utils/ai-video-generator.js';
  let s = read(rel);
  const block = `  async generateVisualAssetsWithReference(prompt, referenceAssetPath, style = "kids_cartoon_2d", count = 1) {\n    if (!referenceAssetPath) return this.generateVisualAssets(prompt, style, count);\n    if (!this.gemini) {\n      this.logger.warn('Reference-conditioned image generation is unavailable for the active image provider; continuity validation will still run after generation.');\n      return this.generateVisualAssets(prompt, style, count);\n    }\n    const enhancedPrompt = this.enhanceVisualPrompt(prompt, style);\n    const extension = path.extname(referenceAssetPath).toLowerCase();\n    const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';\n    const referenceData = (await fs.readFile(referenceAssetPath)).toString('base64');\n    const localPaths = [];\n    for (let i = 0; i < count; i++) {\n      const imagePath = path.join(__dirname, '..', 'data', 'assets', \\`visual_ref_\\${Date.now()}_\\${i}.png\\`);\n      await this.generateGeminiImageWithReference(enhancedPrompt, referenceData, mimeType, imagePath);\n      localPaths.push(imagePath);\n    }\n    return localPaths;\n  }\n\n  async generateGeminiImageWithReference(prompt, referenceData, mimeType, imagePath) {\n    await fs.mkdir(path.dirname(imagePath), { recursive: true });\n    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';\n    const response = await this.gemini.models.generateContent({\n      model,\n      contents: [{ role: 'user', parts: [\n        { inlineData: { mimeType, data: referenceData } },\n        { text: \\`Use the supplied image as the strict continuity reference. Preserve character identity and established visual state.\\n\\n\\${prompt}\\` }\n      ] }],\n      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } }\n    });\n    const parts = response.candidates?.[0]?.content?.parts || [];\n    const imageParts = parts.filter(part => part.inlineData?.data && (!part.inlineData.mimeType || part.inlineData.mimeType.startsWith('image/')));\n    const rendered = imageParts.filter(part => part.thought !== true);\n    const imagePart = (rendered.length ? rendered : imageParts).at(-1);\n    if (!imagePart) throw new Error('Gemini reference-conditioned image generation returned no image data');\n    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');\n    await sharp(imageBuffer, { failOn: 'error' }).png().toFile(imagePath);\n    return imagePath;\n  }\n\n`;
  s = insertBefore(s, '  async generateVisualAssets(prompt, style = "ethereal", count = 1) {\n', block, 'reference-conditioned image generation');
  write(rel, s);
}

function patchKeyframeRuntime() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    this.generationEnabled = String(options.generationEnabled ?? process.env.CARTOON_KEYFRAME_GENERATION_ENABLED ?? 'true').toLowerCase() !== 'false';\n",
    "    this.generationEnabled = String(options.generationEnabled ?? process.env.CARTOON_KEYFRAME_GENERATION_ENABLED ?? 'true').toLowerCase() !== 'false';\n    this.continuityEngine = options.continuityEngine || null;\n",
    'continuity engine option'
  );
  s = replaceOnce(
    s,
    "        const assets = await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        const sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
    "        const referenceConditioned = Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function');\n        const assets = referenceConditioned\n          ? await this.videoGenerator.generateVisualAssetsWithReference(current.prompt, referenceAssetPath, 'kids_cartoon_2d', 1)\n          : await this.videoGenerator.generateVisualAssets(current.prompt, 'kids_cartoon_2d', 1);\n        let sourcePath = Array.isArray(assets) ? assets[0] : null;\n",
    'reference-conditioned keyframe generation'
  );
  s = replaceOnce(
    s,
    "        const local = path.basename(sourcePath).startsWith('visual_local_');\n        const assetPath = await this.persistAsset(sourcePath, current);\n        await this.db.updateShotKeyframe(current.id, {\n",
    "        let local = path.basename(sourcePath).startsWith('visual_local_');\n        let assetPath = await this.persistAsset(sourcePath, current);\n        let continuityResult = null;\n        if (this.continuityEngine) {\n          continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned, attempt: 0 });\n          let repairAttempt = 0;\n          while (!continuityResult.accepted && this.continuityEngine.autoRepair && repairAttempt < this.continuityEngine.maxRepairAttempts) {\n            repairAttempt += 1;\n            const repairAssets = referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function'\n              ? await this.videoGenerator.generateVisualAssetsWithReference(this.continuityEngine.repairPrompt(current, continuityResult), referenceAssetPath, 'kids_cartoon_2d', 1)\n              : await this.videoGenerator.generateVisualAssets(this.continuityEngine.repairPrompt(current, continuityResult), 'kids_cartoon_2d', 1);\n            sourcePath = Array.isArray(repairAssets) ? repairAssets[0] : null;\n            if (!sourcePath || !IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) || !await this.pathExists(sourcePath)) break;\n            local = path.basename(sourcePath).startsWith('visual_local_');\n            assetPath = await this.persistAsset(sourcePath, current);\n            continuityResult = await this.continuityEngine.evaluate({ productionId, sceneId, keyframe: current, assetPath, referenceAssetPath, referenceConditioned: Boolean(referenceAssetPath && typeof this.videoGenerator.generateVisualAssetsWithReference === 'function'), attempt: repairAttempt });\n          }\n          if (!continuityResult.accepted) {\n            await this.db.updateShotKeyframe(current.id, { status: 'continuity_failed', assetPath, error: `Continuity score ${Number(continuityResult.score || 0).toFixed(3)} below ${Number(continuityResult.threshold || 0).toFixed(3)}` });\n            const continuityError = new Error(`Continuity validation failed for keyframe ${current.id}: score=${Number(continuityResult.score || 0).toFixed(3)} threshold=${Number(continuityResult.threshold || 0).toFixed(3)}`);\n            continuityError.code = 'CARTOON_CONTINUITY_FAILED';\n            throw continuityError;\n          }\n        }\n        await this.db.updateShotKeyframe(current.id, {\n",
    'continuity validation and repair loop'
  );
  s = replaceOnce(
    s,
    "          generatedAt: new Date().toISOString()\n",
    "          generatedAt: new Date().toISOString(),\n          continuityScore: continuityResult?.score ?? null\n",
    'continuity evidence on ready keyframe'
  );
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CartoonKeyframePipelineV11 } = require('./cartoon-keyframe-pipeline-v11');\n",
    "const { CartoonKeyframePipelineV11 } = require('./cartoon-keyframe-pipeline-v11');\nconst { CartoonContinuityEngineV11 } = require('./cartoon-continuity-engine-v11');\n",
    'Phase 11.4 continuity import'
  );
  s = replaceOnce(
    s,
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.continuityEngine = options.continuityEngine || new CartoonContinuityEngineV11(db, { logger: this.logger });\n    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine });\n",
    'construct Phase 11.4 continuity engine before keyframe pipeline'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCartoonContinuity(item) {",
    "  if (!item?.cartoonBible || !Array.isArray(item.continuityChecks) || !item.continuityChecks.length) return '';",
    "  const latest = new Map();",
    "  for (const check of item.continuityChecks) latest.set(check.keyframe_id || check.keyframeId, check);",
    "  const values = [...latest.values()];",
    "  const accepted = values.filter(check => ['accepted', 'anchor'].includes(check.status)).length;",
    "  const failed = values.filter(check => check.status === 'repair_needed').length;",
    "  const cards = values.slice(0, 24).map(check => `<div class=\"quality-check ${['accepted', 'anchor'].includes(check.status) ? 'pass' : 'fail'}\"><strong>${escapeHTML(check.status || '')} · ${Math.round(Number(check.score || 0) * 100)}%</strong><br><small>${escapeHTML((check.reasons || []).join(', ') || (check.status === 'anchor' ? 'scene anchor' : 'continuity accepted'))}<br>${check.referenceConditioned ? 'reference-conditioned' : 'post-generation validation'}</small></div>`).join('');",
    "  return `<section class=\"panel cartoon-continuity-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CARTOON CONTINUITY V11.4</p><h3>Visual continuity</h3></div></div><p>${accepted}/${values.length} accepted${failed ? ` · ${failed} need repair` : ''}.</p><div class=\"quality-grid\">${cards}</div><small>V11.4 combines reference-conditioned generation when supported with deterministic perceptual/palette/composition validation. It is not a semantic face-recognition model.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Phase 11.4 dashboard continuity renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonKeyframes(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    "        ${renderCartoonKeyframes(item)}\n        ${renderCartoonContinuity(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    'show continuity after keyframes'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:continuity'] = 'node ../bootstrap/verify-phase11-continuity.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CARTOON_CONTINUITY_MIN_SCORE=')) {
    env += `\n# Phase 11.4 — cartoon continuity validation and bounded auto-repair.\nCARTOON_CONTINUITY_MIN_SCORE=0.48\nCARTOON_CONTINUITY_AUTO_REPAIR=true\nCARTOON_CONTINUITY_MAX_REPAIR_ATTEMPTS=1\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchGenerator();
patchKeyframeRuntime();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.4 ativa: reference-conditioned frames quando suportado, continuity score persistente, auto-repair limitado e bloqueio fail-closed para drift visual.');
