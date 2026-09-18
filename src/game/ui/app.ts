import Phaser from "phaser";
import { type GameServices, services } from "@game/boot";
import type { Notice } from "@engine/persistence";
import { isShipped, resolveContentLang } from "@engine/i18n";
import { equipShip as equipShipOnProfile } from "@engine/unlocks/index.js";
import {
  DEFAULT_SETTINGS,
  type Profile,
  type Settings,
  type StopId,
} from "@engine/types";
import { type MenuTranslator, createMenuTranslator } from "./i18n.js";
import { type StopPalette, paletteAt } from "@game/render/palette";
import type { ControlStyle } from "./controls.js";

/**
 * The menu lane's view of the game-layer services.
 *
 * PERSISTENCE IS WIRED IN `boot.ts`, NOT HERE. `src/engine/persistence` is
 * DOM-free by construction and takes an injected `StoragePort` and `Clock`;
 * boot supplies the real `window.localStorage`, `Date.now` and
 * `window.setTimeout`, and registers the flush-on-hide / close-on-unload
 * listeners the module's own doc comment asks for. A second `createProfileStore`
 * in this file would be a second writer over one localStorage key, and the two
 * debounced writers would race - last flush wins, and a child loses a belt's
 * worth of word history. So this module READS boot's store and never makes one.
 *
 * What it adds on top is menu-specific: the merged string table (the engine's
 * `StringKey` union has no key for a trophy or a pause menu), the settings
 * write path with its AC-14.1 repair, and the AC-18.4 notice line.
 */

export interface App {
  readonly services: GameServices;
  profile(): Profile | null;
  /** The active profile's settings, or the shipped defaults (no profile yet). */
  settings(): Settings;
  /** Bound to the active UI language and to `{shipName}` (C07). */
  t(): MenuTranslator;
  /** Typography + accent for the control kit, from the live settings. */
  style(stopId?: StopId): ControlStyle;
  palette(stopId?: StopId): StopPalette;
  /**
   * Write a settings patch and have it take effect immediately - AC-19.1 is
   * "persists AND takes effect without a reload", so this both stores the value
   * and rebuilds the things that read it. Returns what was actually stored,
   * which can differ from the patch when AC-14.1 repairs the language pair.
   */
  applySettings(patch: Partial<Settings>): Settings;
  /**
   * Wear an earned hull, and keep it (UR-48; D79, AC-6d.1b).
   *
   * Returns the id actually worn afterwards, which is NOT always the one asked
   * for: `@engine/unlocks.equipShip` refuses a hull this pilot does not hold,
   * and this returns what the profile ended up with rather than echoing the
   * request back. A caller that trusted its own argument would report a locked
   * ship as equipped.
   *
   * Flushes, for the reason `applySettings` flushes: the store's write is
   * debounced by 250 ms and a hull a child earned must survive the tab closing
   * a second later. That is the half of the round trip a value assertion cannot
   * see, and `tests/unit/unlocks/equip.test.ts` runs the whole chain -
   * value, store, serialize, second store, read back.
   */
  equipShip(shipId: string): string | null;
  /** One calm line about the load, or null (AC-18.4). Returned once per page. */
  takeNoticeText(): string | null;
}

/** Cached per language + ship name; rebuilt only when one of those changes. */
let cached: { key: string; translator: MenuTranslator } | null = null;

/** The AC-18.4 notice is shown once per page load, on the first screen up. */
let noticeConsumed = false;

