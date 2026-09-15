# Phase 11.5 — Cartoon Motion Composer

Phase 11.5 converts the accepted Phase 11.3/11.4 `start / middle / end` keyframes into deterministic local video motion.

It is intentionally a local FFmpeg composer. It does not claim optical-flow character animation or a paid image-to-video model.

## Runtime contract

The composer runs only for productions that already have the Phase 11 cartoon path active. A shot is eligible only when it has exactly three persisted keyframes in this order:

1. `start`
2. `middle`
3. `end`

Every keyframe must be `ready` and its asset must exist. A `continuity_failed`, missing, or stale keyframe blocks motion composition rather than silently falling back to the old one-image slideshow.

## Motion language

The shot planner controls the motion profile:

- `wide` → gentle lateral drift;
- `medium` → alternating gentle push/pull;
- `close_up` → gentle push;
- `reaction` → gentle push;
- `action` → alternating lateral drift;
- `ending` → gentle pull.

Each of the three keyframes becomes a short local video clip through FFmpeg `zoompan`. The clips are joined with short fades when `xfade` is available. If `xfade` fails, the runtime falls back to deterministic concat while preserving the shot duration.

Default configuration:

```env
CARTOON_MOTION_ENABLED=true
CARTOON_MOTION_FPS=30
CARTOON_MOTION_WIDTH=1280
CARTOON_MOTION_HEIGHT=720
CARTOON_MOTION_TRANSITION_SECONDS=0.16
```

The 1280×720 default is deliberate for a first production-safe local renderer. It keeps FFmpeg rendering time and disk usage manageable while the visual pipeline is being validated. Resolution can be raised deliberately later.

## Persistence and Resume

Phase 11.5 adds:

- `cartoon_motion_segments`: one persisted rendered segment per shot;
- `cartoon_motion_scenes`: one persisted composition per scene.

A shot fingerprint includes:

- shot fingerprint;
- actual SHA-256 digest of every keyframe image file;
- keyframe ids;
- duration;
- motion profile;
- FPS and resolution.

This means overwriting a keyframe asset during continuity repair invalidates the motion segment even when the asset path itself remains unchanged.

On Resume, a matching ready motion segment and scene composition are reused without running FFmpeg again.

Changing a keyframe plan, keyframe asset, or keyframe status invalidates the affected shot and scene motion records.

## Final scene integration

After all keyframes for a cartoon production are ready, Scene Pipeline v2 calls the Motion Composer. The resulting scene video replaces the compatibility still image as the actual scene asset:

```text
assetType   = video
assetOrigin = generated-motion
provider    = cartoon-motion-v11
model       = ffmpeg-start-middle-end
```

The existing scene-aware rebuild then consumes these video assets, rebuilds narration, captions, and the final video. Documentary/science productions remain on their existing Phase 7/8 path.

## Review Studio

Review Studio receives the persisted motion segment and scene records and shows:

- shot number;
- motion profile;
- duration;
- render status;
- number of ready scene compositions.

The UI explicitly labels this as local FFmpeg motion and not AI optical-flow animation.

## Regression

```bash
npm run test:motion
```

Expected:

```text
Phase 11.5 Motion Composer OK: 36 regression checks passed.
```

The regression suite uses an injected fake FFmpeg runner for deterministic unit coverage of rendering, persistence, invalidation, Resume, missing keyframes, continuity failures, and FFmpeg-unavailable behavior. Windows materialization still performs syntax checks and the real production test is required before declaring runtime completion.

## Completion boundary

Phase 11.5 is complete only after:

1. Windows materialization passes Phase 11.5 and all earlier regressions;
2. a real cartoon production creates persisted motion segments for every shot;
3. every scene receives a real local MP4 motion composition;
4. final scene rebuild uses those videos instead of the old still-image slideshow;
5. Resume reuses unchanged segments;
6. a repaired keyframe invalidates and rebuilds only the affected motion path.

Phase 11.6 will add the final cartoon-specific Quality Gate and end-to-end integration criteria.
