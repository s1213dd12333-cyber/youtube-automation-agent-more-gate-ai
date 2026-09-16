'use strict';

const crypto = require('crypto');

const VERSION = '11.12.3';

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function uniqueStrings(values = [], limit = 120, itemLimit = 1800) {
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
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeMemory(input = {}, base = {}) {
  const merged = { ...base, ...input };
  return {
    id: clean(merged.id || '', 240) || null,
    seriesId: clean(merged.seriesId || '', 240) || null,
    episodeNumber: Math.max(1, Math.floor(Number(merged.episodeNumber || 1) || 1)),
    strategyId: clean(merged.strategyId || '', 240) || null,
    productionId: clean(merged.productionId || '', 240) || null,
    title: clean(merged.title || '', 400),
    summary: clean(merged.summary || '', 12000),
    discoveries: uniqueStrings(merged.discoveries || [], 120, 1800),
    establishedFacts: uniqueStrings(merged.establishedFacts || [], 240, 2200),
    resolvedQuestions: uniqueStrings(merged.resolvedQuestions || [], 160, 2200),
    unresolvedQuestions: uniqueStrings(merged.unresolvedQuestions || [], 160, 2200),
    narrativePromises: uniqueStrings(merged.narrativePromises || [], 160, 2200),
    cliffhangers: uniqueStrings(merged.cliffhangers || [], 100, 2200),
    timelineEventIds: uniqueStrings(merged.timelineEventIds || [], 500, 240),
    approvalId: clean(merged.approvalId || '', 240) || null,
    approvedBy: clean(merged.approvedBy || '', 240) || null,
    approvalReason: clean(merged.approvalReason || '', 1800),
    approvedAt: merged.approvedAt || null,
    sourceFingerprint: clean(merged.sourceFingerprint || '', 256) || null,
    revisionNumber: Math.max(1, Math.floor(Number(merged.revisionNumber || 1) || 1)),
    status: clean(merged.status || 'finalized', 40) || 'finalized'
  };
}

function validateApproval(memory = {}, options = {}) {
  const blockers = [];
  if (options.approved !== true && memory.approved !== true) blockers.push('explicit_approval_required');
  if (!memory.approvalId) blockers.push('approval_id_required');
  if (!memory.approvedBy) blockers.push('approved_by_required');
  if (clean(memory.approvalReason, 1800).length < 8) blockers.push('approval_reason_required');
  if (!memory.approvedAt) blockers.push('approved_at_required');
  return blockers;
}

function memoryPromptBlock(memory) {
  const lines = [
    `EPISODE ${memory.episodeNumber}${memory.title ? ` — ${memory.title}` : ''}`,
    `Summary: ${memory.summary || 'No summary.'}`
  ];
  const pushList = (label, values) => {
    if (values?.length) lines.push(`${label}: ${values.join(' | ')}`);
  };
  pushList('Discoveries', memory.discoveries);
  pushList('Established facts', memory.establishedFacts);
  pushList('Resolved questions', memory.resolvedQuestions);
  pushList('Unresolved questions', memory.unresolvedQuestions);
  pushList('Narrative promises', memory.narrativePromises);
  pushList('Cliffhangers', memory.cliffhangers);
  if (memory.timelineEventIds?.length) lines.push(`Timeline events: ${memory.timelineEventIds.join(', ')}`);
  return lines.join('\n');
}

function buildPromptContext({ bible, binding, memories }) {
  const targetEpisode = Math.max(1, Number(binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
  return [
    `EPISODE MEMORY LEDGER V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `LAST FINALIZED EPISODE: ${bible.currentEpisode || 0}`,
    `TARGET EPISODE: ${targetEpisode}`,
    '',
    'FINALIZED PRIOR EPISODES:',
    memories.length ? memories.map(memoryPromptBlock).join('\n\n') : '- No prior episode ledgers finalized.',
    '',
    'EPISODE MEMORY SAFETY:',
    '- These ledgers are post-approval records. Treat established facts and resolved/unresolved state as continuity memory.',
    '- Do not silently resolve an unresolved question, fulfill a promise, or discard a cliffhanger unless the new episode actually does so.',
    '- Do not infer that a rumor or uncertain timeline fact became confirmed merely because an episode mentions it.',
    '- Do not rewrite or finalize Episode Memory during script generation. This context is read-only.',
    '- The target episode itself is never loaded from the ledger while it is being written.'
  ].join('\n').slice(0, 32000);
}

class EpisodeMemoryServiceV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_EPISODE_MEMORY_ENABLED || 'true').toLowerCase() !== 'false';
    this.maxPromptEpisodes = Math.max(3, Math.min(100, Number(options.maxPromptEpisodes || process.env.SERIALIZED_EPISODE_MEMORY_PROMPT_EPISODES || 20)));
  }

  async requireSeries(seriesId) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) return { status: 'not_found', bible: null };
    if (bible.status !== 'active') return { status: 'inactive', bible };
    return { status: 'active', bible };
  }

  async finalizeEpisode(seriesId, input = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', memory: null };
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { status: series.status, memory: null, bible: series.bible };

    const memory = normalizeMemory({ ...input, seriesId });
    if (!memory.summary) return { status: 'invalid', reason: 'episode_summary_required', memory: null };
    const expectedEpisode = Number(series.bible.currentEpisode || 0) + 1;
    if (memory.episodeNumber !== expectedEpisode) {
      return { status: 'conflict', reason: 'episode_memory_must_finalize_next_episode', expectedEpisode, bible: series.bible };
    }

    const approvalBlockers = validateApproval({ ...memory, approved: input.approved }, options);
    if (approvalBlockers.length) return { status: 'approval_required', reason: approvalBlockers[0], blockers: approvalBlockers };

    if (memory.strategyId && typeof this.db.getSerializedSeriesStrategyBinding === 'function') {
      const binding = await this.db.getSerializedSeriesStrategyBinding(memory.strategyId);
      if (!binding || binding.seriesId !== seriesId || Number(binding.episodeNumber) !== memory.episodeNumber) {
        return { status: 'conflict', reason: 'strategy_binding_does_not_match_episode', binding: binding || null };
      }
    }

    const existing = await this.db.getSerializedEpisodeMemory(seriesId, memory.episodeNumber);
    if (existing) return { status: 'conflict', reason: 'episode_memory_already_finalized', memory: existing };

    const timelineEvents = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    const expectedTimelineIds = timelineEvents
      .filter(event => event.status === 'active' && Number(event.episodeNumber) === memory.episodeNumber)
      .map(event => event.id)
      .sort();
    const suppliedTimelineIds = [...memory.timelineEventIds].sort();
    if (JSON.stringify(expectedTimelineIds) !== JSON.stringify(suppliedTimelineIds)) {
      return { status: 'conflict', reason: 'episode_memory_timeline_set_mismatch', expectedTimelineIds, suppliedTimelineIds };
    }

    if (!memory.sourceFingerprint) {
      memory.sourceFingerprint = hash(JSON.stringify(stable({
        episodeNumber: memory.episodeNumber,
        strategyId: memory.strategyId,
        productionId: memory.productionId,
        summary: memory.summary,
        timelineEventIds: memory.timelineEventIds
      })));
    }
    memory.id = memory.id || `episode_memory_${hash(`${seriesId}:${memory.episodeNumber}`).slice(0, 20)}`;

    const reason = clean(options.reason || input.reason || memory.approvalReason, 1800);
    const actor = clean(options.actor || input.actor || memory.approvedBy, 240) || memory.approvedBy;
    try {
      const result = await this.db.finalizeSerializedEpisodeMemoryAtomic({
        seriesId,
        memory,
        expectedBibleRevision: options.expectedBibleRevision ?? input.expectedBibleRevision ?? series.bible.revisionNumber,
        actor,
        reason
      });
      return { status: 'finalized', ...result };
    } catch (error) {
      const message = String(error?.message || error);
      const map = {
        episode_memory_bible_revision_conflict: 'conflict',
        episode_memory_must_finalize_next_episode: 'conflict',
        episode_memory_already_finalized: 'conflict',
        episode_memory_timeline_set_mismatch: 'conflict',
        episode_memory_series_not_found: 'not_found',
        episode_memory_series_inactive: 'inactive'
      };
      if (map[message]) return { status: map[message], reason: message, bible: await this.db.getSerializedSeriesBible(seriesId) };
      throw error;
    }
  }

  async amendEpisode(seriesId, episodeNumber, patch = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', memory: null };
    const existing = await this.db.getSerializedEpisodeMemory(seriesId, episodeNumber);
    if (!existing) return { status: 'not_found', memory: null };
    const reason = clean(options.reason || patch.amendmentReason || patch.changeReason || '', 1800);
    if (options.allowAmendment !== true && patch.allowAmendment !== true) {
      return { status: 'amendment_required', reason: 'episode_memory_is_append_only', memory: existing };
    }
    if (reason.length < 8) return { status: 'amendment_required', reason: 'episode_memory_amendment_reason_required', memory: existing };

    const expectedRevision = Number(options.expectedRevision ?? patch.expectedRevision ?? existing.revisionNumber);
    if (expectedRevision !== Number(existing.revisionNumber)) {
      return { status: 'conflict', reason: 'episode_memory_revision_conflict', memory: existing };
    }

    const memory = normalizeMemory({
      ...existing,
      ...patch,
      id: existing.id,
      seriesId,
      episodeNumber: existing.episodeNumber,
      approvalId: existing.approvalId,
      approvedBy: existing.approvedBy,
      approvalReason: existing.approvalReason,
      approvedAt: existing.approvedAt,
      revisionNumber: existing.revisionNumber
    });
    if (!memory.summary) return { status: 'invalid', reason: 'episode_summary_required', memory: existing };

    const timelineEvents = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    const expectedTimelineIds = timelineEvents
      .filter(event => event.status === 'active' && Number(event.episodeNumber) === existing.episodeNumber)
      .map(event => event.id)
      .sort();
    if (JSON.stringify(expectedTimelineIds) !== JSON.stringify([...memory.timelineEventIds].sort())) {
      return { status: 'conflict', reason: 'episode_memory_timeline_set_mismatch', expectedTimelineIds };
    }

    try {
      const result = await this.db.amendSerializedEpisodeMemoryAtomic({
        seriesId,
        memory,
        expectedRevision,
        actor: clean(options.actor || patch.actor || 'operator', 240) || 'operator',
        reason
      });
      return { status: 'amended', ...result };
    } catch (error) {
      const message = String(error?.message || error);
      if (message === 'episode_memory_revision_conflict') return { status: 'conflict', reason: message, memory: await this.db.getSerializedEpisodeMemory(seriesId, episodeNumber) };
      if (message === 'episode_memory_timeline_set_mismatch') return { status: 'conflict', reason: message, memory: existing };
      if (message === 'episode_memory_not_found') return { status: 'not_found', memory: null };
      throw error;
    }
  }

  async validateSeries(seriesId) {
    const series = await this.requireSeries(seriesId);
    if (series.status === 'not_found') return { valid: false, blockers: [{ code: 'series_not_found' }] };
    const memories = await this.db.listSerializedEpisodeMemories(seriesId, 2000);
    const timeline = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    const blockers = [];
    const byEpisode = new Map(memories.map(memory => [Number(memory.episodeNumber), memory]));
    for (let episode = 1; episode <= Number(series.bible.currentEpisode || 0); episode += 1) {
      if (!byEpisode.has(episode)) blockers.push({ code: 'finalized_episode_memory_missing', episodeNumber: episode });
    }
    for (const memory of memories) {
      const actual = timeline.filter(event => event.status === 'active' && Number(event.episodeNumber) === memory.episodeNumber).map(event => event.id).sort();
      const recorded = [...(memory.timelineEventIds || [])].sort();
      if (JSON.stringify(actual) !== JSON.stringify(recorded)) blockers.push({ code: 'episode_timeline_set_drift', episodeNumber: memory.episodeNumber });
    }
    return { valid: blockers.length === 0, blockers, finalizedEpisodeCount: memories.length, currentEpisode: Number(series.bible.currentEpisode || 0) };
  }

  async getScriptContext(serializedSeriesContext = {}) {
    if (!this.enabled || !serializedSeriesContext?.active || !serializedSeriesContext?.bible) {
      return { active: false, version: VERSION, promptContext: '', memories: [] };
    }
    const bible = serializedSeriesContext.bible;
    const validation = await this.validateSeries(bible.id);
    if (!validation.valid) {
      const codes = validation.blockers.slice(0, 8).map(item => item.code).join(', ');
      throw new Error(`Episode Memory invalid for ${bible.id}: ${codes}`);
    }
    const targetEpisode = Math.max(1, Number(serializedSeriesContext.binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
    const all = await this.db.listSerializedEpisodeMemories(bible.id, 2000);
    const prior = all
      .filter(memory => memory.status === 'finalized' && Number(memory.episodeNumber) < targetEpisode)
      .sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
    const memories = prior.slice(Math.max(0, prior.length - this.maxPromptEpisodes));
    return {
      active: true,
      version: VERSION,
      bible,
      binding: serializedSeriesContext.binding || null,
      targetEpisode,
      memories,
      validation,
      promptContext: buildPromptContext({ bible, binding: serializedSeriesContext.binding, memories })
    };
  }
}

module.exports = {
  EPISODE_MEMORY_VERSION: VERSION,
  EpisodeMemoryServiceV12,
  normalizeMemory,
  validateApproval,
  buildPromptContext
};
