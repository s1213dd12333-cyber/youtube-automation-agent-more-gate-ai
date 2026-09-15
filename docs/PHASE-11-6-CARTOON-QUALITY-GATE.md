# Phase 11.6 — Cartoon Quality Gate

Phase 11.6 closes the Phase 11 cartoon pipeline with a deterministic, fail-closed quality layer integrated into the existing Phase 9 Visual Quality Agent and approval flow.

## Scope

The gate is active only when the persisted Cartoon Bible mode is `kids_cartoon_2d`. Documentary and other non-cartoon productions continue through the existing Phase 7–10 quality and publication rules without cartoon-specific blockers.

The gate validates the complete Phase 11 chain:

- Phase 11.1 Character/Style Bible exists and has persisted characters;
- Phase 11.2 each scene has the configured shot range, normally 3–6;
- shot prompts contain concrete action, characters, camera and continuity fields;
- Phase 11.3 every shot has exactly `start / middle / end` keyframes;
- every required keyframe is ready and present on disk;
- Phase 11.4 continuity decisions exist for referenced frames and are accepted above their persisted threshold;
- average continuity and composition-continuity scores are reported;
- Phase 11.5 has one ready motion segment per shot and one ready motion composition per scene;
- the active scene asset is the generated-motion video, not the old single-image/slideshow compatibility path;
- shot and scene motion durations remain aligned with the persisted plan;
- exact byte-identical keyframes are detected to prevent fake motion made from repeated still images;
- excessive exact-frame repetition across the production is blocked;
- high Visual Director generic-AI risk is blocked for cartoon mode;
- a conservative lexical child-directed safety screen flags high-risk terms for manual review.

## No sixth Phase 9 weight

Phase 9 remains exactly five weighted agents:

- Retention 25%
- Thumbnail 15%
- SEO 15%
- Visual 20%
- Fact 25%

Phase 11.6 is merged into the existing Visual Quality Agent. Cartoon blockers therefore make `quality_visual` fail and also make the persisted Phase 9 report `blocked`, preserving the Phase 10 approval/publication contract without changing the established weights.

A dedicated `cartoon_quality_reports` table stores the Phase 11.6 report separately for Review Studio and auditability.

## Byte-sensitive fingerprints

The Phase 11.6 fingerprint includes SHA-256 digests of the actual keyframe bytes. If a provider or repair pass replaces an image while keeping the same file path, the cartoon quality fingerprint changes and the next quality review cannot silently reuse the old report.

The Phase 9 fingerprint also incorporates the Phase 11.6 fingerprint so approval review is sensitive to keyframe-byte changes, continuity changes and motion changes.

## Repetition rules

Within one shot:

- three byte-identical keyframes: blocking `cartoon_static_shot`;
- two byte-identical keyframes: warning `cartoon_partial_static_shot`.

Across the production:

- exact duplicate ratio above 20%: blocking `cartoon_repetition_risk`;
- exact duplicate ratio above 8%: warning `cartoon_repetition_advisory`.

These are exact-byte checks, not semantic similarity claims.

## Child-safety boundary

The built-in lexical check is intentionally conservative. It can block a child-directed cartoon when high-risk terms such as explicit weapons, gore, sexual content or hard drugs appear in positive story beats.

This is **not** a semantic child-safety classifier and does not replace human review. It is an additional deterministic gate.

## Persistence

Phase 11.6 adds:

```text
cartoon_quality_reports
```

Each report records:

- version;
- production id;
- byte-sensitive fingerprint;
- status;
- score;
- metrics;
- findings;
- blockers;
- creation time.

Review Studio displays the latest persisted report or the report embedded in the latest Phase 9 quality review.

## Regression

```bash
npm run test:cartoon-quality
```

Expected:

```text
Phase 11.6 Cartoon Quality Gate OK: 31 regression checks passed.
```

The regression is deterministic and does not call image, TTS, video or paid AI providers.

## Phase 11 completion boundary

Phase 11 is structurally complete only when Windows materialization passes 11.1 through 11.6 and a real cartoon production demonstrates:

```text
Character Bible
→ 3–6 shots per scene
→ start/middle/end keyframes
→ accepted continuity checks
→ ready local motion segments
→ ready motion scene videos
→ Phase 11.6 report not blocked
→ human review before approval/publication
```

A passing structural gate does not by itself prove that the resulting cartoon is artistically excellent or semantically safe for every child audience. Human review remains required before publication.
