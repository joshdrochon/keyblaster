import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SHARD_LAST_DETACH_MS,
  SHARD_ONSET_TAU_MS,
  particleSpec,
  shardOnsetsMs,
  shardWaves,
  shardsDetachedBy,
} from "../../../src/game/render/particles.js";
import { CRUMBLE_SECONDS, CRUMBLE_SHAPE } from "../../../src/game/audio/crumble.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * UR-48, THE VISUAL HALF: THE ROCK MUST COME APART OVER TIME.
 *
 * The crumbling sound shipped first and the picture was never matched to it, so
 * the two disagreed on the one event the whole game is built around. The sound
 * is 64 struck-stone grains scattered by a density that decays with a 150 ms
 * time constant, still shedding at 460 ms. The picture was a single
 * `emitParticleAt(x, y, quantity)` on the fracture frame: every fragment left
 * together, and a population that arrives in one instant reads as a puff
 * however large it is. That is why raising the count from 8 to 16 did not fix
 * the complaint the first time it was made.
 *
 * The audio lane handed over the timings it measured from what the sound
 * actually renders, and they are the spec this file enforces:
 *
 *     fracture        0 ms        the crack
 *     debris begins   15-22 ms    first fragments detach, NOT with the crack
 *     density decays  150 ms      the bulk of the material has dispersed
 *     last fragment   400-460 ms  something is still moving this late
 *
 * ================= WHY THIS IS A UNIT TEST AND NOT AN E2E =================
 *
 * The same argument `shardTint.test.ts` makes. The schedule is DATA - a pure,
 * deterministic function of the population size - so it can be read exactly,
 * and an e2e that blasts a rock and counts sprites per frame would measure the
 * headless renderer's pacing as much as the game's. What an e2e would add, and
 * a data test cannot, is that `FlightScene` actually USES the schedule; that is
 * the last `describe` below, and it is a source check for the same reason
 * `shardTint.test.ts` uses one.
 *
 * ==================== EVERY ASSERTION WATCHED FAILING ====================
 *
 * Rule 4 in docs/coding-standards.md, and this file sits next to the file that
 * rule was written about. Each negative control was applied, the suite run, and
 * the real failing value recorded at the assertion it broke. Restored after.
 */
