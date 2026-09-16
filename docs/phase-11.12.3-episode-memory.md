# Phase 11.12.3 — Serialized Narrative Memory: Episode Memory / Episode Ledger

Phase 11.12.3 adds the post-approval per-episode memory layer on top of the validated Series Bible (11.12.1) and Canonical Timeline (11.12.2).

The Series Bible answers **what is globally true about the series**. The Canonical Timeline answers **what happened and in what story-world order**. Episode Memory answers **what the approved episode established for future writing**: its summary, discoveries, facts, resolved/unresolved questions, promises, cliffhangers and the exact canonical timeline events attributed to that episode.

## Core rule: memory is post-approval only

Script generation never writes Episode Memory.

An episode can enter the ledger only through explicit finalization with:

- `approved: true`;
- stable `approvalId`;
- non-empty `approvedBy`;
- meaningful `approvalReason`;
- `approvedAt`;
- current Series Bible revision;
- exact next episode number.

Rejected drafts, failed generations, previews and unapproved scripts do not mutate narrative memory.

## Persistence

Three SQLite tables are materialized:

- `serialized_episode_memories` — current finalized ledger record for each episode;
- `serialized_episode_memory_revisions` — immutable finalize/amendment snapshots;
- `serialized_episode_memory_commits` — audited finalization/amendment commits.

There is exactly one current ledger row per `(series_id, episode_number)`.

## Episode Memory schema

A finalized episode may persist:

- series and episode identity;
- optional strategy and production identity;
- title and canonical episode summary;
- discoveries;
- established facts;
- resolved questions;
- unresolved questions;
- narrative promises;
- cliffhangers;
- exact `timelineEventIds` belonging to the episode;
- approval identity, actor, reason and timestamp;
- deterministic source fingerprint;
- revision number and audit timestamps.

## Exact Timeline linkage

Finalization compares `timelineEventIds` with every active Canonical Timeline event whose:

- `series_id` matches the series; and
- `episode_number` matches the episode being finalized.

The sets must match exactly.

This prevents an Episode Ledger from:

- omitting an event already committed to canon;
- claiming an event from another episode;
- claiming an event from another series;
- silently diverging from the Canonical Timeline.

The same exact-set rule is rechecked inside the SQLite transaction.

## Sequential finalization

The only normal finalization target is:

`episodeNumber === SeriesBible.currentEpisode + 1`

Episode gaps and rewinds fail closed.

Once Episode Memory is materialized, the legacy `SerializedSeriesBibleServiceV12.advanceEpisode()` path refuses normal advancement with `episode_memory_finalize_required`. Episode advancement is owned by the Episode Memory finalization transaction.

## Atomic finalization transaction

`finalizeSerializedEpisodeMemoryAtomic()` uses `BEGIN IMMEDIATE` and performs one all-or-nothing operation:

1. re-read and validate the active Series Bible;
2. verify the expected Bible revision;
3. verify the episode is exactly next;
4. verify no ledger already exists;
5. verify the exact Timeline event set;
6. insert the Episode Memory;
7. insert its immutable revision snapshot;
8. advance `SeriesBible.currentEpisode`;
9. increment the Series Bible revision without changing `canonVersion`;
10. write a Series Bible `episode_finalize` revision snapshot;
11. write the Episode Memory commit audit;
12. commit.

Any failure rolls the whole transaction back.

This prevents states such as "Bible advanced but episode memory missing" or "ledger written but timeline linkage invalid".

## Strategy binding

If a finalized memory includes `strategyId`, the service verifies that the persisted 11.12.1 strategy binding points to the same:

- series; and
- episode number.

A mismatched or missing explicit binding fails closed.

## Append-only ledger / amendments

Finalized Episode Memory is append-only by default.

A correction requires:

- `allowAmendment: true`;
- a meaningful amendment reason;
- the current Episode Memory revision;
- an exact current Timeline event set.

A successful amendment increments the memory revision and creates a new immutable revision snapshot and audit commit.

Amendments do **not** advance the Series Bible.

The original approval identity remains attached to the finalized record; an amendment is separately audited by actor/reason rather than silently replacing the original approval.

## Drift validation

`validateSeries(seriesId)` verifies:

- every episode from 1 through `SeriesBible.currentEpisode` has a finalized ledger;
- each ledger's `timelineEventIds` still exactly matches the active Canonical Timeline events for that episode.

If a later Timeline retcon creates drift, Episode Memory becomes invalid until explicitly reconciled. Script Writer context then fails closed instead of consuming inconsistent history.

## Script Writer integration

After Series Bible and Canonical Timeline resolution, the Script Writer receives a bounded:

`EPISODE MEMORY LEDGER V11.12.3`

block containing prior finalized episodes and their:

- summaries;
- discoveries;
- established facts;
- resolved and unresolved questions;
- narrative promises;
- cliffhangers;
- Timeline event references.

Only memories with `episodeNumber < targetEpisode` are included.

The target episode cannot see its own ledger while being written, even if a record exists because an operator is regenerating historical material.

Script generation remains read-only and cannot finalize, amend or advance Episode Memory.

## API

All routes use the existing `protect` middleware:

- `GET /api/series-bibles/:seriesId/episodes`
- `GET /api/series-bibles/:seriesId/episodes/:episodeNumber`
- `POST /api/series-bibles/:seriesId/episodes/:episodeNumber/finalize`
- `PATCH /api/series-bibles/:seriesId/episodes/:episodeNumber`
- `GET /api/series-bibles/:seriesId/episodes/:episodeNumber/revisions`
- `GET /api/series-bibles/:seriesId/episode-memory/commits`
- `POST /api/series-bibles/:seriesId/episode-memory/validate`

## Environment

```env
SERIALIZED_EPISODE_MEMORY_ENABLED=true
SERIALIZED_EPISODE_MEMORY_PROMPT_EPISODES=20
```

The prompt limit bounds how many prior finalized episode ledgers may be injected into a script request.

## Validation

Dedicated gate:

```bash
npm run test:episode-memory
```

The verifier covers:

- runtime syntax and materialization anchors;
- SQLite schema and atomic transaction methods;
- explicit approval requirement;
- strategy binding enforcement;
- exact Timeline set enforcement;
- stale Bible revision rejection;
- sequential episode finalization;
- atomic Series Bible advancement;
- duplicate/gap prevention;
- append-only ledger behavior;
- explicit audited amendments;
- stale amendment rejection;
- ledger completeness validation;
- Timeline/Ledger drift detection;
- target-episode leakage prevention;
- bounded prior-episode prompt context;
- protected API routes;
- legacy standalone episode-advance guard.

## Existing serialized series

If a pre-11.12.3 series already has `currentEpisode > 0` but lacks Episode Memory rows for those historical episodes, validation intentionally fails with `finalized_episode_memory_missing`.

The system does not invent old episode summaries. Historical memories must be reconstructed and approved explicitly before that series can use the strict Episode Memory context.

## Next phase

11.12.4 should add **Character Arc Memory**: per-character narrative state across finalized episodes, including goals, beliefs, knowledge, emotional/ethical changes, injuries or durable conditions, secrets, arc milestones and explicit links back to Episode Memory and Canonical Timeline evidence.
