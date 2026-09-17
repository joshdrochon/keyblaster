import type Phaser from "phaser";
import { services } from "@game/boot";

/**
 * D41'S TWO TYPOGRAPHY SETTINGS, ON THE STORY SCREENS (UR-38).
 *
 * ================== THE DEFECT ==================
 * "uppercase" and "increased letter spacing" are accessibility settings. They
 * have a control on the Settings console, they validate, they persist, and they
 * survive a reload. On the nine STORY screens they did nothing at all:
 *
 *   grep -c increasedLetterSpacing src/game/scenes/*.ts
 *     -> 0 in Briefing, Preflight, Warp, Beacon, Results, Map, Title,
 *        EarthActivation, Ending, Stall, Hud
 *     -> 2-8 in the menu scenes
 *
 * Verified live by a blind critic with both flags true and persisted across a
 * reload: the Earth briefing body stayed at w=728 and the Title still rendered
 * lowercase. The feature worked only on the screens where somebody remembered
 * to wire it, which is the half of the product a child spends the least time in.
 *
 * This is a game for 7-to-11 year olds including struggling readers, and
 * increased letter spacing is in D41 because of Zorzi et al. (2012) - it is a
 * reading intervention, not a preference. Shipping it dead on the screens that
 * carry the prose is the worst possible half of it to ship dead.
 *
 * ================== WHY IT LIVES HERE ==================
 * The menu lane solved this once: `ui/text.uiText` takes the style and applies
 * both settings, and `MenuScene` threads it from `app.style()`. The story lane
 * has its own text factory (`lib/kit.label`) and it took neither. Rather than
 * thread a style object through eleven scenes - eleven chances to forget, which
 * is how this happened - the factory asks for the settings itself, once, here.
 *
 * `tests/unit/arch/settingReaders.test.ts` is the part that matters: it asserts
 * every presentation setting has a live reader on a RENDERING path, which is
 * the check `profileWriters.test.ts` does not make (it asks whether a persisted
 * field has a writer, not whether anything draws with it).
 */

export interface Typography {
  /** D41 letter case. CHROME ONLY - never a pilot name or a ship name. */
  readonly uppercase: boolean;
  /** D41 increased letter spacing (Zorzi et al. 2012). Applies to all copy. */
  readonly increasedLetterSpacing: boolean;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  uppercase: false,
  increasedLetterSpacing: false,
};

/**
 * The typography settings for this scene.
 *
 * NEVER THROWS. `services()` throws before `bootGame`, and a scene constructed
 * in a unit test or a harness has no store; a text factory that threw there
 * would make every screen unrenderable outside the real game. The defaults are
 * the shipped defaults, so the fallback is the off state rather than a guess.
 *
 * NOT CACHED, and that is deliberate. The first version memoised on
 * `scene.data`, which SURVIVES `scene.restart()` - so a screen that re-created
 * itself after the setting changed redrew with the value it had at boot, and
 * the live check showed the briefing identical with the flag on and off. That
 * is the same class of bug as the one this module exists to fix (a setting with
 * no live consumer), reintroduced one layer down. `activeProfile()` is an
 * in-memory read and `label()` is a create-time call; there is nothing here
 * worth the risk of a stale copy.
 */
export function typographyOf(scene: Phaser.Scene): Typography {
  try {
    const settings = services(scene).store.activeProfile()?.settings;
    if (settings === undefined) return DEFAULT_TYPOGRAPHY;
    return {
      uppercase: settings.uppercase,
      increasedLetterSpacing: settings.increasedLetterSpacing,
    };
  } catch {
    // No boot, no store, no profile: the shipped defaults.
    return DEFAULT_TYPOGRAPHY;
  }
}
