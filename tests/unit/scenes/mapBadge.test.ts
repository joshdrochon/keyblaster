import { describe, expect, it } from "vitest";
import { contrastRatio } from "@engine/contrast/index.js";
import { STOP_IDS, type StopProgress } from "@engine/types";
import { litCount, routeView } from "@engine/progress/index.js";
import { colorblindVariant, paletteAt, paletteFor } from "@game/render/palette";
import { INK, SKY_PLATE, SPACE, STEP, STEPS, TYPE } from "@game/ui/theme";
import { GUTTER, HEADING_TOP, headingText } from "@game/ui/grid";
import { rectsOverlap } from "@game/ui/layout";
import {
  BADGE_BAR_GAP,
  BADGE_COUNT_GAP,
  BADGE_LABEL_GAP,
  BADGE_LINE_SIZE,
  BADGE_MISSION_SIZE,
  BADGE_PAD_X,
  BADGE_PAD_Y,
  BADGE_PLATE,
  BADGE_ROW_GAP,
  BAR_H,
  CHIP,
  SEGMENT_MIN_RATIO,
  SEGMENT_UNLIT_INK,
  SEG_GAP,
  SEG_W,
  badgeBarY,
  badgeBox,
  badgeGoalY,
  badgeInkLeft,
  badgeInkRight,
  badgeLineH,
  badgeMissionY,
  barSegments,
  barWidth,
  chipX,
  headerBottom,
  panelInkLeft,
  segmentInk,
  shipBox,
} from "@game/scenes/support/mapLayout";

/**
 * THE MISSION BADGE: one card where three plates were.
 *
 * ================== WHAT WAS REPORTED ==================
 * The map's top-left was three stacked sky plates and the owner called it too
 * busy:
 *
 *   [ Route to Pluto ]            heading plate, 44 px on y=84
 *   [ Seven stops, one lit path ] subtitle plate, 20 px on y=168
 *   [ 6 of 7 beacons lit ]        progress plate, 20 px on y=216
 *
 * It is one badge now: a mission line, a goal line with its count, and a bar
 * divided into one segment per beacon.
 *
 * ================== WATCHED FAILING (coding-standards rule 4) ==================
 * Every case below was broken in `support/mapLayout.ts` and the printed value
 * read off a real red run. The breaks and their output are recorded case by
 * case; the four the ticket names are:
 *
 *   `SEG_W * STOP_IDS.length` -> `SEG_W * 6`
 *     the bar has one segment per beacon, and seven of them
 *     expected 6 to be 7
 *
 *   `lit: view.find(...)` -> `lit: true`
 *     mid-run: the bar lights exactly the beacons the profile lit
 *     the bar lit earth,mars,jupiter,saturn,uranus,neptune,pluto; the profile
 *     lit earth,mars,jupiter,saturn: expected 7 to be 4
 *
 *   `BADGE_PLATE.stroke: INK.line` -> `INK.accent`
 *     the card's border is INK.line and never the accent
 *     the badge's border is painted in the focus accent: expected '#FFC857'
 *     not to be '#FFC857'
 *
 *   `badgeBox().x: GUTTER` -> `GUTTER + 24`
 *     the badge starts on the gutter, like everything else on this screen
 *     expected 120 to be 96
 *
 *   npx vitest run tests/unit/scenes/mapBadge.test.ts --coverage.enabled=false
 */

/**
 * WHAT THE THREE PLATES MEASURED, WRITTEN OUT.
 *
 * The declared literal, not a re-derivation: `headerBottom()` is the number
 * being changed, so a test that recomputed it from the same constants would
 * agree with itself. 216 is `grid.THIRD_LINE_TOP`, 31 is `TYPE.caption` at the
 * Devanagari line height, and 8 was the map header's own `padY`, top and
 * bottom - i.e. the third plate's bottom edge, off the shipped build.
 */
const OLD_HEADER_BOTTOM = 216 + 31 + 8 * 2;

/** A cleared, beacon-placed stop, as the store holds one. */
const cleared = (stopId: StopProgress["stopId"]): StopProgress => ({
  stopId,
  cleared: true,
  stars: 3,
  bestWpm: 24,
  bestAccuracy: 0.96,
  lastWpm: 22,
  lastAccuracy: 0.95,
  beaconPlacedAt: 1_700_000_000_000,
});

/** A profile with the first `n` stops on the route cleared. */
const progressWith = (n: number): StopProgress[] => STOP_IDS.slice(0, n).map(cleared);
const routeWith = (n: number): ReturnType<typeof routeView> =>
  routeView(progressWith(n), STOP_IDS);

