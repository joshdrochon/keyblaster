/**
 * WHAT THE GAME ACTUALLY SOUNDS LIKE.
 *
 * Every other test in this lane reads the graph: which nodes were made, what
 * numbers were written to them, which order things happened in. Not one of them
 * can fail when the game sounds wrong, and three user reports in a row were
 * about exactly that - a hum, a pop, and a warp stinger that is unpleasant
 * rather than rewarding. So these tests RENDER, through `offline.ts`, and assert
 * on samples.
 *
 * Each bar below is the signal's own statistic or a measured number from the
 * defect it replaced, never a constant chosen to make the current build pass.
 * The failing-first run for each is recorded next to the assertion.
 */

import { describe, expect, it } from "vitest";
import {
  OfflineAudioContextLike,
  RENDER_QUANTUM,
  bandEnergyFraction,
  bandRms,
  largestStep,
  peak,
  rms,
  spectralRolloffHz,
  stepQuantile,
  tonality,
  envelope,
  envelopeAutocorrelation,
} from "./offline.js";
import {
  AMBIENT_BEDS,
  AmbientBus,
  WIND_LOOP_SECONDS,
  WIND_LOOP_SECONDS_B,
  WIND_SEEDS,
  bedBreath,
  bedSpec,
  windCompositePeriodSeconds,
  windLoopSamples,
  windOffsetFor,
} from "../../../src/game/audio/ambient.js";
import {
  GENTLE_EVENTS,
  GENTLE_LIMITS,
  SFX_EVENTS,
  SFX_SCHEDULE_LOOKAHEAD_MS,
  SfxBus,
  sfxLookaheadSeconds,
  variantsFor,
  type SfxEventId,
  type SfxVariant,
} from "../../../src/game/audio/sfx.js";
import { KeystrokeTone, WORD_OPENING_SEMITONES, frequencyFor } from "../../../src/game/audio/keystrokeTone.js";
import { SHADOW_CHIRP, chirpDurationMs, chirpPeakGain, chirpSeparation, playChirp } from "../../../src/game/audio/chirp.js";
import { DUCK_ATTACK_MS, buildAudioGraph, busSpec } from "../../../src/game/audio/graph.js";
import { installAudio, type ChannelHandler } from "../../../src/game/audio/wiring.js";
import { MAX_INTENSITY_INDEX } from "../../../src/game/audio/music.js";
import {
  CRUMBLE_VARIANTS,
  crumbleSamples,
  crumbleSeed,
  onsetTimes,
} from "../../../src/game/audio/crumble.js";
import { seededRandom, type AudioContextLike, type AudioNodeLike } from "../../../src/game/audio/context.js";
import { fakeVoiceEnvironment } from "./fakes.js";

const SR = 48000;

/** Master x bus, so every level below is what reaches the speaker. */
const busChain = (bus: "ambient" | "sfx" | "voice"): number =>
  busSpec("master").gain * busSpec(bus).gain;

/** A rendering context with one bus gain already applied. */
function onBus(bus: "ambient" | "sfx" | "voice"): {
  ctx: OfflineAudioContextLike;
  output: ReturnType<OfflineAudioContextLike["createGain"]>;
} {
  const ctx = new OfflineAudioContextLike(SR);
  const output = ctx.createGain();
  output.gain.value = busChain(bus);
  output.connect(ctx.destination);
  return { ctx, output };
}

function renderBed(stopId: (typeof AMBIENT_BEDS)[number]["stopId"], seconds = 12): Float32Array {
  const { ctx, output } = onBus("ambient");
  const bus = new AmbientBus(ctx, output);
  bus.start(stopId);
  return ctx.render(seconds, (_t, dtMs) => bus.advance(dtMs));
}

describe("UR-13: the bed is a thruster, not a hum", () => {
  // UR-13: the ambient bed was reported as an intrusive electrical buzz rather
  // than a ship. The target is a futuristic engine tone - subtle, and felt more
  // than heard.
  //
  // The ambient bed is the only continuous sound in the game, so it is the hum
  // whatever the player calls it. Rendered offline through its own bus, the old
  // bed measured, for Earth:
  //
  //   dominant bin        100.0 Hz   (the second harmonic of 50 Hz mains)
  //   energy in that bin  a steady four-partial sine stack
  //   95% rolloff         625 Hz
  //   rms at master       0.0853     (-21.4 dBFS, under everything, for minutes)
  //   peak at master      0.3398     (0.5137 on Jupiter)
  //
  // A steady tone stack IS a hum; that is not a tuning problem. The bed is now
  // filtered noise with a low tone under it, at about a tenth of the old tonal
  // weight and 11 dB quieter.

  /**
   * FAILED FIRST at `droneLevel: 1` with the old `1/(len*ratio)` partial
   * weights: Earth came back 0.3598, concentrated at 98.1 Hz - its drone
   * fundamental. Over a third of the bed's whole energy in one 0.73 Hz bin.
   * Noise cannot do that; only a tone can.
   */
  it("no bed puts its energy into a single tone", () => {
    for (const bed of AMBIENT_BEDS) {
      const samples = renderBed(bed.stopId);
      const { fraction, hz } = tonality(samples, SR);
      expect(fraction, `${bed.stopId} concentrates at ${hz.toFixed(1)} Hz`).toBeLessThan(0.08);
    }
  });

  /** A thruster is broadband under a lowpass. No bright harmonics, anywhere. */
  it("every bed is dark: almost nothing above 4 kHz, and 95% below 2.5 kHz", () => {
    for (const bed of AMBIENT_BEDS) {
      const samples = renderBed(bed.stopId);
      expect(bandEnergyFraction(samples, SR, 4000, SR / 2), bed.stopId).toBeLessThan(0.005);
      expect(spectralRolloffHz(samples, SR, 0.95), bed.stopId).toBeLessThan(2500);
    }
  });

  /**
   * FAILED FIRST at the old table: Earth rms 0.0783 against this 0.04 bar, and
   * Jupiter peaked at 0.5137. The ceiling is a budget for a sound that plays
   * under everything for minutes at a time, not a fit to the current numbers.
   */
  it("the bed sits under everything, at every stop", () => {
    for (const bed of AMBIENT_BEDS) {
      const samples = renderBed(bed.stopId);
      expect(rms(samples), `${bed.stopId} rms`).toBeLessThan(0.04);
      expect(peak(samples), `${bed.stopId} peak`).toBeLessThan(0.2);
    }
  });

  /**
   * The bed used to carry a sub-audio sine straight in its signal path: the
   * shimmer LFO was connected to the bed's FILTER INPUT rather than to a gain,
   * so it modulated nothing and offset everything. A DC term is what that looks
   * like from outside, and it is the regression this holds shut.
   *
   * FAILED FIRST with `shimmer.connect(filter)` restored: Mars came back at
   * 0.0039, twice this bar, from an LFO that was only ever offsetting it.
   */
  it("no bed carries a DC offset", () => {
    for (const bed of AMBIENT_BEDS) {
      const samples = renderBed(bed.stopId);
      const mean = samples.reduce((a, v) => a + v, 0) / samples.length;
      expect(Math.abs(mean), `${bed.stopId} dc`).toBeLessThan(0.002);
    }
  });

  /** It breathes rather than sits: the level really does move over a cycle. */
  it("the deepest-breathing bed is measurably quieter at its trough", () => {
    const spec = bedSpec("saturn");
    const cycleMs = 1000 / spec.shimmerHz;
    const samples = renderBed("saturn", (cycleMs / 1000) * 1.1);
    const window = Math.floor(SR * 0.6);
    const crest = rms(samples, 0, window);
    const troughAt = Math.floor((SR * cycleMs) / 2000);
    const trough = rms(samples, troughAt - window / 2, troughAt + window / 2);
    // Depth 0.26 is a 2.6 dB move at the trough; ask for most of it.
    expect(trough).toBeLessThan(crest * 0.85);
  });

  it("bedBreath only ever takes level away, and starts at full", () => {
    for (const bed of AMBIENT_BEDS) {
      expect(bedBreath(0, bed.shimmerHz, bed.shimmerDepth)).toBeCloseTo(1, 12);
      for (let ms = 0; ms < 60000; ms += 97) {
        const g = bedBreath(ms, bed.shimmerHz, bed.shimmerDepth);
        expect(g).toBeLessThanOrEqual(1 + 1e-12);
        expect(g).toBeGreaterThanOrEqual(1 - bed.shimmerDepth - 1e-12);
      }
    }
    // A bed with no movement asked for is exactly unity, not almost unity.
    expect(bedBreath(1234, 0, 0.5)).toBe(1);
    expect(bedBreath(1234, 0.2, 0)).toBe(1);
  });

  it("starting a bed does not click", () => {
    for (const bed of AMBIENT_BEDS) {
      const samples = renderBed(bed.stopId, 4);
      const onset = largestStep(samples, 1, SR / 10);
      // Against the bed's OWN step distribution over the rest of the render,
      // so there is no constant here to weaken.
      const ownStep = stepQuantile(samples, 0.9999, SR / 2, samples.length);
      expect(onset.step, `${bed.stopId} onset`).toBeLessThanOrEqual(ownStep * 2);
    }
  });
});

