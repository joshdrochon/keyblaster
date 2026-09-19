/**
 * WHAT SHADOW'S TYPE-ON ACTUALLY SOUNDS LIKE (UR-91).
 *
 * Same discipline as `rendered.test.ts`, and a sibling file rather than another
 * two hundred lines inside it purely so this lane can run its own renders in
 * fifteen seconds instead of the whole audio sweep (CLAUDE.md: run the test
 * FILE while iterating). Every bar below is either the signal's own statistic
 * or a number measured off a sound that already ships - never a constant picked
 * to make the current build pass - and the failing-first run is recorded next
 * to each one.
 *
 *   npx vitest run tests/unit/audio/transmissionRendered.test.ts --coverage.enabled=false
 */

import { describe, expect, it } from "vitest";
import {
  OfflineAudioContextLike,
  bandEnergyFraction,
  largestStep,
  peak,
  rms,
  stepQuantile,
} from "./offline.js";
import {
  TICK_MIN_GAP_MS,
  TRANSMISSION_TICK,
  playTransmissionTick,
  transmissionTicksFor,
} from "../../../src/game/audio/transmission.js";
import { SfxBus } from "../../../src/game/audio/sfx.js";
import { KeystrokeTone } from "../../../src/game/audio/keystrokeTone.js";
import { buildAudioGraph, busSpec } from "../../../src/game/audio/graph.js";
import { DUCK_DB } from "../../../src/game/audio/voice.js";
import { installAudio } from "../../../src/game/audio/wiring.js";
import { REVEAL_CEILING_MS } from "../../../src/game/scenes/support/briefingTypewriter.js";
import { fakeVoiceEnvironment } from "./fakes.js";

const SR = 48000;

/** Master x bus, so every level below is what reaches the speaker. */
const busChain = (bus: "sfx" | "voice"): number => busSpec("master").gain * busSpec(bus).gain;

function onBus(bus: "sfx" | "voice"): {
  ctx: OfflineAudioContextLike;
  output: ReturnType<OfflineAudioContextLike["createGain"]>;
} {
  const ctx = new OfflineAudioContextLike(SR);
  const output = ctx.createGain();
  output.gain.value = busChain(bus);
  output.connect(ctx.destination);
  return { ctx, output };
}

/**
 * A WHOLE BRIEFING, at the worst case the product can produce.
 *
 * `REVEAL_CEILING_MS` is the longest a page may take whatever its copy says, so
 * this is not "a long briefing" - it is EVERY briefing, including the ones
 * nobody has written. That is the point of measuring the ceiling rather than
 * Mars (standards rule 5, and the UR-20 defect that shipped because Mars was
 * the only stop anybody captured).
 */
function renderPage(): Float32Array {
  const ticks = transmissionTicksFor(REVEAL_CEILING_MS);
  const { ctx, output } = onBus("voice");
  for (let k = 0; k < ticks; k += 1) {
    ctx.currentTime = (k * TICK_MIN_GAP_MS) / 1000;
    playTransmissionTick(ctx, output, k);
  }
  ctx.currentTime = 0;
  return ctx.render(REVEAL_CEILING_MS / 1000 + 0.3);
}

/** One tick, and the window that opens where it actually sounds. */
function renderOneTick(): { all: Float32Array; attack: Float32Array } {
  const { ctx, output } = onBus("voice");
  playTransmissionTick(ctx, output, 0);
  const all = ctx.render(0.2);
  // UR-55: a voice is scheduled past the clock, so a window anchored on the
  // call instant opens on silence. Find the onset, exactly as the UR-34 block
  // in rendered.test.ts does.
  let onset = 0;
  while (onset < all.length && Math.abs(all[onset] as number) < 1e-6) onset += 1;
  return { all, attack: all.subarray(onset, onset + Math.floor(0.006 * SR)) };
}

