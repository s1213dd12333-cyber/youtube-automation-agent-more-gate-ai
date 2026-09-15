'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-character-resolver-v11.js');
const {
  PersistentCharacterResolverV11, PERSISTENT_CHARACTER_RESOLVER_VERSION, normalize, slug,
  normalizeSpecies, speciesForReference, referenceDescriptor, candidateAliases, canonicalAliases,
  compatibleCanonicalIdentity, speciesCompatible, uniqueCharactersForAliases
} = require(runtimePath);

let checks = 0;
function ok(name, fn) { try { fn(); checks += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function text(rel) { return fs.readFileSync(path.join(upstream, rel), 'utf8').replace(/\r\n/g, '\n'); }

class MemoryDb {
  constructor() { this.characters = []; this.aliases = []; this.resolutions = []; this.serial = 0; }
  clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  async getPersistentCharacter(id) { return this.clone(this.characters.find(x => x.id === id) || null); }
  async getPersistentCharacterByKey(namespace, key) { return this.clone(this.characters.find(x => x.namespace === namespace && x.characterKey === key) || null); }
  async listPersistentCharacters(namespace) { return this.clone(this.characters.filter(x => x.namespace === namespace)); }
  async savePersistentCharacterAlias(input) {
    let row = this.aliases.find(x => x.namespace === input.namespace && x.characterId === input.characterId && x.aliasKey === input.aliasKey);
    if (!row) { row = { id: `alias_${++this.serial}`, ...this.clone(input) }; this.aliases.push(row); }
    else Object.assign(row, this.clone(input));
    return this.clone(row);
  }
  async listPersistentCharacterAliasesByKey(namespace, aliasKey) {
    return this.clone(this.aliases.filter(x => x.namespace === namespace && x.aliasKey === aliasKey));
  }
  async savePersistentCharacterResolution(input) {
    let row = this.resolutions.find(x => x.productionId === input.productionId && x.scopeKey === input.scopeKey && x.referenceKey === input.referenceKey);
    if (!row) { row = { id: `resolution_${++this.serial}`, ...this.clone(input) }; this.resolutions.push(row); }
    else Object.assign(row, this.clone(input));
    return this.clone(row);
  }
}

function character(id, key, name, species, identity = {}) {
  return {
    id, namespace: 'series', characterKey: key, displayName: name, speciesType: species,
    identityFingerprint: `fp_${id}`,
    canonicalIdentity: {
      speciesType: normalizeSpecies(species), descriptor: '', palette: [], proportions: '', face: '', shapeLanguage: '', outfit: '', markings: [], accessories: [], ...identity
    }
  };
}

async function main() {
  ok('version', () => assert.strictEqual(PERSISTENT_CHARACTER_RESOLVER_VERSION, '11.11.2'));
  ok('normalize accents', () => assert.strictEqual(normalize('  Coélha-Lúna '), 'coelha luna'));
  ok('slug', () => assert.strictEqual(slug('Luna Main'), 'luna_main'));
  ok('rabbit synonym en', () => assert.strictEqual(normalizeSpecies('bunny'), 'rabbit'));
  ok('rabbit synonym pt', () => assert.strictEqual(normalizeSpecies('coelha'), 'rabbit'));
  ok('species from reference', () => assert.strictEqual(speciesForReference('o coelho', 'character'), 'rabbit'));
  const generic = referenceDescriptor('the bunny', 'rabbit');
  ok('generic bunny detected', () => assert(generic.generic && generic.requestedSpecies === 'rabbit'));
  ok('named bunny not generic', () => assert(!referenceDescriptor('Luna bunny', 'rabbit').generic));

  const candidate = { displayName: 'Lulu', explicitCharacterKey: null, speciesType: 'bunny', aliases: ['Luna', 'Coelhinha Lua'] };
  ok('candidate aliases include explicit aliases', () => assert(candidateAliases(candidate).some(x => x.key === 'coelhinha lua')));
  const canon = character('luna', 'luna_main', 'Luna', 'rabbit');
  ok('canonical aliases include key', () => assert(canonicalAliases(canon).some(x => x.key === 'luna main')));
  ok('species compatible', () => assert(speciesCompatible(canon, 'coelha')));
  ok('species mismatch', () => assert(!speciesCompatible(canon, 'bird')));
  ok('partial candidate compatible', () => assert(compatibleCanonicalIdentity(canon, { speciesType: 'rabbit' }).compatible));
  const visual = character('visual', 'visual', 'Visual', 'rabbit', { palette: ['soft cream'], face: 'large blue eyes' });
  ok('palette mismatch detected', () => assert(!compatibleCanonicalIdentity(visual, { speciesType: 'rabbit', palette: ['red'] }).compatible));
  ok('face mismatch detected', () => assert(!compatibleCanonicalIdentity(visual, { speciesType: 'rabbit', face: 'green eyes' }).compatible));

  const db = new MemoryDb();
  const luna = character('pc_luna', 'luna_main', 'Luna', 'rabbit', { palette: ['soft cream', 'sky blue'], face: 'large blue eyes' });
  const pip = character('pc_pip', 'pip_bird', 'Pip', 'bird', { palette: ['sunny yellow'] });
  db.characters.push(luna, pip);
  const resolver = new PersistentCharacterResolverV11(db, { enabled: true, allowContextualGeneric: true });

  await resolver.ensureAliases(luna, { displayName: 'Luna', explicitCharacterKey: 'luna_main', speciesType: 'rabbit', aliases: ['Lulu', 'Coelhinha Lua'] }, 'seed');
  await resolver.ensureAliases(pip, { displayName: 'Pip', explicitCharacterKey: 'pip_bird', speciesType: 'bird', aliases: ['Pipinho'] }, 'seed');
  ok('Luna aliases persisted', () => assert(db.aliases.some(x => x.characterId === luna.id && x.aliasKey === 'lulu')));
  ok('localized alias persisted', () => assert(db.aliases.some(x => x.characterId === luna.id && x.aliasKey === 'coelhinha lua')));
  ok('key alias canonical', () => assert(db.aliases.some(x => x.characterId === luna.id && x.aliasKey === 'luna main' && x.canonical)));

  const keyResult = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'A' }, scopeKey: 'a', candidate: { displayName: 'Luna', explicitCharacterKey: 'luna_main', speciesType: 'rabbit' } });
  ok('explicit key resolves', () => assert(keyResult.status === 'resolved' && keyResult.character.id === luna.id && keyResult.matchMode === 'character_key_exact'));
  const aliasResult = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'B' }, scopeKey: 'b', referenceText: 'Coelhinha Lua', candidate: { displayName: 'Coelhinha Lua', speciesType: 'rabbit' } });
  ok('exact alias resolves', () => assert(aliasResult.status === 'resolved' && aliasResult.character.id === luna.id && aliasResult.matchMode === 'character_alias_exact'));
  ok('alias audit persisted', () => assert(db.resolutions.some(x => x.productionId === 'B' && x.characterId === luna.id)));
  const nameResult = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'C' }, scopeKey: 'c', referenceText: 'Luna', candidate: { displayName: 'Luna', speciesType: 'rabbit' } });
  ok('name resolves exact', () => assert(nameResult.status === 'resolved' && nameResult.character.id === luna.id));

  const genericRabbit = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'D' }, scopeKey: 'd', referenceText: 'the bunny', candidate: { displayName: 'the bunny', speciesType: 'rabbit' } });
  ok('generic unique rabbit resolves', () => assert(genericRabbit.status === 'resolved' && genericRabbit.character.id === luna.id && genericRabbit.matchMode === 'character_context_unique'));
  const beforeGenericAlias = db.aliases.filter(x => x.aliasKey === 'the bunny').length;
  await resolver.ensureAliases(luna, { displayName: 'the bunny', speciesType: 'rabbit' }, genericRabbit.matchMode);
  ok('generic contextual reference not promoted', () => assert.strictEqual(db.aliases.filter(x => x.aliasKey === 'the bunny').length, beforeGenericAlias));

  const genericAny = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'E' }, scopeKey: 'e', referenceText: 'the character', candidate: { displayName: 'the character', speciesType: 'character' } });
  ok('generic any ambiguous', () => assert(genericAny.status === 'ambiguous' && genericAny.candidates.length === 2 && genericAny.matchMode === 'character_context_ambiguous'));

  await db.savePersistentCharacterAlias({ namespace: 'series', characterId: luna.id, aliasText: 'Star', aliasKey: 'star', canonical: false, sourceKind: 'test' });
  await db.savePersistentCharacterAlias({ namespace: 'series', characterId: pip.id, aliasText: 'Star', aliasKey: 'star', canonical: false, sourceKind: 'test' });
  const collision = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'F' }, scopeKey: 'f', referenceText: 'Star', candidate: { displayName: 'Star', speciesType: 'character' } });
  ok('duplicate alias ambiguous', () => assert(collision.status === 'ambiguous' && collision.matchMode === 'character_alias_ambiguous'));

  const keyConflict = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'G' }, scopeKey: 'g', candidate: { displayName: 'Luna', explicitCharacterKey: 'luna_main', speciesType: 'rabbit', palette: ['red'] } });
  ok('explicit key visual mismatch conflicts', () => assert(keyConflict.status === 'conflict' && keyConflict.reason.includes('palette')));
  const unknown = await resolver.resolveCandidate({ namespace: 'series', production: { id: 'H' }, scopeKey: 'h', referenceText: 'Nova', candidate: { displayName: 'Nova', speciesType: 'fox' } });
  ok('unknown named character unresolved', () => assert(unknown.status === 'unresolved' && unknown.reason === 'no_exact_alias_or_name_match'));

  const db2 = new MemoryDb();
  const resolver2 = new PersistentCharacterResolverV11(db2, { enabled: true });
  const nova = character('pc_nova', 'nova_123', 'Nova', 'fox');
  db2.characters.push(nova);
  await resolver2.recordRegistration({ namespace: 'series', production: { id: 'N' }, scopeKey: 'n', referenceText: 'Nova', identityFingerprint: 'fp_nova' }, nova, { displayName: 'Nova', speciesType: 'fox', aliases: ['Raposa Nova'] });
  ok('registration seeds alias', () => assert(db2.aliases.some(x => x.aliasKey === 'raposa nova')));
  ok('registration audit', () => assert(db2.resolutions.some(x => x.status === 'registered_new' && x.matchMode === 'resolver_unresolved_register_new')));
  ok('unique alias helper', async () => assert.strictEqual((await uniqueCharactersForAliases(db2, 'series', 'raposa nova')).length, 1));

  const disabled = new PersistentCharacterResolverV11(db, { enabled: false });
  const off = await disabled.resolveCandidate({ namespace: 'series', production: { id: 'OFF' }, candidate: { displayName: 'Luna', speciesType: 'rabbit' } });
  ok('disabled unresolved', () => assert(off.status === 'unresolved' && off.reason === 'resolver_disabled'));

  const dbSource = text('database/db.js');
  const registrySource = text('utils/persistent-character-registry-v11.js');
  const dashboardSource = text('dashboard/app.js');
  const pkg = JSON.parse(text('package.json'));
  const env = text('.env.example');
  for (const token of ['persistent_character_aliases', 'persistent_character_resolutions', 'savePersistentCharacterAlias(', 'listPersistentCharacterAliasesByKey(', 'savePersistentCharacterResolution(', 'listPersistentCharacterResolutions(']) ok(`db token ${token}`, () => assert(dbSource.includes(token)));
  ok('bundle exposes resolutions', () => assert(dbSource.includes('persistentCharacterResolutions')));
  ok('registry imports resolver', () => assert(registrySource.includes('PersistentCharacterResolverV11')));
  ok('registry accepts aliases', () => assert(registrySource.includes('raw.characterAliases') && registrySource.includes('raw.localizedNames') && registrySource.includes('raw.nicknames')));
  ok('registry resolves before registration', () => assert(registrySource.indexOf('this.characterResolver.resolveCandidate') < registrySource.indexOf("if (!character) {\n      const id = `persistent_character_")));
  ok('registry preserves resolver match mode', () => assert(registrySource.includes("matchMode = resolution.matchMode || 'character_resolver_reuse'")));
  ok('registry records registrations', () => assert(registrySource.includes('this.characterResolver.recordRegistration')));
  ok('dashboard resolver present', () => assert(dashboardSource.includes('renderPersistentCharacterResolutions(item)') && dashboardSource.includes('CHARACTER ALIASES + RESOLVER V11.11.2')));
  ok('dashboard follows registry', () => assert(dashboardSource.includes('${renderPersistentCharacters(item)}\n        ${renderPersistentCharacterResolutions(item)}')));
  ok('package test script', () => assert.strictEqual(pkg.scripts['test:persistent-character-resolver'], 'node ../bootstrap/verify-phase11-persistent-character-resolver.js'));
  ok('env resolver enabled', () => assert(env.includes('PERSISTENT_CHARACTER_RESOLVER_ENABLED=true')));
  ok('env contextual generic enabled', () => assert(env.includes('PERSISTENT_CHARACTER_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true')));

  console.log(`Phase 11.11.2 Persistent Character Resolver OK: ${checks} regression checks passed.`);
}

main().catch(error => { console.error(error.stack || error.message || error); process.exit(1); });