describe("UR-13: the warp takes off rather than tearing", () => {
  // The old stinger was a sawtooth and a square sweeping to 1400-1650 Hz under
  // a 6.4-7.2 kHz lowpass with half its level in noise. Rendered on the SFX bus:
  //
  //   variant   wave        peak     >4 kHz     95% rolloff
  //   warp.0    sawtooth    0.5229    6.29%      4725 Hz
  //   warp.1    square      0.5737    2.58%      2600 Hz
  //   warp.2    sawtooth    0.3636   16.72%      5875 Hz
  //
  // It is now a rising triangle on a real interval. FAILED FIRST with the old
  // table restored: warp.0 came back at 5.70% above 4 kHz against the 3% bar.

  const renderVariant = (event: "warp" | "warpCharge", index: number): Float32Array => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    // The rotation is a shuffle bag, so play until the wanted variant comes up,
    // each one on its own stretch of the timeline, and render only that stretch.
    for (let k = 0; k < 12; k++) {
      ctx.currentTime = k * 3;
      const played = bus.play(event);
      if (played.variant.index !== index) continue;
      ctx.currentTime = 0;
      const all = ctx.render(k * 3 + played.durationMs / 1000 + 0.2);
      return all.subarray(Math.floor(k * 3 * SR));
    }
    throw new Error(`variant ${event}.${index} never came up`);
  };

  it("the warp stinger is no longer bright or abrasive", () => {
    for (let i = 0; i < variantsFor("warp").length; i++) {
      const samples = renderVariant("warp", i);
      expect(bandEnergyFraction(samples, SR, 4000, SR / 2), `warp.${i} above 4k`).toBeLessThan(0.03);
      expect(peak(samples), `warp.${i} peak`).toBeLessThan(0.45);
    }
  });

  it("the warp stinger still RISES - it is a departure, not a fall", () => {
    for (const v of variantsFor("warp")) {
      expect(v.endHz / v.startHz, v.id).toBeGreaterThan(2);
    }
  });

  it("the warp is still the longest sound in the game (D62's full stinger)", () => {
    const longestWarp = Math.max(...variantsFor("warp").map((v) => v.durationMs));
    for (const event of ["lock", "keystroke", "typo", "blast", "hit", "shield", "beacon", "uiNav"] as const) {
      expect(Math.max(...variantsFor(event).map((v) => v.durationMs)), event).toBeLessThan(longestWarp);
    }
  });

  it("the warp charge no longer spools on a sawtooth", () => {
    // A sawtooth's harmonics fall at 1/n, so a 70 Hz one under a 1400 Hz
    // lowpass is twenty near-equal partials - the electrical buzz UR-13
    // describes, four times on the way up the meter.
    for (const v of variantsFor("warpCharge")) {
      expect(["sine", "triangle"], v.id).toContain(v.wave);
    }
  });
});

describe("UR-15: blips queued against a frozen clock do not stack into a pop", () => {
  // A browser will not start an AudioContext before a gesture, and a suspended
  // context's currentTime does not advance. The Title fires `uiNav` on
  // pointerOVER, which is not a gesture, so every hover before the first click
  // is scheduled at exactly t = 0 - same waveform, same phase, same 2 ms attack.
  // Rendered on the SFX bus, before the fix:
  //
  //   voices at t=0    1        2        3        5        8
  //   peak             0.0524   0.0810   0.0888   0.1557   0.2508
  //   largest step     0.00359  0.00549  0.00868  0.01644  0.02246
  //
  // Eight hovers was 4.8x the peak and 6.3x the sample-to-sample step of one
  // blip. FAILED FIRST by reverting `startTime()` to `this.ctx.currentTime`:
  // eight stacked hovers peaked at 0.2429 against a 0.1049 bar, which is two
  // times one blip's own peak.

  const stack = (n: number): Float32Array => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    ctx.currentTime = 0;
    for (let i = 0; i < n; i++) bus.play("uiNav");
    return ctx.render(0.6);
  };

  it("eight hovers before the first gesture are not one loud attack", () => {
    const one = stack(1);
    const eight = stack(8);
    // Eight small sounds spread over time are still eight small sounds. The bar
    // is the single blip's own peak and step, not an absolute level.
    expect(peak(eight)).toBeLessThan(peak(one) * 2);
    expect(largestStep(eight, 1, SR).step).toBeLessThan(largestStep(one, 1, SR).step * 2);
  });

  it("a running clock is untouched: the voice starts exactly when asked", () => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    // Two plays a real frame apart. Nothing is displaced, because nothing
    // coincides - this guard may only ever engage on a clock that has stopped.
    ctx.currentTime = 1;
    bus.play("uiNav");
    ctx.currentTime = 1.016;
    bus.play("uiNav");
    const samples = ctx.render(1.4);
    const first = largestStep(samples, Math.floor(0.99 * SR), Math.floor(1.01 * SR));
    expect(first.index / SR).toBeGreaterThanOrEqual(1);
    expect(first.index / SR).toBeLessThan(1.01);
  });
});

describe("UR-25: Shadow chirps, and never sounds like a keystroke", () => {
  it("the chirp is held well clear of the keystroke tick", () => {
    const gap = chirpSeparation();
    // Four axes at once, so no single retune can collapse the difference.
    expect(gap.durationRatio).toBeGreaterThan(3);
    expect(Math.abs(gap.semitonesFromKeystroke)).toBeGreaterThan(5);
    expect(gap.grains).toBeGreaterThan(1);
    expect(gap.risesWhereKeystrokeIsFlat).toBe(true);
  });

  it("the chirp is short and soft - it is not an alert", () => {
    expect(chirpDurationMs()).toBeLessThan(250);
    // Quieter than every reward sound, louder than the typo tick's ceiling is
    // irrelevant: this must simply never be the thing you notice.
    expect(chirpPeakGain()).toBeLessThan(Math.min(...variantsFor("beacon").map((v) => v.peakGain)));
    for (const grain of SHADOW_CHIRP) expect(grain.endHz).toBeGreaterThan(grain.startHz);
  });

  it("the chirp renders without a click at either end", () => {
    const { ctx, output } = onBus("voice");
    playChirp(ctx, output);
    const samples = ctx.render(0.5);
    const worst = largestStep(samples);
    // Against the chirp's own step distribution - a tone this smooth has no
    // room for an edge, and there is no constant here to weaken.
    expect(worst.step).toBeLessThan(stepQuantile(samples, 0.999) * 4);
    expect(peak(samples)).toBeGreaterThan(0.01);
  });

  it("the chirp is audible over a bed without fighting it", () => {
    const { ctx, output } = onBus("voice");
    playChirp(ctx, output);
    const chirp = ctx.render(0.5);
    const bed = renderBed("earth", 0.5);
    // It has to clear the thing it plays over, and it must not be a stinger.
    expect(peak(chirp)).toBeGreaterThan(peak(bed));
    expect(peak(chirp)).toBeLessThan(0.3);
  });
});

