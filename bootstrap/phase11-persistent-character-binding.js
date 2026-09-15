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
  if (index === -1) throw new Error(`Phase 11.11.5 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}
function insertBeforeAfter(text, afterToken, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const afterIndex = text.indexOf(afterToken);
  if (afterIndex === -1) throw new Error(`Phase 11.11.5 anchor not found: ${label} prerequisite`);
  const index = text.indexOf(anchor, afterIndex + afterToken.length);
  if (index === -1) throw new Error(`Phase 11.11.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/persistent-character-binding-v11.js', template('persistent-character-binding-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-character-binding-db-tables-v11.txt')}\n`, 'Persistent Character Binding table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-character-binding-db-methods-v11.txt')}\n`, 'Persistent Character Binding DB methods');
  const loadAnchor = "    const persistentCharacterAppearanceStates = await this.listProductionPersistentCharacterAppearanceStates(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentCharacterBindings = await this.listProductionPersistentCharacterBindings(productionId);\n", 'load character bindings in production bundle');
  s = replaceOnce(s, "      persistentCharacterAppearanceStates,\n", "      persistentCharacterAppearanceStates,\n      persistentCharacterBindings,\n", 'expose character bindings in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(
    s,
    "const { PersistentCharacterAppearanceStateLayerV11 } = require('./persistent-character-appearance-state-v11');\n",
    "const { PersistentCharacterAppearanceStateLayerV11 } = require('./persistent-character-appearance-state-v11');\nconst { PersistentCharacterBindingV11 } = require('./persistent-character-binding-v11');\n",
    'Persistent Character Binding import'
  );
  s = replaceOnce(
    s,
    "    this.persistentCharacterAppearanceStates = options.persistentCharacterAppearanceStates || new PersistentCharacterAppearanceStateLayerV11(db, { logger: this.logger });\n",
    "    this.persistentCharacterAppearanceStates = options.persistentCharacterAppearanceStates || new PersistentCharacterAppearanceStateLayerV11(db, { logger: this.logger });\n    this.persistentCharacterBindings = options.persistentCharacterBindings || new PersistentCharacterBindingV11(db, { logger: this.logger });\n",
    'Persistent Character Binding construction'
  );

  const block = [
    "      let persistentCharacterBindingPlan = null;",
    "      if (shotPlan && persistentCharacterPlan?.active) {",
    "        persistentCharacterBindingPlan = await this.persistentCharacterBindings.bindShotPlan({ production, scenes, shotPlan, characterPlan: persistentCharacterPlan, statePlan: persistentCharacterAppearanceStatePlan, assetPlan: canonicalCharacterAssetPlan });",
    "        shotPlan = persistentCharacterBindingPlan.shotPlan;",
    "        if (persistentCharacterBindingPlan?.active) this.logger.info(`Persistent Character Binding v11.11.5: resolved=${persistentCharacterBindingPlan.summary.resolved}, visible=${persistentCharacterBindingPlan.summary.visible}, nonvisual=${persistentCharacterBindingPlan.summary.nonvisual}, conflicts=${persistentCharacterBindingPlan.summary.conflicts}, ambiguous=${persistentCharacterBindingPlan.summary.ambiguous}, unresolved=${persistentCharacterBindingPlan.summary.unresolved}.`);",
    "      }",
    ""
  ].join('\n');
  s = insertBeforeAfter(
    s,
    'this.persistentWorldObjectBindings.bindShotPlan',
    "      if (shotPlan) {\n",
    block,
    'bind persistent characters after object binding and before shot persistence'
  );
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentCharacterBindings(item) {",
    "  if (!Array.isArray(item?.persistentCharacterBindings) || !item.persistentCharacterBindings.length) return '';",
    "  const resolved = item.persistentCharacterBindings.filter(row => row.status === 'resolved').length;",
    "  const visible = item.persistentCharacterBindings.filter(row => row.status === 'resolved' && ['visible','occluded'].includes(row.visibility)).length;",
    "  const nonvisual = item.persistentCharacterBindings.filter(row => row.status === 'resolved' && ['offscreen','mentioned'].includes(row.visibility)).length;",
    "  const cards = item.persistentCharacterBindings.slice(0, 100).map(row => {",
    "    const cls = row.status === 'resolved' ? 'pass' : 'fail';",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(row.characterKey || row.referenceText || row.characterId || 'character')} · ${escapeHTML(row.visibility || row.status || '')}</strong><br><small>scene ${escapeHTML(row.sceneId || '')} · shot ${Number(row.shotIndex || 0) + 1}${row.placement ? `<br>${escapeHTML(row.placement)}` : ''}${row.action ? `<br>${escapeHTML(row.action)}` : ''}<br>mode: ${escapeHTML(row.matchMode || 'none')} · state ${escapeHTML((row.stateFingerprint || '').slice(0, 12))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-character-binding-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">SCENE / SHOT CHARACTER BINDING V11.11.5</p><h3>Exact persistent character presence per shot</h3></div></div><p>${resolved} resolved binding(s) · ${visible} visible/occluded · ${nonvisual} offscreen/mentioned. Shot Planner cast is resolved to persistent characterId; explicit bindings can override visual presence.</p><div class=\"quality-grid\">${cards}</div><small>Visible bindings enrich prompts with canonical character asset and 11.11.4 appearance state. Offscreen/mentioned bindings explicitly forbid rendering that character.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Persistent Character Binding dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderPersistentCharacterAppearanceStates(item)}\n",
    "        ${renderPersistentCharacterAppearanceStates(item)}\n        ${renderPersistentCharacterBindings(item)}\n",
    'show character bindings after appearance state'
  );
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-character-binding'] = 'node ../bootstrap/verify-phase11-persistent-character-binding.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_CHARACTER_BINDINGS_ENABLED=')) env += `\n# Phase 11.11.5 — explicit persistent character presence per scene/shot.\nPERSISTENT_CHARACTER_BINDINGS_ENABLED=true\n# Resolve the Shot Planner's explicit cast IDs into persistent character IDs by default.\nPERSISTENT_CHARACTER_BINDINGS_USE_SHOT_PLANNER_CAST=true\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.11.5 ativa: Scene / Shot Character Binding com characterId persistente, visibilidade explicita, appearance state/asset canonicos e fingerprint de shot atualizado.');
