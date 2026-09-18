import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import {
  GUTTER,
  HEADING_TOP,
  HINT_CONTRACT,
  HINT_TOP,
  backCorner,
  headerText,
} from "@game/ui/grid";
import type { Rect } from "@game/ui/layout";
import { TYPE } from "@game/ui/theme";
import {
  BACK_CHIP,
  BULKHEAD,
  HEADING,
  LINE_PAD,
  LINE_PLATE,
  LINE_SHADOW,
  lineShadowBox,
  MAX_PROMPT_GLYPHS,
  SHELF,
  SUBHEADING,
  backChip,
  leftEdges,
  PROMPT,
  PROMPT_HINT,
  ROW,
  WINDOW,
  contains,
  inset,
  promptPlate,
  windowRect,
  MULLION_CLEARANCE,
  PLANET,
  controlStrip,
  mullionHorizontalAt,
  planetCy,
  planetFill,
  planetLegX,
  planetParkX,
  planetRadius,
  planetRestX,
} from "@game/scenes/support/preflightLayout";
import * as preflightLayout from "@game/scenes/support/preflightLayout";
import {
  SHELF as BRIEFING_SHELF,
  controlStrip as briefingStrip,
} from "@game/scenes/support/briefingLayout";
import {
  CONSOLE_STRIP,
  CONTROL_SURFACE,
  controlSurfaceElementCount,
  controlSurfaceLayout,
} from "@game/ui/controlSurfaceLayout";
import { VIEWPORT_WINDOW } from "@game/ui/viewportWindowLayout";
import {
  PALETTE_STOP_IDS,
  lightness,
  paletteFor,
  skyStops,
} from "@game/render/palette";

/**
 * THE TYPED WORD IS ON THE GLASS, NOT ON THE FRAME.
 *
 * `preflight.png`: the "mars" plate straddled the cockpit window's left edge,
 * so the frame's two strokes ran through the middle of the one thing the child
 * is asked to read. The cause is a one-line mismatch - the prompt was placed at
 * `GAME_WIDTH / 2` and the window is a 900 px aperture at x=900 - and it is
 * aspect-dependent: at a wider world the screen's centre drifts far enough
 * right that the plate lands on the glass by accident, so a capture at the
 * wrong aspect shows nothing wrong.
 *
 * Watch it fail: set `PROMPT.x` to `GAME_WIDTH / 2` in
 * `src/game/scenes/support/preflightLayout.ts`.
 *
 *   npx vitest run tests/unit/scenes/preflightLayout.test.ts --coverage.enabled=false
 */

const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/game/scenes",
);

/** The word-prompt arithmetic `promptPlate` restates, read back from source. */
const TYPED_WORD_SRC = readFileSync(resolve(SRC, "lib/typedWord.ts"), "utf8");

/** Air between the plate and the frame: enough that the corner radius is clear. */
const GLASS_MARGIN = 24;

describe("the pre-flight word plate is inside the cockpit window", () => {
  it("contains the longest word the ritual can show", () => {
    const plate = promptPlate(MAX_PROMPT_GLYPHS);
    expect(
      contains(inset(windowRect(), GLASS_MARGIN), plate),
      `plate x ${Math.round(plate.x)}..${Math.round(plate.x + plate.w)}, ` +
        `y ${Math.round(plate.y)}..${Math.round(plate.y + plate.h)} ` +
        `vs window x ${WINDOW.x}..${WINDOW.x + WINDOW.w}, y ${WINDOW.y}..${WINDOW.y + WINDOW.h}`,
    ).toBe(true);
  });

  it("contains every plate size from one glyph up", () => {
    for (let n = 1; n <= MAX_PROMPT_GLYPHS; n += 1) {
      expect(contains(inset(windowRect(), GLASS_MARGIN), promptPlate(n)), `${n} glyphs`).toBe(
        true,
      );
    }
  });

  it("NEGATIVE CONTROL: the shipped screen-centred anchor is red at 16:9", () => {
    // This is exactly what shipped. The world is 1920 wide at the aspect floor,
    // so the plate's centre is 960 and the window starts at 900.
    expect(GAME_WIDTH).toBe(1920);
    const shipped = promptPlate(4, TYPE.display, { x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.62 });
    expect(contains(windowRect(), shipped)).toBe(false);
    // ...and it straddles rather than missing entirely, which is the read the
    // critic gave it: "half outside".
    expect(shipped.x).toBeLessThan(WINDOW.x);
    expect(shipped.x + shipped.w).toBeGreaterThan(WINDOW.x);
  });

  it("keeps the plate off the system rows and the frame's own bands", () => {
    const plate = promptPlate(MAX_PROMPT_GLYPHS);
    const rowsBottom = ROW.y + 3 * ROW.h + 2 * ROW.gap;
    expect(plate.x).toBeGreaterThan(ROW.x + ROW.w);
    expect(rowsBottom).toBeLessThan(GAME_HEIGHT);
  });

  it("puts the instruction under the glass, inside the frame", () => {
    expect(PROMPT_HINT.y).toBeGreaterThan(WINDOW.y + WINDOW.h);
    expect(PROMPT_HINT.y).toBeLessThan(GAME_HEIGHT - 40);
    expect(PROMPT_HINT.x).toBe(PROMPT.x);
  });
});

