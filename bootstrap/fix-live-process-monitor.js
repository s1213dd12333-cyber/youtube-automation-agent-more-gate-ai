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
  if (index === -1) throw new Error('Live process monitor anchor not found: ' + label);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error('Live process monitor anchor not found: ' + label);
  return text.slice(0, index) + block + text.slice(index);
}

function patchRuntime() {
  fs.copyFileSync(path.join(__dirname, 'templates', 'process-monitor-service-v1.js'), file('utils/process-monitor-service.js'));

  let source = read('index.js');
  source = replaceOnce(
    source,
    "const { DiscoverabilityService } = require('./utils/discoverability-service');\n",
    "const { DiscoverabilityService } = require('./utils/discoverability-service');\nconst { ProcessMonitorService } = require('./utils/process-monitor-service');\n",
    'process monitor import'
  );
  source = replaceOnce(
    source,
    "    this.discoverability = null;\n",
    "    this.discoverability = null;\n    this.processMonitor = null;\n",
    'process monitor constructor state'
  );
  source = replaceOnce(
    source,
    "      this.db = new Database();\n      await this.db.initialize();",
    "      this.db = new Database();\n      await this.db.initialize();\n      this.processMonitor = new ProcessMonitorService({ rootDir: __dirname });",
    'process monitor initialization'
  );

  const route = [
    "    this.app.get('/api/process-monitor', async (req, res) => {",
    "      try {",
    "        if (!this.processMonitor) this.processMonitor = new ProcessMonitorService({ rootDir: __dirname });",
    "        const result = await this.processMonitor.snapshot({ limit: req.query?.limit, scope: req.query?.scope });",
    "        return res.json(result);",
    "      } catch (error) {",
    "        return res.status(500).json({ error: error.message });",
    "      }",
    "    });",
    "",
  ].join('\n');
  source = insertBefore(source, "    this.app.get('/api/dashboard', async (_req, res) => {\n", route, 'process monitor API');
  write('index.js', source);
}

function patchDashboardHtml() {
  let source = read('dashboard/index.html');
  const pipelineNav = '<button class="nav-item" data-view="pipeline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17.5" cy="6" r="2"/><circle cx="14.5" cy="18" r="2"/></svg> Pipeline <b id="review-badge" class="badge hidden">0</b></button>';
  const processNav = pipelineNav + '\n        <button class="nav-item" data-view="processes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="7" cy="6" r="1.7"/><circle cx="14" cy="12" r="1.7"/><circle cx="10" cy="18" r="1.7"/></svg> Live processes <b id="process-live-badge" class="badge hidden">LIVE</b></button>';
  source = replaceOnce(source, pipelineNav, processNav, 'live processes navigation');

  const processView = [
    '      <section id="processes-view" class="view">',
    '        <div class="section-intro"><div><h2>Live process monitor</h2><p>Watch every agent step, provider call, retry, gate and publishing action as it happens.</p></div><span id="process-monitor-state" class="status">Connecting</span></div>',
    '        <div class="stats-grid process-monitor-stats">',
    '          <article class="stat"><span>Active components</span><strong id="process-active-count">0</strong><small>seen in the last 2 minutes</small></article>',
    '          <article class="stat"><span>Warnings</span><strong id="process-warning-count">0</strong><small>visible log window</small></article>',
    '          <article class="stat"><span>Errors</span><strong id="process-error-count">0</strong><small>visible log window</small></article>',
    '          <article class="stat"><span>Last event</span><strong id="process-last-event">—</strong><small id="process-log-path">logs/combined.log</small></article>',
    '        </div>',
    '        <article class="panel process-stage-panel">',
    '          <div class="panel-heading"><div><p class="eyebrow">PIPELINE TRACE</p><h2>Where the system is now</h2></div></div>',
    '          <div id="process-stage-grid" class="process-stage-grid"></div>',
    '        </article>',
    '        <article class="panel process-console-panel">',
    '          <div class="process-toolbar">',
    '            <label><span>Scope</span><select id="process-scope-filter"><option value="current" selected>Current session</option><option value="history">Recent history</option></select></label>',
    '            <label><span>Level</span><select id="process-level-filter"><option value="all">All levels</option><option value="info">Info</option><option value="warn">Warnings</option><option value="error">Errors</option></select></label>',
    '            <label><span>Component</span><select id="process-component-filter"><option value="all">All components</option></select></label>',
    '            <label class="process-search"><span>Search</span><input id="process-search-filter" placeholder="TTS, radar, scene 5, error..." autocomplete="off"></label>',
    '            <label class="toggle process-follow"><input id="process-auto-follow" type="checkbox" checked><span></span> Auto-follow</label>',
    '          </div>',
    '          <div id="process-log" class="process-log" role="log" aria-live="polite"></div>',
    '        </article>',
    '      </section>',
    '',
  ].join('\n');
  source = insertBefore(source, '      <section id="calendar-view" class="view">\n', processView, 'live processes view');
  write('dashboard/index.html', source);
}

