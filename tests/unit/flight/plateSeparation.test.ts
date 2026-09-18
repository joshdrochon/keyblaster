import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type LivePlateTrack,
  type PlateTrack,
  ROCK_DRIFT_PX,
  spawnX,
} from "@engine/spawn/index.js";
import { fallTimeMs } from "@engine/fallTime/index.js";
import {
  MIN_SPAWN_GAP_MS,
  expectedClearMs,
  observedBiasMs,
  spawnGapMs,
} from "@engine/pacing/index.js";
import {
  createSelectionState,
  pickNext,
  type SelectionState,
} from "@engine/selection/index.js";
import {
  type ControllerState,
  createController,
  hitRate,
  recordOutcome,
} from "@engine/controller/index.js";
import { MAX_LIVE_MAX, MAX_LIVE_MIN } from "@engine/controller/knobs.js";
import { applyEvent, blankRecord, type WordBook } from "@engine/words/index.js";
import {
  DEFAULT_CALIBRATION,
  type Calibration,
  type StopId,
  stageIndexOf,
} from "@engine/types.js";
import {
  SPAWN_MARGIN_PX,
  mulberry32,
  retentionPoolFor,
  stagePoolFor,
} from "@game/flight/stage.js";
import { asteroidSizePx } from "@game/render/asteroid.js";
// THE RENDERER'S OWN GEOMETRY, imported rather than restated. `wordPlate.ts`
// used to be unloadable here because it extends a Phaser class; the pure half
// now lives in `wordPlateGeometry.ts` and this file binds to it, so a change to
// the plate's width moves this measurement instead of silently escaping it.
import {
  type WordPlateStyle,
  plateHalfHeightPx,
  plateOffsetY,
  plateSize,
} from "@game/render/wordPlateGeometry.js";

/**
 * UR-23, SECOND FACE: A WORD PLATE DRAWING OVER ANOTHER WORD PLATE.
 *
 * ================== THE REPORT AND THE NUMBER ==================
 * "Rocks covering the words" is the most-repeated complaint in this project.
 * It was answered twice - the plate was made opaque, and the plate layer was
 * lifted above the whole world - and both answers are about the WORLD reaching
 * a word. Neither touches a plate reaching one. Every plate is in the same
 * container in the same order in every frame, so the pixel diff
 * `plate-legibility.spec.ts` runs cancels it exactly, and that spec counts the
 * overlaps geometrically instead. Its artifact, `gauntlet/evidence/plate-overdraw.json`,
 * at `maxLive` 7 across the six belted stops, belt plates only:
 *
 *     plateOnPlateBeltOnly: 2      worstBeltOnlyOverlap: 0.347
 *
 * A third of a word behind another word is a letter and a half of a four-letter
 * word gone, and a child cannot type what they cannot read.
 *
 * ================== WHY THIS FILE AND NOT A SCREENSHOT ==================
 * That spec freezes ONE board per stop and measures the rectangles in it. A
 * board is a sample: which words the picker served, how far apart the pacer fed
 * them, and where the seeded rng put each column. Two overlapping pairs in six
 * frozen frames is a lower bound on a property that is really about every
 * instant of every belt.
 *
 * So this is the same measurement taken over TIME rather than over one shutter:
 * the real picker, the real fall times, the real pacer and the real column rule
 * fly a board, every rock's whole trajectory is recorded, and the resulting
 * plate rectangles are swept at 60 Hz - the rate the child actually sees. It is
 * arithmetic over rectangles, so the whole sweep below runs in well under a
 * second, and a defect that needs a lucky frame to show up cannot hide from it.
 *
 * ================== WHAT IT SWEEPS (coding-standards rule 5) ==================
 * Every belted stop, every reachable `maxLive` from the floor to the cap, both
 * letter-spacing settings (D41's increased spacing makes every plate 4 px per
 * letter wider, so it is the harder case and not a cosmetic option), three
 * pilots, and eight seeds - and two board generators, because the paced belt
 * and the deepest board the cap allows are different questions. The
 * asteroid-visibility gate that booted Mars only let Uranus pass the defect it
 * existed to catch; this one names every stop it measured in its own artifact.
 *
 * ================== WATCHED FAILING ==================
 * `L-plate-on-plate` below is the negative control and it runs on every
 * invocation: the identical sweep with the keep-out removed from the column
 * rule, which is the code that shipped before this change. It is not a
 * restatement of the fix - it calls `spawnX` with the plate description left
 * out, which is exactly the shipped signature it replaced.
 *
 * With the keep-out taken back out of `spawnX` - the shipped rule, restored -
 * the positive assertion produces, on this machine:
 *
 *   the belt put a word over a word: 2524 boards, worst 100.0% of "hundreds"
 *   and "bits" (saturn, maxLive 6, grade2, spacing 1, saturated, seed 7)
 *   expected 0.9999967850723824 to be +0
 *
 * 2524 of 3456 boards, and the worst case is a word ENTIRELY behind another
 * word. The frozen-frame figure the ticket carries - two pairs across six
 * boards, 34.7% - is the same defect seen through one shutter per stop; a sweep
 * over every frame of every board finds both far more of it and a far worse
 * worst case, which is the point of sweeping.
 *
 *   npx vitest run tests/unit/flight/plateSeparation.test.ts --coverage.enabled=false
 */

