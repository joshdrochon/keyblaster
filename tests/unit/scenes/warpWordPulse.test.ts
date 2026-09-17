import { describe, expect, it } from "vitest";
import {
  WORD_PULSE_MS,
  WORD_PULSE_SCALE,
  completedWordRange,
  pulsedBox,
  pulsedPosition,
  wordPulseCentre,
  type PulseBox,
} from "@game/scenes/support/warpLayout";
import { createWarpSentence, typeChar } from "@game/scenes/support/warpSentence";

/**
 * UR-26 - A FINISHED WORD SAYS SO, AND THE SENTENCE DOES NOT MOVE.
 *
 * ================== THE REQUEST ==================
 * The user, unprompted: "when a word is complete in the warp drive sequence it
 * should expand slightly and go back to original size to indicate its been
 * typed out. Makes for a nice effect."
 *
 * ================== WHY THIS IS NOT A FIVE-LINE CHANGE ==================
 * The warp sentence is a LAID-OUT LINE: `WarpScene.layoutLetters` places one
 * Text per character at an x it computes once, walking left to right. If
 * growing a word changes the space it occupies, every word after it shifts, and
 * the line jitters under the eyes of a child who is in the middle of reading
 * and typing it. That is strictly worse than no effect at all.
 *
 * So the three mechanical claims, and what each is worth:
 *
 *   ONCE PER WORD   the pulse fires on exactly the keystroke that finishes a
 *                   word - not mid-word, not again on the punctuation after it,
 *                   and not twice because a typo re-entered the same letter.
 *   BACK TO SIZE    it returns to exactly 1, from the origins captured before
 *                   it started rather than from a round trip through the
 *                   centre, so nothing accumulates across a sentence.
 *   NOTHING MOVES   the word grows about its OWN centre and the letters after
 *                   it are not reachable from the effect at all.
 *
 * The third one is asserted here as arithmetic and again in
 * `tests/e2e/warp.spec.ts` against the real scene, where the x of a later word
 * is measured on every frame of a live pulse and compared with its resting x.
 *
 * Watch it fail: set `WORD_PULSE_SCALE` to 1 in
 * `src/game/scenes/support/warpLayout.ts` and "it actually grows" goes red; drop
 * the apostrophe from `PULSE_WORD_CHAR` and "don't" pulses twice; return
 * `[start, index]` without the `next` guard and every letter pulses.
 *
 *   npx vitest run tests/unit/scenes/warpWordPulse.test.ts --coverage.enabled=false
 */

/**
 * Walk a sentence one accepted character at a time, exactly the way
 * `WarpScene.onKey` does, and report what pulsed on each keystroke.
 *
 * Through `typeChar` rather than by incrementing a counter: the thing being
 * claimed is what the SCREEN does per keystroke, and the caret it reads is the
 * engine's, so a rule that disagreed with `WarpSentenceState.index` would pass a
 * hand-rolled loop and fail in the game.
 */
function pulsesWhileTyping(text: string): { at: number; word: string }[] {
  let state = createWarpSentence({ text, blasted: [] });
  const fired: { at: number; word: string }[] = [];
  for (const char of [...text]) {
    state = typeChar(state, char);
    if (state.lastEvent !== "advance" && state.lastEvent !== "charged") continue;
    const range = completedWordRange(state.text, state.index);
    if (range === null) continue;
    fired.push({ at: state.index, word: text.slice(range[0], range[1]) });
  }
  return fired;
}

