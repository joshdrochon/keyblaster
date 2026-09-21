import Phaser from "phaser";
import {
  computeStageResults,
  isClearableHullHits,
  type StageResults,
  type StageTally,
  type WordExposure,
} from "@engine/scoring";
import { awardTrophies, newTrophies, type StageAward } from "@engine/awards";
import { TROPHIES } from "@game/ui/catalog";
import { createMenuTranslator } from "@game/ui/i18n";
import { applyUnlocks, newUnlocks } from "@engine/unlocks/index.js";
import { WORST_CASE_SKY, compositeOver } from "@engine/contrast/index.js";
import {
  type Profile,
  type StopId,
  type StopProgress,
} from "@engine/types";
import { blankProfile } from "@engine/persistence/index.js";
import { GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum, lightPositionOf } from "@game/render/palette";
import { SHADOW_HEIGHT, drawShadow, type ShadowFigure } from "@game/render/shadow";
import { SHADOW_DRAWN_HEIGHT, shadowMirrorInset, shadowOrigin } from "./support/pickerLayout";
import { starPoints } from "@game/render/textures";
import { DUR, INK, SPACE, TYPE, chromeCase } from "@game/ui/theme";
import { GUTTER, headerText } from "@game/ui/grid";
import {
  goTo,
  persistStopCleared,
  progressFor,
  storedProgress,
  type StoryInit,
} from "./lib/init";
import {
  createFocusRing,
  createKeyboardMenu,
  skyText,
  skyTextSamples,
  visibleText,
  type FocusRing,
  type FocusTarget,
  type KeyboardMenu,
  type PlatedText,
  type SceneSnapshot,
} from "./lib/kit";
import { ACTION_INK, paintActionButton, paintPlate } from "@game/ui/plate";
import { typographyOf } from "./lib/typography";
import { type HintLine, drawHint } from "@game/ui/hintLine";
import { laneInit, publishBag, textStyles, type LaneInit } from "./support/laneInit";
import {
  PANEL_PAD_X,
  REPORT_W,
  resultsLayout,
  shadowBox,
  sunDisc,
  type Block,
  type PlacedBlock,
  type Rect,
} from "./support/resultsLayout";

/**
 * SCREEN 9 - RESULTS (design-brief-v2.md "9. Results"; D27, D43, D50, D74;
 * PRD section 3.8 / AC-20.1..AC-20.4).
 *
 * Every number here comes from `@engine/scoring`. One call to
 * `computeStageResults` produces the WPM, the accuracy, the delta, the per-word
 * markers, the retention line and the star rating; this file decides only where
 * they sit and whether they are said at all.
 *
 * WHAT THE SCREEN IS NOT (D74, Deci/Koestner/Ryan 1999; D31, design brief
 * "informational, never a scoreboard shame moment"):
 *   - Nothing is red. The stop accent carries good news and the panel ink
 *     carries everything else; there is no warning colour on this screen.
 *   - No rank, no position, no total, no percentile, no grade.
 *   - A word that got slower shows NOTHING. `wordProgressMarker` reports the
 *     negative improvement because the engine has to measure it, but a marker
 *     is drawn only when `faster` is true, so the absence of a marker is
 *     silence rather than a verdict.
 *   - `null` is rendered as ABSENCE, never as a zero. No "+0", no em dash.
 *
 * MARS IS THE CASE THAT PROVES IT (D57). Earth is the launchpad: no belt,
 * cleared by typing one word, stored WPM and accuracy of zero.
 * `previousStageProgress` skips it, so Mars has no previous stage and correctly
 * shows no delta. A delta against Earth would put a fabricated "+60 wpm" on the
 * first results screen a child ever sees. Nothing in this file invents one.
 *
 * THERE IS NO NEARBY-PILOTS BOARD (UR-102). The second panel and its one-time
 * opt-in question are deleted; see `renderActions`.
 *
 * -------------------------------------------------------------------------
 * WHY THE PANEL IS MEASURED AND NOT DECLARED
 *
 * This screen used to draw two rectangles of a fixed 700 px and hang content off
 * the top of each at hand-written offsets. On a first run at Mars four of the
 * six blocks are correctly ABSENT - no delta (D57), no personal best (nothing to
 * beat), no faster words, no retention set - so about three quarters of the
 * panel was empty black. A stage report that is mostly nothing does not read as
 * restraint; it reads as a screen that failed to load.
 *
 * So every block MEASURES itself (`Piece.height` comes from the Phaser Text, not
 * from a table of guesses) and `support/resultsLayout.ts` turns those heights
 * into rectangles. The same module keeps the panel off Shadow and pulls its
 * top edge up over the stop's sun, both of which are geometry rather than taste
 * and both of which are unit-tested without a browser.
 *
 * AND EVERY WORD IS MEASURED TOO (AC-22.8). The headline was the stop accent on
 * the stop's own sky at 1.72:1 and the keyboard hint was `INK.textFaint` at
 * 2.57:1 - unreadable to the 7-to-11 year olds this is for. Text over the world
 * now goes through `skyText`, which draws a plate cut from the text's own bounds
 * and REGISTERS the colour pair; text on a panel this scene drew is registered
 * too, with the panel's real composited colour, because "it's on a panel, trust
 * me" is how 1.19:1 shipped elsewhere.
 */

