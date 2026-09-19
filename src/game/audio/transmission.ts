/**
 * SHADOW'S TRANSMISSION TICK (UR-91, D31, D62, D88).
 *
 * THE BRIEF. The briefing types itself out (UR-59) and did it in silence. The
 * owner asked for a typing sound that is "almost a soothing robotic sound" -
 * Shadow's voice as a machine - and was explicit that it must NOT be the
 * player's keystroke sound. That second half is the hard half, because the
 * obvious implementation is to reach for `sfx.play("keystroke")` and the result
 * would teach a child that Shadow is pressing keys at them.
 *
 * ================== WHY IT IS NOT AN SFX EVENT ==================
 * `SFX_EVENTS` is the ten AC-21.3 names, on the SFX bus, with the variant
 * rotation and the evidence ledger behind it. This is none of those things: it
 * is Shadow making a noise while he talks, so it belongs where his chirp and
 * his rendered lines already live - the VOICE bus - for the same three reasons
 * `chirp.ts` gives. The AC-21.4 duck, the voice fader and the settings volume
 * all reach it there, and none of them reach the SFX bus.
 *
 * THE DUCK IS ONCE PER PAGE, NOT ONCE PER TICK. A reveal is one utterance, not
 * forty-six of them, and `SidechainDucker` counts depth: forty-six overlapping
 * ducks would take 46 * 420 ms of release to unwind. `installAudio` opens the
 * duck when the transmission begins and closes it when the page completes or
 * the player skips it. AC-21.4 is satisfied for the whole reveal, which is what
 * "the music drops while Shadow speaks" actually means.
 *
 * ================== HOW IT DIFFERS FROM A KEY PRESS, MEASURABLY ==============
 * `transmissionSeparation()` reads BOTH tables and reports five axes. It is
 * derived rather than stated, exactly like `chirpSeparation`, so retuning the
 * keystroke cue moves this measurement and the test that reads it.
 *
 *   axis          keystroke (UR-34)                 this
 *   --------------------------------------------------------------------------
 *   attack        median peak < 0.7 ms - an EDGE    6 ms linear ramp - a SWELL
 *   spectrum      >10% of the first 6 ms above      a pure sine pair: no
 *                 2 kHz, every press                partials at all
 *   layers        click + sub + pentatonic tone     fundamental + sub-octave
 *   register      flat, 760-990 Hz                  293-523 Hz, ~14 semitones
 *                                                   below the tick's centre
 *   bus           sfx (ducks nothing)               voice (ducks the world)
 *
 * The click is the point of the keystroke and the absence of one is the point
 * of this. A transient says "you touched something". Shadow did not touch
 * anything; he is transmitting.
 *
 * ================== WHY IT IS RATE-LIMITED AND NOT PER CHARACTER =============
 * The reveal runs at `REVEAL_CPS` = 160 characters a second. One tick per
 * character is 160 events a second, which is not a rhythm - it is a 160 Hz
 * buzz, because the ear fuses discrete events into pitch somewhere around
 * 30 Hz. So the tick is rate-limited to one per `TICK_MIN_GAP_MS`.
 *
 * 40 ms is deliberately near the top of the range where the ear still hears
 * SEPARATE events. Faster fuses; much slower stops reading as a machine working
 * and starts reading as a countdown. One tick lands roughly every four
 * characters at the nominal cadence.
 *
 * THE REALISED RATE IS A LITTLE UNDER THE NOMINAL 25 A SECOND, and that is
 * worth knowing rather than discovering. The scene asks on `update`, so the gap
 * quantises UP to a whole number of frames: at 60 fps the next tick lands on
 * the third frame after the last one, 50 ms, which is 20 a second and 36 over a
 * full page. On a starved machine it degrades to fewer ticks and never to more,
 * so the loudness bound below holds a fortiori. Measured in the built preview
 * under software WebGL - the worst case this project can produce - a full
 * Neptune page fired 15.
 *
 * THE COUNT IS BOUNDED BY CONSTRUCTION, which is what keeps a long briefing
 * inside the loudness budget without anybody having to trust the copy.
 * `REVEAL_CEILING_MS` is 1800, so a page can fire at most
 * `transmissionTicksFor(1800)` = 46 ticks whatever it says - 200 characters and
 * 2000 characters produce the same 46, because past the ceiling the reveal
 * tightens rather than running long. A budget that depends on the length of a
 * sentence somebody has not written yet is not a budget.
 *
 * RENDERED, THE WHOLE PAGE IS QUIETER THAN THE BELT. 46 ticks over 1.8 s
 * measure rms 0.010479 and peak 0.06146 through the voice chain, against the
 * typing belt's rms 0.025478 (0.026222 over forty words) and peak 0.42269
 * through the SFX chain. That is 7.7 dB down on the thing the ticket named as
 * the ceiling, and 16.8 dB down on its peak.
 * `transmissionRendered.test.ts` asserts the COMPARISON rather than either
 * number, so a later remix of the belt moves the bar with it.
 *
 * ================== THE PITCH CYCLE ==================
 * Five notes of a D minor pentatonic, walked in order and wrapped. It is a
 * cycle rather than one repeated note because forty-six identical blips is the
 * repetition fatigue this package has been bitten by twice (UR-30, UR-43), and
 * it is only five notes because a machine SHOULD have a motif - it is the same
 * argument `SHADOW_CHIRP` makes for using real intervals.
 *
 * PURE SPEC, like every other recipe here: the table is inspectable in a plain
 * Node test and `playTransmissionTick` is the only part that needs a context.
 */

