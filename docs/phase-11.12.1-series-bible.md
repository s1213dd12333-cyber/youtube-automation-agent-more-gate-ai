# Phase 11.12.1 — Serialized Narrative Memory: Series Bible

Phase 11.12.1 introduces the persistent root of AgentTube's cross-episode narrative memory. The goal is not to remember every episode yet; it is to establish a canonical, revisioned Series Bible that later timeline, episode-memory, character-arc, relationship and plot-thread phases can safely build on.

## Boundary

This phase owns stable series-level canon:

- series identity and namespace;
- title, format and genres;
- premise;
- world rules;
- immutable canon;
- narrative rules;
- central conflicts;
- planned ending/destination;
- last committed episode number;
- canon version and Bible revision number.

It does **not** yet implement episode summaries, relationship graphs, plot-thread state, timeline-event retrieval or the final cross-episode contradiction gate. Those belong to 11.12.2+.

## Persistence

Three SQLite tables are materialized:

- `serialized_series_bibles` — current canonical Series Bible;
- `serialized_series_bible_revisions` — immutable revision snapshots and change audit;
- `serialized_series_strategy_bindings` — explicit strategy/episode → series binding.

A Series Bible is unique by `(namespace, series_key)`. This lets independent channels/story universes use the same human-facing series name without sharing canon.

## No fuzzy cross-series memory

The Script Writer may resolve serialized memory only through:

1. an explicit `seriesId`;
2. an explicit `seriesKey` + namespace; or
3. a persisted strategy binding.

Topic/title similarity is deliberately ignored. A strategy called `Star Harbor episode 8` does not receive Star Harbor memory unless it is explicitly bound or carries an explicit series reference.

This fail-closed rule prevents one show's canon from leaking into another.

## Immutable canon / retcon policy

Ordinary updates increment `revisionNumber` but keep `canonVersion` unchanged.

Changing `immutableCanon` requires:

- `allowRetcon: true`;
- an explicit reason of meaningful length;
- a current `expectedRevisionNumber`.

A successful retcon increments both `revisionNumber` and `canonVersion` and persists a revision snapshot with `changeKind = retcon`.

Stale revision writes fail closed. Episode numbers are monotonic by default; silent rewinds are rejected.

## Script Writer integration

`SerializedSeriesBibleServiceV12.getScriptContext(strategy)` resolves the Bible and builds a bounded prompt block containing:

- series/canon identity;
- target episode;
- premise;
- immutable canon;
- world rules;
- narrative rules;
- central conflicts;
- planned ending;
- explicit instructions not to invent retcons or treat script generation as a canon commit.

The block is injected after the Phase 5 fiction-evidence policy and before the Evidence Desk packet. This keeps fictional plot facts separate from real-world factual claims while still enforcing story-world canon.

Generating a script does **not** advance `currentEpisode` and does **not** commit new canon. Future narrative-memory phases will perform the post-approval canon commit.

## API

All Series Bible routes use the existing `protect` middleware:

- `GET /api/series-bibles`
- `POST /api/series-bibles`
- `GET /api/series-bibles/:seriesId`
- `PATCH /api/series-bibles/:seriesId`
- `GET /api/series-bibles/:seriesId/revisions`
- `POST /api/series-bibles/:seriesId/advance`
- `POST /api/series-bibles/:seriesId/bind-strategy`

`PATCH` accepts `expectedRevisionNumber`. Immutable-canon edits additionally require `allowRetcon: true` and `retconReason`/`changeReason`.

`bind-strategy` refuses a silent move from one series to another. Rebinding requires `allowRebind: true` plus an explicit reason.

## Environment

```env
SERIALIZED_SERIES_BIBLE_ENABLED=true
SERIALIZED_STORY_NAMESPACE=default
```

Use a distinct namespace for unrelated story universes when practical.

## Validation

The dedicated gate is:

```bash
npm run test:series-bible
```

The verifier covers syntax/materialization plus the behavioral contract for:

- normalization and duplicate prevention;
- revision history;
- optimistic stale-write rejection;
- immutable-canon retcon enforcement;
- canon-version increments;
- monotonic episode advancement;
- explicit strategy binding;
- cross-series rebind protection;
- explicit ID/key resolution;
- no fuzzy topic/title resolution;
- bounded Script Writer canon prompt;
- protected API routes.

## Next phase

11.12.2 should add the **Canonical Timeline**: ordered story-world events with episode/scene coordinates, participants, cause/consequence, truth status and chronology constraints. It should consume the Series Bible without mutating it implicitly.
