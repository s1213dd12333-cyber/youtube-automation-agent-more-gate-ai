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
  if (index === -1) throw new Error(`Phase 11.10.4 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.4 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/persistent-world-object-state-v11.js', template('persistent-world-object-state-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-world-object-state-db-tables-v11.txt')}\n`, 'Persistent World Object State table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-world-object-state-db-methods-v11.txt')}\n`, 'Persistent World Object State DB methods');
  const loadAnchor = "    const persistentWorldObjectAssets = await this.listProductionPersistentWorldObjectAssets(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentWorldObjectStates = await this.listProductionPersistentWorldObjectStates(productionId);\n", 'load object states in production bundle');
  s = replaceOnce(s, "      persistentWorldObjectAssets,\n", "      persistentWorldObjectAssets,\n      persistentWorldObjectStates,\n", 'expose object states in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(s,
    "const { CanonicalWorldObjectAssetRegistryV11 } = require('./canonical-world-object-assets-v11');\n",
    "const { CanonicalWorldObjectAssetRegistryV11 } = require('./canonical-world-object-assets-v11');\nconst { PersistentWorldObjectStateLayerV11 } = require('./persistent-world-object-state-v11');\n",
    'Persistent World Object State import');
  s = replaceOnce(s,
    "    this.canonicalWorldObjectAssets = options.canonicalWorldObjectAssets || new CanonicalWorldObjectAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n",
    "    this.canonicalWorldObjectAssets = options.canonicalWorldObjectAssets || new CanonicalWorldObjectAssetRegistryV11(db, { logger: this.logger, dataRoot: this.dataRoot });\n    this.persistentWorldObjectStates = options.persistentWorldObjectStates || new PersistentWorldObjectStateLayerV11(db, { logger: this.logger });\n",
    'Persistent World Object State construction');

  const block = [
    "    let persistentWorldObjectStatePlan = null;",
    "    if (persistentWorldObjectPlan?.active) {",
    "      const stateObjectLocks = propLockPlan?.locks || await this.db.listPropLocks(production.id);",
    "      persistentWorldObjectStatePlan = await this.persistentWorldObjectStates.ensureProductionStates(production, environmentBible, stateObjectLocks, persistentWorldObjectPlan);",
    "      if (persistentWorldObjectStatePlan?.active) this.logger.info(`Persistent World Object State v11.10.4: active=${persistentWorldObjectStatePlan.summary.active}, neutral=${persistentWorldObjectStatePlan.summary.neutral}, inherited=${persistentWorldObjectStatePlan.summary.inherited}, conflicts=${persistentWorldObjectStatePlan.summary.conflicts}, ambiguous=${persistentWorldObjectStatePlan.summary.ambiguous}.`);",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    let temporaryLocationStatePlan = null;\n", block, 'apply object state/lifecycle layer before location temporary state');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentWorldObjectStates(item) {",
    "  if (!Array.isArray(item?.persistentWorldObjectStates) || !item.persistentWorldObjectStates.length) return '';",
    "  const inherited = item.persistentWorldObjectStates.filter(row => row.inherited === true).length;",
    "  const conflicts = item.persistentWorldObjectStates.filter(row => row.status === 'conflict').length;",
    "  const cards = item.persistentWorldObjectStates.map(row => {",
    "    const details = [row.condition, ...(row.damage || []), row.cleanliness, row.openness, row.operationalState, ...(row.contents || []), row.holderKey, row.placement, ...(row.storyState || [])].filter(Boolean);",
    "    const cls = row.status === 'conflict' ? 'fail' : (row.status === 'active' ? 'pass' : '');",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(row.objectId || 'object')} · ${escapeHTML(row.status || 'neutral')}</strong><br><small>${escapeHTML(row.persistence || 'scene')}${row.inherited ? ' · inherited durable state' : ''}<br>${escapeHTML(details.join(' · ') || 'neutral state')}<br>state: ${escapeHTML((row.stateFingerprint || '').slice(0, 16))}${(row.conflicts || []).length ? `<br>conflicts: ${escapeHTML((row.conflicts || []).join(', '))}` : ''}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-world-object-state-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">OBJECT STATE / LIFECYCLE V11.10.4</p><h3>Mutable story state without canonical identity drift</h3></div></div><p>${item.persistentWorldObjectStates.length} object state layer(s) · ${inherited} inherited durable · ${conflicts} conflict. Scene state expires; until_changed state may carry across videos until explicitly replaced/reset.</p><div class=\"quality-grid\">${cards}</div><small>Condition, damage, cleanliness, open/closed, contents, possession-in-use and story state never rewrite objectId, canonical fingerprint or the 11.10.3 canonical asset.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Persistent World Object State dashboard renderer');
  s = replaceOnce(s,
    "        ${renderPersistentWorldObjectAssets(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderPersistentWorldObjectAssets(item)}\n        ${renderPersistentWorldObjectStates(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show object state after canonical object assets');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-world-object-state'] = 'node ../bootstrap/verify-phase11-persistent-world-object-state.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_WORLD_OBJECT_STATES_ENABLED=')) env += `\n# Phase 11.10.4 — mutable state/lifecycle overlay for persistent objects.\nPERSISTENT_WORLD_OBJECT_STATES_ENABLED=true\n# Only states explicitly marked until_changed/durable are inherited cross-video.\nPERSISTENT_WORLD_OBJECT_STATE_INHERIT_DURABLE=true\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.4 ativa: Object State / Lifecycle Layers com estado scene-only ou until_changed duravel sem mutar identidade/asset canonicos.');
