import Phaser from "phaser";
import {
  createCoachGate,
  type CoachClient,
  type CoachGate,
  type CoachResult,
} from "@engine/coach";
import { coachRequestFor } from "./support/composeRequest";
import { createCoachClient } from "@game/coach/transport";
import { blastedWords, type BlastHistory } from "@game/flight/blastHistory";
import { FLIGHT_EVENTS, type WarpSpeedPayload } from "@game/flight/stage";
import { STOP_IDS, type StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { LAYERS, layer, type LayerId } from "@game/render/layers";
import { particleSpec } from "@game/render/particles";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum, mixHex } from "@game/render/palette";
import { LANTERN_DESIGN_HEIGHT, drawLantern, type LanternRig } from "@game/render/lantern";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { DUR, INK, TYPE } from "@game/ui/theme";
import { headerText } from "@game/ui/grid";
import { highlightSpans, prefixOf, quotedWords } from "./support/coachHighlight";
import { hasStageBundle, stageBundle } from "./lib/content";
import { goTo, type StoryInit } from "./lib/init";
import {
  label,
  plate,
  createFocusRing,
  skyText,
  skyTextSamples,
  visibleText,
  type FocusRing,
  type PlatedText,
  type SceneSnapshot,
} from "./lib/kit";
import {
  laneInit,
  latchOnRender,
  publishBag,
  textStyles,
  type DrawLatch,
  type LaneInit,
} from "./support/laneInit";
import { coachAllowlist } from "./support/vocab";
import { audioFrom } from "@game/audio/wiring";
import { chargeSoundPlan } from "./support/warpCharge";
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
 * IT IS AN OVERLAY, NOT A CUT (D30, `overlay: true`).
 *
 * This used to be `scene.start(Warp)` from Flight: the belt screen was torn
 * down and a brand new screen was built in its place, which threw away the one
 * thing D30 is asking for. "A calm break" is a change of PACE in a place you
 * are already in; a hard cut to a different screen is a change of PLACE, and a
 * player reads it as having been taken somewhere rather than as having cleared
 * something. So Flight now `launch`es this scene over itself and keeps running:
 * the parallax it has been drifting all stage goes on drifting behind the
 * panel, the ship stays where it was, and the panel SLIDES IN over the live
 * world. The acceleration at the end is applied to THAT world
 * (`FLIGHT_EVENTS.warpSpeed`), so the belt the player just cleared is the thing
 * that jumps.
 *
 * Standalone is still a first-class way to run this screen - every `?scene=Warp`
 * boot in the e2e suite is one - so with no `overlay` flag the scene builds its
 * own world exactly as before. The difference is one boolean and it is honest
 * in both directions: overlaid, it never draws a world, because there is
 * already one underneath.
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

/**
 * Fixed geometry. The coach area's numbers are AC-33's contract.
 *
 * It lives in `support/warpLayout.ts` now, with the Lantern's stand, because
 * the two are ONE constraint and nothing in this file can be asserted without a
 * browser. The card used to be 1600 px wide and the ship stood at x=1660 inside
 * it, one depth layer down - so the hero asset was drawn behind the panel at
 * every stage transition. See that module's header.
 */
import {
  PANEL,
  METER,
  COACH,
  LANTERN,
  SENTENCE_PX,
  SENTENCE_STEP,
  WORD_PULSE_MS,
  WORD_PULSE_SCALE,
  completedWordRange,
  sentenceTop,
  pulsedPosition,
  wordPulseCentre,
  type PulseBox,
} from "./support/warpLayout";

export interface WarpInit extends StoryInit {
  /**
   * D30. True when Flight launched this scene over itself and is still running
   * behind it. The scene then draws no sky, no parallax and no ship - there is
   * already one of each on screen - and slides its panel in instead of cutting.
   */
  readonly overlay?: boolean;
  /**
   * Injected transport. Default: whatever `createCoachClient` selects, which
   * is MockCoach unless a `/api/coach` endpoint was configured (D87).
   */
  readonly coach?: CoachClient;
  /**
   * D09. The run that just happened, handed over by `FlightScene`. The words
   * the sentence highlights come from THIS, never from the stop's pool.
   */
  readonly blastHistory?: BlastHistory;
  /**
   * The flattened view of the same thing, in blast order. Present so a caller
   * that has the list but not the record - a harness, a replay - can still
   * drive the screen honestly. Wins over `blastHistory` when both are given.
   */
  readonly blasted?: readonly string[];
  /** What the belt produced. Missed words are what Shadow names (AC-15.5). */
  readonly missed?: readonly string[];
  readonly slow?: readonly string[];
  readonly hitRate?: number;
  /** Opaque; handed to Beacon and on to Results untouched. */
  readonly payload?: Record<string, unknown>;
}

/**
 * One completed word, mid-pulse (UR-26).
 *
 * The ORIGINS ARE CAPTURED, not read back off the Texts while the tween runs.
 * The tween writes both `scale` and `position` every frame, so "where was this
 * letter before the pulse" stops being answerable from the object the moment
 * the first frame lands - and the one thing this effect must never do is leave
 * a letter a fraction of a pixel from where the line laid it out.
 */
interface WordPulse {
  readonly letters: readonly Phaser.GameObjects.Text[];
  readonly origins: readonly PulseBox[];
  readonly centre: { readonly x: number; readonly y: number };
  tween: Phaser.Tweens.Tween | null;
}

