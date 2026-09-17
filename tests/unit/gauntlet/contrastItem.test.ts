import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { RUBRIC, STATUS } from "../../gauntlet/rubric.mjs";

/**
 * V-22.8 CAN NOW FAIL ON SKY-BORNE TEXT.
 *
 * The item measured one pair of colours - the untyped word and the typed letter
 * on the word plate - and reported 17.4:1 for months while five screens drew
 * their headline straight onto the sky at 1.19:1 to 1.72:1. Nothing about the
 * threshold was wrong. The SCOPE was one plate.
 *
 * So this file poses the shipped defect at the item and requires red. Every
 * block below is a way the old item would have said pass:
 *
 *   - word-plate evidence alone, with no sky evidence at all
 *   - sky evidence that covers some screens and quietly skips the failing ones
 *   - an empty sky file, which passes "all rows >= 4.5" vacuously
 *   - the actual colours off the captured PNGs
 *
 * Re-run: npx vitest run tests/unit/gauntlet/contrastItem.test.ts --coverage.enabled=false
 */

const REPO = resolve(__dirname, "../../..");

type Result = { status: string; detail: string };
type Item = { id: string; run: (ctx: unknown) => Promise<Result> };

const item = (id: string): Item => (RUBRIC as Item[]).find((i) => i.id === id)!;

/** An evidence port over several named artifacts at once. */
function evidenceOf(files: Record<string, unknown>) {
  return {
    has: (n: string) => n in files,
    path: (n: string) => `gauntlet/evidence/${n}`,
    read: (n: string) => files[n],
    assertNumber: () => ({ status: STATUS.FAIL, detail: "unused", evidence: null }),
    assertShape: () => ({ status: STATUS.FAIL, detail: "unused", evidence: null }),
  };
}

const run = (files: Record<string, unknown>): Promise<Result> =>
  item("V-22.8").run({ repo: REPO, evidence: evidenceOf(files) });

// ---------------------------------------------------------------------------
// The word-plate half, which was always healthy. Generated rather than pasted,
// because its only job here is to be the passing half.
// ---------------------------------------------------------------------------

const STOPS = ["earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

function healthyPlate(): { rows: unknown[] } {
  const rows = [];
  for (const mode of ["normal", "colourblind"]) {
    for (const stop of STOPS) {
      for (const role of ["resting", "typed"]) {
        rows.push({ stop, mode, role, fg: "#F7FAFF", bg: "#0E1116", ratio: 17.4 });
      }
    }
  }
  return { rows };
}

/** Sky-borne text as it is drawn NOW: every headline on the shared plate. */
function healthySky(): { rows: unknown[] } {
  const rows: unknown[] = [];
  const screens = ["map", "warp", "beacon", "results", "ending"];
  for (const screen of screens) {
    for (let i = 0; i < 4; i += 1) {
      rows.push({
        screen,
        id: `${screen}.text${i}`,
        color: i % 2 === 0 ? "#F7FAFF" : "#A8B6C8",
        plateFill: "#0E1116",
        plateAlpha: 0.97,
      });
    }
  }
  return { rows };
}

describe("V-22.8 passes only when BOTH halves are measured", () => {
  it("passes on healthy plate evidence plus healthy sky evidence", async () => {
    const r = await run({
      "contrast.json": healthyPlate(),
      "contrast-sky.json": healthySky(),
    });
    expect(r.status, r.detail).toBe(STATUS.PASS);
    expect(r.detail).toMatch(/sky-borne text worst/);
  });

  it("NEGATIVE CONTROL: word-plate evidence ALONE is no longer a pass", async () => {
    // This is exactly the state the repo was in when five screens of 1.2-1.7:1
    // text shipped green.
    const r = await run({ "contrast.json": healthyPlate() });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toMatch(/contrast-sky\.json/);
    expect(r.detail).toMatch(/never the failing half/);
  });
});

describe("V-22.8 cannot be passed vacuously", () => {
  it("an empty sky file is a failure, not a clean sweep", async () => {
    const r = await run({
      "contrast.json": healthyPlate(),
      "contrast-sky.json": { rows: [] },
    });
    expect(r.status).toBe(STATUS.FAIL);
  });

  it("rejects sky evidence that skips the screens which actually failed", async () => {
    const partial = {
      rows: healthySky().rows.filter(
        (r) => (r as { screen: string }).screen !== "ending",
      ),
    };
    const r = await run({
      "contrast.json": healthyPlate(),
      "contrast-sky.json": partial,
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toMatch(/ending/);
  });

  it("rejects a file that covers every screen with one token row each", async () => {
    const thin = {
      rows: ["map", "warp", "beacon", "results", "ending"].map((screen) => ({
        screen,
        id: `${screen}.heading`,
        color: "#F7FAFF",
        plateFill: "#0E1116",
        plateAlpha: 0.97,
      })),
    };
    const r = await run({
      "contrast.json": healthyPlate(),
      "contrast-sky.json": thin,
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toMatch(/stopped registering/);
  });
});

describe("V-22.8 fails on the values that shipped", () => {
  /** Ink on bare sky: `plateFill: null` is "no plate", which is what shipped. */
  const shipped = () => ({
    rows: [
      ...healthySky().rows,
      { screen: "ending", id: "ending.heading", color: "#FFB3C7", plateFill: null, plateAlpha: 0, behind: "#9896A7" },
      { screen: "warp", id: "warp.heading", color: "#F26A4B", plateFill: null, plateAlpha: 0, behind: "#D9A177" },
      { screen: "map", id: "map.locked", color: "#3A4656", plateFill: null, plateAlpha: 0, behind: "#16243A" },
    ],
  });

  it("names each failing row, its colours and its ratio", async () => {
    const r = await run({
      "contrast.json": healthyPlate(),
      "contrast-sky.json": shipped(),
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toMatch(/ending\/ending\.heading/);
    expect(r.detail).toMatch(/warp\/warp\.heading/);
    expect(r.detail).toMatch(/map\/map\.locked/);
    // The report is a task, so it has to carry the number to fix.
    expect(r.detail).toMatch(/1\.\d+:1/);
  });

  it("a plate at alpha 0.97 is measured over WHITE, not over a friendly sky", async () => {
    // A semi-transparent plate is only as dark as what is under it. If the
    // rubric composited over the captured sky instead of the worst case, a
    // bright stop could pass here and fail on the screen.
    const overWhite = await run({
      "contrast.json": healthyPlate(),
      "contrast-sky.json": healthySky(),
    });
    expect(overWhite.status).toBe(STATUS.PASS);
    expect(overWhite.detail).toMatch(/composited over white/);
  });
});

describe("the capture writes what the rubric reads", () => {
  it("scripts/capture-screens.mjs emits contrast-sky.json with the fields this item consumes", () => {
    const src = readFileSync(join(REPO, "scripts/capture-screens.mjs"), "utf8");
    expect(src).toContain("contrast-sky.json");
    expect(src).toContain("snapshot().skyText");
  });

  it("the scene kit records a plate fill and alpha for every registered row", () => {
    const src = readFileSync(join(REPO, "src/game/scenes/lib/kit.ts"), "utf8");
    expect(src).toContain("recordSkyText");
    expect(src).toContain("plateAlpha");
  });
});
