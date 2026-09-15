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
  if (index === -1) throw new Error(`Phase 11.7.4 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.7.4 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'scene-environment-mapper-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/scene-environment-mapper-v11.js');
  write('utils/scene-environment-mapper-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.7.4 persistent Scene-to-Environment mapping",
    "      `CREATE TABLE IF NOT EXISTS scene_environments (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.7.4',",
    "        plan_fingerprint TEXT NOT NULL,",
    "        fingerprint TEXT NOT NULL,",
    "        scene_position INTEGER NOT NULL DEFAULT 0,",
    "        environment_id TEXT,",
    "        environment_name TEXT,",
    "        environment_fingerprint TEXT,",
    "        zone_name TEXT,",
    "        status TEXT NOT NULL DEFAULT 'unresolved',",
    "        confidence REAL NOT NULL DEFAULT 0,",
    "        reason TEXT,",
    "        matched_terms TEXT NOT NULL DEFAULT '[]',",
    "        master_frame_path TEXT,",
    "        master_canonical INTEGER NOT NULL DEFAULT 0,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(production_id, scene_id),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_scene_environments_prod ON scene_environments(production_id, scene_position, environment_id)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'scene environments table');

  const methods = [
    "  async replaceProductionSceneEnvironments(productionId, plan = {}) {",
    "    await this.executeQuery('DELETE FROM scene_environments WHERE production_id = ?', [productionId]);",
    "    const now = new Date().toISOString();",
    "    for (const mapping of plan.mappings || []) {",
    "      const id = mapping.id || `scene_env_${String(mapping.sceneId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;",
    "      await this.executeQuery(",
    "        `INSERT INTO scene_environments (",
    "          id, production_id, scene_id, version, plan_fingerprint, fingerprint, scene_position, environment_id, environment_name,",
    "          environment_fingerprint, zone_name, status, confidence, reason, matched_terms, master_frame_path, master_canonical, created_at, updated_at",
    "        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "        [id, productionId, mapping.sceneId, String(mapping.version || '11.7.4'), plan.fingerprint || mapping.planFingerprint || '', mapping.fingerprint || '',",
    "         Number(mapping.scenePosition || 0), mapping.environmentId || null, mapping.environmentName || null, mapping.environmentFingerprint || null,",
    "         mapping.zone || null, mapping.status || 'unresolved', Number(mapping.confidence || 0), mapping.reason || null, JSON.stringify(mapping.matchedTerms || []),",
    "         mapping.masterFramePath || null, mapping.masterCanonical ? 1 : 0, mapping.createdAt || now, now]",
    "      );",
    "    }",
    "    return this.listSceneEnvironments(productionId);",
    "  }",
    "",
    "  async listSceneEnvironments(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM scene_environments WHERE production_id = ? ORDER BY scene_position, scene_id', [productionId]);",
    "    return rows.map(row => this.parseSceneEnvironment(row));",
    "  }",
    "",
    "  async getSceneEnvironment(productionId, sceneId) {",
    "    return this.parseSceneEnvironment(await this.getRow('SELECT * FROM scene_environments WHERE production_id = ? AND scene_id = ? LIMIT 1', [productionId, sceneId]));",
    "  }",
    "",
    "  parseSceneEnvironment(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, version: row.version || '11.7.4', planFingerprint: row.plan_fingerprint,",
    "      fingerprint: row.fingerprint, scenePosition: Number(row.scene_position || 0), environmentId: row.environment_id, environmentName: row.environment_name,",
    "      environmentFingerprint: row.environment_fingerprint, zone: row.zone_name, status: row.status, confidence: Number(row.confidence || 0),",
    "      reason: row.reason, matchedTerms: JSON.parse(row.matched_terms || '[]'), masterFramePath: row.master_frame_path,",
    "      masterCanonical: Number(row.master_canonical || 0) === 1, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'scene environment DB methods');

  const loadAnchor = "    const environmentMasterFrames = await this.listEnvironmentMasterFrames(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const sceneEnvironments = await this.listSceneEnvironments(productionId);\n", 'load scene environments in bundle');
  s = replaceOnce(s, "      environmentMasterFrames,\n", "      environmentMasterFrames,\n      sceneEnvironments,\n", 'expose scene environments in bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { MasterEnvironmentGeneratorV11 } = require('./master-environment-v11');\n",
    "const { MasterEnvironmentGeneratorV11 } = require('./master-environment-v11');\nconst { SceneEnvironmentMapperV11 } = require('./scene-environment-mapper-v11');\n",
    'Scene Environment Mapper import'
  );
  s = replaceOnce(
    s,
    "    this.masterEnvironment = options.masterEnvironment || new MasterEnvironmentGeneratorV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.masterEnvironment = options.masterEnvironment || new MasterEnvironmentGeneratorV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n    this.sceneEnvironmentMapper = options.sceneEnvironmentMapper || new SceneEnvironmentMapperV11({ logger: this.logger });\n",
    'Scene Environment Mapper construction'
  );

  const block = [
    "    let sceneEnvironmentPlan = null;",
    "    if (environmentBible) {",
    "      const latestMasterFrames = masterEnvironmentPlan?.frames || await this.db.listEnvironmentMasterFrames(production.id);",
    "      sceneEnvironmentPlan = this.sceneEnvironmentMapper.mapProduction(production, scenes, environmentBible, latestMasterFrames);",
    "      if (sceneEnvironmentPlan) {",
    "        const existingSceneEnvironments = await this.db.listSceneEnvironments(production.id);",
    "        const currentPlanFingerprint = existingSceneEnvironments[0]?.planFingerprint || null;",
    "        if (currentPlanFingerprint !== sceneEnvironmentPlan.fingerprint || existingSceneEnvironments.length !== sceneEnvironmentPlan.mappings.length) {",
    "          sceneEnvironmentPlan.mappings = await this.db.replaceProductionSceneEnvironments(production.id, sceneEnvironmentPlan);",
    "        } else {",
    "          sceneEnvironmentPlan.mappings = existingSceneEnvironments;",
    "        }",
    "        this.logger.info(`Scene Environment Mapper v11.7.4 ready for ${production.id}: mapped=${sceneEnvironmentPlan.summary.mappedCount}/${sceneEnvironmentPlan.summary.sceneCount}, unresolved=${sceneEnvironmentPlan.summary.unresolvedCount}, environments=${sceneEnvironmentPlan.summary.reusedEnvironmentCount}.`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (cartoonBible) {\n      shotPlan = this.shotPlanner.planProduction(production, scenes, cartoonBible);\n", block, 'map scenes before cartoon shot planning');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderSceneEnvironmentMapping(item) {",
    "  if (!Array.isArray(item?.sceneEnvironments) || !item.sceneEnvironments.length) return '';",
    "  const sceneById = new Map((item.scenes || []).map(scene => [scene.id, scene]));",
    "  const cards = [...item.sceneEnvironments].sort((a, b) => Number(a.scenePosition || 0) - Number(b.scenePosition || 0)).map(mapping => {",
    "    const scene = sceneById.get(mapping.sceneId);",
    "    const mapped = mapping.status === 'mapped' && Boolean(mapping.environmentId);",
    "    const cls = mapped ? 'pass' : 'fail';",
    "    const location = mapped ? `${mapping.environmentName || mapping.environmentId}${mapping.zone ? ` / ${mapping.zone}` : ''}` : 'UNRESOLVED';",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(scene?.label || mapping.sceneId)} → ${escapeHTML(location)}</strong><br><small>${mapped ? `confidence ${Math.round(Number(mapping.confidence || 0) * 100)}% · ${escapeHTML(mapping.reason || '')}` : escapeHTML(mapping.reason || 'no environment evidence')}<br>Master: ${mapping.masterCanonical ? 'canonical reference ready' : 'not canonical/pending'}${(mapping.matchedTerms || []).length ? `<br>Evidence: ${escapeHTML(mapping.matchedTerms.join(', '))}` : ''}</small></div>`;",
    "  }).join('');",
    "  const mapped = item.sceneEnvironments.filter(mapping => mapping.status === 'mapped' && mapping.environmentId).length;",
    "  const unique = new Set(item.sceneEnvironments.map(mapping => mapping.environmentId).filter(Boolean)).size;",
    "  return `<section class=\"panel scene-environment-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">SCENE → ENVIRONMENT V11.7.4</p><h3>Persistent location reuse</h3></div></div><p>${mapped}/${item.sceneEnvironments.length} scene(s) mapped across ${unique} persistent environment(s). Ambiguous multi-environment scenes stay unresolved instead of inventing a location.</p><div class=\"quality-grid\">${cards}</div></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'scene environment dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderMasterEnvironmentFrames(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderMasterEnvironmentFrames(item)}\n        ${renderSceneEnvironmentMapping(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show scene environment mapping before shot plan'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:scene-environments'] = 'node ../bootstrap/verify-phase11-scene-environment-mapping.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('SCENE_ENVIRONMENT_MAPPING_ENABLED=')) {
    env += `\n# Phase 11.7.4 — deterministic scene-to-environment reuse.\nSCENE_ENVIRONMENT_MAPPING_ENABLED=true\nSCENE_ENVIRONMENT_MIN_SCORE=0.18\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.7.4 ativa: cenas mapeadas para Environment IDs persistentes, zonas detectadas, reuso entre cenas e ambiguidade fail-closed.');
