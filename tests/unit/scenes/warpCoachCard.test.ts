import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EN, ES, HI, TABLES } from "@engine/i18n/strings";
import { LANE_COPY_EN, createLaneText } from "@game/scenes/support/copy";
import { SCREEN_HINTS } from "@game/ui/hint";
import { CARET, caretBox, caretBreathe } from "@game/scenes/lib/typedWord";
import { COACH, SENTENCE_PX, SENTENCE_STEP } from "@game/scenes/support/warpLayout";
import { coachRows } from "@game/scenes/support/warpLayout";
import { DUR, TYPE } from "@game/ui/theme";

/**
 * THE WARP BREAK SAYS ONE THING, IN ONE PLACE.
 *
 * ================== WHAT WAS REPORTED ==================
 * The screen carried its instruction TWICE and neither copy was where a child
 * was looking. A banner across the top of the frame - `warp.beltCleared`, "the
 * belt is clear, type the sentence below to charge the beacon" - and a hint at
 * the foot - `warp.hint`, "a slip just asks for the same letter again". Between
 * them sat Shadow's card, the one element on the screen with a face in it,
 * saying nothing at all until his note arrived.
 *
 * Both lines are one line in that card now (`warp.coachIntro`), in his voice,
 * and his note replaces it when it lands.
 *
 * ================== THE CONSTRAINT THIS FILE EXISTS FOR ==================
 * AC-33: the coach area is laid out BEFORE the note arrives and must not move
 * or resize when it does, because the live and the fallback screens have to be
 * byte-identical. So the instruction is a SECOND Text in the note's own row
 * rather than a string swapped into the note's - same row, same size, same
 * wrap, both created up front, neither ever moved - and the arrival is a
 * crossfade between two objects that occupy one rectangle. The note's own x, y,
 * style and wrap are untouched by this change, which is what `warp.spec.ts`
 * compares field by field.
 *
 * `WarpScene.ts` extends a Phaser class, so the half of this that is about the
 * scene is a SOURCE GUARD - the same binding `warpChrome.test.ts` and
 * `warpExit.test.ts` use against the same file. The copy half and the caret
 * half are not guards: both resolve through the real modules.
 *
 * ================== WATCH THEM FAIL (rule 4) ==================
 * Every message below was READ OFF A RED RUN, each produced by putting the
 * thing the case is about back the way it was:
 *
 *   ships in all three languages, none of them falling through
 *     (Hindi set to the English string)
 *     expected 'The belt is clear, pilot. Type the se…' not to be
 *     'The belt is clear, pilot. Type the se…'
 *   carries everything the two old lines carried
 *     expected 'The belt is clear, pilot. Type the se…' to match /पट्टी/
 *   draws no banner at the top of the frame
 *     (a `text("warp.beltCleared")` call put back in `create`)
 *     the warp break still draws warp.beltCleared at the top of the frame:
 *     expected true to be false
 *   puts no hint on the grid line
 *     (the `ui/hint.ts` row put back to `placement: "grid"`)
 *     expected 'grid' to be 'none'
 *   holds the instruction in the NOTE'S OWN ROW, at the note's own size
 *     (the note drawn at `noteRow.y - 12`)
 *     the note is not drawn on `noteRow`: expected null to be truthy
 *   is the pre-flight prompt's caret, imported rather than rewritten
 *     (a second `fillRoundedRect` added to WarpScene's own caret Graphics)
 *     WarpScene draws its own caret: expected [ Array(2) ] to have a length
 *     of 1 but got 2
 *
 *   npx vitest run tests/unit/scenes/warpCoachCard.test.ts --coverage.enabled=false
 */

