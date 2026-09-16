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
    this.timeline = new Map();
    this.memories = new Map();
    this.revisions = [];
    this.commits = [];
    this.bindings = new Map();
    this.seq = 0;
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  id(prefix) { this.seq += 1; return `${prefix}_${this.seq}`; }
  key(seriesId, episodeNumber) { return `${seriesId}:${episodeNumber}`; }
  seedBible(bible) { this.bibles.set(bible.id, this.clone(bible)); }
  seedTimeline(event) { this.timeline.set(event.id, this.clone(event)); }
  bind(binding) { this.bindings.set(binding.strategyId, this.clone(binding)); }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async getSerializedSeriesStrategyBinding(strategyId) { return this.clone(this.bindings.get(strategyId) || null); }
  async listSerializedTimelineEvents(seriesId) {
    return [...this.timeline.values()].filter(event => event.seriesId === seriesId).map(event => this.clone(event));
  }
  async getSerializedEpisodeMemory(seriesId, episodeNumber) {
    return this.clone(this.memories.get(this.key(seriesId, Number(episodeNumber))) || null);
  }
  async getSerializedEpisodeMemoryById(memoryId) {
    return this.clone([...this.memories.values()].find(memory => memory.id === memoryId) || null);
  }
  async listSerializedEpisodeMemories(seriesId) {
    return [...this.memories.values()].filter(memory => memory.seriesId === seriesId).sort((a, b) => b.episodeNumber - a.episodeNumber).map(memory => this.clone(memory));
  }
  async listSerializedEpisodeMemoryRevisions(memoryId) {
    return this.revisions.filter(row => row.episodeMemoryId === memoryId).sort((a, b) => b.revisionNumber - a.revisionNumber).map(row => this.clone(row));
  }
  async listSerializedEpisodeMemoryCommits(seriesId) {
    return this.commits.filter(row => row.seriesId === seriesId).map(row => this.clone(row));
  }
  async finalizeSerializedEpisodeMemoryAtomic(input = {}) {
    const bible = this.bibles.get(input.seriesId);
    if (!bible) throw new Error('episode_memory_series_not_found');
    if (Number(input.expectedBibleRevision) !== Number(bible.revisionNumber)) throw new Error('episode_memory_bible_revision_conflict');
    const episodeNumber = Number(input.memory.episodeNumber);
    if (episodeNumber !== Number(bible.currentEpisode) + 1) throw new Error('episode_memory_must_finalize_next_episode');
    const key = this.key(input.seriesId, episodeNumber);
    if (this.memories.has(key)) throw new Error('episode_memory_already_finalized');
    const actual = [...this.timeline.values()].filter(event => event.seriesId === input.seriesId && Number(event.episodeNumber) === episodeNumber && event.status === 'active').map(event => event.id).sort();
    const supplied = [...new Set(input.memory.timelineEventIds || [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(supplied)) throw new Error('episode_memory_timeline_set_mismatch');
    const now = new Date().toISOString();
    const memory = { ...this.clone(input.memory), revisionNumber: 1, status: 'finalized', createdAt: now, updatedAt: now };
    this.memories.set(key, memory);
    this.revisions.push({ id: this.id('revision'), episodeMemoryId: memory.id, seriesId: input.seriesId, episodeNumber, revisionNumber: 1, snapshot: this.clone(memory), changeKind: 'finalize', changeReason: input.reason, actor: input.actor, createdAt: now });
    bible.currentEpisode = episodeNumber;
    bible.revisionNumber += 1;
    this.bibles.set(bible.id, bible);
    const commit = { id: this.id('commit'), seriesId: input.seriesId, episodeMemoryId: memory.id, episodeNumber, memoryRevisionNumber: 1, bibleRevisionNumber: bible.revisionNumber, commitKind: 'finalize', timelineEventIds: supplied, reason: input.reason, actor: input.actor, createdAt: now };
    this.commits.push(commit);
    return { memory: this.clone(memory), bible: this.clone(bible), commit: this.clone(commit) };
  }
  async amendSerializedEpisodeMemoryAtomic(input = {}) {
    const key = this.key(input.seriesId, input.memory.episodeNumber);
    const existing = this.memories.get(key);
    if (!existing || existing.id !== input.memory.id) throw new Error('episode_memory_not_found');
    if (Number(input.expectedRevision) !== Number(existing.revisionNumber)) throw new Error('episode_memory_revision_conflict');
    const actual = [...this.timeline.values()].filter(event => event.seriesId === input.seriesId && Number(event.episodeNumber) === existing.episodeNumber && event.status === 'active').map(event => event.id).sort();
    const supplied = [...new Set(input.memory.timelineEventIds || [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(supplied)) throw new Error('episode_memory_timeline_set_mismatch');
    const now = new Date().toISOString();
    const memory = { ...this.clone(existing), ...this.clone(input.memory), revisionNumber: existing.revisionNumber + 1, updatedAt: now };
    this.memories.set(key, memory);
    this.revisions.push({ id: this.id('revision'), episodeMemoryId: memory.id, seriesId: input.seriesId, episodeNumber: memory.episodeNumber, revisionNumber: memory.revisionNumber, snapshot: this.clone(memory), changeKind: 'amendment', changeReason: input.reason, actor: input.actor, createdAt: now });
    const bible = this.bibles.get(input.seriesId);
    const commit = { id: this.id('commit'), seriesId: input.seriesId, episodeMemoryId: memory.id, episodeNumber: memory.episodeNumber, memoryRevisionNumber: memory.revisionNumber, bibleRevisionNumber: bible.revisionNumber, commitKind: 'amendment', timelineEventIds: supplied, reason: input.reason, actor: input.actor, createdAt: now };
    this.commits.push(commit);
    return { memory: this.clone(memory), commit: this.clone(commit) };
  }
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js',
    'utils/canonical-timeline-v12.js',
    'utils/episode-memory-v12.js',
    'agents/script-writer-agent.js',
    'database/db.js',
    'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 6;

  const serviceSource = read('utils/episode-memory-v12.js');
  const bibleSource = read('utils/serialized-series-bible-v12.js');
  const dbSource = read('database/db.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_episode_memories'), 'episode memories table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_episode_memory_revisions'), 'episode memory revisions table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_episode_memory_commits'), 'episode memory commits table missing');
  check(dbSource.includes('UNIQUE(series_id, episode_number)'), 'episode uniqueness constraint missing');
  check(dbSource.includes('finalizeSerializedEpisodeMemoryAtomic') && dbSource.includes('amendSerializedEpisodeMemoryAtomic'), 'atomic episode memory DB methods missing');
  check(dbSource.includes("await this.executeQuery('BEGIN IMMEDIATE')") && dbSource.includes("await this.executeQuery('ROLLBACK')"), 'episode memory transaction protection missing');
  check(dbSource.includes('episode_memory_timeline_set_mismatch'), 'DB timeline exact-set enforcement missing');
  check(dbSource.includes("change_kind, change_reason") && dbSource.includes("'episode_finalize'"), 'Series Bible finalize audit revision missing');
  check(bibleSource.includes('episode_memory_finalize_required'), 'legacy Series Bible episode advance guard missing');
  check(writerSource.includes("require('../utils/episode-memory-v12')"), 'Script Writer Episode Memory import missing');
  check(writerSource.includes('await this.episodeMemory.getScriptContext(serializedSeriesContext)'), 'Script Writer Episode Memory lookup missing');
  check(writerSource.includes('${episodeMemoryPrompt}'), 'Script Writer Episode Memory prompt injection missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episodes/:episodeNumber/finalize', protect"), 'protected episode finalize route missing');
  check(indexSource.includes("this.app.patch('/api/series-bibles/:seriesId/episodes/:episodeNumber', protect"), 'protected episode amendment route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/episode-memory/validate', protect"), 'protected Episode Memory validation route missing');
  check(indexSource.includes("this.app.get('/api/series-bibles/:seriesId/episode-memory/commits', protect"), 'protected Episode Memory audit route missing');
  check(envSource.includes('SERIALIZED_EPISODE_MEMORY_ENABLED=true'), 'Episode Memory env toggle missing');
  check(envSource.includes('SERIALIZED_EPISODE_MEMORY_PROMPT_EPISODES=20'), 'Episode Memory prompt bound env missing');
  check(pkg.scripts?.['test:episode-memory'] === 'node ../bootstrap/verify-phase11-episode-memory.js', 'Episode Memory npm test command missing');
  check(serviceSource.includes('explicit_approval_required'), 'explicit approval gate missing');
  check(serviceSource.includes('episode_memory_is_append_only'), 'append-only amendment gate missing');
  check(serviceSource.includes('strategy_binding_does_not_match_episode'), 'strategy binding validation missing');
  check(serviceSource.includes('finalized_episode_memory_missing'), 'ledger completeness validation missing');

  const { EpisodeMemoryServiceV12, normalizeMemory, validateApproval } = require(path.join(upstream, 'utils', 'episode-memory-v12.js'));

  const normalized = normalizeMemory({ episodeNumber: 1, summary: '  The   signal returns. ', discoveries: ['A', 'a', 'B'] });
  check(normalized.summary === 'The signal returns.', 'summary normalization failed');
  check(normalized.discoveries.length === 2, 'memory list de-duplication failed');
  check(validateApproval({ approvalId: 'a', approvedBy: 'editor', approvalReason: 'Approved canon.', approvedAt: '2026-09-16T00:00:00Z' }, { approved: false }).includes('explicit_approval_required'), 'approval must be explicit');

  const db = new MemoryDb();
  db.seedBible({ id: 'series_star', namespace: 'alpha', seriesKey: 'star', title: 'Star Harbor', status: 'active', currentEpisode: 0, canonVersion: 1, revisionNumber: 1 });
  db.seedTimeline({ id: 'evt_signal', seriesId: 'series_star', episodeNumber: 1, status: 'active', summary: 'Signal heard.' });
  db.seedTimeline({ id: 'evt_lock', seriesId: 'series_star', episodeNumber: 1, status: 'active', summary: 'Archive locked.' });
  db.bind({ strategyId: 'strategy_ep1', seriesId: 'series_star', episodeNumber: 1 });
  const service = new EpisodeMemoryServiceV12(db, { enabled: true, maxPromptEpisodes: 20 });

  const baseInput = {
    episodeNumber: 1,
    strategyId: 'strategy_ep1',
    productionId: 'prod_ep1',
    title: 'The Signal',
    summary: 'Mara hears the signal and loses access to the archive.',
    discoveries: ['The signal is real.'],
    establishedFacts: ['Mara heard the signal at the lighthouse.'],
    unresolvedQuestions: ['Who sent the signal?'],
    narrativePromises: ['Reveal why the archive was sealed.'],
    cliffhangers: ['A second signal appears after midnight.'],
    timelineEventIds: ['evt_signal', 'evt_lock'],
    approvalId: 'approval_ep1',
    approvedBy: 'showrunner',
    approvalReason: 'Episode one approved after continuity review.',
    approvedAt: '2026-09-16T00:00:00Z'
  };

  const noApproval = await service.finalizeEpisode('series_star', baseInput, { approved: false, actor: 'showrunner' });
  check(noApproval.status === 'approval_required', 'unapproved episode must not finalize');
  check((await db.getSerializedSeriesBible('series_star')).currentEpisode === 0, 'failed approval must not advance series');

  const wrongBinding = await service.finalizeEpisode('series_star', { ...baseInput, strategyId: 'missing_strategy' }, { approved: true, actor: 'showrunner' });
  check(wrongBinding.status === 'conflict' && wrongBinding.reason === 'strategy_binding_does_not_match_episode', 'wrong strategy binding must fail closed');

  const missingTimeline = await service.finalizeEpisode('series_star', { ...baseInput, timelineEventIds: ['evt_signal'] }, { approved: true, actor: 'showrunner' });
  check(missingTimeline.status === 'conflict' && missingTimeline.reason === 'episode_memory_timeline_set_mismatch', 'incomplete timeline set must fail closed');

  const stale = await service.finalizeEpisode('series_star', baseInput, { approved: true, actor: 'showrunner', expectedBibleRevision: 99 });
  check(stale.status === 'conflict' && stale.reason === 'episode_memory_bible_revision_conflict', 'stale Bible revision must fail closed');
  check((await db.getSerializedSeriesBible('series_star')).currentEpisode === 0, 'stale finalize must not advance series');

  const finalized = await service.finalizeEpisode('series_star', baseInput, { approved: true, actor: 'showrunner', expectedBibleRevision: 1, reason: 'Finalize approved episode one ledger.' });
  check(finalized.status === 'finalized', 'approved episode finalize failed');
  check(finalized.memory.revisionNumber === 1 && finalized.memory.status === 'finalized', 'finalized memory state incorrect');
  check(finalized.bible.currentEpisode === 1 && finalized.bible.revisionNumber === 2, 'finalize must atomically advance Series Bible');
  check(finalized.commit.timelineEventIds.length === 2, 'finalize audit must contain exact timeline event IDs');
  check((await db.listSerializedEpisodeMemoryRevisions(finalized.memory.id)).length === 1, 'finalize revision snapshot missing');

  const duplicate = await service.finalizeEpisode('series_star', baseInput, { approved: true, actor: 'showrunner' });
  check(duplicate.status === 'conflict', 'duplicate episode finalization must fail');

  const gap = await service.finalizeEpisode('series_star', { ...baseInput, episodeNumber: 3, strategyId: null, timelineEventIds: [], approvalId: 'a3' }, { approved: true, actor: 'showrunner' });
  check(gap.status === 'conflict' && gap.reason === 'episode_memory_must_finalize_next_episode', 'episode gaps must fail closed');

  const blockedAmendment = await service.amendEpisode('series_star', 1, { summary: 'Changed without audit.' }, { actor: 'editor' });
  check(blockedAmendment.status === 'amendment_required', 'episode ledger must be append-only by default');

  const amended = await service.amendEpisode('series_star', 1, {
    summary: 'Mara hears the signal; the council seals the archive immediately afterward.',
    timelineEventIds: ['evt_signal', 'evt_lock']
  }, { allowAmendment: true, expectedRevision: 1, actor: 'editor', reason: 'Clarify approved episode summary without changing canon.' });
  check(amended.status === 'amended' && amended.memory.revisionNumber === 2, 'audited Episode Memory amendment failed');
  check((await db.getSerializedSeriesBible('series_star')).currentEpisode === 1, 'memory amendment must not advance Series Bible');

  const staleAmendment = await service.amendEpisode('series_star', 1, { summary: 'stale', timelineEventIds: ['evt_signal', 'evt_lock'] }, { allowAmendment: true, expectedRevision: 1, actor: 'editor', reason: 'This stale amendment must fail.' });
  check(staleAmendment.status === 'conflict', 'stale Episode Memory amendment must fail');

  const validSeries = await service.validateSeries('series_star');
  check(validSeries.valid === true && validSeries.finalizedEpisodeCount === 1, 'valid Episode Memory ledger reported invalid');

  const serializedContext = { active: true, bible: await db.getSerializedSeriesBible('series_star'), binding: { seriesId: 'series_star', episodeNumber: 2 } };
  const promptContext = await service.getScriptContext(serializedContext);
  check(promptContext.active === true && promptContext.memories.length === 1, 'prior Episode Memory context missing');
  check(promptContext.promptContext.includes('EPISODE 1') && promptContext.promptContext.includes('Who sent the signal?'), 'Episode Memory prompt content incomplete');
  check(promptContext.promptContext.length <= 32000, 'Episode Memory prompt bound exceeded');

  db.seedTimeline({ id: 'evt_ep2', seriesId: 'series_star', episodeNumber: 2, status: 'active', summary: 'Episode two event.' });
  db.bind({ strategyId: 'strategy_ep2', seriesId: 'series_star', episodeNumber: 2 });
  const finalized2 = await service.finalizeEpisode('series_star', {
    ...baseInput,
    episodeNumber: 2,
    strategyId: 'strategy_ep2',
    title: 'The Archive',
    summary: 'Mara enters the archive through a hidden passage.',
    timelineEventIds: ['evt_ep2'],
    approvalId: 'approval_ep2',
    approvedAt: '2026-09-16T01:00:00Z'
  }, { approved: true, actor: 'showrunner', expectedBibleRevision: 2, reason: 'Finalize approved episode two ledger.' });
  check(finalized2.status === 'finalized' && finalized2.bible.currentEpisode === 2, 'second sequential episode finalize failed');

  const targetTwoContext = await service.getScriptContext({ active: true, bible: finalized2.bible, binding: { seriesId: 'series_star', episodeNumber: 2 } });
  check(targetTwoContext.memories.every(memory => memory.episodeNumber < 2), 'target episode must never leak into its own prompt');
  check(!targetTwoContext.promptContext.includes('Mara enters the archive through a hidden passage.'), 'target episode memory leaked into own prompt');

  db.seedTimeline({ id: 'evt_drift', seriesId: 'series_star', episodeNumber: 1, status: 'active', summary: 'Late timeline mutation.' });
  const drift = await service.validateSeries('series_star');
  check(drift.valid === false && drift.blockers.some(item => item.code === 'episode_timeline_set_drift' && item.episodeNumber === 1), 'timeline/ledger drift must be detected');

  let failedClosed = false;
  try { await service.getScriptContext({ active: true, bible: finalized2.bible, binding: { seriesId: 'series_star', episodeNumber: 3 } }); } catch (error) { failedClosed = String(error.message).includes('Episode Memory invalid'); }
  check(failedClosed, 'invalid Episode Memory must fail closed before Script Writer context');

  console.log(`FASE 11.12.3 VERIFICADA: ${checks} checks — approval-gated atomic finalize, exact timeline linkage, sequential Bible advance, audited amendments, drift detection and read-only prior-episode prompt memory.`);
}

main().catch(error => { console.error(error); process.exit(1); });
