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

function replaceRegex(text, regex, replacement, label) {
  if (typeof replacement === 'string' && text.includes(replacement)) return text;
  if (!regex.test(text)) throw new Error(`Regex anchor not found for ${label}`);
  return text.replace(regex, replacement);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'cartoon-keyframe-pipeline-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cartoon-keyframe-pipeline-v11.js');
  write('utils/cartoon-keyframe-pipeline-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.3 persistent start/middle/end keyframes per shot",
    "      `CREATE TABLE IF NOT EXISTS shot_keyframes (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        shot_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.3',",
    "        shot_index INTEGER NOT NULL,",
    "        keyframe_index INTEGER NOT NULL,",
    "        keyframe_role TEXT NOT NULL,",
    "        progress REAL NOT NULL,",
    "        prompt TEXT NOT NULL,",
    "        fingerprint TEXT NOT NULL,",
    "        plan_fingerprint TEXT NOT NULL,",
    "        reference_keyframe_id TEXT,",
    "        reference_asset_path TEXT,",
    "        asset_path TEXT,",
    "        provider TEXT,",
    "        model TEXT,",
    "        status TEXT NOT NULL DEFAULT 'planned',",
    "        error TEXT,",
    "        contains_synthetic_media INTEGER NOT NULL DEFAULT 0,",
    "        generated_at TEXT,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shot_keyframes_position ON shot_keyframes(shot_id, keyframe_index)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_shot_keyframes_scene ON shot_keyframes(production_id, scene_id, shot_index, keyframe_index)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Phase 11.3 shot keyframes table');

  const methods = [
    "  async replaceShotKeyframes(productionId, sceneId, shotId, keyframes = []) {",
    "    await this.executeQuery('DELETE FROM shot_keyframes WHERE production_id = ? AND shot_id = ?', [productionId, shotId]);",
    "    const now = new Date().toISOString();",
    "    for (const keyframe of keyframes) {",
    "      await this.executeQuery(",
    "        `INSERT INTO shot_keyframes (",
    "          id, production_id, scene_id, shot_id, version, shot_index, keyframe_index, keyframe_role, progress, prompt, fingerprint,",
    "          plan_fingerprint, reference_keyframe_id, reference_asset_path, asset_path, provider, model, status, error,",
    "          contains_synthetic_media, generated_at, created_at, updated_at",
    "        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "        [",
    "          keyframe.id, productionId, sceneId, shotId, String(keyframe.version || '11.3'), Number(keyframe.shotIndex || 0),",
    "          Number(keyframe.keyframeIndex || 0), keyframe.keyframeRole || 'start', Number(keyframe.progress || 0), keyframe.prompt || '',",
    "          keyframe.fingerprint || '', keyframe.planFingerprint || '', keyframe.referenceKeyframeId || null, keyframe.referenceAssetPath || null,",
    "          keyframe.assetPath || null, keyframe.provider || null, keyframe.model || null, keyframe.status || 'planned', keyframe.error || null,",
    "          keyframe.containsSyntheticMedia ? 1 : 0, keyframe.generatedAt || null, keyframe.createdAt || now, now",
    "        ]",
    "      );",
    "    }",
    "    return this.listShotKeyframes(productionId, shotId);",
    "  }",
    "",
    "  async listShotKeyframes(productionId, shotId = null) {",
    "    const rows = shotId",
    "      ? await this.getAllRows('SELECT * FROM shot_keyframes WHERE production_id = ? AND shot_id = ? ORDER BY keyframe_index, created_at', [productionId, shotId])",
    "      : await this.getAllRows('SELECT * FROM shot_keyframes WHERE production_id = ? ORDER BY scene_id, shot_index, keyframe_index, created_at', [productionId]);",
    "    return rows.map(row => this.parseShotKeyframe(row));",
    "  }",
    "",
    "  async listSceneKeyframes(productionId, sceneId) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM shot_keyframes WHERE production_id = ? AND scene_id = ? ORDER BY shot_index, keyframe_index, created_at',",
    "      [productionId, sceneId]",
    "    );",
    "    return rows.map(row => this.parseShotKeyframe(row));",
    "  }",
    "",
    "  async getShotKeyframe(id) {",
    "    return this.parseShotKeyframe(await this.getRow('SELECT * FROM shot_keyframes WHERE id = ?', [id]));",
    "  }",
    "",
    "  async updateShotKeyframe(id, changes = {}) {",
    "    const current = await this.getShotKeyframe(id);",
    "    if (!current) return null;",
    "    const next = { ...current, ...changes };",
    "    await this.executeQuery(",
    "      `UPDATE shot_keyframes SET reference_asset_path = ?, asset_path = ?, provider = ?, model = ?, status = ?, error = ?,",
    "       contains_synthetic_media = ?, generated_at = ?, updated_at = ? WHERE id = ?`,",
    "      [next.referenceAssetPath || null, next.assetPath || null, next.provider || null, next.model || null, next.status || 'planned',",
    "       next.error || null, next.containsSyntheticMedia ? 1 : 0, next.generatedAt || null, new Date().toISOString(), id]",
    "    );",
    "    return this.getShotKeyframe(id);",
    "  }",
    "",
    "  parseShotKeyframe(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, shotId: row.shot_id, version: row.version || '11.3',",
    "      shotIndex: Number(row.shot_index || 0), keyframeIndex: Number(row.keyframe_index || 0), keyframeRole: row.keyframe_role,",
    "      progress: Number(row.progress || 0), prompt: row.prompt, fingerprint: row.fingerprint, planFingerprint: row.plan_fingerprint,",
    "      referenceKeyframeId: row.reference_keyframe_id || null, referenceAssetPath: row.reference_asset_path || null,",
    "      assetPath: row.asset_path || null, provider: row.provider || null, model: row.model || null, status: row.status || 'planned',",
    "      error: row.error || null, containsSyntheticMedia: Boolean(row.contains_synthetic_media), generatedAt: row.generated_at || null,",
    "      createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 11.3 keyframe DB methods');

  s = replaceOnce(
    s,
    "  async replaceSceneShots(productionId, sceneId, shots = []) {\n    await this.executeQuery('DELETE FROM scene_shots WHERE production_id = ? AND scene_id = ?', [productionId, sceneId]);\n",
    "  async replaceSceneShots(productionId, sceneId, shots = []) {\n    await this.executeQuery('DELETE FROM shot_keyframes WHERE production_id = ? AND scene_id = ?', [productionId, sceneId]);\n    await this.executeQuery('DELETE FROM scene_shots WHERE production_id = ? AND scene_id = ?', [productionId, sceneId]);\n",
    'delete stale keyframes before replacing a changed shot plan'
  );

  s = replaceOnce(
    s,
    "    const shots = await this.listSceneShots(productionId);\n",
    "    const shots = await this.listSceneShots(productionId);\n    const keyframes = await this.listShotKeyframes(productionId);\n",
    'load Phase 11.3 keyframes in production bundle'
  );
  s = replaceOnce(
    s,
    "      shots,\n",
    "      shots,\n      keyframes,\n",
    'expose Phase 11.3 keyframes in production bundle'
  );
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CartoonShotPlannerV11 } = require('./cartoon-shot-planner-v11');\n",
    "const { CartoonShotPlannerV11 } = require('./cartoon-shot-planner-v11');\nconst { CartoonKeyframePipelineV11 } = require('./cartoon-keyframe-pipeline-v11');\n",
    'Phase 11.3 keyframe pipeline import'
  );
  s = replaceOnce(
    s,
    "    this.shotPlanner = options.shotPlanner || new CartoonShotPlannerV11({ logger: this.logger });\n",
    "    this.shotPlanner = options.shotPlanner || new CartoonShotPlannerV11({ logger: this.logger });\n    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Phase 11.3 keyframe pipeline construction'
  );
  s = replaceOnce(
    s,
    "    let shotPlan = null;\n",
    "    let shotPlan = null;\n    let keyframePlan = null;\n",
    'Phase 11.3 keyframe plan state'
  );

  const planningBlock = [
    "    if (cartoonBible && shotPlan) {",
    "      keyframePlan = await this.keyframePipeline.ensurePlan(production, scenes, shotPlan.shots, cartoonBible);",
    "      if (keyframePlan && this.keyframePipeline.generationEnabled) {",
    "        for (const scenePlan of shotPlan.scenes) {",
    "          if (!await this.keyframePipeline.sceneReady(production.id, scenePlan.sceneId)) {",
    "            await this.db.updateProductionScene(production.id, scenePlan.sceneId, { status: 'visual_stale' });",
    "          }",
    "        }",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(
    s,
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan);\n",
    planningBlock,
    'Phase 11.3 planning before manifest persistence'
  );
  s = replaceOnce(
    s,
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan);\n",
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan, keyframePlan);\n",
    'pass Phase 11.3 keyframe plan to manifest'
  );
  s = replaceOnce(
    s,
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null, cartoonBible = null, shotPlan = null) {\n',
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null, cartoonBible = null, shotPlan = null, keyframePlan = null) {\n',
    'Phase 11.3 manifest signature'
  );
  s = replaceOnce(
    s,
    "        shotsPerScene: shotPlan?.summary || previousManifest.shotsPerScene || null,\n        updatedAt: new Date().toISOString()\n",
    "        shotsPerScene: shotPlan?.summary || previousManifest.shotsPerScene || null,\n        keyframePipelineVersion: keyframePlan?.version || previousManifest.keyframePipelineVersion || null,\n        keyframePlanFingerprint: keyframePlan?.fingerprint || previousManifest.keyframePlanFingerprint || null,\n        keyframesPerShot: keyframePlan?.keyframesPerShot ?? previousManifest.keyframesPerShot ?? null,\n        keyframeCount: keyframePlan?.keyframeCount ?? previousManifest.keyframeCount ?? 0,\n        keyframeSummary: keyframePlan?.summary || previousManifest.keyframeSummary || null,\n        updatedAt: new Date().toISOString()\n",
    'persist Phase 11.3 keyframe metadata'
  );

  s = replaceRegex(
    s,
    /        const routed = visualBrief\?\.visualType === 'kids_cartoon_2d'[\s\S]*?          assetPath = Array\.isArray\(assets\) \? assets\[0\] : null;\n        \}/,
    `        const keyframeResult = visualBrief?.visualType === 'kids_cartoon_2d' && this.keyframePipeline.generationEnabled\n          ? await this.keyframePipeline.generateScene(productionId, sceneId)\n          : null;\n        const routed = visualBrief?.visualType === 'kids_cartoon_2d'\n          ? null\n          : await this.visualRouter.resolve({ productionId, scene, brief: visualBrief || { subject: scene.label, sceneText: scene.scriptText, visualType: 'documentary_explainer', details: [] } });\n        let assetPath = keyframeResult?.representativeAssetPath || routed?.path || null;\n        let assets = null;\n        if (!assetPath) {\n          assets = await this.videoGenerator.generateVisualAssets(scene.prompt, visualBrief?.visualType || 'documentary', 1);\n          assetPath = Array.isArray(assets) ? assets[0] : null;\n        }`,
    'cartoon keyframes replace single-scene image generation'
  );

  s = replaceOnce(
    s,
    "        const local = !routed?.path && path.basename(assetPath).startsWith('visual_local_');\n",
    "        const local = !keyframeResult && !routed?.path && path.basename(assetPath).startsWith('visual_local_');\n",
    'local scene fallback excludes keyframe result'
  );
  s = replaceOnce(
    s,
    "          assetOrigin: routed?.path ? 'licensed-source' : 'generated',\n",
    "          assetOrigin: keyframeResult ? 'generated-keyframes' : (routed?.path ? 'licensed-source' : 'generated'),\n",
    'scene records keyframe asset origin'
  );
  s = replaceOnce(
    s,
    "          provider: routed?.path ? routed.provider : (local ? 'local-renderer' : 'image-provider'),\n",
    "          provider: keyframeResult ? 'keyframe-pipeline-v11' : (routed?.path ? routed.provider : (local ? 'local-renderer' : 'image-provider')),\n",
    'scene records keyframe provider'
  );
  s = replaceOnce(
    s,
    "          model: routed?.path ? routed.model : null,\n",
    "          model: keyframeResult ? 'start-middle-end' : (routed?.path ? routed.model : null),\n",
    'scene records keyframe model contract'
  );
  s = replaceOnce(
    s,
    "          rightsConfirmed: routed?.path ? routed.rightsConfirmed === true : true,\n",
    "          rightsConfirmed: keyframeResult ? true : (routed?.path ? routed.rightsConfirmed === true : true),\n",
    'generated keyframes have generated-media rights basis'
  );
  s = replaceOnce(
    s,
    "          containsSyntheticMedia: routed?.path ? false : !local\n",
    "          containsSyntheticMedia: keyframeResult ? keyframeResult.containsSyntheticMedia : (routed?.path ? false : !local)\n",
    'scene synthetic-media state reflects generated keyframes'
  );
  s = replaceOnce(
    s,
    "visualRouterVersion: 8, visualQuality: visualBrief?.quality || null, sourceAsset: routed?.record || null",
    "visualRouterVersion: 8, keyframePipelineVersion: keyframeResult?.version || null, keyframeCount: keyframeResult?.keyframeCount || 0, visualQuality: visualBrief?.quality || null, sourceAsset: routed?.record || null",
    'scene revision stores keyframe generation evidence'
  );
  s = replaceOnce(
    s,
    "        visualAssets: scenes.map(scene => scene.assetPath).filter(Boolean),\n",
    "        visualAssets: scenes.map(scene => scene.assetPath).filter(Boolean),\n        keyframeAssets: (bundle.keyframes || []).filter(item => item.status === 'ready' && item.assetPath).map(item => item.assetPath),\n",
    'media summary exposes generated keyframe assets without claiming composition'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCartoonKeyframes(item) {",
    "  if (!item?.cartoonBible || !Array.isArray(item.keyframes) || !item.keyframes.length) return '';",
    "  const ready = item.keyframes.filter(frame => frame.status === 'ready').length;",
    "  const failed = item.keyframes.filter(frame => frame.status === 'failed').length;",
    "  const grouped = new Map();",
    "  for (const frame of item.keyframes) {",
    "    if (!grouped.has(frame.shotId)) grouped.set(frame.shotId, []);",
    "    grouped.get(frame.shotId).push(frame);",
    "  }",
    "  const rows = [...grouped.values()].map(frames => {",
    "    const ordered = [...frames].sort((a, b) => Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0));",
    "    const first = ordered[0];",
    "    const cells = ordered.map(frame => `<span class=\"status-chip ${frame.status === 'ready' ? 'pass' : frame.status === 'failed' ? 'fail' : ''}\">${escapeHTML(frame.keyframeRole || '')}: ${escapeHTML(frame.status || 'planned')}</span>`).join(' ');",
    "    return `<div class=\"quality-check\"><strong>Shot ${Number(first?.shotIndex || 0) + 1}</strong><br><small>${cells}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel cartoon-keyframes-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CARTOON KEYFRAMES V11.3</p><h3>Start → Middle → End</h3></div></div><p>${ready}/${item.keyframes.length} ready${failed ? ` · ${failed} failed` : ''}. Keyframes are persistent and Resume regenerates only missing/failed frames.</p><div class=\"quality-grid\">${rows}</div><small>Phase 11.3 stores continuity references. Image-conditioned continuity validation is Phase 11.4.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Phase 11.3 dashboard keyframe renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonShotPlan(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    "        ${renderCartoonShotPlan(item)}\n        ${renderCartoonKeyframes(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    'show Phase 11.3 keyframes after shot plan'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:keyframes'] = 'node ../bootstrap/verify-phase11-keyframes.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CARTOON_KEYFRAME_GENERATION_ENABLED=')) {
    env += `\n# Phase 11.3 — start/middle/end keyframes per cartoon shot.\nCARTOON_KEYFRAME_GENERATION_ENABLED=true\n# Fail closed before runaway frame counts; raise deliberately for longer productions.\nCARTOON_KEYFRAME_MAX_PER_PRODUCTION=180\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.3 ativa: start/middle/end por shot, keyframes persistentes, Resume granular e imagem representativa por cena sem duplicar a geracao scene-level.');
