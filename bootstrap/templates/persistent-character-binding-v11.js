'use strict';

const crypto = require('crypto');

const VERSION = '11.11.5';
const VISIBILITY = new Set(['visible', 'occluded', 'offscreen', 'mentioned']);

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stableObject(value[key]); return out; }, {});
}
function stableJson(value) { return JSON.stringify(stableObject(value)); }
function uniqueNumbers(values = []) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(values) ? values : [values]) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || seen.has(n)) continue;
    seen.add(n); out.push(n);
  }
  return out.sort((a,b)=>a-b);
}
function normalizeVisibility(value, fallback = 'visible') {
  const key = normalize(value).replace(/\s+/g, '_');
  if (['hidden','not_visible','notvisible','out_of_frame'].includes(key)) return 'offscreen';
  if (['partial','partially_visible','partially_occluded'].includes(key)) return 'occluded';
  if (['reference_only','mention','mentioned_only'].includes(key)) return 'mentioned';
  return VISIBILITY.has(key) ? key : fallback;
}
function declarationFromRaw(raw = {}, context = {}) {
  if (typeof raw === 'string') raw = { reference: raw };
  if (!raw || typeof raw !== 'object') return null;
  const characterId = clean(raw.characterId || raw.persistentCharacterId || '', 240) || null;
  const characterKey = clean(raw.characterKey || raw.persistentCharacterKey || raw.canonicalCharacterKey || '', 240) || null;
  const sourceCharacterId = clean(raw.sourceCharacterId || raw.bibleCharacterId || '', 240) || null;
  const reference = clean(raw.reference || raw.character || raw.name || raw.displayName || characterKey || sourceCharacterId || characterId || '', 240) || null;
  if (!reference && !characterId && !characterKey && !sourceCharacterId) return null;
  return {
    sceneId: clean(context.sceneId || raw.sceneId || '', 240) || null,
    scenePosition: Number.isInteger(Number(raw.scenePosition)) ? Number(raw.scenePosition) : context.scenePosition ?? null,
    characterId, characterKey, sourceCharacterId, reference,
    shotIndexes: uniqueNumbers(raw.shotIndexes ?? raw.shots ?? (raw.shotIndex == null ? [] : [raw.shotIndex])),
    visibility: normalizeVisibility(raw.visibility || raw.presence || (raw.visible === false ? 'offscreen' : 'visible')),
    placement: clean(raw.placement || raw.position || raw.locationInFrame || '', 500) || null,
    action: clean(raw.action || raw.activity || raw.interaction || '', 800) || null,
    expression: clean(raw.expression || '', 500) || null,
    required: raw.required !== false,
    sourceKind: clean(context.sourceKind || raw.sourceKind || 'scene_character_binding', 240),
    sourceRef: clean(raw.id || raw.sourceRef || '', 240) || null
  };
}
function collectExplicitDeclarations(scenes = []) {
  const out = [];
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    for (const [field, values] of [
      ['characterBindings', scene.characterBindings],
      ['persistentCharacterBindings', scene.persistentCharacterBindings],
      ['shotCharacterBindings', scene.shotCharacterBindings]
    ]) {
      for (const raw of Array.isArray(values) ? values : []) {
        const d = declarationFromRaw(raw, { sceneId: scene.id, scenePosition: Number(scene.position || 0), sourceKind: `scene_${field}` });
        if (d) out.push(d);
      }
    }
  }
  return out;
}
function collectShotPlannerDeclarations(shotPlan = null) {
  const out = [];
  for (const scene of shotPlan?.scenes || []) {
    for (const shot of scene.shots || []) {
      for (const sourceCharacterId of Array.isArray(shot.characters) ? shot.characters : []) {
        const d = declarationFromRaw({ sourceCharacterId, reference: sourceCharacterId, shotIndex: shot.shotIndex, visibility: 'visible', action: shot.action, expression: shot.expression }, {
          sceneId: scene.sceneId, scenePosition: scene.scenePosition, sourceKind: 'shot_planner_character'
        });
        if (d) out.push(d);
      }
      for (const raw of Array.isArray(shot.characterBindings) ? shot.characterBindings : []) {
        const d = declarationFromRaw({ ...raw, shotIndex: raw.shotIndex ?? shot.shotIndex }, {
          sceneId: scene.sceneId, scenePosition: scene.scenePosition, sourceKind: 'shot_characterBindings'
        });
        if (d) out.push(d);
      }
    }
  }
  return out;
}
function characterBindings(characterPlan = null) {
  return (characterPlan?.characters || []).filter(item => item?.character?.id).map(item => ({
    character: item.character, usage: item.usage || null, matchMode: item.matchMode || item.usage?.matchMode || null
  }));
}
function stateForCharacter(statePlan = null, characterId, sceneId = null) {
  const rows = (statePlan?.states || []).filter(row => row?.characterId === characterId);
  if (!rows.length) return null;
  if (sceneId) {
    const exact = rows.find(row => row.sceneId === sceneId);
    if (exact) return exact;
  }
  return rows.find(row => !row.sceneId) || rows[0];
}
function assetForCharacter(assetPlan = null, characterId) {
  return (assetPlan?.assets || []).find(asset => asset?.characterId === characterId && asset.canonical !== false && asset.status === 'ready') || null;
}
function shotTargets(declaration = {}, shotPlan = null) {
  const scenes = shotPlan?.scenes || [];
  let scenePlan = null;
  if (declaration.sceneId) scenePlan = scenes.find(item => item.sceneId === declaration.sceneId) || null;
  if (!scenePlan && declaration.scenePosition != null) scenePlan = scenes.find(item => Number(item.scenePosition) === Number(declaration.scenePosition)) || null;
  if (!scenePlan) return { status: 'unresolved', scenePlan: null, shots: [], reason: 'scene_not_found' };
  const shots = declaration.shotIndexes.length ? scenePlan.shots.filter(shot => declaration.shotIndexes.includes(Number(shot.shotIndex))) : [...scenePlan.shots];
  if (declaration.shotIndexes.length && shots.length !== declaration.shotIndexes.length) return { status: 'unresolved', scenePlan, shots, reason: 'shot_index_not_found' };
  return { status: 'resolved', scenePlan, shots, reason: null };
}
async function resolveCharacterReference(db, declaration = {}, bindings = []) {
  const list = Array.isArray(bindings) ? bindings : [];
  if (declaration.characterId) {
    const exact = list.filter(item => item.character?.id === declaration.characterId);
    if (exact.length === 1) return { status:'resolved', binding:exact[0], candidates:exact, matchMode:'character_id_exact', confidence:1 };
    return { status: exact.length > 1 ? 'ambiguous':'unresolved', binding:null, candidates:exact, matchMode: exact.length>1?'character_id_ambiguous':null, confidence:0 };
  }
  if (declaration.characterKey) {
    const key = normalize(declaration.characterKey).replace(/\s+/g,'_');
    const exact = list.filter(item => normalize(item.character?.characterKey).replace(/\s+/g,'_') === key);
    if (exact.length === 1) return { status:'resolved', binding:exact[0], candidates:exact, matchMode:'character_key_exact', confidence:1 };
    if (exact.length > 1) return { status:'ambiguous', binding:null, candidates:exact, matchMode:'character_key_ambiguous', confidence:0 };
  }
  if (declaration.sourceCharacterId) {
    const exact = list.filter(item => item.usage?.sourceCharacterId === declaration.sourceCharacterId);
    if (exact.length === 1) return { status:'resolved', binding:exact[0], candidates:exact, matchMode:'source_character_id_exact', confidence:1 };
    if (exact.length > 1) return { status:'ambiguous', binding:null, candidates:exact, matchMode:'source_character_id_ambiguous', confidence:0 };
  }
  const referenceKey = normalize(declaration.reference);
  if (!referenceKey) return { status:'unresolved', binding:null, candidates:[], matchMode:null, confidence:0 };
  if (db?.listPersistentCharacterAliasesByKey) {
    const namespace = list[0]?.character?.namespace || 'default';
    const aliases = await db.listPersistentCharacterAliasesByKey(namespace, referenceKey);
    const allowed = new Set(list.map(item => item.character.id));
    const ids = [...new Set((aliases || []).map(row => row.characterId || row.character?.id).filter(id => allowed.has(id)))];
    const matches = list.filter(item => ids.includes(item.character.id));
    if (matches.length === 1) return { status:'resolved', binding:matches[0], candidates:matches, matchMode:'character_alias_exact', confidence:0.99 };
    if (matches.length > 1) return { status:'ambiguous', binding:null, candidates:matches, matchMode:'character_alias_ambiguous', confidence:0 };
  }
  const named = list.filter(item => normalize(item.character?.displayName) === referenceKey || normalize(String(item.character?.characterKey || '').replace(/[_-]+/g,' ')) === referenceKey);
  if (named.length === 1) return { status:'resolved', binding:named[0], candidates:named, matchMode:'character_name_exact', confidence:0.97 };
  if (named.length > 1) return { status:'ambiguous', binding:null, candidates:named, matchMode:'character_name_ambiguous', confidence:0 };
  return { status:'unresolved', binding:null, candidates:[], matchMode:null, confidence:0 };
}
function bindingKey(productionId, sceneId, shotId, referenceKey) {
  return `persistent_character_binding_${hash(`${productionId}:${sceneId}:${shotId}:${referenceKey}`).slice(0,22)}`;
}
function bindingFingerprint(row = {}) {
  return hash(stableJson({
    characterId: row.characterId || null, sceneId: row.sceneId || null, shotId: row.shotId || null,
    visibility: row.visibility || null, placement: row.placement || null, action: row.action || null, expression: row.expression || null,
    stateFingerprint: row.stateFingerprint || null, canonicalAssetSha256: row.canonicalAssetSha256 || null
  }));
}
function bindingPromptFragment(row = {}) {
  if (row.status !== 'resolved' || !row.characterId) return '';
  const visual = row.visibility === 'visible' || row.visibility === 'occluded';
  return [
    `PERSISTENT CHARACTER BINDING V${VERSION}:`,
    `CHARACTER ID: ${row.characterId}`,
    `CHARACTER KEY: ${row.characterKey || 'unknown'}`,
    `VISIBILITY: ${row.visibility}`,
    row.placement ? `PLACEMENT: ${row.placement}` : '',
    row.action ? `ACTION: ${row.action}` : '',
    row.expression ? `EXPRESSION: ${row.expression}` : '',
    row.canonicalAssetId ? `CANONICAL CHARACTER ASSET: ${row.canonicalAssetId} · sha256 ${row.canonicalAssetSha256 || 'unknown'}` : '',
    row.stateId ? `APPEARANCE STATE: ${row.stateId} · ${row.stateFingerprint || 'no fingerprint'}` : '',
    visual
      ? 'Render this exact persistent character identity in the frame. Preserve the canonical face, silhouette, proportions and palette; apply 11.11.4 wardrobe/appearance state only as an overlay.'
      : 'Do NOT render this character in the frame. The character is offscreen/mentioned only; do not hallucinate them into view.',
    'Do not replace this character with a merely similar same-species character, and do not create a duplicate unless another distinct characterId is explicitly bound.'
  ].filter(Boolean).join('\n').slice(0, 12000);
}
function mergeRowsForShot(rows = []) {
  const grouped = new Map();
  const conflicts = [];
  for (const row of rows) {
    if (row.status !== 'resolved' || !row.characterId) continue;
    if (!grouped.has(row.characterId)) grouped.set(row.characterId, []);
    grouped.get(row.characterId).push(row);
  }
  const resolved = [];
  for (const [characterId, group] of grouped) {
    const explicit = group.filter(row => row.sourceKind !== 'shot_planner_character');
    const candidates = explicit.length ? explicit : group;
    const first = candidates[0];
    const contradictory = candidates.slice(1).some(row => ['visibility','placement','action','expression'].some(field => first[field] && row[field] && first[field] !== row[field]));
    if (contradictory) {
      conflicts.push({ ...first, status:'conflict', reason:'contradictory_bindings_for_same_character_and_shot' });
      continue;
    }
    resolved.push(first);
  }
  return { resolved, conflicts };
}

