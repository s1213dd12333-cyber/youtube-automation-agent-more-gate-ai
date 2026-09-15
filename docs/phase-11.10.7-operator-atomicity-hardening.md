# Phase 11.10.7 — Operator Atomicity Hardening

This hardening preserves the Phase 11.10.2 rule that ordinary resolver aliases may legitimately be ambiguous while making **manual operator corrections race-safe**.

## Why this exists

The Object Library originally performed a read-before-write collision check for operator aliases and explicit resolver links. That is fail-closed for normal sequential use, but two concurrent operator requests could both observe the same pre-write state before either mutation became visible.

The global alias table intentionally cannot use `UNIQUE(namespace, alias_key)`, because Phase 11.10.2 needs to represent real ambiguity across different persistent objects.

## Atomic operator alias assignment

`savePersistentWorldObjectOperatorAlias()` uses one conditional SQLite insert for operator-created aliases. The insert proceeds only when no row with the same namespace/alias key belongs to a different object.

This does **not** change ordinary resolver alias behavior. It only hardens operator mutations.

If another operator wins the race, the losing request returns a conflict and is audited rather than creating a second operator assignment.

## Atomic explicit resolver linking

`linkPersistentWorldObjectResolutionOperator()` uses a compare-and-set update. A resolution can be changed when it is still `unresolved`/`ambiguous`, or when it is already resolved to the same target object.

If another operator links the row to a different object first, the second update no longer matches the SQL predicate. The current winner is preserved and the losing action returns `resolution_concurrently_linked_to_different_object`.

## Materialization gate

`bootstrap/phase11-location-library-ui.js` now performs this order for 11.10.7:

1. materialize Object Library UI + operator controls;
2. syntax-check atomicity hardening and its verifier;
3. apply atomicity hardening;
4. run the dedicated atomicity regression verifier;
5. rerun the main 11.10.7 verifier.

The hardening therefore becomes part of the required materialization path rather than an optional patch.

## Boundary

Canonical object identity, canonical asset SHA/provider/provenance, object key assignment and merge/delete remain read-only from the 11.10.7 operator surface.

Phase 11.10 still remains open until **11.10.8 — E2E Cross-Video Object Tests** is completed.
