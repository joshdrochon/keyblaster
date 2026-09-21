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
  plateGlyphs,
  letterAdvancesPx,
  letterCentresPx,
  textRunWidthPx,
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
  letterAdvancesPx,
  letterCentresPx,
  plateGlyphs,
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

/**
 * The underline cue's width, as a fraction of the advance of the letter it
 * marks. 0.68 is the proportion the fixed-cell version drew (`cell * 0.34`
 * either side) and is kept so the cue's weight is unchanged on an average
 * letter; what changes is that it now tracks the letter instead of the grid.
 */
export const UNDERLINE_SPAN = 0.68;

/** No cue narrower than this, so `i`, `l` and `j` still show one. */
export const UNDERLINE_MIN_HALF_PX = 3;

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
  /**
   * THE SHAKE LIVES HERE, NOT IN `x`.
   *
   * `FlightScene.updateRocks` calls `setPosition` on this plate EVERY FRAME -
   * the plate is not a child of the rock's container, so it is carried by hand.
   * A shake written straight into `x` was therefore overwritten within one
   * frame of starting, and AC-3.2's feedback has never once reached the screen
   * despite `shake()` being implemented and under test: the test asserted the
   * tween was created, which it was.
   *
   * Keeping the displacement separate means the carrier owns the position and
   * the shake owns the offset, and neither can erase the other.
   */
  private shakeOffsetX_ = 0;
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

    // THE LETTERS SIT ON THEIR OWN ADVANCES, NOT ON A FIXED CELL.
    //
    // `startX + i * cell` is what was here, and it is why "jump" drew with `mp`
    // overlapping: one cell width for `m` (24.49 px of advance) and for `l`
    // (6.52 px). `letterCentresPx` packs each glyph's real advance box and puts
    // exactly `letterSpacingPx` between boxes, so every gap on every plate is
    // the same number and no two glyphs can touch. See `wordPlateGeometry.ts`.
    //
    // The per-letter `Text` objects stay - the typed cue is per character and a
    // single Text cannot carry per-character colour (see the header). What
    // changed is only where each one is put.
    const glyphs = plateGlyphs(word, style);
    const centres = letterCentresPx(word, style);
    const runLeft = -this.size.width / 2 + PLATE_PAD_X_PX;
    glyphs.forEach((ch, i) => {
      const letter = scene.add.text(runLeft + (centres[i] ?? 0), 0, ch, {
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
   * WHERE EACH LETTER ACTUALLY IS AND HOW WIDE PHASER ACTUALLY DREW IT.
   *
   * `x` is the letter's centre in plate space (the `Text` is `setOrigin(0.5)`),
   * `width` is the `Text`'s own measured width, and `reservedWidth` is what
   * `wordPlateGeometry` reserved for it when it chose that `x`.
   *
   * The three together are the only way to check the thing that actually went
   * wrong here from OUTSIDE the arithmetic: the old layout was internally
   * consistent and still drew letters on top of each other, because the width
   * it reserved had nothing to do with the width it drew. A unit test cannot
   * see that - there is no font in node - so this is the surface an e2e reads,
   * and `tests/e2e/plate-spacing.spec.ts` is what reads it.
   */
  get letterBoxes(): readonly { x: number; width: number; reservedWidth: number }[] {
    const reserved = letterAdvancesPx(this.word, this.style);
    return this.letters.map((letter, i) => ({
      x: letter.x,
      width: letter.width,
      reservedWidth: reserved[i] ?? 0,
    }));
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
    // THE CUE IS AS WIDE AS THE LETTER IT POINTS AT. On the fixed cell it was
    // 0.68 of one cell whatever the glyph, so the rule under `l` was three
    // times the letter's own width and the rule under `m` covered half of it.
    // `UNDERLINE_SPAN` keeps the same 0.68 proportion, now of the real advance,
    // and the floor stops a hairline glyph getting a cue too small to see.
    const advance = letterAdvancesPx(this.word, this.style)[this.typedCount_] ?? 0;
    const half = Math.max(UNDERLINE_MIN_HALF_PX, (advance * UNDERLINE_SPAN) / 2);
    const y = this.style.fontSizePx * 0.56;
    this.underline.lineStyle(2, hexToInt(this.style.accent), 0.75);
    this.underline.lineBetween(next.x - half, y, next.x + half, y);
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
    this.scene.tweens.addCounter({
      from: amplitudePx,
      to: 0,
      duration: durationMs,
      ease: "Cubic.Out",
      onUpdate: (tween) => {
        const amp = tween.getValue() ?? 0;
        const t = tween.progress * Math.PI * 8;
        this.setShakeOffsetX(Math.sin(t) * amp);
      },
      onComplete: () => {
        this.setShakeOffsetX(0);
      },
    });
  }

  /** The live horizontal displacement of the shake, in pixels. */
  get shakeOffsetX(): number {
    return this.shakeOffsetX_;
  }

  /**
   * Move by the offset rather than to it, so a carrier that rewrites `x` every
   * frame and a shake that runs across many frames cannot fight.
   */
  private setShakeOffsetX(offsetPx: number): void {
    this.x += offsetPx - this.shakeOffsetX_;
    this.shakeOffsetX_ = offsetPx;
  }

  /**
   * `setPosition` is what the carrier calls; it must not wipe a shake in
   * progress, so the offset is re-applied on top of the position asked for.
   */
  override setPosition(x?: number, y?: number, z?: number, w?: number): this {
    return super.setPosition((x ?? 0) + this.shakeOffsetX_, y, z, w);
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
