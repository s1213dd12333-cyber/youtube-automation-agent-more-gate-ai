'use strict';

const VERSION = '11.11.7';

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

class PersistentCharacterLibraryManagerV11 {
  constructor(db, options = {}) {
    this.db = db;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.enabled = String(options.enabled ?? process.env.PERSISTENT_CHARACTER_LIBRARY_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.operatorControls = String(options.operatorControls ?? process.env.PERSISTENT_CHARACTER_OPERATOR_CONTROLS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.allowAlias = String(options.allowAlias ?? process.env.PERSISTENT_CHARACTER_OPERATOR_ALIAS_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.allowLink = String(options.allowLink ?? process.env.PERSISTENT_CHARACTER_OPERATOR_LINK_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  async characterSummary(character) {
    const [aliases, assets, usages, states, continuity] = await Promise.all([
      this.db?.listPersistentCharacterAliases ? this.db.listPersistentCharacterAliases(character.id) : [],
      this.db?.listPersistentCharacterAssets ? this.db.listPersistentCharacterAssets(character.id) : [],
      this.db?.listPersistentCharacterUsages ? this.db.listPersistentCharacterUsages(character.id) : [],
      this.db?.listPersistentCharacterAppearanceStates ? this.db.listPersistentCharacterAppearanceStates(character.id) : [],
      this.db?.listCrossVideoCharacterContinuityChecksByCharacter ? this.db.listCrossVideoCharacterContinuityChecksByCharacter(character.id, 50) : []
    ]);
    const canonicalAsset = (assets || []).find(asset => asset?.canonical === true && asset.status === 'ready' && asset.assetRole === 'character_reference') ||
      (assets || []).find(asset => asset?.canonical === true && asset.status === 'ready') || null;
    const latestState = latestByCreatedAt(states);
    const latestContinuity = latestByCreatedAt(continuity);
    const productionCount = uniqueProductionCount(usages);
    return {
      id: character.id,
      namespace: character.namespace || 'default',
      characterKey: character.characterKey,
      displayName: character.displayName,
      speciesType: character.speciesType || 'character',
      status: character.status || 'active',
      identityFingerprint: character.identityFingerprint,
      createdFromProductionId: character.createdFromProductionId || null,
      aliases: aliases || [],
      assets: (assets || []).map(asset => ({ ...asset, assetUrl: asset?.id ? `/api/character-library/assets/${encodeURIComponent(asset.id)}` : null })),
      usageCount: (usages || []).length,
      productionCount,
      crossVideo: productionCount > 1,
      latestState,
      latestContinuity,
      canonicalReady: Boolean(canonicalAsset)
    };
  }

  async getSnapshot(namespace = 'default') {
    if (!this.enabled) return { version: VERSION, active: false, characters: [], actions: [], pendingResolutions: [], summary: { characterCount: 0, canonicalReady: 0, crossVideoCharacters: 0, blockedContinuity: 0 } };
    const characters = this.db?.listPersistentCharacters ? await this.db.listPersistentCharacters(namespace || 'default', 1000) : [];
    const summaries = [];
    for (const character of characters || []) summaries.push(await this.characterSummary(character));
    const [actions, pendingResolutions] = await Promise.all([
      this.db?.listPersistentCharacterOperatorActions ? this.db.listPersistentCharacterOperatorActions(null, namespace || 'default', 100) : [],
      this.db?.listPendingPersistentCharacterResolutions ? this.db.listPendingPersistentCharacterResolutions(namespace || 'default', 100) : []
    ]);
    return {
      version: VERSION, active: true, namespace: namespace || 'default', characters: summaries,
      actions: actions || [], pendingResolutions: pendingResolutions || [],
      summary: {
        characterCount: summaries.length,
        canonicalReady: summaries.filter(item => item.canonicalReady).length,
        crossVideoCharacters: summaries.filter(item => item.crossVideo).length,
        blockedContinuity: summaries.filter(item => item.latestContinuity && item.latestContinuity.accepted === false).length,
        operatorActions: (actions || []).length,
        pendingResolutions: (pendingResolutions || []).length
      }
    };
  }

  async detail(characterId) {
    if (!this.enabled || !characterId || !this.db?.getPersistentCharacter) return null;
    const character = await this.db.getPersistentCharacter(characterId);
    if (!character) return null;
    const [aliases, assets, states, usages, bindings, continuityChecks, resolutions, operatorActions, pendingResolutions] = await Promise.all([
      this.db?.listPersistentCharacterAliases ? this.db.listPersistentCharacterAliases(characterId) : [],
      this.db?.listPersistentCharacterAssets ? this.db.listPersistentCharacterAssets(characterId) : [],
      this.db?.listPersistentCharacterAppearanceStates ? this.db.listPersistentCharacterAppearanceStates(characterId) : [],
      this.db?.listPersistentCharacterUsages ? this.db.listPersistentCharacterUsages(characterId) : [],
      this.db?.listPersistentCharacterBindingsByCharacter ? this.db.listPersistentCharacterBindingsByCharacter(characterId, 250) : [],
      this.db?.listCrossVideoCharacterContinuityChecksByCharacter ? this.db.listCrossVideoCharacterContinuityChecksByCharacter(characterId, 250) : [],
      this.db?.listPersistentCharacterResolutionsByCharacter ? this.db.listPersistentCharacterResolutionsByCharacter(characterId, 250) : [],
      this.db?.listPersistentCharacterOperatorActions ? this.db.listPersistentCharacterOperatorActions(characterId, character.namespace || 'default', 250) : [],
      this.db?.listPendingPersistentCharacterResolutions ? this.db.listPendingPersistentCharacterResolutions(character.namespace || 'default', 100) : []
    ]);
    const summary = await this.characterSummary(character);
    return {
      ...summary, character,
      aliases: aliases || [],
      assets: (assets || []).map(asset => ({ ...asset, assetUrl: asset?.id ? `/api/character-library/assets/${encodeURIComponent(asset.id)}` : null })),
      states: states || [], usages: usages || [], bindings: bindings || [], continuityChecks: continuityChecks || [],
      resolutions: resolutions || [], operatorActions: operatorActions || [], pendingResolutions: pendingResolutions || []
    };
  }

  async audit(input = {}) {
    if (!this.db?.savePersistentCharacterOperatorAction) return null;
    return this.db.savePersistentCharacterOperatorAction({
      namespace: input.namespace || 'default', actionType: input.actionType, characterId: input.characterId || null,
      targetType: input.targetType || 'character', targetId: input.targetId || input.characterId || null,
      productionId: input.productionId || null, status: input.status || 'recorded',
      actor: clean(input.actor || 'operator', 240) || 'operator', note: clean(input.note || '', 1000) || null,
      beforeValue: input.beforeValue || {}, afterValue: input.afterValue || {}, reason: input.reason || null
    });
  }

  async addAlias(input = {}) {
    if (!this.operatorControls || !this.allowAlias) throw new Error('Persistent character alias controls are disabled');
    const character = this.db?.getPersistentCharacter ? await this.db.getPersistentCharacter(input.characterId) : null;
    if (!character?.id) throw new Error('Persistent character not found');
    const aliasText = clean(input.aliasText, 240); const aliasKey = normalize(aliasText);
    if (!aliasText || !aliasKey) throw new Error('Alias text is required');
    const collisions = this.db?.listPersistentCharacterAliasesByKey ? await this.db.listPersistentCharacterAliasesByKey(character.namespace || 'default', aliasKey) : [];
    const foreign = (collisions || []).filter(row => row.characterId && row.characterId !== character.id);
    if (foreign.length) {
      await this.audit({ namespace: character.namespace, actionType:'add_alias', characterId:character.id, targetType:'alias', targetId:aliasKey, status:'rejected', actor:input.actor, note:input.note, beforeValue:{ collisions: foreign.map(row => row.characterId) }, reason:'alias_key_already_points_to_other_character' });
      return { status:'conflict', applied:false, reason:'alias_key_already_points_to_other_character', conflictingCharacterIds:[...new Set(foreign.map(row => row.characterId))] };
    }
    const atomic = this.db?.savePersistentCharacterOperatorAlias ? await this.db.savePersistentCharacterOperatorAlias({ namespace:character.namespace || 'default', characterId:character.id, aliasText, aliasKey, canonical:false, sourceKind:'operator_confirmed_alias' }) : null;
    if (atomic?.status === 'conflict') {
      await this.audit({ namespace:character.namespace, actionType:'add_alias', characterId:character.id, targetType:'alias', targetId:aliasKey, status:'rejected', actor:input.actor, note:input.note, beforeValue:{ collisions:atomic.conflictingCharacterIds || [] }, reason:'alias_key_concurrent_collision' });
      return { status:'conflict', applied:false, reason:'alias_key_concurrent_collision', conflictingCharacterIds:atomic.conflictingCharacterIds || [] };
    }
    const alias = atomic?.alias || (this.db?.savePersistentCharacterAlias ? await this.db.savePersistentCharacterAlias({ namespace:character.namespace || 'default', characterId:character.id, aliasText, aliasKey, canonical:false, sourceKind:'operator_confirmed_alias' }) : null);
    const status = atomic?.status === 'no_change' || (collisions || []).some(row => row.characterId === character.id) ? 'no_change' : 'applied';
    await this.audit({ namespace:character.namespace, actionType:'add_alias', characterId:character.id, targetType:'alias', targetId:alias?.id || aliasKey, status, actor:input.actor, note:input.note, afterValue:alias || {}, reason:status === 'no_change' ? 'alias_already_linked_to_character' : 'operator_confirmed_alias' });
    return { status, applied:status === 'applied', alias };
  }

  async linkResolution(input = {}) {
    if (!this.operatorControls || !this.allowLink) throw new Error('Persistent character link controls are disabled');
    if (!input.resolutionId || !input.characterId) throw new Error('resolutionId and characterId are required');
    const [resolution, character] = await Promise.all([
      this.db?.getPersistentCharacterResolution ? this.db.getPersistentCharacterResolution(input.resolutionId) : null,
      this.db?.getPersistentCharacter ? this.db.getPersistentCharacter(input.characterId) : null
    ]);
    if (!resolution) throw new Error('Persistent character resolution not found');
    if (!character) throw new Error('Persistent character not found');
    if ((resolution.namespace || 'default') !== (character.namespace || 'default')) throw new Error('Resolution and character namespace do not match');
    if (resolution.status === 'resolved' && resolution.characterId && resolution.characterId !== character.id) {
      await this.audit({ namespace:character.namespace, actionType:'link_resolution', characterId:character.id, targetType:'resolution', targetId:resolution.id, productionId:resolution.productionId, status:'rejected', actor:input.actor, note:input.note, beforeValue:resolution, reason:'resolution_already_resolved_to_different_character' });
      return { status:'conflict', applied:false, reason:'resolution_already_resolved_to_different_character', currentCharacterId:resolution.characterId };
    }
    if (!['unresolved','ambiguous','resolved'].includes(resolution.status)) return { status:'conflict', applied:false, reason:'resolution_status_not_operator_linkable' };

    let alias = null;
    if (input.persistAlias === true && resolution.referenceText) {
      const aliasKey = normalize(resolution.referenceText);
      const collisions = this.db?.listPersistentCharacterAliasesByKey ? await this.db.listPersistentCharacterAliasesByKey(character.namespace || 'default', aliasKey) : [];
      const foreign = (collisions || []).filter(row => row.characterId && row.characterId !== character.id);
      if (foreign.length) return { status:'conflict', applied:false, reason:'requested_alias_is_ambiguous', conflictingCharacterIds:[...new Set(foreign.map(row => row.characterId))] };
      const atomicAlias = this.db?.savePersistentCharacterOperatorAlias ? await this.db.savePersistentCharacterOperatorAlias({ namespace:character.namespace || 'default', characterId:character.id, aliasText:resolution.referenceText, aliasKey, canonical:false, sourceKind:'operator_resolution_link' }) : null;
      if (atomicAlias?.status === 'conflict') return { status:'conflict', applied:false, reason:'requested_alias_concurrent_collision', conflictingCharacterIds:atomicAlias.conflictingCharacterIds || [] };
      alias = atomicAlias?.alias || null;
    }

    const atomicLink = this.db?.linkPersistentCharacterResolutionOperator ? await this.db.linkPersistentCharacterResolutionOperator({ resolutionId:resolution.id, namespace:resolution.namespace || character.namespace || 'default', characterId:character.id, identityFingerprint:character.identityFingerprint }) : null;
    if (atomicLink?.status === 'conflict') {
      await this.audit({ namespace:character.namespace, actionType:'link_resolution', characterId:character.id, targetType:'resolution', targetId:resolution.id, productionId:resolution.productionId, status:'rejected', actor:input.actor, note:input.note, beforeValue:resolution, afterValue:atomicLink.resolution || {}, reason:atomicLink.reason || 'resolution_concurrently_linked_to_different_character' });
      return { status:'conflict', applied:false, reason:atomicLink.reason || 'resolution_concurrently_linked_to_different_character', currentCharacterId:atomicLink.currentCharacterId || null };
    }
    const updated = atomicLink?.resolution || (this.db?.savePersistentCharacterResolution ? await this.db.savePersistentCharacterResolution({ namespace:resolution.namespace || 'default', productionId:resolution.productionId, scopeKey:resolution.scopeKey, referenceText:resolution.referenceText || '', referenceKey:resolution.referenceKey || normalize(resolution.referenceText || ''), requestedSpecies:resolution.requestedSpecies || character.speciesType || null, status:'resolved', characterId:character.id, matchMode:'operator_explicit_link', confidence:1, candidateCharacterIds:[character.id], reason:'operator_confirmed_reference_link', identityFingerprint:character.identityFingerprint }) : null);
    const status = atomicLink?.status || (resolution.status === 'resolved' && resolution.characterId === character.id ? 'no_change' : 'applied');
    await this.audit({ namespace:character.namespace, actionType:'link_resolution', characterId:character.id, targetType:'resolution', targetId:resolution.id, productionId:resolution.productionId, status, actor:input.actor, note:input.note, beforeValue:resolution, afterValue:updated || {}, reason:'operator_confirmed_reference_link' });
    return { status, applied:status === 'applied', resolution:updated, alias };
  }
}

module.exports = { PERSISTENT_CHARACTER_LIBRARY_VERSION: VERSION, PersistentCharacterLibraryManagerV11, clean, normalize, uniqueProductionCount, latestByCreatedAt };
