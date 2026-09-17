import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, mixHex, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { HULL } from "@game/ui/panel";
import type { Rect } from "@game/ui/layout";
import {
  PAGE_TOP,
  PAGE_W,
  PAGE_X,
  SHADOW_AT,
  SHELF,
  WINDOW,
  backChip,
  briefingLayout,
  columnWidth,
  launchButton,
  shelfLamps,
  type Rows,
} from "./support/briefingLayout";
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
 *   - There is exactly ONE PRIMARY ACTION - launch - and at most one
 *     navigation affordance beside it.
 *
 * THAT LAST LINE USED TO READ "there is exactly ONE button: launch", and UR-27
 * broke it deliberately. A player opened a planet and had no way back: Escape
 * worked and was invisible, and a child who arrived by CLICKING had no pointer
 * route out at all. So the back chip is a second interactive control, and the
 * old rule as written forbade it.
 *
 * The rule was not wrong, it was imprecise. What protects a picture-book page
 * is that NOTHING ON IT COMPETES WITH LAUNCH - one forward action, holding
 * focus on open - not that the page has one control. A field of buttons is the
 * defect; a way out is not. `briefing.spec.ts` now asserts the primacy and caps
 * the rest, which is the claim this comment was always making badly.
 *
 * Copy comes from `src/content/en/<stop>.json` (the story bundle), and the one
 * line that names the ship uses `{shipName}` (C07).
 */
/**
 * ALL OF THIS SCREEN'S GEOMETRY IS IN `support/briefingLayout.ts` NOW.
 *
 * The page's box has been measured there since UR-20 (the flowed column printed
 * through a pinned footer on five of seven stops). The window, the shelf and
 * the two actions followed it there for UR-50, because every one of those
 * defects was a number in this file disagreeing with a number next to it: the
 * glass started 56 px below the page, the shelf was 60 px wider than the glass
 * while its lamps were 76 px narrower, and the way out sat 820 px from the
 * button it is an alternative to. Numbers that have to agree belong in one
 * file, where a unit test can read them without booting Phaser.
 */

