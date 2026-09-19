import { GUTTER, HINT_CONTRACT, backCorner, headerText } from "@game/ui/grid";
import { SPACE, TYPE } from "@game/ui/theme";
import type { Rect } from "@game/ui/layout";
import { CONSOLE_STRIP, consoleStripBelow } from "@game/ui/controlSurfaceLayout";
import { VIEWPORT_WINDOW } from "@game/ui/viewportWindowLayout";
import {
  atmospheric,
  lightness,
  skyStops,
  withLightness,
  type StopPalette,
} from "@game/render/palette";

/**
 * THE PRE-FLIGHT SCREEN'S GEOMETRY (screen 5).
 *
 * ================== THE DEFECT ==================
 * The typed word was anchored to the SCREEN - `x: GAME_WIDTH / 2` - and the
 * cockpit window is not centred on the screen; it is a 900 px aperture at
 * x=900, i.e. the right half of a 1920 world. So on a 16:9 window the word
 * plate straddled the window frame: half of it on the glass, half of it on the
 * hull, with the frame's two strokes running through the middle of the one
 * thing the child is being asked to read. `preflight.png` caught it exactly.
 *
 * It is also ASPECT-DEPENDENT, which is why it survived: `GAME_WIDTH` is a live
 * binding that grows with the window (D99), and on a wide monitor the screen's
 * centre moves far enough right that the plate lands inside the glass by
 * accident. A bug that only appears at one aspect ratio is a bug that passes
 * every capture taken at another.
 *
 * ================== THE FIX ==================
 * The prompt is anchored to the WINDOW, which is the thing it belongs to: the
 * word appears on the glass, low, like a readout projected on the canopy. The
 * numbers are here rather than in the scene so the containment can be asserted
 * without a browser - see `tests/unit/scenes/preflightLayout.test.ts`.
 *
 * Nothing here imports Phaser or the DOM.
 */

/**
 * HOW FAR THE ROWS SIT INSIDE THE RACK THEY ARE BOLTED TO (UR-101.1).
 *
 * `SPACE.rowPadX`, which is 22, which is `SKY_PLATE.padX` - the inner line the
 * heading's plated ink, the stop name's and the keyboard hint's already sit on
 * (UR-89 collapsed those to one number for exactly this reason). So the rows
 * land on the SAME inner line as every other piece of text on this screen
 * instead of on a fourth one of their own.
 *
 * It is 22 and not the 28 the rack used to hang off the gutter by, because 28
 * is on no scale: it is the value UR-89 took OUT of `SPACE.rowPadX` for being
 * the one inset in `theme.ts` that belonged to nothing.
 */
export const RACK_PAD = SPACE.rowPadX;

/**
 * THE WIDTH OF THIS SCREEN'S LEFT COLUMN. ONE NUMBER (UR-101.1).
 *
 * Fixing the rack's LEFT edge showed the other half of the same defect in the
 * capture: the rack ran 96..724 and Shadow's dialogue plate directly beneath it
 * ran 96..856, so the two stacked plates shared a left edge and disagreed about
 * their right one by 132 px. Aligned on one side and ragged on the other is
 * arguably worse to look at than honestly misaligned, and "jenky" was a
 * whole-screen judgement rather than a note about one rectangle.
 *
 * 760 is the dialogue plate's existing width, so the plate that was already
 * right keeps its number and the rack comes to it - the same move UR-76 made
 * when it picked the back chip's line over launch's. The rows are then this
 * less the rack's padding on each side, which is what makes the column ONE
 * declaration instead of three that have to be kept in step by hand.
 */
export const COLUMN_W = 760;

/**
 * The three system rows, down the left.
 *
 * INSET FROM THEIR RACK, NOT ON THE GUTTER (UR-101.1). The pair used to be
 * anchored the other way round - rows on the gutter, rack grown outwards from
 * them - which put the RACK at `GUTTER - 28` = 68, twenty-eight pixels left of
 * every other element on the screen. See `BULKHEAD`.
 */
export const ROW = {
  x: GUTTER + RACK_PAD,
  y: 300,
  w: COLUMN_W - RACK_PAD * 2,
  h: 116,
  gap: 26,
} as const;

/** The cockpit window: the only hole in the hull. */
/** The cockpit window. Its right edge is the right gutter (`ui/grid.ts`). */
export const WINDOW = { x: 900, y: 170, w: 924, h: 600, r: 48 } as const;

