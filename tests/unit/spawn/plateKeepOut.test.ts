import { describe, expect, it } from "vitest";
import {
  type LaneSpec,
  type LivePlateTrack,
  type PlateTrack,
  ROCK_DRIFT_PX,
  hasCleanColumn,
  leastCoveredColumn,
  plateCentreYAt,
  plateKeepOuts,
  platesCanMeetVertically,
  spawnX,
  subtractSpans,
} from "@engine/spawn/index.js";

/**
 * THE PLATE-ON-PLATE KEEP-OUT, ONE CLAUSE AT A TIME (UR-23, second face).
 *
 * `tests/unit/flight/plateSeparation.test.ts` is the measurement: it flies real
 * boards at every belted stop and every knob and asks whether any word ever
 * ends up behind another. This file is the arithmetic underneath it - the
 * branches that the sweep exercises in bulk but never names, including the ones
 * a real board reaches once in a thousand runs.
 *
 * The two are not redundant. A sweep can only report that something did not
 * happen on the boards it flew; these say what the rule PROMISES, including in
 * the degenerate cases a board can produce and a seed usually does not.
 */

const track = (over: Partial<PlateTrack> = {}): PlateTrack => ({
  halfWidthPx: 80,
  halfHeightPx: 26.75,
  fromY: 0,
  toY: 900,
  spawnedAtMs: 0,
  fallMs: 4000,
  ...over,
});

const live = (over: Partial<LivePlateTrack> = {}): LivePlateTrack => ({
  ...track(),
  homeX: 960,
  ...over,
});

describe("plateCentreYAt: a plate's height is affine in time, and clamped", () => {
  it("interpolates between arrival and the breach line", () => {
    expect(plateCentreYAt(track(), 0)).toBe(0);
    expect(plateCentreYAt(track(), 2000)).toBe(450);
    expect(plateCentreYAt(track(), 4000)).toBe(900);
  });

  it("clamps at both ends rather than extrapolating", () => {
    // A rock past its deadline is being retired, not still falling; one asked
    // about before it arrived has not arrived.
    expect(plateCentreYAt(track(), -5000)).toBe(0);
    expect(plateCentreYAt(track(), 99_999)).toBe(900);
  });

  it("answers the breach line for a fall of zero rather than NaN", () => {
    // NaN in the comparison below reads as "no conflict" and would silently
    // DROP the keep-out, which is the direction a bug must never take.
    expect(plateCentreYAt(track({ fallMs: 0 }), 100)).toBe(900);
    expect(plateCentreYAt(track({ fallMs: Number.NaN }), 100)).toBe(900);
  });
});

describe("platesCanMeetVertically", () => {
  it("is false when the two are never in flight at the same time", () => {
    const first = track({ spawnedAtMs: 0, fallMs: 1000 });
    const second = track({ spawnedAtMs: 2000, fallMs: 1000 });
    expect(platesCanMeetVertically(first, second)).toBe(false);
  });

  it("is true when one overtakes the other, however far apart they start", () => {
    // The later rock falls in half the time, so it passes the earlier one.
    const slow = track({ spawnedAtMs: 0, fallMs: 8000 });
    const quick = track({ spawnedAtMs: 1000, fallMs: 2000 });
    expect(platesCanMeetVertically(quick, slow)).toBe(true);
    // Symmetric: which one is asked about cannot change the answer.
    expect(platesCanMeetVertically(slow, quick)).toBe(true);
  });

  it("is true when they only come close, without crossing", () => {
    // 40 px apart for the whole shared window, against a reach of 53.5.
    const lead = track({ fromY: 0, toY: 900, spawnedAtMs: 0, fallMs: 4000 });
    const chase = track({ fromY: -40, toY: 860, spawnedAtMs: 0, fallMs: 4000 });
    expect(platesCanMeetVertically(chase, lead)).toBe(true);
  });

  it("is false when the gap never closes to a plate height", () => {
    const lead = track({ fromY: 0, toY: 900, spawnedAtMs: 0, fallMs: 4000 });
    const chase = track({ fromY: -400, toY: 500, spawnedAtMs: 0, fallMs: 4000 });
    expect(platesCanMeetVertically(chase, lead)).toBe(false);
  });

  it("counts the instant a window is a single point", () => {
    const first = track({ spawnedAtMs: 0, fallMs: 1000, toY: 100 });
    const second = track({ spawnedAtMs: 1000, fallMs: 1000, fromY: 100 });
    expect(platesCanMeetVertically(first, second)).toBe(true);
  });
});

