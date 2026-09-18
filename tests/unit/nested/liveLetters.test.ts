import { describe, expect, it } from "vitest";
import {
  createSelectionState,
  firstLetter,
  pickNext,
  type SelectionState,
} from "@engine/selection/index.js";
import { applyEvent, blankRecord, type WordBook } from "@engine/words/index.js";
import { liveWordsOf, nestingAllowed, nestingDrawPasses } from "@engine/nested/index.js";
import { stagePoolFor, retentionPoolFor, mulberry32 } from "@game/flight/stage.js";
import { stageIndexOf, type StopId } from "@engine/types.js";

/**
 * D101 x AC-2.1: A CORE REVEALED MID-BELT MUST NOT COLLIDE WITH ANYTHING.
 *
 * ================== WHY THIS IS THE DANGEROUS ONE ==================
 * AC-2.1 - no two live asteroids share a first letter while the D25 tier is
 * locked - is the only invariant in the selection engine whose breach breaks a
 * MECHANIC rather than a policy. Auto-lock fires on the first keystroke and
 * never switches targets (D24, AC-3.1, AC-3.3), so two live words starting with
 * "s" means the child presses "s" and the game chooses a rock for them. The PRD
 * states it as an invariant over 10,000 spawns with exactly one exception.
 *
 * A two-layer rock puts a word on the board that NOBODY CAN SEE. The shell
 * falls carrying "storm"; somewhere inside it is "ice", and "ice" becomes a
 * live, typeable target at an instant the belt does not control - the moment
 * the child finishes the shell. Everything that was legal when the core was
 * chosen must still be legal then, including against rocks that spawned in
 * between, and including against the shell the child is half way through.
 *
 * ================== WHAT THE FIX IS ==================
 * The core's first letter is RESERVED for the shell's whole life. Both words
 * are drawn at spawn and both are reported as live to `pickNext` until the
 * shell breaks (`@engine/nested.liveWordsOf`), so nothing else can ever take
 * the letter the core is holding. `SHIPPED` below is that rule.
 *
 * ================== WATCHED FAILING ==================
 * `L-core-collides` is the negative control and it runs on every invocation: the
 * identical belt with the reservation removed, i.e. the core chosen at spawn but
 * NOT reported live - which is what a naive implementation does and what a
 * reveal-time pick would be equivalent to. It is not a restatement of the fix;
 * it calls the same picker with the same seeds and only changes what `live`
 * says.
 *
 * With the reservation removed, on this machine:
 *
 *   neptune   741 colliding instants over 40 belts
 *             first: "star" and "solar" both live on "s" at 39600 ms, seed 2
 *   pluto    1083 colliding instants over 40 belts
 *             first: "small" and "size" both live on "s" at 3600 ms, seed 1
 *
 * Against ZERO with the reservation on, at both stops, over the same 40 belts
 * and the same 129 / 157 two-layer rocks. Not a margin - the invariant either
 * holds or the game picks a target for the child.
 *
 *   NESTED_PROBE=1 npx vitest run tests/unit/nested/liveLetters.test.ts \
 *     --coverage.enabled=false
 */

const NESTED_STOPS: readonly StopId[] = ["neptune", "pluto"];
const EARLIER: Readonly<Record<string, readonly StopId[]>> = {
  neptune: ["mars", "jupiter", "saturn", "uranus"],
  pluto: ["mars", "jupiter", "saturn", "uranus", "neptune"],
};

const SEEDS = 40;
/** `DEFAULT_FLIGHT_CONFIG.stageWordCount`. */
const STAGE_WORDS = 58;
/** `MAX_LIVE_MAX`, i.e. the deepest board and therefore the most letter pressure. */
const MAX_LIVE = 7;

interface SimRock {
  word: string;
  core: string | null;
  /** Scene clock at which the shell breaks, or null for an ordinary rock. */
  cracksAtMs: number | null;
  retiresAtMs: number;
}

interface Collision {
  readonly stopId: StopId;
  readonly seed: number;
  readonly letter: string;
  readonly words: readonly [string, string];
  readonly atMs: number;
}

