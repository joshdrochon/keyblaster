/**
 * THE CANVAS HALF OF `glyphAdvance.ts`. The only file in the plate's spacing
 * path that touches the DOM.
 *
 * It exists as a separate module for the same reason `wordPlateGeometry.ts`
 * does: `glyphAdvance.ts` is imported by the geometry, the geometry is imported
 * by `@game/flight`, `@game/ui` and a dozen unit tests, and a `document`
 * reference anywhere on that path kills all of them under vitest's node
 * environment. The measurer is injected instead.
 *
 * ================== WHY IT MUST BE THE SAME FONT STRING ==================
 * Phaser's `TextStyle` sets `context.font` to `<fontStyle> <fontSize> <fontFamily>`
 * and then measures and draws with it. `fontStringOf` builds the same
 * `<size>px <family>`, so the advance this file reports is the advance the
 * renderer will actually step by. Anything that makes the two strings differ -
 * a font weight applied to the plate's Text and not here, a different size -
 * reintroduces the defect quietly, which is why the string is built in ONE
 * place (`glyphAdvance.fontStringOf`) and imported by both halves.
 *
 * ================== ONE CONTEXT PER MEASURER, AND NO MODULE STATE ==========
 * The context is made when the measurer is built and captured in its closure,
 * so the many `measureText` calls share one context while this module keeps no
 * state of its own. A module-level cached context was the first shape and it
 * was wrong for a boring reason: `canvasGlyphMeasurer()` is called once in the
 * product and repeatedly in its test, and a cached context outlived the DOM the
 * test had stood up, so the "there is no DOM here" case could not be reached at
 * all. A guard that cannot reach the case it guards is not a guard.
 */

import { installGlyphMeasurer, type GlyphMeasurer, fontStringOf } from "./glyphAdvance.js";

function measuringContext(): CanvasRenderingContext2D | null {
  try {
    if (typeof document === "undefined") return null;
    return document.createElement("canvas").getContext("2d");
  } catch {
    // A context is not obtainable in every environment (no DOM, a browser that
    // has run out of canvas contexts). Answering "I do not know" lets
    // `glyphAdvancePx` fall through to its table instead of throwing out of a
    // layout call.
    return null;
  }
}

/**
 * A `GlyphMeasurer` backed by `measureText`, or null where there is no canvas.
 */
export function canvasGlyphMeasurer(): GlyphMeasurer | null {
  const context = measuringContext();
  if (context === null) return null;
  return (fontFamily, fontSizePx, glyphs) => {
    context.font = fontStringOf(fontFamily, fontSizePx);
    return glyphs.map((g) => context.measureText(g).width);
  };
}

/**
 * Point `glyphAdvance.ts` at the real font. Idempotent, and honest about
 * failing: returns false where there is no canvas, in which case the shipped
 * table keeps answering and the plate is laid out on approximate metrics rather
 * than on no metrics.
 */
export function installCanvasGlyphMeasurer(): boolean {
  const measurer = canvasGlyphMeasurer();
  if (measurer === null) return false;
  installGlyphMeasurer(measurer);
  return true;
}
