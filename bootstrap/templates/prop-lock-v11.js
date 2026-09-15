'use strict';

const crypto = require('crypto');

const VERSION = '11.7.2';

function clean(value, limit = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slug(value) {
  return clean(value, 120).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'prop';
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function unique(values, limit = 40) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const value = clean(raw, 240);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

const PROP_DEFINITIONS = [
  { name: 'sofa', type: 'furniture', movable: true, pattern: /\b(sofa|couch)\b/i },
  { name: 'coffee table', type: 'furniture', movable: true, pattern: /\b(coffee table|mesa de centro)\b/i },
  { name: 'table', type: 'furniture', movable: true, pattern: /\b(table|mesa)\b/i },
  { name: 'bookshelf', type: 'furniture', movable: false, pattern: /\b(bookshelf|bookcase|estante|prateleira)\b/i },
  { name: 'chair', type: 'furniture', movable: true, pattern: /\b(chair|cadeira)\b/i },
  { name: 'rug', type: 'furniture', movable: true, pattern: /\b(rug|carpet|tapete)\b/i },
  { name: 'lamp', type: 'fixture', movable: true, pattern: /\b(lamp|luminaria|luminária)\b/i },
  { name: 'cabinet', type: 'fixture', movable: false, pattern: /\b(cabinet|cupboard|armario|armário)\b/i },
  { name: 'bed', type: 'furniture', movable: false, pattern: /\b(bed|cama)\b/i },
  { name: 'window', type: 'architectural_fixture', movable: false, pattern: /\b(window|janela)\b/i },
  { name: 'door', type: 'architectural_fixture', movable: false, pattern: /\b(door|porta)\b/i },
  { name: 'counter', type: 'fixture', movable: false, pattern: /\b(counter|balcao|balcão)\b/i },
  { name: 'shelf', type: 'fixture', movable: false, pattern: /\b(shelf|shelves|prateleira)\b/i },
  { name: 'slide', type: 'landmark', movable: false, pattern: /\b(slide|escorregador)\b/i },
  { name: 'climbing structure', type: 'landmark', movable: false, pattern: /\b(climbing structure|climbing frame|trepa[- ]trepa)\b/i },
  { name: 'garden path', type: 'landmark', movable: false, pattern: /\b(garden path|walking path|path|caminho)\b/i },
  { name: 'flower bed', type: 'landmark', movable: false, pattern: /\b(flower bed|flower beds|canteiro)\b/i },
  { name: 'tree cluster', type: 'landmark', movable: false, pattern: /\b(tree cluster|trees|arvores|árvores)\b/i },
  { name: 'main seating area', type: 'zone_anchor', movable: false, pattern: /\b(main seating area|seating area)\b/i },
  { name: 'storage', type: 'zone_anchor', movable: false, pattern: /\b(storage|storage area)\b/i },
  { name: 'open play area', type: 'zone_anchor', movable: false, pattern: /\b(open play area|play area)\b/i },
  { name: 'open sky', type: 'environment_anchor', movable: false, pattern: /\b(open sky|sky)\b/i }
];

const COLORS = [
  ['beige', /\bbeige\b/i], ['cream', /\b(cream|creme)\b/i], ['brown', /\b(brown|marrom)\b/i],
  ['white', /\b(white|branc[oa])\b/i], ['black', /\b(black|pret[oa])\b/i], ['red', /\b(red|vermelh[oa])\b/i],
  ['blue', /\b(blue|azul)\b/i], ['yellow', /\b(yellow|amarel[oa])\b/i], ['green', /\b(green|verde)\b/i],
  ['olive green', /\b(olive green|verde oliva)\b/i]
];

const MATERIALS = [
  ['natural wood', /\b(wooden|wood|timber|madeira)\b/i], ['soft fabric', /\b(fabric|linen|cotton|tecido|linho|algodao|algodão)\b/i],
  ['matte metal', /\b(metal|steel|iron|ferro)\b/i], ['glass', /\b(glass|vidro)\b/i], ['stone', /\b(stone|pedra)\b/i],
  ['ceramic', /\b(ceramic|ceramica|cerâmica)\b/i]
];

function definitionFor(value) {
  const text = clean(value, 240);
  return PROP_DEFINITIONS.find(definition => definition.pattern.test(text)) || null;
}

function canonicalName(value) {
  return definitionFor(value)?.name || clean(value, 120).toLowerCase() || 'prop';
}

function evidenceText(environment = {}) {
  return (environment.sourceEvidence || []).map(item => clean(item?.text, 1200)).filter(Boolean).join(' ');
}

function sourceTypeFor(environment = {}, definition, rawName) {
  for (const item of environment.sourceEvidence || []) {
    const text = clean(item?.text, 1600);
    if (!text) continue;
    const matched = definition ? definition.pattern.test(text) : text.toLowerCase().includes(clean(rawName, 120).toLowerCase());
    if (matched) return item.source || 'production_text';
  }
  return 'inferred_default';
}

function nearbyWindow(text, definition, rawName) {
  const source = String(text || '');
  let match = definition ? source.match(definition.pattern) : null;
  if (!match && rawName) {
    const needle = clean(rawName, 120);
    const index = source.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) return source.slice(Math.max(0, index - 80), Math.min(source.length, index + needle.length + 100));
  }
  if (!match || typeof match.index !== 'number') return '';
  return source.slice(Math.max(0, match.index - 80), Math.min(source.length, match.index + match[0].length + 100));
}

function detectColor(text) {
  for (const [label, pattern] of COLORS) if (pattern.test(text)) return label;
  return null;
}

function detectMaterial(text, environment = {}, definition = null) {
  for (const [label, pattern] of MATERIALS) if (pattern.test(text)) return label;
  const materials = Array.isArray(environment.materials) ? environment.materials : [];
  if (!definition) return null;
  if (['table', 'coffee table', 'bookshelf', 'cabinet', 'shelf', 'door', 'counter'].includes(definition.name) && materials.includes('natural wood')) return 'natural wood';
  if (['sofa', 'rug', 'bed'].includes(definition.name) && materials.includes('soft fabric')) return 'soft fabric';
  return null;
}

function priorityFor(sourceType, definition) {
  if (sourceType === 'explicit_instruction') return 'critical';
  if (sourceType === 'production_text') return definition?.movable === false ? 'high' : 'medium';
  return ['architectural_fixture', 'landmark'].includes(definition?.type) ? 'medium' : 'low';
}

function buildLock(environment, rawName, index = 0) {
  const definition = definitionFor(rawName);
  const name = canonicalName(rawName);
  const evidence = evidenceText(environment);
  const localEvidence = nearbyWindow(evidence, definition, rawName);
  const sourceType = sourceTypeFor(environment, definition, rawName);
  const explicit = sourceType === 'explicit_instruction' || sourceType === 'production_text';
  const type = definition?.type || 'prop';
  const movable = definition?.movable !== false;
  const color = detectColor(localEvidence);
  const material = detectMaterial(localEvidence, environment, definition);
  const lockedAttributes = {
    identity: name,
    type,
    color,
    material,
    silhouette: 'preserve the same recognizable form and proportions once visually established',
    relativePlacement: movable
      ? 'preserve the established room/zone relationship unless the story explicitly moves this prop'
      : 'preserve the established location and orientation in the environment',
    environmentStyle: environment.architecturalStyle || null
  };
  const forbiddenChanges = unique([
    `do not replace ${name} with a different object`,
    color ? `do not change the ${name} color away from ${color} without an explicit story event` : '',
    material ? `do not change the ${name} material away from ${material} without an explicit story event` : '',
    movable ? `do not teleport ${name} to an unrelated location between adjacent shots` : `do not move or rotate the fixed ${name} between adjacent shots`,
    'do not silently remove a required prop from a shot where it should remain visible'
  ]);
  const allowedChanges = movable
    ? ['camera-relative scale or perspective may change', 'minor occlusion is allowed', 'story-driven movement is allowed only when explicitly described']
    : ['camera-relative scale or perspective may change', 'minor occlusion is allowed'];
  const stable = {
    environmentId: environment.environmentId,
    name,
    type,
    required: explicit,
    continuityPriority: priorityFor(sourceType, definition),
    lockedAttributes,
    sourceType
  };
  const fingerprint = hash(JSON.stringify(stable));
  return {
    version: VERSION,
    id: `prop_${slug(environment.environmentId)}_${slug(name)}_${fingerprint.slice(0, 8)}`,
    environmentId: environment.environmentId,
    environmentName: environment.name || environment.category || environment.environmentId,
    name,
    originalName: clean(rawName, 160),
    type,
    required: explicit,
    continuityPriority: priorityFor(sourceType, definition),
    description: localEvidence || `${name} in ${environment.name || environment.category || 'environment'}`,
    lockedAttributes,
    allowedChanges,
    forbiddenChanges,
    sourceType,
    sourceEvidence: localEvidence || null,
    placementStatus: environment.masterFramePath ? 'anchored_to_master_frame' : 'unanchored_until_master_frame',
    masterFramePath: environment.masterFramePath || null,
    status: 'locked_identity',
    fingerprint,
    order: index
  };
}

function lockPrompt(lock = {}) {
  if (!lock?.id) return '';
  const attributes = lock.lockedAttributes || {};
  return [
    `PROP LOCK: ${lock.name} [${lock.id}]`,
    `REQUIRED: ${lock.required === true ? 'yes' : 'no'}; PRIORITY: ${lock.continuityPriority || 'medium'}; TYPE: ${lock.type || 'prop'}`,
    `COLOR: ${attributes.color || 'preserve once visually established'}`,
    `MATERIAL: ${attributes.material || 'preserve once visually established'}`,
    `FORM: ${attributes.silhouette || 'preserve identity'}`,
    `PLACEMENT: ${attributes.relativePlacement || 'preserve placement'}`,
    `FORBIDDEN: ${(lock.forbiddenChanges || []).join('; ')}`
  ].join('\n');
}

function planPromptContext(plan = {}) {
  if (!plan || !Array.isArray(plan.locks) || !plan.locks.length) return '';
  const byEnvironment = new Map();
  for (const lock of plan.locks) {
    if (!byEnvironment.has(lock.environmentId)) byEnvironment.set(lock.environmentId, []);
    byEnvironment.get(lock.environmentId).push(lock);
  }
  const blocks = ['PROP LOCK SERVICE V11.7.2:'];
  for (const [environmentId, locks] of byEnvironment.entries()) {
    blocks.push(`ENVIRONMENT ${environmentId}:`);
    for (const lock of locks) blocks.push(lockPrompt(lock));
  }
  blocks.push('Do not invent a new identity for locked props. Master-frame placement anchoring begins in Phase 11.7.3.');
  return blocks.join('\n');
}

class PropLockV11 {
  constructor(options = {}) {
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PROP_LOCK_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.maxPerEnvironment = Math.max(1, Math.min(64, Number(options.maxPerEnvironment ?? process.env.PROP_LOCK_MAX_PER_ENVIRONMENT ?? 24) || 24));
  }

  buildProductionLocks(production = {}, environmentBible = null) {
    if (!this.enabled || !environmentBible || !Array.isArray(environmentBible.environments) || !environmentBible.environments.length) return null;
    const locks = [];
    for (const environment of environmentBible.environments) {
      const rawProps = unique(environment.signatureElements || [], this.maxPerEnvironment);
      const seen = new Set();
      let index = 0;
      for (const rawName of rawProps) {
        const lock = buildLock(environment, rawName, index);
        const key = `${lock.environmentId}:${lock.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        locks.push(lock);
        index += 1;
      }
    }
    if (!locks.length) return null;
    const stable = locks.map(lock => ({
      environmentId: lock.environmentId,
      name: lock.name,
      type: lock.type,
      required: lock.required,
      continuityPriority: lock.continuityPriority,
      lockedAttributes: lock.lockedAttributes,
      sourceType: lock.sourceType,
      fingerprint: lock.fingerprint
    }));
    const fingerprint = hash(JSON.stringify({ environmentBibleFingerprint: environmentBible.fingerprint, locks: stable }));
    const plan = {
      version: VERSION,
      productionId: production.id || environmentBible.productionId || null,
      environmentBibleFingerprint: environmentBible.fingerprint || null,
      fingerprint,
      locks,
      summary: {
        environmentCount: new Set(locks.map(lock => lock.environmentId)).size,
        lockCount: locks.length,
        requiredCount: locks.filter(lock => lock.required).length,
        criticalCount: locks.filter(lock => lock.continuityPriority === 'critical').length,
        inferredCount: locks.filter(lock => lock.sourceType === 'inferred_default').length,
        placementAnchoredCount: locks.filter(lock => lock.placementStatus === 'anchored_to_master_frame').length
      },
      createdAt: new Date().toISOString()
    };
    plan.promptContext = planPromptContext(plan);
    for (const lock of plan.locks) lock.planFingerprint = fingerprint;
    return plan;
  }

  forEnvironment(plan, environmentId) {
    if (!plan || !Array.isArray(plan.locks)) return [];
    return plan.locks.filter(lock => lock.environmentId === environmentId);
  }

  promptForEnvironment(plan, environmentId) {
    return this.forEnvironment(plan, environmentId).map(lockPrompt).filter(Boolean).join('\n');
  }
}

module.exports = { VERSION, PropLockV11, PROP_DEFINITIONS, canonicalName, buildLock, lockPrompt, planPromptContext };
