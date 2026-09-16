'use strict';

const crypto = require('crypto');

const VERSION = '12.2';
const CHANGE_KINDS = new Set(['new_event','observation','material_update','escalation','resolution','correction']);
const EVENT_STATUSES = new Set(['active','dormant','resolved','archived']);
const RELATION_TYPES = new Set(['related_to','follow_up_of']);

const STOPWORDS = new Set([
  'the','and','for','with','from','that','this','into','after','before','over','under','about','amid','new','latest','breaking','live','update','updates','news','report','reports','says','said',
  'uma','um','para','com','dos','das','que','por','como','mais','sobre','apos','após','antes','novo','nova','noticia','notícia','noticias','notícias',
  'una','uno','para','con','los','las','del','que','por','como','mas','más','sobre','tras','antes','nuevo','nueva','noticias',
  'une','un','des','les','dans','avec','pour','sur','apres','après','avant','nouveau','nouvelle','actualites','actualités'
]);

const CONCEPT_ALIASES = Object.freeze({
  announce: ['announce','announces','announced','announcement','anuncia','anunciou','anunciar','anuncio','anúncio','anunció','annonce','annoncée','annoncé','annoncer'],
  launch: ['launch','launches','launched','release','released','lanca','lança','lancou','lançamento','lanzamiento','lanza','lanzó','lance','lancé','lancement'],
  election: ['election','elections','vote','voting','eleicao','eleição','eleicoes','eleições','votacao','votação','eleccion','elección','elecciones','votacion','votación','élection','élections'],
  attack: ['attack','attacks','attacked','strike','strikes','bombing','ataque','ataques','atacou','bombardeio','bombardeamento','bombardeo','attaque','attaques','frappe','frappes','bombardement'],
  earthquake: ['earthquake','quake','terremoto','sismo','seisme','séisme'],
  wildfire: ['wildfire','wildfires','forestfire','incendio','incêndio','incendios','incêndios','feudeforet','incendie'],
  flood: ['flood','floods','flooding','enchente','enchentes','inundacao','inundação','inundaciones','inundacion','inundación','inondation','inondations'],
  resign: ['resign','resigns','resigned','resignation','renuncia','renunciou','demissao','demissão','renunció','dimite','demission','démission','demissionne','démissionne'],
  approve: ['approve','approved','approval','aprova','aprovou','aprovacao','aprovação','aprueba','aprobó','aprobacion','aprobación','approuve','approuvé','approbation'],
  ban: ['ban','bans','banned','prohibit','prohibits','proibiu','proibe','proíbe','proibicao','proibição','prohibe','prohibió','interdit','interdiction'],
  arrest: ['arrest','arrests','arrested','prisao','prisão','preso','detido','arresto','detenido','detiene','arrestation','arrete','arrêté'],
  deal: ['deal','agreement','accord','pact','acordo','pacto','acuerdo','accord','accorde','accordé'],
  ceasefire: ['ceasefire','truce','cessar-fogo','cessarfogo','tregua','trégua','altoelfuego','trêve','cessez-le-feu'],
  rate: ['rate','rates','interest','juros','taxa','tasas','interes','interés','taux','interet','intérêt'],
  market: ['market','markets','stock','stocks','mercado','mercados','bolsa','acciones','marché','marche','bourse'],
  model: ['model','models','modelo','modelos','modele','modèle','modeles','modèles'],
  office: ['office','offices','escritorio','escritório','escritorios','escritórios','oficina','oficinas','bureau','bureaux'],
  funding: ['funding','fundraise','investment','investimento','financiamento','inversion','inversión','financement','investissement'],
  users: ['user','users','usuario','usuário','usuarios','usuários','utilisateur','utilisateurs'],
  death: ['death','deaths','dead','killed','fatalities','morte','mortes','mortos','morto','muertos','muerto','mort','morts','tue','tué','tués'],
  injury: ['injured','injuries','wounded','feridos','ferido','heridos','herido','blesses','blessés'],
  emergency: ['emergency','emergencia','emergência','urgence'],
  contain: ['contained','containment','control','controlled','controlado','contido','contenido','maitrise','maîtrisé','contenu'],
  reopen: ['reopen','reopens','reopened','reabre','reabriu','reapertura','rouvre','reouverture','réouverture'],
  close: ['close','closes','closed','shutdown','fecha','fechou','fechado','cierra','cerrado','ferme','fermé'],
  expand: ['expand','expands','expanded','escalate','escalates','escalated','expande','expandiu','escalada','amplia','ampliado','sintensifie','intensifie'],
  correction: ['correction','corrected','clarifies','clarified','revised','corrige','corrigiu','correcao','correção','esclarece','correccion','corrección','aclara','rectifie','precise','précise'],
  resolve: ['resolved','resolution','ends','ended','concludes','concluded','resolvido','encerra','termina','fim','resuelto','finaliza','resolu','résolu','termine','fin']
});

