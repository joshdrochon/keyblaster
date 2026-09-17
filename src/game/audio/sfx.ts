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
import {
  CRUMBLE_SECONDS,
  CRUMBLE_VARIANTS,
  crumbleSamples,
  crumbleSeed,
} from "./crumble.js";

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
  /**
   * UR-30 - THE WEIGHT UNDER AN IMPACT. Optional.
   *
   * Destroying a rock was reported as landing with no weight. Rendered
   * offline, the blast had 0.0-1.6% of its energy below 250 Hz and 0.1% below
   * 120 Hz: a bright burst with nothing underneath it and a 100-130 ms tail.
   * Nothing in the recipe could have supplied that, because one oscillator plus
   * noise through one filter cannot be both the crack and the thump.
   *
   * So a second, purely low layer: a sine falling under the burst, on its own
   * longer envelope, which is what gives an impact a body and a tail. Absent on
   * every event that is not an impact - a keystroke tick with a sub under it
   * would be a drum.
   */
  readonly sub?: SubLayer;
  /**
   * UR-34 - THE TRANSIENT. Optional.
   *
   * UR-34 asked for a sharp mechanical-keyboard click on every keystroke, on
   * the ground that sound is how a screen simulates touch. That is the right
   * ground: touch is an EDGE, and a cue with no edge cannot stand in for one.
   *
   * Rendered, the keystroke cue had NO transient to speak of: 0.4-1.8% of its
   * first five milliseconds above 4 kHz, rising to a peak of 0.035-0.048. It is
   * a soft tone, and a soft tone cannot feel like touching anything, because
   * touch is an edge.
   *
   * This is that edge: a few milliseconds of noise through a narrow band, with
   * an attack under half a millisecond. It is deliberately NOT the whole sound -
   * the pentatonic tone still carries where the child is in the word (D75), and
   * the `sub` under it is the case thock. Transient, body, voice; layered, never
   * swapped.
   */
  readonly click?: ClickLayer;
  /**
   * UR-48 - THE ROCK COMING APART. Optional.
   *
   * "It needs to be the most satisfying part of the game." What shipped was an
   * explosion - a sweep, a wash of noise and a sub - and an explosion is not
   * what a rock breaking sounds like. This is the granular half: a pre-baked
   * crowd of small struck-stone fragments, scattered and thinning, from
   * `crumble.ts`. The `sub` under it supplies the mass and the tone above it
   * supplies the crack; this is the part that makes it a ROCK.
   */
  readonly debris?: DebrisLayer;
}

/** The granular body of an impact (UR-48). See crumble.ts for what it is. */
export interface DebrisLayer {
  /** Linear gain on the peak-normalised crumble. */
  readonly gain: number;
  /**
   * How long after the fracture the fragments start, in ms.
   *
   * Physically right and mixing-right at once. A rock does not shed its pieces
   * at the instant it breaks - the snap comes first and the debris follows -
   * and four layers landing on the same sample summed to a peak of 0.53, over
   * the ceiling UR-30 set. Moving the crowd back by a few milliseconds fixes
   * both, and leaves the first fifty milliseconds to the click, which is what
   * makes the crack read consistently.
   */
  readonly delayMs: number;
  /**
   * How far the playback rate is moved per press, as a fraction.
   *
   * THE ANTI-REPETITION LEVER, and the reason it is a rate rather than a filter
   * or a level: a rate change rewrites the INTERVALS between fragments as well
   * as their pitch, and the interval pattern is what an ear latches onto in a
   * granular texture. Colour jitter leaves the rhythm of the fall identical,
   * which is exactly what would make this gravel by word thirty.
   */
  readonly rateJitter: number;
}

/**
 * The attack of a key press (UR-34): a very short band of noise.
 *
 * Every field is small on purpose. A mechanical switch's click is 2-6 ms long
 * and lives between about 2 and 6 kHz; anything longer is a rattle and anything
 * brighter is a hiss. This fires on every key of every word, so the budget is
 * the tightest in the table.
 */
export interface ClickLayer {
  /** Centre of the band, in Hz. Jittered per play; see `CLICK_JITTER`. */
  readonly hz: number;
  /**
   * Q is LOW on purpose (UR-34). A narrow band takes about Q/f0 seconds to ring
   * up from a cold filter, and at Q = 1.1 that put the click's realised peak
   * 1.06 ms in - later than its own 0.35 ms envelope apex, and late enough that
   * the press no longer began with an edge. A real switch is broadband anyway;
   * this band is a colour on it, not a resonance.
   */
  readonly q: number;
  readonly durationMs: number;
  /** Linear gain on the noise, before the band. */
  readonly gain: number;
}

