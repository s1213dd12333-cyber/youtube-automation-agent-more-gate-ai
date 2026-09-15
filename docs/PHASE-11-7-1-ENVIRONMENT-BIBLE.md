# Phase 11.7.1 — Environment Bible Service

Phase 11.7.1 adds persistent location identity to the cartoon pipeline. It does **not** generate a master environment image yet and it does **not** claim object-level Prop Lock. Those boundaries remain Phase 11.7.2 and 11.7.3.

## Goal

Turn environment direction such as:

```text
Environment: uma casa mobiliada feita em madeira, aconchegante,
com sofa bege, mesa rustica, estante, tapete e janelas grandes.
```

into a stable structured asset such as:

```text
env_house_<stable fingerprint>
```

with persistent architecture, materials, palette, lighting, layout identity, signature elements, forbidden redesign rules, source evidence, and a deterministic fingerprint.

## Runtime

Materialized runtime:

```text
utils/environment-bible-v11.js
```

Version:

```text
11.7.1
```

The service is deterministic and makes no network or paid provider call.

## Stored environment fields

Each environment contains:

- `environmentId`
- `name`
- `category`
- `description`
- `construction`
- `architecturalStyle`
- `palette[]`
- `lighting`
- `layout`
- `materials[]`
- `zones[]`
- `signatureElements[]`
- `forbiddenChanges[]`
- `sourceEvidence[]`
- `inferredDefaults[]`
- `specificity`
- `masterFramePath`
- `status`
- `fingerprint`

`masterFramePath` is deliberately `null` in 11.7.1. A non-null canonical master reference must only be produced by the later Master Environment Generator.

## Current recognized location families

The deterministic baseline recognizes:

- house / home / cabin / cottage
- garden / backyard
- forest / woodland
- classroom
- kitchen
- bedroom / nursery
- playground

Explicit `Environment:`, `Setting:`, `Location:`, `Scene Location:` and `Background:` instructions take precedence over inferred production text.

## Persistence

SQLite table:

```text
environment_bibles
```

The production bundle exposes:

```text
environmentBible
```

A new row is persisted only when the deterministic Environment Bible fingerprint changes.

## Review Studio

The dashboard renders `ENVIRONMENT BIBLE V11.7.1` with category, stable environment ID, construction, materials, signature elements, specificity, and an explicit `master frame: pending 11.7.3` status.

## Environment variables

```env
ENVIRONMENT_BIBLE_ENABLED=true
ENVIRONMENT_BIBLE_MAX_ENVIRONMENTS=12
```

## Regression command

```powershell
npm run test:environment-bible
```

Expected output:

```text
Phase 11.7.1 Environment Bible OK: 40 regression checks passed.
```

The exact count should only change when assertions are deliberately added or removed.

## Completion boundary

Phase 11.7.1 is complete when a production can deterministically derive, persist, reload and display a structured environment identity. It is **not** evidence that generated images already preserve that environment visually.

Visual preservation requires the later chain:

```text
11.7.1 Environment Bible
→ 11.7.2 Prop Lock
→ 11.7.3 Master Environment Frame
→ 11.7.4 Scene-to-Environment Mapping
→ 11.7.5 Prompt Enrichment
→ 11.7.6 Environment Continuity Validation
```
