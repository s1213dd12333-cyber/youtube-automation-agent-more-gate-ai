# Phase 12.8 — Autonomous Production Director

Phase 12.8 turns a `VERIFIED` Evidence / Truth packet into a deterministic, auditable production directive before newsroom promotion.

## Decisions

The director chooses:

- production mode: `speed_first`, `balanced`, or `depth_first`;
- visual strategy: `source_first`, `hybrid`, or `evidence_first_hybrid`;
- provider tier: `local_first`, `standard`, or `premium_allowed`;
- bounded production budget;
- target duration, scene cadence and scene count;
- TTS priority;
- map/timeline/chart/document requirements inherited from Editorial Planning AI.

## Truth preservation

Production is not allowed to rewrite the truth state. Each confirmed claim becomes a fact lock with source provenance. The default policy forbids inventing facts, upgrading reported material to confirmed, removing required attribution, or visually depicting an unverified allegation as an observed fact.

The director is fail-closed: with the default policy, a production directive is only `PLAN_READY` when Phase 12.7 returned `VERIFIED`.

## Cost autonomy

Ordinary reports remain local-first. High-importance breaking coverage and deep dives may authorize premium providers, but only inside the persisted directive budget cap. Provider authorization is permission, not a requirement to spend.

## Integration

The Global News Radar creates the directive after Phase 12.7 and before backlog promotion. The directive is persisted and linked to the resulting newsroom assignment. Downstream Research & Provenance, Fact Quality, approval and publishing gates remain mandatory.

Protected endpoints:

- `GET /api/newsroom/production-director/status`
- `GET /api/newsroom/production-director/directives`
- `GET /api/newsroom/production-director/directives/:directiveId`

Regression command:

```bash
npm run test:autonomous-production-director
```
