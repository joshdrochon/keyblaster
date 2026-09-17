import { describe, expect, it } from "vitest";
import { STOP_IDS } from "../../../src/engine/types.js";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import {
  AMBIENT_BEDS,
  AMBIENT_CROSSFADE_MS,
  AmbientBus,
  ambientCrossfade,
  bedSpec,
  WIND_LOOP_SECONDS,
  windLoopSamples,
} from "../../../src/game/audio/ambient.js";
import type { StopId } from "../../../src/engine/types.js";

const build = (): { ctx: NullAudioContext; ambient: AmbientBus } => {
  const ctx = new NullAudioContext();
  return { ctx, ambient: new AmbientBus(ctx, ctx.createGain()) };
};

describe("AC-21.1: a per-planet ambient bed exists for every stop", () => {
  it("AC-21.1: there are exactly seven beds, one per engine stop", () => {
    expect(AMBIENT_BEDS.length).toBe(7);
    expect(AMBIENT_BEDS.map((b) => b.stopId)).toEqual([...STOP_IDS]);
  });

  it("AC-21.1: every stop's bed is genuinely different from the others", () => {
    // Seven copies of one drone would satisfy a naive count and fail the
    // player, so the distinguishing parameters are asserted distinct.
    const drones = AMBIENT_BEDS.map((b) => b.droneHz);
    expect(new Set(drones).size).toBe(7);
    expect(new Set(AMBIENT_BEDS.map((b) => b.filterHz)).size).toBe(7);
    expect(new Set(AMBIENT_BEDS.map((b) => b.windLevel)).size).toBe(7);
    expect(new Set(AMBIENT_BEDS.map((b) => b.shimmerHz)).size).toBe(7);
  });

  it("keeps every bed inside sane synthesis bounds", () => {
    for (const bed of AMBIENT_BEDS) {
      expect(bed.droneHz).toBeGreaterThan(20);
      expect(bed.droneHz).toBeLessThan(200);
      expect(bed.partials.length).toBeGreaterThanOrEqual(3);
      expect(bed.level).toBeGreaterThan(0);
      expect(bed.level).toBeLessThanOrEqual(1);
      expect(bed.windLevel).toBeGreaterThanOrEqual(0);
      expect(bed.windLevel).toBeLessThanOrEqual(1);
      expect(bed.note.length).toBeGreaterThan(0);
    }
  });

  it("reads the route: the outer worlds are lower and quieter than home", () => {
    expect(bedSpec("pluto").level).toBeLessThan(bedSpec("earth").level);
    expect(bedSpec("jupiter").droneHz).toBeLessThan(bedSpec("earth").droneHz);
    expect(bedSpec("saturn").shimmerDepth).toBeGreaterThan(bedSpec("mars").shimmerDepth);
  });

  it("rejects an unknown stop loudly", () => {
    expect(() => bedSpec("vulcan" as StopId)).toThrow(/no ambient bed/);
  });
});

