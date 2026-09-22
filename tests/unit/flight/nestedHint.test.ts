import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NESTED_MAX_LIVE,
  NESTED_STOPS,
  isNestedStop,
  nestedShareFor,
  shouldWarnNested,
} from "@engine/nested/index.js";
import * as engineNested from "@engine/nested/index.js";
import { rockHintFits, rockOnScreen, type RockHintView } from "@engine/hint/index.js";
import { STOP_IDS, stageIndexOf, type StopId } from "@engine/types.js";
import { NESTED_HINT_KEY, createFlightCopy, hintLead } from "@game/flight/copy.js";
import { estimateSpeechMs } from "@game/audio/voice.js";

/**
 * UR-148: Shadow warns about a two-layer rock once, the first time a child
 * meets one. Same mechanism as the canister hint (UR-146) - the decision is in
 * the engine under the coverage gate, and `@engine/hint` owns the two questions
 * both features ask.
 *
 *   npx vitest run tests/unit/flight/nestedHint.test.ts --coverage.enabled=false
 */

const SCENE = join(process.cwd(), "src/game/scenes/FlightScene.ts");
const flightScene = (): string => readFileSync(SCENE, "utf8");

const visible = (over: Partial<RockHintView> = {}): RockHintView => ({
  centreY: 300,
  sizePx: 160,
  viewportHeight: 1080,
  msToBreach: 9000,
  ...over,
});

const warn = (
  over: Partial<Parameters<typeof shouldWarnNested>[0]> = {},
): boolean =>
  shouldWarnNested({
    stopId: "neptune",
    saidThisRun: false,
    leadMs: 2105,
    nested: visible(),
    ...over,
  });

describe("UR-148: the warning rule is the engine's, built on the shared hint gate", () => {
  it("the scene owns no copy of the decision", () => {
    // WATCHED FAILING with the gates inlined into `maybeWarnNested`:
    //   expected 'import Phaser from "phaser";\n…' to contain 'shouldWarnNested({'
    const source = flightScene();
    expect(source).toContain("shouldWarnNested({");
  });

  it("there is ONE visibility rule, not one per feature", () => {
    // The coordinator's instruction, as an assertion: a second
    // `nestedOnScreen` would drift from the canister's the first time either
    // moved. Both features call `@engine/hint`.
    expect(Object.keys(engineNested)).not.toContain("nestedOnScreen");
    const rule = readFileSync(
      join(process.cwd(), "src/engine/nested/index.ts"),
      "utf8",
    );
    expect(rule).toContain('from "../hint/index.js"');
    expect(rule).toContain("rockHintFits(input.nested, input.leadMs)");
  });
});

describe("UR-148 gate: the stop", () => {
  /**
   * `isNestedStop`, not `stopId === "neptune"`. Naming the stop here is a
   * second copy of the decision `NESTED_STOPS` already holds, and it goes
   * silently wrong the day the route changes - the warning would fire at a stop
   * with no nested rocks, or never fire at all.
   */
  it("neptune IS where a child meets one first, and that is derived not asserted", () => {
    // WATCHED FAILING with `NESTED_STOPS` reordered to ["pluto", "neptune"]:
    //   expected 'pluto' to be 'neptune'
    const byRoute = [...NESTED_STOPS].sort((a, b) => stageIndexOf(a) - stageIndexOf(b));
    expect(byRoute[0]).toBe("neptune");
    expect(nestedShareFor("neptune")).toBeGreaterThan(0);
  });

  it("no stop before it warns, because no stop before it nests", () => {
    for (const stop of STOP_IDS) {
      const fires = warn({ stopId: stop });
      expect(fires, stop).toBe(isNestedStop(stop));
    }
  });

  it("an unknown stop is not warned about", () => {
    expect(warn({ stopId: "moon" as StopId })).toBe(false);
  });
});

