import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import { hexToInt } from "@game/render/wordPlate.js";
import { FLIGHT_EVENTS, type Palette, paletteFor } from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
import type { Lang, StopId } from "@engine/types.js";

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
 * Keyboard only (D37, AC-18.1): one control, focused the moment the card
 * appears, with a visible focus ring; Enter or Space flies the stage again.
 */
export class StallScene extends Phaser.Scene {
  private copy!: FlightCopy;
  private palette!: Palette;
  private params!: StallSceneData;
  private focusRing!: Phaser.GameObjects.Graphics;
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

    card.add(this.drawShadow(cardX + 108, cardY + 150));

    const title = this.add
      .text(cardX + 200, cardY + 74, this.copy.t("stall.title"), {
        fontFamily: this.font,
        fontSize: "38px",
        color: this.palette.plateText,
      })
      .setOrigin(0, 0.5);
    card.add(title);

    const line = this.add
      .text(cardX + 200, cardY + 158, this.copy.t("stall.line"), {
        fontFamily: this.font,
        fontSize: "24px",
        color: this.palette.plateText,
        wordWrap: { width: cardW - 250 },
        lineSpacing: 6,
      })
      .setOrigin(0, 0.5);
    card.add(line);

    const buttonW = 330;
    const buttonH = 64;
    const buttonX = cardX + cardW / 2 - buttonW / 2;
    const buttonY = cardY + cardH - 104;

    const button = this.add.graphics();
    button.fillStyle(hexToInt(accent), 0.92);
    button.fillRoundedRect(buttonX, buttonY, buttonW, buttonH, 14);
    card.add(button);

    const label = this.add
      .text(
        buttonX + buttonW / 2,
        buttonY + buttonH / 2,
        this.copy.t("stall.restart"),
        {
          fontFamily: this.font,
          fontSize: "24px",
          color: this.palette.plate,
        },
      )
      .setOrigin(0.5);
    card.add(label);

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

    const keyboard = this.input.keyboard;
    keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off("keydown", this.onKeyDown, this);
      delete window.__kbStall;
    });

    window.__kbStall = {
      ready: () => true,
      restart: () => this.requestRestart(),
      texts: () => [
        this.copy.t("stall.title"),
        this.copy.t("stall.line"),
        this.copy.t("stall.restart"),
      ],
    };
  }

  /** Shadow (D66, D91): dark body, glowing face plate, never says "no". */
  private drawShadow(x: number, y: number): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    const body = hexToInt("#23262E");
    const rim = hexToInt("#E8DFC9");
    const glow = hexToInt("#9FD8F0");

    g.fillStyle(glow, 0.12);
    g.fillEllipse(0, 62, 96, 22);

    g.lineStyle(3, body, 1);
    g.lineBetween(0, -60, 0, -76);
    g.fillStyle(glow, 1);
    g.fillCircle(0, -80, 5);

    g.fillStyle(body, 1);
    g.fillCircle(0, 0, 58);
    g.fillRoundedRect(-74, -12, 22, 34, 10);
    g.fillRoundedRect(52, -12, 22, 34, 10);

    g.fillStyle(rim, 1);
    g.fillCircle(0, -6, 38);
    g.fillStyle(body, 1);
    g.fillCircle(0, -6, 33);

    g.fillStyle(glow, 1);
    g.fillCircle(-13, -8, 7);
    g.fillCircle(13, -8, 7);

    g.fillStyle(rim, 0.5);
    g.fillCircle(34, 22, 7);

    const container = this.add.container(x, y, [g]);
    if (!this.params.reducedMotion) {
      this.tweens.add({
        targets: container,
        y: y - 6,
        duration: 2400,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }
    return container;
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

export interface StallDebugApi {
  ready(): boolean;
  restart(): void;
  texts(): string[];
}

declare global {
  interface Window {
    __kbStall?: StallDebugApi;
  }
}
