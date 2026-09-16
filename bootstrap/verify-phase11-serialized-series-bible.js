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
    this.byKey = new Map();
    this.revisions = [];
    this.bindings = new Map();
  }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  key(namespace, seriesKey) { return `${namespace || 'default'}::${seriesKey}`; }
  async getSerializedSeriesBible(id) { return this.clone(this.bibles.get(id) || null); }
  async getSerializedSeriesBibleByKey(namespace, seriesKey) { return this.clone(this.byKey.get(this.key(namespace, seriesKey)) || null); }
  async listSerializedSeriesBibles(namespace) { return [...this.bibles.values()].filter(row => row.namespace === namespace).map(row => this.clone(row)); }
  async createSerializedSeriesBible(bible) {
    const key = this.key(bible.namespace, bible.seriesKey);
    if (this.byKey.has(key)) return this.clone(this.byKey.get(key));
    const now = new Date().toISOString();
    const saved = { ...this.clone(bible), createdAt: bible.createdAt || now, updatedAt: now };
    this.bibles.set(saved.id, saved); this.byKey.set(key, saved);
    return this.clone(saved);
  }
  async updateSerializedSeriesBible(bible, expectedRevisionNumber) {
    const current = this.bibles.get(bible.id);
    if (!current || Number(current.revisionNumber) !== Number(expectedRevisionNumber)) return null;
    const saved = { ...this.clone(current), ...this.clone(bible), updatedAt: new Date().toISOString() };
    this.bibles.set(saved.id, saved); this.byKey.set(this.key(saved.namespace, saved.seriesKey), saved);
    return this.clone(saved);
  }
  async saveSerializedSeriesBibleRevision(revision) { this.revisions.push(this.clone(revision)); return this.clone(revision); }
  async listSerializedSeriesBibleRevisions(seriesId) { return this.revisions.filter(row => row.seriesId === seriesId).map(row => this.clone(row)); }
  async bindSerializedSeriesStrategy(binding) {
    const now = new Date().toISOString();
    const current = this.bindings.get(binding.strategyId);
    const saved = { ...this.clone(current || {}), ...this.clone(binding), createdAt: current?.createdAt || now, updatedAt: now };
    this.bindings.set(saved.strategyId, saved); return this.clone(saved);
  }
  async getSerializedSeriesStrategyBinding(strategyId) { return this.clone(this.bindings.get(strategyId) || null); }
}

