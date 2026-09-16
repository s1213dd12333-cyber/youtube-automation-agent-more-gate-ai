# Phase 12.1 — Global News Radar + Autonomous Editor

Phase 12.1 turns AgentTube from a topic-driven pipeline into an international newsroom observer. It discovers recent coverage, groups reports that describe the same event, measures how broadly and quickly that event is being covered, and records an auditable editorial action.

## Scope

The phase adds two tightly coupled capabilities:

1. **Global News Radar** — metadata-first discovery, URL de-duplication, deterministic story clustering, geographic/source diversity, recency and coverage-velocity scoring.
2. **Autonomous Editor** — deterministic decisions: `COVER`, `WAIT`, `IGNORE`, `UPDATE`, `BREAKING`, or `FOLLOW_UP`.

The editor may automatically create a normal `content_ideas` backlog assignment for actionable stories. It does **not** generate, approve, schedule, or publish a video by itself. Existing Research & Provenance, quality, readiness, approval, copyright/rights, narration and publishing gates remain authoritative.

## Discovery sources

The default adapter is the GDELT DOC API in article-list mode with English, Spanish, Portuguese and French global lanes. The adapter stores only discovery metadata required for ranking and audit: URL, headline/title, source/domain, source country/region, language and timestamps. It does not download or persist publisher article bodies.

Additional RSS/Atom feeds are optional through `NEWSROOM_RSS_SOURCES_JSON`. No publisher feed is shipped as a default. Operators must add only feeds whose terms permit their intended commercial workflow.

## Repercussion is not truth

`globalScore` is explicitly a **coverage/repercussion** score, not a factual truth score and not a political recommendation. It combines:

- independent source/domain breadth — 30%
- geographic diversity of source regions — 20%
- recent coverage velocity — 25%
- freshness — 15%
- article volume — 10%

`confidenceScore` in Phase 12.1 means **coverage corroboration breadth**. It does not mean that a claim has been fact-checked. Factual claims are still verified downstream by the Research & Provenance Desk.

To reduce wire/syndication inflation, exact normalized headline copies across different domains count as one `independentEvidenceUnit`. This is a conservative signal; Phase 12.2 can add stronger event/entity and syndication intelligence later.

## Editorial policy

Default thresholds:

- scan interval: 10 minutes
- lookback: 6 hours
- minimum independent headline evidence units: 3
- minimum coverage-confidence: 58/100
- `BREAKING`: global score >= 82 plus high velocity
- `COVER`: global score >= 66
- follow-up floor: 58

A high score with insufficient independent evidence produces `WAIT`, not `COVER`.

Already assigned/covered stories are not duplicated. A later scan must show a material change before it may become `UPDATE` or `FOLLOW_UP`. Material-change evidence is persisted alongside each editorial decision.

## Persistence and audit

Phase 12.1 creates:

- `global_news_scans`
- `global_news_articles`
- `global_news_clusters`
- `global_news_editor_decisions`
- `global_news_assignments`

Decisions are immutable/idempotent through a decision fingerprint containing cluster, action, material fingerprint and phase version. Source failures are recorded per scan. A partial outage degrades the scan to `partial`; it does not terminate AgentTube.

## Scheduling and concurrency

The scheduler wakes the newsroom every minute, while `scanIfDue()` enforces the configured scan interval. A process-local single-flight lock rejects overlapping wake-ups as `scan_in_progress`, preventing duplicate concurrent HTTP scans.

## API

All newsroom routes use the existing protected API middleware:

- `GET /api/newsroom/config`
- `GET /api/newsroom/status`
- `POST /api/newsroom/scan`
- `GET /api/newsroom/clusters`
- `GET /api/newsroom/clusters/:clusterId`
- `GET /api/newsroom/decisions`
- `POST /api/newsroom/decisions/:decisionId/promote`

## Dashboard

A new **Global newsroom** view shows the latest scan, observed article count, event clusters, actionable decision count, ranked clusters and recent Autonomous Editor decisions. Operators can run an immediate scan and manually promote an actionable decision to the normal backlog.

## Environment

```env
NEWSROOM_ENABLED=true
NEWSROOM_SCAN_INTERVAL_MINUTES=10
NEWSROOM_LOOKBACK_HOURS=6
NEWSROOM_HTTP_TIMEOUT_MS=9000
NEWSROOM_CLUSTER_THRESHOLD=0.36
NEWSROOM_MIN_INDEPENDENT_SOURCES=3
NEWSROOM_MIN_COVERAGE_CONFIDENCE=58
NEWSROOM_BREAKING_THRESHOLD=82
NEWSROOM_COVER_THRESHOLD=66
NEWSROOM_FOLLOW_UP_THRESHOLD=58
NEWSROOM_AUTO_PROMOTE=true
NEWSROOM_RSS_SOURCES_JSON=[]
```

`NEWSROOM_GDELT_LANES_JSON` may override the default language lanes with an explicit JSON array.

## Non-goals for 12.1

Phase 12.1 does not claim absolute knowledge of “the most important story in the world”, does not infer political desirability, does not scrape article bodies, does not bypass fact checking, and does not autonomously publish. More advanced multilingual semantic event identity, entity resolution, wire-copy detection and cross-scan event lineage belong to later newsroom phases.
