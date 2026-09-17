import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SHADOW_COLORS, SHADOW_POSES, shadowPoseSpec } from "@game/render/shadow.js";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { RUBRIC, STATUS } from "../../gauntlet/rubric.mjs";

/**
 * AC-25.1 — "The rendered vector Shadow matches
 * `design-reference/refs/shadow-sheet.png`: charcoal body, cream face rim,
 * glowing pale-blue eyes and antenna tip, stubby arms, hover glow, round flank
 * port."
 *
 * The AC was named in `shadow.ts`'s own header and in no test title anywhere,
 * which is what a citation looks like after the assertion it described was
 * deleted. `tests/e2e/shadow.spec.ts` produces `shadow-render.png` and asserts
 * the six POSES (AC-25.2); it asserts nothing about how Shadow looks.
 *
 * WHAT IS TESTABLE HERE AND WHAT IS NOT. "Matches the sheet" is a `V` item and
 * is judged by a human against the render (`R-shadow`). What a unit test CAN
 * hold is the list of named features the AC spells out, because every one of
 * them is a module constant:
 *
 *   - the palette is asserted by COLOUR FAMILY, not by hex. `body === 0x373d4a`
 *     would be the implementation repeated back at itself and would pass
 *     equally well if the art lane made Shadow beige. "Dark, desaturated and
 *     not warm" is the claim the word "charcoal" makes, and it is the claim a
 *     beige Shadow fails.
 *   - stubby arms and a hover glow are asserted per pose, off the pose table.
 *   - the reference compare itself is held to its own rule: it must refuse to
 *     pass without a judge verdict, which is the only thing standing between
 *     "a render exists" and "it matches".
 *
 * Each predicate is applied to a COUNTER-EXAMPLE in the same test, because
 * these are colour bands and a band wide enough to admit everything proves
 * nothing.
 */

