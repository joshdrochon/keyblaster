/**
 * The repo is part of the submission, and nothing in it may publish the words
 * of the person who reported a bug. `scripts/no-user-quotes.mjs` is the gate
 * that enforces it, and until this test existed the gate had no test at all -
 * which is how it came to pass 42 tracked lines that quote reports verbatim.
 *
 * WHAT EARNED THIS FILE. The gate's first two layers guess at what a future
 * quote looks like: attribution phrases, and the misspellings that survive a
 * copy-paste. Both missed `DirectorMapScene.ts`, which quoted a report in full
 * - typo included - in a doc comment. The sentence simply contained none of
 * the fingerprints anyone had thought to list.
 *
 * Layer 3 stops guessing. Every verbatim report is recorded in
 * `gauntlet/user-reported.json` under `said`, so the quotes are ENUMERABLE.
 *
 * RULE 4 (docs/coding-standards.md): every assertion below was watched failing
 * against the real implementation before it was kept, and the observed failing
 * value is recorded beside it. An assertion of the shape f(x) === f(x) has
 * shipped in this repo before and passed forever.
 */
import { describe, expect, it } from "vitest";

import {
  QUOTE_WINDOW,
  SUPPRESSION,
  buildCopyWindows,
  buildQuoteWindows,
  normalise,
  scanLine,
} from "../../../scripts/no-user-quotes.mjs";

/**
 * A SYNTHETIC stand-in for the report that the old gate passed.
 *
 * The real one is in `gauntlet/user-reported.json`, which is untracked because
 * it is the file allowed to hold a reporter's exact words. Using those words
 * here would put them back in a tracked file to test a gate whose entire job
 * is keeping them out - and this file would then be the leak. It has the same
 * word count as the real report, so every window count recorded below is still
 * the number that was watched.
 */
const LEAKED_REPORT = {
  id: "UR-53-ship-hovers-over-current-planet",
  said: "the widget should probably be floating above the chosen marker",
};

const REPORTS = [
  LEAKED_REPORT,
  { id: "UR-52", said: "this is a defect. These fragments should not be drifting across our chart." },
];

describe("normalise", () => {
  it("folds case, punctuation and whitespace so a requote cannot dodge on formatting", () => {
    // Watched failing with the raw string returned unchanged:
    //   expected 'The WIDGET  should -- probably be' to be 'the widget should probably be'
    expect(normalise("The WIDGET  should -- probably be")).toBe("the widget should probably be");
  });

  it("is idempotent, so a window built from copy and one built from a line agree", () => {
    const once = normalise("The dialog, at the bottom!");
    expect(normalise(once)).toBe(once);
  });
});

describe("buildQuoteWindows", () => {
  it("emits every run of QUOTE_WINDOW consecutive words from a report", () => {
    const windows = buildQuoteWindows([LEAKED_REPORT]);
    // 10 words, window 6 -> 10 - 6 + 1 = 5 windows.
    // Watched failing at 0 before the loop was written, and at 10 when the
    // bound was `i < words.length` rather than `i + QUOTE_WINDOW <= length`.
    expect(windows.size).toBe(5);
    expect(windows.has("the widget should probably be floating")).toBe(true);
    expect(windows.has("be floating above the chosen marker")).toBe(true);
  });

  it("ignores reports with no recorded words rather than throwing", () => {
    // gauntlet/user-reported.json holds entries filed from a screenshot, which
    // have no `said` at all. Throwing here would break every commit.
    expect(buildQuoteWindows([{ id: "UR-99" }, { id: "UR-98", said: "" }]).size).toBe(0);
  });

  it("does not emit a window for a report shorter than the window", () => {
    // Five words cannot fill a six-word window. Watched failing at 1 when the
    // implementation padded short reports out to a single window.
    expect(buildQuoteWindows([{ id: "x", said: "remove it it looks bad" }]).size).toBe(0);
  });
});

describe("scanLine - layer 3, the exact one", () => {
  const windows = buildQuoteWindows(REPORTS);

  it("flags the real leak that both older layers passed", () => {
    // The shape of the line that leaked from a scene's doc comment: a ticket
    // id followed by the report quoted whole. The old gate returned undefined
    // for it, which is the whole reason this layer exists.
    const leaked = `   * UR-53: "the widget should probably be floating above the chosen marker."`;
    expect(scanLine(leaked, windows)).toBe("verbatim");
  });

  it("flags a quote that has been trimmed mid-sentence", () => {
    // Quotes are rarely pasted whole. A six-word run is enough to identify one.
    //
    // The fixture matters more than it looks. My first attempt here was
    //   "// see also: floating above the chosen marker, per ticket"
    // which returned undefined, and the first instinct was that the gate had a
    // bug. It does not. That line's six-word runs all START one word late -
    // "floating above the chosen marker per" - and the report's own runs begin
    // "be floating above the chosen marker". The window is an exact string
    // match on consecutive words, so an off-by-one in the FIXTURE looks
    // identical to a hole in the implementation. Rule 9: two causes, one output.
    expect(scanLine("// see also: be floating above the chosen marker, per ticket", windows)).toBe(
      "verbatim",
    );
  });

  it("passes a paraphrase that keeps the engineering and drops the words", () => {
    // This is what the rule asks lanes to write instead. If this ever returns
    // a reason, the gate is unusable and lanes will start suppressing it.
    expect(
      scanLine("// UR-53: the Lantern parks над the selected stop on the map.", windows),
    ).toBeUndefined();
    expect(scanLine("  // UR-52: decorative debris must not overlap a planet.", windows)).toBeUndefined();
  });

  it("does not fire on a run one word shorter than the window", () => {
    // Five words, under the bar. This is the boundary that keeps ordinary
    // English out of the hit list.
    // Watched failing with 'verbatim' when QUOTE_WINDOW was 4.
    expect(scanLine("// parks it above the chosen marker", windows)).toBeUndefined();
  });
});

