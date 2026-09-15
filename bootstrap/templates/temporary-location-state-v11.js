'use strict';

const crypto = require('crypto');

const VERSION = '11.9.5';

function clean(value, limit = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 12000)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableObject(value[key]);
    return out;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => clean(value, 240)).filter(Boolean))].sort();
}

function sceneText(scene = {}) {
  return clean([
    scene.label,
    scene.scriptText,
    scene.prompt,
    scene.narration,
    scene.visualBrief?.subject,
    scene.visualBrief?.setting,
    scene.visualBrief?.composition,
    scene.visualBrief?.lighting,
    scene.visualBrief?.requiredElements?.join?.(' '),
    scene.visualBrief?.notes
  ].filter(Boolean).join(' '), 24000);
}

const TIME_RULES = [
  ['dawn', /\b(dawn|sunrise|amanhecer|alvorecer)\b/],
  ['morning', /\b(morning|manha)\b/],
  ['midday', /\b(midday|noon|meio dia)\b/],
  ['afternoon', /\b(afternoon|tarde)\b/],
  ['evening', /\b(evening|sunset|entardecer|por do sol)\b/],
  ['night', /\b(night|nighttime|noite|noturno|noturna)\b/],
  ['midnight', /\b(midnight|meia noite)\b/]
];

const WEATHER_RULES = [
  ['storm', /\b(storm|stormy|thunderstorm|rainstorm|tempestade|trovoada)\b/],
  ['rain', /\b(rain|raining|rainy|chuva|chovendo|chuvoso|chuvosa)\b/],
  ['snow', /\b(snow|snowing|snowy|neve|nevando)\b/],
  ['fog', /\b(fog|foggy|mist|misty|neblina|nevoeiro)\b/],
  ['cloudy', /\b(cloudy|overcast|nublado|nublada)\b/],
  ['clear', /\b(sunny|clear sky|ensolarado|ensolarada|ceu limpo)\b/],
  ['windy', /\b(windy|strong wind|ventania|ventoso|ventosa)\b/]
];

const LIGHTING_RULES = [
  ['lights_off', /\b(lights? off|lights? are off|dark room|luzes? apagadas?|luz apagada)\b/],
  ['lights_on', /\b(lights? on|lights? are on|luzes? acesas?|luz acesa)\b/],
  ['dim', /\b(dim light|dimly lit|low light|luz baixa|pouca luz|luz fraca)\b/],
  ['candlelight', /\b(candlelight|candle lit|velas acesas|luz de velas)\b/],
  ['fireplace_glow', /\b(fireplace glow|firelight|lareira acesa|luz da lareira)\b/],
  ['neon', /\b(neon light|neon glow|luz neon)\b/],
  ['tv_glow', /\b(tv glow|television glow|screen glow|luz da tv|brilho da tv)\b/],
  ['moonlight', /\b(moonlight|moon lit|luz da lua|luar)\b/]
];

const TEMP_PROP_RULES = [
  ['christmas_tree', /\b(christmas tree|arvore de natal)\b/],
  ['christmas_decorations', /\b(christmas decorations|holiday decorations|decoracao de natal|enfeites de natal)\b/],
  ['halloween_decorations', /\b(halloween decorations|decoracao de halloween|enfeites de halloween)\b/],
  ['birthday_decorations', /\b(birthday decorations|decoracao de aniversario|enfeites de aniversario)\b/],
  ['balloons', /\b(balloons|baloes)\b/],
  ['moving_boxes', /\b(moving boxes|cardboard boxes|caixas de mudanca|caixas de papelao)\b/],
  ['candles', /\b(candles|velas)\b/],
  ['scattered_toys', /\b(scattered toys|toys scattered|brinquedos espalhados)\b/],
  ['dirty_dishes', /\b(dirty dishes|unwashed dishes|louca suja|pratos sujos)\b/]
];

