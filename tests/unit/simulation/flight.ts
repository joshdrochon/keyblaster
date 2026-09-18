/**
 * A deterministic whole-flight simulation, built from the real engine modules.
 *
 * This is the harness behind AC-6e.3, AC-6e.4 and AC-4.3. All three are claims
 * about what happens over a WHOLE RUN, so none can be checked by a unit test of
 * any single module - the emergent behaviour is the thing under test.
 *
 * Nothing here models gameplay it also asserts. The simulated player has a
 * fixed per-character accuracy and a fixed typing speed; whether a word is hit
 * falls out of fall time versus typing time, both computed by the real engine.
 *
 * TWO SIMULATIONS LIVE HERE, AND THE DIFFERENCE IS THE POINT.
 *
 * `simulateStage` is the original: it asks whether the SELECTION side of the
 * loop behaves over a whole run - does the board stay fed (AC-6e.3), does a
 * learner's recognition improve (AC-6e.4). It resolves every live rock
 * independently, as if the player could answer them all at once.
 *
 * WHAT THE GAME KNOWS IS AN INPUT, NOT A GIFT.
 *
 * Both simulations used to compute fall time with
 * `{ ...DEFAULT_CALIBRATION, ikiMs: player.ikiMs }` - they handed the grade-2
 * player a game that already knew they type at 600 ms. The shipped game learned
 * that from nowhere: `PreflightScene` gated the calibration ritual on a flag
 * nothing ever set, so `calibration.ikiMs` was 350 for every child who ever
 * played. So the harness was measuring a game we do not ship, and reported zero
 * stalls for a belt that a real playthrough could not survive past spawn 18.
 *
 * The belief is therefore a CONFIG FIELD now (`BeltConfig.calibration`), it
 * defaults to the shipped `DEFAULT_CALIBRATION`, and the harness models the two
 * ways the real game can change it: the pre-flight ritual (pass
 * `calibrationOf(player)`, which is what the ritual measures) and the in-stage
 * fold (`FlightScene.learnFromPlay`, modelled when `adaptiveCalibration` is on).
 * A test that wants the old behaviour has to ask for it by name.
 *
 * That assumption is exactly why this harness could not see the belt stall. A
 * player is ONE server: AC-2.1 gives every live word a distinct first letter so
 * the lock is unambiguous, and the child types one word at a time. A rock that
 * is not being typed is not waiting politely - it is falling. `simulateBelt`
 * models that: one serial typist, the real fall times, the real hull (D27), and
 * the real spawn pacing out of `@engine/pacing`. It is the harness for "is a
 * belt survivable", which is a question about arrival rate versus service rate
 * and cannot be asked of a player who clears rocks in parallel.
 */

import { fallTimeIkiMs, fallTimeMs } from "@engine/fallTime/index.js";
import {
  createSelectionState,
  pickNext,
  type SelectionState,
} from "@engine/selection/index.js";
import {
  applyEvent,
  blankRecord,
  firstFkLatency,
  medianFkLatency,
  type WordBook,
} from "@engine/words/index.js";
import {
  DEFAULT_CALIBRATION,
  type Calibration,
  type StopId,
  type WordRecord,
} from "@engine/types.js";
import {
  type ControllerState,
  createController,
  hitRate,
  rampedMaxLive,
  recordOutcome,
  stageRampMs,
} from "@engine/controller/index.js";
import type { Knobs } from "@engine/controller/knobs.js";
import { expectedClearMs, observedBiasMs, spawnGapMs } from "@engine/pacing/index.js";
import { refineCalibration } from "@engine/calibration/index.js";
import {
  HULL_STRIKE_COST,
  hullAfterShield,
  hullAfterStrike,
  hullForStage,
  isStalled,
  maySpawnCanister,
} from "@game/flight/shield.js";
import {
  liveWordsOf,
  nestedClearEstimateMs,
  nestedFallMs,
  nestedHullCost,
  nestingAllowed,
  nestingDrawPasses,
} from "@engine/nested/index.js";

/**
 * The baseline FALL TIME may use - `FlightScene.fallTimeCalibration`.
 *
 * Calibration is a LOOSENING knob and nothing else: it may lengthen a fall for
 * a child the default is too quick for, and it may never shorten one. See the
 * scene for why that is not symmetric, and the AC-10.2 escalation for why the
 * loosening direction is the one the controller was missing. Modelled here
 * because a harness that scales fall time both ways would report a belt the game
 * does not fly - which is the whole reason this file was rewritten.
 */
function fallCalibration(calibration: Calibration): Calibration {
  return { ...calibration, ikiMs: fallTimeIkiMs(calibration.ikiMs) };
}

/** Deterministic PRNG. Never Math.random, in the module or the test. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimPlayer {
  /** Per-character probability of typing correctly. */
  accuracy: number;
  /** Median inter-key interval, ms. */
  ikiMs: number;
  /**
   * What the pre-flight ritual MEASURED as this player's first-key latency
   * (D51). Deliberately separate from `coldRecognitionMs`: the ritual uses
   * short, high-frequency words, so it measures recognition of a word the child
   * already reads, and a brand new word costs more than it says. The gap
   * between the two is what the observed-clear feedback in `@engine/pacing`
   * exists to close. Defaults to PRD FR-8's 500 ms.
   */
  fkLatencyMs?: number;
  /**
   * Recognition latency for a word the player does not know yet, ms. Shrinks
   * with exposure, which is the whole mechanism the retention line measures.
   */
  coldRecognitionMs: number;
}

