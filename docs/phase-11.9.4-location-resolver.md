# Phase 11.9.4 — Location Resolver

Phase 11.9.4 resolves different narrative references to the same reusable `locationId` before Phase 11.9.1 creates a new library entry.

Examples:

```text
Miller House
Miller home
Casa dos Miller
```

can resolve to one canonical location when the evidence is unambiguous.

Generic references such as `their house` are intentionally stricter. They are reused only when structural evidence is exact and unique, or when the current production already has exactly one compatible location. Two plausible houses remain `ambiguous`; the resolver never chooses the first row or uses edit-distance guessing.

## Resolution order

1. exact persisted alias;
2. normalized named entity + location type;
3. exact structural identity excluding display name;
4. one compatible production-bound location for a generic reference;
5. unresolved / ambiguous fail-closed result.

The resolver does **not** use broad fuzzy string matching. `Miller House` and `Miller Guest House` stay distinct because their normalized entity tokens differ.

## Persistence

`reusable_location_aliases` stores non-generic aliases under a namespace and location.

`reusable_location_resolutions` stores the audited decision for each production/environment pair, including status, chosen `locationId`, match mode, confidence, candidate IDs, reason, and incoming identity fingerprint.

Generic aliases such as `home`, `the house`, or `their house` are not persisted globally because they would poison future cross-video lookup.

## Reusable Location Library integration

Phase 11.9.1 now asks the resolver before creating a new `locationId`.

When a resolver match reuses an existing location:

- the original canonical `identityFingerprint` stays unchanged;
- the new production receives a normal `reusable_location_usage`;
- `match_mode` records `alias_exact`, `normalized_entity_type_match`, `structural_identity_exact_without_name`, or `context_unique_production_location`;
- observed non-generic aliases are attached to the existing location.

If resolution is ambiguous, no new location is created for that environment and downstream zone binding remains truthfully unresolved.

## Configuration

```env
REUSABLE_LOCATION_RESOLVER_ENABLED=true
REUSABLE_LOCATION_RESOLVER_MIN_CONFIDENCE=0.82
REUSABLE_LOCATION_RESOLVER_ALLOW_CONTEXTUAL_GENERIC=true
```

## Apply and verify

Apply 11.9.1–11.9.3 first, then:

```powershell
node ..\bootstrap\phase11-location-resolver.js
npm run test:location-resolver
```

The verifier covers English/Portuguese name equivalence, alias persistence, structural matching without display names, generic-context reuse, alias collisions, duplicate-structure ambiguity, confidence thresholds, disabled mode, SQLite integration, Reusable Location Library wiring, dashboard audit rendering, and configuration.
