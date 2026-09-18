'use strict';

const crypto = require('crypto');
const axios = require('axios');

const VERSION = '12.1';
const ACTIONS = new Set(['COVER', 'WAIT', 'IGNORE', 'UPDATE', 'BREAKING', 'FOLLOW_UP']);
const GENERIC_TOKENS = new Set([
  'breaking','latest','live','update','updates','news','report','reports','world','today','says','say','said','new',
  'the','and','for','with','from','that','this','into','after','before','over','under','about','amid','what','why','how','who','when','where',
  'uma','para','com','dos','das','que','por','como','mais','sobre','após','antes','mundo','notícia','noticias','notícias','hoje',
  'una','para','con','los','las','del','que','por','como','más','sobre','tras','antes','mundo','noticias','hoy',
  'une','des','les','dans','avec','pour','sur','apres','avant','monde','actualites','aujourd','hui'
]);

const EVENT_TOKEN_ALIASES = new Map(Object.entries({
  quake: 'earthquake', quakes: 'earthquake', terremoto: 'earthquake', terremotos: 'earthquake', sismo: 'earthquake', sismos: 'earthquake', seisme: 'earthquake', seismes: 'earthquake',
  incendio: 'fire', incendios: 'fire', incendie: 'fire', incendies: 'fire', feux: 'fire',
  inundacao: 'flood', inundacoes: 'flood', inundacion: 'flood', inundaciones: 'flood', inondation: 'flood', inondations: 'flood',
  ataque: 'attack', ataques: 'attack', attaque: 'attack', attaques: 'attack', attacked: 'attack', attacking: 'attack',
  airstrike: 'strike', airstrikes: 'strike', strikes: 'strike', struck: 'strike',
  eleicao: 'election', eleicoes: 'election', elecciones: 'election', elections: 'election',
  tempestade: 'storm', tempestades: 'storm', tormenta: 'storm', tormentas: 'storm', tempete: 'storm', tempetes: 'storm',
  alerta: 'alert', alertas: 'alert', alerte: 'alert', alertes: 'alert', alerts: 'alert',
  aviso: 'warning', avisos: 'warning', avertissement: 'warning', avertissements: 'warning', warnings: 'warning',
  norte: 'north', nord: 'north', northern: 'north', sul: 'south', sud: 'south', southern: 'south',
  leste: 'east', eastern: 'east', oeste: 'west', ouest: 'west', western: 'west',
  japao: 'japan', japon: 'japan', japanese: 'japan', israelense: 'israel', israeli: 'israel',
  palestino: 'palestine', palestina: 'palestine', palestinian: 'palestine', ucraniano: 'ukraine', ucraniana: 'ukraine', ukrainian: 'ukraine',
  russo: 'russia', russa: 'russia', russian: 'russia', iraniano: 'iran', iraniana: 'iran', iranian: 'iran',
  chines: 'china', chinesa: 'china', chinese: 'china', americano: 'usa', americana: 'usa', american: 'usa',
  atingiu: 'hit', atinge: 'hit', atingem: 'hit', golpea: 'hit', golpeo: 'hit', frappe: 'hit', frappent: 'hit', hits: 'hit',
  emitido: 'issue', emitida: 'issue', emitidos: 'issue', emitidas: 'issue', issued: 'issue', issues: 'issue',
  forte: 'strong', fuerte: 'strong', fuertes: 'strong', puissant: 'strong', puissante: 'strong'
}));

function canonicalEventToken(value) {
  let token = String(value || '').toLowerCase().replace(/^['-]+|['-]+$/g, '');
  if (!token) return '';
  if (EVENT_TOKEN_ALIASES.has(token)) return EVENT_TOKEN_ALIASES.get(token);
  if (token.length > 5 && token.endsWith('ies')) token = token.slice(0, -3) + 'y';
  else if (token.length > 4 && token.endsWith('s') && !/(ss|us|is)$/.test(token)) token = token.slice(0, -1);
  return EVENT_TOKEN_ALIASES.get(token) || token;
}

const DEFAULT_GDELT_LANES = Object.freeze([
  { id: 'gdelt_global_english', query: 'sourcelang:english', language: 'English', maxRecords: 180 },
  { id: 'gdelt_global_spanish', query: 'sourcelang:spanish', language: 'Spanish', maxRecords: 120 },
  { id: 'gdelt_global_portuguese', query: 'sourcelang:portuguese', language: 'Portuguese', maxRecords: 100 },
  { id: 'gdelt_global_french', query: 'sourcelang:french', language: 'French', maxRecords: 100 }
]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clean(value, limit = 1000) {
  return String(value == null ? '' : value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|referrer$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch (_error) {
    return '';
  }
}

function domainOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_error) {
    return '';
  }
}

