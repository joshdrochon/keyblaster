import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8");

/** Comments out. A doc-comment about the terrain that was removed is not terrain. */
const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/**
 * AC-22.10, THE SOURCE HALF (D97).
 *
 * "The world is space, not terrain. No parallax layer renders a landform
 * silhouette that terminates in a flat base with sky visible beneath it; depth
 * is carried by ring planes seen edge-on, a planet limb, nebula bands, dust
 * fields and distant debris, none of which require a ground plane."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * D97 was taken after the world was looked at three times and the shapes were
 * called noise, and `tiles.ts` records that two of the three terrain generations
 * failed STRUCTURALLY rather than on taste: a plane that wraps every tile height
 * can only be a partial fill, and a partial fill repeated vertically is a band
 * with sky above and below it. Six playtest reports came out of those two facts.
 *
 * Nothing stopped it coming back. There was no test for AC-22.10 at all - it was
 * one of the two ACs `G-trace --strict` reported as asserted by nothing - so a
 * mesa painter added tomorrow would have shipped with a green board.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS HALF CAN AND CANNOT DO
 *
 * It is an ALLOWLIST, not a blocklist, and that is the whole design. Searching
 * for `massifTile` catches the thing spelled the way somebody expected and
 * nothing else; requiring every painter the layer build invokes to be named here
 * with a reason means a NEW painter fails until a human writes down what it
 * draws, and writing that down is the moment they meet D97.
 *
 * What it cannot see is a landform drawn inline, without a painter, by a lane
 * that never read the decision. That is the other half's job:
 * `tests/e2e/no-terrain.spec.ts` measures the SHAPE on a captured frame, where
 * what the function was called does not matter.
 */
describe("AC-22.10 / D97: the layer build paints space, not terrain", () => {
  /**
   * Every tile painter the flight layer build may call, and what it draws.
   *
   * Adding a painter means adding a line here. If what you are about to write
   * describes ground, a horizon, a ridge or a hill, read D97 and `tiles.ts`
   * first - both of the structural failures are written down there and neither
   * is an opinion.
   */
  const ALLOWED_PAINTERS: Readonly<Record<string, string>> = {
    dustTile: "mid-field dust: soft low-contrast motes, no silhouette",
    moteTile: "near-field dust motes and ice glints (art-direction L5)",
    accentTile: "sparse accent diamonds in the near field",
    driftTile: "distant debris at a plane's own ramp value - D97 keeps this one",
    veilTile: "the stop's atmosphere pass: dust, glitter, streaks or haze",
  };

  it("every tile painter in the layer build is declared, and none of them is terrain", () => {
    const build = codeOf(read("src/game/render/parallax.ts"));
    const called = [...build.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*Tile)\s*\(/g)].map((m) => m[1] as string);
    // ANTI-VACUITY. If the regex stops matching, an empty set trivially passes
    // every assertion below and this file becomes decoration.
    expect(new Set(called).size, "tile painters found in the layer build").toBeGreaterThanOrEqual(5);
    const undeclared = [...new Set(called)].filter((n) => !(n in ALLOWED_PAINTERS));
    expect(
      undeclared,
      `undeclared tile painter(s) in the flight layer build: ${undeclared.join(", ")}. Add them to ALLOWED_PAINTERS with a one-line description of what they draw - and if that description is a landform, D97 says it does not ship`,
    ).toEqual([]);
  });

  /**
   * The vocabulary check, second and deliberately narrow.
   *
   * It runs on CODE with comments stripped, because `tiles.ts` documents the
   * three removed terrain generations at length and must be able to keep saying
   * "massif" in prose - the history is the reason the rule exists, and a check
   * that deletes its own rationale is a bad trade.
   */
  const TERRAIN_WORDS = [
    "massif",
    "mesa",
    "butte",
    "ridgeline",
    "horizonLine",
    "landform",
    "terrainTile",
    "groundPlane",
    "hillTile",
    "canyonTile",
    "skyline",
    "plateauTile",
  ];

  it("no terrain painter or terrain geometry is named in the flight layer build", () => {
    for (const file of ["src/game/render/parallax.ts", "src/game/render/tiles.ts"]) {
      const code = codeOf(read(file));
      const hits = TERRAIN_WORDS.filter((wrd) => new RegExp(`\\b${wrd}`, "i").test(code));
      expect(hits, `${file} names terrain geometry in code: ${hits.join(", ")}`).toEqual([]);
    }
  });

  it("the forms D97 puts in terrain's place are the ones actually built", () => {
    // The complement of the rule, and it is not decoration: a build that drew
    // NOTHING would pass both checks above. D97 names what depth is carried by,
    // so at least the debris planes and the atmosphere pass have to be there.
    const build = codeOf(read("src/game/render/parallax.ts"));
    expect(build, "distant debris carries the depth planes (D97)").toContain("driftTile(");
    expect(build, "the stop's atmosphere pass").toContain("veilTile(");
    expect(build, "dust fields").toContain("dustTile(");
  });
});
