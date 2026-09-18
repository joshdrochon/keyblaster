import { describe, expect, it } from "vitest";
import {
  MOCK_NOTE_POOLS,
  coachNoteClipId,
  createCoachValidator,
  mockNote,
  namedWords,
  promisedWord,
  promisesRetry,
  resolveRetry,
  sentenceGives,
  validateComposedSentence,
  withoutRetryPromise,
  type CoachRequest,
  type SentenceValidatorOptions,
} from "@engine/coach/index.js";
import { quotedWords } from "@game/scenes/support/coachHighlight.js";
import { retryCandidatesFor } from "@game/scenes/support/composeRequest.js";
import { hasStageBundle, stageBundle } from "@game/scenes/lib/content.js";
import { coachAllowlist, sightWordList } from "@game/scenes/support/vocab.js";
import { STOP_IDS, type StopId } from "@engine/types";

/**
 * UR-64 - SHADOW MAY NOT OFFER A RETRY THE SENTENCE DOES NOT GIVE.
 *
 * ================== THE ASSERTION THAT WOULD HAVE CAUGHT IT ==================
 * There was no shortage of tests around this screen. `mock.test.ts` held that
 * the note names the right word; `sentence.test.ts` held the six gates;
 * `warp.spec.ts` held the meter, the typing rule and the coach area. Every one
 * of them passed on a build where the note promised a child a word and the
 * sentence underneath it did not contain that word, because no test ever put
 * the two strings in the same room.
 *
 * So the claim here is exactly that, and nothing else:
 *
 *   IF the note the child reads offers to type a word again,
 *   THEN the sentence the child is given contains that word.
 *
 * ================== IT IS A SWEEP, NOT A CASE ==================
 * Coding standards rule 5: a harness parameterised by stop runs the full set or
 * says in code why a subset is enough. The screen renders at seven stops, the
 * mock has four template tables, and the word the note names is whichever one
 * the run produced - so this walks EVERY stop crossed with EVERY pool word,
 * through the real `mockNote`, the real allowlist and the real candidates. The
 * reported case was Pluto naming "up"; a test that only held Pluto and only
 * held "up" would have told us nothing about the other 187 combinations, and
 * the one thing this project has learned twice is that a sampled gate gives a
 * random answer rather than a weaker one.
 */

const LANG = "en" as const;
const allowlist = coachAllowlist(LANG);
const validator = createCoachValidator({ allowlist });

/** The stops that have a warp break at all. Earth has no belt (D57). */
const WARP_STOPS: StopId[] = STOP_IDS.filter(
  (stopId) => hasStageBundle(stopId) && stageBundle(stopId).warpSentence !== null,
);

function gateFor(stopId: StopId, practised: readonly string[]): SentenceValidatorOptions {
  return {
    allowlist,
    pool: stageBundle(stopId).pool,
    sightWords: sightWordList(LANG),
    practised,
  };
}

/** The note the shipped default transport actually produces for a run. */
function noteFor(req: CoachRequest): string {
  return mockNote(validator.sanitize(req));
}

/** What the screen ends up drawing, note and sentence together. */
function screenFor(
  stopId: StopId,
  run: { missed: readonly string[]; slow: readonly string[] },
): { note: string; sentence: string } {
  const bundle = stageBundle(stopId);
  const shipped = bundle.warpSentence ?? "";
  const note = noteFor({
    stopId,
    lang: LANG,
    missed: run.missed,
    slow: run.slow,
    hitRate: run.slow.length > 0 && run.missed.length === 0 ? 1 : 0.85,
  });
  const resolved = resolveRetry({
    note,
    current: shipped,
    candidates: retryCandidatesFor(stopId),
    mayReplace: true,
    gate: gateFor(stopId, [...run.missed, ...run.slow, ...bundle.pool]),
  });
  return { note: resolved.note, sentence: resolved.sentence ?? shipped };
}

