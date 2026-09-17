import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { RUBRIC, STATUS } from "../../gauntlet/rubric.mjs";

/**
 * NEGATIVE CONTROLS for L-6e.3 and L-6e.4 — the two rubric predicates, judged
 * against artifacts this file builds.
 *
 * `tests/unit/simulation/coreLoop.test.ts` carries the controls for the
 * MEASUREMENT (can the belt actually go quiet, can a flat learner be told from
 * a learning one). This file carries the controls for the CHECK: given an
 * artifact with the old defect in it, does the rubric item go red?
 *
 * The defects reproduced, each one exactly as it shipped:
 *   L-6e.3  `{"maxGapMs": 120}` from simulateStage, where 120 was that
 *           harness's own 120 ms spawn tick — the reading was the instrument.
 *           And an artifact with no negative control at all.
 *   L-6e.4  `{"trendUp": true}` alone, over three stops of seven, on a measure
 *           that could not produce false for any player or any seed.
 *
 * Re-run:  npx vitest run tests/unit/gauntlet --coverage.enabled=false
 */

const REPO = resolve(__dirname, "../../..");
const EVIDENCE = join(REPO, "gauntlet/evidence");

type Result = { status: string; detail: string };
type Item = { id: string; run: (ctx: unknown) => Promise<Result> };

const item = (id: string): Item => (RUBRIC as Item[]).find((i) => i.id === id)!;

/** An evidence port backed by an in-memory object, so a defect can be posed. */
function fakeEvidence(name: string, data: unknown) {
  return {
    has: (n: string) => n === name,
    path: (n: string) => `gauntlet/evidence/${n}`,
    read: () => data,
    assertNumber(n: string, k: string, p: (v: number) => boolean, what: string) {
      const v = (data as Record<string, number>)[k];
      return {
        status: typeof v === "number" && p(v) ? STATUS.PASS : STATUS.FAIL,
        detail: `${what}: ${k} = ${v}`,
        evidence: this.path(n),
      };
    },
    assertShape(n: string, p: (d: unknown) => boolean, what: string) {
      return { status: p(data) ? STATUS.PASS : STATUS.FAIL, detail: what, evidence: this.path(n) };
    },
  };
}

const live = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(EVIDENCE, name), "utf8")) as Record<string, unknown>;

const run = (id: string, name: string, data: unknown): Promise<Result> =>
  item(id).run({ repo: REPO, evidence: fakeEvidence(name, data) });

