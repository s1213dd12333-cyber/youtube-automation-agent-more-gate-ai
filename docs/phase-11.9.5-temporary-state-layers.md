# Phase 11.9.5 — Temporary State Layers

Phase 11.9.5 separates permanent reusable-location identity from scene-only state.

A house/room keeps the same `locationId`, `zoneId`, canonical fingerprints, Prop Locks, and canonical assets while a scene may overlay transient facts such as:

- time of day (`morning`, `night`, etc.);
- weather (`rain`, `storm`, `snow`, `fog`, etc.);
- temporary lighting (`lights_off`, `tv_glow`, candlelight, etc.);
- temporary props (Christmas tree/decorations, balloons, moving boxes, candles, scattered toys, dirty dishes);
- temporary changes (door/window open or closed, messy/cleaned state, renovation).

## Persistence

`reusable_location_state_layers` stores one state overlay per production scene. It points at the resolved reusable `locationId` and, when available, the stable `zoneId` from 11.9.2.

The state has its own `state_fingerprint`; this fingerprint is intentionally separate from canonical location/zone identity. A scene that changes from day to night or clear to rainy therefore changes its state fingerprint without creating a new house or room.

## Fail-closed extraction

The runtime uses explicit scene metadata first and conservative text extraction second. Contradictory cues are omitted instead of guessed. Examples:

```text
"lights on" + "lights off"      -> neither lighting state is applied; conflict is recorded
"door open" + "door closed"    -> neither door state is applied; conflict is recorded
"morning" + "night"            -> timeOfDay stays unresolved; conflict is recorded
```

The system does not infer a missing state from the previous scene. State carry-forward is intentionally deferred to a future continuity layer so a rainy scene cannot silently make every later scene rainy.

## Prompt overlay

The Environment Prompt Enricher appends a `TEMPORARY LOCATION STATE V11.9.5` fragment after the canonical environment context. The fragment explicitly instructs generation to:

1. preserve canonical geometry, materials, furniture identity, Prop Locks and zone identity;
2. apply only the listed transient differences;
3. never promote temporary props/weather/lighting/clutter into canonical fingerprints or Prop Locks;
4. never carry the state into another scene unless explicitly present there.

Because the state fingerprint participates in each enriched shot fingerprint, a state change invalidates/rebuilds affected visual work without changing the reusable location identity.

## Configuration

```env
REUSABLE_LOCATION_TEMPORARY_STATES_ENABLED=true
```

## Apply and verify

Apply 11.9.1–11.9.4 first, then:

```powershell
node ..\bootstrap\phase11-temporary-location-state.js
npm run test:temporary-location-state
```

The verifier covers bilingual time/weather extraction, temporary props/changes, conflict handling, neutral-state isolation, location/zone reuse, SQLite persistence, pipeline ordering, prompt injection, shot fingerprint invalidation, dashboard wiring, and disabled mode.