function normalizeTitle(value) {
  return clean(value, 500)
    .replace(/\s+[\-|–|—]\s+[^\-|–|—]{2,45}$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  const prepared = String(value || '')
    .replace(/\bU\.?S\.?\b/gi, ' usa ')
    .replace(/\bU\.?K\.?\b/gi, ' britain ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map(canonicalEventToken)
    .filter(token => token.length >= 3 && !GENERIC_TOKENS.has(token));
  return [...new Set(prepared)];
}

function jaccard(left, right) {
  const a = left instanceof Set ? left : new Set(left || []);
  const b = right instanceof Set ? right : new Set(right || []);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function overlapCoefficient(left, right) {
  const a = left instanceof Set ? left : new Set(left || []);
  const b = right instanceof Set ? right : new Set(right || []);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function parseDate(value) {
  if (!value) return null;
  const gdelt = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (gdelt) {
    const [, y, m, d, hh, mm, ss] = gdelt;
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countryRegion(country) {
  const key = String(country || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return 'Unknown';
  const groups = [
    ['North America', ['unitedstates','us','usa','canada','mexico']],
    ['Latin America', ['brazil','argentina','chile','colombia','peru','venezuela','ecuador','bolivia','paraguay','uruguay','costarica','panama','guatemala','cuba','dominicanrepublic','haiti']],
    ['Europe', ['unitedkingdom','uk','britain','ireland','france','germany','spain','portugal','italy','netherlands','belgium','switzerland','austria','poland','ukraine','russia','sweden','norway','finland','denmark','greece','romania','hungary','czechrepublic','slovakia','serbia','croatia','bulgaria']],
    ['Middle East', ['israel','palestine','iran','iraq','saudiarabia','qatar','unitedarabemirates','uae','jordan','lebanon','syria','yemen','oman','bahrain','turkey']],
    ['Africa', ['southafrica','nigeria','kenya','egypt','ethiopia','ghana','morocco','algeria','tunisia','sudan','southsudan','somalia','uganda','tanzania','rwanda','senegal','cameroon','congo','democraticrepublicofthecongo','zimbabwe','zambia','mozambique']],
    ['South Asia', ['india','pakistan','bangladesh','srilanka','nepal','bhutan','maldives','afghanistan']],
    ['East Asia', ['china','japan','southkorea','northkorea','taiwan','hongkong','mongolia']],
    ['Southeast Asia', ['indonesia','philippines','vietnam','thailand','malaysia','singapore','myanmar','cambodia','laos','brunei','timorleste']],
    ['Oceania', ['australia','newzealand','fiji','papuanewguinea','samoa','tonga']]
  ];
  for (const [region, values] of groups) if (values.includes(key)) return region;
  return 'Other';
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function xmlValue(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? clean(match[1], 2000) : '';
}

function xmlLink(block) {
  const text = xmlValue(block, 'link');
  if (text) return canonicalUrl(text);
  const match = String(block || '').match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
  return match ? canonicalUrl(match[1]) : '';
}

function parseRss(xml, source = {}) {
  const blocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(block => {
    const url = xmlLink(block) || canonicalUrl(xmlValue(block, 'guid'));
    const title = clean(xmlValue(block, 'title'), 500);
    if (!url || !title) return null;
    const publishedAt = parseDate(xmlValue(block, 'pubDate') || xmlValue(block, 'published') || xmlValue(block, 'updated'));
    const sourceName = clean(xmlValue(block, 'source') || source.name || domainOf(url), 200);
    return {
      url,
      title,
      summary: clean(xmlValue(block, 'description') || xmlValue(block, 'summary'), 800),
      sourceName,
      sourceDomain: domainOf(url),
      sourceCountry: clean(source.country, 100),
      sourceRegion: clean(source.region, 100) || countryRegion(source.country),
      language: clean(source.language, 80) || 'unknown',
      publishedAt,
      adapter: 'rss',
      laneId: source.id || 'rss'
    };
  }).filter(Boolean);
}

function recalcCluster(cluster) {
  const frequency = new Map();
  for (const article of cluster.articles) {
    for (const token of article.topicTokens) frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  const threshold = Math.max(1, Math.ceil(cluster.articles.length * 0.28));
  cluster.topicTokens = [...frequency.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token)
    .slice(0, 18);
  if (cluster.topicTokens.length < 3) {
    cluster.topicTokens = [...frequency.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([token]) => token)
      .slice(0, 18);
  }
  const core = new Set(cluster.topicTokens);
  cluster.canonicalArticle = [...cluster.articles].sort((a, b) => {
    const relevance = overlapCoefficient(b.topicTokens, core) - overlapCoefficient(a.topicTokens, core);
    if (Math.abs(relevance) > 0.001) return relevance;
    return new Date(b.publishedAt || b.seenAt || 0) - new Date(a.publishedAt || a.seenAt || 0);
  })[0] || cluster.articles[0];
  cluster.canonicalTitle = cluster.canonicalArticle?.title || 'Untitled news event';
  return cluster;
}

function articleContextTokens(article) {
  const titleTokens = Array.isArray(article?.topicTokens) ? article.topicTokens : tokens(normalizeTitle(article?.title));
  const summaryTokens = tokens(clean(article?.summary || '', 500)).slice(0, 18);
  return [...new Set([...titleTokens, ...summaryTokens])];
}

function articleTimeMs(article) {
  const value = new Date(article?.publishedAt || article?.seenAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function eventSimilarity(left, right, maxGapHours = 18) {
  const leftTime = articleTimeMs(left);
  const rightTime = articleTimeMs(right);
  const gapHours = leftTime && rightTime ? Math.abs(leftTime - rightTime) / 3600000 : 0;
  if (gapHours > maxGapHours) return { score: 0, titleScore: 0, contextScore: 0, sharedTitle: 0, sharedContext: 0, gapHours };
  const leftTitle = left?.topicTokens || [];
  const rightTitle = right?.topicTokens || [];
  const leftContext = left?.contextTokens || articleContextTokens(left);
  const rightContext = right?.contextTokens || articleContextTokens(right);
  const sharedTitle = leftTitle.filter(token => rightTitle.includes(token)).length;
  const sharedContext = leftContext.filter(token => rightContext.includes(token)).length;
  const titleScore = Math.max(jaccard(leftTitle, rightTitle), overlapCoefficient(leftTitle, rightTitle) * 0.88);
  const contextScore = Math.max(jaccard(leftContext, rightContext) * 0.72, overlapCoefficient(leftContext, rightContext) * 0.66);
  return { score: Math.max(titleScore, contextScore), titleScore, contextScore, sharedTitle, sharedContext, gapHours };
}

function clusterArticles(articles, threshold = 0.36, maxGapHours = 18) {
  const prepared = (articles || []).map(article => {
    const topicTokens = tokens(normalizeTitle(article.title));
    return { ...article, normalizedTitle: normalizeTitle(article.title), topicTokens, contextTokens: articleContextTokens({ ...article, topicTokens }) };
  }).filter(article => article.topicTokens.length >= 2);
  prepared.sort((a, b) => articleTimeMs(b) - articleTimeMs(a));

  const clusters = [];
  for (const article of prepared) {
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const centroidScore = Math.max(jaccard(article.topicTokens, cluster.topicTokens), overlapCoefficient(article.topicTokens, cluster.topicTokens) * 0.82);
      const centroidShared = article.topicTokens.filter(token => cluster.topicTokens.includes(token)).length;
      const newestClusterTime = Math.max(0, ...cluster.articles.map(articleTimeMs));
      const articleTime = articleTimeMs(article);
      const centroidGapHours = newestClusterTime && articleTime ? Math.abs(newestClusterTime - articleTime) / 3600000 : 0;
      const centroidWithinWindow = centroidGapHours <= maxGapHours;
      let pairwise = { score: 0, titleScore: 0, contextScore: 0, sharedTitle: 0, sharedContext: 0 };
      for (const existing of cluster.articles) {
        const compared = eventSimilarity(article, existing, maxGapHours);
        if (compared.score > pairwise.score) pairwise = compared;
      }
      const centroidMatch = centroidWithinWindow && centroidScore >= threshold && centroidShared >= 2;
      const titlePairMatch = pairwise.score >= threshold && pairwise.sharedTitle >= 2;
      const contextPairMatch = pairwise.contextScore >= threshold && pairwise.sharedTitle >= 1 && pairwise.sharedContext >= 5;
      const score = Math.max(centroidScore, pairwise.score);
      if ((centroidMatch || titlePairMatch || contextPairMatch) && score > bestScore) { best = cluster; bestScore = score; }
    }
    if (!best) {
      best = { articles: [], topicTokens: [...article.topicTokens], canonicalArticle: article, canonicalTitle: article.title };
      clusters.push(best);
    }
    best.articles.push(article);
    recalcCluster(best);
  }
  return clusters.map(recalcCluster);
}

function sourceEvidenceUnits(articles) {
  const perDomain = new Map();
  for (const article of articles || []) {
    const key = article.sourceDomain || article.sourceName || article.sourceKey;
    if (!key || perDomain.has(key)) continue;
    perDomain.set(key, article);
  }
  const signatures = new Set();
  for (const article of perDomain.values()) {
    const signature = normalizeTitle(article.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (signature) signatures.add(signature);
  }
  return signatures.size;
}

function scoreCluster(cluster, now = new Date(), lookbackHours = 6) {
  const uniqueSources = [...new Set(cluster.articles.map(item => item.sourceDomain || item.sourceName).filter(Boolean))];
  const regions = [...new Set(cluster.articles.map(item => item.sourceRegion).filter(region => region && region !== 'Unknown'))];
  const evidenceUnits = sourceEvidenceUnits(cluster.articles);
  const times = cluster.articles
    .map(item => new Date(item.publishedAt || item.seenAt || 0).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const newestMs = times[0] || now.getTime();
  const ageMinutes = Math.max(0, (now.getTime() - newestMs) / 60000);
  const recent60 = times.filter(value => now.getTime() - value <= 60 * 60000).length;
  const recent30 = times.filter(value => now.getTime() - value <= 30 * 60000).length;

  const sourceBreadth = Math.min(100, uniqueSources.length * 11);
  const geography = Math.min(100, regions.length * 24);
  const velocity = Math.min(100, recent30 * 14 + Math.max(0, recent60 - recent30) * 8 + Math.max(0, cluster.articles.length - recent60) * 2);
  const freshness = Math.max(0, 100 - (ageMinutes / Math.max(1, lookbackHours * 60)) * 100);
  const volume = Math.min(100, cluster.articles.length * 5);
  const globalScore = Math.round(sourceBreadth * 0.30 + geography * 0.20 + velocity * 0.25 + freshness * 0.15 + volume * 0.10);
  const confidenceScore = Math.round(
    Math.min(100, evidenceUnits * 20) * 0.50 +
    Math.min(100, uniqueSources.length * 14) * 0.30 +
    Math.min(100, regions.length * 24) * 0.20
  );
  return {
    globalScore,
    confidenceScore,
    sourceBreadthScore: Math.round(sourceBreadth),
    geographyScore: Math.round(geography),
    velocityScore: Math.round(velocity),
    freshnessScore: Math.round(freshness),
    volumeScore: Math.round(volume),
    sourceCount: uniqueSources.length,
    regionCount: regions.length,
    articleCount: cluster.articles.length,
    independentEvidenceUnits: evidenceUnits,
    recent30,
    recent60,
    ageMinutes: Math.round(ageMinutes),
    velocityLevel: velocity >= 75 ? 'rapid' : velocity >= 45 ? 'rising' : 'stable',
    sourceKeys: uniqueSources,
    sourceRegions: regions
  };
}

function materialChange(previous, currentTokens, currentScores) {
  if (!previous) return { changed: true, newTokens: currentTokens, reason: 'new_cluster' };
  let previousTokens = [];
  try { previousTokens = JSON.parse(previous.topic_tokens_json || '[]'); } catch (_error) { previousTokens = []; }
  const before = new Set(previousTokens);
  const added = currentTokens.filter(token => !before.has(token));
  const similarity = jaccard(previousTokens, currentTokens);
  const scoreDelta = Math.abs(Number(previous.global_score || 0) - Number(currentScores.globalScore || 0));
  const articleDelta = Math.max(0, Number(currentScores.articleCount || 0) - Number(previous.article_count || 0));
  const changed = added.length >= 3 && similarity < 0.82 || scoreDelta >= 14 && articleDelta >= 3;
  return {
    changed,
    newTokens: added.slice(0, 12),
    tokenSimilarity: Number(similarity.toFixed(3)),
    scoreDelta,
    articleDelta,
    reason: changed ? (added.length >= 3 ? 'new_material_terms' : 'coverage_acceleration') : 'no_material_change'
  };
}

function editorDecision(cluster, previous = null, options = {}) {
  const scores = cluster.scores || {};
  const minSources = Number(options.minIndependentSources || 3);
  const minConfidence = Number(options.minConfidence || 58);
  const breakingThreshold = Number(options.breakingThreshold || 82);
  const coverThreshold = Number(options.coverThreshold || 66);
  const followUpThreshold = Number(options.followUpThreshold || 58);
  const previousAssigned = previous && ['assigned', 'covered'].includes(previous.status);
  const change = cluster.materialChange || { changed: true, reason: 'new_cluster' };

  let action = 'IGNORE';
  if (scores.globalScore < followUpThreshold && !previousAssigned) {
    action = 'IGNORE';
  } else if (scores.independentEvidenceUnits < minSources || scores.confidenceScore < minConfidence) {
    action = 'WAIT';
  } else if (previousAssigned) {
    if (!change.changed) action = 'IGNORE';
    else if (scores.globalScore >= breakingThreshold) action = 'UPDATE';
    else if (scores.globalScore >= followUpThreshold) action = 'FOLLOW_UP';
    else action = 'WAIT';
  } else if (scores.globalScore >= breakingThreshold && scores.velocityScore >= 65) {
    action = 'BREAKING';
  } else if (scores.globalScore >= coverThreshold) {
    action = 'COVER';
  } else {
    action = 'WAIT';
  }

  const rationale = [
    `Decision ${action}.`,
    `Global repercussion ${scores.globalScore}/100`,
    `${scores.sourceCount} source domain(s)`,
    `${scores.independentEvidenceUnits} independent headline evidence unit(s)`,
    `${scores.regionCount} source region(s)`,
    `coverage-confidence ${scores.confidenceScore}/100`,
    `velocity ${scores.velocityLevel || 'stable'} (${scores.velocityScore}/100).`,
    previousAssigned ? `Existing assignment: yes; material change: ${change.changed ? 'yes' : 'no'} (${change.reason}).` : 'No prior assignment for this cluster.'
  ].join(' ');

  return { action, rationale, scores, materialChange: change };
}

class GlobalNewsRadarServiceV121 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.http = options.http || axios;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.gdeltUrl = options.gdeltUrl || process.env.NEWSROOM_GDELT_URL || 'https://api.gdeltproject.org/api/v2/doc/doc';
    this.lookbackHours = clamp(options.lookbackHours || process.env.NEWSROOM_LOOKBACK_HOURS, 1, 48, 6);
    this.timeoutMs = clamp(options.timeoutMs || process.env.NEWSROOM_HTTP_TIMEOUT_MS, 1500, 30000, 9000);
    this.clusterThreshold = clamp(options.clusterThreshold || process.env.NEWSROOM_CLUSTER_THRESHOLD, 0.20, 0.80, 0.36);
    this.clusterMaxGapHours = clamp(options.clusterMaxGapHours || process.env.NEWSROOM_CLUSTER_MAX_GAP_HOURS, 2, 48, 18);
    this.scanIntervalMinutes = clamp(options.scanIntervalMinutes || process.env.NEWSROOM_SCAN_INTERVAL_MINUTES, 2, 240, 10);
    this.minIndependentSources = clamp(options.minIndependentSources || process.env.NEWSROOM_MIN_INDEPENDENT_SOURCES, 2, 12, 3);
    this.minConfidence = clamp(options.minConfidence || process.env.NEWSROOM_MIN_COVERAGE_CONFIDENCE, 30, 95, 58);
    this.breakingThreshold = clamp(options.breakingThreshold || process.env.NEWSROOM_BREAKING_THRESHOLD, 50, 100, 82);
    this.coverThreshold = clamp(options.coverThreshold || process.env.NEWSROOM_COVER_THRESHOLD, 40, 95, 66);
    this.followUpThreshold = clamp(options.followUpThreshold || process.env.NEWSROOM_FOLLOW_UP_THRESHOLD, 30, 90, 58);
    this.autoPromote = options.autoPromote ?? String(process.env.NEWSROOM_AUTO_PROMOTE || 'true').toLowerCase() !== 'false';
    this.gdeltLanes = options.gdeltLanes || parseJsonEnv('NEWSROOM_GDELT_LANES_JSON', DEFAULT_GDELT_LANES);
    this.rssSources = options.rssSources || parseJsonEnv('NEWSROOM_RSS_SOURCES_JSON', []);
  }

  getConfig() {
    return {
      version: VERSION,
      enabled: String(process.env.NEWSROOM_ENABLED || 'true').toLowerCase() !== 'false',
      scanIntervalMinutes: this.scanIntervalMinutes,
      lookbackHours: this.lookbackHours,
      clusterThreshold: this.clusterThreshold,
      clusterMaxGapHours: this.clusterMaxGapHours,
      minIndependentSources: this.minIndependentSources,
      minCoverageConfidence: this.minConfidence,
      breakingThreshold: this.breakingThreshold,
      coverThreshold: this.coverThreshold,
      followUpThreshold: this.followUpThreshold,
      autoPromote: this.autoPromote,
      gdeltLanes: this.gdeltLanes.map(lane => ({ id: lane.id, query: lane.query, language: lane.language, maxRecords: lane.maxRecords })),
      rssSources: this.rssSources.map(source => ({ id: source.id, name: source.name, url: source.url, country: source.country, region: source.region, language: source.language }))
    };
  }

  async scanIfDue(options = {}) {
    if (String(process.env.NEWSROOM_ENABLED || 'true').toLowerCase() === 'false') return { skipped: true, reason: 'newsroom_disabled' };
    if (!this.db) return this.scanAndDecide(options);
    const latest = await this.db.getRow(`SELECT * FROM global_news_scans WHERE status IN ('completed','partial') ORDER BY completed_at DESC LIMIT 1`);
    if (latest?.completed_at) {
      const ageMinutes = (Date.now() - new Date(latest.completed_at).getTime()) / 60000;
      if (Number.isFinite(ageMinutes) && ageMinutes < this.scanIntervalMinutes) {
        return { skipped: true, reason: 'not_due', nextInMinutes: Math.max(1, Math.ceil(this.scanIntervalMinutes - ageMinutes)), latestScanId: latest.id };
      }
    }
    return this.scanAndDecide(options);
  }

  async fetchGdeltLane(lane = {}) {
    const response = await this.http.get(this.gdeltUrl, {
      timeout: this.timeoutMs,
      headers: { 'User-Agent': 'AgentTube-Newsroom/12.1 (global news discovery; metadata only)', Accept: 'application/json' },
      params: {
        query: lane.query || 'sourcelang:english',
        mode: 'ArtList',
        format: 'json',
        maxrecords: Math.max(10, Math.min(250, Number(lane.maxRecords || 150))),
        timespan: `${this.lookbackHours}h`,
        sort: 'datedesc'
      }
    });
    const list = Array.isArray(response?.data?.articles) ? response.data.articles : [];
    const seenAt = new Date().toISOString();
    return list.map(item => {
      const url = canonicalUrl(item.url || item.url_mobile);
      const title = clean(item.title, 500);
      if (!url || !title) return null;
      const sourceCountry = clean(item.sourcecountry, 100);
      return {
        url,
        title,
        summary: '',
        sourceName: clean(item.domain || domainOf(url), 200),
        sourceDomain: clean(item.domain || domainOf(url), 200).toLowerCase().replace(/^www\./, ''),
        sourceCountry,
        sourceRegion: countryRegion(sourceCountry),
        language: clean(item.language || lane.language, 80),
        publishedAt: parseDate(item.seendate) || seenAt,
        seenAt,
        adapter: 'gdelt',
        laneId: lane.id || 'gdelt',
        metadata: { socialImage: canonicalUrl(item.socialimage), sourceCountry, language: clean(item.language || lane.language, 80) }
      };
    }).filter(Boolean);
  }

  async fetchRssSource(source = {}) {
    const url = canonicalUrl(source.url);
    if (!url) throw new Error(`Invalid RSS URL for source ${source.id || source.name || 'unknown'}`);
    const response = await this.http.get(url, {
      timeout: this.timeoutMs,
      responseType: 'text',
      headers: { 'User-Agent': 'AgentTube-Newsroom/12.1 (RSS discovery; metadata only)', Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9' }
    });
    return parseRss(response.data, source).slice(0, Math.max(10, Math.min(100, Number(source.maxRecords || 50))));
  }

  dedupeArticles(articles) {
    const byUrl = new Map();
    for (const article of articles || []) {
      const url = canonicalUrl(article.url);
      if (!url) continue;
      const key = hash(url);
      const current = byUrl.get(key);
      if (!current || new Date(article.publishedAt || 0) > new Date(current.publishedAt || 0)) byUrl.set(key, { ...article, url });
    }
    return [...byUrl.values()];
  }

  async persistArticle(article, scanId) {
    const id = `news_article_${hash(article.url).slice(0, 24)}`;
    const normalizedTitle = normalizeTitle(article.title);
    if (this.db) {
      await this.db.executeQuery(
        `INSERT INTO global_news_articles (
          id, url_hash, url, title, normalized_title, summary, source_name, source_domain, source_country,
          source_region, language, adapter, lane_id, published_at, first_seen_at, last_seen_at, last_scan_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(url_hash) DO UPDATE SET
          title = excluded.title, normalized_title = excluded.normalized_title, summary = excluded.summary,
          source_name = excluded.source_name, source_domain = excluded.source_domain, source_country = excluded.source_country,
          source_region = excluded.source_region, language = excluded.language, adapter = excluded.adapter,
          lane_id = excluded.lane_id, published_at = COALESCE(excluded.published_at, global_news_articles.published_at),
          last_seen_at = CURRENT_TIMESTAMP, last_scan_id = excluded.last_scan_id, metadata_json = excluded.metadata_json`,
        [id, hash(article.url), article.url, clean(article.title, 500), normalizedTitle, clean(article.summary, 800), clean(article.sourceName, 200), clean(article.sourceDomain, 200), clean(article.sourceCountry, 100), clean(article.sourceRegion, 100), clean(article.language, 80), clean(article.adapter, 40), clean(article.laneId, 80), article.publishedAt || null, scanId, JSON.stringify(article.metadata || {})]
      );
    }
    return { ...article, id, normalizedTitle, topicTokens: tokens(normalizedTitle) };
  }

  async recentClusters() {
    if (!this.db) return [];
    return this.db.getAllRows(`SELECT * FROM global_news_clusters WHERE last_seen_at >= datetime('now', '-48 hours') ORDER BY last_seen_at DESC LIMIT 300`);
  }

  findPreviousCluster(cluster, previousRows) {
    let best = null;
    let bestScore = 0;
    for (const row of previousRows || []) {
      let previousTokens = [];
      try { previousTokens = JSON.parse(row.topic_tokens_json || '[]'); } catch (_error) { previousTokens = []; }
      const score = Math.max(jaccard(cluster.topicTokens, previousTokens), overlapCoefficient(cluster.topicTokens, previousTokens) * 0.82);
      if (score >= 0.44 && score > bestScore) { best = row; bestScore = score; }
    }
    return best;
  }

  async persistCluster(cluster, scanId, previous) {
    const baseKey = [...cluster.topicTokens].sort().slice(0, 10).join('|') || normalizeTitle(cluster.canonicalTitle).toLowerCase();
    const id = previous?.id || `news_cluster_${hash(baseKey).slice(0, 24)}`;
    const now = new Date();
    const scores = scoreCluster(cluster, now, this.lookbackHours);
    const change = materialChange(previous, cluster.topicTokens, scores);
    const materialFingerprint = hash(cluster.topicTokens.join('|')).slice(0, 32);
    const status = previous?.status || 'active';
    const articleIds = cluster.articles.map(item => item.id);
    const newest = [...cluster.articles].sort((a, b) => new Date(b.publishedAt || b.seenAt || 0) - new Date(a.publishedAt || a.seenAt || 0))[0];
    const firstSeen = previous?.first_seen_at || newest?.publishedAt || now.toISOString();
    const lastMaterialChange = change.changed ? now.toISOString() : previous?.last_material_change || firstSeen;
    if (this.db) {
      await this.db.executeQuery(
        `INSERT INTO global_news_clusters (
          id, cluster_key, canonical_title, status, first_seen_at, last_seen_at, last_material_change,
          global_score, confidence_score, velocity_score, freshness_score, geography_score, source_breadth_score,
          volume_score, source_count, region_count, article_count, independent_evidence_units,
          source_keys_json, source_regions_json, article_ids_json, topic_tokens_json, material_fingerprint, last_scan_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          cluster_key = excluded.cluster_key, canonical_title = excluded.canonical_title, last_seen_at = CURRENT_TIMESTAMP,
          last_material_change = excluded.last_material_change, global_score = excluded.global_score,
          confidence_score = excluded.confidence_score, velocity_score = excluded.velocity_score,
          freshness_score = excluded.freshness_score, geography_score = excluded.geography_score,
          source_breadth_score = excluded.source_breadth_score, volume_score = excluded.volume_score,
          source_count = excluded.source_count, region_count = excluded.region_count, article_count = excluded.article_count,
          independent_evidence_units = excluded.independent_evidence_units, source_keys_json = excluded.source_keys_json,
          source_regions_json = excluded.source_regions_json, article_ids_json = excluded.article_ids_json,
          topic_tokens_json = excluded.topic_tokens_json, material_fingerprint = excluded.material_fingerprint,
          last_scan_id = excluded.last_scan_id, updated_at = CURRENT_TIMESTAMP`,
        [id, hash(baseKey).slice(0, 32), clean(cluster.canonicalTitle, 500), status, firstSeen, lastMaterialChange, scores.globalScore, scores.confidenceScore, scores.velocityScore, scores.freshnessScore, scores.geographyScore, scores.sourceBreadthScore, scores.volumeScore, scores.sourceCount, scores.regionCount, scores.articleCount, scores.independentEvidenceUnits, JSON.stringify(scores.sourceKeys), JSON.stringify(scores.sourceRegions), JSON.stringify(articleIds), JSON.stringify(cluster.topicTokens), materialFingerprint, scanId]
      );
    }
    return { ...cluster, id, status, scores, materialChange: change, materialFingerprint, firstSeen, lastMaterialChange };
  }

  async persistDecision(cluster, scanId, previous) {
    const decision = editorDecision(cluster, previous, {
      minIndependentSources: this.minIndependentSources,
      minConfidence: this.minConfidence,
      breakingThreshold: this.breakingThreshold,
      coverThreshold: this.coverThreshold,
      followUpThreshold: this.followUpThreshold
    });
    const fingerprint = hash(`${cluster.id}:${decision.action}:${cluster.materialFingerprint}:${VERSION}`).slice(0, 32);
    const id = `news_decision_${fingerprint.slice(0, 24)}`;
    if (this.db) {
      const existing = await this.db.getRow('SELECT * FROM global_news_editor_decisions WHERE decision_fingerprint = ?', [fingerprint]);
      if (existing) return { ...decision, id: existing.id, fingerprint, promotedIdeaId: existing.promoted_idea_id || null, reused: true };
      await this.db.executeQuery(
        `INSERT INTO global_news_editor_decisions (
          id, cluster_id, scan_id, action, rationale, score_json, evidence_json, material_fingerprint,
          decision_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, cluster.id, scanId, decision.action, decision.rationale, JSON.stringify(decision.scores || {}), JSON.stringify({ sourceUrls: cluster.articles.map(item => item.url), sourceDomains: decision.scores.sourceKeys || [], sourceRegions: decision.scores.sourceRegions || [], materialChange: decision.materialChange }), cluster.materialFingerprint, fingerprint]
      );
    }
    return { ...decision, id, fingerprint, promotedIdeaId: null, reused: false };
  }

  assignmentTopic(cluster, action) {
    const base = clean(cluster.canonicalTitle, 170);
    if (action === 'UPDATE') return `${base} — What Changed`.slice(0, 200);
    if (action === 'FOLLOW_UP') return `${base} — Latest Developments`.slice(0, 200);
    return base.slice(0, 200);
  }

  assignmentAngle(action) {
    if (action === 'BREAKING') return 'Explain what is confirmed so far, what remains uncertain, and why this development is drawing global attention.';
    if (action === 'UPDATE') return 'Focus only on material developments since the previous coverage, clearly separating newly confirmed facts from unresolved claims.';
    if (action === 'FOLLOW_UP') return 'Explain the latest verified developments, what changed, and what audiences should watch next without overstating uncertainty.';
    return 'Explain what happened, the verified timeline, the key actors, and why the development matters internationally.';
  }

  async promoteDecision(decisionId) {
    if (!this.db) throw new Error('Newsroom persistence is required to promote an editorial decision');
    const decision = await this.db.getRow('SELECT * FROM global_news_editor_decisions WHERE id = ?', [decisionId]);
    if (!decision) { const error = new Error('Newsroom decision not found'); error.status = 404; throw error; }
    if (!['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {
      const error = new Error(`Decision ${decision.action} is not promotable`); error.status = 409; error.code = 'NEWSROOM_DECISION_NOT_ACTIONABLE'; throw error;
    }
    if (decision.promoted_idea_id) {
      const existingIdea = await this.db.getRow('SELECT * FROM content_ideas WHERE id = ?', [decision.promoted_idea_id]);
      return { decisionId, idea: existingIdea, reused: true };
    }
    const cluster = await this.getCluster(decision.cluster_id);
    if (!cluster) { const error = new Error('Newsroom cluster not found'); error.status = 404; throw error; }
    const topic = this.assignmentTopic(cluster, decision.action);
    const recent = await this.db.getRow(`SELECT * FROM content_ideas WHERE lower(trim(topic)) = lower(trim(?)) AND created_at >= datetime('now', '-48 hours') ORDER BY created_at DESC LIMIT 1`, [topic]);
    let idea = recent;
    if (!idea) {
      idea = await this.db.createContentIdea({
        topic,
        angle: this.assignmentAngle(decision.action),
        style: 'explainer',
        status: 'backlog',
        rationale: `${decision.rationale} Sources were discovered through the Global News Radar; factual claims still require the Research & Provenance Desk before publication.`
      });
    }
    const assignmentId = `news_assignment_${hash(`${decision.id}:${idea.id}`).slice(0, 24)}`;
    await this.db.executeQuery(
      `INSERT OR IGNORE INTO global_news_assignments (
        id, decision_id, cluster_id, idea_id, assignment_type, topic, angle, format,
        source_urls_json, source_domains_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [assignmentId, decision.id, cluster.id, idea.id, decision.action, topic, this.assignmentAngle(decision.action), 'explainer', JSON.stringify(cluster.articles.map(item => item.url)), JSON.stringify(cluster.sourceKeys || [])]
    );
    await this.db.executeQuery('UPDATE global_news_editor_decisions SET promoted_idea_id = ? WHERE id = ?', [idea.id, decision.id]);
    await this.db.executeQuery("UPDATE global_news_clusters SET status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [cluster.id]);
    return { decisionId, assignmentId, idea, reused: Boolean(recent) };
  }

  async scanAndDecide(options = {}) {
    const scanId = `news_scan_${hash(`${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).slice(0, 24)}`;
    const startedAt = new Date().toISOString();
    const autoPromote = options.autoPromote ?? this.autoPromote;
    if (this.db) {
      await this.db.executeQuery(
        `INSERT INTO global_news_scans (id, status, started_at, config_json) VALUES (?, 'running', ?, ?)`,
        [scanId, startedAt, JSON.stringify(this.getConfig())]
      );
    }

    const sourceResults = [];
    const discovered = [];
    const sources = [
      ...this.gdeltLanes.map(lane => ({ type: 'gdelt', definition: lane })),
      ...this.rssSources.map(source => ({ type: 'rss', definition: source }))
    ];
    for (const source of sources) {
      const start = Date.now();
      try {
        const articles = source.type === 'gdelt'
          ? await this.fetchGdeltLane(source.definition)
          : await this.fetchRssSource(source.definition);
        discovered.push(...articles);
        sourceResults.push({ id: source.definition.id || source.type, type: source.type, ok: true, articleCount: articles.length, durationMs: Date.now() - start });
      } catch (error) {
        sourceResults.push({ id: source.definition.id || source.type, type: source.type, ok: false, articleCount: 0, durationMs: Date.now() - start, error: clean(error.message, 300) });
        this.logger.warn(`Newsroom source ${source.definition.id || source.type} failed: ${error.message}`);
      }
    }

    const uniqueArticles = this.dedupeArticles(discovered);
    const persistedArticles = [];
    for (const article of uniqueArticles) persistedArticles.push(await this.persistArticle(article, scanId));
    const rawClusters = clusterArticles(persistedArticles, this.clusterThreshold, this.clusterMaxGapHours);
    const previousRows = await this.recentClusters();
    const finalClusters = [];
    const decisions = [];
    for (const raw of rawClusters) {
      const previous = this.findPreviousCluster(raw, previousRows);
      const cluster = await this.persistCluster(raw, scanId, previous);
      const decision = await this.persistDecision(cluster, scanId, previous);
      let promotion = null;
      if (autoPromote && ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(decision.action)) {
        try { promotion = await this.promoteDecision(decision.id); }
        catch (error) { this.logger.warn(`Could not promote newsroom decision ${decision.id}: ${error.message}`); }
      }
      finalClusters.push({ ...cluster, decision, promotion });
      decisions.push(decision);
    }
    finalClusters.sort((a, b) => b.scores.globalScore - a.scores.globalScore);

    const failedSources = sourceResults.filter(item => !item.ok);
    const successfulSources = sourceResults.filter(item => item.ok);
    const status = successfulSources.length === 0 ? 'failed' : failedSources.length ? 'partial' : 'completed';
    const actionableCount = decisions.filter(item => ['COVER','BREAKING','UPDATE','FOLLOW_UP'].includes(item.action)).length;
    const multiSourceClusterCount = finalClusters.filter(cluster => Number(cluster.scores?.sourceCount || 0) >= 2).length;
    const corroboratedClusterCount = finalClusters.filter(cluster => Number(cluster.scores?.independentEvidenceUnits || 0) >= this.minIndependentSources).length;
    const compressionRatio = persistedArticles.length ? Number((finalClusters.length / persistedArticles.length).toFixed(3)) : 0;
    const error = successfulSources.length === 0 ? failedSources.map(item => `${item.id}: ${item.error}`).join('; ').slice(0, 1000) : null;
    if (this.db) {
      await this.db.executeQuery(
        `UPDATE global_news_scans SET status = ?, completed_at = CURRENT_TIMESTAMP, source_results_json = ?, article_count = ?, cluster_count = ?, actionable_count = ?, error = ? WHERE id = ?`,
        [status, JSON.stringify(sourceResults), persistedArticles.length, finalClusters.length, actionableCount, error, scanId]
      );
    }
    this.logger.info(`Global News Radar ${scanId}: ${persistedArticles.length} article(s), ${finalClusters.length} cluster(s), ${multiSourceClusterCount} multi-source, ${corroboratedClusterCount} corroborated, ${actionableCount} actionable decision(s), status ${status}.`);
    return {
      id: scanId,
      version: VERSION,
      status,
      startedAt,
      sourceResults,
      articleCount: persistedArticles.length,
      clusterCount: finalClusters.length,
      actionableCount,
      clustering: { multiSourceClusterCount, corroboratedClusterCount, compressionRatio, maxGapHours: this.clusterMaxGapHours },
      topClusters: finalClusters.slice(0, 30).map(cluster => this.serializeCluster(cluster)),
      decisions: decisions.slice(0, 50),
      autoPromote
    };
  }

  serializeCluster(cluster) {
    return {
      id: cluster.id,
      canonicalTitle: cluster.canonicalTitle,
      status: cluster.status,
      scores: cluster.scores,
      materialChange: cluster.materialChange,
      materialFingerprint: cluster.materialFingerprint,
      topicTokens: cluster.topicTokens,
      sourceKeys: cluster.scores?.sourceKeys || cluster.sourceKeys || [],
      sourceRegions: cluster.scores?.sourceRegions || cluster.sourceRegions || [],
      articles: (cluster.articles || []).slice(0, 25).map(article => ({
        id: article.id, title: article.title, url: article.url, sourceName: article.sourceName,
        sourceDomain: article.sourceDomain, sourceCountry: article.sourceCountry, sourceRegion: article.sourceRegion,
        language: article.language, publishedAt: article.publishedAt
      })),
      decision: cluster.decision || null,
      promotion: cluster.promotion || null
    };
  }

  async getCluster(clusterId) {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT * FROM global_news_clusters WHERE id = ?', [clusterId]);
    if (!row) return null;
    let articleIds = [];
    let sourceKeys = [];
    let sourceRegions = [];
    let topicTokens = [];
    try { articleIds = JSON.parse(row.article_ids_json || '[]'); } catch (_error) {}
    try { sourceKeys = JSON.parse(row.source_keys_json || '[]'); } catch (_error) {}
    try { sourceRegions = JSON.parse(row.source_regions_json || '[]'); } catch (_error) {}
    try { topicTokens = JSON.parse(row.topic_tokens_json || '[]'); } catch (_error) {}
    const articles = articleIds.length
      ? await this.db.getAllRows(`SELECT * FROM global_news_articles WHERE id IN (${articleIds.map(() => '?').join(',')}) ORDER BY published_at DESC`, articleIds)
      : [];
    return {
      id: row.id,
      canonicalTitle: row.canonical_title,
      status: row.status,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastMaterialChange: row.last_material_change,
      materialFingerprint: row.material_fingerprint,
      topicTokens,
      sourceKeys,
      sourceRegions,
      scores: {
        globalScore: row.global_score,
        confidenceScore: row.confidence_score,
        velocityScore: row.velocity_score,
        freshnessScore: row.freshness_score,
        geographyScore: row.geography_score,
        sourceBreadthScore: row.source_breadth_score,
        volumeScore: row.volume_score,
        sourceCount: row.source_count,
        regionCount: row.region_count,
        articleCount: row.article_count,
        independentEvidenceUnits: row.independent_evidence_units
      },
      articles: articles.map(article => ({
        id: article.id, title: article.title, url: article.url, sourceName: article.source_name,
        sourceDomain: article.source_domain, sourceCountry: article.source_country, sourceRegion: article.source_region,
        language: article.language, publishedAt: article.published_at
      }))
    };
  }

  async listClusters(limit = 50) {
    if (!this.db) return [];
    const rows = await this.db.getAllRows('SELECT id FROM global_news_clusters ORDER BY global_score DESC, last_seen_at DESC LIMIT ?', [Math.max(1, Math.min(200, Number(limit || 50)))]);
    const result = [];
    for (const row of rows) {
      const cluster = await this.getCluster(row.id);
      if (cluster) result.push(cluster);
    }
    return result;
  }

  async listDecisions(limit = 100, action = null) {
    if (!this.db) return [];
    const params = [];
    let sql = 'SELECT * FROM global_news_editor_decisions';
    if (action && ACTIONS.has(String(action).toUpperCase())) { sql += ' WHERE action = ?'; params.push(String(action).toUpperCase()); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const rows = await this.db.getAllRows(sql, params);
    return rows.map(row => {
      let scores = {}; let evidence = {};
      try { scores = JSON.parse(row.score_json || '{}'); } catch (_error) {}
      try { evidence = JSON.parse(row.evidence_json || '{}'); } catch (_error) {}
      return { id: row.id, clusterId: row.cluster_id, scanId: row.scan_id, action: row.action, rationale: row.rationale, scores, evidence, materialFingerprint: row.material_fingerprint, promotedIdeaId: row.promoted_idea_id || null, createdAt: row.created_at };
    });
  }

  async status() {
    if (!this.db) return { config: this.getConfig(), latestScan: null, clusters: [], decisions: [] };
    const latest = await this.db.getRow('SELECT * FROM global_news_scans ORDER BY started_at DESC LIMIT 1');
    const clusters = await this.listClusters(20);
    const decisions = await this.listDecisions(30);
    return { config: this.getConfig(), latestScan: latest, clusters, decisions };
  }
}

module.exports = {
  VERSION,
  GlobalNewsRadarServiceV121,
  clean,
  canonicalUrl,
  normalizeTitle,
  tokens,
  jaccard,
  overlapCoefficient,
  countryRegion,
  parseRss,
  clusterArticles,
  sourceEvidenceUnits,
  scoreCluster,
  materialChange,
  editorDecision
};