describe("one card, not three plates", () => {
  it("starts on the gutter, like everything else on this screen", () => {
    const box = badgeBox();
    expect(box.x, `the badge left ${GUTTER}`).toBe(GUTTER);
    expect(box.y, `the badge left HEADING_TOP`).toBe(HEADING_TOP);
  });

  it("puts its ink on the same line the three plates put theirs", () => {
    // `grid.headingText()` is where a PLATED heading's text goes so that the
    // PLATE lands on the grid line. The badge is one big plate, so its first
    // row's ink is that point exactly - which is what keeps
    // `grid-conformance.spec.ts`'s header origin met with the plates gone.
    // The badge is a CARD, so it takes card insets and its ink sits inside
    // them. What still has to hold is the PLATE on the grid, asserted below.
    expect(badgeBox().x).toBe(GUTTER);
    expect(badgeBox().y).toBe(HEADING_TOP);
    // ...and it is the SAME ink column the board at the foot hangs off (UR-54).
    expect(badgeInkLeft()).toBe(GUTTER + BADGE_PAD_X);
  });

  it("is SHORTER than the three plates it replaced", () => {
    // The whole complaint was "too busy". A badge as tall as the block it
    // replaced has collapsed three objects into one and saved nothing.
    expect(
      headerBottom(),
      `the badge ends at ${headerBottom()}, the three plates ended at ${OLD_HEADER_BOTTOM}`,
    ).toBeLessThan(OLD_HEADER_BOTTOM);
    expect(OLD_HEADER_BOTTOM - headerBottom()).toBe(11);
  });

  it("is three rows and nothing else, each row on the type scale", () => {
    const box = badgeBox();
    const rows =
      BADGE_PAD_Y +
      badgeLineH(BADGE_MISSION_SIZE) +
      BADGE_ROW_GAP +
      badgeLineH(BADGE_LINE_SIZE) +
      BADGE_BAR_GAP +
      BAR_H +
      BADGE_PAD_Y;
    expect(box.h, "the badge's height is not its three rows").toBe(rows);
    expect([TYPE.heading, TYPE.caption]).toContain(BADGE_MISSION_SIZE);
    expect([TYPE.heading, TYPE.caption]).toContain(BADGE_LINE_SIZE);
  });

  it("hangs every gap and pad off the spacing scale", () => {
    for (const [name, step] of [
      ["mission -> goal", BADGE_ROW_GAP],
      ["goal -> bar", BADGE_BAR_GAP],
      ["goal -> count", BADGE_COUNT_GAP],
      ["label -> sentence", BADGE_LABEL_GAP],
      ["between segments", SEG_GAP],
    ] as const) {
      expect(STEPS, `${name} (${step}) is on no scale`).toContain(step);
    }
    // The card's own inset is the one every plated block in the product uses.
    expect(BADGE_PAD_X).toBe(STEP.pad);
    expect(BADGE_PAD_Y).toBe(STEP.unit);
  });

  it("the count sits inside ONE laid-out run with the goal line", () => {
    // `ui/alignment.RUN_GAP` is `STEP.unit`: two objects closer together than
    // the product's vertical unit are one line, and a row is judged on its
    // first run's left edge. The count therefore has to be within that gap of
    // the sentence it follows, or it becomes a fourth off-model element on a
    // screen `left-edge-conformance.spec.ts` budgets at three.
    expect(BADGE_COUNT_GAP).toBeLessThanOrEqual(STEP.unit);
    expect(BADGE_LABEL_GAP).toBeLessThanOrEqual(STEP.unit);
  });

  it("clears the ship, the chips and the route", () => {
    const box = badgeBox();
    // The ship hovers between the header and the route; it was cleared against
    // the THREE PLATES, and the badge is shorter, so it still is.
    expect(shipBox(0).y).toBeGreaterThan(headerBottom());
    // The chips are the owner's stated button standard and are untouched: the
    // badge must not reach them.
    expect(
      rectsOverlap(box, { x: chipX(0), y: CHIP.y, w: CHIP.w * 2 + CHIP.gap, h: CHIP.h }),
      "the badge runs under the Beacon Log / Settings chips",
    ).toBe(false);
  });
});

