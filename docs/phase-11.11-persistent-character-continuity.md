# Phase 11.11 — Persistent Character System / Cross-Video Character Continuity

Phase 11.11 extends the production-scoped Character Bible from Phase 11.1 into a reusable cross-video character system. Locations became reusable in 11.9 and world objects in 11.10; 11.11 gives named cartoon characters the same production-independent identity guarantees.

## Why this phase exists

Phase 11.1 persists a Character Bible per production fingerprint and injects it into visual prompts. That is sufficient for continuity inside one production, but it does not provide a global character identity, aliases across episodes, canonical reference assets, wardrobe/lifecycle state, per-shot presence binding, or a cross-video character continuity gate.

Phase 11.11 closes that gap without changing the Phase 11.1 Character Bible contract.

## Roadmap

1. **11.11.1 — Persistent Character Registry** — implemented and Windows-validated.
   - production-independent canonical `characterId`;
   - exact visual-identity fingerprint reuse;
   - explicit `characterKey` support with fail-closed conflict detection;
   - per-production usage provenance;
   - canonical identity excludes expression, pose, action, current location and temporary props.
2. **11.11.2 — Character Aliases + Resolver** — implemented and Windows-validated.
   - exact `characterKey`, aliases and safe narrative-name resolution;
   - collision/ambiguity fail-closed;
   - contextual generic resolution only when one compatible character exists;
   - contextual generic references are not auto-promoted into permanent aliases;
   - no broad fuzzy matching.
3. **11.11.3 — Canonical Character Assets**
   - provider-backed canonical character reference images;
   - immutable hash/provenance;
   - no generic/local fallback promotion.
4. **11.11.4 — Wardrobe / Appearance State Layers**
   - temporary and durable costume, age/condition, carried-item and appearance state;
   - canonical identity remains immutable.
5. **11.11.5 — Scene / Shot Character Binding**
   - explicit visible/occluded/offscreen/mentioned character bindings;
   - shot prompt + fingerprint integration.
6. **11.11.6 — Cross-Video Character Continuity Gate**
   - compare visible reused characters against canonical reference assets;
   - tolerate declared appearance state while blocking replacement/identity drift.
7. **11.11.7 — Character Library UI + Operator Controls**
   - inspect identities, aliases, references, states, bindings and gate history;
   - audited operator corrections; canonical identity read-only.
8. **11.11.8 — E2E Cross-Video Character Tests**
   - deterministic multi-episode closeout across all 11.11 components.

## 11.11.1 contract

`PersistentCharacterRegistryV11` consumes the `cartoonBible.characters` produced by Phase 11.1 only when the bible is in `kids_cartoon_2d` mode.

Stable canonical identity may include:

- explicit `characterKey` when supplied;
- normalized display name when no explicit key exists;
- species/type;
- stable visual descriptor;
- palette and color placement;
- body proportions;
- facial landmarks/rules;
- shape language/silhouette;
- canonical outfit;
- stable markings and accessories.

The following are deliberately excluded from canonical identity:

- role (`main` vs `supporting`);
- personality prose;
- expressions;
- poses;
- current action;
- current location;
- temporary held props;
- future wardrobe/appearance state.

This means an episode can move a character, change its emotion, pose, story role or temporary prop without creating a new canonical identity.

### Explicit-key conflicts

When an explicit `characterKey` already exists but a later declaration changes canonical visual attributes, 11.11.1 fails closed with `explicit_character_key_identity_conflict`. It does not silently rewrite the existing identity.

## 11.11.2 contract

`PersistentCharacterResolverV11` adds exact aliases and audited resolution without weakening the canonical registry.

Resolution order is conservative:

1. exact explicit `characterKey`;
2. exact persisted alias;
3. exact normalized canonical name/key;
4. contextual generic reference only when exactly one compatible character remains;
5. otherwise `ambiguous` or `unresolved`.

No Levenshtein/fuzzy merge is used.

### Alias sources

The registry accepts explicit aliases from:

- `aliases`;
- `characterAliases`;
- `localizedNames`;
- `nicknames`.

Canonical display name and `characterKey` are also persisted as aliases.

### Generic references

References such as `the bunny`, `o coelho` or `the character` may be resolved contextually only when exactly one compatible canonical character exists. A contextual generic match uses `character_context_unique`.

A generic reference resolved this way is **not** automatically persisted as a permanent alias. If another compatible character appears later, the same generic phrase can become `character_context_ambiguous` instead of remaining silently pinned to the earlier character.

### Exact alias vs inferred species

Exact aliases/names take precedence over species inferred from the wording. This prevents names such as `Star` from being incorrectly treated only as a species/type token. Species inferred from the reference text is reserved for contextual generic matching; an explicitly declared species can still constrain exact alias/name resolution.

### Canonical compatibility

Alias resolution never authorizes canonical mutation. Incoming stable visual attributes are compared against the stored identity. An explicit key with incompatible canonical attributes returns a conflict; incompatible aliases are not silently merged.

## Persistence

11.11.1 adds:

- `persistent_characters`
- `persistent_character_usages`

11.11.2 adds:

- `persistent_character_aliases`
- `persistent_character_resolutions`

The production bundle exposes both `persistentCharacters` and `persistentCharacterResolutions`, including status, match mode, confidence, candidates and reason.

## Prompt integration

After Phase 11.1 builds/loads the production Character Bible, the persistent registry/resolver is evaluated before visual planning. The in-memory Character Bible prompt receives the persistent canonical character context while the original Phase 11.1 database record and fingerprint remain unchanged.

## Environment

```env
PERSISTENT_CHARACTERS_ENABLED=true
PERSISTENT_CHARACTER_NAMESPACE=default
PERSISTENT_CHARACTER_RESOLVER_ENABLED=true
PERSISTENT_CHARACTER_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true
```

Use one namespace per channel/story universe where possible.

## Regression commands

```bash
npm run test:persistent-characters
npm run test:persistent-character-resolver
```

Windows validation currently confirms:

- 11.11.1: 52 regression checks;
- 11.11.2: 49 regression checks.

## Completion boundary

11.11.1 and 11.11.2 are complete when the materialized Windows runtime passes their verifiers after the fully validated 11.10 closeout.

The current phase still does **not** claim canonical character image references, wardrobe/appearance state, per-shot character bindings, visual character continuity gating, operator library controls or integrated cross-video E2E; those remain 11.11.3–11.11.8.
