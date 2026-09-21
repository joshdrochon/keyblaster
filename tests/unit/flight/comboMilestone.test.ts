import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NO_CELEBRATION,
  bloomText,
  celebrationFor,
} from "../../../src/game/flight/celebration.js";
import {
  INITIAL_COMBO_STATE,
  MULTIPLIER_MILESTONES,
  comboReducer,
} from "../../../src/engine/scoring/index.js";
import {
  MILESTONE_SHAKE_SCALE,
  MILESTONE_SHARD_SCALE,
  SHARD_FIRST_DETACH_MS,
  SHARD_LAST_DETACH_MS,
  blastShakePx,
  blastShardCount,
  particleSpec,
  shardOnsetsMs,
} from "../../../src/game/render/particles.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * UR-117: THE THREE SIGNALS ARE RATIONED DIFFERENTLY, AND THAT IS THE FEATURE.
 *
 *   BLOOM      every multiplier step. Silent, over the rock that just died.
 *   CHIME      x3, x5, x10 only.
 *   BIG BLAST  x3, x5, x10 only - louder sound, harder explosion.
 *
 * Getting that backwards is the defect the feature exists to avoid, and it can
 * be got backwards in two directions: chiming on every step (ten rewards in
 * twenty seconds, and none afterwards), or blooming only at milestones (seven
 * of the ten words that earn something get no answer at all). Both are asserted
 * below, in both directions.
 *
 * ================== WATCHED FAILING ==================
 * Every assertion in this file was watched fail before it was believed:
 *
 *   `celebrationFor` returning `{bloom: m, chime: m, ...}` (bloom rationed to
 *   milestones)
 *     -> "a belt's ten multiplier steps all bloom": expected 3 to be 10
 *   `celebrationFor` returning `chime: true` on every step
 *     -> "the chime fires at x3, x5 and x10 and nowhere else": expected
 *        [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ] to deeply equal [ 3, 5, 10 ]
 *   dropping the `to <= before` guard, i.e. asking about the number rather
 *   than about the step
 *     -> "a streak past x10 stops earning anything": expected
 *        { bloom: true, chime: true, ... } to deeply equal
 *        { bloom: false, chime: false, ... }, and "a belt's ten multiplier
 *        steps all bloom": expected 20 to be 10
 *   `blastShardCount` ignoring `milestone`
 *     -> "a milestone rock throws more fragments": expected 16 to be 24
 *   `blastShakePx` ignoring `milestone`
 *     -> "a milestone blast shakes harder than the same combo without one":
 *        expected 4.8 to be close to 7.68
 *   deleting `if (celebration.chime)` in `FlightScene.onBlast`
 *     -> "the comboUp cue is emitted ONLY under the milestone flag": the
 *        comboUp cue is not guarded by celebration.chime
 *   guarding `this.comboBloom(...)` with `celebration.milestone`
 *     -> "the bloom is not rationed to milestones in FlightScene": comboBloom
 *        is called under a milestone guard: if (celebration.milestone)
 *   reverting the shake call to the inline `3 + min(10, combo) * 0.6`, and
 *   deriving the celebration from the combo count instead of the transition
 *     -> "captures the multiplier across the reducer instead of reading the
 *        combo" and "the explosion scales through the shared helpers"
 */
