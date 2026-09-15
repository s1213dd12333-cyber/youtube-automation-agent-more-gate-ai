'use strict';

const crypto = require('crypto');

const VERSION = '11.10.5';
const VISIBILITY = new Set(['visible', 'occluded', 'offscreen', 'mentioned']);
const INTERACTIONS = new Set(['none', 'held', 'carried', 'used', 'operated', 'possessed', 'inside', 'worn']);

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stableObject(value[key]); return out; }, {});
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function uniqueNumbers(values = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : [values]) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || seen.has(n)) continue;
    seen.add(n); out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function normalizeVisibility(value, fallback = 'visible') {
  const key = normalize(value).replace(/\s+/g, '_');
  if (['hidden', 'not_visible', 'notvisible', 'out_of_frame'].includes(key)) return 'offscreen';
  if (['partial', 'partially_visible', 'partially_occluded'].includes(key)) return 'occluded';
  if (['reference_only', 'mention', 'mentioned_only'].includes(key)) return 'mentioned';
  return VISIBILITY.has(key) ? key : fallback;
}

function normalizeInteraction(value) {
  const key = normalize(value).replace(/\s+/g, '_');
  const aliases = { holding: 'held', carry: 'carried', carrying: 'carried', using: 'used', driving: 'operated', ownership: 'possessed', owned: 'possessed', contained: 'inside', wearing: 'worn' };
  const normalized = aliases[key] || key || 'none';
  return INTERACTIONS.has(normalized) ? normalized : 'none';
}

function declarationFromRaw(raw = {}, context = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const objectId = clean(raw.objectId || raw.persistentObjectId || '', 240) || null;
  const objectKey = clean(raw.objectKey || raw.persistentObjectKey || raw.worldObjectKey || '', 240) || null;
  const reference = clean(raw.reference || raw.object || raw.name || raw.displayName || objectKey || objectId || '', 240) || null;
  if (!reference && !objectId && !objectKey) return null;
  const shotIndexes = uniqueNumbers(raw.shotIndexes ?? raw.shots ?? (raw.shotIndex == null ? [] : [raw.shotIndex]));
  return {
    sceneId: clean(context.sceneId || raw.sceneId || '', 240) || null,
    scenePosition: Number.isInteger(Number(raw.scenePosition)) ? Number(raw.scenePosition) : context.scenePosition ?? null,
    objectId,
    objectKey,
    reference,
    shotIndexes,
    visibility: normalizeVisibility(raw.visibility || raw.presence || (raw.visible === false ? 'offscreen' : 'visible')),
    interaction: normalizeInteraction(raw.interaction || raw.relation || raw.action || 'none'),
    holderKey: clean(raw.holderKey || raw.holder || raw.possessedBy || raw.inUseBy || '', 240) || null,
    placement: clean(raw.placement || raw.position || raw.locationInFrame || '', 500) || null,
    required: raw.required !== false,
    sourceKind: clean(context.sourceKind || raw.sourceKind || 'scene_object_binding', 240),
    sourceRef: clean(raw.id || raw.sourceRef || '', 240) || null
  };
}

function collectSceneDeclarations(scenes = [], environmentBible = null) {
  const out = [];
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const groups = [
      ['objectBindings', scene.objectBindings],
      ['worldObjectBindings', scene.worldObjectBindings],
      ['persistentObjectBindings', scene.persistentObjectBindings],
      ['shotObjectBindings', scene.shotObjectBindings]
    ];
    for (const [field, values] of groups) {
      for (const raw of Array.isArray(values) ? values : []) {
        const declaration = declarationFromRaw(raw, { sceneId: scene.id, scenePosition: Number(scene.position || 0), sourceKind: `scene_${field}` });
        if (declaration) out.push(declaration);
      }
    }
  }
  for (const field of ['objectBindings', 'worldObjectBindings', 'persistentObjectBindings', 'shotObjectBindings']) {
    for (const raw of Array.isArray(environmentBible?.[field]) ? environmentBible[field] : []) {
      const declaration = declarationFromRaw(raw, { sourceKind: `environment_bible_${field}` });
      if (declaration) out.push(declaration);
    }
  }
  for (const environment of environmentBible?.environments || []) {
    for (const field of ['objectBindings', 'worldObjectBindings', 'persistentObjectBindings', 'shotObjectBindings']) {
      for (const raw of Array.isArray(environment[field]) ? environment[field] : []) {
        const declaration = declarationFromRaw(raw, { sourceKind: `environment_${field}` });
        if (declaration) out.push(declaration);
      }
    }
  }
  return out;
}

function objectBindings(objectPlan = null) {
  return (objectPlan?.objects || []).filter(item => item?.object?.id).map(item => ({ object: item.object, usage: item.usage || null, matchMode: item.matchMode || item.usage?.matchMode || null }));
}

