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
  if (index === -1) throw new Error(`Phase 11.7.6 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.7.6 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'environment-continuity-validator-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/environment-continuity-validator-v11.js');
  write('utils/environment-continuity-validator-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.7.6 environment continuity audit trail",
    "      `CREATE TABLE IF NOT EXISTS environment_continuity_checks (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        shot_id TEXT NOT NULL,",
    "        keyframe_id TEXT NOT NULL,",
    "        environment_id TEXT,",
    "        version TEXT NOT NULL DEFAULT '11.7.6',",
    "        attempt INTEGER NOT NULL DEFAULT 0,",
    "        score REAL NOT NULL DEFAULT 0,",
    "        threshold REAL NOT NULL DEFAULT 0,",
    "        status TEXT NOT NULL,",
    "        metrics TEXT NOT NULL DEFAULT '{}',",
    "        reasons TEXT NOT NULL DEFAULT '[]',",
    "        master_frame_path TEXT,",
    "        master_asset_sha256 TEXT,",
    "        master_fingerprint TEXT,",
    "        candidate_fingerprint TEXT,",
    "        prop_prompt_coverage REAL,",
    "        missing_prop_lock_ids TEXT NOT NULL DEFAULT '[]',",
    "        semantic_prop_presence_verified INTEGER NOT NULL DEFAULT 0,",
    "        created_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (keyframe_id) REFERENCES shot_keyframes(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_environment_continuity_prod ON environment_continuity_checks(production_id, scene_id, shot_id, keyframe_id, attempt)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'environment continuity table');

  const methods = [
    "  async saveEnvironmentContinuityCheck(input = {}) {",
    "    if (!input.productionId || !input.sceneId || !input.shotId || !input.keyframeId) return null;",
    "    const id = input.id || this.generateId('environment_continuity');",
    "    await this.executeQuery(",
    "      `INSERT INTO environment_continuity_checks (",
    "        id, production_id, scene_id, shot_id, keyframe_id, environment_id, version, attempt, score, threshold, status, metrics, reasons,",
    "        master_frame_path, master_asset_sha256, master_fingerprint, candidate_fingerprint, prop_prompt_coverage, missing_prop_lock_ids,",
    "        semantic_prop_presence_verified, created_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [id, input.productionId, input.sceneId, input.shotId, input.keyframeId, input.environmentId || null, String(input.version || '11.7.6'),",
    "       Number(input.attempt || 0), Number(input.score || 0), Number(input.threshold || 0), input.status || 'unknown',",
    "       JSON.stringify(input.metrics || {}), JSON.stringify(input.reasons || []), input.masterFramePath || null, input.masterAssetSha256 || null,",
    "       input.masterFingerprint || null, input.candidateFingerprint || null, input.propPromptCoverage == null ? null : Number(input.propPromptCoverage),",
    "       JSON.stringify(input.missingPropLockIds || []), input.semanticPropPresenceVerified ? 1 : 0, input.createdAt || new Date().toISOString()]",
    "    );",
    "    return this.getRow('SELECT * FROM environment_continuity_checks WHERE id = ?', [id]);",
    "  }",
    "",
    "  async listEnvironmentContinuityChecks(productionId) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM environment_continuity_checks WHERE production_id = ? ORDER BY created_at, attempt, rowid',",
    "      [productionId]",
    "    );",
    "    return rows.map(row => this.parseEnvironmentContinuityCheck(row));",
    "  }",
    "",
    "  async getLatestEnvironmentContinuityCheck(productionId, keyframeId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM environment_continuity_checks WHERE production_id = ? AND keyframe_id = ? ORDER BY attempt DESC, created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId, keyframeId]",
    "    );",
    "    return this.parseEnvironmentContinuityCheck(row);",
    "  }",
    "",
    "  parseEnvironmentContinuityCheck(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, shotId: row.shot_id, keyframeId: row.keyframe_id,",
    "      environmentId: row.environment_id, version: row.version || '11.7.6', attempt: Number(row.attempt || 0), score: Number(row.score || 0),",
    "      threshold: Number(row.threshold || 0), status: row.status, metrics: JSON.parse(row.metrics || '{}'), reasons: JSON.parse(row.reasons || '[]'),",
    "      masterFramePath: row.master_frame_path, masterAssetSha256: row.master_asset_sha256, masterFingerprint: row.master_fingerprint,",
    "      candidateFingerprint: row.candidate_fingerprint, propPromptCoverage: row.prop_prompt_coverage == null ? null : Number(row.prop_prompt_coverage),",
    "      missingPropLockIds: JSON.parse(row.missing_prop_lock_ids || '[]'), semanticPropPresenceVerified: Number(row.semantic_prop_presence_verified || 0) === 1,",
    "      createdAt: row.created_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'environment continuity DB methods');

  const loadAnchor = "    const shotEnvironmentContexts = await this.listShotEnvironmentContexts(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const environmentContinuityChecks = await this.listEnvironmentContinuityChecks(productionId);\n", 'load environment continuity checks in bundle');
  s = replaceOnce(s, "      shotEnvironmentContexts,\n", "      shotEnvironmentContexts,\n      environmentContinuityChecks,\n", 'expose environment continuity checks in bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { CartoonContinuityEngineV11 } = require('./cartoon-continuity-engine-v11');\n",
    "const { CartoonContinuityEngineV11 } = require('./cartoon-continuity-engine-v11');\nconst { EnvironmentContinuityValidatorV11 } = require('./environment-continuity-validator-v11');\n",
    'Environment Continuity Validator import'
  );
  s = replaceOnce(
    s,
    "    this.continuityEngine = options.continuityEngine || new CartoonContinuityEngineV11(db, { logger: this.logger });\n    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine });\n",
    "    this.continuityEngine = options.continuityEngine || new CartoonContinuityEngineV11(db, { logger: this.logger });\n    this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11(db, { logger: this.logger });\n    this.keyframePipeline = options.keyframePipeline || new CartoonKeyframePipelineV11(db, videoGenerator, { logger: this.logger, dataRoot: this.dataRoot, continuityEngine: this.continuityEngine, environmentContinuityValidator: this.environmentContinuityValidator });\n",
    'construct Environment Continuity Validator before keyframe pipeline'
  );
  write(rel, s);
}

function patchKeyframeRuntime() {
  const rel = 'utils/cartoon-keyframe-pipeline-v11.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "    this.continuityEngine = options.continuityEngine || null;\n",
    "    this.continuityEngine = options.continuityEngine || null;\n    this.environmentContinuityValidator = options.environmentContinuityValidator || null;\n",
    'environment continuity validator option'
  );

  const sortAnchor = "    keyframes = [...keyframes].sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0) || Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0));\n\n";
  s = replaceOnce(
    s,
    sortAnchor,
    sortAnchor + "    if (this.environmentContinuityValidator) await this.environmentContinuityValidator.assertSceneReady(productionId, sceneId);\n\n",
    'fail closed before generating keyframes without mapped canonical environment'
  );

  const readyAnchor = "        await this.db.updateShotKeyframe(current.id, {\n          status: 'ready',\n";
  const environmentBlock = [
    "        let environmentContinuityResult = null;",
    "        if (this.environmentContinuityValidator) {",
    "          environmentContinuityResult = await this.environmentContinuityValidator.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 });",
    "          if (!environmentContinuityResult.accepted) {",
    "            await this.db.updateShotKeyframe(current.id, {",
    "              status: 'environment_continuity_failed',",
    "              assetPath,",
    "              error: 'Environment continuity score ' + Number(environmentContinuityResult.score || 0).toFixed(3) + ' below ' + Number(environmentContinuityResult.threshold || 0).toFixed(3)",
    "            });",
    "            const environmentError = new Error('Environment continuity validation failed for keyframe ' + current.id + ': status=' + environmentContinuityResult.status + ' score=' + Number(environmentContinuityResult.score || 0).toFixed(3) + ' threshold=' + Number(environmentContinuityResult.threshold || 0).toFixed(3));",
    "            environmentError.code = 'ENVIRONMENT_CONTINUITY_FAILED';",
    "            environmentError.keyframeId = current.id;",
    "            environmentError.shotId = current.shotId;",
    "            environmentError.sceneId = sceneId;",
    "            throw environmentError;",
    "          }",
    "        }",
    "",
  ].join('\n');
  s = insertBefore(s, readyAnchor, environmentBlock, 'validate environment before keyframe becomes ready');
  write(rel, s);
}

