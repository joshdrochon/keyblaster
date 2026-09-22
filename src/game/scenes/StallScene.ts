import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import { hexToInt } from "@game/render/wordPlate.js";
import { SHADOW_HEIGHT, drawShadow, type ShadowFigure } from "@game/render/shadow.js";
import { FLIGHT_EVENTS, type Palette, paletteFor } from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
import type { Lang, StopId } from "@engine/types.js";
import { HIT_ZONE_PREFIX } from "@game/ui/focus.js";
import { INK } from "@game/ui/theme.js";
import { chrome, label } from "./lib/kit.js";
import { paintFocusRing, paintPlate } from "@game/ui/plate.js";
import { focusArrive, focusPulse } from "@game/ui/focusPop.js";

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
  /** 0 = retry, 1 = quit. Retry is the forward action and opens focused. */
  private focusIndex = 0;
  /** The ring's arrival and its breath, so moving focus replaces them. */
  private ringArriveTween: Phaser.Tweens.Tween | null = null;
  private ringPulseTween: Phaser.Tweens.Tween | null = null;
  private buttonBoxes: { x: number; y: number; w: number; h: number }[] = [];

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
    this.focusIndex = 0;
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
    const cardH = 396;
    const cardX = width / 2 - cardW / 2;
    const cardY = height / 2 - cardH / 2;

    const card = this.add.container(0, 0);
    // THE SHARED PLATE (UR-69), dressed from the stop's palette. The radius is
    // still 20 rather than the component's 16 because this card is the one
    // thing on a dimmed frame and its corner carries the "calm" read; it is a
    // PROP now, so it is a decision this screen states rather than a number
    // nobody else can see.
    const plate = this.add.graphics();
    paintPlate(
      plate,
      { x: cardX, y: cardY, w: cardW, h: cardH },
      {
        fill: this.palette.plate,
        alpha: 1,
        stroke: accent,
        strokeAlpha: 0.32,
        strokeWidth: 1,
        radius: 20,
        rhythm: "card",
      },
    );
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

    // TWO WAYS OUT. Retry was the only control, so a child who did not want to
    // fly the belt again had nowhere to go but the browser's back button.
    const buttonW = 300;
    const buttonH = 64;
    const buttonGap = 20;
    const pairW = buttonW * 2 + buttonGap;
    const buttonX = cardX + cardW / 2 - pairW / 2;
    const buttonY = cardY + cardH - 104;
    const quitX = buttonX + buttonW + buttonGap;
    this.buttonBoxes = [
      { x: buttonX, y: buttonY, w: buttonW, h: buttonH },
      { x: quitX, y: buttonY, w: buttonW, h: buttonH },
    ];

    const button = this.add.graphics();
    paintPlate(button, this.buttonBoxes[0]!, {
      fill: accent,
      alpha: 1,
      radius: 14,
      strokeWidth: 0,
      rhythm: "button",
    });
    card.add(button);

    const quitPlate = this.add.graphics();
    paintPlate(quitPlate, this.buttonBoxes[1]!, {
      fill: this.palette.plate,
      alpha: 1,
      radius: 14,
      strokeWidth: 2,
      stroke: this.palette.plateText,
      rhythm: "button",
    });
    card.add(quitPlate);

    const restart = chrome(
      this,
      buttonX + buttonW / 2,
      buttonY + buttonH / 2,
      this.copy.t("stall.restart"),
      undefined,
      { size: 24, color: this.palette.plate, lang: this.params.uiLang },
    ).setOrigin(0.5);
    card.add(restart);

    const quitLabel = chrome(
      this,
      quitX + buttonW / 2,
      buttonY + buttonH / 2,
      this.copy.t("stall.quit"),
      undefined,
      { size: 24, color: this.palette.plateText, lang: this.params.uiLang },
    ).setOrigin(0.5);
    card.add(quitLabel);

    // AC-18.1: whichever control holds focus says so visibly, and retry holds
    // it on arrival because it is the forward action.
    this.focusRing = this.add.graphics();
    this.ringArriveTween = null;
    this.ringPulseTween = null;
    this.paintRing();
    card.add(this.focusRing);
    // THE BREATH USED TO BE STARTED HERE, ONCE (UR-113): a bespoke
    // `0.5 -> 1` over 1100 ms on `Sine.InOut`, begun at create and left
    // running forever. Two things were wrong with that. It was a fourth set of
    // numbers for a state the rest of the game agrees on, and it did not
    // belong to a CONTROL - this screen has two buttons now, so the ring
    // snapped from Retry to Quit mid-exhale with no arrival at all.
    // `paintRing` owns both steps now, so they move with the focus.

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
      .on("pointerover", () => {
        this.focusIndex = 0;
        this.paintRing();
      })
      .on("pointerdown", () => this.requestRestart());

    this.add
      .zone(quitX, buttonY, buttonW, buttonH)
      .setOrigin(0, 0)
      .setName(`${HIT_ZONE_PREFIX}${STALL_QUIT_FOCUS_ID}`)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        this.focusIndex = 1;
        this.paintRing();
      })
      .on("pointerdown", () => this.requestQuit());

    const keyboard = this.input.keyboard;
    keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off("keydown", this.onKeyDown, this);
      this.ringArriveTween?.remove();
      this.ringArriveTween = null;
      this.ringPulseTween?.remove();
      this.ringPulseTween = null;
      delete window.__kbStall;
    });

    window.__kbStall = {
      ready: () => true,
      restart: () => this.requestRestart(),
      focusId: () => (this.focusIndex === 1 ? STALL_QUIT_FOCUS_ID : STALL_FOCUS_ID),
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.focusIndex = event.key === "ArrowLeft" ? 0 : 1;
      this.paintRing();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (this.focusIndex === 1) this.requestQuit();
      else this.requestRestart();
    }
  }

  private paintRing(): void {
    const box = this.buttonBoxes[this.focusIndex];
    if (box === undefined) return;
    this.focusRing.clear();
    // The app's focus colour, not this card's text colour: the ring means the
    // same thing here as everywhere else.
    paintFocusRing(this.focusRing, box, INK.accent, { radius: 14 });
    this.animateRing();
  }

  /**
   * Fade onto the button that now holds focus, then breathe - the shared two
   * steps (`ui/focusPop.focusArrive`, `focusPulse`), same as every other ring.
   */
  private animateRing(): void {
    this.ringArriveTween?.remove();
    this.ringArriveTween = null;
    this.ringPulseTween?.remove();
    this.ringPulseTween = null;
    const pulse = focusPulse(this.params.reducedMotion);
    const breathe = (): void => {
      if (pulse === null) {
        this.focusRing.setAlpha(1);
        return;
      }
      this.ringPulseTween = this.tweens.add({
        targets: this.focusRing,
        alpha: { from: pulse.alpha.from, to: pulse.alpha.to },
        duration: pulse.duration,
        ease: pulse.ease,
        yoyo: pulse.yoyo,
        repeat: pulse.repeat,
      });
    };
    const arrive = focusArrive();
    this.focusRing.setAlpha(arrive.alpha.from);
    this.ringArriveTween = this.tweens.add({
      targets: this.focusRing,
      alpha: arrive.alpha.to,
      duration: arrive.duration,
      ease: arrive.ease,
      onComplete: () => {
        this.ringArriveTween = null;
        breathe();
      },
    });
  }

  private requestQuit(): void {
    if (this.restarting) return;
    this.restarting = true;
    this.game.events.emit(FLIGHT_EVENTS.quit, { stopId: this.params.stopId });
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

/** The card's second control: leave the belt for the map. */
export const STALL_QUIT_FOCUS_ID = "stall.quit";

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
