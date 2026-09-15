# FASE 10 — Autonomia, observabilidade e publicação segura

Phase 10 closes the operational loop around the earlier content, evidence, scene, visual, usage and quality layers.

```text
topic / autonomous plan
  -> near-duplicate guard
  -> strategy + research + evidence
  -> script
  -> thumbnail + SEO
  -> scene-first production
  -> Quality Agents v9
  -> conservative repair when safe
  -> human approval when required
  -> schedule
  -> publish
  -> trace + usage + audit trail
```

## Persistent tracing

Every recoverable generation stage is wrapped in a Phase 10 span while Phase 4 continues recording AI-provider usage.

SQLite tables:

```text
autonomy_trace_spans
autonomy_events
```

A trace span records:

- trace ID
- parent span ID
- job / production / operator-run IDs when known
- stage and operation
- running/succeeded/failed status
- duration
- metadata
- error text
- start/end timestamps

The autonomous operator also records state transitions and automatic-repair events.

## Per-video usage

Phase 10 aggregates the existing Phase 4 `ai_usage` records for a production and its generation job. It reports tokens, non-token units, provider/resource grouping, requests, errors, latency and estimated cost only where Phase 4 has real evidence.

An absent provider price or token report is not replaced with an invented value.

API:

```text
GET /api/content/:productionId/observability
```

The response includes publication state, usage, trace spans and autonomy events.

## Topic library / near-duplicate protection

Automated scheduler/operator topics are checked against recent `content_strategies` and `generation_jobs` before a new job is created.

Default environment controls:

```env
TOPIC_NEAR_DUPLICATE_THRESHOLD=0.72
TOPIC_LIBRARY_WINDOW_DAYS=365
ALLOW_NEAR_DUPLICATE_TOPICS=false
```

The v10 similarity method is a deterministic token + bigram Dice proxy. It is useful for catching rephrasings of the same subject, but it is **not an embedding model and must not be described as full semantic understanding**.

A blocked automated topic fails with:

```text
SEMANTIC_TOPIC_DUPLICATE
HTTP 409
```

Manual jobs are not blocked by default. The novelty result can be inspected through:

```text
GET /api/topics/novelty?topic=...
```

## Conservative automatic repair

Default:

```env
AUTONOMY_AUTO_REPAIR=true
AUTONOMY_AUTO_REPAIR_MAX_ATTEMPTS=1
```

The default automatic mapping is deliberately narrow:

```text
SEO blocker -> resume from SEO once
```

SEO repair can reuse the existing script, thumbnail and scene media. Phase 2 then reuses completed scene media while the downstream quality gate is recalculated.

The following remain manual by default:

```text
Retention / Fact blocker -> Script repair required
Thumbnail blocker        -> Thumbnail/media action required
Visual blocker           -> Production/media or rights action required
Missing/stale media      -> Production/media action required
```

The reason is cost safety. A script change changes the scene-plan fingerprint and can legitimately trigger fresh narration, images and final video generation. Phase 10 does not spend those additional media-provider credits silently.

Completed generation jobs can only be reopened by the autonomous repair path when both an explicit repair stage and the internal `qualityRepair=true` flag are present. Ordinary callers cannot use the Phase 10 exception to replay arbitrary completed jobs.

The automatic repair attempt is persisted as autonomy events and can run at most once per planned item by default.

## Human approval remains authoritative

When `approval_required` is enabled, Phase 10 blocks both scheduling and YouTube publication until the persisted content review is `approved`.

It also blocks scheduling/publication when Phase 9 is `blocked`, in addition to the existing provenance, narration, readiness and media-rights gates.

This means an autonomous run can generate and perform the narrow safe repair above, but it cannot silently bypass the configured human approval boundary.

After a human approval, the associated autonomous operator run is reconciled automatically. A run that was `waiting_review` can therefore move to `completed` once all its produced videos are resolved.

Manual reconciliation is also available:

```text
POST /api/operator/:runId/reconcile
```

## Doctor

```powershell
npm run doctor
npm run doctor:strict
```

The doctor is intentionally local/non-networked. It checks persisted operational state such as:

- SQLite responsiveness
- latest Production Readiness result
- stale queued/running generation jobs
- ambiguous YouTube uploads requiring reconciliation
- unresolved editorial queue
- AI usage/errors over 24 hours

`doctor:strict` exits non-zero only when a blocking failure is detected.

API:

```text
GET /api/doctor
```

## Safe E2E inspection

```powershell
npm run e2e:safe
```

This command is non-mutating and does not call text/image/TTS providers or YouTube. It inspects the latest persisted production, doctor status, publication blockers, usage evidence and trace data.

It is deliberately **not** presented as proof that a live YouTube upload works. A real live end-to-end production/upload validation remains a separate operator-controlled action after the local/runtime suite passes.

## Regression suite

```powershell
npm run test:autonomy
```

The Phase 10 regression suite checks:

- deterministic near-duplicate scoring
- automated duplicate rejection
- publication blockers
- cost-safe automatic vs. manual repair mapping
- repair attempt limit
- scoped reopening of completed jobs for quality repair
- trace success/failure persistence
- publication-state reporting
- non-network doctor behavior
- SQLite trace/event schema
- generation-stage tracing integration
- autonomous operator reconciliation
- approval and Quality-Agent publication gates
- doctor / safe-E2E CLI commands

The regression test does not invoke paid providers or YouTube.

## Runtime validation boundary

Phase 10 is considered structurally installed when `materialize.ps1` and `npm run test:autonomy` pass. `npm run doctor` and `npm run e2e:safe` then validate the local persisted environment without network mutations.

A live production and YouTube upload are separate validations and should happen only after the approval, evidence, rights and readiness gates are green.
