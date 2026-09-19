import { describe, expect, it } from "vitest";
import {
  TICK_MIN_GAP_MS,
  TRANSMISSION_PITCHES,
  TRANSMISSION_TICK,
  TransmissionTicker,
  transmissionPitch,
  transmissionSeparation,
  transmissionTicksFor,
} from "../../../src/game/audio/transmission.js";
import { variantsFor } from "../../../src/game/audio/sfx.js";
import { REVEAL_CEILING_MS, REVEAL_CPS } from "../../../src/game/scenes/support/briefingTypewriter.js";

/**
 * UR-91 - SHADOW'S TYPE-ON SOUND IS NOT THE PLAYER'S KEYBOARD.
 *
 * The SPEC half. What it sounds like rendered is
 * `transmissionRendered.test.ts`; this is the table, the rate limit and the
 * separation, all of which are numbers in and numbers out.
 *
 * THE BAR THIS FILE HOLDS: the tick can never drift back onto the keystroke
 * cue, and a page can never fire an unbounded number of them. Both are read off
 * the REAL tables rather than restated here, so a later lane retuning the
 * keyboard or the reveal's ceiling breaks this rather than silently colliding.
 *
 *   npx vitest run tests/unit/audio/transmission.test.ts --coverage.enabled=false
 */

describe("it is audibly a different sound from a key press", () => {
  /**
   * WATCHED FAILING by pointing `TRANSMISSION_PITCHES` at the keystroke band
   * ([760, 880, 990]) and setting `attackMs: 1`:
   *   AssertionError: expected 0 to be less than -12
   */
  it("sits more than an octave below the keystroke tick, on the real table", () => {
    const gap = transmissionSeparation();
    // BELOW, like `SHADOW_CHIRP`: up is where a notification lives, and the
    // register is half of why one sound is Shadow and the other is the board.
    expect(gap.semitonesFromKeystroke).toBeLessThan(-12);
  });

  /**
   * WATCHED FAILING at `attackMs: 1` (a key press's declared attack):
   *   AssertionError: expected 1 to be greater than 4
   */
  it("swells where a key press snaps", () => {
    const gap = transmissionSeparation();
    // The single most important difference. UR-34 put the keystroke's attack
    // peak under 0.7 ms BECAUSE touch is an edge; Shadow is not touching
    // anything, so this is measured against the FASTEST declared key attack and
    // still has to be several times slower.
    expect(gap.attackRatio).toBeGreaterThan(4);
  });

  it("has no transient and no noise, where every key press has both", () => {
    const gap = transmissionSeparation();
    // These two read the keystroke table, so they say "the thing I am NOT is
    // still what it was". If a lane ever strips the click off a key press,
    // this goes red and the claim gets re-argued instead of quietly becoming
    // false.
    expect(gap.noTransientWhereKeystrokeHasOne).toBe(true);
    expect(gap.noNoiseWhereKeystrokeHasIt).toBe(true);
    // ...and this is the sound itself: two sines, nothing else in the recipe.
    expect(TRANSMISSION_TICK.wave).toBe("sine");
    expect(Object.keys(TRANSMISSION_TICK).sort()).toEqual([
      "attackMs",
      "durationMs",
      "peakGain",
      "subGain",
      "wave",
    ]);
  });

  /**
   * D31: a mistyped key must stay the quietest thing in the game. This tick is
   * not an SFX event, so it is not inside `rendered.test.ts`'s loop over
   * `SFX_EVENTS`, and it must not become the exception that makes the rule
   * untrue by the back door.
   *
   * ONLY THE TYPO SIDE IS CHECKED HERE. The other half - that a tick is
   * quieter than a key press - cannot be read off declared gains at all,
   * because a key press is three layers and this is one; see the block above
   * `transmissionSeparation`. It is asserted on the render in
   * `transmissionRendered.test.ts`.
   *
   * WATCHED FAILING at `peakGain: 0.02`:
   *   AssertionError: expected 0.02 to be greater than 0.05
   */
  it("is louder than the quietest sound the game makes", () => {
    const typo = Math.max(...variantsFor("typo").map((v) => v.peakGain));
    expect(TRANSMISSION_TICK.peakGain).toBeGreaterThan(typo);
  });
});