describe("the bar: one segment per beacon", () => {
  it("has one segment per stop, and seven of them", () => {
    const segments = barSegments(routeWith(0));
    expect(segments.length).toBe(STOP_IDS.length);
    expect(segments.length, "seven stops, seven segments").toBe(7);
    expect(segments.map((s) => s.stopId)).toEqual([...STOP_IDS]);
  });

  it("fills the badge's ink column exactly, segment to segment", () => {
    const segments = barSegments(routeWith(0));
    const first = segments[0];
    const last = segments[segments.length - 1];
    expect(first?.x).toBe(badgeInkLeft());
    expect((last?.x ?? 0) + (last?.w ?? 0), "the bar does not end on the ink line").toBe(
      badgeInkRight(),
    );
    expect(barWidth()).toBe(badgeInkRight() - badgeInkLeft());
    // Even segments, even gaps. A bar whose units are not the same size is a
    // bar a child cannot count.
    expect(new Set(segments.map((s) => s.w))).toEqual(new Set([SEG_W]));
    for (let i = 1; i < segments.length; i += 1) {
      const gap = (segments[i]?.x ?? 0) - ((segments[i - 1]?.x ?? 0) + (segments[i - 1]?.w ?? 0));
      expect(gap, `segment ${i} sits ${gap}px from the one before it`).toBe(SEG_GAP);
    }
  });

  it("sits on the badge's third row, at the pre-flight bar's height", () => {
    const segments = barSegments(routeWith(0));
    expect(new Set(segments.map((s) => s.y))).toEqual(new Set([badgeBarY()]));
    expect(new Set(segments.map((s) => s.h))).toEqual(new Set([BAR_H]));
    // `PreflightScene.paintRow` draws `barH = 8` with a radius of 4. The height
    // is shared; the radius follows from `corner: "pill"` being half of it.
    expect(BAR_H).toBe(8);
    expect(badgeBarY()).toBe(badgeGoalY() + badgeLineH(BADGE_LINE_SIZE) + BADGE_BAR_GAP);
    expect(badgeBarY() + BAR_H + BADGE_PAD_Y).toBe(headerBottom());
  });

  it.each([
    [0, 0],
    [2, 2],
    [6, 6],
    [7, 7],
  ])("%i beacons lit: the bar lights exactly that many", (placed, expected) => {
    const segments = barSegments(routeWith(placed));
    const lit = segments.filter((s) => s.lit);
    expect(
      lit.length,
      `the bar lit ${lit.map((s) => s.stopId).join(",") || "nothing"}; ` +
        `the profile lit ${litCount(progressWith(placed))}`,
    ).toBe(expected);
    // THE COUNT BESIDE THE BAR IS THE SAME NUMBER. `litCount` is what the badge
    // prints; the segments are what it draws. Two readers of one route was the
    // defect that put "7 of 7 beacons lit" over seven stops marked "Locked".
    expect(lit.length).toBe(litCount(progressWith(placed)));
  });

  it("lights the beacons the profile lit, not the first n of them", () => {
    // Matched by stop id, not by index. A bar zipped against `STOP_IDS` by
    // position lights the wrong beacon the day `routeView` returns another
    // order, and nothing on screen would say so.
    const view = routeView([cleared("saturn")], STOP_IDS);
    const lit = barSegments(view).filter((s) => s.lit);
    expect(lit.map((s) => s.stopId)).toEqual(["saturn"]);
  });
});

describe("the ink: the accent is the focus language, never a border", () => {
  it("paints the card's border in INK.line", () => {
    expect(
      BADGE_PLATE.stroke,
      "the badge's border is painted in the focus accent",
    ).not.toBe(INK.accent);
    expect(BADGE_PLATE.stroke).toBe(INK.line);
    expect(BADGE_PLATE.radius).toBe(SPACE.radius);
  });

  it("uses no stop's accent for the border either", () => {
    // The reference mock's glow border is the stop gold. A control does not
    // paint itself in the accent - that is the rule that fixed the Title's
    // double-ringed buttons - and "the stop's accent" is the same mistake
    // wearing the palette's clothes (`ui/plate.CHROME_INK` makes the argument
    // the other way round for hardware).
    for (const stopId of STOP_IDS) {
      expect(BADGE_PLATE.stroke, stopId).not.toBe(paletteFor(stopId).accent);
      expect(BADGE_PLATE.stroke, stopId).not.toBe(colorblindVariant(stopId).accent);
    }
  });

  it("is an opaque card, like the board at the foot of the screen", () => {
    expect(BADGE_PLATE.alpha).toBe(1);
    expect(BADGE_PLATE.fill).toBe(SKY_PLATE.fill);
  });
});