describe("UR-30: the blast has a body, and the typing is never the same twice", () => {
  // UR-30, two complaints. Destroying a rock landed with no weight, and the
  // per-keystroke cue was unsatisfying. Both were measured before either was
  // touched.

  const renderBlast = (index: number): Float32Array => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    for (let k = 0; k < 12; k++) {
      ctx.currentTime = k * 2;
      const played = bus.play("blast");
      if (played.variant.index !== index) continue;
      ctx.currentTime = 0;
      return ctx.render(k * 2 + 1.2).subarray(Math.floor(k * 2 * SR));
    }
    throw new Error(`blast.${index} never came up`);
  };

  /**
   * FAILED FIRST by deleting `sub` from the three blast recipes: blast.0's low
   * band came back at 0.0048 against this 0.15 bar. A destruction with half a
   * percent of its energy under 250 Hz has no weight, which is what "empty"
   * was describing.
   */
  it("the blast has weight under it", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      const samples = renderBlast(i);
      expect(bandEnergyFraction(samples, SR, 0, 250), `blast.${i} low band`).toBeGreaterThan(0.15);
    }
  });

  /**
   * AND THE CRACK IS STILL ON TOP OF IT - measured as SHAPE rather than level,
   * which is the honest way to ask it and turned out to be the more revealing
   * one.
   *
   * The old bar was `above 1 kHz > 8% of the attack's energy`. Chasing that
   * number after UR-48 would have meant putting the wash of white noise back,
   * because the hiss was most of what the old attack's high band WAS - and the
   * hiss is the explosion the report asked to be rid of.
   *
   * What "it still cracks" actually means is that the sound STARTS with an edge
   * rather than fading up. So: the attack's high band against the BODY's high
   * band. A wash scores about 1. Measured, the old blast scored 173 to 1411 -
   * not a sharper transient but an EMPTY BODY, essentially nothing above 1 kHz
   * after 150 ms, which is the clearest single number for why it read as a bomb
   * and then silence. The crumble scores 5 to 7: a real edge, and then a rock.
   */
  it("the blast still cracks before it thumps", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      const samples = renderBlast(i);
      const attack = bandRms(samples.subarray(0, Math.floor(SR * 0.05)), SR, 1000, SR / 2);
      const body = bandRms(
        samples.subarray(Math.floor(SR * 0.15), Math.floor(SR * 0.5)),
        SR,
        1000,
        SR / 2,
      );
      expect(attack / body, `blast.${i} transient over body`).toBeGreaterThan(3);
    }
  });

  /**
   * It rings out. FAILED FIRST with `sub` deleted: blast.0's tail to -30 dB was
   * 114 ms against this 140 ms bar.
   */
  it("the blast has a tail", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      const samples = renderBlast(i);
      const pk = peak(samples);
      let last = 0;
      for (let j = samples.length - 1; j > 0; j--) {
        if (Math.abs(samples[j] as number) > pk * 0.03) {
          last = j;
          break;
        }
      }
      expect((last / SR) * 1000, `blast.${i} tail ms`).toBeGreaterThan(140);
    }
  });

  /** Weight is not volume. The fix may not simply be a louder blast. */
  it("the blast did not get louder", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      expect(peak(renderBlast(i)), `blast.${i} peak`).toBeLessThan(0.45);
    }
  });

  /**
   * AC-6c.2 is about the RISE inside a word, and the rise is untouched: every
   * word is the same ladder, lifted. This is what stops the variation from
   * becoming a different feature.
   */
  it("the rise inside a word is exactly what it always was", () => {
    const { ctx, output } = onBus("sfx");
    const tone = new KeystrokeTone(ctx, output);
    for (let w = 0; w < WORD_OPENING_SEMITONES.length; w++) {
      const word = [1, 2, 3, 4, 5].map(() => tone.correct());
      for (let k = 1; k < word.length; k++) {
        const heard = (word[k] as { frequencyHz: number }).frequencyHz / (word[k - 1] as { frequencyHz: number }).frequencyHz;
        const written = frequencyFor(k + 1) / frequencyFor(k);
        expect(heard, `word ${w} step ${k}`).toBeCloseTo(written, 9);
      }
      tone.reset();
    }
  });

  /**
   * D31 / AC-22b.1. Checked because the coordinator asked, not because it was
   * suspected.
   *
   * THIS ASSERTION CHANGED SHAPE IN UR-34, and the reason matters. It used to
   * read `peak < 0.06` and `above 2 kHz < 1%`, which were measuring the KEY -
   * and in UR-34 the key gained a switch click, on a correct press and a
   * mistyped one alike, deliberately. An absolute bar on the typo cue stopped
   * describing the verdict the moment the key itself got a transient.
   *
   * What replaces it is the pair: the typo's TONE is still flat, dark and
   * quiet - that is the verdict, and it is asserted here on the recipe - while
   * "is the mistyped key louder or brighter than a correct one" is asserted by
   * comparison in the UR-34 block below, where it belongs. A relative bar alone
   * could be satisfied by making everything loud, so the absolute ceiling stays;
   * it is set at the measured worst press plus a little, not at a fit.
   */
  it("the typo cue is not a buzzer and never became one", () => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    for (let k = 0; k < 3; k++) {
      ctx.currentTime = k * 1;
      bus.play("typo");
    }
    ctx.currentTime = 0;
    const samples = ctx.render(3.2);
    expect(peak(samples)).toBeLessThan(0.35);
    // The verdict layer itself: flat pitch, dark filter, no noise edge, quiet.
    // A falling interval is the universal "wrong" cue and this game has none.
    for (const v of variantsFor("typo")) {
      expect(v.endHz, v.id).toBeCloseTo(v.startHz, 9);
      expect(v.harshness, v.id).toBe(0);
      expect(v.filterHz, v.id).toBeLessThanOrEqual(2000);
      expect(v.peakGain, v.id).toBeLessThanOrEqual(0.05);
    }
  });
});

