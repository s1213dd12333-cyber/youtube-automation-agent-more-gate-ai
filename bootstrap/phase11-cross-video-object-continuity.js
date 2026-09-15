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
  if (index === -1) throw new Error(`Phase 11.10.6 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.6 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/cross-video-object-continuity-gate-v11.js', template('cross-video-object-continuity-gate-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('cross-video-object-continuity-db-tables-v11.txt')}\n`, 'Cross-Video Object Continuity table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('cross-video-object-continuity-db-methods-v11.txt')}\n`, 'Cross-Video Object Continuity DB methods');
  const loadAnchor = "    const persistentWorldObjectBindings = await this.listProductionPersistentWorldObjectBindings(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const crossVideoObjectContinuityChecks = await this.listCrossVideoObjectContinuityChecks(productionId);\n", 'load object continuity checks in production bundle');
  s = replaceOnce(s, "      persistentWorldObjectBindings,\n", "      persistentWorldObjectBindings,\n      crossVideoObjectContinuityChecks,\n", 'expose object continuity checks in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(s,
    "const { PersistentWorldObjectBindingV11 } = require('./persistent-world-object-binding-v11');\n",
    "const { PersistentWorldObjectBindingV11 } = require('./persistent-world-object-binding-v11');\nconst { CrossVideoObjectContinuityGateV11 } = require('./cross-video-object-continuity-gate-v11');\n",
    'Cross-Video Object Continuity import');
  s = replaceOnce(s,
    "    this.persistentWorldObjectBindings = options.persistentWorldObjectBindings || new PersistentWorldObjectBindingV11(db, { logger: this.logger });\n",
    "    this.persistentWorldObjectBindings = options.persistentWorldObjectBindings || new PersistentWorldObjectBindingV11(db, { logger: this.logger });\n    this.crossVideoObjectContinuityGate = options.crossVideoObjectContinuityGate || new CrossVideoObjectContinuityGateV11(db, { logger: this.logger });\n",
    'construct Cross-Video Object Continuity Gate');
  s = replaceOnce(s,
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine, environmentContinuityValidator: this.environmentContinuityValidator, crossVideoContinuityGate: this.crossVideoContinuityGate });\n",
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine, environmentContinuityValidator: this.environmentContinuityValidator, crossVideoContinuityGate: this.crossVideoContinuityGate, crossVideoObjectContinuityGate: this.crossVideoObjectContinuityGate });\n",
    'pass Cross-Video Object Continuity Gate into keyframe pipeline');
  write('utils/scene-pipeline-v2.js', s);
}

