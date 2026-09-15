'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const VERSION = '11.8';

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

function requiredLocks(propLocks = []) {
  return (Array.isArray(propLocks) ? propLocks : [])
    .filter(lock => lock && lock.required === true)
    .sort((a, b) => String(a.id || a.name).localeCompare(String(b.id || b.name)));
}

function buildSemanticPrompt(environment = {}, mapping = {}, propLocks = []) {
  const locks = requiredLocks(propLocks);
  const contract = locks.map(lock => ({
    id: lock.id || null,
    name: lock.name || lock.originalName || 'prop',
    color: lock.lockedAttributes?.color || null,
    material: lock.lockedAttributes?.material || null,
    type: lock.type || 'prop'
  }));
  return [
    'SEMANTIC PROP & LAYOUT VERIFICATION V11.8',
    'Analyze the supplied image only. Do not infer invisible objects and do not assume the prompt was followed.',
    `Environment ID: ${mapping.environmentId || environment.environmentId || 'unknown'}`,
    `Environment name: ${environment.name || environment.category || 'unknown'}`,
    `Zone: ${mapping.zone || 'whole_environment'}`,
    `Construction identity: ${environment.construction || 'unspecified'}`,
    `Architectural style: ${environment.architecturalStyle || 'unspecified'}`,
    `Layout identity: ${environment.layout || 'unspecified'}`,
    `Materials: ${(environment.materials || []).join(', ') || 'unspecified'}`,
    `Palette: ${(environment.palette || []).join(', ') || 'unspecified'}`,
    `Required props JSON: ${JSON.stringify(contract)}`,
    '',
    'Return ONLY one JSON object with this exact top-level contract:',
    '{',
    '  "environmentMatches": true|false,',
    '  "layoutConsistent": true|false,',
    '  "confidence": 0.0-1.0,',
    '  "props": [',
    '    {',
    '      "id": "same prop id when supplied",',
    '      "name": "prop name",',
    '      "present": true|false,',
    '      "confidence": 0.0-1.0,',
    '      "colorMatches": true|false|null,',
    '      "materialMatches": true|false|null,',
    '      "notes": "short visible evidence only"',
    '    }',
    '  ],',
    '  "notes": "short overall visible evidence"',
    '}',
    '',
    'Rules:',
    '- every required prop must appear exactly once in props;',
    '- present=true only when the object is visibly identifiable;',
    '- if a locked color/material is specified, compare it visibly and return true/false; otherwise return null;',
    '- layoutConsistent=true only when the image still looks like the same persistent place rather than a redesigned room/location;',
    '- confidence must reflect image evidence, not prompt expectations;',
    '- never invent semantic certainty from filenames, prompt text, metadata, or previous decisions.'
  ].join('\n').slice(0, 24000);
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(item => typeof item === 'string' ? item : (item?.text || item?.content || '')).join('\n');
  }
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

function normalizeSemanticResponse(payload = {}, propLocks = [], minConfidence = 0.72) {
  const locks = requiredLocks(propLocks);
  const props = Array.isArray(payload.props) ? payload.props : [];
  const normalizedProps = [];
  const missing = [];
  const mismatched = [];

  for (const lock of locks) {
    const lockId = String(lock.id || '');
    const lockName = normalize(lock.name || lock.originalName || '');
    const evidence = props.find(item => {
      const itemId = String(item?.id || '');
      const itemName = normalize(item?.name || '');
      return (lockId && itemId === lockId) || (lockName && itemName === lockName);
    }) || null;
    const confidence = clamp01(evidence?.confidence);
    const colorRequired = Boolean(lock.lockedAttributes?.color);
    const materialRequired = Boolean(lock.lockedAttributes?.material);
    const present = evidence?.present === true;
    const colorMatches = colorRequired ? evidence?.colorMatches === true : null;
    const materialMatches = materialRequired ? evidence?.materialMatches === true : null;
    const accepted = Boolean(
      evidence && present && confidence >= minConfidence &&
      (!colorRequired || colorMatches === true) &&
      (!materialRequired || materialMatches === true)
    );
    const item = {
      id: lock.id || null,
      name: lock.name || lock.originalName || 'prop',
      present,
      confidence,
      colorRequired,
      colorMatches,
      materialRequired,
      materialMatches,
      accepted,
      notes: clean(evidence?.notes || '', 500)
    };
    normalizedProps.push(item);
    if (!evidence || !present || confidence < minConfidence) missing.push(lock.id || lock.name);
    else if (!accepted) mismatched.push(lock.id || lock.name);
  }

  const environmentMatches = payload.environmentMatches === true;
  const layoutConsistent = payload.layoutConsistent === true;
  const overallConfidence = clamp01(payload.confidence);
  const contractValid = typeof payload.environmentMatches === 'boolean' &&
    typeof payload.layoutConsistent === 'boolean' && Array.isArray(payload.props) && Number.isFinite(Number(payload.confidence));
  const verified = Boolean(contractValid && environmentMatches && layoutConsistent && overallConfidence >= minConfidence && !missing.length && !mismatched.length);

  return {
    contractValid,
    environmentMatches,
    layoutConsistent,
    confidence: overallConfidence,
    props: normalizedProps,
    missingPropLockIds: missing,
    mismatchedPropLockIds: mismatched,
    semanticPropPresenceVerified: verified,
    notes: clean(payload.notes || '', 1000)
  };
}