/**
 * THE PANEL IS OPAQUE, AND IT WAS NOT.
 *
 * This was 0.94, with the comment "three per cent of sky comes through, which
 * is the point". That is the point for `SKY_PLATE` - a sheet of glass laid over
 * the world behind one line of type - and it is not the point for a card 980 px
 * wide. At that size what comes through is not a tint, it is a SHAPE: the stop's
 * moon sits behind the stage report's top-left corner, and on `results.png` the
 * card body read #1c1b1d (L* 10.0) everywhere except inside the moon's
 * footprint, where it read #1d2024 (L* 11.9). A visible circle inside an opaque
 * panel reads as a rendering bug, because it is one.
 *
 * Nothing was mis-ordered: the panel is on the HUD layer and the moon is on
 * `celestial`, six depths below. The fill simply carried alpha.
 *
 * `tests/unit/scenes/resultsInk.test.ts` reads this constant out of this file
 * and asserts it, so the number the rubric measures and the number the screen
 * draws cannot drift apart again.
 */
const PANEL_ALPHA = 1;
/**
 * What the panel ink ACTUALLY composites to over the brightest sky a stop can
 * produce. Registered as the backdrop for everything drawn on a panel, so the
 * rubric measures the surface rather than the swatch.
 */
const PANEL_SURFACE = compositeOver(INK.panel, PANEL_ALPHA, WORST_CASE_SKY);

/**
 * WHERE THIS SCREEN'S BUTTON INKS WENT (UR-112).
 *
 * Four local constants used to live here - a lifted fill, a border, a white to
 * mix the primary's edge toward, and a dark ink for the label on it - and they
 * built a primary filled with `this.lane.palette.accent`. The note read: "the
 * primary one is filled in the stop accent with dark ink on it - the same
 * treatment the Title gives 'play', so 'the filled one is the one you meant'
 * holds across the game."
 *
 * It did hold across the game, and it took the focus ring with it. `INK.accent`
 * is the ring, and the ring drawn on the Earth accent is 1.00:1 - the owner's
 * report that this screen's buttons "do not have the right yellow outline".
 *
 * The drawing is now `ui/plate.paintActionButton` and the inks are
 * `ui/plate.ACTION_INK`, which are the beacon-placed screen's - the control the
 * owner named as correct. `tests/unit/ui/actionButton.test.ts` holds the bars
 * and the reasoning; `resultsInk.test.ts` measures the labels.
 */

/** Where Shadow stands, and how big he is there. */
// UR-158: the picker's placement, so Shadow is the same size and in the same
// corner on every screen that stands her bottom-right.
const SHADOW_SCALE = SHADOW_DRAWN_HEIGHT.list / SHADOW_HEIGHT;



/**
 * The wrap width, fixed BEFORE the layout runs because the layout is computed
 * from the heights this width produces.
 */
const REPORT_CONTENT_W = REPORT_W - PANEL_PAD_X * 2;

/** Column starts inside the report panel, as offsets from its content edge. */
const COL_ACCURACY = 340;
const STARS_W = 180;

export interface ResultsInit extends StoryInit {
  readonly tally?: StageTally;
  readonly exposures?: readonly WordExposure[];
  /** The profile as it stood BEFORE this stage was written back (see scoring/). */
  readonly profile?: Profile;
  /**
   * What the stage knows and the profile cannot (D80, AC-6d.1c): the peak
   * chain, D25's tier, the stars, the retention set. Travels in Flight's opaque
   * `payload` through Warp and Beacon.
   *
   * Optional, because a harness mounting this screen against a fixture has no
   * stage behind it - and in that case no stage-only trophy is awarded, which
   * is right: nothing was played.
   */
  readonly award?: StageAward;
}

const EMPTY_TALLY: StageTally = {
  characters: 0,
  elapsedMs: 0,
  hits: 0,
  typos: 0,
  hullHits: 0,
};

/** One drawn object and where it sits inside its block. */
interface Part {
  readonly obj: Phaser.GameObjects.Text | Phaser.GameObjects.Graphics;
  readonly dx: number;
  readonly dy: number;
}

/**
 * A measured block of panel content.
 *
 * `height` is read off the Phaser Text objects after they are built, never
 * declared: that is the whole mechanism by which a panel can be the size of what
 * is in it. Parts are positioned RELATIVE to the block, so placing a block is
 * idempotent.
 */
interface Piece extends Block {
  readonly parts: readonly Part[];
}

const EMPTY_PIECE = (id: string): Piece => ({ id, height: 0, parts: [] });

