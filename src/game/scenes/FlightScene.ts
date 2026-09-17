import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import {
  LAYERS,
  type LayerId,
  cameraSwayPx,
  layer,
} from "@game/render/layers.js";
import { particleSpec } from "@game/render/particles.js";
import { buildParallax, type Parallax } from "@game/render/parallax.js";
import { TEX } from "@game/render/textures.js";
import { paletteAt as stopPaletteAt } from "@game/render/palette.js";
import { PauseScene } from "./PauseScene.js";
import {
  type DebrisType,
  asteroidSizePx,
  drawDebris,
  drawShieldCanister,
  ensureMoteTexture,
  ensureShardTexture,
  wordDebrisTypesFor,
} from "@game/render/asteroid.js";
import {
  WordPlate,
  type WordPlateStyle,
  hexToInt,
  plateOffsetY,
} from "@game/render/wordPlate.js";
import { createAllowlist } from "@engine/allowlist/index.js";
import { fallTimeMs } from "@engine/fallTime/index.js";
import {
  type LockEmit,
  type LockEvent,
  type LockOptions,
  type LockState,
  createLockState,
  reduce,
} from "@engine/lock/index.js";
import { createWordMatcher } from "@engine/i18n/index.js";
import {
  type SelectionState,
  createSelectionState,
  pickNext,
} from "@engine/selection/index.js";
import {
  type ControllerState,
  createController,
  endStage,
  hitRate,
  recordOutcome,
} from "@engine/controller/index.js";
import {
  expectedClearMs,
  observedBiasMs,
  spawnGapMs,
} from "@engine/pacing/index.js";
import {
  type ComboState,
  type StageTally,
  type WordExposure,
  INITIAL_COMBO_STATE,
  accuracy,
  comboReducer,
  hudMultiplierFor,
  starsForHullHits,
  wordScore,
  wpm,
} from "@engine/scoring/index.js";
import type { StageAward } from "@engine/awards/index.js";
import {
  type WordBook,
  applyToBook,
  bookOf,
  recordFor,
} from "@engine/words/index.js";
import { DEFAULT_CALIBRATION, STOP_IDS, type Calibration, type StopId } from "@engine/types.js";
import {
  DEFAULT_FLIGHT_CONFIG,
  FLIGHT_EVENTS,
  type FlightConfig,
  type FlightCue,
  type HudSnapshot,
  type Palette,
  type WarpSpeedPayload,
  flightConfigFrom,
  mulberry32,
  paletteFor,
  retentionPoolFor,
  stagePoolFor,
} from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
import {
  type BlastHistory,
  emptyHistory,
  observedTimings,
  recordBlast,
  recordMiss,
  stageOutcome,
} from "@game/flight/blastHistory.js";
import {
  hullAfterShield,
  hullAfterStrike,
  hullForStage,
  isStalled,
  maySpawnCanister,
  startingHull,
} from "@game/flight/shield.js";
import { type LaneSpec, isOnShipLane, spawnX } from "@engine/spawn/index.js";
import { refineCalibration } from "@engine/calibration/index.js";
import { refineStoredCalibration, storedCalibration } from "./lib/init.js";
import { HudScene } from "./HudScene.js";
import { StallScene } from "./StallScene.js";
import { audioFrom } from "@game/audio/wiring.js";

/**
 * SCREEN 6 - FLIGHT. The core loop (design-brief-v2.md section 6, PRD 3.1).
 *
 * THIS SCENE DECIDES NOTHING. Every rule it obeys is imported:
 *   which word spawns next      @engine/selection  (pickNext)
 *   how long it falls           @engine/fallTime   (fallTimeMs)
 *   when the next one is fed    @engine/pacing     (spawnGapMs)
 *   what a keystroke means      @engine/lock       (reduce -> emissions)
 *   what a word is worth        @engine/scoring    (combo, multiplier, wpm)
 *   what the player now knows   @engine/words      (applyToBook)
 *   how hard the next stage is  @engine/controller (endStage, one knob)
 *
 * What is left is presentation, and the presentation IS the game: the lock
 * machine emits `locked`, `advanced`, `parked`, `typo`, `ignored` and `blast`,
 * and this file is the promise that all six are visible. Two of them are the
 * ones that get dropped and must not be:
 *
 *   `parked`  (AC-2.2, D25) a fully typed word waiting on a longer rival. It
 *             carries `firesAtMs`, so the charge animation ENDS when the word
 *             fires instead of guessing. An invisible park is a correctly typed
 *             word sitting silently until it hits the ship.
 *   `ignored` (AC-3.3, collision C10) a keystroke belonging to a different
 *             rock. It shakes - AC-6e.2 wants feedback for every keystroke -
 *             and it must not touch the combo, the typo count or the word
 *             record, or brushing a key costs a child their multiplier for
 *             something they did not do wrong.
 */

/** D29: "the ship sputters, dims, and sinks ... over several seconds". */
const STALL_SINK_MS = 2400;

/**
 * WORD PLATES DRAW ABOVE EVERY ROCK (AC-22.8, and the reason the game exists).
 *
 * Rocks all live in one container and are added in spawn order, so a rock that
 * arrives later draws over an earlier rock's plate. That is not a cosmetic
 * overlap: the word is the thing the child is trying to read, and a covered
 * word is a rock they cannot shoot. The player reported exactly this.
 *
 * The fix is depth, which is the only fix that is total - reordering by
 * overlap, or fading whichever rock is on top, both leave cases where two
 * plates cover each other. Plates are therefore parented to their OWN
 * container, half a step above `debris` (4) and still below `nearField` (5) so
 * nothing about the parallax stack changes. Every plate is above every rock,
 * always, by construction rather than by arrangement.
 *
 * A second thing falls out of it and it is a fix in its own right: a plate is
 * no longer a child of a rock that SPINS (`spinPerSec`), so the word hangs
 * level under its rock instead of tumbling with it. Art-direction section 4
 * always said the plate hangs below the rock; it now actually does.
 */
const PLATE_DEPTH = layer("debris").depth + 0.5;

/**
 * Half the Lantern's drawn width, px (`drawLantern`: the tail fins reach 46).
 * Used to work out which spawn columns would drop a rock onto the ship.
 */
const SHIP_HALF_WIDTH_PX = 46;

/**
 * Keep-out at each edge of the playfield.
 *
 * The near plane carries near-black framing masses down both edges
 * (render/parallax.ts, canyonWalls) which reach about 8.5% of the stage. A rock
 * spawns clear of them: a foreground that covers a word costs a child a rock,
 * which is the same defect as one rock covering another rock's plate.
 */
const SPAWN_MARGIN_PX = 320;

/**
 * What the world slows to for the warp break (D30). Not zero: "a calm break" is
 * a change of pace, and rubric item 2 wants an idle frame to still be alive.
 */
const CALM_WORLD_SPEED_FRACTION = 0.22;

interface LiveRock {
  readonly id: string;
  readonly word: string;
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly plate: WordPlate;
  readonly sizePx: number;
  readonly debris: DebrisType;
  readonly isCanister: boolean;
  /**
   * D21/D23: this word is COMING BACK - a retention probe, or one the player
   * missed - so the game chose to show it again. `@engine/selection` decides;
   * this scene only reads it, to pick a column that is not the ship's and to
   * let the rock sail past instead of into the hull. See `spawnRock`.
   */
  readonly isPractice: boolean;
  /** Plate centre below the rock centre, px (`render/wordPlate.plateOffsetY`). */
  readonly plateOffsetY: number;
  readonly spawnedAtMs: number;
  readonly fallMs: number;
  /**
   * What `@engine/pacing` expected this rock to cost THIS player, at spawn.
   * Held on the rock rather than recomputed because the belt is paced off it
   * and then corrected by it: the residual it leaves behind is how the stage
   * learns that the child is slower than their calibration said.
   */
  readonly clearEstimateMs: number;
  readonly fromY: number;
  readonly toY: number;
  readonly homeX: number;
  readonly driftPhase: number;
  readonly spinPerSec: number;
  resolved: boolean;
}

/** Read-only surface the e2e measures through (evidence, never gameplay). */
export interface FlightDebugState {
  readonly hull: number;
  readonly score: number;
  readonly combo: number;
  readonly multiplier: number;
  readonly typos: number;
  readonly hits: number;
  readonly wpm: number;
  readonly accuracy: number;
  readonly typed: string;
  readonly lockedId: string | null;
  readonly parkedId: string | null;
  readonly stalled: boolean;
  readonly stageComplete: boolean;
  /** Hull marks this stage has (`@engine/hull.hullForStage`). */
  readonly maxHull: number;
  /**
   * Hull marks TAKEN this stage. Not `maxHull - hull`: a shield canister gives
   * a mark back, so the remaining hull forgets hits that were really taken.
   */
  readonly hullHits: number;
  /** What the belt currently believes about this player's hands (D51). */
  readonly calibration: Calibration;
  readonly maxLive: number;
  readonly knobChanges: number;
  /** The gap the belt is currently holding between rocks, ms (@engine/pacing). */
  readonly spawnGapMs: number;
  readonly rocks: readonly {
    readonly id: string;
    readonly word: string;
    readonly sizePx: number;
    readonly x: number;
    readonly y: number;
    readonly plateY: number;
    readonly plateTop: number;
    /** The plate's rectangle in world space - what AC-22.8 must keep legible. */
    readonly plateLeft: number;
    readonly plateRight: number;
    readonly plateBottom: number;
    /** Phaser depth of the plate layer; must exceed `rockDepth` for every rock. */
    readonly plateDepth: number;
    readonly rockBottom: number;
    readonly rockDepth: number;
    readonly typedCount: number;
    readonly isCanister: boolean;
    /** D21/D23: this word came back, so it is not aimed at the ship. */
    readonly isPractice: boolean;
    /** True if this rock's column would bring it down onto the Lantern. */
    readonly onShipLane: boolean;
    readonly debrisType: string;
  }[];
  readonly layerOffsets: Readonly<Record<string, number>>;
  readonly skySample: { readonly x: number; readonly y: number };
  readonly bookExposures: number;
  /** D09: the words actually shot down, in blast order. */
  readonly blasted: readonly string[];
  /** Words that crossed the breach line and were never blasted. */
  readonly missed: readonly string[];
}

export class FlightScene extends Phaser.Scene {
  private cfg: FlightConfig = flightConfigFrom();
  private palette!: Palette;
  private copy!: FlightCopy;
  private rng: () => number = mulberry32(1);

  private lock: LockState = createLockState();
  private selection!: SelectionState;
  private controller!: ControllerState;
  private combo: ComboState = INITIAL_COMBO_STATE;
  /**
   * The longest unbroken chain this stage reached (AC-6c.1's combo, at its
   * peak). `combo` itself is the LIVE chain and is reset by a typo or a hull
   * hit, so by stage end it says nothing about what the player achieved - which
   * is why Chain 25 and Chain 50 (D80, AC-6d.1c) could never have been awarded
   * from it. Recorded here because nothing persists a chain.
   */
  private bestCombo = 0;
  private book: WordBook = {};
  /**
   * D09. What the player ACTUALLY shot down this stage, in order, and what got
   * past them. This is the value the warp break is built from; the word book is
   * not a substitute, because it accumulates across stages and across runs and
   * therefore cannot answer "what did they blast just now".
   */
  private history: BlastHistory = emptyHistory();

