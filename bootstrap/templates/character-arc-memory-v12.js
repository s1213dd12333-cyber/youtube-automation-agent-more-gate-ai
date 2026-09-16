'use strict';

const crypto = require('crypto');

const VERSION = '11.12.4';
const ARC_STATUSES = new Set(['active', 'retired']);

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
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeArc(input = {}, base = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(input, key);
  const merged = { ...base, ...input };
  const rawKey = has('characterKey') ? input.characterKey : base.characterKey;
  const characterKey = slug(rawKey || merged.displayName || '');
  const status = clean(merged.status || 'active', 40).toLowerCase();
  return {
    id: clean(merged.id || '', 240) || null,
    seriesId: clean(merged.seriesId || '', 240) || null,
    characterKey,
    displayName: clean(has('displayName') ? input.displayName : base.displayName, 240),
    persistentCharacterId: clean(has('persistentCharacterId') ? input.persistentCharacterId : base.persistentCharacterId, 240) || null,
    persistentCharacterFingerprint: clean(has('persistentCharacterFingerprint') ? input.persistentCharacterFingerprint : base.persistentCharacterFingerprint, 256) || null,
    arcPhase: clean(has('arcPhase') ? input.arcPhase : base.arcPhase, 240),
    storyStatus: clean(has('storyStatus') ? input.storyStatus : base.storyStatus || 'active', 160) || 'active',
    emotionalState: clean(has('emotionalState') ? input.emotionalState : base.emotionalState, 2400),
    moralState: clean(has('moralState') ? input.moralState : base.moralState, 2400),
    physicalCondition: clean(has('physicalCondition') ? input.physicalCondition : base.physicalCondition, 2400),
    goals: uniqueStrings(has('goals') ? input.goals : base.goals || [], 80, 1800),
    motivations: uniqueStrings(has('motivations') ? input.motivations : base.motivations || [], 80, 1800),
    beliefs: uniqueStrings(has('beliefs') ? input.beliefs : base.beliefs || [], 160, 2200),
    knowledge: uniqueStrings(has('knowledge') ? input.knowledge : base.knowledge || [], 240, 2200),
    secrets: uniqueStrings(has('secrets') ? input.secrets : base.secrets || [], 160, 2200),
    innerConflicts: uniqueStrings(has('innerConflicts') ? input.innerConflicts : base.innerConflicts || [], 100, 2200),
    commitments: uniqueStrings(has('commitments') ? input.commitments : base.commitments || [], 120, 2200),
    milestones: uniqueStrings(has('milestones') ? input.milestones : base.milestones || [], 200, 2200),
    notes: clean(has('notes') ? input.notes : base.notes, 6000),
    firstEpisodeNumber: Math.max(0, Math.floor(Number(merged.firstEpisodeNumber || 0) || 0)),
    lastEpisodeNumber: Math.max(0, Math.floor(Number(merged.lastEpisodeNumber || 0) || 0)),
    revisionNumber: Math.max(0, Math.floor(Number(merged.revisionNumber || 0) || 0)),
    status: ARC_STATUSES.has(status) ? status : 'active',
    createdAt: merged.createdAt || null,
    updatedAt: merged.updatedAt || null
  };
}

function snapshotArc(arc = {}) {
  return stable({
    id: arc.id,
    seriesId: arc.seriesId,
    characterKey: arc.characterKey,
    displayName: arc.displayName,
    persistentCharacterId: arc.persistentCharacterId || null,
    persistentCharacterFingerprint: arc.persistentCharacterFingerprint || null,
    arcPhase: arc.arcPhase || '',
    storyStatus: arc.storyStatus || 'active',
    emotionalState: arc.emotionalState || '',
    moralState: arc.moralState || '',
    physicalCondition: arc.physicalCondition || '',
    goals: arc.goals || [],
    motivations: arc.motivations || [],
    beliefs: arc.beliefs || [],
    knowledge: arc.knowledge || [],
    secrets: arc.secrets || [],
    innerConflicts: arc.innerConflicts || [],
    commitments: arc.commitments || [],
    milestones: arc.milestones || [],
    notes: arc.notes || '',
    firstEpisodeNumber: Number(arc.firstEpisodeNumber || 0),
    lastEpisodeNumber: Number(arc.lastEpisodeNumber || 0),
    revisionNumber: Number(arc.revisionNumber || 0),
    status: arc.status || 'active'
  });
}

