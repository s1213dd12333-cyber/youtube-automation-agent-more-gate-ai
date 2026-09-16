'use strict';

const crypto = require('crypto');

const VERSION = '12.7';
const VERIFIED = 'VERIFIED';
const NEEDS_RESEARCH = 'NEEDS_RESEARCH';
const BLOCK = 'BLOCK';

const CLAIM_CONFIRMED = 'confirmed';
const CLAIM_REPORTED = 'reported';
const CLAIM_CLAIMED = 'claimed';
const CLAIM_DISPUTED = 'disputed';
const CLAIM_UNVERIFIED = 'unverified';
const CLAIM_FALSE = 'false';
const CLAIM_UNKNOWN = 'unknown';
const CLAIM_CLASSIFICATIONS = new Set([
  CLAIM_CONFIRMED, CLAIM_REPORTED, CLAIM_CLAIMED, CLAIM_DISPUTED,
  CLAIM_UNVERIFIED, CLAIM_FALSE, CLAIM_UNKNOWN
]);

const STOPWORDS = new Set(['the','and','for','with','from','that','this','have','has','had','was','were','are','is','of','to','in','on','at','by','as','it','its','a','an','or','be','been','being','what','when','where','which','who','why','how','does','did','do','can','could','would','should','may','might','will','latest','current','report','reports','source','sources','evidence','claim','claims']);
const NEGATIONS = new Set(['not','no','never','false','denied','deny','denies','without','unlikely','incorrect','wrong','disputed','disputes','contradicts','contradicted','refuted','refutes']);
const ATTRIBUTION_RE = /\b(according to|said|says|stated|announced|claimed|claims|alleged|alleges|reported|reports|told|asserted|asserts)\b/i;
const STRONG_CLAIM_RE = /\b(claimed|claims|alleged|alleges|asserted|asserts|accused|accuses)\b/i;

function clean(value, limit = 6000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function uniq(values, limit = 100) {
  const seen = new Set(); const out = [];
  for (const value of values || []) {
    const text = clean(value, 2000); const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key); out.push(text); if (out.length >= limit) break;
  }
  return out;
}
function tokens(value) {
  return uniq(String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s.-]/g, ' ').split(/\s+/).map(t => t.replace(/^[-.]+|[-.]+$/g, '')).filter(t => t.length >= 3 && !STOPWORDS.has(t)), 100);
}
function domainOf(value) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch (_error) { return ''; } }
function sourceClassRank(source = {}) { return ({ official: 4, scholarly: 3, reference: 2, web: 1 })[String(source.sourceClass || 'web').toLowerCase()] || 1; }
function splitSentences(text) { return clean(text, 16000).split(/(?<=[.!?])\s+/).map(s => clean(s, 900)).filter(s => s.length >= 35 && s.length <= 900).slice(0, 120); }
function overlapScore(question, sentence) {
  const q = tokens(question); if (!q.length) return 0;
  const corpus = new Set(tokens(sentence)); return q.filter(t => corpus.has(t)).length / q.length;
}
function negationProfile(sentence) {
  const set = new Set(tokens(sentence)); let hits = 0;
  for (const word of NEGATIONS) if (set.has(word)) hits += 1;
  return hits;
}
function attributionProfile(sentence) {
  return { attributed: ATTRIBUTION_RE.test(sentence), strongClaim: STRONG_CLAIM_RE.test(sentence) };
}
function bestSentence(question, source = {}) {
  const sentences = splitSentences(source.evidenceText || ''); let best = null;
  for (const sentence of sentences) {
    const score = overlapScore(question, sentence);
    const profile = attributionProfile(sentence);
    const candidate = { sentence, score, negations: negationProfile(sentence), ...profile };
    if (!best || score > best.score || (score === best.score && sentence.length > best.sentence.length)) best = candidate;
  }
  return best && best.score > 0 ? best : null;
}

