'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'persistent-character-appearance-state-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.4 runtime is not materialized');
const {
  PERSISTENT_CHARACTER_APPEARANCE_STATE_VERSION,
  PersistentCharacterAppearanceStateLayerV11,
  normalizePersistence,
  rawStateFor,
  stateDeclaration,
  collectStateDeclarations,
  bindingForState,
  normalizeState,
  stateFingerprint,
  statePromptFragment
} = require(runtimePath);

let count = 0;
function check(name, fn) { fn(); count += 1; }

check('version is 11.11.4', () => assert.strictEqual(PERSISTENT_CHARACTER_APPEARANCE_STATE_VERSION, '11.11.4'));
check('default persistence is scene', () => assert.strictEqual(normalizePersistence(''), 'scene'));
check('durable persistence normalizes to until_changed', () => assert.strictEqual(normalizePersistence('durable'), 'until_changed'));
check('carry forward persistence normalizes', () => assert.strictEqual(normalizePersistence('carry_forward'), 'until_changed'));
check('appearanceState is recognized', () => assert.strictEqual(rawStateFor({ appearanceState: { wardrobe: 'raincoat' } }).wardrobe, 'raincoat'));
check('wardrobeState is recognized', () => assert.strictEqual(rawStateFor({ wardrobeState: { wardrobe: 'pajamas' } }).wardrobe, 'pajamas'));
check('canonical outfit alone is not state', () => assert.strictEqual(Object.keys(rawStateFor({ outfit: 'blue dress' })).length, 0));
check('state declaration preserves explicit character key', () => assert.strictEqual(stateDeclaration({ characterKey: 'luna_main', appearanceState: { wardrobe: 'raincoat' } }).explicitCharacterKey, 'luna_main'));
check('state declaration preserves source character id', () => assert.strictEqual(stateDeclaration({ id: 'bible_luna', appearanceState: { wardrobe: 'raincoat' } }).sourceCharacterId, 'bible_luna'));
check('state declaration does not invent sourceRef from name', () => assert.strictEqual(stateDeclaration({ name: 'Luna', appearanceState: { wardrobe: 'raincoat' } }).sourceRef, null));

const active = normalizeState({ wardrobe: 'yellow raincoat', footwear: 'red boots', hairState: 'wet', condition: 'tired', cleanliness: 'muddy', ageAppearance: 'same age', injuries: ['small scratch'], carriedItems: ['backpack'], temporaryAccessories: ['rain hat'], appearanceNotes: ['wet fur'], storyState: ['returning from storm'], persistence: 'until_changed' });
check('active state is active', () => assert.strictEqual(active.status, 'active'));
check('active state is durable', () => assert.strictEqual(active.persistence, 'until_changed'));
check('wardrobe is captured', () => assert.strictEqual(active.state.wardrobe, 'yellow raincoat'));
check('footwear is captured', () => assert.strictEqual(active.state.footwear, 'red boots'));
check('hair state is captured', () => assert.strictEqual(active.state.hairState, 'wet'));
check('condition is captured', () => assert.strictEqual(active.state.condition, 'tired'));
check('cleanliness is captured', () => assert.strictEqual(active.state.cleanliness, 'muddy'));
check('age appearance is captured', () => assert.strictEqual(active.state.ageAppearance, 'same age'));
check('injuries are captured', () => assert.deepStrictEqual(active.state.injuries, ['small scratch']));
check('carried items are captured', () => assert.deepStrictEqual(active.state.carriedItems, ['backpack']));
check('temporary accessories are captured', () => assert.deepStrictEqual(active.state.temporaryAccessories, ['rain hat']));
check('appearance notes are captured', () => assert.deepStrictEqual(active.state.appearanceNotes, ['wet fur']));
check('story state is captured', () => assert.deepStrictEqual(active.state.storyState, ['returning from storm']));

