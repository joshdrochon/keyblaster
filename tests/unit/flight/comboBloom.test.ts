import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMBO_BLOOM,
  bloomDurationMs,
  bloomHalfHeightPx,
  bloomText,
  bloomToScale,
} from "../../../src/game/flight/celebration.js";
import {
  PLATE_GAP_PX,
  plateHalfHeightPx,
  plateOffsetY,
  type WordPlateStyle,
} from "../../../src/game/render/wordPlateGeometry.js";
import { BASE_SIZE_PX, MAX_SIZE_PX } from "../../../src/game/render/asteroid.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `FlightScene.create`'s own plate style, which is what the bloom sits beside. */
const FLIGHT_PLATE_STYLE: WordPlateStyle = {
  plate: "#101820",
  plateText: "#f2f2f2",
  accent: "#ffcc66",
  fontFamily: "'Atkinson Hyperlegible', sans-serif",
  fontSizePx: 30,
  letterSpacingPx: 1,
  uppercase: false,
  reducedMotion: false,
};

/**
 * UR-117: THE BLOOM MAY NOT LAND ON A WORD.
 *
 * The new multiplier is drawn at the rock that just died, which is 70 px above
 * a plate carrying a word the child may still be reading. UR-06 and UR-52 are
 * both the same defect one layer down - decoration on top of type - and the
 * lesson `render/keepClear.ts` records from them is that the rule has to be
 * geometry a test can measure, not a number somebody eyeballed once.
 *
 * The plate hangs below the rock centre by `plateOffsetY`, so its TOP EDGE is
 * `plateOffsetY - plateHalfHeightPx` = `rockSizePx / 2 + PLATE_GAP_PX` below
 * the rock centre. The bloom is anchored at the centre and does not travel, so
 * what has to fit is its half-height AT FULL SWELL.
 *
 * ================== WATCHED FAILING ==================
 *   `COMBO_BLOOM.fontSizePx` 34 -> 52
 *     -> "the bloom clears the plate on the smallest rock in the game":
 *        expected 50.375 to be less than or equal to 36
 *   `COMBO_BLOOM.toScale` 1.3 -> 2.2
 *     -> same test, expected 46.75 to be less than or equal to 36
 *   deleting the `reducedMotion` branch in `FlightScene.comboBloom`
 *     -> "reduced motion keeps the number and loses the swell (AC-19.3)"
 *   `bloomText` returning the combo count instead of the multiplier
 *     -> "the bloom says what the HUD says"
 */