export class BriefingScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private menu!: KeyboardMenu;
  private bundle!: StageBundle;
  private sentenceCount = 0;
  /** The plate the column was flowed into. Published for the e2e. */
  private page: Rect = { x: PAGE_X, y: PAGE_TOP, w: PAGE_W, h: 0 };
  /** Off-display-list Graphics backing the window masks; see `drawCockpit`. */
  private maskSources: Phaser.GameObjects.Graphics[] = [];
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
      // A VIEW OF A MOVING BELT, NOT A PHOTOGRAPH (UR-50.4). The window used to
      // take the default `worldSpeed` of 0, so nothing fell through it: the only
      // motion in the glass was the decorative planes marching SIDEWAYS, which
      // is the other half of this report (UR-50.5) and the thing a player twice
      // called travelling stars.
      //
      // Both halves are one change of axis. `worldSpeed` makes the scrolling
      // planes carry their debris DOWN past the glass - 30 px/s at speed 1.0, so
      // 4.5 on the far field and 39 on the near one, slow enough to read as
      // drift rather than flight - and `crossDrift: false` stops the sideways
      // march. The starfield is on the `sky` layer, which is PINNED and only
      // twinkles (UR-14, `render/starField.ts`), so the stars stay put while
      // the debris falls, which is what item 4 and item 5 together ask for.
      worldSpeed: 30,
      crossDrift: false,
      seed: 0x8e11,
    });
    // The window is the only hole in the hull, so the whole stack is clipped
    // to it. A mask, not a crop: the layers keep moving behind the frame.
    const shape = this.make.graphics({}, false);
    shape.fillStyle(0xffffff, 1);
    shape.fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);
    const mask = shape.createGeometryMask();
    // KEPT, so `teardown` can destroy it. A Graphics made with `make.graphics`
    // is NOT on the display list, so `scene.restart()` does not sweep it up:
    // every restart left another mask source and another GeometryMask behind,
    // and the WebGL stencil work grew with them. It only shows up under
    // repeated restarts, which is exactly what a per-stop sweep does - the
    // UR-20 collision spec ran Warp and Beacon in 35 s each and hung for five
    // minutes on the two screens that use masks.
    this.maskSources.push(shape);
    for (const l of this.parallax.layers) l.container.setMask(mask);

    this.drawCockpit(pal.accent);

    // --- the page ---------------------------------------------------------
    this.drawPage(pal.accent);

    // --- Shadow, present and out of the way -------------------------------
    // UNDER THE GLASS, not under the page. He stood at (176, 964), directly
    // beneath the text column, which is what capped the page at ~856 and left
    // the briefing no room for its own last line (UR-20). The left side is the
    // page's now; Shadow stands where the player is looking out.
    this.shadow = drawShadow(this, SHADOW_AT.x, SHADOW_AT.y, "idle", {
      scale: SHADOW_AT.scale,
      reducedMotion: ctx.reducedMotion,
      depth: 20,
    });

    // --- the two actions, together (UR-50.1) ------------------------------
    //
    // The way out used to sit top-right, 820 px from the button it is an
    // alternative to. It is directly above it now. `briefingLayout` owns both
    // boxes and the reason they are stacked rather than side by side (Shadow
    // stands where the row's left half would be).
    const btn = launchButton();
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
    /**
     * UR-56, same defect as the Beacon screen's "enter to continue".
     *
     * `briefing.hint` - "enter to launch · esc to go back" - was drawn 14 px
     * UNDER this button, which reads "launch", and named the way out, which is
     * a chip reading "back to the map". Both halves repeated a plate that is
     * already on the screen, and the second half only became a repeat when
     * UR-27 made that chip visible and labelled - so the line had nothing left
     * of its own to say. Removed, not relocated; `ui/hint.ts` carries the rule.
     */

    // --- the way out (UR-27) ----------------------------------------------
    //
    // Escape has always worked (`onBack`, below, and `kit.createKeyboardMenu`
    // fires it on Escape or Backspace). Nothing was broken; the affordance was
    // INVISIBLE. The screen said "enter to launch" and never named the other
    // key, and a player who arrived by CLICKING a planet had no pointer target
    // to leave with - an input supported one way only. Both halves are fixed:
    // the hint now names Escape, and this chip is a real focus target, so the
    // keyboard and the pointer reach exactly the same set of controls (the
    // menu kit builds one hit zone per target).
    const chip = backChip();
    plate(this, chip.x, chip.y, chip.w, chip.h, { fill: INK.panelRaised }).setDepth(21);
    label(this, chip.x + chip.w / 2, chip.y + chip.h / 2, text.text("briefing.back"), {
      size: TYPE.label,
      color: INK.text,
      align: "center",
      lang,
    })
      .setOrigin(0.5)
      .setDepth(22);

    // TOP TO BOTTOM, which is now the order they are DRAWN in. Arrow keys walk
    // this list, so a list ordered [launch, back] while the screen shows back
    // above launch would make Down move the ring upwards. `openingIndex`
    // (`lib/kit.ts`) opens on the target flagged `primary`, not on index 0, so
    // launch still holds focus when the screen opens - which is the property
    // the one-primary-action rule actually cares about.
    const targets: FocusTarget[] = [
      {
        id: "back",
        x: chip.x,
        y: chip.y,
        w: chip.w,
        h: chip.h,
        activate: () => this.goBack(),
      },
      {
        id: "launch",
        // Forward action: launching is why this screen exists (see kit.ts).
        primary: true,
        x: btn.x,
        y: btn.y,
        w: btn.w,
        h: btn.h,
        activate: () => this.launch(),
      },
    ];
    const ring = createFocusRing(this, 30);
    this.menu = createKeyboardMenu(this, ring, targets, {
      onBack: () => this.goBack(),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  /** Back to the Director map. One path, whichever input asked for it. */
  private goBack(): void {
    if (this.launching) return;
    goTo(this, SCENE_KEYS.map, this.forward());
  }

  /** Hull, window frame, struts and the instrument shelf below the glass. */
  private drawCockpit(accent: string): void {
    // The hull is a full-bleed fill with the window cut out of it by an
    // INVERTED geometry mask. Hand-assembling four bands and four corner arcs
    // would put a seam exactly where the eye is, and the aperture has to be
    // pixel-identical to the mask the parallax uses or the glass shows a rim.
    // A LIT SURFACE, NOT A HOLE. This was a flat `INK.bg` fill - #08111F, L*
    // 4.98 - over every pixel the page and the glass did not cover, which is
    // about 40% of the frame; a blind critic measured it and called the left
    // and right thirds voids. It is milled charcoal now, lit from above like
    // every other surface in the game, with its darkest value at L* 7.5. See
    // `ui/panel.ts` HULL / VOID_LSTAR.
    const hull = this.add.graphics().setDepth(15);
    hull.fillGradientStyle(
      hexToNum(HULL.top),
      hexToNum(HULL.top),
      hexToNum(HULL.bottom),
      hexToNum(HULL.bottom),
      1,
    );
    hull.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const aperture = this.make.graphics({}, false);
    aperture.fillStyle(0xffffff, 1);
    aperture.fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);
    this.maskSources.push(aperture);
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
    // THE WIDTH OF THE GLASS, and the lamps centred in it (UR-50.2). See
    // `briefingLayout.SHELF` for the measurement that was actually wrong.
    g.fillStyle(hexToNum(INK.panel), 1);
    g.fillRoundedRect(SHELF.x, SHELF.y, SHELF.w, SHELF.h, SPACE.radius);
    const lampY = SHELF.y + SHELF.h / 2;
    for (const [i, cx] of shelfLamps().entries()) {
      const lit = i % 3 === 0;
      g.fillStyle(hexToNum(lit ? accent : INK.line), lit ? 0.75 : 1);
      g.fillCircle(cx, lampY, SHELF.lampR);
    }
  }

  /** The picture-book page: one warm column, large type, nothing to fill in. */
  private drawPage(accent: string): void {
    const { lang, text } = this.story;
    // 0.10, not 0.06: the hull behind it is a lit surface now rather than
    // black, and paper that is only 3 L* above the wall stops reading as a
    // separate object. `cockpitInk.test.ts` asserts the gap.
    const paper = mixHex(INK.panelRaised, INK.text, 0.1);

    // MEASURE FIRST, THEN PLACE. Every block is built off-screen, its real
    // height read back, and `briefingLayout` decides where it goes and how tall
    // the plate has to be. The old code flowed the sentences from a fixed start
    // and then drew the footer at an absolute y, so on five of the seven stops
    // the flow ran straight through the footer (UR-20).
    const wrapWidth = columnWidth();
    const build = (
      id: string,
      content: string,
      size: number,
      color: string,
      gapAfter: number,
    ): { row: Rows; obj: Phaser.GameObjects.Text } => {
      const obj = label(this, 0, 0, content, {
        size,
        color,
        wrapWidth,
        lang,
      }).setDepth(18);
      return { row: { id, height: obj.height, gapAfter }, obj };
    };

    const blocks = [
      // "mission briefing". `INK.textFaint` measured 3.28:1 on this paper -
      // below AC-22.8's 4.5:1 - because the sky-borne contrast sweep only ever
      // looked at text drawn over the WORLD, and this sits on a plate the scene
      // drew itself. Same bar, whatever it is printed on.
      build("eyebrow", text.text("briefing.heading"), TYPE.caption, INK.textDim, 14),
      build("planet", this.bundle.planetName, TYPE.heading, INK.text, 12),
      build("chapter", this.bundle.chapterTitle, TYPE.label, accent, 40),
      // `text.fill`, not the raw sentence: Earth's opening line carries C07's
      // `{shipName}` token and `stageBundle` hands the prose over unbound, so
      // the first briefing in the game printed "{shipName}" at a child.
      ...this.bundle.briefing.map((sentence, i) =>
        build(`sentence-${i}`, text.fill(sentence), 36, INK.text, 16),
      ),
      // THE FOOTER IS THE LAST BLOCK IN THE FLOW, not a pinned y. That single
      // change is what makes UR-20 impossible rather than fixed.
      build("shipReady", text.text("briefing.shipReady"), TYPE.caption, INK.textDim, 0),
    ];

    const laid = briefingLayout(blocks.map((b) => b.row));
    this.page = laid.page;
    for (const [i, block] of blocks.entries()) {
      const at = laid.rows[i];
      if (at !== undefined) block.obj.setPosition(at.x, at.y);
    }

    const g = this.add.graphics().setDepth(17);
    g.fillStyle(hexToNum(INK.bgDeep), 0.5);
    g.fillRoundedRect(laid.page.x + 8, laid.page.y + 12, laid.page.w, laid.page.h, 26);
    g.fillStyle(hexToNum(paper), 1);
    g.fillRoundedRect(laid.page.x, laid.page.y, laid.page.w, laid.page.h, 26);
    // A single ribbon of the stop's accent down the spine. No rules, no grid.
    g.fillStyle(hexToNum(accent), 0.85);
    g.fillRoundedRect(laid.page.x + 34, laid.page.y + 34, 8, laid.page.h - 68, 4);

    // NO CAPTION OVER THE GLASS (UR-50.3). There used to be a "through the
    // window" label here, on the hull above the window, and it was the only
    // reason the window could not start on the page's own line. A player asked
    // for it to go; the argument for going is that it named the thing it sat
    // on. The alignment it was costing is asserted in `briefingLayout.test.ts`.
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
      /**
       * The controls, WITH THEIR ROLES. This was `buttonCount`, and a count
       * cannot tell "one primary plus a way back" from "five buttons" - which
       * is exactly the distinction the one-button rule existed to make. The
       * `primary` flag already drives which control holds focus on open
       * (`lib/kit.FocusTarget`), so the axis is the product's own, not one
       * invented for the test.
       */
      controls: this.menu.targets.map((t) => ({
        id: t.id,
        role: t.primary === true ? "primary" : "navigate",
      })),
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      shipName: this.story.shipName,
      text: visibleText(this),
    };
  }

  private teardown(): void {
    for (const g of this.maskSources) g.destroy();
    this.maskSources = [];
    this.menu.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}

/**
 * The window is a constant; the PAGE is not, and must not be published as one.
 * Its box comes from `support/briefingLayout.ts` and depends on the stop's own
 * copy, which is the whole point of UR-20's fix - a caller that wanted a fixed
 * page rectangle would be asking the question that caused the defect.
 */
export const BRIEFING_GEOMETRY = { WINDOW };