export interface SpawnRecord {
  word: string;
  spawnedAtMs: number;
  /** When the rock leaves the board, by blast or by breach. */
  clearedAtMs: number;
  hit: boolean;
  fkLatencyMs: number;
}

export interface StageResult {
  stopIndex: number;
  spawns: SpawnRecord[];
  /** Longest stretch with no live rock AND nothing pending, ms (AC-6e.3). */
  maxDeadMs: number;
  book: WordBook;
}

/**
 * How long this player takes to recognise a word, given their history with it.
 * Falls from coldRecognitionMs toward a floor as exposures accumulate. This is
 * the only place learning is modelled, and it is deliberately simple: the AC
 * asks whether the ENGINE surfaces improvement, not whether this curve is real.
 */
function recognitionMs(player: SimPlayer, record: WordRecord): number {
  const floor = 220;
  const decay = 0.72 ** record.hits;
  return floor + (player.coldRecognitionMs - floor) * decay;
}

/**
 * Typing time for every key AFTER the first one.
 *
 * `recognitionMs` already runs to the moment the first key goes down - that is
 * what first-key latency means (D51, FR-11) - so charging an inter-key interval
 * for it as well costs the player a keystroke they never made. The belt is
 * paced off this number, so a systematic overcharge of one `ikiMs` per word is
 * an overcharge of a whole minute across a 58-word stage.
 */
function typeAfterFirstKeyMs(player: SimPlayer, word: string, rng: () => number): number {
  let ms = 0;
  for (let i = 1; i < [...word].length; i++) {
    ms += player.ikiMs;
    if (rng() > player.accuracy) ms += player.ikiMs;
  }
  return ms;
}

/** Time to physically type the word, plus the retries a typo costs. */
function typingMs(player: SimPlayer, word: string, rng: () => number): number {
  let ms = 0;
  for (let i = 0; i < word.length; i++) {
    ms += player.ikiMs;
    // A typo costs one extra keystroke; the lock is never dropped (AC-3.2).
    if (rng() > player.accuracy) ms += player.ikiMs;
  }
  return ms;
}

export interface StageConfig {
  stopIndex: number;
  /**
   * What the GAME believes about this player's hands. Defaults to the shipped
   * FR-8 baseline; pass `calibrationOf(player)` to model a profile that ran the
   * pre-flight ritual. It is deliberately not derived from the player.
   */
  calibration?: Calibration;
  stagePool: readonly string[];
  retentionPool: readonly string[];
  spawnCount: number;
  /** Max simultaneous live rocks, i.e. the controller's primary knob. */
  maxLive: number;
  /** Gap between spawn ticks, ms. */
  spawnIntervalMs: number;
}

/**
 * Run one stage. Returns every spawn with its outcome, plus the longest
 * dead interval observed.
 */
export function simulateStage(
  cfg: StageConfig,
  player: SimPlayer,
  book: WordBook,
  rng: () => number,
): StageResult {
  let state: SelectionState = createSelectionState({
    stage: cfg.stopIndex,
    stagePool: cfg.stagePool,
    retentionPool: cfg.retentionPool,
    book,
  });

  let nextBook: WordBook = { ...book };
  const spawns: SpawnRecord[] = [];
  /** Live rocks, as clear times. */
  let live: { word: string; clearAt: number }[] = [];
  let nowMs = 0;
  let maxDeadMs = 0;
  let deadSince: number | null = null;
  let spawned = 0;

  const lastSeenStage: Record<string, number> = {};

  while (spawned < cfg.spawnCount || live.length > 0) {
    // Retire anything that has cleared by now.
    live = live.filter((l) => l.clearAt > nowMs);

    const pending = spawned < cfg.spawnCount;
    if (live.length === 0 && !pending) break;

    // AC-6e.3: a stretch with nothing on screen AND nothing queued is dead time.
    if (live.length === 0 && pending) {
      if (deadSince === null) deadSince = nowMs;
    } else if (deadSince !== null) {
      maxDeadMs = Math.max(maxDeadMs, nowMs - deadSince);
      deadSince = null;
    }

    if (pending && live.length < cfg.maxLive) {
      const out = pickNext(state, {
        live: live.map((l) => l.word),
        book: nextBook,
        lastSeenStage,
        rng,
      });
      if (out.ok) {
        state = out.state;
        const word = out.word;
        const record = nextBook[word] ?? blankRecord();

        const fall = fallTimeMs({
          word,
          ease: record.ease,
          calibration: fallCalibration(cfg.calibration ?? DEFAULT_CALIBRATION),
        });
        const fk = recognitionMs(player, record);
        const type = typingMs(player, word, rng);
        const hit = fk + type <= fall;
        const clearAt = nowMs + (hit ? fk + type : fall);

        spawns.push({ word, spawnedAtMs: nowMs, clearedAtMs: clearAt, hit, fkLatencyMs: fk });
        live.push({ word, clearAt });
        nextBook = {
          ...nextBook,
          [word]: applyEvent(record, hit
            ? { kind: "hit", fkLatencyMs: fk, ikiMs: [player.ikiMs], atMs: nowMs, stage: cfg.stopIndex }
            : { kind: "miss", atMs: nowMs, stage: cfg.stopIndex }),
        };
        lastSeenStage[word] = cfg.stopIndex;
        spawned++;
      }
    }

    nowMs += cfg.spawnIntervalMs;
  }

  if (deadSince !== null) maxDeadMs = Math.max(maxDeadMs, nowMs - deadSince);
  return { stopIndex: cfg.stopIndex, spawns, maxDeadMs, book: nextBook };
}

