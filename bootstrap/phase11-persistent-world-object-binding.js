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
  if (index === -1) throw new Error(`Phase 11.10.5 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.5 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/persistent-world-object-binding-v11.js', template('persistent-world-object-binding-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-world-object-binding-db-tables-v11.txt')}\n`, 'Persistent World Object Binding table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-world-object-binding-db-methods-v11.txt')}\n`, 'Persistent World Object Binding DB methods');
  const loadAnchor = "    const persistentWorldObjectStates = await this.listProductionPersistentWorldObjectStates(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentWorldObjectBindings = await this.listProductionPersistentWorldObjectBindings(productionId);\n", 'load object bindings in production bundle');
  s = replaceOnce(s, "      persistentWorldObjectStates,\n", "      persistentWorldObjectStates,\n      persistentWorldObjectBindings,\n", 'expose object bindings in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(s,
    "const { PersistentWorldObjectStateLayerV11 } = require('./persistent-world-object-state-v11');\n",
    "const { PersistentWorldObjectStateLayerV11 } = require('./persistent-world-object-state-v11');\nconst { PersistentWorldObjectBindingV11 } = require('./persistent-world-object-binding-v11');\n",
    'Persistent World Object Binding import');
  s = replaceOnce(s,
    "    this.persistentWorldObjectStates = options.persistentWorldObjectStates || new PersistentWorldObjectStateLayerV11(db, { logger: this.logger });\n",
    "    this.persistentWorldObjectStates = options.persistentWorldObjectStates || new PersistentWorldObjectStateLayerV11(db, { logger: this.logger });\n    this.persistentWorldObjectBindings = options.persistentWorldObjectBindings || new PersistentWorldObjectBindingV11(db, { logger: this.logger });\n",
    'Persistent World Object Binding construction');

  s = replaceOnce(s,
    "      shotPlan = this.shotPlanner.planProduction(production, scenes, cartoonBible);\n      if (shotPlan) {\n",
    "      shotPlan = this.shotPlanner.planProduction(production, scenes, cartoonBible);\n      let persistentWorldObjectBindingPlan = null;\n      if (shotPlan && persistentWorldObjectPlan?.active) {\n        persistentWorldObjectBindingPlan = await this.persistentWorldObjectBindings.bindShotPlan({ production, scenes, shotPlan, environmentBible, objectPlan: persistentWorldObjectPlan, statePlan: persistentWorldObjectStatePlan, assetPlan: canonicalWorldObjectAssetPlan });\n        shotPlan = persistentWorldObjectBindingPlan.shotPlan;\n        if (persistentWorldObjectBindingPlan?.active) this.logger.info(`Persistent World Object Binding v11.10.5: resolved=${persistentWorldObjectBindingPlan.summary.resolved}, visible=${persistentWorldObjectBindingPlan.summary.visible}, nonvisual=${persistentWorldObjectBindingPlan.summary.nonvisual}, conflicts=${persistentWorldObjectBindingPlan.summary.conflicts}, ambiguous=${persistentWorldObjectBindingPlan.summary.ambiguous}, unresolved=${persistentWorldObjectBindingPlan.summary.unresolved}.`);\n      }\n      if (shotPlan) {\n",
    'bind persistent objects after shot planning and before shot persistence');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentWorldObjectBindings(item) {",
    "  if (!Array.isArray(item?.persistentWorldObjectBindings) || !item.persistentWorldObjectBindings.length) return '';",
    "  const resolved = item.persistentWorldObjectBindings.filter(row => row.status === 'resolved').length;",
    "  const visible = item.persistentWorldObjectBindings.filter(row => row.status === 'resolved' && ['visible','occluded'].includes(row.visibility)).length;",
    "  const nonvisual = item.persistentWorldObjectBindings.filter(row => row.status === 'resolved' && ['offscreen','mentioned'].includes(row.visibility)).length;",
    "  const cards = item.persistentWorldObjectBindings.slice(0, 80).map(row => {",
    "    const cls = row.status === 'resolved' ? 'pass' : 'fail';",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(row.objectKey || row.referenceText || row.objectId || 'object')} · ${escapeHTML(row.visibility || row.status || '')}</strong><br><small>scene ${escapeHTML(row.sceneId || '')} · shot ${Number(row.shotIndex || 0) + 1}<br>${escapeHTML(row.interaction || 'none')}${row.holderKey ? ` · holder ${escapeHTML(row.holderKey)}` : ''}${row.placement ? `<br>${escapeHTML(row.placement)}` : ''}<br>mode: ${escapeHTML(row.matchMode || 'none')} · state ${escapeHTML((row.stateFingerprint || '').slice(0, 12))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-world-object-binding-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">SCENE / SHOT OBJECT BINDING V11.10.5</p><h3>Explicit object presence per generated shot</h3></div></div><p>${resolved} resolved binding(s) · ${visible} visible/occluded · ${nonvisual} offscreen/mentioned. Narrative mention alone never creates visual presence.</p><div class=\"quality-grid\">${cards}</div><small>Visible bindings enrich the shot prompt with canonical object identity/state. Offscreen or mentioned bindings explicitly forbid rendering the object.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Persistent World Object Binding dashboard renderer');
  s = replaceOnce(s,
    "        ${renderPersistentWorldObjectStates(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderPersistentWorldObjectStates(item)}\n        ${renderPersistentWorldObjectBindings(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show object bindings before shot plan');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-world-object-binding'] = 'node ../bootstrap/verify-phase11-persistent-world-object-binding.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_WORLD_OBJECT_BINDINGS_ENABLED=')) env += `\n# Phase 11.10.5 — explicit persistent object presence semantics per scene/shot.\nPERSISTENT_WORLD_OBJECT_BINDINGS_ENABLED=true\n# Narrative mention alone must never create visual object presence.\nPERSISTENT_WORLD_OBJECT_BINDINGS_REQUIRE_EXPLICIT=true\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.5 ativa: Scene / Shot Object Binding explicito com visibilidade, interacao, estado/asset canonicos e fingerprint de shot atualizado.');
