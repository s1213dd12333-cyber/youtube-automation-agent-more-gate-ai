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

function replaceRegex(text, regex, replacement, label) {
  if (typeof replacement === 'string' && text.includes(replacement)) return text;
  if (!regex.test(text)) throw new Error(`Regex anchor not found for ${label}`);
  return text.replace(regex, replacement);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'visual-director-v7.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/visual-director-v7.js');
  write('utils/visual-director-v7.js', fs.readFileSync(template, 'utf8'));
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { visualInstructionSuffix } = require('./video-instructions-v6');\n",
    "const { visualInstructionSuffix } = require('./video-instructions-v6');\nconst { VisualDirectorV7 } = require('./visual-director-v7');\n",
    'visual director import'
  );
  s = replaceOnce(
    s,
    "    this.sceneNarration = new SceneNarrationV3(videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.sceneNarration = new SceneNarrationV3(videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n    this.visualDirector = options.visualDirector || new VisualDirectorV7({ logger: this.logger });\n",
    'visual director construction'
  );

  s = replaceOnce(
    s,
    "    const previousFingerprint = bundle.assets?.sceneManifest?.scriptFingerprint || null;\n    const scriptChanged = scenes.length > 0 && previousFingerprint && previousFingerprint !== fingerprint;\n\n    if (!scenes.length || scriptChanged) {\n",
    "    const previousFingerprint = bundle.assets?.sceneManifest?.scriptFingerprint || null;\n    const previousVisualVersion = Number(bundle.assets?.sceneManifest?.visualDirectorVersion || 0);\n    const scriptChanged = scenes.length > 0 && previousFingerprint && previousFingerprint !== fingerprint;\n    let visualPlan = null;\n\n    if (!scenes.length || scriptChanged) {\n",
    'visual director plan state'
  );

  s = replaceOnce(
    s,
    "      scenes = buildInitialSceneManifest(cleanProduction, {});\n      const visualDirection = visualInstructionSuffix(production.strategy?.videoInstructions || production.script?.metadata?.strategy?.videoInstructions || '');\n      if (visualDirection) scenes = scenes.map(scene => ({ ...scene, prompt: `${scene.prompt || scene.label || ''}${visualDirection}` }));\n      scenes = await this.db.replaceProductionScenes(production.id, scenes);\n",
    "      scenes = buildInitialSceneManifest(cleanProduction, {});\n      visualPlan = this.visualDirector.planProduction(cleanProduction, scenes);\n      scenes = visualPlan.scenes;\n      scenes = await this.db.replaceProductionScenes(production.id, scenes);\n",
    'visual director plans new scene prompts'
  );

  s = replaceOnce(
    s,
    "    }\n\n    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged);\n\n    for (const scene of scenes) {\n",
    "    }\n\n    // Upgrade legacy scene manifests without silently spending provider credits.\n    // Prompts/briefs are refreshed immediately; completed visuals regenerate only when explicitly opted in.\n    if (scenes.length && previousVisualVersion < 7 && !visualPlan) {\n      visualPlan = this.visualDirector.planProduction(production, scenes);\n      const refreshLegacyVisuals = String(process.env.VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS || 'false').toLowerCase() === 'true';\n      for (const planned of visualPlan.scenes) {\n        const previous = scenes.find(scene => scene.id === planned.id);\n        if (!previous) continue;\n        const shouldRefresh = refreshLegacyVisuals && Boolean(previous.assetPath);\n        await this.db.updateProductionScene(production.id, planned.id, {\n          prompt: planned.prompt,\n          status: shouldRefresh ? 'visual_stale' : previous.status\n        });\n      }\n      scenes = await this.db.listProductionScenes(production.id);\n      await this.recordPlanRevision(production.id, scenes, 'visual_director_v7');\n    }\n\n    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan);\n\n    for (const scene of scenes) {\n",
    'legacy visual-plan upgrade and manifest persistence'
  );

  s = replaceOnce(
    s,
    "      try {\n        const assets = await this.videoGenerator.generateVisualAssets(scene.prompt, 'documentary', 1);\n",
    "      try {\n        const productionBundle = await this.db.getProductionBundle(productionId);\n        const visualBrief = productionBundle?.assets?.sceneManifest?.visualBriefs?.[sceneId] || null;\n        if (visualBrief && visualBrief.quality?.accepted !== true) {\n          throw this.error(`Visual Director rejected scene prompt for ${scene.label}: specificity=${visualBrief.quality?.specificity ?? 'unknown'}, generic-risk=${visualBrief.quality?.genericAiRisk ?? 'unknown'}`, 'VISUAL_BRIEF_REJECTED');\n        }\n        const assets = await this.videoGenerator.generateVisualAssets(scene.prompt, visualBrief?.visualType || 'documentary', 1);\n",
    'visual quality gate before provider call'
  );

  s = replaceOnce(
    s,
    "          productionId, sceneId, action: 'initial_visual', before, after: scene,\n          costEvidence: { billed: false, provider: scene.provider }\n",
    "          productionId, sceneId, action: 'initial_visual', before, after: { ...scene, visualBrief },\n          costEvidence: { billed: false, provider: scene.provider, visualDirectorVersion: 7, visualQuality: visualBrief?.quality || null }\n",
    'visual revision stores quality evidence'
  );

  s = replaceOnce(
    s,
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia) {\n',
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null) {\n',
    'visual manifest signature'
  );
  s = replaceOnce(
    s,
    "    const currentAssets = bundle.assets || production.assets || {};\n    const assets = {\n",
    "    const currentAssets = bundle.assets || production.assets || {};\n    const previousManifest = currentAssets.sceneManifest || {};\n    const assets = {\n",
    'visual manifest previous state'
  );
  s = replaceOnce(
    s,
    "      sceneManifest: {\n        count: scenes.length,\n        version: 2,\n        mode: 'scene-first',\n        scriptFingerprint: fingerprint,\n        updatedAt: new Date().toISOString()\n      }\n",
    "      sceneManifest: {\n        ...previousManifest,\n        count: scenes.length,\n        version: 2,\n        mode: 'scene-first',\n        scriptFingerprint: fingerprint,\n        visualDirectorVersion: visualPlan?.version || previousManifest.visualDirectorVersion || 7,\n        visualIdentity: visualPlan?.identity || previousManifest.visualIdentity || null,\n        visualBriefs: visualPlan?.briefs || previousManifest.visualBriefs || {},\n        visualQuality: visualPlan?.summary || previousManifest.visualQuality || null,\n        updatedAt: new Date().toISOString()\n      }\n",
    'persist visual briefs in scene manifest'
  );

  const summaryFrom = "      sceneManifest: {\n        count: scenes.length,\n        version: 2,\n        mode: 'scene-first',\n        scriptFingerprint: fingerprint,\n        updatedAt: new Date().toISOString()\n      }\n";
  const summaryTo = "      sceneManifest: {\n        ...(bundle.assets?.sceneManifest || {}),\n        count: scenes.length,\n        version: 2,\n        mode: 'scene-first',\n        scriptFingerprint: fingerprint,\n        updatedAt: new Date().toISOString()\n      }\n";
  s = replaceOnce(s, summaryFrom, summaryTo, 'preserve visual director metadata in media summary');
  write(rel, s);
}