function promptArc(arc = {}) {
  const lines = [
    `CHARACTER ${arc.characterKey}${arc.displayName ? ` — ${arc.displayName}` : ''}`,
    `Last arc commit: episode ${arc.lastEpisodeNumber || 0}`,
    `Arc phase: ${arc.arcPhase || 'unspecified'}`,
    `Story status: ${arc.storyStatus || 'active'}`,
    `Emotional state: ${arc.emotionalState || 'unspecified'}`,
    `Moral/worldview state: ${arc.moralState || 'unspecified'}`,
    `Physical condition: ${arc.physicalCondition || 'unspecified'}`
  ];
  const push = (label, values) => { if (values?.length) lines.push(`${label}: ${values.join(' | ')}`); };
  push('Goals', arc.goals);
  push('Motivations', arc.motivations);
  push('Beliefs', arc.beliefs);
  push('Knowledge', arc.knowledge);
  push('Secrets known/held by this character', arc.secrets);
  push('Inner conflicts', arc.innerConflicts);
  push('Commitments', arc.commitments);
  push('Milestones', arc.milestones);
  if (arc.notes) lines.push(`Arc notes: ${arc.notes}`);
  if (arc.persistentCharacterId) lines.push(`Visual persistent character: ${arc.persistentCharacterId}`);
  return lines.join('\n');
}

