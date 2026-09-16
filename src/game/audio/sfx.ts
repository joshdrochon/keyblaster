/**
 * Procedural SFX (D63, D49, PRD FR-21 / AC-21.3).
 *
 * D63: "Procedural Web Audio for all reactive SFX (blast pitch vs combo, hit
 * intensity vs hull, UI)." Nothing here loads a file. Every sound is an
 * oscillator, a filtered noise burst, or both, with an envelope - which is also
 * why ten events x 3 variants costs zero bytes of download.
 *
 * AC-21.3 has two halves and they are different claims:
 *   - >= 3 variants for each of the ten events            (the table below)
 *   - consecutive plays never repeat a variant            (the rotation)
 * Both are behaviours, so both are measured by PLAYING, not by reading the
 * table: the evidence emitter runs hundreds of rotations per event and records
 * what actually came out.
 *
 * D31 IS A HARD CONSTRAINT ON THIS FILE, not a note. There is no "wrong" sound
 * in this game. Two events could have drifted into one - `typo` and `hit` - so
 * both are pinned by assertions:
 *   - `typo` is a soft NEUTRAL TICK: flat pitch (no falling "uh-oh" interval),
 *     sine or triangle, quiet, short, heavily filtered, harshness 0. It tells
 *     the player a key landed somewhere else. It does not tell them they failed.
 *   - `hit` is a warm low thud, never a descending whine or an alarm.
 * `GENTLE_EVENTS` and the tests around it are what stop a later edit from
 * turning either one into a buzzer.
 */

import {
  clamp,
  seededRandom,
  semitoneRatio,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type BiquadKind,
  type OscillatorWave,
} from "./context.js";
import { label } from "./nullContext.js";

/** The ten events AC-21.3 names, in the PRD's order. */
export const SFX_EVENTS = [
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
] as const;

export type SfxEventId = (typeof SFX_EVENTS)[number];

/** AC-21.3's floor. The rotation works for any count >= 2; the table ships 3. */
export const MIN_VARIANTS_PER_EVENT = 3;

/**
 * Events that D31 puts a hard ceiling on. These are the two moments a player
 * could read as "you got it wrong", so they are the two the tests police.
 */
export const GENTLE_EVENTS: readonly SfxEventId[] = ["typo", "hit"];

/** A neutral tick may not be loud, long, bright or harsh. D31 budget. */
export const GENTLE_LIMITS = Object.freeze({
  maxPeakGain: 0.1,
  maxDurationMs: 220,
  maxHarshness: 0.2,
});

/** Pitch travel over the life of a voice. `flat` is the neutral register. */
export type PitchDirection = "up" | "flat" | "down";

/**
 * One procedural recipe. Everything a voice needs, and nothing that needs a
 * context, so the whole table is inspectable in a plain Node test.
 */
export interface SfxVariant {
  /** "blast.1". Stable across runs; used in rotation assertions. */
  readonly id: string;
  readonly event: SfxEventId;
  readonly index: number;
  readonly wave: OscillatorWave;
  readonly startHz: number;
  /** Glide target. Equal to `startHz` for a flat, neutral sound. */
  readonly endHz: number;
  readonly durationMs: number;
  readonly attackMs: number;
  /** Peak linear gain, 0..1, before any reactive scaling. */
  readonly peakGain: number;
  readonly filterKind: BiquadKind;
  readonly filterHz: number;
  /** Amount of filtered noise mixed under the tone, 0..1. */
  readonly noise: number;
  /**
   * How abrasive the timbre is, 0..1. A design budget, not a DSP parameter:
   * it is what the D31 check reads. Square/saw content, high Q and bright
   * filters push it up.
   */
  readonly harshness: number;
  /** Stereo placement, -1..1. */
  readonly pan: number;
}

/** Derived, never stored: a recipe cannot disagree with its own frequencies. */
export function pitchDirectionOf(v: SfxVariant): PitchDirection {
  if (v.endHz > v.startHz * 1.01) return "up";
  if (v.endHz < v.startHz * 0.99) return "down";
  return "flat";
}

type VariantSeed = Omit<SfxVariant, "id" | "event" | "index">;

function table(event: SfxEventId, seeds: readonly VariantSeed[]): readonly SfxVariant[] {
  return seeds.map((s, index) => ({ ...s, id: `${event}.${index}`, event, index }));
}

/**
 * The recipe table. Variants of one event differ on SEVERAL axes - wave, glide,
 * length, filter - because three detunings of one sound is still one sound, and
 * D62's whole point in asking for variants is "no repetition fatigue".
 */