/**
 * Where the typed word's plate is CENTRED.
 *
 * Horizontally on the glass, and low on it: high enough to clear the window's
 * bottom rounded corners, low enough that the planet swinging in behind it
 * (which settles around `WINDOW.x + WINDOW.w * 0.62`) is still the thing the
 * eye reads first.
 */
export const PROMPT = {
  x: WINDOW.x + WINDOW.w / 2,
  y: WINDOW.y + WINDOW.h - 130,
} as const;

/** Where the "type the word you see" line sits, under the glass. */
export const PROMPT_HINT = {
  x: WINDOW.x + WINDOW.w / 2,
  y: WINDOW.y + WINDOW.h + 58,
} as const;

/**
 * How wide a glyph may be, as a fraction of the font size, for SIZING PURPOSES
 * ONLY.
 *
 * 0.8 em is a deliberate over-estimate. The widest lowercase Latin glyph in the
 * UI stack measures about 0.62 em at 72 px and the pre-flight pool's widest
 * word ("encontramos", 11 glyphs, Spanish) draws at about 0.57 em average, but
 * Devanagari conjuncts are wider than Latin at the same point size and nothing
 * here may shrink a word to make a rectangle work. Over-estimating costs a test
 * some margin; under-estimating ships a clipped word.
 */
export const MAX_GLYPH_EM = 0.8;

/** The longest word the ritual can put on screen, in glyphs (`ritualPool`). */
export const MAX_PROMPT_GLYPHS = 12;

/**
 * The plate `lib/typedWord.createWordPrompt` cuts for a word, as a rectangle.
 *
 * The padding and the inter-letter gap are that module's own arithmetic,
 * restated: `padX = round(size * 0.55)`, `padY = round(size * 0.3)`,
 * `gap = round(size * 0.1)`, `plateH = size * 1.36 + padY`.
 */
export function promptPlate(
  glyphs: number,
  size: number = TYPE.display,
  at: { readonly x: number; readonly y: number } = PROMPT,
): Rect {
  const gap = Math.round(size * 0.1);
  const padX = Math.round(size * 0.55);
  const padY = Math.round(size * 0.3);
  const textWidth = glyphs * size * MAX_GLYPH_EM + Math.max(0, glyphs - 1) * gap;
  const w = textWidth + padX * 2;
  const h = size * 1.36 + padY;
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/** A rectangle shrunk on every side. */
export function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: r.w - by * 2, h: r.h - by * 2 };
}

/** True when `inner` lies wholly inside `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** The window as a plain rectangle. */
export function windowRect(): Rect {
  return { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w, h: WINDOW.h };
}

// ---------------------------------------------------------------------------
// UR-39: the screen that read as a wireframe
// ---------------------------------------------------------------------------

/**
 * WHAT WAS WRONG WITH THIS SCREEN, measured.
 *
 * A blind critic called Pre-flight the worst screen in the game and the phrase
 * that stuck was "a wireframe sitting between two finished screens". Measured
 * here rather than taken on trust - busy-pixel fraction, same metric on every
 * capture:
 *
 *   preflight 8.6%  ·  earth-activation 10.6  ·  map 12.1  ·  briefing 14.0
 *   beacon 16.4  ·  results 18.0  ·  warp 18.1
 *
 * Lowest in the product by a third, and the reasons were structural rather
 * than decorative:
 *
 *   NOTHING ABOVE y=320. The top of the frame held no title, no stop name and
 *   no chrome of any kind - the only story screen with no header at all.
 *   FOUR LEFT EDGES in one frame: rows at 96, their labels at 224, the
 *   dialogue plate at 356 and its text at 388.
 *   THE HINT FLOATED at the window's centre while every sibling's sits in the
 *   bottom band.
 *   NO WAY BACK. Unlike the Briefing, this scene never installed a keyboard
 *   handler at all, so Escape was inert and there was no pointer control
 *   either - the same defect as UR-27 and one screen further on.
 *
 * Everything below is the geometry for that, kept pure so
 * `tests/unit/scenes/preflightLayout.test.ts` can assert it without a browser.
 */

/** The screen's title and the stop under it, on the product's header lines. */
export const HEADING = headerText(0, undefined, 14);
export const SUBHEADING = headerText(1, undefined, 8);