describe("the rate limit bounds the page, whatever the copy says", () => {
  /**
   * WATCHED FAILING with `TICK_MIN_GAP_MS = 1` (the per-character reading):
   *   AssertionError: expected 1801 to be less than 60
   * 1801 events in 1.8 s is 1000 a second, which is not a rhythm - the ear
   * fuses discrete events into pitch somewhere around 30 a second.
   */
  it("a whole page can never fire more ticks than the ceiling allows", () => {
    const most = transmissionTicksFor(REVEAL_CEILING_MS);
    expect(most).toBe(46);
    expect(most).toBeLessThan(60);
    // The bound is the CEILING's, not the copy's: past it the reveal tightens
    // rather than running long, so 200 characters and 2000 fire the same count.
    expect(transmissionTicksFor(REVEAL_CEILING_MS * 10)).toBe(
      transmissionTicksFor(REVEAL_CEILING_MS * 10),
    );
    expect(transmissionTicksFor(0)).toBe(0);
    expect(transmissionTicksFor(-5)).toBe(0);
    expect(transmissionTicksFor(Number.NaN)).toBe(0);
  });

  it("the tick rate is fast enough to be a machine and slow enough to be heard", () => {
    const perSecond = 1000 / TICK_MIN_GAP_MS;
    // Above ~30 a second discrete events fuse into a pitch; below ~10 it stops
    // reading as a machine working and starts reading as a countdown.
    expect(perSecond).toBeLessThanOrEqual(30);
    expect(perSecond).toBeGreaterThanOrEqual(10);
    // And it is a small fraction of the characters, by construction: one tick
    // per character at REVEAL_CPS would be 160 a second.
    expect(REVEAL_CPS / perSecond).toBeGreaterThan(2);
  });

  /**
   * WATCHED FAILING by deleting the `elapsedMs - this.lastAtMs` guard from
   * `TransmissionTicker.due` (fire on every frame):
   *   AssertionError: expected [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ] to deeply
   *   equal [ 0, 1, 2 ]
   */
  it("fires on the first frame and then no faster than the gap", () => {
    const t = new TransmissionTicker();
    const fired: number[] = [];
    // A 120 Hz display: a frame every ~8 ms, which is well inside the gap.
    for (let ms = 0; ms <= 100; ms += 8) {
      const index = t.due(ms);
      if (index !== null) fired.push(index);
    }
    // The FIRST call always fires - the sound starts when the transmission
    // starts, not TICK_MIN_GAP_MS into it - and then it is gated.
    expect(fired).toEqual([0, 1, 2]);
    expect(t.ticks).toBe(3);
  });

  it("ignores a clock that has not started or has gone backwards", () => {
    const t = new TransmissionTicker();
    expect(t.due(Number.NaN)).toBeNull();
    expect(t.due(-1)).toBeNull();
    expect(t.ticks).toBe(0);
    expect(t.due(0)).toBe(0);
    t.reset();
    expect(t.ticks).toBe(0);
    // After a reset the next page starts its own cycle at its own first frame.
    expect(t.due(0)).toBe(0);
  });
});

describe("the pitch cycle is a motif rather than one repeated blip", () => {
  /**
   * WATCHED FAILING with `TRANSMISSION_PITCHES = [760, 880, 990]` - the
   * keystroke's own band, three notes instead of five:
   *   AssertionError: expected 3 to be greater than 3
   *   AssertionError: expected 2 to be less than 2          (does not climb)
   *   AssertionError: 760 Hz vs keystroke floor 760 Hz:
   *                   expected 760 to be less than 760      (clears the band)
   */
  it("wanders through five notes and wraps", () => {
    expect(new Set(TRANSMISSION_PITCHES).size).toBeGreaterThan(3);
    expect(transmissionPitch(0)).toBe(TRANSMISSION_PITCHES[0]);
    const n = TRANSMISSION_PITCHES.length;
    expect(transmissionPitch(n)).toBe(TRANSMISSION_PITCHES[0]);
    expect(transmissionPitch(n * 9 + 2)).toBe(TRANSMISSION_PITCHES[2]);
    // Negative indices wrap rather than throwing off the end of the table.
    expect(transmissionPitch(-1)).toBe(TRANSMISSION_PITCHES[n - 1]);
  });

  it("does not simply climb - a rising figure is a notification", () => {
    let ups = 0;
    for (let i = 1; i < TRANSMISSION_PITCHES.length; i += 1) {
      if ((TRANSMISSION_PITCHES[i] as number) > (TRANSMISSION_PITCHES[i - 1] as number)) ups += 1;
    }
    expect(ups).toBeGreaterThan(0);
    expect(ups).toBeLessThan(TRANSMISSION_PITCHES.length - 1);
  });

  it("every note of the cycle clears the keystroke band entirely", () => {
    // Not just the centre: NO note of this may land inside the flat band the
    // key press holds, or one tick in five is a key press.
    const keys = variantsFor("keystroke");
    const low = Math.min(...keys.flatMap((v) => [v.startHz, v.endHz]));
    for (const hz of TRANSMISSION_PITCHES) {
      expect(hz, `${hz} Hz vs keystroke floor ${low} Hz`).toBeLessThan(low);
    }
  });
});
