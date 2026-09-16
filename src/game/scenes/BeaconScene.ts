import Phaser from "phaser";
import { beaconReadout, type BeaconResult } from "@engine/ephemeris";
import type { StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum } from "@game/render/palette";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { DUR, INK, TYPE } from "@game/ui/theme";
import { hasStageBundle, stageBundle } from "./lib/content";
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
import { audioFrom } from "@game/audio/wiring";

/**
 * SCREEN 8 - BEACON PLACEMENT (design-brief-v2.md "8. Beacon placement";
 * D15, D81; PRD FR-17 / AC-17.0, AC-17.1, AC-17.3).
 *
 * The beacon drops onto the planet, lights, and says where it is - for real.
 * `@engine/ephemeris` computes heliocentric ecliptic coordinates for the play
 * date from the JPL approximate elements and is tested against live JPL
 * Horizons values. This scene computes nothing and formats nothing:
 * `formatBeaconCoords` and `formatPulsarFix` already produce the exact D81
 * strings, so the readout is printed verbatim. Re-rounding it here would be a
 * second, quieter definition of the same format.
 *
 * THE FAILURE BRANCH IS THE ONE THAT MATTERS. `beaconReadout` returns a
 * discriminated union, and `ok: false` happens for real - a device clock set to
 * 1776, or to nothing at all. The engine's own header says the union exists
 * because "the scene has to render *something* even when the device clock is
 * nonsense". So this scene branches on `ok` and, with no coordinates, says the
 * beacon is calibrating: same plate, same place, same colour, the stop's
 * flavour line still underneath. It is never an error, never a warning colour,
 * and the literal "NaN" cannot reach a child because no number is formatted in
 * this file at all.
 */

const READOUT = { x: 160, y: 664, w: 1600, h: 268 } as const;
const BUTTON = { x: 160, y: 966, w: 420, h: 64 } as const;

export interface BeaconInit extends StoryInit {
  /**
   * The play date (AC-17.1). Injected rather than read off the wall clock, so
   * every test is deterministic; production passes nothing and gets `now`.
   */
  readonly date?: Date | string | number;
  readonly payload?: Record<string, unknown>;
}

