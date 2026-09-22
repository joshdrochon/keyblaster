import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SETTINGS, LANGS, type Settings } from "@engine/types";
import { DEVANAGARI_INPUT_METHODS } from "@engine/i18n";
import { STORAGE_KEY, createProfileStore } from "@engine/persistence/index.js";
import { resolveContentLang } from "@engine/i18n";
import { FakeClock, FakeStorage } from "../persistence/fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../src");
const scene = readFileSync(path.join(SRC, "game/scenes/SettingsScene.ts"), "utf8");

/**
 * TWO CONTROLS THAT COULD NOT CHANGE ANYTHING ARE OFF THE SCREEN - AND THE
 * SAVE FILE IS UNTOUCHED.
 *
 * ================== WHAT WAS REMOVED ==================
 * `settings.inputMethod` ("How You Type Hindi") and `settings.contentLang`
 * ("Typing Language"). Both wrote a value that reached the profile and nothing
 * else.
 *
 * MEASURED AGAINST THIS TREE rather than taken from the report, because the
 * report's wording ("zero readers anywhere in src/") is not quite what is true
 * and the difference matters:
 *
 *   contentLang  `FlightScene` DOES read `cfg.contentLang` - for the allowlist,
 *                the word book and the audio bed. But neither route into the
 *                belt carries it: `PreflightScene.complete` and
 *                `ResultsScene.replay` hand over `{ctx, progress, shipName,
 *                lang, stopId}`, and `lang` is not a `FlightConfig` key, so
 *                `flightConfigFrom` falls back to `DEFAULT_FLIGHT_CONFIG` on
 *                every real launch. Logged as collision C14 before this lane.
 *   inputMethod  the same break one field over. `FlightScene` builds
 *                `createWordMatcher(this.cfg.inputMethod)` and `LockOptions`
 *                now really does consume a matcher - so the "OPEN SEAM" note
 *                beside that call is STALE and the reader is live. It is fed
 *                `DEFAULT_SETTINGS.inputMethod` on every real launch for the
 *                identical reason.
 *
 * So: there ARE readers of the FlightConfig fields, and there are no readers of
 * the SETTING. A reader fed a constant is not a reader. Both rows were controls
 * that could not change anything a child can see, and `inputMethod` was
 * additionally a control for typing a language D95 cut from the shipped menu.
 *
 * ================== WHAT WAS DELIBERATELY NOT REMOVED ==================
 * The persisted schema. `Settings.inputMethod` and `Settings.contentLang` still
 * exist, still decode, still encode and are still repaired on the way in. The
 * project owner has been explicit about this distinction: a previous lane
 * over-scoped a removal into the schema and was pulled back to UI-only, because
 * keeping a field costs nothing and a migration costs a save file.
 *
 * This file asserts BOTH halves, because a removal that is correct on one and
 * wrong on the other is the failure the instruction is about.
 */

/** Seed raw bytes, then read them back the way a reload does. */
function decoded(raw: unknown): Settings | null {
  const storage = new FakeStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(raw));
  const store = createProfileStore({ storage, clock: new FakeClock() });
  return store.activeProfile()?.settings ?? null;
}

