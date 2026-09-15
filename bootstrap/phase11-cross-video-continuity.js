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
  if (index === -1) throw new Error(`Phase 11.9.6 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.9.6 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'cross-video-continuity-gate-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/cross-video-continuity-gate-v11.js');
  write('utils/cross-video-continuity-gate-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.9.6 cross-video reusable location/zone continuity gate audit trail",
    "      `CREATE TABLE IF NOT EXISTS cross_video_continuity_checks (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        shot_id TEXT NOT NULL,",
    "        keyframe_id TEXT NOT NULL,",
    "        location_id TEXT,",
    "        zone_id TEXT,",
    "        canonical_asset_id TEXT,",
    "        canonical_asset_path TEXT,",
    "        canonical_asset_sha256 TEXT,",
    "        canonical_source_production_id TEXT,",
    "        current_production_id TEXT NOT NULL,",
    "        reused_across_videos INTEGER NOT NULL DEFAULT 0,",
    "        state_layer_id TEXT,",
    "        state_fingerprint TEXT,",
    "        version TEXT NOT NULL DEFAULT '11.9.6',",
    "        attempt INTEGER NOT NULL DEFAULT 0,",
    "        status TEXT NOT NULL,",
    "        accepted INTEGER NOT NULL DEFAULT 0,",
    "        score REAL NOT NULL DEFAULT 0,",
    "        structural_score REAL NOT NULL DEFAULT 0,",
    "        appearance_score REAL NOT NULL DEFAULT 0,",
    "        threshold REAL NOT NULL DEFAULT 0,",
    "        metrics TEXT NOT NULL DEFAULT '{}',",
    "        reasons TEXT NOT NULL DEFAULT '[]',",
    "        anchor_mode TEXT,",
    "        semantic_verified INTEGER NOT NULL DEFAULT 0,",
    "        semantic_status TEXT,",
    "        reference_fingerprint TEXT,",
    "        candidate_fingerprint TEXT,",
    "        created_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (keyframe_id) REFERENCES shot_keyframes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (location_id) REFERENCES reusable_locations(id) ON DELETE SET NULL,",
    "        FOREIGN KEY (zone_id) REFERENCES reusable_location_zones(id) ON DELETE SET NULL,",
    "        FOREIGN KEY (canonical_asset_id) REFERENCES reusable_location_assets(id) ON DELETE SET NULL",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_cross_video_continuity_prod ON cross_video_continuity_checks(production_id, scene_id, keyframe_id, attempt, created_at)`,",
    "      `CREATE INDEX IF NOT EXISTS idx_cross_video_continuity_location ON cross_video_continuity_checks(location_id, zone_id, reused_across_videos, accepted)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'cross-video continuity table');

  const methods = [
    "  async saveCrossVideoContinuityCheck(input = {}) {",
    "    if (!input.productionId || !input.sceneId || !input.shotId || !input.keyframeId || !input.status) return null;",
    "    const id = input.id || this.generateId('cross_video_continuity');",
    "    const createdAt = input.createdAt || new Date().toISOString();",
    "    await this.executeQuery(",
    "      `INSERT INTO cross_video_continuity_checks (",
    "        id, production_id, scene_id, shot_id, keyframe_id, location_id, zone_id, canonical_asset_id, canonical_asset_path, canonical_asset_sha256,",
    "        canonical_source_production_id, current_production_id, reused_across_videos, state_layer_id, state_fingerprint, version, attempt, status, accepted,",
    "        score, structural_score, appearance_score, threshold, metrics, reasons, anchor_mode, semantic_verified, semantic_status, reference_fingerprint, candidate_fingerprint, created_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,",
    "      [id, input.productionId, input.sceneId, input.shotId, input.keyframeId, input.locationId || null, input.zoneId || null, input.canonicalAssetId || null,",
    "       input.canonicalAssetPath || null, input.canonicalAssetSha256 || null, input.canonicalSourceProductionId || null, input.currentProductionId || input.productionId,",
    "       input.reusedAcrossVideos ? 1 : 0, input.stateLayerId || null, input.stateFingerprint || null, String(input.version || '11.9.6'), Number(input.attempt || 0),",
    "       input.status, input.accepted ? 1 : 0, Number(input.score || 0), Number(input.structuralScore || 0), Number(input.appearanceScore || 0), Number(input.threshold || 0),",
    "       JSON.stringify(input.metrics || {}), JSON.stringify(input.reasons || []), input.anchorMode || null, input.semanticVerified ? 1 : 0, input.semanticStatus || null,",
    "       input.referenceFingerprint || null, input.candidateFingerprint || null, createdAt]",
    "    );",
    "    return this.getLatestCrossVideoContinuityCheck(input.productionId, input.keyframeId);",
    "  }",
    "",
    "  async getLatestCrossVideoContinuityCheck(productionId, keyframeId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM cross_video_continuity_checks WHERE production_id = ? AND keyframe_id = ? ORDER BY attempt DESC, created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId, keyframeId]",
    "    );",
    "    return this.parseCrossVideoContinuityCheck(row);",
    "  }",
    "",
    "  async listCrossVideoContinuityChecks(productionId) {",
    "    const rows = await this.getAllRows('SELECT * FROM cross_video_continuity_checks WHERE production_id = ? ORDER BY created_at, attempt, rowid', [productionId]);",
    "    return rows.map(row => this.parseCrossVideoContinuityCheck(row));",
    "  }",
    "",
    "  parseCrossVideoContinuityCheck(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, shotId: row.shot_id, keyframeId: row.keyframe_id,",
    "      locationId: row.location_id, zoneId: row.zone_id, canonicalAssetId: row.canonical_asset_id, canonicalAssetPath: row.canonical_asset_path,",
    "      canonicalAssetSha256: row.canonical_asset_sha256, canonicalSourceProductionId: row.canonical_source_production_id, currentProductionId: row.current_production_id,",
    "      reusedAcrossVideos: Number(row.reused_across_videos || 0) === 1, stateLayerId: row.state_layer_id, stateFingerprint: row.state_fingerprint,",
    "      version: row.version || '11.9.6', attempt: Number(row.attempt || 0), status: row.status, accepted: Number(row.accepted || 0) === 1,",
    "      score: Number(row.score || 0), structuralScore: Number(row.structural_score || 0), appearanceScore: Number(row.appearance_score || 0), threshold: Number(row.threshold || 0),",
    "      metrics: JSON.parse(row.metrics || '{}'), reasons: JSON.parse(row.reasons || '[]'), anchorMode: row.anchor_mode,",
    "      semanticVerified: Number(row.semantic_verified || 0) === 1, semanticStatus: row.semantic_status, referenceFingerprint: row.reference_fingerprint,",
    "      candidateFingerprint: row.candidate_fingerprint, createdAt: row.created_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'cross-video continuity DB methods');

  const loadAnchor = "    const reusableLocationStates = await this.listProductionReusableLocationStates(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const crossVideoContinuityChecks = await this.listCrossVideoContinuityChecks(productionId);\n", 'load cross-video continuity checks in production bundle');
  s = replaceOnce(s, "      reusableLocationStates,\n", "      reusableLocationStates,\n      crossVideoContinuityChecks,\n", 'expose cross-video continuity checks in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { TemporaryLocationStateLayerV11 } = require('./temporary-location-state-v11');\n",
    "const { TemporaryLocationStateLayerV11 } = require('./temporary-location-state-v11');\nconst { CrossVideoContinuityGateV11 } = require('./cross-video-continuity-gate-v11');\n",
    'Cross-Video Continuity import'
  );
  s = replaceOnce(
    s,
    "    this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11(db, { logger: this.logger, semanticPropVerifier: this.semanticPropVerifier });\n",
    "    this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11(db, { logger: this.logger, semanticPropVerifier: this.semanticPropVerifier });\n    this.crossVideoContinuityGate = options.crossVideoContinuityGate || new CrossVideoContinuityGateV11(db, { logger: this.logger });\n",
    'construct Cross-Video Continuity Gate'
  );
  s = replaceOnce(
    s,
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine, environmentContinuityValidator: this.environmentContinuityValidator });\n",
    "    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine, environmentContinuityValidator: this.environmentContinuityValidator, crossVideoContinuityGate: this.crossVideoContinuityGate });\n",
    'pass Cross-Video Continuity Gate into keyframe pipeline'
  );
  write(rel, s);
}

