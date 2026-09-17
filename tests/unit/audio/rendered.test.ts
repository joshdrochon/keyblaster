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
  bandEnergyFraction,
  largestStep,
  peak,
  rms,
  spectralRolloffHz,
  stepQuantile,
  tonality,
} from "./offline.js";
import { AMBIENT_BEDS, AmbientBus, bedBreath, bedSpec } from "../../../src/game/audio/ambient.js";
import {
  GENTLE_EVENTS,
  GENTLE_LIMITS,
  SFX_EVENTS,
  SfxBus,
  variantsFor,
  type SfxEventId,
} from "../../../src/game/audio/sfx.js";
import { KeystrokeTone, WORD_OPENING_SEMITONES, frequencyFor } from "../../../src/game/audio/keystrokeTone.js";
import { SHADOW_CHIRP, chirpDurationMs, chirpPeakGain, chirpSeparation, playChirp } from "../../../src/game/audio/chirp.js";
import { buildAudioGraph, busSpec } from "../../../src/game/audio/graph.js";
import { installAudio, type ChannelHandler } from "../../../src/game/audio/wiring.js";
import { seededRandom } from "../../../src/game/audio/context.js";
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
   * And the crack is still on top of it. Measured over the first 50 ms, which
   * is where an impact's transient lives: 11-18% above 1 kHz. Without this the
   * "fix" for an empty blast is just a thud, which is the same defect wearing
   * a different frequency.
   */
  it("the blast still cracks before it thumps", () => {
    for (let i = 0; i < variantsFor("blast").length; i++) {
      const attack = renderBlast(i).subarray(0, Math.floor(SR * 0.05));
      expect(bandEnergyFraction(attack, SR, 1000, SR / 2), `blast.${i} attack`).toBeGreaterThan(0.08);
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
      highs.push(bandEnergyFraction(belt.at(k, 0.006), SR, 2000, SR / 2));
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
      highs.push(bandEnergyFraction(belt.at(k, 0.006), SR, 2000, SR / 2));
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
