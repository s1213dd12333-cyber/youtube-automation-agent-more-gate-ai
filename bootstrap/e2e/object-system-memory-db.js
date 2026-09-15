'use strict';

class MemoryObjectDb {
  constructor() {
    this.objects = [];
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
  now() { this.clock += 1; return `2026-09-15T20:${String(Math.floor(this.clock / 60)).padStart(2, '0')}:${String(this.clock % 60).padStart(2, '0')}.000Z`; }
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  async getPersistentWorldObjectByFingerprint(namespace, fingerprint) {
    return this.clone(this.objects.find(row => row.namespace === namespace && row.identityFingerprint === fingerprint) || null);
  }
  async getPersistentWorldObjectByKey(namespace, objectKey) {
    return this.clone(this.objects.find(row => row.namespace === namespace && row.objectKey === objectKey) || null);
  }
  async getPersistentWorldObject(id) { return this.clone(this.objects.find(row => row.id === id) || null); }
  async listPersistentWorldObjects(namespace = 'default') { return this.clone(this.objects.filter(row => row.namespace === namespace)); }
  async savePersistentWorldObject(input = {}) {
    const index = this.objects.findIndex(row => row.id === input.id);
    const existing = index >= 0 ? this.objects[index] : null;
    const row = { ...existing, ...this.clone(input), createdAt: existing?.createdAt || input.createdAt || this.now(), updatedAt: this.now() };
    if (index >= 0) this.objects[index] = row; else this.objects.push(row);
    return this.clone(row);
  }

  async savePersistentWorldObjectUsage(input = {}) {
    let row = this.usages.find(item => item.objectId === input.objectId && item.productionId === input.productionId && item.scopeKey === input.scopeKey && (item.sourceRef || null) === (input.sourceRef || null));
    if (!row) {
      row = { id: input.id || this.nextId('usage'), ...this.clone(input), createdAt: this.now(), updatedAt: this.now() };
      this.usages.push(row);
    } else Object.assign(row, this.clone(input), { updatedAt: this.now() });
    return this.clone(row);
  }
  async listPersistentWorldObjectUsages(objectId) { return this.clone(this.usages.filter(row => row.objectId === objectId)); }
  async listProductionPersistentWorldObjects(productionId) {
    const usages = this.usages.filter(row => row.productionId === productionId);
    return this.clone(usages.map(usage => ({ ...(this.objects.find(object => object.id === usage.objectId) || {}), usage })));
  }

  async savePersistentWorldObjectAlias(input = {}) {
    let row = this.aliases.find(item => item.namespace === (input.namespace || 'default') && item.objectId === input.objectId && item.aliasKey === input.aliasKey);
    if (!row) {
      row = { id: input.id || this.nextId('alias'), ...this.clone(input), createdAt: this.now(), updatedAt: this.now() };
      this.aliases.push(row);
    } else Object.assign(row, this.clone(input), { canonical: Boolean(row.canonical || input.canonical), updatedAt: this.now() });
    return this.clone(row);
  }
  async listPersistentWorldObjectAliases(objectId) { return this.clone(this.aliases.filter(row => row.objectId === objectId)); }
  async listPersistentWorldObjectAliasesByKey(namespace, aliasKey) { return this.clone(this.aliases.filter(row => row.namespace === (namespace || 'default') && row.aliasKey === aliasKey)); }
  async savePersistentWorldObjectOperatorAlias(input = {}) {
    const namespace = input.namespace || 'default';
    const same = this.aliases.find(row => row.namespace === namespace && row.objectId === input.objectId && row.aliasKey === input.aliasKey);
    if (same) return { status: 'no_change', alias: this.clone(same), conflictingObjectIds: [] };
    const foreign = this.aliases.filter(row => row.namespace === namespace && row.aliasKey === input.aliasKey && row.objectId !== input.objectId);
    if (foreign.length) return { status: 'conflict', alias: null, conflictingObjectIds: [...new Set(foreign.map(row => row.objectId))] };
    const alias = await this.savePersistentWorldObjectAlias(input);
    return { status: 'applied', alias, conflictingObjectIds: [] };
  }

  async savePersistentWorldObjectResolution(input = {}) {
    let row = this.resolutions.find(item => item.productionId === input.productionId && item.scopeKey === input.scopeKey && item.referenceKey === input.referenceKey);
    if (!row) {
      row = { id: input.id || this.nextId('resolution'), ...this.clone(input), createdAt: this.now(), updatedAt: this.now() };
      this.resolutions.push(row);
    } else Object.assign(row, this.clone(input), { updatedAt: this.now() });
    return this.clone(row);
  }
  async getPersistentWorldObjectResolution(id) { return this.clone(this.resolutions.find(row => row.id === id) || null); }
  async listPersistentWorldObjectResolutions(productionId) { return this.clone(this.resolutions.filter(row => row.productionId === productionId)); }
  async listPersistentWorldObjectResolutionsByObject(objectId, limit = 250) { return this.clone(this.resolutions.filter(row => row.objectId === objectId).slice(-limit).reverse()); }
  async listPendingPersistentWorldObjectResolutions(namespace = 'default', limit = 100) {
    return this.clone(this.resolutions.filter(row => row.namespace === namespace && ['unresolved', 'ambiguous'].includes(row.status)).slice(-limit).reverse());
  }
  async linkPersistentWorldObjectResolutionOperator(input = {}) {
    const row = this.resolutions.find(item => item.id === input.resolutionId);
    if (!row) return { status: 'not_found', resolution: null };
    if ((row.namespace || 'default') !== (input.namespace || row.namespace || 'default')) return { status: 'conflict', resolution: this.clone(row), reason: 'resolution_namespace_mismatch' };
    if (row.status === 'resolved' && row.objectId && row.objectId !== input.objectId) {
      return { status: 'conflict', resolution: this.clone(row), reason: 'resolution_concurrently_linked_to_different_object', currentObjectId: row.objectId };
    }
    const wasSame = row.status === 'resolved' && row.objectId === input.objectId;
    Object.assign(row, { status: 'resolved', objectId: input.objectId, matchMode: 'operator_explicit_link', confidence: 1, candidateObjectIds: [input.objectId], reason: 'operator_confirmed_reference_link', identityFingerprint: input.identityFingerprint, updatedAt: this.now() });
    return { status: wasSame ? 'no_change' : 'applied', resolution: this.clone(row) };
  }

  async savePersistentWorldObjectAsset(input = {}) {
    let row = this.assets.find(item => item.assetKey === input.assetKey);
    if (!row) {
      row = { id: input.id || this.nextId('asset'), ...this.clone(input), createdAt: this.now(), updatedAt: this.now() };
      this.assets.push(row);
    } else Object.assign(row, this.clone(input), { updatedAt: this.now() });
    return this.clone(row);
  }
  async getPersistentWorldObjectAssetByKey(assetKey) { return this.clone(this.assets.find(row => row.assetKey === assetKey) || null); }
  async getPersistentWorldObjectAsset(id) { return this.clone(this.assets.find(row => row.id === id) || null); }
  async getPersistentWorldObjectAssetByObject(objectId, role = 'object_reference') { return this.clone(this.assets.find(row => row.objectId === objectId && row.assetRole === role) || null); }
  async listPersistentWorldObjectAssets(objectId) { return this.clone(this.assets.filter(row => row.objectId === objectId)); }

  async savePersistentWorldObjectState(input = {}) {
    const index = this.states.findIndex(row => row.id === input.id);
    const existing = index >= 0 ? this.states[index] : null;
    const row = { ...existing, ...this.clone(input), createdAt: existing?.createdAt || input.createdAt || this.now(), updatedAt: this.now() };
    if (index >= 0) this.states[index] = row; else this.states.push(row);
    return this.clone(row);
  }
  async getPersistentWorldObjectState(id) { return this.clone(this.states.find(row => row.id === id) || null); }
  async listPersistentWorldObjectStates(objectId) { return this.clone(this.states.filter(row => row.objectId === objectId)); }
  async getLatestDurablePersistentWorldObjectState(objectId, excludedProductionId = null) {
    const rows = this.states.filter(row => row.objectId === objectId && row.persistence === 'until_changed' && row.productionId !== excludedProductionId);
    return this.clone(rows[rows.length - 1] || null);
  }

  async savePersistentWorldObjectBinding(input = {}) {
    const index = this.bindings.findIndex(row => row.id === input.id);
    const existing = index >= 0 ? this.bindings[index] : null;
    const row = { ...existing, ...this.clone(input), createdAt: existing?.createdAt || input.createdAt || this.now(), updatedAt: this.now() };
    if (index >= 0) this.bindings[index] = row; else this.bindings.push(row);
    return this.clone(row);
  }
  async listShotPersistentWorldObjectBindings(productionId, shotId) { return this.clone(this.bindings.filter(row => row.productionId === productionId && row.shotId === shotId)); }
  async listPersistentWorldObjectBindingsByObject(objectId, limit = 250) { return this.clone(this.bindings.filter(row => row.objectId === objectId).slice(-limit).reverse()); }

  async saveCrossVideoObjectContinuityCheck(input = {}) {
    const row = { id: input.id || this.nextId('cross'), ...this.clone(input), createdAt: input.createdAt || this.now() };
    this.cross.push(row);
    return this.clone(row);
  }
  async getLatestCrossVideoObjectContinuityCheck(productionId, keyframeId, objectId = null) {
    const rows = this.cross.filter(row => row.productionId === productionId && row.keyframeId === keyframeId && (!objectId || row.objectId === objectId));
    return this.clone(rows[rows.length - 1] || null);
  }
  async listCrossVideoObjectContinuityChecks(productionId) { return this.clone(this.cross.filter(row => row.productionId === productionId)); }
  async listCrossVideoObjectContinuityChecksByObject(objectId, limit = 250) { return this.clone(this.cross.filter(row => row.objectId === objectId).slice(-limit).reverse()); }

  async savePersistentWorldObjectOperatorAction(input = {}) {
    const row = { id: input.id || this.nextId('action'), ...this.clone(input), createdAt: input.createdAt || this.now() };
    this.actions.push(row);
    return this.clone(row);
  }
  async getPersistentWorldObjectOperatorAction(id) { return this.clone(this.actions.find(row => row.id === id) || null); }
  async listPersistentWorldObjectOperatorActions(objectId = null, namespace = 'default', limit = 250) {
    return this.clone(this.actions.filter(row => row.namespace === namespace && (!objectId || row.objectId === objectId)).slice(-limit).reverse());
  }
}

module.exports = { MemoryObjectDb };
