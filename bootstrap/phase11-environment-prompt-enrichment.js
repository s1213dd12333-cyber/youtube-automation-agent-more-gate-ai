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
  if (index === -1) throw new Error(`Phase 11.7.5 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.7.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'environment-prompt-enricher-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/environment-prompt-enricher-v11.js');
  write('utils/environment-prompt-enricher-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.7.5 per-shot environment prompt context",
    "      `CREATE TABLE IF NOT EXISTS shot_environment_contexts (",
    "        shot_id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.7.5',",
    "        context_fingerprint TEXT NOT NULL,",
    "        environment_id TEXT,",
    "        zone_name TEXT,",
    "        environment_fingerprint TEXT,",
    "        mapping_fingerprint TEXT,",
    "        master_frame_path TEXT,",
    "        master_canonical INTEGER NOT NULL DEFAULT 0,",
    "        master_asset_sha256 TEXT,",
    "        required_prop_lock_ids TEXT NOT NULL DEFAULT '[]',",
    "        prompt_fragment TEXT NOT NULL,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_shot_environment_contexts_prod ON shot_environment_contexts(production_id, scene_id, environment_id)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'shot environment contexts table');

  const methods = [
    "  async replaceShotEnvironmentContexts(productionId, plan = {}) {",
    "    await this.executeQuery('DELETE FROM shot_environment_contexts WHERE production_id = ?', [productionId]);",
    "    const now = new Date().toISOString();",
    "    for (const shot of plan.shots || []) {",
    "      const marker = 'ENVIRONMENT CONTINUITY V11.7.5:';",
    "      const index = String(shot.prompt || '').indexOf(marker);",
    "      const fragment = index >= 0 ? String(shot.prompt || '').slice(index) : '';",
    "      await this.executeQuery(",
    "        `INSERT INTO shot_environment_contexts (",
    "          shot_id, production_id, scene_id, version, context_fingerprint, environment_id, zone_name, environment_fingerprint, mapping_fingerprint,",
    "          master_frame_path, master_canonical, master_asset_sha256, required_prop_lock_ids, prompt_fragment, created_at, updated_at",
    "        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "        [shot.id, productionId, shot.sceneId, '11.7.5', shot.environmentPromptFingerprint || '', shot.environmentId || null, shot.environmentZone || null,",
    "         shot.environmentFingerprint || null, shot.environmentMappingFingerprint || null, shot.masterEnvironmentPath || null, shot.masterEnvironmentCanonical ? 1 : 0,",
    "         shot.masterEnvironmentSha256 || null, JSON.stringify(shot.requiredPropLockIds || []), fragment, now, now]",
    "      );",
    "    }",
    "    return this.listShotEnvironmentContexts(productionId);",
    "  }",
    "",
    "  async listShotEnvironmentContexts(productionId, sceneId = null) {",
    "    const rows = sceneId",
    "      ? await this.getAllRows('SELECT * FROM shot_environment_contexts WHERE production_id = ? AND scene_id = ? ORDER BY shot_id', [productionId, sceneId])",
    "      : await this.getAllRows('SELECT * FROM shot_environment_contexts WHERE production_id = ? ORDER BY scene_id, shot_id', [productionId]);",
    "    return rows.map(row => this.parseShotEnvironmentContext(row));",
    "  }",
    "",
    "  parseShotEnvironmentContext(row) {",
    "    if (!row) return null;",
    "    return {",
    "      shotId: row.shot_id, productionId: row.production_id, sceneId: row.scene_id, version: row.version || '11.7.5',",
    "      contextFingerprint: row.context_fingerprint, environmentId: row.environment_id, zone: row.zone_name,",
    "      environmentFingerprint: row.environment_fingerprint, mappingFingerprint: row.mapping_fingerprint, masterFramePath: row.master_frame_path,",
    "      masterCanonical: Number(row.master_canonical || 0) === 1, masterAssetSha256: row.master_asset_sha256,",
    "      requiredPropLockIds: JSON.parse(row.required_prop_lock_ids || '[]'), promptFragment: row.prompt_fragment,",
    "      createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'shot environment context methods');

  const loadAnchor = "    const sceneEnvironments = await this.listSceneEnvironments(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const shotEnvironmentContexts = await this.listShotEnvironmentContexts(productionId);\n", 'load shot environment contexts in bundle');
  s = replaceOnce(s, "      sceneEnvironments,\n", "      sceneEnvironments,\n      shotEnvironmentContexts,\n", 'expose shot environment contexts in bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { SceneEnvironmentMapperV11 } = require('./scene-environment-mapper-v11');\n",
    "const { SceneEnvironmentMapperV11 } = require('./scene-environment-mapper-v11');\nconst { EnvironmentPromptEnricherV11 } = require('./environment-prompt-enricher-v11');\n",
    'Environment Prompt Enricher import'
  );
  s = replaceOnce(
    s,
    "    this.sceneEnvironmentMapper = options.sceneEnvironmentMapper || new SceneEnvironmentMapperV11({ logger: this.logger });\n",
    "    this.sceneEnvironmentMapper = options.sceneEnvironmentMapper || new SceneEnvironmentMapperV11({ logger: this.logger });\n    this.environmentPromptEnricher = options.environmentPromptEnricher || new EnvironmentPromptEnricherV11({ logger: this.logger });\n",
    'Environment Prompt Enricher construction'
  );

  const block = [
    "    let environmentPromptPlan = null;",
    "    if (shotPlan && sceneEnvironmentPlan) {",
    "      const promptLocks = propLockPlan?.locks || await this.db.listPropLocks(production.id);",
    "      const promptMasters = masterEnvironmentPlan?.frames || await this.db.listEnvironmentMasterFrames(production.id);",
    "      environmentPromptPlan = this.environmentPromptEnricher.enrichProduction(production, shotPlan, sceneEnvironmentPlan, environmentBible, promptLocks, promptMasters);",
    "      if (environmentPromptPlan) {",
    "        for (const scenePlan of environmentPromptPlan.scenes) {",
    "          const existingShots = await this.db.listSceneShots(production.id, scenePlan.sceneId);",
    "          const changed = existingShots.length !== scenePlan.shots.length || existingShots.some((item, index) => item.fingerprint !== scenePlan.shots[index]?.fingerprint || item.prompt !== scenePlan.shots[index]?.prompt);",
    "          if (changed) await this.db.replaceSceneShots(production.id, scenePlan.sceneId, scenePlan.shots);",
    "        }",
    "        await this.db.replaceShotEnvironmentContexts(production.id, environmentPromptPlan);",
    "        shotPlan = {",
    "          ...shotPlan,",
    "          shots: environmentPromptPlan.scenes.flatMap(scenePlan => scenePlan.shots),",
    "          scenes: environmentPromptPlan.scenes,",
    "          environmentPromptVersion: environmentPromptPlan.version,",
    "          environmentPromptFingerprint: environmentPromptPlan.fingerprint,",
    "          environmentPromptSummary: environmentPromptPlan.summary",
    "        };",
    "        this.logger.info(`Environment Prompt Enricher v11.7.5 ready for ${production.id}: mapped shots=${environmentPromptPlan.summary.mappedShotCount}/${environmentPromptPlan.summary.shotCount}, master-backed=${environmentPromptPlan.summary.masterBackedShotCount}.`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (cartoonBible && shotPlan) {\n      keyframePlan = await this.keyframePipeline.ensurePlan(production, scenes, shotPlan.shots, cartoonBible);\n", block, 'enrich shots before keyframe planning');

  s = replaceOnce(
    s,
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan, keyframePlan);\n",
    "    await this.persistManifest(bundle, production, scenes, fingerprint, scriptChanged, visualPlan, cartoonBible, shotPlan, keyframePlan, environmentPromptPlan);\n",
    'pass Environment Prompt plan to manifest'
  );
  s = replaceOnce(
    s,
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null, cartoonBible = null, shotPlan = null, keyframePlan = null) {\n',
    '  async persistManifest(bundle, production, scenes, fingerprint, resetMedia, visualPlan = null, cartoonBible = null, shotPlan = null, keyframePlan = null, environmentPromptPlan = null) {\n',
    'Environment Prompt manifest signature'
  );
  s = replaceOnce(
    s,
    "        keyframeSummary: keyframePlan?.summary || previousManifest.keyframeSummary || null,\n        updatedAt: new Date().toISOString()\n",
    "        keyframeSummary: keyframePlan?.summary || previousManifest.keyframeSummary || null,\n        environmentPromptVersion: environmentPromptPlan?.version || previousManifest.environmentPromptVersion || null,\n        environmentPromptFingerprint: environmentPromptPlan?.fingerprint || previousManifest.environmentPromptFingerprint || null,\n        environmentPromptSummary: environmentPromptPlan?.summary || previousManifest.environmentPromptSummary || null,\n        updatedAt: new Date().toISOString()\n",
    'persist Environment Prompt Enrichment metadata'
  );
  write(rel, s);
}

function patchKeyframeRuntime() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let s = read(rel);
  const anchor = [
    "      let referenceAssetPath = null;",
    "      if (current.referenceKeyframeId) {",
    "        const reference = await this.db.getShotKeyframe(current.referenceKeyframeId);",
    "        if (reference?.status === 'ready' && reference.assetPath && await this.pathExists(reference.assetPath)) {",
    "          referenceAssetPath = reference.assetPath;",
    "        }",
    "      }",
  ].join('\n');
  const replacement = anchor + '\n' + [
    "      // Phase 11.7.5: the first keyframe in a mapped scene may use the canonical Master Environment",
    "      // as a real provider reference. Later keyframes continue chaining from prior keyframes.",
    "      if (!referenceAssetPath && current.keyframeRole === 'start' && !current.referenceKeyframeId && this.db?.getSceneEnvironment) {",
    "        const sceneEnvironment = await this.db.getSceneEnvironment(productionId, sceneId);",
    "        if (sceneEnvironment?.masterCanonical && sceneEnvironment.masterFramePath && await this.pathExists(sceneEnvironment.masterFramePath)) {",
    "          referenceAssetPath = sceneEnvironment.masterFramePath;",
    "        }",
    "      }",
  ].join('\n');
  s = replaceOnce(s, anchor, replacement, 'canonical Master Environment reference for first scene keyframe');
  write(rel, s);
}

