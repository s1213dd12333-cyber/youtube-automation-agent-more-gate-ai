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
  if (index === -1) throw new Error(`Phase 11.9.7 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.7 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}
function copyTemplate(template, target) {
  const source = path.join(root, 'bootstrap', 'templates', template);
  if (!fs.existsSync(source)) throw new Error(`Missing bootstrap/templates/${template}`);
  write(target, fs.readFileSync(source, 'utf8'));
}
function patchDatabase() {
  let s = read('database/db.js');
  const table = [
    "      // Phase 11.9.7 audited automatic reusable-location selection",
    "      `CREATE TABLE IF NOT EXISTS reusable_location_auto_selections (",
    "        id TEXT PRIMARY KEY, namespace TEXT NOT NULL DEFAULT 'default', production_id TEXT NOT NULL, environment_id TEXT NOT NULL,",
    "        reference_text TEXT, requested_type TEXT, status TEXT NOT NULL, selected_location_id TEXT, score REAL NOT NULL DEFAULT 0,",
    "        runner_up_score REAL NOT NULL DEFAULT 0, margin REAL NOT NULL DEFAULT 0, candidates TEXT NOT NULL DEFAULT '[]', reason TEXT,",
    "        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(production_id, environment_id),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (selected_location_id) REFERENCES reusable_locations(id) ON DELETE SET NULL",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_reusable_location_auto_select_namespace ON reusable_location_auto_selections(namespace, status, updated_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", table, 'location auto selection table');
  const methods = [
    "  async saveReusableLocationAutoSelection(input = {}) {",
    "    if (!input.productionId || !input.environmentId || !input.status) return null;",
    "    const existing = await this.getRow('SELECT id, created_at FROM reusable_location_auto_selections WHERE production_id = ? AND environment_id = ? LIMIT 1', [input.productionId, input.environmentId]);",
    "    const id = existing?.id || input.id || this.generateId('reusable_location_auto_selection');",
    "    const now = new Date().toISOString(); const createdAt = existing?.created_at || input.createdAt || now;",
    "    await this.executeQuery(`INSERT INTO reusable_location_auto_selections (id, namespace, production_id, environment_id, reference_text, requested_type, status, selected_location_id, score, runner_up_score, margin, candidates, reason, created_at, updated_at)",
    "      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(production_id, environment_id) DO UPDATE SET namespace=excluded.namespace, reference_text=excluded.reference_text, requested_type=excluded.requested_type, status=excluded.status, selected_location_id=excluded.selected_location_id, score=excluded.score, runner_up_score=excluded.runner_up_score, margin=excluded.margin, candidates=excluded.candidates, reason=excluded.reason, updated_at=excluded.updated_at`,",
    "      [id, input.namespace || 'default', input.productionId, input.environmentId, input.referenceText || null, input.requestedType || null, input.status, input.selectedLocationId || null, Number(input.score || 0), Number(input.runnerUpScore || 0), Number(input.margin || 0), JSON.stringify(input.candidates || []), input.reason || null, createdAt, now]);",
    "    return this.parseReusableLocationAutoSelection(await this.getRow('SELECT * FROM reusable_location_auto_selections WHERE id = ?', [id]));",
    "  }",
    "  async listReusableLocationAutoSelections(namespace = 'default', limit = 100) {",
    "    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));",
    "    const rows = await this.getAllRows('SELECT * FROM reusable_location_auto_selections WHERE namespace = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?', [namespace || 'default', safeLimit]);",
    "    return rows.map(row => this.parseReusableLocationAutoSelection(row));",
    "  }",
    "  async getReusableLocationAsset(id) { return this.parseReusableLocationAsset(await this.getRow('SELECT * FROM reusable_location_assets WHERE id = ? LIMIT 1', [id])); }",
    "  parseReusableLocationAutoSelection(row) {",
    "    if (!row) return null;",
    "    return { id: row.id, namespace: row.namespace || 'default', productionId: row.production_id, environmentId: row.environment_id, referenceText: row.reference_text, requestedType: row.requested_type, status: row.status, selectedLocationId: row.selected_location_id, score: Number(row.score || 0), runnerUpScore: Number(row.runner_up_score || 0), margin: Number(row.margin || 0), candidates: JSON.parse(row.candidates || '[]'), reason: row.reason, createdAt: row.created_at, updatedAt: row.updated_at };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'location auto selection DB methods');
  write('database/db.js', s);
}
function patchReusableLocationLibrary() {
  let s = read('utils/reusable-location-library-v11.js');
  s = replaceOnce(s, "const { LocationResolverV11 } = require('./location-resolver-v11');\n", "const { LocationResolverV11 } = require('./location-resolver-v11');\nconst { LocationLibraryManagerV11 } = require('./location-library-manager-v11');\n", 'Location Library import');
  s = replaceOnce(s, "    this.locationResolver = options.locationResolver || new LocationResolverV11(db, { logger: this.logger });\n", "    this.locationResolver = options.locationResolver || new LocationResolverV11(db, { logger: this.logger });\n    this.locationLibraryManager = options.locationLibraryManager || new LocationLibraryManagerV11(db, { logger: this.logger });\n", 'Location Library construction');
  const oldResolve = [
    "    if (!exactExisting && resolution?.status === 'ambiguous') {",
    "      this.logger.warn(`Location Resolver v11.9.4 left ${environment.environmentId} ambiguous: ${resolution.reason}.`);",
    "      return { status: 'ambiguous', resolution, location: null, usage: null, reused: false, matchMode: resolution.matchMode || null };",
    "    }",
    "    const existing = exactExisting || resolution?.location || null;"
  ].join('\n');
  const newResolve = [
    "    if (!exactExisting && resolution?.status === 'ambiguous') {",
    "      this.logger.warn(`Location Resolver v11.9.4 left ${environment.environmentId} ambiguous: ${resolution.reason}.`);",
    "      return { status: 'ambiguous', resolution, location: null, usage: null, reused: false, matchMode: resolution.matchMode || null };",
    "    }",
    "    const autoSelection = !exactExisting && !resolution?.location && resolution?.status !== 'ambiguous'",
    "      ? await this.locationLibraryManager.autoSelectEnvironment({ namespace: this.namespace, production, environment, identity, identityFingerprint: fingerprint }) : null;",
    "    if (autoSelection?.status === 'ambiguous') {",
    "      this.logger.warn(`Location Library Auto Selection v11.9.7 left ${environment.environmentId} ambiguous: ${autoSelection.reason}.`);",
    "      return { status: 'ambiguous', resolution, autoSelection, location: null, usage: null, reused: false, matchMode: 'library_auto_select_ambiguous' };",
    "    }",
    "    const existing = exactExisting || resolution?.location || autoSelection?.location || null;"
  ].join('\n');
  s = replaceOnce(s, oldResolve, newResolve, 'auto-select after exact resolver');
  s = replaceOnce(s, "      matchMode: exactExisting ? 'identity_fingerprint_exact_reuse' : (resolution?.location ? resolution.matchMode : 'identity_fingerprint_exact_register'),\n", "      matchMode: exactExisting ? 'identity_fingerprint_exact_reuse' : (resolution?.location ? resolution.matchMode : (autoSelection?.location ? 'library_auto_select' : 'identity_fingerprint_exact_register')),\n", 'auto-selection usage mode');
  s = replaceOnce(s, "      resolution,\n      location,\n", "      resolution,\n      autoSelection,\n      location,\n", 'return auto selection');
  s = replaceOnce(s, "      matchMode: usage?.matchMode || (exactExisting ? 'identity_fingerprint_exact_reuse' : (resolution?.matchMode || 'identity_fingerprint_exact_register'))\n", "      matchMode: usage?.matchMode || (exactExisting ? 'identity_fingerprint_exact_reuse' : (resolution?.matchMode || autoSelection?.matchMode || 'identity_fingerprint_exact_register'))\n", 'return auto selection mode');
  s = replaceOnce(s, "        resolverReused: locations.filter(item => item.location && item.reused && item.matchMode && item.matchMode !== 'identity_fingerprint_exact_reuse').length,\n        ambiguous: locations.filter(item => item.status === 'ambiguous').length\n", "        resolverReused: locations.filter(item => item.location && item.reused && item.matchMode && item.matchMode !== 'identity_fingerprint_exact_reuse' && item.matchMode !== 'library_auto_select').length,\n        autoSelected: locations.filter(item => item.location && item.matchMode === 'library_auto_select').length,\n        ambiguous: locations.filter(item => item.status === 'ambiguous').length\n", 'auto-selected summary');
  write('utils/reusable-location-library-v11.js', s);
}
function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(s, "const { DiscoverabilityService } = require('./utils/discoverability-service');\n", "const { DiscoverabilityService } = require('./utils/discoverability-service');\nconst { LocationLibraryManagerV11 } = require('./utils/location-library-manager-v11');\n", 'Location Library API import');
  s = replaceOnce(s, "    this.discoverability = null;\n", "    this.discoverability = null;\n    this.locationLibrary = null;\n", 'Location Library API property');
  s = replaceOnce(s, "      await this.db.markInterruptedJobs();\n", "      await this.db.markInterruptedJobs();\n      this.locationLibrary = new LocationLibraryManagerV11(this.db, { logger: this.logger });\n", 'Location Library initialization');
  const routes = [
    "    this.app.get('/api/location-library', async (req, res) => {",
    "      try { const namespace = String(req.query.namespace || process.env.REUSABLE_LOCATION_NAMESPACE || 'default').trim() || 'default'; return res.json({ success: true, result: await this.locationLibrary.getSnapshot(namespace) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/location-library/auto-select/preview', protect, async (req, res) => {",
    "      try { const environment = req.body?.environment && typeof req.body.environment === 'object' ? req.body.environment : {}; const identity = req.body?.identity && typeof req.body.identity === 'object' ? req.body.identity : environment; const namespace = String(req.body?.namespace || process.env.REUSABLE_LOCATION_NAMESPACE || 'default').trim() || 'default'; const result = await this.locationLibrary.autoSelectEnvironment({ namespace, environment, identity, production: {}, referenceText: req.body?.referenceText }); return res.json({ success: true, result: { ...result, location: result.location ? { id: result.location.id, displayName: result.location.displayName, locationType: result.location.locationType, status: result.location.status } : null } }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/location-library/assets/:assetId', async (req, res) => {",
    "      try { const asset = await this.db.getReusableLocationAsset(req.params.assetId); if (!asset?.assetPath || asset.status !== 'ready' || asset.canonical !== true) return res.status(404).json({ error: 'Location asset not found' }); const resolved = path.resolve(asset.assetPath); const libraryRoot = path.resolve(__dirname, 'data', 'assets', 'location-library'); const relative = path.relative(libraryRoot, resolved); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(403).json({ error: 'Location asset path is not allowed' }); await fs.access(resolved); return res.sendFile(resolved); }",
    "      catch (_error) { return res.status(404).json({ error: 'Location asset not found' }); }",
    "    });",
    "    this.app.get('/api/location-library/:locationId', async (req, res) => {",
    "      try { const result = await this.locationLibrary.detail(req.params.locationId); if (!result) return res.status(404).json({ error: 'Reusable location not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Location Library API routes');
  write('index.js', s);
}
function patchDashboard() {
  let html = read('dashboard/index.html');
  const nav = '        <button class="nav-item" data-view="locations"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6.5h16v11H4z"/><path d="M7 6.5V4h10v2.5M8 10h8M8 14h5"/></svg> Location library</button>\n';
  html = insertBefore(html, '        <button class="nav-item" data-view="readiness">', nav, 'Location Library nav');
  const section = [
    '      <section id="locations-view" class="view">',
    '        <div class="section-intro"><div><h2>Location Library</h2><p>Browse canonical places reused across videos and audit automatic selection.</p></div><button id="location-library-refresh" class="button secondary">Refresh library</button></div>',
    '        <div class="stats-grid"><article class="stat"><span>Locations</span><strong id="location-stat-total">—</strong><small>persistent identities</small></article><article class="stat"><span>Canonical ready</span><strong id="location-stat-ready">—</strong><small>visual anchors</small></article><article class="stat"><span>Zones</span><strong id="location-stat-zones">—</strong><small>rooms/subspaces</small></article><article class="stat"><span>Cross-video</span><strong id="location-stat-cross-video">—</strong><small>used in 2+ productions</small></article></div>',
    '        <article class="panel"><div class="location-library-toolbar"><input id="location-library-search" placeholder="Search name, alias, type, zone…"><select id="location-library-status"><option value="all">All statuses</option><option value="canonical_ready">Canonical ready</option><option value="registered_unanchored">Unanchored</option></select><select id="location-library-type"><option value="all">All types</option></select></div><div class="location-library-layout"><div id="location-library-list" class="location-library-list"></div><div id="location-library-detail" class="location-library-detail"><div class="empty">Select a location to inspect zones, aliases, assets and usage history.</div></div></div></article>',
    '        <article class="panel"><div class="panel-heading"><div><p class="eyebrow">AUTO SELECTION V11.9.7</p><h2>Recent decisions</h2></div></div><p class="callout">Reuse requires a score above threshold and a safe margin over the runner-up. Named references still require the exact resolver.</p><div id="location-selection-list" class="quality-grid"></div></article>',
    '      </section>',
    ''
  ].join('\n');
  html = insertBefore(html, '      <section id="settings-view" class="view">\n', section, 'Location Library view');
  html = replaceOnce(html, '  <link rel="stylesheet" href="/styles.css">\n', '  <link rel="stylesheet" href="/styles.css">\n  <link rel="stylesheet" href="/location-library-v11.css">\n', 'Location Library stylesheet');
  html = replaceOnce(html, '  <script src="/enhance.js" defer></script>\n', '  <script src="/enhance.js" defer></script>\n  <script src="/location-library-v11.js" defer></script>\n', 'Location Library browser runtime');
  write('dashboard/index.html', html);
  let app = read('dashboard/app.js');
  app = replaceOnce(app, "    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.'],\n    settings: ['CHANNEL GUARDRAILS', 'Make every agent sound like you.']\n", "    locations: ['LOCATION LIBRARY', 'Reuse the same places across every video.'],\n    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.'],\n    settings: ['CHANNEL GUARDRAILS', 'Make every agent sound like you.']\n", 'Location Library title');
  write('dashboard/app.js', app);
}
function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json')); pkg.scripts = pkg.scripts || {}; pkg.scripts['test:location-library-ui'] = 'node ../bootstrap/verify-phase11-location-library-ui.js'; write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('REUSABLE_LOCATION_AUTO_SELECTION_ENABLED=')) env += '\n# Phase 11.9.7 — conservative automatic reusable-location selection.\nREUSABLE_LOCATION_AUTO_SELECTION_ENABLED=true\nREUSABLE_LOCATION_AUTO_SELECTION_MIN_SCORE=0.78\nREUSABLE_LOCATION_AUTO_SELECTION_MIN_MARGIN=0.12\nREUSABLE_LOCATION_AUTO_SELECTION_MIN_EVIDENCE_DIMENSIONS=3\n';
  write('.env.example', env);
}
copyTemplate('location-library-manager-v11.js', 'utils/location-library-manager-v11.js');
copyTemplate('location-library-dashboard-v11.js', 'dashboard/location-library-v11.js');
copyTemplate('location-library-dashboard-v11.css', 'dashboard/location-library-v11.css');
patchDatabase();
patchReusableLocationLibrary();
patchIndexApi();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.9.7 ativa: Location Library UI + auto-selection conservador por evidencia estrutural estavel, com threshold/margem e auditoria fail-closed.');