function defaultPolicy() {
  return {
    minimumSupportingDomains: 2,
    minimumQuestionTokenCoverage: 0.22,
    minimumClaimConfidence: 62,
    blockingClassificationThreshold: 1,
    unresolvedRatioForResearch: 0.01,
    requireOfficialForPrimaryRequired: true,
    maxClaims: 12,
    maxEvidenceExcerptsPerClaim: 6
  };
}
function normalizePolicy(input = {}) {
  const base = defaultPolicy(); const n = { ...base, ...(input || {}) };
  const clamp = (v, lo, hi, fb) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fb;
  return {
    minimumSupportingDomains: Math.round(clamp(n.minimumSupportingDomains, 1, 6, base.minimumSupportingDomains)),
    minimumQuestionTokenCoverage: clamp(n.minimumQuestionTokenCoverage, 0.05, 1, base.minimumQuestionTokenCoverage),
    minimumClaimConfidence: Math.round(clamp(n.minimumClaimConfidence, 30, 95, base.minimumClaimConfidence)),
    blockingClassificationThreshold: Math.round(clamp(n.blockingClassificationThreshold, 1, 10, base.blockingClassificationThreshold)),
    unresolvedRatioForResearch: clamp(n.unresolvedRatioForResearch, 0, 1, base.unresolvedRatioForResearch),
    requireOfficialForPrimaryRequired: Boolean(n.requireOfficialForPrimaryRequired),
    maxClaims: Math.round(clamp(n.maxClaims, 1, 30, base.maxClaims)),
    maxEvidenceExcerptsPerClaim: Math.round(clamp(n.maxEvidenceExcerptsPerClaim, 1, 12, base.maxEvidenceExcerptsPerClaim))
  };
}

function sourceCandidate(question, source, policy) {
  const match = bestSentence(question, source);
  if (!match || match.score < policy.minimumQuestionTokenCoverage) return null;
  return {
    sourceId: source.id || null,
    url: source.url,
    domain: domainOf(source.url),
    sourceClass: source.sourceClass || 'web',
    publisher: source.publisher || domainOf(source.url),
    sentence: match.sentence,
    overlap: Number(match.score.toFixed(3)),
    negations: match.negations,
    attributed: match.attributed,
    strongClaim: match.strongClaim
  };
}

