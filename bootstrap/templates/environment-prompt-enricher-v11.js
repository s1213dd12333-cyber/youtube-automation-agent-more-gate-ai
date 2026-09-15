'use strict';

const crypto = require('crypto');
const { environmentPrompt } = require('./environment-bible-v11');
const { lockPrompt } = require('./prop-lock-v11');

const VERSION = '11.7.5';

function clean(value, limit = 24000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function environmentById(environmentBible = null, environmentId = null) {
  if (!environmentId || !Array.isArray(environmentBible?.environments)) return null;
  return environmentBible.environments.find(item => item.environmentId === environmentId) || null;
}

function locksFor(propLocks = [], environmentId = null) {
  if (!environmentId) return [];
  return (Array.isArray(propLocks) ? propLocks : [])
    .filter(lock => lock.environmentId === environmentId)
    .sort((a, b) => Number(b.required === true) - Number(a.required === true) || String(a.name || '').localeCompare(String(b.name || '')));
}

function masterFor(masterFrames = [], environmentId = null) {
  if (!environmentId) return null;
  return (Array.isArray(masterFrames) ? masterFrames : []).find(frame =>
    frame.environmentId === environmentId && frame.status === 'ready' && frame.canonical === true && frame.masterFramePath
  ) || null;
}

function buildEnvironmentPromptFragment(mapping = null, environment = null, propLocks = [], masterFrame = null) {
  if (!mapping || mapping.status !== 'mapped' || !mapping.environmentId || !environment) {
    return [
      'ENVIRONMENT CONTINUITY V11.7.5:',
      'STATUS: unresolved.',
      'Do not invent a new persistent location identity. Preserve only explicit scene facts until Scene-to-Environment Mapping can resolve this scene.'
    ].join('\n');
  }

  const required = propLocks.filter(lock => lock.required === true).slice(0, 16);
  const optional = propLocks.filter(lock => lock.required !== true).slice(0, 8);
  const lines = [
    'ENVIRONMENT CONTINUITY V11.7.5:',
    `ENVIRONMENT ID: ${mapping.environmentId}`,
    `ZONE: ${mapping.zone || 'whole_environment'}`,
    `MAPPING CONFIDENCE: ${Number(mapping.confidence || 0).toFixed(3)} (${mapping.reason || 'mapped'})`,
    environmentPrompt(environment),
    '',
    masterFrame
      ? `MASTER ENVIRONMENT REFERENCE: CANONICAL · sha256=${masterFrame.assetSha256 || 'unknown'} · preserve the same architecture, furniture identity, palette, materials, lighting logic, and spatial landmarks.`
      : 'MASTER ENVIRONMENT REFERENCE: not canonical yet; do not fabricate fixed placement that is not supported by the Environment Bible.',
    '',
    'REQUIRED PROP LOCKS:',
    ...(required.length ? required.map(lock => lockPrompt(lock)) : ['none explicitly required']),
    optional.length ? 'OPTIONAL PROP LOCKS:' : '',
    ...optional.map(lock => lockPrompt(lock)),
    '',
    'ENVIRONMENT RULES:',
    '- this is the same persistent location whenever the Environment ID repeats;',
    '- preserve construction, material identity, palette, recurring landmarks, required furniture, and room relationships;',
    '- camera angle may change, but the location must not be redesigned between shots;',
    '- do not add random furniture or remove required props merely to make a composition novel;',
    '- zone changes inside the same Environment ID are camera/location subareas, not a new house/building;',
    '- characters may act inside the location, but must not replace or obscure the defining environment identity without story need.'
  ];
  return lines.filter(Boolean).join('\n').slice(0, 18000);
}

function enrichShot(shot = {}, mapping = null, environment = null, propLocks = [], masterFrame = null) {
  const fragment = buildEnvironmentPromptFragment(mapping, environment, propLocks, masterFrame);
  const basePrompt = String(shot.prompt || '').replace(/\n\nENVIRONMENT CONTINUITY V11\.7\.5:[\s\S]*$/m, '').trim();
  const prompt = `${basePrompt}\n\n${fragment}`.slice(0, 26000);
  const contextFingerprint = hash(JSON.stringify({
    version: VERSION,
    sceneId: shot.sceneId,
    shotId: shot.id,
    environmentId: mapping?.environmentId || null,
    environmentFingerprint: environment?.fingerprint || null,
    zone: mapping?.zone || null,
    mappingFingerprint: mapping?.fingerprint || null,
    masterAssetSha256: masterFrame?.assetSha256 || null,
    propLocks: propLocks.map(lock => ({ id: lock.id, fingerprint: lock.fingerprint, required: lock.required })),
    fragment
  }));
  const continuityNotes = [
    ...(Array.isArray(shot.continuityNotes) ? shot.continuityNotes : []),
    mapping?.environmentId ? `preserve Environment ID ${mapping.environmentId}` : 'environment mapping unresolved: do not invent persistent layout facts',
    mapping?.zone ? `preserve scene zone ${mapping.zone}` : null,
    masterFrame ? 'use canonical Master Environment as location identity anchor' : null,
    ...propLocks.filter(lock => lock.required === true).slice(0, 10).map(lock => `preserve required prop: ${lock.name}`)
  ].filter(Boolean);
  const background = mapping?.environmentId
    ? `same persistent environment ${mapping.environmentId}${mapping.zone ? `, zone ${mapping.zone}` : ''}; preserve architecture, materials, landmarks and required props across camera changes`
    : (shot.background || 'preserve explicit scene evidence only');
  const fingerprint = hash(JSON.stringify({
    baseFingerprint: shot.fingerprint || null,
    prompt,
    background,
    continuityNotes,
    contextFingerprint
  }));
  return {
    ...shot,
    prompt,
    background,
    continuityNotes,
    fingerprint,
    environmentId: mapping?.environmentId || null,
    environmentZone: mapping?.zone || null,
    environmentFingerprint: environment?.fingerprint || null,
    environmentMappingFingerprint: mapping?.fingerprint || null,
    environmentPromptFingerprint: contextFingerprint,
    masterEnvironmentPath: masterFrame?.masterFramePath || null,
    masterEnvironmentCanonical: Boolean(masterFrame),
    masterEnvironmentSha256: masterFrame?.assetSha256 || null,
    requiredPropLockIds: propLocks.filter(lock => lock.required === true).map(lock => lock.id)
  };
}

class EnvironmentPromptEnricherV11 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.ENVIRONMENT_PROMPT_ENRICHMENT_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  enrichProduction(production = {}, shotPlan = null, sceneEnvironmentPlan = null, environmentBible = null, propLocks = [], masterFrames = []) {
    if (!this.enabled || !shotPlan || !Array.isArray(shotPlan.shots) || !shotPlan.shots.length || !sceneEnvironmentPlan) return null;
    const mappingByScene = new Map((sceneEnvironmentPlan.mappings || []).map(item => [item.sceneId, item]));
    const shots = shotPlan.shots.map(shot => {
      const mapping = mappingByScene.get(shot.sceneId) || null;
      const environment = environmentById(environmentBible, mapping?.environmentId || null);
      const locks = locksFor(propLocks, mapping?.environmentId || null);
      const masterFrame = masterFor(masterFrames, mapping?.environmentId || null);
      return enrichShot(shot, mapping, environment, locks, masterFrame);
    });
    const enrichedById = new Map(shots.map(shot => [shot.id, shot]));
    const scenes = (shotPlan.scenes || []).map(scenePlan => ({
      ...scenePlan,
      shots: (scenePlan.shots || []).map(shot => enrichedById.get(shot.id) || shot)
    }));
    const fingerprint = hash(JSON.stringify({
      version: VERSION,
      productionId: production.id || null,
      shotPlanFingerprint: shotPlan.fingerprint || null,
      sceneEnvironmentFingerprint: sceneEnvironmentPlan.fingerprint || null,
      environments: shots.map(shot => ({ id: shot.id, fingerprint: shot.environmentPromptFingerprint }))
    }));
    const result = {
      version: VERSION,
      productionId: production.id || null,
      fingerprint,
      shotPlanFingerprint: shotPlan.fingerprint || null,
      sceneEnvironmentFingerprint: sceneEnvironmentPlan.fingerprint || null,
      shots,
      scenes,
      summary: {
        shotCount: shots.length,
        mappedShotCount: shots.filter(shot => Boolean(shot.environmentId)).length,
        unresolvedShotCount: shots.filter(shot => !shot.environmentId).length,
        masterBackedShotCount: shots.filter(shot => shot.masterEnvironmentCanonical).length,
        requiredPropReferences: shots.reduce((sum, shot) => sum + (shot.requiredPropLockIds || []).length, 0)
      },
      createdAt: new Date().toISOString()
    };
    this.logger.info(`Environment Prompt Enricher v11.7.5 enriched ${result.summary.mappedShotCount}/${result.summary.shotCount} shot(s); master-backed=${result.summary.masterBackedShotCount}.`);
    return result;
  }
}

module.exports = {
  ENVIRONMENT_PROMPT_ENRICHER_VERSION: VERSION,
  EnvironmentPromptEnricherV11,
  environmentById,
  locksFor,
  masterFor,
  buildEnvironmentPromptFragment,
  enrichShot
};
