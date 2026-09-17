# Phase 12.12 — Self-Improvement Engine

## Goal

Turn operational failures, analytics anomalies, repeated quality issues, prompt weaknesses, rule gaps, and code defects into auditable improvement proposals without allowing the AI to rewrite production silently.

## Safety model

Every improvement is created as a proposal with evidence, confidence, risk, target, and explicit change data. Every proposal requires human approval.

Prompt and rule proposals remain proposals until approved by an operator. Code proposals have an additional hard gate: the engine cannot contact GitHub until the proposal status is `approved`.

After approval, a code proposal may:

1. read the configured base branch;
2. create a dedicated `self-improvement/...` branch;
3. write only the files contained in the approved proposal;
4. open a **draft pull request**;
5. rely on the repository's normal tests, GitHub Actions, review rules, and merge controls.

The engine deliberately has **no merge capability** and no production-branch write path. It cannot silently merge or deploy its own code.

## Observations

The engine stores structured observations in `newsroom_self_improvement_observations`:

- source;
- category;
- severity;
- fingerprint;
- summary;
- evidence;
- contextual metadata.

The analytics agent automatically emits observations for clearly weak post-publication signals such as low quality score, unusually low CTR, and weak retention. Other subsystems can submit diagnostics through the protected observation API.

## Proposals

`newsroom_self_improvement_proposals` stores three proposal kinds:

- `prompt` — prompt wording, constraints, examples, or grounding instructions;
- `rule` — deterministic thresholds, routing rules, gates, or policies;
- `code` — explicit file replacements intended for a guarded GitHub branch and PR.

Statuses are auditable: `proposed`, `approved`, `rejected`, `pr_open`, `merged`, and `closed`.

## GitHub execution

GitHub execution is opt-in and disabled by default:

- `SELF_IMPROVEMENT_GITHUB_ENABLED=false`
- `SELF_IMPROVEMENT_GITHUB_REPOSITORY=`
- `SELF_IMPROVEMENT_GITHUB_BASE_BRANCH=main`
- `SELF_IMPROVEMENT_GITHUB_TOKEN=`

Even when enabled, `openCodePullRequest()` refuses to run unless the proposal has explicit human approval.

The generated pull request is draft and contains the proposal ID, rationale, and risk. CI and repository branch protections remain authoritative.

## Protected APIs

- `GET /api/newsroom/self-improvement/status`
- `GET /api/newsroom/self-improvement/proposals`
- `POST /api/newsroom/self-improvement/observe`
- `POST /api/newsroom/self-improvement/proposals`
- `POST /api/newsroom/self-improvement/proposals/:id/approve`
- `POST /api/newsroom/self-improvement/proposals/:id/reject`
- `POST /api/newsroom/self-improvement/proposals/:id/open-pr`

## Validation

Run:

```bash
npm run test:self-improvement
```

The verifier proves that:

- proposals require human approval;
- an unapproved code proposal makes zero GitHub calls;
- an approved code proposal can create a branch and draft PR;
- the engine performs no merge request;
- the engine never updates the production branch directly;
- `mergeCapability` and `productionWriteCapability` remain false;
- analytics integration and persistence are materialized correctly.

## Completion criterion

Phase 12.12 is complete only when the canonical materializer, the dedicated verifier, and the full regression workflow all pass. The feature must remain proposal-driven, auditable, and incapable of silently integrating its own code changes.