describe("promptPlate describes the plate that is actually drawn", () => {
  it("uses typedWord's own padding arithmetic", () => {
    // A restatement is only evidence while it matches. These four lines are the
    // ones `promptPlate` mirrors; if `typedWord.ts` changes any of them this
    // goes red instead of the containment check quietly measuring the wrong box.
    expect(TYPED_WORD_SRC).toContain("const gap = Math.round(size * 0.1);");
    expect(TYPED_WORD_SRC).toContain("const padX = Math.round(size * 0.55);");
    expect(TYPED_WORD_SRC).toContain("const padY = Math.round(size * 0.3);");
    expect(TYPED_WORD_SRC).toContain("const plateH = size * 1.36 + padY;");
  });

  it("is generous about glyph width rather than optimistic", () => {
    // The plate is measured from real glyph advances at draw time; this model
    // has to be an UPPER bound on them or the containment check is worthless.
    // "mars" at 72 px draws a 264 px plate; the model must predict more.
    expect(promptPlate(4).w).toBeGreaterThan(264);
  });
});

describe("UR-39: the screen has a header, one column and a way out", () => {
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("puts its title on the product's header lines", () => {
    // The defect: NOTHING above y=320. The only story screen with no header.
    expect(HEADING.y).toBeLessThan(320);
    expect(HEADING).toEqual(headerText(0, undefined, 14));
    expect(SUBHEADING.y).toBeGreaterThan(HEADING.y);
    expect(HEADING.x).toBe(SUBHEADING.x);
  });

  it("has ONE left edge for its plates", () => {
    // It had four in one frame - 96, 224, 356, 388. A plate's own padding is
    // not a column edge, so the claim is about plates: they all start on the
    // gutter, and text is inset from the plate it sits on.
    expect([...new Set(leftEdges())]).toEqual([GUTTER]);
    expect(LINE_PAD.x).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: the shipped edges were four different numbers", () => {
    const shipped = [96, 224, 356, 388];
    expect(new Set(shipped).size).toBe(4);
    // ...and the dialogue plate, the one that moved, was none of the others.
    expect(shipped).toContain(356);
    expect(LINE_PLATE.x).not.toBe(356);
  });

  it("no longer owns a hint position at all", () => {
    // ================== WHAT THIS USED TO ASSERT ==================
    // `HINT.x === GUTTER` and `HINT.y === HINT_TOP`, against a constant this
    // module exported and `PreflightScene` handed to `lib/kit.label`. Both
    // numbers were right and the screen still did not match its siblings,
    // because `label` draws no plate: the menus' line, the map's and this one
    // were three different treatments of one line.
    //
    // ================== WHAT REPLACES IT ==================
    // `ui/hintLine.drawHint` owns the position AND the style and takes no
    // coordinates, so this module has nothing to export and the scene has
    // nothing to pass. Watched failing with `HINT` put back:
    //   `expected { x: 96, y: 1004 } to be undefined`.
    const mod = preflightLayout as unknown as Record<string, unknown>;
    expect(mod["HINT"]).toBeUndefined();
    // The line the hint is on is still the floor this screen's plates respect,
    // and it is read from the grid rather than from a local copy.
    expect(HINT_CONTRACT.x).toBe(GUTTER);
    expect(HINT_CONTRACT.top).toBe(HINT_TOP);
    // It floated at the window's centre, which is where the word is.
    expect(HINT_CONTRACT.x).not.toBe(PROMPT.x);
  });

  it("gives the screen a way out that does not sit on anything", () => {
    // IN THE PRODUCT'S BACK CORNER (C19), not in a corner this screen worked
    // out for itself. The pixels are unchanged - `ARTBOARD_RIGHT` is 1824 and
    // `WINDOW.x + WINDOW.w` is 1824, which is why this screen was the one the
    // owner measured as correct - but the Briefing now reads the same function,
    // which is what stops the two drifting apart again.
    const chip = backChip();
    expect(chip).toEqual(backCorner(BACK_CHIP.w, BACK_CHIP.h));
    expect(chip.y).toBe(HEADING_TOP);
    expect(chip.x + chip.w).toBe(WINDOW.x + WINDOW.w);
    // Clear of the header block on the left, and of the glass below it.
    expect(chip.x).toBeGreaterThan(HEADING.x + 400);
    expect(chip.y + chip.h).toBeLessThan(WINDOW.y);
  });

  it("keeps Shadow INSIDE the plate he is speaking from", () => {
    // The defect this caught: moving the plate to the gutter without moving
    // Shadow printed the line through his face. Containment, not non-overlap -
    // he is meant to be in the card, the way the warp break's coach is.
    const box = lineShadowBox();
    const plate = { x: LINE_PLATE.x, y: LINE_PLATE.y, w: LINE_PLATE.w, h: LINE_PLATE.h };
    expect(box.x).toBeGreaterThanOrEqual(plate.x);
    expect(box.y).toBeGreaterThanOrEqual(plate.y);
    expect(box.y + box.h).toBeLessThanOrEqual(plate.y + plate.h);
    // ...and the text starts past him, so nothing is printed over the figure.
    expect(LINE_PLATE.x + LINE_PAD.x).toBeGreaterThan(box.x + box.w);
  });

  it("NEGATIVE CONTROL: where Shadow stood before is outside the plate", () => {
    const wasThere = lineShadowBox({ x: 200, y: 850, scale: 0.86 });
    expect(wasThere.y + wasThere.h).toBeGreaterThan(LINE_PLATE.y + LINE_PLATE.h);
  });

  it("keeps the shelf, the dialogue, the rack and the rows off each other", () => {
    const rows = { x: ROW.x, y: ROW.y, w: ROW.w, h: 3 * ROW.h + 2 * ROW.gap };
    const rack = { x: BULKHEAD.x, y: BULKHEAD.y, w: BULKHEAD.w, h: BULKHEAD.h };
    const line = { x: LINE_PLATE.x, y: LINE_PLATE.y, w: LINE_PLATE.w, h: LINE_PLATE.h };
    expect(overlaps(rows, line), "the system rows run into Shadow's line").toBe(false);
    // THE ONE THE CAPTURE CAUGHT AND THE TEST DID NOT ASK: the rack the rows
    // are mounted on is bigger than the rows, and a symmetric padding ran it
    // straight through the dialogue plate below.
    expect(overlaps(rack, line), "the rack runs through Shadow's line").toBe(false);
    // ...and it really does contain the rows, or it is not a rack.
    expect(rack.y).toBeLessThan(rows.y);
    expect(rack.y + rack.h).toBeGreaterThanOrEqual(rows.y + rows.h);
    expect(overlaps(line, { x: SHELF.x, y: SHELF.y, w: SHELF.w, h: SHELF.h })).toBe(false);
    expect(line.y + line.h).toBeLessThan(HINT_CONTRACT.top);
    expect(SHELF.y + SHELF.h).toBeLessThan(1080);
  });
});