describe("plateKeepOuts", () => {
  it("bands only the plates this one can meet, and sizes them by both widths", () => {
    const incoming = track({ halfWidthPx: 60, spawnedAtMs: 1000, fallMs: 2000 });
    const meets = live({ homeX: 500, halfWidthPx: 90, spawnedAtMs: 0, fallMs: 8000 });
    const cannot = live({ homeX: 1400, spawnedAtMs: 20_000, fallMs: 1000 });
    const bands = plateKeepOuts(incoming, [meets, cannot]);
    expect(bands).toHaveLength(1);
    // 60 + 90 + two rocks' worth of sway.
    const reach = 60 + 90 + 2 * ROCK_DRIFT_PX;
    expect(bands[0]).toEqual({ from: 500 - reach, to: 500 + reach });
  });

  it("takes the sway amplitude from the caller when it is given one", () => {
    const bands = plateKeepOuts(track(), [live({ homeX: 500 })], 0);
    expect(bands[0]).toEqual({ from: 500 - 160, to: 500 + 160 });
  });

  it("treats a negative sway as none rather than shrinking the band", () => {
    const bands = plateKeepOuts(track(), [live({ homeX: 500 })], -50);
    expect(bands[0]).toEqual({ from: 500 - 160, to: 500 + 160 });
  });

  it("is empty when nothing is falling", () => {
    expect(plateKeepOuts(track(), [])).toEqual([]);
  });
});

describe("subtractSpans", () => {
  it("cuts a hole in the middle", () => {
    expect(subtractSpans([{ from: 0, to: 100 }], [{ from: 40, to: 60 }])).toEqual([
      { from: 0, to: 40 },
      { from: 60, to: 100 },
    ]);
  });

  it("trims from either end", () => {
    expect(subtractSpans([{ from: 0, to: 100 }], [{ from: -20, to: 30 }])).toEqual([
      { from: 30, to: 100 },
    ]);
    expect(subtractSpans([{ from: 0, to: 100 }], [{ from: 70, to: 200 }])).toEqual([
      { from: 0, to: 70 },
    ]);
  });

  it("leaves a span a block does not touch", () => {
    expect(subtractSpans([{ from: 0, to: 100 }], [{ from: 200, to: 300 }])).toEqual([
      { from: 0, to: 100 },
    ]);
    expect(subtractSpans([{ from: 200, to: 300 }], [{ from: 0, to: 100 }])).toEqual([
      { from: 200, to: 300 },
    ]);
  });

  it("returns nothing when the blocks cover everything", () => {
    expect(subtractSpans([{ from: 0, to: 100 }], [{ from: -1, to: 101 }])).toEqual([]);
  });

  it("drops a zero-width leftover, which is not a column a rock can use", () => {
    expect(subtractSpans([{ from: 0, to: 100 }], [{ from: 0, to: 100 }])).toEqual([]);
  });
});

