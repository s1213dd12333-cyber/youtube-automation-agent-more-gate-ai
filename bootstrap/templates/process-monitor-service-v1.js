'use strict';

const fs = require('fs').promises;
const path = require('path');

const STAGES = [
  'news_discovery',
  'editorial_decision',
  'research',
  'evidence',
  'script',
  'thumbnail',
  'seo',
  'production',
  'media',
  'quality',
  'publishing'
];

function clean(value, max = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function redactText(value) {
  let text = String(value ?? '');
  const patterns = [
    [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]'],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]'],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
    [/("?(?:api[_-]?key|token|authorization|secret|password)"?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[REDACTED]']
  ];
  for (const [pattern, replacement] of patterns) text = text.replace(pattern, replacement);
  return text;
}

function componentStage(component, message = '') {
  const value = (String(component || '') + ' ' + String(message || '')).toLowerCase();
  if (/globalnews|newsroom|radar|gdelt|rss/.test(value)) return 'news_discovery';
  if (/editorial|importance|planning brain|decision brain/.test(value)) return 'editorial_decision';
  if (/research/.test(value)) return 'research';
  if (/evidence|truth|provenance|claim/.test(value)) return 'evidence';
  if (/scriptwriter|script writer|script generated|generating script/.test(value)) return 'script';
  if (/thumbnail/.test(value)) return 'thumbnail';
  if (/seooptimizer|seo optimization|seo /.test(value)) return 'seo';
  if (/productionmanagement|production director|processing content/.test(value)) return 'production';
  if (/aivideogenerator|visual router|tts|ffmpeg|scene |visual asset|media generation/.test(value)) return 'media';
  if (/quality council|quality review|quality gate/.test(value)) return 'quality';
  if (/publish|publishing|schedule|youtube upload/.test(value)) return 'publishing';
  return 'system';
}

function entryStatus(level, message = '') {
  const text = String(message || '').toLowerCase();
  if (String(level).toLowerCase() === 'error' || / failed\b|failure\b|blocked\b/.test(text)) return 'failed';
  if (String(level).toLowerCase() === 'warn' || / warning\b|retry/.test(text)) return 'warning';
  if (/complete\b|completed\b|success\b|passed\b|published\b|scheduled\b/.test(text)) return 'completed';
  if (/waiting\b|empty\b|not_due\b|nothing scheduled/.test(text)) return 'waiting';
  if (/starting\b|generating\b|processing\b|running\b|using\b|fetching\b|selected\b|planned\b/.test(text)) return 'running';
  return 'info';
}

class ProcessMonitorService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, '..');
    this.logPath = options.logPath || path.join(this.rootDir, 'logs', 'combined.log');
    this.maxBytes = Math.max(65536, Math.min(4 * 1024 * 1024, Number(options.maxBytes || 1024 * 1024)));
  }

  async readTail() {
    let handle;
    try {
      handle = await fs.open(this.logPath, 'r');
      const stat = await handle.stat();
      const start = Math.max(0, stat.size - this.maxBytes);
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      if (length) await handle.read(buffer, 0, length, start);
      let text = buffer.toString('utf8');
      if (start > 0) {
        const firstBreak = text.indexOf('\n');
        if (firstBreak >= 0) text = text.slice(firstBreak + 1);
      }
      return text;
    } catch (error) {
      if (error && error.code === 'ENOENT') return '';
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  normalize(raw, index) {
    const level = clean(raw.level || 'info', 20).toLowerCase();
    const component = clean(raw.component || raw.service || 'System', 120);
    const message = redactText(clean(raw.message || raw.msg || 'Log event', 4000));
    const timestamp = raw.timestamp || raw.time || new Date().toISOString();
    const details = {};
    const allowed = ['error','status','stage','contentId','jobId','runId','scanId','scene','provider','model','durationMs','articleCount','clusterCount','actionableCount'];
    for (const key of allowed) {
      if (raw[key] !== undefined && raw[key] !== null) details[key] = redactText(clean(raw[key], 1000));
    }
    return {
      id: String(timestamp) + ':' + String(index),
      timestamp,
      level,
      component,
      stage: componentStage(component, message),
      status: entryStatus(level, message),
      message,
      details
    };
  }

  parse(text) {
    const rows = [];
    const lines = String(text || '').split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      try {
        const raw = JSON.parse(line);
        rows.push(this.normalize(raw, index));
      } catch (_error) {
        const message = redactText(clean(line, 4000));
        if (message) rows.push({
          id: 'plain:' + index, timestamp: null, level: 'info', component: 'Console',
          stage: componentStage('Console', message), status: entryStatus('info', message), message, details: {}
        });
      }
    });
    return rows;
  }

  summarize(entries) {
    const now = Date.now();
    const byComponent = new Map();
    for (const entry of entries) {
      const ts = new Date(entry.timestamp || 0).getTime();
      const current = byComponent.get(entry.component);
      if (!current || ts >= current.ts) byComponent.set(entry.component, { ts, entry });
    }
    const components = [...byComponent.values()].map(item => ({
      component: item.entry.component,
      stage: item.entry.stage,
      status: item.entry.status,
      level: item.entry.level,
      message: item.entry.message,
      timestamp: item.entry.timestamp,
      active: item.ts > 0 && now - item.ts <= 120000 && ['running','warning','info'].includes(item.entry.status)
    })).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    const stages = STAGES.map(stage => {
      const candidates = entries.filter(entry => entry.stage === stage);
      const latest = candidates[candidates.length - 1] || null;
      return {
        stage,
        status: latest ? latest.status : 'idle',
        component: latest ? latest.component : null,
        message: latest ? latest.message : null,
        timestamp: latest ? latest.timestamp : null
      };
    });

    return {
      errors: entries.filter(entry => entry.level === 'error').length,
      warnings: entries.filter(entry => entry.level === 'warn').length,
      activeComponents: components.filter(item => item.active).length,
      components,
      stages
    };
  }

  async snapshot(options = {}) {
    const limit = Math.max(20, Math.min(1000, Number(options.limit || 400)));
    const text = await this.readTail();
    let entries = this.parse(text);
    entries.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    if (entries.length > limit) entries = entries.slice(-limit);
    return {
      serverTime: new Date().toISOString(),
      logPath: path.relative(this.rootDir, this.logPath).replace(/\\/g, '/'),
      entries,
      summary: this.summarize(entries)
    };
  }
}

module.exports = { ProcessMonitorService, componentStage, entryStatus, redactText, STAGES };
