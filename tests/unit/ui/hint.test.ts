import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HINT_CONTRACT,
  SCREEN_HINTS,
  repeatedWords,
  significantWords,
  teachesSomethingNew,
  type ScreenHint,
} from "@game/ui/hint";
import { GUTTER } from "@game/ui/grid";
import { hintInk } from "@game/ui/hintLine";
import { SKY_PLATE } from "@game/ui/theme";
import { LANE_COPY_EN } from "@game/scenes/support/copy";
import { EN } from "@engine/i18n/strings";
import { UI_TABLES } from "@game/ui/strings";
import UI_EN from "../../../src/content/en/ui.json";

/**
 * UR-56: A HINT THAT REPEATS THE BUTTON BESIDE IT.
 *
 * ================== WHAT WAS REPORTED ==================
 * A keyboard hint reported as redundant, with outright removal asked for rather
 * than relocation. It sat 28 px to the right of a focused button whose label
 * already carried its verb.
 *
 * The follow-up on the ticket is the part this file exists for: check whether
 * the same hint is redundant on OTHER screens, because a hint that repeats the
 * button beside it is noise everywhere rather than only here. Two defects in this project have
 * already been fixed on the screen they were reported against and come back on
 * the next one - the Title keep-clear (UR-06 -> UR-52) and the stationary
 * starfield (UR-14 -> UR-50.5). A repeated report is a rule.
 *
 * ================== THE SWEEP ==================
 * `SCREEN_HINTS` carries EVERY scene, not the ones anybody remembered, and the
 * completeness case below fails if a scene file exists with no row. That is
 * coding-standards rule 5: a harness sweeps, it does not sample.
 *
 * ================== WATCH THEM FAIL ==================
 * Every number and message below was READ OFF A RED RUN.
 *
 *   BeaconScene's row put back to { placement: "beside-button",
 *   hintKey: "beacon.hint" } - i.e. the screen as reported
 *   -> "no screen draws a hint beside a button":
 *      `expected [ 'BeaconScene.ts: beacon.hint' ] to deeply equal []`
 *   -> "a hint must teach something the buttons do not":
 *      `BeaconScene.ts: "enter to continue" says nothing "continue" does not`
 *   -> "the two removals are recorded":
 *      `expected [ 'BriefingScene.ts' ] to deeply equal [ Array(2) ]`.
 *      Three independent cases catch it, which is deliberate: the placement,
 *      the copy and the record are three different ways to reintroduce it.
 *
 *   BriefingScene.ts's row deleted from SCREEN_HINTS
 *   -> "every scene has a row - the sweep does not sample":
 *      `a scene with no hint decision recorded: expected
 *      [ 'BriefingScene.ts' ] to deeply equal []`.
 *      This is the case that makes the file a sweep rather than a sample.
 *
 *   `beacon.hint` re-rendered in BeaconScene.ts (a skyText call put back)
 *   -> "a removed hint is not still being drawn":
 *      `expected [ 'BeaconScene.ts renders beacon.hint' ] to deeply equal []`.
 *      A row saying "none" over a scene that still draws it is exactly the
 *      status nobody re-measures (coding-standards rule 10).
 *
 *   npx vitest run tests/unit/ui/hint.test.ts --coverage.enabled=false
 */