// ---------------------------------------------------------------------------
// The board, in the scene's own numbers
// ---------------------------------------------------------------------------

/**
 * `sceneKeys.GAME_HEIGHT`, and `GAME_WIDTH` at the 16:9 floor.
 *
 * THE FLOOR AND NOT THE ARTBOARD. `GAME_WIDTH` flexes with the window and may
 * only get WIDER than 1920 (sceneKeys: "It may not get NARROWER"). A wider
 * board is a strictly easier board for this rule - the playable span grows and
 * nothing else does - so measuring at the narrowest window the game supports
 * measures the hardest one.
 */
const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
/** `FlightScene.buildShip`: `shipY = height - 150`, `breachY = shipY - 74`. */
const SHIP_X = GAME_WIDTH / 2;
const BREACH_Y = GAME_HEIGHT - 150 - 74;
/** `FlightScene.SHIP_HALF_WIDTH_PX`. */
const SHIP_HALF_WIDTH_PX = 46;
/** 60 fps is the target (AC-22.9), so it is the rate a plate is looked at. */
const FRAME_MS = 1000 / 60;

/** Every stop with a belt. The same set `flight.spec.ts` and UR-23 sweep. */
const BELTED_STOPS: readonly StopId[] = [
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

/** `FlightScene.plateStyle`, at both of D41's letter-spacing settings. */
const styleAt = (letterSpacingPx: number): WordPlateStyle => ({
  plate: "#0E1116",
  plateText: "#F7FAFF",
  accent: "#FFC857",
  fontFamily: "'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif",
  fontSizePx: 30,
  letterSpacingPx,
  uppercase: false,
  reducedMotion: false,
});

interface Pilot {
  readonly name: string;
  readonly calibration: Calibration;
}

/** A fast, a median and the grade-2 model the independent playthrough used. */
const PILOTS: readonly Pilot[] = [
  { name: "fast", calibration: { ikiMs: 260, fkLatencyMs: 380 } },
  { name: "median", calibration: DEFAULT_CALIBRATION },
  { name: "grade2", calibration: { ikiMs: 600, fkLatencyMs: 700 } },
];

// ---------------------------------------------------------------------------
// One rock's whole life, as rectangles
// ---------------------------------------------------------------------------

interface SimRock {
  readonly word: string;
  readonly homeX: number;
  readonly driftPhase: number;
  readonly spawnedAtMs: number;
  readonly fallMs: number;
  readonly rockFromY: number;
  readonly rockToY: number;
  readonly plateOffsetY: number;
  readonly plateHalfW: number;
  readonly plateHalfH: number;
  /** When it left the board: blasted, breached or sailed past. */
  retiredAtMs: number;
}

/** `FlightScene.updateRocks`, restated as arithmetic over the recorded rock. */
function plateRectAt(rock: SimRock, atMs: number): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const progress = rock.fallMs > 0 ? (atMs - rock.spawnedAtMs) / rock.fallMs : 1;
  const clamped = Math.max(0, Math.min(1, progress));
  const rockY = rock.rockFromY + (rock.rockToY - rock.rockFromY) * clamped;
  const x = rock.homeX + Math.sin(atMs / 1400 + rock.driftPhase) * ROCK_DRIFT_PX;
  const y = rockY + rock.plateOffsetY;
  return {
    left: x - rock.plateHalfW,
    right: x + rock.plateHalfW,
    top: y - rock.plateHalfH,
    bottom: y + rock.plateHalfH,
  };
}

