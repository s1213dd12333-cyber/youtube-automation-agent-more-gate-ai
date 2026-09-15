'use strict';

const crypto = require('crypto');

const VERSION = '11.11.1';

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value, limit = 4000) {
  return clean(value, limit).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function slug(value) {
  return normalize(value, 160).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'character';
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function stableJson(value) { return JSON.stringify(stable(value)); }

function unique(values = []) {
  const out = [], seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const text = clean(value, 300);
    const key = normalize(text, 300);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(text);
  }
  return out;
}

function normalizePalette(values = []) {
  return unique(values).map(value => normalize(value, 120)).filter(Boolean).sort();
}

function normalizeCharacterCandidate(raw = {}, options = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.temporary === true || raw.ephemeral === true || raw.persistent === false) return null;
  const displayName = clean(raw.name || raw.displayName || raw.characterName || '', 160);
  if (!displayName) return null;
  const explicitCharacterKey = clean(raw.characterKey || raw.persistentCharacterKey || raw.canonicalCharacterKey || '', 200) || null;
  return {
    displayName,
    explicitCharacterKey,
    sourceCharacterId: clean(raw.id || raw.sourceCharacterId || '', 220) || null,
    sourceBibleId: clean(options.sourceBibleId || raw.sourceBibleId || '', 220) || null,
    role: clean(raw.role || '', 80) || null,
    speciesType: clean(raw.speciesType || raw.species || raw.type || 'character', 160),
    descriptor: clean(raw.descriptor || raw.visualDescriptor || '', 800),
    palette: unique(raw.palette || raw.colors || []),
    proportions: clean(raw.proportions || '', 800),
    face: clean(raw.face || raw.faceRules || '', 800),
    shapeLanguage: clean(raw.shapeLanguage || '', 800),
    outfit: clean(raw.outfit || raw.costume || '', 1000),
    markings: unique(raw.markings || raw.distinguishingMarks || []),
    accessories: unique(raw.accessories || []),
    continuityRules: unique(raw.continuityRules || []),
    sourceKind: clean(options.sourceKind || raw.sourceKind || 'cartoon_bible_character', 120),
    sourceRef: clean(options.sourceRef || raw.sourceRef || raw.id || displayName, 240)
  };
}

function characterIdentity(candidate = {}, context = {}) {
  const explicitKey = normalize(candidate.explicitCharacterKey, 200);
  const namespace = clean(context.namespace || 'default', 200);
  return {
    scopeKind: explicitKey ? 'explicit_character_key' : 'namespace',
    scopeAnchor: explicitKey || namespace,
    identityName: explicitKey ? '' : normalize(candidate.displayName, 160),
    speciesType: normalize(candidate.speciesType || 'character', 160),
    descriptor: normalize(candidate.descriptor, 800),
    palette: normalizePalette(candidate.palette),
    proportions: normalize(candidate.proportions, 800),
    face: normalize(candidate.face, 800),
    shapeLanguage: normalize(candidate.shapeLanguage, 800),
    outfit: normalize(candidate.outfit, 1000),
    markings: unique(candidate.markings).map(value => normalize(value, 300)).filter(Boolean).sort(),
    accessories: unique(candidate.accessories).map(value => normalize(value, 300)).filter(Boolean).sort()
  };
}

function characterIdentityFingerprint(candidate = {}, context = {}) {
  return hash(stableJson(characterIdentity(candidate, context)));
}

function characterKeyFor(candidate = {}, fingerprint = '') {
  if (candidate.explicitCharacterKey) return slug(candidate.explicitCharacterKey);
  return `${slug(candidate.displayName)}_${String(fingerprint).slice(0, 10)}`;
}

function characterPromptContext(character = {}) {
  const identity = character.canonicalIdentity || {};
  return [
    `PERSISTENT CHARACTER V${VERSION}:`,
    `CHARACTER ID: ${character.id || 'pending'}`,
    `CHARACTER KEY: ${character.characterKey || 'pending'}`,
    `NAME: ${character.displayName || identity.identityName || 'character'}`,
    `SPECIES/TYPE: ${character.speciesType || identity.speciesType || 'character'}`,
    `VISUAL DESIGN: ${identity.descriptor || 'preserve established canonical design'}`,
    `PALETTE: ${(identity.palette || []).join(' / ') || 'preserve established colors'}`,
    `PROPORTIONS: ${identity.proportions || 'preserve established proportions'}`,
    `FACE: ${identity.face || 'preserve facial landmarks and eye shape'}`,
    `SHAPE LANGUAGE: ${identity.shapeLanguage || 'preserve silhouette'}`,
    `OUTFIT: ${identity.outfit || 'preserve established outfit'}`,
    `MARKINGS: ${(identity.markings || []).join(', ') || 'none specified'}`,
    `ACCESSORIES: ${(identity.accessories || []).join(', ') || 'none specified'}`,
    '',
    'PERSISTENT CHARACTER RULES:',
    '- reuse this exact character identity across later videos when the same character returns;',
    '- role, emotion, pose, action, temporary props and current location are NOT canonical identity;',
    '- later wardrobe or appearance changes must use a state/lifecycle layer instead of rewriting canonical identity;',
    '- never replace the character with a merely similar character of the same species/type.'
  ].join('\n').slice(0, 12000);
}

