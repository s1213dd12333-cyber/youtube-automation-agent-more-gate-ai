# FASE 4 — AI Provider Router + Usage & Quota Center

Status: implemented in the overlay; Windows runtime validation is still required.

## Goals

- Preserve the currently selected text provider by default.
- Offer opt-in automatic provider failover for transient/network/quota-zero failures.
- Capture provider-reported token usage without inventing missing token counts.
- Track non-token resources separately (currently scene TTS characters and generated audio seconds).
- Surface provider health, token consumption, request failures, latency, and known/configured remaining headroom.
- Associate text usage with generation job and pipeline stage through AsyncLocalStorage.

## Modes

### Explicit (default)

```env
AI_PROVIDER_MODE=explicit
```

Only the selected/configured provider is used. A provider failure is surfaced normally.

### Auto router

```env
AI_PROVIDER_MODE=auto
AI_ROUTER_STRATEGY=free_first
AI_PROVIDER_ORDER=groq,gemini,nvidia,openrouter,cerebras,openai,kimi,mimo,glm
```

Supported routing strategies:

- `free_first`
- `fastest`
- `quality`
- `balanced`

`AI_PROVIDER_ORDER` overrides the built-in strategy order when supplied.

In auto mode each provider uses its own configured/default model. A caller model override is not carried across providers during failover.

## Failover policy

Eligible for automatic failover:

- network failures such as timeout/reset/DNS resolution failures
- HTTP 408, 409, 425, 429
- HTTP 5xx
- explicit quota-zero responses

Not silently routed around:

- HTTP 400
- HTTP 401
- HTTP 403
- HTTP 404
- HTTP 422

A failed eligible provider enters a process-local cooldown. Quota-zero responses use a longer cooldown.

```env
AI_PROVIDER_COOLDOWN_MS=60000
AI_QUOTA_COOLDOWN_MS=3600000
```

The circuit state resets when the Node process restarts.

## Usage evidence

Text providers store, when supplied by the provider response:

- input tokens
- output tokens
- reasoning tokens
- total tokens
- provider
- model
- pipeline operation/stage
- generation job id when available
- production id when available
- latency
- request success/failure
- rate-limit remaining/limit/reset headers when available
- error code

If a provider does not return token usage, the event is stored with zero token counters and `usageReported=false`. The system does not estimate or fabricate token usage.

Scene TTS is stored as a separate `tts` resource:

- characters submitted (`inputUnits`)
- measured audio seconds (`outputUnits`)
- provider/model
- scene/chunk metadata
- success/failure

Image/video/YouTube quotas are not represented as text tokens. Additional resource adapters can be added later without changing the text-token accounting model.

## Remaining quota

The system uses this priority:

1. provider rate-limit/quota header captured from the request, when exposed;
2. local budget configured by the operator;
3. `unknown`.

It never treats an undocumented provider plan limit as known.

Example local budgets:

```env
GROQ_DAILY_TOKEN_BUDGET=500000
GEMINI_DAILY_TOKEN_BUDGET=250000
NVIDIA_DAILY_TOKEN_BUDGET=1000000
OPENROUTER_DAILY_TOKEN_BUDGET=250000
CEREBRAS_DAILY_TOKEN_BUDGET=250000
OPENAI_DAILY_TOKEN_BUDGET=250000
```

Warnings:

```env
AI_BUDGET_WARNING_PERCENT=80
AI_BUDGET_CRITICAL_PERCENT=95
```

The current dashboard budget comparison is based on the selected usage window (24 hours in the main dashboard), so these values should be treated as operator guardrails rather than authoritative provider billing limits.

## Persistence

SQLite table:

```text
ai_usage
```

Important fields:

```text
job_id
production_id
provider
model
operation
resource_type
input_tokens
output_tokens
reasoning_tokens
total_tokens
input_units
output_units
estimated_cost
request_status
latency_ms
rate_limit_remaining
rate_limit_limit
rate_limit_reset
error_code
metadata
created_at
```

`estimated_cost` remains nullable unless reliable pricing evidence is available. Provider invoices/dashboards remain authoritative for billing.

## API

```text
GET /api/ai/usage?hours=24
```

The dashboard aggregate also includes `aiUsage`.

## Dashboard

A new **AI usage** view displays:

- token count for the selected window
- request count
- errors
- average latency
- provider-level usage
- remaining quota/headroom source
- local budget and utilization when configured

## Regression test

```powershell
npm run test:ai-usage
```

The regression suite uses fake providers and does not make paid API requests.

## Materialization

FASE 4 is applied after FASE 1, FASE 2, and FASE 3 so it can attach usage context to the normalized pipeline and scene TTS service.