const REPO = resolve(__dirname, "../../..");

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Standard HSL, so the words in the AC can be spelled as bands. */
function hsl(value: number): Hsl {
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

/** Dark, desaturated, and not warm. */
const isCharcoal = (c: number): boolean => {
  const { h, s, l } = hsl(c);
  return l < 0.4 && s < 0.35 && (h >= 180 && h <= 260);
};

/** Light, warm, gently saturated. */
const isCream = (c: number): boolean => {
  const { h, s, l } = hsl(c);
  return l > 0.75 && s > 0.15 && h >= 20 && h <= 65;
};

/** Light, clearly blue, and saturated enough to read as a glow. */
const isPaleBlue = (c: number): boolean => {
  const { h, s, l } = hsl(c);
  return l > 0.6 && s > 0.5 && h >= 180 && h <= 215;
};

describe("AC-25.1: Shadow is drawn as the reference sheet describes him", () => {
  it("AC-25.1: the body is charcoal - dark, desaturated and cool", () => {
    for (const key of ["body", "bodyTop", "bodyLow", "seam"] as const) {
      expect(isCharcoal(SHADOW_COLORS[key]), `${key} is not a charcoal`).toBe(true);
    }
    // COUNTER-EXAMPLES: the band is not wide enough to admit a cream body, a
    // bright body, or a warm brown one.
    expect(isCharcoal(0xefe5d0), "cream passes as charcoal").toBe(false);
    expect(isCharcoal(0x8b4513), "saddle brown passes as charcoal").toBe(false);
    expect(isCharcoal(0x9fe4ff), "pale blue passes as charcoal").toBe(false);
  });

  it("AC-25.1: the face rim is cream, and is not just 'a light colour'", () => {
    expect(isCream(SHADOW_COLORS.rim), "the face rim is not cream").toBe(true);
    expect(isCream(SHADOW_COLORS.rimShade), "the rim's shade is not cream").toBe(true);
    expect(isCream(0xffffff), "white passes as cream").toBe(false);
    expect(isCream(SHADOW_COLORS.glow), "the pale-blue glow passes as cream").toBe(false);
  });

  it("AC-25.1: the eyes, the antenna tip and the flank port glow pale blue", () => {
    for (const key of ["glow", "port"] as const) {
      expect(isPaleBlue(SHADOW_COLORS[key]), `${key} is not pale blue`).toBe(true);
    }
    // "Glowing": the bright end of the glow is lighter than the glow itself,
    // which is what makes a highlight read as emitted light rather than paint.
    expect(hsl(SHADOW_COLORS.glowBright).l).toBeGreaterThan(hsl(SHADOW_COLORS.glow).l);
    expect(isPaleBlue(SHADOW_COLORS.rim), "the cream rim passes as pale blue").toBe(false);
    expect(isPaleBlue(SHADOW_COLORS.screen), "the deep navy screen passes as pale blue").toBe(false);
  });

  it("AC-25.1: the face screen is a deep navy the pale-blue eyes can sit on", () => {
    const screen = hsl(SHADOW_COLORS.screen);
    const eyes = hsl(SHADOW_COLORS.glow);
    expect(screen.h, "the screen is not blue").toBeGreaterThan(200);
    expect(screen.h).toBeLessThan(250);
    expect(screen.l, "the screen is not deep").toBeLessThan(0.3);
    // An eye only glows if it is much lighter than what it is drawn on.
    expect(eyes.l - screen.l, "the eyes barely separate from the screen").toBeGreaterThan(0.4);
  });

  it("AC-25.1: every pose has two stubby arms and a hover glow", () => {
    expect(SHADOW_POSES.length).toBeGreaterThan(0);
    for (const pose of SHADOW_POSES) {
      const spec = shadowPoseSpec(pose);
      expect(spec.leftArm, `${pose} has no left arm`).toBeDefined();
      expect(spec.rightArm, `${pose} has no right arm`).toBeDefined();
      // Stubby: the arm's root sits close to the body, never out on a boom.
      expect(spec.leftArm.reach, `${pose}'s left arm is not stubby`).toBeLessThan(1.3);
      expect(spec.rightArm.reach, `${pose}'s right arm is not stubby`).toBeLessThan(1.3);
      // The hover glow is never switched off - he floats in every pose.
      expect(spec.hover, `${pose} has no hover glow`).toBeGreaterThan(0);
    }
  });

  it("AC-25.1: Shadow has ONE look - no colourway argument, so the sheet's bottom row cannot creep back", () => {
    expect(Object.isFrozen(SHADOW_COLORS), "the palette is mutable").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The reference compare itself
// ---------------------------------------------------------------------------

type Result = { status: string; detail: string };
type Item = {
  id: string;
  referenceImage: string;
  run: (ctx: { repo: string; evidence: unknown }) => Promise<Result>;
};

const shadowItem = (RUBRIC as Item[]).find((i) => i.id === "R-shadow")!;
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** An evidence port that answers for a given repo root. */
const evidenceIn = (repo: string) => ({
  has: (name: string) => existsSync(join(repo, "gauntlet/evidence", name)),
  path: (name: string) => `gauntlet/evidence/${name}`,
});

describe("AC-25.1: the reference compare that judges it can still say no", () => {
  it("AC-25.1: the reference sheet the AC names is on disk", () => {
    expect(shadowItem.referenceImage).toBe("design-reference/refs/shadow-sheet.png");
    expect(existsSync(join(REPO, shadowItem.referenceImage))).toBe(true);
  });

  it("AC-25.1: NEGATIVE CONTROL - a render with no judge verdict is never auto-passed", async () => {
    // A tree with the reference and the render, and no verdicts file. This is
    // the state a lane is in the moment it produces a new render, and D85 says
    // that state is FAIL, not PASS.
    const root = mkdtempSync(join(tmpdir(), "kb-shadow-"));
    scratch.push(root);
    for (const rel of ["design-reference/refs/shadow-sheet.png", "gauntlet/evidence/shadow-render.png"]) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      copyFileSync(join(REPO, rel), join(root, rel));
    }

    const result = await shadowItem.run({ repo: root, evidence: evidenceIn(root) });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toContain("no judge verdict");
  });

  it("AC-25.1: NEGATIVE CONTROL - a missing reference sheet is a failure, not a skip", async () => {
    const root = mkdtempSync(join(tmpdir(), "kb-shadow-none-"));
    scratch.push(root);
    const result = await shadowItem.run({ repo: root, evidence: evidenceIn(root) });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toContain("reference image missing");
  });
});
