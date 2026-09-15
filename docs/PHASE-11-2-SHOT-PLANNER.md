# Phase 11.2 — Cartoon Shot Planner

Phase 11.2 changes the cartoon planning contract from `1 scene = 1 visual idea` to `1 scene = 3–6 persistent shots` by default.

It is deliberately a planning phase. It does **not** claim frame-by-frame generation yet. Multi-keyframe asset generation begins in Phase 11.3.

## Runtime contract

The Shot Planner runs only when Phase 11.1 has an active `kids_cartoon_2d` Character Bible + Style Bible for the current production.

For each cartoon scene it produces deterministic shot records containing:

- stable shot id;
- scene id and shot index;
- shot type (`wide`, `medium`, `close_up`, `reaction`, `action`, `ending`);
- duration allocation;
- storytelling goal;
- concrete story beat;
- visible action;
- Character Bible references;
- expression direction;
- background continuity direction;
- camera/framing direction;
- continuity notes;
- a full shot-specific prompt;
- scene-plan and shot fingerprints;
- persisted `planned` status.

The default range is:

```env
CARTOON_SHOTS_PER_SCENE_MIN=3
CARTOON_SHOTS_PER_SCENE_MAX=6
```

A long scene is capped at six shots by default. Short scenes still receive at least three shots so the visual language does not collapse back into one static image.

## Determinism and Resume

Shot plans are deterministic for the same:

- scene narration;
- scene duration;
- Character Bible fingerprint;
- configured min/max shot count.

Each scene has a `planFingerprint`. Resume reuses the persisted plan when the fingerprint and shot count still match. If the script, visual identity, duration, or shot configuration changes, only that scene's shot plan is replaced.

## Persistence

Phase 11.2 adds `scene_shots` to SQLite. The production bundle exposes the flat `shots` array so Review Studio, Phase 11.3 Keyframes, quality gates, and observability can use the same persisted plan.

The scene manifest records:

- `shotPlannerVersion`;
- `shotPlanFingerprint`;
- total `shotCount`;
- `shotsPerScene` summary.

## Review Studio

Review Studio renders the Character Bible followed by a `Scene → Shots` panel. Each scene shows its ordered shots with framing, goal, story beat, and camera direction.

This is intentionally visible before keyframe generation so an operator can inspect whether the story has enough visual changes and whether the shot plan is still too repetitive.

## Phase 11.1 hardening included

Phase 11.2 also hardens two Phase 11.1 runtime boundaries:

- a historical Cartoon Bible no longer keeps cartoon mode active after current instructions stop matching cartoon content or the feature is disabled;
- `persistManifest()` receives the active Cartoon Bible explicitly rather than relying on out-of-scope runtime state.

## Regression command

```bash
npm run test:shot-planner
```

Expected result:

```text
Phase 11.2 Shot Planner OK: 45 regression checks passed.
```

## Completion boundary

Phase 11.2 is complete when:

1. Windows materialization passes all earlier phases plus the Phase 11.1 and 11.2 regressions;
2. a real children's production persists 3–6 shots for every scene by default;
3. Resume reuses an unchanged shot plan;
4. Review Studio displays the shot plan;
5. documentary/science productions remain on the Phase 7/8 documentary path.

Phase 11.2 does **not** generate several images per shot. Phase 11.3 will introduce persistent `start / middle / end` keyframes and make the image-generation path consume the shot plan.
