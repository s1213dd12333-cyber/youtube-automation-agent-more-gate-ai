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
  if (index === -1) throw new Error(`Phase 11.10.1 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.1 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/persistent-world-object-registry-v11.js', template('persistent-world-object-registry-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('persistent-world-object-db-tables-v11.txt')}\n`, 'Persistent World Object tables');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('persistent-world-object-db-methods-v11.txt')}\n`, 'Persistent World Object DB methods');
  const loadAnchor = "    const crossVideoContinuityChecks = await this.listCrossVideoContinuityChecks(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const persistentWorldObjects = await this.listProductionPersistentWorldObjects(productionId);\n", 'load persistent world objects in production bundle');
  s = replaceOnce(s, "      crossVideoContinuityChecks,\n", "      crossVideoContinuityChecks,\n      persistentWorldObjects,\n", 'expose persistent world objects in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(s,
    "const { CrossVideoContinuityGateV11 } = require('./cross-video-continuity-gate-v11');\n",
    "const { CrossVideoContinuityGateV11 } = require('./cross-video-continuity-gate-v11');\nconst { PersistentWorldObjectRegistryV11 } = require('./persistent-world-object-registry-v11');\n",
    'Persistent World Object import');
  s = replaceOnce(s,
    "    this.crossVideoContinuityGate = options.crossVideoContinuityGate || new CrossVideoContinuityGateV11(db, { logger: this.logger });\n",
    "    this.crossVideoContinuityGate = options.crossVideoContinuityGate || new CrossVideoContinuityGateV11(db, { logger: this.logger });\n    this.persistentWorldObjects = options.persistentWorldObjects || new PersistentWorldObjectRegistryV11(db, { logger: this.logger });\n",
    'Persistent World Object construction');
  const block = [
    "    let persistentWorldObjectPlan = null;",
    "    if (environmentBible) {",
    "      const objectLocks = propLockPlan?.locks || await this.db.listPropLocks(production.id);",
    "      const objectLocationBindings = reusableLocationPlan?.locations?.map(item => item?.location && item?.usage ? { ...item.location, usage: item.usage } : item).filter(item => item?.id && item?.usage)",
    "        || await this.db.listProductionReusableLocations(production.id);",
    "      const objectZoneBindings = reusableLocationZonePlan?.zones?.map(item => item?.zone && item?.usage ? { ...item.zone, usage: item.usage } : item).filter(item => item?.id)",
    "        || await this.db.listProductionReusableLocationZones(production.id);",
    "      persistentWorldObjectPlan = await this.persistentWorldObjects.ensureProductionObjects(production, environmentBible, objectLocks, objectLocationBindings, objectZoneBindings);",
    "      if (persistentWorldObjectPlan?.active) this.logger.info(`Persistent World Objects v11.10.1: total=${persistentWorldObjectPlan.summary.total}, registered=${persistentWorldObjectPlan.summary.registered}, reused=${persistentWorldObjectPlan.summary.reused}, conflicts=${persistentWorldObjectPlan.summary.conflicts}.`);",
    "    }",
    ""
  ].join('\n');
  s = insertBefore(s, "    let temporaryLocationStatePlan = null;\n", block, 'register persistent world objects before temporary scene state');
  write('utils/scene-pipeline-v2.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderPersistentWorldObjects(item) {",
    "  if (!Array.isArray(item?.persistentWorldObjects) || !item.persistentWorldObjects.length) return '';",
    "  const reused = item.persistentWorldObjects.filter(object => object.reusedAcrossVideos === true).length;",
    "  const cards = item.persistentWorldObjects.map(object => {",
    "    const scope = [object.usage?.locationId || object.canonicalLocationId, object.usage?.zoneId || object.canonicalZoneId].filter(Boolean).join(' / ') || 'global';",
    "    return `<div class=\"quality-check pass\"><strong>${escapeHTML(object.displayName || object.objectKey)} · ${object.reusedAcrossVideos ? 'REUSED CROSS-VIDEO' : 'REGISTERED'}</strong><br><small>ID: ${escapeHTML(object.id || '')}<br>type: ${escapeHTML(object.objectType || 'object')} · scope: ${escapeHTML(scope)}<br>match: ${escapeHTML(object.usage?.matchMode || 'unknown')}<br>identity: ${escapeHTML((object.identityFingerprint || '').slice(0, 16))}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel persistent-world-objects-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">PERSISTENT WORLD OBJECTS V11.10.1</p><h3>Cross-video canonical object identities</h3></div></div><p>${item.persistentWorldObjects.length} persistent object binding(s) · ${reused} reused from an earlier video. Only explicitly persistent world objects or Prop Locks marked persistent enter this registry.</p><div class=\"quality-grid\">${cards}</div><small>Temporary props from 11.9.5 are excluded. Anonymous objects are location-scoped; globally movable identities require an explicit objectKey or ownerKey.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Persistent World Object dashboard renderer');
  s = replaceOnce(s,
    "        ${renderCrossVideoContinuity(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderCrossVideoContinuity(item)}\n        ${renderPersistentWorldObjects(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show persistent world objects after location continuity summary');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:persistent-world-objects'] = 'node ../bootstrap/verify-phase11-persistent-world-objects.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('PERSISTENT_WORLD_OBJECTS_ENABLED=')) env += `\n# Phase 11.10.1 — production-independent persistent world object identities.\nPERSISTENT_WORLD_OBJECTS_ENABLED=true\n# Defaults to REUSABLE_LOCATION_NAMESPACE when unset.\nPERSISTENT_WORLD_OBJECT_NAMESPACE=default\n`;
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.1 ativa: Persistent World Object Registry com identidade cross-video, provenance por uso e isolamento estrito de Temporary State props.');
