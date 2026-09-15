'use strict';

const VERSION = '11.10.7';

function clean(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalize(value) {
  return clean(value, 1000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueProductionCount(usages = []) {
  return new Set((Array.isArray(usages) ? usages : []).map(row => row?.productionId).filter(Boolean)).size;
}

function latestByCreatedAt(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))[0] || null;
}

class PersistentWorldObjectLibraryManagerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_WORLD_OBJECT_LIBRARY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.operatorControls = String(options.operatorControls ?? process.env.PERSISTENT_WORLD_OBJECT_OPERATOR_CONTROLS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.allowAlias = String(options.allowAlias ?? process.env.PERSISTENT_WORLD_OBJECT_OPERATOR_ALIAS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.allowLink = String(options.allowLink ?? process.env.PERSISTENT_WORLD_OBJECT_OPERATOR_LINK_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  async objectSummary(object) {
    const [aliases, assets, usages, states, continuity] = await Promise.all([
      this.db?.listPersistentWorldObjectAliases ? this.db.listPersistentWorldObjectAliases(object.id) : [],
      this.db?.listPersistentWorldObjectAssets ? this.db.listPersistentWorldObjectAssets(object.id) : [],
      this.db?.listPersistentWorldObjectUsages ? this.db.listPersistentWorldObjectUsages(object.id) : [],
      this.db?.listPersistentWorldObjectStates ? this.db.listPersistentWorldObjectStates(object.id) : [],
      this.db?.listCrossVideoObjectContinuityChecksByObject ? this.db.listCrossVideoObjectContinuityChecksByObject(object.id, 50) : []
    ]);
    const canonicalAsset = (assets || []).find(asset => asset?.canonical === true && asset.status === 'ready' && asset.assetRole === 'object_reference') ||
      (assets || []).find(asset => asset?.canonical === true && asset.status === 'ready') || null;
    const latestState = latestByCreatedAt(states);
    const latestContinuity = latestByCreatedAt(continuity);
    const productionCount = uniqueProductionCount(usages);
    return {
      id: object.id,
      namespace: object.namespace || 'default',
      objectKey: object.objectKey,
      displayName: object.displayName,
      objectType: object.objectType || 'object',
      status: object.status || 'registered',
      identityFingerprint: object.identityFingerprint,
      createdFromProductionId: object.createdFromProductionId || null,
      canonicalLocationId: object.canonicalLocationId || null,
      canonicalZoneId: object.canonicalZoneId || null,
      aliases: aliases || [],
      assets: (assets || []).map(asset => ({ ...asset, assetUrl: asset?.id ? `/api/object-library/assets/${encodeURIComponent(asset.id)}` : null })),
      usageCount: (usages || []).length,
      productionCount,
      crossVideo: productionCount > 1,
      latestState,
      latestContinuity,
      canonicalReady: Boolean(canonicalAsset)
    };
  }

  async getSnapshot(namespace = 'default') {
    if (!this.enabled) return { version: VERSION, active: false, objects: [], actions: [], summary: { objectCount: 0, canonicalReady: 0, crossVideoObjects: 0, blockedContinuity: 0 } };
    const objects = this.db?.listPersistentWorldObjects ? await this.db.listPersistentWorldObjects(namespace || 'default') : [];
    const summaries = [];
    for (const object of objects || []) summaries.push(await this.objectSummary(object));
    const [actions, pendingResolutions] = await Promise.all([
      this.db?.listPersistentWorldObjectOperatorActions ? this.db.listPersistentWorldObjectOperatorActions(null, namespace || 'default', 100) : [],
      this.db?.listPendingPersistentWorldObjectResolutions ? this.db.listPendingPersistentWorldObjectResolutions(namespace || 'default', 100) : []
    ]);
    return {
      version: VERSION,
      active: true,
      namespace: namespace || 'default',
      objects: summaries,
      actions: actions || [],
      pendingResolutions: pendingResolutions || [],
      summary: {
        objectCount: summaries.length,
        canonicalReady: summaries.filter(item => item.canonicalReady).length,
        crossVideoObjects: summaries.filter(item => item.crossVideo).length,
        blockedContinuity: summaries.filter(item => item.latestContinuity && item.latestContinuity.accepted === false).length,
        operatorActions: (actions || []).length,
        pendingResolutions: (pendingResolutions || []).length
      }
    };
  }

  async detail(objectId) {
    if (!this.enabled || !objectId || !this.db?.getPersistentWorldObject) return null;
    const object = await this.db.getPersistentWorldObject(objectId);
    if (!object) return null;
    const [aliases, assets, states, usages, bindings, continuityChecks, resolutions, operatorActions, pendingResolutions] = await Promise.all([
      this.db?.listPersistentWorldObjectAliases ? this.db.listPersistentWorldObjectAliases(objectId) : [],
      this.db?.listPersistentWorldObjectAssets ? this.db.listPersistentWorldObjectAssets(objectId) : [],
      this.db?.listPersistentWorldObjectStates ? this.db.listPersistentWorldObjectStates(objectId) : [],
      this.db?.listPersistentWorldObjectUsages ? this.db.listPersistentWorldObjectUsages(objectId) : [],
      this.db?.listPersistentWorldObjectBindingsByObject ? this.db.listPersistentWorldObjectBindingsByObject(objectId, 250) : [],
      this.db?.listCrossVideoObjectContinuityChecksByObject ? this.db.listCrossVideoObjectContinuityChecksByObject(objectId, 250) : [],
      this.db?.listPersistentWorldObjectResolutionsByObject ? this.db.listPersistentWorldObjectResolutionsByObject(objectId, 250) : [],
      this.db?.listPersistentWorldObjectOperatorActions ? this.db.listPersistentWorldObjectOperatorActions(objectId, object.namespace || 'default', 250) : [],
      this.db?.listPendingPersistentWorldObjectResolutions ? this.db.listPendingPersistentWorldObjectResolutions(object.namespace || 'default', 100) : []
    ]);
    const summary = await this.objectSummary(object);
    return {
      ...summary,
      object,
      aliases: aliases || [],
      assets: (assets || []).map(asset => ({ ...asset, assetUrl: asset?.id ? `/api/object-library/assets/${encodeURIComponent(asset.id)}` : null })),
      states: states || [],
      usages: usages || [],
      bindings: bindings || [],
      continuityChecks: continuityChecks || [],
      resolutions: resolutions || [],
      operatorActions: operatorActions || [],
      pendingResolutions: pendingResolutions || []
    };
  }

  async audit(input = {}) {
    if (!this.db?.savePersistentWorldObjectOperatorAction) return null;
    return this.db.savePersistentWorldObjectOperatorAction({
      namespace: input.namespace || 'default',
      actionType: input.actionType,
      objectId: input.objectId || null,
      targetType: input.targetType || 'object',
      targetId: input.targetId || input.objectId || null,
      productionId: input.productionId || null,
      status: input.status || 'recorded',
      actor: clean(input.actor || 'operator', 240) || 'operator',
      note: clean(input.note || '', 1000) || null,
      beforeValue: input.beforeValue || {},
      afterValue: input.afterValue || {},
      reason: input.reason || null
    });
  }

  async addAlias(input = {}) {
    if (!this.operatorControls || !this.allowAlias) throw new Error('Persistent world-object alias controls are disabled');
    const object = this.db?.getPersistentWorldObject ? await this.db.getPersistentWorldObject(input.objectId) : null;
    if (!object?.id) throw new Error('Persistent world object not found');
    const aliasText = clean(input.aliasText, 240);
    const aliasKey = normalize(aliasText);
    if (!aliasText || !aliasKey) throw new Error('Alias text is required');
    const collisions = this.db?.listPersistentWorldObjectAliasesByKey ? await this.db.listPersistentWorldObjectAliasesByKey(object.namespace || 'default', aliasKey) : [];
    const foreign = (collisions || []).filter(row => row.objectId && row.objectId !== object.id);
    if (foreign.length) {
      await this.audit({ namespace: object.namespace, actionType: 'add_alias', objectId: object.id, targetType: 'alias', targetId: aliasKey, status: 'rejected', actor: input.actor, note: input.note, beforeValue: { collisions: foreign.map(row => row.objectId) }, reason: 'alias_key_already_points_to_other_object' });
      return { status: 'conflict', applied: false, reason: 'alias_key_already_points_to_other_object', conflictingObjectIds: [...new Set(foreign.map(row => row.objectId))] };
    }
    const existingSame = (collisions || []).find(row => row.objectId === object.id) || null;
    const alias = this.db?.savePersistentWorldObjectAlias ? await this.db.savePersistentWorldObjectAlias({
      namespace: object.namespace || 'default', objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias'
    }) : { objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias' };
    await this.audit({ namespace: object.namespace, actionType: 'add_alias', objectId: object.id, targetType: 'alias', targetId: alias?.id || aliasKey, status: existingSame ? 'no_change' : 'applied', actor: input.actor, note: input.note, beforeValue: existingSame || {}, afterValue: alias || {}, reason: existingSame ? 'alias_already_linked_to_object' : 'operator_confirmed_alias' });
    return { status: existingSame ? 'no_change' : 'applied', applied: !existingSame, alias };
  }

  async linkResolution(input = {}) {
    if (!this.operatorControls || !this.allowLink) throw new Error('Persistent world-object link controls are disabled');
    if (!input.resolutionId || !input.objectId) throw new Error('resolutionId and objectId are required');
    const [resolution, object] = await Promise.all([
      this.db?.getPersistentWorldObjectResolution ? this.db.getPersistentWorldObjectResolution(input.resolutionId) : null,
      this.db?.getPersistentWorldObject ? this.db.getPersistentWorldObject(input.objectId) : null
    ]);
    if (!resolution) throw new Error('Persistent world-object resolution not found');
    if (!object) throw new Error('Persistent world object not found');
    if ((resolution.namespace || 'default') !== (object.namespace || 'default')) throw new Error('Resolution and object namespace do not match');
    if (resolution.status === 'resolved' && resolution.objectId && resolution.objectId !== object.id) {
      await this.audit({ namespace: object.namespace, actionType: 'link_resolution', objectId: object.id, targetType: 'resolution', targetId: resolution.id, productionId: resolution.productionId, status: 'rejected', actor: input.actor, note: input.note, beforeValue: resolution, reason: 'resolution_already_resolved_to_different_object' });
      return { status: 'conflict', applied: false, reason: 'resolution_already_resolved_to_different_object', currentObjectId: resolution.objectId };
    }
    if (!['unresolved', 'ambiguous', 'resolved'].includes(resolution.status)) {
      return { status: 'conflict', applied: false, reason: 'resolution_status_not_operator_linkable' };
    }

    let alias = null;
    if (input.persistAlias === true && resolution.referenceText) {
      const aliasKey = normalize(resolution.referenceText);
      const collisions = this.db?.listPersistentWorldObjectAliasesByKey ? await this.db.listPersistentWorldObjectAliasesByKey(object.namespace || 'default', aliasKey) : [];
      const foreign = (collisions || []).filter(row => row.objectId && row.objectId !== object.id);
      if (foreign.length) {
        await this.audit({ namespace: object.namespace, actionType: 'link_resolution', objectId: object.id, targetType: 'resolution', targetId: resolution.id, productionId: resolution.productionId, status: 'rejected', actor: input.actor, note: input.note, beforeValue: resolution, reason: 'requested_alias_is_ambiguous' });
        return { status: 'conflict', applied: false, reason: 'requested_alias_is_ambiguous', conflictingObjectIds: [...new Set(foreign.map(row => row.objectId))] };
      }
      alias = this.db?.savePersistentWorldObjectAlias ? await this.db.savePersistentWorldObjectAlias({ namespace: object.namespace || 'default', objectId: object.id, aliasText: resolution.referenceText, aliasKey, canonical: false, sourceKind: 'operator_resolution_link' }) : null;
    }

    const updated = this.db?.savePersistentWorldObjectResolution ? await this.db.savePersistentWorldObjectResolution({
      namespace: resolution.namespace || object.namespace || 'default',
      productionId: resolution.productionId,
      scopeKey: resolution.scopeKey,
      referenceText: resolution.referenceText || '',
      referenceKey: resolution.referenceKey || normalize(resolution.referenceText || ''),
      requestedType: resolution.requestedType || object.objectType || null,
      status: 'resolved',
      objectId: object.id,
      matchMode: 'operator_explicit_link',
      confidence: 1,
      candidateObjectIds: [object.id],
      reason: 'operator_confirmed_reference_link',
      identityFingerprint: object.identityFingerprint
    }) : { ...resolution, status: 'resolved', objectId: object.id, matchMode: 'operator_explicit_link', confidence: 1, candidateObjectIds: [object.id], reason: 'operator_confirmed_reference_link', identityFingerprint: object.identityFingerprint };

    await this.audit({ namespace: object.namespace, actionType: 'link_resolution', objectId: object.id, targetType: 'resolution', targetId: resolution.id, productionId: resolution.productionId, status: resolution.status === 'resolved' && resolution.objectId === object.id ? 'no_change' : 'applied', actor: input.actor, note: input.note, beforeValue: resolution, afterValue: updated, reason: 'operator_confirmed_reference_link' });
    return { status: resolution.status === 'resolved' && resolution.objectId === object.id ? 'no_change' : 'applied', applied: !(resolution.status === 'resolved' && resolution.objectId === object.id), resolution: updated, alias };
  }
}

module.exports = {
  PERSISTENT_WORLD_OBJECT_LIBRARY_VERSION: VERSION,
  PersistentWorldObjectLibraryManagerV11,
  clean,
  normalize,
  uniqueProductionCount,
  latestByCreatedAt
};
