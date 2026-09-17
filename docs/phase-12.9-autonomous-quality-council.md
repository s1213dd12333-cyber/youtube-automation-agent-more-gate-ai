# Phase 12.9 — Autonomous Quality Council

Phase 12.9 adds a fail-closed, multi-reviewer quality council at two points in the newsroom pipeline.

## Pre-production council

Before an autonomous newsroom decision can be promoted into the production backlog, the council independently checks:

- truth integrity — Phase 12.7 must still be `VERIFIED`;
- fact locks — every confirmed claim must remain locked in the Phase 12.8 directive;
- attribution — source-bound claims keep their required provenance;
- visual truth — generated visuals cannot depict an unverified allegation as observed fact;
- production feasibility — duration, scene count, status and budget remain bounded;
- editorial safety — the mandatory no-invention/no-upgrade/no-attribution-removal constraints remain intact.

Only `PASS` may auto-promote. `REPAIR` holds the story for repair. `BLOCK` prevents promotion.

## Post-production council

After the real video is assembled, the council runs again before automatic scheduling and again at explicit approval. It independently checks:

- built-in factual/quality blockers;
- Research & Provenance status;
- script and metadata readiness;
- real MP4, thumbnail and scene integrity;
- uploaded-media rights confirmation;
- narration and publishing readiness.

The existing operator quality checks remain mandatory. Phase 12.9 is an additional gate, not a replacement.

## Verdicts

- `PASS` — all blocking reviewers pass and the aggregate score meets policy.
- `REPAIR` — the defect is repairable, such as missing packaging or attribution.
- `BLOCK` — factual integrity, provenance, media-rights, simulated-video, or another non-negotiable gate failed.

## Auditability

Every review is deterministic for the same snapshot and stored with:

- phase (`pre_production` or `post_production`);
- per-reviewer verdict, score, findings and evidence;
- aggregate score and verdict;
- immutable review fingerprint;
- production/directive/claim-packet references when available;
- eventual newsroom assignment linkage.

Policy changes are append-only and require an audit reason.

## API

Protected endpoints:

- `GET /api/newsroom/quality-council/status`
- `GET /api/newsroom/quality-council/reviews`
- `GET /api/newsroom/quality-council/reviews/:reviewId`
- `GET /api/newsroom/quality-council/policy`
- `POST /api/newsroom/quality-council/policy`

## Regression command

```bash
npm run test:autonomous-quality-council
```
