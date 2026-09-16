# Phase 11.12.7 — Narrative Context Resolver

## Purpose

Phase 11.12.7 adds a read-only orchestration layer over the serialized narrative memory stack. It does not introduce a new canon store. Its job is to validate, reconstruct, rank and compress existing canonical memory into one deterministic context packet for the Script Writer.

Sources:

- Series Bible (11.12.1)
- Canonical Timeline (11.12.2)
- Episode Memory / Ledger (11.12.3)
- Character Arc Memory (11.12.4)
- Relationship State Graph (11.12.5)
- Plot Thread Registry (11.12.6)

## Core contract

The resolver is read-only. It contains no Series Bible, Timeline, Episode Memory, Character Arc, Relationship or Plot Thread commit/amendment path. Canon mutations remain owned by their post-approval services.

Before resolving a packet, the resolver runs each source layer's existing validation gate. Any invalid source blocks resolution instead of generating from inconsistent canon.

## Target-episode isolation

Timeline events and Episode Memory records are eligible only when their episode number is strictly lower than the target episode.

Character Arc, Relationship and Plot Thread records support historical `as-of` reconstruction. If the current row contains state committed at or after the target episode, the resolver reconstructs the latest `afterSnapshot` from a commit strictly before the target episode. This prevents later knowledge, relationship changes or thread resolutions from leaking into an earlier episode rewrite.

A requested target episode cannot skip beyond `currentEpisode + 1`. A request that disagrees with an explicit Series Bible strategy binding fails closed.

## Explicit focus

Callers may provide exact focus references:

- `characterKeys`
- `relationshipEdgeKeys` (`source->target`)
- `plotThreadKeys`
- `timelineEventIds`
- `locationRefs`
- `sceneId` / `sceneOrder`
- `objective` / `queryTerms`

Exact canonical references are normalized but are not fuzzy-resolved. With strict focus enabled, a missing character, relationship, thread or Timeline event returns `narrative_context_focus_reference_not_found` rather than silently substituting another entity.

## Selection and relevance

Selection is deterministic. The resolver scores candidates using:

1. exact explicit focus;
2. open/dormant Plot Thread obligations and priority;
3. exact links from Plot Threads to characters, directed relationships and Timeline events;
4. target-specific character / relationship / location links;
5. canonical recency;
6. bounded lexical overlap with an explicit narrative objective.

Ties are resolved by a stable source-type order and canonical key, so identical canon + focus produces identical packet ordering.

Terminal Plot Threads are excluded from the default forward-writing packet. They remain available when explicitly focused as canonical history.

## Global context budget

Instead of independently injecting the complete output from every memory service, the Script Writer receives one `NARRATIVE CONTEXT RESOLVER V11.12.7` packet.

The resolver enforces a global character budget and a global selected-item budget across all memory layers. The Series Bible hard-canon block is always included, while the remaining budget is allocated to the highest-priority candidates.

Defaults:

- `SERIALIZED_NARRATIVE_CONTEXT_MAX_CHARS=56000`
- `SERIALIZED_NARRATIVE_CONTEXT_MAX_ITEMS=80`

The packet includes a provenance manifest with source type, canonical key, relevance score, source episode, source revision and selection reasons.

## Deterministic fingerprint

Every resolved packet receives a stable context fingerprint derived from:

- resolver version;
- series id;
- Bible revision and canon version;
- target episode;
- normalized focus;
- selected canonical source identities and source revisions.

This fingerprint is intended to be consumable by Phase 11.12.8 so a later continuity gate can prove which exact narrative context was used to generate/review an episode.

## Script Writer integration

The Script Writer still resolves the Series Bible explicitly first, preserving exact series binding and the existing fail-closed no-AI-provider behavior. After that, 11.12.7 builds the unified packet.

The previous independent prompt dumps for Timeline, Episode Memory, Character Arc, Relationship Graph and Plot Thread Registry are no longer separately appended to the AI prompt. Their services remain authoritative owners/validators; the resolver reads their persisted state and validation contracts.

## Protected API

`POST /api/series-bibles/:seriesId/narrative-context/resolve`

The endpoint is protected by the existing authentication middleware. It accepts a target episode and optional focus object, then returns the packet, fingerprint, selected provenance, counts, omitted counts and validation results. It does not mutate canon.

## Failure modes

Resolution fails closed for:

- invalid/missing source dependency;
- source validation drift;
- inactive series;
- target episode gap;
- binding/request episode mismatch;
- missing explicit focus reference.

## Environment

```env
SERIALIZED_NARRATIVE_CONTEXT_RESOLVER_ENABLED=true
SERIALIZED_NARRATIVE_CONTEXT_MAX_CHARS=56000
SERIALIZED_NARRATIVE_CONTEXT_MAX_ITEMS=80
SERIALIZED_NARRATIVE_CONTEXT_STRICT_FOCUS=true
```

## Verification

`npm run test:narrative-context-resolver`

The dedicated verifier covers materialized syntax, unified Script Writer integration, protected API, read-only behavior, historical as-of reconstruction, future-state isolation, exact focus failure, deterministic fingerprint/text, terminal-thread policy, source validation failure, cross-series isolation and global prompt bounds.
