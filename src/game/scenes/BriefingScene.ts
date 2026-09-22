import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, mixHex, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { INK, SPACE, STEP, TYPE } from "@game/ui/theme";
import { paintPlate } from "@game/ui/plate";
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
  controlStrip,
  headerColumnWidth,
  launchButton,
  type Rows,
} from "./support/briefingLayout";
import {
  charsRevealedAt,
  msPerChar,
  revealPerBlock,
} from "./support/briefingTypewriter";
import { audioFrom } from "@game/audio/wiring";
import { drawControlSurface } from "@game/ui/controlSurface";
import { drawCockpitWindow } from "@game/ui/viewportWindow";
import { STOP_IDS } from "@engine/types";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import {
  createFocusRing,
  backChipRect,
  drawBackChip,
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
 *   - Shadow is present and idle, in the page's top-right corner, where he
 *     reads as the one DELIVERING the briefing rather than standing beside it
 *     (UR-58). He still does not talk over it; his spoken line is the
 *     Pre-flight screen's job (D51).
 *   - The body types itself out, fast, skippable and off under reduced motion
 *     (UR-59; `support/briefingTypewriter.ts` holds the whole argument).
 *   - There is exactly ONE PRIMARY ACTION - launch, on the screen's centre
 *     line at its foot - and one small, quiet way back on the left (UR-60).
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

/** One block of the typed reveal, with what it has to be restored to. */
interface TypedBlock {
  readonly obj: Phaser.GameObjects.Text;
  /** The string as it will read when the reveal is done. */
  readonly full: string;
  /** The same string, hard-wrapped once so the reveal cannot re-wrap it. */
  readonly wrapped: string;
  readonly wrapWidth: number;
}

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
  /** The blocks the reveal walks through, in the order it walks them (UR-59). */
  private typed: TypedBlock[] = [];
  /**
   * The pilot's name, drawn in the accent over the first word of the closing
   * line, and the index of the block it sits on inside `typed` (UR-126).
   *
   * BOTH, because the overlay has to REVEAL WITH ITS LINE. Drawn once and left
   * alone, it is a coloured word sitting on the page before the sentence under
   * it has typed a character - which is exactly what the owner saw.
   */
  private nameOverlay: Phaser.GameObjects.Text | null = null;
  private nameOverlayText = "";
  private nameOverlayBlock = -1;
  private revealFrom = 0;
  private revealChars = 0;
  private revealed = 0;
  private shipReadySaid = false;
  private revealing = false;
  private completeReveal: (() => void) | null = null;

  constructor() {
    super(SCENE_KEYS.briefing);
  }

  init(data: StoryInit): void {
    this.story = resolveInit(data, "mars", this);
    this.launching = false;
    // A restart reuses the instance, and a reveal left "in progress" from the
    // last stop would report a page that is already on screen as still typing.
    this.typed = [];
    this.nameOverlay = null;
    this.nameOverlayText = "";
    this.nameOverlayBlock = -1;
    this.revealChars = 0;
    this.revealed = 0;
    this.shipReadySaid = false;
    this.revealing = false;
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
      // UR-120: this stack is MASKED to the cockpit glass, so the light has to
      // be placed inside the aperture rather than at its full-frame position -
      // which for Earth through Saturn is behind the briefing card.
      lightBand: { x: WINDOW.x, w: WINDOW.w },
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
    this.drawCockpit(pal.accent);

    // --- the page ---------------------------------------------------------
    this.drawPage(pal.accent);

    // --- Shadow, delivering it (UR-58) ------------------------------------
    //
    // Top-right of the page, not bottom-centre beside the button. Standing on
    // the button row he read as an ornament next to a control; in the page's
    // own corner he is the figure the briefing is coming FROM, which is the
    // read the report asked for and the one the typed reveal above depends on.
    //
    // FACING THE TYPE. He is mirrored so he looks back across the column at the
    // words appearing rather than off the right edge of the page.
    //
    // The corner he stands in is reserved by the flow (`SHADOW_NOTCH`), not
    // dodged by him: the header run is wrapped narrower and floored at his
    // height, so no stop's copy and no language's line box can put a sentence
    // under him. THE SHARED `drawShadow`, as everywhere else - there is one
    // implementation of this figure and a second private one has shipped in
    // this repo before (standards rule 3).
    this.shadow = drawShadow(this, SHADOW_AT.x, SHADOW_AT.y, "idle", {
      scale: SHADOW_AT.scale,
      reducedMotion: ctx.reducedMotion,
      facing: -1,
      // Above the page plate (17) and its type (18): he stands ON the paper.
      depth: 20,
    });

    // --- launch, on the screen's centre line (UR-60) -----------------------
    //
    // The two actions were stacked over each other under the glass (UR-50.1),
    // right of centre, so the screen's one forward action was neither centred
    // nor obviously the biggest thing on it. UR-60 revises that deliberately:
    // launch alone at the foot of the screen, on its centre line, and the way
    // out small and quiet on the left gutter. `briefingLayout` owns both boxes
    // and the measurement that sizes them.
    const btn = launchButton();
    // The accent is the focus language; a control does not paint itself in it,
    // or the plate's own border and the focus ring are two identical gold lines.
    plate(this, btn.x, btn.y, btn.w, btn.h, {
      fill: INK.panelRaised,
      stroke: INK.line,
    }).setDepth(21);
    label(this, btn.x + btn.w / 2, btn.y + btn.h / 2, text.text("briefing.start"), {
      size: TYPE.label,
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

    // --- the way out (UR-27), small and on the left (UR-60) ---------------
    //
    // Escape has always worked (`onBack`, below, and `kit.createKeyboardMenu`
    // fires it on Escape or Backspace). Nothing was broken; the affordance was
    // INVISIBLE, and a player who arrived by CLICKING a planet had no pointer
    // target to leave with - an input supported one way only. This chip is
    // still a real focus target, so the keyboard and the pointer reach exactly
    // the same set of controls (the menu kit builds one hit zone per target).
    //
    // QUIET IS SIZE, INK AND PLACE - NEVER THE RING. The plate is the unlit
    // `INK.panel` with no accent stroke and its label is caption-sized in
    // `INK.textDim`; the focus ring it gets when the caret reaches it is the
    // same width and the same offset launch gets (AC-18.1). A ring trimmed to
    // suit a small control is how a keyboard-only child loses the caret, and a
    // previous lane already reported a focus-ring defect on this screen that
    // turned out to be a 29.7 s timeout rather than a ring (standards rule 9).
    // ONE CHIP, SHARED WITH PRE-FLIGHT (UR-98). This screen's plate, type and
    // ink used to be its own; they are the component's now.
    const chip = backChipRect();
    drawBackChip(this, {
      depth: 21,
      label: text.text("briefing.back"),
      lang,
      hitId: "briefing-back",
      onPress: () => this.goBack(),
    });

    // LEFT TO RIGHT, which is the order they are now ON THE SCREEN. Arrow keys
    // walk this list - the vertical axis routes Right and Down forward, Left
    // and Up back - so a list ordered [launch, back] against a screen showing
    // back on the left would send the ring the wrong way. `openingIndex`
    // (`lib/kit.ts`) opens on the target flagged `primary`, not on index 0, so
    // launch still holds focus when the screen opens - which is the property
    // the one-primary-action rule actually cares about, and it is the same
    // property whether the two controls are stacked or separated.
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
    const ring = createFocusRing(this, 30, this.story.ctx.reducedMotion);
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
    /**
     * THE WINDOW IS A COMPONENT, NOT A DRAWING IN THIS FILE (UR-77).
     *
     * There used to be about thirty lines here - a gradient hull, an inverted
     * geometry mask cut out of it, two frame rings and two struts - and thirty
     * more of nearly the same lines in `PreflightScene`. Nearly, not exactly:
     * that screen had ONE strut where this has a cross, at a different
     * fraction, in a slightly different ink. The owner noticed the missing
     * crosshatch and read the real fault off it, which is that the window was
     * never shared. `ui/viewportWindow.ts` is the one implementation and both
     * screens call it; making the second copy match would have closed the
     * symptom and left the fault.
     *
     * The mask sources are kept so `teardown` can destroy them: a Graphics from
     * `make.graphics` is not on the display list, so `scene.restart()` does not
     * sweep it up, and every restart used to leave another mask behind. The
     * UR-20 collision spec ran Warp and Beacon in 35 s each and hung for five
     * minutes on the two screens that use masks.
     */
    const win = drawCockpitWindow(this, {
      aperture: { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w, h: WINDOW.h },
      radius: WINDOW.r,
      accent,
      world: { w: GAME_WIDTH, h: GAME_HEIGHT },
      hullDepth: 15,
      frameDepth: 16,
    });
    this.maskSources.push(...win.maskSources);
    // The window is the only hole in the hull, so the whole stack is clipped to
    // it. A mask, not a crop: the layers keep moving behind the frame.
    for (const l of this.parallax.layers) l.container.setMask(win.glass);

    const g = win.frame;

    /**
     * THE CONTROL STRIP, AS SHIP HARDWARE (UR-61).
     *
     * It was a rounded bar in `INK.panel` with nine flat circles on it, and it
     * was reported as reading like a row of dots rather than like the ship
     * controls it is meant to be. The fix is not a redraw of this one bar: the
     * Settings screen already speaks a console language (UR-11) - milled face,
     * screws, glass recesses, one light from above - and inventing a second one
     * for this screen is what standards rule 1 is about. `ui/controlSurface.ts`
     * is that language, extracted so both screens draw with it.
     *
     * It keeps the width of the glass and the centred lamp group UR-50.2 asked
     * for; what it gains is a frame, fixings, depth and cooling slots, plus one
     * lamp per stop with the stop being briefed burning - so the row of lights
     * is a readout rather than a decoration in the shape of one.
     */
    drawControlSurface(g, controlStrip(), {
      lamps: SHELF.lamps,
      lit: STOP_IDS.indexOf(this.story.stopId),
      accent,
    });
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
    const build = (
      id: string,
      content: string,
      size: number,
      color: string,
      gapAfter: number,
      group: "header" | "body" = "body",
    ): { row: Rows; obj: Phaser.GameObjects.Text } => {
      // THE HEADER RUN IS NARROWER, because Shadow stands beside it (UR-58).
      // The body keeps the full column; `briefingLayout` owns both widths and
      // the flow that reserves his corner.
      const wrapWidth = group === "header" ? headerColumnWidth() : columnWidth();
      const obj = label(this, 0, 0, content, {
        size,
        color,
        wrapWidth,
        lang,
      }).setDepth(18);
      return { row: { id, height: obj.height, gapAfter, group }, obj };
    };

    const blocks = [
      // "mission briefing". `INK.textFaint` measured 3.28:1 on this paper -
      // below AC-22.8's 4.5:1 - because the sky-borne contrast sweep only ever
      // looked at text drawn over the WORLD, and this sits on a plate the scene
      // drew itself. Same bar, whatever it is printed on.
      // EVERY GAP ON THIS PAGE IS A `STEP` (UR-69). They were 14, 12, 40, 16
      // and 0: two of them on the scale by luck and two not on it at all. The
      // eyebrow and the planet name are one masthead, so they close up to
      // `STEP.tight`; the chapter title ends the masthead, so `STEP.pad` opens
      // the body under it; the paragraphs are separated by `STEP.tight`, which
      // is the only direction this page may move - `briefingLayout` derives the
      // page's height from these rows, and a LOOSER gap is how the briefing
      // that fit at Mars collided at five other stops.
      build("eyebrow", text.text("briefing.heading"), TYPE.caption, INK.textDim, STEP.tight, "header"),
      build("planet", this.bundle.planetName, TYPE.heading, INK.text, STEP.tight, "header"),
      build("chapter", this.bundle.chapterTitle, TYPE.label, accent, STEP.pad, "header"),
      // `text.fill`, not the raw sentence: Earth's opening line carries C07's
      // `{shipName}` token and `stageBundle` hands the prose over unbound, so
      // the first briefing in the game printed "{shipName}" at a child.
      // ONE RUNG DOWN THE SCALE (UR-91): `TYPE.prose` 36 -> `TYPE.body` 30.
      // Asked for as "a slight smaller size", and it is a STEP ON THE DECLARED
      // SCALE rather than a number - 33 would have read the same on a capture
      // and would have been the 165th distinct value the UR-69 census counted.
      //
      // It also buys the page back its margin. `briefingLayout` derives the
      // plate's height from these rows, and UR-20 was this flow running through
      // the footer at five stops out of six. Six px off every wrapped line of
      // the longest run on the screen is the one change that makes that
      // collision less likely rather than more.
      //
      // `TYPE.prose` KEEPS ITS RUNG and is now unused. Deleting it is the open
      // question theme.ts already names - it is the one entry there that could
      // plausibly go - and it is in gauntlet/escalations.md as a decision
      // rather than as done. This lane was asked to step the briefing down, not
      // to take a size out of the product.
      ...this.bundle.briefing.map((sentence, i) =>
        build(`sentence-${i}`, text.fill(sentence), TYPE.body, INK.text, STEP.tight),
      ),
      // THE FOOTER IS THE LAST BLOCK IN THE FLOW, not a pinned y. That single
      // change is what makes UR-20 impossible rather than fixed.
      /**
       * PART OF THE PARAGRAPH, NOT A FOOTNOTE UNDER IT (UR-126).
       *
       * This was `TYPE.caption` in `INK.textDim` with a zero gap - a smaller,
       * greyer line hanging off the bottom of the card, reading as chrome
       * rather than as something Shadow says. The owner asked for it to sit in
       * the same text as the prose above it, so it takes the same size, the
       * same ink and the same `STEP.tight` gap every other sentence has.
       *
       * The PILOT'S NAME still has to stand out inside it - see `nameOverlay`
       * below, which is drawn after the flow has placed this row.
       */
      build("shipReady", text.text("briefing.shipReady"), TYPE.body, INK.text, STEP.tight),
    ];

    const laid = briefingLayout(blocks.map((b) => b.row));
    this.page = laid.page;
    for (const [i, block] of blocks.entries()) {
      const at = laid.rows[i];
      if (at !== undefined) block.obj.setPosition(at.x, at.y);
    }

    /**
     * THE PILOT'S NAME, IN THE STOP'S ACCENT, INSIDE A PLAIN TEXT OBJECT.
     *
     * Phaser's `Text` carries ONE colour, and this game has no rich-text
     * renderer - so the usual ways to colour part of a line are to split it
     * into two objects and lay them out by hand, which breaks the moment the
     * line wraps, or to add a markup dependency for one word.
     *
     * Neither is needed. The name is always the FIRST thing in the line
     * (`"{pilotName}, ready to..."`), so a second Text containing only the
     * name, in the same font at the same size and position, lands its glyphs
     * exactly over the ones already drawn. The accent copy covers the body
     * copy, the rest of the sentence shows through, and wrapping is still the
     * one original object's problem.
     *
     * Skipped when there is no name - `resolveInit` binds "" for a session
     * with no profile (C27), and an empty overlay would be a no-op anyway.
     */
    const pilotName = this.story.pilotName;
    const shipReadyIndex = blocks.findIndex((b) => b.row.id === "shipReady");
    const shipReadyAt = laid.rows[shipReadyIndex];
    if (pilotName.length > 0 && shipReadyAt !== undefined) {
      this.nameOverlay = label(this, shipReadyAt.x, shipReadyAt.y, pilotName, {
        size: TYPE.body,
        color: accent,
        lang,
      }).setDepth(19);
      this.nameOverlayText = pilotName;
      // The index within the TYPED run, which is the blocks the reveal walks -
      // the header is filtered out of it, so this is not `shipReadyIndex`.
      this.nameOverlayBlock = blocks
        .filter((b) => b.row.group !== "header")
        .findIndex((b) => b.row.id === "shipReady");
      // Starts empty: under the typewriter the line has not been typed yet.
      // Reduced motion never arms the reveal, so the name stays whole there,
      // which is the same "the page is simply there" `armTypewriter` gives.
      if (!this.story.ctx.reducedMotion) this.nameOverlay.setText("");
    }

    // THE PAGE, ON THE SHARED PLATE (UR-69, standards rule 1).
    //
    // Three bespoke rounded rects until now; two of them were the last two
    // entries on `platePainters.BLOCKED_ON_ANOTHER_LANE`, which is now empty.
    // Every number that was written here is a token: the shadow's offset is
    // `STEP.hair` across and `STEP.tight` down, the corner is `SPACE.radiusCard`
    // - the same one the Title's primary button draws - and the spine is a pill
    // rather than a rect with a hand-picked 4.
    const g = this.add.graphics().setDepth(17);
    paintPlate(
      g,
      { x: laid.page.x + STEP.hair, y: laid.page.y + STEP.tight, w: laid.page.w, h: laid.page.h },
      { fill: INK.bgDeep, alpha: 0.5, radius: SPACE.radiusCard, strokeWidth: 0 },
    );
    paintPlate(
      g,
      { x: laid.page.x, y: laid.page.y, w: laid.page.w, h: laid.page.h },
      { fill: paper, radius: SPACE.radiusCard, strokeWidth: 0 },
    );
    // A single ribbon of the stop's accent down the spine. No rules, no grid.
    // Inset one `STEP.inset` from the page's edge on all four sides, which is
    // the 34 that used to be written twice and subtracted once as 68.
    paintPlate(
      g,
      {
        x: laid.page.x + STEP.inset,
        y: laid.page.y + STEP.inset,
        w: STEP.hair,
        h: laid.page.h - STEP.inset * 2,
      },
      { fill: accent, alpha: 0.85, corner: "pill", strokeWidth: 0 },
    );

    // NO CAPTION OVER THE GLASS (UR-50.3). There used to be a "through the
    // window" label here, on the hull above the window, and it was the only
    // reason the window could not start on the page's own line. The caption
    // named the thing it sat on; the alignment it was costing is asserted in
    // `briefingLayout.test.ts`.

    // THE BODY TYPES ITSELF OUT (UR-59). The header does not: the eyebrow, the
    // planet's name and the chapter are WHERE YOU ARE, and a child should never
    // have to wait to find that out. What reveals is what Shadow is telling
    // them - the sentences and the line that closes them.
    this.armTypewriter(
      blocks
        .filter((b) => b.row.group !== "header")
        .map((b) => b.obj),
    );
  }

  /**
   * Arm the reveal (UR-59). Cadence, ceiling and the reasoning: `support/
   * briefingTypewriter.ts`.
   *
   * ================== WHY IT PRE-WRAPS ==================
   * The text is hard-wrapped once, up front, and the reveal prints a prefix of
   * THAT rather than of the raw sentence with soft wrapping left on. Otherwise
   * the word being typed wraps on its own: it fits the current line while it is
   * three letters long, and jumps to the next line when it is eight, so every
   * long word at a line end makes the paragraph below it twitch. `getWrappedText`
   * gives the exact lines Phaser was going to draw anyway.
   *
   * The original string and its wrap width are restored the moment the reveal
   * finishes, so the screen a player reads - and the text every sweep measures -
   * is byte-for-byte what it was before this existed.
   */
  private armTypewriter(objects: readonly Phaser.GameObjects.Text[]): void {
    // AC-19.3 / D41: reduced motion means the page is simply there. This is the
    // live reader of `settings.reducedMotion` on this screen's text path, which
    // is what UR-38 asks every persisted field to have.
    if (this.story.ctx.reducedMotion) return;
    this.typed = objects.map((obj) => ({
      obj,
      full: obj.text,
      wrapped: obj.getWrappedText().join("\n"),
      wrapWidth: obj.style.wordWrapWidth ?? columnWidth(),
    }));
    this.revealChars = this.typed.reduce((n, b) => n + b.wrapped.length, 0);
    if (this.revealChars === 0) {
      this.typed = [];
      return;
    }
    for (const block of this.typed) {
      block.obj.setWordWrapWidth(null);
      block.obj.setText("");
    }
    // `this.time.now` is written by the scene clock's preUpdate, which has NOT
    // run when `create` calls this. It holds whatever the clock last saw - the
    // PREVIOUS scene's final frame - so `elapsed` in `update` came out huge on
    // the very first frame and `charsRevealedAt` returned the whole page. The
    // reveal was real, correct, and over before it was ever drawn. Same defect
    // as `FlightScene.stageStartMs`. `game.loop.time` is the same timeline the
    // `time` argument comes from, and it is current here.
    this.revealFrom = this.game.loop.time;
    this.revealed = 0;
    this.revealing = true;
    // SHADOW STARTS TRANSMITTING (UR-91). Opened here rather than in `create`
    // so the sound and the first character begin on the same frame, and so the
    // two things that turn the reveal off - reduced motion, and a page with no
    // characters - turn the sound off with it by construction. A tick track
    // under a page that is simply present would be the worst of both.
    audioFrom(this.registry)?.beginTransmission("briefing:reveal");
    /**
     * ANY KEY FINISHES IT, AND THE KEY STILL DOES ITS OWN JOB.
     *
     * No `preventDefault`, no `stopPropagation`, no flag that swallows the
     * first keystroke: this listener completes the page and the keyboard menu's
     * own listener runs on the same event. So Enter on arrival completes the
     * reveal AND launches, which is the property the ticket cares about - a
     * child who has seen Neptune four times presses the key they always press
     * and the reveal costs them nothing.
     */
    // INPUT THAT BEGAN BEFORE THIS SCREEN EXISTED CANNOT ACT ON IT.
    //
    // That is the rule, and it needs two mechanisms rather than a duration.
    //
    // 1. BIND ON THE NEXT FRAME. A child opens a briefing by pressing Enter on
    //    the map, and `create` runs inside that same input turn - before any
    //    frame renders. A listener registered here received the very keystroke
    //    that navigated here: measured, one Enter took `revealed` from 0 to
    //    312 and `revealing` to false before a single frame had drawn. Binding
    //    one frame later means the arrival event has already been delivered to
    //    a screen that had no listener, so it cannot be caught at all. This is
    //    by construction rather than by timing.
    //
    // 2. IGNORE `repeat` (in `finishReveal`). A HELD key is one press. Enter
    //    auto-repeats at roughly 500 ms, which is outside any grace window
    //    worth having and which no duration could have distinguished from a
    //    deliberate second press. The browser's own `repeat` flag does.
    //
    // An earlier fix used a 200 ms grace window. It closed (1) and could never
    // close (2), which is why the reveal still died on the way into a stop.
    const bind = (): void => {
      this.input.keyboard?.on("keydown", this.finishReveal, this);
      this.input.on(Phaser.Input.Events.POINTER_DOWN, this.finishReveal, this);
    };
    // `once(POST_UPDATE)` rather than a timer: it is the first frame, whatever
    // the frame rate, and it cannot fire on a scene that never renders.
    this.events.once(Phaser.Scenes.Events.POST_UPDATE, bind);
    this.completeReveal = () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, bind);
      this.input.keyboard?.off("keydown", this.finishReveal, this);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.finishReveal, this);
    };
  }

  /** Show `this.revealed` characters of the run, spread across its blocks. */
  private paintReveal(): void {
    const counts = revealPerBlock(
      this.typed.map((b) => b.wrapped.length),
      this.revealed,
    );
    for (const [i, block] of this.typed.entries()) {
      block.obj.setText(block.wrapped.slice(0, counts[i] ?? 0));
    }
    // THE ACCENT NAME TYPES WITH ITS OWN LINE. The name is the first thing in
    // that line, so the count of characters revealed on the block is also the
    // count revealed of the name - it just stops growing once it runs out.
    if (this.nameOverlay !== null && this.nameOverlayBlock >= 0) {
      const shown = counts[this.nameOverlayBlock] ?? 0;
      this.nameOverlay.setText(this.nameOverlayText.slice(0, shown));
    }
  }

  /** Put the whole page on screen, exactly as it would have been drawn. */
  private finishReveal = (event?: KeyboardEvent): void => {
    if (!this.revealing) return;
    // A KEY HELD DOWN IS ONE PRESS, NOT MANY.
    //
    // The grace window below stops the keystroke that OPENED this screen from
    // also closing it, but it cannot stop the same physical press arriving
    // again: a held Enter auto-repeats at roughly 500 ms, which is comfortably
    // outside any grace window worth having, and the child never lifted their
    // finger. That is why the reveal still died on the way into a stop even
    // after the window existed - press Enter on the map and hold it a beat,
    // and the repeat skipped the page.
    //
    // `repeat` is the browser telling us this is the same press, so it is a
    // better signal than any duration could be.
    if (event?.repeat === true) return;
    this.revealing = false;
    this.revealed = this.revealChars;
    // Skipping the reveal restores the page exactly as it would have drawn,
    // and the name is part of that page.
    this.nameOverlay?.setText(this.nameOverlayText);
    for (const block of this.typed) {
      block.obj.setText(block.full);
      block.obj.setWordWrapWidth(block.wrapWidth, true);
    }
    this.completeReveal?.();
    this.completeReveal = null;
    // The transmission is over, whether it ran out or the player cut it short,
    // so the AC-21.4 duck closes and the music comes back up. An impatient
    // player gets the page AND the mix back on the same keystroke.
    audioFrom(this.registry)?.endTransmission();
    // UR-169: Shadow says the closing line once the page has finished typing
    // itself out, whether it ran out or the player cut it short.
    this.sayShipReady();
  };

  /** Once per visit, and never while the page is still revealing. */
  private sayShipReady(): void {
    if (this.shipReadySaid) return;
    this.shipReadySaid = true;
    audioFrom(this.registry)?.speak({
      id: "briefing.shipReadySpoken",
      text: this.story.text.text("briefing.shipReadySpoken"),
      kind: "scripted",
    });
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
    if (!this.revealing) return;
    // DRIVEN BY THE SCENE CLOCK, not by a timer per character. A 370-character
    // page would be 370 `time.addEvent` callbacks to leak on a restart, and the
    // restart path on this screen has leaked objects before (see `maskSources`).
    const elapsed = time - this.revealFrom;
    const shown = charsRevealedAt(elapsed, this.revealChars);
    if (shown !== this.revealed) {
      this.revealed = shown;
      this.paintReveal();
    }
    // UR-91. The SAME clock the characters are read from, so the sound cannot
    // drift from the text it belongs to. The rate limit lives in
    // `audio/transmission.ts`, not here: one tick per character at 160 cps is
    // a 160 Hz buzz rather than a rhythm, and where that decision is made is
    // the difference between a sound and an argument in a scene file.
    audioFrom(this.registry)?.transmissionTick(elapsed);
    if (shown >= this.revealChars) this.finishReveal();
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
      /**
       * WHERE THE DRAWN FIGURE IS, not where the constant says he should be
       * (UR-58). Read off the live container - including the scale, which is
       * the half of this the report explicitly allows to change - so the e2e
       * checks the screen rather than re-reading `briefingLayout`'s own numbers
       * back to itself.
       */
      shadowAt: {
        x: this.shadow.root.x,
        y: this.shadow.root.y,
        // scaleX carries the mirror (`facing: -1`); scaleY is the size.
        scale: Math.abs(this.shadow.root.scaleY),
      },
      /** The plate the column was flowed into, which varies by stop. */
      page: { ...this.page },
      /**
       * THE REVEAL, AS STATE THE E2E CAN WAIT FOR (UR-59).
       *
       * `text` below is a snapshot of what is on screen at this instant, so
       * while the page is typing it is a snapshot of a PREFIX. A spec that
       * asserts the copy has to wait for `complete`, not for a clock
       * (standards rule 6), and a spec that asserts the reveal happened at all
       * needs to see it mid-flight. Both need this published.
       *
       * `enabled` is false under reduced motion, which is how the a11y claim is
       * checked without measuring pixels.
       */
      typewriter: {
        enabled: this.revealChars > 0,
        complete: !this.revealing,
        revealed: this.revealed,
        total: this.revealChars,
        msPerChar: msPerChar(this.revealChars),
      },
      text: visibleText(this),
    };
  }

  private teardown(): void {
    for (const g of this.maskSources) g.destroy();
    this.maskSources = [];
    // The reveal's two input listeners outlive the scene's objects if nothing
    // removes them, and `scene.restart()` is how every e2e sweep drives this
    // screen - seven stops is seven restarts.
    this.completeReveal?.();
    this.completeReveal = null;
    this.revealing = false;
    // ...and so does the duck. A scene torn down mid-reveal used to be the only
    // way to leave AC-21.4 held open forever; seven stops is seven restarts.
    audioFrom(this.registry)?.endTransmission();
    this.typed = [];
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
