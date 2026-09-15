# Phase 11.10 — Persistent World Objects / Cross-Video Object Continuity

Phase 11.10 extends the completed 11.9 reusable-location system from persistent places to persistent story-world objects. The goal is to let an object introduced in one video remain the same canonical object in later videos without confusing it with temporary props, same-type generic objects or narrative mentions that are not actually visible.

## Roadmap

1. **11.10.1 — Persistent World Object Registry**
   - production-independent object identity;
   - stable `objectId`, `objectKey`, identity fingerprint and provenance;
   - optional binding to reusable `locationId` / `zoneId` and Prop Lock;
   - temporary scene props excluded;
   - explicit-key identity conflicts fail closed.
2. **11.10.2 — Object Aliases + Resolver**
   - exact object key / persisted alias / normalized-name precedence;
   - generic references resolve only when exactly one compatible object remains;
   - duplicate aliases and canonical-attribute conflicts fail closed;
   - no broad fuzzy merge.
3. **11.10.3 — Canonical Object Assets**
   - explicit provider-backed canonical object references;
   - immutable origin hash and provenance;
   - one canonical `object_reference` per persistent `objectId`;
   - local/generic fallback and ambiguous bindings never become canonical.
4. **11.10.4 — Object State / Lifecycle Layers**
   - mutable condition, damage, cleanliness, open/closed, operational state, contents, possession-in-use, placement and story state;
   - `scene` vs `until_changed` persistence;
   - only explicitly durable state carries cross-video;
   - durable reset prevents stale state resurrection;
   - state never rewrites canonical identity or assets.
5. **11.10.5 — Scene / Shot Object Binding**
   - bind already-resolved persistent objects explicitly to scenes/shots;
   - visibility: `visible`, `occluded`, `offscreen`, `mentioned`;
   - interaction, holder and placement semantics;
   - narrative mention alone never creates visual presence;
   - canonical asset/state enrich prompts only after a resolved binding;
   - binding changes propagate into shot/scene/production fingerprints;
   - ambiguous, missing or contradictory bindings fail closed.
6. **11.10.6 — Cross-Video Object Continuity Gate**
   - compare visible reused objects against canonical references;
   - tolerate legitimate state changes while blocking identity drift or silent replacement.
7. **11.10.7 — Object Library UI + Operator Controls**
   - inspect identities, aliases, assets, state, shot usage and conflicts;
   - safe operator corrections and explicit linking.
8. **11.10.8 — E2E Cross-Video Object Tests**
   - deterministic multi-video scenarios covering reuse, movement, state, visibility, ambiguity and drift blocking.

## 11.10.1 — identity

The registry intentionally does not guess identity. An object with an explicit `objectKey` is globally addressable and its current location/zone is usage context. An object with `ownerKey` is owner-scoped. An object without either is location-scoped using the stable reusable `locationId`, which prevents unrelated objects such as two `Blue Sofa` instances in different houses from merging.

Zone is not part of canonical identity, so an object may move between rooms without becoming a new object. Temporary condition, damage, contents, lighting, open/closed state and momentary placement are excluded from canonical identity. Reusing an explicit `objectKey` with incompatible canonical attributes produces an identity conflict instead of silently mutating the original.

Accepted registry sources include `persistentObjects`, `worldObjects`, `canonicalObjects`, top-level `environmentBible.persistentObjects`, and Prop Locks explicitly marked persistent. Temporary props from 11.9.5 are not canonical world-object sources.

## 11.10.2 — aliases and resolver

Resolution keeps exact identity as the strongest source of truth. When an incoming object has no exact identity fingerprint, the resolver proceeds in this order:

1. explicit `objectKey` exact match;
2. persisted alias exact match;
3. normalized canonical name + compatible type exact match;
4. generic contextual resolution only when exactly one compatible canonical object remains;
5. otherwise `unresolved` or `ambiguous`.

Aliases may be provided through `aliases`, `objectAliases` and `localizedNames`; display name and `objectKey` are also persisted. Multiple objects may legally share the same alias, which is preserved as ambiguity rather than false global uniqueness.