function buildClaimForQuestion(question, researchRun = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const verifiedSources = (researchRun.sources || []).filter(source => source?.status === 'verified' && source?.url && source?.evidenceText);
  const candidates = verifiedSources.map(source => sourceCandidate(question, source, policy)).filter(Boolean);
  candidates.sort((a, b) => sourceClassRank(b) - sourceClassRank(a) || b.overlap - a.overlap || b.sentence.length - a.sentence.length);
  if (!candidates.length) {
    return { question: clean(question, 1000), claimText: clean(question, 1000), classification: CLAIM_UNKNOWN, confidenceScore: 0, supportDomains: [], contradictionDomains: [], supportingSources: [], contradictingSources: [], evidenceExcerpts: [], reason: 'no_relevant_evidence_match' };
  }

  // Prefer a positive-polarity proposition when one exists so a stronger negative camp can explicitly falsify it.
  // If all matching evidence is negative, the strongest negative sentence becomes the proposition instead.
  const anchor = candidates.find(item => item.negations === 0) || candidates[0];
  const anchorNegated = anchor.negations > 0;
  const supporting = []; const contradicting = [];
  for (const item of candidates) ((item.negations > 0) === anchorNegated ? supporting : contradicting).push(item);
  const supportDomains = uniq(supporting.map(item => item.domain).filter(Boolean), 40);
  const contradictionDomains = uniq(contradicting.map(item => item.domain).filter(Boolean), 40);
  const officialSupport = supporting.some(item => item.sourceClass === 'official');
  const authoritativeContradiction = contradicting.some(item => ['official','scholarly'].includes(item.sourceClass));
  const requirements = researchRun.requirements || {};
  const minimumDomains = policy.minimumSupportingDomains;

  const breadth = Math.min(100, (supportDomains.length / minimumDomains) * 100);
  const agreement = supporting.length + contradicting.length ? (supporting.length / (supporting.length + contradicting.length)) * 100 : 0;
  const authority = supporting.length ? supporting.reduce((sum, item) => sum + sourceClassRank(item), 0) / (supporting.length * 4) * 100 : 0;
  const lexical = supporting.length ? supporting.reduce((sum, item) => sum + item.overlap, 0) / supporting.length * 100 : 0;
  let confidenceScore = Math.round(breadth * 0.35 + agreement * 0.30 + authority * 0.20 + lexical * 0.15);

  let classification = CLAIM_UNVERIFIED;
  let reason = 'insufficient_independent_support';
  const officialRequiredSatisfied = !requirements.primarySourceRequired || !policy.requireOfficialForPrimaryRequired || officialSupport;

  if (supportDomains.length >= minimumDomains && contradictionDomains.length >= minimumDomains) {
    classification = CLAIM_DISPUTED; reason = 'independent_evidence_materially_conflicts'; confidenceScore = Math.min(confidenceScore, 49);
  } else if (contradictionDomains.length >= minimumDomains && supportDomains.length < minimumDomains && authoritativeContradiction) {
    classification = CLAIM_FALSE; reason = 'stronger_independent_authoritative_contradiction'; confidenceScore = Math.min(100, Math.max(70, Math.round((contradictionDomains.length / minimumDomains) * 75)));
  } else if (supportDomains.length >= minimumDomains && officialRequiredSatisfied && confidenceScore >= policy.minimumClaimConfidence) {
    classification = CLAIM_CONFIRMED; reason = 'independently_corroborated';
  } else if (supporting.length) {
    const bestSupport = supporting[0];
    if (bestSupport.strongClaim) { classification = CLAIM_CLAIMED; reason = 'source_bound_attributed_claim'; }
    else if (bestSupport.attributed || sourceClassRank(bestSupport) >= 2 || supportDomains.length > 1) { classification = CLAIM_REPORTED; reason = officialRequiredSatisfied ? 'source_bound_report_not_fully_corroborated' : 'required_primary_support_missing'; }
    else { classification = CLAIM_UNVERIFIED; reason = 'weak_single_source_evidence'; }
  }

  return {
    question: clean(question, 1000), claimText: anchor.sentence, classification, confidenceScore, reason,
    supportDomains, contradictionDomains,
    supportingSources: supporting.map(({ sourceId, url, domain, sourceClass, publisher, overlap }) => ({ sourceId, url, domain, sourceClass, publisher, overlap })),
    contradictingSources: contradicting.map(({ sourceId, url, domain, sourceClass, publisher, overlap }) => ({ sourceId, url, domain, sourceClass, publisher, overlap })),
    evidenceExcerpts: [...supporting, ...contradicting].slice(0, policy.maxEvidenceExcerptsPerClaim).map(item => ({ url: item.url, domain: item.domain, sourceClass: item.sourceClass, excerpt: item.sentence, polarity: ((item.negations > 0) === anchorNegated) ? 'support' : 'contradict' }))
  };
}

function synthesizeClaims(researchRun = {}, plan = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const questions = uniq((researchRun.questions && researchRun.questions.length ? researchRun.questions : plan?.research?.questions) || [], policy.maxClaims);
  return questions.map(question => buildClaimForQuestion(question, researchRun, policy));
}

function classificationCounts(claims = []) {
  const counts = { confirmed: 0, reported: 0, claimed: 0, disputed: 0, unverified: 0, false: 0, unknown: 0 };
  for (const claim of claims) if (CLAIM_CLASSIFICATIONS.has(claim.classification)) counts[claim.classification] += 1;
  return counts;
}

function assessPacket(claims = [], policyInput = {}) {
  const policy = normalizePolicy(policyInput); const counts = classificationCounts(claims); const count = claims.length;
  const confidenceScore = count ? Math.round(claims.reduce((sum, claim) => sum + Number(claim.confidenceScore || 0), 0) / count) : 0;
  const blocking = counts.disputed + counts.false;
  const unresolved = counts.reported + counts.claimed + counts.unverified + counts.unknown;
  const unresolvedRatio = count ? unresolved / count : 1;
  let status = VERIFIED;
  if (!count || unresolvedRatio >= policy.unresolvedRatioForResearch) status = NEEDS_RESEARCH;
  if (blocking >= policy.blockingClassificationThreshold) status = BLOCK;
  if (count && counts.confirmed === count) status = VERIFIED;
  return { status, claimCount: count, classificationCounts: counts, confidenceScore, unresolvedCount: unresolved, blockingCount: blocking };
}