function stateForObject(statePlan = null, objectId, sceneId = null) {
  const rows = (statePlan?.states || []).filter(row => row?.objectId === objectId);
  if (!rows.length) return null;
  if (sceneId) {
    const exact = rows.find(row => row.sceneId === sceneId);
    if (exact) return exact;
  }
  return rows.find(row => !row.sceneId) || rows[0];
}

function assetForObject(assetPlan = null, objectId) {
  return (assetPlan?.assets || []).find(asset => asset?.objectId === objectId && asset.canonical !== false && asset.status === 'ready') || null;
}

function shotTargets(declaration = {}, shotPlan = null) {
  const scenes = shotPlan?.scenes || [];
  let scenePlan = null;
  if (declaration.sceneId) scenePlan = scenes.find(item => item.sceneId === declaration.sceneId) || null;
  if (!scenePlan && declaration.scenePosition != null) scenePlan = scenes.find(item => Number(item.scenePosition) === Number(declaration.scenePosition)) || null;
  if (!scenePlan) return { status: 'unresolved', scenePlan: null, shots: [], reason: 'scene_not_found' };
  const shots = declaration.shotIndexes.length
    ? scenePlan.shots.filter(shot => declaration.shotIndexes.includes(Number(shot.shotIndex)))
    : [...scenePlan.shots];
  if (declaration.shotIndexes.length && shots.length !== declaration.shotIndexes.length) return { status: 'unresolved', scenePlan, shots, reason: 'shot_index_not_found' };
  return { status: 'resolved', scenePlan, shots, reason: null };
}

async function resolveObjectReference(db, declaration = {}, bindings = []) {
  const list = Array.isArray(bindings) ? bindings : [];
  if (declaration.objectId) {
    const exact = list.filter(item => item.object?.id === declaration.objectId);
    if (exact.length === 1) return { status: 'resolved', binding: exact[0], candidates: exact, matchMode: 'object_id_exact', confidence: 1 };
    return { status: exact.length > 1 ? 'ambiguous' : 'unresolved', binding: null, candidates: exact, matchMode: exact.length > 1 ? 'object_id_ambiguous' : null, confidence: 0 };
  }
  if (declaration.objectKey) {
    const key = normalize(declaration.objectKey).replace(/\s+/g, '_');
    const exact = list.filter(item => normalize(item.object?.objectKey).replace(/\s+/g, '_') === key);
    if (exact.length === 1) return { status: 'resolved', binding: exact[0], candidates: exact, matchMode: 'object_key_exact', confidence: 1 };
    if (exact.length > 1) return { status: 'ambiguous', binding: null, candidates: exact, matchMode: 'object_key_ambiguous', confidence: 0 };
  }
  const referenceKey = normalize(declaration.reference);
  if (!referenceKey) return { status: 'unresolved', binding: null, candidates: [], matchMode: null, confidence: 0 };
  if (db?.listPersistentWorldObjectAliasesByKey) {
    const aliases = await db.listPersistentWorldObjectAliasesByKey(list[0]?.object?.namespace || 'default', referenceKey);
    const allowedIds = new Set(list.map(item => item.object.id));
    const aliasIds = [...new Set((aliases || []).map(row => row.objectId || row.object?.id).filter(id => allowedIds.has(id)))];
    const matches = list.filter(item => aliasIds.includes(item.object.id));
    if (matches.length === 1) return { status: 'resolved', binding: matches[0], candidates: matches, matchMode: 'object_alias_exact', confidence: 0.99 };
    if (matches.length > 1) return { status: 'ambiguous', binding: null, candidates: matches, matchMode: 'object_alias_ambiguous', confidence: 0 };
  }
  const named = list.filter(item => normalize(item.object?.displayName) === referenceKey || normalize(String(item.object?.objectKey || '').replace(/[_-]+/g, ' ')) === referenceKey);
  if (named.length === 1) return { status: 'resolved', binding: named[0], candidates: named, matchMode: 'object_name_exact', confidence: 0.97 };
  if (named.length > 1) return { status: 'ambiguous', binding: null, candidates: named, matchMode: 'object_name_ambiguous', confidence: 0 };
  return { status: 'unresolved', binding: null, candidates: [], matchMode: null, confidence: 0 };
}

function bindingKey(productionId, sceneId, shotId, referenceKey) {
  return `world_object_binding_${hash(`${productionId}:${sceneId}:${shotId}:${referenceKey}`).slice(0, 22)}`;
}

