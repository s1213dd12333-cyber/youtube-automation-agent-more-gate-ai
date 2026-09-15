'use strict';

const crypto = require('crypto');

const VERSION = '11.11.4';

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

function stableJson(value) { return JSON.stringify(stableObject(value)); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

function unique(values = [], limit = 64) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : [values]) {
    const value = clean(raw, 300);
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
    if (value !== undefined && value !== null && clean(value)) return [clean(value, 300)];
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
  const nested = value.appearanceState && typeof value.appearanceState === 'object' ? value.appearanceState :
    value.wardrobeState && typeof value.wardrobeState === 'object' ? value.wardrobeState :
    value.characterState && typeof value.characterState === 'object' ? value.characterState :
    value.lifecycleState && typeof value.lifecycleState === 'object' ? value.lifecycleState :
    value.state && typeof value.state === 'object' ? value.state : {};
  const keys = [
    'wardrobe','wardrobes','costume','costumes','footwear','hairState','hairStates','condition','conditions','cleanliness',
    'ageAppearance','ageState','injury','injuries','damage','carriedItems','heldItems','temporaryAccessories','tempAccessories',
    'appearanceNotes','appearance','storyState','storyStates','statePersistence','persistence','stateScope',
    'resetState','clearState','clearPreviousState'
  ];
  const inline = {};
  for (const key of keys) if (value[key] !== undefined) inline[key] = value[key];
  return { ...inline, ...nested };
}

function stateDeclaration(raw = {}, context = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const stateRaw = rawStateFor(raw);
  if (!Object.keys(stateRaw).length) return null;
  return {
    sceneId: clean(raw.sceneId || stateRaw.sceneId || context.sceneId || '', 240) || null,
    sourceBibleId: clean(context.sourceBibleId || raw.sourceBibleId || '', 240) || null,
    sourceCharacterId: clean(raw.id || raw.sourceCharacterId || '', 240) || null,
    explicitCharacterKey: clean(raw.characterKey || raw.persistentCharacterKey || raw.canonicalCharacterKey || '', 240) || null,
    displayName: clean(raw.name || raw.displayName || raw.characterName || '', 240) || null,
    speciesType: clean(raw.speciesType || raw.species || raw.type || 'character', 160) || 'character',
    sourceRef: clean(raw.sourceRef || '', 240) || null,
    stateRaw
  };
}

function collectStateDeclarations(cartoonBible = null) {
  if (!cartoonBible || cartoonBible.mode !== 'kids_cartoon_2d') return [];
  const out = [];
  for (const raw of Array.isArray(cartoonBible.characters) ? cartoonBible.characters : []) {
    const declaration = stateDeclaration(raw, { sourceBibleId: cartoonBible.id });
    if (declaration) out.push(declaration);
  }
  for (const field of ['persistentCharacterStates', 'characterAppearanceStates', 'characterStates']) {
    for (const raw of Array.isArray(cartoonBible[field]) ? cartoonBible[field] : []) {
      const declaration = stateDeclaration(raw, { sourceBibleId: cartoonBible.id });
      if (declaration) out.push(declaration);
    }
  }
  return out;
}

function characterBindings(characterPlan = null) {
  return (characterPlan?.characters || []).filter(item => item?.character?.id).map(item => ({
    character: item.character,
    usage: item.usage || null,
    matchMode: item.matchMode || item.usage?.matchMode || null
  }));
}

function bindingForState(declaration = {}, bindings = []) {
  const list = Array.isArray(bindings) ? bindings : [];
  let matches = [];
  if (declaration.explicitCharacterKey) {
    const key = normalize(declaration.explicitCharacterKey).replace(/\s+/g, '_');
    matches = list.filter(item => normalize(item.character?.characterKey).replace(/\s+/g, '_') === key);
  } else if (declaration.sourceCharacterId) {
    matches = list.filter(item => item.usage?.sourceCharacterId === declaration.sourceCharacterId);
  } else if (declaration.sourceRef) {
    matches = list.filter(item => item.usage?.sourceRef === declaration.sourceRef);
  } else {
    matches = list.filter(item => {
      if (declaration.displayName && normalize(item.character?.displayName) !== normalize(declaration.displayName)) return false;
      const incomingSpecies = normalize(declaration.speciesType || 'character');
      const actualSpecies = normalize(item.character?.speciesType || 'character');
      return !incomingSpecies || incomingSpecies === 'character' || incomingSpecies === actualSpecies;
    });
  }
  if (matches.length === 1) return { status: 'resolved', binding: matches[0], candidates: matches };
  if (matches.length > 1) return { status: 'ambiguous', binding: null, candidates: matches };
  return { status: 'unresolved', binding: null, candidates: [] };
}

