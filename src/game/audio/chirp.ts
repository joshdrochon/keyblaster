/**
 * SHADOW'S CHIRP (UR-25, D31, D63).
 *
 * THE DEFECT. A player asked "Does Shadow talk? I thought he was supposed to at
 * least chirp or something." That the question had to be asked is the finding.
 * Shadow has 44 rendered lines and three scenes that speak them, but every line
 * WITHOUT a recording - which includes all seven coach templates at the warp
 * break, the screen a child sees most - made no sound at all.
 *
 * WHAT IT WAS. A chirp hook already existed in `VoiceEnvironment`, but it was
 * reachable only on a machine that HAD a speech API and had been declined (a
 * cloud-only voice list). D98 then turned the platform voice off by default, so
 * `web` was null in every shipped session and the hook could never fire. The
 * feature was wired and unreachable - the same failure mode this package's own
 * header warns about.
 *
 * WHAT IT IS NOW. `adaptiveTransport` chirps whenever the line it is about to
 * play will make no sound, whatever the reason, and the sound is this recipe on
 * the VOICE bus rather than a borrowed `uiNav` on the SFX bus. `AudioGraph`
 * counts them (`chirpCount`), because nothing else can see a chirp happen -
 * this module touches no history, and an e2e was still counting SFX plays for
 * a sound that had stopped making one.
 *
 * WHAT A CHIRP IS FOR. It is not an error sound and it is not a notification.
 * D31: nothing in this game reads as failure. It is "he said something" - a
 * small robot noticing you - so it is short, soft, pitched and rising, and it
 * is the same sound whether the line was missing, refused or simply silent.
 *
 * WHY IT IS NOT A KEYSTROKE TICK. The keystroke cue fires on every key press
 * during flight and at the warp break: 28-36 ms, FLAT pitch at 760-990 Hz, one
 * grain, peak 0.055-0.065, on the SFX bus. A chirp that landed inside that
 * envelope would read as a glitch in the typing rather than as a character. So
 * this is deliberately separated on all four axes at once - four times longer,
 * two grains rather than one, rising rather than flat, and on the VOICE bus,
 * where Shadow's recorded lines already live and where the AC-21.4 duck and the
 * voice fader already apply. `chirpSeparation` measures the gap and a test
 * asserts it, so the two can never drift back together.
 *
 * PURE SPEC, like every other recipe in this package: the table is inspectable
 * in a plain Node test and `playChirp` is the only part that needs a context.
 */

import {
  clamp,
  type AudioContextLike,
  type AudioNodeLike,
  type OscillatorWave,
} from "./context.js";
import { label } from "./nullContext.js";
import { variantsFor, type SfxVariant } from "./sfx.js";

/** One grain of the chirp. Two of them make the figure. */
export interface ChirpGrain {
  /** Offset from the start of the chirp, in ms. */
  readonly atMs: number;
  readonly wave: OscillatorWave;
  readonly startHz: number;
  readonly endHz: number;
  readonly durationMs: number;
  readonly attackMs: number;
  readonly peakGain: number;
}

/**
 * The recipe.
 *
 * Two rising grains a fourth apart, the second overlapping the tail of the
 * first, so it reads as one two-syllable sound rather than two beeps. G4->C5
 * then D5->G5: real intervals, because everything in this game has to stay
 * musical against the keystroke tone (D75) and the music bed.
 *
 * DELIBERATELY BELOW THE KEYSTROKE TICK, which lives at 760-990 Hz. Down rather
 * than up because up is where a notification bleep lives, and because a warmer
 * register is what makes this read as a small machine murmuring rather than as
 * an alert. `chirpSeparation` reports the distance and a test holds it.
 */
export const SHADOW_CHIRP: readonly ChirpGrain[] = Object.freeze([
  Object.freeze({ atMs: 0, wave: "triangle" as const, startHz: 392.0, endHz: 523.25, durationMs: 70, attackMs: 7, peakGain: 0.13 }),
  Object.freeze({ atMs: 52, wave: "triangle" as const, startHz: 587.33, endHz: 783.99, durationMs: 95, attackMs: 9, peakGain: 0.11 }),
]);

