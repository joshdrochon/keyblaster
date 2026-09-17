import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import { hexToInt } from "@game/render/wordPlate.js";
import { SHADOW_HEIGHT, drawShadow, type ShadowFigure } from "@game/render/shadow.js";
import { FLIGHT_EVENTS, type Palette, paletteFor } from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
import type { Lang, StopId } from "@engine/types.js";
import { HIT_ZONE_PREFIX } from "@game/ui/focus.js";
import { chrome, label } from "./lib/kit.js";

export interface StallSceneData {
  readonly stopId: StopId;
  readonly uiLang: Lang;
  readonly shipName: string;
  readonly colorblindPalette: boolean;
  readonly reducedMotion: boolean;
}

/**
 * SCREEN 6b - STALL (D29, AC-4.3, design-brief-v2.md section 6b).
 *
 * "Hull at zero: the ship sputters, dims, and sinks toward the bottom edge over
 * several seconds. No explosion, no red. A calm card: Shadow says one line, one
 * button restarts the stage. The per-word history is kept, and the design
 * should make that feel like 'try again,' not 'you lost.'"
 *
 * The sputter, dim and sink happen in FlightScene, which still holds the ship;
 * this scene is launched on top of that stalled frame once the sink is done, so
 * the card arrives at the end of a landing rather than cutting over an
 * explosion. Everything here is in the stop's own palette: no red exists in
 * this file, there is no score, no star count, no tally of what went wrong, and
 * Shadow's line names the thing that is kept rather than the thing that was
 * lost.
 *
 * Keyboard first (D37, AC-18.1): one control, focused the moment the card
 * appears, with a visible focus ring; Enter or Space flies the stage again.
 *
 * That one control is also the FORWARD action here - there is nothing else to
 * do from a stall but fly the stage again - so "the forward action holds focus
 * on entry" is satisfied by there being one, and `focusId` says so out loud for
 * the e2e rather than leaving it implied.
 *
 * It is clickable as well as typed. The keyboard path below is untouched and
 * still sufficient on its own; the pointer just stops being inert, because a
 * child who clicks the only button on a screen and gets nothing back has been
 * told the game is broken.
 */
export class StallScene extends Phaser.Scene {
  private copy!: FlightCopy;
  private palette!: Palette;
  private params!: StallSceneData;
  private focusRing!: Phaser.GameObjects.Graphics;
  /** The ONE Shadow (render/shadow.ts). See the note at the call site. */
  private shadow?: ShadowFigure;
  private restarting = false;

  private readonly font =
    "'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif";

  constructor() {
    super(SCENE_KEYS.stall);
  }

  init(data: Partial<StallSceneData>): void {
    this.params = {
      stopId: data.stopId ?? "mars",
      uiLang: data.uiLang ?? "en",
      shipName: data.shipName ?? "Lantern",
      colorblindPalette: data.colorblindPalette ?? false,
      reducedMotion: data.reducedMotion ?? false,
    };
    this.restarting = false;
  }

