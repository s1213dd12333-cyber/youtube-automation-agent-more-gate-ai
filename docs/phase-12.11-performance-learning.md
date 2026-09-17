# Phase 12.11 — Performance Learning

## Goal

Close the post-publication learning loop so AgentTube can use measured YouTube performance to improve future editorial and planning decisions without turning short-term popularity into an unrestricted control signal.

## What is measured

Phase 12.11 consumes real post-publication analytics already collected by the Analytics & Optimization Agent and derives comparable learning snapshots from:

- CTR and impressions
- audience retention / average view percentage
- views
- comments, normalized as comments per thousand views
- growth velocity, represented as views per elapsed hour inside the measurement window
- performance by subject, content pillar and format

The engine prefers the most mature measurement available for each video (`7d` over `24h` over rolling) so the same publication does not count multiple times when aggregate learning signals are rebuilt.

## Evidence policy

Simulated analytics are explicitly excluded. A snapshot may be stored for audit, but only real measurements with enough exposure and medium/high confidence can create a decision signal.

Default eligibility thresholds are:

- at least 20 views
- at least 100 impressions
- at least 2 independent video samples for a learned subject/pillar/format

The thresholds are configurable through `PERFORMANCE_LEARNING_*` environment variables.

## Learning model

Reliable videos are compared against the channel's median baseline. The composite learning index uses:

- retention: 30%
- CTR: 25%
- growth velocity: 20%
- views: 15%
- comments per thousand views: 10%

The resulting subject/pillar/format signal is persisted with its sample count, exposure, averages, evidence and confidence.

## How future decisions change

Performance Learning has two bounded consumers:

1. **Autonomous Editorial Decision Brain** — matching historical subject performance can alter editorial priority by at most `-6` to `+6` points.
2. **Content Strategy Agent** — strong/weak subjects and formats are included in autonomous planning, including the deterministic fallback when no AI text provider is available.

This is a prioritization influence only. Performance history cannot bypass:

- independent-source requirements
- Evidence / Truth Engine
- Autonomous Quality Council
- approval / readiness gates
- publishing cadence and publication gates
- channel objectives and safety constraints

Every non-zero editorial application is persisted in `newsroom_performance_learning_applications` with the exact matched signals.

## Persistence

Phase 12.11 adds:

- `newsroom_performance_learning_snapshots`
- `newsroom_performance_learning_signals`
- `newsroom_performance_learning_applications`

Protected APIs expose status, learned signals and raw snapshots:

- `GET /api/newsroom/performance-learning/status`
- `GET /api/newsroom/performance-learning/signals`
- `GET /api/newsroom/performance-learning/snapshots`

## Validation

Run:

```bash
npm run test:performance-learning
```

The verifier checks, among other things, that simulated analytics never teach the system, strong and weak subjects produce opposite bounded signals, CTR/retention/comments/growth velocity contribute to learning, future editorial priority actually changes, and even the maximum positive adjustment cannot bypass insufficient evidence.

## Completion criterion

Phase 12.11 is complete only when the canonical materializer, dedicated regression suite and repository CI all pass with the learning engine wired after Phase 12.10.