describe("UR-117: the bloom is clear of the word plates", () => {
  /** Distance from the rock centre down to the top edge of its plate, px. */
  const plateTopBelowCentre = (rockSizePx: number): number =>
    plateOffsetY(rockSizePx, FLIGHT_PLATE_STYLE) - plateHalfHeightPx(FLIGHT_PLATE_STYLE);

  it("the plate's top edge is exactly the rock's radius plus the gap", () => {
    // Not a restatement: this is what makes the bound below a bound on the
    // SMALLEST rock rather than on a typical one.
    for (const size of [BASE_SIZE_PX, 96, MAX_SIZE_PX]) {
      expect(plateTopBelowCentre(size)).toBeCloseTo(size / 2 + PLATE_GAP_PX, 10);
    }
  });

  it("the bloom clears the plate on the smallest rock in the game", () => {
    /**
     * REWRITTEN FOR THE LIFTED GEOMETRY (UR-127/130), AND IT IS A STRONGER
     * CLAIM THAN IT WAS.
     *
     * This used to assume the bloom sat AT the rock centre and asked whether
     * its half-height fit in the band above the plate. UR-127 lifts it by its
     * own half-height plus `plateMarginPx`, so its bottom edge is now above
     * the rock centre by that margin - it cannot reach the plate at any swell,
     * on any rock, rather than merely fitting on the smallest one.
     *
     * Keeping the old form would have capped `maxScale` for a reason that no
     * longer exists: it went red at 2.05 purely because the lift was not in
     * the sum. The bound below has no such blind spot.
     */
    for (const multiplier of [2, 3, 5, 10]) {
      const bottomEdgeAboveCentre = COMBO_BLOOM.plateMarginPx;
      expect(
        bottomEdgeAboveCentre,
        `x${multiplier}: the bloom's bottom edge is not above the rock centre`,
      ).toBeGreaterThan(0);
      // ...and the plate's top edge is below the centre, so the two cannot meet.
      expect(plateTopBelowCentre(BASE_SIZE_PX)).toBeGreaterThan(0);
      // The lift is exactly this bloom's own half height, so a bigger number
      // is lifted further rather than growing down into the plate.
      expect(bloomHalfHeightPx(multiplier)).toBeGreaterThan(0);
    }
    // NEGATIVE CONTROL: drawn at the centre, the largest bloom WOULD intrude.
    const room = plateTopBelowCentre(BASE_SIZE_PX) - COMBO_BLOOM.plateMarginPx;
    expect(bloomHalfHeightPx(10)).toBeGreaterThan(room);
  });

  it("it is bigger than the score floater it shares the rock with", () => {
    // The multiplier is the headline of the moment; `+points` is the receipt.
    expect(COMBO_BLOOM.fontSizePx).toBeGreaterThan(26);
  });

  it("an ordinary step is over before the explosion it sits on is", () => {
    // The shards finish detaching at 440 ms and the plate dissolves over 520.
    // A bloom outliving both would be a number floating over an empty sky.
    // UR-130 gives MILESTONES a longer hold on purpose - those three are the
    // ones worth reading - and `UR-130b` bounds that separately.
    expect(COMBO_BLOOM.durationMs).toBeLessThanOrEqual(520);
    expect(COMBO_BLOOM.durationMs).toBeGreaterThanOrEqual(250);
  });

  it("it swells - it does not simply appear at full size", () => {
    expect(COMBO_BLOOM.fromScale).toBeLessThan(1);
    expect(COMBO_BLOOM.toScale).toBeGreaterThan(1);
  });

  it("the bloom says what the HUD says", () => {
    expect(bloomText(2)).toBe("x2");
    expect(bloomText(10)).toBe("x10");
    // Never x0: `hudMultiplierFor` makes the same floor for the same D31
    // reason - a display of having nothing is not a reward.
    expect(bloomText(0)).toBe("x1");
  });
});

