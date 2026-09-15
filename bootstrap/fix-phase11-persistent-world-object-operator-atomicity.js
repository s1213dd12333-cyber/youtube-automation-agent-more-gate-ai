'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.10.7 atomicity anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 11.10.7 atomicity anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

function patchDatabase() {
  const rel = 'database/db.js';
  let s = read(rel);
  const methods = `  async savePersistentWorldObjectOperatorAlias(input = {}) {
    if (!input.objectId || !input.aliasKey) return { status: 'invalid', alias: null, conflictingObjectIds: [] };
    const namespace = input.namespace || 'default';
    const existingSame = await this.getRow('SELECT * FROM persistent_world_object_aliases WHERE namespace = ? AND object_id = ? AND alias_key = ? LIMIT 1', [namespace, input.objectId, input.aliasKey]);
    if (existingSame) return { status: 'no_change', alias: this.parsePersistentWorldObjectAlias(existingSame), conflictingObjectIds: [] };
    const foreignBefore = await this.getAllRows('SELECT object_id FROM persistent_world_object_aliases WHERE namespace = ? AND alias_key = ? AND object_id <> ? ORDER BY object_id', [namespace, input.aliasKey, input.objectId]);
    if (foreignBefore.length) return { status: 'conflict', alias: null, conflictingObjectIds: [...new Set(foreignBefore.map(row => row.object_id))] };
    const id = input.id || this.generateId('persistent_world_object_alias');
    const now = new Date().toISOString();
    await this.executeQuery(
      \`INSERT INTO persistent_world_object_aliases (id, namespace, object_id, alias_text, alias_key, canonical, source_kind, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM persistent_world_object_aliases WHERE namespace = ? AND alias_key = ? AND object_id <> ?
       )
       ON CONFLICT(namespace, object_id, alias_key) DO UPDATE SET alias_text=excluded.alias_text,
         canonical=MAX(persistent_world_object_aliases.canonical, excluded.canonical), source_kind=excluded.source_kind, updated_at=excluded.updated_at\`,
      [id, namespace, input.objectId, input.aliasText || input.aliasKey, input.aliasKey, input.canonical ? 1 : 0,
       input.sourceKind || 'operator_confirmed_alias', now, now, namespace, input.aliasKey, input.objectId]
    );
    const aliasRow = await this.getRow('SELECT * FROM persistent_world_object_aliases WHERE namespace = ? AND object_id = ? AND alias_key = ? LIMIT 1', [namespace, input.objectId, input.aliasKey]);
    if (aliasRow) return { status: 'applied', alias: this.parsePersistentWorldObjectAlias(aliasRow), conflictingObjectIds: [] };
    const foreignAfter = await this.getAllRows('SELECT object_id FROM persistent_world_object_aliases WHERE namespace = ? AND alias_key = ? AND object_id <> ? ORDER BY object_id', [namespace, input.aliasKey, input.objectId]);
    return { status: 'conflict', alias: null, conflictingObjectIds: [...new Set(foreignAfter.map(row => row.object_id))] };
  }

  async linkPersistentWorldObjectResolutionOperator(input = {}) {
    if (!input.resolutionId || !input.objectId || !input.identityFingerprint) return { status: 'invalid', resolution: null };
    const before = await this.getPersistentWorldObjectResolution(input.resolutionId);
    if (!before) return { status: 'not_found', resolution: null };
    const namespace = input.namespace || before.namespace || 'default';
    if ((before.namespace || 'default') !== namespace) return { status: 'conflict', resolution: before, reason: 'resolution_namespace_mismatch' };
    const wasSame = before.status === 'resolved' && before.objectId === input.objectId;
    const now = new Date().toISOString();
    await this.executeQuery(
      \`UPDATE persistent_world_object_resolutions SET status='resolved', object_id=?, match_mode='operator_explicit_link', confidence=1,
         candidate_object_ids=?, reason='operator_confirmed_reference_link', identity_fingerprint=?, updated_at=?
       WHERE id=? AND namespace=? AND (status IN ('unresolved','ambiguous') OR (status='resolved' AND object_id=?))\`,
      [input.objectId, JSON.stringify([input.objectId]), input.identityFingerprint, now, input.resolutionId, namespace, input.objectId]
    );
    const after = await this.getPersistentWorldObjectResolution(input.resolutionId);
    if (!after || after.objectId !== input.objectId || after.status !== 'resolved') {
      return { status: 'conflict', resolution: after || before, reason: 'resolution_concurrently_linked_to_different_object', currentObjectId: after?.objectId || before.objectId || null };
    }
    return { status: wasSame ? 'no_change' : 'applied', resolution: after };
  }

`;
  s = insertBefore(s, '  async savePersistentWorldObjectOperatorAction(input = {}) {\n', methods, 'atomic operator DB methods');
  write(rel, s);
}