// ---------------------------------------------------------------------------
// The belt: one serial typist, a real hull, and the real spawn pacing
// ---------------------------------------------------------------------------

/**
 * What the PRE-FLIGHT RITUAL would measure for this player (D51, FR-11).
 *
 * Not "what the game believes" - the game believes whatever is on the profile,
 * and until the ritual actually runs that is `DEFAULT_CALIBRATION`. This is the
 * value a belt is handed when the ritual DID run, and it is passed in by the
 * tests that model that pilot.
 */
export function calibrationOf(player: SimPlayer): Calibration {
  return {
    ikiMs: player.ikiMs,
    fkLatencyMs: player.fkLatencyMs ?? DEFAULT_CALIBRATION.fkLatencyMs,
  };
}

export interface BeltConfig {
  stopIndex: number;
  /**
   * WHICH STOP THIS BELT IS (UR-83). The controller reads it for the per-stop
   * `maxLive` band (`@engine/controller/stopBand`), which is the whole of the
   * route's progression.
   *
   * OPTIONAL, and absent is FR-10's global 2..7 - the pre-UR-83 belt, which is
   * what every harness that only ever flew ONE pool (`belt.test.ts` flies Mars
   * at stopIndex 1 for every run) is actually measuring. A file that wants the
   * route's own progression has to name the stop, and `launchRoute.test.ts`
   * does.
   */
  stopId?: StopId;
  /**
   * UR-83's intra-stage ramp: the board opens at one rock and widens to the
   * knob over `stageRampMs` of this belt's own clock. ON by default because it
   * ships; OFF is the negative control, and it is what the belt did before.
   */
  stageRamp?: boolean;
  /**
   * UR-83's per-rock fall-time spread. ON by default because it ships. Each
   * rock takes one draw from the SAME seeded `rng` the column and the picker
   * use, so a replay is identical.
   */
  fallSpread?: boolean;
  /**
   * What the GAME believes about this player's hands when the belt opens.
   *
   * THE SHIPPED DEFAULT, on purpose. A profile that has not been measured flies
   * on FR-8's 350 ms whoever is holding the keyboard, and until this round that
   * was every profile. Pass `calibrationOf(player)` to model a pilot who ran
   * the pre-flight ritual - which is what `PreflightScene` now actually does.
   */
  calibration?: Calibration;
  /**
   * Model `FlightScene.learnFromPlay`: fold the intervals this belt measures
   * back into the belief, once per blast, through the real
   * `@engine/calibration.refineCalibration`.
   *
   * ON by default, because it is what ships. Turning it OFF is the negative
   * control - it reproduces the game the real playthrough stalled on, and
   * without that control "no stalls" would be a claim about a harness rather
   * than a measurement of a fix.
   */
  adaptiveCalibration?: boolean;
  stagePool: readonly string[];
  retentionPool: readonly string[];
  /** Words the stage spawns before it ends (FR-6). */
  spawnCount: number;
  /** Starting knobs; the controller owns them from there (FR-10). */
  knobs?: Partial<Knobs>;
  /**
   * Model the shield canister (AC-5.1, AC-5.2, D26) - a damaged hull is handed
   * a rock that gives a mark back when it is blasted. OFF by default, because a
   * survivability claim proved without the safety net is a claim that holds
   * with it.
   */
  canisters?: boolean;
  /**
   * Hull marks for this belt. Defaults to `@engine/hull.hullForStage`, i.e. the
   * real rule. A test overrides it ONLY to reproduce the old fixed 3, which is
   * how the D27/D17 defect is shown to be fixed rather than asserted to be.
   */
  maxHull?: number;
  /**
   * Model the D21/D23 pass-by: a rock carrying a word that CAME BACK is spawned
   * off the ship's lane and sails past instead of striking the hull
   * (`FlightScene.resolveAtBreachLine`). On by default because it is the
   * shipped rule; the flag exists so the hull change and the trajectory change
   * can be attributed separately in the evidence rather than measured as one
   * lump and credited to whichever is mentioned first.
   */
  practiceRocksPassBy?: boolean;
  /**
   * A FIXED gap, in ms, instead of the derived one. Only a regression test uses
   * this: it is how the old 850 ms constant is reproduced, so the fix can be
   * shown to fix something rather than asserted to.
   */
  fixedGapMs?: number | null;
  /**
   * `FlightScene.trySpawn:955` - "an empty board never waits":
   *
   *     if (this.rocks.length > 0 && now < this.nextSpawnAtMs) return;
   *
   * That one clause is the whole of AC-6e.3. With it, dead time is impossible
   * by construction, because `pickNext`'s final cascade rung filters the pool by
   * nothing but "not live" and "first letter not taken" (picker.ts:337-341) and
   * `createSelectionState` throws rather than hand back an empty pool - so an
   * empty board always yields a word on the same instant it went empty.
   *
   * Defaults to the shipped rule. Setting it FALSE is the negative control for
   * L-6e.3: it reproduces the defect the AC exists to forbid, the belt waits out
   * its full derived gap on an empty board, and dead time appears. Without that
   * control, "max dead gap: 0 ms" is a statement about the fast path's existence
   * and not a measurement of anything.
   */
  emptyBoardFastPath?: boolean;
  /**
   * Turn OFF the D21/D23 retention interleave for this belt - the earlier stops'
   * words are never offered to the picker. The engine control for L-6e.4: if
   * the retention line still trends up with the interleave gone, the number is
   * a property of the player model and not of the selection engine.
   */
  noRetention?: boolean;
  /**
   * D101's two-layer rocks: at Neptune and Pluto some rocks carry a SECOND word
   * inside a shell, and the pair falls on one trajectory over the sum of both
   * words' FR-8 budgets (`@engine/nested`).
   *
   * ON by default, because it ships. Turning it OFF is the negative control and
   * it is the whole of the route bar: the claim is that no pilot gains a stall
   * at either stop against the same route flown with this false, and a claim
   * like that is worthless without the other half measured on the same seeds.
   */
  nested?: boolean;
}

