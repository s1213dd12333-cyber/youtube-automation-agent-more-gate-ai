'use strict';

const crypto = require('crypto');
const { CanonicalTimelineServiceV12 } = require('./canonical-timeline-v12');
const { EpisodeMemoryServiceV12 } = require('./episode-memory-v12');
const { CharacterArcMemoryServiceV12 } = require('./character-arc-memory-v12');
const { RelationshipStateGraphServiceV12 } = require('./relationship-state-graph-v12');
const { PlotThreadRegistryServiceV12 } = require('./plot-thread-registry-v12');

const VERSION = '11.12.7';
const TYPE_ORDER = new Map([
  ['plot_thread', 0],
  ['character_arc', 1],
  ['relationship', 2],
  ['timeline_event', 3],
  ['episode_memory', 4]
]);
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'what', 'when', 'where', 'who', 'why', 'how', 'uma', 'uns', 'das', 'dos', 'para', 'com', 'que', 'por', 'como', 'onde', 'quando', 'qual', 'quais', 'sobre']);

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slug(value) {
  return clean(value, 240).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200);
}

function normalizeRelationshipEdge(value) {
  const raw = clean(value, 420);
  const parts = raw.split('->');
  if (parts.length !== 2) return '';
  const source = slug(parts[0]);
  const target = slug(parts[1]);
  if (!source || !target || source === target) return '';
  return `${source}->${target}`;
}

