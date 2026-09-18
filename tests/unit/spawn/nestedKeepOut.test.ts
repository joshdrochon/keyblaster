import { describe, expect, it } from "vitest";
import {
  type LaneSpec,
  type LivePlateTrack,
  type PlateTrack,
  type Span,
  ROCK_DRIFT_PX,
  hasCleanColumn,
  plateKeepOuts,
  spawnX,
} from "@engine/spawn/index.js";

/**
 * D101 x AC-22.8: THE CORE'S PLATE IS PROVED AT THE SHELL'S SPAWN.
 *
 * ================== THE HOLE THIS CLOSES ==================
 * `plateKeepOuts` proves "no word plate ever covers another" by interval
 * arithmetic over a trajectory fixed the instant a rock is made. A two-layer
 * rock breaks part way down and puts a DIFFERENT plate on the board - different
 * word, so different width; smaller rock, so a different offset below it. The
 * shell's proof says nothing whatever about it.
 *
 * `LaneSpec.corePlate` closes it by clearing both plates against the same live
 * board at the same instant, which is possible only because the core inherits
 * the shell's column, angle and fall line exactly (`@engine/nested.nestedFallMs`
 * grants the pair one constant-rate descent). The columns the rock may take are
 * the ones legal for BOTH plates: the bands are unioned, never intersected.
 *
 * ================== HOW IT IS MEASURED HERE ==================
 * Through `spawnX` itself, over 400 rng draws, asserting that no column it ever
 * returns lands inside a band either plate forbids. Sampling the real function
 * rather than reimplementing its span arithmetic is the whole point - an
 * assertion against a restatement of the rule is an assertion about the
 * restatement.
 *
 * ================== WATCHED FAILING ==================
 * With the core dropped from `cleanSpans` - the one-line revert to the shipped
 * rule - this file reads, on this machine:
 *
 *   a column legal for the shell but not for the core is refused
 *     the core's band is open at 521.6: expected 112 to be +0
 *   the two plates' bands are UNIONED, never intersected
 *     a column inside the core's band: expected 156 to be +0
 *   a board with no legal column for the CORE declines the whole rock
 *     expected true to be false   (the belt would have placed the rock anyway)
 *
 * 112 and 156 of 400 sampled columns - better than one in four - land on top of
 * a word the child is trying to read.
 *
 * The whole-board claim - zero overlapping frames across 3456 boards with
 * nested rocks flying - is `tests/unit/flight/plateSeparation.test.ts`. This is
 * the arithmetic underneath it.
 *
 *   npx vitest run tests/unit/spawn/nestedKeepOut.test.ts --coverage.enabled=false
 */

const LANE: Omit<LaneSpec, "plate" | "livePlates" | "corePlate"> = {
  width: 1920,
  marginPx: 320,
  shipX: 960,
  shipHalfWidthPx: 46,
  rockHalfWidthPx: 60,
};

/** A plate falling the whole height of the board over 9 s, no angle. */
const track = (halfWidthPx: number, offsetY: number): PlateTrack => ({
  halfWidthPx,
  halfHeightPx: 26,
  fromY: -100 + offsetY,
  toY: 856 + offsetY,
  spawnedAtMs: 0,
  fallMs: 9000,
});

const live = (homeX: number, halfWidthPx: number, offsetY: number): LivePlateTrack => ({
  ...track(halfWidthPx, offsetY),
  homeX,
});

const DRAWS = 400;

/** Every column `spawnX` will ever hand back for this spec. */
function columns(spec: LaneSpec, avoidShipLane = false): number[] {
  const out: number[] = [];
  for (let i = 0; i < DRAWS; i += 1) {
    out.push(spawnX(spec, () => i / DRAWS, avoidShipLane));
  }
  return out;
}

const inside = (x: number, bands: readonly Span[]): boolean =>
  bands.some((b) => x > b.from && x < b.to);

/** Columns this spec produced that land inside a band the given plate forbids. */
function violations(spec: LaneSpec, plate: PlateTrack): number[] {
  const bands = plateKeepOuts(plate, spec.livePlates ?? []);
  return columns(spec).filter((x) => inside(x, bands));
}

