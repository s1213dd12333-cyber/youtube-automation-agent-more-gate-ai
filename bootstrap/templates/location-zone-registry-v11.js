'use strict';

const crypto = require('crypto');

const VERSION = '11.9.2';

function clean(value, limit = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function slug(value) {
  return clean(value, 160)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'zone';
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

const ZONE_DEFINITIONS = [
  { key: 'living_room', type: 'room', label: 'Living Room', pattern: /\b(living room|lounge|sitting room|family room|sala de estar|sala)\b/i },
  { key: 'kitchen', type: 'room', label: 'Kitchen', pattern: /\b(kitchen|cozinha)\b/i },
  { key: 'bedroom', type: 'room', label: 'Bedroom', pattern: /\b(bedroom|bed room|quarto|dormitorio|dormitório)\b/i },
  { key: 'bathroom', type: 'room', label: 'Bathroom', pattern: /\b(bathroom|washroom|restroom|banheiro)\b/i },
  { key: 'dining_area', type: 'room', label: 'Dining Area', pattern: /\b(dining room|dining area|sala de jantar|area de jantar|área de jantar)\b/i },
  { key: 'hallway', type: 'transition_area', label: 'Hallway', pattern: /\b(hallway|corridor|hall|corredor)\b/i },
  { key: 'entrance', type: 'transition_area', label: 'Entrance', pattern: /\b(entrance|entryway|foyer|front door area|entrada|hall de entrada)\b/i },
  { key: 'stairs', type: 'transition_area', label: 'Stairs', pattern: /\b(stairs|staircase|escada|escadas)\b/i },
  { key: 'office', type: 'room', label: 'Office', pattern: /\b(home office|office|study room|escritorio|escritório)\b/i },
  { key: 'garage', type: 'room', label: 'Garage', pattern: /\b(garage|garagem)\b/i },
  { key: 'basement', type: 'room', label: 'Basement', pattern: /\b(basement|porao|porão)\b/i },
  { key: 'attic', type: 'room', label: 'Attic', pattern: /\b(attic|sotao|sótão)\b/i },
  { key: 'classroom', type: 'room', label: 'Classroom', pattern: /\b(classroom|sala de aula)\b/i },
  { key: 'garden', type: 'outdoor_area', label: 'Garden', pattern: /\b(garden|jardim)\b/i },
  { key: 'yard', type: 'outdoor_area', label: 'Yard', pattern: /\b(backyard|front yard|yard|quintal|patio|pátio)\b/i },
  { key: 'porch', type: 'outdoor_area', label: 'Porch', pattern: /\b(porch|veranda|varanda frontal|alpendre)\b/i },
  { key: 'balcony', type: 'outdoor_area', label: 'Balcony', pattern: /\b(balcony|varanda|sacada)\b/i },
  { key: 'play_area', type: 'outdoor_area', label: 'Play Area', pattern: /\b(playground|play area|parquinho|area de brincar|área de brincar)\b/i },
  { key: 'forest_path', type: 'outdoor_area', label: 'Forest Path', pattern: /\b(forest path|woodland path|trilha|caminho da floresta)\b/i },
  { key: 'exterior', type: 'exterior', label: 'Exterior', pattern: /\b(exterior|outside the house|outside the home|fachada|lado de fora)\b/i }
];

const ZONE_BY_KEY = new Map(ZONE_DEFINITIONS.map(def => [def.key, def]));
const ZONE_ALIASES = new Map([
  ['livingroom', 'living_room'], ['living_room', 'living_room'], ['lounge', 'living_room'], ['sitting_room', 'living_room'], ['family_room', 'living_room'], ['sala', 'living_room'], ['sala_de_estar', 'living_room'],
  ['kitchen', 'kitchen'], ['cozinha', 'kitchen'],
  ['bedroom', 'bedroom'], ['quarto', 'bedroom'], ['dormitorio', 'bedroom'],
  ['bathroom', 'bathroom'], ['banheiro', 'bathroom'],
  ['dining_room', 'dining_area'], ['dining_area', 'dining_area'], ['sala_de_jantar', 'dining_area'], ['area_de_jantar', 'dining_area'],
  ['hallway', 'hallway'], ['corridor', 'hallway'], ['corredor', 'hallway'],
  ['entrance', 'entrance'], ['entryway', 'entrance'], ['foyer', 'entrance'], ['entrada', 'entrance'],
  ['stairs', 'stairs'], ['staircase', 'stairs'], ['escada', 'stairs'],
  ['office', 'office'], ['home_office', 'office'], ['escritorio', 'office'],
  ['garage', 'garage'], ['garagem', 'garage'],
  ['basement', 'basement'], ['porao', 'basement'],
  ['attic', 'attic'], ['sotao', 'attic'],
  ['classroom', 'classroom'], ['sala_de_aula', 'classroom'],
  ['garden', 'garden'], ['jardim', 'garden'],
  ['yard', 'yard'], ['backyard', 'yard'], ['front_yard', 'yard'], ['quintal', 'yard'], ['patio', 'yard'],
  ['porch', 'porch'], ['veranda', 'porch'], ['alpendre', 'porch'],
  ['balcony', 'balcony'], ['sacada', 'balcony'],
  ['play_area', 'play_area'], ['playground', 'play_area'], ['parquinho', 'play_area'],
  ['forest_path', 'forest_path'], ['trilha', 'forest_path'],
  ['exterior', 'exterior'], ['outside', 'exterior'], ['fachada', 'exterior']
]);

function normalizeZoneName(value) {
  const key = slug(value);
  if (!key || key === 'zone') return null;
  if (ZONE_BY_KEY.has(key)) return key;
  return ZONE_ALIASES.get(key) || null;
}

function zoneDefinition(zoneKey) {
  const key = normalizeZoneName(zoneKey);
  return key ? ZONE_BY_KEY.get(key) || null : null;
}

function sceneText(scene = {}) {
  return clean([
    scene.label,
    scene.scriptText,
    scene.prompt,
    scene.visualBrief?.subject,
    scene.visualBrief?.setting,
    scene.visualBrief?.composition,
    scene.visualBrief?.requiredElements?.join?.(' ')
  ].filter(Boolean).join(' '), 16000);
}

function detectExplicitZones(scene = {}) {
  const text = sceneText(scene);
  if (!text) return { status: 'none', zoneKey: null, matches: [] };
  const matches = ZONE_DEFINITIONS
    .filter(def => def.pattern.test(text))
    .map(def => def.key);
  const unique = [...new Set(matches)];
  if (!unique.length) return { status: 'none', zoneKey: null, matches: [] };
  if (unique.length > 1) return { status: 'ambiguous', zoneKey: null, matches: unique };
  return { status: 'resolved', zoneKey: unique[0], matches: unique };
}

function resolveSceneZone(mapping = {}, scene = {}) {
  const mappedKey = normalizeZoneName(mapping.zone || mapping.zoneName || '');
  const explicit = detectExplicitZones(scene);
  if (explicit.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      zoneKey: null,
      sourceKind: 'ambiguous_explicit_scene_text',
      candidates: explicit.matches,
      confidence: 0,
      reason: 'multiple_explicit_zones_in_scene'
    };
  }
  if (mappedKey) {
    return {
      status: 'resolved',
      zoneKey: mappedKey,
      sourceKind: 'scene_environment_mapping',
      candidates: explicit.matches,
      confidence: Math.max(0.5, Math.min(1, Number(mapping.confidence || 0.7))),
      reason: explicit.zoneKey && explicit.zoneKey !== mappedKey ? 'mapper_zone_preferred_over_single_text_alias' : 'mapped_zone'
    };
  }
  if (explicit.status === 'resolved') {
    return {
      status: 'resolved',
      zoneKey: explicit.zoneKey,
      sourceKind: 'explicit_scene_text',
      candidates: explicit.matches,
      confidence: 0.78,
      reason: 'single_explicit_zone_term'
    };
  }
  return {
    status: 'unresolved',
    zoneKey: null,
    sourceKind: 'none',
    candidates: [],
    confidence: 0,
    reason: 'no_zone_evidence'
  };
}

function normalizeLocationBindings(bindings = []) {
  const out = [];
  for (const item of Array.isArray(bindings) ? bindings : []) {
    if (!item) continue;
    if (item.location && item.usage) {
      out.push({ location: item.location, usage: item.usage });
      continue;
    }
    if (item.id && item.usage) out.push({ location: item, usage: item.usage });
  }
  return out;
}

function bindingForEnvironment(bindings = [], environmentId = null) {
  if (!environmentId) return null;
  return normalizeLocationBindings(bindings).find(item => item.usage?.environmentId === environmentId) || null;
}

function buildZoneIdentity(location = {}, zoneKey = '') {
  const def = zoneDefinition(zoneKey);
  if (!location?.id || !def) return null;
  return {
    parentLocationId: location.id,
    parentIdentityFingerprint: location.identityFingerprint || null,
    zoneKey: def.key,
    zoneType: def.type,
    displayName: def.label
  };
}

function zoneFingerprint(location = {}, zoneKey = '') {
  const identity = buildZoneIdentity(location, zoneKey);
  return identity ? hash(stableJson(identity)) : null;
}

function canonicalZonePrompt(location = {}, zoneKey = '') {
  const def = zoneDefinition(zoneKey);
  if (!location?.id || !def) return '';
  return [
    `REUSABLE LOCATION ZONE V${VERSION}`,
    `PARENT LOCATION ID: ${location.id}`,
    `PARENT LOCATION: ${location.displayName || location.locationKey || 'Location'}`,
    `ZONE IDENTITY: ${def.key}`,
    `ZONE NAME: ${def.label}`,
    `ZONE TYPE: ${def.type}`,
    location.canonicalPromptContext ? `PARENT CANONICAL CONTEXT:\n${location.canonicalPromptContext}` : '',
    'Preserve this zone as the same physical subspace of the parent location across videos.',
    'Do not encode time of day, weather, temporary clutter, characters, actions, shot size, or camera angle into the zone identity.',
    'Do not invent adjacency, dimensions, doors, furniture, or props that are not already supported by the parent location or later canonical zone assets.'
  ].filter(Boolean).join('\n').slice(0, 24000);
}

class LocationZoneRegistryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.REUSABLE_LOCATION_ZONES_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  async registerSceneZone(production = {}, binding = null, mapping = {}, scene = {}) {
    if (!this.enabled || !production?.id || !binding?.location?.id || !mapping?.sceneId) return null;
    const resolution = resolveSceneZone(mapping, scene);
    if (resolution.status !== 'resolved' || !resolution.zoneKey) {
      return { status: resolution.status, resolution, location: binding.location, mapping, sceneId: mapping.sceneId, zone: null, usage: null, reused: false };
    }

    const location = binding.location;
    const def = zoneDefinition(resolution.zoneKey);
    const fingerprint = zoneFingerprint(location, def.key);
    const existing = await this.db.getReusableLocationZoneByKey(location.id, def.key);
    const zoneId = existing?.id || `location_zone_${hash(`${location.id}:${def.key}`).slice(0, 18)}`;
    const now = new Date().toISOString();
    const zone = await this.db.saveReusableLocationZone({
      id: zoneId,
      locationId: location.id,
      zoneKey: def.key,
      displayName: existing?.displayName || def.label,
      zoneType: existing?.zoneType || def.type,
      version: VERSION,
      identityFingerprint: fingerprint,
      canonicalIdentity: existing?.canonicalIdentity || buildZoneIdentity(location, def.key),
      canonicalPromptContext: existing?.canonicalPromptContext || canonicalZonePrompt(location, def.key),
      status: existing?.status || 'defined',
      firstSourceKind: existing?.firstSourceKind || resolution.sourceKind,
      firstSourceSceneId: existing?.firstSourceSceneId || mapping.sceneId,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      createdAt: existing?.createdAt || now
    });
    const usage = await this.db.saveReusableLocationZoneUsage({
      zoneId: zone.id,
      locationId: location.id,
      productionId: production.id,
      sceneId: mapping.sceneId,
      environmentId: mapping.environmentId || binding.usage?.environmentId || null,
      sceneEnvironmentId: mapping.id || null,
      sourceZoneName: mapping.zone || null,
      resolvedZoneKey: def.key,
      sourceKind: resolution.sourceKind,
      confidence: resolution.confidence,
      mappingFingerprint: mapping.fingerprint || null,
      createdAt: now
    });
    return {
      status: 'resolved',
      resolution,
      location,
      mapping,
      sceneId: mapping.sceneId,
      zone,
      usage,
      reused: Boolean(existing)
    };
  }

  async ensureProductionZones(production = {}, locationBindings = [], sceneMappings = [], scenes = []) {
    const mappings = Array.isArray(sceneMappings) ? sceneMappings : [];
    const sceneById = new Map((Array.isArray(scenes) ? scenes : []).map(scene => [scene.id, scene]));
    if (!this.enabled || !production?.id || !mappings.length) {
      return {
        version: VERSION,
        active: this.enabled,
        productionId: production?.id || null,
        zones: [],
        summary: { sceneCount: mappings.length, resolvedCount: 0, createdCount: 0, reusedCount: 0, ambiguousCount: 0, unresolvedCount: 0, missingLocationCount: 0 }
      };
    }

    const results = [];
    let missingLocationCount = 0;
    for (const mapping of mappings) {
      if (!mapping?.sceneId || mapping.status !== 'mapped' || !mapping.environmentId) continue;
      const binding = bindingForEnvironment(locationBindings, mapping.environmentId);
      if (!binding) {
        missingLocationCount += 1;
        results.push({ status: 'missing_location', mapping, sceneId: mapping.sceneId, zone: null, usage: null, reused: false });
        continue;
      }
      const scene = sceneById.get(mapping.sceneId) || { id: mapping.sceneId };
      const result = await this.registerSceneZone(production, binding, mapping, scene);
      if (result) results.push(result);
    }

    const resolved = results.filter(item => item.status === 'resolved' && item.zone);
    const summary = {
      sceneCount: mappings.length,
      resolvedCount: resolved.length,
      createdCount: resolved.filter(item => !item.reused).length,
      reusedCount: resolved.filter(item => item.reused).length,
      ambiguousCount: results.filter(item => item.status === 'ambiguous').length,
      unresolvedCount: results.filter(item => item.status === 'unresolved').length,
      missingLocationCount
    };
    this.logger.info(`Reusable Location Zones v${VERSION}: resolved=${summary.resolvedCount}, created=${summary.createdCount}, reused=${summary.reusedCount}, ambiguous=${summary.ambiguousCount}, unresolved=${summary.unresolvedCount}, missingLocation=${summary.missingLocationCount}.`);
    return { version: VERSION, active: true, productionId: production.id, zones: results, summary };
  }
}

module.exports = {
  REUSABLE_LOCATION_ZONES_VERSION: VERSION,
  LocationZoneRegistryV11,
  ZONE_DEFINITIONS,
  normalizeZoneName,
  zoneDefinition,
  sceneText,
  detectExplicitZones,
  resolveSceneZone,
  normalizeLocationBindings,
  bindingForEnvironment,
  buildZoneIdentity,
  zoneFingerprint,
  canonicalZonePrompt,
  stableJson,
  slug
};
