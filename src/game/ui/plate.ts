import type Phaser from "phaser";
import { hexToNum } from "@game/render/palette";
import type { Rect } from "./layout.js";
import { INK, SPACE } from "./theme.js";
import {
  RIM,
  bracketSegments,
  rimRadius,
  rimRect,
  type PlateRhythmName,
} from "./plateLayout.js";

/**
 * THE ONE PLATE (UR-69, UR-70; standards rule 1, the COMPONENT half).
 *
 * ================== THE DEFECT ==================
 * UR-69 asks for one reusable layout built from reusable components that take
 * props - the per-planet colour being the example - so that a change made in
 * one place carries to every place the component is used.
 *
 * Colour already worked that way - `ui/theme.ts`'s tokens, the per-stop palette
 * and `ui/grid.ts`'s gutter are all prop-driven and all shared. The PLATE was
 * not. Nine scenes drew their own rounded rects (Pre-flight 7, Briefing 7,
 * Warp 4, Title 4, Stall 4, Results 4, HUD 4, Earth activation 2, Beacon 1), so
 * a corner treatment, a rim, a notch - or a PADDING change - had to be written
 * nine times and drifted the first time one of them was touched.
 *
 * ================== WHY A COMPONENT AND NOT A CONVENTION ==================
 * `lib/kit.plate` already existed and eight scenes already called it, and the
 * nine bespoke rects were drawn anyway. A helper nobody is obliged to use is a
 * suggestion. So this ships with `tests/unit/arch/platePainters.test.ts`, which
 * sweeps every file under `src/game/scenes` and fails PER CALL SITE on a raw
 * `fillRoundedRect` or `strokeRoundedRect`, naming the file - the shape of
 * `liveryReaders.test.ts`, and the reason standards rule 3's guard exists at
 * all. Standards rule 1 has been enforced for the theme half since the Title's
 * accent bug; this is the component half of the same rule.
 *
 * ================== WHAT IS A PROP ==================
 *   palette / accent   which stop is dressing it (`fill`, `stroke`, `rim`)
 *   corner             `round` (the default), `pill`, or `bracket` (UR-70's
 *                      angled corner brackets)
 *   rim                the second outline outside the plate - UR-70's "nice
 *                      gold around the whole element"
 *   rhythm             `card` | `instrument` | `chip` | `button`, which is the
 *                      plate's PADDING and the air between its rows
 *
 * The rhythm is the valuable one and it is why this is one component rather
 * than nine: `plateLayout.PLATE_STEP` is three numbers, and tightening them
 * tightens every screen in the game at once.
 *
 * ================== WHAT IS NOT HERE ==================
 * No colour literal. Every ink arrives as a token or as the stop's palette, for
 * the reason `controlSurface.ts` has the same rule: a hex literal is the only
 * way an unmeasured ink reaches the screen, and AC-22.8 measures pairs.
 *
 * And no text. A plate is a SURFACE; what sits on it is `lib/kit.label` and
 * `lib/kit.skyText`, which is what registers a colour pair for V-22.8. A plate
 * that drew its own label would be a second, unmeasured path to the glass.
 */

export type PlateCorner = "round" | "pill" | "bracket";

export interface PlateProps {
  /** Surface colour. A token, or the stop palette's own plate colour. */
  readonly fill?: string;
  /** Border colour. Pass the stop accent to dress the plate for the stop. */
  readonly stroke?: string;
  readonly alpha?: number;
  readonly strokeAlpha?: number;
  readonly strokeWidth?: number;
  /**
   * Corner treatment. `bracket` keeps the filled body and replaces the
   * continuous border with four angled corner pieces (UR-70).
   */
  readonly corner?: PlateCorner;
  /** Corner radius. Ignored when `corner` is `pill`. */
  readonly radius?: number;
  /**
   * UR-70's rim: a second outline OUTSIDE the plate with a gap of sky between.
   * Pass the colour, e.g. the stop accent. Omitted or false, no rim is drawn.
   */
  readonly rim?: string | false;
  readonly rimAlpha?: number;
  readonly rimWidth?: number;
  readonly rimGap?: number;
  /** Which padding rhythm this plate's content is laid out on. */
  readonly rhythm?: PlateRhythmName;
}

