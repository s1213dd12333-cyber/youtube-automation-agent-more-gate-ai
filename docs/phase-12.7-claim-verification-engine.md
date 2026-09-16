# Phase 12.7 — Evidence / Truth Engine

## Purpose

Phase 12.6 answers whether the newsroom has enough retrievable evidence to continue. Phase 12.7 answers the stricter question: **what truth state may be assigned to each concrete claim supported by that evidence?**

The engine is deliberately fail-closed. Repetition is not truth, a headline is not proof, and a single source is not silently promoted into a confirmed fact.

## Pipeline position

`Global News Radar → Event Intelligence → Editorial Brain → Global Importance → Editorial Planning → Autonomous Research 12.6 → Evidence / Truth 12.7 → Backlog → Research & Provenance → Quality → Approval → Publishing`

Only an `EVIDENCE_READY` 12.6 run may enter 12.7. While 12.7 is enabled, automatic promotion requires a packet with status `VERIFIED`.

## Seven claim classifications

Every planned research question becomes a truth-verification target. The engine binds the target to exact sentences from already retrieved evidence and classifies the resulting proposition as one of:

- `confirmed` — independently corroborated across the configured minimum number of distinct domains, no material independent contradiction, required primary/official support satisfied, and confidence above threshold;
- `reported` — source-bound reporting exists, but the claim is not sufficiently corroborated to be treated as confirmed;
- `claimed` — the evidence explicitly presents the proposition as an attributed assertion/allegation/claim rather than an established fact;
- `disputed` — independently sourced evidence materially conflicts on the proposition;
- `unverified` — some relevant evidence exists, but it is too weak or too narrow for confirmation;
- `false` — a weak proposition is contradicted by stronger independent evidence including authoritative official/scholarly contradiction;
- `unknown` — no relevant evidence sentence can be bound to the verification target.

These labels are evidence states, not judgments about motive, intent, competence, or character.

## Repetition is not corroboration

Independent support is counted by canonical source domain, not number of URLs or number of syndicated copies. Ten pages from the same domain still count as one supporting domain. Therefore repeated publication cannot mechanically turn `reported`, `claimed`, or `unverified` material into `confirmed`.

## Packet gate

The packet status is deterministic:

- `VERIFIED` — every mandatory claim is `confirmed`;
- `NEEDS_RESEARCH` — at least one claim remains `reported`, `claimed`, `unverified`, or `unknown`, with no blocking claim;
- `BLOCK` — at least the configured number of claims are `disputed` or `false`.

Only `VERIFIED` can auto-promote while the engine is enabled.

## Provenance

Every persisted claim retains:

- research question;
- exact source-bound claim sentence;
- classification and reason;
- confidence score;
- supporting domains and sources;
- contradiction domains and sources;
- short evidence excerpts with support/contradict polarity;
- deterministic claim fingerprint.

The packet retains exact classification counts and an immutable packet fingerprint bound to the 12.6 research snapshot.

## Neutrality discipline

Truth classification uses source independence, lexical evidence overlap, source class, corroboration, contradiction and confidence. Actor metadata, popularity, editorial preference, or how many times a claim is repeated do not change the rules.

For contested public or political claims, `reported`, `claimed`, `disputed`, `unverified`, `false`, and `unknown` remain explicit evidence states; the system does not rewrite them into a preferred conclusion.

## Downstream safety

12.7 does not replace Phase 5 Research & Provenance, the factual quality gate, operator approval, or publishing controls. It is an additional upstream truth gate. Even a `VERIFIED` packet must pass the existing downstream production safeguards.

## API

Protected endpoints:

- `GET /api/newsroom/claims/status`
- `GET /api/newsroom/claims/packets`
- `GET /api/newsroom/claims/packets/:packetId`

## Dashboard

Global Newsroom gains `EVIDENCE / TRUTH 12.7`, showing packet status, confidence and counts for all seven claim classifications, plus per-claim reason and provenance domains.

## Environment

```env
NEWSROOM_CLAIM_VERIFICATION_ENABLED=true
NEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS=2
NEWSROOM_CLAIM_MIN_TOKEN_COVERAGE=0.22
NEWSROOM_CLAIM_MIN_CONFIDENCE=62
NEWSROOM_CLAIM_UNRESOLVED_RATIO=0.01
```

## Validation

After materialization:

```powershell
cd upstream
npm run test:claim-verification
```

The verifier explicitly proves all seven classifications, same-domain repetition resistance, strict packet gating, deterministic persistence, actor-metadata neutrality, protected APIs, and downstream Research & Provenance preservation.
