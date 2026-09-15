# Phase 11.9.3 — Canonical Location Assets

Phase 11.9.3 gives reusable locations and zones library-owned visual anchors that survive the production which originally created them.

## Asset scopes

Two canonical roles are persisted in `reusable_location_assets`:

- `location_master`: the provider-backed canonical Master Environment already owned by the 11.9.1 reusable location;
- `zone_reference`: a real generated keyframe promoted as the canonical visual reference for a stable 11.9.2 zone.

Assets are addressed by a deterministic `asset_key` and stored under the persistent location library rather than under a production directory:

```text
data/assets/location-library/<namespace>/<locationId>/location_master.<ext>
data/assets/location-library/<namespace>/<locationId>/zones/<zoneKey>/zone_reference.<ext>
```

## Promotion rules

A zone reference is not invented or accepted merely because its prompt names a room. Promotion requires:

1. a stable `locationId + zoneId` binding from 11.9.2;
2. a real ready image keyframe from a scene bound to that zone;
3. accepted Phase 11.7.6 Environment Continuity evidence by default;
4. no explicit rejected Phase 11.8 semantic evidence;
5. Phase 11.8 semantic truth when either global semantic fail-closed mode or the 11.9.3 semantic requirement is enabled;
6. no generic local-renderer fallback.

The preferred source is the earliest `start` keyframe because it is the establishing state of the shot. A later scene using the same zone reuses the existing asset and cannot silently replace its original canonical source.

A promoted story frame is deliberately called `zone_reference`, not a clean room master: it is a verified visual identity anchor and can still contain scene-specific subjects. Temporary-state separation and richer zone-specific generation remain later responsibilities of the 11.9 system.

## Provenance

Each asset records its source production, scene, keyframe/environment IDs, provider/model, SHA-256, Environment Continuity decision/score, and semantic verification decision when available.

## Configuration

```env
CANONICAL_LOCATION_ASSETS_ENABLED=true
CANONICAL_LOCATION_ASSET_REQUIRE_CONTINUITY=true
CANONICAL_LOCATION_ASSET_REQUIRE_SEMANTIC=false
```

`SEMANTIC_PROP_REQUIRE_VERIFICATION=true` also forces semantic verification for canonical zone promotion even if the 11.9.3 override remains false.

## Apply and verify

Apply 11.9.1 and 11.9.2 first, then:

```powershell
node ..\bootstrap\phase11-canonical-location-assets.js
npm run test:canonical-location-assets
```

The dedicated verifier covers deterministic asset identity, location-master copying, zone promotion, SHA-256 provenance, cross-video reuse, duplicate-zone handling, continuity fail-closed behavior, semantic fail-closed behavior, generic local fallback rejection, database/pipeline/dashboard wiring, and disabled mode.
