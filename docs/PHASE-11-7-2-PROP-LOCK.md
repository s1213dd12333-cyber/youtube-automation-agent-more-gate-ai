# Phase 11.7.2 — Prop Lock Service

Phase 11.7.2 turns important environment objects into persistent continuity identities.

## Scope

This phase does **not** generate a canonical environment image and does **not** claim visual placement has been anchored. Master-frame anchoring belongs to Phase 11.7.3.

It does:

- consume `Environment Bible v11.7.1` signature elements;
- canonicalize furniture, fixtures, and recurring landmarks;
- distinguish source-backed props from inferred defaults;
- persist one lock per production/environment/prop;
- mark source-backed objects as required;
- assign continuity priority (`critical`, `high`, `medium`, `low`);
- persist locked identity attributes, allowed changes, and forbidden changes;
- record whether placement is still `unanchored_until_master_frame`;
- expose Prop Locks in the production bundle and Review Studio;
- keep stable fingerprints for deterministic Resume/materialization.

## Example

Input environment direction:

```text
Environment: a furnished wooden house with a beige sofa,
rustic wooden coffee table, bookshelf, large window and light rug.
```

Representative locks:

```text
sofa
  required: true
  priority: critical
  color: beige
  identity: locked

coffee table
  required: true
  priority: critical
  material: natural wood
  identity: locked

window
  required: true
  type: architectural_fixture
  placement: unanchored_until_master_frame
```

Profile defaults that were not actually present in the source remain optional/inferred instead of being presented as user-specified facts.

## Persistence

Table: `prop_locks`

Important fields:

- `production_id`
- `environment_id`
- `plan_fingerprint`
- `fingerprint`
- `prop_name`
- `prop_type`
- `required`
- `continuity_priority`
- `locked_attributes`
- `allowed_changes`
- `forbidden_changes`
- `source_type`
- `source_evidence`
- `placement_status`
- `master_frame_path`
- `status`

## Runtime contract

`PropLockV11.buildProductionLocks(production, environmentBible)` returns a deterministic plan whose fingerprint depends on the Environment Bible fingerprint and the stable lock identities.

A lock may preserve identity before a master image exists, but it must remain truthful about placement state:

```text
unanchored_until_master_frame
```

Phase 11.7.3 will convert that into master-frame-backed placement evidence.

## Environment variables

```env
PROP_LOCK_ENABLED=true
PROP_LOCK_MAX_PER_ENVIRONMENT=24
```

## Regression

```powershell
npm run test:prop-lock
```

The verifier covers deterministic IDs/fingerprints, source-backed vs inferred props, furniture/fixture types, locked attributes, persistence wiring, bundle exposure, pipeline integration, dashboard rendering, and environment settings.