function patchDashboardJs() {
  let source = read('dashboard/app.js');
  source = replaceOnce(
    source,
    "  engagementDetail: null\n};",
    "  engagementDetail: null,\n  processRefreshing: false,\n  processData: null\n};",
    'process monitor UI state'
  );
  source = replaceOnce(
    source,
    "    pipeline: ['CONTENT OPERATIONS', 'From idea to published.'],",
    "    pipeline: ['CONTENT OPERATIONS', 'From idea to published.'],\n    processes: ['LIVE PROCESSES', 'See exactly what every agent is doing.'],",
    'process monitor view title'
  );
  source = replaceOnce(
    source,
    "  location.hash = view;\n",
    "  location.hash = view;\n  if (view === 'processes') void refreshProcessMonitor(true);\n",
    'process monitor view refresh'
  );

  const functionsBlock = [
    "const PROCESS_STAGE_LABELS = {",
    "  news_discovery: 'News discovery', editorial_decision: 'Editorial decision', research: 'Research',",
    "  evidence: 'Evidence / truth', script: 'Script', thumbnail: 'Thumbnail', seo: 'SEO',",
    "  production: 'Production', media: 'Visuals / TTS / render', quality: 'Quality Council', publishing: 'Publishing'",
    "};",
    "",
    "async function refreshProcessMonitor(silent = false) {",
    "  if (ui.processRefreshing) return;",
    "  ui.processRefreshing = true;",
    "  try {",
    "    const scope = $('#process-scope-filter')?.value || 'current';",
    "    ui.processData = await api('/api/process-monitor?limit=500&scope=' + encodeURIComponent(scope));",
    "    renderProcessMonitor();",
    "  } catch (error) {",
    "    const state = $('#process-monitor-state');",
    "    if (state) { state.textContent = 'Unavailable'; state.className = 'status failed'; }",
    "    if (!silent) showToast(error.message, 'error');",
    "  } finally {",
    "    ui.processRefreshing = false;",
    "  }",
    "}",
    "",
    "function processEntriesFiltered(entries) {",
    "  const level = $('#process-level-filter')?.value || 'all';",
    "  const component = $('#process-component-filter')?.value || 'all';",
    "  const query = ($('#process-search-filter')?.value || '').trim().toLowerCase();",
    "  return (entries || []).filter(entry => {",
    "    if (level !== 'all' && entry.level !== level) return false;",
    "    if (component !== 'all' && entry.component !== component) return false;",
    "    if (query && !(entry.component + ' ' + entry.stage + ' ' + entry.message).toLowerCase().includes(query)) return false;",
    "    return true;",
    "  });",
    "}",
    "",
    "function renderProcessMonitor() {",
    "  const data = ui.processData || { entries: [], summary: { stages: [], components: [], errors: 0, warnings: 0, activeComponents: 0 } };",
    "  const entries = Array.isArray(data.entries) ? data.entries : [];",
    "  const summary = data.summary || {};",
    "  const state = $('#process-monitor-state');",
    "  if (!state) return;",
    "  state.textContent = summary.activeComponents ? 'Live' : 'Idle';",
    "  state.className = 'status ' + (summary.activeComponents ? 'active' : '');",
    "  $('#process-live-badge')?.classList.toggle('hidden', !summary.activeComponents);",
    "  $('#process-active-count').textContent = summary.activeComponents || 0;",
    "  $('#process-warning-count').textContent = summary.warnings || 0;",
    "  $('#process-error-count').textContent = summary.errors || 0;",
    "  const last = entries[entries.length - 1];",
    "  $('#process-last-event').textContent = last?.timestamp ? timeAgo(last.timestamp) : '—';",
    "  const scopeLabel = data.scope === 'history' ? 'recent history' : 'current session';",
    "  const sessionLabel = data.sessionStartedAt && data.scope !== 'history' ? ' · since ' + new Date(data.sessionStartedAt).toLocaleTimeString() : '';",
    "  $('#process-log-path').textContent = scopeLabel + sessionLabel + ' · ' + (data.logPath || 'logs/combined.log');",
    "",
    "  const stageGrid = $('#process-stage-grid');",
    "  stageGrid.innerHTML = (summary.stages || []).map(item => '<div class=\"process-stage ' + escapeHTML(item.status || 'idle') + '\"><span></span><div><strong>' + escapeHTML(PROCESS_STAGE_LABELS[item.stage] || label(item.stage)) + '</strong><small>' + escapeHTML(item.message || 'No activity yet') + '</small></div><em>' + escapeHTML(label(item.status || 'idle')) + '</em></div>').join('');",
    "",
    "  const componentSelect = $('#process-component-filter');",
    "  const selected = componentSelect.value || 'all';",
    "  const components = [...new Set(entries.map(entry => entry.component).filter(Boolean))].sort();",
    "  componentSelect.innerHTML = '<option value=\"all\">All components</option>' + components.map(value => '<option value=\"' + escapeHTML(value) + '\">' + escapeHTML(value) + '</option>').join('');",
    "  if (components.includes(selected)) componentSelect.value = selected;",
    "",
    "  const visible = processEntriesFiltered(entries);",
    "  const log = $('#process-log');",
    "  if (!visible.length) { log.innerHTML = empty('No process events match these filters.'); return; }",
    "  log.innerHTML = visible.map(entry => {",
    "    const details = entry.details && Object.keys(entry.details).length ? '<details><summary>details</summary><pre>' + escapeHTML(JSON.stringify(entry.details, null, 2)) + '</pre></details>' : '';",
    "    const clock = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '—';",
    "    return '<article class=\"process-line ' + escapeHTML(entry.level) + '\"><time>' + escapeHTML(clock) + '</time><span class=\"process-component\">' + escapeHTML(entry.component) + '</span><span class=\"process-level\">' + escapeHTML(entry.level.toUpperCase()) + '</span><div><p>' + escapeHTML(entry.message) + '</p><small>' + escapeHTML(PROCESS_STAGE_LABELS[entry.stage] || label(entry.stage)) + ' · ' + escapeHTML(label(entry.status)) + '</small>' + details + '</div></article>';",
    "  }).join('');",
    "  if ($('#process-auto-follow')?.checked) log.scrollTop = log.scrollHeight;",
    "}",
    "",
  ].join('\n');
  source = insertBefore(source, "function currentPipelineFilter() {\n", functionsBlock, 'process monitor render functions');

  const listenerBlock = [
    "['process-level-filter', 'process-component-filter'].forEach(id => {",
    "  $('#' + id)?.addEventListener('change', () => renderProcessMonitor());",
    "});",
    "$('#process-scope-filter')?.addEventListener('change', () => refreshProcessMonitor(true));",
    "$('#process-search-filter')?.addEventListener('input', () => renderProcessMonitor());",
    "",
  ].join('\n');
  source = insertBefore(source, "const initialView = location.hash.slice(1);\n", listenerBlock, 'process monitor controls');
  source = replaceOnce(
    source,
    "if (['overview', 'operator', 'pipeline', 'calendar', 'analytics', 'engagement', 'readiness', 'settings'].includes(initialView)) switchView(initialView);",
    "if (['overview', 'operator', 'pipeline', 'processes', 'calendar', 'analytics', 'engagement', 'readiness', 'settings'].includes(initialView)) switchView(initialView);",
    'process monitor deep link'
  );
  source = replaceOnce(
    source,
    "setInterval(() => refreshDashboard(true), 8000);",
    "setInterval(() => refreshDashboard(true), 8000);\nsetInterval(() => { if (ui.currentView === 'processes') void refreshProcessMonitor(true); }, 2000);",
    'process monitor polling'
  );
  write('dashboard/app.js', source);
}