describe("UR-34: every key has a switch under it, and no two are alike", () => {
  // UR-34: sound is an effective proxy for touch, so every keystroke should
  // carry a sharp mechanical-keyboard click.
  //
  // Measured before anything was added, the keystroke cue had NO transient: its
  // first five milliseconds carried 0.4-1.8% of their energy above 4 kHz and
  // rose to a peak of 0.035-0.048 over 0.81-2.31 ms. A soft tone cannot feel
  // like touching something, because touch is an edge.
  //
  // It is now three layers: a click (the switch), a sub (the case thock) and
  // the pentatonic tone (D75's progress signal), which is deliberately
  // untouched - losing the ladder to gain a click would be a bad trade.

  const playMany = (event: SfxEventId, count: number, gap = 0.5) => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    for (let k = 0; k < count; k++) {
      ctx.currentTime = k * gap;
      bus.play(event);
    }
    ctx.currentTime = 0;
    const all = ctx.render(count * gap + 0.5);
    return {
      history: bus.history(),
      at: (k: number, seconds = 0.3): Float32Array =>
        all.subarray(Math.floor(k * gap * SR), Math.floor((k * gap + seconds) * SR)),
      /**
       * The window that opens where the voice actually SOUNDS, rather than
       * where `play()` was called.
       *
       * UR-55: a voice is scheduled `sfxLookaheadSeconds` past the clock,
       * because `currentTime` names audio the renderer has already produced and
       * an envelope scheduled behind it is skipped rather than shortened. A
       * 6 ms window anchored on the call instant therefore opens on silence and
       * measures nothing - which is what `expected 0 to be greater than 0.1`
       * meant the first time this ran after the lookahead landed, and it is a
       * fact about the window, not about the click.
       */
      attack: (k: number, seconds: number): Float32Array => {
        const from = Math.floor(k * gap * SR);
        const limit = Math.floor((k * gap + 0.4) * SR);
        let onset = from;
        while (onset < limit && Math.abs(all[onset] as number) < 1e-6) onset++;
        return all.subarray(onset, onset + Math.floor(seconds * SR));
      },
    };
  };

  /**
   * FAILED FIRST with `click` deleted from the three keystroke recipes: 0.0%,
   * because there was nothing above 2 kHz in the attack at all.
   */
  it("the attack of a key is mostly high frequency - it is a click", () => {
    const belt = playMany("keystroke", 30);
    const highs: number[] = [];
    for (let k = 0; k < 30; k++) {
      highs.push(bandEnergyFraction(belt.attack(k, 0.006), SR, 2000, SR / 2));
    }
    highs.sort((a, b) => a - b);
    // Every single press, not just the median: this fires hundreds of times and
    // a cue that is sometimes a click and sometimes a thud reads as a fault.
    expect(highs[0] as number).toBeGreaterThan(0.1);
  });

  /**
   * An edge, not a swell.
   *
   * MEASURED AS A MEDIAN OVER THIRTY PRESSES, not per press, and that is a
   * deliberate choice rather than a softer bar. The click is noise, so its
   * realised peak inside a 17-sample envelope varies about two to one from
   * press to press; "time to 90% of this press's peak" is therefore a noisy
   * statistic and one press in twelve lands late for no reason a listener could
   * hear. The median is stable and still discriminates: the old cue's attack
   * peaked at its tone's envelope apex, 0.81-2.31 ms in.
   */
  it("the median key press reaches its attack peak in well under a millisecond", () => {
    const belt = playMany("keystroke", 30);
    const rises: number[] = [];
    for (let k = 0; k < 30; k++) {
      const s = belt.at(k, 0.006);
      const pk = peak(s);
      for (let i = 0; i < s.length; i++) {
        if (Math.abs(s[i] as number) >= pk * 0.9) {
          rises.push((i / SR) * 1000);
          break;
        }
      }
    }
    rises.sort((a, b) => a - b);
    expect(rises[15] as number).toBeLessThan(0.7);
  });

  /**
   * UR-44 - THE GENTLE BUDGET, MEASURED ON THE RENDER.
   *
   * I INTRODUCED THIS DEFECT AND THIS TEST IS THE GUARD THAT WOULD HAVE CAUGHT
   * IT. `sfx.test.ts` asserts `GENTLE_LIMITS` against `v.peakGain` - a DECLARED
   * FIELD - so the click and sub layers I added in UR-34 sat on top of the
   * budget without ever touching it. Rendered, the typo cue reached 0.222 while
   * a hull hit reached 0.070: a mistyped key landed three times harder than
   * being struck by a rock, which is failure vocabulary expressed as volume.
   *
   * A declared number cannot police a sum of layers. This measures the sound.
   */
  it("D31: every gentle event is inside its budget WHEN RENDERED, not just declared", () => {
    // The budget is the declared ceiling put through the buses it really goes
    // through - derived, so retuning the mix moves it and nobody has to notice.
    const ceiling = GENTLE_LIMITS.maxPeakGain * busChain("sfx");
    for (const event of GENTLE_EVENTS) {
      const belt = playMany(event, 24, 2.2);
      const peaks = Array.from({ length: 24 }, (_, k) => peak(belt.at(k, 2)));
      expect(Math.max(...peaks), `${event} rendered peak`).toBeLessThan(ceiling);
    }
  });

  /**
   * D31 again, and the part the declared budget could never express: the typo
   * must be the gentlest thing in the game, against every other event as it is
   * actually rendered rather than against its own recipe.
   */
  it("D31: a mistyped key is the quietest sound the game makes", () => {
    const loudest = (event: SfxEventId): number => {
      const belt = playMany(event, 12, 2.2);
      return Math.max(...Array.from({ length: 12 }, (_, k) => peak(belt.at(k, 2))));
    };
    const typo = loudest("typo");
    for (const event of SFX_EVENTS) {
      if (event === "typo") continue;
      expect(typo, `typo vs ${event}`).toBeLessThan(loudest(event));
    }
  });

  /**
   * THE REPETITION TRAP. Two presses of the SAME variant must still not be the
   * same sound: the click's band and level are drawn fresh, and the noise is
   * read from a different place in the buffer every time.
   *
   * FAILED FIRST by reverting `noise.start(now, this.noiseOffset())` to
   * `noise.start(now)` and dropping `CLICK_JITTER` - two presses of one variant
   * were then bit-identical, max difference 0.0.
   */
  it("two presses of the same switch are not the same sound", () => {
    const belt = playMany("keystroke", 15);
    const byVariant = new Map<string, number[]>();
    belt.history.forEach((play, k) => {
      const list = byVariant.get(play.variant.id) ?? [];
      list.push(k);
      byVariant.set(play.variant.id, list);
    });
    let compared = 0;
    for (const indices of byVariant.values()) {
      for (let a = 0; a < indices.length - 1; a++) {
        const first = belt.at(indices[a] as number, 0.05);
        const second = belt.at(indices[a + 1] as number, 0.05);
        let diff = 0;
        const shared = Math.min(first.length, second.length);
        for (let i = 0; i < shared; i++) {
          diff = Math.max(diff, Math.abs((first[i] as number) - (second[i] as number)));
        }
        // As different as a keypress is loud. Not a nudge - a different press.
        expect(diff).toBeGreaterThan(peak(first) * 0.4);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(5);
  });

  /**
   * AND THE WHOLE BELT DID NOT GET LOUDER. This is the number that decides
   * whether a cue firing three hundred times is bearable, and it is why the
   * clack is a transient rather than more level: forty words with typos, locks
   * and blasts measured rms 0.0211 before the clack and 0.0227 after - six
   * tenths of a decibel.
   */
  it("a forty-word belt is no louder than it was without the clack", () => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    const tone = new KeystrokeTone(ctx, output);
    let t = 0;
    for (let word = 0; word < 40; word++) {
      const letters = 4 + (word % 4);
      for (let k = 0; k < letters; k++) {
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
    expect(rms(belt)).toBeLessThan(0.03);
    expect(peak(belt)).toBeLessThan(0.6);
  });
});

/**
 * UR-30, REOPENED - THE BELT, DRIVEN THE WAY THE GAME DRIVES IT.
 *
 * ================== WHY THIS BLOCK EXISTS ==================
 *
 * The first version of this measurement called `tone.correct()` five times and
 * `tone.reset()` once, twenty times over, and reported "five distinct tones
 * across a hundred presses; word ten is bit-identical to word one". Every
 * number in it was true of the harness and none of it was true of the game,
 * because `KeystrokeTone.reset()` had exactly ONE caller in src/ -
 * `FlightScene.create()`, once per STAGE - and no caller at a word boundary at
 * all. My harness reset per word. The product did not. The fix looked like it
 * worked because the check and the thing had the same bug.
 *
 * That is the eighth instance of the class in docs/verification-gaps.md: "a
 * check exercises something adjacent to the shipped thing, passes, and is
 * believed". So this block does not touch `KeystrokeTone` at all. It builds the
 * real graph, installs the real wiring, and emits the real cue payloads on the
 * real event channel - the identical path `FlightScene.cue()` takes - and then
 * reads what came out. If a later change moves the word boundary out of the cue
 * stream again, there is no harness left that can paper over it.
 *
 * WHAT THE SHIPPING BELT MEASURED BEFORE THE FIX (290 keys, 100% accuracy):
 *   key 1 = 329.6 Hz, key 5 = 554.4, key 10 = 1108.7, key 14 = 1975.5,
 *   keys 15..290 = 2217.5 Hz - `pitchIndexFor` caps at 14.
 * 95% of a belt on one note, and WORSE THE BETTER THE CHILD TYPED, because only
 * a typo cleared the ladder: 2% of keys on the top note at 80% accuracy, 89% at
 * 98%. The negative control below reproduces exactly that.
 */
describe("UR-30: the pitch ladder, driven through the shipping cue stream", () => {
  const CUE_EVENT = "kb:flight:cue";

  /** A two-method stand-in for `game.events`; Phaser is not imported here. */
  class FakeChannel {
    private readonly handlers = new Map<string, Set<ChannelHandler>>();
    on(event: string, handler: ChannelHandler): void {
      const set = this.handlers.get(event) ?? new Set<ChannelHandler>();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: ChannelHandler): void {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, payload?: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
    }
  }

  interface Belt {
    readonly frequencies: readonly number[];
    readonly toneResets: number;
    /**
     * Rendered on demand. A 58-word belt puts ~300 keystroke oscillators and a
     * full graph through ninety seconds of 128-sample blocks; the pitch
     * questions need none of that, and paying for it four times over would make
     * this file take minutes to answer a question about a list of numbers.
     */
    render(): Float32Array;
  }

  /**
   * Fly a belt by emitting the cues `FlightScene` emits, in the order it emits
   * them: a lock when a rock is targeted, a keystroke per letter, a blast when
   * the word finishes. `suppressWordEnd` is the negative control - it withholds
   * the word-ending cue and nothing else, which is precisely the state the game
   * was in before this fix.
   */
  const flyBelt = (options: {
    words: number;
    accuracy: number;
    suppressWordEnd?: boolean;
    silenceBeds?: boolean;
  }): Belt => {
    const ctx = new OfflineAudioContextLike(SR);
    const graph = buildAudioGraph(ctx, {
      voiceEnv: fakeVoiceEnvironment(null).env,
      rand: seededRandom(0x51a9c3),
    });
    const channel = new FakeChannel();
    const service = installAudio({
      graph,
      events: channel,
      cueEvent: CUE_EVENT,
      registry: { get: () => undefined, set: () => undefined },
    });

    if (options.silenceBeds === true) {
      graph.setBusGain("music", 0);
      graph.setBusGain("ambient", 0);
    }

    const rng = seededRandom(0x2c81f7);
    let t = 0;
    const cue = (name: string): void => {
      ctx.currentTime = t;
      channel.emit(CUE_EVENT, { cue: name });
    };
    for (let word = 0; word < options.words; word++) {
      cue("lock");
      t += 0.2;
      const letters = 4 + (word % 4);
      for (let k = 0; k < letters; k++) {
        if (rng() > options.accuracy) {
          cue("typo");
          t += 0.24;
        }
        cue("keystroke");
        t += 0.19;
      }
      if (options.suppressWordEnd !== true) cue("blast");
      t += 0.75;
    }

    ctx.currentTime = 0;
    return {
      frequencies: graph.keystrokeTone.history().map((h) => h.frequencyHz),
      toneResets: service.snapshot().toneResets,
      render: () => ctx.render(t + 1),
    };
  };

  /** How much of a belt sits on its single most repeated note. */
  const worstNoteShare = (frequencies: readonly number[]): number => {
    const counts = new Map<string, number>();
    for (const hz of frequencies) {
      const key = hz.toFixed(2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Math.max(...counts.values()) / frequencies.length;
  };

  it("the word boundary reaches the ladder from the cue stream alone", () => {
    const belt = flyBelt({ words: 58, accuracy: 1 });
    // One reset per word, delivered by `blast`, with no scene calling anything.
    expect(belt.toneResets).toBe(58);
  });

  /**
   * FAILED FIRST, and the negative control below is the same measurement with
   * the word-ending cue withheld, so the bar can never be satisfied by a
   * harness that resets on its own.
   */
  it("a 58-word belt at 100% accuracy is not spent on one note", () => {
    const belt = flyBelt({ words: 58, accuracy: 1 });
    expect(belt.frequencies.length).toBeGreaterThan(250);
    expect(worstNoteShare(belt.frequencies)).toBeLessThan(0.35);
    expect(new Set(belt.frequencies.map((f) => f.toFixed(2))).size).toBeGreaterThanOrEqual(12);
  });

  it("NEGATIVE CONTROL: without the word-ending cue the belt collapses onto one note", () => {
    const belt = flyBelt({ words: 58, accuracy: 1, suppressWordEnd: true });
    expect(belt.toneResets).toBe(0);
    // This is the shipped defect, reproduced: the ladder caps and stays there.
    expect(worstNoteShare(belt.frequencies)).toBeGreaterThan(0.9);
  });

  /**
   * THE INVERSION THAT GAVE THE DEFECT AWAY. Before the fix, a typo was the only
   * thing that cleared the ladder, so a child who typed WELL heard one note and
   * a child who typed badly heard variety. Accuracy must not buy monotony.
   */
  it("typing better does not make the belt more monotonous", () => {
    const sloppy = worstNoteShare(flyBelt({ words: 58, accuracy: 0.8 }).frequencies);
    const sharp = worstNoteShare(flyBelt({ words: 58, accuracy: 1 }).frequencies);
    expect(sharp).toBeLessThan(sloppy * 1.6);
    expect(sharp).toBeLessThan(0.35);
  });

  /**
   * AND THE WHOLE BELT IS NOT LOUDER FOR THE CLACK. This is the number that
   * decides whether a cue firing three hundred times is bearable, and it is
   * measured on the same shipping path as everything else in this block.
   */
  /**
   * AND THE BELT IS NOT LOUDER FOR THE CLACK - the number that decides whether
   * a cue firing hundreds of times is bearable.
   *
   * Measured with the music and ambient buses muted, because the claim is about
   * the SFX belt and `buildAudioGraph` also starts the synthesised music stack
   * on a build with no tracks. Muted through the real bus gains rather than by
   * rendering a different graph: it is still the shipping path, with two faders
   * down.
   */
  it("a belt stays quiet", () => {
    const belt = flyBelt({ words: 10, accuracy: 0.95, silenceBeds: true });
    const samples = belt.render();
    expect(rms(samples)).toBeLessThan(0.03);
    expect(peak(samples)).toBeLessThan(0.6);
  });
});

/**
 * UR-45 - NO VARIANT MAY BE THE QUIET ONE.
 *
 * AC-21.3 asks for three variants per event so nothing fatigues. It says nothing
 * about their LEVELS, and nothing checked them, so the table quietly grew a rule
 * nobody wrote: whichever variant used a bandpass was inaudible next to its
 * siblings. Rendered variant by variant, before the fix:
 *
 *   warp        17.6 dB    warp.2       bandpass @ 1800, tone  220 -> 880 Hz
 *   warpCharge  15.5 dB    warpCharge.2 bandpass @  700, tone   62 -> 247 Hz
 *   lock        12.7 dB    lock.2       bandpass @ 1600, tone  470 -> 705 Hz
 *   shield       9.2 dB    shield.0/.2  bandpass @ 900 / 760
 *   blast        2.9 dB    beacon 0.9, hit 1.3, typo 1.3, uiNav 1.8, keystroke 2.8
 *
 * Every event whose variants are all lowpass or highpass sat inside 3 dB; every
 * event with a bandpass did not. So one warp takeoff in three was 17 dB down on
 * the loudest moment in the game, and a player heard the warp "work" twice and
 * fail once with no pattern they could name.
 *
 * The rotation makes this worse than it sounds: the shuffle bag guarantees the
 * quiet variant comes up exactly as often as the others.
 */
describe("UR-45: the three variants of an event are the same size", () => {
  const renderVariant = (variant: SfxVariant): Float32Array => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    (
      bus as unknown as {
        voice: (v: SfxVariant, a: number, b: number, c: number) => void;
      }
    ).voice(variant, variant.startHz, variant.endHz, variant.peakGain);
    return ctx.render(variant.durationMs / 1000 + 0.6);
  };

  /**
   * FAILED FIRST on the shipped table: warp 17.6 dB, warpCharge 15.5, lock 12.7,
   * shield 9.2. The bar is 6 dB - a factor of two in peak - which is looser than
   * every event that was already correct (all inside 3.3 dB) and tight enough
   * that a variant cannot go missing.
   */
  it("no event has a variant more than 6 dB quieter than its loudest sibling", () => {
    for (const event of SFX_EVENTS) {
      const peaks = variantsFor(event).map((v) => peak(renderVariant(v)));
      const spreadDb = 20 * Math.log10(Math.max(...peaks) / Math.max(1e-9, Math.min(...peaks)));
      expect(spreadDb, `${event} sibling spread`).toBeLessThan(6);
    }
  });

  /**
   * THE RULE THAT CAUSED IT, stated so it cannot be re-broken by a retune that
   * happens to keep the levels close. A bandpass centred outside its own tone's
   * sweep deletes the fundamental and leaves harmonics; a triangle's harmonics
   * are 1/n^2, which is why warp.2 vanished when UR-13 moved its tone two
   * octaves down and left the filter at 1800 Hz.
   */
  it("every bandpass sits inside the sweep of the tone it filters", () => {
    for (const event of SFX_EVENTS) {
      for (const v of variantsFor(event)) {
        if (v.filterKind !== "bandpass") continue;
        const lo = Math.min(v.startHz, v.endHz);
        const hi = Math.max(v.startHz, v.endHz);
        expect(v.filterHz, `${v.id} centre vs ${lo}-${hi} Hz`).toBeGreaterThanOrEqual(lo);
        expect(v.filterHz, `${v.id} centre vs ${lo}-${hi} Hz`).toBeLessThanOrEqual(hi);
      }
    }
  });
});

/**
 * UR-43 - THE WIND MUST NOT REPEAT INSIDE A BELT.
 *
 * The bed ran one 4.000 s noise buffer on a fixed seed, shared by all seven
 * planets. Measured as envelope autocorrelation it was perfectly periodic:
 * r = 0.87-0.99 at 4.00 s and 8.00 s lag against a median of 0.03 at every
 * other lag, with 3.2-4.5 dB of gust movement to latch onto, repeated fifteen
 * to twenty-two times a belt and identically on every world.
 *
 * UR-10 proved that loop's SEAM was clean and never measured its PERIOD. That
 * is the same miss that produced the original hum complaint: the neighbouring
 * property assumed because the one in hand was checked.
 *
 * No measurement can settle whether a four-second repeat is invisible or
 * maddening; only an ear can. So these tests do not argue that it was fine.
 * They assert that the question cannot arise.
 */
describe("UR-43: the wind does not repeat inside a belt", () => {
  it("the two layers are coprime, so the pair outlasts a belt", () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    expect(gcd(WIND_LOOP_SECONDS, WIND_LOOP_SECONDS_B)).toBe(1);
    // A belt is roughly 90 s. The pair may not come round inside one.
    expect(windCompositePeriodSeconds()).toBeGreaterThanOrEqual(120);
  });

  it("no two worlds hear the same gust", () => {
    for (const layer of ["a", "b"] as const) {
      const offsets = AMBIENT_BEDS.map((b) => windOffsetFor(b.stopId, layer).toFixed(6));
      expect(new Set(offsets).size, `layer ${layer}`).toBe(AMBIENT_BEDS.length);
    }
    // And the two layers do not start together either, or the pair would have
    // one phase and the offsets would only be moving it around.
    for (const bed of AMBIENT_BEDS) {
      expect(windOffsetFor(bed.stopId, "a")).not.toBeCloseTo(windOffsetFor(bed.stopId, "b"), 3);
    }
  });

  /**
   * FAILED FIRST on the single 4 s layer: the old bed scored 0.94 at 4.00 s and
   * 0.90 at 8.00 s against this 0.5 bar. Measured the way the ear works - the
   * gust contour, not the samples.
   */
  it("the gust pattern does not come round at any lag a belt contains", () => {
    for (const stopId of ["earth", "jupiter", "pluto"] as const) {
      const samples = renderBed(stopId, 32);
      const env = envelope(samples, SR);
      let worst = 0;
      let worstLag = 0;
      // Every lag from 2 s to 15 s, in 50 ms steps - the old 4.00 s period is
      // inside this range, and so is either layer on its own.
      for (let lag = 2; lag <= 15; lag += 0.05) {
        const r = Math.abs(envelopeAutocorrelation(env, SR, lag));
        if (r > worst) {
          worst = r;
          worstLag = lag;
        }
      }
      expect(worst, `${stopId} repeats at ${worstLag.toFixed(2)} s`).toBeLessThan(0.5);
    }
  });

  it("UR-10 still holds: both layers join cleanly at their own seam", () => {
    for (const [seconds, seed] of [
      [WIND_LOOP_SECONDS, WIND_SEEDS.a],
      [WIND_LOOP_SECONDS_B, WIND_SEEDS.b],
    ] as const) {
      const x = windLoopSamples(SR, seconds, seed);
      const n = x.length;
      let maxInterior = 0;
      for (let i = 1; i < n; i++) {
        maxInterior = Math.max(maxInterior, Math.abs((x[i] as number) - (x[i - 1] as number)));
      }
      const seam = Math.abs((x[0] as number) - (x[n - 1] as number));
      expect(seam, `seam of the ${seconds}s layer`).toBeLessThanOrEqual(maxInterior);
    }
  });
});

/**
 * UR-46 - AC-21.4's DUCK, MEASURED IN AUDIO.
 *
 * `audio-graph.json` has been reporting `duckDb: -6` as the evidence for
 * AC-21.4, and that number never came from a sound. `measureReductionDb` read
 * `gain.value` immediately after scheduling a `linearRampToValueAtTime`; a real
 * `AudioParam` does not move until the automation runs, so on the shipping
 * context that read is 0. It returned -6 only because `NullParam` applies ramps
 * synchronously - and the evidence emitter runs on `NullAudioContext`. The
 * artifact was describing the harness.
 *
 * The feature itself is fine. This is the check that says so, and it is the one
 * that would fail if the ramp were never scheduled, aimed at the wrong bus, or
 * cancelled by the next frame - none of which the artifact could ever have seen.
 */
describe("UR-46: the duck is real, and the evidence no longer pretends to hear it", () => {
  const SETTLE = DUCK_ATTACK_MS / 1000;

  it("AC-21.4: the music bus really drops at least 6 dB when Shadow speaks", () => {
    const ctx = new OfflineAudioContextLike(SR);
    const graph = buildAudioGraph(ctx, {
      voiceEnv: fakeVoiceEnvironment(null).env,
      rand: seededRandom(0x4411aa),
    });
    // The synthesised music bed is what plays on a build with no tracks, which
    // is what this graph is. Nothing else needs to make a sound for a level
    // measurement.
    graph.setBusGain("ambient", 0);

    let ducked = false;
    const samples = ctx.render(3, (startTime) => {
      if (!ducked && startTime >= 1) {
        ducked = true;
        graph.ducker.duck(true);
      }
    });

    const before = rms(samples, Math.floor(0.4 * SR), Math.floor(0.95 * SR));
    const during = rms(
      samples,
      Math.floor((1 + SETTLE + 0.1) * SR),
      Math.floor(2.8 * SR),
    );
    const reductionDb = 20 * Math.log10(during / before);
    expect(reductionDb).toBeLessThanOrEqual(-6 + 0.25);
    // And it is a duck, not a mute: the bed is still there underneath.
    expect(during).toBeGreaterThan(0);
  });

  /**
   * THE PROOF THAT THE OLD EVIDENCE WAS FICTION, kept as a test so nobody
   * reinstates the shortcut. On a context that actually renders, reading the
   * param back straight after the ramp reports NO reduction at all - which is
   * what the shipping game would have reported, had anything asked it there.
   */
  it("reading gain.value straight after a ramp reports nothing on a real context", () => {
    const ctx = new OfflineAudioContextLike(SR);
    const graph = buildAudioGraph(ctx, {
      voiceEnv: fakeVoiceEnvironment(null).env,
      rand: seededRandom(0x4411aa),
    });
    const before = graph.buses.music.gain.value;
    graph.ducker.duck(true);
    const readBackDb = 20 * Math.log10(graph.buses.music.gain.value / before);
    expect(readBackDb).toBeCloseTo(0, 6);

    // What the ducker COMMITTED is knowable on any context, and that is what
    // the artifact reports now.
    expect(graph.ducker.scheduledReductionDb()["music"]).toBeLessThanOrEqual(-6);
  });
});

/**
 * A-21.2 - THE INTENSITY INDEX, DRIVEN THE WAY THE GAME DRIVES IT.
 *
 * The rubric item failed on its WIRED predicate: "the index moved on live HUD
 * liveCount/combo during real play". It turned out the index moves perfectly and
 * the EVIDENCE was being deleted - two specs in `audio-wiring.spec.ts` both
 * wrote `evidence["music"]`, and the later one assigned over the top of the
 * earlier, dropping `hudSamples`, `indicesObserved` and `drivenBy` before the
 * artifact was written.
 *
 * That is an evidence bug, and fixing evidence does not prove a feature. So this
 * proves the feature, here, on the shipping path: the real graph, the real
 * wiring, and HUD payloads of exactly the shape `FlightScene.snapshot()` emits,
 * on exactly the channel `boot.ts` subscribes. Nothing in this block calls
 * `MusicBus` directly - if the HUD field names drifted, or the subscription were
 * dropped, this goes red and no artifact can hide it.
 */
describe("A-21.2: the music index follows live asteroids and combo", () => {
  const HUD_EVENT = "kb:flight:hud";

  class FakeChannel {
    private readonly handlers = new Map<string, Set<ChannelHandler>>();
    on(event: string, handler: ChannelHandler): void {
      const set = this.handlers.get(event) ?? new Set<ChannelHandler>();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: ChannelHandler): void {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, payload?: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
    }
  }

  /** Exactly the fields `FlightScene.snapshot()` puts on the HUD event. */
  const hud = (liveCount: number, combo: number): Record<string, unknown> => ({
    stopName: "Mars",
    wpm: 24,
    accuracy: 0.9,
    combo,
    multiplier: 1,
    score: 100,
    hull: 3,
    maxHull: 3,
    liveCount,
    accent: "#F26A4B",
    plate: "#101826",
    plateText: "#F7F3E8",
  });

  const flyStage = (
    stream: ReadonlyArray<{ live: number; combo: number }>,
  ): { indices: number[]; hudSamples: number; samples: Float32Array } => {
    const ctx = new OfflineAudioContextLike(SR);
    const graph = buildAudioGraph(ctx, {
      voiceEnv: fakeVoiceEnvironment(null).env,
      rand: seededRandom(0x7ac41b),
    });
    const channel = new FakeChannel();
    const service = installAudio({
      graph,
      events: channel,
      hudEvent: HUD_EVENT,
      registry: { get: () => undefined, set: () => undefined },
    });
    graph.setBusGain("ambient", 0);

    // The HUD publishes about every 100 ms; the graph is advanced every frame.
    let next = 0;
    const samples = ctx.render(stream.length * 0.1 + 0.5, (startTime, dtMs) => {
      graph.advance(dtMs);
      while (next < stream.length && startTime >= next * 0.1) {
        const step = stream[next] as { live: number; combo: number };
        channel.emit(HUD_EVENT, hud(step.live, step.combo));
        next += 1;
      }
    });
    const snap = service.snapshot();
    return { indices: [...snap.musicIndices], hudSamples: snap.hudSamples, samples };
  };

  it("a belt that fills and empties moves the index through every layer", () => {
    // A real stage: the board fills, a combo builds, rocks are cleared. The
    // thresholds are pressure 4 and 8 (INTENSITY_THRESHOLDS), and pressure is
    // asteroids + half the combo.
    const stream: Array<{ live: number; combo: number }> = [];
    for (const live of [0, 1, 2, 3, 5, 6, 8, 10, 7, 4, 2, 0]) {
      for (let hold = 0; hold < 16; hold++) stream.push({ live, combo: Math.min(10, live) });
    }
    const flown = flyStage(stream);

    expect(flown.hudSamples).toBe(stream.length);
    // The predicate A-21.2 actually asks for, measured here rather than read
    // out of a file: the index MOVED, through more than one value.
    expect(flown.indices.length).toBeGreaterThanOrEqual(2);
    // And it reached the top layer, so all three really are reachable in play.
    expect(flown.indices).toContain(0);
    expect(Math.max(...flown.indices)).toBe(MAX_INTENSITY_INDEX);
  });

  it("an empty board never leaves index 0, so the index is not just counting frames", () => {
    const flown = flyStage(Array.from({ length: 60 }, () => ({ live: 0, combo: 0 })));
    expect(flown.hudSamples).toBe(60);
    expect(flown.indices).toEqual([0]);
  });

  /**
   * UR-10's HAZARD, RE-CHECKED HERE BECAUSE THIS IS WHERE IT WOULD RETURN.
   *
   * `setFromState` runs on every HUD sample, and the live count crosses a
   * threshold repeatedly during a real stage - so an intensity ramp is
   * constantly being interrupted by the next one. That is exactly the shape
   * that snapped 23% of the mix in one frame before `crossfadeGains` started
   * every move from where the layers ARE. Rendered over a board that oscillates
   * across both thresholds, the output has to stay continuous.
   */
  it("UR-10: a board thrashing across both thresholds still does not click", () => {
    const stream: Array<{ live: number; combo: number }> = [];
    // Deliberately faster than a stage really changes: cross a threshold every
    // 300 ms, well inside the 1400 ms ramp, for twelve seconds.
    for (let i = 0; i < 40; i++) {
      const live = i % 2 === 0 ? 2 : 9;
      for (let hold = 0; hold < 3; hold++) stream.push({ live, combo: live });
    }
    const flown = flyStage(stream);
    expect(flown.indices.length).toBeGreaterThanOrEqual(2);

    const worst = largestStep(flown.samples);
    const ownStep = stepQuantile(flown.samples, 0.999);
    // Against the signal's own step distribution, as every click test here is.
    expect(worst.step).toBeLessThan(ownStep * 4);
  });
});

/**
 * UR-48 - THE ROCK COMES APART.
 *
 * "Is there any reason why when the asteroids are shot down they cant make a
 * nice crumbling sound? It needs to be the most satisfying part of the game."
 *
 * The blast was an explosion: a sweep, a wash of white noise, a sub, a tail.
 * The single number that gives that away is the high band AFTER the attack -
 * the old blast measured 0.00005 to 0.00032 there, which is nothing. It banged
 * and then there was only the sub. A rock coming apart keeps making sound while
 * the pieces fall.
 *
 * These are the properties that separate the two, and none of them can be
 * satisfied by a louder or a longer bang.
 */
describe("UR-48: a blasted rock crumbles rather than detonating", () => {
  const renderBlastAt = (index: number): Float32Array => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    for (let k = 0; k < 12; k++) {
      ctx.currentTime = k * 2;
      if (bus.play("blast").variant.index !== index) continue;
      ctx.currentTime = 0;
      return ctx.render(k * 2 + 1.2).subarray(Math.floor(k * 2 * SR));
    }
    throw new Error(`blast.${index} never came up`);
  };

  /**
   * THE CRUMBLE TEST. The old blast fails it by two to three orders of
   * magnitude - 0.00005 to 0.00032 against this 0.003 bar - because there was
   * nothing there at all after the bang.
   */
  it("there is still a rock falling apart 150 ms after the bang", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      const body = bandRms(
        renderBlastAt(i).subarray(Math.floor(SR * 0.15), Math.floor(SR * 0.5)),
        SR,
        1000,
        SR / 2,
      );
      expect(body, `blast.${i} body`).toBeGreaterThan(0.003);
    }
  });

  /**
   * GRANULAR, NOT ONE EVENT. A crumble is many small impacts; an explosion is
   * one. `onsetTimes` counts rises in the envelope that clear its own running
   * level, so the number is a property of the sound rather than of a threshold
   * someone picked. The old blast produces a single onset.
   */
  it("a blast is many fragments landing, not one impact", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      const onsets = onsetTimes(renderBlastAt(i), SR);
      expect(onsets.length, `blast.${i} onsets`).toBeGreaterThanOrEqual(6);
      // And they are spread through the fall, not all inside the attack.
      expect(onsets.filter((t) => t > 0.15).length, `blast.${i} late onsets`).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * THE REPETITION TRAP, and the one that worried me most. This fires about
   * fifty-eight times a belt, and a granular texture is the worst case: the ear
   * latches onto the pattern of the fragments far faster than onto an envelope.
   *
   * Twelve consecutive blasts, compared pairwise over their whole length. Two
   * that shared a crumble AND a playback rate would be nearly identical; the bag
   * plus the rate jitter mean no two ever are.
   */
  it("no two of twelve consecutive blasts are the same fall", () => {
    const { ctx, output } = onBus("sfx");
    const bus = new SfxBus(ctx, output);
    const gap = 1.4;
    for (let k = 0; k < 12; k++) {
      ctx.currentTime = k * gap;
      bus.play("blast");
    }
    ctx.currentTime = 0;
    const all = ctx.render(12 * gap + 0.8);
    const takes = Array.from({ length: 12 }, (_, k) =>
      all.subarray(Math.floor(k * gap * SR), Math.floor((k * gap + 0.8) * SR)),
    );

    let closest = 1;
    for (let a = 0; a < takes.length; a++) {
      for (let b = a + 1; b < takes.length; b++) {
        const x = takes[a] as Float32Array;
        const y = takes[b] as Float32Array;
        const n = Math.min(x.length, y.length);
        let diff = 0;
        for (let i = 0; i < n; i++) {
          diff = Math.max(diff, Math.abs((x[i] as number) - (y[i] as number)));
        }
        closest = Math.min(closest, diff / peak(x));
      }
    }
    // The nearest pair in twelve still differs by most of a blast's own peak.
    expect(closest).toBeGreaterThan(0.5);
  });

  it("every baked crumble is granular, and none of them is a thin one", () => {
    // The six are baked from different seeds and one of them being sparse would
    // be audible as one blast in six sounding wrong. Stratified grain times are
    // what hold this; free draws produced a variant with a third of the onsets.
    for (let v = 0; v < CRUMBLE_VARIANTS; v++) {
      const samples = crumbleSamples(SR, crumbleSeed(v));
      const onsets = onsetTimes(samples, SR);
      expect(onsets.length, `crumble ${v}`).toBeGreaterThanOrEqual(10);
      expect(onsets[onsets.length - 1] as number, `crumble ${v} fall length`).toBeGreaterThan(0.3);
      expect(peak(samples), `crumble ${v}`).toBeCloseTo(1, 5);
    }
  });

  it("a crumble ends quietly, so a blast never clicks at its tail", () => {
    for (let v = 0; v < CRUMBLE_VARIANTS; v++) {
      const samples = crumbleSamples(SR, crumbleSeed(v));
      const last = samples[samples.length - 1] as number;
      expect(Math.abs(last), `crumble ${v} last sample`).toBeLessThan(0.01);
    }
  });

  it("the crumble is dry stone, not a cymbal: almost nothing above 8 kHz", () => {
    for (let v = 0; v < CRUMBLE_VARIANTS; v++) {
      const samples = crumbleSamples(SR, crumbleSeed(v));
      expect(bandEnergyFraction(samples, SR, 8000, SR / 2), `crumble ${v}`).toBeLessThan(0.02);
    }
  });
});

