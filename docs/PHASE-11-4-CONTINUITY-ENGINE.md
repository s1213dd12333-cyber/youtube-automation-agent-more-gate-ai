# Phase 11.4 — Cartoon Continuity Engine

Phase 11.4 hardens the Phase 11.3 start/middle/end keyframe pipeline against visual drift.

## Runtime contract

For every cartoon keyframe after the first anchor in a scene, the system resolves the previous ready keyframe and uses it as a continuity reference.

When Gemini image generation is available, the previous image is sent as inline image input together with the new keyframe prompt. The runtime records `referenceConditioned=true` only when that image was actually sent to the provider. If reference conditioning is unavailable, generation may continue through the existing image path, but post-generation continuity validation still runs.

## Deterministic continuity score

The local Continuity Engine computes signatures for the reference and candidate images and scores:

- aspect-ratio stability;
- mean palette stability;
- luminance stability;
- 4×4 composition-grid similarity;
- perceptual dHash similarity.

Default configuration:

```env
CARTOON_CONTINUITY_MIN_SCORE=0.48
CARTOON_CONTINUITY_AUTO_REPAIR=true
CARTOON_CONTINUITY_MAX_REPAIR_ATTEMPTS=1
```

The first keyframe in each scene is a continuity anchor. Later keyframes require a valid reference. Missing references fail closed.

## Repair

When a frame scores below the threshold, the engine can perform one bounded repair by default. The repair prompt freezes character silhouette, facial landmarks, eye shape, palette, costume, markings, props, background landmarks, and screen direction while allowing only the pose/expression/action required by the current keyframe.

If the repaired frame still fails, the keyframe becomes `continuity_failed` and the scene cannot be treated as ready.

## Persistence

Phase 11.4 adds `keyframe_continuity_checks` with one record per attempt. The audit stores score, threshold, component metrics, reasons, attempt number, reference keyframe id, and whether provider-level reference conditioning actually occurred.

Review Studio shows the latest continuity result for each keyframe.

## Important limitation

The deterministic validator is not a semantic face-recognition or character-recognition model. It detects broad perceptual, palette, composition, luminance, and geometry drift. The strongest identity control in Phase 11.4 is the combination of Character Bible + shot prompt + provider-level reference conditioning where supported + post-generation fail-closed scoring.

A future multimodal semantic identity validator can be added without weakening this deterministic layer.

## Regression

```bash
npm run test:continuity
```

Expected:

```text
Phase 11.4 Continuity Engine OK: 36 regression checks passed.
```

## Completion boundary

Phase 11.4 is complete only after Windows materialization and regression tests pass and a real cartoon production shows persisted continuity checks across generated keyframes. Motion composition remains Phase 11.5.
