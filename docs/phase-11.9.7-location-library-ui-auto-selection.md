# Phase 11.9.7 — Location Library UI + Auto Selection

Phase 11.9.7 turns the Reusable Location Library into an operator-visible system and adds conservative automatic reuse for generic location references that Phase 11.9.4 cannot resolve exactly.

## Resolution order

Location reuse remains fail-closed:

1. Phase 11.9.1 exact identity fingerprint;
2. Phase 11.9.4 persisted alias / normalized named entity / exact safe resolver rules;
3. Phase 11.9.7 automatic structural ranking for generic references only;
4. create a new reusable location only when no safe existing candidate is selected.

Explicit named references such as `Jones House` never use approximate auto-selection. They require the exact resolver so two structurally similar named houses cannot be merged.

## Automatic selection

The selector scores only stable canonical identity dimensions:

- construction;
- architectural style;
- materials;
- palette;
- layout;
- signature elements;
- required canonical props.

It does not score time of day, weather, temporary clutter, characters, camera language, or Phase 11.9.5 temporary state.

Defaults:

```env
REUSABLE_LOCATION_AUTO_SELECTION_ENABLED=true
REUSABLE_LOCATION_AUTO_SELECTION_MIN_SCORE=0.78
REUSABLE_LOCATION_AUTO_SELECTION_MIN_MARGIN=0.12
REUSABLE_LOCATION_AUTO_SELECTION_MIN_EVIDENCE_DIMENSIONS=3
```

A candidate is reused only when the top score clears the threshold, enough stable evidence dimensions exist, and the winner is separated from another qualifying candidate by the configured margin. Close candidates return `ambiguous`; weak evidence returns `unresolved`.

Every production-backed decision is stored in `reusable_location_auto_selections`. A resolved/ambiguous final auto-selection also updates the existing Phase 11.9.4 resolution audit with match mode `library_auto_select` or `library_auto_select_ambiguous`.

## Location Library UI

The dashboard gains a `Location library` view with:

- reusable location count and canonical-ready status;
- persistent zones/rooms;
- aliases;
- canonical location and zone assets;
- usage history across productions;
- search and status/type filters;
- recent automatic selection decisions and confidence margins.

Canonical image previews are served only through `/api/location-library/assets/:assetId` and only when the stored asset resolves inside `data/assets/location-library`.

Read APIs:

```text
GET /api/location-library
GET /api/location-library/:locationId
GET /api/location-library/assets/:assetId
```

A protected diagnostic endpoint can preview the selector without writing a production decision:

```text
POST /api/location-library/auto-select/preview
```

## Apply and verify

Apply Phases 11.9.1–11.9.6 first, then:

```powershell
node ..\bootstrap\phase11-location-library-ui.js
npm run test:location-library-ui
```

The verifier covers scoring, ambiguity margins, explicit-name safety, low-evidence behavior, audit persistence, Reusable Location Library integration, API routing/path safety, dashboard navigation/filter/detail wiring, configuration, snapshot data, and disabled mode.