import { clamp, type AudioContextLike, type AudioNodeLike, type OscillatorWave } from "./context.js";
import { label } from "./nullContext.js";
import { sfxLookaheadSeconds, variantsFor, type SfxVariant } from "./sfx.js";

/**
 * The recipe for one tick.
 *
 * TWO SINES AND NOTHING ELSE. No noise, no filter, no transient. A sine has no
 * harmonics, so "there is nothing above 2 kHz in this sound" is not a mixing
 * choice that could drift - it is arithmetic, and the rendered test asserts it.
 * The sub-octave under the fundamental is what stops it being a bleep: it gives
 * the tick a body at half the pitch, the way a spoken syllable has one, at a
 * level low enough that it is felt rather than heard as a second note.
 */
export interface TransmissionTick {
  readonly wave: OscillatorWave;
  /** Total length of one tick, in ms. */
  readonly durationMs: number;
  /**
   * Linear ramp to the peak, in ms.
   *
   * THE SINGLE MOST IMPORTANT NUMBER IN THIS FILE. A keystroke reaches its peak
   * in under 0.7 ms because touch is an edge (UR-34). Shadow is not touching
   * anything, so this is an order of magnitude slower - the difference between
   * a click and a blip, and the whole of "soothing" rather than "clacky".
   */
  readonly attackMs: number;
  /** Peak linear gain of the fundamental, before any scaling. */
  readonly peakGain: number;
  /** The sub-octave's gain, as a fraction of `peakGain`. */
  readonly subGain: number;
}

export const TRANSMISSION_TICK: TransmissionTick = Object.freeze({
  wave: "sine" as const,
  durationMs: 26,
  attackMs: 6,
  // CHOSEN FROM THE RENDER, not from taste. Every other event in the game,
  // rendered through its own bus chain, peaks at:
  //
  //   typo       0.030 - 0.035   the quietest thing in the game (D31)
  //   uiNav      0.052 - 0.064
  //   hit        0.055 - 0.067
  //   keystroke  0.124 - 0.218   the sound this must NOT be
  //
  // 0.055 renders at 0.061 through the voice bus: roughly twice the typo, so
  // D31's "a mistyped key is the quietest sound the game makes" is untouched;
  // level with `uiNav`, which is what graph.ts already calls "the game's
  // smallest, calmest tone"; and 6 dB under the QUIETEST key press, so the
  // briefing can never be mistaken for somebody typing.
  peakGain: 0.055,
  subGain: 0.45,
});

/**
 * The pitch cycle, in Hz. D4 A4 F4 C5 G4 - a D minor pentatonic, ordered so it
 * wanders rather than climbs. A rising figure is a notification; a wandering
 * one is a machine thinking.
 *
 * DELIBERATELY BELOW THE KEYSTROKE TICK, which is flat at 760-990 Hz, for the
 * same reason `SHADOW_CHIRP` sits below it: up is where an alert lives, and the
 * register is half of why one sound is Shadow and the other is the keyboard.
 */
export const TRANSMISSION_PITCHES: readonly number[] = Object.freeze([
  293.66, 440.0, 349.23, 523.25, 392.0,
]);

/**
 * The floor on the gap between two ticks, in ms. See the header: 25 a second is
 * the fastest chatter the ear still resolves as separate events.
 */
export const TICK_MIN_GAP_MS = 40;

/** How many ticks a reveal lasting `durationMs` can fire. The loudness bound. */
export function transmissionTicksFor(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.floor(durationMs / TICK_MIN_GAP_MS) + 1;
}

/** The pitch of tick `index`, wrapping the cycle. */
export function transmissionPitch(index: number): number {
  const cycle = TRANSMISSION_PITCHES;
  const at = ((index % cycle.length) + cycle.length) % cycle.length;
  return cycle[at] as number;
}

/**
 * THE RATE LIMIT, as state a unit test can drive with numbers.
 *
 * The scene hands in the reveal's elapsed time every frame - the same clock
 * `charsRevealedAt` reads - and gets back the index of the tick to play, or
 * null. No clock of its own, no Phaser, no context: the decision to make a
 * sound is arithmetic and is tested as arithmetic.
 */
export class TransmissionTicker {
  private lastAtMs = Number.NEGATIVE_INFINITY;
  private count = 0;

  /** Ticks fired so far. */
  get ticks(): number {
    return this.count;
  }

  /**
   * `elapsedMs` since the reveal started. Returns the tick index to play, or
   * null when it is not due yet.
   *
   * The FIRST call always fires, whatever the elapsed time: the sound has to
   * start when the transmission starts, not `TICK_MIN_GAP_MS` into it.
   */
  due(elapsedMs: number): number | null {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
    if (elapsedMs - this.lastAtMs < TICK_MIN_GAP_MS) return null;
    this.lastAtMs = elapsedMs;
    const index = this.count;
    this.count += 1;
    return index;
  }

