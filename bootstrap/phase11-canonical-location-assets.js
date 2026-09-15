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
  if (index === -1) throw new Error(`Phase 11.9.3 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.3 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'canonical-location-assets-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/canonical-location-assets-v11.js');
  write('utils/canonical-location-assets-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.9.3 canonical reusable location/zone visual assets",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_assets (",
    "        id TEXT PRIMARY KEY,",
    "        asset_key TEXT NOT NULL UNIQUE,",
    "        location_id TEXT NOT NULL,",
    "        zone_id TEXT,",
    "        scope TEXT NOT NULL,",
    "        asset_role TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.9.3',",
    "        identity_fingerprint TEXT,",
    "        canonical INTEGER NOT NULL DEFAULT 0,",
    "        status TEXT NOT NULL DEFAULT 'planned',",
    "        asset_path TEXT,",
    "        asset_sha256 TEXT,",
    "        source_kind TEXT,",
    "        source_production_id TEXT,",
    "        source_scene_id TEXT,",
    "        source_keyframe_id TEXT,",
    "        source_environment_id TEXT,",
    "        provider TEXT,",
    "        model TEXT,",
    "        continuity_check_id TEXT,",
    "        continuity_score REAL,",
    "        semantic_check_id TEXT,",
    "        semantic_status TEXT,",
    "        semantic_verified INTEGER NOT NULL DEFAULT 0,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_assets_location ON reusable_location_assets(location_id, scope, asset_role, status)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_assets_zone ON reusable_location_assets(zone_id, asset_role, status)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'canonical location assets table');

  const methods = [
    "  async saveReusableLocationAsset(input = {}) {",
    "    if (!input.assetKey || !input.locationId || !input.scope || !input.assetRole) return null;",
    "    const existing = await this.getReusableLocationAssetByKey(input.assetKey);",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_asset');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.createdAt || input.createdAt || now;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_assets (",
    "        id, asset_key, location_id, zone_id, scope, asset_role, version, identity_fingerprint, canonical, status, asset_path, asset_sha256,",
    "        source_kind, source_production_id, source_scene_id, source_keyframe_id, source_environment_id, provider, model, continuity_check_id,",
    "        continuity_score, semantic_check_id, semantic_status, semantic_verified, created_at, updated_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(asset_key) DO UPDATE SET",
    "        identity_fingerprint = excluded.identity_fingerprint, canonical = excluded.canonical, status = excluded.status,",
    "        asset_path = excluded.asset_path, asset_sha256 = excluded.asset_sha256, source_kind = excluded.source_kind,",
    "        source_production_id = excluded.source_production_id, source_scene_id = excluded.source_scene_id, source_keyframe_id = excluded.source_keyframe_id,",
    "        source_environment_id = excluded.source_environment_id, provider = excluded.provider, model = excluded.model,",
    "        continuity_check_id = excluded.continuity_check_id, continuity_score = excluded.continuity_score, semantic_check_id = excluded.semantic_check_id,",
    "        semantic_status = excluded.semantic_status, semantic_verified = excluded.semantic_verified, version = excluded.version, updated_at = excluded.updated_at`,",
    "      [id, input.assetKey, input.locationId, input.zoneId || null, input.scope, input.assetRole, String(input.version || '11.9.3'),",
    "       input.identityFingerprint || null, input.canonical ? 1 : 0, input.status || 'planned', input.assetPath || null, input.assetSha256 || null,",
    "       input.sourceKind || null, input.sourceProductionId || null, input.sourceSceneId || null, input.sourceKeyframeId || null,",
    "       input.sourceEnvironmentId || null, input.provider || null, input.model || null, input.continuityCheckId || null,",
    "       input.continuityScore == null ? null : Number(input.continuityScore), input.semanticCheckId || null, input.semanticStatus || null,",
    "       input.semanticVerified ? 1 : 0, createdAt, now]",
    "    );",
    "    return this.getReusableLocationAssetByKey(input.assetKey);",
    "  }",
    "",
    "  async getReusableLocationAssetByKey(assetKey) {",
    "    return this.parseReusableLocationAsset(await this.getRow('SELECT * FROM reusable_location_assets WHERE asset_key = ? LIMIT 1', [assetKey]));",
    "  }",
    "",
    "  async listReusableLocationAssets(locationId, zoneId = null) {",
    "    const rows = zoneId",
    "      ? await this.getAllRows('SELECT * FROM reusable_location_assets WHERE location_id = ? AND zone_id = ? ORDER BY asset_role, created_at', [locationId, zoneId])",
    "      : await this.getAllRows('SELECT * FROM reusable_location_assets WHERE location_id = ? ORDER BY scope, zone_id, asset_role, created_at', [locationId]);",
    "    return rows.map(row => this.parseReusableLocationAsset(row));",
    "  }",
    "",
    "  async listProductionReusableLocationAssets(productionId) {",
    "    const rows = await this.getAllRows(",
    "      `SELECT DISTINCT a.* FROM reusable_location_assets a",
    "       WHERE a.location_id IN (SELECT location_id FROM reusable_location_usages WHERE production_id = ?)",
    "       ORDER BY a.location_id, a.scope, a.zone_id, a.asset_role, a.created_at`,",
    "      [productionId]",
    "    );",
    "    return rows.map(row => this.parseReusableLocationAsset(row));",
    "  }",
    "",
    "  parseReusableLocationAsset(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, assetKey: row.asset_key, locationId: row.location_id, zoneId: row.zone_id, scope: row.scope, assetRole: row.asset_role,",
    "      version: row.version || '11.9.3', identityFingerprint: row.identity_fingerprint, canonical: Number(row.canonical || 0) === 1, status: row.status,",
    "      assetPath: row.asset_path, assetSha256: row.asset_sha256, sourceKind: row.source_kind, sourceProductionId: row.source_production_id,",
    "      sourceSceneId: row.source_scene_id, sourceKeyframeId: row.source_keyframe_id, sourceEnvironmentId: row.source_environment_id,",
    "      provider: row.provider, model: row.model, continuityCheckId: row.continuity_check_id,",
    "      continuityScore: row.continuity_score == null ? null : Number(row.continuity_score), semanticCheckId: row.semantic_check_id,",
    "      semanticStatus: row.semantic_status, semanticVerified: Number(row.semantic_verified || 0) === 1, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'canonical location asset DB methods');

  const loadAnchor = "    const reusableLocationZones = await this.listProductionReusableLocationZones(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const reusableLocationAssets = await this.listProductionReusableLocationAssets(productionId);\n", 'load canonical location assets in production bundle');
  s = replaceOnce(s, "      reusableLocationZones,\n", "      reusableLocationZones,\n      reusableLocationAssets,\n", 'expose canonical location assets in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { LocationZoneRegistryV11 } = require('./location-zone-registry-v11');\n",
    "const { LocationZoneRegistryV11 } = require('./location-zone-registry-v11');\nconst { CanonicalLocationAssetRegistryV11 } = require('./canonical-location-assets-v11');\n",
    'Canonical Location Asset Registry import'
  );
  s = replaceOnce(
    s,
    "    this.locationZoneRegistry = options.locationZoneRegistry || new LocationZoneRegistryV11(db, { logger: this.logger });\n",
    "    this.locationZoneRegistry = options.locationZoneRegistry || new LocationZoneRegistryV11(db, { logger: this.logger });\n    this.canonicalLocationAssets = options.canonicalLocationAssets || new CanonicalLocationAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Canonical Location Asset Registry construction'
  );

  const anchor = "    bundle = await this.db.getProductionBundle(production.id);\n    await this.persistMediaSummary(bundle, scenes, fingerprint);\n";
  const replacement = [
    "    bundle = await this.db.getProductionBundle(production.id);",
    "    const canonicalLocationAssetPlan = await this.canonicalLocationAssets.ensureProductionAssets(bundle || { id: production.id });",
    "    if (canonicalLocationAssetPlan?.active) {",
    "      this.logger.info(`Canonical Location Assets v11.9.3: locationMasters=${canonicalLocationAssetPlan.summary.locationMasters}, zoneReady=${canonicalLocationAssetPlan.summary.zoneReady}, reused=${canonicalLocationAssetPlan.summary.zoneReused}, unanchored=${canonicalLocationAssetPlan.summary.zoneUnanchored}.`);",
    "    }",
    "    bundle = await this.db.getProductionBundle(production.id) || bundle;",
    "    await this.persistMediaSummary(bundle, scenes, fingerprint);",
    ""
  ].join('\n');
  s = replaceOnce(s, anchor, replacement, 'promote canonical location assets after all scenes are ready');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCanonicalLocationAssets(item) {",
    "  if (!Array.isArray(item?.reusableLocationAssets) || !item.reusableLocationAssets.length) return '';",
    "  const locationMasters = item.reusableLocationAssets.filter(asset => asset.scope === 'location' && asset.status === 'ready').length;",
    "  const zoneAssets = item.reusableLocationAssets.filter(asset => asset.scope === 'zone');",
    "  const verified = zoneAssets.filter(asset => asset.status === 'ready' && asset.canonical === true).length;",
    "  const cards = item.reusableLocationAssets.map(asset => {",
    "    const scope = asset.scope === 'zone' ? `zone ${asset.zoneId || '?'}` : 'whole location';",
    "    const evidence = asset.scope === 'zone' ? `continuity ${asset.continuityScore == null ? 'n/a' : Math.round(Number(asset.continuityScore) * 100) + '%'} · semantic ${asset.semanticVerified ? 'verified' : (asset.semanticStatus || 'optional/not-run')}` : 'library-owned canonical master';",
    "    return `<div class=\"quality-check ${asset.status === 'ready' && asset.canonical ? 'pass' : ''}\"><strong>${escapeHTML(asset.assetRole || 'asset')} · ${escapeHTML(scope)}</strong><br><small>${escapeHTML(asset.status || '')} · ${escapeHTML(asset.sourceKind || '')}<br>${escapeHTML(evidence)}<br>sha256: ${escapeHTML((asset.assetSha256 || '').slice(0, 16))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel canonical-location-assets-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CANONICAL LOCATION ASSETS V11.9.3</p><h3>Reusable visual anchors</h3></div></div><p>${locationMasters} location master(s) and ${verified}/${zoneAssets.length} zone reference(s) are canonical and library-owned.</p><div class=\"quality-grid\">${cards}</div><small>Zone assets are promoted only from real ready keyframes with accepted Environment Continuity. Rejected semantic evidence blocks promotion; globally-required semantic verification remains fail-closed.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'canonical location assets dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderReusableLocations(item)}\n        ${renderReusableLocationZones(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderReusableLocations(item)}\n        ${renderReusableLocationZones(item)}\n        ${renderCanonicalLocationAssets(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show canonical location assets after location zones'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:canonical-location-assets'] = 'node ../bootstrap/verify-phase11-canonical-location-assets.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CANONICAL_LOCATION_ASSETS_ENABLED=')) {
    env += `\n# Phase 11.9.3 — library-owned visual anchors for reusable locations and zones.\nCANONICAL_LOCATION_ASSETS_ENABLED=true\n# Zone references are promoted only after accepted Phase 11.7.6 Environment Continuity evidence.\nCANONICAL_LOCATION_ASSET_REQUIRE_CONTINUITY=true\n# Set true to require Phase 11.8 semantic verification even when SEMANTIC_PROP_REQUIRE_VERIFICATION=false.\nCANONICAL_LOCATION_ASSET_REQUIRE_SEMANTIC=false\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.9.3 ativa: assets canonicos de locations/zones sao persistidos fora da producao e zonas so promovem frames reais com evidencia de continuidade aceita.');
