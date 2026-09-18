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

/**
 * THE TYPE SCALE. Every font size in the product is one of these.
 *
 * The first five are the menu scale and were always here. The last three are
 * the sizes the WORLD screens were already drawing at as raw numbers, promoted
 * to names by the same rule `STEP` promoted the spacing numbers: a size that
 * exists gets a name, and a size that is not on this list is a design decision
 * somebody has to argue for rather than a number typed into a scene.
 *
 *   wordmark 128  the Title's logo. A logo is not chrome (`TitleScene.FONT`
 *                 already makes that argument about the face) and it is the
 *                 only element in the game at this size.
 *   sentence  52  the line the child TYPES on the warp break. Load-bearing:
 *                 `warpLayout.SENTENCE_STEP` and `SENTENCE_MAX_LINES` are
 *                 derived from it, so it sets whether a stop's sentence wraps.
 *   prose     36  the picture-book page on the briefing. A reading size, five
 *                 paragraphs long, which is a different job from `body`.
 *
 * COLLAPSING `prose` INTO `body` IS THE OPEN QUESTION, not a tweak - it is the
 * one entry here that could plausibly go, and it would take the app from eight
 * sizes to seven. It is in gauntlet/escalations.md rather than done, because
 * shrinking the briefing's reading type is a legibility decision (D41's whole
 * subject) and not an alignment one.
 */
export const TYPE = {
  wordmark: 128,
  display: 72,
  sentence: 52,
  heading: 44,
  prose: 36,
  body: 30,
  label: 24,
  caption: 20,
} as const;

/** Every size, descending. For a guard that asks "is this size on the scale". */
export const TYPE_SIZES: readonly number[] = [...new Set(Object.values(TYPE))].sort(
  (a, b) => b - a,
);

/**
 * THE SPACING SCALE (UR-69). Every pad, gap, inset and indent in the product is
 * one of these six numbers.
 *
 * ================== WHY IT EXISTS ==================
 * A census of the served build at 1920x1080, walking the real display list of
 * all nine screens, found 164 DISTINCT LEFT EDGES app-wide - 34 on the Director
 * map, 27 on the stage report and on the Ending, 16 on the Pre-flight, where
 * `GUTTER` is 96 and exactly two elements sat on it while the rest landed at 0,
 * 118, 224, 326, 400, 464, 650, 781, 826 and 993.
 *
 * None of those is a decision. They are the arithmetic of nine screens each
 * adding its own number to its own anchor, which is the same defect UR-69
 * reported about the PLATE and `ui/grid.ts` fixed for the heading line. The
 * type scale, by contrast, came out of the same census CLEAN: two font families
 * (the second is Devanagari support) and nine sizes app-wide, three to five per
 * screen. Spacing is the axis that is actually wrong.
 *
 * ================== THE SIX, AND WHERE EACH CAME FROM ==================
 * Every one is a number the product already drew at, promoted to a name. This
 * is a scale being DECLARED, not a redesign: a seventh entry here is a design
 * decision and has to be argued, which is the whole point.
 *
 *   hair    8   inside one control
 *   tight  12   `SKY_PLATE.padY`: a glass plate's inset, and the step between
 *               the rows of one instrument
 *   unit   20   `SPACE.gap`: THE vertical unit. Between two rows, two plates,
 *               two blocks. If one number in this file moves the whole product,
 *               it is this one
 *   inset  32   an instrument's horizontal inset (the warp drive's track)
 *   pad    40   a card's horizontal inset (the warp sentence, the stage report)
 *   gutter 96   the page margin, fixed by `ui/grid.ts` against the widest
 *               screen in the game
 *
 * Multiples of 4 throughout, which is what makes "is this on the scale" a
 * question with an answer rather than a matter of taste.
 */
export const STEP = {
  hair: 8,
  tight: 12,
  unit: 20,
  inset: 32,
  pad: 40,
  gutter: 96,
} as const;

export type SpaceStep = (typeof STEP)[keyof typeof STEP];

/** Every step, ascending. For a guard that asks "is this distance on the scale". */
export const STEPS: readonly number[] = Object.values(STEP).sort((a, b) => a - b);

export const SPACE = {
  gutter: STEP.gutter,
  gap: STEP.unit,
  /**
   * 22, NOT 28 (UR-89). It was the one inset in this file on no scale at all,
   * and it put every menu row's label six pixels from the hint line's ink once
   * that line gained a plate. It is `SKY_PLATE.padX` now, which is the same
   * inset the hint, the title's plated lines and every sky plate already use -
   * so a row's label and the hint under it sit on ONE inner line.
   */
  rowPadX: 22,
  rowPadY: 14,
  radius: 16,
  /**
   * THE BIG CARD'S CORNER, promoted to a name (UR-69's rule, applied to radii).
   *
   * Two radii in the product and no third: `radius` (16) is a control, this is
   * a CARD - the Title's primary button and the briefing's picture-book page,
   * both of which drew `26` as a literal at their own call site. Naming it is
   * what makes "should these two match" a question with an answer.
   *
   * Collapsing it into `radius` would be one radius app-wide, which is more
   * uniform still and is a VISIBLE change to two screens' corners. That is in
   * gauntlet/escalations.md with a lean, not done here: this lane is closing
   * near-miss alignment, and a corner nobody asked to move is how a polish pass
   * turns into a redesign.
   */
  radiusCard: 26,
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
  // CASE IS AUTHORED, NOT IMPOSED (UR-81).
  //
  // This used to force every chrome string to lower case, which meant the
  // string table could not decide anything: "Type the way through the solar
  // system." was written with a capital and drawn without one, and no amount
  // of editing the copy could change that. D41's increased-legibility setting
  // still gets its upper case - that one is a reading aid and is a property of
  // the READER rather than of the string - but the default is now whatever the
  // translator wrote.
  return uppercase ? text.toLocaleUpperCase() : text;
}

/** D41 increased letter spacing (Zorzi et al. 2012), in px at `fontPx`. */
export function letterSpacingPx(fontPx: number, increased: boolean): number {
  return increased ? Math.round(fontPx * 0.12) : 0;
}
