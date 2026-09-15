'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.10.6';

function clean(value, limit = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 12000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function pathExists(filePath) {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

function mimeForPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(item => typeof item === 'string' ? item : (item?.text || item?.content || '')).join('\n');
  if (content && typeof content === 'object') return content.text || content.content || JSON.stringify(content);
  return '';
}

function extractJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  let text = String(value || '').trim();
  if (!text) return null;
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch (_error) { return null; }
}

function visibleBindings(bindings = []) {
  return (Array.isArray(bindings) ? bindings : []).filter(row =>
    row?.status === 'resolved' && row.objectId && ['visible', 'occluded'].includes(row.visibility)
  );
}

function stateSummary(state = null) {
  if (!state) return { active: false, summary: 'neutral / no state row', appearanceChangeExpected: false };
  const parts = [
    state.condition && `condition=${state.condition}`,
    Array.isArray(state.damage) && state.damage.length && `damage=${state.damage.join(', ')}`,
    state.cleanliness && `cleanliness=${state.cleanliness}`,
    state.openness && `open_state=${state.openness}`,
    state.operationalState && `operational=${state.operationalState}`,
    Array.isArray(state.contents) && state.contents.length && `contents=${state.contents.join(', ')}`,
    state.holderKey && `holder=${state.holderKey}`,
    state.placement && `placement=${state.placement}`,
    Array.isArray(state.storyState) && state.storyState.length && `story_state=${state.storyState.join(', ')}`
  ].filter(Boolean);
  return {
    active: state.status === 'active' || parts.length > 0,
    summary: parts.length ? parts.join('; ') : (state.status || 'neutral'),
    appearanceChangeExpected: Boolean(parts.length)
  };
}

function buildObjectContinuityPrompt({ object = {}, binding = {}, state = null, canonicalAsset = {} } = {}) {
  const identity = object.canonicalIdentity || {};
  const stateInfo = stateSummary(state);
  return [
    `CROSS-VIDEO OBJECT CONTINUITY GATE V${VERSION}`,
    'You receive TWO images in order: IMAGE 1 is the canonical reference for one persistent story-world object; IMAGE 2 is the newly generated full scene/keyframe.',
    'Judge ONLY whether that exact persistent object is visibly present in IMAGE 2 and still has the same canonical identity.',
    'Do not compare scene composition, camera angle, crop, scale, background, lighting, pose, or unrelated objects as identity evidence.',
    binding.visibility === 'occluded'
      ? 'The binding allows partial occlusion: the object may be only partly visible, but visible identity cues must still be consistent.'
      : 'The binding requires the object to be visibly identifiable in the generated frame.',
    '',
    `OBJECT ID: ${object.id || binding.objectId || 'unknown'}`,
    `OBJECT KEY: ${object.objectKey || binding.objectKey || 'unknown'}`,
    `NAME: ${object.displayName || 'unknown'}`,
    `TYPE: ${object.objectType || identity.objectType || 'object'}`,
    `BRAND/MODEL: ${identity.brand || 'unspecified'} / ${identity.model || 'unspecified'}`,
    `CANONICAL COLOR/MATERIAL: ${identity.color || 'unspecified'} / ${identity.material || 'unspecified'}`,
    `CANONICAL FORM: ${identity.silhouette || 'preserve recognizable form/proportions'}`,
    `DISTINGUISHING MARKS: ${(identity.distinguishingMarks || []).join(', ') || 'none specified'}`,
    `BINDING: visibility=${binding.visibility}; interaction=${binding.interaction || 'none'}; holder=${binding.holderKey || 'none'}; placement=${binding.placement || 'unspecified'}`,
    `CURRENT LIFECYCLE STATE: ${stateInfo.summary}`,
    `CANONICAL ASSET SHA256: ${canonicalAsset.assetSha256 || binding.canonicalAssetSha256 || 'unknown'}`,
    '',
    'Lifecycle state may legitimately change damage, cleanliness, open/closed state, contents, holder/use, placement, operational/story state. Treat those as overlays, not a new object identity.',
    'Canonical identity must still preserve object type, recognizable form/silhouette, brand/model when specified, canonical base color/material when not explicitly overridden by state, and distinguishing marks.',
    '',
    'Return ONLY one JSON object with this exact top-level contract:',
    '{',
    '  "objectPresent": true|false,',
    '  "sameCanonicalObject": true|false,',
    '  "canonicalIdentityConsistent": true|false,',
    '  "stateConsistent": true|false|null,',
    '  "confidence": 0.0-1.0,',
    '  "identityMismatches": ["short visible mismatch reason"],',
    '  "notes": "short visible evidence only"',
    '}',
    '',
    'Rules:',
    '- objectPresent=true only when the bound object is visibly identifiable in IMAGE 2;',
    '- sameCanonicalObject=false when IMAGE 2 shows a different same-type object or replacement;',
    '- canonicalIdentityConsistent=false for visible canonical identity drift;',
    '- stateConsistent checks the declared lifecycle overlay only; use null when no visual state judgment is possible;',
    '- confidence must reflect visible evidence, not filenames, prompt text, metadata, or assumptions;',
    '- never mark mismatch merely because framing, background, camera, scale, pose, or illumination differs.'
  ].join('\n').slice(0, 24000);
}

