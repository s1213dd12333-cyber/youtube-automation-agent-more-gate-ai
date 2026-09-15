# Phase 11.10 — Persistent World Objects / Cross-Video Object Continuity

Phase 11.10 extends the reusable-location system into persistent story-world objects. A recurring car, phone, weapon, book, piece of furniture or other explicitly persistent prop keeps one canonical identity across videos while location, lifecycle state, scene presence and camera/framing remain separate concerns.

## Roadmap status

1. **11.10.1 — Persistent World Object Registry — complete**
   - production-independent `objectId` / `objectKey`;
   - stable canonical identity fingerprint and provenance;
   - temporary scene props excluded;
   - explicit-key identity conflicts fail closed.
2. **11.10.2 — Object Aliases + Resolver — complete**
   - exact key / alias / normalized exact-name precedence;
   - generic contextual references resolve only when one compatible object remains;
   - no broad fuzzy merge.
3. **11.10.3 — Canonical Object Assets — complete**
   - one immutable provider-backed `object_reference` per object;
   - SHA-256/provider/model/origin persisted;
   - later videos cannot silently replace the anchor.
4. **11.10.4 — Object State / Lifecycle — complete**
   - `scene` versus `until_changed` state;
   - durable state inheritance and explicit durable reset;
   - state never rewrites canonical identity/assets.
5. **11.10.5 — Scene / Shot Object Binding — complete**
   - explicit `visible`, `occluded`, `offscreen`, `mentioned` semantics;
   - narrative mention alone never creates visual presence;
   - binding changes participate in shot/scene fingerprints.
6. **11.10.6 — Cross-Video Object Continuity Gate — complete**
   - only resolved visual bindings are checked;
   - explicit missing/replacement/identity/state drift blocks before `ready`.
7. **11.10.7 — Object Library UI + Operator Controls — complete + hardened**
   - read-only canonical identity/asset surface;
   - audited alias creation and explicit resolver linking;
   - atomic compare-and-set hardening prevents concurrent operator races.
8. **11.10.8 — E2E Cross-Video Object Tests — implemented**
   - deterministic integrated test over the materialized runtimes from 11.10.1 through 11.10.7;
   - 93 regression assertions across eight productions A–H;
   - automatically executed as the final 11.10 bootstrap gate.

## Identity boundary

Canonical identity is owned by 11.10.1. Location/zone is usage context for an explicitly keyed or owner-anchored object. Damage, cleanliness, open/closed state, contents, current holder, temporary placement and story state never become canonical identity fields.

11.10.2 resolves narrative references conservatively. Multiple compatible objects stay ambiguous. An existing `objectKey` with incompatible canonical attributes returns a conflict rather than mutating the original object.

## Canonical visual boundary

11.10.3 accepts only explicitly canonical provider-backed references. The first accepted file is stored under:

`data/assets/object-library/<namespace>/<objectId>/object_reference.<ext>`

Its hash and source provenance remain immutable across later videos. Local/generic fallback sources are never promoted.

## Lifecycle and presence boundary

11.10.4 treats state as an overlay. `scene` expires locally; `until_changed` may cross videos until another durable state/reset replaces it.

11.10.5 separately decides whether that object is present in each generated shot:

- `visible` — render the exact object;
- `occluded` — present but partly hidden;
- `offscreen` — relevant but must not be rendered;
- `mentioned` — reference-only and must not be hallucinated into frame.

## Cross-video visual gate

11.10.6 checks reused `visible` / `occluded` objects against the immutable canonical object reference. The semantic contract distinguishes framing/background changes from object identity changes.

Known failures include:

- `CROSS_VIDEO_OBJECT_MISSING`;
- `CROSS_VIDEO_OBJECT_REPLACED`;
- `CROSS_VIDEO_OBJECT_IDENTITY_DRIFT`;
- `CROSS_VIDEO_OBJECT_STATE_DRIFT`;
- `CROSS_VIDEO_OBJECT_CANONICAL_ASSET_MISSING`.

A blocking result occurs before a keyframe becomes `ready`.

## Operator controls and atomicity

11.10.7 exposes Object Library inspection for canonical identity, aliases, asset, lifecycle history, usages, shot bindings, continuity decisions and resolver/operator audits.

Canonical identity fields and canonical asset provenance remain read-only. Operator mutation is limited to safe alias creation and explicit linking of an unresolved/ambiguous resolver decision to an existing object.

The 11.10.7 hardening adds atomic guards specifically for operator actions. The regular 11.10.2 resolver may still preserve genuinely ambiguous aliases, but two concurrent dashboard actions cannot silently assign the same operator-confirmed alias/reference to different objects.

## 11.10.8 — integrated E2E matrix

The final verifier uses the real materialized 11.10 runtimes plus an in-memory persistence adapter and local fixture files. It performs no network/provider call; the semantic vision contract is supplied through the runtime's injected analyzer seam so gate orchestration is deterministic.

The eight-production matrix is:

- **A — origin:** register `miller_family_car`, seed EN/PT aliases, promote provider-backed canonical reference and audit origin binding.
- **B — alias + durable state:** `family car` resolves to the same `objectId`; a durable rear-dent state is added; a later canonical declaration cannot overwrite A's hash/provenance; continuity passes.
- **C — object movement:** the same explicit-key object moves to another location, keeps canonical identity, inherits durable damage and passes while `occluded`.
- **D — same-type isolation:** `jones_family_car` creates a second independent vehicle with its own canonical asset.
- **E — ambiguity/operator correction:** generic `their car` sees two compatible vehicles and fails closed; an audited operator explicitly links the reference to Miller's car; conflicting alias assignment to Jones is rejected.
- **F — reset/offscreen:** corrected alias reuses Miller's car; durable reset returns lifecycle state to neutral; `offscreen` is explicitly excluded from visual continuity checking.
- **G — replacement drift:** the neutral reset carries forward, but a different visible vehicle triggers replacement + identity-drift blocking.
- **H — canonical conflict:** reuse of `miller_family_car` with an incompatible canonical color is rejected without changing the original fingerprint or asset.

The suite additionally checks Object Library summaries, histories/audits, cross-video usage count, immutable hash/origin, resolver match modes and origin/pass/block continuity records.

## Commands

- `npm run test:persistent-world-object:e2e`
- `npm run test:persistent-world-object:full`

`test:persistent-world-object:full` runs the 11.10.1–11.10.7 dedicated verifiers and then the 11.10.8 integrated E2E verifier.

## Final materialization order

The final wrapper now requires, in order:

1. completed 11.9 location-system gate;
2. 11.10.1 registry + verifier;
3. 11.10.2 resolver + verifier;
4. 11.10.3 canonical assets + verifier;
5. 11.10.4 state/lifecycle + verifier;
6. 11.10.5 scene/shot binding + verifier;
7. 11.10.6 cross-video object gate + verifier;
8. 11.10.7 Object Library;
9. 11.10.7 operator atomicity hardening + verifier;
10. 11.10.7 main UI verifier;
11. 11.10.8 E2E materializer + integrated verifier.

A failure at any step prevents the closeout gate from completing.

## Closure status

The implementation of **11.10.1–11.10.8 is complete and the final E2E gate is wired into materialization**.

The 11.10.8 source, fixtures, Memory DB and final wrapper were syntax-checked during implementation. A full materialized execution of the 93-check integrated verifier was not available from the connected GitHub editing environment itself, so its pass result must come from an actual materialization run rather than being inferred from static inspection.
