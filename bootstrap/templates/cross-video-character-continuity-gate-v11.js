'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.11.6';

function clean(value, limit = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
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
function visibleCharacterBindings(bindings = []) {
  return (Array.isArray(bindings) ? bindings : []).filter(row =>
    row?.status === 'resolved' && row.characterId && ['visible', 'occluded'].includes(row.visibility)
  );
}
function appearanceStateSummary(state = null) {
  if (!state) return { active: false, summary: 'neutral / no appearance-state row', appearanceChangeExpected: false };
  const parts = [
    state.wardrobe && `wardrobe=${state.wardrobe}`,
    state.footwear && `footwear=${state.footwear}`,
    state.hairState && `hair=${state.hairState}`,
    state.condition && `condition=${state.condition}`,
    state.cleanliness && `cleanliness=${state.cleanliness}`,
    state.ageAppearance && `age_appearance=${state.ageAppearance}`,
    Array.isArray(state.injuries) && state.injuries.length && `injuries=${state.injuries.join(', ')}`,
    Array.isArray(state.carriedItems) && state.carriedItems.length && `carried_items=${state.carriedItems.join(', ')}`,
    Array.isArray(state.temporaryAccessories) && state.temporaryAccessories.length && `temporary_accessories=${state.temporaryAccessories.join(', ')}`,
    Array.isArray(state.appearanceNotes) && state.appearanceNotes.length && `appearance_notes=${state.appearanceNotes.join(', ')}`,
    Array.isArray(state.storyState) && state.storyState.length && `story_state=${state.storyState.join(', ')}`
  ].filter(Boolean);
  return {
    active: state.status === 'active' || parts.length > 0,
    summary: parts.length ? parts.join('; ') : (state.status || 'neutral'),
    appearanceChangeExpected: Boolean(parts.length)
  };
}
function buildCharacterContinuityPrompt({ character = {}, binding = {}, state = null, canonicalAsset = {} } = {}) {
  const identity = character.canonicalIdentity || {};
  const stateInfo = appearanceStateSummary(state);
  return [
    `CROSS-VIDEO CHARACTER CONTINUITY GATE V${VERSION}`,
    'You receive TWO images in order: IMAGE 1 is the canonical reference for one persistent story character; IMAGE 2 is the newly generated full scene/keyframe.',
    'Judge ONLY whether that exact persistent character is visibly present in IMAGE 2 and still has the same canonical identity.',
    'Do not compare scene composition, camera angle, crop, scale, background, lighting, pose, action, expression, or unrelated characters as identity evidence.',
    binding.visibility === 'occluded'
      ? 'The binding allows partial occlusion: the character may be partly hidden, but visible identity cues must still be consistent.'
      : 'The binding requires the character to be visibly identifiable in the generated frame.',
    '',
    `CHARACTER ID: ${character.id || binding.characterId || 'unknown'}`,
    `CHARACTER KEY: ${character.characterKey || binding.characterKey || 'unknown'}`,
    `NAME: ${character.displayName || 'unknown'}`,
    `SPECIES/TYPE: ${character.speciesType || identity.speciesType || 'character'}`,
    `CANONICAL DESIGN: ${identity.descriptor || 'preserve established design'}`,
    `CANONICAL PALETTE: ${(identity.palette || []).join(' / ') || 'preserve established colors'}`,
    `CANONICAL PROPORTIONS: ${identity.proportions || 'preserve established proportions'}`,
    `CANONICAL FACE: ${identity.face || 'preserve facial landmarks and eye shape'}`,
    `CANONICAL SHAPE/SILHOUETTE: ${identity.shapeLanguage || 'preserve recognizable silhouette'}`,
    `BASE OUTFIT: ${identity.outfit || 'unspecified'}`,
    `MARKINGS: ${(identity.markings || []).join(', ') || 'none specified'}`,
    `STABLE ACCESSORIES: ${(identity.accessories || []).join(', ') || 'none specified'}`,
    `BINDING: visibility=${binding.visibility}; placement=${binding.placement || 'unspecified'}; action=${binding.action || 'unspecified'}; expression=${binding.expression || 'unspecified'}`,
    `CURRENT APPEARANCE STATE: ${stateInfo.summary}`,
    `CANONICAL ASSET SHA256: ${canonicalAsset.assetSha256 || binding.canonicalAssetSha256 || 'unknown'}`,
    '',
    'Appearance state may legitimately change wardrobe/costume, footwear, hair state, condition, cleanliness, apparent age, injuries, carried items, temporary accessories and story-visible appearance notes.',
    'Treat those declared changes as overlays. They do NOT authorize changing the character identity.',
    'The canonical face, species/type, body proportions, recognizable silhouette/shape language, stable markings and base palette must remain the same character. Base outfit may be visually replaced only when the declared appearance state specifies a wardrobe/costume override.',
    '',
    'Return ONLY one JSON object with this exact top-level contract:',
    '{',
    '  "characterPresent": true|false,',
    '  "sameCanonicalCharacter": true|false,',
    '  "canonicalIdentityConsistent": true|false,',
    '  "appearanceStateConsistent": true|false|null,',
    '  "confidence": 0.0-1.0,',
    '  "identityMismatches": ["short visible mismatch reason"],',
    '  "notes": "short visible evidence only"',
    '}',
    '',
    'Rules:',
    '- characterPresent=true only when the bound character is visibly identifiable in IMAGE 2;',
    '- sameCanonicalCharacter=false when IMAGE 2 shows a different same-species character or replacement;',
    '- canonicalIdentityConsistent=false for visible face/silhouette/proportion/palette/marking identity drift;',
    '- appearanceStateConsistent checks only the declared 11.11.4 overlay; use null when no visual state judgment is possible;',
    '- confidence must reflect visible evidence, not filenames, prompt text, metadata, or assumptions;',
    '- never mark mismatch merely because pose, expression, action, framing, background, camera, scale, or illumination differs.'
  ].join('\n').slice(0, 26000);
}
function normalizeCharacterVisionResponse(payload = {}, minConfidence = 0.72) {
  const contractValid = typeof payload.characterPresent === 'boolean' &&
    typeof payload.sameCanonicalCharacter === 'boolean' &&
    typeof payload.canonicalIdentityConsistent === 'boolean' &&
    (payload.appearanceStateConsistent === null || typeof payload.appearanceStateConsistent === 'boolean' || payload.appearanceStateConsistent === undefined) &&
    Number.isFinite(Number(payload.confidence)) && Array.isArray(payload.identityMismatches);
  const confidence = clamp01(payload.confidence);
  const identityMismatches = Array.isArray(payload.identityMismatches)
    ? payload.identityMismatches.map(item => clean(item, 300)).filter(Boolean).slice(0, 16)
    : [];
  const canonicalIdentityConsistent = payload.canonicalIdentityConsistent === true && identityMismatches.length === 0;
  return {
    contractValid,
    characterPresent: payload.characterPresent === true,
    sameCanonicalCharacter: payload.sameCanonicalCharacter === true,
    canonicalIdentityConsistent,
    appearanceStateConsistent: payload.appearanceStateConsistent == null ? null : payload.appearanceStateConsistent === true,
    confidence,
    identityMismatches,
    notes: clean(payload.notes || '', 1200),
    verified: Boolean(contractValid && payload.characterPresent === true && payload.sameCanonicalCharacter === true && canonicalIdentityConsistent && payload.appearanceStateConsistent !== false && confidence >= minConfidence)
  };
}
function characterVisionDecision(result = null, options = {}) {
  const requireVision = options.requireVision === true;
  const requiredBinding = options.requiredBinding !== false;
  if (!result) return { accepted: !requireVision, verified: false, status: requireVision ? 'vision_required' : 'vision_unavailable', reasons: requireVision ? ['CROSS_VIDEO_CHARACTER_VISION_REQUIRED'] : [] };
  if (!result.contractValid) return { accepted: !requireVision, verified: false, status: requireVision ? 'invalid_response' : 'vision_unverified', reasons: requireVision ? ['CROSS_VIDEO_CHARACTER_INVALID_VISION_RESPONSE'] : [] };
  const reasons = [];
  if (requiredBinding && result.characterPresent === false) reasons.push('CROSS_VIDEO_CHARACTER_MISSING');
  if (result.sameCanonicalCharacter === false) reasons.push('CROSS_VIDEO_CHARACTER_REPLACED');
  if (result.canonicalIdentityConsistent === false) reasons.push('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT');
  if (result.appearanceStateConsistent === false) reasons.push('CROSS_VIDEO_CHARACTER_APPEARANCE_STATE_DRIFT');
  if (reasons.length) return { accepted: false, verified: false, status: 'blocked', reasons };
  if (result.confidence < Number(options.minConfidence || 0.72)) {
    return { accepted: !requireVision, verified: false, status: requireVision ? 'confidence_below_threshold' : 'vision_unverified', reasons: requireVision ? ['CROSS_VIDEO_CHARACTER_CONFIDENCE_BELOW_THRESHOLD'] : [] };
  }
  return { accepted: true, verified: true, status: 'verified', reasons: [] };
}

class CrossVideoCharacterContinuityGateV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.CROSS_VIDEO_CHARACTER_CONTINUITY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireCanonicalAsset = String(options.requireCanonicalAsset ?? process.env.CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_CANONICAL_ASSET ?? 'true').toLowerCase() !== 'false';
    const localStrict = String(options.requireVision ?? process.env.CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_VISION ?? 'false').toLowerCase() === 'true';
    const globalStrict = String(process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';
    this.requireVision = localStrict || globalStrict;
    const threshold = Number(options.minConfidence ?? process.env.CROSS_VIDEO_CHARACTER_CONTINUITY_MIN_CONFIDENCE ?? process.env.SEMANTIC_PROP_MIN_CONFIDENCE ?? 0.72);
    this.minConfidence = Number.isFinite(threshold) ? Math.max(0.5, Math.min(0.98, threshold)) : 0.72;
    this.baseURL = clean(options.baseURL ?? process.env.CROSS_VIDEO_CHARACTER_VISION_BASE_URL ?? process.env.SEMANTIC_PROP_VISION_BASE_URL ?? '', 1000).replace(/\/+$/, '');
    this.model = clean(options.model ?? process.env.CROSS_VIDEO_CHARACTER_VISION_MODEL ?? process.env.SEMANTIC_PROP_VISION_MODEL ?? '', 300);
    this.apiKey = String(options.apiKey ?? process.env.CROSS_VIDEO_CHARACTER_VISION_API_KEY ?? process.env.SEMANTIC_PROP_VISION_API_KEY ?? '').trim();
    const timeout = Number(options.timeoutMs ?? process.env.CROSS_VIDEO_CHARACTER_VISION_TIMEOUT_MS ?? process.env.SEMANTIC_PROP_VISION_TIMEOUT_MS ?? 30000);
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
    const bindings = this.db?.listShotPersistentCharacterBindings ? await this.db.listShotPersistentCharacterBindings(productionId, shotId) : [];
    return { bindings: visibleCharacterBindings(bindings) };
  }

  async persist(input, binding, character, asset, state, result) {
    if (!this.db?.saveCrossVideoCharacterContinuityCheck) return result;
    return this.db.saveCrossVideoCharacterContinuityCheck({
      productionId: input.productionId,
      sceneId: input.sceneId,
      shotId: input.keyframe?.shotId,
      keyframeId: input.keyframe?.id,
      bindingId: binding?.id || null,
      characterId: binding?.characterId || character?.id || null,
      canonicalAssetId: asset?.id || binding?.canonicalAssetId || null,
      canonicalAssetPath: asset?.assetPath || null,
      canonicalAssetSha256: asset?.assetSha256 || binding?.canonicalAssetSha256 || null,
      canonicalSourceProductionId: asset?.sourceProductionId || character?.createdFromProductionId || null,
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
      characterPresent: result.characterPresent,
      sameCanonicalCharacter: result.sameCanonicalCharacter,
      canonicalIdentityConsistent: result.canonicalIdentityConsistent,
      appearanceStateConsistent: result.appearanceStateConsistent,
      reasons: result.reasons || [],
      identityMismatches: result.identityMismatches || [],
      promptFingerprint: result.promptFingerprint || null,
      responseFingerprint: result.responseFingerprint || null,
      notes: result.notes || null
    });
  }

  async evaluate(input = {}) {
    const productionId = clean(input.productionId || '', 240);
    const shotId = clean(input.keyframe?.shotId || input.shotId || '', 240);
    if (!this.enabled) return { version: VERSION, active: false, accepted: true, verified: false, status: 'disabled', reasons: [], checks: [], summary: { visible: 0, reused: 0, origin: 0, verified: 0, blocked: 0, unverified: 0 } };
    if (!productionId || !shotId || !input.keyframe?.id) return { version: VERSION, active: true, accepted: false, verified: false, status: 'invalid_input', reasons: ['CROSS_VIDEO_CHARACTER_INVALID_INPUT'], checks: [], summary: { visible: 0, reused: 0, origin: 0, verified: 0, blocked: 1, unverified: 0 } };

    const { bindings } = await this.contextFor(productionId, shotId);
    if (!bindings.length) return { version: VERSION, active: true, accepted: true, verified: false, status: 'no_visible_character_bindings', reasons: [], checks: [], summary: { visible: 0, reused: 0, origin: 0, verified: 0, blocked: 0, unverified: 0 } };

    const checks = [];
    for (const binding of bindings) {
      const character = this.db?.getPersistentCharacter ? await this.db.getPersistentCharacter(binding.characterId) : null;
      if (!character) {
        const result = { accepted: false, verified: false, status: 'character_record_missing', reasons: ['CROSS_VIDEO_CHARACTER_RECORD_MISSING'], providerUsed: false, providerMode: 'not_run', model: null, visionConfidence: 0, reusedAcrossVideos: false, characterPresent: null, sameCanonicalCharacter: null, canonicalIdentityConsistent: null, appearanceStateConsistent: null, identityMismatches: [], notes: 'Persistent character row missing.' };
        await this.persist(input, binding, null, null, null, result);
        checks.push({ binding, character: null, asset: null, state: null, ...result });
        continue;
      }

      const reusedAcrossVideos = Boolean(character.createdFromProductionId && character.createdFromProductionId !== productionId);
      const state = binding.stateId && this.db?.getPersistentCharacterAppearanceState ? await this.db.getPersistentCharacterAppearanceState(binding.stateId) : null;
      if (!reusedAcrossVideos) {
        const result = { accepted: true, verified: false, status: 'origin_production', reasons: [], providerUsed: false, providerMode: 'origin', model: null, visionConfidence: 0, reusedAcrossVideos: false, characterPresent: null, sameCanonicalCharacter: null, canonicalIdentityConsistent: null, appearanceStateConsistent: null, identityMismatches: [], notes: 'Character originates in the current production; cross-video comparison is not applicable.' };
        await this.persist(input, binding, character, null, state, result);
        checks.push({ binding, character, asset: null, state, ...result });
        continue;
      }

      let asset = null;
      if (binding.canonicalAssetId && this.db?.getPersistentCharacterAsset) asset = await this.db.getPersistentCharacterAsset(binding.canonicalAssetId);
      if (!asset && this.db?.getPersistentCharacterAssetByCharacter) asset = await this.db.getPersistentCharacterAssetByCharacter(character.id, 'character_reference');
      const assetReady = Boolean(asset && asset.status === 'ready' && asset.canonical !== false && asset.assetPath && await this.pathExists(asset.assetPath));
      if (!assetReady) {
        const result = { accepted: !this.requireCanonicalAsset, verified: false, status: 'canonical_asset_missing', reasons: this.requireCanonicalAsset ? ['CROSS_VIDEO_CHARACTER_CANONICAL_ASSET_MISSING'] : [], providerUsed: false, providerMode: 'not_run', model: null, visionConfidence: 0, reusedAcrossVideos: true, characterPresent: null, sameCanonicalCharacter: null, canonicalIdentityConsistent: null, appearanceStateConsistent: null, identityMismatches: [], notes: 'Reused character has no readable canonical character_reference asset.' };
        await this.persist(input, binding, character, asset, state, result);
        checks.push({ binding, character, asset, state, ...result });
        continue;
      }

      if (!(await this.pathExists(input.assetPath))) {
        const result = { accepted: false, verified: false, status: 'candidate_keyframe_missing', reasons: ['CROSS_VIDEO_CHARACTER_KEYFRAME_MISSING'], providerUsed: false, providerMode: 'not_run', model: null, visionConfidence: 0, reusedAcrossVideos: true, characterPresent: null, sameCanonicalCharacter: null, canonicalIdentityConsistent: null, appearanceStateConsistent: null, identityMismatches: [], notes: 'Generated keyframe asset is missing.' };
        await this.persist(input, binding, character, asset, state, result);
        checks.push({ binding, character, asset, state, ...result });
        continue;
      }

      const prompt = buildCharacterContinuityPrompt({ character, binding, state, canonicalAsset: asset });
      let provider = { payload: null, providerUsed: false, providerMode: 'unconfigured', model: this.model || null };
      let normalized = null;
      let decision = null;
      let providerError = null;
      try {
        provider = await this.callProvider(asset.assetPath, input.assetPath, prompt);
        normalized = provider.payload ? normalizeCharacterVisionResponse(provider.payload, this.minConfidence) : null;
        decision = characterVisionDecision(normalized, { requireVision: this.requireVision, requiredBinding: binding.required !== false, minConfidence: this.minConfidence });
      } catch (error) {
        providerError = clean(error?.message || error, 1200);
        decision = { accepted: !this.requireVision, verified: false, status: this.requireVision ? 'vision_error' : 'vision_unverified', reasons: this.requireVision ? ['CROSS_VIDEO_CHARACTER_VISION_ERROR'] : [] };
      }

      const result = {
        accepted: decision.accepted,
        verified: decision.verified,
        status: decision.status,
        reasons: decision.reasons || [],
        providerUsed: provider.providerUsed === true,
        providerMode: provider.providerMode || (providerError ? 'error' : 'unconfigured'),
        model: provider.model || this.model || null,
        visionConfidence: normalized?.confidence || 0,
        reusedAcrossVideos: true,
        characterPresent: normalized ? normalized.characterPresent : null,
        sameCanonicalCharacter: normalized ? normalized.sameCanonicalCharacter : null,
        canonicalIdentityConsistent: normalized ? normalized.canonicalIdentityConsistent : null,
        appearanceStateConsistent: normalized ? normalized.appearanceStateConsistent : null,
        identityMismatches: normalized?.identityMismatches || [],
        promptFingerprint: hash(prompt),
        responseFingerprint: provider.payload ? hash(JSON.stringify(provider.payload)) : null,
        notes: providerError || normalized?.notes || null
      };
      await this.persist(input, binding, character, asset, state, result);
      checks.push({ binding, character, asset, state, ...result });
    }

    const reasons = [...new Set(checks.flatMap(row => row.reasons || []))];
    const blocked = checks.filter(row => !row.accepted).length;
    const reused = checks.filter(row => row.reusedAcrossVideos).length;
    const origin = checks.filter(row => row.status === 'origin_production').length;
    const verified = checks.filter(row => row.verified).length;
    const unverified = checks.filter(row => row.accepted && row.reusedAcrossVideos && !row.verified).length;
    const result = {
      version: VERSION,
      active: true,
      accepted: blocked === 0,
      verified: reused > 0 && blocked === 0 && verified === reused,
      status: blocked ? 'blocked' : (reused ? (unverified ? 'accepted_unverified' : 'verified') : 'origin_only'),
      reasons,
      checks,
      summary: { visible: bindings.length, reused, origin, verified, blocked, unverified }
    };
    this.logger.info(`Cross-Video Character Continuity v${VERSION}: visible=${result.summary.visible}, reused=${reused}, origin=${origin}, verified=${verified}, blocked=${blocked}, unverified=${unverified}.`);
    return result;
  }
}

module.exports = {
  CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION: VERSION,
  CrossVideoCharacterContinuityGateV11,
  visibleCharacterBindings,
  appearanceStateSummary,
  buildCharacterContinuityPrompt,
  normalizeCharacterVisionResponse,
  characterVisionDecision,
  extractJson,
  mimeForPath
};
