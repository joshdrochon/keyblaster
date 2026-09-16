import Phaser from "phaser";
import {
  createCoachGate,
  createCoachValidator,
  createMockCoach,
  type CoachClient,
  type CoachRequest,
  type CoachResult,
} from "@engine/coach";
import type { StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { LAYERS, layer, type LayerId } from "@game/render/layers";
import { particleSpec } from "@game/render/particles";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum } from "@game/render/palette";
import { LANTERN_DESIGN_HEIGHT, drawLantern, type LanternRig } from "@game/render/lantern";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { DUR, INK, TYPE } from "@game/ui/theme";
import { hasStageBundle, stageBundle } from "./lib/content";
import { goTo, type StoryInit } from "./lib/init";
import { label, plate, createFocusRing, visibleText, type FocusRing, type SceneSnapshot } from "./lib/kit";
import {
  laneInit,
  latchOnRender,
  publishBag,
  textStyles,
  type DrawLatch,
  type LaneInit,
} from "./support/laneInit";
import { coachAllowlist } from "./support/vocab";
import {
  cells,
  chargeFraction,
  chargePercent,
  createWarpSentence,
  typeChar,
  type WarpSentenceState,
} from "./support/warpSentence";

/**
 * SCREEN 7 - WARP BREAK (design-brief-v2.md "7. Warp break"; D30, D33, D63;
 * PRD FR-16 / AC-16.1, AC-16.2, AC-16.3; FR-15 / AC-15.1..15.4).
 *
 * The brief calls this "the most important five seconds in the game", and the
 * screen is built around exactly that: the belt is cleared, nothing spawns and
 * nothing falls, and the only thing left is to retype the sentence made of the
 * words that were just shot down. It is a victory lap that happens to be
 * practice, so it must feel easy and look calm.
 *
 * AC-16.1  NOTHING SPAWNS OR MOVES. The parallax is built with `worldSpeed: 0`
 *          and with the debris layer left undecorated, so there is no rock in
 *          the scene to move and no spawner that could make one. `update`
 *          samples the debris layer's child count and their positions every
 *          frame, so the e2e asserts the stillness instead of trusting it. The
 *          ambient layers still drift, because rubric item 2 requires an idle
 *          frame to be alive - calm is not frozen.
 * AC-16.2  A typo does not reset the sentence. The rule is in
 *          `support/warpSentence.ts` and has no reset path; all this scene does
 *          with a "retry" event is pop the CURRENT letter, which is the same
 *          letter it was. No shake, no colour change, nothing that reads as a
 *          mark against the player (D31, AC-22b.1).
 * AC-16.3  The meter is driven by `chargeFraction` = index / length, which is
 *          exactly 1 on the final character.
 * AC-15.x  Shadow's note comes from a `CoachClient` this scene cannot inspect.
 *          `MockCoach` is the default (D87: no live paid calls in the build
 *          loop; architecture 10.1b makes the mock the default everywhere but
 *          production). The gate enforces "exactly one call per warp break".
 * AC-33    The coach area is laid out BEFORE the note arrives and does not
 *          change when it does: same plate, same avatar, same speaker label,
 *          same Text object at the same position with the same style and wrap.
 *          NOTHING in this file's render path reads `source`, `failure` or
 *          `transport` - they appear only in the debug bag, for tests.
 *          `tests/e2e/warp.spec.ts` proves it with two real screenshots.
 */

/** art-direction section 8: the stack accelerates x4 over 1.2 s, then cuts. */
const WARP_MULTIPLIER = 4;
const WARP_DURATION_MS = 1200;
/** `flight/stage.ts` DEFAULT_FLIGHT_CONFIG.worldSpeedPxPerSec. x1 is this. */
const FLIGHT_WORLD_SPEED = 110;

/** Layers the break decorates. `debris` is absent on purpose (AC-16.1). */
const CALM_LAYERS: readonly LayerId[] = [
  "sky",
  "celestial",
  "farField",
  "midField",
  "nearField",
];

