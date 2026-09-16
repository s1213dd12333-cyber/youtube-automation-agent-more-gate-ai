# Phase 11.12.2 — Serialized Narrative Memory: Canonical Timeline

Phase 11.12.2 adds an ordered, revisioned story-world timeline on top of the validated Phase 11.12.1 Series Bible.

The Series Bible owns stable series-level rules. The Canonical Timeline owns **what happened, in what story-world order, where it was introduced to the audience, what caused it, what it caused, who participated, and how certain the story treats it as being**.

## Core distinction: chronology vs narrative order

Every event has two independent coordinates:

- `chronologyIndex` — the event's position in story-world time;
- `episodeNumber` + `sceneId` + `sceneOrder` — where the audience learned or experienced the event.

This distinction is mandatory for flashbacks, delayed revelations, reconstructed histories and non-linear storytelling.

Example:

- Episode 3 may reveal a childhood event at `chronologyIndex = 1500`.
- Episode 2 may already contain an event at `chronologyIndex = 2000`.
- The later episode does not imply the revealed event happened later in the fictional world.

Chronology indexes are allocated with gaps (normally +1000) so later backfills can be inserted between existing events without renumbering the whole series.

## Persistence

Four SQLite tables are materialized:

- `serialized_timeline_states` — per-series timeline revision and chronology cursor;
- `serialized_timeline_events` — current canonical event records;
- `serialized_timeline_event_revisions` — immutable snapshots of event creation/retcons;
- `serialized_timeline_commits` — atomic append/backfill/retcon audit records.

Events are unique by:

- `(series_id, event_key)`;
- `(series_id, chronology_index)`.

A multi-event commit is wrapped in `BEGIN IMMEDIATE ... COMMIT`. Any failure rolls the whole commit back.

## Event schema

A canonical event can persist:

- stable `id` and `eventKey`;
- `chronologyIndex`;
- `episodeNumber`;
- `sceneId` / `sceneOrder`;
- optional `storyTimeLabel`;
- `eventType`;
- canonical summary;
- participant references;
- location references;
- causal event references;
- textual consequences;
- `mustFollowEventIds`;
- `mustPrecedeEventIds`;
- truth status;
- event revision;
- active/retired status;
- audit actor / commit identity.

## Truth status

Supported truth states are:

- `confirmed`;
- `belief`;
- `rumor`;
- `disputed`;
- `false`;
- `unknown`.

The timeline stores the truth status explicitly so a rumor or character belief is not silently promoted into objective canon by a later script.

## Chronology constraints

The validator checks all active events before persistence and before Script Writer context is produced.

It rejects:

- duplicate event IDs;
- duplicate event keys;
- duplicate chronology indexes;
- missing summaries;
- invalid chronology positions;
- self references;
- references to missing events;
- causes that occur after their effects;
- `mustFollow` order violations;
- `mustPrecede` order violations;
- cycles in chronology constraints.

`causeEventIds` imply that each cause must have an earlier chronology index than the event it caused.

## Append-only canon

Committed events are append-only by default.

Changing an existing canonical event requires:

- `allowRetcon: true`;
- a meaningful retcon reason;
- the current event revision;
- the current timeline revision.

A successful retcon increments both the event revision and the global timeline revision and writes a new immutable revision snapshot plus an audited timeline commit.

There is no silent in-place rewrite path.

## Explicit backfill

Adding an event at or before the current maximum chronology index is treated as a historical backfill.

Backfills require:

- `allowBackfill: true`;
- a meaningful commit reason;
- a current timeline revision;
- a fully valid resulting chronology graph.

This is how later episodes may canonically reveal earlier events without pretending those events happened later.

## Optimistic concurrency

Every timeline commit uses the current `timelineRevision`.

Stale writers fail closed with `timeline_revision_conflict`.

Every event retcon also checks the event's own revision. A stale event edit fails with `timeline_event_revision_conflict`.

The SQLite persistence layer re-checks those revisions inside an immediate transaction, so service-level checks are not the only protection.

## Series Bible boundary

The Canonical Timeline reads the Series Bible to verify the series exists and is active.

It does **not** call Series Bible update/advance methods and never advances `currentEpisode` implicitly.

Episode advancement remains a separate explicit canon operation until a later narrative-memory phase introduces a coordinated episode-finalization transaction.

## Script Writer integration

After Phase 11.12.1 resolves the explicit series binding, Phase 11.12.2 loads and validates that series' timeline.

The Script Writer receives a bounded `CANONICAL TIMELINE V11.12.2` block containing prior canonical events and their:

- chronology coordinates;
- narrative coordinates;
- truth status;
- type;
- participants;
- locations;
- causes;
- consequences;
- ordering constraints.

Only events with `episodeNumber < targetEpisode` are injected. An event already stored for the episode currently being written is intentionally excluded so unfinished/current-episode material cannot leak into its own generation context.

Script generation is strictly read-only. It does not append, move, retire, or retcon timeline events.

## API

All routes use the existing `protect` middleware:

- `GET /api/series-bibles/:seriesId/timeline`
- `POST /api/series-bibles/:seriesId/timeline/events`
- `PATCH /api/series-bibles/:seriesId/timeline/events/:eventId`
- `GET /api/series-bibles/:seriesId/timeline/events/:eventId/revisions`
- `GET /api/series-bibles/:seriesId/timeline/commits`
- `POST /api/series-bibles/:seriesId/timeline/validate`

The append endpoint accepts either one event or an `events[]` batch. Batch persistence is atomic.

## Environment

```env
SERIALIZED_CANONICAL_TIMELINE_ENABLED=true
SERIALIZED_TIMELINE_PROMPT_EVENTS=60
```

`SERIALIZED_TIMELINE_PROMPT_EVENTS` bounds how many prior events may be injected into a script prompt.

## Validation

Dedicated gate:

```bash
npm run test:canonical-timeline
```

The verifier covers:

- materialized runtime syntax;
- SQLite schema and transaction anchors;
- atomic multi-event commit;
- stale timeline revision rejection;
- dangling event references;
- explicit backfill requirement;
- flashback insertion between existing chronology indexes;
- causal ordering violations;
- chronology-cycle detection;
- append-only event protection;
- explicit retcon and revision history;
- truth-status preservation;
- target-episode leakage prevention;
- bounded Script Writer prompt;
- Series Bible non-mutation;
- protected API routes.

The Windows CI also reruns the full Phase 11.10 and 11.11 suites plus 11.12.1 before the dedicated 11.12.2 gate.

## Next phase

11.12.3 should add **Episode Memory / Episode Ledger**: a persistent post-approval record of each episode's summary, resolved and unresolved facts, discoveries, promises, cliffhangers and references to the canonical timeline events created by that episode.
