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
  const template = path.join(root, 'bootstrap', 'templates', 'cartoon-bible-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cartoon-bible-v11.js');
  write('utils/cartoon-bible-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.1 persistent Character Bible + Style Bible",
    "      `CREATE TABLE IF NOT EXISTS cartoon_visual_bibles (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.1',",
    "        fingerprint TEXT NOT NULL,",
    "        mode TEXT NOT NULL DEFAULT 'kids_cartoon_2d',",
    "        characters TEXT NOT NULL DEFAULT '[]',",
    "        style TEXT NOT NULL DEFAULT '{}',",
    "        summary TEXT NOT NULL DEFAULT '{}',",
    "        prompt_context TEXT NOT NULL DEFAULT '',",
    "        created_at TEXT NOT NULL,",
    "        UNIQUE(production_id, fingerprint),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_cartoon_visual_bibles_production ON cartoon_visual_bibles(production_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Phase 11.1 cartoon bible table');

  const methods = [
    "  async saveCartoonVisualBible(bible = {}) {",
    "    const id = bible.id || this.generateId('cartoon_bible');",
    "    const createdAt = bible.createdAt || new Date().toISOString();",
    "    await this.executeQuery(",
    "      `INSERT INTO cartoon_visual_bibles (id, production_id, version, fingerprint, mode, characters, style, summary, prompt_context, created_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, fingerprint) DO UPDATE SET",
    "        version = excluded.version, mode = excluded.mode, characters = excluded.characters, style = excluded.style,",
    "        summary = excluded.summary, prompt_context = excluded.prompt_context`,",
    "      [id, bible.productionId, String(bible.version || '11.1'), bible.fingerprint || '', bible.mode || 'kids_cartoon_2d',",
    "       JSON.stringify(bible.characters || []), JSON.stringify(bible.style || {}), JSON.stringify(bible.summary || {}),",
    "       bible.promptContext || '', createdAt]",
    "    );",
    "    return this.getLatestCartoonVisualBible(bible.productionId);",
    "  }",
    "",
    "  async getLatestCartoonVisualBible(productionId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM cartoon_visual_bibles WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId]",
    "    );",
    "    return this.parseCartoonVisualBible(row);",
    "  }",
    "",
    "  async listCartoonVisualBibles(productionId, limit = 20) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM cartoon_visual_bibles WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',",
    "      [productionId, Math.max(1, Math.min(100, Number(limit || 20)))]",
    "    );",
    "    return rows.map(row => this.parseCartoonVisualBible(row));",
    "  }",
    "",
    "  parseCartoonVisualBible(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, version: row.version || '11.1', fingerprint: row.fingerprint,",
    "      mode: row.mode, characters: JSON.parse(row.characters || '[]'), style: JSON.parse(row.style || '{}'),",
    "      summary: JSON.parse(row.summary || '{}'), promptContext: row.prompt_context || '', createdAt: row.created_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 11.1 cartoon bible DB methods');

  s = replaceOnce(
    s,
    "    const qualityAgentReport = await this.getLatestQualityAgentReport(productionId);\n    const scenes = await this.listProductionScenes(productionId);\n",
    "    const qualityAgentReport = await this.getLatestQualityAgentReport(productionId);\n    const cartoonBible = await this.getLatestCartoonVisualBible(productionId);\n    const scenes = await this.listProductionScenes(productionId);\n",
    'load Phase 11.1 bible in production bundle'
  );
  s = replaceOnce(
    s,
    "      qualityAgentReport,\n      scenes,\n",
    "      qualityAgentReport,\n      cartoonBible,\n      scenes,\n",
    'expose Phase 11.1 bible in production bundle'
  );
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { VisualDirectorV7 } = require('./visual-director-v7');\n",
    "const { VisualDirectorV7 } = require('./visual-director-v7');\nconst { CartoonBibleV11 } = require('./cartoon-bible-v11');\n",
    'Phase 11.1 cartoon bible import'
  );
  s = replaceOnce(
    s,
    "    this.visualDirector = options.visualDirector || new VisualDirectorV7({ logger: this.logger });\n",
    "    this.visualDirector = options.visualDirector || new VisualDirectorV7({ logger: this.logger });\n    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n",
    'Phase 11.1 cartoon bible construction'
  );

  s = replaceOnce(
    s,
    "    let visualPlan = null;\n\n    if (!scenes.length || scriptChanged) {\n",
    "    let visualPlan = null;\n    let cartoonBible = await this.db.getLatestCartoonVisualBible(production.id);\n    const plannedCartoonBible = this.cartoonBible.buildProductionBible(production);\n    if (plannedCartoonBible && (!cartoonBible || cartoonBible.fingerprint !== plannedCartoonBible.fingerprint)) {\n      cartoonBible = await this.db.saveCartoonVisualBible({ ...plannedCartoonBible, productionId: production.id });\n      this.logger.info(`Cartoon Bible v11.1 persisted for ${production.id}: ${cartoonBible.characters.length} character(s), style=${cartoonBible.mode}.`);\n    }\n\n    if (!scenes.length || scriptChanged) {\n",
    'prepare persistent cartoon bible before visual planning'
  );

  s = replaceOnce(
    s,
    "      visualPlan = this.visualDirector.planProduction(cleanProduction, scenes);\n      scenes = visualPlan.scenes;\n",
    "      visualPlan = this.visualDirector.planProduction(cleanProduction, scenes);\n      if (cartoonBible) visualPlan = this.cartoonBible.applyToVisualPlan(visualPlan, cartoonBible);\n      scenes = visualPlan.scenes;\n",
    'apply cartoon bible to new visual plan'
  );
  s = replaceOnce(
    s,
    "      visualPlan = this.visualDirector.planProduction(production, scenes);\n      const refreshLegacyVisuals = String(process.env.VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS || 'false').toLowerCase() === 'true';\n",
    "      visualPlan = this.visualDirector.planProduction(production, scenes);\n      if (cartoonBible) visualPlan = this.cartoonBible.applyToVisualPlan(visualPlan, cartoonBible);\n      const refreshLegacyVisuals = String(process.env.VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS || 'false').toLowerCase() === 'true';\n",
    'apply cartoon bible to upgraded visual plan'
  );

  s = replaceOnce(
    s,
    "        visualQuality: visualPlan?.summary || previousManifest.visualQuality || null,\n        updatedAt: new Date().toISOString()\n",
    "        visualQuality: visualPlan?.summary || previousManifest.visualQuality || null,\n        cartoonBibleVersion: cartoonBible?.version || previousManifest.cartoonBibleVersion || null,\n        cartoonBibleFingerprint: cartoonBible?.fingerprint || previousManifest.cartoonBibleFingerprint || null,\n        cartoonStyleMode: cartoonBible?.mode || previousManifest.cartoonStyleMode || null,\n        updatedAt: new Date().toISOString()\n",
    'persist Phase 11.1 bible identity in scene manifest'
  );

  s = replaceOnce(
    s,
    "        const routed = await this.visualRouter.resolve({ productionId, scene, brief: visualBrief || { subject: scene.label, sceneText: scene.scriptText, visualType: 'documentary_explainer', details: [] } });\n",
    "        const routed = visualBrief?.visualType === 'kids_cartoon_2d'\n          ? null\n          : await this.visualRouter.resolve({ productionId, scene, brief: visualBrief || { subject: scene.label, sceneText: scene.scriptText, visualType: 'documentary_explainer', details: [] } });\n",
    'cartoon mode bypasses documentary real-source router'
  );
  write(rel, s);
}