/** Softening lowpass over the whole figure. Keeps it a chirp, not a bleep. */
export const CHIRP_FILTER_HZ = 2600;

/** Total length of the figure, in ms. */
export function chirpDurationMs(grains: readonly ChirpGrain[] = SHADOW_CHIRP): number {
  return grains.reduce((longest, g) => Math.max(longest, g.atMs + g.durationMs), 0);
}

/** The loudest grain. What the level budget is checked against. */
export function chirpPeakGain(grains: readonly ChirpGrain[] = SHADOW_CHIRP): number {
  return grains.reduce((loudest, g) => Math.max(loudest, g.peakGain), 0);
}

export interface ChirpSeparation {
  /** How many times longer the chirp is than the longest keystroke tick. */
  readonly durationRatio: number;
  /**
   * Semitones between the two sounds' geometric centre pitches. Signed: the
   * chirp currently sits below, so this is negative.
   */
  readonly semitonesFromKeystroke: number;
  /** Grains in the chirp, against one in a keystroke tick. */
  readonly grains: number;
  /** True when every keystroke variant holds a flat pitch and the chirp rises. */
  readonly risesWhereKeystrokeIsFlat: boolean;
}

/**
 * How far the chirp sits from the keystroke cue, read off both real tables.
 *
 * Derived, never stated: the keystroke half comes from `variantsFor("keystroke")`
 * rather than from numbers copied into this file, so retuning the keystroke tick
 * moves this measurement and the test that reads it.
 */
export function chirpSeparation(grains: readonly ChirpGrain[] = SHADOW_CHIRP): ChirpSeparation {
  const keystroke: readonly SfxVariant[] = variantsFor("keystroke");
  const longestTick = Math.max(...keystroke.map((v) => v.durationMs));
  const centre = (hz: readonly number[]): number =>
    Math.exp(hz.reduce((a, v) => a + Math.log(v), 0) / hz.length);
  const tickCentre = centre(keystroke.flatMap((v) => [v.startHz, v.endHz]));
  const chirpCentre = centre(grains.flatMap((g) => [g.startHz, g.endHz]));
  return {
    durationRatio: chirpDurationMs(grains) / longestTick,
    semitonesFromKeystroke: 12 * Math.log2(chirpCentre / tickCentre),
    grains: grains.length,
    risesWhereKeystrokeIsFlat:
      keystroke.every((v) => Math.abs(v.endHz - v.startHz) <= v.startHz * 0.01) &&
      grains.every((g) => g.endHz > g.startHz),
  };
}

/**
 * Schedule the chirp on a context.
 *
 * `output` is the VOICE bus, passed in by `buildAudioGraph`. Nothing here knows
 * that - it is the same discipline as every other voice in this package: the
 * recipe decides the sound, the graph decides where it goes.
 */
export function playChirp(
  ctx: AudioContextLike,
  output: AudioNodeLike,
  gainScale = 1,
  grains: readonly ChirpGrain[] = SHADOW_CHIRP,
): void {
  const now = ctx.currentTime;
  const scale = clamp(gainScale, 0, 1);
  if (scale <= 0) return;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(CHIRP_FILTER_HZ, now);
  filter.Q.setValueAtTime(0.7, now);
  filter.connect(output);

  for (const grain of grains) {
    const at = now + grain.atMs / 1000;
    const attack = Math.max(0.001, grain.attackMs / 1000);
    const end = at + grain.durationMs / 1000;

    const amp = label(ctx.createGain(), "voice.chirp");
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(grain.peakGain * scale, at + attack);
    // Exponential release for the same reason as every other voice here: a
    // linear tail on a sound this short is an edge, and an edge is a click.
    amp.gain.exponentialRampToValueAtTime(0.0001, Math.max(end, at + attack + 0.01));
    amp.connect(filter);

    const osc = ctx.createOscillator();
    osc.type = grain.wave;
    osc.frequency.setValueAtTime(grain.startHz, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, grain.endHz), end);
    osc.connect(amp);
    osc.start(at);
    osc.stop(end);
  }
}
