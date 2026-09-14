# FASE 6 — Per-video Instructions

Status: implemented in the overlay; Windows runtime validation is still required.

## Goal

Add one persistent `Instructions` field to each generation job and carry it through the full content lifecycle without allowing it to weaken factual, evidence, media-rights, platform, approval, or publishing guardrails.

## Flow

```text
New Generation Job
  topic
  format
  length
  instructions
      ↓
request validation
      ↓
generation job details
      ↓
strategy + instruction envelope
      ↓
Research Agent
      ↓
Script Writer + Evidence Desk
      ↓
Thumbnail / SEO / Scene prompts
      ↓
Production
      ↓
Review Studio
      ↓
Resume keeps the same instructions
```

## Limits

- Optional.
- Must be a string.
- Maximum 4000 characters.
- CRLF is normalized to LF.
- NUL characters are removed.
- Instructions are hashed into an instruction envelope for audit/debugging.

## Priority

Instructions are content preferences, not policy overrides.

They never override:

- retrieved evidence and Evidence Desk decisions;
- factual-safety rules;
- media rights and provenance requirements;
- provider/platform constraints;
- approval requirements;
- publishing gates.

Prompts explicitly delimit the operator text with `<video_instructions>` and state the policy boundary.

## Research

The Research Agent stores the instruction envelope in the evidence pack. A narrow supplemental search focus is extracted only from explicit positive directives such as:

```text
Focus on NIST atomic clocks and GPS corrections.
Emphasize NASA mission telemetry.
Include official NOAA datasets.
```

Negative/general directives such as `avoid speculation` are not blindly appended to search queries.

Instructions are never treated as evidence text or a factual source.

## Script

The Script Writer receives the instruction block before the evidence packet. If a video has non-empty instructions and AI script generation fails, the pipeline refuses the generic template fallback with:

```text
VIDEO_INSTRUCTIONS_UNAPPLIED
```

This prevents a job from appearing to honor instructions when they were actually ignored.

The Evidence Desk remains authoritative for factual claims.

## SEO

AI SEO receives the same instruction block. The generated script/strategy already carries the instructions, so metadata generation sees the same per-video direction.

## Visuals

Thumbnail concepts retain the video instruction text. Scene prompts receive a visual instruction suffix with an explicit guardrail boundary.

This phase propagates visual direction; the later Visual Director / Visual Router phases remain responsible for advanced scene-specific visual planning and source routing.

## Persistence and Resume

The normalized instruction text is stored in `generation_jobs.details.videoInstructions` with `instructionVersion: 6`.

Resume restores the same instructions before re-entering generation, so a failed job cannot silently resume with different direction.

## Dashboard

The New Generation Job dialog now includes:

```text
Instructions — optional, applies only to this video
```

The Review Studio displays the saved per-video direction so the operator can compare the finished production against the original request.

## Test

```powershell
npm run test:instructions
```

The regression suite makes no paid API calls.
