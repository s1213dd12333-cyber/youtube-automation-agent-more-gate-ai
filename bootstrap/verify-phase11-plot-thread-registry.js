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
  constructor(snapshotThread) {
    this.snapshotThread = snapshotThread;
    this.bibles = new Map();
    this.memories = new Map();
    this.arcs = new Map();
    this.relationships = new Map();
    this.threads = new Map();
    this.commits = [];
    this.revisions = [];
    this.seq = 0;
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  id(prefix) { this.seq += 1; return `${prefix}_${this.seq}`; }
  memoryKey(seriesId, episodeNumber) { return `${seriesId}:${Number(episodeNumber)}`; }
  arcKey(seriesId, characterKey) { return `${seriesId}:${characterKey}`; }
  relationshipKey(seriesId, sourceKey, targetKey) { return `${seriesId}:${sourceKey}->${targetKey}`; }
  threadKey(seriesId, threadKey) { return `${seriesId}:${threadKey}`; }
  seedBible(value) { this.bibles.set(value.id, this.clone(value)); }
  seedMemory(value) { this.memories.set(this.memoryKey(value.seriesId, value.episodeNumber), this.clone(value)); }
  seedArc(value) { this.arcs.set(this.arcKey(value.seriesId, value.characterKey), this.clone(value)); }
  seedRelationship(value) { this.relationships.set(this.relationshipKey(value.seriesId, value.sourceCharacterKey, value.targetCharacterKey), this.clone(value)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async getSerializedEpisodeMemory(seriesId, episodeNumber) { return this.clone(this.memories.get(this.memoryKey(seriesId, episodeNumber)) || null); }
  async getSerializedCharacterArc(seriesId, characterKey) { return this.clone(this.arcs.get(this.arcKey(seriesId, characterKey)) || null); }
  async getSerializedRelationshipState(seriesId, sourceKey, targetKey) { return this.clone(this.relationships.get(this.relationshipKey(seriesId, sourceKey, targetKey)) || null); }
  async getSerializedPlotThread(seriesId, threadKey) { return this.clone(this.threads.get(this.threadKey(seriesId, threadKey)) || null); }
  async getSerializedPlotThreadById(id) { return this.clone([...this.threads.values()].find(row => row.id === id) || null); }
  async listSerializedPlotThreads(seriesId, _limit = 500, includeTerminal = false) {
    return [...this.threads.values()]
      .filter(row => row.seriesId === seriesId && (includeTerminal || row.status === 'open' || row.status === 'dormant'))
      .sort((a, b) => b.priority - a.priority || b.lastAdvancedEpisodeNumber - a.lastAdvancedEpisodeNumber || a.threadKey.localeCompare(b.threadKey))
      .map(row => this.clone(row));
  }
  async listSerializedPlotThreadRevisions(plotThreadId) { return this.revisions.filter(row => row.plotThreadId === plotThreadId).map(row => this.clone(row)); }
  async listSerializedPlotThreadCommits(plotThreadId) { return this.commits.filter(row => row.plotThreadId === plotThreadId).map(row => this.clone(row)); }
  async getLatestSerializedPlotThreadCommit(plotThreadId) {
    return this.clone(this.commits.filter(row => row.plotThreadId === plotThreadId)
      .sort((a, b) => b.threadRevisionNumber - a.threadRevisionNumber)[0] || null);
  }
  async getSerializedPlotThreadEpisodeCommit(plotThreadId, episodeNumber, commitKind = 'episode_commit') {
    return this.clone(this.commits.find(row => row.plotThreadId === plotThreadId && Number(row.episodeNumber) === Number(episodeNumber) && row.commitKind === commitKind) || null);
  }
  async commitSerializedPlotThreadsAtomic(input = {}) {
    const memory = this.memories.get(this.memoryKey(input.seriesId, input.episodeNumber));
    if (!memory || memory.id !== input.episodeMemoryId || memory.status !== 'finalized') throw new Error('finalized_episode_memory_required');
    const allowed = new Set(memory.timelineEventIds || []);
    const staged = [];
    for (const item of input.updates) {
      const thread = item.thread;
      const key = this.threadKey(input.seriesId, thread.threadKey);
      const existing = this.threads.get(key) || null;
      if (existing && ['resolved', 'cancelled'].includes(existing.status)) throw new Error('plot_thread_terminal_state_is_immutable');
      const currentRevision = Number(existing?.revisionNumber || 0);
      if (Number(item.expectedRevision || 0) !== currentRevision) throw new Error('plot_thread_revision_conflict');
      const latest = existing ? await this.getLatestSerializedPlotThreadCommit(existing.id) : null;
      if (latest && Number(latest.episodeNumber) > Number(input.episodeNumber)) throw new Error('plot_thread_historical_insert_has_later_commit');
      if (existing && await this.getSerializedPlotThreadEpisodeCommit(existing.id, input.episodeNumber, 'episode_commit')) throw new Error('plot_thread_episode_already_committed');
      if ((item.relevantTimelineEventIds || []).some(id => !allowed.has(id))) throw new Error('plot_thread_timeline_reference_outside_episode_memory');
      for (const characterKey of thread.involvedCharacterKeys || []) {
        const arc = this.arcs.get(this.arcKey(input.seriesId, characterKey));
        if (!arc) throw new Error('plot_thread_character_arc_not_found');
        if (Number(arc.firstEpisodeNumber || 0) > Number(input.episodeNumber)) throw new Error('plot_thread_character_not_introduced_yet');
      }
      for (const edgeKey of thread.relationshipEdgeKeys || []) {
        const [source, target] = edgeKey.split('->');
        const relationship = this.relationships.get(this.relationshipKey(input.seriesId, source, target));
        if (!relationship) throw new Error('plot_thread_relationship_edge_not_found');
        if (Number(relationship.firstEpisodeNumber || 0) > Number(input.episodeNumber)) throw new Error('plot_thread_relationship_not_established_yet');
      }
      const next = this.clone(thread);
      next.id = existing?.id || next.id || this.id('thread');
      next.seriesId = input.seriesId;
      next.introducedEpisodeNumber = existing?.introducedEpisodeNumber || Number(input.episodeNumber);
      next.lastAdvancedEpisodeNumber = Number(input.episodeNumber);
      next.resolvedEpisodeNumber = ['resolved', 'cancelled'].includes(next.status) ? Number(input.episodeNumber) : 0;
      next.revisionNumber = currentRevision + 1;
      next.createdAt = existing?.createdAt || new Date().toISOString();
      next.updatedAt = new Date().toISOString();
      staged.push({ key, next, before: existing ? this.snapshotThread(existing) : {}, after: this.snapshotThread(next), item });
    }
    const outThreads = [], outCommits = [];
    for (const stage of staged) {
      this.threads.set(stage.key, this.clone(stage.next));
      this.revisions.push({ id: this.id('threadrev'), plotThreadId: stage.next.id, seriesId: input.seriesId,
        episodeNumber: Number(input.episodeNumber), revisionNumber: stage.next.revisionNumber, snapshot: stage.after,
        changeKind: 'episode_commit', changeReason: input.reason, actor: input.actor });
      const commit = { id: this.id('threadcommit'), seriesId: input.seriesId, plotThreadId: stage.next.id,
        episodeMemoryId: memory.id, episodeNumber: Number(input.episodeNumber), threadRevisionNumber: stage.next.revisionNumber,
        commitKind: 'episode_commit', timelineEventIds: this.clone(stage.item.relevantTimelineEventIds || []),
        beforeSnapshot: stage.before, afterSnapshot: stage.after, changeSummary: stage.item.changeSummary || '',
        reason: input.reason, actor: input.actor };
      this.commits.push(commit); outThreads.push(this.clone(stage.next)); outCommits.push(this.clone(commit));
    }
    return { threads: outThreads, commits: outCommits };
  }
  async amendSerializedPlotThreadAtomic(input = {}) {
    const key = this.threadKey(input.seriesId, input.thread.threadKey);
    const existing = this.threads.get(key);
    if (!existing) throw new Error('plot_thread_not_found');
    if (Number(input.expectedRevision) !== Number(existing.revisionNumber)) throw new Error('plot_thread_revision_conflict');
    const latest = await this.getLatestSerializedPlotThreadCommit(existing.id);
    if (!latest || Number(latest.episodeNumber) !== Number(input.episodeNumber)) throw new Error('historical_plot_thread_amendment_blocked_by_later_state');
    const memory = this.memories.get(this.memoryKey(input.seriesId, input.episodeNumber));
    if (!memory || memory.id !== input.episodeMemoryId || memory.status !== 'finalized') throw new Error('finalized_episode_memory_required');
    const allowed = new Set(memory.timelineEventIds || []);
    if ((input.relevantTimelineEventIds || []).some(id => !allowed.has(id))) throw new Error('plot_thread_timeline_reference_outside_episode_memory');
    const next = this.clone(input.thread);
    next.revisionNumber = Number(existing.revisionNumber) + 1;
    next.introducedEpisodeNumber = existing.introducedEpisodeNumber;
    next.lastAdvancedEpisodeNumber = existing.lastAdvancedEpisodeNumber;
    next.createdAt = existing.createdAt;
    next.updatedAt = new Date().toISOString();
    const before = this.snapshotThread(existing), after = this.snapshotThread(next);
    this.threads.set(key, this.clone(next));
    this.revisions.push({ id: this.id('threadrev'), plotThreadId: next.id, seriesId: input.seriesId,
      episodeNumber: Number(input.episodeNumber), revisionNumber: next.revisionNumber, snapshot: after,
      changeKind: 'amendment', changeReason: input.reason, actor: input.actor });
    const commit = { id: this.id('threadcommit'), seriesId: input.seriesId, plotThreadId: next.id,
      episodeMemoryId: memory.id, episodeNumber: Number(input.episodeNumber), threadRevisionNumber: next.revisionNumber,
      commitKind: 'amendment', timelineEventIds: this.clone(input.relevantTimelineEventIds || []), beforeSnapshot: before,
      afterSnapshot: after, changeSummary: input.changeSummary || '', reason: input.reason, actor: input.actor };
    this.commits.push(commit);
    return { thread: this.clone(next), commit: this.clone(commit) };
  }
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js', 'utils/canonical-timeline-v12.js', 'utils/episode-memory-v12.js',
    'utils/character-arc-memory-v12.js', 'utils/relationship-state-graph-v12.js', 'utils/plot-thread-registry-v12.js',
    'agents/script-writer-agent.js', 'database/db.js', 'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 9;

  const serviceSource = read('utils/plot-thread-registry-v12.js');
  const dbSource = read('database/db.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_plot_threads'), 'plot thread table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_plot_thread_revisions'), 'plot thread revision table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_plot_thread_episode_commits'), 'plot thread commit table missing');
  check(dbSource.includes('UNIQUE(series_id, thread_key)'), 'plot thread unique identity missing');
  check(dbSource.includes("CHECK(status IN ('open', 'dormant', 'resolved', 'cancelled'))"), 'plot thread lifecycle constraint missing');
  check(dbSource.includes('commitSerializedPlotThreadsAtomic') && dbSource.includes('amendSerializedPlotThreadAtomic'), 'atomic plot thread DB methods missing');
  check(dbSource.includes('BEGIN IMMEDIATE') && dbSource.includes('plot_thread_revision_conflict'), 'plot thread transaction/concurrency guard missing');
  check(dbSource.includes('plot_thread_timeline_reference_outside_episode_memory'), 'plot thread Timeline subset enforcement missing');
  check(dbSource.includes('plot_thread_character_arc_not_found') && dbSource.includes('plot_thread_relationship_edge_not_found'), 'plot thread reference enforcement missing');
  check(writerSource.includes("require('../utils/plot-thread-registry-v12')"), 'Script Writer Plot Thread Registry import missing');
  check(writerSource.includes('await this.plotThreadRegistry.getScriptContext(serializedSeriesContext)'), 'Script Writer Plot Thread Registry lookup missing');
  check(writerSource.includes('${plotThreadPrompt}'), 'Script Writer Plot Thread Registry prompt injection missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/plot-threads/commit', protect"), 'protected plot thread commit route missing');
  check(indexSource.includes("this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber/plot-threads/:threadKey', protect"), 'protected plot thread amendment route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/plot-threads/validate', protect"), 'protected plot thread validation route missing');
  check(envSource.includes('SERIALIZED_PLOT_THREAD_REGISTRY_ENABLED=true'), 'Plot Thread Registry env toggle missing');
  check(envSource.includes('SERIALIZED_PLOT_THREAD_PROMPT_LIMIT=40'), 'Plot Thread Registry prompt limit missing');
  check(pkg.scripts?.['test:plot-thread-registry'] === 'node ../bootstrap/verify-phase11-plot-thread-registry.js', 'Plot Thread Registry npm test command missing');
  check(serviceSource.includes('Dormant means intentionally inactive for now, not resolved.'), 'dormant-thread prompt safety missing');
  check(serviceSource.includes('plot_thread_terminal_state_is_immutable'), 'terminal thread guard missing');
  check(serviceSource.includes('plot_thread_backfill_requires_explicit_approval'), 'plot thread backfill guard missing');

  const { PlotThreadRegistryServiceV12, normalizeThread, snapshotThread, buildPromptContext, slug, normalizeRelationshipEdge } = require(path.join(upstream, 'utils', 'plot-thread-registry-v12.js'));
  check(slug('  The Lost Signal ') === 'the_lost_signal', 'plot thread slug normalization failed');
  check(normalizeRelationshipEdge(' Mara -> Ivo ') === 'mara->ivo', 'relationship edge normalization failed');
  const normalized = normalizeThread({ threadKey: 'Signal', title: 'Signal', priority: 999, openQuestions: ['Who sent it?', 'who sent it?'], involvedCharacterKeys: ['Mara', 'MARA'] });
  check(normalized.priority === 100, 'plot thread priority bound failed');
  check(normalized.openQuestions.length === 1 && normalized.involvedCharacterKeys.length === 1, 'plot thread array normalization failed');

  const db = new MemoryDb(snapshotThread);
  db.seedBible({ id: 'series_star', status: 'active', currentEpisode: 2, revisionNumber: 4 });
  db.seedBible({ id: 'series_other', status: 'active', currentEpisode: 1, revisionNumber: 2 });
  db.seedMemory({ id: 'mem1', seriesId: 'series_star', episodeNumber: 1, status: 'finalized', timelineEventIds: ['evt_signal', 'evt_lock'] });
  db.seedMemory({ id: 'mem2', seriesId: 'series_star', episodeNumber: 2, status: 'finalized', timelineEventIds: ['evt_argument', 'evt_rescue'] });
  db.seedMemory({ id: 'other_mem1', seriesId: 'series_other', episodeNumber: 1, status: 'finalized', timelineEventIds: [] });
  db.seedArc({ id: 'arc_mara', seriesId: 'series_star', characterKey: 'mara', firstEpisodeNumber: 1, lastEpisodeNumber: 2, status: 'active' });
  db.seedArc({ id: 'arc_ivo', seriesId: 'series_star', characterKey: 'ivo', firstEpisodeNumber: 1, lastEpisodeNumber: 2, status: 'active' });
  db.seedArc({ id: 'other_arc', seriesId: 'series_other', characterKey: 'mara', firstEpisodeNumber: 1, lastEpisodeNumber: 1, status: 'active' });
  db.seedRelationship({ id: 'rel_mara_ivo', seriesId: 'series_star', sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', firstEpisodeNumber: 1, lastEpisodeNumber: 2, status: 'active' });
  const service = new PlotThreadRegistryServiceV12(db, { enabled: true, maxPromptThreads: 40 });

  const noKey = await service.commitEpisodeThreads('series_star', 1, [{ title: 'Missing key' }], { actor: 'showrunner', reason: 'Reject malformed plot thread.' });
  check(noKey.status === 'invalid' && noKey.reason === 'plot_thread_key_required', 'missing thread key must fail structurally');
  const duplicate = await service.commitEpisodeThreads('series_star', 1, [{ threadKey: 'x', title: 'X' }, { threadKey: 'X', title: 'X again' }], { actor: 'showrunner', reason: 'Reject duplicate thread batch.' });
  check(duplicate.status === 'conflict' && duplicate.reason === 'duplicate_plot_thread_key_in_commit', 'duplicate thread key in batch must fail');
  const future = await service.commitEpisodeThreads('series_star', 3, [{ threadKey: 'future', title: 'Future' }], { actor: 'showrunner', reason: 'Reject future episode state.' });
  check(future.status === 'conflict' && future.reason === 'finalized_episode_memory_required', 'unfinalized episode must not mutate Plot Thread Registry');
  const noBackfill = await service.commitEpisodeThreads('series_star', 1, [{ threadKey: 'signal', title: 'The Lost Signal' }], { actor: 'showrunner', reason: 'Historical import without approval.' });
  check(noBackfill.status === 'conflict' && noBackfill.reason === 'plot_thread_backfill_requires_explicit_approval', 'historical plot thread commit must require explicit backfill');
  const missingCharacter = await service.commitEpisodeThreads('series_star', 1, [{ threadKey: 'ghost', title: 'Ghost', involvedCharacterKeys: ['ghost'] }], { actor: 'showrunner', reason: 'Reject missing character reference.', allowBackfill: true });
  check(missingCharacter.status === 'conflict' && missingCharacter.reason === 'plot_thread_character_arc_not_found', 'plot thread character ref must resolve same-series Character Arc');
  const missingRelationship = await service.commitEpisodeThreads('series_star', 1, [{ threadKey: 'bad_rel', title: 'Bad relationship', relationshipEdgeKeys: ['ivo->mara'] }], { actor: 'showrunner', reason: 'Reject missing relationship edge.', allowBackfill: true });
  check(missingRelationship.status === 'conflict' && missingRelationship.reason === 'plot_thread_relationship_edge_not_found', 'plot thread relationship edge must resolve exact directed edge');
  const badTimeline = await service.commitEpisodeThreads('series_star', 1, [{ threadKey: 'bad_timeline', title: 'Bad Timeline', relevantTimelineEventIds: ['evt_future'] }], { actor: 'showrunner', reason: 'Reject event outside Episode Memory.', allowBackfill: true });
  check(badTimeline.status === 'conflict' && badTimeline.reason === 'plot_thread_timeline_reference_outside_episode_memory', 'plot thread Timeline refs must be subset of Episode Memory');

  const first = await service.commitEpisodeThreads('series_star', 1, [{
    threadKey: 'lost_signal', title: 'The Lost Signal', threadType: 'mystery', priority: 90,
    premise: 'A repeating transmission points to a sealed harbor station.', centralQuestion: 'Who is transmitting and why?',
    stakes: 'Following the signal may expose the council cover-up.', currentState: 'Mara and Ivo confirmed the signal is artificial.',
    openQuestions: ['Who sent the signal?', 'Why was the station sealed?'], narrativePromises: ['Reveal the origin of the signal'],
    establishedClues: ['The frequency matches the old station band'], redHerrings: ['The fishing fleet appears responsible'],
    requiredPayoffs: ['Identify the sender'], involvedCharacterKeys: ['mara', 'ivo'], relationshipEdgeKeys: ['mara->ivo'],
    relevantTimelineEventIds: ['evt_signal'], changeSummary: 'Signal mystery becomes a tracked plot thread.'
  }], { actor: 'showrunner', reason: 'Episode one plot thread approved.', allowBackfill: true });
  check(first.status === 'committed' && first.threads[0].revisionNumber === 1, 'initial plot thread commit failed');
  check(first.threads[0].introducedEpisodeNumber === 1 && first.threads[0].lastAdvancedEpisodeNumber === 1, 'plot thread episode coordinates incorrect');

  const beforeBadBatchCount = (await db.listSerializedPlotThreads('series_star', 500, true)).length;
  const badBatch = await service.commitEpisodeThreads('series_star', 2, [
    { threadKey: 'harbor_map', title: 'Harbor Map', involvedCharacterKeys: ['mara'] },
    { threadKey: 'invalid_ref', title: 'Invalid Ref', involvedCharacterKeys: ['ghost'] }
  ], { actor: 'showrunner', reason: 'Reject atomic batch with invalid thread.' });
  check(badBatch.status === 'conflict' && badBatch.reason === 'plot_thread_character_arc_not_found', 'invalid multi-thread batch must fail validation');
  check((await db.listSerializedPlotThreads('series_star', 500, true)).length === beforeBadBatchCount, 'failed plot thread batch partially mutated registry');

  const missingResolution = await service.commitEpisodeThreads('series_star', 2, [{ threadKey: 'instant_end', title: 'Instant End', status: 'resolved' }], { actor: 'showrunner', reason: 'Reject ungrounded resolution.' });
  check(missingResolution.status === 'invalid' && missingResolution.reason === 'plot_thread_resolution_summary_required', 'resolved thread requires resolution summary');

  const second = await service.commitEpisodeThreads('series_star', 2, [
    { threadKey: 'lost_signal', title: 'The Lost Signal', expectedRevision: 1, status: 'resolved', priority: 90,
      currentState: 'Mara identifies the station caretaker as the sender.', openQuestions: [], resolvedQuestions: ['Who sent the signal?'],
      narrativePromises: [], establishedClues: ['The frequency matches the old station band', 'The caretaker encoded the old call sign'],
      requiredPayoffs: [], involvedCharacterKeys: ['mara', 'ivo'], relationshipEdgeKeys: ['mara->ivo'],
      resolutionSummary: 'The caretaker is revealed as the sender and the origin mystery is closed.', relevantTimelineEventIds: ['evt_rescue'],
      changeSummary: 'Episode two resolves the signal mystery.' },
    { threadKey: 'council_coverup', title: 'Council Cover-up', threadType: 'main', priority: 95, status: 'open',
      premise: 'Evidence points to the council suppressing historical transmissions.', centralQuestion: 'What did the council hide?',
      stakes: 'Exposure could destabilize the harbor government.', currentState: 'The protagonists now possess one verified clue.',
      openQuestions: ['What did the council hide?'], narrativePromises: ['Return to the council evidence'], requiredPayoffs: ['Confront the council record'],
      involvedCharacterKeys: ['mara', 'ivo'], relationshipEdgeKeys: ['mara->ivo'], relevantTimelineEventIds: ['evt_argument'],
      changeSummary: 'A larger cover-up thread emerges.' }
  ], { actor: 'showrunner', reason: 'Episode two thread lifecycle approved.' });
  check(second.status === 'committed' && second.threads.length === 2, 'episode-two atomic plot thread commit failed');
  const resolved = await db.getSerializedPlotThread('series_star', 'lost_signal');
  check(resolved.status === 'resolved' && resolved.resolvedEpisodeNumber === 2 && resolved.revisionNumber === 2, 'plot thread resolution state incorrect');

  const terminalWrite = await service.commitEpisodeThreads('series_star', 2, [{ threadKey: 'lost_signal', title: 'The Lost Signal', expectedRevision: 2, status: 'open' }], { actor: 'showrunner', reason: 'Attempt to reopen terminal thread.' });
  check(terminalWrite.status === 'conflict' && terminalWrite.reason === 'plot_thread_terminal_state_is_immutable', 'terminal thread must not reopen through ordinary commit');
  const oldAmendment = await service.amendEpisodeThread('series_star', 'lost_signal', 1, { allowAmendment: true, title: 'Old edit' }, { actor: 'showrunner', reason: 'Attempt historical amendment.', allowAmendment: true, expectedRevision: 2 });
  check(oldAmendment.status === 'conflict' && oldAmendment.reason === 'historical_plot_thread_amendment_blocked_by_later_state', 'older plot thread state must not be amended after later state');
  const noApproval = await service.amendEpisodeThread('series_star', 'lost_signal', 2, { resolutionSummary: 'Correction text.' }, { actor: 'showrunner', reason: 'Correct latest thread resolution.', expectedRevision: 2 });
  check(noApproval.status === 'amendment_required' && noApproval.reason === 'plot_thread_history_is_append_only', 'plot thread amendment must require explicit approval');
  const amended = await service.amendEpisodeThread('series_star', 'lost_signal', 2, {
    resolutionSummary: 'The caretaker is confirmed as the sender, while the council cover-up remains a separate open thread.',
    allowAmendment: true, changeSummary: 'Clarify scope of the resolved mystery.', relevantTimelineEventIds: ['evt_rescue']
  }, { actor: 'showrunner', reason: 'Correct approved thread resolution scope.', allowAmendment: true, expectedRevision: 2 });
  check(amended.status === 'amended' && amended.thread.revisionNumber === 3, 'latest plot thread amendment failed');

  const validation = await service.validateSeries('series_star');
  check(validation.valid && validation.threadCount === 2, `valid Plot Thread Registry rejected: ${JSON.stringify(validation.blockers)}`);
  const context = await service.getScriptContext({ active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { episodeNumber: 3 } });
  check(context.active && context.threads.length === 1 && context.threads[0].threadKey === 'council_coverup', 'prompt must inject only open/dormant threads');
  check(context.promptContext.includes('PLOT THREAD council_coverup') && !context.promptContext.includes('PLOT THREAD lost_signal'), 'resolved thread leaked into active prompt');
  check(context.promptContext.includes('Script generation is read-only.'), 'plot thread read-only prompt safety missing');
  check(context.promptContext.length <= 42000, 'Plot Thread Registry prompt exceeded hard bound');
  const directPrompt = buildPromptContext({ bible: { id: 'series_star', currentEpisode: 2 }, binding: { episodeNumber: 3 }, threads: context.threads });
  check(directPrompt.includes('TARGET EPISODE: 3'), 'Plot Thread Registry prompt target episode missing');

  const otherContext = await service.getScriptContext({ active: true, bible: await db.getSerializedSeriesBible('series_other'), binding: { episodeNumber: 2 } });
  check(otherContext.threads.length === 0 && !otherContext.promptContext.includes('council_coverup'), 'plot threads leaked across series');

  const tampered = db.threads.get(db.threadKey('series_star', 'council_coverup'));
  tampered.priority = 1;
  const drift = await service.validateSeries('series_star');
  check(!drift.valid && drift.blockers.some(item => item.code === 'plot_thread_current_state_drift'), 'plot thread current-state drift was not detected');

  console.log(`Phase 11.12.6 Plot Thread Registry verification passed (${checks} checks).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
