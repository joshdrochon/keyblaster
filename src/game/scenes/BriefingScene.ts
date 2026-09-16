import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, mixHex, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { INK, SPACE, TYPE } from "@game/ui/theme";
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
import { stageBundle, type StageBundle } from "./lib/content";
import { goTo, resolveInit, type ResolvedInit, type StoryInit } from "./lib/init";

/**
 * Screen inventory row 4 - Briefing (design brief screen 4).
 *
 * "A picture-book page inside a cockpit, not a worksheet." Everything below is
 * in service of that one sentence:
 *
 *   - The page is a warm, generous plate with one column of large type and no
 *     rules, boxes, numbers or fields. Nothing on it can be filled in.
 *   - The planet is seen THROUGH A WINDOW: the parallax stack is masked to the
 *     window's rounded rectangle and the cockpit hull is drawn on top of it,
 *     so the depth behind the glass is real rather than a pasted circle.
 *   - Shadow is present and idle. He does not talk over the page; the page is
 *     the story here (his line is the Pre-flight screen's job, D51).
 *   - There is exactly ONE button: launch.
 *
 * Copy comes from `src/content/en/<stop>.json` (the story bundle), and the one
 * line that names the ship uses `{shipName}` (C07).
 */
const PAGE = { x: 96, y: 168, w: 852, h: 700 };
const WINDOW = { x: 1012, y: 140, w: 812, h: 640, r: 56 };

