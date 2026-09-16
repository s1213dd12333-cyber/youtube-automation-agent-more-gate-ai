'use strict';

const crypto = require('crypto');

const VERSION = '11.12.1';

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value, limit = 8000) {
  return clean(value, limit)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return normalize(value, 200).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'series';
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
  const list = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  for (const value of list.slice(0, limit * 2)) {
    const text = clean(value, itemLimit);
    const key = normalize(text, itemLimit);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizePlannedEnding(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string') return clean(value, 6000);
  if (typeof value === 'object') return stable(value);
  return clean(value, 6000);
}

function normalizeBible(input = {}, base = {}) {
  const merged = { ...base, ...input };
  const namespace = clean(merged.namespace || 'default', 200) || 'default';
  const title = clean(merged.title || base.title || '', 240);
  const seriesKey = clean(merged.seriesKey || base.seriesKey || slug(title), 220) || slug(title);
  const plannedEndingSource = Object.prototype.hasOwnProperty.call(input, 'plannedEnding')
    ? input.plannedEnding
    : (Object.prototype.hasOwnProperty.call(base, 'plannedEnding') ? base.plannedEnding : null);
  return {
    id: clean(merged.id || base.id || '', 240) || null,
    namespace,
    seriesKey,
    title,
    format: clean(merged.format || base.format || 'serialized', 80) || 'serialized',
    genres: uniqueStrings(merged.genres ?? base.genres ?? merged.genre ?? base.genre ?? [], 24, 120),
    premise: clean(merged.premise ?? base.premise ?? '', 8000),
    worldRules: uniqueStrings(merged.worldRules ?? base.worldRules ?? [], 120, 1400),
    immutableCanon: uniqueStrings(merged.immutableCanon ?? base.immutableCanon ?? [], 240, 1800),
    narrativeRules: uniqueStrings(merged.narrativeRules ?? base.narrativeRules ?? [], 120, 1400),
    centralConflicts: uniqueStrings(merged.centralConflicts ?? base.centralConflicts ?? [], 120, 1800),
    plannedEnding: normalizePlannedEnding(plannedEndingSource),
    currentEpisode: Math.max(0, Math.floor(Number(merged.currentEpisode ?? base.currentEpisode ?? 0) || 0)),
    canonVersion: Math.max(1, Math.floor(Number(merged.canonVersion ?? base.canonVersion ?? 1) || 1)),
    revisionNumber: Math.max(1, Math.floor(Number(merged.revisionNumber ?? base.revisionNumber ?? 1) || 1)),
    status: clean(merged.status || base.status || 'active', 40) || 'active',
    createdBy: clean(merged.createdBy || base.createdBy || '', 200) || null
  };
}

function snapshotBible(bible = {}) {
  return stable({
    id: bible.id,
    namespace: bible.namespace,
    seriesKey: bible.seriesKey,
    title: bible.title,
    format: bible.format,
    genres: bible.genres || [],
    premise: bible.premise || '',
    worldRules: bible.worldRules || [],
    immutableCanon: bible.immutableCanon || [],
    narrativeRules: bible.narrativeRules || [],
    centralConflicts: bible.centralConflicts || [],
    plannedEnding: bible.plannedEnding ?? null,
    currentEpisode: bible.currentEpisode || 0,
    canonVersion: bible.canonVersion || 1,
    revisionNumber: bible.revisionNumber || 1,
    status: bible.status || 'active'
  });
}

function explicitSeriesRef(strategy = {}) {
  const series = strategy.series && typeof strategy.series === 'object' ? strategy.series : {};
  const metadata = strategy.metadata && typeof strategy.metadata === 'object' ? strategy.metadata : {};
  const seriesId = clean(strategy.seriesId || strategy.serializedSeriesId || series.id || metadata.seriesId || metadata.serializedSeriesId || '', 240) || null;
  const seriesKey = clean(strategy.seriesKey || strategy.serializedSeriesKey || series.key || series.seriesKey || metadata.seriesKey || metadata.serializedSeriesKey || '', 220) || null;
  const namespace = clean(strategy.seriesNamespace || series.namespace || metadata.seriesNamespace || process.env.SERIALIZED_STORY_NAMESPACE || 'default', 200) || 'default';
  return { seriesId, seriesKey, namespace };
}

function listBlock(title, values = [], fallback = 'None declared.') {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return `${title}:\n- ${fallback}`;
  return `${title}:\n${items.map(item => `- ${clean(item, 1800)}`).join('\n')}`;
}

function plannedEndingText(value) {
  if (value === null || value === undefined || value === '') return 'Not declared.';
  if (typeof value === 'string') return clean(value, 6000);
  return JSON.stringify(stable(value));
}

function seriesPromptContext(bible = {}, binding = null) {
  const targetEpisode = Math.max(1, Number(binding?.episodeNumber || 0) || Number(bible.currentEpisode || 0) + 1);
  return [
    `SERIALIZED SERIES BIBLE V${VERSION}`,
    `SERIES ID: ${bible.id}`,
    `SERIES KEY: ${bible.seriesKey}`,
    `TITLE: ${bible.title}`,
    `FORMAT: ${bible.format || 'serialized'}`,
    `GENRES: ${(bible.genres || []).join(', ') || 'not declared'}`,
    `CANON VERSION: ${bible.canonVersion || 1}`,
    `BIBLE REVISION: ${bible.revisionNumber || 1}`,
    `LAST COMMITTED EPISODE: ${bible.currentEpisode || 0}`,
    `TARGET EPISODE: ${targetEpisode}`,
    '',
    `PREMISE:\n${bible.premise || 'Not declared.'}`,
    '',
    listBlock('IMMUTABLE CANON — HARD CONSTRAINTS', bible.immutableCanon, 'No immutable facts declared yet.'),
    '',
    listBlock('WORLD RULES', bible.worldRules, 'No world rules declared yet.'),
    '',
    listBlock('NARRATIVE RULES', bible.narrativeRules, 'No narrative rules declared yet.'),
    '',
    listBlock('CENTRAL CONFLICTS', bible.centralConflicts, 'No central conflicts declared yet.'),
    '',
    `PLANNED ENDING / DESTINATION:\n${plannedEndingText(bible.plannedEnding)}`,
    '',
    'SERIALIZED NARRATIVE SAFETY:',
    '- Treat immutable canon and world rules as hard constraints unless an explicit audited retcon has already changed the Series Bible.',
    '- Never invent a retcon just to satisfy the current episode prompt.',
    '- Do not silently reset character knowledge, relationships, object state, chronology, deaths, discoveries, or world rules.',
    '- If the requested episode conflicts with this Bible, preserve canon and make the conflict explicit instead of normalizing the contradiction.',
    '- Script generation does NOT commit new canon. Canon changes are persisted only by the dedicated narrative-memory commit flow.',
    '- Use the target episode number only for continuity context; do not claim earlier episodes happened unless supplied by canonical memory.'
  ].join('\n').slice(0, 24000);
}

class SerializedSeriesBibleServiceV12 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.SERIALIZED_SERIES_BIBLE_ENABLED || 'true').toLowerCase() !== 'false';
    this.defaultNamespace = clean(options.namespace || process.env.SERIALIZED_STORY_NAMESPACE || 'default', 200) || 'default';
  }

  async createBible(input = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', bible: null };
    const actor = clean(options.actor || input.actor || 'operator', 200) || 'operator';
    const bible = normalizeBible({ ...input, namespace: input.namespace || this.defaultNamespace, createdBy: actor });
    if (!bible.title) throw new Error('Series Bible title is required');
    if (!bible.premise) throw new Error('Series Bible premise is required');

    const existing = await this.db.getSerializedSeriesBibleByKey(bible.namespace, bible.seriesKey);
    if (existing) return { status: 'exists', bible: existing };

    bible.id = bible.id || `series_${hash(`${bible.namespace}:${bible.seriesKey}`).slice(0, 20)}`;
    bible.canonVersion = 1;
    bible.revisionNumber = 1;
    const saved = await this.db.createSerializedSeriesBible(bible);
    if (!saved) throw new Error('Failed to persist Series Bible');
    const created = saved.id === bible.id && saved.revisionNumber === 1;
    if (created) {
      await this.db.saveSerializedSeriesBibleRevision({
        seriesId: saved.id,
        revisionNumber: saved.revisionNumber,
        canonVersion: saved.canonVersion,
        snapshot: snapshotBible(saved),
        changeKind: 'create',
        changeReason: clean(options.reason || 'initial_series_bible', 1200),
        actor
      });
    }
    return { status: created ? 'created' : 'exists', bible: saved };
  }

  async updateBible(seriesId, patch = {}, options = {}) {
    if (!this.enabled) return { status: 'disabled', bible: null };
    const existing = await this.db.getSerializedSeriesBible(seriesId);
    if (!existing) return { status: 'not_found', bible: null };

    const expectedRevision = Number(options.expectedRevisionNumber ?? patch.expectedRevisionNumber ?? existing.revisionNumber);
    if (!Number.isFinite(expectedRevision) || expectedRevision !== Number(existing.revisionNumber)) {
      return { status: 'conflict', reason: 'stale_series_bible_revision', bible: existing };
    }

    const immutableRequested = Object.prototype.hasOwnProperty.call(patch, 'immutableCanon');
    const nextImmutable = immutableRequested ? uniqueStrings(patch.immutableCanon, 240, 1800) : existing.immutableCanon;
    const immutableChanged = immutableRequested && stableJson(nextImmutable) !== stableJson(existing.immutableCanon || []);
    const allowRetcon = options.allowRetcon === true || patch.allowRetcon === true;
    const reason = clean(options.reason || patch.retconReason || patch.changeReason || '', 1600);
    if (immutableChanged && (!allowRetcon || reason.length < 8)) {
      return { status: 'retcon_required', reason: 'immutable_canon_requires_explicit_retcon_reason', bible: existing };
    }

    const requestedEpisode = Object.prototype.hasOwnProperty.call(patch, 'currentEpisode')
      ? Math.max(0, Math.floor(Number(patch.currentEpisode) || 0))
      : existing.currentEpisode;
    if (requestedEpisode < Number(existing.currentEpisode || 0) && options.allowEpisodeRewind !== true) {
      return { status: 'conflict', reason: 'episode_rewind_forbidden', bible: existing };
    }

    const allowedPatch = {
      title: patch.title ?? existing.title,
      format: patch.format ?? existing.format,
      genres: patch.genres ?? patch.genre ?? existing.genres,
      premise: patch.premise ?? existing.premise,
      worldRules: patch.worldRules ?? existing.worldRules,
      immutableCanon: nextImmutable,
      narrativeRules: patch.narrativeRules ?? existing.narrativeRules,
      centralConflicts: patch.centralConflicts ?? existing.centralConflicts,
      plannedEnding: Object.prototype.hasOwnProperty.call(patch, 'plannedEnding') ? patch.plannedEnding : existing.plannedEnding,
      currentEpisode: requestedEpisode,
      status: patch.status ?? existing.status
    };
    const next = normalizeBible(allowedPatch, existing);
    next.id = existing.id;
    next.namespace = existing.namespace;
    next.seriesKey = existing.seriesKey;
    next.createdBy = existing.createdBy;
    next.canonVersion = Number(existing.canonVersion || 1) + (immutableChanged ? 1 : 0);
    next.revisionNumber = Number(existing.revisionNumber || 1) + 1;

    const saved = await this.db.updateSerializedSeriesBible(next, existing.revisionNumber);
    if (!saved || Number(saved.revisionNumber) !== next.revisionNumber) {
      return { status: 'conflict', reason: 'concurrent_series_bible_update', bible: await this.db.getSerializedSeriesBible(seriesId) };
    }

    const actor = clean(options.actor || patch.actor || 'operator', 200) || 'operator';
    await this.db.saveSerializedSeriesBibleRevision({
      seriesId: saved.id,
      revisionNumber: saved.revisionNumber,
      canonVersion: saved.canonVersion,
      snapshot: snapshotBible(saved),
      changeKind: immutableChanged ? 'retcon' : 'update',
      changeReason: reason || 'series_bible_update',
      actor
    });
    return { status: immutableChanged ? 'retconned' : 'updated', bible: saved };
  }

  async advanceEpisode(seriesId, episodeNumber, options = {}) {
    const existing = await this.db.getSerializedSeriesBible(seriesId);
    if (!existing) return { status: 'not_found', bible: null };
    const nextEpisode = Math.max(0, Math.floor(Number(episodeNumber) || 0));
    if (nextEpisode <= Number(existing.currentEpisode || 0)) {
      return { status: 'conflict', reason: 'episode_must_advance_monotonically', bible: existing };
    }
    return this.updateBible(seriesId, { currentEpisode: nextEpisode }, {
      expectedRevisionNumber: existing.revisionNumber,
      actor: options.actor,
      reason: options.reason || `advance_to_episode_${nextEpisode}`
    });
  }

  async bindStrategy(seriesId, input = {}, options = {}) {
    const bible = await this.db.getSerializedSeriesBible(seriesId);
    if (!bible) return { status: 'not_found', binding: null, bible: null };
    const strategyId = clean(input.strategyId || input.id || '', 240);
    if (!strategyId) throw new Error('strategyId is required');
    const existing = await this.db.getSerializedSeriesStrategyBinding(strategyId);
    const allowRebind = options.allowRebind === true || input.allowRebind === true;
    const reason = clean(options.reason || input.reason || '', 1600);
    if (existing && existing.seriesId !== seriesId && (!allowRebind || reason.length < 8)) {
      return { status: 'conflict', reason: 'strategy_already_bound_to_another_series', binding: existing, bible };
    }
    const episodeNumber = Math.max(1, Math.floor(Number(input.episodeNumber) || (Number(bible.currentEpisode || 0) + 1)));
    const actor = clean(options.actor || input.actor || 'operator', 200) || 'operator';
    const binding = await this.db.bindSerializedSeriesStrategy({
      strategyId,
      seriesId,
      episodeNumber,
      actor,
      reason: reason || 'explicit_strategy_series_binding'
    });
    return { status: existing ? 'rebound' : 'bound', binding, bible };
  }

  async resolveBibleForStrategy(strategy = {}) {
    if (!this.enabled) return { bible: null, binding: null, resolutionMode: 'disabled' };
    const ref = explicitSeriesRef(strategy);
    if (ref.seriesId) {
      const bible = await this.db.getSerializedSeriesBible(ref.seriesId);
      return { bible, binding: null, resolutionMode: bible ? 'explicit_series_id' : 'explicit_series_id_not_found' };
    }
    if (ref.seriesKey) {
      const bible = await this.db.getSerializedSeriesBibleByKey(ref.namespace || this.defaultNamespace, ref.seriesKey);
      return { bible, binding: null, resolutionMode: bible ? 'explicit_series_key' : 'explicit_series_key_not_found' };
    }
    const strategyId = clean(strategy.id || strategy.strategyId || '', 240);
    if (strategyId && typeof this.db.getSerializedSeriesStrategyBinding === 'function') {
      const binding = await this.db.getSerializedSeriesStrategyBinding(strategyId);
      if (binding) {
        const bible = await this.db.getSerializedSeriesBible(binding.seriesId);
        return { bible, binding, resolutionMode: bible ? 'strategy_binding' : 'strategy_binding_series_missing' };
      }
    }
    return { bible: null, binding: null, resolutionMode: 'unbound' };
  }

  async getScriptContext(strategy = {}) {
    const resolved = await this.resolveBibleForStrategy(strategy);
    if (!resolved.bible || resolved.bible.status !== 'active') {
      return { active: false, version: VERSION, ...resolved, promptContext: '' };
    }
    return {
      active: true,
      version: VERSION,
      ...resolved,
      promptContext: seriesPromptContext(resolved.bible, resolved.binding)
    };
  }
}

module.exports = {
  SERIALIZED_SERIES_BIBLE_VERSION: VERSION,
  SerializedSeriesBibleServiceV12,
  normalizeBible,
  snapshotBible,
  explicitSeriesRef,
  seriesPromptContext,
  stableJson
};
