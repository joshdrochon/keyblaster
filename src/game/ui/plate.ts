import type Phaser from "phaser";
import { hexToNum } from "@game/render/palette";
import type { Rect } from "./layout.js";
import { INK, SPACE } from "./theme.js";
import {
  MARK,
  RIM,
  boltPoints,
  bracketSegments,
  dotCentres,
  promptSegments,
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

/**
 * THE CHROME GOLD, AND WHY IT IS A DEFAULT RATHER THAN A CALL SITE'S PROBLEM.
 *
 * UR-70 asks for gold brackets and a gold line around the element. A previous
 * lane passed the STOP's accent instead, on the argument that the comp happened
 * to be at a gold stop and that hard-coding a colour would push a themed value
 * into shared chrome. The argument is right about direction and wrong about
 * which way it points: the stop accent IS the themed value, and at Mars it is
 * red, so the brackets read as four faint red slivers rather than as the corner
 * hardware of an instrument. Chrome does not change colour with the planet -
 * that is what makes it chrome, and it is the same reason `ui/theme.INK.accent`
 * is one accent for the whole menu system.
 *
 * So gold is the DEFAULT and not a rule. `stroke` and `rim` both still take a
 * colour, so a screen that wants its stop's accent asks for it in one word, and
 * `INK.accent` is a token - no hex reaches a scene.
 */
const CHROME_INK = INK.accent;

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
   *
   * `true` is the chrome gold, which is what UR-70 asked for and what a screen
   * that just wants "a nice line around the whole element" should say. A string
   * is that colour instead - pass the stop accent to dress the rim for the
   * stop. Omitted or false, no rim is drawn.
   */
  readonly rim?: string | boolean;
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
/**
 * EVERY PLATE REMEMBERS THE RECTANGLE IT WAS PAINTED ON (UR-111).
 *
 * ================== WHY A GRAPHICS NEEDS THIS AT ALL ==================
 * A Phaser `Text` can be measured - `getBounds()` is the box it occupies. A
 * `Graphics` cannot: it has no width, no height and no bounds, only a list of
 * fill commands. So a plate is invisible to anything that wants to ask "which
 * objects make up the control at this rectangle", which is exactly the question
 * `lib/kit.createKeyboardMenu` has to answer to grow a focused control: the
 * seven story screens hand it a bare rectangle and draw their own plates and
 * labels, and without this there is no way back from the rectangle to the
 * drawing.
 *
 * A WeakMap and not a field on the object, so nothing is retained after a scene
 * shuts down and no Phaser type is widened. A Graphics painted several times
 * (the Title's primary is a body plus a facet; the HUD draws a whole row of
 * readouts into one) accumulates the UNION of its rects, which is the box the
 * drawing actually occupies and is what a caller asking "where is this" means.
 */
const PLATE_RECTS = new WeakMap<object, Rect>();

/** The union box of every plate painted into `g`, or null if none was. */
export function plateRectOf(g: object): Rect | null {
  return PLATE_RECTS.get(g) ?? null;
}

function rememberPlateRect(g: object, rect: Rect): void {
  const prev = PLATE_RECTS.get(g);
  if (prev === undefined) {
    PLATE_RECTS.set(g, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    return;
  }
  const x = Math.min(prev.x, rect.x);
  const y = Math.min(prev.y, rect.y);
  PLATE_RECTS.set(g, {
    x,
    y,
    w: Math.max(prev.x + prev.w, rect.x + rect.w) - x,
    h: Math.max(prev.y + prev.h, rect.y + rect.h) - y,
  });
}

export function paintPlate(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  props: PlateProps = {},
): void {
  rememberPlateRect(g, rect);
  const radius = plateRadius(rect, props);
  const fill = props.fill ?? INK.panel;
  // A BRACKETED PLATE DEFAULTS TO THE CHROME GOLD, a plain one to the panel
  // line. Brackets are hardware and hardware is gold (see `CHROME_INK`); a
  // continuous border is the plate's own edge and stays the quiet line it has
  // always been, so nothing that is already on screen changes colour.
  const stroke = props.stroke ?? (props.corner === "bracket" ? CHROME_INK : INK.line);

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

  if (props.rim !== undefined && props.rim !== false) {
    const gap = props.rimGap ?? RIM.gap;
    const outer = rimRect(rect, gap);
    const ink = props.rim === true ? CHROME_INK : props.rim;
    g.lineStyle(props.rimWidth ?? RIM.width, hexToNum(ink), props.rimAlpha ?? 0.55);
    g.strokeRoundedRect(outer.x, outer.y, outer.w, outer.h, rimRadius(radius, gap));
  }
}

// ---------------------------------------------------------------------------
// The marks (UR-70)
// ---------------------------------------------------------------------------

/**
 * A terminal prompt, drawn into a box.
 *
 * UR-70 wants the screen's tab to read like a console: this is the `>_` on it.
 * A PAINTER AND NOT A LABEL - see `promptSegments` for why it is three strokes
 * rather than two characters in a Text.
 */
export function paintPromptGlyph(
  g: Phaser.GameObjects.Graphics,
  box: Rect,
  ink: string = CHROME_INK,
  options: { readonly alpha?: number; readonly width?: number } = {},
): void {
  g.lineStyle(options.width ?? 3, hexToNum(ink), options.alpha ?? 0.9);
  for (const s of promptSegments(box)) g.lineBetween(s.x1, s.y1, s.x2, s.y2);
}

/**
 * A row of status dots, centred in a box (UR-70's two dots on the header line).
 *
 * `count` is a prop and the default is two because that is what the ticket
 * asks for, not because two is a law: the whole point of the mark living here
 * is that the screen that wants three says three.
 */
export function paintStatusDots(
  g: Phaser.GameObjects.Graphics,
  box: Rect,
  ink: string = CHROME_INK,
  options: { readonly count?: number; readonly alpha?: number; readonly radius?: number } = {},
): void {
  g.fillStyle(hexToNum(ink), options.alpha ?? 0.8);
  for (const c of dotCentres(box, options.count ?? 2)) {
    g.fillCircle(c.x, c.y, options.radius ?? MARK.dot);
  }
}

/**
 * The charge bolt on the warp drive's track (UR-70).
 *
 * Filled, and stroked in the same ink when asked, because the mark is drawn
 * ON the track: the bolt sits where the meter's fill will later run under it,
 * so it has to read on the sunken ink and on the accent alike. The scene picks
 * the ink; what is fixed here is that it is ONE polygon (`boltPoints`).
 */
export function paintBolt(
  g: Phaser.GameObjects.Graphics,
  box: Rect,
  ink: string = CHROME_INK,
  options: { readonly alpha?: number } = {},
): void {
  g.fillStyle(hexToNum(ink), options.alpha ?? 1);
  g.fillPoints(boltPoints(box) as unknown as Phaser.Geom.Point[], true);
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
  options: {
    readonly radius?: number;
    readonly halo?: string;
    /**
     * How far outside the control the ring sits. A PROP because the Title's
     * column budget is measured against a 14 px reach (`titleStack.FOCUS_PAD`)
     * while the menu kit's rows use `SPACE.focusRingOffset`; a component whose
     * one hard-coded offset forces a screen to draw its own ring is the defect
     * UR-69 is about.
     */
    readonly offset?: number;
  } = {},
): void {
  const o = options.offset ?? SPACE.focusRingOffset;
  /**
   * The ring is CONCENTRIC with the control: the control's own radius plus how
   * far the ring stands off it, clamped so it can never exceed half the shorter
   * side and turn the corner inside out.
   *
   * Derived rather than passed as a finished number, which is what the Title
   * used to do - `item.id === "primary" ? 34 : 14`, two radii picked by eye for
   * two controls whose plates are 26 and 16. A ring that is not concentric with
   * the thing it is around reads as a second, wrong-shaped border.
   */
  const ring: Rect = { x: rect.x - o, y: rect.y - o, w: rect.w + o * 2, h: rect.h + o * 2 };
  const radius = Math.min(
    (options.radius ?? SPACE.radius) + o,
    Math.min(ring.w, ring.h) / 2,
  );
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