function patchStyles() {
  let source = read('dashboard/styles.css');
  const styles = [
    '',
    '/* ============ Live process monitor ============ */',
    '.process-monitor-stats { margin-bottom: 16px; }',
    '.process-stage-panel { margin-bottom: 16px; }',
    '.process-stage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }',
    '.process-stage { min-width: 0; display: grid; grid-template-columns: 9px minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 11px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-inset); }',
    '.process-stage > span { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }',
    '.process-stage.running > span { background: var(--blue); }',
    '.process-stage.ready > span { background: var(--green); opacity: .72; }',
    '.process-stage.completed > span { background: var(--green); }',
    '.process-stage.warning > span { background: #e5b44b; }',
    '.process-stage.failed > span { background: var(--red); }',
    '.process-stage strong, .process-stage small { display: block; min-width: 0; }',
    '.process-stage strong { font-size: 12px; }',
    '.process-stage small { color: var(--muted); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }',
    '.process-stage em { color: var(--muted); font: 9px var(--font-mono); font-style: normal; text-transform: uppercase; letter-spacing: .06em; }',
    '.process-console-panel { padding: 0; overflow: hidden; }',
    '.process-toolbar { display: grid; grid-template-columns: 145px 130px 190px minmax(220px,1fr) auto; gap: 10px; align-items: end; padding: 14px; border-bottom: 1px solid var(--line); }',
    '.process-toolbar label > span { display: block; margin-bottom: 5px; color: var(--muted); font: 9px var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }',
    '.process-follow { align-self: center; white-space: nowrap; padding-top: 17px; }',
    '.process-log { max-height: 560px; overflow: auto; background: #080b12; font-family: var(--font-mono); }',
    '.process-line { display: grid; grid-template-columns: 82px 170px 58px minmax(0,1fr); gap: 10px; align-items: start; padding: 9px 12px; border-bottom: 1px solid rgba(151,167,195,.08); font-size: 11px; }',
    '.process-line time { color: #75839b; }',
    '.process-component { color: #9bb7e8; overflow-wrap: anywhere; }',
    '.process-level { color: #8e9bb0; font-weight: 700; }',
    '.process-line.warn .process-level { color: #e5b44b; }',
    '.process-line.error .process-level { color: #ff6978; }',
    '.process-line p { margin: 0; color: #d7e0ef; line-height: 1.45; overflow-wrap: anywhere; }',
    '.process-line small { display: block; color: #718098; margin-top: 3px; }',
    '.process-line details { margin-top: 5px; color: #8090aa; }',
    '.process-line pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 5px 0 0; font-size: 10px; }',
    '@media (max-width: 820px) { .process-stage-grid { grid-template-columns: 1fr; } .process-toolbar { grid-template-columns: 1fr 1fr; } .process-search { grid-column: 1 / -1; } .process-line { grid-template-columns: 70px minmax(0,1fr); } .process-line .process-level { grid-column: 1; } .process-line > div { grid-column: 2; grid-row: 1 / span 2; } }',
    '@media (max-width: 520px) { .process-toolbar { grid-template-columns: 1fr; } .process-search { grid-column: auto; } .process-line { grid-template-columns: 1fr; gap: 4px; } .process-line .process-level, .process-line > div { grid-column: 1; grid-row: auto; } }',
    ''
  ].join('\n');
  if (!source.includes('/* ============ Live process monitor ============ */')) source += styles;
  write('dashboard/styles.css', source);
}

function patchPackage() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:live-process-monitor'] = 'node ../bootstrap/verify-live-process-monitor.js';
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

patchRuntime();
patchDashboardHtml();
patchDashboardJs();
patchStyles();
patchPackage();

console.log('Live Process Monitor active: every structured AgentTube log event is visible in the dashboard with stage classification, filters, live polling and secret redaction.');
