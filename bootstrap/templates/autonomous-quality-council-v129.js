'use strict';

const crypto = require('crypto');

const VERSION = '12.9';
const PASS = 'PASS';
const REPAIR = 'REPAIR';
const BLOCK = 'BLOCK';
const VERDICTS = new Set([PASS, REPAIR, BLOCK]);

function clean(value, limit = 4000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function clamp(value, min, max, fallback) {
  const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function parseJson(value, fallback) { try { return JSON.parse(value || ''); } catch (_error) { return fallback; } }

function defaultPolicy() {
  return {
    preProductionMinScore: 88,
    postProductionMinScore: 90,
    blockOnTruthViolation: true,
    blockOnRightsViolation: true,
    requireRealVideo: true,
    requireThumbnail: true,
    requireVerifiedProvenance: true,
    requireAttributionForLockedClaims: true,
    requireVisualTruthConstraint: true,
    maxRepairFindings: 5
  };
}
function normalizePolicy(input = {}) {
  const p = { ...defaultPolicy(), ...(input || {}) };
  return {
    preProductionMinScore: Math.round(clamp(p.preProductionMinScore, 50, 100, 88)),
    postProductionMinScore: Math.round(clamp(p.postProductionMinScore, 50, 100, 90)),
    blockOnTruthViolation: Boolean(p.blockOnTruthViolation),
    blockOnRightsViolation: Boolean(p.blockOnRightsViolation),
    requireRealVideo: Boolean(p.requireRealVideo),
    requireThumbnail: Boolean(p.requireThumbnail),
    requireVerifiedProvenance: Boolean(p.requireVerifiedProvenance),
    requireAttributionForLockedClaims: Boolean(p.requireAttributionForLockedClaims),
    requireVisualTruthConstraint: Boolean(p.requireVisualTruthConstraint),
    maxRepairFindings: Math.round(clamp(p.maxRepairFindings, 0, 20, 5))
  };
}

function member(name, verdict, score, findings = [], evidence = {}) {
  return {
    name,
    verdict: VERDICTS.has(verdict) ? verdict : BLOCK,
    score: Math.round(clamp(score, 0, 100, 0)),
    findings: (findings || []).map(item => clean(item, 1000)).filter(Boolean),
    evidence
  };
}
function aggregate(members, minScore, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const blocking = members.filter(item => item.verdict === BLOCK);
  const repair = members.filter(item => item.verdict === REPAIR);
  const score = members.length ? Math.round(members.reduce((sum, item) => sum + item.score, 0) / members.length) : 0;
  let status = blocking.length ? BLOCK : repair.length ? REPAIR : PASS;
  if (status === PASS && score < minScore) status = REPAIR;
  if (status === REPAIR && repair.reduce((sum, item) => sum + item.findings.length, 0) > policy.maxRepairFindings) status = BLOCK;
  return { status, score, blockingCount: blocking.length, repairCount: repair.length, members };
}

function preProductionMembers(input = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const truth = input.claimVerification || input.claimPacket || {};
  const directive = input.productionDirective || {};
  const plan = input.editorialPlan || {};
  const claims = Array.isArray(truth.claims) ? truth.claims : [];
  const locks = Array.isArray(directive.factLocks) ? directive.factLocks : [];
  const members = [];

  const nonConfirmed = claims.filter(claim => claim.classification !== 'confirmed');
  const truthOk = truth.status === 'VERIFIED' && nonConfirmed.length === 0;
  members.push(member(
    'truth_integrity',
    truthOk ? PASS : (policy.blockOnTruthViolation ? BLOCK : REPAIR),
    truthOk ? 100 : 0,
    truthOk ? [] : [`Truth packet must be VERIFIED with confirmed claims only; found status=${truth.status || 'missing'} and ${nonConfirmed.length} non-confirmed claim(s).`],
    { packetId: truth.id || null, packetStatus: truth.status || null, claimCount: claims.length }
  ));

  const lockIds = new Set(locks.map(lock => lock.claimId).filter(Boolean));
  const missingLocks = claims.filter(claim => claim.id && !lockIds.has(claim.id));
  const invalidLocks = locks.filter(lock => lock.classification !== 'confirmed');
  const lockOk = directive.status === 'PLAN_READY' && !missingLocks.length && !invalidLocks.length && (claims.length === 0 || locks.length >= claims.length);
  members.push(member(
    'fact_lock_guard',
    lockOk ? PASS : (policy.blockOnTruthViolation ? BLOCK : REPAIR),
    lockOk ? 100 : 10,
    lockOk ? [] : [`Production fact locks are incomplete or altered: ${missingLocks.length} missing, ${invalidLocks.length} non-confirmed.`],
    { directiveId: directive.id || null, lockCount: locks.length }
  ));

  const attributionGaps = locks.filter(lock => lock.mustAttribute && (!Array.isArray(lock.supportingSources) || lock.supportingSources.length === 0));
  members.push(member(
    'attribution_guard',
    attributionGaps.length ? REPAIR : PASS,
    attributionGaps.length ? 70 : 100,
    attributionGaps.length ? [`${attributionGaps.length} locked claim(s) require attribution but have no source URL attached.`] : [],
    { attributionGaps: attributionGaps.map(lock => lock.claimId || lock.text).slice(0, 20) }
  ));

  const requiredVisuals = plan.visuals || {};
  const actualVisuals = directive.visuals || {};
  const visualGaps = ['needsMap', 'needsTimeline', 'needsDataChart', 'needsDocuments']
    .filter(key => Boolean(requiredVisuals[key]) && !Boolean(actualVisuals[key]));
  const visualTruthOk = !policy.requireVisualTruthConstraint || (
    actualVisuals.generatedVisualsCannotDepictUnverifiedFacts === true &&
    Array.isArray(directive.forbidden) && directive.forbidden.includes('depict_unverified_claim_as_observed_fact')
  );
  members.push(member(
    'visual_truth_guard',
    visualTruthOk ? (visualGaps.length ? REPAIR : PASS) : BLOCK,
    !visualTruthOk ? 0 : visualGaps.length ? 75 : 100,
    [
      ...(visualTruthOk ? [] : ['Production directive lost the visual truth constraint for unverified allegations.']),
      ...(visualGaps.length ? [`Required evidence visuals missing from directive: ${visualGaps.join(', ')}.`] : [])
    ],
    { visualStrategy: directive.visualStrategy || null, visualGaps }
  ));

  const sceneCount = Number(directive.sceneCount || 0);
  const duration = Number(directive.targetDurationSeconds || 0);
  const budget = Number(directive.maxBudgetUsd || 0);
  const planReady = directive.status === 'PLAN_READY' && sceneCount >= 4 && sceneCount <= 80 && duration >= 60 && budget >= 0 && budget <= 100;
  members.push(member(
    'production_feasibility',
    planReady ? PASS : REPAIR,
    planReady ? 100 : 60,
    planReady ? [] : ['Production directive has invalid or incomplete duration, scene-count, status, or budget bounds.'],
    { status: directive.status || null, sceneCount, duration, budget }
  ));

  const forbidden = new Set(Array.isArray(directive.forbidden) ? directive.forbidden : []);
  const requiredForbidden = ['invent_facts', 'upgrade_reported_to_confirmed', 'remove_required_attribution', 'depict_unverified_claim_as_observed_fact'];
  const missingForbidden = requiredForbidden.filter(item => !forbidden.has(item));
  members.push(member(
    'editorial_safety',
    missingForbidden.length ? BLOCK : PASS,
    missingForbidden.length ? 0 : 100,
    missingForbidden.length ? [`Production directive is missing mandatory safety constraints: ${missingForbidden.join(', ')}.`] : [],
    { missingForbidden }
  ));

  return members;
}

function checkById(quality = {}, id) {
  return (quality.checks || []).find(check => check.id === id) || null;
}
function postProductionMembers(input = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const production = input.production || {};
  const quality = input.builtInQuality || input.quality || {};
  const editorData = input.editorData || {};
  const members = [];

  const qualityPassed = quality.passed === true && !(quality.blockingFailures || []).length;
  members.push(member(
    'factual_quality',
    qualityPassed ? PASS : BLOCK,
    qualityPassed ? Math.max(90, Number(quality.score || 0)) : 0,
    qualityPassed ? [] : [`Built-in blocking quality checks failed: ${(quality.blockingFailures || []).join(', ') || 'unknown'}.`],
    { qualityScore: Number(quality.score || 0), blockingFailures: quality.blockingFailures || [] }
  ));

  const provenance = production.provenance || {};
  const provenanceOk = !policy.requireVerifiedProvenance || ['verified', 'not_required'].includes(provenance.status || 'not_required');
  members.push(member(
    'provenance_guard',
    provenanceOk ? PASS : BLOCK,
    provenanceOk ? 100 : 0,
    provenanceOk ? [] : [`Provenance is ${provenance.status || 'missing'}; unresolved factual claims cannot pass the council.`],
    { status: provenance.status || 'not_required', summary: provenance.summary || {} }
  ));

  const script = clean(production.script?.fullScript || '', 200000);
  const title = clean(production.seo?.title || production.script?.title || '', 200);
  const description = clean(production.seo?.description || '', 10000);
  const scriptIssues = [];
  if (script.length < 200) scriptIssues.push('script is missing or too short');
  if (!title || title.length > 100) scriptIssues.push('title is missing or exceeds 100 characters');
  if (description.length < 50) scriptIssues.push('description is shorter than 50 characters');
  members.push(member(
    'script_and_metadata',
    scriptIssues.length ? REPAIR : PASS,
    scriptIssues.length ? 65 : 100,
    scriptIssues,
    { scriptLength: script.length, titleLength: title.length, descriptionLength: description.length }
  ));

  const video = production.assets?.finalVideo || {};
  const thumbnail = production.assets?.thumbnail || {};
  const visualIssues = [];
  let visualVerdict = PASS;
  if (policy.requireRealVideo && (!video.path || video.simulated)) { visualVerdict = BLOCK; visualIssues.push('real final MP4 is missing or simulated'); }
  if (policy.requireThumbnail && !thumbnail.path) { if (visualVerdict !== BLOCK) visualVerdict = REPAIR; visualIssues.push('thumbnail asset is missing'); }
  const sceneIntegrity = checkById(quality, 'scene_integrity');
  if (sceneIntegrity && !sceneIntegrity.passed) { visualVerdict = BLOCK; visualIssues.push(sceneIntegrity.message || 'scene integrity failed'); }
  members.push(member('visual_integrity', visualVerdict, visualVerdict === PASS ? 100 : visualVerdict === REPAIR ? 65 : 0, visualIssues, {
    videoPath: video.path || null, simulated: Boolean(video.simulated), thumbnailPath: thumbnail.path || null
  }));

  const sceneRights = checkById(quality, 'scene_rights');
  const uploadedWithoutRights = (production.scenes || []).filter(scene => scene.assetOrigin === 'uploaded' && !scene.rightsConfirmed);
  const rightsConfirmed = editorData.rightsConfirmed === true || (!uploadedWithoutRights.length && (!sceneRights || sceneRights.passed));
  members.push(member(
    'media_rights',
    rightsConfirmed ? PASS : (policy.blockOnRightsViolation ? BLOCK : REPAIR),
    rightsConfirmed ? 100 : 0,
    rightsConfirmed ? [] : [`${uploadedWithoutRights.length || 1} media-rights issue(s) remain unresolved.`],
    { operatorConfirmed: editorData.rightsConfirmed === true, uploadedWithoutRights: uploadedWithoutRights.length }
  ));

  const narration = checkById(quality, 'narration');
  const packagingOk = Boolean(title) && Boolean(thumbnail.path);
  const readinessIssues = [];
  if (narration && !narration.passed) readinessIssues.push(narration.message || 'narration is not ready');
  if (!packagingOk) readinessIssues.push('publish packaging is incomplete');
  members.push(member(
    'publish_readiness',
    readinessIssues.length ? REPAIR : PASS,
    readinessIssues.length ? 70 : 100,
    readinessIssues,
    { narrationReady: narration ? narration.passed : null, packagingOk }
  ));

  return members;
}

function buildPreProductionReview(input = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const result = aggregate(preProductionMembers(input, policy), policy.preProductionMinScore, policy);
  return { ...result, phase: 'pre_production', version: VERSION };
}
function buildPostProductionReview(input = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const result = aggregate(postProductionMembers(input, policy), policy.postProductionMinScore, policy);
  return { ...result, phase: 'post_production', version: VERSION };
}

class AutonomousQualityCouncilV129 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }
  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_QUALITY_COUNCIL_ENABLED || 'true').toLowerCase() !== 'false',
      policy: normalizePolicy(this.policyOverride || {
        preProductionMinScore: process.env.NEWSROOM_QUALITY_PRE_MIN_SCORE,
        postProductionMinScore: process.env.NEWSROOM_QUALITY_POST_MIN_SCORE,
        blockOnTruthViolation: String(process.env.NEWSROOM_QUALITY_BLOCK_TRUTH || 'true').toLowerCase() !== 'false',
        blockOnRightsViolation: String(process.env.NEWSROOM_QUALITY_BLOCK_RIGHTS || 'true').toLowerCase() !== 'false',
        requireRealVideo: String(process.env.NEWSROOM_QUALITY_REQUIRE_REAL_VIDEO || 'true').toLowerCase() !== 'false',
        requireThumbnail: String(process.env.NEWSROOM_QUALITY_REQUIRE_THUMBNAIL || 'true').toLowerCase() !== 'false',
        requireVerifiedProvenance: String(process.env.NEWSROOM_QUALITY_REQUIRE_PROVENANCE || 'true').toLowerCase() !== 'false'
      })
    };
  }
  rowToReview(row) {
    if (!row) return null;
    return {
      id: row.id,
      phase: row.phase,
      subjectId: row.subject_id || null,
      productionId: row.production_id || null,
      directiveId: row.directive_id || null,
      claimPacketId: row.claim_packet_id || null,
      status: row.status,
      score: Number(row.score || 0),
      blockingCount: Number(row.blocking_count || 0),
      repairCount: Number(row.repair_count || 0),
      members: parseJson(row.members_json, []),
      fingerprint: row.review_fingerprint,
      assignmentId: row.assignment_id || null,
      version: row.engine_version,
      createdAt: row.created_at
    };
  }
  async persistReview(review, refs = {}) {
    const fingerprint = hash(JSON.stringify({ phase: review.phase, version: VERSION, subject: refs.subjectId || refs.productionId || refs.directiveId || null, packet: refs.claimPacketId || null, members: review.members }));
    const id = `quality_${fingerprint.slice(0, 24)}`;
    const complete = { ...review, id, fingerprint };
    if (!this.db) return complete;
    await this.db.executeQuery(
      `INSERT OR IGNORE INTO newsroom_quality_council_reviews (id, phase, subject_id, production_id, directive_id, claim_packet_id, engine_version, status, score, blocking_count, repair_count, members_json, review_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, review.phase, refs.subjectId || null, refs.productionId || null, refs.directiveId || null, refs.claimPacketId || null, VERSION, review.status, review.score, review.blockingCount, review.repairCount, JSON.stringify(review.members), fingerprint]
    );
    const stored = await this.db.getRow('SELECT * FROM newsroom_quality_council_reviews WHERE review_fingerprint = ?', [fingerprint]);
    return this.rowToReview(stored);
  }
  async reviewPreProduction(input = {}) {
    if (!this.getConfig().enabled) return null;
    const review = buildPreProductionReview(input, this.getConfig().policy);
    return this.persistReview(review, {
      subjectId: input.decision?.id || input.candidate?.cluster?.id || null,
      directiveId: input.productionDirective?.id || null,
      claimPacketId: input.claimVerification?.id || null
    });
  }
  async reviewProduction(input = {}) {
    if (!this.getConfig().enabled) return null;
    const review = buildPostProductionReview(input, this.getConfig().policy);
    return this.persistReview(review, { productionId: input.production?.id || input.productionId || null, subjectId: input.stage || 'production' });
  }
  async linkPromotion(id, promotion = {}) {
    if (!this.db || !id) return null;
    await this.db.executeQuery('UPDATE newsroom_quality_council_reviews SET assignment_id = COALESCE(assignment_id, ?) WHERE id = ?', [promotion.assignmentId || null, id]);
    return this.getReview(id);
  }
  async getReview(id) {
    if (!this.db) return null;
    return this.rowToReview(await this.db.getRow('SELECT * FROM newsroom_quality_council_reviews WHERE id = ?', [id]));
  }
  async listReviews(limit = 100, phase = null) {
    if (!this.db) return [];
    const cap = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = phase
      ? await this.db.getAllRows('SELECT * FROM newsroom_quality_council_reviews WHERE phase = ? ORDER BY created_at DESC LIMIT ?', [phase, cap])
      : await this.db.getAllRows('SELECT * FROM newsroom_quality_council_reviews ORDER BY created_at DESC LIMIT ?', [cap]);
    return rows.map(row => this.rowToReview(row));
  }
  async getPolicy() {
    if (!this.db) return { revisionNumber: 0, source: 'defaults', policy: this.getConfig().policy };
    const row = await this.db.getRow('SELECT * FROM newsroom_quality_council_policy_revisions ORDER BY revision_number DESC LIMIT 1');
    return row ? { revisionNumber: Number(row.revision_number), source: 'persisted', policy: normalizePolicy(parseJson(row.policy_json, {})), changedBy: row.changed_by, reason: row.change_reason, createdAt: row.created_at } : { revisionNumber: 0, source: 'defaults', policy: this.getConfig().policy };
  }
  async setPolicy(policy, actor = 'operator', reason = '') {
    if (!this.db) throw new Error('Quality Council persistence is required');
    if (!clean(reason, 1000)) { const error = new Error('A reason is required to change Quality Council policy'); error.code = 'quality_council_policy_reason_required'; throw error; }
    const normalized = normalizePolicy(policy || {});
    const latest = await this.db.getRow('SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM newsroom_quality_council_policy_revisions');
    const revision = Number(latest?.revision_number || 0) + 1;
    const id = `quality_policy_${String(revision).padStart(4, '0')}_${hash(JSON.stringify(normalized)).slice(0, 12)}`;
    await this.db.executeQuery('INSERT INTO newsroom_quality_council_policy_revisions (id, revision_number, policy_json, changed_by, change_reason) VALUES (?, ?, ?, ?, ?)', [id, revision, JSON.stringify(normalized), clean(actor, 200), clean(reason, 1000)]);
    this.policyOverride = normalized;
    return this.getPolicy();
  }
  async status() {
    const reviews = await this.listReviews(100);
    return {
      version: VERSION,
      enabled: this.getConfig().enabled,
      total: reviews.length,
      pass: reviews.filter(item => item.status === PASS).length,
      repair: reviews.filter(item => item.status === REPAIR).length,
      block: reviews.filter(item => item.status === BLOCK).length,
      latest: reviews[0] || null,
      policy: (await this.getPolicy()).policy
    };
  }
}

module.exports = {
  VERSION, PASS, REPAIR, BLOCK,
  defaultPolicy, normalizePolicy, member, aggregate,
  preProductionMembers, postProductionMembers,
  buildPreProductionReview, buildPostProductionReview,
  AutonomousQualityCouncilV129
};
