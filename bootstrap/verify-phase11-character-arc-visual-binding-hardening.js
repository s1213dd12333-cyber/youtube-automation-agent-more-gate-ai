'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const servicePath = path.join(upstream, 'utils', 'character-arc-memory-v12.js');
const serviceSource = fs.readFileSync(servicePath, 'utf8').replace(/\r\n/g, '\n');
const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8').replace(/\r\n/g, '\n');
const { CharacterArcMemoryServiceV12 } = require(servicePath);

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };

async function main() {
  check(serviceSource.includes('existing?.persistentCharacterId && existing.persistentCharacterId !== persistentId'), 'service must treat visual unlink as a rebind');
  check(!serviceSource.includes('existing?.persistentCharacterId && persistentId && existing.persistentCharacterId !== persistentId'), 'old unlink bypass must be absent');
  check(serviceSource.includes('persistentId ? (resolved.character?.identityFingerprint'), 'visual fingerprint must clear when the binding is removed');
  check(serviceSource.includes('allowRebind: options.allowRebind === true || patch.allowRebind === true'), 'amendment rebind approval must reach the DB layer');
  check(dbSource.includes("row?.persistent_character_id && row.persistent_character_id !== (arc.persistentCharacterId || null) && item.allowRebind !== true"), 'DB episode commit must guard rebind and unlink');
  check(dbSource.includes("row.persistent_character_id && row.persistent_character_id !== (input.arc.persistentCharacterId || null) && input.allowRebind !== true"), 'DB amendment must guard rebind and unlink');

  const existing = {
    id: 'arc_mara', seriesId: 'series_star', characterKey: 'mara', displayName: 'Mara',
    persistentCharacterId: 'visual_mara', persistentCharacterFingerprint: 'fp_mara',
    goals: [], motivations: [], beliefs: [], knowledge: [], secrets: [], innerConflicts: [], commitments: [], milestones: [],
    firstEpisodeNumber: 1, lastEpisodeNumber: 2, revisionNumber: 3, status: 'active'
  };
  const db = {
    async getSerializedCharacterArc(seriesId, key) { return seriesId === 'series_star' && key === 'mara' ? JSON.parse(JSON.stringify(existing)) : null; },
    async getPersistentCharacter(id) {
      if (id === 'visual_other') return { id, status: 'active', identityFingerprint: 'fp_other' };
      if (id === 'visual_mara') return { id, status: 'active', identityFingerprint: 'fp_mara' };
      return null;
    }
  };
  const service = new CharacterArcMemoryServiceV12(db, { enabled: true });

  const silentUnlink = await service.prepareUpdate('series_star', 2, { characterKey: 'mara', persistentCharacterId: null }, {});
  check(silentUnlink.status === 'conflict' && silentUnlink.reason === 'character_arc_visual_rebind_requires_explicit_approval', 'silent visual unlink must fail closed');

  const approvedUnlink = await service.prepareUpdate('series_star', 2, { characterKey: 'mara', persistentCharacterId: null }, {
    allowRebind: true, rebindReason: 'Detach obsolete visual identity after approved redesign.'
  });
  check(approvedUnlink.status === 'ready', 'explicit visual unlink should be allowed');
  check(approvedUnlink.arc.persistentCharacterId === null && approvedUnlink.arc.persistentCharacterFingerprint === null, 'approved unlink must clear both visual id and fingerprint');

  const silentRebind = await service.prepareUpdate('series_star', 2, { characterKey: 'mara', persistentCharacterId: 'visual_other' }, {});
  check(silentRebind.status === 'conflict', 'silent visual rebind must fail closed');
  const approvedRebind = await service.prepareUpdate('series_star', 2, { characterKey: 'mara', persistentCharacterId: 'visual_other' }, {
    allowRebind: true, rebindReason: 'Bind the approved redesigned persistent character identity.'
  });
  check(approvedRebind.status === 'ready' && approvedRebind.arc.persistentCharacterFingerprint === 'fp_other', 'approved rebind must pin the new fingerprint');

  console.log(`Phase 11.12.4 visual-binding hardening checks passed: ${checks}`);
}

main().catch(error => { console.error(error); process.exit(1); });
