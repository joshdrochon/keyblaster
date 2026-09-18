import { mixHex } from "./palette.js";

/**
 * THE SCORCH MARK: WHERE IT GOES AND WHAT COLOUR IT IS (UR-22, AC-22.4).
 *
 * Pure arithmetic, no Phaser: `FlightScene.addScorch` draws what this decides,
 * and a unit test can hold the decision without booting a game.
 *
 * ================== WHAT UR-22 BOUGHT AND WHAT IT COST ==================
 * UR-22 is "the hull absorbed damage without limit" - a child could not tell
 * the ship was being hurt. The answer was to make the mark BIG: 34x20 on a
 * fuselage 57 px across, a third of its width, against the old 16x9 that nobody
 * could see. That part is right and none of it moves here.
 *
 * What it did not account for is that a shipped belt carries NINE of them.
 * `hullForStage(58)` is 9 (`DEFAULT_FLIGHT_CONFIG.stageWordCount`), and the old
 * mark was three translucent near-black ellipses stacked at alpha, scattered
 * inside a 20 px wide strip down the middle of the hull. Nine of those do not
 * read as nine marks; they read as one hull painted out. Measured with the
 * gauntlet's own silhouette probe, ship core against the frame immediately
 * around it, the hull fell from 203 to about 75 - and the sky at the ship's
 * height sits at 57 to 109 depending on the stop, so the hull's value walked
 * INTO the sky's. AC-22.4 (`tests/e2e/hull-scorch.spec.ts`) measured it failing
 * at four marks on mars, four on jupiter, seven on pluto, eight on saturn and
 * nine on neptune - and NEVER on uranus, whose sky at the ship is dark enough
 * that a darkening hull only separates further. A gate that had sampled uranus
 * would have reported this clean, which is coding-standards rule 5's own
 * example with the stop unchanged.
 *
 * ================== THE THREE THINGS THAT CHANGED ==================
 *
 * 1. THE MARK HAS AN EDGE INSTEAD OF A DEPTH. It is a light heat rim, a burnt
 *    field, and a hard near-black centre - so what the eye reads is the STEP
 *    from hull to mark and from mark to centre, which is local contrast, rather
 *    than a large area of near-black, which is the thing that drags the hull's
 *    whole value down. The centre alone is still 188 px^2 below the quarter-
 *    luma line `tests/e2e/hull-feedback.spec.ts` counts as "dark", so one hit
 *    still moves that measure by more than its 2% floor.
 *
 * 2. NOTHING STACKS. Every fill is OPAQUE. Two overlapping translucent marks
 *    composite into something darker than either, which is how three hits used
 *    to reach near-black; two overlapping opaque marks in the same colour are
 *    the same colour. Soot saturates - a hull cannot get blacker than burnt -
 *    and now the drawing says so.
 *
 * 3. THEY SPREAD INSTEAD OF PILING. The old placement was
 *    `x = (rng() - 0.5) * 20`, a 20 px wide strip through the exact middle of
 *    the hull, which is also the exact disc AC-22.4 averages. Marks now take
 *    slots from a fixed lattice, in a fixed order, jittered: nine marks land on
 *    nine parts of the ship. That is the better read - "this ship has been
 *    through something" rather than one growing blot - and it is also what
 *    keeps each new hit ADDING area, which is what makes the accumulation
 *    ladder in `hull-feedback.spec.ts` keep falling now that marks no longer
 *    deepen each other.
 *
 * The count is unchanged, the size is unchanged, and the mark is still the
 * SHIP's damage rather than a counter (AC-22b.1, D31).
 */

/** UR-22's logged mark size, in screen px. Unchanged by this pass. */
export const SCORCH_W = 34;
export const SCORCH_H = 20;

/**
 * The hard centre: the part of the mark that reads as burnt through, and the
 * part `tests/e2e/hull-feedback.spec.ts` counts when it asks whether one hit
 * moved the dark share of the fuselage. 24x10 is 188 px^2, which is 2.7% of
 * that spec's 52x132 hull box against its 2% floor - a gash rather than a blot,
 * so the area is spent on LENGTH, where it reads, instead of on depth, where it
 * only drags the hull's value toward the sky's.
 */
