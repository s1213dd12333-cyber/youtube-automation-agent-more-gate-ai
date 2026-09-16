# Phase 11.12.8 — Cross-Episode Narrative Continuity Gate

## Purpose

Phase 11.12.8 turns the read-only Narrative Context Resolver from Phase 11.12.7 into an approval-blocking continuity gate for serialized episodes.

The gate never writes Series Bible, Timeline, Episode Memory, Character Arc, Relationship or Plot Thread canon. It writes only immutable continuity-review reports used as approval evidence.

## Approval contract

An Episode Memory finalization is no longer sufficient with operator approval alone when `SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_PASS=true`.

Before finalization, the exact candidate episode must receive a persisted `pass` report. The report is bound to:

- series ID;
- target episode number;
- Narrative Context Resolver fingerprint;
- normalized Episode Memory candidate fields;
- the exact active target-episode Timeline event snapshots;
- gate version 11.12.8.

At finalization the gate recomputes the candidate fingerprint and re-resolves the 11.12.7 context using the original report focus. If either the candidate or canon changed, the prior PASS cannot be reused.

## Deterministic checks

The gate blocks on:

- exact target-episode Timeline set mismatch;
- deterministic negation conflicts with immutable Series Bible canon;
- promotion of prior `belief`, `rumor`, `disputed`, `false` or `unknown` Timeline statements into established facts without a new confirmed target event;
- impossible character knowledge declared in the continuity manifest;
- stale Character Arc revision assumptions;
- stale directed Relationship revision assumptions;
- stale Plot Thread revision assumptions;
- mutation/reopening of terminal Plot Threads;
- plot-thread lifecycle changes without exact target-episode Timeline evidence;
- high-priority open plot threads that are neither addressed nor explicitly deferred;
- Plot Thread resolution that omits required payoff evidence;
- stale PASS reports after Narrative Context changes.

Warnings are emitted for weaker continuity concerns such as resolving a question not found in prior Episode Memory or leaving medium-priority open threads unaddressed.

## Continuity manifest

The optional structured `continuityManifest` makes checks explicit where prose-only inference would be unsafe:

```json
{
  "knowledgeUses": [
    {
      "characterKey": "mara",
      "fact": "Mara learns the relay code",
      "learnedInEpisode": true,
      "supportingEventIds": ["evt_relay"]
    }
  ],
  "characterTransitions": [
    {
      "characterKey": "mara",
      "expectedRevision": 2,
      "arcPhase": "confrontation",
      "supportingEventIds": ["evt_relay"]
    }
  ],
  "relationshipTransitions": [
    {
      "edgeKey": "mara->ivo",
      "expectedRevision": 2,
      "relationshipState": "They cooperate on the council record.",
      "supportingEventIds": ["evt_relay"]
    }
  ],
  "plotThreadActions": [
    {
      "threadKey": "council_coverup",
      "action": "advance",
      "expectedRevision": 3,
      "supportingEventIds": ["evt_relay"]
    }
  ]
}
```

Exact canonical keys are required. Relationship edges remain directional (`mara->ivo` is not `ivo->mara`). New entities can be marked as introductions and must cite target-episode Timeline evidence.

`SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_MANIFEST=true` can be enabled for channels that want every reviewed serialized episode to declare these transitions explicitly. The default is false so deterministic canon/Timeline/thread checks still work without inventing undeclared semantic facts.

## API

Protected routes:

- `POST /api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/check`
- `GET /api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/reports`
- `POST /api/series-bibles/:seriesId/episodes/:episodeNumber/continuity/verify-pass`

The check endpoint persists both PASS and BLOCK reports for auditability. Reports are immutable and idempotent for the same series/episode/context/candidate/gate-version tuple.

## Episode Memory integration

`EpisodeMemoryServiceV12.finalizeEpisode()` now fails closed before its atomic Series Bible advance unless an exact fresh PASS exists. A failed or stale continuity review therefore cannot finalize Episode Memory or advance `currentEpisode`.

If the Episode Memory has no explicit `sourceFingerprint`, the verified continuity candidate fingerprint is retained as its source fingerprint for traceability.

## Environment

```env
SERIALIZED_NARRATIVE_CONTINUITY_GATE_ENABLED=true
SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_PASS=true
SERIALIZED_NARRATIVE_CONTINUITY_REQUIRE_MANIFEST=false
SERIALIZED_NARRATIVE_CONTINUITY_BLOCK_THREAD_PRIORITY=90
SERIALIZED_NARRATIVE_CONTINUITY_WARN_THREAD_PRIORITY=70
```

## Boundary

This phase is an approval gate, not a canon writer. Canon mutation remains owned by the existing dedicated post-approval flows. The continuity report table is audit evidence only.
