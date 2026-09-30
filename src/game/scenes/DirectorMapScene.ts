import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, paletteAt } from "@game/render/palette";
import { audioFrom } from "@game/audio/wiring";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { ensureTextures, fillShape, starPoints } from "@game/render/textures";
// Two EASE tables spell the same four curves; the slide takes the theme's,
// which is where the motion tokens for chrome live.
import { DUR, EASE as UI_EASE, INK, SKY_PLATE, SPACE, STEP, TYPE } from "@game/ui/theme";
import { paintPlate } from "@game/ui/plate";
import { drawHint } from "@game/ui/hintLine";
import { paintLockGlyph } from "@game/ui/chrome";
import { typographyOf } from "./lib/typography";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { LANTERN_DESIGN_HEIGHT, type LanternLivery, type LanternRig } from "@game/render/lantern";
import {
  CAPTION_GAP,
  CAPTION_PAD_X,
  CAPTION_PAD_Y,
  CHIP,
  LAMP_RISE,
  LOCK_SIZE,
  BADGE_COUNT_GAP,
  BADGE_LABEL_GAP,
  BADGE_LINE_SIZE,
  BADGE_MISSION_SIZE,
  BADGE_PLATE,
  SEGMENT_UNLIT_ALPHA,
  SEGMENT_UNLIT_INK,
  SEGMENT_UNLIT_WIDTH,
  badgeBox,
  badgeGoalY,
  badgeInkLeft,
  badgeMissionY,
  barSegments,
  segmentInk,
  GLOW_ALPHA,
  GLOW_ALPHA_LOCKED,
  GLOW_DEPTH,
  GLOW_REACH,
  GLOW_RINGS,
  NODE_DEPTH,
  NODE_R,
  NODE_RIM,
  PANEL_PAD,
  PANEL_STAR_R,
  INNER_STOP_IDS,
  ROUTE_DEPTH,
  ROUTE_X0,
  ROUTE_Y,
  SHADOW_SCALE,
  SHIP_SCALE,
  SHIP_Y,
  STAR_R,
  STAR_ROW_GAP,
  chipX,
  innerNodeX,
  lockAdvance,
  mapKeepClear,
  nodeRingBox,
  nodeStep,
  nodeX,
  panelBox,
  panelInkLeft,
  panelInkRight,
  panelBoardY,
  panelStarsY,
  routeX1,
  shadowAt,
  starsCentreForRight,
  type PanelBox,
} from "./support/mapLayout";
import {
  BONUS_STOP_IDS,
  ROUTE_STOP_IDS,
  STOP_IDS,
  isBeltStop,
  isStopId,
  type StopId,
  type StopProgress,
} from "@engine/types";
import {
  createFocusRing,
  type FocusRing,
  createKeyboardMenu,
  label,
  plate,
  skyText,
  skyTextSamples,
  visibleText,
  type FocusTarget,
  type KeyboardMenu,
  type PlatedText,
  type SceneSnapshot,
  type Snapshotable,
} from "./lib/kit";
import {
  bonusLitCount,
  bonusUnlocked,
  litCount,
  routeView,
  type StopView,
} from "@engine/progress/index.js";
import { hasStageBundle, stageBundle } from "./lib/content";
import { hasPersonalBest, mapBoardLine } from "./support/mapBoard";
import {
  goTo,
  progressFor,
  resolveInit,
  withStoredProgress,
  type ResolvedInit,
  type StoryInit,
} from "./lib/init";
import { drawPlayerLantern, playerLivery } from "./lib/livery";

/**
 * Screen inventory row 3 - Director map (D13, D40, D27, D43).
 *
 * Earth to Pluto in a line, Destiny-style: a route, not a level select. The
 * screen's whole job is the sense of progress, so the blink is the design.
 *
 * TWO VIEWS OF ONE BOARD. The route is the default and the only view before the
 * bonus pair unlocks; once Pluto is lit, ArrowLeft at Earth slides the board to
 * the INNER run (Mercury, Venus, Earth) and ArrowRight at Earth slides it back.
 * Earth is on both, and it is the hinge the slide turns on - `RunLayer`,
 * `switchView` and `slideW` below are the whole mechanism.
 *
 * WHY THE BLINK IS STAGGERED. A row of beacons all pulsing on the same beat
 * reads as decoration - a loading spinner with seven dots. Here each charted
 * beacon fires on the same period but phase-shifted by its distance from
 * Earth, so the light RUNS outward along the route and stops dead at the
 * furthest beacon the child has placed. The dark half of the line is visibly
 * waiting for the next one. That is what makes the blink feel earned, and it
 * costs one subtraction per node.
 *
 * Locked stops are drawn, not hidden, and stay focusable: a child can look at
 * Pluto from day one. Locked is "not yet", never "denied" (D31, AC-22b.1) -
 * there is no cross, no red and no lock icon that reads as a refusal.
 *
 * Entry points to the Beacon Log and Settings live here (design brief 3), and
 * so does the per-stop personal-best board (D43). The board is personal-best
 * only; no global rank is rendered anywhere on this screen (AC-18.3).
 *
 * ---------------------------------------------------------------------------
 * THE GEOMETRY LIVES IN `support/mapLayout.ts`, with no Phaser in it.
 *
 * It was here, as module-level constants, and three user reports against this
 * screen (UR-52 debris over the planets, UR-53 no ship above the current
 * planet, UR-54 nothing on the shared grid) could only be checked by looking at
 * a capture. Everything positional moved out so a unit test can hold it.
 *
 * Anything that depends on the world's width is a FUNCTION there, for the
 * reason `sceneKeys` gives (D99): a top-level `const` off `GAME_WIDTH` freezes
 * 1920 at import time, before `bootGame` has measured the window, which would
 * pin Pluto and the right edge of the board 320 px inside a 21:9 frame.
 */
const BLINK_PERIOD_MS = 2600;
const BLINK_STAGGER = 0.085;

/**
 * What the badge DREW, kept as one record (UR-48's rule, applied here).
 *
 * The same object the drawing was made from, never a second computation beside
 * it: `snapshot()` reports this, so a bar that paints six segments and a
 * snapshot that says seven cannot both be true.
 */
interface BadgeView {
  readonly rect: PanelBox;
  /** The ink the card's BORDER was painted in. Asserted never to be the accent. */
  readonly borderInk: string;
  readonly mission: string;
  readonly goal: string;
  readonly count: string;
  readonly segments: readonly BadgeSegmentView[];
}

interface BadgeSegmentView {
  readonly stopId: StopId;
  readonly x: number;
  readonly w: number;
  readonly lit: boolean;
  /** The colour this segment was filled or outlined in. */
  readonly ink: string;
}

interface NodeView {
  readonly stopId: StopId;
  readonly x: number;
  readonly charted: boolean;
  readonly locked: boolean;
  readonly accent: string;
  readonly beacon: Phaser.GameObjects.Graphics;
  /**
   * The name plate's DRAWN half-width and bottom edge.
   *
   * Measured, and kept, because the focus ring wraps the disc AND the plate as
   * one box with even air on all four sides, and "Mars" and "Neptune" are not
   * the same width. See `mapLayout.nodeRingBox`.
   */
  readonly caption: { readonly halfW: number; readonly bottom: number };
}

/**
 * Which of the two runs the board is showing. The route is the shipped screen;
 * the inner run is the bonus pair, reached through Earth once Pluto is lit.
 */
type MapView = "route" | "inner";