function normalizeVisionResponse(payload = {}, minConfidence = 0.72) {
  const contractValid = typeof payload.objectPresent === 'boolean' &&
    typeof payload.sameCanonicalObject === 'boolean' &&
    typeof payload.canonicalIdentityConsistent === 'boolean' &&
    (payload.stateConsistent === null || typeof payload.stateConsistent === 'boolean' || payload.stateConsistent === undefined) &&
    Number.isFinite(Number(payload.confidence)) && Array.isArray(payload.identityMismatches);
  const confidence = clamp01(payload.confidence);
  const identityMismatches = Array.isArray(payload.identityMismatches) ? payload.identityMismatches.map(item => clean(item, 300)).filter(Boolean).slice(0, 16) : [];
  const canonicalIdentityConsistent = payload.canonicalIdentityConsistent === true && identityMismatches.length === 0;
  return {
    contractValid,
    objectPresent: payload.objectPresent === true,
    sameCanonicalObject: payload.sameCanonicalObject === true,
    canonicalIdentityConsistent,
    stateConsistent: payload.stateConsistent == null ? null : payload.stateConsistent === true,
    confidence,
    identityMismatches,
    notes: clean(payload.notes || '', 1200),
    verified: Boolean(contractValid && payload.objectPresent === true && payload.sameCanonicalObject === true && canonicalIdentityConsistent && payload.stateConsistent !== false && confidence >= minConfidence)
  };
}

function visionDecision(result = null, options = {}) {
  const requireVision = options.requireVision === true;
  const requiredBinding = options.requiredBinding !== false;
  if (!result) return { accepted: !requireVision, verified: false, status: requireVision ? 'vision_required' : 'vision_unavailable', reasons: requireVision ? ['CROSS_VIDEO_OBJECT_VISION_REQUIRED'] : [] };
  if (!result.contractValid) return { accepted: !requireVision, verified: false, status: requireVision ? 'invalid_response' : 'vision_unverified', reasons: requireVision ? ['CROSS_VIDEO_OBJECT_INVALID_VISION_RESPONSE'] : [] };
  const reasons = [];
  if (requiredBinding && result.objectPresent === false) reasons.push('CROSS_VIDEO_OBJECT_MISSING');
  if (result.sameCanonicalObject === false) reasons.push('CROSS_VIDEO_OBJECT_REPLACED');
  if (result.canonicalIdentityConsistent === false) reasons.push('CROSS_VIDEO_OBJECT_IDENTITY_DRIFT');
  if (result.stateConsistent === false) reasons.push('CROSS_VIDEO_OBJECT_STATE_DRIFT');
  if (reasons.length) return { accepted: false, verified: false, status: 'blocked', reasons };
  if (result.confidence < Number(options.minConfidence || 0.72)) {
    return { accepted: !requireVision, verified: false, status: requireVision ? 'confidence_below_threshold' : 'vision_unverified', reasons: requireVision ? ['CROSS_VIDEO_OBJECT_CONFIDENCE_BELOW_THRESHOLD'] : [] };
  }
  return { accepted: true, verified: true, status: 'verified', reasons: [] };
}

