'use strict';

const crypto = require('crypto');
const axios = require('axios');

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','by','can','could','did','do','does','for','from','had','has','have','how','if','in','into','is','it','its','may','might','more','most','of','on','or','our','that','the','their','there','these','they','this','to','was','were','what','when','where','which','while','who','will','with','would','you','your'
]);

function cleanText(value, limit = 6000) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch (_error) {
    return '';
  }
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function reconstructAbstract(inverted = {}) {
  if (!inverted || typeof inverted !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) words.push([Number(position), word]);
  }
  words.sort((a, b) => a[0] - b[0]);
  return cleanText(words.map(item => item[1]).join(' '), 5000);
}

function meaningfulTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(token => token.length >= 3 && !STOPWORDS.has(token)))];
}

function lexicalSupport(claim, source) {
  const claimTokens = meaningfulTokens(claim);
  const corpus = meaningfulTokens(`${source.title || ''} ${source.evidenceText || ''}`);
  const corpusSet = new Set(corpus);
  const matchedTokens = claimTokens.filter(token => corpusSet.has(token));
  const score = claimTokens.length ? matchedTokens.length / claimTokens.length : 0;
  return {
    score: Number(score.toFixed(3)),
    matchedTokens,
    claimTokenCount: claimTokens.length
  };
}

