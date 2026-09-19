import { ROCK_ANGLE_MAX_PX, ROCK_DRIFT_PX } from "@engine/spawn/index.js";
import { SPAWN_MARGIN_PX } from "@game/flight/stage";
import { hudRects } from "@game/flight/hudLayout";
import type { Rect } from "@game/ui/layout";
import { DUR, TYPE } from "@game/ui/theme";

/**
 * WHERE A TROPHY TOAST GOES DURING A BELT, AND FOR HOW LONG.
 *
 * Pure: no Phaser, no DOM, no clock. `trophyToast.ts` draws what this decides,
 * and `tests/unit/ui/trophyToast.test.ts` measures it against the real HUD
 * rectangles and the real falling-word band rather than against a wireframe.
 *
 * ================== THE PROBLEM, MEASURED ==================
 * The requirement is that a trophy earned mid-belt surfaces immediately and
 * briefly, plus a hard constraint: it must not cover a falling word or the
 * hull marks, and it must never take focus.
 *
 * `src/game/ui/toast.ts` already exists and already says it is for "during
 * flight or at Results" - and its rest position is the one place it cannot go.
 * At a 1920 world it lands at (1544, 64, 280, 59), which overlaps the HUD's
 * right plate (x 1660..1896, y 22..114 - the score, the hull label and the
 * three hull marks) by 164 x 50 px, and puts 56 px of itself inside the
 * falling-word corridor. It has also never been called from anywhere: its only
 * caller is `MenuScene.raiseToast`, which nothing calls either. So the toast
 * is the third thing on this screen's list to be fully built and unreachable,
 * after the twelve trophies with no writer and the four hulls with no writer.
 *
 * ================== WHAT IS ACTUALLY FREE ==================
 * Occupied during a belt, at world width `W`:
 *
 *   HUD left      x 24..260        y 22..114
 *   HUD place     x 24..260        y 124..170
 *   HUD right     x W-260..W-24    y 22..114
 *   word band     x per below      y 0..1030.5
 *
 * The word band's VERTICAL extent is what decides this. A rock falls to
 * `breachY` = 856, its plate hangs `sizePx/2 + 42.75` below its centre and is
 * 26.75 px half-high, and a nested shell is 210 px across - so the lowest ink
 * a word plate can reach is `856 + 105 + 42.75 + 26.75` = 1030.5.
 *
 * Its HORIZONTAL extent is wider than the product believes. `wordPlateSpan`
 * models the corridor as `[320, W-320]`, but `playableSpan` applies that
 * margin to the rock's CENTRE and `FlightScene.updateRocks` then adds up to
 * `ROCK_ANGLE_MAX_PX` (60) of lateral travel and `ROCK_DRIFT_PX` (10) of sway
 * on top of it, with the plate's own half-width beyond that. At 1920 the
 * declared corridor ends at 1600 and the reachable one ends at about 1778.
 * THAT IS A DEFECT IN ITS OWN RIGHT and is reported rather than worked around
 * - but this module has to place a rectangle today, so it measures against the
 * reachable band, which is the conservative reading.
 *
 * That leaves exactly one region provably clear of everything: the strip under
 * the word band, `y 1030.5..1080`. 49.5 px. So the toast is a CHIP on that
 * strip, in the bottom-right corner, and not a card anywhere else.
 *
 * ================== WHY NOT THE TOP ==================
 * Because that is where the rocks come from. Every pixel above y=1030 is
 * reachable by a word plate at some point in a belt, and a notification that
 * covers the word a child is typing is worse than no notification.
 */

// ---------------------------------------------------------------------------
// The keep-out
// ---------------------------------------------------------------------------

/** `FlightScene.buildShip`: the ship sits at `height - 150`, breach 74 above. */
export const BREACH_Y = 1080 - 150 - 74;

/** `engine/nested.NESTED_SHELL_MAX_PX`: the largest rock the belt can spawn. */
export const MAX_ROCK_PX = 210;

/** `render/wordPlateGeometry`: `PLATE_GAP_PX` 16 + the plate's half height. */
const PLATE_DROP_PX = 42.75;
const PLATE_HALF_H_PX = 26.75;

/** The lowest ink a falling word can reach. */
export const WORD_BAND_BOTTOM = BREACH_Y + MAX_ROCK_PX / 2 + PLATE_DROP_PX + PLATE_HALF_H_PX;

/**
 * The widest a word plate gets, in half-widths.
 *
 * The longest word in any shipped pool is ten letters (`superficie`, es) and
 * `plateSize` gives it 132 px of half-width at D41's increased letter spacing.
 * Restated as a constant rather than recomputed, because the pools belong to
 * the content lane and a layout module that reached into them would go red
 * every time a word was added.
 */