export function appFor(scene: Phaser.Scene): App {
  const bundle = services(scene);
  const store = bundle.store;

  const app: App = {
    services: bundle,
    profile: () => store.activeProfile(),
    settings: () => store.activeProfile()?.settings ?? DEFAULT_SETTINGS,

    t(): MenuTranslator {
      const profile = store.activeProfile();
      const lang = profile?.settings.uiLang ?? bundle.t.lang;
      const shipName = profile?.shipName ?? "";
      const key = `${lang}|${shipName}`;
      if (cached?.key !== key) {
        cached = { key, translator: createMenuTranslator(lang, shipName) };
      }
      return cached.translator;
    },

    style(stopId): ControlStyle {
      const s = app.settings();
      return {
        lang: s.uiLang,
        uppercase: s.uppercase,
        increasedLetterSpacing: s.increasedLetterSpacing,
        accent: app.palette(stopId).accent,
      };
    },

    palette(stopId = "earth"): StopPalette {
      // The URL flag wins over the profile so a visual-evidence run can force
      // the colourblind variant without editing a save (boot builds `context`).
      const colorblind =
        bundle.context.colorblindPalette || app.settings().colorblindPalette;
      return paletteAt(stopId, colorblind);
    },

    applySettings(patch): Settings {
      const profile = store.activeProfile();
      if (!profile) return DEFAULT_SETTINGS;
      const merged: Settings = { ...profile.settings, ...patch };
      // AC-14.1 repair. A stored profile can carry
      // { contentLang: "hi", inputMethod: "latin" } - a pair the engine can
      // produce and nothing else repairs - so it is fixed on EVERY write, not
      // only when the input-method row is touched. Identity is meaningful here:
      // when resolveContentLang returns the same value, nothing was repaired
      // and the screen has nothing to tell the player.
      // D95 repair, and it must come FIRST: resolveContentLang falls back to
      // uiLang, so an unshipped uiLang would otherwise be handed straight back
      // as the content language. A profile saved before the cut carries
      // uiLang: "es", and nothing repaired it - the row rendered "english"
      // (findIndex returned -1, clamped to 0) while the game stayed in
      // Spanish, which is the one thing AC-19.1 is about.
      if (!isShipped(merged.uiLang)) merged.uiLang = "en";
      merged.contentLang = resolveContentLang(
        merged.contentLang,
        merged.inputMethod,
        merged.uiLang,
      );
      const updated = store.updateSettings(profile.id, merged);
      // AC-19.1 "without a reload": push the change into everything that is
      // already on screen. The context is what other lanes' scenes read for
      // reduced motion and the colourblind palette; setLang rebuilds the shared
      // engine translator and re-emits `kb.lang` for scenes already open.
      bundle.context.reducedMotion = merged.reducedMotion;
      bundle.context.colorblindPalette = merged.colorblindPalette;
      if (bundle.t.lang !== merged.uiLang) bundle.setLang(merged.uiLang);
      cached = null;
      // A settings change is worth keeping even if the tab dies next second.
      store.flush();
      return updated?.settings ?? merged;
    },

    equipShip(shipId): string | null {
      const profile = store.activeProfile();
      if (!profile) return null;
      // The guard is the ENGINE's, not this function's. A refusal written here
      // would be a second copy of "is this hull held?" that a second caller
      // could skip, which is the arrangement that lost `crossDrift` and lost
      // keep-clear twice. `equipShip` returns the same object when it refuses.
      const next = equipShipOnProfile(profile, shipId);
      if (next === profile) return profile.shipId;
      const updated = store.updateProfile(profile.id, () => next);
      store.flush();
      return updated?.shipId ?? profile.shipId;
    },

    takeNoticeText(): string | null {
      if (noticeConsumed) return null;
      noticeConsumed = true;
      return noticeTextFor(store.notices, app.t());
    },
  };

  return app;
}

/**
 * AC-18.4: "corrupt storage yields a fresh profile plus a non-blocking notice -
 * render that notice calmly, one line."
 *
 * ONE line, never a list of codes, and nothing that reads as the child's fault.
 * `empty` and `migrated` produce NOTHING: a first run and a schema upgrade are
 * not events a nine-year-old needs told about, and a notice that fires on every
 * clean first launch teaches everyone to ignore the notice that matters.
 */
export function noticeTextFor(
  notices: readonly Notice[],
  t: MenuTranslator,
): string | null {
  const codes = new Set(notices.map((n) => n.code));
  if (
    codes.has("unreadable") ||
    codes.has("invalid-json") ||
    codes.has("wrong-shape") ||
    codes.has("future-version") ||
    codes.has("unmigratable") ||
    codes.has("quarantined")
  ) {
    return t.t("ui.notice.fresh");
  }
  if (codes.has("repaired")) return t.t("ui.notice.repaired");
  if (codes.has("write-failed")) return t.t("ui.notice.writeFailed");
  return null;
}

/** Test seam: forget the cached translator and the one-shot notice. */
export function resetApp(): void {
  cached = null;
  noticeConsumed = false;
}