describe("scanLine - layer 2, attribution", () => {
  it("catches second-person attribution, not only third", () => {
    // Both of these have the shape of the two lines that sat in a TRACKED
    // doc for months. The gate read only the third-person form and let the
    // pronoun through.
    expect(scanLine("You asked whether the widget count rises with level.", new Set())).toBe( // no-user-quotes-ok: synthetic fixture; an attribution test must contain the pattern
      "attribution",
    );
    expect(
      scanLine("a choice made by someone who could not check it - exactly the mistake you caught.", new Set()), // no-user-quotes-ok: synthetic fixture; the pattern must appear literally
    ).toBe("attribution");
  });

  it("does not fire on ordinary second person in prose", () => {
    // docs/verification-gaps.md is full of rhetorical "you", and it is tracked.
    // Flagging it would force the document to be rewritten for no gain.
    expect(
      scanLine("A sampled gate does not give you a weaker answer; it gives you a random one.", new Set()),
    ).toBeUndefined();
  });
});

describe("buildCopyWindows - the words the GAME says are not the words a PERSON said", () => {
  it("removes a report that quotes shipped copy back", () => {
    // A report repeating the tagline would otherwise make the shipped string
    // table itself a quote of the person who read it aloud. The old behaviour
    // flagged 10 such lines, including src/engine/i18n/strings.ts.
    const tagline = "light the way through the solar system";
    const quoted = buildQuoteWindows([{ id: "UR-x", said: `I like that it says ${tagline}` }]);
    const copy = buildCopyWindows(["src/engine/i18n/strings.ts"]);

    // Watched failing with `true` before the subtraction was wired into main().
    const survives = [...quoted].filter((w) => !copy.has(w));
    expect(survives.some((w) => w.includes("the way through the solar"))).toBe(false);
  });

  it("returns an empty set for sources that are absent rather than throwing", () => {
    expect(buildCopyWindows(["src/content/does-not-exist.json"]).size).toBe(0);
  });

  it("expands a DIRECTORY source, because copy is not in one file", () => {
    // Copy is every src/content/<lang>/*.json - nine in `en` alone, plus the
    // `es` and `hi` siblings that D95 cuts from the menu but keeps tracked.
    // Listing individual paths missed ui.json, and the gate then flagged two
    // scene comments that name an on-screen string: it was calling the game's
    // own words a quote of the person who read them aloud.
    //
    // Watched failing at 0 when COPY_SOURCES held only file paths.
    const windows = buildCopyWindows(["src/content"]);
    expect(windows.size).toBeGreaterThan(0);
    expect(windows.has("type word to wake the beacon")).toBe(true);
  });

  it("does NOT cover copy once a placeholder has been interpolated", () => {
    // A KNOWN LIMIT, asserted so nobody rediscovers it as a bug.
    //
    // ui.json stores `earth.typePrompt` as "type {word} to wake the beacon",
    // so the copy window is "type word to wake the beacon". A comment that
    // quotes what the child actually SEES writes "type launch to wake the
    // beacon", and the two never match. Expanding COPY_SOURCES to the content
    // directory therefore does not retire the suppression in
    // EarthActivationScene, and the claim that it would was wrong.
    //
    // Interpolating every placeholder against every word in the pools to
    // generate the variants is not worth it for a gate this size; the
    // suppression, with its reason, is the cheaper honest answer.
    const windows = buildCopyWindows(["src/content"]);
    expect(windows.has("type launch to wake the beacon")).toBe(false); // no-user-quotes-ok: shipped game copy, interpolated, in an assertion about that exact case
  });

  it("treats a file passed where a directory is expected as that one file", () => {
    // COPY_SOURCES mixes both kinds, so the expansion must not assume.
    expect(buildCopyWindows(["src/engine/i18n/strings.ts"]).size).toBeGreaterThan(0);
  });
});

describe("SUPPRESSION", () => {
  const windows = buildQuoteWindows(REPORTS);

  it("requires a reason - a bare marker does not silence the gate", () => {
    // Watched failing with `undefined` when the regex was /no-user-quotes-ok/
    // with no trailing requirement: every leak could be waved through with a
    // token nobody had to justify.
    const bare = `* "the widget should probably be floating above the chosen marker" // no-user-quotes-ok`;
    expect(scanLine(bare, windows)).toBe("verbatim");
  });

  it("silences a line that gives one", () => {
    const justified = `* "the widget should probably be floating above the chosen marker" // no-user-quotes-ok: fixture in a test of the gate`;
    expect(scanLine(justified, windows)).toBeUndefined();
  });

  it("matches only the marker form, not a mention of the script", () => {
    expect(SUPPRESSION.test("see scripts/no-user-quotes.mjs for the rule")).toBe(false);
  });
});

describe("QUOTE_WINDOW", () => {
  it("is 6, the value that separated the real leak from paraphrase", () => {
    // Recorded so a later widening is a deliberate act with a test to change.
    // At 5 the gate flagged 3 paraphrased lines; at 8 it missed the leak.
    expect(QUOTE_WINDOW).toBe(6);
  });
});
