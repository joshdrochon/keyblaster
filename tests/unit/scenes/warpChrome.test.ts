import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANE_COPY_EN, createLaneText } from "@game/scenes/support/copy";

/**
 * FOUR REPORTS FROM THE PROJECT OWNER AGAINST THE WARP BREAK'S CHROME.
 *
 * The exit's lingering focus ring, and the three copy defects: the coach's name
 * in lower case, the bottom-left instruction in lower case, and the pair of
 * them in Spanish as well.
 *
 * `WarpScene.ts` extends a Phaser class and cannot be imported under vitest's
 * node environment, so the RING half is a source guard - the same binding
 * `warpExit.test.ts` uses, for the same reason, against the same file. The COPY
 * half is not a guard: `support/copy.ts` is pure data and is resolved through
 * the real `createLaneText`, so what is asserted is the string a screen gets
 * rather than a line of the table.
 *
 *   npx vitest run tests/unit/scenes/warpChrome.test.ts --coverage.enabled=false
 */
const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/WarpScene.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("the focus ring leaves on the same beat as the card it is around", () => {
  /**
   * ================== THE DEFECT, MEASURED ==================
   * "A yellow outline around the sentence card lazily stays behind for a bit."
   *
   * IT IS THE FOCUS RING AND NOT A `rim`. The sentence card is drawn
   * `corner: "bracket"` with no rim at all, deliberately - the ring sits 4..8 px
   * outside the plate and `RIM.gap` would put a rim at 7..9, and the two of them
   * in the same gold painted one muddy edge. So the ring IS this card's gold
   * line, and there is nothing else on the screen it could be confused with.
   *
   * IT IS A TIMING BUG, WHICH IS WHY NO SCREENSHOT SHOWS IT. `clearAndLaunch`
   * fades `panelRoot`; the ring is created outside `panelRoot` at
   * `layer("hud").depth + 1` so it draws OVER the card, so the fade never
   * reached it. Sampled every animation frame from the last keystroke, in the
   * served build on port 4270:
   *
   *              panelRoot.alpha   ring.graphics.alpha
   *     +135 ms       0.000               1.000
   *     +701 ms       0.000               1.000
   *     +1601 ms      0.000               1.000
   *
   * The ring outlived the card by the whole exit - 260 ms of launch delay plus
   * a 900 ms flight - and then vanished with the scene instead of fading.
   *
   * UR-82 IS NOT INVOLVED, which was the other suspect. That changed
   * `ui/chrome.FocusRing` to snap-and-fade; this screen's ring is
   * `scenes/lib/kit.createFocusRing`, a different class in a different file,
   * and `WarpScene` imports it from `./lib/kit`.
   *
   * ================== WATCH IT FAIL (rule 4) ==================
   * Real printed values, from the red run with the second tween deleted:
   *   fades the ring with the panel, not with the scene
   *     the focus ring is not faded by the exit; it stays painted at full
   *     alpha over an empty frame until the scene is torn down: expected
   *     false to be true
   *   on the panel's own duration, so it is one beat and not two
   *     expected null to be truthy
   */
  it("fades the ring with the panel, not with the scene", () => {
    const s = source();
    expect(
      /targets:\s*this\.ring\.graphics,\s*alpha:\s*0,/.test(s),
      "the focus ring is not faded by the exit; it stays painted at full alpha " +
        "over an empty frame until the scene is torn down",
    ).toBe(true);
  });

  it("on the panel's own duration, so it is one beat and not two", () => {
    // The ring's tween and the panel's must not drift apart into two fades that
    // happen to overlap. Read off the source rather than restated, so changing
    // `PANEL_CLEAR_MS` moves both or fails here.
    const s = source();
    const ring = /targets:\s*this\.ring\.graphics,[\s\S]{0,200}?duration:\s*(\w+),\s*ease:\s*(EASE\.\w+)/.exec(s);
    const panel = /targets:\s*this\.panelRoot,\s*alpha:\s*0,[\s\S]{0,200}?duration:\s*(\w+),\s*ease:\s*(EASE\.\w+)/.exec(s);
    expect(ring).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(ring?.[1]).toBe("PANEL_CLEAR_MS");
    expect(ring?.[1]).toBe(panel?.[1]);
    expect(ring?.[2]).toBe(panel?.[2]);
  });

  it("and the ring is still the thing that draws that outline", () => {
    // The guard that keeps the case above about the right object: if a later
    // pass gives the sentence card a `rim`, there are two gold lines again and
    // fading one of them is no longer the fix.
    const s = source();
    const call = /plate\(this, PANEL\.x[\s\S]{0,240}?\}\),/.exec(s);
    expect(call, "the sentence card's plate call is not where this test looks").toBeTruthy();
    expect(/rim/.test(call?.[0] ?? "rim")).toBe(false);
    expect(/corner: "bracket"/.test(call?.[0] ?? "")).toBe(true);
  });
});

