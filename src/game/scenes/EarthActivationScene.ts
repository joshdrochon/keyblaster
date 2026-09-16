import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { INK, TYPE } from "@game/ui/theme";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import {
  createFocusRing,
  createKeyboardMenu,
  label,
  plate,
  visibleText,
  type FocusTarget,
  type KeyboardMenu,
  type SceneSnapshot,
  type Snapshotable,
} from "./lib/kit";
import { createWordPrompt, type WordPrompt } from "./lib/typedWord";
import { stageBundle } from "./lib/content";
import { goTo, persistStopCleared, resolveInit, type ResolvedInit, type StoryInit } from "./lib/init";
import { markStopCleared } from "@engine/progress/index.js";

/**
 * Screen inventory row 2b - Earth activation (D57, AC-12.1).
 *
 * The launchpad at night. Earth's beacon is already built and it is DARK;
 * Shadow asks for one word, `launch`, and the light comes on. Earth has no
 * belt, so this is the only place in the game where one word is the whole
 * interaction - which is the point: it is the tutorial for the beacon moment
 * at screen 8, and the design brief asks it to look like a smaller version of
 * that screen.
 *
 * Two things carry "smaller version of screen 8" concretely:
 *   - the lamp, its bloom, its expanding rings and its column of light are the
 *     same drawing the beacon screen will use, at a smaller radius;
 *   - the word goes through `@engine/lock` (lib/typedWord.ts), so the keystroke
 *     feel is the same code path as flight rather than an imitation of it.
 *
 * The dark beacon is never drawn as broken: no red, no cross, no alarm (D31,
 * AC-22b.1). It is a lamp that is off, in a palette where off reads as waiting.
 */
const BEACON_X = GAME_WIDTH * 0.5;
const BEACON_Y = GAME_HEIGHT * 0.46;
const BUTTON_W = 420;
const BUTTON_H = 88;
const BUTTON_Y = GAME_HEIGHT * 0.87;

