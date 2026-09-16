/**
 * The shared UI kit (design brief 13, D37, AC-18.1).
 *
 * Other lanes import from the individual modules - `@game/ui/theme`,
 * `@game/ui/palette` - so nothing here is load-bearing; this is a map of what
 * exists and what each piece is for.
 *
 *   theme.ts          design tokens: type scale, ink, spacing, easing curves,
 *                     the MEASURED Devanagari line height, and the D41 letter
 *                     case / letter spacing helpers
 *   palette.ts        the seven stop palettes + `paletteFor(stopId)`
 *   text.ts           one text factory, so the three typography settings are
 *                     applied in exactly one place
 *   chrome.ts         vector menu parts: backdrop, plate, focus ring, ship,
 *                     avatar, beacon, trophy
 *   shadowPortrait.ts Shadow, six poses (stand-in for render/shadow.ts)
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
export * from "./palette.js";
export * from "./text.js";
export * from "./focus.js";
export * from "./mirror.js";
export * from "./chrome.js";
export * from "./controls.js";
export * from "./dialog.js";
export * from "./toast.js";
export * from "./shadowPortrait.js";
export * from "./catalog.js";
export * from "./strings.js";
export * from "./i18n.js";
export * from "./app.js";
export { MenuScene } from "./MenuScene.js";
