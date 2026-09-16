import Phaser from "phaser";
import { STOP_IDS, type StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum, paletteFor } from "@game/render/palette";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { DUR, INK, TYPE } from "@game/ui/theme";
import { goTo, type StoryInit } from "./lib/init";
import {
  createFocusRing,
  createKeyboardMenu,
  label,
  plate,
  visibleText,
  type FocusRing,
  type FocusTarget,
  type KeyboardMenu,
  type SceneSnapshot,
} from "./lib/kit";
import {
  laneInit,
  latchOnRender,
  publishBag,
  textStyles,
  type DrawLatch,
  type LaneInit,
} from "./support/laneInit";

/**
 * SCREEN 12 - ENDING CARD (design-brief-v2.md "12. Ending card";
 * story-draft-v1.md "Ending card (after Pluto's beacon)").
 *
 * "The Director map zooms out. Seven beacons blink from Earth to Pluto in a
 * line. Shadow: 'Every ship that comes after us will see these. You drew the
 * map.' Then the results screen."
 *
 * The three beats are the three things this scene does, in that order, and they
 * are the whole screen. It is deliberately small: the moment is the beacons
 * lighting one after another, and anything else on screen competes with it.
 *
 * WHY IT DRAWS ITS OWN MAP RATHER THAN REUSING DirectorMap. The Director map is
 * another lane's scene and is interactive - focusable stops, travel, star
 * ratings. This is a card, not a map: nothing here is selectable, the line is
 * the route rather than the route's UI, and zooming a live menu out to a
 * tenth of its size would leave a screen full of controls a child cannot press.
 *
 * Each beacon wears its OWN stop's accent, so the line reads as seven different
 * places and not as one repeated dot (D13, palette rubric item 7).
 */

const LINE_Y = 470;
const LINE_FROM = 260;
const LINE_TO = 1660;
const BEACON_INTERVAL_MS = 260;
const ZOOM_MS = 1800;
const BUTTON = { x: 160, y: 946, w: 520, h: 64 } as const;

export interface EndingInit extends StoryInit {
  readonly payload?: Record<string, unknown>;
}

