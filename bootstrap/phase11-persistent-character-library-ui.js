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
  if (index === -1) throw new Error(`Phase 11.11.7 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.7 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyServices() {
  write('utils/persistent-character-library-manager-v11.js', template('persistent-character-library-manager-v11.js'));
  write('dashboard/persistent-character-library-v11.js', template('persistent-character-library-dashboard-v11.js'));
  write('dashboard/persistent-character-library-v11.css', template('persistent-character-library-dashboard-v11.css'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-character-operator-db-tables-v11.txt')}\n`, 'character operator action audit table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-character-operator-db-methods-v11.txt')}\n`, 'character library operator DB methods');
  write('database/db.js', s);
}

function patchIndexApi() {
  let s = read('index.js');
  s = replaceOnce(s,
    "const { PersistentWorldObjectLibraryManagerV11 } = require('./utils/persistent-world-object-library-manager-v11');\n",
    "const { PersistentWorldObjectLibraryManagerV11 } = require('./utils/persistent-world-object-library-manager-v11');\nconst { PersistentCharacterLibraryManagerV11 } = require('./utils/persistent-character-library-manager-v11');\n",
    'Character Library API import');
  s = replaceOnce(s,
    "    this.objectLibrary = null;\n",
    "    this.objectLibrary = null;\n    this.characterLibrary = null;\n",
    'Character Library API property');
  s = replaceOnce(s,
    "      this.objectLibrary = new PersistentWorldObjectLibraryManagerV11(this.db, { logger: this.logger });\n",
    "      this.objectLibrary = new PersistentWorldObjectLibraryManagerV11(this.db, { logger: this.logger });\n      this.characterLibrary = new PersistentCharacterLibraryManagerV11(this.db, { logger: this.logger });\n",
    'Character Library initialization');

  const routes = [
    "    this.app.get('/api/character-library', async (req, res) => {",
    "      try { const namespace = String(req.query.namespace || process.env.PERSISTENT_CHARACTER_NAMESPACE || 'default').trim() || 'default'; return res.json({ success: true, result: await this.characterLibrary.getSnapshot(namespace) }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/character-library/assets/:assetId', async (req, res) => {",
    "      try { const asset = await this.db.getPersistentCharacterAsset(req.params.assetId); if (!asset?.assetPath || asset.status !== 'ready' || asset.canonical !== true) return res.status(404).json({ error: 'Character asset not found' }); const resolved = path.resolve(asset.assetPath); const libraryRoot = path.resolve(__dirname, 'data', 'assets', 'character-library'); const relative = path.relative(libraryRoot, resolved); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(403).json({ error: 'Character asset path is not allowed' }); await fs.access(resolved); return res.sendFile(resolved); }",
    "      catch (_error) { return res.status(404).json({ error: 'Character asset not found' }); }",
    "    });",
    "    this.app.post('/api/character-library/:characterId/aliases', protect, async (req, res) => {",
    "      try { const result = await this.characterLibrary.addAlias({ characterId: req.params.characterId, aliasText: req.body?.aliasText, actor: req.body?.actor || 'dashboard_operator', note: req.body?.note }); return res.status(result?.status === 'conflict' ? 409 : 200).json({ success: result?.status !== 'conflict', result, error: result?.status === 'conflict' ? result.reason : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.post('/api/character-library/resolutions/:resolutionId/link', protect, async (req, res) => {",
    "      try { const result = await this.characterLibrary.linkResolution({ resolutionId: req.params.resolutionId, characterId: req.body?.characterId, persistAlias: req.body?.persistAlias === true, actor: req.body?.actor || 'dashboard_operator', note: req.body?.note }); return res.status(result?.status === 'conflict' ? 409 : 200).json({ success: result?.status !== 'conflict', result, error: result?.status === 'conflict' ? result.reason : undefined }); }",
    "      catch (error) { return res.status(400).json({ success: false, error: error.message }); }",
    "    });",
    "    this.app.get('/api/character-library/:characterId', async (req, res) => {",
    "      try { const result = await this.characterLibrary.detail(req.params.characterId); if (!result) return res.status(404).json({ error: 'Persistent character not found' }); return res.json({ success: true, result }); }",
    "      catch (error) { return res.status(500).json({ success: false, error: error.message }); }",
    "    });",
    ""
  ].join('\n');
  s = insertBefore(s, "    this.app.get('/api/jobs/:jobId', async (req, res) => {\n", routes, 'Character Library API routes');
  write('index.js', s);
}

function patchDashboard() {
  let html = read('dashboard/index.html');
  const nav = '        <button class="nav-item" data-view="characters"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21c.6-4.3 3-6.5 7-6.5s6.4 2.2 7 6.5"/></svg> Character library</button>\n';
  html = insertBefore(html, '        <button class="nav-item" data-view="readiness">', nav, 'Character Library nav');
  const section = [
    '      <section id="characters-view" class="view">',
    '        <div class="section-intro"><div><h2>Character Library</h2><p>Inspect persistent characters and make explicit audited corrections without rewriting canonical identity or reference assets.</p></div><button id="character-library-refresh" class="button secondary">Refresh library</button></div>',
    '        <div class="stats-grid"><article class="stat"><span>Characters</span><strong id="character-stat-total">—</strong><small>persistent identities</small></article><article class="stat"><span>Canonical ready</span><strong id="character-stat-ready">—</strong><small>character references</small></article><article class="stat"><span>Cross-video</span><strong id="character-stat-cross-video">—</strong><small>used in 2+ productions</small></article><article class="stat"><span>Blocked</span><strong id="character-stat-blocked">—</strong><small>latest continuity decision</small></article></div>',
    '        <article class="panel"><div class="character-library-toolbar"><input id="character-library-search" placeholder="Search character, alias, species…"><select id="character-library-status"><option value="all">All statuses</option><option value="canonical_ready">Canonical ready</option><option value="cross_video">Cross-video</option><option value="blocked">Continuity blocked</option></select><select id="character-library-species"><option value="all">All species/types</option></select></div><div class="character-library-layout"><div id="character-library-list" class="character-library-list"></div><div id="character-library-detail" class="character-library-detail"><div class="empty">Select a character to inspect identity, aliases, reference, appearance state, usage, bindings and continuity.</div></div></div></article>',
    '        <div class="two-column"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">RESOLVER REVIEW V11.11.7</p><h2>Pending character references</h2></div></div><p class="callout">Unresolved/ambiguous references remain fail-closed until an operator explicitly links one to an existing character.</p><div id="character-resolution-list" class="quality-grid"></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">OPERATOR AUDIT V11.11.7</p><h2>Recent character actions</h2></div></div><p class="callout">Canonical identity/reference are read-only. Every alias/link action is audited and race-safe.</p><div id="character-operator-action-list" class="quality-grid"></div></article></div>',
    '      </section>',
    ''
  ].join('\n');
  html = insertBefore(html, '      <section id="settings-view" class="view">\n', section, 'Character Library view');
  html = replaceOnce(html, '  <link rel="stylesheet" href="/persistent-world-object-library-v11.css">\n', '  <link rel="stylesheet" href="/persistent-world-object-library-v11.css">\n  <link rel="stylesheet" href="/persistent-character-library-v11.css">\n', 'Character Library stylesheet');
  html = replaceOnce(html, '  <script src="/persistent-world-object-library-v11.js" defer></script>\n', '  <script src="/persistent-world-object-library-v11.js" defer></script>\n  <script src="/persistent-character-library-v11.js" defer></script>\n', 'Character Library browser runtime');
  write('dashboard/index.html', html);

  let app = read('dashboard/app.js');
  app = replaceOnce(app,
    "    objects: ['OBJECT LIBRARY', 'Keep the same story-world objects across every video.'],\n",
    "    objects: ['OBJECT LIBRARY', 'Keep the same story-world objects across every video.'],\n    characters: ['CHARACTER LIBRARY', 'Keep the same characters recognizable across every video.'],\n",
    'Character Library title');
  write('dashboard/app.js', app);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json')); pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-character-library-ui'] = 'node ../bootstrap/verify-phase11-persistent-character-library-ui.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_CHARACTER_LIBRARY_ENABLED=')) env += `\n# Phase 11.11.7 — Character Library UI + audited operator controls.\nPERSISTENT_CHARACTER_LIBRARY_ENABLED=true\nPERSISTENT_CHARACTER_OPERATOR_CONTROLS_ENABLED=true\nPERSISTENT_CHARACTER_OPERATOR_ALIAS_ENABLED=true\nPERSISTENT_CHARACTER_OPERATOR_LINK_ENABLED=true\n`;
  write('.env.example', env);
}

copyServices();
patchDatabase();
patchIndexApi();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.11.7 ativa: Character Library UI com identidade/referencia canonicas read-only e aliases/linking auditados e atomicos.');
