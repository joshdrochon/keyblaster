import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HEAT_BONUS_MAX,
  HEAT_EVERY,
  HEAT_EXP,
  hasHeat,
  heatMultiplier,
  heatOf,
  heatStep,
  isHotRock,
  shouldWarnHot,
} from "@engine/heat/index.js";
import { STOP_IDS, type StopId } from "@engine/types.js";
import { type RockHintView } from "@engine/hint/index.js";
import { HOT_HINT_KEY, createFlightCopy, hintLead } from "@game/flight/copy.js";
import { estimateSpeechMs } from "@game/audio/voice.js";

/**
 * D110: a Mercury rock arrives hot and cools as it falls, and one in three is
 * hot rather than all of them. Shadow names it once per run.
 *
 *   npx vitest run tests/unit/flight/heat.test.ts --coverage.enabled=false
 */

const SCENE = join(process.cwd(), "src/game/scenes/FlightScene.ts");
const flightScene = (): string => readFileSync(SCENE, "utf8");

const visible = (over: Partial<RockHintView> = {}): RockHintView => ({
  centreY: 300,
  sizePx: 120,
  viewportHeight: 1080,
  msToBreach: 5000,
  ...over,
});

describe("D110: which stops carry heat", () => {
  it("Mercury alone", () => {
    const hot = STOP_IDS.filter((s) => hasHeat(s));
    expect(hot).toEqual(["mercury"]);
  });

  it("every other stop is untouched", () => {
    for (const stop of STOP_IDS.filter((s) => s !== "mercury")) {
      expect(isHotRock(stop, 0), stop).toBe(false);
      expect(isHotRock(stop, 3), stop).toBe(false);
    }
  });
});