export class ResultsScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: ResultsInit | undefined;
  private stopId: StopId = "mars";

  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;
  private menu!: KeyboardMenu;

  private results!: StageResults;
  private tally: StageTally = EMPTY_TALLY;
  private stopProgress!: StopProgress;
  private isNewBest = false;
  /** False on the very first run at this stop: there is no best to report yet. */
  private hasPreviousRun = false;
  /** Trophies THIS run earned, in award order (AC-6d.2: once per profile). */
  private earnedTrophies: readonly string[] = [];

  private reportPieces: Piece[] = [];
  /** The button surfaces and their labels, destroyed together on a rebuild. */
  private actionParts: Phaser.GameObjects.GameObject[] = [];
  /** The rectangle `drawPanel` last filled. Read-only, for the e2e probe. */
  private panelRects: { report: Rect | null } = { report: null };
  private reportPlate!: Phaser.GameObjects.Graphics;
  /**
   * The keyboard hint. Kept whole rather than pushed into `actionParts`: it is a
   * `skyText`, so it is a Text AND the plate cut for it, and splitting the two
   * across a rebuild leaves an orphan plate on screen for every rebuild.
   */
  private hint: HintLine | null = null;
  private rendered: string[] = [];

  constructor() {
    super(SCENE_KEYS.results);
  }

  init(data: ResultsInit | undefined): void {
    this.initData = data;
    this.earnedTrophies = [];
    this.reportPieces = [];
    this.actionParts = [];
    this.hint = null;
    this.rendered = [];
  }

  create(): void {
    this.lane = laneInit(this, this.initData, "mars");
    this.stopId = this.lane.stopId;
    this.tally = this.initData?.tally ?? EMPTY_TALLY;

    const profile = this.profile();
    this.results = computeStageResults({
      stopId: this.stopId,
      tally: this.tally,
      exposures: this.initData?.exposures ?? [],
      profile,
    });
    this.stopProgress = progressFor(profile.progress, this.stopId);
    this.isNewBest = this.results.wpm > this.stopProgress.bestWpm;
    // "Your best here" is a comparison, and on a first run there is nothing to
    // compare with. A stored best of 0 is the ABSENCE of a previous run, not a
    // previous run of zero, and rendering it as "your best here: 0 wpm" is the
    // D31 failure mode: a number that reads as a verdict where the honest
    // answer is silence. See `buildPersonalBest`.
    this.hasPreviousRun = this.stopProgress.bestWpm > 0;

    // The run is now written back. This is the second half of the clear Beacon
    // started: Beacon knows the stop was charted, this screen knows the stars,
    // the WPM and the accuracy (AC-20.4, D50's personal best, D80's trophies).
    // `markStopCleared` keeps the earlier `beaconPlacedAt` and only ever moves
    // the bests up, so the two writes compose.
    //
    // Order matters: everything above reads the profile as it stood BEFORE this
    // stage, which is what `computeStageResults` documents it needs and what
    // makes "new personal best" mean beating a run that is not this one.
    //
    // Skipped when the caller supplied its own `profile`. That is a harness
    // mounting one screen against a fixture, and a fixture must not be able to
    // write itself into a real child's save.
    if (this.initData?.profile === undefined) {
      persistStopCleared(this, this.stopId, {
        atMs: Date.now(),
        stars: this.results.stars,
        wpm: this.results.wpm,
        accuracy: this.results.accuracy,
      });
      // AND THE TROPHIES. Twelve were defined, the Beacon Log drew all twelve,
      // and none could ever be earned: nothing in the whole of `src/` wrote to
      // `profile.trophies`. This is that write, and it runs AFTER the clear
      // above on purpose - Map Maker, Last Light and First Light are questions
      // about beacons, and the beacon for this stop is only just recorded.
      //
      // `@engine/awards` owns which ones; this line owns when.
      this.persistTrophies();
      // AND THE SHIPS AND SKINS, which were the same defect one table over:
      // four hulls and four trims drawn on the create screen, catalogued with
      // the sentence that earns each one, and nothing in `src/` ever added an
      // id to either list. After the clear for the same reason the trophies
      // are - three of the four hulls are questions about how many beacons are
      // lit, and this stop's has only just been recorded.
      this.persistUnlocks();
    }

    this.parallax = buildParallax(this, {
      palette: this.lane.palette,
      reducedMotion: this.lane.reducedMotion,
      worldSpeed: 0,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x5c0e,
    });

    const hud = this.parallax.layerOf("hud").container;
    this.reportPlate = this.add.graphics().setDepth(0);
    hud.add(this.reportPlate);

    this.buildHeader();
    this.reportPieces = [
      this.statsPiece(),
      this.hullPiece(),
      this.personalBestPiece(),
      this.fasterPiece(),
      this.retentionPiece(),
      this.trophiesPiece(),
    ];
    for (const piece of this.reportPieces) {
      for (const part of piece.parts) hud.add(part.obj);
    }

    const stand = this.shadowAt();
    this.shadow = drawShadow(
      this,
      stand.x,
      stand.y,
      this.results.stars === 3 ? "cheering" : "idle",
      {
        scale: SHADOW_SCALE,
        facing: -1,
        reducedMotion: this.lane.reducedMotion,
        depth: layer("shipFx").depth,
      },
    );

    this.ring = createFocusRing(this, layer("hud").depth + 1, this.lane.reducedMotion);
    this.menu = createKeyboardMenu(this, this.ring, [], {
      // DELIBERATELY NOT ESCAPABLE (UR-86). The run is over and scored. Going
      // "back" would mean back into a belt that has already been banked.
      onBack: () => {},
    });
    this.renderActions();

    this.publish();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu.destroy();
      this.ring.destroy();
      this.shadow.destroy();
      this.parallax.destroy();
      this.hint = null;
    });
  }

  /**
   * The profile the deltas are measured against.
   *
   * Priority: what the caller passed (the flight lane hands over the
   * before-state explicitly), then the live store, then a blank profile built
   * from whatever `progress` the init carried. The last case is what a screen
   * opened on its own gets, and it is honest: no previous stage, so no delta.
   */
  private profile(): Profile {
    if (this.initData?.profile) return this.initData.profile;
    const active = this.lane.services?.store.activeProfile();
    if (active) return active;
    // `blankProfile`, not a hand-written literal. This object is what a screen
    // opened on its own gets, and it used to disagree with the engine's own
    // idea of a new pilot on exactly the fields that had no writer: it said
    // `trophies: []` while twelve trophies were unearnable, and then
    // `unlockedShips: []` while `blankProfile` grants the starting hull. A
    // fixture that is wrong in the same direction as the bug is how the bug
    // stayed invisible, so the fixture is now the engine's.
    return {
      ...blankProfile({ id: "local", createdAt: 0, name: this.lane.shipName }),
      shipName: this.lane.shipName,
      progress: [...this.lane.progress],
    };
  }

  /**
   * Fold this run's trophies into the live profile (D80, AC-6d.1c, AC-6d.2).
   *
   * Nothing is drawn from it on this screen, and that is D74's own instruction
   * rather than an omission: a trophy is informational, it lives in the Beacon
   * Log where the player can go and look at it, and a results screen that
   * announces an award is a results screen that has become a reward ceremony.
   * The audit's reading of Deci/Koestner/Ryan (1999) - expected,
   * performance-contingent rewards undermine intrinsic motivation, most of all
   * in children - is the argument for keeping it quiet here.
   */
  private persistTrophies(): void {
    const store = this.lane.services?.store;
    const profile = store?.activeProfile();
    if (!store || !profile) return;
    const award = this.initData?.award ?? null;
    this.earnedTrophies = newTrophies(profile, award);
    if (this.earnedTrophies.length === 0) return;
    store.updateProfile(profile.id, (p: Profile) => awardTrophies(p, award));
    store.flush();
  }

  /**
   * Fold this run's ship and skin unlocks into the live profile (D73, D79;
   * AC-6d.1, AC-6d.1b).
   *
   * Quiet here for the same reason the trophies are (D74): the unlock is
   * informational, the trim shows up on the pilot's own card the next time they
   * look at it (`catalog.liveryFor`, drawn by `ProfilePickerScene`), and a
   * results screen that announces a prize is a results screen that has become a
   * reward ceremony.
   *
   * Nothing is equipped. `@engine/unlocks` owns which ones; this line owns when.
   */
  private persistUnlocks(): void {
    const store = this.lane.services?.store;
    const profile = store?.activeProfile();
    if (!store || !profile) return;
    const award = this.initData?.award ?? null;
    const opened = newUnlocks(profile, award);
    if (opened.ships.length === 0 && opened.skins.length === 0) return;
    store.updateProfile(profile.id, (p: Profile) => applyUnlocks(p, award));
    store.flush();
  }

  private mark(key: string): void {
    this.rendered.push(key);
  }

  // -------------------------------------------------------------------------
  // Ink
  // -------------------------------------------------------------------------

  /**
   * A piece of text on a panel this scene drew.
   *
   * Registered rather than trusted: `plated: true` suppresses the plate (there
   * already is one) and `plateFill` names the panel's real composited colour, so
   * the row lands in the contrast evidence with a backdrop that is true.
   */
  private ink(
    id: string,
    dx: number,
    dy: number,
    content: string,
    options: {
      readonly size: number;
      readonly color: string;
      readonly align?: "left" | "center" | "right";
      readonly wrapWidth?: number;
      readonly originX?: number;
      readonly surface?: string;
    },
  ): Part {
    const t = skyText(this, 0, 0, content, {
      screen: "results",
      id,
      size: options.size,
      color: options.color,
      lang: this.lane.lang,
      plated: true,
      plateFill: options.surface ?? PANEL_SURFACE,
      depth: 2,
      ...(options.align === undefined ? {} : { align: options.align }),
      ...(options.wrapWidth === undefined ? {} : { wrapWidth: options.wrapWidth }),
      ...(options.originX === undefined ? {} : { originX: options.originX }),
    }).text;
    return { obj: t, dx, dy };
  }

  private place(piece: Piece, at: PlacedBlock | Rect): void {
    for (const part of piece.parts) part.obj.setPosition(at.x + part.dx, at.y + part.dy);
  }

  private drawPanel(g: Phaser.GameObjects.Graphics, r: Rect | null): void {
    g.clear();
    if (r === null || r.w <= 0 || r.h <= 0) return;
    // THE SHARED PLATE (UR-69), on the `card` rhythm. `PANEL_ALPHA` stays here
    // rather than becoming the component's default: it is the number
    // `PANEL_SURFACE` composites and `plateOpacity.test.ts` reads, so this
    // screen keeps saying what it is drawn at.
    paintPlate(g, r, { fill: INK.panel, alpha: PANEL_ALPHA, stroke: INK.line, rhythm: "card" });
  }

  // -------------------------------------------------------------------------
  // The stage report
  // -------------------------------------------------------------------------

  private buildHeader(): void {
    // ON A PLATE, BOTH OF THEM. The heading measured 1.72:1 in the stop accent
    // on Mars' ochre sky and the stop name was little better.
    const h = headerText(0, undefined, 12);
    skyText(this, h.x, h.y, this.lane.copy.text("results.heading"), {
      screen: "results",
      id: "results.heading",
      size: TYPE.heading,
      color: this.lane.palette.accent,
      lang: this.lane.lang,
      depth: layer("hud").depth + 2,
      padY: 12,
    });
    const sub = headerText(1, undefined, 8);
    skyText(this, sub.x, sub.y, this.lane.copy.stopName(this.stopId), {
      screen: "results",
      // The stop name is a proper noun from content (D41), so it is the one
      // string on this screen that keeps its capital.
      id: "results.stop",
      size: TYPE.body,
      color: INK.textDim,
      lang: this.lane.lang,
      depth: layer("hud").depth + 2,
      padY: 8,
    });
    this.mark("heading");
  }

  /**
   * AC-20.1 and AC-20.4 in one row: the two rates, their deltas, and the stars.
   *
   * The delta line exists only when `wpmDelta` is not null, which is exactly
   * when there is a previous BELT stage to compare against - and its absence is
   * the block getting shorter, not a gap where a number would have been.
   */
  private statsPiece(): Piece {
    const parts: Part[] = [];
    let height = 0;

    const column = (
      dx: number,
      key: string,
      caption: string,
      value: string,
      delta: number | null,
    ): void => {
      const cap = this.ink(`results.${key}.caption`, dx, 0, caption, {
        size: TYPE.caption,
        color: INK.textDim,
      });
      parts.push(cap);
      const capH = (cap.obj as Phaser.GameObjects.Text).height;
      const val = this.ink(`results.${key}.value`, dx, capH + 6, value, {
        size: TYPE.display,
        color: this.lane.palette.accent,
      });
      parts.push(val);
      const valText = val.obj as Phaser.GameObjects.Text;
      let bottom = val.dy + valText.height;
      this.mark(key);
      if (!this.lane.reducedMotion) {
        valText.setScale(0.9);
        this.tweens.add({ targets: valText, scale: 1, duration: 340, ease: EASE.pop });
      }
      if (delta !== null) {
        // Neutral ink, never a warning colour: a delta is a measurement, not a
        // mark.
        const line = this.ink(
          `results.${key}.delta`,
          dx,
          bottom + 14,
          this.deltaLine(delta),
          { size: TYPE.caption, color: INK.textDim },
        );
        parts.push(line);
        bottom = line.dy + (line.obj as Phaser.GameObjects.Text).height;
        this.mark(`${key}-delta`);
      }
      height = Math.max(height, bottom);
    };

    column(
      0,
      "wpm",
      this.lane.copy.text("results.wpmLabel"),
      `${Math.round(this.results.wpm)}`,
      this.results.wpmDelta === null ? null : Math.round(this.results.wpmDelta),
    );
    column(
      COL_ACCURACY,
      "accuracy",
      this.lane.copy.text("results.accuracyLabel"),
      `${Math.round(this.results.accuracy * 100)}%`,
      this.results.accuracyDelta === null
        ? null
        : Math.round(this.results.accuracyDelta * 100),
    );

    const stars = this.starsParts();
    parts.push(...stars.parts);
    height = Math.max(height, stars.height);
    return { id: "stats", height, parts };
  }

  private deltaLine(amount: number): string {
    const previous = this.results.previousStopId;
    const stop = previous === null ? "" : this.lane.copy.stopName(previous);
    if (amount === 0) return this.lane.copy.text("results.deltaSame", { stop });
    const key = amount > 0 ? "results.deltaUp" : "results.deltaDown";
    return this.lane.copy.text(key, { amount: Math.abs(amount), stop });
  }

  /**
   * AC-20.4 via AC-4.4. A stage that took three hull hits stalled and was never
   * cleared, so `starsForHullHits` returns 0 meaning "no rating"; the engine's
   * own note says the screen must DECLINE to render rather than draw a zero
   * that looks like a score.
   */
  private starsParts(): { parts: Part[]; height: number } {
    if (!isClearableHullHits(this.tally.hullHits, this.tally.maxHull)) {
      return { parts: [], height: 0 };
    }
    const contentW = REPORT_CONTENT_W;
    const left = contentW - STARS_W;
    const cy = 56;
    const g = this.add.graphics().setDepth(2);
    for (let i = 0; i < 3; i += 1) {
      const cx = left + 24 + i * 66;
      const pts = starPoints(cx, cy, 24, 11).map((p) => new Phaser.Geom.Point(p.x, p.y));
      if (i < this.results.stars) {
        g.fillStyle(hexToNum(this.lane.palette.accent), 1);
        g.fillPoints(pts, true);
      } else {
        // Not-yet-earned is drawn dim, never struck through (D31). Dim here is
        // a legible ink at low alpha rather than `INK.locked`, which cannot be
        // seen at all on this panel.
        g.lineStyle(2, hexToNum(INK.textDim), 0.55);
        g.strokePoints(pts, true, true);
      }
    }
    this.mark("stars");
    const caption = this.ink(
      "results.stars.caption",
      left + STARS_W / 2,
      cy + 40,
      this.lane.copy.text("map.stars", { stars: this.results.stars }),
      { size: TYPE.caption, color: INK.textDim, align: "center", originX: 0.5 },
    );
    return {
      parts: [{ obj: g, dx: 0, dy: 0 }, caption],
      height: caption.dy + (caption.obj as Phaser.GameObjects.Text).height,
    };
  }

  /**
   * The ship, when there is something good to say about it.
   *
   * `results.shipIntact` has been in the string table in three languages since
   * the table was written and nothing has ever drawn it. A clean run is a real
   * thing the tally knows and the screen was throwing away, and it is the D74
   * kind of fact: about the flight, not about the child. A run that DID take
   * hits says nothing at all, which is the same silence a slower word gets.
   */
  private hullPiece(): Piece {
    if (this.tally.hullHits > 0) return EMPTY_PIECE("hull");
    if (!isClearableHullHits(this.tally.hullHits, this.tally.maxHull)) {
      return EMPTY_PIECE("hull");
    }
    this.mark("hull");
    const line = this.ink("results.hull", 0, 0, this.lane.copy.text("results.shipIntact"), {
      size: TYPE.label,
      color: INK.text,
      wrapWidth: REPORT_CONTENT_W,
    });
    return {
      id: "hull",
      height: (line.obj as Phaser.GameObjects.Text).height,
      parts: [line],
    };
  }

  /**
   * D50's personal best, and the one case where the right answer is to say
   * nothing at all.
   *
   * Three states, not two:
   *   - beat it            -> "new personal best"
   *   - there is a best    -> "your best here: N wpm"
   *   - first run here     -> NOTHING. `null` is rendered as absence, never as
   *                           a zero (this file's header), and "your best here:
   *                           0 wpm" is precisely that zero. It was on screen
   *                           for every first run, because a fresh stop stores
   *                           bestWpm 0 and `0 > 0` is false, so the screen fell
   *                           through to the compare branch and formatted the
   *                           absence.
   */
  private personalBestPiece(): Piece {
    if (!this.isNewBest && !this.hasPreviousRun) return EMPTY_PIECE("personal-best");
    const line = this.isNewBest
      ? this.lane.copy.text("results.newPersonalBest")
      : this.lane.copy.text("results.personalBest", {
          wpm: Math.round(this.stopProgress.bestWpm),
        });
    this.mark(this.isNewBest ? "personal-best-new" : "personal-best");
    const part = this.ink(
      this.isNewBest ? "results.personalBest.new" : "results.personalBest",
      0,
      0,
      line,
      {
        size: TYPE.label,
        color: this.isNewBest ? this.lane.palette.accent : INK.textDim,
        wrapWidth: REPORT_CONTENT_W,
      },
    );
    return {
      id: "personal-best",
      height: (part.obj as Phaser.GameObjects.Text).height,
      parts: [part],
    };
  }

  /**
   * AC-20.2. Only words that got faster appear. Slower words say nothing.
   *
   * Two columns of three rather than one column of six: the panel is 980 px
   * wide and a single column of short words down the left of it was most of what
   * made the report look empty.
   */
  private fasterPiece(): Piece {
    const faster = this.results.words.filter((w) => w.faster);
    if (faster.length === 0) return EMPTY_PIECE("faster");
    const heading = this.ink(
      "results.faster.heading",
      0,
      0,
      this.lane.copy.text("results.fasterHeading"),
      { size: TYPE.label, color: this.lane.palette.accent },
    );
    this.mark("faster-heading");
    const parts: Part[] = [heading];
    const top = (heading.obj as Phaser.GameObjects.Text).height + 12;
    const rowH = Math.round(TYPE.label * 1.6);
    let height = top;

    const shown = faster.slice(0, 6);
    const perColumn = Math.ceil(shown.length / 2);
    shown.forEach((word, i) => {
      const dx = i < perColumn ? 0 : Math.round(REPORT_CONTENT_W / 2);
      const row = i % perColumn;
      const part = this.ink(
        "results.faster.word",
        dx,
        top + row * rowH,
        this.lane.copy.text("results.fasterMarker", { word: word.word }),
        { size: TYPE.label, color: INK.text },
      );
      const t = part.obj as Phaser.GameObjects.Text;
      if (!this.lane.reducedMotion) {
        t.setAlpha(0);
        this.tweens.add({
          targets: t,
          alpha: 1,
          duration: DUR.panel,
          delay: 70 * i,
          ease: EASE.arrive,
        });
      }
      this.mark(`faster:${word.word}`);
      parts.push(part);
      height = Math.max(height, part.dy + t.height);
    });
    return { id: "faster", height, parts };
  }

  /**
   * AC-20.3. The retention line is the single headline learning claim on this
   * screen, and it is said only when there were retention words to say it
   * about; `wordCount === 0` renders nothing at all.
   */
  private retentionPiece(): Piece {
    const r = this.results.retention;
    if (r.wordCount === 0) return EMPTY_PIECE("retention");
    const percent = r.hitRate === null ? 0 : Math.round(r.hitRate * 100);
    const delta = r.meanLatencyDeltaMs;

    let line: string;
    if (delta !== null && delta < -20) {
      line = this.lane.copy.text("results.retentionQuicker", {
        count: r.wordCount,
        percent,
        ms: Math.round(-delta),
      });
    } else if (delta !== null) {
      line = this.lane.copy.text("results.retentionSteady", { count: r.wordCount, percent });
    } else {
      line = this.lane.copy.text("results.retentionPlain", { count: r.wordCount, percent });
    }
    this.mark("retention");

    const heading = this.ink(
      "results.retention.heading",
      0,
      0,
      this.lane.copy.text("results.retentionHeading"),
      { size: TYPE.label, color: this.lane.palette.accent },
    );
    const body = this.ink(
      "results.retention.line",
      0,
      (heading.obj as Phaser.GameObjects.Text).height + 8,
      line,
      { size: TYPE.caption, color: INK.text, wrapWidth: REPORT_CONTENT_W },
    );
    return {
      id: "retention",
      height: body.dy + (body.obj as Phaser.GameObjects.Text).height,
      parts: [heading, body],
    };
  }

  /**
   * WHAT THIS BELT JUST EARNED (D80, AC-6d.1c).
   *
   * ================== WHY IT IS HERE AT ALL ==================
   * Twelve trophies were defined, the Beacon Log drew all twelve, and until
   * `@engine/awards` landed not one could ever be earned because nothing in
   * `src/` wrote to `profile.trophies`. That is fixed - `persistTrophies`
   * above is the writer - but the child still had no way to find out. The
   * award was silent, and the only place it showed up was a collection screen
   * they had to go and open. A thing that is never announced is, to a
   * seven-year-old, a thing that did not happen.
   *
   * ================== WHY IT IS NOT AN EMPTY STATE ==================
   * The section is ABSENT when nothing was earned, not present and empty. A
   * "Trophies Earned: none" row turns the stage report into a list of what the
   * child did not do, on the screen they reach by succeeding - which is D31's
   * one rule with the nouns changed. Most belts earn nothing, so most reports
   * simply do not have this section, and the panel is sized from its content
   * (`resultsLayout.fitPanel`) so it closes up rather than leaving a hole.
   *
   * ================== WHERE THE ROOM CAME FROM, MEASURED ==================
   * Mostly from slack that was already there. The report panel is a measured
   * STACK - every piece reports its own height and `resultsLayout` FLOWS them
   * rather than fitting them into a fixed box - so a sixth piece is absorbed
   * three ways, in this order:
   *
   *   1. On a SHORT report the panel does not change size at all. Measured on
   *      the served build, a Mars run with stats/hull/personal-best/trophies:
   *      the panel is {96, 231, 1063x430} with the section and {96, 231,
   *      1063x430} without it - `REPORT_MIN_H` is 430 and the content was
   *      under it either way.
   *   2. On a FULL report the air between blocks tightens. With all five other
   *      pieces present, a 66 px section costs the panel 39 px of height; the
   *      other 27 come out of the inter-block gap, which goes 27 -> 20.
   *   3. Only past that does the panel grow and take the buttons down with it,
   *      bounded by `BUTTON_Y_MAX`.
   *
   * NO SECTION IS SHRUNK in any of the three, which is the part that matters
   * and the part `resultsTrophies.test.ts` asserts block by block. The two
   * rows this adds are the same heading-plus-line shape the retention block
   * already uses, so the panel reads as one more section rather than as a
   * different kind of thing.
   *
   * ================== IT IS INFORMATIONAL, NOT A CEREMONY (D74) ==================
   * Names only. No count, no "3 of 12", no rarity, no order by value, no
   * comparison with anybody. `persistTrophies`' own note argues from
   * Deci/Koestner/Ryan (1999) that a results screen which announces an award
   * becomes a reward ceremony; a quiet line that says which ones, in the same
   * ink as the retention line beside it, is the smallest thing that answers
   * "did that count?" without becoming one. See collision C24.
   */
  private trophiesPiece(): Piece {
    const earned = this.earnedTrophies;
    if (earned.length === 0) return EMPTY_PIECE("trophies");

    const t = createMenuTranslator(this.lane.lang, this.lane.shipName);
    const order = new Map(TROPHIES.map((def, i) => [def.id, i]));
    const names = [...earned]
      // The catalogue's order, which is the order AC-6d.1c lists them in and
      // the order the Beacon Log draws them in. NOT the order they happened to
      // be satisfied in, which is an implementation detail of `newTrophies`.
      .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map((id) => {
        const def = TROPHIES.find((d) => d.id === id);
        return def === undefined ? id : t.t(def.nameKey);
      });
    this.mark("trophies");

    const heading = this.ink(
      "results.trophies.heading",
      0,
      0,
      this.lane.copy.text("results.trophiesHeading"),
      { size: TYPE.label, color: this.lane.palette.accent },
    );
    const body = this.ink(
      "results.trophies.line",
      0,
      (heading.obj as Phaser.GameObjects.Text).height + 8,
      this.lane.copy.text("results.trophiesList", { names: names.join("  ·  ") }),
      { size: TYPE.caption, color: INK.text, wrapWidth: REPORT_CONTENT_W },
    );
    return {
      id: "trophies",
      height: body.dy + (body.obj as Phaser.GameObjects.Text).height,
      parts: [heading, body],
    };
  }

  // -------------------------------------------------------------------------
  // The panel and the two things you can do about it
  // -------------------------------------------------------------------------

  /**
   * Lay the stage report out and draw the buttons under it.
   *
   * THE NEARBY-PILOTS BOARD IS GONE (UR-102). A second panel used to stand in
   * the right-hand column holding a one-time question - "want to see the pilots
   * flying near your speed?" - and the board that question turned on. There was
   * never anything behind it: D43 rules out accounts and there is no network,
   * so the board's only honest state was "no other pilots nearby yet", and a
   * question with no answer behind it does not belong on the screen a child
   * reaches by finishing a stage. The owner cut the feature; this is the
   * deletion, not a flag.
   *
   * `settings.relativeBoard` is STILL PERSISTED and still decoded by
   * `engine/persistence/schema.ts`, deliberately: removing a field from a
   * stored profile is the only part of this that could damage a save, and it
   * buys nothing. Nothing reads it now.
   *
   * `resultsLayout` still takes a second column and is handed nothing to put in
   * it - the `board === null` branch it has always had - so the stage report's
   * own rectangle is unchanged to the pixel by this removal.
   */
  /**
   * Where Shadow stands, measured at RUN TIME.
   *
   * Two things were wrong with the module constant. The scale mode is
   * `HEIGHT_CONTROLS_WIDTH`: height is pinned at 1080 and width follows the
   * window's aspect, so `GAME_WIDTH` is only the real width at 16:9 - on a
   * 1728x901 window the game is 2071 wide and she sat 151 px short of the
   * gutter. And she is drawn MIRRORED here, so her reach right is the LEFT
   * coefficient (UR-164).
   */
  private shadowAt(): { x: number; y: number } {
    const at = shadowOrigin(this.scale.width, SHADOW_SCALE);
    return { x: at.x + shadowMirrorInset(SHADOW_SCALE), y: at.y };
  }

  private renderActions(): void {
    for (const part of this.actionParts) part.destroy();
    this.actionParts = [];

    const hud = this.parallax.layerOf("hud").container;

    const laid = resultsLayout({
      report: this.reportPieces,
      board: [],
      sun: sunDisc(lightPositionOf(this.lane.palette)),
      shadow: (() => {
        const stand = this.shadowAt();
        return shadowBox(stand.x, stand.y, SHADOW_SCALE);
      })(),
    });

    // Published for the e2e pixel probe (`results-panel-opacity.spec.ts`):
    // the card's rectangle in design space, so the probe reads the panel the
    // screen actually drew rather than a rectangle somebody transcribed.
    this.panelRects = { report: laid.report };

    this.drawPanel(this.reportPlate, laid.report);
    for (const placed of laid.reportContent) {
      const piece = this.reportPieces.find((p) => p.id === placed.id);
      if (piece) this.place(piece, placed);
    }

    // Replay is drawn first because "back" reads on the left. CONTINUE is the
    // primary, so the caret opens on it whatever the layout order is: the
    // forward action is the default on every screen that offers both, and a
    // child pressing Enter on reflex moves on with their run rather than
    // silently re-flying the stage they just finished.
    const targets: FocusTarget[] = [];
    targets.push(
      this.button(
        laid.replay,
        this.lane.copy.text("results.replay"),
        "replay",
        "results.replay",
        false,
        () => this.replay(),
      ),
    );
    targets.push({
      ...this.button(
        laid.proceed,
        this.lane.copy.text("results.continue"),
        "continue",
        "results.continue",
        true,
        () => this.continueOn(),
      ),
      primary: true,
    });
    this.hint?.destroy();
    // THE SHARED RENDERER, and it takes no coordinates (`ui/hintLine.ts`).
    // `resultsLayout` used to hand it an x and a y; the ink was already
    // `INK.textDim` on a plate - was `INK.textFaint` on bare sky at 2.57:1,
    // which no seven-year-old can read - and that treatment is now what every
    // screen gets rather than what two screens happened to have.
    this.hint = drawHint(this, this.lane.copy.text("results.hint"), {
      screen: "results",
      id: "results.hint",
      depth: layer("hud").depth + 2,
      style: { lang: this.lane.lang, ...typographyOf(this) },
    });

    hud.add(this.actionParts);
    // The caret opens on CONTINUE, which is `primary` above. No id is passed:
    // the kit's own `openingIndex` takes the primary target, so the rule lives
    // in one place for every screen instead of being restated here. There used
    // to be a second rule - the D43 opt-in question took the caret while it was
    // being asked - and it went with the question.
    this.menu.setTargets(targets);
  }

  /**
   * A button with a real surface.
   *
   * `primary` is the filled one. Both get a border, because the thing that made
   * the shipped pair read as disabled was that neither had an edge of any kind.
   */
  private button(
    r: Rect,
    text: string,
    id: string,
    inkId: string,
    primary: boolean,
    activate: () => void,
  ): FocusTarget {
    const g = this.add.graphics().setDepth(1);
    // THE SHARED ACTION BUTTON (UR-112, `ui/plate.paintActionButton`).
    //
    // This used to fill the primary with `this.lane.palette.accent` and stroke
    // it with that accent mixed toward white. The owner reported the result as
    // "'Fly It Again' and 'Continue' on the stage report do not have the right
    // yellow outline" - and they did have it: `INK.accent` on the Earth accent
    // is a contrast ratio of 1.00, so the ring was drawn onto its own colour.
    // At Mars it was gold on coral, 1.83:1.
    //
    // It is also `docs/coding-standards.md` rule 1, which already names this
    // exact failure: a themed value must not reach the buttons. Both emphases
    // are fixed tokens now, and the accent is the ring's alone.
    paintActionButton(g, r, { primary });
    this.actionParts.push(g);

    // D41: a button label is chrome and chrome is lowercase. Applied HERE and
    // not only in the string table, because the capture had `fly it again`
    // sitting next to `Continue` in one row - the table is shared with other
    // screens and this is the render site that has to be right either way.
    const t = skyText(this, r.x + r.w / 2, r.y + r.h / 2, chromeCase(text, typographyOf(this).uppercase), {
      screen: "results",
      id: inkId,
      size: TYPE.label,
      color: ACTION_INK.label,
      align: "center",
      lang: this.lane.lang,
      plated: true,
      plateFill: primary ? ACTION_INK.primaryFill : ACTION_INK.secondaryFill,
      depth: 2,
      originX: 0.5,
      originY: 0.5,
    }).text;
    this.actionParts.push(t);
    return { id, x: r.x, y: r.y, w: r.w, h: r.h, activate };
  }

  /**
   * The route as the STORE holds it, not as the init payload described it.
   *
   * `this.lane.progress` is the array this screen was handed, and by the time it
   * gets here it has crossed Flight, Warp and Beacon. Beacon's clear is written
   * to the profile and this screen has just written the stage's figures on top
   * of it, so the payload is by definition the older of the two. Forwarding it
   * to the map is what left Jupiter locked after Mars was charted.
   *
   * Falls back to the payload for a standalone mount, where there is no store.
   */
  private currentProgress(): readonly StopProgress[] {
    return storedProgress(this) ?? this.lane.progress;
  }

  private replay(): void {
    goTo(this, SCENE_KEYS.flight, {
      ctx: this.lane.ctx,
      progress: this.currentProgress(),
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.stopId,
    });
  }

  private continueOn(): void {
    goTo(this, SCENE_KEYS.map, {
      ctx: this.lane.ctx,
      progress: this.currentProgress(),
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.stopId,
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
    const r = this.results;
    return {
      scene: SCENE_KEYS.results,
      stopId: this.stopId,
      accent: this.lane.palette.accent,
      wpm: r.wpm,
      accuracy: r.accuracy,
      wpmDelta: r.wpmDelta,
      accuracyDelta: r.accuracyDelta,
      previousStopId: r.previousStopId,
      stars: r.stars,
      // The stage's own hull, not D27's three: a six-mark belt cleared with
      // three marks gone is a CLEARED belt (@engine/hull, AC-4.4).
      starsRendered: isClearableHullHits(this.tally.hullHits, this.tally.maxHull),
      /** D80: trophies this run earned. The Beacon Log is where they are read. */
      trophiesEarned: [...this.earnedTrophies],
      fasterWords: r.words.filter((w) => w.faster).map((w) => w.word),
      slowerWords: r.words
        .filter((w) => !w.faster && (w.improvement ?? 0) < 0)
        .map((w) => w.word),
      retention: {
        wordCount: r.retention.wordCount,
        hitRate: r.retention.hitRate,
        meanLatencyDeltaMs: r.retention.meanLatencyDeltaMs,
      },
      isNewBest: this.isNewBest,
      bestWpm: this.stopProgress.bestWpm,
      rendered: [...this.rendered],
      /** AC-22.8: every colour pair this screen drew, for the contrast rubric. */
      skyText: skyTextSamples(this),
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusIds: this.menu.targets.map((t) => t.id),
      reducedMotion: this.lane.reducedMotion,
      /** Where the card was drawn, in design space. */
      panels: this.panelRects,
    };
  }

  private publish(): void {
    publishBag("results", {
      snapshot: () => this.snapshot(),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
    });
  }
}