describe("the two dead rows are off the SCREEN", () => {
  it("neither control is built any more", () => {
    // WATCHED FAILING. With the two `left.push(new SelectorRow<...>)` blocks
    // restored, this read:
    //   AssertionError: SettingsScene still builds settings.inputMethod
    //   expected true to be false
    expect(
      scene.includes('"settings.inputMethod"'),
      "SettingsScene still builds settings.inputMethod",
    ).toBe(false);
    expect(
      scene.includes('"settings.contentLang"'),
      "SettingsScene still builds settings.contentLang",
    ).toBe(false);
  });

  it("AC-14.1's unactionable note goes with them", () => {
    // After D95 it fired for every player on every input method: it told a
    // child to pick a Hindi keyboard to unlock a language the build does not
    // ship. It was already unactionable; now it is absent.
    expect(scene).not.toContain("settings.contentLangUnavailable");
    expect(scene).not.toContain("availableContentLangs");
  });

  it("the rows that DO reach something are still here", () => {
    // The bar is "a control that cannot change anything", not "a control in a
    // language the build does not ship". `keyboardLayout` reaches the lock
    // machine and `uiLang` has readers throughout, so both stay.
    expect(scene).toContain('"settings.keyboardLayout"');
    expect(scene).toContain('"settings.uiLang"');
  });

  it("the string table keeps the copy, so restoring a row is not a translation job", () => {
    // D95's own rule, applied to this removal: cut the code off, do not rip it
    // out. Three languages of copy for a row a future lane puts back when
    // C14's pipeline is repaired.
    const engineStrings = readFileSync(path.join(SRC, "engine/i18n/strings.ts"), "utf8");
    for (const key of [
      "settings.inputMethod",
      "settings.contentLang",
      "settings.contentLangUnavailable",
    ]) {
      expect(engineStrings, `${key} was deleted from the string table`).toContain(key);
    }
  });
});

describe("the two dead FIELDS are untouched in the save", () => {
  it("both are still in the shipped Settings type and its defaults", () => {
    expect(DEFAULT_SETTINGS.inputMethod).toBe("latin");
    expect(DEFAULT_SETTINGS.contentLang).toBe("en");
    // The input-method SET is still the engine's, not narrowed to the one the
    // removed row could produce.
    expect(DEVANAGARI_INPUT_METHODS.length).toBeGreaterThan(0);
    expect(LANGS.length).toBe(3);
  });

  it("a save carrying either value round-trips it unchanged", () => {
    // The whole point of UI-only: a pilot whose profile says `inscript` keeps
    // saying `inscript` after this change, so putting the row back is putting a
    // row back rather than recovering a lost value.
    const storage = new FakeStorage();
    const store = createProfileStore({ storage, clock: new FakeClock() });
    const created = store.createProfile({ name: "Ana" });
    store.selectProfile(created.id);
    store.updateSettings(created.id, {
      ...DEFAULT_SETTINGS,
      inputMethod: "inscript",
      contentLang: "hi",
    });
    store.flush();

    const second = createProfileStore({ storage, clock: new FakeClock() });
    const back = second.activeProfile()?.settings;
    expect(back?.inputMethod).toBe("inscript");
    expect(back?.contentLang).toBe("hi");
  });

  it("the decoder still validates them rather than passing anything through", () => {
    const settings = decoded({
      version: 3,
      activeProfileId: "p1",
      profiles: [
        {
          id: "p1",
          name: "Ana",
          settings: { inputMethod: "nonsense", contentLang: 42 },
        },
      ],
    });
    expect(settings?.inputMethod).toBe(DEFAULT_SETTINGS.inputMethod);
    expect(settings?.contentLang).toBe(DEFAULT_SETTINGS.contentLang);
  });

  it("the AC-14.1 pair repair still runs, and the screen still calls it", () => {
    // The row is gone; the repair is not. A stored profile can still carry
    // { contentLang: "hi", inputMethod: "latin" } - a pair the engine can
    // produce - and the first screen that can see both still fixes it.
    expect(resolveContentLang("hi", "latin", "en")).not.toBe("hi");
    expect(scene).toContain("repairLanguagePair");
    expect(scene).toContain("resolveContentLang");
  });

  it("NEGATIVE CONTROL: the schema really would report a missing field", () => {
    // Without this, "the fields survived" could mean the decoder is not
    // looking at them at all.
    const settings = decoded({
      version: 3,
      activeProfileId: "p1",
      profiles: [{ id: "p1", name: "Ana", settings: { inputMethod: "translit" } }],
    });
    expect(settings?.inputMethod).toBe("translit");
  });
});