describe("Shadow is a name and the instruction is a sentence", () => {
  /**
   * UR-81 recased this lane's table under one rule - Title Case for labels and
   * buttons, sentence case for hints, questions and whole sentences - and made
   * two mistakes on this screen: it treated the coach's name as a common noun,
   * and it left the bottom-left instruction starting in lower case.
   *
   * ================== WHAT RENDERS THESE ==================
   * The speaker label is drawn with `lib/kit.label`, NOT `lib/kit.chrome`, so
   * nothing puts it through `theme.chromeCase` and the table's case is the case
   * on screen. That was the thing to check before editing a table: `chromeCase`
   * would override it. It still upper-cases under D41's increased-legibility
   * setting, which is a reading aid and applies to a name like anything else.
   *
   * The hint is drawn by `ui/hintLine.drawHint`, which does not case it either.
   *
   * ================== WATCH THEM FAIL (rule 4) ==================
   * Real printed values, from the red run with the table put back:
   *   capitalises the coach's name wherever a screen asks for it
   *     expected 'shadow' to be 'Shadow'
   *   capitalises him in Spanish too, and in Hindi by fallthrough
   *     expected 'shadow' to be 'Shadow'
   *   leaves no lower-case "shadow" anywhere in the lane's copy
   *     expected [ 'warp.speaker', 'warp.composed' ] to deeply equal []
   *   gives the bottom-left instruction a capital, and nothing else
   *     expected 'type the sentence. a slip just asks f…' to be
   *     'Type the sentence. a slip just asks f…'
   *   does not Title Case a hint, which is the other way to get this wrong
   *     expected 't' to be 'T'
   *   the rest of the screen's own copy already starts with a capital
   *     warp.speaker starts lower case: expected 's' to be 'S'
   */
  const en = createLaneText({ lang: "en", shipName: "Lantern" });
  const es = createLaneText({ lang: "es", shipName: "Lantern" });
  // Hindi's lane table is empty on purpose and falls through to English, so
  // this is the third language rather than an untested one (rule 5).
  const hi = createLaneText({ lang: "hi", shipName: "Lantern" });

  it("capitalises the coach's name wherever a screen asks for it", () => {
    expect(en.text("warp.speaker")).toBe("Shadow");
    expect(en.text("warp.composed")).toBe(
      "Shadow wrote this one from your words, just now",
    );
  });

  it("capitalises him in Spanish too, and in Hindi by fallthrough", () => {
    expect(es.text("warp.speaker")).toBe("Shadow");
    expect(es.text("warp.composed")).toContain("Shadow ");
    expect(hi.text("warp.speaker")).toBe("Shadow");
  });

  it("leaves no lower-case \"shadow\" anywhere in the lane's copy", () => {
    // THE SWEEP, as an assertion rather than as a grep somebody ran once. Every
    // string in the table, not the four keys this pass happened to touch.
    const offenders = Object.entries(LANE_COPY_EN)
      .filter(([, value]) => /\bshadow\b/.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("gives the bottom-left instruction a capital, and nothing else", () => {
    const hint = en.text("warp.hint");
    expect(hint).toBe("Type the sentence. a slip just asks for the same letter again.");
    expect(es.text("warp.hint")).toBe(
      "Escribe la frase. un desliz solo pide la misma letra otra vez.",
    );
  });

  it("does not Title Case a hint, which is the other way to get this wrong", () => {
    // UR-81's rule has two halves and only one of them applies here. A hint
    // Title Cased would read "Type The Sentence", so the check is that exactly
    // one word is capitalised and it is the first.
    for (const hint of [en.text("warp.hint"), es.text("warp.hint")]) {
      const words = hint.split(" ");
      expect(words[0]?.[0]).toBe(words[0]?.[0]?.toLocaleUpperCase());
      const capitalised = words.slice(1).filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w));
      expect(capitalised).toEqual([]);
    }
  });

  it("the rest of the screen's own copy already starts with a capital", () => {
    // The sibling sweep the report asked for. Every string this screen draws,
    // from the two tables that supply it. `warp.chargeLabel` joined the list
    // when the owner settled the escalation - see the block below.
    for (const key of [
      "warp.speaker",
      "warp.hint",
      "warp.composed",
      "warp.chargeLabel",
    ] as const) {
      const first = en.text(key)[0] ?? "";
      expect(first, `${key} starts lower case`).toBe(first.toLocaleUpperCase());
    }
  });
});

/**
 * THE METER'S LABEL IS A LABEL, AND LABELS ARE TITLE CASE.
 *
 * ================== AN ESCALATION THE OWNER CLOSED ==================
 * UR-81's rule already gave Title Case to labels, and `warp.chargeLabel` is a
 * label, so "Warp Drive" was the literal reading of a rule this repo had
 * already adopted. The lane that wrote that rule left this one string alone and
 * recorded why in `gauntlet/escalations.md` ("2. 'warp drive' IS STILL LOWER
 * CASE, and that is a deliberate non-change"): the owner's own report about the
 * bolt spelled it lower case, and recasing one label invites recasing the whole
 * table. Its lean was "leave it; if the owner wants Title Case on labels it
 * should be one sweep with the whole list in front of them."
 *
 * The owner has now asked for this label capitalised. That closes the
 * escalation for THIS string and for no other: "continue", "fly it again" and
 * "stage report" are untouched, so the table-wide sweep the escalation asked
 * for is still open and still the owner's to call.
 *
 * ================== WHERE THE CASE COMES FROM ==================
 * The TABLE, not the call site. `ui/text.uiText` puts every chrome string
 * through `theme.chromeCase`, and since UR-81 that function returns the string
 * unchanged unless D41's increased-legibility setting is on - so the case a
 * translator writes is the case on screen, and hardcoding "Warp Drive" in
 * `WarpScene.ts` would have put English capitals on the Spanish string too.
 *
 * ================== WATCHED FAILING (rule 4) ==================
 * Real printed values from the red run, with the table's old strings in place:
 *   capitalises the warp drive's label, which is a label and not a sentence
 *     expected 'warp drive' to be 'Warp Drive'
 *   capitalises it in Spanish too, and in Hindi by fallthrough
 *     expected 'motor de salto' to be 'Motor de salto'
 *   leaves no lower-case "warp drive" in the lane's copy
 *     expected [ 'warp.charged' ] to deeply equal []
 */
describe("the charge meter's label is Title Case", () => {
  const en = createLaneText({ lang: "en", shipName: "Lantern" });
  const es = createLaneText({ lang: "es", shipName: "Lantern" });
  const hi = createLaneText({ lang: "hi", shipName: "Lantern" });

  it("capitalises the meter's label, which is a label and not a sentence", () => {
    // WHAT IT NAMES ALSO CHANGED. It read "Warp Drive", and the belt is AT the
    // stop - there is nowhere to drive to. The meter charges the BEACON the
    // next scene plants. Watched failing on the recast:
    //   expected 'Warp Drive' to be 'Beacon Charge'
    expect(en.text("warp.chargeLabel")).toBe("Beacon Charge");
  });

  it("capitalises it in Spanish too, and in Hindi by fallthrough", () => {
    // SPANISH IS SENTENCE CASE AND THAT IS NOT AN INCONSISTENCY. Spanish does
    // not Title Case a common-noun phrase, so "Motor de Salto" would be English
    // typography wearing Spanish words. The rule the table follows is "the
    // label carries a capital", and in Spanish that is one capital.
    //   expected 'Motor de salto' to be 'Carga de baliza'
    expect(es.text("warp.chargeLabel")).toBe("Carga de baliza");
    expect(hi.text("warp.chargeLabel")).toBe("Beacon Charge");
  });

  it("leaves no warp drive at all in the lane's copy, in any case", () => {
    // The sweep, as an assertion rather than as a grep somebody ran once. It
    // used to look for a lower-case "warp drive"; the recast makes the stronger
    // check the true one, so it asks for the word itself.
    const offenders = Object.entries(LANE_COPY_EN)
      .filter(([, value]) => /\bwarp\b/i.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

/**
 * UR-104: THE HINT LINE LEAVES ON THE SAME BEAT AS THE RING.
 *
 * The lane that fixed the ring measured this one failing the same way and left
 * it alone because it was not in the report. It is the same defect one object
 * along: the hint is outside `panelRoot` - it belongs to the screen's foot,
 * not to the card - so the panel fade never reached it, and it sat at full
 * alpha over an empty frame for the whole 1160 ms exit.
 *
 * WATCHED FAILING, with the loop removed:
 *   the hint line is not faded with the panels, so it outlives the screen:
 *   expected false to be true
 */
describe("UR-104: the screen empties as one thing", () => {
  it("fades the hint line with the panels and the ring", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/WarpScene.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const exit = source.slice(source.indexOf("private clearAndLaunch("));
    expect(
      /for \(const object of this\.hintLine\.objects\)/.test(exit),
      "the hint line is not faded with the panels, so it outlives the screen",
    ).toBe(true);
    // One beat: the same duration token as the panels and the ring.
    const fades = exit.match(/duration: PANEL_CLEAR_MS/g) ?? [];
    expect(fades.length, "the exit no longer clears on one beat").toBeGreaterThanOrEqual(3);
  });
});
