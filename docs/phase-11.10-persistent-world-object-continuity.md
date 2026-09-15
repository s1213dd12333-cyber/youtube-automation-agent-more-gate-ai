# Phase 11.10 — Persistent World Objects / Cross-Video Object Continuity

Phase 11.10 extends the completed reusable-location system into persistent story-world objects. The core rule is that an object introduced in one video can remain the same canonical object in later videos without confusing identity, temporary lifecycle state, narrative mention, or same-type generic props.

## Roadmap

1. **11.10.1 — Persistent World Object Registry**
   - production-independent `objectId` / `objectKey`;
   - stable canonical identity fingerprint and provenance;
   - optional reusable location/zone and Prop Lock context;
   - temporary scene props excluded;
   - explicit-key identity conflicts fail closed.
2. **11.10.2 — Object Aliases + Resolver**
   - exact key / exact persisted alias / normalized exact name precedence;
   - contextual generic reference only when exactly one compatible object remains;
   - duplicate aliases and canonical attribute conflicts fail closed;
   - no broad fuzzy merge.
3. **11.10.3 — Canonical Object Assets**
   - one immutable provider-backed `object_reference` per persistent object;
   - origin hash/provider/model/provenance persisted;
   - local/generic fallback never canonical;
   - later videos cannot silently overwrite the first ready anchor.
4. **11.10.4 — Object State / Lifecycle Layers**
   - mutable condition, damage, cleanliness, open/closed, operational state, contents, holder/use, placement and story state;
   - `scene` vs `until_changed` persistence;
   - durable reset prevents stale state resurrection;
   - state never rewrites canonical identity or canonical assets.
5. **11.10.5 — Scene / Shot Object Binding**
   - explicit per-scene/per-shot object presence;
   - `visible`, `occluded`, `offscreen`, `mentioned`;
   - interaction, holder and placement semantics;
   - narrative mention alone never creates visual presence;
   - binding changes propagate into shot/scene/production fingerprints.
6. **11.10.6 — Cross-Video Object Continuity Gate**
   - evaluate only resolved `visible` / `occluded` bindings;
   - compare reused objects against immutable 11.10.3 canonical references;
   - preserve canonical identity while allowing declared 11.10.4 lifecycle overlays;
   - explicit missing object, replacement, identity drift or state drift blocks the keyframe;
   - `offscreen` / `mentioned` bindings are excluded from visual checking;
   - origin-production objects are audited but are not treated as cross-video reuse.
7. **11.10.7 — Object Library UI + Operator Controls**
   - inspect identities, aliases, assets, state, shot usage, continuity audits and conflicts;
   - safe operator corrections and explicit linking.
8. **11.10.8 — E2E Cross-Video Object Tests**
   - deterministic multi-video scenarios covering reuse, movement, state, visibility, ambiguity and drift blocking.

## Canonical identity boundary

11.10.1 owns canonical object identity. Location/zone is usage context when a global key or owner already anchors identity. Temporary damage, contents, open/closed state, lighting and momentary placement are not identity fields. Reusing an explicit key with incompatible canonical attributes returns a conflict instead of mutating the object.

11.10.2 resolves narrative aliases conservatively. Multiple matching objects remain ambiguous. A generic phrase such as `their car` resolves only when exactly one compatible object exists in the permitted scope.

## Canonical visual reference boundary

11.10.3 accepts only explicitly canonical provider-backed object references. The first accepted file is copied under:

`data/assets/object-library/<namespace>/<objectId>/object_reference.<ext>`

with SHA-256 and provider/source provenance. Local-renderer/generic fallback sources are rejected. Arbitrary generated scene keyframes are not auto-promoted into canonical object references.

## Lifecycle state boundary

11.10.4 treats state as an overlay over the stable `objectId`. `scene` state expires with the scene/production. `until_changed` state may carry cross-video until another durable state or reset replaces it. Conflicting single-value dimensions remain audited and fail closed.

## Scene / shot presence boundary

11.10.5 answers whether the object belongs in a particular generated frame. Object existence and visual presence are different facts.

Accepted explicit binding collections include `objectBindings`, `worldObjectBindings`, `persistentObjectBindings` and `shotObjectBindings`. Resolution is restricted to objects already admitted by the object registry/resolver.

Visibility semantics:

- `visible` — render the exact persistent object;
- `occluded` — object is present but may be partly hidden;
- `offscreen` — relevant to the beat but must not be rendered;
- `mentioned` — reference-only and must not be hallucinated into view.

Resolved bindings participate in the shot fingerprint, scene-plan fingerprint and production shot-plan fingerprint. Contradictory declarations for the same object/shot fail closed.

## 11.10.6 — Cross-Video Object Continuity Gate

### Evaluation scope

The gate reads `persistent_world_object_bindings` for the current generated shot and evaluates **only** rows whose status is `resolved` and whose visibility is `visible` or `occluded`.