describe("UR-117: what a multiplier step earns", () => {
  it("a belt's ten multiplier steps all bloom", () => {
    // Walk a real streak through the real reducer rather than asserting about
    // hand-written pairs: the transition is what the scene computes, so the
    // test computes it the same way.
    let state = INITIAL_COMBO_STATE;
    let blooms = 0;
    for (let word = 0; word < 20; word += 1) {
      const before = state.multiplier;
      state = comboReducer(state, "hit");
      if (celebrationFor(before, state.multiplier).bloom) blooms += 1;
    }
    // Ten, not twenty: `multiplierFor` is `min(combo, 10)`, so words 11-20 of
    // the streak move the combo and not the multiplier, and a step that did not
    // happen earns nothing.
    expect(blooms).toBe(10);
  });

  it("the chime fires at x3, x5 and x10 and nowhere else", () => {
    let state = INITIAL_COMBO_STATE;
    const chimedAt: number[] = [];
    for (let word = 0; word < 20; word += 1) {
      const before = state.multiplier;
      state = comboReducer(state, "hit");
      const earned = celebrationFor(before, state.multiplier);
      if (earned.chime) chimedAt.push(earned.multiplier);
    }
    expect(chimedAt).toEqual([...MULTIPLIER_MILESTONES]);
  });

  it("the big explosion and the loud blast are the SAME three moments", () => {
    // One flag, not two. Two booleans that could differ is how a feature ends
    // up chiming on a word it did not explode on.
    let state = INITIAL_COMBO_STATE;
    for (let word = 0; word < 20; word += 1) {
      const before = state.multiplier;
      state = comboReducer(state, "hit");
      const earned = celebrationFor(before, state.multiplier);
      expect(earned.milestone, `word ${word + 1}`).toBe(earned.chime);
      // And the bloom is a superset: every milestone also blooms, never the
      // other way round.
      if (earned.milestone) expect(earned.bloom).toBe(true);
    }
  });

  it("a streak past x10 stops earning anything", () => {
    // THE DEFECT THE TRANSITION FORM EXISTS TO PREVENT. At combo 11, 12, 13 the
    // multiplier is pinned at 10 while the combo keeps climbing, so anything
    // that reads the COUNT re-fires the x10 chime and the big explosion on
    // every remaining word of the best run the player has had.
    expect(celebrationFor(10, 10)).toEqual(NO_CELEBRATION);
    expect(celebrationFor(10, 10).bloom).toBe(false);
    expect(celebrationFor(10, 10).chime).toBe(false);
  });

  it("a reset earns nothing, and junk earns nothing", () => {
    expect(celebrationFor(7, 0).bloom).toBe(false);
    expect(celebrationFor(Number.NaN, 5).chime).toBe(false);
    expect(celebrationFor(4, Number.POSITIVE_INFINITY).bloom).toBe(false);
  });

  it("the bloom says what the HUD says", () => {
    expect(bloomText(3)).toBe("x3");
    expect(bloomText(10)).toBe("x10");
  });
});

describe("UR-117: the explosion is the same explosion, scaled", () => {
  const base = particleSpec("blastShards").quantity;

  it("a milestone rock throws more fragments", () => {
    expect(blastShardCount(false)).toBe(base);
    expect(blastShardCount(true)).toBe(Math.round(base * MILESTONE_SHARD_SCALE));
    expect(blastShardCount(true)).toBeGreaterThan(blastShardCount(false));
  });

  it("an ordinary rock is untouched at every combo", () => {
    for (let combo = 0; combo <= 14; combo += 1) {
      expect(blastShakePx(combo, false)).toBe(3 + Math.min(10, combo) * 0.6);
    }
  });

  it("a milestone blast shakes harder than the same combo without one", () => {
    for (const combo of [3, 5, 10]) {
      expect(blastShakePx(combo, true)).toBeCloseTo(
        blastShakePx(combo, false) * MILESTONE_SHAKE_SCALE,
        12,
      );
      expect(blastShakePx(combo, true)).toBeGreaterThan(blastShakePx(combo, false));
    }
    // ...and still readable. A shake a child cannot read the next word through
    // is a bigger explosion that costs them the rock after it.
    expect(blastShakePx(10, true)).toBeLessThan(16);
  });

  it("the burst still lands inside the crumble sound it is matched to", () => {
    // UR-48: the onset schedule IS the sound's distribution, and the milestone
    // burst scales the POPULATION rather than the schedule, so every extra
    // fragment still leaves inside the window the ear is hearing rock fall in.
    // Asserted here rather than in shardOnset.test.ts because it is the thing
    // the milestone change could have broken.
    const onsets = shardOnsetsMs(blastShardCount(true));
    expect(Math.min(...onsets)).toBeGreaterThanOrEqual(SHARD_FIRST_DETACH_MS);
    expect(Math.max(...onsets)).toBeLessThanOrEqual(SHARD_LAST_DETACH_MS);
  });
});

