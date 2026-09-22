import type { MenuKey } from "./i18n.js";
import { INK } from "./theme.js";

/**
 * THE DASH COLOUR: WHAT SHIP CONTROLS IS DRESSED IN, AND WHO PICKS IT
 * (UR-123; D41, AC-19.1, AC-22.8).
 *
 * ================== TWO REPORTS, ONE ANSWER ==================
 * The project owner made two separate points about this screen and they turned
 * out to be the same point.
 *
 *   1. Ship Controls has no colour identity of its own. `MenuScene.paletteStop`
 *      returns `"earth"` for every menu, so the one screen that is not a PLACE
 *      on the route was wearing the launchpad's amber because it had nothing
 *      else to wear.
 *   2. The hull picker's neighbours on this panel are all settings, and the
 *      screen wanted a control that is about the ship the pilot is sitting in.
 *
 * A screen that needs an accent and a pilot who wants to dress their cockpit
 * are answered by one thing. So the dash colour is not a decoration that also
 * happens to be stored: it IS this screen's accent (`SettingsScene.accentOverride`),
 * which means it is drawn on every knob arc, every position lamp, every chevron
 * and every value behind glass on the panel, and it lights the cabin light
 * falling across the console face (`panel.dashLitSurface`). Nothing here is a
 * control with no reader - the defect that removed two rows from this same
 * screen in the same change.
 *
 * ================== WHY A SMALL NAMED SET AND NOT A WHEEL ==================
 * Every value on this panel is printed in words behind glass, in the accent, at
 * 4.5:1 or better (AC-22.8). A continuous picker cannot promise that, cannot be
 * operated by Left/Right through the one focus list (AC-18.1), and cannot be
 * SPOKEN - a seven-year-old gets "amber", not "#FFC857". Six named colours are
 * six detents on a selector, which is hardware this panel already has.
 *
 * ================== WHY AMBER IS FIRST AND IS THE DEFAULT ==================
 * It is `INK.accent` to the byte, which is what this screen already wore. So a
 * save made before this control existed opens on exactly the colour it had, and
 * the feature costs nobody a changed screen they did not ask for.
 *
 * ================== THE BAR EVERY ENTRY CLEARS ==================
 * A colour may only join this list if, measured:
 *   - `readoutInk(c)` clears 4.5:1 on `PANEL.glass` (every value on the panel),
 *   - both `labelInk` answers clear 4.5:1 on `dashLitSurface(c)` (the cabin
 *     light the labels are read against).
 * Both are asserted as a cross product over this whole list in
 * `tests/unit/ui/cockpit.test.ts`, with a negative control, so an entry added
 * without checking turns the suite red rather than turning a label grey.
 *
 * Nothing here imports Phaser or the DOM.
 */

export interface DashColor {
  readonly id: string;
  readonly hex: string;
  readonly nameKey: MenuKey;
}

/**
 * Six instrument colours. Cool and warm are both represented, and no two are
 * adjacent in hue, so the set survives the colourblind palette as six distinct
 * LIGHTNESSES as well as six hues - the same rule `catalog.AVATARS` follows by
 * being six silhouettes rather than six tints.
 */
export const DASH_COLORS: readonly DashColor[] = [
  { id: "amber", hex: INK.accent, nameKey: "ui.settings.dash.amber" },
  { id: "teal", hex: "#5FE0C8", nameKey: "ui.settings.dash.teal" },
  { id: "coral", hex: "#FF9E7A", nameKey: "ui.settings.dash.coral" },
  { id: "sky", hex: "#8FC4FF", nameKey: "ui.settings.dash.sky" },
  { id: "lime", hex: "#C3E88D", nameKey: "ui.settings.dash.lime" },
  { id: "violet", hex: "#CBB2FF", nameKey: "ui.settings.dash.violet" },
];

/**
 * The colour a brand-new profile flies with: the one the screen already wore.
 *
 * UR-184: it is the SETTINGS PANEL's accent, not the cockpit's - every knob,
 * chip and ring on that screen reads it through `accentOverride`. So the
 * default is the screen's own gold, and a pilot who never turns the row sees
 * no change.
 *
 * Exported as an ID rather than a hex because it is what goes in the save, and
 * `@engine/types.DEFAULT_SETTINGS` holds the same string. They are held
 * together by `tests/unit/ui/dash.test.ts` rather than by both being typed out
 * correctly, because the engine may not import the game layer.
 */
export const DEFAULT_DASH_COLOR = "amber";

/**
 * The hex for a stored id.
 *
 * Falls back to the default rather than to a literal, so a save carrying an id
 * from a future palette - or one `decodeProfile` bounded down to something
 * unknown - lights the dashboard in the colour a new pilot gets instead of
 * handing `undefined` to the pen. Same rule as `hulls.equippedIndex`.
 */
export function dashHexOf(id: string): string {
  const found = DASH_COLORS.find((c) => c.id === id);
  if (found !== undefined) return found.hex;
  return DASH_COLORS.find((c) => c.id === DEFAULT_DASH_COLOR)?.hex ?? INK.accent;
}

/** Where the selector's cursor opens. 0 for an id this build does not ship. */
export function dashIndexOf(id: string): number {
  const i = DASH_COLORS.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i;
}