export const SFX_VARIANTS: Readonly<Record<SfxEventId, readonly SfxVariant[]>> = Object.freeze({
  // Targeting lock lands on a rock: a small confident upward confirmation.
  lock: table("lock", [
    { wave: "triangle", startHz: 520, endHz: 780, durationMs: 130, attackMs: 4, peakGain: 0.16, filterKind: "lowpass", filterHz: 3200, noise: 0.05, harshness: 0.05, pan: -0.1 },
    { wave: "sine", startHz: 620, endHz: 930, durationMs: 150, attackMs: 6, peakGain: 0.15, filterKind: "lowpass", filterHz: 2800, noise: 0.0, harshness: 0.0, pan: 0.12 },
    { wave: "triangle", startHz: 470, endHz: 705, durationMs: 110, attackMs: 3, peakGain: 0.17, filterKind: "bandpass", filterHz: 1600, noise: 0.08, harshness: 0.08, pan: 0.0 },
  ]),
  // The percussive half of a keypress. The PITCHED half is keystrokeTone.ts
  // (D75), which is why these are tiny: two layers, one tick, one note.
  keystroke: table("keystroke", [
    { wave: "sine", startHz: 880, endHz: 880, durationMs: 32, attackMs: 1, peakGain: 0.06, filterKind: "lowpass", filterHz: 4200, noise: 0.12, harshness: 0.04, pan: -0.06 },
    { wave: "triangle", startHz: 990, endHz: 990, durationMs: 28, attackMs: 1, peakGain: 0.055, filterKind: "lowpass", filterHz: 3800, noise: 0.08, harshness: 0.03, pan: 0.07 },
    { wave: "sine", startHz: 760, endHz: 760, durationMs: 36, attackMs: 2, peakGain: 0.065, filterKind: "lowpass", filterHz: 3000, noise: 0.15, harshness: 0.05, pan: 0.0 },
  ]),
  // D31. A SOFT NEUTRAL TICK. Flat pitch, quiet, short, dark, no noise edge.
  // Not a buzzer, not a descending interval, not an alarm. "That key went
  // somewhere else", said as briefly as it is possible to say anything.
  typo: table("typo", [
    { wave: "sine", startHz: 330, endHz: 330, durationMs: 45, attackMs: 3, peakGain: 0.05, filterKind: "lowpass", filterHz: 1400, noise: 0.0, harshness: 0.0, pan: 0.0 },
    { wave: "triangle", startHz: 294, endHz: 294, durationMs: 55, attackMs: 4, peakGain: 0.045, filterKind: "lowpass", filterHz: 1200, noise: 0.0, harshness: 0.0, pan: -0.08 },
    { wave: "sine", startHz: 392, endHz: 392, durationMs: 40, attackMs: 3, peakGain: 0.048, filterKind: "lowpass", filterHz: 1600, noise: 0.02, harshness: 0.0, pan: 0.09 },
  ]),
  // The rock breaks. Bright, fast, noisy - an impact, not a threat.
  blast: table("blast", [
    { wave: "sawtooth", startHz: 780, endHz: 180, durationMs: 260, attackMs: 2, peakGain: 0.34, filterKind: "lowpass", filterHz: 5200, noise: 0.55, harshness: 0.45, pan: -0.15 },
    { wave: "square", startHz: 640, endHz: 150, durationMs: 300, attackMs: 2, peakGain: 0.32, filterKind: "lowpass", filterHz: 4400, noise: 0.62, harshness: 0.5, pan: 0.18 },
    { wave: "sawtooth", startHz: 900, endHz: 220, durationMs: 220, attackMs: 1, peakGain: 0.36, filterKind: "bandpass", filterHz: 2600, noise: 0.48, harshness: 0.4, pan: 0.02 },
  ]),
  // A rock reaches the hull. D31: this is a WARM LOW THUD you feel, never an
  // alarm, never a descending whine, never a red sound. The hull is the
  // engine's business; the audio's job is "something big just touched us".
  hit: table("hit", [
    { wave: "sine", startHz: 96, endHz: 62, durationMs: 210, attackMs: 6, peakGain: 0.09, filterKind: "lowpass", filterHz: 420, noise: 0.18, harshness: 0.12, pan: 0.0 },
    { wave: "triangle", startHz: 84, endHz: 58, durationMs: 190, attackMs: 8, peakGain: 0.085, filterKind: "lowpass", filterHz: 380, noise: 0.22, harshness: 0.15, pan: -0.12 },
    { wave: "sine", startHz: 110, endHz: 70, durationMs: 170, attackMs: 5, peakGain: 0.095, filterKind: "lowpass", filterHz: 500, noise: 0.14, harshness: 0.1, pan: 0.11 },
  ]),
  // Shields absorb: a rising filtered swell, glassy and protective.
  shield: table("shield", [
    { wave: "triangle", startHz: 240, endHz: 620, durationMs: 420, attackMs: 40, peakGain: 0.2, filterKind: "bandpass", filterHz: 900, noise: 0.35, harshness: 0.12, pan: -0.2 },
    { wave: "sine", startHz: 300, endHz: 760, durationMs: 380, attackMs: 30, peakGain: 0.19, filterKind: "highpass", filterHz: 420, noise: 0.28, harshness: 0.1, pan: 0.2 },
    { wave: "triangle", startHz: 200, endHz: 540, durationMs: 460, attackMs: 55, peakGain: 0.21, filterKind: "bandpass", filterHz: 760, noise: 0.42, harshness: 0.15, pan: 0.0 },
  ]),
  // The warp drive spools. Long, slow, climbing - anticipation.
  warpCharge: table("warpCharge", [
    { wave: "sawtooth", startHz: 70, endHz: 280, durationMs: 1800, attackMs: 220, peakGain: 0.22, filterKind: "lowpass", filterHz: 1400, noise: 0.25, harshness: 0.25, pan: 0.0 },
    { wave: "triangle", startHz: 88, endHz: 330, durationMs: 2000, attackMs: 260, peakGain: 0.2, filterKind: "lowpass", filterHz: 1800, noise: 0.18, harshness: 0.18, pan: -0.14 },
    { wave: "sawtooth", startHz: 60, endHz: 240, durationMs: 1600, attackMs: 180, peakGain: 0.24, filterKind: "bandpass", filterHz: 700, noise: 0.32, harshness: 0.3, pan: 0.15 },
  ]),
  // D62: "warp is a full stinger". The loudest, longest thing in the game.
  warp: table("warp", [
    { wave: "sawtooth", startHz: 180, endHz: 1400, durationMs: 1500, attackMs: 12, peakGain: 0.42, filterKind: "lowpass", filterHz: 7200, noise: 0.5, harshness: 0.42, pan: 0.0 },
    { wave: "square", startHz: 150, endHz: 1200, durationMs: 1700, attackMs: 18, peakGain: 0.4, filterKind: "lowpass", filterHz: 6400, noise: 0.58, harshness: 0.48, pan: -0.1 },
    { wave: "sawtooth", startHz: 210, endHz: 1650, durationMs: 1350, attackMs: 8, peakGain: 0.44, filterKind: "bandpass", filterHz: 3200, noise: 0.44, harshness: 0.38, pan: 0.12 },
  ]),
  // A beacon is lit at a stop: a clear bell, the reward tone of the whole game.
  beacon: table("beacon", [
    { wave: "sine", startHz: 660, endHz: 990, durationMs: 900, attackMs: 8, peakGain: 0.28, filterKind: "lowpass", filterHz: 5200, noise: 0.04, harshness: 0.02, pan: 0.0 },
    { wave: "triangle", startHz: 587, endHz: 880, durationMs: 1000, attackMs: 10, peakGain: 0.27, filterKind: "lowpass", filterHz: 4600, noise: 0.06, harshness: 0.04, pan: -0.15 },
    { wave: "sine", startHz: 740, endHz: 1110, durationMs: 820, attackMs: 6, peakGain: 0.29, filterKind: "highpass", filterHz: 300, noise: 0.03, harshness: 0.02, pan: 0.16 },
  ]),
  // D62: "UI sounds for every interaction". Small, neutral, never fatiguing -
  // a child arrowing down a profile list will hear this a hundred times.
  uiNav: table("uiNav", [
    { wave: "sine", startHz: 520, endHz: 580, durationMs: 55, attackMs: 2, peakGain: 0.08, filterKind: "lowpass", filterHz: 3400, noise: 0.0, harshness: 0.0, pan: -0.05 },
    { wave: "triangle", startHz: 620, endHz: 690, durationMs: 48, attackMs: 2, peakGain: 0.075, filterKind: "lowpass", filterHz: 3000, noise: 0.02, harshness: 0.02, pan: 0.06 },
    { wave: "sine", startHz: 440, endHz: 495, durationMs: 62, attackMs: 3, peakGain: 0.085, filterKind: "lowpass", filterHz: 2600, noise: 0.0, harshness: 0.0, pan: 0.0 },
  ]),
});