describe("UR-91: a whole briefing stays inside the belt's budget", () => {
  /**
   * THE TICKET'S OWN BAR: "a burst of 200 characters must not be louder or
   * harsher than the belt". The belt is the reference because it is the thing
   * the child hears for twenty minutes, and it is rendered here rather than
   * quoted so a later remix moves BOTH sides of the comparison.
   *
   * WATCHED FAILING with `TICK_MIN_GAP_MS = 2` and `peakGain: 0.2` - the naive
   * per-character reading at a keystroke-ish level:
   *   AssertionError: page rms vs belt rms:
   *   expected 0.10136128147719418 to be less than 0.026221665143990765
   *   (that run used the forty-word belt at 0.026222; the twelve-word belt
   *    this now renders measures 0.025478, 0.25 dB apart - see the body)
   * i.e. the page was 11.7 dB LOUDER than forty words of typing, locks and
   * blasts, which is the exact failure the rate limit exists to prevent. (The
   * peak half passed even then: a tick track is dense, not peaky.)
   */
  it("the whole page is quieter than the typing belt, rendered", () => {
    const page = renderPage();

    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    const tone = new KeystrokeTone(ctx, output);
    let t = 0;
    // TWELVE WORDS, NOT FORTY, AND THE DIFFERENCE WAS MEASURED RATHER THAN
    // ASSUMED. Both sides are rms - a RATE - so belt length should move the
    // estimate, not the number, and it does: rendered both ways,
    //
    //   12 words   rms 0.025478   peak 0.42269
    //   40 words   rms 0.026222   peak 0.42716
    //
    // 0.25 dB apart, against a page that has to come in 8 dB under. What forty
    // costs is 134 extra seconds of offline rendering on every suite run (150 s
    // against 16 s for this whole file), and `rendered.test.ts` already pays
    // that once for UR-34. Twelve still contains every layer the comparison is
    // about: keystrokes, a typo, and a lock and a blast per word.
    for (let word = 0; word < 12; word += 1) {
      const letters = 4 + (word % 4);
      for (let k = 0; k < letters; k += 1) {
        ctx.currentTime = t;
        bus.play("keystroke");
        tone.correct();
        t += 0.19;
      }
      if (word % 5 === 4) {
        ctx.currentTime = t;
        bus.play("typo");
        tone.typo();
        t += 0.24;
      }
      ctx.currentTime = t;
      bus.play("lock");
      bus.play("blast");
      tone.reset();
      t += 0.75;
    }
    ctx.currentTime = 0;
    const belt = ctx.render(t + 1.5);

    // LOUDER: sustained level, which is what a dense tick track would break.
    expect(rms(page), "page rms vs belt rms").toBeLessThan(rms(belt));
    // ...and the loudest instant in the whole page is under the belt's too.
    expect(peak(page), "page peak vs belt peak").toBeLessThan(peak(belt));
  });

  /**
   * WHERE IT SITS IN THE GAME'S ORDER OF LOUDNESS, ON THE SAMPLES.
   *
   * This is the half of the separation that `transmissionSeparation` cannot
   * honestly report: a key press declares `peakGain` 0.055 and then stacks a
   * click at 0.30-0.36 and a sub on top, so the declared numbers compare one
   * layer against three (UR-44). Rendered, the ordering is unambiguous.
   *
   * WATCHED FAILING at `peakGain: 0.2`:
   *   AssertionError: tick vs quietest key press:
   *   expected 0.18080022931098938 to be less than 0.12420383840799332
   */
  it("a tick lands between a typo and a key press, rendered", () => {
    const tick = peak(renderOneTick().all);

    const loudest = (event: "keystroke" | "typo"): { lo: number; hi: number } => {
      const { ctx, output } = onBus("sfx");
      const bus = new SfxBus(ctx, output);
      const gap = 0.5;
      for (let k = 0; k < 9; k += 1) {
        ctx.currentTime = k * gap;
        bus.play(event);
      }
      ctx.currentTime = 0;
      const all = ctx.render(9 * gap + 0.3);
      const peaks = Array.from({ length: 9 }, (_, k) =>
        peak(all.subarray(Math.floor(k * gap * SR), Math.floor((k * gap + 0.4) * SR))),
      );
      return { lo: Math.min(...peaks), hi: Math.max(...peaks) };
    };

    // D31: the mistyped key stays the quietest sound in the game, and this
    // does not become the exception that makes that rule untrue.
    expect(tick, "tick vs loudest typo").toBeGreaterThan(loudest("typo").hi);
    // ...and it is never mistaken for the player's own keyboard.
    expect(tick, "tick vs quietest key press").toBeLessThan(loudest("keystroke").lo);
  });

  /**
   * HARSHER, measured rather than adjectived. The keystroke's attack is a
   * click - UR-34 holds every press above 10% of its first 6 ms over 2 kHz.
   * This is two sines, so the same band is empty, and "it is not harsh" stops
   * being a matter of taste.
   *
   * WATCHED FAILING with `wave: "sawtooth"`:
   *   AssertionError: expected 0.16300771382445775 to be less than 0.01
   */
  it("there is nothing above 2 kHz in it, where a key press is mostly that", () => {
    const page = renderPage();
    expect(bandEnergyFraction(page, SR, 2000, SR / 2)).toBeLessThan(0.01);
    const { attack } = renderOneTick();
    // UR-34's floor for a key press is 0.1 over this exact band and window.
    // This is on the other side of it by more than an order of magnitude.
    expect(bandEnergyFraction(attack, SR, 2000, SR / 2)).toBeLessThan(0.01);
  });

  /**
   * NO CLICK ON START, AND THE BAR IS DERIVED FROM THE SIGNAL'S OWN SLOPE.
   *
   * ================== THE FIRST VERSION OF THIS TEST WAS NOT A TEST ==========
   * It read `largestStep(page) < stepQuantile(page, 0.999) * 4` over the WHOLE
   * page, copying the chirp's bar in `rendered.test.ts`. Rendered with the
   * attack ramp deleted it still PASSED, because the page contains 46 onsets
   * and 0.1% of 100k samples is 100 - so all 46 hard edges sat INSIDE the
   * quantile they were being measured against and raised the bar by exactly the
   * amount the defect raised the measurement. The chirp's version is sound
   * because a chirp has two onsets in half a second; a tick track does not.
   *
   * So this measures ONE tick against arithmetic. The steepest thing a correct
   * tick can contain is its own sine at full level: 2*pi*f/SR per sample, which
   * at the cycle's top note is 523.25 Hz / 48 kHz = 6.8% of peak. A step is
   * 100%. 15% sits clear of the real slope and well under any edge.
   *
   * ================== I COULD NOT MAKE THE STEP CHECK GO RED, AND THAT IS ====
   * ================== A FACT ABOUT THE SOUND, NOT A WEAK TEST ===============
   * Deleting the attack ramp entirely - `setValueAtTime(peak * scale, at)`,
   * a gain that arrives at full level on its first sample - still rendered a
   * largest step of 0.00219 against a peak of 0.0504, a ratio of 0.043. An
   * oscillator starts at phase zero, so a sine's FIRST SAMPLE IS ZERO whatever
   * the gain does, and the waveform supplies its own fade-in. This cue cannot
   * click at its onset by construction, which is one of the reasons it is two
   * sines and no noise.
   *
   * The assertion stays because it stops being free the moment anybody adds a
   * filter, a noise layer or a non-zero start phase - all of which a "make it
   * crunchier" change would reach for first. It is a regression guard with a
   * derived bar, and it is labelled as one rather than dressed up as a
   * failing-first I did not get.
   *
   * WHAT DID GO RED, in the same run, with `wave: "sawtooth"` - a wave whose
   * first sample is NOT zero:
   *   AssertionError: expected 0.022956806544712695 to be less than 0.0001
   * and with the ramp deleted:
   *   AssertionError: expected 0.0007925830989881327 to be less than 0.0001
   * The DC check is the one that actually polices the onset here.
   */
  it("no tick clicks at either end, and the page carries no DC", () => {
    const { all } = renderOneTick();
    const pk = peak(all);
    expect(
      largestStep(all).step / pk,
      "largest step as a fraction of peak",
    ).toBeLessThan(0.15);

    const page = renderPage();
    let sum = 0;
    for (let i = 0; i < page.length; i += 1) sum += page[i] as number;
    expect(Math.abs(sum / page.length)).toBeLessThan(1e-4);
    // And it is actually audible - a budget met by making no sound is not one.
    expect(peak(page)).toBeGreaterThan(0.02);
    // The page's own steps stay in the same family as one tick's, which is
    // what says the ticks do not collide into an edge where they overlap.
    expect(largestStep(page).step).toBeLessThan(stepQuantile(page, 0.99) * 6);
  });

  /**
   * THE ATTACK IS THE SOUND'S IDENTITY. UR-34 asserts the median key press
   * reaches its peak in under 0.7 ms. This has to be on the far side of that
   * by a wide margin or the two cues are the same gesture at different pitches.
   *
   * WATCHED FAILING with `attackMs: 0.5`:
   *   AssertionError: ms to 90% of peak:
   *   expected 1.5416666666666667 to be greater than 3
   */
  it("it swells over milliseconds where a key press snaps in under one", () => {
    const { attack } = renderOneTick();
    const pk = peak(attack);
    let rise = Number.POSITIVE_INFINITY;
    for (let i = 0; i < attack.length; i += 1) {
      if (Math.abs(attack[i] as number) >= pk * 0.9) {
        rise = (i / SR) * 1000;
        break;
      }
    }
    // UR-34's bar for a key press is `rises[15] < 0.7`. Four times that, at
    // least, and the declared ramp is 6 ms.
    expect(rise, "ms to 90% of peak").toBeGreaterThan(3);
    expect(rise).toBeLessThan(TRANSMISSION_TICK.durationMs);
  });
});

