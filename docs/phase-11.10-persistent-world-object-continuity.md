# Phase 11.10 — Persistent World Objects / Cross-Video Object Continuity

Phase 11.10 extends the completed 11.9 reusable-location system from persistent places to persistent story-world objects. The goal is to let an object introduced in one video remain the same canonical object in later videos without confusing it with temporary scene props or generic objects of the same type.

## Roadmap

1. **11.10.1 — Persistent World Object Registry**
   - production-independent object identity;
   - stable `objectId`, `objectKey`, identity fingerprint and provenance;
   - optional binding to reusable `locationId` / `zoneId` and Prop Lock;
   - exact-identity reuse only;
   - temporary scene props are excluded;
   - explicit object-key identity conflicts fail closed.
2. **11.10.2 — Object Aliases + Resolver**
   - safe aliases and narrative references (`family car`, `their car`, localized names);
   - exact object key / alias / normalized name precedence;
   - generic references resolve only when exactly one compatible object remains;
   - canonical attribute mismatches, duplicate aliases and multi-candidate context fail closed;
   - no broad fuzzy merge.
3. **11.10.3 — Canonical Object Assets**
   - explicit provider-backed canonical object references;
   - immutable origin hash and provenance;
   - one canonical `object_reference` per persistent `objectId`;
   - generic/local fallback never becomes canonical;
   - ambiguous or unresolved asset-to-object bindings fail closed.
4. **11.10.4 — Object State / Lifecycle Layers**
   - mutable condition, damage, cleanliness, open/closed, operational state, contents, possession-in-use, placement and story state;
   - explicit `scene` vs `until_changed` persistence;
   - only durable `until_changed` state may carry across videos;
   - explicit durable reset prevents stale prior state from reappearing;
   - conflicting dimensions fail closed and remain audited;
   - state never rewrites canonical identity or canonical assets.
5. **11.10.5 — Scene / Shot Object Binding**
   - bind persistent objects to scenes and shots;
   - explicit visibility / possession / placement semantics.
6. **11.10.6 — Cross-Video Object Continuity Gate**
   - compare reused objects against canonical references;
   - tolerate legitimate state changes while blocking identity drift or silent replacement.
7. **11.10.7 — Object Library UI + Operator Controls**
   - inspect identities, aliases, assets, usage history and conflicts;
   - safe operator corrections and explicit linking.
8. **11.10.8 — E2E Cross-Video Object Tests**
   - deterministic multi-video scenarios covering reuse, movement, state changes, ambiguity and drift blocking.

## 11.10.1 identity rules

The first stage intentionally does not guess object identity.

- An object with an explicit `objectKey` is globally addressable. Its current location/zone is usage context, not identity.
- An object with an `ownerKey` is owner-scoped.
- An object without an explicit key or owner is location-scoped using the stable reusable `locationId`. This prevents two unrelated `Blue Sofa` objects in two houses from merging.
- Zone is not part of canonical identity, so a persistent object can move between rooms within its stable scope without becoming a new object.
- Temporary condition, damage, lighting, contents, open/closed state and momentary placement are not part of the canonical fingerprint.
- A reused explicit `objectKey` whose canonical attributes conflict with the existing object fails closed as `identity_conflict`; the registry does not silently mutate the original object.

## Accepted sources in 11.10.1

The registry accepts explicit object declarations from environment metadata:

- `persistentObjects`
- `worldObjects`
- `canonicalObjects`
- top-level `environmentBible.persistentObjects`

It also accepts Prop Locks only when explicitly marked persistent through fields such as `worldPersistent`, `persistent`, `crossVideo`, `persistence`, `scope`, or `continuityScope`.

Temporary props from Phase 11.9.5 are not an input source and are explicitly excluded from canonical world-object identity.

## 11.10.2 resolution order

The resolver keeps Phase 11.10.1 exact identity as the strongest source of truth. When an incoming persistent object does not have an exact identity fingerprint, resolution proceeds conservatively:

1. explicit `objectKey` exact match;
2. persisted alias exact match;
3. normalized canonical name + compatible object type exact match;
4. contextual generic resolution only when exactly one compatible canonical object remains;
5. otherwise unresolved or ambiguous.

Examples:

- `Family Car` can persist aliases such as `family car` and `Carro da Família Miller` and later resolve those exact aliases to the same `objectId`.
- `their car` / `o carro da família` are treated as generic vehicle references. They resolve only if there is exactly one compatible vehicle candidate in the permitted scope.
- If two compatible cars exist, the result is `ambiguous`; the resolver never chooses the first row.
- A location-scoped object cannot be reused from another location merely because its name/type match.
- An explicit-key or alias candidate that supplies canonical attributes conflicting with the existing object is rejected instead of rewriting identity.

There is intentionally no edit-distance, embedding-nearest-neighbor, or broad fuzzy-name merge in 11.10.2.

## 11.10.2 aliases and audit

Object declarations may provide aliases through `aliases`, `objectAliases` and `localizedNames`. Canonical display name and `objectKey` are also persisted as aliases. Multiple objects may legally share the same alias key; that situation is preserved and resolves as ambiguous instead of enforcing false global uniqueness.