function bindingFingerprint(row = {}) {
  return hash(stableJson({
    objectId: row.objectId || null,
    sceneId: row.sceneId || null,
    shotId: row.shotId || null,
    visibility: row.visibility || null,
    interaction: row.interaction || null,
    holderKey: row.holderKey || null,
    placement: row.placement || null,
    stateFingerprint: row.stateFingerprint || null,
    canonicalAssetSha256: row.canonicalAssetSha256 || null
  }));
}

function bindingPromptFragment(row = {}) {
  if (row.status !== 'resolved' || !row.objectId) return '';
  const visible = row.visibility === 'visible' || row.visibility === 'occluded';
  const lines = [
    `PERSISTENT WORLD OBJECT BINDING V${VERSION}:`,
    `OBJECT ID: ${row.objectId}`,
    `OBJECT KEY: ${row.objectKey || 'unknown'}`,
    `VISIBILITY: ${row.visibility}`,
    `INTERACTION: ${row.interaction || 'none'}`,
    row.holderKey ? `HOLDER / USER: ${row.holderKey}` : '',
    row.placement ? `PLACEMENT: ${row.placement}` : '',
    row.canonicalAssetId ? `CANONICAL OBJECT ASSET: ${row.canonicalAssetId} · sha256 ${row.canonicalAssetSha256 || 'unknown'}` : '',
    row.stateId ? `OBJECT STATE: ${row.stateId} · ${row.stateFingerprint || 'no fingerprint'}` : '',
    visible
      ? 'Render this exact persistent object identity in the frame. Preserve its canonical visual identity; apply lifecycle state only as an overlay.'
      : 'Do NOT render this object in the frame. It is offscreen/mentioned only; do not hallucinate it into view.',
    'Do not replace it with a same-type generic prop, and do not create a second copy unless the binding explicitly requests another objectId.'
  ].filter(Boolean);
  return lines.join('\n').slice(0, 12000);
}

function mergeRowsForShot(rows = []) {
  const byObject = new Map();
  const conflicts = [];
  for (const row of rows) {
    if (row.status !== 'resolved' || !row.objectId) continue;
    const existing = byObject.get(row.objectId);
    if (!existing) { byObject.set(row.objectId, row); continue; }
    const contradictory = ['visibility', 'interaction', 'holderKey', 'placement'].some(field => existing[field] && row[field] && existing[field] !== row[field]);
    if (contradictory) {
      conflicts.push({ ...row, status: 'conflict', reason: 'contradictory_bindings_for_same_object_and_shot' });
      byObject.delete(row.objectId);
    }
  }
  return { resolved: [...byObject.values()], conflicts };
}

