'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');
const template = name => fs.readFileSync(path.join(root, 'bootstrap', 'templates', name), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 11.10.7 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.7 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyServices() {
  write('utils/persistent-world-object-library-manager-v11.js', template('persistent-world-object-library-manager-v11.js'));
  write('dashboard/persistent-world-object-library-v11.js', template('persistent-world-object-library-dashboard-v11.js'));
  write('dashboard/persistent-world-object-library-v11.css', template('persistent-world-object-library-dashboard-v11.css'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-world-object-operator-db-tables-v11.txt')}\n`, 'operator action audit table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-world-object-operator-db-methods-v11.txt')}\n`, 'object library operator DB methods');
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(s,
    "const { LocationLibraryManagerV11 } = require('./utils/location-library-manager-v11');\n",
    "const { LocationLibraryManagerV11 } = require('./utils/location-library-manager-v11');\nconst { PersistentWorldObjectLibraryManagerV11 } = require('./utils/persistent-world-object-library-manager-v11');\n",
    'Object Library API import');
  s = replaceOnce(s,
    "    this.locationLibrary = null;\n    this.setupRequired = false;\n",
    "    this.locationLibrary = null;\n    this.objectLibrary = null;\n    this.setupRequired = false;\n",
    'Object Library API property');
  s = replaceOnce(s,
    "      this.locationLibrary = new LocationLibraryManagerV11(this.db, { logger: this.logger });\n",
    "      this.locationLibrary = new LocationLibraryManagerV11(this.db, { logger: this.logger });\n      this.objectLibrary = new PersistentWorldObjectLibraryManagerV11(this.db, { logger: this.logger });\n",
    'Object Library initialization');

  const routes = [
    "    this.app.get('/api/object-library', async (req, res) => {",
    "      try { const namespace = String(req.query.namespace || process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE || process.env.REUSABLE_LOCATION_NAMESPACE || 'default').trim() || 'default'; return res.json({ success: true, result: await this.objectLibrary.getSnapshot(namespace) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/object-library/assets/:assetId', async (req, res) => {",
    "      try { const asset = await this.db.getPersistentWorldObjectAsset(req.params.assetId); if (!asset?.assetPath || asset.status !== 'ready' || asset.canonical !== true) return res.status(404).json({ error: 'Object asset not found' }); const resolved = path.resolve(asset.assetPath); const libraryRoot = path.resolve(__dirname, 'data', 'assets', 'object-library'); const relative = path.relative(libraryRoot, resolved); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(403).json({ error: 'Object asset path is not allowed' }); await fs.access(resolved); return res.sendFile(resolved); }",
    "      catch (_error) { return res.status(404).json({ error: 'Object asset not found' }); }",
    "    });",
    "    this.app.post('/api/object-library/:objectId/aliases', protect, async (req, res) => {",
    "      try { const result = await this.objectLibrary.addAlias({ objectId: req.params.objectId, aliasText: req.body?.aliasText, actor: req.body?.actor || 'dashboard_operator', note: req.body?.note }); return res.status(result?.status === 'conflict' ? 409 : 200).json({ success: result?.status !== 'conflict', result, error: result?.status === 'conflict' ? result.reason : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/object-library/resolutions/:resolutionId/link', protect, async (req, res) => {",
    "      try { const result = await this.objectLibrary.linkResolution({ resolutionId: req.params.resolutionId, objectId: req.body?.objectId, persistAlias: req.body?.persistAlias === true, actor: req.body?.actor || 'dashboard_operator', note: req.body?.note }); return res.status(result?.status === 'conflict' ? 409 : 200).json({ success: result?.status !== 'conflict', result, error: result?.status === 'conflict' ? result.reason : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/object-library/:objectId', async (req, res) => {",
    "      try { const result = await this.objectLibrary.detail(req.params.objectId); if (!result) return res.status(404).json({ error: 'Persistent world object not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Object Library API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const nav = '        <button class="nav-item" data-view="objects"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 7h12v10H6z"/><path d="M9 4h6v3M9 17v3h6v-3M3 10h3M18 10h3M3 14h3M18 14h3"/></svg> Object library</button>\n';
  html = insertBefore(html, '        <button class="nav-item" data-view="readiness">', nav, 'Object Library nav');
  const section = [
    '      <section id="objects-view" class="view">',
    '        <div class="section-intro"><div><h2>Object Library</h2><p>Inspect persistent story-world objects and make explicit, audited corrections without rewriting canonical identity.</p></div><button id="object-library-refresh" class="button secondary">Refresh library</button></div>',
    '        <div class="stats-grid"><article class="stat"><span>Objects</span><strong id="object-stat-total">—</strong><small>persistent identities</small></article><article class="stat"><span>Canonical ready</span><strong id="object-stat-ready">—</strong><small>visual anchors</small></article><article class="stat"><span>Cross-video</span><strong id="object-stat-cross-video">—</strong><small>used in 2+ productions</small></article><article class="stat"><span>Blocked</span><strong id="object-stat-blocked">—</strong><small>latest continuity decision</small></article></div>',
    '        <article class="panel"><div class="object-library-toolbar"><input id="object-library-search" placeholder="Search object, alias, type…"><select id="object-library-status"><option value="all">All statuses</option><option value="canonical_ready">Canonical ready</option><option value="cross_video">Cross-video</option><option value="blocked">Continuity blocked</option></select><select id="object-library-type"><option value="all">All types</option></select></div><div class="object-library-layout"><div id="object-library-list" class="object-library-list"></div><div id="object-library-detail" class="object-library-detail"><div class="empty">Select an object to inspect identity, aliases, asset, state, usage, bindings and continuity.</div></div></div></article>',
    '        <div class="two-column"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">RESOLVER REVIEW V11.10.7</p><h2>Pending references</h2></div></div><p class="callout">Unresolved/ambiguous references remain fail-closed until an operator explicitly links one to an existing object.</p><div id="object-resolution-list" class="quality-grid"></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">OPERATOR AUDIT V11.10.7</p><h2>Recent actions</h2></div></div><p class="callout">Canonical fingerprints/assets are read-only here. Every alias/link action is audited.</p><div id="object-operator-action-list" class="quality-grid"></div></article></div>',
    '      </section>',
    ''
  ].join('\n');
  html = insertBefore(html, '      <section id="settings-view" class="view">\n', section, 'Object Library view');
  html = replaceOnce(html, '  <link rel="stylesheet" href="/location-library-v11.css">\n', '  <link rel="stylesheet" href="/location-library-v11.css">\n  <link rel="stylesheet" href="/persistent-world-object-library-v11.css">\n', 'Object Library stylesheet');
  html = replaceOnce(html, '  <script src="/location-library-v11.js" defer></script>\n', '  <script src="/location-library-v11.js" defer></script>\n  <script src="/persistent-world-object-library-v11.js" defer></script>\n', 'Object Library browser runtime');
  write('dashboard/index.html', html);

  let app = read('dashboard/app.js');
  app = replaceOnce(app,
    "    locations: ['LOCATION LIBRARY', 'Reuse the same places across every video.'],\n    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.'],\n",
    "    locations: ['LOCATION LIBRARY', 'Reuse the same places across every video.'],\n    objects: ['OBJECT LIBRARY', 'Keep the same story-world objects across every video.'],\n    readiness: ['PRODUCTION READINESS', 'Verify before autonomy runs.'],\n",
    'Object Library title');
  write('dashboard/app.js', app);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-world-object-library-ui'] = 'node ../bootstrap/verify-phase11-persistent-world-object-library-ui.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_WORLD_OBJECT_LIBRARY_ENABLED=')) env += `\n# Phase 11.10.7 — Object Library UI + audited operator controls.\nPERSISTENT_WORLD_OBJECT_LIBRARY_ENABLED=true\nPERSISTENT_WORLD_OBJECT_OPERATOR_CONTROLS_ENABLED=true\nPERSISTENT_WORLD_OBJECT_OPERATOR_ALIAS_ENABLED=true\nPERSISTENT_WORLD_OBJECT_OPERATOR_LINK_ENABLED=true\n`;
  write('.env.example', env);
}

copyServices();
patchDatabase();
patchIndexApi();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.7 ativa: Object Library UI com identidade canonica read-only, aliases/linking explicitos e auditoria de operador.');
