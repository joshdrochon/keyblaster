import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { RUBRIC, STATUS } from "../../gauntlet/rubric.mjs";

/**
 * AC-23.1 — "No raster file is referenced from anywhere in `src/`; reference
 * images in `design-reference/refs/` are looked at, never loaded."
 *
 * The gauntlet's `G-raster` already scans for this, and the PRD names it. What
 * was missing is a test: a rubric item is a report, it runs when someone runs
 * the gauntlet, and nothing in `npm test` ever asked whether it was still true
 * or still able to say no.
 *
 * The scan itself is IMPORTED from `tests/gauntlet/rubric.mjs` rather than
 * rewritten here, for the same reason `trace-check.mjs` imports
 * `citationStrength`: two copies of a rule drift, and the copy that drifts is
 * the one nobody runs. If G-raster's definition of "a raster reference"
 * changes, this test changes with it and cannot quietly disagree.
 *
 * THE NEGATIVE CONTROL IS THE POINT. `run({ repo })` takes the tree to scan, so
 * the same check is pointed at a scratch tree carrying the exact defect D83
 * forbids - `this.load.image("ship.png")` - and must go red. A green scan over
 * a tree with no rasters in it is not evidence that the scan works.
 */

type Result = { status: string; detail: string };
type Item = { id: string; run: (ctx: { repo: string }) => Promise<Result> };

const REPO = resolve(__dirname, "../../..");
const raster = (RUBRIC as Item[]).find((i) => i.id === "G-raster")!;

const scratchRoots: string[] = [];

/** A throwaway repo with one `src/` file in it. */
function treeWith(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "kb-raster-"));
  scratchRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "scene.ts"), source, "utf8");
  return root;
}

afterAll(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

describe("AC-23.1: no raster is referenced from src/ (D83, all art is vector in code)", () => {
  it("AC-23.1: the shipped src/ tree references no raster file", async () => {
    const result = await raster.run({ repo: REPO });
    expect(result.status, result.detail).toBe(STATUS.PASS);
  });

  it("AC-23.1: NEGATIVE CONTROL - a loaded .png in src/ is caught", async () => {
    const result = await raster.run({
      repo: treeWith('export const boot = (s: Phaser.Scene) => s.load.image("ship", "ship.png");\n'),
    });
    expect(result.status).toBe(STATUS.FAIL);
    expect(result.detail).toContain("ship.png");
  });

  it("AC-23.1: NEGATIVE CONTROL - every raster extension is caught, not just .png", async () => {
    for (const ext of ["jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]) {
      const result = await raster.run({
        repo: treeWith(`export const art = "rock.${ext}";\n`),
      });
      expect(result.status, `.${ext} was not caught`).toBe(STATUS.FAIL);
    }
  });

  it("AC-23.1: a reference image is LOOKED AT, never loaded - nothing in src/ reaches design-reference/", () => {
    // The second half of the AC, which G-raster does not cover: a comp could be
    // pulled in by path without the filename ever appearing as a literal
    // (`import.meta.glob("../../design-reference/refs/*")`). The refs are
    // authoring input; a build that reads them has made them a dependency.
    const files = sourceFiles(join(REPO, "src"));
    expect(files.length).toBeGreaterThan(0);
    const hits = files.filter((f) =>
      stripped(f).includes("design-reference"),
    );
    expect(hits, `src/ files reaching into design-reference/: ${hits.join(", ")}`).toEqual([]);
  });

  it("AC-23.1: NEGATIVE CONTROL - the design-reference scan can see a reference that IS loaded", () => {
    const root = treeWith(
      'export const comps = import.meta.glob("../design-reference/refs/*");\n',
    );
    const hits = sourceFiles(join(root, "src")).filter((f) =>
      stripped(f).includes("design-reference"),
    );
    expect(hits.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The design-reference half needs its own walk; G-raster's is not exported.
// ---------------------------------------------------------------------------


function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if ([".ts", ".mjs", ".html"].includes(extname(full))) out.push(full);
  }
  return out;
}

/** Comments removed, string literals kept - G-raster's own rule. */
function stripped(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
