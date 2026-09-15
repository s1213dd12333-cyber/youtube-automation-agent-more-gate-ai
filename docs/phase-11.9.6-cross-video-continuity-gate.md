# Phase 11.9.6 — Cross-Video Continuity Gate

Phase 11.9.6 verifies reused locations and zones against the canonical visual assets from Phase 11.9.3 before a generated keyframe becomes ready.

## Rules

For a later video that reuses a location, a scene with `zoneId` uses its canonical `zone_reference`. A scene without a zone uses the reusable location `location_master`. Missing required anchors are treated as unresolved continuity evidence. Whole-location fallback for a zoned scene is disabled by default.

Phase 11.9.5 Temporary State is considered separately. `structuralScore` measures aspect, composition, perceptual structure and edge structure. `appearanceScore` measures palette and luminance. Active temporary state may allow appearance differences such as night, rain or lighting changes, while structural continuity remains required.

Explicit Phase 11.8 semantic evidence of an environment/layout mismatch rejects continuity. Positive semantic verification can also be required with configuration.

## Persistence

`cross_video_continuity_checks` stores production, scene, shot and keyframe IDs, `locationId`, `zoneId`, canonical asset provenance, Temporary State fingerprint, structural and appearance scores, metrics, reasons, semantic state, and reference/candidate fingerprints.

A rejected reused keyframe receives `cross_video_continuity_failed` and the keyframe pipeline raises `CROSS_VIDEO_CONTINUITY_FAILED`.

## Configuration

```env
CROSS_VIDEO_CONTINUITY_ENABLED=true
CROSS_VIDEO_CONTINUITY_REQUIRE_CANONICAL_ASSET=true
CROSS_VIDEO_CONTINUITY_ALLOW_LOCATION_FALLBACK_FOR_ZONE=false
CROSS_VIDEO_CONTINUITY_STRUCTURAL_MIN_SCORE=0.44
CROSS_VIDEO_CONTINUITY_APPEARANCE_MIN_SCORE=0.35
CROSS_VIDEO_CONTINUITY_REQUIRE_SEMANTIC=false
```

## Verify

```powershell
node ..\bootstrap\phase11-cross-video-continuity.js
npm run test:cross-video-continuity
```

The verifier covers zone-anchor selection, temporary-state appearance tolerance, structural drift detection, semantic mismatch handling, missing-anchor behavior, origin-production handling, unresolved-location handling, database/pipeline/dashboard wiring, configuration and disabled mode.
