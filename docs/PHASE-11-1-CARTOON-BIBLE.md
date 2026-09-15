# Phase 11.1 — Character Bible + Style Bible

Phase 11.1 is the first step of the Cartoon Visual Pipeline. It does not yet create multiple shots or keyframes. Its job is to make visual identity persistent before Phase 11.2 introduces shot planning.

## Runtime contract

When `CARTOON_VISUAL_MODE=auto`, the runtime activates only when the topic, per-video instructions, or script explicitly indicates children/cartoon/2D/storybook/animation content. Documentary/science productions continue through the Phase 7/8 path unchanged.

For cartoon productions the runtime creates and persists one `cartoon_visual_bibles` record per creative fingerprint. The record contains:

- character profiles with stable ids, roles, species/type, palette, proportions, face rules, expressions, poses, and continuity rules;
- a Style Bible with art direction, line style, palette, background, lighting, camera language, shape language, texture, and forbidden elements;
- a deterministic fingerprint so Resume reuses the same visual identity when the creative specification has not changed;
- prompt context injected into every Phase 7 VisualBrief before image generation.

## Cartoon routing

Cartoon frames intentionally bypass the Phase 8 documentary real-source router. This prevents a children's story from silently receiving NASA/Wikimedia/documentary photography. Phase 8 remains active for non-cartoon productions. The same exception is enforced in manual Scene Repair, so regenerating a cartoon frame cannot silently switch back to documentary source search.

Generated cartoon prompts use the `kids_cartoon_2d` style in `AIVideoGenerator` and explicitly require original characters, stable proportions, clean outlines, rounded child-safe shapes, consistent palette, readable expressions, simple layered backgrounds, and no photorealism/generic stock illustration.

## Persistence and review

The production bundle exposes `cartoonBible`. Review Studio renders the current Character Bible + Style Bible before the scene editor so an operator can verify the extracted cast and art direction before approval.

## Environment

```env
CARTOON_VISUAL_MODE=auto
CARTOON_BIBLE_ENABLED=true
```

`CARTOON_VISUAL_MODE` accepts:

- `auto`: activate only for detected cartoon/children requests;
- `force`: apply cartoon identity to every production;
- `off`: disable Phase 11.1.

## Regression command

```bash
npm run test:cartoon-bible
```

Expected result:

```text
Phase 11.1 Cartoon Bible OK: 29 regression checks passed.
```

## Completion boundary

Phase 11.1 is complete when the Windows materializer passes the regression suite and a real children's production persists a Character Bible + Style Bible that appears in Review Studio and is present in every generated visual prompt.

Phase 11.1 does **not** claim frame-by-frame animation. That starts in Phase 11.2 (Shot Planner) and Phase 11.3 (Keyframe Pipeline).
