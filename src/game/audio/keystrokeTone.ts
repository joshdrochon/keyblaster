/**
 * The keystroke tone (D75, PRD FR-6c / AC-6c.2).
 *
 * D75: "a keystroke tone that steps up a musical scale on each successful
 * keystroke and resets on typo."
 * AC-6c.2: "pitch index is a PURE function of consecutive-correct count".
 *
 * That last clause is the reason this is a file and not four lines inside
 * sfx.ts. The pitch is a function - `pitchIndexFor(n)` - with no state, no
 * context and no clock, so the entire musical behaviour of typing a word is
 * unit-testable in Node. The stateful part is a two-line reducer over the same
 * function.
 *
 * WHY A PENTATONIC SCALE. A major or minor scale has half-steps in it, so a
 * run of eight correct keys walks through an interval that sounds like a
 * mistake to an eight-year-old who has never heard of an interval. Every
 * subset of a pentatonic scale is consonant: a child mashing a word out at
 * speed cannot produce a sour note. D31 says nothing in this game reads as
 * failure, and an accidental tritone is a failure sound.
 *
 * WHY IT CAPS. Unbounded stepping means a 40-character streak ends up at a
 * frequency that is both shrill and, on cheap laptop speakers, inaudible. The
 * ladder climbs three pentatonic octaves and then holds - the reward for a long
 * streak is that you STAY at the top, which is also a nicer musical result than
 * a siren.
 */

import { clamp, semitoneRatio, type AudioContextLike, type AudioNodeLike } from "./context.js";
import { label } from "./nullContext.js";

/** Major pentatonic, in semitones from the root. The fixed scale of D75. */
export const PENTATONIC_SEMITONES: readonly number[] = [0, 2, 4, 7, 9];

/** Root of the ladder. A3, comfortably under Shadow's voice and the music bed. */
export const TONE_ROOT_HZ = 220;

/** Three pentatonic octaves, then the ladder holds. */
export const MAX_PITCH_INDEX = PENTATONIC_SEMITONES.length * 3 - 1;

/**
 * AC-6c.2. THE pure function: consecutive-correct count in, scale step out.
 *
 * `0` correct is step 0, and so is `1` - the first key of a word sounds the
 * root, the second sounds one step up. Non-finite or negative input is not a
 * count, so it lands on the root rather than producing NaN.
 */
export function pitchIndexFor(consecutiveCorrect: number): number {
  if (!Number.isFinite(consecutiveCorrect) || consecutiveCorrect <= 0) return 0;
  return Math.min(Math.floor(consecutiveCorrect) - 1, MAX_PITCH_INDEX);
}

/** Semitone offset of a step, wrapping the scale up an octave each time. */
export function semitonesForIndex(index: number): number {
  const i = clamp(Math.floor(index), 0, MAX_PITCH_INDEX);
  const degree = i % PENTATONIC_SEMITONES.length;
  const octave = Math.floor(i / PENTATONIC_SEMITONES.length);
  return (PENTATONIC_SEMITONES[degree] ?? 0) + 12 * octave;
}

/** Frequency for a consecutive-correct count. Pure, and the whole ladder. */
export function frequencyFor(consecutiveCorrect: number, rootHz = TONE_ROOT_HZ): number {
  return rootHz * semitoneRatio(semitonesForIndex(pitchIndexFor(consecutiveCorrect)));
}

/**
 * What happened to a key. Named for the event, not for a verdict on the player
 * (D31), and matching `ComboEvent` in src/engine/scoring/combo.ts so the two
 * ladders - score and pitch - can never disagree about what a typo is.
 */
export type KeystrokeOutcome = "correct" | "typo" | "reset";

/** The count is the whole state. Everything else is derived from it. */
export interface KeystrokeToneState {
  readonly consecutiveCorrect: number;
}

export const initialToneState = (): KeystrokeToneState => ({ consecutiveCorrect: 0 });

/**
 * The reducer. D75's "resets on typo" is this one branch, and it is a hard
 * reset to zero rather than a decay: a half-reset would mean the ladder's
 * position no longer told the player anything they could hear.
 */
export function advanceToneState(
  state: KeystrokeToneState,
  outcome: KeystrokeOutcome,
): KeystrokeToneState {
  if (outcome === "correct") {
    const count = state.consecutiveCorrect;
    const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    return { consecutiveCorrect: safe + 1 };
  }
  return initialToneState();
}

/** Envelope of one tone. Short and soft: this fires on every single key. */
export const TONE_ENVELOPE = Object.freeze({
  attackMs: 4,
  durationMs: 120,
  peakGain: 0.085,
  filterHz: 3200,
});

export interface KeystrokeToneHit {
  readonly consecutiveCorrect: number;
  readonly pitchIndex: number;
  readonly frequencyHz: number;
}

/**
 * The stateful ladder, bound to a context. All it adds over the pure functions
 * is the count and a handful of nodes; every number it plays comes from
 * `frequencyFor`, so what you hear is exactly what the tests assert.
 */
export class KeystrokeTone {
  private state: KeystrokeToneState = initialToneState();
  private readonly hits: KeystrokeToneHit[] = [];

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
    private readonly rootHz: number = TONE_ROOT_HZ,
  ) {}

  get consecutiveCorrect(): number {
    return this.state.consecutiveCorrect;
  }

  get pitchIndex(): number {
    return pitchIndexFor(this.state.consecutiveCorrect);
  }

  history(): readonly KeystrokeToneHit[] {
    return this.hits;
  }

  /** A correct key: step up, sound the note, report what was played. */
  correct(): KeystrokeToneHit {
    this.state = advanceToneState(this.state, "correct");
    const hit: KeystrokeToneHit = {
      consecutiveCorrect: this.state.consecutiveCorrect,
      pitchIndex: pitchIndexFor(this.state.consecutiveCorrect),
      frequencyHz: frequencyFor(this.state.consecutiveCorrect, this.rootHz),
    };
    this.hits.push(hit);
    this.voice(hit.frequencyHz);
    return hit;
  }

  /**
   * A typo: the ladder resets. It plays NOTHING here - the gentle neutral tick
   * is sfx.ts's `typo` event, and stacking a second sound on top of a mistyped
   * key is how a game starts to feel like it is telling you off (D31).
   */
  typo(): void {
    this.state = advanceToneState(this.state, "typo");
  }

  /** Word finished, new word starting. Same reset, different reason. */
  reset(): void {
    this.state = advanceToneState(this.state, "reset");
  }

  private voice(frequencyHz: number): void {
    const now = this.ctx.currentTime;
    const attack = TONE_ENVELOPE.attackMs / 1000;
    const end = now + TONE_ENVELOPE.durationMs / 1000;

    const amp = label(this.ctx.createGain(), "sfx.keystrokeTone");
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(TONE_ENVELOPE.peakGain, now + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(TONE_ENVELOPE.filterHz, now);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequencyHz, now);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(this.output);
    osc.start(now);
    osc.stop(end);
  }
}