export function variantsFor(event: SfxEventId): readonly SfxVariant[] {
  const list = SFX_VARIANTS[event];
  if (!list) throw new Error(`unknown sfx event: ${String(event)}`);
  return list;
}

// ---------------------------------------------------------------------------
// Variant rotation (AC-21.3, second half)
// ---------------------------------------------------------------------------

/**
 * Rotation state. A SHUFFLE BAG, not a random pick.
 *
 * "Never repeat consecutively" alone is satisfied by picking uniformly from the
 * other n-1 every time, but that still lets variant 2 turn up six times in ten
 * plays, which is the repetition fatigue D62 is actually asking us to avoid. A
 * bag plays every variant once before any variant plays twice, and the one
 * seam a bag has - the last of one bag meeting the first of the next - is
 * closed by swapping the incoming first element with the second.
 *
 * So both properties hold by construction, for any count >= 2:
 *   - no consecutive repeat, ever
 *   - every variant heard once per n plays
 */
export interface RotationState {
  /** Indices still to be played from the current bag, in order. */
  readonly bag: readonly number[];
  /** Index played last, or null before the first play. */
  readonly last: number | null;
}

export const initialRotation = (): RotationState => ({ bag: [], last: null });

/** Fisher-Yates over 0..count-1 with the injected rng. Pure given `rand`. */
export function shuffledBag(count: number, rand: () => number): number[] {
  const bag = Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => i);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(clamp(rand(), 0, 0.999999) * (i + 1));
    const a = bag[i];
    const b = bag[j];
    if (a === undefined || b === undefined) continue;
    bag[i] = b;
    bag[j] = a;
  }
  return bag;
}

