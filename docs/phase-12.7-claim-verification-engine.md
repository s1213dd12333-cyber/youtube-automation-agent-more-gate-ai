# Phase 12.7 — Claim Verification & Evidence Synthesis Engine

## Purpose

Phase 12.6 answers **whether the newsroom has enough evidence to continue**. Phase 12.7 answers the stricter question: **which concrete factual claims are actually supported by that evidence, by which independent sources, and with what confidence?**

The phase is deliberately fail-closed. It never treats a topic title, a research question, a model inference, or a single source as a verified fact.

## Pipeline position

`Global News Radar → Event Intelligence → Editorial Brain → Global Importance → Editorial Planning → Autonomous Research 12.6 → Claim Verification 12.7 → Backlog / downstream Research & Provenance → Quality → Approval → Publishing`

Only an `EVIDENCE_READY` research run may enter claim verification. While 12.7 is enabled, automatic promotion requires a claim packet with status `VERIFIED`.

## Claim model

Each planned research question becomes a verification target. The engine searches the already-retrieved evidence text for the strongest source-bound sentence matching that target, then evaluates corroboration across independent domains.

A claim receives one of three statuses:

- `SUPPORTED` — sufficient independent corroboration and, when required by the editorial plan, primary/official support.
- `CONTESTED` — source evidence contains a material polarity conflict without enough corroboration to resolve it.
- `INSUFFICIENT` — not enough independent support, not enough lexical coverage, missing required official support, or confidence below policy.

The packet receives one of three statuses:

- `VERIFIED` — all claim targets are `SUPPORTED`.
- `NEEDS_RESEARCH` — too many claim targets remain insufficient.
- `BLOCK` — at least the configured number of claims is materially contested.

## Provenance

Every stored claim preserves:

- the research question that created the verification target;
- the exact evidence-bound claim sentence;
- independent supporting domains;
- supporting source URLs and source class;
- contradicting source URLs when present;
- short evidence excerpts and their polarity;
- deterministic claim and packet fingerprints.

The packet is immutable/idempotent for the same research snapshot. Re-running verification against the same evidence reuses the same persisted packet.

## Safety and neutrality

The engine does not decide truth from source popularity, political actor identity, or editorial preference. Thresholds operate on source independence, evidence overlap, source class, corroboration, contradiction and confidence. Identical evidence and requirements produce identical verification outcomes regardless of named political actor.

A contradiction signal is conservative: it identifies opposing polarity in relevant evidence; it does not infer motive, intent, deception or culpability.

## Promotion gate

When enabled:

- 12.6 must be `EVIDENCE_READY`;
- 12.7 must be `VERIFIED`;
- only then may automatic newsroom promotion continue.

The resulting backlog rationale records the claim-verification summary. Existing Research & Provenance, factual quality, approval and publishing gates remain mandatory and are not bypassed.

## API

Protected endpoints:

- `GET /api/newsroom/claims/status`
- `GET /api/newsroom/claims/packets`
- `GET /api/newsroom/claims/packets/:packetId`

## Environment

```env
NEWSROOM_CLAIM_VERIFICATION_ENABLED=true
NEWSROOM_CLAIM_MIN_SUPPORTING_DOMAINS=2
NEWSROOM_CLAIM_MIN_TOKEN_COVERAGE=0.22
NEWSROOM_CLAIM_MIN_CONFIDENCE=62
NEWSROOM_CLAIM_INSUFFICIENT_RATIO=0.45
```

## Validation

The dedicated regression command is:

```powershell
npm run test:claim-verification
```

The canonical `materialize.ps1` chain applies 12.7 after 12.6 and runs the 12.7 verifier before returning control to the caller.
