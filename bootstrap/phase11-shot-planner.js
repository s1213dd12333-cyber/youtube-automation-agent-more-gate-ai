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
  const template = path.join(root, 'bootstrap', 'templates', 'cartoon-shot-planner-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cartoon-shot-planner-v11.js');
  write('utils/cartoon-shot-planner-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.2 persistent per-scene cartoon shot plans",
    "      `CREATE TABLE IF NOT EXISTS scene_shots (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.2',",
    "        shot_index INTEGER NOT NULL,",
    "        shot_count INTEGER NOT NULL,",
    "        shot_type TEXT NOT NULL,",
    "        duration REAL,",
    "        goal TEXT NOT NULL,",
    "        story_beat TEXT NOT NULL,",
    "        action TEXT NOT NULL,",
    "        characters TEXT NOT NULL DEFAULT '[]',",
    "        expression TEXT,",
    "        background TEXT,",
    "        camera TEXT,",
    "        continuity_notes TEXT NOT NULL DEFAULT '[]',",
    "        prompt TEXT NOT NULL,",
    "        fingerprint TEXT NOT NULL,",
    "        plan_fingerprint TEXT NOT NULL,",
    "        status TEXT NOT NULL DEFAULT 'planned',",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_shots_scene_position ON scene_shots(scene_id, shot_index)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_scene_shots_production ON scene_shots(production_id, scene_id, shot_index)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Phase 11.2 scene shots table');

  const methods = [
    "  async replaceSceneShots(productionId, sceneId, shots = []) {",
    "    await this.executeQuery('DELETE FROM scene_shots WHERE production_id = ? AND scene_id = ?', [productionId, sceneId]);",
    "    const now = new Date().toISOString();",
    "    for (const shot of shots) {",
    "      await this.executeQuery(",
    "        `INSERT INTO scene_shots (",
    "          id, production_id, scene_id, version, shot_index, shot_count, shot_type, duration, goal, story_beat, action,",
    "          characters, expression, background, camera, continuity_notes, prompt, fingerprint, plan_fingerprint, status, created_at, updated_at",
    "        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "        [",
    "          shot.id, productionId, sceneId, String(shot.version || '11.2'), Number(shot.shotIndex || 0), Number(shot.shotCount || shots.length),",
    "          shot.shotType || 'medium', shot.duration == null ? null : Number(shot.duration), shot.goal || '', shot.storyBeat || '', shot.action || '',",
    "          JSON.stringify(shot.characters || []), shot.expression || null, shot.background || null, shot.camera || null,",
    "          JSON.stringify(shot.continuityNotes || []), shot.prompt || '', shot.fingerprint || '', shot.planFingerprint || '',",
    "          shot.status || 'planned', shot.createdAt || now, now",
    "        ]",
    "      );",
    "    }",
    "    return this.listSceneShots(productionId, sceneId);",
    "  }",
    "",
    "  async listSceneShots(productionId, sceneId = null) {",
    "    const rows = sceneId",
    "      ? await this.getAllRows('SELECT * FROM scene_shots WHERE production_id = ? AND scene_id = ? ORDER BY shot_index, created_at', [productionId, sceneId])",
    "      : await this.getAllRows('SELECT * FROM scene_shots WHERE production_id = ? ORDER BY scene_id, shot_index, created_at', [productionId]);",
    "    return rows.map(row => this.parseSceneShot(row));",
    "  }",
    "",
    "  async getSceneShot(shotId) {",
    "    return this.parseSceneShot(await this.getRow('SELECT * FROM scene_shots WHERE id = ?', [shotId]));",
    "  }",
    "",
    "  parseSceneShot(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, version: row.version || '11.2',",
    "      shotIndex: Number(row.shot_index || 0), shotCount: Number(row.shot_count || 0), shotType: row.shot_type,",
    "      duration: row.duration == null ? null : Number(row.duration), goal: row.goal, storyBeat: row.story_beat, action: row.action,",
    "      characters: JSON.parse(row.characters || '[]'), expression: row.expression, background: row.background, camera: row.camera,",
    "      continuityNotes: JSON.parse(row.continuity_notes || '[]'), prompt: row.prompt, fingerprint: row.fingerprint,",
    "      planFingerprint: row.plan_fingerprint, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 11.2 scene shot DB methods');

  s = replaceOnce(
    s,
    "    const cartoonBible = await this.getLatestCartoonVisualBible(productionId);\n    const scenes = await this.listProductionScenes(productionId);\n",
    "    const cartoonBible = await this.getLatestCartoonVisualBible(productionId);\n    const scenes = await this.listProductionScenes(productionId);\n    const shots = await this.listSceneShots(productionId);\n",
    'load Phase 11.2 shots in production bundle'
  );
  s = replaceOnce(
    s,
    "      cartoonBible,\n      scenes,\n",
    "      cartoonBible,\n      scenes,\n      shots,\n",
    'expose Phase 11.2 shots in production bundle'
  );
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CartoonBibleV11 } = require('./cartoon-bible-v11');\n",
    "const { CartoonBibleV11 } = require('./cartoon-bible-v11');\nconst { CartoonShotPlannerV11 } = require('./cartoon-shot-planner-v11');\n",
    'Phase 11.2 shot planner import'
  );
  s = replaceOnce(
    s,
    "    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n",
    "    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n    this.shotPlanner = options.shotPlanner || new CartoonShotPlannerV11({ logger: this.logger });\n",
    'Phase 11.2 shot planner construction'
  );

  // Phase 11.1 activation hardening: a historical Bible must not keep cartoon mode active
  // after instructions are changed or the feature is explicitly disabled.
  s = replaceOnce(
    s,
    "    let visualPlan = null;\n    let cartoonBible = await this.db.getLatestCartoonVisualBible(production.id);\n    const plannedCartoonBible = this.cartoonBible.buildProductionBible(production);\n    if (plannedCartoonBible && (!cartoonBible || cartoonBible.fingerprint !== plannedCartoonBible.fingerprint)) {\n      cartoonBible = await this.db.saveCartoonVisualBible({ ...plannedCartoonBible, productionId: production.id });\n      this.logger.info(`Cartoon Bible v11.1 persisted for ${production.id}: ${cartoonBible.characters.length} character(s), style=${cartoonBible.mode}.`);\n    }\n\n",
    "    let visualPlan = null;\n    let shotPlan = null;\n    const plannedCartoonBible = this.cartoonBible.buildProductionBible(production);\n    let cartoonBible = null;\n    if (plannedCartoonBible) {\n      const existingCartoonBible = await this.db.getLatestCartoonVisualBible(production.id);\n      cartoonBible = existingCartoonBible;\n      if (!existingCartoonBible || existingCartoonBible.fingerprint !== plannedCartoonBible.fingerprint) {\n        cartoonBible = await this.db.saveCartoonVisualBible({ ...plannedCartoonBible, productionId: production.id });\n        this.logger.info(`Cartoon Bible v11.1 persisted for ${production.id}: ${cartoonBible.characters.length} character(s), style=${cartoonBible.mode}.`);\n      }\n    }\n\n",
    'Phase 11.1 active bible plus Phase 11.2 shot plan state'
  );

  const planningBlock = [
    "    if (cartoonBible) {",
    "      shotPlan = this.shotPlanner.planProduction(production, scenes, cartoonBible);",
    "      if (shotPlan) {",
    "        for (const scenePlan of shotPlan.scenes) {",
    "          const existingShots = await this.db.listSceneShots(production.id, scenePlan.sceneId);",
    "          const currentPlanFingerprint = existingShots[0]?.planFingerprint || null;",
    "          if (existingShots.length !== scenePlan.shotCount || currentPlanFingerprint !== scenePlan.fingerprint) {",
    "            await this.db.replaceSceneShots(production.id, scenePlan.sceneId, scenePlan.shots);",
    "          }",
    "        }",
    "        this.logger.info(`Cartoon Shot Planner v11.2 ready for ${production.id}: ${shotPlan.shotCount} shot(s) across ${shotPlan.sceneCount} scene(s).`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(
    s,
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan);\n",
    planningBlock,
    'Phase 11.2 planning before manifest persistence'
  );
  s = replaceOnce(
    s,
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan);\n",
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan);\n",
    'pass active Bible and Phase 11.2 shot plan to manifest'
  );
  s = replaceOnce(
    s,
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null) {\n',
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null, cartoonBible = null, shotPlan = null) {\n',
    'Phase 11.2 manifest signature with scoped cartoon bible'
  );
  s = replaceOnce(
    s,
    "        cartoonStyleMode: cartoonBible?.mode || previousManifest.cartoonStyleMode || null,\n        updatedAt: new Date().toISOString()\n",
    "        cartoonStyleMode: cartoonBible?.mode || previousManifest.cartoonStyleMode || null,\n        shotPlannerVersion: shotPlan?.version || previousManifest.shotPlannerVersion || null,\n        shotPlanFingerprint: shotPlan?.fingerprint || previousManifest.shotPlanFingerprint || null,\n        shotCount: shotPlan?.shotCount ?? previousManifest.shotCount ?? 0,\n        shotsPerScene: shotPlan?.summary || previousManifest.shotsPerScene || null,\n        updatedAt: new Date().toISOString()\n",
    'persist Phase 11.2 shot plan metadata'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCartoonShotPlan(item) {",
    "  if (!item?.cartoonBible || !Array.isArray(item.shots) || !item.shots.length) return '';",
    "  const scenes = Array.isArray(item.scenes) ? item.scenes : [];",
    "  const sceneById = new Map(scenes.map(scene => [scene.id, scene]));",
    "  const grouped = new Map();",
    "  for (const shot of item.shots) {",
    "    if (!grouped.has(shot.sceneId)) grouped.set(shot.sceneId, []);",
    "    grouped.get(shot.sceneId).push(shot);",
    "  }",
    "  const sceneCards = [...grouped.entries()].map(([sceneId, shots]) => {",
    "    const scene = sceneById.get(sceneId);",
    "    const ordered = [...shots].sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0));",
    "    const shotCards = ordered.map(shot => `<div class=\"quality-check pass\"><strong>Shot ${Number(shot.shotIndex || 0) + 1} · ${escapeHTML(shot.shotType || 'medium')}</strong><br><small>${escapeHTML(shot.goal || '')}<br>${escapeHTML(shot.storyBeat || '')}<br>Camera: ${escapeHTML(shot.camera || '')}</small></div>`).join('');",
    "    return `<div class=\"callout\"><strong>${escapeHTML(scene?.label || sceneId)} · ${ordered.length} shots</strong><div class=\"quality-grid\">${shotCards}</div></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel cartoon-shot-plan-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CARTOON SHOT PLANNER V11.2</p><h3>Scene → Shots</h3></div></div><p>Persistent shot plan only. Multi-keyframe generation begins in Phase 11.3.</p>${sceneCards}</section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Phase 11.2 dashboard shot planner renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonBible(item.cartoonBible)}\n        ${renderSceneEditor(item, canReview)}\n",
    "        ${renderCartoonBible(item.cartoonBible)}\n        ${renderCartoonShotPlan(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    'show Phase 11.2 shot plan before scene editor'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:shot-planner'] = 'node ../bootstrap/verify-phase11-shot-planner.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CARTOON_SHOTS_PER_SCENE_MIN=')) {
    env += `\n# Phase 11.2 — deterministic cartoon shot planning.\nCARTOON_SHOTS_PER_SCENE_MIN=3\nCARTOON_SHOTS_PER_SCENE_MAX=6\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.2 ativa: cada cena cartoon possui 3-6 shots persistentes com beat, acao, camera, personagens, continuidade e prompt proprio.');