interface Run {
  readonly collisions: Collision[];
  readonly nested: number;
  readonly spawns: number;
  readonly tierUnlocked: number;
}

/**
 * Fly one belt and record every instant two live words shared a first letter.
 *
 * THE PLAYER MODEL IS A METRONOME, and that is deliberate. This file asks about
 * the SET of live words, never about whether a child can clear them - the belt's
 * survivability is `tests/unit/simulation/nestedRoute.test.ts`'s question. What
 * matters here is that rocks come and go and that shells break at every point
 * in a fall, so a fixed cadence with the crack placed a fixed way through the
 * rock's life sweeps the reveal across the whole board rather than landing it
 * somewhere convenient.
 *
 * `reserve` false is the negative control: the core is still chosen at spawn and
 * still revealed, but it is not declared live, so the picker is free to hand the
 * same first letter to something else in the meantime.
 */
function flyLetters(stopId: StopId, seed: number, reserve: boolean): Run {
  const rng = mulberry32(seed);
  const stage = stageIndexOf(stopId);
  let selection: SelectionState = createSelectionState({
    stage,
    stagePool: stagePoolFor(stopId),
    retentionPool: retentionPoolFor(EARLIER[stopId] ?? []),
    book: {},
  });
  let book: WordBook = {};
  const collisions: Collision[] = [];
  let live: SimRock[] = [];
  let nowMs = 0;
  let spawned = 0;
  let nested = 0;
  let nestDraw = 0;
  const tierUnlocked = selection.sharedPrefixTier ? 1 : 0;

  /** Every word a child could start typing at this instant. */
  const liveWords = (): string[] =>
    live.flatMap((r) =>
      r.cracksAtMs !== null && nowMs >= r.cracksAtMs
        ? [r.core as string]
        : [...liveWordsOf({ word: r.word, coreWord: r.core })].slice(
            0,
            // Under the control the core is NOT declared live until it is
            // revealed, which is the whole of the defect being reproduced.
            r.core === null ? 1 : reserve ? 2 : 1,
          ),
    );

  /** What is actually ON SCREEN and typeable - never the reserved-but-hidden core. */
  const visibleWords = (): string[] =>
    live.map((r) =>
      r.core !== null && r.cracksAtMs !== null && nowMs >= r.cracksAtMs
        ? (r.core as string)
        : r.word,
    );

  const checkVisible = (): void => {
    const seen = new Map<string, string>();
    for (const w of visibleWords()) {
      const l = firstLetter(w);
      const prior = seen.get(l);
      if (prior !== undefined && prior !== w) {
        collisions.push({ stopId, seed, letter: l, words: [prior, w], atMs: nowMs });
      }
      seen.set(l, w);
    }
  };

  let guard = 0;
  while (spawned < STAGE_WORDS && (guard += 1) < 100_000) {
    // Retire the oldest rock once the board is full, so words keep cycling.
    live = live.filter((r) => r.retiresAtMs > nowMs);

    if (live.length < MAX_LIVE) {
      const outcome = pickNext(selection, { live: liveWords(), book, rng });
      if (!outcome.ok) {
        nowMs += 200;
        continue;
      }
      let state = outcome.state;
      let core: string | null = null;
      if (
        nestingAllowed({
          stopId,
          nestedLive: live.filter((r) => r.core !== null && (r.cracksAtMs ?? 0) > nowMs)
            .length,
          wordsLeft: STAGE_WORDS - spawned,
          anyPractice: outcome.practice,
        }) &&
        nestingDrawPasses(stopId, (nestDraw = (nestDraw + 0.17) % 1))
      ) {
        const coreOutcome = pickNext(state, {
          live: [...liveWords(), outcome.word],
          book,
          rng,
        });
        if (coreOutcome.ok && !coreOutcome.practice) {
          core = coreOutcome.word;
          state = coreOutcome.state;
          nested += 1;
        }
      }
      selection = state;
      book = {
        ...book,
        [outcome.word]: applyEvent(book[outcome.word] ?? blankRecord(), {
          kind: "hit",
          fkLatencyMs: 500,
          ikiMs: [350],
          atMs: nowMs,
          stage,
        }),
      };
      const lifeMs = 9000;
      live.push({
        word: outcome.word,
        core,
        // The shell breaks 40% of the way through the pair's life, so a reveal
        // lands in the middle of a busy board rather than at either edge.
        cracksAtMs: core === null ? null : nowMs + lifeMs * 0.4,
        retiresAtMs: nowMs + lifeMs,
      });
      spawned += core === null ? 1 : 2;
      checkVisible();
    }

    // Step the clock by less than a crack interval so every reveal is sampled.
    nowMs += 300;
    checkVisible();
  }

  return { collisions, nested, spawns: spawned, tierUnlocked };
}