describe("UR-64: every stop, every template, every word", () => {
  it("has seven stops to sweep and six warp breaks in them", () => {
    // The anti-vacuity row. A sweep over an empty list is green and proves
    // nothing, and this file's whole argument is its coverage.
    expect(STOP_IDS).toHaveLength(7);
    expect(WARP_STOPS).toHaveLength(6);
    for (const stopId of WARP_STOPS) {
      expect(stageBundle(stopId).pool.length).toBeGreaterThan(20);
    }
  });

  it("THE INVARIANT: a promised word is always in the sentence the child gets", () => {
    const broken: string[] = [];
    let promises = 0;
    for (const stopId of WARP_STOPS) {
      for (const word of stageBundle(stopId).pool) {
        // Both shapes a single named word can arrive in: the run that was clean
        // but slow on one word (ONE_SLOW, the table that makes the offer), and
        // the run that let one through (ONE_MISSED).
        for (const run of [
          { missed: [] as string[], slow: [word] },
          { missed: [word], slow: [] as string[] },
        ]) {
          const screen = screenFor(stopId, run);
          const promised = promisedWord(screen.note);
          if (promised === null) continue;
          promises += 1;
          if (!sentenceGives(screen.sentence, promised, LANG)) {
            broken.push(`${stopId}/${word}: note promised "${promised}", sentence "${screen.sentence}"`);
          }
        }
      }
    }
    // Watched failing: with `resolveRetry` made a no-op - i.e. the behaviour
    // that shipped - this reports
    //   expected [ ...(76) ] to deeply equal []
    // and names them, starting
    //   mars/dust: note promised "dust", sentence "Mars is the red planet."
    expect(broken, broken.slice(0, 5).join("\n")).toEqual([]);
    // And the offer is still MADE sometimes. An implementation that withdrew
    // every promise everywhere would satisfy the line above and would be a
    // worse screen than the one in the ticket.
    expect(promises).toBeGreaterThan(0);
  });

  it("CONTROL: the shipped pairing IS broken, at every stop", () => {
    // Without this, the case above would also pass on a build where the note
    // never names anything. This is the defect, measured: the raw mock note
    // against the raw static sentence, which is exactly what shipped.
    const broken: string[] = [];
    for (const stopId of WARP_STOPS) {
      const shipped = stageBundle(stopId).warpSentence ?? "";
      for (const word of stageBundle(stopId).pool) {
        const note = noteFor({ stopId, lang: LANG, missed: [], slow: [word], hitRate: 1 });
        const promised = promisedWord(note);
        if (promised === null) continue;
        if (!sentenceGives(shipped, promised, LANG)) broken.push(`${stopId}/${word}`);
      }
    }
    expect(broken.length).toBeGreaterThan(0);
    // Every stop, not one unlucky one.
    for (const stopId of WARP_STOPS) {
      expect(broken.some((entry) => entry.startsWith(`${stopId}/`)), stopId).toBe(true);
    }
  });

  it("CONTROL: the reported case is one of them", () => {
    // UR-64 named it: at Pluto the note offered a retry of "up" and the
    // sentence was the stop's static one, which does not contain it.
    const shipped = stageBundle("pluto").warpSentence;
    expect(shipped).toBe("Pluto is small, cold, and far away.");
    expect(stageBundle("pluto").pool).toContain("up");
    const note = noteFor({ stopId: "pluto", lang: LANG, missed: [], slow: ["up"], hitRate: 1 });
    expect(promisedWord(note)).toBe("up");
    expect(sentenceGives(shipped ?? "", "up", LANG)).toBe(false);

    // And after the rule, the child is not promised anything that screen cannot
    // give. Pluto's prose has no short typeable sentence containing "up", so
    // this is the honest half of the answer: the offer is withdrawn.
    const screen = screenFor("pluto", { missed: [], slow: ["up"] });
    expect(promisesRetry(screen.note)).toBe(false);
    expect(screen.note).toContain('"up"');
    expect(screen.sentence).toBe(shipped);
  });

  it("the offer IS kept where the stop's own prose can keep it", () => {
    // The other half. `retrySentenceFor` selects a sentence that already
    // contains the word, so the child reads the offer and then types the word.
    const kept: string[] = [];
    for (const stopId of WARP_STOPS) {
      for (const word of stageBundle(stopId).pool) {
        const screen = screenFor(stopId, { missed: [], slow: [word] });
        // BOTH halves. "the note still promises" alone is satisfied by doing
        // nothing at all, which is the defect; the sentence has to give it.
        if (promisedWord(screen.note) !== word) continue;
        if (!sentenceGives(screen.sentence, word, LANG)) continue;
        kept.push(`${stopId}/${word}`);
      }
    }
    // MEASURED: 25, at all six stops -
    //   mars/planet, mars/dust, mars/rust, jupiter/planet, jupiter/other,
    //   jupiter/inside, saturn/wears, saturn/between, uranus/spins,
    //   uranus/side, uranus/rings, uranus/thin, uranus/hard, uranus/see,
    //   neptune/deep, neptune/blue, neptune/very, neptune/sun,
    //   neptune/sunlight, neptune/takes, neptune/four, neptune/bright,
    //   neptune/star, pluto/small, pluto/far
    // against 76 that are withdrawn. Not a large fraction, and the header of
    // `retry.ts` says why: a stop's prose covers only part of its pool, and
    // nothing here invents a sentence to cover the rest. Asserted as a FLOOR
    // with slack under the measurement, so that a content edit moving one
    // briefing line does not turn this red while the selection quietly
    // stopping work does.
    expect(kept.length, kept.join(", ")).toBeGreaterThanOrEqual(20);
  });

  it("every sentence the rule hands over is one a child may be asked to type", () => {
    // The hard constraint (D34, AC-13.1/13.2): every word on that stop's
    // allowlist - pool plus sight words plus proper nouns. Checked by running
    // the string through the SAME six gates a live model's sentence clears,
    // which is the thing `tests/unit/content/allowlist.test.ts` would catch us
    // on and which this must not be able to route around.
    for (const stopId of WARP_STOPS) {
      const bundle = stageBundle(stopId);
      for (const word of bundle.pool) {
        const screen = screenFor(stopId, { missed: [], slow: [word] });
        if (screen.sentence === bundle.warpSentence) continue;
        const outcome = validateComposedSentence(
          screen.sentence,
          gateFor(stopId, [word, ...bundle.pool]),
        );
        expect(outcome.ok, `${stopId}: ${screen.sentence}`).toBe(true);
      }
    }
  });
});

