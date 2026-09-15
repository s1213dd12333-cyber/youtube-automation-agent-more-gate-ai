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
   - no broad fuzzy merge;
   - ambiguity fails closed.
3. **11.10.3 — Canonical Object Assets**
   - provider-backed canonical object references;
   - provenance and immutable origin hash;
   - generic local fallback never becomes canonical.
4. **11.10.4 — Object State / Lifecycle Layers**
   - temporary damage, cleanliness, open/closed, contents, ownership-in-use and story state;
   - state changes never silently rewrite canonical identity.
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

## Runtime / persistence

Materialization installs `utils/persistent-world-object-registry-v11.js` and adds:

- `persistent_world_objects`
- `persistent_world_object_usages`
- `persistentWorldObjects` in production bundles
- `test:persistent-world-objects` in `package.json`
- `PERSISTENT_WORLD_OBJECTS_ENABLED=true`
- `PERSISTENT_WORLD_OBJECT_NAMESPACE=default`

The scene pipeline registers persistent objects after reusable locations/zones are resolved and before Temporary State Layers are applied.

## Current boundary

11.10.1 establishes identity and provenance only. Alias resolution, canonical visual assets, lifecycle state, shot-level binding and visual continuity gates belong to 11.10.2–11.10.8 and must not be claimed as complete yet.
