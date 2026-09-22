import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hullForStage,
  hullIsDamaged,
  maySpawnCanister,
  shouldHintCanister,
  startingHull,
  rockOnScreen,
  type RockHintView,
} from "@game/flight/shield.js";
import * as engineHull from "@engine/hull/index.js";
import * as engineHint from "@engine/hint/index.js";
import { HULL_PASS_COST, HULL_STRIKE_COST } from "@engine/hull/index.js";
import { CANISTER_HINT_KEY, hintLead, createFlightCopy } from "@game/flight/copy.js";
import { estimateSpeechMs } from "@game/audio/voice.js";

/**
 * UR-146: Shadow points at the repair rock, once per belt. The rules are the
 * feature, not the sentence, so each gate gets its own negative control.
 *
 *   npx vitest run tests/unit/flight/canisterHint.test.ts --coverage.enabled=false
 */

const SCENE = join(process.cwd(), "src/game/scenes/FlightScene.ts");
const flightScene = (): string => readFileSync(SCENE, "utf8");

/** The shipped belt: 58 words, six marks (C26). */
const MAX_HULL = hullForStage(58);
const FULL_HULL = startingHull(58);

/** A canister squarely in the middle of a 1080-tall frame, with time to spare. */
const reachable = (over: Partial<RockHintView> = {}): RockHintView => ({
  centreY: 300,
  sizePx: 120,
  viewportHeight: 1080,
  msToBreach: 9000,
  ...over,
});

const hint = (
  over: Partial<Parameters<typeof shouldHintCanister>[0]> = {},
): boolean =>
  shouldHintCanister({
    hull: MAX_HULL - 1,
    maxHull: MAX_HULL,
    saidThisBelt: false,
    leadMs: 2950,
    canister: reachable(),
    ...over,
  });

