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
  const template = path.join(root, 'bootstrap', 'templates', 'cartoon-quality-gate-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cartoon-quality-gate-v11.js');
  write('utils/cartoon-quality-gate-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.6 persisted cartoon-specific quality gate",
    "      `CREATE TABLE IF NOT EXISTS cartoon_quality_reports (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.6',",
    "        fingerprint TEXT NOT NULL,",
    "        status TEXT NOT NULL,",
    "        score INTEGER NOT NULL DEFAULT 0,",
    "        metrics TEXT NOT NULL DEFAULT '{}',",
    "        findings TEXT NOT NULL DEFAULT '[]',",
    "        blockers TEXT NOT NULL DEFAULT '[]',",
    "        created_at TEXT NOT NULL,",
    "        UNIQUE(production_id, fingerprint),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_cartoon_quality_reports_prod ON cartoon_quality_reports(production_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Phase 11.6 cartoon quality table');

  const methods = [
    "  async saveCartoonQualityReport(report = {}) {",
    "    if (!report.productionId || !report.fingerprint) return null;",
    "    const id = report.id || this.generateId('cartoon_quality');",
    "    await this.executeQuery(",
    "      `INSERT INTO cartoon_quality_reports (id, production_id, version, fingerprint, status, score, metrics, findings, blockers, created_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, fingerprint) DO UPDATE SET",
    "        version = excluded.version, status = excluded.status, score = excluded.score, metrics = excluded.metrics,",
    "        findings = excluded.findings, blockers = excluded.blockers, created_at = excluded.created_at`,",
    "      [id, report.productionId, String(report.version || '11.6'), report.fingerprint, report.status || 'warning',",
    "       Number(report.score || 0), JSON.stringify(report.metrics || {}), JSON.stringify(report.findings || []),",
    "       JSON.stringify(report.blockers || []), report.createdAt || new Date().toISOString()]",
    "    );",
    "    return this.getLatestCartoonQualityReport(report.productionId);",
    "  }",
    "",
    "  async getLatestCartoonQualityReport(productionId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM cartoon_quality_reports WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId]",
    "    );",
    "    return this.parseCartoonQualityReport(row);",
    "  }",
    "",
    "  async listCartoonQualityReports(productionId, limit = 20) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM cartoon_quality_reports WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',",
    "      [productionId, Math.max(1, Math.min(100, Number(limit || 20)))]",
    "    );",
    "    return rows.map(row => this.parseCartoonQualityReport(row));",
    "  }",
    "",
    "  parseCartoonQualityReport(row) {",
    "    if (!row) return null;",
    "    return {",
    "      ...row, productionId: row.production_id, version: row.version || '11.6', score: Number(row.score || 0),",
    "      metrics: JSON.parse(row.metrics || '{}'), findings: JSON.parse(row.findings || '[]'), blockers: JSON.parse(row.blockers || '[]'),",
    "      fingerprint: row.fingerprint, createdAt: row.created_at, passed: row.status !== 'blocked'",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Phase 11.6 quality DB methods');
  s = replaceOnce(
    s,
    "    const motionScenes = await this.listCartoonMotionScenes(productionId);\n",
    "    const motionScenes = await this.listCartoonMotionScenes(productionId);\n    const cartoonQualityReport = await this.getLatestCartoonQualityReport(productionId);\n",
    'load Phase 11.6 cartoon quality report'
  );
  s = replaceOnce(s, "      motionScenes,\n", "      motionScenes,\n      cartoonQualityReport,\n", 'expose Phase 11.6 cartoon quality report');
  write(rel, s);
}

function patchQualityAgents() {
  const rel = 'utils/quality-agents-v9.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const crypto = require('crypto');\n",
    "const crypto = require('crypto');\nconst { evaluateCartoonQualityV11 } = require('./cartoon-quality-gate-v11');\n",
    'Phase 11.6 cartoon gate import'
  );
  s = replaceOnce(
    s,
    "  const duplicateAssets = paths.length - new Set(paths).size;\n  const findings = [];\n  let score = 100;\n",
    "  const duplicateAssets = paths.length - new Set(paths).size;\n  const cartoonQuality = evaluateCartoonQualityV11(production);\n  const findings = [];\n  let score = 100;\n",
    'evaluate Phase 11.6 inside Visual Quality Agent'
  );
  s = replaceOnce(
    s,
    "  return finalizeAgent('visual', 'Visual Quality Agent', score, findings, {\n    sceneCount: scenes.length, missingAssets: missingAssets.length, rejectedBriefs,\n    averageSpecificity: avgSpecificity === null ? null : Math.round(avgSpecificity),\n    averageGenericAiRisk: avgGenericRisk === null ? null : Math.round(avgGenericRisk),\n    sourceScenes: sourceCount, localRendererScenes: localCount, unresolvedRights: unresolvedRights.length, duplicateAssets\n  }, 60);\n",
    "  if (cartoonQuality.active) {\n    score = Math.min(score, cartoonQuality.score);\n    findings.push(...cartoonQuality.findings);\n  }\n\n  const result = finalizeAgent('visual', 'Visual Quality Agent', score, findings, {\n    sceneCount: scenes.length, missingAssets: missingAssets.length, rejectedBriefs,\n    averageSpecificity: avgSpecificity === null ? null : Math.round(avgSpecificity),\n    averageGenericAiRisk: avgGenericRisk === null ? null : Math.round(avgGenericRisk),\n    sourceScenes: sourceCount, localRendererScenes: localCount, unresolvedRights: unresolvedRights.length, duplicateAssets,\n    cartoonQualityActive: cartoonQuality.active, cartoonQualityScore: cartoonQuality.active ? cartoonQuality.score : null,\n    cartoonQualityMetrics: cartoonQuality.active ? cartoonQuality.metrics : null\n  }, 60);\n  if (cartoonQuality.active) result.cartoonQuality = cartoonQuality;\n  return result;\n",
    'merge Phase 11.6 into Visual Quality Agent'
  );
  s = replaceOnce(
    s,
    "      provenance: production.provenance || {}, visualManifest: production.assets?.sceneManifest || {}\n",
    "      provenance: production.provenance || {}, visualManifest: production.assets?.sceneManifest || {},\n      cartoonBible: production.cartoonBible ? { version: production.cartoonBible.version, mode: production.cartoonBible.mode, fingerprint: production.cartoonBible.fingerprint } : null,\n      shots: (production.shots || []).map(item => ({ id: item.id, fingerprint: item.fingerprint, status: item.status, duration: item.duration })),\n      keyframes: (production.keyframes || []).map(item => ({ id: item.id, fingerprint: item.fingerprint, status: item.status, assetPath: item.assetPath, generatedAt: item.generatedAt })),\n      continuityChecks: (production.continuityChecks || []).map(item => ({ keyframeId: item.keyframe_id || item.keyframeId, attempt: item.attempt, status: item.status, score: item.score, threshold: item.threshold })),\n      motionSegments: (production.motionSegments || []).map(item => ({ shotId: item.shotId, fingerprint: item.fingerprint, status: item.status, outputPath: item.outputPath })),\n      motionScenes: (production.motionScenes || []).map(item => ({ sceneId: item.sceneId, fingerprint: item.fingerprint, status: item.status, outputPath: item.outputPath })),\n      cartoonQualityFingerprint: evaluateCartoonQualityV11(production).fingerprint\n",
    'include Phase 11 state in Phase 9 fingerprint'
  );
  s = replaceOnce(
    s,
    "    const agents = [\n      retentionAgent(production), thumbnailAgent(production), seoAgent(production), visualAgent(production), factAgent(production)\n    ];\n",
    "    const visualReview = visualAgent(production);\n    const cartoonQuality = visualReview.cartoonQuality || null;\n    const agents = [\n      retentionAgent(production), thumbnailAgent(production), seoAgent(production), visualReview, factAgent(production)\n    ];\n",
    'retain five Phase 9 agents while exposing Phase 11.6 report'
  );
  s = replaceOnce(s, "      weights: { ...WEIGHTS },\n      agents,\n", "      weights: { ...WEIGHTS },\n      cartoonQuality,\n      agents,\n", 'embed Phase 11.6 report in quality report');
  s = replaceOnce(
    s,
    "    if (this.db?.saveQualityAgentReport && production.id) await this.db.saveQualityAgentReport(report);\n",
    "    if (this.db?.saveCartoonQualityReport && cartoonQuality?.active && production.id) await this.db.saveCartoonQualityReport(cartoonQuality);\n    if (this.db?.saveQualityAgentReport && production.id) await this.db.saveQualityAgentReport(report);\n",
    'persist Phase 11.6 report with Phase 9 review'
  );
  write(rel, s);
}