function patchKeyframeRuntime() {
  let s = read('utils/cartoon-keyframe-pipeline-v11.js');
  s = replaceOnce(s,
    "    this.crossVideoContinuityGate = options.crossVideoContinuityGate || null;\n",
    "    this.crossVideoContinuityGate = options.crossVideoContinuityGate || null;\n    this.crossVideoObjectContinuityGate = options.crossVideoObjectContinuityGate || null;\n",
    'Cross-Video Object Continuity Gate option');

  const readyAnchor = "        await this.db.updateShotKeyframe(current.id, {\n          status: 'ready',\n";
  const gateBlock = [
    "        let crossVideoObjectContinuityResult = null;",
    "        if (this.crossVideoObjectContinuityGate) {",
    "          crossVideoObjectContinuityResult = await this.crossVideoObjectContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 });",
    "          if (!crossVideoObjectContinuityResult.accepted) {",
    "            await this.db.updateShotKeyframe(current.id, {",
    "              status: 'cross_video_object_continuity_failed',",
    "              assetPath,",
    "              error: 'Cross-video object continuity blocked: ' + (crossVideoObjectContinuityResult.reasons || []).join(', ')",
    "            });",
    "            const crossVideoObjectError = new Error('Cross-video object continuity validation failed for keyframe ' + current.id + ': status=' + crossVideoObjectContinuityResult.status + ' blocked=' + Number(crossVideoObjectContinuityResult.summary?.blocked || 0));",
    "            crossVideoObjectError.code = 'CROSS_VIDEO_OBJECT_CONTINUITY_FAILED';",
    "            crossVideoObjectError.keyframeId = current.id;",
    "            crossVideoObjectError.shotId = current.shotId;",
    "            crossVideoObjectError.sceneId = sceneId;",
    "            throw crossVideoObjectError;",
    "          }",
    "        }",
    ""
  ].join('\n');
  s = insertBefore(s, readyAnchor, gateBlock, 'gate cross-video object continuity before keyframe becomes ready');
  write('utils/cartoon-keyframe-pipeline-v11.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderCrossVideoObjectContinuity(item) {",
    "  if (!Array.isArray(item?.crossVideoObjectContinuityChecks) || !item.crossVideoObjectContinuityChecks.length) return '';",
    "  const latest = new Map();",
    "  for (const check of item.crossVideoObjectContinuityChecks) {",
    "    const key = `${check.keyframeId || ''}:${check.objectId || ''}`;",
    "    const current = latest.get(key);",
    "    if (!current || Number(check.attempt || 0) > Number(current.attempt || 0) || (Number(check.attempt || 0) === Number(current.attempt || 0) && String(check.createdAt || '') >= String(current.createdAt || ''))) latest.set(key, check);",
    "  }",
    "  const values = [...latest.values()];",
    "  const reused = values.filter(check => check.reusedAcrossVideos);",
    "  const accepted = reused.filter(check => check.accepted).length;",
    "  const blocked = reused.filter(check => !check.accepted).length;",
    "  const cards = values.slice(0, 80).map(check => {",
    "    const cls = check.accepted ? 'pass' : 'fail';",
    "    const mode = check.reusedAcrossVideos ? 'cross-video' : 'origin';",
    "    const verdict = check.sameCanonicalObject == null ? 'unverified' : (check.sameCanonicalObject ? 'same object' : 'replacement/drift');",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(check.objectId || 'unresolved object')} · ${escapeHTML(check.visibility || '')}</strong><br><small>${escapeHTML(mode)} · ${escapeHTML(check.status || '')} · ${escapeHTML(verdict)}<br>vision ${Math.round(Number(check.visionConfidence || 0) * 100)}% · provider ${escapeHTML(check.providerMode || 'none')}<br>${escapeHTML((check.reasons || []).join(', ') || 'accepted')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel cross-video-object-continuity-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CROSS-VIDEO OBJECT CONTINUITY GATE V11.10.6</p><h3>Canonical object identity drift gate</h3></div></div><p>${accepted}/${reused.length} reused visible-object decision(s) accepted · ${blocked} blocked. Only resolved visible/occluded bindings are evaluated; offscreen/mentioned objects are excluded.</p><div class=\"quality-grid\">${cards}</div><small>Explicit identity mismatch always blocks. Missing vision only blocks when strict verification is enabled.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Cross-Video Object Continuity dashboard renderer');
  s = replaceOnce(s,
    "        ${renderPersistentWorldObjectBindings(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderPersistentWorldObjectBindings(item)}\n        ${renderCrossVideoObjectContinuity(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show object continuity gate after bindings');
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:cross-video-object-continuity'] = 'node ../bootstrap/verify-phase11-cross-video-object-continuity.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('CROSS_VIDEO_OBJECT_CONTINUITY_ENABLED=')) env += [
    '',
    '# Phase 11.10.6 — visual identity gate for reused persistent objects with visible/occluded shot bindings.',
    'CROSS_VIDEO_OBJECT_CONTINUITY_ENABLED=true',
    'CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_CANONICAL_ASSET=true',
    '# Strict vision mode blocks when the semantic/vision provider is unavailable or unverified.',
    'CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_VISION=false',
    'CROSS_VIDEO_OBJECT_CONTINUITY_MIN_CONFIDENCE=0.72',
    '# Optional overrides; when blank, the gate reuses SEMANTIC_PROP_VISION_* provider settings.',
    'CROSS_VIDEO_OBJECT_VISION_BASE_URL=',
    'CROSS_VIDEO_OBJECT_VISION_MODEL=',
    'CROSS_VIDEO_OBJECT_VISION_API_KEY=',
    'CROSS_VIDEO_OBJECT_VISION_TIMEOUT_MS=30000',
    ''
  ].join('\n');
  write('.env.example', env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchKeyframeRuntime();
patchDashboard();
patchPackageAndEnv();
console.log('FASE 11.10.6 ativa: Cross-Video Object Continuity Gate para bindings visible/occluded, canonical asset e verificacao semantica de identidade.');