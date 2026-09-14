# FASE 9 — Quality Agents

Phase 9 adds five deterministic editorial review agents before approval:

- Retention Agent
- Thumbnail Agent
- SEO Agent
- Visual Quality Agent
- Fact Quality Agent

The agents do not call a paid LLM. Their scores are reproducible heuristics built from the production bundle, Phase 5 evidence/provenance, Phase 7 VisualBriefs, Phase 8 media-rights records, and final packaging metadata.

## Pipeline

```text
completed production bundle
  -> Retention Agent
  -> Thumbnail Agent
  -> SEO Agent
  -> Visual Quality Agent
  -> Fact Quality Agent
  -> weighted quality report
  -> repair plan
  -> approval gate
```

The report is persisted before approval. Blocking findings make the existing content review enter `needs_attention`; advisory findings remain visible but do not automatically prevent operator approval.

## Weights

```text
Retention  25%
Thumbnail  15%
SEO        15%
Visual     20%
Fact       25%
```

The overall score is not a substitute for blockers. A production with a high weighted score can still be blocked by one critical rights or factual-evidence failure.

## Retention Agent

Checks include:

- usable opening hook
- hook length
- curiosity/open-loop signals
- long sections and pacing
- repeated-sentence fingerprints
- conclusion payoff connection to the opening/topic
- CTA presence

Severe repetition, a missing hook, or a very low category score can block approval.

## Thumbnail Agent

Checks include:

- thumbnail asset exists
- concrete concept metadata exists
- title/concept alignment
- text-overlay density
- generic attention-language risk

Missing thumbnail media is blocking.

## SEO Agent

First classifies the content as one of:

- `news`
- `trend`
- `tutorial`
- `comparison`
- `historical`
- `scientific`
- `evergreen`

Checks include title length, description depth, tags, topic/title alignment, unsupported clickbait, and false freshness.

Example blocked mismatch:

```text
Topic: gravitational time dilation / atomic clocks
Title: Atomic Clocks in 2026: What's Changed?
```

If the underlying topic/script does not actually contain a 2026-specific development, the temporal framing is treated as artificial freshness and blocks approval.

## Visual Quality Agent

Uses the scene manifest plus Phase 7/8 data:

- missing/stale/failed scene assets
- unresolved media rights
- VisualBrief accepted/rejected state
- average specificity
- average Generic-AI risk
- duplicated asset paths
- source/local-renderer mix

Rights failures and materially invalid visual plans are blocking.

## Fact Quality Agent

Uses Phase 5 evidence and provenance:

- provenance status
- unresolved factual claims
- declared claims without source URLs
- claims explicitly marked unsupported
- Evidence Desk blocked/failed status
- traceability from verified claims to verified evidence sources

Unresolved or unsupported factual claims are blocking.

## SQLite

Reports are stored in:

```text
quality_agent_reports
```

Each row records:

- production ID
- Phase 9 version
- production fingerprint
- status
- weighted overall score
- five agent reports
- blocking findings
- prioritized repair plan
- timestamp

The fingerprint prevents duplicate audit rows when the production has not changed.

## Review Studio

The production detail view shows:

```text
QUALITY AGENTS V9 · 84/100 · warning

Retention Agent       78/100
Thumbnail Agent       92/100
SEO Agent             85/100
Visual Quality Agent  81/100
Fact Quality Agent    88/100
```

For each category the highest-priority finding and next remediation are shown. The existing legacy quality checks remain visible beneath the Phase 9 report.

## Approval behavior

`OperatorService.runQualityChecks()` reloads the latest production bundle before Phase 9 runs. This is important because scene repairs, Visual Router provenance, Evidence Desk results, and rights status can change after the original production object was created.

Each blocking Phase 9 category is converted into the existing approval gate as:

```text
quality_retention
quality_thumbnail
quality_seo
quality_visual
quality_fact
```

This keeps Phase 9 compatible with the current review/approval workflow instead of introducing a parallel approval system.

## Regression test

```powershell
npm run test:quality-agents
```

The regression suite is deterministic and performs no paid provider calls.

## Important boundary

Phase 9 scores are editorial heuristics, not probabilities of truth or guaranteed YouTube performance. Factual validity remains evidence-driven through Phase 5; media rights remain controlled by Phase 8 metadata and operator confirmation; final publication still respects the configured human-approval gate.
