import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION } from "@engine/types.js";
import {
  type BlastHistory,
  blastedWords,
  emptyHistory,
  hitRateOf,
  meanIkiMs,
  missedWords,
  recordBlast,
  recordMiss,
  slowWords,
  stageOutcome,
} from "@game/flight/blastHistory.js";

/**
 * BLAST HISTORY - D09.
 *
 * "The end-of-stage sentence is built from the words the player just blasted."
 * The decision log's Origin section names this as the defect in Type Storm that
 * KeyBlaster exists to fix. These tests are the unit half of that claim; the
 * e2e half is `tests/e2e/blast-history.spec.ts`, which flies a real belt.
 *
 * The property that matters most is the NEGATIVE one, and it has its own test:
 * a word the player missed is not in `blastedWords`, so it cannot be
 * highlighted. Before this module existed the warp break highlighted the stop's
 * whole pool, and that property was false for every missed word in the game.
 */

function blast(word: string, ikiMs: readonly number[] = [200, 200]): {
  word: string;
  atMs: number;
  fkLatencyMs: number;
  ikiMs: readonly number[];
  wasCanister: boolean;
} {
  return { word, atMs: 0, fkLatencyMs: 400, ikiMs, wasCanister: false };
}

/** mars blasted, red blasted, planet missed - the demo shape. */
function demoRun(): BlastHistory {
  let h = emptyHistory();
  h = recordBlast(h, blast("mars"));
  h = recordBlast(h, blast("red"));
  h = recordMiss(h, { word: "planet", atMs: 900 });
  return h;
}

describe("recording (D09)", () => {
  it("starts empty and stays immutable", () => {
    const empty = emptyHistory();
    const after = recordBlast(empty, blast("mars"));
    expect(empty.blasts).toHaveLength(0);
    expect(after.blasts).toHaveLength(1);
    expect(after).not.toBe(empty);
  });

  it("D09: blasts keep the order the player earned them in", () => {
    let h = emptyHistory();
    for (const w of ["dust", "rust", "sky"]) h = recordBlast(h, blast(w));
    expect(h.blasts.map((b) => b.order)).toEqual([0, 1, 2]);
    expect(blastedWords(h)).toEqual(["dust", "rust", "sky"]);
  });

  it("D09: the history carries the timings, not just the words", () => {
    const h = recordBlast(emptyHistory(), {
      word: "rivers",
      atMs: 1234,
      fkLatencyMs: 610,
      ikiMs: [180, 240, 190],
      wasCanister: true,
    });
    const [only] = h.blasts;
    expect(only?.atMs).toBe(1234);
    expect(only?.fkLatencyMs).toBe(610);
    expect(only?.ikiMs).toEqual([180, 240, 190]);
    expect(only?.wasCanister).toBe(true);
  });
});

describe("blastedWords - what the warp sentence may highlight (D09)", () => {
  it("D09: contains exactly the words the player shot down", () => {
    expect(blastedWords(demoRun())).toEqual(["mars", "red"]);
  });

  it("D09 / AC-12.3: a MISSED word is never in the blasted list", () => {
    // This is the whole finding. Highlighting the stop's pool put "planet"
    // here; highlighting the run does not.
    expect(blastedWords(demoRun())).not.toContain("planet");
  });

  it("de-duplicates a word served twice, keeping the FIRST blast's position", () => {
    let h = emptyHistory();
    h = recordBlast(h, blast("ice"));
    h = recordBlast(h, blast("cold"));
    h = recordBlast(h, blast("ice"));
    expect(blastedWords(h)).toEqual(["ice", "cold"]);
  });

  it("de-duplicates on the normalised form, so case and punctuation agree", () => {
    let h = emptyHistory();
    h = recordBlast(h, blast("Mars"));
    h = recordBlast(h, blast("mars."));
    expect(blastedWords(h)).toEqual(["Mars"]);
  });

  it("drops a word that normalises to nothing rather than emitting an empty", () => {
    const h = recordBlast(emptyHistory(), blast("!!!"));
    expect(blastedWords(h)).toEqual([]);
  });

  it("an empty run highlights nothing", () => {
    expect(blastedWords(emptyHistory())).toEqual([]);
  });
});

describe("missedWords - what Shadow names (AC-15.5)", () => {
  it("AC-15.5: lists the words that got past the ship, in order", () => {
    let h = emptyHistory();
    h = recordMiss(h, { word: "rivers", atMs: 100 });
    h = recordMiss(h, { word: "empty", atMs: 200 });
    expect(missedWords(h)).toEqual(["rivers", "empty"]);
  });

  it("a word missed once and blasted later is NOT a word they let through", () => {
    let h = emptyHistory();
    h = recordMiss(h, { word: "surface", atMs: 100 });
    h = recordBlast(h, blast("surface"));
    expect(missedWords(h)).toEqual([]);
    expect(blastedWords(h)).toEqual(["surface"]);
  });

  it("de-duplicates a word missed twice", () => {
    let h = emptyHistory();
    h = recordMiss(h, { word: "pilot", atMs: 1 });
    h = recordMiss(h, { word: "pilot", atMs: 2 });
    expect(missedWords(h)).toEqual(["pilot"]);
  });
});

describe("slow words and hit rate (FR-15)", () => {
  it("meanIkiMs averages the inter-key gaps and ignores the first-key latency", () => {
    expect(meanIkiMs({ ...blast("dust", [100, 300]), order: 0 })).toBe(200);
  });

  it("a one-letter word has no intervals and is never slow", () => {
    expect(meanIkiMs({ ...blast("a", []), order: 0 })).toBeNull();
    const h = recordBlast(emptyHistory(), blast("a", []));
    expect(slowWords(h)).toEqual([]);
  });

  it("slow is measured against THIS player's median, not a fixed table", () => {
    const h = recordBlast(emptyHistory(), blast("planet", [600, 600]));
    // Default median 350 ms -> threshold 525 ms: 600 is slow.
    expect(slowWords(h, DEFAULT_CALIBRATION)).toEqual(["planet"]);
    // A slower child, same keystrokes: not slow for them.
    expect(slowWords(h, { ikiMs: 600, fkLatencyMs: 800 })).toEqual([]);
  });

  it("a word already named as missed is not also named as slow", () => {
    let h = emptyHistory();
    h = recordBlast(h, blast("dust", [900, 900]));
    h = recordMiss(h, { word: "dust", atMs: 10 });
    // Blasted somewhere, so not missed; slow stands.
    expect(missedWords(h)).toEqual([]);
    expect(slowWords(h)).toEqual(["dust"]);
  });

  it("hitRate is blasts over resolutions, and an empty run is 1", () => {
    expect(hitRateOf(emptyHistory())).toBe(1);
    expect(hitRateOf(demoRun())).toBeCloseTo(2 / 3, 10);
  });

  it("hitRate is 0 when nothing was blasted at all", () => {
    const h = recordMiss(emptyHistory(), { word: "sky", atMs: 1 });
    expect(hitRateOf(h)).toBe(0);
  });
});

describe("stageOutcome - the whole hand-off to the warp break", () => {
  it("D09 + AC-15.5: one value carries the highlight list and the coach request", () => {
    expect(stageOutcome(demoRun())).toEqual({
      blasted: ["mars", "red"],
      missed: ["planet"],
      slow: [],
      hitRate: 2 / 3,
    });
  });

  it("an untouched run hands over nothing to highlight", () => {
    expect(stageOutcome(emptyHistory())).toEqual({
      blasted: [],
      missed: [],
      slow: [],
      hitRate: 1,
    });
  });
});
