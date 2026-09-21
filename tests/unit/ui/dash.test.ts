import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contrastRatio } from "@engine/contrast/index.js";
import { DEFAULT_SETTINGS } from "@engine/types";
import {
  DASH,
  PANEL,
  READOUT_SURFACE,
  blendHex,
  dashLitSurface,
  dashSeam,
  labelInk,
  readoutInk,
} from "@game/ui/panel";
import { DASH_COLORS, DEFAULT_DASH_COLOR, dashHexOf, dashIndexOf } from "@game/ui/dash";
import { INK } from "@game/ui/theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../src");

/**
 * THE DASH COLOUR: THIS SCREEN'S OWN IDENTITY, AND THE PILOT'S (UR-123).
 *
 * ================== THE TWO REPORTS IT ANSWERS ==================
 *   3. Ship Controls has no palette of its own - it adopts Earth's, because
 *      `MenuScene.paletteStop()` returns `"earth"` for every menu.
 *   4. The hull picker's neighbours are all settings; the screen wanted a
 *      control about the ship the pilot is sitting in, and it had to be a
 *      control that is actually READ AND DRAWN rather than another dead one.
 *
 * They are answered by one thing: the dash colour is stored on the profile, IS
 * this screen's accent, and lights the console face. So "give the screen an
 * identity" and "give the pilot a control" are the same change, and the
 * identity is the player's rather than a ninth constant somebody picked.
 *
 * ================== THE BAR, AND WHY IT IS A CROSS PRODUCT ==================
 * AC-22.8 is the reason a colour picker on this panel is dangerous: the accent
 * is printed as TEXT behind glass on every row, and it tints the cabin light
 * the labels are read against. So every colour in the set is measured against
 * both, with a negative control, the way `cockpit.test.ts` measures the fixed
 * palette. A colour added without checking turns this red rather than turning a
 * label grey.
 */

