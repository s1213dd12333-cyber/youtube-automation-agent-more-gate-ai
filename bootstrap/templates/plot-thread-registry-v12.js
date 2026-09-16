'use strict';

const crypto = require('crypto');

const VERSION = '11.12.6';
const THREAD_STATUSES = new Set(['open', 'dormant', 'resolved', 'cancelled']);
const THREAD_TYPES = new Set(['main', 'subplot', 'mystery', 'character', 'relationship', 'world', 'quest', 'other']);
const TERMINAL_STATUSES = new Set(['resolved', 'cancelled']);

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

function uniqueStrings(values = [], limit = 160, itemLimit = 2200) {
  const source = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  for (const value of source.slice(0, limit * 2)) {
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

function bounded(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number(fallback || 0);
  return Math.max(min, Math.min(max, Math.round(numeric)));
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

function normalizeThread(input = {}, base = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(input, key);
  const merged = { ...base, ...input };
  const statusRaw = clean(has('status') ? input.status : base.status || 'open', 40).toLowerCase();
  const typeRaw = clean(has('threadType') ? input.threadType : base.threadType || 'other', 80).toLowerCase();
  const charKeys = uniqueStrings(has('involvedCharacterKeys') ? input.involvedCharacterKeys : base.involvedCharacterKeys || [], 120, 240)
    .map(slug).filter(Boolean);
  const edgeKeys = uniqueStrings(has('relationshipEdgeKeys') ? input.relationshipEdgeKeys : base.relationshipEdgeKeys || [], 120, 420)
    .map(normalizeRelationshipEdge).filter(Boolean);
  return {
    id: clean(merged.id || '', 240) || null,
    seriesId: clean(merged.seriesId || '', 240) || null,
    threadKey: slug(has('threadKey') ? input.threadKey : base.threadKey),
    title: clean(has('title') ? input.title : base.title, 500),
    threadType: THREAD_TYPES.has(typeRaw) ? typeRaw : 'other',
    priority: bounded(has('priority') ? input.priority : base.priority, 0, 100, 50),
    premise: clean(has('premise') ? input.premise : base.premise, 5000),
    centralQuestion: clean(has('centralQuestion') ? input.centralQuestion : base.centralQuestion, 3000),
    stakes: clean(has('stakes') ? input.stakes : base.stakes, 5000),
    currentState: clean(has('currentState') ? input.currentState : base.currentState, 6000),
    openQuestions: uniqueStrings(has('openQuestions') ? input.openQuestions : base.openQuestions || [], 180, 2200),
    resolvedQuestions: uniqueStrings(has('resolvedQuestions') ? input.resolvedQuestions : base.resolvedQuestions || [], 240, 2200),
    narrativePromises: uniqueStrings(has('narrativePromises') ? input.narrativePromises : base.narrativePromises || [], 180, 2200),
    establishedClues: uniqueStrings(has('establishedClues') ? input.establishedClues : base.establishedClues || [], 240, 2200),
    redHerrings: uniqueStrings(has('redHerrings') ? input.redHerrings : base.redHerrings || [], 160, 2200),
    requiredPayoffs: uniqueStrings(has('requiredPayoffs') ? input.requiredPayoffs : base.requiredPayoffs || [], 180, 2200),
    involvedCharacterKeys: uniqueStrings(charKeys, 120, 240),
    relationshipEdgeKeys: uniqueStrings(edgeKeys, 120, 420),
    resolutionSummary: clean(has('resolutionSummary') ? input.resolutionSummary : base.resolutionSummary, 6000),
    notes: clean(has('notes') ? input.notes : base.notes, 6000),
    introducedEpisodeNumber: Math.max(0, Math.floor(Number(merged.introducedEpisodeNumber || 0) || 0)),
    lastAdvancedEpisodeNumber: Math.max(0, Math.floor(Number(merged.lastAdvancedEpisodeNumber || 0) || 0)),
    resolvedEpisodeNumber: Math.max(0, Math.floor(Number(merged.resolvedEpisodeNumber || 0) || 0)),
    revisionNumber: Math.max(0, Math.floor(Number(merged.revisionNumber || 0) || 0)),
    status: THREAD_STATUSES.has(statusRaw) ? statusRaw : 'open',
    createdAt: merged.createdAt || null,
    updatedAt: merged.updatedAt || null
  };
}

function snapshotThread(thread = {}) {
  return stable({
    id: thread.id,
    seriesId: thread.seriesId,
    threadKey: thread.threadKey,
    title: thread.title || '',
    threadType: thread.threadType || 'other',
    priority: Number(thread.priority || 0),
    premise: thread.premise || '',
    centralQuestion: thread.centralQuestion || '',
    stakes: thread.stakes || '',
    currentState: thread.currentState || '',
    openQuestions: thread.openQuestions || [],
    resolvedQuestions: thread.resolvedQuestions || [],
    narrativePromises: thread.narrativePromises || [],
    establishedClues: thread.establishedClues || [],
    redHerrings: thread.redHerrings || [],
    requiredPayoffs: thread.requiredPayoffs || [],
    involvedCharacterKeys: thread.involvedCharacterKeys || [],
    relationshipEdgeKeys: thread.relationshipEdgeKeys || [],
    resolutionSummary: thread.resolutionSummary || '',
    notes: thread.notes || '',
    introducedEpisodeNumber: Number(thread.introducedEpisodeNumber || 0),
    lastAdvancedEpisodeNumber: Number(thread.lastAdvancedEpisodeNumber || 0),
    resolvedEpisodeNumber: Number(thread.resolvedEpisodeNumber || 0),
    revisionNumber: Number(thread.revisionNumber || 0),
    status: thread.status || 'open'
  });
}

function promptThread(thread = {}) {
  const lines = [
    `PLOT THREAD ${thread.threadKey}${thread.title ? ` — ${thread.title}` : ''}`,
    `Type: ${thread.threadType || 'other'} | Status: ${thread.status || 'open'} | Priority: ${thread.priority || 0}`,
    `Introduced: episode ${thread.introducedEpisodeNumber || 0} | Last advanced: episode ${thread.lastAdvancedEpisodeNumber || 0}`
  ];
  if (thread.premise) lines.push(`Premise: ${thread.premise}`);
  if (thread.centralQuestion) lines.push(`Central question: ${thread.centralQuestion}`);
  if (thread.stakes) lines.push(`Stakes: ${thread.stakes}`);
  if (thread.currentState) lines.push(`Current state: ${thread.currentState}`);
  const push = (label, values) => { if (values?.length) lines.push(`${label}: ${values.join(' | ')}`); };
  push('Open questions', thread.openQuestions);
  push('Resolved questions', thread.resolvedQuestions);
  push('Narrative promises', thread.narrativePromises);
  push('Established clues', thread.establishedClues);
  push('Red herrings', thread.redHerrings);
  push('Required payoffs', thread.requiredPayoffs);
  push('Characters', thread.involvedCharacterKeys);
  push('Relationship edges', thread.relationshipEdgeKeys);
  if (thread.notes) lines.push(`Notes: ${thread.notes}`);
  return lines.join('\n');
}

function buildPromptContext({ bible, binding, threads }) {
  const targetEpisode = Math.max(1, Number(binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
  return [
    `PLOT THREAD REGISTRY V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `LAST FINALIZED EPISODE: ${bible.currentEpisode || 0}`,
    `TARGET EPISODE: ${targetEpisode}`,
    '',
    'ACTIVE NARRATIVE THREADS:',
    threads.length ? threads.map(promptThread).join('\n\n') : '- No open or dormant plot threads committed.',
    '',
    'PLOT THREAD SAFETY:',
    '- A plot thread is an explicit canonical registry entry. Never create a thread merely because two events seem related.',
    '- Open questions, narrative promises and required payoffs remain obligations until a finalized episode explicitly advances or resolves them.',
    '- Dormant means intentionally inactive for now, not resolved. Do not silently discard dormant threads.',
    '- Resolved and cancelled threads are terminal history and are not reopened by script generation.',
    '- Character and relationship references are exact same-series bindings; do not substitute similarly named entities.',
    '- Script generation is read-only. It may propose beats, but it cannot create, advance, dormancy-toggle, resolve or cancel registry state.',
    '- Registry mutations happen only after finalized Episode Memory and explicit approved commit/amendment operations.'
  ].join('\n').slice(0, 42000);
}

class PlotThreadRegistryServiceV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_PLOT_THREAD_REGISTRY_ENABLED || 'true').toLowerCase() !== 'false';
    this.maxPromptThreads = Math.max(5, Math.min(120, Number(options.maxPromptThreads || process.env.SERIALIZED_PLOT_THREAD_PROMPT_LIMIT || 40)));
  }

  async requireSeries(seriesId) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) return { status: 'not_found', bible: null };
    if (bible.status !== 'active') return { status: 'inactive', bible };
    return { status: 'active', bible };
  }

  async validateReferences(seriesId, episodeNumber, thread) {
    for (const characterKey of thread.involvedCharacterKeys || []) {
      const arc = await this.db.getSerializedCharacterArc(seriesId, characterKey);
      if (!arc) return { status: 'conflict', reason: 'plot_thread_character_arc_not_found', characterKey };
      if (Number(arc.firstEpisodeNumber || 0) > Number(episodeNumber)) {
        return { status: 'conflict', reason: 'plot_thread_character_not_introduced_yet', characterKey };
      }
    }
    for (const edgeKey of thread.relationshipEdgeKeys || []) {
      const [sourceKey, targetKey] = edgeKey.split('->');
      const relationship = await this.db.getSerializedRelationshipState(seriesId, sourceKey, targetKey);
      if (!relationship) return { status: 'conflict', reason: 'plot_thread_relationship_edge_not_found', edgeKey };
      if (Number(relationship.firstEpisodeNumber || 0) > Number(episodeNumber)) {
        return { status: 'conflict', reason: 'plot_thread_relationship_not_established_yet', edgeKey };
      }
    }
    return { status: 'valid' };
  }

  async prepareUpdate(seriesId, episodeNumber, raw = {}) {
    const threadKey = slug(raw.threadKey || '');
    if (!threadKey) return { status: 'invalid', reason: 'plot_thread_key_required' };
    const existing = await this.db.getSerializedPlotThread(seriesId, threadKey);
    if (existing && TERMINAL_STATUSES.has(existing.status)) {
      return { status: 'conflict', reason: 'plot_thread_terminal_state_is_immutable', thread: existing };
    }
    const thread = normalizeThread({
      ...raw,
      seriesId,
      threadKey,
      introducedEpisodeNumber: existing?.introducedEpisodeNumber || episodeNumber,
      lastAdvancedEpisodeNumber: episodeNumber,
      resolvedEpisodeNumber: TERMINAL_STATUSES.has(clean(raw.status || existing?.status || 'open', 40).toLowerCase()) ? episodeNumber : 0,
      revisionNumber: existing?.revisionNumber || 0
    }, existing || {});
    thread.id = existing?.id || `serialized_plot_thread_${hash(`${seriesId}:${threadKey}`).slice(0, 20)}`;
    if (!thread.title) return { status: 'invalid', reason: 'plot_thread_title_required' };
    if (TERMINAL_STATUSES.has(thread.status) && clean(thread.resolutionSummary, 6000).length < 8) {
      return { status: 'invalid', reason: 'plot_thread_resolution_summary_required' };
    }
    const refs = await this.validateReferences(seriesId, episodeNumber, thread);
    if (refs.status !== 'valid') return refs;
    return { status: 'ready', thread, existing };
  }

  async commitEpisodeThreads(seriesId, episodeNumber, updates = [], options = {}) {
    if (!this.enabled) return { status: 'disabled', threads: [] };
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { status: series.status, threads: [], bible: series.bible };
    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));
    const source = Array.isArray(updates) ? updates : [updates];
    if (!source.length) return { status: 'invalid', reason: 'plot_thread_updates_required' };
    const keys = new Set();
    for (const raw of source) {
      const key = slug(raw?.threadKey || '');
      if (!key) return { status: 'invalid', reason: 'plot_thread_key_required' };
      if (keys.has(key)) return { status: 'conflict', reason: 'duplicate_plot_thread_key_in_commit', threadKey: key };
      keys.add(key);
    }
    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);
    if (!memory || memory.status !== 'finalized') return { status: 'conflict', reason: 'finalized_episode_memory_required', episodeNumber: ep };
    const reason = clean(options.reason || '', 1800);
    if (reason.length < 8) return { status: 'reason_required', reason: 'plot_thread_commit_reason_required' };
    const actor = clean(options.actor || 'operator', 240) || 'operator';
    const currentEpisode = Number(series.bible.currentEpisode || 0);
    if (ep > currentEpisode) return { status: 'conflict', reason: 'plot_thread_future_episode_not_finalized' };
    const backfill = ep < currentEpisode;
    if (backfill && options.allowBackfill !== true) return { status: 'conflict', reason: 'plot_thread_backfill_requires_explicit_approval' };

    const prepared = [];
    for (const raw of source) {
      const item = await this.prepareUpdate(seriesId, ep, raw);
      if (item.status !== 'ready') return item;
      const relevantTimelineEventIds = uniqueStrings(raw.relevantTimelineEventIds || [], 500, 240);
      prepared.push({
        thread: item.thread,
        expectedRevision: Number(raw.expectedRevision ?? item.existing?.revisionNumber ?? 0),
        relevantTimelineEventIds,
        changeSummary: clean(raw.changeSummary || '', 2200)
      });
    }
    try {
      const result = await this.db.commitSerializedPlotThreadsAtomic({
        seriesId,
        episodeNumber: ep,
        episodeMemoryId: memory.id,
        updates: prepared,
        allowBackfill: options.allowBackfill === true,
        actor,
        reason
      });
      return { status: 'committed', ...result };
    } catch (error) {
      const message = String(error?.message || error);
      const known = new Set([
        'plot_thread_series_not_found', 'plot_thread_series_inactive', 'plot_thread_future_episode_not_finalized',
        'plot_thread_backfill_requires_explicit_approval', 'finalized_episode_memory_required', 'plot_thread_revision_conflict',
        'plot_thread_historical_insert_has_later_commit', 'plot_thread_episode_already_committed',
        'plot_thread_timeline_reference_outside_episode_memory', 'plot_thread_terminal_state_is_immutable'
      ]);
      if (known.has(message)) return { status: 'conflict', reason: message };
      throw error;
    }
  }

  async amendEpisodeThread(seriesId, threadKeyValue, episodeNumber, patch = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', thread: null };
    const threadKey = slug(threadKeyValue || patch.threadKey || '');
    const existing = await this.db.getSerializedPlotThread(seriesId, threadKey);
    if (!existing) return { status: 'not_found', thread: null };
    if (patch.threadKey && slug(patch.threadKey) !== existing.threadKey) {
      return { status: 'conflict', reason: 'plot_thread_key_is_immutable', thread: existing };
    }
    const reason = clean(options.reason || patch.amendmentReason || patch.changeReason || '', 1800);
    if (options.allowAmendment !== true && patch.allowAmendment !== true) {
      return { status: 'amendment_required', reason: 'plot_thread_history_is_append_only', thread: existing };
    }
    if (reason.length < 8) return { status: 'amendment_required', reason: 'plot_thread_amendment_reason_required', thread: existing };
    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));
    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);
    if (!memory || memory.status !== 'finalized') return { status: 'conflict', reason: 'finalized_episode_memory_required' };
    const expectedRevision = Number(options.expectedRevision ?? patch.expectedRevision ?? existing.revisionNumber);
    if (expectedRevision !== Number(existing.revisionNumber)) return { status: 'conflict', reason: 'plot_thread_revision_conflict', thread: existing };
    const desiredStatus = clean(Object.prototype.hasOwnProperty.call(patch, 'status') ? patch.status : existing.status, 40).toLowerCase();
    const thread = normalizeThread({
      ...existing,
      ...patch,
      id: existing.id,
      seriesId,
      threadKey: existing.threadKey,
      introducedEpisodeNumber: existing.introducedEpisodeNumber,
      lastAdvancedEpisodeNumber: existing.lastAdvancedEpisodeNumber,
      resolvedEpisodeNumber: TERMINAL_STATUSES.has(desiredStatus) ? ep : 0,
      revisionNumber: existing.revisionNumber
    }, existing);
    if (TERMINAL_STATUSES.has(thread.status) && clean(thread.resolutionSummary, 6000).length < 8) {
      return { status: 'invalid', reason: 'plot_thread_resolution_summary_required' };
    }
    const refs = await this.validateReferences(seriesId, ep, thread);
    if (refs.status !== 'valid') return refs;
    const relevantTimelineEventIds = uniqueStrings(patch.relevantTimelineEventIds || [], 500, 240);
    try {
      const result = await this.db.amendSerializedPlotThreadAtomic({
        seriesId,
        episodeNumber: ep,
        episodeMemoryId: memory.id,
        thread,
        expectedRevision,
        relevantTimelineEventIds,
        changeSummary: clean(patch.changeSummary || '', 2200),
        actor: clean(options.actor || patch.actor || 'operator', 240) || 'operator',
        reason
      });
      return { status: 'amended', ...result };
    } catch (error) {
      const message = String(error?.message || error);
      const known = new Set([
        'plot_thread_not_found', 'plot_thread_revision_conflict', 'plot_thread_key_is_immutable',
        'historical_plot_thread_amendment_blocked_by_later_state', 'finalized_episode_memory_required',
        'plot_thread_timeline_reference_outside_episode_memory'
      ]);
      if (known.has(message)) return { status: 'conflict', reason: message, thread: await this.db.getSerializedPlotThread(seriesId, threadKey) };
      throw error;
    }
  }

  async validateSeries(seriesId) {
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { valid: false, blockers: [{ code: `series_${series.status}` }], threadCount: 0 };
    const threads = await this.db.listSerializedPlotThreads(seriesId, 5000, true);
    const blockers = [];
    for (const thread of threads) {
      if (!thread.threadKey || !thread.title) blockers.push({ code: 'plot_thread_identity_invalid', threadKey: thread.threadKey || null });
      if (thread.introducedEpisodeNumber > thread.lastAdvancedEpisodeNumber) blockers.push({ code: 'plot_thread_episode_order_invalid', threadKey: thread.threadKey });
      if (thread.lastAdvancedEpisodeNumber > Number(series.bible.currentEpisode || 0)) blockers.push({ code: 'plot_thread_future_state', threadKey: thread.threadKey });
      if (TERMINAL_STATUSES.has(thread.status) && (!thread.resolutionSummary || thread.resolvedEpisodeNumber !== thread.lastAdvancedEpisodeNumber)) {
        blockers.push({ code: 'plot_thread_terminal_state_invalid', threadKey: thread.threadKey });
      }
      const refs = await this.validateReferences(seriesId, thread.lastAdvancedEpisodeNumber || thread.introducedEpisodeNumber || 1, thread);
      if (refs.status !== 'valid') blockers.push({ code: refs.reason, threadKey: thread.threadKey, ref: refs.characterKey || refs.edgeKey || null });
      const latest = await this.db.getLatestSerializedPlotThreadCommit(thread.id);
      if (!latest || Number(latest.threadRevisionNumber || 0) !== Number(thread.revisionNumber || 0)) {
        blockers.push({ code: 'plot_thread_latest_commit_revision_mismatch', threadKey: thread.threadKey });
      } else if (JSON.stringify(stable(latest.afterSnapshot || {})) !== JSON.stringify(snapshotThread(thread))) {
        blockers.push({ code: 'plot_thread_current_state_drift', threadKey: thread.threadKey });
      }
    }
    return { valid: blockers.length === 0, blockers, threadCount: threads.length };
  }

  async getScriptContext(serializedSeriesContext) {
    if (!this.enabled || !serializedSeriesContext?.active || !serializedSeriesContext?.bible) {
      return { active: false, threads: [], promptContext: '' };
    }
    const bible = serializedSeriesContext.bible;
    const validation = await this.validateSeries(bible.id);
    if (!validation.valid) {
      const error = new Error('plot_thread_registry_invalid');
      error.blockers = validation.blockers;
      throw error;
    }
    const all = await this.db.listSerializedPlotThreads(bible.id, 5000, true);
    const threads = all
      .filter(thread => thread.status === 'open' || thread.status === 'dormant')
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0)
        || Number(b.lastAdvancedEpisodeNumber || 0) - Number(a.lastAdvancedEpisodeNumber || 0)
        || String(a.threadKey).localeCompare(String(b.threadKey)))
      .slice(0, this.maxPromptThreads);
    return {
      active: true,
      threads,
      promptContext: buildPromptContext({ bible, binding: serializedSeriesContext.binding || {}, threads })
    };
  }
}

module.exports = {
  PLOT_THREAD_REGISTRY_VERSION: VERSION,
  PlotThreadRegistryServiceV12,
  normalizeThread,
  snapshotThread,
  buildPromptContext,
  slug,
  normalizeRelationshipEdge,
  stable
};
