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
  if (index === -1) throw new Error(`Phase 11.9.1 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.1 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'reusable-location-library-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/reusable-location-library-v11.js');
  write('utils/reusable-location-library-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 11.9.1 production-independent Reusable Location Library",
    "      `CREATE TABLE IF NOT EXISTS reusable_locations (",
    "        id TEXT PRIMARY KEY,",
    "        namespace TEXT NOT NULL DEFAULT 'default',",
    "        location_key TEXT NOT NULL,",
    "        display_name TEXT NOT NULL,",
    "        location_type TEXT NOT NULL DEFAULT 'location',",
    "        version TEXT NOT NULL DEFAULT '11.9.1',",
    "        identity_fingerprint TEXT NOT NULL,",
    "        canonical_identity TEXT NOT NULL DEFAULT '{}',",
    "        canonical_prompt_context TEXT NOT NULL DEFAULT '',",
    "        canonical_environment_id TEXT,",
    "        canonical_environment_fingerprint TEXT,",
    "        canonical_master_frame_id TEXT,",
    "        canonical_master_frame_path TEXT,",
    "        canonical_master_frame_sha256 TEXT,",
    "        prop_lock_snapshot TEXT NOT NULL DEFAULT '[]',",
    "        status TEXT NOT NULL DEFAULT 'registered_unanchored',",
    "        created_from_production_id TEXT,",
    "        first_seen_at TEXT NOT NULL,",
    "        last_seen_at TEXT NOT NULL,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(namespace, identity_fingerprint),",
    "        UNIQUE(namespace, location_key)",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_locations_namespace ON reusable_locations(namespace, status, last_seen_at)`,",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_usages (",
    "        id TEXT PRIMARY KEY,",
    "        location_id TEXT NOT NULL,",
    "        production_id TEXT NOT NULL,",
    "        environment_id TEXT NOT NULL,",
    "        environment_fingerprint TEXT,",
    "        master_frame_id TEXT,",
    "        master_frame_path TEXT,",
    "        master_frame_sha256 TEXT,",
    "        match_mode TEXT NOT NULL DEFAULT 'identity_fingerprint_exact_register',",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(location_id, production_id, environment_id),",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_usages_prod ON reusable_location_usages(production_id, environment_id, created_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_usages_location ON reusable_location_usages(location_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'Reusable Location Library tables');

  const methods = [
    "  async saveReusableLocation(input = {}) {",
    "    if (!input.id || !input.namespace || !input.locationKey || !input.identityFingerprint) return null;",
    "    const now = new Date().toISOString();",
    "    const existing = await this.getReusableLocationByFingerprint(input.namespace, input.identityFingerprint);",
    "    const createdAt = existing?.createdAt || input.createdAt || now;",
    "    const firstSeenAt = existing?.firstSeenAt || input.firstSeenAt || createdAt;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_locations (",
    "        id, namespace, location_key, display_name, location_type, version, identity_fingerprint, canonical_identity, canonical_prompt_context,",
    "        canonical_environment_id, canonical_environment_fingerprint, canonical_master_frame_id, canonical_master_frame_path, canonical_master_frame_sha256,",
    "        prop_lock_snapshot, status, created_from_production_id, first_seen_at, last_seen_at, created_at, updated_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(namespace, identity_fingerprint) DO UPDATE SET",
    "        display_name = excluded.display_name, location_type = excluded.location_type, version = excluded.version,",
    "        canonical_identity = excluded.canonical_identity, canonical_prompt_context = excluded.canonical_prompt_context,",
    "        canonical_environment_id = COALESCE(reusable_locations.canonical_environment_id, excluded.canonical_environment_id),",
    "        canonical_environment_fingerprint = COALESCE(reusable_locations.canonical_environment_fingerprint, excluded.canonical_environment_fingerprint),",
    "        canonical_master_frame_id = COALESCE(reusable_locations.canonical_master_frame_id, excluded.canonical_master_frame_id),",
    "        canonical_master_frame_path = COALESCE(reusable_locations.canonical_master_frame_path, excluded.canonical_master_frame_path),",
    "        canonical_master_frame_sha256 = COALESCE(reusable_locations.canonical_master_frame_sha256, excluded.canonical_master_frame_sha256),",
    "        prop_lock_snapshot = excluded.prop_lock_snapshot, status = excluded.status,",
    "        last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`,",
    "      [input.id, input.namespace, input.locationKey, input.displayName || input.locationKey, input.locationType || 'location',",
    "       String(input.version || '11.9.1'), input.identityFingerprint, JSON.stringify(input.canonicalIdentity || {}), input.canonicalPromptContext || '',",
    "       input.canonicalEnvironmentId || null, input.canonicalEnvironmentFingerprint || null, input.canonicalMasterFrameId || null,",
    "       input.canonicalMasterFramePath || null, input.canonicalMasterFrameSha256 || null, JSON.stringify(input.propLockSnapshot || []),",
    "       input.status || 'registered_unanchored', input.createdFromProductionId || null, firstSeenAt, input.lastSeenAt || now, createdAt, now]",
    "    );",
    "    return this.getReusableLocationByFingerprint(input.namespace, input.identityFingerprint);",
    "  }",
    "",
    "  async getReusableLocation(id) {",
    "    return this.parseReusableLocation(await this.getRow('SELECT * FROM reusable_locations WHERE id = ? LIMIT 1', [id]));",
    "  }",
    "",
    "  async getReusableLocationByFingerprint(namespace, identityFingerprint) {",
    "    return this.parseReusableLocation(await this.getRow(",
    "      'SELECT * FROM reusable_locations WHERE namespace = ? AND identity_fingerprint = ? LIMIT 1',",
    "      [namespace || 'default', identityFingerprint]",
    "    ));",
    "  }",
    "",
    "  async getReusableLocationByKey(namespace, locationKey) {",
    "    return this.parseReusableLocation(await this.getRow(",
    "      'SELECT * FROM reusable_locations WHERE namespace = ? AND location_key = ? LIMIT 1',",
    "      [namespace || 'default', locationKey]",
    "    ));",
    "  }",
    "",
    "  async listReusableLocations(namespace = 'default') {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM reusable_locations WHERE namespace = ? ORDER BY last_seen_at DESC, created_at, rowid',",
    "      [namespace || 'default']",
    "    );",
    "    return rows.map(row => this.parseReusableLocation(row));",
    "  }",
    "",
    "  async saveReusableLocationUsage(input = {}) {",
    "    if (!input.locationId || !input.productionId || !input.environmentId) return null;",
    "    const existing = await this.getRow(",
    "      'SELECT id, created_at FROM reusable_location_usages WHERE location_id = ? AND production_id = ? AND environment_id = ? LIMIT 1',",
    "      [input.locationId, input.productionId, input.environmentId]",
    "    );",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_usage');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.created_at || input.createdAt || now;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_usages (id, location_id, production_id, environment_id, environment_fingerprint, master_frame_id, master_frame_path, master_frame_sha256, match_mode, created_at, updated_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(location_id, production_id, environment_id) DO UPDATE SET",
    "        environment_fingerprint = excluded.environment_fingerprint, master_frame_id = excluded.master_frame_id,",
    "        master_frame_path = excluded.master_frame_path, master_frame_sha256 = excluded.master_frame_sha256, match_mode = excluded.match_mode, updated_at = excluded.updated_at`,",
    "      [id, input.locationId, input.productionId, input.environmentId, input.environmentFingerprint || null, input.masterFrameId || null,",
    "       input.masterFramePath || null, input.masterFrameSha256 || null, input.matchMode || 'identity_fingerprint_exact_register', createdAt, now]",
    "    );",
    "    return this.getReusableLocationUsage(input.locationId, input.productionId, input.environmentId);",
    "  }",
    "",
    "  async getReusableLocationUsage(locationId, productionId, environmentId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM reusable_location_usages WHERE location_id = ? AND production_id = ? AND environment_id = ? LIMIT 1',",
    "      [locationId, productionId, environmentId]",
    "    );",
    "    return this.parseReusableLocationUsage(row);",
    "  }",
    "",
    "  async listReusableLocationUsages(locationId) {",
    "    const rows = await this.getAllRows('SELECT * FROM reusable_location_usages WHERE location_id = ? ORDER BY created_at, rowid', [locationId]);",
    "    return rows.map(row => this.parseReusableLocationUsage(row));",
    "  }",
    "",
    "  async listProductionReusableLocations(productionId) {",
    "    const rows = await this.getAllRows(",
    "      `SELECT l.*, u.id AS usage_id, u.production_id AS usage_production_id, u.environment_id AS usage_environment_id,",
    "              u.environment_fingerprint AS usage_environment_fingerprint, u.master_frame_id AS usage_master_frame_id,",
    "              u.master_frame_path AS usage_master_frame_path, u.master_frame_sha256 AS usage_master_frame_sha256,",
    "              u.match_mode AS usage_match_mode, u.created_at AS usage_created_at, u.updated_at AS usage_updated_at",
    "       FROM reusable_location_usages u JOIN reusable_locations l ON l.id = u.location_id",
    "       WHERE u.production_id = ? ORDER BY u.created_at, u.rowid`,",
    "      [productionId]",
    "    );",
    "    return rows.map(row => ({",
    "      ...this.parseReusableLocation(row),",
    "      usage: {",
    "        id: row.usage_id, locationId: row.id, productionId: row.usage_production_id, environmentId: row.usage_environment_id,",
    "        environmentFingerprint: row.usage_environment_fingerprint, masterFrameId: row.usage_master_frame_id, masterFramePath: row.usage_master_frame_path,",
    "        masterFrameSha256: row.usage_master_frame_sha256, matchMode: row.usage_match_mode, createdAt: row.usage_created_at, updatedAt: row.usage_updated_at",
    "      },",
    "      reusedAcrossVideos: Boolean(row.created_from_production_id && row.created_from_production_id !== productionId)",
    "    }));",
    "  }",
    "",
    "  parseReusableLocation(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, namespace: row.namespace || 'default', locationKey: row.location_key, displayName: row.display_name, locationType: row.location_type || 'location',",
    "      version: row.version || '11.9.1', identityFingerprint: row.identity_fingerprint, canonicalIdentity: JSON.parse(row.canonical_identity || '{}'),",
    "      canonicalPromptContext: row.canonical_prompt_context || '', canonicalEnvironmentId: row.canonical_environment_id,",
    "      canonicalEnvironmentFingerprint: row.canonical_environment_fingerprint, canonicalMasterFrameId: row.canonical_master_frame_id,",
    "      canonicalMasterFramePath: row.canonical_master_frame_path, canonicalMasterFrameSha256: row.canonical_master_frame_sha256,",
    "      propLockSnapshot: JSON.parse(row.prop_lock_snapshot || '[]'), status: row.status, createdFromProductionId: row.created_from_production_id,",
    "      firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    "  parseReusableLocationUsage(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, locationId: row.location_id, productionId: row.production_id, environmentId: row.environment_id,",
    "      environmentFingerprint: row.environment_fingerprint, masterFrameId: row.master_frame_id, masterFramePath: row.master_frame_path,",
    "      masterFrameSha256: row.master_frame_sha256, matchMode: row.match_mode, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Reusable Location Library DB methods');

  const loadAnchor = "    const semanticPropChecks = await this.listSemanticPropChecks(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const reusableLocations = await this.listProductionReusableLocations(productionId);\n", 'load reusable location bindings in production bundle');
  s = replaceOnce(s, "      semanticPropChecks,\n", "      semanticPropChecks,\n      reusableLocations,\n", 'expose reusable location bindings in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { SemanticPropVerifierV11 } = require('./semantic-prop-verifier-v11');\n",
    "const { SemanticPropVerifierV11 } = require('./semantic-prop-verifier-v11');\nconst { ReusableLocationLibraryV11 } = require('./reusable-location-library-v11');\n",
    'Reusable Location Library import'
  );
  s = replaceOnce(
    s,
    "    this.semanticPropVerifier = options.semanticPropVerifier || new SemanticPropVerifierV11(db, { logger: this.logger });\n",
    "    this.semanticPropVerifier = options.semanticPropVerifier || new SemanticPropVerifierV11(db, { logger: this.logger });\n    this.reusableLocationLibrary = options.reusableLocationLibrary || new ReusableLocationLibraryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Reusable Location Library construction'
  );

  const block = [
    "    let reusableLocationPlan = null;",
    "    if (environmentBible) {",
    "      const locationLocks = propLockPlan?.locks || await this.db.listPropLocks(production.id);",
    "      const locationMasterFrames = masterEnvironmentPlan?.frames || await this.db.listEnvironmentMasterFrames(production.id);",
    "      reusableLocationPlan = await this.reusableLocationLibrary.ensureProductionLocations(production, environmentBible, locationMasterFrames, locationLocks);",
    "      if (reusableLocationPlan?.active) {",
    "        this.logger.info(`Reusable Location Library v11.9.1: total=${reusableLocationPlan.summary.total}, registered=${reusableLocationPlan.summary.registered}, reused=${reusableLocationPlan.summary.reused}, canonical=${reusableLocationPlan.summary.canonicalReady}.`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'capture production environments into reusable cross-video library');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderReusableLocations(item) {",
    "  if (!Array.isArray(item?.reusableLocations) || !item.reusableLocations.length) return '';",
    "  const reused = item.reusableLocations.filter(location => location.reusedAcrossVideos === true).length;",
    "  const canonical = item.reusableLocations.filter(location => location.status === 'canonical_ready').length;",
    "  const cards = item.reusableLocations.map(location => {",
    "    const reuseState = location.reusedAcrossVideos ? 'REUSED CROSS-VIDEO' : 'REGISTERED';",
    "    const canonicalState = location.status === 'canonical_ready' ? 'CANONICAL READY' : 'UNANCHORED';",
    "    return `<div class=\"quality-check ${location.status === 'canonical_ready' ? 'pass' : ''}\"><strong>${escapeHTML(location.displayName || location.locationKey || 'location')} · ${escapeHTML(reuseState)}</strong><br><small>ID: ${escapeHTML(location.id || '')}<br>key: ${escapeHTML(location.locationKey || '')}<br>${escapeHTML(canonicalState)} · match: ${escapeHTML(location.usage?.matchMode || 'unknown')}<br>identity: ${escapeHTML((location.identityFingerprint || '').slice(0, 16))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel reusable-locations-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">REUSABLE LOCATION LIBRARY V11.9.1</p><h3>Cross-video canonical places</h3></div></div><p>${item.reusableLocations.length} location binding(s) in this video · ${reused} reused from an earlier video · ${canonical} with library-owned canonical master.</p><div class=\"quality-grid\">${cards}</div><small>11.9.1 only performs exact stable-identity reuse. Semantic/alias resolution belongs to 11.9.4, so uncertain locations are never merged by guesswork here.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Reusable Location Library dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderEnvironmentContinuity(item)}\n        ${renderSemanticPropVerification(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderEnvironmentContinuity(item)}\n        ${renderSemanticPropVerification(item)}\n        ${renderReusableLocations(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show Reusable Location Library after semantic environment evidence'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:reusable-locations'] = 'node ../bootstrap/verify-phase11-reusable-location-library.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('REUSABLE_LOCATION_LIBRARY_ENABLED=')) {
    env += `\n# Phase 11.9.1 — production-independent reusable location library.\nREUSABLE_LOCATION_LIBRARY_ENABLED=true\n# Namespace prevents accidental cross-channel collisions when one database serves multiple channel identities.\nREUSABLE_LOCATION_NAMESPACE=default\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.9.1 ativa: Persistent Location Library cross-video, com identidade canonica independente de production_id, asset master proprio e bindings de uso por video.');