function collectBibleCharacters(cartoonBible = {}) {
  if (!cartoonBible || cartoonBible.mode !== 'kids_cartoon_2d') return [];
  const out = [];
  for (const raw of Array.isArray(cartoonBible.characters) ? cartoonBible.characters : []) {
    const candidate = normalizeCharacterCandidate(raw, { sourceBibleId: cartoonBible.id, sourceKind: 'cartoon_bible_character', sourceRef: raw?.id || raw?.name });
    if (candidate) out.push(candidate);
  }
  return out;
}

class PersistentCharacterRegistryV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = options.enabled ?? String(process.env.PERSISTENT_CHARACTERS_ENABLED || 'true').toLowerCase() !== 'false';
    this.namespace = clean(options.namespace || process.env.PERSISTENT_CHARACTER_NAMESPACE || process.env.PERSISTENT_WORLD_OBJECT_NAMESPACE || 'default', 200) || 'default';
  }

  async registerCandidate(production, candidate = {}) {
    const productionId = clean(production?.id || production, 220);
    if (!productionId || !candidate) return { status: 'invalid', character: null, usage: null, reused: false, conflict: false };
    const canonicalIdentity = characterIdentity(candidate, { namespace: this.namespace });
    const identityFingerprint = characterIdentityFingerprint(candidate, { namespace: this.namespace });
    const characterKey = characterKeyFor(candidate, identityFingerprint);
    let character = await this.db.getPersistentCharacterByFingerprint(this.namespace, identityFingerprint);
    let reused = Boolean(character);
    let matchMode = reused ? 'identity_fingerprint_exact_reuse' : 'identity_fingerprint_exact_register';

    if (!character && candidate.explicitCharacterKey && typeof this.db.getPersistentCharacterByKey === 'function') {
      const keyed = await this.db.getPersistentCharacterByKey(this.namespace, characterKey);
      if (keyed && keyed.identityFingerprint !== identityFingerprint) {
        this.logger.warn(`Persistent Character v${VERSION}: explicit key ${characterKey} conflicts with canonical identity ${keyed.id}.`);
        return {
          status: 'identity_conflict', character: null, usage: null, reused: false, conflict: true,
          existingCharacter: keyed, candidateFingerprint: identityFingerprint, reason: 'explicit_character_key_identity_conflict'
        };
      }
      if (keyed) { character = keyed; reused = true; matchMode = 'explicit_character_key_exact_reuse'; }
    }

    if (!character) {
      const id = `persistent_character_${hash(`${this.namespace}:${identityFingerprint}`).slice(0, 20)}`;
      character = await this.db.savePersistentCharacter({
        id,
        namespace: this.namespace,
        characterKey,
        displayName: candidate.displayName,
        speciesType: candidate.speciesType,
        version: VERSION,
        identityFingerprint,
        canonicalIdentity,
        canonicalPromptContext: characterPromptContext({ id, characterKey, displayName: candidate.displayName, speciesType: candidate.speciesType, canonicalIdentity }),
        status: 'active',
        createdFromProductionId: productionId
      });
    } else if (typeof this.db.touchPersistentCharacter === 'function') {
      character = await this.db.touchPersistentCharacter(character.id) || character;
    }

    const usage = await this.db.savePersistentCharacterUsage({
      characterId: character.id,
      productionId,
      sourceBibleId: candidate.sourceBibleId,
      sourceCharacterId: candidate.sourceCharacterId,
      role: candidate.role,
      sourceKind: candidate.sourceKind,
      sourceRef: candidate.sourceRef,
      matchMode,
      identityFingerprint
    });
    return { status: reused ? 'reused' : 'registered', character, usage, reused, conflict: false, matchMode };
  }

  async ensureProductionCharacters(production, cartoonBible = {}) {
    if (!this.enabled || !cartoonBible || cartoonBible.mode !== 'kids_cartoon_2d') {
      return { active: false, version: VERSION, namespace: this.namespace, characters: [], promptContext: '', summary: { total: 0, registered: 0, reused: 0, conflicts: 0 } };
    }
    const candidates = collectBibleCharacters(cartoonBible);
    const rows = [];
    for (const candidate of candidates) rows.push(await this.registerCandidate(production, candidate));
    const characters = rows.filter(row => row.character).map(row => ({ character: row.character, usage: row.usage, status: row.status, reused: row.reused, matchMode: row.matchMode }));
    const summary = {
      total: rows.length,
      registered: rows.filter(row => row.status === 'registered').length,
      reused: rows.filter(row => row.status === 'reused').length,
      conflicts: rows.filter(row => row.conflict).length
    };
    const promptContext = characters.map(row => row.character.canonicalPromptContext || characterPromptContext(row.character)).filter(Boolean).join('\n\n').slice(0, 24000);
    return { active: true, version: VERSION, namespace: this.namespace, characters, conflicts: rows.filter(row => row.conflict), promptContext, summary };
  }
}

module.exports = {
  PERSISTENT_CHARACTER_VERSION: VERSION,
  PersistentCharacterRegistryV11,
  normalizeCharacterCandidate,
  characterIdentity,
  characterIdentityFingerprint,
  characterKeyFor,
  characterPromptContext,
  collectBibleCharacters
};