function normalizeState(raw = {}) {
  const conflicts = [];
  const reset = raw.resetState === true || raw.clearState === true || raw.clearPreviousState === true;
  const wardrobe = reset ? null : singleDimension(raw, ['wardrobe','wardrobes','costume','costumes'], 'wardrobe', conflicts);
  const footwear = reset ? null : singleDimension(raw, ['footwear'], 'footwear', conflicts);
  const hairState = reset ? null : singleDimension(raw, ['hairState','hairStates'], 'hair_state', conflicts);
  const condition = reset ? null : singleDimension(raw, ['condition','conditions'], 'condition', conflicts);
  const cleanliness = reset ? null : singleDimension(raw, ['cleanliness'], 'cleanliness', conflicts);
  const ageAppearance = reset ? null : singleDimension(raw, ['ageAppearance','ageState'], 'age_appearance', conflicts);
  const injuries = reset ? [] : unique(valuesFor(raw, ['injury','injuries','damage']));
  const carriedItems = reset ? [] : unique(valuesFor(raw, ['carriedItems','heldItems']));
  const temporaryAccessories = reset ? [] : unique(valuesFor(raw, ['temporaryAccessories','tempAccessories']));
  const appearanceNotes = reset ? [] : unique(valuesFor(raw, ['appearanceNotes','appearance']));
  const storyState = reset ? [] : unique(valuesFor(raw, ['storyState','storyStates']));
  const persistence = normalizePersistence(raw.statePersistence || raw.persistence || raw.stateScope || 'scene');
  const state = { wardrobe, footwear, hairState, condition, cleanliness, ageAppearance, injuries, carriedItems, temporaryAccessories, appearanceNotes, storyState };
  const active = Object.values(state).some(value => Array.isArray(value) ? value.length > 0 : Boolean(value));
  return { state, persistence, conflicts, reset, status: conflicts.length ? 'conflict' : active ? 'active' : 'neutral' };
}

function stateFingerprint(characterId, normalized = {}) {
  return hash(stableJson({ characterId, state: normalized.state || {}, persistence: normalized.persistence || 'scene', status: normalized.status || 'neutral' }));
}

function statePromptFragment(row = {}) {
  if (!row?.characterId) return '';
  const details = [
    row.wardrobe && `wardrobe=${row.wardrobe}`,
    row.footwear && `footwear=${row.footwear}`,
    row.hairState && `hair=${row.hairState}`,
    row.condition && `condition=${row.condition}`,
    row.cleanliness && `cleanliness=${row.cleanliness}`,
    row.ageAppearance && `age_appearance=${row.ageAppearance}`,
    row.injuries?.length && `injuries=${row.injuries.join(', ')}`,
    row.carriedItems?.length && `carried_items=${row.carriedItems.join(', ')}`,
    row.temporaryAccessories?.length && `temporary_accessories=${row.temporaryAccessories.join(', ')}`,
    row.appearanceNotes?.length && `appearance_notes=${row.appearanceNotes.join(', ')}`,
    row.storyState?.length && `story_state=${row.storyState.join(', ')}`
  ].filter(Boolean);
  return [
    `PERSISTENT CHARACTER APPEARANCE STATE V${VERSION}:`,
    `CHARACTER ID: ${row.characterId}`,
    `STATE STATUS: ${row.status || 'neutral'}; PERSISTENCE: ${row.persistence || 'scene'}`,
    details.length ? details.join('; ') : 'neutral / no active appearance state dimensions',
    row.inherited ? `INHERITED FROM STATE: ${row.parentStateId || 'prior durable state'}` : '',
    'Apply this only as a wardrobe/appearance overlay. Never rewrite characterId, canonical identity fingerprint, species/type, canonical palette/proportions/face/silhouette, or the 11.11.3 canonical character asset.',
    'The canonical Character Bible outfit/accessories remain the base design. Episodic costume/accessory changes belong here and must not mutate that base identity.',
    'Scene state expires unless persistence=until_changed. Durable state remains until a later durable state or explicit reset replaces it.'
  ].filter(Boolean).join('\n').slice(0, 12000);
}

class PersistentCharacterAppearanceStateLayerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_CHARACTER_APPEARANCE_STATES_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.inheritDurable = String(options.inheritDurable ?? process.env.PERSISTENT_CHARACTER_APPEARANCE_STATE_INHERIT_DURABLE ?? 'true').toLowerCase() !== 'false';
  }

  async persistState(production = {}, binding = {}, declaration = null, normalized = null, options = {}) {
    const character = binding.character;
    const sceneId = declaration?.sceneId || null;
    const scopeKey = sceneId || declaration?.sourceBibleId || binding.usage?.sourceBibleId || 'production';
    const id = `persistent_character_state_${hash(`${production.id}:${character.id}:${scopeKey}`).slice(0, 20)}`;
    const state = normalized?.state || {};
    const row = {
      id,
      characterId: character.id,
      productionId: production.id,
      sceneId,
      scopeKey,
      version: VERSION,
      status: normalized?.status || 'neutral',
      persistence: normalized?.persistence || 'scene',
      stateFingerprint: stateFingerprint(character.id, normalized || {}),
      wardrobe: state.wardrobe || null,
      footwear: state.footwear || null,
      hairState: state.hairState || null,
      condition: state.condition || null,
      cleanliness: state.cleanliness || null,
      ageAppearance: state.ageAppearance || null,
      injuries: state.injuries || [],
      carriedItems: state.carriedItems || [],
      temporaryAccessories: state.temporaryAccessories || [],
      appearanceNotes: state.appearanceNotes || [],
      storyState: state.storyState || [],
      conflicts: normalized?.conflicts || [],
      sourceKind: options.sourceKind || 'explicit_character_appearance_state',
      sourceRef: declaration?.sourceRef || declaration?.sourceCharacterId || null,
      parentStateId: options.parentStateId || null,
      inherited: options.inherited === true,
      canonicalIdentityFingerprint: character.identityFingerprint || null
    };
    return this.db?.savePersistentCharacterAppearanceState ? await this.db.savePersistentCharacterAppearanceState(row) : row;
  }

  async ensureProductionStates(production = {}, cartoonBible = null, characterPlan = null) {
    if (!this.enabled || !production?.id) {
      return { version: VERSION, active: this.enabled, states: [], decisions: [], summary: { active: 0, neutral: 0, inherited: 0, conflicts: 0, ambiguous: 0, unresolved: 0 } };
    }
    const bindings = characterBindings(characterPlan);
    const declarations = collectStateDeclarations(cartoonBible);
    const states = [];
    const decisions = [];
    const explicitlyHandled = new Set();

    for (const declaration of declarations) {
      const resolved = bindingForState(declaration, bindings);
      if (resolved.status !== 'resolved') {
        decisions.push({ status: resolved.status, declaration, reason: resolved.status === 'ambiguous' ? 'appearance_state_matches_multiple_characters' : 'appearance_state_character_not_found' });
        continue;
      }
      const binding = resolved.binding;
      const normalized = normalizeState(declaration.stateRaw || {});
      const row = await this.persistState(production, binding, declaration, normalized, { sourceKind: 'explicit_character_appearance_state' });
      states.push(row);
      explicitlyHandled.add(binding.character.id);
      decisions.push({ status: row.status, characterId: binding.character.id, stateId: row.id, persistence: row.persistence, conflicts: row.conflicts || [] });
    }

    if (this.inheritDurable && this.db?.getLatestDurablePersistentCharacterAppearanceState) {
      for (const binding of bindings) {
        const characterId = binding.character.id;
        if (explicitlyHandled.has(characterId)) continue;
        const previous = await this.db.getLatestDurablePersistentCharacterAppearanceState(characterId, production.id);
        if (!previous || previous.persistence !== 'until_changed') continue;
        const normalized = {
          status: previous.status || 'neutral',
          persistence: 'until_changed',
          conflicts: [],
          state: {
            wardrobe: previous.wardrobe || null,
            footwear: previous.footwear || null,
            hairState: previous.hairState || null,
            condition: previous.condition || null,
            cleanliness: previous.cleanliness || null,
            ageAppearance: previous.ageAppearance || null,
            injuries: previous.injuries || [],
            carriedItems: previous.carriedItems || [],
            temporaryAccessories: previous.temporaryAccessories || [],
            appearanceNotes: previous.appearanceNotes || [],
            storyState: previous.storyState || []
          }
        };
        const row = await this.persistState(production, binding, null, normalized, {
          sourceKind: 'inherited_durable_character_appearance_state',
          parentStateId: previous.id,
          inherited: true
        });
        states.push(row);
        decisions.push({ status: 'inherited', characterId, stateId: row.id, parentStateId: previous.id, persistence: 'until_changed' });
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
    this.logger.info(`Persistent Character Appearance State v${VERSION}: active=${summary.active}, neutral=${summary.neutral}, inherited=${summary.inherited}, conflicts=${summary.conflicts}, ambiguous=${summary.ambiguous}.`);
    return { version: VERSION, active: true, states, decisions, summary };
  }
}

module.exports = {
  PERSISTENT_CHARACTER_APPEARANCE_STATE_VERSION: VERSION,
  PersistentCharacterAppearanceStateLayerV11,
  normalize,
  normalizePersistence,
  rawStateFor,
  stateDeclaration,
  collectStateDeclarations,
  characterBindings,
  bindingForState,
  normalizeState,
  stateFingerprint,
  statePromptFragment
};