/**
 * The radius a plate is drawn at. A pill is "as round as it can be", which is
 * half its shorter side - the warp track's `METER.h / 2` was this number
 * written out by hand.
 */
export function plateRadius(rect: Rect, props: PlateProps = {}): number {
  if (props.corner === "pill") return Math.min(rect.w, rect.h) / 2;
  return props.radius ?? SPACE.radius;
}

/**
 * Paint a plate into an existing Graphics.
 *
 * THE PRIMITIVE. `drawPlate` below adds one and returns it, which is what a
 * scene usually wants; this is for the callers that already hold a Graphics and
 * are drawing several things into it (the menu kit's rows, the HUD's readouts),
 * so those do not have to choose between one Graphics per plate and a second
 * implementation.
 */
export function paintPlate(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  props: PlateProps = {},
): void {
  const radius = plateRadius(rect, props);
  const fill = props.fill ?? INK.panel;
  const stroke = props.stroke ?? INK.line;

  g.fillStyle(hexToNum(fill), props.alpha ?? 1);
  g.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, radius);

  const strokeWidth = props.strokeWidth ?? 2;
  const strokeAlpha = props.strokeAlpha ?? 0.9;
  if (strokeWidth > 0 && strokeAlpha > 0) {
    g.lineStyle(strokeWidth, hexToNum(stroke), strokeAlpha);
    if (props.corner === "bracket") {
      // The body keeps its shape; only the BORDER becomes four corner pieces.
      // Drawn as eight strokes rather than as a path, so the arms cannot meet
      // at the corner arcs and quietly become a continuous border again.
      for (const s of bracketSegments(rect, radius)) g.lineBetween(s.x1, s.y1, s.x2, s.y2);
    } else {
      g.strokeRoundedRect(rect.x, rect.y, rect.w, rect.h, radius);
    }
  }

  if (typeof props.rim === "string") {
    const gap = props.rimGap ?? RIM.gap;
    const outer = rimRect(rect, gap);
    g.lineStyle(props.rimWidth ?? RIM.width, hexToNum(props.rim), props.rimAlpha ?? 0.55);
    g.strokeRoundedRect(outer.x, outer.y, outer.w, outer.h, rimRadius(radius, gap));
  }
}

/**
 * A plate, as a new Graphics on the scene.
 *
 * The signature every screen uses. `lib/kit.plate` is a thin forward to this
 * one and keeps the `(scene, x, y, w, h, options)` spelling its eight existing
 * callers were written against, so there is one drawing underneath two
 * spellings rather than two drawings.
 *
 * `ui/chrome.plate` is NOT a forward and is not meant to become one: it takes a
 * Graphics and a colour as a number and fills without stroking, and it builds
 * console hardware rather than a surface type sits on. See the note in
 * `tests/unit/arch/platePainters.test.ts`.
 */
export function drawPlate(
  scene: Phaser.Scene,
  rect: Rect,
  props: PlateProps = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  paintPlate(g, rect, props);
  return g;
}

/**
 * The focus ring: the same rounded rect, outside the control.
 *
 * Here rather than in three scenes because it is the plate's own geometry with
 * one offset - `SPACE.focusRingOffset` - and because two of the nine bespoke
 * rounded rects this ticket counted were a screen redrawing exactly this.
 */
export function paintFocusRing(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  accent: string,
  options: { readonly radius?: number; readonly halo?: string } = {},
): void {
  const o = SPACE.focusRingOffset;
  const radius = (options.radius ?? SPACE.radius) + o;
  const ring: Rect = { x: rect.x - o, y: rect.y - o, w: rect.w + o * 2, h: rect.h + o * 2 };
  g.lineStyle(SPACE.focusRingWidth, hexToNum(accent), 1);
  g.strokeRoundedRect(ring.x, ring.y, ring.w, ring.h, radius);
  // The soft second pass. Wider and barely there, so the ring reads as lit
  // rather than as a second border; the story kit has drawn it since the menu
  // kit landed and three scenes drew their own copy of it.
  if (options.halo !== undefined) {
    g.lineStyle(SPACE.focusRingWidth + 6, hexToNum(options.halo), 0.18);
    g.strokeRoundedRect(ring.x, ring.y, ring.w, ring.h, radius);
  }
}
