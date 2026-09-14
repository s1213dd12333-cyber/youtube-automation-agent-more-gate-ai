# FASE 1 — Content Contracts and Normalizers

## Objective

Stop raw or inconsistent AI output from flowing through the generation pipeline. Strategy and script artifacts now cross a canonical contract boundary before they are formatted, persisted, checkpointed, reused, or handed to later stages.

## Canonical contracts

The materializer installs `upstream/utils/content-contracts.js` from `bootstrap/templates/content-contracts.js`.

Published contracts:

- `lumen.strategy.v1`
- `lumen.script.v1`

Both expose JSON-Schema-style metadata plus runtime normalizers and validators.

## Strategy normalization

`normalizeStrategy()` guarantees structural defaults for:

- `topic`
- `contentType`
- `keywords`
- `researchSources`
- `requestedLengthKey`
- `requestedLength`
- `competitorAnalysis`
- channel/editorial context fields

Research sources are de-duplicated and invalid non-HTTP(S) URLs are rejected from the canonical artifact.

## Script normalization

`normalizeScript()` canonicalizes provider/model variations, including:

- string or object hooks
- string or object introductions
- `mainContent.sections` or top-level `sections`
- string or array section content
- `steps`, `items`, and `points`
- `conclusion.recap`
- `conclusion.keyPoints`
- summary-only conclusions
- string or object CTAs
- claims and source URL arrays
- keywords and duration defaults

A conclusion received as `keyPoints` is also materialized as `recap`, and vice versa, so downstream code no longer depends on provider-specific naming.

## Fail-closed behavior

Normalization repairs known shape variations but does not invent missing core content. The contract fails closed when required semantic structure is absent, including:

- missing strategy topic
- missing script title
- missing hook text
- empty main content
- sections without spoken content
- conclusion with no usable summary/recap/key points/final thought

Contract failures use error code `CONTENT_CONTRACT_INVALID` and include explicit issue details.

## Pipeline integration

### ContentStrategyAgent

Strategies are normalized and validated before `saveContentStrategy()`.

### ScriptWriterAgent

Scripts are normalized and validated before `formatFullScript()`. This prevents formatters from being the first place malformed AI output is discovered.

### GenerationRecoveryService

New strategy/script artifacts are normalized before checkpoint persistence.

Completed legacy checkpoints are normalized again when reused. If repair succeeds, the canonical artifact is written back to the checkpoint. If repair fails, the checkpoint is invalidated and the stage is regenerated.

### MainAgent

Non-job generation paths also cross `normalizeGenerationArtifact()` so bypassing the recovery service does not bypass the contract.

Research sources are resolved inside the strategy stage producer so they are part of the strategy checkpoint rather than being appended only after checkpoint completion.

## Regression checks

The materializer runs:

```powershell
node ..\bootstrap\verify-phase1-contracts.js
```

The materialized upstream package also exposes:

```powershell
npm run test:contracts
```

The regression suite covers:

1. strategy normalization and source de-duplication
2. legacy `keyPoints` → `recap` repair
3. alternate top-level `sections` model shape
4. summary-only conclusion repair
5. fail-closed invalid scripts
6. stage-boundary normalization
7. published schema identifiers
8. integration markers in Strategy, ScriptWriter, Recovery, and MainAgent

## Completion criteria

FASE 1 is technically complete when `materialize.ps1` succeeds and prints:

```text
Phase 1 content contracts OK: 7 regression checks passed.
```

At that point the canonical contract is active for both new and resumed generation jobs.