export interface BeltSpawn extends SpawnRecord {
  /**
   * The picker chose this word from the RETENTION pool (D21/D23/AC-9.3), i.e.
   * it belongs to an earlier stop and the selection engine brought it back.
   * Recorded so a retention measure can attribute an improvement to the engine
   * rather than to two stage pools happening to share a word.
   */
  fromRetention: boolean;
  /** Gap the belt waited after this rock before feeding the next one, ms. */
  gapAfterMs: number;
  /** How long this rock waited before the player could start it, ms. */
  queuedMs: number;
  /** Fall time this rock was granted (@engine/fallTime), ms. */
  fallMs: number;
  /** What the belt estimated it would cost this player, ms. */
  estimateMs: number;
  /** What it actually cost them once they started, ms. */
  actualMs: number;
}

export interface BeltResult {
  spawns: BeltSpawn[];
  /** Hull left when the belt ended, 0..maxHull (D27 as a rate, @engine/hull). */
  hull: number;
  /** Rocks that reached the bottom without costing a mark (D21/D23 pass-by). */
  passedBy: number;
  /** D101: two-layer rocks this belt spawned. */
  nestedRocks: number;
  /** D101: shells the pilot broke open. */
  shellsCracked: number;
  /** D101: rocks whose core reached the ship with the shell already off. */
  coresBreached: number;
  /** D101: rocks that reached the ship with the shell still on. */
  shellsBreached: number;
  /** Hull marks this belt was flown with. */
  maxHull: number;
  /** AC-4.3: the hull emptied and the stage stalled before it finished. */
  stalled: boolean;
  breaches: number;
  blasted: number;
  /** How many of `spawnCount` ever made it onto the board. */
  spawned: number;
  /** Wall-clock length of the belt, ms - the 90-150 s target lives here. */
  durationMs: number;
  /** Longest stretch with nothing live and spawns still pending (AC-6e.3). */
  maxDeadMs: number;
  /** Blasted / spawned over the whole belt. */
  hitRate: number;
  /** What the game believed about the player's hands when the belt ended. */
  calibration: Calibration;
  /** Every gap the pacing module handed back, in order. */
  gaps: number[];
  /** Most rocks live at once - the board's real depth, not the knob's cap. */
  peakLive: number;
  /**
   * Wall-clock ms spent with exactly N rocks on the board, indexed by N.
   *
   * PEAK IS NOT OCCUPANCY, and UR-51 is a claim about occupancy. A belt that
   * touches four rocks for one instant per stage and sits at one for the rest
   * has `peakLive` 4 and looks, to a child, exactly like the belt they called
   * boring. This is the distribution behind the peak, so "three or four at
   * once" is answered with how LONG rather than with whether it ever happened.
   */
  liveTimeMs: number[];
  /** Time-weighted mean rocks on the board over the belt. */
  meanLive: number;
  book: WordBook;
}

interface BeltRock {
  word: string;
  /**
   * D101: the word waiting inside this rock's shell, or null. Nulled the moment
   * the shell is typed, so `core !== null` is exactly "the shell is still on".
   */
  core: string | null;
  /** D101: true once the shell has come off, whatever is left inside. */
  cracked: boolean;
  spawnedAtMs: number;
  /** Fall time from `@engine/fallTime`: the instant it reaches the breach. */
  deadlineMs: number;
  /** Set when the player commits to it; the lock never drops (AC-3.2). */
  startedAtMs: number | null;
  /** AC-5.2: blasting this one gives a hull mark back. */
  isCanister: boolean;
  /** D21/D23: came back, so it is not on a collision course with the ship. */
  isPractice: boolean;
  /** What the belt estimated this rock would cost, at spawn. */
  clearEstimateMs: number;
}

