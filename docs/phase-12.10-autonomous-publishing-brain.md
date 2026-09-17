# Phase 12.10 — Autonomous Publishing Brain

Phase 12.10 governs publication timing after the Phase 12.9 Autonomous Quality Council.

## Guarantees

- default cadence: one regular publication every 120 minutes;
- scheduling fails closed unless the latest post-production Quality Council verdict is `PASS`;
- reservations are persisted and collision-free;
- regular stories are placed into deterministic UTC cadence slots;
- breaking coverage may preempt the next regular slot, but the displaced regular item is moved to a later free slot instead of colliding;
- overdue backlog is never flushed in bulk;
- subsequent scheduler polls remain blocked until the regular cadence window has elapsed;
- publication outcomes are written to an auditable decision ledger.

## Breaking override

A story is treated as breaking when it is explicitly marked `BREAKING`, reaches the configured breaking priority, or reaches the configured global-importance threshold. Breaking override is a scheduling privilege only; it does not bypass Evidence / Truth, Quality Council, provenance, media-rights or YouTube-readiness gates.

## Persistence

- `newsroom_publishing_reservations`
- `newsroom_publishing_decisions`

## Protected APIs

- `GET /api/newsroom/publishing-brain/status`
- `GET /api/newsroom/publishing-brain/decisions`

## Configuration

- `NEWSROOM_PUBLISHING_BRAIN_ENABLED=true`
- `NEWSROOM_PUBLISH_CADENCE_MINUTES=120`
- `NEWSROOM_PUBLISH_REQUIRE_QUALITY_PASS=true`
- `NEWSROOM_PUBLISH_BREAKING_PRIORITY=90`
- `NEWSROOM_PUBLISH_BREAKING_IMPORTANCE=85`

Regression command:

```bash
npm run test:autonomous-publishing-brain
```
