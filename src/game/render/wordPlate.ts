import Phaser from "phaser";

/**
 * The word plate (art-direction.md section 7, AC-22.8, AC-2.3).
 *
 * "Word plate: dark plate, light text, 4.5:1 minimum (rubric 8), typed letters
 * light to the accent color, the next letter carries a soft underline cue."
 *
 * THREE THINGS THIS FILE OWNS, and nothing else:
 *   1. the plate geometry, which hangs BELOW the rock and never over it
 *      (art-direction section 4), so the silhouette the player reads and the
 *      word they type never fight for the same pixels;
 *   2. per-letter state - untyped, typed, next - because the typed-letter cue
 *      is per character and a single Text object cannot carry it;
 *   3. the contrast maths, exported, so the evidence artifact for V-22.8 is
 *      computed from the same function the renderer uses rather than from a
 *      second copy of the formula that can drift away from it.
 *
 * It owns no rules. What counts as typed comes from `@engine/lock`; which word
 * is here at all comes from `@engine/selection`.
 */

/** Gap between the bottom of the rock and the top of the plate, in px. */
export const PLATE_GAP_PX = 16;

export const PLATE_PAD_X_PX = 14;
export const PLATE_PAD_Y_PX = 8;
export const PLATE_RADIUS_PX = 8;

/** AC-22.8 / rubric 8. */
export const PLATE_MIN_CONTRAST = 4.5;

