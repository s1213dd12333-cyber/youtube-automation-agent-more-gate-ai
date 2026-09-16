# Phase 12.3 — Autonomous Editorial Decision Brain

Phase 12.3 turns the Phase 12.1 per-cluster editor into a competitive, memory-aware newsroom decision layer operating on top of Phase 12.2 persistent events.

## What it decides

For every current event candidate the brain records one of:

- `BREAKING`
- `COVER`
- `UPDATE`
- `FOLLOW_UP`
- `WAIT`
- `IGNORE`
- `DEFER`

`DEFER` is a Phase 12.3 planning outcome. It is translated to legacy `WAIT` when writing the older Phase 12.1 decision table, so the existing downstream contracts remain compatible.

## Scarce editorial slot

The default policy targets one autonomous editorial selection every 120 minutes while the Global News Radar continues scanning every 10 minutes. A normal actionable story found during the cooldown is deferred rather than repeatedly promoted into the backlog.

A high-confidence, fast-rising `BREAKING` story may pre-empt the normal cooldown when `NEWSROOM_EDITORIAL_BREAKING_COOLDOWN_OVERRIDE=true`. The override is explicit in the audit reason codes.

Only one candidate wins the default scan slot. Other otherwise-actionable candidates receive `DEFER` with `higher_priority_story_selected_for_this_scan` rather than silently becoming duplicate backlog work.

## Auditable signals

Priority uses observable signals already produced by the newsroom stack:

- global coverage/repercussion score
- cross-source coverage confidence
- coverage velocity
- freshness
- geographic breadth
- Phase 12.2 event evolution
- recent coverage diversity
- prior event-level assignment memory

The score is an editorial scheduling signal, not a truth score and not a political recommendation.

## Evidence gates

The default evidence floor is three independent headline evidence units and 58/100 coverage-confidence. Sensitive/high-impact concepts such as elections, attacks, deaths, injuries, arrests, emergencies and ceasefires use a stricter default floor of four independent evidence units and 72/100 confidence.

These gates do not establish factual truth. Selected stories still pass through the existing Research & Provenance Desk, factual claim gates, quality review, approval policy and publishing system.

## Duplicate/update memory

If a Phase 12.2 event has already been assigned and there is no material evolution, the brain returns `IGNORE`. Material updates, corrections, escalation and resolution can become `UPDATE` when their evidence and priority clear the policy threshold.

## Diversity memory

Recent selected coverage is remembered for six hours by default. Repeating the same location/concept too frequently adds a soft priority penalty; it never bans a location or political viewpoint. A sufficiently important story can still win.

## Policy revisioning

Editorial policy changes are append-only and require an audit reason. The protected API exposes:

- `GET /api/newsroom/editor/status`
- `GET /api/newsroom/editor/decisions`
- `GET /api/newsroom/editor/policy`
- `POST /api/newsroom/editor/policy`

Each scan stores the exact policy revision and signal snapshot used for every candidate decision.

## Persistence

Phase 12.3 adds:

- `global_news_editorial_policy_revisions`
- `global_news_editorial_brain_runs`
- `global_news_editorial_brain_decisions`

Decisions are immutable/idempotent by deterministic fingerprints.

## Dashboard

Global Newsroom gains an **EDITORIAL BRAIN 12.3** panel showing the mission, target cadence, cooldown state, current policy revision and recent autonomous decisions.

## Safety boundary

The brain decides editorial priority and timing only. It does not bypass research, source provenance, copyright/license checks, factual quality gates, approval requirements or YouTube publishing controls.
