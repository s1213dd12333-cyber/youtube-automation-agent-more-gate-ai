'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');

function read(rel) {
  return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

(async () => {
  const runtime = read('index.js');
  const app = read('dashboard/app.js');
  const html = read('dashboard/index.html');
  const styles = read('dashboard/styles.css');

  assert(runtime.includes("const { ProcessMonitorService } = require('./utils/process-monitor-service');"), 'runtime must import process monitor service');
  assert(runtime.includes("this.app.get('/api/process-monitor'"), 'runtime must expose read-only process monitor API');
  assert(html.includes('data-view="processes"'), 'dashboard must expose Live processes navigation');
  assert(html.includes('id="processes-view"'), 'dashboard must contain Live processes view');
  assert(html.includes('id="process-stage-grid"'), 'dashboard must contain stage trace');
  assert(html.includes('id="process-log"'), 'dashboard must contain live log console');
  assert(app.includes("processes: ['LIVE PROCESSES'"), 'dashboard must register process monitor view title');
  assert(app.includes("refreshProcessMonitor(true)"), 'dashboard must refresh monitor when opened');
  assert(app.includes("ui.currentView === 'processes'"), 'dashboard must poll process monitor only while visible');
  assert(styles.includes('/* ============ Live process monitor ============ */'), 'dashboard must include process monitor styles');

  const { ProcessMonitorService, componentStage, entryStatus, redactText } = require(path.join(upstream, 'utils', 'process-monitor-service.js'));
  assert.strictEqual(componentStage('GlobalNewsRadar', 'fetching RSS'), 'news_discovery');
  assert.strictEqual(componentStage('ScriptWriter', 'Generating script'), 'script');
  assert.strictEqual(componentStage('AIVideoGenerator', 'Generating TTS audio'), 'media');
  assert.strictEqual(componentStage('PublishingScheduling', 'Publish queue is empty'), 'publishing');
  assert.strictEqual(entryStatus('error', 'provider failed'), 'failed');
  assert.strictEqual(entryStatus('warn', 'retrying request'), 'warning');
  assert(redactText('Authorization: Bearer abc.def.ghi').includes('[REDACTED]'), 'bearer tokens must be redacted');
  assert(!redactText('api_key=super-secret-value').includes('super-secret-value'), 'API keys must be redacted');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttube-process-monitor-'));
  const logPath = path.join(temp, 'combined.log');
  const now = new Date();
  const rows = [
    { timestamp: new Date(now.getTime() - 3000).toISOString(), level: 'info', component: 'GlobalNewsRadar', message: 'Fetching RSS world sources' },
    { timestamp: new Date(now.getTime() - 2000).toISOString(), level: 'warn', component: 'AIVideoGenerator', message: 'Gemini TTS retrying', token: 'secret' },
    { timestamp: new Date(now.getTime() - 1000).toISOString(), level: 'error', component: 'ProductionManagement', message: 'Scene 5 failed', error: 'api_key=super-secret-value' }
  ];
  fs.writeFileSync(logPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');

  const monitor = new ProcessMonitorService({ rootDir: temp, logPath, maxBytes: 65536 });
  const snapshot = await monitor.snapshot({ limit: 50 });
  assert.strictEqual(snapshot.entries.length, 3, 'monitor must parse structured log lines');
  assert.strictEqual(snapshot.summary.errors, 1, 'monitor must count errors');
  assert.strictEqual(snapshot.summary.warnings, 1, 'monitor must count warnings');
  assert(snapshot.summary.activeComponents >= 1, 'recent components must be marked active');
  assert(snapshot.summary.stages.some(item => item.stage === 'media' && item.status === 'warning'), 'stage trace must expose latest media warning');
  assert(!JSON.stringify(snapshot).includes('super-secret-value'), 'snapshot must not leak redacted secrets');

  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Live Process Monitor verification passed.');
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