const SCENES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");
const sceneFiles = (): string[] => readdirSync(SCENES).filter((f) => f.endsWith("Scene.ts"));
const code = (f: string): string =>
  readFileSync(resolve(SCENES, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/** The shipped English for a key, from whichever of the three tables owns it. */
function copy(key: string): string {
  const lane = LANE_COPY_EN[key];
  if (lane !== undefined) return lane;
  const scene = (UI_EN.strings as Record<string, string>)[key];
  if (scene !== undefined) return scene;
  const engine = (EN as Record<string, string>)[key];
  if (engine !== undefined) return engine;
  const ui = UI_COMMON[key];
  if (ui !== undefined) return ui;
  throw new Error(`no shipped copy for "${key}"`);
}

/**
 * The menu-kit hints, READ FROM THE SHIPPED TABLE.
 *
 * UR-144: these two keys used to be LITERALS copied into this file, guarded by
 * a case that grepped `ui/strings.ts` for `"key": "value"`. That guard could
 * only ever catch drift AFTER it happened, and it broke the moment the new copy
 * was long enough for the table to wrap the value onto its own line - i.e. it
 * was checking the table's formatting as much as its content. Importing the
 * table makes drift impossible instead of detectable, which is strictly the
 * stronger claim; `tests/unit/catalog/unlocks.test.ts` already imports it, so
 * this costs nothing new.
 */
const UI_COMMON: Record<string, string> = UI_TABLES.en;

describe("the hint copy this file reasons about is the copy that ships", () => {
  it("every declared hint key resolves to shipped copy", () => {
    for (const row of SCREEN_HINTS) {
      if (row.hintKey === null) continue;
      expect(copy(row.hintKey).length, row.hintKey).toBeGreaterThan(0);
    }
    for (const row of SCREEN_HINTS) {
      for (const key of row.actionKeys) {
        expect(copy(key).length, key).toBeGreaterThan(0);
      }
    }
  });
});

describe("UR-56: no hint repeats the button beside it", () => {
  it("no screen draws a hint beside a button", () => {
    // The placement IS the defect: two pieces of text saying one thing, read as
    // one object. Banning the placement is what stops the tenth screen doing it.
    const offenders = SCREEN_HINTS.filter((r) => r.placement === "beside-button").map(
      (r) => `${r.file}: ${r.hintKey}`,
    );
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE CONTROL: the rule catches the line that was reported", () => {
    // "enter to continue" beside "continue". Without this the rule above could
    // be vacuous - it passes trivially once the two rows say "none".
    expect(repeatedWords("enter to continue", "continue")).toEqual(["continue"]);
    expect(teachesSomethingNew("enter to continue", ["continue"])).toBe(false);
    // ...and the Briefing's, which is the same shape one screen over. Both of
    // its clauses repeat a plate that is already on the screen: the button
    // reads "launch" and, since UR-27 made it visible, the chip reads "back to
    // the map". Asserted clause by clause rather than through
    // `teachesSomethingNew`, which the filler "go" in "go back" would let past.
    const briefing = "enter to launch · esc to go back";
    expect(repeatedWords(briefing, "launch")).toEqual(["launch"]);
    expect(repeatedWords(briefing, "back to the map")).toEqual(["back"]);
  });

  it("a hint may name a KEY the button cannot", () => {
    // The rule is about the VERB, not about the whole line. "enter" is what a
    // hint is for and no button label says it, so it must not count as a repeat
    // or the sweep would delete every keyboard instruction in the game.
    expect(repeatedWords("arrows to move · enter to choose", "back")).toEqual([]);
    expect(significantWords("enter to choose")).toEqual(["choose"]);
  });

  it("a hint must teach something the buttons do not, on every screen", () => {
    const offenders: string[] = [];
    for (const row of SCREEN_HINTS) {
      if (row.hintKey === null) continue;
      const hint = copy(row.hintKey);
      const labels = row.actionKeys.map(copy);
      if (!teachesSomethingNew(hint, labels)) {
        offenders.push(`${row.file}: "${hint}" says nothing ${labels.map((l) => `"${l}"`).join(" / ")} does not`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a removed hint is not still being drawn", () => {
    // A row saying "none" while the scene still renders the key would be a
    // status nobody re-measured (coding-standards rule 10).
    const offenders: string[] = [];
    for (const row of SCREEN_HINTS) {
      if (row.hintKey !== null) continue;
      const src = code(row.file);
      for (const m of src.matchAll(/text\(\s*"([a-z]+\.hint)"/gi)) {
        offenders.push(`${row.file} renders ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two removals are recorded with the report that caused them", () => {
    const removed = SCREEN_HINTS.filter(
      (r): r is ScreenHint => r.hintKey === null && (r.note ?? "").includes("UR-56"),
    ).map((r) => r.file);
    expect(removed.sort()).toEqual(["BeaconScene.ts", "BriefingScene.ts"]);
  });
});

describe("the hint line is one line, on every screen that has one", () => {
  it("every scene has a row - the sweep does not sample", () => {
    const declared = new Set(SCREEN_HINTS.map((r) => r.file));
    const missing = sceneFiles().filter((f) => !declared.has(f));
    expect(missing, "a scene with no hint decision recorded").toEqual([]);
  });

  it("no row names a scene that does not exist", () => {
    const real = new Set(sceneFiles());
    expect(SCREEN_HINTS.map((r) => r.file).filter((f) => !real.has(f))).toEqual([]);
  });

  it("every screen without a hint says why", () => {
    const silent = SCREEN_HINTS.filter((r) => r.placement === "none" && (r.note ?? "") === "");
    expect(silent.map((r) => r.file)).toEqual([]);
  });

  it("the shared origin puts the plate on the contract's corner", () => {
    // `hintInk()` from `ui/hintLine.ts`. It was `hintOrigin(padX, padY)` here,
    // which took the padding as arguments - and that is exactly how the map
    // came to draw at (118, 1012) while the menus drew at (96, 1004). The
    // assertion is unchanged; what it is asked of no longer has a knob.
    const at = hintInk();
    expect(at.x - SKY_PLATE.padX).toBe(GUTTER);
    expect(at.x - SKY_PLATE.padX).toBe(HINT_CONTRACT.x);
    expect(at.y - SKY_PLATE.padY).toBe(HINT_CONTRACT.top);
  });
});

/**
 * UR-144 - THE HINT LINES DID NOT NAME KEYS, AND DID NOT NAME ACTIONS.
 *
 * ================== WHAT WAS REPORTED ==================
 * The project owner, on Ship Controls: "Left and Right to Change" is not
 * obvious, and asked for a SWEEP rather than a one-line patch on the grounds
 * that if one hint line reads badly the rest probably do too. They did. Every
 * hint line in the product had one or both of these faults:
 *
 *   1. IT NAMED A DIRECTION, NOT A KEY. "Arrows", "Left and Right" - a child
 *      looking down at a keyboard finds nothing labelled either.
 *   2. IT NAMED THE WIDGET'S JOB, NOT THE PLAYER'S. "Change" is what a control
 *      does to itself.
 *
 * ================== WHAT IS SWEPT AND WHAT IS NOT ==================
 * These rules apply to the KEY-RUN hints - a line built out of "<key> to
 * <verb>" clauses. `warp.hint` is a whole SENTENCE that teaches a mechanic and
 * names no key at all, so rules 1 and 3 exempt it by their own predicates
 * rather than by an allowlist, and UR-81's sentence-case decision stands.
 *
 * ================== WATCH THEM FAIL ==================
 * Every message below was READ OFF A RED RUN, with the pre-UR-144 copy in the
 * three tables:
 *
 *   npx vitest run tests/unit/ui/hint.test.ts --coverage.enabled=false
 *
 *   "a hint that names a direction names it as a KEY"
 *     AssertionError: expected [ ...(4) ] to deeply equal []
 *     +   "ui.common.hintKeys: \"Arrows to move · enter to choose · esc to go back\"",
 *     +   "ui.common.hintAdjust: \"Left and Right to Change\"",
 *     +   "map.hint: \"Left and right to choose a stop, enter to fly\"",
 *     +   "results.hint: \"Arrows to move · enter to choose\"",
 *
 *   "a multi-key hint separates its clauses with ·, never a comma"
 *     AssertionError: expected [ Array(1) ] to deeply equal []
 *     +   "map.hint: \"Left and right to choose a stop, enter to fly\"",
 *
 *   "every clause of an English hint opens with a capital"
 *     AssertionError: expected [ ...(4) ] to deeply equal []
 *     +   "ui.common.hintKeys: \"enter to choose\"",
 *     +   "ui.common.hintKeys: \"esc to go back\"",
 *     +   "preflight.hint: \"esc to go back\"",
 *     +   "results.hint: \"enter to choose\"",
 *
 *   "a hint says what the ACTION does, not what the widget is called"
 *     AssertionError: expected 1 to be greater than 1
 *
 *   "Ship Controls says how to leave, in every language"
 *     AssertionError: en/ui.common.hintAdjust names no way out: expected
 *     'Left and Right to Change' to match /esc|एस्केप/i
 *
 *   "the shared hints have the same shape in all three languages"
 *     AssertionError: es/ui.common.hintAdjust clause count: expected 3 to be 1
 *     (the English line was the one reverted for that run; the same case
 *     reports `hi/...` when Hindi is the table left behind.)
 */
describe("UR-144: a hint names the key and the action", () => {
  /** The separator every hint line in this product uses between clauses. */
  const SEP = " · ";

  /** Every hint key a screen actually declares, deduplicated. */
  const HINT_KEYS: readonly string[] = [
    ...new Set(
      SCREEN_HINTS.filter((r) => r.hintKey !== null).map((r) => r.hintKey as string),
    ),
  ];

  /**
   * Words that are a DIRECTION on their own and a key only when "key" is
   * beside them. `up`/`down` are here as whole words: "up" inside "Warm Up
   * Your Hands" is not this defect, so the match is word-bounded.
   */
  const BARE_DIRECTION = /\b(arrow|arrows|left|right|up|down)\b/i;
  /** Names of keys that are printed on the keycap and need no "key" after them. */
  const SELF_NAMING_KEY = /\b(enter|esc|escape|tab|space|backspace)\b/i;

  const clausesOf = (line: string): string[] => line.split(SEP);

  it("a hint that names a direction names it as a KEY", () => {
    // Rule 1. A line that says "Left" must say "Left/Right Keys"; a line that
    // says nothing directional (`warp.hint`, `preflight.hint`) is not covered
    // by this rule at all, which is why there is no allowlist here.
    const offenders = HINT_KEYS.filter((key) => {
      const line = copy(key);
      return BARE_DIRECTION.test(line) && !/\bkeys?\b/i.test(line);
    }).map((key) => `${key}: "${copy(key)}"`);
    expect(offenders).toEqual([]);
  });

  it("a multi-key hint separates its clauses with ·, never a comma", () => {
    // The map's line was the odd one out - one comma where nine other lines
    // used the separator - which is the kind of thing only a sweep sees.
    const offenders = HINT_KEYS.filter((key) => {
      const line = copy(key);
      const keysNamed =
        (BARE_DIRECTION.test(line) ? 1 : 0) + (SELF_NAMING_KEY.test(line) ? 1 : 0);
      return keysNamed >= 2 && (line.includes(",") || !line.includes(SEP));
    }).map((key) => `${key}: "${copy(key)}"`);
    expect(offenders).toEqual([]);
  });

  it("every clause of an English hint opens with a capital", () => {
    // A hint line made of key names is a LABEL RUN, and the house rule is
    // Title Case for labels. `warp.hint` is one clause and a sentence, so it
    // passes on its own first letter without being recased.
    const offenders: string[] = [];
    for (const key of HINT_KEYS) {
      for (const clause of clausesOf(copy(key))) {
        const first = clause.trim().charAt(0);
        if (first !== "" && first !== first.toLocaleUpperCase()) {
          offenders.push(`${key}: "${clause}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a hint says what the ACTION does, not what the widget is called", () => {
    // NEGATIVE CONTROL for rule 2, on the line that was reported. "Change" is
    // still the right word for a knob row - it is what the player's press DOES
    // there - but it may not be the WHOLE line, because a line that names only
    // the widget's job tells a child nothing about the screen.
    expect(teachesSomethingNew("Left and Right to Change", ["Back"])).toBe(true);
    // ...and the real defect: the old line was three words long and two of
    // them were key directions, so it taught exactly one word.
    expect(significantWords("Left and Right to Change")).toEqual(["change"]);
    expect(
      significantWords(UI_TABLES.en["ui.common.hintAdjust"]).length,
    ).toBeGreaterThan(1);
  });

  it("Ship Controls says how to leave, in every language", () => {
    // This screen draws no Back button (`SettingsScene` renders none, though
    // `SCREEN_HINTS` lists `common.back` among its actions), so the hint line
    // is the ONLY place the way out is written down.
    for (const lang of ["en", "es", "hi"] as const) {
      const line = UI_TABLES[lang]["ui.common.hintAdjust"];
      expect(line, `${lang}/ui.common.hintAdjust names no way out`).toMatch(
        /esc|एस्केप/i,
      );
    }
  });

  it("the shared hints have the same shape in all three languages", () => {
    // A translation that drops a clause drops an instruction. Hindi's adjust
    // line was one clause against English's three before this sweep.
    for (const key of [
      "ui.common.hintKeys",
      "ui.common.hintAdjust",
      "ui.pick.hint",
    ] as const) {
      const expected = clausesOf(UI_TABLES.en[key]).length;
      for (const lang of ["es", "hi"] as const) {
        expect(
          clausesOf(UI_TABLES[lang][key]).length,
          `${lang}/${key} clause count`,
        ).toBe(expected);
      }
    }
  });
});

/**
 * UR-146 - THE PILOT PICKER'S REMOVE SHORTCUT HAD NO AFFORDANCE AT ALL.
 *
 * The owner could not delete a profile and concluded the feature was missing.
 * `ProfilePickerScene.extraKey` has taken Delete/Backspace on a focused pilot
 * row since the screen landed; the screen says so nowhere, and it renders no
 * Remove button either (`ui.pick.remove` is drawn on no scene).
 *
 * UR-84 was right to delete the second, fainter line that used to name it -
 * 2.82:1 against the backdrop, under AC-22.8's 4.5:1, explaining a DESTRUCTIVE
 * action in the least readable copy on the screen. Stopping there was the
 * mistake. The shortcut is named on the ONE plated hint line now, which is the
 * treatment that clears 4.5:1 (see `ui/hintLine.ts`).
 *
 * WATCHED FAILING, with `SCREEN_HINTS` put back to `ui.common.hintKeys` for
 * the picker and `ui.pick.hint` removed from the tables:
 *
 *   "only the picker's hint names Delete - it does nothing on the others"
 *     expected [] to deeply equal [ 'ProfilePickerScene.ts' ]
 *
 *   "the picker still teaches something its buttons do not"
 *     expected 'ui.common.hintKeys' to be 'ui.pick.hint'
 *
 * (The tables themselves are typed: deleting `ui.pick.hint` from `UI_EN` is a
 * COMPILE error in `UI_ES`/`UI_HI`, so the red run above is the one reachable
 * by putting the picker's row back to the shared key.)
 */
describe("UR-146: removing a pilot is discoverable", () => {
  /** The keycap name for the remove shortcut, per language. */
  const REMOVE_KEY: Record<string, RegExp> = {
    en: /\bdelete\b/i,
    // "Supr" is what the key is labelled on a Spanish keyboard.
    es: /\bsupr\b/i,
    hi: /डिलीट/,
  };

  it("the picker's hint names the key that removes a pilot", () => {
    for (const lang of ["en", "es", "hi"] as const) {
      expect(UI_TABLES[lang]["ui.pick.hint"], `${lang}/ui.pick.hint`).toMatch(
        REMOVE_KEY[lang] as RegExp,
      );
    }
  });

  it("and names the ACTION, in the same word the confirm dialog uses", () => {
    // A key name on its own is the UR-84 line again: it says which key without
    // saying what happens. The verb has to match the dialog the key opens.
    expect(UI_TABLES.en["ui.pick.hint"]).toContain("Remove");
    expect(UI_TABLES.en["ui.pick.removeYes"]).toContain("Remove");
    expect(UI_TABLES.es["ui.pick.hint"]).toContain("borrar");
    expect(UI_TABLES.hi["ui.pick.hint"]).toContain("हटाओ");
    expect(UI_TABLES.hi["ui.pick.removeYes"]).toContain("हटाओ");
  });

  it("only the picker's hint names Delete - it does nothing on the others", () => {
    // `ui.common.hintKeys` is rendered by four screens and Delete removes a
    // pilot on exactly one of them. `results.hint` already carries this rule in
    // its own comment: a hint that names a key which does nothing is worse than
    // no hint.
    const naming = SCREEN_HINTS.filter(
      (r) => r.hintKey !== null && /\bdelete\b/i.test(copy(r.hintKey)),
    ).map((r) => r.file);
    expect(naming).toEqual(["ProfilePickerScene.ts"]);
  });

  it("the picker still teaches something its buttons do not", () => {
    // UR-56's rule, on the longer line. "New Pilot" is on a button; "Remove"
    // is on nothing, which is the whole reason this line grew.
    const row = SCREEN_HINTS.find((r) => r.file === "ProfilePickerScene.ts");
    expect(row?.hintKey).toBe("ui.pick.hint");
    expect(
      teachesSomethingNew(copy("ui.pick.hint"), (row?.actionKeys ?? []).map(copy)),
    ).toBe(true);
    // It shares "pilot" with the New Pilot button, which the rule allows and
    // which is the point of the rule being about the whole line rather than
    // about any one word. What it must NOT share is the verb, because the verb
    // is the thing no control on this screen says:
    expect(repeatedWords(copy("ui.pick.hint"), copy("ui.pick.newPilot"))).toEqual([
      "pilot",
    ]);
    const onScreen = (row?.actionKeys ?? []).flatMap((k) => significantWords(copy(k)));
    expect(onScreen).not.toContain("remove");
    expect(significantWords(copy("ui.pick.hint"))).toContain("remove");
  });
});

/**
 * UR-146 - A FULL STOP ENDS A SENTENCE, SO THE NEXT ONE GETS A CAPITAL.
 *
 * ================== WHAT WAS REPORTED ==================
 * The owner, on the picker's confirm: "Remove {name}? their beacons go too."
 * The clause after the question mark starts lower case. The owner's standing
 * rule is Title Case for labels, sentence case for sentences - and sentence
 * case means the sentence starts with a capital.
 *
 * ================== IT WAS NOT A SLIP, WHICH IS WHY THIS SWEEPS ==================
 * Nineteen strings across three tables had it, in English and in Spanish, and
 * `scenes/support/copy.ts` documented it as "the house convention and not a
 * preference" - citing two of the very strings the owner has now called wrong.
 * There was no entry for it in `docs/decision-log.md`, so the standing rule
 * wins and the convention is gone. A one-string fix would have left eighteen.
 *
 * ================== WATCH IT FAIL ==================
 * With the three tables as they were before this sweep:
 *
 *   "no shipped string starts a sentence in lower case"
 *     expected [ 'UI_en/ui.pick.removeAsk', 'UI_en/ui.log.emptyShadow',
 *     'UI_en/ui.settings.resetAsk1', 'UI_en/ui.settings.resetDone',
 *     'UI_en/ui.notice.repaired', 'UI_es/ui.pick.removeAsk',
 *     'UI_es/ui.log.emptyShadow', 'UI_es/ui.settings.resetAsk1',
 *     'UI_es/ui.settings.resetDone', 'UI_es/ui.pause.quitAsk',
 *     'UI_es/ui.notice.repaired', 'LANE_en/warp.beltClear',
 *     'LANE_en/warp.charged', 'LANE_en/warp.hint',
 *     'LANE_en/beacon.calibrating' ] to deeply equal []
 */
describe("UR-146: sentence case means the sentence starts with a capital", () => {
  /**
   * A lower-case letter directly after terminal punctuation and a space.
   * Latin-script only: Devanagari has no case, so Hindi cannot fail this and
   * is not exempted from it either - the predicate simply never matches.
   */
  const MID_SENTENCE_LOWER = /[.?!]\s+[a-zà-öø-ÿ]/u;

  /** The tables a player actually reads, by name. */
  const TABLES: ReadonlyArray<[string, Readonly<Record<string, string>>]> = [
    ["UI_en", UI_TABLES.en],
    ["UI_es", UI_TABLES.es],
    ["UI_hi", UI_TABLES.hi],
    ["LANE_en", LANE_COPY_EN],
    ["content_en", UI_EN.strings as Record<string, string>],
    ["ENGINE_en", EN as unknown as Record<string, string>],
  ];

  it("no shipped string starts a sentence in lower case", () => {
    const offenders: string[] = [];
    for (const [name, table] of TABLES) {
      for (const [key, value] of Object.entries(table)) {
        // "Pilot... that's you." - an ellipsis is a PAUSE inside one sentence,
        // not the end of one, so it is excluded by shape rather than by key.
        if (value.includes("...")) continue;
        if (MID_SENTENCE_LOWER.test(value)) offenders.push(`${name}/${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE CONTROL: the rule catches the line that was reported", () => {
    expect(MID_SENTENCE_LOWER.test("Remove {name}? their beacons go too.")).toBe(true);
    expect(MID_SENTENCE_LOWER.test("Remove {name}? Their beacons go too.")).toBe(false);
    // ...and the second one the owner named, which also had a lower-case
    // proper noun in it.
    expect(MID_SENTENCE_LOWER.test("Only earth is lit. six more are waiting for us."))
      .toBe(true);
  });

  it("Earth is a place, so it is capitalised inside a sentence", () => {
    // The other half of `ui.log.emptyShadow`. The lower-case `ui.stop.earth`
    // label is D41 chrome and stays; a planet inside a sentence is a name.
    for (const key of ["ui.log.emptyShadow", "ui.settings.resetDone"] as const) {
      expect(UI_TABLES.en[key], key).not.toMatch(/\bearth\b/);
      expect(UI_TABLES.en[key], key).toMatch(/Earth/);
    }
    // Spanish capitalises the planet inside a sentence too, and keeps the
    // lower-case label.
    expect(UI_TABLES.es["ui.log.emptyShadow"]).toContain("Tierra");
    expect(UI_TABLES.es["ui.stop.earth"]).toBe("tierra");
  });
});
