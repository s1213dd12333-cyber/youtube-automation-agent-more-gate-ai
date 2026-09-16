'use strict';

const crypto = require('crypto');

const VERSION = '11.12.2';
const TRUTH_STATUSES = new Set(['confirmed', 'belief', 'rumor', 'disputed', 'false', 'unknown']);
const STATUSES = new Set(['active', 'retired']);

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function uniqueStrings(values = [], limit = 100, itemLimit = 1200) {
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

function truthStatus(value) {
  const normalized = clean(value || 'confirmed', 40).toLowerCase();
  return TRUTH_STATUSES.has(normalized) ? normalized : 'unknown';
}

function normalizeEvent(input = {}, base = {}) {
  const has = key => Object.prototype.hasOwnProperty.call(input, key);
  const merged = { ...base, ...input };
  const summary = clean(has('summary') ? input.summary : base.summary, 5000);
  const episodeNumber = Math.max(0, Math.floor(Number(has('episodeNumber') ? input.episodeNumber : base.episodeNumber) || 0));
  const sceneOrderRaw = has('sceneOrder') ? input.sceneOrder : base.sceneOrder;
  const chronologyRaw = has('chronologyIndex') ? input.chronologyIndex : base.chronologyIndex;
  const generatedKeySeed = `${episodeNumber}:${clean(merged.sceneId || '', 200)}:${summary}`;
  return {
    id: clean(merged.id || '', 240) || null,
    seriesId: clean(merged.seriesId || '', 240) || null,
    eventKey: clean(merged.eventKey || `evt_${hash(generatedKeySeed).slice(0, 18)}`, 240),
    chronologyIndex: chronologyRaw === null || chronologyRaw === undefined || chronologyRaw === ''
      ? null
      : Math.max(1, Math.floor(Number(chronologyRaw) || 0)),
    episodeNumber,
    sceneId: clean(has('sceneId') ? input.sceneId : base.sceneId, 240) || null,
    sceneOrder: sceneOrderRaw === null || sceneOrderRaw === undefined || sceneOrderRaw === ''
      ? null
      : Math.max(0, Math.floor(Number(sceneOrderRaw) || 0)),
    storyTimeLabel: clean(has('storyTimeLabel') ? input.storyTimeLabel : base.storyTimeLabel, 400) || null,
    eventType: clean(has('eventType') ? input.eventType : base.eventType || 'story_event', 100) || 'story_event',
    summary,
    participants: uniqueStrings(has('participants') ? input.participants : base.participants || [], 100, 300),
    locationRefs: uniqueStrings(has('locationRefs') ? input.locationRefs : base.locationRefs || [], 40, 300),
    causeEventIds: uniqueStrings(has('causeEventIds') ? input.causeEventIds : base.causeEventIds || [], 100, 240),
    consequences: uniqueStrings(has('consequences') ? input.consequences : base.consequences || [], 100, 1600),
    mustFollowEventIds: uniqueStrings(has('mustFollowEventIds') ? input.mustFollowEventIds : base.mustFollowEventIds || [], 100, 240),
    mustPrecedeEventIds: uniqueStrings(has('mustPrecedeEventIds') ? input.mustPrecedeEventIds : base.mustPrecedeEventIds || [], 100, 240),
    truthStatus: truthStatus(has('truthStatus') ? input.truthStatus : base.truthStatus),
    revisionNumber: Math.max(1, Math.floor(Number(merged.revisionNumber || 1) || 1)),
    status: STATUSES.has(clean(merged.status || 'active', 40).toLowerCase()) ? clean(merged.status || 'active', 40).toLowerCase() : 'active',
    createdBy: clean(merged.createdBy || '', 200) || null,
    commitId: clean(merged.commitId || '', 240) || null,
    createdAt: merged.createdAt || null,
    updatedAt: merged.updatedAt || null
  };
}

function snapshotEvent(event = {}) {
  return stable({
    id: event.id,
    seriesId: event.seriesId,
    eventKey: event.eventKey,
    chronologyIndex: event.chronologyIndex,
    episodeNumber: event.episodeNumber,
    sceneId: event.sceneId,
    sceneOrder: event.sceneOrder,
    storyTimeLabel: event.storyTimeLabel,
    eventType: event.eventType,
    summary: event.summary,
    participants: event.participants || [],
    locationRefs: event.locationRefs || [],
    causeEventIds: event.causeEventIds || [],
    consequences: event.consequences || [],
    mustFollowEventIds: event.mustFollowEventIds || [],
    mustPrecedeEventIds: event.mustPrecedeEventIds || [],
    truthStatus: event.truthStatus,
    revisionNumber: event.revisionNumber || 1,
    status: event.status || 'active'
  });
}

function validateEventSet(events = []) {
  const active = events.filter(event => event && event.status !== 'retired');
  const blockers = [];
  const byId = new Map();
  const byKey = new Map();
  const byChronology = new Map();

  for (const event of active) {
    if (!event.id) blockers.push({ code: 'event_id_missing', eventId: null });
    if (!event.eventKey) blockers.push({ code: 'event_key_missing', eventId: event.id || null });
    if (!event.summary) blockers.push({ code: 'event_summary_missing', eventId: event.id || null });
    if (!Number.isInteger(Number(event.chronologyIndex)) || Number(event.chronologyIndex) <= 0) {
      blockers.push({ code: 'chronology_index_invalid', eventId: event.id || null });
    }
    if (!TRUTH_STATUSES.has(event.truthStatus)) blockers.push({ code: 'truth_status_invalid', eventId: event.id || null });
    if (byId.has(event.id)) blockers.push({ code: 'duplicate_event_id', eventId: event.id });
    if (byKey.has(event.eventKey)) blockers.push({ code: 'duplicate_event_key', eventId: event.id, eventKey: event.eventKey });
    if (byChronology.has(Number(event.chronologyIndex))) {
      blockers.push({ code: 'duplicate_chronology_index', eventId: event.id, chronologyIndex: Number(event.chronologyIndex) });
    }
    byId.set(event.id, event);
    byKey.set(event.eventKey, event);
    byChronology.set(Number(event.chronologyIndex), event);
  }

  const edges = new Map(active.map(event => [event.id, new Set()]));
  const addEdge = (from, to) => {
    if (edges.has(from) && edges.has(to)) edges.get(from).add(to);
  };

  for (const event of active) {
    const refs = [
      ...event.causeEventIds.map(id => ({ id, kind: 'cause' })),
      ...event.mustFollowEventIds.map(id => ({ id, kind: 'follow' })),
      ...event.mustPrecedeEventIds.map(id => ({ id, kind: 'precede' }))
    ];
    for (const ref of refs) {
      if (ref.id === event.id) {
        blockers.push({ code: 'self_reference', eventId: event.id, referenceKind: ref.kind });
        continue;
      }
      const target = byId.get(ref.id);
      if (!target) {
        blockers.push({ code: 'dangling_event_reference', eventId: event.id, referenceId: ref.id, referenceKind: ref.kind });
        continue;
      }
      if (ref.kind === 'precede') {
        addEdge(event.id, target.id);
        if (Number(event.chronologyIndex) >= Number(target.chronologyIndex)) {
          blockers.push({ code: 'must_precede_order_violation', eventId: event.id, referenceId: target.id });
        }
      } else {
        addEdge(target.id, event.id);
        if (Number(target.chronologyIndex) >= Number(event.chronologyIndex)) {
          blockers.push({ code: ref.kind === 'cause' ? 'cause_order_violation' : 'must_follow_order_violation', eventId: event.id, referenceId: target.id });
        }
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of edges.get(id) || []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of edges.keys()) {
    if (visit(id)) {
      blockers.push({ code: 'chronology_constraint_cycle', eventId: id });
      break;
    }
  }

  return { valid: blockers.length === 0, blockers, eventCount: active.length };
}

function promptEvent(event) {
  const narrative = `E${event.episodeNumber}${event.sceneId ? `/${event.sceneId}` : ''}${event.sceneOrder !== null ? `#${event.sceneOrder}` : ''}`;
  const lines = [
    `[C${event.chronologyIndex} | ${narrative} | ${event.truthStatus} | ${event.eventType}] ${event.summary}`
  ];
  if (event.storyTimeLabel) lines.push(`  Story time: ${event.storyTimeLabel}`);
  if (event.participants.length) lines.push(`  Participants: ${event.participants.join(', ')}`);
  if (event.locationRefs.length) lines.push(`  Locations: ${event.locationRefs.join(', ')}`);
  if (event.causeEventIds.length) lines.push(`  Caused by: ${event.causeEventIds.join(', ')}`);
  if (event.consequences.length) lines.push(`  Consequences: ${event.consequences.join(' | ')}`);
  if (event.mustFollowEventIds.length) lines.push(`  Must follow: ${event.mustFollowEventIds.join(', ')}`);
  if (event.mustPrecedeEventIds.length) lines.push(`  Must precede: ${event.mustPrecedeEventIds.join(', ')}`);
  return lines.join('\n');
}

function timelinePromptContext({ bible, binding, state, events }) {
  const targetEpisode = Math.max(1, Number(binding?.episodeNumber || 0) || Number(bible?.currentEpisode || 0) + 1);
  const body = events.length ? events.map(promptEvent).join('\n') : '- No prior canonical timeline events committed.';
  return [
    `CANONICAL TIMELINE V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `TIMELINE REVISION: ${state.revisionNumber || 0}`,
    `TARGET EPISODE: ${targetEpisode}`,
    '',
    'ORDERING SEMANTICS:',
    '- C<number> is story-world chronology, not the order viewers learned the fact.',
    '- E<number>/scene is the narrative coordinate where the event was introduced or committed.',
    '- A flashback may have an earlier C index while being introduced in a later episode.',
    '',
    'PRIOR CANONICAL EVENTS:',
    body,
    '',
    'TIMELINE SAFETY:',
    '- Treat confirmed events and chronology constraints as canonical facts.',
    '- belief, rumor, disputed, false, and unknown are truth-status labels; do not silently promote them to confirmed.',
    '- Never move, rewrite, delete, or retcon a committed event from script generation.',
    '- Never make a consequence happen before its declared cause or violate must-follow/must-precede constraints.',
    '- Script generation is read-only. New timeline events are committed only after explicit narrative approval.'
  ].join('\n').slice(0, 28000);
}

class CanonicalTimelineServiceV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_CANONICAL_TIMELINE_ENABLED || 'true').toLowerCase() !== 'false';
    this.maxPromptEvents = Math.max(10, Math.min(200, Number(options.maxPromptEvents || process.env.SERIALIZED_TIMELINE_PROMPT_EVENTS || 60)));
  }

  async requireSeries(seriesId) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) return { status: 'not_found', bible: null };
    if (bible.status !== 'active') return { status: 'inactive', bible };
    return { status: 'active', bible };
  }

  async commitEvents(seriesId, rawEvents = [], options = {}) {
    if (!this.enabled) return { status: 'disabled', events: [] };
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { status: series.status, events: [], bible: series.bible };
    const source = Array.isArray(rawEvents) ? rawEvents : [rawEvents];
    if (!source.length) return { status: 'invalid', reason: 'timeline_events_required', events: [] };
    const reason = clean(options.reason || '', 1600);
    if (reason.length < 8) return { status: 'reason_required', reason: 'timeline_commit_reason_required', events: [] };
    const actor = clean(options.actor || 'operator', 200) || 'operator';
    const currentEvents = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    const state = await this.db.getSerializedTimelineState(seriesId);
    const expectedTimelineRevision = options.expectedTimelineRevision === undefined || options.expectedTimelineRevision === null
      ? Number(state.revisionNumber || 0)
      : Number(options.expectedTimelineRevision);
    if (expectedTimelineRevision !== Number(state.revisionNumber || 0)) {
      return { status: 'conflict', reason: 'timeline_revision_conflict', state };
    }

    const usedKeys = new Set(currentEvents.map(event => event.eventKey));
    const usedIds = new Set(currentEvents.map(event => event.id));
    const explicitIndexes = source
      .map(item => item?.chronologyIndex)
      .filter(value => value !== null && value !== undefined && value !== '')
      .map(value => Math.max(1, Math.floor(Number(value) || 0)));
    let allocationCursor = Math.max(Number(state.lastChronologyIndex || 0), ...explicitIndexes, 0);
    const events = [];
    let hasBackfill = false;

    for (const raw of source) {
      const event = normalizeEvent(raw, { seriesId, createdBy: actor });
      if (!event.summary) return { status: 'invalid', reason: 'event_summary_required', events: [] };
      if (usedKeys.has(event.eventKey)) return { status: 'conflict', reason: 'timeline_event_key_conflict', eventKey: event.eventKey };
      if (event.chronologyIndex === null) {
        allocationCursor += 1000;
        event.chronologyIndex = allocationCursor;
      } else if (event.chronologyIndex <= Number(state.lastChronologyIndex || 0)) {
        hasBackfill = true;
      }
      event.id = event.id || `timeline_event_${hash(`${seriesId}:${event.eventKey}`).slice(0, 20)}`;
      if (usedIds.has(event.id)) return { status: 'conflict', reason: 'timeline_event_id_conflict', eventId: event.id };
      event.seriesId = seriesId;
      event.revisionNumber = 1;
      event.createdBy = actor;
      usedKeys.add(event.eventKey);
      usedIds.add(event.id);
      events.push(event);
    }

    if (hasBackfill && options.allowBackfill !== true) {
      return { status: 'backfill_required', reason: 'past_chronology_insert_requires_explicit_backfill', state };
    }

    const validation = validateEventSet([...currentEvents, ...events]);
    if (!validation.valid) return { status: 'invalid', reason: 'timeline_validation_failed', validation, events: [] };

    try {
      const result = await this.db.commitSerializedTimelineEventsAtomic({
        seriesId,
        events: events.map(snapshotEvent),
        expectedTimelineRevision,
        episodeNumber: options.episodeNumber ?? (events.length === 1 ? events[0].episodeNumber : null),
        commitKind: hasBackfill ? 'backfill' : 'append',
        changeKind: hasBackfill ? 'backfill' : 'create',
        reason,
        actor
      });
      return { status: 'committed', bible: series.bible, validation, ...result };
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes('timeline_revision_conflict')) return { status: 'conflict', reason: 'timeline_revision_conflict', state: await this.db.getSerializedTimelineState(seriesId) };
      if (message.includes('UNIQUE') || message.includes('SQLITE_CONSTRAINT')) return { status: 'conflict', reason: 'timeline_unique_constraint_conflict' };
      throw error;
    }
  }

  async retconEvent(seriesId, eventId, patch = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', event: null };
    const series = await this.requireSeries(seriesId);
    if (series.status !== 'active') return { status: series.status, event: null, bible: series.bible };
    const existing = await this.db.getSerializedTimelineEvent(eventId);
    if (!existing || existing.seriesId !== seriesId) return { status: 'not_found', event: null };
    const reason = clean(options.reason || patch.retconReason || patch.changeReason || '', 1600);
    if (options.allowRetcon !== true && patch.allowRetcon !== true) {
      return { status: 'retcon_required', reason: 'timeline_event_is_append_only', event: existing };
    }
    if (reason.length < 8) return { status: 'retcon_required', reason: 'timeline_retcon_reason_required', event: existing };

    const expectedEventRevision = Number(options.expectedEventRevision ?? patch.expectedEventRevision ?? existing.revisionNumber);
    if (expectedEventRevision !== Number(existing.revisionNumber)) {
      return { status: 'conflict', reason: 'timeline_event_revision_conflict', event: existing };
    }
    const state = await this.db.getSerializedTimelineState(seriesId);
    const expectedTimelineRevision = Number(options.expectedTimelineRevision ?? patch.expectedTimelineRevision ?? state.revisionNumber);
    if (expectedTimelineRevision !== Number(state.revisionNumber || 0)) {
      return { status: 'conflict', reason: 'timeline_revision_conflict', state };
    }

    const next = normalizeEvent(patch, existing);
    next.id = existing.id;
    next.seriesId = existing.seriesId;
    next.createdBy = existing.createdBy;
    next.createdAt = existing.createdAt;
    next.revisionNumber = existing.revisionNumber;
    const before = snapshotEvent(existing);
    const after = snapshotEvent(next);
    if (stableJson(before) === stableJson(after)) return { status: 'unchanged', event: existing, state };

    const all = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    const candidate = all.map(event => event.id === eventId ? next : event);
    const validation = validateEventSet(candidate);
    if (!validation.valid) return { status: 'invalid', reason: 'timeline_validation_failed', validation, event: existing };

    try {
      const result = await this.db.updateSerializedTimelineEventAtomic({
        seriesId,
        event: next,
        expectedEventRevision,
        expectedTimelineRevision,
        commitKind: 'retcon',
        changeKind: 'retcon',
        reason,
        actor: clean(options.actor || patch.actor || 'operator', 200) || 'operator'
      });
      return { status: 'retconned', bible: series.bible, validation, ...result };
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes('timeline_event_revision_conflict')) return { status: 'conflict', reason: 'timeline_event_revision_conflict', event: await this.db.getSerializedTimelineEvent(eventId) };
      if (message.includes('timeline_revision_conflict')) return { status: 'conflict', reason: 'timeline_revision_conflict', state: await this.db.getSerializedTimelineState(seriesId) };
      if (message.includes('UNIQUE') || message.includes('SQLITE_CONSTRAINT')) return { status: 'conflict', reason: 'timeline_unique_constraint_conflict' };
      throw error;
    }
  }

  async validateTimeline(seriesId) {
    const series = await this.requireSeries(seriesId);
    if (series.status === 'not_found') return { valid: false, blockers: [{ code: 'series_not_found' }], eventCount: 0 };
    const events = await this.db.listSerializedTimelineEvents(seriesId, 5000);
    const result = validateEventSet(events);
    return { ...result, state: await this.db.getSerializedTimelineState(seriesId) };
  }

  async getScriptContext(serializedSeriesContext = {}) {
    if (!this.enabled || !serializedSeriesContext?.active || !serializedSeriesContext?.bible) {
      return { active: false, version: VERSION, promptContext: '', events: [] };
    }
    const bible = serializedSeriesContext.bible;
    const validation = await this.validateTimeline(bible.id);
    if (!validation.valid) {
      const codes = validation.blockers.slice(0, 8).map(item => item.code).join(', ');
      throw new Error(`Canonical Timeline invalid for ${bible.id}: ${codes}`);
    }
    const targetEpisode = Math.max(1, Number(serializedSeriesContext.binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
    const all = await this.db.listSerializedTimelineEvents(bible.id, 5000);
    const prior = all
      .filter(event => event.status === 'active' && Number(event.episodeNumber || 0) < targetEpisode)
      .sort((a, b) => Number(a.chronologyIndex) - Number(b.chronologyIndex));
    const selected = prior.slice(Math.max(0, prior.length - this.maxPromptEvents));
    const state = validation.state || await this.db.getSerializedTimelineState(bible.id);
    return {
      active: true,
      version: VERSION,
      bible,
      binding: serializedSeriesContext.binding || null,
      state,
      targetEpisode,
      events: selected,
      promptContext: timelinePromptContext({ bible, binding: serializedSeriesContext.binding, state, events: selected })
    };
  }
}

module.exports = {
  CANONICAL_TIMELINE_VERSION: VERSION,
  CanonicalTimelineServiceV12,
  normalizeEvent,
  snapshotEvent,
  validateEventSet,
  timelinePromptContext,
  stableJson
};
