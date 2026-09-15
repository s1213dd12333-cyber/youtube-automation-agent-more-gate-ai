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
  if (index === -1) throw new Error(`Phase 11.10.3 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.3 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/canonical-world-object-assets-v11.js', template('canonical-world-object-assets-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-world-object-assets-db-tables-v11.txt')}\n`, 'Canonical World Object Asset table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-world-object-assets-db-methods-v11.txt')}\n`, 'Canonical World Object Asset DB methods');
  const loadAnchor = "    const persistentWorldObjectResolutions = await this.listPersistentWorldObjectResolutions(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentWorldObjectAssets = await this.listProductionPersistentWorldObjectAssets(productionId);\n", 'load object assets in production bundle');
  s = replaceOnce(s, "      persistentWorldObjectResolutions,\n", "      persistentWorldObjectResolutions,\n      persistentWorldObjectAssets,\n", 'expose object assets in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(s,
    "const { PersistentWorldObjectRegistryV11 } = require('./persistent-world-object-registry-v11');\n",
    "const { PersistentWorldObjectRegistryV11 } = require('./persistent-world-object-registry-v11');\nconst { CanonicalWorldObjectAssetRegistryV11 } = require('./canonical-world-object-assets-v11');\n",
    'Canonical World Object Asset import');
  s = replaceOnce(s,
    "    this.persistentWorldObjects = options.persistentWorldObjects || new PersistentWorldObjectRegistryV11(db, { logger: this.logger });\n",
    "    this.persistentWorldObjects = options.persistentWorldObjects || new PersistentWorldObjectRegistryV11(db, { logger: this.logger });\n    this.canonicalWorldObjectAssets = options.canonicalWorldObjectAssets || new CanonicalWorldObjectAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Canonical World Object Asset construction');

  const block = [
    "    let canonicalWorldObjectAssetPlan = null;",
    "    if (persistentWorldObjectPlan?.active) {",
    "      const canonicalObjectLocks = propLockPlan?.locks || await this.db.listPropLocks(production.id);",
    "      canonicalWorldObjectAssetPlan = await this.canonicalWorldObjectAssets.ensureProductionAssets(production, environmentBible, canonicalObjectLocks, persistentWorldObjectPlan);",
    "      if (canonicalWorldObjectAssetPlan?.active) this.logger.info(`Canonical World Object Assets v11.10.3: ready=${canonicalWorldObjectAssetPlan.summary.ready}, reused=${canonicalWorldObjectAssetPlan.summary.reused}, rejected=${canonicalWorldObjectAssetPlan.summary.rejected}, ambiguous=${canonicalWorldObjectAssetPlan.summary.ambiguous}, conflicts=${canonicalWorldObjectAssetPlan.summary.conflicts}.`);",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    let temporaryLocationStatePlan = null;\n", block, 'promote canonical object assets before temporary scene state');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentWorldObjectAssets(item) {",
    "  if (!Array.isArray(item?.persistentWorldObjectAssets) || !item.persistentWorldObjectAssets.length) return '';",
    "  const cards = item.persistentWorldObjectAssets.map(asset => {",
    "    const provider = [asset.provider, asset.model].filter(Boolean).join(' / ') || 'unknown provider';",
    "    return `<div class=\"quality-check pass\"><strong>${escapeHTML(asset.objectId || 'object')} · ${escapeHTML(asset.assetRole || 'object_reference')}</strong><br><small>CANONICAL READY · ${escapeHTML(provider)}<br>sha256: ${escapeHTML((asset.assetSha256 || '').slice(0, 20))}<br>origin: ${escapeHTML(asset.sourceProductionId || 'unknown')} · ${escapeHTML(asset.sourceKind || '')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-world-object-assets-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CANONICAL OBJECT ASSETS V11.10.3</p><h3>Immutable provider-backed object references</h3></div></div><p>${item.persistentWorldObjectAssets.length} canonical object reference(s) available to this production. Origin hash and provenance are preserved across later videos.</p><div class=\"quality-grid\">${cards}</div><small>Only explicitly canonical, provider-backed references are promoted. Local/generic fallbacks and unbound declarations never become canonical assets.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Canonical World Object Asset dashboard renderer');
  s = replaceOnce(s,
    "        ${renderPersistentWorldObjectResolutions(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderPersistentWorldObjectResolutions(item)}\n        ${renderPersistentWorldObjectAssets(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show canonical object assets after resolver');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:canonical-world-object-assets'] = 'node ../bootstrap/verify-phase11-canonical-world-object-assets.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('CANONICAL_WORLD_OBJECT_ASSETS_ENABLED=')) env += `\n# Phase 11.10.3 — immutable canonical visual references for persistent world objects.\nCANONICAL_WORLD_OBJECT_ASSETS_ENABLED=true\n# Require explicit provider provenance; generic/local fallback files never become canonical object references.\nCANONICAL_WORLD_OBJECT_ASSET_REQUIRE_PROVIDER=true\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.3 ativa: Canonical Object Assets provider-backed com provenance/hash imutaveis e rejeicao fail-closed de fallback local ou binding ambiguo.');
