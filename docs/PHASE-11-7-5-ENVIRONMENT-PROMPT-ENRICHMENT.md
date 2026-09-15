# Phase 11.7.5 — Environment + Prop Prompt Enrichment

Phase 11.7.5 makes the persistent environment work from 11.7.1–11.7.4 affect actual cartoon image generation.

## Pipeline

```text
Environment Bible 11.7.1
  -> Prop Locks 11.7.2
  -> Master Environment 11.7.3
  -> Scene-to-Environment Mapping 11.7.4
  -> Environment Prompt Enrichment 11.7.5
  -> Shot prompt
  -> start/middle/end keyframes
  -> Continuity Engine
```

## Shot prompt contract

Every mapped cartoon shot receives an `ENVIRONMENT CONTINUITY V11.7.5` block containing:

- persistent `environmentId`;
- zone/subarea such as `living_room` or `kitchen`;
- Environment Bible architecture, materials, palette, lighting and layout;
- required Prop Locks and their evidence-backed attributes;
- optional Prop Locks separately;
- canonical Master Environment SHA-256 when one exists;
- explicit no-redesign/no-random-furniture continuity rules.

The original Character Bible and Shot Planner prompt remains intact.

## Resume safety

The Phase 11.2 `planFingerprint` is deliberately preserved. Environment enrichment changes the shot visual fingerprint and prompt, but not the structural planner fingerprint. This avoids rebuilding every shot on every Resume.

If the enriched visual fingerprint actually changes, `replaceSceneShots()` invalidates stale keyframes as intended. Identical enrichment is reused.

## Master Environment conditioning

For the first `start` keyframe of a scene, when Scene-to-Environment Mapping points to a canonical Master Environment whose file exists, that `master.png` becomes the real `referenceAssetPath` passed to reference-conditioned image generation.

Later keyframes continue using the normal keyframe-to-keyframe reference chain.

The Continuity Engine no longer auto-accepts a first keyframe as an anchor when an external Master Environment reference is present; it evaluates the generated frame against that master reference.

## Fail-closed behavior

If a scene is unresolved, the prompt explicitly says the environment is unresolved and forbids inventing a new persistent location identity. No fake `environmentId` or master path is created.

If the image provider cannot use reference conditioning, existing truthful provider telemetry and continuity validation rules remain authoritative. A generic local image does not become a canonical Master Environment.

## Persistence

`shot_environment_contexts` records the exact environment context used for each shot, including:

- context fingerprint;
- environment and zone;
- mapping fingerprint;
- master path/canonical flag/SHA-256;
- required Prop Lock IDs;
- persisted prompt fragment.

The production bundle exposes `shotEnvironmentContexts`, and Review Studio renders `ENVIRONMENT PROMPT ENRICHMENT V11.7.5`.

## Configuration

```env
ENVIRONMENT_PROMPT_ENRICHMENT_ENABLED=true
```

## Regression command

```bash
npm run test:environment-prompts
```

This phase does not claim semantic object detection. Pixel/semantic validation that the generated frame truly contains the expected layout and locked props belongs to Phase 11.7.6 Environment Continuity Validation.
