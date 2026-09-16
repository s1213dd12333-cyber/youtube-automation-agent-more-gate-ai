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
    this.states = new Map();
    this.events = new Map();
    this.eventRevisions = [];
    this.commits = [];
    this.seq = 0;
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  id(prefix) { this.seq += 1; return `${prefix}_${this.seq}`; }
  seedBible(bible) { this.bibles.set(bible.id, this.clone(bible)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async getSerializedTimelineState(seriesId) {
    return this.clone(this.states.get(seriesId) || { seriesId, revisionNumber: 0, lastChronologyIndex: 0, createdAt: null, updatedAt: null });
  }
  async getSerializedTimelineEvent(id) { return this.clone(this.events.get(id) || null); }
  async getSerializedTimelineEventByKey(seriesId, eventKey) {
    return this.clone([...this.events.values()].find(event => event.seriesId === seriesId && event.eventKey === eventKey) || null);
  }
  async listSerializedTimelineEvents(seriesId) {
    return [...this.events.values()]
      .filter(event => event.seriesId === seriesId)
      .sort((a, b) => a.chronologyIndex - b.chronologyIndex)
      .map(event => this.clone(event));
  }
  async commitSerializedTimelineEventsAtomic(input = {}) {
    const state = await this.getSerializedTimelineState(input.seriesId);
    if (Number(input.expectedTimelineRevision) !== Number(state.revisionNumber)) throw new Error('timeline_revision_conflict');
    const current = await this.listSerializedTimelineEvents(input.seriesId);
    const keys = new Set(current.map(event => event.eventKey));
    const indexes = new Set(current.filter(event => event.status !== 'retired').map(event => event.chronologyIndex));
    for (const event of input.events) {
      if (keys.has(event.eventKey) || indexes.has(event.chronologyIndex) || this.events.has(event.id)) throw new Error('SQLITE_CONSTRAINT UNIQUE');
      keys.add(event.eventKey); indexes.add(event.chronologyIndex);
    }
    const nextRevision = state.revisionNumber + 1;
    const commitId = input.commitId || this.id('commit');
    const now = new Date().toISOString();
    const saved = [];
    for (const raw of input.events) {
      const event = { ...this.clone(raw), seriesId: input.seriesId, revisionNumber: 1, commitId, createdAt: now, updatedAt: now };
      this.events.set(event.id, event);
      saved.push(this.clone(event));
      this.eventRevisions.push({
        id: this.id('revision'), eventId: event.id, seriesId: input.seriesId,
        eventRevisionNumber: 1, timelineRevisionNumber: nextRevision,
        snapshot: this.clone(event), changeKind: input.changeKind || 'create',
        changeReason: input.reason || '', actor: input.actor || null, createdAt: now
      });
    }
    const lastChronologyIndex = Math.max(state.lastChronologyIndex || 0, ...saved.map(event => event.chronologyIndex));
    const nextState = { seriesId: input.seriesId, revisionNumber: nextRevision, lastChronologyIndex, createdAt: state.createdAt || now, updatedAt: now };
    this.states.set(input.seriesId, nextState);
    const commit = {
      id: commitId, seriesId: input.seriesId, timelineRevisionNumber: nextRevision,
      commitKind: input.commitKind || 'append', episodeNumber: input.episodeNumber ?? null,
      eventIds: saved.map(event => event.id), reason: input.reason || '', actor: input.actor || null, createdAt: now
    };
    this.commits.push(commit);
    return { commit: this.clone(commit), state: this.clone(nextState), events: saved };
  }
  async updateSerializedTimelineEventAtomic(input = {}) {
    const current = this.events.get(input.event.id);
    if (!current || current.seriesId !== input.seriesId) throw new Error('timeline_event_not_found');
    if (Number(input.expectedEventRevision) !== Number(current.revisionNumber)) throw new Error('timeline_event_revision_conflict');
    const state = await this.getSerializedTimelineState(input.seriesId);
    if (Number(input.expectedTimelineRevision) !== Number(state.revisionNumber)) throw new Error('timeline_revision_conflict');
    const others = [...this.events.values()].filter(event => event.seriesId === input.seriesId && event.id !== input.event.id && event.status !== 'retired');
    if (others.some(event => event.eventKey === input.event.eventKey || event.chronologyIndex === input.event.chronologyIndex)) throw new Error('SQLITE_CONSTRAINT UNIQUE');
    const now = new Date().toISOString();
    const nextEventRevision = current.revisionNumber + 1;
    const nextTimelineRevision = state.revisionNumber + 1;
    const commitId = input.commitId || this.id('commit');
    const saved = { ...this.clone(current), ...this.clone(input.event), revisionNumber: nextEventRevision, commitId, updatedAt: now };
    this.events.set(saved.id, saved);
    this.eventRevisions.push({
      id: this.id('revision'), eventId: saved.id, seriesId: input.seriesId,
      eventRevisionNumber: nextEventRevision, timelineRevisionNumber: nextTimelineRevision,
      snapshot: this.clone(saved), changeKind: input.changeKind || 'retcon',
      changeReason: input.reason || '', actor: input.actor || null, createdAt: now
    });
    const allActive = [...this.events.values()].filter(event => event.seriesId === input.seriesId && event.status !== 'retired');
    const lastChronologyIndex = Math.max(0, ...allActive.map(event => event.chronologyIndex));
    const nextState = { ...state, revisionNumber: nextTimelineRevision, lastChronologyIndex, updatedAt: now };
    this.states.set(input.seriesId, nextState);
    const commit = {
      id: commitId, seriesId: input.seriesId, timelineRevisionNumber: nextTimelineRevision,
      commitKind: input.commitKind || 'retcon', episodeNumber: saved.episodeNumber,
      eventIds: [saved.id], reason: input.reason || '', actor: input.actor || null, createdAt: now
    };
    this.commits.push(commit);
    return { commit: this.clone(commit), state: this.clone(nextState), event: this.clone(saved) };
  }
  async listSerializedTimelineEventRevisions(eventId) {
    return this.eventRevisions.filter(row => row.eventId === eventId).sort((a, b) => b.eventRevisionNumber - a.eventRevisionNumber).map(row => this.clone(row));
  }
  async listSerializedTimelineCommits(seriesId) {
    return this.commits.filter(row => row.seriesId === seriesId).sort((a, b) => b.timelineRevisionNumber - a.timelineRevisionNumber).map(row => this.clone(row));
  }
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js',
    'utils/canonical-timeline-v12.js',
    'agents/script-writer-agent.js',
    'database/db.js',
    'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 5;

  const serviceSource = read('utils/canonical-timeline-v12.js');
  const dbSource = read('database/db.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_timeline_states'), 'timeline state table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_timeline_events'), 'timeline events table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_timeline_event_revisions'), 'timeline event revisions table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_timeline_commits'), 'timeline commits table missing');
  check(dbSource.includes('UNIQUE(series_id, event_key)') && dbSource.includes('UNIQUE(series_id, chronology_index)'), 'timeline uniqueness constraints missing');
  check(dbSource.includes("await this.executeQuery('BEGIN IMMEDIATE')") && dbSource.includes("await this.executeQuery('ROLLBACK')"), 'atomic timeline transaction missing');
  check(dbSource.includes('commitSerializedTimelineEventsAtomic') && dbSource.includes('updateSerializedTimelineEventAtomic'), 'atomic timeline DB methods missing');
  check(writerSource.includes("require('../utils/canonical-timeline-v12')"), 'Script Writer timeline import missing');
  check(writerSource.includes('await this.canonicalTimeline.getScriptContext(serializedSeriesContext)'), 'Script Writer timeline lookup missing');
  check(writerSource.includes('${canonicalTimelinePrompt}'), 'Script Writer timeline prompt injection missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/timeline/events', protect"), 'protected timeline append route missing');
  check(indexSource.includes("this.app.patch('/api/series-bibles/:seriesId/timeline/events/:eventId', protect"), 'protected timeline retcon route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/timeline/validate', protect"), 'protected timeline validation route missing');
  check(indexSource.includes("this.app.get('/api/series-bibles/:seriesId/timeline/commits', protect"), 'protected timeline commit audit route missing');
  check(envSource.includes('SERIALIZED_CANONICAL_TIMELINE_ENABLED=true'), 'timeline env toggle missing');
  check(envSource.includes('SERIALIZED_TIMELINE_PROMPT_EVENTS=60'), 'timeline prompt limit env missing');
  check(pkg.scripts?.['test:canonical-timeline'] === 'node ../bootstrap/verify-phase11-canonical-timeline.js', 'timeline npm test command missing');
  check(serviceSource.includes('past_chronology_insert_requires_explicit_backfill'), 'explicit backfill gate missing');
  check(serviceSource.includes('timeline_event_is_append_only'), 'append-only retcon gate missing');
  check(serviceSource.includes('chronology_constraint_cycle'), 'chronology cycle gate missing');
  check(serviceSource.includes('dangling_event_reference'), 'dangling reference gate missing');
  check(!serviceSource.includes('updateSerializedSeriesBible(') && !serviceSource.includes('.advanceEpisode('), 'timeline must not mutate Series Bible implicitly');

  const {
    CanonicalTimelineServiceV12,
    normalizeEvent,
    validateEventSet,
    timelinePromptContext
  } = require(path.join(upstream, 'utils', 'canonical-timeline-v12.js'));

  const normalized = normalizeEvent({
    id: 'n1', seriesId: 'series_star', eventKey: 'n1', chronologyIndex: 10,
    episodeNumber: 1, summary: '  Mara   hears the signal. ', participants: ['Mara', 'mara', 'Keeper'], truthStatus: 'CONFIRMED'
  });
  check(normalized.summary === 'Mara hears the signal.', 'event summary normalization failed');
  check(normalized.participants.length === 2, 'participant de-duplication failed');
  check(normalized.truthStatus === 'confirmed', 'truth status normalization failed');
  const unknownTruth = normalizeEvent({ id: 'n2', eventKey: 'n2', chronologyIndex: 20, summary: 'Unknown claim', truthStatus: 'invented_status' });
  check(unknownTruth.truthStatus === 'unknown', 'unknown truth status must fail safe to unknown');

  const cycleCheck = validateEventSet([
    normalizeEvent({ id: 'cycle_a', eventKey: 'cycle_a', chronologyIndex: 1000, summary: 'A', mustFollowEventIds: ['cycle_b'] }),
    normalizeEvent({ id: 'cycle_b', eventKey: 'cycle_b', chronologyIndex: 2000, summary: 'B', mustFollowEventIds: ['cycle_a'] })
  ]);
  check(cycleCheck.valid === false && cycleCheck.blockers.some(item => item.code === 'chronology_constraint_cycle'), 'cycle detection failed');

  const db = new MemoryDb();
  const bible = {
    id: 'series_star', namespace: 'channel_alpha', seriesKey: 'star_harbor', title: 'Star Harbor',
    status: 'active', currentEpisode: 3, canonVersion: 1, revisionNumber: 2
  };
  db.seedBible(bible);
  const service = new CanonicalTimelineServiceV12(db, { enabled: true, maxPromptEvents: 60 });

  const initial = await service.commitEvents(bible.id, [
    {
      id: 'evt_signal', eventKey: 'signal_first_heard', chronologyIndex: 1000,
      episodeNumber: 1, sceneId: 'scene_1', sceneOrder: 1, storyTimeLabel: 'Night 1',
      eventType: 'discovery', summary: 'Mara hears the impossible signal at the lighthouse.',
      participants: ['char_mara'], locationRefs: ['loc_lighthouse'],
      consequences: ['Mara begins investigating the signal.'], truthStatus: 'confirmed'
    },
    {
      id: 'evt_lockdown', eventKey: 'council_lockdown', chronologyIndex: 2000,
      episodeNumber: 2, sceneId: 'scene_4', sceneOrder: 4, eventType: 'decision',
      summary: 'The council seals the lighthouse records.', participants: ['char_council'],
      causeEventIds: ['evt_signal'], consequences: ['Mara loses legal access to the archive.'], truthStatus: 'confirmed'
    },
    {
      id: 'evt_rumor', eventKey: 'harbor_rumor', chronologyIndex: 3000,
      episodeNumber: 3, sceneId: 'scene_2', sceneOrder: 2, eventType: 'rumor',
      summary: 'Dockworkers claim the signal predicts disappearances.', participants: ['group_dockworkers'],
      truthStatus: 'rumor'
    }
  ], { actor: 'episode_commit', reason: 'Episodes 1-3 approved canonical timeline import.', expectedTimelineRevision: 0 });
  check(initial.status === 'committed', 'initial atomic timeline commit failed');
  check(initial.events.length === 3 && initial.state.revisionNumber === 1, 'initial timeline state/revision incorrect');
  check(initial.commit.eventIds.length === 3, 'batch commit audit must contain every event');
  check((await db.getSerializedSeriesBible(bible.id)).currentEpisode === 3, 'timeline commit must not advance Series Bible episode');

  const stale = await service.commitEvents(bible.id, {
    id: 'evt_stale', eventKey: 'stale_event', episodeNumber: 3, summary: 'This write is stale.'
  }, { actor: 'test', reason: 'Stale timeline write should be rejected.', expectedTimelineRevision: 0 });
  check(stale.status === 'conflict' && stale.reason === 'timeline_revision_conflict', 'stale timeline write must fail closed');

  const dangling = await service.commitEvents(bible.id, {
    id: 'evt_dangling', eventKey: 'dangling', chronologyIndex: 4000, episodeNumber: 3,
    summary: 'An event cites a missing cause.', causeEventIds: ['missing_event']
  }, { actor: 'test', reason: 'Validate dangling references before persistence.', expectedTimelineRevision: 1 });
  check(dangling.status === 'invalid' && dangling.validation.blockers.some(item => item.code === 'dangling_event_reference'), 'dangling event reference must be rejected');

  const blockedBackfill = await service.commitEvents(bible.id, {
    id: 'evt_childhood', eventKey: 'childhood_memory', chronologyIndex: 1500, episodeNumber: 3,
    storyTimeLabel: 'Years earlier', eventType: 'flashback', summary: 'A flashback reveals Mara saw the cracked lens as a child.',
    participants: ['char_mara'], locationRefs: ['loc_lighthouse'], mustFollowEventIds: ['evt_signal'], mustPrecedeEventIds: ['evt_lockdown']
  }, { actor: 'showrunner', reason: 'Approved episode-three flashback canon.', expectedTimelineRevision: 1 });
  check(blockedBackfill.status === 'backfill_required', 'past chronology insertion must require explicit backfill');

  const backfill = await service.commitEvents(bible.id, {
    id: 'evt_childhood', eventKey: 'childhood_memory', chronologyIndex: 1500, episodeNumber: 3,
    storyTimeLabel: 'Years earlier', eventType: 'flashback', summary: 'A flashback reveals Mara saw the cracked lens as a child.',
    participants: ['char_mara'], locationRefs: ['loc_lighthouse'], mustFollowEventIds: ['evt_signal'], mustPrecedeEventIds: ['evt_lockdown']
  }, { actor: 'showrunner', reason: 'Approved episode-three flashback canon.', allowBackfill: true, expectedTimelineRevision: 1 });
  check(backfill.status === 'committed' && backfill.commit.commitKind === 'backfill', 'explicit timeline backfill failed');
  check(backfill.state.revisionNumber === 2 && backfill.state.lastChronologyIndex === 3000, 'backfill must preserve maximum chronology cursor');

  const badOrder = await service.commitEvents(bible.id, {
    id: 'evt_bad_order', eventKey: 'bad_order', chronologyIndex: 500, episodeNumber: 3,
    summary: 'This event incorrectly claims the signal caused an earlier event.', causeEventIds: ['evt_signal']
  }, { actor: 'test', reason: 'Reject cause ordering contradiction.', allowBackfill: true, expectedTimelineRevision: 2 });
  check(badOrder.status === 'invalid' && badOrder.validation.blockers.some(item => item.code === 'cause_order_violation'), 'cause ordering contradiction must fail');

  const noRetcon = await service.retconEvent(bible.id, 'evt_lockdown', {
    consequences: ['Mara loses access permanently.'], expectedEventRevision: 1, expectedTimelineRevision: 2
  }, { actor: 'test', reason: 'Attempt silent semantic rewrite.' });
  check(noRetcon.status === 'retcon_required' && noRetcon.reason === 'timeline_event_is_append_only', 'committed event mutation must require retcon');

  const shortRetcon = await service.retconEvent(bible.id, 'evt_lockdown', {
    consequences: ['Mara loses access permanently.'], allowRetcon: true, expectedEventRevision: 1, expectedTimelineRevision: 2
  }, { actor: 'test', allowRetcon: true, reason: 'fix' });
  check(shortRetcon.status === 'retcon_required' && shortRetcon.reason === 'timeline_retcon_reason_required', 'short retcon reason must fail');

  const retcon = await service.retconEvent(bible.id, 'evt_lockdown', {
    consequences: ['Mara loses legal access until the council vote is reversed.'],
    allowRetcon: true, expectedEventRevision: 1, expectedTimelineRevision: 2
  }, { actor: 'showrunner', allowRetcon: true, reason: 'Approved correction: the archive restriction was temporary, not permanent.' });
  check(retcon.status === 'retconned', 'explicit audited timeline retcon failed');
  check(retcon.event.revisionNumber === 2 && retcon.state.revisionNumber === 3, 'retcon revisions did not advance');
  const revisions = await db.listSerializedTimelineEventRevisions('evt_lockdown');
  check(revisions.length === 2 && revisions[0].changeKind === 'retcon', 'timeline event revision audit missing');

  const invalidRetcon = await service.retconEvent(bible.id, 'evt_lockdown', {
    chronologyIndex: 1200, allowRetcon: true, expectedEventRevision: 2, expectedTimelineRevision: 3
  }, { actor: 'showrunner', allowRetcon: true, reason: 'Test chronology constraint protection during retcon.' });
  check(invalidRetcon.status === 'invalid' && invalidRetcon.validation.blockers.some(item => ['must_precede_order_violation', 'cause_order_violation'].includes(item.code)), 'retcon must not violate chronology constraints');

  const future = await service.commitEvents(bible.id, {
    id: 'evt_episode4', eventKey: 'episode4_unapproved_view', episodeNumber: 4,
    summary: 'Episode four event exists in storage but must not leak into its own writing context.', truthStatus: 'unknown'
  }, { actor: 'test_fixture', reason: 'Fixture proving target-episode events stay out of prompt.', expectedTimelineRevision: 3 });
  check(future.status === 'committed' && future.state.revisionNumber === 4, 'future-coordinate fixture commit failed');
  check((await db.getSerializedSeriesBible(bible.id)).currentEpisode === 3, 'timeline activity must leave Series Bible untouched');

  const scriptContext = await service.getScriptContext({ active: true, bible, binding: { episodeNumber: 4 } });
  check(scriptContext.active === true && scriptContext.targetEpisode === 4, 'timeline script context target episode incorrect');
  check(scriptContext.events.some(event => event.id === 'evt_childhood'), 'backfilled canonical event missing from script context');
  check(scriptContext.events.some(event => event.id === 'evt_rumor' && event.truthStatus === 'rumor'), 'truth-status event missing from script context');
  check(!scriptContext.events.some(event => event.id === 'evt_episode4'), 'target episode event leaked into its own writing context');
  check(scriptContext.promptContext.includes('C1000') && scriptContext.promptContext.includes('C1500') && scriptContext.promptContext.includes('C2000'), 'chronological coordinates missing from prompt');
  check(scriptContext.promptContext.includes('rumor') && scriptContext.promptContext.includes('do not silently promote'), 'truth-status safety missing from prompt');
  check(scriptContext.promptContext.includes('Script generation is read-only'), 'read-only timeline rule missing from prompt');
  check(scriptContext.promptContext.length <= 28000, 'timeline prompt must be bounded');

  const finalValidation = await service.validateTimeline(bible.id);
  check(finalValidation.valid === true && finalValidation.eventCount === 5, 'final canonical timeline should validate');
  const commits = await db.listSerializedTimelineCommits(bible.id);
  check(commits.length === 4 && commits[0].timelineRevisionNumber === 4, 'timeline commit history incorrect');

  const manualPrompt = timelinePromptContext({
    bible, binding: { episodeNumber: 4 }, state: { revisionNumber: 9 }, events: scriptContext.events.slice(0, 2)
  });
  check(manualPrompt.includes('TIMELINE REVISION: 9') && manualPrompt.includes('TARGET EPISODE: 4'), 'manual timeline prompt metadata missing');

  console.log(`Phase 11.12.2 Canonical Timeline OK: ${checks} regression checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
