# FASE 5 — Research Agent + Evidence Desk

Status: implemented in the overlay; Windows/runtime validation is still required.

## Goal

Move factual research out of ad-hoc strategy generation and create an explicit evidence boundary before expensive production work begins.

```text
Topic
  ↓
Research Agent v5
  ↓
Evidence Pack
  ↓
Script Writer
  ↓
Evidence Desk v5
  ↓
verified → save/checkpoint → thumbnail/SEO/production
blocked  → stop before expensive media generation
```

## Research Agent v5

The baseline implementation uses public, keyless research adapters:

- Wikipedia MediaWiki API — overview/reference evidence
- Crossref — scholarly metadata and abstracts when available
- OpenAlex — scholarly metadata and reconstructed abstracts when available

Existing seed sources from autonomous planning are retained, but a URL alone is **not** treated as verified claim evidence.

A source is marked `verified` for automated support checking only when the Research Agent actually retrieved evidence text (extract/abstract). Metadata-only sources remain `discovered`.

Wikipedia calls include an identifying User-Agent to avoid the anonymous-client behavior that previously produced 403 responses in the runtime.

## Evidence Pack

Each strategy checkpoint now carries `evidencePack` in addition to `researchSources`.

Important source fields:

```text
id
url
title
publisher
publishedAt
accessedAt
sourceType
sourceClass
adapter
status
evidenceText
notes
```

Source classes currently used by the ranking/claim gate:

- `official`
- `scholarly`
- `reference`
- `web`

The pack also records adapter availability and counts, so a degraded research run is visible rather than silently treated as complete.

## Evidence Desk v5

The Script Writer receives compact evidence excerpts, not URL-only source metadata. Its prompt requires every externally verifiable factual assertion in spoken content to be declared in `claims` and cite exact URLs from the Evidence Pack.

The Evidence Desk then checks each declared claim against the retrieved evidence text before `saveScript()`.

The current automated support check is deliberately transparent and deterministic:

- cited URL must exist in the Evidence Pack;
- source must contain retrieved evidence text;
- meaningful claim terms are compared with the evidence text/title;
- standard and high-risk claims use separate support thresholds;
- high-risk claims prefer scholarly/official evidence or multiple supporting sources.

This lexical score is an evidence-matching heuristic, **not** a claim that the software has proven scientific truth. Human review and provenance remain available later in the pipeline.

## Fail-closed behavior

Default:

```env
EVIDENCE_STRICT_MODE=true
```

If any declared factual claim is unsupported:

```text
EVIDENCE_CLAIMS_UNVERIFIED
HTTP/status semantics: 422
```

The script is blocked before persistence/checkpoint and before thumbnail, TTS, image, or video spending.

For controlled diagnostics only:

```env
EVIDENCE_STRICT_MODE=false
```

This allows a blocked review to pass through while retaining the audit evidence. It should not be used as the normal autonomous-production setting.

## Configuration

```env
EVIDENCE_STRICT_MODE=true
RESEARCH_MAX_SOURCES=12
RESEARCH_HTTP_TIMEOUT_MS=8000
EVIDENCE_STANDARD_THRESHOLD=0.24
EVIDENCE_HIGH_THRESHOLD=0.32
```

## Persistence

SQLite audit tables:

```text
research_evidence_packs
evidence_reviews
```

Research packs retain sources, adapter status, and summary counts. Evidence reviews retain the script hash, per-claim decisions, support evidence, and summary counts.

This allows later inspection even when a job is blocked.

## Recovery / old checkpoints

New jobs create the Evidence Pack inside the strategy checkpoint.

When an older pre-Phase-5 strategy checkpoint is reused, the pipeline researches the topic, attaches an Evidence Pack, and re-saves that strategy checkpoint before entering Script Writing.

## Provenance integration

`ProvenanceService` consumes the Evidence Desk's reviewed claims when available. A supported claim is therefore not reset to `pending` merely because the production entered the later review stage.

The existing provenance/human-review rules still apply.

## API

Job details now include:

```text
researchEvidence
evidenceReview
```

Dedicated endpoint:

```text
GET /api/jobs/:jobId/evidence
```

## Regression test

```powershell
npm run test:evidence
```

The suite uses fake HTTP responses for Wikipedia, Crossref, and OpenAlex. It makes no paid AI requests and verifies research, support matching, strict blocking, persistence wiring, checkpoint migration, ScriptWriter ordering, provenance reuse, and the evidence API.

## Known limits

- The automatic support matcher is lexical and conservative; paraphrases can require stronger evidence or human review.
- Metadata-only sources do not count as automated claim support.
- The baseline adapters do not yet include domain-specific official repositories such as NASA, NIST, NOAA, USGS, ESA, or Library of Congress. Those fit naturally into the later Visual/Research source-router work.
- Claim completeness depends on the Script Writer following the requirement to enumerate externally verifiable factual assertions in `claims`; a future claim-extraction pass can add an independent completeness check.
