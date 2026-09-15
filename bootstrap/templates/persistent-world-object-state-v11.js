'use strict';

const crypto = require('crypto');

const VERSION = '11.10.4';

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stableObject(value[key]); return out; }, {});
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function unique(values = [], limit = 64) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw, 240);
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizePersistence(value) {
  const key = normalize(value).replace(/\s+/g, '_');
  if (['until_changed', 'durable', 'persistent', 'carry_forward', 'carryforward'].includes(key)) return 'until_changed';
  return 'scene';
}

function valuesFor(raw, keys = []) {
  for (const key of keys) {
    const value = raw?.[key];
    if (Array.isArray(value)) return unique(value);
    if (value !== undefined && value !== null && clean(value)) return [clean(value, 240)];
  }
  return [];
}

function singleDimension(raw, keys, label, conflicts) {
  const values = valuesFor(raw, keys);
  const normalized = [...new Set(values.map(normalize).filter(Boolean))];
  if (normalized.length > 1) {
    conflicts.push(`${label}:${normalized.join('|')}`);
    return null;
  }
  return values[0] || null;
}

function rawStateFor(value = {}) {
  const nested = value.objectState && typeof value.objectState === 'object' ? value.objectState :
    value.lifecycleState && typeof value.lifecycleState === 'object' ? value.lifecycleState :
    value.state && typeof value.state === 'object' ? value.state : {};
  const keys = ['condition','conditions','damage','damages','cleanliness','openState','openness','openStates','operationalState','operationalStates','contents','holderKey','holder','possessedBy','inUseBy','placement','storyState','storyStates','statePersistence','persistence','stateScope','resetState','clearState','clearPreviousState'];
  const inline = {};
  for (const key of keys) if (value[key] !== undefined) inline[key] = value[key];
  return { ...inline, ...nested };
}

function stateDeclaration(raw, context = {}) {
  if (!raw) return null;
  const value = typeof raw === 'string' ? { name: raw } : raw;
  const stateRaw = rawStateFor(value);
  const hasState = Object.keys(stateRaw).length > 0;
  if (!hasState) return null;
  return {
    environmentId: clean(context.environmentId || value.environmentId || '', 240) || null,
    sceneId: clean(value.sceneId || stateRaw.sceneId || '', 240) || null,
    explicitObjectKey: clean(value.objectKey || value.persistentObjectKey || value.worldObjectKey || value.canonicalObjectKey || value.key || '', 240) || null,
    displayName: clean(value.displayName || value.name || value.originalName || '', 240) || null,
    objectType: clean(value.objectType || value.type || '', 160) || 'object',
    sourceRef: clean(value.id || value.sourceRef || '', 240) || null,
    propLockId: context.propLockId || value.propLockId || null,
    stateRaw
  };
}

function collectStateDeclarations(environmentBible = null, propLocks = []) {
  const out = [];
  for (const environment of environmentBible?.environments || []) {
    for (const field of ['persistentObjects', 'worldObjects', 'canonicalObjects']) {
      for (const raw of Array.isArray(environment[field]) ? environment[field] : []) {
        const declaration = stateDeclaration(raw, { environmentId: environment.environmentId });
        if (declaration) out.push(declaration);
      }
    }
    for (const raw of Array.isArray(environment.objectStates) ? environment.objectStates : []) {
      const declaration = stateDeclaration(raw, { environmentId: environment.environmentId });
      if (declaration) out.push(declaration);
    }
  }
  for (const field of ['persistentObjectStates', 'worldObjectStates', 'objectStates']) {
    for (const raw of Array.isArray(environmentBible?.[field]) ? environmentBible[field] : []) {
      const declaration = stateDeclaration(raw, {});
      if (declaration) out.push(declaration);
    }
  }
  for (const lock of Array.isArray(propLocks) ? propLocks : []) {
    if (!lock?.id) continue;
    const declaration = stateDeclaration(lock, { environmentId: lock.environmentId, propLockId: lock.id });
    if (declaration) out.push(declaration);
  }
  return out;
}

function objectBindings(objectPlan = null) {
  return (objectPlan?.objects || []).filter(item => item?.object?.id).map(item => ({ object: item.object, usage: item.usage || null, matchMode: item.matchMode || item.usage?.matchMode || null }));
}

