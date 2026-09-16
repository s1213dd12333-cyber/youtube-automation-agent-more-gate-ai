'use strict';

const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  const index = text.indexOf(from);
  if (index === -1) throw new Error(`Phase 11.12.4 visual-binding hardening anchor not found: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

let service = read('utils/character-arc-memory-v12.js');
service = replaceOnce(
  service,
  "    if (existing?.persistentCharacterId && persistentId && existing.persistentCharacterId !== persistentId) {\n",
  "    if (existing?.persistentCharacterId && existing.persistentCharacterId !== persistentId) {\n",
  'treat explicit visual unlink as a rebind'
);
service = replaceOnce(
  service,
  "      persistentCharacterFingerprint: resolved.character?.identityFingerprint || existing?.persistentCharacterFingerprint || null,\n",
  "      persistentCharacterFingerprint: persistentId ? (resolved.character?.identityFingerprint || existing?.persistentCharacterFingerprint || null) : null,\n",
  'clear visual fingerprint on explicit unlink'
);
service = replaceOnce(
  service,
  "        changeSummary: clean(patch.changeSummary || '', 2400),\n        actor: clean(options.actor || patch.actor || 'operator', 240) || 'operator',\n        reason\n",
  "        changeSummary: clean(patch.changeSummary || '', 2400),\n        allowRebind: options.allowRebind === true || patch.allowRebind === true,\n        actor: clean(options.actor || patch.actor || 'operator', 240) || 'operator',\n        reason\n",
  'propagate amendment rebind approval to DB'
);
write('utils/character-arc-memory-v12.js', service);

let db = read('database/db.js');
db = replaceOnce(
  db,
  "        if (arc.persistentCharacterId) {\n          const visual = await this.getRow('SELECT * FROM persistent_characters WHERE id = ? LIMIT 1', [arc.persistentCharacterId]);\n          if (!visual || (visual.status || 'active') !== 'active') throw new Error('character_arc_visual_binding_invalid');\n          if (arc.persistentCharacterFingerprint && visual.identity_fingerprint !== arc.persistentCharacterFingerprint) throw new Error('character_arc_visual_fingerprint_drift');\n          if (row?.persistent_character_id && row.persistent_character_id !== arc.persistentCharacterId && item.allowRebind !== true) {\n            throw new Error('character_arc_visual_rebind_requires_explicit_approval');\n          }\n        }\n",
  "        if (row?.persistent_character_id && row.persistent_character_id !== (arc.persistentCharacterId || null) && item.allowRebind !== true) {\n          throw new Error('character_arc_visual_rebind_requires_explicit_approval');\n        }\n        if (arc.persistentCharacterId) {\n          const visual = await this.getRow('SELECT * FROM persistent_characters WHERE id = ? LIMIT 1', [arc.persistentCharacterId]);\n          if (!visual || (visual.status || 'active') !== 'active') throw new Error('character_arc_visual_binding_invalid');\n          if (arc.persistentCharacterFingerprint && visual.identity_fingerprint !== arc.persistentCharacterFingerprint) throw new Error('character_arc_visual_fingerprint_drift');\n        }\n",
  'DB commit rebind/unlink guard'
);
db = replaceOnce(
  db,
  "      if (input.arc.persistentCharacterId) {\n        const visual = await this.getRow('SELECT * FROM persistent_characters WHERE id = ? LIMIT 1', [input.arc.persistentCharacterId]);\n",
  "      if (row.persistent_character_id && row.persistent_character_id !== (input.arc.persistentCharacterId || null) && input.allowRebind !== true) {\n        throw new Error('character_arc_visual_rebind_requires_explicit_approval');\n      }\n      if (input.arc.persistentCharacterId) {\n        const visual = await this.getRow('SELECT * FROM persistent_characters WHERE id = ? LIMIT 1', [input.arc.persistentCharacterId]);\n",
  'DB amendment rebind/unlink guard'
);
write('database/db.js', db);

if (!service.includes('existing.persistentCharacterId !== persistentId')) throw new Error('visual unlink guard was not materialized');
if (!service.includes('persistentId ? (resolved.character?.identityFingerprint')) throw new Error('visual fingerprint unlink cleanup was not materialized');
if (!db.includes("row.persistent_character_id !== (input.arc.persistentCharacterId || null) && input.allowRebind !== true")) throw new Error('DB amendment rebind guard was not materialized');

console.log('Phase 11.12.4 hardening: visual binding changes, including unlink, require explicit audited rebind approval.');