describe("UR-123 every dash colour is legible on the panel it dresses", () => {
  it("has more than one colour to measure, or the cross product is theatre", () => {
    expect(DASH_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DASH_COLORS.map((c) => c.hex)).size).toBe(DASH_COLORS.length);
    expect(new Set(DASH_COLORS.map((c) => c.id)).size).toBe(DASH_COLORS.length);
  });

  it("every colour clears 4.5:1 printed behind glass, which is every value on the panel", () => {
    for (const c of DASH_COLORS) {
      const ratio = contrastRatio(readoutInk(c.hex), READOUT_SURFACE);
      expect(ratio, `${c.id} (${c.hex}) behind glass`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every colour clears 4.5:1 UNDER both label inks on the cabin light it tints", () => {
    // The tinted top-lit band is a new TEXT SURFACE this feature creates, and
    // it is the one that actually moves: `INK.textDim` reads 6.09:1 on the
    // untinted band, and every dash colour is lighter than the band, so mixing
    // one in raises the surface toward the ink.
    for (const c of DASH_COLORS) {
      const lit = dashLitSurface(c.hex);
      for (const focused of [true, false]) {
        const ratio = contrastRatio(labelInk(focused), lit);
        expect(
          ratio,
          `${c.id}: ${labelInk(focused)} on ${lit} (focused=${focused})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the blend is at the measured edge MINUS a step, not on it", () => {
    // Rule 8: the bar does not move to make a number pass, so the headroom is
    // stated. Swept over the six colours against `INK.textDim`, the worst cell
    // reads 4.727 at mix 0.10, 4.592 at 0.11 and 4.468 at 0.12. 0.11 is the
    // last passing value; 0.10 ships, one step below the cliff.
    expect(DASH.litMix).toBe(0.1);
    const worstShipped = Math.min(
      ...DASH_COLORS.map((c) => contrastRatio(INK.textDim, dashLitSurface(c.hex))),
    );
    expect(worstShipped).toBeGreaterThan(4.5);
    // NEGATIVE CONTROL: push the blend two steps and the set fails, so "all
    // green" cannot mean "nothing was measured".
    const worstAtTwelve = Math.min(
      ...DASH_COLORS.map((c) =>
        contrastRatio(INK.textDim, blendHex(PANEL.faceLit, c.hex, 0.12)),
      ),
    );
    expect(
      worstAtTwelve,
      "the contrast bar can no longer be broken by tinting harder - is it still being measured?",
    ).toBeLessThan(4.5);
  });

  it("the tint lands on the LIGHT, never on the metal the modules are drawn from", () => {
    // `PANEL.face`, `faceShade`, `bay` and `glass` are what a label and a value
    // are actually printed on, and none of them may move: they are measured
    // against the fixed inks by `cockpit.test.ts`, which knows nothing about a
    // dash colour. Only the cabin light and its seam carry it.
    for (const c of DASH_COLORS) {
      expect(dashLitSurface(c.hex)).not.toBe(PANEL.face);
      expect(dashLitSurface(c.hex)).not.toBe(PANEL.bay);
      expect(dashSeam(c.hex)).not.toBe(PANEL.faceShade);
    }
    // And the untinted answers are byte-identical to what shipped before, so
    // the Briefing and Pre-flight strips - which pass no dash colour - are
    // unchanged.
    expect(blendHex(PANEL.faceLit, "#FFFFFF", 0)).toBe(PANEL.faceLit.toUpperCase());
  });
});

describe("UR-123 the colour is the PLAYER'S, and it survives a round trip", () => {
  it("the engine's default and the catalogue's default are the same string", () => {
    // The engine may not import the game layer, so `DEFAULT_SETTINGS.dashColor`
    // is typed out separately from `DEFAULT_DASH_COLOR`. This is what holds
    // them together instead of both being typed correctly.
    expect(DEFAULT_SETTINGS.dashColor).toBe(DEFAULT_DASH_COLOR);
    expect(DASH_COLORS.some((c) => c.id === DEFAULT_DASH_COLOR)).toBe(true);
  });

  it("the default is the colour this screen ALREADY wore, so no save changes on sight", () => {
    // Amber is `INK.accent` to the byte, which is what `paletteStop()` = earth
    // resolved to. A pilot who never touches the new row sees the screen they
    // had.
    expect(dashHexOf(DEFAULT_DASH_COLOR)).toBe(INK.accent);
  });

  it("an unknown id lights the dashboard rather than handing undefined to the pen", () => {
    // A save from a future palette, or one `decodeProfile` bounded down to
    // something this build does not ship. Same rule as `hulls.equippedIndex`.
    expect(dashHexOf("ultraviolet")).toBe(dashHexOf(DEFAULT_DASH_COLOR));
    expect(dashHexOf("")).toBe(dashHexOf(DEFAULT_DASH_COLOR));
    expect(dashIndexOf("ultraviolet")).toBe(0);
    for (const [i, c] of DASH_COLORS.entries()) expect(dashIndexOf(c.id)).toBe(i);
  });

  it("a brand-new field is read out of an OLD save silently, with no migration", () => {
    // A save written before this build has no `dashColor` key. It must decode
    // to the default WITHOUT logging a repair - `app.noticeTextFor` turns a
    // repair into a line of text on the first screen a child sees (AC-18.4),
    // and a build learning a new setting is not damage to their save.
    const src = readFileSync(path.join(SRC, "engine/persistence/schema.ts"), "utf8");
    expect(src).toContain("addedString");
    expect(
      src,
      "dashColor must decode through addedString, or every old save reports a repair",
    ).toMatch(/dashColor: addedString\(/);
  });
});

describe("UR-123 the colour is actually READ AND DRAWN, which is the whole bar", () => {
  const scene = readFileSync(path.join(SRC, "game/scenes/SettingsScene.ts"), "utf8");

  it("it is this screen's accent, so every instrument on the panel wears it", () => {
    // `accentOverride` feeds `MenuScene.uiStyle.accent`, which every control
    // constructor takes: the knob's lit detent arc, the switch's lamp, the
    // selector's chevrons and position lamps, and every value behind glass.
    expect(scene).toMatch(/accentOverride\(\): string \{\s*\n\s*return dashHexOf\(/);
  });

  it("it lights the console face, which is the DASHBOARD the name refers to", () => {
    expect(scene).toMatch(/drawConsoleFace\(/);
    expect(
      scene,
      "the console face is drawn without the dash colour - the dashboard is not lit by it",
    ).toMatch(/this\.uiStyle\.accent,\s*\n\s*\);/);
  });

  it("it is persisted and redraws the screen, without a page reload (AC-19.1)", () => {
    expect(scene).toMatch(/applyAndRestart\(\{ dashColor: v \}\)/);
  });

  it("MenuScene's default is null, so the other eight screens are untouched", async () => {
    const menu = readFileSync(path.join(SRC, "game/ui/MenuScene.ts"), "utf8");
    expect(menu).toMatch(/accentOverride\(\): string \| null \{\s*\n\s*return null;/);
    // And the override is APPLIED, not merely declared - a hook nothing reads
    // is the exact defect this lane removed two rows for.
    expect(menu).toMatch(/const ownAccent = this\.accentOverride\(\);/);
    expect(menu).toMatch(/accent: ownAccent/);
  });
});