export class BeaconScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: BeaconInit | undefined;
  private stopId: StopId = "mars";

  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;
  private menu!: KeyboardMenu;

  private readout!: BeaconResult;
  private coordsLabel!: Phaser.GameObjects.Text;
  private pulsarLabel!: Phaser.GameObjects.Text;
  private flavourLabel!: Phaser.GameObjects.Text;
  private mast!: Phaser.GameObjects.Container;
  private lit = false;
  /** Latched on a render pass; see `latchOnRender`. Never sampled. */
  private focusRingDrawn!: DrawLatch;

  constructor() {
    super(SCENE_KEYS.beacon);
  }

  init(data: BeaconInit | undefined): void {
    this.initData = data;
    this.lit = false;
  }

  create(): void {
    this.lane = laneInit(this, this.initData, "mars");
    this.stopId = this.lane.stopId;

    this.parallax = buildParallax(this, {
      palette: this.lane.palette,
      reducedMotion: this.lane.reducedMotion,
      // The ship has arrived. The world breathes; it does not travel.
      worldSpeed: 0,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: 0x8e11,
    });

    this.readout = beaconReadout(this.stopId, this.playDate());

    const hud = this.parallax.layerOf("hud").container;
    this.drawPlanetLimb();
    hud.add(this.buildHeader());
    hud.add(this.buildReadout());
    this.buildBeacon();

    this.shadow = drawShadow(this, 300, 470, "saluting", {
      scale: 0.9,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("shipFx").depth,
    });

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    const target: FocusTarget = {
      id: "beacon-continue",
      x: BUTTON.x,
      y: BUTTON.y,
      w: BUTTON.w,
      h: BUTTON.h,
      activate: () => this.advance(),
    };
    hud.add(this.buildButton());
    this.menu = createKeyboardMenu(this, this.ring, [target]);
    this.focusRingDrawn = latchOnRender(this, () => this.ring.graphics.visible);

    this.publish();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu.destroy();
      this.ring.destroy();
      this.shadow.destroy();
      this.parallax.destroy();
    });
  }

  /**
   * A `Date` from whatever the caller (or the URL, for the e2e) had.
   *
   * An unparseable value yields an Invalid Date, which `beaconReadout`
   * classifies as `invalid-date` and turns into the calibrating branch. That is
   * the behaviour we want, so it is deliberately NOT guarded here: catching it
   * early would only move the same decision somewhere less tested.
   */
  private playDate(): Date {
    const given = this.initData?.date ?? this.lane.params.get("date");
    if (given instanceof Date) return given;
    if (typeof given === "number") return new Date(given);
    if (typeof given === "string") return new Date(given);
    return new Date();
  }

  // -------------------------------------------------------------------------
  // World
  // -------------------------------------------------------------------------

  /** The planet's limb across the bottom of the frame. */
  private drawPlanetLimb(): void {
    const pal = this.lane.palette;
    const W = this.scale.width;
    const H = this.scale.height;
    const g = this.add.graphics();
    const deep = pal.colors[pal.colors.length - 2] ?? pal.accent;
    const mid = pal.colors[2] ?? pal.accent;

    g.fillStyle(hexToNum(mid), 1);
    g.fillEllipse(W / 2, H + 430, W * 1.6, 1220);
    g.fillStyle(hexToNum(deep), 0.5);
    g.fillEllipse(W / 2 - 240, H + 360, W * 1.1, 1000);
    g.lineStyle(3, hexToNum(pal.accent), 0.3);
    g.strokeEllipse(W / 2, H + 430, W * 1.6, 1220);
    this.parallax.layerOf("farField").container.add(g);
  }

  private headline(): { headline: string; state: string; flavour: string } {
    if (!hasStageBundle(this.stopId)) {
      return { headline: this.lane.copy.stopName(this.stopId), state: "", flavour: "" };
    }
    const b = stageBundle(this.stopId);
    return { headline: b.beaconHeadline, state: b.beaconState, flavour: b.beaconFlavor };
  }

  private buildHeader(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const { headline, state } = this.headline();
    const made: Phaser.GameObjects.GameObject[] = [];

    // The headline and state are content proper nouns from the stage bundle
    // ("MARS BEACON", "PLACED"), not UI copy: they are the beacon's own words.
    made.push(
      label(this, 160, 96, headline, {
        size: TYPE.heading,
        color: pal.accent,
        lang: this.lane.lang,
      }),
    );
    made.push(
      label(this, 160, 156, state, {
        size: TYPE.body,
        color: pal.plateText,
        alpha: 0.75,
        lang: this.lane.lang,
      }),
    );
    made.push(
      label(
        this,
        160,
        206,
        this.lane.copy.text("beacon.placed", { stop: this.lane.copy.stopName(this.stopId) }),
        { size: TYPE.label, color: pal.plateText, alpha: 0.6, lang: this.lane.lang },
      ),
    );
    return made;
  }

  /**
   * AC-17.0. Two lines printed exactly as the engine formatted them, plus the
   * stop's flavour sentence. With no coordinates the first line becomes the
   * calibrating sentence and the second is simply absent; the plate keeps its
   * size, its position and its colour, and nothing announces a failure.
   */
  private buildReadout(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];
    const ok = this.readout.ok;

    made.push(
      plate(this, READOUT.x, READOUT.y, READOUT.w, READOUT.h, {
        fill: INK.panel,
        stroke: INK.line,
      }),
    );

    this.coordsLabel = label(
      this,
      READOUT.x + 48,
      READOUT.y + 44,
      ok ? this.readout.coordsLine : this.lane.copy.text("beacon.calibrating"),
      { size: 42, color: INK.text, lang: this.lane.lang, wrapWidth: READOUT.w - 96 },
    );
    made.push(this.coordsLabel);

    this.pulsarLabel = label(
      this,
      READOUT.x + 48,
      READOUT.y + 116,
      ok ? this.readout.pulsarLine : "",
      { size: TYPE.label, color: pal.accent, alpha: 0.9, lang: this.lane.lang },
    );
    this.pulsarLabel.setVisible(ok);
    made.push(this.pulsarLabel);

    this.flavourLabel = label(
      this,
      READOUT.x + 48,
      READOUT.y + 172,
      this.headline().flavour,
      {
        size: TYPE.body,
        color: INK.text,
        alpha: 0.78,
        wrapWidth: READOUT.w - 96,
        lang: this.lane.lang,
      },
    );
    made.push(this.flavourLabel);
    return made;
  }

  /** The beacon: a mast, a lamp, and a halo that comes up when it lights. */
  private buildBeacon(): void {
    const pal = this.lane.palette;
    const accent = hexToNum(pal.accent);
    const deep = hexToNum(pal.colors[pal.colors.length - 1] ?? "#0E1116");
    const groundY = 560;
    const c = this.add.container(1420, groundY - 560);

    const g = this.add.graphics();
    g.fillStyle(deep, 1);
    g.fillRoundedRect(-14, -58, 28, 152, 10);
    g.fillTriangle(-48, 98, 48, 98, 0, 56);
    g.fillStyle(accent, 1);
    g.fillCircle(0, -80, 22);
    g.fillStyle(accent, 0.22);
    g.fillCircle(0, -80, 48);
    c.add(g);

    const halo = this.add.graphics();
    halo.fillStyle(accent, 0.15);
    halo.fillCircle(0, -80, 140);
    halo.setAlpha(0);
    c.add(halo);

    this.mast = c;
    this.parallax.layerOf("shipFx").container.add(c);

    const light = (): void => {
      this.lit = true;
      // AC-21.3 `beacon`: a clear bell, the reward tone of the whole game, on
      // the frame the lamp comes up rather than when the scene opens.
      audioFrom(this.registry)?.play("beacon", "beacon-scene:lit");
      if (this.lane.reducedMotion) {
        halo.setAlpha(1);
        return;
      }
      this.tweens.add({
        targets: halo,
        alpha: { from: 0.4, to: 1 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: EASE.drift,
      });
    };

    if (this.lane.reducedMotion) {
      c.y = groundY;
      light();
      return;
    }
    this.tweens.add({
      targets: c,
      y: groundY,
      duration: 900,
      ease: EASE.arrive,
      onComplete: () => {
        this.tweens.add({
          targets: c,
          scale: { from: 0.94, to: 1 },
          duration: 320,
          ease: EASE.pop,
          onComplete: light,
        });
      },
    });
  }

  private buildButton(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];
    made.push(
      plate(this, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, {
        fill: INK.panelRaised,
        stroke: INK.line,
      }),
    );
    const text = label(
      this,
      BUTTON.x + BUTTON.w / 2,
      BUTTON.y + BUTTON.h / 2,
      this.lane.copy.text("beacon.continue"),
      { size: TYPE.label, color: pal.accent, align: "center", lang: this.lane.lang },
    );
    text.setOrigin(0.5);
    made.push(text);
    made.push(
      label(
        this,
        BUTTON.x + BUTTON.w + 28,
        BUTTON.y + BUTTON.h / 2 - 12,
        this.lane.copy.text("beacon.hint"),
        { size: TYPE.caption, color: INK.textDim, alpha: 0.7, lang: this.lane.lang },
      ),
    );
    return made;
  }

  /**
   * Pluto's beacon is the last one, so it hands over to the ending card; every
   * other stop goes straight to the stage report (design brief screens 9, 12).
   */
  private advance(): void {
    const next = this.stopId === "pluto" ? SCENE_KEYS.ending : SCENE_KEYS.results;
    this.cameras.main.fadeOut(DUR.panel, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      goTo(this, next, {
        ctx: this.lane.ctx,
        progress: this.lane.progress,
        shipName: this.lane.shipName,
        lang: this.lane.lang,
        stopId: this.stopId,
        ...(this.initData?.payload ?? {}),
      } as StoryInit);
    });
  }

  override update(_time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(this.time.now);
  }

  // -------------------------------------------------------------------------
  // Debug surface for the e2e suite
  // -------------------------------------------------------------------------

  snapshot(): SceneSnapshot {
    const coords = this.coordsLabel.text;
    const pulsar = this.pulsarLabel.text;
    return {
      scene: SCENE_KEYS.beacon,
      stopId: this.stopId,
      accent: this.lane.palette.accent,
      ok: this.readout.ok,
      reason: this.readout.ok ? null : this.readout.reason,
      coordsLine: coords,
      pulsarLine: pulsar,
      pulsarVisible: this.pulsarLabel.visible,
      flavourLine: this.flavourLabel.text,
      /**
       * AC-17.0's own guard. Nothing rendered may contain "NaN", "Infinity" or
       * "undefined": those are the three ways a bad clock reaches a child.
       */
      poisoned: /NaN|Infinity|undefined/.test(`${coords} ${pulsar}`),
      lit: this.lit,
      beaconY: this.mast.y,
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusRingVisible: this.focusRingDrawn.drawn,
      reducedMotion: this.lane.reducedMotion,
      nextScene: this.stopId === "pluto" ? SCENE_KEYS.ending : SCENE_KEYS.results,
    };
  }

  private publish(): void {
    publishBag("beacon", {
      snapshot: () => this.snapshot(),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
      parallaxOffsets: () => this.parallax.debugOffsets(),
    });
  }
}
