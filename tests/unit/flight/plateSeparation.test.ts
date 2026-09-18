import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type LivePlateTrack,
  type PlateTrack,
  ROCK_ANGLE_MAX_PX,
  ROCK_DRIFT_PX,
  hasCleanColumn,
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
import {
  liveWordsOf,
  nestedFallMs,
  nestedShellSizePx,
  nestingAllowed,
  nestingDrawPasses,
} from "@engine/nested/index.js";
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
 * ================== UR-83 PUT THE ROCKS ON AN ANGLE ==================
 * A rock's column now SLIDES up to `ROCK_ANGLE_MAX_PX` over its fall, so the
 * keep-out's old arithmetic - a band centred on where the other rock started -
 * is no longer a guarantee about where either rock is. `plateKeepOuts` widens
 * every band by both rocks' travel to cover it.
 *
 * WATCHED FAILING, with the real number: put `plateKeepOuts` back to
 * `other.homeX +/- reach` - the band that is exactly right for two rocks that
 * keep their columns - and this same sweep, with the angle modelled below,
 * reads
 *
 *   the belt put a word over a word: 479 boards, worst 53.9% of "chunks" and
 *   "thin" (saturn, maxLive 7, fast, spacing 1, saturated, seed 2)
 *   expected 0.5392569435095811 to be +0
 *
 * 479 of 3456 boards, and half a word gone. That is the guarantee the angle
 * would have quietly broken, and it is why `travelPx` is on `PlateTrack` and on
 * every live plate the scene hands over.
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

/**
 * `FlightScene.rockDraws`, restated. UR-83 gives every rock two draws made
 * BEFORE the column rule runs - its fall-time spread and how far its column
 * slides on the way down - and they come from their own stream seeded by
 * (stage seed, rock index) rather than from `this.rng`, so that a DECLINED tick
 * costs nothing and `this.rng`'s order is untouched. A harness that drew them
 * from `rng` would fly a different belt AND shift every column.
 */
function rockDraws(
  seed: number,
  index: number,
): { spread: number; travelPx: number; nest: number } {
  const rng = mulberry32((seed ^ 0x5f3a9c2b) + index * 0x9e3779b1);
  const spread = rng();
  const travelPx = (rng() - 0.5) * 2 * ROCK_ANGLE_MAX_PX;
  // D101's nesting draw, taken LAST so `spread` and `travelPx` are the same two
  // numbers this sweep has always used and every board it has ever measured is
  // the same board. The scene draws them in this order for this reason.
  return { spread, travelPx, nest: rng() };
}

interface SimRock {
  /**
   * D101: WHICH PHYSICAL ROCK THIS PLATE BELONGS TO.
   *
   * A two-layer rock contributes TWO entries here - the shell's plate and the
   * core's - because they are two different rectangles the child is asked to
   * read. They are never on screen at the same time (one replaces the other),
   * so `worstOverlap` skips pairs that share this id; everything else in the
   * sweep treats them as the two plates they are.
   */
  readonly rockId: string;
  /** D101: this entry is the plate that appears AFTER the shell breaks. */
  readonly isCore: boolean;
  readonly word: string;
  readonly homeX: number;
  /** UR-83: signed px this column slides over the whole fall. */
  readonly travelPx: number;
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
  // UR-83's angle, exactly as `updateRocks` applies it: a CONSTANT sideways
  // rate over the same clamped progress the y uses, so the rock has been on
  // this line since it entered the frame.
  const x =
    rock.homeX +
    rock.travelPx * clamped +
    Math.sin(atMs / 1400 + rock.driftPhase) * ROCK_DRIFT_PX;
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
        // D101: A ROCK NEVER COVERS ITSELF. The shell's plate and its core's
        // are recorded over the same window - which is the window the column
        // rule proves, because the break time belongs to the child - but only
        // one of them is ever drawn at a time. Counting the pair would be
        // counting a frame that cannot exist.
        if ((live[a] as SimRock).rockId === (live[b] as SimRock).rockId) continue;
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
  /**
   * D101's half of the rule. FALSE keeps two-layer rocks flying but stops
   * declaring the CORE's plate to the column rule - the exact state the shipped
   * proof would have been in if the feature had been added without extending
   * it. The negative control for `L-core-on-plate`.
   */
  readonly coreSeparate: boolean;
}

