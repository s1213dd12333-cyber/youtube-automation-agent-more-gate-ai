'use strict';

const crypto = require('crypto');

const VERSION = '12.7';
const VERIFIED = 'VERIFIED';
const NEEDS_RESEARCH = 'NEEDS_RESEARCH';
const BLOCK = 'BLOCK';
const CLAIM_SUPPORTED = 'SUPPORTED';
const CLAIM_CONTESTED = 'CONTESTED';
const CLAIM_INSUFFICIENT = 'INSUFFICIENT';

const STOPWORDS = new Set(['the','and','for','with','from','that','this','have','has','had','was','were','are','is','of','to','in','on','at','by','as','it','its','a','an','or','be','been','being','what','when','where','which','who','why','how','does','did','do','can','could','would','should','may','might','will','latest','current','report','reports','source','sources','evidence','claim','claims']);
const NEGATIONS = new Set(['not','no','never','false','denied','deny','denies','without','unlikely','incorrect','wrong','disputed','disputes','contradicts','contradicted']);

function clean(value, limit = 6000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function uniq(values, limit = 100) {
  const seen = new Set();
  const out = [];
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

function tokens(value) {
  return uniq(String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s.-]/g, ' ').split(/\s+/).map(t => t.replace(/^[-.]+|[-.]+$/g, '')).filter(t => t.length >= 3 && !STOPWORDS.has(t)), 100);
}

function domainOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch (_error) { return ''; }
}

function sourceClassRank(source = {}) {
  return ({ official: 4, scholarly: 3, reference: 2, web: 1 })[String(source.sourceClass || 'web').toLowerCase()] || 1;
}

function splitSentences(text) {
  return clean(text, 16000).split(/(?<=[.!?])\s+/).map(s => clean(s, 900)).filter(s => s.length >= 35 && s.length <= 900).slice(0, 120);
}

function overlapScore(question, sentence) {
  const q = tokens(question);
  if (!q.length) return 0;
  const corpus = new Set(tokens(sentence));
  const matched = q.filter(t => corpus.has(t)).length;
  return matched / q.length;
}

function negationProfile(sentence) {
  const set = new Set(tokens(sentence));
  let hits = 0;
  for (const word of NEGATIONS) if (set.has(word)) hits += 1;
  return hits;
}

function bestSentence(question, source = {}) {
  const sentences = splitSentences(source.evidenceText || '');
  let best = null;
  for (const sentence of sentences) {
    const score = overlapScore(question, sentence);
    if (!best || score > best.score || (score === best.score && sentence.length > best.sentence.length)) best = { sentence, score, negations: negationProfile(sentence) };
  }
  return best && best.score > 0 ? best : null;
}

function defaultPolicy() {
  return {
    minimumSupportingDomains: 2,
    minimumQuestionTokenCoverage: 0.22,
    minimumClaimConfidence: 62,
    contestedBlockThreshold: 1,
    insufficientBlockRatio: 0.45,
    requireOfficialForPrimaryRequired: true,
    maxClaims: 12,
    maxEvidenceExcerptsPerClaim: 6
  };
}

function normalizePolicy(input = {}) {
  const base = defaultPolicy();
  const n = { ...base, ...(input || {}) };
  const clamp = (v, lo, hi, fb) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fb;
  return {
    minimumSupportingDomains: Math.round(clamp(n.minimumSupportingDomains, 1, 6, base.minimumSupportingDomains)),
    minimumQuestionTokenCoverage: clamp(n.minimumQuestionTokenCoverage, 0.05, 1, base.minimumQuestionTokenCoverage),
    minimumClaimConfidence: Math.round(clamp(n.minimumClaimConfidence, 30, 95, base.minimumClaimConfidence)),
    contestedBlockThreshold: Math.round(clamp(n.contestedBlockThreshold, 1, 10, base.contestedBlockThreshold)),
    insufficientBlockRatio: clamp(n.insufficientBlockRatio, 0.1, 1, base.insufficientBlockRatio),
    requireOfficialForPrimaryRequired: Boolean(n.requireOfficialForPrimaryRequired),
    maxClaims: Math.round(clamp(n.maxClaims, 1, 30, base.maxClaims)),
    maxEvidenceExcerptsPerClaim: Math.round(clamp(n.maxEvidenceExcerptsPerClaim, 1, 12, base.maxEvidenceExcerptsPerClaim))
  };
}