class EvidenceTruthEngineV127 {
  constructor(db, options = {}) { this.db = db || null; this.logger = options.logger || { info() {}, warn() {}, error() {} }; this.policyOverride = options.policy || null; }
  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_CLAIM_VERIFICATION_ENABLED || 'true').toLowerCase() !== 'false',
      policy: normalizePolicy(this.policyOverride || {
        minimumSupportingDomains: process.env.NEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS,
        minimumQuestionTokenCoverage: process.env.NEWSROOM_CLAIM_MIN_TOKEN_COVERAGE,
        minimumClaimConfidence: process.env.NEWSROOM_CLAIM_MIN_CONFIDENCE,
        unresolvedRatioForResearch: process.env.NEWSROOM_CLAIM_UNRESOLVED_RATIO
      })
    };
  }
  rowToPacket(row, claims = []) {
    if (!row) return null;
    const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch (_e) { return fallback; } };
    return { id: row.id, researchRunId: row.research_run_id, planId: row.plan_id, decisionId: row.decision_id, clusterId: row.cluster_id, version: row.engine_version, status: row.status, claimCount: Number(row.claim_count || 0), classificationCounts: parse(row.classification_counts_json, {}), unresolvedCount: Number(row.unresolved_count || 0), blockingCount: Number(row.blocking_count || 0), confidenceScore: Number(row.confidence_score || 0), fingerprint: row.packet_fingerprint, claims, createdAt: row.created_at };
  }
  rowToClaim(row) {
    const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch (_e) { return fallback; } };
    return { id: row.id, ordinal: Number(row.ordinal || 0), question: row.question, claimText: row.claim_text, classification: row.classification, confidenceScore: Number(row.confidence_score || 0), reason: row.reason, supportDomains: parse(row.support_domains_json, []), contradictionDomains: parse(row.contradiction_domains_json, []), supportingSources: parse(row.supporting_sources_json, []), contradictingSources: parse(row.contradicting_sources_json, []), evidenceExcerpts: parse(row.evidence_excerpt_json, []), fingerprint: row.claim_fingerprint, createdAt: row.created_at };
  }
  async verifyResearch(input = {}) {
    if (!this.getConfig().enabled) return null;
    const researchRun = input.researchRun || input.autonomousResearch; const plan = input.editorialPlan || input.plan || {};
    if (!researchRun?.id || researchRun.status !== 'EVIDENCE_READY') throw Object.assign(new Error('evidence_ready_research_run_required'), { code: 'evidence_ready_research_run_required' });
    const policy = this.getConfig().policy; const claims = synthesizeClaims(researchRun, plan, policy); const summary = assessPacket(claims, policy);
    const fingerprint = hash(JSON.stringify({ version: VERSION, researchRunId: researchRun.id, researchFingerprint: researchRun.fingerprint || null, planId: plan.id || researchRun.planId || null, claims: claims.map(c => ({ q: c.question, text: c.claimText, classification: c.classification, score: c.confidenceScore, support: c.supportDomains, contradict: c.contradictionDomains })) })).slice(0, 32);
    const packetId = `news_truth_packet_${fingerprint.slice(0, 24)}`;
    if (this.db) {
      const existing = await this.db.getRow('SELECT * FROM newsroom_claim_verification_packets WHERE packet_fingerprint = ?', [fingerprint]);
      if (existing) return this.getPacket(existing.id);
      await this.db.executeQuery('BEGIN IMMEDIATE');
      try {
        await this.db.executeQuery(`INSERT INTO newsroom_claim_verification_packets (id, research_run_id, plan_id, decision_id, cluster_id, engine_version, status, claim_count, classification_counts_json, unresolved_count, blocking_count, confidence_score, packet_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [packetId, researchRun.id, plan.id || researchRun.planId || null, input.decision?.id || researchRun.decisionId || null, researchRun.clusterId || null, VERSION, summary.status, summary.claimCount, JSON.stringify(summary.classificationCounts), summary.unresolvedCount, summary.blockingCount, summary.confidenceScore, fingerprint]);
        for (let index = 0; index < claims.length; index += 1) {
          const claim = claims[index];
          const claimFingerprint = hash(JSON.stringify({ packetId, index, question: claim.question, text: claim.claimText, classification: claim.classification, supportDomains: claim.supportDomains, contradictionDomains: claim.contradictionDomains })).slice(0, 32);
          const id = `news_truth_claim_${claimFingerprint.slice(0, 24)}`;
          await this.db.executeQuery(`INSERT INTO newsroom_claim_verification_claims (id, packet_id, ordinal, question, claim_text, classification, confidence_score, reason, support_domains_json, contradiction_domains_json, supporting_sources_json, contradicting_sources_json, evidence_excerpt_json, claim_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [id, packetId, index + 1, claim.question, claim.claimText, claim.classification, claim.confidenceScore, claim.reason, JSON.stringify(claim.supportDomains), JSON.stringify(claim.contradictionDomains), JSON.stringify(claim.supportingSources), JSON.stringify(claim.contradictingSources), JSON.stringify(claim.evidenceExcerpts), claimFingerprint]);
        }
        await this.db.executeQuery('COMMIT');
      } catch (error) { await this.db.executeQuery('ROLLBACK'); throw error; }
    }
    const result = { id: packetId, researchRunId: researchRun.id, planId: plan.id || researchRun.planId || null, decisionId: input.decision?.id || researchRun.decisionId || null, clusterId: researchRun.clusterId || null, version: VERSION, ...summary, fingerprint, claims, createdAt: new Date().toISOString() };
    this.logger.info(`Evidence / Truth 12.7 ${result.status}: ${result.classificationCounts.confirmed}/${result.claimCount} confirmed, ${result.blockingCount} blocking, ${result.unresolvedCount} unresolved.`);
    return result;
  }
  async getPacket(packetId) {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT * FROM newsroom_claim_verification_packets WHERE id = ?', [packetId]); if (!row) return null;
    const claims = (await this.db.getAllRows('SELECT * FROM newsroom_claim_verification_claims WHERE packet_id = ? ORDER BY ordinal ASC', [packetId])).map(row => this.rowToClaim(row));
    return this.rowToPacket(row, claims);
  }
  async listPackets(limit = 100, status = null) {
    if (!this.db) return [];
    const allowed = new Set([VERIFIED, NEEDS_RESEARCH, BLOCK]); const params = []; let sql = 'SELECT * FROM newsroom_claim_verification_packets';
    if (status && allowed.has(String(status).toUpperCase())) { sql += ' WHERE status = ?'; params.push(String(status).toUpperCase()); }
    sql += ' ORDER BY created_at DESC LIMIT ?'; params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const rows = await this.db.getAllRows(sql, params); return Promise.all(rows.map(row => this.getPacket(row.id)));
  }
  async status() { return { version: VERSION, enabled: this.getConfig().enabled, policy: this.getConfig().policy, recentPackets: await this.listPackets(30) }; }
}

module.exports = {
  VERSION, VERIFIED, NEEDS_RESEARCH, BLOCK,
  CLAIM_CONFIRMED, CLAIM_REPORTED, CLAIM_CLAIMED, CLAIM_DISPUTED, CLAIM_UNVERIFIED, CLAIM_FALSE, CLAIM_UNKNOWN,
  CLAIM_CLASSIFICATIONS, defaultPolicy, normalizePolicy, tokens, bestSentence, buildClaimForQuestion,
  synthesizeClaims, classificationCounts, assessPacket, EvidenceTruthEngineV127,
  ClaimVerificationEngineV127: EvidenceTruthEngineV127
};