function patchContinuityRuntime() {
  const rel = 'utils/cartoon-continuity-engine-v11.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    if (!keyframe.referenceKeyframeId) {\n",
    "    if (!keyframe.referenceKeyframeId && !referenceAssetPath) {\n",
    'evaluate canonical Master Environment reference instead of auto-accepting first keyframe'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderEnvironmentPromptEnrichment(item) {",
    "  if (!Array.isArray(item?.shotEnvironmentContexts) || !item.shotEnvironmentContexts.length) return '';",
    "  const shots = item.shotEnvironmentContexts;",
    "  const mapped = shots.filter(context => Boolean(context.environmentId)).length;",
    "  const masterBacked = shots.filter(context => context.masterCanonical).length;",
    "  const cards = shots.slice(0, 30).map(context => {",
    "    const cls = context.environmentId ? 'pass' : 'fail';",
    "    const env = context.environmentId ? `${context.environmentId}${context.zone ? ` / ${context.zone}` : ''}` : 'UNRESOLVED';",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(context.shotId)} → ${escapeHTML(env)}</strong><br><small>${context.masterCanonical ? 'MASTER REFERENCE ACTIVE' : 'text constraints only'} · ${(context.requiredPropLockIds || []).length} required prop lock(s)<br>Context: ${escapeHTML((context.contextFingerprint || '').slice(0, 16))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel environment-prompt-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">ENVIRONMENT PROMPT ENRICHMENT V11.7.5</p><h3>Environment + props injected into shots/keyframes</h3></div></div><p>${mapped}/${shots.length} shot(s) mapped · ${masterBacked} master-backed. Canonical Master Environment is used as the first keyframe reference when available.</p><div class=\"quality-grid\">${cards}</div></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'environment prompt enrichment dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderSceneEnvironmentMapping(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderSceneEnvironmentMapping(item)}\n        ${renderEnvironmentPromptEnrichment(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show environment prompt enrichment before shot plan'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:environment-prompts'] = 'node ../bootstrap/verify-phase11-environment-prompt-enrichment.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('ENVIRONMENT_PROMPT_ENRICHMENT_ENABLED=')) {
    env += `\n# Phase 11.7.5 — inject Environment Bible, Prop Locks and canonical master references into cartoon shots/keyframes.\nENVIRONMENT_PROMPT_ENRICHMENT_ENABLED=true\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchKeyframeRuntime();
patchContinuityRuntime();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.7.5 ativa: Environment Bible + Prop Locks enriquecem shots/keyframes e Master Environment canonico condiciona o primeiro frame da cena quando disponivel.');