/**
 * One rotation step. Pure: state in, state out, no clock, no globals.
 * A count of 1 is degenerate (nothing else to play) and returns 0 forever;
 * a count of 0 or less is not a valid event and also returns 0.
 */
export function advanceRotation(
  state: RotationState,
  count: number,
  rand: () => number,
): { index: number; state: RotationState } {
  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return { index: 0, state: { bag: [], last: 0 } };

  let bag = state.bag.slice();
  if (bag.length === 0) {
    bag = shuffledBag(n, rand);
    // Close the seam between bags: never let a new bag open on the variant the
    // previous bag closed on.
    if (bag.length > 1 && bag[0] === state.last) {
      const first = bag[0];
      const second = bag[1];
      if (first !== undefined && second !== undefined) {
        bag[0] = second;
        bag[1] = first;
      }
    }
  }

  const index = bag.shift();
  if (index === undefined) return { index: 0, state: { bag: [], last: 0 } };
  return { index, state: { bag, last: index } };
}

/** Stateful wrapper over `advanceRotation`, one per event, held by the bus. */
export class VariantRotation {
  private state: RotationState = initialRotation();

  constructor(
    private readonly count: number,
    private readonly rand: () => number,
  ) {}

  next(): number {
    const step = advanceRotation(this.state, this.count, this.rand);
    this.state = step.state;
    return step.index;
  }

  get last(): number | null {
    return this.state.last;
  }
}

// ---------------------------------------------------------------------------
// Reactive shaping (D63: "blast pitch vs combo, hit intensity vs hull")
// ---------------------------------------------------------------------------

/** Cap on the blast's rise so a long combo never turns it shrill. */
export const BLAST_MAX_SEMITONES = 7;

/**
 * D63: blast pitch rises with the combo. Pure, capped, and in semitones rather
 * than Hz so it stays musical against the keystroke tone and the music bed.
 * The combo cap matches scoring's x10 (AC-6c.1).
 */
export function blastSemitonesFor(combo: number): number {
  const c = clamp(combo, 0, 10);
  return (c / 10) * BLAST_MAX_SEMITONES;
}

export const blastPitchRatio = (combo: number): number => semitoneRatio(blastSemitonesFor(combo));

/**
 * D63: hit intensity tracks the hull. `hullFraction` is 1 at full hull, 0 at
 * empty. A lower hull makes the thud a little BIGGER - more felt, more present -
 * and deliberately not sharper, brighter or faster. D31: the sound may gain
 * weight, it may never gain menace, so only gain moves and the range is narrow
 * (1.0 .. 1.35). Harshness and filter are untouched.
 */
export function hitIntensityFor(hullFraction: number): number {
  return 1 + (1 - clamp(hullFraction, 0, 1)) * 0.35;
}

