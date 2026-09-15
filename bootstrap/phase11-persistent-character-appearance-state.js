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
  if (index === -1) throw new Error(`Phase 11.11.4 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.4 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/persistent-character-appearance-state-v11.js', template('persistent-character-appearance-state-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-character-appearance-state-db-tables-v11.txt')}\n`, 'Persistent Character Appearance State table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-character-appearance-state-db-methods-v11.txt')}\n`, 'Persistent Character Appearance State DB methods');
  const loadAnchor = "    const persistentCharacterAssets = await this.listProductionPersistentCharacterAssets(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentCharacterAppearanceStates = await this.listProductionPersistentCharacterAppearanceStates(productionId);\n", 'load character appearance states in production bundle');
  s = replaceOnce(s, "      persistentCharacterAssets,\n", "      persistentCharacterAssets,\n      persistentCharacterAppearanceStates,\n", 'expose character appearance states in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(
    s,
    "const { CanonicalCharacterAssetRegistryV11 } = require('./canonical-character-assets-v11');\n",
    "const { CanonicalCharacterAssetRegistryV11 } = require('./canonical-character-assets-v11');\nconst { PersistentCharacterAppearanceStateLayerV11 } = require('./persistent-character-appearance-state-v11');\n",
    'Persistent Character Appearance State import'
  );
  s = replaceOnce(
    s,
    "    this.canonicalCharacterAssets = options.canonicalCharacterAssets || new CanonicalCharacterAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.canonicalCharacterAssets = options.canonicalCharacterAssets || new CanonicalCharacterAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n    this.persistentCharacterAppearanceStates = options.persistentCharacterAppearanceStates || new PersistentCharacterAppearanceStateLayerV11(db, { logger: this.logger });\n",
    'Persistent Character Appearance State construction'
  );

  const block = [
    "    let persistentCharacterAppearanceStatePlan = null;",
    "    if (persistentCharacterPlan?.active) {",
    "      persistentCharacterAppearanceStatePlan = await this.persistentCharacterAppearanceStates.ensureProductionStates(production, cartoonBible, persistentCharacterPlan);",
    "      if (persistentCharacterAppearanceStatePlan?.active) this.logger.info(`Persistent Character Appearance State v11.11.4: active=${persistentCharacterAppearanceStatePlan.summary.active}, neutral=${persistentCharacterAppearanceStatePlan.summary.neutral}, inherited=${persistentCharacterAppearanceStatePlan.summary.inherited}, conflicts=${persistentCharacterAppearanceStatePlan.summary.conflicts}, ambiguous=${persistentCharacterAppearanceStatePlan.summary.ambiguous}.`);",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    if (!scenes.length || scriptChanged) {\n", block, 'apply character wardrobe/appearance state before visual planning');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentCharacterAppearanceStates(item) {",
    "  if (!Array.isArray(item?.persistentCharacterAppearanceStates) || !item.persistentCharacterAppearanceStates.length) return '';",
    "  const inherited = item.persistentCharacterAppearanceStates.filter(row => row.inherited === true).length;",
    "  const conflicts = item.persistentCharacterAppearanceStates.filter(row => row.status === 'conflict').length;",
    "  const cards = item.persistentCharacterAppearanceStates.map(row => {",
    "    const details = [row.wardrobe, row.footwear, row.hairState, row.condition, row.cleanliness, row.ageAppearance, ...(row.injuries || []), ...(row.carriedItems || []), ...(row.temporaryAccessories || []), ...(row.appearanceNotes || []), ...(row.storyState || [])].filter(Boolean);",
    "    const cls = row.status === 'conflict' ? 'fail' : (row.status === 'active' ? 'pass' : '');",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(row.characterId || 'character')} · ${escapeHTML(row.status || 'neutral')}</strong><br><small>${escapeHTML(row.persistence || 'scene')}${row.inherited ? ' · inherited durable state' : ''}<br>${escapeHTML(details.join(' · ') || 'neutral appearance state')}<br>state: ${escapeHTML((row.stateFingerprint || '').slice(0, 16))}${(row.conflicts || []).length ? `<br>conflicts: ${escapeHTML((row.conflicts || []).join(', '))}` : ''}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-character-appearance-state-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">WARDROBE / APPEARANCE STATE V11.11.4</p><h3>Mutable character appearance without canonical identity drift</h3></div></div><p>${item.persistentCharacterAppearanceStates.length} appearance state layer(s) · ${inherited} inherited durable · ${conflicts} conflict. Scene state expires; until_changed state carries forward only when explicitly durable.</p><div class=\"quality-grid\">${cards}</div><small>Wardrobe, condition, injuries, carried items and temporary accessories are overlays. They never rewrite characterId, canonical fingerprint or the 11.11.3 character_reference.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Persistent Character Appearance State dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderPersistentCharacterAssets(item)}\n",
    "        ${renderPersistentCharacterAssets(item)}\n        ${renderPersistentCharacterAppearanceStates(item)}\n",
    'show character appearance state after canonical character assets'
  );
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-character-appearance-state'] = 'node ../bootstrap/verify-phase11-persistent-character-appearance-state.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_CHARACTER_APPEARANCE_STATES_ENABLED=')) env += `\n# Phase 11.11.4 — mutable wardrobe / appearance state overlays for persistent characters.\nPERSISTENT_CHARACTER_APPEARANCE_STATES_ENABLED=true\n# Only states explicitly marked until_changed/durable are inherited cross-video.\nPERSISTENT_CHARACTER_APPEARANCE_STATE_INHERIT_DURABLE=true\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.11.4 ativa: Wardrobe / Appearance State Layers scene-only ou until_changed sem mutar identidade ou asset canonicos.');
