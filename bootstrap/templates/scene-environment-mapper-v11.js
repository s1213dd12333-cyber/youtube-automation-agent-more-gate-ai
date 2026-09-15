'use strict';

const crypto = require('crypto');

const VERSION = '11.7.4';

function clean(value, limit = 8000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalize(value) {
  return clean(value, 8000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function tokens(value) {
  return [...new Set(normalize(value).match(/[a-z0-9]{3,}/g) || [])];
}

const STOP = new Set(['scene','cena','with','from','that','this','into','then','they','their','onde','para','como','uma','com','sem','the','and','dos','das','por','mais','same','established','location']);
const ZONES = [
  ['living_room', /\b(living room|sala de estar|sala)\b/i],
  ['kitchen', /\b(kitchen|cozinha)\b/i],
  ['bedroom', /\b(bedroom|quarto)\b/i],
  ['bathroom', /\b(bathroom|banheiro)\b/i],
  ['dining_area', /\b(dining room|dining area|sala de jantar|area de jantar)\b/i],
  ['garden', /\b(garden|jardim)\b/i],
  ['yard', /\b(backyard|front yard|yard|quintal|patio)\b/i],
  ['classroom', /\b(classroom|sala de aula)\b/i],
  ['play_area', /\b(playground|play area|parquinho|area de brincar)\b/i],
  ['forest_path', /\b(forest path|woodland path|trilha|caminho da floresta)\b/i],
  ['exterior', /\b(outside|exterior|fachada|lado de fora)\b/i]
];

function detectZone(sceneText) {
  for (const [zone, pattern] of ZONES) if (pattern.test(sceneText)) return zone;
  return null;
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
  ].filter(Boolean).join(' '), 12000);
}

function environmentText(environment = {}) {
  return clean([
    environment.environmentId,
    environment.name,
    environment.category,
    environment.description,
    environment.construction,
    environment.architecturalStyle,
    environment.layout,
    (environment.materials || []).join(' '),
    (environment.signatureElements || []).join(' '),
    (environment.zones || []).join(' '),
    ...(environment.sourceEvidence || []).map(item => item?.text || '')
  ].filter(Boolean).join(' '), 16000);
}

function lexicalScore(scene = {}, environment = {}) {
  const sText = normalize(sceneText(scene));
  const eText = normalize(environmentText(environment));
  const eTokens = tokens(eText).filter(token => !STOP.has(token));
  if (!eTokens.length || !sText) return { score: 0, matched: [] };
  const matched = eTokens.filter(token => sText.includes(token));
  const denominator = Math.max(4, Math.min(18, eTokens.length));
  let score = Math.min(1, matched.length / denominator);
  const category = normalize(environment.category || '');
  const name = normalize(environment.name || '');
  if (category && sText.includes(category)) score += 0.28;
  if (name && name.length >= 4 && sText.includes(name)) score += 0.4;
  for (const signature of environment.signatureElements || []) {
    const n = normalize(signature);
    if (n && sText.includes(n)) score += 0.08;
  }
  return { score: Math.min(1, Number(score.toFixed(4))), matched: matched.slice(0, 12) };
}

function transitionSignal(text) {
  return /\b(next|later|arrive|enter|leave|goes? to|walks? to|moves? to|outside|inside|depois|entra|sai|vai para|chega|segue para|muda para)\b/i.test(text);
}

function continuationSignal(text) {
  return /\b(same|continues?|still|remains?|mesmo|mesma|continua|permanece|ainda)\b/i.test(text);
}

function masterFor(masterFrames = [], environmentId) {
  return (masterFrames || []).find(frame => frame.environmentId === environmentId && frame.status === 'ready' && frame.canonical === true) || null;
}

function mapScene(scene, environments, previousMapping = null, masterFrames = [], options = {}) {
  const minimumScore = Number(options.minimumScore ?? process.env.SCENE_ENVIRONMENT_MIN_SCORE ?? 0.18);
  const text = sceneText(scene);
  const zone = detectZone(text);
  const scored = environments.map((environment, index) => ({ environment, index, ...lexicalScore(scene, environment) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  let selected = null;
  let reason = null;
  let confidence = 0;

  if (scored.length === 1) {
    selected = scored[0];
    reason = scored[0].score >= minimumScore ? 'lexical_match' : 'single_environment_reuse';
    confidence = scored[0].score >= minimumScore ? Math.max(0.62, scored[0].score) : 0.56;
  } else if (scored.length > 1 && scored[0].score >= minimumScore) {
    const margin = scored[0].score - (scored[1]?.score || 0);
    if (margin >= 0.04 || scored[0].score >= 0.5) {
      selected = scored[0];
      reason = 'lexical_match';
      confidence = Math.min(0.97, 0.58 + scored[0].score * 0.36 + Math.min(0.08, margin));
    }
  }

  if (!selected && previousMapping?.environmentId && !transitionSignal(text)) {
    const previous = scored.find(item => item.environment.environmentId === previousMapping.environmentId);
    if (previous && (continuationSignal(text) || scored.every(item => item.score < minimumScore))) {
      selected = previous;
      reason = continuationSignal(text) ? 'explicit_continuation' : 'adjacent_scene_continuity';
      confidence = continuationSignal(text) ? 0.76 : 0.52;
    }
  }

  if (!selected) {
    return {
      version: VERSION,
      sceneId: scene.id,
      scenePosition: Number(scene.position || 0),
      environmentId: null,
      zone,
      status: 'unresolved',
      confidence: 0,
      reason: scored.length ? 'ambiguous_or_insufficient_evidence' : 'no_environment_bible_entries',
      matchedTerms: scored[0]?.matched || [],
      masterFramePath: null,
      masterCanonical: false,
      fingerprint: hash(JSON.stringify({ version: VERSION, sceneId: scene.id, environmentId: null, zone, text }))
    };
  }

  const environment = selected.environment;
  const master = masterFor(masterFrames, environment.environmentId);
  const stable = {
    version: VERSION,
    sceneId: scene.id,
    environmentId: environment.environmentId,
    environmentFingerprint: environment.fingerprint || null,
    zone,
    reason,
    matchedTerms: selected.matched,
    masterAssetSha256: master?.assetSha256 || null
  };
  return {
    ...stable,
    scenePosition: Number(scene.position || 0),
    environmentName: environment.name || environment.category || environment.environmentId,
    status: 'mapped',
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(4)),
    masterFramePath: master?.masterFramePath || null,
    masterCanonical: Boolean(master),
    fingerprint: hash(JSON.stringify(stable))
  };
}

class SceneEnvironmentMapperV11 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.SCENE_ENVIRONMENT_MAPPING_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.minimumScore = Number(options.minimumScore ?? process.env.SCENE_ENVIRONMENT_MIN_SCORE ?? 0.18);
  }

  mapProduction(production = {}, scenes = [], environmentBible = null, masterFrames = []) {
    if (!this.enabled || !environmentBible || !Array.isArray(environmentBible.environments) || !environmentBible.environments.length) return null;
    const ordered = [...(scenes || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    const mappings = [];
    let previous = null;
    for (const scene of ordered) {
      const mapping = mapScene(scene, environmentBible.environments, previous, masterFrames, { minimumScore: this.minimumScore });
      mappings.push({ ...mapping, productionId: production.id || environmentBible.productionId || null });
      if (mapping.environmentId) previous = mapping;
    }
    const fingerprint = hash(JSON.stringify({
      version: VERSION,
      productionId: production.id || null,
      environmentBibleFingerprint: environmentBible.fingerprint || null,
      mappings: mappings.map(item => ({ sceneId: item.sceneId, environmentId: item.environmentId, zone: item.zone, fingerprint: item.fingerprint }))
    }));
    for (const mapping of mappings) mapping.planFingerprint = fingerprint;
    const result = {
      version: VERSION,
      productionId: production.id || environmentBible.productionId || null,
      environmentBibleFingerprint: environmentBible.fingerprint || null,
      fingerprint,
      mappings,
      summary: {
        sceneCount: mappings.length,
        mappedCount: mappings.filter(item => item.status === 'mapped').length,
        unresolvedCount: mappings.filter(item => item.status !== 'mapped').length,
        reusedEnvironmentCount: new Set(mappings.map(item => item.environmentId).filter(Boolean)).size,
        masterBackedCount: mappings.filter(item => item.masterCanonical).length
      },
      createdAt: new Date().toISOString()
    };
    this.logger.info(`Scene Environment Mapper v11.7.4 mapped ${result.summary.mappedCount}/${result.summary.sceneCount} scene(s) across ${result.summary.reusedEnvironmentCount} environment(s); unresolved=${result.summary.unresolvedCount}.`);
    return result;
  }
}

module.exports = {
  SCENE_ENVIRONMENT_MAPPER_VERSION: VERSION,
  SceneEnvironmentMapperV11,
  detectZone,
  sceneText,
  environmentText,
  lexicalScore,
  mapScene,
  masterFor
};