const CHANGE_RULES = [
  ['door_open', /\b(open door|door is open|door stands open|porta aberta)\b/],
  ['door_closed', /\b(closed door|door is closed|porta fechada)\b/],
  ['window_open', /\b(open window|window is open|janela aberta)\b/],
  ['window_closed', /\b(closed window|window is closed|janela fechada)\b/],
  ['messy', /\b(messy|cluttered|untidy|baguncado|baguncada|desorganizado|desorganizada)\b/],
  ['cleaned', /\b(freshly cleaned|spotless|tidied up|limpo recentemente|arrumado|arrumada)\b/],
  ['under_renovation', /\b(under renovation|being renovated|em reforma|sendo reformado|sendo reformada)\b/]
];

function matchesFor(text, rules) {
  return rules.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
}

function singleDimension(text, rules, options = {}) {
  let matches = unique(matchesFor(text, rules));
  if (options.weather && matches.includes('storm') && matches.includes('rain')) matches = matches.filter(item => item !== 'rain');
  if (!matches.length) return { value: null, conflicts: [] };
  if (matches.length === 1) return { value: matches[0], conflicts: [] };
  return { value: null, conflicts: [`${options.name || 'dimension'}_ambiguous:${matches.join('|')}`] };
}

function removeOpposing(values, a, b, conflict, conflicts) {
  if (!values.includes(a) || !values.includes(b)) return values;
  conflicts.push(conflict);
  return values.filter(value => value !== a && value !== b);
}

function explicitState(scene = {}) {
  const explicit = scene.temporaryState || scene.locationState || scene.visualBrief?.temporaryState || {};
  const timeOfDay = clean(explicit.timeOfDay || explicit.time || '', 80) || null;
  const weather = clean(explicit.weather || '', 80) || null;
  const lightingStates = unique([
    ...(Array.isArray(explicit.lightingStates) ? explicit.lightingStates : []),
    ...(Array.isArray(explicit.lighting) ? explicit.lighting : []),
    ...(typeof explicit.lighting === 'string' ? [explicit.lighting] : [])
  ]);
  const temporaryProps = unique([
    ...(Array.isArray(explicit.temporaryProps) ? explicit.temporaryProps : []),
    ...(Array.isArray(scene.temporaryProps) ? scene.temporaryProps : []),
    ...(Array.isArray(scene.visualBrief?.temporaryProps) ? scene.visualBrief.temporaryProps : [])
  ]);
  const temporaryChanges = unique([
    ...(Array.isArray(explicit.temporaryChanges) ? explicit.temporaryChanges : []),
    ...(Array.isArray(scene.temporaryChanges) ? scene.temporaryChanges : []),
    ...(Array.isArray(scene.visualBrief?.temporaryChanges) ? scene.visualBrief.temporaryChanges : [])
  ]);
  return { timeOfDay, weather, lightingStates, temporaryProps, temporaryChanges };
}

function extractTemporaryState(scene = {}) {
  const text = normalize(sceneText(scene));
  const explicit = explicitState(scene);
  const conflicts = [];
  const time = singleDimension(text, TIME_RULES, { name: 'time_of_day' });
  const weather = singleDimension(text, WEATHER_RULES, { name: 'weather', weather: true });
  conflicts.push(...time.conflicts, ...weather.conflicts);

  let lightingStates = unique([...matchesFor(text, LIGHTING_RULES), ...explicit.lightingStates]);
  lightingStates = removeOpposing(lightingStates, 'lights_on', 'lights_off', 'lighting_conflict:lights_on|lights_off', conflicts);

  let temporaryChanges = unique([...matchesFor(text, CHANGE_RULES), ...explicit.temporaryChanges]);
  temporaryChanges = removeOpposing(temporaryChanges, 'door_open', 'door_closed', 'change_conflict:door_open|door_closed', conflicts);
  temporaryChanges = removeOpposing(temporaryChanges, 'window_open', 'window_closed', 'change_conflict:window_open|window_closed', conflicts);
  temporaryChanges = removeOpposing(temporaryChanges, 'messy', 'cleaned', 'change_conflict:messy|cleaned', conflicts);

  const temporaryProps = unique([...matchesFor(text, TEMP_PROP_RULES), ...explicit.temporaryProps]);
  const state = {
    timeOfDay: explicit.timeOfDay || time.value,
    weather: explicit.weather || weather.value,
    lightingStates,
    temporaryProps,
    temporaryChanges
  };
  const explicitUsed = Boolean(explicit.timeOfDay || explicit.weather || explicit.lightingStates.length || explicit.temporaryProps.length || explicit.temporaryChanges.length);
  const textUsed = Boolean(time.value || weather.value || lightingStates.length || temporaryProps.length || temporaryChanges.length || conflicts.length);
  const active = Boolean(state.timeOfDay || state.weather || lightingStates.length || temporaryProps.length || temporaryChanges.length);
  return {
    state,
    active,
    conflicts: unique(conflicts),
    sourceKind: explicitUsed && textUsed ? 'scene_metadata+scene_text' : explicitUsed ? 'scene_metadata' : textUsed ? 'scene_text' : 'none',
    confidence: conflicts.length ? 0.5 : explicitUsed ? 1 : textUsed ? 0.9 : 0.5
  };
}