// ---------------------------------------------------------------------------
// UR-55
// ---------------------------------------------------------------------------

/**
 * A CONTEXT WHOSE CLOCK IS BEHIND ITS RENDERER, WHICH IS EVERY REAL ONE.
 *
 * `OfflineAudioContextLike` sets `currentTime` to the start of the block it is
 * ABOUT to render, so a voice scheduled at `ctx.currentTime` lands exactly on
 * the next sample. No browser is ever that generous: `AudioContext.currentTime`
 * names the start of the last COMPLETED render quantum, the audio thread is
 * already working on the next one, and Chrome reports the gap as `baseLatency`
 * (two quanta on every machine this was measured on). That one-quantum gift is
 * why a skipped attack envelope was invisible to every test in this file.
 *
 * This wrapper takes it away. Everything else is the real renderer.
 */
class LateClockContext implements AudioContextLike {
  constructor(
    private readonly inner: OfflineAudioContextLike,
    private readonly lateSeconds: number,
  ) {}
  get currentTime(): number {
    return Math.max(0, this.inner.currentTime - this.lateSeconds);
  }
  get sampleRate(): number {
    return this.inner.sampleRate;
  }
  get destination(): AudioNodeLike {
    return this.inner.destination;
  }
  createGain(): ReturnType<OfflineAudioContextLike["createGain"]> {
    return this.inner.createGain();
  }
  createOscillator(): ReturnType<OfflineAudioContextLike["createOscillator"]> {
    return this.inner.createOscillator();
  }
  createBiquadFilter(): ReturnType<OfflineAudioContextLike["createBiquadFilter"]> {
    return this.inner.createBiquadFilter();
  }
  createBufferSource(): ReturnType<OfflineAudioContextLike["createBufferSource"]> {
    return this.inner.createBufferSource();
  }
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): ReturnType<OfflineAudioContextLike["createBuffer"]> {
    return this.inner.createBuffer(channels, length, sampleRate);
  }
  createStereoPanner(): ReturnType<OfflineAudioContextLike["createStereoPanner"]> {
    return this.inner.createStereoPanner();
  }
}

