import Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import {
  LAYERS,
  type LayerId,
  cameraSwayPx,
  idleDriftPx,
  layer,
} from "@game/render/layers.js";
import { particleSpec } from "@game/render/particles.js";
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
  recordOutcome,
} from "@engine/controller/index.js";
import {
  type ComboState,
  INITIAL_COMBO_STATE,
  accuracy,
  comboReducer,
  hudMultiplierFor,
  wordScore,
  wpm,
} from "@engine/scoring/index.js";
import {
  type WordBook,
  applyToBook,
  bookOf,
  recordFor,
} from "@engine/words/index.js";
import { STOP_IDS, type StopId } from "@engine/types.js";
import {
  FLIGHT_EVENTS,
  type FlightConfig,
  type FlightCue,
  type HudSnapshot,
  type Palette,
  type SkyTravel,
  flightConfigFrom,
  mulberry32,
  paletteFor,
  retentionPoolFor,
  skyAt,
  skyTravelFor,
  stagePoolFor,
} from "@game/flight/stage.js";
import { type FlightCopy, createFlightCopy } from "@game/flight/copy.js";
import {
  MAX_HULL,
  hullAfterShield,
  hullAfterStrike,
  isStalled,
  maySpawnCanister,
  startingHull,
} from "@game/flight/shield.js";
import { HudScene } from "./HudScene.js";
import { StallScene } from "./StallScene.js";

