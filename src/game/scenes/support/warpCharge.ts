/**
 * What the warp drive SOUNDS LIKE while it charges (AC-21.3; D62).
 *
 * The player's words: "the warp drive progress bar should actually make noise
 * when its charging up". The screen used to spool the drive once, on the first
 * accepted character, and then type in silence for the rest of the sentence -
 * so the one bar in the game that is a continuous quantity had no continuous
 * sound.
 *
 * WHERE THIS BELONGS AND WHY IT IS HERE. Next to `warpSentence.ts`, for the
 * same reason that file gives: it is a pure rule over plain numbers, it must be
 * testable without booting Phaser, and a scene is not where game rules live.
 * `WarpScene` calls it and does nothing but hand the result to the audio
 * service.
 *
 * TWO LAYERS, ANSWERING TWO DIFFERENT QUESTIONS:
 *
 *   THE STEP, on every accepted character. A keystroke tick transposed by the
 *   fill. This is the one that tells the player how close they are - the pitch
 *   of the last key they pressed IS the meter, so it works with the bar off
 *   screen and it works for a child who is watching their hands rather than the
 *   screen.
 *
 *   THE SPOOL, once per third. The drive re-spools a fifth higher each time the
 *   fill crosses a third: three landings on the way up, which is what makes it
 *   read as spooling rather than as ticking. Spooling on every keystroke was
 *   the first attempt and it sounded like a machine fault.
 *
 * NOTHING SOUNDS AT A FULL BAR. `WarpScene.beginWarp` fires the warp stinger
 * there - the loudest, longest sound in the game (D62) - and a spool landing on
 * the same frame would eat its attack. The stinger arrives into a gap it owns.
 *
 * D31: none of this is a failure sound. A typo does not move the fill (AC-16.2)
 * and therefore does not change the pitch, so the child hears "still here",
 * never "wrong".
 */

/** How many times the drive spools on the way up. One per third of the bar. */
export const CHARGE_SPOOL_STAGES = 3;

/** Semitones between one spool landing and the next. A perfect fifth. */
export const CHARGE_SPOOL_INTERVAL = 7;

/**
 * The step tick's transposition at a full bar, in semitones. An octave: wide
 * enough that the middle of the sentence is audibly not the start, narrow
 * enough that the top of it is still the same sound rather than a squeak.
 */
export const CHARGE_STEP_SEMITONE_RANGE = 12;

/** How loud a step tick is relative to a normal keystroke. Slightly under. */
export const CHARGE_STEP_GAIN = 0.85;

/** One sound, as the audio service's play options want it. */
export interface ChargeSound {
  readonly pitchSemitones: number;
  readonly gainScale: number;
}

export interface ChargeSoundPlan {
  /**
   * The highest third that has now been SOUNDED, 1..3. The caller keeps it and
   * passes it back on the next keystroke; 0 means nothing has sounded yet.
   * It never decreases, which is what stops a typo re-spooling.
   */
  readonly stage: number;
  /** The drive re-spooling, or null when this keystroke does not cross a third. */
  readonly spool: ChargeSound | null;
  /** The per-character tick. Always present: every accepted key answers back. */
  readonly step: ChargeSound;
}

/** Clamp that treats nonsense as the bottom of the range, never as NaN. */
function fraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Decide what one accepted character sounds like.
 *
 * Pure: same `(stage, fill)` in, same plan out, no clock, no randomness, no
 * Phaser. The variant rotation AC-21.3 requires lives in `SfxBus`, which is
 * where the randomness belongs; this function only says WHICH sound and at what
 * pitch.
 */
export function chargeSoundPlan(stage: number, fill: number): ChargeSoundPlan {
  const f = fraction(fill);
  const heard = Number.isFinite(stage) ? Math.max(0, Math.floor(stage)) : 0;
  const step: ChargeSound = {
    pitchSemitones: f * CHARGE_STEP_SEMITONE_RANGE,
    gainScale: CHARGE_STEP_GAIN,
  };

  // Nothing has sounded yet: the drive spools from the bottom whatever the
  // fill is. A one-character sentence lands here and still gets its sound.
  if (heard === 0) {
    return { stage: 1, spool: { pitchSemitones: 0, gainScale: spoolGain(1) }, step };
  }

  // Which third the fill is in, 1..3. A fast typist can cross two thirds
  // between keystrokes, and that is ONE landing at the higher stage rather than
  // two stacked on the same tick.
  const reached = Math.min(CHARGE_SPOOL_STAGES, Math.floor(f * CHARGE_SPOOL_STAGES) + 1);
  if (reached <= heard || f >= 1) return { stage: heard, spool: null, step };

  return {
    stage: reached,
    spool: {
      pitchSemitones: (reached - 1) * CHARGE_SPOOL_INTERVAL,
      gainScale: spoolGain(reached),
    },
    step,
  };
}

/**
 * The drive gets louder as it climbs - 0.8, 0.9, 1.0 - because a spool that
 * rises in pitch but not in level reads as a sample being repitched rather than
 * as something gathering power. Capped at unity: the bus mix is set in
 * `graph.ts` and a scene does not get to exceed it.
 */
function spoolGain(stage: number): number {
  return Math.min(1, 0.7 + 0.1 * stage);
}