describe("UR-64: what counts as a promise", () => {
  it("the shipped templates are classified the way they read", () => {
    // ONE template makes the offer, and the classification has to agree with a
    // human reading the string. This is the table, stated, so that adding a
    // template that promises and forgetting about it fails here.
    const promising = Object.values(MOCK_NOTE_POOLS)
      .flat()
      .filter((template) => promisesRetry(template));
    expect(promising).toEqual([
      'Clean run, pilot. "{a}" took a moment. Try it again with me.',
    ]);
  });

  it('"next time" is not a promise about this screen', () => {
    // A note may NAME a word without offering to type it now. Treating every
    // mention as a promise would strip honest copy and would make the whole
    // rule read as censorship of the coach.
    for (const template of [
      'Nice flying, pilot. Watch for "{a}" and "{b}" next time.',
      'You had that one. Keep an eye on "{a}" and "{b}".',
      'Every rock down. "{a}" was the slow one. Next time it is yours.',
    ]) {
      expect(promisesRetry(template), template).toBe(false);
      expect(promisedWord(template), template).toBeNull();
    }
  });

  it("a promise with no word named owes the sentence nothing", () => {
    // The shipped Saturn fallback says "We threaded the rings. Let's do that
    // again." - a promise about the belt, not about a word. There is nothing
    // for a sentence to contain, so the note is left exactly as written.
    const note = "Steady hands, pilot. We threaded the rings. Let's do that again.";
    expect(promisedWord(note)).toBeNull();
    const resolved = resolveRetry({
      note,
      current: "Saturn wears rings made of ice and rock.",
      candidates: retryCandidatesFor("saturn"),
      mayReplace: true,
      gate: gateFor("saturn", stageBundle("saturn").pool),
    });
    expect(resolved.note).toBe(note);
    expect(resolved.outcome).toBeNull();
  });

  it("the word this file reads off a note is the word the screen paints", () => {
    // `retry.ts` restates `coachHighlight.quotedWords` because the engine may
    // not import from `src/game`. If the two ever disagreed, the rule would
    // withdraw a promise about one word while the screen highlighted another.
    for (const template of Object.values(MOCK_NOTE_POOLS).flat()) {
      const note = template.replace("{a}", "rivers").replace("{b}", "empty");
      expect(namedWords(note), note).toEqual(quotedWords(note));
    }
  });
});

