# Phase 11.9.8 — Reusable Location System E2E

Phase 11.9.8 closes the 11.9 reusable-location roadmap with a deterministic end-to-end regression suite. It uses the real materialized Phase 11.9.1–11.9.7 runtime modules with an in-memory persistence adapter and local fixture files, so it does not require external AI providers or network access.

## Scenario matrix

The E2E suite runs five productions in order:

1. **Video A — origin**: registers `Miller House`, creates persistent `living_room` and `kitchen` zones, persists the reusable master, and promotes two verified canonical zone references.
2. **Video B — alias reuse**: resolves `Miller home` back to the same `locationId`, reuses the same living-room `zoneId`, overlays night/rain/moonlight/Christmas-tree temporary state, proves that canonical assets are not overwritten, and accepts the keyframe because structure remains stable even though appearance changes.
3. **Video C — auto-selection + drift**: resolves generic `their house` through Phase 11.9.7 structural auto-selection, reuses the kitchen zone and canonical asset, overlays temporary moving boxes, then proves Phase 11.9.6 still blocks structural drift.
4. **Video D — named isolation**: creates `Jones House` as a distinct location even when it is structurally similar to Miller House. Explicit named locations never use approximate auto-selection.
5. **Video E — fail-closed ambiguity**: presents a generic house that scores highly against both named houses; the selector returns `ambiguous` and creates no third location.

## Contracts validated

The test asserts that canonical `locationId`, zone IDs, identity fingerprints, canonical asset hashes, and origin provenance remain stable across later videos. Temporary state fingerprints are production/scene specific and never mutate the canonical location identity. Cross-video appearance differences may be tolerated only when a Phase 11.9.5 state is active; structural drift remains blocking.

It also validates the operator-facing Phase 11.9.7 snapshot: zones, assets, usage history, alias reuse, auto-selection reuse, ambiguous selection audit, and cross-video counts.

## Commands

After materialization:

```powershell
npm run test:location-system:e2e
```

To execute every Phase 11.9 regression command plus the E2E suite:

```powershell
npm run test:location-system:full
```

The materializer also executes the 11.9.8 E2E verifier as its final reusable-location gate. A regression in any cross-video invariant therefore fails materialization instead of silently shipping.

## Test boundaries

The suite is deterministic and provider-free. Canonical asset fixture files are local test bytes and the Phase 11.9.6 visual signatures are injected deterministically through its supported `signatureLoader` seam. This tests cross-video orchestration and fail-closed policy without pretending that an external image provider or Windows GPU path was exercised.