const ESCALATION_CONCEPTS = new Set(['attack','death','injury','emergency','expand']);
const RESOLUTION_CONCEPTS = new Set(['resolve','ceasefire','contain']);
const CORRECTION_CONCEPTS = new Set(['correction']);

const LOCATION_ALIASES = Object.freeze({
  'Brazil': ['brazil','brasil','bresil','brésil'],
  'United States': ['united states','u.s.','usa','estados unidos','etats-unis','états-unis'],
  'United Kingdom': ['united kingdom','britain','british','reino unido','royaume-uni'],
  'France': ['france','franca','frança'],
  'Germany': ['germany','alemanha','alemania','allemagne'],
  'Spain': ['spain','espanha','espana','españa','espagne'],
  'Portugal': ['portugal'],
  'Italy': ['italy','italia','italie'],
  'Ukraine': ['ukraine','ucrania','ucrânia'],
  'Russia': ['russia','rússia','rusia','russie'],
  'China': ['china','chine'],
  'Japan': ['japan','japao','japão','japon'],
  'India': ['india','índia','inde'],
  'Canada': ['canada','canadá'],
  'Mexico': ['mexico','méxico','mexique'],
  'Argentina': ['argentina','argentine'],
  'Chile': ['chile','chili'],
  'Colombia': ['colombia','colombie'],
  'Venezuela': ['venezuela'],
  'Israel': ['israel','israël'],
  'Gaza': ['gaza'],
  'Iran': ['iran','irã'],
  'Iraq': ['iraq','iraque'],
  'Syria': ['syria','síria','siria','syrie'],
  'Lebanon': ['lebanon','líbano','libano','liban'],
  'Saudi Arabia': ['saudi arabia','arabia saudita','arábia saudita','arabie saoudite'],
  'Turkey': ['turkey','turkiye','türkiye','turquia','turquie'],
  'Egypt': ['egypt','egito','egipto','egypte','égypte'],
  'South Africa': ['south africa','africa do sul','áfrica do sul','sudafrica','sudáfrica','afrique du sud'],
  'Nigeria': ['nigeria','nigéria'],
  'Kenya': ['kenya','quenia','quênia'],
  'Australia': ['australia','austrália','australie'],
  'New Zealand': ['new zealand','nova zelandia','nova zelândia','nueva zelanda','nouvelle-zelande','nouvelle-zélande'],
  'South Korea': ['south korea','korea do sul','coreia do sul','corea del sur','coree du sud','corée du sud'],
  'North Korea': ['north korea','coreia do norte','corea del norte','coree du nord','corée du nord'],
  'Taiwan': ['taiwan','taiwán'],
  'Indonesia': ['indonesia','indonésia','indonesie','indonésie'],
  'Philippines': ['philippines','filipinas'],
  'Vietnam': ['vietnam','vietna','vietnã'],
  'Thailand': ['thailand','tailandia','tailândia','thailande','thaïlande'],
  'European Union': ['european union','uniao europeia','união europeia','union europea','union europeenne','union européenne']
});

