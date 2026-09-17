import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { RUBRIC, STATUS, offTreeScenes, sceneCompleteness } from "../../gauntlet/rubric.mjs";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { TEST_EXEMPT, runTraceCheck } from "../../../scripts/trace-check.mjs";

/**
 * NEGATIVE CONTROLS for the two traceability rubric items (G-scenes, G-trace).
 *
 * Both were GREEN and neither measured its claim:
 *
 *   G-scenes had NO FAILING BRANCH AT ALL. It returned `todo` on an empty
 *   directory and `ok` on anything else, deferred row-matching to G-trace, and
 *   reported 27 scenes where boot.ts registers 17 - it walked lib/ and support/
 *   and counted the helpers as screens.
 *
 *   G-trace ran `scripts/trace-check.mjs` with no flag and reported PASS while
 *   the line it printed as its own evidence read "97/106 cited by a real test
 *   (9 not yet)". The --strict flag that turns that into a failure was never
 *   passed, and the linkage behind the count was a substring scan, so an AC
 *   named in a COMMENT counted as covered.
 *
 * Every test below therefore reintroduces the specific defect and asserts the
 * check goes RED. Re-run with:
 *
 *   npx vitest run tests/unit/gauntlet --coverage.enabled=false
 */

const REPO = resolve(__dirname, "../../..");
const temps: string[] = [];

/**
 * A scratch copy of just the files the scene relations read, so a defect can be
 * introduced without touching the repo. Callers mutate it and re-run the check.
 */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-scene-"));
  temps.push(dir);
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "src/game/scenes"), { recursive: true });
  cpSync(join(REPO, "docs/design-brief-v2.md"), join(dir, "docs/design-brief-v2.md"));
  cpSync(join(REPO, "src/game/sceneKeys.ts"), join(dir, "src/game/sceneKeys.ts"));
  cpSync(join(REPO, "src/game/scenes"), join(dir, "src/game/scenes"), { recursive: true });
  return dir;
}

const edit = (dir: string, rel: string, fn: (src: string) => string): void => {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, "utf8")));
};

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe("G-scenes: D78 is asserted here, not deferred to a check that passes anyway", () => {
  it("G-scenes counts the scenes boot.ts registers, not every .ts under scenes/", () => {
    // The original number was 27 because `walk` recursed into lib/ and
    // support/. boot.ts globs ./scenes/*.ts, top level only, so 17 is the
    // number both this item and trace-check must agree on.
    const r = sceneCompleteness(REPO);
    expect(r.status).toBe(STATUS.PASS);
    expect(r.detail).toMatch(/^17 scenes,/);
    expect(runTraceCheck({ repo: REPO }).counts.scenes).toBe(17);
  });

  it("NEGATIVE CONTROL: a scene file with no inventory row fails", () => {
    const dir = scratchRepo();
    writeFileSync(join(dir, "src/game/scenes/SmugglerScene.ts"), "export class SmugglerScene {}\n");
    const r = sceneCompleteness(dir);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("Smuggler has no SCENE_INVENTORY_ROW entry");
  });

  it("NEGATIVE CONTROL: a scene mapped to the empty row \"\" with no reason fails", () => {
    // THE HOLE THIS CLOSES. trace-check skips an empty row outright, so before
    // this item asserted anything, mapping a scene to "" satisfied D78 while
    // claiming no screen and being asked for none.
    const dir = scratchRepo();
    edit(dir, "src/game/sceneKeys.ts", (s) => s.replace('Settings: "Settings",', 'Settings: "",'));
    const r = sceneCompleteness(dir);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain('Settings maps to the empty row ""');
  });

  it("NEGATIVE CONTROL: a row that is not in the design brief fails", () => {
    const dir = scratchRepo();
    edit(dir, "src/game/sceneKeys.ts", (s) =>
      s.replace('Settings: "Settings",', 'Settings: "Options and knobs",'),
    );
    const r = sceneCompleteness(dir);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain('Settings -> "Options and knobs"');
  });

  it("NEGATIVE CONTROL: an inventory row claimed by a scene that does not exist fails", () => {
    const dir = scratchRepo();
    rmSync(join(dir, "src/game/scenes/SettingsScene.ts"));
    const r = sceneCompleteness(dir);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("src/game/scenes has no Settings scene");
  });

  it("NEGATIVE CONTROL: an inventory row with no scene and no NON_SCENE_ROWS reason fails", () => {
    const dir = scratchRepo();
    edit(dir, "src/game/sceneKeys.ts", (s) =>
      s.replace(/^  Toasts: .*$/m, '  ToastsRenamed: "does not matter",'),
    );
    const r = sceneCompleteness(dir);
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("inventory rows with no scene and no NON_SCENE_ROWS reason");
    expect(r.detail).toContain("Toasts");
  });

  it("finds the one Phaser scene registered from outside src/game/scenes", () => {
    // LanternShotScene escaped D78 entirely: it is registered at boot.ts and
    // lives in render/, which relation 3 never looks at. It has a stated
    // reason, so it is named in OFF_TREE_SCENES rather than moved - but it is
    // now NAMED, which is the difference between an exemption and an escape.
    const found = offTreeScenes(REPO) as { name: string; rel: string }[];
    expect(found.map((f) => f.name)).toEqual(["LanternShotScene"]);
    expect(found[0]?.rel).toBe("src/game/render/lanternShot.ts");
  });

  it("an abstract scene base outside scenes/ is not an escape and is not flagged", () => {
    // src/game/ui/MenuScene.ts is `abstract class MenuScene extends
    // Phaser.Scene`. It cannot be registered, so it cannot escape anything,
    // and it must not need a waiver - that would train people to add waivers.
    expect((offTreeScenes(REPO) as { name: string }[]).some((f) => f.name === "MenuScene")).toBe(false);
  });
});

