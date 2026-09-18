import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOOSEN_BELOW,
  MAX_LIVE_MAX,
  MAX_LIVE_MIN,
  TIGHTEN_FLOOR,
  createController,
  decideStage,
  endStage,
  recordOutcome,
  type ControllerState,
  type SpawnOutcome,
} from "@engine/controller/index.js";
import { hullForStage } from "@engine/hull/index.js";
import { DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";

/**
 * UR-51: DOES THE CONTROLLER'S OUTPUT ACTUALLY REACH A BELT?
 *
 * ================== WHY THIS FILE IS SOURCE-LEVEL ==================
 * `docs/verification-gaps.md` instance 24: `endStage` computed the right knob,
 * `FlightScene` emitted it on `FLIGHT_EVENTS.stageComplete`, and `grep -rn
 * "FLIGHT_EVENTS.stageComplete" src/` returned ONE hit - the emit. No listener,
 * no profile field, and neither route into the flight screen passed `knobs`. So
 * `maxLive` was 2 on every belt of every run for every child, and **every test
 * of the controller passed**, because every test called it directly.
 *
 * That is the gap this file is aimed at, and it cannot be closed by testing the
 * controller harder. `FlightScene` imports Phaser, so a unit test cannot boot
 * it; the e2e that can is a different gate on a different machine. What is left
 * is the same instrument that FOUND the defect - a grep - written down as an
 * assertion so the next deletion is loud.
 *
 * ================== WHY `profileWriters` IS NOT ENOUGH ==================
 * It asks "does a writer for this field exist", and a writer nothing calls
 * satisfies it. Measured: deleting `persistStageKnobs(this, ...)` from
 * `FlightScene` leaves that guard entirely green, because the helper's own
 * definition inside `src/game` matches the liveness regex. The same hole covers
 * `words` and `calibration` - deleting BOTH of their FlightScene writes also
 * leaves it green. That is in gauntlet/escalations.md; the bar is not moved
 * here, a second check is added beside it.
 */

const ROOT = resolve(import.meta.dirname, "../../..");

/** Comments stripped, for the reason `profileWriters` strips them: prose about
 * a defect must not be able to satisfy the check that the defect is fixed. */
function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/.*$/gm, "");
}

const FLIGHT = source("src/game/scenes/FlightScene.ts");
const INIT = source("src/game/scenes/lib/init.ts");