describe("D101 x AC-22.8: a two-layer rock clears BOTH of its plates", () => {
  it("AC-26.1: with no core every column is byte-for-byte the one without the field", () => {
    // The whole feature has to be invisible to an ordinary rock, or the 3456
    // board sweep stops measuring what it has been measuring.
    const shell = track(80, 120);
    const board = [live(700, 80, 120), live(1300, 80, 120)];
    const withField: LaneSpec = { ...LANE, plate: shell, livePlates: board };
    const withCore: LaneSpec = { ...withField, corePlate: undefined };
    expect(columns(withCore)).toEqual(columns(withField));
    expect(hasCleanColumn(withCore, false)).toBe(hasCleanColumn(withField, false));
  });

  it("AC-22.8: a column legal for the shell but not for the core is refused", () => {
    // THE CASE THE FEATURE CREATES. The live plate hangs at offset 400 - level
    // with where the CORE's plate will be and 280 px clear of where the SHELL's
    // ever is - so the shell alone sees no conflict at that column at all.
    const shell = track(80, 120);
    const core = track(80, 400);
    const occupied = live(700, 80, 400);
    const shellOnly: LaneSpec = { ...LANE, plate: shell, livePlates: [occupied] };
    const both: LaneSpec = { ...shellOnly, corePlate: core };

    // The premise, asserted rather than assumed: the shell really is blind here.
    expect(plateKeepOuts(shell, [occupied]), "the shell sees nothing").toEqual([]);
    // And the core really does forbid a band: 700 +/- (80 + 80 + 2 x drift).
    const coreBands = plateKeepOuts(core, [occupied]);
    expect(coreBands).toEqual([
      { from: 700 - (80 + 80 + 2 * ROCK_DRIFT_PX), to: 700 + (80 + 80 + 2 * ROCK_DRIFT_PX) },
    ]);

    const bad = violations(both, core);
    expect(
      bad.length,
      bad.length === 0 ? "" : `the core's band is open at ${bad[0]?.toFixed(1)}`,
    ).toBe(0);
  });

  it("AC-22.8 / AC-26.6: the two plates' bands are UNIONED, never intersected", () => {
    // Two live plates, one level with the shell only and one level with the
    // core only. A rule that intersected would find NOTHING blocked, since
    // neither band is forbidden by both plates.
    const shell = track(80, 0);
    const core = track(80, 600);
    const board = [live(600, 80, 0), live(1300, 80, 600)];
    const spec: LaneSpec = { ...LANE, plate: shell, livePlates: board, corePlate: core };

    // The premise: each plate sees exactly one of the two neighbours.
    expect(plateKeepOuts(shell, board).length, "shell sees one").toBe(1);
    expect(plateKeepOuts(core, board).length, "core sees the other").toBe(1);

    const shellBad = violations(spec, shell);
    const coreBad = violations(spec, core);
    expect(shellBad.length, "a column inside the shell's band").toBe(0);
    expect(coreBad.length, "a column inside the core's band").toBe(0);
    // And a column clear of both is still available, so the union has not
    // simply swallowed the board.
    expect(hasCleanColumn(spec, false)).toBe(true);
  });

  it("AC-22.8: a board with no legal column for the CORE declines the whole rock", () => {
    // `hasCleanColumn` is the belt's licence to spawn. If the core cannot be
    // placed the rock is held, exactly as it is held when the shell cannot be -
    // one rule, one answer, no half-legal rock.
    const shell = track(80, 0);
    const core = track(700, 600);
    // Level with the CORE and 600 px clear of the shell, so the shell alone
    // sees a placeable board and the pair does not.
    const board = [live(960, 700, 600)];
    const shellOnly: LaneSpec = { ...LANE, plate: shell, livePlates: board };
    const both: LaneSpec = { ...shellOnly, corePlate: core };
    // The shell alone could be placed on this board; the pair cannot.
    expect(hasCleanColumn(shellOnly, false)).toBe(true);
    expect(hasCleanColumn(both, false)).toBe(false);
    // And `spawnX` still answers rather than throwing, because a caller that
    // has already decided a rock must appear NOW must not get a crash.
    expect(Number.isFinite(spawnX(both, () => 0.5, false))).toBe(true);
  });

  it("AC-22.8: a core plate that never comes level costs the rock nothing", () => {
    // The keep-out is narrow on purpose - only the live plates this rock will
    // actually come level with take a band. A core that is never level with the
    // neighbour must not reserve a column, or a two-layer rock would spend
    // board width it does not need and the belt would decline rocks it could
    // have placed.
    const shell = track(80, 0);
    const core = track(80, 40);
    const gone: LivePlateTrack = {
      ...track(80, 0),
      homeX: 700,
      spawnedAtMs: -20_000,
      fallMs: 9000,
    };
    const spec: LaneSpec = { ...LANE, plate: shell, livePlates: [gone], corePlate: core };
    expect(plateKeepOuts(core, [gone])).toEqual([]);
    expect(plateKeepOuts(shell, [gone])).toEqual([]);
    // Nothing is blocked, so the pair may take the whole playable span.
    const xs = columns(spec);
    expect(Math.min(...xs)).toBeCloseTo(LANE.marginPx, 6);
    expect(Math.max(...xs)).toBeLessThan(LANE.width - LANE.marginPx);
  });
});
