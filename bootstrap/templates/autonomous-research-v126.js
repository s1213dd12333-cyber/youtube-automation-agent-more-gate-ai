'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { ResearchAgentV5 } = require('./research-evidence-v5');

const VERSION = '12.6';
const READY = 'EVIDENCE_READY';
const MORE = 'RESEARCH_MORE';
const BLOCK = 'BLOCK';
const VALID_STATUSES = new Set([MORE, READY, BLOCK]);

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','can','did','do','does','for','from','has','have','how','if','in','into','is','it','its','may','of','on','or','our','that','the','their','there','these','this','to','was','were','what','when','where','which','who','why','will','with','would','about','after','before','current','latest','right','now','available','fact','facts','source','sources','evidence','report','reported','verified','confirm','confirmed','claim','claims'
]);

function clean(value, limit = 6000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clamp(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function uniq(values, limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = clean(value, 1200);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function tokens(value) {
  return uniq(String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(token => token.length >= 3 && !STOPWORDS.has(token)), 80);
}

function htmlToText(value) {
  return clean(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>'), 12000);
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch (_error) { return ''; }
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function safeExternalUrl(value) {
  const normalized = canonicalUrl(value);
  if (!normalized) return '';
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return '';
  if (isPrivateIpv4(host)) return '';
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return '';
  return normalized;
}

function domainOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_error) { return ''; }
}

function sourceClassFor(source = {}) {
  if (['official','scholarly','reference','web'].includes(source.sourceClass)) return source.sourceClass;
  const domain = domainOf(source.url || '');
  if (!domain) return 'web';
  if (/\.(gov|gob|mil)(\.|$)/i.test(`.${domain}.`) || domain.endsWith('.gov') || domain.endsWith('.gov.uk') || domain.endsWith('.europa.eu') || ['un.org','who.int','worldbank.org','imf.org','nato.int'].includes(domain)) return 'official';
  if (domain === 'doi.org' || domain.endsWith('.edu')) return 'scholarly';
  return 'web';
}

function defaultPolicy() {
  return {
    maxRounds: 3,
    maxSources: 16,
    maxDiscoveryPerQuery: 4,
    maxQueriesPerRound: 5,
    requestTimeoutMs: 7000,
    minimumEvidenceCharacters: 180,
    minimumCoverageRatio: 0.55,
    minimumEvidenceScore: 62,
    maximumSourceAgeHoursBreaking: 48,
    useGdeltDiscovery: true,
    useReferenceResearch: true,
    requireDistinctDomains: true
  };
}

function normalizePolicy(input = {}) {
  const base = defaultPolicy();
  const source = { ...base, ...(input || {}) };
  return {
    maxRounds: Math.round(clamp(source.maxRounds, 1, 5, base.maxRounds)),
    maxSources: Math.round(clamp(source.maxSources, 4, 40, base.maxSources)),
    maxDiscoveryPerQuery: Math.round(clamp(source.maxDiscoveryPerQuery, 1, 10, base.maxDiscoveryPerQuery)),
    maxQueriesPerRound: Math.round(clamp(source.maxQueriesPerRound, 1, 10, base.maxQueriesPerRound)),
    requestTimeoutMs: Math.round(clamp(source.requestTimeoutMs, 1000, 20000, base.requestTimeoutMs)),
    minimumEvidenceCharacters: Math.round(clamp(source.minimumEvidenceCharacters, 80, 3000, base.minimumEvidenceCharacters)),
    minimumCoverageRatio: clamp(source.minimumCoverageRatio, 0.2, 1, base.minimumCoverageRatio),
    minimumEvidenceScore: Math.round(clamp(source.minimumEvidenceScore, 30, 95, base.minimumEvidenceScore)),
    maximumSourceAgeHoursBreaking: Math.round(clamp(source.maximumSourceAgeHoursBreaking, 6, 168, base.maximumSourceAgeHoursBreaking)),
    useGdeltDiscovery: Boolean(source.useGdeltDiscovery),
    useReferenceResearch: Boolean(source.useReferenceResearch),
    requireDistinctDomains: Boolean(source.requireDistinctDomains)
  };
}

function buildResearchQueries(plan = {}, candidate = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const topic = clean(plan.topic || candidate?.cluster?.canonicalTitle || '', 240);
  const concepts = uniq(candidate?.event?.concepts || candidate?.event?.signature?.concepts || candidate?.cluster?.topicTokens || [], 20);
  const locations = uniq(candidate?.event?.locations || candidate?.event?.signature?.locations || [], 10);
  const plannedQuestions = Array.isArray(plan?.research?.questions) ? plan.research.questions : [];
  const queries = [topic];
  if (locations.length) queries.push(`${topic} ${locations.slice(0, 2).join(' ')}`);
  if (concepts.length) queries.push(`${topic} ${concepts.slice(0, 3).join(' ')}`);
  queries.push(`${topic} official statement`);
  queries.push(`${topic} timeline`);
  for (const question of plannedQuestions) {
    const key = tokens(question).slice(0, 4).join(' ');
    if (key) queries.push(`${topic} ${key}`);
  }
  return uniq(queries, policy.maxQueriesPerRound);
}

function questionCoverage(questions, sources) {
  const usable = (sources || []).filter(source => source.status === 'verified' && source.evidenceText);
  if (!questions?.length) return { ratio: usable.length ? 1 : 0, findings: [] };
  const allCorpus = usable.map(source => ({ source, corpus: new Set(tokens(`${source.title || ''} ${source.evidenceText || ''}`)) }));
  const findings = questions.map((question, index) => {
    const keyTokens = tokens(question).slice(0, 8);
    const matches = [];
    for (const item of allCorpus) {
      const overlap = keyTokens.filter(token => item.corpus.has(token));
      if (!keyTokens.length ? item.corpus.size > 0 : overlap.length >= Math.min(2, keyTokens.length)) {
        matches.push({ sourceId: item.source.id, url: item.source.url, matchedTokens: overlap });
      }
    }
    return { index, question: clean(question, 800), covered: matches.length > 0, matches: matches.slice(0, 6) };
  });
  const covered = findings.filter(item => item.covered).length;
  return { ratio: Number((covered / findings.length).toFixed(3)), findings };
}

function assessReadiness(plan = {}, sources = [], policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const requirements = plan.research || {};
  const verified = sources.filter(source => source.status === 'verified' && clean(source.evidenceText).length >= policy.minimumEvidenceCharacters);
  const domains = uniq(verified.map(source => domainOf(source.url)).filter(Boolean), 100);
  const primary = verified.filter(source => sourceClassFor(source) === 'official');
  const minimumIndependentSources = Math.max(1, Number(requirements.minimumIndependentSources || 3));
  const questions = Array.isArray(requirements.questions) ? requirements.questions : [];
  const coverage = questionCoverage(questions, verified);
  const independentCount = policy.requireDistinctDomains ? domains.length : verified.length;
  const gaps = [];
  if (independentCount < minimumIndependentSources) gaps.push(`need_${minimumIndependentSources - independentCount}_more_independent_source(s)`);
  if (requirements.primarySourceRequired && primary.length < 1) gaps.push('primary_or_official_source_required');
  if (coverage.ratio < policy.minimumCoverageRatio) gaps.push('research_question_coverage_below_threshold');
  const breadthScore = Math.min(100, independentCount / minimumIndependentSources * 100);
  const primaryScore = requirements.primarySourceRequired ? (primary.length ? 100 : 0) : Math.min(100, 60 + primary.length * 20);
  const coverageScore = coverage.ratio * 100;
  const evidenceDepth = verified.length ? Math.min(100, verified.reduce((sum, source) => sum + Math.min(2500, clean(source.evidenceText).length), 0) / (verified.length * 12)) : 0;
  const evidenceScore = Math.round(breadthScore * 0.42 + coverageScore * 0.30 + primaryScore * 0.18 + evidenceDepth * 0.10);
  if (evidenceScore < policy.minimumEvidenceScore) gaps.push('evidence_score_below_threshold');
  return {
    ready: gaps.length === 0,
    evidenceScore,
    coverageRatio: coverage.ratio,
    independentSourceCount: independentCount,
    primarySourceCount: primary.length,
    verifiedSourceCount: verified.length,
    sourceDomains: domains,
    findings: coverage.findings,
    gaps: uniq(gaps, 30)
  };
}

class AutonomousResearchV126 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.http = options.http || axios;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.policyOverride = options.policy || null;
    this.referenceResearch = options.referenceResearch || new ResearchAgentV5(null, { http: this.http, logger: this.logger });
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_AUTONOMOUS_RESEARCH_ENABLED || 'true').toLowerCase() !== 'false',
      defaultPolicy: normalizePolicy(this.policyOverride || {
        maxRounds: process.env.NEWSROOM_RESEARCH_MAX_ROUNDS,
        maxSources: process.env.NEWSROOM_RESEARCH_MAX_SOURCES,
        requestTimeoutMs: process.env.NEWSROOM_RESEARCH_HTTP_TIMEOUT_MS,
        minimumEvidenceCharacters: process.env.NEWSROOM_RESEARCH_MIN_EVIDENCE_CHARS,
        minimumCoverageRatio: process.env.NEWSROOM_RESEARCH_MIN_COVERAGE_RATIO,
        minimumEvidenceScore: process.env.NEWSROOM_RESEARCH_MIN_EVIDENCE_SCORE
      })
    };
  }

  async getPolicy() {
    const base = this.getConfig().defaultPolicy;
    if (!this.db) return { revisionNumber: 0, policy: base, source: 'default' };
    const row = await this.db.getRow('SELECT * FROM newsroom_autonomous_research_policy_revisions ORDER BY revision_number DESC LIMIT 1');
    if (!row) return { revisionNumber: 0, policy: base, source: 'default' };
    return { revisionNumber: Number(row.revision_number || 0), policy: normalizePolicy({ ...base, ...parseJson(row.policy_json, {}) }), reason: row.reason, createdBy: row.created_by, createdAt: row.created_at, source: 'persisted' };
  }

  async setPolicy(patch, actor = 'operator', reason = '') {
    if (!this.db) throw Object.assign(new Error('autonomous_research_policy_persistence_required'), { code: 'autonomous_research_policy_persistence_required' });
    const explanation = clean(reason, 500);
    if (explanation.length < 8) throw Object.assign(new Error('autonomous_research_policy_reason_required'), { code: 'autonomous_research_policy_reason_required' });
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      const current = await this.db.getRow('SELECT * FROM newsroom_autonomous_research_policy_revisions ORDER BY revision_number DESC LIMIT 1');
      const currentPolicy = current ? parseJson(current.policy_json, {}) : this.getConfig().defaultPolicy;
      const next = normalizePolicy({ ...currentPolicy, ...(patch || {}) });
      const revisionNumber = Number(current?.revision_number || 0) + 1;
      const fingerprint = hash(JSON.stringify(next)).slice(0, 32);
      const id = `news_research_policy_${revisionNumber}_${fingerprint.slice(0, 12)}`;
      await this.db.executeQuery(`INSERT INTO newsroom_autonomous_research_policy_revisions (id, revision_number, policy_json, policy_fingerprint, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [id, revisionNumber, JSON.stringify(next), fingerprint, explanation, clean(actor, 200) || 'operator']);
      await this.db.executeQuery('COMMIT');
      return { id, revisionNumber, policy: next, fingerprint, reason: explanation };
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
  }

  normalizeSource(source = {}, adapter = 'seed') {
    const url = safeExternalUrl(source.url);
    if (!url) return null;
    const evidenceText = clean(source.evidenceText || source.extract || source.snippet || '', 12000);
    return {
      id: source.id || `research_source_${hash(url).slice(0, 18)}`,
      url,
      title: clean(source.title || url, 600),
      publisher: clean(source.publisher || source.sourceName || domainOf(url), 300),
      publishedAt: source.publishedAt || null,
      sourceClass: sourceClassFor({ ...source, url }),
      sourceType: source.sourceType || 'article',
      adapter,
      status: evidenceText ? 'verified' : 'discovered',
      evidenceText,
      query: clean(source.query, 600) || null,
      notes: clean(source.notes, 1000)
    };
  }

  mergeSources(target, additions, maxSources) {
    const byUrl = new Map((target || []).map(source => [source.url, source]));
    for (const source of additions || []) {
      if (!source?.url) continue;
      const existing = byUrl.get(source.url);
      if (!existing || clean(source.evidenceText).length > clean(existing.evidenceText).length) byUrl.set(source.url, source);
    }
    return [...byUrl.values()].sort((a, b) => {
      const classRank = { official: 4, scholarly: 3, reference: 2, web: 1 };
      return (classRank[b.sourceClass] || 0) - (classRank[a.sourceClass] || 0) || clean(b.evidenceText).length - clean(a.evidenceText).length;
    }).slice(0, maxSources);
  }

  async fetchEvidence(source, policy) {
    const normalized = this.normalizeSource(source, source.adapter || 'seed');
    if (!normalized || normalized.evidenceText) return normalized;
    try {
      const response = await this.http.get(normalized.url, {
        timeout: policy.requestTimeoutMs,
        maxRedirects: 0,
        headers: { 'User-Agent': 'AgentTube-Newsroom/12.6 (+evidence acquisition)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
        responseType: 'text',
        transformResponse: value => value
      });
      const contentType = String(response?.headers?.['content-type'] || '').toLowerCase();
      const raw = typeof response?.data === 'string' ? response.data : JSON.stringify(response?.data || '');
      const evidenceText = contentType.includes('html') ? htmlToText(raw) : clean(raw, 12000);
      return { ...normalized, status: evidenceText.length >= policy.minimumEvidenceCharacters ? 'verified' : 'discovered', evidenceText };
    } catch (error) {
      return { ...normalized, status: 'unavailable', notes: clean(`Fetch failed: ${error.message}`, 500) };
    }
  }

  async discoverGdelt(query, policy) {
    if (!policy.useGdeltDiscovery || !query) return [];
    const response = await this.http.get('https://api.gdeltproject.org/api/v2/doc/doc', {
      timeout: policy.requestTimeoutMs,
      params: { query, mode: 'ArtList', maxrecords: policy.maxDiscoveryPerQuery, format: 'json', sort: 'HybridRel' },
      headers: { 'User-Agent': 'AgentTube-Newsroom/12.6', Accept: 'application/json' }
    });
    const articles = Array.isArray(response?.data?.articles) ? response.data.articles : [];
    return articles.map(article => this.normalizeSource({
      url: article.url,
      title: article.title,
      publisher: article.domain,
      publishedAt: article.seendate || article.socialimage || null,
      query,
      notes: 'Discovered through GDELT; page content must be retrieved before it counts as evidence.'
    }, 'gdelt')).filter(Boolean);
  }

  async referenceSources(topic, seedSources, policy) {
    if (!policy.useReferenceResearch || !this.referenceResearch) return [];
    const pack = await this.referenceResearch.research({ topic, seedSources });
    return (pack?.sources || []).map(source => this.normalizeSource(source, `reference:${source.adapter || 'v5'}`)).filter(Boolean);
  }

  async persistRound(runId, roundNumber, status, queries, readiness) {
    if (!this.db || !runId) return;
    const id = `news_research_round_${hash(`${runId}:${roundNumber}`).slice(0, 24)}`;
    await this.db.executeQuery(`INSERT OR IGNORE INTO newsroom_autonomous_research_rounds (id, run_id, round_number, status, queries_json, source_count, independent_source_count, primary_source_count, coverage_ratio, gaps_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [id, runId, roundNumber, status, JSON.stringify(queries || []), readiness.verifiedSourceCount || 0, readiness.independentSourceCount || 0, readiness.primarySourceCount || 0, readiness.coverageRatio || 0, JSON.stringify(readiness.gaps || [])]);
  }

  async researchSelected(input = {}) {
    if (!this.getConfig().enabled) return null;
    const plan = input.editorialPlan || input.plan;
    if (!plan?.id) throw Object.assign(new Error('editorial_plan_required_for_autonomous_research'), { code: 'editorial_plan_required_for_autonomous_research' });
    const candidate = input.candidate || {};
    const policyState = await this.getPolicy();
    const policy = policyState.policy;
    const requirements = plan.research || {};
    const questions = Array.isArray(requirements.questions) ? requirements.questions : [];
    const queries = buildResearchQueries(plan, candidate, policy);
    const seedArticles = Array.isArray(candidate?.cluster?.articles) ? candidate.cluster.articles : [];
    const material = {
      version: VERSION,
      planId: plan.id,
      decisionId: input.decision?.id || input.brainDecision?.id || null,
      clusterId: candidate?.cluster?.id || null,
      eventId: candidate?.event?.id || null,
      scanId: input.scanId || null,
      policyRevision: policyState.revisionNumber,
      requirements,
      queries,
      seedUrls: seedArticles.map(item => safeExternalUrl(item.url)).filter(Boolean),
      eventRevision: Number(candidate?.event?.revisionNumber || 0),
      planFingerprint: plan.fingerprint || null
    };
    const fingerprint = hash(JSON.stringify(material)).slice(0, 32);
    const runId = `news_research_${fingerprint.slice(0, 24)}`;
    if (this.db) {
      const existing = await this.db.getRow('SELECT * FROM newsroom_autonomous_research_runs WHERE run_fingerprint = ?', [fingerprint]);
      if (existing) return this.rowToRun(existing);
    }

    let sources = seedArticles.map(article => this.normalizeSource({ ...article, publisher: article.sourceName || article.sourceDomain }, 'newsroom_seed')).filter(Boolean);
    const adapterStatus = {};
    let finalReadiness = assessReadiness(plan, sources, policy);
    let roundCount = 0;
    let finalStatus = MORE;

    for (let round = 1; round <= policy.maxRounds; round += 1) {
      roundCount = round;
      if (round === 1) {
        const fetched = [];
        for (const source of sources.slice(0, policy.maxSources)) fetched.push(await this.fetchEvidence(source, policy));
        sources = this.mergeSources([], fetched.filter(Boolean), policy.maxSources);
        adapterStatus.seedFetch = { ok: true, attempted: fetched.length, verified: fetched.filter(item => item?.status === 'verified').length };
      } else if (round === 2 && policy.useGdeltDiscovery) {
        const discovered = [];
        for (const query of queries) {
          try {
            const found = await this.discoverGdelt(query, policy);
            discovered.push(...found);
          } catch (error) {
            adapterStatus.gdelt = { ok: false, error: clean(error.message, 400) };
          }
        }
        const fresh = this.mergeSources([], discovered, policy.maxSources).filter(source => !sources.some(existing => existing.url === source.url));
        const fetched = [];
        for (const source of fresh.slice(0, Math.max(0, policy.maxSources - sources.length))) fetched.push(await this.fetchEvidence(source, policy));
        sources = this.mergeSources(sources, fetched.filter(Boolean), policy.maxSources);
        if (!adapterStatus.gdelt?.error) adapterStatus.gdelt = { ok: true, discovered: discovered.length, fetched: fetched.length, verified: fetched.filter(item => item?.status === 'verified').length };
      } else if (policy.useReferenceResearch) {
        try {
          const reference = await this.referenceSources(plan.topic, sources, policy);
          sources = this.mergeSources(sources, reference, policy.maxSources);
          adapterStatus.referenceResearch = { ok: true, count: reference.length, verified: reference.filter(item => item.status === 'verified').length };
        } catch (error) {
          adapterStatus.referenceResearch = { ok: false, error: clean(error.message, 400) };
        }
      }

      finalReadiness = assessReadiness(plan, sources, policy);
      finalStatus = finalReadiness.ready ? READY : MORE;
      await this.persistRound(runId, round, finalStatus, queries, finalReadiness);
      if (finalReadiness.ready) break;
    }

    if (!finalReadiness.ready) finalStatus = BLOCK;
    const result = {
      id: runId,
      version: VERSION,
      planId: plan.id,
      decisionId: input.decision?.id || input.brainDecision?.id || null,
      clusterId: candidate?.cluster?.id || null,
      eventId: candidate?.event?.id || null,
      scanId: input.scanId || null,
      status: finalStatus,
      roundCount,
      requirements,
      questions,
      queries,
      sources,
      sourceDomains: finalReadiness.sourceDomains,
      findings: finalReadiness.findings,
      gaps: finalReadiness.gaps,
      adapterStatus,
      evidenceScore: finalReadiness.evidenceScore,
      coverageRatio: finalReadiness.coverageRatio,
      primarySourceCount: finalReadiness.primarySourceCount,
      independentSourceCount: finalReadiness.independentSourceCount,
      fingerprint,
      policyRevision: policyState.revisionNumber,
      createdAt: new Date().toISOString()
    };

    if (this.db) {
      await this.db.executeQuery(`INSERT OR IGNORE INTO newsroom_autonomous_research_runs (id, plan_id, decision_id, cluster_id, event_id, scan_id, engine_version, status, round_count, requirements_json, questions_json, sources_json, source_domains_json, findings_json, gaps_json, adapter_status_json, evidence_score, coverage_ratio, primary_source_count, independent_source_count, run_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [result.id, result.planId, result.decisionId, result.clusterId, result.eventId, result.scanId, VERSION, result.status, result.roundCount, JSON.stringify(result.requirements), JSON.stringify(result.questions), JSON.stringify(result.sources), JSON.stringify(result.sourceDomains), JSON.stringify(result.findings), JSON.stringify(result.gaps), JSON.stringify(result.adapterStatus), result.evidenceScore, result.coverageRatio, result.primarySourceCount, result.independentSourceCount, result.fingerprint]);
    }
    this.logger.info(`Autonomous Research 12.6 ${result.status}: ${result.independentSourceCount} independent source(s), score ${result.evidenceScore}/100, coverage ${Math.round(result.coverageRatio * 100)}%.`);
    return result;
  }

  rowToRun(row) {
    if (!row) return null;
    return {
      id: row.id, version: row.engine_version, planId: row.plan_id, decisionId: row.decision_id,
      clusterId: row.cluster_id, eventId: row.event_id, scanId: row.scan_id, status: row.status,
      roundCount: Number(row.round_count || 0), requirements: parseJson(row.requirements_json, {}),
      questions: parseJson(row.questions_json, []), sources: parseJson(row.sources_json, []),
      sourceDomains: parseJson(row.source_domains_json, []), findings: parseJson(row.findings_json, []),
      gaps: parseJson(row.gaps_json, []), adapterStatus: parseJson(row.adapter_status_json, {}),
      evidenceScore: Number(row.evidence_score || 0), coverageRatio: Number(row.coverage_ratio || 0),
      primarySourceCount: Number(row.primary_source_count || 0), independentSourceCount: Number(row.independent_source_count || 0),
      promotedIdeaId: row.promoted_idea_id || null, assignmentId: row.assignment_id || null,
      fingerprint: row.run_fingerprint, createdAt: row.created_at
    };
  }

  async getRun(runId) {
    if (!this.db) return null;
    return this.rowToRun(await this.db.getRow('SELECT * FROM newsroom_autonomous_research_runs WHERE id = ?', [runId]));
  }

  async listRuns(limit = 100, status = null) {
    if (!this.db) return [];
    const params = [];
    let sql = 'SELECT * FROM newsroom_autonomous_research_runs';
    if (status && VALID_STATUSES.has(String(status).toUpperCase())) { sql += ' WHERE status = ?'; params.push(String(status).toUpperCase()); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    return (await this.db.getAllRows(sql, params)).map(row => this.rowToRun(row));
  }

  async linkPromotion(runId, promotion = {}) {
    if (!this.db || !runId) return null;
    const ideaId = promotion?.idea?.id || promotion?.ideaId || null;
    const assignmentId = promotion?.assignmentId || null;
    await this.db.executeQuery('UPDATE newsroom_autonomous_research_runs SET promoted_idea_id = ?, assignment_id = ? WHERE id = ?', [ideaId, assignmentId, runId]);
    return this.getRun(runId);
  }

  async status() {
    return { version: VERSION, enabled: this.getConfig().enabled, policy: await this.getPolicy(), recentRuns: await this.listRuns(30) };
  }
}

module.exports = {
  VERSION, READY, MORE, BLOCK, defaultPolicy, normalizePolicy, safeExternalUrl, sourceClassFor,
  buildResearchQueries, questionCoverage, assessReadiness, AutonomousResearchV126
};
