# Phase 11.7.3 — Master Environment Generator

Phase 11.7.3 turns each Environment Bible entry into a persistent canonical visual reference that future shots can reuse.

## Goal

A request such as:

```text
Environment: a furnished wooden house with a beige sofa,
rustic wooden coffee table, bookshelf and large window.
```

now has three persistent layers:

```text
Environment Bible 11.7.1
→ Prop Locks 11.7.2
→ Master Environment Frame 11.7.3
```

The master frame is not a story shot. It is a wide canonical reference whose job is to establish the location identity once so later phases can reproduce the same place from new camera angles.

## Generation contract

The master prompt includes:

- Environment ID;
- architecture/construction;
- materials;
- palette;
- lighting;
- layout identity;
- signature elements;
- required source-backed Prop Locks;
- optional/inferred Prop Locks;
- explicit instruction to avoid characters, text, logos and unrelated clutter;
- a 16:9 wide establishing composition.

Required Prop Locks are requested visibly in the canonical composition so the frame can become a stable reference for later shot generation.

## Fail-closed canonical status

By default:

```env
MASTER_ENVIRONMENT_REQUIRE_PROVIDER=true
```

When the active image provider falls back to the existing generic local renderer, the generated candidate remains auditable but is **not** accepted as the canonical master frame.

The persisted state is:

```text
status = fallback_unanchored
canonical = false
masterFramePath = null
candidatePath = <fallback asset>
```

This prevents a generic gradient/local placeholder from becoming the reference that every later shot reproduces.

When a provider-generated image succeeds, the canonical file is normalized to PNG and stored under:

```text
data/assets/environments/<production>/<environment>/master.png
```

with SHA-256 and image dimensions persisted.

## Persistence

Table: `environment_master_frames`

Important fields:

- `production_id`
- `environment_id`
- `environment_fingerprint`
- `prompt_fingerprint`
- `prompt`
- `status`
- `canonical`
- `master_frame_path`
- `candidate_path`
- `provider`
- `source_kind`
- `asset_sha256`
- `width`
- `height`
- `error`
- `generated_at`

The production bundle exposes the latest frame for each Environment ID as:

```text
environmentMasterFrames
```

## Prop Lock relationship

When a canonical master frame is ready, Prop Locks receive:

```text
placementStatus = master_reference_ready_unverified
masterFramePath = <canonical master frame>
```

This wording is deliberate. Phase 11.7.3 establishes a visual reference, but it does not yet run object detection or prove that every prop is visible exactly where requested. Object-level visual continuity validation remains a later phase.

## Resume

The prompt fingerprint depends on:

- Environment fingerprint;
- Prop Lock fingerprints;
- required/optional lock state;
- master prompt contract.

If an existing canonical frame has the same prompt fingerprint and the file still exists, Resume reuses it instead of regenerating it.

## Environment variables

```env
MASTER_ENVIRONMENT_GENERATION_ENABLED=true
MASTER_ENVIRONMENT_REQUIRE_PROVIDER=true
```

Set `MASTER_ENVIRONMENT_REQUIRE_PROVIDER=false` only as an explicit diagnostic/quality tradeoff. With the default `true`, generic local fallback never becomes canonical.

## Regression

```powershell
npm run test:master-environment
```

The verifier covers deterministic prompting/fingerprints, required Prop Locks, canonical provider generation, SHA-256 evidence, Resume reuse, local fallback rejection, persistence wiring, production-bundle exposure, pipeline integration and Review Studio status rendering.

## Next phase

Phase 11.7.4 will map each scene to an Environment ID/zone so the correct canonical location can be selected deterministically before Phase 11.7.5 injects Environment Bible + Prop Locks + master reference into shot/keyframe prompts.
