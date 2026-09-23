/**
 * THE BLASTER'S CHARGE, ONE KEYSTROKE AT A TIME (UR-195).
 *
 * The lens used to do nothing at all while a word was typed and then flash
 * once, at full width, when the word died. Every keystroke now winds it up: a
 * bloom that overshoots, falls back to a resting level, and holds there until
 * the next key - so the pitch ladder D75 already climbs within a word has
 * something to look at, and the kill shot reads as a release rather than the
 * only event.
 *
 * THE LADDER IS THE SETTLE, AND THE BLOOM RIDES A FIXED HEIGHT ABOVE IT.
 * Built the other way round first - the ladder WAS the bloom and the settle was
 * subtracted from it - which made the overshoot the first thing to vanish: on a
 * long word consecutive blooms sat closer together than each bloom was to its
 * own settle, and the pop stopped reading. Measured from the RENDERED alpha,
 * the first keystroke of a five-letter word peaked at 0.37 of a full lens while
 * the code claimed 0.55.
 *
 * WHY THE START MOVES AND THE STEP DOES NOT. Measured on the shipped pools:
 * 675 words, 2 to 8 characters, median 4, and 58% of them 3 or 4 - so the
 * common case is three or four pulses, not a long ramp. Holding the step
 * constant and letting the starting point move is what keeps a keystroke worth
 * the same everywhere; a two-letter word simply begins nearly charged, which is
 * the truth about it.
 */

/** Charge gained per keystroke. */
const STEP = 0.11;
/** How far a bloom overshoots the level it settles to. */
export const CHARGE_OVERSHOOT = 0.3;
/**
 * The band the resting level may start in. The floor is not cosmetic: the
 * lamp's own standing glow sits at 0.24-0.44 alpha, so a bloom below about
 * 0.55 of a full lens is drawn UNDERNEATH the lamp and cannot be seen.
 */
const FIRST_MIN = 0.25;
const FIRST_MAX = 0.55;

export interface ChargeLevel {
  /** Peak of this keystroke's pulse, 0..1 of a full lens. */
  readonly bloom: number;
  /** Where it falls back to, and holds until the next key. */
  readonly settle: number;
}

/**
 * `index` is 1-based within the word; `length` is the whole word. The LAST
 * keystroke always blooms to exactly 1, whatever the word's length, so the
 * blast fires from a full lens.
 */
export function chargeLevelFor(index: number, length: number): ChargeLevel {
  const top = 1 - CHARGE_OVERSHOOT;
  // A one-letter word's only keystroke IS its last, so it fills the lens. The
  // general path divides by the number of GAPS between letters, and a word
  // with no gaps would otherwise land a key short of full.
  if (Math.floor(length) <= 1) return { bloom: 1, settle: top };
  const span = Math.max(1, Math.floor(length) - 1);
  const first = Math.min(FIRST_MAX, Math.max(FIRST_MIN, top - STEP * span));
  const step = (top - first) / span;
  const at = Math.max(0, Math.floor(index) - 1);
  const settle = Math.min(top, first + step * at);
  return { bloom: Math.min(1, settle + CHARGE_OVERSHOOT), settle };
}