class SemanticPropVerifierV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.SEMANTIC_PROP_VERIFICATION_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.requireVerification = String(options.requireVerification ?? process.env.SEMANTIC_PROP_REQUIRE_VERIFICATION ?? 'false').toLowerCase() === 'true';
    this.baseURL = clean(options.baseURL ?? process.env.SEMANTIC_PROP_VISION_BASE_URL ?? '', 1000).replace(/\/+$/, '');
    this.model = clean(options.model ?? process.env.SEMANTIC_PROP_VISION_MODEL ?? '', 300);
    this.apiKey = String(options.apiKey ?? process.env.SEMANTIC_PROP_VISION_API_KEY ?? '').trim();
    const threshold = Number(options.minConfidence ?? process.env.SEMANTIC_PROP_MIN_CONFIDENCE ?? 0.72);
    this.minConfidence = Number.isFinite(threshold) ? Math.max(0.5, Math.min(0.98, threshold)) : 0.72;
    const timeout = Number(options.timeoutMs ?? process.env.SEMANTIC_PROP_VISION_TIMEOUT_MS ?? 30000);
    this.timeoutMs = Number.isFinite(timeout) ? Math.max(3000, Math.min(120000, timeout)) : 30000;
    this.analyzer = typeof options.analyzer === 'function' ? options.analyzer : null;
  }

  providerAvailable() {
    return Boolean(this.analyzer || (this.baseURL && this.model));
  }

  async callProvider(assetPath, prompt) {
    if (this.analyzer) {
      const payload = await this.analyzer({ assetPath, prompt, model: this.model || 'injected-analyzer' });
      return { payload, providerUsed: true, providerMode: 'injected-analyzer', model: this.model || 'injected-analyzer' };
    }
    if (!this.baseURL || !this.model) return { payload: null, providerUsed: false, providerMode: 'unconfigured', model: this.model || null };
    const bytes = await fs.readFile(assetPath);
    const imageURL = `data:${mimeForPath(assetPath)};base64,${bytes.toString('base64')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { 'content-type': 'application/json' };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageURL } }
            ]
          }]
        })
      });
      const rawText = await response.text();
      if (!response.ok) throw new Error(`Vision provider HTTP ${response.status}: ${clean(rawText, 1000)}`);
      const envelope = extractJson(rawText) || JSON.parse(rawText);
      const rawContent = envelope?.choices?.[0]?.message?.content ?? envelope?.message?.content ?? envelope?.response ?? envelope;
      const payload = extractJson(contentText(rawContent)) || (rawContent && typeof rawContent === 'object' ? rawContent : null);
      return { payload, providerUsed: true, providerMode: 'openai-compatible-vision', model: this.model };
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(input = {}) {
    const {
      productionId, sceneId, shotId, keyframe, assetPath,
      environment = {}, mapping = {}, propLocks = []
    } = input;
    const prompt = buildSemanticPrompt(environment, mapping, propLocks);
    const promptFingerprint = hash(prompt);
    const base = {
      version: VERSION,
      active: this.enabled,
      productionId: productionId || null,
      sceneId: sceneId || keyframe?.sceneId || null,
      shotId: shotId || keyframe?.shotId || null,
      keyframeId: keyframe?.id || null,
      environmentId: mapping.environmentId || environment.environmentId || null,
      providerMode: null,
      model: this.model || null,
      providerUsed: false,
      available: this.providerAvailable(),
      status: 'disabled',
      semanticPropPresenceVerified: false,
      confidence: 0,
      props: [],
      missingPropLockIds: requiredLocks(propLocks).map(lock => lock.id || lock.name),
      mismatchedPropLockIds: [],
      reasons: [],
      promptFingerprint,
      responseFingerprint: null,
      createdAt: new Date().toISOString()
    };

    if (!this.enabled) return this.persist({ ...base, status: 'disabled', reasons: ['SEMANTIC_PROP_VERIFICATION_DISABLED'] });
    if (!keyframe?.id || !assetPath || !await pathExists(assetPath)) {
      return this.persist({ ...base, status: 'asset_missing', reasons: ['SEMANTIC_PROP_ASSET_MISSING'] });
    }
    if (!this.providerAvailable()) {
      return this.persist({ ...base, status: 'unavailable', reasons: ['SEMANTIC_PROP_PROVIDER_UNAVAILABLE'] });
    }

    try {
      const call = await this.callProvider(assetPath, prompt);
      const normalized = normalizeSemanticResponse(call.payload || {}, propLocks, this.minConfidence);
      const reasons = [];
      if (!normalized.contractValid) reasons.push('SEMANTIC_PROP_INVALID_RESPONSE');
      if (normalized.contractValid && !normalized.environmentMatches) reasons.push('SEMANTIC_ENVIRONMENT_MISMATCH');
      if (normalized.contractValid && !normalized.layoutConsistent) reasons.push('SEMANTIC_LAYOUT_MISMATCH');
      if (normalized.confidence < this.minConfidence) reasons.push('SEMANTIC_CONFIDENCE_BELOW_THRESHOLD');
      if (normalized.missingPropLockIds.length) reasons.push('SEMANTIC_REQUIRED_PROP_MISSING');
      if (normalized.mismatchedPropLockIds.length) reasons.push('SEMANTIC_LOCKED_ATTRIBUTE_MISMATCH');
      const result = {
        ...base,
        providerMode: call.providerMode,
        model: call.model,
        providerUsed: call.providerUsed,
        available: true,
        status: normalized.semanticPropPresenceVerified ? 'verified' : (normalized.contractValid ? 'rejected' : 'invalid_response'),
        semanticPropPresenceVerified: normalized.semanticPropPresenceVerified,
        confidence: normalized.confidence,
        environmentMatches: normalized.environmentMatches,
        layoutConsistent: normalized.layoutConsistent,
        props: normalized.props,
        missingPropLockIds: normalized.missingPropLockIds,
        mismatchedPropLockIds: normalized.mismatchedPropLockIds,
        reasons,
        notes: normalized.notes,
        responseFingerprint: hash(JSON.stringify(normalized))
      };
      return this.persist(result);
    } catch (error) {
      this.logger.warn(`Semantic Prop v11.8 provider error for ${keyframe.id}: ${error.message || error}`);
      return this.persist({ ...base, providerUsed: true, providerMode: this.analyzer ? 'injected-analyzer' : 'openai-compatible-vision', status: 'provider_error', reasons: ['SEMANTIC_PROP_PROVIDER_ERROR'], error: clean(error.message || error, 1200) });
    }
  }

  async persist(result) {
    if (!this.db?.saveSemanticPropCheck) return result;
    const saved = await this.db.saveSemanticPropCheck(result);
    return saved || result;
  }
}

module.exports = {
  SEMANTIC_PROP_VERIFIER_VERSION: VERSION,
  SemanticPropVerifierV11,
  buildSemanticPrompt,
  normalizeSemanticResponse,
  requiredLocks,
  extractJson,
  mimeForPath
};