const SCENES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");
const source = (file: string): string =>
  readFileSync(resolve(SCENES, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const en = createLaneText({ lang: "en", shipName: "Lantern" });
const es = createLaneText({ lang: "es", shipName: "Lantern" });
const hi = createLaneText({ lang: "hi", shipName: "Lantern" });

describe("the instruction Shadow opens with", () => {
  it("ships in all three languages, none of them falling through", () => {
    // Rule 5: the three tables are typed against EN, so a MISSING key is a
    // compile error - what this case adds is that Hindi is a real translation
    // rather than the English string sitting in the Hindi table.
    for (const table of [EN, ES, HI]) {
      expect(table["warp.coachIntro"].length).toBeGreaterThan(0);
    }
    expect(ES["warp.coachIntro"]).not.toBe(EN["warp.coachIntro"]);
    expect(HI["warp.coachIntro"]).not.toBe(EN["warp.coachIntro"]);
    expect(hi.text("warp.coachIntro")).toBe(HI["warp.coachIntro"]);
  });

  it("carries everything the two old lines carried", () => {
    // The three facts, one per clause: the belt is gone, the typing charges
    // the beacon, and a missed letter costs nothing. Asserted against the
    // MEANING rather than the wording, so the copy can be rewritten without
    // rewriting this case - but not so loosely that a clause can be dropped.
    const line = en.text("warp.coachIntro");
    expect(line, "the belt").toMatch(/belt is clear/i);
    expect(line, "what the typing is for").toMatch(/charge the beacon/i);
    expect(line, "a missed letter").toMatch(/miss a letter/i);
    expect(line, "and that it costs nothing").toMatch(/again/i);

    const spanish = es.text("warp.coachIntro");
    expect(spanish).toMatch(/cinturón/i);
    expect(spanish).toMatch(/cargar la baliza/i);
    expect(spanish).toMatch(/letra/i);

    const hindi = hi.text("warp.coachIntro");
    expect(hindi).toMatch(/पट्टी/);
    expect(hindi).toMatch(/बीकन/);
    expect(hindi).toMatch(/अक्षर/);
  });

  it("is sentence case, which is one capital per sentence and no more", () => {
    // The house rule the owner settled (`gauntlet/escalations.md`): Title Case
    // for labels, sentence case for sentences, and a full stop ENDS a sentence
    // so the next one opens with a capital. `warpChrome.test.ts` holds the same
    // rule over the hint this line replaces.
    for (const line of [en.text("warp.coachIntro"), es.text("warp.coachIntro")]) {
      const words = line.split(" ");
      const opens = new Set<number>([0]);
      words.forEach((w, i) => {
        if (/[.?!]$/.test(w)) opens.add(i + 1);
      });
      for (const i of opens) {
        const w = words[i];
        if (w === undefined) continue;
        expect(w[0], `word ${i} of "${line}"`).toBe(w[0]?.toLocaleUpperCase());
      }
      const stray = words.filter(
        (w, i) => !opens.has(i) && /^[A-ZÁÉÍÓÚÑ]/.test(w),
      );
      expect(stray, `Title Case crept into "${line}"`).toEqual([]);
    }
  });

  it("NEGATIVE CONTROL: that check can still see a Title Cased line", () => {
    // Without this, the case above passes on any string with one capital in it.
    const titled = "The Belt Is Clear, Pilot. Type The Sentence.";
    const words = titled.split(" ");
    const opens = new Set<number>([0]);
    words.forEach((w, i) => {
      if (/[.?!]$/.test(w)) opens.add(i + 1);
    });
    expect(words.filter((w, i) => !opens.has(i) && /^[A-Z]/.test(w))).toEqual([
      "Belt", "Is", "Clear,", "Pilot.", "The", "Sentence.",
    ]);
  });

  it("fits the two lines the coach note reserves, in every language", () => {
    // AC-33's reserve is TWO lines of `TYPE.body` in the row `coachRows`
    // returns - the longest Spanish and Hindi fallback notes need both - and
    // this string shares that row. A third line would print through the card's
    // bottom padding, which is the failure this number exists to stop.
    //
    // The estimate is the scene's OWN: `layoutLetters` wraps on
    // `length * size * 0.58`, so the card is measured the way the screen
    // measures it rather than by a second rule written here.
    const [, noteRow] = coachRows(TYPE.body, TYPE.caption);
    const budget = (noteRow?.w ?? 0) * 2;
    expect(budget).toBeGreaterThan(0);
    for (const [lang, line] of [
      ["en", EN["warp.coachIntro"]],
      ["es", ES["warp.coachIntro"]],
      ["hi", HI["warp.coachIntro"]],
    ] as const) {
      const ink = [...line].length * TYPE.body * 0.58;
      expect(ink, `${lang} needs a third line`).toBeLessThan(budget);
    }
  });
});

describe("neither of the two old lines is on the screen, and neither key was deleted", () => {
  it("draws no banner at the top of the frame", () => {
    const s = source("WarpScene.ts");
    expect(
      /warp\.beltCleared/.test(s),
      "the warp break still draws warp.beltCleared at the top of the frame",
    ).toBe(false);
    // ...and with it went the header line's two status dots, which hung off
    // its right end (`markBoxAfter`) and had nothing left to hang off.
    expect(
      /paintStatusDots/.test(s),
      "the header line's status dots are back with nothing to hang off",
    ).toBe(false);
  });

  it("puts no hint on the grid line", () => {
    const s = source("WarpScene.ts");
    expect(
      /drawHint\s*\(/.test(s),
      "the warp break is drawing a hint line again; its instruction is in " +
        "Shadow's card and a second copy at the foot of the frame is UR-56's " +
        "defect with a card in place of a button",
    ).toBe(false);
    expect(/warp\.hint/.test(s), "WarpScene still resolves warp.hint").toBe(false);
    const row = SCREEN_HINTS.find((r) => r.file === "WarpScene.ts");
    expect(row?.placement).toBe("none");
    expect(row?.hintKey).toBeNull();
    // Every screen without a hint says why (`hint.test.ts` sweeps this); the
    // reason here names where the instruction went.
    expect(row?.note ?? "").toContain("warp.coachIntro");
  });

  it("keeps both dead keys, like `briefing.hint` and `beacon.hint`", () => {
    // Kept, not deleted, so restoring either line is a layout change and not a
    // translation job. `warp.heading` is the precedent inside this same
    // namespace and it is still here too.
    for (const key of ["warp.beltCleared", "warp.heading"] as const) {
      for (const table of Object.values(TABLES)) {
        expect((table as Record<string, string>)[key] ?? "", key).not.toBe("");
      }
    }
    expect(LANE_COPY_EN["warp.hint"]).toBe(
      "Type the sentence. A slip just asks for the same letter again.",
    );
  });
});

describe("AC-33: the card holds still across the swap", () => {
  const s = source("WarpScene.ts");

  it("holds the instruction in the NOTE'S OWN ROW, at the note's own size", () => {
    // Both Texts are built from the same `noteRow`, with the same size and the
    // same wrap width. Two objects in one rectangle is what makes the arrival a
    // crossfade instead of a relayout: there is no path through `showNote` on
    // which a coordinate is computed at all.
    const area = s.slice(s.indexOf("private buildCoachArea("));
    const note = /this\.noteText = label\(\s*this,\s*noteRow\.x,\s*noteRow\.y,[\s\S]{0,300}?\);/.exec(area);
    const intro = /this\.introText = label\(\s*this,\s*noteRow\.x,\s*noteRow\.y,[\s\S]{0,400}?\);/.exec(area);
    expect(note, "the note is not drawn on `noteRow`").toBeTruthy();
    expect(intro, "the instruction is not drawn on `noteRow`").toBeTruthy();
    for (const drawn of [note?.[0] ?? "", intro?.[0] ?? ""]) {
      expect(drawn).toContain("size: TYPE.body");
      expect(drawn).toContain("wrapWidth: noteRow.w");
    }
  });

  it("changes nothing but a string and an alpha when the note lands", () => {
    // The whole of AC-33 as a source claim: `showNote`'s renderer may set text
    // and tween alpha, and may not touch a position, a size, a wrap or the
    // card. Watched failing with `this.noteText.setY(noteRow.y - 12)` added:
    //   the coach area moves when the note arrives: expected
    //   [ 'setY' ] to deeply equal []
    const render = s.slice(s.indexOf("const render = "), s.indexOf("audio.speakNote"));
    const moves = [
      "setPosition", "setX", "setY", "setFontSize", "setWordWrapWidth",
      "setSize", "setScale", "setOrigin",
    ].filter((call) => render.includes(call));
    expect(moves, "the coach area moves when the note arrives").toEqual([]);
    // And the instruction leaves on the note's own beat, not on one of its own.
    expect(render).toContain("targets: this.introText");
    expect((render.match(/duration: DUR\.panel/g) ?? []).length).toBe(2);
  });

  it("waits before Shadow takes the card back, or the feature deletes itself", () => {
    // `MockCoach` is the default transport (AC-15.4) and settles inside the
    // first frame, so a note that replaced the instruction "on arrival" would
    // replace it before one frame had drawn it - the two lines would be gone
    // rather than consolidated. The floor is `DUR.toast`, the product's
    // existing answer to "long enough to read a transient line", measured from
    // the scene's start so a slow transport pays nothing.
    expect(
      /const COACH_INTRO_MIN_MS = DUR\.toast;/.test(s),
      "the dwell is a number picked here rather than the product's own",
    ).toBe(true);
    expect(DUR.toast).toBeGreaterThan(1500);
    // QUEUED BY `askShadow`, RELEASED BY `update`. The first version awaited a
    // `this.time.delayedCall` and the note never arrived in the served build at
    // all: `coach.calls` read 1 and `coach.received` stayed false past six
    // seconds. `update` is the clock this screen is already known to run.
    const ask = s.slice(s.indexOf("private async askShadow("), s.indexOf("private releaseCoachNote("));
    expect(ask, "askShadow draws the note itself, with nothing to hold it")
      .not.toMatch(/this\.showNote\(/);
    expect(ask).toContain("this.pendingNote = {");
    const update = s.slice(s.indexOf("override update("));
    expect(update, "nothing releases the queued note").toContain("this.releaseCoachNote()");
    const release = s.slice(s.indexOf("private releaseCoachNote("));
    expect(release).toContain("COACH_INTRO_MIN_MS");
    expect(release).toContain("this.showNote(");
  });
});

describe("the caret under the letter being typed is ONE drawing", () => {
  it("is the pre-flight prompt's, imported rather than rewritten", () => {
    const s = source("WarpScene.ts");
    expect(
      /import \{ paintCaret \} from "\.\/lib\/typedWord";/.test(s),
      "the warp sentence's caret is not the pre-flight prompt's",
    ).toBe(true);
    // This project has shipped two cockpit windows, two `WINDOW` rects and two
    // skies. A caret drawn here would be the fourth pair; the plate-painter
    // sweep (`arch/platePainters.test.ts`) would see the rounded rect, and this
    // says the same thing about the file the owner asked about.
    expect(
      (s.match(/fillRoundedRect/g) ?? []).filter(Boolean),
      "WarpScene draws its own caret",
    ).toHaveLength(1);
    expect(s).toContain("fillRoundedRect(0, 0, 4, 48, 2)");
  });

  it("works on a wrapped run because it is a function of ONE letter's box", () => {
    // THE THING THE SHARED MODULE NEEDED. The drawing did not change for a
    // multi-line caller; what changed is that it takes the letter's box instead
    // of reading a container offset it owned. Two letters on two lines of the
    // warp sentence, at the step `warpLayout` wraps on:
    const first = caretBox({ x: 136, y: 200, w: 26 }, SENTENCE_PX);
    const second = caretBox({ x: 136, y: 200 + SENTENCE_STEP, w: 26 }, SENTENCE_PX);
    expect(second.y - first.y).toBe(SENTENCE_STEP);
    // ...each one under its own letter, at the same drop, with no line number
    // anywhere in the arithmetic.
    expect(first.y - 200).toBeCloseTo(SENTENCE_PX * CARET.drop, 5);
    expect(second.y - (200 + SENTENCE_STEP)).toBeCloseTo(SENTENCE_PX * CARET.drop, 5);
    expect(first.x).toBe(136);
    expect(second.x).toBe(136);
    expect(first.h).toBe(second.h);
  });

  it("never draws a caret too narrow to see", () => {
    // A space between two words is a letter of the sentence and gets a caret;
    // its glyph can measure 0. `minWidth` is what the single-word prompt has
    // always had and the wrapped line inherits it.
    expect(caretBox({ x: 0, y: 0, w: 0 }, SENTENCE_PX).w).toBe(CARET.minWidth);
    expect(caretBox({ x: 0, y: 0, w: 44 }, SENTENCE_PX).w).toBe(44);
  });

  it("breathes between the same two bounds on both screens", () => {
    // One cue, one rhythm. Sampled across a full period rather than asserted
    // at the peak, because the bound is what a reader sees.
    const samples = Array.from({ length: 64 }, (_, i) =>
      caretBreathe((i / 64) * CARET.breatheMs),
    );
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.8 + 1e-9);
  });

  it("and the warp sentence's caret is painted every frame from the state", () => {
    const s = source("WarpScene.ts");
    const update = s.slice(s.indexOf("override update("));
    expect(update).toContain("this.paintSentenceCaret()");
    const paint = s.slice(s.indexOf("private paintSentenceCaret("));
    // Off the DRAWN Text, so the completed-word pulse (UR-26) carries the caret
    // with it, and off `sentence.index`, which a typo does not move (AC-16.2).
    expect(paint).toContain("this.sentence.index");
    expect(paint).toContain("letter.x");
    expect(paint).toContain("SENTENCE_PX");
    // A charged sentence has no next letter and gets no caret.
    expect(paint).toContain("this.sentence.charged");
  });
});

describe("the card still fits what is in it", () => {
  it("reserves two lines of body copy beside Shadow and no more", () => {
    // The row this whole file is about. Guarded here as well as in
    // `warpLayout.test.ts` because the instruction is now a second tenant of
    // it: a third reserved line would be a card that grew for copy, which is
    // the thing AC-33 forbids.
    const rows = coachRows(TYPE.body, TYPE.caption);
    expect(rows).toHaveLength(2);
    const note = rows[1];
    expect(note).toBeTruthy();
    expect(note?.h).toBe(Math.round(TYPE.body * 1.56) * 2);
    expect((note?.y ?? 0) + (note?.h ?? 0)).toBeLessThanOrEqual(COACH.y + COACH.h);
  });
});