export class EarthActivationScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private prompt: WordPrompt | null = null;
  private menu: KeyboardMenu | null = null;
  private lampG!: Phaser.GameObjects.Graphics;
  private beamG!: Phaser.GameObjects.Graphics;
  private ringsG!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private litText!: Phaser.GameObjects.Text;
  private continueText!: Phaser.GameObjects.Text;
  private continuePlate!: Phaser.GameObjects.Graphics;
  private lit = false;
  private litAtMs = 0;
  private word = "";

  constructor() {
    super(SCENE_KEYS.earthActivation);
  }

  init(data: StoryInit): void {
    this.story = resolveInit(data, "earth");
    this.lit = false;
    this.litAtMs = 0;
    this.prompt = null;
    this.menu = null;
  }

  create(): void {
    const { text, ctx } = this.story;
    const pal = paletteAt("earth", ctx.colorblindPalette);
    const bundle = stageBundle("earth");
    // AC-12.1's word is content, not a constant hiding in a scene.
    this.word = bundle.activationWord ?? "";

    this.cameras.main.setBackgroundColor(INK.bgDeep);
    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: ctx.reducedMotion,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      // No debris plane: Earth has no belt (D57).
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: 0x3a12,
    });

    this.beamG = this.add.graphics().setDepth(4);
    this.ringsG = this.add.graphics().setDepth(5);
    this.drawMast(pal.accent);
    this.lampG = this.add.graphics().setDepth(7);
    this.paintLamp(pal.accent, 0);

    // --- status chip ------------------------------------------------------
    const chipW = 520;
    plate(this, GAME_WIDTH / 2 - chipW / 2, 76, chipW, 76, { alpha: 0.92 }).setDepth(9);
    this.statusText = label(
      this,
      GAME_WIDTH / 2,
      114,
      `${text.text("earth.heading")}  ·  ${text.text("earth.status.dark")}`,
      { size: TYPE.label, color: INK.textDim, align: "center", lang: this.story.lang },
    )
      .setOrigin(0.5)
      .setDepth(10);

    // --- Shadow and his line ---------------------------------------------
    this.shadow = drawShadow(this, 300, GAME_HEIGHT * 0.63, "pointing", {
      scale: 1.05,
      reducedMotion: ctx.reducedMotion,
      depth: 12,
    });

    const lineW = 760;
    const lineX = 440;
    const lineY = GAME_HEIGHT * 0.63 - 140;
    plate(this, lineX, lineY, lineW, 156, { alpha: 0.92 }).setDepth(11);
    label(this, lineX + 36, lineY + 32, bundle.preflightLine, {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: lineW - 72,
      lang: this.story.lang,
    }).setDepth(12);

    // --- the one word -----------------------------------------------------
    label(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT * 0.76,
      text.text("earth.typePrompt", { word: this.word }),
      { size: TYPE.label, color: INK.textDim, align: "center", lang: this.story.lang },
    )
      .setOrigin(0.5)
      .setDepth(12);

    this.prompt = createWordPrompt(this, {
      word: this.word,
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT * 0.87,
      size: TYPE.display,
      accent: pal.accent,
      plateFill: pal.plate,
      plateText: pal.plateText,
      parkGraceMs: this.story.calibration.ikiMs * 1.5,
      reducedMotion: ctx.reducedMotion,
      depth: 13,
      onComplete: () => this.lightBeacon(pal.accent),
    });

    // --- the lit copy and the one button, hidden until the light ----------
    this.litText = label(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.76, text.text("earth.lit"), {
      size: TYPE.heading,
      color: INK.accentSoft,
      align: "center",
      lang: this.story.lang,
    })
      .setOrigin(0.5)
      .setDepth(14)
      .setAlpha(0);

    this.continuePlate = plate(
      this,
      GAME_WIDTH / 2 - BUTTON_W / 2,
      BUTTON_Y,
      BUTTON_W,
      BUTTON_H,
      { fill: INK.panelRaised, stroke: INK.accent },
    )
      .setDepth(14)
      .setAlpha(0);
    this.continueText = label(
      this,
      GAME_WIDTH / 2,
      BUTTON_Y + BUTTON_H / 2,
      text.text("earth.continue"),
      { size: TYPE.label, color: INK.text, align: "center", lang: this.story.lang },
    )
      .setOrigin(0.5)
      .setDepth(15)
      .setAlpha(0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  /** The launchpad mast. Drawn once; lighting the beacon never re-tints it. */
  private drawMast(accent: string): void {
    const g = this.add.graphics().setDepth(6);
    const x = BEACON_X;
    const y = BEACON_Y;
    const baseY = y + 330;
    g.fillStyle(hexToNum(INK.bgDeep), 1);
    g.fillTriangle(x - 104, baseY, x + 104, baseY, x, y + 26);
    g.fillStyle(hexToNum(INK.panelRaised), 1);
    g.fillTriangle(x - 84, baseY, x + 84, baseY, x, y + 40);
    g.lineStyle(3, hexToNum(INK.line), 1);
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const halfW = 84 * t;
      const yy = baseY - (baseY - (y + 40)) * (1 - t);
      g.lineBetween(x - halfW, yy, x + halfW, yy);
    }
    g.lineBetween(x - 84, baseY, x, y + 40);
    g.lineBetween(x + 84, baseY, x, y + 40);
    // Lamp housing: cold metal whether or not the lamp is lit.
    g.fillStyle(hexToNum(INK.panel), 1);
    g.fillRoundedRect(x - 48, y - 36, 96, 78, 14);
    g.lineStyle(3, hexToNum(accent), 0.35);
    g.strokeRoundedRect(x - 48, y - 36, 96, 78, 14);
  }

  /** `strength` 0 = dark, 1 = fully lit. The same drawing either way. */
  private paintLamp(accent: string, strength: number): void {
    const g = this.lampG;
    const c = hexToNum(accent);
    g.clear();
    g.fillStyle(hexToNum(INK.locked), 1);
    g.fillCircle(BEACON_X, BEACON_Y, 26);
    if (strength > 0) {
      g.fillStyle(c, 0.1 * strength);
      g.fillCircle(BEACON_X, BEACON_Y, 220 * strength);
      g.fillStyle(c, 0.2 * strength);
      g.fillCircle(BEACON_X, BEACON_Y, 124 * strength);
      g.fillStyle(c, 0.45 * strength);
      g.fillCircle(BEACON_X, BEACON_Y, 58 * strength);
      g.fillStyle(hexToNum(INK.accentSoft), strength);
      g.fillCircle(BEACON_X, BEACON_Y, 26);
    }
    g.lineStyle(3, c, 0.3 + 0.7 * strength);
    g.strokeCircle(BEACON_X, BEACON_Y, 32);
  }

  private lightBeacon(accent: string): void {
    if (this.lit) return;
    this.lit = true;
    this.litAtMs = this.time.now;
    const { text } = this.story;

    this.statusText.setText(
      `${text.text("earth.heading")}  ·  ${text.text("earth.status.lit")}`,
    );
    this.statusText.setColor(INK.accentSoft);
    this.shadow.setPose("cheering");

    // Expo.Out - the blast curve: the light ARRIVES, it does not ramp up.
    const carrier = { v: 0 };
    this.tweens.add({
      targets: carrier,
      v: 1,
      duration: 900,
      ease: EASE.blast,
      onUpdate: () => this.paintLamp(accent, carrier.v),
    });

    this.tweens.add({
      targets: this.litText,
      alpha: { from: 0, to: 1 },
      y: { from: this.litText.y + 18, to: this.litText.y },
      delay: 650,
      duration: 520,
      ease: EASE.arrive,
    });

    this.time.delayedCall(1100, () => {
      this.prompt?.destroy();
      this.prompt = null;
      this.showContinue();
    });
  }

  private showContinue(): void {
    const target: FocusTarget = {
      id: "continue",
      x: GAME_WIDTH / 2 - BUTTON_W / 2,
      y: BUTTON_Y,
      w: BUTTON_W,
      h: BUTTON_H,
      activate: () => {
        // AC-12.1: lighting Earth's beacon CLEARS the stop. Without this the
        // map's unlock rule never opens Mars, the map re-focuses Earth, and
        // the player bounces between the two forever.
        const progress = markStopCleared(this.story.progress, "earth", {
          atMs: Date.now(),
        });
        persistStopCleared(this, "earth");
        goTo(this, SCENE_KEYS.map, {
          ctx: this.story.ctx,
          progress,
          shipName: this.story.shipName,
          lang: this.story.lang,
          newProfile: this.story.newProfile,
        });
      },
    };
    this.tweens.add({
      targets: [this.continuePlate, this.continueText],
      alpha: 1,
      duration: 380,
      ease: EASE.pop,
    });
    const ring = createFocusRing(this, 30);
    this.menu = createKeyboardMenu(this, ring, [target]);
  }

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
    this.prompt?.update(time);
    if (!this.lit) return;

    const pal = paletteAt("earth", this.story.ctx.colorblindPalette);
    const elapsed = time - this.litAtMs;

    // Rings expanding from the lamp: slow, confident, earned.
    this.ringsG.clear();
    for (let i = 0; i < 3; i += 1) {
      const phase = (elapsed / 2600 + i / 3) % 1;
      this.ringsG.lineStyle(4, hexToNum(pal.accent), (1 - phase) * 0.5);
      this.ringsG.strokeCircle(BEACON_X, BEACON_Y, 40 + phase * 480);
    }

    // The column of light. Sine breath, so nothing here is ever still.
    const breathe = 0.55 + Math.sin(elapsed / 1400) * 0.12;
    this.beamG.clear();
    this.beamG.fillStyle(hexToNum(pal.accent), 0.14 * breathe);
    this.beamG.fillTriangle(
      BEACON_X - 28, BEACON_Y,
      BEACON_X + 28, BEACON_Y,
      BEACON_X, -GAME_HEIGHT * 0.2,
    );
    this.beamG.fillStyle(hexToNum(pal.accent), 0.3 * breathe);
    this.beamG.fillTriangle(
      BEACON_X - 11, BEACON_Y,
      BEACON_X + 11, BEACON_Y,
      BEACON_X, GAME_HEIGHT * 0.04,
    );
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.earthActivation,
      beaconLit: this.lit,
      activationWord: this.word,
      typed: this.prompt?.typed ?? (this.lit ? this.word : ""),
      canContinue: this.menu !== null,
      focusId: this.menu ? (this.menu.targets[this.menu.index]?.id ?? null) : null,
      text: visibleText(this),
    };
  }

  private teardown(): void {
    this.prompt?.destroy();
    this.menu?.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}