export const SCORCH_CORE_W = 24;
export const SCORCH_CORE_H = 10;

/** Thickness of the heat rim drawn around the burn, px. */
export const SCORCH_RIM_PX = 3;

/**
 * How far the slot jitter may move a mark. Small on purpose: the lattice is
 * what keeps nine marks apart, and a jitter big enough to undo it would put the
 * pile back.
 */
export const SCORCH_JITTER_PX = 3;

export interface ScorchColors {
  /** Heat-bleached edge on the lit side (art-direction section 2's rim rule). */
  readonly rim: string;
  /** The burnt field. */
  readonly field: string;
  /** Burnt through. Below the quarter-luma line at every shipped livery. */
  readonly core: string;
}

/**
 * The mark's three colours, mixed from THE HULL THIS SHIP IS WEARING.
 *
 * Not three literals. Four ships ship (D79) and they do not share a hull
 * colour, so a fixed soot would read as a sticker on three of them. Mixing from
 * `livery.hull` keeps the mark the same MARK on every ship, which is what a
 * reference compare judges, and keeps the step from hull to mark the same size.
 */
export function scorchColors(hullHex: string): ScorchColors {
  return {
    rim: mixHex(hullHex, "#FFFFFF", 0.55),
    // A visible step down from cream and no further. The field is what NINE
    // marks paint the hull with, so its value is the value a fully scorched
    // hull has, and that value has to stay clear of every stop's sky: measured,
    // the frame immediately around the ship runs 57 (neptune) to 108 (saturn).
    field: mixHex(hullHex, "#3A2E24", 0.1),
    core: mixHex(hullHex, "#0B0D11", 0.93),
  };
}