/** One render quantum, in seconds: the SMALLEST staleness a real clock has. */
const QUANTUM_SECONDS = RENDER_QUANTUM / SR;

/**
 * One voice on a clock that is `lateSeconds` behind, and the two numbers that
 * decide whether its onset is a ramp or a step:
 *
 *   onset - how far the signal moves on the FIRST sample it is audible on;
 *   loudest - the largest move it makes anywhere in its life.
 *
 * Reported as a pair on purpose. An absolute dB bar would be a number someone
 * chose; the voice's own largest step is a number the recipe chose, and an
 * onset is by construction the quietest instant of a sound - it cannot be a
 * measurable fraction of the sound's loudest edge unless an envelope was
 * skipped and the first sample arrived at full gain.
 */
function onsetOf(
  event: SfxEventId,
  lateSeconds: number,
  seed: number,
): { onset: number; loudest: number; index: number } {
  const inner = new OfflineAudioContextLike(SR);
  const out = inner.createGain();
  out.gain.value = busChain("sfx");
  out.connect(inner.destination);
  const ctx = new LateClockContext(inner, lateSeconds);
  const bus = new SfxBus(ctx, out, seededRandom(seed));
  let played = false;
  const rendered = inner.render(0.9, (t) => {
    if (!played && t >= 0.25) {
      played = true;
      bus.play(event);
    }
  });
  let first = Math.floor(0.25 * SR);
  while (first < rendered.length && Math.abs(rendered[first] as number) < 1e-9) first++;
  const onset =
    first < rendered.length
      ? Math.abs((rendered[first] as number) - (rendered[first - 1] as number))
      : 0;
  return { onset, loudest: largestStep(rendered, first + 1).step, index: first };
}