/**
 * UR-77: THE PRE-FLIGHT AND THE BRIEFING ARE ONE COCKPIT SEEN TWICE.
 *
 * Three of the four things reported against this screen share one root cause -
 * the two screens drew the same furniture twice, differently - and each of them
 * had a green guard sitting beside it the whole time. So these assertions are
 * about SHARING, not about resemblance: the same function, the same constants,
 * the same arithmetic, checked against the Briefing's own module and against
 * `render/parallax.ts`'s own source rather than against a copy of its numbers.
 *
 *   npx vitest run tests/unit/scenes/preflightLayout.test.ts --coverage.enabled=false
 */
describe("UR-77.2: the strip under the glass is the Briefing's, not a second one", () => {
  it("is the same box the Briefing's is, under each screen's own glass", () => {
    // WATCHED FAILING: put `h: 76` back on this screen's SHELF and the shared
    // height check reports "expected 76 to be 124".
    expect(SHELF.h).toBe(CONSOLE_STRIP.h);
    expect(SHELF.h).toBe(BRIEFING_SHELF.h);
    expect(SHELF.lamps).toBe(BRIEFING_SHELF.lamps);
    // What shipped: 76 px of plate with nine dots on it.
    expect(SHELF.h).toBeGreaterThan(76);
    expect(SHELF.lamps).not.toBe(9);
  });

  it("stops hanging past the glass on both sides", () => {
    // The shipped strip was `WINDOW.x - 30, WINDOW.w + 60` - 30 px of bar
    // sticking out beyond the window on each side, which is the one rectangle
    // on this screen that genuinely started left of everything else.
    expect(SHELF.x).toBe(WINDOW.x);
    expect(SHELF.w).toBe(WINDOW.w);
    expect(controlStrip()).toEqual({ x: SHELF.x, y: SHELF.y, w: SHELF.w, h: SHELF.h });
  });

  it("has the vents, the screws and the bezel - the thing that was missing", () => {
    // `drawControlSurface` had exactly ONE caller in the product and it was the
    // Briefing, so this screen had no vents at all. The claim is about the
    // GEOMETRY the shared surface lays out in this screen's own box.
    const parts = controlSurfaceLayout(controlStrip(), SHELF.lamps);
    expect(parts.vents.length).toBe(CONTROL_SURFACE.ventCount * 2);
    expect(parts.rivets.length).toBe(4);
    expect(parts.lamps.length).toBe(SHELF.lamps);
    expect(controlSurfaceElementCount(parts)).toBe(26);
    // ...the same count the Briefing's strip has, because it is the same strip.
    expect(controlSurfaceElementCount(parts)).toBe(
      controlSurfaceElementCount(controlSurfaceLayout(briefingStrip(), BRIEFING_SHELF.lamps)),
    );
  });

  it("still leaves the dialogue plate and the hint alone at 124 px", () => {
    // The strip gained 48 px. It is 48 px of hull nobody was using, but that is
    // a claim about this screen's foot and not a general truth.
    expect(SHELF.y + SHELF.h).toBeLessThan(HINT_CONTRACT.top);
    expect(SHELF.x).toBeGreaterThan(LINE_PLATE.x + LINE_PLATE.w);
  });
});

