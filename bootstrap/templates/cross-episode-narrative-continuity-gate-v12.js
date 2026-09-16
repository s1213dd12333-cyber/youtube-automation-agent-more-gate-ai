'use strict';

const crypto = require('crypto');
const { NarrativeContextResolverV12, normalizeFocus, normalizeRelationshipEdge, slug } = require('./narrative-context-resolver-v12');

const VERSION = '11.12.8';
const NEGATIONS = new Set(['not', 'never', 'no', 'none', 'without', 'didnt', 'isnt', 'wasnt', 'nao', 'nunca', 'jamais', 'sem']);
const TEXT_STOP = new Set([
  'the','and','for','with','that','this','from','into','about','what','when','where','who','why','how',
  'was','were','are','is','has','have','had','did','does','do','uma','uns','das','dos','para','com','que','por',
  'como','onde','quando','qual','quais','sobre','era','foi','sao','ser','tem','teve'
]);

function clean(value, limit = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function uniqueStrings(values = [], limit = 160, itemLimit = 2400) {
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
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function bounded(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function words(value) {
  return clean(value, 12000).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function contentTokens(value) {
  return [...new Set(words(value).filter(word => word.length >= 3 && !TEXT_STOP.has(word) && !NEGATIONS.has(word)))];
}

function polarity(value) {
  return words(value).some(word => NEGATIONS.has(word)) ? -1 : 1;
}

function similarity(a, b) {
  const left = new Set(contentTokens(a));
  const right = new Set(contentTokens(b));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.max(left.size, right.size);
}

function statementsContradict(a, b) {
  const score = similarity(a, b);
  if (score < 0.62) return false;
  return polarity(a) !== polarity(b);
}

function normalizeEventSnapshot(event = {}) {
  return {
    id: clean(event.id, 240),
    eventKey: clean(event.eventKey, 240),
    chronologyIndex: Number(event.chronologyIndex || 0),
    episodeNumber: Number(event.episodeNumber || 0),
    eventType: clean(event.eventType || 'story_event', 120),
    summary: clean(event.summary || '', 4000),
    participants: uniqueStrings(event.participants || [], 120, 240).map(slug).filter(Boolean),
    locationRefs: uniqueStrings(event.locationRefs || [], 120, 300),
    causeEventIds: uniqueStrings(event.causeEventIds || [], 160, 240),
    consequences: uniqueStrings(event.consequences || [], 160, 1400),
    mustFollowEventIds: uniqueStrings(event.mustFollowEventIds || [], 160, 240),
    mustPrecedeEventIds: uniqueStrings(event.mustPrecedeEventIds || [], 160, 240),
    truthStatus: clean(event.truthStatus || 'unknown', 40).toLowerCase(),
    revisionNumber: Number(event.revisionNumber || 1),
    status: clean(event.status || 'active', 40)
  };
}

function normalizeCandidate(input = {}) {
  return {
    strategyId: clean(input.strategyId || '', 240) || null,
    productionId: clean(input.productionId || '', 240) || null,
    title: clean(input.title || '', 500),
    summary: clean(input.summary || '', 16000),
    discoveries: uniqueStrings(input.discoveries || [], 160, 2400),
    establishedFacts: uniqueStrings(input.establishedFacts || [], 280, 2600),
    resolvedQuestions: uniqueStrings(input.resolvedQuestions || [], 180, 2600),
    unresolvedQuestions: uniqueStrings(input.unresolvedQuestions || [], 180, 2600),
    narrativePromises: uniqueStrings(input.narrativePromises || [], 180, 2600),
    cliffhangers: uniqueStrings(input.cliffhangers || [], 120, 2600),
    timelineEventIds: uniqueStrings(input.timelineEventIds || [], 600, 240)
  };
}

function normalizeKnowledgeUse(value = {}) {
  return {
    characterKey: slug(value.characterKey || value.character || ''),
    fact: clean(value.fact || value.knowledge || '', 2600),
    supportingEventIds: uniqueStrings(value.supportingEventIds || value.eventIds || [], 80, 240),
    learnedInEpisode: value.learnedInEpisode === true
  };
}

function normalizeCharacterTransition(value = {}) {
  return {
    characterKey: slug(value.characterKey || value.character || ''),
    expectedRevision: value.expectedRevision == null ? null : Number(value.expectedRevision),
    introduced: value.introduced === true,
    arcPhase: clean(value.arcPhase || '', 260),
    storyStatus: clean(value.storyStatus || '', 120),
    emotionalState: clean(value.emotionalState || '', 1800),
    supportingEventIds: uniqueStrings(value.supportingEventIds || value.eventIds || [], 80, 240)
  };
}

function normalizeRelationshipTransition(value = {}) {
  return {
    edgeKey: normalizeRelationshipEdge(value.edgeKey || value.relationshipEdgeKey || `${value.sourceCharacterKey || ''}->${value.targetCharacterKey || ''}`),
    expectedRevision: value.expectedRevision == null ? null : Number(value.expectedRevision),
    introduced: value.introduced === true,
    relationshipLabel: clean(value.relationshipLabel || '', 260),
    relationshipState: clean(value.relationshipState || '', 2200),
    supportingEventIds: uniqueStrings(value.supportingEventIds || value.eventIds || [], 80, 240)
  };
}

function normalizeThreadAction(value = {}) {
  const allowed = new Set(['advance', 'resolve', 'cancel', 'dormant', 'defer', 'create', 'none']);
  const action = clean(value.action || 'advance', 40).toLowerCase();
  return {
    threadKey: slug(value.threadKey || value.thread || ''),
    action: allowed.has(action) ? action : 'advance',
    expectedRevision: value.expectedRevision == null ? null : Number(value.expectedRevision),
    reason: clean(value.reason || value.rationale || '', 1800),
    supportingEventIds: uniqueStrings(value.supportingEventIds || value.eventIds || [], 80, 240)
  };
}

function normalizeManifest(input = {}) {
  const source = input.continuityManifest && typeof input.continuityManifest === 'object'
    ? input.continuityManifest
    : (input.manifest && typeof input.manifest === 'object' ? input.manifest : {});
  return {
    knowledgeUses: (Array.isArray(source.knowledgeUses) ? source.knowledgeUses : []).slice(0, 200).map(normalizeKnowledgeUse)
      .filter(item => item.characterKey && item.fact),
    characterTransitions: (Array.isArray(source.characterTransitions) ? source.characterTransitions : []).slice(0, 120)
      .map(normalizeCharacterTransition).filter(item => item.characterKey),
    relationshipTransitions: (Array.isArray(source.relationshipTransitions) ? source.relationshipTransitions : []).slice(0, 160)
      .map(normalizeRelationshipTransition).filter(item => item.edgeKey),
    plotThreadActions: (Array.isArray(source.plotThreadActions) ? source.plotThreadActions : []).slice(0, 160)
      .map(normalizeThreadAction).filter(item => item.threadKey)
  };
}

function candidateText(candidate, targetEvents = []) {
  const eventText = targetEvents.flatMap(event => [
    event.summary,
    ...(event.consequences || []),
    ...(event.participants || []),
    ...(event.locationRefs || [])
  ]);
  return [
    candidate.title,
    candidate.summary,
    ...candidate.discoveries,
    ...candidate.establishedFacts,
    ...candidate.resolvedQuestions,
    ...candidate.unresolvedQuestions,
    ...candidate.narrativePromises,
    ...candidate.cliffhangers,
    ...eventText
  ].filter(Boolean).join(' ');
}

function candidateFingerprint(seriesId, episodeNumber, candidate, targetEvents) {
  return hash(JSON.stringify(stable({
    version: VERSION,
    seriesId,
    episodeNumber: Number(episodeNumber),
    candidate: normalizeCandidate(candidate),
    timeline: (targetEvents || []).map(normalizeEventSnapshot).sort((a, b) => a.id.localeCompare(b.id))
  }))).slice(0, 40);
}

function issue(code, message, details = {}) {
  return { code, message: clean(message, 1400), details: stable(details) };
}

function reportScore(blockers, warnings) {
  return Math.max(0, 100 - blockers.length * 24 - warnings.length * 5);
}

class CrossEpisodeNarrativeContinuityGateV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_NARRATIVE_CONTINUITY_GATE_ENABLED || 'true').toLowerCase() !== 'false';
    this.requirePass = options.requirePass ?? String(process.env.SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_PASS || 'true').toLowerCase() !== 'false';
    this.requireManifest = options.requireManifest ?? String(process.env.SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_MANIFEST || 'false').toLowerCase() === 'true';
    this.blockThreadPriority = bounded(options.blockThreadPriority || process.env.SERIALIZED_NARRATIVE_CONTINUITY_BLOCK_THREAD_PRIORITY, 1, 100, 90);
    this.warnThreadPriority = bounded(options.warnThreadPriority || process.env.SERIALIZED_NARRATIVE_CONTINUITY_WARN_THREAD_PRIORITY, 1, 100, 70);
    this.resolver = options.resolver || new NarrativeContextResolverV12(db, { logger: this.logger });
  }

  requireDependencies() {
    const required = [
      'getSerializedSeriesBible', 'listSerializedTimelineEvents', 'listSerializedEpisodeMemories',
      'listSerializedCharacterArcs', 'listSerializedCharacterArcCommits',
      'listSerializedRelationshipStates', 'listSerializedRelationshipCommits',
      'listSerializedPlotThreads', 'listSerializedPlotThreadCommits',
      'saveSerializedNarrativeContinuityReport', 'getLatestPassingNarrativeContinuityReport',
      'listSerializedNarrativeContinuityReports'
    ];
    const missing = required.filter(name => typeof this.db?.[name] !== 'function');
    if (missing.length) {
      const error = new Error(`narrative_continuity_dependency_missing:${missing[0]}`);
      error.code = 'narrative_continuity_dependency_missing';
      error.dependencies = missing;
      throw error;
    }
  }

  async requireSeries(seriesId) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) {
      const error = new Error('narrative_continuity_series_not_found');
      error.code = 'narrative_continuity_series_not_found';
      throw error;
    }
    if (bible.status !== 'active') {
      const error = new Error('narrative_continuity_series_inactive');
      error.code = 'narrative_continuity_series_inactive';
      throw error;
    }
    return bible;
  }

  async targetEvents(seriesId, episodeNumber) {
    const events = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    return (events || [])
      .filter(event => event.status === 'active' && Number(event.episodeNumber || 0) === Number(episodeNumber))
      .map(normalizeEventSnapshot)
      .sort((a, b) => Number(a.chronologyIndex || 0) - Number(b.chronologyIndex || 0) || a.id.localeCompare(b.id));
  }

  async allPriorEvents(seriesId, episodeNumber) {
    const events = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    return (events || [])
      .filter(event => event.status === 'active' && Number(event.episodeNumber || 0) < Number(episodeNumber))
      .map(normalizeEventSnapshot);
  }

  buildFocus(input, manifest) {
    const base = normalizeFocus(input.focus || input.contextFocus || input.narrativeContextFocus || {});
    const characterKeys = [...base.characterKeys];
    const relationshipEdgeKeys = [...base.relationshipEdgeKeys];
    const plotThreadKeys = [...base.plotThreadKeys];
    for (const use of manifest.knowledgeUses) characterKeys.push(use.characterKey);
    for (const transition of manifest.characterTransitions) if (!transition.introduced) characterKeys.push(transition.characterKey);
    for (const transition of manifest.relationshipTransitions) if (!transition.introduced) relationshipEdgeKeys.push(transition.edgeKey);
    for (const action of manifest.plotThreadActions) if (action.action !== 'create') plotThreadKeys.push(action.threadKey);
    return normalizeFocus({ ...base, characterKeys, relationshipEdgeKeys, plotThreadKeys });
  }

  async arcAsOf(seriesId, characterKey, targetEpisode) {
    const arcs = await this.db.listSerializedCharacterArcs(seriesId, 5000, true);
    const item = (arcs || []).find(arc => arc.characterKey === characterKey);
    if (!item) return null;
    return this.resolver.stateBeforeTarget(item, targetEpisode, this.db.listSerializedCharacterArcCommits.bind(this.db), 'arcRevisionNumber', 'lastEpisodeNumber');
  }

  async relationshipAsOf(seriesId, edgeKey, targetEpisode) {
    const relationships = await this.db.listSerializedRelationshipStates(seriesId, 5000, true);
    const item = (relationships || []).find(rel => `${rel.sourceCharacterKey}->${rel.targetCharacterKey}` === edgeKey);
    if (!item) return null;
    return this.resolver.stateBeforeTarget(item, targetEpisode, this.db.listSerializedRelationshipCommits.bind(this.db), 'relationshipRevisionNumber', 'lastEpisodeNumber');
  }

  async threadAsOf(seriesId, threadKey, targetEpisode) {
    const threads = await this.db.listSerializedPlotThreads(seriesId, 5000, true);
    const item = (threads || []).find(thread => thread.threadKey === threadKey);
    if (!item) return null;
    return this.resolver.stateBeforeTarget(item, targetEpisode, this.db.listSerializedPlotThreadCommits.bind(this.db), 'threadRevisionNumber', 'lastAdvancedEpisodeNumber');
  }

  supportingEventsValid(ids, targetEvents) {
    if (!ids?.length) return false;
    const allowed = new Set(targetEvents.map(event => event.id));
    return ids.every(id => allowed.has(id));
  }

  factKnownBeforeEpisode(fact, arc) {
    const knowledge = [...(arc?.knowledge || []), ...(arc?.secrets || [])];
    return knowledge.some(item => similarity(item, fact) >= 0.68);
  }

  factLearnedInTarget(fact, characterKey, supportingEventIds, targetEvents) {
    if (!this.supportingEventsValid(supportingEventIds, targetEvents)) return false;
    const ids = new Set(supportingEventIds);
    return targetEvents.some(event => ids.has(event.id)
      && (event.participants || []).map(slug).includes(characterKey)
      && similarity([event.summary, ...(event.consequences || [])].join(' '), fact) >= 0.45);
  }

  async evaluateEpisode(seriesId, episodeNumber, input = {}, options = {}) {
    if (!this.enabled) return { active: false, version: VERSION, verdict: 'pass', score: 100, blockers: [], warnings: [], checks: [] };
    this.requireDependencies();
    const bible = await this.requireSeries(seriesId);
    const targetEpisode = Math.max(1, Number(episodeNumber || input.episodeNumber || 0));
    const expectedEpisode = Number(bible.currentEpisode || 0) + 1;
    if (targetEpisode !== expectedEpisode) {
      const error = new Error('narrative_continuity_must_check_next_episode');
      error.code = 'narrative_continuity_must_check_next_episode';
      error.expectedEpisode = expectedEpisode;
      error.requestedEpisode = targetEpisode;
      throw error;
    }

    const candidate = normalizeCandidate({ ...input, episodeNumber: targetEpisode });
    const manifest = normalizeManifest(input);
    const focus = this.buildFocus(input, manifest);
    const serializedSeriesContext = { active: true, bible, binding: { episodeNumber: targetEpisode } };
    const context = await this.resolver.resolveContext(serializedSeriesContext, { episodeNumber: targetEpisode, focus });
    const targetEvents = await this.targetEvents(seriesId, targetEpisode);
    const priorEvents = await this.allPriorEvents(seriesId, targetEpisode);
    const fingerprint = candidateFingerprint(seriesId, targetEpisode, candidate, targetEvents);
    const blockers = [];
    const warnings = [];
    const checks = [];
    const block = (code, message, details = {}) => { const item = issue(code, message, details); blockers.push(item); checks.push({ ...item, status: 'block' }); };
    const warn = (code, message, details = {}) => { const item = issue(code, message, details); warnings.push(item); checks.push({ ...item, status: 'warn' }); };
    const pass = (code, message, details = {}) => checks.push({ ...issue(code, message, details), status: 'pass' });

    if (!candidate.summary) block('continuity_episode_summary_required', 'Episode summary is required for continuity review.');
    else pass('continuity_episode_summary_present', 'Episode summary is present.');

    const actualTimelineIds = targetEvents.map(event => event.id).sort();
    const suppliedTimelineIds = [...candidate.timelineEventIds].sort();
    if (JSON.stringify(actualTimelineIds) !== JSON.stringify(suppliedTimelineIds)) {
      block('continuity_timeline_set_mismatch', 'Candidate Timeline IDs do not exactly match active target-episode Timeline events.', { actualTimelineIds, suppliedTimelineIds });
    } else pass('continuity_timeline_set_exact', 'Candidate Timeline set exactly matches the target episode.', { count: actualTimelineIds.length });

    const proposedStatements = [candidate.summary, ...candidate.discoveries, ...candidate.establishedFacts].filter(Boolean);
    for (const canon of bible.immutableCanon || []) {
      const contradiction = proposedStatements.find(statement => statementsContradict(canon, statement));
      if (contradiction) block('continuity_immutable_canon_contradiction', 'Candidate appears to negate an immutable Series Bible canon statement.', { canon, statement: contradiction });
    }
    if (!blockers.some(item => item.code === 'continuity_immutable_canon_contradiction')) pass('continuity_immutable_canon_preserved', 'No deterministic negation conflict with immutable canon was detected.');

    const uncertain = priorEvents.filter(event => ['belief', 'rumor', 'disputed', 'false', 'unknown'].includes(event.truthStatus));
    for (const fact of candidate.establishedFacts) {
      const prior = uncertain.find(event => similarity(event.summary, fact) >= 0.68);
      if (!prior) continue;
      const confirmedNow = targetEvents.some(event => event.truthStatus === 'confirmed' && similarity(event.summary, fact) >= 0.62);
      if (!confirmedNow) block('continuity_uncertain_truth_promoted', 'An uncertain prior Timeline statement was promoted to an established fact without a new confirmed event.', { fact, priorEventId: prior.id, priorTruthStatus: prior.truthStatus });
    }
    if (!blockers.some(item => item.code === 'continuity_uncertain_truth_promoted')) pass('continuity_truth_status_preserved', 'No uncertain Timeline state was silently promoted to established fact.');

    const previousMemories = (await this.db.listSerializedEpisodeMemories(seriesId, 5000)).filter(memory => memory.status === 'finalized' && Number(memory.episodeNumber || 0) < targetEpisode);
    const priorUnresolved = uniqueStrings(previousMemories.flatMap(memory => memory.unresolvedQuestions || []), 500, 2600);
    for (const resolved of candidate.resolvedQuestions) {
      if (!priorUnresolved.some(question => similarity(question, resolved) >= 0.5)) warn('continuity_resolution_without_prior_open_question', 'Candidate resolves a question that was not found in prior Episode Memory.', { resolvedQuestion: resolved });
    }

    const allThreads = await this.db.listSerializedPlotThreads(seriesId, 5000, true);
    const threadActions = new Map(manifest.plotThreadActions.map(action => [action.threadKey, action]));
    for (const item of allThreads || []) {
      const record = await this.resolver.stateBeforeTarget(item, targetEpisode, this.db.listSerializedPlotThreadCommits.bind(this.db), 'threadRevisionNumber', 'lastAdvancedEpisodeNumber');
      const thread = record?.state;
      if (!thread || thread.status !== 'open') continue;
      const threadText = [thread.threadKey, thread.title, thread.currentState, thread.centralQuestion, ...(thread.openQuestions || []), ...(thread.narrativePromises || []), ...(thread.requiredPayoffs || [])].filter(Boolean).join(' ');
      const addressed = similarity(threadText, candidateText(candidate, targetEvents)) >= 0.16;
      const action = threadActions.get(thread.threadKey);
      const explicitlyDeferred = action?.action === 'defer' && clean(action.reason, 1800).length >= 8;
      if (!addressed && !explicitlyDeferred && Number(thread.priority || 0) >= this.blockThreadPriority) {
        block('continuity_high_priority_thread_unaddressed', 'A high-priority open plot thread was neither addressed nor explicitly deferred.', { threadKey: thread.threadKey, priority: Number(thread.priority || 0) });
      } else if (!addressed && !explicitlyDeferred && Number(thread.priority || 0) >= this.warnThreadPriority) {
        warn('continuity_plot_thread_unaddressed', 'An open plot thread is not visibly addressed in this episode candidate.', { threadKey: thread.threadKey, priority: Number(thread.priority || 0) });
      } else if (explicitlyDeferred) pass('continuity_plot_thread_explicitly_deferred', 'Open plot thread was explicitly deferred with rationale.', { threadKey: thread.threadKey });
    }

    const manifestEmpty = !manifest.knowledgeUses.length && !manifest.characterTransitions.length && !manifest.relationshipTransitions.length && !manifest.plotThreadActions.length;
    if (this.requireManifest && manifestEmpty) block('continuity_manifest_required', 'A structured continuity manifest is required for this serialized episode.');
    else if (manifestEmpty) warn('continuity_manifest_absent', 'No structured continuity manifest was supplied; deterministic canon/thread checks still ran.');
    else pass('continuity_manifest_present', 'Structured continuity manifest supplied.');

    for (const use of manifest.knowledgeUses) {
      const arcRecord = await this.arcAsOf(seriesId, use.characterKey, targetEpisode);
      if (!arcRecord?.state) {
        block('continuity_character_knowledge_owner_not_found', 'Knowledge use references a character without an as-of Character Arc.', { characterKey: use.characterKey, fact: use.fact });
        continue;
      }
      if (this.factKnownBeforeEpisode(use.fact, arcRecord.state)) {
        pass('continuity_character_knowledge_preexisting', 'Character knowledge is present in prior Character Arc memory.', { characterKey: use.characterKey, fact: use.fact });
        continue;
      }
      if (use.learnedInEpisode && this.factLearnedInTarget(use.fact, use.characterKey, use.supportingEventIds, targetEvents)) {
        pass('continuity_character_knowledge_learned_in_episode', 'Character learns the fact through a supported target-episode event.', { characterKey: use.characterKey, fact: use.fact, supportingEventIds: use.supportingEventIds });
        continue;
      }
      block('continuity_impossible_character_knowledge', 'Character uses knowledge not present before the episode and not learned through a supported target event.', { characterKey: use.characterKey, fact: use.fact, supportingEventIds: use.supportingEventIds });
    }

    for (const transition of manifest.characterTransitions) {
      if (transition.introduced) {
        if (!transition.supportingEventIds.length || !this.supportingEventsValid(transition.supportingEventIds, targetEvents)) block('continuity_character_introduction_without_event', 'New character transition must cite target-episode Timeline evidence.', { characterKey: transition.characterKey });
        continue;
      }
      const record = await this.arcAsOf(seriesId, transition.characterKey, targetEpisode);
      if (!record?.state) {
        block('continuity_character_transition_target_not_found', 'Character transition references a missing as-of Character Arc.', { characterKey: transition.characterKey });
        continue;
      }
      if (transition.expectedRevision != null && Number(transition.expectedRevision) !== Number(record.state.revisionNumber || 0)) block('continuity_stale_character_arc_revision', 'Character transition was reviewed against a stale Character Arc revision.', { characterKey: transition.characterKey, expectedRevision: transition.expectedRevision, actualRevision: Number(record.state.revisionNumber || 0) });
      const changesState = Boolean(transition.arcPhase || transition.storyStatus || transition.emotionalState);
      if (changesState && !this.supportingEventsValid(transition.supportingEventIds, targetEvents)) block('continuity_character_transition_without_event', 'Character state transition lacks exact target-episode Timeline support.', { characterKey: transition.characterKey, supportingEventIds: transition.supportingEventIds });
    }

    for (const transition of manifest.relationshipTransitions) {
      if (transition.introduced) {
        if (!this.supportingEventsValid(transition.supportingEventIds, targetEvents)) block('continuity_relationship_introduction_without_event', 'New directed relationship must cite target-episode Timeline evidence.', { edgeKey: transition.edgeKey });
        continue;
      }
      const record = await this.relationshipAsOf(seriesId, transition.edgeKey, targetEpisode);
      if (!record?.state) {
        block('continuity_relationship_transition_target_not_found', 'Relationship transition references a missing exact directed edge.', { edgeKey: transition.edgeKey });
        continue;
      }
      if (transition.expectedRevision != null && Number(transition.expectedRevision) !== Number(record.state.revisionNumber || 0)) block('continuity_stale_relationship_revision', 'Relationship transition was reviewed against a stale relationship revision.', { edgeKey: transition.edgeKey, expectedRevision: transition.expectedRevision, actualRevision: Number(record.state.revisionNumber || 0) });
      if ((transition.relationshipLabel || transition.relationshipState) && !this.supportingEventsValid(transition.supportingEventIds, targetEvents)) block('continuity_relationship_transition_without_event', 'Directed relationship state change lacks exact target-episode Timeline support.', { edgeKey: transition.edgeKey, supportingEventIds: transition.supportingEventIds });
    }

    for (const action of manifest.plotThreadActions) {
      if (action.action === 'create') {
        if (!this.supportingEventsValid(action.supportingEventIds, targetEvents)) block('continuity_plot_thread_creation_without_event', 'New plot thread must cite target-episode Timeline evidence.', { threadKey: action.threadKey });
        continue;
      }
      const record = await this.threadAsOf(seriesId, action.threadKey, targetEpisode);
      if (!record?.state) {
        block('continuity_plot_thread_action_target_not_found', 'Plot-thread action references a missing as-of thread.', { threadKey: action.threadKey });
        continue;
      }
      const thread = record.state;
      if (['resolved', 'cancelled'].includes(thread.status) && !['none', 'defer'].includes(action.action)) block('continuity_terminal_plot_thread_mutation', 'Terminal plot thread cannot be advanced or reopened by the next episode.', { threadKey: action.threadKey, status: thread.status, action: action.action });
      if (action.expectedRevision != null && Number(action.expectedRevision) !== Number(thread.revisionNumber || 0)) block('continuity_stale_plot_thread_revision', 'Plot-thread action was reviewed against a stale revision.', { threadKey: action.threadKey, expectedRevision: action.expectedRevision, actualRevision: Number(thread.revisionNumber || 0) });
      if (['advance', 'resolve', 'cancel', 'dormant'].includes(action.action) && !this.supportingEventsValid(action.supportingEventIds, targetEvents)) block('continuity_plot_thread_action_without_event', 'Plot-thread lifecycle action lacks exact target-episode Timeline support.', { threadKey: action.threadKey, action: action.action, supportingEventIds: action.supportingEventIds });
      if (action.action === 'resolve') {
        const corpus = candidateText(candidate, targetEvents);
        const missingPayoffs = (thread.requiredPayoffs || []).filter(payoff => similarity(payoff, corpus) < 0.2);
        if (missingPayoffs.length) block('continuity_required_payoff_missing', 'Plot thread is marked for resolution while required payoff text is not represented in the candidate.', { threadKey: action.threadKey, missingPayoffs });
      }
    }

    const verdict = blockers.length ? 'block' : 'pass';
    const score = reportScore(blockers, warnings);
    const sourceFingerprint = clean(input.sourceFingerprint || '', 256) || (clean(input.scriptText || '', 120000) ? hash(clean(input.scriptText || '', 120000)).slice(0, 64) : null);
    const reportId = `narrative_continuity_${hash(`${seriesId}:${targetEpisode}:${context.fingerprint}:${fingerprint}:${VERSION}`).slice(0, 24)}`;
    const report = {
      id: reportId,
      seriesId,
      episodeNumber: targetEpisode,
      gateVersion: VERSION,
      contextFingerprint: context.fingerprint,
      candidateFingerprint: fingerprint,
      sourceFingerprint,
      verdict,
      score,
      blockers,
      warnings,
      checks,
      focus,
      candidateSnapshot: { ...candidate, targetTimelineEvents: targetEvents },
      manifest,
      createdBy: clean(options.actor || input.actor || 'continuity_gate', 240) || 'continuity_gate',
      createdAt: new Date().toISOString()
    };
    const saved = options.persist === false ? report : await this.db.saveSerializedNarrativeContinuityReport(report);
    return { active: true, version: VERSION, verdict, score, report: saved || report, contextFingerprint: context.fingerprint, candidateFingerprint: fingerprint, blockers, warnings, checks };
  }

  async verifyPassingReport(seriesId, episodeNumber, memory = {}) {
    if (!this.enabled || !this.requirePass) return { valid: true, bypassed: true, reason: 'narrative_continuity_gate_disabled', candidateFingerprint: null, report: null };
    this.requireDependencies();
    const bible = await this.requireSeries(seriesId);
    const targetEpisode = Math.max(1, Number(episodeNumber || memory.episodeNumber || 0));
    const expectedEpisode = Number(bible.currentEpisode || 0) + 1;
    if (targetEpisode !== expectedEpisode) return { valid: false, reason: 'narrative_continuity_must_check_next_episode', expectedEpisode, targetEpisode };
    const candidate = normalizeCandidate(memory);
    const events = await this.targetEvents(seriesId, targetEpisode);
    const fingerprint = candidateFingerprint(seriesId, targetEpisode, candidate, events);
    const report = await this.db.getLatestPassingNarrativeContinuityReport(seriesId, targetEpisode, fingerprint);
    if (!report) return { valid: false, reason: 'narrative_continuity_pass_required', candidateFingerprint: fingerprint, report: null };
    if (report.gateVersion !== VERSION) return { valid: false, reason: 'narrative_continuity_report_version_stale', candidateFingerprint: fingerprint, report };
    const serializedSeriesContext = { active: true, bible, binding: { episodeNumber: targetEpisode } };
    const currentContext = await this.resolver.resolveContext(serializedSeriesContext, { episodeNumber: targetEpisode, focus: report.focus || {} });
    if (currentContext.fingerprint !== report.contextFingerprint) {
      return { valid: false, reason: 'narrative_continuity_context_stale', candidateFingerprint: fingerprint, previousContextFingerprint: report.contextFingerprint, currentContextFingerprint: currentContext.fingerprint, report };
    }
    return { valid: true, reason: null, candidateFingerprint: fingerprint, contextFingerprint: currentContext.fingerprint, report };
  }

  async listReports(seriesId, episodeNumber, limit = 100) {
    this.requireDependencies();
    await this.requireSeries(seriesId);
    return this.db.listSerializedNarrativeContinuityReports(seriesId, episodeNumber, limit);
  }
}

module.exports = {
  NARRATIVE_CONTINUITY_GATE_VERSION: VERSION,
  CrossEpisodeNarrativeContinuityGateV12,
  normalizeCandidate,
  normalizeManifest,
  normalizeEventSnapshot,
  candidateFingerprint,
  similarity,
  polarity,
  statementsContradict,
  stable,
  clean
};