function sweep(reserve: boolean): Record<string, Run> {
  const out: Record<string, Run> = {};
  for (const stopId of NESTED_STOPS) {
    const all: Collision[] = [];
    let nested = 0;
    let spawns = 0;
    let tierUnlocked = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = flyLetters(stopId, seed, reserve);
      all.push(...run.collisions);
      nested += run.nested;
      spawns += run.spawns;
      tierUnlocked += run.tierUnlocked;
    }
    out[stopId] = { collisions: all, nested, spawns, tierUnlocked };
  }
  return out;
}

describe("D101 x AC-2.1: a revealed core never collides with a live word", () => {
  const shipped = sweep(true);
  const control = sweep(false);
  if (process.env.NESTED_PROBE === "1") {
    for (const stopId of NESTED_STOPS) {
      console.log(
        stopId,
        "nested", shipped[stopId]!.nested,
        "spawns", shipped[stopId]!.spawns,
        "shipped collisions", shipped[stopId]!.collisions.length,
        "control collisions", control[stopId]!.collisions.length,
        "control worst", JSON.stringify(control[stopId]!.collisions[0] ?? null),
      );
    }
  }

  it("AC-2.1: the D25 shared-prefix tier is LOCKED for every run measured", () => {
    // Without this the invariant is deliberately suspended and the sweep below
    // would be green by having nothing to check.
    for (const stopId of NESTED_STOPS) {
      expect(shipped[stopId]!.tierUnlocked, `${stopId}`).toBe(0);
    }
  });

  it("AC-2.1: the sweep actually produced two-layer rocks to measure", () => {
    // A guard against the sweep passing because nothing nested. MEASURED over
    // 40 seeds: neptune 129 nested rocks of 2320 spawns, pluto 157 of 2320.
    for (const stopId of NESTED_STOPS) {
      expect(shipped[stopId]!.nested, `${stopId} nested`).toBeGreaterThan(100);
      expect(shipped[stopId]!.spawns, `${stopId} spawns`).toBeGreaterThan(2000);
    }
  });

  it("AC-2.1 / AC-26.6: no two live words share a first letter, at any instant, at either stop", () => {
    for (const stopId of NESTED_STOPS) {
      const found = shipped[stopId]!.collisions;
      const worst = found[0];
      expect(
        found.length,
        worst === undefined
          ? ""
          : `${stopId} seed ${worst.seed}: "${worst.words[0]}" and "${worst.words[1]}" both live on "${worst.letter}" at ${worst.atMs} ms`,
      ).toBe(0);
    }
  });

  it("L-core-collides: WITHOUT the reservation the mechanic breaks, and here is the number", () => {
    // The negative control. Same picker, same seeds, same reveals - the ONLY
    // change is that the core is not declared live while it is hidden, which is
    // exactly what a reveal-time pick amounts to.
    const totals = NESTED_STOPS.map((s) => control[s]!.collisions.length);
    expect(
      totals.reduce((a, b) => a + b, 0),
      "the control must reproduce the defect, or it is not a control",
    ).toBeGreaterThan(0);
    // And the shipped rule must beat it outright rather than by a margin.
    for (const stopId of NESTED_STOPS) {
      expect(shipped[stopId]!.collisions.length).toBeLessThan(
        control[stopId]!.collisions.length,
      );
    }
  });
});