describe("UR-48: the shard onsets are the crumble's onsets", () => {
  const POPULATION = particleSpec("blastShards").quantity;
  const onsets = shardOnsetsMs();

  it("the schedule covers exactly the declared population", () => {
    expect(onsets).toHaveLength(POPULATION);
    expect(shardWaves().reduce((n, w) => n + w.count, 0)).toBe(POPULATION);
  });

  /**
   * ROW 2 OF THE SPEC: debris begins at 15-22 ms.
   *
   * The floor exists because the raw exponential's first stratum lands at
   * 6.4 ms, which at 60 fps is the SAME FRAME as the fracture - so without it
   * the first fragment is simultaneous with the crack, which is the defect.
   *
   * WATCHED FAIL: with `SHARD_FIRST_DETACH_MS` dropped from 18 to 0 (the clamp
   * removed, i.e. the raw distribution):
   *   "the first fragment detaches on the fracture frame ...":
   *   expected 6 to be greater than or equal to 15
   */
  it("the first fragment detaches after the crack, in the 15-22 ms window", () => {
    const first = onsets[0] as number;
    expect(
      first,
      "the first fragment detaches on the fracture frame, so the break has no onset - the crack and the debris are one event again",
    ).toBeGreaterThanOrEqual(15);
    expect(first).toBeLessThanOrEqual(22);
  });

  /**
   * THE HEADLINE PROPERTY: they do not all leave together.
   *
   * WATCHED FAIL: with `shardOnsetsMs` returning `SHARD_FIRST_DETACH_MS` for
   * every stratum - the old single-burst behaviour, moved off zero. All three
   * of the timing tests went red together, which is what a schedule collapsing
   * to one instant should do:
   *   "every fragment leaves on the same frame ...": expected 1 to be greater
   *   than or equal to 8
   *   "the whole population has detached by 150 ms ...": expected 12 to be less
   *   than 12
   *   (the tail test): expected 18 to be greater than or equal to 400
   *
   * The second assertion below - the cap on one wave's share - is covered by
   * the same control, but the first one throws before it is reached, so it is
   * recorded here as unreached rather than as a number that was watched.
   */
  it("the population is staggered, not fired in one burst", () => {
    const waves = shardWaves();
    expect(
      waves.length,
      "every fragment leaves on the same frame - this is the single-burst behaviour the change exists to remove",
    ).toBeGreaterThanOrEqual(8);
    const biggest = Math.max(...waves.map((w) => w.count));
    expect(
      biggest,
      "one wave carries the whole population, so the schedule is a burst wearing a schedule's name",
    ).toBeLessThanOrEqual(Math.ceil(POPULATION / 2));
    // Ascending, which the cumulative helper below relies on.
    for (let i = 1; i < onsets.length; i += 1) {
      expect(onsets[i] as number).toBeGreaterThanOrEqual(onsets[i - 1] as number);
    }
  });

  /**
   * ROW 3 OF THE SPEC: the density has decayed by 150 ms.
   *
   * This is a statement about the RATE, not the total. The sound's onsets are
   * exponential with `densityTau` 0.15 s, so at t = tau the emission rate has
   * fallen to 1/e of its initial value and the cumulative count stands at
   * 1 - 1/e = 63.2%. Both halves are asserted, because either alone is weak:
   * a cumulative floor alone passes for "all twelve at t=0", and a rate ratio
   * alone passes for a schedule that never gets going.
   *
   * The UPPER bound is the one that carries the meaning. If everything has
   * detached by 150 ms there is no tail, and the burst is a puff with a delay
   * on it.
   *
   * WATCHED FAIL: with `SHARD_ONSET_TAU_MS` raised 150 -> 600 (a rock that
   * sheds evenly instead of breaking):
   *   "the bulk of the material has not dispersed by 150 ms ...": expected 3 to
   *   be greater than or equal to 7.199999999999999
   * WATCHED FAIL: with `SHARD_ONSET_TAU_MS` lowered 150 -> 20 (everything at
   * the floor):
   *   "the whole population has detached by 150 ms ...": expected 12 to be less
   *   than 12
   */
  it("the density has decayed by 150 ms", () => {
    const by150 = shardsDetachedBy(150);
    expect(
      by150,
      "the bulk of the material has not dispersed by 150 ms - the fragments are still leaving at a flat rate, which is a slide and not a break",
    ).toBeGreaterThanOrEqual(POPULATION * 0.6);
    expect(
      by150,
      "the whole population has detached by 150 ms, so there is no tail at all",
    ).toBeLessThan(POPULATION);

    // The rate itself, over two equal windows either side of the time constant.
    const early = onsets.filter((t) => t < 150).length;
    const late = onsets.filter((t) => t >= 150 && t < 300).length;
    expect(
      late * 2,
      `the emission rate did not fall across 150 ms (${early} fragments before, ${late} after)`,
    ).toBeLessThanOrEqual(early);
  });

  /**
   * ROW 4 OF THE SPEC: the last fragment leaves at 400-460 ms, and it is ONE
   * fragment, not the tail of a crowd.
   *
   * Stated as two exact counts rather than a bound on the maximum, because
   * "something is still moving this late" is a claim about how much is left,
   * not only about when the schedule ends. At 399 ms exactly one fragment is
   * still to come; by 460 ms the population is complete.
   *
   * WATCHED FAIL: with `SHARD_LAST_DETACH_MS` raised 440 -> 900 (the ceiling
   * removed, i.e. the raw distribution's own last stratum at 477 ms):
   *   "the last fragment leaves outside the sound it is matched to": expected
   *   477 to be less than or equal to 460
   * and, in the test below it:
   *   "the last fragment leaves after the crumble buffer has ended": expected
   *   900 to be less than 500
   */
  it("exactly one fragment is left for the 400-460 ms tail", () => {
    const last = onsets[onsets.length - 1] as number;
    expect(last).toBeGreaterThanOrEqual(400);
    expect(
      last,
      "the last fragment leaves outside the sound it is matched to",
    ).toBeLessThanOrEqual(460);

    expect(shardsDetachedBy(399), "nothing is left for the tail").toBe(POPULATION - 1);
    expect(shardsDetachedBy(460), "a fragment leaves after the crumble has ended").toBe(
      POPULATION,
    );
    expect(
      onsets.filter((t) => t >= 300).length,
      "the tail is a crowd, not a straggler - the burst has a second act instead of a fade",
    ).toBeLessThanOrEqual(2);
  });

  /**
   * THE SCHEDULE AND THE SOUND ARE THE SAME SHAPE, and this is the negative
   * control for the whole file: if the visual timings were picked freely they
   * could drift from the crumble the moment either is retuned. `densityTau` is
   * the audio's own constant and `CRUMBLE_SECONDS` its own length.
   *
   * WATCHED FAIL: with `SHARD_ONSET_TAU_MS` set to 600:
   *   "the visual decay no longer matches the crumble's densityTau, so the
   *    picture and the sound are free to drift apart again": expected 600 to be
   *    150
   */
  it("the visual decay is the crumble's own decay", () => {
    expect(
      SHARD_ONSET_TAU_MS,
      "the visual decay no longer matches the crumble's densityTau, so the picture and the sound are free to drift apart again",
    ).toBe(Math.round(CRUMBLE_SHAPE.densityTau * 1000));
    expect(
      SHARD_LAST_DETACH_MS,
      "the last fragment leaves after the crumble buffer has ended",
    ).toBeLessThan(CRUMBLE_SECONDS * 1000);
  });

  /**
   * THE BUDGET (P-22.9 / AC-22.9).
   *
   * Difficulty wiring landed alongside this: belts now climb to maxLive 7 and
   * time-weighted occupancy went from about 1.0 rocks to 3.4-3.9 over a route,
   * so there are far more rocks being drawn on every frame that a blast lands
   * on. Per-frame particle cost is population x lifespan, and staggering does
   * not reduce it - the minimum lifespan (480 ms) is longer than the whole
   * onset spread (440 ms), so every fragment is still alive when the last one
   * is born. The population is the only lever, and it went DOWN:
   *
   *     before  16 fragments x ~690 ms mean life = 11040 particle-ms per blast
   *     after   12 fragments x ~690 ms mean life =  8280 particle-ms per blast
   *
   * The floor is art-direction section 8, which asks for 6-10 shards; the
   * schedule stays above its top end.
   *
   * WATCHED FAIL, both bounds. With `quantity` put back to 16:
   *   "the shard population grew - this change may not buy its satisfaction
   *    with frame time ...": expected 16 to be less than or equal to 12
   * With `quantity` cut to 8:
   *   "the population fell below the top of art-direction section 8's 6-10
   *    range ...": expected 8 to be greater than or equal to 10
   */
  it("the per-destruction population did not grow", () => {
    expect(
      POPULATION,
      "the shard population grew - this change may not buy its satisfaction with frame time on a board that just tripled its rock count",
    ).toBeLessThanOrEqual(12);
    expect(
      POPULATION,
      "the population fell below the top of art-direction section 8's 6-10 range - with the fragments now spread over 440 ms a thinner population is a trickle, and this floor is what stops a later lane buying frame time by shaving the burst",
    ).toBeGreaterThanOrEqual(10);
  });
});