function bindingForState(declaration = {}, bindings = []) {
  const list = Array.isArray(bindings) ? bindings : [];
  let matches = [];
  if (declaration.explicitObjectKey) {
    const key = normalize(declaration.explicitObjectKey).replace(/\s+/g, '_');
    matches = list.filter(item => normalize(item.object?.objectKey).replace(/\s+/g, '_') === key);
  } else if (declaration.propLockId) {
    matches = list.filter(item => item.usage?.propLockId === declaration.propLockId);
  } else if (declaration.sourceRef) {
    matches = list.filter(item => item.usage?.sourceRef === declaration.sourceRef);
  } else {
    matches = list.filter(item => {
      if (declaration.environmentId && item.usage?.environmentId !== declaration.environmentId) return false;
      if (declaration.displayName && normalize(item.object?.displayName) !== normalize(declaration.displayName)) return false;
      const incomingType = normalize(declaration.objectType || 'object');
      const actualType = normalize(item.object?.objectType || 'object');
      return !incomingType || incomingType === 'object' || actualType === incomingType;
    });
  }
  if (matches.length === 1) return { status: 'resolved', binding: matches[0], candidates: matches };
  if (matches.length > 1) return { status: 'ambiguous', binding: null, candidates: matches };
  return { status: 'unresolved', binding: null, candidates: [] };
}

function normalizeState(raw = {}) {
  const conflicts = [];
  const reset = raw.resetState === true || raw.clearState === true || raw.clearPreviousState === true;
  const condition = reset ? null : singleDimension(raw, ['condition','conditions'], 'condition', conflicts);
  const cleanliness = reset ? null : singleDimension(raw, ['cleanliness'], 'cleanliness', conflicts);
  const openness = reset ? null : singleDimension(raw, ['openState','openness','openStates'], 'openness', conflicts);
  const operationalState = reset ? null : singleDimension(raw, ['operationalState','operationalStates'], 'operational_state', conflicts);
  const holderKey = reset ? null : singleDimension(raw, ['holderKey','holder','possessedBy','inUseBy'], 'holder', conflicts);
  const placement = reset ? null : singleDimension(raw, ['placement'], 'placement', conflicts);
  const damage = reset ? [] : unique(valuesFor(raw, ['damage','damages']));
  const contents = reset ? [] : unique(valuesFor(raw, ['contents']));
  const storyState = reset ? [] : unique(valuesFor(raw, ['storyState','storyStates']));
  const persistence = normalizePersistence(raw.statePersistence || raw.persistence || raw.stateScope || 'scene');
  const state = { condition, damage, cleanliness, openness, operationalState, contents, holderKey, placement, storyState };
  const active = Object.entries(state).some(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value));
  return { state, persistence, conflicts, reset, status: conflicts.length ? 'conflict' : active ? 'active' : 'neutral' };
}

function stateFingerprint(objectId, normalized = {}) {
  return hash(stableJson({ objectId, state: normalized.state || {}, persistence: normalized.persistence || 'scene', status: normalized.status || 'neutral' }));
}

function statePromptFragment(row = {}) {
  if (!row?.objectId) return '';
  const details = [
    row.condition && `condition=${row.condition}`,
    row.damage?.length && `damage=${row.damage.join(', ')}`,
    row.cleanliness && `cleanliness=${row.cleanliness}`,
    row.openness && `open_state=${row.openness}`,
    row.operationalState && `operational=${row.operationalState}`,
    row.contents?.length && `contents=${row.contents.join(', ')}`,
    row.holderKey && `in_use_by=${row.holderKey}`,
    row.placement && `placement=${row.placement}`,
    row.storyState?.length && `story_state=${row.storyState.join(', ')}`
  ].filter(Boolean);
  return [
    `PERSISTENT WORLD OBJECT STATE V${VERSION}:`,
    `OBJECT ID: ${row.objectId}`,
    `STATE STATUS: ${row.status || 'neutral'}; PERSISTENCE: ${row.persistence || 'scene'}`,
    details.length ? details.join('; ') : 'neutral / no active state dimensions',
    row.inherited ? `INHERITED FROM STATE: ${row.parentStateId || 'prior durable state'}` : '',
    'Apply this as a state/lifecycle overlay only. Do not rewrite objectId, canonical identity fingerprint, object type, brand/model, canonical color/material, or canonical object asset.',
    'Scene state expires unless persistence=until_changed. Durable state remains in force until an explicit later durable state or reset replaces it.'
  ].filter(Boolean).join('\n').slice(0, 12000);
}

class PersistentWorldObjectStateLayerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_WORLD_OBJECT_STATES_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.inheritDurable = String(options.inheritDurable ?? process.env.PERSISTENT_WORLD_OBJECT_STATE_INHERIT_DURABLE ?? 'true').toLowerCase() !== 'false';
  }

  async persistState(production = {}, binding = {}, declaration = null, normalized = null, options = {}) {
    const object = binding.object;
    const usage = binding.usage || {};
    const sceneId = declaration?.sceneId || null;
    const scopeKey = sceneId || declaration?.environmentId || usage.environmentId || 'production';
    const id = `world_object_state_${hash(`${production.id}:${object.id}:${scopeKey}`).slice(0, 20)}`;
    const state = normalized?.state || {};
    const row = {
      id,
      objectId: object.id,
      productionId: production.id,
      sceneId,
      scopeKey,
      version: VERSION,
      status: normalized?.status || 'neutral',
      persistence: normalized?.persistence || 'scene',
      stateFingerprint: stateFingerprint(object.id, normalized || {}),
      condition: state.condition || null,
      damage: state.damage || [],
      cleanliness: state.cleanliness || null,
      openness: state.openness || null,
      operationalState: state.operationalState || null,
      contents: state.contents || [],
      holderKey: state.holderKey || null,
      placement: state.placement || null,
      storyState: state.storyState || [],
      conflicts: normalized?.conflicts || [],
      sourceKind: options.sourceKind || 'explicit_object_state',
      sourceRef: declaration?.sourceRef || null,
      parentStateId: options.parentStateId || null,
      inherited: options.inherited === true,
      canonicalIdentityFingerprint: object.identityFingerprint || null
    };
    return this.db?.savePersistentWorldObjectState ? await this.db.savePersistentWorldObjectState(row) : row;
  }

  async ensureProductionStates(production = {}, environmentBible = null, propLocks = [], objectPlan = null) {
    if (!this.enabled || !production?.id) return { version: VERSION, active: this.enabled, states: [], decisions: [], summary: { active: 0, neutral: 0, inherited: 0, conflicts: 0, ambiguous: 0, unresolved: 0 } };
    const bindings = objectBindings(objectPlan);
    const declarations = collectStateDeclarations(environmentBible, propLocks);
    const states = [];
    const decisions = [];
    const explicitlyHandled = new Set();

    for (const declaration of declarations) {
      const resolved = bindingForState(declaration, bindings);
      if (resolved.status !== 'resolved') {
        decisions.push({ status: resolved.status, declaration, reason: resolved.status === 'ambiguous' ? 'state_declaration_matches_multiple_objects' : 'state_declaration_object_not_found' });
        continue;
      }
      const binding = resolved.binding;
      const normalized = normalizeState(declaration.stateRaw || {});
      const row = await this.persistState(production, binding, declaration, normalized, { sourceKind: 'explicit_object_state' });
      states.push(row);
      explicitlyHandled.add(binding.object.id);
      decisions.push({ status: row.status, objectId: binding.object.id, stateId: row.id, persistence: row.persistence, conflicts: row.conflicts || [] });
    }

    if (this.inheritDurable && this.db?.getLatestDurablePersistentWorldObjectState) {
      for (const binding of bindings) {
        const objectId = binding.object.id;
        if (explicitlyHandled.has(objectId)) continue;
        const previous = await this.db.getLatestDurablePersistentWorldObjectState(objectId, production.id);
        if (!previous || previous.persistence !== 'until_changed') continue;
        const normalized = {
          status: previous.status || 'neutral', persistence: 'until_changed', conflicts: [],
          state: {
            condition: previous.condition || null,
            damage: previous.damage || [],
            cleanliness: previous.cleanliness || null,
            openness: previous.openness || null,
            operationalState: previous.operationalState || null,
            contents: previous.contents || [],
            holderKey: previous.holderKey || null,
            placement: previous.placement || null,
            storyState: previous.storyState || []
          }
        };
        const row = await this.persistState(production, binding, null, normalized, { sourceKind: 'inherited_durable_state', parentStateId: previous.id, inherited: true });
        states.push(row);
        decisions.push({ status: 'inherited', objectId, stateId: row.id, parentStateId: previous.id, persistence: 'until_changed' });
      }
    }

    const summary = {
      active: states.filter(row => row.status === 'active').length,
      neutral: states.filter(row => row.status === 'neutral').length,
      inherited: states.filter(row => row.inherited === true).length,
      conflicts: states.filter(row => row.status === 'conflict').length,
      ambiguous: decisions.filter(row => row.status === 'ambiguous').length,
      unresolved: decisions.filter(row => row.status === 'unresolved').length
    };
    this.logger.info(`Persistent World Object State v${VERSION}: active=${summary.active}, neutral=${summary.neutral}, inherited=${summary.inherited}, conflicts=${summary.conflicts}, ambiguous=${summary.ambiguous}.`);
    return { version: VERSION, active: true, states, decisions, summary };
  }
}

module.exports = {
  PERSISTENT_WORLD_OBJECT_STATE_VERSION: VERSION,
  PersistentWorldObjectStateLayerV11,
  normalize,
  normalizePersistence,
  rawStateFor,
  stateDeclaration,
  collectStateDeclarations,
  objectBindings,
  bindingForState,
  normalizeState,
  stateFingerprint,
  statePromptFragment
};