The phase adds `persistent_world_object_aliases`, `persistent_world_object_resolutions`, production-bundle resolver audits and `test:persistent-world-object-resolver`. A legitimate new registration finishes as `registered_new` / `resolver_unresolved_register_new`, avoiding a stale provisional unresolved audit.

## 11.10.3 — canonical visual assets

A persistent object may receive one explicit provider-backed canonical visual reference. Accepted metadata includes nested `canonicalAsset` / `canonicalReference`, or explicit `canonicalAssetPath`, `canonicalReferencePath` / `objectReferencePath` plus provider/model metadata. A plain generic `assetPath` is not canonical evidence.

`local-renderer`, local/generic/fallback providers and fallback filenames such as `visual_local_*`, `thumbnail_local_*` and `object_local_*` are rejected. Supported formats are PNG, JPG/JPEG and WEBP.

The first valid reference is stored under `data/assets/object-library/<namespace>/<objectId>/object_reference.<ext>` with SHA-256, provider/model and source provenance. Later videos cannot silently overwrite the first ready canonical anchor. Scene keyframes are not auto-promoted in 11.10.3 because reliable visibility belongs to 11.10.5.

The phase adds `persistent_world_object_assets`, `persistentWorldObjectAssets`, `utils/canonical-world-object-assets-v11.js`, `test:canonical-world-object-assets`, `CANONICAL_WORLD_OBJECT_ASSETS_ENABLED=true` and `CANONICAL_WORLD_OBJECT_ASSET_REQUIRE_PROVIDER=true`.

## 11.10.4 — state / lifecycle

State is a mutable overlay over a stable `objectId`. Supported dimensions include condition, damage, cleanliness, open/closed state, operational state, contents, holder/use, placement and story state. State may come from nested `objectState`, `lifecycleState` or `state`, equivalent inline fields, or the `objectStates`, `persistentObjectStates` and `worldObjectStates` collections.

Two persistence modes exist:

- `scene` — default; never inherited automatically by a later video.
- `until_changed` — explicitly durable; may carry cross-video until an explicit later durable state or reset replaces it.

`resetState`, `clearState` or `clearPreviousState` can write a durable neutral state, preventing an older damaged/dirty/open state from reappearing. Contradictory single-value dimensions fail closed and remain auditable.

Every state row stores a separate state fingerprint and the canonical identity fingerprint for audit only. It cannot rewrite `objectId`, canonical type/brand/model/color/material or the 11.10.3 asset.

The phase adds `persistent_world_object_states`, parent-state lineage, `persistentWorldObjectStates`, `utils/persistent-world-object-state-v11.js`, `test:persistent-world-object-state`, `PERSISTENT_WORLD_OBJECT_STATES_ENABLED=true` and `PERSISTENT_WORLD_OBJECT_STATE_INHERIT_DURABLE=true`.

## 11.10.5 — scene / shot binding contracts

11.10.5 answers a different question from the registry: **does this canonical object actually belong in this generated frame?** Object existence, narrative mention and visual presence are intentionally different facts.

### Explicit declaration sources

Bindings are opt-in and may be declared through these collections on a scene, environment or Environment Bible:

- `objectBindings`
- `worldObjectBindings`
- `persistentObjectBindings`
- `shotObjectBindings`

A declaration may identify an object with `objectId`, `objectKey`, or an exact narrative reference/name. It may target the whole scene or explicit `shotIndex` / `shotIndexes`, and may specify `visibility`, `interaction`, `holderKey`/`holder`/`possessedBy`/`inUseBy`, `placement` and `required`.

The runtime does **not** parse arbitrary `scriptText` to infer that an object should be visible. A sentence mentioning the family car, by itself, creates no object binding and does not modify the shot prompt.

### Object resolution

A binding can only target an object already admitted by the 11.10.1/11.10.2 object plan. It never creates a new persistent object. Resolution order is:

1. exact `objectId`;
2. exact `objectKey`;
3. persisted alias exact match, restricted to objects already in the production object plan;
4. normalized exact display name / object key;
5. otherwise unresolved or ambiguous.

If multiple candidates match, no visual binding is created.

### Shot targeting

If no shot index is supplied, the declaration applies to every shot in the selected scene. When explicit shot indexes are supplied, every requested index must exist; an invalid index is audited as unresolved rather than silently moving the object to a different shot.

### Visibility semantics

- `visible` — render the exact persistent object identity.
- `occluded` — object is present and must preserve identity even if only partly visible.
- `offscreen` — object is relevant to the beat but must not be rendered in the frame.
- `mentioned` — reference-only; explicitly forbids hallucinating the object into view.

Aliases such as `not visible`, `hidden` and `out of frame` normalize to `offscreen`; `partial` normalizes to `occluded`; `mention` / `reference_only` normalize to `mentioned`.

Visible/occluded bindings may attach the 11.10.3 canonical asset and the applicable 11.10.4 state fingerprint to the shot prompt. Nonvisual bindings inject an explicit **do not render** constraint. All resolved prompts forbid replacing the object with a same-type generic prop or creating an unintended duplicate.

### Interaction semantics

Supported normalized interactions include `none`, `held`, `carried`, `used`, `operated`, `possessed`, `inside` and `worn`, with common aliases such as `holding`, `carrying`, `using` and `driving` normalized deterministically. Holder and placement remain usage semantics, not canonical identity.

### Contradictions fail closed

If the same object receives contradictory declarations for the same shot — for example `visible` and `offscreen` — the runtime emits a conflict and removes that object from resolved prompt enrichment for the shot. It does not choose whichever declaration appeared first.

### Fingerprint propagation

Binding semantics are part of visual generation input. Each resolved binding gets a deterministic `bindingFingerprint` covering object, shot, visibility, interaction, holder, placement, state fingerprint and canonical asset hash. Resolved bindings then change:

1. the shot fingerprint;
2. the scene-plan fingerprint / every shot `planFingerprint`;
3. the production shot-plan fingerprint.

Therefore changing an object from `offscreen` to `visible`, changing holder/placement, or changing the bound state/asset forces the existing shot persistence logic to recognize a different plan instead of reusing a stale shot.

### Persistence and runtime

The phase adds:

- `persistent_world_object_bindings`;
- `persistentWorldObjectBindings` in production bundles;
- `utils/persistent-world-object-binding-v11.js`;
- `test:persistent-world-object-binding`;
- `PERSISTENT_WORLD_OBJECT_BINDINGS_ENABLED=true`;
- `PERSISTENT_WORLD_OBJECT_BINDINGS_REQUIRE_EXPLICIT=true`.

The binder runs after the existing 11.2 shot planner has produced stable shot IDs, and before `scene_shots` are persisted. That makes explicit object presence part of the persisted shot plan rather than a late rendering-only annotation.

This phase also establishes the precise input boundary for 11.10.6: a future cross-video visual object continuity check should operate only on resolved `visible`/`occluded` bindings, not merely because the object exists in the production or is mentioned in narration.

## Runtime / persistence order

Materialization installs and verifies, in order:

1. `utils/persistent-world-object-registry-v11.js` — 11.10.1;
2. `utils/persistent-world-object-resolver-v11.js` — 11.10.2;
3. `utils/canonical-world-object-assets-v11.js` — 11.10.3;
4. `utils/persistent-world-object-state-v11.js` — 11.10.4;
5. `utils/persistent-world-object-binding-v11.js` — 11.10.5.

Each verifier must pass before the following stage is applied.

## Current boundary

11.10.1–11.10.5 now establish canonical object identity, provenance, aliases, conservative resolution, immutable provider-backed visual anchors, controlled mutable lifecycle state, and explicit scene/shot presence semantics that participate in shot regeneration. The cross-video visual object drift gate, operator correction UI and full object-system E2E suite remain for 11.10.6–11.10.8 and must not be claimed as complete yet.
