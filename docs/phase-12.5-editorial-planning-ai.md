# Phase 12.5 — Editorial Planning AI

Phase 12.5 converts the single story selected by the Phase 12.3 Autonomous Editorial Decision Brain, enriched by Phase 12.4 Global Importance, into an executable and auditable production plan.

## Position in the newsroom stack

`Global News Radar → Event Intelligence → Autonomous Editorial Decision Brain → Global Importance → Editorial Planning AI → Backlog → Research & Provenance → Script → Visual/Production → Quality/Approval → Publishing`

The planner does not decide factual truth and never bypasses downstream factual, quality, approval or publishing gates.

## Planning output

Each selected actionable story receives an immutable plan containing:

- action and provisional topic;
- neutral editorial angle;
- format: `breaking_brief`, `update_brief`, `follow_up_explainer`, `rapid_explainer`, `standard_explainer` or `deep_dive`;
- urgency;
- target duration;
- target audience;
- minimum independent research source count;
- primary/official-source requirement when the story is sensitive or globally/systemically important;
- explicit uncertainty-preservation and cross-source confirmation requirements;
- research questions;
- visual requirements such as map, timeline, data chart and document evidence;
- handoff instructions for research, script, visuals and publishing;
- policy revision and deterministic plan fingerprint.

## Selection behavior

Only a story actually selected by the 12.3 Decision Brain and mapped to `COVER`, `BREAKING`, `UPDATE` or `FOLLOW_UP` receives a plan. Deferred, waiting and ignored candidates do not consume planning work.

Default format behavior:

- `BREAKING` → four-minute `breaking_brief`;
- `UPDATE` → `update_brief` focused on material changes;
- `FOLLOW_UP` → `follow_up_explainer`;
- high structural importance with adequate confidence → `deep_dive`;
- fast-rising coverage below deep-dive criteria → `rapid_explainer`;
- otherwise → `standard_explainer`.

## Evidence discipline

The planner can increase research requirements but cannot lower the downstream Research & Provenance gate. Sensitive topics use a stricter source floor. Global/systemic impact can require a primary or official source when available.

Unverified, disputed or corrected claims must remain explicitly labeled. Generated visuals must not imply facts that have not been verified.

## Neutrality

Format, duration and research requirements are derived from action, structural importance, evidence confidence, velocity, event evolution and sensitivity signals. Political actor names, parties or ideological desirability are not scoring inputs. With identical evidence and impact signals, changing only the named political actor does not change the planning requirements.

## Persistence

Phase 12.5 adds:

- `newsroom_editorial_plan_policy_revisions`
- `newsroom_editorial_plans`

Plans are idempotent and immutable by deterministic fingerprint. The persisted plan is later linked to the exact backlog idea and newsroom assignment produced by promotion.

## Protected APIs

- `GET /api/newsroom/planning/status`
- `GET /api/newsroom/planning/plans`
- `GET /api/newsroom/planning/plans/:planId`
- `GET /api/newsroom/planning/policy`
- `POST /api/newsroom/planning/policy`

Policy changes require an actor and an audit reason.

## Default environment controls

```env
NEWSROOM_EDITORIAL_PLANNING_ENABLED=true
NEWSROOM_PLANNING_DEEP_DIVE_IMPORTANCE=78
NEWSROOM_PLANNING_RAPID_VELOCITY=80
NEWSROOM_PLANNING_ORDINARY_MIN_SOURCES=3
NEWSROOM_PLANNING_SENSITIVE_MIN_SOURCES=5
NEWSROOM_PLANNING_BREAKING_MINUTES=4
NEWSROOM_PLANNING_STANDARD_MINUTES=8
NEWSROOM_PLANNING_DEEP_DIVE_MINUTES=12
```

## Validation

The canonical Windows materializer runs the Phase 12.5 verifier during materialization. The workflow also reruns `npm run test:editorial-planning` after the complete overlay has been applied so regressions introduced by later patches cannot silently bypass the gate.