describe("D110: one rock in three", () => {
  it("is strictly every third, not a roll of the dice", () => {
    const pattern = Array.from({ length: 12 }, (_, i) => (isHotRock("mercury", i) ? "H" : "."));
    expect(pattern.join("")).toBe("H..H..H..H..");
  });

  it("the ratio is exactly one in HEAT_EVERY over a long belt", () => {
    const n = 300;
    const hot = Array.from({ length: n }, (_, i) => isHotRock("mercury", i)).filter(Boolean).length;
    expect(hot).toBe(n / HEAT_EVERY);
  });

  it("junk is cold, never hot", () => {
    expect(isHotRock("mercury", Number.NaN)).toBe(false);
    expect(isHotRock("mercury", Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("the scene counts only the rocks that CAN be hot", () => {
    // A canister and a nested shell are drawn by their own painters and
    // `coolRock` repaints with `drawDebris`, so a hot canister would lose its
    // gold ring. Only plain rocks are eligible AND only they advance the cycle,
    // which is what keeps the ratio one in three whatever else the belt spawns.
    const src = flightScene();
    expect(src).toContain("const hotEligible = !isCanister && core === null;");
    expect(src).toContain("if (hotEligible) this.hotCycle += 1;");
  });
});

describe("D110: a hot rock cools as it falls", () => {
  it("full heat at spawn, none at the ship", () => {
    expect(heatOf(0)).toBe(1);
    expect(heatOf(1)).toBe(0);
  });

  it("sheds most of its heat early, which is where the decision is", () => {
    // At HEAT_EXP 1.8 a rock is down to a third by 40% of the drop.
    expect(heatOf(0.4)).toBeLessThan(0.42);
    expect(heatOf(0.4)).toBeGreaterThan(0.3);
    expect(HEAT_EXP).toBeGreaterThan(1);
  });

  it("is monotone: a rock never heats back up", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const h = heatOf(p);
      expect(h, `p=${p.toFixed(2)}`).toBeLessThanOrEqual(prev);
      prev = h;
    }
  });

  it("clamps outside the fall, and fails COLD on junk", () => {
    expect(heatOf(-1)).toBe(1);
    expect(heatOf(2)).toBe(0);
    expect(heatOf(Number.NaN)).toBe(0);
  });

  it("quantises to a colour channel, 0..255", () => {
    expect(heatStep(1)).toBe(255);
    expect(heatStep(0)).toBe(0);
    expect(heatStep(0.5)).toBe(128);
    expect(heatStep(Number.NaN)).toBe(0);
    expect(heatStep(9)).toBe(255);
  });

  it("the scene repaints a rock only when its heat has actually moved", () => {
    const src = flightScene();
    expect(src).toContain("if (step === rock.heatStep) return;");
    // Per ROCK, not per stop: two thirds of Mercury's belt must not repaint.
    expect(src).toContain("if (!rock.hot) return;");
  });
});

describe("D110: a hot rock is worth more, and a cold one is never worth less (D31)", () => {
  it("never below 1", () => {
    for (const h of [-5, 0, 0.5, 1, 9, Number.NaN]) {
      expect(heatMultiplier(h), `heat=${h}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("tops out at the declared bonus", () => {
    expect(heatMultiplier(1)).toBe(1 + HEAT_BONUS_MAX);
    expect(heatMultiplier(0)).toBe(1);
  });

  it("the bonus is gated on the ROCK, so a cold rock pays what it always paid", () => {
    expect(flightScene()).toContain("if (rock !== undefined && rock.hot) {");
  });
});

describe("D110: Shadow names the hot rock once per run", () => {
  it("waits for a hot rock that is on screen and still catchable", () => {
    expect(shouldWarnHot({ stopId: "mercury", saidThisRun: false, leadMs: 1200, hot: visible() })).toBe(true);
  });

  it("says nothing with no hot rock on the board", () => {
    expect(shouldWarnHot({ stopId: "mercury", saidThisRun: false, leadMs: 1200, hot: null })).toBe(false);
  });

  it("says nothing twice", () => {
    expect(shouldWarnHot({ stopId: "mercury", saidThisRun: true, leadMs: 1200, hot: visible() })).toBe(false);
  });

  it("says nothing at a stop with no heat", () => {
    for (const stop of STOP_IDS.filter((s) => s !== "mercury") as StopId[]) {
      expect(
        shouldWarnHot({ stopId: stop, saidThisRun: false, leadMs: 1200, hot: visible() }),
        stop,
      ).toBe(false);
    }
  });

  it("waits until the rock is WHOLLY in frame", () => {
    expect(
      shouldWarnHot({ stopId: "mercury", saidThisRun: false, leadMs: 1200, hot: visible({ centreY: 20 }) }),
    ).toBe(false);
  });

  it("does not start a line the rock will outlive", () => {
    expect(
      shouldWarnHot({ stopId: "mercury", saidThisRun: false, leadMs: 4000, hot: visible({ msToBreach: 900 }) }),
    ).toBe(false);
  });

  it("the clause that NAMES the rock fits the fall it is pointed at", () => {
    // The same budget the canister and nested hints are held to: only the lead
    // clause is gated, because a hint teaches rather than saves one rock.
    const copy = createFlightCopy("en", "Lantern");
    const lead = hintLead(copy.t(HOT_HINT_KEY));
    expect(lead).toBe("The red rocks are hot!");
    expect(estimateSpeechMs(lead)).toBeLessThan(3000);
  });

  it("the line names the colour, which is the thing on screen", () => {
    expect(createFlightCopy("en", "Lantern").t(HOT_HINT_KEY)).toContain("red");
  });

  it("is claimed on the registry, so a stall and a retry do not re-teach it", () => {
    const src = flightScene();
    expect(src).toContain('const HOT_HINT_REGISTRY_KEY = "kb.flight.hotHintSaid";');
    expect(src).toContain("this.registry.set(HOT_HINT_REGISTRY_KEY, true);");
    // Claimed BEFORE the bus call: a throw between the two would say it twice.
    const claim = src.indexOf("this.registry.set(HOT_HINT_REGISTRY_KEY, true);");
    const speak = src.indexOf("id: HOT_HINT_KEY", claim);
    expect(claim).toBeGreaterThan(0);
    expect(speak).toBeGreaterThan(claim);
  });
});