describe("L-6e.3 can fail: dead time", () => {
  it("passes on the artifact the belt harness actually produced", async () => {
    const r = await run("L-6e.3", "deadtime.json", live("deadtime.json"));
    expect(r.status).toBe(STATUS.PASS);
  });

  it("NEGATIVE CONTROL: the exact artifact that shipped — {maxGapMs: 120} from simulateStage — is rejected", async () => {
    const r = await run("L-6e.3", "deadtime.json", {
      maxGapMs: 120,
      stages: 200,
      source: "tests/unit/simulation/coreLoop.test.ts",
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("serial-typist belt");
  });

  it("NEGATIVE CONTROL: a reading equal to its own measurement resolution is rejected", async () => {
    const r = await run("L-6e.3", "deadtime.json", {
      ...live("deadtime.json"),
      measurementResolutionMs: 120,
      maxGapMs: 120,
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("the reading is the instrument");
  });

  it("NEGATIVE CONTROL: an artifact with no negative control is rejected", async () => {
    const d = { ...live("deadtime.json") };
    delete d.control;
    const r = await run("L-6e.3", "deadtime.json", d);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("no negative control");
  });

  it("NEGATIVE CONTROL: a control that never breached 2 s is rejected", async () => {
    const r = await run("L-6e.3", "deadtime.json", {
      ...live("deadtime.json"),
      control: { what: "x", maxGapMs: 1800, mustExceedMs: 2000 },
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("never been seen to breach");
  });

  it("NEGATIVE CONTROL: a real breach of the limit is rejected", async () => {
    const r = await run("L-6e.3", "deadtime.json", { ...live("deadtime.json"), maxGapMs: 2400 });
    expect(r.status).toBe(STATUS.FAIL);
  });

  it("NEGATIVE CONTROL: too few belts to mean anything is rejected", async () => {
    const r = await run("L-6e.3", "deadtime.json", { ...live("deadtime.json"), belts: 3 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("too small");
  });
});

describe("L-6e.4 can fail: retention", () => {
  it("passes on the artifact the belt harness actually produced", async () => {
    const r = await run("L-6e.4", "retention.json", live("retention.json"));
    expect(r.status).toBe(STATUS.PASS);
  });

  it("NEGATIVE CONTROL: the exact artifact that shipped — a bare trendUp flag — is rejected", async () => {
    const r = await run("L-6e.4", "retention.json", {
      trendUp: true,
      meanImprovementMs: 197,
      seedsImproving: 40,
      seeds: 40,
      source: "tests/unit/simulation/coreLoop.test.ts",
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("serial-typist belt");
  });

  it("NEGATIVE CONTROL: three stops of a six-belt route is rejected", async () => {
    const r = await run("L-6e.4", "retention.json", { ...live("retention.json"), stops: 3 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("six belts");
  });

  it("NEGATIVE CONTROL: a flat learner reported as improving is rejected", async () => {
    const d = live("retention.json") as { controls: { flatLearner: Record<string, unknown> } };
    const r = await run("L-6e.4", "retention.json", {
      ...d,
      controls: { ...d.controls, flatLearner: { ...d.controls.flatLearner, trendUp: true } },
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("did not improve did");
  });

  it("NEGATIVE CONTROL: an engine that adds no re-met words is rejected", async () => {
    // If removing the D21/D23 interleave changes nothing, the line is the
    // content pools' overlap and the SRS is not in the measurement at all.
    const d = live("retention.json") as { controls: { noInterleave: Record<string, unknown> } };
    const r = await run("L-6e.4", "retention.json", {
      ...d,
      controls: { ...d.controls, noInterleave: { ...d.controls.noInterleave, crossStopWords: 88, withInterleave: 88 } },
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("contributes nothing to this line");
  });

  it("NEGATIVE CONTROL: no re-met words at all is rejected", async () => {
    const r = await run("L-6e.4", "retention.json", { ...live("retention.json"), crossStopWords: 0 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("no delayed re-test");
  });

  it("NEGATIVE CONTROL: trendUp false is rejected", async () => {
    const r = await run("L-6e.4", "retention.json", { ...live("retention.json"), trendUp: false });
    expect(r.status).toBe(STATUS.FAIL);
  });

  it("the shipped artifacts carry their controls, so the next reader can re-run them", () => {
    const dead = live("deadtime.json") as { control: { what: string; maxGapMs: number } };
    expect(dead.control.what).toMatch(/emptyBoardFastPath/);
    expect(dead.control.maxGapMs).toBeGreaterThan(2000);
    const ret = live("retention.json") as {
      controls: { flatLearner: { what: string }; noInterleave: { what: string } };
    };
    expect(ret.controls.flatLearner.what).toMatch(/coldRecognitionMs/);
    expect(ret.controls.noInterleave.what).toMatch(/noRetention/);
  });
});

describe("V-22.4 can fail: silhouette separation", () => {
  /** The shape the position-anchored probe writes, healthy. */
  const healthy = () => ({
    measure: "tests/gauntlet/silhouette.mjs measureSilhouettes",
    negativeControl:
      "tests/unit/gauntlet/silhouette.test.ts — the vignette applied to a synthetic frame drives this measure to 0.000 while the superseded Otsu measure reports ~0.27",
    frames: 5,
    objectsMeasured: 10,
    shipReadings: 5,
    unmeasurable: [],
    byBand: { top: { n: 3, min: 0.31 }, middle: { n: 4, min: 0.22 }, bottom: { n: 3, min: 0.44 } },
    minSeparation: 0.22,
    weakest: { id: "rock-0-dust", separation: 0.22 },
  });

  it("passes a capture where every object separates from its background", async () => {
    const r = await run("V-22.4", "desaturated-silhouettes.json", healthy());
    expect(r.status).toBe(STATUS.PASS);
  });

  it("NEGATIVE CONTROL: the contour count that shipped first is rejected", async () => {
    // `{"contours": 14}` — no producer, no method, no objects. It passed a
    // [3, 60] window for two rounds.
    const r = await run("V-22.4", "desaturated-silhouettes.json", { contours: 14 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("cannot answer AC-22.4");
  });

  it("NEGATIVE CONTROL: an artifact from the adaptive Otsu measure is rejected on provenance", async () => {
    // This is the false pass being closed. The NUMBER is healthy — 0.239 is
    // four times the bar — and it is the number that measure produced on a
    // frame whose play area had been crushed flat. Reject the method, not the
    // number, because no threshold can tell those two apart.
    const r = await run("V-22.4", "desaturated-silhouettes.json", {
      method: "desaturate, Otsu threshold, connected components in an object-sized area band",
      minSeparation: 0.239,
      regionsMeasured: 40,
      objectsMeasured: 40,
      frames: 5,
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("Otsu segmentation cannot answer");
  });

  it("NEGATIVE CONTROL: an artifact with no re-runnable control is rejected", async () => {
    const d = healthy() as Record<string, unknown>;
    delete d.negativeControl;
    const r = await run("V-22.4", "desaturated-silhouettes.json", d);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("re-runnable negative control");
  });

  it("NEGATIVE CONTROL: a capture that never located the ship is rejected", async () => {
    // AC-22.4 names the rocket as well as the asteroids, and the measure this
    // replaces could not find either.
    const r = await run("V-22.4", "desaturated-silhouettes.json", { ...healthy(), shipReadings: 2 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("names the rocket");
  });

  it("NEGATIVE CONTROL: an almost-empty sky is rejected", async () => {
    const r = await run("V-22.4", "desaturated-silhouettes.json", { ...healthy(), objectsMeasured: 4 });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("the belt was empty");
  });

  it("NEGATIVE CONTROL: a minimum taken over what happened to be measurable is rejected", async () => {
    const r = await run("V-22.4", "desaturated-silhouettes.json", {
      ...healthy(),
      unmeasurable: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("is not a minimum");
  });

  it("NEGATIVE CONTROL: one object that dissolved into its background is rejected", async () => {
    const r = await run("V-22.4", "desaturated-silhouettes.json", {
      ...healthy(),
      minSeparation: 0.002,
      weakest: { id: "ship", separation: 0.002 },
    });
    expect(r.status).toBe(STATUS.FAIL);
  });

  it("the live capture reflects the current art, whatever that is", async () => {
    // THIS TEST USED TO ASSERT `status === FAIL`. It was pinned to a defect - a
    // rock read 0.373 at the top of the frame and 0.0002 crossing the
    // near-terrain band, inside 101.1 against outside 101.1 - and the art lane
    // then FIXED it, raising debris clearance to 0.085-0.700 against a 0.06
    // bar. So the test went red for the defect being repaired.
    //
    // A test that fails when the thing it describes gets better is a tripwire
    // on progress, not a check. The same shape was removed from
    // tests/unit/tickets/tickets.test.ts earlier tonight for the same reason.
    //
    // What is worth asserting is that the item still READS the live artifact
    // and still reports a per-band measurement, so the check cannot quietly
    // stop measuring. Whether that measurement passes is the art's business and
    // the rubric's verdict, not this test's.
    const r = await run("V-22.4", "desaturated-silhouettes.json", live("desaturated-silhouettes.json"));
    expect([STATUS.PASS, STATUS.FAIL]).toContain(r.status);
    expect(r.detail).toContain("by band");
  });
});