describe("UR-148 gate: a nested rock is live, visible and still nameable", () => {
  it("no nested rock on the board, nothing to warn about", () => {
    // WATCHED FAILING with the `input.nested === null` check removed:
    //   TypeError: Cannot read properties of null (reading 'sizePx')
    expect(warn({ nested: null })).toBe(false);
  });

  it("a rock still sliding in past the top edge is not yet visible", () => {
    // AC-26.2 makes the shell the biggest rock on the belt, so it takes the
    // longest to arrive - which is exactly why this gate matters more here
    // than it does for a canister.
    expect(rockOnScreen(visible({ centreY: 79 }))).toBe(false);
    expect(rockOnScreen(visible({ centreY: 80 }))).toBe(true);
    expect(warn({ nested: visible({ centreY: 40 }) })).toBe(false);
  });

  it("a rock that will be gone before it has been named gets no warning", () => {
    expect(warn({ leadMs: 2105, nested: visible({ msToBreach: 2104 }) })).toBe(false);
    expect(warn({ leadMs: 2105, nested: visible({ msToBreach: 2105 }) })).toBe(true);
  });

  it("is exactly the shared gate, with nothing added", () => {
    // If the two ever disagree, one of the features has grown a private rule.
    for (const centreY of [-100, 0, 80, 500, 1000, 1200]) {
      for (const msToBreach of [0, 1000, 2105, 9000]) {
        const view = visible({ centreY, msToBreach });
        expect(warn({ nested: view }), `${centreY}/${msToBreach}`).toBe(
          rockHintFits(view, 2105),
        );
      }
    }
  });
});