/**
 * ================== WHY THE CHECKS BELOW READ SOURCE ==================
 * The same argument `shardTint.test.ts` makes, and for the same method:
 * `onBlast`, `fractureRock` and `comboBloom` are private methods on a Phaser
 * Scene, so reaching them needs a browser. The RULE they implement is pure and
 * is asserted above as arithmetic; what cannot be asserted from inside the
 * program is that the scene is wired to it - and a feature that is correct and
 * unreachable is exactly the state this lane inherited.
 */
describe("UR-117: FlightScene is wired to the rule", () => {
  const SRC = readFileSync(
    path.resolve(HERE, "../../../src/game/scenes/FlightScene.ts"),
    "utf8",
  );

  /** `onBlast`'s body, comments stripped - a doc-comment must not pass a check. */
  function onBlastBody(): string {
    const start = SRC.indexOf("private onBlast(");
    expect(start, "onBlast was renamed or removed").toBeGreaterThan(-1);
    const rest = SRC.slice(start);
    const end = rest.indexOf("\n  private ", 1);
    return (end > 0 ? rest.slice(0, end) : rest)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
  }

  it("captures the multiplier across the reducer instead of reading the combo", () => {
    const body = onBlastBody();
    expect(body, "onBlast no longer reads the multiplier before the hit").toContain(
      "const multiplierBefore = this.combo.multiplier;",
    );
    expect(body).toContain("celebrationFor(multiplierBefore, this.combo.multiplier)");
    // The two lines must be in this order, or the "before" is the "after".
    expect(body.indexOf("const multiplierBefore")).toBeLessThan(
      body.indexOf('comboReducer(this.combo, "hit")'),
    );
  });

  it("the comboUp cue is emitted ONLY under the milestone flag", () => {
    const body = onBlastBody();
    expect(body, "FlightScene never emits comboUp - the chime is unreachable").toContain(
      'this.cue("comboUp")',
    );
    expect(
      /if \(celebration\.chime\) this\.cue\("comboUp"\);/.test(body),
      "the comboUp cue is not guarded by celebration.chime - the chime fires on every multiplier step, which is ten rewards in twenty seconds",
    ).toBe(true);
  });

  it("the bloom is not rationed to milestones in FlightScene", () => {
    // `comboBloom` takes the whole celebration and decides for itself; a
    // milestone guard at the CALL SITE is the backwards version of this
    // feature and is what this asserts is absent.
    const calls = [...SRC.matchAll(/([^\n]*)this\.comboBloom\(/g)].map((m) => m[1] ?? "");
    expect(calls.length, "nothing calls comboBloom - the bloom is unreachable").toBeGreaterThan(0);
    for (const line of calls) {
      expect(
        /milestone|chime/.test(line),
        `comboBloom is called under a milestone guard: ${line.trim()}`,
      ).toBe(false);
    }
  });

  it("the explosion scales through the shared helpers, not a second effect", () => {
    expect(SRC).toContain("blastShardCount(celebration.milestone");
    expect(SRC).toContain("blastShakePx(this.combo.combo, celebration.milestone)");
    // The old inline shake formula is gone from both blast paths, so there is
    // one place the milestone scaling can be applied.
    expect(
      /shakeBy\(3 \+ Math\.min\(10, this\.combo\.combo\) \* 0\.6/.test(SRC),
      "a blast path still uses the inline shake formula and so never gets the milestone scale",
    ).toBe(false);
  });

  it("the cue union carries comboUp", () => {
    const stage = readFileSync(
      path.resolve(HERE, "../../../src/game/flight/stage.ts"),
      "utf8",
    );
    const block = /export type FlightCue\s*=([\s\S]*?);/.exec(stage)?.[1] ?? "";
    expect([...block.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1])).toContain("comboUp");
  });
});