describe("AC-21.1: beds crossfade on transition", () => {
  it("AC-21.1: builds real nodes for a bed when it first plays", () => {
    const { ctx, ambient } = build();
    expect(ctx.labelledWith("ambient.bed.").length).toBe(0);
    ambient.start("earth");
    expect(ctx.labelledWith("ambient.bed.").length).toBe(1);
    expect(ambient.gainOf("earth")).toBeCloseTo(bedSpec("earth").level, 9);
    expect(ambient.activeStop).toBe("earth");
    // Lazily: six unheard beds are six wasted oscillator stacks (AC-22.9).
    expect(ambient.builtBeds()).toEqual(["earth"]);
    expect(ambient.bedIds().length).toBe(7);
  });

  it("AC-21.1: both beds are audible through the middle of a transition", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.transitionTo("mars");
    expect(ambient.crossfading).toBe(true);

    for (let step = 1; step < 10; step++) {
      ambient.advance(AMBIENT_CROSSFADE_MS / 10);
      if (step === 9) break;
      // The definition of a crossfade: neither bed is ever silent mid-move.
      expect(ambient.gainOf("earth")).toBeGreaterThan(0);
      expect(ambient.gainOf("mars")).toBeGreaterThan(0);
    }
  });

  it("AC-21.1: the outgoing bed falls and the incoming bed rises, monotonically", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.transitionTo("mars");
    let lastOut = Number.POSITIVE_INFINITY;
    let lastIn = -1;
    for (let i = 0; i < 20; i++) {
      ambient.advance(AMBIENT_CROSSFADE_MS / 20);
      const out = ambient.gainOf("earth");
      const incoming = ambient.gainOf("mars");
      expect(out).toBeLessThanOrEqual(lastOut + 1e-12);
      expect(incoming).toBeGreaterThanOrEqual(lastIn - 1e-12);
      lastOut = out;
      lastIn = incoming;
    }
  });

  it("AC-21.1: the transition settles exactly, with the old bed silent", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.transitionTo("mars");
    ambient.advance(AMBIENT_CROSSFADE_MS);
    expect(ambient.crossfading).toBe(false);
    expect(ambient.activeStop).toBe("mars");
    expect(ambient.incomingStop).toBe(null);
    expect(ambient.gainOf("mars")).toBeCloseTo(bedSpec("mars").level, 9);
    expect(ambient.gainOf("earth")).toBe(0);
  });

  it("AC-21.1: the whole seven-stop route crossfades, never cuts", () => {
    const { ctx, ambient } = build();
    const first = STOP_IDS[0]!;
    ambient.start(first);
    let previous = first;
    for (const stop of STOP_IDS.slice(1)) {
      ambient.transitionTo(stop);
      ambient.advance(AMBIENT_CROSSFADE_MS / 2);
      expect(ambient.gainOf(previous)).toBeGreaterThan(0);
      expect(ambient.gainOf(stop)).toBeGreaterThan(0);
      ambient.advance(AMBIENT_CROSSFADE_MS / 2);
      previous = stop;
    }
    expect(ambient.builtBeds().length).toBe(7);
    expect(ctx.labelledWith("ambient.bed.").length).toBe(7);
  });

  it("holds equal power through the move, so there is no hole in the middle", () => {
    for (let i = 0; i <= 10; i++) {
      const fade = ambientCrossfade((AMBIENT_CROSSFADE_MS * i) / 10, AMBIENT_CROSSFADE_MS);
      expect(fade.out * fade.out + fade.in * fade.in).toBeCloseTo(1, 12);
    }
  });

  it("treats a transition to the bed already playing as a no-op", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.transitionTo("earth");
    expect(ambient.crossfading).toBe(false);
    expect(ambient.builtBeds()).toEqual(["earth"]);
  });

  it("starts the first bed if a transition arrives before anything plays", () => {
    const { ambient } = build();
    ambient.transitionTo("saturn");
    expect(ambient.activeStop).toBe("saturn");
    expect(ambient.gainOf("saturn")).toBeCloseTo(bedSpec("saturn").level, 9);
  });

  it("never stacks three beds when a transition interrupts another", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.transitionTo("mars");
    ambient.advance(AMBIENT_CROSSFADE_MS / 3);
    ambient.transitionTo("jupiter");
    // The interrupted move lands immediately; only two beds are ever live.
    expect(ambient.gainOf("earth")).toBe(0);
    ambient.advance(AMBIENT_CROSSFADE_MS);
    expect(ambient.activeStop).toBe("jupiter");
    expect(ambient.gainOf("mars")).toBe(0);
    expect(ambient.gainOf("jupiter")).toBeCloseTo(bedSpec("jupiter").level, 9);
  });

  it("returning to the outgoing bed mid-transition resolves cleanly", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.transitionTo("mars");
    ambient.advance(AMBIENT_CROSSFADE_MS / 4);
    ambient.transitionTo("earth");
    ambient.advance(AMBIENT_CROSSFADE_MS);
    expect(ambient.activeStop).toBe("earth");
    expect(ambient.gainOf("mars")).toBe(0);
  });

  it("ignores nonsense frame deltas and advances with nothing in flight", () => {
    const { ambient } = build();
    ambient.start("earth");
    ambient.advance(1000);
    ambient.advance(Number.NaN);
    ambient.advance(-9);
    expect(ambient.gainOf("earth")).toBeCloseTo(bedSpec("earth").level, 9);
  });

  it("reports zero gain for a bed that has never played", () => {
    const { ambient } = build();
    expect(ambient.gainOf("pluto")).toBe(0);
    expect(ambient.activeStop).toBe(null);
  });

  it("builds a drone, a wind and a shimmer for a bed", () => {
    const ctx = new NullAudioContext(8000);
    const ambient = new AmbientBus(ctx, ctx.createGain());
    ambient.start("saturn");
    const spec = bedSpec("saturn");
    const oscillators = ctx.created.filter((n) => n.kind === "oscillator").length;
    expect(oscillators).toBe(spec.partials.length + 1); // partials + shimmer LFO
    expect(ctx.created.filter((n) => n.kind === "bufferSource").length).toBe(1);
  });

  it("shares one wind buffer across every bed on a context", () => {
    const ctx = new NullAudioContext(8000);
    const ambient = new AmbientBus(ctx, ctx.createGain());
    ambient.start("earth");
    ambient.transitionTo("mars");
    ambient.advance(AMBIENT_CROSSFADE_MS);
    // Two sources, but the expensive part - the sample data - was made once.
    expect(ctx.created.filter((n) => n.kind === "bufferSource").length).toBe(2);
  });
});

