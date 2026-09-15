# Phase 11.3 — Cartoon Keyframe Pipeline

Phase 11.3 is the first Phase 11 step that creates multiple persistent visual assets for one cartoon shot.

The default contract is:

```text
scene
  -> 3-6 shots (Phase 11.2)
      -> start keyframe
      -> middle keyframe
      -> end keyframe
```

This is **not** 24-FPS AI frame generation. It is a controlled three-keyframe storyboard/animation pipeline. Phase 11.5 Motion Composer will turn these keyframes into moving shot segments.

## Runtime contract

For every persisted Phase 11.2 shot, Phase 11.3 creates exactly three deterministic planned keyframes:

- `start` — establishes pose, staging, screen direction, props and scene geography;
- `middle` — shows the clearest midpoint of the action;
- `end` — completes the action/reaction and leaves a clean handoff pose.

Every keyframe has a stable id, role, progress value, prompt, keyframe fingerprint, plan fingerprint, continuity reference id, status, asset path, provider metadata and error state.

## Persistence

SQLite adds `shot_keyframes`.

The production bundle exposes `keyframes` alongside `scenes`, `shots` and `cartoonBible`.

The scene manifest records:

- `keyframePipelineVersion`;
- `keyframePlanFingerprint`;
- `keyframesPerShot`;
- total `keyframeCount`;
- keyframe summary.

Generated files are copied to deterministic paths below:

```text
data/assets/keyframes/<production>/<scene>/<shot>/<index>_<role>.<ext>
```

This avoids relying on timestamp filenames returned by image-generation fallbacks.

## Resume behavior

Keyframes are generated sequentially.

If `start` and `middle` are already `ready` and `end` fails, Resume keeps the two valid files and retries only the missing/failed frame. An unchanged keyframe plan does not discard ready assets.

If the Phase 11.2 shot plan changes, stale keyframes for that scene are deleted before the new shot plan is persisted.

## Scene compatibility

Existing production/rebuild code still expects one `assetPath` on each scene. Phase 11.3 therefore assigns the first shot's `middle` keyframe as the scene's compatibility/representative image after all keyframes for that scene are ready.

This does **not** mean the final video already uses only that image. `assets.video.keyframeAssets` separately records every generated keyframe so Phase 11.5 can compose them into motion.

## No duplicate scene-level generation

When `kids_cartoon_2d` is active and keyframe generation is enabled, the normal one-image cartoon generation path is replaced by `CartoonKeyframePipelineV11.generateScene()`. The Phase 8 documentary real-source router remains bypassed for original cartoon frames.

## Continuity boundary

Phase 11.3 persists a reference chain:

```text
shot 1 start
 -> shot 1 middle
 -> shot 1 end
 -> shot 2 start
 -> shot 2 middle
 -> shot 2 end
```

The reference id and already-generated reference asset path are persisted. The existing image-provider interface is still text-prompt based, so Phase 11.3 does **not** claim provider-level image conditioning or automatic visual similarity validation.

That stronger behavior belongs to **Phase 11.4 — Continuity Engine**.

## Cost/runaway protection

```env
CARTOON_KEYFRAME_GENERATION_ENABLED=true
CARTOON_KEYFRAME_MAX_PER_PRODUCTION=180
```

The production fails closed with `CARTOON_KEYFRAME_LIMIT_EXCEEDED` if the planned number of keyframes exceeds the configured cap. This prevents an accidental scene/shot explosion from silently creating hundreds of image requests.

The image provider/fallback behavior itself remains the configured `AIVideoGenerator` behavior; Phase 11.3 does not bypass provider quota, credential or budget controls.

## Review Studio

Review Studio shows a `Start -> Middle -> End` keyframe panel with per-frame `planned`, `generating`, `ready` or `failed` state.

## Regression commands

After materialization:

```bash
npm run test:shot-planner
npm run test:keyframes
```

The deterministic materializer reaches Phase 11.3 through the Phase 11.2 regression chain. `test:keyframes` can then be run independently.

## Completion boundary

Phase 11.3 is complete only after Windows materialization verifies the regressions and a real cartoon production demonstrates:

1. three persisted keyframes per shot;
2. deterministic asset paths;
3. granular Resume without regenerating ready frames;
4. no extra scene-level cartoon image request;
5. the keyframe panel visible in Review Studio.

Phase 11.3 does not yet claim final animation quality. Phase 11.4 validates continuity and Phase 11.5 composes the keyframes into motion.
