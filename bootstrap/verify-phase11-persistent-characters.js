'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-character-registry-v11.js');
const { PersistentCharacterRegistryV11, PERSISTENT_CHARACTER_VERSION, normalizeCharacterCandidate, characterIdentity, characterIdentityFingerprint, characterKeyFor, characterPromptContext, collectBibleCharacters } = require(runtimePath);

let checks = 0;
function ok(name, fn) { try { fn(); checks += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function text(rel) { return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n'); }

class MemoryDb {
  constructor() { this.characters = []; this.usages = []; this.serial = 0; }
  clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  async getPersistentCharacterByFingerprint(namespace, fp) { return this.clone(this.characters.find(x => x.namespace === namespace && x.identityFingerprint === fp) || null); }
  async getPersistentCharacterByKey(namespace, key) { return this.clone(this.characters.find(x => x.namespace === namespace && x.characterKey === key) || null); }
  async getPersistentCharacter(id) { return this.clone(this.characters.find(x => x.id === id) || null); }
  async savePersistentCharacter(input) {
    const existing = this.characters.find(x => x.namespace === input.namespace && x.identityFingerprint === input.identityFingerprint);
    if (existing) return this.clone(existing);
    const row = { ...this.clone(input), firstSeenAt: '2026-09-15T00:00:00.000Z', lastSeenAt: '2026-09-15T00:00:00.000Z' };
    this.characters.push(row); return this.clone(row);
  }
  async touchPersistentCharacter(id) { const row = this.characters.find(x => x.id === id); if (row) row.lastSeenAt = '2026-09-16T00:00:00.000Z'; return this.clone(row); }
  async savePersistentCharacterUsage(input) {
    let row = this.usages.find(x => x.characterId === input.characterId && x.productionId === input.productionId && (x.sourceCharacterId || null) === (input.sourceCharacterId || null));
    if (!row) { row = { id: `usage_${++this.serial}`, ...this.clone(input) }; this.usages.push(row); }
    else Object.assign(row, this.clone(input));
    return this.clone(row);
  }
}

async function main() {
  ok('version', () => assert.strictEqual(PERSISTENT_CHARACTER_VERSION, '11.11.1'));
  const luna = {
    id: 'char_luna', name: 'Luna', role: 'main', speciesType: 'bunny', descriptor: 'small moon bunny with long ears',
    palette: ['soft cream', 'sky blue'], proportions: 'large head, compact rounded body', face: 'large blue eyes',
    shapeLanguage: 'soft rounded silhouette', outfit: 'blue scarf', markings: ['crescent mark on left ear'], accessories: ['blue scarf'],
    expressions: ['happy', 'sad'], poses: ['walking'], props: ['lantern'], continuityRules: ['preserve silhouette']
  };
  const candidate = normalizeCharacterCandidate(luna, { sourceBibleId: 'bible_A' });
  ok('candidate normalized', () => assert(candidate && candidate.displayName === 'Luna' && candidate.sourceCharacterId === 'char_luna'));
  ok('role retained as usage metadata', () => assert.strictEqual(candidate.role, 'main'));
  ok('temporary rejected', () => assert.strictEqual(normalizeCharacterCandidate({ name: 'Temp', temporary: true }), null));
  ok('persistent false rejected', () => assert.strictEqual(normalizeCharacterCandidate({ name: 'Temp', persistent: false }), null));
  const identity = characterIdentity(candidate, { namespace: 'series' });
  ok('namespace scope without explicit key', () => assert.strictEqual(identity.scopeKind, 'namespace'));
  ok('identity name normalized', () => assert.strictEqual(identity.identityName, 'luna'));
  ok('identity visual palette normalized', () => assert(identity.palette.includes('sky blue') && identity.palette.includes('soft cream')));
  ok('identity excludes role', () => assert(!Object.prototype.hasOwnProperty.call(identity, 'role')));
  ok('identity excludes expressions', () => assert(!Object.prototype.hasOwnProperty.call(identity, 'expressions')));
  ok('identity excludes poses', () => assert(!Object.prototype.hasOwnProperty.call(identity, 'poses')));
  ok('identity excludes props', () => assert(!Object.prototype.hasOwnProperty.call(identity, 'props')));
  const fp = characterIdentityFingerprint(candidate, { namespace: 'series' });
  ok('fingerprint sha256', () => assert.strictEqual(fp.length, 64));
  ok('generated key deterministic', () => assert.strictEqual(characterKeyFor(candidate, fp), `luna_${fp.slice(0, 10)}`));
  const variant = normalizeCharacterCandidate({ ...luna, role: 'supporting', expressions: ['angry'], poses: ['jumping'], props: ['kite'] }, { sourceBibleId: 'bible_B' });
  ok('role/pose/props do not change identity', () => assert.strictEqual(characterIdentityFingerprint(variant, { namespace: 'series' }), fp));
  const paletteVariant = normalizeCharacterCandidate({ ...luna, palette: ['red', 'black'] });
  ok('canonical palette changes identity', () => assert.notStrictEqual(characterIdentityFingerprint(paletteVariant, { namespace: 'series' }), fp));
  const keyed = normalizeCharacterCandidate({ ...luna, characterKey: 'luna_main' });
  const keyedIdentity = characterIdentity(keyed, { namespace: 'series' });
  ok('explicit key scope', () => assert.strictEqual(keyedIdentity.scopeKind, 'explicit_character_key'));
  ok('explicit key removes name from fingerprint identity', () => assert.strictEqual(keyedIdentity.identityName, ''));
  ok('prompt identifies persistent character', () => assert(characterPromptContext({ id: 'pc1', characterKey: 'luna_main', displayName: 'Luna', speciesType: 'bunny', canonicalIdentity: keyedIdentity }).includes('PERSISTENT CHARACTER V11.11.1')));
  ok('prompt excludes temporary identity', () => assert(characterPromptContext({ id: 'pc1', canonicalIdentity: keyedIdentity }).includes('temporary props')));

  const bibleA = { id: 'bible_A', mode: 'kids_cartoon_2d', characters: [luna, { id: 'char_pip', name: 'Pip', role: 'supporting', speciesType: 'bird', descriptor: 'tiny yellow bird', palette: ['sunny yellow'], proportions: 'tiny round body', face: 'small black eyes', shapeLanguage: 'round', outfit: '', accessories: [] }] };
  ok('collects cartoon characters', () => assert.strictEqual(collectBibleCharacters(bibleA).length, 2));
  ok('non-cartoon bible ignored', () => assert.strictEqual(collectBibleCharacters({ mode: 'documentary', characters: [luna] }).length, 0));

  const db = new MemoryDb();
  const registry = new PersistentCharacterRegistryV11(db, { enabled: true, namespace: 'series' });
  const a = await registry.ensureProductionCharacters({ id: 'A' }, bibleA);
  ok('A active', () => assert(a.active));
  ok('A two registered', () => assert.strictEqual(a.summary.registered, 2));
  ok('A no reuse', () => assert.strictEqual(a.summary.reused, 0));
  ok('A prompt has both', () => assert(a.promptContext.includes('NAME: Luna') && a.promptContext.includes('NAME: Pip')));
  const lunaId = a.characters.find(x => x.character.displayName === 'Luna').character.id;
  const lunaCanonical = db.characters.find(x => x.id === lunaId);
  ok('A origin stored', () => assert.strictEqual(lunaCanonical.createdFromProductionId, 'A'));

  const bibleB = { id: 'bible_B', mode: 'kids_cartoon_2d', characters: [{ ...luna, role: 'supporting', expressions: ['curious'], poses: ['flying'], props: ['temporary balloon'] }] };
  const b = await registry.ensureProductionCharacters({ id: 'B' }, bibleB);
  ok('B exact visual identity reused', () => assert.strictEqual(b.characters[0].character.id, lunaId));
  ok('B reuse counted', () => assert.strictEqual(b.summary.reused, 1));
  ok('B usage role can change', () => assert.strictEqual(b.characters[0].usage.role, 'supporting'));
  ok('canonical origin remains A', () => assert.strictEqual(db.characters.find(x => x.id === lunaId).createdFromProductionId, 'A'));

  const c = await registry.ensureProductionCharacters({ id: 'C' }, { id: 'bible_C', mode: 'kids_cartoon_2d', characters: [{ ...luna, palette: ['red', 'black'] }] });
  ok('C changed canonical design registers distinct character', () => assert(c.characters[0].character.id !== lunaId && db.characters.length === 3));

  const keyedRegistry = new PersistentCharacterRegistryV11(db, { enabled: true, namespace: 'keyed' });
  const d1 = await keyedRegistry.ensureProductionCharacters({ id: 'D1' }, { id: 'bible_D1', mode: 'kids_cartoon_2d', characters: [{ ...luna, characterKey: 'luna_main' }] });
  const d2 = await keyedRegistry.ensureProductionCharacters({ id: 'D2' }, { id: 'bible_D2', mode: 'kids_cartoon_2d', characters: [{ ...luna, characterKey: 'luna_main', palette: ['red'] }] });
  ok('explicit key first registers', () => assert.strictEqual(d1.summary.registered, 1));
  ok('explicit key canonical conflict fails closed', () => assert.strictEqual(d2.summary.conflicts, 1));
  ok('explicit key conflict creates no character', () => assert.strictEqual(d2.characters.length, 0));
  ok('explicit key conflict reason', () => assert.strictEqual(d2.conflicts[0].reason, 'explicit_character_key_identity_conflict'));

  const disabled = new PersistentCharacterRegistryV11(new MemoryDb(), { enabled: false, namespace: 'series' });
  const off = await disabled.ensureProductionCharacters({ id: 'X' }, bibleA);
  ok('disabled inactive', () => assert(!off.active && off.characters.length === 0));

  const dbSource = text('database/db.js');
  const pipelineSource = text('utils/scene-pipeline-v2.js');
  const dashboardSource = text('dashboard/app.js');
  const pkg = JSON.parse(text('package.json'));
  const env = text('.env.example');
  for (const token of ['persistent_characters', 'persistent_character_usages', 'savePersistentCharacter(', 'getPersistentCharacterByFingerprint(', 'listProductionPersistentCharacters(']) ok(`database token ${token}`, () => assert(dbSource.includes(token)));
  for (const token of ['PersistentCharacterRegistryV11', 'ensureProductionCharacters(production, cartoonBible)', 'persistentCharacterPlan.promptContext', 'persistentCharacters: persistentCharacterPlan.characters']) ok(`pipeline token ${token}`, () => assert(pipelineSource.includes(token)));
  ok('persistent character registry runs before visual planning', () => assert(pipelineSource.indexOf('ensureProductionCharacters(production, cartoonBible)') < pipelineSource.indexOf('if (!scenes.length || scriptChanged) {')));
  ok('dashboard renderer present', () => assert(dashboardSource.includes('renderPersistentCharacters(item)') && dashboardSource.includes('PERSISTENT CHARACTERS V11.11.1')));
  ok('dashboard follows cartoon bible', () => assert(dashboardSource.includes('${renderCartoonBible(item.cartoonBible)}\n        ${renderPersistentCharacters(item)}')));
  ok('package test script', () => assert.strictEqual(pkg.scripts['test:persistent-characters'], 'node ../bootstrap/verify-phase11-persistent-characters.js'));
  ok('env enabled', () => assert(env.includes('PERSISTENT_CHARACTERS_ENABLED=true')));
  ok('env namespace', () => assert(env.includes('PERSISTENT_CHARACTER_NAMESPACE=default')));

  console.log(`Phase 11.11.1 Persistent Character Registry OK: ${checks} regression checks passed.`);
}

main().catch(error => { console.error(error.stack || error.message || error); process.exit(1); });
