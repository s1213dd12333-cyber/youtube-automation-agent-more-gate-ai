'use strict';

class MemoryCharacterDb {
  constructor() {
    this.characters = [];
    this.usages = [];
    this.aliases = [];
    this.resolutions = [];
    this.assets = [];
    this.states = [];
    this.bindings = [];
    this.cross = [];
    this.actions = [];
    this.serial = 0;
    this.clock = 0;
  }

  nextId(prefix) { this.serial += 1; return `${prefix}_${this.serial}`; }
  now() { this.clock += 1; return `2026-09-15T21:${String(Math.floor(this.clock / 60)).padStart(2, '0')}:${String(this.clock % 60).padStart(2, '0')}.000Z`; }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  async getPersistentCharacterByFingerprint(namespace, fingerprint) {
    return this.clone(this.characters.find(row => row.namespace === namespace && row.identityFingerprint === fingerprint) || null);
  }
  async getPersistentCharacterByKey(namespace, characterKey) {
    return this.clone(this.characters.find(row => row.namespace === namespace && row.characterKey === characterKey) || null);
  }
  async getPersistentCharacter(id) { return this.clone(this.characters.find(row => row.id === id) || null); }
  async listPersistentCharacters(namespace = 'default', limit = 250) {
    return this.clone(this.characters.filter(row => row.namespace === namespace).slice(-limit).reverse());
  }
  async savePersistentCharacter(input = {}) {
    let row = this.characters.find(item => item.namespace === (input.namespace || 'default') && item.identityFingerprint === input.identityFingerprint);
    if (!row) {
      row = { ...this.clone(input), createdAt: input.createdAt || this.now(), firstSeenAt: input.firstSeenAt || this.now(), lastSeenAt: input.lastSeenAt || this.now(), updatedAt: this.now() };
      this.characters.push(row);
    } else {
      row.lastSeenAt = this.now(); row.updatedAt = this.now();
    }
    return this.clone(row);
  }
  async touchPersistentCharacter(characterId) {
    const row = this.characters.find(item => item.id === characterId);
    if (!row) return null;
    row.lastSeenAt = this.now(); row.updatedAt = this.now();
    return this.clone(row);
  }

  async savePersistentCharacterUsage(input = {}) {
    let row = this.usages.find(item => item.characterId === input.characterId && item.productionId === input.productionId && (item.sourceCharacterId || null) === (input.sourceCharacterId || null));
    if (!row) {
      row = { id: input.id || this.nextId('character_usage'), ...this.clone(input), createdAt: input.createdAt || this.now(), updatedAt: this.now() };
      this.usages.push(row);
    } else Object.assign(row, this.clone(input), { updatedAt: this.now() });
    return this.clone(row);
  }
  async listPersistentCharacterUsages(characterId, limit = 250) { return this.clone(this.usages.filter(row => row.characterId === characterId).slice(-limit).reverse()); }
  async listProductionPersistentCharacters(productionId) {
    const usages = this.usages.filter(row => row.productionId === productionId);
    return this.clone(usages.map(usage => ({ ...(this.characters.find(character => character.id === usage.characterId) || {}), usage, reusedAcrossVideos: Boolean((this.characters.find(character => character.id === usage.characterId) || {}).createdFromProductionId !== productionId) })));
  }

  async savePersistentCharacterAlias(input = {}) {
    const namespace = input.namespace || 'default';
    let row = this.aliases.find(item => item.namespace === namespace && item.characterId === input.characterId && item.aliasKey === input.aliasKey);
    if (!row) {
      row = { id: input.id || this.nextId('character_alias'), ...this.clone(input), namespace, createdAt: input.createdAt || this.now(), updatedAt: this.now() };
      this.aliases.push(row);
    } else Object.assign(row, this.clone(input), { canonical: Boolean(row.canonical || input.canonical), updatedAt: this.now() });
    return this.clone(row);
  }
  async listPersistentCharacterAliases(characterId) { return this.clone(this.aliases.filter(row => row.characterId === characterId)); }
  async listPersistentCharacterAliasesByKey(namespace, aliasKey) { return this.clone(this.aliases.filter(row => row.namespace === (namespace || 'default') && row.aliasKey === aliasKey)); }
  async savePersistentCharacterOperatorAlias(input = {}) {
    const namespace = input.namespace || 'default';
    const same = this.aliases.find(row => row.namespace === namespace && row.characterId === input.characterId && row.aliasKey === input.aliasKey);
    if (same) return { status: 'no_change', alias: this.clone(same), conflictingCharacterIds: [] };
    const foreign = this.aliases.filter(row => row.namespace === namespace && row.aliasKey === input.aliasKey && row.characterId !== input.characterId);
    if (foreign.length) return { status: 'conflict', alias: null, conflictingCharacterIds: [...new Set(foreign.map(row => row.characterId))] };
    const alias = await this.savePersistentCharacterAlias(input);
    return { status: 'applied', alias, conflictingCharacterIds: [] };
  }