class PersistentWorldObjectBindingV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_WORLD_OBJECT_BINDINGS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireExplicit = String(options.requireExplicit ?? process.env.PERSISTENT_WORLD_OBJECT_BINDINGS_REQUIRE_EXPLICIT ?? 'true').toLowerCase() !== 'false';
  }

  async bindShotPlan(input = {}) {
    const { production = {}, scenes = [], shotPlan = null, environmentBible = null, objectPlan = null, statePlan = null, assetPlan = null } = input;
    if (!this.enabled || !production?.id || !shotPlan) return { version: VERSION, active: this.enabled, shotPlan, bindings: [], decisions: [], summary: { resolved: 0, visible: 0, nonvisual: 0, conflicts: 0, ambiguous: 0, unresolved: 0 } };
    const declarations = collectSceneDeclarations(scenes, environmentBible);
    const objects = objectBindings(objectPlan);
    const rows = [];
    const decisions = [];

    for (const declaration of declarations) {
      const targets = shotTargets(declaration, shotPlan);
      if (targets.status !== 'resolved') {
        decisions.push({ status: 'unresolved', declaration, reason: targets.reason });
        continue;
      }
      const resolved = await resolveObjectReference(this.db, declaration, objects);
      if (resolved.status !== 'resolved') {
        decisions.push({ status: resolved.status, declaration, reason: resolved.status === 'ambiguous' ? 'object_reference_ambiguous' : 'object_reference_not_found', candidateObjectIds: resolved.candidates.map(item => item.object.id) });
        continue;
      }
      const object = resolved.binding.object;
      const state = stateForObject(statePlan, object.id, declaration.sceneId || targets.scenePlan.sceneId);
      const asset = assetForObject(assetPlan, object.id);
      for (const shot of targets.shots) {
        const referenceKey = normalize(declaration.reference || declaration.objectKey || declaration.objectId || object.objectKey || object.id);
        const row = {
          id: bindingKey(production.id, targets.scenePlan.sceneId, shot.id, `${referenceKey}:${declaration.sourceRef || declaration.sourceKind}`),
          productionId: production.id,
          sceneId: targets.scenePlan.sceneId,
          shotId: shot.id,
          shotIndex: Number(shot.shotIndex || 0),
          objectId: object.id,
          objectKey: object.objectKey || null,
          version: VERSION,
          status: 'resolved',
          referenceText: declaration.reference || object.displayName || object.objectKey || object.id,
          referenceKey,
          matchMode: resolved.matchMode,
          confidence: resolved.confidence,
          visibility: declaration.visibility,
          interaction: declaration.interaction,
          holderKey: declaration.holderKey,
          placement: declaration.placement,
          required: declaration.required,
          stateId: state?.id || null,
          stateFingerprint: state?.stateFingerprint || null,
          canonicalAssetId: asset?.id || null,
          canonicalAssetSha256: asset?.assetSha256 || null,
          sourceKind: declaration.sourceKind,
          sourceRef: declaration.sourceRef,
          reason: null
        };
        row.bindingFingerprint = bindingFingerprint(row);
        row.promptFragment = bindingPromptFragment(row);
        rows.push(row);
      }
    }

    const rowsByShot = new Map();
    for (const row of rows) {
      if (!rowsByShot.has(row.shotId)) rowsByShot.set(row.shotId, []);
      rowsByShot.get(row.shotId).push(row);
    }
    const finalRows = [];
    for (const scenePlan of shotPlan.scenes || []) {
      for (const shot of scenePlan.shots || []) {
        const merged = mergeRowsForShot(rowsByShot.get(shot.id) || []);
        for (const conflict of merged.conflicts) finalRows.push(conflict);
        for (const row of merged.resolved) finalRows.push(row);
        const fragments = merged.resolved.map(row => row.promptFragment).filter(Boolean);
        if (fragments.length) {
          const combinedFingerprint = hash(merged.resolved.map(row => row.bindingFingerprint).sort().join(':'));
          shot.objectBindingFingerprint = combinedFingerprint;
          shot.objectBindingIds = merged.resolved.map(row => row.id);
          shot.prompt = `${shot.prompt}\n\n${fragments.join('\n\n')}`.slice(0, 18000);
          shot.fingerprint = hash(`${shot.fingerprint}:${combinedFingerprint}`);
        }
      }
      const bindingIds = scenePlan.shots.flatMap(shot => shot.objectBindingIds || []).sort();
      if (bindingIds.length) {
        scenePlan.objectBindingFingerprint = hash(bindingIds.join(':'));
        scenePlan.fingerprint = hash(`${scenePlan.fingerprint}:${scenePlan.objectBindingFingerprint}`);
        for (const shot of scenePlan.shots) shot.planFingerprint = scenePlan.fingerprint;
      }
    }
    const sceneFingerprints = (shotPlan.scenes || []).map(scene => scene.fingerprint);
    shotPlan.objectBindingVersion = VERSION;
    shotPlan.objectBindingCount = finalRows.filter(row => row.status === 'resolved').length;
    shotPlan.fingerprint = hash(sceneFingerprints.join('\u0000'));

    for (const row of finalRows) {
      const saved = this.db?.savePersistentWorldObjectBinding ? await this.db.savePersistentWorldObjectBinding(row) : row;
      decisions.push({ status: row.status, bindingId: saved?.id || row.id, objectId: row.objectId, sceneId: row.sceneId, shotId: row.shotId, visibility: row.visibility, reason: row.reason || null });
    }

    const summary = {
      resolved: finalRows.filter(row => row.status === 'resolved').length,
      visible: finalRows.filter(row => row.status === 'resolved' && ['visible', 'occluded'].includes(row.visibility)).length,
      nonvisual: finalRows.filter(row => row.status === 'resolved' && ['offscreen', 'mentioned'].includes(row.visibility)).length,
      conflicts: finalRows.filter(row => row.status === 'conflict').length,
      ambiguous: decisions.filter(row => row.status === 'ambiguous').length,
      unresolved: decisions.filter(row => row.status === 'unresolved').length
    };
    this.logger.info(`Persistent World Object Binding v${VERSION}: resolved=${summary.resolved}, visible=${summary.visible}, nonvisual=${summary.nonvisual}, conflicts=${summary.conflicts}, ambiguous=${summary.ambiguous}, unresolved=${summary.unresolved}.`);
    return { version: VERSION, active: true, shotPlan, bindings: finalRows, decisions, summary };
  }
}

module.exports = {
  PERSISTENT_WORLD_OBJECT_BINDING_VERSION: VERSION,
  PersistentWorldObjectBindingV11,
  normalize,
  normalizeVisibility,
  normalizeInteraction,
  declarationFromRaw,
  collectSceneDeclarations,
  objectBindings,
  stateForObject,
  assetForObject,
  shotTargets,
  resolveObjectReference,
  bindingKey,
  bindingFingerprint,
  bindingPromptFragment,
  mergeRowsForShot
};
