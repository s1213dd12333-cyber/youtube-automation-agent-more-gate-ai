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
  constructor(snapshotArc) {
    this.snapshotArc = snapshotArc;
    this.bibles = new Map();
    this.memories = new Map();
    this.arcs = new Map();
    this.commits = [];
    this.revisions = [];
    this.persistent = new Map();
    this.seq = 0;
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  id(prefix) { this.seq += 1; return `${prefix}_${this.seq}`; }
  memoryKey(seriesId, episodeNumber) { return `${seriesId}:${Number(episodeNumber)}`; }
  arcKey(seriesId, characterKey) { return `${seriesId}:${characterKey}`; }
  seedBible(value) { this.bibles.set(value.id, this.clone(value)); }
  seedMemory(value) { this.memories.set(this.memoryKey(value.seriesId, value.episodeNumber), this.clone(value)); }
  seedPersistent(value) { this.persistent.set(value.id, this.clone(value)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async getSerializedEpisodeMemory(seriesId, episodeNumber) { return this.clone(this.memories.get(this.memoryKey(seriesId, episodeNumber)) || null); }
  async getPersistentCharacter(id) { return this.clone(this.persistent.get(id) || null); }
  async getSerializedCharacterArc(seriesId, characterKey) { return this.clone(this.arcs.get(this.arcKey(seriesId, characterKey)) || null); }
  async getSerializedCharacterArcById(id) { return this.clone([...this.arcs.values()].find(row => row.id === id) || null); }
  async listSerializedCharacterArcs(seriesId, _limit = 250, includeRetired = false) {
    return [...this.arcs.values()].filter(row => row.seriesId === seriesId && (includeRetired || row.status === 'active'))
      .sort((a, b) => b.lastEpisodeNumber - a.lastEpisodeNumber || a.characterKey.localeCompare(b.characterKey)).map(row => this.clone(row));
  }
  async listSerializedCharacterArcRevisions(arcId) { return this.revisions.filter(row => row.characterArcId === arcId).map(row => this.clone(row)); }
  async listSerializedCharacterArcCommits(arcId) {
    return this.commits.filter(row => row.characterArcId === arcId).sort((a, b) => b.arcRevisionNumber - a.arcRevisionNumber).map(row => this.clone(row));
  }
  async getLatestSerializedCharacterArcCommit(arcId) {
    return this.clone(this.commits.filter(row => row.characterArcId === arcId).sort((a, b) => b.arcRevisionNumber - a.arcRevisionNumber)[0] || null);
  }
  async getSerializedCharacterArcEpisodeCommit(arcId, episodeNumber, commitKind = 'episode_commit') {
    return this.clone(this.commits.filter(row => row.characterArcId === arcId && Number(row.episodeNumber) === Number(episodeNumber) && row.commitKind === commitKind)
      .sort((a, b) => b.arcRevisionNumber - a.arcRevisionNumber)[0] || null);
  }
  async commitSerializedCharacterArcsAtomic(input = {}) {
    const memory = this.memories.get(this.memoryKey(input.seriesId, input.episodeNumber));
    if (!memory || memory.id !== input.episodeMemoryId || memory.status !== 'finalized') throw new Error('finalized_episode_memory_required');
    const allowed = new Set(memory.timelineEventIds || []);
    const outArcs = [], outCommits = [];
    for (const item of input.updates) {
      const key = this.arcKey(input.seriesId, item.arc.characterKey);
      const existing = this.arcs.get(key) || null;
      const currentRevision = Number(existing?.revisionNumber || 0);
      if (Number(item.expectedRevision || 0) !== currentRevision) throw new Error('character_arc_revision_conflict');
      const latest = existing ? await this.getLatestSerializedCharacterArcCommit(existing.id) : null;
      if (latest && Number(latest.episodeNumber) > Number(input.episodeNumber)) throw new Error('character_arc_historical_insert_has_later_commit');
      if (existing && await this.getSerializedCharacterArcEpisodeCommit(existing.id, input.episodeNumber, 'episode_commit')) throw new Error('character_arc_episode_already_committed');
      if ((item.relevantTimelineEventIds || []).some(id => !allowed.has(id))) throw new Error('character_arc_timeline_reference_outside_episode_memory');
      const visual = item.arc.persistentCharacterId ? this.persistent.get(item.arc.persistentCharacterId) : null;
      if (item.arc.persistentCharacterId && (!visual || visual.status !== 'active')) throw new Error('character_arc_visual_binding_invalid');
      const next = this.clone(item.arc);
      next.id = existing?.id || next.id || this.id('arc');
      next.seriesId = input.seriesId;
      next.firstEpisodeNumber = existing?.firstEpisodeNumber || Number(input.episodeNumber);
      next.lastEpisodeNumber = Number(input.episodeNumber);
      next.revisionNumber = currentRevision + 1;
      next.status = next.status || 'active';
      next.createdAt = existing?.createdAt || new Date().toISOString();
      next.updatedAt = new Date().toISOString();
      const before = existing ? this.snapshotArc(existing) : {};
      const after = this.snapshotArc(next);
      this.arcs.set(key, this.clone(next));
      const revision = { id: this.id('rev'), characterArcId: next.id, seriesId: input.seriesId, episodeNumber: Number(input.episodeNumber), revisionNumber: next.revisionNumber, snapshot: after, changeKind: 'episode_commit', changeReason: input.reason, actor: input.actor };
      this.revisions.push(revision);
      const commit = { id: this.id('commit'), seriesId: input.seriesId, characterArcId: next.id, episodeMemoryId: memory.id,
        episodeNumber: Number(input.episodeNumber), arcRevisionNumber: next.revisionNumber, commitKind: 'episode_commit',
        timelineEventIds: this.clone(item.relevantTimelineEventIds || []), beforeSnapshot: before, afterSnapshot: after,
        changeSummary: item.changeSummary || '', reason: input.reason, actor: input.actor };
      this.commits.push(commit); outArcs.push(this.clone(next)); outCommits.push(this.clone(commit));
    }
    return { arcs: outArcs, commits: outCommits };
  }
  async amendSerializedCharacterArcAtomic(input = {}) {
    const key = this.arcKey(input.seriesId, input.arc.characterKey);
    const existing = this.arcs.get(key);
    if (!existing) throw new Error('character_arc_not_found');
    if (Number(input.expectedRevision) !== Number(existing.revisionNumber)) throw new Error('character_arc_revision_conflict');
    const latest = await this.getLatestSerializedCharacterArcCommit(existing.id);
    if (!latest || Number(latest.episodeNumber) !== Number(input.episodeNumber)) throw new Error('historical_character_arc_amendment_blocked_by_later_state');
    const memory = this.memories.get(this.memoryKey(input.seriesId, input.episodeNumber));
    if (!memory || memory.id !== input.episodeMemoryId || memory.status !== 'finalized') throw new Error('finalized_episode_memory_required');
    const allowed = new Set(memory.timelineEventIds || []);
    if ((input.relevantTimelineEventIds || []).some(id => !allowed.has(id))) throw new Error('character_arc_timeline_reference_outside_episode_memory');
    const next = this.clone(input.arc);
    next.revisionNumber = Number(existing.revisionNumber) + 1;
    next.firstEpisodeNumber = existing.firstEpisodeNumber;
    next.lastEpisodeNumber = existing.lastEpisodeNumber;
    next.createdAt = existing.createdAt;
    next.updatedAt = new Date().toISOString();
    const before = this.snapshotArc(existing), after = this.snapshotArc(next);
    this.arcs.set(key, this.clone(next));
    this.revisions.push({ id: this.id('rev'), characterArcId: next.id, seriesId: input.seriesId, episodeNumber: Number(input.episodeNumber), revisionNumber: next.revisionNumber, snapshot: after, changeKind: 'amendment', changeReason: input.reason, actor: input.actor });
    const commit = { id: this.id('commit'), seriesId: input.seriesId, characterArcId: next.id, episodeMemoryId: memory.id,
      episodeNumber: Number(input.episodeNumber), arcRevisionNumber: next.revisionNumber, commitKind: 'amendment',
      timelineEventIds: this.clone(input.relevantTimelineEventIds || []), beforeSnapshot: before, afterSnapshot: after,
      changeSummary: input.changeSummary || '', reason: input.reason, actor: input.actor };
    this.commits.push(commit);
    return { arc: this.clone(next), commit: this.clone(commit) };
  }
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js', 'utils/canonical-timeline-v12.js', 'utils/episode-memory-v12.js',
    'utils/character-arc-memory-v12.js', 'agents/script-writer-agent.js', 'database/db.js', 'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 7;

  const serviceSource = read('utils/character-arc-memory-v12.js');
  const dbSource = read('database/db.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_character_arcs'), 'character arcs table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_character_arc_revisions'), 'character arc revisions table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_character_arc_episode_commits'), 'character arc episode commits table missing');
  check(dbSource.includes('UNIQUE(series_id, character_key)'), 'series character-key uniqueness missing');
  check(dbSource.includes('commitSerializedCharacterArcsAtomic') && dbSource.includes('amendSerializedCharacterArcAtomic'), 'atomic Character Arc DB methods missing');
  check(dbSource.includes("BEGIN IMMEDIATE") && dbSource.includes("character_arc_revision_conflict"), 'Character Arc transaction/concurrency guard missing');
  check(dbSource.includes('character_arc_timeline_reference_outside_episode_memory'), 'Timeline subset enforcement missing');
  check(writerSource.includes("require('../utils/character-arc-memory-v12')"), 'Script Writer Character Arc import missing');
  check(writerSource.includes('await this.characterArcMemory.getScriptContext(serializedSeriesContext)'), 'Script Writer Character Arc lookup missing');
  check(writerSource.includes('${characterArcPrompt}'), 'Script Writer Character Arc prompt injection missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/character-arcs/commit', protect"), 'protected arc commit route missing');
  check(indexSource.includes("this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber/character-arcs/:characterKey', protect"), 'protected arc amendment route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/character-arcs/validate', protect"), 'protected arc validation route missing');
  check(envSource.includes('SERIALIZED_CHARACTER_ARC_MEMORY_ENABLED=true'), 'Character Arc env toggle missing');
  check(envSource.includes('SERIALIZED_CHARACTER_ARC_PROMPT_LIMIT=40'), 'Character Arc prompt bound missing');
  check(pkg.scripts?.['test:character-arc-memory'] === 'node ../bootstrap/verify-phase11-character-arc-memory.js', 'Character Arc npm test command missing');
  check(serviceSource.includes('character_arc_backfill_requires_explicit_approval'), 'explicit backfill guard missing');
  check(serviceSource.includes('historical_character_arc_amendment_blocked_by_later_state'), 'historical amendment guard missing');
  check(serviceSource.includes('character_arc_visual_rebind_requires_explicit_approval'), 'visual identity rebind guard missing');
  check(serviceSource.includes('Never transfer a Secret, Knowledge item, Belief, or discovery'), 'knowledge isolation prompt safety missing');
  check(serviceSource.includes('relationship memory belongs to the Relationship State Graph layer'), '11.12.5 relationship boundary missing');

  const { CharacterArcMemoryServiceV12, normalizeArc, snapshotArc, buildPromptContext, slug } = require(path.join(upstream, 'utils', 'character-arc-memory-v12.js'));
  check(slug('  Mara Vale  ') === 'mara_vale', 'character key slug normalization failed');
  const normalized = normalizeArc({ characterKey: 'Mara', displayName: ' Mara  Vale ', goals: ['Find signal', 'find signal', 'Protect Ivo'], knowledge: ['A', 'a', 'B'] });
  check(normalized.displayName === 'Mara Vale' && normalized.goals.length === 2 && normalized.knowledge.length === 2, 'arc normalization/de-dup failed');

  const db = new MemoryDb(snapshotArc);
  db.seedBible({ id: 'series_star', namespace: 'alpha', seriesKey: 'star', title: 'Star Harbor', status: 'active', currentEpisode: 1, revisionNumber: 2 });
  db.seedBible({ id: 'series_other', namespace: 'alpha', seriesKey: 'other', title: 'Other', status: 'active', currentEpisode: 1, revisionNumber: 2 });
  db.seedMemory({ id: 'mem1', seriesId: 'series_star', episodeNumber: 1, status: 'finalized', timelineEventIds: ['evt_signal', 'evt_lock'] });
  db.seedMemory({ id: 'other_mem1', seriesId: 'series_other', episodeNumber: 1, status: 'finalized', timelineEventIds: [] });
  db.seedPersistent({ id: 'persistent_mara', status: 'active', identityFingerprint: 'fp_mara', characterKey: 'mara' });
  db.seedPersistent({ id: 'persistent_ivo', status: 'active', identityFingerprint: 'fp_ivo', characterKey: 'ivo' });
  const service = new CharacterArcMemoryServiceV12(db, { enabled: true, maxPromptArcs: 40 });

  const noKey = await service.commitEpisodeArcs('series_star', 1, [{ displayName: 'Mara Vale' }], { actor: 'showrunner', reason: 'Commit approved character state.' });
  check(noKey.status === 'invalid' && noKey.reason === 'character_key_required', 'write must never fuzzy-bind by display name');

  const future = await service.commitEpisodeArcs('series_star', 2, [{ characterKey: 'mara', displayName: 'Mara Vale' }], { actor: 'showrunner', reason: 'Attempt future character state.' });
  check(future.status === 'conflict' && future.reason === 'finalized_episode_memory_required', 'unfinalized episode must not mutate character arc');

  const badTimeline = await service.commitEpisodeArcs('series_star', 1, [{ characterKey: 'mara', displayName: 'Mara Vale', relevantTimelineEventIds: ['evt_future'] }], { actor: 'showrunner', reason: 'Commit approved Mara state.' });
  check(badTimeline.status === 'conflict' && badTimeline.reason === 'character_arc_timeline_reference_outside_episode_memory', 'arc timeline refs must be subset of Episode Memory');

  const first = await service.commitEpisodeArcs('series_star', 1, [{
    characterKey: 'mara', displayName: 'Mara Vale', persistentCharacterId: 'persistent_mara', arcPhase: 'awakening',
    storyStatus: 'active', emotionalState: 'shaken but curious', moralState: 'duty-first', physicalCondition: 'uninjured',
    goals: ['Identify the source of the signal'], motivations: ['Protect Star Harbor'], beliefs: ['The council can still be trusted'],
    knowledge: ['The midnight signal is real'], secrets: ['She copied the forbidden frequency'],
    innerConflicts: ['Duty to the council versus need for truth'], commitments: ['Protect Ivo'], milestones: ['Heard the impossible signal'],
    relevantTimelineEventIds: ['evt_signal'], changeSummary: 'Mara begins investigating the signal.'
  }], { actor: 'showrunner', reason: 'Episode one character arc approved.' });
  check(first.status === 'committed' && first.arcs[0].revisionNumber === 1, 'initial arc commit failed');
  check(first.arcs[0].persistentCharacterFingerprint === 'fp_mara', 'visual persistent-character fingerprint was not pinned');
  check((await db.getSerializedCharacterArc('series_star', 'mara')).knowledge.includes('The midnight signal is real'), 'knowledge state not persisted');
  check((await db.listSerializedCharacterArcs('series_other')).length === 0, 'character arcs leaked across series');

  const duplicate = await service.commitEpisodeArcs('series_star', 1, [{ characterKey: 'mara', displayName: 'Mara Vale' }], { actor: 'showrunner', reason: 'Duplicate arc commit attempt.' });
  check(duplicate.status === 'conflict' && duplicate.reason === 'character_arc_episode_already_committed', 'duplicate per-episode arc commit must fail');

  const silentRebind = await service.amendEpisodeArc('series_star', 'mara', 1, { persistentCharacterId: 'persistent_ivo' }, { allowAmendment: true, expectedRevision: 1, actor: 'editor', reason: 'Correct visual identity binding.' });
  check(silentRebind.status === 'conflict' && silentRebind.reason === 'character_arc_visual_rebind_requires_explicit_approval', 'visual identity cannot silently rebind');

  const amendment = await service.amendEpisodeArc('series_star', 'mara', 1, {
    emotionalState: 'afraid but resolved', relevantTimelineEventIds: ['evt_signal'], changeSummary: 'Clarify approved emotional state.'
  }, { allowAmendment: true, expectedRevision: 1, actor: 'editor', reason: 'Clarify Mara emotional state after review.' });
  check(amendment.status === 'amended' && amendment.arc.revisionNumber === 2, 'audited latest arc amendment failed');

  db.bibles.get('series_star').currentEpisode = 2;
  db.seedMemory({ id: 'mem2', seriesId: 'series_star', episodeNumber: 2, status: 'finalized', timelineEventIds: ['evt_reveal'] });
  const second = await service.commitEpisodeArcs('series_star', 2, [{
    characterKey: 'mara', displayName: 'Mara Vale', expectedRevision: 2, emotionalState: 'betrayed and focused',
    physicalCondition: 'left arm bruised', beliefs: ['The council is hiding the origin of the signal'],
    knowledge: ['The midnight signal is real', 'The archive was sealed by council order'],
    secrets: ['She copied the forbidden frequency'], goals: ['Find who ordered the archive sealed'],
    milestones: ['Heard the impossible signal', 'Discovered the council cover-up'], relevantTimelineEventIds: ['evt_reveal'],
    changeSummary: 'Mara loses trust in the council and changes objective.'
  }], { actor: 'showrunner', reason: 'Episode two character arc approved.' });
  check(second.status === 'committed' && second.arcs[0].revisionNumber === 3 && second.arcs[0].lastEpisodeNumber === 2, 'second episode arc progression failed');

  const historicalAmendment = await service.amendEpisodeArc('series_star', 'mara', 1, { emotionalState: 'retroactive' }, { allowAmendment: true, expectedRevision: 3, actor: 'editor', reason: 'Attempt historical rewrite.' });
  check(historicalAmendment.status === 'conflict' && historicalAmendment.reason === 'historical_character_arc_amendment_blocked_by_later_state', 'historical amendment must be blocked after later state exists');

  const backfillWithoutApproval = await service.commitEpisodeArcs('series_star', 1, [{ characterKey: 'ivo', displayName: 'Ivo' }], { actor: 'showrunner', reason: 'Reconstruct Ivo history.' });
  check(backfillWithoutApproval.status === 'conflict' && backfillWithoutApproval.reason === 'character_arc_backfill_requires_explicit_approval', 'backfill must require explicit approval');
  const backfill = await service.commitEpisodeArcs('series_star', 1, [{ characterKey: 'ivo', displayName: 'Ivo', persistentCharacterId: 'persistent_ivo', knowledge: ['Mara heard something at the lighthouse'] }], { actor: 'showrunner', reason: 'Approved reconstruction of Ivo episode one state.', allowBackfill: true });
  check(backfill.status === 'committed' && backfill.arcs[0].firstEpisodeNumber === 1, 'explicit historical arc reconstruction failed');

  const validation = await service.validateSeries('series_star');
  check(validation.valid && validation.arcCount === 2, 'valid Character Arc series failed continuity validation');

  const context = await service.getScriptContext({ active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { seriesId: 'series_star', episodeNumber: 3 } });
  check(context.active && context.promptContext.includes('TARGET EPISODE: 3'), 'Character Arc target episode context missing');
  check(context.promptContext.includes('Secrets known/held by this character'), 'character secret state missing from author-level context');
  check(context.promptContext.includes('Never transfer a Secret, Knowledge item, Belief, or discovery'), 'knowledge leakage guard absent from prompt');
  check(context.promptContext.length <= 36000, 'Character Arc prompt bound exceeded');
  check(!context.promptContext.includes('RELATIONSHIP STATE:'), 'relationship graph state must not be duplicated into 11.12.4');

  const mara = await db.getSerializedCharacterArc('series_star', 'mara');
  const latest = await db.getLatestSerializedCharacterArcCommit(mara.id);
  latest.afterSnapshot.emotionalState = 'corrupted drift';
  const index = db.commits.findIndex(row => row.id === latest.id);
  db.commits[index] = latest;
  const drift = await service.validateSeries('series_star');
  check(!drift.valid && drift.blockers.some(item => item.code === 'character_arc_current_state_drift'), 'current state / commit drift must fail validation');

  check(buildPromptContext({ bible: { id: 's', currentEpisode: 0 }, binding: { episodeNumber: 1 }, arcs: [] }).includes('Script generation is read-only'), 'read-only prompt boundary missing');
  console.log(`Phase 11.12.4 Character Arc Memory regression checks passed: ${checks}`);
}

main().catch(error => { console.error(error); process.exit(1); });
