# Phase 11.11 — Persistent Character System / Cross-Video Character Continuity

Phase 11.11 extends the production-scoped Character Bible from Phase 11.1 into a reusable cross-video character system. Locations became reusable in 11.9 and world objects in 11.10; 11.11 gives named cartoon characters the same production-independent identity guarantees.

## Why this phase exists

Phase 11.1 persists a Character Bible per production fingerprint and injects it into visual prompts. That is sufficient for continuity inside one production, but it does not provide a global character identity, aliases across episodes, canonical reference assets, wardrobe/lifecycle state, per-shot presence binding, or a cross-video character continuity gate.

Phase 11.11 closes that gap without changing the Phase 11.1 Character Bible contract.

## Roadmap

1. **11.11.1 — Persistent Character Registry**
   - production-independent canonical `characterId`;
   - exact visual-identity fingerprint reuse;
   - explicit `characterKey` support with fail-closed conflict detection;
   - per-production usage provenance;
   - canonical identity excludes expression, pose, action, current location and temporary props.
2. **11.11.2 — Character Aliases + Resolver**
   - exact aliases and safe narrative-name resolution;
   - collision/ambiguity fail-closed;
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

### Conservative unnamed/exact behavior

Without an explicit key, 11.11.1 reuses only an exact identity fingerprint. A changed canonical design therefore registers a distinct character rather than guessing that it is the same one. Alias/narrative resolution belongs to 11.11.2.

## Persistence

11.11.1 adds:

- `persistent_characters`
- `persistent_character_usages`

The production bundle exposes `persistentCharacters`, including `reusedAcrossVideos` and usage provenance.

## Prompt integration

After Phase 11.1 builds/loads the production Character Bible, the registry is evaluated before visual planning. The in-memory Character Bible prompt receives the persistent canonical character context while the original Phase 11.1 database record and fingerprint remain unchanged.

## Environment

```env
PERSISTENT_CHARACTERS_ENABLED=true
PERSISTENT_CHARACTER_NAMESPACE=default
```

Use one namespace per channel/story universe where possible.

## Regression command

```bash
npm run test:persistent-characters
```

## Completion boundary

11.11.1 is complete when the materialized Windows runtime passes its verifier and demonstrates registration, exact cross-video reuse, visual-state exclusion and explicit-key conflict fail-closed behavior.

11.11.1 does not claim alias resolution, canonical character images, wardrobe state, shot bindings or visual gate verification; those are 11.11.2–11.11.8.