/**
 * SCREEN 6 - FLIGHT. The core loop (design-brief-v2.md section 6, PRD 3.1).
 *
 * THIS SCENE DECIDES NOTHING. Every rule it obeys is imported:
 *   which word spawns next      @engine/selection  (pickNext)
 *   how long it falls           @engine/fallTime   (fallTimeMs)
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

interface LiveRock {
  readonly id: string;
  readonly word: string;
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Graphics;
  readonly plate: WordPlate;
  readonly sizePx: number;
  readonly debris: DebrisType;
  readonly isCanister: boolean;
  readonly spawnedAtMs: number;
  readonly fallMs: number;
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
  readonly maxLive: number;
  readonly knobChanges: number;
  readonly rocks: readonly {
    readonly id: string;
    readonly word: string;
    readonly sizePx: number;
    readonly x: number;
    readonly y: number;
    readonly plateY: number;
    readonly plateTop: number;
    readonly rockBottom: number;
    readonly typedCount: number;
    readonly isCanister: boolean;
    readonly debrisType: string;
  }[];
  readonly layerOffsets: Readonly<Record<string, number>>;
  readonly skySample: { readonly x: number; readonly y: number };
  readonly bookExposures: number;
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
  private book: WordBook = {};

  private rocks: LiveRock[] = [];
  private hull = MAX_HULL;
  private score = 0;
  private hits = 0;
  private typos = 0;
  private correctChars = 0;
  private spawnedCount = 0;
  private nextSpawnAtMs = 0;
  private canisterId: string | null = null;
  private stageStartMs = 0;
  private stalled = false;
  private stageComplete = false;
  private knobChanges = 0;
  private nextRockIndex = 0;
  private lastHudAtMs = 0;
  private skyPaintedAt = -1;
  private stallStartedAtMs: number | null = null;

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
    hud: 0,
  };

  private skyTravel!: SkyTravel;
  private skyImage!: Phaser.GameObjects.Image;
  private skyTextureKey = "";
  private celestial!: Phaser.GameObjects.Container;
  private farField!: Phaser.GameObjects.TileSprite;
  private midField!: Phaser.GameObjects.TileSprite;
  private nearField!: Phaser.GameObjects.TileSprite;
  private debrisLayer!: Phaser.GameObjects.Container;
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
  private plateStyle!: WordPlateStyle;

  constructor() {
    super(SCENE_KEYS.flight);
  }

  init(data: Partial<FlightConfig>): void {
    this.cfg = flightConfigFrom(data);
    this.rocks = [];
    this.hull = startingHull();
    this.score = 0;
    this.hits = 0;
    this.typos = 0;
    this.correctChars = 0;
    this.spawnedCount = 0;
    this.nextSpawnAtMs = 0;
    this.canisterId = null;
    this.stalled = false;
    this.stallStartedAtMs = null;
    this.stageComplete = false;
    this.knobChanges = 0;
    this.nextRockIndex = 0;
    this.parked = null;
    this.combo = INITIAL_COMBO_STATE;
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

    this.scene.launch(SCENE_KEYS.hud, { snapshot: this.snapshot() });
    this.game.events.on(FLIGHT_EVENTS.restart, this.onRestartRequested, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(FLIGHT_EVENTS.restart, this.onRestartRequested, this);
      if (this.cfg.debug) delete window.__kbFlight;
    });

    if (this.cfg.debug) window.__kbFlight = this.debugApi();
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

    // D46: matching is the i18n lane's job, not the lock's. The matcher is
    // injected so a romanized Hindi speller ("paani" as well as "pani") is
    // accepted; `canonicalRomanization` is display-only and is deliberately NOT
    // used to pre-flatten the word on the asteroid.
    const options = {
      layout: this.cfg.keyboardLayout,
      parkGraceMs: 1.5 * this.cfg.calibration.ikiMs,
      matcher: createWordMatcher(this.cfg.inputMethod),
    } as LockOptions;
    this.lock = createLockState(options);
  }

  private buildWorld(width: number, height: number): void {
    this.skyTravel = skyTravelFor(this.palette);
    this.skyTextureKey = `kb-sky-${this.cfg.stopId}`;
    if (this.textures.exists(this.skyTextureKey)) {
      this.textures.remove(this.skyTextureKey);
    }
    this.textures.createCanvas(this.skyTextureKey, 8, 512);
    this.paintSky(0);
    this.skyImage = this.add
      .image(width / 2, height / 2, this.skyTextureKey)
      .setDisplaySize(width + 24, height + 24)
      .setDepth(layer("sky").depth);

    this.celestial = this.buildCelestial(width, height);
    // Bands, not full-screen sheets: art-direction section 2 calls L2 and L3
    // "silhouette bands" and L5 "sparse foreground", and a band is also three
    // times cheaper to fill than a screen - which is the whole of AC-22.9's
    // budget rule (layers and gradients, kept cheap).
    this.farField = this.buildBand(
      width,
      "kb-far",
      this.palette.colors[3] ?? this.palette.colors[1] ?? "#ffffff",
      0.34,
      layer("farField").depth,
      1.6,
      height * 0.3,
      height * 0.26,
    );
    this.midField = this.buildBand(
      width,
      "kb-mid",
      this.palette.colors[4] ?? this.palette.colors[2] ?? "#ffffff",
      0.5,
      layer("midField").depth,
      1.1,
      height * 0.34,
      height * 0.62,
    );
    this.nearField = this.buildBand(
      width,
      "kb-near",
      this.palette.colors[2] ?? this.palette.colors[1] ?? "#ffffff",
      0.3,
      layer("nearField").depth,
      0.55,
      height * 0.2,
      height * 0.9,
    );

    this.debrisLayer = this.add.container(0, 0).setDepth(layer("debris").depth);
    this.shipLayer = this.add.container(0, 0).setDepth(layer("shipFx").depth);
  }

  /** L1: the stop's planet, large and partially framed, with a soft glow. */
  private buildCelestial(width: number, height: number): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    const radius = height * 0.46;
    const core = hexToInt(this.palette.colors[2] ?? this.palette.accent);
    const halo = hexToInt(this.palette.accent);
    for (let i = 6; i >= 1; i -= 1) {
      g.fillStyle(halo, 0.035 * i);
      g.fillCircle(0, 0, radius * (1 + i * 0.09));
    }
    g.fillStyle(core, 1);
    g.fillCircle(0, 0, radius);
    // One light direction per stop: a lighter crescent on the lit limb.
    g.fillStyle(hexToInt(this.palette.colors[1] ?? this.palette.accent), 0.45);
    g.beginPath();
    g.arc(0, 0, radius, Math.PI * 1.15, Math.PI * 1.85, false);
    g.arc(-radius * 0.22, -radius * 0.1, radius, Math.PI * 1.85, Math.PI * 1.15, true);
    g.closePath();
    g.fillPath();

    const container = this.add.container(width * 0.78, -height * 0.12, [g]);
    container.setDepth(layer("celestial").depth);
    return container;
  }

  /**
   * A silhouette band as a tiling texture: one flat palette colour, drawn as
   * vectors and tiled, so a whole parallax plane costs one draw call
   * (AC-22.9 - the budget is layers, never post-processing).
   */
  private buildBand(
    width: number,
    key: string,
    colour: string,
    alpha: number,
    depth: number,
    scale: number,
    bandHeight: number,
    centreY: number,
  ): Phaser.GameObjects.TileSprite {
    const textureKey = `${key}-${this.cfg.stopId}`;
    if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const tint = hexToInt(colour);
    g.fillStyle(tint, 1);
    const seed = mulberry32(this.cfg.seed + key.length);
    for (let i = 0; i < 9; i += 1) {
      const cx = seed() * 512;
      const cy = seed() * 512;
      const r = 26 + seed() * 78;
      // Drawn nine times, once per wrap offset, so a blob that runs off one
      // edge comes back on the other. Without this the tile seams show as hard
      // rectangles - a repeating straight edge is the one thing a soft
      // silhouette band must never have.
      for (const dx of [-512, 0, 512]) {
        for (const dy of [-512, 0, 512]) {
          g.fillCircle(cx + dx, cy + dy, r);
          g.fillCircle(cx + dx + r * 0.7, cy + dy + r * 0.25, r * 0.7);
        }
      }
    }
    g.generateTexture(textureKey, 512, 512);
    g.destroy();

    const sprite = this.add
      .tileSprite(width / 2, centreY, width + 24, bandHeight, textureKey)
      .setAlpha(alpha)
      .setDepth(depth);
    sprite.setTileScale(scale, scale);
    return sprite;
  }

  private buildShip(width: number, height: number): void {
    const shipX = width / 2;
    const shipY = height - 150;
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

    const debrisColour =
      this.cfg.colorblindPalette
        ? this.palette.colorblind.debris
        : (wordDebrisTypesFor(this.cfg.stopId)[0]?.fill ?? this.palette.accent);

    const shardKey = ensureShardTexture(this, `kb-shard-${this.cfg.stopId}`, debrisColour);
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
        rotate: { start: 0, end: 360 },
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
    if (this.stalled || this.stageComplete) return;
    if (event.data.length === 0) return;
    // performance.now() rather than this.time.now: Phaser's clock is the last
    // frame's timestamp, and stamping a keystroke with it would fold the wait
    // for the next frame into the inter-key intervals the calibration medians
    // are built from. Both clocks are the same origin, so they interleave.
    this.applyLock({ type: "composition", text: event.data, nowMs: performance.now() });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
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
    const world = this.cfg.worldSpeedPxPerSec;
    for (const spec of LAYERS) {
      this.layerOffsets[spec.id] += spec.speed * world * dt;
    }

    const progress = Math.min(1, elapsedMs / this.cfg.stageDurationMs);
    if (Math.abs(progress - this.skyPaintedAt) > 0.004) {
      this.paintSky(progress);
      this.skyPaintedAt = progress;
    }

    this.farField.tilePositionY = -this.layerOffsets.farField;
    this.midField.tilePositionY = -this.layerOffsets.midField;
    this.midField.tilePositionX = idleDriftPx(
      layer("midField"),
      elapsedMs,
      this.cfg.reducedMotion,
    );
    this.nearField.tilePositionY = -this.layerOffsets.nearField;
    this.nearField.tilePositionX = idleDriftPx(
      layer("nearField"),
      elapsedMs,
      this.cfg.reducedMotion,
    );
    this.celestial.y =
      -this.scale.height * 0.12 +
      (this.layerOffsets.celestial % (this.scale.height * 1.5));
  }

  private updateCamera(elapsedMs: number): void {
    const sway = cameraSwayPx(elapsedMs, this.cfg.reducedMotion);
    this.cameras.main.setScroll(sway + this.shakeX, sway * 0.5 + this.shakeY);
  }

  private paintSky(progress: number): void {
    const texture = this.textures.get(this.skyTextureKey);
    const canvas = texture as Phaser.Textures.CanvasTexture;
    const ctx = canvas.getContext();
    const stops = skyAt(this.skyTravel, progress);
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, stops.top);
    gradient.addColorStop(0.45, stops.middle);
    gradient.addColorStop(1, stops.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 8, 512);
    canvas.refresh();
  }

  private updateRocks(now: number): void {
    for (const rock of [...this.rocks]) {
      if (rock.resolved) continue;
      const t = (now - rock.spawnedAtMs) / rock.fallMs;
      rock.container.y = rock.fromY + (rock.toY - rock.fromY) * t;
      rock.container.x =
        rock.homeX + Math.sin(now / 1400 + rock.driftPhase) * 10;
      rock.container.rotation += rock.spinPerSec * (1 / 60);
      if (t >= 1) this.breach(rock, now);
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
    this.spawnRock(outcome.word, now);
    this.nextSpawnAtMs = now + 850;
  }

  private spawnRock(word: string, now: number): void {
    const width = this.scale.width;
    const letters = [...word].length;
    const sizePx = asteroidSizePx(letters);
    const types = wordDebrisTypesFor(this.cfg.stopId);
    const debris = types[this.nextRockIndex % Math.max(1, types.length)] as DebrisType;
    const isCanister =
      this.canisterId === null &&
      maySpawnCanister(this.hull, this.canisterId !== null) &&
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

    const plate = new WordPlate(
      this,
      0,
      plateOffsetY(sizePx, this.plateStyle),
      word,
      this.plateStyle,
    );

    const margin = 160;
    const homeX = margin + this.rng() * (width - margin * 2);
    const container = this.add.container(homeX, -sizePx, [body, plate]);
    this.debrisLayer.add(container);

    const record = recordFor(this.book, word);
    const fallMs = fallTimeMs({
      word,
      ease: record.ease,
      calibration: this.cfg.calibration,
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
      spawnedAtMs: now,
      fallMs,
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
    container.setScale(0.7);
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 260,
      ease: "Back.Out",
    });

    this.applyLock({
      type: "spawn",
      asteroid: { id, word, spawnedAtMs: now },
    });
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
    const points = wordScore([...word].length, this.combo.multiplier);
    this.score += points;
    this.hits += 1;
    this.book = applyToBook(this.book, word, {
      kind: "hit",
      fkLatencyMs,
      ikiMs,
      atMs: nowMs,
      stage: this.cfg.stage,
    });
    this.controller = recordOutcome(this.controller, "blasted");

    if (rock !== undefined) {
      if (rock.isCanister) {
        this.hull = hullAfterShield(this.hull);
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

  private fractureRock(rock: LiveRock, points: number): void {
    rock.resolved = true;
    this.rocks = this.rocks.filter((r) => r.id !== rock.id);

    const quantity = 6 + Math.floor(this.rng() * 5); // 6-10 shards
    this.shards.emitParticleAt(rock.container.x, rock.container.y, quantity);

    rock.plate.dissolveUpward(400);
    const floater = this.add
      .text(rock.container.x, rock.container.y, `+${points}`, {
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
      scale: { from: 1, to: 1.25 },
      alpha: 0,
      duration: 220,
      ease: "Expo.Out",
      onComplete: () => rock.container.destroy(),
    });
  }

  // -------------------------------------------------------------------------
  // Hull
  // -------------------------------------------------------------------------

  /** AC-4.2 / D28: shake + one spark burst + a scorch. No flash, no explosion. */
  private breach(rock: LiveRock, now: number): void {
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
    this.combo = comboReducer(this.combo, "hullHit");
    this.hull = hullAfterStrike(this.hull);

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

    if (this.cfg.reducedMotion) return; // AC-19.3: shake off, gameplay motion kept.
    this.tweens.addCounter({
      from: 6,
      to: 0,
      duration: 120,
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

    this.game.events.emit(FLIGHT_EVENTS.stageComplete, {
      stopId: this.cfg.stopId,
      wpm: this.currentWpm(),
      accuracy: accuracy(this.hits, this.typos),
      hullHits: MAX_HULL - this.hull,
      score: this.score,
      book: this.book,
      knobs: this.controller.knobs,
    });

    const warp = this.scene.get(SCENE_KEYS.warp);
    if (warp !== null) {
      this.scene.stop(SCENE_KEYS.hud);
      this.scene.start(SCENE_KEYS.warp, { stopId: this.cfg.stopId, book: this.book });
    }
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
    this.game.events.emit(FLIGHT_EVENTS.cue, { cue: name, atMs: this.time.now });
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
      maxHull: MAX_HULL,
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
      state: (): FlightDebugState => ({
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
        maxLive: this.controller.knobs.maxLive,
        knobChanges: this.knobChanges,
        rocks: this.rocks.map((r) => ({
          id: r.id,
          word: r.word,
          sizePx: r.sizePx,
          x: r.container.x,
          y: r.container.y,
          plateY: r.container.y + r.plate.y,
          plateTop: r.container.y + r.plate.y - r.plate.plateSizePx.height / 2,
          rockBottom: r.container.y + r.sizePx / 2,
          typedCount: r.plate.typedCount,
          isCanister: r.isCanister,
          debrisType: r.debris.id,
        })),
        layerOffsets: { ...this.layerOffsets },
        skySample: { x: this.scale.width * 0.05, y: this.scale.height * 0.04 },
        bookExposures: Object.values(this.book).reduce(
          (n, r) => n + r.exposures,
          0,
        ),
      }),
      strike: () => {
        if (!this.cfg.debug || this.stalled) return;
        this.controller = recordOutcome(this.controller, "missed");
        this.combo = comboReducer(this.combo, "hullHit");
        this.hull = hullAfterStrike(this.hull);
        this.strike(this.scale.width / 2);
        this.publishHud(true);
        if (isStalled(this.hull)) this.beginStall();
      },
      makeCanister: () => {
        if (!this.cfg.debug) return null;
        const rock = this.rocks[0];
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
      spawn: (word: string) => {
        // Debug only: puts a KNOWN word on the belt so the shared-prefix and
        // parked-word paths (D25, AC-2.2) can be exercised deterministically
        // instead of waiting for the picker to happen to serve the pair.
        if (!this.cfg.debug) return;
        this.spawnRock(word, this.time.now);
      },
    };
  }
}

/** The read-only measurement surface the e2e uses (gated behind `debug`). */
export interface FlightDebugApi {
  state(): FlightDebugState;
  strike(): void;
  makeCanister(): string | null;
  words(): string[];
  spawn(word: string): void;
}

declare global {
  interface Window {
    __kbFlight?: FlightDebugApi;
  }
}