/**
 * Shadow's dialogue plate.
 *
 * ON THE GUTTER. It was at x=356, which matched nothing on this screen or any
 * other; its text then sat at 388. A plate's own padding is not a column edge,
 * so the invariant the test holds is that every PLATE starts on the gutter and
 * text is inset from its plate - two numbers instead of four.
 */
export const LINE_PLATE = { x: GUTTER, y: 716, w: COLUMN_W, h: 200 } as const;

/**
 * SHADOW STANDS INSIDE THE PLATE, which is the warp break's coach card exactly
 * (`WarpScene.buildCoachArea`: the figure at `COACH.x + 130`, the note inset
 * past him). Moving the plate to the gutter without moving him put the plate
 * under the figure and printed "Hull, check." through his face - caught in the
 * capture, not by a test, which is why `preflightLayout.test.ts` now asserts
 * containment rather than only non-overlap.
 */
export const LINE_SHADOW = { x: 206, y: 816, scale: 0.72 } as const;

/** Text inset: past Shadow on the left, a normal pad everywhere else. */
export const LINE_PAD = { x: 230, y: 56 } as const;

/**
 * THE KEYBOARD HINT IS NO LONGER A NUMBER ON THIS SCREEN.
 *
 * It was `{ x: GUTTER, y: HINT_TOP }`, handed to `lib/kit.label`, which drew it
 * unplated - one of the three treatments the product had for one line. The
 * position AND the style now come from `ui/hintLine.drawHint`, which takes no
 * coordinates, so there is nothing here to keep in step. `leftEdges` asks the
 * grid's `HINT_CONTRACT` for the edge instead of this screen quoting one.
 */

/** The way out, in the Director map's chip treatment (as on the Briefing). */
export const BACK_CHIP = { w: 262, h: 66 } as const;

/**
 * THE PRODUCT'S BACK CORNER, top-right (`ui/grid.backCorner`).
 *
 * This screen was already the one that was RIGHT - the chip measured at
 * (1562, 84) on the served build - but it arrived there by its own arithmetic:
 * `WINDOW.x + WINDOW.w - BACK_CHIP.w` over `HEADING_TOP`. That is the same
 * corner the grid now names, reached by a sum only this file could check, so
 * the Briefing's chip could sit bottom-left without contradicting anything.
 * `ARTBOARD_RIGHT` is 1824 and `WINDOW.x + WINDOW.w` is 1824, so the pixels are
 * unchanged; what changes is that the two screens now read one function.
 */
export function backChip(): Rect {
  return backCorner(BACK_CHIP.w, BACK_CHIP.h);
}

/**
 * THE INSTRUMENT SHELF UNDER THE GLASS - THE BRIEFING'S, NOT A SECOND ONE
 * (UR-39, corrected by UR-77).
 *
 * ================== WHAT WAS WRONG WITH IT ==================
 * UR-39 gave this screen a shelf because the Briefing had one and this screen
 * did not. What it got was a SECOND shelf: 76 px of plain plate, hung 30 px
 * past the glass on each side, with nine flat dots painted on it by the scene.
 * UR-61 then rebuilt the Briefing's as real console hardware - bezel, milled
 * face, screws, cooling vents, a recessed lamp bank, `drawControlSurface` - and
 * raised it to 124 px, and this screen was never brought along, because there
 * was nothing structural tying the two together.
 *
 * "Pre-flight has no vent" is exactly that: `drawControlSurface` had ONE caller
 * in the product and it was not this screen.
 *
 * ================== WHAT IT IS NOW ==================
 * The same box, from the same function, under each screen's own glass
 * (`ui/controlSurfaceLayout.consoleStripBelow`), dressed by the same
 * `drawControlSurface` call the Briefing makes. Neither screen owns the height
 * or the lamp count any more, so one cannot be raised without the other.
 */
export const SHELF = {
  ...consoleStripBelow(windowRect()),
  lamps: CONSOLE_STRIP.lamps,
} as const;

/** The strip's box, for the shared control surface that dresses it. */
export function controlStrip(): Rect {
  return consoleStripBelow(windowRect());
}

// ---------------------------------------------------------------------------
// UR-77: one cockpit, seen twice
// ---------------------------------------------------------------------------

