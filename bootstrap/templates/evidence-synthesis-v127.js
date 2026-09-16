'use strict';

const crypto = require('crypto');

const VERSION = '12.7';
const READY = 'SYNTHESIS_READY';
const BLOCK = 'BLOCK';

function clean(value, limit = 6000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function clamp(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function uniq(values, limit = 100) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = clean(value, 2000);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function domainOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_error) { return ''; }
}

function tokens(value) {
  return uniq(String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9%\s.-]/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(token => token.length >= 3), 120);
}

function sentenceList(value) {
  const text = clean(value, 16000);
  if (!text) return [];
  return uniq(text.split(/(?<=[.!?])\s+/).map(item => clean(item, 700)).filter(item => item.length >= 40 && item.length <= 700), 80);
}

function overlapRatio(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function defaultPolicy() {
  return {
    maxClaims: 16,
    maxExcerptCharacters: 420,
    minimumClaims: 2,
    minimumQuestionSupportRatio: 0.60,
    minimumBriefConfidence: 62,
    minimumCorroborationForStrongClaim: 2,
    blockExplicitContradictions: true,
    preserveUncertaintyLabels: true
  };
}

function normalizePolicy(input = {}) {
  const base = defaultPolicy();
  const source = { ...base, ...(input || {}) };
  return {
    maxClaims: Math.round(clamp(source.maxClaims, 4, 40, base.maxClaims)),
    maxExcerptCharacters: Math.round(clamp(source.maxExcerptCharacters, 120, 1200, base.maxExcerptCharacters)),
    minimumClaims: Math.round(clamp(source.minimumClaims, 1, 10, base.minimumClaims)),
    minimumQuestionSupportRatio: clamp(source.minimumQuestionSupportRatio, 0.2, 1, base.minimumQuestionSupportRatio),
    minimumBriefConfidence: Math.round(clamp(source.minimumBriefConfidence, 30, 95, base.minimumBriefConfidence)),
    minimumCorroborationForStrongClaim: Math.round(clamp(source.minimumCorroborationForStrongClaim, 1, 5, base.minimumCorroborationForStrongClaim)),
    blockExplicitContradictions: Boolean(source.blockExplicitContradictions),
    preserveUncertaintyLabels: Boolean(source.preserveUncertaintyLabels)
  };
}

function verifiedSources(run = {}) {
  return (Array.isArray(run.sources) ? run.sources : []).filter(source => source && source.status === 'verified' && clean(source.evidenceText).length >= 40 && source.url);
}

function buildCitations(run = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  return verifiedSources(run).map((source, index) => ({
    id: `C${index + 1}`,
    sourceId: source.id,
    url: source.url,
    domain: domainOf(source.url),
    title: clean(source.title || source.url, 500),
    publisher: clean(source.publisher || domainOf(source.url), 300),
    sourceClass: clean(source.sourceClass || 'web', 40),
    excerpt: clean(source.evidenceText, policy.maxExcerptCharacters)
  }));
}

function bestSentence(question, source) {
  const qTokens = new Set(tokens(question));
  let best = '';
  let score = -1;
  for (const sentence of sentenceList(source?.evidenceText || '')) {
    const sentenceTokens = new Set(tokens(sentence));
    let shared = 0;
    for (const token of qTokens) if (sentenceTokens.has(token)) shared += 1;
    const current = qTokens.size ? shared / qTokens.size : 0;
    if (current > score) { score = current; best = sentence; }
  }
  return best || sentenceList(source?.evidenceText || '')[0] || '';
}

function buildQuestionClaims(plan = {}, run = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const questions = Array.isArray(plan?.research?.questions) ? plan.research.questions : [];
  const findings = Array.isArray(run.findings) ? run.findings : [];
  const sources = verifiedSources(run);
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const claims = [];
  const answers = [];

  questions.forEach((question, index) => {
    const finding = findings.find(item => Number(item.index) === index) || findings.find(item => clean(item.question).toLowerCase() === clean(question).toLowerCase()) || null;
    const matchedIds = uniq((finding?.matches || []).map(match => match.sourceId).filter(Boolean), 12);
    const matchedSources = matchedIds.map(id => sourceById.get(id)).filter(Boolean);
    const domains = uniq(matchedSources.map(source => domainOf(source.url)).filter(Boolean), 12);
    const primary = matchedSources[0] || null;
    const excerpt = primary ? bestSentence(question, primary) : '';
    const supported = Boolean(excerpt && matchedSources.length);
    const corroborationCount = domains.length;
    const confidence = supported ? Math.min(96, Math.round(52 + Math.min(3, corroborationCount) * 12 + Math.min(20, Number(run.evidenceScore || 0) * 0.2))) : 20;
    const answer = {
      question: clean(question, 800),
      supported,
      excerpt: clean(excerpt, policy.maxExcerptCharacters),
      sourceIds: matchedSources.map(source => source.id),
      sourceUrls: matchedSources.map(source => source.url),
      corroborationCount,
      confidenceScore: confidence
    };
    answers.push(answer);
    if (supported) {
      claims.push({
        text: answer.excerpt,
        type: corroborationCount >= policy.minimumCorroborationForStrongClaim ? 'fact' : 'attribution',
        confidenceScore: confidence,
        corroborationCount,
        sourceIds: answer.sourceIds,
        sourceUrls: answer.sourceUrls,
        evidenceExcerpts: matchedSources.slice(0, 4).map(source => ({ sourceId: source.id, excerpt: clean(bestSentence(question, source), policy.maxExcerptCharacters) }))
      });
    }
  });
  return { claims: claims.slice(0, policy.maxClaims), answers };
}

function fallbackClaims(run = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const sources = verifiedSources(run);
  const groups = [];
  for (const source of sources) {
    for (const sentence of sentenceList(source.evidenceText).slice(0, 4)) {
      let group = groups.find(item => overlapRatio(item.text, sentence) >= 0.72);
      if (!group) {
        group = { text: sentence, sources: [] };
        groups.push(group);
      }
      if (!group.sources.some(item => item.id === source.id)) group.sources.push(source);
    }
  }
  return groups
    .sort((a, b) => b.sources.length - a.sources.length || b.text.length - a.text.length)
    .slice(0, policy.maxClaims)
    .map(group => {
      const domains = uniq(group.sources.map(source => domainOf(source.url)).filter(Boolean), 20);
      const corroborationCount = domains.length;
      return {
        text: clean(group.text, policy.maxExcerptCharacters),
        type: corroborationCount >= policy.minimumCorroborationForStrongClaim ? 'fact' : 'attribution',
        confidenceScore: Math.min(94, 50 + corroborationCount * 14),
        corroborationCount,
        sourceIds: group.sources.map(source => source.id),
        sourceUrls: group.sources.map(source => source.url),
        evidenceExcerpts: group.sources.slice(0, 4).map(source => ({ sourceId: source.id, excerpt: clean(bestSentence(group.text, source), policy.maxExcerptCharacters) }))
      };
    });
}

function explicitContradictions(questionAnswers = []) {
  const contradictions = [];
  const negation = /\b(no|not|never|denied|deny|false|incorrect|didn't|did not|hasn't|has not|without)\b/i;
  for (const answer of questionAnswers) {
    if (!answer?.supported || !Array.isArray(answer.evidenceExcerpts)) continue;
    const excerpts = answer.evidenceExcerpts.map(item => clean(item.excerpt, 700)).filter(Boolean);
    for (let i = 0; i < excerpts.length; i += 1) {
      for (let j = i + 1; j < excerpts.length; j += 1) {
        if (overlapRatio(excerpts[i], excerpts[j]) < 0.60) continue;
        const leftNeg = negation.test(excerpts[i]);
        const rightNeg = negation.test(excerpts[j]);
        if (leftNeg !== rightNeg) contradictions.push({ question: answer.question, type: 'explicit_polarity_conflict', excerpts: [excerpts[i], excerpts[j]] });
      }
    }
  }
  return contradictions.slice(0, 20);
}

function synthesizeBrief(input = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const run = input.researchRun || {};
  const plan = input.editorialPlan || {};
  if (run.status !== 'EVIDENCE_READY') {
    return {
      status: BLOCK,
      summary: 'Evidence synthesis blocked because Autonomous Research is not EVIDENCE_READY.',
      claims: [], questionAnswers: [], uncertainties: ['autonomous_research_not_ready'], contradictions: [], citations: [], confidenceScore: 0
    };
  }

  const questionResult = buildQuestionClaims(plan, run, policy);
  const claims = questionResult.claims.length ? questionResult.claims : fallbackClaims(run, policy);
  const answers = questionResult.answers.map(answer => ({ ...answer, evidenceExcerpts: claims.find(claim => claim.text === answer.excerpt)?.evidenceExcerpts || [] }));
  const supportedAnswers = answers.filter(answer => answer.supported).length;
  const supportRatio = answers.length ? supportedAnswers / answers.length : (claims.length ? 1 : 0);
  const corroborated = claims.filter(claim => claim.corroborationCount >= policy.minimumCorroborationForStrongClaim).length;
  const contradictions = explicitContradictions(answers);
  const uncertainties = [];
  for (const answer of answers) if (!answer.supported) uncertainties.push(`unresolved_question:${answer.question}`);
  for (const claim of claims) if (claim.corroborationCount < policy.minimumCorroborationForStrongClaim) uncertainties.push(`single_source_or_low_corroboration:${clean(claim.text, 140)}`);

  const researchScore = clamp(run.evidenceScore, 0, 100, 0);
  const claimScore = claims.length ? Math.min(100, claims.reduce((sum, claim) => sum + claim.confidenceScore, 0) / claims.length) : 0;
  const corroborationScore = claims.length ? corroborated / claims.length * 100 : 0;
  let confidenceScore = Math.round(researchScore * 0.45 + supportRatio * 100 * 0.30 + claimScore * 0.15 + corroborationScore * 0.10);
  if (contradictions.length) confidenceScore = Math.max(0, confidenceScore - 25);

  const blockers = [];
  if (claims.length < policy.minimumClaims) blockers.push('insufficient_source_grounded_claims');
  if (supportRatio < policy.minimumQuestionSupportRatio) blockers.push('research_question_support_below_threshold');
  if (confidenceScore < policy.minimumBriefConfidence) blockers.push('brief_confidence_below_threshold');
  if (policy.blockExplicitContradictions && contradictions.length) blockers.push('explicit_contradiction_requires_review');

  const status = blockers.length ? BLOCK : READY;
  const topic = clean(plan.topic || input?.candidate?.cluster?.canonicalTitle || 'selected story', 240);
  const summary = `${topic}: ${claims.length} source-grounded claim(s), ${corroborated} corroborated claim(s), ${Math.round(supportRatio * 100)}% research-question support, confidence ${confidenceScore}/100.`;
  return {
    status,
    summary,
    claims,
    keyFacts: claims.filter(claim => claim.type === 'fact').map(claim => ({ text: claim.text, confidenceScore: claim.confidenceScore, sourceIds: claim.sourceIds, sourceUrls: claim.sourceUrls })),
    questionAnswers: answers,
    uncertainties: uniq([...uncertainties, ...blockers], 60),
    contradictions,
    citations: buildCitations(run, policy),
    claimCount: claims.length,
    corroboratedClaimCount: corroborated,
    questionSupportRatio: Number(supportRatio.toFixed(3)),
    confidenceScore
  };
}

class EvidenceSynthesisV127 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_EVIDENCE_SYNTHESIS_ENABLED || 'true').toLowerCase() !== 'false',
      defaultPolicy: normalizePolicy(this.policyOverride || {
        maxClaims: process.env.NEWSROOM_SYNTHESIS_MAX_CLAIMS,
        minimumClaims: process.env.NEWSROOM_SYNTHESIS_MIN_CLAIMS,
        minimumQuestionSupportRatio: process.env.NEWSROOM_SYNTHESIS_MIN_QUESTION_SUPPORT,
        minimumBriefConfidence: process.env.NEWSROOM_SYNTHESIS_MIN_CONFIDENCE
      })
    };
  }

  async getPolicy() {
    const base = this.getConfig().defaultPolicy;
    if (!this.db) return { revisionNumber: 0, policy: base, source: 'default' };
    const row = await this.db.getRow('SELECT * FROM newsroom_evidence_synthesis_policy_revisions ORDER BY revision_number DESC LIMIT 1');
    if (!row) return { revisionNumber: 0, policy: base, source: 'default' };
    return { revisionNumber: Number(row.revision_number || 0), policy: normalizePolicy({ ...base, ...parseJson(row.policy_json, {}) }), reason: row.reason, createdBy: row.created_by, createdAt: row.created_at, source: 'persisted' };
  }

  async setPolicy(patch, actor = 'operator', reason = '') {
    if (!this.db) throw Object.assign(new Error('evidence_synthesis_policy_persistence_required'), { code: 'evidence_synthesis_policy_persistence_required' });
    const explanation = clean(reason, 500);
    if (explanation.length < 8) throw Object.assign(new Error('evidence_synthesis_policy_reason_required'), { code: 'evidence_synthesis_policy_reason_required' });
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      const current = await this.db.getRow('SELECT * FROM newsroom_evidence_synthesis_policy_revisions ORDER BY revision_number DESC LIMIT 1');
      const currentPolicy = current ? parseJson(current.policy_json, {}) : this.getConfig().defaultPolicy;
      const next = normalizePolicy({ ...currentPolicy, ...(patch || {}) });
      const revisionNumber = Number(current?.revision_number || 0) + 1;
      const fingerprint = hash(JSON.stringify(next)).slice(0, 32);
      const id = `news_synthesis_policy_${revisionNumber}_${fingerprint.slice(0, 12)}`;
      await this.db.executeQuery('INSERT INTO newsroom_evidence_synthesis_policy_revisions (id, revision_number, policy_json, policy_fingerprint, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', [id, revisionNumber, JSON.stringify(next), fingerprint, explanation, clean(actor, 200) || 'operator']);
      await this.db.executeQuery('COMMIT');
      return { id, revisionNumber, policy: next, fingerprint, reason: explanation };
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
  }

  async synthesize(input = {}) {
    if (!this.db) throw Object.assign(new Error('evidence_synthesis_persistence_required'), { code: 'evidence_synthesis_persistence_required' });
    const policyState = await this.getPolicy();
    const policy = policyState.policy;
    const brief = synthesizeBrief(input, policy);
    const run = input.researchRun || {};
    const plan = input.editorialPlan || {};
    const fingerprintPayload = {
      researchRunId: run.id || null,
      researchRunFingerprint: run.runFingerprint || run.fingerprint || null,
      planId: plan.id || null,
      status: brief.status,
      claims: brief.claims.map(claim => ({ text: claim.text, sourceIds: claim.sourceIds, confidenceScore: claim.confidenceScore })),
      contradictions: brief.contradictions,
      policyRevision: policyState.revisionNumber
    };
    const fingerprint = hash(JSON.stringify(fingerprintPayload));
    const existing = await this.db.getRow('SELECT * FROM newsroom_research_briefs WHERE brief_fingerprint = ?', [fingerprint]);
    if (existing) return this.rowToBrief(existing);

    const id = `research_brief_${fingerprint.slice(0, 20)}`;
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      await this.db.executeQuery(`INSERT INTO newsroom_research_briefs (
        id, research_run_id, plan_id, decision_id, cluster_id, event_id, scan_id, engine_version, status, summary,
        key_facts_json, question_answers_json, uncertainties_json, contradictions_json, citations_json,
        claim_count, corroborated_claim_count, confidence_score, brief_fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [
        id, run.id, plan.id || null, input?.decision?.id || run.decisionId || null, input?.candidate?.cluster?.id || run.clusterId || null,
        input?.candidate?.event?.id || run.eventId || null, input.scanId || run.scanId || null, VERSION, brief.status, brief.summary,
        JSON.stringify(brief.keyFacts || []), JSON.stringify(brief.questionAnswers || []), JSON.stringify(brief.uncertainties || []), JSON.stringify(brief.contradictions || []), JSON.stringify(brief.citations || []),
        brief.claimCount || 0, brief.corroboratedClaimCount || 0, brief.confidenceScore || 0, fingerprint
      ]);
      let ordinal = 0;
      for (const claim of brief.claims) {
        ordinal += 1;
        const claimFingerprint = hash(JSON.stringify({ text: claim.text, sourceIds: claim.sourceIds }));
        await this.db.executeQuery(`INSERT INTO newsroom_research_brief_claims (
          id, brief_id, ordinal, claim_text, claim_type, confidence_score, corroboration_count, source_ids_json, source_urls_json, evidence_excerpts_json, claim_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [
          `brief_claim_${fingerprint.slice(0, 10)}_${ordinal}`, id, ordinal, claim.text, claim.type, claim.confidenceScore, claim.corroborationCount,
          JSON.stringify(claim.sourceIds || []), JSON.stringify(claim.sourceUrls || []), JSON.stringify(claim.evidenceExcerpts || []), claimFingerprint
        ]);
      }
      await this.db.executeQuery('COMMIT');
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
    return this.getBrief(id);
  }

  rowToBrief(row, claims = null) {
    if (!row) return null;
    return {
      id: row.id,
      researchRunId: row.research_run_id,
      planId: row.plan_id,
      decisionId: row.decision_id,
      clusterId: row.cluster_id,
      eventId: row.event_id,
      scanId: row.scan_id,
      engineVersion: row.engine_version,
      status: row.status,
      summary: row.summary,
      keyFacts: parseJson(row.key_facts_json, []),
      questionAnswers: parseJson(row.question_answers_json, []),
      uncertainties: parseJson(row.uncertainties_json, []),
      contradictions: parseJson(row.contradictions_json, []),
      citations: parseJson(row.citations_json, []),
      claimCount: Number(row.claim_count || 0),
      corroboratedClaimCount: Number(row.corroborated_claim_count || 0),
      confidenceScore: Number(row.confidence_score || 0),
      promotedIdeaId: row.promoted_idea_id || null,
      assignmentId: row.assignment_id || null,
      briefFingerprint: row.brief_fingerprint,
      createdAt: row.created_at,
      claims: claims || undefined
    };
  }

  async getBrief(id) {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT * FROM newsroom_research_briefs WHERE id = ?', [id]);
    if (!row) return null;
    const claimRows = await this.db.getAllRows('SELECT * FROM newsroom_research_brief_claims WHERE brief_id = ? ORDER BY ordinal', [id]);
    const claims = claimRows.map(claim => ({
      id: claim.id, ordinal: Number(claim.ordinal), text: claim.claim_text, type: claim.claim_type,
      confidenceScore: Number(claim.confidence_score), corroborationCount: Number(claim.corroboration_count),
      sourceIds: parseJson(claim.source_ids_json, []), sourceUrls: parseJson(claim.source_urls_json, []), evidenceExcerpts: parseJson(claim.evidence_excerpts_json, [])
    }));
    return this.rowToBrief(row, claims);
  }

  async listBriefs(limit = 100, status = null) {
    if (!this.db) return [];
    const bounded = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = status ? await this.db.getAllRows('SELECT * FROM newsroom_research_briefs WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, bounded]) : await this.db.getAllRows('SELECT * FROM newsroom_research_briefs ORDER BY created_at DESC LIMIT ?', [bounded]);
    return rows.map(row => this.rowToBrief(row));
  }

  async linkPromotion(briefId, promotion = {}) {
    if (!this.db || !briefId) return null;
    await this.db.executeQuery('UPDATE newsroom_research_briefs SET promoted_idea_id = COALESCE(promoted_idea_id, ?), assignment_id = COALESCE(assignment_id, ?) WHERE id = ?', [promotion?.idea?.id || null, promotion.assignmentId || null, briefId]);
    return this.getBrief(briefId);
  }

  async status() {
    if (!this.db) return { version: VERSION, enabled: this.getConfig().enabled, totals: {} };
    const rows = await this.db.getAllRows('SELECT status, COUNT(*) AS count FROM newsroom_research_briefs GROUP BY status');
    const totals = {};
    for (const row of rows) totals[row.status] = Number(row.count || 0);
    const latest = await this.db.getRow('SELECT * FROM newsroom_research_briefs ORDER BY created_at DESC LIMIT 1');
    return { version: VERSION, enabled: this.getConfig().enabled, totals, latest: this.rowToBrief(latest), policy: await this.getPolicy() };
  }
}

module.exports = {
  VERSION, READY, BLOCK, defaultPolicy, normalizePolicy, verifiedSources, buildCitations,
  buildQuestionClaims, fallbackClaims, explicitContradictions, synthesizeBrief, EvidenceSynthesisV127
};