/**
 * AND THE SCENE ACTUALLY USES IT.
 *
 * Everything above is a property of a pure function, and every one of those
 * assertions stays green if `FlightScene` ignores the schedule entirely and
 * goes on emitting the whole population on the fracture frame. That is the
 * exact shape of the vacuous test this repo has shipped before
 * (`shardTint.test.ts`, instance 15), so the binding is checked the way that
 * file checks its own: by reading the call site.
 *
 * `fractureRock` is a private method on a Phaser Scene, so there is no seam to
 * reach it from a unit test; the binding is one expression and it is visible in
 * the source.
 */
describe("UR-48: FlightScene emits on the schedule, not on one frame", () => {
  const FLIGHT_SCENE = readFileSync(
    path.resolve(HERE, "../../../src/game/scenes/FlightScene.ts"),
    "utf8",
  );

  /**
   * The body of `fractureRock` WITH COMMENTS REMOVED - same reason
   * `shardTint.test.ts` strips them. The doc comment above the emission
   * describes the single-burst call it replaced, so a raw-text check would read
   * the explanation of the fix as the defect.
   */
  function fractureRockBody(): string {
    const start = FLIGHT_SCENE.indexOf("private fractureRock(");
    expect(start, "fractureRock was renamed or removed").toBeGreaterThan(-1);
    const rest = FLIGHT_SCENE.slice(start);
    const end = rest.indexOf("\n  private ", 1);
    const body = end > 0 ? rest.slice(0, end) : rest;
    return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  }

  /**
   * WATCHED FAIL, by restoring the two lines this change replaced
   * (`setParticleTint(hexToInt(fill))` then
   * `emitParticleAt(x, y, shardSpec.quantity)`):
   *
   *   "fractureRock does not schedule its fragments - it is back to one burst
   *    on the fracture frame ...": expected 'private fractureRock(rock:
   *    LiveRock, ...' to contain 'shardWaves('
   *
   * The later assertions in this test are unreached under that control, since
   * the first one throws; the whole-population check is what would catch a
   * schedule that is called and then ignored, and it has no separate control of
   * its own. The same revert also reddened the per-wave tint test below, which
   * is recorded there.
   */
  it("the fragments are scheduled, and the population is not emitted at once", () => {
    const body = fractureRockBody();
    expect(
      body,
      "fractureRock does not schedule its fragments - it is back to one burst on the fracture frame, which is the defect UR-48's visual half exists to fix",
    ).toContain("shardWaves(");
    expect(body, "the scheduled waves are never actually delayed").toContain("delayedCall");
    expect(body, "the wave's own count is not what gets emitted").toContain("wave.count");
    expect(
      /emitParticleAt\([^)]*quantity/.test(body),
      "fractureRock emits the whole population on the fracture frame in one call",
    ).toBe(false);
  });

  /**
   * The tint must be applied PER WAVE. With one up-front `setParticleTint` the
   * fragments still in the air when a second rock breaks are repainted in the
   * second rock's colour - UR-47's defect a third time, and reachable whenever
   * two blasts land inside 440 ms of each other, which at the belt's current
   * occupancy is most of them.
   *
   * WATCHED FAIL, twice. Hoisting `this.shards.setParticleTint(tint)` out of
   * the wave callback to just above the loop, and separately reverting the
   * whole emission to the single up-front call, both gave:
   *   "the shard tint is applied once for the whole burst, so a rock destroyed
   *    mid-burst repaints another rock's fragments": expected false to be true
   */
  it("each wave carries the tint of the rock it came from", () => {
    const body = fractureRockBody();
    const perWave = /setParticleTint\([^)]*\);\s*this\.shards\.emitParticleAt\(/.test(body);
    expect(
      perWave,
      "the shard tint is applied once for the whole burst, so a rock destroyed mid-burst repaints another rock's fragments",
    ).toBe(true);
  });
});