  create(): void {
    this.palette = paletteFor(this.params.stopId, this.params.colorblindPalette);
    this.copy = createFlightCopy(this.params.uiLang, { shipName: this.params.shipName });

    const width = this.scale.width;
    const height = this.scale.height;
    const accent = this.palette.accent;

    this.scene.bringToTop();

    // A calm dim over the stalled frame, not a curtain: the belt stays visible.
    const veil = this.add.graphics();
    veil.fillStyle(hexToInt(this.palette.plate), 0.62);
    veil.fillRect(0, 0, width, height);
    veil.setAlpha(0);
    this.tweens.add({ targets: veil, alpha: 1, duration: 520, ease: "Cubic.Out" });

    const cardW = 760;
    const cardH = 360;
    const cardX = width / 2 - cardW / 2;
    const cardY = height / 2 - cardH / 2;

    const card = this.add.container(0, 0);
    const plate = this.add.graphics();
    plate.fillStyle(hexToInt(this.palette.plate), 0.96);
    plate.fillRoundedRect(cardX, cardY, cardW, cardH, 20);
    plate.lineStyle(1, hexToInt(accent), 0.32);
    plate.strokeRoundedRect(cardX, cardY, cardW, cardH, 20);
    card.add(plate);

    /**
     * THE ONE SHADOW (D91, R-shadow).
     *
     * This scene used to carry a PRIVATE `drawShadow` in four hardcoded hex
     * literals - a second, unjudged Shadow on the card a child sees every time
     * they stall. It is the exact defect `G-one-shadow` was written for after
     * four menu scenes did the same thing, and it survived because that item's
     * regex was `export\s+function\s+drawShadow`, which cannot see a private
     * method (docs/verification-gaps.md instance 23). The item is now
     * member-aware, and this is the file it named.
     *
     * "idle", not "asleep": D29 ends the belt like a glider landing, and the
     * pose that goes with "try again" has its eyes open.
     */
    this.shadow = drawShadow(this, cardX + 108, cardY + 150, "idle", {
      scale: 168 / SHADOW_HEIGHT,
      reducedMotion: this.params.reducedMotion,
    });
    card.add(this.shadow.root);

    // UR-38: through the factory, so D41's letter case and increased letter
    // spacing reach this card like every other piece of chrome. It used to call
    // `add.text` directly and both accessibility settings stopped at its edge.
    const title = label(this, cardX + 200, cardY + 74, this.copy.t("stall.title"), {
      size: 38,
      color: this.palette.plateText,
      lang: this.params.uiLang,
    }).setOrigin(0, 0.5);
    card.add(title);

    const line = label(this, cardX + 200, cardY + 158, this.copy.t("stall.line"), {
      size: 24,
      color: this.palette.plateText,
      wrapWidth: cardW - 250,
      lang: this.params.uiLang,
    }).setOrigin(0, 0.5);
    card.add(line);

    const buttonW = 330;
    const buttonH = 64;
    const buttonX = cardX + cardW / 2 - buttonW / 2;
    const buttonY = cardY + cardH - 104;

    const button = this.add.graphics();
    button.fillStyle(hexToInt(accent), 0.92);
    button.fillRoundedRect(buttonX, buttonY, buttonW, buttonH, 14);
    card.add(button);

    const restart = chrome(
      this,
      buttonX + buttonW / 2,
      buttonY + buttonH / 2,
      this.copy.t("stall.restart"),
      undefined,
      { size: 24, color: this.palette.plate, lang: this.params.uiLang },
    ).setOrigin(0.5);
    card.add(restart);

    // AC-18.1: the only control is focused on arrival and says so visibly.
    this.focusRing = this.add.graphics();
    this.focusRing.lineStyle(3, hexToInt(this.palette.plateText), 0.95);
    this.focusRing.strokeRoundedRect(
      buttonX - 6,
      buttonY - 6,
      buttonW + 12,
      buttonH + 12,
      18,
    );
    card.add(this.focusRing);
    if (!this.params.reducedMotion) {
      this.tweens.add({
        targets: this.focusRing,
        alpha: { from: 0.5, to: 1 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }

    card.setAlpha(0);
    card.y = 28;
    this.tweens.add({
      targets: card,
      alpha: 1,
      y: 0,
      duration: 520,
      ease: "Cubic.Out",
    });

    // The same rectangle the focus ring is drawn around, as a hit area. It is
    // NOT added to `card`: the card slides in from 28 px down, and a hit area
    // that travels with it is a button whose edge moves under the cursor. The
    // card lands at y = 0, so a zone at the button's final box is correct for
    // every frame the player can actually aim at.
    this.add
      .zone(buttonX, buttonY, buttonW, buttonH)
      .setOrigin(0, 0)
      .setName(`${HIT_ZONE_PREFIX}${STALL_FOCUS_ID}`)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.requestRestart());

    const keyboard = this.input.keyboard;
    keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off("keydown", this.onKeyDown, this);
      delete window.__kbStall;
    });

    window.__kbStall = {
      ready: () => true,
      restart: () => this.requestRestart(),
      focusId: () => STALL_FOCUS_ID,
      button: () => ({ x: buttonX, y: buttonY, w: buttonW, h: buttonH }),
      texts: () => [
        this.copy.t("stall.title"),
        this.copy.t("stall.line"),
        this.copy.t("stall.restart"),
      ],
    };
  }

  /**
   * Ambient life, per frame. `ShadowFigure.update` creates no tween and no
   * timer (art-direction section 6), so this is the whole of the wiring - but
   * it does have to be CALLED, and a Shadow that never breathes on a card the
   * player is sitting in front of reads as a frozen build.
   */
  override update(time: number): void {
    this.shadow?.update(time);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.requestRestart();
    }
  }

  private requestRestart(): void {
    if (this.restarting) return;
    this.restarting = true;
    this.tweens.add({
      targets: this.focusRing,
      scale: { from: 1, to: 1.04 },
      duration: 160,
      ease: "Back.Out",
    });
    // FlightScene owns the restart: it still holds the word book, and AC-4.3
    // keeps that history across the retry.
    this.game.events.emit(FLIGHT_EVENTS.restart, { stopId: this.params.stopId });
  }
}

/** The id of the one control on this card. Exported so the e2e names it once. */
export const STALL_FOCUS_ID = "stall.restart";

export interface StallDebugApi {
  ready(): boolean;
  restart(): void;
  /** Which control holds focus on entry. There is one, and it is forward. */
  focusId(): string;
  /** The button's box, so a pointer test can click where the ring is drawn. */
  button(): { x: number; y: number; w: number; h: number };
  texts(): string[];
}

declare global {
  interface Window {
    __kbStall?: StallDebugApi;
  }
}
