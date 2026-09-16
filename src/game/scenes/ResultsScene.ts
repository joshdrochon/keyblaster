import Phaser from "phaser";
import {
  computeStageResults,
  isClearableHullHits,
  type StageResults,
  type StageTally,
  type WordExposure,
} from "@engine/scoring";
import {
  DEFAULT_CALIBRATION,
  DEFAULT_SETTINGS,
  type Profile,
  type StopId,
  type StopProgress,
} from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum } from "@game/render/palette";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { starPoints } from "@game/render/textures";
import { DUR, INK, TYPE } from "@game/ui/theme";
import { goTo, progressFor, type StoryInit } from "./lib/init";
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
import { laneInit, publishBag, textStyles, type LaneInit } from "./support/laneInit";
import { relativeWindow, type RelativeRow } from "./support/relativeBoard";

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
 */

const PANEL = { x: 160, y: 236, w: 980, h: 700 } as const;
const BOARD = { x: 1180, y: 236, w: 580, h: 700 } as const;
const BUTTON_Y = 966;

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
}

const EMPTY_TALLY: StageTally = {
  characters: 0,
  elapsedMs: 0,
  hits: 0,
  typos: 0,
  hullHits: 0,
};

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
  private optedIn = false;
  private promptShown = false;
  private boardParts: Phaser.GameObjects.GameObject[] = [];
  private rendered: string[] = [];

  constructor() {
    super(SCENE_KEYS.results);
  }

  init(data: ResultsInit | undefined): void {
    this.initData = data;
    this.boardParts = [];
    this.rendered = [];
    this.promptShown = false;
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
    this.optedIn = profile.settings.relativeBoard;

    this.parallax = buildParallax(this, {
      palette: this.lane.palette,
      reducedMotion: this.lane.reducedMotion,
      worldSpeed: 0,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: 0x5c0e,
    });

    const hud = this.parallax.layerOf("hud").container;
    hud.add(this.buildHeader());
    hud.add(this.buildRates());
    hud.add(this.buildStars());
    hud.add(this.buildPersonalBest());
    hud.add(this.buildFasterWords());
    hud.add(this.buildRetention());
    hud.add(
      plate(this, BOARD.x, BOARD.y, BOARD.w, BOARD.h, {
        fill: INK.panel,
        stroke: INK.line,
      }),
    );

    this.shadow = drawShadow(this, 1830, 940, this.results.stars === 3 ? "cheering" : "idle", {
      scale: 0.7,
      facing: -1,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("shipFx").depth,
    });

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    this.menu = createKeyboardMenu(this, this.ring, []);
    this.renderBoard();

    this.publish();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu.destroy();
      this.ring.destroy();
      this.shadow.destroy();
      this.parallax.destroy();
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
    return {
      id: "local",
      name: this.lane.shipName,
      avatar: "avatar-1",
      shipId: "ship-1",
      shipName: this.lane.shipName,
      createdAt: 0,
      calibration: { ...DEFAULT_CALIBRATION },
      settings: { ...DEFAULT_SETTINGS },
      progress: [...this.lane.progress],
      trophies: [],
      unlockedShips: [],
      unlockedSkins: [],
      words: {},
    };
  }

  private mark(key: string): void {
    this.rendered.push(key);
  }

  // -------------------------------------------------------------------------
  // Left panel
  // -------------------------------------------------------------------------

  private buildHeader(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    this.mark("heading");
    return [
      label(this, 160, 90, this.lane.copy.text("results.heading"), {
        size: TYPE.heading,
        color: pal.accent,
        lang: this.lane.lang,
      }),
      label(this, 160, 154, this.lane.copy.stopName(this.stopId), {
        size: TYPE.body,
        color: pal.plateText,
        alpha: 0.7,
        lang: this.lane.lang,
      }),
      plate(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h, {
        fill: INK.panel,
        stroke: INK.line,
      }),
    ];
  }

  /**
   * AC-20.1. The delta line exists only when `wpmDelta` is not null, which is
   * exactly when there is a previous BELT stage to compare against.
   */
  private buildRates(): Phaser.GameObjects.GameObject[] {
    const made: Phaser.GameObjects.GameObject[] = [];
    made.push(
      ...this.statBlock(
        PANEL.x + 48,
        PANEL.y + 44,
        this.lane.copy.text("results.wpmLabel"),
        `${Math.round(this.results.wpm)}`,
        this.results.wpmDelta === null ? null : Math.round(this.results.wpmDelta),
        "wpm",
      ),
    );
    made.push(
      ...this.statBlock(
        PANEL.x + 480,
        PANEL.y + 44,
        this.lane.copy.text("results.accuracyLabel"),
        `${Math.round(this.results.accuracy * 100)}%`,
        this.results.accuracyDelta === null
          ? null
          : Math.round(this.results.accuracyDelta * 100),
        "accuracy",
      ),
    );
    return made;
  }

  private deltaLine(amount: number): string {
    const previous = this.results.previousStopId;
    const stop = previous === null ? "" : this.lane.copy.stopName(previous);
    if (amount === 0) return this.lane.copy.text("results.deltaSame", { stop });
    const key = amount > 0 ? "results.deltaUp" : "results.deltaDown";
    return this.lane.copy.text(key, { amount: Math.abs(amount), stop });
  }

  private statBlock(
    x: number,
    y: number,
    caption: string,
    value: string,
    delta: number | null,
    key: string,
  ): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];
    made.push(
      label(this, x, y, caption, {
        size: TYPE.caption,
        color: INK.textDim,
        lang: this.lane.lang,
      }),
    );
    const v = label(this, x, y + 30, value, {
      size: TYPE.display,
      color: pal.accent,
      lang: this.lane.lang,
    });
    made.push(v);
    this.mark(key);
    if (!this.lane.reducedMotion) {
      v.setScale(0.9);
      this.tweens.add({ targets: v, scale: 1, duration: 340, ease: EASE.pop });
    }

    if (delta === null) return made;
    // Neutral ink, never a warning colour: a delta is a measurement, not a mark.
    made.push(
      label(this, x, y + 122, this.deltaLine(delta), {
        size: TYPE.caption,
        color: INK.textDim,
        lang: this.lane.lang,
      }),
    );
    this.mark(`${key}-delta`);
    return made;
  }

  /**
   * AC-20.4 via AC-4.4. A stage that took three hull hits stalled and was never
   * cleared, so `starsForHullHits` returns 0 meaning "no rating"; the engine's
   * own note says the screen must DECLINE to render rather than draw a zero
   * that looks like a score.
   */
  private buildStars(): Phaser.GameObjects.GameObject[] {
    if (!isClearableHullHits(this.tally.hullHits)) return [];
    const pal = this.lane.palette;
    const g = this.add.graphics();
    const y = PANEL.y + 96;
    for (let i = 0; i < 3; i += 1) {
      const cx = PANEL.x + 770 + i * 66;
      const pts = starPoints(cx, y, 24, 11).map((p) => new Phaser.Geom.Point(p.x, p.y));
      if (i < this.results.stars) {
        g.fillStyle(hexToNum(pal.accent), 1);
        g.fillPoints(pts, true);
      } else {
        // Not-yet-earned is drawn dim, never struck through (D31).
        g.lineStyle(2, hexToNum(INK.textFaint), 0.8);
        g.strokePoints(pts, true, true);
      }
    }
    this.mark("stars");
    return [
      g,
      label(
        this,
        PANEL.x + 752,
        PANEL.y + 140,
        this.lane.copy.text("map.stars", { stars: this.results.stars }),
        { size: TYPE.caption, color: INK.textFaint, lang: this.lane.lang },
      ),
    ];
  }

  private buildPersonalBest(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const line = this.isNewBest
      ? this.lane.copy.text("results.newPersonalBest")
      : this.lane.copy.text("results.personalBest", {
          wpm: Math.round(this.stopProgress.bestWpm),
        });
    this.mark(this.isNewBest ? "personal-best-new" : "personal-best");
    return [
      label(this, PANEL.x + 48, PANEL.y + 208, line, {
        size: TYPE.label,
        color: this.isNewBest ? pal.accent : INK.textDim,
        lang: this.lane.lang,
      }),
    ];
  }

  /** AC-20.2. Only words that got faster appear. Slower words say nothing. */
  private buildFasterWords(): Phaser.GameObjects.GameObject[] {
    const faster = this.results.words.filter((w) => w.faster);
    if (faster.length === 0) return [];
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [
      label(this, PANEL.x + 48, PANEL.y + 272, this.lane.copy.text("results.fasterHeading"), {
        size: TYPE.label,
        color: pal.accent,
        lang: this.lane.lang,
      }),
    ];
    this.mark("faster-heading");

    faster.slice(0, 6).forEach((word, i) => {
      const t = label(
        this,
        PANEL.x + 48,
        PANEL.y + 316 + i * 38,
        this.lane.copy.text("results.fasterMarker", { word: word.word }),
        { size: TYPE.label, color: INK.text, alpha: 0.88, lang: this.lane.lang },
      );
      if (!this.lane.reducedMotion) {
        t.setAlpha(0);
        this.tweens.add({
          targets: t,
          alpha: 0.88,
          duration: DUR.panel,
          delay: 70 * i,
          ease: EASE.arrive,
        });
      }
      this.mark(`faster:${word.word}`);
      made.push(t);
    });
    return made;
  }

  /**
   * AC-20.3. The retention line is the single headline learning claim on this
   * screen, and it is said only when there were retention words to say it
   * about; `wordCount === 0` renders nothing at all.
   */
  private buildRetention(): Phaser.GameObjects.GameObject[] {
    const r = this.results.retention;
    if (r.wordCount === 0) return [];
    const pal = this.lane.palette;
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

    return [
      label(this, PANEL.x + 48, PANEL.y + 566, this.lane.copy.text("results.retentionHeading"), {
        size: TYPE.label,
        color: pal.accent,
        lang: this.lane.lang,
      }),
      label(this, PANEL.x + 48, PANEL.y + 606, line, {
        size: TYPE.caption,
        color: INK.text,
        alpha: 0.85,
        wrapWidth: PANEL.w - 96,
        lang: this.lane.lang,
      }),
    ];
  }

  // -------------------------------------------------------------------------
  // Relative board (D43) and the buttons, which share a focus list
  // -------------------------------------------------------------------------

  private renderBoard(): void {
    for (const part of this.boardParts) part.destroy();
    this.boardParts = [];

    const hud = this.parallax.layerOf("hud").container;
    const pal = this.lane.palette;
    const x = BOARD.x + 40;
    const y = BOARD.y + 44;
    const targets: FocusTarget[] = [];

    if (!this.optedIn) {
      this.promptShown = true;
      this.mark("board-prompt");
      this.boardParts.push(
        label(this, x, y, this.lane.copy.text("results.boardPrompt"), {
          size: TYPE.label,
          color: INK.text,
          alpha: 0.9,
          wrapWidth: BOARD.w - 80,
          lang: this.lane.lang,
        }),
      );
      targets.push(
        this.button(x, y + 190, BOARD.w - 80, this.lane.copy.text("results.boardPromptYes"), "board-yes", () =>
          this.setOptIn(true),
        ),
      );
      targets.push(
        this.button(x, y + 274, BOARD.w - 80, this.lane.copy.text("results.boardPromptNo"), "board-no", () =>
          this.setOptIn(false),
        ),
      );
    } else {
      this.mark("board");
      this.boardParts.push(
        label(this, x, y, this.lane.copy.text("results.boardHeading"), {
          size: TYPE.label,
          color: pal.accent,
          lang: this.lane.lang,
        }),
      );
      const rows = relativeWindow(this.initData?.relativeBoard ?? []);
      if (rows.length === 0) {
        this.mark("board-empty");
        this.boardParts.push(
          label(this, x, y + 52, this.lane.copy.text("results.boardEmpty"), {
            size: TYPE.caption,
            color: INK.textDim,
            wrapWidth: BOARD.w - 80,
            lang: this.lane.lang,
          }),
        );
      }
      rows.forEach((row, i) => {
        // No index, no position, no total. A name and a speed (D43).
        const rowY = y + 60 + i * 52;
        this.boardParts.push(
          label(
            this,
            x,
            rowY,
            row.isYou ? this.lane.copy.text("results.boardYou") : row.label,
            {
              size: TYPE.label,
              color: row.isYou ? pal.accent : INK.text,
              alpha: row.isYou ? 1 : 0.8,
              lang: this.lane.lang,
            },
          ),
        );
        const speed = label(this, BOARD.x + BOARD.w - 40, rowY, `${Math.round(row.wpm)}`, {
          size: TYPE.label,
          color: row.isYou ? pal.accent : INK.text,
          alpha: row.isYou ? 1 : 0.8,
          align: "right",
          lang: this.lane.lang,
        });
        speed.setOrigin(1, 0);
        this.boardParts.push(speed);
      });
    }

    targets.push(
      this.button(160, BUTTON_Y, 420, this.lane.copy.text("results.replay"), "replay", () =>
        this.replay(),
      ),
    );
    targets.push(
      this.button(620, BUTTON_Y, 420, this.lane.copy.text("results.continue"), "continue", () =>
        this.continueOn(),
      ),
    );
    this.boardParts.push(
      label(this, 1080, BUTTON_Y + 20, this.lane.copy.text("results.hint"), {
        size: TYPE.caption,
        color: INK.textFaint,
        lang: this.lane.lang,
      }),
    );

    hud.add(this.boardParts);
    this.menu.setTargets(targets);
  }

  private button(
    x: number,
    y: number,
    w: number,
    text: string,
    id: string,
    activate: () => void,
  ): FocusTarget {
    const h = 64;
    this.boardParts.push(
      plate(this, x, y, w, h, { fill: INK.panelRaised, stroke: INK.line }),
    );
    const t = label(this, x + w / 2, y + h / 2, text, {
      size: TYPE.label,
      color: this.lane.palette.accent,
      align: "center",
      lang: this.lane.lang,
    });
    t.setOrigin(0.5);
    this.boardParts.push(t);
    return { id, x, y, w, h, activate };
  }

  private setOptIn(optedIn: boolean): void {
    this.optedIn = optedIn;
    this.initData?.onRelativeBoardOptIn?.(optedIn);
    // Persist the choice where the profile lives; D43 says the board is opt-in,
    // which is only true if "not now" is remembered too.
    const store = this.lane.services?.store;
    const active = store?.activeProfile();
    if (store && active) store.updateSettings(active.id, { relativeBoard: optedIn });
    this.renderBoard();
  }

  private replay(): void {
    goTo(this, SCENE_KEYS.flight, {
      ctx: this.lane.ctx,
      progress: this.lane.progress,
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.stopId,
    });
  }

  private continueOn(): void {
    goTo(this, SCENE_KEYS.map, {
      ctx: this.lane.ctx,
      progress: this.lane.progress,
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
      starsRendered: isClearableHullHits(this.tally.hullHits),
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
      boardRows: relativeWindow(this.initData?.relativeBoard ?? []).map((row) => ({
        label: row.isYou ? this.lane.copy.text("results.boardYou") : row.label,
        wpm: row.wpm,
        isYou: row.isYou,
      })),
      rendered: [...this.rendered],
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusIds: this.menu.targets.map((t) => t.id),
      reducedMotion: this.lane.reducedMotion,
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
