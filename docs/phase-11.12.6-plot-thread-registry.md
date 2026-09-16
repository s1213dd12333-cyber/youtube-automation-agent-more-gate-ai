# Phase 11.12.6 — Plot Thread Registry

Phase 11.12.6 adds an explicit, persistent lifecycle registry for serialized narrative threads. It is downstream of Series Bible, Canonical Timeline, Episode Memory, Character Arc Memory and Relationship State Graph.

## Ownership boundary

Episode Memory records what an approved episode established. Plot Thread Registry records which narrative obligations remain active across episodes and how their lifecycle changes.

A plot thread is never inferred from thematic similarity, shared scenes or fuzzy title matching. Every thread has an explicit `threadKey` unique inside one series.

## Lifecycle

Supported canonical states:

- `open` — active unresolved thread;
- `dormant` — intentionally inactive for now, but still unresolved;
- `resolved` — terminal thread with an explicit resolution summary;
- `cancelled` — terminal intentional closure with an explicit closure/resolution summary.

Ordinary episode commits cannot mutate a `resolved` or `cancelled` thread. Corrections require an explicit audited amendment of the latest thread state.

## Persisted current state

`serialized_plot_threads` stores:

- explicit thread identity and title;
- type and priority;
- premise, central question, stakes and current state;
- open and resolved questions;
- narrative promises;
- established clues and red herrings;
- required payoffs;
- same-series Character Arc references;
- exact directed Relationship State Graph edge references;
- resolution summary;
- introduced, last-advanced and resolved episode coordinates;
- revision number and lifecycle status.

`serialized_plot_thread_revisions` stores immutable snapshots for every revision.

`serialized_plot_thread_episode_commits` stores the Episode Memory that authorized the mutation, Timeline references, before/after snapshots, change summary, reason and actor.

## Canon mutation rules

Registry mutation requires a finalized Episode Memory for the same series and episode. Timeline references in a thread commit must be a subset of that Episode Memory's committed Timeline events.

Character references must resolve to Character Arc records in the same series and cannot refer to a character whose first episode is later than the thread commit episode.

Relationship references use exact directional keys such as `mara->ivo`. The referenced directed relationship must already exist in the same series and must have been established by the commit episode.

Historical insertion requires explicit `allowBackfill: true`. A backfill cannot rewrite a thread that already has a later commit.

Updates use optimistic revision checks and SQLite `BEGIN IMMEDIATE` transactions. Multi-thread episode commits are atomic.

## Script Writer contract

Only `open` and `dormant` threads are injected into Script Writer context. Resolved and cancelled threads remain audit history and are not treated as outstanding obligations.

The prompt explicitly states that script generation is read-only: it may propose narrative beats, but cannot create, advance, pause, resolve or cancel registry state.

Environment controls:

- `SERIALIZED_PLOT_THREAD_REGISTRY_ENABLED=true`
- `SERIALIZED_PLOT_THREAD_PROMPT_LIMIT=40`

## Protected API

- `GET /api/series-bibles/:seriesId/plot-threads`
- `GET /api/series-bibles/:seriesId/plot-threads/:threadKey`
- `POST /api/series-bibles/:seriesId/episodes/:episodeNumber/plot-threads/commit`
- `PATCH /api/series-bibles/:seriesId/episodes/:episodeNumber/plot-threads/:threadKey`
- `GET /api/series-bibles/:seriesId/plot-threads/:threadKey/revisions`
- `GET /api/series-bibles/:seriesId/plot-threads/:threadKey/commits`
- `POST /api/series-bibles/:seriesId/plot-threads/validate`

## Regression gate

`npm run test:plot-thread-registry`

The gate checks schema/materialization, Episode Memory gating, Timeline subset validation, same-series character and directed relationship references, explicit historical backfill, atomic multi-thread commits, terminal lifecycle behavior, latest-only amendment, prompt filtering, cross-series isolation and current-state drift detection.