function patchCharacterContinuityBoundary() {
  const rel = 'utils/cartoon-continuity-engine-v11.js';
  let s = read(rel);
  if (s.includes("    if (!keyframe.referenceKeyframeId && !referenceAssetPath) {\n")) {
    s = s.replace(
      "    if (!keyframe.referenceKeyframeId && !referenceAssetPath) {\n",
      "    if (!keyframe.referenceKeyframeId) {\n"
    );
  }
  write(rel, s);
}

function patchCartoonQualityGate() {
  const rel = 'utils/cartoon-quality-gate-v11.js';
  let s = read(rel);

  const helper = [
    "function latestEnvironmentContinuityByKeyframe(checks = []) {",
    "  const latest = new Map();",
    "  for (const check of checks || []) {",
    "    const key = check.keyframeId || check.keyframe_id;",
    "    if (!key) continue;",
    "    const current = latest.get(key);",
    "    const attempt = Number(check.attempt || 0);",
    "    const currentAttempt = current ? Number(current.attempt || 0) : -1;",
    "    const created = String(check.createdAt || check.created_at || '');",
    "    const currentCreated = current ? String(current.createdAt || current.created_at || '') : '';",
    "    if (!current || attempt > currentAttempt || (attempt === currentAttempt && created >= currentCreated)) latest.set(key, check);",
    "  }",
    "  return latest;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function isCartoonProduction(production = {}) {\n', helper, 'latest environment continuity helper');

  s = replaceOnce(
    s,
    "  const continuityChecks = Array.isArray(production.continuityChecks) ? production.continuityChecks : [];\n",
    "  const continuityChecks = Array.isArray(production.continuityChecks) ? production.continuityChecks : [];\n  const environmentContinuityChecks = Array.isArray(production.environmentContinuityChecks) ? production.environmentContinuityChecks : [];\n  const shotEnvironmentContexts = Array.isArray(production.shotEnvironmentContexts) ? production.shotEnvironmentContexts : [];\n",
    'load Phase 11.7.6 quality inputs'
  );
  s = replaceOnce(
    s,
    "  const latestContinuity = latestContinuityByKeyframe(continuityChecks);\n",
    "  const latestContinuity = latestContinuityByKeyframe(continuityChecks);\n  const latestEnvironmentContinuity = latestEnvironmentContinuityByKeyframe(environmentContinuityChecks);\n",
    'latest environment continuity decisions'
  );
  s = replaceOnce(
    s,
    "  const motionByShot = new Map(motionSegments.map(item => [item.shotId, item]));\n  const motionByScene = new Map(motionScenes.map(item => [item.sceneId, item]));\n",
    "  const motionByShot = new Map(motionSegments.map(item => [item.shotId, item]));\n  const motionByScene = new Map(motionScenes.map(item => [item.sceneId, item]));\n  const environmentContextByShot = new Map(shotEnvironmentContexts.map(item => [item.shotId, item]));\n",
    'map shot environment contexts for quality gate'
  );
  s = replaceOnce(
    s,
    "  let acceptedContinuityCount = 0;\n",
    "  let acceptedContinuityCount = 0;\n  let environmentContinuityMissing = 0;\n  let environmentContinuityRejected = 0;\n  let environmentContinuityScoreTotal = 0;\n  let environmentContinuityScoreCount = 0;\n",
    'environment continuity quality counters'
  );

  const block = [
    "    const environmentContext = environmentContextByShot.get(shot.id);",
    "    if (environmentContext?.environmentId) {",
    "      for (const frame of frames) {",
    "        const environmentCheck = latestEnvironmentContinuity.get(frame.id);",
    "        if (!environmentCheck) {",
    "          environmentContinuityMissing += 1;",
    "          score -= 16;",
    "          findings.push(qualityFinding(",
    "            'cartoon_environment_continuity_missing', 'CRITICAL',",
    "            `No persisted Phase 11.7.6 environment continuity decision exists for ${frame.keyframeRole || 'keyframe'}.`,",
    "            'Run Environment Continuity Validation against the canonical Master Environment before motion composition.',",
    "            { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id, evidence: { environmentId: environmentContext.environmentId } }",
    "          ));",
    "          continue;",
    "        }",
    "        const status = String(environmentCheck.status || '');",
    "        const environmentScore = Number(environmentCheck.score || 0);",
    "        const threshold = Number(environmentCheck.threshold || 0);",
    "        if (status !== 'accepted' || environmentScore < threshold) {",
    "          environmentContinuityRejected += 1;",
    "          score -= 20;",
    "          findings.push(qualityFinding(",
    "            'cartoon_environment_continuity_rejected', 'CRITICAL',",
    "            `Environment continuity is not accepted for ${frame.keyframeRole || 'keyframe'} (${environmentScore.toFixed(3)} < ${threshold.toFixed(3)} or status=${status}).`,",
    "            'Regenerate the frame against the same Environment ID and canonical Master Environment; do not publish with unresolved location drift.',",
    "            { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id, evidence: { status, score: environmentScore, threshold, environmentId: environmentContext.environmentId } }",
    "          ));",
    "        } else {",
    "          environmentContinuityScoreTotal += environmentScore;",
    "          environmentContinuityScoreCount += 1;",
    "        }",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (shotDigests.length === 3) {\n", block, 'require environment continuity for mapped shots');

  s = replaceOnce(
    s,
    "    referenceConditioningRate: acceptedContinuityCount ? Number((referenceConditionedAccepted / acceptedContinuityCount).toFixed(4)) : null,\n    averageGenericAiRisk: averageGenericAiRisk === null ? null : Number(averageGenericAiRisk.toFixed(2)),\n",
    "    referenceConditioningRate: acceptedContinuityCount ? Number((referenceConditionedAccepted / acceptedContinuityCount).toFixed(4)) : null,\n    environmentContinuityMissing,\n    environmentContinuityRejected,\n    averageEnvironmentContinuityScore: environmentContinuityScoreCount ? Number((environmentContinuityScoreTotal / environmentContinuityScoreCount).toFixed(4)) : null,\n    environmentPropPresenceMode: 'prompt-contract-only',\n    averageGenericAiRisk: averageGenericAiRisk === null ? null : Number(averageGenericAiRisk.toFixed(2)),\n",
    'expose environment continuity quality metrics'
  );
  s = replaceOnce(
    s,
    "    continuity: [...latestContinuity.entries()].map(([id, check]) => ({ id, attempt: check.attempt, score: check.score, threshold: check.threshold, status: check.status })),\n    motionSegments: motionSegments.map(item => ({ shotId: item.shotId, fingerprint: item.fingerprint, status: item.status, outputPath: item.outputPath })),\n",
    "    continuity: [...latestContinuity.entries()].map(([id, check]) => ({ id, attempt: check.attempt, score: check.score, threshold: check.threshold, status: check.status })),\n    environmentContinuity: [...latestEnvironmentContinuity.entries()].map(([id, check]) => ({ id, attempt: check.attempt, environmentId: check.environmentId, score: check.score, threshold: check.threshold, status: check.status, candidateFingerprint: check.candidateFingerprint })),\n    shotEnvironmentContexts: shotEnvironmentContexts.map(item => ({ shotId: item.shotId, environmentId: item.environmentId, contextFingerprint: item.contextFingerprint, masterAssetSha256: item.masterAssetSha256 })),\n    motionSegments: motionSegments.map(item => ({ shotId: item.shotId, fingerprint: item.fingerprint, status: item.status, outputPath: item.outputPath })),\n",
    'include environment continuity in quality fingerprint'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderEnvironmentContinuity(item) {",
    "  if (!Array.isArray(item?.environmentContinuityChecks) || !item.environmentContinuityChecks.length) return '';",
    "  const latest = new Map();",
    "  for (const check of item.environmentContinuityChecks) {",
    "    const current = latest.get(check.keyframeId);",
    "    if (!current || Number(check.attempt || 0) >= Number(current.attempt || 0)) latest.set(check.keyframeId, check);",
    "  }",
    "  const values = [...latest.values()];",
    "  const accepted = values.filter(check => check.status === 'accepted').length;",
    "  const cards = values.slice(0, 30).map(check => {",
    "    const ok = check.status === 'accepted' && Number(check.score || 0) >= Number(check.threshold || 0);",
    "    const metrics = check.metrics || {};",
    "    return `<div class=\"quality-check ${ok ? 'pass' : 'fail'}\"><strong>${escapeHTML(check.environmentId || 'environment')} · ${escapeHTML(check.status || '')} · ${Math.round(Number(check.score || 0) * 100)}%</strong><br><small>palette ${Math.round(Number(metrics.palette || 0) * 100)}% · layout ${Math.round(Number(metrics.compositionGrid || 0) * 100)}% · structure ${Math.round(Number(metrics.edgeDensity || 0) * 100)}%<br>Prop prompt coverage: ${Math.round(Number(metrics.propPromptCoverage ?? 1) * 100)}%</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel environment-continuity-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">ENVIRONMENT CONTINUITY V11.7.6</p><h3>Canonical location drift gate</h3></div></div><p>${accepted}/${values.length} latest keyframe decision(s) accepted against canonical Master Environments.</p><div class=\"quality-grid\">${cards}</div><small>Palette/layout/structure are image-validated. Required prop names are enforced in the prompt contract; semantic object presence is not claimed without a vision detector.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'environment continuity dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderEnvironmentPromptEnrichment(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderEnvironmentPromptEnrichment(item)}\n        ${renderEnvironmentContinuity(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show environment continuity after prompt enrichment'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:environment-continuity'] = 'node ../bootstrap/verify-phase11-environment-continuity.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('ENVIRONMENT_CONTINUITY_ENABLED=')) {
    env += `\n# Phase 11.7.6 — fail-closed environment drift validation against canonical Master Environment frames.\nENVIRONMENT_CONTINUITY_ENABLED=true\nENVIRONMENT_CONTINUITY_REQUIRE_MASTER=true\nENVIRONMENT_CONTINUITY_MIN_SCORE=0.42\n# Required prop names must remain in every enriched shot/keyframe prompt. This is not semantic object detection.\nENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE=1\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchKeyframeRuntime();
patchCharacterContinuityBoundary();
patchCartoonQualityGate();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.7.6 ativa: keyframes agora exigem Environment mapping + Master Environment canonico, validacao de deriva visual persistida e Quality Gate fail-closed.');
