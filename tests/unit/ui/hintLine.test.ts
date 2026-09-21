import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCREEN_HINTS } from "@game/ui/hint";
import { GUTTER, HINT_CONTRACT, HINT_TOP } from "@game/ui/grid";
import { HINT_PAD, drawHint, hintInk, hintPlateRect } from "@game/ui/hintLine";
import { INK, SKY_PLATE, TYPE } from "@game/ui/theme";

/**
 * ONE RENDERER FOR THE HINT LINE, ASKED OF EVERY SCENE THERE IS.
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner walked the product and said button and control placement is
 * inconsistent everywhere - different positions AND different styles from page
 * to page - and named the hint line as one of two examples: the Director map's
 * has a plate behind it and the pilot picker's has none.
 *
 * Measured on the served build, the hint's ink, screen by screen:
 *
 *   ProfilePicker 96,1036   ProfileCreate 96,1004   BeaconLog 96,1004
 *   Settings      96,1004   DirectorMap  118,1012   Preflight 96,1004
 *   Results       96,1004   Warp         ABSENT     Pause     ABSENT
 *
 * Nine screens are declared `placement: "grid"` in `ui/hint.ts` and `grid.ts`
 * says the line is `GUTTER` (96) over `HINT_TOP` (1004). So the picker was
 * 32 px low, the map 22 px right and 8 px low, and two of the nine drew nothing
 * on the line at all - Warp's hint lived inside the sentence card and Pause's
 * had never been written.
 *
 * ================== WHY THE CONTRACT DID NOT CATCH IT ==================
 * `ui/hint.ts` and `tests/unit/ui/hint.test.ts` are a COMPLETENESS sweep: they
 * ask whether every scene has made a decision and whether the copy repeats a
 * button. Both questions a wrongly-placed, unplated line passes. Nothing owned
 * the PIXELS or the STYLE, so every screen kept calling its own text factory
 * with its own coordinates.
 *
 * ================== WHAT THIS FILE ASKS ==================
 * NO ALLOWLIST, and the list of screens comes from `readdirSync`, so a scene
 * added next week is asked the same questions as the seventeen here.
 *
 *   1. every "grid" screen reaches the shared renderer;
 *   2. no "grid" screen draws its hint copy through any other factory;
 *   3. no screen that declared "none" draws one anyway;
 *   4. the renderer takes no coordinates - the COMPILER half of this, asserted
 *      against the signature so it cannot quietly grow an x;
 *   5. the ink lands on the grid and the PLATE's corner on `HINT_CONTRACT`;
 *   6. a plate is drawn, with no opt-out, because it is the only treatment that
 *      clears AC-22.8's 4.5:1 on the menus' dark backdrop AND on the map's art.
 *
 * ================== WATCH THEM FAIL (rule 4) ==================
 * Every number and message below was read off a real red run.
 *
 *   `this.addHint()` removed from PauseScene.ts
 *   -> "every screen declared on the grid reaches the shared renderer":
 *      `a "grid" screen that does not call drawHint/addHint: expected
 *      [ 'PauseScene.ts' ] to deeply equal []`
 *
 *   WarpScene's `drawHint` put back to `label(this, hint.x, hint.y, ...)`
 *   -> "no screen draws its own hint line beside the shared one":
 *      `expected [ 'WarpScene.ts draws warp.hint with label(' ] to deeply
 *      equal []`
 *
 *   `hintInk` given back the map's `padY` of 8
 *   -> "the plate's corner IS the contract's corner": `expected 1000 to be 1004`
 *
 *   `const g = ...` in drawHint made conditional on an option
 *   -> "every hint is plated - there is no opt-out": `expected undefined to be
 *      defined` on the painted plate.
 *
 *   npx vitest run tests/unit/ui/hintLine.test.ts --coverage.enabled=false
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = resolve(HERE, "../../../src/game/scenes");
const UI = resolve(HERE, "../../../src/game/ui");

const sceneFiles = (): string[] =>
  readdirSync(SCENES).filter((f) => f.endsWith("Scene.ts"));

/** A scene's source with comments stripped, so a comment cannot pass or fail it. */
const code = (dir: string, file: string): string =>
  readFileSync(resolve(dir, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** The row for a scene file, or null. The sweep is over FILES, never over rows. */
const rowFor = (file: string) => SCREEN_HINTS.find((r) => r.file === file) ?? null;

describe("one renderer draws the hint line, on every screen that has one", () => {
  it("every screen declared on the grid reaches the shared renderer", () => {
    // `drawHint` directly, or `this.addHint()` which is a three-line forward to
    // it in `MenuScene`. Nothing else counts, and there is nowhere to put a
    // screen that wants to be excused.
    const offenders: string[] = [];
    for (const file of sceneFiles()) {
      const row = rowFor(file);
      if (row === null || row.placement !== "grid") continue;
      const src = code(SCENES, file);
      if (!/drawHint\s*\(/.test(src) && !/this\.addHint\s*\(/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, 'a "grid" screen that does not call drawHint/addHint').toEqual([]);
  });

  it("no screen draws its own hint line beside the shared one", () => {
    // The three renderers this replaced, by name. A "grid" screen that passes
    // its hint key to any of them is drawing a second line, or the same line
    // twice, and either way it is back to choosing its own coordinates.
    const factories = ["skyText(", "label(", "uiText(", "chrome(", "visibleText("];
    const offenders: string[] = [];
    for (const file of sceneFiles()) {
      const row = rowFor(file);
      if (row === null || row.hintKey === null) continue;
      const src = code(SCENES, file);
      for (const factory of factories) {
        // The factory call, then anything that is not a statement break, then
        // the hint's copy key: `label(this, x, y, text.text("preflight.hint")`.
        const re = new RegExp(
          `${factory.replace("(", "\\s*\\(")}[^;]{0,400}?"${row.hintKey}"`,
          "s",
        );
        if (re.test(src)) offenders.push(`${file} draws ${row.hintKey} with ${factory}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no screen that declared it has no hint draws one anyway", () => {
    // The other direction, and the one `hint.test.ts` cannot ask: a screen can
    // now draw a hint in one call, so a screen with `placement: "none"` that
    // calls it is a decision reversed without the row being updated.
    const offenders: string[] = [];
    for (const file of sceneFiles()) {
      const row = rowFor(file);
      if (row === null || row.placement === "grid") continue;
      const src = code(SCENES, file);
      if (/drawHint\s*\(/.test(src) || /this\.addHint\s*\(/.test(src)) {
        offenders.push(`${file} is "${row.placement}" and draws a hint`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the sweep is over FILES, so a new scene cannot slip past it", () => {
    // The property that makes the three cases above a sweep rather than a
    // sample: they iterate the directory, and `hint.test.ts` separately fails a
    // scene file with no row. So a new screen must decide, and then obey.
    const files = sceneFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("WarpScene.ts");
    expect(files).toContain("PauseScene.ts");
    // Pause was ABSENT from the line and is declared on it, which is what
    // makes case 1 above bite for it.
    expect(rowFor("PauseScene.ts")?.placement).toBe("grid");
    // THE WARP BREAK IS "none" NOW, AND THAT IS A STRONGER CLAIM ABOUT IT, not
    // a case narrowed to pass. It was on the grid line so that the screen was
    // not the one of nine declaring a placement it did not keep; both of its
    // instructions are inside Shadow's card now (`warp.coachIntro`), so the
    // line has nothing of its own left to say and a copy of the card's
    // sentence at the foot of the frame would be UR-56's defect. The case
    // above - "no screen that declared it has no hint draws one anyway" -
    // sweeps this file and now covers the Warp break, which is a check the
    // "grid" row could not get.
    //
    // WATCHED FAILING, with `drawHint` put back in `WarpScene.create`:
    //   WarpScene.ts is "none" and draws a hint: expected [ Array(1) ] to
    //   deeply equal []
    expect(rowFor("WarpScene.ts")?.placement).toBe("none");
    expect(rowFor("WarpScene.ts")?.hintKey).toBeNull();
  });
});

describe("the renderer owns the position, so no screen can choose one", () => {
  it("takes no x and no y - the compiler half of this", () => {
    // `drawHint(scene, content, options)`. If a coordinate is ever added back
    // as a parameter, this fails before any screen has used it.
    const src = readFileSync(resolve(UI, "hintLine.ts"), "utf8");
    const signature = /export function drawHint\(([\s\S]*?)\): HintLine/.exec(src);
    expect(signature, "drawHint's signature").not.toBeNull();
    const params = (signature?.[1] ?? "").replace(/\s+/g, " ");
    expect(params).toContain("scene: Phaser.Scene");
    expect(params).toContain("content: string");
    expect(params).toContain("options: HintOptions");
    expect(params).not.toMatch(/\bx\s*:/);
    expect(params).not.toMatch(/\by\s*:/);
    // ...and the options bag has no positional field either.
    const opts = (/export interface HintOptions \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(opts).not.toMatch(/\bx\?*\s*:/);
    expect(opts).not.toMatch(/\by\?*\s*:/);
    expect(opts).not.toMatch(/padX|padY|origin|position/);
  });

  it("puts the ink on the grid and the PLATE's corner on the contract", () => {
    const at = hintInk();
    // The ink sits one `SKY_PLATE.padX` inside the contract's corner, and the
    // menu rows were moved onto that same inner line (`SPACE.rowPadX` 28 -> 22)
    // so a row's label and the hint under it share it - see `hintLine.ts`.
    expect(at.x).toBe(GUTTER + SKY_PLATE.padX);
    expect(at.y).toBe(HINT_TOP + SKY_PLATE.padY);
    const plate = hintPlateRect({ x: at.x, y: at.y, w: 420, h: 26 });
    expect(plate.x).toBe(HINT_CONTRACT.x);
    expect(plate.y).toBe(HINT_CONTRACT.top);
    expect(plate.x).toBe(GUTTER);
    expect(plate.y).toBe(HINT_TOP);
    // And the ink is inside the contract's slack, which is what the e2e sweep
    // measures on the real screens.
    expect(at.y - HINT_CONTRACT.top).toBeGreaterThanOrEqual(0);
    expect(at.y - HINT_CONTRACT.top).toBeLessThanOrEqual(HINT_CONTRACT.slack);
  });

  it("NEGATIVE CONTROL: the three shipped positions were three different points", () => {
    // Without this the case above could be vacuous. These are the numbers off
    // the served build, and none of them is the one the renderer now draws.
    const shipped = [
      { x: 96, y: 1036 }, // ProfilePicker
      { x: 96, y: 1004 }, // the four menu screens, Pre-flight, Results
      { x: 118, y: 1012 }, // DirectorMap
    ];
    expect(new Set(shipped.map((p) => `${p.x},${p.y}`)).size).toBe(3);
    const at = hintInk();
    for (const p of shipped) {
      expect(`${at.x},${at.y}`, "one of the shipped positions survived").not.toBe(
        `${p.x},${p.y}`,
      );
    }
    // 118,1016: the plate's corner on the contract at 96,1004, its ink one
    // `SKY_PLATE.padX` inside. The menu rows moved onto the same 118 in this
    // change, because at their old 28 they sat six pixels off it.
    expect(at).toEqual({ x: 118, y: 1016 });
  });
});

/**
 * A Phaser stub, narrow enough to be honest about what it is standing in for.
 *
 * It answers the four calls `drawHint` makes - `add.graphics`, `add.text`,
 * `events.once` and the text's own bounds - and records what was painted. The
 * bounds are the ONE thing it invents (a browser measures them), so the size is
 * a parameter and the assertions below are about the plate's OFFSET from the
 * ink rather than about its width.
 */
function stubScene(inkW: number, inkH: number) {
  const painted: { rect: { x: number; y: number; w: number; h: number }; fill: string; alpha: number }[] = [];
  let lastFill = "";
  let lastAlpha = 1;
  const graphics = {
    setDepth() {
      return graphics;
    },
    setAlpha() {
      return graphics;
    },
    clear() {
      painted.length = 0;
    },
    fillStyle(colour: number, alpha: number) {
      lastFill = `#${colour.toString(16).padStart(6, "0")}`;
      lastAlpha = alpha;
    },
    fillRoundedRect(x: number, y: number, w: number, h: number) {
      painted.push({ rect: { x, y, w, h }, fill: lastFill, alpha: lastAlpha });
    },
    lineStyle() {},
    strokeRoundedRect() {},
    lineBetween() {},
    destroy() {},
  };
  const made: { x: number; y: number; content: string; style: Record<string, unknown> }[] = [];
  const textObj = {
    x: 0,
    y: 0,
    text: "",
    setLetterSpacing() {
      return textObj;
    },
    setDepth() {
      return textObj;
    },
    setAlpha() {
      return textObj;
    },
    setOrigin() {
      return textObj;
    },
    setText(next: string) {
      textObj.text = next;
      return textObj;
    },
    getBounds() {
      return { x: textObj.x, y: textObj.y, width: inkW, height: inkH };
    },
    destroy() {},
  };
  const scene = {
    add: {
      graphics: () => graphics,
      text: (x: number, y: number, content: string, style: Record<string, unknown>) => {
        textObj.x = x;
        textObj.y = y;
        textObj.text = content;
        made.push({ x, y, content, style });
        return textObj;
      },
    },
    events: { once: () => undefined },
  };
  return { scene, painted, made, textObj };
}

describe("every hint is plated, in one ink, with no opt-out", () => {
  const STYLE = { lang: "en" as const, uppercase: false, increasedLetterSpacing: false };

  it("draws a plate whose top-left corner is the grid's hint corner", () => {
    const { scene, painted } = stubScene(420, 26);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drawHint(scene as any, "arrows to move · enter to choose", {
      screen: "pause",
      id: "ui.common.hintKeys",
      style: STYLE,
    });
    const plate = painted[0];
    expect(plate, "nothing was painted - the plate is not optional").toBeDefined();
    expect(plate?.rect.x).toBe(GUTTER);
    expect(plate?.rect.y).toBe(HINT_TOP);
    expect(plate?.rect.w).toBe(420 + HINT_PAD.x * 2);
    expect(plate?.rect.h).toBe(26 + HINT_PAD.y * 2);
    // The SAME plate the map and the stage report already had, so the two
    // screens that were right keep the pixels they had.
    expect(plate?.fill.toLowerCase()).toBe(SKY_PLATE.fill.toLowerCase());
    expect(plate?.alpha).toBe(SKY_PLATE.alpha);
  });

  it("draws one ink at one size, whatever the screen", () => {
    const { scene, made } = stubScene(300, 26);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drawHint(scene as any, "type the sentence.", {
      screen: "warp",
      id: "warp.hint",
      style: STYLE,
    });
    const style = made[0]?.style ?? {};
    // `INK.textDim`, never `INK.textFaint`: the faint ink measured 2.57:1 on
    // the stage report's sky and 4.31:1 on Pre-flight's hull, both under
    // AC-22.8's 4.5:1, on the one line that tells a child which keys to press.
    expect(style["color"]).toBe(INK.textDim);
    expect(style["fontSize"]).toBe(`${TYPE.caption}px`);
    expect(made[0]?.x).toBe(hintInk().x);
    expect(made[0]?.y).toBe(hintInk().y);
  });

  it("re-cuts the plate when the copy changes, and tears both down together", () => {
    // The lifetime bug `skyText` was written around: a Text and the plate cut
    // for it are one object, and a rebuild that drops one leaves the other on
    // screen. The stage report rebuilds this line on every render.
    const { scene, painted } = stubScene(420, 26);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hint = drawHint(scene as any, "one", { screen: "results", id: "results.hint", style: STYLE });
    expect(painted).toHaveLength(1);
    hint.setText("a much longer line");
    expect(painted, "the plate was not re-cut").toHaveLength(1);
    expect(painted[0]?.rect.x).toBe(GUTTER);
    expect(hint.objects).toHaveLength(2);
    // Plate FIRST, so a caller adding both to a container cannot paint the
    // plate over the line it is there to make legible.
    expect(hint.objects[0]).toBe(hint.plate);
    expect(hint.objects[1]).toBe(hint.text);
  });

  it("paints nothing at all for empty copy, rather than a bare plate", () => {
    const { scene, painted } = stubScene(0, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drawHint(scene as any, "", { screen: "warp", id: "warp.hint", style: STYLE });
    expect(painted).toEqual([]);
  });
});