function uniqueStrings(values = [], limit = 120, itemLimit = 2200) {
  const source = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  for (const value of source.slice(0, limit * 3)) {
    const text = clean(value, itemLimit);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function bounded(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function tokens(value) {
  const normalized = clean(value, 6000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ' ');
  return uniqueStrings(normalized.split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !STOP_WORDS.has(word)), 80, 80);
}

function pickFocusSource(input = {}) {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const candidates = [
    input.focus,
    input.narrativeContextFocus,
    input.contextFocus,
    input.narrativeContext,
    metadata.narrativeContext,
    metadata.contextFocus
  ];
  return candidates.find(value => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function normalizeFocus(input = {}) {
  const nested = pickFocusSource(input);
  const source = { ...input, ...nested };
  const characterKeys = uniqueStrings(source.characterKeys || source.characters || [], 80, 240).map(slug).filter(Boolean);
  const relationshipEdgeKeys = uniqueStrings(source.relationshipEdgeKeys || source.relationships || [], 100, 420).map(normalizeRelationshipEdge).filter(Boolean);
  const plotThreadKeys = uniqueStrings(source.plotThreadKeys || source.threads || [], 80, 240).map(slug).filter(Boolean);
  const timelineEventIds = uniqueStrings(source.timelineEventIds || source.events || [], 120, 240);
  const locationRefs = uniqueStrings(source.locationRefs || source.locations || [], 80, 300);
  const objective = clean(source.objective || source.narrativeObjective || '', 4000);
  const queryTerms = uniqueStrings([...(source.queryTerms || []), ...tokens(objective)], 80, 100).map(item => item.toLowerCase());
  return {
    characterKeys: uniqueStrings(characterKeys, 80, 240),
    relationshipEdgeKeys: uniqueStrings(relationshipEdgeKeys, 100, 420),
    plotThreadKeys: uniqueStrings(plotThreadKeys, 80, 240),
    timelineEventIds,
    locationRefs,
    queryTerms,
    objective,
    sceneId: clean(source.sceneId || '', 240) || null,
    sceneOrder: source.sceneOrder === undefined || source.sceneOrder === null ? null : Math.max(0, Math.floor(Number(source.sceneOrder) || 0))
  };
}

function recencyScore(lastEpisode, targetEpisode, maximum = 180) {
  const distance = Math.max(0, Number(targetEpisode || 1) - 1 - Number(lastEpisode || 0));
  return Math.max(0, maximum - Math.min(maximum, distance * 18));
}

function lexicalScore(text, focus) {
  if (!focus.queryTerms?.length) return 0;
  const haystack = new Set(tokens(text));
  let hits = 0;
  for (const term of focus.queryTerms) if (haystack.has(term)) hits += 1;
  return Math.min(240, hits * 40);
}

function joinList(label, values = [], itemLimit = 900) {
  const list = uniqueStrings(values, 80, itemLimit);
  return list.length ? `${label}: ${list.join(' | ')}` : '';
}

function renderBible(bible = {}) {
  const ending = bible.plannedEnding == null ? '' : (typeof bible.plannedEnding === 'string' ? bible.plannedEnding : JSON.stringify(stable(bible.plannedEnding)));
  return [
    'SERIES BIBLE — HARD CANON',
    `Title: ${clean(bible.title || '', 400)}`,
    `Canon version: ${Number(bible.canonVersion || 1)} | Bible revision: ${Number(bible.revisionNumber || 1)}`,
    bible.premise ? `Premise: ${clean(bible.premise, 3200)}` : '',
    joinList('Immutable canon', bible.immutableCanon || [], 1200),
    joinList('World rules', bible.worldRules || [], 1000),
    joinList('Narrative rules', bible.narrativeRules || [], 1000),
    joinList('Central conflicts', bible.centralConflicts || [], 1200),
    ending ? `Planned ending/destination: ${clean(ending, 2800)}` : ''
  ].filter(Boolean).join('\n');
}

function renderEpisode(memory = {}) {
  return [
    `EPISODE MEMORY E${memory.episodeNumber}${memory.title ? ` — ${clean(memory.title, 300)}` : ''}`,
    `Summary: ${clean(memory.summary || '', 3200) || 'No summary.'}`,
    joinList('Established facts', memory.establishedFacts || [], 1000),
    joinList('Discoveries', memory.discoveries || [], 900),
    joinList('Unresolved questions', memory.unresolvedQuestions || [], 1000),
    joinList('Narrative promises', memory.narrativePromises || [], 1000),
    joinList('Cliffhangers', memory.cliffhangers || [], 1000)
  ].filter(Boolean).join('\n');
}

function renderTimeline(event = {}) {
  return [
    `TIMELINE ${event.id} [C${event.chronologyIndex} | E${event.episodeNumber} | ${event.truthStatus || 'unknown'} | ${event.eventType || 'story_event'}]`,
    clean(event.summary || '', 3200),
    event.storyTimeLabel ? `Story time: ${clean(event.storyTimeLabel, 300)}` : '',
    joinList('Participants', event.participants || [], 240),
    joinList('Locations', event.locationRefs || [], 260),
    joinList('Consequences', event.consequences || [], 900),
    joinList('Caused by', event.causeEventIds || [], 240),
    joinList('Must follow', event.mustFollowEventIds || [], 240),
    joinList('Must precede', event.mustPrecedeEventIds || [], 240)
  ].filter(Boolean).join('\n');
}

function renderArc(arc = {}) {
  return [
    `CHARACTER ARC ${arc.characterKey}${arc.displayName ? ` — ${clean(arc.displayName, 240)}` : ''}`,
    `As-of episode: ${Number(arc.lastEpisodeNumber || 0)} | Phase: ${clean(arc.arcPhase || 'unspecified', 220)} | Story status: ${clean(arc.storyStatus || 'active', 160)}`,
    arc.emotionalState ? `Emotional state: ${clean(arc.emotionalState, 1200)}` : '',
    arc.moralState ? `Moral/worldview state: ${clean(arc.moralState, 1200)}` : '',
    arc.physicalCondition ? `Physical condition: ${clean(arc.physicalCondition, 1200)}` : '',
    joinList('Goals', arc.goals || [], 800),
    joinList('Motivations', arc.motivations || [], 800),
    joinList('Beliefs', arc.beliefs || [], 900),
    joinList('Knowledge', arc.knowledge || [], 900),
    joinList('Secrets held', arc.secrets || [], 900),
    joinList('Inner conflicts', arc.innerConflicts || [], 900),
    joinList('Commitments', arc.commitments || [], 900)
  ].filter(Boolean).join('\n');
}

function renderRelationship(relationship = {}) {
  return [
    `RELATIONSHIP ${relationship.sourceCharacterKey}->${relationship.targetCharacterKey}`,
    `As-of episode: ${Number(relationship.lastEpisodeNumber || 0)} | Label: ${clean(relationship.relationshipLabel || 'unspecified', 220)}`,
    `State: ${clean(relationship.relationshipState || 'unspecified', 1800)}`,
    `Scores: trust=${Number(relationship.trustScore || 0)}, affinity=${Number(relationship.affinityScore || 0)}, respect=${Number(relationship.respectScore || 0)}, loyalty=${Number(relationship.loyaltyScore || 0)}, fear=${Number(relationship.fearScore || 0)}, attraction=${Number(relationship.attractionScore || 0)}, dependence=${Number(relationship.dependenceScore || 0)}`,
    joinList('Knowledge source has about target', relationship.knowledgeAboutTarget || [], 800),
    joinList('Beliefs source holds about target', relationship.beliefsAboutTarget || [], 800),
    joinList('Secrets source knows about target', relationship.secretsKnownAboutTarget || [], 800),
    joinList('Promises source made to target', relationship.promisesToTarget || [], 800),
    joinList('Obligations source owes target', relationship.obligationsToTarget || [], 800),
    joinList('Grievances', relationship.grievancesAgainstTarget || [], 800),
    joinList('Current tensions', relationship.currentTensions || [], 800)
  ].filter(Boolean).join('\n');
}

function renderThread(thread = {}) {
  return [
    `PLOT THREAD ${thread.threadKey}${thread.title ? ` — ${clean(thread.title, 300)}` : ''}`,
    `As-of episode: ${Number(thread.lastAdvancedEpisodeNumber || 0)} | Type: ${thread.threadType || 'other'} | Status: ${thread.status || 'open'} | Priority: ${Number(thread.priority || 0)}`,
    thread.premise ? `Premise: ${clean(thread.premise, 1800)}` : '',
    thread.centralQuestion ? `Central question: ${clean(thread.centralQuestion, 1000)}` : '',
    thread.stakes ? `Stakes: ${clean(thread.stakes, 1400)}` : '',
    thread.currentState ? `Current state: ${clean(thread.currentState, 1800)}` : '',
    joinList('Open questions', thread.openQuestions || [], 900),
    joinList('Narrative promises', thread.narrativePromises || [], 900),
    joinList('Established clues', thread.establishedClues || [], 900),
    joinList('Required payoffs', thread.requiredPayoffs || [], 900),
    joinList('Characters', thread.involvedCharacterKeys || [], 240),
    joinList('Relationship edges', thread.relationshipEdgeKeys || [], 420),
    thread.resolutionSummary ? `Resolution summary: ${clean(thread.resolutionSummary, 1400)}` : ''
  ].filter(Boolean).join('\n');
}

function sourceText(type, value) {
  if (type === 'plot_thread') return [value.title, value.premise, value.centralQuestion, value.stakes, value.currentState, ...(value.openQuestions || []), ...(value.narrativePromises || []), ...(value.establishedClues || []), ...(value.requiredPayoffs || [])].join(' ');
  if (type === 'character_arc') return [value.displayName, value.arcPhase, value.storyStatus, value.emotionalState, value.moralState, ...(value.goals || []), ...(value.motivations || []), ...(value.beliefs || []), ...(value.knowledge || []), ...(value.innerConflicts || []), ...(value.commitments || [])].join(' ');
  if (type === 'relationship') return [value.relationshipLabel, value.relationshipState, ...(value.relationshipTags || []), ...(value.beliefsAboutTarget || []), ...(value.knowledgeAboutTarget || []), ...(value.obligationsToTarget || []), ...(value.promisesToTarget || []), ...(value.grievancesAgainstTarget || []), ...(value.currentTensions || [])].join(' ');
  if (type === 'timeline_event') return [value.summary, value.storyTimeLabel, value.eventType, ...(value.participants || []), ...(value.locationRefs || []), ...(value.consequences || [])].join(' ');
  if (type === 'episode_memory') return [value.title, value.summary, ...(value.discoveries || []), ...(value.establishedFacts || []), ...(value.unresolvedQuestions || []), ...(value.narrativePromises || []), ...(value.cliffhangers || [])].join(' ');
  return '';
}

function compareCandidate(a, b) {
  return Number(b.score || 0) - Number(a.score || 0)
    || Number(TYPE_ORDER.get(a.type) ?? 99) - Number(TYPE_ORDER.get(b.type) ?? 99)
    || String(a.key).localeCompare(String(b.key));
}

function focusSummary(focus = {}) {
  const lines = [];
  if (focus.characterKeys?.length) lines.push(`characters=${focus.characterKeys.join(',')}`);
  if (focus.relationshipEdgeKeys?.length) lines.push(`relationships=${focus.relationshipEdgeKeys.join(',')}`);
  if (focus.plotThreadKeys?.length) lines.push(`threads=${focus.plotThreadKeys.join(',')}`);
  if (focus.timelineEventIds?.length) lines.push(`events=${focus.timelineEventIds.join(',')}`);
  if (focus.locationRefs?.length) lines.push(`locations=${focus.locationRefs.join(',')}`);
  if (focus.sceneId) lines.push(`scene=${focus.sceneId}${focus.sceneOrder !== null ? `#${focus.sceneOrder}` : ''}`);
  if (focus.objective) lines.push(`objective=${clean(focus.objective, 500)}`);
  return lines.join(' | ') || 'no explicit focus; structural obligations + recency are used';
}

function buildPromptContext({ bible, targetEpisode, focus, selected, fingerprint, maxPromptChars, sourceValidation }) {
  const grouped = new Map();
  for (const item of selected) {
    if (!grouped.has(item.type)) grouped.set(item.type, []);
    grouped.get(item.type).push(item);
  }
  const section = (title, type) => {
    const items = grouped.get(type) || [];
    return [title, items.length ? items.map(item => item.text).join('\n\n') : '- None selected.'].join('\n');
  };
  const provenance = selected.length
    ? selected.map(item => `- ${item.type}:${item.key} score=${item.score} sourceEpisode=${item.sourceEpisode ?? 'n/a'} revision=${item.sourceRevision ?? 'n/a'} reasons=${item.reasons.join(',') || 'baseline'}`).join('\n')
    : '- No memory candidates selected.';
  const packet = [
    `NARRATIVE CONTEXT RESOLVER V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `TARGET EPISODE: ${targetEpisode}`,
    `LAST FINALIZED EPISODE: ${Number(bible.currentEpisode || 0)}`,
    `CONTEXT FINGERPRINT: ${fingerprint}`,
    `FOCUS: ${focusSummary(focus)}`,
    `SOURCE VALIDATION: ${Object.entries(sourceValidation || {}).map(([key, value]) => `${key}=${value.valid ? 'valid' : 'invalid'}`).join(', ')}`,
    '',
    'SELECTION POLICY:',
    '- Explicit exact references outrank inferred structural relevance; unresolved exact focus references fail closed.',
    '- Plot-thread obligations and their exact character/relationship/timeline links outrank generic recency.',
    '- Historical targets reconstruct Character Arc, Relationship, and Plot Thread state from the latest commit strictly before the target episode.',
    '- Timeline events and Episode Memory from the target episode or later are excluded.',
    '- Selection is deterministic: score, source type, and canonical key define stable ordering under a global prompt budget.',
    '',
    renderBible(bible),
    '',
    section('SELECTED PLOT OBLIGATIONS', 'plot_thread'),
    '',
    section('SELECTED CHARACTER STATES', 'character_arc'),
    '',
    section('SELECTED DIRECTED RELATIONSHIPS', 'relationship'),
    '',
    section('SELECTED TIMELINE EVENTS', 'timeline_event'),
    '',
    section('SELECTED EPISODE HANDOFFS', 'episode_memory'),
    '',
    'PROVENANCE MANIFEST:',
    provenance,
    '',
    'NARRATIVE CONTEXT SAFETY:',
    '- This packet is author-level continuity context. Character knowledge remains isolated to the character/relationship perspective that owns it.',
    '- belief, rumor, disputed, false and unknown timeline states must never be silently promoted to confirmed facts.',
    '- A directed relationship A->B never implies B->A.',
    '- Dormant plot threads remain unresolved obligations; terminal threads appear only when explicitly focused or historically required.',
    '- Do not invent missing context, fuzzy-match canonical identities, or fill an unresolved exact reference with a similarly named entity.',
    '- Script generation is read-only. This resolver has no canon persistence path and cannot mutate Series Bible, Timeline, Episode Memory, Character Arc, Relationship, or Plot Thread state.',
    '- Canon changes happen only through the dedicated post-approval commit/amendment flows.'
  ].join('\n');
  return packet.slice(0, maxPromptChars);
}

class NarrativeContextResolverV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_NARRATIVE_CONTEXT_RESOLVER_ENABLED || 'true').toLowerCase() !== 'false';
    this.maxPromptChars = bounded(options.maxPromptChars || process.env.SERIALIZED_NARRATIVE_CONTEXT_MAX_CHARS, 24000, 120000, 56000);
    this.maxItems = bounded(options.maxItems || process.env.SERIALIZED_NARRATIVE_CONTEXT_MAX_ITEMS, 10, 240, 80);
    this.strictFocus = options.strictFocus ?? String(process.env.SERIALIZED_NARRATIVE_CONTEXT_STRICT_FOCUS || 'true').toLowerCase() !== 'false';
    this.validators = options.validators || {
      timeline: new CanonicalTimelineServiceV12(db, { logger: this.logger }),
      episode: new EpisodeMemoryServiceV12(db, { logger: this.logger }),
      arc: new CharacterArcMemoryServiceV12(db, { logger: this.logger }),
      relationship: new RelationshipStateGraphServiceV12(db, { logger: this.logger }),
      thread: new PlotThreadRegistryServiceV12(db, { logger: this.logger })
    };
  }

  async validateSources(seriesId) {
    const validators = this.validators || {};
    const required = [
      ['timeline', 'validateTimeline'],
      ['episode', 'validateSeries'],
      ['arc', 'validateSeries'],
      ['relationship', 'validateSeries'],
      ['thread', 'validateSeries']
    ];
    const results = {};
    for (const [name, method] of required) {
      if (!validators[name] || typeof validators[name][method] !== 'function') {
        const error = new Error(`narrative_context_dependency_missing:${name}`);
        error.code = 'narrative_context_dependency_missing';
        error.dependency = name;
        throw error;
      }
      const result = await validators[name][method](seriesId);
      results[name] = result;
      if (!result?.valid) {
        const error = new Error(`narrative_context_source_invalid:${name}`);
        error.code = 'narrative_context_source_invalid';
        error.source = name;
        error.blockers = result?.blockers || [];
        throw error;
      }
    }
    return results;
  }

  requireReadDependencies() {
    const required = [
      'listSerializedTimelineEvents', 'listSerializedEpisodeMemories', 'listSerializedCharacterArcs',
      'listSerializedCharacterArcCommits', 'listSerializedRelationshipStates', 'listSerializedRelationshipCommits',
      'listSerializedPlotThreads', 'listSerializedPlotThreadCommits'
    ];
    const missing = required.filter(name => typeof this.db?.[name] !== 'function');
    if (missing.length) {
      const error = new Error(`narrative_context_dependency_missing:${missing[0]}`);
      error.code = 'narrative_context_dependency_missing';
      error.dependencies = missing;
      throw error;
    }
  }

  resolveTargetEpisode(serializedSeriesContext, input = {}) {
    const bible = serializedSeriesContext?.bible || {};
    const bindingEpisode = Math.max(0, Math.floor(Number(serializedSeriesContext?.binding?.episodeNumber || 0) || 0));
    const requestedEpisode = Math.max(0, Math.floor(Number(input.episodeNumber || 0) || 0));
    if (bindingEpisode && requestedEpisode && bindingEpisode !== requestedEpisode) {
      const error = new Error('narrative_context_episode_binding_conflict');
      error.code = 'narrative_context_episode_binding_conflict';
      error.bindingEpisode = bindingEpisode;
      error.requestedEpisode = requestedEpisode;
      throw error;
    }
    const targetEpisode = requestedEpisode || bindingEpisode || Number(bible.currentEpisode || 0) + 1;
    if (targetEpisode < 1) {
      const error = new Error('narrative_context_target_episode_invalid');
      error.code = 'narrative_context_target_episode_invalid';
      throw error;
    }
    if (targetEpisode > Number(bible.currentEpisode || 0) + 1) {
      const error = new Error('narrative_context_episode_gap');
      error.code = 'narrative_context_episode_gap';
      error.targetEpisode = targetEpisode;
      error.nextSafeEpisode = Number(bible.currentEpisode || 0) + 1;
      throw error;
    }
    return targetEpisode;
  }

  async stateBeforeTarget(item, targetEpisode, listCommits, revisionField, episodeField) {
    const commits = await listCommits(item.id, 5000);
    const prior = (commits || [])
      .filter(commit => Number(commit.episodeNumber || 0) < Number(targetEpisode))
      .sort((a, b) => Number(b[revisionField] || 0) - Number(a[revisionField] || 0)
        || Number(b.episodeNumber || 0) - Number(a.episodeNumber || 0))[0] || null;
    const itemEpisode = Number(item[episodeField] || 0);
    if (itemEpisode < Number(targetEpisode)) return { state: item, commit: prior };
    if (!prior?.afterSnapshot) return null;
    return { state: { ...prior.afterSnapshot }, commit: prior };
  }

  assertExplicitFocus(focus, maps) {
    if (!this.strictFocus) return;
    const missing = [];
    for (const key of focus.characterKeys || []) if (!maps.characters.has(key)) missing.push({ type: 'character_arc', key });
    for (const key of focus.relationshipEdgeKeys || []) if (!maps.relationships.has(key)) missing.push({ type: 'relationship', key });
    for (const key of focus.plotThreadKeys || []) if (!maps.threads.has(key)) missing.push({ type: 'plot_thread', key });
    for (const key of focus.timelineEventIds || []) if (!maps.timeline.has(key)) missing.push({ type: 'timeline_event', key });
    if (missing.length) {
      const error = new Error('narrative_context_focus_reference_not_found');
      error.code = 'narrative_context_focus_reference_not_found';
      error.missing = missing;
      throw error;
    }
  }

  candidate(type, key, value, score, reasons, sourceEpisode, sourceRevision, text, explicit = false) {
    return {
      type,
      key,
      value,
      score: Math.round(score),
      reasons: uniqueStrings(reasons, 20, 120),
      sourceEpisode: sourceEpisode == null ? null : Number(sourceEpisode),
      sourceRevision: sourceRevision == null ? null : Number(sourceRevision),
      text,
      explicit
    };
  }

  scoreCandidates({ bible, targetEpisode, focus, memories, events, arcs, relationships, threads }) {
    const candidates = [];
    const focusChars = new Set(focus.characterKeys || []);
    const focusEdges = new Set(focus.relationshipEdgeKeys || []);
    const focusThreads = new Set(focus.plotThreadKeys || []);
    const focusEvents = new Set(focus.timelineEventIds || []);
    const focusLocations = new Set((focus.locationRefs || []).map(item => item.toLowerCase()));

    const threadCharacterStrength = new Map();
    const threadRelationshipStrength = new Map();
    const threadTimelineStrength = new Map();
    for (const record of threads) {
      const thread = record.state;
      if (!['open', 'dormant'].includes(thread.status) && !focusThreads.has(thread.threadKey)) continue;
      const strength = 100 + Number(thread.priority || 0) * 3;
      for (const key of thread.involvedCharacterKeys || []) threadCharacterStrength.set(key, Math.max(threadCharacterStrength.get(key) || 0, strength));
      for (const edge of thread.relationshipEdgeKeys || []) threadRelationshipStrength.set(edge, Math.max(threadRelationshipStrength.get(edge) || 0, strength));
      for (const eventId of record.commit?.timelineEventIds || []) threadTimelineStrength.set(eventId, Math.max(threadTimelineStrength.get(eventId) || 0, strength));
    }

    for (const record of threads) {
      const thread = record.state;
      const explicit = focusThreads.has(thread.threadKey);
      if (!['open', 'dormant'].includes(thread.status) && !explicit) continue;
      const reasons = [];
      let score = 560 + Number(thread.priority || 0) * 4 + recencyScore(thread.lastAdvancedEpisodeNumber, targetEpisode, 180);
      if (thread.status === 'open') { score += 80; reasons.push('open_obligation'); }
      else if (thread.status === 'dormant') reasons.push('dormant_obligation');
      if (explicit) { score += 2200; reasons.push('explicit_thread'); }
      const charHits = (thread.involvedCharacterKeys || []).filter(key => focusChars.has(key)).length;
      if (charHits) { score += Math.min(900, charHits * 450); reasons.push('focused_character_link'); }
      const edgeHits = (thread.relationshipEdgeKeys || []).filter(key => focusEdges.has(key)).length;
      if (edgeHits) { score += Math.min(900, edgeHits * 500); reasons.push('focused_relationship_link'); }
      const lexical = lexicalScore(sourceText('plot_thread', thread), focus); if (lexical) { score += lexical; reasons.push('objective_term_overlap'); }
      candidates.push(this.candidate('plot_thread', thread.threadKey, thread, score, reasons, thread.lastAdvancedEpisodeNumber, thread.revisionNumber, renderThread(thread), explicit));
    }

    for (const record of arcs) {
      const arc = record.state;
      const explicit = focusChars.has(arc.characterKey);
      if (arc.status !== 'active' && !explicit) continue;
      const reasons = [];
      let score = 380 + recencyScore(arc.lastEpisodeNumber, targetEpisode, 170);
      if (explicit) { score += 2200; reasons.push('explicit_character'); }
      if (threadCharacterStrength.has(arc.characterKey)) { score += Math.min(900, threadCharacterStrength.get(arc.characterKey)); reasons.push('plot_thread_character'); }
      if ([...focusEdges].some(edge => edge.split('->').includes(arc.characterKey))) { score += 500; reasons.push('focused_relationship_endpoint'); }
      const lexical = lexicalScore(sourceText('character_arc', arc), focus); if (lexical) { score += lexical; reasons.push('objective_term_overlap'); }
      candidates.push(this.candidate('character_arc', arc.characterKey, arc, score, reasons, arc.lastEpisodeNumber, arc.revisionNumber, renderArc(arc), explicit));
    }

    for (const record of relationships) {
      const relationship = record.state;
      const key = `${relationship.sourceCharacterKey}->${relationship.targetCharacterKey}`;
      const explicit = focusEdges.has(key);
      if (relationship.status !== 'active' && !explicit) continue;
      const reasons = [];
      let score = 340 + recencyScore(relationship.lastEpisodeNumber, targetEpisode, 160);
      if (explicit) { score += 2200; reasons.push('explicit_relationship'); }
      const endpointHits = [relationship.sourceCharacterKey, relationship.targetCharacterKey].filter(keyName => focusChars.has(keyName)).length;
      if (endpointHits === 2) { score += 900; reasons.push('both_focused_endpoints'); }
      else if (endpointHits === 1) { score += 450; reasons.push('focused_endpoint'); }
      if (threadRelationshipStrength.has(key)) { score += Math.min(850, threadRelationshipStrength.get(key)); reasons.push('plot_thread_relationship'); }
      const lexical = lexicalScore(sourceText('relationship', relationship), focus); if (lexical) { score += lexical; reasons.push('objective_term_overlap'); }
      candidates.push(this.candidate('relationship', key, relationship, score, reasons, relationship.lastEpisodeNumber, relationship.revisionNumber, renderRelationship(relationship), explicit));
    }

    for (const event of events) {
      const explicit = focusEvents.has(event.id);
      const reasons = [];
      let score = 260 + recencyScore(event.episodeNumber, targetEpisode, 190);
      if (explicit) { score += 2200; reasons.push('explicit_timeline_event'); }
      const participantHits = (event.participants || []).map(slug).filter(key => focusChars.has(key)).length;
      if (participantHits) { score += Math.min(900, participantHits * 500); reasons.push('focused_participant'); }
      const locationHits = (event.locationRefs || []).filter(item => focusLocations.has(String(item).toLowerCase())).length;
      if (locationHits) { score += Math.min(700, locationHits * 400); reasons.push('focused_location'); }
      if (threadTimelineStrength.has(event.id)) { score += Math.min(850, threadTimelineStrength.get(event.id)); reasons.push('plot_thread_timeline_link'); }
      if (event.truthStatus === 'confirmed') { score += 80; reasons.push('confirmed_canon'); }
      const lexical = lexicalScore(sourceText('timeline_event', event), focus); if (lexical) { score += lexical; reasons.push('objective_term_overlap'); }
      candidates.push(this.candidate('timeline_event', event.id, event, score, reasons, event.episodeNumber, event.revisionNumber, renderTimeline(event), explicit));
    }

    for (const memory of memories) {
      const reasons = [];
      let score = 180 + recencyScore(memory.episodeNumber, targetEpisode, 210);
      const overlap = (memory.timelineEventIds || []).filter(id => focusEvents.has(id) || threadTimelineStrength.has(id)).length;
      if (overlap) { score += Math.min(900, overlap * 350); reasons.push('linked_timeline_handoff'); }
      const obligations = (memory.unresolvedQuestions || []).length + (memory.narrativePromises || []).length + (memory.cliffhangers || []).length;
      if (obligations) { score += Math.min(300, obligations * 35); reasons.push('unresolved_episode_handoff'); }
      const lexical = lexicalScore(sourceText('episode_memory', memory), focus); if (lexical) { score += lexical; reasons.push('objective_term_overlap'); }
      candidates.push(this.candidate('episode_memory', String(memory.episodeNumber), memory, score, reasons, memory.episodeNumber, memory.revisionNumber, renderEpisode(memory), false));
    }

    return candidates.sort(compareCandidate);
  }

  selectCandidates(candidates, bible, targetEpisode, focus, sourceValidation) {
    const bibleBlock = renderBible(bible);
    const reserve = Math.min(10000, Math.max(6000, Math.floor(this.maxPromptChars * 0.17)));
    const candidateBudget = Math.max(4000, this.maxPromptChars - bibleBlock.length - reserve);
    const selected = [];
    const selectedKeys = new Set();
    let used = 0;
    const add = candidate => {
      const identity = `${candidate.type}:${candidate.key}`;
      if (selectedKeys.has(identity) || selected.length >= this.maxItems) return false;
      const cost = candidate.text.length + 240;
      if (used + cost > candidateBudget) return false;
      selected.push(candidate); selectedKeys.add(identity); used += cost; return true;
    };
    for (const type of ['plot_thread', 'character_arc', 'relationship', 'timeline_event', 'episode_memory']) {
      const first = candidates.find(item => item.type === type);
      if (first) add(first);
    }
    for (const candidate of candidates) add(candidate);
    selected.sort((a, b) => Number(TYPE_ORDER.get(a.type) ?? 99) - Number(TYPE_ORDER.get(b.type) ?? 99) || compareCandidate(a, b));

    const fingerprintSeed = {
      version: VERSION,
      seriesId: bible.id,
      bibleRevision: bible.revisionNumber,
      canonVersion: bible.canonVersion,
      targetEpisode,
      focus,
      selected: selected.map(item => ({ type: item.type, key: item.key, sourceEpisode: item.sourceEpisode, sourceRevision: item.sourceRevision }))
    };
    const fingerprint = hash(JSON.stringify(stable(fingerprintSeed))).slice(0, 32);
    let promptContext = buildPromptContext({ bible, targetEpisode, focus, selected, fingerprint, maxPromptChars: this.maxPromptChars, sourceValidation });
    while (promptContext.length > this.maxPromptChars && selected.length) {
      selected.pop();
      fingerprintSeed.selected = selected.map(item => ({ type: item.type, key: item.key, sourceEpisode: item.sourceEpisode, sourceRevision: item.sourceRevision }));
      promptContext = buildPromptContext({ bible, targetEpisode, focus, selected, hash(JSON.stringify(stable(fingerprintSeed))).slice(0, 32), maxPromptChars: this.maxPromptChars, sourceValidation });
    }
    const finalFingerprint = hash(JSON.stringify(stable({ ...fingerprintSeed, selected: selected.map(item => ({ type: item.type, key: item.key, sourceEpisode: item.sourceEpisode, sourceRevision: item.sourceRevision })) }))).slice(0, 32);
    promptContext = buildPromptContext({ bible, targetEpisode, focus, selected, fingerprint: finalFingerprint, maxPromptChars: this.maxPromptChars, sourceValidation });
    return { selected, fingerprint: finalFingerprint, promptContext };
  }

  async resolveContext(serializedSeriesContext = {}, input = {}) {
    if (!this.enabled || !serializedSeriesContext?.active || !serializedSeriesContext?.bible) {
      return { active: false, version: VERSION, promptContext: '', selected: [], fingerprint: null };
    }
    this.requireReadDependencies();
    const bible = serializedSeriesContext.bible;
    if (bible.status && bible.status !== 'active') {
      const error = new Error('narrative_context_series_inactive');
      error.code = 'narrative_context_series_inactive';
      throw error;
    }
    const targetEpisode = this.resolveTargetEpisode(serializedSeriesContext, input);
    const focus = normalizeFocus(input);
    const sourceValidation = await this.validateSources(bible.id);

    const allEvents = await this.db.listSerializedTimelineEvents(bible.id, 5000);
    const events = (allEvents || []).filter(event => event.status === 'active' && Number(event.episodeNumber || 0) < targetEpisode)
      .sort((a, b) => Number(a.chronologyIndex || 0) - Number(b.chronologyIndex || 0));
    const allMemories = await this.db.listSerializedEpisodeMemories(bible.id, 5000);
    const memories = (allMemories || []).filter(memory => memory.status === 'finalized' && Number(memory.episodeNumber || 0) < targetEpisode)
      .sort((a, b) => Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0));

    const arcs = [];
    for (const item of await this.db.listSerializedCharacterArcs(bible.id, 5000, true)) {
      const record = await this.stateBeforeTarget(item, targetEpisode, this.db.listSerializedCharacterArcCommits.bind(this.db), 'arcRevisionNumber', 'lastEpisodeNumber');
      if (record?.state) arcs.push(record);
    }
    const relationships = [];
    for (const item of await this.db.listSerializedRelationshipStates(bible.id, 5000, true)) {
      const record = await this.stateBeforeTarget(item, targetEpisode, this.db.listSerializedRelationshipCommits.bind(this.db), 'relationshipRevisionNumber', 'lastEpisodeNumber');
      if (record?.state) relationships.push(record);
    }
    const threads = [];
    for (const item of await this.db.listSerializedPlotThreads(bible.id, 5000, true)) {
      const record = await this.stateBeforeTarget(item, targetEpisode, this.db.listSerializedPlotThreadCommits.bind(this.db), 'threadRevisionNumber', 'lastAdvancedEpisodeNumber');
      if (record?.state) threads.push(record);
    }

    const maps = {
      characters: new Map(arcs.map(record => [record.state.characterKey, record.state])),
      relationships: new Map(relationships.map(record => [`${record.state.sourceCharacterKey}->${record.state.targetCharacterKey}`, record.state])),
      threads: new Map(threads.map(record => [record.state.threadKey, record.state])),
      timeline: new Map(events.map(event => [event.id, event]))
    };
    this.assertExplicitFocus(focus, maps);

    const candidates = this.scoreCandidates({ bible, targetEpisode, focus, memories, events, arcs, relationships, threads });
    const selection = this.selectCandidates(candidates, bible, targetEpisode, focus, sourceValidation);
    const selectedIds = new Set(selection.selected.map(item => `${item.type}:${item.key}`));
    const omittedByType = {};
    for (const candidate of candidates) {
      if (selectedIds.has(`${candidate.type}:${candidate.key}`)) continue;
      omittedByType[candidate.type] = Number(omittedByType[candidate.type] || 0) + 1;
    }
    return {
      active: true,
      version: VERSION,
      seriesId: bible.id,
      targetEpisode,
      focus,
      fingerprint: selection.fingerprint,
      selected: selection.selected.map(item => ({
        type: item.type,
        key: item.key,
        score: item.score,
        reasons: item.reasons,
        sourceEpisode: item.sourceEpisode,
        sourceRevision: item.sourceRevision
      })),
      selectedCounts: selection.selected.reduce((out, item) => { out[item.type] = Number(out[item.type] || 0) + 1; return out; }, {}),
      candidateCount: candidates.length,
      omittedByType,
      sourceValidation,
      promptContext: selection.promptContext
    };
  }

  async resolveForScript(serializedSeriesContext = {}, strategy = {}) {
    const focus = pickFocusSource(strategy);
    return this.resolveContext(serializedSeriesContext, {
      episodeNumber: serializedSeriesContext?.binding?.episodeNumber,
      focus
    });
  }
}

module.exports = {
  NARRATIVE_CONTEXT_RESOLVER_VERSION: VERSION,
  NarrativeContextResolverV12,
  normalizeFocus,
  normalizeRelationshipEdge,
  renderBible,
  renderEpisode,
  renderTimeline,
  renderArc,
  renderRelationship,
  renderThread,
  buildPromptContext,
  stable,
  slug
};
