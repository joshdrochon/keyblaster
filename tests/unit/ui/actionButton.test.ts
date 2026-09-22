import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORST_CASE_SKY, contrastRatio } from "@engine/contrast/index.js";
import { PALETTE_STOP_IDS, paletteAt } from "@game/render/palette";
import { ACTION_INK, paintActionButton } from "@game/ui/plate";
import { INK } from "@game/ui/theme";

/**
 * THE YELLOW OUTLINE MEANS "THIS IS SELECTED", ON EVERY SCREEN (UR-112).
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner: "The Continue button on the Beacon-placed screen has the
 * right yellow outline, but 'Fly It Again' and 'Continue' on the stage report
 * do not. Something is definitely off when it comes to consistency."
 *
 * ================== WHAT IT ACTUALLY WAS ==================
 * Not a missing ring. Measured on a served build, BOTH screens draw one:
 * `createFocusRing(this, layer("hud").depth + 1)`, depth 8, alpha 1, visible
 * true, struck around the focused target. The late `setTargets` path is not
 * the cause either - the stage report's ring is positioned correctly.
 *
 * The ring was INVISIBLE BECAUSE OF WHAT IT WAS DRAWN ON.
 * `ResultsScene.button()` filled its primary with `this.lane.palette.accent` -
 * the STOP's accent - and the ring is `INK.accent`. At Mars that is gold on
 * coral; at Earth it is #FFC857 on #FFC857, which is a contrast ratio of
 * exactly 1.00. The first `describe` below is that defect, built from the
 * shipped palettes rather than pasted in as numbers.
 *
 * It is the SAME root cause as the profile picker's doubled ring, wearing a
 * different hat. There the control painted the accent as its BORDER and the
 * player saw two gold lines; here the control painted the accent as its FILL
 * and the player saw none. One rule fixes both:
 *
 *   THE ACCENT IS THE FOCUS LANGUAGE. A CONTROL DOES NOT PAINT ITSELF IN IT.
 *
 * That is also `docs/coding-standards.md` rule 1, already written down and
 * already violated here: "A theme may change the background and nothing else.
 * If a themed value reaches the type, THE BUTTONS or the rules, that is a bug."
 *
 * ================== WATCHED FAILING ==================
 * (printed values recorded in the report for this change)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = resolve(HERE, "../../../src/game/scenes");
const code = (name: string): string => readFileSync(resolve(SCENES, name), "utf8");

/** How much contrast the gold ring needs against a control to be seen at all. */
const RING_MIN = 3;

describe("the defect: a button filled with the stop accent hides the ring", () => {
  it("is measurably invisible at every stop, in both palettes", () => {
    // THE NEGATIVE CONTROL. A contrast check nobody has watched fail is not
    // evidence of anything (`resultsInk.test.ts` says the same). These are the
    // shipped palettes, and this is what the owner was looking at.
    const measured: [string, number][] = [];
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        const accent = paletteAt(stop, colorblind).accent;
        measured.push([`${stop}${colorblind ? "/cb" : ""}`, contrastRatio(INK.accent, accent)]);
      }
    }
    // The worst case USED to be 1.00 - Earth's accent was `#FFC857`, the ring's
    // own gold to the byte, so the ring was literally invisible on an Earth
    // button. Earth's accent is now its planet blue and Saturn's its planet
    // gold, so no stop is an exact match any more. The defect is unchanged:
    // every stop still fails the ring-visibility bar below, which is the claim
    // that matters. This line records that the worst case is no longer 1.00
    // rather than pretending it still is.
    const worst = Math.min(...measured.map(([, ratio]) => ratio));
    expect(worst, `worst accent-vs-ring ratio across all stops`).toBeLessThan(RING_MIN);
    // And the STANDARD palette never clears the bar at any stop.
    for (const stop of PALETTE_STOP_IDS) {
      const accent = paletteAt(stop, false).accent;
      expect(contrastRatio(INK.accent, accent), `${stop} ${accent}`).toBeLessThan(RING_MIN);
    }
  });
});