function statePromptFragment(layer = null) {
  if (!layer || !layer.locationId) return '';
  const active = layer.status === 'active';
  const lines = [
    `TEMPORARY LOCATION STATE V${VERSION}:`,
    `STATE ID: ${layer.id || 'pending'}`,
    `LOCATION ID: ${layer.locationId}`,
    `ZONE ID: ${layer.zoneId || 'whole_location'}`,
    `STATUS: ${layer.status || (active ? 'active' : 'neutral')}`,
    `TIME OF DAY: ${layer.timeOfDay || 'not specified'}`,
    `WEATHER: ${layer.weather || 'not specified'}`,
    `LIGHTING OVERRIDES: ${(layer.lightingStates || []).join(', ') || 'none'}`,
    `TEMPORARY PROPS: ${(layer.temporaryProps || []).join(', ') || 'none'}`,
    `TEMPORARY CHANGES: ${(layer.temporaryChanges || []).join(', ') || 'none'}`,
    (layer.conflicts || []).length ? `OMITTED CONFLICTS: ${(layer.conflicts || []).join(' | ')}` : '',
    '',
    'TEMPORARY STATE RULES:',
    '- overlay this state on the canonical location/zone; it must never redefine the canonical location identity;',
    '- do not promote temporary props, decorations, weather, time, lighting, open/closed states, or clutter into permanent Prop Locks, layout, architecture, or canonical fingerprints;',
    '- preserve all canonical geometry, furniture identity, materials and zone identity while applying only the temporary differences listed above;',
    '- do not carry temporary state into another scene unless that later scene explicitly states it again or a future continuity layer proves persistence;',
    active ? '- render the listed temporary state visibly when composition permits.' : '- no temporary state is specified for this scene; do not invent one.'
  ];
  return lines.filter(Boolean).join('\n').slice(0, 12000);
}

function normalizedLocationBindings(bindings = []) {
  const out = [];
  for (const item of Array.isArray(bindings) ? bindings : []) {
    if (!item) continue;
    if (item.location && item.usage) out.push({ location: item.location, usage: item.usage });
    else if (item.id && item.usage) out.push({ location: item, usage: item.usage });
  }
  return out;
}

function locationForEnvironment(bindings = [], environmentId = null) {
  if (!environmentId) return null;
  return normalizedLocationBindings(bindings).find(item => item.usage?.environmentId === environmentId) || null;
}

function zoneForScene(zoneBindings = [], sceneId = null) {
  if (!sceneId) return null;
  return (Array.isArray(zoneBindings) ? zoneBindings : []).find(item => item?.usage?.sceneId === sceneId) || null;
}

function mappingForScene(sceneMappings = [], sceneId = null) {
  return (Array.isArray(sceneMappings) ? sceneMappings : []).find(item => item?.sceneId === sceneId) || null;
}

class TemporaryLocationStateLayerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.REUSABLE_LOCATION_TEMPORARY_STATES_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  async registerSceneState(production = {}, scene = {}, mapping = null, locationBinding = null, zoneBinding = null) {
    if (!this.enabled || !production?.id || !scene?.id || !mapping?.environmentId || !locationBinding?.location?.id) return null;
    const extracted = extractTemporaryState(scene);
    const locationId = locationBinding.location.id;
    const zoneId = zoneBinding?.id || zoneBinding?.zone?.id || null;
    const identity = {
      locationId,
      zoneId,
      sceneId: scene.id,
      state: extracted.state,
      conflicts: extracted.conflicts
    };
    const stateFingerprint = hash(stableJson(identity));
    const id = `location_state_${hash(`${production.id}:${scene.id}`).slice(0, 18)}`;
    const draft = {
      id,
      productionId: production.id,
      sceneId: scene.id,
      locationId,
      zoneId,
      environmentId: mapping.environmentId,
      sceneEnvironmentId: mapping.id || null,
      zoneUsageId: zoneBinding?.usage?.id || null,
      version: VERSION,
      status: extracted.active ? 'active' : 'neutral',
      stateFingerprint,
      timeOfDay: extracted.state.timeOfDay,
      weather: extracted.state.weather,
      lightingStates: extracted.state.lightingStates,
      temporaryProps: extracted.state.temporaryProps,
      temporaryChanges: extracted.state.temporaryChanges,
      conflicts: extracted.conflicts,
      sourceKind: extracted.sourceKind,
      confidence: extracted.confidence
    };
    draft.promptFragment = statePromptFragment(draft);
    return this.db.saveReusableLocationStateLayer(draft);
  }

  async ensureProductionStates(production = {}, scenes = [], sceneMappings = [], locationBindings = [], zoneBindings = []) {
    const sceneList = Array.isArray(scenes) ? scenes : [];
    if (!this.enabled || !production?.id || !sceneList.length) {
      return { version: VERSION, active: this.enabled, productionId: production?.id || null, states: [], unresolved: [], summary: { sceneCount: sceneList.length, persisted: 0, activeStates: 0, neutralStates: 0, missingLocation: 0, conflicts: 0 } };
    }
    const states = [];
    const unresolved = [];
    for (const scene of sceneList) {
      const mapping = mappingForScene(sceneMappings, scene.id);
      if (!mapping || mapping.status !== 'mapped' || !mapping.environmentId) {
        unresolved.push({ sceneId: scene.id, reason: 'scene_environment_unresolved' });
        continue;
      }
      const locationBinding = locationForEnvironment(locationBindings, mapping.environmentId);
      if (!locationBinding) {
        unresolved.push({ sceneId: scene.id, environmentId: mapping.environmentId, reason: 'reusable_location_unresolved' });
        continue;
      }
      const zoneBinding = zoneForScene(zoneBindings, scene.id);
      const state = await this.registerSceneState(production, scene, mapping, locationBinding, zoneBinding);
      if (state) states.push(state);
    }
    const summary = {
      sceneCount: sceneList.length,
      persisted: states.length,
      activeStates: states.filter(item => item.status === 'active').length,
      neutralStates: states.filter(item => item.status === 'neutral').length,
      missingLocation: unresolved.filter(item => item.reason === 'reusable_location_unresolved').length,
      conflicts: states.reduce((sum, item) => sum + (item.conflicts || []).length, 0)
    };
    this.logger.info(`Temporary Location State v11.9.5: persisted=${summary.persisted}, active=${summary.activeStates}, neutral=${summary.neutralStates}, unresolved=${unresolved.length}, conflicts=${summary.conflicts}.`);
    return { version: VERSION, active: true, productionId: production.id, states, unresolved, summary };
  }
}

module.exports = {
  TEMPORARY_LOCATION_STATE_VERSION: VERSION,
  TemporaryLocationStateLayerV11,
  extractTemporaryState,
  statePromptFragment,
  sceneText,
  explicitState,
  singleDimension,
  matchesFor,
  normalizedLocationBindings,
  locationForEnvironment,
  zoneForScene,
  mappingForScene,
  stableJson,
  hash,
  normalize
};