class PersistentCharacterBindingV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info(){}, warn(){}, error(){} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_CHARACTER_BINDINGS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.useShotPlannerCast = String(options.useShotPlannerCast ?? process.env.PERSISTENT_CHARACTER_BINDINGS_USE_SHOT_PLANNER_CAST ?? 'true').toLowerCase() !== 'false';
  }

  async bindShotPlan(input = {}) {
    const { production = {}, scenes = [], shotPlan = null, characterPlan = null, statePlan = null, assetPlan = null } = input;
    if (!this.enabled || !production?.id || !shotPlan) {
      return { version:VERSION, active:this.enabled, shotPlan, bindings:[], decisions:[], summary:{resolved:0,visible:0,nonvisual:0,conflicts:0,ambiguous:0,unresolved:0} };
    }
    const declarations = [
      ...collectExplicitDeclarations(scenes),
      ...(this.useShotPlannerCast ? collectShotPlannerDeclarations(shotPlan) : [])
    ];
    const characters = characterBindings(characterPlan);
    const rows = [], decisions = [];

    for (const declaration of declarations) {
      const targets = shotTargets(declaration, shotPlan);
      if (targets.status !== 'resolved') {
        decisions.push({ status:'unresolved', declaration, reason:targets.reason });
        continue;
      }
      const resolved = await resolveCharacterReference(this.db, declaration, characters);
      if (resolved.status !== 'resolved') {
        decisions.push({
          status:resolved.status, declaration,
          reason: resolved.status === 'ambiguous' ? 'character_reference_ambiguous' : 'character_reference_not_found',
          candidateCharacterIds: resolved.candidates.map(item => item.character.id)
        });
        continue;
      }
      const character = resolved.binding.character;
      const state = stateForCharacter(statePlan, character.id, declaration.sceneId || targets.scenePlan.sceneId);
      const asset = assetForCharacter(assetPlan, character.id);
      for (const shot of targets.shots) {
        const referenceKey = normalize(declaration.reference || declaration.characterKey || declaration.sourceCharacterId || declaration.characterId || character.characterKey || character.id);
        const row = {
          id: bindingKey(production.id, targets.scenePlan.sceneId, shot.id, `${referenceKey}:${declaration.sourceRef || declaration.sourceKind}`),
          productionId:production.id, sceneId:targets.scenePlan.sceneId, shotId:shot.id, shotIndex:Number(shot.shotIndex || 0),
          characterId:character.id, characterKey:character.characterKey || null, version:VERSION, status:'resolved',
          referenceText:declaration.reference || character.displayName || character.characterKey || character.id, referenceKey,
          matchMode:resolved.matchMode, confidence:resolved.confidence, visibility:declaration.visibility,
          placement:declaration.placement, action:declaration.action, expression:declaration.expression, required:declaration.required,
          stateId:state?.id || null, stateFingerprint:state?.stateFingerprint || null,
          canonicalAssetId:asset?.id || null, canonicalAssetSha256:asset?.assetSha256 || null,
          sourceKind:declaration.sourceKind, sourceRef:declaration.sourceRef, reason:null
        };
        row.bindingFingerprint = bindingFingerprint(row);
        row.promptFragment = bindingPromptFragment(row);
        rows.push(row);
      }
    }

    const byShot = new Map();
    for (const row of rows) {
      if (!byShot.has(row.shotId)) byShot.set(row.shotId, []);
      byShot.get(row.shotId).push(row);
    }

    const persisted = [];
    const conflictRows = [];
    for (const scenePlan of shotPlan.scenes || []) {
      const shotFingerprints = [];
      for (const shot of scenePlan.shots || []) {
        const merged = mergeRowsForShot(byShot.get(shot.id) || []);
        conflictRows.push(...merged.conflicts);
        for (const row of merged.resolved) {
          const saved = this.db?.savePersistentCharacterBinding ? await this.db.savePersistentCharacterBinding(row) : row;
          persisted.push(saved || row);
        }
        const fragments = merged.resolved.map(bindingPromptFragment).filter(Boolean);
        if (fragments.length) shot.prompt = `${shot.prompt || ''}\n\n${fragments.join('\n\n')}`.trim();
        const bindingFingerprints = merged.resolved.map(row => row.bindingFingerprint).sort();
        if (bindingFingerprints.length || merged.conflicts.length) {
          shot.characterBindingFingerprints = bindingFingerprints;
          shot.characterBindingVersion = VERSION;
          shot.fingerprint = hash(stableJson({
            baseFingerprint: shot.fingerprint || null,
            characterBindingVersion: VERSION,
            bindingFingerprints,
            conflicts: merged.conflicts.map(row => row.characterId).sort()
          }));
        }
        shotFingerprints.push(shot.fingerprint || '');
      }
      if (shotFingerprints.length) {
        scenePlan.fingerprint = hash(stableJson({ baseFingerprint:scenePlan.fingerprint || null, characterBindingVersion:VERSION, shots:shotFingerprints }));
        for (const shot of scenePlan.shots || []) shot.planFingerprint = scenePlan.fingerprint;
      }
    }
    shotPlan.fingerprint = hash(stableJson({ baseFingerprint:shotPlan.fingerprint || null, characterBindingVersion:VERSION, scenes:(shotPlan.scenes || []).map(scene => scene.fingerprint) }));
    shotPlan.characterBindingVersion = VERSION;
    shotPlan.shots = (shotPlan.scenes || []).flatMap(scene => scene.shots || []);

    const summary = {
      resolved:persisted.length,
      visible:persisted.filter(row => ['visible','occluded'].includes(row.visibility)).length,
      nonvisual:persisted.filter(row => ['offscreen','mentioned'].includes(row.visibility)).length,
      conflicts:conflictRows.length,
      ambiguous:decisions.filter(row => row.status === 'ambiguous').length,
      unresolved:decisions.filter(row => row.status === 'unresolved').length
    };
    this.logger.info(`Persistent Character Binding v${VERSION}: resolved=${summary.resolved}, visible=${summary.visible}, nonvisual=${summary.nonvisual}, conflicts=${summary.conflicts}, ambiguous=${summary.ambiguous}, unresolved=${summary.unresolved}.`);
    return { version:VERSION, active:true, shotPlan, bindings:persisted, decisions, conflicts:conflictRows, summary };
  }
}

module.exports = {
  PERSISTENT_CHARACTER_BINDING_VERSION: VERSION,
  PersistentCharacterBindingV11,
  normalizeVisibility,
  declarationFromRaw,
  collectExplicitDeclarations,
  collectShotPlannerDeclarations,
  characterBindings,
  stateForCharacter,
  assetForCharacter,
  shotTargets,
  resolveCharacterReference,
  bindingFingerprint,
  bindingPromptFragment,
  mergeRowsForShot
};
