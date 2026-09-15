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
  if (index === -1) throw new Error(`Phase 11.7.3 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.7.3 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'master-environment-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/master-environment-v11.js');
  write('utils/master-environment-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.7.3 canonical Master Environment Frames",
    "      `CREATE TABLE IF NOT EXISTS environment_master_frames (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        environment_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.7.3',",
    "        environment_fingerprint TEXT,",
    "        prompt_fingerprint TEXT NOT NULL,",
    "        prompt TEXT NOT NULL,",
    "        status TEXT NOT NULL DEFAULT 'planned',",
    "        canonical INTEGER NOT NULL DEFAULT 0,",
    "        master_frame_path TEXT,",
    "        candidate_path TEXT,",
    "        provider TEXT,",
    "        source_kind TEXT,",
    "        asset_sha256 TEXT,",
    "        width INTEGER,",
    "        height INTEGER,",
    "        error TEXT,",
    "        generated_at TEXT,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(production_id, environment_id, prompt_fingerprint),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_environment_master_frames_prod ON environment_master_frames(production_id, environment_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Master Environment table');

  const methods = [
    "  async saveEnvironmentMasterFrame(frame = {}) {",
    "    if (!frame.productionId || !frame.environmentId || !frame.promptFingerprint) return null;",
    "    const existing = await this.getRow(",
    "      'SELECT id, created_at FROM environment_master_frames WHERE production_id = ? AND environment_id = ? AND prompt_fingerprint = ? LIMIT 1',",
    "      [frame.productionId, frame.environmentId, frame.promptFingerprint]",
    "    );",
    "    const id = existing?.id || frame.id || this.generateId('environment_master');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.created_at || frame.createdAt || now;",
    "    await this.executeQuery(",
    "      `INSERT INTO environment_master_frames (",
    "        id, production_id, environment_id, version, environment_fingerprint, prompt_fingerprint, prompt, status, canonical,",
    "        master_frame_path, candidate_path, provider, source_kind, asset_sha256, width, height, error, generated_at, created_at, updated_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, environment_id, prompt_fingerprint) DO UPDATE SET",
    "        version = excluded.version, environment_fingerprint = excluded.environment_fingerprint, prompt = excluded.prompt, status = excluded.status,",
    "        canonical = excluded.canonical, master_frame_path = excluded.master_frame_path, candidate_path = excluded.candidate_path,",
    "        provider = excluded.provider, source_kind = excluded.source_kind, asset_sha256 = excluded.asset_sha256, width = excluded.width,",
    "        height = excluded.height, error = excluded.error, generated_at = excluded.generated_at, updated_at = excluded.updated_at`,",
    "      [id, frame.productionId, frame.environmentId, String(frame.version || '11.7.3'), frame.environmentFingerprint || null,",
    "       frame.promptFingerprint, frame.prompt || '', frame.status || 'planned', frame.canonical ? 1 : 0, frame.masterFramePath || null,",
    "       frame.candidatePath || null, frame.provider || null, frame.sourceKind || null, frame.assetSha256 || null, frame.width || null,",
    "       frame.height || null, frame.error || null, frame.generatedAt || null, createdAt, now]",
    "    );",
    "    return this.getLatestEnvironmentMasterFrame(frame.productionId, frame.environmentId);",
    "  }",
    "",
    "  async getLatestEnvironmentMasterFrame(productionId, environmentId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM environment_master_frames WHERE production_id = ? AND environment_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1',",
    "      [productionId, environmentId]",
    "    );",
    "    return this.parseEnvironmentMasterFrame(row);",
    "  }",
    "",
    "  async listEnvironmentMasterFrames(productionId) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM environment_master_frames WHERE production_id = ? ORDER BY environment_id, updated_at DESC, rowid DESC',",
    "      [productionId]",
    "    );",
    "    const latest = new Map();",
    "    for (const row of rows) if (!latest.has(row.environment_id)) latest.set(row.environment_id, this.parseEnvironmentMasterFrame(row));",
    "    return [...latest.values()];",
    "  }",
    "",
    "  async markPropLocksMasterReference(productionId, environmentId, masterFramePath) {",
    "    await this.executeQuery(",
    "      `UPDATE prop_locks SET placement_status = 'master_reference_ready_unverified', master_frame_path = ?, updated_at = ?",
    "       WHERE production_id = ? AND environment_id = ?`,",
    "      [masterFramePath, new Date().toISOString(), productionId, environmentId]",
    "    );",
    "    return this.listPropLocks(productionId, environmentId);",
    "  }",
    "",
    "  parseEnvironmentMasterFrame(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, environmentId: row.environment_id, version: row.version || '11.7.3',",
    "      environmentFingerprint: row.environment_fingerprint, promptFingerprint: row.prompt_fingerprint, prompt: row.prompt,",
    "      status: row.status, canonical: Number(row.canonical || 0) === 1, masterFramePath: row.master_frame_path, candidatePath: row.candidate_path,",
    "      provider: row.provider, sourceKind: row.source_kind, assetSha256: row.asset_sha256, width: row.width == null ? null : Number(row.width),",
    "      height: row.height == null ? null : Number(row.height), error: row.error, generatedAt: row.generated_at,",
    "      createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Master Environment DB methods');

  const loadAnchor = "    const propLocks = await this.listPropLocks(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const environmentMasterFrames = await this.listEnvironmentMasterFrames(productionId);\n", 'load Master Environment Frames in production bundle');
  s = replaceOnce(s, "      propLocks,\n", "      propLocks,\n      environmentMasterFrames,\n", 'expose Master Environment Frames in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { PropLockV11 } = require('./prop-lock-v11');\n",
    "const { PropLockV11 } = require('./prop-lock-v11');\nconst { MasterEnvironmentGeneratorV11 } = require('./master-environment-v11');\n",
    'Master Environment import'
  );
  s = replaceOnce(
    s,
    "    this.propLock = options.propLock || new PropLockV11({ logger: this.logger });\n",
    "    this.propLock = options.propLock || new PropLockV11({ logger: this.logger });\n    this.masterEnvironment = options.masterEnvironment || new MasterEnvironmentGeneratorV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Master Environment construction'
  );

  const block = [
    "    let masterEnvironmentPlan = null;",
    "    if (environmentBible) {",
    "      const masterLocks = propLockPlan?.locks || await this.db.listPropLocks(production.id);",
    "      masterEnvironmentPlan = await this.masterEnvironment.ensureProductionFrames(production, environmentBible, masterLocks);",
    "      if (masterEnvironmentPlan) {",
    "        this.logger.info(`Master Environment v11.7.3 evaluated ${masterEnvironmentPlan.summary.environmentCount} environment(s): ready=${masterEnvironmentPlan.summary.readyCount}, fallback=${masterEnvironmentPlan.summary.fallbackCount}, failed=${masterEnvironmentPlan.summary.failedCount}.`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'generate canonical environment master frames before visual planning');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderMasterEnvironmentFrames(item) {",
    "  if (!Array.isArray(item?.environmentMasterFrames) || !item.environmentMasterFrames.length) return '';",
    "  const cards = item.environmentMasterFrames.map(frame => {",
    "    const ready = frame.status === 'ready' && frame.canonical === true;",
    "    const cls = ready ? 'pass' : frame.status === 'failed' ? 'fail' : '';",
    "    const state = ready ? 'CANONICAL READY' : frame.status === 'fallback_unanchored' ? 'GENERIC FALLBACK — NOT CANONICAL' : String(frame.status || 'planned').toUpperCase();",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(frame.environmentId || '')} · ${escapeHTML(state)}</strong><br><small>Provider: ${escapeHTML(frame.provider || 'none')} · ${frame.width || '?'}x${frame.height || '?'}<br>SHA-256: ${escapeHTML((frame.assetSha256 || '').slice(0, 16) || 'none')}<br>${escapeHTML(frame.error || (ready ? 'Reusable master reference persisted.' : 'No canonical environment reference yet.'))}</small></div>`;",
    "  }).join('');",
    "  const ready = item.environmentMasterFrames.filter(frame => frame.status === 'ready' && frame.canonical === true).length;",
    "  return `<section class=\"panel master-environment-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">MASTER ENVIRONMENT V11.7.3</p><h3>Canonical reusable location frames</h3></div></div><p>${ready}/${item.environmentMasterFrames.length} canonical master frame(s) ready. Generic local fallback images are deliberately not accepted while MASTER_ENVIRONMENT_REQUIRE_PROVIDER=true.</p><div class=\"quality-grid\">${cards}</div><small>Prop placement is master-reference-backed but remains visually unverified until the continuity validation phase.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Master Environment dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderPropLocks(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderPropLocks(item)}\n        ${renderMasterEnvironmentFrames(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show Master Environment frames after Prop Locks'
  );
  if (s.includes('master frame: pending 11.7.3')) s = s.replace(/master frame: pending 11\.7\.3/g, 'master frame: tracked by 11.7.3 panel');
  if (s.includes('Master-frame placement anchoring begins in 11.7.3; shot prompt injection begins in 11.7.5.')) {
    s = s.replace('Master-frame placement anchoring begins in 11.7.3; shot prompt injection begins in 11.7.5.', 'Master-frame reference status is tracked by 11.7.3; object-level visual verification remains later, and shot prompt injection begins in 11.7.5.');
  }
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:master-environment'] = 'node ../bootstrap/verify-phase11-master-environment.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('MASTER_ENVIRONMENT_GENERATION_ENABLED=')) {
    env += `\n# Phase 11.7.3 — canonical environment master frames.\nMASTER_ENVIRONMENT_GENERATION_ENABLED=true\n# true = generic local fallback cannot become the canonical reusable reference.\nMASTER_ENVIRONMENT_REQUIRE_PROVIDER=true\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.7.3 ativa: Master Environment Frames canonicos e persistentes, derivados da Environment Bible + Prop Locks, com fallback generico recusado por padrao.');
