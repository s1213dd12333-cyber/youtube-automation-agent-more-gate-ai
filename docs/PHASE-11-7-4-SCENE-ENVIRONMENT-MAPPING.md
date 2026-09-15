# Phase 11.7.4 — Scene-to-Environment Mapping

Phase 11.7.4 binds each finalized production scene to a persistent Environment Bible identity instead of allowing every scene to invent a new location.

## Contract

Input:

- production scenes;
- Environment Bible v11.7.1;
- canonical Master Environment records from v11.7.3 when available.

Output:

- one persisted `scene_environments` record per scene;
- `environmentId` when evidence is sufficient;
- optional zone such as `living_room`, `kitchen`, `bedroom`, `garden`, or `play_area`;
- confidence and mapping reason;
- master-frame path only when the selected environment has a ready canonical master;
- deterministic mapping and plan fingerprints.

## Fail-closed ambiguity

The mapper never creates a new Environment ID to fill a gap.

If multiple environments exist and a scene does not provide enough evidence to choose one, the record remains:

```text
status = unresolved
environmentId = null
masterFramePath = null
```

If the production defines only one environment, an otherwise ambiguous scene may conservatively reuse that environment with moderate confidence and the explicit reason `single_environment_reuse`.

Adjacent scenes may reuse the previous mapped environment when no transition signal exists and the current scene contains no competing environment evidence. Explicit continuation phrases such as `same`, `continues`, `mesmo`, or `continua` strengthen that reuse.

## Example

```text
Scene 1 — living room
  -> env_house_01 / living_room

Scene 2 — kitchen
  -> env_house_01 / kitchen

Scene 3 — garden
  -> env_garden_01 / garden
```

The house is one persistent environment even though different scenes use different zones.

## Persistence

Table: `scene_environments`

Important fields:

- `production_id`
- `scene_id`
- `plan_fingerprint`
- `fingerprint`
- `environment_id`
- `environment_fingerprint`
- `zone_name`
- `status`
- `confidence`
- `reason`
- `matched_terms`
- `master_frame_path`
- `master_canonical`

The production bundle exposes these records as `sceneEnvironments`.

## Environment variables

```env
SCENE_ENVIRONMENT_MAPPING_ENABLED=true
SCENE_ENVIRONMENT_MIN_SCORE=0.18
```

## Scope boundary

Phase 11.7.4 establishes **which persistent location a scene belongs to**. It does not yet inject the Environment Bible, Prop Locks, or master image into every shot/keyframe prompt. That prompt-level binding belongs to Phase 11.7.5.

Object-level visual verification of layout and locked props remains Phase 11.7.6.

## Regression

```powershell
npm run test:scene-environments
```

The verifier covers zone detection, deterministic fingerprints, house reuse across living-room/kitchen scenes, environment transitions, adjacent-scene continuity, single-environment fallback, fail-closed ambiguity, master-frame association, persistence, pipeline wiring, Review Studio rendering, and environment settings.