const conflict = normalizeState({ wardrobes: ['raincoat', 'pajamas'] });
check('conflicting wardrobe fails closed', () => assert.strictEqual(conflict.status, 'conflict'));
check('conflicting wardrobe is omitted', () => assert.strictEqual(conflict.state.wardrobe, null));
check('conflict is audited', () => assert(conflict.conflicts.some(value => value.startsWith('wardrobe:'))));
const reset = normalizeState({ clearState: true, statePersistence: 'until_changed', wardrobe: 'ignored' });
check('reset is neutral', () => assert.strictEqual(reset.status, 'neutral'));
check('reset preserves durable persistence', () => assert.strictEqual(reset.persistence, 'until_changed'));
check('reset clears wardrobe', () => assert.strictEqual(reset.state.wardrobe, null));
check('state fingerprint deterministic', () => assert.strictEqual(stateFingerprint('char_luna', active), stateFingerprint('char_luna', active)));
check('state fingerprint changes by character', () => assert.notStrictEqual(stateFingerprint('char_luna', active), stateFingerprint('char_star', active)));
const prompt = statePromptFragment({ characterId: 'char_luna', status: 'active', persistence: 'until_changed', wardrobe: 'yellow raincoat', carriedItems: ['backpack'], canonicalIdentityFingerprint: 'fp_luna' });
check('prompt includes wardrobe', () => assert(prompt.includes('wardrobe=yellow raincoat')));
check('prompt protects character id', () => assert(prompt.includes('Never rewrite characterId')));
check('prompt protects canonical asset', () => assert(prompt.includes('11.11.3 canonical character asset')));
check('prompt distinguishes canonical base outfit', () => assert(prompt.includes('canonical Character Bible outfit/accessories remain the base design')));

const luna = { id: 'char_luna', characterKey: 'luna_main', displayName: 'Luna', speciesType: 'rabbit', identityFingerprint: 'fp_luna' };
const star = { id: 'char_star', characterKey: 'star_main', displayName: 'Star', speciesType: 'rabbit', identityFingerprint: 'fp_star' };
const bindings = [
  { character: luna, usage: { sourceBibleId: 'bible_a', sourceCharacterId: 'bible_luna', sourceRef: 'luna_ref' } },
  { character: star, usage: { sourceBibleId: 'bible_a', sourceCharacterId: 'bible_star', sourceRef: 'star_ref' } }
];
check('explicit character key binds exactly', () => assert.strictEqual(bindingForState({ explicitCharacterKey: 'luna_main' }, bindings).binding.character.id, 'char_luna'));
check('source character id binds exactly', () => assert.strictEqual(bindingForState({ sourceCharacterId: 'bible_star' }, bindings).binding.character.id, 'char_star'));
check('source ref binds exactly', () => assert.strictEqual(bindingForState({ sourceRef: 'luna_ref' }, bindings).binding.character.id, 'char_luna'));
check('exact name and species binds', () => assert.strictEqual(bindingForState({ displayName: 'Luna', speciesType: 'rabbit' }, bindings).binding.character.id, 'char_luna'));
check('generic rabbit state is ambiguous', () => assert.strictEqual(bindingForState({ speciesType: 'rabbit' }, bindings).status, 'ambiguous'));
check('missing character state is unresolved', () => assert.strictEqual(bindingForState({ displayName: 'Missing', speciesType: 'rabbit' }, bindings).status, 'unresolved'));

const collected = collectStateDeclarations({ id: 'bible_x', mode: 'kids_cartoon_2d', characters: [{ id: 'x', name: 'Luna', appearanceState: { wardrobe: 'coat' } }], characterStates: [{ characterKey: 'star_main', appearanceState: { cleanliness: 'dusty' } }] });
check('collects character inline appearance state', () => assert.strictEqual(collected.length, 2));
check('collects top-level character state', () => assert.strictEqual(collected[1].explicitCharacterKey, 'star_main'));
check('non-cartoon bible collects no states', () => assert.strictEqual(collectStateDeclarations({ mode: 'documentary', characters: [{ name: 'Luna', appearanceState: { wardrobe: 'coat' } }] }).length, 0));

