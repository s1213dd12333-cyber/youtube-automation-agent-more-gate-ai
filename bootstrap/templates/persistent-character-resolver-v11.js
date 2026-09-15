'use strict';

const VERSION = '11.11.2';

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, '_') || 'character';
}

function unique(values = []) {
  const out = [], seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const text = clean(value, 240), key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(text);
  }
  return out;
}

const GENERIC_WORDS = new Set([
  'the','a','an','this','that','main','supporting','character','hero','heroine','kid','child',
  'he','she','they','him','her','them','his','hers','their','our','my','your',
  'o','a','os','as','um','uma','este','esta','esse','essa','personagem','principal','heroi','heroina',
  'ele','ela','eles','elas','dele','dela','deles','delas','seu','sua','nosso','nossa'
]);

const SPECIES_SYNONYMS = new Map([
  ['bunny','rabbit'],['rabbit','rabbit'],['coelho','rabbit'],['coelha','rabbit'],
  ['bird','bird'],['passaro','bird'],['passarinho','bird'],['ave','bird'],
  ['bear','bear'],['urso','bear'],['cat','cat'],['gato','cat'],['gata','cat'],
  ['dog','dog'],['cao','dog'],['cachorro','dog'],['cachorra','dog'],
  ['fox','fox'],['raposa','fox'],['dragon','dragon'],['dragao','dragon'],
  ['robot','robot'],['robo','robot'],['star','star'],['estrela','star'],
  ['cloud','cloud'],['nuvem','cloud'],['girl','human_child'],['boy','human_child'],
  ['child','human_child'],['kid','human_child'],['menina','human_child'],['menino','human_child'],
  ['crianca','human_child'],['character','character'],['personagem','character']
]);

function normalizeSpecies(value) {
  const key = normalize(value);
  return SPECIES_SYNONYMS.get(key) || slug(key || 'character');
}

function speciesForReference(referenceText = '', fallback = 'character') {
  const tokens = normalize(referenceText).split(' ').filter(Boolean);
  for (const token of tokens) if (SPECIES_SYNONYMS.has(token)) return SPECIES_SYNONYMS.get(token);
  return normalizeSpecies(fallback);
}

function referenceDescriptor(referenceText = '', fallbackSpecies = 'character') {
  const key = normalize(referenceText);
  const tokens = key.split(' ').filter(Boolean);
  const requestedSpecies = speciesForReference(referenceText, fallbackSpecies);
  const speciesTokens = new Set([...SPECIES_SYNONYMS.entries()].filter(([, species]) => species === requestedSpecies).map(([token]) => token));
  const significant = tokens.filter(token => !GENERIC_WORDS.has(token) && !speciesTokens.has(token));
  return { text: clean(referenceText, 1000), key, requestedSpecies, generic: significant.length === 0, significant };
}

function candidateAliases(candidate = {}) {
  return unique([
    candidate.displayName,
    candidate.explicitCharacterKey ? String(candidate.explicitCharacterKey).replace(/[_-]+/g, ' ') : '',
    ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])
  ]).map(text => ({ text, key: normalize(text) })).filter(item => item.key);
}

function canonicalAliases(character = {}) {
  return unique([
    character.displayName,
    character.characterKey ? String(character.characterKey).replace(/[_-]+/g, ' ') : ''
  ]).map(text => ({ text, key: normalize(text) })).filter(item => item.key);
}

function compatibleCanonicalIdentity(character = {}, candidate = {}) {
  const identity = character.canonicalIdentity || {};
  const checks = [
    ['speciesType', normalizeSpecies(candidate.speciesType || 'character'), normalizeSpecies(character.speciesType || identity.speciesType || 'character')],
    ['descriptor', normalize(candidate.descriptor), normalize(identity.descriptor)],
    ['proportions', normalize(candidate.proportions), normalize(identity.proportions)],
    ['face', normalize(candidate.face), normalize(identity.face)],
    ['shapeLanguage', normalize(candidate.shapeLanguage), normalize(identity.shapeLanguage)],
    ['outfit', normalize(candidate.outfit), normalize(identity.outfit)]
  ];
  const mismatches = [];
  for (const [field, incoming, canonical] of checks) {
    if (!incoming || incoming === 'character') continue;
    if (field === 'speciesType') {
      if (canonical && canonical !== 'character' && incoming !== canonical) mismatches.push(field);
    } else if (canonical && incoming !== canonical) mismatches.push(field);
  }
  const compareSet = (field, incomingValues, canonicalValues) => {
    const incoming = new Set((incomingValues || []).map(normalize).filter(Boolean));
    const canonical = new Set((canonicalValues || []).map(normalize).filter(Boolean));
    if (!incoming.size || !canonical.size) return;
    for (const value of incoming) if (!canonical.has(value)) { mismatches.push(field); break; }
  };
  compareSet('palette', candidate.palette, identity.palette);
  compareSet('markings', candidate.markings, identity.markings);
  compareSet('accessories', candidate.accessories, identity.accessories);
  return { compatible: mismatches.length === 0, reason: mismatches.length ? `canonical_attribute_mismatch:${[...new Set(mismatches)].join('|')}` : null };
}

