import type { Lang } from "@engine/types";

/**
 * The menu-chrome design tokens (art-direction.md sections 7 and 8).
 *
 * The world screens are dressed from a stop palette; the menus are dressed
 * from here, so Settings, the Beacon Log and Pause read as one instrument
 * cluster whichever planet you came from.
 */

/**
 * Type stack. Devanagari first so the browser picks a real Devanagari face
 * before falling through to the UI sans; a Latin-first stack makes Chrome
 * synthesise Devanagari from a fallback with the wrong metrics.
 *
 * D81 asks for Google Fonts with Devanagari support. Nothing in this lane may
 * add a network font (the game must be playable offline after first load,
 * NFR-2, and the e2e suite runs with no network), so the stack names the
 * platform Devanagari faces and degrades to the system UI sans.
 */
export const FONT_STACK =
  '"Noto Sans Devanagari","Kohinoor Devanagari","Devanagari Sangam MN","Nirmala UI",' +
  '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

/**
 * Line-height multipliers, MEASURED rather than assumed.
 *
 * Method: headless Chromium, canvas `measureText` against FONT_STACK at 32 px.
 * Ink box (actualBoundingBoxAscent + Descent):
 *   Latin  "Beacon Log Wgjpq"        24.32 + 7.07 = 31.39 px  (0.98 em)
 *   Spanish "Registro de balizas ñÁ" 30.43 + 6.98 = 37.41 px  (1.17 em)
 *   Hindi  "बीकन सूची हिंदी कीबोर्ड"        29.66 + 8.93 = 38.59 px  (1.21 em)
 *   Hindi conjuncts "क्षि र्ट्रैं ङ्क्ष्वी"        29.60 + 7.17 = 36.77 px  (1.15 em)
 *
 * Devanagari's ink box is 1.23x Latin's, because the shirorekha rises above
 * the Latin cap height and the matras hang below the Latin descender. Spanish
 * is 1.19x for the same reason at the top only (accented capitals). So one
 * multiplier covers both: rows get 20% more height off Latin whenever the UI
 * language is Devanagari, and the Latin line height already carries enough
 * slack for Spanish accents.
 *
 * This is a LINE HEIGHT, never a font size: shrinking Hindi to fit a Latin row
 * is the failure this exists to prevent.
 */
export const LINE_HEIGHT: Readonly<Record<"latin" | "devanagari", number>> = {
  latin: 1.3,
  devanagari: 1.56,
};

export function lineHeightEm(lang: Lang): number {
  return lang === "hi" ? LINE_HEIGHT.devanagari : LINE_HEIGHT.latin;
}

/** Row height in px for a control at `fontPx` in `lang`. */
export function rowHeight(fontPx: number, lang: Lang): number {
  return Math.round(fontPx * lineHeightEm(lang)) + SPACE.rowPadY * 2;
}

/** Type scale. Menus use four sizes; more than four reads as a form. */
export const TYPE = {
  display: 72,
  heading: 44,
  body: 30,
  label: 24,
  caption: 20,
} as const;

export const SPACE = {
  gutter: 96,
  gap: 20,
  rowPadX: 28,
  rowPadY: 14,
  radius: 16,
  /** Focus ring sits OUTSIDE the control, so it never covers the label. */
  focusRingOffset: 6,
  focusRingWidth: 4,
} as const;

/**
 * Menu chrome colours. Deliberately cool and low-chroma so a stop accent
 * placed on top is the only saturated thing on screen.
 *
 * No red anywhere, at any state, including destructive ones (D31, AC-22b.1):
 * "reset progress" is drawn in the same calm ink as everything else and asks
 * twice instead (design brief 13, "Reset-progress confirm: no red").
 */
export const INK = {
  bg: "#08111F",
  bgDeep: "#050B14",
  panel: "#0E1116",
  panelRaised: "#141A24",
  panelSunken: "#0A0F17",
  line: "#243040",
  text: "#F7FAFF",
  textDim: "#A8B6C8",
  textFaint: "#6A7A8E",
  /** Focus ring + selected state. One accent for the whole menu system. */
  accent: "#FFC857",
  accentSoft: "#FFE29A",
  /** Locked / not-yet-earned. Dim, never struck through. */
  locked: "#3A4656",
  /** Confirmed-good, used for "earned" ticks. */
  lit: "#9FD8F0",
} as const;

/**
 * THE PLATE EVERY PIECE OF SKY-BORNE TEXT SITS ON (AC-22.8).
 *
 * The word plate has always had one and measures 17.4:1. Headlines did not, and
 * five screens shipped at 1.19:1 - 1.72:1 because the rubric only ever looked at
 * the word plate. One token, used by `skyText()` in the scene kit, so the number
 * the rubric reads and the number the screen draws cannot drift apart.
 *
 * ALPHA IS 0.97, NOT 1. The plate is meant to read as a sheet of glass over the
 * world rather than a hole punched in it, and 3% of sky is enough to feel the
 * stop's colour through it. It is also cheap to be honest about: the contrast
 * module composites this over WHITE, so the ratio it reports is the worst case
 * any sky can produce, not the one a capture happened to catch.
 */
export const SKY_PLATE = {
  fill: INK.panel,
  alpha: 0.97,
  stroke: INK.line,
  padX: 22,
  padY: 12,
  radius: SPACE.radius,
} as const;

/**
 * The only easing curves allowed anywhere (AC-22.5, art-direction s8).
 * Named here so no scene has to remember the list, and so a grep for `Linear`
 * across src/game/ui returns nothing.
 */
export const EASE = {
  arrive: "Cubic.Out",
  pop: "Back.Out",
  drift: "Sine.InOut",
  blast: "Expo.Out",
} as const;

/** Durations, ms. Short enough that keyboard navigation never feels gated. */
export const DUR = {
  focus: 140,
  panel: 260,
  toast: 3200,
  toastIn: 320,
} as const;

/**
 * D41 letter case: lowercase is the default. Applied to CHROME ONLY - labels,
 * headings, button text. Never to a pilot name or a ship name, which are the
 * child's own words and keep the capitals they typed.
 */
export function chromeCase(text: string, uppercase: boolean): string {
  return uppercase ? text.toLocaleUpperCase() : text.toLocaleLowerCase();
}

/** D41 increased letter spacing (Zorzi et al. 2012), in px at `fontPx`. */
export function letterSpacingPx(fontPx: number, increased: boolean): number {
  return increased ? Math.round(fontPx * 0.12) : 0;
}