/**
 * Fly one belt with a single serial typist.
 *
 * THE PLAYER MODEL, and why each part of it is the conservative choice:
 *
 * - ONE WORD AT A TIME. The lock machine allows nothing else, and a child could
 *   not do anything else.
 * - LOWEST ROCK FIRST (earliest deadline). This is both what a player does and
 *   what `tests/e2e/playthrough.spec.ts` does, and it is the BEST possible
 *   scheduling order for a single server with deadlines - so a belt this
 *   simulation cannot survive, no real player survives either.
 * - COMMITTED. Once typing starts the player finishes the word, because AC-3.2
 *   says the lock is never dropped. A rock that breaches mid-word costs the
 *   player everything they had spent on it.
 * - NO SHIELD CANISTERS, unless `cfg.canisters` asks for them. The real game
 *   hands a damaged hull a rock that gives a mark back (AC-5.1/AC-5.2); the
 *   default here does not. Survivability proved without the safety net is
 *   survivability with it, and the flag exists to measure what the net is worth
 *   rather than to lean on it.
 *
 * The RULES all come from the engine: which word (`selection`), how long it
 * falls (`fallTime`), when the next one is fed (`pacing`), what the hull does
 * (`flight/shield`), what the rolling hit rate is (`controller`).
 */
export function simulateBelt(
  cfg: BeltConfig,
  player: SimPlayer,
  book: WordBook,
  rng: () => number,
): BeltResult {
  /**
   * What the game believes, which is not what is true about the player. It
   * starts wherever the profile left it and moves only the way the scene moves
   * it: `observedIki` / `observedFk` are this belt's own samples, exactly the
   * transcript `flight/blastHistory.observedTimings` hands over, and the fold
   * is the engine's.
   */
  let calibration = cfg.calibration ?? DEFAULT_CALIBRATION;
  const adaptive = cfg.adaptiveCalibration ?? true;
  const observedIki: number[] = [];
  const observedFk: number[] = [];
  /**
   * The scene folds on every KEYSTROKE, not on every kill, and modelling that
   * distinction is the difference between a harness that can see this defect
   * and one that cannot. A belt flown 70% too fast produces no blasts at all,
   * so a blast-fed loop never gets a first sample and the belief never moves -
   * which is what the first version of this measured, and reported as 100
   * stalls in 100 with the belief still on 350 ms. Words that reach the breach
   * line contributed the keys the player did manage.
   */
  const learn = (intervals: number, fkMs: number | null): void => {
    if (!adaptive || intervals <= 0) return;
    for (let i = 0; i < intervals; i += 1) observedIki.push(player.ikiMs);
    if (fkMs !== null) observedFk.push(fkMs);
    calibration = refineCalibration(calibration, {
      ikiMs: observedIki,
      fkLatencyMs: observedFk,
    });
  };
  let selection: SelectionState = createSelectionState({
    stage: cfg.stopIndex,
    stagePool: cfg.stagePool,
    retentionPool: (cfg.noRetention ?? false) ? [] : cfg.retentionPool,
    book,
  });
  let controller: ControllerState = createController({
    knobs: cfg.knobs ?? {},
    // UR-83: the belt is flown inside this stop's band. `FlightScene.create`
    // passes exactly this (`tests/unit/flight/knobWiring.test.ts` asserts it).
    stopId: cfg.stopId ?? null,
  });
  let nextBook: WordBook = { ...book };
  const rampOn = cfg.stageRamp ?? true;
  const spreadOn = cfg.fallSpread ?? true;
  /**
   * The cap the BOARD may use right now: the knob, held back by UR-83's
   * opening for the first `stageRampMs` of the belt. The scene computes exactly
   * this in `trySpawn`. It reads the BELIEF's interval, not the player's true
   * one, for the same reason fall time does - the game knows what it measured.
   */
  const liveCap = (): number =>
    rampOn
      ? rampedMaxLive(controller.knobs.maxLive, nowMs, stageRampMs(calibration.ikiMs))
      : controller.knobs.maxLive;
  /**
   * When the opening next widens the board by one, or null once it is over.
   *
   * The event loop below jumps to "the next thing that happens", and during the
   * opening the next thing that happens can be the opening itself - a board
   * sitting at the ramp's cap with spawns pending has no other event until a
   * rock resolves. Leaving it out would not deadlock (a live rock always has a
   * deadline) but it would report a board that widened LATE, which is the one
   * number this harness exists to measure.
   */
  const nextRampStepMs = (): number | null => {
    if (!rampOn) return null;
    const top = controller.knobs.maxLive;
    const at = liveCap();
    if (at >= top || top <= 1) return null;
    const rampMs = stageRampMs(calibration.ikiMs);
    return (rampMs * at) / (top - 1);
  };

  const maxHull = cfg.maxHull ?? hullForStage(cfg.spawnCount);
  const spawns: BeltSpawn[] = [];
  const gaps: number[] = [];
  /** actual service minus the estimate, per cleared rock (@engine/pacing). */
  const residuals: number[] = [];
  const lastSeenStage: Record<string, number> = {};
  const byWord = new Map<string, BeltSpawn>();

  let live: BeltRock[] = [];
  let busy: { rock: BeltRock; doneAtMs: number; fkMs: number } | null = null;
  let nowMs = 0;
  let spawned = 0;
  let hull = maxHull;
  let blasted = 0;
  let breaches = 0;
  let passedBy = 0;
  let nextSpawnAtMs = 0;
  /** When the player last became free; a rock's service starts no earlier. */
  let freeSinceMs = 0;
  let canisterLive = false;
  let maxDeadMs = 0;
  let deadSinceMs: number | null = null;
  let peakLive = 0;
  const liveTimeMs: number[] = [];
  let stalled = false;
  const nestingOn = cfg.nested ?? true;
  let nestedRocks = 0;
  let shellsCracked = 0;
  let coresBreached = 0;
  let shellsBreached = 0;

  /**
   * Move the clock, charging the elapsed interval to the depth the board held
   * for it. Every advance in this loop goes through here; the branches that do
   * not advance the clock (a blast, a breach, a spawn, a commit) resolve at an
   * instant and so hold no time to charge.
   */
  const advanceTo = (t: number): void => {
    const depth = live.length;
    liveTimeMs[depth] = (liveTimeMs[depth] ?? 0) + Math.max(0, t - nowMs);
    nowMs = t;
  };

  const pending = (): boolean => spawned < cfg.spawnCount;

  const noteDead = (): void => {
    if (live.length === 0 && pending()) {
      if (deadSinceMs === null) deadSinceMs = nowMs;
    } else if (deadSinceMs !== null) {
      maxDeadMs = Math.max(maxDeadMs, nowMs - deadSinceMs);
      deadSinceMs = null;
    }
  };

  let guard = 0;
  while (pending() || live.length > 0) {
    if ((guard += 1) > 400_000) throw new Error("belt simulation did not terminate");
    noteDead();

    // 1. The player finishes the word they were on. A rock whose deadline lands
    //    on the same instant is still a blast: the fall-time budget is inclusive.
    if (busy !== null && busy.doneAtMs <= nowMs) {
      const rock: BeltRock = busy.rock;
      const record = nextBook[rock.word] ?? blankRecord();
      /**
       * D101: A SHELL BREAK IS A COMPLETED WORD AND NOT A CLEARED ROCK.
       *
       * The word book learns it, the controller counts it and the spawn record
       * is closed - all of which are about the WORD. The rock stays on the
       * board, keeps its column, its angle and its deadline, and the player
       * stays busy on it: `FlightScene.crackShell` does exactly this, and the
       * player is modelled as committed because AC-3.2 says the lock is never
       * dropped.
       */
      const cracking = rock.core !== null;
      if (!cracking) live = live.filter((r) => r !== rock);
      nextBook = {
        ...nextBook,
        [rock.word]: applyEvent(record, {
          kind: "hit",
          fkLatencyMs: busy.fkMs,
          ikiMs: [player.ikiMs],
          atMs: nowMs,
          stage: cfg.stopIndex,
        }),
      };
      learn([...rock.word].length - 1, busy.fkMs);
      // D101: one rock, one margin sample and one service sample. The scene
      // reports neither on a shell break, for the reasons in `onBlast`.
      if (!cracking) {
        controller = recordOutcome(controller, "blasted");
        // The service sample the scene records: from the moment the player was
        // free to attend to this rock, to the moment it blew up. Queueing time
        // is excluded, or the gap would chase its own tail.
        residuals.push(nowMs - (rock.startedAtMs ?? nowMs) - rock.clearEstimateMs);
      }
      if (rock.isCanister && !cracking) {
        hull = hullAfterShield(hull, maxHull);
        canisterLive = false;
      }
      const spawn = byWord.get(rock.word + rock.spawnedAtMs);
      if (spawn !== undefined) {
        spawn.clearedAtMs = nowMs;
        spawn.hit = true;
      }
      blasted += 1;
      if (cracking) {
        // The rock becomes its core, and the player carries straight on to the
        // second word with a fresh first-key latency - they could not have been
        // reading it before it existed.
        const coreWord = rock.core as string;
        rock.word = coreWord;
        rock.core = null;
        rock.cracked = true;
        shellsCracked += 1;
        const coreRecord = nextBook[coreWord] ?? blankRecord();
        const fk = recognitionMs(player, coreRecord);
        busy = {
          rock,
          doneAtMs: nowMs + fk + typeAfterFirstKeyMs(player, coreWord, rng),
          fkMs: fk,
        };
        continue;
      }
      busy = null;
      freeSinceMs = nowMs;
      continue;
    }

    // 2. Anything that reached the breach line. One hull mark each (AC-4.2),
    //    including the rock the player was mid-way through.
    const due = live.find((r) => r.deadlineMs <= nowMs);
    if (due !== undefined) {
      const record = nextBook[due.word] ?? blankRecord();
      live = live.filter((r) => r !== due);
      nextBook = {
        ...nextBook,
        [due.word]: applyEvent(record, { kind: "miss", atMs: nowMs, stage: cfg.stopIndex }),
      };
      controller = recordOutcome(controller, "missed");
      if (due.isCanister) canisterLive = false;
      const spawn = byWord.get(due.word + due.spawnedAtMs);
      if (spawn !== undefined) spawn.clearedAtMs = nowMs;
      breaches += 1;
      // A practice rock was never pointed at the ship, so reaching the bottom
      // costs nothing. It is still a miss for the word book and for the
      // controller above - the child did not type it - which is what keeps this
      // a change of trajectory rather than a discount.
      // A word that breached mid-answer still produced keystrokes, and those
      // are exactly the samples the belt most needs from the child who is
      // struggling. Count the keys they got through before the deadline.
      if (busy !== null && busy.rock === due) {
        const typedMs = nowMs - (due.startedAtMs ?? nowMs) - busy.fkMs;
        const perKey = Math.max(1, player.ikiMs);
        const typed = Math.floor(typedMs / perKey);
        learn(Math.max(0, Math.min([...due.word].length - 1, typed)), busy.fkMs);
      }
      const passes = (cfg.practiceRocksPassBy ?? true) && due.isPractice;
      // D101, AC-26.4: an unbroken shell costs a whole mark - nothing on it was
      // typed, so it is AC-4.2 exactly - and an exposed core costs half,
      // because the child removed a layer and it still got through. A nested
      // rock is never a practice rock, so the two rules never meet.
      const nestedCost =
        due.cracked || due.core !== null ? nestedHullCost(due.core !== null) : null;
      if (due.core !== null) shellsBreached += 1;
      else if (due.cracked) coresBreached += 1;
      if (passes) passedBy += 1;
      else hull = hullAfterStrike(hull, maxHull, nestedCost ?? HULL_STRIKE_COST);
      if (busy !== null && busy.rock === due) {
        busy = null;
        freeSinceMs = nowMs;
      }
      if (isStalled(hull)) {
        stalled = true;
        break;
      }
      continue;
    }

    // 3. Feed the belt. The gate is the scene's, exactly: never past `maxLive`,
    //    and never early UNLESS the board is empty - AC-6e.3's fast path, which
    //    is what stops a longer gap from turning into dead air.
    const boardEmpty = live.length === 0 && (cfg.emptyBoardFastPath ?? true);
    if (pending() && live.length < liveCap() && (boardEmpty || nowMs >= nextSpawnAtMs)) {
      const outcome = pickNext(selection, {
        // D101: both words of a shelled rock are live for AC-2.1's purposes,
        // because the core's first letter is reserved from spawn. Shared
        // definition, so this harness cannot prove the invariant on a board the
        // game does not fly.
        live: live.flatMap((r) => liveWordsOf({ word: r.word, coreWord: r.core })),
        book: nextBook,
        lastSeenStage,
        rng,
      });
      if (!outcome.ok) {
        // "no legal word" implies a non-empty board, so something is already
        // falling; the scene retries on the next frame and so do we.
        nextSpawnAtMs = nowMs + 200;
        if (boardEmpty) advanceTo(nowMs + 200);
        continue;
      }
      const word = outcome.word;
      const record = nextBook[word] ?? blankRecord();
      // ================== D101: DOES THIS ONE NEST? ==================
      // `FlightScene.trySpawn`, restated. The SECOND pick carries the shell in
      // its live set, so the two layers of one rock cannot collide under
      // AC-2.1; a core that comes back practice is refused, because a rock with
      // one practice layer has no sensible answer to the D21/D23 pass-by rule.
      let selectionNext = outcome.state;
      let coreWord: string | null = null;
      if (
        nestingOn &&
        cfg.stopId !== undefined &&
        nestingAllowed({
          stopId: cfg.stopId,
          nestedLive: live.filter((r) => r.core !== null).length,
          wordsLeft: cfg.spawnCount - spawned,
          anyPractice: outcome.practice,
        }) &&
        nestingDrawPasses(cfg.stopId, rng())
      ) {
        const picked = pickNext(selectionNext, {
          live: [
            ...live.flatMap((r) => liveWordsOf({ word: r.word, coreWord: r.core })),
            word,
          ],
          book: nextBook,
          lastSeenStage,
          rng,
        });
        if (picked.ok && !picked.practice) {
          coreWord = picked.word;
          selectionNext = picked.state;
        }
      }
      selection = selectionNext;
      // UR-83: ONE DRAW, AT SPAWN, FROM THE SEEDED STREAM. The spread is a
      // property of the rock and not of the frame, so a replay of this seed
      // gets the identical belt. `FlightScene.spawnRock` draws its own from a
      // dedicated seeded stream for the same reason.
      const spread = spreadOn ? rng() : undefined;
      const fall = fallTimeMs({
        word,
        ease: record.ease,
        spread,
        calibration: fallCalibration(calibration),
        // UR-51: the fall budget is sized for the queue the controller is
        // asking for. The scene passes exactly this (`FlightScene.spawnRock`);
        // a harness that left it out would fly a belt that builds a 4-deep
        // queue out of rocks budgeted for a 1-deep one.
        knobs: controller.knobs,
      });
      // D101: the pair falls at ONE constant rate over BOTH words' budgets, and
      // the belt is paced off what the WHOLE rock costs.
      const coreFall =
        coreWord === null
          ? 0
          : fallTimeMs({
              word: coreWord,
              ease: (nextBook[coreWord] ?? blankRecord()).ease,
              spread,
              calibration: fallCalibration(calibration),
              knobs: controller.knobs,
            });
      const totalFall = coreWord === null ? fall : nestedFallMs(fall, coreFall);
      const shellEstimate = expectedClearMs({
        length: [...word].length,
        ease: record.ease,
        calibration,
      });
      const totalEstimate =
        coreWord === null
          ? shellEstimate
          : nestedClearEstimateMs(
              shellEstimate,
              expectedClearMs({
                length: [...coreWord].length,
                ease: (nextBook[coreWord] ?? blankRecord()).ease,
                calibration,
              }),
            );
      const isCanister =
        (cfg.canisters ?? false) && maySpawnCanister(hull, maxHull, canisterLive) && rng() < 0.5;
      if (isCanister) canisterLive = true;
      const rock: BeltRock = {
        word,
        core: coreWord,
        cracked: false,
        spawnedAtMs: nowMs,
        deadlineMs: nowMs + totalFall,
        startedAtMs: null,
        isCanister,
        isPractice: outcome.practice,
        clearEstimateMs: totalEstimate,
      };
      live.push(rock);
      peakLive = Math.max(peakLive, live.length);
      lastSeenStage[word] = cfg.stopIndex;
      if (coreWord !== null) {
        lastSeenStage[coreWord] = cfg.stopIndex;
        nestedRocks += 1;
      }
      spawned += coreWord === null ? 1 : 2;

      // The board's own cost, newest rock last - the scene passes exactly this.
      const liveClearMs = live.map((r) => r.clearEstimateMs);
      const served = busy === null ? 0 : nowMs - (busy.rock.startedAtMs ?? nowMs);
      const gap =
        cfg.fixedGapMs !== null && cfg.fixedGapMs !== undefined
          ? cfg.fixedGapMs
          : spawnGapMs({
              liveClearMs,
              servedMs: served,
              fallMs: fall,
              biasMs: observedBiasMs(residuals),
              knobs: controller.knobs,
              hitRate: hitRate(controller),
            });
      gaps.push(gap);
      nextSpawnAtMs = nowMs + gap;

      const spawn: BeltSpawn = {
        word,
        spawnedAtMs: nowMs,
        clearedAtMs: rock.deadlineMs,
        hit: false,
        fkLatencyMs: 0,
        fromRetention: outcome.source === "retention",
        gapAfterMs: gap,
        queuedMs: 0,
        fallMs: totalFall,
        estimateMs: rock.clearEstimateMs,
        actualMs: 0,
      };
      spawns.push(spawn);
      byWord.set(word + rock.spawnedAtMs, spawn);
      // D101: THE CORE IS A SPAWN TOO. A belt is counted in WORDS (FR-6), and
      // `hitRate` is blasted over spawns - so a two-layer rock that contributes
      // one record would report a hit rate computed over half the words the
      // child was actually asked to type.
      if (coreWord !== null) {
        const coreSpawn: BeltSpawn = {
          word: coreWord,
          spawnedAtMs: nowMs,
          clearedAtMs: rock.deadlineMs,
          hit: false,
          fkLatencyMs: 0,
          fromRetention: false,
          gapAfterMs: gap,
          queuedMs: 0,
          fallMs: totalFall,
          estimateMs: rock.clearEstimateMs,
          actualMs: 0,
        };
        spawns.push(coreSpawn);
        byWord.set(coreWord + rock.spawnedAtMs, coreSpawn);
      }
      continue;
    }

    // 4. A free player picks the rock nearest the breach line and commits.
    if (busy === null && live.length > 0) {
      const target = live.reduce((a, b) => (b.deadlineMs < a.deadlineMs ? b : a));
      const record = nextBook[target.word] ?? blankRecord();
      const fk = recognitionMs(player, record);
      const need = fk + typeAfterFirstKeyMs(player, target.word, rng);
      target.startedAtMs = Math.max(freeSinceMs, target.spawnedAtMs);
      const spawn = byWord.get(target.word + target.spawnedAtMs);
      if (spawn !== undefined) {
        spawn.queuedMs = nowMs - target.spawnedAtMs;
        spawn.fkLatencyMs = fk;
      }
      if (spawn !== undefined) spawn.actualMs = need;
      busy = { rock: target, doneAtMs: nowMs + need, fkMs: fk };
      continue;
    }

    // 5. Nothing to do at this instant: jump to the next thing that happens.
    const candidates: number[] = [];
    if (busy !== null) candidates.push(busy.doneAtMs);
    for (const r of live) candidates.push(r.deadlineMs);
    if (pending() && live.length < liveCap()) candidates.push(nextSpawnAtMs);
    const ramp = nextRampStepMs();
    if (pending() && ramp !== null) candidates.push(ramp);
    const next = Math.min(...candidates.filter((t) => t > nowMs));
    if (!Number.isFinite(next)) break;
    advanceTo(next);
    noteDead();
  }

  if (deadSinceMs !== null) maxDeadMs = Math.max(maxDeadMs, nowMs - deadSinceMs);

  return {
    spawns,
    hull,
    maxHull,
    passedBy,
    nestedRocks,
    shellsCracked,
    coresBreached,
    shellsBreached,
    stalled,
    breaches,
    blasted,
    spawned,
    durationMs: nowMs,
    maxDeadMs,
    hitRate: spawns.length === 0 ? 1 : blasted / spawns.length,
    calibration,
    gaps,
    peakLive,
    liveTimeMs: Array.from({ length: peakLive + 1 }, (_, i) => Math.round(liveTimeMs[i] ?? 0)),
    meanLive:
      nowMs === 0
        ? 0
        : liveTimeMs.reduce((sum, ms, depth) => sum + depth * (ms ?? 0), 0) / nowMs,
    book: nextBook,
  };
}

/**
 * The retention measure AC-6e.4 is about: for words seen in an EARLIER stop and
 * met again later, how much faster is the player now than on first exposure?
 * Positive means improvement.
 */
export function retentionImprovementMs(book: WordBook): number | null {
  const deltas: number[] = [];
  for (const record of Object.values(book)) {
    if (record.hits < 2) continue;
    const first = firstFkLatency(record);
    const median = medianFkLatency(record);
    if (first === null || median === null) continue;
    deltas.push(first - median);
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}