class CrossVideoObjectContinuityGateV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.CROSS_VIDEO_OBJECT_CONTINUITY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireCanonicalAsset = String(options.requireCanonicalAsset ?? process.env.CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_CANONICAL_ASSET ?? 'true').toLowerCase() !== 'false';
    const localStrict = String(options.requireVision ?? process.env.CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_VISION ?? 'false').toLowerCase() === 'true';
    const globalStrict = String(process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';
    this.requireVision = localStrict || globalStrict;
    const threshold = Number(options.minConfidence ?? process.env.CROSS_VIDEO_OBJECT_CONTINUITY_MIN_CONFIDENCE ?? process.env.SEMANTIC_PROP_MIN_CONFIDENCE ?? 0.72);
    this.minConfidence = Number.isFinite(threshold) ? Math.max(0.5, Math.min(0.98, threshold)) : 0.72;
    this.baseURL = clean(options.baseURL ?? process.env.CROSS_VIDEO_OBJECT_VISION_BASE_URL ?? process.env.SEMANTIC_PROP_VISION_BASE_URL ?? '', 1000).replace(/\/+$/, '');
    this.model = clean(options.model ?? process.env.CROSS_VIDEO_OBJECT_VISION_MODEL ?? process.env.SEMANTIC_PROP_VISION_MODEL ?? '', 300);
    this.apiKey = String(options.apiKey ?? process.env.CROSS_VIDEO_OBJECT_VISION_API_KEY ?? process.env.SEMANTIC_PROP_VISION_API_KEY ?? '').trim();
    const timeout = Number(options.timeoutMs ?? process.env.CROSS_VIDEO_OBJECT_VISION_TIMEOUT_MS ?? process.env.SEMANTIC_PROP_VISION_TIMEOUT_MS ?? 30000);
    this.timeoutMs = Number.isFinite(timeout) ? Math.max(3000, Math.min(120000, timeout)) : 30000;
    this.analyzer = typeof options.analyzer === 'function' ? options.analyzer : null;
    this.pathExists = options.pathExists || pathExists;
  }

  providerAvailable() {
    return Boolean(this.analyzer || (this.baseURL && this.model));
  }

  async callProvider(referencePath, candidatePath, prompt) {
    if (this.analyzer) {
      const payload = await this.analyzer({ referencePath, candidatePath, prompt, model: this.model || 'injected-analyzer' });
      return { payload, providerUsed: true, providerMode: 'injected-analyzer', model: this.model || 'injected-analyzer' };
    }
    if (!this.baseURL || !this.model) return { payload: null, providerUsed: false, providerMode: 'unconfigured', model: this.model || null };
    const [referenceBytes, candidateBytes] = await Promise.all([fs.readFile(referencePath), fs.readFile(candidatePath)]);
    const referenceURL = `data:${mimeForPath(referencePath)};base64,${referenceBytes.toString('base64')}`;
    const candidateURL = `data:${mimeForPath(candidatePath)};base64,${candidateBytes.toString('base64')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { 'content-type': 'application/json' };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: referenceURL } },
            { type: 'image_url', image_url: { url: candidateURL } }
          ] }]
        })
      });
      const rawText = await response.text();
      if (!response.ok) throw new Error(`Vision provider HTTP ${response.status}: ${clean(rawText, 1000)}`);
      const envelope = extractJson(rawText) || JSON.parse(rawText);
      const rawContent = envelope?.choices?.[0]?.message?.content ?? envelope?.message?.content ?? envelope?.response ?? envelope;
      return { payload: extractJson(contentText(rawContent)) || (rawContent && typeof rawContent === 'object' ? rawContent : null), providerUsed: true, providerMode: 'openai-compatible-vision', model: this.model };
    } finally {
      clearTimeout(timer);
    }
  }

  async contextFor(productionId, shotId) {
    const bindings = this.db?.listShotPersistentWorldObjectBindings ? await this.db.listShotPersistentWorldObjectBindings(productionId, shotId) : [];
    return { bindings: visibleBindings(bindings) };
  }

  async persist(input, binding, object, asset, state, result) {
    if (!this.db?.saveCrossVideoObjectContinuityCheck) return result;
    return this.db.saveCrossVideoObjectContinuityCheck({
      productionId: input.productionId,
      sceneId: input.sceneId,
      shotId: input.keyframe?.shotId,
      keyframeId: input.keyframe?.id,
      bindingId: binding?.id || null,
      objectId: binding?.objectId || object?.id || null,
      canonicalAssetId: asset?.id || binding?.canonicalAssetId || null,
      canonicalAssetPath: asset?.assetPath || null,
      canonicalAssetSha256: asset?.assetSha256 || binding?.canonicalAssetSha256 || null,
      canonicalSourceProductionId: asset?.sourceProductionId || object?.createdFromProductionId || null,
      currentProductionId: input.productionId,
      reusedAcrossVideos: result.reusedAcrossVideos === true,
      stateId: state?.id || binding?.stateId || null,
      stateFingerprint: state?.stateFingerprint || binding?.stateFingerprint || null,
      version: VERSION,
      attempt: input.attempt || 0,
      status: result.status,
      accepted: result.accepted,
      requiredBinding: binding?.required !== false,
      visibility: binding?.visibility || null,
      providerUsed: result.providerUsed === true,
      providerMode: result.providerMode || null,
      model: result.model || null,
      visionConfidence: result.visionConfidence || 0,
      objectPresent: result.objectPresent,
      sameCanonicalObject: result.sameCanonicalObject,
      canonicalIdentityConsistent: result.canonicalIdentityConsistent,
      stateConsistent: result.stateConsistent,
      reasons: result.reasons || [],
      identityMismatches: result.identityMismatches || [],
      promptFingerprint: result.promptFingerprint || null,
      responseFingerprint: result.responseFingerprint || null,
      notes: result.notes || null
    });
  }

  async evaluateBinding(input, binding) {
    const object = this.db?.getPersistentWorldObject ? await this.db.getPersistentWorldObject(binding.objectId) : null;
    if (!object?.id) {
      const result = { version: VERSION, active: true, accepted: false, status: 'object_unresolved', reusedAcrossVideos: false, reasons: ['CROSS_VIDEO_OBJECT_UNRESOLVED'] };
      await this.persist(input, binding, object, null, null, result);
      return result;
    }
    const reusedAcrossVideos = Boolean(object.reusedAcrossVideos === true || (object.createdFromProductionId && object.createdFromProductionId !== input.productionId));
    const state = binding.stateId && this.db?.getPersistentWorldObjectState ? await this.db.getPersistentWorldObjectState(binding.stateId) : null;
    let asset = binding.canonicalAssetId && this.db?.getPersistentWorldObjectAsset ? await this.db.getPersistentWorldObjectAsset(binding.canonicalAssetId) : null;
    if (!asset && this.db?.getPersistentWorldObjectAssetByObject) asset = await this.db.getPersistentWorldObjectAssetByObject(object.id, 'object_reference');

    if (!reusedAcrossVideos) {
      const result = { version: VERSION, active: true, accepted: true, status: 'origin_production', reusedAcrossVideos: false, reasons: [], visionConfidence: 1, objectPresent: true, sameCanonicalObject: true, canonicalIdentityConsistent: true, stateConsistent: null };
      await this.persist(input, binding, object, asset, state, result);
      return result;
    }

    if (!asset?.assetPath || !await this.pathExists(asset.assetPath)) {
      const accepted = !this.requireCanonicalAsset;
      const result = { version: VERSION, active: true, accepted, status: accepted ? 'skipped_no_canonical_asset' : 'canonical_asset_missing', reusedAcrossVideos: true, reasons: accepted ? [] : ['CROSS_VIDEO_OBJECT_CANONICAL_ASSET_MISSING'], visionConfidence: 0 };
      await this.persist(input, binding, object, asset, state, result);
      return result;
    }

    if (!this.providerAvailable()) {
      const accepted = !this.requireVision;
      const result = { version: VERSION, active: true, accepted, status: accepted ? 'vision_unavailable' : 'vision_required', reusedAcrossVideos: true, reasons: accepted ? [] : ['CROSS_VIDEO_OBJECT_VISION_REQUIRED'], providerUsed: false, providerMode: 'unconfigured', model: this.model || null, visionConfidence: 0 };
      await this.persist(input, binding, object, asset, state, result);
      return result;
    }

    const prompt = buildObjectContinuityPrompt({ object, binding, state, canonicalAsset: asset });
    const promptFingerprint = hash(prompt);
    try {
      const call = await this.callProvider(asset.assetPath, input.assetPath, prompt);
      const normalized = normalizeVisionResponse(call.payload || {}, this.minConfidence);
      const decision = visionDecision(normalized, { requireVision: this.requireVision, requiredBinding: binding.required !== false, minConfidence: this.minConfidence });
      const result = {
        version: VERSION,
        active: true,
        accepted: decision.accepted,
        status: decision.status,
        reusedAcrossVideos: true,
        providerUsed: call.providerUsed,
        providerMode: call.providerMode,
        model: call.model,
        visionConfidence: normalized.confidence,
        objectPresent: normalized.objectPresent,
        sameCanonicalObject: normalized.sameCanonicalObject,
        canonicalIdentityConsistent: normalized.canonicalIdentityConsistent,
        stateConsistent: normalized.stateConsistent,
        reasons: [...decision.reasons, ...normalized.identityMismatches.map(() => 'CROSS_VIDEO_OBJECT_IDENTITY_MISMATCH_EVIDENCE')].filter((value, index, array) => array.indexOf(value) === index),
        identityMismatches: normalized.identityMismatches,
        notes: normalized.notes,
        promptFingerprint,
        responseFingerprint: hash(JSON.stringify(normalized))
      };
      await this.persist(input, binding, object, asset, state, result);
      return result;
    } catch (error) {
      const accepted = !this.requireVision;
      const result = { version: VERSION, active: true, accepted, status: accepted ? 'vision_provider_error' : 'blocked_provider_error', reusedAcrossVideos: true, providerUsed: true, providerMode: this.analyzer ? 'injected-analyzer' : 'openai-compatible-vision', model: this.model || null, visionConfidence: 0, reasons: accepted ? [] : ['CROSS_VIDEO_OBJECT_VISION_PROVIDER_ERROR'], notes: clean(error.message || error, 1200), promptFingerprint };
      await this.persist(input, binding, object, asset, state, result);
      return result;
    }
  }

  async evaluate(input = {}) {
    const { productionId, sceneId, keyframe, assetPath } = input;
    if (!productionId || !sceneId || !keyframe?.id || !keyframe?.shotId || !assetPath) throw new Error('Cross-video object continuity evaluation requires productionId, sceneId, keyframe with shotId, and assetPath');
    if (!this.enabled) return { version: VERSION, active: false, accepted: true, status: 'disabled', checks: [], reasons: [] };
    const context = await this.contextFor(productionId, keyframe.shotId);
    if (!context.bindings.length) return { version: VERSION, active: true, accepted: true, status: 'no_visible_object_bindings', checks: [], reasons: [] };
    const checks = [];
    for (const binding of context.bindings) checks.push({ binding, result: await this.evaluateBinding(input, binding) });
    const blocked = checks.filter(item => !item.result.accepted);
    const reasons = [...new Set(blocked.flatMap(item => item.result.reasons || []))];
    const result = { version: VERSION, active: true, accepted: blocked.length === 0, status: blocked.length ? 'blocked' : 'accepted', checks, reasons, summary: { total: checks.length, accepted: checks.length - blocked.length, blocked: blocked.length, reused: checks.filter(item => item.result.reusedAcrossVideos).length } };
    this.logger[blocked.length ? 'warn' : 'info'](`Cross-Video Object Continuity v${VERSION} ${blocked.length ? 'blocked' : 'accepted'} ${keyframe.id}: ${result.summary.accepted}/${result.summary.total} object check(s) accepted.`);
    return result;
  }
}

module.exports = {
  CROSS_VIDEO_OBJECT_CONTINUITY_VERSION: VERSION,
  CrossVideoObjectContinuityGateV11,
  visibleBindings,
  stateSummary,
  buildObjectContinuityPrompt,
  normalizeVisionResponse,
  visionDecision,
  extractJson,
  mimeForPath,
  pathExists
};