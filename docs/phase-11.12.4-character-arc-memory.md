# Phase 11.12.4 — Character Arc Memory

## Goal

Persist the intrinsic narrative state of each character across serialized episodes without coupling story memory to visual generation mode. Character Arc Memory sits after Series Bible, Canonical Timeline and Episode Memory.

## Identity model

Narrative identity is explicit and series-scoped:

- `seriesId + characterKey` is unique;
- `characterKey` is required for every write;
- display-name similarity is never used to bind or mutate an arc;
- an arc may explicitly reference a Phase 11.11 `persistentCharacterId`;
- the visual identity fingerprint is pinned when that reference exists;
- changing the visual binding requires explicit rebind approval and a reason.

This keeps narrative identity usable for anime, novela, stories and other serialized formats while still allowing exact linkage to the existing persistent visual-character layer.

## Current arc state

Each arc stores:

- display name and stable character key;
- optional persistent visual-character binding;
- arc phase and story status;
- emotional state;
- moral/worldview state;
- physical condition;
- goals and motivations;
- beliefs;
- knowledge known by that character;
- secrets held/known by that character;
- inner conflicts;
- commitments;
- milestones;
- notes;
- first and last episode containing an arc commit;
- optimistic revision number and active/retired status.

Relationship state is intentionally excluded. It belongs to Phase 11.12.5 so relationship truth has one owner.

## Post-approval commit boundary

Character Arc Memory cannot mutate from draft script generation. A normal arc commit requires:

1. an active Series Bible;
2. an already finalized Episode Memory for the exact episode;
3. an explicit character key;
4. an audit actor and meaningful reason;
5. timeline references that are a subset of the finalized Episode Memory timeline IDs;
6. a matching expected revision for every existing arc in the batch.

The DB method uses `BEGIN IMMEDIATE` and commits the whole character batch atomically. Any conflict rolls the entire batch back.

## Backfill and amendments

Historical reconstruction is allowed only with explicit `allowBackfill=true`. A historical insert is rejected if that character already has a later arc commit, because replaying downstream state is not safe without a dedicated rebase engine.

Finalized arc history is append-only by default. Amendments require explicit approval, a reason and the current revision. Only the latest episode state for that character can be amended. Once a later episode has advanced the character, older snapshots cannot be rewritten underneath it.

## Knowledge isolation

The Script Writer receives Character Arc Memory as author-level read-only context. The prompt explicitly distinguishes global author knowledge from character knowledge:

- a character can act on its own `knowledge` and `beliefs` plus facts learned in the current episode;
- secrets and discoveries are not automatically transferred between characters;
- persistent injury, status, goals, beliefs, commitments and milestones cannot silently reset;
- script generation never commits state.

This prevents a character from knowing a revelation that only another character learned in a prior episode.

## Persistence

SQLite tables:

- `serialized_character_arcs` — current state;
- `serialized_character_arc_revisions` — immutable revision snapshots;
- `serialized_character_arc_episode_commits` — immutable Episode Memory linkage, before/after snapshots and timeline references.

## API

Protected routes:

- `GET /api/series-bibles/:seriesId/character-arcs`
- `GET /api/series-bibles/:seriesId/character-arcs/:characterKey`
- `POST /api/series-bibles/:seriesId/episodes/:episodeNumber/character-arcs/commit`
- `PATCH /api/series-bibles/:seriesId/episodes/:episodeNumber/character-arcs/:characterKey`
- `GET /api/series-bibles/:seriesId/character-arcs/:characterKey/revisions`
- `GET /api/series-bibles/:seriesId/character-arcs/:characterKey/commits`
- `POST /api/series-bibles/:seriesId/character-arcs/validate`

## Validation

`validateSeries()` checks:

- exact series isolation and unique character keys;
- arc state never ahead of the Series Bible;
- every episode commit references an existing finalized Episode Memory;
- character timeline references remain inside that Episode Memory;
- no duplicate normal episode commit per character/episode;
- current state equals the latest committed after-snapshot;
- optional persistent visual-character references still exist and match their pinned fingerprint.

A failed validation causes serialized Script Writer context resolution to fail closed.

## Environment

```env
SERIALIZED_CHARACTER_ARC_MEMORY_ENABLED=true
SERIALIZED_CHARACTER_ARC_PROMPT_LIMIT=40
```

## Test command

```bash
npm run test:character-arc-memory
```

## Boundary for next phase

Phase 11.12.5 owns inter-character relationship state. Phase 11.12.4 must not become a second relationship graph.