describe("leastCoveredColumn: the least bad column when there is no good one", () => {
  it("takes the point furthest outside two bands it cannot escape", () => {
    // Bands centred on 300 and 700, each 200 wide; the whole span is covered.
    const spans = [{ from: 200, to: 800 }];
    const blocks = [
      { from: 200, to: 400 },
      { from: 600, to: 800 },
    ];
    expect(leastCoveredColumn(spans, blocks)).toBe(500);
  });

  it("finds the tie point between two bands of different widths", () => {
    const spans = [{ from: 0, to: 1000 }];
    const blocks = [
      // centre 200, radius 200
      { from: 0, to: 400 },
      // centre 800, radius 100
      { from: 700, to: 900 },
    ];
    // |x-200|-200 == |x-800|-100 at x = 550: 150 outside one, 150 outside the
    // other. Anywhere else one of the two is worse.
    expect(leastCoveredColumn(spans, blocks)).toBe(550);
  });

  it("stays inside the allowed spans, even when the best point is outside them", () => {
    const spans = [{ from: 0, to: 100 }];
    // Centred on 0 and 500 wide, so the whole allowed span is inside it and the
    // best available point is the one furthest from its centre.
    const blocks = [{ from: -500, to: 500 }];
    expect(leastCoveredColumn(spans, blocks)).toBe(100);
  });

  it("breaks a tie to the leftmost, so the answer is one number and not two", () => {
    const spans = [{ from: 0, to: 200 }];
    const blocks = [{ from: 50, to: 150 }];
    expect(leastCoveredColumn(spans, blocks)).toBe(0);
  });

  it("with no bands at all, answers the start of the allowed span", () => {
    expect(leastCoveredColumn([{ from: 40, to: 90 }], [])).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// The rule as `FlightScene` calls it
// ---------------------------------------------------------------------------

const lane = (over: Partial<LaneSpec> = {}): LaneSpec => ({
  width: 1920,
  marginPx: 320,
  shipX: 960,
  shipHalfWidthPx: 46,
  rockHalfWidthPx: 80,
  ...over,
});

/** Every value `rng` can hand back, close enough for a column to be a set. */
const columns = (spec: LaneSpec, avoidShipLane = false): number[] =>
  Array.from({ length: 401 }, (_, i) => spawnX(spec, () => i / 400, avoidShipLane));

describe("spawnX with the plate keep-out", () => {
  it("is byte-for-byte the old rule when no plate is described", () => {
    // A caller that says nothing about plates is not asserting that there are
    // none, so the rule must not pretend to a guarantee it has no data for.
    const spec = lane();
    expect(spawnX(spec, () => 0, false)).toBe(320);
    expect(spawnX(spec, () => 0.5, false)).toBe(960);
    expect(spawnX(spec, () => 0.25, false)).toBe(640);
  });

  it("ignores live plates when the arriving plate is not described", () => {
    const spec = lane({ livePlates: [live({ homeX: 960 })] });
    expect(spawnX(spec, () => 0.5, false)).toBe(960);
  });

  it("has nothing to avoid on an empty board", () => {
    // The first rock of a stage: a plate is described and there is no board yet.
    const spec = lane({ plate: track() });
    expect(spawnX(spec, () => 0.5, false)).toBe(960);
  });

  it("never returns a column inside a band", () => {
    const blocker = live({ homeX: 960, halfWidthPx: 90 });
    const spec = lane({ plate: track({ halfWidthPx: 80 }), livePlates: [blocker] });
    const reach = 80 + 90 + 2 * ROCK_DRIFT_PX;
    for (const x of columns(spec)) {
      expect(Math.abs(x - 960) >= reach, `column ${x}`).toBe(true);
    }
  });

  it("keeps the whole board when nothing it can meet is on it", () => {
    // The blocker has already landed by the time this one arrives.
    const gone = live({ homeX: 960, spawnedAtMs: 0, fallMs: 1000 });
    const spec = lane({
      plate: track({ spawnedAtMs: 5000, fallMs: 2000 }),
      livePlates: [gone],
    });
    expect(spawnX(spec, () => 0, false)).toBe(320);
    expect(spawnX(spec, () => 1 - 1e-12, false)).toBeCloseTo(1600, 6);
  });

  it("degrades to the least covered column when every column is banded", () => {
    // Six wide plates spread across the playable span leave no clear column.
    const blockers = [320, 576, 832, 1088, 1344, 1600].map((homeX) =>
      live({ homeX, halfWidthPx: 130 }),
    );
    const spec = lane({ plate: track({ halfWidthPx: 130 }), livePlates: blockers });
    const chosen = columns(spec);
    // It is one answer, not a random one: the fallback is deterministic so a
    // board with no good column still has a defensible one.
    expect(new Set(chosen).size).toBe(1);
    const x = chosen[0] as number;
    expect(x).toBeGreaterThanOrEqual(320);
    expect(x).toBeLessThanOrEqual(1600);
    // And it is genuinely the least bad: it covers less than the midpoint of
    // the nearest band would.
    const worst = Math.min(...blockers.map((b) => Math.abs(x - b.homeX)));
    expect(worst).toBeGreaterThan(100);
  });

  it("keeps a practice rock off the ship's lane even when that costs a column", () => {
    // D31 is the stronger claim: a re-teaching rock is never aimed at the hull,
    // whatever it costs the word underneath it.
    const blockers = [500, 1400].map((homeX) => live({ homeX, halfWidthPx: 200 }));
    const spec = lane({ plate: track({ halfWidthPx: 200 }), livePlates: blockers });
    const reach = 46 + 80 + 24;
    for (const x of columns(spec, true)) {
      expect(Math.abs(x - 960) >= reach, `practice column ${x}`).toBe(true);
    }
  });

  it("still answers when there is no off-lane room at all", () => {
    const spec = lane({
      rockHalfWidthPx: 5000,
      plate: track(),
      livePlates: [live({ homeX: 960 })],
    });
    expect(spawnX(spec, () => 0.5, true)).toBe(320);
  });
});

/**
 * ================== THE BELT'S LICENCE TO SPAWN (AC-22.8) ==================
 *
 * `spawnX` is total: handed an over-subscribed board it still answers, with the
 * least-covered column. That is right for a caller that must put a rock
 * somewhere NOW, and it is not zero - AC-22.8 asks for zero, and no choice of x
 * can deliver it, because seven plates at D41's letter spacing need about
 * 1516 px of a 1280 px playable span.
 *
 * So the belt is given the question instead of the answer: `hasCleanColumn`
 * says whether a readable column exists at all, and `FlightScene.trySpawn`
 * holds the word for a tick when it does not. These are the claims that makes
 * safe - above all that the two functions cannot disagree, and that waiting
 * actually works.
 */
describe("hasCleanColumn: whether the board has room for one more word", () => {
  it("is true on an empty board, and on one with no plate described", () => {
    expect(hasCleanColumn(lane(), false)).toBe(true);
    expect(hasCleanColumn(lane({ plate: track(), livePlates: [] }), false)).toBe(true);
    // A caller that describes no plate is asking nothing about plates.
    expect(hasCleanColumn(lane({ livePlates: [live()] }), false)).toBe(true);
  });

  it("is false exactly when spawnX has to fall back to the least covered column", () => {
    // The six-blocker board from the fallback case above: every column banded.
    const blockers = [320, 576, 832, 1088, 1344, 1600].map((homeX) =>
      live({ homeX, halfWidthPx: 130 }),
    );
    const full = lane({ plate: track({ halfWidthPx: 130 }), livePlates: blockers });
    expect(hasCleanColumn(full, false)).toBe(false);

    // One blocker is plenty of board.
    const roomy = lane({ plate: track(), livePlates: [live({ homeX: 960 })] });
    expect(hasCleanColumn(roomy, false)).toBe(true);
  });

  it("agrees with spawnX on every board, which is the only claim that matters", () => {
    // ONE FUNCTION, TWO CALLERS: if `hasCleanColumn` said yes where `spawnX`
    // covers a word, the belt would clear a board the column rule then failed
    // to place - the defect class this project keeps being bitten by, a check
    // that exercises something ADJACENT to the shipped thing. Swept rather than
    // sampled: every blocker count from none to seven, three plate widths and
    // four columns each, both practice settings.
    //
    // TWO CLAIMS, NOT ONE BICONDITIONAL, and the difference is a real edge
    // rather than a hedge. `subtractSpans` drops zero-width leftovers, so a
    // board whose only uncovered column is a single POINT - the plates exactly
    // abutting - reads as no room. That is the right answer for a uniform pick
    // that would never land on it, but it means "held" does not imply "the
    // fallback overlaps": the fallback can sit exactly on a band edge, at zero
    // overlap and zero slack. So safety is asserted strictly and tightness is
    // asserted as "no column had slack to spare", which is what was true.
    let clean = 0;
    let held = 0;
    for (let count = 0; count <= 7; count += 1) {
      for (const halfWidthPx of [60, 100, 140]) {
        for (const spread of [120, 200, 260, 340]) {
          for (const practice of [false, true]) {
            const livePlates = Array.from({ length: count }, (_, i) =>
              live({ homeX: 960 + (i - (count - 1) / 2) * spread, halfWidthPx }),
            );
            const spec = lane({ plate: track({ halfWidthPx }), livePlates });
            const bands = plateKeepOuts(spec.plate as PlateTrack, livePlates);
            const slack = (x: number): number =>
              bands.length === 0
                ? Number.POSITIVE_INFINITY
                : Math.min(
                    ...bands.map(
                      (b) => Math.abs(x - (b.from + b.to) / 2) - (b.to - b.from) / 2,
                    ),
                  );
            const where = `count ${count}, halfWidth ${halfWidthPx}, spread ${spread}, practice ${practice}`;
            const picks = columns(spec, practice);
            if (hasCleanColumn(spec, practice)) {
              clean += 1;
              // SAFETY. The belt was told there is room, so nothing `spawnX`
              // can answer may put this word over another word.
              for (const x of picks) {
                expect(slack(x) >= 0, `column ${x} is inside a keep-out (${where})`).toBe(true);
              }
            } else {
              held += 1;
              // TIGHTNESS. The belt was told to wait, so the board really had
              // nothing to spare: every column `spawnX` can answer is touching
              // a band or inside one.
              for (const x of picks) {
                expect(slack(x) <= 0, `column ${x} had room to spare (${where})`).toBe(true);
              }
            }
          }
        }
      }
    }
    // Both answers are actually reached, so the sweep is not vacuously true on
    // one side of the branch.
    expect(clean).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
  });

  it("is true when the ship lane has already taken the whole board", () => {
    // THE DEADLOCK THIS PREVENTS. With no off-lane column at all, `spawnX`
    // answers from the ship alone and never consults the plate keep-out, so
    // there is no plate question to ask. Answering false here would make the
    // belt wait for room that the SHIP is occupying and that no plate retiring
    // can ever return - the board would simply stop feeding.
    const spec = lane({
      rockHalfWidthPx: 5000,
      plate: track(),
      livePlates: [live({ homeX: 960 })],
    });
    expect(hasCleanColumn(spec, true)).toBe(true);
    expect(spawnX(spec, () => 0.5, true)).toBe(320);
  });

  it("stops being false once the board is waited out, which is why waiting works", () => {
    // THE RETRY TERMINATES, and it terminates for a reason rather than by luck.
    // Which live plates a rock must avoid depends on which it comes LEVEL with,
    // and that depends on when it launches. Here the same rock on the same
    // full board goes from held to placeable purely by arriving later, after
    // the blockers have fallen past it. `FlightScene.trySpawn` retries every
    // 200 ms, so this is the property that makes the hold a wait and not a
    // stall.
    const blockers = [320, 576, 832, 1088, 1344, 1600].map((homeX) =>
      live({ homeX, halfWidthPx: 130, spawnedAtMs: 0, fallMs: 4000 }),
    );
    const at = (spawnedAtMs: number): LaneSpec =>
      lane({
        plate: track({ halfWidthPx: 130, spawnedAtMs, fallMs: 4000 }),
        livePlates: blockers,
      });
    expect(hasCleanColumn(at(0), false)).toBe(false);
    // Launched after every blocker has reached the breach line, nothing it can
    // meet is still falling.
    expect(hasCleanColumn(at(4200), false)).toBe(true);
  });
});
