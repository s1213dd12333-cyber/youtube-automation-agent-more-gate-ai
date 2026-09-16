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
  constructor(snapshotRelationship) {
    this.snapshotRelationship = snapshotRelationship;
    this.bibles = new Map();
    this.memories = new Map();
    this.arcs = new Map();
    this.relationships = new Map();
    this.commits = [];
    this.revisions = [];
    this.seq = 0;
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  id(prefix) { this.seq += 1; return `${prefix}_${this.seq}`; }
  memoryKey(seriesId, episodeNumber) { return `${seriesId}:${Number(episodeNumber)}`; }
  arcKey(seriesId, characterKey) { return `${seriesId}:${characterKey}`; }
  relationshipMapKey(seriesId, sourceKey, targetKey) { return `${seriesId}:${sourceKey}->${targetKey}`; }
  seedBible(value) { this.bibles.set(value.id, this.clone(value)); }
  seedMemory(value) { this.memories.set(this.memoryKey(value.seriesId, value.episodeNumber), this.clone(value)); }
  seedArc(value) { this.arcs.set(this.arcKey(value.seriesId, value.characterKey), this.clone(value)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async getSerializedEpisodeMemory(seriesId, episodeNumber) { return this.clone(this.memories.get(this.memoryKey(seriesId, episodeNumber)) || null); }
  async getSerializedCharacterArc(seriesId, characterKey) { return this.clone(this.arcs.get(this.arcKey(seriesId, characterKey)) || null); }
  async getSerializedRelationshipState(seriesId, sourceKey, targetKey) {
    return this.clone(this.relationships.get(this.relationshipMapKey(seriesId, sourceKey, targetKey)) || null);
  }
  async getSerializedRelationshipStateById(id) {
    return this.clone([...this.relationships.values()].find(row => row.id === id) || null);
  }
  async listSerializedRelationshipStates(seriesId, _limit = 500, includeArchived = false) {
    return [...this.relationships.values()]
      .filter(row => row.seriesId === seriesId && (includeArchived || row.status === 'active'))
      .sort((a, b) => b.lastEpisodeNumber - a.lastEpisodeNumber || a.sourceCharacterKey.localeCompare(b.sourceCharacterKey) || a.targetCharacterKey.localeCompare(b.targetCharacterKey))
      .map(row => this.clone(row));
  }
  async listSerializedRelationshipRevisions(relationshipId) {
    return this.revisions.filter(row => row.relationshipId === relationshipId).map(row => this.clone(row));
  }
  async listSerializedRelationshipCommits(relationshipId) {
    return this.commits.filter(row => row.relationshipId === relationshipId)
      .sort((a, b) => b.relationshipRevisionNumber - a.relationshipRevisionNumber).map(row => this.clone(row));
  }
  async getLatestSerializedRelationshipCommit(relationshipId) {
    return this.clone(this.commits.filter(row => row.relationshipId === relationshipId)
      .sort((a, b) => b.relationshipRevisionNumber - a.relationshipRevisionNumber)[0] || null);
  }
  async getSerializedRelationshipEpisodeCommit(relationshipId, episodeNumber, commitKind = 'episode_commit') {
    return this.clone(this.commits.filter(row => row.relationshipId === relationshipId
      && Number(row.episodeNumber) === Number(episodeNumber) && row.commitKind === commitKind)
      .sort((a, b) => b.relationshipRevisionNumber - a.relationshipRevisionNumber)[0] || null);
  }
  async commitSerializedRelationshipsAtomic(input = {}) {
    const memory = this.memories.get(this.memoryKey(input.seriesId, input.episodeNumber));
    if (!memory || memory.id !== input.episodeMemoryId || memory.status !== 'finalized') throw new Error('finalized_episode_memory_required');
    const allowed = new Set(memory.timelineEventIds || []);
    const staged = [];
    for (const item of input.updates) {
      const relationship = item.relationship;
      if (relationship.sourceCharacterKey === relationship.targetCharacterKey) throw new Error('relationship_self_edge_forbidden');
      const sourceArc = this.arcs.get(this.arcKey(input.seriesId, relationship.sourceCharacterKey));
      const targetArc = this.arcs.get(this.arcKey(input.seriesId, relationship.targetCharacterKey));
      if (!sourceArc || sourceArc.id !== relationship.sourceCharacterArcId) throw new Error('relationship_source_character_arc_not_found');
      if (!targetArc || targetArc.id !== relationship.targetCharacterArcId) throw new Error('relationship_target_character_arc_not_found');
      const key = this.relationshipMapKey(input.seriesId, relationship.sourceCharacterKey, relationship.targetCharacterKey);
      const existing = this.relationships.get(key) || null;
      const currentRevision = Number(existing?.revisionNumber || 0);
      if (Number(item.expectedRevision || 0) !== currentRevision) throw new Error('relationship_revision_conflict');
      const latest = existing ? await this.getLatestSerializedRelationshipCommit(existing.id) : null;
      if (latest && Number(latest.episodeNumber) > Number(input.episodeNumber)) throw new Error('relationship_historical_insert_has_later_commit');
      if (existing && await this.getSerializedRelationshipEpisodeCommit(existing.id, input.episodeNumber, 'episode_commit')) throw new Error('relationship_episode_already_committed');
      if ((item.relevantTimelineEventIds || []).some(id => !allowed.has(id))) throw new Error('relationship_timeline_reference_outside_episode_memory');
      const next = this.clone(relationship);
      next.id = existing?.id || next.id || this.id('relationship');
      next.seriesId = input.seriesId;
      next.firstEpisodeNumber = existing?.firstEpisodeNumber || Number(input.episodeNumber);
      next.lastEpisodeNumber = Number(input.episodeNumber);
      next.revisionNumber = currentRevision + 1;
      next.status = next.status || 'active';
      next.createdAt = existing?.createdAt || new Date().toISOString();
      next.updatedAt = new Date().toISOString();
      const before = existing ? this.snapshotRelationship(existing) : {};
      const after = this.snapshotRelationship(next);
      staged.push({ key, next, before, after, item });
    }
    const outRelationships = [], outCommits = [];
    for (const stage of staged) {
      this.relationships.set(stage.key, this.clone(stage.next));
      const revision = {
        id: this.id('relrev'), relationshipId: stage.next.id, seriesId: input.seriesId,
        episodeNumber: Number(input.episodeNumber), revisionNumber: stage.next.revisionNumber,
        snapshot: stage.after, changeKind: 'episode_commit', changeReason: input.reason, actor: input.actor
      };
      this.revisions.push(revision);
      const commit = {
        id: this.id('relcommit'), seriesId: input.seriesId, relationshipId: stage.next.id, episodeMemoryId: memory.id,
        episodeNumber: Number(input.episodeNumber), relationshipRevisionNumber: stage.next.revisionNumber,
        commitKind: 'episode_commit', timelineEventIds: this.clone(stage.item.relevantTimelineEventIds || []),
        beforeSnapshot: stage.before, afterSnapshot: stage.after, changeSummary: stage.item.changeSummary || '',
        reason: input.reason, actor: input.actor
      };
      this.commits.push(commit);
      outRelationships.push(this.clone(stage.next)); outCommits.push(this.clone(commit));
    }
    return { relationships: outRelationships, commits: outCommits };
  }
  async amendSerializedRelationshipAtomic(input = {}) {
    const key = this.relationshipMapKey(input.seriesId, input.relationship.sourceCharacterKey, input.relationship.targetCharacterKey);
    const existing = this.relationships.get(key);
    if (!existing) throw new Error('relationship_not_found');
    if (Number(input.expectedRevision) !== Number(existing.revisionNumber)) throw new Error('relationship_revision_conflict');
    const latest = await this.getLatestSerializedRelationshipCommit(existing.id);
    if (!latest || Number(latest.episodeNumber) !== Number(input.episodeNumber)) throw new Error('historical_relationship_amendment_blocked_by_later_state');
    const memory = this.memories.get(this.memoryKey(input.seriesId, input.episodeNumber));
    if (!memory || memory.id !== input.episodeMemoryId || memory.status !== 'finalized') throw new Error('finalized_episode_memory_required');
    const allowed = new Set(memory.timelineEventIds || []);
    if ((input.relevantTimelineEventIds || []).some(id => !allowed.has(id))) throw new Error('relationship_timeline_reference_outside_episode_memory');
    if (existing.sourceCharacterArcId !== input.relationship.sourceCharacterArcId || existing.targetCharacterArcId !== input.relationship.targetCharacterArcId) throw new Error('relationship_endpoint_arc_binding_drift');
    const next = this.clone(input.relationship);
    next.revisionNumber = Number(existing.revisionNumber) + 1;
    next.firstEpisodeNumber = existing.firstEpisodeNumber;
    next.lastEpisodeNumber = existing.lastEpisodeNumber;
    next.createdAt = existing.createdAt;
    next.updatedAt = new Date().toISOString();
    const before = this.snapshotRelationship(existing), after = this.snapshotRelationship(next);
    this.relationships.set(key, this.clone(next));
    this.revisions.push({ id: this.id('relrev'), relationshipId: next.id, seriesId: input.seriesId,
      episodeNumber: Number(input.episodeNumber), revisionNumber: next.revisionNumber, snapshot: after,
      changeKind: 'amendment', changeReason: input.reason, actor: input.actor });
    const commit = { id: this.id('relcommit'), seriesId: input.seriesId, relationshipId: next.id, episodeMemoryId: memory.id,
      episodeNumber: Number(input.episodeNumber), relationshipRevisionNumber: next.revisionNumber, commitKind: 'amendment',
      timelineEventIds: this.clone(input.relevantTimelineEventIds || []), beforeSnapshot: before, afterSnapshot: after,
      changeSummary: input.changeSummary || '', reason: input.reason, actor: input.actor };
    this.commits.push(commit);
    return { relationship: this.clone(next), commit: this.clone(commit) };
  }
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js', 'utils/canonical-timeline-v12.js', 'utils/episode-memory-v12.js',
    'utils/character-arc-memory-v12.js', 'utils/relationship-state-graph-v12.js',
    'agents/script-writer-agent.js', 'database/db.js', 'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 8;

  const serviceSource = read('utils/relationship-state-graph-v12.js');
  const dbSource = read('database/db.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_relationship_states'), 'relationship state table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_relationship_revisions'), 'relationship revision table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_relationship_episode_commits'), 'relationship commit table missing');
  check(dbSource.includes('UNIQUE(series_id, source_character_key, target_character_key)'), 'directed relationship uniqueness missing');
  check(dbSource.includes('CHECK(source_character_key <> target_character_key)'), 'self-edge database guard missing');
  check(dbSource.includes('commitSerializedRelationshipsAtomic') && dbSource.includes('amendSerializedRelationshipAtomic'), 'atomic Relationship Graph DB methods missing');
  check(dbSource.includes('BEGIN IMMEDIATE') && dbSource.includes('relationship_revision_conflict'), 'Relationship Graph transaction/concurrency guard missing');
  check(dbSource.includes('relationship_timeline_reference_outside_episode_memory'), 'Relationship Timeline subset enforcement missing');
  check(dbSource.includes('relationship_source_character_arc_not_found') && dbSource.includes('relationship_target_character_arc_not_found'), 'Character Arc endpoint enforcement missing');
  check(writerSource.includes("require('../utils/relationship-state-graph-v12')"), 'Script Writer Relationship Graph import missing');
  check(writerSource.includes('await this.relationshipStateGraph.getScriptContext(serializedSeriesContext)'), 'Script Writer Relationship Graph lookup missing');
  check(writerSource.includes('${relationshipGraphPrompt}'), 'Script Writer Relationship Graph prompt injection missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/relationships/commit', protect"), 'protected relationship commit route missing');
  check(indexSource.includes("this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber/relationships/:sourceCharacterKey/:targetCharacterKey', protect"), 'protected relationship amendment route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/relationships/validate', protect"), 'protected relationship validation route missing');
  check(envSource.includes('SERIALIZED_RELATIONSHIP_STATE_GRAPH_ENABLED=true'), 'Relationship Graph env toggle missing');
  check(envSource.includes('SERIALIZED_RELATIONSHIP_PROMPT_LIMIT=60'), 'Relationship Graph prompt bound missing');
  check(pkg.scripts?.['test:relationship-state-graph'] === 'node ../bootstrap/verify-phase11-relationship-state-graph.js', 'Relationship Graph npm test command missing');
  check(serviceSource.includes('A -> B NEVER implies B -> A'), 'directed asymmetry prompt safety missing');
  check(serviceSource.includes('Secrets, knowledge, beliefs, expectations and grievances on an edge belong to the source character perspective only.'), 'relationship knowledge-isolation safety missing');
  check(serviceSource.includes('relationship_backfill_requires_explicit_approval'), 'explicit relationship backfill guard missing');
  check(serviceSource.includes('historical_relationship_amendment_blocked_by_later_state'), 'historical relationship amendment guard missing');
  check(serviceSource.includes('relationship_endpoints_are_immutable'), 'relationship endpoint immutability guard missing');

  const {
    RelationshipStateGraphServiceV12, normalizeRelationship, snapshotRelationship, buildPromptContext, relationshipKey, slug
  } = require(path.join(upstream, 'utils', 'relationship-state-graph-v12.js'));
  check(slug('  Mara Vale  ') === 'mara_vale', 'relationship character slug normalization failed');
  check(relationshipKey('Mara Vale', 'Ivo') === 'mara_vale->ivo', 'directed relationship key failed');
  const normalized = normalizeRelationship({
    sourceCharacterKey: 'Mara', targetCharacterKey: 'Ivo', trustScore: 500, fearScore: -10,
    relationshipTags: ['ally', 'ALLY', 'investigators'], secretsKnownAboutTarget: ['Hidden key', 'hidden key']
  });
  check(normalized.trustScore === 100 && normalized.fearScore === 0, 'relationship score bounds failed');
  check(normalized.relationshipTags.length === 2 && normalized.secretsKnownAboutTarget.length === 1, 'relationship array normalization/de-dup failed');

  const db = new MemoryDb(snapshotRelationship);
  db.seedBible({ id: 'series_star', namespace: 'alpha', seriesKey: 'star', title: 'Star Harbor', status: 'active', currentEpisode: 2, revisionNumber: 4 });
  db.seedBible({ id: 'series_other', namespace: 'alpha', seriesKey: 'other', title: 'Other', status: 'active', currentEpisode: 1, revisionNumber: 2 });
  db.seedMemory({ id: 'mem1', seriesId: 'series_star', episodeNumber: 1, status: 'finalized', timelineEventIds: ['evt_signal', 'evt_lock'] });
  db.seedMemory({ id: 'mem2', seriesId: 'series_star', episodeNumber: 2, status: 'finalized', timelineEventIds: ['evt_argument', 'evt_rescue'] });
  db.seedMemory({ id: 'other_mem1', seriesId: 'series_other', episodeNumber: 1, status: 'finalized', timelineEventIds: [] });
  db.seedArc({ id: 'arc_mara', seriesId: 'series_star', characterKey: 'mara', displayName: 'Mara Vale', revisionNumber: 2, status: 'active' });
  db.seedArc({ id: 'arc_ivo', seriesId: 'series_star', characterKey: 'ivo', displayName: 'Ivo Ren', revisionNumber: 2, status: 'active' });
  db.seedArc({ id: 'arc_nox', seriesId: 'series_star', characterKey: 'nox', displayName: 'Nox', revisionNumber: 1, status: 'active' });
  db.seedArc({ id: 'other_arc_mara', seriesId: 'series_other', characterKey: 'mara', displayName: 'Other Mara', revisionNumber: 1, status: 'active' });
  const service = new RelationshipStateGraphServiceV12(db, { enabled: true, maxPromptRelationships: 60 });

  const selfEdge = await service.commitEpisodeRelationships('series_star', 1, [{ sourceCharacterKey: 'mara', targetCharacterKey: 'mara' }], { actor: 'showrunner', reason: 'Attempt invalid self relation.' });
  check(selfEdge.status === 'invalid' && selfEdge.reason === 'relationship_self_edge_forbidden', 'self relationship edge must be blocked');

  const future = await service.commitEpisodeRelationships('series_star', 3, [{ sourceCharacterKey: 'mara', targetCharacterKey: 'ivo' }], { actor: 'showrunner', reason: 'Attempt future relationship state.' });
  check(future.status === 'conflict' && future.reason === 'finalized_episode_memory_required', 'unfinalized episode must not mutate relationship graph');

  const missingTarget = await service.commitEpisodeRelationships('series_star', 1, [{ sourceCharacterKey: 'mara', targetCharacterKey: 'ghost' }], { actor: 'showrunner', reason: 'Attempt missing character relation.' });
  check(missingTarget.status === 'conflict' && missingTarget.reason === 'relationship_target_character_arc_not_found', 'relationship endpoint must resolve exact same-series Character Arc');

  const badTimeline = await service.commitEpisodeRelationships('series_star', 1, [{ sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', relevantTimelineEventIds: ['evt_future'] }], { actor: 'showrunner', reason: 'Attempt invalid relationship event.' });
  check(badTimeline.status === 'conflict' && badTimeline.reason === 'relationship_timeline_reference_outside_episode_memory', 'relationship timeline refs must be subset of Episode Memory');

  const firstForward = await service.commitEpisodeRelationships('series_star', 1, [{
    sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', relationshipLabel: 'trusted partner',
    relationshipState: 'Mara trusts Ivo but still withholds the copied frequency.', relationshipTags: ['ally', 'investigator'],
    trustScore: 80, affinityScore: 65, respectScore: 75, loyaltyScore: 60, fearScore: 5, attractionScore: 10, dependenceScore: 30,
    beliefsAboutTarget: ['Ivo will protect civilians before obeying the council'], knowledgeAboutTarget: ['Ivo investigated the old transmitter'],
    secretsKnownAboutTarget: ['Ivo secretly kept the station master key'], obligationsToTarget: ['Repay Ivo for covering her absence'],
    promisesToTarget: ['Share the next verified signal trace'], grievancesAgainstTarget: [], expectationsOfTarget: ['Tell her if the council contacts him'],
    boundariesWithTarget: ['Do not expose the forbidden frequency publicly'], sharedHistory: ['Survived the harbor blackout together'],
    currentTensions: ['Mara is withholding one detail'], relevantTimelineEventIds: ['evt_signal'], changeSummary: 'Mara deepens trust in Ivo.'
  }], { actor: 'showrunner', reason: 'Episode one Mara-to-Ivo relationship approved.' });
  check(firstForward.status === 'committed' && firstForward.relationships[0].revisionNumber === 1, 'initial directed relationship commit failed');

  const firstReverse = await service.commitEpisodeRelationships('series_star', 1, [{
    sourceCharacterKey: 'ivo', targetCharacterKey: 'mara', relationshipLabel: 'cautious ally',
    relationshipState: 'Ivo values Mara but suspects she is hiding evidence.', trustScore: 25, affinityScore: 55, respectScore: 70,
    loyaltyScore: 35, fearScore: 0, attractionScore: 5, dependenceScore: 20,
    beliefsAboutTarget: ['Mara is hiding something important'], grievancesAgainstTarget: ['She excluded him from the archive search'],
    relevantTimelineEventIds: ['evt_lock'], changeSummary: 'Ivo remains cautious toward Mara.'
  }], { actor: 'showrunner', reason: 'Episode one Ivo-to-Mara relationship approved.' });
  check(firstReverse.status === 'committed', 'reverse directed relationship commit failed');
  const maraToIvo = await db.getSerializedRelationshipState('series_star', 'mara', 'ivo');
  const ivoToMara = await db.getSerializedRelationshipState('series_star', 'ivo', 'mara');
  check(maraToIvo.id !== ivoToMara.id && maraToIvo.trustScore === 80 && ivoToMara.trustScore === 25, 'opposite directed edges were incorrectly merged or mirrored');
  check(maraToIvo.secretsKnownAboutTarget.length === 1 && ivoToMara.secretsKnownAboutTarget.length === 0, 'directional secret knowledge leaked to reverse edge');

  const duplicate = await service.commitEpisodeRelationships('series_star', 1, [
    { sourceCharacterKey: 'mara', targetCharacterKey: 'nox' }, { sourceCharacterKey: 'mara', targetCharacterKey: 'nox' }
  ], { actor: 'showrunner', reason: 'Attempt duplicate batch edge.' });
  check(duplicate.status === 'conflict' && duplicate.reason === 'duplicate_relationship_edge_in_commit', 'duplicate edge in one atomic commit must be blocked');

  const stale = await service.commitEpisodeRelationships('series_star', 2, [{
    sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', expectedRevision: 0, trustScore: 70, relevantTimelineEventIds: ['evt_argument']
  }], { actor: 'showrunner', reason: 'Attempt stale relationship update.' });
  check(stale.status === 'conflict' && stale.reason === 'relationship_revision_conflict', 'stale relationship update must be blocked');

  const beforeBadBatchRevision = (await db.getSerializedRelationshipState('series_star', 'mara', 'ivo')).revisionNumber;
  const badBatch = await service.commitEpisodeRelationships('series_star', 2, [
    { sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', expectedRevision: 1, trustScore: 45, relevantTimelineEventIds: ['evt_argument'] },
    { sourceCharacterKey: 'nox', targetCharacterKey: 'ghost', trustScore: -90 }
  ], { actor: 'showrunner', reason: 'Attempt batch with invalid second edge.' });
  check(badBatch.status === 'conflict' && badBatch.reason === 'relationship_target_character_arc_not_found', 'invalid batch endpoint must fail before graph mutation');
  check((await db.getSerializedRelationshipState('series_star', 'mara', 'ivo')).revisionNumber === beforeBadBatchRevision, 'failed relationship batch partially mutated earlier edge');

  const second = await service.commitEpisodeRelationships('series_star', 2, [
    { sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', expectedRevision: 1, relationshipState: 'Trust is damaged after the argument.', trustScore: 45, currentTensions: ['Ivo challenged Mara over hidden evidence'], relevantTimelineEventIds: ['evt_argument'], changeSummary: 'Argument damages Mara trust.' },
    { sourceCharacterKey: 'ivo', targetCharacterKey: 'mara', expectedRevision: 1, relationshipState: 'Ivo trusts Mara more after she returns to rescue him.', trustScore: 60, grievancesAgainstTarget: [], relevantTimelineEventIds: ['evt_rescue'], changeSummary: 'Rescue increases Ivo trust.' }
  ], { actor: 'showrunner', reason: 'Episode two relationship changes approved.' });
  check(second.status === 'committed' && second.relationships.length === 2, 'atomic multi-edge relationship commit failed');
  check((await db.getSerializedRelationshipState('series_star', 'mara', 'ivo')).trustScore === 45 && (await db.getSerializedRelationshipState('series_star', 'ivo', 'mara')).trustScore === 60, 'directional episode-two scores incorrect');

  const backfill = await service.commitEpisodeRelationships('series_star', 1, [{
    sourceCharacterKey: 'mara', targetCharacterKey: 'ivo', expectedRevision: 2, trustScore: 90
  }], { actor: 'showrunner', reason: 'Attempt historical relationship insertion.', allowBackfill: true });
  check(backfill.status === 'conflict' && backfill.reason === 'relationship_historical_insert_has_later_commit', 'historical relationship insert must not rewrite later state');

  const oldAmendment = await service.amendEpisodeRelationship('series_star', 'mara', 'ivo', 1, { trustScore: 90, allowAmendment: true }, { actor: 'showrunner', reason: 'Correct old relationship state.', allowAmendment: true, expectedRevision: 2 });
  check(oldAmendment.status === 'conflict' && oldAmendment.reason === 'historical_relationship_amendment_blocked_by_later_state', 'older relationship state must not be amended after later state exists');

  const noApproval = await service.amendEpisodeRelationship('series_star', 'mara', 'ivo', 2, { trustScore: 50 }, { actor: 'showrunner', reason: 'Correct latest relationship state.', expectedRevision: 2 });
  check(noApproval.status === 'amendment_required' && noApproval.reason === 'relationship_history_is_append_only', 'relationship amendment must require explicit approval');

  const endpointMutation = await service.amendEpisodeRelationship('series_star', 'mara', 'ivo', 2, { targetCharacterKey: 'nox', allowAmendment: true }, { actor: 'showrunner', reason: 'Attempt endpoint mutation.', allowAmendment: true, expectedRevision: 2 });
  check(endpointMutation.status === 'conflict' && endpointMutation.reason === 'relationship_endpoints_are_immutable', 'relationship endpoints must be immutable');

  const amended = await service.amendEpisodeRelationship('series_star', 'mara', 'ivo', 2, {
    trustScore: 50, relationshipState: 'Trust is strained, but Mara acknowledges Ivo saved the investigation.',
    relevantTimelineEventIds: ['evt_argument', 'evt_rescue'], allowAmendment: true, changeSummary: 'Correct trust score after review.'
  }, { actor: 'showrunner', reason: 'Correct approved episode-two relationship score.', allowAmendment: true, expectedRevision: 2 });
  check(amended.status === 'amended' && amended.relationship.revisionNumber === 3 && amended.relationship.trustScore === 50, 'latest relationship amendment failed');

  const validation = await service.validateSeries('series_star');
  check(validation.valid && validation.relationshipCount === 2, `valid relationship graph rejected: ${JSON.stringify(validation.blockers)}`);

  const context = await service.getScriptContext({ active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { episodeNumber: 3 } });
  check(context.active && context.relationships.length === 2, 'relationship prompt context missing active directed edges');
  check(context.promptContext.includes('DIRECTED RELATIONSHIP ivo -> mara') && context.promptContext.includes('DIRECTED RELATIONSHIP mara -> ivo'), 'both directed edges missing from prompt');
  check(context.promptContext.includes('A -> B NEVER implies B -> A'), 'prompt must forbid symmetric inference');
  check(context.promptContext.includes('Secrets source knows about target'), 'directional secret knowledge not represented in prompt');
  check(context.promptContext.length <= 48000, 'relationship prompt context exceeded hard bound');
  const directPrompt = buildPromptContext({ bible: { id: 'series_star', currentEpisode: 2 }, binding: { episodeNumber: 3 }, relationships: context.relationships });
  check(directPrompt.includes('TARGET EPISODE: 3'), 'relationship prompt target episode missing');

  const otherContext = await service.getScriptContext({ active: true, bible: await db.getSerializedSeriesBible('series_other'), binding: { episodeNumber: 2 } });
  check(otherContext.relationships.length === 0 && !otherContext.promptContext.includes('mara -> ivo'), 'relationship graph leaked across series');

  const tampered = db.relationships.get(db.relationshipMapKey('series_star', 'mara', 'ivo'));
  tampered.trustScore = 99;
  const drift = await service.validateSeries('series_star');
  check(!drift.valid && drift.blockers.some(item => item.code === 'relationship_current_state_drift'), 'current relationship drift was not detected');

  console.log(`Phase 11.12.5 Relationship State Graph verification passed (${checks} checks).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