function patchManager() {
  const rel = 'utils/persistent-world-object-library-manager-v11.js';
  let s = read(rel);

  const oldAlias = `    const existingSame = (collisions || []).find(row => row.objectId === object.id) || null;
    const alias = this.db?.savePersistentWorldObjectAlias ? await this.db.savePersistentWorldObjectAlias({
      namespace: object.namespace || 'default', objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias'
    }) : { objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias' };
    await this.audit({ namespace: object.namespace, actionType: 'add_alias', objectId: object.id, targetType: 'alias', targetId: alias?.id || aliasKey, status: existingSame ? 'no_change' : 'applied', actor: input.actor, note: input.note, beforeValue: existingSame || {}, afterValue: alias || {}, reason: existingSame ? 'alias_already_linked_to_object' : 'operator_confirmed_alias' });
    return { status: existingSame ? 'no_change' : 'applied', applied: !existingSame, alias };`;
  const newAlias = `    const existingSame = (collisions || []).find(row => row.objectId === object.id) || null;
    const atomicAlias = this.db?.savePersistentWorldObjectOperatorAlias
      ? await this.db.savePersistentWorldObjectOperatorAlias({ namespace: object.namespace || 'default', objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias' })
      : null;
    if (atomicAlias?.status === 'conflict') {
      await this.audit({ namespace: object.namespace, actionType: 'add_alias', objectId: object.id, targetType: 'alias', targetId: aliasKey, status: 'rejected', actor: input.actor, note: input.note, beforeValue: { collisions: atomicAlias.conflictingObjectIds || [] }, reason: 'alias_key_concurrent_collision' });
      return { status: 'conflict', applied: false, reason: 'alias_key_concurrent_collision', conflictingObjectIds: atomicAlias.conflictingObjectIds || [] };
    }
    const alias = atomicAlias?.alias || (this.db?.savePersistentWorldObjectAlias ? await this.db.savePersistentWorldObjectAlias({
      namespace: object.namespace || 'default', objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias'
    }) : { objectId: object.id, aliasText, aliasKey, canonical: false, sourceKind: 'operator_confirmed_alias' });
    const noChange = Boolean(existingSame || atomicAlias?.status === 'no_change');
    await this.audit({ namespace: object.namespace, actionType: 'add_alias', objectId: object.id, targetType: 'alias', targetId: alias?.id || aliasKey, status: noChange ? 'no_change' : 'applied', actor: input.actor, note: input.note, beforeValue: existingSame || {}, afterValue: alias || {}, reason: noChange ? 'alias_already_linked_to_object' : 'operator_confirmed_alias' });
    return { status: noChange ? 'no_change' : 'applied', applied: !noChange, alias };`;
  s = replaceOnce(s, oldAlias, newAlias, 'atomic addAlias');

  const oldPersistAlias = `      alias = this.db?.savePersistentWorldObjectAlias ? await this.db.savePersistentWorldObjectAlias({ namespace: object.namespace || 'default', objectId: object.id, aliasText: resolution.referenceText, aliasKey, canonical: false, sourceKind: 'operator_resolution_link' }) : null;`;
  const newPersistAlias = `      const atomicAlias = this.db?.savePersistentWorldObjectOperatorAlias
        ? await this.db.savePersistentWorldObjectOperatorAlias({ namespace: object.namespace || 'default', objectId: object.id, aliasText: resolution.referenceText, aliasKey, canonical: false, sourceKind: 'operator_resolution_link' })
        : null;
      if (atomicAlias?.status === 'conflict') {
        await this.audit({ namespace: object.namespace, actionType: 'link_resolution', objectId: object.id, targetType: 'resolution', targetId: resolution.id, productionId: resolution.productionId, status: 'rejected', actor: input.actor, note: input.note, beforeValue: resolution, reason: 'requested_alias_concurrent_collision' });
        return { status: 'conflict', applied: false, reason: 'requested_alias_concurrent_collision', conflictingObjectIds: atomicAlias.conflictingObjectIds || [] };
      }
      alias = atomicAlias?.alias || (this.db?.savePersistentWorldObjectAlias ? await this.db.savePersistentWorldObjectAlias({ namespace: object.namespace || 'default', objectId: object.id, aliasText: resolution.referenceText, aliasKey, canonical: false, sourceKind: 'operator_resolution_link' }) : null);`;
  s = replaceOnce(s, oldPersistAlias, newPersistAlias, 'atomic alias during resolution link');

  const oldResolution = `    const updated = this.db?.savePersistentWorldObjectResolution ? await this.db.savePersistentWorldObjectResolution({
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
    return { status: resolution.status === 'resolved' && resolution.objectId === object.id ? 'no_change' : 'applied', applied: !(resolution.status === 'resolved' && resolution.objectId === object.id), resolution: updated, alias };`;
  const newResolution = `    const atomicLink = this.db?.linkPersistentWorldObjectResolutionOperator
      ? await this.db.linkPersistentWorldObjectResolutionOperator({ resolutionId: resolution.id, namespace: resolution.namespace || object.namespace || 'default', objectId: object.id, identityFingerprint: object.identityFingerprint })
      : null;
    if (atomicLink?.status === 'conflict') {
      await this.audit({ namespace: object.namespace, actionType: 'link_resolution', objectId: object.id, targetType: 'resolution', targetId: resolution.id, productionId: resolution.productionId, status: 'rejected', actor: input.actor, note: input.note, beforeValue: resolution, afterValue: atomicLink.resolution || {}, reason: atomicLink.reason || 'resolution_concurrently_linked_to_different_object' });
      return { status: 'conflict', applied: false, reason: atomicLink.reason || 'resolution_concurrently_linked_to_different_object', currentObjectId: atomicLink.currentObjectId || atomicLink.resolution?.objectId || null };
    }
    const updated = atomicLink?.resolution || (this.db?.savePersistentWorldObjectResolution ? await this.db.savePersistentWorldObjectResolution({
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
    }) : { ...resolution, status: 'resolved', objectId: object.id, matchMode: 'operator_explicit_link', confidence: 1, candidateObjectIds: [object.id], reason: 'operator_confirmed_reference_link', identityFingerprint: object.identityFingerprint });
    const linkStatus = atomicLink?.status || (resolution.status === 'resolved' && resolution.objectId === object.id ? 'no_change' : 'applied');
    await this.audit({ namespace: object.namespace, actionType: 'link_resolution', objectId: object.id, targetType: 'resolution', targetId: resolution.id, productionId: resolution.productionId, status: linkStatus, actor: input.actor, note: input.note, beforeValue: resolution, afterValue: updated, reason: 'operator_confirmed_reference_link' });
    return { status: linkStatus, applied: linkStatus === 'applied', resolution: updated, alias };`;
  s = replaceOnce(s, oldResolution, newResolution, 'atomic resolution link');

  write(rel, s);
}

patchDatabase();
patchManager();
console.log('Phase 11.10.7 operator atomicity hardening active: alias assignment and resolver linking are compare-and-set guarded against concurrent operator races.');
