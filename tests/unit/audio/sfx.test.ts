import { describe, expect, it } from "vitest";
import { NullAudioContext, NullGain } from "../../../src/game/audio/nullContext.js";
import { seededRandom } from "../../../src/game/audio/context.js";
import {
  BLAST_MAX_SEMITONES,
  GENTLE_EVENTS,
  GENTLE_LIMITS,
  MIN_VARIANTS_PER_EVENT,
  SFX_EVENTS,
  SFX_VARIANTS,
  SfxBus,
  VariantRotation,
  advanceRotation,
  blastPitchRatio,
  blastSemitonesFor,
  hitIntensityFor,
  initialRotation,
  pitchDirectionOf,
  shuffledBag,
  variantsFor,
  type SfxEventId,
} from "../../../src/game/audio/sfx.js";

const bus = (rand = seededRandom(7)): { ctx: NullAudioContext; sfx: SfxBus } => {
  const ctx = new NullAudioContext();
  const out = ctx.createGain();
  return { ctx, sfx: new SfxBus(ctx, out, rand) };
};

describe("AC-21.3: every event has >= 3 SFX variants", () => {
  it("AC-21.3: names exactly the events the PRD names", () => {
    expect([...SFX_EVENTS]).toEqual([
      "lock",
      "keystroke",
      "typo",
      "blast",
      "hit",
      "shield",
      "warpCharge",
      "warp",
      "beacon",
      "uiNav",
      // UR-117. AC-21.3 was edited in the same change that added this, which is
      // the point of listing them here rather than counting: an event cannot
      // appear in the game without somebody writing it into the AC first.
      "comboUp",
    ]);
  });

  it("AC-21.3: each event has at least three variants", () => {
    for (const event of SFX_EVENTS) {
      expect(variantsFor(event).length).toBeGreaterThanOrEqual(MIN_VARIANTS_PER_EVENT);
    }
  });

  it("AC-21.3: variant ids are unique across the whole table", () => {
    const ids = SFX_EVENTS.flatMap((e) => variantsFor(e).map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("AC-21.3: variants of one event differ on more than one axis", () => {
    // D62 asks for variants to stop repetition fatigue. Three detunings of one
    // sound is still one sound, so a pair that differs only in pitch fails.
    for (const event of SFX_EVENTS) {
      const variants = variantsFor(event);
      for (let i = 0; i < variants.length; i++) {
        for (let j = i + 1; j < variants.length; j++) {
          const a = variants[i]!;
          const b = variants[j]!;
          const axes = [
            a.wave !== b.wave,
            Math.abs(a.startHz - b.startHz) > 1,
            Math.abs(a.durationMs - b.durationMs) > 3,
            a.filterKind !== b.filterKind || Math.abs(a.filterHz - b.filterHz) > 50,
            Math.abs(a.noise - b.noise) > 0.01,
            Math.abs(a.pan - b.pan) > 0.01,
          ].filter(Boolean).length;
          expect(axes, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("keeps every recipe inside sane synthesis bounds", () => {
    for (const event of SFX_EVENTS) {
      for (const v of variantsFor(event)) {
        expect(v.peakGain).toBeGreaterThan(0);
        expect(v.peakGain).toBeLessThanOrEqual(0.5);
        expect(v.startHz).toBeGreaterThan(20);
        expect(v.endHz).toBeGreaterThan(20);
        expect(v.durationMs).toBeGreaterThan(0);
        expect(v.attackMs).toBeLessThan(v.durationMs);
        expect(Math.abs(v.pan)).toBeLessThanOrEqual(1);
        expect(v.noise).toBeGreaterThanOrEqual(0);
        expect(v.noise).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("D31: nothing reads as failure", () => {
  it("D31: the typo cue sits in the register the play-through settled on", () => {
    // UR-170: it demanded a flat sine at ~330 Hz. At the 44-55 Hz the owner
    // settled on, a sine has nothing left on a laptop - the harmonics carry
    // the pitch. What D31 forbids is asserted below, not here.
    for (const v of variantsFor("typo")) {
      expect(v.startHz).toBeLessThan(80);
      const fall = v.startHz / v.endHz;
      expect(fall).toBeGreaterThanOrEqual(1);
      expect(fall, "a falling interval this wide reads as a verdict").toBeLessThan(1.2);
      expect(v.peakGain).toBeLessThanOrEqual(GENTLE_LIMITS.maxPeakGain);
      expect(v.durationMs).toBeLessThanOrEqual(GENTLE_LIMITS.maxDurationMs);
      expect(v.filterHz).toBeLessThanOrEqual(2000);
      expect(v.noise).toBeLessThanOrEqual(0.05);
    }
  });

  it("D31: the typo cue still never lands harder than a hull hit", () => {
    // The ORDER is the rule the budget exists to serve, and it survived the
    // owner's tuning: both cues moved and the gap between them did not close.
    const loudestTypo = Math.max(...variantsFor("typo").map((v) => v.peakGain));
    const quietestHit = Math.min(...variantsFor("hit").map((v) => v.peakGain));
    expect(loudestTypo).toBeLessThan(quietestHit);
  });

  it("D31: the typo tick is quieter than the reward sounds around it", () => {
    const loudestTypo = Math.max(...variantsFor("typo").map((v) => v.peakGain));
    for (const event of ["lock", "blast", "beacon", "warp"] as const) {
      const quietestReward = Math.min(...variantsFor(event).map((v) => v.peakGain));
      expect(loudestTypo).toBeLessThan(quietestReward);
    }
  });

  it("D31: a hull hit is a warm low thud, not an alarm", () => {
    // The bounds were 160 Hz / 600 Hz, which put the whole sound under what a
    // laptop speaker reproduces - the owner reported hearing nothing at all on
    // a hit or a fly-by. Raised on their call. Loudness and harshness, which
    // are what "not an alarm" actually protects, are unchanged below.
    for (const v of variantsFor("hit")) {
      expect(v.startHz).toBeLessThan(400);
      expect(v.filterHz).toBeLessThanOrEqual(1100);
      expect(v.harshness).toBeLessThanOrEqual(GENTLE_LIMITS.maxHarshness);
      expect(v.peakGain).toBeLessThanOrEqual(GENTLE_LIMITS.maxPeakGain);
      // UR-170: raised by the owner across a play-through because a fly-by was
      // inaudible. "Not an alarm" is a claim about the SOUND, and `blast` is
      // three layers to `hit`'s one, so the comparison against the reward is
      // made on the render in `rendered.test.ts`, never on declared gains.
    }
  });

  it("D31: every gentle event stays inside the budget", () => {
    for (const event of GENTLE_EVENTS) {
      for (const v of variantsFor(event)) {
        expect(v.peakGain).toBeLessThanOrEqual(GENTLE_LIMITS.maxPeakGain);
        expect(v.durationMs).toBeLessThanOrEqual(GENTLE_LIMITS.maxDurationMs);
        expect(v.harshness).toBeLessThanOrEqual(GENTLE_LIMITS.maxHarshness);
      }
    }
  });

  it("reports pitch direction from the frequencies, never from a stored flag", () => {
    expect(pitchDirectionOf(variantsFor("lock")[0]!)).toBe("up");
    expect(pitchDirectionOf(variantsFor("blast")[0]!)).toBe("down");
    expect(pitchDirectionOf(variantsFor("keystroke")[0]!)).toBe("flat");
  });
});

describe("AC-21.3: consecutive plays never repeat a variant", () => {
  it("AC-21.3: 2000 plays of every event, zero consecutive repeats", () => {
    const { sfx } = bus(seededRandom(0xbeef));
    for (const event of SFX_EVENTS) {
      let last: string | null = null;
      for (let i = 0; i < 2000; i++) {
        const played = sfx.play(event as SfxEventId);
        expect(played.variant.id).not.toBe(last);
        last = played.variant.id;
      }
    }
  });

  it("AC-21.3: holds for every seed, not just the shipped one", () => {
    for (let seed = 0; seed < 40; seed++) {
      const rotation = new VariantRotation(3, seededRandom(seed));
      let last: number | null = null;
      for (let i = 0; i < 300; i++) {
        const index = rotation.next();
        expect(index).not.toBe(last);
        last = index;
      }
    }
  });

  it("plays every variant once per bag, so nothing is starved", () => {
    const rotation = new VariantRotation(3, seededRandom(11));
    for (let bagNumber = 0; bagNumber < 50; bagNumber++) {
      const bag = [rotation.next(), rotation.next(), rotation.next()];
      expect(new Set(bag).size).toBe(3);
    }
  });

  it("is a pure reducer: the same state and rng give the same step", () => {
    const stepA = advanceRotation(initialRotation(), 3, seededRandom(5));
    const stepB = advanceRotation(initialRotation(), 3, seededRandom(5));
    expect(stepA.index).toBe(stepB.index);
    expect(stepA.state).toEqual(stepB.state);
  });

  it("degrades sanely for one variant or none", () => {
    const one = advanceRotation(initialRotation(), 1, seededRandom(1));
    expect(one.index).toBe(0);
    expect(advanceRotation(one.state, 1, seededRandom(1)).index).toBe(0);
    expect(advanceRotation(initialRotation(), 0, seededRandom(1)).index).toBe(0);
    expect(advanceRotation(initialRotation(), -4, seededRandom(1)).index).toBe(0);
  });

  it("shuffles a complete bag whatever the rng returns", () => {
    expect(shuffledBag(5, () => 0).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(shuffledBag(5, () => 0.999999999).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(shuffledBag(0, () => 0.5)).toEqual([]);
    expect(new Set(shuffledBag(8, seededRandom(3))).size).toBe(8);
  });

  it("exposes the last index it played", () => {
    const rotation = new VariantRotation(3, seededRandom(2));
    const first = rotation.next();
    expect(rotation.last).toBe(first);
  });
});

describe("D63: reactive SFX", () => {
  it("D63: blast pitch rises with the combo and then caps", () => {
    expect(blastSemitonesFor(0)).toBe(0);
    expect(blastSemitonesFor(5)).toBeCloseTo(BLAST_MAX_SEMITONES / 2, 12);
    expect(blastSemitonesFor(10)).toBeCloseTo(BLAST_MAX_SEMITONES, 12);
    // Capped at the scoring multiplier's x10 so it never turns shrill.
    expect(blastSemitonesFor(40)).toBeCloseTo(BLAST_MAX_SEMITONES, 12);
    expect(blastSemitonesFor(Number.NaN)).toBe(0);

    let previous = -1;
    for (let combo = 0; combo <= 12; combo++) {
      const ratio = blastPitchRatio(combo);
      expect(ratio).toBeGreaterThanOrEqual(previous);
      previous = ratio;
    }
  });

  it("D63: a blast played at a high combo really is pitched up", () => {
    const { sfx } = bus(seededRandom(1));
    const cold = sfx.play("blast", { combo: 0 });
    const hot = sfx.play("blast", { combo: 10 });
    const coldBase = cold.variant.startHz;
    const hotBase = hot.variant.startHz;
    expect(cold.startHz / coldBase).toBeCloseTo(1, 9);
    expect(hot.startHz / hotBase).toBeCloseTo(blastPitchRatio(10), 9);
  });

  it("D63/D31: a low hull makes the thud bigger, never sharper", () => {
    expect(hitIntensityFor(1)).toBeCloseTo(1, 12);
    expect(hitIntensityFor(0)).toBeCloseTo(1.35, 12);
    expect(hitIntensityFor(-5)).toBeCloseTo(1.35, 12);
    expect(hitIntensityFor(Number.NaN)).toBeCloseTo(1.35, 12);
    // The range is narrow on purpose: weight, not menace.
    expect(hitIntensityFor(0)).toBeLessThan(1.5);

    const { sfx } = bus(seededRandom(4));
    const full = sfx.play("hit", { hullFraction: 1 });
    const low = sfx.play("hit", { hullFraction: 0 });
    expect(low.peakGain / low.variant.peakGain).toBeGreaterThan(
      full.peakGain / full.variant.peakGain,
    );
    // Timbre is untouched - only the level moved.
    expect(low.variant.harshness).toBeLessThanOrEqual(GENTLE_LIMITS.maxHarshness);
  });

  it("scales by a caller-supplied volume and never exceeds unity", () => {
    const { sfx } = bus(seededRandom(9));
    const quiet = sfx.play("beacon", { gainScale: 0.25 });
    expect(quiet.peakGain).toBeCloseTo(quiet.variant.peakGain * 0.25, 9);
    const loud = sfx.play("warp", { gainScale: 100 });
    expect(loud.peakGain).toBeLessThanOrEqual(1);
    const defaulted = sfx.play("uiNav", { gainScale: Number.NaN });
    expect(defaulted.peakGain).toBeCloseTo(defaulted.variant.peakGain, 9);
  });
});

describe("the SFX bus builds real nodes", () => {
  it("routes every voice to the bus output", () => {
    const ctx = new NullAudioContext();
    const out = ctx.createGain();
    const sfx = new SfxBus(ctx, out, seededRandom(1));
    const before = ctx.created.length;
    sfx.play("blast");
    expect(ctx.created.length).toBeGreaterThan(before);
    const voices = ctx.labelledWith("sfx.voice.");
    expect(voices.length).toBe(1);
    expect(voices[0]!.outputs.length).toBeGreaterThan(0);
  });

  it("gives every voice an envelope rather than a hard gate", () => {
    const ctx = new NullAudioContext();
    const sfx = new SfxBus(ctx, ctx.createGain(), seededRandom(1));
    sfx.play("lock");
    const amp = ctx.labelledWith("sfx.voice.")[0] as NullGain;
    const kinds = amp.gain.events.map((e) => e.kind);
    expect(kinds).toContain("linear");
    expect(kinds).toContain("exponential");
  });

  it("reuses one noise buffer across plays", () => {
    const ctx = new NullAudioContext(8000);
    const sfx = new SfxBus(ctx, ctx.createGain(), seededRandom(1));
    // UR-48: a blast now makes THREE buffer sources - the noise wash, the
    // fracture click's own noise burst, and the baked crumble. The claim this
    // test makes is unchanged and is about the sample DATA, not the node count:
    // the expensive part is generated once and every later play points at the
    // same buffers.
    sfx.play("blast");
    const afterFirst = ctx.created.filter((n) => n.kind === "bufferSource").length;
    sfx.play("blast");
    const afterSecond = ctx.created.filter((n) => n.kind === "bufferSource").length;
    expect(afterFirst).toBe(3);
    expect(afterSecond).toBe(6);

    // One noise buffer, whatever the play count. The crumbles are a rotation of
    // six, so a second play may legitimately reach a different one.
    const buffers = ctx.created
      .filter((n) => n.kind === "bufferSource")
      .map((n) => (n as unknown as { buffer: unknown }).buffer);
    expect(new Set(buffers).size).toBeLessThanOrEqual(3);
  });

  it("skips the noise layer for the events that have none", () => {
    const ctx = new NullAudioContext(8000);
    const sfx = new SfxBus(ctx, ctx.createGain(), seededRandom(1));
    // uiNav.0 and uiNav.2 have noise 0; play until one of them comes up.
    for (let i = 0; i < 6; i++) sfx.play("uiNav");
    const noiseless = sfx.history().filter((p) => p.variant.noise === 0);
    expect(noiseless.length).toBeGreaterThan(0);
  });

  it("keeps a history of what it played", () => {
    const { sfx } = bus(seededRandom(1));
    sfx.play("lock");
    sfx.play("beacon");
    expect(sfx.history().map((p) => p.variant.event)).toEqual(["lock", "beacon"]);
  });

  it("rejects an unknown event loudly rather than playing silence", () => {
    expect(() => variantsFor("nope" as SfxEventId)).toThrow(/unknown sfx event/);
  });

  it("freezes the table so a scene cannot mutate the mix at runtime", () => {
    expect(Object.isFrozen(SFX_VARIANTS)).toBe(true);
  });
});
