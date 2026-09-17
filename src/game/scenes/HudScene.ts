import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import { layer } from "@game/render/layers.js";
import { hexToInt } from "@game/render/wordPlate.js";
import { FLIGHT_EVENTS, type HudSnapshot } from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
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

    const left = this.plate(24, 22, 236, 92, plate, accent);
    left.setDepth(layer("hud").depth);

    this.wpmValue = this.text(44, 40, "0", plateText, 34);
    this.wpmLabel = this.text(44, 78, this.copy.t("hud.wpm"), accent, 16);
    this.comboValue = this.text(150, 40, "x1", accent, 34);
    this.comboLabel = this.text(150, 78, this.copy.t("hud.combo"), plateText, 16);

    const right = this.plate(
      this.scale.width - 260,
      22,
      236,
      92,
      plate,
      accent,
    );
    right.setDepth(layer("hud").depth);

    this.scoreValue = this.text(this.scale.width - 240, 40, "0", plateText, 34);
    this.scoreLabel = this.text(
      this.scale.width - 240,
      78,
      this.copy.t("hud.score"),
      accent,
      16,
    );

    this.hullLabel = this.text(
      this.scale.width - 132,
      78,
      this.copy.t("flight.hull"),
      plateText,
      16,
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
   * and the next one written would be a new leak. Paused and sleeping both
   * count as alive: the pause menu freezes the belt (and the readouts stay, on
   * purpose - it is a pause, not an exit), and D30's warp break keeps Flight
   * running underneath it.
   */
  override update(): void {
    const flight = SCENE_KEYS.flight;
    if (this.scene.manager.keys[flight] === undefined) return;
    const alive =
      this.scene.isActive(flight) ||
      this.scene.isPaused(flight) ||
      this.scene.isSleeping(flight);
    if (!alive) this.scene.stop();
  }

  private plate(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    accent: string,
  ): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(hexToInt(fill), 0.86);
    g.fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(1, hexToInt(accent), 0.3);
    g.strokeRoundedRect(x, y, w, h, 12);
    return g;
  }

  private text(
    x: number,
    y: number,
    value: string,
    colour: string,
    size: number,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, value, {
        fontFamily: this.font,
        fontSize: `${size}px`,
        color: colour,
      })
      .setDepth(layer("hud").depth + 1);
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

    this.hullMarks.forEach((mark, i) => {
      mark.setAlpha(hullMarkAlpha(i, snapshot.hull, snapshot.maxHull));
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
    this.wpmLabel.setText(this.copy.t("hud.wpm"));
    this.comboLabel.setText(this.copy.t("hud.combo"));
    this.scoreLabel.setText(this.copy.t("hud.score"));
    this.hullLabel.setText(this.copy.t("flight.hull"));
  }
}