describe("G-trace: the gauntlet runs --strict, and --strict counts assertions", () => {
  it("the G-trace rubric item passes --strict to trace-check", () => {
    // The whole defect in one line: the flag existed, trace-check's header
    // named it as "what the gauntlet runs", and rubric.mjs ran without it.
    const item = (RUBRIC as { id: string; run: (ctx: unknown) => Promise<unknown> }[]).find(
      (i) => i.id === "G-trace",
    );
    expect(item).toBeDefined();
    let seen: string[] = [];
    const runNode = async (args: string[]) => {
      seen = args;
      return { code: 0, stdout: "  AC->test:   105/105 asserted by a named test\ntrace-check OK (strict)", stderr: "" };
    };
    return item!.run({ repo: REPO, runNode }).then((r) => {
      expect(seen).toContain("--strict");
      expect((r as { status: string }).status).toBe(STATUS.PASS);
    });
  });

  it("NEGATIVE CONTROL: a non-zero trace-check exit makes G-trace red", async () => {
    const item = (RUBRIC as { id: string; run: (ctx: unknown) => Promise<{ status: string; detail: string }> }[]).find(
      (i) => i.id === "G-trace",
    )!;
    const runNode = async () => ({
      code: 1,
      stdout: "  AC->test:   95/105 asserted by a named test",
      stderr: "trace-check FAILED\n  - --strict: ACs with no test ASSERTING them: 10",
    });
    const r = await item.run({ repo: REPO, runNode });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("ACs with no test ASSERTING them");
  });

  it("NEGATIVE CONTROL: a trace-check that never ran cannot pass as green", async () => {
    // An exit code of 0 from a script that printed nothing is not a pass.
    const item = (RUBRIC as { id: string; run: (ctx: unknown) => Promise<{ status: string; detail: string }> }[]).find(
      (i) => i.id === "G-trace",
    )!;
    const r = await item.run({ repo: REPO, runNode: async () => ({ code: 0, stdout: "", stderr: "" }) });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.detail).toContain("did not run");
  });

  it("--strict is red today, and the count matches the escalation (escalated, not hidden)", () => {
    // DO NOT NAME THE UNCOVERED ACs IN THIS FILE. Writing one of their ids here would
    // make citationStrength grade it WEAK instead of NONE - a test file
    // asserting a coverage gap would close the gap it is asserting. Found the
    // hard way: the first draft of this test listed all ten and the NONE
    // bucket went empty. The ids live in gauntlet/escalations.md, and the
    // count is bound to that file so closing one forces the escalation to be
    // updated rather than left to rot.
    const r = runTraceCheck({ repo: REPO, strict: true });
    expect(r.failures.join(" ")).toContain("ACs with no test ASSERTING them");
    const doc = readFileSync(join(REPO, "gauntlet/escalations.md"), "utf8");
    const declared = doc.match(/<!--\s*G-trace-strict-unlinked:\s*(\d+)\s*-->/);
    expect(declared, "gauntlet/escalations.md must carry the G-trace-strict-unlinked marker").not.toBeNull();
    // ASYMMETRIC ON PURPOSE. The escalation may never UNDERSTATE the gap, so a
    // new AC arriving with no test turns this red. It may overstate after
    // another lane closes one, because going red because coverage improved is
    // a false alarm, and false alarms train people to edit the number without
    // reading it.
    expect(r.none.length + r.weak.length).toBeLessThanOrEqual(Number(declared![1]));
    expect(r.none.length).toBeGreaterThan(0);
  });

  it("non-strict stays green, so npm test is not turned red by this change", () => {
    expect(runTraceCheck({ repo: REPO, strict: false }).failures).toEqual([]);
  });

  it("NEGATIVE CONTROL: an AC cited only in a comment does NOT count under --strict", () => {
    // The substring scan this replaces counted exactly this as covered.
    const commentOnly = () => ({ level: "WEAK", files: ["tests/unit/x.test.ts"] });
    const r = runTraceCheck({ repo: REPO, strict: true, citations: commentOnly });
    expect(r.counts.strong).toBe(0);
    expect(r.failures.join(" ")).toContain("named only in prose");
  });

  it("every --strict exemption is explicit, reasoned, and kept out of both buckets", () => {
    // One entry today. The assertion is on the SHAPE - every exemption carries
    // a sentence of reason - rather than on the id, because naming ids in a
    // test file is what makes the grader read them as cited.
    const exemptions = Object.entries(TEST_EXEMPT as Record<string, string>);
    expect(exemptions.length).toBeLessThanOrEqual(1);
    for (const [id, why] of exemptions) {
      expect(why.length, `${id} needs a reason, not a waiver`).toBeGreaterThan(40);
      expect(runTraceCheck({ repo: REPO, strict: true }).none).not.toContain(id);
    }
  });
});