const dbSource = fs.readFileSync(path.join(upstream, 'database', 'db.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(upstream, 'utils', 'scene-pipeline-v2.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(upstream, 'dashboard', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(upstream, '.env.example'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8'));

for (const [name, source, token] of [
  ['database owns character appearance state table', dbSource, 'CREATE TABLE IF NOT EXISTS persistent_character_appearance_states'],
  ['state references persistent character', dbSource, 'FOREIGN KEY (character_id) REFERENCES persistent_characters(id) ON DELETE CASCADE'],
  ['state supports parent lineage', dbSource, 'FOREIGN KEY (parent_state_id) REFERENCES persistent_character_appearance_states(id) ON DELETE SET NULL'],
  ['database saves character appearance state', dbSource, 'async savePersistentCharacterAppearanceState(input = {})'],
  ['database reads latest durable character state', dbSource, 'async getLatestDurablePersistentCharacterAppearanceState(characterId, excludeProductionId = null)'],
  ['database lists production character states', dbSource, 'async listProductionPersistentCharacterAppearanceStates(productionId)'],
  ['bundle loads character appearance states', dbSource, 'const persistentCharacterAppearanceStates = await this.listProductionPersistentCharacterAppearanceStates(productionId);'],
  ['bundle exposes character appearance states', dbSource, 'persistentCharacterAppearanceStates,'],
  ['pipeline imports character state layer', pipelineSource, "PersistentCharacterAppearanceStateLayerV11 } = require('./persistent-character-appearance-state-v11')"],
  ['pipeline constructs character state layer', pipelineSource, 'this.persistentCharacterAppearanceStates = options.persistentCharacterAppearanceStates || new PersistentCharacterAppearanceStateLayerV11'],
  ['pipeline ensures character appearance states', pipelineSource, 'this.persistentCharacterAppearanceStates.ensureProductionStates(production, cartoonBible, persistentCharacterPlan)'],
  ['dashboard exposes wardrobe appearance state', dashboardSource, 'WARDROBE / APPEARANCE STATE V11.11.4'],
  ['dashboard documents canonical protection', dashboardSource, 'They never rewrite characterId, canonical fingerprint or the 11.11.3 character_reference'],
  ['env enables appearance states', envSource, 'PERSISTENT_CHARACTER_APPEARANCE_STATES_ENABLED=true'],
  ['env enables durable state inheritance', envSource, 'PERSISTENT_CHARACTER_APPEARANCE_STATE_INHERIT_DURABLE=true']
]) check(name, () => assert(source.includes(token)));
check('package exposes appearance state verifier', () => assert.strictEqual(pkg.scripts['test:persistent-character-appearance-state'], 'node ../bootstrap/verify-phase11-persistent-character-appearance-state.js'));
check('character state runs after canonical character asset plan', () => assert(pipelineSource.indexOf('let canonicalCharacterAssetPlan = null;') < pipelineSource.indexOf('let persistentCharacterAppearanceStatePlan = null;')));
check('character state runs before visual scene generation', () => assert(pipelineSource.indexOf('let persistentCharacterAppearanceStatePlan = null;') < pipelineSource.indexOf('if (!scenes.length || scriptChanged)')));

async function runtimeChecks() {
  const rows = [];
  const db = {
    async savePersistentCharacterAppearanceState(input) {
      const existingIndex = rows.findIndex(row => row.productionId === input.productionId && row.characterId === input.characterId && row.scopeKey === input.scopeKey);
      const row = { createdAt: existingIndex >= 0 ? rows[existingIndex].createdAt : `2026-09-15T00:00:${String(rows.length).padStart(2, '0')}Z`, updatedAt: '2026-09-15T00:10:00Z', ...input };
      if (existingIndex >= 0) rows[existingIndex] = row; else rows.push(row);
      return { ...row };
    },
    async getLatestDurablePersistentCharacterAppearanceState(characterId, excludeProductionId) {
      const matches = rows.filter(row => row.characterId === characterId && row.persistence === 'until_changed' && row.productionId !== excludeProductionId);
      return matches.length ? { ...matches[matches.length - 1] } : null;
    }
  };
  const layer = new PersistentCharacterAppearanceStateLayerV11(db, { enabled: true, inheritDurable: true });
  const plan = { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_a', sourceCharacterId: 'luna_src' }, matchMode: 'identity_fingerprint_exact_register' }] };

  const bibleA = { id: 'bible_a', mode: 'kids_cartoon_2d', characters: [{ id: 'luna_src', characterKey: 'luna_main', name: 'Luna', species: 'rabbit', appearanceState: { wardrobe: 'yellow raincoat', cleanliness: 'muddy', carriedItems: ['blue backpack'], statePersistence: 'until_changed' } }] };
  const a = await layer.ensureProductionStates({ id: 'video_a' }, bibleA, plan);
  check('A persists active appearance state', () => assert.strictEqual(a.summary.active, 1));
  check('A durable state is not inherited', () => assert.strictEqual(a.summary.inherited, 0));
  check('A wardrobe persisted', () => assert.strictEqual(a.states[0].wardrobe, 'yellow raincoat'));
  check('A carried item persisted', () => assert.deepStrictEqual(a.states[0].carriedItems, ['blue backpack']));
  check('A preserves canonical identity fingerprint', () => assert.strictEqual(a.states[0].canonicalIdentityFingerprint, 'fp_luna'));

  const planB = { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_b', sourceCharacterId: 'luna_b' }, matchMode: 'character_alias_exact' }] };
  const b = await layer.ensureProductionStates({ id: 'video_b' }, { id: 'bible_b', mode: 'kids_cartoon_2d', characters: [{ id: 'luna_b', characterKey: 'luna_main', name: 'Luna', species: 'rabbit' }] }, planB);
  check('B inherits durable appearance state', () => assert.strictEqual(b.summary.inherited, 1));
  check('B inherited wardrobe matches A', () => assert.strictEqual(b.states[0].wardrobe, 'yellow raincoat'));
  check('B lineage points to A', () => assert.strictEqual(b.states[0].parentStateId, a.states[0].id));

  const c = await layer.ensureProductionStates({ id: 'video_c' }, { id: 'bible_c', mode: 'kids_cartoon_2d', characters: [{ id: 'luna_c', characterKey: 'luna_main', name: 'Luna', species: 'rabbit', appearanceState: { wardrobe: 'star pajamas', statePersistence: 'scene' } }] }, { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_c', sourceCharacterId: 'luna_c' } }] });
  check('C explicit scene state suppresses inheritance', () => assert.strictEqual(c.summary.inherited, 0));
  check('C scene wardrobe is explicit', () => assert.strictEqual(c.states[0].wardrobe, 'star pajamas'));
  check('C state does not become durable', () => assert.strictEqual(c.states[0].persistence, 'scene'));

  const d = await layer.ensureProductionStates({ id: 'video_d' }, { id: 'bible_d', mode: 'kids_cartoon_2d', characters: [{ id: 'luna_d', characterKey: 'luna_main', name: 'Luna', species: 'rabbit', appearanceState: { clearState: true, statePersistence: 'until_changed' } }] }, { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_d', sourceCharacterId: 'luna_d' } }] });
  check('D durable reset is neutral', () => assert.strictEqual(d.states[0].status, 'neutral'));
  check('D durable reset clears wardrobe', () => assert.strictEqual(d.states[0].wardrobe, null));
  check('D durable reset is until_changed', () => assert.strictEqual(d.states[0].persistence, 'until_changed'));

  const e = await layer.ensureProductionStates({ id: 'video_e' }, { id: 'bible_e', mode: 'kids_cartoon_2d', characters: [{ id: 'luna_e', characterKey: 'luna_main', name: 'Luna', species: 'rabbit' }] }, { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_e', sourceCharacterId: 'luna_e' } }] });
  check('E inherits latest durable reset', () => assert.strictEqual(e.summary.inherited, 1));
  check('E does not resurrect old wardrobe', () => assert.strictEqual(e.states[0].wardrobe, null));
  check('E reset lineage points to D', () => assert.strictEqual(e.states[0].parentStateId, d.states[0].id));

  const ambiguousPlan = { active: true, characters: [
    { character: luna, usage: { sourceBibleId: 'bible_x' } },
    { character: star, usage: { sourceBibleId: 'bible_x' } }
  ] };
  const amb = await layer.ensureProductionStates({ id: 'video_amb' }, { id: 'bible_x', mode: 'kids_cartoon_2d', characterStates: [{ species: 'rabbit', appearanceState: { cleanliness: 'dusty' } }] }, ambiguousPlan);
  check('ambiguous appearance declaration fails closed', () => assert.strictEqual(amb.summary.ambiguous, 1));
  check('ambiguous declaration creates no state', () => assert.strictEqual(amb.states.length, 0));

  const conflicting = await layer.ensureProductionStates({ id: 'video_conflict' }, { id: 'bible_conflict', mode: 'kids_cartoon_2d', characters: [{ id: 'luna_conflict', characterKey: 'luna_main', name: 'Luna', appearanceState: { wardrobes: ['coat', 'pajamas'] } }] }, { active: true, characters: [{ character: luna, usage: { sourceBibleId: 'bible_conflict', sourceCharacterId: 'luna_conflict' } }] });
  check('runtime preserves state conflict', () => assert.strictEqual(conflicting.summary.conflicts, 1));
  check('runtime conflict omits wardrobe', () => assert.strictEqual(conflicting.states[0].wardrobe, null));

  const disabled = await new PersistentCharacterAppearanceStateLayerV11(db, { enabled: false }).ensureProductionStates({ id: 'video_disabled' }, bibleA, plan);
  check('disabled appearance state layer is inactive', () => assert.strictEqual(disabled.active, false));
  check('disabled appearance state layer creates no state', () => assert.strictEqual(disabled.states.length, 0));
}

runtimeChecks().then(() => console.log(`Phase 11.11.4 Persistent Character Appearance State OK: ${count} regression checks passed.`)).catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
