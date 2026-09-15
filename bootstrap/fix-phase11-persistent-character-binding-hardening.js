'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const read = rel => fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(path.join(upstream, rel), value.replace(/\r\n/g, '\n'), 'utf8');

function insertBefore(text, anchor, block, label) {
  if (text.includes(block.trim())) return text;
  const index = text.indexOf(anchor);
  if (index === -1) throw new Error(`Phase 11.11.5 hardening anchor not found: ${label}`);
  return text.slice(0, index) + block + text.slice(index);
}

function replaceRange(text, startAnchor, endAnchor, replacement, label) {
  if (text.includes(replacement.trim())) return text;
  const start = text.indexOf(startAnchor);
  if (start === -1) throw new Error(`Phase 11.11.5 hardening anchor not found: ${label} start`);
  const end = text.indexOf(endAnchor, start);
  if (end === -1) throw new Error(`Phase 11.11.5 hardening anchor not found: ${label} end`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function patchDatabase() {
  let s = read('database/db.js');
  const method = [
    '  async pruneProductionPersistentCharacterBindings(productionId, keepIds = []) {',
    "    if (!productionId) return false;",
    "    const ids = [...new Set((Array.isArray(keepIds) ? keepIds : []).map(value => String(value || '').trim()).filter(Boolean))];",
    "    if (!ids.length) {",
    "      await this.executeQuery('DELETE FROM persistent_character_bindings WHERE production_id = ?', [productionId]);",
    "      return true;",
    "    }",
    "    const placeholders = ids.map(() => '?').join(',');",
    "    await this.executeQuery(`DELETE FROM persistent_character_bindings WHERE production_id = ? AND id NOT IN (${placeholders})`, [productionId, ...ids]);",
    "    return true;",
    '  }',
    ''
  ].join('\n');
  s = insertBefore(s, '  parsePersistentCharacterBinding(row) {\n', `${method}\n`, 'character binding prune method');
  write('database/db.js', s);
}

function patchRuntime() {
  let s = read('utils/persistent-character-binding-v11.js');
  const mergedFunction = [
    'function mergeRowsForShot(rows = []) {',
    '  const grouped = new Map();',
    '  const conflicts = [];',
    '  for (const row of rows) {',
    "    if (row.status !== 'resolved' || !row.characterId) continue;",
    '    if (!grouped.has(row.characterId)) grouped.set(row.characterId, []);',
    '    grouped.get(row.characterId).push(row);',
    '  }',
    '  const resolved = [];',
    '  for (const [characterId, group] of grouped) {',
    "    const explicit = group.filter(row => row.sourceKind !== 'shot_planner_character');",
    '    const candidates = explicit.length ? explicit : group;',
    '    const merged = { ...candidates[0] };',
    '    const conflictFields = [];',
    "    for (const field of ['visibility','placement','action','expression']) {",
    "      const values = [...new Set(candidates.map(row => clean(row[field], field === 'action' ? 800 : 500)).filter(Boolean))];",
    '      if (values.length > 1) conflictFields.push(field);',
    '      else if (values.length === 1) merged[field] = values[0];',
    '    }',
    '    if (conflictFields.length) {',
    "      conflicts.push({ ...merged, status:'conflict', reason:'contradictory_bindings_for_same_character_and_shot', conflictFields });",
    '      continue;',
    '    }',
    '    merged.required = candidates.some(row => row.required !== false);',
    '    merged.bindingFingerprint = bindingFingerprint(merged);',
    '    merged.promptFragment = bindingPromptFragment(merged);',
    '    resolved.push(merged);',
    '  }',
    '  return { resolved, conflicts };',
    '}',
    ''
  ].join('\n');
  s = replaceRange(s, 'function mergeRowsForShot(rows = []) {', '\n\nclass PersistentCharacterBindingV11', `${mergedFunction}\n`, 'mergeRowsForShot');

  const anchor = "    shotPlan.shots = (shotPlan.scenes || []).flatMap(scene => scene.shots || []);\n\n";
  const hardened = anchor + [
    '    // Replace-by-production semantics: after every successful current binding set is persisted,',
    '    // remove stale rows from earlier plans so later continuity gates cannot see ghost presence.',
    '    if (this.db?.pruneProductionPersistentCharacterBindings) {',
    '      await this.db.pruneProductionPersistentCharacterBindings(production.id, persisted.map(row => row?.id).filter(Boolean));',
    '    }',
    ''
  ].join('\n') + '\n';
  if (!s.includes('pruneProductionPersistentCharacterBindings(production.id')) {
    if (!s.includes(anchor)) throw new Error('Phase 11.11.5 hardening anchor not found: prune current binding set');
    s = s.replace(anchor, hardened);
  }
  write('utils/persistent-character-binding-v11.js', s);
}

patchDatabase();
patchRuntime();
console.log('Phase 11.11.5 binding hardening active: complementary explicit bindings merge safely and stale production bindings are pruned after successful persistence.');