// ---------------------------------------------------------------------------
// The bus
// ---------------------------------------------------------------------------

export interface SfxPlayOptions {
  /** D63: raises blast pitch. Ignored by other events. */
  readonly combo?: number;
  /** D63: 1 = full hull. Scales the `hit` thud. Ignored by other events. */
  readonly hullFraction?: number;
  /** Extra linear gain, e.g. a settings volume. Default 1. */
  readonly gainScale?: number;
}

export interface SfxPlayResult {
  readonly variant: SfxVariant;
  /** Linear peak gain actually scheduled, after reactive scaling. */
  readonly peakGain: number;
  /** Start frequency actually scheduled, after reactive pitching. */
  readonly startHz: number;
  readonly durationMs: number;
}

/**
 * The SFX bus. Every event - including every UI sound, per architecture 6 -
 * plays through the single output node handed in at construction, so the mixer
 * has one place to attenuate all of it.
 */
export class SfxBus {
  private readonly rotations = new Map<SfxEventId, VariantRotation>();
  private noiseBuffer: AudioBufferLike | null = null;
  private readonly plays: SfxPlayResult[] = [];

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
    private readonly rand: () => number = seededRandom(0x5f3a21),
  ) {
    for (const event of SFX_EVENTS) {
      this.rotations.set(event, new VariantRotation(variantsFor(event).length, this.rand));
    }
  }

  /** Which variant this event will use next, without playing it. */
  nextVariant(event: SfxEventId): SfxVariant {
    const rotation = this.rotations.get(event);
    const list = variantsFor(event);
    const index = rotation ? rotation.next() : 0;
    const variant = list[index] ?? list[0];
    if (!variant) throw new Error(`event ${event} has no variants`);
    return variant;
  }

  /** Everything played so far, in order. Used by tests and the evidence run. */
  history(): readonly SfxPlayResult[] {
    return this.plays;
  }

  play(event: SfxEventId, options: SfxPlayOptions = {}): SfxPlayResult {
    const variant = this.nextVariant(event);
    const gainScale = Number.isFinite(options.gainScale) ? (options.gainScale as number) : 1;

    const pitchRatio = event === "blast" ? blastPitchRatio(options.combo ?? 0) : 1;
    const intensity =
      event === "hit" ? hitIntensityFor(options.hullFraction ?? 1) : 1;

    const startHz = variant.startHz * pitchRatio;
    const endHz = variant.endHz * pitchRatio;
    const peakGain = clamp(variant.peakGain * intensity * gainScale, 0, 1);

    this.voice(variant, startHz, endHz, peakGain);

    const result: SfxPlayResult = {
      variant,
      peakGain,
      startHz,
      durationMs: variant.durationMs,
    };
    this.plays.push(result);
    return result;
  }

  /** Builds and schedules the nodes for one play. */
  private voice(variant: SfxVariant, startHz: number, endHz: number, peakGain: number): void {
    const now = this.ctx.currentTime;
    const attack = Math.max(0.001, variant.attackMs / 1000);
    const end = now + variant.durationMs / 1000;

    const amp = label(this.ctx.createGain(), `sfx.voice.${variant.id}`);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(peakGain, now + attack);
    // Exponential release: a linear tail on a short sound clicks.
    amp.gain.exponentialRampToValueAtTime(0.0001, Math.max(end, now + attack + 0.01));

    const filter = this.ctx.createBiquadFilter();
    filter.type = variant.filterKind;
    filter.frequency.setValueAtTime(variant.filterHz, now);
    filter.Q.setValueAtTime(variant.filterKind === "bandpass" ? 1.8 : 0.7, now);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(clamp(variant.pan, -1, 1), now);

    filter.connect(amp);
    amp.connect(panner);
    panner.connect(this.output);

    const osc = this.ctx.createOscillator();
    osc.type = variant.wave;
    osc.frequency.setValueAtTime(startHz, now);
    if (Math.abs(endHz - startHz) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), end);
    }
    osc.connect(filter);
    osc.start(now);
    osc.stop(end);

    if (variant.noise > 0) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noise();
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(variant.noise, now);
      noise.connect(noiseGain);
      noiseGain.connect(filter);
      noise.start(now);
      noise.stop(end);
    }
  }

  /** One second of deterministic white noise, generated once and reused. */
  private noise(): AudioBufferLike {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = seededRandom(0x1f2e3d);
    for (let i = 0; i < length; i++) data[i] = rng() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}