async function main() {
  for (const rel of [
    'utils/serialized-series-bible-v12.js',
    'agents/script-writer-agent.js',
    'database/db.js',
    'index.js'
  ]) execFileSync(process.execPath, ['--check', path.join(upstream, rel)], { stdio: 'inherit' });
  checks += 4;

  const serviceSource = read('utils/serialized-series-bible-v12.js');
  const dbSource = read('database/db.js');
  const writerSource = read('agents/script-writer-agent.js');
  const indexSource = read('index.js');
  const envSource = read('.env.example');
  const pkg = JSON.parse(read('package.json'));

  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_series_bibles'), 'Series Bible table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_series_bible_revisions'), 'Series Bible revision table missing');
  check(dbSource.includes('CREATE TABLE IF NOT EXISTS serialized_series_strategy_bindings'), 'strategy binding table missing');
  check(dbSource.includes('UNIQUE(namespace, series_key)'), 'series namespace/key uniqueness missing');
  check(dbSource.includes('revision_number = ?') && dbSource.includes('WHERE id = ? AND revision_number = ?'), 'optimistic revision update missing');
  check(dbSource.includes('saveSerializedSeriesBibleRevision'), 'revision persistence method missing');
  check(dbSource.includes('getSerializedSeriesStrategyBinding'), 'strategy binding lookup missing');
  check(writerSource.includes("require('../utils/serialized-series-bible-v12')"), 'Script Writer Series Bible import missing');
  check(writerSource.includes('await this.serializedSeriesBible.getScriptContext(strategy)'), 'Script Writer context lookup missing');
  check(writerSource.includes('${serializedSeriesPrompt}'), 'Script Writer prompt injection missing');
  check(writerSource.includes('no AI text provider is available; refusing canon-unaware template fallback'), 'serialized no-provider fallback must fail closed');
  check(writerSource.includes('Serialized script generation failed; refusing canon-unaware template fallback'), 'serialized failed-generation fallback must fail closed');
  check(indexSource.includes("this.app.post('/api/series-bibles', protect"), 'protected create Series Bible route missing');
  check(indexSource.includes("this.app.patch('/api/series-bibles/:seriesId', protect"), 'protected update Series Bible route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/advance', protect"), 'protected advance route missing');
  check(indexSource.includes("this.app.post('/api/series-bibles/:seriesId/bind-strategy', protect"), 'protected strategy binding route missing');
  check(indexSource.includes("this.app.get('/api/series-bibles/:seriesId/revisions', protect"), 'protected revisions route missing');
  check(envSource.includes('SERIALIZED_SERIES_BIBLE_ENABLED=true'), 'Series Bible env toggle missing');
  check(envSource.includes('SERIALIZED_STORY_NAMESPACE=default'), 'Series Bible namespace env missing');
  check(pkg.scripts?.['test:series-bible'] === 'node ../bootstrap/verify-phase11-serialized-series-bible.js', 'Series Bible npm test command missing');
  check(serviceSource.includes('immutable_canon_requires_explicit_retcon_reason'), 'immutable canon retcon gate missing');
  check(serviceSource.includes('episode_rewind_forbidden'), 'episode rewind protection missing');
  check(serviceSource.includes('strategy_already_bound_to_another_series'), 'silent cross-series rebind protection missing');
  check(!serviceSource.includes('strategy.topic') && !serviceSource.includes('strategy.title'), 'Series resolver must not fuzzy-match topic/title');

  const {
    SerializedSeriesBibleServiceV12,
    normalizeBible,
    seriesPromptContext,
    explicitSeriesRef
  } = require(path.join(upstream, 'utils', 'serialized-series-bible-v12.js'));

  const db = new MemoryDb();
  const service = new SerializedSeriesBibleServiceV12(db, { enabled: true, namespace: 'channel_alpha' });

  const normalized = normalizeBible({ title: '  Star   Harbor ', genres: ['Sci-Fi', 'sci-fi', ' Mystery '], premise: '  A hidden signal changes the city. ' });
  check(normalized.title === 'Star Harbor', 'title normalization failed');
  check(normalized.genres.length === 2, 'genre de-duplication failed');
  check(normalized.currentEpisode === 0, 'initial episode should be zero');
  const clearedEnding = normalizeBible({ plannedEnding: null }, { title: 'Base', premise: 'Base premise', plannedEnding: { destination: 'Old ending' } });
  check(clearedEnding.plannedEnding === null, 'explicit null must clear a previously planned ending');

  const created = await service.createBible({
    title: 'Star Harbor',
    seriesKey: 'star_harbor',
    genres: ['sci-fi', 'mystery'],
    premise: 'A coastal city receives a signal that should not exist.',
    worldRules: ['The signal can only be heard at night.'],
    immutableCanon: ['Mara lost her brother before episode one.', 'The lighthouse lens is cracked.'],
    narrativeRules: ['Never reveal the source of the signal before the midpoint.'],
    centralConflicts: ['Mara wants the truth while the council wants silence.'],
    plannedEnding: { destination: 'Mara discovers why the signal called her.' }
  }, { actor: 'test_operator' });
  check(created.status === 'created', 'Series Bible should be created');
  check(created.bible.id.startsWith('series_'), 'Series Bible deterministic id missing');
  check(created.bible.canonVersion === 1 && created.bible.revisionNumber === 1, 'initial versions incorrect');
  check(db.revisions.length === 1 && db.revisions[0].changeKind === 'create', 'creation revision missing');

  const duplicate = await service.createBible({ title: 'Different Title', seriesKey: 'star_harbor', premise: 'Different premise.' });
  check(duplicate.status === 'exists' && duplicate.bible.id === created.bible.id, 'duplicate series key should reuse existing Bible');

  const normalUpdate = await service.updateBible(created.bible.id, {
    narrativeRules: ['Never reveal the source before the midpoint.', 'Every episode must leave one unresolved question.'],
    expectedRevisionNumber: 1
  }, { actor: 'test_operator', reason: 'expand narrative rules' });
  check(normalUpdate.status === 'updated', 'normal update failed');
  check(normalUpdate.bible.revisionNumber === 2, 'normal update must increment revision');
  check(normalUpdate.bible.canonVersion === 1, 'normal update must not increment canon version');

  const stale = await service.updateBible(created.bible.id, { premise: 'stale write', expectedRevisionNumber: 1 }, { actor: 'test_operator' });
  check(stale.status === 'conflict' && stale.reason === 'stale_series_bible_revision', 'stale write must fail closed');

  const blockedRetcon = await service.updateBible(created.bible.id, {
    immutableCanon: ['Mara never had a brother.'],
    expectedRevisionNumber: 2
  }, { actor: 'test_operator' });
  check(blockedRetcon.status === 'retcon_required', 'immutable canon edit must require explicit retcon');
  const stillCanonical = await db.getSerializedSeriesBible(created.bible.id);
  check(stillCanonical.immutableCanon.includes('Mara lost her brother before episode one.'), 'blocked retcon mutated canon');

  const shortReasonRetcon = await service.updateBible(created.bible.id, {
    immutableCanon: ['Mara never had a brother.'], expectedRevisionNumber: 2, allowRetcon: true, retconReason: 'fix'
  }, { actor: 'test_operator' });
  check(shortReasonRetcon.status === 'retcon_required', 'short retcon reason must be rejected');

  const retcon = await service.updateBible(created.bible.id, {
    immutableCanon: ['Mara lost her sister before episode one.', 'The lighthouse lens is cracked.'],
    expectedRevisionNumber: 2,
    allowRetcon: true,
    retconReason: 'Approved story-room retcon: sibling identity changed before episode production.'
  }, { actor: 'showrunner' });
  check(retcon.status === 'retconned', 'explicit retcon should succeed');
  check(retcon.bible.canonVersion === 2 && retcon.bible.revisionNumber === 3, 'retcon must increment canon and revision versions');
  check(db.revisions.at(-1).changeKind === 'retcon', 'retcon revision audit missing');

  const advanced = await service.advanceEpisode(created.bible.id, 7, { actor: 'episode_commit', reason: 'episode 7 approved' });
  check(advanced.status === 'updated' && advanced.bible.currentEpisode === 7, 'episode advance failed');
  const rewind = await service.updateBible(created.bible.id, { currentEpisode: 5, expectedRevisionNumber: advanced.bible.revisionNumber }, { actor: 'test_operator' });
  check(rewind.status === 'conflict' && rewind.reason === 'episode_rewind_forbidden', 'episode rewind must fail');
  const nonAdvance = await service.advanceEpisode(created.bible.id, 7, { actor: 'test_operator' });
  check(nonAdvance.status === 'conflict' && nonAdvance.reason === 'episode_must_advance_monotonically', 'advance must be monotonic');

  const bound = await service.bindStrategy(created.bible.id, { strategyId: 'strategy_ep8', episodeNumber: 8 }, { actor: 'planner' });
  check(bound.status === 'bound' && bound.binding.episodeNumber === 8, 'strategy binding failed');
  const viaBinding = await service.getScriptContext({ id: 'strategy_ep8', topic: 'An unrelated title must not matter' });
  check(viaBinding.active === true && viaBinding.resolutionMode === 'strategy_binding', 'bound strategy resolution failed');
  check(viaBinding.promptContext.includes('TARGET EPISODE: 8'), 'bound target episode missing from prompt');
  check(viaBinding.promptContext.includes('IMMUTABLE CANON — HARD CONSTRAINTS'), 'immutable canon block missing from prompt');
  check(viaBinding.promptContext.includes('Script generation does NOT commit new canon'), 'non-commit generation rule missing');

  const explicitById = await service.getScriptContext({ seriesId: created.bible.id });
  check(explicitById.active === true && explicitById.resolutionMode === 'explicit_series_id', 'explicit series id resolution failed');
  const explicitByKey = await service.getScriptContext({ seriesKey: 'star_harbor', seriesNamespace: 'channel_alpha' });
  check(explicitByKey.active === true && explicitByKey.resolutionMode === 'explicit_series_key', 'explicit series key resolution failed');
  const unbound = await service.getScriptContext({ id: 'unbound_strategy', topic: 'Star Harbor' });
  check(unbound.active === false && unbound.promptContext === '' && unbound.resolutionMode === 'unbound', 'unbound strategy must not receive fuzzy series memory');

  const ref = explicitSeriesRef({ metadata: { serializedSeriesId: created.bible.id } });
  check(ref.seriesId === created.bible.id, 'metadata explicit series ref failed');

  const second = await service.createBible({ title: 'Moon Archive', seriesKey: 'moon_archive', premise: 'Archivists catalog impossible memories.' }, { actor: 'test_operator' });
  const blockedRebind = await service.bindStrategy(second.bible.id, { strategyId: 'strategy_ep8' }, { actor: 'test_operator' });
  check(blockedRebind.status === 'conflict' && blockedRebind.reason === 'strategy_already_bound_to_another_series', 'cross-series rebind must require explicit override');
  const allowedRebind = await service.bindStrategy(second.bible.id, { strategyId: 'strategy_ep8', allowRebind: true, reason: 'Approved operator correction to wrong series binding.' }, { actor: 'showrunner' });
  check(allowedRebind.status === 'rebound' && allowedRebind.binding.seriesId === second.bible.id, 'explicit audited rebind failed');

  const manualPrompt = seriesPromptContext(retcon.bible, { episodeNumber: 44 });
  check(manualPrompt.includes('TARGET EPISODE: 44'), 'manual prompt episode missing');
  check(manualPrompt.includes('CANON VERSION: 2'), 'manual prompt canon version missing');
  check(manualPrompt.length <= 24000, 'Series Bible prompt must be bounded');

  console.log(`Phase 11.12.1 Serialized Series Bible OK: ${checks} regression checks passed.`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
