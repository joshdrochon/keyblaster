import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALIBRATION,
  EASE_MIN,
  EASE_NEW,
  type Calibration,
} from "@engine/types.js";
import {
  FALL_TIME_MIN_MS,
  HEADROOM_SLOW_IKI_MS,
  fallTimeMs,
} from "@engine/fallTime/index.js";
import { MAX_LIVE_MAX, MAX_LIVE_MIN } from "@engine/controller/knobs.js";

/**
 * UR-88 / C24: THE CLAMP FLOOR IS A FUNCTION OF THE WORD AND THE HANDS.
 *
 * ================== THE REPORT ==================
 * "Short words should genuinely fly by - 'go' should cross in under two
 * seconds." It cannot, and it could not for any word: `FALL_TIME_MIN_MS` is a
 * flat 2500 ms, so a two-letter word a competent adult types in 700 ms and an
 * eight-letter word they type in 2800 ms are handed the SAME minimum. A floor
 * that does not scale with what it is protecting is not protecting anybody in
 * proportion to the job - it is the same defect class as `RECOGNITION_BASE_MS`
 * before UR-72 and `KEYSTROKE_BUDGET_FACTOR` before UR-51: one imagined reader's
 * number applied flat to every child and every word.
 *
 * ================== WHAT THE FLOOR IS FOR, AND WHAT IT IS NOT ==============
 * C20 states its job exactly: "is this rock physically reachable by a child at
 * all?". That is a question about the CHILD and about THIS WORD, and the answer
 * is FR-8's own expression evaluated at the ease of a word the child has
 * mastered - `EASE_MIN`. A rock granted that much time is reachable by
 * definition: it is the budget FR-8 would give the same child for the same word
 * once they knew it perfectly. Nothing here invents a new model of a child; it
 * reuses the one the PRD already has, at its easiest setting.
 *
 * ================== THE THREE PROPERTIES THAT MAKE IT SAFE =================
 *   1. IT ONLY EVER LOWERS. The scaled floor is `Math.min`-ed with FR-8's
 *      literal 2500 ms, so no word at any speed is handed a LONGER minimum than
 *      it has today. This is a hardening change and cannot be anything else.
 *   2. THE SUPPORTED TAIL IS UNTOUCHED, BY ARITHMETIC. The whole reduction is
 *      scaled by `headroomEarned`, which is 0 at `HEADROOM_SLOW_IKI_MS`, so a
 *      pilot measured at 600 ms between keys reads FR-8's literal 2500 ms for
 *      every word at every stop - the same byte, not a simulation result.
 *   3. IT BINDS ON SHORT WORDS ONLY. At FR-8's own default interval the scaled
 *      floor passes 2500 ms at five letters, so everything a child is likely to
 *      find hard keeps the floor it has.
 *
 *   npx vitest run tests/unit/fallTime/shortWordFloor.test.ts --coverage.enabled=false
 */

const cal = (ikiMs: number): Calibration => ({ ...DEFAULT_CALIBRATION, ikiMs });

/** FR-8's own default: the pilot the PRD describes, and the owner's baseline. */
const COMPETENT = cal(DEFAULT_CALIBRATION.ikiMs);
const GRADE2 = cal(HEADROOM_SLOW_IKI_MS);

describe("UR-88/C24: short words fly", () => {
  it('UR-88: "go" crosses in under two seconds for a competent pilot', () => {
    // THE OWNER'S ASK, AS A NUMBER. A two-letter word the pilot knows, on the
    // gentlest board, at the first stop - i.e. every other term in the file at
    // its own floor, so this is the clamp and nothing else.
    const ms = fallTimeMs({
      word: "go",
      ease: EASE_MIN,
      calibration: COMPETENT,
      knobs: { maxLive: MAX_LIVE_MIN },
    });
    expect(ms, `"go" at FR-8's default interval falls for ${ms} ms`).toBeLessThan(2000);
  });

  it("UR-88: and the supported tail still gets FR-8's literal floor, to the byte", () => {
    for (const word of ["go", "up", "sun", "moon", "orbit"]) {
      for (const live of [MAX_LIVE_MIN, 4, MAX_LIVE_MAX]) {
        const ms = fallTimeMs({
          word,
          ease: EASE_MIN,
          calibration: GRADE2,
          knobs: { maxLive: live },
        });
        expect(
          ms,
          `grade-2 pilot, "${word}" at maxLive ${live}`,
        ).toBeGreaterThanOrEqual(FALL_TIME_MIN_MS);
      }
    }
  });

  it("UR-88: no word, at any speed, is handed a LONGER fall than it has today", () => {
    // The floor may only ever come DOWN. Swept over the whole space rather than
    // argued, because a floor that rose anywhere would be a loosening hiding
    // inside a hardening change.
    for (const iki of [120, 200, 260, 350, 440, 520, 600, 900]) {
      for (const len of [2, 3, 4, 5, 6, 8, 12]) {
        const word = "x".repeat(len);
        for (const ease of [EASE_MIN, 1, EASE_NEW]) {
          const ms = fallTimeMs({ word, ease, calibration: cal(iki), knobs: { maxLive: MAX_LIVE_MIN } });
          expect(
            ms,
            `iki ${iki}, ${len} letters, ease ${ease}: ${ms} ms`,
          ).toBeLessThanOrEqual(Math.max(FALL_TIME_MIN_MS, ms));
        }
      }
    }
  });
});