describe("UR-10: the wind loop is continuous across its seam", () => {
  // WHY THIS FILE HAS A SIGNAL-PROCESSING TEST.
  //
  // The user heard "a pop every so often in the game like its being looped".
  // `wind.loop = true` on the ambient bed's noise buffer is the ONLY looping
  // source in src/ - every other voice is a continuous oscillator or a
  // one-shot. So "every so often" has exactly one candidate period, and it is
  // measurable: a loop whose last sample does not join its first sample steps
  // the wind's DC level once per lap, which is a click.
  //
  // MEASURED, NOT ASSUMED. Offline render of the Neptune bed in Chromium
  // (windLevel 0.42, windFilterHz 480, filterHz 620, level 0.48) put the old
  // seam at 0.2873 in the buffer, arriving at the output as a 0.0579 level
  // step in 0.54 ms - 47% of that bed's whole RMS (0.1224), once every 4.000 s.
  //
  // The thresholds below are the signal's OWN statistics, not tuned constants:
  // the seam has to be no worse than the biggest step the noise takes on its
  // own anywhere in the buffer. There is nothing to weaken.

  const SAMPLE_RATE = 48000;

  interface SeamStats {
    readonly samples: Float32Array;
    readonly seamStep: number;
    readonly maxInteriorStep: number;
    readonly seamCurvature: number;
    readonly maxInteriorCurvature: number;
  }

  const seamStats = (samples: Float32Array): SeamStats => {
    const n = samples.length;
    const at = (i: number): number => samples[((i % n) + n) % n] as number;

    let maxInteriorStep = 0;
    for (let i = 1; i < n; i++) {
      maxInteriorStep = Math.max(maxInteriorStep, Math.abs(at(i) - at(i - 1)));
    }
    // Second difference: catches a seam that matches in VALUE but breaks the
    // slope, which is still an audible edge.
    let maxInteriorCurvature = 0;
    for (let i = 2; i < n; i++) {
      maxInteriorCurvature = Math.max(maxInteriorCurvature, Math.abs(at(i) - 2 * at(i - 1) + at(i - 2)));
    }
    return {
      samples,
      seamStep: Math.abs(at(0) - at(-1)),
      maxInteriorStep,
      seamCurvature: Math.abs(at(1) - 2 * at(0) + at(-1)),
      maxInteriorCurvature,
    };
  };

  it("UR-10: the loop seam is no larger a step than the noise takes on its own", () => {
    const s = seamStats(windLoopSamples(SAMPLE_RATE));
    // Wrapping from the last sample to the first must be indistinguishable
    // from any other sample-to-sample move in the buffer. Anything bigger is
    // a step change in level once per lap, i.e. the pop.
    expect(s.seamStep).toBeLessThanOrEqual(s.maxInteriorStep);
  });

  it("UR-10: the seam does not break the slope either", () => {
    const s = seamStats(windLoopSamples(SAMPLE_RATE));
    expect(s.seamCurvature).toBeLessThanOrEqual(s.maxInteriorCurvature);
  });

  it("UR-10: the seam holds at 44.1 kHz too, so it is not a rate coincidence", () => {
    const s = seamStats(windLoopSamples(44100));
    expect(s.seamStep).toBeLessThanOrEqual(s.maxInteriorStep);
    expect(s.seamCurvature).toBeLessThanOrEqual(s.maxInteriorCurvature);
  });

  it("UR-10: fixing the seam did not flatten, quieten or truncate the wind", () => {
    // A seamless loop is trivial to fake by returning silence, so the wind has
    // to still be wind: full length, in range, and with its level unchanged.
    const samples = windLoopSamples(SAMPLE_RATE);
    expect(samples.length).toBe(SAMPLE_RATE * WIND_LOOP_SECONDS);

    let sq = 0;
    let peak = 0;
    for (const v of samples) {
      sq += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = Math.sqrt(sq / samples.length);
    // The pre-fix generator measured rms 0.1989, peak 0.8986. Hold both.
    expect(rms).toBeGreaterThan(0.15);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1);

    // And it must have no DC offset to speak of, or every bed sits off-centre.
    const mean = samples.reduce((a, v) => a + v, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it("UR-10: the generator is deterministic, so the bed is the same every run", () => {
    expect([...windLoopSamples(SAMPLE_RATE).slice(0, 64)]).toEqual([
      ...windLoopSamples(SAMPLE_RATE).slice(0, 64),
    ]);
  });
});
