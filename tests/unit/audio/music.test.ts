import { describe, expect, it } from "vitest";
import { NullAudioContext } from "../../../src/game/audio/nullContext.js";
import {
  INTENSITY_RAMP_MS,
  INTENSITY_THRESHOLDS,
  MAX_INTENSITY_INDEX,
  MUSIC_LAYERS,
  MUSIC_LAYER_COUNT,
  MusicBus,
  intensityIndex,
  intensityPressure,
  layerGainsDuringChange,
  layerTargetGains,
} from "../../../src/game/audio/music.js";

const build = (): { ctx: NullAudioContext; music: MusicBus } => {
  const ctx = new NullAudioContext();
  return { ctx, music: new MusicBus(ctx, ctx.createGain()) };
};

describe("AC-21.2: music has >= 3 intensity layers", () => {
  it("AC-21.2: the spec declares at least three layers", () => {
    expect(MUSIC_LAYER_COUNT).toBeGreaterThanOrEqual(3);
    expect(MUSIC_LAYERS.map((l) => l.id)).toEqual(["bed", "pulse", "drive"]);
  });

  it("AC-21.2: the bus really creates one gain node per layer", () => {
    const { ctx, music } = build();
    expect(music.layerGains().length).toBe(MUSIC_LAYER_COUNT);
    expect(ctx.labelledWith("music.layer.").length).toBe(MUSIC_LAYER_COUNT);
    for (const gain of music.layerGains()) {
      expect(gain.gain.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives each layer a distinct voice, not three copies of one", () => {
    const waves = new Set(MUSIC_LAYERS.map((l) => l.wave));
    const filters = new Set(MUSIC_LAYERS.map((l) => l.filterHz));
    expect(waves.size).toBeGreaterThanOrEqual(2);
    expect(filters.size).toBe(MUSIC_LAYER_COUNT);
    // Exactly one still layer; the rest move, so "busier" is audible as
    // movement rather than only as volume.
    expect(MUSIC_LAYERS.filter((l) => l.pulseHz === 0).length).toBe(1);
  });

  it("builds the oscillator stack for every layer", () => {
    const { ctx } = build();
    const partials = MUSIC_LAYERS.reduce((n, l) => n + l.partialsHz.length, 0);
    const lfos = MUSIC_LAYERS.filter((l) => l.pulseHz > 0).length;
    expect(ctx.created.filter((n) => n.kind === "oscillator").length).toBe(partials + lfos);
  });
});

describe("AC-21.2: the intensity index is a pure function of asteroids and combo", () => {
  it("AC-21.2: both inputs move it", () => {
    expect(intensityIndex(0, 0)).toBe(0);
    // Asteroids alone can reach the top.
    expect(intensityIndex(8, 0)).toBe(MAX_INTENSITY_INDEX);
    // Combo alone lifts it, at half weight.
    expect(intensityIndex(0, 8)).toBe(1);
    expect(intensityIndex(0, 10)).toBe(1);
    // Together they reach the top sooner than either alone.
    expect(intensityIndex(4, 8)).toBe(MAX_INTENSITY_INDEX);
  });

  it("AC-21.2: is pure - same inputs, same answer, no hidden state", () => {
    for (let i = 0; i < 50; i++) {
      expect(intensityIndex(3, 6)).toBe(intensityIndex(3, 6));
    }
  });

  it("AC-21.2: is monotone non-decreasing in BOTH inputs across the grid", () => {
    // A non-monotone intensity curve is inaudible in a demo and unbearable in
    // a long session: the music would drop as the screen got busier.
    for (let combo = 0; combo <= 14; combo++) {
      let previous = -1;
      for (let rocks = 0; rocks <= 16; rocks++) {
        const index = intensityIndex(rocks, combo);
        expect(index).toBeGreaterThanOrEqual(previous);
        previous = index;
      }
    }
    for (let rocks = 0; rocks <= 16; rocks++) {
      let previous = -1;
      for (let combo = 0; combo <= 14; combo++) {
        const index = intensityIndex(rocks, combo);
        expect(index).toBeGreaterThanOrEqual(previous);
        previous = index;
      }
    }
  });

  it("AC-21.2: stays inside the layer range for any input at all", () => {
    const inputs = [-10, 0, 1, 99, 1e9, Number.NaN, Number.POSITIVE_INFINITY];
    for (const a of inputs) {
      for (const b of inputs) {
        const index = intensityIndex(a, b);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(MAX_INTENSITY_INDEX);
        expect(Number.isInteger(index)).toBe(true);
      }
    }
  });

  it("exposes the pressure the thresholds are read against", () => {
    expect(intensityPressure(0, 0)).toBe(0);
    expect(intensityPressure(3, 4)).toBeCloseTo(5, 12);
    expect(intensityPressure(3, 40)).toBeCloseTo(8, 12);
    const thresholds = [...INTENSITY_THRESHOLDS];
    expect(thresholds.length).toBe(MAX_INTENSITY_INDEX);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });
});

describe("AC-21.2: layers crossfade by intensity", () => {
  it("stacks layers cumulatively rather than swapping tracks", () => {
    expect(layerTargetGains(0).filter((g) => g > 0).length).toBe(1);
    expect(layerTargetGains(1).filter((g) => g > 0).length).toBe(2);
    expect(layerTargetGains(2).filter((g) => g > 0).length).toBe(3);
    // The bed never leaves; it is the room the game sits in.
    expect(layerTargetGains(0)[0]).toBeGreaterThan(0);
    expect(layerTargetGains(2)[0]).toBe(layerTargetGains(0)[0]);
  });

  it("clamps an out-of-range index instead of producing holes", () => {
    expect(layerTargetGains(-4)).toEqual(layerTargetGains(0));
    expect(layerTargetGains(99)).toEqual(layerTargetGains(MAX_INTENSITY_INDEX));
    expect(layerTargetGains(Number.NaN)).toEqual(layerTargetGains(0));
  });

  it("AC-21.2: a change starts at the old gains and ends at the new ones", () => {
    expect(layerGainsDuringChange(0, 2, 0)).toEqual(layerTargetGains(0));
    const done = layerGainsDuringChange(0, 2, 1);
    layerTargetGains(2).forEach((g, i) => expect(done[i]).toBeCloseTo(g, 9));
  });

  it("AC-21.2: a layer that is up in both indices does not move at all", () => {
    for (let i = 0; i <= 10; i++) {
      const gains = layerGainsDuringChange(1, 2, i / 10);
      expect(gains[0]).toBe(layerTargetGains(1)[0]);
      expect(gains[1]).toBe(layerTargetGains(1)[1]);
    }
  });

  it("AC-21.2: the moving layer rises monotonically, at equal power", () => {
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const gains = layerGainsDuringChange(1, 2, t);
      const drive = gains[2] ?? 0;
      expect(drive).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = drive;
    }
    const half = layerGainsDuringChange(1, 2, 0.5)[2] ?? 0;
    const target = layerTargetGains(2)[2] ?? 0;
    // Equal power: at the midpoint the moving layer is at 1/sqrt(2), not 1/2.
    expect(half / target).toBeCloseTo(Math.SQRT1_2, 9);
  });
});

describe("the music bus drives itself from game state", () => {
  it("AC-21.2: setFromState maps live asteroids and combo onto the index", () => {
    const { music } = build();
    expect(music.setFromState(0, 0)).toBe(0);
    expect(music.index).toBe(0);
    expect(music.setFromState(9, 0)).toBe(MAX_INTENSITY_INDEX);
    expect(music.index).toBe(MAX_INTENSITY_INDEX);
  });

  it("ramps rather than cutting, and settles exactly on target", () => {
    const { music } = build();
    music.setIndex(2);
    expect(music.changing).toBe(true);
    music.advance(INTENSITY_RAMP_MS / 2);
    const mid = music.layerGains()[2]!.gain.value;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(layerTargetGains(2)[2]!);
    music.advance(INTENSITY_RAMP_MS);
    expect(music.changing).toBe(false);
    music.layerGains().forEach((gain, i) => {
      expect(gain.gain.value).toBeCloseTo(layerTargetGains(2)[i]!, 9);
    });
  });

  it("is safe to call every frame with an unchanged state", () => {
    const { music } = build();
    music.setFromState(9, 0);
    music.advance(INTENSITY_RAMP_MS);
    const settled = music.layerGains().map((g) => g.gain.value);
    for (let frame = 0; frame < 60; frame++) {
      music.setFromState(9, 0);
      music.advance(16.7);
    }
    expect(music.layerGains().map((g) => g.gain.value)).toEqual(settled);
  });

  it("ignores nonsense frame deltas instead of corrupting the ramp", () => {
    const { music } = build();
    music.setIndex(2);
    music.advance(Number.NaN);
    music.advance(-500);
    expect(music.changing).toBe(true);
    music.advance(INTENSITY_RAMP_MS);
    expect(music.index).toBe(2);
  });

  it("advancing with nothing in flight is a no-op", () => {
    const { music } = build();
    music.advance(1000);
    expect(music.index).toBe(0);
    expect(music.changing).toBe(false);
  });

  it("clamps an out-of-range index request", () => {
    const { music } = build();
    music.setIndex(99);
    expect(music.index).toBe(MAX_INTENSITY_INDEX);
    music.setIndex(-99, 0);
    expect(music.index).toBe(0);
  });
});