export class EndingScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: EndingInit | undefined;

  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;
  private menu!: KeyboardMenu;
  private lampAlpha = new Map<StopId, Phaser.GameObjects.Graphics>();
  private litOrder: StopId[] = [];
  private shadowLine!: Phaser.GameObjects.Text;
  /** Latched on a render pass; see `latchOnRender`. Never sampled. */
  private shadowLineDrawn!: DrawLatch;
  private focusRingDrawn!: DrawLatch;

  constructor() {
    super(SCENE_KEYS.ending);
  }

  init(data: EndingInit | undefined): void {
    this.initData = data;
    this.litOrder = [];
    this.lampAlpha = new Map();
  }

  create(): void {
    // The card is played from Pluto, so the frame wears Pluto's palette even if
    // the caller forgot to say where it came from.
    this.lane = laneInit(this, this.initData, "pluto");

    this.parallax = buildParallax(this, {
      palette: this.lane.palette,
      reducedMotion: this.lane.reducedMotion,
      worldSpeed: 0,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: 0x9f01,
    });

    const hud = this.parallax.layerOf("hud").container;
    hud.add(this.buildHeader());
    hud.add(this.buildRoute());
    hud.add(this.buildShadow());
    hud.add(this.buildButton());

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    const target: FocusTarget = {
      id: "ending-continue",
      x: BUTTON.x,
      y: BUTTON.y,
      w: BUTTON.w,
      h: BUTTON.h,
      activate: () => this.toResults(),
    };
    this.menu = createKeyboardMenu(this, this.ring, [target]);
    this.shadowLineDrawn = latchOnRender(
      this,
      () => this.shadowLine.visible && this.shadowLine.alpha > 0.02,
    );
    this.focusRingDrawn = latchOnRender(this, () => this.ring.graphics.visible);

    this.playCard();
    this.publish();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu.destroy();
      this.ring.destroy();
      this.shadow.destroy();
      this.parallax.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private buildHeader(): Phaser.GameObjects.GameObject[] {
    return [
      label(this, 160, 150, this.lane.copy.text("ending.heading"), {
        size: TYPE.heading,
        color: this.lane.palette.accent,
        lang: this.lane.lang,
      }),
    ];
  }

  private x(index: number): number {
    const span = LINE_TO - LINE_FROM;
    return LINE_FROM + (span * index) / (STOP_IDS.length - 1);
  }

  /** The route: one line, seven lamps, each in its own stop's accent. */
  private buildRoute(): Phaser.GameObjects.GameObject[] {
    const made: Phaser.GameObjects.GameObject[] = [];

    const rail = this.add.graphics();
    rail.lineStyle(3, hexToNum(INK.line), 0.9);
    rail.lineBetween(LINE_FROM, LINE_Y, LINE_TO, LINE_Y);
    made.push(rail);

    STOP_IDS.forEach((stopId, i) => {
      const accent = paletteFor(stopId).accent;
      const cx = this.x(i);

      const dark = this.add.graphics();
      dark.fillStyle(hexToNum(INK.locked), 1);
      dark.fillCircle(cx, LINE_Y, 9);
      made.push(dark);

      const lamp = this.add.graphics();
      lamp.fillStyle(hexToNum(accent), 0.18);
      lamp.fillCircle(cx, LINE_Y, 34);
      lamp.fillStyle(hexToNum(accent), 1);
      lamp.fillCircle(cx, LINE_Y, 11);
      lamp.setAlpha(0);
      made.push(lamp);
      this.lampAlpha.set(stopId, lamp);

      made.push(
        label(this, cx, LINE_Y + 46, this.lane.copy.stopName(stopId), {
          size: TYPE.caption,
          color: INK.textDim,
          align: "center",
          lang: this.lane.lang,
        }).setOrigin(0.5, 0),
      );
    });

    return made;
  }

  private buildShadow(): Phaser.GameObjects.GameObject[] {
    this.shadow = drawShadow(this, 280, 760, "saluting", {
      scale: 0.95,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("hud").depth,
    });

    const made: Phaser.GameObjects.GameObject[] = [
      plate(this, 400, 690, 1260, 150, { fill: INK.panel, stroke: INK.line }),
    ];

    // Shadow's closing line, verbatim from story-draft-v1.md.
    this.shadowLine = label(this, 440, 726, this.lane.copy.text("ending.shadowLine"), {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: 1180,
      lang: this.lane.lang,
    });
    this.shadowLine.setAlpha(0);
    made.push(this.shadowLine);
    return made;
  }

  private buildButton(): Phaser.GameObjects.GameObject[] {
    const made: Phaser.GameObjects.GameObject[] = [
      plate(this, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, {
        fill: INK.panelRaised,
        stroke: INK.line,
      }),
    ];
    const t = label(
      this,
      BUTTON.x + BUTTON.w / 2,
      BUTTON.y + BUTTON.h / 2,
      this.lane.copy.text("ending.continue"),
      { size: TYPE.label, color: this.lane.palette.accent, align: "center", lang: this.lane.lang },
    );
    t.setOrigin(0.5);
    made.push(t);
    return made;
  }

  // -------------------------------------------------------------------------
  // The card
  // -------------------------------------------------------------------------

  /**
   * Zoom out, then blink the beacons Earth to Pluto, then Shadow speaks.
   *
   * Under reduced motion the zoom is dropped (it is camera motion, which D41
   * removes) but the beacons still light in sequence: the sequence is the
   * content of the screen, not decoration, and removing it would remove the
   * ending.
   */
  private playCard(): void {
    if (!this.lane.reducedMotion) {
      this.cameras.main.setZoom(1.5);
      this.tweens.add({
        targets: this.cameras.main,
        zoom: 1,
        duration: ZOOM_MS,
        ease: EASE.arrive,
      });
    }

    const start = this.lane.reducedMotion ? 200 : ZOOM_MS * 0.55;
    STOP_IDS.forEach((stopId, i) => {
      this.time.delayedCall(start + i * BEACON_INTERVAL_MS, () => {
        const lamp = this.lampAlpha.get(stopId);
        if (lamp === undefined) return;
        this.litOrder.push(stopId);
        if (this.lane.reducedMotion) {
          lamp.setAlpha(1);
          return;
        }
        this.tweens.add({
          targets: lamp,
          alpha: 1,
          duration: 300,
          ease: EASE.pop,
          onComplete: () => {
            // The blink that never stops: on the map these seven are lit
            // forever after (D13).
            this.tweens.add({
              targets: lamp,
              alpha: { from: 1, to: 0.62 },
              duration: 1400,
              yoyo: true,
              repeat: -1,
              ease: EASE.drift,
            });
          },
        });
      });
    });

    const lineAt = start + STOP_IDS.length * BEACON_INTERVAL_MS + 200;
    this.time.delayedCall(lineAt, () => {
      if (this.lane.reducedMotion) {
        this.shadowLine.setAlpha(1);
        return;
      }
      this.tweens.add({
        targets: this.shadowLine,
        alpha: 1,
        duration: DUR.panel,
        ease: EASE.arrive,
      });
    });
  }

  private toResults(): void {
    goTo(this, SCENE_KEYS.results, {
      ctx: this.lane.ctx,
      progress: this.lane.progress,
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.lane.stopId,
      ...(this.initData?.payload ?? {}),
    } as StoryInit);
  }

  override update(_time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(this.time.now);
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.ending,
      stopId: this.lane.stopId,
      accent: this.lane.palette.accent,
      beacons: STOP_IDS.length,
      litOrder: [...this.litOrder],
      litCount: this.litOrder.length,
      shadowLine: this.shadowLine.text,
      shadowLineVisible: this.shadowLineDrawn.drawn,
      zoom: this.cameras.main.zoom,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusRingVisible: this.focusRingDrawn.drawn,
      reducedMotion: this.lane.reducedMotion,
      nextScene: SCENE_KEYS.results,
    };
  }

  private publish(): void {
    publishBag("ending", {
      snapshot: () => this.snapshot(),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
    });
  }
}
