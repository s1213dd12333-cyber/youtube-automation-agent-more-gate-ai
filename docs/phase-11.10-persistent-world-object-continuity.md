# Phase 11.10 — Persistent World Objects / Cross-Video Object Continuity

Phase 11.10 extends the completed reusable-location system into persistent story-world objects. A recurring object must keep the same canonical identity across videos while lifecycle state, scene presence and camera/framing remain separate concerns.

## Roadmap

1. **11.10.1 — Persistent World Object Registry**
   - production-independent `objectId` / `objectKey`;
   - stable canonical identity fingerprint and provenance;
   - reusable location/zone and Prop Lock context;
   - temporary scene props excluded;
   - explicit-key identity conflicts fail closed.
2. **11.10.2 — Object Aliases + Resolver**
   - exact key / persisted alias / normalized exact-name precedence;
   - generic contextual reference only when one compatible object remains;
   - ambiguous aliases and canonical-attribute conflicts fail closed;
   - no broad fuzzy merge.
3. **11.10.3 — Canonical Object Assets**
   - one immutable provider-backed `object_reference` per object;
   - SHA-256, provider/model and origin provenance persisted;
   - local/generic fallback never canonical;
   - later videos cannot silently overwrite the first ready anchor.
4. **11.10.4 — Object State / Lifecycle Layers**
   - mutable condition, damage, cleanliness, open/closed, operational state, contents, holder/use, placement and story state;
   - `scene` vs `until_changed` persistence;
   - durable reset prevents stale state resurrection;
   - lifecycle state never rewrites canonical identity or asset.
5. **11.10.5 — Scene / Shot Object Binding**
   - explicit per-scene/per-shot presence;
   - `visible`, `occluded`, `offscreen`, `mentioned`;
   - interaction, holder and placement semantics;
   - narrative mention alone never creates visual presence;
   - binding changes propagate into shot/scene/production fingerprints.
6. **11.10.6 — Cross-Video Object Continuity Gate**
   - only resolved `visible` / `occluded` bindings are evaluated;
   - reused objects are checked against immutable canonical references;
   - declared lifecycle overlays are tolerated without relaxing canonical identity;
   - explicit missing/replacement/identity/state drift blocks the keyframe;
   - origin-production objects are audited, not falsely called cross-video verified.
7. **11.10.7 — Object Library UI + Operator Controls**
   - inspect identity, aliases, canonical assets, state, usage, shot bindings and continuity audits;
   - canonical identity and asset hashes are read-only in the operator UI;
   - safe alias creation with collision detection;
   - explicit linking of unresolved/ambiguous resolver decisions to an existing object;
   - every operator mutation is audited and dangerous silent retargeting is rejected.
8. **11.10.8 — E2E Cross-Video Object Tests**
   - deterministic multi-video scenarios covering reuse, movement, state, visibility, ambiguity, operator corrections and drift blocking.

## Canonical identity boundary

11.10.1 owns canonical object identity. Location and zone are usage context when a stable key/owner already anchors identity. Temporary damage, contents, open/closed state, lighting and momentary placement are not canonical identity fields. Reusing an explicit key with incompatible canonical attributes returns a conflict instead of mutating the object.

11.10.2 resolves aliases conservatively. Multiple matching objects remain ambiguous. A generic phrase such as `their car` resolves only when exactly one compatible object is available in the permitted scope.

## Canonical visual reference boundary

11.10.3 accepts only explicitly canonical provider-backed references. The first accepted file is copied under:

`data/assets/object-library/<namespace>/<objectId>/object_reference.<ext>`

with SHA-256 and provider/source provenance. Local/generic fallback sources are rejected. Arbitrary scene keyframes are not auto-promoted into object anchors.

## Lifecycle state boundary

11.10.4 treats state as an overlay over the stable `objectId`. `scene` state expires with the scene/production. `until_changed` may carry cross-video until another durable state or reset replaces it. Conflicting single-value dimensions remain audited and fail closed.

## Scene / shot presence boundary

11.10.5 answers whether an object belongs in a particular generated frame. Object existence and visual presence are different facts.

Accepted binding collections include `objectBindings`, `worldObjectBindings`, `persistentObjectBindings` and `shotObjectBindings`.

Visibility semantics:

- `visible` — render the exact persistent object;
- `occluded` — object is present but may be partly hidden;
- `offscreen` — relevant to the beat but must not be rendered;
- `mentioned` — reference-only and must not be hallucinated into view.

Resolved bindings participate in shot, scene-plan and production shot-plan fingerprints. Contradictory declarations for the same object/shot fail closed.

## 11.10.6 — Cross-Video Object Continuity Gate

The gate reads the current shot bindings and checks only resolved `visible` / `occluded` objects. `offscreen`, `mentioned`, unresolved and conflict rows are not visual checks.

For reused objects, IMAGE 1 is the immutable 11.10.3 object reference and IMAGE 2 is the newly generated keyframe. Vision is instructed to judge the object only: framing, crop, camera angle, background, scale, pose and lighting differences are not identity drift by themselves.