/**
 * UR-34 - HOW FAR THE CLICK MOVES FROM PLAY TO PLAY.
 *
 * A real keyboard does not make the same sound twice: the switch, the finger
 * and the key all differ. This cue fires hundreds of times in a belt, and the
 * one thing that has already gone wrong on this project is a sound becoming
 * unbearable through repetition. So the click's band and level are drawn fresh
 * every press, and the noise itself is read from a different place in the
 * buffer each time (`AudioBufferSourceNodeLike.start`'s offset).
 *
 * +/-18% of the centre frequency is roughly +/-3 semitones of timbre, which is
 * the spread you hear across the keys of one board. +/-22% of level is the
 * spread you hear across strokes of one key.
 */
export const CLICK_JITTER = Object.freeze({ hz: 0.18, gain: 0.22 });

/**
 * UR-45 - WHY EVERY BANDPASS VARIANT WAS THE QUIET ONE.
 *
 * Rendered variant by variant, the spread between siblings of one event was:
 *
 *   warp        17.6 dB    warp.2      bandpass @ 1800, tone  220 -> 880 Hz
 *   warpCharge  15.5 dB    warpCharge.2 bandpass @  700, tone   62 -> 247 Hz
 *   lock        12.7 dB    lock.2      bandpass @ 1600, tone  470 -> 705 Hz
 *   shield       9.2 dB    shield.0/.2 bandpass @ 900/760
 *   every lowpass/highpass event: under 3 dB
 *
 * One warp takeoff in three was 17 dB down - effectively silent, on the game's
 * biggest moment. The pattern is exact and it is not a coincidence: a bandpass
 * CENTRED OUTSIDE ITS OWN TONE'S SWEEP deletes the fundamental and leaves the
 * harmonics, and a triangle's harmonics are 1/n^2. UR-13 made warp.2 worse by
 * moving its tone two octaves down without moving the filter with it.
 *
 * Two changes, both structural rather than per-variant patches: every bandpass
 * centre now sits INSIDE its variant's own sweep, and the Q comes down so a
 * glide is coloured rather than gated. `rendered.test.ts` holds the sibling
 * spread under 6 dB for every event, so this class cannot come back quietly.
 */
export const BANDPASS_Q = 0.8;

/**
 * UR-44 SET THE CEILING ON THE CLICK GAINS, AND UR-34 SET THE FLOOR.
 *
 * The first pass ran the click at 0.46-0.54 and a press peaked 0.21 median
 * rendered - above everything in the game except the blast, the warp and the
 * beacon, for a cue that fires three hundred times a belt. Halving it put the
 * press under a hull hit and took the transient with it: the quietest press in
 * thirty dropped to 9.0% of its attack energy above 2 kHz, under the 10% floor,
 * and the median rise slipped to 0.73 ms.
 *
 * The shipped numbers satisfy both bounds at once, and both bounds are
 * measurements rather than taste - see the UR-34 and UR-44 blocks in
 * `rendered.test.ts`.
 */

