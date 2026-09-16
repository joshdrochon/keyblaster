/**
 * The shared UI kit (design brief 13, D37, AC-18.1).
 *
 * Other lanes import from the individual modules - `@game/ui/theme` is the one
 * that is load-bearing outside this lane - so nothing here is required; this is
 * a map of what exists and what each piece is for.
 *
 * WHAT IS DELIBERATELY NOT HERE. There is no palette module and no Shadow
 * module in this folder. Both existed as stand-ins while `src/game/render/` was
 * empty, and both were deleted the moment the render lane landed: `paletteFor`
 * / `paletteAt` / `hexToNum` come from `@game/render/palette`, and `drawShadow`
 * from `@game/render/shadow`. A second Shadow is not a duplicate helper, it is
 * a second CHARACTER (D91 says he has one look), and the reference compare
 * R-shadow only judges the render one - so a copy here would be an unjudged
 * Shadow on four screens. `G-one-shadow` now fails the build if one comes back.
 *
 *   theme.ts          design tokens: type scale, ink, spacing, easing curves,
 *                     the MEASURED Devanagari line height, and the D41 letter
 *                     case / letter spacing helpers
 *   text.ts           one text factory, so the three typography settings are
 *                     applied in exactly one place
 *   chrome.ts         vector menu parts: backdrop, plate, focus ring, ship,
 *                     avatar, beacon, trophy
 *   focus.ts          the keyboard focus list and the shared key map
 *   controls.ts       button, list row, tile, toggle, slider, option, text field
 *   dialog.ts         the in-game confirm - never `window.confirm`
 *   toast.ts          non-blocking unlock toasts, usable from any scene
 *   mirror.ts         the off-screen DOM shadow that makes a canvas screen
 *                     legible to a screen reader and assertable by Playwright
 *   strings.ts        this lane's menu copy in en/es/hi
 *   i18n.ts           merges that with the engine table into one translator
 *   catalog.ts        ships, skins, avatars and the twelve trophies
 *   app.ts            the lane's view of boot's services + the settings writer
 *   MenuScene.ts      the base every screen in this lane extends
 */

export * from "./theme.js";
export * from "./text.js";
export * from "./focus.js";
export * from "./mirror.js";
export * from "./chrome.js";
export * from "./controls.js";
export * from "./dialog.js";
export * from "./toast.js";
export * from "./catalog.js";
export * from "./strings.js";
export * from "./i18n.js";
export * from "./app.js";
export { MenuScene } from "./MenuScene.js";