function patchPublicationGate() {
  const rel = 'utils/autonomy-observability-v10.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const crypto = require('crypto');\n",
    "const crypto = require('crypto');\nconst { evaluateCartoonQualityV11 } = require('./cartoon-quality-gate-v11');\n",
    'Phase 11.6 publication gate import'
  );
  const qualityGateAnchor = "  if (!bundle.qualityAgentReport || bundle.qualityAgentReport.status === 'blocked') blockers.push('quality_agents');\n";
  s = replaceOnce(
    s,
    qualityGateAnchor,
    qualityGateAnchor +
      "  const currentCartoonQuality = evaluateCartoonQualityV11(bundle);\n" +
      "  if (currentCartoonQuality.active) {\n" +
      "    if (!bundle.cartoonQualityReport) blockers.push('cartoon_quality_required');\n" +
      "    else if (bundle.cartoonQualityReport.fingerprint !== currentCartoonQuality.fingerprint) blockers.push('cartoon_quality_stale');\n" +
      "    else if (bundle.cartoonQualityReport.status === 'blocked') blockers.push('cartoon_quality');\n" +
      "  }\n",
    'Phase 11.6 fail-closed publication blockers after mandatory Phase 9 gate'
  );
  s = replaceOnce(
    s,
    "      qualityStatus: bundle.qualityAgentReport?.status || null,\n",
    "      qualityStatus: bundle.qualityAgentReport?.status || null,\n      cartoonQualityStatus: bundle.cartoonQualityReport?.status || null,\n",
    'expose Phase 11.6 publication quality status'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCartoonQualityGate(report) {",
    "  if (!report) return '';",
    "  const findings = Array.isArray(report.findings) ? report.findings : [];",
    "  const blockers = Array.isArray(report.blockers) ? report.blockers : [];",
    "  const metrics = report.metrics || {};",
    "  const cards = findings.slice(0, 18).map(item => `<div class=\"quality-check ${item.blocking ? 'fail' : 'pass'}\"><strong>${escapeHTML(item.severity || '')} · ${escapeHTML(item.id || '')}</strong><br><small>${escapeHTML(item.message || '')}${item.remediation ? `<br>Next: ${escapeHTML(item.remediation)}` : ''}</small></div>`).join('');",
    "  return `<section class=\"panel cartoon-quality-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CARTOON QUALITY GATE V11.6</p><h3>${escapeHTML(report.score)}/100 · ${escapeHTML(report.status || 'unknown')}</h3></div></div><p>${blockers.length} blocker(s) · ${escapeHTML(metrics.sceneCount || 0)} scenes · ${escapeHTML(metrics.shotCount || 0)} shots · ${escapeHTML(metrics.keyframeCount || 0)} keyframes · continuity ${metrics.averageContinuityScore == null ? 'n/a' : Math.round(Number(metrics.averageContinuityScore) * 100) + '%'}</p>${cards ? `<div class=\"quality-grid\">${cards}</div>` : '<div class=\"quality-check pass\">No cartoon-specific findings.</div>'}<small>Deterministic structural/continuity/motion/duplicate-frame gate. Child-safety lexical screening is conservative and does not replace human review.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Phase 11.6 dashboard quality gate renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonMotion(item)}\n        ${renderSceneEditor(item, canReview)}\n",
    "        ${renderCartoonMotion(item)}\n        ${renderCartoonQualityGate(item.cartoonQualityReport || item.qualityAgentReport?.cartoonQuality)}\n        ${renderSceneEditor(item, canReview)}\n",
    'show Phase 11.6 after motion'
  );
  write(rel, s);
}

function patchPackage() {
  const rel = 'package.json';
  const pkg = JSON.parse(read(rel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:cartoon-quality'] = 'node ../bootstrap/verify-phase11-cartoon-quality.js';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

copyService();
patchDatabase();
patchQualityAgents();
patchPublicationGate();
patchDashboard();
patchPackage();

console.log('FASE 11.6 ativa: Cartoon Quality Gate integrado ao Visual Quality Agent, approval gate, Review Studio e relatorios persistentes.');