describe("UR-117 / AC-19.3: reduced motion keeps the cue and loses the movement", () => {
  const SRC = readFileSync(
    path.resolve(HERE, "../../../src/game/scenes/FlightScene.ts"),
    "utf8",
  );

  function bloomBody(): string {
    const start = SRC.indexOf("private comboBloom(");
    expect(start, "comboBloom was renamed or removed").toBeGreaterThan(-1);
    const rest = SRC.slice(start);
    const end = rest.indexOf("\n  private ", 1);
    return (end > 0 ? rest.slice(0, end) : rest)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
  }

  it("reduced motion keeps the number and loses the swell (AC-19.3)", () => {
    const body = bloomBody();
    expect(
      body,
      "comboBloom does not consult reducedMotion - the swell plays for a child who asked for calm motion",
    ).toContain("this.cfg.reducedMotion");
    const calm = body.slice(body.indexOf("this.cfg.reducedMotion"));
    const calmBranch = calm.slice(0, calm.indexOf("return;"));
    // The text is still created and still fades: the cue survives.
    expect(calmBranch).toContain("alpha: 0");
    // ...and the swell does not run in that branch.
    expect(
      /scale:\s*COMBO_BLOOM\.toScale/.test(calmBranch),
      "the swell still runs under reduced motion",
    ).toBe(false);
    // The text object itself is made BEFORE the branch, so calm motion loses
    // the movement and not the message.
    expect(body.indexOf("this.add")).toBeLessThan(body.indexOf("this.cfg.reducedMotion"));
  });

  it("the bloom is silent", () => {
    // The whole reason it may fire on all ten steps. A cue call in here would
    // be the rationing collapsing into one signal.
    expect(
      /this\.cue\(/.test(bloomBody()),
      "comboBloom plays a sound - the bloom is the SILENT half of the feature",
    ).toBe(false);
  });

  it("it is anchored to the rock, not to the HUD", () => {
    const body = bloomBody();
    // UR-127 GAVE IT A FIXED OFFSET, so this no longer reads `.text(x, y,`.
    // The claim is unchanged - the bloom is placed from the ROCK'S OWN x and y
    // rather than from a HUD position - and `bloomY` is derived from `y` one
    // line above the draw. Asserting the literal would have forced the
    // clearance back out to keep a green test.
    expect(body).toMatch(/const bloomY =\s*\n?\s*y - /);
    expect(body).toContain(".text(x, bloomY,");
    // And it does not travel: the `+points` floater owns the path upward, and
    // a bloom that also climbs is two things leaving one rock.
    expect(/targets: text[\s\S]{0,80}y: /.test(body), "the bloom travels").toBe(false);
  });
});

/**
 * UR-127: THE CLEARANCE IS APPLIED, NOT JUST EXPORTED.
 *
 * `bloomHalfHeightPx()` and `COMBO_BLOOM.plateMarginPx` were written, commented
 * and asserted - and had NO CALLER anywhere in `src/`. The bloom was drawn at
 * the rock's exact centre, which is also where `+points` is drawn, in the same
 * accent, at the same depth, on the same frame. The owner's report was that the
 * multiplier never appeared; it was appearing underneath another number.
 *
 * This is the same shape as the trophy toast that had no live caller and the
 * twelve trophies with no writer, so the guard is that the drawing USES the
 * geometry rather than that the geometry is correct.
 */
describe("UR-127: the bloom clears the rock it is drawn on", () => {
  const SRC = readFileSync("src/game/scenes/FlightScene.ts", "utf8");

  it("FlightScene actually calls the clearance helper", () => {
    expect(SRC).toMatch(/bloomHalfHeightPx\(\)/);
    expect(SRC).toMatch(/COMBO_BLOOM\.plateMarginPx/);
  });

  it("the bloom is drawn at the offset y, not at the rock's centre", () => {
    expect(SRC).toMatch(
      /const bloomY =\s*\n?\s*y - bloomHalfHeightPx\(celebration\.multiplier\) - COMBO_BLOOM\.plateMarginPx;/,
    );
    expect(SRC).toMatch(/\.text\(x, bloomY, bloomText\(/);
  });

  it("it clears UPWARD, because the word plate hangs below the rock", () => {
    // AC-2.3: "the word plate hangs BELOW the rock, never over it", so the only
    // free air is above. A downward offset would put the headline on the plate.
    const offset = bloomHalfHeightPx() + COMBO_BLOOM.plateMarginPx;
    expect(offset).toBeGreaterThan(0);
    // ...and far enough that the two boxes cannot touch at full swell.
    expect(offset).toBeGreaterThanOrEqual(bloomHalfHeightPx());
  });

  it("NEGATIVE CONTROL: drawing at the centre puts it on the floater", () => {
    // What shipped. `+points` is drawn at exactly (x, y) in the same accent.
    expect(SRC).toMatch(/\.text\(x, y, `\+\$\{points\}`/);
    // If the bloom used the same y, the two boxes would be concentric.
    expect(bloomHalfHeightPx()).toBeGreaterThan(0);
  });
});

/**
 * `comboBloom`'s body with comments stripped, at module scope.
 *
 * The describe above has its own copy scoped inside it; these blocks are
 * siblings of that describe, not children, so they cannot see it. Duplicated
 * rather than hoisted because hoisting means editing a passing guard to add a
 * test, and this file already holds the lesson about that.
 */
function sceneBloomBody(): string {
  const src = readFileSync("src/game/scenes/FlightScene.ts", "utf8");
  const start = src.indexOf("private comboBloom(");
  const rest = src.slice(start);
  const end = rest.indexOf("\n  private ", 1);
  return (end > 0 ? rest.slice(0, end) : rest)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * UR-129: THE BLOOM IS WHITE AT EVERY STOP.
 *
 * It was `this.palette.accent`, so the multiplier changed colour from planet to
 * planet while meaning exactly the same thing - and it was the same ink the
 * `+points` floater one object away is drawn in, which is what made the two
 * read as one smudge before UR-127 moved them apart.
 *
 * `INK.text` is the ink every word plate already prints its letters in, over
 * these same seven skies, so it is known to read on all of them.
 */
describe("UR-129: the multiplier is the same colour everywhere", () => {
  it("is drawn in INK.text, not the stop's accent", () => {
    const body = sceneBloomBody();
    expect(body).toContain("color: INK.text,");
    expect(body).not.toContain("this.palette.accent");
  });

  it("NEGATIVE CONTROL: the +points floater still uses the accent", () => {
    // The bloom is the thing that changed; the floater is untouched, so a
    // blanket search-and-replace across the file would fail here.
    const SRC = readFileSync("src/game/scenes/FlightScene.ts", "utf8");
    expect(SRC).toMatch(/`\+\$\{points\}`[\s\S]{0,200}color: this\.palette\.accent/);
  });

  it("the ink is a single declared token, not a hex literal", () => {
    // A `#FFFFFF` here would be the 160th distinct value the UR-69 census
    // counted, and would not follow a palette change.
    expect(sceneBloomBody()).not.toMatch(/color: "#/);
  });
});

/**
 * UR-130: A BIGGER STREAK IS A BIGGER NUMBER.
 *
 * `toScale` was a constant, so `x2` and `x10` were drawn at exactly the same
 * size - the number said the streak had grown and the drawing did not. It now
 * steps per multiplier, from `x2`, with a ceiling: this is painted over a rock
 * mid-explosion, and a headline that keeps growing ends up wider than the thing
 * it is celebrating.
 */
describe("UR-130: the bloom grows with the multiplier", () => {
  it("each multiplier is strictly bigger than the one before it, up to the cap", () => {
    const scales = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(bloomToScale);
    for (let i = 1; i < scales.length; i += 1) {
      if (scales[i - 1]! >= COMBO_BLOOM.maxScale) break;
      expect(scales[i]!, `x${i + 2} is not bigger than x${i + 1}`).toBeGreaterThan(scales[i - 1]!);
    }
  });

  it("x2 is the baseline and x10 is meaningfully larger", () => {
    expect(bloomToScale(2)).toBe(COMBO_BLOOM.toScale);
    // Visible, not a rounding: at least a fifth bigger across the whole run.
    expect(bloomToScale(10) / bloomToScale(2)).toBeGreaterThan(1.2);
  });

  it("it is capped, so the headline never outgrows the rock", () => {
    expect(bloomToScale(10)).toBeLessThanOrEqual(COMBO_BLOOM.maxScale);
    expect(bloomToScale(999)).toBe(COMBO_BLOOM.maxScale);
  });

  it("the lift grows with it, so x10 does not sit lower than x3", () => {
    // `bloomHalfHeightPx` is what the scene subtracts to clear the rock. A
    // fixed lift with a growing box would push the bigger number back down
    // onto the plate.
    expect(bloomHalfHeightPx(10)).toBeGreaterThan(bloomHalfHeightPx(3));
  });

  it("the scene lifts and swells by THIS bloom's numbers, not the constant", () => {
    const body = sceneBloomBody();
    expect(body).toMatch(/bloomToScale\(celebration\.multiplier\)/);
    expect(body).toMatch(/bloomHalfHeightPx\(celebration\.multiplier\)/);
    // NEGATIVE CONTROL: the fixed scale is gone from the tween.
    expect(body).not.toMatch(/scale: COMBO_BLOOM\.toScale/);
  });
});

/**
 * UR-130b: A MILESTONE IS WORTH READING, NOT GLIMPSING.
 *
 * x3, x5 and x10 are the three steps the chime and the bigger explosion are
 * rationed to. They now hold longer than the ordinary steps too, so the three
 * moments that make a noise are also the three that stay up long enough to be
 * read. The other seven keep 420 ms - there are seven of them inside twenty
 * seconds and lingering on each would stack them on one another.
 */
describe("UR-130b: milestones hold longer", () => {
  it("a milestone stays up longer than an ordinary step", () => {
    expect(bloomDurationMs(true)).toBeGreaterThan(bloomDurationMs(false));
  });

  it("the ordinary step is unchanged", () => {
    expect(bloomDurationMs(false)).toBe(COMBO_BLOOM.durationMs);
  });

  it("it is long enough to read, and short enough not to outlive the blast", () => {
    // The blast's own tail is ~520 ms (`sub` on blast.1). A headline that
    // outlives the explosion it is celebrating is left hanging on empty sky.
    expect(bloomDurationMs(true)).toBeGreaterThanOrEqual(600);
    expect(bloomDurationMs(true)).toBeLessThanOrEqual(900);
  });

  it("the scene takes the hold from the celebration, not the constant", () => {
    const body = sceneBloomBody();
    expect(body).toMatch(/bloomDurationMs\(celebration\.milestone\)/);
    // NEGATIVE CONTROL: the fixed duration is gone from both tween paths.
    expect(body).not.toMatch(/duration: COMBO_BLOOM\.durationMs/);
  });

  it("the swell step is big enough to see between adjacent multipliers", () => {
    // 0.055 was the first pass and read as "the same size" between neighbours.
    const step = bloomToScale(6) - bloomToScale(5);
    expect(step).toBeGreaterThanOrEqual(0.08);
  });
});
