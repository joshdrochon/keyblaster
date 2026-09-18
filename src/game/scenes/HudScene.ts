import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import { layer } from "@game/render/layers.js";
import { hexToInt } from "@game/render/wordPlate.js";
import { FLIGHT_EVENTS, type HudSnapshot } from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
import {
  HUD_RADIUS,
  hudLeftPlate,
  hudPlacePlate,
  hudRightPlate,
  type HudRect,
} from "@game/flight/hudLayout.js";
import { chromeCase, letterSpacingPx } from "@game/ui/theme.js";
import { drawPlate } from "@game/ui/plate.js";
import { typographyOf } from "@game/scenes/lib/typography.js";
import type { Lang } from "@engine/types.js";
import { HULL_MARK_COUNT, hullMarkAlpha } from "@engine/hull/index.js";

/**
 * The HUD (design-brief-v2.md section 6, art-direction section 2 layer L7).
 *
 * Its own scene, so it renders above every flight layer without competing for
 * the debris container's depth, and so a paused or stalled Flight scene can
 * keep the readouts on screen unchanged.
 *
 * THREE CONSTRAINTS SHAPE EVERY PIXEL HERE.
 *
 * L7 "own contrast plate, never over debris" - the readouts sit on plates in
 * the top corners, inside a keep-out the rocks never enter.
 *
 * AC-8.3 "no UI element maps size to speed" - there is no fall-time readout, no
 * speed bar, no timer and no size legend anywhere in this file. Fall time is
 * this child's private history with a word (D19); drawing it would turn an
 * adaptive system into a public judgement about them.
 *
 * D31 "nothing reads as punishment" - the hull is three marks that DIM, never a
 * bar that empties and never a count of what was lost, and the multiplier comes
 * from `hudMultiplierFor` so the screen never shows "x0".
 */
export class HudScene extends Phaser.Scene {
  private copy!: FlightCopy;
  private snapshot: HudSnapshot | null = null;

  private wpmValue!: Phaser.GameObjects.Text;
  private wpmLabel!: Phaser.GameObjects.Text;
  private comboValue!: Phaser.GameObjects.Text;
  private comboLabel!: Phaser.GameObjects.Text;
  private scoreValue!: Phaser.GameObjects.Text;
  private scoreLabel!: Phaser.GameObjects.Text;
  private hullLabel!: Phaser.GameObjects.Text;
  private placePlate!: Phaser.GameObjects.Graphics;
  private placeName!: Phaser.GameObjects.Text;
  private placeMark!: Phaser.GameObjects.Graphics;
  private lastHull: number | null = null;
  private hullMarks: Phaser.GameObjects.Graphics[] = [];
  private lastCombo = 0;

  private readonly font =
    "'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif";

  constructor() {
    super(SCENE_KEYS.hud);
  }

  init(data: { snapshot?: HudSnapshot; uiLang?: Lang; shipName?: string }): void {
    this.snapshot = data.snapshot ?? null;
    this.copy = createFlightCopy(data.uiLang ?? "en", {
      shipName: data.shipName ?? "Lantern",
    });
  }