  reset(): void {
    this.lastAtMs = Number.NEGATIVE_INFINITY;
    this.count = 0;
  }
}

export interface TransmissionSeparation {
  /** Semitones between the two sounds' geometric centre pitches. Negative. */
  readonly semitonesFromKeystroke: number;
  /** This tick's attack against the SHORTEST declared keystroke attack. */
  readonly attackRatio: number;
  /** True when every keystroke variant carries a click layer and this does not. */
  readonly noTransientWhereKeystrokeHasOne: boolean;
  /** True when every keystroke variant mixes in noise and this does not. */
  readonly noNoiseWhereKeystrokeHasIt: boolean;
}

/**
 * THERE IS DELIBERATELY NO `quieterThanAKeyPress` HERE, AND I TRIED TO PUT ONE
 * IN.
 *
 * It read `TRANSMISSION_TICK.peakGain` against
 * `min(variantsFor("keystroke").peakGain)` and reported FALSE on a build where
 * the tick renders 6 dB down - because a key press declares 0.055 and then adds
 * a click layer at 0.30-0.36 and a sub at 0.08-0.10 on top of it, reaching
 * 0.124-0.218 rendered, while this declares 0.055 and reaches 0.061. Comparing
 * the two declared numbers compares one layer against three.
 *
 * That is UR-44's finding restated: "a declared number cannot police a sum of
 * layers". The loudness ordering is asserted in `transmissionRendered.test.ts`,
 * on the samples, where it is a fact about the sound rather than about the
 * table.
 */

/**
 * How far this sits from the keystroke cue, read off BOTH real tables.
 *
 * Derived, never stated - `variantsFor("keystroke")` rather than numbers copied
 * into this file - so a lane that retunes the keyboard moves this measurement
 * and fails the test that reads it, which is the only way "audibly different"
 * survives contact with a later change.
 */
export function transmissionSeparation(
  tick: TransmissionTick = TRANSMISSION_TICK,
  pitches: readonly number[] = TRANSMISSION_PITCHES,
): TransmissionSeparation {
  const keystroke: readonly SfxVariant[] = variantsFor("keystroke");
  const centre = (hz: readonly number[]): number =>
    Math.exp(hz.reduce((a, v) => a + Math.log(v), 0) / hz.length);
  const tickCentre = centre(keystroke.flatMap((v) => [v.startHz, v.endHz]));
  const mine = centre(pitches);
  // The FASTEST keystroke attack, so the ratio is the most conservative
  // statement of the difference rather than the most flattering one.
  const fastest = Math.min(...keystroke.map((v) => v.attackMs));
  return {
    semitonesFromKeystroke: 12 * Math.log2(mine / tickCentre),
    attackRatio: tick.attackMs / fastest,
    noTransientWhereKeystrokeHasOne: keystroke.every((v) => v.click !== undefined),
    noNoiseWhereKeystrokeHasIt: keystroke.every((v) => v.noise > 0),
  };
}

/**
 * Schedule one tick on a context.
 *
 * `output` is the VOICE bus, passed in by `buildAudioGraph` - the same
 * discipline as every other voice in this package: the recipe decides the
 * sound, the graph decides where it goes.
 *
 * THE LOOKAHEAD IS UR-55's, borrowed on purpose. `ctx.currentTime` names audio
 * the renderer has already produced, so an envelope scheduled AT it is skipped
 * rather than shortened, and a skipped attack on a 6 ms ramp is a step - which
 * is a click, which is the one thing this sound may not have.
 */
export function playTransmissionTick(
  ctx: AudioContextLike,
  output: AudioNodeLike,
  index = 0,
  gainScale = 1,
  tick: TransmissionTick = TRANSMISSION_TICK,
): void {
  const scale = clamp(gainScale, 0, 1);
  if (scale <= 0) return;

  const at = ctx.currentTime + sfxLookaheadSeconds(ctx);
  const attack = Math.max(0.001, tick.attackMs / 1000);
  const end = at + tick.durationMs / 1000;
  const hz = transmissionPitch(index);

  const voice = (frequency: number, peak: number, name: string): void => {
    const amp = label(ctx.createGain(), name);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(peak * scale, at + attack);
    // Exponential release, for the same reason as every other voice in this
    // package: a linear tail on a sound this short is an edge, and an edge is
    // a click. `chirp.ts` makes the identical argument.
    amp.gain.exponentialRampToValueAtTime(0.0001, Math.max(end, at + attack + 0.01));
    amp.connect(output);

    const osc = ctx.createOscillator();
    osc.type = tick.wave;
    osc.frequency.setValueAtTime(frequency, at);
    osc.connect(amp);
    osc.start(at);
    osc.stop(end);
  };

  voice(hz, tick.peakGain, "voice.transmission");
  // The body. An octave down, well under the fundamental - felt, not heard as
  // a second note.
  voice(hz / 2, tick.peakGain * tick.subGain, "voice.transmission.sub");
}
