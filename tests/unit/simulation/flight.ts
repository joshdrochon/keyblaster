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

import { fallTimeMs } from "@engine/fallTime/index.js";
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
  type WordRecord,
} from "@engine/types.js";
import {
  type ControllerState,
  createController,
  hitRate,
  recordOutcome,
} from "@engine/controller/index.js";
import type { Knobs } from "@engine/controller/knobs.js";
import { expectedClearMs, observedBiasMs, spawnGapMs } from "@engine/pacing/index.js";
import { refineCalibration } from "@engine/calibration/index.js";
import {
  hullAfterShield,
  hullAfterStrike,
  hullForStage,
  isStalled,
  maySpawnCanister,
} from "@game/flight/shield.js";

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
  return {
    ...calibration,
    ikiMs: Math.max(calibration.ikiMs, DEFAULT_CALIBRATION.ikiMs),
  };
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
  book: WordBook;
}

interface BeltRock {
  word: string;
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
  let controller: ControllerState = createController({ knobs: cfg.knobs ?? {} });
  let nextBook: WordBook = { ...book };

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
  let stalled = false;

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
      const rock = busy.rock;
      const record = nextBook[rock.word] ?? blankRecord();
      live = live.filter((r) => r !== rock);
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
      controller = recordOutcome(controller, "blasted");
      if (rock.isCanister) {
        hull = hullAfterShield(hull, maxHull);
        canisterLive = false;
      }
      // The service sample the scene records: from the moment the player was
      // free to attend to this rock, to the moment it blew up. Queueing time is
      // excluded, or the gap would chase its own tail.
      residuals.push(nowMs - (rock.startedAtMs ?? nowMs) - rock.clearEstimateMs);
      const spawn = byWord.get(rock.word + rock.spawnedAtMs);
      if (spawn !== undefined) {
        spawn.clearedAtMs = nowMs;
        spawn.hit = true;
      }
      blasted += 1;
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
      if (passes) passedBy += 1;
      else hull = hullAfterStrike(hull, maxHull);
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
    if (pending() && live.length < controller.knobs.maxLive && (boardEmpty || nowMs >= nextSpawnAtMs)) {
      const outcome = pickNext(selection, {
        live: live.map((r) => r.word),
        book: nextBook,
        lastSeenStage,
        rng,
      });
      if (!outcome.ok) {
        // "no legal word" implies a non-empty board, so something is already
        // falling; the scene retries on the next frame and so do we.
        nextSpawnAtMs = nowMs + 200;
        if (boardEmpty) nowMs += 200;
        continue;
      }
      selection = outcome.state;
      const word = outcome.word;
      const record = nextBook[word] ?? blankRecord();
      const fall = fallTimeMs({
        word,
        ease: record.ease,
        calibration: fallCalibration(calibration),
      });
      const isCanister =
        (cfg.canisters ?? false) && maySpawnCanister(hull, maxHull, canisterLive) && rng() < 0.5;
      if (isCanister) canisterLive = true;
      const rock: BeltRock = {
        word,
        spawnedAtMs: nowMs,
        deadlineMs: nowMs + fall,
        startedAtMs: null,
        isCanister,
        isPractice: outcome.practice,
        clearEstimateMs: expectedClearMs({
          length: [...word].length,
          ease: record.ease,
          calibration,
        }),
      };
      live.push(rock);
      peakLive = Math.max(peakLive, live.length);
      lastSeenStage[word] = cfg.stopIndex;
      spawned += 1;

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
        fallMs: fall,
        estimateMs: rock.clearEstimateMs,
        actualMs: 0,
      };
      spawns.push(spawn);
      byWord.set(word + rock.spawnedAtMs, spawn);
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
    if (pending() && live.length < controller.knobs.maxLive) candidates.push(nextSpawnAtMs);
    const next = Math.min(...candidates.filter((t) => t > nowMs));
    if (!Number.isFinite(next)) break;
    nowMs = next;
    noteDead();
  }

  if (deadSinceMs !== null) maxDeadMs = Math.max(maxDeadMs, nowMs - deadSinceMs);

  return {
    spawns,
    hull,
    maxHull,
    passedBy,
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
