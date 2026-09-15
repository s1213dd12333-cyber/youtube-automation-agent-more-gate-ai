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
  if (index === -1) throw new Error(`Phase 11.7.2 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.7.2 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'prop-lock-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/prop-lock-v11.js');
  write('utils/prop-lock-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.7.2 persistent Prop Locks",
    "      `CREATE TABLE IF NOT EXISTS prop_locks (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        environment_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.7.2',",
    "        plan_fingerprint TEXT NOT NULL,",
    "        fingerprint TEXT NOT NULL,",
    "        prop_name TEXT NOT NULL,",
    "        original_name TEXT,",
    "        prop_type TEXT NOT NULL DEFAULT 'prop',",
    "        required INTEGER NOT NULL DEFAULT 0,",
    "        continuity_priority TEXT NOT NULL DEFAULT 'medium',",
    "        description TEXT,",
    "        locked_attributes TEXT NOT NULL DEFAULT '{}',",
    "        allowed_changes TEXT NOT NULL DEFAULT '[]',",
    "        forbidden_changes TEXT NOT NULL DEFAULT '[]',",
    "        source_type TEXT NOT NULL DEFAULT 'inferred_default',",
    "        source_evidence TEXT,",
    "        placement_status TEXT NOT NULL DEFAULT 'unanchored_until_master_frame',",
    "        master_frame_path TEXT,",
    "        status TEXT NOT NULL DEFAULT 'locked_identity',",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(production_id, environment_id, prop_name),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_prop_locks_production ON prop_locks(production_id, environment_id, continuity_priority)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Prop Lock table');

  const methods = [
    "  async replaceProductionPropLocks(productionId, plan = {}) {",
    "    await this.executeQuery('DELETE FROM prop_locks WHERE production_id = ?', [productionId]);",
    "    const now = new Date().toISOString();",
    "    for (const lock of plan.locks || []) {",
    "      await this.executeQuery(",
    "        `INSERT INTO prop_locks (",
    "          id, production_id, environment_id, version, plan_fingerprint, fingerprint, prop_name, original_name, prop_type, required,",
    "          continuity_priority, description, locked_attributes, allowed_changes, forbidden_changes, source_type, source_evidence,",
    "          placement_status, master_frame_path, status, created_at, updated_at",
    "        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "        [",
    "          lock.id, productionId, lock.environmentId, String(lock.version || '11.7.2'), plan.fingerprint || lock.planFingerprint || '',",
    "          lock.fingerprint || '', lock.name || '', lock.originalName || null, lock.type || 'prop', lock.required ? 1 : 0,",
    "          lock.continuityPriority || 'medium', lock.description || null, JSON.stringify(lock.lockedAttributes || {}),",
    "          JSON.stringify(lock.allowedChanges || []), JSON.stringify(lock.forbiddenChanges || []), lock.sourceType || 'inferred_default',",
    "          lock.sourceEvidence || null, lock.placementStatus || 'unanchored_until_master_frame', lock.masterFramePath || null,",
    "          lock.status || 'locked_identity', lock.createdAt || now, now",
    "        ]",
    "      );",
    "    }",
    "    return this.listPropLocks(productionId);",
    "  }",
    "",
    "  async listPropLocks(productionId, environmentId = null) {",
    "    const rows = environmentId",
    "      ? await this.getAllRows('SELECT * FROM prop_locks WHERE production_id = ? AND environment_id = ? ORDER BY required DESC, continuity_priority, prop_name', [productionId, environmentId])",
    "      : await this.getAllRows('SELECT * FROM prop_locks WHERE production_id = ? ORDER BY environment_id, required DESC, continuity_priority, prop_name', [productionId]);",
    "    return rows.map(row => this.parsePropLock(row));",
    "  }",
    "",
    "  async getPropLock(propLockId) {",
    "    return this.parsePropLock(await this.getRow('SELECT * FROM prop_locks WHERE id = ?', [propLockId]));",
    "  }",
    "",
    "  parsePropLock(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, environmentId: row.environment_id, version: row.version || '11.7.2',",
    "      planFingerprint: row.plan_fingerprint, fingerprint: row.fingerprint, name: row.prop_name, originalName: row.original_name,",
    "      type: row.prop_type, required: Number(row.required || 0) === 1, continuityPriority: row.continuity_priority,",
    "      description: row.description, lockedAttributes: JSON.parse(row.locked_attributes || '{}'),",
    "      allowedChanges: JSON.parse(row.allowed_changes || '[]'), forbiddenChanges: JSON.parse(row.forbidden_changes || '[]'),",
    "      sourceType: row.source_type, sourceEvidence: row.source_evidence, placementStatus: row.placement_status,",
    "      masterFramePath: row.master_frame_path, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Prop Lock DB methods');

  const loadAnchor = "    const environmentBible = await this.getLatestEnvironmentBible(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const propLocks = await this.listPropLocks(productionId);\n", 'load Prop Locks in production bundle');
  s = replaceOnce(s, "      environmentBible,\n", "      environmentBible,\n      propLocks,\n", 'expose Prop Locks in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { EnvironmentBibleV11 } = require('./environment-bible-v11');\n",
    "const { EnvironmentBibleV11 } = require('./environment-bible-v11');\nconst { PropLockV11 } = require('./prop-lock-v11');\n",
    'Prop Lock import'
  );
  s = replaceOnce(
    s,
    "    this.environmentBible = options.environmentBible || new EnvironmentBibleV11({ logger: this.logger });\n",
    "    this.environmentBible = options.environmentBible || new EnvironmentBibleV11({ logger: this.logger });\n    this.propLock = options.propLock || new PropLockV11({ logger: this.logger });\n",
    'Prop Lock construction'
  );

  const block = [
    "    let propLockPlan = null;",
    "    if (environmentBible) {",
    "      propLockPlan = this.propLock.buildProductionLocks(production, environmentBible);",
    "      if (propLockPlan) {",
    "        const existingPropLocks = await this.db.listPropLocks(production.id);",
    "        const currentPlanFingerprint = existingPropLocks[0]?.planFingerprint || null;",
    "        if (currentPlanFingerprint !== propLockPlan.fingerprint || existingPropLocks.length !== propLockPlan.locks.length) {",
    "          propLockPlan.locks = await this.db.replaceProductionPropLocks(production.id, propLockPlan);",
    "        } else {",
    "          propLockPlan.locks = existingPropLocks;",
    "        }",
    "        this.logger.info(`Prop Lock v11.7.2 ready for ${production.id}: ${propLockPlan.locks.length} lock(s), required=${propLockPlan.summary.requiredCount}, inferred=${propLockPlan.summary.inferredCount}.`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'prepare Prop Lock plan after Environment Bible');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderPropLocks(item) {",
    "  if (!Array.isArray(item?.propLocks) || !item.propLocks.length) return '';",
    "  const grouped = new Map();",
    "  for (const lock of item.propLocks) {",
    "    if (!grouped.has(lock.environmentId)) grouped.set(lock.environmentId, []);",
    "    grouped.get(lock.environmentId).push(lock);",
    "  }",
    "  const groups = [...grouped.entries()].map(([environmentId, locks]) => {",
    "    const cards = locks.map(lock => {",
    "      const attrs = lock.lockedAttributes || {};",
    "      const source = lock.sourceType === 'inferred_default' ? 'inferred/default' : 'source-backed';",
    "      return `<div class=\"quality-check ${lock.required ? 'pass' : ''}\"><strong>${escapeHTML(lock.name || lock.id)} · ${escapeHTML(lock.continuityPriority || '')}</strong><br><small>${lock.required ? 'REQUIRED' : 'OPTIONAL'} · ${escapeHTML(lock.type || 'prop')} · ${escapeHTML(source)}<br>Color: ${escapeHTML(attrs.color || 'lock after first visual')} · Material: ${escapeHTML(attrs.material || 'lock after first visual')}<br>Placement: ${escapeHTML(lock.placementStatus || '')}</small></div>`;",
    "    }).join('');",
    "    return `<div class=\"callout\"><strong>${escapeHTML(environmentId)}</strong><div class=\"quality-grid\">${cards}</div></div>`;",
    "  }).join('');",
    "  const required = item.propLocks.filter(lock => lock.required).length;",
    "  return `<section class=\"panel prop-lock-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">PROP LOCK V11.7.2</p><h3>Persistent furniture + object identity</h3></div></div><p>${item.propLocks.length} lock(s) · ${required} required. Identity, material/color evidence and movement rules persist. Master-frame placement anchoring begins in 11.7.3; shot prompt injection begins in 11.7.5.</p>${groups}</section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Prop Lock dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderEnvironmentBible(item.environmentBible)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderEnvironmentBible(item.environmentBible)}\n        ${renderPropLocks(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show Prop Locks after Environment Bible'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:prop-lock'] = 'node ../bootstrap/verify-phase11-prop-lock.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('PROP_LOCK_ENABLED=')) {
    env += `\n# Phase 11.7.2 — persistent furniture/object identity locks.\nPROP_LOCK_ENABLED=true\nPROP_LOCK_MAX_PER_ENVIRONMENT=24\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.7.2 ativa: Prop Locks persistentes com identidade, atributos travados, prioridade de continuidade e regras de movimento. Master-frame anchoring permanece para 11.7.3.');