/** Fixed geometry. The coach area's numbers are AC-33's contract. */
const PANEL = { x: 160, y: 286, w: 1600, h: 250 } as const;
const METER = { x: 160, y: 622, w: 1600, h: 30 } as const;
const COACH = { x: 160, y: 742, w: 1600, h: 236 } as const;

export interface WarpInit extends StoryInit {
  /** Injected transport. Default: MockCoach (D87). */
  readonly coach?: CoachClient;
  /** What the belt produced. Missed words are what Shadow names (AC-15.5). */
  readonly missed?: readonly string[];
  readonly slow?: readonly string[];
  readonly hitRate?: number;
  /** Opaque; handed to Beacon and on to Results untouched. */
  readonly payload?: Record<string, unknown>;
}

export class WarpScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: WarpInit | undefined;
  private stopId: StopId = "mars";

  private parallax!: Parallax;
  private lantern!: LanternRig;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;

  private sentence!: WarpSentenceState;
  private letters: Phaser.GameObjects.Text[] = [];
  private meterFill!: Phaser.GameObjects.Graphics;
  private percentLabel!: Phaser.GameObjects.Text;
  private chargedLabel!: Phaser.GameObjects.Text;
  private noteText!: Phaser.GameObjects.Text;

  private coachResult: CoachResult | null = null;
  private coachSettled = false;
  private coachCalls = 0;

  private multiplier = 0;
  private warping = false;
  /**
   * "Was it drawn", latched on a real render pass (see `latchOnRender`). The
   * Text's own `visible` flag is the truth only while the scene is alive: it
   * reads false again once the cut to Beacon destroys the object, so sampling
   * it is a race nothing can win.
   */
  private chargedDrawn!: DrawLatch;
  private focusRingDrawn!: DrawLatch;
  private debrisCount = 0;
  private debrisSignature = "";
  private debrisMoved = false;

  constructor() {
    super(SCENE_KEYS.warp);
  }

  init(data: WarpInit | undefined): void {
    this.initData = data;
    this.letters = [];
    this.coachResult = null;
    this.coachSettled = false;
    this.coachCalls = 0;
    this.multiplier = 0;
    this.warping = false;
    this.debrisMoved = false;
    this.debrisSignature = "";
  }

  create(): void {
    this.lane = laneInit(this, this.initData, "mars");
    this.stopId = this.lane.stopId;
    const pal = this.lane.palette;

    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: this.lane.reducedMotion,
      // Still. Drift continues (rubric 2); nothing travels (AC-16.1).
      worldSpeed: 0,
      decorate: CALM_LAYERS,
      seed: 0x7a2b,
    });

    const hud = this.parallax.layerOf("hud").container;

    this.lantern = drawLantern(this, 1660, 470, {
      scale: 300 / LANTERN_DESIGN_HEIGHT,
      reducedMotion: this.lane.reducedMotion,
      idleBob: true,
      exhaust: true,
      beam: true,
      iris: 0.15,
    });
    this.parallax.layerOf("shipFx").container.add(this.lantern.container);

    hud.add(this.buildHeader());
    hud.add(this.buildSentencePanel());
    hud.add(this.buildMeter());
    hud.add(this.buildCoachArea());

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    this.ring.moveTo({
      id: "warp-sentence",
      x: PANEL.x,
      y: PANEL.y,
      w: PANEL.w,
      h: PANEL.h,
    });

    this.chargedDrawn = latchOnRender(this, () => this.chargedLabel.visible);
    this.focusRingDrawn = latchOnRender(this, () => this.ring.graphics.visible);

    this.input.keyboard?.addCapture(["TAB", "SPACE", "ENTER"]);
    this.input.keyboard?.on("keydown", this.onKey, this);

    void this.askShadow();
    this.publish();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown", this.onKey, this);
      this.ring.destroy();
      this.shadow.destroy();
      this.lantern.destroy();
      this.parallax.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private buildHeader(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const heading = label(this, 160, 96, this.lane.copy.text("warp.heading"), {
      size: TYPE.heading,
      color: pal.accent,
      lang: this.lane.lang,
    });
    const calm = label(this, 160, 162, this.lane.copy.text("warp.beltClear"), {
      size: TYPE.body,
      color: pal.plateText,
      alpha: 0.82,
      lang: this.lane.lang,
    });
    return [heading, calm];
  }

  private buildSentencePanel(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];

    made.push(
      plate(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h, {
        fill: INK.panel,
        stroke: pal.accent,
      }),
    );
    made.push(
      label(this, PANEL.x + 40, PANEL.y + 24, this.lane.copy.text("warp.prompt"), {
        size: TYPE.label,
        color: pal.plateText,
        alpha: 0.72,
        lang: this.lane.lang,
      }),
    );

    // The sentence is content (D30, D67): it comes from the stage bundle, and
    // the words to highlight are the bundle's own asteroid pool - i.e. exactly
    // the words the player just blasted.
    const bundle = this.stageContent();
    this.sentence = createWarpSentence({
      text: bundle.sentence,
      blasted: bundle.pool,
    });

    made.push(...this.layoutLetters());
    this.paintLetters();

    if (!this.lane.reducedMotion) {
      for (const [i, letter] of this.letters.entries()) {
        const target = letter.alpha;
        letter.setAlpha(0);
        this.tweens.add({
          targets: letter,
          alpha: target,
          duration: DUR.panel,
          delay: 8 * i,
          ease: EASE.pop,
        });
      }
    }

    made.push(
      label(this, PANEL.x + 40, PANEL.y + PANEL.h - 44, this.lane.copy.text("warp.hint"), {
        size: TYPE.caption,
        color: pal.plateText,
        alpha: 0.55,
        lang: this.lane.lang,
      }),
    );
    return made;
  }

  /**
   * The stage bundle's warp sentence and its pool.
   *
   * Earth has no belt and therefore no warp break (D57), so its bundle carries
   * `warpSentence: null`. An empty sentence is already charged, which is the
   * only sane read: it never strands a player on a screen with nothing to type.
   */
  private stageContent(): { sentence: string; pool: readonly string[] } {
    if (!hasStageBundle(this.stopId)) return { sentence: "", pool: [] };
    const bundle = stageBundle(this.stopId);
    return { sentence: bundle.warpSentence ?? "", pool: bundle.pool };
  }

  /**
   * One Text per character, so a letter can light on its own (art direction
   * section 7: typed letters light to the accent, the next letter carries the
   * cue). Wrapped on word boundaries so a word never breaks across lines.
   */
  private layoutLetters(): Phaser.GameObjects.Text[] {
    const left = PANEL.x + 40;
    const top = PANEL.y + 78;
    const maxWidth = PANEL.w - 80;
    const size = 52;
    const pal = this.lane.palette;

    let x = left;
    let y = top;
    const all = cells(this.sentence);
    let i = 0;

    while (i < all.length) {
      let end = i;
      while (end < all.length && all[end]?.char !== " ") end += 1;
      const word = all.slice(i, end);
      const estimate = word.length * size * 0.58;
      if (x > left && x + estimate > left + maxWidth) {
        x = left;
        y += size + 16;
      }
      for (const cell of [...word, ...(end < all.length ? [all[end]] : [])]) {
        if (cell === undefined) continue;
        const t = label(this, x, y, cell.char, {
          size,
          color: pal.plateText,
          lang: this.lane.lang,
        });
        this.letters.push(t);
        x += Math.max(t.width, cell.char === " " ? size * 0.3 : 0);
      }
      i = end + 1;
    }
    return this.letters;
  }

  /**
   * Repaint from state. Three reads and only three: typed letters take the
   * accent, the current letter takes full contrast, the rest are dimmed, with
   * the blasted words held brighter than the filler (D30's highlight). There is
   * no state here for "got this one badly".
   */
  private paintLetters(): void {
    const pal = this.lane.palette;
    const all = cells(this.sentence);
    for (const [i, letter] of this.letters.entries()) {
      const cell = all[i];
      if (cell === undefined) continue;
      if (cell.state === "typed") {
        letter.setColor(pal.accent);
        letter.setAlpha(1);
      } else if (cell.state === "current") {
        letter.setColor(pal.plateText);
        letter.setAlpha(1);
      } else {
        letter.setColor(pal.plateText);
        letter.setAlpha(cell.blasted ? 0.8 : 0.45);
      }
    }
  }

  private buildMeter(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];

    made.push(
      label(this, METER.x, METER.y - 44, this.lane.copy.text("warp.chargeLabel"), {
        size: TYPE.label,
        color: pal.plateText,
        lang: this.lane.lang,
      }),
    );

    this.percentLabel = label(
      this,
      METER.x + METER.w,
      METER.y - 44,
      this.lane.copy.text("warp.chargePercent", { percent: 0 }),
      { size: TYPE.label, color: pal.accent, align: "right", lang: this.lane.lang },
    );
    this.percentLabel.setOrigin(1, 0);
    made.push(this.percentLabel);

    const track = this.add.graphics();
    track.fillStyle(hexToNum(INK.panelSunken), 0.95);
    track.fillRoundedRect(METER.x, METER.y, METER.w, METER.h, METER.h / 2);
    track.lineStyle(2, hexToNum(pal.accent), 0.3);
    track.strokeRoundedRect(METER.x, METER.y, METER.w, METER.h, METER.h / 2);
    made.push(track);

    this.meterFill = this.add.graphics();
    made.push(this.meterFill);
    this.paintMeter();

    this.chargedLabel = label(
      this,
      METER.x,
      METER.y + 44,
      this.lane.copy.text("warp.charged"),
      { size: TYPE.label, color: pal.accent, lang: this.lane.lang },
    );
    this.chargedLabel.setVisible(false);
    made.push(this.chargedLabel);

    return made;
  }

  private paintMeter(): void {
    const f = chargeFraction(this.sentence);
    const inset = 4;
    this.meterFill.clear();
    if (f <= 0) return;
    const w = (METER.w - inset * 2) * f;
    this.meterFill.fillStyle(hexToNum(this.lane.palette.accent), 0.95);
    this.meterFill.fillRoundedRect(
      METER.x + inset,
      METER.y + inset,
      Math.max(METER.h - inset * 2, w),
      METER.h - inset * 2,
      (METER.h - inset * 2) / 2,
    );
    // A soft leading glow, so charging reads as satisfying rather than as a
    // progress bar.
    this.meterFill.fillStyle(hexToNum(this.lane.palette.accent), 0.22);
    this.meterFill.fillCircle(METER.x + inset + w, METER.y + METER.h / 2, METER.h);
  }

  /**
   * AC-33. Every object here is created NOW, with an empty note, and is never
   * created, destroyed, moved or restyled when the result arrives. The only
   * thing that ever changes is the string inside `noteText`.
   */
  private buildCoachArea(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];

    made.push(
      plate(this, COACH.x, COACH.y, COACH.w, COACH.h, {
        fill: INK.panel,
        stroke: INK.line,
        alpha: 1,
      }),
    );

    this.shadow = drawShadow(this, COACH.x + 130, COACH.y + COACH.h / 2, "pointing", {
      scale: 0.72,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("hud").depth,
    });

    made.push(
      label(this, COACH.x + 250, COACH.y + 36, this.lane.copy.text("warp.speaker"), {
        size: TYPE.caption,
        color: pal.accent,
        lang: this.lane.lang,
      }),
    );

    this.noteText = label(this, COACH.x + 250, COACH.y + 76, "", {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: COACH.w - 300,
      lang: this.lane.lang,
    });
    this.noteText.setAlpha(0);
    made.push(this.noteText);

    return made;
  }

  // -------------------------------------------------------------------------
  // Shadow's note
  // -------------------------------------------------------------------------

  private async askShadow(): Promise<void> {
    const lang = this.lane.lang;
    const validator = createCoachValidator({ allowlist: coachAllowlist(lang) });
    const client = this.initData?.coach ?? createMockCoach({ validator });
    const gate = createCoachGate({ client, phase: "warp-break" });

    const request: CoachRequest = {
      stopId: this.stopId,
      lang,
      missed: this.initData?.missed ?? [],
      slow: this.initData?.slow ?? [],
      hitRate: this.initData?.hitRate ?? 1,
    };

    const result = await gate.request(request);
    this.coachCalls = gate.calls;
    if (!this.scene.isActive()) return;
    this.showNote(result);
  }

  /**
   * The ONE place a coach result reaches the screen, and it reads `note` only.
   * D63: the note displays as text with a short chirp, never as live speech.
   */
  private showNote(result: CoachResult): void {
    this.coachResult = result;
    this.noteText.setText(result.note);
    const settle = (): void => {
      this.coachSettled = true;
    };
    if (this.lane.reducedMotion) {
      this.noteText.setAlpha(1);
      settle();
      return;
    }
    this.tweens.add({
      targets: this.noteText,
      alpha: 1,
      duration: DUR.panel,
      ease: EASE.arrive,
      onComplete: settle,
    });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /**
   * Tab moves focus and Enter activates, as everywhere else (AC-18.1). Space is
   * deliberately NOT an activate key here: it is a character of the sentence,
   * and stealing it would make half the warp sentences untypeable. That is why
   * this screen hand-rolls its key handling instead of using
   * `createKeyboardMenu`.
   */
  private onKey(event: KeyboardEvent): void {
    if (this.warping) return;
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      this.ring.moveTo({ id: "warp-sentence", x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h });
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();

    const before = this.sentence;
    this.sentence = typeChar(before, event.key);
    if (this.sentence.lastEvent === "none") return;

    this.paintLetters();
    this.paintMeter();
    this.percentLabel.setText(
      this.lane.copy.text("warp.chargePercent", { percent: chargePercent(this.sentence) }),
    );

    if (this.sentence.lastEvent === "retry") {
      this.askAgain();
      return;
    }
    if (this.sentence.lastEvent === "charged") this.beginWarp();
  }

  /**
   * AC-16.2's visible half. The sentence is untouched; the letter the player is
   * on simply says "here, again" with a scale pop.
   */
  private askAgain(): void {
    const letter = this.letters[this.sentence.index];
    if (letter === undefined) return;
    if (this.lane.reducedMotion) {
      letter.setAlpha(1);
      return;
    }
    letter.setScale(1);
    this.tweens.add({
      targets: letter,
      scale: 1.22,
      duration: 160,
      yoyo: true,
      ease: EASE.pop,
    });
  }

  // -------------------------------------------------------------------------
  // Warp
  // -------------------------------------------------------------------------

  private beginWarp(): void {
    if (this.warping) return;
    this.warping = true;
    this.chargedLabel.setVisible(true);
    this.shadow.setPose("cheering");
    this.lantern.setIris(1);

    // Reduced motion (D41): streaks off, the acceleration itself kept - it is
    // the transition, not framing decoration.
    if (!this.lane.reducedMotion) this.emitStreaks();

    const holder = { m: 1 };
    this.tweens.add({
      targets: holder,
      m: WARP_MULTIPLIER,
      duration: WARP_DURATION_MS,
      ease: EASE.blast,
      onUpdate: () => {
        this.multiplier = holder.m;
        this.parallax.setWorldSpeed(FLIGHT_WORLD_SPEED * holder.m);
      },
      onComplete: () => {
        this.multiplier = WARP_MULTIPLIER;
        this.parallax.setWorldSpeed(FLIGHT_WORLD_SPEED * WARP_MULTIPLIER);
        this.cutToBeacon();
      },
    });
  }

  /**
   * `warpStreaks` in the accent (art direction section 9, AC-22.6). The spec is
   * read from `render/particles.ts` rather than restated, so the three
   * signatures cannot drift. The texture is generated from a vector rectangle
   * at runtime (D83); no raster is loaded.
   */
  private emitStreaks(): void {
    const spec = particleSpec("warpStreaks");
    const key = "kb-warp-streak";
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(0, 0, 4, 48, 2);
      g.generateTexture(key, 4, 48);
      g.destroy();
    }
    const emitter = this.add.particles(0, 0, key, {
      x: { min: 0, max: this.scale.width },
      y: this.scale.height + 60,
      lifespan: { min: spec.lifespanMs[0], max: spec.lifespanMs[1] },
      speed: { min: spec.speed[0], max: spec.speed[1] },
      angle: { min: spec.angle[0], max: spec.angle[1] },
      gravityY: spec.gravityY,
      scaleX: 0.7,
      scaleY: { start: spec.scale[0], end: spec.scale[1], ease: spec.ease },
      quantity: 3,
      frequency: 40,
      tint: hexToNum(this.lane.palette.accent),
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(layer("nearField").depth);
    this.time.delayedCall(WARP_DURATION_MS, () => emitter.stop());
  }

  private cutToBeacon(): void {
    goTo(this, SCENE_KEYS.beacon, {
      ctx: this.lane.ctx,
      progress: this.lane.progress,
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.stopId,
      ...(this.initData?.payload ?? {}),
    } as StoryInit);
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(this.time.now);
    this.sampleDebris();
  }

  /**
   * AC-16.1's evidence. The debris layer is sampled every frame: the scene puts
   * nothing there, so the count stays 0 and `debrisMoved` stays false. Sampling
   * rather than asserting-by-construction is the point - if a future edit spawns
   * something here, the e2e fails instead of the player finding out.
   */
  private sampleDebris(): void {
    const container = this.parallax.layerOf("debris").container;
    const signature = container.list
      .map((child) => {
        const t = child as unknown as { x?: number; y?: number };
        return `${Math.round(t.x ?? 0)},${Math.round(t.y ?? 0)}`;
      })
      .join("|");
    if (this.debrisSignature !== "" && signature !== this.debrisSignature) {
      this.debrisMoved = true;
    }
    this.debrisSignature = signature;
    this.debrisCount = container.list.length;
  }

  // -------------------------------------------------------------------------
  // Debug surface for the e2e suite
  // -------------------------------------------------------------------------

  snapshot(): SceneSnapshot {
    const result = this.coachResult;
    return {
      scene: SCENE_KEYS.warp,
      stopId: this.stopId,
      accent: this.lane.palette.accent,
      reducedMotion: this.lane.reducedMotion,
      sentence: this.sentence.text,
      index: this.sentence.index,
      typos: this.sentence.typos,
      charged: this.sentence.charged,
      lastEvent: this.sentence.lastEvent,
      chargeFraction: chargeFraction(this.sentence),
      chargePercent: chargePercent(this.sentence),
      percentLabel: this.percentLabel.text,
      // Latched on a render pass and never cleared: "the charged line was
      // drawn", which is the claim, rather than "it is drawn right now", which
      // stops being true the moment the warp cuts to Beacon.
      chargedLabelVisible: this.chargedDrawn.drawn,
      highlights: this.sentence.highlights.map(([a, b]) => [a, b]),
      highlightedText: this.sentence.highlights.map(([a, b]) =>
        this.sentence.text.slice(a, b),
      ),
      letters: this.letters.map((l) => ({ char: l.text, color: l.style.color, alpha: l.alpha })),
      debris: { count: this.debrisCount, moved: this.debrisMoved },
      warping: this.warping,
      multiplier: this.multiplier,
      focusId: "warp-sentence",
      focusRingVisible: this.focusRingDrawn.drawn,
      layerSpeeds: Object.fromEntries(
        LAYERS.map((spec) => [spec.id, spec.speed * this.multiplier]),
      ),
      coach: {
        received: result !== null,
        settled: this.coachSettled,
        note: this.noteText.text,
        // TEST-ONLY. Nothing in the render path above reads these three.
        source: result?.source ?? null,
        failure: result?.failure ?? null,
        transport: result?.transport ?? null,
        calls: this.coachCalls,
      },
      coachArea: {
        ...COACH,
        note: {
          x: this.noteText.x,
          y: this.noteText.y,
          alpha: this.noteText.alpha,
          fontSize: this.noteText.style.fontSize,
          color: this.noteText.style.color,
          wrapWidth: this.noteText.style.wordWrapWidth,
          originX: this.noteText.originX,
          originY: this.noteText.originY,
        },
      },
    };
  }

  private publish(): void {
    publishBag("warp", {
      snapshot: () => this.snapshot(),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
      parallaxOffsets: () => this.parallax.debugOffsets(),
      motion: () => this.parallax.debugMotion(),
    });
  }
}