/** The low body under an impact (UR-30). Sine only; this layer is felt, not heard. */
export interface SubLayer {
  readonly startHz: number;
  readonly endHz: number;
  /** Longer than the burst above it: the tail is most of what "weight" means. */
  readonly durationMs: number;
  readonly gain: number;
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
    { wave: "triangle", startHz: 470, endHz: 705, durationMs: 110, attackMs: 3, peakGain: 0.17, filterKind: "bandpass", filterHz: 580, noise: 0.08, harshness: 0.08, pan: 0.0 },
  ]),
  // The percussive half of a keypress. The PITCHED half is keystrokeTone.ts
  // (D75), which is why these are tiny: two layers, one tick, one note.
  // UR-34: each one now carries a `click` (the switch) and a `sub` (the case
  // thock) under the tone. Three different switches rather than three tunings of
  // one, because the bag plays all three within any three presses and a child
  // types four to eight letters a word.
  keystroke: table("keystroke", [
    { wave: "sine", startHz: 880, endHz: 880, durationMs: 32, attackMs: 1, peakGain: 0.06, filterKind: "lowpass", filterHz: 4200, noise: 0.12, harshness: 0.04, pan: -0.06,
      click: { hz: 3400, q: 0.7, durationMs: 15, gain: 0.33 }, sub: { startHz: 250, endHz: 165, durationMs: 26, gain: 0.09 } },
    { wave: "triangle", startHz: 990, endHz: 990, durationMs: 28, attackMs: 1, peakGain: 0.055, filterKind: "lowpass", filterHz: 3800, noise: 0.08, harshness: 0.03, pan: 0.07,
      click: { hz: 4100, q: 0.8, durationMs: 13, gain: 0.3 }, sub: { startHz: 285, endHz: 190, durationMs: 22, gain: 0.08 } },
    { wave: "sine", startHz: 760, endHz: 760, durationMs: 36, attackMs: 2, peakGain: 0.065, filterKind: "lowpass", filterHz: 3000, noise: 0.15, harshness: 0.05, pan: 0.0,
      click: { hz: 2900, q: 0.6, durationMs: 17, gain: 0.36 }, sub: { startHz: 215, endHz: 142, durationMs: 30, gain: 0.1 } },
  ]),
  // D31. A SOFT NEUTRAL TICK. Flat pitch, quiet, short, dark, no noise edge.
  // Not a buzzer, not a descending interval, not an alarm. "That key went
  // somewhere else", said as briefly as it is possible to say anything.
  //
  // UR-34 / UR-44 - THE TYPO DOES *NOT* GET THE SWITCH CLICK, AND I CHANGED MY
  // MIND ABOUT THAT.
  //
  // The first answer was "a real keyboard does not know whether you hit the
  // right letter, so give a typo the identical click". It was wrong, and the
  // measurement is what showed it: with the click on, typo.2 peaked 0.222
  // rendered, against a hull hit at 0.070. A mistyped key landed three times
  // harder than being struck by a rock. That is failure vocabulary expressed as
  // volume, and D31 forbids it however even-handed the intent was.
  //
  // The realism argument was also answering the wrong question. D31's rule is
  // not "a miss must sound the same as a hit", it is "nothing reads as
  // failure". A miss that is SOFTER is not a punishment - it is the shape this
  // table already had, and `GENTLE_EVENTS` exists to keep it that way.
  //
  // `rendered.test.ts` now measures the gentle budget on the RENDER rather than
  // on `peakGain`, which is how a layer added on top of a declared field got
  // past the budget in the first place.
  typo: table("typo", [
    { wave: "sine", startHz: 330, endHz: 330, durationMs: 45, attackMs: 3, peakGain: 0.05, filterKind: "lowpass", filterHz: 1400, noise: 0.0, harshness: 0.0, pan: 0.0 },
    { wave: "triangle", startHz: 294, endHz: 294, durationMs: 55, attackMs: 4, peakGain: 0.045, filterKind: "lowpass", filterHz: 1200, noise: 0.0, harshness: 0.0, pan: -0.08 },
    { wave: "sine", startHz: 392, endHz: 392, durationMs: 40, attackMs: 3, peakGain: 0.048, filterKind: "lowpass", filterHz: 1600, noise: 0.02, harshness: 0.0, pan: 0.09 },
  ]),
  // The rock breaks. Bright, fast, noisy - an impact, not a threat.
  // THREE LAYERS, AND THE MIDDLE ONE IS THE ROCK.
  //
  // UR-30 added the `sub`: a low sine falling under the burst on a much longer
  // envelope. That was the "empty" the first report named - the crack was
  // there, the thump and the tail were not.
  //
  // UR-48 is the second report, and it is about what the sound IS rather than
  // what it is missing. The tonal sweep is now a CRACK and nothing more - 80 to
  // 110 ms instead of 220 to 300, with the wash of white noise cut by more than
  // half - because the long sweep and the hiss together were an explosion, and
  // a rock coming apart is granular. `debris` is the crowd of stone fragments
  // that replaced them, and the `click` is the fracture itself - the snap that
  // the shortened sweep no longer reliably carried. Four layers now, and each
  // answers a different question: the click is the rock BREAKING, the sweep is
  // the force that broke it, the debris is the pieces, the sub is the mass.
  blast: table("blast", [
    { wave: "sawtooth", startHz: 780, endHz: 180, durationMs: 90, attackMs: 2, peakGain: 0.2, filterKind: "lowpass", filterHz: 5200, noise: 0.22, harshness: 0.45, pan: -0.15,
      click: { hz: 3600, q: 0.7, durationMs: 18, gain: 0.6 },
      debris: { gain: 0.3, rateJitter: 0.1, delayMs: 18 }, sub: { startHz: 132, endHz: 70, durationMs: 460, gain: 0.23 } },
    { wave: "square", startHz: 640, endHz: 150, durationMs: 110, attackMs: 2, peakGain: 0.17, filterKind: "lowpass", filterHz: 4400, noise: 0.25, harshness: 0.5, pan: 0.18,
      click: { hz: 4200, q: 0.8, durationMs: 16, gain: 0.54 },
      debris: { gain: 0.32, rateJitter: 0.12, delayMs: 22 }, sub: { startHz: 116, endHz: 62, durationMs: 520, gain: 0.24 } },
    { wave: "sawtooth", startHz: 1500, endHz: 220, durationMs: 80, attackMs: 1, peakGain: 0.22, filterKind: "bandpass", filterHz: 1300, noise: 0.2, harshness: 0.4, pan: 0.02,
      click: { hz: 3100, q: 0.6, durationMs: 20, gain: 0.62 },
      debris: { gain: 0.27, rateJitter: 0.09, delayMs: 15 }, sub: { startHz: 155, endHz: 78, durationMs: 400, gain: 0.21 } },
  ]), // A rock reaches the hull. D31: this is a WARM LOW THUD you feel, never an
  // alarm, never a descending whine, never a red sound. The hull is the
  // engine's business; the audio's job is "something big just touched us".
  hit: table("hit", [
    { wave: "sine", startHz: 96, endHz: 62, durationMs: 210, attackMs: 6, peakGain: 0.09, filterKind: "lowpass", filterHz: 420, noise: 0.18, harshness: 0.12, pan: 0.0 },
    { wave: "triangle", startHz: 84, endHz: 58, durationMs: 190, attackMs: 8, peakGain: 0.085, filterKind: "lowpass", filterHz: 380, noise: 0.22, harshness: 0.15, pan: -0.12 },
    { wave: "sine", startHz: 110, endHz: 70, durationMs: 170, attackMs: 5, peakGain: 0.095, filterKind: "lowpass", filterHz: 500, noise: 0.14, harshness: 0.1, pan: 0.11 },
  ]),
  // Shields absorb: a rising filtered swell, glassy and protective.
  shield: table("shield", [
    { wave: "triangle", startHz: 240, endHz: 620, durationMs: 420, attackMs: 40, peakGain: 0.2, filterKind: "bandpass", filterHz: 400, noise: 0.35, harshness: 0.12, pan: -0.2 },
    { wave: "sine", startHz: 300, endHz: 760, durationMs: 380, attackMs: 30, peakGain: 0.19, filterKind: "highpass", filterHz: 420, noise: 0.28, harshness: 0.1, pan: 0.2 },
    { wave: "triangle", startHz: 200, endHz: 540, durationMs: 460, attackMs: 55, peakGain: 0.21, filterKind: "bandpass", filterHz: 340, noise: 0.42, harshness: 0.15, pan: 0.0 },
  ]),
  // The warp drive spools. Long, slow, climbing - anticipation.
  //
  // UR-13 - WHY THESE ARE NO LONGER SAWTOOTHS. A sawtooth has every harmonic at
  // 1/n, so a 70 Hz one under a 1400 Hz lowpass is twenty near-equal partials:
  // the electrical buzz UR-13 reports, and the warp screen
  // plays it four times on the way up the meter. A triangle's harmonics are odd
  // only and fall at 1/n^2, which is ~18 dB down on the third partial against
  // the sawtooth's ~10 dB - the same rising drive without the electrical edge.
  warpCharge: table("warpCharge", [
    { wave: "triangle", startHz: 73.42, endHz: 293.66, durationMs: 1800, attackMs: 220, peakGain: 0.22, filterKind: "lowpass", filterHz: 1400, noise: 0.25, harshness: 0.12, pan: 0.0 },
    { wave: "sine", startHz: 87.31, endHz: 349.23, durationMs: 2000, attackMs: 260, peakGain: 0.2, filterKind: "lowpass", filterHz: 1800, noise: 0.18, harshness: 0.06, pan: -0.14 },
    { wave: "triangle", startHz: 61.74, endHz: 246.94, durationMs: 1600, attackMs: 180, peakGain: 0.24, filterKind: "bandpass", filterHz: 130, noise: 0.32, harshness: 0.15, pan: 0.15 },
  ]),
  // D62: "warp is a full stinger". The loudest, longest thing in the game.
  //
  // UR-13 - THE TAKEOFF IS SUPPOSED TO BE A REWARD, AND WAS NOT.
  //
  // What was here was a sawtooth and a square sweeping to 1400-1650 Hz under a
  // 6.4-7.2 kHz lowpass with half its level in white noise. Rendered offline,
  // variant 2 put 16.7% of its energy above 4 kHz and the set peaked at 0.574
  // through the SFX bus - the brightest and loudest thing in the game by a wide
  // margin, and abrasive rather than rewarding.
  //
  // It is now a DEPARTURE: a soft-attacked triangle rising two octaves on a real
  // interval (G3->G5, C4->C6, A3->A5), so the takeoff lands as a note going up
  // rather than as a sweep going bright. The noise is halved and the filter
  // pulled down more than an octave, which is where the abrasiveness lived. It
  // stays the longest sound in the game and the loudest recipe in the table, so
  // D62's "full stinger" is unchanged; it is the timbre that moved, not the
  // status.
  warp: table("warp", [
    { wave: "triangle", startHz: 196.0, endHz: 784.0, durationMs: 1500, attackMs: 26, peakGain: 0.38, filterKind: "lowpass", filterHz: 3200, noise: 0.26, harshness: 0.16, pan: 0.0 },
    { wave: "sine", startHz: 261.63, endHz: 1046.5, durationMs: 1700, attackMs: 34, peakGain: 0.36, filterKind: "lowpass", filterHz: 2600, noise: 0.32, harshness: 0.1, pan: -0.1 },
    { wave: "triangle", startHz: 220.0, endHz: 880.0, durationMs: 1350, attackMs: 20, peakGain: 0.47, filterKind: "bandpass", filterHz: 460, noise: 0.2, harshness: 0.18, pan: 0.12 },
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
  /**
   * A caller-supplied transposition, in semitones, applied to ANY event.
   *
   * D63's reactive shaping is per-event and computed in here - blast pitch from
   * the combo, hit weight from the hull - because those two are rules about the
   * game and belong with the recipe. This is the other kind: a screen that is
   * SOUNDING A CONTINUOUS QUANTITY and needs the pitch to track it. The warp
   * break is the case that asked for it; a charge meter whose sound does not
   * climb tells the player nothing about how close they are.
   *
   * Semitones rather than Hz, and capped, for the same reason
   * `blastSemitonesFor` is: everything in this game has to stay musical against
   * the keystroke tone (D75) and the music bed.
   */
  readonly pitchSemitones?: number;
}

/** Cap on `SfxPlayOptions.pitchSemitones`. One octave each way. */
export const MAX_PITCH_SEMITONES = 12;

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
/**
 * UR-15 - HOW FAR APART TWO VOICES ARE PUSHED WHEN THE CLOCK IS NOT MOVING.
 *
 * 12 ms: under the ~20 ms at which two transients stop being one event, so a
 * displaced voice is never heard as late; long enough that eight of them no
 * longer share an attack.
 */
export const STALLED_VOICE_SPACING_MS = 12;

/**
 * UR-55 - HOW FAR AHEAD OF THE CLOCK A VOICE IS SCHEDULED, AND WHY IT MUST BE
 * AHEAD AT ALL.
 *
 * `ctx.currentTime` on the main thread NEVER names a sample the renderer has
 * yet to produce. It is the start of the last completed render quantum; the
 * audio thread is already working on the next one, and Chrome reports the gap
 * as `baseLatency` (two quanta, 5.3 ms at 48 kHz, on every machine this game
 * was measured on). So `setValueAtTime(x, ctx.currentTime)` is an event in the
 * PAST, and Web Audio resolves a past event by jumping the param straight to
 * where the completed automation left it.
 *
 * WHICH MEANS AN ATTACK SHORTER THAN THAT GAP IS NEVER RENDERED. It is not
 * shortened - it is skipped, and the layer's first sample arrives at full gain.
 * The click layer's attack is 0.35 ms and the tone's is 1-2 ms; both are under
 * one 2.67 ms quantum, so on a real context BOTH were being skipped, every time.
 * Measured in Chromium's own `OfflineAudioContext` with the clock made stale by
 * exactly one quantum - the smallest staleness any real context has - the first
 * sample of a voice steps by:
 *
 *   event       on time      one quantum late     that is
 *   keystroke   -101.1 dBFS  -30.4 dBFS median    71 dB, 3600x
 *   blast       -101.6 dBFS  -25.0 dBFS median    77 dB, 6700x
 *
 * and the worst of sixty presses reached -24.6 and -19.3 dBFS, 0.6x the whole
 * sound's own largest step. INTERMITTENT BY CONSTRUCTION: the size of the step
 * is the first sample of the noise buffer at this voice's random read offset
 * (UR-34), so it is a different height on every press - most are small, some
 * are the full jump. "Every once in a while" is that distribution.
 *
 * 8 ms. It has to clear the gap between the clock we read and the sample the
 * renderer is on: one quantum is 2.67 ms at 48 kHz and 2.90 ms at 44.1 kHz, and
 * Chrome's `baseLatency` is two of them. 8 ms clears two quanta at either rate
 * with room over, and it is under half a 60 fps frame, so no cue is heard late -
 * the ear reads two transients under about 20 ms apart as one event, which is
 * the same budget `STALLED_VOICE_SPACING_MS` is chosen against.
 *
 * The alternative - lengthening the envelopes past a quantum - was rejected:
 * the 0.35 ms click attack is the EDGE the click layer exists to provide, and
 * stretching it to 3 ms to survive a scheduling bug would be answering the
 * wrong question with the sound design.
 */
export const SFX_SCHEDULE_LOOKAHEAD_MS = 8;

/**
 * The lookahead for a particular context, in seconds.
 *
 * 8 ms is the FLOOR, not the answer. It clears the two render quanta this game
 * was measured on, and a machine whose output path is slower is behind by more
 * than that - a Bluetooth headset or a shared-mode WASAPI device can report a
 * `baseLatency` of 20 ms or more, and on one of those a fixed 8 ms would leave
 * the defect exactly where it was. So the context is ASKED when it can answer,
 * and twice its own reported latency is the bar, because `baseLatency` is the
 * device's contribution and the renderer is ahead of the clock by roughly that
 * again.
 *
 * A context that does not report one - an `OfflineAudioContext`, the null
 * context, the test renderer - is not behind an output device at all, and gets
 * the floor.
 */
export function sfxLookaheadSeconds(ctx: Pick<AudioContextLike, "baseLatency">): number {
  const floor = SFX_SCHEDULE_LOOKAHEAD_MS / 1000;
  const reported = ctx.baseLatency;
  if (typeof reported !== "number" || !Number.isFinite(reported) || reported <= 0) return floor;
  // Capped: past a tenth of a second the machine's own latency is what the
  // child is hearing and adding more of it would make the cue late for real.
  return Math.min(0.1, Math.max(floor, reported * 2));
}

/**
 * UR-30 - HOW FAR EACH VOICE IS DETUNED, IN CENTS.
 *
 * "The typing sounds don't feel satisfying." Rendered as a belt - 20 words of
 * five keys - the keystroke cue produced exactly FIVE distinct tones across 100
 * presses, and word ten was bit-identical to word one. Nothing was wrong with
 * the sound; what was wrong was that it was the same sound every time, hundreds
 * of times a run.
 *
 * Six cents is about a twentieth of a semitone: below the threshold at which a
 * change reads as a different note, above the point where two renders are the
 * same file. It applies to every event, because every event in a long session
 * has the same problem to a lesser degree.
 */
export const DETUNE_JITTER_CENTS = 6;

export class SfxBus {
  private readonly rotations = new Map<SfxEventId, VariantRotation>();
  private noiseBuffer: AudioBufferLike | null = null;
  private readonly plays: SfxPlayResult[] = [];
  private readonly crumbleRotation: VariantRotation;
  /** The context clock reading the previous voice was scheduled against. */
  private lastClock = Number.NEGATIVE_INFINITY;
  /** How many voices have been scheduled since the clock last moved. */
  private stalledVoices = 0;

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
    private readonly rand: () => number = seededRandom(0x5f3a21),
  ) {
    for (const event of SFX_EVENTS) {
      this.rotations.set(event, new VariantRotation(variantsFor(event).length, this.rand));
    }
    this.crumbleRotation = new VariantRotation(CRUMBLE_VARIANTS, this.rand);
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

    // The two pitch sources compose: the event's own rule (blast rises with the
    // combo) and the caller's continuous one. With neither supplied this is
    // exactly 1, so every existing call sounds the way it always did.
    const reactive = event === "blast" ? blastSemitonesFor(options.combo ?? 0) : 0;
    const requested = clamp(
      options.pitchSemitones ?? 0,
      -MAX_PITCH_SEMITONES,
      MAX_PITCH_SEMITONES,
    );
    const pitchRatio = semitoneRatio(reactive + requested);
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

  /**
   * When a voice actually starts.
   *
   * UR-15 - WHY THIS IS NOT JUST `ctx.currentTime`.
   *
   * A browser will not start an `AudioContext` before a gesture, and a
   * suspended context's `currentTime` DOES NOT ADVANCE - it sits at 0 until
   * `resume()`. The Title screen fires `uiNav` on pointerOVER, which is not a
   * gesture, so a child who runs the mouse down the menu before clicking
   * queues every one of those blips at exactly t = 0. They are all the same
   * waveform with the same phase and the same 2 ms attack, so when the context
   * finally starts they do not arrive as several small sounds; they SUM.
   * Rendered offline through the SFX bus at its shipped level:
   *
   *   voices at t=0    1        2        3        5        8
   *   peak             0.0524   0.0810   0.0888   0.1557   0.2508
   *   largest step     0.00359  0.00549  0.00868  0.01644  0.02246
   *
   * Eight hovers is 4.8x the peak and 6.3x the sample-to-sample step of one
   * blip, delivered in a 2 ms attack. That is a pop.
   *
   * So: a voice scheduled against a clock that has not moved since the last one
   * is pushed `STALLED_VOICE_SPACING_MS` past it. While the clock is running
   * this is exactly `ctx.currentTime` and nothing changes - a real context
   * advances every 128 samples, which is 2.7 ms at 48 kHz, so consecutive plays
   * in normal use always read a later clock. It only ever engages when the
   * clock is frozen, which is precisely the case that stacks.
   */
  private startTime(): number {
    const clock = this.ctx.currentTime;
    // UR-55: every voice is scheduled into the FUTURE, because `clock` is
    // already in the past by at least a render quantum and an envelope whose
    // attack falls before the renderer's current sample is skipped rather than
    // shortened. The lookahead is added on both branches so the UR-15 stall
    // spacing still measures from the same place it always did.
    const lookahead = sfxLookaheadSeconds(this.ctx);
    if (clock > this.lastClock) {
      this.lastClock = clock;
      this.stalledVoices = 0;
      return clock + lookahead;
    }
    this.stalledVoices += 1;
    return clock + lookahead + (this.stalledVoices * STALLED_VOICE_SPACING_MS) / 1000;
  }

  /** Builds and schedules the nodes for one play. */
  private voice(variant: SfxVariant, startHz: number, endHz: number, peakGain: number): void {
    const now = this.startTime();
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
    // UR-45: 0.8, not 1.8. A bandpass this narrow over a tone that SWEEPS only
    // passes the sound for the instant it crosses the centre, and the rest of
    // the glide is thrown away. Broad enough to colour, wide enough that a
    // variant is still audibly its event.
    filter.Q.setValueAtTime(variant.filterKind === "bandpass" ? BANDPASS_Q : 0.7, now);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(clamp(variant.pan, -1, 1), now);

    filter.connect(amp);
    amp.connect(panner);
    panner.connect(this.output);

    const osc = this.ctx.createOscillator();
    osc.type = variant.wave;
    osc.frequency.setValueAtTime(startHz, now);
    // UR-30: a few cents, never the same twice. Too small to hear as PITCH and
    // exactly large enough that the hundredth keystroke is not a byte-for-byte
    // replay of the first. Delivered on `detune` rather than on `frequency` so
    // the reported `startHz` stays the number the recipe asked for.
    osc.detune.setValueAtTime((this.rand() * 2 - 1) * DETUNE_JITTER_CENTS, now);
    if (Math.abs(endHz - startHz) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), end);
    }
    osc.connect(filter);
    osc.start(now);
    osc.stop(end);

    if (variant.noise > 0) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noise();
      // UR-34: a different stretch of noise every time. Looping so an offset
      // near the end of the buffer still has material behind it - the wrap is a
      // step drawn from the same distribution as every other step in white
      // noise, which is the one signal a seam cannot be heard in.
      noise.loop = true;
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(variant.noise, now);
      noise.connect(noiseGain);
      noiseGain.connect(filter);
      noise.start(now, this.noiseOffset());
      noise.stop(end);
    }

    // UR-34: THE CLICK. Its own band and its own envelope, both bypassing the
    // voice's filter - that filter is what shapes the TONE, and a transient
    // that went through it would be exactly the soft edge this layer exists to
    // replace.
    const click = variant.click;
    if (click !== undefined && click.gain > 0) {
      const jitterHz = 1 + (this.rand() * 2 - 1) * CLICK_JITTER.hz;
      const jitterGain = 1 + (this.rand() * 2 - 1) * CLICK_JITTER.gain;
      const clickEnd = now + click.durationMs / 1000;
      // 0.35 ms. Short enough to be an edge, long enough not to be a step.
      const clickAttack = 0.00035;

      const clickAmp = this.ctx.createGain();
      clickAmp.gain.setValueAtTime(0.0001, now);
      clickAmp.gain.linearRampToValueAtTime(
        click.gain * jitterGain * (peakGain / variant.peakGain),
        now + clickAttack,
      );
      clickAmp.gain.exponentialRampToValueAtTime(0.0001, clickEnd);
      clickAmp.connect(panner);

      const clickBand = this.ctx.createBiquadFilter();
      clickBand.type = "bandpass";
      clickBand.frequency.setValueAtTime(click.hz * jitterHz, now);
      clickBand.Q.setValueAtTime(click.q, now);
      clickBand.connect(clickAmp);

      const clickNoise = this.ctx.createBufferSource();
      clickNoise.buffer = this.noise();
      clickNoise.loop = true;
      clickNoise.connect(clickBand);
      clickNoise.start(now, this.noiseOffset());
      clickNoise.stop(clickEnd);
    }

    // UR-48: the granular body. One buffer source for the whole crowd of
    // fragments - see crumble.ts for why the grains are baked rather than built
    // as nodes - with its own gain and its own rate.
    const debris = variant.debris;
    if (debris !== undefined && debris.gain > 0) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.crumble();
      const rate = 1 + (this.rand() * 2 - 1) * debris.rateJitter;
      source.playbackRate.setValueAtTime(Math.max(0.25, rate), now);
      const at = now + debris.delayMs / 1000;

      const debrisGain = this.ctx.createGain();
      debrisGain.gain.setValueAtTime(debris.gain * (peakGain / variant.peakGain), at);
      source.connect(debrisGain);
      debrisGain.connect(panner);
      source.start(at);
      // The crumble fades itself out at its own end (crumble.ts), so it needs
      // no envelope here and must not be cut short by one: stopping it early is
      // how a fall that should settle turns back into a thud.
      source.stop(at + CRUMBLE_SECONDS / Math.max(0.25, rate) + 0.02);
    }

    // UR-30: the low body under an impact. It bypasses the voice's own filter
    // and envelope on purpose - the filter is what shapes the CRACK, and a
    // 460 ms thump under a 260 ms burst needs its own, longer tail.
    const sub = variant.sub;
    if (sub !== undefined && sub.gain > 0) {
      const subEnd = now + sub.durationMs / 1000;
      const subAmp = this.ctx.createGain();
      subAmp.gain.setValueAtTime(0.0001, now);
      // Proportional, capped at the 4 ms an impact wants. UR-34 tightened the
      // proportion: at 6% a 26 ms keystroke thock took 1.56 ms to reach its
      // apex, which on the presses where the jittered click came in quiet made
      // the THOCK the peak of the sound and the whole press rise in 1.5 ms. A
      // key bottoming out is as fast an event as the switch clicking, so 3%.
      const subAttack = Math.min(0.004, (sub.durationMs / 1000) * 0.03);
      subAmp.gain.linearRampToValueAtTime(sub.gain * (peakGain / variant.peakGain), now + subAttack);
      subAmp.gain.exponentialRampToValueAtTime(0.0001, subEnd);
      subAmp.connect(panner);

      const subOsc = this.ctx.createOscillator();
      subOsc.type = "sine";
      subOsc.frequency.setValueAtTime(sub.startHz * (startHz / variant.startHz), now);
      subOsc.frequency.exponentialRampToValueAtTime(
        Math.max(1, sub.endHz * (startHz / variant.startHz)),
        subEnd,
      );
      subOsc.connect(subAmp);
      subOsc.start(now);
      subOsc.stop(subEnd);
    }
  }

  /**
   * Where in the noise buffer this voice starts reading (UR-34).
   *
   * Kept clear of the last two seconds' worth of nothing - the buffer is one
   * second and the longest noise in the table is 1.7 s - by looping the source
   * rather than by bounding the offset, so any offset is safe.
   */
  private noiseOffset(): number {
    return this.rand();
  }

  /**
   * The next baked crumble, chosen from a shuffle bag.
   *
   * A bag rather than a random pick, for the reason `VariantRotation` gives:
   * picking uniformly still lets one crumble turn up six times in ten blasts,
   * and repetition is the whole risk with a granular texture. Every one is heard
   * before any is heard twice.
   */
  private crumble(): AudioBufferLike {
    let cached = SfxBus.sharedCrumbles.get(this.ctx);
    if (cached === undefined) {
      cached = [];
      SfxBus.sharedCrumbles.set(this.ctx, cached);
    }
    const index = this.crumbleRotation.next();
    const existing = cached[index];
    if (existing !== undefined) return existing;
    const samples = crumbleSamples(this.ctx.sampleRate, crumbleSeed(index));
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    cached[index] = buffer;
    return buffer;
  }

  /** Baked once per context and shared by every blast on it. */
  private static sharedCrumbles: WeakMap<object, AudioBufferLike[]> = new WeakMap();

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