/**
 * One run's node ink, in a container so the doorway at Earth can slide it.
 *
 * A container renders in LIST order and ignores depth, so every child keeps the
 * `setDepth` it had and the container is sorted by it once built; the container
 * itself sits at `ROUTE_DEPTH`, above every plane this screen decorates (UR-105).
 */
interface RunLayer {
  readonly view: MapView;
  readonly container: Phaser.GameObjects.Container;
  readonly nodes: NodeView[];
  readonly stops: readonly StopView[];
  readonly routeG: Phaser.GameObjects.Graphics;
  readonly glow: Phaser.GameObjects.Graphics;
}

/**
 * The inner run in PROGRESSION order, which `mapLayout.INNER_STOP_IDS` is not -
 * that one is left-to-right for drawing. `routeView` opens whatever comes first
 * in the order it is handed, so the layout order would open Mercury before
 * Venus had been flown.
 */
const INNER_ORDER: readonly StopId[] = ["earth", ...BONUS_STOP_IDS];

/**
 * The travel: the gap between Earth's two seats, so the hinge node never
 * duplicates or jumps while the rest of the board moves around it.
 *
 * A function, not a const, for the reason `mapLayout` gives (D99).
 */
const slideW = (): number => innerNodeX(INNER_STOP_IDS.indexOf("earth")) - nodeX(0);

/** The doorway's caret: a mark beside Earth, outside the disc's dark rim. */
const DOORWAY_GAP = STEP.tight;
const DOORWAY_W = 12;
const DOORWAY_H = 24;
const DOORWAY_STROKE = 4;
const DOORWAY_ALPHA = 0.9;

const ARROW_GAP = 26;
const ARROW_GLIMMER_ALPHA = 0.7;
const ARROW_GLIMMER_MS = 2400;
const ACTION_POP_FROM = 1.06;
const ACTION_POP_MS = 420;
/** One step down the type scale from the word, like the caption chips. */
const ACTION_LOCK_SIZE = TYPE.label;
const ACTION_LOCK_ADVANCE = ACTION_LOCK_SIZE + STEP.hair;
const SHAKE_PX = 10;
const SHAKE_MS = 620;

