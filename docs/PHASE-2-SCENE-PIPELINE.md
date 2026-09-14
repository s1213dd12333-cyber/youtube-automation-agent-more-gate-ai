# FASE 2 — Scene-first Production Pipeline

## Objective

Make scenes the persistent unit of production instead of creating a monolithic video first and deriving editable scenes afterward.

## Canonical flow

```text
Script Contract v1
  -> Scene plan
  -> persist scene ids/status
  -> scene visual
  -> scene narration
  -> next scene
  -> scene-aware captions/audio mix
  -> final rebuild
```

Each generation job now uses a stable production id (`prod_<job id>`). A failed production retry therefore reopens the same production and the same scene rows instead of starting a new media production from zero.

## Scene states

The pipeline persists progress in the existing `production_scenes` store. Runtime states include:

- `planned`
- `generating_visual`
- `visual_ready`
- `visual_failed`
- `generating_narration`
- `narration_failed`
- `ready`
- existing repair states such as `visual_stale` and `needs_rebuild`

Narration also keeps its independent status (`pending`, `generating`, `current`, `failed`, `intentional_silence`).

## Granular resume

A scene is not regenerated when its corresponding artifact is already usable on disk.

Example:

```text
scene 1 visual ✓ narration ✓
scene 2 visual ✓ narration ✓
scene 3 visual ✓ narration ✗
```

On Resume:

```text
scene 1 reused
scene 2 reused
scene 3 visual reused
scene 3 narration retried
```

Only when every scene has a usable visual and narration (or explicit intentional silence) does the final scene-aware rebuild execute.

## Script changes

The scene manifest stores a SHA-256 fingerprint of the normalized script. If the script contract changes, the old scene plan is invalidated and a fresh plan is generated under the same stable production id. Stale final audio/video/caption references are cleared before the new scene production begins.

## Existing repair tooling

`SceneRepairService` remains the editor/repair layer. Phase 2 does not create a competing scene database. It uses the same `production_scenes`, scene revisions, rights/provenance fields, narration evidence, and final rebuild path already used by Review Studio.

## Validation

After materialization:

```powershell
cd upstream
npm run test:scenes
```

Expected result:

```text
Phase 2 scene pipeline OK: 12 regression checks passed.
```

The regression checks include a forced narration failure in scene 2, persistence of the failure, stable scene ids, reuse of completed scene media, retry of only the failed narration, final rebuild after readiness, and automatic replan after a script change.