describe("UR-146: the hint rule is the engine's, reachable through the seam", () => {
  it("is re-exported rather than restated", () => {
    // A second implementation lets scene and tests disagree with nothing red.
    expect(shouldHintCanister).toBe(engineHull.shouldHintCanister);
    expect(hullIsDamaged).toBe(engineHull.hullIsDamaged);
    expect(rockOnScreen).toBe(engineHint.rockOnScreen);
  });

  it("the scene owns no copy of the decision", () => {
    // WATCHED FAILING with the four gates inlined into `maybeHintCanister`:
    //   expected 'import Phaser from "phaser";\n…' to contain 'shouldHintCanister({'
    const source = flightScene();
    expect(source).toContain("shouldHintCanister({");
    // No hand-rolled hull comparison and no hand-rolled viewport test.
    expect(source).not.toMatch(/canisterHintSaid\s*=\s*true[\s\S]{0,400}hullMarksLit\(/);
  });
});

describe("UR-146 gate 2: ONLY WHEN THE PLAYER IS ACTUALLY DAMAGED", () => {
  /**
   * The predicate is `hullMarksLit(hull, maxHull) < maxHull` - the second half
   * of `maySpawnCanister`. `hull < maxHull` fires on half a mark of pass-by
   * damage (UR-91) that does not open the spawn gate; `hull <= maxHull - 2`
   * invents a second threshold nobody wrote down.
   */
  it("a full hull is never told about a repair", () => {
    // WATCHED FAILING with the damage gate deleted from `shouldHintCanister`:
    //   expected true to be false // Object.is equality
    expect(hint({ hull: FULL_HULL, maxHull: MAX_HULL })).toBe(false);
    expect(hullIsDamaged(FULL_HULL, MAX_HULL)).toBe(false);
  });

  it("one whole mark of damage is damaged", () => {
    expect(hullIsDamaged(MAX_HULL - HULL_STRIKE_COST, MAX_HULL)).toBe(true);
    expect(hint({ hull: MAX_HULL - HULL_STRIKE_COST })).toBe(true);
  });

  it("UR-91: half a mark of pass-by damage is NOT, at any hull size", () => {
    // `hullMarksLit` ceils, so 5.5 of 6 reads as full - and so does the gate.
    for (const spawnCount of [18, 30, 58, 100, 200]) {
      const cap = hullForStage(spawnCount);
      const grazed = cap - HULL_PASS_COST;
      expect(hullIsDamaged(grazed, cap), `${spawnCount} words`).toBe(false);
      expect(maySpawnCanister(grazed, cap, false), `${spawnCount} words`).toBe(false);
    }
  });

  it("is the same predicate the spawn gate uses, at every hull the game ships", () => {
    // WATCHED FAILING with `hullIsDamaged` written as `hull < maxHull`:
    //   18 words at hull 2.5: expected true to be false // Object.is equality
    for (const spawnCount of [18, 30, 58, 100, 200]) {
      const cap = hullForStage(spawnCount);
      for (let hull = 0; hull <= cap; hull += 0.5) {
        expect(
          hullIsDamaged(hull, cap),
          `${spawnCount} words at hull ${hull}`,
        ).toBe(maySpawnCanister(hull, cap, false));
      }
    }
  });
});

describe("UR-146 gate 3: ONLY WITH THE CANISTER ON SCREEN", () => {
  it("no canister on the board, nothing to point at", () => {
    expect(hint({ canister: null })).toBe(false);
  });

  it("a rock still sliding in past the top edge is not yet on screen", () => {
    // Rocks spawn at `-sizePx`; "the top has appeared" is true for most of the
    // slide, and the ring the sentence is about IS the outline.
    //
    // WATCHED FAILING with the test written as `centreY >= 0`:
    //   expected true to be false // Object.is equality
    expect(rockOnScreen(reachable({ centreY: -120 }))).toBe(false);
    expect(rockOnScreen(reachable({ centreY: 0 }))).toBe(false);
    expect(rockOnScreen(reachable({ centreY: 59 }))).toBe(false);
    expect(rockOnScreen(reachable({ centreY: 60 }))).toBe(true);
    expect(hint({ canister: reachable({ centreY: 30 }) })).toBe(false);
  });

  it("a rock hanging off the bottom edge is not on screen either", () => {
    expect(rockOnScreen(reachable({ centreY: 1021 }))).toBe(false);
    expect(rockOnScreen(reachable({ centreY: 1020 }))).toBe(true);
  });

  it("a rock with no position at all is not on screen", () => {
    expect(rockOnScreen(reachable({ centreY: Number.NaN }))).toBe(false);
    expect(hint({ canister: reachable({ centreY: Number.NaN }) })).toBe(false);
  });

  it("a zero-size rock is judged on its centre alone rather than crashing", () => {
    expect(rockOnScreen(reachable({ centreY: 0, sizePx: 0 }))).toBe(true);
    expect(rockOnScreen(reachable({ centreY: -1, sizePx: -40 }))).toBe(false);
  });
});

describe("UR-146 gate 4: THE ROCK IS STILL THERE WHEN IT HAS BEEN NAMED", () => {
  /**
   * THE HINT TEACHES, IT DOES NOT RESCUE. The first draft of this gate was
   * `max(whole line, clearEstimateMs + 500)` and an e2e on a real canvas found
   * it did not fire. Measured on the belt at the shipped calibration:
   *
   *     word          fallMs   clearEstimateMs   left when fully on screen
   *     ice            3962          2920                  3616
   *     ring           4221          3270                  3803
   *     shield         5043          3970                  4429
   *     shieldword     8038          5370                  6712
   *
   * The 11-word line needed 4632 ms, more than three of those four have left;
   * and `clearEstimateMs` is 67-79% of `fallMs` by construction. So the gate is
   * the LEAD CLAUSE: the rock has to outlive the words that name it.
   */
  it("a canister that will be gone before it has been named gets no sentence", () => {
    // WATCHED FAILING with the `msToBreach` comparison removed:
    //   expected true to be false // Object.is equality
    expect(hint({ leadMs: 2950, canister: reachable({ msToBreach: 2949 }) })).toBe(false);
    expect(hint({ leadMs: 2950, canister: reachable({ msToBreach: 2950 }) })).toBe(true);
  });

  it("a rock with no clock, or a line with no length, is not hinted", () => {
    expect(hint({ canister: reachable({ msToBreach: Number.NaN }) })).toBe(false);
    expect(hint({ leadMs: Number.NaN })).toBe(false);
  });

  it("a negative lead is treated as no lead rather than as credit", () => {
    expect(hint({ leadMs: -5000, canister: reachable({ msToBreach: 0 }) })).toBe(true);
  });

  it("the lead clause is the sentence that names the rock", () => {
    const en = createFlightCopy("en", { shipName: "Lantern" }).t(CANISTER_HINT_KEY);
    const lead = hintLead(en);
    expect(lead.toLowerCase()).toContain("gold ring");
    expect(lead.length).toBeLessThan(en.length);
    // Total: a line with no full stop is its own lead rather than empty.
    expect(hintLead("no stop here")).toBe("no stop here");
    expect(hintLead("  spaced. tail  ")).toBe("spaced.");
  });

  it("the lead fits inside a belt's ordinary fall budget", () => {
    /**
     * The copy decision has a gameplay cost: the lead is spent out of the
     * canister's fall. The shortest fall the game hands out is 2500 ms
     * (`@engine/fallTime`), and a rock is fully on screen with roughly 85-93%
     * of that left, so the bar is 2300.
     *
     * WATCHED FAILING with the whole line used as the lead:
     *   the lead needs 3368 ms of fall: expected 3368 to be less than 2300
     * and with the 11-word first draft ("Blast the rock with the gold ring. It
     * fixes our shield."), whose lead alone is seven words:
     *   the lead needs 2947 ms of fall: expected 2947 to be less than 2300
     */
    const text = createFlightCopy("en", { shipName: "Lantern" }).t(CANISTER_HINT_KEY);
    const lead = estimateSpeechMs(hintLead(text));
    expect(lead, `the lead needs ${lead.toFixed(0)} ms of fall`).toBeLessThan(2300);
  });
});

describe("UR-146 gate 1: ONCE PER BELT", () => {
  it("a belt that has already heard it does not hear it again", () => {
    expect(hint({ saidThisBelt: true })).toBe(false);
  });

  it("the flag is per ATTEMPT: `init` clears it, and nothing else sets it false", () => {
    /**
     * Once per belt: per CANISTER is the same sentence four times in ninety
     * seconds (D62's repetition fatigue); per RUN is one mention forty minutes
     * ago. `init` is the per-attempt reset (AC-4.3). Asserted on the source
     * because the reset lives in a Phaser hook this lane does not boot.
     *
     * WATCHED FAILING with the reset line deleted from `init`:
     *   expected 'import Phaser from "phaser";\n…' to match
     *   /init\(data[\s\S]*?this\.canisterHintSaid = false;[\s\S]*?\n  \}/
     */
    const source = flightScene();
    expect(source).toMatch(
      /init\(data[\s\S]*?this\.canisterHintSaid = false;[\s\S]*?\n {2}\}/,
    );
    // Exactly one place clears it, and exactly one place sets it.
    expect(source.match(/this\.canisterHintSaid = false;/g)).toHaveLength(1);
    expect(source.match(/this\.canisterHintSaid = true;/g)).toHaveLength(1);
    // And it is claimed BEFORE the bus call, so a throw between the two cannot
    // say it twice.
    expect(source).toMatch(
      /this\.canisterHintSaid = true;[\s\S]{0,200}audioFrom\(this\.registry\)\?\.speak\(/,
    );
  });
});

describe("UR-146: the scene asks on every frame, and asks about the LIVE canister", () => {
  it("the check runs in the flight update loop", () => {
    const source = flightScene();
    expect(source).toContain("this.maybeHintCanister(time);");
  });

  it("it reads the rock the board says is the canister", () => {
    // `canisterId` is the rock the spawner promoted; AC-5.1 allows one live.
    const source = flightScene();
    expect(source).toMatch(/const id = this\.canisterId;/);
    expect(source).toMatch(/this\.rocks\.find\(\(r\) => r\.id === id\)/);
  });

  it("D41 / AC-19.3: reduced motion does not silence it", () => {
    /**
     * A cue may lose movement, never the information - and there is no movement
     * in a sentence to lose. Asserts the absence of the obvious shortcut.
     *
     * WATCHED FAILING with `if (this.cfg.reducedMotion) return;` added to the
     * top of `maybeHintCanister`:
     *   expected 'private maybeHintCanister(now: number)…' not to contain
     *   'reducedMotion'
     */
    const body = /private maybeHintCanister\([\s\S]*?\n {2}\}/.exec(flightScene())?.[0];
    expect(body, "maybeHintCanister is gone").toBeDefined();
    expect(body).not.toContain("reducedMotion");
    expect(body).not.toContain("calm");
  });
});

describe("UR-146: the sentence itself", () => {
  const copy = (lang: "en" | "es" | "hi"): string =>
    createFlightCopy(lang, { shipName: "Lantern" }).t(CANISTER_HINT_KEY);

  it("names the gold ring, the blast, and what it buys", () => {
    // Which rock, what to do, and why. Missing one of the three is decoration.
    const en = copy("en").toLowerCase();
    expect(en).toContain("gold ring");
    expect(en).toContain("blast");
    expect(en).toContain("shield");
  });

  it("is short enough and plain enough for a seven-year-old", () => {
    const en = copy("en");
    const words = en.split(/\s+/).filter(Boolean);
    expect(words.length, en).toBeLessThanOrEqual(9);
    // No word over six letters: it is heard while typing a different word.
    const long = words.map((w) => w.replace(/[^a-zA-Z]/g, "")).filter((w) => w.length > 6);
    expect(long, `long words in ${JSON.stringify(en)}`).toEqual([]);
  });

  it("D31: it is an offer, never an instruction with a threat in it", () => {
    // Whole words: `blast` contains `last`, and the first version reported
    // "last: expected 'blast the rock with the gold ring. it fixes our
    // shield.' not to contain 'last'". The assertion's error, not the copy's -
    // fixed by tokenising rather than by shortening the banned list.
    const words = new Set(
      copy("en")
        .toLowerCase()
        .split(/[^a-z']+/)
        .filter(Boolean),
    );
    for (const banned of ["hurry", "quick", "quickly", "before", "lose", "lost", "die", "fail", "wrong", "last", "danger", "warning"]) {
      expect([...words], banned).not.toContain(banned);
    }
  });

  it("every shipped language carries it", () => {
    // AC-14.3: a one-language table is a hard-coded English string.
    for (const lang of ["en", "es", "hi"] as const) {
      expect(copy(lang).trim().length, lang).toBeGreaterThan(20);
    }
    expect(copy("es")).not.toBe(copy("en"));
    expect(copy("hi")).not.toBe(copy("en"));
  });

  it("the clip id IS the table key, so the render script and the game agree", () => {
    // A scene with its own copy of the string is how 28 renders went unreachable.
    expect(CANISTER_HINT_KEY).toBe("flight.canisterHint");
    expect(flightScene()).toContain("id: CANISTER_HINT_KEY,");
    expect(flightScene()).not.toContain('id: "flight.canisterHint"');
  });
});