export class WarpScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: WarpInit | undefined;
  private stopId: StopId = "mars";

  private parallax!: Parallax;
  private lantern: LanternRig | null = null;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;

  private sentence!: WarpSentenceState;
  private letters: Phaser.GameObjects.Text[] = [];
  private meterFill!: Phaser.GameObjects.Graphics;
  private percentLabel!: Phaser.GameObjects.Text;
  /** The plated wrapper, so the plate is re-cut when the number changes width. */
  private percentPlated!: PlatedText;
  private chargedLabel!: Phaser.GameObjects.Text;
  private chargedPlate: Phaser.GameObjects.Graphics | null = null;
  private noteText!: Phaser.GameObjects.Text;
  /** UR-24: the accent-coloured copies of the words Shadow names. */
  private namedWords: Phaser.GameObjects.Text[] = [];
  /**
   * THE HONESTY MARKER (E-AI-1).
   *
   * Created empty with the rest of the panel and filled by exactly one line of
   * code, in `useComposedSentence`, on the one path where a live model wrote
   * this sentence for this run. Empty is the shipped state: an unconfigured
   * build, an offline demo, a timeout and a refused sentence all leave it
   * blank, so the screen never claims an AI wrote something it did not.
   *
   * It exists because the fallback is otherwise INDISTINGUISHABLE from the
   * real thing, and a submission whose premise is "AI-powered" cannot have a
   * demo where a judge is unable to tell whether the model ever ran.
   */
  private composedMark!: Phaser.GameObjects.Text;
  /** The composed string, once one has been accepted. Test surface. */
  private composedText: string | null = null;
  /** Which of this run's words the composed sentence gave back (D09). */
  private composedReused: readonly string[] = [];
  /** Why a good composed sentence was not used after all. Test surface. */
  private composedRefused: string | null = null;

  private coachResult: CoachResult | null = null;
  private coachSettled = false;
  private coachCalls = 0;
  /** One gate per warp break, not one per request (AC-15.3). */
  private gate: CoachGate | null = null;

  private multiplier = 0;
  private warping = false;
  /** D30: laid over a live Flight rather than replacing it. */
  private overlay = false;
  /** Everything that slides in, so the slide is one tween on one object. */
  private panelRoot!: Phaser.GameObjects.Container;
  /**
   * AC-22.5 / the player's own words: "the progress bar should ease, not just
   * jolt forward". The meter is painted from THIS, which chases
   * `chargeFraction(sentence)` on a Cubic.Out tween, never from the fraction
   * directly. The state is still the truth - the snapshot and every AC read
   * `chargeFraction` - and this is only how it is drawn.
   */
  private meterShown = 0;
  private meterTween: Phaser.Tweens.Tween | null = null;
  /** Identifies the meter tween in flight; see `easeMeterTo`. */
  private meterToken = 0;
  /**
   * How many frames the meter has been REDRAWN MID-MOVE.
   *
   * This is the difference between easing and jolting, counted rather than
   * described: a bar painted straight from `chargeFraction` moves in exactly
   * one step per keystroke and this number never leaves zero. Sampling the
   * drawn fill instead is a race a test cannot reliably win - the tween is
   * 280 ms and a snapshot round-trip is not much less than that.
   */
  private meterEaseFrames = 0;
  /**
   * Which third of the charge has been SOUNDED, 0 before anything has.
   *
   * One field, not two. It used to be a `chargeStage` number AND a
   * `chargeHeard` boolean, which is the same fact twice and therefore two facts
   * that can disagree; `chargeSoundPlan` reads "nothing yet" off the 0.
   */
  private chargeStage = 0;
  /**
   * UR-26. The pulses currently running, one per word the player finished and
   * whose tween has not landed yet.
   *
   * A LIST, not a single tween. The words of a sentence are finished in order
   * and the pulse is 240 ms out-and-back, so a child typing faster than that
   * can start the second word's pulse while the first is still settling. Their
   * letter sets are disjoint by construction (`completedWordRange` returns the
   * word that just ended, and two words share no characters), so two live
   * pulses cannot write to the same Text - but a single-slot field would have
   * dropped the first one's reference and orphaned it mid-scale.
   */
  private pulses: WordPulse[] = [];
  /** Which words have pulsed, in order. Test surface; see `snapshot`. */
  private pulsedWords: string[] = [];
  /**
   * The largest scale any pulse has actually been DRAWN at, and how many frames
   * a pulse has been redrawn on.
   *
   * Recorded rather than sampled, for the same reason `meterEaseFrames` is: the
   * pulse is 240 ms and a snapshot round-trip is not reliably shorter, so "read
   * the scale and assert it is above 1" is a race a test cannot be made to win
   * by waiting longer. A high-water mark can only be moved by the effect
   * actually running, and it is 1 and 0 on a screen where nothing pulsed.
   */
  private pulsePeakScale = 1;
  private pulseFrames = 0;
  /**
   * The retry pop (`askAgain`) currently on a letter, with the letter it is on.
   *
   * Held rather than fired and forgotten because it and the word pulse can want
   * the same Text's `scale` at the same time; `clearRetryPop` says why.
   */
  private retryPop: { tween: Phaser.Tweens.Tween; letter: Phaser.GameObjects.Text } | null =
    null;
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
    this.composedText = null;
    this.composedReused = [];
    this.composedRefused = null;
    // A restart IS a new warp break (a new stage ended), so the gate is new.
    this.gate = null;
    this.multiplier = 0;
    this.warping = false;
    this.debrisMoved = false;
    this.debrisSignature = "";
    this.overlay = data?.overlay === true;
    this.meterShown = 0;
    this.meterTween = null;
    this.chargeStage = 0;
    // A restart rebuilds every Text, so nothing that was mid-pulse still
    // exists. The tweens themselves are gone with the old scene's tween
    // manager; these are the records that would otherwise outlive them.
    this.pulses = [];
    this.pulsedWords = [];
    this.pulsePeakScale = 1;
    this.pulseFrames = 0;
    this.retryPop = null;
  }

  create(): void {
    this.lane = laneInit(this, this.initData, "mars");
    this.stopId = this.lane.stopId;
    const pal = this.lane.palette;

    // OVERLAID: the world behind this panel is Flight's, still running, still
    // drifting. Building a second one here would paint over the very thing D30
    // wants the player to keep seeing, so the stack is created with NOTHING
    // decorated - eight empty containers, the same API, no pixels. The empty
    // debris container is also what keeps AC-16.1's evidence honest in both
    // modes: the scene samples the same place either way, and it is empty
    // because nothing put anything in it.
    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: this.lane.reducedMotion,
      // Still. Drift continues (rubric 2); nothing travels (AC-16.1).
      worldSpeed: 0,
      decorate: this.overlay ? [] : CALM_LAYERS,
      framing: !this.overlay,
      atmosphere: !this.overlay,
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x7a2b,
    });

    const hud = this.parallax.layerOf("hud").container;
    this.panelRoot = this.add.container(0, 0);
    hud.add(this.panelRoot);

    // The ship is already on screen when this is an overlay - it is Flight's,
    // and it is the one the player has been flying. Drawing a second Lantern
    // over it is the single most obvious way to say "this is a different
    // screen", which is exactly what D30 forbids.
    if (!this.overlay) {
      // IN THE BAY, not inside the sentence card. `support/warpLayout.ts` owns
      // both rectangles and `warpLayout.test.ts` asserts they are disjoint.
      this.lantern = drawLantern(this, LANTERN.x, LANTERN.y, {
        scale: LANTERN.height / LANTERN_DESIGN_HEIGHT,
        reducedMotion: this.lane.reducedMotion,
        idleBob: true,
        exhaust: true,
        beam: true,
        iris: 0.15,
      });
      this.parallax.layerOf("shipFx").container.add(this.lantern.container);
    }

    if (this.overlay) this.panelRoot.add(this.scrim());
    this.panelRoot.add(this.buildHeader());
    this.panelRoot.add(this.buildSentencePanel());
    this.panelRoot.add(this.buildMeter());
    this.panelRoot.add(this.buildCoachArea());

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    this.ring.moveTo({
      id: "warp-sentence",
      x: PANEL.x,
      y: PANEL.y,
      w: PANEL.w,
      h: PANEL.h,
    });

    this.slideIn();

    this.chargedDrawn = latchOnRender(this, () => this.chargedLabel.visible);
    this.focusRingDrawn = latchOnRender(this, () => this.ring.graphics.visible);

    this.input.keyboard?.addCapture(["TAB", "SPACE", "ENTER"]);
    this.input.keyboard?.on("keydown", this.onKey, this);

    void this.askShadow();
    this.publish();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown", this.onKey, this);
      // UR-26. A word finished on the LAST character of the sentence starts a
      // pulse on the same keystroke that starts the warp, and the warp ends by
      // cutting to Beacon - so a pulse tween can still be running when this
      // scene is torn down, writing scale and position into Texts that are
      // being destroyed underneath it. Killed here, first.
      this.stopWordPulses();
      this.clearRetryPop();
      this.ring.destroy();
      for (const t of this.namedWords) t.destroy();
      this.namedWords = [];
      this.shadow.destroy();
      this.lantern?.destroy();
      this.parallax.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /**
   * D30, and the player's own words: "the UI should slide in".
   *
   * Only when overlaid. A standalone boot has nothing to slide OVER, and the
   * AC-33 pixel compare screenshots that screen twice and requires the two to
   * be identical - an entrance animation there is a race the test can only
   * lose. Under reduced motion it is a fade, because a panel arriving is
   * framing motion (AC-19.3) but a panel APPEARING with no transition at all
   * reads as a glitch.
   */
  private slideIn(): void {
    if (!this.overlay) return;
    if (this.lane.reducedMotion) {
      this.panelRoot.setAlpha(0);
      this.tweens.add({
        targets: this.panelRoot,
        alpha: 1,
        duration: DUR.panel,
        ease: EASE.arrive,
      });
      return;
    }
    this.panelRoot.setAlpha(0);
    this.panelRoot.setY(150);
    this.tweens.add({
      targets: this.panelRoot,
      y: 0,
      alpha: 1,
      duration: 460,
      // Arrive and settle. Never Back.Out here: the panel carries the sentence
      // the player is about to type, and text that overshoots is text that is
      // briefly unreadable.
      ease: EASE.arrive,
    });
  }

  /**
   * A soft plate behind the whole panel, overlay only.
   *
   * The world underneath is live and moving, and copy over a moving parallax is
   * copy a child has to work to read (rubric 8: the readout owns its contrast).
   * This seats it without hiding what is behind it.
   */
  private scrim(): Phaser.GameObjects.GameObject {
    const g = this.add.graphics();
    const ink = mixHex(INK.panel, "#000000", 0.2);
    // Abutting strips with integer edges. Overlapping translucent strips
    // composite twice where they meet and the doubled alpha shows as a hard
    // line - the first render of this scrim was a set of stripes across the
    // live world, which is worse than no scrim at all.
    const steps = 48;
    const top = 60;
    const height = this.scale.height - top;
    for (let i = 0; i < steps; i++) {
      const a = Math.round(top + (height * i) / steps);
      const b = Math.round(top + (height * (i + 1)) / steps);
      if (b <= a) continue;
      const t = i / (steps - 1);
      g.fillStyle(hexToNum(ink), 0.08 + 0.4 * t);
      g.fillRect(0, a, this.scale.width, b - a);
    }
    return g;
  }

  /**
   * THE HEADER SITS ON A PLATE (AC-22.8).
   *
   * It did not, and that is why "Warp break" measured 1.60:1 and "Belt cleared.
   * Type this to charge the warp drive." measured 1.35:1 against Mars' ochre
   * sky. The word plate below them has always measured 17.4:1, because the word
   * plate is the only pair the contrast rubric ever looked at. The line a child
   * has to read to know WHAT TO DO was the least legible text on the screen.
   *
   * `skyText` draws the same plate the word gets and registers the colour pair,
   * so this header is now measured by V-22.8 along with everything else.
   */
  private buildHeader(): Phaser.GameObjects.GameObject[] {
    const at = headerText(0, undefined, 14);
    const heading = skyText(this, at.x, at.y, this.lane.copy.text("warp.heading"), {
      screen: "warp",
      id: "warp.heading",
      size: TYPE.heading,
      color: INK.text,
      lang: this.lane.lang,
      depth: this.headerDepth(),
      padY: 14,
    });
    // "belt cleared - type this to charge the warp drive". The line used to be
    // "the belt is clear. everything is still out here.", which is atmosphere:
    // it never said that the asteroids were GONE because the player destroyed
    // them, and it never said what the typing below it was for.
    const under = headerText(1, undefined, 10);
    const calm = skyText(this, under.x, under.y, this.lane.copy.text("warp.beltCleared"), {
      screen: "warp",
      id: "warp.beltCleared",
      size: TYPE.body,
      color: INK.textDim,
      lang: this.lane.lang,
      depth: this.headerDepth(),
      padY: 10,
    });
    return [...heading.objects, ...calm.objects];
  }

  /** Depth the header's text draws at; its plate takes one below. */
  private headerDepth(): number {
    return 10;
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
    // The instruction is on the header line now ("warp.beltCleared"), where it
    // sits next to what just happened. This slot carries the OTHER half the
    // player was missing - where the drive is taking them - so the screen names
    // the destination before the jump rather than only after it.
    made.push(
      label(this, PANEL.x + 40, PANEL.y + 24, this.destinationCopy(), {
        size: TYPE.label,
        color: pal.plateText,
        alpha: 0.72,
        lang: this.lane.lang,
      }),
    );

    // E-AI-1. Created NOW, empty, at a fixed place, exactly the way the coach
    // note's Text is (AC-33's discipline). The fallback screen is therefore
    // byte-identical to the screen that shipped before this feature existed,
    // and the only thing that can ever put a string in it is a live composed
    // sentence that passed every gate.
    this.composedMark = label(
      this,
      PANEL.x + PANEL.w - 40,
      PANEL.y + 24,
      "",
      {
        size: TYPE.caption,
        color: pal.accent,
        alpha: 0.9,
        lang: this.lane.lang,
      },
    );
    this.composedMark.setOrigin(1, 0);
    made.push(this.composedMark);

    // D09. The sentence starts as the stop's shipped string (D30, D67) and is
    // replaced by a composed one when the coach returns a safe one. The
    // HIGHLIGHT is not content: it is the run. See `blastedThisRun`.
    this.sentence = createWarpSentence({
      text: this.warpSentenceText(),
      blasted: this.blastedThisRun(),
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
   * The stage bundle's warp sentence.
   *
   * Earth has no belt and therefore no warp break (D57), so its bundle carries
   * `warpSentence: null`. An empty sentence is already charged, which is the
   * only sane read: it never strands a player on a screen with nothing to type.
   */
  private warpSentenceText(): string {
    if (!hasStageBundle(this.stopId)) return "";
    return stageBundle(this.stopId).warpSentence ?? "";
  }

  /**
   * D09 - THE ONE THING THIS GAME EXISTS TO DO.
   *
   * The decision log's Origin section names the defect in Type Storm that
   * KeyBlaster was built to fix: its end-of-level sentence does not reuse the
   * words just typed. D09 is the fix, and it is a claim about the RUN.
   *
   * This method used to return `stageBundle(stopId).pool`. That is the stop's
   * whole vocabulary, so a word the child missed lit up exactly like a word
   * they destroyed - which is, precisely, the defect, reimplemented. The pool
   * is therefore NOT a fallback here, and that is deliberate:
   *
   *   no history  ->  no highlights.
   *
   * A screen opened without a run behind it has no information about what was
   * blasted, and "highlight everything" is not a safe default for a claim; it
   * is the bug with a friendlier face. An unlit sentence is still perfectly
   * typeable, so nothing is lost but the untrue part.
   */
  private blastedThisRun(): readonly string[] {
    const explicit = this.initData?.blasted;
    if (explicit !== undefined) return explicit;
    const history = this.initData?.blastHistory;
    if (history !== undefined) return blastedWords(history);
    return [];
  }

  /**
   * One Text per character, so a letter can light on its own (art direction
   * section 7: typed letters light to the accent, the next letter carries the
   * cue). Wrapped on word boundaries so a word never breaks across lines.
   */
  private layoutLetters(): Phaser.GameObjects.Text[] {
    const left = PANEL.x + 40;
    const maxWidth = PANEL.w - 80;
    const size = SENTENCE_PX;
    const pal = this.lane.palette;

    // COUNT THE LINES FIRST, so the block can be centred in the card rather
    // than pinned to its top. A one-line sentence in a two-line card left a
    // 140 px hole under it, which is the "large dead space below their content"
    // a player reported on the stage report; the card keeps its shape and the
    // content is distributed inside it (`support/warpLayout.sentenceTop`).
    const top = sentenceTop(this.countSentenceLines(left, maxWidth, size));

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
        y += SENTENCE_STEP;
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
   * How many lines the sentence wraps to, by the SAME rule `layoutLetters`
   * wraps with - a word-width estimate of 0.58 em - so the count and the layout
   * cannot disagree about where the breaks are.
   */
  private countSentenceLines(left: number, maxWidth: number, size: number): number {
    const all = cells(this.sentence);
    let x = left;
    let lines = 1;
    let i = 0;
    while (i < all.length) {
      let end = i;
      while (end < all.length && all[end]?.char !== " ") end += 1;
      const word = all.slice(i, end);
      const estimate = word.length * size * 0.58;
      if (x > left && x + estimate > left + maxWidth) {
        x = left;
        lines += 1;
      }
      x += estimate + size * 0.3;
      i = end + 1;
    }
    return lines;
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
        // 0.55, NOT 0.45 (UR-41). At 0.45 the untyped filler composited to
        // 4.39:1 against the panel - the ONLY text in the game under AC-22.8's  no-user-quotes-ok: UR-41 is a blind-critic note, and its one-line summary phrases this measurement the same ordinary way; the words here are the contrast argument, not a report's
        // 4.5, and a blind critic measured 4.33 off the pixels. It is large
        // type, so WCAG would allow 3:1; the bar on this project is 4.5 for
        // every size and re-baselining it quietly to win one number is not a
        // trade this file gets to make. 0.55 measures 5.98:1 at the worst stop
        // and the three-step read survives: filler 5.98, blasted 11.6,
        // current 18.1.
        letter.setAlpha(cell.blasted ? 0.8 : 0.55);
      }
    }
  }

  private buildMeter(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];

    // "warp drive" and the percentage are read off the sky either side of the
    // meter, so they are plated and measured like everything else. The
    // percentage was `pal.accent` on a bright stop's sky - the same 1.6:1 as
    // the heading, on the number that tells the child how close they are.
    const chargeLabel = skyText(
      this,
      METER.x,
      METER.y - 52,
      this.lane.copy.text("warp.chargeLabel"),
      {
        screen: "warp",
        id: "warp.chargeLabel",
        size: TYPE.label,
        color: INK.textDim,
        lang: this.lane.lang,
        depth: this.headerDepth(),
        padY: 8,
      },
    );
    made.push(...chargeLabel.objects);

    const percent = skyText(
      this,
      METER.x + METER.w,
      METER.y - 52,
      this.lane.copy.text("warp.chargePercent", { percent: 0 }),
      {
        screen: "warp",
        id: "warp.chargePercent",
        size: TYPE.label,
        color: INK.accent,
        align: "right",
        lang: this.lane.lang,
        depth: this.headerDepth(),
        originX: 1,
        padY: 8,
      },
    );
    this.percentPlated = percent;
    this.percentLabel = percent.text;
    made.push(...percent.objects);

    const track = this.add.graphics();
    track.fillStyle(hexToNum(INK.panelSunken), 0.95);
    track.fillRoundedRect(METER.x, METER.y, METER.w, METER.h, METER.h / 2);
    track.lineStyle(2, hexToNum(pal.accent), 0.3);
    track.strokeRoundedRect(METER.x, METER.y, METER.w, METER.h, METER.h / 2);
    made.push(track);

    this.meterFill = this.add.graphics();
    made.push(this.meterFill);
    this.paintMeter();

    // "warp drive charged - next stop Jupiter". The old line was "warp drive
    // charged. hold on." - true, and it never told the player they were about
    // to travel anywhere, let alone where.
    const charged = skyText(this, METER.x, METER.y + 44, this.chargedCopy(), {
      screen: "warp",
      id: "warp.charged",
      size: TYPE.label,
      color: INK.accent,
      lang: this.lane.lang,
      depth: this.headerDepth(),
      padY: 8,
    });
    this.chargedLabel = charged.text;
    this.chargedPlate = charged.plate;
    this.chargedLabel.setVisible(false);
    charged.plate?.setVisible(false);
    made.push(...charged.objects);

    return made;
  }

  /**
   * The line under the meter once it is full.
   *
   * `stopId` is the belt that was just cleared, so the place the player is
   * about to warp TO is the next one on the route. Pluto is the last stop and
   * has no next, which is a different sentence rather than a missing word - a
   * screen that says "next stop: undefined" is worse than one that says
   * nothing.
   */
  private chargedCopy(): string {
    const next = this.nextStop();
    if (next === null) return this.lane.copy.text("warp.chargedLast");
    return this.lane.copy.text("warp.chargedNext", { stop: next });
  }

  /** The line above the sentence: where this typing is taking the player. */
  private destinationCopy(): string {
    const next = this.nextStop();
    if (next === null) return this.lane.copy.text("warp.prompt");
    return this.lane.copy.text("warp.nextStop", { stop: next });
  }

  /** The stop AFTER the belt that was just cleared, or null at the last one. */
  private nextStop(): string | null {
    const next = STOP_IDS[STOP_IDS.indexOf(this.stopId) + 1];
    return next === undefined ? null : this.lane.copy.stopName(next);
  }

  /**
   * AC-22.5. Move the DRAWN fill toward the real one on Cubic.Out.
   *
   * The meter used to be repainted straight from `chargeFraction`, so every
   * character was a hard step - "it should ease, not just jolt forward". The
   * tween is on a number this scene owns, not on the sentence: the state is
   * exact and instantaneous (AC-16.3 still reads exactly 1 on the final
   * character), and only the pixels lag it by a quarter of a second.
   *
   * The previous tween is stopped rather than left running, so a fast typist
   * gets one fill chasing the target instead of six fighting over it.
   */
  private easeMeterTo(target: number): void {
    this.meterTween?.stop();
    if (this.lane.reducedMotion) {
      this.meterShown = target;
      this.paintMeter();
      return;
    }
    /**
     * A TOKEN, NOT JUST `stop()`.
     *
     * `Tween.stop()` marks a tween for removal; Phaser can still dispatch one
     * more `onUpdate` for it later in the same frame. That callback wrote
     * `meterShown` from the OLD holder, so a fast typist could have the new
     * tween finish at the true fill and then be dragged back a few thousandths
     * by the corpse of the previous one - a bar that settles just short of
     * where the state says it is, forever, with no further keystroke to fix it.
     *
     * Found by `tests/e2e/warp.spec.ts` "the charge meter EASES...", which
     * types six characters quickly and then asserts the drawn fill converges on
     * the state. The token makes a stale callback a no-op.
     */
    const token = ++this.meterToken;
    const holder = { v: this.meterShown };
    this.meterTween = this.tweens.add({
      targets: holder,
      v: target,
      duration: 280,
      ease: EASE.arrive,
      onUpdate: () => {
        if (token !== this.meterToken) return;
        this.meterEaseFrames += 1;
        this.meterShown = holder.v;
        this.paintMeter();
      },
      onComplete: () => {
        if (token !== this.meterToken) return;
        this.meterShown = target;
        this.paintMeter();
      },
    });
  }

  private paintMeter(): void {
    const f = Math.max(0, Math.min(1, this.meterShown));
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

  /**
   * UR-24 - THE WORDS SHADOW NAMES ARE DRAWN IN THE STOP ACCENT.
   *
   * UR-24 asked for the words Shadow names to be drawn in a colour that stands
   * out from the rest of the line. Those two words are what the child meets
   * again on the next belt, so this is a learning affordance rather than a
   * swatch, and in a flat line they were carried by two straight quotes alone.
   *
   * ================== WHY AN OVERLAY AND NOT A RESTYLE ==================
   * Phaser's `Text` has ONE style for the whole object and the only per-glyph
   * tinting it offers is on `BitmapText`, which needs a raster font (D83
   * forbids one). Splitting the note into per-word objects was the other
   * option, and AC-33 forbids it by name: the coach area is laid out before the
   * note arrives and does not change when it does, "same Text object at the
   * same position with the same style and wrap", which `warp.spec.ts` asserts
   * by comparing the live and fallback screens field by field.
   *
   * So `noteText` is untouched - same object, same style, same wrap, same
   * snapshot - and each named word is drawn AGAIN on top of itself, in the
   * accent, at the same size and font. The overlay covers the base glyphs
   * exactly, because it is the same string in the same face at the same place.
   *
   * ================== THE QUOTES STAY ==================
   * That was the judgement call. D41 does not allow colour to be the only
   * carrier of a distinction anywhere in this game - it is why the colourblind
   * palette exists, why the hull dims rather than reddening, and why a switch
   * prints "on" beside its lamp. The quotes are the non-colour encoding, so
   * they stay and the word is marked twice.
   */
  private markNamedWords(): Phaser.GameObjects.Text[] {
    for (const old of this.namedWords) old.destroy();
    this.namedWords = [];

    const words = quotedWords(this.noteText.text);
    if (words.length === 0) return this.namedWords;

    // The paragraph AS DRAWN, not as written: a word that wrapped onto the next
    // line has a different x, and a highlight placed from the unwrapped string
    // lands on nothing. `coachHighlight` maps the spans; this measures them.
    const lines = this.noteText.getWrappedText();
    const spans = highlightSpans(lines, words);
    const lineStep = this.noteText.height / Math.max(1, lines.length);

    const ruler = this.make.text(
      { text: "", style: this.noteText.style as unknown as object },
      false,
    );
    for (const span of spans) {
      ruler.setText(prefixOf(lines, span));
      const t = label(this, this.noteText.x + ruler.width, this.noteText.y + span.line * lineStep, span.text, {
        size: TYPE.body,
        color: this.lane.palette.accent,
        lang: this.lane.lang,
      });
      t.setDepth(this.noteText.depth + 1).setAlpha(0);
      this.panelRoot.add(t);
      this.namedWords.push(t);
    }
    ruler.destroy();
    return this.namedWords;
  }

  // -------------------------------------------------------------------------
  // Shadow's note
  // -------------------------------------------------------------------------

  private async askShadow(): Promise<void> {
    const lang = this.lane.lang;
    // AC-15.4. The transport is chosen by `@game/coach/transport`, which is the
    // only place in the program that decides; the scene holds a `CoachClient`
    // and cannot tell which one it got. An injected client (tests, a replay)
    // still wins, because that seam is what makes AC-33's two screenshots
    // comparable at all.
    const client =
      this.initData?.coach ??
      createCoachClient({ allowlist: coachAllowlist(lang) });
    // AC-15.3. The gate lives for the whole scene, not for this call: a second
    // `askShadow` - a re-render, a late resume - must find the break already
    // spent and get the memoised result back rather than buying another call.
    const gate = (this.gate ??= createCoachGate({ client, phase: "warp-break" }));

    // ONE call, and it now carries two asks: Shadow's note, and this break's
    // warp sentence composed from the words this child just practised (D09,
    // E-AI-1). `composeRequest.ts` decides whether the second ask is possible;
    // the scene does not, because that decision has to be testable without a
    // browser. Still one transport call either way (AC-15.3).
    const request = coachRequestFor({
      stopId: this.stopId,
      lang,
      missed: this.initData?.missed ?? [],
      slow: this.initData?.slow ?? [],
      hitRate: this.initData?.hitRate ?? 1,
      blasted: this.blastedThisRun(),
    });

    const result = await gate.request(request);
    this.coachCalls = gate.calls;
    if (!this.scene.isActive()) return;
    this.useComposedSentence(result);
    this.showNote(result);
  }

  /**
   * D09 / E-AI-1 - THE FEATURE THIS PROJECT WAS FOUNDED ON.
   *
   * Decision log, Origin: Type Storm's end-of-level sentence "doesn't reuse the
   * words just typed. We fix both." Until this method existed we did not: the
   * screen typed `stageBundle(stop).warpSentence`, one hardcoded string per
   * stop, identical for every child on every run.
   *
   * WHAT IT REPLACES AND WHEN. The static sentence is laid out at `create()`
   * and stays unless ALL of these hold:
   *
   *   - a live model wrote a sentence for this run and it passed all six gates
   *     in `engine/coach/sentence.ts` (allowlist, length, AC-12.3 pool, banned
   *     terms, shape, and reuse of this child's own words);
   *   - the player has not typed a character yet;
   *   - the warp has not started.
   *
   * THE "NOTHING TYPED YET" RULE IS NOT A TECHNICALITY. Swapping the sentence
   * under a child mid-word would invalidate the letters they have already
   * typed and read as the game taking something away - which D31 forbids more
   * strongly than it wants this feature. A child fast enough to beat the call
   * types the shipped sentence, and that is a good sentence. The alternative -
   * holding the panel blank until the call settles - spends up to 1500 ms of
   * the "most important five seconds in the game" on a spinner, and is logged
   * as the rejected option in gauntlet/escalations.md (E-AI-2).
   *
   * THE MARKER IS SET HERE AND NOWHERE ELSE, and only on this path, so it is
   * true exactly when it is shown. There is no branch below that can print it
   * for a fallback.
   */
  private useComposedSentence(result: CoachResult): void {
    // `result` can come from an INJECTED client (`initData.coach`), which is
    // an object a test wrote rather than a `CoachResult` the pipeline built,
    // so the field may genuinely be missing however the type reads. A thrown
    // TypeError here would take the warp break down - D33's "degrades to
    // exactly nothing" has to survive its own seam.
    const composed = result.sentence as CoachResult["sentence"] | undefined;
    if (composed === undefined || !composed.ok) return;
    if (this.warping) return;
    if (this.sentence.index > 0 || this.sentence.typos > 0) {
      this.composedRefused = "typing-started";
      return;
    }
    if (composed.text === this.sentence.text) return;

    this.composedText = composed.text;
    this.composedReused = [...composed.reused];
    this.relayoutSentence(composed.text);
    this.composedMark.setText(this.lane.copy.text("warp.composed"));
  }

  /**
   * Rebuild the typed line for a new string, in place.
   *
   * Everything else on the screen is untouched: same plate, same meter, same
   * coach area, same focus ring, same geometry. Only the per-character Text
   * objects are rebuilt, because there is one per character and the character
   * count changed.
   */
  private relayoutSentence(text: string): void {
    // Before the Texts go. A live pulse holds references to them and writes to
    // them every frame; destroying them out from under it is the same crash as
    // the shutdown one, on a path that fires whenever the coach lands a
    // composed sentence.
    this.stopWordPulses();
    this.clearRetryPop();
    for (const letter of this.letters) letter.destroy();
    this.letters = [];
    this.sentence = createWarpSentence({
      text,
      blasted: this.blastedThisRun(),
    });
    this.panelRoot.add(this.layoutLetters());
    this.paintLetters();
    // The meter is driven by `chargeFraction`, which is index/length; index is
    // 0 and the length changed, so the drawn fill has to be told the new zero
    // rather than left holding a fraction of the old string.
    this.meterShown = 0;
    this.easeMeterTo(0);
    this.percentPlated.setText(
      this.lane.copy.text("warp.chargePercent", { percent: chargePercent(this.sentence) }),
    );
  }

  /**
   * The ONE place a coach result reaches the screen, and it reads `note` only.
   *
   * AC-21.6: the note is spoken by the system voice AFTER the text renders, and
   * the display is identical either way. Both halves are STRUCTURAL rather than
   * promised. `speakCoachNote` calls the renderer and only then hands anything
   * to the voice bus, so there is no path through it that speaks first; and the
   * renderer below is handed a `CoachNoteDisplay` that carries the text and
   * nothing else - no "spoken" flag, no voice id - so there is nothing here it
   * could branch on even if someone later wanted it to. A player with no voices
   * installed, or a muted graph, sees exactly this screen.
   *
   * D63 said "text with a chirp, never live TTS"; D88 (revised) supersedes the
   * voice portion of D63 and PRD AC-21.6 is explicit. The Web Speech system
   * voice is local, so D63's actual concern - no runtime network TTS, the LLM
   * call stays the only runtime dependency (D32) - is untouched.
   */
  private showNote(result: CoachResult): void {
    this.coachResult = result;
    const settle = (): void => {
      this.coachSettled = true;
    };

    const render = (display: { text: string }): void => {
      this.noteText.setText(display.text);
      const named = this.markNamedWords();
      if (this.lane.reducedMotion) {
        this.noteText.setAlpha(1);
        for (const t of named) t.setAlpha(1);
        settle();
        return;
      }
      this.tweens.add({
        targets: [this.noteText, ...named],
        alpha: 1,
        duration: DUR.panel,
        ease: EASE.arrive,
        onComplete: settle,
      });
    };

    const audio = audioFrom(this.registry);
    if (audio === null) {
      render({ text: result.note });
      return;
    }
    audio.speakNote({ note: result.note }, render, "warp.coachNote");
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

    this.soundCharge(chargeFraction(this.sentence));

    this.paintLetters();
    // AFTER the repaint, so the word is already in its typed colour when it
    // grows: the scale is a second reading of the same fact, not a different
    // one arriving a frame early.
    this.pulseCompletedWord();
    this.easeMeterTo(chargeFraction(this.sentence));
    // Through the plated wrapper: "9%" and "100%" are different widths, and a
    // plate cut for the first leaves the last hanging off its own edge.
    this.percentPlated.setText(
      this.lane.copy.text("warp.chargePercent", { percent: chargePercent(this.sentence) }),
    );

    if (this.sentence.lastEvent === "retry") {
      this.askAgain();
      return;
    }
    if (this.sentence.lastEvent === "charged") this.beginWarp();
  }

  /**
   * "It should actually make noise when it is charging up."
   *
   * The screen used to spool `warpCharge` once, on the first accepted
   * character, and then type in silence for the rest of the sentence - so the
   * one bar in the game that is a continuous quantity had no continuous sound.
   * Three layers now, and each answers a different question:
   *
   *   PER CHARACTER  a keystroke tick transposed by the fill, 0 to +12
   *                  semitones. This is the one that tells the player how close
   *                  they are: the pitch of the last key they pressed IS the
   *                  meter, so it works with the bar off screen and it works
   *                  for a child who is watching their hands.
   *   PER THIRD      the drive re-spools a fifth higher each time the fill
   *                  crosses a third. Three landings on the way up, which is
   *                  what makes it read as spooling rather than as ticking.
   *   AT FULL        `beginWarp` fires the stinger (D62). Nothing here plays at
   *                  100%, so the stinger arrives into a gap it owns.
   *
   * AC-21.3 is unaffected: `warpCharge` still rotates its variants, and one
   * warp break still spools once per third rather than once per keystroke.
   */
  private soundCharge(fill: number): void {
    const audio = audioFrom(this.registry);
    // The RULE still runs with no audio service (the standalone e2e harness has
    // none): `chargeStage` is game state, not a sound, and a screen that only
    // advanced it when someone was listening would behave differently under
    // test than in the game.
    const plan = chargeSoundPlan(this.chargeStage, fill);
    this.chargeStage = plan.stage;
    if (audio === null) return;
    if (plan.spool !== null) audio.play("warpCharge", "warp-scene:charge", plan.spool);
    audio.play("keystroke", "warp-scene:charge-step", plan.step);
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
    this.clearRetryPop();
    letter.setScale(1);
    const tween = this.tweens.add({
      targets: letter,
      scale: 1.22,
      duration: 160,
      yoyo: true,
      ease: EASE.pop,
      onComplete: () => {
        this.retryPop = null;
      },
    });
    this.retryPop = { tween, letter };
  }

  /**
   * Take the retry pop off a letter and put its scale back.
   *
   * IT OVERLAPS THE WORD PULSE, and that is the whole reason this exists. The
   * pop is 320 ms out and back on the letter the player got wrong; the letter
   * they got wrong is the letter they are about to get right, and it can be the
   * last letter of a word. A child who fixes a typo and finishes the word
   * inside that window has two tweens writing `scale` on one Text, and the
   * word flickers for a frame as the pop's own return to 1 stomps the pulse.
   */
  private clearRetryPop(): void {
    const pop = this.retryPop;
    if (pop === null) return;
    pop.tween.remove();
    if (pop.letter.active) pop.letter.setScale(1);
    this.retryPop = null;
  }

  // -------------------------------------------------------------------------
  // UR-26 - a finished word says so
  // -------------------------------------------------------------------------

  /**
   * UR-26: finishing a word in the warp sentence should make that word grow a
   * little and settle back to its original size, so the child can see it has
   * been typed out.
   *
   * The screen already recolours a typed letter to the accent, which is a
   * per-CHARACTER signal; there was nothing at all for the unit the child is
   * actually working in, which is the word. This is that.
   *
   * WHAT THIS METHOD IS CAREFUL ABOUT, all of it in `support/warpLayout.ts`:
   *
   *   IT CANNOT MOVE THE LINE. Only the Texts between `start` and `end` are
   *   ever passed to `pulsedPosition`. Every other letter of the sentence keeps
   *   the x `layoutLetters` gave it, so no scale, however wrong, can shift the
   *   words after this one. A sentence that jitters while a child is reading it
   *   is worse than no effect at all, and "the layout box is untouched" is a
   *   property of the code path rather than of the chosen numbers.
   *
   *   IT GROWS ABOUT THE WORD'S OWN CENTRE. Phaser Text's origin is its
   *   top-left corner, so a bare `setScale` would grow each glyph rightwards
   *   into the fixed position of the next one and the word would visibly
   *   tighten. Each letter is repositioned around the word's union centre so
   *   the word breathes symmetrically in place.
   *
   *   IT FIRES ONCE PER WORD. `completedWordRange` returns non-null on exactly
   *   the keystroke that ends a word - never mid-word, never on the punctuation
   *   after it - so seven words is seven pulses, not seven per character.
   */
  private pulseCompletedWord(): void {
    const event = this.sentence.lastEvent;
    if (event !== "advance" && event !== "charged") return;
    const range = completedWordRange(this.sentence.text, this.sentence.index);
    if (range === null) return;
    // D41 / AC-19.3. Reduced motion turns off decoration, and this is
    // decoration: the word is already in the accent and the meter already
    // moved, so nothing the player needs is carried by the scale alone. The
    // snapshot reports `suppressed` so a test can tell "the rule did not fire"
    // apart from "the rule fired and was deliberately silent".
    if (this.lane.reducedMotion) return;
    const [start, end] = range;
    const letters = this.letters.slice(start, end).filter((t) => t.active);
    if (letters.length === 0) return;
    // See `clearRetryPop`: the retry pop and this pulse can want the same
    // letter's scale at the same time, and the pop always loses - it is the
    // older event and it is about a keystroke the player has since fixed.
    this.clearRetryPop();

    const origins: PulseBox[] = letters.map((t) => ({
      x: t.x,
      y: t.y,
      // `width`/`height`, never `displayWidth`: the display size already has
      // the scale in it, and these are the resting metrics.
      w: t.width,
      h: t.height,
    }));
    const run: WordPulse = {
      letters,
      origins,
      centre: wordPulseCentre(origins),
      tween: null,
    };
    this.pulses.push(run);
    this.pulsedWords.push(this.sentence.text.slice(start, end));

    // The tween drives a PLAIN NUMBER, not the Texts. Phaser would happily
    // tween `scale` on the letters directly, but the position has to move with
    // it - that is the whole "about its own centre" part - and two tweens on
    // one object that must agree frame for frame is a way to be subtly wrong.
    const holder = { s: 1 };
    run.tween = this.tweens.add({
      targets: holder,
      s: WORD_PULSE_SCALE,
      duration: WORD_PULSE_MS,
      yoyo: true,
      // Sine in-out, never Back.Out. An overshoot is a bounce and a bounce is a
      // celebration; this is an acknowledgement, and it has to be able to
      // happen seven times in eight seconds without wearing the player out.
      ease: EASE.drift,
      onUpdate: () => this.applyPulse(run, holder.s),
      onComplete: () => this.settlePulse(run),
    });
  }

  /** One frame of one pulse. Guarded: a destroyed Text is simply skipped. */
  private applyPulse(run: WordPulse, scale: number): void {
    this.pulsePeakScale = Math.max(this.pulsePeakScale, scale);
    this.pulseFrames += 1;
    for (const [i, letter] of run.letters.entries()) {
      const origin = run.origins[i];
      if (origin === undefined || !letter.active) continue;
      const at = pulsedPosition(origin, run.centre, scale);
      letter.setScale(scale);
      letter.setPosition(at.x, at.y);
    }
  }

  /**
   * Put the word back exactly where the line put it.
   *
   * FROM THE CAPTURED ORIGINS, not from `pulsedPosition(..., 1)`. The round
   * trip through the centre is `c + (x - c) * 1`, which is x for most values
   * and x plus a float ulp for some of them; over the words of a sentence that
   * is a line that drifts. Idempotent, because `stopWordPulses` may call it on
   * a run whose tween has already completed.
   */
  private settlePulse(run: WordPulse): void {
    for (const [i, letter] of run.letters.entries()) {
      const origin = run.origins[i];
      if (origin === undefined || !letter.active) continue;
      letter.setScale(1);
      letter.setPosition(origin.x, origin.y);
    }
    run.tween = null;
    this.pulses = this.pulses.filter((other) => other !== run);
  }

  /**
   * Stop every pulse and restore every letter.
   *
   * Called from SHUTDOWN and from `relayoutSentence`, the two places where the
   * Texts a running tween holds are about to stop existing. `tween.remove()`
   * takes it off the manager immediately rather than letting it live to the end
   * of the frame, which is the difference between this and `tween.stop()`.
   */
  private stopWordPulses(): void {
    for (const run of [...this.pulses]) {
      run.tween?.remove();
      this.settlePulse(run);
    }
    this.pulses = [];
  }

  // -------------------------------------------------------------------------
  // Warp
  // -------------------------------------------------------------------------

  private beginWarp(): void {
    if (this.warping) return;
    this.warping = true;
    // D62: "warp is a full stinger" - the loudest, longest sound in the game,
    // fired on the frame the acceleration starts so the two are one event.
    audioFrom(this.registry)?.play("warp", "warp-scene:jump");
    this.chargedLabel.setVisible(true);
    this.chargedPlate?.setVisible(true);
    this.shadow.setPose("cheering");
    this.lantern?.setIris(1);
    // The meter finishes on the same curve it filled on, so the last step is
    // the same kind of move as the forty before it.
    this.easeMeterTo(1);

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
        this.accelerateWorld(holder.m);
      },
      onComplete: () => {
        this.multiplier = WARP_MULTIPLIER;
        this.accelerateWorld(WARP_MULTIPLIER);
        this.cutToBeacon();
      },
    });
  }

  /**
   * Speed up whichever world is actually on screen.
   *
   * Standalone, that is this scene's own parallax. Overlaid, this scene HAS no
   * world - Flight's is the one the player can see - so the multiplier goes out
   * on `FLIGHT_EVENTS.warpSpeed` and Flight scales its own stack by it. Both
   * calls are made in both modes on purpose: the local one is a no-op with
   * nothing decorated, and the event lands in an empty room when no belt is
   * listening, so neither mode needs a branch and neither can be forgotten.
   */
  private accelerateWorld(multiplier: number): void {
    this.parallax.setWorldSpeed(FLIGHT_WORLD_SPEED * multiplier);
    const payload: WarpSpeedPayload = { multiplier };
    this.game.events.emit(FLIGHT_EVENTS.warpSpeed, payload);
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
    // `payload` is spread AND re-attached. Spreading alone is what lost the
    // stage tally between Flight and Results: Beacon forwards `initData.payload`
    // to Results, and a payload that arrived here flattened has no `payload` key
    // left for Beacon to forward. Keeping both means a screen may read the
    // contents directly or pass the envelope on, and neither has to know the
    // other exists.
    // The belt that has been running behind this panel is done now. Stopping it
    // HERE rather than when the panel opened is the whole of D30: Flight stayed
    // alive for the entire break so the world never went away, and it is torn
    // down at the moment the player actually leaves it.
    if (this.overlay) {
      this.scene.stop(SCENE_KEYS.hud);
      this.scene.stop(SCENE_KEYS.flight);
    }

    const payload = this.initData?.payload;
    goTo(this, SCENE_KEYS.beacon, {
      ctx: this.lane.ctx,
      progress: this.lane.progress,
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.stopId,
      ...(payload ?? {}),
      ...(payload === undefined ? {} : { payload }),
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
      /** Every colour pair this screen draws over the sky (V-22.8). */
      skyText: skyTextSamples(this),
      accent: this.lane.palette.accent,
      reducedMotion: this.lane.reducedMotion,
      sentence: this.sentence.text,
      index: this.sentence.index,
      typos: this.sentence.typos,
      charged: this.sentence.charged,
      lastEvent: this.sentence.lastEvent,
      chargeFraction: chargeFraction(this.sentence),
      chargePercent: chargePercent(this.sentence),
      /**
       * The DRAWN fill, which lags `chargeFraction` by a Cubic.Out tween.
       *
       * Reported separately from the state on purpose: "the bar eases" is the
       * claim that these two numbers DIFFER during the move and converge after
       * it, and a snapshot that only carried the state could not tell an eased
       * bar from the jolting one the player complained about.
       */
      meterShown: this.meterShown,
      /** Frames the fill was redrawn mid-move. Zero means it stepped. */
      meterEaseFrames: this.meterEaseFrames,
      /** Which third of the charge has sounded. 0..3; see `warpCharge.ts`. */
      chargeStage: this.chargeStage,
      percentLabel: this.percentLabel.text,
      // Latched on a render pass and never cleared: "the charged line was
      // drawn", which is the claim, rather than "it is drawn right now", which
      // stops being true the moment the warp cuts to Beacon.
      chargedLabelVisible: this.chargedDrawn.drawn,
      highlights: this.sentence.highlights.map(([a, b]) => [a, b]),
      highlightedText: this.sentence.highlights.map(([a, b]) =>
        this.sentence.text.slice(a, b),
      ),
      // D09's evidence: what the belt said was blasted, and what reached this
      // screen. `blastedWords` is the list the highlights were computed from,
      // so a test can tell "the sentence has no such word" apart from "the
      // player never blasted it".
      blastedWords: [...this.blastedThisRun()],
      missedWords: [...(this.initData?.missed ?? [])],
      letters: this.letters.map((l) => ({
        char: l.text,
        color: l.style.color,
        alpha: l.alpha,
        // UR-26's evidence, per letter. `x` is what proves the claim that
        // matters: the words AFTER a pulsing one must report the same x during
        // the pulse as before it. Reported for every letter rather than for the
        // pulsing word, because "nothing else moved" is the assertion.
        x: l.x,
        y: l.y,
        scaleX: l.scaleX,
      })),
      /**
       * UR-26: a finished word grows a little and returns to its original size.
       *
       * `peakScale` and `frames` are HIGH-WATER MARKS written by the tween, not
       * instantaneous reads: the pulse is 240 ms out and back and a snapshot
       * round-trip is not reliably shorter than that, so a test that sampled
       * the live scale would be racing its own transport. A screen where the
       * effect never ran reports 1 and 0, and nothing but the effect running
       * can move them.
       */
      wordPulse: {
        /** Every word that has pulsed, in the order the player finished them. */
        words: [...this.pulsedWords],
        fired: this.pulsedWords.length,
        /** Pulses still in flight. 0 once everything has settled. */
        running: this.pulses.length,
        peakScale: this.pulsePeakScale,
        frames: this.pulseFrames,
        /** The tuning, so a test asserts against the shipped numbers. */
        scale: WORD_PULSE_SCALE,
        durationMs: WORD_PULSE_MS,
        /** D41: the effect is decoration and reduced motion turns it off. */
        suppressed: this.lane.reducedMotion,
      },
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
        /** UR-24: the words drawn in the accent over the note. */
        namedWords: this.namedWords.map((t) => t.text),
        // TEST-ONLY. Nothing in the render path above reads these three.
        source: result?.source ?? null,
        failure: result?.failure ?? null,
        transport: result?.transport ?? null,
        calls: this.coachCalls,
      },
      /**
       * D09 / E-AI-1. The claim this feature makes, as data.
       *
       * `live` is the ONE fact the marker stands for and it is read off the
       * drawn Text rather than off a flag, so a test cannot be told the marker
       * is showing by a variable that disagrees with the screen.
       */
      composed: {
        live: this.composedMark.text.length > 0,
        marker: this.composedMark.text,
        text: this.composedText,
        reused: [...this.composedReused],
        // TEST-ONLY, like the three coach fields above. Nothing in the render
        // path reads these.
        outcome: result === null ? null : (result.sentence ?? null),
        refused: this.composedRefused,
        /** The stop's shipped sentence - what the fallback puts on screen. */
        shipped: this.warpSentenceText(),
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
      /**
       * UR-26. The letter geometry ALONE, cheap enough to read every animation
       * frame.
       *
       * `snapshot()` rebuilds the sky-text contrast samples, the highlight
       * ranges and the coach block on every call; sampling it at 60 Hz to watch
       * a 240 ms tween would change the thing it is measuring. This returns the
       * three numbers the pulse is about and nothing else, so a spec can record
       * where every letter was on every frame of the effect.
       */
      letterBoxes: () =>
        this.letters.map((l) => ({
          char: l.text,
          x: l.x,
          y: l.y,
          scaleX: l.scaleX,
          scaleY: l.scaleY,
        })),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
      parallaxOffsets: () => this.parallax.debugOffsets(),
      motion: () => this.parallax.debugMotion(),
    });
  }
}