  async savePersistentCharacterResolution(input = {}) {
    let row = this.resolutions.find(item => item.productionId === input.productionId && item.scopeKey === input.scopeKey && item.referenceKey === input.referenceKey);
    if (!row) {
      row = { id: input.id || this.nextId('character_resolution'), ...this.clone(input), createdAt: input.createdAt || this.now(), updatedAt: this.now() };
      this.resolutions.push(row);
    } else Object.assign(row, this.clone(input), { updatedAt: this.now() });
    return this.clone(row);
  }
  async getPersistentCharacterResolution(id) { return this.clone(this.resolutions.find(row => row.id === id) || null); }
  async listPersistentCharacterResolutions(productionId) { return this.clone(this.resolutions.filter(row => row.productionId === productionId)); }
  async listPersistentCharacterResolutionsByCharacter(characterId, limit = 250) { return this.clone(this.resolutions.filter(row => row.characterId === characterId).slice(-limit).reverse()); }
  async listPendingPersistentCharacterResolutions(namespace = 'default', limit = 100) {
    return this.clone(this.resolutions.filter(row => row.namespace === namespace && ['unresolved', 'ambiguous'].includes(row.status)).slice(-limit).reverse());
  }
  async linkPersistentCharacterResolutionOperator(input = {}) {
    const row = this.resolutions.find(item => item.id === input.resolutionId);
    if (!row) return { status: 'not_found', resolution: null };
    if ((row.namespace || 'default') !== (input.namespace || row.namespace || 'default')) return { status: 'conflict', resolution: this.clone(row), reason: 'resolution_namespace_mismatch' };
    if (row.status === 'resolved' && row.characterId && row.characterId !== input.characterId) {
      return { status: 'conflict', resolution: this.clone(row), reason: 'resolution_concurrently_linked_to_different_character', currentCharacterId: row.characterId };
    }
    const wasSame = row.status === 'resolved' && row.characterId === input.characterId;
    Object.assign(row, { status: 'resolved', characterId: input.characterId, matchMode: 'operator_explicit_link', confidence: 1, candidateCharacterIds: [input.characterId], reason: 'operator_confirmed_reference_link', identityFingerprint: input.identityFingerprint, updatedAt: this.now() });
    return { status: wasSame ? 'no_change' : 'applied', resolution: this.clone(row) };
  }

  async savePersistentCharacterAsset(input = {}) {
    let row = this.assets.find(item => item.assetKey === input.assetKey);
    if (!row) {
      row = { id: input.id || this.nextId('character_asset'), ...this.clone(input), createdAt: input.createdAt || this.now(), updatedAt: this.now() };
      this.assets.push(row);
    } else row.updatedAt = this.now();
    return this.clone(row);
  }
  async getPersistentCharacterAsset(id) { return this.clone(this.assets.find(row => row.id === id) || null); }
  async getPersistentCharacterAssetByKey(assetKey) { return this.clone(this.assets.find(row => row.assetKey === assetKey) || null); }
  async getPersistentCharacterAssetByCharacter(characterId, role = 'character_reference') { return this.clone(this.assets.find(row => row.characterId === characterId && row.assetRole === role) || null); }
  async listPersistentCharacterAssets(characterId = null) { return this.clone(characterId ? this.assets.filter(row => row.characterId === characterId) : this.assets); }
  async listProductionPersistentCharacterAssets(productionId) {
    const ids = new Set(this.usages.filter(row => row.productionId === productionId).map(row => row.characterId));
    return this.clone(this.assets.filter(row => ids.has(row.characterId)));
  }