class ResearchAgentV5 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.http = options.http || axios;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.maxSources = Math.max(4, Math.min(20, Number(options.maxSources || process.env.RESEARCH_MAX_SOURCES || 12)));
    this.timeout = Math.max(1000, Math.min(20000, Number(options.timeout || process.env.RESEARCH_HTTP_TIMEOUT_MS || 8000)));
  }

  async research(input = {}) {
    const topic = cleanText(input.topic, 300);
    if (!topic) {
      const error = new Error('Research topic is required');
      error.code = 'RESEARCH_TOPIC_REQUIRED';
      error.status = 422;
      throw error;
    }

    const candidates = [];
    for (const source of Array.isArray(input.seedSources) ? input.seedSources : []) {
      const normalized = this.normalizeSource(source, 'seed');
      if (normalized) candidates.push(normalized);
    }

    const adapters = [
      ['wikipedia', () => this.searchWikipedia(topic)],
      ['crossref', () => this.searchCrossref(topic)],
      ['openalex', () => this.searchOpenAlex(topic)]
    ];
    const adapterStatus = {};
    for (const [name, run] of adapters) {
      try {
        const found = await run();
        candidates.push(...found);
        adapterStatus[name] = { ok: true, count: found.length };
      } catch (error) {
        adapterStatus[name] = { ok: false, count: 0, error: cleanText(error.message, 300) };
        this.logger.warn(`Research adapter ${name} unavailable for "${topic}": ${error.message}`);
      }
    }

    const byUrl = new Map();
    for (const source of candidates) {
      if (!source?.url) continue;
      const existing = byUrl.get(source.url);
      if (!existing || this.sourceScore(source) > this.sourceScore(existing)) byUrl.set(source.url, source);
    }
    const sources = [...byUrl.values()]
      .sort((a, b) => this.sourceScore(b) - this.sourceScore(a))
      .slice(0, this.maxSources)
      .map((source, index) => ({ ...source, id: source.id || `source_${index + 1}_${hash(source.url).slice(0, 10)}` }));

    const verified = sources.filter(source => source.status === 'verified' && source.evidenceText).length;
    const pack = {
      id: `research_${hash(`${input.jobId || 'direct'}\u0000${topic}`).slice(0, 24)}`,
      version: 5,
      jobId: input.jobId || null,
      topic,
      status: verified > 0 ? 'ready' : sources.length ? 'limited' : 'unavailable',
      sources,
      adapterStatus,
      createdAt: new Date().toISOString(),
      summary: {
        sourceCount: sources.length,
        verifiedEvidenceSources: verified,
        scholarlySources: sources.filter(source => source.sourceClass === 'scholarly').length,
        officialSources: sources.filter(source => source.sourceClass === 'official').length,
        evidenceCharacters: sources.reduce((sum, source) => sum + String(source.evidenceText || '').length, 0)
      }
    };

    if (this.db?.saveResearchEvidencePack) await this.db.saveResearchEvidencePack(pack);
    this.logger.info(`Research Agent v5 found ${sources.length} source(s), ${verified} with evidence text, for: ${topic}`);
    return pack;
  }

  normalizeSource(source, adapter = 'seed') {
    const url = canonicalUrl(source?.url);
    if (!url) return null;
    const evidenceText = cleanText(source?.evidenceText || source?.abstract || source?.extract || source?.snippet, 6000);
    const sourceClass = ['scholarly', 'official', 'reference', 'web'].includes(source?.sourceClass)
      ? source.sourceClass
      : adapter === 'crossref' || adapter === 'openalex' ? 'scholarly' : adapter === 'wikipedia' ? 'reference' : 'web';
    const sourceType = source?.sourceType === 'dataset' || source?.sourceType === 'official'
      ? source.sourceType
      : 'article';
    return {
      id: source?.id || null,
      url,
      title: cleanText(source?.title || url, 500),
      publisher: cleanText(source?.publisher, 250),
      publishedAt: source?.publishedAt || null,
      accessedAt: source?.accessedAt || new Date().toISOString(),
      sourceType,
      sourceClass,
      adapter,
      status: evidenceText ? 'verified' : 'discovered',
      evidenceText,
      notes: cleanText(source?.notes, 1000)
    };
  }

  sourceScore(source) {
    const classScore = { official: 40, scholarly: 35, reference: 20, web: 10 }[source?.sourceClass] || 0;
    const evidenceScore = source?.evidenceText ? Math.min(30, 10 + source.evidenceText.length / 250) : 0;
    const publishedScore = source?.publishedAt ? 5 : 0;
    return classScore + evidenceScore + publishedScore;
  }

  async searchWikipedia(topic) {
    const response = await this.http.get('https://en.wikipedia.org/w/api.php', {
      timeout: this.timeout,
      headers: {
        'User-Agent': 'LumenAtlas/1.0 (research provenance; https://github.com/s1213dd12333-cyber/youtube-automation-agent-more-gate-ai)',
        Accept: 'application/json'
      },
      params: {
        action: 'query', generator: 'search', gsrsearch: topic, gsrlimit: 4,
        prop: 'extracts|info', exintro: 1, explaintext: 1, inprop: 'url', format: 'json', origin: '*'
      }
    });
    const pages = Object.values(response?.data?.query?.pages || {});
    return pages.map(page => this.normalizeSource({
      url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title || '').replace(/ /g, '_'))}`,
      title: page.title,
      publisher: 'Wikipedia',
      evidenceText: page.extract,
      notes: 'Wikipedia overview used as a reference source; prefer scholarly/official evidence for high-risk claims.'
    }, 'wikipedia')).filter(Boolean);
  }

  async searchCrossref(topic) {
    const response = await this.http.get('https://api.crossref.org/works', {
      timeout: this.timeout,
      headers: { 'User-Agent': 'LumenAtlas/1.0 (research provenance)' },
      params: { 'query.bibliographic': topic, rows: 5 }
    });
    return (response?.data?.message?.items || []).map(item => {
      const dateParts = item.published?.['date-parts']?.[0];
      const publishedAt = Array.isArray(dateParts) && dateParts[0]
        ? new Date(Date.UTC(dateParts[0], Math.max(0, (dateParts[1] || 1) - 1), dateParts[2] || 1)).toISOString()
        : null;
      return this.normalizeSource({
        url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
        title: Array.isArray(item.title) ? item.title[0] : item.title,
        publisher: item.publisher || 'Crossref',
        publishedAt,
        evidenceText: item.abstract,
        notes: item.DOI ? `DOI: ${item.DOI}` : ''
      }, 'crossref');
    }).filter(Boolean);
  }

  async searchOpenAlex(topic) {
    const response = await this.http.get('https://api.openalex.org/works', {
      timeout: this.timeout,
      headers: { 'User-Agent': 'LumenAtlas/1.0 (research provenance)' },
      params: { search: topic, 'per-page': 5 }
    });
    return (response?.data?.results || []).map(item => this.normalizeSource({
      url: item.doi || item.primary_location?.landing_page_url || item.id,
      title: item.title,
      publisher: item.primary_location?.source?.display_name || 'OpenAlex',
      publishedAt: item.publication_date || null,
      evidenceText: reconstructAbstract(item.abstract_inverted_index),
      notes: item.id ? `OpenAlex: ${item.id}` : ''
    }, 'openalex')).filter(Boolean);
  }
}

class EvidenceDeskV5 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.standardThreshold = Number(options.standardThreshold || process.env.EVIDENCE_STANDARD_THRESHOLD || 0.24);
    this.highThreshold = Number(options.highThreshold || process.env.EVIDENCE_HIGH_THRESHOLD || 0.32);
  }

  async verifyScript(input = {}) {
    const script = input.script || {};
    const pack = input.evidencePack || { sources: input.sources || [] };
    const sources = Array.isArray(pack.sources) ? pack.sources : [];
    const byUrl = new Map(sources.map(source => [canonicalUrl(source.url), source]).filter(item => item[0]));
    const declared = Array.isArray(script.claims) ? script.claims : [];
    const claims = declared.map((claim, index) => this.verifyClaim(claim, index, byUrl));
    const unresolved = claims.filter(claim => claim.status !== 'supported');
    const review = {
      id: `evidence_${hash(`${input.jobId || pack.jobId || 'direct'}\u0000${script.title || ''}\u0000${script.fullScript || ''}`).slice(0, 24)}`,
      version: 5,
      jobId: input.jobId || pack.jobId || null,
      scriptTitle: cleanText(script.title, 300),
      scriptHash: hash(script.fullScript || JSON.stringify(script.mainContent || {})),
      status: claims.length === 0 ? 'not_required' : unresolved.length === 0 ? 'verified' : 'blocked',
      claims,
      createdAt: new Date().toISOString(),
      summary: {
        claimCount: claims.length,
        supportedClaims: claims.length - unresolved.length,
        unresolvedClaims: unresolved.length,
        highRiskClaims: claims.filter(claim => claim.riskLevel === 'high').length,
        sourceCount: sources.length,
        verifiedEvidenceSources: sources.filter(source => source.status === 'verified' && source.evidenceText).length
      }
    };
    if (this.db?.saveEvidenceReview) await this.db.saveEvidenceReview(review);
    return review;
  }

  verifyClaim(claim, index, byUrl) {
    const text = cleanText(claim?.text || claim?.claim, 2000);
    const riskLevel = claim?.riskLevel === 'high' ? 'high' : 'standard';
    const urls = [...new Set((Array.isArray(claim?.sourceUrls) ? claim.sourceUrls : []).map(canonicalUrl).filter(Boolean))];
    const cited = urls.map(url => byUrl.get(url)).filter(Boolean);
    const supports = cited
      .filter(source => source.status === 'verified' && source.evidenceText)
      .map(source => ({
        sourceId: source.id || null,
        url: source.url,
        sourceClass: source.sourceClass || 'web',
        ...lexicalSupport(text, source)
      }));
    const threshold = riskLevel === 'high' ? this.highThreshold : this.standardThreshold;
    const passing = supports.filter(item => item.matchedTokens.length >= 2 && item.score >= threshold);
    const strongClass = passing.some(item => ['scholarly', 'official'].includes(item.sourceClass));
    const supported = riskLevel === 'high'
      ? passing.length >= 2 || (passing.length >= 1 && strongClass && passing[0].score >= this.highThreshold)
      : passing.length >= 1;
    const best = supports.sort((a, b) => b.score - a.score)[0] || null;

    let notes = '';
    if (!text) notes = 'Claim text is empty.';
    else if (!urls.length) notes = 'No source URL was declared for this factual claim.';
    else if (cited.length !== urls.length) notes = 'One or more cited URLs are not present in the Research Agent evidence pack.';
    else if (!supports.length) notes = 'Cited sources contain no retrieved evidence text for automated support checking.';
    else if (!supported) notes = `Retrieved evidence did not meet the ${riskLevel} lexical-support threshold; human review or stronger evidence is required.`;
    else notes = `Supported by ${passing.length} retrieved evidence source(s); best lexical score ${best.score}.`;

    return {
      id: claim?.id || `claim_${index + 1}_${hash(text).slice(0, 10)}`,
      text,
      riskLevel,
      sourceUrls: urls,
      sourceIds: passing.map(item => item.sourceId).filter(Boolean),
      status: supported ? 'supported' : 'unsupported',
      confidence: best ? best.score : 0,
      evidenceMatches: supports,
      notes
    };
  }

  assertReview(review) {
    const strict = String(process.env.EVIDENCE_STRICT_MODE || 'true').toLowerCase() !== 'false';
    if (!strict || !review || review.status !== 'blocked') return review;
    const unresolved = review.claims.filter(claim => claim.status !== 'supported');
    const error = new Error(`Evidence Desk blocked ${unresolved.length} unsupported factual claim(s) before production.`);
    error.code = 'EVIDENCE_CLAIMS_UNVERIFIED';
    error.status = 422;
    error.details = unresolved.slice(0, 10).map(claim => ({ id: claim.id, text: claim.text, notes: claim.notes }));
    throw error;
  }
}

module.exports = {
  ResearchAgentV5,
  EvidenceDeskV5,
  canonicalUrl,
  cleanText,
  reconstructAbstract,
  meaningfulTokens,
  lexicalSupport
};
