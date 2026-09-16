/**
 * A deterministic whole-flight simulation, built from the real engine modules.
 *
 * This is the harness behind AC-6e.3 and AC-6e.4. Both ACs are claims about
 * what happens over a WHOLE RUN, so neither can be checked by a unit test of
 * any single module - the emergent behaviour is the thing under test.
 *
 * Nothing here models gameplay it also asserts. The simulated player has a
 * fixed per-character accuracy and a fixed typing speed; whether a word is hit
 * falls out of fall time versus typing time, both computed by the real engine.
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
import { DEFAULT_CALIBRATION, type WordRecord } from "@engine/types.js";

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
          calibration: { ...DEFAULT_CALIBRATION, ikiMs: player.ikiMs },
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