function buildPromptContext({ bible, binding, arcs }) {
  const targetEpisode = Math.max(1, Number(binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
  return [
    `CHARACTER ARC MEMORY V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `LAST FINALIZED EPISODE: ${bible.currentEpisode || 0}`,
    `TARGET EPISODE: ${targetEpisode}`,
    '',
    'CURRENT CHARACTER ARC STATES:',
    arcs.length ? arcs.map(promptArc).join('\n\n') : '- No character arcs committed yet.',
    '',
    'CHARACTER ARC SAFETY:',
    '- This is author-level continuity memory, not shared in-world knowledge.',
    '- A character may act on its own Knowledge and Beliefs plus information actually learned in the target episode.',
    '- Never transfer a Secret, Knowledge item, Belief, or discovery from one character to another unless the story explicitly communicates it.',
    '- Respect persistent injury/condition, story status, goals, commitments, beliefs, milestones and established arc phase until the story changes them.',
    '- Do not infer relationship changes from arc state; relationship memory belongs to the Relationship State Graph layer.',
    '- Script generation is read-only. Character Arc Memory changes only after an Episode Memory has been finalized and an explicit arc commit is approved.'
  ].join('\n').slice(0, 36000);
}

class CharacterArcMemoryServiceV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_CHARACTER_ARC_MEMORY_ENABLED || 'true').toLowerCase() !== 'false';
    this.maxPromptArcs = Math.max(5, Math.min(100, Number(options.maxPromptArcs || process.env.SERIALIZED_CHARACTER_ARC_PROMPT_LIMIT || 40)));
  }

  async requireSeries(seriesId) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) return { status: 'not_found', bible: null };
    if (bible.status !== 'active') return { status: 'inactive', bible };
    return { status: 'active', bible };
  }

  async resolvePersistentCharacter(persistentCharacterId) {
    if (!persistentCharacterId) return { status: 'none', character: null };
    if (typeof this.db.getPersistentCharacter !== 'function') return { status: 'invalid', reason: 'persistent_character_registry_unavailable', character: null };
    const character = await this.db.getPersistentCharacter(persistentCharacterId);
    if (!character) return { status: 'not_found', reason: 'persistent_character_not_found', character: null };
    if (character.status !== 'active') return { status: 'inactive', reason: 'persistent_character_inactive', character };
    return { status: 'active', character };
  }

  async prepareUpdate(seriesId, episodeNumber, raw = {}, options = {}) {
    const characterKey = slug(raw.characterKey || '');
    if (!characterKey) return { status: 'invalid', reason: 'character_key_required' };
    const existing = await this.db.getSerializedCharacterArc(seriesId, characterKey);
    const persistentId = Object.prototype.hasOwnProperty.call(raw, 'persistentCharacterId')
      ? clean(raw.persistentCharacterId, 240) || null
      : existing?.persistentCharacterId || null;
    const resolved = await this.resolvePersistentCharacter(persistentId);
    if (!['none', 'active'].includes(resolved.status)) return { status: 'conflict', reason: resolved.reason, persistentCharacter: resolved.character || null };

    if (existing?.persistentCharacterId && persistentId && existing.persistentCharacterId !== persistentId) {
      const rebindReason = clean(options.rebindReason || raw.rebindReason || options.reason || '', 1800);
      if (options.allowRebind !== true && raw.allowRebind !== true) return { status: 'conflict', reason: 'character_arc_visual_rebind_requires_explicit_approval' };
      if (rebindReason.length < 8) return { status: 'conflict', reason: 'character_arc_visual_rebind_reason_required' };
    }

    const arc = normalizeArc({
      ...raw,
      seriesId,
      characterKey,
      persistentCharacterId: persistentId,
      persistentCharacterFingerprint: resolved.character?.identityFingerprint || existing?.persistentCharacterFingerprint || null,
      firstEpisodeNumber: existing?.firstEpisodeNumber || episodeNumber,
      lastEpisodeNumber: episodeNumber,
      revisionNumber: existing?.revisionNumber || 0
    }, existing || {});
    if (!arc.displayName) return { status: 'invalid', reason: 'character_display_name_required' };
    arc.id = existing?.id || `serialized_character_arc_${hash(`${seriesId}:${characterKey}`).slice(0, 20)}`;
    return { status: 'ready', arc, existing, persistentCharacter: resolved.character || null };
  }

  async commitEpisodeArcs(seriesId, episodeNumber, updates = [], options = {}) {
    if (!this.enabled) return { status: 'disabled', arcs: [] };
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { status: series.status, arcs: [], bible: series.bible };
    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));
    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);
    if (!memory || memory.status !== 'finalized') return { status: 'conflict', reason: 'finalized_episode_memory_required', episodeNumber: ep };
    const reason = clean(options.reason || '', 1800);
    if (reason.length < 8) return { status: 'reason_required', reason: 'character_arc_commit_reason_required' };
    const actor = clean(options.actor || 'operator', 240) || 'operator';
    const currentEpisode = Number(series.bible.currentEpisode || 0);
    const backfill = ep < currentEpisode;
    if (ep > currentEpisode) return { status: 'conflict', reason: 'character_arc_future_episode_not_finalized' };
    if (backfill && options.allowBackfill !== true) return { status: 'conflict', reason: 'character_arc_backfill_requires_explicit_approval' };
    const source = Array.isArray(updates) ? updates : [updates];
    if (!source.length) return { status: 'invalid', reason: 'character_arc_updates_required' };

    const keys = new Set();
    const prepared = [];
    for (const raw of source) {
      const key = slug(raw?.characterKey || '');
      if (!key) return { status: 'invalid', reason: 'character_key_required' };
      if (keys.has(key)) return { status: 'conflict', reason: 'duplicate_character_key_in_arc_commit', characterKey: key };
      keys.add(key);
      const item = await this.prepareUpdate(seriesId, ep, raw, options);
      if (item.status !== 'ready') return item;
      const later = typeof this.db.getLatestSerializedCharacterArcCommit === 'function'
        ? await this.db.getLatestSerializedCharacterArcCommit(item.arc.id)
        : null;
      if (later && Number(later.episodeNumber) > ep) return { status: 'conflict', reason: 'character_arc_historical_insert_has_later_commit', characterKey: key };
      const existingEpisode = typeof this.db.getSerializedCharacterArcEpisodeCommit === 'function'
        ? await this.db.getSerializedCharacterArcEpisodeCommit(item.arc.id, ep, 'episode_commit')
        : null;
      if (existingEpisode) return { status: 'conflict', reason: 'character_arc_episode_already_committed', characterKey: key };
      const expectedRevision = raw.expectedRevision === undefined || raw.expectedRevision === null
        ? Number(item.existing?.revisionNumber || 0)
        : Number(raw.expectedRevision);
      if (expectedRevision !== Number(item.existing?.revisionNumber || 0)) return { status: 'conflict', reason: 'character_arc_revision_conflict', characterKey: key };
      const relevantTimelineEventIds = uniqueStrings(raw.relevantTimelineEventIds || [], 500, 240);
      const allowedTimeline = new Set(memory.timelineEventIds || []);
      if (relevantTimelineEventIds.some(id => !allowedTimeline.has(id))) {
        return { status: 'conflict', reason: 'character_arc_timeline_reference_outside_episode_memory', characterKey: key };
      }
      prepared.push({
        arc: item.arc,
        existing: item.existing,
        expectedRevision,
        relevantTimelineEventIds,
        changeSummary: clean(raw.changeSummary || '', 2400),
        allowRebind: options.allowRebind === true || raw.allowRebind === true,
        rebindReason: clean(options.rebindReason || raw.rebindReason || '', 1800)
      });
    }

    try {
      const result = await this.db.commitSerializedCharacterArcsAtomic({
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
      if (message.startsWith('character_arc_')) return { status: 'conflict', reason: message };
      throw error;
    }
  }

  async amendEpisodeArc(seriesId, characterKeyInput, episodeNumber, patch = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', arc: null };
    const characterKey = slug(characterKeyInput || patch.characterKey || '');
    const arc = await this.db.getSerializedCharacterArc(seriesId, characterKey);
    if (!arc) return { status: 'not_found', arc: null };
    const ep = Math.max(1, Number(episodeNumber || 0));
    const reason = clean(options.reason || patch.amendmentReason || patch.changeReason || '', 1800);
    if (options.allowAmendment !== true && patch.allowAmendment !== true) return { status: 'amendment_required', reason: 'character_arc_is_append_only', arc };
    if (reason.length < 8) return { status: 'amendment_required', reason: 'character_arc_amendment_reason_required', arc };
    const latest = await this.db.getLatestSerializedCharacterArcCommit(arc.id);
    if (!latest || Number(latest.episodeNumber) !== ep) return { status: 'conflict', reason: 'historical_character_arc_amendment_blocked_by_later_state', arc };
    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);
    if (!memory || memory.status !== 'finalized') return { status: 'conflict', reason: 'finalized_episode_memory_required', arc };
    const expectedRevision = Number(options.expectedRevision ?? patch.expectedRevision ?? arc.revisionNumber);
    if (expectedRevision !== Number(arc.revisionNumber)) return { status: 'conflict', reason: 'character_arc_revision_conflict', arc };
    const prepared = await this.prepareUpdate(seriesId, ep, { ...arc, ...patch, characterKey }, options);
    if (prepared.status !== 'ready') return prepared;
    const relevantTimelineEventIds = uniqueStrings(patch.relevantTimelineEventIds ?? latest.timelineEventIds ?? [], 500, 240);
    const allowed = new Set(memory.timelineEventIds || []);
    if (relevantTimelineEventIds.some(id => !allowed.has(id))) return { status: 'conflict', reason: 'character_arc_timeline_reference_outside_episode_memory', arc };
    try {
      const result = await this.db.amendSerializedCharacterArcAtomic({
        seriesId,
        episodeNumber: ep,
        episodeMemoryId: memory.id,
        arc: prepared.arc,
        expectedRevision,
        relevantTimelineEventIds,
        changeSummary: clean(patch.changeSummary || '', 2400),
        actor: clean(options.actor || patch.actor || 'operator', 240) || 'operator',
        reason
      });
      return { status: 'amended', ...result };
    } catch (error) {
      const message = String(error?.message || error);
      if (message.startsWith('character_arc_')) return { status: 'conflict', reason: message, arc: await this.db.getSerializedCharacterArc(seriesId, characterKey) };
      throw error;
    }
  }

  async validateSeries(seriesId) {
    const series = await this.requireSeries(seriesId);
    if (series.status === 'not_found') return { valid: false, blockers: [{ code: 'series_not_found' }] };
    const arcs = await this.db.listSerializedCharacterArcs(seriesId, 2000, true);
    const blockers = [];
    const keys = new Set();
    const ids = new Set();
    for (const arc of arcs) {
      if (!arc.id || ids.has(arc.id)) blockers.push({ code: 'duplicate_or_missing_character_arc_id', characterKey: arc.characterKey || null });
      if (!arc.characterKey || keys.has(arc.characterKey)) blockers.push({ code: 'duplicate_or_missing_character_arc_key', characterKey: arc.characterKey || null });
      ids.add(arc.id); keys.add(arc.characterKey);
      if (Number(arc.lastEpisodeNumber || 0) > Number(series.bible.currentEpisode || 0)) blockers.push({ code: 'character_arc_ahead_of_series', characterKey: arc.characterKey });
      const commits = await this.db.listSerializedCharacterArcCommits(arc.id, 2000);
      const ordered = [...commits].filter(item => item.commitKind === 'episode_commit').sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
      const seenEpisodes = new Set();
      for (const commit of ordered) {
        if (seenEpisodes.has(Number(commit.episodeNumber))) blockers.push({ code: 'duplicate_character_arc_episode_commit', characterKey: arc.characterKey, episodeNumber: commit.episodeNumber });
        seenEpisodes.add(Number(commit.episodeNumber));
        const memory = await this.db.getSerializedEpisodeMemory(seriesId, commit.episodeNumber);
        if (!memory || memory.id !== commit.episodeMemoryId || memory.status !== 'finalized') {
          blockers.push({ code: 'character_arc_commit_episode_memory_missing', characterKey: arc.characterKey, episodeNumber: commit.episodeNumber });
        } else {
          const allowed = new Set(memory.timelineEventIds || []);
          if ((commit.timelineEventIds || []).some(id => !allowed.has(id))) blockers.push({ code: 'character_arc_commit_timeline_drift', characterKey: arc.characterKey, episodeNumber: commit.episodeNumber });
        }
      }
      if (commits.length) {
        const latest = [...commits].sort((a, b) => Number(b.arcRevisionNumber) - Number(a.arcRevisionNumber))[0];
        if (JSON.stringify(snapshotArc(arc)) !== JSON.stringify(stable(latest.afterSnapshot || {}))) blockers.push({ code: 'character_arc_current_state_drift', characterKey: arc.characterKey });
      }
      if (arc.persistentCharacterId) {
        const resolved = await this.resolvePersistentCharacter(arc.persistentCharacterId);
        if (resolved.status !== 'active') blockers.push({ code: 'character_arc_visual_binding_invalid', characterKey: arc.characterKey });
        else if (arc.persistentCharacterFingerprint && resolved.character.identityFingerprint !== arc.persistentCharacterFingerprint) blockers.push({ code: 'character_arc_visual_fingerprint_drift', characterKey: arc.characterKey });
      }
    }
    return { valid: blockers.length === 0, blockers, arcCount: arcs.length, currentEpisode: Number(series.bible.currentEpisode || 0) };
  }

  async getScriptContext(serializedSeriesContext = {}) {
    if (!this.enabled || !serializedSeriesContext?.active || !serializedSeriesContext?.bible) return { active: false, version: VERSION, promptContext: '', arcs: [] };
    const bible = serializedSeriesContext.bible;
    const validation = await this.validateSeries(bible.id);
    if (!validation.valid) {
      const codes = validation.blockers.slice(0, 8).map(item => item.code).join(', ');
      throw new Error(`Character Arc Memory invalid for ${bible.id}: ${codes}`);
    }
    const all = await this.db.listSerializedCharacterArcs(bible.id, 2000, false);
    const active = all.filter(arc => arc.status === 'active');
    const arcs = active
      .sort((a, b) => Number(b.lastEpisodeNumber || 0) - Number(a.lastEpisodeNumber || 0) || String(a.characterKey).localeCompare(String(b.characterKey)))
      .slice(0, this.maxPromptArcs)
      .sort((a, b) => String(a.characterKey).localeCompare(String(b.characterKey)));
    return {
      active: true,
      version: VERSION,
      bible,
      binding: serializedSeriesContext.binding || null,
      arcs,
      validation,
      promptContext: buildPromptContext({ bible, binding: serializedSeriesContext.binding, arcs })
    };
  }
}

module.exports = {
  CHARACTER_ARC_MEMORY_VERSION: VERSION,
  CharacterArcMemoryServiceV12,
  normalizeArc,
  snapshotArc,
  buildPromptContext,
  slug
};