describe("UR-51: the difficulty knob reaches the belt, and comes back", () => {
  it("reads something: FlightScene is found and is the scene under discussion", () => {
    // Guards the parse. Without it every assertion below passes vacuously the
    // day somebody renames or moves the file.
    expect(FLIGHT.length).toBeGreaterThan(10_000);
    expect(FLIGHT).toContain("class FlightScene");
    expect(INIT).toContain("export function persistStageKnobs");
    expect(INIT).toContain("export function storedKnobs");
  });

  it("UR-51: the belt OPENS on the knob the profile holds", () => {
    // WATCHED FAILING, with the real text: restore
    // `createController({ knobs: this.cfg.knobs })` and this goes red, which is
    // the shipped line that made `maxLive` 2 for every child - `cfg.knobs` is
    // `{}` on both routes into this scene.
    expect(FLIGHT).toMatch(/createController\(\{[\s\S]{0,200}?storedKnobs\(this\)/);
  });

  it("UR-51: the FALL BUDGET is sized by that knob", () => {
    // The half without which the pacing builds a queue out of rocks that cannot
    // survive it. WATCHED FAILING, with the real numbers: drop `knobs` from this
    // call in the simulation harness and a MEDIAN pilot stalls on 40 belts of
    // 40 at a hit rate of 0.214, and the fast pilot stalls 240 times in 240 on
    // the route.
    expect(FLIGHT).toMatch(/fallTimeMs\(\{[\s\S]{0,400}?knobs: this\.controller\.knobs/);
  });

  it("UR-51: the knob is WRITTEN at stage end and at a stall, not only computed", () => {
    // Two call sites, because a belt ends two ways and only one of them runs
    // `checkStageEnd`. WATCHED FAILING, with the real text: delete either call
    // and the matching assertion goes red while
    // `tests/unit/arch/profileWriters` stays green - which is why this exists.
    const calls = [...FLIGHT.matchAll(/persistStageKnobs\(this, this\.controller\.knobs\)/g)];
    expect(calls.length).toBe(2);
    // And each one sits in the method that owns that ending.
    const stall = /private beginStall\(\): void \{[\s\S]*?\n  \}/.exec(FLIGHT)?.[0] ?? "";
    const complete = /private checkStageEnd\(\): void \{[\s\S]*?\n  \}/.exec(FLIGHT)?.[0] ?? "";
    expect(stall).toContain("persistStageKnobs");
    expect(complete).toContain("persistStageKnobs");
  });

  it("UR-51: the MARGIN is reported with every outcome, or the knob never moves again", () => {
    /**
     * The same defect shape as the knob itself, one layer down. `endStage` now
     * throttles on `@engine/controller/margin` rather than on hit rate - a fast
     * pilot's hit rate is 1.0000 and a grade-2 pilot's 0.9521, four hundredths
     * of signal, which is why every child arrived at `MAX_LIVE_MAX` together.
     *
     * `recordOutcome`'s margin argument is OPTIONAL in the type, because the
     * engine cannot import the scene that supplies it. So the liveness question
     * is not "does the argument exist" but "does the scene pass it", and the
     * failure mode of a deleted call site is silent in exactly the way UR-51's
     * first defect was: the controller holds on "no-margin" for ever, the belt
     * never gets harder for anybody, and every unit test of the controller
     * still passes because they all call it directly.
     *
     * WATCHED FAILING, with the real text: drop the third argument from either
     * call and the matching assertion goes red while
     * `tests/unit/arch/profileWriters` and the whole engine suite stay green.
     */
    // Both resolutions of a spawn, by the method that owns each one.
    const blast = /private onBlast\([\s\S]*?\n  \}/.exec(FLIGHT)?.[0] ?? "";
    const retire = /private retireAtBreachLine\([\s\S]*?\n  \}/.exec(FLIGHT)?.[0] ?? "";
    expect(blast.length, "onBlast not found").toBeGreaterThan(200);
    expect(retire.length, "retireAtBreachLine not found").toBeGreaterThan(200);
    expect(blast).toMatch(/recordOutcome\(\s*this\.controller,\s*"blasted",[\s\S]{0,400}?clearanceMargin\(/);
    expect(retire).toMatch(/recordOutcome\(\s*this\.controller,\s*"missed",[\s\S]{0,400}?clearanceMargin\(/);

    // And the margin is measured off the rock's OWN grant, not off a constant:
    // the quantity is `1 - elapsed / fallMs`, so both fields have to reach it.
    expect(FLIGHT).toMatch(/clearanceMargin\(\{[\s\S]{0,200}?spawnedAtMs: rock\.spawnedAtMs/);
    expect(FLIGHT).toMatch(/clearanceMargin\(\{[\s\S]{0,200}?fallMs: rock\.fallMs/);
  });

  it("UR-51: the standalone mount can still state a knob, or no e2e can ask about depth", () => {
    // `FlightConfig.knobs` overriding the stored pair is what lets a harness put
    // a SPECIFIC difficulty on the belt. On the real path `cfg.knobs` is `{}`,
    // so the spread leaves the profile's pair untouched.
    expect(DEFAULT_FLIGHT_CONFIG.knobs).toEqual({});
    expect(FLIGHT).toMatch(/\.\.\.this\.cfg\.knobs/);
  });
});

/**
 * UR-51 / D31: A STALL MOVES THE KNOB, AND IT CAN ONLY EVER MOVE IT DOWN.
 *
 * Persisting the knob created this hole. `checkStageEnd` is the only other
 * caller of `endStage` and it cannot run on a stall - it requires every word
 * spawned and the board empty - so without a stage boundary on the stall path
 * the knob would move in ONE DIRECTION ACROSS SESSIONS. A child who clears a
 * belt ratchets up; a child who cannot clear one never ratchets back, and comes
 * back tomorrow to the difficulty that stalled them. Harmless while nothing
 * persisted. Not harmless now.
 *
 * The claim that makes it safe to call `endStage` there is that it cannot
 * tighten, and that is arithmetic rather than hope - so it is swept rather than
 * argued.
 */
describe("UR-51 / D31 / AC-10.3: ending a belt at a stall never tightens", () => {
  const WORDS = DEFAULT_FLIGHT_CONFIG.stageWordCount;
  const MARKS = hullForStage(WORDS);

  /** A controller fed `spawned` outcomes of which `missed` were misses, in the
   * worst order for this claim: every miss LAST, so the rolling window is as
   * flattering as the arithmetic allows. */
  function afterBelt(spawned: number, missed: number): ControllerState {
    let c: ControllerState = createController({ knobs: { maxLive: MAX_LIVE_MIN + 2 } });
    const outcomes: SpawnOutcome[] = [
      ...Array<SpawnOutcome>(spawned - missed).fill("blasted"),
      ...Array<SpawnOutcome>(missed).fill("missed"),
    ];
    for (const o of outcomes) c = recordOutcome(c, o);
    return c;
  }

  it("a stall means the hull emptied, so at least that many rocks were missed", () => {
    // The premise, stated so the sweep below is not sweeping a fiction. The
    // stall path runs when `isStalled(hull)`, i.e. `hullForStage(58)` marks
    // were taken, and a practice rock that passes by is still a miss for the
    // controller.
    expect(MARKS).toBeGreaterThanOrEqual(3);
    expect(MARKS).toBeLessThan(WORDS);
  });

  it("UR-51: across every reachable stall state, the decision is loosen or hold", () => {
    // Every point at which a belt can stall: the hull empties on spawn `MARKS`
    // at the earliest and on the last word at the latest.
    //
    // WATCHED FAILING, with the real numbers: relax the sweep to `missed = 1`
    // - a belt that did NOT stall - and spawn 11 decides "tighten" at a stage
    // rate of 0.909. That is the step this test exists to prove a stall cannot
    // buy, and it proves the sweep can produce one.
    let checked = 0;
    for (let spawned = MARKS; spawned <= WORDS; spawned += 1) {
      const decision = decideStage(afterBelt(spawned, MARKS));
      expect(
        decision.action,
        `stalled at spawn ${spawned} of ${WORDS}: stage rate ${decision.stageRate}`,
      ).not.toBe("tighten");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("UR-51: the guard that stops it is D18's, and it is the stage rate that trips", () => {
    // Not a coincidence worth leaving unnamed. A belt that stalls has taken
    // MARKS misses, so its own hit rate is at most (WORDS - MARKS) / WORDS,
    // and AC-10.3 refuses a tighten below TIGHTEN_FLOOR.
    const worstCaseStageRate = (WORDS - MARKS) / WORDS;
    expect(worstCaseStageRate).toBeLessThan(TIGHTEN_FLOOR);
  });

  it("UR-51: a stalled belt that was going badly LOOSENS, which is the point", () => {
    // The direction that protects the grade-2 child. A belt they could not
    // finish hands the next one back easier, and `onRestartRequested` re-reads
    // the stored knob, so the retry gets it too.
    const badly = afterBelt(30, 20);
    expect(decideStage(badly).windowRate).toBeLessThan(LOOSEN_BELOW);
    expect(decideStage(badly).action).toBe("loosen");
    const before = badly.knobs;
    const after = endStage(badly).knobs;
    expect(after).not.toEqual(before);
  });

  it("AC-10.1: a belt ends exactly once, so at most one knob moves per stage", () => {
    // `update` gates the whole stage-end path on `!this.stalled`, so a stalled
    // belt can never also reach `checkStageEnd`. Asserted on the source because
    // the alternative is two knob steps for one belt, which AC-10.1 forbids and
    // which nothing else here would notice.
    expect(FLIGHT).toMatch(/if \(!this\.stalled && !this\.stageComplete\)/);
    expect(FLIGHT).toMatch(/private checkStageEnd\(\): void \{\s*if \(this\.stageComplete\) return;/);
    const endStageCalls = [...FLIGHT.matchAll(/endStage\(this\.controller\)/g)];
    expect(endStageCalls.length).toBe(2);
  });

  it("UR-51: the knob never leaves FR-10's range however a belt ends", () => {
    for (let spawned = MARKS; spawned <= WORDS; spawned += 4) {
      for (const missed of [MARKS, Math.floor(spawned / 2), spawned]) {
        if (missed > spawned) continue;
        const knobs = endStage(afterBelt(spawned, missed)).knobs;
        expect(knobs.maxLive).toBeGreaterThanOrEqual(MAX_LIVE_MIN);
        expect(knobs.maxLive).toBeLessThanOrEqual(MAX_LIVE_MAX);
      }
    }
  });
});