The phase adds `persistent_world_object_aliases`, `persistent_world_object_resolutions`, `persistentWorldObjectResolutions` in production bundles, `test:persistent-world-object-resolver`, `PERSISTENT_WORLD_OBJECT_RESOLVER_ENABLED=true` and `PERSISTENT_WORLD_OBJECT_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true`.

Resolution audits include final `status`, selected `objectId`, `matchMode`, confidence, candidate IDs and reason. When a resolver attempt legitimately ends by registering a new canonical object, the final row becomes `registered_new` with `resolver_unresolved_register_new`.

## 11.10.3 canonical asset contracts

Phase 11.10.3 gives a persistent `objectId` an immutable canonical visual reference without guessing object presence inside arbitrary scene images.

Accepted explicit declarations include nested `canonicalAsset` / `canonicalReference` metadata or explicit `canonicalAssetPath`, `canonicalReferencePath`, `objectReferencePath` plus provider/model fields. A plain generic `assetPath` is intentionally not treated as canonical evidence.

Default policy requires provider provenance. `local-renderer`, local/generic/fallback providers and local fallback filenames such as `visual_local_*`, `thumbnail_local_*` and `object_local_*` are rejected. Supported canonical image formats are PNG, JPG/JPEG and WEBP.

Asset declarations are bound to an already-resolved persistent object by explicit `objectKey`, persistent Prop Lock ID, explicit source reference, or an otherwise unique environment/name/type binding. Multiple matching objects produce `ambiguous`; no asset is promoted.

The first valid provider-backed reference is copied to `data/assets/object-library/<namespace>/<objectId>/object_reference.<ext>` and persisted with SHA-256, provider/model, source production/environment/reference/Prop Lock and the object identity fingerprint. Once ready, later videos cannot silently overwrite it.

The phase adds `persistent_world_object_assets`, `persistentWorldObjectAssets`, `utils/canonical-world-object-assets-v11.js`, `test:canonical-world-object-assets`, `CANONICAL_WORLD_OBJECT_ASSETS_ENABLED=true` and `CANONICAL_WORLD_OBJECT_ASSET_REQUIRE_PROVIDER=true`.

Scene/shot-level knowledge of whether a persistent object is actually visible belongs to 11.10.5, so 11.10.3 does not auto-promote arbitrary keyframes.

## 11.10.4 state / lifecycle contracts

Phase 11.10.4 adds mutable state on top of a stable canonical `objectId`. Supported state dimensions include:

- `condition` / `conditions`;
- `damage` / `damages`;
- `cleanliness`;
- `openState` / `openness` / `openStates`;
- `operationalState`;
- `contents`;
- `holderKey`, `holder`, `possessedBy` or `inUseBy`;
- `placement`;
- `storyState` / `storyStates`.

State may be supplied through nested `objectState`, `lifecycleState` or `state`, through equivalent inline fields on persistent object declarations, or through `objectStates`, `persistentObjectStates` and `worldObjectStates` collections.

Two persistence modes exist:

- `scene` — default. It is local to that production/scene and is never inherited automatically by later videos.
- `until_changed` — explicitly durable. Aliases such as `durable`, `persistent` and `carry_forward` normalize to this mode. A later production that reuses the same object and supplies no replacement state may inherit the latest durable state.

Durable inheritance is therefore opt-in, not an assumption. A state can be explicitly cleared with `resetState`, `clearState` or `clearPreviousState`; when combined with durable persistence this writes a neutral durable state, so later videos inherit neutral instead of resurrecting an older damaged/dirty/open state.

Conflicting single-value dimensions fail closed. For example, `openStates: ['open', 'closed']` yields `status=conflict`; that disputed dimension is omitted and the conflict remains auditable rather than choosing one value arbitrarily.

Every state row stores the canonical object identity fingerprint for audit, but the state fingerprint is separate. The state prompt explicitly forbids rewriting `objectId`, canonical identity fingerprint, object type, brand/model, canonical color/material or the 11.10.3 canonical object asset.

The phase adds:

- `persistent_world_object_states`;
- `persistentWorldObjectStates` in production bundles;
- parent-state lineage through `parent_state_id`;
- `utils/persistent-world-object-state-v11.js`;
- `test:persistent-world-object-state`;
- `PERSISTENT_WORLD_OBJECT_STATES_ENABLED=true`;
- `PERSISTENT_WORLD_OBJECT_STATE_INHERIT_DURABLE=true`.

Object state runs after identity/resolution and canonical object assets, and before the existing location Temporary State Layer. Scene/shot visibility semantics remain reserved for 11.10.5.

## Runtime / persistence

Materialization installs:

- `utils/persistent-world-object-registry-v11.js`
- `utils/persistent-world-object-resolver-v11.js`
- `utils/canonical-world-object-assets-v11.js`
- `utils/persistent-world-object-state-v11.js`

The gates execute sequentially: 11.10.1 registry, 11.10.2 resolver, 11.10.3 canonical assets, then 11.10.4 state/lifecycle. Each verifier must pass before the next stage is applied.

## Current boundary

11.10.1–11.10.4 now establish canonical object identity, provenance, aliases, conservative narrative resolution, immutable provider-backed visual anchors and explicit mutable lifecycle state with controlled durable inheritance. Scene/shot binding, visual cross-video object drift gates, operator correction UI and full object E2E coverage remain for 11.10.5–11.10.8 and must not be claimed as complete yet.
