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
  if (index === -1) throw new Error(`Phase 11.9.4 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.4 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'location-resolver-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/location-resolver-v11.js');
  write('utils/location-resolver-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const tables = [
    "      // Phase 11.9.4 aliases and audited cross-video location resolution",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_aliases (",
    "        id TEXT PRIMARY KEY,",
    "        namespace TEXT NOT NULL DEFAULT 'default',",
    "        location_id TEXT NOT NULL,",
    "        alias_text TEXT NOT NULL,",
    "        alias_key TEXT NOT NULL,",
    "        location_type TEXT NOT NULL DEFAULT 'location',",
    "        source_kind TEXT NOT NULL DEFAULT 'observed_environment_reference',",
    "        canonical INTEGER NOT NULL DEFAULT 0,",
    "        confidence REAL NOT NULL DEFAULT 0,",
    "        first_seen_at TEXT NOT NULL,",
    "        last_seen_at TEXT NOT NULL,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(namespace, location_id, alias_key),",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_aliases_lookup ON reusable_location_aliases(namespace, alias_key, location_type)`,",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_resolutions (",
    "        id TEXT PRIMARY KEY,",
    "        namespace TEXT NOT NULL DEFAULT 'default',",
    "        production_id TEXT NOT NULL,",
    "        environment_id TEXT NOT NULL,",
    "        reference_text TEXT,",
    "        reference_key TEXT,",
    "        requested_type TEXT,",
    "        status TEXT NOT NULL,",
    "        location_id TEXT,",
    "        match_mode TEXT,",
    "        confidence REAL NOT NULL DEFAULT 0,",
    "        candidate_location_ids TEXT NOT NULL DEFAULT '[]',",
    "        reason TEXT,",
    "        identity_fingerprint TEXT,",
    "        created_at TEXT NOT NULL,",
    "        updated_at TEXT NOT NULL,",
    "        UNIQUE(production_id, environment_id),",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE SET NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_resolutions_prod ON reusable_location_resolutions(production_id, status, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, tables, 'Location Resolver tables');

  const methods = [
    "  async saveReusableLocationAlias(input = {}) {",
    "    if (!input.namespace || !input.locationId || !input.aliasKey) return null;",
    "    const existing = await this.getRow(",
    "      'SELECT * FROM reusable_location_aliases WHERE namespace = ? AND location_id = ? AND alias_key = ? LIMIT 1',",
    "      [input.namespace, input.locationId, input.aliasKey]",
    "    );",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_alias');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.created_at || input.createdAt || now;",
    "    const firstSeenAt = existing?.first_seen_at || input.firstSeenAt || createdAt;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_aliases (id, namespace, location_id, alias_text, alias_key, location_type, source_kind, canonical, confidence, first_seen_at, last_seen_at, created_at, updated_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(namespace, location_id, alias_key) DO UPDATE SET",
    "        alias_text = excluded.alias_text, location_type = excluded.location_type, source_kind = excluded.source_kind,",
    "        canonical = MAX(reusable_location_aliases.canonical, excluded.canonical), confidence = MAX(reusable_location_aliases.confidence, excluded.confidence),",
    "        last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`,",
    "      [id, input.namespace || 'default', input.locationId, input.aliasText || input.aliasKey, input.aliasKey, input.locationType || 'location',",
    "       input.sourceKind || 'observed_environment_reference', input.canonical ? 1 : 0, Number(input.confidence || 0), firstSeenAt, input.lastSeenAt || now, createdAt, now]",
    "    );",
    "    return this.parseReusableLocationAlias(await this.getRow('SELECT * FROM reusable_location_aliases WHERE id = ?', [id]));",
    "  }",
    "",
    "  async listReusableLocationAliasesByKey(namespace, aliasKey) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM reusable_location_aliases WHERE namespace = ? AND alias_key = ? ORDER BY confidence DESC, canonical DESC, created_at, rowid',",
    "      [namespace || 'default', aliasKey]",
    "    );",
    "    return rows.map(row => this.parseReusableLocationAlias(row));",
    "  }",
    "",
    "  async listReusableLocationAliases(locationId) {",
    "    const rows = await this.getAllRows('SELECT * FROM reusable_location_aliases WHERE location_id = ? ORDER BY canonical DESC, confidence DESC, alias_key, rowid', [locationId]);",
    "    return rows.map(row => this.parseReusableLocationAlias(row));",
    "  }",
    "",
    "  async saveReusableLocationResolution(input = {}) {",
    "    if (!input.namespace || !input.productionId || !input.environmentId || !input.status) return null;",
    "    const existing = await this.getRow(",
    "      'SELECT id, created_at FROM reusable_location_resolutions WHERE production_id = ? AND environment_id = ? LIMIT 1',",
    "      [input.productionId, input.environmentId]",
    "    );",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_resolution');",
    "    const now = new Date().toISOString();",
    "    const createdAt = existing?.created_at || input.createdAt || now;",
    "    await this.executeQuery(",
    "      `INSERT INTO reusable_location_resolutions (id, namespace, production_id, environment_id, reference_text, reference_key, requested_type, status, location_id, match_mode, confidence, candidate_location_ids, reason, identity_fingerprint, created_at, updated_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, environment_id) DO UPDATE SET",
    "        namespace = excluded.namespace, reference_text = excluded.reference_text, reference_key = excluded.reference_key, requested_type = excluded.requested_type,",
    "        status = excluded.status, location_id = excluded.location_id, match_mode = excluded.match_mode, confidence = excluded.confidence,",
    "        candidate_location_ids = excluded.candidate_location_ids, reason = excluded.reason, identity_fingerprint = excluded.identity_fingerprint, updated_at = excluded.updated_at`,",
    "      [id, input.namespace || 'default', input.productionId, input.environmentId, input.referenceText || null, input.referenceKey || null,",
    "       input.requestedType || null, input.status, input.locationId || null, input.matchMode || null, Number(input.confidence || 0),",
    "       JSON.stringify(input.candidateLocationIds || []), input.reason || null, input.identityFingerprint || null, createdAt, now]",
    "    );",
    "    return this.parseReusableLocationResolution(await this.getRow('SELECT * FROM reusable_location_resolutions WHERE id = ?', [id]));",
    "  }",
    "",
    "  async listProductionReusableLocationResolutions(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM reusable_location_resolutions WHERE production_id = ? ORDER BY created_at, rowid', [productionId]);",
    "    return rows.map(row => this.parseReusableLocationResolution(row));",
    "  }",
    "",
    "  parseReusableLocationAlias(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, namespace: row.namespace || 'default', locationId: row.location_id, aliasText: row.alias_text, aliasKey: row.alias_key,",
    "      locationType: row.location_type || 'location', sourceKind: row.source_kind, canonical: Number(row.canonical || 0) === 1,",
    "      confidence: Number(row.confidence || 0), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    "  parseReusableLocationResolution(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, namespace: row.namespace || 'default', productionId: row.production_id, environmentId: row.environment_id,",
    "      referenceText: row.reference_text, referenceKey: row.reference_key, requestedType: row.requested_type, status: row.status,",
    "      locationId: row.location_id, matchMode: row.match_mode, confidence: Number(row.confidence || 0),",
    "      candidateLocationIds: JSON.parse(row.candidate_location_ids || '[]'), reason: row.reason, identityFingerprint: row.identity_fingerprint,",
    "      createdAt: row.created_at, updatedAt: row.updated_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Location Resolver DB methods');

  const loadAnchor = "    const reusableLocationAssets = await this.listProductionReusableLocationAssets(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const reusableLocationResolutions = await this.listProductionReusableLocationResolutions(productionId);\n", 'load location resolver decisions in production bundle');
  s = replaceOnce(s, "      reusableLocationAssets,\n", "      reusableLocationAssets,\n      reusableLocationResolutions,\n", 'expose location resolver decisions in production bundle');
  write(rel, s);
}

function patchReusableLocationLibrary() {
  const rel = 'utils/reusable-location-library-v11.js';
  let s = read(rel);
  s = replaceOnce(s, "const path = require('path');\n", "const path = require('path');\nconst { LocationResolverV11 } = require('./location-resolver-v11');\n", 'Location Resolver import');
  s = replaceOnce(s, "    this.dataRoot = options.dataRoot || path.join(process.cwd(), 'data');\n", "    this.dataRoot = options.dataRoot || path.join(process.cwd(), 'data');\n    this.locationResolver = options.locationResolver || new LocationResolverV11(db, { logger: this.logger });\n", 'Location Resolver construction');

  const oldHead = [
    "    const identity = buildLocationIdentity(environment, propLocks);",
    "    const fingerprint = hash(stableJson(identity));",
    "    const locationKey = locationKeyFor(environment, fingerprint);",
    "    const existing = await this.db.getReusableLocationByFingerprint(this.namespace, fingerprint);",
    "    const locationId = existing?.id || `location_${hash(`${this.namespace}:${fingerprint}`).slice(0, 18)}`;",
    ""
  ].join('\n');
  const newHead = [
    "    const identity = buildLocationIdentity(environment, propLocks);",
    "    const fingerprint = hash(stableJson(identity));",
    "    const locationKey = locationKeyFor(environment, fingerprint);",
    "    const exactExisting = await this.db.getReusableLocationByFingerprint(this.namespace, fingerprint);",
    "    const resolution = exactExisting ? null : await this.locationResolver.resolveEnvironment({",
    "      namespace: this.namespace, production, environment, identity, identityFingerprint: fingerprint",
    "    });",
    "    if (!exactExisting && resolution?.status === 'ambiguous') {",
    "      this.logger.warn(`Location Resolver v11.9.4 left ${environment.environmentId} ambiguous: ${resolution.reason}.`);",
    "      return { status: 'ambiguous', resolution, location: null, usage: null, reused: false, matchMode: resolution.matchMode || null };",
    "    }",
    "    const existing = exactExisting || resolution?.location || null;",
    "    const locationId = existing?.id || `location_${hash(`${this.namespace}:${fingerprint}`).slice(0, 18)}`;",
    ""
  ].join('\n');
  s = replaceOnce(s, oldHead, newHead, 'resolve aliases before registering a new reusable location');

  s = replaceOnce(s, "      identityFingerprint: fingerprint,\n", "      identityFingerprint: existing?.identityFingerprint || fingerprint,\n", 'preserve canonical identity fingerprint on resolver reuse');

  const oldUsage = [
    "      matchMode: existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register',",
    "      createdAt: now",
    "    });",
    "",
    "    return {",
    "      location,",
    "      usage,",
    "      reused: Boolean(existing),",
    "      matchMode: usage?.matchMode || (existing ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register')",
    "    };"
  ].join('\n');
  const newUsage = [
    "      matchMode: exactExisting ? 'identity_fingerprint_exact_reuse' : (resolution?.location ? resolution.matchMode : 'identity_fingerprint_exact_register'),",
    "      createdAt: now",
    "    });",
    "",
    "    await this.locationResolver.ensureLocationAliases(location, environment);",
    "",
    "    return {",
    "      status: 'resolved',",
    "      resolution,",
    "      location,",
    "      usage,",
    "      reused: Boolean(existing),",
    "      matchMode: usage?.matchMode || (exactExisting ? 'identity_fingerprint_exact_reuse' : (resolution?.matchMode || 'identity_fingerprint_exact_register'))",
    "    };"
  ].join('\n');
  s = replaceOnce(s, oldUsage, newUsage, 'persist aliases and resolver match mode');

  s = replaceOnce(
    s,
    "        registered: locations.filter(item => !item.reused).length,\n        reused: locations.filter(item => item.reused).length,\n        canonicalReady: locations.filter(item => item.location?.status === 'canonical_ready').length\n",
    "        registered: locations.filter(item => item.location && !item.reused).length,\n        reused: locations.filter(item => item.location && item.reused).length,\n        canonicalReady: locations.filter(item => item.location?.status === 'canonical_ready').length,\n        resolverReused: locations.filter(item => item.location && item.reused && item.matchMode && item.matchMode !== 'identity_fingerprint_exact_reuse').length,\n        ambiguous: locations.filter(item => item.status === 'ambiguous').length\n",
    'truthful resolver-aware library summary'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderLocationResolver(item) {",
    "  if (!Array.isArray(item?.reusableLocationResolutions) || !item.reusableLocationResolutions.length) return '';",
    "  const resolved = item.reusableLocationResolutions.filter(entry => entry.status === 'resolved').length;",
    "  const ambiguous = item.reusableLocationResolutions.filter(entry => entry.status === 'ambiguous').length;",
    "  const unresolved = item.reusableLocationResolutions.filter(entry => entry.status === 'unresolved').length;",
    "  const cards = item.reusableLocationResolutions.map(entry => {",
    "    const confidence = Math.round(Number(entry.confidence || 0) * 100);",
    "    const target = entry.locationId ? ` → ${entry.locationId}` : '';",
    "    const candidates = (entry.candidateLocationIds || []).length ? ` · candidates ${entry.candidateLocationIds.length}` : '';",
    "    return `<div class=\"quality-check ${entry.status === 'resolved' ? 'pass' : (entry.status === 'ambiguous' ? 'warn' : '')}\"><strong>${escapeHTML(entry.referenceText || entry.environmentId || 'location reference')}</strong><br><small>${escapeHTML(entry.status || '')}${escapeHTML(target)} · ${escapeHTML(entry.matchMode || 'no-match')} · ${confidence}%${escapeHTML(candidates)}<br>${escapeHTML(entry.reason || '')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel location-resolver-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">LOCATION RESOLVER V11.9.4</p><h3>Cross-video location identity resolution</h3></div></div><p>${resolved} resolved · ${ambiguous} ambiguous · ${unresolved} unresolved. Generic references resolve only with one compatible contextual candidate; collisions fail closed.</p><div class=\"quality-grid\">${cards}</div></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Location Resolver dashboard renderer');
  s = replaceOnce(s, "        ${renderReusableLocations(item)}\n        ${renderReusableLocationZones(item)}\n", "        ${renderReusableLocations(item)}\n        ${renderLocationResolver(item)}\n        ${renderReusableLocationZones(item)}\n", 'show resolver decisions after reusable locations');
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:location-resolver'] = 'node ../bootstrap/verify-phase11-location-resolver.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('REUSABLE_LOCATION_RESOLVER_ENABLED=')) {
    env += `\n# Phase 11.9.4 — safe cross-video location alias/reference resolution.\nREUSABLE_LOCATION_RESOLVER_ENABLED=true\n# Minimum confidence accepted for resolver reuse; exact alias/name matches score above structural/contextual modes.\nREUSABLE_LOCATION_RESOLVER_MIN_CONFIDENCE=0.82\n# Generic references such as "their house" may reuse only one compatible location already bound in the same production.\nREUSABLE_LOCATION_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchReusableLocationLibrary();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.9.4 ativa: aliases e referencias narrativas resolvem locations reutilizaveis com fail-closed para colisao/ambiguidade e auditoria persistente.');