The semantic response covers `objectPresent`, `sameCanonicalObject`, `canonicalIdentityConsistent`, `stateConsistent`, confidence and explicit `identityMismatches`. A non-empty mismatch list forces identity inconsistency even if another provider field says otherwise.

Explicit failures block with reasons such as:

- `CROSS_VIDEO_OBJECT_MISSING`;
- `CROSS_VIDEO_OBJECT_REPLACED`;
- `CROSS_VIDEO_OBJECT_IDENTITY_DRIFT`;
- `CROSS_VIDEO_OBJECT_STATE_DRIFT`;
- `CROSS_VIDEO_OBJECT_CANONICAL_ASSET_MISSING`.

The gate runs after 11.9.6 location continuity and before a keyframe may become `ready`.

## 11.10.7 — Object Library UI + Operator Controls

### Read model

The Object Library exposes a namespace-scoped snapshot and per-object detail including:

- canonical object identity and fingerprint;
- aliases;
- canonical object assets with guarded asset URLs;
- lifecycle states;
- usage history across productions/locations/zones;
- scene/shot bindings;
- cross-video object continuity decisions;
- resolver decisions linked to the object;
- operator audit history;
- unresolved/ambiguous resolver decisions awaiting review.

The dashboard provides search/type/status filters plus counts for total objects, canonical-ready objects, cross-video objects and latest blocked continuity decisions.

### Canonical identity is read-only

The UI deliberately does **not** expose mutations for:

- `identityFingerprint`;
- `canonicalIdentity`;
- canonical asset SHA/provider/origin;
- `createdFromProductionId`;
- `objectKey` reassignment;
- object merge/delete.

Those values remain owned by earlier deterministic phases and cannot be silently rewritten by an operator click.

### Safe alias control

`POST /api/object-library/:objectId/aliases` is protected. The manager normalizes the alias and checks existing persisted aliases in the namespace.

- alias already linked to the same object -> `no_change`;
- alias unused -> persisted as `operator_confirmed_alias`;
- alias already points to another object -> rejected with `alias_key_already_points_to_other_object`.

The rejected attempt is also audited.

### Explicit resolver linking

`POST /api/object-library/resolutions/:resolutionId/link` is protected and can link an existing `unresolved` or `ambiguous` resolver decision to an existing canonical object.

The resulting resolution is persisted as:

- `status=resolved`;
- `matchMode=operator_explicit_link`;
- `confidence=1`;
- `candidateObjectIds=[selectedObjectId]`;
- `reason=operator_confirmed_reference_link`;
- canonical target `identityFingerprint` copied only for audit consistency.

Optional alias persistence is allowed only if that alias is not already owned by a different object. A resolution already resolved to another object cannot be silently retargeted through this control.

### Operator audit

11.10.7 adds `persistent_world_object_operator_actions`. Every alias/link attempt can record:

- action type;
- object/target ids;
- production id when relevant;
- applied/no-change/rejected status;
- actor/note;
- before/after snapshots;
- reason and timestamp.

This keeps manual intervention visible rather than converting it into hidden canonical mutation.

### API / dashboard surface

11.10.7 adds:

- `GET /api/object-library`;
- `GET /api/object-library/:objectId`;
- `GET /api/object-library/assets/:assetId`;
- `POST /api/object-library/:objectId/aliases`;
- `POST /api/object-library/resolutions/:resolutionId/link`;
- dashboard `Object library` view;
- `test:persistent-world-object-library-ui`.

Canonical asset serving is restricted to `data/assets/object-library` and requires `canonical=true` plus `status=ready`.

Feature flags:

- `PERSISTENT_WORLD_OBJECT_LIBRARY_ENABLED=true`;
- `PERSISTENT_WORLD_OBJECT_OPERATOR_CONTROLS_ENABLED=true`;
- `PERSISTENT_WORLD_OBJECT_OPERATOR_ALIAS_ENABLED=true`;
- `PERSISTENT_WORLD_OBJECT_OPERATOR_LINK_ENABLED=true`.

## Materialization order

The final chain now installs and verifies, in order:

1. 11.10.1 registry;
2. 11.10.2 resolver;
3. 11.10.3 canonical assets;
4. 11.10.4 state/lifecycle;
5. 11.10.5 scene/shot binding;
6. 11.10.6 cross-video object continuity gate;
7. 11.10.7 Object Library UI + audited operator controls.

Each verifier must pass before the next stage is applied.

## Current boundary

11.10.1–11.10.7 now provide persistent identity, conservative alias resolution, immutable canonical visual anchors, lifecycle state, explicit frame presence, cross-video object drift blocking, and an operator-visible/audited correction surface.

The remaining phase is **11.10.8 — deterministic E2E Cross-Video Object Tests**. Until that integrated multi-video suite is complete, Phase 11.10 as a whole must not be declared closed.
