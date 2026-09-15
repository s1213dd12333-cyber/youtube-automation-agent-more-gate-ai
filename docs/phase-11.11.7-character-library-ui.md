# Phase 11.11.7 — Character Library UI + Operator Controls

Phase 11.11.7 adds an operator-facing library over the persistent-character stack from 11.11.1 through 11.11.6.

## Read-only canonical identity

The library exposes canonical character identity, identity fingerprint, origin, immutable `character_reference`, provider/model/hash provenance, appearance-state history, usage history, shot bindings and cross-video continuity decisions.

Operator controls do not edit `characterId`, `characterKey`, canonical identity, identity fingerprint, canonical asset bytes/hash/provider/model/origin, or the original Character Bible identity.

## Safe operator actions

The UI supports two explicit corrective actions:

1. add a non-canonical alias to an existing persistent character;
2. link an unresolved/ambiguous resolver audit to an existing `characterId`, optionally persisting the reference text as an alias.

Every action is recorded in `persistent_character_operator_actions` with actor, target, before/after snapshots, result and reason.

## Atomicity

Unlike the first Object Library implementation, character operator atomicity is part of the base 11.11.7 contract.

`savePersistentCharacterOperatorAlias()` performs a conditional insert so a concurrent operator cannot assign the same namespace/alias key to a different character after a pre-check.

`linkPersistentCharacterResolutionOperator()` uses compare-and-set semantics. A resolution may be linked only while it is unresolved/ambiguous, or when it is already resolved to that same character. A concurrent link to a different character wins safely and the later attempt returns conflict instead of retargeting the resolution.

This preserves the 11.11.2 resolver's legitimate ability to contain ambiguous aliases while making manual operator corrections exclusive and race-safe.

## API / asset safety

Read routes expose library snapshot, character detail and canonical character assets. Mutation routes require the existing `protect` middleware.

Canonical assets are served only when ready/canonical and only when their resolved path remains under:

`data/assets/character-library`

Path traversal or arbitrary filesystem serving is rejected.

## Dashboard

The dashboard adds a Character Library view with:

- search by name/key/alias/species;
- canonical-ready, cross-video and blocked filters;
- canonical reference preview;
- canonical identity JSON and fingerprint as read-only data;
- latest appearance state;
- production usage history;
- shot-binding count/history;
- cross-video continuity history;
- unresolved/ambiguous resolver review;
- alias creation and explicit resolver linking;
- operator audit history.

## Environment

```env
PERSISTENT_CHARACTER_LIBRARY_ENABLED=true
PERSISTENT_CHARACTER_OPERATOR_CONTROLS_ENABLED=true
PERSISTENT_CHARACTER_OPERATOR_ALIAS_ENABLED=true
PERSISTENT_CHARACTER_OPERATOR_LINK_ENABLED=true
```

## Validation

GitHub Actions on Windows Server 2025 / Node 24 validated the phase after the complete 11.11.1–11.11.6 chain.

`Phase 11.11.7 Character Library UI + Operator Controls OK: 71 regression checks passed.`

The same run also completed the full Phase 11.10 suite successfully.

## Completion boundary

11.11.1 through 11.11.7 are now implemented, materialized and Windows-validated. Phase 11.11.8 remains the deterministic multi-episode E2E closeout for the entire persistent-character system.