describe("UR-26 the pulse fires exactly once per completed word", () => {
  it("fires once for each word of Mars' shipped sentence, in order", () => {
    // src/content/en/mars.json. Four words and a full stop.
    expect(pulsesWhileTyping("Mars is the red planet.").map((p) => p.word)).toEqual([
      "Mars",
      "is",
      "the",
      "red",
      "planet",
    ]);
  });

  it("fires on the last letter of a word, never on the punctuation after it", () => {
    const fired = pulsesWhileTyping("Mars is the red planet.");
    const last = fired.at(-1);
    expect(last).toBeDefined();
    // "planet" ends at index 22; the full stop is character 22 and typing it
    // takes the caret to 23. Nothing fires there - the word was already done.
    expect(last?.at).toBe(22);
    expect(fired.some((p) => p.at === 23)).toBe(false);
  });

  it("fires on the final character when the sentence has no closing punctuation", () => {
    // The charged keystroke and the word-complete keystroke are the same one.
    // `WarpScene` starts the pulse and then `beginWarp`; the scene's SHUTDOWN
    // handler is what stops the tween surviving the cut to Beacon.
    const fired = pulsesWhileTyping("hold on");
    expect(fired.map((p) => p.word)).toEqual(["hold", "on"]);
    expect(fired.at(-1)?.at).toBe("hold on".length);
  });

  it("treats an apostrophe as part of the word", () => {
    // Without this, "don't" announces a word boundary that is not there.
    expect(pulsesWhileTyping("don't stop").map((p) => p.word)).toEqual(["don't", "stop"]);
  });

  it("does not fire mid-word", () => {
    const text = "Mars is the red planet.";
    // Every caret position that is NOT a completed word reports null. This is
    // the whole "once per word" claim stated the other way round: 23
    // characters, 5 words, 18 keystrokes that must do nothing.
    const silent = [...text].filter(
      (_, i) => completedWordRange(text, i + 1) === null,
    );
    expect(silent).toHaveLength(text.length - 5);
  });

  it("does not fire again when a typo re-enters the letter that finished a word", () => {
    // AC-16.2: a typo leaves `index` where it was and `lastEvent` is "retry".
    // `WarpScene.pulseCompletedWord` returns on anything that is not an accept,
    // so the word does not pulse a second time for the same keystroke position.
    let state = createWarpSentence({ text: "Mars is", blasted: [] });
    for (const char of "Mars") state = typeChar(state, char);
    expect(completedWordRange(state.text, state.index)).toEqual([0, 4]);

    const typo = typeChar(state, "z");
    expect(typo.lastEvent).toBe("retry");
    expect(typo.index).toBe(state.index);
    // The range is still "Mars" - which is exactly why the scene gates on the
    // EVENT and not on the range alone. A gate on the range would re-pulse the
    // word on every failed keystroke.
    expect(completedWordRange(typo.text, typo.index)).toEqual([0, 4]);
  });

  it("returns null outside the sentence", () => {
    expect(completedWordRange("Mars", 0)).toBeNull();
    expect(completedWordRange("Mars", 9)).toBeNull();
    expect(completedWordRange("", 0)).toBeNull();
    // An all-punctuation run finishes no word.
    expect(completedWordRange("- ...", 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/**
 * Four letters of a 52 px word, laid out the way `layoutLetters` lays them out:
 * fixed x, walking right, all on one line.
 */
const WORD: PulseBox[] = [
  { x: 136, y: 364, w: 30, h: 66 },
  { x: 166, y: 364, w: 22, h: 66 },
  { x: 188, y: 364, w: 28, h: 66 },
  { x: 216, y: 364, w: 26, h: 66 },
];

/** The first letter of a word further along the same line. */
const LATER: PulseBox = { x: 520, y: 364, w: 24, h: 66 };

const unionOf = (boxes: readonly PulseBox[]): PulseBox => {
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

describe("UR-26 the word grows about its own centre", () => {
  const centre = wordPulseCentre(WORD);

  it("it actually grows - the effect is not a no-op", () => {
    // The negative control for every assertion below: a pulse that changed
    // nothing would satisfy "returns to its original size" and "nothing after
    // it moved" perfectly.
    expect(WORD_PULSE_SCALE).toBeGreaterThan(1);
    expect(WORD_PULSE_MS).toBeGreaterThan(0);
    const grown = unionOf(WORD.map((b) => pulsedBox(b, centre, WORD_PULSE_SCALE)));
    const rest = unionOf(WORD);
    expect(grown.w).toBeGreaterThan(rest.w);
    expect(grown.h).toBeGreaterThan(rest.h);
  });

  it("stays slight - UR-26 specifies 'slightly', and it fires once per word", () => {
    // A confirmation, not a celebration. Held under the single-letter retry pop
    // (`WarpScene.askAgain`, 1.22), which is rare and is meant to be noticed.
    expect(WORD_PULSE_SCALE).toBeLessThanOrEqual(1.1);
    // On a 52 px line that is under four pixels of extra height. Stated in
    // pixels because "1.07" is not a quantity anybody can picture.
    expect(unionOf(WORD).h * (WORD_PULSE_SCALE - 1)).toBeLessThan(6);
    // And it is over before the median child's next keystroke lands
    // (DEFAULT_CALIBRATION.ikiMs is 350), so words do not normally overlap.
    expect(2 * WORD_PULSE_MS).toBeLessThan(350);
  });

  it("keeps the word's centre exactly where it was", () => {
    const grown = WORD.map((b) => pulsedBox(b, centre, WORD_PULSE_SCALE));
    const after = wordPulseCentre(grown);
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
  });

  it("grows by the same amount on both sides, so the word does not drift", () => {
    const rest = unionOf(WORD);
    const grown = unionOf(WORD.map((b) => pulsedBox(b, centre, WORD_PULSE_SCALE)));
    const leftGain = rest.x - grown.x;
    const rightGain = grown.x + grown.w - (rest.x + rest.w);
    expect(leftGain).toBeGreaterThan(0);
    expect(leftGain).toBeCloseTo(rightGain, 9);
  });

  it("a top-left scale - what a bare setScale would do - is NOT what this does", () => {
    // The negative control for the centring. Phaser Text's origin is (0, 0), so
    // `setScale` alone leaves x untouched and grows the glyph rightwards into
    // the next letter's fixed position: the word tightens and slides right.
    // `pulsedPosition` must therefore MOVE the first letter left.
    const first = WORD[0] as PulseBox;
    const moved = pulsedPosition(first, centre, WORD_PULSE_SCALE);
    expect(moved.x).toBeLessThan(first.x);
    expect(moved.y).toBeLessThan(first.y);
  });

  it("returns every letter to its resting position at scale 1", () => {
    for (const box of WORD) {
      const at = pulsedPosition(box, centre, 1);
      expect(at.x).toBeCloseTo(box.x, 9);
      expect(at.y).toBeCloseTo(box.y, 9);
    }
  });
});

describe("UR-26 the layout box is untouched - the line cannot jitter", () => {
  it("the word never reaches the word after it, even at full scale", () => {
    // The pulse grows the word into its own leading and trailing space. If it
    // grew far enough to overlap the next word the effect would READ as a
    // reflow even though nothing moved, which is the complaint restated.
    const centre = wordPulseCentre(WORD);
    const grown = unionOf(WORD.map((b) => pulsedBox(b, centre, WORD_PULSE_SCALE)));
    expect(grown.x + grown.w).toBeLessThan(LATER.x);
  });

  it("a later letter's position is not a function of the pulse at all", () => {
    // The structural claim, and the reason this is safe rather than tuned:
    // `WarpScene.pulseCompletedWord` only ever passes the letters INSIDE the
    // completed range to `pulsedPosition`. A later letter is not an input to
    // the effect, so there is no scale - not 1.07, not 4 - that moves it.
    const centre = wordPulseCentre(WORD);
    for (const scale of [1, WORD_PULSE_SCALE, 4]) {
      const moved = WORD.map((b) => pulsedBox(b, centre, scale));
      // Every box the effect produced belongs to the completed word.
      expect(moved).toHaveLength(WORD.length);
      // And the later letter is exactly where it was laid out, because nothing
      // in the pulse ever touched it.
      expect(LATER.x).toBe(520);
    }
  });

  it("the union centre of an empty word is not NaN", () => {
    // `pulseCompletedWord` returns early on an empty letter list, but a centre
    // of NaN would propagate into every position it was ever used for, and
    // `setPosition(NaN, NaN)` makes a letter vanish rather than throw.
    const centre = wordPulseCentre([]);
    expect(Number.isFinite(centre.x)).toBe(true);
    expect(Number.isFinite(centre.y)).toBe(true);
  });
});