/**
 * WHERE THE HORIZONTAL MULLION CROSSES THIS GLASS.
 *
 * Both cockpit windows carry a CROSS now (`ui/viewportWindowLayout.ts`); the
 * single vertical strut this screen had was never a decision, it was the older
 * screen not being brought along. The one thing that genuinely has to differ is
 * the HEIGHT the horizontal strut crosses at, and it differs for a reason that
 * is a property of this screen rather than a taste: only this glass has
 * something printed on it.
 *
 * The typed word's plate is up to 848 px wide and sits low on the glass. The
 * Briefing's 0.7 puts the strut at y 590, and the widest plate's top edge is at
 * 580 - the strut would run along the top of the one thing the child is asked
 * to read. So the fraction is DERIVED from the plate it has to clear rather
 * than typed in: change the display size, the word pool or the plate's padding
 * and this moves with them.
 */
export const MULLION_CLEARANCE = 24;

export function mullionHorizontalAt(): number {
  const plateTop = promptPlate(MAX_PROMPT_GLYPHS).y;
  const highest =
    (plateTop - MULLION_CLEARANCE - VIEWPORT_WINDOW.mullionH - WINDOW.y) / WINDOW.h;
  // Floored to a whole percent so the number a capture is judged against is one
  // a person can hold in their head, and never lower than the clearance allows.
  return Math.min(VIEWPORT_WINDOW.horizontalAt, Math.floor(highest * 100) / 100);
}

/**
 * THE PLANET IN THE WINDOW (UR-77 item 3).
 *
 * ================== WHAT IT WAS ==================
 * A 300 px disc built from FOUR overlapping translucent circles: a 420 px
 * accent glow, the body, a 55%-alpha highlight up and left, and a 62%-alpha
 * terminator down and right. A blind critic called the result a desaturated
 * grey-brown disc and a thumbprint, and said it was most of what made the
 * window unreadable. The answer taken at the time was to change the
 * TERMINATOR'S HUE - keep the planet's own colour in shadow instead of washing
 * it with `INK.bgDeep` - and it did not work, because the hue was never the
 * problem. Four translucent circles stacked on each other average out to mud
 * whatever colour each one is, and at Jupiter it still read as a thumbprint.
 *
 * ================== WHAT THE BRIEFING DOES, ONE SCREEN EARLIER ==========
 * Nothing like it. The Briefing has no hand-drawn planet at all: it passes
 * `celestial` to `buildParallax` and the shared celestial body is ONE FLAT
 * DISC, about 130 px, hazed 0.84 into the sky and then pinned 14 L* off the
 * LOCAL sky value so it separates without coming forward. `render/parallax.ts`
 * carries the whole argument at length - it has been three circles ("from any
 * distance a RING"), then two ("a hard seam at x=850"), and the resolved answer
 * is a flat disc and nothing else.
 *
 * ================== WHY THIS SCREEN STILL DRAWS ITS OWN ==================
 * Because it has to MOVE. The planet swings into the window one leg per ritual
 * step, and the parallax owns its celestial layer's position, so this screen
 * cannot use the layer and keep the choreography. What it can do - and now does
 * - is use the same arithmetic and the same shape: same radius rule, same haze,
 * same L* separation, one flat disc, no glow, no highlight, no terminator.
 * `preflightLayout.test.ts` reads those three lines back out of
 * `render/parallax.ts`, so if the shared body changes and this does not, the
 * restatement goes red rather than quietly drifting.
 *
 * Exporting the drawing itself from `render/parallax.ts` is the real fix and it
 * is a read-only file for this lane; it is in `gauntlet/escalations.md`.
 */
export const PLANET = {
  /** The same share of the world `celestialBody` uses. A distant body is small. */
  rShare: 0.12,
  /** Where it comes to rest, as a fraction of the glass. */
  restXShare: 0.62,
  /** How high it sits in the glass. */
  cyShare: 0.52,
  /**
   * One ritual step's worth of travel, as a fraction of the glass.
   *
   * 0.23, NOT THE 0.28 THE SHIPPED 260 px WORKED OUT TO. The leg was sized
   * against a 300 px disc that could not fall off the left edge; at the shared
   * body's 130 px the first leg put a third of the planet outside the glass,
   * which the capture showed. Every leg now lands the whole disc on the glass,
   * which `preflightLayout.test.ts` checks rather than the eye.
   */
  legShare: 0.23,
  /** How far off the right edge it is parked, in radii. */
  parkRadii: 1.2,
  /** How hard it is hazed into the sky. `celestialBody`'s number. */
  haze: 0.84,
  /** How far off the LOCAL sky its value is pinned, in L*. */
  separationL: 14,
} as const;

