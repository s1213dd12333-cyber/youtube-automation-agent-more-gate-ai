# Phase 11.11 — Persistent Character System / Cross-Video Character Continuity

Phase 11.11 extends the production-scoped Character Bible from Phase 11.1 into a reusable cross-video character system. Locations became reusable in 11.9 and world objects in 11.10; 11.11 gives named cartoon characters the same production-independent identity guarantees.

## Why this phase exists

Phase 11.1 persists a Character Bible per production fingerprint and injects it into visual prompts. That is sufficient for continuity inside one production, but it does not provide a global character identity, aliases across episodes, canonical reference assets, wardrobe/lifecycle state, per-shot presence binding, or a cross-video character continuity gate.

Phase 11.11 closes that gap without changing the Phase 11.1 Character Bible contract.

## Roadmap

1. **11.11.1 — Persistent Character Registry** — implemented and Windows-validated.
   - production-independent canonical `characterId`;
   - exact visual-identity fingerprint reuse;
   - explicit `characterKey` with fail-closed conflicts;
   - per-production usage provenance;
   - pose, emotion, action, location and temporary props excluded from canonical identity.
2. **11.11.2 — Character Aliases + Resolver** — implemented and Windows-validated.
   - exact key/alias/name resolution;
   - contextual generic resolution only when unique;
   - ambiguity fail-closed and no broad fuzzy matching;
   - generic contextual references are not promoted automatically to permanent aliases.
3. **11.11.3 — Canonical Character Assets** — implemented and Windows-validated.
   - provider-backed immutable `character_reference`;
   - hash/provider/model/origin provenance;
   - no generic/local fallback promotion;
   - unresolved or ambiguous promotion fails closed.
4. **11.11.4 — Wardrobe / Appearance State Layers** — implemented and Windows-validated.
   - wardrobe, footwear, hair, condition, cleanliness, apparent age, injuries and temporary accessories;
   - `scene` or explicit `until_changed` persistence;
   - durable reset prevents stale appearance state from resurfacing;
   - canonical identity/reference remain immutable.
5. **11.11.5 — Scene / Shot Character Binding** — implemented, Windows-validated and hardened.
   - exact persistent `characterId` per shot;
   - `visible`, `occluded`, `offscreen`, `mentioned` semantics;
   - explicit declarations override derived Shot Planner cast;
   - stale persisted bindings are pruned after a successful replacement set;
   - compatible explicit declarations merge; contradictions remain fail-closed;
   - binding fingerprints invalidate stale visual generation.
6. **11.11.6 — Cross-Video Character Continuity Gate** — implemented and Windows-validated.
   - evaluates only resolved `visible` / `occluded` character bindings;
   - compares reused characters against the canonical 11.11.3 `character_reference`;
   - tolerates only explicitly declared 11.11.4 appearance-state variation;
   - blocks missing characters, replacements, canonical identity drift and appearance-state drift;
   - audit-only provider absence by default, with an opt-in strict vision mode.
7. **11.11.7 — Character Library UI + Operator Controls** — pending.
   - inspect identities, aliases, references, states, bindings and gate history;
   - audited operator corrections with canonical identity read-only.
8. **11.11.8 — E2E Cross-Video Character Tests** — pending.
   - deterministic multi-episode closeout across all 11.11 components.

## 11.11.1 — Persistent Character Registry contract

`PersistentCharacterRegistryV11` consumes `cartoonBible.characters` in `kids_cartoon_2d` mode and creates/reuses a production-independent `characterId`.

Canonical identity may include explicit character key, name, species/type, visual descriptor, palette, proportions, face rules, shape language/silhouette, base outfit, stable markings and stable accessories.

Role, personality prose, expression, pose, action, current location and temporary held props are deliberately excluded. An explicit `characterKey` whose later declaration disagrees with the stored canonical visual identity fails closed with `explicit_character_key_identity_conflict` rather than mutating the original character.

## 11.11.2 — Character Aliases + Resolver contract

Resolution order is conservative:

1. exact explicit `characterKey`;
2. exact persisted alias;
3. exact normalized canonical name/key;
4. contextual generic reference only when exactly one compatible character exists;
5. otherwise `ambiguous` or `unresolved`.

Explicit aliases may come from `aliases`, `characterAliases`, `localizedNames` and `nicknames`. Contextual phrases such as `the bunny` may resolve when only one compatible character exists, but are not automatically made permanent aliases. Exact aliases/names also take precedence over species inferred from wording.

## 11.11.3 — Canonical Character Assets contract