describe("UR-77.1: the crosshatch, and where it is allowed to differ", () => {
  it("keeps the horizontal strut off the typed word", () => {
    // The ONLY thing about this window that is genuinely per-screen. The
    // Briefing's 0.7 puts the strut at y 590 and the widest prompt plate's top
    // edge is at 580, so the strut would run along the top of the one thing
    // the child is asked to read.
    //
    // WATCHED FAILING: return `VIEWPORT_WINDOW.horizontalAt` unconditionally
    // from `mullionHorizontalAt` - "the strut runs through the typed word:
    // expected 602 to be less than or equal to 556.04".
    const at = mullionHorizontalAt();
    const strutBottom = WINDOW.y + WINDOW.h * at + VIEWPORT_WINDOW.mullionH;
    const plateTop = promptPlate(MAX_PROMPT_GLYPHS).y;
    expect(
      strutBottom,
      "the strut runs through the typed word",
    ).toBeLessThanOrEqual(plateTop - MULLION_CLEARANCE);
    // ...and it is a real strut on real glass, not one pushed off the top.
    expect(at).toBeGreaterThan(0.4);
    expect(at).toBeLessThanOrEqual(VIEWPORT_WINDOW.horizontalAt);
  });

  it("NEGATIVE CONTROL: the Briefing's own fraction lands on the plate", () => {
    const shipped = WINDOW.y + WINDOW.h * VIEWPORT_WINDOW.horizontalAt;
    const plate = promptPlate(MAX_PROMPT_GLYPHS);
    expect(shipped).toBeGreaterThan(plate.y);
    expect(shipped).toBeLessThan(plate.y + plate.h);
  });
});

/**
 * UR-77.3: THE PLANET WAS A THUMBPRINT.
 *
 * A blind critic called it a desaturated grey-brown disc and a thumbprint, and
 * said it was most of what made the window unreadable. The answer taken at the
 * time changed the TERMINATOR'S HUE and it did not work, because the hue was
 * never the problem: four stacked translucent circles average to mud whatever
 * colour each one is.
 *
 * The Briefing has no hand-drawn planet at all - it passes `celestial` to the
 * parallax and gets ONE FLAT DISC, hazed into the sky and separated from it by
 * value. This screen has to keep its own because the disc SWINGS IN over the
 * ritual and the parallax owns its layer's position, so what it shares is the
 * arithmetic. These assertions read the shared arithmetic back out of
 * `render/parallax.ts` rather than trusting a copy of it.
 */