  create(): void {
    const snap = this.snapshot;
    const accent = snap?.accent ?? "#FFC857";
    const plate = snap?.plate ?? "#0E1116";
    const plateText = snap?.plateText ?? "#F7FAFF";

    this.cameras.main.setRoundPixels(true);
    this.scene.bringToTop();

    const leftRect = hudLeftPlate();
    const left = this.plateRect(leftRect, plate, accent);
    left.setDepth(layer("hud").depth);

    this.wpmValue = this.text(44, 40, "0", plateText, 34);
    this.wpmLabel = this.text(44, 78, this.copy.t("hud.wpm"), accent, 16, "label");
    this.comboValue = this.text(150, 40, "x1", accent, 34);
    this.comboLabel = this.text(150, 78, this.copy.t("hud.combo"), plateText, 16, "label");

    // UR-21: WHERE THE SHIP IS. See `hudLayout.HUD_PLACE_H` for why it is a
    // plate of its own under the instruments rather than a title across the top
    // (the rocks fall there) or a fourth field in the row above it (that is a
    // worksheet, AC-22b.1).
    const placeRect = hudPlacePlate();
    this.placePlate = this.plateRect(placeRect, plate, accent);
    this.placePlate.setDepth(layer("hud").depth);
    this.placeName = this.text(
      placeRect.x + 36,
      placeRect.y + 11,
      snap?.stopName ?? "",
      plateText,
      24,
      "place",
    );
    // The stop's own colour, as a short rule beside the name. It is the one
    // thing on this plate that is not type: a place gets a mark, a readout gets
    // a caption, and this screen is not allowed captions.
    //
    // THE GAP IS 20 PX AND THAT IS FROM LOOKING AT IT. At 5 px the rule sat
    // hard against the S and the plate read "lSaturn" - a 3x20 bar beside type
    // at the same height IS a lowercase l until there is enough air for the eye
    // to stop reading it as one.
    this.placeMark = this.add.graphics();
    this.placeMark.fillStyle(hexToInt(accent), 1);
    this.placeMark.fillRoundedRect(placeRect.x + 16, placeRect.y + 15, 3, 16, 1.5);
    this.placeMark.setDepth(layer("hud").depth + 1);

    const right = this.plateRect(hudRightPlate(this.scale.width), plate, accent);
    right.setDepth(layer("hud").depth);

    this.scoreValue = this.text(this.scale.width - 240, 40, "0", plateText, 34);
    this.scoreLabel = this.text(
      this.scale.width - 240,
      78,
      this.copy.t("hud.score"),
      accent,
      16,
      "label",
    );

    this.hullLabel = this.text(
      this.scale.width - 132,
      78,
      this.copy.t("flight.hull"),
      plateText,
      16,
      "label",
    );
    this.buildHullMarks(this.scale.width - 132, 48, accent);

    this.game.events.on(FLIGHT_EVENTS.hud, this.onSnapshot, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(FLIGHT_EVENTS.hud, this.onSnapshot, this);
    });