describe("UR-55: an SFX onset is a ramp on a real clock, not a step", () => {
  /**
   * THE BAR. A voice's first audible sample may not move further than a
   * fiftieth of the largest move that same voice makes anywhere else.
   *
   * 1/50 is not a line drawn round the current build. It sits two and a half
   * orders of magnitude above where a correctly rendered attack lands, and more
   * than an order below where the defect put it:
   *
   *   onset step / that voice's own largest step
   *   keystroke   scheduled ahead 9.66e-5      behind the renderer 0.3641
   *   blast       scheduled ahead 4.99e-5      behind the renderer 0.2394
   */
  const ONSET_FRACTION_BAR = 0.02;

  /**
   * THE MEASUREMENT, at the smallest staleness any real context has.
   *
   * FAILED FIRST with `SFX_SCHEDULE_LOOKAHEAD_MS` set to 0 in sfx.ts - that is,
   * with voices scheduled at `ctx.currentTime` exactly the way they were before
   * UR-55. Both of these, and both halves of the negative control with them:
   *
   *   AssertionError: expected 0.3640502470248289 to be less than 0.02  (keystroke)
   *   AssertionError: expected 0.23938361049609466 to be less than 0.02 (blast)
   *   AssertionError: keystroke before/after: expected 1 to be greater than 100
   *   AssertionError: expected 0 to be greater than 0.005804988662131519
   *
   * Eighteen and twelve times the bar. Restored, the same two renders measure
   * 9.66e-5 and 4.99e-5 - a factor of 959 and 2167 on the onset step itself.
   *
   * THE SAME DEFECT IN A REAL BROWSER, for the record, since this renderer is
   * not one: driven through Chromium's own `OfflineAudioContext` with the clock
   * stale by one quantum, the first sample of a voice stepped by -30.4 dBFS
   * (keystroke) and -25.0 dBFS (blast) against -101 dBFS scheduled ahead, over
   * sixty presses each. Worst of the sixty: -24.6 and -19.3 dBFS.
   */
  for (const event of ["keystroke", "blast"] as const) {
    it(`${event}: one render quantum of clock staleness does not step the first sample`, () => {
      const late = onsetOf(event, QUANTUM_SECONDS, 0x5f3a21);
      expect(late.loudest).toBeGreaterThan(0.001);
      expect(late.onset / late.loudest).toBeLessThan(ONSET_FRACTION_BAR);
    });
  }

  /**
   * THE NEGATIVE CONTROL.
   *
   * A test that only asserts the current render is clean passes forever, including
   * after the defect comes back - rule 4 and docs/verification-gaps.md. So this
   * puts the defect back, through the public surface and without touching the
   * source: a clock stale by MORE than the lookahead is exactly the condition
   * the lookahead exists to cover, and past it the envelope is behind the
   * renderer again.
   *
   * It asserts the defect is BIG, which is the half that would go quiet if
   * someone made the measurement blind - if the wrapper stopped shifting the
   * clock, or `onsetOf` stopped finding the onset, or the click layer were
   * deleted, this fails too.
   */
  it("reintroducing the defect makes the same measurement go red", () => {
    const beyond = sfxLookaheadSeconds({}) + QUANTUM_SECONDS;
    for (const event of ["keystroke", "blast"] as const) {
      const broken = onsetOf(event, beyond, 0x5f3a21);
      expect(broken.onset / broken.loudest, `${event} defect`).toBeGreaterThan(
        ONSET_FRACTION_BAR * 10,
      );
      const fixed = onsetOf(event, QUANTUM_SECONDS, 0x5f3a21);
      // The same voice, the same seed, the same renderer: the ONLY difference
      // is whether the envelope lands ahead of the renderer or behind it.
      expect(broken.onset / fixed.onset, `${event} before/after`).toBeGreaterThan(100);
    }
  });

  /** The lookahead is a floor plus the machine's own latency, not a constant. */
  it("the lookahead clears two render quanta, and grows with a slow output", () => {
    // 8 ms against 2 x 128 samples: 5.33 ms at 48 kHz, 5.80 ms at 44.1 kHz.
    expect(SFX_SCHEDULE_LOOKAHEAD_MS / 1000).toBeGreaterThan((2 * RENDER_QUANTUM) / 44100);
    // A context that cannot report its latency gets the floor.
    expect(sfxLookaheadSeconds({})).toBeCloseTo(SFX_SCHEDULE_LOOKAHEAD_MS / 1000, 6);
    expect(sfxLookaheadSeconds({ baseLatency: 0.002 })).toBeCloseTo(
      SFX_SCHEDULE_LOOKAHEAD_MS / 1000,
      6,
    );
    // A Bluetooth headset reporting 20 ms gets 40, not 8.
    expect(sfxLookaheadSeconds({ baseLatency: 0.02 })).toBeCloseTo(0.04, 6);
    // ...and never more than a tenth of a second, whatever it claims.
    expect(sfxLookaheadSeconds({ baseLatency: 5 })).toBeCloseTo(0.1, 6);
  });
});