describe("the tint: each lit segment in its own stop's colour", () => {
  it("gives every stop its own accent, in BOTH palettes, and prints the ratio", () => {
    const measured: Record<string, { normal: number; colourblind: number }> = {};
    for (const stopId of STOP_IDS) {
      for (const colourblind of [false, true]) {
        const ink = segmentInk(stopId, colourblind);
        const ratio = contrastRatio(ink, BADGE_PLATE.fill);
        expect(ink, `${stopId} lost its own colour`).toBe(
          paletteAt(stopId, colourblind).accent,
        );
        expect(
          ratio,
          `${stopId}${colourblind ? " (colourblind)" : ""}: ${ink} on the badge is ` +
            `${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(SEGMENT_MIN_RATIO);
      }
      measured[stopId] = {
        normal: Number(contrastRatio(segmentInk(stopId, false), BADGE_PLATE.fill).toFixed(2)),
        colourblind: Number(
          contrastRatio(segmentInk(stopId, true), BADGE_PLATE.fill).toFixed(2),
        ),
      };
    }
    // Seven DIFFERENT colours either way, or the tint is decoration.
    expect(new Set(STOP_IDS.map((s) => segmentInk(s, false))).size).toBe(7);
    expect(new Set(STOP_IDS.map((s) => segmentInk(s, true))).size).toBe(7);
    // Printed, so the report carries the measurement rather than the claim.
    expect(measured).toEqual({
      // Earth's accent became its planet blue (`#4A87E0`); 12.29 was the gold.
      earth: { normal: 5.25, colourblind: 14 },
      mars: { normal: 6.71, colourblind: 11.1 },
      jupiter: { normal: 14.95, colourblind: 15.79 },
      saturn: { normal: 9.71, colourblind: 14.3 },
      uranus: { normal: 17.04, colourblind: 17.04 },
      neptune: { normal: 7.85, colourblind: 10.97 },
      pluto: { normal: 11.28, colourblind: 13.15 },
    });
  });

  it("Saturn's segment is its PLANET gold, the value just corrected", () => {
    // The palette edit that landed tonight. Named, because "the tint is the
    // stop's colour" is only worth having if the stop's colour is right.
    expect(segmentInk("saturn", false)).toBe("#DDB463");
  });

  it("reads the PLATE accent, which is the half of this that could go wrong", () => {
    // `worldAccent` is the D41 luminance-separated one, and on the two
    // near-white stops it is a near-black: Saturn and Pluto are both #111318,
    // i.e. 1.02:1 on this card. That field being read by mistake is what made
    // the typed letter invisible in colourblind mode once already
    // (`render/palette.ts`), and a bar painted from it would be a bar with two
    // segments a colourblind child cannot see.
    for (const stopId of ["saturn", "pluto"] as const) {
      const world = colorblindVariant(stopId).worldAccent;
      const ratio = contrastRatio(world, BADGE_PLATE.fill);
      expect(
        ratio,
        `${stopId}: worldAccent ${world} would be ${ratio.toFixed(2)}:1 on the badge`,
      ).toBeLessThan(SEGMENT_MIN_RATIO);
      expect(segmentInk(stopId, true)).not.toBe(world);
    }
  });

  it("falls back to the 'earned' ink if a palette edit ever darkens an accent", () => {
    // The floor is a guard, not a branch anything takes today: every stop
    // clears it in both palettes (above). It is asserted through the one thing
    // that can be checked without faking a palette - that the fallback ink is
    // itself legible, so the guard cannot trade one invisible segment for
    // another.
    expect(contrastRatio(INK.lit, BADGE_PLATE.fill)).toBeGreaterThanOrEqual(
      SEGMENT_MIN_RATIO,
    );
    expect(SEGMENT_MIN_RATIO, "WCAG 2.1 non-text contrast").toBe(3);
  });

  it("an unlit segment is the empty star's ink, and is countable", () => {
    // `DirectorMapScene.drawStars` draws an empty star as an outline in
    // `INK.textDim` - "three stars a child cannot count is a rating that does
    // not exist". Seven segments a child cannot count is the same defect.
    expect(SEGMENT_UNLIT_INK).toBe(INK.textDim);
    const ratio = contrastRatio(SEGMENT_UNLIT_INK, BADGE_PLATE.fill);
    expect(ratio, `an unlit segment is ${ratio.toFixed(2)}:1 on the card`).toBeGreaterThanOrEqual(
      SEGMENT_MIN_RATIO,
    );
    // ...and it is NOT one of the inks this product has already measured as
    // absent on a panel (`ui/ink.test.ts`: INK.locked is 1.97:1 here).
    expect(SEGMENT_UNLIT_INK).not.toBe(INK.locked);
    expect(contrastRatio(INK.locked, BADGE_PLATE.fill)).toBeLessThan(SEGMENT_MIN_RATIO);
  });
});
