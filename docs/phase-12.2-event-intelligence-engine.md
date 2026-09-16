# Phase 12.2 — Event Intelligence Engine

Phase 12.2 sits between the Phase 12.1 headline/story clustering layer and the Autonomous Editor.

## Purpose

Phase 12.1 answers: **which headlines appear to describe the same current story cluster?**

Phase 12.2 answers: **which persistent real-world event does this cluster belong to, what materially changed, and how is it related to other events?**

The engine is deliberately conservative. A shared person, organization, country, or keyword is not sufficient to merge events.

## Event identity

Each event receives a stable `news_event_*` identifier and an append-only revision timeline. Matching uses a bounded combination of:

- named entities extracted from headlines;
- event locations extracted through multilingual aliases;
- language-neutral event concepts (for example announce/anuncia/annonce → `announce`);
- numeric facts present in headlines;
- normalized title-token overlap;
- recency.

Default match threshold: `0.62`.

If two candidate events are both above the threshold and are closer than the ambiguity margin (`0.08` by default), the engine fails closed and creates a separate event instead of silently merging histories.

## Multilingual normalization

The deterministic core does not require an external translation API. It stores original title variants and languages, while mapping a bounded multilingual vocabulary to language-neutral concepts and canonical geographic names. This makes cross-language identity work even when wording differs substantially.

The engine does **not** claim to provide a complete machine translation of every headline. Unknown vocabulary remains original evidence and can still match through entities, locations and other features.

## Evolution classification

Each linked cluster creates one immutable event revision classified as:

- `new_event`
- `observation`
- `material_update`
- `escalation`
- `resolution`
- `correction`

A restatement or translation with no new canonical evidence remains an `observation`. New entities, locations, concepts or numeric facts can produce a material update. Explicit correction, escalation and resolution concepts receive dedicated classifications.

The Autonomous Editor receives this event-level material-change result. Once an event has already generated a backlog assignment, a later cluster in another language still counts as the same previously assigned story.

## Relations

Distinct events may be linked only as:

- `related_to`
- `follow_up_of`

Automatic causal relations are intentionally forbidden. The engine never infers `caused_by`, responsibility, motive or blame from headline similarity.

## Persistence

Phase 12.2 adds:

- `global_news_events`
- `global_news_event_revisions`
- `global_news_event_cluster_links`
- `global_news_event_relations`
- `global_news_event_assignments`

Event revisions are append-only. Current state is validated against the latest revision snapshot, and cluster links are exact.

## API

Protected endpoints:

- `GET /api/newsroom/events`
- `GET /api/newsroom/events/:eventId`
- `GET /api/newsroom/events/:eventId/timeline`
- `GET /api/newsroom/events/:eventId/relations`
- `POST /api/newsroom/events/:eventId/validate`

## Dashboard

The Global Newsroom gains:

- Persistent events list;
- event status and revision count;
- languages, entities, locations and concepts;
- evolution timeline;
- related/follow-up event links.

## Configuration

```env
NEWSROOM_EVENT_INTELLIGENCE_ENABLED=true
NEWSROOM_EVENT_MATCH_THRESHOLD=0.62
NEWSROOM_EVENT_AMBIGUITY_MARGIN=0.08
NEWSROOM_EVENT_RECENT_DAYS=14
NEWSROOM_EVENT_RELATION_THRESHOLD=0.44
```

## Editorial boundary

Event identity is an organizational inference over observed headline metadata. It is not a truth score. Entity extraction, event matching and relations do not establish that a reported claim is true. Research & Provenance remains authoritative for factual verification before publication.