function patchLocalRenderer() {
  const rel = 'utils/ai-video-generator.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { MediaGenerationService } = require('./media-generation-service');\n",
    "const { MediaGenerationService } = require('./media-generation-service');\nconst { buildLocalVisualSvg } = require('./visual-director-v7');\n",
    'local visual renderer import'
  );
  s = replaceRegex(
    s,
    /  async generateLocalImage\(prompt, imagePath\) \{[\s\S]*?\n  \}\n\n  async generateOpenAIImage/,
    `  async generateLocalImage(prompt, imagePath) {\n    const width = 1280;\n    const height = 720;\n    await fs.mkdir(path.dirname(imagePath), { recursive: true });\n    const svg = buildLocalVisualSvg(prompt, width, height);\n    await sharp(Buffer.from(svg)).png().toFile(imagePath);\n    return imagePath;\n  }\n\n  async generateOpenAIImage`,
    'scene-specific local visual renderer'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "        const disabled = !canReview || scene.locked;\n        const sourceIds = new Set(scene.provenanceSourceIds || []);\n",
    "        const disabled = !canReview || scene.locked;\n        const sourceIds = new Set(scene.provenanceSourceIds || []);\n        const visualBrief = item.assets?.sceneManifest?.visualBriefs?.[scene.id] || null;\n        const visualQuality = visualBrief?.quality || null;\n",
    'scene editor visual brief lookup'
  );
  s = replaceOnce(
    s,
    "          <label><span>Visual prompt</span><textarea data-scene-field=\"prompt\" rows=\"3\" maxlength=\"2000\" ${disabled ? 'disabled' : ''}>${escapeHTML(scene.prompt)}</textarea></label>\n",
    "          ${visualBrief ? `<div class=\"callout visual-brief-summary\"><strong>Visual Director v7 · ${escapeHTML(visualBrief.visualType || 'scene')}</strong><p>${escapeHTML(visualBrief.subject || '')}</p><small>Specificity ${escapeHTML(visualQuality?.specificity ?? '—')}/100 · Generic-AI risk ${escapeHTML(visualQuality?.genericAiRisk ?? '—')}/100 · Evidence alignment ${escapeHTML(visualQuality?.evidenceAlignment ?? '—')}/100</small></div>` : ''}\n          <label><span>Visual prompt</span><textarea data-scene-field=\"prompt\" rows=\"6\" maxlength=\"4000\" ${disabled ? 'disabled' : ''}>${escapeHTML(scene.prompt)}</textarea></label>\n",
    'scene editor visual brief summary'
  );
  write(rel, s);
}

function patchSceneRepairPromptLimit() {
  const rel = 'utils/scene-repair-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    const prompt = input.prompt === undefined ? scene.prompt : this.text(input.prompt, 2000, 'Scene prompt');\n",
    "    const prompt = input.prompt === undefined ? scene.prompt : this.text(input.prompt, 4000, 'Scene prompt');\n",
    'allow structured visual director prompts in scene editor'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:visual-director'] = 'node ../bootstrap/verify-phase7-visual-director.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS=')) {
    env += `\n# Phase 7 — Visual Director\n# Keep false by default to avoid silently regenerating already-completed provider images.\nVISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS=false\n`;
  }
  write(envRel, env);
}

copyService();
patchScenePipeline();
patchLocalRenderer();
patchSceneRepairPromptLimit();
patchDashboard();
patchPackageAndEnv();

console.log('Phase 7 Visual Director installed: per-scene visual briefs, anti-generic scoring, evidence-aware prompts, persistent visual quality, and scene-specific local rendering.');