describe("UR-91: the reveal is Shadow speaking, so the world ducks", () => {
  const graphFor = () => {
    const ctx = new OfflineAudioContextLike(SR);
    return { ctx, graph: buildAudioGraph(ctx, { voiceEnv: fakeVoiceEnvironment().env }) };
  };

  /**
   * AC-21.4 says the music bus drops at least 6 dB when Shadow speaks. The
   * briefing IS Shadow speaking - it is the only place that line is delivered -
   * so the reveal has to move the same fader his voice does.
   *
   * ================== WHAT THIS DELIBERATELY DOES NOT ASSERT ==================
   * The first version of this test looped `graph.ducker.scheduledReductionDb()`
   * and required every bus to report -6 dB or lower. IT PASSED WITH
   * `graph.ducker.duck(true)` DELETED FROM `beginTransmission`, because that
   * method ducks the graph ITSELF in order to report the committed target and
   * undoes it afterwards - so it answers "how deep is this ducker configured to
   * go", never "is it ducking now". A green assertion with nothing behind it is
   * the UR-46 defect exactly, and it is worse than no assertion.
   *
   * So the CLAIM here is the state change, which is real and which goes red
   * when the duck is removed. The DEPTH is asserted where it can be heard:
   * `rendered.test.ts`'s "the music bus really drops at least 6 dB when Shadow
   * speaks" renders the samples, and the live capture of this screen read
   * `busGains.music` at 0.3508 against a resting 0.6999 - 6.0 dB down - on a
   * real AudioContext in the built preview.
   *
   * WATCHED FAILING with the `graph.ducker.duck(true)` line deleted from
   * `beginTransmission`:
   *   AssertionError: expected false to be true // Object.is equality
   */
  it("beginTransmission opens the AC-21.4 duck and endTransmission closes it", () => {
    const { graph } = graphFor();
    const audio = installAudio({ graph });

    expect(audio.snapshot().transmitting).toBe(false);
    expect(graph.ducker.ducking).toBe(false);

    audio.beginTransmission("briefing:reveal");
    expect(graph.ducker.ducking, "the ducker is actually ducking").toBe(true);
    expect(audio.snapshot().transmitting).toBe(true);
    // The buses it moves are the two AC-21.4 names, and the depth it is
    // configured for is at least the 6 dB the criterion asks for.
    expect([...graph.ducker.targetIds()].sort()).toEqual(["ambient", "music"]);
    expect(DUCK_DB).toBeLessThanOrEqual(-6);

    audio.endTransmission();
    expect(audio.snapshot().transmitting).toBe(false);
    expect(graph.ducker.ducking).toBe(false);
  });

  /**
   * ONE DUCK PER PAGE. `SidechainDucker` counts depth, so a duck per tick would
   * need forty-six releases to unwind and the music would come back a quarter
   * of a minute after the briefing ended.
   *
   * WATCHED FAILING by moving `graph.ducker.duck(true)` into
   * `transmissionTick`:
   *   AssertionError: expected true to be false // Object.is equality
   */
  it("forty-six ticks do not stack forty-six ducks", () => {
    const { ctx, graph } = graphFor();
    const audio = installAudio({ graph });
    audio.beginTransmission("briefing:reveal");
    for (let ms = 0; ms <= REVEAL_CEILING_MS; ms += 8) {
      ctx.currentTime = ms / 1000;
      audio.transmissionTick(ms);
    }
    expect(audio.snapshot().transmissionTicks).toBe(
      transmissionTicksFor(REVEAL_CEILING_MS),
    );
    audio.endTransmission();
    // ONE release is enough, because there was one duck.
    expect(graph.ducker.ducking).toBe(false);
  });

  /**
   * THE IMPATIENT PLAYER. A key press completes the page, which ends the
   * transmission - so the music comes back on the same keystroke rather than
   * running its remaining 1.5 s ducked against a screen that has stopped
   * transmitting, and no further ticks sound.
   *
   * WATCHED FAILING with the `if (!transmitting) return false;` guard removed
   * from `transmissionTick`:
   *   AssertionError: ticks after the skip: expected 10 to be 4
   *   // Object.is equality
   */
  it("a skip stops the ticks dead and hands the music straight back", () => {
    const { ctx, graph } = graphFor();
    const audio = installAudio({ graph });
    audio.beginTransmission("briefing:reveal");
    for (let ms = 0; ms < 160; ms += 8) {
      ctx.currentTime = ms / 1000;
      audio.transmissionTick(ms);
    }
    const atSkip = audio.snapshot().transmissionTicks;
    expect(atSkip).toBe(4);

    audio.endTransmission();
    expect(graph.ducker.ducking).toBe(false);

    // Frames keep arriving for one more tick of the scene's update loop.
    for (let ms = 160; ms < 400; ms += 8) {
      ctx.currentTime = ms / 1000;
      audio.transmissionTick(ms);
    }
    expect(audio.snapshot().transmissionTicks, "ticks after the skip").toBe(atSkip);
  });

  /**
   * A SCENE TORN DOWN MID-REVEAL MUST NOT LEAVE THE MIX 6 dB QUIET FOREVER.
   * Seven stops is seven `scene.restart()`s in the e2e sweep alone.
   */
  it("dispose closes a duck left open by a page that never finished", () => {
    const { ctx, graph } = graphFor();
    const audio = installAudio({ graph });
    audio.beginTransmission("briefing:reveal");
    expect(graph.ducker.ducking).toBe(true);
    audio.dispose();
    expect(graph.ducker.ducking).toBe(false);
    // ...and endTransmission is idempotent, because the scene's `finishReveal`
    // and its `teardown` both call it on the same frame.
    audio.endTransmission();
    expect(graph.ducker.ducking).toBe(false);
  });

  it("records how the ticks were reached, so a silent reveal is visible", () => {
    const { ctx, graph } = graphFor();
    const audio = installAudio({ graph });
    expect(audio.snapshot().transmissionTicks).toBe(0);
    audio.beginTransmission("briefing:reveal");
    audio.transmissionTick(0);
    const snap = audio.snapshot();
    expect(snap.transmissionTicks).toBe(1);
    expect(snap.transmissionVia).toEqual(["briefing:reveal"]);
  });
});
