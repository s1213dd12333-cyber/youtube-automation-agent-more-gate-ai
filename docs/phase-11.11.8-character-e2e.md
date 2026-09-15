# Phase 11.11.8 — E2E Cross-Video Character Tests

Phase 11.11.8 closes the Persistent Character System by executing the final materialized runtimes from 11.11.1 through 11.11.7 together across a deterministic 10-production sequence.

## Final validation status

GitHub Actions run `35037307305` executed on Windows Server 2025 with Node 24 and completed successfully on commit `02ebfe451cd2f347ff0fc17e24e56c190b9abe23`.

The same run passed, in order:

1. complete overlay/upstream materialization and every bootstrap regression gate;
2. `npm run test:persistent-world-object:full` for the already-closed Phase 11.10;
3. `npm run test:persistent-character:full` for Phase 11.11.

The Phase 11.11.8 integrated test reported:

`Phase 11.11.8 Persistent Character E2E OK: 99 regression checks passed across 10 productions.`

The Phase 11.11 full suite contains 588 regression checks across the phase-specific verifiers:

- 11.11.1 Persistent Character Registry — 52;
- 11.11.2 Character Aliases + Resolver — 49;
- 11.11.3 Canonical Character Assets — 61;
- 11.11.4 Wardrobe / Appearance State — 86;
- 11.11.5 Scene / Shot Character Binding — 75;
- 11.11.5 binding hardening — 29;
- 11.11.6 Cross-Video Character Continuity Gate — 66;
- 11.11.7 Character Library UI + Operator Controls — 71;
- 11.11.8 integrated E2E — 99.

Total: **588 regression checks**.

## E2E production matrix

The deterministic A–J sequence validates the following contracts together rather than as isolated units.

### A — canonical origin

- creates Luna as a persistent character with explicit `characterKey`;
- seeds multilingual aliases;
- promotes a provider-backed immutable `character_reference`;
- binds Luna visibly through the Shot Planner cast;
- records the first production as `origin_production` instead of falsely claiming cross-video verification.

### B — exact alias reuse + durable appearance

- resolves `Coelhinha Luna` to the original `characterId`;
- attempts a later canonical image but proves that the original reference SHA/provider/origin remain immutable;
- applies a yellow raincoat and red backpack as `until_changed` appearance state;
- merges compatible explicit shot-binding declarations such as placement and expression;
- passes the cross-video character continuity gate.

### C — contextual generic reference

- resolves `the bunny` only while Luna is the unique compatible rabbit;
- proves that contextual generic resolution is not automatically promoted into a permanent alias;
- inherits the durable raincoat state;
- verifies the reused character successfully.

### D — second same-species character

- creates Nova as a distinct rabbit with its own `characterId` and immutable canonical reference;
- proves that same species does not imply identity merge.

### E — ambiguity + operator correction

- `the bunny` becomes ambiguous once both Luna and Nova exist;
- ambiguity fails closed and creates no third character;
- an operator explicitly links the resolver audit to Luna and may persist the phrase as an alias;
- assigning that alias to Nova is rejected;
- retargeting the already-resolved audit to Nova is rejected by compare-and-set semantics;
- operator actions remain auditable.

### F — scene-only wardrobe + stale-binding prune

- uses operator-confirmed `the bunny` alias to reuse Luna;
- applies `star pajamas` as a scene-only appearance state;
- changes a previously visible character to explicit `offscreen`;
- verifies that stale visible bindings are pruned from production persistence;
- proves that `offscreen` characters do not create a visual continuity requirement.

### G — durable state resumes after scene-only override

- proves that the durable yellow raincoat returns after the scene-only pajamas expire;
- binds Luna as `occluded` and therefore still subject to visual continuity;
- verifies the canonical character while carrying the inherited appearance-state fingerprint.

### H — durable reset + mentioned-only presence

- applies `clearState` with `until_changed`;
- creates a neutral durable reset so old wardrobe/carried items cannot later resurrect;
- uses `mentioned` presence and proves that it is excluded from visual verification.

### I — replacement / identity drift

- inherits the durable neutral reset;
- proves the old raincoat/backpack do not return;
- supplies a deliberately different rabbit to the vision analyzer;
- blocks the result with `CROSS_VIDEO_CHARACTER_REPLACED` and `CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT`;
- persists mismatch evidence and confidence.

### J — canonical-key identity conflict

- reuses `luna_main` with an incompatible canonical palette;
- fails closed instead of mutating Luna;
- proves only two canonical character identities exist;
- proves Luna's canonical identity fingerprint and `character_reference` SHA/origin remain unchanged.

## Character Library closeout assertions

The E2E also validates the 11.11.7 operator surface against the accumulated A–J history:

- alias and canonical reference history;
- durable and scene-only appearance states;
- durable reset;
- visual, occluded, offscreen and mentioned semantics;
- blocked cross-video continuity decisions;
- operator audit history;
- cross-video usage counts;
- one canonical reference per persistent character.

## Full regression commands

After materialization:

```bash
npm run test:persistent-character:e2e
npm run test:persistent-character:full
```

`test:persistent-character:full` executes the 11.11.1–11.11.7 verifiers, the 11.11.5 hardening verifier, and finally the 11.11.8 integrated E2E.

## Stack-aware verifier compatibility

The closeout also exposed one historical verifier assumption: 11.11.1 originally expected only the generic `explicit_character_key_identity_conflict` reason. In the final materialized stack, 11.11.2 may produce the more specific `canonical_attribute_mismatch:palette` for the same fail-closed conflict. The verifier now accepts either reason while still requiring exactly one conflict and zero new character creation.

## Completion boundary

**Phase 11.11 is complete.**

11.11.1 through 11.11.8 are implemented, materialized and Windows-validated. The phase now provides production-independent character identity, exact/conservative resolution, immutable canonical references, mutable appearance state, per-shot presence binding, cross-video visual continuity enforcement, audited operator controls and deterministic multi-episode regression coverage.