function speciesCompatible(character = {}, requestedSpecies = 'character') {
  const wanted = normalizeSpecies(requestedSpecies);
  if (!wanted || wanted === 'character') return true;
  return normalizeSpecies(character.speciesType || character.canonicalIdentity?.speciesType || 'character') === wanted;
}

async function uniqueCharactersForAliases(db, namespace, aliasKey) {
  if (!db?.listPersistentCharacterAliasesByKey) return [];
  const rows = await db.listPersistentCharacterAliasesByKey(namespace, aliasKey);
  const seen = new Set(), out = [];
  for (const row of rows || []) {
    const id = row.characterId || row.character?.id;
    if (!id || seen.has(id)) continue;
    const character = row.character || (db.getPersistentCharacter ? await db.getPersistentCharacter(id) : null);
    if (!character) continue;
    seen.add(id); out.push(character);
  }
  return out;
}

class PersistentCharacterResolverV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_CHARACTER_RESOLVER_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.allowContextualGeneric = String(options.allowContextualGeneric ?? process.env.PERSISTENT_CHARACTER_RESOLVER_ALLOW_CONTEXTUAL_GENERIC ?? 'true').toLowerCase() !== 'false';
  }

  async persistResolution(input = {}, result = {}) {
    if (!this.db?.savePersistentCharacterResolution || !input.production?.id) return result;
    await this.db.savePersistentCharacterResolution({
      namespace: input.namespace || 'default',
      productionId: input.production.id,
      scopeKey: input.scopeKey || input.candidate?.sourceBibleId || input.candidate?.sourceRef || 'production',
      referenceText: input.referenceText || input.candidate?.displayName || '',
      referenceKey: result.referenceKey || normalize(input.referenceText || input.candidate?.displayName || ''),
      requestedSpecies: result.requestedSpecies || normalizeSpecies(input.candidate?.speciesType || 'character'),
      status: result.status,
      characterId: result.character?.id || null,
      matchMode: result.matchMode || null,
      confidence: Number(result.confidence || 0),
      candidateCharacterIds: (result.candidates || []).map(item => item.id || item.character?.id).filter(Boolean),
      reason: result.reason || null,
      identityFingerprint: input.identityFingerprint || null
    });
    return result;
  }

  async ensureAliases(character = {}, candidate = {}, sourceKind = 'character_registration') {
    if (!character?.id || !this.db?.savePersistentCharacterAlias) return [];
    const contextualGenericKey = sourceKind === 'character_context_unique' &&
      referenceDescriptor(candidate.displayName || '', candidate.speciesType || character.speciesType || 'character').generic
        ? normalize(candidate.displayName || '') : '';
    const aliases = [...canonicalAliases(character), ...candidateAliases(candidate).filter(alias => !contextualGenericKey || alias.key !== contextualGenericKey)];
    const seen = new Set(), saved = [];
    for (const alias of aliases) {
      if (!alias.key || seen.has(alias.key)) continue;
      seen.add(alias.key);
      const row = await this.db.savePersistentCharacterAlias({
        namespace: character.namespace || 'default',
        characterId: character.id,
        aliasText: alias.text,
        aliasKey: alias.key,
        canonical: normalize(alias.text) === normalize(character.displayName) ||
          normalize(alias.text) === normalize(String(character.characterKey || '').replace(/[_-]+/g, ' ')),
        sourceKind
      });
      if (row) saved.push(row);
    }
    return saved;
  }

  async recordRegistration(input = {}, character = null, candidate = {}) {
    if (!character) return null;
    await this.ensureAliases(character, candidate, 'registered_new');
    return this.persistResolution(input, {
      status: 'registered_new', character, candidates: [], matchMode: 'resolver_unresolved_register_new', confidence: 1,
      referenceKey: normalize(input.referenceText || candidate.displayName || ''),
      requestedSpecies: normalizeSpecies(candidate.speciesType || character.speciesType || 'character'),
      reason: 'no_safe_existing_character_match'
    });
  }

  async resolveCandidate(input = {}) {
    const namespace = input.namespace || 'default';
    const candidate = input.candidate || {};
    const referenceText = input.referenceText || candidate.displayName || candidate.explicitCharacterKey || '';
    const descriptor = referenceDescriptor(referenceText, candidate.speciesType || 'character');
    const base = { version: VERSION, active: this.enabled, referenceKey: descriptor.key, requestedSpecies: descriptor.requestedSpecies };

    if (!this.enabled) return { ...base, status: 'unresolved', character: null, candidates: [], matchMode: null, confidence: 0, reason: 'resolver_disabled' };
    if (!referenceText) return this.persistResolution(input, { ...base, status: 'unresolved', character: null, candidates: [], confidence: 0, reason: 'reference_missing' });

    if (candidate.explicitCharacterKey && this.db?.getPersistentCharacterByKey) {
      const exactKey = await this.db.getPersistentCharacterByKey(namespace, slug(candidate.explicitCharacterKey));
      if (exactKey) {
        const compatible = compatibleCanonicalIdentity(exactKey, candidate);
        const result = compatible.compatible
          ? { ...base, status: 'resolved', character: exactKey, candidates: [exactKey], matchMode: 'character_key_exact', confidence: 1, reason: 'explicit_character_key_exact' }
          : { ...base, status: 'conflict', character: null, candidates: [exactKey], matchMode: 'character_key_conflict', confidence: 1, reason: compatible.reason };
        await this.persistResolution(input, result); return result;
      }
    }

    const explicitSpecies = normalizeSpecies(candidate.speciesType || 'character');
    const aliasCharacters = await uniqueCharactersForAliases(this.db, namespace, descriptor.key);
    const aliasCompatible = aliasCharacters.filter(character => (explicitSpecies === 'character' || speciesCompatible(character, explicitSpecies)) && compatibleCanonicalIdentity(character, candidate).compatible);
    if (aliasCompatible.length === 1) {
      const result = { ...base, status: 'resolved', character: aliasCompatible[0], candidates: aliasCompatible, matchMode: 'character_alias_exact', confidence: 0.99, reason: 'persisted_alias_exact' };
      await this.persistResolution(input, result); return result;
    }
    if (aliasCompatible.length > 1) {
      const result = { ...base, status: 'ambiguous', character: null, candidates: aliasCompatible, matchMode: 'character_alias_ambiguous', confidence: 0, reason: 'alias_points_to_multiple_compatible_characters' };
      await this.persistResolution(input, result); return result;
    }

    const characters = this.db?.listPersistentCharacters ? await this.db.listPersistentCharacters(namespace) : [];
    const exactNamed = (characters || []).filter(character => {
      if (explicitSpecies !== 'character' && !speciesCompatible(character, explicitSpecies)) return false;
      if (!compatibleCanonicalIdentity(character, candidate).compatible) return false;
      return normalize(character.displayName) === descriptor.key ||
        normalize(String(character.characterKey || '').replace(/[_-]+/g, ' ')) === descriptor.key;
    });
    if (exactNamed.length === 1) {
      const result = { ...base, status: 'resolved', character: exactNamed[0], candidates: exactNamed, matchMode: 'character_name_species_exact', confidence: 0.97, reason: 'normalized_name_species_exact' };
      await this.persistResolution(input, result); return result;
    }
    if (exactNamed.length > 1) {
      const result = { ...base, status: 'ambiguous', character: null, candidates: exactNamed, matchMode: 'character_name_ambiguous', confidence: 0, reason: 'normalized_name_matches_multiple_characters' };
      await this.persistResolution(input, result); return result;
    }

    if (descriptor.generic && this.allowContextualGeneric) {
      const compatible = (characters || []).filter(character => speciesCompatible(character, descriptor.requestedSpecies) && compatibleCanonicalIdentity(character, candidate).compatible);
      if (compatible.length === 1) {
        const result = { ...base, status: 'resolved', character: compatible[0], candidates: compatible, matchMode: 'character_context_unique', confidence: 0.84, reason: 'single_compatible_generic_candidate' };
        await this.persistResolution(input, result); return result;
      }
      if (compatible.length > 1) {
        const result = { ...base, status: 'ambiguous', character: null, candidates: compatible, matchMode: 'character_context_ambiguous', confidence: 0, reason: 'multiple_compatible_generic_candidates' };
        await this.persistResolution(input, result); return result;
      }
    }

    const result = { ...base, status: 'unresolved', character: null, candidates: [], matchMode: null, confidence: 0,
      reason: descriptor.generic ? 'no_unique_contextual_candidate' : 'no_exact_alias_or_name_match' };
    await this.persistResolution(input, result); return result;
  }
}

module.exports = {
  PERSISTENT_CHARACTER_RESOLVER_VERSION: VERSION,
  PersistentCharacterResolverV11,
  normalize,
  slug,
  normalizeSpecies,
  speciesForReference,
  referenceDescriptor,
  candidateAliases,
  canonicalAliases,
  compatibleCanonicalIdentity,
  speciesCompatible,
  uniqueCharactersForAliases
};