export interface WordPlateStyle {
  /** Plate fill, from the stop palette's `plate`. */
  readonly plate: string;
  /** Resting letter colour, from the stop palette's `plateText`. */
  readonly plateText: string;
  /** Typed letters light to this (art-direction section 7). */
  readonly accent: string;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  /** D41 increased letter spacing. */
  readonly letterSpacingPx: number;
  /** D41 letter case; lowercase is the default. */
  readonly uppercase: boolean;
  /** D41 reduced motion: the underline stops pulsing, the cue stays. */
  readonly reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Colour maths. Exported because V-22.8's evidence must be measured with the
// renderer's own formula (D85: evidence, not a restatement).
// ---------------------------------------------------------------------------

/** "#rgb" or "#rrggbb" to 0xrrggbb. Throws on anything else: a bad palette
 * entry is a content bug and must not render as silent black. */
export function hexToInt(hex: string): number {
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
  return Number.parseInt(full, 16);
}

export function hexToRgb(hex: string): readonly [number, number, number] {
  const n = hexToInt(hex);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, always >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** AC-22.8 as a predicate, for the palette check and for tests. */
export function meetsPlateContrast(plate: string, text: string): boolean {
  return contrastRatio(plate, text) >= PLATE_MIN_CONTRAST;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Display form of a word under the letter-case setting (D41). */
export function displayWord(word: string, uppercase: boolean): string {
  return uppercase ? word.toUpperCase() : word;
}

/**
 * Advance width of one glyph cell. Phaser measures text per object; the plate
 * lays characters out on a fixed cell so the underline cue can sit under the
 * NEXT letter without re-measuring the string every keystroke.
 */
export function cellWidthPx(style: WordPlateStyle): number {
  return style.fontSizePx * 0.62 + style.letterSpacingPx;
}

export interface PlateSize {
  readonly width: number;
  readonly height: number;
}

export function plateSize(word: string, style: WordPlateStyle): PlateSize {
  const letters = [...word].length;
  return {
    width: letters * cellWidthPx(style) + PLATE_PAD_X_PX * 2,
    height: style.fontSizePx * 1.25 + PLATE_PAD_Y_PX * 2,
  };
}

/**
 * Where the plate's centre sits relative to the rock's centre (AC-2.3's
 * companion rule: "the word plate hangs BELOW the rock, never over it").
 */
export function plateOffsetY(rockSizePx: number, style: WordPlateStyle): number {
  return rockSizePx / 2 + PLATE_GAP_PX + plateSize("a", style).height / 2;
}

// ---------------------------------------------------------------------------
// The plate
// ---------------------------------------------------------------------------

/**
 * One rock's label. A Container so the whole plate can shake, dissolve and be
 * destroyed as a unit while the rock keeps its own tweens.
 */
export class WordPlate extends Phaser.GameObjects.Container {
  private readonly style: WordPlateStyle;
  private readonly word: string;
  private readonly letters: Phaser.GameObjects.Text[] = [];
  private readonly backing: Phaser.GameObjects.Graphics;
  private readonly underline: Phaser.GameObjects.Graphics;
  private readonly size: PlateSize;
  private typedCount_ = 0;
  private underlinePulse: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    word: string,
    style: WordPlateStyle,
  ) {
    super(scene, x, y);
    this.word = word;
    this.style = style;
    this.size = plateSize(word, style);

    this.backing = scene.add.graphics();
    this.drawBacking(1);
    this.add(this.backing);

    this.underline = scene.add.graphics();
    this.add(this.underline);

    const text = displayWord(word, style.uppercase);
    const cell = cellWidthPx(style);
    const startX = -this.size.width / 2 + PLATE_PAD_X_PX + cell / 2;
    [...text].forEach((ch, i) => {
      const letter = scene.add.text(startX + i * cell, 0, ch, {
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSizePx}px`,
        color: style.plateText,
      });
      letter.setOrigin(0.5, 0.5);
      this.letters.push(letter);
      this.add(letter);
    });

    this.drawUnderline();
    scene.add.existing(this);
  }

  /** Plate rectangle in local space, for tests and for the HUD's keep-out. */
  get plateSizePx(): PlateSize {
    return this.size;
  }

  private drawBacking(alpha: number): void {
    const { width, height } = this.size;
    this.backing.clear();
    // A hairline of the accent along the top edge ties the plate to the rock
    // without putting anything over the silhouette.
    this.backing.fillStyle(hexToInt(this.style.plate), 0.92 * alpha);
    this.backing.fillRoundedRect(
      -width / 2,
      -height / 2,
      width,
      height,
      PLATE_RADIUS_PX,
    );
    this.backing.lineStyle(1, hexToInt(this.style.accent), 0.35 * alpha);
    this.backing.strokeRoundedRect(
      -width / 2,
      -height / 2,
      width,
      height,
      PLATE_RADIUS_PX,
    );
  }

  /** Art-direction section 7: "the next letter carries a soft underline cue". */
  private drawUnderline(): void {
    this.underline.clear();
    const next = this.letters[this.typedCount_];
    if (next === undefined) {
      this.underlinePulse?.remove();
      this.underlinePulse = null;
      return;
    }
    const cell = cellWidthPx(this.style);
    const y = this.style.fontSizePx * 0.56;
    this.underline.lineStyle(2, hexToInt(this.style.accent), 0.75);
    this.underline.lineBetween(
      next.x - cell * 0.34,
      y,
      next.x + cell * 0.34,
      y,
    );
    if (this.underlinePulse === null && !this.style.reducedMotion) {
      this.underlinePulse = this.scene.tweens.add({
        targets: this.underline,
        alpha: { from: 0.55, to: 1 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }
  }

  /**
   * How many leading letters are typed. Driven by `advanced`/`typo` emissions
   * from `@engine/lock`; this class never decides what counts as typed.
   */
  setTypedCount(count: number): void {
    const clamped = Math.max(0, Math.min(this.letters.length, count));
    if (clamped === this.typedCount_) return;
    this.typedCount_ = clamped;
    this.letters.forEach((letter, i) => {
      letter.setColor(i < clamped ? this.style.accent : this.style.plateText);
    });
    this.drawUnderline();
  }

  /** Length of the word this plate carries, in characters. */
  get letterCount(): number {
    return this.letters.length;
  }

  /** Leading letters currently lit to the accent. */
  get typedCount(): number {
    return this.typedCount_;
  }

  /**
   * AC-3.2: a mistyped key shakes the label and does not drop the lock. The
   * shake is the ONLY feedback - no red, no cross, no "mistake" tint (D31).
   */
  shake(amplitudePx: number, durationMs: number): void {
    if (this.style.reducedMotion) return; // D41 / AC-19.3
    const homeX = this.x;
    this.scene.tweens.addCounter({
      from: amplitudePx,
      to: 0,
      duration: durationMs,
      ease: "Cubic.Out",
      onUpdate: (tween) => {
        const amp = tween.getValue() ?? 0;
        const t = tween.progress * Math.PI * 8;
        this.x = homeX + Math.sin(t) * amp;
      },
      onComplete: () => {
        this.x = homeX;
      },
    });
  }

  /**
   * AC-2.2 / D25: the word is fully typed but a longer rival is still live, so
   * it is armed rather than fired. The plate brightens toward the accent as the
   * park runs down; `progress` is computed from the emission's `firesAtMs`, so
   * the animation ends exactly when the lock fires and never guesses.
   */
  setChargeProgress(progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    this.drawBacking(1);
    this.backing.fillStyle(hexToInt(this.style.accent), 0.12 + 0.28 * p);
    this.backing.fillRoundedRect(
      -this.size.width / 2,
      -this.size.height / 2,
      this.size.width,
      this.size.height,
      PLATE_RADIUS_PX,
    );
  }

  clearCharge(): void {
    this.drawBacking(1);
  }

  /** Blast (art-direction section 8): "word plate dissolves upward". */
  dissolveUpward(durationMs: number, onComplete?: () => void): void {
    this.underlinePulse?.remove();
    this.underlinePulse = null;
    this.scene.tweens.add({
      targets: this,
      y: this.y - 46,
      alpha: 0,
      scale: 1.06,
      duration: durationMs,
      ease: "Expo.Out",
      onComplete: () => {
        onComplete?.();
        this.destroy();
      },
    });
  }

  override destroy(fromScene?: boolean): void {
    this.underlinePulse?.remove();
    this.underlinePulse = null;
    super.destroy(fromScene);
  }
}
