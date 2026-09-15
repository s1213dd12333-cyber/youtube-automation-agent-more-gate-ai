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
  if (index === -1) throw new Error(`Phase 11.9.2 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.2 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'location-zone-registry-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/location-zone-registry-v11.js');
  write('utils/location-zone-registry-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 11.9.2 persistent rooms/zones inside reusable locations",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_zones (",
    "        id TEXT PRIMARY KEY,",
    "        location_id TEXT NOT NULL,",
    "        zone_key TEXT NOT NULL,",
    "        display_name TEXT NOT NULL,",
    "        zone_type TEXT NOT NULL DEFAULT 'zone',",
    "        version TEXT NOT NULL DEFAULT '11.9.2',",
    "        identity_fingerprint TEXT NOT NULL,",
    "        canonical_identity TEXT NOT NULL DEFAULT '{}',",
    "        canonical_prompt_context TEXT NOT NULL DEFAULT '',",
    "        status TEXT NOT NULL DEFAULT 'defined',",
    "        first_source_kind TEXT,",
    "        first_source_scene_id TEXT,",
    "        first_seen_at TEXT NOT NULL,",
    "        last_seen_at TEXT NOT NULL,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(location_id, zone_key),",
    "        UNIQUE(location_id, identity_fingerprint),",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_zones_location ON reusable_location_zones(location_id, zone_type, last_seen_at)`,",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_zone_usages (",
    "        id TEXT PRIMARY KEY,",
    "        zone_id TEXT NOT NULL,",
    "        location_id TEXT NOT NULL,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        environment_id TEXT,",
    "        scene_environment_id TEXT,",
    "        source_zone_name TEXT,",
    "        resolved_zone_key TEXT NOT NULL,",
    "        source_kind TEXT NOT NULL,",
    "        confidence REAL NOT NULL DEFAULT 0,",
    "        mapping_fingerprint TEXT,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(production_id, scene_id),",
    "        FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_zone_usages_prod ON reusable_location_zone_usages(production_id, scene_id)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_zone_usages_zone ON reusable_location_zone_usages(zone_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'Reusable Location Zone tables');

  const methods = [
    "  async saveReusableLocationZone(input = {}) {",
    "    if (!input.locationId || !input.zoneKey || !input.identityFingerprint) return null;",
    "    const existing = await this.getReusableLocationZoneByKey(input.locationId, input.zoneKey);",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_zone');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.createdAt || input.createdAt || now;",
    "    const firstSeenAt = existing?.firstSeenAt || input.firstSeenAt || createdAt;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_zones (",
    "        id, location_id, zone_key, display_name, zone_type, version, identity_fingerprint, canonical_identity, canonical_prompt_context,",
    "        status, first_source_kind, first_source_scene_id, first_seen_at, last_seen_at, created_at, updated_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(location_id, zone_key) DO UPDATE SET",
    "        display_name = excluded.display_name, zone_type = excluded.zone_type, version = excluded.version,",
    "        identity_fingerprint = excluded.identity_fingerprint, canonical_identity = excluded.canonical_identity,",
    "        canonical_prompt_context = excluded.canonical_prompt_context, status = excluded.status,",
    "        last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`,",
    "      [id, input.locationId, input.zoneKey, input.displayName || input.zoneKey, input.zoneType || 'zone', String(input.version || '11.9.2'),",
    "       input.identityFingerprint, JSON.stringify(input.canonicalIdentity || {}), input.canonicalPromptContext || '', input.status || 'defined',",
    "       input.firstSourceKind || existing?.firstSourceKind || null, input.firstSourceSceneId || existing?.firstSourceSceneId || null,",
    "       firstSeenAt, input.lastSeenAt || now, createdAt, now]",
    "    );",
    "    return this.getReusableLocationZoneByKey(input.locationId, input.zoneKey);",
    "  }",
    "",
    "  async getReusableLocationZone(id) {",
    "    return this.parseReusableLocationZone(await this.getRow('SELECT * FROM reusable_location_zones WHERE id = ? LIMIT 1', [id]));",
    "  }",
    "",
    "  async getReusableLocationZoneByKey(locationId, zoneKey) {",
    "    return this.parseReusableLocationZone(await this.getRow(",
    "      'SELECT * FROM reusable_location_zones WHERE location_id = ? AND zone_key = ? LIMIT 1',",
    "      [locationId, zoneKey]",
    "    ));",
    "  }",
    "",
    "  async listReusableLocationZones(locationId) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM reusable_location_zones WHERE location_id = ? ORDER BY zone_type, zone_key, created_at',",
    "      [locationId]",
    "    );",
    "    return rows.map(row => this.parseReusableLocationZone(row));",
    "  }",
    "",
    "  async saveReusableLocationZoneUsage(input = {}) {",
    "    if (!input.zoneId || !input.locationId || !input.productionId || !input.sceneId || !input.resolvedZoneKey) return null;",
    "    const existing = await this.getRow(",
    "      'SELECT id, created_at FROM reusable_location_zone_usages WHERE production_id = ? AND scene_id = ? LIMIT 1',",
    "      [input.productionId, input.sceneId]",
    "    );",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_zone_usage');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.created_at || input.createdAt || now;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_zone_usages (",
    "        id, zone_id, location_id, production_id, scene_id, environment_id, scene_environment_id, source_zone_name, resolved_zone_key,",
    "        source_kind, confidence, mapping_fingerprint, created_at, updated_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, scene_id) DO UPDATE SET",
    "        zone_id = excluded.zone_id, location_id = excluded.location_id, environment_id = excluded.environment_id,",
    "        scene_environment_id = excluded.scene_environment_id, source_zone_name = excluded.source_zone_name,",
    "        resolved_zone_key = excluded.resolved_zone_key, source_kind = excluded.source_kind, confidence = excluded.confidence,",
    "        mapping_fingerprint = excluded.mapping_fingerprint, updated_at = excluded.updated_at`,",
    "      [id, input.zoneId, input.locationId, input.productionId, input.sceneId, input.environmentId || null, input.sceneEnvironmentId || null,",
    "       input.sourceZoneName || null, input.resolvedZoneKey, input.sourceKind || 'scene_environment_mapping', Number(input.confidence || 0),",
    "       input.mappingFingerprint || null, createdAt, now]",
    "    );",
    "    return this.getReusableLocationZoneUsage(input.productionId, input.sceneId);",
    "  }",
    "",
    "  async getReusableLocationZoneUsage(productionId, sceneId) {",
    "    return this.parseReusableLocationZoneUsage(await this.getRow(",
    "      'SELECT * FROM reusable_location_zone_usages WHERE production_id = ? AND scene_id = ? LIMIT 1',",
    "      [productionId, sceneId]",
    "    ));",
    "  }",
    "",
    "  async listReusableLocationZoneUsages(zoneId) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM reusable_location_zone_usages WHERE zone_id = ? ORDER BY created_at, rowid',",
    "      [zoneId]",
    "    );",
    "    return rows.map(row => this.parseReusableLocationZoneUsage(row));",
    "  }",
    "",
    "  async listProductionReusableLocationZones(productionId) {",
    "    const rows = await this.getAllRows(",
    "      `SELECT z.*, l.location_key AS parent_location_key, l.display_name AS parent_location_name, l.identity_fingerprint AS parent_identity_fingerprint,",
    "              u.id AS usage_id, u.production_id AS usage_production_id, u.scene_id AS usage_scene_id, u.environment_id AS usage_environment_id,",
    "              u.scene_environment_id AS usage_scene_environment_id, u.source_zone_name AS usage_source_zone_name,",
    "              u.resolved_zone_key AS usage_resolved_zone_key, u.source_kind AS usage_source_kind, u.confidence AS usage_confidence,",
    "              u.mapping_fingerprint AS usage_mapping_fingerprint, u.created_at AS usage_created_at, u.updated_at AS usage_updated_at",
    "       FROM reusable_location_zone_usages u",
    "       JOIN reusable_location_zones z ON z.id = u.zone_id",
    "       JOIN reusable_locations l ON l.id = z.location_id",
    "       WHERE u.production_id = ? ORDER BY u.created_at, u.rowid`,",
    "      [productionId]",
    "    );",
    "    return rows.map(row => ({",
    "      ...this.parseReusableLocationZone(row),",
    "      parentLocationKey: row.parent_location_key, parentLocationName: row.parent_location_name, parentIdentityFingerprint: row.parent_identity_fingerprint,",
    "      usage: {",
    "        id: row.usage_id, zoneId: row.id, locationId: row.location_id, productionId: row.usage_production_id, sceneId: row.usage_scene_id,",
    "        environmentId: row.usage_environment_id, sceneEnvironmentId: row.usage_scene_environment_id, sourceZoneName: row.usage_source_zone_name,",
    "        resolvedZoneKey: row.usage_resolved_zone_key, sourceKind: row.usage_source_kind, confidence: Number(row.usage_confidence || 0),",
    "        mappingFingerprint: row.usage_mapping_fingerprint, createdAt: row.usage_created_at, updatedAt: row.usage_updated_at",
    "      }",
    "    }));",
    "  }",
    "",
    "  parseReusableLocationZone(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, locationId: row.location_id, zoneKey: row.zone_key, displayName: row.display_name, zoneType: row.zone_type || 'zone',",
    "      version: row.version || '11.9.2', identityFingerprint: row.identity_fingerprint, canonicalIdentity: JSON.parse(row.canonical_identity || '{}'),",
    "      canonicalPromptContext: row.canonical_prompt_context || '', status: row.status || 'defined', firstSourceKind: row.first_source_kind,",
    "      firstSourceSceneId: row.first_source_scene_id, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,",
    "      createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    "  parseReusableLocationZoneUsage(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, zoneId: row.zone_id, locationId: row.location_id, productionId: row.production_id, sceneId: row.scene_id,",
    "      environmentId: row.environment_id, sceneEnvironmentId: row.scene_environment_id, sourceZoneName: row.source_zone_name,",
    "      resolvedZoneKey: row.resolved_zone_key, sourceKind: row.source_kind, confidence: Number(row.confidence || 0),",
    "      mappingFingerprint: row.mapping_fingerprint, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Reusable Location Zone DB methods');

  const loadAnchor = "    const reusableLocations = await this.listProductionReusableLocations(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const reusableLocationZones = await this.listProductionReusableLocationZones(productionId);\n", 'load reusable location zones in production bundle');
  s = replaceOnce(s, "      reusableLocations,\n", "      reusableLocations,\n      reusableLocationZones,\n", 'expose reusable location zones in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { ReusableLocationLibraryV11 } = require('./reusable-location-library-v11');\n",
    "const { ReusableLocationLibraryV11 } = require('./reusable-location-library-v11');\nconst { LocationZoneRegistryV11 } = require('./location-zone-registry-v11');\n",
    'Location Zone Registry import'
  );
  s = replaceOnce(
    s,
    "    this.reusableLocationLibrary = options.reusableLocationLibrary || new ReusableLocationLibraryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.reusableLocationLibrary = options.reusableLocationLibrary || new ReusableLocationLibraryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n    this.locationZoneRegistry = options.locationZoneRegistry || new LocationZoneRegistryV11(db, { logger: this.logger });\n",
    'Location Zone Registry construction'
  );

  const block = [
    "    let reusableLocationZonePlan = null;",
    "    if (sceneEnvironmentPlan) {",
    "      const locationBindings = reusableLocationPlan?.locations?.map(item => item?.location && item?.usage ? { ...item.location, usage: item.usage } : item).filter(Boolean)",
    "        || await this.db.listProductionReusableLocations(production.id);",
    "      const latestSceneEnvironmentMappings = sceneEnvironmentPlan.mappings || await this.db.listSceneEnvironments(production.id);",
    "      reusableLocationZonePlan = await this.locationZoneRegistry.ensureProductionZones(production, locationBindings, latestSceneEnvironmentMappings, scenes);",
    "      if (reusableLocationZonePlan?.active) {",
    "        this.logger.info(`Reusable Location Zones v11.9.2: resolved=${reusableLocationZonePlan.summary.resolvedCount}, created=${reusableLocationZonePlan.summary.createdCount}, reused=${reusableLocationZonePlan.summary.reusedCount}, ambiguous=${reusableLocationZonePlan.summary.ambiguousCount}.`);",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(
    s,
    "    if (cartoonBible) {\n      shotPlan = this.shotPlanner.planProduction(production, scenes, cartoonBible);\n",
    block,
    'persist location zones after scene environment mapping and before shot planning'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderReusableLocationZones(item) {",
    "  if (!Array.isArray(item?.reusableLocationZones) || !item.reusableLocationZones.length) return '';",
    "  const uniqueZoneIds = new Set(item.reusableLocationZones.map(zone => zone.id)).size;",
    "  const uniqueLocations = new Set(item.reusableLocationZones.map(zone => zone.locationId)).size;",
    "  const cards = item.reusableLocationZones.map(zone => {",
    "    const source = zone.usage?.sourceKind || 'unknown';",
    "    const confidence = Math.round(Number(zone.usage?.confidence || 0) * 100);",
    "    return `<div class=\"quality-check pass\"><strong>${escapeHTML(zone.parentLocationName || zone.parentLocationKey || zone.locationId)} / ${escapeHTML(zone.displayName || zone.zoneKey)}</strong><br><small>zoneId: ${escapeHTML(zone.id || '')}<br>${escapeHTML(zone.zoneType || 'zone')} · ${escapeHTML(source)} · ${confidence}%<br>scene: ${escapeHTML(zone.usage?.sceneId || '')}<br>identity: ${escapeHTML((zone.identityFingerprint || '').slice(0, 16))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel reusable-location-zones-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">LOCATION ZONES V11.9.2</p><h3>Persistent rooms and subspaces</h3></div></div><p>${uniqueZoneIds} canonical zone(s) used by this video across ${uniqueLocations} reusable location(s). Each scene binding now resolves to a stable locationId + zoneId when zone evidence is unambiguous.</p><div class=\"quality-grid\">${cards}</div><small>Rooms are never guessed from temporary lighting or story state. Multi-zone scenes remain ambiguous instead of silently collapsing to the first room mentioned.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Reusable Location Zones dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderReusableLocations(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderReusableLocations(item)}\n        ${renderReusableLocationZones(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show reusable location zones after reusable locations'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:location-zones'] = 'node ../bootstrap/verify-phase11-location-zones.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('REUSABLE_LOCATION_ZONES_ENABLED=')) {
    env += `\n# Phase 11.9.2 — persistent rooms/zones inside reusable locations.\nREUSABLE_LOCATION_ZONES_ENABLED=true\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.9.2 ativa: rooms/zones persistentes por reusable location, zoneId estavel cross-video e binding scene -> locationId + zoneId fail-closed para ambiguidade.');