export const WORD_PLATE_HALF_W = 132;

/** The band a falling word can actually occupy - travel and sway included. */
export function wordBand(width: number): Rect {
  const reach = ROCK_ANGLE_MAX_PX + ROCK_DRIFT_PX + WORD_PLATE_HALF_W;
  const left = SPAWN_MARGIN_PX - reach;
  const right = width - SPAWN_MARGIN_PX + reach;
  return { x: left, y: 0, w: right - left, h: WORD_BAND_BOTTOM };
}

/** Everything a belt draws that a notification may not cover. */
export function beltKeepOut(width: number): readonly Rect[] {
  return [
    ...hudRects(width).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    wordBand(width),
  ];
}

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

/**
 * The chip's own numbers.
 *
 * `h` is 44 and not the menu toast's 59, because the free strip is 49.5 px
 * tall and that is not a number anybody chose - it is what is left once the
 * belt has had everything it needs. `padY` 8 around a 20 px caption's 26 px
 * line box is 42, so 44 is the line box plus its padding, rounded to an even
 * number, and nothing is squeezed to make it fit.
 */
export const TROPHY_CHIP = {
  h: 44,
  padX: 16,
  padY: 8,
  /** The accent pip that makes it read as an award in a desaturated frame. */
  pipR: 6,
  pipGap: 12,
  /** From the right edge of the world, and from the foot of it. */
  insetX: 24,
  insetY: 4,
  size: TYPE.caption,
  radius: 10,
  minW: 260,
  maxW: 560,
} as const;

/** How wide the chip is for a measured run of ink. */
export function chipWidth(inkWidth: number): number {
  const w =
    Math.ceil(inkWidth) +
    TROPHY_CHIP.padX * 2 +
    TROPHY_CHIP.pipR * 2 +
    TROPHY_CHIP.pipGap;
  return Math.min(TROPHY_CHIP.maxW, Math.max(TROPHY_CHIP.minW, w));
}

/**
 * Where the chip rests, bottom-right, inside the strip under the word band.
 *
 * `insetY` 4 puts its top edge at 1032, one and a half pixels under the lowest
 * a word plate can reach, and its bottom at 1076, four px off the foot of the
 * frame.
 */
export function chipRect(width: number, inkWidth: number): Rect {
  const w = chipWidth(inkWidth);
  return {
    x: width - TROPHY_CHIP.insetX - w,
    y: 1080 - TROPHY_CHIP.insetY - TROPHY_CHIP.h,
    w,
    h: TROPHY_CHIP.h,
  };
}

/** Where it starts from, before it slides up onto its line. */
export function chipEntryOffsetY(): number {
  return TROPHY_CHIP.h + TROPHY_CHIP.insetY;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * How long a trophy is on screen, and why those numbers.
 *
 * `inMs` and `outMs` are the product's existing toast tokens (`DUR.toastIn`,
 * `DUR.panel`), so the chip arrives and leaves at the same speed as every
 * other plate in the game.
 *
 * `holdMs` is NOT `DUR.toast` (3200). That is the hold for a toast raised on a
 * MENU, where nothing else is competing for the child's attention and the
 * screen is not moving. This one fires mid-belt, over a moving frame, while
 * the child is typing a word against a falling rock. 2400 ms is the budget:
 * "Trophy Earned - Chain 25" is four short words, and a seven-year-old reading
 * at roughly two words a second needs about 2000 ms plus a beat to notice the
 * thing arrived at all. Longer and it is furniture; shorter and it is a flash
 * they will ask about afterwards.
 *
 * `gapMs` is the air between one chip leaving and the next arriving. It exists
 * because two trophies are QUEUED and not stacked - see `queueDelays`.
 */
export const TROPHY_TIMING = {
  inMs: DUR.toastIn,
  holdMs: 2400,
  outMs: DUR.panel,
  gapMs: 180,
} as const;

/** How long one chip occupies the line, start to finish. */
export const TROPHY_CYCLE_MS =
  TROPHY_TIMING.inMs + TROPHY_TIMING.holdMs + TROPHY_TIMING.outMs;

