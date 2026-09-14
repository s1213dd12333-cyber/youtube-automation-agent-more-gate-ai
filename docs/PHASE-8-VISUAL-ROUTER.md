# FASE 8 — Visual Router + fontes reais

Phase 8 adds a source-first visual layer between the Phase 7 `VisualBrief` and generated/local imagery.

## Flow

```text
Scene
  -> Visual Director v7
  -> VisualBrief
  -> Visual Router v8
       -> real-source discovery
       -> relevance scoring
       -> license/rights gate
       -> local normalized cache
       -> provenance record
  -> if no eligible source asset:
       -> configured image provider
       -> local explanatory renderer
  -> scene asset
```

A reusable real-source asset must be both relevant to the scene and have a machine-recognizable rights basis. License metadata can never compensate for an irrelevant image.

## Direct source adapters in v8

The current implementation has direct adapters for:

- Wikimedia Commons — MediaWiki API
- NASA Image and Video Library — images API
- Library of Congress — JSON picture search
- Internet Archive — Advanced Search + metadata API
- USGS ScienceBase — catalog API

NIST, NOAA, and ESA are **not represented as direct adapters in v8**. When Phase 5 evidence identifies one of these institutions as a publisher, Phase 8 can use that institution name as a search hint (especially in Wikimedia Commons discovery), but the resulting media asset still needs its own explicit license/provenance record.

This distinction is intentional: evidence-source provenance is not the same thing as media reuse permission.

## Routing examples

Phase 8 starts with the Phase 7 visual type and scene text:

- `archival_timeline` -> Library of Congress, Internet Archive, Wikimedia Commons
- `location_map` / geography / geology -> USGS, Wikimedia Commons, NASA
- space, satellite, orbit, spacecraft -> NASA, Wikimedia Commons
- science/experiment/general documentary -> Wikimedia Commons first, then applicable institutional/archive adapters

If no real asset passes the relevance + rights gates, the system falls back to the configured image provider and then to the Phase 7 local renderer.

## Rights model: fail-closed

Default:

```env
VISUAL_ROUTER_ALLOW_REVIEW_REQUIRED=false
```

Automatically eligible in v8:

- Public Domain / recognized public-domain metadata
- CC0
- plain CC BY with explicit metadata

Not automatically eligible:

- CC BY-SA
- CC BY-NC
- CC BY-ND
- agency/source provenance without asset-level reusable-license evidence
- `No known restrictions` wording without a machine-verifiable license grant
- unknown or missing rights metadata

These assets may still be discovered as candidates, but the default router does not select them.

NASA/USGS provenance alone is therefore **not** treated as proof that every individual asset is unrestricted. The same rule applies to archive/institution names generally.

## Relevance gate

A candidate must first overlap meaningfully with the scene's `VisualBrief` subject/details. Rights metadata, source priority, and resolution only add ranking value after this minimum relevance condition is met.

The default final score threshold is:

```env
VISUAL_ROUTER_MIN_SCORE=0.34
```

The exact score is a deterministic routing heuristic, not a factual-truth probability. Factual claims remain governed by the Phase 5 Evidence Desk.

## Local cache

Selected remote source images are downloaded once for the production and normalized locally to a 1280x720 PNG under:

```text
data/assets/source-v8/<productionId>/
```

Downloads are restricted to an adapter-specific HTTPS host allowlist and bounded by:

```env
VISUAL_ROUTER_MAX_DOWNLOAD_BYTES=20971520
```

This avoids depending on external hotlinks during final assembly.

## Provenance and SQLite audit

Selected real-source media is persisted in:

```text
visual_asset_records
```

Each record includes:

- production ID
- scene ID
- router version
- source name/key
- source asset ID
- original source-page URL
- media URL
- local cached path
- title
- creator
- license
- license URL
- attribution
- rights status
- whether rights were machine-confirmed
- whether attribution is required
- relevance score
- query
- adapter/source metadata

Scene bundles expose the latest matching record as `scene.sourceAsset`.

The audit rows cascade with scene/production deletion so a script replan does not leave orphaned media records or block scene replacement.

## YouTube media credits

When routed assets are present, publication metadata appends a `Media credits / source assets` block to the YouTube description, including the original source-page URL and license URL when available.

Credits are deduplicated and constrained to YouTube's description length. This does not replace any additional legal obligations that a specific license may impose; the router only auto-uses the small license set described above.

## Review and approval gates

Media-rights checks now cover:

```text
uploaded
licensed-source
source
```

instead of checking only operator uploads.

A routed source asset with unresolved rights cannot silently pass scene rebuild/quality/Shorts gates.

The Scene Repair Studio shows the selected source, license, rights status, relevance score, and a link to the original source page.

## Environment

```env
VISUAL_ROUTER_ENABLED=true
VISUAL_ROUTER_ALLOW_REVIEW_REQUIRED=false
VISUAL_ROUTER_TIMEOUT_MS=7000
VISUAL_ROUTER_MAX_CANDIDATES=12
VISUAL_ROUTER_MIN_SCORE=0.34
VISUAL_ROUTER_MAX_DOWNLOAD_BYTES=20971520
```

Keep `VISUAL_ROUTER_ALLOW_REVIEW_REQUIRED=false` for autonomous production unless an explicit operator-review workflow for those license classes is added later.

## Regression test

```powershell
npm run test:visual-router
```

The regression suite uses mocked HTTP source responses and does not call paid image APIs.

## Legacy jobs

Phase 8 does not force already-completed legacy scene visuals to regenerate. Phase 7's existing protection remains:

```env
VISUAL_DIRECTOR_REFRESH_LEGACY_VISUALS=false
```

For a clean Phase 8 validation, use a new generation job. Enabling legacy visual refresh can trigger new media generation and should be done intentionally.
