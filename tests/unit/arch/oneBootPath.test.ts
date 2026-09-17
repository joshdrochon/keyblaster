import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ONE BOOT PATH (UR-36; `docs/verification-gaps.md`, instance 4, guard 3).
 *
 * ================== WHAT WENT WRONG ==================
 * `src/game/flight/boot.ts` built a SECOND `new Phaser.Game`. It was written
 * for a defensible reason - the Boot/Title lane owned `src/main.ts`, so the
 * flight lane shipped its own entry rather than editing a file it did not own -
 * and then the two games diverged in five ways, every one of them a defect the
 * shipping path had already fixed. Most seriously, `setGameWidth` was never
 * called on it, so the edge bars the player reported SIX TIMES were still alive
 * inside the test harness.
 *
 * Eight specs drove that boot, including `world-frame.spec.ts`, which produces
 * `flight-frame.png` - the image a HUMAN judges for the R-world rubric item.
 * The visual bar was being set against a picture the game does not draw.
 *
 * ================== WHY A STATIC CHECK, AND WHY THIS ONE ==================
 * Nothing about the divergence was visible at runtime. Each of the eight specs
 * booted something, got a Flight scene, and measured it; a spec cannot tell
 * that the game it is holding is not the one that ships. The binding between
 * the assertion and the product is not something an assertion can check, which
 * is the whole subject of `verification-gaps.md`.
 *
 * So it is checked where it IS visible: the source. A second `Phaser.Game` in
 * `src/` is a second product, and an e2e spec that constructs its own is a
 * harness that has stopped testing the game.
 *
 * Grep-shaped on purpose. A dependency-graph version of this was considered
 * and is worse: the divergence was five CONFIG VALUES passed to a constructor,
 * so the thing to count is constructor calls, and counting them is exact.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

const GAME_CTOR = /new\s+Phaser\.Game\s*\(|new\s+Game\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source with block and line comments removed, so prose cannot trip the check. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const constructions = (file: string): number => (code(file).match(GAME_CTOR) ?? []).length;

const rel = (file: string): string => path.relative(REPO, file);

/**
 * The ONE exemption, named with its reason.
 *
 * `shadow.spec.ts` builds a second game to render a CONTACT SHEET of the Shadow
 * character - six poses side by side at 2.5x, on a transparent page, for the
 * reference-compare item a human judges. It is not booting the product: it
 * stops every live scene and hides the real canvas first, and there is no
 * screen in the game that shows six Shadows at once, so there is nothing
 * shipped for it to boot instead.
 *
 * It is listed here rather than pattern-matched so that adding a second
 * exemption is a deliberate act with a name attached, which is the thing that
 * did not happen when `flight/boot.ts` was written.
 */
const EXEMPT_SPECS: ReadonlyMap<string, string> = new Map([
  [
    "tests/e2e/shadow.spec.ts",
    "renders a Shadow contact sheet for reference-compare; stops the real game first and boots no product screen",
  ],
]);

describe("UR-36: there is one game, and every spec boots it", () => {
  it("src/ constructs exactly one Phaser.Game, and it is the shipping entry", () => {
    const offenders = walk(path.join(REPO, "src"))
      .map((file) => ({ file: rel(file), n: constructions(file) }))
      .filter((r) => r.n > 0);
    expect(
      offenders.map((o) => o.file),
      "a second Phaser.Game in src/ is a second product (UR-36)",
    ).toEqual(["src/game/boot.ts"]);
    expect(offenders[0]?.n).toBe(1);
  });

  it("no e2e spec or harness constructs its own Phaser.Game", () => {
    const offenders = walk(path.join(REPO, "tests"))
      .filter((file) => constructions(file) > 0)
      .map(rel)
      // This file carries the defect as a literal, in its negative control.
      // Excluded by identity rather than by exemption: it is the checker.
      .filter((file) => file !== "tests/unit/arch/oneBootPath.test.ts")
      .filter((file) => !EXEMPT_SPECS.has(file));
    expect(
      offenders,
      "an e2e spec that builds its own game is measuring something the player never runs",
    ).toEqual([]);
  });

  it("every exemption still exists and still needs one", () => {
    // An exemption for a file that has been deleted or fixed is a licence
    // sitting unused, and the next person to build a second game will find it.
    for (const [file, why] of EXEMPT_SPECS) {
      expect(why.length, `${file}: an exemption needs a reason`).toBeGreaterThan(30);
      expect(
        constructions(path.join(REPO, file)),
        `${file} no longer builds a game; drop its exemption`,
      ).toBeGreaterThan(0);
    }
  });

  it("the flight launcher goes through bootGame rather than around it", () => {
    // The specific regression: `src/game/flight/boot.ts` is the file that was
    // a second game, and the fix is that it now delegates. If it ever stops
    // importing the shipping boot it has started building its own again, and
    // the count check above would catch that only if it used the constructor
    // directly - a copy of `bootGame`'s body would slip past.
    const launcher = code(path.join(REPO, "src/game/flight/boot.ts"));
    expect(launcher).toMatch(/bootGame\s*\(/);
    expect(launcher).not.toMatch(/Phaser\.Scale\.|backgroundColor|preserveDrawingBuffer/);
  });

  /**
   * THE NEGATIVE CONTROL (D85). The check has to catch the file it was written
   * for, in the state it was written in.
   */
  it("CATCHES the boot that shipped the defect", () => {
    const asItWas = `
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        backgroundColor: "#08111f",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        render: { preserveDrawingBuffer: pixelReadback },
      });
    `;
    expect((asItWas.match(GAME_CTOR) ?? []).length).toBe(1);
    expect(asItWas).not.toMatch(/bootGame\s*\(/);
  });
});
