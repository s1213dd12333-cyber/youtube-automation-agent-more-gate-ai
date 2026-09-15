# Phase 11.7.6 — Environment Continuity Validation

Phase 11.7.6 makes persistent environments a fail-closed visual contract instead of prompt-only guidance.

## Pipeline

`Environment Bible 11.7.1 -> Prop Locks 11.7.2 -> Master Environment 11.7.3 -> Scene Mapping 11.7.4 -> Prompt Enrichment 11.7.5 -> Environment Continuity 11.7.6`

For mapped cartoon scenes, keyframe generation now requires a canonical Master Environment by default. If a scene is unresolved or its canonical master is unavailable, keyframe generation stops instead of silently falling back to a generic location.

## What is validated from pixels

Each generated keyframe is compared with the canonical Master Environment using deterministic image evidence:

- aspect-ratio similarity;
- global palette similarity;
- luminance similarity;
- coarse 4x4 composition/layout similarity;
- perceptual dHash similarity;
- structural edge-density similarity.

Default threshold:

```env
ENVIRONMENT_CONTINUITY_MIN_SCORE=0.42
```

The score is deliberately more tolerant than character-to-character continuity because camera angle, character staging, and action can change while the location remains the same.

## Required props

Required Prop Locks are also checked against the enriched keyframe prompt. Default contract:

```env
ENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE=1
```

This proves that required props remain in the generation contract. It does **not** claim that a semantic vision detector has visually recognized the sofa/table/etc. in the rendered image. Persisted reports therefore record:

- `semanticPropPresenceVerified=false`
- `propVerificationMode=prompt-contract-only`

Semantic object-presence detection would require a separate vision-capable detector and is not fabricated here.

## Fail-closed behavior

Defaults:

```env
ENVIRONMENT_CONTINUITY_ENABLED=true
ENVIRONMENT_CONTINUITY_REQUIRE_MASTER=true
ENVIRONMENT_CONTINUITY_MIN_SCORE=0.42
ENVIRONMENT_CONTINUITY_MIN_PROP_PROMPT_COVERAGE=1
```

Stable failure codes:

- `ENVIRONMENT_MAPPING_REQUIRED`
- `ENVIRONMENT_MASTER_REQUIRED`
- `ENVIRONMENT_CONTINUITY_FAILED`

A rejected keyframe is persisted as `environment_continuity_failed` and cannot become a ready keyframe.

## Character continuity boundary

Phase 11.4 remains responsible for character/keyframe-to-keyframe continuity. The first character keyframe remains an 11.4 anchor even when the image provider used the Master Environment as a generation reference. Phase 11.7.6 independently evaluates that first frame against the location master.

This prevents a Master Environment image without characters from being incorrectly treated as a character-similarity reference.

## Persistence

New table:

`environment_continuity_checks`

Each record includes environment id, keyframe id, score, threshold, status, metrics, reasons, master evidence, candidate fingerprint, required-prop prompt coverage, and the explicit semantic-prop verification limitation.

The production bundle exposes `environmentContinuityChecks`.

## Quality and publication boundary

The existing Phase 11.6 Cartoon Quality Gate now requires a current accepted Phase 11.7.6 decision for each keyframe belonging to a mapped environment. Missing or rejected decisions are CRITICAL blocking findings. Environment continuity state is included in the Cartoon Quality fingerprint, so a changed environment/keyframe invalidates stale quality approval.

## Runtime consequence with no image-provider quota

If Master Environment generation cannot produce a canonical provider-backed image (for example, an image provider is quota-exhausted and only the generic local fallback is available), Phase 11.7.6 blocks downstream keyframe production by default. This is intentional: the system prefers an explicit missing canonical environment over producing a generic, inconsistent house and pretending continuity is satisfied.