function patchImageStyle() {
  const rel = 'utils/ai-video-generator.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    const styleEnhancements = {\n      ethereal: \"ethereal, dreamy, mystical, soft lighting, floating particles, cosmic background\",\n",
    "    const styleEnhancements = {\n      kids_cartoon_2d: \"original polished 2D children's cartoon, stable character design, clean consistent outlines, rounded friendly shapes, expressive readable faces, bright harmonious child-safe palette, simple layered storybook background, animation-ready composition, no photorealism, no generic stock illustration, no random text, no extra limbs\",\n      ethereal: \"ethereal, dreamy, mystical, soft lighting, floating particles, cosmic background\",\n",
    'cartoon-specific image style enhancement'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCartoonBible(bible) {",
    "  if (!bible || bible.mode !== 'kids_cartoon_2d') return '';",
    "  const characters = Array.isArray(bible.characters) ? bible.characters : [];",
    "  const cards = characters.map(character => `<div class=\"quality-check pass\"><strong>${escapeHTML(character.name)} · ${escapeHTML(character.role)}</strong><br><small>${escapeHTML(character.speciesType || '')} · ${(character.palette || []).map(escapeHTML).join(' / ')}<br>${escapeHTML(character.descriptor || '')}</small></div>`).join('');",
    "  return `<section class=\"panel cartoon-bible-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CARTOON BIBLE V${escapeHTML(bible.version || '11.1')}</p><h3>Character Bible + Style Bible</h3></div></div><p><strong>${escapeHTML(bible.style?.artDirection || bible.mode)}</strong></p><small>Consistency: character identity &gt; story action &gt; composition novelty &gt; decorative detail.</small><div class=\"quality-grid\">${cards || '<div class=\"quality-check\">No named characters extracted.</div>'}</div></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Phase 11.1 dashboard bible renderer');
  s = replaceOnce(
    s,
    "        ${renderSceneEditor(item, canReview)}\n",
    "        ${renderCartoonBible(item.cartoonBible)}\n        ${renderSceneEditor(item, canReview)}\n",
    'show Character Bible before scene editor'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:cartoon-bible'] = 'node ../bootstrap/verify-phase11-cartoon-bible.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CARTOON_VISUAL_MODE=')) {
    env += `\n# Phase 11.1 — Cartoon Character/Style Bible\n# auto = activate only for cartoon/children/storybook requests; force = all productions; off = disabled.\nCARTOON_VISUAL_MODE=auto\nCARTOON_BIBLE_ENABLED=true\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchImageStyle();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.1 ativa: Character Bible + Style Bible persistentes, identidade visual cartoon, prompts consistentes e source-router bypass para cartoon original.');
