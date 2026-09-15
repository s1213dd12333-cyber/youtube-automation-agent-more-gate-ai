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
  if (index === -1) throw new Error(`Phase 11.7.1 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.7.1 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'environment-bible-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/environment-bible-v11.js');
  write('utils/environment-bible-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.7.1 persistent Environment Bible",
    "      `CREATE TABLE IF NOT EXISTS environment_bibles (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        version TEXT NOT NULL DEFAULT '11.7.1',",
    "        fingerprint TEXT NOT NULL,",
    "        environments TEXT NOT NULL DEFAULT '[]',",
    "        summary TEXT NOT NULL DEFAULT '{}',",
    "        prompt_context TEXT NOT NULL DEFAULT '',",
    "        created_at TEXT NOT NULL,",
    "        UNIQUE(production_id, fingerprint),",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_environment_bibles_production ON environment_bibles(production_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'Environment Bible table');

  const methods = [
    "  async saveEnvironmentBible(bible = {}) {",
    "    if (!bible.productionId || !bible.fingerprint) return null;",
    "    const id = bible.id || this.generateId('environment_bible');",
    "    const createdAt = bible.createdAt || new Date().toISOString();",
    "    await this.executeQuery(",
    "      `INSERT INTO environment_bibles (id, production_id, version, fingerprint, environments, summary, prompt_context, created_at)",
    "       VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "       ON CONFLICT(production_id, fingerprint) DO UPDATE SET",
    "        version = excluded.version, environments = excluded.environments, summary = excluded.summary, prompt_context = excluded.prompt_context`,",
    "      [id, bible.productionId, String(bible.version || '11.7.1'), bible.fingerprint, JSON.stringify(bible.environments || []),",
    "       JSON.stringify(bible.summary || {}), bible.promptContext || '', createdAt]",
    "    );",
    "    return this.getLatestEnvironmentBible(bible.productionId);",
    "  }",
    "",
    "  async getLatestEnvironmentBible(productionId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM environment_bibles WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId]",
    "    );",
    "    return this.parseEnvironmentBible(row);",
    "  }",
    "",
    "  async listEnvironmentBibles(productionId, limit = 20) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM environment_bibles WHERE production_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',",
    "      [productionId, Math.max(1, Math.min(100, Number(limit || 20)))]",
    "    );",
    "    return rows.map(row => this.parseEnvironmentBible(row));",
    "  }",
    "",
    "  parseEnvironmentBible(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, version: row.version || '11.7.1', fingerprint: row.fingerprint,",
    "      environments: JSON.parse(row.environments || '[]'), summary: JSON.parse(row.summary || '{}'),",
    "      promptContext: row.prompt_context || '', createdAt: row.created_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'Environment Bible DB methods');

  const loadAnchor = "    const cartoonQualityReport = await this.getLatestCartoonQualityReport(productionId);\n";
  s = replaceOnce(
    s,
    loadAnchor,
    loadAnchor + "    const environmentBible = await this.getLatestEnvironmentBible(productionId);\n",
    'load Environment Bible in production bundle'
  );
  s = replaceOnce(
    s,
    "      cartoonQualityReport,\n",
    "      cartoonQualityReport,\n      environmentBible,\n",
    'expose Environment Bible in production bundle'
  );
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CartoonBibleV11 } = require('./cartoon-bible-v11');\n",
    "const { CartoonBibleV11 } = require('./cartoon-bible-v11');\nconst { EnvironmentBibleV11 } = require('./environment-bible-v11');\n",
    'Environment Bible import'
  );
  s = replaceOnce(
    s,
    "    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n",
    "    this.cartoonBible = options.cartoonBible || new CartoonBibleV11({ logger: this.logger });\n    this.environmentBible = options.environmentBible || new EnvironmentBibleV11({ logger: this.logger });\n",
    'Environment Bible construction'
  );

  const block = [
    "    let environmentBible = null;",
    "    if (cartoonBible) {",
    "      const plannedEnvironmentBible = this.environmentBible.buildProductionBible(production, cartoonBible);",
    "      if (plannedEnvironmentBible) {",
    "        const existingEnvironmentBible = await this.db.getLatestEnvironmentBible(production.id);",
    "        environmentBible = existingEnvironmentBible;",
    "        if (!existingEnvironmentBible || existingEnvironmentBible.fingerprint !== plannedEnvironmentBible.fingerprint) {",
    "          environmentBible = await this.db.saveEnvironmentBible({ ...plannedEnvironmentBible, productionId: production.id });",
    "          this.logger.info(`Environment Bible v11.7.1 persisted for ${production.id}: ${environmentBible.environments.length} environment(s), categories=${environmentBible.summary?.categories?.join(',') || 'none'}.`);",
    "        }",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'persist Environment Bible before visual planning');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderEnvironmentBible(bible) {",
    "  if (!bible || !Array.isArray(bible.environments) || !bible.environments.length) return '';",
    "  const cards = bible.environments.map(environment => {",
    "    const materials = Array.isArray(environment.materials) ? environment.materials.join(' / ') : '';",
    "    const elements = Array.isArray(environment.signatureElements) ? environment.signatureElements.join(', ') : '';",
    "    return `<div class=\"quality-check pass\"><strong>${escapeHTML(environment.name || environment.environmentId)} · ${escapeHTML(environment.category || '')}</strong><br><small>ID: ${escapeHTML(environment.environmentId || '')}<br>Construction: ${escapeHTML(environment.construction || '')}<br>Materials: ${escapeHTML(materials)}<br>Signature: ${escapeHTML(elements)}<br>Specificity: ${Number(environment.specificity || 0)}/100 · master frame: pending 11.7.3</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel environment-bible-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">ENVIRONMENT BIBLE V${escapeHTML(bible.version || '11.7.1')}</p><h3>Persistent location identity</h3></div></div><p>Architecture, materials, palette, layout and signature elements are now persistent data. Prop Lock starts in 11.7.2; canonical master frames start in 11.7.3.</p><div class=\"quality-grid\">${cards}</div></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Environment Bible dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderCartoonBible(item.cartoonBible)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderCartoonBible(item.cartoonBible)}\n        ${renderEnvironmentBible(item.environmentBible)}\n        ${renderCartoonShotPlan(item)}\n",
    'show Environment Bible after Character Bible'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:environment-bible'] = 'node ../bootstrap/verify-phase11-environment-bible.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('ENVIRONMENT_BIBLE_ENABLED=')) {
    env += `\n# Phase 11.7.1 — persistent Environment Bible.\nENVIRONMENT_BIBLE_ENABLED=true\nENVIRONMENT_BIBLE_MAX_ENVIRONMENTS=12\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.7.1 ativa: Environment Bible persistente com identidade de arquitetura, materiais, paleta, layout e elementos assinatura. Master frames e Prop Lock permanecem para 11.7.2/11.7.3.');
