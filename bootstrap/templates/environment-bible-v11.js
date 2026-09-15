'use strict';

const crypto = require('crypto');

const VERSION = '11.7.1';

function clean(value, limit = 6000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slug(value) {
  return clean(value, 120).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'environment';
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function unique(values, limit = 20) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const value = clean(raw, 180);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function productionText(production = {}) {
  const strategy = production.strategy || production.script?.metadata?.strategy || {};
  const script = production.script || {};
  const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];
  return [
    strategy.topic,
    production.title,
    script.title,
    strategy.videoInstructions,
    production.videoInstructions,
    script.hook?.text,
    script.introduction?.topicIntro,
    ...sections.flatMap(section => [section.title, Array.isArray(section.content) ? section.content.join(' ') : section.content]),
    script.conclusion?.summary,
    script.conclusion?.finalThought
  ].filter(Boolean).join('\n');
}

function extractExplicitEnvironmentLines(production = {}) {
  const strategy = production.strategy || production.script?.metadata?.strategy || {};
  const raw = String(strategy.videoInstructions || production.videoInstructions || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const found = [];
  let collecting = false;
  for (const line of lines) {
    const match = line.match(/^(?:main\s+)?(?:environment|setting|location|scene\s+location|background)\s*:\s*(.+)$/i);
    if (match) {
      collecting = true;
      found.push(clean(match[1], 500));
      continue;
    }
    if (collecting && /^[-*]\s+/.test(line)) {
      found.push(clean(line.replace(/^[-*]\s+/, ''), 500));
      continue;
    }
    if (/^[A-Z][A-Za-z ]{2,30}:/.test(line)) collecting = false;
  }
  return unique(found, 12);
}

const PROFILES = [
  {
    category: 'house',
    pattern: /\b(house|home|cabin|cottage|wooden house|wood house|casa|cabana)\b/i,
    name: 'Woodland Home',
    defaults: {
      architecturalStyle: 'cozy rustic family home',
      construction: 'natural wood construction',
      palette: ['warm natural brown', 'soft beige', 'cream'],
      lighting: 'warm soft daylight',
      layout: 'stable readable domestic layout',
      materials: ['natural wood', 'soft fabric', 'matte metal accents'],
      signatureElements: ['main seating area', 'wooden table', 'windows', 'shelving or storage'],
      forbiddenChanges: ['do not change the building into concrete, glass, or a luxury apartment', 'do not randomly move or replace signature furniture', 'do not redesign the room layout between adjacent shots']
    }
  },
  {
    category: 'garden',
    pattern: /\b(garden|backyard|yard|flower garden|jardim)\b/i,
    name: 'Colorful Garden',
    defaults: {
      architecturalStyle: 'friendly storybook garden',
      construction: 'outdoor landscaped environment',
      palette: ['leaf green', 'flower red', 'sunny yellow', 'sky blue'],
      lighting: 'soft cheerful daylight',
      layout: 'stable garden path with recurring planting zones',
      materials: ['grass', 'soil', 'wood', 'stone'],
      signatureElements: ['garden path', 'flower beds', 'small shrubs', 'open sky'],
      forbiddenChanges: ['do not turn the garden into an indoor room', 'preserve recurring path and planting landmarks', 'do not replace the environment with unrelated fantasy scenery']
    }
  },
  {
    category: 'forest',
    pattern: /\b(forest|woods|woodland|grove)\b/i,
    name: 'Friendly Woodland',
    defaults: {
      architecturalStyle: 'soft layered storybook woodland',
      construction: 'natural outdoor environment',
      palette: ['forest green', 'moss green', 'warm brown', 'soft blue'],
      lighting: 'filtered daylight through trees',
      layout: 'stable path, foreground trees, and recurring clearing landmarks',
      materials: ['tree bark', 'leaves', 'grass', 'stone'],
      signatureElements: ['walking path', 'recurring tree cluster', 'small clearing'],
      forbiddenChanges: ['do not turn the woodland into a city or interior', 'preserve the path and recurring tree landmarks', 'avoid dark horror forest styling']
    }
  },
  {
    category: 'classroom',
    pattern: /\b(classroom|school room|preschool room|kindergarten)\b/i,
    name: 'Friendly Classroom',
    defaults: {
      architecturalStyle: 'simple child-friendly classroom',
      construction: 'indoor educational space',
      palette: ['warm cream', 'soft blue', 'sunny yellow', 'natural wood'],
      lighting: 'bright soft classroom daylight',
      layout: 'stable teaching area with tables and storage',
      materials: ['painted wall', 'natural wood', 'paper', 'soft plastic'],
      signatureElements: ['child-sized tables', 'shelves', 'teaching wall', 'window'],
      forbiddenChanges: ['do not turn the classroom into an office or laboratory', 'preserve table and shelf placement', 'avoid random signage or unreadable text']
    }
  },
  {
    category: 'kitchen',
    pattern: /\b(kitchen|cooking area)\b/i,
    name: 'Cozy Kitchen',
    defaults: {
      architecturalStyle: 'cozy compact family kitchen',
      construction: 'indoor domestic room',
      palette: ['natural wood', 'cream', 'soft green'],
      lighting: 'warm practical daylight',
      layout: 'stable counter, table, storage, and appliance zones',
      materials: ['natural wood', 'ceramic', 'matte metal'],
      signatureElements: ['counter', 'table', 'cabinets', 'window'],
      forbiddenChanges: ['preserve counter and cabinet placement', 'do not change the kitchen into an unrelated room', 'do not add random appliances between shots']
    }
  },
  {
    category: 'bedroom',
    pattern: /\b(bedroom|sleeping room|nursery)\b/i,
    name: 'Cozy Bedroom',
    defaults: {
      architecturalStyle: 'simple child-friendly bedroom',
      construction: 'indoor domestic room',
      palette: ['soft cream', 'powder blue', 'warm wood'],
      lighting: 'soft warm daylight',
      layout: 'stable bed, bedside, storage, and window arrangement',
      materials: ['natural wood', 'cotton fabric', 'painted wall'],
      signatureElements: ['bed', 'window', 'small storage', 'rug'],
      forbiddenChanges: ['preserve the bed and window relationship', 'do not redesign the bedroom between shots', 'avoid random new furniture']
    }
  },
  {
    category: 'playground',
    pattern: /\b(playground|play area|park playground)\b/i,
    name: 'Sunny Playground',
    defaults: {
      architecturalStyle: 'safe colorful neighborhood playground',
      construction: 'outdoor recreation environment',
      palette: ['sky blue', 'grass green', 'sunny yellow', 'warm red'],
      lighting: 'soft cheerful daylight',
      layout: 'stable slide, climbing zone, path, and open play area',
      materials: ['painted metal', 'wood', 'rubber surface', 'grass'],
      signatureElements: ['slide', 'climbing structure', 'path', 'open play area'],
      forbiddenChanges: ['preserve major equipment placement', 'do not turn the playground into an amusement park', 'avoid unsafe or damaged equipment']
    }
  }
];

function detectMaterials(text) {
  const local = String(text || '').toLowerCase();
  const materials = [];
  const pairs = [
    [/\bwood(en)?\b|\btimber\b|\bmade of wood\b|\bfeita? de madeira\b|\bmadeira\b/, 'natural wood'],
    [/\bstone\b|\brock\b|\bpedra\b/, 'stone'],
    [/\bbrick\b|\btijolo\b/, 'brick'],
    [/\bglass\b|\bvidro\b/, 'glass'],
    [/\bmetal\b|\bsteel\b|\bferro\b/, 'matte metal'],
    [/\bfabric\b|\blinen\b|\bcotton\b|\btecido\b/, 'soft fabric']
  ];
  for (const [pattern, label] of pairs) if (pattern.test(local)) materials.push(label);
  return unique(materials, 8);
}

function detectFurniture(text) {
  const local = String(text || '').toLowerCase();
  const props = [];
  const pairs = [
    [/\bsofa\b|\bcouch\b/, 'sofa'],
    [/\bcoffee table\b|\bmesa de centro\b/, 'coffee table'],
    [/\btable\b|\bmesa\b/, 'table'],
    [/\bbookshelf\b|\bbookcase\b|\bprateleira\b|\bestante\b/, 'bookshelf'],
    [/\bchair\b|\bcadeira\b/, 'chair'],
    [/\brug\b|\bcarpet\b|\btapete\b/, 'rug'],
    [/\blamp\b|\bluminaria\b|\bluminária\b/, 'lamp'],
    [/\bcabinet\b|\bcupboard\b|\barmario\b|\barmário\b/, 'cabinet'],
    [/\bbed\b|\bcama\b/, 'bed'],
    [/\bwindow\b|\bjanela\b/, 'window']
  ];
  for (const [pattern, label] of pairs) if (pattern.test(local)) props.push(label);
  if (/\bfurnished\b|\bmobiliad[ao]\b/i.test(local) && !props.length) {
    props.push('main seating area', 'table', 'storage', 'window');
  }
  return unique(props, 12);
}

function detectPalette(text, fallback = []) {
  const local = String(text || '').toLowerCase();
  const colors = [];
  const pairs = [
    [/\bred\b|\bvermelh[oa]\b/, 'red'], [/\bblue\b|\bazul\b/, 'blue'], [/\byellow\b|\bamarel[oa]\b/, 'yellow'],
    [/\bgreen\b|\bverde\b/, 'green'], [/\bbeige\b/, 'beige'], [/\bcream\b|\bcreme\b/, 'cream'],
    [/\bbrown\b|\bmarrom\b/, 'brown'], [/\bwhite\b|\bbranc[oa]\b/, 'white'], [/\bblack\b|\bpret[oa]\b/, 'black']
  ];
  for (const [pattern, label] of pairs) if (pattern.test(local)) colors.push(label);
  return unique(colors.length ? colors : fallback, 8);
}

function profileForText(text) {
  return PROFILES.find(profile => profile.pattern.test(text)) || null;
}

function candidateFromText(text, source = 'inferred') {
  const cleaned = clean(text, 700);
  if (!cleaned) return null;
  const profile = profileForText(cleaned);
  if (!profile) return null;
  return { text: cleaned, source, profile };
}

function collectCandidates(production = {}) {
  const text = productionText(production);
  const candidates = [];
  for (const explicit of extractExplicitEnvironmentLines(production)) {
    const candidate = candidateFromText(explicit, 'explicit_instruction');
    if (candidate) candidates.push(candidate);
  }
  for (const profile of PROFILES) {
    const match = text.match(profile.pattern);
    if (!match) continue;
    const start = Math.max(0, match.index - 120);
    const excerpt = clean(text.slice(start, Math.min(text.length, match.index + 260)), 500);
    candidates.push({ text: excerpt, source: 'production_text', profile });
  }
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = candidate.profile.category;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function buildEnvironment(candidate, index = 0) {
  const { text, source, profile } = candidate;
  const explicitMaterials = detectMaterials(text);
  const materials = unique([...explicitMaterials, ...profile.defaults.materials], 10);
  const explicitProps = detectFurniture(text);
  const signatureElements = unique([...explicitProps, ...profile.defaults.signatureElements], 14);
  const palette = detectPalette(text, profile.defaults.palette);
  const wooden = materials.includes('natural wood');
  const construction = wooden && profile.category === 'house' ? 'natural wood construction' : profile.defaults.construction;
  const description = clean(text, 500);
  const stableIdentity = {
    category: profile.category,
    description,
    construction,
    architecturalStyle: profile.defaults.architecturalStyle,
    palette,
    lighting: profile.defaults.lighting,
    layout: profile.defaults.layout,
    materials,
    signatureElements,
    forbiddenChanges: profile.defaults.forbiddenChanges
  };
  const fingerprint = hash(JSON.stringify(stableIdentity));
  const id = `env_${slug(profile.category)}_${fingerprint.slice(0, 10)}`;
  const specificity = Math.min(100, 45 + explicitMaterials.length * 8 + explicitProps.length * 6 + Math.min(20, Math.floor(description.length / 30)));
  const inferredDefaults = [];
  if (!explicitMaterials.length) inferredDefaults.push('materials');
  if (!explicitProps.length) inferredDefaults.push('signatureElements');
  if (palette.every(color => profile.defaults.palette.includes(color))) inferredDefaults.push('palette');
  inferredDefaults.push('lighting', 'layout', 'architecturalStyle');
  return {
    version: VERSION,
    id,
    environmentId: id,
    name: profile.name,
    category: profile.category,
    description,
    construction,
    architecturalStyle: profile.defaults.architecturalStyle,
    palette,
    lighting: profile.defaults.lighting,
    layout: profile.defaults.layout,
    materials,
    zones: [],
    signatureElements,
    forbiddenChanges: [...profile.defaults.forbiddenChanges],
    sourceEvidence: [{ source, text: description }],
    inferredDefaults: unique(inferredDefaults, 12),
    specificity,
    masterFramePath: null,
    status: 'defined',
    fingerprint,
    order: index
  };
}

function environmentPrompt(environment = {}) {
  if (!environment?.environmentId) return '';
  return [
    `ENVIRONMENT ID: ${environment.environmentId}`,
    `ENVIRONMENT NAME: ${environment.name || environment.category || ''}`,
    `DESCRIPTION: ${environment.description || ''}`,
    `CONSTRUCTION: ${environment.construction || ''}`,
    `ARCHITECTURAL STYLE: ${environment.architecturalStyle || ''}`,
    `MATERIALS: ${(environment.materials || []).join(', ')}`,
    `PALETTE: ${(environment.palette || []).join(', ')}`,
    `LIGHTING: ${environment.lighting || ''}`,
    `LAYOUT IDENTITY: ${environment.layout || ''}`,
    `SIGNATURE ELEMENTS: ${(environment.signatureElements || []).join(', ')}`,
    `ENVIRONMENT CONTINUITY: preserve construction, material identity, palette, layout, and signature elements across future views of this location.`,
    `DO NOT: ${(environment.forbiddenChanges || []).join('; ')}`,
    `MASTER FRAME: not generated yet; Phase 11.7.3 will create the canonical visual reference.`
  ].join('\n');
}

function biblePromptContext(bible = {}) {
  if (!Array.isArray(bible.environments) || !bible.environments.length) return '';
  return [
    'ENVIRONMENT BIBLE V11.7.1:',
    ...bible.environments.map(environmentPrompt)
  ].join('\n\n');
}

class EnvironmentBibleV11 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.ENVIRONMENT_BIBLE_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
    const configuredMax = Number(options.maxEnvironments ?? process.env.ENVIRONMENT_BIBLE_MAX_ENVIRONMENTS ?? 12);
    this.maxEnvironments = Number.isFinite(configuredMax) ? Math.max(1, Math.min(30, Math.round(configuredMax))) : 12;
  }

  buildProductionBible(production = {}, cartoonBible = null) {
    if (!this.enabled) return null;
    if (cartoonBible && cartoonBible.mode !== 'kids_cartoon_2d') return null;
    const candidates = collectCandidates(production).slice(0, this.maxEnvironments);
    if (!candidates.length) return null;
    const environments = candidates.map((candidate, index) => buildEnvironment(candidate, index));
    const fingerprint = hash(JSON.stringify(environments.map(environment => ({
      environmentId: environment.environmentId,
      fingerprint: environment.fingerprint
    }))));
    const bible = {
      version: VERSION,
      productionId: production.id || null,
      fingerprint,
      environments,
      summary: {
        environmentCount: environments.length,
        categories: environments.map(environment => environment.category),
        averageSpecificity: Math.round(environments.reduce((sum, item) => sum + Number(item.specificity || 0), 0) / Math.max(1, environments.length)),
        masterFramesReady: 0
      },
      createdAt: new Date().toISOString()
    };
    bible.promptContext = biblePromptContext(bible);
    return bible;
  }
}

module.exports = {
  ENVIRONMENT_BIBLE_VERSION: VERSION,
  EnvironmentBibleV11,
  buildEnvironment,
  biblePromptContext,
  collectCandidates,
  environmentPrompt,
  extractExplicitEnvironmentLines,
  productionText
};
