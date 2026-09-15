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
  const template = path.join(root, 'bootstrap', 'templates', 'cartoon-motion-composer-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cartoon-motion-composer-v11.js');
  write('utils/cartoon-motion-composer-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 11.5 persistent local motion composition",
    "      `CREATE TABLE IF NOT EXISTS cartoon_motion_segments (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        shot_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.5',",
    "        shot_index INTEGER NOT NULL,",
    "        fingerprint TEXT NOT NULL,",
    "        duration REAL NOT NULL,",
    "        profile TEXT NOT NULL,",
    "        keyframe_ids TEXT NOT NULL DEFAULT '[]',",
    "        output_path TEXT,",
    "        status TEXT NOT NULL DEFAULT 'planned',",
    "        error TEXT,",
    "        generated_at TEXT,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE,",
    "        UNIQUE(production_id, shot_id)",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_cartoon_motion_segments_prod ON cartoon_motion_segments(production_id, scene_id, shot_index)`,",
    "      `CREATE TABLE IF NOT EXISTS cartoon_motion_scenes (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.5',",
    "        fingerprint TEXT NOT NULL,",
    "        duration REAL NOT NULL,",
    "        segment_ids TEXT NOT NULL DEFAULT '[]',",
    "        output_path TEXT,",
    "        status TEXT NOT NULL DEFAULT 'planned',",
    "        error TEXT,",
    "        generated_at TEXT,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        UNIQUE(production_id, scene_id)",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_cartoon_motion_scenes_prod ON cartoon_motion_scenes(production_id, scene_id)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'Phase 11.5 motion tables');

  const methods = [
    "  async saveCartoonMotionSegment(input = {}) {",
    "    const now = new Date().toISOString();",
    "    const id = input.id || this.generateId('motion_segment');",
    "    await this.executeQuery(",
    "      `INSERT INTO cartoon_motion_segments (id, production_id, scene_id, shot_id, version, shot_index, fingerprint, duration, profile, keyframe_ids, output_path, status, error, generated_at, created_at, updated_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, shot_id) DO UPDATE SET",
    "         scene_id = excluded.scene_id, version = excluded.version, shot_index = excluded.shot_index, fingerprint = excluded.fingerprint,",
    "         duration = excluded.duration, profile = excluded.profile, keyframe_ids = excluded.keyframe_ids, output_path = excluded.output_path,",
    "         status = excluded.status, error = excluded.error, generated_at = excluded.generated_at, updated_at = excluded.updated_at`,",
    "      [id, input.productionId, input.sceneId, input.shotId, String(input.version || '11.5'), Number(input.shotIndex || 0),",
    "       input.fingerprint || '', Number(input.duration || 0), input.profile || 'gentle_push', JSON.stringify(input.keyframeIds || []),",
    "       input.outputPath || null, input.status || 'planned', input.error || null, input.generatedAt || null, input.createdAt || now, now]",
    "    );",
    "    return this.getCartoonMotionSegment(input.productionId, input.shotId);",
    "  }",
    "",
    "  async getCartoonMotionSegment(productionId, shotId) {",
    "    return this.parseCartoonMotionSegment(await this.getRow('SELECT * FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?', [productionId, shotId]));",
    "  }",
    "",
    "  async listCartoonMotionSegments(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM cartoon_motion_segments WHERE production_id = ? ORDER BY scene_id, shot_index, created_at', [productionId]);",
    "    return rows.map(row => this.parseCartoonMotionSegment(row));",
    "  }",
    "",
    "  parseCartoonMotionSegment(row) {",
    "    if (!row) return null;",
    "    return { id: row.id, productionId: row.production_id, sceneId: row.scene_id, shotId: row.shot_id, version: row.version || '11.5',",
    "      shotIndex: Number(row.shot_index || 0), fingerprint: row.fingerprint, duration: Number(row.duration || 0), profile: row.profile,",
    "      keyframeIds: JSON.parse(row.keyframe_ids || '[]'), outputPath: row.output_path || null, status: row.status || 'planned',",
    "      error: row.error || null, generatedAt: row.generated_at || null, createdAt: row.created_at, updatedAt: row.updated_at };",
    "  }",
    "",
    "  async saveCartoonMotionScene(input = {}) {",
    "    const now = new Date().toISOString();",
    "    const id = input.id || this.generateId('motion_scene');",
    "    await this.executeQuery(",
    "      `INSERT INTO cartoon_motion_scenes (id, production_id, scene_id, version, fingerprint, duration, segment_ids, output_path, status, error, generated_at, created_at, updated_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, scene_id) DO UPDATE SET",
    "         version = excluded.version, fingerprint = excluded.fingerprint, duration = excluded.duration, segment_ids = excluded.segment_ids,",
    "         output_path = excluded.output_path, status = excluded.status, error = excluded.error, generated_at = excluded.generated_at, updated_at = excluded.updated_at`,",
    "      [id, input.productionId, input.sceneId, String(input.version || '11.5'), input.fingerprint || '', Number(input.duration || 0),",
    "       JSON.stringify(input.segmentIds || []), input.outputPath || null, input.status || 'planned', input.error || null,",
    "       input.generatedAt || null, input.createdAt || now, now]",
    "    );",
    "    return this.getCartoonMotionScene(input.productionId, input.sceneId);",
    "  }",
    "",
    "  async getCartoonMotionScene(productionId, sceneId) {",
    "    return this.parseCartoonMotionScene(await this.getRow('SELECT * FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?', [productionId, sceneId]));",
    "  }",
    "",
    "  async listCartoonMotionScenes(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM cartoon_motion_scenes WHERE production_id = ? ORDER BY scene_id, created_at', [productionId]);",
    "    return rows.map(row => this.parseCartoonMotionScene(row));",
    "  }",
    "",
    "  parseCartoonMotionScene(row) {",
    "    if (!row) return null;",
    "    return { id: row.id, productionId: row.production_id, sceneId: row.scene_id, version: row.version || '11.5', fingerprint: row.fingerprint,",
    "      duration: Number(row.duration || 0), segmentIds: JSON.parse(row.segment_ids || '[]'), outputPath: row.output_path || null,",
    "      status: row.status || 'planned', error: row.error || null, generatedAt: row.generated_at || null, createdAt: row.created_at, updatedAt: row.updated_at };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 11.5 motion DB methods');

  s = replaceOnce(
    s,
    "    const continuityChecks = await this.listKeyframeContinuityChecks(productionId);\n",
    "    const continuityChecks = await this.listKeyframeContinuityChecks(productionId);\n    const motionSegments = await this.listCartoonMotionSegments(productionId);\n    const motionScenes = await this.listCartoonMotionScenes(productionId);\n",
    'load Phase 11.5 motion bundle data'
  );
  s = replaceOnce(
    s,
    "      continuityChecks,\n",
    "      continuityChecks,\n      motionSegments,\n      motionScenes,\n",
    'expose Phase 11.5 motion bundle data'
  );

  s = replaceOnce(
    s,
    "  async replaceShotKeyframes(productionId, sceneId, shotId, keyframes = []) {\n    await this.executeQuery('DELETE FROM shot_keyframes WHERE production_id = ? AND shot_id = ?', [productionId, shotId]);\n",
    "  async replaceShotKeyframes(productionId, sceneId, shotId, keyframes = []) {\n    await this.executeQuery('DELETE FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?', [productionId, shotId]);\n    await this.executeQuery('DELETE FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?', [productionId, sceneId]);\n    await this.executeQuery('DELETE FROM shot_keyframes WHERE production_id = ? AND shot_id = ?', [productionId, shotId]);\n",
    'invalidate motion when keyframe plan changes'
  );

  s = replaceOnce(
    s,
    "  async updateShotKeyframe(id, changes = {}) {\n    const current = await this.getShotKeyframe(id);\n    if (!current) return null;\n    const next = { ...current, ...changes };\n",
    "  async updateShotKeyframe(id, changes = {}) {\n    const current = await this.getShotKeyframe(id);\n    if (!current) return null;\n    if (changes.assetPath !== undefined || changes.status !== undefined) {\n      await this.executeQuery('DELETE FROM cartoon_motion_segments WHERE production_id = ? AND shot_id = ?', [current.productionId, current.shotId]);\n      await this.executeQuery('DELETE FROM cartoon_motion_scenes WHERE production_id = ? AND scene_id = ?', [current.productionId, current.sceneId]);\n    }\n    const next = { ...current, ...changes };\n",
    'invalidate motion when a keyframe asset or status changes'
  );

  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CartoonContinuityEngineV11 } = require('./cartoon-continuity-engine-v11');\n",
    "const { CartoonContinuityEngineV11 } = require('./cartoon-continuity-engine-v11');\nconst { CartoonMotionComposerV11 } = require('./cartoon-motion-composer-v11');\n",
    'Phase 11.5 motion composer import'
  );
  s = replaceOnce(
    s,
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine });\n",
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine });\n    this.motionComposer = options.motionComposer || new CartoonMotionComposerV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Phase 11.5 motion composer construction'
  );

  const composeBlock = [
    "    let motionResult = null;",
    "    if (cartoonBible && this.motionComposer.enabled) {",
    "      motionResult = await this.motionComposer.composeProduction(production.id);",
    "      for (const output of motionResult.scenes || []) {",
    "        const before = (await this.db.listProductionScenes(production.id)).find(item => item.id === output.sceneId);",
    "        if (!before) continue;",
    "        const after = await this.db.updateProductionScene(production.id, output.sceneId, {",
    "          assetType: 'video',",
    "          assetOrigin: 'generated-motion',",
    "          assetPath: output.outputPath,",
    "          provider: 'cartoon-motion-v11',",
    "          model: 'ffmpeg-start-middle-end',",
    "          externalTaskId: null,",
    "          status: before.narrationStatus === 'current' || before.narrationStatus === 'intentional_silence' ? 'ready' : before.status,",
    "          rightsConfirmed: true,",
    "          containsSyntheticMedia: true",
    "        });",
    "        await this.db.saveProductionSceneRevision({",
    "          productionId: production.id, sceneId: output.sceneId, action: 'motion_compose', before, after,",
    "          costEvidence: { billed: false, provider: 'local-ffmpeg', version: '11.5', segmentIds: output.segmentIds || [] }",
    "        });",
    "      }",
    "      scenes = await this.db.listProductionScenes(production.id);",
    "      this.logger.info(`Cartoon Motion Composer v11.5 ready for ${production.id}: ${motionResult.segmentCount} segment(s), ${motionResult.sceneCount} scene(s).`);",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(
    s,
    "    scenes = await this.db.listProductionScenes(production.id);\n    const blockers = await this.findBlockers(scenes);\n",
    composeBlock,
    'Phase 11.5 composition after scene generation'
  );

  s = replaceOnce(
    s,
    "        keyframeAssets: (bundle.keyframes || []).filter(item => item.status === 'ready' && item.assetPath).map(item => item.assetPath),\n",
    "        keyframeAssets: (bundle.keyframes || []).filter(item => item.status === 'ready' && item.assetPath).map(item => item.assetPath),\n        motionAssets: (bundle.motionScenes || []).filter(item => item.status === 'ready' && item.outputPath).map(item => item.outputPath),\n        motionComposerVersion: (bundle.motionScenes || []).length ? '11.5' : null,\n",
    'Phase 11.5 media summary'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCartoonMotion(item) {",
    "  if (!item?.cartoonBible || !Array.isArray(item.motionSegments) || !item.motionSegments.length) return '';",
    "  const ready = item.motionSegments.filter(segment => segment.status === 'ready').length;",
    "  const failed = item.motionSegments.filter(segment => segment.status === 'failed').length;",
    "  const cards = item.motionSegments.slice(0, 30).map(segment => `<div class=\"quality-check ${segment.status === 'ready' ? 'pass' : segment.status === 'failed' ? 'fail' : ''}\"><strong>Shot ${Number(segment.shotIndex || 0) + 1} · ${escapeHTML(segment.profile || '')}</strong><br><small>${Number(segment.duration || 0).toFixed(2)}s · ${escapeHTML(segment.status || '')}<br>local FFmpeg</small></div>`).join('');",
    "  const scenesReady = Array.isArray(item.motionScenes) ? item.motionScenes.filter(scene => scene.status === 'ready').length : 0;",
    "  return `<section class=\"panel cartoon-motion-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CARTOON MOTION V11.5</p><h3>Keyframes → animated shots</h3></div></div><p>${ready}/${item.motionSegments.length} shot segments ready${failed ? ` · ${failed} failed` : ''} · ${scenesReady} scene composition(s).</p><div class=\"quality-grid\">${cards}</div><small>Motion is local FFmpeg pan/zoom/hold + short fades between start/middle/end. It is deterministic motion composition, not AI optical-flow character animation.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Phase 11.5 dashboard motion renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonContinuity(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    "        ${renderCartoonContinuity(item)}\n        ${renderCartoonMotion(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    'show Phase 11.5 motion after continuity'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:motion'] = 'node ../bootstrap/verify-phase11-motion.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CARTOON_MOTION_ENABLED=')) {
    env += `\n# Phase 11.5 — local deterministic motion composition from accepted cartoon keyframes.\nCARTOON_MOTION_ENABLED=true\nCARTOON_MOTION_FPS=30\nCARTOON_MOTION_WIDTH=1280\nCARTOON_MOTION_HEIGHT=720\nCARTOON_MOTION_TRANSITION_SECONDS=0.16\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.5 ativa: keyframes aceitos viram segmentos animados locais por shot e composicoes de cena reutilizaveis via FFmpeg.');