export interface ScorchSlot {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the marks go, in the order they are taken.
 *
 * ================== HOW THESE WERE CHOSEN ==================
 * The Lantern's fuselage is a capsule: `lantern.HULL_PROFILE` scaled by
 * `SHIP_HALF_WIDTH_PX / LANTERN_DESIGN_HALF_WIDTH`, widest at 28.5 px either
 * side of the spine at y = -2.5 and closing to nothing at y = -50.6 and
 * y = +45.6. A 34x20 ellipse with 3 px of jitter on it only stays wholly on
 * that shape for centres in y -26..+32 and x -8..+8 - the hull is not much
 * bigger than the mark, which is the whole reason UR-22's mark reads.
 *
 * Inside that window the twelve below are a max-min packing measured in the
 * GASH's own axes - the 24x10 centre, not the 34x20 burn - because the gash is
 * what `hull-feedback.spec.ts` counts when it asks whether a hit darkened the
 * fuselage. Nine 34x20 burns cannot avoid overlapping on a ship this size and
 * do not try to; what the packing buys is that every gash still lands on hull
 * no earlier gash had taken. Measured over the first nine, each adds between
 * 26% and 100% of its own area, and the nine together cover 6.9 times what one
 * does. That is what keeps the accumulation ladder in `hull-feedback.spec.ts`
 * falling now that marks no longer deepen each other, and
 * `tests/unit/flight/scorchPlacement.test.ts` measures the union rather than
 * trusting this paragraph.
 *
 * ================== AND THE PORTHOLE IS TAKEN LAST ==================
 * It is at (0, -3.6) with a 16.4 px radius. Art-direction section 5 names it as
 * one of the ship's defining features, and it is the one dark thing on a cream
 * hull - so a burn laid across it paints out the ship's face AND, because the
 * burn is lighter than the glass, REMOVES dark pixels from the fuselage, which
 * is the opposite of what a hit should do to `hull-feedback.spec.ts`'s measure.
 * Nine slots clear it, which is exactly what a shipped 58-word stage can take
 * (`hullForStage(58)`), so the window is only reached by a fixture stage.
 *
 * After twelve the lattice repeats with fresh jitter; a 400-word fixture stage
 * can take 66 hits and the rule has to stay total.
 */
export const SCORCH_SLOTS: readonly ScorchSlot[] = [
  { x: 3, y: 32 },
  { x: 0, y: -26 },
  { x: -8, y: 11 },
  { x: 6, y: 23 },
  { x: 8, y: 11 },
  { x: -3, y: -20 },
  { x: -7, y: 17 },
  { x: -5, y: 27 },
  { x: 7, y: 17 },
  { x: 8, y: -5 },
  { x: -6, y: 2 },
  { x: -7, y: -11 },
];

/**
 * The slot for the Nth mark currently on the hull, jittered.
 *
 * `index` is how many marks are already drawn, not how many hits were taken: a
 * shield canister takes one back (`FlightScene.removeScorch`), and the freed
 * slot is the right one for the next hit to use.
 *
 * `jitterX`/`jitterY` are two draws from the scene's seeded rng in [0, 1). The
 * jitter is deliberately smaller than the gaps in the lattice, so it varies the
 * ship without undoing the spread.
 */
export function scorchSlotAt(index: number, jitterX: number, jitterY: number): ScorchSlot {
  const n = SCORCH_SLOTS.length;
  const safe = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const slot = SCORCH_SLOTS[safe % n] as ScorchSlot;
  return {
    x: slot.x + (jitterX - 0.5) * 2 * SCORCH_JITTER_PX,
    y: slot.y + (jitterY - 0.5) * 2 * SCORCH_JITTER_PX,
  };
}

// ---------------------------------------------------------------------------
// The hull the marks have to stay on
// ---------------------------------------------------------------------------

/**
 * THE FUSELAGE'S OWN SHAPE, MIRRORED FROM `lantern.ts`.
 *
 * `lantern.ts` declares `W`, `Y_TOP`, `Y_BOT` and `HULL_PROFILE` privately and
 * imports Phaser as a value, so neither this module nor a node unit test can
 * read them. They are copied here rather than guessed, and
 * `tests/unit/flight/scorchPlacement.test.ts` reads `lantern.ts` as SOURCE and
 * asserts the copy still matches it - so a change to the ship's silhouette
 * turns this red instead of quietly moving a mark off the hull.
 *
 * Splitting them into `lanternGeometry.ts` the way `LANTERN_DESIGN_HEIGHT` was
 * split would make it a real import and delete this note. It is not done here
 * because `render/lantern.ts` is the art lane's file.
 */
export const HULL_DESIGN_W = 80;
export const HULL_DESIGN_Y_TOP = -142;
export const HULL_DESIGN_Y_BOT = 128;
export const HULL_DESIGN_PROFILE: readonly number[] = [
  0.14, 0.52, 0.78, 0.94, 1.0, 0.99, 0.94, 0.84, 0.66,
];

/** `lantern.rampAt`: linear between equally spaced profile samples. */
function rampAt(samples: readonly number[], t: number): number {
  const last = samples.length - 1;
  const scaled = Math.max(0, Math.min(1, t)) * last;
  const i = Math.floor(scaled);
  const j = Math.min(last, i + 1);
  const f = scaled - i;
  return (samples[i] as number) + ((samples[j] as number) - (samples[i] as number)) * f;
}

/**
 * Half the fuselage's width at a given SCREEN y, measured from the ship's
 * anchor, at a given ship scale.
 *
 * `scale` is `FlightScene.SHIP_SCALE` - `SHIP_HALF_WIDTH_PX` over
 * `LANTERN_DESIGN_HALF_WIDTH` - so the caller passes the scale the ship is
 * actually drawn at rather than this module assuming one.
 */
export function hullHalfWidthAt(yPx: number, scale: number): number {
  const y = yPx / scale;
  if (y <= HULL_DESIGN_Y_TOP || y >= HULL_DESIGN_Y_BOT) return 0;
  const t = (y - HULL_DESIGN_Y_TOP) / (HULL_DESIGN_Y_BOT - HULL_DESIGN_Y_TOP);
  return HULL_DESIGN_W * rampAt(HULL_DESIGN_PROFILE, t) * scale;
}