interface BoardResult {
  readonly rocks: readonly SimRock[];
  readonly peakLive: number;
  readonly untilMs: number;
  /** D101: two-layer rocks this board actually flew. */
  readonly nestedRocks: number;
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
  /**
   * D101: THIS IS A LIST OF PLATES, NOT OF ROCKS. A shelled rock puts two in
   * it, because the column rule has to clear both. The feed gate below counts
   * distinct `rockId`s, so `maxLive` still means what it has always meant.
   */
  let live: SimRock[] = [];
  let busy: { rock: SimRock; doneAtMs: number } | null = null;
  let nestedRocks = 0;
  let nowMs = 0;
  let nextSpawnAtMs = 0;
  const residuals: number[] = [];
  /** 58 words is the shipped stage (`DEFAULT_FLIGHT_CONFIG.stageWordCount`). */
  const spawnCount = 58;
  let spawned = 0;
  let peakLive = 0;
  let guard = 0;

  /** Retiring a rock retires BOTH of its plates (D101). */
  const retire = (rock: SimRock, atMs: number): void => {
    for (const entry of live) {
      if (entry.rockId === rock.rockId) entry.retiredAtMs = atMs;
    }
    live = live.filter((r) => r.rockId !== rock.rockId);
  };
  const liveRocks = (): number => new Set(live.map((r) => r.rockId)).size;
  /** One entry per rock - the shell's, which is what the typist answers first. */
  const shells = (): SimRock[] => live.filter((r) => !r.isCore);

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

    const due = shells().find((r) => r.spawnedAtMs + r.fallMs <= nowMs);
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