function buildClaimForQuestion(question, researchRun = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const verifiedSources = (researchRun.sources || []).filter(source => source?.status === 'verified' && source?.url && source?.evidenceText);
  const candidates = [];
  for (const source of verifiedSources) {
    const match = bestSentence(question, source);
    if (!match || match.score < policy.minimumQuestionTokenCoverage) continue;
    candidates.push({
      sourceId: source.id || null,
      url: source.url,
      domain: domainOf(source.url),
      sourceClass: source.sourceClass || 'web',
      publisher: source.publisher || domainOf(source.url),
      sentence: match.sentence,
      overlap: Number(match.score.toFixed(3)),
      negations: match.negations
    });
  }
  candidates.sort((a, b) => sourceClassRank(b) - sourceClassRank(a) || b.overlap - a.overlap || b.sentence.length - a.sentence.length);
  const anchor = candidates[0] || null;
  if (!anchor) {
    return { question: clean(question, 1000), claimText: clean(question, 1000), status: CLAIM_INSUFFICIENT, confidenceScore: 0, supportDomains: [], supportingSources: [], contradictingSources: [], evidenceExcerpts: [] };
  }

  const anchorNegated = anchor.negations > 0;
  const supporting = [];
  const contradicting = [];
  for (const item of candidates) {
    const samePolarity = (item.negations > 0) === anchorNegated;
    (samePolarity ? supporting : contradicting).push(item);
  }
  const supportDomains = uniq(supporting.map(item => item.domain).filter(Boolean), 40);
  const contradictionDomains = uniq(contradicting.map(item => item.domain).filter(Boolean), 40);
  const officialSupport = supporting.some(item => item.sourceClass === 'official');
  const minimumDomains = policy.minimumSupportingDomains;
  let status = CLAIM_SUPPORTED;
  if (contradictionDomains.length >= minimumDomains || (contradicting.length && supportDomains.length < minimumDomains)) status = CLAIM_CONTESTED;
  else if (supportDomains.length < minimumDomains) status = CLAIM_INSUFFICIENT;

  const requirements = researchRun.requirements || {};
  if (status === CLAIM_SUPPORTED && requirements.primarySourceRequired && policy.requireOfficialForPrimaryRequired && !officialSupport) status = CLAIM_INSUFFICIENT;

  const breadth = Math.min(100, (supportDomains.length / minimumDomains) * 100);
  const agreement = supporting.length + contradicting.length ? (supporting.length / (supporting.length + contradicting.length)) * 100 : 0;
  const authority = supporting.length ? supporting.reduce((sum, item) => sum + sourceClassRank(item), 0) / (supporting.length * 4) * 100 : 0;
  const lexical = supporting.length ? supporting.reduce((sum, item) => sum + item.overlap, 0) / supporting.length * 100 : 0;
  let confidenceScore = Math.round(breadth * 0.35 + agreement * 0.30 + authority * 0.20 + lexical * 0.15);
  if (status === CLAIM_CONTESTED) confidenceScore = Math.min(confidenceScore, 45);
  if (confidenceScore < policy.minimumClaimConfidence && status === CLAIM_SUPPORTED) status = CLAIM_INSUFFICIENT;

  return {
    question: clean(question, 1000),
    claimText: anchor.sentence,
    status,
    confidenceScore,
    supportDomains,
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

function assessPacket(claims = [], policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const supported = claims.filter(c => c.status === CLAIM_SUPPORTED).length;
  const contested = claims.filter(c => c.status === CLAIM_CONTESTED).length;
  const insufficient = claims.filter(c => c.status === CLAIM_INSUFFICIENT).length;
  const count = claims.length;
  const meanConfidence = count ? Math.round(claims.reduce((sum, c) => sum + Number(c.confidenceScore || 0), 0) / count) : 0;
  const insufficientRatio = count ? insufficient / count : 1;
  let status = VERIFIED;
  if (!count || insufficientRatio >= policy.insufficientBlockRatio) status = NEEDS_RESEARCH;
  if (contested >= policy.contestedBlockThreshold) status = BLOCK;
  if (count && supported === count) status = VERIFIED;
  return { status, claimCount: count, supportedCount: supported, contestedCount: contested, insufficientCount: insufficient, confidenceScore: meanConfidence };
}

class ClaimVerificationEngineV127 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_CLAIM_VERIFICATION_ENABLED || 'true').toLowerCase() !== 'false',
      policy: normalizePolicy(this.policyOverride || {
        minimumSupportingDomains: process.env.NEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS,
        minimumQuestionTokenCoverage: process.env.NEWSROOM_CLAIM_MIN_TOKEN_COVERAGE,
        minimumClaimConfidence: process.env.NEWSROOM_CLAIM_MIN_CONFIDENCE,
        insufficientBlockRatio: process.env.NEWSROOM_CLAIM_INSUFFICIENT_RATIO
      })
    };
  }

  rowToPacket(row, claims = []) {
    if (!row) return null;
    return { id: row.id, researchRunId: row.research_run_id, planId: row.plan_id, decisionId: row.decision_id, clusterId: row.cluster_id, version: row.engine_version, status: row.status, claimCount: Number(row.claim_count || 0), supportedCount: Number(row.supported_count || 0), contestedCount: Number(row.contested_count || 0), insufficientCount: Number(row.insufficient_count || 0), confidenceScore: Number(row.confidence_score || 0), fingerprint: row.packet_fingerprint, claims, createdAt: row.created_at };
  }

  rowToClaim(row) {
    const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch (_e) { return fallback; } };
    return { id: row.id, ordinal: Number(row.ordinal || 0), question: row.question, claimText: row.claim_text, status: row.status, confidenceScore: Number(row.confidence_score || 0), supportDomains: parse(row.support_domains_json, []), supportingSources: parse(row.supporting_sources_json, []), contradictingSources: parse(row.contradicting_sources_json, []), evidenceExcerpts: parse(row.evidence_excerpt_json, []), fingerprint: row.claim_fingerprint, createdAt: row.created_at };
  }

  async verifyResearch(input = {}) {
    if (!this.getConfig().enabled) return null;
    const researchRun = input.researchRun || input.autonomousResearch;
    const plan = input.editorialPlan || input.plan || {};
    if (!researchRun?.id || researchRun.status !== 'EVIDENCE_READY') throw Object.assign(new Error('evidence_ready_research_run_required'), { code: 'evidence_ready_research_run_required' });
    const policy = this.getConfig().policy;
    const claims = synthesizeClaims(researchRun, plan, policy);
    const summary = assessPacket(claims, policy);
    const fingerprint = hash(JSON.stringify({ version: VERSION, researchRunId: researchRun.id, researchFingerprint: researchRun.fingerprint || null, planId: plan.id || researchRun.planId || null, claims: claims.map(c => ({ q: c.question, text: c.claimText, status: c.status, score: c.confidenceScore, support: c.supportDomains, contradict: c.contradictingSources.map(s => s.domain) })) })).slice(0, 32);
    const packetId = `news_claim_packet_${fingerprint.slice(0, 24)}`;

    if (this.db) {
      const existing = await this.db.getRow('SELECT * FROM newsroom_claim_verification_packets WHERE packet_fingerprint = ?', [fingerprint]);
      if (existing) return this.getPacket(existing.id);
      await this.db.executeQuery('BEGIN IMMEDIATE');
      try {
        await this.db.executeQuery(`INSERT INTO newsroom_claim_verification_packets (id, research_run_id, plan_id, decision_id, cluster_id, engine_version, status, claim_count, supported_count, contested_count, insufficient_count, confidence_score, packet_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [packetId, researchRun.id, plan.id || researchRun.planId || null, input.decision?.id || researchRun.decisionId || null, researchRun.clusterId || null, VERSION, summary.status, summary.claimCount, summary.supportedCount, summary.contestedCount, summary.insufficientCount, summary.confidenceScore, fingerprint]);
        for (let index = 0; index < claims.length; index += 1) {
          const claim = claims[index];
          const claimFingerprint = hash(JSON.stringify({ packetId, index, question: claim.question, text: claim.claimText, status: claim.status, supportDomains: claim.supportDomains })).slice(0, 32);
          const id = `news_claim_${claimFingerprint.slice(0, 24)}`;
          await this.db.executeQuery(`INSERT INTO newsroom_claim_verification_claims (id, packet_id, ordinal, question, claim_text, status, confidence_score, support_domains_json, supporting_sources_json, contradicting_sources_json, evidence_excerpt_json, claim_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [id, packetId, index + 1, claim.question, claim.claimText, claim.status, claim.confidenceScore, JSON.stringify(claim.supportDomains), JSON.stringify(claim.supportingSources), JSON.stringify(claim.contradictingSources), JSON.stringify(claim.evidenceExcerpts), claimFingerprint]);
        }
        await this.db.executeQuery('COMMIT');
      } catch (error) {
        await this.db.executeQuery('ROLLBACK');
        throw error;
      }
    }

    const result = { id: packetId, researchRunId: researchRun.id, planId: plan.id || researchRun.planId || null, decisionId: input.decision?.id || researchRun.decisionId || null, clusterId: researchRun.clusterId || null, version: VERSION, ...summary, fingerprint, claims, createdAt: new Date().toISOString() };
    this.logger.info(`Claim Verification 12.7 ${result.status}: ${result.supportedCount}/${result.claimCount} supported, ${result.contestedCount} contested, confidence ${result.confidenceScore}/100.`);
    return result;
  }

  async getPacket(packetId) {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT * FROM newsroom_claim_verification_packets WHERE id = ?', [packetId]);
    if (!row) return null;
    const claims = (await this.db.getAllRows('SELECT * FROM newsroom_claim_verification_claims WHERE packet_id = ? ORDER BY ordinal ASC', [packetId])).map(r => this.rowToClaim(r));
    return this.rowToPacket(row, claims);
  }

  async listPackets(limit = 100, status = null) {
    if (!this.db) return [];
    const allowed = new Set([VERIFIED, NEEDS_RESEARCH, BLOCK]);
    const params = [];
    let sql = 'SELECT * FROM newsroom_claim_verification_packets';
    if (status && allowed.has(String(status).toUpperCase())) { sql += ' WHERE status = ?'; params.push(String(status).toUpperCase()); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const rows = await this.db.getAllRows(sql, params);
    return Promise.all(rows.map(async row => this.getPacket(row.id)));
  }

  async status() {
    return { version: VERSION, enabled: this.getConfig().enabled, policy: this.getConfig().policy, recentPackets: await this.listPackets(30) };
  }
}

module.exports = { VERSION, VERIFIED, NEEDS_RESEARCH, BLOCK, CLAIM_SUPPORTED, CLAIM_CONTESTED, CLAIM_INSUFFICIENT, defaultPolicy, normalizePolicy, tokens, bestSentence, buildClaimForQuestion, synthesizeClaims, assessPacket, ClaimVerificationEngineV127 };