    if (snap !== null) this.onSnapshot(snap);
  }

  /**
   * The HUD belongs to a belt, so it lives exactly as long as one.
   *
   * IT DID NOT. Nothing stopped this scene except the warp break and the stall
   * restart, so quitting to the map from the pause menu left the readouts drawn
   * over the Director map - and over the Settings panel after that, which is
   * where a real playthrough found it: `["Preflight","Flight","Settings","Hud"]`,
   * with the HUD on top of the panel the player was trying to read.
   *
   * Asked here rather than added to each exit because there are several exits
   * and the next one written would be a new leak. Paused and sleeping still
   * count as ALIVE - the pause menu freezes the belt rather than ending it, and
   * D30's warp break keeps Flight running underneath - so the scene survives;
   * it just stops drawing. See the note on visibility below.
   */
  override update(): void {
    const flight = SCENE_KEYS.flight;
    if (this.scene.manager.keys[flight] === undefined) return;
    const running = this.scene.isActive(flight);
    const alive = running || this.scene.isPaused(flight) || this.scene.isSleeping(flight);
    if (!alive) {
      this.scene.stop();
      return;
    }
    // A HUD that is drawn while the belt is NOT running is a HUD drawn over
    // whatever replaced it. The pause menu freezes Flight and the Settings
    // panel opens over that, and the readouts sat on top of both - a real
    // playthrough found them over the Settings panel with the controls
    // underneath. The frozen belt itself is still visible behind the overlay,
    // which is what makes a pause read as a pause; the instruments are part of
    // flying, and nobody is flying.
    if (this.scene.isVisible() !== running) this.scene.setVisible(running);
  }

  private plateRect(
    rect: HudRect,
    fill: string,
    accent: string,
  ): Phaser.GameObjects.Graphics {
    return this.plate(rect.x, rect.y, rect.w, rect.h, fill, accent);
  }

  private plate(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    accent: string,
  ): Phaser.GameObjects.Graphics {
    // THE SHARED PLATE (UR-69), on the `instrument` rhythm - the HUD is a
    // readout cluster, not a card, and the same rhythm dresses the warp drive.
    //
    // OPAQUE. L7's rule is "own contrast plate", and at 0.86 the plate was not
    // one: the surface under a label depended on whatever sky happened to be in
    // that corner of the frame, so the same colour pair measured 3.94:1 on the
    // left readout and 4.31:1 on the right IN ONE CAPTURE. Both are under
    // AC-22.8's 4.5:1, and neither number was a property of the design. Filled
    // flat, the stop accent on the plate is 6.71:1 at its worst (Mars) and the
    // numerals go from ~12:1 to ~18:1. `tests/unit/ui/smallLabels.test.ts`
    // reads `alpha: 1` back out of this file and measures every stop.
    return drawPlate(
      this,
      { x, y, w, h },
      {
        fill,
        alpha: 1,
        stroke: accent,
        strokeAlpha: 0.3,
        strokeWidth: 1,
        radius: HUD_RADIUS,
        rhythm: "instrument",
      },
    );
  }

  /**
   * D41'S TWO TYPOGRAPHY SETTINGS, ON THE HUD (UR-38).
   *
   * `uppercase` and `increasedLetterSpacing` are accessibility settings with a
   * control, validation and persistence, and for a while they changed nothing
   * on eleven screens. This was the last one with an owner.
   *
   * THE HUD IS NOT ONE KIND OF TEXT, which is why this takes a `kind` rather
   * than routing the whole file through a factory:
   *
   *   "label"   wpm, combo, score, hull. Chrome, and exactly what D41 is for.
   *             Takes both settings.
   *
   *   "readout" the numerals and the multiplier - 0, 10620, x3. Takes NEITHER.
   *             `chromeCase` does nothing to a digit, and tracking them would
   *             push the combo value into the hull marks: the instrument plate
   *             is a fixed 236 px and the values already run to within 26 px of
   *             its edge. A number that reflows its own plate is not an
   *             accessibility win.
   *
   *   "place"   the stop name (UR-21). Takes the SPACING and not the case.
   *             D41's letter case is chrome-only and excludes a name by name;
   *             `chromeCase(x, false)` LOWERCASES, so routing "Saturn" through
   *             it would render "saturn" for every child who has the setting
   *             off - which is every child by default.
   *
   * Read per call rather than cached. `typographyOf` documents why: its first
   * version memoised on `scene.data`, which survives `scene.restart()`, so a
   * screen redrew with its boot-time value - a setting with no live consumer,
   * one layer down from the bug being fixed. A HUD is rebuilt per belt, so this
   * is a handful of reads per stage.
   */
  private text(
    x: number,
    y: number,
    value: string,
    colour: string,
    size: number,
    kind: "label" | "readout" | "place" = "readout",
  ): Phaser.GameObjects.Text {
    const typo = typographyOf(this);
    const shown = kind === "label" ? chromeCase(value, typo.uppercase) : value;
    const text = this.add
      .text(x, y, shown, {
        fontFamily: this.font,
        fontSize: `${size}px`,
        color: colour,
      })
      .setDepth(layer("hud").depth + 1);
    if (kind !== "readout") {
      text.setLetterSpacing(letterSpacingPx(size, typo.increasedLetterSpacing));
    }
    return text;
  }

  /** The label text as this child's settings want it drawn. */
  private labelText(value: string): string {
    return chromeCase(value, typographyOf(this).uppercase);
  }

  /**
   * D31: THREE marks that dim. Never a bar, never a counter of what was lost.
   *
   * THREE, and not one per hull mark, now that the hull scales with stage
   * length (`@engine/hull`: a 58-word belt carries nine). Nine pips in a row on
   * the HUD is a lives counter, which AC-22b.1 forbids by name, and it would
   * have arrived as a side effect of a difficulty fix rather than as anybody's
   * decision about the surface.
   *
   * So the three marks stay and each one is a THIRD of the hull. That is the
   * same division the star rating uses (`starsForHullHits`), so what the child
   * watches during the stage and what they are shown at the end of it are the
   * same three buckets - and at an 18-word stage it is literally unchanged, one
   * mark per hit.
   *
   * Each hit still moves something: a mark dims FRACTIONALLY, by one hit's
   * worth of its third, so feedback per hit survives the compression.
   */
  private buildHullMarks(x: number, y: number, accent: string): void {
    this.hullMarks = [];
    for (let i = 0; i < HULL_MARK_COUNT; i += 1) {
      const g = this.add.graphics();
      g.fillStyle(hexToInt(accent), 1);
      g.fillRoundedRect(x + i * 24, y, 16, 16, 5);
      g.setDepth(layer("hud").depth + 1);
      this.hullMarks.push(g);
    }
  }

  private onSnapshot(snapshot: HudSnapshot): void {
    this.snapshot = snapshot;
    this.wpmValue.setText(Math.round(snapshot.wpm).toString());
    this.scoreValue.setText(snapshot.score.toString());
    this.comboValue.setText(`x${snapshot.multiplier}`);

    this.placeName.setText(snapshot.stopName);

    /**
     * UR-22, the corner's half of it.
     *
     * The marks still dim by a third of a hit, because three marks over a
     * nine-mark hull is the division `starsForHullHits` uses and changing it
     * would make the stage and its results screen disagree. What was missing is
     * that a fraction of a fade on a 16 px square is not an event: the player
     * reported the hull as taking infinite damage because nothing on screen
     * MOVED when it was hit.
     *
     * So the marks are given the moment they never had - they flare to full and
     * settle to their new level, which the eye catches in peripheral vision the
     * way a steady fade never does. It is still not a counter and still not a
     * bar: the marks end where the arithmetic puts them. The damage the player
     * actually reads is on the ship (`FlightScene.setHullLamp`); this is the
     * corner agreeing with it.
     */
    const tookAHit = this.lastHull !== null && snapshot.hull < this.lastHull;
    this.lastHull = snapshot.hull;
    this.hullMarks.forEach((mark, i) => {
      const alpha = hullMarkAlpha(i, snapshot.hull, snapshot.maxHull);
      if (!tookAHit) {
        mark.setAlpha(alpha);
        return;
      }
      this.tweens.killTweensOf(mark);
      mark.setAlpha(1);
      this.tweens.add({
        targets: mark,
        alpha,
        duration: 420,
        delay: i * 40,
        ease: "Cubic.Out",
      });
    });

    // The combo readout "climbs" with the keystroke tone (design brief 6).
    if (snapshot.combo > this.lastCombo) {
      this.tweens.add({
        targets: this.comboValue,
        scale: { from: 1.22, to: 1 },
        duration: 240,
        ease: "Back.Out",
      });
    }
    this.lastCombo = snapshot.combo;

    // Used only to keep the labels in the active language when settings change
    // mid-stage (AC-19.1); nothing here is computed from gameplay.
    // Through `labelText`, not raw: AC-19.1 re-renders these when the language
    // changes mid-stage, and a raw `setText` here would silently undo D41's
    // letter case every time it fired.
    this.wpmLabel.setText(this.labelText(this.copy.t("hud.wpm")));
    this.comboLabel.setText(this.labelText(this.copy.t("hud.combo")));
    this.scoreLabel.setText(this.labelText(this.copy.t("hud.score")));
    this.hullLabel.setText(this.labelText(this.copy.t("flight.hull")));
  }
}