describe("UR-77.3: the planet is the shared celestial body, not a second one", () => {
  const PARALLAX = readFileSync(resolve(SRC, "../render/parallax.ts"), "utf8");

  it("uses `celestialBody`'s own size rule, read back from its source", () => {
    // A restatement is only evidence while it matches.
    expect(PARALLAX).toContain("const r = Math.min(w, h) * 0.12;");
    expect(planetRadius(1920, 1080)).toBeCloseTo(Math.min(1920, 1080) * 0.12, 6);
    // What shipped: r = 300, more than twice the shared body at the same world.
    expect(planetRadius(1920, 1080)).toBeLessThan(300 / 2);
  });

  it("uses its haze and its L* separation, read back from its source", () => {
    expect(PARALLAX).toContain(
      "const hazed = atmospheric(pal.colors[2] ?? pal.accent, sky, 0.84);",
    );
    expect(PARALLAX).toContain(
      "const body = withLightness(hazed, target > 50 ? Math.max(4, target - 14) : Math.min(96, target + 14));",
    );
    expect(PLANET.haze).toBe(0.84);
    expect(PLANET.separationL).toBe(14);
  });

  it("separates from whatever sky it is put against, at every stop", () => {
    // The defect the shared body already fixed once: a critic measured it at
    // L* 77.7 against a local sky of L* 77.8 - a ratio of 1.00:1, pure hue,
    // invisible on a tablet at half brightness and invisible to a colour-blind
    // child always. Both ends of each stop's sky gradient are probed, because
    // the disc crosses the glass rather than sitting at one height.
    for (const stopId of PALETTE_STOP_IDS) {
      const pal = paletteFor(stopId);
      for (const sky of skyStops(pal)) {
        const gap = Math.abs(lightness(planetFill(pal, sky)) - lightness(sky));
        expect(gap, `${stopId} against ${sky}`).toBeGreaterThan(11);
      }
    }
  });

  it("is ONE flat disc in the scene - no glow, no highlight, no terminator", () => {
    // The source is the evidence here, because "how many circles" is not a
    // property of a layout module. Four `fillCircle` calls on one Graphics is
    // what a thumbprint is made of.
    //
    // WATCHED FAILING: paste the shipped glow back -
    //   disc.fillStyle(hexToNum(accent), 0.1); disc.fillCircle(0, 0, r * 1.4);
    // - and this reports "the planet is drawn from 2 circles: expected 2 to be 1".
    const scene = readFileSync(resolve(SRC, "PreflightScene.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const circles = scene.match(/disc\.fillCircle\(/g) ?? [];
    expect(circles.length, `the planet is drawn from ${circles.length} circles`).toBe(1);
    // The four that shipped, by their own arithmetic.
    expect(scene).not.toContain("r * 1.4");
    expect(scene).not.toContain("-r * 0.26");
    expect(scene).not.toContain("r * 0.22");
  });

  it("swings in from off the glass and comes to rest on it", () => {
    const r = planetRadius(1920, 1080);
    expect(planetParkX(r), "parked on the glass").toBeGreaterThan(WINDOW.x + WINDOW.w);
    // Three ritual steps, three legs, ending at rest.
    expect(planetLegX(0)).toBe(planetRestX());
    expect(planetLegX(2)).toBeLessThan(planetLegX(1));
    expect(planetLegX(1)).toBeLessThan(planetLegX(0));
    // WHOLLY ON THE GLASS AT EVERY LEG, which is new: the leg length was sized
    // against a 300 px disc that could not fall off the left edge, and at the
    // shared body's 130 px the first leg put a third of the planet outside the
    // window. WATCHED FAILING: put `legShare` back to 0.28 - "leg 2 hangs off
    // the glass: expected 955.44 to be greater than or equal to 1029.6".
    for (let leg = 0; leg < 3; leg += 1) {
      expect(planetLegX(leg), `leg ${leg} hangs off the glass`).toBeGreaterThanOrEqual(
        WINDOW.x + r,
      );
      expect(planetLegX(leg) + r).toBeLessThanOrEqual(WINDOW.x + WINDOW.w);
    }
    expect(planetRestX() + r).toBeLessThan(WINDOW.x + WINDOW.w);
    expect(planetCy()).toBeGreaterThan(WINDOW.y);
    expect(planetCy()).toBeLessThan(WINDOW.y + WINDOW.h);
  });
});
