import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHADOW_DRAWN_HEIGHT,
  shadowBox,
  shadowMirrorInset,
  shadowOrigin,
} from "@game/scenes/support/pickerLayout";
import { SHADOW_HEIGHT } from "@game/render/shadow";
import { GAME_WIDTH } from "@game/sceneKeys";
import { BACK_CORNER_BOTTOM, GUTTER } from "@game/ui/grid";

/**
 * SHADOW STANDS IN ONE CORNER ACROSS THE PROFILE FLOW (UR-118).
 *
 * ================== THE DEFECT ==================
 * The owner, walking from the pilot picker into pilot creation: Shadow moves,
 * and changes size. Both were true, and there were THREE sizes across two
 * screens of a single flow:
 *
 *   picker, with pilots   220   derived: footprint right edge on the gutter,
 *   picker, empty         260   footprint bottom on BACK_CORNER_BOTTOM
 *   CREATE                210   the literals (GAME_WIDTH - 230, GAME_HEIGHT - 300)
 *
 * `pickerLayout.shadowOrigin` names this failure in its own note before it
 * happened: `drawShadow` takes the point his BODY is centred on, not the edge
 * of the drawing, so a literal on a grid line puts the DRAWING somewhere else -
 * "which is how the literal `620` came to look centred in the sky". The create
 * screen still carried that literal, so its Shadow was placed by a different
 * model AND at a size neither picker state uses.
 *
 * This asserts the shared derivation is what both screens use, and that the
 * corner it lands in is the product's own bottom-right.
 */

const CREATE_SRC = readFileSync("src/game/scenes/ProfileCreateScene.ts", "utf8");
const PICKER_SRC = readFileSync("src/game/scenes/ProfilePickerScene.ts", "utf8");

describe("the profile flow places Shadow from one model", () => {
  it("the create screen carries no hand-placed coordinates any more", () => {
    // THE DEFECT ITSELF. These two literals are what moved him. Comments are
    // stripped first: the note recording what was removed necessarily quotes
    // them, which is the same trap `focusArrive.test.ts` hit.
    const code = CREATE_SRC.split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(code).not.toContain("GAME_WIDTH - 230");
    expect(code).not.toContain("GAME_HEIGHT - 300");
    expect(code).not.toMatch(/scale:\s*210\s*\/\s*SHADOW_HEIGHT/);
  });

  it("both screens derive the origin from the shared layout", () => {
    for (const [name, src] of [
      ["ProfileCreateScene", CREATE_SRC],
      ["ProfilePickerScene", PICKER_SRC],
    ] as const) {
      expect(src, `${name} places Shadow without shadowOrigin`).toContain("shadowOrigin(");
    }
  });

  it("the create screen uses the picker's LIST size, the state it is handed from", () => {
    // Not `.empty` (260): that state is a screen with nothing else on it. This
    // one has a heading, a field, a gallery and a button, and the player
    // arrives at it from the picker's list.
    expect(CREATE_SRC).toContain("SHADOW_DRAWN_HEIGHT.list / SHADOW_HEIGHT");
  });

  it("the derived footprint really does land in the bottom-right corner", () => {
    // The claim the whole module exists for, measured rather than described.
    const scale = SHADOW_DRAWN_HEIGHT.list / SHADOW_HEIGHT;
    const box = shadowBox(GAME_WIDTH, scale);
    expect(Math.round(box.x + box.w)).toBe(GAME_WIDTH - GUTTER);
    expect(Math.round(box.y + box.h)).toBe(BACK_CORNER_BOTTOM);
  });

  it("the two picker sizes share that corner, so only his height changes", () => {
    const boxes = (["list", "empty"] as const).map((k) =>
      shadowBox(GAME_WIDTH, SHADOW_DRAWN_HEIGHT[k] / SHADOW_HEIGHT),
    );
    const [a, b] = boxes;
    expect(Math.round((a?.x ?? 0) + (a?.w ?? 0))).toBe(Math.round((b?.x ?? 0) + (b?.w ?? 0)));
    expect(Math.round((a?.y ?? 0) + (a?.h ?? 0))).toBe(Math.round((b?.y ?? 0) + (b?.h ?? 0)));
  });

  it("the origin is not the footprint, which is the trap this module exists for", () => {
    // If these were ever equal the derivation would have collapsed back into
    // "place the origin on the grid line", which is the original bug.
    const scale = SHADOW_DRAWN_HEIGHT.list / SHADOW_HEIGHT;
    const at = shadowOrigin(GAME_WIDTH, scale);
    const box = shadowBox(GAME_WIDTH, scale);
    expect(at.x).not.toBe(box.x + box.w);
    expect(at.y).not.toBe(box.y + box.h);
  });
});

describe("the hand-off between the two screens dissolves (UR-118)", () => {
  it("the picker asks for the fade, and asks the destination to fade up", () => {
    expect(PICKER_SRC).toMatch(
      /goTo\(\s*SCENE_KEYS\.profileCreate,\s*\{\s*fadeIn:\s*true\s*\},\s*\{\s*fade:\s*true\s*\}/,
    );
  });

  it("no other menu move fades, because a cut is right for a change of place", () => {
    // A fade says "same place, later". That is true of this one pair and of
    // nothing else in the menus, and 260 ms on every navigation to say
    // something untrue is worse than the cut.
    const faded = [...PICKER_SRC.matchAll(/fade:\s*true/g)];
    expect(faded.length).toBe(1);
  });
});

describe("Shadow is seated off the RUNTIME width (UR-164)", () => {
  const src = readFileSync("src/game/scenes/ResultsScene.ts", "utf8");

  it("does not anchor her to the GAME_WIDTH constant", () => {
    // Scale mode is HEIGHT_CONTROLS_WIDTH: height is pinned at 1080 and width
    // follows the window's aspect. Measured in the served build on a 1728x901
    // window, `game.scale.width` is 2071 - she sat 151 px short of the gutter.
    expect(src).toMatch(/shadowOrigin\(this\.scale\.width, SHADOW_SCALE\)/);
    expect(src).not.toMatch(/shadowOrigin\(GAME_WIDTH/);
  });

  it("gives back the air the mirror leaves on her right", () => {
    // She is drawn `facing: -1`, so her reach right is the LEFT coefficient
    // while `shadowOrigin` insets by the RIGHT one.
    expect(src).toMatch(/shadowMirrorInset\(SHADOW_SCALE\)/);
  });

  it("reports the box she is actually drawn in", () => {
    expect(src).toMatch(/const stand = this\.shadowAt\(\);\n\s*return shadowBox\(stand\.x, stand\.y/);
  });

  it("the inset is the difference between the two reaches, not a nudge", () => {
    expect(shadowMirrorInset(1)).toBeCloseTo((1.52 - 1.32) * 64, 6);
  });
});