export class DirectorMapScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private menu!: KeyboardMenu;
  private nodes: NodeView[] = [];
  private routeG!: Phaser.GameObjects.Graphics;
  /** The single route derivation the DRAWN board reads from. */
  private view: readonly StopView[] = [];
  /** The one object the slide tweens; every run's ink is inside it. */
  private board!: Phaser.GameObjects.Container;
  private layer: RunLayer | null = null;
  private mapView: MapView = "route";
  private slide: Phaser.Tweens.Tween | null = null;
  /** Everything `paintBadge` drew, so a view switch can replace it. */
  private badgeInk: Phaser.GameObjects.GameObject[] = [];
  /** The two entry points, kept because a view swap rebuilds the focus order. */
  private chipTargets: FocusTarget[] = [];
  private panelTitle!: Phaser.GameObjects.Text;
  private panelChapter!: Phaser.GameObjects.Text;
  private panelBoard!: Phaser.GameObjects.Text;
  private panelAction!: Phaser.GameObjects.Text;
  private panelArrow!: Phaser.GameObjects.Text;
  private panelLock!: Phaser.GameObjects.Graphics;
  private panelStars!: Phaser.GameObjects.Graphics;
  /** UR-53: the Lantern, hovering over whichever stop is selected. */
  private lantern: LanternRig | null = null;
  /**
   * UR-48 evidence: the four colours this screen DREW the ship with.
   *
   * THE SAME OBJECT that is handed to the drawing, resolved once, not a second
   * call to the resolver sitting beside the draw call. A parallel accumulator
   * reports the right answer while the drawing uses a hardcoded one, and that
   * is the exact shape of the defect this field exists to make visible
   * (`docs/verification-gaps.md`; `FlightScene.livery` says the same thing).
   * `undefined` in a standalone mount with no store - see `lib/livery.ts`.
   */
  private shipLivery: LanternLivery | undefined = undefined;
  private shipTween: Phaser.Tweens.Tween | null = null;
  private selected: StopId = "earth";
  /** The selected planet's halo (UR-92). One Graphics, repainted on select. */
  private glow: Phaser.GameObjects.Graphics | null = null;
  /** How many star glyphs the screen has actually drawn (D27 evidence). */
  private starGlyphs = 0;
  /** The mission badge, as drawn. Null before `create` has painted it. */
  private badge: BadgeView | null = null;

  constructor() {
    super(SCENE_KEYS.map);
  }

  init(data: StoryInit): void {
    // THE MAP IS THE SCREEN THE ROUTE IS READ OFF, so it reads the profile.
    //
    // It is reached with no payload from the Title, from Pause, from the Beacon
    // Log and - the case that reported this bug - from a reload. `resolveInit`
    // defaults a missing `progress` to `[]`, which renders a charted route as
    // seven locked stops and no lit beacons. `withStoredProgress` fills it from
    // the store when the caller supplied none, so what the map draws is what the
    // player actually did.
    //
    // A supplied payload still wins, which is what keeps the screen-inventory
    // variants ("Mars only unlocked", "mid-run", "all seven") mountable.
    this.story = resolveInit(withStoredProgress(this, data), "earth", this);
    this.nodes = [];
    this.starGlyphs = 0;
    this.badge = null;
    this.lantern = null;
    this.shipLivery = undefined;
    this.shipTween = null;
    this.layer = null;
    this.mapView = "route";
    this.slide = null;
    this.chipTargets = [];
  }

  create(): void {
    const { text, ctx, progress } = this.story;
    ensureTextures(this);
    this.cameras.main.setBackgroundColor(INK.bgDeep);

    // The chart's own sky: Earth's night palette, no planet framing and no
    // debris plane - this is a map, not a place.
    this.parallax = buildParallax(this, {
      palette: paletteAt("earth", ctx.colorblindPalette),
      reducedMotion: ctx.reducedMotion,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      decorate: ["sky", "farField", "midField", "nearField"],
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x0d13,
      // UR-52: decorative debris drew ACROSS the planets on this screen. The
      // planets, their lamps, their captions and this screen's chrome, as
      // shapes the debris planes are told to avoid. See `mapLayout.mapKeepClear`
      // for why the list is what it is, and `render/keepClear.ts` for why the
      // mechanism is shared with the Title rather than re-derived here.
      keepClear: mapKeepClear(),
    });

    // ONE DERIVATION FOR THE WHOLE SCREEN (D13, engine/progress `routeView`).
    //
    // The header used to count `isCharted` while the labels and discs read
    // `unlockedStops`. Two readers, two fields, and a capture that said
    // "7 of 7 beacons lit" over seven stops labelled "Locked". Everything
    // below - count, disc, label, lamp, route line, focus - now reads this one
    // array, so the header and the label under a planet cannot disagree.
    //
    // The badge is always the MAIN route's: `litCount` and `barSegments` are
    // both route-only, so it keeps reading the route while the board is showing
    // the inner run.
    const routeStops = routeView(progress, ROUTE_STOP_IDS);
    const lit = litCount(progress);

    // ONE BADGE WHERE THREE PLATES WERE. `paintBadge` is the whole header.

    // UR-105 again: the map's own ink rides with the discs rather than staying
    // at 3, under the mote plane the discs just left. The board is a container
    // now so the doorway at Earth can slide it; see `RunLayer`.
    this.board = this.add.container(0, 0).setDepth(ROUTE_DEPTH);
    this.adopt(this.buildRun("route"));

    // --- the personal-best board (D43) -----------------------------------
    //
    // UR-54: the board at the foot of the screen is to start on the same left
    // edge as the heading above it. It is the content column now
    // (`mapLayout.panelBox`), so
    // its plate starts where the heading's plate starts and ends where the
    // heading's column ends, and every line inside it hangs off ONE inset -
    // the title used 40 and the two lines under it 42.
    const PANEL = panelBox();
    const inkLeft = panelInkLeft();
    // Opaque: a card the size of this one shows the sky behind it as a SHAPE,
    // not a tint. See `lib/kit.plate`.
    plate(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h).setDepth(9);
    this.panelTitle = label(this, inkLeft, PANEL.y + 34, "", {
      size: TYPE.heading,
      color: INK.text,
      lang: this.story.lang,
    }).setDepth(10);
    this.panelChapter = label(this, inkLeft, PANEL.y + 96, "", {
      size: TYPE.caption,
      color: INK.textDim,
      lang: this.story.lang,
    }).setDepth(10);
    // UR-176: named, because the star row is derived from it.
    this.panelBoard = label(this, inkLeft, panelBoardY(), "", {
      size: TYPE.body,
      color: INK.textDim,
      lang: this.story.lang,
    }).setDepth(10);
    this.panelStars = this.add.graphics().setDepth(10);
    // UR-54: the travel label and the three stars did not share a right edge.
    // Both hang off ONE
    // right-hand ink line now; `drawStars` is given the centre that puts the
    // cluster's right EDGE on it (`starsCentreForRight`), which is the 42.4 px
    // the two were out by.
    // UR-180: an arrow says "this takes you somewhere"; a name does not.
    this.panelArrow = label(this, panelInkRight(), PANEL.y + 40, "\u25B8", {
      size: TYPE.body,
      color: INK.accent,
      align: "right",
      lang: this.story.lang,
    })
      .setOrigin(1, 0)
      .setDepth(10);
    if (!this.story.ctx.reducedMotion) {
      // UR-180: light on it, not it moving.
      this.tweens.add({
        targets: [this.panelArrow, this.panelAction],
        alpha: { from: 1, to: ARROW_GLIMMER_ALPHA },
        duration: ARROW_GLIMMER_MS,
        ease: "Sine.InOut",
        yoyo: true,
        repeat: -1,
      });
    }

    this.panelLock = this.add.graphics().setDepth(10);

    this.panelAction = label(this, panelInkRight() - ARROW_GAP, PANEL.y + 40, "", {
      size: TYPE.body,
      color: INK.accent,
      align: "right",
      lang: this.story.lang,
    })
      .setOrigin(1, 0)
      .setDepth(10);

    // UR-54 / UR-19: the hint is a GRID LINE, bottom-left, like every other
    // screen's. It was centred on the world at `GAME_HEIGHT - 66`, which is one
    // of the six different hint positions the blind critic measured.
    //
    // IT NO LONGER PASSES ITS OWN COORDINATES OR ITS OWN PADDING. This screen
    // was the closest to right and still 22 px right and 8 px low of the line
    // the menus used, because it called `skyText` with the map header's `padY`
    // while the menus called `uiText` with none. `drawHint` takes neither, so
    // the map's plate and the picker's plate are now the same two numbers.
    drawHint(this, text.text("map.hint"), {
      screen: "map",
      id: "map.hint",
      depth: 10,
      style: { lang: this.story.lang, ...typographyOf(this) },
    });

    const shadowAnchor = shadowAt();
    this.shadow = drawShadow(this, shadowAnchor.x, shadowAnchor.y, "idle", {
      scale: SHADOW_SCALE,
      reducedMotion: ctx.reducedMotion,
      depth: 11,
    });

    this.buildLantern(ctx.reducedMotion);

    // --- focus order: the drawn run's stops, then the two entry points ----
    //
    // THE RING WRAPS THE DISC AND THE NAME PLATE AS ONE BOX (`nodeRingBox`).
    // It was a square around the disc alone, which was defensible while the
    // status word made the caption a block of its own; with the caption down to
    // one line the name IS the node's label, and a ring stopping above it says
    // the name is not part of the thing being chosen.
    //
    // This rectangle is also the pointer's hit area - the kit builds one zone
    // per target from the same numbers, deliberately, so that what the ring
    // says is clickable and what is clickable are one rectangle. Locked stops
    // keep both: the keyboard can focus Pluto from day one (AC-22b.1, D31) and
    // the mouse behaves the same way.
    this.chipTargets = this.buildChips();
    const targets = [...this.stopTargets(), ...this.chipTargets];

    // THE SHIP IS THE FOCUS INDICATOR ON A PLANET (UR-92).
    //
    // The ring around a stop was the third thing on this screen saying which
    // stop is selected - the Lantern already hovers over it and the detail
    // panel below already names it - and it was the least attractive of the
    // three. The owner asked for it to go.
    //
    // IT IS HIDDEN, NOT DELETED, AND ONLY OVER A PLANET. The two chips at the
    // top right share this focus order and the ship does not hover over them,
    // so removing the ring outright would leave a keyboard user with no visible
    // focus at all up there - AC-18.1. The box itself is untouched either way:
    // the kit builds the pointer hit area from these same numbers.
    //
    // The ship is a POSITION cue, not a colour one, so it still reads for a
    // colour-blind child - which is the property the ring was carrying.
    // The ring breathes on this screen (UR-112). The map's Beacon Log and
    // Settings chips are the treatment the owner named as the standard for a
    // focused control, so they are the first screen wired to the shared pulse -
    // and the flag is handed over so a calm-motion child never sees it move.
    const painted = createFocusRing(this, 40, this.story.ctx.reducedMotion);
    const ring: FocusRing = {
      graphics: painted.graphics,
      moveTo: (target) => {
        // Asked of the id rather than of the drawn node list, which the view
        // swap replaces: the two chips are the only non-stop targets here.
        const overAStop = isStopId(target.id);
        painted.graphics.setVisible(!overAStop);
        if (!overAStop) painted.moveTo(target);
      },
      // Straight through: the wrapper only decides WHETHER the ring is drawn
      // over a stop disc, never how it leaves.
      fadeOut: (durationMs, ease) => {
        painted.fadeOut(durationMs, ease);
      },
      destroy: () => {
        painted.destroy();
      },
    };
    const startIndex = Math.max(
      0,
      this.nodes.findIndex((n) => !n.locked && !n.charted),
    );
    this.menu = createKeyboardMenu(this, ring, targets, {
      axis: "horizontal",
      startIndex: startIndex === -1 ? 0 : startIndex,
      // ESCAPE LEAVES THE MAP (UR-86). `onBack` is OPTIONAL on this kit, and
      // this screen never passed one, so Escape did nothing and the map was a
      // dead end: every route out of it goes deeper - a stop, the log, the
      // settings - and there was no way back to the title at all. AC-18.1 says
      // every screen is returnable by keyboard, and the map was not.
      //
      // Six of the seven screens on this kit pass no `onBack`. The other five
      // are deliberate: Warp is mid-jump, Results and Beacon would let a child
      // rewind story state that has already been written. The map is the hub,
      // so it is the one that was simply missed.
      onBack: () => {
        goTo(this, SCENE_KEYS.title, this.forward());
      },
    });
    this.events.on("kb-focus", (_index: number, target: FocusTarget | undefined) => {
      if (target !== undefined) this.select(target.id);
    });
    this.select(targets[this.menu.index]?.id ?? "earth");
    this.bindDoorway();

    // UR-172: the map is a chart, not a place. It keeps Earth's track as its
    // hub theme and holds the bed back under it.
    audioFrom(this.registry)?.setAmbientTrim(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      audioFrom(this.registry)?.setAmbientTrim(false);
      this.teardown();
    });
  }

  /**
   * THE MISSION BADGE: this screen's entire header, as ONE card.
   *
   * ================== WHAT WAS REPORTED ==================
   * The top-left was three stacked sky plates and the owner called it too
   * busy:
   *
   *   [ Route to Pluto ]
   *   [ Seven stops, one lit path ]
   *   [ 6 of 7 beacons lit ]
   *
   * Three plates, three borders, three left edges, all answering one question.
   * It is one badge now - mission, goal, and a bar with one segment per beacon
   * - and it ends 27 px higher than the block it replaced.
   *
   * ================== WHAT IS A LABEL AND WHAT IS A SENTENCE ==================
   * "Mission: Pluto" and "Goal:" are LABELS and are Title Case, like "Personal
   * Best", "Beacon Log" and "Mission Briefing" already are. "Light all 7
   * beacons" is a SENTENCE - an instruction with a verb - so it is sentence
   * case, like the hint line under it. The count is numerals in every
   * language, which is why it needs no translation.
   *
   * ================== WHY THE STARS WENT ==================
   * The reference draws seven stars, filled for lit. This screen already draws
   * STARS UNDER EVERY CHARTED PLANET and they mean something else: how well
   * that stop was flown, nought to three (D27). One glyph, two meanings, on
   * one screen - and a child counting stars in the badge would be counting the
   * wrong thing. A bar also answers "how far along am I" at a glance, which is
   * what the badge is for. The per-stop tint the stars were carrying did not
   * go with them: it is on the SEGMENTS (`mapLayout.segmentInk`).
   *
   * ================== THE ROW OF THREE PARTS ==================
   * The goal row is a label, a sentence and a count laid out left to right
   * with the scale's own gaps, and the gaps are what make it ONE run to
   * `ui/alignment` - so the row is judged on its left edge (118) like every
   * other line on this screen. A count right-anchored on the badge's right
   * edge would read well and would be a fourth off-model element on a screen
   * `left-edge-conformance.spec.ts` budgets at three.
   */
  private paintBadge(stops: readonly StopView[], lit: number): void {
    // D103: the badge follows the view, so the card is rebuilt rather than
    // drawn once - the route's "Route to Pluto · 7/7" is wrong over Mercury.
    for (const o of this.badgeInk) o.destroy();
    this.badgeInk = [];
    const { text, ctx, lang } = this.story;
    const box = badgeBox();
    // `ROUTE_STOP_IDS`, not `STOP_IDS`: the bar paints one segment per route
    // stop and `litCount` counts only those, so all nine here read "6 of 9"
    // under a seven-segment bar.
    // The inner run is its own mission with its own count; the route's badge
    // would otherwise say "Route to Pluto · 7/7" over Mercury and Venus.
    const inner = this.mapView === "inner";
    const total = inner ? BONUS_STOP_IDS.length : ROUTE_STOP_IDS.length;

    // THE CARD, through the one plate component (UR-69). Its border is
    // `BADGE_PLATE.stroke` - `INK.line`, never the accent - because the
    // surface is declared in `mapLayout` rather than assembled here.
    this.badgeInk.push(
      plate(this, box.x, box.y, box.w, box.h, {
        fill: BADGE_PLATE.fill,
        alpha: BADGE_PLATE.alpha,
        stroke: BADGE_PLATE.stroke,
        strokeAlpha: BADGE_PLATE.strokeAlpha,
        radius: BADGE_PLATE.radius,
        rhythm: "chip",
      }).setDepth(9),
    );

    // `plated: true` with the badge's own fill NAMED: the rows still register
    // their colour pair for V-22.8. "It is on a panel, trust me" is how 1.19:1
    // shipped on five screens (`lib/kit.skyText`).
    const row = (
      id: string,
      x: number,
      y: number,
      copy: string,
      size: number,
      color: string,
    ): PlatedText =>
      ((): PlatedText => {
        const t = skyText(this, x, y, copy, {
          screen: "map",
          id,
          size,
          color,
          lang,
          depth: 10,
          plated: true,
          plateFill: BADGE_PLATE.fill,
        });
        this.badgeInk.push(...t.objects);
        return t;
      })();

    const mission = text.text(inner ? "map.headingInner" : "map.heading");
    row("map.heading", badgeInkLeft(), badgeMissionY(), mission, BADGE_MISSION_SIZE, INK.text);

    const goalY = badgeGoalY();
    const goalLabel = text.text("map.goalLabel");
    const goalCopy = text.text(inner ? "map.goalInner" : "map.goal", { total });
    const count = text.text("map.progress", { lit, total });
    // MEASURED, NOT DECLARED, for the reason `nodeRingBox` gives about the
    // captions: "Goal:" and "Meta:" are not the same width, and a declared
    // column would give one language its gap and the other a hole.
    const labelInk = row(
      "map.goalLabel",
      badgeInkLeft(),
      goalY,
      goalLabel,
      BADGE_LINE_SIZE,
      INK.textDim,
    );
    const goalInk = row(
      "map.goal",
      labelInk.text.getBounds().right + BADGE_LABEL_GAP,
      goalY,
      goalCopy,
      BADGE_LINE_SIZE,
      INK.text,
    );
    row(
      "map.progress",
      goalInk.text.getBounds().right + BADGE_COUNT_GAP,
      goalY,
      count,
      BADGE_LINE_SIZE,
      // `INK.lit` is the token this product already uses for "earned", and it
      // is what the third header plate was drawn in before this.
      INK.lit,
    );

    // THE BAR. One segment per stop, in route order, each one a PILL drawn by
    // the shared plate component - which is how an 8 px mark reaches
    // `ui/plate.ts` instead of `arch/platePainters.test.ts`'s allowlist.
    const g = this.add.graphics().setDepth(10);
    this.badgeInk.push(g);
    const segments = barSegments(stops, inner ? BONUS_STOP_IDS : ROUTE_STOP_IDS).map((seg) => {
      const beaconLit = seg.lit;
      const ink = beaconLit
        ? segmentInk(seg.stopId, ctx.colorblindPalette)
        : SEGMENT_UNLIT_INK;
      paintPlate(
        g,
        seg,
        beaconLit
          ? { fill: ink, alpha: 1, corner: "pill", strokeWidth: 0 }
          : {
              // The empty segment is an OUTLINE on the card, exactly as the
              // empty star is an outline on the sky: filled means earned.
              fill: BADGE_PLATE.fill,
              alpha: 1,
              corner: "pill",
              stroke: SEGMENT_UNLIT_INK,
              strokeAlpha: SEGMENT_UNLIT_ALPHA,
              strokeWidth: SEGMENT_UNLIT_WIDTH,
            },
      );
      return { stopId: seg.stopId, x: seg.x, w: seg.w, lit: beaconLit, ink };
    });

    this.badge = {
      rect: box,
      borderInk: BADGE_PLATE.stroke,
      mission,
      goal: `${goalLabel} ${goalCopy}`,
      count,
      segments,
    };
  }

  /**
   * UR-53: the ship is to hover above the stop the screen is currently about.
   *
   * There was no ship on this screen at all - the map drew the route and the
   * Shadow and nothing that was the player. It hovers over the SELECTED stop;
   * `mapLayout` records why selection rather than furthest-beacon progress.
   *
   * ONE `drawLantern`, never a private copy of the drawing (coding-standards
   * rule 3: a private method in `FlightScene` is what the one-implementation
   * guard could not see, and it was the ship on screen for the entire game).
   *
   * `exhaust: false`, `beam: false`. A ship holding station is not burning, and
   * the plume would reach 152 design units past the nozzle - a third again as
   * tall - straight into the beacon lamp below it. `iris: 0.35` keeps the
   * instrument lit so it reads as the same object the Title and Flight draw.
   */
  private buildLantern(reducedMotion: boolean): void {
    // IT IS THE PILOT'S OWN HULL (UR-48). This screen drew the ship in the
    // file constants, deliberately, matching `WarpScene` - and that was
    // recorded at the time as coding-standards rule 2 in a different place,
    // owed its own ticket rather than smuggled into the one that put the ship
    // here. This is that ticket. `lib/livery.drawPlayerLantern` resolves
    // `profile.shipId` (and its earned skin) through the one seam, so the ship
    // hovering over the route is the ship the child chose and the ship they
    // fly. Resolved into a field first so what is REPORTED is the same object
    // that was DRAWN WITH, never a second computation beside it.
    this.shipLivery = playerLivery(this);
    this.lantern = drawPlayerLantern(this, nodeX(0), SHIP_Y, {
      scale: SHIP_SCALE,
      reducedMotion,
      livery: this.shipLivery,
      idleBob: true,
      exhaust: false,
      beam: false,
      iris: 0.35,
    });
    // The ship plane (depth 6), which is in FRONT of every debris plane this
    // screen decorates - so the ship needs no keep-clear zone of its own.
    this.parallax.layerOf("shipFx").container.add(this.lantern.container);
  }

  /** Move the ship to stop `i`. Eased, because a cursor that teleports reads
   *  as a redraw rather than as a ship (AC-22.5; D41 stills it). */
  /**
   * The selected planet's glow (UR-92).
   *
   * What replaced the ring. The Lantern says which stop is selected by being
   * over it, and this says the same thing on the disc itself - so the cue is
   * still there when the eye is on the planet rather than above it.
   *
   * SOFT, AND UNDER THE DISC. Three rings of the stop's own accent at low
   * alpha, drawn at `NODE_DEPTH - 0.1` so the planet sits on top of its own
   * halo rather than inside a coloured box. It is the stop's accent rather
   * than the UI gold because the glow belongs to the planet, and a locked
   * stop's is dimmer still - it is a "you are looking at this", never a "this
   * is available".
   */
  private paintSelectionGlow(i: number): void {
    const node = this.nodes[i];
    if (this.glow === null || node === undefined) return;
    this.glow.clear();
    const x = node.x;
    // THE GLOW IS THE SELECTION GOLD, NOT THE STOP'S ACCENT (UR-92).
    //
    // The accent was the first version and it fails exactly where it is needed:
    // a locked stop's accent is near-grey, so a soft halo of it over a dark
    // grey disc is invisible, and the locked stops are most of this screen. The
    // gold is what selection is drawn in everywhere else in the game, it reads
    // on every disc, and as a soft halo it is nothing like the hard gold box
    // this replaced.
    const alpha = node.locked ? GLOW_ALPHA_LOCKED : GLOW_ALPHA;
    // OUTERMOST FIRST. The first version drew the bright inner ring and then
    // painted the wide dim ones on top of it, which is the opposite of a glow:
    // the brightest part ended up underneath. Largest to smallest, each one a
    // little stronger, so the light gathers towards the disc.
    for (let ring = GLOW_RINGS; ring >= 1; ring -= 1) {
      const t = ring / GLOW_RINGS;
      // SQUARED FALLOFF over many thin rings. Three rings with a linear ramp
      // drew a solid gold rim - a ring by another name, which is what this
      // replaced. The light has to fade, so each step is faint and there are
      // enough of them that the steps are not visible.
      this.glow.fillStyle(hexToNum(INK.accent), alpha * (1 - t) ** 2);
      this.glow.fillCircle(x, ROUTE_Y, NODE_R + GLOW_REACH * t);
    }
  }

  private moveShipTo(i: number): void {
    const ship = this.lantern;
    const x = this.nodes[i]?.x;
    if (ship === null || x === undefined) return;
    this.shipTween?.remove();
    this.shipTween = null;
    if (this.story.ctx.reducedMotion) {
      ship.container.setX(x);
      return;
    }
    this.shipTween = this.tweens.add({
      targets: ship.container,
      x,
      duration: DUR.panel,
      ease: EASE.arrive,
    });
  }

  private buildChips(): FocusTarget[] {
    const { text } = this.story;
    const logX = chipX(0);
    const settingsX = chipX(1);
    const make = (
      id: string,
      x: number,
      copy: string,
      onGo: () => void,
    ): FocusTarget => {
      plate(this, x, CHIP.y, CHIP.w, CHIP.h, { fill: INK.panelRaised }).setDepth(9);
      label(this, x + CHIP.w / 2, CHIP.y + CHIP.h / 2, copy, {
        size: TYPE.label,
        color: INK.text,
        align: "center",
        lang: this.story.lang,
      })
        .setOrigin(0.5)
        .setDepth(10);
      return { id, x, y: CHIP.y, w: CHIP.w, h: CHIP.h, activate: onGo };
    };
    return [
      make("beaconLog", logX, text.text("title.beaconLog"), () =>
        goTo(this, SCENE_KEYS.beaconLog, this.forward()),
      ),
      make("settings", settingsX, text.text("title.settings"), () =>
        goTo(this, SCENE_KEYS.settings, this.forward()),
      ),
    ];
  }

  /**
   * Build one run's ink. The two views differ in exactly two things - the order
   * handed to `routeView` and each stop's x - so Earth, which is on both, is
   * one drawing rather than two planets.
   *
   * Nodes come out LEFT TO RIGHT: what `drawRoute` joins and what the
   * horizontal focus order walks.
   */
  private buildRun(view: MapView): RunLayer {
    const { progress, ctx } = this.story;
    const stops = routeView(progress, view === "route" ? ROUTE_STOP_IDS : INNER_ORDER);
    const container = this.add.container(0, 0);
    const routeG = this.add.graphics().setDepth(ROUTE_DEPTH);
    const glow = this.add.graphics().setDepth(GLOW_DEPTH);
    container.add([routeG, glow]);
    const nodes: NodeView[] = [];
    const doorway = bonusUnlocked(progress);
    const laid = stops
      .map((stop, i) => ({
        stop,
        x: view === "route" ? nodeX(i) : innerNodeX(INNER_STOP_IDS.indexOf(stop.stopId)),
      }))
      .sort((a, b) => a.x - b.x);

    laid.forEach(({ stop, x }) => {
      const { stopId, charted, locked } = stop;
      const pal = paletteAt(stopId, ctx.colorblindPalette);
      const entry = progressFor(progress, stopId);

      // The planet disc. A locked stop keeps its silhouette and loses its
      // colour: it is still recognisably Pluto, just not lit yet.
      //
      // `NODE_DEPTH`, NOT 4 (UR-105: a gold accent diamond sat on Saturn).
      // `mapLayout` carries the reasoning: the mote plane draws at 4.99 and
      // never asked `keepClear` for permission, so the only fix that works for
      // every stop is the depth the discs are on, read out of the layer table.
      const disc = this.add.graphics().setDepth(NODE_DEPTH);
      // The lit face of the planet. Earth's sky role is night navy, which on a
      // navy chart reads as a hole rather than a world, so its atmosphere role
      // wins where a palette defines one.
      const body = locked
        ? INK.locked
        : (pal.colorRoles["atmosphere"] ?? pal.colorRoles["sky"] ?? pal.colors[2] ?? INK.locked);
      const shade = locked ? INK.panelSunken : (pal.colors[pal.colors.length - 1] ?? INK.bgDeep);
      disc.fillStyle(hexToNum(INK.bgDeep), 1);
      disc.fillCircle(x, ROUTE_Y, NODE_R + NODE_RIM);
      disc.fillStyle(hexToNum(body), 1);
      disc.fillCircle(x, ROUTE_Y, NODE_R);
      // Offset + radius stays under 1.0 so the night side cannot spill past
      // the limb and draw a second, larger disc behind the planet.
      disc.fillStyle(hexToNum(shade), 0.55);
      disc.fillCircle(x + NODE_R * 0.22, ROUTE_Y + NODE_R * 0.2, NODE_R * 0.66);
      disc.lineStyle(3, hexToNum(locked ? INK.line : pal.accent), locked ? 0.7 : 0.95);
      disc.strokeCircle(x, ROUTE_Y, NODE_R);

      const beacon = this.add.graphics().setDepth(6);
      container.add([disc, beacon]);

      if (stopId === "earth" && doorway) {
        // The doorway has to be visible before it is pressed: a caret on the
        // side the arrow travels, drawn only once Pluto is lit, so a child
        // mid-route is never shown a way out of Earth that does nothing.
        const caret = this.add.graphics().setDepth(NODE_DEPTH);
        this.paintDoorway(caret, x, view === "route" ? -1 : 1);
        container.add(caret);
      }

      // THE CAPTION IS THE PLANET'S NAME, ON ONE LINE, AND NOTHING ELSE.
      //
      // ================== WHAT CAME OFF IT ==================
      // "Locked"      six of seven stops carried the same word on a second
      //               line. A word repeated down a row is not a status, and it
      //               was the thing making every caption two lines tall. It is
      //               a LOCK MARK beside the name now (`paintLockGlyph`), drawn
      //               in the same `INK.textDim` the name itself is drawn in, so
      //               the two read as one label. D31 still holds: no cross, no
      //               bar, no red - not yet, never denied.
      // "Beacon Lit"  a charted planet already has a LIT BEACON drawn over it,
      //               pulsing. The caption said the picture again. `map.charted`
      //               stays in the string table with no reader on this screen.
      //
      // The colour rule is unchanged and still load-bearing: both lines used to
      // be INK.locked, the dimmest ink in the theme, on open chart sky at
      // 1.4:1. `INK.textDim` is the DIMMER of two legible inks, never an
      // illegible one.
      const cap = skyText(this, x, ROUTE_Y + NODE_R + CAPTION_GAP, this.stopName(stopId), {
        screen: "map",
        id: `map.stop.${stopId}`,
        size: TYPE.label,
        color: locked ? INK.textDim : INK.text,
        align: "center",
        lang: this.story.lang,
        depth: 7,
        originX: 0.5,
        padX: CAPTION_PAD_X,
        padY: CAPTION_PAD_Y,
      });
      // In a container, list order IS paint order, and `objects` is
      // plate-then-text (`kit.PlatedText`).
      container.add([...cap.objects]);

      if (locked) {
        // THE MARK LIVES IN THE TEXT'S OWN LEFT PADDING, and that is the whole
        // trick. `skyText` paints its plate around `text.getBounds()`, so
        // reserving the room on the Text is what makes the plate grow to cover
        // the mark and STAY CENTRED on the node - a second plate painted beside
        // it here would be the tenth bespoke rounded rect `platePainters`
        // exists to catch, and a mark drawn outside the plate would sit on open
        // sky at the one contrast the sky plates were introduced to fix.
        //
        // `setText` re-runs the plate's layout against the new bounds; it is
        // the kit's own re-layout hook, not a redraw invented here.
        cap.text.setPadding({ left: lockAdvance() });
        cap.setText(this.stopName(stopId));
        const b = cap.text.getBounds();
        const mark = this.add.graphics().setDepth(7);
        paintLockGlyph(
          mark,
          { x: b.x, y: b.centerY - LOCK_SIZE / 2, w: LOCK_SIZE, h: LOCK_SIZE },
          INK.textDim,
        );
        container.add(mark);
      }

      // WHAT THE FOCUS RING IS GOING TO BE BUILT AROUND, measured now, while
      // the type exists. See `mapLayout.nodeRingBox` for why this one number on
      // this screen is measured rather than declared.
      const capBounds = cap.text.getBounds();
      const caption = {
        halfW: capBounds.width / 2 + CAPTION_PAD_X,
        bottom: capBounds.y + capBounds.height + CAPTION_PAD_Y,
      };

      if (!locked && charted && isBeltStop(stopId)) {
        // D27: each charted stop shows its star rating, right on the map.
        // Earth is exempt by construction: it has no belt, so it has no hull
        // hits and therefore no rating (types.ts, BELT_STOP_IDS). Drawing three
        // empty stars under Earth would invent a nought out of nothing.
        // BELOW the caption plate, not through it. `STAR_ROW_GAP` is derived
        // from the caption's height, so the row followed it up when the caption
        // lost its second line instead of leaving a 37 px hole.
        const row = this.add.graphics().setDepth(7);
        this.drawStars(
          row,
          x,
          ROUTE_Y + NODE_R + STAR_ROW_GAP,
          STAR_R,
          entry.stars,
          pal.accent,
        );
        container.add(row);
      }

      nodes.push({ stopId, x, charted, locked, accent: pal.accent, beacon, caption });
    });

    // What keeps the route line under the discs and the captions over the
    // lamps, exactly as the depth-sorted display list did. See `RunLayer`.
    container.sort("depth");
    return { view, container, nodes, stops, routeG, glow };
  }

  /** The caret beside Earth. `dir` is the way the arrow key travels. */
  private paintDoorway(g: Phaser.GameObjects.Graphics, x: number, dir: -1 | 1): void {
    const tipX = x + dir * (NODE_R + NODE_RIM + DOORWAY_GAP);
    const backX = tipX - dir * DOORWAY_W;
    g.lineStyle(DOORWAY_STROKE, hexToNum(INK.accent), DOORWAY_ALPHA);
    g.beginPath();
    g.moveTo(backX, ROUTE_Y - DOORWAY_H / 2);
    g.lineTo(tipX, ROUTE_Y);
    g.lineTo(backX, ROUTE_Y + DOORWAY_H / 2);
    g.strokePath();
  }

  /** Make `layer` the run every other part of this screen reads and draws. */
  private adopt(layer: RunLayer): void {
    this.layer = layer;
    this.mapView = layer.view;
    this.view = layer.stops;
    this.nodes = layer.nodes;
    this.routeG = layer.routeG;
    this.glow = layer.glow;
    this.board.add(layer.container);
    this.paintBadge(
      layer.stops,
      layer.view === "inner"
        ? bonusLitCount(this.story.progress)
        : litCount(this.story.progress),
    );
  }

  /**
   * The drawn run's stops as focus targets. `nodeRingBox` is struck around
   * `nodeX(i)`, and its centre is the only part that depends on `i`, so the
   * inner run re-centres that box rather than keeping a second copy of it here.
   */
  private stopTargets(): FocusTarget[] {
    return this.nodes.map((n, i) => {
      const box = nodeRingBox(i, n.caption);
      return {
        id: n.stopId,
        ...box,
        x: n.x - box.w / 2,
        locked: n.locked,
        // A PLANET DOES NOT SWELL (UR-111). Every other focusable control in
        // the game grows 1.5% while it holds focus; a stop opts out, for the
        // same reason UR-92 took the ring off it - the Lantern already hovers
        // over it and the panel below already names it. A stop is also not a
        // plate with a label on it, so the honest choices are "all of it grows"
        // or "none of it does". The two chips ARE plates, and they do grow.
        pop: false,
        activate: () => this.travel(n),
      };
    });
  }

  /**
   * The doorway, bound PER KEY rather than through the menu: Phaser emits
   * `keydown-LEFT` before the generic `keydown` the kit steps focus on, and
   * skips that second emit once the event is cancelled. So the doorway consumes
   * the arrow, and when it is shut nothing is cancelled and the route view
   * behaves exactly as it does today.
   */
  private bindDoorway(): void {
    this.input.keyboard?.on("keydown-LEFT", this.onDoorwayIn);
    this.input.keyboard?.on("keydown-RIGHT", this.onDoorwayOut);
  }

  private readonly onDoorwayIn = (event: KeyboardEvent): void => {
    if (this.mapView !== "route" || !this.atDoorway()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.switchView("inner");
  };

  private readonly onDoorwayOut = (event: KeyboardEvent): void => {
    if (this.mapView !== "inner" || !this.atDoorway()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.switchView("route");
  };

  /** Is the caret pressable right now: bonus open, focus on Earth, board still. */
  private atDoorway(): boolean {
    return (
      this.slide === null &&
      bonusUnlocked(this.story.progress) &&
      this.menu.targets[this.menu.index]?.id === "earth"
    );
  }

  /**
   * Swap the drawn run, sliding the board so the change reads as a journey.
   *
   * Going inward is leftward, so the board travels RIGHT and the inner run
   * arrives from the left while the route leaves to the right; coming back
   * reverses it. The incoming run is built at minus that travel, so both runs
   * move as one piece and Earth's two seats stay on one point throughout.
   *
   * Focus is put back on Earth before the tween starts, so the hinge still
   * holds it when the board lands and one ArrowRight comes back.
   */
  private switchView(next: MapView): void {
    const outgoing = this.layer;
    if (outgoing === null || outgoing.view === next) return;
    const travel = next === "inner" ? slideW() : -slideW();
    const incoming = this.buildRun(next);
    incoming.container.setX(-travel);
    this.adopt(incoming);
    this.menu.setTargets([...this.stopTargets(), ...this.chipTargets], "earth");

    const land = (): void => {
      outgoing.container.destroy();
      incoming.container.setX(0);
      this.board.setX(0);
      this.slide = null;
    };
    // D41 / AC-22.5: a calm-motion child gets the swap with no travel at all.
    if (this.story.ctx.reducedMotion) {
      land();
      return;
    }
    this.slide = this.tweens.add({
      targets: this.board,
      x: travel,
      duration: DUR.panel,
      ease: UI_EASE.arrive,
      onComplete: land,
    });
  }

  /** Three stars, `earned` of them filled. Never a zero-score readout (D31). */
  private drawStars(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    earned: number,
    accent: string,
  ): void {
    const gap = r * 2.6;
    for (let i = 0; i < 3; i += 1) {
      this.starGlyphs += 1;
      const x = cx - gap + gap * i;
      const pts = starPoints(x, cy, r, r * 0.46);
      if (i < earned) {
        g.fillStyle(hexToNum(accent), 1);
        fillShape(g, pts);
      } else {
        // The empty star is an OUTLINE on open sky, so it is drawn in the same
        // dim-but-legible ink as the "not yet" caption rather than in
        // INK.locked, which disappears into the chart at 1.6:1. Three stars a
        // child cannot count is a rating that does not exist.
        g.lineStyle(2, hexToNum(INK.textDim), 0.75);
        g.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.closePath();
        g.strokePath();
      }
    }
  }

  private stopName(stopId: StopId): string {
    return hasStageBundle(stopId)
      ? stageBundle(stopId).planetName
      : paletteAt(stopId, false).name;
  }

  private select(stopId: string): void {
    if (!isStopId(stopId)) {
      // A chip is focused, not a stop: leave the board showing the last stop.
      return;
    }
    const stop = stopId;
    // The DRAWN run's index, not the route's: the ship and the glow belong to
    // the board on screen, which on the inner run is three nodes wide.
    const i = this.nodes.findIndex((n) => n.stopId === stop);
    if (i < 0) return;
    this.selected = stop;
    this.moveShipTo(i);
    this.paintSelectionGlow(i);
    const { text, progress } = this.story;
    const entry: StopProgress = progressFor(progress, stop);
    const bundle = hasStageBundle(stop) ? stageBundle(stop) : null;
    const locked = this.view.find((v) => v.stopId === stop)?.locked ?? true;

    this.panelTitle.setText(this.stopName(stop));
    this.panelChapter.setText(bundle?.chapterTitle ?? "");

    // Earth has no flight, so it has no WPM and no accuracy to be best at.
    //
    // The line moved to `support/mapBoard.ts` so it can be driven with the
    // values the STORE holds. `bestAccuracy` is a 0..1 fraction everywhere it
    // is produced and the schema clamps it to [0, 1] on load, but this line
    // used to render `Math.round(entry.bestAccuracy)` — so a 97% run read
    // "1% accurate". It stayed green because every map fixture injects
    // percent-scale progress as scene data (`story-lane.charted` passes 96)
    // and the one store-level seed helper leaves the rates at zero, so no test
    // in the repo had ever put a real accuracy on this screen.
    const hasRun = hasPersonalBest(entry, stop);
    this.panelBoard.setText(mapBoardLine(entry, stop, text));

    this.panelStars.clear();
    if (hasRun) {
      this.drawStars(
        this.panelStars,
        starsCentreForRight(panelInkRight(), PANEL_STAR_R),
        panelStarsY(),
        PANEL_STAR_R,
        entry.stars,
        paletteAt(stop, this.story.ctx.colorblindPalette).accent,
      );
    }

    this.panelAction.setText(
      locked ? text.text("map.locked") : text.text("map.travel"),
    );
    // The board is a plate, but INK.locked on INK.panel is 1.6:1 - the same
    // failure as the map labels, indoors. `textDim` is 7.9:1 on the panel.
    this.panelAction.setColor(locked ? INK.textDim : INK.accent);
    this.panelArrow.setVisible(!locked);
    this.panelLock.clear();
    if (locked) {
      // Centred on the word's own middle, not on a number beside it.
      const mid = this.panelAction.y + this.panelAction.height / 2;
      paintLockGlyph(
        this.panelLock,
        {
          x: panelInkRight() - ACTION_LOCK_SIZE,
          y: mid - ACTION_LOCK_SIZE / 2,
          w: ACTION_LOCK_SIZE,
          h: ACTION_LOCK_SIZE,
        },
        INK.textDim,
      );
    } else {
      // Only an available stop answers: a bulge on a dead end invites the press.
      this.popAction();
    }
    this.panelArrow.setX(panelInkRight());
    this.panelAction.setX(panelInkRight() - (locked ? ACTION_LOCK_ADVANCE : ARROW_GAP));
  }

  private shakeAction(): void {
    if (this.story.ctx.reducedMotion) return;
    // The word and its mark move as ONE: the lock is drawn in absolute
    // coordinates, so its Graphics rides from -SHAKE_PX back to 0.
    const home = panelInkRight() - ACTION_LOCK_ADVANCE;
    for (const [obj, base] of [
      [this.panelAction, home],
      [this.panelLock, 0],
    ] as const) {
      this.tweens.killTweensOf(obj);
      obj.setX(base);
      this.tweens.add({
        targets: obj,
        x: { from: base - SHAKE_PX, to: base },
        duration: SHAKE_MS,
        ease: "Elastic.Out",
        easeParams: [1, 0.55],
      });
    }
  }

  /** UR-180: the selection landed, so the action answers once. */
  private popAction(): void {
    if (this.story.ctx.reducedMotion) return;
    for (const obj of [this.panelAction, this.panelArrow]) {
      this.tweens.killTweensOf(obj);
      obj.setScale(1);
      this.tweens.add({
        targets: obj,
        scale: { from: ACTION_POP_FROM, to: 1 },
        duration: ACTION_POP_MS,
        ease: "Sine.Out",
      });
    }
  }

  private travel(node: NodeView): void {
    if (node.locked) {
      // UR-181: an answer, not a telling-off. Silence left the child unable to
      // tell a locked stop from a broken key.
      this.shakeAction();
      return;
    }
    if (node.stopId === "earth") {
      goTo(this, SCENE_KEYS.earthActivation, this.forward(node.stopId));
      return;
    }
    goTo(this, SCENE_KEYS.briefing, this.forward(node.stopId));
  }

  private forward(stopId?: StopId): StoryInit {
    return {
      ctx: stopId === undefined ? this.story.ctx : { ...this.story.ctx, stopId },
      progress: this.story.progress,
      shipName: this.story.shipName,
      lang: this.story.lang,
      newProfile: this.story.newProfile,
      calibration: this.story.calibration,
      ...(stopId === undefined ? {} : { stopId }),
    };
  }

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
    this.drawRoute(time);
    for (const node of this.nodes) this.drawBeacon(node, time);
  }

  /**
   * The route line. A segment between two charted stops is lit and carries a
   * pulse travelling outward; everything past the furthest beacon is a quiet
   * dotted guide, so the unlit half of the map reads as "still to draw".
   */
  private drawRoute(time: number): void {
    const g = this.routeG;
    g.clear();
    for (let i = 0; i < this.nodes.length - 1; i += 1) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      if (a === undefined || b === undefined) continue;
      const x0 = a.x + NODE_R + 10;
      const x1 = b.x - NODE_R - 10;
      const bothLit = a.charted && b.charted;
      if (bothLit) {
        g.lineStyle(4, hexToNum(a.accent), 0.55);
        g.lineBetween(x0, ROUTE_Y, x1, ROUTE_Y);
        const phase = ((time / BLINK_PERIOD_MS) - i * BLINK_STAGGER) % 1;
        const px = x0 + (x1 - x0) * ((phase + 1) % 1);
        g.fillStyle(hexToNum(INK.accentSoft), 0.9);
        g.fillCircle(px, ROUTE_Y, 6);
        g.fillStyle(hexToNum(INK.accentSoft), 0.25);
        g.fillCircle(px, ROUTE_Y, 14);
      } else {
        g.fillStyle(hexToNum(INK.line), 0.85);
        const dots = Math.floor((x1 - x0) / 26);
        for (let d = 0; d <= dots; d += 1) {
          g.fillCircle(x0 + d * 26, ROUTE_Y, 3);
        }
      }
    }
  }

  /**
   * The beacon on a charted stop: a lamp on a short mast that pulses on the
   * shared period, phase-shifted by distance from Earth.
   */
  private drawBeacon(node: NodeView, time: number): void {
    const g = node.beacon;
    g.clear();
    if (!node.charted) return;
    const i = STOP_IDS.indexOf(node.stopId);
    const phase = ((time / BLINK_PERIOD_MS - i * BLINK_STAGGER) % 1 + 1) % 1;
    // Sharp attack, long decay: a lighthouse, not a sine.
    const strength = phase < 0.12 ? phase / 0.12 : Math.max(0, 1 - (phase - 0.12) / 0.88) ** 2;
    const lx = node.x;
    const ly = ROUTE_Y - NODE_R - LAMP_RISE;
    const c = hexToNum(node.accent);
    g.lineStyle(3, c, 0.8);
    g.lineBetween(lx, ROUTE_Y - NODE_R + 14, lx, ly + 6);
    g.fillStyle(c, 0.1 + 0.22 * strength);
    g.fillCircle(lx, ly, 34 + 16 * strength);
    g.fillStyle(c, 0.35 + 0.45 * strength);
    g.fillCircle(lx, ly, 15);
    g.fillStyle(hexToNum(INK.accentSoft), 0.5 + 0.5 * strength);
    g.fillCircle(lx, ly, 7);
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.map,
      // Which run is on the board: without it, a three-node inner board and a
      // route that failed to draw four of seven report the same `stops`.
      mapView: this.mapView,
      selected: this.selected,
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      litCount: this.nodes.filter((n) => n.charted).length,
      // THE BADGE, AS DRAWN. The three header plates used to be visible to a
      // spec only as three strings in `text`; the badge reports its own
      // rectangle, its border ink and one row per segment, so "one card, seven
      // segments, six of them lit" is checkable rather than inferred from copy.
      badge: this.badge,
      // UR-53 evidence: where the ship IS, and where the selected planet is.
      // Two numbers taken in one read, so they describe one moment (rule 7).
      ship:
        this.lantern === null
          ? null
          : {
              x: this.lantern.container.x,
              y: this.lantern.container.y,
              targetX: this.nodes.find((n) => n.stopId === this.selected)?.x ?? nodeX(0),
            },
      // UR-48 evidence: the hull the pilot is wearing, as this screen drew it.
      // Null in a standalone mount with no store, which is the case that must
      // keep the reference sheet's constants (`lib/livery.ts`).
      shipLivery: this.shipLivery ?? null,
      skyText: skyTextSamples(this),
      starGlyphs: this.starGlyphs,
      entryPoints: this.menu.targets
        .map((t) => t.id)
        .filter((id) => id === "beaconLog" || id === "settings"),
      stops: this.nodes.map((n) => ({
        stopId: n.stopId,
        charted: n.charted,
        locked: n.locked,
        stars: progressFor(this.story.progress, n.stopId).stars,
        bestWpm: progressFor(this.story.progress, n.stopId).bestWpm,
      })),
      text: visibleText(this),
    };
  }

  private teardown(): void {
    this.input.keyboard?.off("keydown-LEFT", this.onDoorwayIn);
    this.input.keyboard?.off("keydown-RIGHT", this.onDoorwayOut);
    this.slide?.remove();
    this.slide = null;
    this.shipTween?.remove();
    this.shipTween = null;
    this.lantern?.destroy();
    this.lantern = null;
    this.shipLivery = undefined;
    this.menu.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}

/**
 * Focus-ring geometry, exported so the e2e can assert it is on screen.
 *
 * A re-export of `support/mapLayout.ts` now, which is where the numbers live
 * and where the unit suite holds them. Getters for the two members that depend
 * on the world's width (D99): a plain object literal here would snapshot 1920
 * at import time and the e2e would be asserting against a map the game is not
 * drawing.
 */
export const MAP_GEOMETRY = {
  ROUTE_Y,
  ROUTE_X0,
  get ROUTE_X1(): number {
    return routeX1();
  },
  NODE_R,
  get STEP(): number {
    return nodeStep();
  },
  get PANEL(): PanelBox {
    return panelBox();
  },
  get SHIP_Y(): number {
    return SHIP_Y;
  },
  SPACE,
};
