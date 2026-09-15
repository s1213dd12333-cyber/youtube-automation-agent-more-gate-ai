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
  if (index === -1) throw new Error(`Phase 11.8 anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.8 anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function copyService() {
  const template = path.join(root, 'bootstrap', 'templates', 'semantic-prop-verifier-v11.js');
  if (!fs.existsSync(template)) throw new Error('Missing bootstrap/templates/semantic-prop-verifier-v11.js');
  write('utils/semantic-prop-verifier-v11.js', fs.readFileSync(template, 'utf8'));
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const settingsAnchor = "            // System Settings\n      `CREATE TABLE IF NOT EXISTS settings (\n";
  const table = [
    "      // Phase 11.8 semantic prop/layout verification audit trail",
    "      `CREATE TABLE IF NOT EXISTS semantic_prop_checks (",
    "        id TEXT PRIMARY KEY,",
    "        production_id TEXT NOT NULL,",
    "        scene_id TEXT NOT NULL,",
    "        shot_id TEXT NOT NULL,",
    "        keyframe_id TEXT NOT NULL,",
    "        environment_id TEXT,",
    "        version TEXT NOT NULL DEFAULT '11.8',",
    "        provider_mode TEXT,",
    "        model TEXT,",
    "        provider_used INTEGER NOT NULL DEFAULT 0,",
    "        available INTEGER NOT NULL DEFAULT 0,",
    "        status TEXT NOT NULL,",
    "        verified INTEGER NOT NULL DEFAULT 0,",
    "        confidence REAL NOT NULL DEFAULT 0,",
    "        environment_matches INTEGER,",
    "        layout_consistent INTEGER,",
    "        props TEXT NOT NULL DEFAULT '[]',",
    "        missing_prop_lock_ids TEXT NOT NULL DEFAULT '[]',",
    "        mismatched_prop_lock_ids TEXT NOT NULL DEFAULT '[]',",
    "        reasons TEXT NOT NULL DEFAULT '[]',",
    "        notes TEXT,",
    "        error TEXT,",
    "        prompt_fingerprint TEXT NOT NULL,",
    "        response_fingerprint TEXT,",
    "        created_at TEXT NOT NULL,",
    "        FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (scene_id) REFERENCES production_scenes(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (shot_id) REFERENCES scene_shots(id) ON DELETE CASCADE,",
    "        FOREIGN KEY (keyframe_id) REFERENCES shot_keyframes(id) ON DELETE CASCADE",
    "      )`,",
    "      `CREATE INDEX IF NOT EXISTS idx_semantic_prop_checks_prod ON semantic_prop_checks(production_id, scene_id, shot_id, keyframe_id, created_at)`,",
    ""
  ].join('\n');
  s = insertBefore(s, settingsAnchor, table, 'semantic prop verification table');

  const methods = [
    "  async saveSemanticPropCheck(input = {}) {",
    "    if (!input.productionId || !input.sceneId || !input.shotId || !input.keyframeId || !input.promptFingerprint) return null;",
    "    const id = input.id || this.generateId('semantic_prop_check');",
    "    const createdAt = input.createdAt || new Date().toISOString();",
    "    await this.executeQuery(",
    "      `INSERT INTO semantic_prop_checks (",
    "        id, production_id, scene_id, shot_id, keyframe_id, environment_id, version, provider_mode, model, provider_used, available,",
    "        status, verified, confidence, environment_matches, layout_consistent, props, missing_prop_lock_ids, mismatched_prop_lock_ids,",
    "        reasons, notes, error, prompt_fingerprint, response_fingerprint, created_at",
    "      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,",
    "      [id, input.productionId, input.sceneId, input.shotId, input.keyframeId, input.environmentId || null, String(input.version || '11.8'),",
    "       input.providerMode || null, input.model || null, input.providerUsed ? 1 : 0, input.available ? 1 : 0, input.status || 'unknown',",
    "       input.semanticPropPresenceVerified ? 1 : 0, Number(input.confidence || 0), input.environmentMatches == null ? null : (input.environmentMatches ? 1 : 0),",
    "       input.layoutConsistent == null ? null : (input.layoutConsistent ? 1 : 0), JSON.stringify(input.props || []),",
    "       JSON.stringify(input.missingPropLockIds || []), JSON.stringify(input.mismatchedPropLockIds || []), JSON.stringify(input.reasons || []),",
    "       input.notes || null, input.error || null, input.promptFingerprint, input.responseFingerprint || null, createdAt]",
    "    );",
    "    return this.getLatestSemanticPropCheck(input.productionId, input.keyframeId);",
    "  }",
    "",
    "  async getLatestSemanticPropCheck(productionId, keyframeId) {",
    "    const row = await this.getRow(",
    "      'SELECT * FROM semantic_prop_checks WHERE production_id = ? AND keyframe_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',",
    "      [productionId, keyframeId]",
    "    );",
    "    return this.parseSemanticPropCheck(row);",
    "  }",
    "",
    "  async listSemanticPropChecks(productionId) {",
    "    const rows = await this.getAllRows(",
    "      'SELECT * FROM semantic_prop_checks WHERE production_id = ? ORDER BY created_at, rowid',",
    "      [productionId]",
    "    );",
    "    return rows.map(row => this.parseSemanticPropCheck(row));",
    "  }",
    "",
    "  parseSemanticPropCheck(row) {",
    "    if (!row) return null;",
    "    return {",
    "      id: row.id, productionId: row.production_id, sceneId: row.scene_id, shotId: row.shot_id, keyframeId: row.keyframe_id,",
    "      environmentId: row.environment_id, version: row.version || '11.8', providerMode: row.provider_mode, model: row.model,",
    "      providerUsed: Number(row.provider_used || 0) === 1, available: Number(row.available || 0) === 1, status: row.status,",
    "      semanticPropPresenceVerified: Number(row.verified || 0) === 1, confidence: Number(row.confidence || 0),",
    "      environmentMatches: row.environment_matches == null ? null : Number(row.environment_matches) === 1,",
    "      layoutConsistent: row.layout_consistent == null ? null : Number(row.layout_consistent) === 1,",
    "      props: JSON.parse(row.props || '[]'), missingPropLockIds: JSON.parse(row.missing_prop_lock_ids || '[]'),",
    "      mismatchedPropLockIds: JSON.parse(row.mismatched_prop_lock_ids || '[]'), reasons: JSON.parse(row.reasons || '[]'),",
    "      notes: row.notes, error: row.error, promptFingerprint: row.prompt_fingerprint, responseFingerprint: row.response_fingerprint, createdAt: row.created_at",
    "    };",
    "  }",
    "",
    ""
  ].join('\n');
  s = insertBefore(s, '  // Content Strategy methods\n', methods, 'semantic prop DB methods');

  const loadAnchor = "    const environmentContinuityChecks = await this.listEnvironmentContinuityChecks(productionId);\n";
  s = replaceOnce(s, loadAnchor, loadAnchor + "    const semanticPropChecks = await this.listSemanticPropChecks(productionId);\n", 'load semantic prop checks in production bundle');
  s = replaceOnce(s, "      environmentContinuityChecks,\n", "      environmentContinuityChecks,\n      semanticPropChecks,\n", 'expose semantic prop checks in production bundle');
  write(rel, s);
}

function patchScenePipeline() {
  const rel = 'utils/scene-pipeline-v2.js';
  let s = read(rel);
  s = replaceOnce(
    s,
    "const { EnvironmentContinuityValidatorV11 } = require('./environment-continuity-validator-v11');\n",
    "const { EnvironmentContinuityValidatorV11 } = require('./environment-continuity-validator-v11');\nconst { SemanticPropVerifierV11 } = require('./semantic-prop-verifier-v11');\n",
    'Semantic Prop verifier import'
  );
  s = replaceOnce(
    s,
    "    this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11(db, { logger: this.logger });\n",
    "    this.semanticPropVerifier = options.semanticPropVerifier || new SemanticPropVerifierV11(db, { logger: this.logger });\n    this.environmentContinuityValidator = options.environmentContinuityValidator || new EnvironmentContinuityValidatorV11(db, { logger: this.logger, semanticPropVerifier: this.semanticPropVerifier });\n",
    'construct Semantic Prop verifier before Environment Continuity'
  );
  write(rel, s);
}

function patchEnvironmentContinuity() {
  const rel = 'utils/environment-continuity-validator-v11.js';
  let s = read(rel);

  s = replaceOnce(
    s,
    "    this.minPropPromptCoverage = Number.isFinite(propCoverage) ? Math.max(0, Math.min(1, propCoverage)) : 1;\n",
    "    this.minPropPromptCoverage = Number.isFinite(propCoverage) ? Math.max(0, Math.min(1, propCoverage)) : 1;\n    this.semanticPropVerifier = options.semanticPropVerifier || null;\n    this.requireSemantic = String(options.requireSemantic ?? process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';\n",
    'attach semantic verifier and fail-closed option'
  );

  s = replaceOnce(
    s,
    "    const visualAccepted = scored.score >= this.threshold;\n    const promptAccepted = propCoverage.coverage >= this.minPropPromptCoverage;\n    const accepted = visualAccepted && promptAccepted;\n    const reasons = [];\n",
    "    const visualAccepted = scored.score >= this.threshold;\n    const promptAccepted = propCoverage.coverage >= this.minPropPromptCoverage;\n    let semanticResult = null;\n    if (this.semanticPropVerifier && visualAccepted && promptAccepted) {\n      semanticResult = await this.semanticPropVerifier.verify({\n        productionId, sceneId, shotId: keyframe.shotId, keyframe, assetPath,\n        environment: context.environment, mapping: context.mapping, propLocks: context.propLocks\n      });\n    }\n    const semanticVerified = semanticResult?.semanticPropPresenceVerified === true;\n    const semanticAccepted = !this.requireSemantic || semanticVerified;\n    const accepted = visualAccepted && promptAccepted && semanticAccepted;\n    const reasons = [];\n",
    'run semantic prop verification after perceptual checks'
  );

  s = replaceOnce(
    s,
    "    if (!promptAccepted) reasons.push('REQUIRED_PROP_PROMPT_COVERAGE_MISSING');\n\n    const result = {\n",
    "    if (!promptAccepted) reasons.push('REQUIRED_PROP_PROMPT_COVERAGE_MISSING');\n    if (this.requireSemantic && !semanticResult) reasons.push('SEMANTIC_PROP_VERIFICATION_REQUIRED');\n    if (this.requireSemantic && semanticResult && !semanticVerified) {\n      reasons.push(semanticResult.status === 'unavailable' ? 'SEMANTIC_PROP_PROVIDER_UNAVAILABLE' : 'SEMANTIC_PROP_VERIFICATION_FAILED');\n    }\n\n    const result = {\n",
    'record semantic verification blockers'
  );

  s = replaceOnce(
    s,
    "        semanticPropPresenceVerified: false,\n        propVerificationMode: 'prompt-contract-only'\n",
    "        semanticPropPresenceVerified: semanticVerified,\n        propVerificationMode: semanticVerified ? 'vision-verified' : (semanticResult?.providerUsed ? 'vision-audited' : 'prompt-contract-only'),\n        semanticVerificationRequired: this.requireSemantic,\n        semanticVerificationStatus: semanticResult?.status || 'not_run',\n        semanticVerificationConfidence: semanticResult?.confidence ?? null,\n        semanticProviderMode: semanticResult?.providerMode || null,\n        semanticModel: semanticResult?.model || null\n",
    'publish truthful semantic metrics'
  );

  s = replaceOnce(
    s,
    "      semanticPropPresenceVerified: false,\n      version: VERSION\n",
    "      semanticPropPresenceVerified: result.metrics?.semanticPropPresenceVerified === true,\n      version: VERSION\n",
    'persist semantic verification truth into environment continuity record'
  );
  write(rel, s);
}

function patchCartoonQualityGate() {
  const rel = 'utils/cartoon-quality-gate-v11.js';
  let s = read(rel);

  const helper = [
    "function latestSemanticPropByKeyframe(checks = []) {",
    "  const latest = new Map();",
    "  for (const check of checks || []) {",
    "    const key = check.keyframeId || check.keyframe_id;",
    "    if (!key) continue;",
    "    const current = latest.get(key);",
    "    const created = String(check.createdAt || check.created_at || '');",
    "    const currentCreated = current ? String(current.createdAt || current.created_at || '') : '';",
    "    if (!current || created >= currentCreated) latest.set(key, check);",
    "  }",
    "  return latest;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function isCartoonProduction(production = {}) {\n', helper, 'latest semantic prop helper');

  s = replaceOnce(
    s,
    "  const shotEnvironmentContexts = Array.isArray(production.shotEnvironmentContexts) ? production.shotEnvironmentContexts : [];\n",
    "  const shotEnvironmentContexts = Array.isArray(production.shotEnvironmentContexts) ? production.shotEnvironmentContexts : [];\n  const semanticPropChecks = Array.isArray(production.semanticPropChecks) ? production.semanticPropChecks : [];\n  const semanticPropRequireVerification = String(process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';\n",
    'load Phase 11.8 quality inputs'
  );
  s = replaceOnce(
    s,
    "  const latestEnvironmentContinuity = latestEnvironmentContinuityByKeyframe(environmentContinuityChecks);\n",
    "  const latestEnvironmentContinuity = latestEnvironmentContinuityByKeyframe(environmentContinuityChecks);\n  const latestSemanticProp = latestSemanticPropByKeyframe(semanticPropChecks);\n",
    'latest semantic prop decisions'
  );
  s = replaceOnce(
    s,
    "  let environmentContinuityScoreCount = 0;\n",
    "  let environmentContinuityScoreCount = 0;\n  let semanticPropMissing = 0;\n  let semanticPropRejected = 0;\n  let semanticPropVerified = 0;\n",
    'semantic prop quality counters'
  );

  const semanticBlock = [
    "    if (environmentContext?.environmentId) {",
    "      for (const frame of frames) {",
    "        const semanticCheck = latestSemanticProp.get(frame.id);",
    "        if (semanticCheck?.semanticPropPresenceVerified === true || semanticCheck?.verified === true || semanticCheck?.verified === 1) {",
    "          semanticPropVerified += 1;",
    "          continue;",
    "        }",
    "        if (!semanticCheck) semanticPropMissing += 1;",
    "        else semanticPropRejected += 1;",
    "        if (semanticPropRequireVerification) {",
    "          score -= 18;",
    "          findings.push(qualityFinding(",
    "            !semanticCheck ? 'cartoon_semantic_prop_missing' : 'cartoon_semantic_prop_rejected', 'CRITICAL',",
    "            !semanticCheck",
    "              ? `No persisted Phase 11.8 semantic prop/layout decision exists for ${frame.keyframeRole || 'keyframe'}.`",
    "              : `Semantic prop/layout verification is not accepted for ${frame.keyframeRole || 'keyframe'} (status=${semanticCheck.status || 'unknown'}).`,",
    "            'Run a configured vision verifier against the actual generated image; do not publish while required semantic prop verification is unresolved.',",
    "            { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id, evidence: { environmentId: environmentContext.environmentId, status: semanticCheck?.status || 'missing' } }",
    "          ));",
    "        }",
    "      }",
    "    }",
    "",
  ].join('\n');
  s = insertBefore(s, "    if (shotDigests.length === 3) {\n", semanticBlock, 'apply semantic prop quality gate for mapped shots');

  s = replaceOnce(
    s,
    "    environmentPropPresenceMode: 'prompt-contract-only',\n",
    "    semanticPropVerificationRequired: semanticPropRequireVerification,\n    semanticPropCheckCount: semanticPropChecks.length,\n    semanticPropMissing,\n    semanticPropRejected,\n    semanticPropVerified,\n    environmentPropPresenceMode: semanticPropVerified > 0 ? 'vision-audited' : 'prompt-contract-only',\n",
    'expose Phase 11.8 quality metrics'
  );
  s = replaceOnce(
    s,
    "    environmentContinuity: [...latestEnvironmentContinuity.entries()].map(([id, check]) => ({ id, attempt: check.attempt, environmentId: check.environmentId, score: check.score, threshold: check.threshold, status: check.status, candidateFingerprint: check.candidateFingerprint })),\n",
    "    environmentContinuity: [...latestEnvironmentContinuity.entries()].map(([id, check]) => ({ id, attempt: check.attempt, environmentId: check.environmentId, score: check.score, threshold: check.threshold, status: check.status, candidateFingerprint: check.candidateFingerprint })),\n    semanticPropChecks: [...latestSemanticProp.entries()].map(([id, check]) => ({ id, status: check.status, verified: check.semanticPropPresenceVerified === true || check.verified === true || check.verified === 1, confidence: check.confidence, responseFingerprint: check.responseFingerprint })),\n",
    'include Phase 11.8 semantic decisions in quality fingerprint'
  );
  write(rel, s);
}

function patchDashboard() {
  const rel = 'dashboard/app.js';
  let s = read(rel);
  const helper = [
    "function renderSemanticPropVerification(item) {",
    "  if (!Array.isArray(item?.semanticPropChecks) || !item.semanticPropChecks.length) return '';",
    "  const latest = new Map();",
    "  for (const check of item.semanticPropChecks) {",
    "    const current = latest.get(check.keyframeId);",
    "    if (!current || String(check.createdAt || '') >= String(current.createdAt || '')) latest.set(check.keyframeId, check);",
    "  }",
    "  const values = [...latest.values()];",
    "  const verified = values.filter(check => check.semanticPropPresenceVerified === true).length;",
    "  const cards = values.slice(0, 30).map(check => {",
    "    const ok = check.semanticPropPresenceVerified === true;",
    "    const missing = Array.isArray(check.missingPropLockIds) ? check.missingPropLockIds.length : 0;",
    "    const mismatched = Array.isArray(check.mismatchedPropLockIds) ? check.mismatchedPropLockIds.length : 0;",
    "    return `<div class=\"quality-check ${ok ? 'pass' : check.status === 'unavailable' ? '' : 'fail'}\"><strong>${escapeHTML(check.environmentId || 'environment')} · ${escapeHTML(check.status || '')} · ${Math.round(Number(check.confidence || 0) * 100)}%</strong><br><small>${escapeHTML(check.providerMode || 'no-provider')} · ${escapeHTML(check.model || 'no-model')}<br>required props missing: ${missing} · locked attributes mismatched: ${mismatched}</small></div>`;",
    "  }).join('');",
    "  return `<section class=\"panel semantic-props-v11\"><div class=\"panel-heading\"><div><p class=\"eyebrow\">SEMANTIC PROP & LAYOUT V11.8</p><h3>Vision-backed object continuity</h3></div></div><p>${verified}/${values.length} latest keyframe decision(s) have real semantic vision evidence.</p><div class=\"quality-grid\">${cards}</div><small>semanticPropPresenceVerified=true is emitted only after a configured vision analyzer inspects the actual image and returns valid structured evidence.</small></section>`;",
    "}",
    "",
  ].join('\n');
  s = insertBefore(s, 'function qualityScore(checks) {\n', helper, 'semantic prop dashboard renderer');
  s = replaceOnce(
    s,
    "        ${renderEnvironmentContinuity(item)}\n        ${renderCartoonShotPlan(item)}\n",
    "        ${renderEnvironmentContinuity(item)}\n        ${renderSemanticPropVerification(item)}\n        ${renderCartoonShotPlan(item)}\n",
    'show semantic prop verification after Environment Continuity'
  );
  write(rel, s);
}

function patchPackageAndEnv() {
  const pkgRel = 'package.json';
  const pkg = JSON.parse(read(pkgRel));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:semantic-props'] = 'node ../bootstrap/verify-phase11-semantic-prop-verification.js';
  write(pkgRel, `${JSON.stringify(pkg, null, 2)}\n`);

  const envRel = '.env.example';
  let env = read(envRel);
  if (!env.includes('SEMANTIC_PROP_VERIFICATION_ENABLED=')) {
    env += `\n# Phase 11.8 — semantic prop/layout verification using a real vision-capable endpoint.\nSEMANTIC_PROP_VERIFICATION_ENABLED=true\n# Keep false until a working vision endpoint/model is configured; when true, missing/rejected semantic evidence blocks Environment Continuity + Cartoon Quality.\nSEMANTIC_PROP_REQUIRE_VERIFICATION=false\nSEMANTIC_PROP_MIN_CONFIDENCE=0.72\n# OpenAI-compatible vision endpoint. Local example: http://127.0.0.1:11434/v1\nSEMANTIC_PROP_VISION_BASE_URL=\nSEMANTIC_PROP_VISION_MODEL=\nSEMANTIC_PROP_VISION_API_KEY=\nSEMANTIC_PROP_VISION_TIMEOUT_MS=30000\n`;
  }
  write(envRel, env);
}

copyService();
patchDatabase();
patchScenePipeline();
patchEnvironmentContinuity();
patchCartoonQualityGate();
patchDashboard();
patchPackageAndEnv();

console.log('FASE 11.8 ativa: props e layout podem ser verificados semanticamente por um endpoint vision real; semanticPropPresenceVerified nunca e inventado e o modo required e fail-closed.');