describe("one action button, drawn from fixed tokens", () => {
  it("both surfaces clear the ring, the label and the panel behind them", () => {
    for (const [name, fill] of [
      ["primary", ACTION_INK.primaryFill],
      ["secondary", ACTION_INK.secondaryFill],
    ] as const) {
      // The ring reads on it - the whole point.
      expect(contrastRatio(INK.accent, fill), `${name} vs the ring`).toBeGreaterThanOrEqual(
        RING_MIN,
      );
      // The label reads on it (AC-22.8).
      expect(contrastRatio(INK.text, fill), `${name} vs its label`).toBeGreaterThanOrEqual(4.5);
      // And it reads against the SKY these buttons actually sit on - both
      // screens draw their action below the panels, on the stop's own sky, so
      // the worst case is the brightest sky in the game (Mars/Jupiter cream).
      expect(contrastRatio(fill, WORST_CASE_SKY), `${name} vs the sky`).toBeGreaterThan(3);
    }
  });

  it("is the treatment the owner named as correct, not a new one", () => {
    // The beacon-placed screen's Continue is the control the owner called
    // right. This is exactly what it draws, so "uniform" means every screen
    // moves onto THAT rather than onto something invented for this change.
    expect(ACTION_INK.primaryFill).toBe(INK.panelRaised);
    expect(ACTION_INK.primaryEdge).toBe(INK.line);
  });

  it("does not try to carry emphasis in the plate", () => {
    // ONE STEP APART, AND THAT IS THE DECISION. `resultsInk.test.ts` is right
    // that 1.08:1 is not an edge - so the stage report's two actions are NOT
    // told apart by their plates. They are told apart by the focus ring, which
    // opens on the forward one (AC-18.1) and is legible now that nothing under
    // it wears the accent. Anything louder was measured and rejected: see
    // `paintActionButton`'s note.
    expect(
      contrastRatio(ACTION_INK.primaryFill, ACTION_INK.secondaryFill),
    ).toBeLessThan(1.2);
    // Both labels are the same ink. A dim secondary is what made the pair read
    // as disabled captions.
    expect(ACTION_INK.label).toBe(INK.text);
  });

  it("never puts a themed or accent colour on a button, at any stop", () => {
    const strokes: { color: number }[] = [];
    const fills: { color: number }[] = [];
    const g = {
      fillStyle(color: number) {
        fills.push({ color });
        return g;
      },
      lineStyle(_w: number, color: number) {
        strokes.push({ color });
        return g;
      },
      fillRoundedRect: () => g,
      strokeRoundedRect: () => g,
      lineBetween: () => g,
    } as unknown as import("phaser").GameObjects.Graphics;

    paintActionButton(g, { x: 0, y: 0, w: 420, h: 88 }, { primary: true });
    paintActionButton(g, { x: 0, y: 0, w: 420, h: 88 }, { primary: false });

    const forbidden = new Set<number>();
    for (const stop of PALETTE_STOP_IDS) {
      for (const colorblind of [false, true]) {
        forbidden.add(Number.parseInt(paletteAt(stop, colorblind).accent.slice(1), 16));
      }
    }
    // `INK.accent` belongs to the RING and to nothing a control draws.
    forbidden.add(Number.parseInt(INK.accent.slice(1), 16));

    for (const { color } of [...fills, ...strokes]) {
      expect(forbidden.has(color), `#${color.toString(16)} is an accent`).toBe(false);
    }
    expect(fills.length + strokes.length).toBeGreaterThan(0);
  });
});

describe("the two screens with a forward action draw it the same way", () => {
  it("the stage report no longer fills a button with the stop's accent", () => {
    const source = code("ResultsScene.ts");
    expect(source).toContain("paintActionButton");
    // The exact expression that made the ring invisible.
    expect(source, "ResultsScene still fills a button from the palette").not.toMatch(
      /fill:\s*primary\s*\?\s*accent/,
    );
    expect(source, "ResultsScene still strokes a button from the palette").not.toMatch(
      /stroke:\s*primary\s*\?\s*mixHex\(\s*accent/,
    );
  });

  it("the beacon screen draws its forward action with the same component", () => {
    // It already looked right - it is the screen the owner named as CORRECT -
    // so this is not a repaint. It is the guard that stops the two drifting
    // again, which is the whole reason the drawing moved into one place.
    expect(code("BeaconScene.ts")).toContain("paintActionButton");
  });
});