`CanonicalCharacterAssetRegistryV11` promotes only explicitly declared canonical references already bound to one persistent character. Provider provenance is required by default, and generic/local/slideshow fallback images are not promoted.

The first valid `character_reference` is immutable by role and preserves its identity fingerprint, byte SHA-256, asset path, provider/model and source production/Character Bible provenance. Later episodes reuse it rather than silently replacing it.

Canonical files live at:

`data/assets/character-library/<namespace>/<characterId>/character_reference.<ext>`

## 11.11.4 — Wardrobe / Appearance State contract

`PersistentCharacterAppearanceStateLayerV11` stores mutable visual/story state separately from the canonical character identity/reference.

Supported dimensions include wardrobe/costume, footwear, hair state, condition, cleanliness, age appearance, injuries, carried items, temporary accessories, appearance notes and story state.

Persistence modes:

- `scene` — current production/scene only;
- `until_changed` — explicit durable state carried forward until replaced/reset.

A durable reset becomes the new neutral durable state so an older costume/injury does not reappear later. Contradictory single-valued state dimensions fail closed. The base Character Bible `outfit` remains canonical identity; episodic costume changes belong in the appearance-state layer.

## 11.11.5 — Scene / Shot Character Binding contract

`PersistentCharacterBindingV11` converts the intended cast into exact persistent character identities before shot persistence/keyframe generation.

Binding sources include scene/shot `characterBindings`, `persistentCharacterBindings`, `shotCharacterBindings` and Character Bible source IDs already placed in `shot.characters` by Shot Planner 11.2. Narrative text alone does not force visual presence.

Presence semantics:

- `visible` — render the exact character;
- `occluded` — character is visually present but partly hidden;
- `offscreen` — preserve narrative identity but do not render;
- `mentioned` — reference-only; do not render.

Bindings resolve by exact `characterId`, exact `characterKey`, exact source Character Bible character id, exact alias, then exact canonical name/key. No fuzzy merge is introduced.

Visible/occluded bindings enrich prompts with the 11.11.3 canonical asset and applicable 11.11.4 appearance state. Binding fingerprints include identity, visibility, placement/action/expression, appearance-state fingerprint and canonical asset hash, and therefore propagate into shot/scene/production fingerprints.

### 11.11.5 hardening

Revalidation added replace-by-production persistence semantics. After the current resolved set is safely persisted, rows from an older plan that are absent from the new set are pruned. This prevents 11.11.6 from seeing ghost character presence after a cast removal or a newly conflicting declaration.

Multiple compatible explicit declarations for the same character/shot now merge their non-conflicting fields and recompute the final fingerprint/prompt. Contradictory non-empty visibility, placement, action or expression values remain fail-closed.

## 11.11.6 — Cross-Video Character Continuity Gate contract

`CrossVideoCharacterContinuityGateV11` consumes only the hardened current binding set from 11.11.5. It evaluates resolved `visible` and `occluded` bindings. `offscreen`, `mentioned`, conflicted or unresolved bindings never create a visual continuity requirement.

For a reused character, the gate compares two images:

1. **IMAGE 1** — immutable canonical `character_reference` from 11.11.3;
2. **IMAGE 2** — the newly generated full scene/keyframe.

The visual/semantic provider is instructed to judge the bound character rather than overall frame composition. Camera, crop, framing, scale, background, lighting, pose, action and expression are not identity mismatches by themselves.

### Canonical identity vs allowed appearance change

The gate protects the persistent character's canonical face, species/type, proportions, recognizable silhouette/shape language, stable markings and base palette.

The following may legitimately vary only when represented by the applicable 11.11.4 appearance state:

- wardrobe/costume;
- footwear;
- hair state;
- condition/cleanliness;
- apparent age;
- injuries;
- carried items;
- temporary accessories;
- appearance/story notes.

The base canonical outfit may be visually replaced only when the state explicitly declares a wardrobe/costume override. Appearance state never authorizes a new face, body proportions, species, silhouette or replacement character.

### Vision response and blocking rules

The provider contract is:

```json
{
  "characterPresent": true,
  "sameCanonicalCharacter": true,
  "canonicalIdentityConsistent": true,
  "appearanceStateConsistent": true,
  "confidence": 0.9,
  "identityMismatches": [],
  "notes": "visible evidence only"
}
```

Explicit evidence creates fail-closed reasons:

- `CROSS_VIDEO_CHARACTER_MISSING`;
- `CROSS_VIDEO_CHARACTER_REPLACED`;
- `CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT`;
- `CROSS_VIDEO_CHARACTER_APPEARANCE_STATE_DRIFT`;
- `CROSS_VIDEO_CHARACTER_CANONICAL_ASSET_MISSING`;
- `CROSS_VIDEO_CHARACTER_KEYFRAME_MISSING`;
- `CROSS_VIDEO_CHARACTER_RECORD_MISSING`.

A non-empty `identityMismatches` array forces canonical identity inconsistency even if another provider field incorrectly says `true`.

Characters originating in the current production are recorded as `origin_production`; the gate does not falsely claim cross-video verification for them.

### Provider policy

Default mode is conservative but usable:

- explicit visual mismatch always blocks;
- provider unavailable/invalid/low-confidence remains accepted but unverified;
- canonical reference absence still blocks by default for a reused visible character.

Strict mode is enabled by `CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_VISION=true`. The global `SEMANTIC_PROP_REQUIRE_VERIFICATION=true` also activates strict character verification. In strict mode, missing provider evidence, invalid response, provider error or insufficient confidence blocks the keyframe.

The default confidence threshold is `0.72`.

### Keyframe gate order

The materialized keyframe pipeline runs the continuity gates in this order:

1. cross-video location continuity;
2. cross-video object continuity;
3. cross-video character continuity;
4. keyframe may become `ready`.

A failed character check sets keyframe status `cross_video_character_continuity_failed` and throws code `CROSS_VIDEO_CHARACTER_CONTINUITY_FAILED`.

## Persistence

11.11.1:

- `persistent_characters`
- `persistent_character_usages`

11.11.2:

- `persistent_character_aliases`
- `persistent_character_resolutions`

11.11.3:

- `persistent_character_assets`

11.11.4:

- `persistent_character_appearance_states`

11.11.5:

- `persistent_character_bindings`

11.11.6:

- `cross_video_character_continuity_checks`

The production bundle exposes persistent characters, resolutions, canonical assets, appearance states, current bindings and character-continuity audit history.

## Environment

```env
PERSISTENT_CHARACTERS_ENABLED=true
PERSISTENT_CHARACTER_NAMESPACE=default
PERSISTENT_CHARACTER_RESOLVER_ENABLED=true
PERSISTENT_CHARACTER_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true
CANONICAL_CHARACTER_ASSETS_ENABLED=true
CANONICAL_CHARACTER_ASSET_REQUIRE_PROVIDER=true
PERSISTENT_CHARACTER_APPEARANCE_STATES_ENABLED=true
PERSISTENT_CHARACTER_APPEARANCE_STATE_INHERIT_DURABLE=true
PERSISTENT_CHARACTER_BINDINGS_ENABLED=true
PERSISTENT_CHARACTER_BINDINGS_USE_SHOT_PLANNER_CAST=true
CROSS_VIDEO_CHARACTER_CONTINUITY_ENABLED=true
CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_CANONICAL_ASSET=true
CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_VISION=false
CROSS_VIDEO_CHARACTER_CONTINUITY_MIN_CONFIDENCE=0.72
CROSS_VIDEO_CHARACTER_VISION_BASE_URL=
CROSS_VIDEO_CHARACTER_VISION_MODEL=
CROSS_VIDEO_CHARACTER_VISION_API_KEY=
CROSS_VIDEO_CHARACTER_VISION_TIMEOUT_MS=30000
```

When character-specific vision settings are blank, 11.11.6 may reuse the configured `SEMANTIC_PROP_VISION_*` provider settings.

## Regression commands

```bash
npm run test:persistent-characters
npm run test:persistent-character-resolver
npm run test:canonical-character-assets
npm run test:persistent-character-appearance-state
npm run test:persistent-character-binding
npm run test:cross-video-character-continuity
```

Windows Server 2025 / Node 24 validation confirms:

- 11.11.1: 52 regression checks;
- 11.11.2: 49 regression checks;
- 11.11.3: 61 regression checks;
- 11.11.4: 86 regression checks;
- 11.11.5: 75 base regression checks;
- 11.11.5 hardening: 29 regression checks;
- 11.11.6: 66 regression checks.

The same Windows validation also preserved the complete Phase 11.10 full suite.

## Completion boundary

11.11.1 through 11.11.6 are implemented, materialized and Windows-validated after the fully validated 11.10 closeout.

Phase 11.11 still does **not** claim Character Library/operator controls or the integrated cross-video character E2E closeout. Those remain 11.11.7 and 11.11.8.