export class BriefingScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private menu!: KeyboardMenu;
  private bundle!: StageBundle;
  private sentenceCount = 0;
  private launching = false;

  constructor() {
    super(SCENE_KEYS.briefing);
  }

  init(data: StoryInit): void {
    this.story = resolveInit(data, "mars");
    this.launching = false;
  }

  create(): void {
    const { text, ctx, lang } = this.story;
    const stopId = this.story.stopId;
    const pal = paletteAt(stopId, ctx.colorblindPalette);
    this.bundle = stageBundle(stopId);
    this.sentenceCount = this.bundle.briefing.length;

    this.cameras.main.setBackgroundColor(INK.bgDeep);

    // --- what is outside the glass ---------------------------------------
    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: ctx.reducedMotion,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: 0x8e11,
    });
    // The window is the only hole in the hull, so the whole stack is clipped
    // to it. A mask, not a crop: the layers keep moving behind the frame.
    const shape = this.make.graphics({}, false);
    shape.fillStyle(0xffffff, 1);
    shape.fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);
    const mask = shape.createGeometryMask();
    for (const l of this.parallax.layers) l.container.setMask(mask);

    this.drawCockpit(pal.accent);

    // --- the page ---------------------------------------------------------
    this.drawPage(pal.accent);

    // --- Shadow, present and out of the way -------------------------------
    this.shadow = drawShadow(this, 176, GAME_HEIGHT - 116, "idle", {
      scale: 0.84,
      reducedMotion: ctx.reducedMotion,
      depth: 20,
    });

    // --- one button -------------------------------------------------------
    const btn = { w: 380, h: 92, x: WINDOW.x + WINDOW.w / 2 - 190, y: GAME_HEIGHT - 176 };
    plate(this, btn.x, btn.y, btn.w, btn.h, {
      fill: INK.panelRaised,
      stroke: INK.accent,
    }).setDepth(21);
    label(this, btn.x + btn.w / 2, btn.y + btn.h / 2, text.text("briefing.start"), {
      size: TYPE.heading,
      color: INK.text,
      align: "center",
      lang,
    })
      .setOrigin(0.5)
      .setDepth(22);
    label(this, btn.x + btn.w / 2, btn.y + btn.h + 14, text.text("briefing.hint"), {
      size: TYPE.caption,
      color: INK.textFaint,
      align: "center",
      lang,
    })
      .setOrigin(0.5, 0)
      .setDepth(22);

    const target: FocusTarget = {
      id: "launch",
      // Forward action: launching is why this screen exists (see kit.ts).
      primary: true,
      x: btn.x,
      y: btn.y,
      w: btn.w,
      h: btn.h,
      activate: () => this.launch(),
    };
    const ring = createFocusRing(this, 30);
    this.menu = createKeyboardMenu(this, ring, [target], {
      onBack: () => goTo(this, SCENE_KEYS.map, this.forward()),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  /** Hull, window frame, struts and the instrument shelf below the glass. */
  private drawCockpit(accent: string): void {
    // The hull is a full-bleed fill with the window cut out of it by an
    // INVERTED geometry mask. Hand-assembling four bands and four corner arcs
    // would put a seam exactly where the eye is, and the aperture has to be
    // pixel-identical to the mask the parallax uses or the glass shows a rim.
    const hull = this.add.graphics().setDepth(15);
    hull.fillStyle(hexToNum(INK.bg), 1);
    hull.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const aperture = this.make.graphics({}, false);
    aperture.fillStyle(0xffffff, 1);
    aperture.fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);
    const cutout = aperture.createGeometryMask();
    cutout.setInvertAlpha(true);
    hull.setMask(cutout);

    const g = this.add.graphics().setDepth(16);

    // Frame: two rings, the inner one catching the light from outside.
    g.lineStyle(14, hexToNum(INK.panelRaised), 1);
    g.strokeRoundedRect(WINDOW.x - 7, WINDOW.y - 7, WINDOW.w + 14, WINDOW.h + 14, WINDOW.r + 7);
    g.lineStyle(3, hexToNum(mixHex(accent, INK.text, 0.5)), 0.5);
    g.strokeRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);

    // Two struts across the glass: this is a ship, not a picture frame.
    g.fillStyle(hexToNum(INK.panelRaised), 0.92);
    g.fillRect(WINDOW.x + WINDOW.w * 0.42, WINDOW.y, 16, WINDOW.h);
    g.fillRect(WINDOW.x, WINDOW.y + WINDOW.h * 0.7, WINDOW.w, 12);

    // Instrument shelf: quiet, unlabelled, no readouts a child could fail.
    g.fillStyle(hexToNum(INK.panel), 1);
    g.fillRoundedRect(WINDOW.x - 30, WINDOW.y + WINDOW.h + 24, WINDOW.w + 60, 76, SPACE.radius);
    for (let i = 0; i < 9; i += 1) {
      const lit = i % 3 === 0;
      g.fillStyle(hexToNum(lit ? accent : INK.line), lit ? 0.75 : 1);
      g.fillCircle(WINDOW.x + 30 + i * 92, WINDOW.y + WINDOW.h + 62, 11);
    }
  }

  /** The picture-book page: one warm column, large type, nothing to fill in. */
  private drawPage(accent: string): void {
    const { lang, text } = this.story;
    const paper = mixHex(INK.panelRaised, INK.text, 0.06);

    const g = this.add.graphics().setDepth(17);
    g.fillStyle(hexToNum(INK.bgDeep), 0.5);
    g.fillRoundedRect(PAGE.x + 8, PAGE.y + 12, PAGE.w, PAGE.h, 26);
    g.fillStyle(hexToNum(paper), 1);
    g.fillRoundedRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h, 26);
    // A single ribbon of the stop's accent down the spine. No rules, no grid.
    g.fillStyle(hexToNum(accent), 0.85);
    g.fillRoundedRect(PAGE.x + 34, PAGE.y + 34, 8, PAGE.h - 68, 4);

    label(this, PAGE.x + 72, PAGE.y + 40, text.text("briefing.heading"), {
      size: TYPE.caption,
      color: INK.textFaint,
      lang,
    }).setDepth(18);
    label(this, PAGE.x + 70, PAGE.y + 74, this.bundle.planetName, {
      size: TYPE.heading,
      color: INK.text,
      lang,
    }).setDepth(18);
    label(this, PAGE.x + 72, PAGE.y + 134, this.bundle.chapterTitle, {
      size: TYPE.label,
      color: accent,
      lang,
    }).setDepth(18);

    // 3-5 sentences, each its own block so the rag never fights the next one.
    let y = PAGE.y + 200;
    const wrapWidth = PAGE.w - 132;
    for (const sentence of this.bundle.briefing) {
      const t = label(this, PAGE.x + 72, y, sentence, {
        size: 36,
        color: INK.text,
        wrapWidth,
        lang,
      }).setDepth(18);
      y += t.height + 16;
    }

    label(this, PAGE.x + 72, PAGE.y + PAGE.h - 62, text.text("briefing.shipReady"), {
      size: TYPE.caption,
      color: INK.textDim,
      wrapWidth,
      lang,
    }).setDepth(18);

    label(this, WINDOW.x + 8, WINDOW.y - 44, text.text("briefing.window"), {
      size: TYPE.caption,
      color: INK.textFaint,
      lang,
    }).setDepth(18);
  }

  /**
   * Briefing -> Pre-flight is one of the four transitions D62 asks to be
   * designed as a moment, so the page dims out on Cubic.Out before the cut
   * rather than the screen simply swapping.
   */
  private launch(): void {
    if (this.launching) return;
    this.launching = true;
    const veil = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, hexToNum(INK.bgDeep), 1)
      .setOrigin(0)
      .setDepth(60)
      .setAlpha(0);
    this.tweens.add({
      targets: veil,
      alpha: 1,
      duration: 420,
      ease: EASE.arrive,
      onComplete: () => goTo(this, SCENE_KEYS.preflight, this.forward()),
    });
  }

  private forward(): StoryInit {
    return {
      ctx: { ...this.story.ctx, stopId: this.story.stopId },
      progress: this.story.progress,
      shipName: this.story.shipName,
      lang: this.story.lang,
      newProfile: this.story.newProfile,
      calibration: this.story.calibration,
      stopId: this.story.stopId,
    };
  }

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.briefing,
      stopId: this.story.stopId,
      planetName: this.bundle.planetName,
      sentenceCount: this.sentenceCount,
      buttonCount: this.menu.targets.length,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      shipName: this.story.shipName,
      text: visibleText(this),
    };
  }

  private teardown(): void {
    this.menu.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}

export const BRIEFING_GEOMETRY = { PAGE, WINDOW };
