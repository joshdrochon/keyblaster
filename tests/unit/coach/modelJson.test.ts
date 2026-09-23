import { describe, expect, it } from "vitest";
import { parseModelJson, pickSentence, sentenceCase, starsToQuotes } from "../../../api/coach.js";

/**
 * THE BUG THAT MADE THE AI PART OF AN AI GAME NEVER HAPPEN.
 *
 * `/api/coach` asked the model for JSON and ran `JSON.parse` on the reply. The
 * model returns well-formed JSON WRAPPED IN A ```json FENCE, which is not
 * JSON, so every reply was thrown away with a 502 and the client fell back to
 * the stop's shipped sentence. Combined with a 1200 ms upstream budget against
 * a call that measures 1.5-2.3 s, the coach had never once reached a player in
 * production - the owner noticed because the credit balance never moved and
 * every warp sentence was the same one.
 *
 * Measured on the deployed function, and it is the fixture below:
 *
 *     stop_reason "end_turn", 274 characters, valid JSON inside the fence
 *
 * Both halves are guarded: the length budget by `warpPrompt.test.ts`, the
 * shape by this file.
 */

const REAL_REPLY = `\`\`\`json
{
  "note": "You found dust tricky. Rivers and empty flew past you. Let's practice them together.",
  "variants": [
    "The dust on Mars is red and dry.",
    "Empty plains and dust cover the whole planet."
  ],
  "sentence": "Mars has dust and empty plains."
}
\`\`\``;

describe("parseModelJson reads the reply the model actually sends", () => {
  it("the fenced reply measured on the deployed function", () => {
    const out = parseModelJson(REAL_REPLY) as Record<string, unknown>;
    expect(out).not.toBeNull();
    expect(out["sentence"]).toBe("Mars has dust and empty plains.");
    expect(out["variants"]).toHaveLength(2);
    expect(String(out["note"])).toContain("dust");
  });

  it("bare JSON, which is what the prompt asks for", () => {
    const out = parseModelJson('{"note":"Good run.","variants":[],"sentence":"Mars is red."}');
    expect((out as Record<string, unknown>)["sentence"]).toBe("Mars is red.");
  });

  it("a fence with no language tag", () => {
    const out = parseModelJson('```\n{"note":"ok"}\n```');
    expect((out as Record<string, unknown>)["note"]).toBe("ok");
  });

  it("whitespace and a trailing newline do not matter", () => {
    expect(parseModelJson('  \n {"note":"ok"} \n ')).toEqual({ note: "ok" });
  });

  it("a preamble the model was not asked for, around an object it was", () => {
    const out = parseModelJson('Here you go:\n{"note":"ok","sentence":"Mars is red."}\nHope that helps!');
    expect((out as Record<string, unknown>)["sentence"]).toBe("Mars is red.");
  });

  it("nothing usable is null, not a throw - this runs inside a request", () => {
    expect(parseModelJson("")).toBeNull();
    expect(parseModelJson("I cannot help with that.")).toBeNull();
    expect(parseModelJson("```json\n{ not json at all \n```")).toBeNull();
    expect(parseModelJson("{")).toBeNull();
  });

  it("the guard is not vacuous: a bare fence still fails", () => {
    expect(parseModelJson("```json\n```")).toBeNull();
  });
});

describe("pickSentence keeps the sibling the client would have accepted", () => {
  const allowed = new Set(["rivers", "run", "across", "mars", "long", "ago", "dust", "and", "the", "empty", "land", "rust"]);

  it("the model's first choice, when it is on the list", () => {
    expect(
      pickSentence(["Rivers run across mars long ago.", "Dust and rust cover the empty land."], allowed),
    ).toBe("Rivers run across mars long ago.");
  });

  it("a variant, when the first choice carries an outside word", () => {
    // Measured live: "cover" is not in Mars' pool and has no sight-word entry,
    // so this whole reply used to be discarded.
    expect(
      pickSentence(["Dust and rust cover the empty land.", "Rivers run across mars long ago."], allowed),
    ).toBe("Rivers run across mars long ago.");
  });

  it("the model's own first choice when nothing is on the list - the old behaviour", () => {
    expect(pickSentence(["Cover the plains.", "Storms cover it."], allowed)).toBe("Cover the plains.");
  });

  it("an empty candidate list yields nothing to send", () => {
    expect(pickSentence([], allowed)).toBeUndefined();
  });
});

describe("starsToQuotes gives the screen the runs it highlights", () => {
  it("stars become the double quotes the accent painter reads", () => {
    expect(starsToQuotes("You found *rusty* and *dim* hard.")).toBe(
      'You found "rusty" and "dim" hard.',
    );
  });

  it("a note with no stars is untouched", () => {
    expect(starsToQuotes("Good flying, pilot.")).toBe("Good flying, pilot.");
  });

  it("an unpaired star is left alone rather than eating the rest of the line", () => {
    expect(starsToQuotes("You found *rusty and dim hard.")).toBe(
      "You found *rusty and dim hard.",
    );
  });
});

describe("sentenceCase opens the note like a sentence", () => {
  it("capitalises a leading pool word, which the pool stores lowercase", () => {
    expect(sentenceCase('"dry" and "sky" took you a moment. Good flying.')).toBe(
      '"Dry" and "sky" took you a moment. Good flying.',
    );
  });

  it("leaves a note that already opens with a capital alone", () => {
    expect(sentenceCase("Good run, pilot.")).toBe("Good run, pilot.");
  });

  it("only the FIRST letter, never a later one", () => {
    expect(sentenceCase('"dry" and "sky" took you a moment.')).not.toContain('"Sky"');
  });

  it("a note with no letters at all does not throw", () => {
    expect(sentenceCase("")).toBe("");
  });
});