/** The disc's radius on this world. Grows with the window (D99). */
export function planetRadius(worldW: number, worldH: number): number {
  return Math.min(worldW, worldH) * PLANET.rShare;
}

/** Where the disc comes to rest, once every system is lit. */
export function planetRestX(): number {
  return WINDOW.x + WINDOW.w * PLANET.restXShare;
}

/** The height it crosses the glass at. */
export function planetCy(): number {
  return WINDOW.y + WINDOW.h * PLANET.cyShare;
}

/** Where it stands with `stepsRemaining` legs of the swing still to run. */
export function planetLegX(stepsRemaining: number): number {
  return planetRestX() - stepsRemaining * WINDOW.w * PLANET.legShare;
}

/** Where it waits before the ritual starts: off the right edge of the glass. */
export function planetParkX(r: number): number {
  return WINDOW.x + WINDOW.w + r * PLANET.parkRadii;
}

/**
 * The disc's ONE colour, by `celestialBody`'s own rule.
 *
 * `localSky` is the sky's value AT THE DISC'S OWN HEIGHT, not the gradient's
 * middle stop. That distinction is not pedantry: a critic once measured the
 * shared body at L* 77.7 against a local sky of L* 77.8 - a ratio of 1.00:1,
 * pure hue difference, invisible on a tablet at half brightness and invisible
 * to a colour-blind child always - because the separation had been taken from
 * the middle stop while the disc sat near the top of the frame.
 */
export function planetFill(pal: StopPalette, localSky: string): string {
  const hazed = atmospheric(pal.colors[2] ?? pal.accent, skyStops(pal)[1], PLANET.haze);
  const target = lightness(localSky);
  return withLightness(
    hazed,
    target > 50
      ? Math.max(4, target - PLANET.separationL)
      : Math.min(96, target + PLANET.separationL),
  );
}

/**
 * The bulkhead the system rows are bolted to.
 *
 * The rows used to float on bare hull, which is most of what made this the
 * least busy screen in the product (8.6% against 14.0% for the Briefing, its
 * own twin). A rack has a back plate; three cards on a wall do not read as
 * instruments. It is the cockpit's own material (`ui/panel.ts`), so this adds
 * structure rather than decoration.
 *
 * ================== UR-101.1: IT WAS THE ONE THING OFF THE COLUMN ==========
 * The project owner called this screen "jenky". Measured on the served build:
 * heading ink 118, stop name 118, hint 118 - and this rack at 68, because it
 * was written as `GUTTER - 28` and grown outwards from rows that were
 * themselves on the gutter.
 *
 * THE PAIR WAS ANCHORED BACKWARDS. A rack is a PLATE, and UR-39 already settled
 * the rule for this exact screen: every plate starts on the gutter and what is
 * drawn on it is inset from it. Putting the ROWS on the gutter forces the plate
 * they are mounted on off the grid by whatever padding it wants, which is
 * precisely what happened. So the rack takes the gutter and the rows are inset
 * from it by `RACK_PAD` - and since that is `SKY_PLATE.padX`, the rows land on
 * the same inner line the heading, the stop name and the hint were already on.
 * Two vertical lines on this screen now, 96 and 118, where there were four.
 */
export const BULKHEAD = {
  x: GUTTER,
  y: ROW.y - 40,
  w: COLUMN_W,
  /**
   * ASYMMETRIC PADDING - 40 above, 12 below - because there are only 16 px
   * between the last row and the dialogue plate. A symmetric 44 ran the rack
   * straight through the plate, which the capture showed and the first version
   * of this module's test did not ask about; it checked the ROWS against the
   * plate and not the thing the rows are mounted on.
   */
  h: 3 * ROW.h + 2 * ROW.gap + 52,
} as const;

// ---------------------------------------------------------------------------
// UR-101.2: the check bar, which had two positions
// ---------------------------------------------------------------------------

/** Everything the check bar's value depends on. Numbers in, a fraction out. */
export interface CheckBarInput {
  /** Accepted keystrokes so far in this step, across all of its words. */
  readonly typedKeys: number;
  /** What the whole step is worth in keystrokes. The ritual plan knows it. */
  readonly totalKeys: number;
  /** Words of this step already retired - typed, or carried past by the assist. */
  readonly wordIndex: number;
  /** How many words this step plans to ask for. */
  readonly wordCount: number;
  /** How long the word on the glass has been there, ms. */
  readonly wordElapsedMs: number;
  /** D100's `promptAssistMs` window for that word, ms. 0 between words. */
  readonly wordWindowMs: number;
}