describe("UR-64: withdrawing an offer leaves a good note", () => {
  const PROMISING = 'Clean run, pilot. "across" took a moment. Try it again with me.';

  it("drops the offer and keeps the rest, including the word", () => {
    const out = withoutRetryPromise(PROMISING);
    expect(out).toBe('Clean run, pilot. "across" took a moment.');
    // AC-15.5's claim survives: the note still names the word.
    expect(out).toContain('"across"');
    expect(promisesRetry(out)).toBe(false);
  });

  it("never returns an empty note", () => {
    // A note that is nothing BUT a promise would otherwise be erased, and a
    // blank coach area is a worse screen than a broken offer.
    const bare = "Try it again with me.";
    expect(withoutRetryPromise(bare)).toBe(bare);
    expect(withoutRetryPromise("")).toBe("");
  });

  it("D98: a note the rule can trim never had a recording to lose", () => {
    // `audio/wiring.speakNote` looks a clip up BY THE NOTE TEXT, so a trimmed
    // note that HAD a clip would silently go quiet - and D98 says silence is
    // the runtime behaviour for a line with no recording, which would turn an
    // honest note into a missing one.
    //
    // It cannot happen, and the reason is structural rather than lucky: the
    // only template that offers a retry interpolates the child's own word, so
    // `mock.ts` classifies it as a SHAPE rather than a sentence and gives it no
    // clip id at all. Asserted rather than argued, because the argument would
    // stop being true the moment someone wrote a promising template with no
    // slots in it.
    for (const template of Object.values(MOCK_NOTE_POOLS).flat()) {
      if (!promisesRetry(template)) continue;
      const note = template.replace("{a}", "rivers").replace("{b}", "empty");
      expect(coachNoteClipId(note), note).toBeNull();
      expect(coachNoteClipId(withoutRetryPromise(note)), note).toBeNull();
    }
  });

  it("leaves a note that promises nothing exactly as it was", () => {
    for (const note of [
      "That was a clean run, pilot. Every word on the first try.",
      'Nice flying, pilot. Watch for "rivers" next time.',
    ]) {
      expect(withoutRetryPromise(note)).toBe(note);
    }
  });
});

describe("UR-64: whole words, never substrings", () => {
  it('"up" inside "supper" is not the child typing "up"', () => {
    // Watched failing: with `sentenceGives` written as
    // `sentence.toLowerCase().includes(word.toLowerCase())` this case reports
    //   expected true to be false
    // and the Pluto control above goes green on a sentence that never gives the
    // child the word - which is the ticket, passing its own test.
    expect(sentenceGives("The pilot had supper.", "up", LANG)).toBe(false);
    expect(sentenceGives("Light it up.", "up", LANG)).toBe(true);
  });

  it("case and the sentence's punctuation do not decide it", () => {
    expect(sentenceGives("Mars is the red planet.", "MARS", LANG)).toBe(true);
    expect(sentenceGives("Mars is the red planet.", "planet", LANG)).toBe(true);
    expect(sentenceGives("Mars is the red planet.", "plan", LANG)).toBe(false);
  });
});

describe("UR-64: the sentence is never swapped out from under a child", () => {
  const stopId: StopId = "saturn";
  const note = 'Clean run, pilot. "rings" took a moment. Try it again with me.';

  it("swaps when nothing has been typed", () => {
    const resolved = resolveRetry({
      note,
      current: "Saturn wears rings made of ice and rock.",
      candidates: retryCandidatesFor(stopId),
      mayReplace: true,
      gate: gateFor(stopId, ["rings", ...stageBundle(stopId).pool]),
    });
    // Saturn's shipped sentence already contains "rings", so there is nothing
    // to swap and the promise is kept as it stands.
    expect(resolved.outcome).toBe("standing");
    expect(resolved.sentence).toBeNull();
    expect(resolved.note).toBe(note);
  });

  it("withdraws rather than replaces once the child is typing (D31)", () => {
    const resolved = resolveRetry({
      note: 'Clean run, pilot. "bathtub" took a moment. Try it again with me.',
      current: "Saturn wears rings made of ice and rock.",
      candidates: retryCandidatesFor(stopId),
      mayReplace: false,
      gate: gateFor(stopId, ["bathtub", ...stageBundle(stopId).pool]),
    });
    expect(resolved.outcome).toBe("withdrawn");
    expect(resolved.sentence).toBeNull();
    expect(promisesRetry(resolved.note)).toBe(false);
  });
});