function patchKeyframeRuntime() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    this.environmentContinuityValidator = options.environmentContinuityValidator || null;\n",
    "    this.environmentContinuityValidator = options.environmentContinuityValidator || null;\n    this.crossVideoContinuityGate = options.crossVideoContinuityGate || null;\n",
    'Cross-Video Continuity Gate option'
  );

  const readyAnchor = "        await this.db.updateShotKeyframe(current.id, {\n          status: 'ready',\n";
  const gateBlock = [
    "        let crossVideoContinuityResult = null;",
    "        if (this.crossVideoContinuityGate) {",
    "          crossVideoContinuityResult = await this.crossVideoContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 });",
    "          if (!crossVideoContinuityResult.accepted) {",
    "            await this.db.updateShotKeyframe(current.id, {",
    "              status: 'cross_video_continuity_failed',",
    "              assetPath,",
    "              error: 'Cross-video continuity blocked: ' + (crossVideoContinuityResult.reasons || []).join(', ')",
    "            });",
    "            const crossVideoError = new Error('Cross-video continuity validation failed for keyframe ' + current.id + ': status=' + crossVideoContinuityResult.status + ' structure=' + Number(crossVideoContinuityResult.structuralScore || 0).toFixed(3));",
    "            crossVideoError.code = 'CROSS_VIDEO_CONTINUITY_FAILED';",
    "            crossVideoError.keyframeId = current.id;",
    "            crossVideoError.shotId = current.shotId;",
    "            crossVideoError.sceneId = sceneId;",
    "            throw crossVideoError;",
    "          }",
    "        }",
    ""
  ].join('\n');
  s = insertBefore(s, readyAnchor, gateBlock, 'gate cross-video reusable location continuity before keyframe becomes ready');
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderCrossVideoContinuity(item) {",
    "  if (!Array.isArray(item?.crossVideoContinuityChecks) || !item.crossVideoContinuityChecks.length) return '';",
    "  const latest = new Map();",
    "  for (const check of item.crossVideoContinuityChecks) {",
    "    const current = latest.get(check.keyframeId);",
    "    if (!current || Number(check.attempt || 0) > Number(current.attempt || 0) || (Number(check.attempt || 0) === Number(current.attempt || 0) && String(check.createdAt || '') >= String(current.createdAt || ''))) latest.set(check.keyframeId, check);",
    "  }",
    "  const values = [...latest.values()];",
    "  const crossVideo = values.filter(check => check.reusedAcrossVideos);",
    "  const accepted = crossVideo.filter(check => check.accepted).length;",
    "  const blocked = crossVideo.filter(check => !check.accepted).length;",
    "  const cards = values.slice(0, 40).map(check => {",
    "    const cls = check.accepted ? 'pass' : 'fail';",
    "    const mode = check.reusedAcrossVideos ? 'cross-video' : 'origin';",
    "    return `<div class=\"quality-check ${cls}\"><strong>${escapeHTML(check.locationId || 'unresolved')} / ${escapeHTML(check.zoneId || 'whole location')}</strong><br><small>${escapeHTML(mode)} · ${escapeHTML(check.status || '')} · anchor ${escapeHTML(check.anchorMode || 'none')}<br>structure ${Math.round(Number(check.structuralScore || 0) * 100)}% · appearance ${Math.round(Number(check.appearanceScore || 0) * 100)}% · threshold ${Math.round(Number(check.threshold || 0) * 100)}%<br>${escapeHTML((check.reasons || []).join(', ') || 'accepted')}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel cross-video-continuity-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">CROSS-VIDEO CONTINUITY GATE V11.9.6</p><h3>Canonical location/zone drift gate</h3></div></div><p>${accepted}/${crossVideo.length} reused keyframe decision(s) accepted · ${blocked} blocked. Temporary state may relax appearance, never canonical structure.</p><div class=\"quality-grid\">${cards}</div><small>Zone scenes require their canonical zone_reference by default. Missing anchors and structural drift fail closed before a keyframe becomes ready.</small></section>`;",
    "}",
    ""
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'Cross-Video Continuity dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderTemporaryLocationStates(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderTemporaryLocationStates(item)}\n        ${renderCrossVideoContinuity(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show Cross-Video Continuity after temporary states'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:cross-video-continuity'] = 'node ../bootstrap/verify-phase11-cross-video-continuity.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('CROSS_VIDEO_CONTINUITY_ENABLED=')) {
    env += `\n# Phase 11.9.6 — block cross-video reusable location/zone drift before keyframes become ready.\nCROSS_VIDEO_CONTINUITY_ENABLED=true\n# Cross-video reuse without the required canonical asset fails closed.\nCROSS_VIDEO_CONTINUITY_REQUIRE_CANONICAL_ASSET=true\n# Zone scenes require their own 11.9.3 zone_reference by default; do not compare a room against a whole-location master.\nCROSS_VIDEO_CONTINUITY_ALLOW_LOCATION_FALLBACK_FOR_ZONE=false\n# Structural continuity remains required even when temporary state changes appearance.\nCROSS_VIDEO_CONTINUITY_STRUCTURAL_MIN_SCORE=0.44\n# Applied only when no active 11.9.5 temporary state legitimately changes appearance.\nCROSS_VIDEO_CONTINUITY_APPEARANCE_MIN_SCORE=0.35\n# Optional local override; SEMANTIC_PROP_REQUIRE_VERIFICATION=true also forces semantic evidence here.\nCROSS_VIDEO_CONTINUITY_REQUIRE_SEMANTIC=false\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchKeyframeRuntime();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.9.6 ativa: reutilizacao cross-video e bloqueada quando location/zone diverge do asset canonico; estados temporarios podem variar aparencia, nunca identidade estrutural.');
