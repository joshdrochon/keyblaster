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
  /**
   * ============ THE FADE MOVED ONTO THE RING, AND HAD TO ============
   *
   * These two cases asserted a `this.tweens.add({ targets: this.ring.graphics,
   * alpha: 0, ... })` written in `clearAndLaunch`. That tween was there, this
   * file was green, and the ring was STILL on screen: `createFocusRing`
   * breathes it with a `repeat: -1` tween on the same `alpha`, so the scene's
   * fade was a second tween on one property and the breath kept winning.
   * Measured in the served build, sampled every animation frame from the last
   * keystroke - panel 0.000 against ring 1.000 at Pluto, 0.856 at Mars, 0.865
   * at Neptune.
   *
   * SO THE CLAIM IS UNCHANGED AND THE SPELLING IS NOT. It is still "the ring
   * leaves with the card, on the panel's own duration and ease"; what changed
   * is that the operation belongs to the component, because the pulse's handle
   * is the component's closure and no caller can reach it. A source guard can
   * only ever say the call is there - `warp-chrome.spec.ts` is what asserts the
   * ring's real alpha after the exit, and that is the case this defect needed.
   */
  it("hands the ring's exit to the ring, on the panel's own beat", () => {
    const s = source();
    const call = /this\.ring\.fadeOut\((\w+),\s*(EASE\.\w+)\)/.exec(s);
    expect(
      call,
      "the focus ring is not faded by the exit; it stays painted at full alpha " +
        "over an empty frame until the scene is torn down",
    ).toBeTruthy();
    // And NOT with a tween the scene rolls itself, which is what was wrong.
    expect(
      /targets:\s*this\.ring\.graphics/.test(s),
      "the scene is fading the ring behind the component's back again; the " +
        "breath is a repeat:-1 tween on the same alpha and it will win",
    ).toBe(false);
    // One beat, not two that happen to overlap. Read off the source rather
    // than restated, so changing `PANEL_CLEAR_MS` moves both or fails here.
    const panel = /targets:\s*this\.panelRoot,\s*alpha:\s*0,[\s\S]{0,200}?duration:\s*(\w+),\s*ease:\s*(EASE\.\w+)/.exec(s);
    expect(panel).toBeTruthy();
    expect(call?.[1]).toBe("PANEL_CLEAR_MS");
    expect(call?.[1]).toBe(panel?.[1]);
    expect(call?.[2]).toBe(panel?.[2]);
  });

  it("and the component stops the breath before it fades", () => {
    // The half a scene cannot do. `fadeOut` must clear BOTH handles - the
    // arrival tween and the pulse - or the fade is the second writer again.
    const kit = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/lib/kit.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const body = /fadeOut\(durationMs: number, ease: string\) \{[\s\S]*?\n    \},/.exec(kit);
    expect(body, "`FocusRing.fadeOut` is not where this test looks").toBeTruthy();
    const fade = body?.[0] ?? "";
    expect(fade).toContain("tween?.remove()");
    expect(fade).toContain("pulse?.remove()");
    expect(fade).toContain("pulse = null");
    expect(fade).toContain("alpha: 0");
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
   *   gives the bottom-left instruction sentence case, in both languages
   *     (then: "...a capital, and nothing else")
   *     expected 'type the sentence. a slip just asks f…' to be
   *     'Type the sentence. A slip just asks f…'
   *   does not Title Case a hint, which is the other way to get this wrong
   *     expected 't' to be 'T'
   *   the rest of the screen's own copy already starts with a capital
   *     warp.speaker starts lower case: expected 's' to be 'S'
   *
   * UR-146 later narrowed one of UR-81's two rules; see the block above those
   * two cases. The lower-case second sentence in the string quoted above is
   * the thing that changed, and it changed because the owner read it.
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

  /**
   * ============ UR-146 NARROWED THE SECOND HALF OF UR-81 ============
   *
   * These two cases USED to pin the exact string and then assert that ONE word
   * in it was capitalised. That second claim was wrong, and the project owner
   * has since said so on screen: "Type the sentence. a slip just asks..." has
   * TWO sentences in it, and a full stop ends a sentence, so the second one
   * starts with a capital like the first. The convention UR-81 cited - that the
   * clause after the stop stays lowercase - had no entry in
   * `docs/decision-log.md` and its only evidence was two `ui/strings.ts`
   * strings the owner has now had corrected.
   *
   * WHAT THIS CASE PROTECTS IS UNCHANGED AND IS NOT NARROWED: a hint must not
   * be TITLE CASED. "Type The Sentence" is still a failure, and the negative
   * control below proves the case can still see one. What moved is only which
   * capitals count as legitimate - a word that opens a sentence, rather than
   * the first word of the string.
   *
   * WATCHED FAILING, with the copy Title Cased to
   * "Type The Sentence. A Slip Just Asks For The Same Letter Again.":
   *   expected [ 'The', 'Slip', 'Just', 'Asks', 'For', 'The', 'Same',
   *   'Letter', 'Again.' ] to deeply equal []
   */
  it("gives the bottom-left instruction sentence case, in both languages", () => {
    expect(en.text("warp.hint")).toBe(
      "Type the sentence. A slip just asks for the same letter again.",
    );
    expect(es.text("warp.hint")).toBe(
      "Escribe la frase. Un desliz solo pide la misma letra otra vez.",
    );
  });

  it("does not Title Case a hint, which is the other way to get this wrong", () => {
    const opensSentence = (hint: string): Set<number> => {
      // Word 0, plus any word that follows a word ending in . ? or !
      const words = hint.split(" ");
      const out = new Set<number>([0]);
      words.forEach((w, i) => {
        if (/[.?!]$/.test(w)) out.add(i + 1);
      });
      return out;
    };
    for (const hint of [en.text("warp.hint"), es.text("warp.hint")]) {
      const words = hint.split(" ");
      const starts = opensSentence(hint);
      // Every sentence opener IS capitalised...
      for (const i of starts) {
        const w = words[i];
        if (w === undefined) continue;
        expect(w[0], `word ${i} of "${hint}"`).toBe(w[0]?.toLocaleUpperCase());
      }
      // ...and nothing else is, which is what rules Title Case out.
      const capitalised = words.filter(
        (w, i) => !starts.has(i) && /^[A-ZÁÉÍÓÚÑ]/.test(w),
      );
      expect(capitalised).toEqual([]);
    }
  });

  it("NEGATIVE CONTROL: the Title Case check can still see a Title Cased hint", () => {
    // Without this, narrowing the case above could have made it vacuous. It is
    // run against a hand-written string rather than the table, because the
    // table is the thing under test.
    const titled = "Type The Sentence. A Slip Just Asks For The Same Letter Again.";
    const words = titled.split(" ");
    const starts = new Set<number>([0]);
    words.forEach((w, i) => {
      if (/[.?!]$/.test(w)) starts.add(i + 1);
    });
    const capitalised = words.filter((w, i) => !starts.has(i) && /^[A-Z]/.test(w));
    expect(capitalised).toEqual([
      "The", "Sentence.", "Slip", "Just", "Asks", "For", "The", "Same",
      "Letter", "Again.",
    ]);
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

  /**
   * ============ AND IT IS CENTRED IN THE ELEMENT IT SITS IN ============
   *
   * The owner: "Beacon Charge" is not centred in its element. It was hung from
   * the label row's TOP edge, and the row was the literal 32 while one line of
   * `TYPE.label` is 37 in the language the rows are sized for - so the ink did
   * not sit in the middle of the space, it hung off the bottom of it.
   *
   * The row is `lineBox(TYPE.label)` now (`warpLayout.test.ts` holds that half)
   * and this is the scene's half: both ends of the line - the label and the
   * percentage, which UR-62 made ONE line - are drawn at `rowMiddle(row)` with
   * `originY: 0.5`. A y with a number added to it would pass the geometry case
   * and fail this one.
   *
   * WATCHED FAILING, with both call sites back on `labelRow.y`:
   *   draws the label and the readout on the row's middle, not its top edge
   *     the charge label is hung from the row's top edge again: expected
   *     false to be true
   */
  it("draws the label and the readout on the row's middle, not its top edge", () => {
    const s = source();
    const meter = s.slice(s.indexOf("private buildMeter("));
    expect(
      /const labelY = rowMiddle\(labelRow\);/.test(meter),
      "the charge label is hung from the row's top edge again",
    ).toBe(true);
    // Both ends of the line, on the same middle with the same origin. The
    // percentage keeps its own `originX: 1` - it is right-anchored to the
    // track's end and that is UR-62's other half.
    const label = /skyText\(\s*this,\s*chargeLabelX\(\),\s*labelY,[\s\S]{0,400}?\n    \);/.exec(meter);
    const percent = /skyText\(\s*this,\s*labelRow\.x \+ labelRow\.w,\s*labelY,[\s\S]{0,500}?\n    \);/.exec(meter);
    expect(label, "the charge label is not drawn at `labelY`").toBeTruthy();
    expect(percent, "the percentage is not drawn at `labelY`").toBeTruthy();
    for (const call of [label?.[0] ?? "", percent?.[0] ?? ""]) {
      expect(call).toContain("originY: 0.5");
    }
    expect(percent?.[0] ?? "").toContain("originX: 1");
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
  /**
   * ============ THE HINT LINE IS GONE, SO IT CANNOT OUTLIVE ANYTHING ============
   *
   * This case used to assert that `clearAndLaunch` faded `this.hintLine.objects`
   * on the panel's own beat, because the hint was outside `panelRoot` and the
   * panel fade never reached it. Both of the screen's instruction lines are
   * inside Shadow's card now (`warp.coachIntro`), the card is inside
   * `panelRoot`, and `ui/hint.ts` declares the screen `placement: "none"`.
   *
   * SO THE CLAIM IS STRONGER, NOT NARROWER. "The object is faded with the
   * panel" is replaced by "there is no such object", and the one thing still
   * outside `panelRoot` - the focus ring - is asserted by the cases at the top
   * of this file. A `drawHint` put back here fails BOTH this case and
   * `hintLine.test.ts`'s cross-file sweep.
   *
   * WATCHED FAILING, with the `drawHint` call and its fade loop restored:
   *   the warp break is drawing a hint line again; its instruction belongs in
   *   Shadow's card: expected true to be false
   *   expected 3 to be 2
   */
  const warpSource = (): string =>
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/WarpScene.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  it("has no hint line left to outlive the screen", () => {
    const s = warpSource();
    expect(
      /drawHint\s*\(/.test(s) || /this\.hintLine/.test(s),
      "the warp break is drawing a hint line again; its instruction belongs " +
        "in Shadow's card",
    ).toBe(false);
  });

  it("and what IS outside panelRoot still leaves on the panel's beat", () => {
    // The panel and the focus ring. Two, where it was three: the third was the
    // hint line's, and it went with the object. The ring's is now an ARGUMENT
    // to `FocusRing.fadeOut` rather than a tween written here - see the block
    // over "hands the ring's exit to the ring" - so the count is of the token,
    // not of the tween.
    const exit = warpSource().slice(warpSource().indexOf("private clearAndLaunch("));
    // The two that CLEAR are still one beat.
    const clears = exit.match(/(?:duration: PANEL_CLEAR_MS|fadeOut\(PANEL_CLEAR_MS)/g) ?? [];
    expect(clears.length, "the exit no longer clears on one beat").toBe(2);
    expect(exit).toMatch(/duration: PANEL_CLEAR_MS/);
    expect(exit).toMatch(/this\.ring\.fadeOut\(PANEL_CLEAR_MS,/);
    // UR-166: Shadow is the one thing that deliberately does NOT leave on it -
    // she cheers into the cleared frame - but her delay is MEASURED from it, so
    // the beat is still the one number the exit is built on.
    const held = exit.match(/delay: PANEL_CLEAR_MS \+ /g) ?? [];
    expect(held.length, "Shadow's hold drifted off the panel's beat").toBe(1);
  });
});

describe("the exit is driven by what is moving, not by a constant (UR-166)", () => {
  const src = readFileSync("src/game/scenes/WarpScene.ts", "utf8");

  it("fades Shadow out instead of letting the scene change take her away", () => {
    // She is drawn at the hud depth, OUTSIDE `panelRoot`, so the panel's own
    // fade never reached her and she cheered on alone after the card had gone.
    expect(src).toMatch(/targets: this\.shadow\.root,\s*\n\s*alpha: 0,/);
  });

  it("collects every moving thing and cuts when the last one finishes", () => {
    expect(src).toMatch(/const pending: Phaser\.Tweens\.Tween\[\] = \[\]/);
    expect(src).toMatch(/waiting -= 1;\s*\n\s*if \(waiting <= 0\) this\.cutToBeacon\(\)/);
    expect(src).toMatch(/tween\.once\("complete", done\)/);
  });

  it("still cuts when there is nothing to wait for - the overlay path has no ship", () => {
    expect(src).toMatch(/if \(waiting === 0\) this\.time\.delayedCall\(0, done\)/);
  });

  it("clears the page BEFORE she cheers, and cuts after she has gone", () => {
    // The owner's order: the elements go, she finishes her animation, then the
    // next page. Neither the hop nor the fade may start before the card has
    // cleared, and the fade may not start before the hop has finished.
    expect(src).toMatch(/delay: PANEL_CLEAR_MS,\s*\n\s*duration: SHADOW_HOP_MS/);
    expect(src).toMatch(
      /delay: PANEL_CLEAR_MS \+ \(reduced \? SHADOW_CHEER_HOLD_MS : SHADOW_HOP_MS \* 2\)/,
    );
    expect(src).toMatch(/duration: SHADOW_CHEER_EXIT_MS/);
  });

  it("she is never left standing still on a cleared frame (UR-166b)", () => {
    // Two hops plus a 620 ms fade left her alone for 1.2 s and read as
    // orphaned. Her whole solo is now the hop plus the fade, both moving.
    expect(src).toMatch(/const SHADOW_HOP_MS = 130;/);
    expect(src).toMatch(/const SHADOW_CHEER_EXIT_MS = 300;/);
  });

  it("the cheer is a real animation, not a pose and a timer", () => {
    // `setPose("cheering")` is static - sparks drawn once plus the ambient
    // face-glow pulse - so "wait until she is done" had nothing to wait on.
    expect(src).toMatch(/y: \{ from: hopY, to: hopY - SHADOW_HOP_PX \}/);
    expect(src).toMatch(/y: \{ from: hopY, to: hopY - SHADOW_HOP_PX \},[\s\S]{0,120}yoyo: true,/);
  });

  it("reduced motion keeps the beat and drops the hop (D41)", () => {
    expect(src).toMatch(/if \(!reduced\) \{\s*\n\s*pending\.push\(/);
  });
});