/**
 * HOW FULL A PRE-FLIGHT CHECK BAR SHOULD BE, 0..1.
 *
 * ================== THE DEFECT ==================
 * The bar was drawn only when its row was already `lit`, so it had exactly two
 * positions - 0% and 100% - on the one instrument a child is looking at while
 * they type. Reported by the project owner.
 *
 * ================== THE RULE: max(typed, elapsed) ==================
 * Not a sum, and not a switch.
 *
 *   TYPED    keystrokes / the step's total keystrokes, across ALL of its words,
 *            so a four-word step is one continuous fill rather than four jumps.
 *            This is the half that makes the bar feel driven by the child's
 *            hands, which is what was actually asked for.
 *   ELAPSED  where the screen's own clock stands in the step: words already
 *            retired, plus how far into the current word's D100 assist window
 *            it is. This is UR-31's timeout, which had no visible form at all
 *            until now - a child had no way to know the step would finish
 *            without them.
 *
 * ================== WHY BOTH, AND WHY `max` ==================
 * Nobody is forced to type and the ship cannot leave without pre-flight. A bar
 * driven only by keystrokes would sit at zero while the step completed
 * underneath it, so the display and the truth would disagree on the exact
 * screen D100 exists to keep from trapping a child. A bar driven only by the
 * clock would ignore the child entirely.
 *
 * `max` means typing can only ever pull the bar AHEAD of the clock and never
 * behind it. A quick typist fills it in a second; a child who types nothing
 * watches it fill on its own and still launches; a child typing slowly sees
 * their own keys outrunning the clock. Every one of those is the honest picture
 * of what is happening to them.
 *
 * ================== WHY IT IS NOT A GRADE (AC-11.3) ==================
 * Because of `max`, and this is the load-bearing consequence rather than a
 * side effect: at the end of a step the bar is FULL for a child who typed every
 * letter and FULL for a child who touched nothing. It cannot distinguish them,
 * so it cannot be read as a mark. It reports how far through the ceremony the
 * SHIP is, which is what the lamp beside it has always reported, drawn at a
 * resolution the lamp does not have.
 *
 * Monotonicity is the caller's (`PreflightScene` keeps a running maximum), not
 * this function's: a pure reading that clamped itself would hide a real dip
 * rather than fixing one.
 */
export function checkBarProgress(input: CheckBarInput): number {
  if (input.wordCount <= 0) return 1;
  const typed =
    input.totalKeys <= 0 ? 0 : Math.max(0, input.typedKeys) / input.totalKeys;
  const inWord =
    input.wordWindowMs <= 0
      ? 0
      : Math.min(1, Math.max(0, input.wordElapsedMs / input.wordWindowMs));
  const elapsed = (Math.max(0, input.wordIndex) + inWord) / input.wordCount;
  return Math.min(1, Math.max(typed, elapsed));
}

/** Shadow's drawn footprint, the same model `resultsLayout.shadowBox` uses. */
export function lineShadowBox(
  at: { readonly x: number; readonly y: number; readonly scale: number } = LINE_SHADOW,
): Rect {
  const r = 64 * at.scale;
  return { x: at.x - 1.6 * r, y: at.y - 2.0 * r, w: 1.6 * r * 2, h: (2.0 + 1.7) * r };
}

/**
 * Every PLATE edge on the left column. One value, or the test fails.
 *
 * The hint's edge is `HINT_CONTRACT.x` rather than a constant of this screen's:
 * the line is drawn by `ui/hintLine.drawHint` now and its plate lands on the
 * grid's corner, so the honest question is whether this screen's own columns
 * agree with the product's gutter - which is what the third entry asks.
 *
 * UR-101.1 REPLACED `ROW.x` WITH `BULKHEAD.x` HERE, and the swap is the whole
 * point of that item rather than a cosmetic edit. The rows are not a plate;
 * the rack they are bolted to is, and it was the one plate on this screen that
 * had never been asked the question this function asks. It answered 68.
 */
export function leftEdges(): number[] {
  return [BULKHEAD.x, LINE_PLATE.x, HINT_CONTRACT.x];
}