    const boardEmpty = liveRocks() === 0;
    const mayFeed =
      spawned < spawnCount &&
      liveRocks() < controller.knobs.maxLive &&
      (boardEmpty || nowMs >= nextSpawnAtMs);
    if (mayFeed) {
      // D101: both words of a shelled rock are live for AC-2.1's purposes, so
      // both are declared. `liveWordsOf` is the shared definition.
      const liveWords = shells().flatMap((r) =>
        liveWordsOf({
          word: r.word,
          coreWord: live.find((e) => e.rockId === r.rockId && e.isCore)?.word ?? null,
        }),
      );
      const outcome = pickNext(selection, {
        live: liveWords,
        book,
        rng,
      });
      if (!outcome.ok) {
        nextSpawnAtMs = nowMs + 200;
        if (boardEmpty) nowMs += 200;
        continue;
      }
      const word = outcome.word;
      const record = book[word] ?? blankRecord();
      // UR-83: the two per-rock draws, derived the way the scene derives them,
      // BEFORE the decline - fall time feeds the vertical test and the travel
      // feeds the keep-out, and a declined tick must re-derive the same pair.
      // D101 adds a third, taken last so the first two are unchanged.
      const draws = rockDraws(spec.seed, spawned);
      const budget = {
        ...spec.pilot.calibration,
        ikiMs: Math.max(spec.pilot.calibration.ikiMs, DEFAULT_CALIBRATION.ikiMs),
      };

      // ================== D101: DOES THIS ONE NEST? ==================
      // `FlightScene.trySpawn`, restated: the deterministic gate, the draw off
      // the rock's own stream, then a SECOND pick whose live set carries the
      // shell - which is what stops the two layers of one rock colliding under
      // AC-2.1. A core that comes back practice is refused, exactly as the
      // scene refuses it.
      let coreWord: string | null = null;
      let coreState = outcome.state;
      if (
        nestingAllowed({
          stopId: spec.stopId,
          nestedLive: new Set(live.filter((r) => r.isCore).map((r) => r.rockId)).size,
          wordsLeft: spawnCount - spawned,
          anyPractice: outcome.practice,
        }) &&
        nestingDrawPasses(spec.stopId, draws.nest)
      ) {
        const picked = pickNext(coreState, {
          live: [...(shells().flatMap((r) => [r.word])), word],
          book,
          rng,
        });
        if (picked.ok && !picked.practice) {
          coreWord = picked.word;
          coreState = picked.state;
        }
      }

      const letters = [...word].length;
      const sizePx =
        coreWord === null
          ? asteroidSizePx(letters)
          : nestedShellSizePx(asteroidSizePx(letters));
      const offsetY = plateOffsetY(sizePx, spec.style);
      const half = plateSize(word, spec.style).width / 2;
      const halfH = plateHalfHeightPx(spec.style);
      const shellFallMs = fallTimeMs({
        word,
        ease: record.ease,
        calibration: budget,
        knobs: controller.knobs,
        spread: draws.spread,
      });
      // D101: the pair falls at one constant rate over BOTH words' budgets.
      const fallMs =
        coreWord === null
          ? shellFallMs
          : nestedFallMs(
              shellFallMs,
              fallTimeMs({
                word: coreWord,
                ease: (book[coreWord] ?? blankRecord()).ease,
                calibration: budget,
                knobs: controller.knobs,
                spread: draws.spread,
              }),
            );

      const coreSizePx = coreWord === null ? 0 : asteroidSizePx([...coreWord].length);
      const coreOffsetY = coreWord === null ? 0 : plateOffsetY(coreSizePx, spec.style);
      const coreHalf = coreWord === null ? 0 : plateSize(coreWord, spec.style).width / 2;

      const track: PlateTrack = {
        halfWidthPx: half,
        halfHeightPx: halfH,
        fromY: -sizePx + offsetY,
        toY: BREACH_Y + offsetY,
        spawnedAtMs: nowMs,
        fallMs,
        travelPx: draws.travelPx,
      };
      // D101: the core's plate, over the SAME window. It shares the shell's
      // column, angle and fall line, so its whole trajectory is known here.
      const coreTrack: PlateTrack | undefined =
        coreWord === null
          ? undefined
          : {
              halfWidthPx: coreHalf,
              halfHeightPx: halfH,
              fromY: -sizePx + coreOffsetY,
              toY: BREACH_Y + coreOffsetY,
              spawnedAtMs: nowMs,
              fallMs,
              travelPx: draws.travelPx,
            };
      const livePlates: readonly LivePlateTrack[] = live.map((r) => ({
        homeX: r.homeX,
        travelPx: r.travelPx,
        halfWidthPx: r.plateHalfW,
        halfHeightPx: r.plateHalfH,
        fromY: r.rockFromY + r.plateOffsetY,
        toY: r.rockToY + r.plateOffsetY,
        spawnedAtMs: r.spawnedAtMs,
        fallMs: r.fallMs,
      }));
      // `FlightScene.laneSpec`, verbatim: the keep-out is sized by the WIDER of
      // the rock and its plate.
      const lane = {
        width: GAME_WIDTH,
        marginPx: SPAWN_MARGIN_PX,
        shipX: SHIP_X,
        shipHalfWidthPx: SHIP_HALF_WIDTH_PX,
        rockHalfWidthPx: Math.max(sizePx / 2, half),
        ...(spec.separate ? { plate: track, livePlates } : {}),
        // D101: the core's plate is declared only when the sweep is testing the
        // shipped rule. `coreSeparate: false` is the control - the rock still
        // nests and the core's plate still appears, the column rule is simply
        // never told about it.
        ...(spec.separate && spec.coreSeparate && coreTrack !== undefined
          ? { corePlate: coreTrack }
          : {}),
      };
      // THE BELT DECLINES RATHER THAN COVERS A WORD (AC-22.8).
      // `FlightScene.trySpawn`, verbatim: a board where every column would put
      // this word over another word does not get this word yet. Nothing is
      // spent - not the selection, not a seeded draw - so it is offered again
      // 200 ms later, by which time the plates it conflicted with have moved.
      // Without this the column rule is asked for a guarantee the board cannot
      // give: seven plates at D41 spacing need ~1516 px of a 1280 px span.
      if (spec.separate && !hasCleanColumn(lane, outcome.practice)) {
        nextSpawnAtMs = nowMs + 200;
        if (boardEmpty) nowMs += 200;
        continue;
      }
      selection = coreState;
      const homeX = spawnX(lane, rng, outcome.practice);
      const rockId = `rock-${rocks.length}`;
      const driftPhase = rng() * Math.PI * 2;
      const rock: SimRock = {
        rockId,
        isCore: false,
        word,
        homeX,
        travelPx: draws.travelPx,
        driftPhase,
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
      if (coreWord !== null) {
        // D101: the core's plate, recorded over the SHELL'S WHOLE WINDOW. That
        // is the strong reading and it is deliberate: the break time belongs to
        // the child, so the column has to be legal for the core whenever it
        // happens - including not at all. `worstOverlap` skips the pair that
        // shares this `rockId`, because the two are never drawn together.
        const coreRock: SimRock = {
          rockId,
          isCore: true,
          word: coreWord,
          homeX,
          travelPx: draws.travelPx,
          driftPhase,
          spawnedAtMs: nowMs,
          fallMs,
          rockFromY: -sizePx,
          rockToY: BREACH_Y,
          plateOffsetY: coreOffsetY,
          plateHalfW: coreHalf,
          plateHalfH: halfH,
          retiredAtMs: nowMs + fallMs,
        };
        rocks.push(coreRock);
        live.push(coreRock);
        nestedRocks += 1;
      }
      peakLive = Math.max(peakLive, liveRocks());
      spawned += coreWord === null ? 1 : 2;

      const gap = spawnGapMs({
        liveClearMs: shells().map((r) =>
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
      const target = shells().reduce((a, b) =>
        b.spawnedAtMs + b.fallMs < a.spawnedAtMs + a.fallMs ? b : a,
      );
      // D101: a shelled rock is TWO words of typing before it leaves the board,
      // so the typist is busy for both. Longer occupancy means a fuller board,
      // which is the conservative direction for this measurement.
      const core = live.find((e) => e.rockId === target.rockId && e.isCore);
      const letters =
        [...target.word].length + (core === undefined ? 0 : [...core.word].length);
      const words = core === undefined ? 1 : 2;
      const need =
        spec.pilot.calibration.fkLatencyMs * words +
        Math.max(0, letters - words) * spec.pilot.calibration.ikiMs;
      busy = { rock: target, doneAtMs: nowMs + need };
      continue;
    }

    const candidates: number[] = [];
    if (busy !== null) candidates.push(busy.doneAtMs);
    for (const r of live) candidates.push(r.spawnedAtMs + r.fallMs);
    if (spawned < spawnCount && liveRocks() < controller.knobs.maxLive) {
      candidates.push(nextSpawnAtMs);
    }
    const next = Math.min(...candidates.filter((t) => t > nowMs));
    if (!Number.isFinite(next)) break;
    nowMs = next;
  }

  return { rocks, peakLive, untilMs: nowMs, nestedRocks };
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
  /** D101: two-layer rocks this board flew. */
  readonly nestedRocks: number;
  readonly columns: readonly number[];
  readonly worst: Overlap | null;
}

const SEEDS = [0x9101, 1, 2, 3, 4, 5, 6, 7];

function sweep(separate: boolean, coreSeparate = true): Reading[] {
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
                coreSeparate,
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
                nestedRocks: board.nestedRocks,
                // One column per physical ROCK - a shelled rock's two plates
                // share a column and counting it twice would tilt the
                // width-usage histogram toward wherever shells happened to go.
                columns: board.rocks.filter((r) => !r.isCore).map((r) => r.homeX),
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
  // D101's own control: the feature flying, the core's plate never declared.
  const coreBlind = sweep(true, false);

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

  it("D101: the sweep actually flew two-layer rocks at Neptune and Pluto", () => {
    // ANTI-VACUITY FOR THE FEATURE. "Zero overlap" is worthless as a statement
    // about nested rocks if no nested rock was ever on a board.
    for (const stopId of BELTED_STOPS) {
      const nested = shipped
        .filter((r) => r.stopId === stopId)
        .reduce((n, r) => n + r.nestedRocks, 0);
      const expected = stopId === "neptune" || stopId === "pluto";
      expect(nested > 0, `${stopId} flew ${nested} two-layer rocks`).toBe(expected);
    }
  });

  /**
   * D101's CORE KEEP-OUT: WHAT IT IS WORTH, MEASURED, INCLUDING THE PART THAT
   * IS LESS THAN EXPECTED.
   *
   * `coreBlind` is the feature flying exactly as it ships with one line
   * removed - the core's plate is never declared to the column rule. Same
   * seeds, same picks, same shells, same reveals. It is the control this
   * extension was written to be judged against, and the honest reading of it is
   * NOT the one this file was expecting to write:
   *
   *   5080 two-layer rocks over 1152 boards
   *   the core's band moved the chosen column on  8  of those boards
   *   overlapping boards WITHOUT the core's band:  0
   *
   * So at the shipped nesting rate the band is CONSERVATIVE RATHER THAN
   * LOAD-BEARING: it is doing work - eight boards is not none - but on none of
   * the 3456 boards swept did omitting it actually put a word over a word. That
   * is reported rather than buried, because a control that fails to reproduce a
   * defect is evidence about the defect's reachability and not permission to
   * skip the guard.
   *
   * IT IS KEPT ANYWAY, AND THE REASON IS WHAT AC-22.8 IS. The AC says zero, and
   * zero is a guarantee rather than a measurement - "no board in 3456 happened
   * to hit it" is exactly the shape of claim this project has been bitten by
   * (docs/verification-gaps.md). The case the band guards is constructed and
   * shown to bite in `tests/unit/spawn/nestedKeepOut.test.ts`: a live plate
   * level with where the CORE's plate will be and clear of where the shell's
   * ever is, which the shell's own proof cannot see at all. It becomes
   * reachable here the moment `NESTED_SHARE` or `NESTED_MAX_LIVE` goes up, and
   * this number is what a future change to either should be re-read against.
   */
  it("D101: the core's keep-out is measured, and the figure is recorded", () => {
    let nestedBoards = 0;
    let movedColumns = 0;
    for (let i = 0; i < shipped.length; i += 1) {
      const a = shipped[i] as Reading;
      const b = coreBlind[i] as Reading;
      if (a.nestedRocks === 0) continue;
      nestedBoards += 1;
      if (JSON.stringify(a.columns) !== JSON.stringify(b.columns)) movedColumns += 1;
    }
    const nestedRocks = shipped.reduce((n, r) => n + r.nestedRocks, 0);
    // MEASURED, printed by this file: 5080 nested rocks, 1152 boards, 8 moved.
    expect(nestedRocks).toBe(5080);
    expect(nestedBoards).toBe(1152);
    expect(
      movedColumns,
      `the core's keep-out moved no column at all on ${nestedBoards} boards, ` +
        "so it is not connected to anything",
    ).toBeGreaterThan(0);
    // And the control's own result, asserted rather than assumed: dropping the
    // core's band did not, on this sweep, produce an overlap. If this ever goes
    // red it is GOOD news for the guard and the header above is out of date.
    expect(
      overlapping(coreBlind).length,
      "the core-blind sweep now reaches a defect the header says it cannot; " +
        "update the header rather than this number",
    ).toBe(0);
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
   * ================== AND THAT IT TAKES NO FOR AN ANSWER ==================
   * The rule now has a second half. No column rule can win on a board that is
   * over-subscribed - seven plates at D41 spacing need ~1516 px of a 1280 px
   * span - so `spawnRock` DECLINES rather than covering a word, and only
   * `FlightScene.trySpawn` can act on that. A `spawnRock` whose answer is
   * thrown away is a rule that holds in the engine and not on the screen, so
   * the call site is guarded here beside the wiring it belongs to.
   *
   * WATCHED FAILING, each by reverting that one line in `FlightScene.ts`:
   *
   *   with `const spec = this.laneSpec(sizePx, word)` (the plate dropped):
   *     spawnRock no longer hands the column rule the arriving plate, so
   *     @engine/spawn cannot know what it is separating: expected false to be true
   *
   *   with `spawnX(this.laneSpec(sizePx, word, track), ...)` rebuilt inline:
   *     spawnRock chooses the column from a spec other than the one it tested
   *     for room, so the two can disagree: expected false to be true
   *
   *   with `hasCleanColumn(spec, practice)` deleted:
   *     spawnRock no longer asks whether this board has a readable column, so
   *     AC-22.8 rests on a fallback that is known not to reach zero:
   *     expected false to be true
   *
   *   with `this.spawnRock(outcome.word, now, outcome.practice);` restored bare:
   *     trySpawn ignores spawnRock's refusal, so a declined rock is simply
   *     never drawn and the belt goes quiet instead of waiting:
   *     expected false to be true
   *
   *   and with `updateRocks` put back to the literal `* 10`:
   *     updateRocks sways a rock by a literal rather than by ROCK_DRIFT_PX, so
   *     the keep-out is sized for a drift the scene may not be using:
   *     expected false to be true
   */
  it("FlightScene hands the column rule the plate and the board it is about", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/FlightScene.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(
      /const spec = this\.laneSpec\(sizePx,\s*word,\s*track,\s*corePlate\)/.test(source),
      "spawnRock no longer hands the column rule the arriving plate and the " +
        "core's plate, so @engine/spawn cannot know what it is separating",
    ).toBe(true);
    // ONE SPEC, TESTED AND USED. Two `laneSpec` calls would be two boards -
    // the one the decline was decided on and the one the column came from -
    // and the gap between them is where this defect class lives.
    expect(
      /spawnX\(spec,\s*this\.rng,\s*practice\)/.test(source),
      "spawnRock chooses the column from a spec other than the one it tested " +
        "for room, so the two can disagree",
    ).toBe(true);
    expect(
      /if \(!hasCleanColumn\(spec,\s*practice\)\) return false;/.test(source),
      "spawnRock no longer asks whether this board has a readable column, so " +
        "AC-22.8 rests on a fallback that is known not to reach zero",
    ).toBe(true);
    expect(
      /if \(!this\.spawnRock\(outcome\.word,\s*now,\s*outcome\.practice,\s*core\)\)/.test(
        source,
      ),
      "trySpawn ignores spawnRock's refusal, so a declined rock is simply " +
        "never drawn and the belt goes quiet instead of waiting",
    ).toBe(true);
    expect(
      /livePlates:\s*this\.livePlateTracks\(\)/.test(source),
      "laneSpec no longer forwards the live plates, so the keep-out has nothing to avoid",
    ).toBe(true);
    expect(
      /Math\.sin\([^)]*\) \* ROCK_DRIFT_PX/.test(source),
      "updateRocks sways a rock by a literal rather than by ROCK_DRIFT_PX, so " +
        "the keep-out is sized for a drift the scene may not be using",
    ).toBe(true);
    // UR-83: THE ANGLE IS DECLARED TO THE RULE AND APPLIED AS A CONSTANT RATE.
    // WATCHED FAILING, by reverting each line in `FlightScene.ts`:
    //
    //   with `travelPx` dropped from the arriving track: @engine/spawn sizes
    //   every band for a column this rock does not keep: expected false to be true
    //
    //   with `travelPx` dropped from `livePlateTracks`: the keep-out avoids
    //   where the live rocks STARTED rather than where they go: expected false
    //   to be true
    expect(
      /rock\.travelPx \* Math\.max\(0, Math\.min\(1, t\)\)/.test(source),
      "updateRocks no longer slides an angled rock at a constant rate over its " +
        "own fall progress, so the angle is not the straight line the keep-out " +
        "reserved a band for",
    ).toBe(true);
    expect(
      /travelPx: rock\.travelPx/.test(source),
      "livePlateTracks no longer tells the column rule how far a live rock's " +
        "column slides, so the keep-out is sized for a board this scene does not draw",
    ).toBe(true);
    expect(
      /travelPx: draws\.travelPx,\s*\};[\s\S]{0,900}?const spec = this\.laneSpec/.test(source),
      "spawnRock no longer declares the arriving rock's angle to the column " +
        "rule before the column is chosen",
    ).toBe(true);
    // D101. WATCHED FAILING by reverting each of these in `FlightScene.ts`:
    //
    //   with `liveWords()` put back to `this.rocks.map((r) => r.word)`:
    //     trySpawn no longer reserves a hidden core's first letter, so AC-2.1
    //     can be broken by a reveal: expected false to be true
    //
    //   with the second `LivePlateTrack` dropped from `livePlateTracks`:
    //     livePlateTracks no longer tells an arriving rock about the plate a
    //     live shell is hiding: expected false to be true
    expect(
      /live: this\.liveWords\(\)/.test(source),
      "trySpawn no longer declares a hidden core as live, so AC-2.1 rests on " +
        "nothing at the instant a shell breaks",
    ).toBe(true);
    expect(
      /if \(rock\.core !== null\) \{\s*out\.push\(\{/.test(source),
      "livePlateTracks no longer tells an arriving rock about the plate a live " +
        "shell is hiding, so the core's column was proved against a board that " +
        "has since changed",
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
