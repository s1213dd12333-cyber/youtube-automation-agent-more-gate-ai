'use strict';

const crypto = require('crypto');

const VERSION = '11.12.5';
const RELATIONSHIP_STATUSES = new Set(['active', 'archived']);

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

function bounded(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number(fallback || 0);
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function relationshipKey(sourceCharacterKey, targetCharacterKey) {
  return `${slug(sourceCharacterKey)}->${slug(targetCharacterKey)}`;
}

function normalizeRelationship(input = {}, base = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(input, key);
  const merged = { ...base, ...input };
  const sourceCharacterKey = slug(has('sourceCharacterKey') ? input.sourceCharacterKey : base.sourceCharacterKey);
  const targetCharacterKey = slug(has('targetCharacterKey') ? input.targetCharacterKey : base.targetCharacterKey);
  const statusRaw = clean(merged.status || 'active', 40).toLowerCase();
  const score = (key, min, max) => bounded(has(key) ? input[key] : base[key], min, max, 0);
  return {
    id: clean(merged.id || '', 240) || null,
    seriesId: clean(merged.seriesId || '', 240) || null,
    sourceCharacterKey,
    targetCharacterKey,
    sourceCharacterArcId: clean(has('sourceCharacterArcId') ? input.sourceCharacterArcId : base.sourceCharacterArcId, 240) || null,
    targetCharacterArcId: clean(has('targetCharacterArcId') ? input.targetCharacterArcId : base.targetCharacterArcId, 240) || null,
    relationshipLabel: clean(has('relationshipLabel') ? input.relationshipLabel : base.relationshipLabel, 240),
    relationshipState: clean(has('relationshipState') ? input.relationshipState : base.relationshipState, 3600),
    relationshipTags: uniqueStrings(has('relationshipTags') ? input.relationshipTags : base.relationshipTags || [], 80, 320),
    trustScore: score('trustScore', -100, 100),
    affinityScore: score('affinityScore', -100, 100),
    respectScore: score('respectScore', -100, 100),
    loyaltyScore: score('loyaltyScore', -100, 100),
    fearScore: score('fearScore', 0, 100),
    attractionScore: score('attractionScore', 0, 100),
    dependenceScore: score('dependenceScore', 0, 100),
    beliefsAboutTarget: uniqueStrings(has('beliefsAboutTarget') ? input.beliefsAboutTarget : base.beliefsAboutTarget || [], 160, 2200),
    knowledgeAboutTarget: uniqueStrings(has('knowledgeAboutTarget') ? input.knowledgeAboutTarget : base.knowledgeAboutTarget || [], 220, 2200),
    secretsKnownAboutTarget: uniqueStrings(has('secretsKnownAboutTarget') ? input.secretsKnownAboutTarget : base.secretsKnownAboutTarget || [], 160, 2200),
    obligationsToTarget: uniqueStrings(has('obligationsToTarget') ? input.obligationsToTarget : base.obligationsToTarget || [], 120, 2200),
    promisesToTarget: uniqueStrings(has('promisesToTarget') ? input.promisesToTarget : base.promisesToTarget || [], 120, 2200),
    grievancesAgainstTarget: uniqueStrings(has('grievancesAgainstTarget') ? input.grievancesAgainstTarget : base.grievancesAgainstTarget || [], 120, 2200),
    expectationsOfTarget: uniqueStrings(has('expectationsOfTarget') ? input.expectationsOfTarget : base.expectationsOfTarget || [], 120, 2200),
    boundariesWithTarget: uniqueStrings(has('boundariesWithTarget') ? input.boundariesWithTarget : base.boundariesWithTarget || [], 120, 2200),
    sharedHistory: uniqueStrings(has('sharedHistory') ? input.sharedHistory : base.sharedHistory || [], 180, 2200),
    currentTensions: uniqueStrings(has('currentTensions') ? input.currentTensions : base.currentTensions || [], 120, 2200),
    notes: clean(has('notes') ? input.notes : base.notes, 6000),
    firstEpisodeNumber: Math.max(0, Math.floor(Number(merged.firstEpisodeNumber || 0) || 0)),
    lastEpisodeNumber: Math.max(0, Math.floor(Number(merged.lastEpisodeNumber || 0) || 0)),
    revisionNumber: Math.max(0, Math.floor(Number(merged.revisionNumber || 0) || 0)),
    status: RELATIONSHIP_STATUSES.has(statusRaw) ? statusRaw : 'active',
    createdAt: merged.createdAt || null,
    updatedAt: merged.updatedAt || null
  };
}

function snapshotRelationship(relationship = {}) {
  return stable({
    id: relationship.id,
    seriesId: relationship.seriesId,
    sourceCharacterKey: relationship.sourceCharacterKey,
    targetCharacterKey: relationship.targetCharacterKey,
    sourceCharacterArcId: relationship.sourceCharacterArcId || null,
    targetCharacterArcId: relationship.targetCharacterArcId || null,
    relationshipLabel: relationship.relationshipLabel || '',
    relationshipState: relationship.relationshipState || '',
    relationshipTags: relationship.relationshipTags || [],
    trustScore: Number(relationship.trustScore || 0),
    affinityScore: Number(relationship.affinityScore || 0),
    respectScore: Number(relationship.respectScore || 0),
    loyaltyScore: Number(relationship.loyaltyScore || 0),
    fearScore: Number(relationship.fearScore || 0),
    attractionScore: Number(relationship.attractionScore || 0),
    dependenceScore: Number(relationship.dependenceScore || 0),
    beliefsAboutTarget: relationship.beliefsAboutTarget || [],
    knowledgeAboutTarget: relationship.knowledgeAboutTarget || [],
    secretsKnownAboutTarget: relationship.secretsKnownAboutTarget || [],
    obligationsToTarget: relationship.obligationsToTarget || [],
    promisesToTarget: relationship.promisesToTarget || [],
    grievancesAgainstTarget: relationship.grievancesAgainstTarget || [],
    expectationsOfTarget: relationship.expectationsOfTarget || [],
    boundariesWithTarget: relationship.boundariesWithTarget || [],
    sharedHistory: relationship.sharedHistory || [],
    currentTensions: relationship.currentTensions || [],
    notes: relationship.notes || '',
    firstEpisodeNumber: Number(relationship.firstEpisodeNumber || 0),
    lastEpisodeNumber: Number(relationship.lastEpisodeNumber || 0),
    revisionNumber: Number(relationship.revisionNumber || 0),
    status: relationship.status || 'active'
  });
}

function promptRelationship(relationship = {}) {
  const lines = [
    `DIRECTED RELATIONSHIP ${relationship.sourceCharacterKey} -> ${relationship.targetCharacterKey}`,
    `Last relationship commit: episode ${relationship.lastEpisodeNumber || 0}`,
    `Label: ${relationship.relationshipLabel || 'unspecified'}`,
    `State: ${relationship.relationshipState || 'unspecified'}`,
    `Scores: trust=${relationship.trustScore || 0}, affinity=${relationship.affinityScore || 0}, respect=${relationship.respectScore || 0}, loyalty=${relationship.loyaltyScore || 0}, fear=${relationship.fearScore || 0}, attraction=${relationship.attractionScore || 0}, dependence=${relationship.dependenceScore || 0}`
  ];
  const push = (label, values) => { if (values?.length) lines.push(`${label}: ${values.join(' | ')}`); };
  push('Tags', relationship.relationshipTags);
  push('Beliefs source holds about target', relationship.beliefsAboutTarget);
  push('Knowledge source has about target', relationship.knowledgeAboutTarget);
  push('Secrets source knows about target', relationship.secretsKnownAboutTarget);
  push('Obligations source owes target', relationship.obligationsToTarget);
  push('Promises source made to target', relationship.promisesToTarget);
  push('Grievances source holds against target', relationship.grievancesAgainstTarget);
  push('Expectations source has of target', relationship.expectationsOfTarget);
  push('Boundaries source maintains with target', relationship.boundariesWithTarget);
  push('Shared history relevant to this direction', relationship.sharedHistory);
  push('Current tensions', relationship.currentTensions);
  if (relationship.notes) lines.push(`Relationship notes: ${relationship.notes}`);
  return lines.join('\n');
}

function buildPromptContext({ bible, binding, relationships }) {
  const targetEpisode = Math.max(1, Number(binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
  return [
    `RELATIONSHIP STATE GRAPH V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `LAST FINALIZED EPISODE: ${bible.currentEpisode || 0}`,
    `TARGET EPISODE: ${targetEpisode}`,
    '',
    'CURRENT DIRECTED RELATIONSHIP EDGES:',
    relationships.length ? relationships.map(promptRelationship).join('\n\n') : '- No relationship edges committed yet.',
    '',
    'RELATIONSHIP GRAPH SAFETY:',
    '- Every edge is directional. A -> B NEVER implies B -> A and scores must never be mirrored automatically.',
    '- Secrets, knowledge, beliefs, expectations and grievances on an edge belong to the source character perspective only.',
    '- Use these values as the starting state for the target episode. The episode may explicitly evolve a relationship, but generation itself does not commit that evolution.',
    '- Never infer a relationship edge from proximity, shared scenes, matching names or visual similarity.',
    '- Do not transfer relationship facts between unrelated series or namespaces.',
    '- Script generation is read-only. Relationship State Graph changes only after an Episode Memory has been finalized and an explicit relationship commit is approved.'
  ].join('\n').slice(0, 48000);
}

class RelationshipStateGraphServiceV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_RELATIONSHIP_STATE_GRAPH_ENABLED || 'true').toLowerCase() !== 'false';
    this.maxPromptRelationships = Math.max(10, Math.min(200, Number(options.maxPromptRelationships || process.env.SERIALIZED_RELATIONSHIP_PROMPT_LIMIT || 60)));
  }

  async requireSeries(seriesId) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) return { status: 'not_found', bible: null };
    if (bible.status !== 'active') return { status: 'inactive', bible };
    return { status: 'active', bible };
  }

  async resolveArc(seriesId, characterKey) {
    const key = slug(characterKey || '');
    if (!key) return { status: 'invalid', reason: 'relationship_character_key_required', arc: null };
    const arc = await this.db.getSerializedCharacterArc(seriesId, key);
    if (!arc) return { status: 'not_found', reason: 'relationship_character_arc_not_found', arc: null, characterKey: key };
    return { status: 'found', arc, characterKey: key };
  }

  async prepareUpdate(seriesId, episodeNumber, raw = {}) {
    const sourceCharacterKey = slug(raw.sourceCharacterKey || '');
    const targetCharacterKey = slug(raw.targetCharacterKey || '');
    if (!sourceCharacterKey || !targetCharacterKey) return { status: 'invalid', reason: 'relationship_endpoints_required' };
    if (sourceCharacterKey === targetCharacterKey) return { status: 'invalid', reason: 'relationship_self_edge_forbidden', sourceCharacterKey, targetCharacterKey };

    const sourceArcResult = await this.resolveArc(seriesId, sourceCharacterKey);
    if (sourceArcResult.status !== 'found') return { status: 'conflict', reason: 'relationship_source_character_arc_not_found', sourceCharacterKey };
    const targetArcResult = await this.resolveArc(seriesId, targetCharacterKey);
    if (targetArcResult.status !== 'found') return { status: 'conflict', reason: 'relationship_target_character_arc_not_found', targetCharacterKey };

    const existing = await this.db.getSerializedRelationshipState(seriesId, sourceCharacterKey, targetCharacterKey);
    if (existing) {
      if (existing.sourceCharacterArcId !== sourceArcResult.arc.id || existing.targetCharacterArcId !== targetArcResult.arc.id) {
        return { status: 'conflict', reason: 'relationship_endpoint_arc_binding_drift', relationship: existing };
      }
    }

    const relationship = normalizeRelationship({
      ...raw,
      seriesId,
      sourceCharacterKey,
      targetCharacterKey,
      sourceCharacterArcId: sourceArcResult.arc.id,
      targetCharacterArcId: targetArcResult.arc.id,
      firstEpisodeNumber: existing?.firstEpisodeNumber || episodeNumber,
      lastEpisodeNumber: episodeNumber,
      revisionNumber: existing?.revisionNumber || 0
    }, existing || {});
    relationship.id = existing?.id || `serialized_relationship_${hash(`${seriesId}:${sourceCharacterKey}:${targetCharacterKey}`).slice(0, 20)}`;
    return { status: 'ready', relationship, existing, sourceArc: sourceArcResult.arc, targetArc: targetArcResult.arc };
  }

  async commitEpisodeRelationships(seriesId, episodeNumber, updates = [], options = {}) {
    if (!this.enabled) return { status: 'disabled', relationships: [] };
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { status: series.status, relationships: [], bible: series.bible };
    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));
    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);
    if (!memory || memory.status !== 'finalized') return { status: 'conflict', reason: 'finalized_episode_memory_required', episodeNumber: ep };
    const reason = clean(options.reason || '', 1800);
    if (reason.length < 8) return { status: 'reason_required', reason: 'relationship_commit_reason_required' };
    const actor = clean(options.actor || 'operator', 240) || 'operator';
    const currentEpisode = Number(series.bible.currentEpisode || 0);
    const backfill = ep < currentEpisode;
    if (ep > currentEpisode) return { status: 'conflict', reason: 'relationship_future_episode_not_finalized' };
    if (backfill && options.allowBackfill !== true) return { status: 'conflict', reason: 'relationship_backfill_requires_explicit_approval' };
    const source = Array.isArray(updates) ? updates : [updates];
    if (!source.length) return { status: 'invalid', reason: 'relationship_updates_required' };

    const edgeKeys = new Set();
    const prepared = [];
    for (const raw of source) {
      const sourceKey = slug(raw?.sourceCharacterKey || '');
      const targetKey = slug(raw?.targetCharacterKey || '');
      const edgeKey = relationshipKey(sourceKey, targetKey);
      if (!sourceKey || !targetKey) return { status: 'invalid', reason: 'relationship_endpoints_required' };
      if (sourceKey === targetKey) return { status: 'invalid', reason: 'relationship_self_edge_forbidden', sourceCharacterKey: sourceKey };
      if (edgeKeys.has(edgeKey)) return { status: 'conflict', reason: 'duplicate_relationship_edge_in_commit', edgeKey };
      edgeKeys.add(edgeKey);
      const item = await this.prepareUpdate(seriesId, ep, raw);
      if (item.status !== 'ready') return item;
      const latest = typeof this.db.getLatestSerializedRelationshipCommit === 'function'
        ? await this.db.getLatestSerializedRelationshipCommit(item.relationship.id)
        : null;
      if (latest && Number(latest.episodeNumber) > ep) return { status: 'conflict', reason: 'relationship_historical_insert_has_later_commit', edgeKey };
      const existingEpisode = typeof this.db.getSerializedRelationshipEpisodeCommit === 'function'
        ? await this.db.getSerializedRelationshipEpisodeCommit(item.relationship.id, ep, 'episode_commit')
        : null;
      if (existingEpisode) return { status: 'conflict', reason: 'relationship_episode_already_committed', edgeKey };
      const expectedRevision = raw.expectedRevision === undefined || raw.expectedRevision === null
        ? Number(item.existing?.revisionNumber || 0)
        : Number(raw.expectedRevision);
      if (expectedRevision !== Number(item.existing?.revisionNumber || 0)) return { status: 'conflict', reason: 'relationship_revision_conflict', edgeKey };
      const relevantTimelineEventIds = uniqueStrings(raw.relevantTimelineEventIds || [], 500, 240);
      const allowedTimeline = new Set(memory.timelineEventIds || []);
      if (relevantTimelineEventIds.some(id => !allowedTimeline.has(id))) {
        return { status: 'conflict', reason: 'relationship_timeline_reference_outside_episode_memory', edgeKey };
      }
      prepared.push({
        relationship: item.relationship,
        existing: item.existing,
        expectedRevision,
        relevantTimelineEventIds,
        changeSummary: clean(raw.changeSummary || '', 2400)
      });
    }

    try {
      const result = await this.db.commitSerializedRelationshipsAtomic({
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
      if (message.startsWith('relationship_') || message === 'finalized_episode_memory_required') return { status: 'conflict', reason: message };
      throw error;
    }
  }

  async amendEpisodeRelationship(seriesId, sourceKeyInput, targetKeyInput, episodeNumber, patch = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', relationship: null };
    const sourceCharacterKey = slug(sourceKeyInput || patch.sourceCharacterKey || '');
    const targetCharacterKey = slug(targetKeyInput || patch.targetCharacterKey || '');
    if (!sourceCharacterKey || !targetCharacterKey) return { status: 'invalid', reason: 'relationship_endpoints_required' };
    if (sourceCharacterKey === targetCharacterKey) return { status: 'invalid', reason: 'relationship_self_edge_forbidden' };
    const relationship = await this.db.getSerializedRelationshipState(seriesId, sourceCharacterKey, targetCharacterKey);
    if (!relationship) return { status: 'not_found', relationship: null };
    const ep = Math.max(1, Math.floor(Number(episodeNumber || 0) || 0));
    const reason = clean(options.reason || patch.amendmentReason || patch.changeReason || '', 1800);
    if (options.allowAmendment !== true && patch.allowAmendment !== true) return { status: 'amendment_required', reason: 'relationship_history_is_append_only', relationship };
    if (reason.length < 8) return { status: 'amendment_required', reason: 'relationship_amendment_reason_required', relationship };
    const latest = await this.db.getLatestSerializedRelationshipCommit(relationship.id);
    if (!latest || Number(latest.episodeNumber) !== ep) return { status: 'conflict', reason: 'historical_relationship_amendment_blocked_by_later_state', relationship };
    const memory = await this.db.getSerializedEpisodeMemory(seriesId, ep);
    if (!memory || memory.status !== 'finalized') return { status: 'conflict', reason: 'finalized_episode_memory_required', relationship };
    const expectedRevision = Number(options.expectedRevision ?? patch.expectedRevision ?? relationship.revisionNumber);
    if (expectedRevision !== Number(relationship.revisionNumber)) return { status: 'conflict', reason: 'relationship_revision_conflict', relationship };
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceCharacterKey') && slug(patch.sourceCharacterKey) !== sourceCharacterKey) return { status: 'conflict', reason: 'relationship_endpoints_are_immutable', relationship };
    if (Object.prototype.hasOwnProperty.call(patch, 'targetCharacterKey') && slug(patch.targetCharacterKey) !== targetCharacterKey) return { status: 'conflict', reason: 'relationship_endpoints_are_immutable', relationship };
    const prepared = await this.prepareUpdate(seriesId, ep, { ...relationship, ...patch, sourceCharacterKey, targetCharacterKey });
    if (prepared.status !== 'ready') return prepared;
    const relevantTimelineEventIds = uniqueStrings(patch.relevantTimelineEventIds ?? latest.timelineEventIds ?? [], 500, 240);
    const allowed = new Set(memory.timelineEventIds || []);
    if (relevantTimelineEventIds.some(id => !allowed.has(id))) return { status: 'conflict', reason: 'relationship_timeline_reference_outside_episode_memory', relationship };
    try {
      const result = await this.db.amendSerializedRelationshipAtomic({
        seriesId,
        episodeNumber: ep,
        episodeMemoryId: memory.id,
        relationship: prepared.relationship,
        expectedRevision,
        relevantTimelineEventIds,
        changeSummary: clean(patch.changeSummary || '', 2400),
        actor: clean(options.actor || patch.actor || 'operator', 240) || 'operator',
        reason
      });
      return { status: 'amended', ...result };
    } catch (error) {
      const message = String(error?.message || error);
      if (message.startsWith('relationship_') || message === 'finalized_episode_memory_required') {
        return { status: 'conflict', reason: message, relationship: await this.db.getSerializedRelationshipState(seriesId, sourceCharacterKey, targetCharacterKey) };
      }
      throw error;
    }
  }

  async validateSeries(seriesId) {
    const series = await this.requireSeries(seriesId);
    if (series.status === 'not_found') return { valid: false, blockers: [{ code: 'series_not_found' }] };
    const relationships = await this.db.listSerializedRelationshipStates(seriesId, 5000, true);
    const blockers = [];
    const edgeKeys = new Set();
    const ids = new Set();
    for (const relationship of relationships) {
      const edgeKey = relationshipKey(relationship.sourceCharacterKey, relationship.targetCharacterKey);
      if (!relationship.id || ids.has(relationship.id)) blockers.push({ code: 'duplicate_or_missing_relationship_id', edgeKey });
      if (!relationship.sourceCharacterKey || !relationship.targetCharacterKey || edgeKeys.has(edgeKey)) blockers.push({ code: 'duplicate_or_missing_relationship_edge', edgeKey });
      if (relationship.sourceCharacterKey === relationship.targetCharacterKey) blockers.push({ code: 'relationship_self_edge_forbidden', edgeKey });
      ids.add(relationship.id); edgeKeys.add(edgeKey);
      if (Number(relationship.lastEpisodeNumber || 0) > Number(series.bible.currentEpisode || 0)) blockers.push({ code: 'relationship_ahead_of_series', edgeKey });
      const sourceArc = await this.db.getSerializedCharacterArc(seriesId, relationship.sourceCharacterKey);
      const targetArc = await this.db.getSerializedCharacterArc(seriesId, relationship.targetCharacterKey);
      if (!sourceArc || sourceArc.id !== relationship.sourceCharacterArcId) blockers.push({ code: 'relationship_source_arc_binding_drift', edgeKey });
      if (!targetArc || targetArc.id !== relationship.targetCharacterArcId) blockers.push({ code: 'relationship_target_arc_binding_drift', edgeKey });
      const commits = await this.db.listSerializedRelationshipCommits(relationship.id, 3000);
      const ordered = [...commits].filter(item => item.commitKind === 'episode_commit').sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
      const seenEpisodes = new Set();
      for (const commit of ordered) {
        if (seenEpisodes.has(Number(commit.episodeNumber))) blockers.push({ code: 'duplicate_relationship_episode_commit', edgeKey, episodeNumber: commit.episodeNumber });
        seenEpisodes.add(Number(commit.episodeNumber));
        const memory = await this.db.getSerializedEpisodeMemory(seriesId, commit.episodeNumber);
        if (!memory || memory.id !== commit.episodeMemoryId || memory.status !== 'finalized') {
          blockers.push({ code: 'relationship_commit_episode_memory_missing', edgeKey, episodeNumber: commit.episodeNumber });
        } else {
          const allowed = new Set(memory.timelineEventIds || []);
          if ((commit.timelineEventIds || []).some(id => !allowed.has(id))) blockers.push({ code: 'relationship_commit_timeline_drift', edgeKey, episodeNumber: commit.episodeNumber });
        }
      }
      if (commits.length) {
        const latest = [...commits].sort((a, b) => Number(b.relationshipRevisionNumber) - Number(a.relationshipRevisionNumber))[0];
        if (JSON.stringify(snapshotRelationship(relationship)) !== JSON.stringify(stable(latest.afterSnapshot || {}))) blockers.push({ code: 'relationship_current_state_drift', edgeKey });
      }
    }
    return { valid: blockers.length === 0, blockers, relationshipCount: relationships.length, currentEpisode: Number(series.bible.currentEpisode || 0) };
  }

  async getScriptContext(serializedSeriesContext = {}) {
    if (!this.enabled || !serializedSeriesContext?.active || !serializedSeriesContext?.bible) {
      return { active: false, version: VERSION, promptContext: '', relationships: [] };
    }
    const bible = serializedSeriesContext.bible;
    const validation = await this.validateSeries(bible.id);
    if (!validation.valid) {
      const codes = validation.blockers.slice(0, 8).map(item => item.code).join(', ');
      throw new Error(`Relationship State Graph invalid for ${bible.id}: ${codes}`);
    }
    const all = await this.db.listSerializedRelationshipStates(bible.id, 5000, false);
    const relationships = all
      .filter(item => item.status === 'active')
      .sort((a, b) => Number(b.lastEpisodeNumber || 0) - Number(a.lastEpisodeNumber || 0)
        || String(a.sourceCharacterKey).localeCompare(String(b.sourceCharacterKey))
        || String(a.targetCharacterKey).localeCompare(String(b.targetCharacterKey)))
      .slice(0, this.maxPromptRelationships)
      .sort((a, b) => String(a.sourceCharacterKey).localeCompare(String(b.sourceCharacterKey))
        || String(a.targetCharacterKey).localeCompare(String(b.targetCharacterKey)));
    return {
      active: true,
      version: VERSION,
      bible,
      binding: serializedSeriesContext.binding || null,
      relationships,
      validation,
      promptContext: buildPromptContext({ bible, binding: serializedSeriesContext.binding, relationships })
    };
  }
}

module.exports = {
  RELATIONSHIP_STATE_GRAPH_VERSION: VERSION,
  RelationshipStateGraphServiceV12,
  normalizeRelationship,
  snapshotRelationship,
  buildPromptContext,
  relationshipKey,
  slug
};