function clean(value, limit = 1000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%$€£\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniq(values, limit = 100) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = clean(value, 300);
    const key = normalize(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function setOverlap(left, right) {
  const a = new Set((left || []).map(normalize).filter(Boolean));
  const b = new Set((right || []).map(normalize).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function jaccard(left, right) {
  const a = new Set((left || []).map(normalize).filter(Boolean));
  const b = new Set((right || []).map(normalize).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function titleTokens(value) {
  return uniq(normalize(value).split(/\s+/).filter(token => token.length >= 3 && !STOPWORDS.has(token)), 80);
}

function canonicalConcepts(value) {
  const text = ` ${normalize(value)} `;
  const tokens = new Set(titleTokens(value));
  const concepts = new Set();
  for (const [concept, aliases] of Object.entries(CONCEPT_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalize(alias);
      if (!normalizedAlias) continue;
      if (normalizedAlias.includes(' ')) {
        if (text.includes(` ${normalizedAlias} `)) { concepts.add(concept); break; }
      } else if (tokens.has(normalizedAlias)) { concepts.add(concept); break; }
    }
  }
  return [...concepts].sort();
}

function extractNumbers(value) {
  const matches = String(value || '').match(/\b\d+(?:[.,]\d+)?\s?(?:%|million|billion|milhao|milhão|milhoes|milhões|millon|millón|millones|million|millions|milliard|milliards)?\b/gi) || [];
  return uniq(matches.map(item => normalize(item)), 30);
}

function extractLocations(value) {
  const text = ` ${normalize(value)} `;
  const found = [];
  for (const [canonical, aliases] of Object.entries(LOCATION_ALIASES)) {
    if (aliases.some(alias => text.includes(` ${normalize(alias).trim()} `))) found.push(canonical);
  }
  return uniq(found, 30);
}

function extractEntities(value) {
  const raw = clean(value, 2000);
  const entities = [];
  const acronymMatches = raw.match(/\b[A-Z][A-Z0-9&.-]{1,12}\b/g) || [];
  entities.push(...acronymMatches);
  const nameMatches = raw.match(/\b(?:[A-ZÀ-Ý][\p{L}0-9&.'-]{1,30})(?:\s+(?:[A-ZÀ-Ý][\p{L}0-9&.'-]{1,30})){0,3}\b/gu) || [];
  for (const candidate of nameMatches) {
    const key = normalize(candidate);
    if (!key || STOPWORDS.has(key) || Object.values(LOCATION_ALIASES).some(list => list.some(alias => normalize(alias) === key))) continue;
    if (/^(Breaking|Latest|Live|Update|News)$/i.test(candidate)) continue;
    entities.push(candidate);
  }
  return uniq(entities, 40);
}

function articleLanguageVariants(cluster) {
  const grouped = new Map();
  for (const article of cluster?.articles || []) {
    const language = clean(article.language || 'Unknown', 80) || 'Unknown';
    const list = grouped.get(language) || [];
    if (article.title) list.push(clean(article.title, 500));
    grouped.set(language, list);
  }
  return [...grouped.entries()].map(([language, titles]) => ({ language, titles: uniq(titles, 10) })).slice(0, 20);
}

function buildDescriptor(cluster) {
  const titles = uniq([cluster?.canonicalTitle, ...(cluster?.articles || []).map(item => item.title)], 80);
  const corpus = titles.join(' | ');
  const entities = uniq(titles.flatMap(extractEntities), 60);
  const locations = uniq(titles.flatMap(extractLocations), 40);
  const concepts = uniq(titles.flatMap(canonicalConcepts), 60);
  const numbers = uniq(titles.flatMap(extractNumbers), 40);
  const titleTokenSet = uniq(titles.flatMap(titleTokens), 120);
  const languages = uniq((cluster?.articles || []).map(item => item.language || 'Unknown'), 30);
  const sourceDomains = uniq((cluster?.articles || []).map(item => item.sourceDomain || item.source_domain).filter(Boolean), 100);
  const articleIds = uniq((cluster?.articles || []).map(item => item.id).filter(Boolean), 200);
  const fingerprint = hash(JSON.stringify({ entities: entities.map(normalize).sort(), locations: locations.map(normalize).sort(), concepts: concepts.map(normalize).sort(), numbers: numbers.map(normalize).sort(), titleTokenSet: titleTokenSet.map(normalize).sort() })).slice(0, 32);
  return {
    canonicalTitle: clean(cluster?.canonicalTitle || titles[0] || 'Untitled event', 500),
    titles,
    languageVariants: articleLanguageVariants(cluster),
    languages,
    entities,
    locations,
    concepts,
    numbers,
    titleTokens: titleTokenSet,
    sourceDomains,
    articleIds,
    clusterId: cluster?.id || null,
    firstSeenAt: cluster?.firstSeen || cluster?.firstSeenAt || null,
    lastSeenAt: cluster?.lastSeenAt || new Date().toISOString(),
    fingerprint,
    corpus: clean(corpus, 5000)
  };
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function signatureFromRow(row) {
  if (!row) return null;
  const signature = parseJson(row.signature_json, {});
  return {
    canonicalTitle: row.canonical_title,
    entities: parseJson(row.entities_json, signature.entities || []),
    locations: parseJson(row.locations_json, signature.locations || []),
    concepts: parseJson(row.concepts_json, signature.concepts || []),
    numbers: parseJson(row.numbers_json, signature.numbers || []),
    titleTokens: signature.titleTokens || [],
    languages: parseJson(row.languages_json, []),
    titleVariants: parseJson(row.title_variants_json, []),
    fingerprint: row.descriptor_fingerprint || signature.fingerprint || ''
  };
}

function matchDescriptors(left, right) {
  const entity = setOverlap(left.entities, right.entities);
  const location = setOverlap(left.locations, right.locations);
  const concept = setOverlap(left.concepts, right.concepts);
  const title = jaccard(left.titleTokens, right.titleTokens);
  const numeric = setOverlap(left.numbers, right.numbers);
  let score = entity * 0.34 + location * 0.24 + concept * 0.24 + title * 0.14 + numeric * 0.04;
  if (!left.entities?.length || !right.entities?.length) score += Math.min(0.10, location * 0.05 + concept * 0.05);
  if (entity >= 0.5 && location >= 0.5 && concept >= 0.5) score += 0.08;
  score = Math.max(0, Math.min(1, score));
  return {
    score: Number(score.toFixed(4)),
    entity: Number(entity.toFixed(4)),
    location: Number(location.toFixed(4)),
    concept: Number(concept.toFixed(4)),
    title: Number(title.toFixed(4)),
    numeric: Number(numeric.toFixed(4))
  };
}

function mergeDescriptor(previous, current) {
  return {
    canonicalTitle: current.canonicalTitle || previous.canonicalTitle,
    entities: uniq([...(previous.entities || []), ...(current.entities || [])], 80),
    locations: uniq([...(previous.locations || []), ...(current.locations || [])], 50),
    concepts: uniq([...(previous.concepts || []), ...(current.concepts || [])], 80),
    numbers: uniq([...(previous.numbers || []), ...(current.numbers || [])], 60),
    titleTokens: uniq([...(previous.titleTokens || []), ...(current.titleTokens || [])], 160),
    languages: uniq([...(previous.languages || []), ...(current.languages || [])], 40),
    titleVariants: uniq([...(previous.titleVariants || []), ...(current.titles || [])], 80),
    languageVariants: current.languageVariants || [],
    fingerprint: current.fingerprint
  };
}

function classifyEvolution(previous, current) {
  if (!previous) return { kind: 'new_event', changed: true, score: 100, reason: 'new_event_identity' };
  const previousEntities = new Set((previous.entities || []).map(normalize));
  const previousLocations = new Set((previous.locations || []).map(normalize));
  const previousConcepts = new Set((previous.concepts || []).map(normalize));
  const previousNumbers = new Set((previous.numbers || []).map(normalize));
  const newEntities = current.entities.filter(item => !previousEntities.has(normalize(item)));
  const newLocations = current.locations.filter(item => !previousLocations.has(normalize(item)));
  const newConcepts = current.concepts.filter(item => !previousConcepts.has(normalize(item)));
  const newNumbers = current.numbers.filter(item => !previousNumbers.has(normalize(item)));
  const correction = current.concepts.some(item => CORRECTION_CONCEPTS.has(item));
  const resolution = current.concepts.some(item => RESOLUTION_CONCEPTS.has(item)) && !previous.concepts?.some(item => RESOLUTION_CONCEPTS.has(item));
  const escalation = current.concepts.some(item => ESCALATION_CONCEPTS.has(item)) && !previous.concepts?.some(item => ESCALATION_CONCEPTS.has(item));
  const similarity = matchDescriptors(previous, current);
  let kind = 'observation';
  if (correction) kind = 'correction';
  else if (resolution) kind = 'resolution';
  else if (escalation) kind = 'escalation';
  else if (newEntities.length || newLocations.length || newConcepts.length || newNumbers.length) kind = 'material_update';
  const score = Math.min(100, (newEntities.length * 22) + (newLocations.length * 25) + (newConcepts.length * 15) + (newNumbers.length * 12) + (kind === 'escalation' ? 25 : 0) + (kind === 'resolution' ? 30 : 0) + (kind === 'correction' ? 35 : 0));
  return {
    kind,
    changed: kind !== 'observation',
    score,
    reason: `event_${kind}`,
    newEntities: newEntities.slice(0, 20),
    newLocations: newLocations.slice(0, 20),
    newConcepts: newConcepts.slice(0, 20),
    newNumbers: newNumbers.slice(0, 20),
    similarity
  };
}

function eventSnapshot(rowOrObject) {
  const row = rowOrObject || {};
  const sig = row.signature_json ? signatureFromRow(row) : row;
  return {
    id: row.id || null,
    canonicalTitle: row.canonical_title || row.canonicalTitle || sig?.canonicalTitle || '',
    status: row.status || 'active',
    revisionNumber: Number(row.revision_number || row.revisionNumber || 0),
    firstSeenAt: row.first_seen_at || row.firstSeenAt || null,
    lastSeenAt: row.last_seen_at || row.lastSeenAt || null,
    lastMaterialChange: row.last_material_change || row.lastMaterialChange || null,
    entities: sig?.entities || [],
    locations: sig?.locations || [],
    concepts: sig?.concepts || [],
    numbers: sig?.numbers || [],
    titleTokens: sig?.titleTokens || [],
    languages: sig?.languages || [],
    titleVariants: sig?.titleVariants || [],
    descriptorFingerprint: row.descriptor_fingerprint || row.descriptorFingerprint || sig?.fingerprint || '',
    primaryClusterId: row.primary_cluster_id || row.primaryClusterId || null,
    latestClusterId: row.latest_cluster_id || row.latestClusterId || null,
    sourceCount: Number(row.source_count || row.sourceCount || 0),
    articleCount: Number(row.article_count || row.articleCount || 0),
    observationCount: Number(row.observation_count || row.observationCount || 0),
    confidenceScore: Number(row.confidence_score || row.confidenceScore || 0),
    evolutionScore: Number(row.evolution_score || row.evolutionScore || 0)
  };
}

class EventIntelligenceEngineV122 {
  constructor(db, options = {}) {
    this.db = db || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.matchThreshold = Math.max(0.45, Math.min(0.9, Number(options.matchThreshold || process.env.NEWSROOM_EVENT_MATCH_THRESHOLD || 0.62)));
    this.ambiguityMargin = Math.max(0.02, Math.min(0.25, Number(options.ambiguityMargin || process.env.NEWSROOM_EVENT_AMBIGUITY_MARGIN || 0.08)));
    this.recentDays = Math.max(1, Math.min(45, Number(options.recentDays || process.env.NEWSROOM_EVENT_RECENT_DAYS || 14)));
    this.relationThreshold = Math.max(0.25, Math.min(0.85, Number(options.relationThreshold || process.env.NEWSROOM_EVENT_RELATION_THRESHOLD || 0.44)));
  }

  getConfig() {
    return { version: VERSION, enabled: String(process.env.NEWSROOM_EVENT_INTELLIGENCE_ENABLED || 'true').toLowerCase() !== 'false', matchThreshold: this.matchThreshold, ambiguityMargin: this.ambiguityMargin, recentDays: this.recentDays, relationThreshold: this.relationThreshold };
  }

  async recentEvents(limit = 500) {
    if (!this.db) return [];
    return this.db.getAllRows(`SELECT * FROM global_news_events WHERE status != 'archived' AND last_seen_at >= datetime('now', ?) ORDER BY last_seen_at DESC LIMIT ?`, [`-${this.recentDays} days`, Math.max(1, Math.min(1000, Number(limit || 500)))]);
  }

  async findMatch(descriptor) {
    const rows = await this.recentEvents();
    const scored = rows.map(row => ({ row, match: matchDescriptors(signatureFromRow(row), descriptor) })).sort((a, b) => b.match.score - a.match.score);
    const best = scored[0] || null;
    const second = scored[1] || null;
    if (!best || best.match.score < this.matchThreshold) return { event: null, match: best?.match || null, ambiguous: false, candidates: scored.slice(0, 3) };
    const ambiguous = Boolean(second && second.match.score >= this.matchThreshold && (best.match.score - second.match.score) < this.ambiguityMargin);
    if (ambiguous) return { event: null, match: best.match, ambiguous: true, candidates: scored.slice(0, 3) };
    return { event: best.row, match: best.match, ambiguous: false, candidates: scored.slice(0, 3) };
  }

  async previousAssigned(eventId) {
    if (!this.db || !eventId) return false;
    const row = await this.db.getRow('SELECT id FROM global_news_event_assignments WHERE event_id = ? LIMIT 1', [eventId]);
    return Boolean(row);
  }

  async linkCluster(eventId, clusterId, matchScore, reasons, scanId) {
    return this.db.executeQuery(
      `INSERT INTO global_news_event_cluster_links (event_id, cluster_id, match_score, match_reasons_json, first_scan_id, last_scan_id, first_linked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(cluster_id) DO UPDATE SET event_id = excluded.event_id, match_score = excluded.match_score, match_reasons_json = excluded.match_reasons_json, last_scan_id = excluded.last_scan_id, last_seen_at = CURRENT_TIMESTAMP`,
      [eventId, clusterId, Number(matchScore || 0), JSON.stringify(reasons || {}), scanId || null, scanId || null]
    );
  }

  async createEvent(descriptor, cluster, scanId, matchMeta = {}) {
    const id = `news_event_${hash(`${cluster.id}:${descriptor.fingerprint}:${scanId || ''}`).slice(0, 24)}`;
    const now = new Date().toISOString();
    const merged = mergeDescriptor({}, descriptor);
    const confidence = Math.max(1, Math.min(100, Math.round(Number(cluster?.scores?.confidenceScore || 50))));
    const sourceCount = Number(cluster?.scores?.sourceCount || descriptor.sourceDomains.length || 0);
    const articleCount = Number(cluster?.scores?.articleCount || descriptor.articleIds.length || 0);
    const signature = { entities: merged.entities, locations: merged.locations, concepts: merged.concepts, numbers: merged.numbers, titleTokens: merged.titleTokens, fingerprint: descriptor.fingerprint };
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      await this.db.executeQuery(
        `INSERT INTO global_news_events (id, canonical_title, status, first_seen_at, last_seen_at, last_material_change, revision_number, signature_json, entities_json, locations_json, concepts_json, numbers_json, languages_json, title_variants_json, descriptor_fingerprint, primary_cluster_id, latest_cluster_id, source_count, article_count, observation_count, confidence_score, evolution_score, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, descriptor.canonicalTitle, descriptor.firstSeenAt || now, descriptor.lastSeenAt || now, now, JSON.stringify(signature), JSON.stringify(merged.entities), JSON.stringify(merged.locations), JSON.stringify(merged.concepts), JSON.stringify(merged.numbers), JSON.stringify(merged.languages), JSON.stringify(merged.titleVariants), descriptor.fingerprint, cluster.id, cluster.id, sourceCount, articleCount, confidence]
      );
      const after = { id, canonicalTitle: descriptor.canonicalTitle, status: 'active', revisionNumber: 1, firstSeenAt: descriptor.firstSeenAt || now, lastSeenAt: descriptor.lastSeenAt || now, lastMaterialChange: now, ...merged, descriptorFingerprint: descriptor.fingerprint, primaryClusterId: cluster.id, latestClusterId: cluster.id, sourceCount, articleCount, observationCount: 1, confidenceScore: confidence, evolutionScore: 100 };
      const revisionId = `news_event_revision_${hash(`${id}:1:${descriptor.fingerprint}`).slice(0, 24)}`;
      await this.db.executeQuery(
        `INSERT INTO global_news_event_revisions (id, event_id, revision_number, change_kind, cluster_id, scan_id, before_json, after_json, delta_json, descriptor_fingerprint, created_at) VALUES (?, ?, 1, 'new_event', ?, ?, '{}', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [revisionId, id, cluster.id, scanId || null, JSON.stringify(after), JSON.stringify({ kind: 'new_event', reason: matchMeta.ambiguous ? 'ambiguous_match_created_new_event' : 'new_event_identity' }), descriptor.fingerprint]
      );
      await this.linkCluster(id, cluster.id, matchMeta.match?.score || 1, matchMeta.match || { score: 1 }, scanId);
      await this.db.executeQuery('COMMIT');
      return { ...after, changeClassification: { kind: 'new_event', changed: true, score: 100, reason: 'new_event_identity' }, match: matchMeta.match || { score: 1 }, ambiguousMatch: Boolean(matchMeta.ambiguous) };
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
  }

  async updateEvent(row, descriptor, cluster, scanId, match) {
    const previous = { ...signatureFromRow(row), ...eventSnapshot(row) };
    const evolution = classifyEvolution(previous, descriptor);
    const merged = mergeDescriptor(previous, descriptor);
    const nextRevision = Number(row.revision_number || 0) + 1;
    const now = new Date().toISOString();
    const status = evolution.kind === 'resolution' ? 'resolved' : row.status === 'resolved' && evolution.changed && !['resolution','correction'].includes(evolution.kind) ? 'active' : row.status;
    const sourceCount = Math.max(Number(row.source_count || 0), Number(cluster?.scores?.sourceCount || descriptor.sourceDomains.length || 0));
    const articleCount = Math.max(Number(row.article_count || 0), Number(cluster?.scores?.articleCount || descriptor.articleIds.length || 0));
    const confidence = Math.max(Number(row.confidence_score || 0), Math.min(100, Math.round(Number(cluster?.scores?.confidenceScore || 0))));
    const lastMaterialChange = evolution.changed ? now : row.last_material_change || row.first_seen_at || now;
    const signature = { entities: merged.entities, locations: merged.locations, concepts: merged.concepts, numbers: merged.numbers, titleTokens: merged.titleTokens, fingerprint: descriptor.fingerprint };
    const after = {
      id: row.id, canonicalTitle: descriptor.canonicalTitle || row.canonical_title, status, revisionNumber: nextRevision,
      firstSeenAt: row.first_seen_at, lastSeenAt: descriptor.lastSeenAt || now, lastMaterialChange,
      ...merged, descriptorFingerprint: descriptor.fingerprint, primaryClusterId: row.primary_cluster_id,
      latestClusterId: cluster.id, sourceCount, articleCount, observationCount: Number(row.observation_count || 0) + 1,
      confidenceScore: confidence, evolutionScore: evolution.score
    };
    await this.db.executeQuery('BEGIN IMMEDIATE');
    try {
      await this.db.executeQuery(
        `UPDATE global_news_events SET canonical_title = ?, status = ?, last_seen_at = ?, last_material_change = ?, revision_number = ?, signature_json = ?, entities_json = ?, locations_json = ?, concepts_json = ?, numbers_json = ?, languages_json = ?, title_variants_json = ?, descriptor_fingerprint = ?, latest_cluster_id = ?, source_count = ?, article_count = ?, observation_count = observation_count + 1, confidence_score = ?, evolution_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision_number = ?`,
        [after.canonicalTitle, status, after.lastSeenAt, lastMaterialChange, nextRevision, JSON.stringify(signature), JSON.stringify(merged.entities), JSON.stringify(merged.locations), JSON.stringify(merged.concepts), JSON.stringify(merged.numbers), JSON.stringify(merged.languages), JSON.stringify(merged.titleVariants), descriptor.fingerprint, cluster.id, sourceCount, articleCount, confidence, evolution.score, row.id, Number(row.revision_number || 0)]
      );
      const current = await this.db.getRow('SELECT revision_number FROM global_news_events WHERE id = ?', [row.id]);
      if (!current || Number(current.revision_number) !== nextRevision) throw Object.assign(new Error('event_revision_conflict'), { code: 'event_revision_conflict' });
      const revisionId = `news_event_revision_${hash(`${row.id}:${nextRevision}:${descriptor.fingerprint}`).slice(0, 24)}`;
      await this.db.executeQuery(
        `INSERT INTO global_news_event_revisions (id, event_id, revision_number, change_kind, cluster_id, scan_id, before_json, after_json, delta_json, descriptor_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [revisionId, row.id, nextRevision, evolution.kind, cluster.id, scanId || null, JSON.stringify(eventSnapshot(row)), JSON.stringify(after), JSON.stringify(evolution), descriptor.fingerprint]
      );
      await this.linkCluster(row.id, cluster.id, match?.score || 0, match || {}, scanId);
      await this.db.executeQuery('COMMIT');
    } catch (error) {
      await this.db.executeQuery('ROLLBACK');
      throw error;
    }
    return { ...after, changeClassification: evolution, match };
  }

  async inferRelations(event) {
    if (!this.db || !event?.id) return [];
    const others = await this.db.getAllRows(`SELECT * FROM global_news_events WHERE id != ? AND status != 'archived' AND last_seen_at >= datetime('now', ?) ORDER BY last_seen_at DESC LIMIT 250`, [event.id, `-${this.recentDays} days`]);
    const created = [];
    for (const row of others) {
      const other = { ...signatureFromRow(row), ...eventSnapshot(row) };
      const match = matchDescriptors(event, other);
      if (match.score < this.relationThreshold || match.score >= this.matchThreshold) continue;
      const eventTime = new Date(event.firstSeenAt || 0).getTime();
      const otherTime = new Date(other.firstSeenAt || 0).getTime();
      const later = Number.isFinite(eventTime) && Number.isFinite(otherTime) && eventTime > otherTime;
      const relationType = later && (match.entity >= 0.5 || match.location >= 0.5) && match.concept >= 0.25 ? 'follow_up_of' : 'related_to';
      const sourceId = relationType === 'follow_up_of' ? event.id : [event.id, other.id].sort()[0];
      const targetId = relationType === 'follow_up_of' ? other.id : [event.id, other.id].sort()[1];
      const relationId = `news_event_relation_${hash(`${sourceId}:${targetId}:${relationType}`).slice(0, 24)}`;
      await this.db.executeQuery(
        `INSERT OR IGNORE INTO global_news_event_relations (id, source_event_id, target_event_id, relation_type, confidence, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [relationId, sourceId, targetId, relationType, Math.round(match.score * 100), JSON.stringify(match)]
      );
      created.push({ id: relationId, sourceEventId: sourceId, targetEventId: targetId, relationType, confidence: Math.round(match.score * 100), evidence: match });
      if (created.length >= 20) break;
    }
    return created;
  }

  async analyzeCluster(cluster, context = {}) {
    if (String(process.env.NEWSROOM_EVENT_INTELLIGENCE_ENABLED || 'true').toLowerCase() === 'false') return null;
    if (!this.db || !cluster?.id) return null;
    const existingLink = await this.db.getRow('SELECT * FROM global_news_event_cluster_links WHERE cluster_id = ?', [cluster.id]);
    if (existingLink) {
      const event = await this.getEvent(existingLink.event_id);
      return event ? { ...event, previousAssigned: await this.previousAssigned(event.id), reusedClusterLink: true } : null;
    }
    const descriptor = buildDescriptor(cluster);
    const resolved = await this.findMatch(descriptor);
    const event = resolved.event
      ? await this.updateEvent(resolved.event, descriptor, cluster, context.scanId || null, resolved.match)
      : await this.createEvent(descriptor, cluster, context.scanId || null, resolved);
    const relations = await this.inferRelations(event);
    const previousAssigned = await this.previousAssigned(event.id);
    return {
      ...event,
      previousAssigned,
      relations,
      descriptor: { entities: descriptor.entities, locations: descriptor.locations, concepts: descriptor.concepts, numbers: descriptor.numbers, languages: descriptor.languages, languageVariants: descriptor.languageVariants },
      materialChange: {
        changed: Boolean(event.changeClassification?.changed),
        reason: event.changeClassification?.reason || 'event_observation',
        eventId: event.id,
        changeKind: event.changeClassification?.kind || 'observation',
        evolutionScore: event.changeClassification?.score || 0,
        ...(event.changeClassification || {})
      }
    };
  }

  async recordAssignment(eventId, decisionId, assignment = {}) {
    if (!this.db || !eventId || !decisionId) return null;
    const id = `news_event_assignment_${hash(`${eventId}:${decisionId}`).slice(0, 24)}`;
    await this.db.executeQuery(
      `INSERT OR IGNORE INTO global_news_event_assignments (id, event_id, decision_id, assignment_id, idea_id, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, eventId, decisionId, assignment.assignmentId || null, assignment.idea?.id || assignment.ideaId || null]
    );
    return { id, eventId, decisionId, assignmentId: assignment.assignmentId || null, ideaId: assignment.idea?.id || assignment.ideaId || null };
  }

  async getEventForCluster(clusterId) {
    if (!this.db) return null;
    const link = await this.db.getRow('SELECT * FROM global_news_event_cluster_links WHERE cluster_id = ?', [clusterId]);
    return link ? this.getEvent(link.event_id) : null;
  }

  async getEvent(eventId) {
    if (!this.db) return null;
    const row = await this.db.getRow('SELECT * FROM global_news_events WHERE id = ?', [eventId]);
    if (!row) return null;
    const snapshot = eventSnapshot(row);
    const links = await this.db.getAllRows('SELECT * FROM global_news_event_cluster_links WHERE event_id = ? ORDER BY last_seen_at DESC', [eventId]);
    const relations = await this.listRelations(eventId);
    const assignments = await this.db.getAllRows('SELECT * FROM global_news_event_assignments WHERE event_id = ? ORDER BY created_at DESC', [eventId]);
    return { ...snapshot, links: links.map(link => ({ clusterId: link.cluster_id, matchScore: link.match_score, matchReasons: parseJson(link.match_reasons_json, {}), firstLinkedAt: link.first_linked_at, lastSeenAt: link.last_seen_at })), relations, assignments };
  }

  async listEvents(limit = 50, status = null) {
    if (!this.db) return [];
    const params = [];
    let sql = 'SELECT * FROM global_news_events';
    if (status && EVENT_STATUSES.has(status)) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY last_material_change DESC, last_seen_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(500, Number(limit || 50))));
    const rows = await this.db.getAllRows(sql, params);
    return rows.map(eventSnapshot);
  }

  async listTimeline(eventId, limit = 100) {
    if (!this.db) return [];
    const rows = await this.db.getAllRows('SELECT * FROM global_news_event_revisions WHERE event_id = ? ORDER BY revision_number DESC LIMIT ?', [eventId, Math.max(1, Math.min(500, Number(limit || 100)))]);
    return rows.map(row => ({ id: row.id, eventId: row.event_id, revisionNumber: row.revision_number, changeKind: row.change_kind, clusterId: row.cluster_id, scanId: row.scan_id, before: parseJson(row.before_json, {}), after: parseJson(row.after_json, {}), delta: parseJson(row.delta_json, {}), descriptorFingerprint: row.descriptor_fingerprint, createdAt: row.created_at }));
  }

  async listRelations(eventId) {
    if (!this.db) return [];
    const rows = await this.db.getAllRows('SELECT * FROM global_news_event_relations WHERE source_event_id = ? OR target_event_id = ? ORDER BY confidence DESC, created_at DESC', [eventId, eventId]);
    return rows.map(row => ({ id: row.id, sourceEventId: row.source_event_id, targetEventId: row.target_event_id, relationType: row.relation_type, confidence: row.confidence, evidence: parseJson(row.evidence_json, {}), createdAt: row.created_at }));
  }

  async validateEvent(eventId) {
    if (!this.db) return { valid: false, blockers: ['event_persistence_unavailable'] };
    const row = await this.db.getRow('SELECT * FROM global_news_events WHERE id = ?', [eventId]);
    if (!row) return { valid: false, blockers: ['event_not_found'] };
    const blockers = [];
    const revisions = await this.db.getAllRows('SELECT * FROM global_news_event_revisions WHERE event_id = ? ORDER BY revision_number ASC', [eventId]);
    if (!revisions.length) blockers.push('event_revision_history_missing');
    for (let i = 0; i < revisions.length; i++) {
      if (Number(revisions[i].revision_number) !== i + 1) blockers.push('event_revision_sequence_gap');
      if (!CHANGE_KINDS.has(revisions[i].change_kind)) blockers.push('event_revision_change_kind_invalid');
    }
    const latest = revisions[revisions.length - 1];
    if (latest) {
      const expected = parseJson(latest.after_json, {});
      const current = eventSnapshot(row);
      const keys = ['id','canonicalTitle','status','revisionNumber','firstSeenAt','lastSeenAt','lastMaterialChange','entities','locations','concepts','numbers','titleTokens','languages','titleVariants','descriptorFingerprint','primaryClusterId','latestClusterId','sourceCount','articleCount','observationCount','confidenceScore','evolutionScore'];
      if (keys.some(key => JSON.stringify(expected[key]) !== JSON.stringify(current[key]))) blockers.push('event_current_state_drift');
    }
    const links = await this.db.getAllRows('SELECT * FROM global_news_event_cluster_links WHERE event_id = ?', [eventId]);
    if (!links.length) blockers.push('event_cluster_link_missing');
    const duplicateLinks = await this.db.getAllRows('SELECT cluster_id, COUNT(*) AS c FROM global_news_event_cluster_links WHERE event_id = ? GROUP BY cluster_id HAVING COUNT(*) > 1', [eventId]);
    if (duplicateLinks.length) blockers.push('event_duplicate_cluster_link');
    return { valid: blockers.length === 0, eventId, blockers: [...new Set(blockers)], revisionCount: revisions.length, clusterLinkCount: links.length };
  }
}

module.exports = {
  VERSION,
  EventIntelligenceEngineV122,
  normalize,
  titleTokens,
  canonicalConcepts,
  extractNumbers,
  extractLocations,
  extractEntities,
  buildDescriptor,
  matchDescriptors,
  classifyEvolution,
  eventSnapshot,
  RELATION_TYPES,
  CHANGE_KINDS
};