`offscreen`, `mentioned`, unresolved and conflict rows are not visual checks. This prevents false failures merely because an object exists in the production or is referenced in narration.

### Origin vs reused objects

An object whose `createdFromProductionId` equals the current production is recorded as `origin_production` and accepted without pretending it has already demonstrated cross-video consistency.

An object created in a different production is treated as reused. By default a reused visible object must have a ready canonical `object_reference`; otherwise the keyframe is blocked with `CROSS_VIDEO_OBJECT_CANONICAL_ASSET_MISSING`.

### Two-image semantic comparison

For a reused visible object, the gate supplies two images to an OpenAI-compatible vision provider:

1. IMAGE 1 — the immutable 11.10.3 canonical object reference;
2. IMAGE 2 — the newly generated full scene/keyframe.

The verifier is instructed to judge the bound object only. Camera angle, crop, scale, background, scene composition, pose and lighting differences are explicitly not object-identity mismatches.

The response contract includes:

- `objectPresent`;
- `sameCanonicalObject`;
- `canonicalIdentityConsistent`;
- `stateConsistent`;
- `confidence`;
- `identityMismatches`;
- short visible-evidence notes.

A non-empty `identityMismatches` list is treated as identity drift even if another provider field incorrectly says identity is consistent.

### Lifecycle tolerance

The prompt receives the applicable 11.10.4 state row. Damage, cleanliness, open/closed state, contents, holder/use, placement and story/operational state may legitimately differ when declared by the lifecycle layer.

Those overlays may not rewrite stable object type, recognizable form/silhouette, specified brand/model, canonical base material/color outside declared state changes, or distinguishing marks.

An explicit `stateConsistent=false` response blocks with `CROSS_VIDEO_OBJECT_STATE_DRIFT`.

### Fail-closed decisions

Explicit semantic evidence always wins:

- required visible object missing -> `CROSS_VIDEO_OBJECT_MISSING`;
- different same-type/replacement object -> `CROSS_VIDEO_OBJECT_REPLACED`;
- canonical identity mismatch -> `CROSS_VIDEO_OBJECT_IDENTITY_DRIFT`;
- declared lifecycle state mismatch -> `CROSS_VIDEO_OBJECT_STATE_DRIFT`.

Any of those results sets the keyframe status to `cross_video_object_continuity_failed` and throws `CROSS_VIDEO_OBJECT_CONTINUITY_FAILED` before the keyframe can become `ready`.

### Provider strictness

Defaults:

- `CROSS_VIDEO_OBJECT_CONTINUITY_ENABLED=true`
- `CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_CANONICAL_ASSET=true`
- `CROSS_VIDEO_OBJECT_CONTINUITY_REQUIRE_VISION=false`
- `CROSS_VIDEO_OBJECT_CONTINUITY_MIN_CONFIDENCE=0.72`

When dedicated `CROSS_VIDEO_OBJECT_VISION_*` settings are blank, the gate reuses `SEMANTIC_PROP_VISION_*` configuration.

Non-strict mode keeps provider absence, provider errors, invalid responses or low confidence as unverified/audit-only outcomes, but **known explicit mismatches still block**. Strict mode blocks missing/unverified vision evidence. The global `SEMANTIC_PROP_REQUIRE_VERIFICATION=true` setting automatically makes the object gate strict as well.

### Pipeline order

The effective keyframe order is:

1. normal keyframe generation and existing continuity checks;
2. 11.9.6 reusable location/zone cross-video continuity gate;
3. 11.10.6 persistent object cross-video continuity gate;
4. keyframe may become `ready` only if all required gates accept it.

This prevents a frame from passing location continuity while silently replacing a recurring object.

### Persistence / dashboard

11.10.6 adds `cross_video_object_continuity_checks`, one auditable decision per persistent object/keyframe/attempt. Rows store object/binding/state/canonical asset references, provider/model, confidence, presence/identity/state decisions, mismatch reasons and prompt/response fingerprints.

The production bundle exposes `crossVideoObjectContinuityChecks`; the dashboard renders a dedicated `CROSS-VIDEO OBJECT CONTINUITY GATE V11.10.6` panel.

The npm verifier is `test:cross-video-object-continuity`.

## Materialization order

The final materialization chain now installs and verifies, in order:

1. 11.10.1 registry;
2. 11.10.2 resolver;
3. 11.10.3 canonical assets;
4. 11.10.4 state/lifecycle;
5. 11.10.5 scene/shot binding;
6. 11.10.6 cross-video object continuity gate.

Each verifier must pass before the next stage is applied.

## Current boundary

11.10.1–11.10.6 now provide persistent object identity, conservative alias resolution, immutable canonical visual references, controlled lifecycle state, explicit frame presence semantics and a cross-video identity-drift gate before keyframe readiness.

Object Library UI/operator correction workflows and the complete deterministic multi-video object E2E suite remain for **11.10.7–11.10.8** and must not be claimed as complete yet.
