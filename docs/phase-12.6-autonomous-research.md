# Phase 12.6 — Autonomous Research / Evidence Acquisition

Phase 12.6 turns the 12.5 editorial research requirements into an executable evidence-acquisition loop.

## Position in the newsroom

`Global News Radar → Event Intelligence → Editorial Decision Brain → Global Importance → Editorial Planning AI → Autonomous Research → backlog/generation → Research & Provenance → Script → Quality → Approval → Publishing`

12.6 does **not** replace the existing Phase 5 Research & Provenance Desk. It is an upstream newsroom gate. Its job is to make sure an autonomously selected story has enough retrievable, independent evidence before it is promoted into the production backlog.

## Decisions

Each selected editorial plan ends with one of three research states:

- `RESEARCH_MORE` — an intermediate round still has evidence gaps.
- `EVIDENCE_READY` — the configured evidence requirements are satisfied.
- `BLOCK` — the maximum research rounds were exhausted without enough corroboration.

Only `EVIDENCE_READY` can auto-promote a newsroom story while Phase 12.6 is enabled.

## Evidence loop

The engine starts with the exact source URLs observed by the Global News Radar. It retrieves readable page evidence, deduplicates by URL/domain, and measures source breadth. When more evidence is required it can discover additional coverage through GDELT and use the existing Research Agent v5 adapters as a supplemental reference/scholarly layer.

The loop is bounded by policy (`maxRounds`, `maxSources`, HTTP timeout). Failure of an individual source or adapter does not crash the newsroom; it leaves an explicit evidence gap.

## Fail-closed rules

The engine checks the requirements created by 12.5, including:

- minimum independent source/domain count;
- primary/official source requirement when the editorial plan requires it;
- research-question coverage;
- evidence depth/availability;
- deterministic minimum evidence score.

If those requirements are not satisfied after the allowed rounds, the story is blocked from automatic backlog promotion.

## Source safety

12.6 accepts only public HTTP(S) source URLs, rejects localhost/private literal addresses and disables automatic HTTP redirects while retrieving evidence. This prevents newsroom source discovery from becoming an unrestricted internal-network fetch primitive.

Publisher pages that cannot be retrieved remain `unavailable` and never count as verified evidence.

## Uncertainty discipline

The engine collects evidence; it does not turn repetition into truth. Disputed, unverified or changing claims still have to preserve their uncertainty labels. Existing Research & Provenance and factual-quality gates remain mandatory downstream.

## Persistence

The phase adds:

- `newsroom_autonomous_research_policy_revisions` — append-only policy revisions;
- `newsroom_autonomous_research_runs` — immutable/idempotent final research snapshots;
- `newsroom_autonomous_research_rounds` — per-round audit decisions.

A deterministic run fingerprint binds the plan, event revision, scan and research policy so the same evidence snapshot is not duplicated.

## API

Protected endpoints:

- `GET /api/newsroom/research/status`
- `GET /api/newsroom/research/runs`
- `GET /api/newsroom/research/runs/:runId`
- `GET /api/newsroom/research/policy`
- `POST /api/newsroom/research/policy`

Policy changes require an audit reason.

## Dashboard

Global Newsroom gains `AUTONOMOUS RESEARCH 12.6 / Evidence acquisition`, showing recent run status, evidence score, question coverage, independent-domain count, primary-source count and remaining gaps.

## Environment

```env
NEWSROOM_AUTONOMOUS_RESEARCH_ENABLED=true
NEWSROOM_RESEARCH_MAX_ROUNDS=3
NEWSROOM_RESEARCH_MAX_SOURCES=16
NEWSROOM_RESEARCH_HTTP_TIMEOUT_MS=7000
NEWSROOM_RESEARCH_MIN_EVIDENCE_CHARS=180
NEWSROOM_RESEARCH_MIN_COVERAGE_RATIO=0.55
NEWSROOM_RESEARCH_MIN_EVIDENCE_SCORE=62
```

## Verification

After materialization:

```powershell
cd upstream
npm run test:autonomous-research
```

The CI verifier is offline: network behavior is exercised with deterministic HTTP fixtures rather than depending on live publishers or GDELT.
