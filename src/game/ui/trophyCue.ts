import { clamp, type AudioContextLike, type AudioNodeLike, type OscillatorWave } from "@game/audio/context";
import { label } from "@game/audio/nullContext";

/**
 * THE TROPHY CUE (D74, D80, D88; AC-21.3's neighbour, deliberately not one of
 * its ten).
 *
 * ================== WHAT IT IS FOR ==================
 * A trophy is earned in the middle of a belt - a chain of 25, a chain of 50 -
 * and until now nothing said so. The child found out on the Beacon Log,
 * possibly days later, possibly never. This is the sound that goes with the
 * toast: "that thing you just did was a thing", once, and then out of the way.
 *
 * ================== WHY IT IS NOT AN `SFX_EVENTS` ID ==================
 * `src/game/audio/sfx.ts` owns the ten names AC-21.3 lists, the variant
 * rotation and the evidence ledger behind them. This is none of those things,
 * which is the same argument `audio/chirp.ts` and `audio/transmission.ts`
 * already make for themselves - and, practically, `SFX_EVENTS` is a frozen
 * tuple asserted by `tests/unit/audio/sfx.test.ts` and `pitch.test.ts`, so an
 * eleventh id is an edit to a lane this one does not own.
 *
 * If it is later promoted to a first-class event, the whole change is: add
 * `"trophy"` to `SFX_EVENTS` (`audio/sfx.ts`), add a `trophy: table("trophy",
 * [...])` key to `SFX_VARIANTS` with at least `MIN_VARIANTS_PER_EVENT` = 3
 * recipes, and update those two frozen-list assertions. The recipe below is
 * already in that shape.
 *
 * ================== THE LEVEL, AND WHY IT IS THIS ONE ==================
 * Measured against the table it has to live beside. Declared `peakGain`, and
 * the rendered peak through the SFX bus chain (master 0.85 x sfx 0.9 = 0.765):
 *
 *   typo        0.045 - 0.05    renders 0.030 - 0.035   the floor (D31)
 *   uiNav       -               renders 0.052 - 0.064
 *   beacon      0.27  - 0.29    ~0.21 - 0.22            the reward tone
 *   warp        0.36  - 0.47    -                       the loudest in the game
 *
 * A trophy is a reward, so it sits with `beacon` and not above it: `beacon` is
 * the emotional peak of the whole loop (a stop is CHARTED) and a trophy is a
 * smaller thing that happens more often. `peakGain` 0.24 puts it just under,
 * comfortably over the `typo` floor D31 requires everything to clear, and well
 * inside `sfx.test.ts`'s hard ceiling of 0.5.
 *
 * ================== WHY IT DOES NOT DUCK THE MUSIC ==================
 * AC-21.4's duck is a property of the BUS, not of the event: `graph.ts` ducks
 * `music` and `ambient` when something plays on `voice`. This plays on `sfx`,
 * which ducks nothing and is ducked by nothing, so the cue cannot stomp the
 * duck - it simply does not open one. That is right for a sound that fires
 * mid-belt while Shadow may be talking: a trophy must never interrupt him.
 *
 * ================== THE SHAPE ==================
 * A rising major third, struck twice - the interval a reward is spelled with
 * almost everywhere, and two grains rather than one so it reads as an EVENT
 * and not as a longer keystroke. Every grain has an attack and an exponential
 * release, because a linear tail on a sound this short is an edge and an edge
 * is a click (`chirp.ts`'s rule, and what `rendered.test.ts` measures).
 *
 * Pure spec: the table is inspectable in a plain Node test and `playTrophyCue`
 * is the only part that needs a context.
 */

/** One struck note of the cue. */
export interface TrophyGrain {
  /** Offset from the start of the cue, in ms. */
  readonly atMs: number;
  readonly wave: OscillatorWave;
  readonly startHz: number;
  readonly endHz: number;
  readonly durationMs: number;
  readonly attackMs: number;
  readonly peakGain: number;
}

/** The cue's lowpass, so the bright interval never turns into a hiss. */
export const TROPHY_FILTER_HZ = 5200;

/**
 * The recipe.
 *
 * G5 (784) into B5 (988) - a major third up - struck at 0 ms and again at
 * 130 ms a fifth higher, so the second grain lands while the first is still
 * ringing. 130 ms is deliberately longer than the 28-36 ms keystroke envelope
 * and shorter than `beacon`'s 900 ms bell: it may not read as a typing glitch
 * and it may not read as a stop being charted.
 */
export const TROPHY_CUE: readonly TrophyGrain[] = Object.freeze([
  { atMs: 0, wave: "sine", startHz: 784, endHz: 988, durationMs: 220, attackMs: 6, peakGain: 0.24 },
  { atMs: 130, wave: "triangle", startHz: 988, endHz: 1319, durationMs: 300, attackMs: 8, peakGain: 0.2 },
  { atMs: 130, wave: "sine", startHz: 1568, endHz: 1568, durationMs: 340, attackMs: 12, peakGain: 0.07 },
]);

/** How long the whole cue rings for, in ms. Used by the toast's own timing. */
export const TROPHY_CUE_MS = TROPHY_CUE.reduce(
  (a, g) => Math.max(a, g.atMs + g.durationMs),
  0,
);

/** The cue's declared peak, for the budget assertions. */
export const TROPHY_CUE_PEAK_GAIN = TROPHY_CUE.reduce((a, g) => Math.max(a, g.peakGain), 0);

export function playTrophyCue(
  ctx: AudioContextLike,
  output: AudioNodeLike,
  gainScale = 1,
  grains: readonly TrophyGrain[] = TROPHY_CUE,
): void {
  const scale = clamp(gainScale, 0, 1);
  if (scale <= 0) return;
  const now = ctx.currentTime;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(TROPHY_FILTER_HZ, now);
  filter.Q.setValueAtTime(0.7, now);
  filter.connect(output);

  for (const grain of grains) {
    const at = now + grain.atMs / 1000;
    const attack = Math.max(0.001, grain.attackMs / 1000);
    const end = at + grain.durationMs / 1000;

    const amp = label(ctx.createGain(), "sfx.trophy");
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(grain.peakGain * scale, at + attack);
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
