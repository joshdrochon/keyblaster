import Phaser from "phaser";
import {
  computeStageResults,
  isClearableHullHits,
  type StageResults,
  type StageTally,
  type WordExposure,
} from "@engine/scoring";
import { awardTrophies, newTrophies, type StageAward } from "@engine/awards";
import { applyUnlocks, newUnlocks } from "@engine/unlocks/index.js";
import { WORST_CASE_SKY, compositeOver } from "@engine/contrast/index.js";
import {
  type Profile,
  type StopId,
  type StopProgress,
} from "@engine/types";
import { blankProfile } from "@engine/persistence/index.js";
import { SCENE_KEYS } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum, lightPositionOf, mixHex } from "@game/render/palette";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { starPoints } from "@game/render/textures";
import { DUR, INK, SPACE, TYPE, chromeCase } from "@game/ui/theme";
import { headerText } from "@game/ui/grid";
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
import { paintPlate } from "@game/ui/plate";
import { typographyOf } from "./lib/typography";
import { type HintLine, drawHint } from "@game/ui/hintLine";
import { laneInit, publishBag, textStyles, type LaneInit } from "./support/laneInit";
import {
  openingFocusId,
  relativeWindow,
  type RelativeRow,
} from "./support/relativeBoard";
import {
  BOARD_W,
  BOARD_X,
  BUTTON_H,
  PANEL_PAD_X,
  REPORT_W,
  SHADOW_GAP,
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
 * THE RELATIVE BOARD IS OFF UNTIL ASKED (D43): default off, one calm prompt the
 * first time this screen would show it, up to two pilots either side of you,
 * and never a global rank.
 *
 * -------------------------------------------------------------------------
 * WHY THE PANELS ARE MEASURED AND NOT DECLARED
 *
 * This screen used to draw two rectangles of a fixed 700 px and hang content off
 * the top of each at hand-written offsets. On a first run at Mars four of the
 * six blocks are correctly ABSENT - no delta (D57), no personal best (nothing to
 * beat), no faster words, no retention set - so about three quarters of both
 * panels was empty black. A stage report that is mostly nothing does not read as
 * restraint; it reads as a screen that failed to load.
 *
 * So every block MEASURES itself (`Piece.height` comes from the Phaser Text, not
 * from a table of guesses) and `support/resultsLayout.ts` turns those heights
 * into rectangles. The same module keeps the panels off Shadow and pulls their
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
 * A BUTTON HAS A SURFACE (AC-18.1's visible affordance half).
 *
 * The two actions were drawn as `INK.panelRaised` plates on an `INK.panel`
 * panel - 1.08:1, which is not an edge - with their labels in the stop accent.
 * A control with no fill difference, no border and coloured text reads as
 * DISABLED, and a capture showed exactly that: "fly it again" and "continue"
 * looked like two captions. So the secondary action gets a lifted fill and a
 * border you can see against the panel, and the primary one is filled in the
 * stop accent with dark ink on it - the same treatment the Title gives "play",
 * so "the filled one is the one you meant" holds across the game.
 */
const BUTTON_FILL = "#32445E";
const BUTTON_STROKE = "#5A7195";
/**
 * What the primary button's edge is mixed TOWARD, as a token rather than as a
 * `"#FFFFFF"` written inside a draw call. It is pure white; naming it is what
 * keeps the scene's ink greppable alongside the rest (UR-69).
 */
const BUTTON_EDGE_LIGHT = "#FFFFFF";
const BUTTON_INK = INK.panelSunken;

/** Where Shadow stands, and how big he is there. */
const SHADOW_AT = { x: 1830, y: 940, scale: 0.7 } as const;

/**
 * Wrap widths, fixed BEFORE the layout runs because the layout is computed from
 * the heights these widths produce. The board's is the NARROWED width - what it
 * would be if the panel had to give way to Shadow - so a line can never be
 * measured against a panel wider than the one it ends up in.
 */
const REPORT_CONTENT_W = REPORT_W - PANEL_PAD_X * 2;
const BOARD_CONTENT_W =
  Math.floor(
    Math.min(
      BOARD_W,
      shadowBox(SHADOW_AT.x, SHADOW_AT.y, SHADOW_AT.scale).x - SHADOW_GAP - BOARD_X,
    ),
  ) -
  PANEL_PAD_X * 2;

/** Column starts inside the report panel, as offsets from its content edge. */
const COL_ACCURACY = 340;
const STARS_W = 180;

export interface ResultsInit extends StoryInit {
  readonly tally?: StageTally;
  readonly exposures?: readonly WordExposure[];
  /** The profile as it stood BEFORE this stage was written back (see scoring/). */
  readonly profile?: Profile;
  /**
   * Rows for the relative board. There is no source for these yet (D43: no
   * accounts, no network), so the default is none and the board says so.
   */
  readonly relativeBoard?: readonly RelativeRow[];
  readonly onRelativeBoardOptIn?: (optedIn: boolean) => void;
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
 * is in it. Parts are positioned RELATIVE to the block, so placing a block twice
 * (the board rebuilds when the D43 question is answered) is idempotent.
 */
interface Piece extends Block {
  readonly parts: readonly Part[];
}

const EMPTY_PIECE = (id: string): Piece => ({ id, height: 0, parts: [] });

/**
 * Whether the results screen asks about nearby pilots (UR-102).
 *
 * False: there is nothing behind the feature yet, so the question has no
 * honest answer. See the note at its only use.
 */
const BOARD_PROMPT_ENABLED = false;

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
  private optedIn = false;
  /** Trophies THIS run earned, in award order (AC-6d.2: once per profile). */
  private earnedTrophies: readonly string[] = [];
  private promptShown = false;
  /** True once the player has answered the one-time prompt, either way. */
  private promptAnswered = false;

  private reportPieces: Piece[] = [];
  private boardPieces: Piece[] = [];
  private boardParts: Phaser.GameObjects.GameObject[] = [];
  /** The rectangles `drawPanel` last filled. Read-only, for the e2e probe. */
  private panelRects: { report: Rect | null; board: Rect | null } = {
    report: null,
    board: null,
  };
  private reportPlate!: Phaser.GameObjects.Graphics;
  private boardPlate!: Phaser.GameObjects.Graphics;
  /**
   * The keyboard hint. Kept whole rather than pushed into `boardParts`: it is a
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
    this.boardPieces = [];
    this.boardParts = [];
    this.hint = null;
    this.rendered = [];
    this.promptShown = false;
    this.promptAnswered = false;
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
    this.optedIn = profile.settings.relativeBoard;

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
    this.boardPlate = this.add.graphics().setDepth(0);
    hud.add([this.reportPlate, this.boardPlate]);

    this.buildHeader();
    this.reportPieces = [
      this.statsPiece(),
      this.hullPiece(),
      this.personalBestPiece(),
      this.fasterPiece(),
      this.retentionPiece(),
    ];
    for (const piece of this.reportPieces) {
      for (const part of piece.parts) hud.add(part.obj);
    }

    this.shadow = drawShadow(
      this,
      SHADOW_AT.x,
      SHADOW_AT.y,
      this.results.stars === 3 ? "cheering" : "idle",
      {
        scale: SHADOW_AT.scale,
        facing: -1,
        reducedMotion: this.lane.reducedMotion,
        depth: layer("shipFx").depth,
      },
    );

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    this.menu = createKeyboardMenu(this, this.ring, [], {
      // DELIBERATELY NOT ESCAPABLE (UR-86). The run is over and scored. Going
      // "back" would mean back into a belt that has already been banked.
      onBack: () => {},
    });
    this.renderBoard();

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

  // -------------------------------------------------------------------------
  // Relative board (D43) and the buttons, which share a focus list
  // -------------------------------------------------------------------------

  /**
   * The board panel, the one-time prompt, or nothing at all - and then the
   * whole screen is laid out around whichever it turned out to be.
   *
   * "Not now" means NOT NOW: the panel disappears rather than asking again on
   * the same screen. A prompt that reappears after being declined is not
   * opt-in, it is nagging, and D43 asks for one calm prompt.
   */
  private renderBoard(): void {
    for (const part of this.boardParts) part.destroy();
    this.boardParts = [];
    for (const piece of this.boardPieces) {
      for (const part of piece.parts) part.obj.destroy();
    }
    this.boardPieces = [];

    const hud = this.parallax.layerOf("hud").container;
    const showPanel = this.optedIn || !this.promptAnswered;
    /**
     * Is the screen ASKING right now?
     *
     * Set only inside the branch that actually draws the question, so it is a
     * fact about what is on screen right now rather than about
     * `this.promptShown`, which is sticky for the snapshot's benefit and stays
     * true after the question has been answered and removed. `openingFocusId`
     * turns it into the id the caret opens on.
     */
    let asking = false;
    /** Board rows that are buttons, in the order they are drawn. */
    const boardButtons: { id: string; text: string; activate: () => void }[] = [];

    if (!showPanel) this.mark("board-declined");

    // THE NEARBY-PILOTS PROMPT IS HIDDEN (UR-102).
    //
    // It asked a child to opt into seeing pilots flying near their speed, and
    // there is NO DATA SOURCE behind it - no leaderboard, no peers, nothing to
    // show if they said yes. It has been on the escalation list as "no data
    // source, lean: hide it" since it was first raised; the owner has now
    // called it.
    //
    // HIDDEN, NOT DELETED. The consent flow, the persisted choice and the board
    // rendering all still work and are still tested - the one thing that
    // changed is that the question is not asked. Turning it back on is this
    // constant, not a rebuild, for the day there is something to put behind it.
    //
    // A child who ALREADY opted in keeps their board: the `else if` below is
    // untouched, so this removes a question rather than revoking a choice.
    if (BOARD_PROMPT_ENABLED && !this.optedIn && !this.promptAnswered) {
      this.promptShown = true;
      asking = true;
      this.mark("board-prompt");
      this.boardPieces.push(
        this.textPiece(
          "board-prompt",
          "results.board.prompt",
          this.lane.copy.text("results.boardPrompt"),
          TYPE.label,
          INK.text,
        ),
      );
      boardButtons.push({
        id: "board-yes",
        text: this.lane.copy.text("results.boardPromptYes"),
        activate: () => this.setOptIn(true),
      });
      boardButtons.push({
        id: "board-no",
        text: this.lane.copy.text("results.boardPromptNo"),
        activate: () => this.setOptIn(false),
      });
      for (const b of boardButtons) {
        this.boardPieces.push({ id: b.id, height: BUTTON_H, parts: [] });
      }
    } else if (this.optedIn) {
      this.mark("board");
      this.boardPieces.push(
        this.textPiece(
          "board-heading",
          "results.board.heading",
          this.lane.copy.text("results.boardHeading"),
          TYPE.label,
          this.lane.palette.accent,
        ),
      );
      const rows = relativeWindow(this.initData?.relativeBoard ?? []);
      if (rows.length === 0) {
        this.mark("board-empty");
        this.boardPieces.push(
          this.textPiece(
            "board-empty",
            "results.board.empty",
            this.lane.copy.text("results.boardEmpty"),
            TYPE.caption,
            INK.textDim,
          ),
        );
      } else {
        this.boardPieces.push(this.rowsPiece(rows));
      }
    }

    for (const piece of this.boardPieces) {
      for (const part of piece.parts) hud.add(part.obj);
    }

    const laid = resultsLayout({
      report: this.reportPieces,
      board: this.boardPieces,
      sun: sunDisc(lightPositionOf(this.lane.palette)),
      shadow: shadowBox(SHADOW_AT.x, SHADOW_AT.y, SHADOW_AT.scale),
    });

    // Published for the e2e pixel probe (`results-panel-opacity.spec.ts`):
    // the card's rectangle in design space, so the probe reads the panel the
    // screen actually drew rather than a rectangle somebody transcribed.
    this.panelRects = { report: laid.report, board: laid.board };

    this.drawPanel(this.reportPlate, laid.report);
    this.drawPanel(this.boardPlate, laid.board);
    for (const placed of laid.reportContent) {
      const piece = this.reportPieces.find((p) => p.id === placed.id);
      if (piece) this.place(piece, placed);
    }

    const targets: FocusTarget[] = [];
    for (const placed of laid.boardContent) {
      const button = boardButtons.find((b) => b.id === placed.id);
      if (button === undefined) {
        const piece = this.boardPieces.find((p) => p.id === placed.id);
        if (piece) this.place(piece, placed);
        continue;
      }
      targets.push(
        this.button(
          { x: placed.x, y: placed.y, w: placed.w, h: BUTTON_H },
          button.text,
          button.id,
          `results.${button.id === "board-yes" ? "board.yes" : "board.no"}`,
          false,
          button.activate,
        ),
      );
    }

    // Replay is drawn first because "back" reads on the left. CONTINUE is the
    // primary, so the caret opens on it whatever the layout order is: the
    // forward action is the default on every screen that offers both, and a
    // child pressing Enter on reflex moves on with their run rather than
    // silently re-flying the stage they just finished.
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

    hud.add(this.boardParts);
    // The caret opens on CONTINUE (`primary`, above) - except while the D43
    // opt-in question is on screen, when it opens on the question. A one-time
    // prompt the default action skips past is a prompt nobody ever answers,
    // and the defect being fixed here was "replay steals the default", not
    // "anything that is not continue steals the default". The rule itself is
    // `openingFocusId` in support/relativeBoard.ts, where it is unit-tested.
    this.menu.setTargets(targets, openingFocusId(targets, asking) ?? undefined);
  }

  /** One wrapped line of board copy, measured. */
  private textPiece(
    id: string,
    inkId: string,
    content: string,
    size: number,
    color: string,
  ): Piece {
    const part = this.ink(inkId, 0, 0, content, {
      size,
      color,
      wrapWidth: BOARD_CONTENT_W,
    });
    return { id, height: (part.obj as Phaser.GameObjects.Text).height, parts: [part] };
  }

  /** The window around the player: a name and a speed, never a position (D43). */
  private rowsPiece(rows: readonly RelativeRow[]): Piece {
    const parts: Part[] = [];
    const rowH = Math.round(TYPE.label * 1.9);
    rows.forEach((row, i) => {
      const y = i * rowH;
      parts.push(
        this.ink(
          row.isYou ? "results.board.you" : "results.board.row",
          0,
          y,
          row.isYou ? this.lane.copy.text("results.boardYou") : row.label,
          {
            size: TYPE.label,
            color: row.isYou ? this.lane.palette.accent : INK.text,
          },
        ),
      );
      parts.push(
        this.ink(
          row.isYou ? "results.board.you" : "results.board.row",
          BOARD_CONTENT_W,
          y,
          `${Math.round(row.wpm)}`,
          {
            size: TYPE.label,
            color: row.isYou ? this.lane.palette.accent : INK.text,
            align: "right",
            originX: 1,
          },
        ),
      );
    });
    return { id: "board-rows", height: rows.length * rowH, parts };
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
    const accent = this.lane.palette.accent;
    const g = this.add.graphics().setDepth(1);
    // The same component on the `button` rhythm (UR-69). Both buttons get a
    // border, because what made the shipped pair read as disabled was that
    // neither had an edge of any kind.
    paintPlate(g, r, {
      fill: primary ? accent : BUTTON_FILL,
      alpha: 1,
      stroke: primary ? mixHex(accent, BUTTON_EDGE_LIGHT, 0.35) : BUTTON_STROKE,
      strokeAlpha: 1,
      rhythm: "button",
    });
    this.boardParts.push(g);

    // D41: a button label is chrome and chrome is lowercase. Applied HERE and
    // not only in the string table, because the capture had `fly it again`
    // sitting next to `Continue` in one row - the table is shared with other
    // screens and this is the render site that has to be right either way. No
    // proper noun ever reaches this function: the board's pilot names are rows,
    // not buttons.
    const t = skyText(this, r.x + r.w / 2, r.y + r.h / 2, chromeCase(text, typographyOf(this).uppercase), {
      screen: "results",
      id: inkId,
      size: TYPE.label,
      color: primary ? BUTTON_INK : INK.text,
      align: "center",
      lang: this.lane.lang,
      plated: true,
      plateFill: primary ? accent : BUTTON_FILL,
      depth: 2,
      originX: 0.5,
      originY: 0.5,
    }).text;
    this.boardParts.push(t);
    return { id, x: r.x, y: r.y, w: r.w, h: r.h, activate };
  }

  private setOptIn(optedIn: boolean): void {
    this.optedIn = optedIn;
    this.promptAnswered = true;
    this.initData?.onRelativeBoardOptIn?.(optedIn);
    // Persist the choice where the profile lives; D43 says the board is opt-in,
    // which is only true if "not now" is remembered too.
    const store = this.lane.services?.store;
    const active = store?.activeProfile();
    if (store && active) store.updateSettings(active.id, { relativeBoard: optedIn });
    this.renderBoard();
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
      // The stage's own hull, not D27's three: a nine-mark belt cleared with
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
      optedIn: this.optedIn,
      promptShown: this.promptShown,
      promptAnswered: this.promptAnswered,
      boardRows: relativeWindow(this.initData?.relativeBoard ?? []).map((row) => ({
        label: row.isYou ? this.lane.copy.text("results.boardYou") : row.label,
        wpm: row.wpm,
        isYou: row.isYou,
      })),
      rendered: [...this.rendered],
      /** AC-22.8: every colour pair this screen drew, for the contrast rubric. */
      skyText: skyTextSamples(this),
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusIds: this.menu.targets.map((t) => t.id),
      reducedMotion: this.lane.reducedMotion,
      /** Where the two cards were drawn, in design space. */
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