  private rocks: LiveRock[] = [];
  private hull = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);
  /**
   * Hull marks THIS stage has, from `@engine/hull.hullForStage`.
   *
   * It is a field rather than the module constant it used to be because D27's
   * three marks and D17's 80-90% band only agree at 18 words, and this stage is
   * 58 (see `@engine/hull`'s header for the arithmetic). Every place that used
   * to read `MAX_HULL` reads this, including the two `hullHits` figures the
   * results screen turns into stars - if one of them kept the constant, a
   * nine-mark stage would report six hits it never took.
   */
  private maxHull = hullForStage(DEFAULT_FLIGHT_CONFIG.stageWordCount);
  /**
   * HULL MARKS THIS STAGE HAS TAKEN. Counted, not inferred.
   *
   * `maxHull - hull` is NOT this number, and the difference is the whole of a
   * defect that made the star rating meaningless. A shield canister GIVES A
   * MARK BACK (AC-5.1/5.2, D26), so a Mars run whose hull reached zero twice
   * and collected twenty canisters finished with a full hull and was awarded
   * three stars out of three at 63% accuracy - and `beltRunner`, whose shipped
   * copy is "cross the main belt without a scratch".
   *
   * Stars are about what the stage cost (AC-4.4: 0 hits -> 3, 1 -> 2, 2 -> 1),
   * and the canister is a second chance at surviving, never an eraser. So the
   * hits are counted where they happen and the final hull is left to mean the
   * one thing it should: whether the ship is still flying.
   */
  private hullHitsTaken = 0;
  /**
   * Every inter-key interval this stage has produced, in order (D51).
   *
   * Collected off the lock machine's own `advanced` emissions rather than off
   * blasts, so a word that reached the breach line still contributes what the
   * child managed to type. See `learnFromPlay` for why that distinction is the
   * whole fix and not a detail.
   */
  private liveIkiMs: number[] = [];
  /**
   * First-key latencies this stage has produced. Fed from blasts, because that
   * is the only emission that carries one, and unlike the intervals it is not
   * urgent: fall time does not read it at all (`@engine/fallTime` is length x
   * iki plus the ease term), so it moves the pacing estimate and nothing the
   * child can see fall.
   */
  private liveFkMs: number[] = [];

  /**
   * What the GAME believes about this child's hands, right now (D51, FR-8).
   *
   * Separate from `cfg.calibration`, which is the baseline this stage opened
   * with, because this one MOVES. `@engine/calibration.refineCalibration` folds
   * the intervals the lock machine is measuring back into the baseline as the
   * belt runs, so a child the game has never measured - every child, before
   * this round: see `scenes/lib/init.ts` - stops being flown as the median
   * typist within the first handful of words instead of never.
   */
  private calibration: Calibration = DEFAULT_CALIBRATION;
  private score = 0;
  private hits = 0;
  private typos = 0;
  private correctChars = 0;
  private spawnedCount = 0;
  private nextSpawnAtMs = 0;
  private lastSpawnGapMs = 0;
  /**
   * When the last rock left the board, by blast or by breach. A player is one
   * server: this is the instant they became free for the next word, and both
   * the pacing's "work already spent" and its clear samples are measured from
   * it (@engine/pacing).
   */
  private lastResolveAtMs = 0;
  /**
   * Per-rock `actual service - estimate`, in blast order. `@engine/pacing`
   * reads the recent tail of this and stretches the belt by it, which is what
   * makes the gap follow the player rather than their calibration.
   */
  private clearResiduals: number[] = [];
  private canisterId: string | null = null;
  private stageStartMs = 0;
  private stalled = false;
  private stageComplete = false;
  private knobChanges = 0;
  private nextRockIndex = 0;
  private lastHudAtMs = 0;
  private skyPaintedAt = -1;
  private stallStartedAtMs: number | null = null;
  /**
   * Words this stage pulled from the RETENTION pool (AC-9.3, D21). Recorded at
   * spawn because `pickNext` is the only place that knows, and read at stage end
   * because AC-20.3's retention line is a claim about which words those were.
   */
  private retentionWords = new Set<string>();

  private parked: {
    readonly id: string;
    readonly firesAtMs: number;
    readonly startedAtMs: number;
  } | null = null;

  private readonly layerOffsets: Record<LayerId, number> = {
    sky: 0,
    celestial: 0,
    farField: 0,
    midField: 0,
    debris: 0,
    nearField: 0,
    shipFx: 0,
    // L6.5: the only world layer in front of the ship (render/layers.ts).
    foreVeil: 0,
    hud: 0,
  };

  /**
   * The world, built by the SHARED stack (`render/parallax.ts`) rather than by
   * this file.
   *
   * It used to be four hand-rolled TileSprites here, and that is why the flight
   * screen read as flat brown bands while eight other screens did not: the
   * depth work - atmospheric lift, the value range, the light's position, the
   * framing foreground, the weather pass (design-reference/refs/WORLD-BAR.md) -
   * all lives in the builder, and the one screen the player spends the most
   * time on was the one screen not using it. There is one world in this game now.
   */
  private parallax!: Parallax;
  /** The D30 calm-down, held so the warp jump can stop it. */
  private calmTween: Phaser.Tweens.Tween | null = null;
  private debrisLayer!: Phaser.GameObjects.Container;
  /** Every word plate in the game, above every rock. See `PLATE_DEPTH`. */
  private plateLayer!: Phaser.GameObjects.Container;
  private shipLayer!: Phaser.GameObjects.Container;
  private shipBody!: Phaser.GameObjects.Container;
  private emitterHead!: Phaser.GameObjects.Container;
  private iris!: Phaser.GameObjects.Graphics;
  private beam!: Phaser.GameObjects.Graphics;
  private exhaust!: Phaser.GameObjects.Graphics;
  private scorchLayer!: Phaser.GameObjects.Container;
  private shards!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private motes!: Phaser.GameObjects.Particles.ParticleEmitter;

  private shakeX = 0;
  private shakeY = 0;
  private breachY = 0;
  /** The Lantern's column. AC-1.1 freezes it for the stage. */
  private shipX = 0;
  private plateStyle!: WordPlateStyle;

  constructor() {
    super(SCENE_KEYS.flight);
  }

  init(data: Partial<FlightConfig>): void {
    this.cfg = flightConfigFrom(data);
    this.rocks = [];
    this.maxHull = hullForStage(this.cfg.stageWordCount);
    this.hull = startingHull(this.cfg.stageWordCount);
    this.hullHitsTaken = 0;
    this.calibration = this.cfg.calibration;
    this.liveIkiMs = [];
    this.liveFkMs = [];
    this.score = 0;
    this.hits = 0;
    this.typos = 0;
    this.correctChars = 0;
    this.spawnedCount = 0;
    this.nextSpawnAtMs = 0;
    this.lastSpawnGapMs = 0;
    this.lastResolveAtMs = 0;
    this.clearResiduals = [];
    this.canisterId = null;
    this.stalled = false;
    this.stallStartedAtMs = null;
    this.stageComplete = false;
    this.calmTween = null;
    this.knobChanges = 0;
    this.nextRockIndex = 0;
    this.parked = null;
    this.retentionWords = new Set<string>();
    this.combo = INITIAL_COMBO_STATE;
    this.bestCombo = 0;
    // A restart is a fresh attempt at the stage (AC-4.3), so the run record
    // starts empty even though the word book is carried over.
    this.history = emptyHistory();
    this.skyPaintedAt = -1;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.palette = paletteFor(this.cfg.stopId, this.cfg.colorblindPalette);
    this.copy = createFlightCopy(this.cfg.uiLang, { shipName: this.cfg.shipName });
    this.rng = mulberry32(this.cfg.seed);
    this.book = { ...this.cfg.book };
    // The baseline the PROFILE holds beats the one the payload carried. Every
    // screen between Pre-flight and here forwards `calibration` by hand, and a
    // screen that forgets to (or that was mounted standalone) hands the belt
    // FR-8's 350 ms default for a child who may type at twice that. The store
    // is the copy that cannot go stale - the same argument `storedProgress`
    // makes about the route.
    this.calibration = storedCalibration(this) ?? this.cfg.calibration;

    this.plateStyle = {
      plate: this.palette.plate,
      plateText: this.palette.plateText,
      accent: this.palette.accent,
      fontFamily: "'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif",
      fontSizePx: 30,
      letterSpacingPx: this.cfg.increasedLetterSpacing ? 5 : 1,
      uppercase: this.cfg.uppercase,
      reducedMotion: this.cfg.reducedMotion,
    };

    this.registerCompanionScenes();
    this.buildEngineState();
    this.buildWorld(width, height);
    this.buildShip(width, height);
    this.buildParticles();
    this.bindInput();

    this.stageStartMs = this.time.now;
    this.nextSpawnAtMs = this.stageStartMs;
    this.lastResolveAtMs = this.stageStartMs;

    this.scene.launch(SCENE_KEYS.hud, { snapshot: this.snapshot() });
    this.game.events.on(FLIGHT_EVENTS.restart, this.onRestartRequested, this);
    // D30: the warp break rides on top of this scene and accelerates THIS
    // world. See `checkStageEnd`.
    this.game.events.on(FLIGHT_EVENTS.warpSpeed, this.onWarpSpeed, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(FLIGHT_EVENTS.restart, this.onRestartRequested, this);
      this.game.events.off(FLIGHT_EVENTS.warpSpeed, this.onWarpSpeed, this);
      if (this.cfg.debug) delete window.__kbFlight;
    });

    if (this.cfg.debug) window.__kbFlight = this.debugApi();
    // D75: a new stage starts the pitched keystroke layer at the root of the
    // scale. Carrying a warp's worth of climb into the next belt would open it
    // two octaves up for no reason the player did anything to earn.
    audioFrom(this.registry)?.resetTone();
    this.publishHud(true);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private registerCompanionScenes(): void {
    if (this.scene.get(SCENE_KEYS.hud) === null) {
      this.scene.add(SCENE_KEYS.hud, HudScene, false);
    }
    if (this.scene.get(SCENE_KEYS.stall) === null) {
      this.scene.add(SCENE_KEYS.stall, StallScene, false);
    }
  }

  private buildEngineState(): void {
    const stop = this.cfg.stopId;
    const pool = stagePoolFor(stop);
    const earlier = STOP_IDS.slice(1, Math.max(1, STOP_IDS.indexOf(stop)));
    const retention = retentionPoolFor(earlier as StopId[]);
    const allowlist = createAllowlist({
      lang: this.cfg.contentLang,
      words: [...pool, ...retention],
    });

    this.book = bookOf({ [this.cfg.contentLang]: this.book }, this.cfg.contentLang);
    this.selection = createSelectionState({
      stage: this.cfg.stage,
      stagePool: pool,
      retentionPool: retention,
      book: this.book,
      allowlist,
    });
    this.controller = createController({ knobs: this.cfg.knobs });

    // D46: what "matches" means is i18n's job, not the lock's, so the matcher
    // built from the profile's input method is injected here. A romanized Hindi
    // speller must be able to type "paani" OR "pani"; `canonicalRomanization`
    // is display-only and is deliberately NOT used to pre-flatten the word on
    // the asteroid, because a lock that accepts one canonical spelling tells a
    // child they are wrong when the table is (D31).
    //
    // OPEN SEAM, flagged to the lead: `@engine/i18n` exports the port, but
    // `LockOptions` does not carry it yet, so `createLockState` ignores this
    // field today and Devanagari content will match exactly rather than by
    // variant set. The cast is the marker: when lock/ adds
    // `matcher?: WordMatcher` the cast comes off and nothing else here moves.
    const options = {
      layout: this.cfg.keyboardLayout,
      parkGraceMs: 1.5 * this.calibration.ikiMs,
      matcher: createWordMatcher(this.cfg.inputMethod),
    } as LockOptions;
    this.lock = createLockState(options);
  }

  private buildWorld(width: number, height: number): void {
    // ONE world builder for the whole game (render/parallax.ts). Everything
    // this method used to do by hand - the sky gradient, the planet, three
    // silhouette bands - is in there, alongside the seven depth cues this
    // screen was missing. `debris` is deliberately NOT decorated: layer 4 is
    // where the player's rocks fall, and a silhouette rock drifting at exactly
    // the speed of a typeable one is a lie about what can be shot.
    this.parallax = buildParallax(this, {
      palette: stopPaletteAt(this.cfg.stopId, this.cfg.colorblindPalette),
      reducedMotion: this.cfg.reducedMotion,
      width,
      height,
      worldSpeed: this.cfg.worldSpeedPxPerSec,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: this.cfg.seed,
    });

    this.debrisLayer = this.add.container(0, 0).setDepth(layer("debris").depth);
    this.plateLayer = this.add.container(0, 0).setDepth(PLATE_DEPTH);
    this.shipLayer = this.add.container(0, 0).setDepth(layer("shipFx").depth);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.parallax.destroy());
  }

  private buildShip(width: number, height: number): void {
    const shipX = width / 2;
    const shipY = height - 150;
    this.shipX = shipX;
    this.breachY = shipY - 74;

    this.shipBody = this.add.container(0, 0);
    const hullG = this.add.graphics();
    this.drawLantern(hullG);
    this.shipBody.add(hullG);

    this.exhaust = this.add.graphics();
    this.drawExhaust(this.exhaust, 1);
    this.shipBody.add(this.exhaust);

    this.scorchLayer = this.add.container(0, 0);
    this.shipBody.add(this.scorchLayer);

    this.emitterHead = this.add.container(0, -74);
    const head = this.add.graphics();
    this.drawEmitter(head);
    this.iris = this.add.graphics();
    this.drawIris(this.iris, 0);
    this.emitterHead.add([head, this.iris]);
    this.shipBody.add(this.emitterHead);

    this.beam = this.add.graphics();

    const root = this.add.container(shipX, shipY, [this.shipBody]);
    this.shipLayer.add([this.beam, root]);

    // AC-1.1: the ship's own x/y never change during a stage. The 2 px idle bob
    // (art-direction section 5) rides on the inner container instead, so the
    // entity position invariant and the art both hold.
    if (!this.cfg.reducedMotion) {
      this.tweens.add({
        targets: this.shipBody,
        y: { from: 0, to: -3 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }
  }

  /** The Lantern (D89, art-direction section 5): rocket, not a gun. */
  private drawLantern(g: Phaser.GameObjects.Graphics): void {
    const cream = hexToInt("#F3E7D3");
    const shade = hexToInt("#C9B79C");
    const coral = hexToInt("#FF6B4A");
    const dark = hexToInt("#2A2F3A");

    // three swept tail fins
    g.fillStyle(shade, 1);
    g.fillPoints(
      [
        { x: -22, y: 18 },
        { x: -46, y: 58 },
        { x: -16, y: 48 },
      ],
      true,
      true,
    );
    g.fillPoints(
      [
        { x: 22, y: 18 },
        { x: 46, y: 58 },
        { x: 16, y: 48 },
      ],
      true,
      true,
    );
    g.fillPoints(
      [
        { x: -8, y: 34 },
        { x: 0, y: 66 },
        { x: 8, y: 34 },
      ],
      true,
      true,
    );

    // rounded fuselage with a pointed nosecone
    g.fillStyle(cream, 1);
    g.fillPoints(
      [
        { x: 0, y: -70 },
        { x: 16, y: -34 },
        { x: 21, y: 16 },
        { x: 14, y: 50 },
        { x: -14, y: 50 },
        { x: -21, y: 16 },
        { x: -16, y: -34 },
      ],
      true,
      true,
    );

    // coral stripe band
    g.fillStyle(coral, 1);
    g.fillRect(-19, -6, 38, 12);

    // porthole
    g.fillStyle(dark, 1);
    g.fillCircle(0, -24, 10);
    g.fillStyle(hexToInt("#9FD8F0"), 0.85);
    g.fillCircle(-2, -26, 6);

    // engine nozzle
    g.fillStyle(shade, 1);
    g.fillPoints(
      [
        { x: -14, y: 50 },
        { x: 14, y: 50 },
        { x: 10, y: 64 },
        { x: -10, y: 64 },
      ],
      true,
      true,
    );
  }

  /**
   * The beam emitter (D89, AC-24.1): large lens, iris aperture, three
   * concentric focusing rings, finned heat housing, pivot mount. Drawn at the
   * nose and rotated to track the locked rock - the beam has exactly one source.
   */
  private drawEmitter(g: Phaser.GameObjects.Graphics): void {
    const housing = hexToInt("#9AA3B2");
    const deep = hexToInt("#2A2F3A");
    const lens = hexToInt(this.palette.accent);

    // pivot mount
    g.fillStyle(deep, 1);
    g.fillRoundedRect(-9, 4, 18, 12, 4);

    // finned heat housing
    g.fillStyle(housing, 1);
    g.fillRoundedRect(-14, -6, 28, 14, 5);
    g.lineStyle(2, deep, 0.7);
    for (let i = -9; i <= 9; i += 6) g.lineBetween(i, -5, i, 7);

    // three concentric focusing rings
    g.lineStyle(2, housing, 0.95);
    g.strokeCircle(0, -10, 13);
    g.lineStyle(2, housing, 0.7);
    g.strokeCircle(0, -10, 9.5);
    g.lineStyle(2, housing, 0.5);
    g.strokeCircle(0, -10, 6);

    // large lens
    g.fillStyle(lens, 0.9);
    g.fillCircle(0, -10, 5);
  }

  private drawIris(g: Phaser.GameObjects.Graphics, openness: number): void {
    g.clear();
    const open = Math.max(0, Math.min(1, openness));
    g.lineStyle(2.5, hexToInt(this.palette.accent), 0.35 + 0.65 * open);
    g.strokeCircle(0, -10, 5 + open * 4);
  }

  private drawExhaust(g: Phaser.GameObjects.Graphics, strength: number): void {
    g.clear();
    const accent = hexToInt(this.palette.accent);
    for (let i = 3; i >= 1; i -= 1) {
      g.fillStyle(accent, 0.1 * i * strength);
      g.fillEllipse(0, 70 + i * 5, 20 - i * 3, 22 + i * 8);
    }
  }

  private buildParticles(): void {
    const shardSpec = particleSpec("blastShards");
    const sparkSpec = particleSpec("strikeSpark");
    const moteSpec = particleSpec("dustMotes");

    // WHITE, and tinted at the moment it is emitted. `blastShards` is spec'd
    // `colorSource: "debris"` - "the rock's own colour, so the player sees WHICH
    // rock died" - and a texture baked in one stop-wide colour cannot do that: a
    // C-type and an M-type broke into identical chunks. One white texture plus
    // `setParticleTint` per blast is the same draw call and keeps the promise.
    const shardKey = ensureShardTexture(this, "kb-shard-white", "#FFFFFF");
    const sparkKey = ensureMoteTexture(this, `kb-spark-${this.cfg.stopId}`, this.palette.accent);
    const moteKey = ensureMoteTexture(
      this,
      `kb-mote-${this.cfg.stopId}`,
      this.palette.colors[4] ?? this.palette.accent,
    );

    this.shards = this.add
      .particles(0, 0, shardKey, {
        lifespan: { min: shardSpec.lifespanMs[0], max: shardSpec.lifespanMs[1] },
        speed: { min: shardSpec.speed[0], max: shardSpec.speed[1] },
        angle: { min: shardSpec.angle[0], max: shardSpec.angle[1] },
        gravityY: shardSpec.gravityY,
        scale: { start: shardSpec.scale[0], end: shardSpec.scale[1], ease: shardSpec.ease },
        // Spin, and at a rate that differs per shard: a field of chunks all
        // tumbling at one speed reads as a sprite sheet, not as rubble.
        rotate: { start: 0, end: 360 },
        alpha: { start: 1, end: 0.35, ease: shardSpec.ease },
        emitting: false,
      })
      .setDepth(layer("shipFx").depth);

    this.sparks = this.add
      .particles(0, 0, sparkKey, {
        lifespan: { min: sparkSpec.lifespanMs[0], max: sparkSpec.lifespanMs[1] },
        speed: { min: sparkSpec.speed[0], max: sparkSpec.speed[1] },
        angle: { min: sparkSpec.angle[0], max: sparkSpec.angle[1] },
        gravityY: sparkSpec.gravityY,
        scale: { start: sparkSpec.scale[0], end: sparkSpec.scale[1], ease: sparkSpec.ease },
        emitting: false,
      })
      .setDepth(layer("shipFx").depth);

    this.motes = this.add
      .particles(0, 0, moteKey, {
        x: { min: 0, max: this.scale.width },
        y: -20,
        lifespan: { min: moteSpec.lifespanMs[0], max: moteSpec.lifespanMs[1] },
        speedY: { min: moteSpec.speed[0] * 6, max: moteSpec.speed[1] * 6 },
        speedX: { min: -6, max: 6 },
        scale: { start: moteSpec.scale[0], end: moteSpec.scale[1], ease: moteSpec.ease },
        alpha: { start: 0.55, end: 0, ease: moteSpec.ease },
        frequency: 260,
        quantity: 1,
      })
      .setDepth(layer("nearField").depth);
  }

  /**
   * AC-6e.1: keystrokes are handled straight off the DOM event rather than
   * through Phaser's keyboard queue.
   *
   * The queue is drained in the scene's PRE_UPDATE, which means a keystroke
   * that arrives just after a frame begins waits a whole frame before the lock
   * even sees it, and the plate then lights a frame after that. Reducing at
   * event time makes the visual state true the instant the key lands, so the
   * very next frame carries it - which is what "input-to-visual latency within
   * one frame" has to mean.
   */
  private bindInput(): void {
    window.addEventListener("keydown", this.onKeyDown, true);
    // D46: an IME delivers a committed composition as one event, and auto-lock
    // must still work, so it goes to the lock as a `composition` event.
    window.addEventListener("compositionend", this.onComposition, true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", this.onKeyDown, true);
      window.removeEventListener("compositionend", this.onComposition, true);
    });
  }

  private readonly onComposition = (event: CompositionEvent): void => {
    if (!this.scene.isActive()) return;
    if (this.stalled || this.stageComplete) return;
    if (event.data.length === 0) return;
    // performance.now() rather than this.time.now: Phaser's clock is the last
    // frame's timestamp, and stamping a keystroke with it would fold the wait
    // for the next frame into the inter-key intervals the calibration medians
    // are built from. Both clocks are the same origin, so they interleave.
    this.applyLock({ type: "composition", text: event.data, nowMs: performance.now() });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // These listeners are on `window`, not on Phaser's per-scene keyboard
    // plugin, so `scene.pause()` does NOT stop them: without this guard the
    // belt would keep eating keystrokes behind the pause overlay, and every
    // arrow key the player used to choose "resume" would also be fed to the
    // lock. Pausing the scene has to pause its input too.
    if (!this.scene.isActive()) return;

    // Esc during flight (design brief 13). Deliberately before the stalled /
    // complete guard is NOT what happens: a stalled ship has its own card and a
    // finished stage is on its way to the warp break, so pausing either would
    // be pausing something that is no longer a belt.
    if (event.key === "Escape" && !this.stalled && !this.stageComplete) {
      event.preventDefault();
      PauseScene.openFrom(this);
      return;
    }

    if (this.stalled || this.stageComplete) return;
    if (event.key === "Tab") return; // AC-18.1: focus must stay reachable.
    if (event.key === " " || event.key.startsWith("Arrow")) event.preventDefault();
    this.applyLock({
      type: "key",
      nowMs: performance.now(),
      input: {
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
      },
    });
  };

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  override update(time: number, delta: number): void {
    const dt = delta / 1000;
    const elapsed = time - this.stageStartMs;

    this.advanceLayers(dt, elapsed);
    this.updateCamera(elapsed);

    if (this.stalled) this.maybeShowStallCard();

    if (!this.stalled && !this.stageComplete) {
      this.updateRocks(time);
      this.applyLock({ type: "tick", nowMs: time });
      this.updatePark(time);
      this.trySpawn(time);
      this.aimEmitter();
      this.checkStageEnd();
    }

    if (time - this.lastHudAtMs > 100) this.publishHud(false);
  }

  private advanceLayers(dt: number, elapsedMs: number): void {
    // The MEASUREMENT of the parallax, kept here and kept monotonic. The stack
    // itself wraps its containers modulo the stage height, which is right on
    // screen and useless as evidence - a wrapped offset goes backwards once a
    // tile, so V-22.1b ("five layers observed moving at distinct rates") would
    // read a negative delta whenever a sample straddled a wrap. This total
    // never wraps, so the rate it reports is the rate the layer ran at.
    const world = this.cfg.worldSpeedPxPerSec;
    for (const spec of LAYERS) {
      this.layerOffsets[spec.id] += spec.speed * world * dt;
    }

    this.parallax.update(dt * 1000);

    // AC-22.3: the sky travels from its opening stops to its closing ones over
    // the stage. Repainting is now a crossfade between two pre-drawn gradients
    // rather than a canvas redraw, so the guard is about not touching the alpha
    // 60 times a second for no visible change, not about redraw cost.
    const progress = Math.min(1, elapsedMs / this.cfg.stageDurationMs);
    if (Math.abs(progress - this.skyPaintedAt) > 0.002) {
      this.parallax.setSkyProgress(progress);
      this.skyPaintedAt = progress;
    }
  }

  private updateCamera(elapsedMs: number): void {
    const sway = cameraSwayPx(elapsedMs, this.cfg.reducedMotion);
    this.cameras.main.setScroll(sway + this.shakeX, sway * 0.5 + this.shakeY);
  }

  private updateRocks(now: number): void {
    for (const rock of [...this.rocks]) {
      if (rock.resolved) continue;
      const t = (now - rock.spawnedAtMs) / rock.fallMs;
      rock.container.y = rock.fromY + (rock.toY - rock.fromY) * t;
      rock.container.x =
        rock.homeX + Math.sin(now / 1400 + rock.driftPhase) * 10;
      rock.container.rotation += rock.spinPerSec * (1 / 60);
      // The plate is not a child of the rock (see PLATE_DEPTH), so it is
      // carried here. Deliberately not rotated: the rock tumbles, the word does
      // not, which is what art-direction section 4 asked for all along.
      rock.plate.setPosition(rock.container.x, rock.container.y + rock.plateOffsetY);
      if (t >= 1) this.resolveAtBreachLine(rock, now);
    }
  }

  private updatePark(now: number): void {
    if (this.parked === null) return;
    const rock = this.rocks.find((r) => r.id === this.parked?.id);
    if (rock === undefined) {
      this.parked = null;
      return;
    }
    const span = this.parked.firesAtMs - this.parked.startedAtMs;
    const progress = span <= 0 ? 1 : (now - this.parked.startedAtMs) / span;
    rock.plate.setChargeProgress(progress);
  }

  private trySpawn(now: number): void {
    if (this.spawnedCount >= this.cfg.stageWordCount) return;
    if (this.rocks.length >= this.controller.knobs.maxLive) return;
    // AC-6e.3: an empty board never waits. A gap with nothing falling and
    // nothing pending is dead time, and dead time is what makes a child leave.
    if (this.rocks.length > 0 && now < this.nextSpawnAtMs) return;

    const outcome = pickNext(this.selection, {
      live: this.rocks.map((r) => r.word),
      book: this.book,
      rng: this.rng,
    });
    if (!outcome.ok) {
      // "no-legal-word" means "do not spawn on this tick", never "stuck": it
      // implies the board is non-empty, so something is already falling.
      this.nextSpawnAtMs = now + 200;
      return;
    }
    this.selection = outcome.state;
    if (outcome.source === "retention") this.retentionWords.add(outcome.word);
    // D21/D23: `practice` means the ENGINE chose to show this word again. The
    // scene does not re-derive that from the book; `@engine/selection` is the
    // only thing that knows why a word is on the belt.
    this.spawnRock(outcome.word, now, outcome.practice);
    this.lastSpawnGapMs = this.spawnGapAfter(now);
    this.nextSpawnAtMs = now + this.lastSpawnGapMs;
  }

  /**
   * How long to wait before the next rock (@engine/pacing).
   *
   * THIS USED TO BE 850 MS AND THAT IS THE BUG. A player is one server - AC-2.1
   * gives every live word a distinct first letter so the lock is unambiguous -
   * so rocks leave the board one word at a time, at whatever rate this child
   * types. A constant feed of 850 ms is about two and a half times that rate,
   * `maxLive` caps what is LIVE rather than what is fed, and a rock nobody is
   * typing is still falling. The surplus landed, three landings empty the hull
   * (D27), and the stage stalled.
   *
   * Everything the replacement needs is already in this scene: what the board
   * holds, how long the player has been on the rock in hand, what the last few
   * rocks actually cost them, and the controller's knobs. The rule that turns
   * those into a duration lives in the engine, like every other rule here.
   */
  private spawnGapAfter(now: number): number {
    const newest = this.rocks[this.rocks.length - 1];
    return spawnGapMs({
      liveClearMs: this.rocks.map((r) => r.clearEstimateMs),
      servedMs: now - this.serviceStartedAtMs(now),
      fallMs: newest?.fallMs ?? 0,
      biasMs: observedBiasMs(this.clearResiduals),
      knobs: this.controller.knobs,
      hitRate: hitRate(this.controller),
    });
  }

  /**
   * When the player started on the word they are answering now: the moment the
   * board last freed up, or the moment that rock arrived, whichever is later.
   *
   * The rock in hand is the locked one when there is a lock, and otherwise the
   * oldest live rock - the one nearest the breach line, which is the one a
   * player answers next and the one the e2e's simulated child answers next.
   */
  private serviceStartedAtMs(now: number): number {
    const locked =
      this.lock.lockedId === null ? undefined : this.rockById(this.lock.lockedId);
    const target = locked ?? this.rocks[0];
    if (target === undefined) return now;
    return Math.max(this.lastResolveAtMs, target.spawnedAtMs);
  }

  /**
   * The geometry `@engine/spawn` needs to keep a practice rock out of the
   * ship's path. A rock's own half-width is used rather than its plate's,
   * because the plate is narrower than the rock at every length
   * (`render/wordPlate.plateSize` vs `asteroid.asteroidSizePx`) - so clearing
   * the rock clears the word too.
   */
  private laneSpec(sizePx: number): LaneSpec {
    return {
      width: this.scale.width,
      marginPx: SPAWN_MARGIN_PX,
      shipX: this.shipX,
      shipHalfWidthPx: SHIP_HALF_WIDTH_PX,
      rockHalfWidthPx: sizePx / 2,
    };
  }

  /**
   * Put one rock on the belt.
   *
   * `practice` is `@engine/selection`'s `Picked.practice` - this word is COMING
   * BACK, because the player missed it (D23) or because it is a retention probe
   * (D21). See `lanePlacement` for what that changes and, just as importantly,
   * for what it does not.
   */
  private spawnRock(word: string, now: number, practice = false): void {
    const width = this.scale.width;
    const letters = [...word].length;
    const sizePx = asteroidSizePx(letters);
    const types = wordDebrisTypesFor(this.cfg.stopId);
    const debris = types[this.nextRockIndex % Math.max(1, types.length)] as DebrisType;
    const isCanister =
      this.canisterId === null &&
      maySpawnCanister(this.hull, this.maxHull, this.canisterId !== null) &&
      this.rng() < 0.5;

    const id = `rock-${this.nextRockIndex}`;
    this.nextRockIndex += 1;

    const body = this.add.graphics();
    if (isCanister) {
      drawShieldCanister(body, {
        type: debris,
        variantIndex: this.nextRockIndex,
        sizePx,
        lightAngle: -Math.PI / 4,
        fillOverride: this.cfg.colorblindPalette ? this.palette.colorblind.debris : null,
        accent: this.palette.accent,
      });
    } else {
      drawDebris(body, {
        type: debris,
        variantIndex: this.nextRockIndex,
        sizePx,
        lightAngle: -Math.PI / 4,
        fillOverride: this.cfg.colorblindPalette ? this.palette.colorblind.debris : null,
      });
    }

    const offsetY = plateOffsetY(sizePx, this.plateStyle);
    const plate = new WordPlate(this, 0, 0, word, this.plateStyle);
    // NOT a child of the rock. See PLATE_DEPTH: every plate draws above every
    // rock, and `updateRocks` carries it to the rock's column each frame.
    this.plateLayer.add(plate);

    const homeX = spawnX(this.laneSpec(sizePx), this.rng, practice);
    const container = this.add.container(homeX, -sizePx, [body]);
    this.debrisLayer.add(container);
    plate.setPosition(homeX, -sizePx + offsetY);

    const record = recordFor(this.book, word);
    const fallMs = fallTimeMs({
      word,
      ease: record.ease,
      calibration: this.fallTimeCalibration(),
    });
    const clearEstimateMs = expectedClearMs({
      length: letters,
      ease: record.ease,
      calibration: this.calibration,
    });

    const rock: LiveRock = {
      id,
      word,
      container,
      body,
      plate,
      sizePx,
      debris,
      isCanister,
      isPractice: practice,
      plateOffsetY: offsetY,
      spawnedAtMs: now,
      fallMs,
      clearEstimateMs,
      fromY: -sizePx,
      toY: this.breachY,
      homeX,
      driftPhase: this.rng() * Math.PI * 2,
      spinPerSec: (this.rng() - 0.5) * 0.3,
      resolved: false,
    };
    this.rocks.push(rock);
    if (isCanister) this.canisterId = id;
    this.spawnedCount += 1;

    // Arrive, never appear: Back.Out is the pop curve (art-direction section 8).
    // The plate pops with its rock even though it is no longer parented to it -
    // one tween over both targets, so they cannot come in out of step.
    container.setScale(0.7);
    plate.setScale(0.7);
    this.tweens.add({
      targets: [container, plate],
      scale: 1,
      duration: 260,
      ease: "Back.Out",
    });

    this.applyLock({
      type: "spawn",
      asteroid: { id, word, spawnedAtMs: now },
    });
  }

  /**
   * One rock's service time, as the amount it ran OVER what the belt expected.
   *
   * Measured from the moment the player was free to answer this rock - it
   * arrived, or the previous one left, whichever was later - so the number is
   * how long they took, never how long they waited. Queueing time belongs to
   * the belt's pacing, and feeding it back in would make every wait justify a
   * longer gap, which would justify a longer wait.
   */
  private recordClear(rock: LiveRock | undefined, nowMs: number): void {
    if (rock !== undefined) {
      const startedAt = Math.max(this.lastResolveAtMs, rock.spawnedAtMs);
      this.clearResiduals.push(nowMs - startedAt - rock.clearEstimateMs);
    }
    this.lastResolveAtMs = nowMs;
  }

  /**
   * Move the game's belief about this child's hands toward what they are
   * actually doing (D51's `refineCalibration`).
   *
   * WHY DURING THE STAGE AND NOT ONLY AFTER IT. The stall that started this was
   * at spawn 18 of 58, on the FIRST belt of the stop. A baseline corrected at
   * stage end is a baseline corrected after the stage the child could not
   * finish, which is no correction at all for the pilot who needs one. The
   * belt's own pacing already learns within the stage (`@engine/pacing`'s
   * observed bias); fall time had no such path, and fall time is the measure
   * that decides whether a word is reachable at all.
   *
   * WHY IT LEARNS FROM KEYSTROKES AND NOT FROM KILLS. This is the part that
   * matters and it is not obvious. The first version folded in the timings a
   * BLAST reported, which is a feedback loop that cannot start: a child who is
   * being flown 70% too fast blasts nothing, so there is no blast to learn
   * from, so they go on being flown 70% too fast. The simulation reports it
   * exactly - 100 stalls in 100 belts with the hit rate at zero and the belief
   * still sitting on 350 ms. Every keystroke is evidence, including the ones on
   * words that reached the breach line, and the child who never destroys a rock
   * is precisely the one who most needs measuring.
   *
   * WHY IT CANNOT SWING. Two things hold it steady. The batch is every interval
   * THIS STAGE has produced and `refineCalibration` takes its MEDIAN, so the
   * target barely moves once there are a few samples and one fumbled word
   * cannot move it at all. The fold then takes a fifth of the remaining gap per
   * call, so the live value walks toward that stable target and never past it.
   * `MIN_IKI_MS`/`MAX_IKI_MS` bound both ends regardless, and a rock already
   * falling keeps the fall time it was given - only the next spawn sees the new
   * belief, so nothing on screen ever changes speed under the player.
   *
   * WHAT IS NOT DONE HERE. Nothing is written to the profile. The stored
   * baseline is folded ONCE, at stage end, at the alpha D51 documents for a
   * stage (`refineStoredCalibration`) - so the persisted number stays the
   * cautious one with a three-stage half-life, and the fast-moving value lives
   * and dies with this belt.
   */
  /**
   * The baseline FALL TIME is allowed to use: the measured one, but never
   * faster than FR-8's shipped default.
   *
   * WHY THIS IS NOT SYMMETRIC, WHICH IS A DELIBERATE DEVIATION FROM FR-8.
   *
   * The formula reads `len * 1.5 * ikiMs + 1200 * ease` and scales both ways,
   * and measuring a quick child does make the belt quicker. Measured on the real
   * scene, that is a regression: the keyboard-only playthrough cleared a whole
   * Mars belt with no stall on the shipped 350 ms, and stalled once when the
   * same run was flown at the 180 ms it was actually typing at. The reason is
   * that `ikiMs` is the gap BETWEEN KEYS INSIDE A WORD, and it is not the
   * player's cost per rock: finding the next word, moving attention to it and
   * committing all sit outside it, and none of them get quicker just because the
   * fingers do. Scaling the whole budget by the fastest component of it squeezes
   * the parts that did not move.
   *
   * So calibration is a LOOSENING knob here and nothing else. It exists because
   * a child who types at 600 ms was being flown as if they typed at 350 and
   * could not clear a single word; it was never asked to make the game harder
   * for anyone, and D31 is explicit that the player should always feel like the
   * best typer in the world. Difficulty for a strong player is FR-10's job and
   * FR-10 has ample tightening authority through `maxLive` and `lengthBias` -
   * see the AC-10.2 escalation, which says in as many words that the knob the
   * controller was missing is a LOOSENING one, and that fall time is it.
   *
   * Everything else still reads the true measurement: `@engine/pacing` estimates
   * what a rock will cost this player, and `slowWords` asks what is slow FOR
   * THEM. Those want the truth; only the deadline is floored.
   */
  private fallTimeCalibration(): Calibration {
    return {
      ...this.calibration,
      ikiMs: Math.max(this.calibration.ikiMs, DEFAULT_CALIBRATION.ikiMs),
    };
  }

  private learnFromPlay(): void {
    this.calibration = refineCalibration(this.calibration, {
      ikiMs: this.liveIkiMs,
      fkLatencyMs: this.liveFkMs,
    });
  }

  /**
   * One inter-key interval, straight off the lock machine.
   *
   * `AdvancedEmit.ikiMs` is already null when the pair is not a clean sample -
   * the first key of a word, or a gap that spans a correction, which is
   * thinking time and not typing speed. That rule belongs to the engine and is
   * not restated here. Nothing about the CHARACTER reaches this function; it is
   * a duration, the same discipline the ritual keeps (AC-11.3).
   */
  private noteInterval(ikiMs: number | null): void {
    if (ikiMs === null || !Number.isFinite(ikiMs) || ikiMs <= 0) return;
    this.liveIkiMs.push(ikiMs);
    this.learnFromPlay();
  }

  // -------------------------------------------------------------------------
  // Lock emissions -> pixels
  // -------------------------------------------------------------------------

  private applyLock(event: LockEvent): void {
    this.lock = reduce(this.lock, event);
    for (const emit of this.lock.emitted) this.renderEmit(emit);
  }

  private renderEmit(emit: LockEmit): void {
    switch (emit.type) {
      case "locked":
        this.onLocked(emit.asteroidId);
        break;
      case "advanced":
        this.noteInterval(emit.ikiMs);
        this.onAdvanced(emit.candidateIds, emit.typed);
        break;
      case "parked":
        this.onParked(emit.asteroidId, emit.firesAtMs, emit.nowMs);
        break;
      case "typo":
        this.onTypo(emit.asteroidId, emit.word, emit.nowMs);
        break;
      case "ignored":
        this.onIgnored(emit.asteroidId, emit.ignoredTargetIds, emit.shake);
        break;
      case "blast":
        this.onBlast(
          emit.asteroidId,
          emit.word,
          emit.fkLatencyMs,
          emit.ikiMs,
          emit.nowMs,
        );
        break;
    }
  }

  private onLocked(id: string): void {
    const rock = this.rockById(id);
    if (rock === undefined) return;
    this.cue("lock");
    const ring = this.add.graphics();
    ring.lineStyle(3, hexToInt(this.palette.accent), 0.9);
    ring.strokeCircle(0, 0, rock.sizePx * 0.62);
    rock.container.addAt(ring, 0);
    this.tweens.add({
      targets: ring,
      scale: { from: 1.35, to: 1 },
      alpha: { from: 0.95, to: 0.4 },
      duration: 260,
      ease: "Back.Out",
    });
    this.tweens.add({
      targets: this.iris,
      alpha: { from: 0.6, to: 1 },
      duration: 180,
      ease: "Cubic.Out",
    });
  }

  private onAdvanced(candidateIds: readonly string[], typed: string): void {
    this.correctChars += 1;
    this.cue("keystroke");
    const typedCount = [...typed].length;
    const live = new Set(candidateIds);
    for (const rock of this.rocks) {
      rock.plate.setTypedCount(live.has(rock.id) ? typedCount : 0);
    }
  }

  /** AC-2.2: the armed word charges, and fires exactly at `firesAtMs`. */
  private onParked(id: string, firesAtMs: number, nowMs: number): void {
    this.parked = { id, firesAtMs, startedAtMs: nowMs };
    this.cue("park");
    const rock = this.rockById(id);
    if (rock === undefined) return;
    const ring = this.add.graphics();
    ring.lineStyle(4, hexToInt(this.palette.accent), 0.85);
    ring.strokeCircle(0, 0, rock.sizePx * 0.78);
    rock.container.addAt(ring, 0);
    this.tweens.add({
      targets: ring,
      scale: { from: 1, to: 0.72 },
      alpha: { from: 0.85, to: 0.2 },
      duration: Math.max(120, firesAtMs - nowMs),
      ease: "Sine.InOut",
      onComplete: () => ring.destroy(),
    });
  }

  /** AC-3.2: shake, count, keep the lock. No red, no cross, no "mistake" tint. */
  private onTypo(id: string | null, _word: string | null, nowMs: number): void {
    this.typos += 1;
    this.combo = comboReducer(this.combo, "typo");
    if (id !== null) {
      const rock = this.rockById(id);
      rock?.plate.shake(6, 140);
      if (rock !== undefined) {
        this.book = applyToBook(this.book, rock.word, {
          kind: "typo",
          atMs: nowMs,
          stage: this.cfg.stage,
        });
      }
    }
    this.cue("typo");
    this.publishHud(true);
  }

  /**
   * AC-3.3 / collision C10. Shake only. Nothing here may touch the combo, the
   * typo tally or the word record - see the header note.
   */
  private onIgnored(
    lockedId: string | null,
    ignoredTargetIds: readonly string[],
    shake: boolean,
  ): void {
    this.cue("ignored");
    // AC-6e.2: every keystroke gets a visible answer, including the one that
    // matched nothing at all. A lens blip is that answer - it is an
    // acknowledgement, not a correction, and it costs the player nothing.
    this.tweens.add({
      targets: this.iris,
      alpha: { from: 1, to: 0.45 },
      duration: 110,
      yoyo: true,
      ease: "Sine.InOut",
    });
    if (!shake) return;
    if (lockedId !== null) this.rockById(lockedId)?.plate.shake(3, 120);
    for (const id of ignoredTargetIds) {
      const rock = this.rockById(id);
      if (rock === undefined) continue;
      this.tweens.add({
        targets: rock.container,
        scale: { from: 1, to: 1.05 },
        duration: 120,
        yoyo: true,
        ease: "Sine.InOut",
      });
    }
  }

  private onBlast(
    id: string,
    word: string,
    fkLatencyMs: number,
    ikiMs: readonly number[],
    nowMs: number,
  ): void {
    const rock = this.rockById(id);
    this.parked = null;

    this.combo = comboReducer(this.combo, "hit");
    // The peak, kept because the live chain is about to be resettable and a
    // chain is the one thing about a stage that nothing persists.
    this.bestCombo = Math.max(this.bestCombo, this.combo.combo);
    const points = wordScore([...word].length, this.combo.multiplier);
    this.score += points;
    this.hits += 1;
    // D09. Recorded HERE, off the lock machine's own `blast` emission, because
    // this is the only place in the program that knows a word was destroyed by
    // the player rather than merely present on the belt.
    this.history = recordBlast(this.history, {
      word,
      atMs: nowMs,
      fkLatencyMs,
      ikiMs,
      wasCanister: rock?.isCanister ?? false,
    });
    this.book = applyToBook(this.book, word, {
      kind: "hit",
      fkLatencyMs,
      ikiMs,
      atMs: nowMs,
      stage: this.cfg.stage,
    });
    if (Number.isFinite(fkLatencyMs) && fkLatencyMs > 0) this.liveFkMs.push(fkLatencyMs);
    this.controller = recordOutcome(this.controller, "blasted");
    this.recordClear(rock, nowMs);

    if (rock !== undefined) {
      if (rock.isCanister) {
        this.hull = hullAfterShield(this.hull, this.maxHull);
        this.canisterId = null;
        this.removeScorch();
        this.cue("shield");
      }
      this.fireBeam(rock);
      this.fractureRock(rock, points);
    }
    this.cue("blast");
    this.publishHud(true);
  }

  /** Art-direction section 8: beam 80 ms, shards on Expo.Out, plate dissolves. */
  private fireBeam(rock: LiveRock): void {
    const origin = this.emitterWorldPoint();
    const target = { x: rock.container.x, y: rock.container.y };
    this.beam.clear();
    this.drawIris(this.iris, 1);
    this.tweens.addCounter({
      from: 1,
      to: 0,
      duration: 80,
      ease: "Expo.Out",
      onUpdate: (tween) => {
        const v = tween.getValue() ?? 0;
        this.beam.clear();
        this.beam.lineStyle(2 + 8 * v, hexToInt(this.palette.accent), 0.25 + 0.6 * v);
        this.beam.lineBetween(origin.x, origin.y, target.x, target.y);
      },
      onComplete: () => {
        this.beam.clear();
        this.drawIris(this.iris, 0);
      },
    });
  }

  /**
   * The rock breaks (art-direction section 8).
   *
   * A player played this and said the explosions "are not satisfying at all",
   * and they were right: a blast was eight same-coloured shards, a plate fade
   * and a 220 ms scale-up, all of it inside the rock's own footprint. Nothing
   * left the rock, so nothing read as the rock coming apart.
   *
   * Five things land on the same frame now, which is what an impact is:
   *   FLASH     one bright additive pop at the point of contact, 160 ms. The
   *             eye reads the hit before it reads the debris.
   *   SHOCKWAVE an expanding accent ring on Expo.Out - the blast curve.
   *   SHARDS    16 chunks in THIS ROCK'S colour, spinning, spread over a wide
   *             speed range so they spray instead of leaving together.
   *   PLATE     dissolves upward, further and slower than it did.
   *   SHAKE     3-9 px, scaled by the combo, so a run that is going well hits
   *             harder. Off under reduced motion (AC-19.3).
   *
   * D28 is untouched by all of it: this is the player DESTROYING something, and
   * the strike on the hull below stays a scuff with no flash and no red.
   */
  private fractureRock(rock: LiveRock, points: number): void {
    rock.resolved = true;
    this.rocks = this.rocks.filter((r) => r.id !== rock.id);

    const x = rock.container.x;
    const y = rock.container.y;
    const shardSpec = particleSpec("blastShards");
    const fill = this.cfg.colorblindPalette
      ? this.palette.colorblind.debris
      : rock.debris.fill;

    // The rock's own colour (blastShards.colorSource === "debris").
    this.shards.setParticleTint(hexToInt(fill));
    this.shards.emitParticleAt(x, y, shardSpec.quantity);

    this.blastFlash(x, y, rock.sizePx);
    this.shockwave(x, y, rock.sizePx);
    this.shakeBy(3 + Math.min(10, this.combo.combo) * 0.6, 160);

    rock.plate.dissolveUpward(520);
    const floater = this.add
      .text(x, y, `+${points}`, {
        fontFamily: this.plateStyle.fontFamily,
        fontSize: "26px",
        color: this.palette.accent,
      })
      .setOrigin(0.5)
      .setDepth(layer("shipFx").depth);
    this.tweens.add({
      targets: floater,
      y: floater.y - 70,
      alpha: 0,
      duration: 400,
      ease: "Expo.Out",
      onComplete: () => floater.destroy(),
    });

    this.tweens.add({
      targets: rock.body,
      scale: { from: 1, to: 1.5 },
      alpha: 0,
      duration: 240,
      ease: "Expo.Out",
      onComplete: () => rock.container.destroy(),
    });
  }

  /** A brief bright pop at the point of impact. One additive quad, 160 ms. */
  private blastFlash(x: number, y: number, sizePx: number): void {
    const flash = this.add
      .image(x, y, TEX.glow)
      .setDisplaySize(sizePx * 1.6, sizePx * 1.6)
      .setTint(hexToInt(this.palette.accent))
      .setAlpha(0.95)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(layer("shipFx").depth);
    this.tweens.add({
      targets: flash,
      displayWidth: sizePx * 3.4,
      displayHeight: sizePx * 3.4,
      alpha: 0,
      duration: 160,
      ease: "Expo.Out",
      onComplete: () => flash.destroy(),
    });
  }

  /** The ring that says the rock pushed the air out of the way. */
  private shockwave(x: number, y: number, sizePx: number): void {
    const ring = this.add.graphics().setDepth(layer("shipFx").depth);
    const accent = hexToInt(this.palette.accent);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 300,
      ease: "Expo.Out",
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        ring.clear();
        ring.lineStyle(5 * (1 - t) + 1, accent, 0.75 * (1 - t));
        ring.strokeCircle(x, y, sizePx * (0.45 + t * 1.25));
      },
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * One shake implementation, used by the blast and by the strike.
   *
   * AC-19.3: shake is FRAMING motion, so reduced motion removes it entirely and
   * the gameplay underneath is untouched. Both callers get that for free by
   * going through here rather than each remembering the guard.
   */
  private shakeBy(amplitudePx: number, durationMs: number): void {
    if (this.cfg.reducedMotion) return;
    this.tweens.addCounter({
      from: amplitudePx,
      to: 0,
      duration: durationMs,
      ease: "Cubic.Out",
      onUpdate: (tween) => {
        const amp = tween.getValue() ?? 0;
        this.shakeX = Math.sin(tween.progress * Math.PI * 7) * amp;
        this.shakeY = Math.cos(tween.progress * Math.PI * 5) * amp * 0.5;
      },
      onComplete: () => {
        this.shakeX = 0;
        this.shakeY = 0;
      },
    });
  }

  // -------------------------------------------------------------------------
  // Hull
  // -------------------------------------------------------------------------

  /**
   * A rock reached the breach line. What happens next depends on whether it was
   * ever pointed at the ship.
   *
   * THE RULE, AND THE PLAYER'S REASONING FOR IT (D21, D23, D31). A word is on
   * this belt for one of two reasons: it is new, or the GAME PUT IT BACK -
   * because the child missed it (D23, "a missed word comes back sooner") or
   * because it is a retention check (D21, AC-9.3). The second kind exists to be
   * practised. Flying it at the hull charges the child for the game's own
   * decision to re-teach them something, which is the direction D31 forbids
   * outright.
   *
   * So a practice rock is placed off the ship's lane at spawn
   * (`@engine/spawn`) and, when it gets to the bottom, it goes PAST the ship
   * rather than into it. Nothing else about it is softened: the same word, the
   * same fall time (FR-8), the same weighting, the same record of a miss - so
   * it still comes back, and the difficulty controller still counts it. It is
   * a rock that missed, not a rock that was made easy.
   */
  private resolveAtBreachLine(rock: LiveRock, now: number): void {
    if (rock.isPractice) this.passBy(rock, now);
    else this.breach(rock, now);
  }

  /**
   * Everything a rock leaving the board costs the ENGINE, whichever way it left.
   *
   * Shared so a pass-by and a strike can never disagree about what the player
   * now knows, what the controller saw, or what the warp sentence may light up.
   * The only things NOT here are the hull, the combo and the strike art, which
   * is exactly the difference between the two.
   */
  private retireAtBreachLine(rock: LiveRock, now: number): void {
    rock.resolved = true;
    this.rocks = this.rocks.filter((r) => r.id !== rock.id);
    if (rock.isCanister) this.canisterId = null;

    this.applyLock({ type: "despawn", id: rock.id, nowMs: now });
    this.book = applyToBook(this.book, rock.word, {
      kind: "miss",
      atMs: now,
      stage: this.cfg.stage,
    });
    this.controller = recordOutcome(this.controller, "missed");
    // A breach frees the player for the next word exactly as a blast does, but
    // it is NOT a clear sample: they never got to this rock, so it says nothing
    // about how fast they type. Pacing off it would read a belt that is already
    // too fast as a player who is slow.
    this.lastResolveAtMs = now;
    // The other half of D09: a word that got through is the one thing the warp
    // sentence must NOT light up, and it is what Shadow names (AC-15.5).
    this.history = recordMiss(this.history, { word: rock.word, atMs: now });
  }

  /**
   * A practice rock sails past the Lantern and out of the frame.
   *
   * No hull mark, because it never touched the ship. No combo reset, for the
   * same reason - `comboReducer`'s only breaking event here is `hullHit`, and
   * there was no hull hit. No shake, no scorch, no cue: the ten SFX events are
   * responses to something happening TO the ship, and nothing happened.
   *
   * It still records a miss (above), so D23 brings the word back sooner, which
   * is the whole point of it having been here.
   */
  private passBy(rock: LiveRock, now: number): void {
    this.retireAtBreachLine(rock, now);

    const drift = rock.container.x < this.shipX ? -80 : 80;
    for (const target of [rock.container, rock.plate]) {
      this.tweens.add({
        targets: target,
        y: this.scale.height + 160,
        x: target.x + drift,
        alpha: 0,
        duration: 620,
        ease: "Cubic.Out",
        onComplete: () => target.destroy(),
      });
    }
    this.publishHud(true);
  }

  /** AC-4.2 / D28: shake + one spark burst + a scorch. No flash, no explosion. */
  private breach(rock: LiveRock, now: number): void {
    this.retireAtBreachLine(rock, now);
    this.combo = comboReducer(this.combo, "hullHit");
    this.hull = hullAfterStrike(this.hull, this.maxHull);
    this.hullHitsTaken += 1;

    rock.plate.destroy();
    this.tweens.add({
      targets: rock.container,
      alpha: 0,
      scale: 0.7,
      duration: 220,
      ease: "Cubic.Out",
      onComplete: () => rock.container.destroy(),
    });

    this.strike(rock.container.x);
    this.cue("hit");
    this.publishHud(true);

    if (isStalled(this.hull)) this.beginStall();
  }

  private strike(atX: number): void {
    const sparkSpec = particleSpec("strikeSpark");
    const ship = this.shipWorldPoint();
    this.sparks.emitParticleAt(atX, ship.y - 40, sparkSpec.quantity);
    this.addScorch();
    // Art-direction section 8: 120 ms, 6 px, decaying. Fixed, and deliberately
    // NOT scaled by anything - a strike that hits harder when the hull is low
    // is a punishment (D28/D31), and the blast is the only shake in this game
    // that is allowed to grow.
    this.shakeBy(6, 120);
  }

  /** One scorch mark per hit (art-direction section 5), cleared at stage end. */
  private addScorch(): void {
    const g = this.add.graphics();
    const x = (this.rng() - 0.5) * 26;
    const y = -30 + this.rng() * 50;
    g.fillStyle(hexToInt("#2A2F3A"), 0.55);
    g.fillEllipse(x, y, 16, 9);
    g.fillStyle(hexToInt("#1A1D24"), 0.4);
    g.fillEllipse(x + 3, y + 2, 9, 5);
    g.setAlpha(0);
    this.scorchLayer.add(g);
    this.tweens.add({ targets: g, alpha: 1, duration: 200, ease: "Cubic.Out" });
  }

  private removeScorch(): void {
    const marks = this.scorchLayer.list;
    const last = marks[marks.length - 1];
    if (last === undefined) return;
    this.tweens.add({
      targets: last,
      alpha: 0,
      duration: 260,
      ease: "Cubic.Out",
      onComplete: () => last.destroy(),
    });
  }

  /**
   * D29 / screen 6b: the engines go quiet. The ship sputters, dims and sinks
   * over several seconds; then the calm card. No explosion, no red - the stage
   * ends the way a glider lands, not the way a bomb goes off.
   */
  private beginStall(): void {
    if (this.stalled) return;
    this.stalled = true;
    this.cue("stall");
    this.game.events.emit(FLIGHT_EVENTS.stall, { stopId: this.cfg.stopId });

    this.tweens.add({
      targets: this.exhaust,
      alpha: { from: 1, to: 0.15 },
      duration: 420,
      yoyo: true,
      repeat: 2,
      ease: "Sine.InOut",
    });
    this.tweens.add({
      targets: this.shipBody,
      y: 240,
      alpha: 0.35,
      duration: 2600,
      ease: "Cubic.Out",
    });
    for (const rock of this.rocks) {
      this.tweens.add({
        targets: rock.container,
        alpha: 0.3,
        duration: 900,
        ease: "Sine.InOut",
      });
    }

    // Real time, not the Phaser clock: the clock advances by the smoothed and
    // capped frame delta, so on a machine that is dropping frames "several
    // seconds" of sinking would become half a minute of a child staring at a
    // ship that is going nowhere. The sink is a felt duration and belongs on
    // the wall clock.
    this.stallStartedAtMs = performance.now();
  }

  private maybeShowStallCard(): void {
    if (this.stallStartedAtMs === null) return;
    if (performance.now() - this.stallStartedAtMs < STALL_SINK_MS) return;
    this.stallStartedAtMs = null;
    this.scene.launch(SCENE_KEYS.stall, {
      stopId: this.cfg.stopId,
      uiLang: this.cfg.uiLang,
      shipName: this.cfg.shipName,
      colorblindPalette: this.cfg.colorblindPalette,
      reducedMotion: this.cfg.reducedMotion,
    });
  }

  /** D30. The break is over; this stack is what jumps. */
  private readonly onWarpSpeed = (payload: WarpSpeedPayload): void => {
    if (!this.stageComplete) return;
    // The calm-down tween writes the same value every frame, so it has to be
    // stopped rather than out-shouted: a jump that has to fight a 900 ms ease
    // still running is a jump that stutters.
    this.calmTween?.stop();
    this.calmTween = null;
    this.parallax.setWorldSpeed(this.cfg.worldSpeedPxPerSec * payload.multiplier);
  };

  private onRestartRequested(): void {
    // AC-4.3: restart from stage start, per-word history retained - the book
    // goes back in as config, so everything the player learned survives.
    this.scene.stop(SCENE_KEYS.stall);
    this.scene.stop(SCENE_KEYS.hud);
    this.scene.restart({ ...this.cfg, book: this.book });
  }

  // -------------------------------------------------------------------------
  // Stage end
  // -------------------------------------------------------------------------

  private checkStageEnd(): void {
    if (this.stageComplete) return;
    if (this.spawnedCount < this.cfg.stageWordCount) return;
    if (this.rocks.length > 0) return;

    this.stageComplete = true;
    const before = this.controller.knobs;
    this.controller = endStage(this.controller); // AC-10.1: one knob, stage end.
    if (
      before.maxLive !== this.controller.knobs.maxLive ||
      before.lengthBias !== this.controller.knobs.lengthBias
    ) {
      this.knobChanges += 1;
    }
    this.scorchLayer.removeAll(true); // D27: full repair at stage end.

    const outcome = stageOutcome(this.history, this.calibration);
    // D51, the half that survives the stage: fold what this belt measured into
    // the STORED baseline, so the next stop opens knowing what this one found
    // out. The ritual is a once-per-profile event (AC-11.2), so without this a
    // baseline measured on a child's first evening would still be setting fall
    // time a year later - and a profile that predates the ritual running at all
    // would never be measured by anything.
    refineStoredCalibration(this, observedTimings(this.history));

    this.game.events.emit(FLIGHT_EVENTS.stageComplete, {
      stopId: this.cfg.stopId,
      wpm: this.currentWpm(),
      accuracy: accuracy(this.hits, this.typos),
      hullHits: this.hullHitsTaken,
      score: this.score,
      book: this.book,
      knobs: this.controller.knobs,
      history: this.history,
      ...outcome,
    });

    const warp = this.scene.get(SCENE_KEYS.warp);
    if (warp !== null) {
      this.scene.stop(SCENE_KEYS.hud);
      this.calmTheBelt();
      // D09. `blastHistory` is the record; `blasted` is the flattened view the
      // warp sentence highlights from. Both travel, because the break should
      // not have to re-derive the thing the belt already knows - and because
      // handing over the raw history keeps the later screens (Results, the
      // beacon log) able to ask questions this hand-off did not anticipate.
      //
      // `missed` / `slow` / `hitRate` are the coach request (FR-15, AC-15.5).
      // Before this they were never supplied, so Shadow could only ever say
      // the "clean run" line, however many words got past the ship.
      // D30. LAUNCH, not START.
      //
      // `scene.start(Warp)` shut this scene down and built a different screen,
      // which is why the break read as being taken somewhere instead of as
      // having cleared something. `launch` runs Warp ON TOP while this scene
      // keeps running: `update` still advances the parallax every frame (the
      // gameplay block below it is already gated on `stageComplete`), so the
      // world the player just flew goes on drifting behind the panel, and the
      // acceleration at the end of the break is applied to THIS stack via
      // `FLIGHT_EVENTS.warpSpeed`. Warp stops this scene when it leaves for
      // Beacon, which is the moment the player actually goes somewhere.
      this.scene.launch(SCENE_KEYS.warp, {
        overlay: true,
        stopId: this.cfg.stopId,
        book: this.book,
        blastHistory: this.history,
        blasted: outcome.blasted,
        missed: outcome.missed,
        slow: outcome.slow,
        hitRate: outcome.hitRate,
        lang: this.cfg.uiLang,
        shipName: this.cfg.shipName,
        // WHAT THE RESULTS SCREEN IS MADE OF, and what it never used to get.
        // `computeStageResults` is a pure function of a tally plus the words
        // this stage saw, and until now neither travelled: Results defaulted to
        // an all-zero tally and an empty exposure list, so a real belt reported
        // "0 wpm" with three stars next to it.
        //
        // `payload` is the declared opaque channel (WarpInit.payload) that Warp
        // hands to Beacon and Beacon hands to Results untouched. It is used
        // rather than three more top-level fields because those two screens are
        // not supposed to know what a stage tally is.
        //
        // NOTE what is NOT here: `progress`. The stage does not carry the route
        // forward; the store does. Warp/Beacon/Results each read the profile at
        // the point of use, so a clear cannot be lost by a screen forwarding the
        // array it was handed rather than the one that was written.
        payload: {
          tally: this.stageTally(),
          exposures: this.stageExposures(),
          // D80's trophies. Four facts that live for one stage and are then
          // gone - no profile field holds a chain or a tier - so if they do not
          // travel with the payload, Chain 25, Chain 50 and Sharp Eye can never
          // be earned by playing. They could not, until this line.
          award: this.stageAward(),
        },
      });
      this.scene.bringToTop(SCENE_KEYS.warp);
    }
  }

  /**
   * D30: "everything calms". The belt eases down to a drift rather than
   * stopping dead, because a world that halts on a frame reads as a pause, and
   * the break is meant to read as arriving.
   *
   * Cubic.Out - arrive and settle (AC-22.5). Kept under reduced motion: this is
   * the world's own motion, not framing, and D41 removes the second, not the
   * first.
   */
  private calmTheBelt(): void {
    const from = this.cfg.worldSpeedPxPerSec;
    const holder = { v: from };
    this.calmTween = this.tweens.add({
      targets: holder,
      v: from * CALM_WORLD_SPEED_FRACTION,
      duration: 900,
      ease: "Cubic.Out",
      onUpdate: () => this.parallax.setWorldSpeed(holder.v),
      onComplete: () => {
        this.calmTween = null;
      },
    });
  }

  /**
   * What `@engine/awards` needs and the profile cannot supply (D80, AC-6d.1c).
   *
   * All four die with the stage: the peak chain, whether D25's shared-prefix
   * tier was on, the stars, and whether every retention word was recalled.
   * Nothing writes them anywhere, which is precisely why three of the twelve
   * trophies were unreachable.
   *
   * `retentionAllRecalled` is `null` when the stage had no retention words, and
   * that distinction is load-bearing: a Mars belt has no earlier stop to draw
   * from, and "recalled all zero of them" must not earn Long Memory.
   */
  private stageAward(): StageAward {
    const retention = [...this.retentionWords];
    const blasted = new Set(stageOutcome(this.history, this.calibration).blasted);
    return {
      stopId: this.cfg.stopId,
      stars: starsForHullHits(this.hullHitsTaken, this.maxHull),
      bestCombo: this.bestCombo,
      sharedPrefixStage: this.selection.sharedPrefixTier,
      retentionAllRecalled:
        retention.length === 0 ? null : retention.every((w) => blasted.has(w)),
    };
  }

  /** The raw counters `@engine/scoring` turns into WPM, accuracy and stars. */
  private stageTally(): StageTally {
    return {
      characters: this.correctChars,
      // The Phaser clock, matching `currentWpm()` and the HUD the player just
      // watched. `performance.now()` here would disagree with the number that
      // was on screen a second ago, because the scene clock pauses when the
      // scene does (AC-19.x pause) and wall time does not.
      elapsedMs: this.time.now - this.stageStartMs,
      hits: this.hits,
      typos: this.typos,
      hullHits: this.hullHitsTaken,
      // Without this the results screen would rate a nine-mark stage on a
      // three-mark curve and call a cleared belt a stall (AC-4.4, @engine/hull).
      maxHull: this.maxHull,
    };
  }

  /**
   * One `WordExposure` per word this stage resolved, with its record from
   * BEFORE the stage as `prior`.
   *
   * `this.cfg.book` is the book as it stood at stage start and `this.book` is
   * the live one, already folded with this stage's samples. AC-20.2 compares
   * this stage against what came before it, so `prior` has to come from the
   * frozen config copy - reading `this.book` would compare the stage with
   * itself and no word would ever be marked faster.
   */
  private stageExposures(): WordExposure[] {
    const samples = new Map<string, { fk: number[]; hit: boolean }>();
    for (const blast of this.history.blasts) {
      const entry = samples.get(blast.word) ?? { fk: [], hit: false };
      if (Number.isFinite(blast.fkLatencyMs)) entry.fk.push(blast.fkLatencyMs);
      entry.hit = true;
      samples.set(blast.word, entry);
    }
    for (const miss of this.history.misses) {
      if (!samples.has(miss.word)) samples.set(miss.word, { fk: [], hit: false });
    }
    return [...samples.entries()].map(([word, entry]) => ({
      word,
      fkLatencyMs: entry.fk,
      hit: entry.hit,
      retention: this.retentionWords.has(word),
      prior: this.cfg.book[word] ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private rockById(id: string): LiveRock | undefined {
    return this.rocks.find((r) => r.id === id);
  }

  private shipWorldPoint(): { x: number; y: number } {
    return { x: this.scale.width / 2, y: this.scale.height - 150 };
  }

  private emitterWorldPoint(): { x: number; y: number } {
    const ship = this.shipWorldPoint();
    return { x: ship.x, y: ship.y - 84 };
  }

  /** The emitter's pivot mount tracks the locked target (D89). */
  private aimEmitter(): void {
    const id = this.lock.lockedId;
    const rock = id === null ? undefined : this.rockById(id);
    const target = rock === undefined ? 0 : this.aimAngleTo(rock);
    this.emitterHead.rotation += (target - this.emitterHead.rotation) * 0.18;
  }

  private aimAngleTo(rock: LiveRock): number {
    const origin = this.emitterWorldPoint();
    const angle = Math.atan2(
      rock.container.x - origin.x,
      origin.y - rock.container.y,
    );
    return Math.max(-0.7, Math.min(0.7, angle));
  }

  private currentWpm(): number {
    return wpm(this.correctChars, this.time.now - this.stageStartMs);
  }

  private cue(name: FlightCue): void {
    // AC-6e.2: every keystroke gets a visual AND an audio response. The visual
    // is above; this is the audio lane's hook, so the two never drift apart.
    //
    // The three numbers ride along because D63's reactive shaping needs them AT
    // THE INSTANT OF THE CUE: blast pitch rises with the combo and the hit thud
    // grows as the hull falls, and both of those are updated in this scene
    // immediately BEFORE the cue and published to the HUD immediately after. An
    // audio listener reading the HUD stream instead would be reading the state
    // from before the very event it is sounding.
    this.game.events.emit(FLIGHT_EVENTS.cue, {
      cue: name,
      atMs: this.time.now,
      combo: this.combo.combo,
      hull: this.hull,
      maxHull: this.maxHull,
      live: this.rocks.length,
    });
  }

  private snapshot(): HudSnapshot {
    return {
      stopName: this.palette.name,
      wpm: this.currentWpm(),
      accuracy: accuracy(this.hits, this.typos),
      combo: this.combo.combo,
      multiplier: hudMultiplierFor(this.combo.combo),
      score: this.score,
      hull: this.hull,
      maxHull: this.maxHull,
      liveCount: this.rocks.length,
      accent: this.palette.accent,
      plate: this.palette.plate,
      plateText: this.palette.plateText,
    };
  }

  private publishHud(force: boolean): void {
    if (!force && this.time.now - this.lastHudAtMs < 100) return;
    this.lastHudAtMs = this.time.now;
    this.game.events.emit(FLIGHT_EVENTS.hud, this.snapshot());
  }

  // -------------------------------------------------------------------------
  // Debug surface (evidence only; never gameplay)
  // -------------------------------------------------------------------------

  private debugApi(): FlightDebugApi {
    return {
      state: (): FlightDebugState => {
        const outcome = stageOutcome(this.history, this.calibration);
        return {
          hull: this.hull,
          score: this.score,
          combo: this.combo.combo,
          multiplier: hudMultiplierFor(this.combo.combo),
          typos: this.typos,
          hits: this.hits,
          wpm: this.currentWpm(),
          accuracy: accuracy(this.hits, this.typos),
          typed: this.lock.typed,
          lockedId: this.lock.lockedId,
          parkedId: this.parked?.id ?? null,
          stalled: this.stalled,
          stageComplete: this.stageComplete,
          maxHull: this.maxHull,
          hullHits: this.hullHitsTaken,
          calibration: { ...this.calibration },
          maxLive: this.controller.knobs.maxLive,
          knobChanges: this.knobChanges,
          spawnGapMs: this.lastSpawnGapMs,
          rocks: this.rocks.map((r) => ({
            id: r.id,
            word: r.word,
            sizePx: r.sizePx,
            x: r.container.x,
            y: r.container.y,
            // The plate is its own object on its own layer now, so these are
            // read straight off it rather than composed from the rock.
            plateY: r.plate.y,
            plateTop: r.plate.y - r.plate.plateSizePx.height / 2,
            plateLeft: r.plate.x - r.plate.plateSizePx.width / 2,
            plateRight: r.plate.x + r.plate.plateSizePx.width / 2,
            plateBottom: r.plate.y + r.plate.plateSizePx.height / 2,
            plateDepth: this.plateLayer.depth,
            rockBottom: r.container.y + r.sizePx / 2,
            rockDepth: this.debrisLayer.depth,
            typedCount: r.plate.typedCount,
            isCanister: r.isCanister,
            isPractice: r.isPractice,
            onShipLane: isOnShipLane(r.container.x, this.laneSpec(r.sizePx)),
            debrisType: r.debris.id,
          })),
          layerOffsets: { ...this.layerOffsets },
          skySample: { x: this.scale.width * 0.05, y: this.scale.height * 0.04 },
          bookExposures: Object.values(this.book).reduce(
            (n, r) => n + r.exposures,
            0,
          ),
          // D09's evidence. `blasted` is the ordered list the warp break lights
          // up; `missed` is the list it must leave dim.
          blasted: [...outcome.blasted],
          missed: [...outcome.missed],
        };
      },
      strike: () => {
        if (!this.cfg.debug || this.stalled) return;
        this.controller = recordOutcome(this.controller, "missed");
        this.combo = comboReducer(this.combo, "hullHit");
        this.hull = hullAfterStrike(this.hull, this.maxHull);
        this.hullHitsTaken += 1;
        this.strike(this.scale.width / 2);
        this.publishHud(true);
        if (isStalled(this.hull)) this.beginStall();
      },
      makeCanister: (word?: string) => {
        if (!this.cfg.debug) return null;
        // `word` names WHICH rock to promote. Without it the oldest is taken,
        // which is what every caller before this wanted - but the oldest rock
        // is also the one nearest the breach line, so a spec that has to resume
        // the belt and type it can lose the race and measure a breach instead
        // of a repair. Naming a rock the spec has just spawned removes that.
        const rock =
          word === undefined
            ? this.rocks[0]
            : this.rocks.find((r) => r.word === word);
        if (rock === undefined) return null;
        const promoted: LiveRock = { ...rock, isCanister: true };
        this.rocks = this.rocks.map((r) => (r.id === rock.id ? promoted : r));
        this.canisterId = rock.id;
        drawShieldCanister(rock.body, {
          type: rock.debris,
          variantIndex: 0,
          sizePx: rock.sizePx,
          lightAngle: -Math.PI / 4,
          fillOverride: null,
          accent: this.palette.accent,
        });
        return rock.word;
      },
      words: () => this.rocks.map((r) => r.word),
      spawn: (word: string, options?: SpawnDebugOptions) => {
        // Debug only: puts a KNOWN word on the belt so the shared-prefix and
        // parked-word paths (D25, AC-2.2) can be exercised deterministically
        // instead of waiting for the picker to happen to serve the pair.
        //
        // `options` exists for the plate-legibility spec: proving that a rock
        // cannot cover a word needs two rocks placed ON TOP of each other, and
        // waiting for the picker to do that by chance is not a test.
        if (!this.cfg.debug) return;
        this.spawnRock(word, this.time.now, options?.practice ?? false);
        const rock = this.rocks[this.rocks.length - 1];
        if (rock === undefined || options === undefined) return;
        // BOTH overrides go through the rock's own fields, not through the
        // display objects. `updateRocks` recomputes x and y from `homeX` and
        // from how long the rock has been falling on EVERY frame, so writing
        // the container directly lasts exactly one frame - which is long enough
        // to make a test look like it worked and short enough to make it
        // meaningless.
        //
        // y is set by BACK-DATING the spawn to the moment a rock falling
        // normally would have been at that height. The rock is then in every
        // respect an ordinary rock that happens to have started earlier, rather
        // than one being dragged around behind the simulation's back.
        const span = rock.toY - rock.fromY;
        const placed: LiveRock = {
          ...rock,
          homeX: typeof options.x === "number" ? options.x : rock.homeX,
          spawnedAtMs:
            typeof options.y === "number" && span !== 0
              ? this.time.now - ((options.y - rock.fromY) / span) * rock.fallMs
              : rock.spawnedAtMs,
        };
        this.rocks = this.rocks.map((r) => (r.id === rock.id ? placed : r));
        this.updateRocks(this.time.now);
        // Land the arrival pop immediately. A placed rock is usually placed so
        // that a spec can MEASURE it, and the Back.Out tween starts at scale
        // 0.7 - so a spec reading `plateSizePx` while the tween is still
        // running (or, on a paused scene, never running) would screenshot a
        // rectangle larger than the plate actually drawn in it and blame the
        // sky it caught at the edges on the plate.
        this.tweens.killTweensOf([rock.container, rock.plate]);
        rock.container.setScale(1);
        rock.plate.setScale(1);
      },
    };
  }
}

/** The read-only measurement surface the e2e uses (gated behind `debug`). */
/** Placement overrides for the debug spawn hook. Evidence only, never gameplay. */
export interface SpawnDebugOptions {
  readonly x?: number;
  readonly y?: number;
  /** Spawn it as a D21/D23 practice rock (off-lane, sails past the ship). */
  readonly practice?: boolean;
}

export interface FlightDebugApi {
  state(): FlightDebugState;
  strike(): void;
  /** Promote a live rock to a shield canister; returns its word. */
  makeCanister(word?: string): string | null;
  words(): string[];
  spawn(word: string, options?: SpawnDebugOptions): void;
}

declare global {
  interface Window {
    __kbFlight?: FlightDebugApi;
  }
}
