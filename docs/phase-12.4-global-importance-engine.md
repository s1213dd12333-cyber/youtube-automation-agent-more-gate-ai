# Phase 12.4 — Global Importance Engine

Phase 12.4 separates **media repercussion** from **structural global importance** before the Phase 12.3 Editorial Decision Brain allocates the scarce autonomous editorial slot.

## Why

A story can be highly viral without having broad structural consequences, while a lower-volume event can materially affect human safety, infrastructure, economies, institutions or multiple regions. Phase 12.4 prevents raw coverage volume from acting as a proxy for importance.

## Structural dimensions

Each candidate receives an immutable, auditable assessment across:

- geographic reach;
- human-safety impact signals;
- economic/systemic impact signals;
- critical-infrastructure impact signals;
- civic/institutional impact signals;
- persistence/duration proxy;
- urgency;
- cross-border spillover.

The engine also computes an evidence-confidence score from independent evidence units, source breadth, source-region breadth and the existing newsroom coverage-confidence signal. Low-confidence assessments are damped rather than promoted by dramatic wording alone.

## Impact tiers

Assessments are classified as `limited`, `regional`, `international`, `global` or `systemic`. These are editorial impact estimates over observed metadata; they are not factual truth labels.

## Neutrality

The engine does not score political parties, candidates, ideologies, sentiment or viewpoint desirability. Identical evidence/impact signals produce the same structural score regardless of the named political actor. Factual verification remains the responsibility of the downstream Research & Provenance and quality gates.

## Persistence and audit

- `global_news_importance_policy_revisions` stores append-only, reasoned policy changes.
- `global_news_importance_assessments` stores immutable/idempotent assessment snapshots bound to scan, cluster, event revision and policy revision.
- Every assessment records dimensions, evidence, reason codes, rationale and a deterministic fingerprint.

## Editorial Brain integration

Phase 12.3 now consumes structural importance as a distinct signal alongside repercussion, confidence, velocity, freshness, geography and event evolution. A high-repercussion/low-impact story can therefore lose the editorial slot to a lower-repercussion event with stronger structural impact.

Phase 12.4 never bypasses Research & Provenance, fact quality, approval or publication gates.
