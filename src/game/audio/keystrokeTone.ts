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

import {
  clamp,
  seededRandom,
  semitoneRatio,
  type AudioContextLike,
  type AudioNodeLike,
} from "./context.js";
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

/**
 * UR-30 - WHERE EACH WORD'S LADDER STARTS.
 *
 * "The typing sounds don't feel satisfying." Rendered as a real belt - twenty
 * words of five keys, at typing cadence - the ladder produced exactly FIVE
 * distinct tones across a hundred presses, and word ten came out bit-identical
 * to word one: 220.0, 246.9, 277.2, 329.6, 370.0, every single word. Nothing
 * was wrong with the note; what was wrong was that it was the same five notes,
 * in the same order, fifty-eight times a belt.
 *
 * So each word starts on a different step of the SAME pentatonic, and the
 * ladder climbs from there. The rise a child hears within a word is unchanged -
 * that is AC-6c.2 and it is what the pitch is FOR - but the belt now walks a
 * melody instead of looping one bar.
 *
 * Eleven entries, all pentatonic degrees, so the sequence is coprime with every
 * common word length and no two consecutive words open on the same note.
 */
export const WORD_OPENING_SEMITONES: readonly number[] = [0, 7, 2, 9, 4, 2, 9, 0, 4, 7, 12];

/**
 * UR-30 - a few cents of drift on every single tone.
 *
 * Below the threshold at which a change reads as a different note, above the
 * point at which two hits are the same waveform. It rides `detune`, not
 * `frequency`, so `KeystrokeToneHit.frequencyHz` stays exactly the number
 * `frequencyFor` predicts and AC-6c.2's assertions are untouched.
 */
export const TONE_DETUNE_CENTS = 6;

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
  /** Which word we are on. Only `reset` moves it - a typo is mid-word. */
  private wordIndex = 0;

  constructor(
    private readonly ctx: AudioContextLike,
    readonly output: AudioNodeLike,
    private readonly rootHz: number = TONE_ROOT_HZ,
    private readonly rand: () => number = seededRandom(0x7d1c44),
  ) {}

  /** Semitones this word's ladder is lifted by. Zero for the first word. */
  get wordOpeningSemitones(): number {
    const n = WORD_OPENING_SEMITONES.length;
    return WORD_OPENING_SEMITONES[((this.wordIndex % n) + n) % n] ?? 0;
  }

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
      // The word's opening step lifts the WHOLE ladder, so the interval between
      // this key and the last one is exactly what it always was.
      frequencyHz:
        frequencyFor(this.state.consecutiveCorrect, this.rootHz) *
        semitoneRatio(this.wordOpeningSemitones),
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
    this.wordIndex += 1;
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
    osc.detune.setValueAtTime((this.rand() * 2 - 1) * TONE_DETUNE_CENTS, now);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(this.output);
    osc.start(now);
    osc.stop(end);
  }
}