/**
 * TWO TROPHIES AT ONCE ARE QUEUED, NOT STACKED.
 *
 * `ui/toast.ts` stacks: toast N sits `N * (h + 14)` lower than the first. That
 * is right on a menu and impossible here - the free strip is 49.5 px tall and
 * one chip is 44 of them, so a second row would be drawn 14 px inside the
 * falling-word band. There is nowhere for it to go.
 *
 * So the second trophy waits. `queueDelays` gives the start offset of each
 * chip in a burst; a chip begins `gapMs` after the one before it has finished
 * leaving, so only ever one is on screen.
 *
 * It matters more than it sounds: Chain 25 and Chain 50 are the two trophies
 * most likely to land in the same breath, and Sharp Eye can join them at the
 * end of the same belt.
 */
export function queueDelays(count: number): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, Math.trunc(count)); i += 1) {
    out.push(i * (TROPHY_CYCLE_MS + TROPHY_TIMING.gapMs));
  }
  return out;
}

/** The window one queued chip is visible in, as `[startMs, endMs]`. */
export function chipWindow(index: number): readonly [number, number] {
  const start = (queueDelays(index + 1)[index] ?? 0);
  return [start, start + TROPHY_CYCLE_MS];
}

// ---------------------------------------------------------------------------
// What the flight loop can announce, and when
// ---------------------------------------------------------------------------

/** The game-level event a scene emits to raise a chip. */
export const TROPHY_EVENT = "kb.trophy.earned";

/**
 * The slice of `Phaser.Game` this rule needs.
 *
 * Narrowed to an emitter so the rule is a PURE function of a combo count and
 * can be swept in a plain Node test. Importing Phaser here would make that
 * impossible - it reads `window` at module load.
 */
export interface TrophyEmitter {
  readonly events: { emit(name: string, ids: readonly string[]): unknown };
}

// ---------------------------------------------------------------------------
// The flight lane's side of the seam
// ---------------------------------------------------------------------------

/**
 * WHICH TROPHIES CAN EVEN BE KNOWN MID-BELT, AND WHY IT IS ONLY THESE TWO.
 *
 * `@engine/awards` splits the twelve into two kinds. Eight are questions about
 * the PROFILE - beacons lit, stars stored at a named stop, three clean stops in
 * a row - and none of them can be answered until the stage has been scored and
 * written back, which happens on the stage report two screens later. The other
 * four are `StageAward` facts, and of those, `sharpEye` and `longMemory` are
 * only decidable when the belt ENDS (it has to have been cleared, and every
 * retention word has to have come back).
 *
 * That leaves `chain25` and `chain50`: the only two trophies in the game whose
 * condition becomes true at a knowable instant DURING play, which is also
 * exactly the moment worth celebrating. A notification for the other ten would
 * be a notification that arrives two screens after the thing it is about.
 *
 * So this is not a reduced version of the feature - it is the whole of what
 * "while actually playing" can mean, and the other ten are announced on the
 * stage report by `ResultsScene.trophiesPiece`.
 */
export const LIVE_TROPHY_THRESHOLDS: readonly { readonly id: string; readonly combo: number }[] = [
  { id: "chain25", combo: 25 },
  { id: "chain50", combo: 50 },
];

/** Thresholds already fired this stage, so a chain of 60 announces 50 once. */
const fired = new WeakMap<TrophyEmitter, Set<string>>();

/**
 * Called once at stage start. `FlightScene.create`, beside `this.bestCombo = 0`.
 */
export function resetLiveTrophies(game: TrophyEmitter): void {
  fired.set(game, new Set());
}

/**
 * Called on every combo increment. `FlightScene`, on the line after
 * `this.bestCombo = Math.max(this.bestCombo, this.combo.combo)`.
 *
 * Deliberately takes the COMBO and nothing else: the flight lane does not need
 * to know what a trophy is, which ones exist, or that a toast is what happens.
 *
 * ONLY ANNOUNCES WHAT THE PROFILE DOES NOT ALREADY HOLD, when it is given one.
 * A child who earned Chain 25 last week has not earned it again, and a chip
 * that says they have is the "0 of 12 earned forever" defect wearing the
 * opposite face. `ResultsScene.persistTrophies` is still the only writer; this
 * only decides whether to SAY anything.
 */
export function emitLiveTrophies(
  game: TrophyEmitter,
  combo: number,
  held: readonly string[] = [],
): void {
  let seen = fired.get(game);
  if (seen === undefined) {
    seen = new Set();
    fired.set(game, seen);
  }
  const heldSet = new Set(held);
  const earned: string[] = [];
  for (const { id, combo: at } of LIVE_TROPHY_THRESHOLDS) {
    if (combo < at || seen.has(id) || heldSet.has(id)) continue;
    seen.add(id);
    earned.push(id);
  }
  if (earned.length > 0) game.events.emit(TROPHY_EVENT, earned);
}
