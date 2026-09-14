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
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'quality-agents-v9.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/quality-agents-v9.js');
  write('utils/quality-agents-v9.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 9 deterministic editorial quality reports",
    "      `CREATE TABLE IF NOT EXISTS quality_agent_reports (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        version INTEGER NOT NULL DEFAULT 9,",
    "        fingerprint TEXT NOT NULL,",
    "        status TEXT NOT NULL,",
    "        overall_score INTEGER NOT NULL DEFAULT 0,",
    "        agents TEXT NOT NULL DEFAULT '[]',",
    "        blocking_findings TEXT NOT NULL DEFAULT '[]',",
    "        repair_plan TEXT NOT NULL DEFAULT '[]',",
    "        created_at TEXT DEFAULT CURRENT_TIMESTAMP,",
    "        UNIQUE(production_id, fingerprint),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_quality_agent_reports_production ON quality_agent_reports(production_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Phase 9 quality report table');

  const methods = [
    "  async saveQualityAgentReport(report = {}) {",
    "    const id = report.id || this.generateId('quality_v9');",
    "    await this.executeQuery(",
    "      `INSERT INTO quality_agent_reports (",
    "        id, production_id, version, fingerprint, status, overall_score, agents, blocking_findings, repair_plan, created_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, fingerprint) DO UPDATE SET",
    "        version = excluded.version, status = excluded.status, overall_score = excluded.overall_score,",
    "        agents = excluded.agents, blocking_findings = excluded.blocking_findings, repair_plan = excluded.repair_plan,",
    "        created_at = excluded.created_at`,",
    "      [",
    "        id, report.productionId, Number(report.version || 9), report.fingerprint || '', report.status || 'warning',",
    "        Number(report.overallScore || 0), JSON.stringify(report.agents || []), JSON.stringify(report.blockingFindings || []),",
    "        JSON.stringify(report.repairPlan || []), report.createdAt || new Date().toISOString()",
    "      ]",
    "    );",
    "    return this.getLatestQualityAgentReport(report.productionId);",
    "  }",
    "",
    "  async getLatestQualityAgentReport(productionId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM quality_agent_reports WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId]",
    "    );",
    "    return this.parseQualityAgentReport(row);",
    "  }",
    "",
    "  async listQualityAgentReports(productionId, limit = 20) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM quality_agent_reports WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',",
    "      [productionId, Math.max(1, Math.min(100, Number(limit || 20)))]",
    "    );",
    "    return rows.map(row => this.parseQualityAgentReport(row));",
    "  }",
    "",
    "  parseQualityAgentReport(row) {",
    "    if (!row) return null;",
    "    return {",
    "      ...row, productionId: row.production_id, version: Number(row.version || 9), fingerprint: row.fingerprint,",
    "      overallScore: Number(row.overall_score || 0), agents: JSON.parse(row.agents || '[]'),",
    "      blockingFindings: JSON.parse(row.blocking_findings || '[]'), repairPlan: JSON.parse(row.repair_plan || '[]'),",
    "      createdAt: row.created_at, passed: row.status !== 'blocked'",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 9 quality report DB methods');

  s = replaceOnce(
    s,
    "    const discoverability = await this.getLatestDiscoverabilityAudit(productionId, 'youtube');\n    const scenes = await this.listProductionScenes(productionId);\n",
    "    const discoverability = await this.getLatestDiscoverabilityAudit(productionId, 'youtube');\n    const qualityAgentReport = await this.getLatestQualityAgentReport(productionId);\n    const scenes = await this.listProductionScenes(productionId);\n",
    'load latest Phase 9 report with production bundle'
  );
  s = replaceOnce(
    s,
    "      discoverability,\n      scenes,\n",
    "      discoverability,\n      qualityAgentReport,\n      scenes,\n",
    'expose Phase 9 report in production bundle'
  );
  write(rel, s);
}

function patchOperator() {
  const rel = 'utils/operator-service.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { Logger } = require('./logger');\n",
    "const { Logger } = require('./logger');\nconst { QualityAgentsV9 } = require('./quality-agents-v9');\n",
    'Quality Agents import'
  );
  s = replaceOnce(
    s,
    "    this.logger = new Logger('OperatorService');\n",
    "    this.logger = new Logger('OperatorService');\n    this.qualityAgents = new QualityAgentsV9(db, { logger: this.logger });\n",
    'Quality Agents construction'
  );

  const qualityBlock = [
    "    // Phase 9: reload the latest persisted bundle so quality agents see current scenes, provenance and evidence.",
    "    let qualityInput = production;",
    "    if (production?.id && this.db?.getProductionBundle) {",
    "      const latest = await this.db.getProductionBundle(production.id).catch(() => null);",
    "      if (latest) qualityInput = { ...production, ...latest };",
    "    }",
    "    const qualityAgents = await this.qualityAgents.review(qualityInput);",
    "    for (const agent of qualityAgents.agents) {",
    "      const top = agent.findings.find(item => item.blocking) || agent.findings[0];",
    "      checks.push(this.check(",
    "        `quality_${agent.id}`, agent.passed,",
    "        `${agent.name}: ${agent.score}/100${top ? ` · ${top.message}` : ' · no blocking findings'}`,",
    "        agent.blocking",
    "      ));",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, '    const blockingFailures = checks.filter(check => check.blocking && !check.passed);\n', qualityBlock, 'Phase 9 quality agents before approval result');
  s = replaceOnce(
    s,
    "      blockingFailures: blockingFailures.map(check => check.id),\n      checks\n",
    "      blockingFailures: blockingFailures.map(check => check.id),\n      qualityAgents,\n      checks\n",
    'return Phase 9 quality report from gate'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderQualityAgentReport(report) {",
    "  if (!report || !Array.isArray(report.agents) || !report.agents.length) return '';",
    "  const blockers = Array.isArray(report.blockingFindings) ? report.blockingFindings.length : 0;",
    "  const cards = report.agents.map(agent => {",
    "    const findings = Array.isArray(agent.findings) ? agent.findings : [];",
    "    const next = findings.find(item => item.blocking) || findings[0];",
    "    return `<div class=\"quality-check ${agent.passed ? 'pass' : 'fail'}\"><strong>${escapeHTML(agent.name)} · ${escapeHTML(agent.score)}/100</strong>${next ? `<br><small>${escapeHTML(next.message)}${next.remediation ? ` · Next: ${escapeHTML(next.remediation)}` : ''}</small>` : ''}</div>`;",
    "  }).join('');",
    "  return `<section class=\"callout quality-agent-report\"><div class=\"meta-line\"><strong>QUALITY AGENTS V${escapeHTML(report.version || 9)}</strong> · ${escapeHTML(report.overallScore)}/100 · ${escapeHTML(report.status || 'unknown')}${blockers ? ` · ${blockers} blocker${blockers === 1 ? '' : 's'}` : ''}</div><div class=\"quality-grid\">${cards}</div></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Quality Agents dashboard renderer');
  s = replaceOnce(
    s,
    "            <div class=\"quality-grid\">${(item.qualityChecks || []).map(check => `<div class=\"quality-check ${check.passed ? 'pass' : 'fail'}\">${check.passed ? '✓' : '×'} ${escapeHTML(check.message)}</div>`).join('') || '<div class=\"quality-check\">No quality results recorded.</div>'}</div>\n",
    "            ${renderQualityAgentReport(item.qualityAgentReport)}\n            <div class=\"quality-grid\">${(item.qualityChecks || []).map(check => `<div class=\"quality-check ${check.passed ? 'pass' : 'fail'}\">${check.passed ? '✓' : '×'} ${escapeHTML(check.message)}</div>`).join('') || '<div class=\"quality-check\">No quality results recorded.</div>'}</div>\n",
    'render Quality Agents before legacy checks'
  );
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:quality-agents'] = 'node ../bootstrap/verify-phase9-quality-agents.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyService();
patchDatabase();
patchOperator();
patchDashboard();
patchPackage();

console.log('Phase 9 Quality Agents installed: retention, thumbnail, SEO, visual and fact review with persistent reports and approval gates.');
