# Phase 11.9.1 — Reusable Location Library

Phase 11.9.1 introduces a production-independent location registry so the same house, classroom, garden, or other recurring place can be referenced by multiple videos instead of being re-created as a new location record for every production.

## Persistent model

`reusable_locations` stores the canonical physical identity of a place. `reusable_location_usages` stores each production/environment binding to that shared location.

The canonical fingerprint intentionally excludes transient state such as description wording, time of day, weather, lighting mood, characters, and shot camera language. It includes stable physical identity: category/name, construction, architectural style, materials, palette, layout, signature elements, forbidden changes, and required prop attributes. Production-local Prop Lock IDs are excluded from the identity hash.

Exact stable-identity reuse is the only automatic merge mode in 11.9.1. Semantic aliases/similarity matching are deliberately deferred to 11.9.4 so this phase cannot silently merge two uncertain locations.

## Canonical master ownership

When a provider-backed canonical Master Environment exists, the library copies it into:

```text
data/assets/location-library/<namespace>/<locationId>/master.<ext>
```

This makes the shared location own its canonical reference instead of depending on a production-specific master path. Missing masters remain `registered_unanchored`; the library never fabricates canonical readiness.

## Configuration

```env
REUSABLE_LOCATION_LIBRARY_ENABLED=true
REUSABLE_LOCATION_NAMESPACE=default
```

Use a stable namespace per channel/series when one database serves more than one independent identity universe.

## Apply and verify

Run after the Phase 11.8 bootstrap has been materialized:

```powershell
node ..\bootstrap\phase11-reusable-location-library.js
npm run test:reusable-locations
```

The dedicated verifier covers cross-video reuse, identity stability, layout drift separation, canonical asset ownership, truthful unanchored state, database schema/methods, pipeline wiring, dashboard wiring, and configuration.