  async savePersistentCharacterAppearanceState(input = {}) {
    let row = this.states.find(item => item.productionId === input.productionId && item.characterId === input.characterId && item.scopeKey === input.scopeKey);
    if (!row) {
      row = { ...this.clone(input), createdAt: input.createdAt || this.now(), updatedAt: this.now() };
      this.states.push(row);
    } else Object.assign(row, this.clone(input), { updatedAt: this.now() });
    return this.clone(row);
  }
  async getPersistentCharacterAppearanceState(id) { return this.clone(this.states.find(row => row.id === id) || null); }
  async listProductionPersistentCharacterAppearanceStates(productionId) { return this.clone(this.states.filter(row => row.productionId === productionId)); }
  async listPersistentCharacterAppearanceStates(characterId) { return this.clone(this.states.filter(row => row.characterId === characterId)); }
  async getLatestDurablePersistentCharacterAppearanceState(characterId, excludeProductionId = null) {
    const rows = this.states.filter(row => row.characterId === characterId && row.persistence === 'until_changed' && row.productionId !== excludeProductionId);
    return this.clone(rows[rows.length - 1] || null);
  }

  async savePersistentCharacterBinding(input = {}) {
    const index = this.bindings.findIndex(row => row.id === input.id);
    const existing = index >= 0 ? this.bindings[index] : null;
    const row = { ...existing, ...this.clone(input), createdAt: existing?.createdAt || input.createdAt || this.now(), updatedAt: this.now() };
    if (index >= 0) this.bindings[index] = row; else this.bindings.push(row);
    return this.clone(row);
  }
  async getPersistentCharacterBinding(id) { return this.clone(this.bindings.find(row => row.id === id) || null); }
  async listProductionPersistentCharacterBindings(productionId) { return this.clone(this.bindings.filter(row => row.productionId === productionId)); }
  async listShotPersistentCharacterBindings(productionId, shotId) { return this.clone(this.bindings.filter(row => row.productionId === productionId && row.shotId === shotId)); }
  async listPersistentCharacterBindingsByCharacter(characterId, limit = 250) { return this.clone(this.bindings.filter(row => row.characterId === characterId).slice(-limit).reverse()); }
  async pruneProductionPersistentCharacterBindings(productionId, keepIds = []) {
    const keep = new Set((keepIds || []).filter(Boolean));
    this.bindings = this.bindings.filter(row => row.productionId !== productionId || keep.has(row.id));
    return true;
  }

  async saveCrossVideoCharacterContinuityCheck(input = {}) {
    const row = { id: input.id || this.nextId('character_cross'), ...this.clone(input), createdAt: input.createdAt || this.now() };
    this.cross.push(row);
    return this.clone(row);
  }
  async getLatestCrossVideoCharacterContinuityCheck(productionId, keyframeId, characterId = null) {
    const rows = this.cross.filter(row => row.productionId === productionId && row.keyframeId === keyframeId && (!characterId || row.characterId === characterId));
    return this.clone(rows[rows.length - 1] || null);
  }
  async listCrossVideoCharacterContinuityChecks(productionId) { return this.clone(this.cross.filter(row => row.productionId === productionId)); }
  async listCrossVideoCharacterContinuityChecksByCharacter(characterId, limit = 250) { return this.clone(this.cross.filter(row => row.characterId === characterId).slice(-limit).reverse()); }

  async savePersistentCharacterOperatorAction(input = {}) {
    const row = { id: input.id || this.nextId('character_action'), ...this.clone(input), createdAt: input.createdAt || this.now() };
    this.actions.push(row);
    return this.clone(row);
  }
  async getPersistentCharacterOperatorAction(id) { return this.clone(this.actions.find(row => row.id === id) || null); }
  async listPersistentCharacterOperatorActions(characterId = null, namespace = 'default', limit = 250) {
    return this.clone(this.actions.filter(row => row.namespace === namespace && (!characterId || row.characterId === characterId)).slice(-limit).reverse());
  }
}

module.exports = { MemoryCharacterDb };