interface Overlap {
  readonly words: readonly [string, string];
  /** Of the SMALLER plate's area, matching `plate-legibility.spec.ts`. */
  readonly coveredFraction: number;
  readonly atMs: number;
}

/**
 * The worst a plate is covered by another plate, at any frame of this board.
 *
 * `plate-legibility.spec.ts`'s own measure: the intersection as a fraction of
 * the SMALLER of the two rectangles, because the word at risk is the one with
 * less of itself left.
 */
function worstOverlap(rocks: readonly SimRock[], untilMs: number): Overlap | null {
  let worst: Overlap | null = null;
  for (let t = 0; t <= untilMs; t += FRAME_MS) {
    const live = rocks.filter((r) => t >= r.spawnedAtMs && t <= r.retiredAtMs);
    for (let a = 0; a < live.length; a += 1) {
      for (let b = a + 1; b < live.length; b += 1) {
        const p = plateRectAt(live[a] as SimRock, t);
        const q = plateRectAt(live[b] as SimRock, t);
        const ow = Math.min(p.right, q.right) - Math.max(p.left, q.left);
        const oh = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
        if (ow <= 0 || oh <= 0) continue;
        const smaller = Math.min(
          (p.right - p.left) * (p.bottom - p.top),
          (q.right - q.left) * (q.bottom - q.top),
        );
        const fraction = (ow * oh) / smaller;
        if (worst === null || fraction > worst.coveredFraction) {
          worst = {
            words: [(live[a] as SimRock).word, (live[b] as SimRock).word],
            coveredFraction: fraction,
            atMs: t,
          };
        }
      }
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// The belt
// ---------------------------------------------------------------------------

interface BoardSpec {
  readonly stopId: StopId;
  readonly maxLive: number;
  readonly pilot: Pilot;
  readonly style: WordPlateStyle;
  readonly seed: number;
  /**
   * `paced` is the shipped feed out of `@engine/pacing`. `saturated` replaces
   * the derived gap with `MIN_SPAWN_GAP_MS`, the floor that module clamps every
   * gap to - so it is the FASTEST belt the game can produce, and therefore the
   * deepest and most crowded board a child can ever be shown. It is how
   * `plate-legibility.spec.ts`'s frozen board, which waited for seven rocks,
   * is reached on purpose instead of by luck.
   *
   * NOT ZERO, and that is a measurement rather than a convenience. A zero-gap
   * feed puts seven rocks on the board inside one frame, and no column rule can
   * place them: seven plates at D41's spacing need 7 x (84.8 + 84.8 + 20) =
   * 1327 px of separation on a playable span of 1280. The scene cannot produce
   * that board either - `trySpawn` runs once per `update`, `@engine/pacing`
   * clamps every gap to 600 ms, and AC-6e.3's empty-board fast path can only
   * jump the queue by ONE rock because it requires the board to be empty. A
   * control set outside what the product can do measures the harness.
   */
  readonly feed: "paced" | "saturated";
  /**
   * FALSE reverts the fix: `spawnX` is called without a plate description,
   * which is the exact signature the shipped column rule had before UR-23's
   * second pass. The negative control, not a restatement of it.
   */
  readonly separate: boolean;
}

interface BoardResult {
  readonly rocks: readonly SimRock[];
  readonly peakLive: number;
  readonly untilMs: number;
}

/**
 * Fly one board and record every rock's geometry.
 *
 * THE PLAYER MODEL IS DELIBERATELY THIN, and it is thin in the safe direction.
 * This file asks where rocks are, not whether a child can clear them - the
 * belt's survivability is `tests/unit/simulation/belt.test.ts`'s question and
 * that harness answers it properly. What matters here is that the board is fed
 * by the real pacer and filled to the real cap, so the model is: one serial
 * typist, lowest rock first (AC-2.1 makes the lock unambiguous, so a child can
 * only answer one), first key then one interval per remaining letter, no
 * mistakes. A perfect typist clears rocks FASTER, which empties the board
 * faster, which makes overlaps rarer - so every overlap this finds is one a
 * real player's fuller board would also have.
 */
function flyBoard(spec: BoardSpec): BoardResult {
  const rng = mulberry32(spec.seed);
  const stage = stageIndexOf(spec.stopId);
  const stagePool = stagePoolFor(spec.stopId);
  const earlier = BELTED_STOPS.slice(0, BELTED_STOPS.indexOf(spec.stopId));
  let selection: SelectionState = createSelectionState({
    stage,
    stagePool,
    retentionPool: retentionPoolFor(earlier),
    book: {},
  });
  let controller: ControllerState = createController({
    knobs: { maxLive: spec.maxLive },
  });
  let book: WordBook = {};

  const rocks: SimRock[] = [];
  let live: SimRock[] = [];
  let busy: { rock: SimRock; doneAtMs: number } | null = null;
  let nowMs = 0;
  let nextSpawnAtMs = 0;
  const residuals: number[] = [];
  /** 58 words is the shipped stage (`DEFAULT_FLIGHT_CONFIG.stageWordCount`). */
  const spawnCount = 58;
  let spawned = 0;
  let peakLive = 0;
  let guard = 0;

  const retire = (rock: SimRock, atMs: number): void => {
    rock.retiredAtMs = atMs;
    live = live.filter((r) => r !== rock);
  };

  while ((spawned < spawnCount || live.length > 0) && (guard += 1) < 200_000) {
    if (busy !== null && busy.doneAtMs <= nowMs) {
      const rock = busy.rock;
      book = {
        ...book,
        [rock.word]: applyEvent(book[rock.word] ?? blankRecord(), {
          kind: "hit",
          fkLatencyMs: spec.pilot.calibration.fkLatencyMs,
          ikiMs: [spec.pilot.calibration.ikiMs],
          atMs: nowMs,
          stage,
        }),
      };
      controller = recordOutcome(controller, "blasted");
      retire(rock, nowMs);
      busy = null;
      continue;
    }

    const due = live.find((r) => r.spawnedAtMs + r.fallMs <= nowMs);
    if (due !== undefined) {
      book = {
        ...book,
        [due.word]: applyEvent(book[due.word] ?? blankRecord(), {
          kind: "miss",
          atMs: nowMs,
          stage,
        }),
      };
      controller = recordOutcome(controller, "missed");
      retire(due, nowMs);
      if (busy !== null && busy.rock === due) busy = null;
      continue;
    }

    const boardEmpty = live.length === 0;
    const mayFeed =
      spawned < spawnCount &&
      live.length < controller.knobs.maxLive &&
      (boardEmpty || nowMs >= nextSpawnAtMs);
    if (mayFeed) {
      const outcome = pickNext(selection, {
        live: live.map((r) => r.word),
        book,
        rng,
      });
      if (!outcome.ok) {
        nextSpawnAtMs = nowMs + 200;
        if (boardEmpty) nowMs += 200;
        continue;
      }
      selection = outcome.state;
      const word = outcome.word;
      const record = book[word] ?? blankRecord();
      const letters = [...word].length;
      const sizePx = asteroidSizePx(letters);
      const offsetY = plateOffsetY(sizePx, spec.style);
      const half = plateSize(word, spec.style).width / 2;
      const halfH = plateHalfHeightPx(spec.style);
      const fallMs = fallTimeMs({
        word,
        ease: record.ease,
        calibration: {
          ...spec.pilot.calibration,
          ikiMs: Math.max(spec.pilot.calibration.ikiMs, DEFAULT_CALIBRATION.ikiMs),
        },
        knobs: controller.knobs,
      });

      const track: PlateTrack = {
        halfWidthPx: half,
        halfHeightPx: halfH,
        fromY: -sizePx + offsetY,
        toY: BREACH_Y + offsetY,
        spawnedAtMs: nowMs,
        fallMs,
      };
      const livePlates: readonly LivePlateTrack[] = live.map((r) => ({
        homeX: r.homeX,
        halfWidthPx: r.plateHalfW,
        halfHeightPx: r.plateHalfH,
        fromY: r.rockFromY + r.plateOffsetY,
        toY: r.rockToY + r.plateOffsetY,
        spawnedAtMs: r.spawnedAtMs,
        fallMs: r.fallMs,
      }));
      // `FlightScene.laneSpec`, verbatim: the keep-out is sized by the WIDER of
      // the rock and its plate.
      const homeX = spawnX(
        {
          width: GAME_WIDTH,
          marginPx: SPAWN_MARGIN_PX,
          shipX: SHIP_X,
          shipHalfWidthPx: SHIP_HALF_WIDTH_PX,
          rockHalfWidthPx: Math.max(sizePx / 2, half),
          ...(spec.separate ? { plate: track, livePlates } : {}),
        },
        rng,
        outcome.practice,
      );
      const rock: SimRock = {
        word,
        homeX,
        driftPhase: rng() * Math.PI * 2,
        spawnedAtMs: nowMs,
        fallMs,
        rockFromY: -sizePx,
        rockToY: BREACH_Y,
        plateOffsetY: offsetY,
        plateHalfW: half,
        plateHalfH: halfH,
        retiredAtMs: nowMs + fallMs,
      };
      // `spinPerSec`, consumed so the seeded stream matches `spawnRock`'s.
      rng();
      rocks.push(rock);
      live.push(rock);
      peakLive = Math.max(peakLive, live.length);
      spawned += 1;

      const gap = spawnGapMs({
        liveClearMs: live.map((r) =>
          expectedClearMs({
            length: [...r.word].length,
            ease: (book[r.word] ?? blankRecord()).ease,
            calibration: spec.pilot.calibration,
          }),
        ),
        servedMs: busy === null ? 0 : nowMs - busy.rock.spawnedAtMs,
        fallMs,
        biasMs: observedBiasMs(residuals),
        knobs: controller.knobs,
        hitRate: hitRate(controller),
      });
      nextSpawnAtMs = nowMs + (spec.feed === "saturated" ? MIN_SPAWN_GAP_MS : gap);
      continue;
    }

    if (busy === null && live.length > 0) {
      const target = live.reduce((a, b) =>
        b.spawnedAtMs + b.fallMs < a.spawnedAtMs + a.fallMs ? b : a,
      );
      const letters = [...target.word].length;
      const need =
        spec.pilot.calibration.fkLatencyMs +
        Math.max(0, letters - 1) * spec.pilot.calibration.ikiMs;
      busy = { rock: target, doneAtMs: nowMs + need };
      continue;
    }

    const candidates: number[] = [];
    if (busy !== null) candidates.push(busy.doneAtMs);
    for (const r of live) candidates.push(r.spawnedAtMs + r.fallMs);
    if (spawned < spawnCount && live.length < controller.knobs.maxLive) {
      candidates.push(nextSpawnAtMs);
    }
    const next = Math.min(...candidates.filter((t) => t > nowMs));
    if (!Number.isFinite(next)) break;
    nowMs = next;
  }

  return { rocks, peakLive, untilMs: nowMs };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface Reading {
  readonly stopId: StopId;
  readonly maxLive: number;
  readonly pilot: string;
  readonly letterSpacingPx: number;
  readonly seed: number;
  readonly feed: "paced" | "saturated";
  readonly peakLive: number;
  readonly rocks: number;
  readonly columns: readonly number[];
  readonly worst: Overlap | null;
}

const SEEDS = [0x9101, 1, 2, 3, 4, 5, 6, 7];

function sweep(separate: boolean): Reading[] {
  const out: Reading[] = [];
  for (const stopId of BELTED_STOPS) {
    for (let maxLive = MAX_LIVE_MIN; maxLive <= MAX_LIVE_MAX; maxLive += 1) {
      for (const pilot of PILOTS) {
        for (const letterSpacingPx of [1, 5]) {
          for (const feed of ["paced", "saturated"] as const) {
            for (const seed of SEEDS) {
              const board = flyBoard({
                stopId,
                maxLive,
                pilot,
                style: styleAt(letterSpacingPx),
                seed,
                feed,
                separate,
              });
              out.push({
                stopId,
                maxLive,
                pilot: pilot.name,
                letterSpacingPx,
                seed,
                feed,
                peakLive: board.peakLive,
                rocks: board.rocks.length,
                columns: board.rocks.map((r) => r.homeX),
                worst: worstOverlap(board.rocks, board.untilMs),
              });
            }
          }
        }
      }
    }
  }
  return out;
}

const describeWorst = (r: Reading): string =>
  r.worst === null
    ? "clean"
    : `${(r.worst.coveredFraction * 100).toFixed(1)}% of "${r.worst.words[0]}" and ` +
      `"${r.worst.words[1]}" (${r.stopId}, maxLive ${r.maxLive}, ${r.pilot}, ` +
      `spacing ${r.letterSpacingPx}, ${r.feed}, seed ${r.seed})`;

describe("UR-23 / AC-22.8: a word plate never covers another word plate", () => {
  const shipped = sweep(true);
  const reverted = sweep(false);

  const worstOf = (rs: readonly Reading[]): Reading | null =>
    rs.reduce<Reading | null>(
      (a, b) =>
        a === null || (b.worst?.coveredFraction ?? 0) > (a.worst?.coveredFraction ?? 0) ? b : a,
      null,
    );
  const overlapping = (rs: readonly Reading[]): Reading[] => rs.filter((r) => r.worst !== null);

  it("the sweep is not vacuous: every belted stop, every knob, a full board", () => {
    // ANTI-VACUITY FIRST. A sweep of boards that never got deep would report a
    // clean result about a game nobody plays, which is instance 2 and 3 in
    // docs/verification-gaps.md with the names changed.
    expect(new Set(shipped.map((r) => r.stopId))).toEqual(new Set(BELTED_STOPS));
    for (const stopId of BELTED_STOPS) {
      const atCap = shipped.filter(
        (r) => r.stopId === stopId && r.maxLive === MAX_LIVE_MAX && r.feed === "saturated",
      );
      expect(atCap.length, `${stopId}: boards flown at the cap`).toBeGreaterThan(0);
      expect(
        Math.max(...atCap.map((r) => r.peakLive)),
        `${stopId}: deepest board reached at maxLive ${MAX_LIVE_MAX}`,
      ).toBe(MAX_LIVE_MAX);
    }
    expect(
      Math.min(...shipped.map((r) => r.rocks)),
      "every board must have put rocks on the belt",
    ).toBeGreaterThan(5);
  });

  /**
   * L-plate-on-plate: THE CONTROL, RUN EVERY TIME.
   *
   * `separate: false` calls `spawnX` with no plate description, which is the
   * shipped signature before this change - so this is the old column rule
   * flying the identical boards, not a re-implementation of it. Asserting that
   * it is bad is what stops the positive assertion above from being a statement
   * about a harness that cannot see anything.
   */
  it("L-plate-on-plate: the column rule without the keep-out puts words over words", () => {
    const hits = overlapping(reverted);
    const worst = worstOf(reverted);
    expect(
      hits.length,
      "the old column rule produced no overlap at all, so this sweep proves nothing",
    ).toBeGreaterThan(0);
    // The frozen-frame artifact recorded 34.7% on belt plates at maxLive 7; a
    // sweep over every frame of every board must at least reach that, or it is
    // looking at a smaller board than the one the ticket is about.
    expect(
      worst?.worst?.coveredFraction ?? 0,
      `the reverted sweep's worst case: ${worst === null ? "none" : describeWorst(worst)}`,
    ).toBeGreaterThan(0.347);
    // AND IT IS NOT A ONE-STOP DEFECT. The asteroid-visibility gate booted Mars
    // only and Uranus passed the defect; naming the stops keeps that honest.
    expect(new Set(hits.map((h) => h.stopId)).size, "stops with an overlap").toBeGreaterThan(1);
  });

  it("the shipped column rule produces no overlap at any stop, knob or seed", () => {
    const worst = worstOf(shipped);
    expect(
      worst?.worst?.coveredFraction ?? 0,
      `the belt put a word over a word: ${overlapping(shipped).length} boards, ` +
        `worst ${worst === null ? "none" : describeWorst(worst)}`,
    ).toBe(0);
  });

  /**
   * THE SWEEP ABOVE CALLS `spawnX` ITSELF, SO IT CANNOT SEE THE WIRING.
   *
   * Everything above proves the RULE is right. None of it would notice if
   * `FlightScene.spawnRock` stopped handing the rule the plate it is about -
   * `spawnX` would quietly fall back to the uniform pick, every board would go
   * back to putting words over words, and this file would stay green. That is
   * coding-standards rule 3's blind spot with the names changed: the guard
   * judged a drawing the game never used.
   *
   * `FlightScene.ts` extends a Phaser class and cannot be imported under
   * vitest's node environment, so this is a source guard, the same binding
   * `tests/unit/render/wordPlateOpacity.test.ts` uses for the same reason.
   *
   * WATCHED FAILING, with `spawnRock` reverted to `this.laneSpec(sizePx, word)`:
   *
   *   spawnRock no longer hands the column rule the arriving plate, so
   *   @engine/spawn cannot know what it is separating: expected false to be true
   *
   * and with `updateRocks` put back to the literal `* 10`:
   *
   *   updateRocks sways a rock by a literal rather than by ROCK_DRIFT_PX, so
   *   the keep-out is sized for a drift the scene may not be using:
   *   expected false to be true
   */
  it("FlightScene hands the column rule the plate and the board it is about", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/FlightScene.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(
      /spawnX\(\s*this\.laneSpec\(sizePx,\s*word,\s*track\)/.test(source),
      "spawnRock no longer hands the column rule the arriving plate, so " +
        "@engine/spawn cannot know what it is separating",
    ).toBe(true);
    expect(
      /livePlates:\s*this\.livePlateTracks\(\)/.test(source),
      "laneSpec no longer forwards the live plates, so the keep-out has nothing to avoid",
    ).toBe(true);
    expect(
      /rock\.homeX \+ Math\.sin\([^)]*\) \* ROCK_DRIFT_PX/.test(source),
      "updateRocks sways a rock by a literal rather than by ROCK_DRIFT_PX, so " +
        "the keep-out is sized for a drift the scene may not be using",
    ).toBe(true);
  });

  /**
   * THE CURE MUST NOT BE THE OLD DISEASE.
   *
   * A keep-out that a deep board cannot satisfy degrades to
   * `leastCoveredColumn`, and that is deterministic - so a rule that ran out of
   * room often would pile every rock onto two columns at the edges of the
   * playfield. "A foreground that occupies both edges IS the border a player
   * reported three times" is already in `FlightScene`'s own notes about the
   * lane guard, and a belt that put every word there would be the same picture
   * arriving from the other direction.
   *
   * WATCHED FAILING, by forcing every spawn down the degrade path (`spawnX`
   * with `spans` hard-coded empty, so `leastCoveredColumn` decides every
   * column):
   *
   *   the busiest tenth of the board takes 64.8% of all rocks:
   *   [0.648,0,0.006,0.006,0.013,0.049,0.011,0.003,0,0.263]
   *   expected 0.648 to be less than 0.25
   *
   * A FLAT PLATE-WIDTH SEPARATION FROM EVERY LIVE ROCK - the wider rule this
   * one was weighed against - does NOT fail this check. It fails the one above
   * instead, and by more than doing nothing would in most frames: measured on
   * the identical sweep with `platesCanMeetVertically` removed, so every live
   * rock takes a band,
   *
   *   the belt put a word over a word: 286 boards, worst 39.2% of "gravity" and
   *   "empty" (jupiter, maxLive 7, grade2, spacing 5, saturated, seed 5)
   *
   * because seven plates' worth of bands do not fit on a 1280 px span, so the
   * rule spends a deep board inside its own fallback and puts words on top of
   * each other anyway. That is the measurement behind choosing the narrower
   * question over the wider rule.
   */
  it("still uses the whole playable width", () => {
    const from = SPAWN_MARGIN_PX;
    const to = GAME_WIDTH - SPAWN_MARGIN_PX;
    const bins = new Array<number>(10).fill(0);
    let total = 0;
    for (const reading of shipped) {
      for (const x of reading.columns) {
        const bin = Math.min(9, Math.max(0, Math.floor(((x - from) / (to - from)) * 10)));
        bins[bin] = (bins[bin] as number) + 1;
        total += 1;
      }
    }
    const share = bins.map((n) => Number((n / total).toFixed(3)));
    expect(
      bins.filter((n) => n > 0).length,
      `the belt uses ${bins.filter((n) => n > 0).length} of the playable span's ` +
        `10 columns: ${JSON.stringify(share)}`,
    ).toBeGreaterThanOrEqual(9);
    // And no tenth of the board carries more than a quarter of every rock the
    // sweep spawned, which a rule falling back to its edges could not manage.
    expect(
      Math.max(...share),
      `the busiest tenth of the board takes ${(Math.max(...share) * 100).toFixed(1)}% of all rocks: ${JSON.stringify(share)}`,
    ).toBeLessThan(0.25);
  });

  it("writes the evidence", () => {
    const dir = resolve(process.cwd(), "gauntlet/evidence");
    mkdirSync(dir, { recursive: true });
    const summarise = (rs: readonly Reading[]): unknown => {
      const worst = worstOf(rs);
      return {
        boards: rs.length,
        boardsWithOverlap: overlapping(rs).length,
        worstCoveredFraction: Number((worst?.worst?.coveredFraction ?? 0).toFixed(4)),
        worst: worst === null ? null : describeWorst(worst),
        byStop: Object.fromEntries(
          BELTED_STOPS.map((stopId) => {
            const at = rs.filter((r) => r.stopId === stopId);
            const w = worstOf(at);
            return [
              stopId,
              {
                boards: at.length,
                withOverlap: overlapping(at).length,
                worst: Number((w?.worst?.coveredFraction ?? 0).toFixed(4)),
                peakLive: Math.max(...at.map((r) => r.peakLive)),
              },
            ];
          }),
        ),
        byMaxLive: Object.fromEntries(
          Array.from({ length: MAX_LIVE_MAX - MAX_LIVE_MIN + 1 }, (_, i) => {
            const maxLive = MAX_LIVE_MIN + i;
            const at = rs.filter((r) => r.maxLive === maxLive);
            const w = worstOf(at);
            return [
              maxLive,
              {
                withOverlap: overlapping(at).length,
                worst: Number((w?.worst?.coveredFraction ?? 0).toFixed(4)),
              },
            ];
          }),
        ),
      };
    };
    writeFileSync(
      resolve(dir, "plate-separation.json"),
      `${JSON.stringify(
        {
          ticket: "UR-23",
          claim:
            "AC-22.8: at every belted stop, every maxLive the controller can reach, both letter-spacing settings, three pilots, eight seeds and two feed rates, no word plate ever overlaps another word plate at any 60 Hz frame of the belt",
          measure: "tests/unit/flight/plateSeparation.test.ts",
          method:
            "the real picker, fall times, pacer and column rule fly a board; every rock's trajectory is recorded and the plate rectangles are swept at 60 Hz. Overlap is the intersection as a fraction of the smaller plate, the same measure plate-legibility.spec.ts uses on a frozen frame.",
          frameHz: 60,
          stops: BELTED_STOPS,
          maxLive: [MAX_LIVE_MIN, MAX_LIVE_MAX],
          seeds: SEEDS,
          pilots: PILOTS.map((p) => p.name),
          letterSpacingPx: [1, 5],
          gameWidth: GAME_WIDTH,
          shipped: summarise(shipped),
          revertedControl: summarise(reverted),
          frozenFrameArtifact: {
            source: "gauntlet/evidence/plate-overdraw.json",
            plateOnPlateBeltOnly: 2,
            worstBeltOnlyOverlap: 0.347,
          },
          limitations: [
            "it measures rectangles, not pixels: a plate is a rounded rectangle and its corners are sky, so an overlap confined to a corner radius would be counted here and be invisible on screen. That is the conservative direction.",
            "the typist is perfect and serial. A player who misses clears the board more slowly and therefore holds a fuller board; this measures the emptier one, so it is a lower bound on how crowded a real belt gets.",
            "a rock's life ends at the breach line. FlightScene.passBy then tweens a practice rock's plate 80 px sideways and off the bottom of the frame over 620 ms while fading it to nothing, and the keep-out does not cover that tail. It is a plate on its way out at falling alpha rather than a word the child is being asked to read, and the rule cannot cover it without reserving a column for a rock that has already left.",
          ],
        },
        null,
        2,
      )}\n`,
    );
    expect(true).toBe(true);
  });
});
