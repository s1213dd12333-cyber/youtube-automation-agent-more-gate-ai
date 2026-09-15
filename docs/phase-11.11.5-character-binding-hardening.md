# Phase 11.11.5 — Character Binding Hardening

Phase 11.11.5 remains the Scene / Shot Character Binding contract. This hardening closes persistence and merge edge cases discovered during revalidation before Phase 11.11.6.

## Stale-binding replacement semantics

The base 11.11.5 binder persists the resolved binding set for each run. Revalidation identified that rows from an older shot plan could remain in `persistent_character_bindings` when a character was later removed from the cast or when a formerly valid binding became conflicted.

The hardening adds `pruneProductionPersistentCharacterBindings(productionId, keepIds)` and invokes it only after the current resolved binding set has been successfully persisted. Rows for the same production that are not in the current set are removed. An empty current set removes all prior bindings for that production.

This prevents a later continuity gate from seeing stale or ghost visual presence.

## Complementary explicit declarations

Multiple explicit declarations for one `characterId` and shot are now merged when their fields are compatible. For example, one declaration may define `placement=foreground` while another defines `expression=happy`; the resulting binding preserves both values and recomputes its binding fingerprint and prompt fragment.

Conflicting non-empty values for `visibility`, `placement`, `action`, or `expression` remain fail-closed and produce a binding conflict. Derived Shot Planner rows remain lower priority than explicit declarations.

## Validation

Windows Server 2025 / Node 24 validation on GitHub Actions confirmed:

- Phase 11.11.5 base verifier: 75 regression checks passed;
- Phase 11.11.5 hardening verifier: 29 regression checks passed;
- complete Phase 11.10 full suite remained green.

The hardening verifier specifically covers cast removal, conflict replacement, stale-row pruning, complementary explicit-field merging, prompt preservation, and fingerprint recomputation.

## Gate order

The main Phase 11 wrapper now runs:

1. Phase 11.11.5 materializer;
2. Phase 11.11.5 base verifier;
3. binding hardening syntax checks;
4. binding hardening patch;
5. binding hardening verifier.

Phase 11.11.6 must consume only the post-hardening persisted binding set.
