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

/**
 * THE GEOMETRY AND THE COLOUR MATHS LIVE IN `wordPlateGeometry.ts`.
 *
 * They are pure arithmetic and they used to share this file with a Phaser
 * subclass, which made them unimportable under vitest's node environment - so
 * two guards restated them instead of binding to them. They are imported here
 * and re-exported unchanged, so every caller of `plateSize`, `plateOffsetY`,
 * `contrastRatio` and the rest is untouched by the split.
 */
export {
  PLATE_GAP_PX,
  PLATE_PAD_X_PX,
  PLATE_PAD_Y_PX,
  PLATE_RADIUS_PX,
  PLATE_MIN_CONTRAST,
  hexToInt,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  meetsPlateContrast,
  displayWord,
  cellWidthPx,
  plateSize,
  plateOffsetY,
  plateHalfHeightPx,
} from "./wordPlateGeometry.js";
export type { WordPlateStyle, PlateSize } from "./wordPlateGeometry.js";

import {
  PLATE_PAD_X_PX,
  PLATE_RADIUS_PX,
  type WordPlateStyle,
  type PlateSize,
  cellWidthPx,
  displayWord,
  hexToInt,
  plateSize,
} from "./wordPlateGeometry.js";

/**
 * THE PLATE IS A SURFACE. NOTHING IS VISIBLE THROUGH ONE.
 *
 * This was 0.92, and the 8% it let through is the same defect
 * `tests/unit/scenes/plateOpacity.test.ts` removed from every UI card - left
 * behind on the one plate in the game whose entire job is to be read.
 *
 * Two things are wrong with a translucent word plate and neither is cosmetic:
 *
 *   1. THE EVIDENCE IS ABOUT A DIFFERENT COLOUR. `contrastRatio` /
 *      `meetsPlateContrast` below are the functions V-22.8's artifact is
 *      computed with, and they take the flat swatch. A plate drawn at 0.92 is
 *      the swatch composited over whatever is behind it, so the ratio that was
 *      measured is not the ratio that was drawn. The UI cards had exactly this:
 *      "V-22.8 has been measuring these surfaces as opaque all along".
 *   2. WHAT COMES THROUGH IS A SHAPE, NOT A TINT. At 8% a near-black
 *      `foreVeil` silhouette behind a word is a visible dark form inside the
 *      rectangle - UR-23's complaint, arriving through the plate instead of
 *      over it, and unreachable by the depth fix that put the plate above the
 *      world. A deeper board (maxLive 7) puts more plates over more of the
 *      near planes, so it gets more likely, not less.
 *
 * Kept as a named constant rather than a literal so the guard in
 * `tests/unit/render/wordPlateOpacity.test.ts` asserts the drawn value.
 */
export const PLATE_FILL_ALPHA = 1;

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

  /** The word this plate carries, for a harness that has to match plate to rock. */
  get wordText(): string {
    return this.word;
  }

  /**
   * The rectangle this plate ACTUALLY COVERS, in its parent's space.
   *
   * `plateSizePx` is the nominal rectangle and is not what is on screen while
   * the arrival pop is running: `FlightScene.spawnRock` starts the plate at
   * scale 0.7 on a `Back.Out` tween, and a paused scene never runs a tween, so
   * a frozen board can hold plates at any scale between 0.7 and 1.
   *
   * A harness that measures the nominal rectangle on a popped plate measures
   * the sky around it and blames the plate for it. That is not hypothetical:
   * it is `plate-legibility.spec.ts` reporting 66.60% overdraw on a word whose
   * plate was clean (UR-23's re-run), and it only appeared once the belt
   * started holding enough rocks for one of them to be mid-pop.
   */
  get drawnRect(): { left: number; right: number; top: number; bottom: number } {
    const halfW = (this.size.width * Math.abs(this.scaleX)) / 2;
    const halfH = (this.size.height * Math.abs(this.scaleY)) / 2;
    return {
      left: this.x - halfW,
      right: this.x + halfW,
      top: this.y - halfH,
      bottom: this.y + halfH,
    };
  }

  private drawBacking(alpha: number): void {
    const { width, height } = this.size;
    this.backing.clear();
    // A hairline of the accent along the top edge ties the plate to the rock
    // without putting anything over the silhouette.
    this.backing.fillStyle(hexToInt(this.style.plate), PLATE_FILL_ALPHA * alpha);
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
      y: this.y - 78,
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
