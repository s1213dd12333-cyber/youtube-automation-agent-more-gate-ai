# Phase 11.12.5 — Relationship State Graph

## Purpose

Persist the current inter-character relationship state of a serialized series without mixing it into Character Arc Memory. The graph is directional: `A -> B` and `B -> A` are independent canonical edges.

## Narrative ownership

The continuity stack is now:

1. **11.12.1 Series Bible** — global series rules and immutable canon.
2. **11.12.2 Canonical Timeline** — canonical story-world events and chronology.
3. **11.12.3 Episode Memory** — finalized episode ledger.
4. **11.12.4 Character Arc Memory** — intrinsic state of each character.
5. **11.12.5 Relationship State Graph** — state between characters.

Relationship truth must not be duplicated back into Character Arc Memory. A Character Arc may say what a character wants or knows; a relationship edge says how that source character currently relates to one specific target.

## Directed edge identity

A relationship is identified by:

```text
seriesId + sourceCharacterKey + targetCharacterKey
```

`mara -> ivo` is not the same edge as `ivo -> mara`.

Writes never fuzzy-match by display name. Both endpoints must already resolve to exact Character Arc records in the same Series Bible. Self-edges are rejected.

## State model

Each current edge stores:

- relationship label and narrative state;
- relationship tags;
- trust, affinity, respect and loyalty scores (`-100..100`);
- fear, attraction and dependence scores (`0..100`);
- source beliefs about the target;
- source knowledge about the target;
- secrets the source knows about the target;
- obligations and promises from source to target;
- grievances, expectations and boundaries held by the source;
- relevant shared history and current tensions;
- first/last episode, revision and active/archive status.

These scores are continuity aids, not automatic story decisions. The Script Writer receives them as the starting state for the next episode.

## Knowledge isolation

Relationship knowledge is directional. A secret stored on `mara -> ivo` means Mara knows that fact about Ivo. It does **not** imply:

- Ivo knows that Mara knows it;
- Ivo knows the secret himself;
- any third character knows it;
- the reverse edge contains the same fact.

The Script Writer prompt explicitly forbids automatic transfer or mirroring.

## Commit model

A relationship mutation is allowed only when the exact Episode Memory is already `finalized`.

Normal episode commits:

- require an explicit audit reason;
- validate both Character Arc endpoints;
- validate referenced Timeline events are a subset of the finalized Episode Memory;
- use optimistic revision checks;
- reject duplicate edges in one batch;
- reject a second normal commit for the same edge/episode;
- commit all submitted edges in one SQLite `BEGIN IMMEDIATE` transaction.

Historical backfill is explicit and cannot insert behind an already-later relationship commit.

## Append-only corrections

Canonical relationship history is append-only. There is no destructive delete endpoint.

An amendment:

- requires explicit `allowAmendment`;
- requires an audit reason;
- is allowed only for the latest committed relationship state;
- cannot change source or target identity;
- creates a new revision and immutable amendment commit.

## Persistence

SQLite tables:

- `serialized_relationship_states`
- `serialized_relationship_revisions`
- `serialized_relationship_episode_commits`

Each state pins both source and target Character Arc IDs to detect endpoint drift.

## Script Writer integration

For an active serialized strategy, the Script Writer receives bounded read-only Relationship State Graph context after Character Arc Memory.

Generation does not mutate the graph. Relationship changes depicted by a generated script become canonical only after the episode is approved/finalized and an explicit relationship commit is made.

## API

Protected routes:

- `GET /api/series-bibles/:seriesId/relationships`
- `GET /api/series-bibles/:seriesId/relationships/:sourceCharacterKey/:targetCharacterKey`
- `POST /api/series-bibles/:seriesId/episodes/:episodeNumber/relationships/commit`
- `PATCH /api/series-bibles/:seriesId/episodes/:episodeNumber/relationships/:sourceCharacterKey/:targetCharacterKey`
- `GET /api/series-bibles/:seriesId/relationships/:sourceCharacterKey/:targetCharacterKey/revisions`
- `GET /api/series-bibles/:seriesId/relationships/:sourceCharacterKey/:targetCharacterKey/commits`
- `POST /api/series-bibles/:seriesId/relationships/validate`

## Environment

```env
SERIALIZED_RELATIONSHIP_STATE_GRAPH_ENABLED=true
SERIALIZED_RELATIONSHIP_PROMPT_LIMIT=60
```

## Validation

Dedicated command after materialization:

```bash
npm run test:relationship-state-graph
```

The verifier covers directed-edge asymmetry, endpoint isolation, self-edge rejection, Timeline/Episode Memory gating, optimistic revisions, batch prevalidation, historical protection, amendments, cross-series isolation, prompt safety and current-state drift detection.

## Next phase

**11.12.6 — Plot Thread Registry** owns unresolved/resolved narrative threads, setup/payoff state, episode provenance, dependencies and abandonment/closure state. It should consume the validated Series Bible, Timeline, Episode Memory, Character Arc Memory and Relationship State Graph without allowing generated scripts to commit thread state directly.
