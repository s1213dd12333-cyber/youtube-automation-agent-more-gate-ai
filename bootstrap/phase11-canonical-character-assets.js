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
  if (index === -1) throw new Error(`Phase 11.11.3 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.3 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/canonical-character-assets-v11.js', template('canonical-character-assets-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-character-assets-db-tables-v11.txt')}\n`, 'Canonical Character Asset table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-character-assets-db-methods-v11.txt')}\n`, 'Canonical Character Asset DB methods');
  const loadAnchor = "    const persistentCharacterResolutions = await this.listPersistentCharacterResolutions(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentCharacterAssets = await this.listProductionPersistentCharacterAssets(productionId);\n", 'load character assets in production bundle');
  s = replaceOnce(s, "      persistentCharacterResolutions,\n", "      persistentCharacterResolutions,\n      persistentCharacterAssets,\n", 'expose character assets in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(
    s,
    "const { PersistentCharacterRegistryV11 } = require('./persistent-character-registry-v11');\n",
    "const { PersistentCharacterRegistryV11 } = require('./persistent-character-registry-v11');\nconst { CanonicalCharacterAssetRegistryV11 } = require('./canonical-character-assets-v11');\n",
    'Canonical Character Asset import'
  );
  s = replaceOnce(
    s,
    "    this.persistentCharacters = options.persistentCharacters || new PersistentCharacterRegistryV11(db, { logger: this.logger });\n",
    "    this.persistentCharacters = options.persistentCharacters || new PersistentCharacterRegistryV11(db, { logger: this.logger });\n    this.canonicalCharacterAssets = options.canonicalCharacterAssets || new CanonicalCharacterAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    'Canonical Character Asset construction'
  );

  const block = [
    "    let canonicalCharacterAssetPlan = null;",
    "    if (persistentCharacterPlan?.active) {",
    "      canonicalCharacterAssetPlan = await this.canonicalCharacterAssets.ensureProductionAssets(production, cartoonBible, persistentCharacterPlan);",
    "      if (canonicalCharacterAssetPlan?.active) this.logger.info(`Canonical Character Assets v11.11.3: ready=${canonicalCharacterAssetPlan.summary.ready}, reused=${canonicalCharacterAssetPlan.summary.reused}, rejected=${canonicalCharacterAssetPlan.summary.rejected}, ambiguous=${canonicalCharacterAssetPlan.summary.ambiguous}, conflicts=${canonicalCharacterAssetPlan.summary.conflicts}.`);",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'promote canonical character assets before visual planning');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentCharacterAssets(item) {",
    "  if (!Array.isArray(item?.persistentCharacterAssets) || !item.persistentCharacterAssets.length) return '';",
    "  const cards = item.persistentCharacterAssets.map(asset => {",
    "    const provider = [asset.provider, asset.model].filter(Boolean).join(' / ') || 'unknown provider';",
    "    return `<div class=\"quality-check pass\"><strong>${escapeHTML(asset.characterId || 'character')} · ${escapeHTML(asset.assetRole || 'character_reference')}</strong><br><small>CANONICAL READY · ${escapeHTML(provider)}<br>sha256: ${escapeHTML((asset.assetSha256 || '').slice(0, 20))}<br>origin: ${escapeHTML(asset.sourceProductionId || 'unknown')} · ${escapeHTML(asset.sourceKind || '')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-character-assets-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CANONICAL CHARACTER ASSETS V11.11.3</p><h3>Immutable provider-backed character references</h3></div></div><p>${item.persistentCharacterAssets.length} canonical character reference(s) available to this production. Origin hash and provenance remain immutable across later episodes.</p><div class=\"quality-grid\">${cards}</div><small>Only explicit provider-backed canonical references are promoted. Local/generic fallbacks and unresolved/ambiguous character declarations never become canonical assets.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Canonical Character Asset dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderPersistentCharacterResolutions(item)}\n",
    "        ${renderPersistentCharacterResolutions(item)}\n        ${renderPersistentCharacterAssets(item)}\n",
    'show canonical character assets after resolver'
  );
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:canonical-character-assets'] = 'node ../bootstrap/verify-phase11-canonical-character-assets.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('CANONICAL_CHARACTER_ASSETS_ENABLED=')) env += `\n# Phase 11.11.3 — immutable canonical visual references for persistent characters.\nCANONICAL_CHARACTER_ASSETS_ENABLED=true\n# Require explicit provider provenance; generic/local fallback files never become canonical character references.\nCANONICAL_CHARACTER_ASSET_REQUIRE_PROVIDER=true\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.11.3 ativa: Canonical Character Assets provider-backed com provenance/hash imutaveis e rejeicao fail-closed de fallback local ou binding ambiguo.');
