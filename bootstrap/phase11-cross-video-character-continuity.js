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
  if (index === -1) throw new Error(`Phase 11.11.6 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.6 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  write('utils/cross-video-character-continuity-gate-v11.js', template('cross-video-character-continuity-gate-v11.js'));
}

function patchDatabase() {
  let s = read('database/db.js');
  s = insertBefore(s, "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n", `${template('cross-video-character-continuity-db-tables-v11.txt')}\n`, 'Cross-Video Character Continuity table');
  s = insertBefore(s, '  // Content Strategy methods\n', `${template('cross-video-character-continuity-db-methods-v11.txt')}\n`, 'Cross-Video Character Continuity DB methods');
  const loadAnchor = "    const persistentCharacterBindings = await this.listProductionPersistentCharacterBindings(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const crossVideoCharacterContinuityChecks = await this.listCrossVideoCharacterContinuityChecks(productionId);\n", 'load character continuity checks in production bundle');
  s = replaceOnce(s, "      persistentCharacterBindings,\n", "      persistentCharacterBindings,\n      crossVideoCharacterContinuityChecks,\n", 'expose character continuity checks in production bundle');
  write('database/db.js', s);
}

function patchScenePipeline() {
  let s = read('utils/scene-pipeline-v2.js');
  s = replaceOnce(
    s,
    "const { PersistentCharacterBindingV11 } = require('./persistent-character-binding-v11');\n",
    "const { PersistentCharacterBindingV11 } = require('./persistent-character-binding-v11');\nconst { CrossVideoCharacterContinuityGateV11 } = require('./cross-video-character-continuity-gate-v11');\n",
    'Cross-Video Character Continuity import'
  );
  s = replaceOnce(
    s,
    "    this.persistentCharacterBindings = options.persistentCharacterBindings || new PersistentCharacterBindingV11(db, { logger: this.logger });\n",
    "    this.persistentCharacterBindings = options.persistentCharacterBindings || new PersistentCharacterBindingV11(db, { logger: this.logger });\n    this.crossVideoCharacterContinuityGate = options.crossVideoCharacterContinuityGate || new CrossVideoCharacterContinuityGateV11(db, { logger: this.logger });\n",
    'construct Cross-Video Character Continuity Gate'
  );
  s = replaceOnce(
    s,
    'crossVideoObjectContinuityGate: this.crossVideoObjectContinuityGate });\n',
    'crossVideoObjectContinuityGate: this.crossVideoObjectContinuityGate, crossVideoCharacterContinuityGate: this.crossVideoCharacterContinuityGate });\n',
    'pass Cross-Video Character Continuity Gate into keyframe pipeline'
  );
  write('utils/scene-pipeline-v2.js', s);
}

function patchKeyframeRuntime() {
  let s = read('utils/cartoon-keyframe-pipeline-v11.js');
  s = replaceOnce(
    s,
    "    this.crossVideoObjectContinuityGate = options.crossVideoObjectContinuityGate || null;\n",
    "    this.crossVideoObjectContinuityGate = options.crossVideoObjectContinuityGate || null;\n    this.crossVideoCharacterContinuityGate = options.crossVideoCharacterContinuityGate || null;\n",
    'Cross-Video Character Continuity Gate option'
  );

  const readyAnchor = "        await this.db.updateShotKeyframe(current.id, {\n          status: 'ready',\n";
  const gateBlock = [
    "        let crossVideoCharacterContinuityResult = null;",
    "        if (this.crossVideoCharacterContinuityGate) {",
    "          crossVideoCharacterContinuityResult = await this.crossVideoCharacterContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 });",
    "          if (!crossVideoCharacterContinuityResult.accepted) {",
    "            await this.db.updateShotKeyframe(current.id, {",
    "              status: 'cross_video_character_continuity_failed',",
    "              assetPath,",
    "              error: 'Cross-video character continuity blocked: ' + (crossVideoCharacterContinuityResult.reasons || []).join(', ')",
    "            });",
    "            const crossVideoCharacterError = new Error('Cross-video character continuity validation failed for keyframe ' + current.id + ': status=' + crossVideoCharacterContinuityResult.status + ' blocked=' + Number(crossVideoCharacterContinuityResult.summary?.blocked || 0));",
    "            crossVideoCharacterError.code = 'CROSS_VIDEO_CHARACTER_CONTINUITY_FAILED';",
    "            crossVideoCharacterError.keyframeId = current.id;",
    "            crossVideoCharacterError.shotId = current.shotId;",
    "            crossVideoCharacterError.sceneId = sceneId;",
    "            throw crossVideoCharacterError;",
    "          }",
    "        }",
    ""
  ].join('\n');
  s = insertBefore(s, readyAnchor, gateBlock, 'gate cross-video character continuity before keyframe becomes ready');
  write('utils/cartoon-keyframe-pipeline-v11.js', s);
}

function patchDashboard() {
  let s = read('dashboard/app.js');
  const helper = [
    "function renderCrossVideoCharacterContinuity(item) {",
    "  if (!Array.isArray(item?.crossVideoCharacterContinuityChecks) || !item.crossVideoCharacterContinuityChecks.length) return '';",
    "  const latest = new Map();",
    "  for (const check of item.crossVideoCharacterContinuityChecks) {",
    "    const key = `${check.keyframeId || ''}:${check.characterId || ''}`;",
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
    "    const verdict = check.sameCanonicalCharacter == null ? 'unverified' : (check.sameCanonicalCharacter ? 'same character' : 'replacement/drift');",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(check.characterId || 'unresolved character')} · ${escapeHTML(check.visibility || '')}</strong><br><small>${escapeHTML(mode)} · ${escapeHTML(check.status || '')} · ${escapeHTML(verdict)}<br>vision ${Math.round(Number(check.visionConfidence || 0) * 100)}% · provider ${escapeHTML(check.providerMode || 'none')}<br>${escapeHTML((check.reasons || []).join(', ') || 'accepted')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel cross-video-character-continuity-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CROSS-VIDEO CHARACTER CONTINUITY GATE V11.11.6</p><h3>Canonical character identity drift gate</h3></div></div><p>${accepted}/${reused.length} reused visible-character decision(s) accepted · ${blocked} blocked. Only resolved visible/occluded bindings are evaluated; offscreen/mentioned characters are excluded.</p><div class=\"quality-grid\">${cards}</div><small>Declared 11.11.4 wardrobe/appearance state may vary. Face, silhouette, proportions, palette and stable markings still belong to the canonical character identity.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Cross-Video Character Continuity dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderPersistentCharacterBindings(item)}\n",
    "        ${renderPersistentCharacterBindings(item)}\n        ${renderCrossVideoCharacterContinuity(item)}\n",
    'show character continuity gate after character bindings'
  );
  write('dashboard/app.js', s);
}

function patchPackageAndEnv() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:cross-video-character-continuity'] = 'node ../bootstrap/verify-phase11-cross-video-character-continuity.js';
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  let env = read('.env.example');
  if (!env.includes('CROSS_VIDEO_CHARACTER_CONTINUITY_ENABLED=')) env += [
    '',
    '# Phase 11.11.6 — visual identity gate for reused persistent characters with visible/occluded shot bindings.',
    'CROSS_VIDEO_CHARACTER_CONTINUITY_ENABLED=true',
    'CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_CANONICAL_ASSET=true',
    '# Strict vision mode blocks when the semantic/vision provider is unavailable or unverified.',
    'CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_VISION=false',
    'CROSS_VIDEO_CHARACTER_CONTINUITY_MIN_CONFIDENCE=0.72',
    '# Optional overrides; when blank, the gate reuses SEMANTIC_PROP_VISION_* provider settings.',
    'CROSS_VIDEO_CHARACTER_VISION_BASE_URL=',
    'CROSS_VIDEO_CHARACTER_VISION_MODEL=',
    'CROSS_VIDEO_CHARACTER_VISION_API_KEY=',
    'CROSS_VIDEO_CHARACTER_VISION_TIMEOUT_MS=30000',
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
console.log('FASE 11.11.6 ativa: Cross-Video Character Continuity Gate para bindings visible/occluded, character_reference canonico e appearance-state tolerance.');