describe("UR-148 gate: ONCE PER RUN", () => {
  it("a run that has already heard it does not hear it again", () => {
    expect(warn({ saidThisRun: true })).toBe(false);
  });

  it("the flag lives on the Phaser registry, not on the scene", () => {
    /**
     * PER RUN, NOT PER BELT AND NOT PERSISTED.
     *
     *   per BELT - `init` resets the scene on every belt and on every restart,
     *     so the same sentence would land on each of the four or five Neptune
     *     and Pluto belts a route contains;
     *   PERSISTED - needs a profile schema field and a writer, and this project
     *     has a documented history of persisted state with no writer (the
     *     twelve trophies, the trophy toast). The cost of getting it wrong is a
     *     child hearing one extra sentence on a later day.
     *
     * The registry is the run: it outlives the scene, so it survives a stall
     * restart and the trip to Pluto, and a fresh page is a fresh run.
     *
     * WATCHED FAILING with the flag moved to a scene field and reset in
     * `init`:
     *   expected 'import Phaser from "phaser";\n…' to contain
     *   'this.registry.set(NESTED_HINT_REGISTRY_KEY, true)'
     */
    const source = flightScene();
    expect(source).toContain("this.registry.set(NESTED_HINT_REGISTRY_KEY, true)");
    expect(source).toContain('const NESTED_HINT_REGISTRY_KEY = "kb.flight.nestedHintSaid"');
    // And `init` - the per-belt reset - does not clear it. The canister's flag
    // is right there being cleared, which is what makes the contrast checkable.
    const init = /init\(data[\s\S]*?\n {2}\}/.exec(source)?.[0];
    expect(init, "init is gone").toBeDefined();
    expect(init).toContain("this.canisterHintSaid = false;");
    expect(init).not.toContain("NESTED_HINT_REGISTRY_KEY");
    // Claimed before the bus call, so a throw between the two cannot say it twice.
    expect(source).toMatch(
      /this\.registry\.set\(NESTED_HINT_REGISTRY_KEY, true\);[\s\S]{0,200}audioFrom\(this\.registry\)\?\.speak\(/,
    );
  });
});

describe("UR-148: what the scene asks about", () => {
  it("the check runs in the flight update loop", () => {
    expect(flightScene()).toContain("this.maybeWarnNested(time);");
  });

  it("it asks about a rock whose SHELL IS STILL INTACT", () => {
    // `crackShell` sets `rock.core = null`, so after the break the sentence is
    // no longer true - the child is looking at an ordinary rock with a word on
    // it, and being told it has two layers would be wrong rather than late.
    //
    // WATCHED FAILING with the selector written as `r.core !== null ||
    // r.crackedShellWord !== null`:
    //   expected 'import Phaser from "phaser";\n…' to match
    //   /this\.rocks\.find\(\(r\) => !r\.resolved && r\.core !== null\)/
    expect(flightScene()).toMatch(
      /this\.rocks\.find\(\(r\) => !r\.resolved && r\.core !== null\)/,
    );
  });

  it("AC-26: at most one nested rock is live, so 'that rock' is unambiguous", () => {
    // The canister hint has to name its rock by colour because several rocks
    // are on the board; this one can say "that rock" because the engine
    // guarantees there is only ever one.
    expect(NESTED_MAX_LIVE).toBe(1);
  });

  it("D41 / AC-19.3: reduced motion does not silence it", () => {
    // WATCHED FAILING with `if (this.cfg.reducedMotion) return;` at the top of
    // `maybeWarnNested`:
    //   expected 'private maybeWarnNested(now: number)…' not to contain
    //   'reducedMotion'
    const body = /private maybeWarnNested\([\s\S]*?\n {2}\}/.exec(flightScene())?.[0];
    expect(body, "maybeWarnNested is gone").toBeDefined();
    expect(body).not.toContain("reducedMotion");
    expect(body).not.toContain("calm");
  });
});

describe("UR-148: the sentence itself", () => {
  const copy = (lang: "en" | "es" | "hi"): string =>
    createFlightCopy(lang, { shipName: "Lantern" }).t(NESTED_HINT_KEY);

  it("carries both halves: there is a rock inside, and it has its own word", () => {
    const en = copy("en").toLowerCase();
    expect(en).toContain("two layers");
    expect(en).toContain("word");
    expect(en).toContain("inside");
  });

  it("is plain enough for a seven-year-old", () => {
    const en = copy("en");
    const words = en.split(/\s+/).filter(Boolean);
    expect(words.length, en).toBeLessThanOrEqual(12);
    const long = words.map((w) => w.replace(/[^a-zA-Z]/g, "")).filter((w) => w.length > 6);
    expect(long, `long words in ${JSON.stringify(en)}`).toEqual([]);
  });

  it("D31: it is a heads-up, not a threat", () => {
    const words = new Set(copy("en").toLowerCase().split(/[^a-z']+/).filter(Boolean));
    for (const banned of ["hurry", "quick", "danger", "warning", "hard", "tricky", "careful", "lose", "fail"]) {
      expect([...words], banned).not.toContain(banned);
    }
  });

  it("every shipped language carries it", () => {
    for (const lang of ["en", "es", "hi"] as const) {
      expect(copy(lang).trim().length, lang).toBeGreaterThan(20);
    }
    expect(copy("es")).not.toBe(copy("en"));
    expect(copy("hi")).not.toBe(copy("en"));
  });

  it("the lead fits inside a nested rock's fall", () => {
    /**
     * A nested pair is granted the SUM of the two words' FR-8 budgets
     * (`nestedFallMs`), so it is the longest-falling rock on the belt and the
     * budget here is looser than the canister's. The bar is still the
     * canister's 2300 ms, because a rule that only works for the biggest rock
     * is a rule waiting to break.
     *
     * WATCHED FAILING with the whole line used as the lead:
     *   the lead needs 5053 ms of fall: expected 5053 to be less than 2300
     */
    const lead = estimateSpeechMs(hintLead(copy("en")));
    expect(lead, `the lead needs ${lead.toFixed(0)} ms of fall`).toBeLessThan(2300);
  });

  it("the clip id IS the table key", () => {
    expect(NESTED_HINT_KEY).toBe("flight.nestedHint");
    expect(flightScene()).toContain("id: NESTED_HINT_KEY,");
    expect(flightScene()).not.toContain('id: "flight.nestedHint"');
  });
});
