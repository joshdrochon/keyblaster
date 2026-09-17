/**
 * TEXT CONTRAST (AC-22.8, D41, D60#8).
 *
 * WHY THIS MODULE EXISTS. `V-22.8` measured exactly one pair of colours: the
 * word on the word plate. That pair is excellent - 17.4:1 - and it was the only
 * pair anybody ever looked at, so five screens shipped green with headline text
 * drawn STRAIGHT ONTO THE SKY at 1.19:1 to 1.72:1:
 *
 *   "Belt cleared. Type this to charge the warp drive."   1.35:1   warp
 *   "Warp break"                                          1.60:1   warp
 *   "MARS BEACON" / "PLACED"                              1.61:1   beacon
 *   "the map is drawn"                                    1.19:1   ending
 *   "Locked"                                              1.40:1   map
 *
 * A child aged 7-11 cannot read 1.2:1. The plate was never the problem; the
 * rubric's SCOPE was. So the measurement lives here, in the engine, where it is
 * pure and under the 95% coverage gate, and the check is applied to every piece
 * of text a scene draws over the sky rather than to the one pair that happened
 * to be easy.
 *
 * Nothing here imports Phaser or the DOM (CLAUDE.md).
 */

/** Parse `#rgb` / `#rrggbb` into 0..255 channels. */
export function channels(hex: string): readonly [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(c: number): string {
  return Math.max(0, Math.min(255, Math.round(c)))
    .toString(16)
    .padStart(2, "0");
}

export function hexOf(rgb: readonly [number, number, number]): string {
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** WCAG 2.1 relative luminance, 0..1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` painted at `alpha` over `bg`, as a flat colour. */
export function compositeOver(fg: string, alpha: number, bg: string): string {
  const a = Math.max(0, Math.min(1, alpha));
  const f = channels(fg);
  const b = channels(bg);
  return hexOf([
    f[0] * a + b[0] * (1 - a),
    f[1] * a + b[1] * (1 - a),
    f[2] * a + b[2] * (1 - a),
  ]);
}

/**
 * The lightest thing a stage sky can put behind a plate.
 *
 * A semi-transparent plate is only as dark as what is under it, and the bright
 * stops (Saturn's ivory sky, the ending's dawn) really do go near white. So the
 * plate's effective colour is computed against WHITE rather than against a
 * sampled sky: the number the rubric reads is then the WORST case the screen
 * can produce, not the case the capture happened to catch.
 */
export const WORST_CASE_SKY = "#FFFFFF";

/**
 * Minimum contrast for chrome text, including everything drawn over the sky.
 *
 * WCAG AA would allow 3:1 for large text. This game is read by 7-to-11 year
 * olds under D41's legibility rules, and the word plate already clears 17:1, so
 * the headline that names the screen is held to the same 4.5:1 as body copy.
 */
export const TEXT_MIN_CONTRAST = 4.5;

/** One piece of text, with the surface it is actually read against. */
export interface TextSample {
  /** Screen id, e.g. "warp". */
  readonly screen: string;
  /** What the text is, e.g. "warp.heading". */
  readonly id: string;
  /** The ink colour. */
  readonly color: string;
  /** The plate fill behind it, or null when the text is drawn on bare sky. */
  readonly plateFill: string | null;
  /** The plate's alpha. Ignored when `plateFill` is null. */
  readonly plateAlpha: number;
  /**
   * The colour behind the plate. Defaults to WORST_CASE_SKY, which is what
   * makes a semi-transparent plate report its worst case rather than its best.
   */
  readonly behind?: string;
}

export interface TextReading extends TextSample {
  /** The flat colour the ink is actually read against. */
  readonly backdrop: string;
  readonly ratio: number;
  readonly passes: boolean;
}

/** Round to two places so evidence files diff cleanly. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Measure one sample. Text with no plate is measured against the sky itself,
 * which is exactly how "the map is drawn" earned its 1.19:1.
 */
export function measureText(
  sample: TextSample,
  min: number = TEXT_MIN_CONTRAST,
): TextReading {
  const behind = sample.behind ?? WORST_CASE_SKY;
  const backdrop =
    sample.plateFill === null
      ? behind
      : compositeOver(sample.plateFill, sample.plateAlpha, behind);
  const ratio = round2(contrastRatio(sample.color, backdrop));
  return { ...sample, backdrop, ratio, passes: ratio >= min };
}

export interface ContrastReport {
  readonly rows: readonly TextReading[];
  readonly failing: readonly TextReading[];
  readonly worst: TextReading | null;
  readonly min: number;
  readonly screens: readonly string[];
  readonly passes: boolean;
}

/**
 * Measure a whole screen inventory.
 *
 * `passes` is false on an EMPTY input on purpose. A contrast check that reports
 * green because nothing registered is the failure mode this module was written
 * to end: V-22.8 was green for months because its scope was one plate, and a
 * zero-row report is the same mistake with a smaller scope still.
 */
export function measureTexts(
  samples: readonly TextSample[],
  min: number = TEXT_MIN_CONTRAST,
): ContrastReport {
  const rows = samples.map((s) => measureText(s, min));
  const failing = rows.filter((r) => !r.passes);
  const worst =
    rows.length === 0 ? null : rows.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  return {
    rows,
    failing,
    worst,
    min,
    screens: [...new Set(rows.map((r) => r.screen))].sort(),
    passes: rows.length > 0 && failing.length === 0,
  };
}
