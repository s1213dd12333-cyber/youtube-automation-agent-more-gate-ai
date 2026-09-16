'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

class MemoryDb {
  constructor() {
    this.bibles = new Map();
    this.timeline = [];
    this.memories = [];
    this.arcs = [];
    this.arcCommits = new Map();
    this.relationships = [];
    this.relationshipCommits = new Map();
    this.threads = [];
    this.threadCommits = new Map();
    this.mutationCalls = 0;
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  seedBible(value) { this.bibles.set(value.id, this.clone(value)); }
  seedTimeline(value) { this.timeline.push(this.clone(value)); }
  seedMemory(value) { this.memories.push(this.clone(value)); }
  seedArc(value, commits = []) { this.arcs.push(this.clone(value)); this.arcCommits.set(value.id, this.clone(commits)); }
  seedRelationship(value, commits = []) { this.relationships.push(this.clone(value)); this.relationshipCommits.set(value.id, this.clone(commits)); }
  seedThread(value, commits = []) { this.threads.push(this.clone(value)); this.threadCommits.set(value.id, this.clone(commits)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async listSerializedTimelineEvents(seriesId) { return this.timeline.filter(item => item.seriesId === seriesId).map(item => this.clone(item)); }
  async getSerializedTimelineState(seriesId) { return { seriesId, revisionNumber: 9, lastChronologyIndex: 4000 }; }
  async listSerializedEpisodeMemories(seriesId) { return this.memories.filter(item => item.seriesId === seriesId).map(item => this.clone(item)); }
  async listSerializedCharacterArcs(seriesId, _limit, includeRetired = false) {
    return this.arcs.filter(item => item.seriesId === seriesId && (includeRetired || item.status === 'active')).map(item => this.clone(item));
  }
  async listSerializedCharacterArcCommits(arcId) { return this.clone(this.arcCommits.get(arcId) || []); }
  async listSerializedRelationshipStates(seriesId, _limit, includeArchived = false) {
    return this.relationships.filter(item => item.seriesId === seriesId && (includeArchived || item.status === 'active')).map(item => this.clone(item));
  }
  async listSerializedRelationshipCommits(relationshipId) { return this.clone(this.relationshipCommits.get(relationshipId) || []); }
  async listSerializedPlotThreads(seriesId, _limit, includeTerminal = false) {
    return this.threads.filter(item => item.seriesId === seriesId && (includeTerminal || ['open', 'dormant'].includes(item.status))).map(item => this.clone(item));
  }
  async listSerializedPlotThreadCommits(threadId) { return this.clone(this.threadCommits.get(threadId) || []); }
}

const validValidators = () => ({
  timeline: { validateTimeline: async () => ({ valid: true, blockers: [], state: { revisionNumber: 9 } }) },
  episode: { validateSeries: async () => ({ valid: true, blockers: [] }) },
  arc: { validateSeries: async () => ({ valid: true, blockers: [] }) },
  relationship: { validateSeries: async () => ({ valid: true, blockers: [] }) },
  thread: { validateSeries: async () => ({ valid: true, blockers: [] }) }
});

function arcSnapshot(overrides = {}) {
  return {
    id: overrides.id || 'arc_mara', seriesId: overrides.seriesId || 'series_star', characterKey: overrides.characterKey || 'mara',
    displayName: overrides.displayName || 'Mara', arcPhase: overrides.arcPhase || 'investigation', storyStatus: overrides.storyStatus || 'active',
    emotionalState: overrides.emotionalState || 'focused', moralState: overrides.moralState || 'uncertain', physicalCondition: overrides.physicalCondition || 'healthy',
    goals: overrides.goals || ['Find the sender'], motivations: overrides.motivations || ['Protect the harbor'], beliefs: overrides.beliefs || ['The signal is intentional'],
    knowledge: overrides.knowledge || ['The station band is artificial'], secrets: overrides.secrets || ['She copied the forbidden frequency'],
    innerConflicts: overrides.innerConflicts || ['Truth versus safety'], commitments: overrides.commitments || ['Tell Ivo when evidence is verified'], milestones: overrides.milestones || [], notes: '',
    firstEpisodeNumber: overrides.firstEpisodeNumber ?? 1, lastEpisodeNumber: overrides.lastEpisodeNumber ?? 1,
    revisionNumber: overrides.revisionNumber ?? 1, status: overrides.status || 'active'
  };
}

function relationshipSnapshot(overrides = {}) {
  return {
    id: overrides.id || 'rel_mara_ivo', seriesId: overrides.seriesId || 'series_star', sourceCharacterKey: overrides.sourceCharacterKey || 'mara', targetCharacterKey: overrides.targetCharacterKey || 'ivo',
    relationshipLabel: overrides.relationshipLabel || 'ally', relationshipState: overrides.relationshipState || 'Mara trusts Ivo cautiously.', relationshipTags: ['ally'],
    trustScore: overrides.trustScore ?? 60, affinityScore: 50, respectScore: 55, loyaltyScore: 45, fearScore: 0, attractionScore: 5, dependenceScore: 20,
    beliefsAboutTarget: ['Ivo wants the truth'], knowledgeAboutTarget: ['Ivo saw the blackout logs'], secretsKnownAboutTarget: [], obligationsToTarget: [],
    promisesToTarget: ['Share verified evidence'], grievancesAgainstTarget: [], expectationsOfTarget: [], boundariesWithTarget: [], sharedHistory: ['Harbor blackout'], currentTensions: overrides.currentTensions || ['Mara is withholding one detail'], notes: '',
    firstEpisodeNumber: overrides.firstEpisodeNumber ?? 1, lastEpisodeNumber: overrides.lastEpisodeNumber ?? 1, revisionNumber: overrides.revisionNumber ?? 1, status: overrides.status || 'active'
  };
}

function threadSnapshot(overrides = {}) {
  return {
    id: overrides.id || 'thread_signal', seriesId: overrides.seriesId || 'series_star', threadKey: overrides.threadKey || 'lost_signal', title: overrides.title || 'The Lost Signal',
    threadType: overrides.threadType || 'mystery', priority: overrides.priority ?? 90, premise: overrides.premise || 'A repeating signal points to the old station.',
    centralQuestion: overrides.centralQuestion || 'Who sent the signal?', stakes: overrides.stakes || 'The harbor cover-up may be exposed.', currentState: overrides.currentState || 'The signal remains unexplained.',
    openQuestions: overrides.openQuestions || ['Who sent it?'], resolvedQuestions: overrides.resolvedQuestions || [], narrativePromises: overrides.narrativePromises || ['Reveal the origin'],
    establishedClues: overrides.establishedClues || ['Old station frequency'], redHerrings: [], requiredPayoffs: overrides.requiredPayoffs || ['Identify the sender'],
    involvedCharacterKeys: overrides.involvedCharacterKeys || ['mara', 'ivo'], relationshipEdgeKeys: overrides.relationshipEdgeKeys || ['mara->ivo'],
    resolutionSummary: overrides.resolutionSummary || '', notes: '', introducedEpisodeNumber: overrides.introducedEpisodeNumber ?? 1,
    lastAdvancedEpisodeNumber: overrides.lastAdvancedEpisodeNumber ?? 1, resolvedEpisodeNumber: overrides.resolvedEpisodeNumber ?? 0,
    revisionNumber: overrides.revisionNumber ?? 1, status: overrides.status || 'open'
  };
}

async function expectError(promise, code, message) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  check(error && error.code === code, `${message}: ${error?.code || error?.message || 'no error'}`);
  return error;
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js', 'utils/canonical-timeline-v12.js', 'utils/episode-memory-v12.js',
    'utils/character-arc-memory-v12.js', 'utils/relationship-state-graph-v12.js', 'utils/plot-thread-registry-v12.js',
    'utils/narrative-context-resolver-v12.js', 'agents/script-writer-agent.js', 'database/db.js', 'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 10;

  const serviceSource = read('utils/narrative-context-resolver-v12.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(serviceSource.includes("const VERSION = '11.12.7'"), 'Narrative Context Resolver version missing');
  check(serviceSource.includes('stateBeforeTarget') && serviceSource.includes('latest commit strictly before the target episode'), 'historical as-of reconstruction missing');
  check(serviceSource.includes('narrative_context_episode_gap'), 'future episode gap guard missing');
  check(serviceSource.includes('narrative_context_focus_reference_not_found'), 'strict exact focus guard missing');
  check(serviceSource.includes('CONTEXT FINGERPRINT:'), 'context fingerprint missing');
  check(serviceSource.includes('PROVENANCE MANIFEST:'), 'provenance manifest missing');
  check(serviceSource.includes('global prompt budget'), 'global budget policy missing');
  check(!serviceSource.includes('commitSerialized') && !serviceSource.includes('amendSerialized'), 'read-only resolver contains canon persistence calls');
  check(writerSource.includes("require('../utils/narrative-context-resolver-v12')"), 'Script Writer resolver import missing');
  check(writerSource.includes('await this.narrativeContextResolver.resolveForScript(serializedSeriesContext, strategy)'), 'Script Writer resolver call missing');
  check(writerSource.includes('${narrativeContextPrompt}'), 'unified narrative context prompt injection missing');
  check(!writerSource.includes('await this.canonicalTimeline.getScriptContext(serializedSeriesContext)'), 'Script Writer still dumps Canonical Timeline separately');
  check(!writerSource.includes('await this.episodeMemory.getScriptContext(serializedSeriesContext)'), 'Script Writer still dumps Episode Memory separately');
  check(!writerSource.includes('await this.characterArcMemory.getScriptContext(serializedSeriesContext)'), 'Script Writer still dumps Character Arc separately');
  check(!writerSource.includes('await this.relationshipStateGraph.getScriptContext(serializedSeriesContext)'), 'Script Writer still dumps Relationship Graph separately');
  check(!writerSource.includes('await this.plotThreadRegistry.getScriptContext(serializedSeriesContext)'), 'Script Writer still dumps Plot Threads separately');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/narrative-context/resolve', protect"), 'protected Narrative Context resolve API missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTEXT_RESOLVER_ENABLED=true'), 'resolver env toggle missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTEXT_MAX_CHARS=56000'), 'resolver global char budget env missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTEXT_MAX_ITEMS=80'), 'resolver item budget env missing');
  check(envSource.includes('SERIALIZED_NARRATIVE_CONTEXT_STRICT_FOCUS=true'), 'resolver strict-focus env missing');
  check(pkg.scripts?.['test:narrative-context-resolver'] === 'node ../bootstrap/verify-phase11-narrative-context-resolver.js', 'resolver npm test command missing');

  const { NarrativeContextResolverV12, normalizeFocus, normalizeRelationshipEdge } = require(path.join(upstream, 'utils', 'narrative-context-resolver-v12.js'));
  check(normalizeRelationshipEdge(' Mara -> Ivo ') === 'mara->ivo', 'relationship focus normalization failed');
  const normalizedFocus = normalizeFocus({ focus: { characterKeys: ['Mara', 'MARA'], relationshipEdgeKeys: ['Mara -> Ivo'], plotThreadKeys: ['Lost Signal'], objective: 'Reveal harbor signal origin' } });
  check(normalizedFocus.characterKeys.length === 1 && normalizedFocus.characterKeys[0] === 'mara', 'character focus normalization failed');
  check(normalizedFocus.relationshipEdgeKeys[0] === 'mara->ivo' && normalizedFocus.plotThreadKeys[0] === 'lost_signal', 'exact focus key normalization failed');
  check(normalizedFocus.queryTerms.includes('signal') && normalizedFocus.queryTerms.includes('origin'), 'objective token extraction failed');

  const db = new MemoryDb();
  db.seedBible({
    id: 'series_star', namespace: 'default', seriesKey: 'star', title: 'Star Harbor', status: 'active', currentEpisode: 3,
    canonVersion: 2, revisionNumber: 7, premise: 'Investigators trace impossible transmissions through a harbor town.',
    immutableCanon: ['The old station burned before Mara was born.'], worldRules: ['Signals cannot cross the storm wall without a relay.'],
    narrativeRules: ['Never grant a character knowledge they did not learn.'], centralConflicts: ['Truth versus civic stability.'], plannedEnding: 'Expose the relay network.'
  });
  db.seedBible({ id: 'series_other', title: 'Other Story', status: 'active', currentEpisode: 1, canonVersion: 1, revisionNumber: 1, premise: 'Unrelated.' });

  db.seedTimeline({ id: 'evt_signal', seriesId: 'series_star', chronologyIndex: 1000, episodeNumber: 1, eventType: 'discovery', summary: 'Mara confirms the repeating signal is artificial.', participants: ['mara'], locationRefs: ['harbor_station'], causeEventIds: [], consequences: ['Mara begins investigating'], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'confirmed', revisionNumber: 1, status: 'active' });
  db.seedTimeline({ id: 'evt_argument', seriesId: 'series_star', chronologyIndex: 2000, episodeNumber: 2, eventType: 'conflict', summary: 'Mara and Ivo argue over whether to publish the evidence.', participants: ['mara', 'ivo'], locationRefs: ['archive'], causeEventIds: ['evt_signal'], consequences: ['Trust becomes strained'], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'confirmed', revisionNumber: 1, status: 'active' });
  db.seedTimeline({ id: 'evt_rumor', seriesId: 'series_star', chronologyIndex: 2500, episodeNumber: 2, eventType: 'rumor', summary: 'A dockworker claims the council built a secret relay.', participants: ['dockworker'], locationRefs: ['harbor'], causeEventIds: [], consequences: [], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'rumor', revisionNumber: 1, status: 'active' });
  db.seedTimeline({ id: 'evt_reveal', seriesId: 'series_star', chronologyIndex: 3000, episodeNumber: 3, eventType: 'reveal', summary: 'Episode three reveals the caretaker sent the signal.', participants: ['mara'], locationRefs: ['harbor_station'], causeEventIds: ['evt_signal'], consequences: ['The sender mystery closes'], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'confirmed', revisionNumber: 1, status: 'active' });
  db.seedTimeline({ id: 'evt_other', seriesId: 'series_other', chronologyIndex: 1000, episodeNumber: 1, eventType: 'other', summary: 'Other universe event.', participants: [], locationRefs: [], causeEventIds: [], consequences: [], mustFollowEventIds: [], mustPrecedeEventIds: [], truthStatus: 'confirmed', revisionNumber: 1, status: 'active' });

  db.seedMemory({ id: 'mem1', seriesId: 'series_star', episodeNumber: 1, title: 'The Signal', summary: 'Mara finds the signal.', discoveries: ['Artificial signal'], establishedFacts: ['The signal repeats every night'], unresolvedQuestions: ['Who sent it?'], narrativePromises: ['Return to the old station'], cliffhangers: ['A second pulse arrives'], timelineEventIds: ['evt_signal'], revisionNumber: 1, status: 'finalized' });
  db.seedMemory({ id: 'mem2', seriesId: 'series_star', episodeNumber: 2, title: 'The Archive', summary: 'Mara and Ivo clash over the evidence.', discoveries: ['Archive logs were altered'], establishedFacts: ['Ivo saw the logs'], unresolvedQuestions: ['What did the council erase?'], narrativePromises: ['Revisit the council archive'], cliffhangers: ['A caretaker badge is found'], timelineEventIds: ['evt_argument', 'evt_rumor'], revisionNumber: 1, status: 'finalized' });
  db.seedMemory({ id: 'mem3', seriesId: 'series_star', episodeNumber: 3, title: 'The Caretaker', summary: 'The sender is revealed.', discoveries: ['Caretaker sent the signal'], establishedFacts: ['Caretaker is the sender'], unresolvedQuestions: [], narrativePromises: [], cliffhangers: [], timelineEventIds: ['evt_reveal'], revisionNumber: 1, status: 'finalized' });
  db.seedMemory({ id: 'other_mem', seriesId: 'series_other', episodeNumber: 1, title: 'Other', summary: 'Other universe memory.', timelineEventIds: ['evt_other'], revisionNumber: 1, status: 'finalized' });

  const mara1 = arcSnapshot({ lastEpisodeNumber: 1, revisionNumber: 1, emotionalState: 'curious', knowledge: ['The signal is artificial'] });
  const mara2 = arcSnapshot({ lastEpisodeNumber: 2, revisionNumber: 2, emotionalState: 'frustrated with Ivo', knowledge: ['The signal is artificial', 'Archive logs were altered'] });
  const mara3 = arcSnapshot({ lastEpisodeNumber: 3, revisionNumber: 3, emotionalState: 'relieved after identifying the sender', knowledge: ['The caretaker sent the signal'] });
  db.seedArc(mara3, [
    { episodeNumber: 1, arcRevisionNumber: 1, afterSnapshot: mara1 },
    { episodeNumber: 2, arcRevisionNumber: 2, afterSnapshot: mara2 },
    { episodeNumber: 3, arcRevisionNumber: 3, afterSnapshot: mara3 }
  ]);
  const ivo1 = arcSnapshot({ id: 'arc_ivo', characterKey: 'ivo', displayName: 'Ivo', lastEpisodeNumber: 1, revisionNumber: 1, emotionalState: 'guarded', knowledge: ['Mara found a signal'] });
  const ivo2 = arcSnapshot({ id: 'arc_ivo', characterKey: 'ivo', displayName: 'Ivo', lastEpisodeNumber: 2, revisionNumber: 2, emotionalState: 'angry after the archive argument', knowledge: ['Mara found a signal', 'Archive logs were altered'] });
  db.seedArc(ivo2, [
    { episodeNumber: 1, arcRevisionNumber: 1, afterSnapshot: ivo1 },
    { episodeNumber: 2, arcRevisionNumber: 2, afterSnapshot: ivo2 }
  ]);

  const rel1 = relationshipSnapshot({ lastEpisodeNumber: 1, revisionNumber: 1, relationshipState: 'Mara trusts Ivo cautiously.', trustScore: 60 });
  const rel2 = relationshipSnapshot({ lastEpisodeNumber: 2, revisionNumber: 2, relationshipState: 'Mara trusts Ivo but resents the archive argument.', trustScore: 45, currentTensions: ['Archive publication dispute'] });
  const rel3 = relationshipSnapshot({ lastEpisodeNumber: 3, revisionNumber: 3, relationshipState: 'Mara fully reconciles with Ivo after the sender reveal.', trustScore: 85, currentTensions: [] });
  db.seedRelationship(rel3, [
    { episodeNumber: 1, relationshipRevisionNumber: 1, afterSnapshot: rel1 },
    { episodeNumber: 2, relationshipRevisionNumber: 2, afterSnapshot: rel2 },
    { episodeNumber: 3, relationshipRevisionNumber: 3, afterSnapshot: rel3 }
  ]);

  const signal1 = threadSnapshot({ lastAdvancedEpisodeNumber: 1, revisionNumber: 1, status: 'open', currentState: 'The sender is unknown.' });
  const signal2 = threadSnapshot({ lastAdvancedEpisodeNumber: 2, revisionNumber: 2, status: 'dormant', currentState: 'The signal investigation pauses while Mara studies the archive.' });
  const signal3 = threadSnapshot({ lastAdvancedEpisodeNumber: 3, revisionNumber: 3, status: 'resolved', currentState: 'The caretaker is identified.', openQuestions: [], requiredPayoffs: [], narrativePromises: [], resolutionSummary: 'Episode three reveals the caretaker sent the signal.', resolvedEpisodeNumber: 3 });
  db.seedThread(signal3, [
    { episodeNumber: 1, threadRevisionNumber: 1, timelineEventIds: ['evt_signal'], afterSnapshot: signal1 },
    { episodeNumber: 2, threadRevisionNumber: 2, timelineEventIds: ['evt_argument'], afterSnapshot: signal2 },
    { episodeNumber: 3, threadRevisionNumber: 3, timelineEventIds: ['evt_reveal'], afterSnapshot: signal3 }
  ]);
  const council2 = threadSnapshot({ id: 'thread_council', threadKey: 'council_coverup', title: 'Council Cover-up', threadType: 'main', priority: 95, premise: 'The council altered archive records.', centralQuestion: 'What did the council erase?', currentState: 'One altered log is verified.', openQuestions: ['What did the council erase?'], narrativePromises: ['Confront the council archive'], requiredPayoffs: ['Explain the altered logs'], lastAdvancedEpisodeNumber: 2, revisionNumber: 1, status: 'open' });
  db.seedThread(council2, [
    { episodeNumber: 2, threadRevisionNumber: 1, timelineEventIds: ['evt_argument', 'evt_rumor'], afterSnapshot: council2 }
  ]);

  const service = new NarrativeContextResolverV12(db, { enabled: true, maxPromptChars: 24000, maxItems: 40, strictFocus: true, validators: validValidators() });
  const historicalContext = { active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { episodeNumber: 3 } };
  const historical = await service.resolveContext(historicalContext, { focus: { characterKeys: ['mara'], relationshipEdgeKeys: ['mara->ivo'], plotThreadKeys: ['lost_signal'], timelineEventIds: ['evt_signal'], locationRefs: ['harbor_station'], objective: 'Continue the signal mystery without revealing future information.' } });
  check(historical.active && historical.targetEpisode === 3, 'historical target context failed');
  check(historical.promptContext.includes('NARRATIVE CONTEXT RESOLVER V11.12.7'), 'resolver packet header missing');
  check(historical.promptContext.includes('PLOT THREAD lost_signal'), 'focused historical plot thread missing');
  check(historical.promptContext.includes('Status: dormant'), 'historical plot thread was not reconstructed as-of episode two');
  check(!historical.promptContext.includes('Episode three reveals the caretaker sent the signal.'), 'future plot-thread resolution leaked into historical target');
  check(historical.promptContext.includes('frustrated with Ivo') && !historical.promptContext.includes('relieved after identifying the sender'), 'future Character Arc state leaked into historical target');
  check(historical.promptContext.includes('resents the archive argument') && !historical.promptContext.includes('fully reconciles'), 'future Relationship state leaked into historical target');
  check(!historical.promptContext.includes('TIMELINE evt_reveal'), 'target-episode Timeline event leaked into context');
  check(!historical.promptContext.includes('EPISODE MEMORY E3'), 'target-episode Episode Memory leaked into context');
  check(historical.promptContext.includes('TIMELINE evt_signal'), 'explicit prior Timeline event missing');
  check(historical.promptContext.includes('PROVENANCE MANIFEST:'), 'provenance manifest not rendered');
  check(historical.selected.some(item => item.type === 'plot_thread' && item.key === 'lost_signal' && item.reasons.includes('explicit_thread')), 'explicit focus did not dominate plot-thread score');
  check(historical.selected.some(item => item.type === 'character_arc' && item.key === 'mara' && item.reasons.includes('explicit_character')), 'explicit character focus not selected');
  check(historical.promptContext.length <= 24000, 'global Narrative Context character budget exceeded');
  check(db.mutationCalls === 0, 'resolver mutated canon during read-only resolution');

  const repeat = await service.resolveContext(historicalContext, { focus: { characterKeys: ['mara'], relationshipEdgeKeys: ['mara->ivo'], plotThreadKeys: ['lost_signal'], timelineEventIds: ['evt_signal'], locationRefs: ['harbor_station'], objective: 'Continue the signal mystery without revealing future information.' } });
  check(repeat.fingerprint === historical.fingerprint, 'identical canonical inputs did not produce deterministic context fingerprint');
  check(repeat.promptContext === historical.promptContext, 'identical canonical inputs did not produce deterministic packet text');

  const nextEpisodeContext = { active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { episodeNumber: 4 } };
  const nextEpisode = await service.resolveContext(nextEpisodeContext, {});
  check(nextEpisode.promptContext.includes('PLOT THREAD council_coverup'), 'open current plot obligation missing from next-episode context');
  check(!nextEpisode.promptContext.includes('PLOT THREAD lost_signal'), 'resolved terminal thread leaked into default next-episode context');
  check(nextEpisode.promptContext.includes('TIMELINE evt_reveal'), 'finalized episode-three Timeline event missing from episode-four context');
  check(nextEpisode.promptContext.includes('EPISODE MEMORY E3'), 'finalized episode-three handoff missing from episode-four context');

  const explicitResolved = await service.resolveContext(nextEpisodeContext, { focus: { plotThreadKeys: ['lost_signal'] } });
  check(explicitResolved.promptContext.includes('PLOT THREAD lost_signal') && explicitResolved.promptContext.includes('Status: resolved'), 'explicit terminal-thread focus should be available as canonical history');

  const missing = await expectError(service.resolveContext(nextEpisodeContext, { focus: { characterKeys: ['ghost'] } }), 'narrative_context_focus_reference_not_found', 'missing exact focus must fail closed');
  check(missing.missing.some(item => item.type === 'character_arc' && item.key === 'ghost'), 'missing focus diagnostics did not identify exact character key');
  await expectError(service.resolveContext({ active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { episodeNumber: 5 } }, {}), 'narrative_context_episode_gap', 'episode gap must fail closed');
  await expectError(service.resolveContext(historicalContext, { episodeNumber: 2 }), 'narrative_context_episode_binding_conflict', 'binding/request episode mismatch must fail closed');

  const invalidValidators = validValidators();
  invalidValidators.relationship = { validateSeries: async () => ({ valid: false, blockers: [{ code: 'relationship_current_state_drift' }] }) };
  const invalidService = new NarrativeContextResolverV12(db, { enabled: true, validators: invalidValidators });
  const invalidError = await expectError(invalidService.resolveContext(nextEpisodeContext, {}), 'narrative_context_source_invalid', 'invalid source layer must block resolution');
  check(invalidError.source === 'relationship' && invalidError.blockers[0].code === 'relationship_current_state_drift', 'source validation diagnostics missing');

  const other = new NarrativeContextResolverV12(db, { enabled: true, maxPromptChars: 24000, validators: validValidators() });
  const otherResult = await other.resolveContext({ active: true, bible: await db.getSerializedSeriesBible('series_other'), binding: { episodeNumber: 2 } }, {});
  check(!otherResult.promptContext.includes('lost_signal') && !otherResult.promptContext.includes('Mara'), 'Narrative Context leaked across series');

  const disabled = new NarrativeContextResolverV12(db, { enabled: false, validators: validValidators() });
  const disabledResult = await disabled.resolveContext(nextEpisodeContext, {});
  check(disabledResult.active === false && disabledResult.promptContext === '', 'disabled resolver should return inactive context');

  console.log(`Phase 11.12.7 Narrative Context Resolver verification passed (${checks} checks).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
