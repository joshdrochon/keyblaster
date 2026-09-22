import Phaser from "phaser";
import {
  COACH_TIMEOUT_MS,
  DEFAULT_FALLBACK_BUNDLE,
  cleanNoteFor,
  createCoachGate,
  type CoachClient,
  type CoachGate,
  type CoachResult,
} from "@engine/coach";
import {
  promisedWord,
  resolveRetry,
  sentenceGives,
  type RetryResolution,
} from "@engine/coach/retry";
import { coachRequestFor, retryCandidatesFor } from "./support/composeRequest";
import { createCoachClient } from "@game/coach/transport";
import { blastedWords, type BlastHistory } from "@game/flight/blastHistory";
import { FLIGHT_EVENTS, type WarpSpeedPayload } from "@game/flight/stage";
import { type StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { LAYERS, layer, type LayerId } from "@game/render/layers";
import { particleSpec } from "@game/render/particles";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum, mixHex } from "@game/render/palette";
import { LANTERN_DESIGN_HEIGHT, type LanternRig } from "@game/render/lantern";
import { drawPlayerLantern, playerLivery } from "./lib/livery.js";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { DUR, INK, STEP, TYPE } from "@game/ui/theme";
import type { Rect } from "@game/ui/layout";
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
import { paintBolt, paintPlate } from "@game/ui/plate";
import { PLATE_STEP } from "@game/ui/plateLayout";
import { paintPlanetBadge, planetBadgeInk, planetBadgeSpec } from "@game/render/planetBadge";
import {
  laneInit,
  latchOnRender,
  publishBag,
  textStyles,
  type DrawLatch,
  type LaneInit,
} from "./support/laneInit";
import { paintCaret } from "./lib/typedWord";
import { coachAllowlist, sightWordList } from "./support/vocab";
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

/**
 * THE SCREEN CLEARS AND THE SHIP LEAVES (UR-78).
 *
 * The sentence used to be answered by a world that sped up and then a hard cut
 * to Beacon, with the panels still on screen at the moment of the cut. A child
 * typed the last letter and the reward was a jump. The drive is charged: the
 * thing that should happen is that the ship goes.
 *
 * Three beats, deliberately overlapping rather than queued, so the whole exit
 * costs a beat and a half instead of three:
 *
 *   0 ms      the panels lift a little and fade - the screen gets out of the
 *             way first, so nothing is covering the ship when it moves
 *   260 ms    the ship launches, accelerating OUT of frame (`Cubic.In`: slow
 *             off the mark, fastest at the edge, which is what leaving looks
 *             like - `blast` is Expo.OUT and would have it brake on the way up)
 *   ~1160 ms  the cut, once the hull is past the top of the frame
 *
 * REDUCED MOTION (D41) TAKES THE SAME ROUTE, NOT A SHORTER ONE. The beats are
 * kept and the travel is dropped: the panels fade where they stand and the ship
 * fades out rather than flying. Cutting straight to Beacon instead would make
 * the one setting that exists for children who are hurt by motion the one
 * setting that skips the story beat.
 */
/**
 * The floor on how long Shadow's card shows the instruction before his note
 * can replace it. See `coachIntroDwell`.
 */
const COACH_INTRO_MIN_MS = DUR.toast;

const PANEL_CLEAR_MS = 320;
const PANEL_CLEAR_LIFT_PX = 28;
/**
 * Reduced motion has no hop, so it holds for the same beat instead.
 *
 * UR-166b: ONE hop, not two, and a shorter fade. Two hops plus a 620 ms fade
 * left her alone on a cleared frame for 1.2 s and the owner read it as
 * orphaned rather than celebrating. She is now moving for the whole time she
 * is on her own.
 */
/**
 * What the coach card holds. `COACH.h` is derived from Shadow's figure rather
 * than from the text, and the note's word cap is 20 - enough to wrap past the
 * plate. Two is what the shipped instruction and every shipped fallback draw.
 */
const NOTE_MAX_LINES = 2;

const SHADOW_CHEER_HOLD_MS = 260;
/** One half of one hop. One hop is `* 2`. */
const SHADOW_HOP_MS = 130;
const SHADOW_HOP_PX = 30;
/** How long her cheer takes to leave. */
const SHADOW_CHEER_EXIT_MS = 300;
const SHIP_LAUNCH_DELAY_MS = 260;
const SHIP_LAUNCH_MS = 900;
/** How far above the frame the hull must be before the cut. */
const SHIP_EXIT_CLEARANCE_PX = 420;
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
  INSTRUMENT,
  INSTRUMENT_INSET,
  COACH,
  WARP_CARDS,
  instrumentChargedRow,
  instrumentLabelRow,
  rowMiddle,
  lanternBox,
  lanternStand,
  shipBandTop,
  SENTENCE_PX,
  SENTENCE_STEP,
  sentenceLineCount,
  sentenceTop,
  WORD_PULSE_MS,
  WORD_PULSE_SCALE,
  completedWordRange,
  badgeRow,
  boltBesideLabel,
  chargeLabelX,
  coachRows,
  destinationRow,
  sentenceRow,
  shadowOrigin,
  SHADOW_SCALE,
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
  /**
   * The caret under the letter being typed - the SAME drawing the pre-flight
   * ritual's prompt uses (`lib/typedWord.paintCaret`), on a wrapped run.
   */
  private caret!: Phaser.GameObjects.Graphics;
  /**
   * How many lines the sentence on screen actually laid out to.
   *
   * Kept as the screen's own evidence that a composed sentence (D09) wrapped
   * where a shipped one did not - `snapshot()` publishes it. It no longer
   * PLACES anything: UR-70 used it to put the hint under the laid-out bottom of
   * the sentence, and the hint is outside the card now. `layoutLetters` sets
   * it; nothing else may.
   */
  private sentenceLines = 1;
  /**
   * The charge label's own Text and the bolt's box, kept for the `boxes()`
   * probe below. The bolt is placed off the LABEL'S MEASURED BOUNDS
   * (`warpLayout.boltBesideLabel`), so the only honest way to assert which side
   * of the words it landed on is to read back the two objects that were drawn -
   * recomputing the rectangle in a test would assert the arithmetic twice and
   * the screen not at all.
   */
  private chargeLabelText!: Phaser.GameObjects.Text;
  private boltBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private meterFill!: Phaser.GameObjects.Graphics;
  private percentLabel!: Phaser.GameObjects.Text;
  /** The plated wrapper, so the plate is re-cut when the number changes width. */
  private percentPlated!: PlatedText;
  private chargedLabel!: Phaser.GameObjects.Text;
  private chargedPlate: Phaser.GameObjects.Graphics | null = null;
  private noteText!: Phaser.GameObjects.Text;
  /**
   * The screen's instruction, in the note's own row, until the note arrives.
   * See `buildCoachArea` for why it is a second Text and not a string in
   * `noteText`, and `COACH_INTRO_MIN_MS` for why it is not replaced instantly.
   */
  private introText!: Phaser.GameObjects.Text;
  /** When the instruction went up, so the dwell is measured from the screen. */
  private introShownAtMs = 0;
  /** The instruction holds the card until the child has typed (UR-163). */
  private typedSinceIntro = false;
  /** False until the coach has answered (or given up) and the sentence is final. */
  private sentenceSettled = false;
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
  /**
   * UR-64. What happened when the note's offer of a retry was checked against
   * the sentence the child is actually given. Null until a note has arrived,
   * and null for every note that offers nothing. See `applyRetryRule`.
   */
  private retry: RetryResolution | null = null;

  /** Shadow's note, held until the instruction has had its dwell. */
  private pendingNote: { result: CoachResult; note: string } | null = null;
  private coachResult: CoachResult | null = null;
  private coachSettled = false;
  private coachCalls = 0;
  /** One gate per warp break, not one per request (AC-15.3). */
  private gate: CoachGate | null = null;

  private multiplier = 0;
  private warping = false;
  /**
   * True while the overlaid panel is sliding in.
   *
   * The focus ring rides that entrance (see `slideIn`), and `onKey` re-pops the
   * ring on Tab or Enter - with the SAME rectangle every time, because this
   * screen has exactly one focus target. A pop mid-entrance would replace the
   * entrance's alpha with `createFocusRing`'s own 0.55 -> 1, which is the
   * reported defect back again on a keystroke: a lit outline around a card that
   * has not arrived. The pop is skipped while this is true and nothing is lost,
   * because the ring is already exactly where it would be moved to.
   */
  private entering = false;
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
    this.sentenceSettled = false;
    this.retry = null;
    // A restart IS a new warp break (a new stage ended), so the gate is new.
    this.gate = null;
    this.multiplier = 0;
    this.warping = false;
    this.debrisMoved = false;
    this.debrisSignature = "";
    this.overlay = data?.overlay === true;
    /**
     * ============ PHASER BUILDS THIS SCENE ONCE (UR-59's lesson, again) ============
     *
     * A class-field initialiser runs when the INSTANCE is constructed, which is
     * once per page load, not once per visit - `create` is re-run on the same
     * object. Everything a visit owns therefore has to be cleared here, and
     * these two were not:
     *
     *   `lantern`  `create` only ASSIGNS it on the standalone path (the overlay
     *              path draws no ship, because the one on screen is Flight's).
     *              `SHUTDOWN` destroys the rig but left the field pointing at
     *              it, so a standalone mount followed by an overlaid one kept a
     *              DESTROYED `LanternRig`: `snapshot().ship.drawn` reported
     *              true with no ship on screen, `shipLivery` reported a hull
     *              that was not drawn, and `clearAndLaunch` tweened a dead
     *              container on the way out.
     *   `meterEaseFrames`  a high-water count of frames the fill was redrawn
     *              mid-move. AC-22.5's claim is "zero means it stepped", and a
     *              count carried in from the previous visit makes that reading
     *              false in the direction that hides the defect.
     */
    this.lantern = null;
    this.meterEaseFrames = 0;
    this.entering = false;
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
      // UR-63. AT FLIGHT'S OWN STAND, not in a bay of this screen's own: the
      // ship a child sees on this screen is the one they have been flying, and
      // a standalone boot that drew it somewhere else made every capture
      // evidence about the harness rather than about the game.
      // `support/warpLayout.ts` owns the rectangle and `warpLayout.test.ts`
      // asserts it is disjoint from every card.
      const stand = lanternStand();
      // THE PILOT'S OWN HULL (UR-48). The standalone path drew the file
      // constants; the overlay path draws no ship at all, because the ship on
      // screen is Flight's and Flight's is already the pilot's. Both paths now
      // show one hull, and `drawPlayerLantern` delegates to the single
      // `drawLantern` rather than adding a drawing (standards rule 3).
      this.lantern = drawPlayerLantern(this, stand.x, stand.y, {
        scale: stand.height / LANTERN_DESIGN_HEIGHT,
        reducedMotion: this.lane.reducedMotion,
        idleBob: true,
        exhaust: true,
        // NO STANDING BEAM. The rig's light shaft is a vertical column drawn on
        // `shipFx`, one depth below the HUD the cards live on, so it came up
        // through the gaps BETWEEN the cards as a pale scratch down the middle
        // of the screen once the ship moved to the centre. Flight draws the
        // same rig with `beam: false` for its own reasons, which means this is
        // also the arrangement that keeps the two screens showing one ship.
        beam: false,
        iris: 0.15,
      });
      this.parallax.layerOf("shipFx").container.add(this.lantern.container);
    }

    if (this.overlay) this.panelRoot.add(this.scrim());
    this.panelRoot.add(this.buildSentencePanel());
    this.panelRoot.add(this.buildMeter());
    this.panelRoot.add(this.buildCoachArea());

    // NO HINT ON THE GRID LINE. `ui/hint.ts` declares this screen
    // `placement: "none"`: its instruction is in Shadow's card, and a second
    // copy at the foot of the frame would be UR-56's defect with a card in
    // place of a button.

    this.ring = createFocusRing(this, layer("hud").depth + 1, this.lane.reducedMotion);
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
    // Whatever happens to that request, the card gets its sentence.
    this.time.delayedCall(COACH_TIMEOUT_MS + 600, () => this.settleSentence());
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
   *
   * ============ THE RING ARRIVES WITH THE CARD IT IS AROUND ============
   *
   * THE DEFECT, AS REPORTED: "the yellow outline appears before its box." It is
   * the focus ring, and it was not a timing tweak away from correct - it was
   * never given this entrance at all.
   *
   * `createFocusRing` paints the ring and plays its own 0.55 -> 1 arrival the
   * moment `moveTo` is called, at the card's FINAL rectangle. The ring is
   * created OUTSIDE `panelRoot` on purpose - that is what makes it draw over
   * the card rather than under it (`buildSentencePanel` explains why the ring
   * IS this card's gold line) - and `panelRoot` is the only thing `slideIn`
   * touched. So on every overlaid break the outline was fully lit at the
   * card's resting position while the card itself was still transparent and
   * 150 px lower, and the two met when the slide finished. Measured in the
   * served build, sampled every animation frame from the overlay's first:
   *
   *            ring.alpha   panelRoot.alpha
   *   +17 ms      0.590          0.000
   *   +117 ms     1.000          0.111
   *   +317 ms     1.000          0.604
   *
   * The fix is the same shape as `clearAndLaunch`'s, which is the other end of
   * this screen's life: the ring is given the panel's entrance - its alpha, its
   * offset, its duration and its ease - so the outline and its box are one
   * object's worth of motion in both directions. Parenting the ring INTO
   * `panelRoot` was the alternative and was rejected: `boxes()` reports
   * `ring.graphics.alpha`, which inside a container is a local alpha that no
   * longer says what is on screen, and `warp-chrome.spec.ts` asserts the exit
   * with exactly that number.
   */
  private slideIn(): void {
    if (!this.overlay) return;
    const ring = this.ring.graphics;
    if (this.lane.reducedMotion) {
      this.panelRoot.setAlpha(0);
      ring.setAlpha(0);
      this.entering = true;
      this.tweens.add({
        targets: [this.panelRoot, ring],
        alpha: 1,
        duration: DUR.panel,
        ease: EASE.arrive,
        onComplete: () => {
          this.entering = false;
        },
      });
      return;
    }
    this.panelRoot.setAlpha(0);
    this.panelRoot.setY(150);
    // The ring's own arrival tween is replaced rather than raced: it was armed
    // by `moveTo` a line before this and would otherwise drag the alpha back up
    // under the entrance.
    this.tweens.killTweensOf(ring);
    ring.setAlpha(0);
    ring.setY(150);
    this.entering = true;
    this.tweens.add({
      targets: [this.panelRoot, ring],
      y: 0,
      alpha: 1,
      duration: 460,
      onComplete: () => {
        this.entering = false;
      },
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
   *
   * UR-63: IT STOPS AT THE SHIP. The scrim used to run to the bottom of the
   * frame at its darkest, and the darkest part of it was exactly the band the
   * Lantern stands in - so even once the coach card was moved off the ship, the
   * ship would have been sitting under 48% black. It now ramps up across the
   * cards, fades back to nothing over the gap beneath them, and draws no pixel
   * at all in the ship's band. The fade is what keeps that from being a hard
   * horizontal edge across the middle of a live world.
   */
  private scrim(): Phaser.GameObjects.GameObject {
    const g = this.add.graphics();
    const ink = mixHex(INK.panel, "#000000", 0.2);
    const top = 60;
    const cardsBottom = COACH.y + COACH.h;
    const clear = shipBandTop();
    // Abutting strips with integer edges. Overlapping translucent strips
    // composite twice where they meet and the doubled alpha shows as a hard
    // line - the first render of this scrim was a set of stripes across the
    // live world, which is worse than no scrim at all.
    const steps = 48;
    const height = clear - top;
    for (let i = 0; i < steps; i++) {
      const a = Math.round(top + (height * i) / steps);
      const b = Math.round(top + (height * (i + 1)) / steps);
      if (b <= a) continue;
      const mid = (a + b) / 2;
      // Up to the bottom of the cards, then back down to zero by the time the
      // ship's band starts.
      const alpha =
        mid <= cardsBottom
          ? 0.08 + 0.4 * ((mid - top) / Math.max(1, cardsBottom - top))
          : 0.48 * (1 - (mid - cardsBottom) / Math.max(1, clear - cardsBottom));
      g.fillStyle(hexToNum(ink), Math.max(0, alpha));
      g.fillRect(0, a, this.scale.width, b - a);
    }
    return g;
  }

  /**
   * THE SCREEN HAS NO HEADER LINE AT ALL NOW.
   *
   * It had one: `warp.beltCleared`, on a plate at the top of the frame, telling
   * the player the belt was clear and to type the sentence below. It is inside
   * Shadow's card with the other instruction (`warp.coachIntro`) - one place
   * the screen speaks instead of three - and with it went UR-70's two status
   * dots, which hung off that line's right end and had nothing left to hang
   * off. `warp.beltCleared` is kept unused in the string table so restoring the
   * banner stays a layout change.
   *
   * The 94 px hole it left above the sentence card went with it: `PANEL_Y` is
   * `HEADING_TOP` now, which is where every other screen's first element
   * starts. See `support/warpLayout.ts`.
   */

  /** Depth the header's text draws at; its plate takes one below. */
  private headerDepth(): number {
    return 10;
  }

  private buildSentencePanel(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];

    // UR-70's CHROME, AND IT IS FOUR PROPS RATHER THAN A DRAWING (UR-69).
    //
    // UR-70 named angled corner brackets on the sentence element and a gold
    // rim around the whole of it. Both are properties of the shared
    // plate now, so they are two words here and they are available to the other
    // eight screens the moment anyone wants them - which is the whole reason
    // UR-70 was blocked on UR-69 rather than applied to this screen alone.
    //
    // THE BRACKETS ARE GOLD, AND THAT IS A REVERSAL. They were the stop's
    // accent, on the argument that the comp happened to be at a gold stop and
    // that a fixed colour would push a themed value into shared chrome. The
    // argument points the wrong way: the stop accent is the themed value, and
    // at Mars it is red, so the brackets read as four faint red slivers instead
    // of as an instrument's corner hardware. Gold is now the plate's DEFAULT
    // for `corner: "bracket"` (`ui/plate.CHROME_INK`, which is `INK.accent`),
    // so this call site names no colour at all and a screen that wants its
    // stop's accent still gets it by passing `stroke`.
    //
    // AND THERE IS NO RIM ON THIS CARD. UR-70 asks for one gold line around the
    // whole element; this card already had one and it was the FOCUS RING. The
    // ring sits at `SPACE.focusRingOffset` 6 and is 4 px wide, so it spans 4..8
    // px outside the plate; `RIM.gap` is 8 and the rim is 2 px wide, so it
    // spans 7..9. They overlapped, in the same gold, and the two of them
    // painted one muddy 5 px edge - which is why the capture showed a single
    // thick line rather than the two-line chrome read the rim exists for.
    // There is no room to move the rim outboard either: the header's own plate
    // ends 21 px above this card. So the focus ring IS the gold line here, the
    // `rim` prop stays on the shared plate for the screens that want a line
    // without a focus ring, and the choice is in gauntlet/escalations.md.
    made.push(
      plate(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h, {
        fill: INK.panel,
        corner: "bracket",
      }),
    );

    // UR-70's BADGE: the planet whose beacon is being charged, drawn in the
    // card's top right. Vector, from that stop's palette (D83, AC-22.7) -
    // `render/planetBadge.ts`. The badge square is the shared plate's
    // (`plateLayout.badgeBox`), which is why it cannot collide with the bracket
    // arms or hang over the card's padding.
    //
    // IT IS THE CURRENT STOP, AND IT IS NO LONGER OPTIONAL. The badge used to
    // take `STOP_IDS[indexOf(current) + 1]` - the stop AFTER this one - so it
    // drew Pluto's ice over a sentence that charged Neptune's beacon, and at
    // Pluto itself the expression was `undefined` and the card had no badge at
    // all. `beaconStopId` always answers, so the last stop of the game gains
    // the picture every other stop had.
    const badge = badgeRow();
    const beaconId = this.beaconStopId();
    const badgeGraphics = this.add.graphics();
    paintPlanetBadge(
      badgeGraphics,
      badge,
      planetBadgeSpec(beaconId),
      planetBadgeInk(beaconId, INK.panel),
    );
    made.push(badgeGraphics);
    // The instruction is on the header line now ("warp.beltCleared"), where it
    // sits next to what just happened. This slot carries the OTHER half the
    // player was missing - WHOSE beacon this charge is filling - so the meter
    // has an owner before it is full rather than only after it.
    // UR-70. The row is the shared rhythm's, not `PANEL.y + 24` - see
    // `support/warpLayout.ts`, which now derives the card's height from its
    // rows rather than the other way round.
    const destination = destinationRow();
    made.push(
      label(this, destination.x, destination.y, this.destinationCopy(), {
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
    // RIGHT-ANCHORED TO THE LEFT OF THE BADGE, not to the content's right edge,
    // which is where the badge now is. It is normally empty, so a collision
    // here would only ever have shown up on the one path that puts a string in
    // it - a live composed sentence, i.e. the path with no shipped fallback to
    // notice it.
    // UR-189: sharing the destination line's y put the mark against the
    // plate's top edge.
    this.composedMark = label(
      this,
      badge.x - PLATE_STEP.glass,
      destination.y + STEP.hair,
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

    // BEFORE the letters, so the bar draws under the glyph it is under. It is
    // one Graphics for the whole sentence: the caret is on exactly one letter
    // at a time, and `paintSentenceCaret` clears and redraws it each frame.
    this.caret = this.add.graphics();
    made.push(this.caret);

    // UR-189: drawn by `settleSentence`, not here. The shipped string used to
    // go up immediately and be replaced when the coach landed, so the child
    // read one sentence and then watched it become another.
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
    const band = sentenceRow();
    const left = band.x;
    const maxWidth = band.w;
    const size = SENTENCE_PX;
    const pal = this.lane.palette;

    // UR-175: CENTRED in the reserved band. The band holds two lines so the
    // card cannot resize when a composed sentence lands mid-screen; top-
    // aligning put all of that slack under a one-line sentence, which reads as
    // a hole rather than as padding.
    const top = sentenceTop(sentenceLineCount(this.sentence.text));

    let x = left;
    let y = top;
    // The LAID-OUT line count, which is what places the hint. Counted here
    // because this loop is the only thing that knows where the line broke:
    // the wrap is decided from a per-word width estimate, so it cannot be
    // derived from the string afterwards without writing the estimate twice.
    this.sentenceLines = 1;
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
        this.sentenceLines += 1;
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

  /**
   * UR-62 - THE WARP DRIVE IS ONE INSTRUMENT.
   *
   * ================== THE DEFECT ==================
   * The readout was three objects that never shared a box. "warp drive" sat
   * left on a pill of its own; the track spanned the column 52 px below it; the
   * percentage floated above the track's right end on a THIRD pill, anchored
   * from the opposite side. Nothing tied them together and, because each was
   * placed from its own anchor, they did not line up with each other either.
   *
   * ================== WHAT IT IS NOW ==================
   * One plate with one border (`INSTRUMENT`), and everything the drive has to
   * say drawn inside it:
   *
   *   row 1   "warp drive" at the left edge of the track and the percentage at
   *           its right edge, ONE baseline (`instrumentLabelRow`). The two ends
   *           of one line rather than two objects near each other.
   *   row 2   the track, inset to the same left and right edges (`METER`).
   *   row 3   the charged line, which used to hang below the whole thing on a
   *           pill of its own (`instrumentChargedRow`).
   *
   * THE PILLS ARE GONE, AND THE CONTRAST EVIDENCE IS NOT. Text on a panel the
   * scene drew itself does not need a `skyText` plate, but it still has to be
   * MEASURED - "it's on a panel, trust me" is how 1.19:1 shipped once. So each
   * label goes through `skyText` with `plated: true` and `plateFill` naming the
   * instrument's own fill, which is what V-22.8 reads. The colour pair is
   * unchanged: `INK.panel` is also `SKY_PLATE.fill`.
   *
   * THE EASING IS UNTOUCHED (AC-22.5). `easeMeterTo` still tweens `meterShown`
   * on Cubic.Out and `paintMeter` still draws from it; this changed the
   * rectangle that gets painted and nothing that drives it.
   */
  private buildMeter(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const made: Phaser.GameObjects.GameObject[] = [];

    // The instrument itself. One plate, one border, everything below inside it.
    made.push(
      plate(this, INSTRUMENT.x, INSTRUMENT.y, INSTRUMENT.w, INSTRUMENT.h, {
        fill: INK.panel,
        stroke: INK.line,
        alpha: 1,
      }),
    );

    const labelRow = instrumentLabelRow();
    // ON THE ROW'S MIDDLE, NOT ITS TOP EDGE.
    //
    // Both ends of this line are drawn with `originY: 0.5` at `rowMiddle`, so
    // the ink is centred in the row at any type size and in any of the three
    // languages. Hung from `labelRow.y` with the row's old literal height of
    // 32, "Beacon Charge" was not centred in its element - it overflowed it,
    // because one line of `TYPE.label` is 37 in the language the rows are
    // sized for. The row is `lineBox(TYPE.label)` now; see
    // `support/warpLayout.ts`.
    //
    // THE WORDS STILL START RIGHT OF THE BOLT. `chargeLabelX()` is
    // `labelRow.x + BOLT_LEAD_PX`, and the bolt is placed off this text's
    // measured bounds so its LEFT edge lands back on `labelRow.x` - which is
    // also why centring the words carries the mark with them.
    const labelY = rowMiddle(labelRow);
    const chargeLabel = skyText(
      this,
      chargeLabelX(),
      labelY,
      this.lane.copy.text("warp.chargeLabel"),
      {
        screen: "warp",
        id: "warp.chargeLabel",
        size: TYPE.label,
        color: INK.textDim,
        lang: this.lane.lang,
        depth: this.headerDepth(),
        originY: 0.5,
        plated: true,
        plateFill: INK.panel,
      },
    );
    made.push(...chargeLabel.objects);
    this.chargeLabelText = chargeLabel.text;

    // Right-anchored to the SAME x the track ends at, on the SAME middle the
    // label sits on. That pair is the whole of "one instrument": the readout is
    // the right end of the label's line and the right end of the bar at once.
    const percent = skyText(
      this,
      labelRow.x + labelRow.w,
      labelY,
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
        originY: 0.5,
        plated: true,
        plateFill: INK.panel,
      },
    );
    this.percentPlated = percent;
    this.percentLabel = percent.text;
    made.push(...percent.objects);

    // THE SHARED PLATE, on the `pill` corner (UR-69). `METER.h / 2` written
    // out by hand is what "as round as it can be" looked like before the
    // corner was a prop.
    const track = this.add.graphics();
    paintPlate(track, METER, {
      fill: INK.panelSunken,
      alpha: 0.95,
      stroke: pal.accent,
      strokeAlpha: 0.3,
      corner: "pill",
      rhythm: "instrument",
    });
    made.push(track);

    /**
     * UR-70's LIGHTNING BOLT, on the bar itself - AND IT IS DRAWN TWICE.
     *
     * The bolt marks where the charge starts, so it sits in the track's left
     * cap, which is exactly the pixels the fill covers first. One bolt cannot
     * survive that: in the accent it disappears the moment the accent fill
     * reaches it, and in the track's own sunken ink it is invisible until the
     * fill arrives. So the mark is painted on BOTH sides of the fill - accent
     * underneath, panel ink on top - and the fill decides which one you see. An
     * empty track shows the lit bolt; a charged one shows it stamped out of the
     * gold. Neither pass is a new colour: both inks are already on this
     * instrument.
     */
    // THE BOLT SITS WITH THE WORDS, NOT IN THE TRACK (UR-78).
    //
    // It used to live in the track's left cap, which meant it had to be drawn
    // TWICE - once in the stop's accent under the fill and once in the sunken
    // ink over it - so that it stayed legible on an empty bar and a charged
    // one. Put beside the label it is never behind the fill, so it is one
    // drawing again, and it is the same gold as the percentage because the two
    // are the ends of one line: the mark says what the number is measuring.
    //
    // PLACED OFF THE MEASURED TEXT, not off a guessed width. `boltBesideLabel`
    // takes the label's own bounds, so the gap is five pixels of ink-to-ink air
    // at every type size and in every language rather than five pixels from
    // wherever the string was assumed to end.
    const bolt = this.add.graphics();
    const labelBox = chargeLabel.text.getBounds();
    this.boltBox = boltBesideLabel({
      x: labelBox.x,
      y: labelBox.y,
      w: labelBox.width,
      h: labelBox.height,
    });
    paintBolt(bolt, this.boltBox, INK.accent, { alpha: 1 });
    made.push(bolt);

    this.meterFill = this.add.graphics();
    made.push(this.meterFill);
    this.paintMeter();

    // "warp drive charged - next stop Jupiter". The old line was "warp drive
    // charged. hold on." - true, and it never told the player they were about
    // to travel anywhere, let alone where.
    const chargedRow = instrumentChargedRow();
    const charged = skyText(this, chargedRow.x, chargedRow.y, this.chargedCopy(), {
      screen: "warp",
      id: "warp.charged",
      size: TYPE.caption,
      color: INK.accent,
      lang: this.lane.lang,
      depth: this.headerDepth(),
      plated: true,
      plateFill: INK.panel,
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
   * It hands the charge to the next screen by name: the meter's output is the
   * beacon `BeaconScene` is about to plant, so the line says PLANT IT and says
   * where. There is no last-stop branch any more - see `beaconStopId`.
   */
  private chargedCopy(): string {
    return this.lane.copy.text("warp.chargedNext", { stop: this.beaconStopName() });
  }

  /** The line above the sentence: whose beacon this typing is charging. */
  private destinationCopy(): string {
    return this.lane.copy.text("warp.nextStop", { stop: this.beaconStopName() });
  }

  /** The same stop as a translated display name. */
  private beaconStopName(): string {
    return this.lane.copy.stopName(this.beaconStopId());
  }

  /**
   * ============ THE BEACON BEING CHARGED IS THE STOP UNDER THE SHIP ============
   *
   * This was `STOP_IDS[STOP_IDS.indexOf(this.stopId) + 1]` - the stop AFTER the
   * belt just cleared - because the screen used to be a warp drive and a drive
   * goes somewhere. It does not: the belt is AT the stop, so clearing Mars'
   * belt means the pilot is already at Mars. The screen charges the beacon
   * `BeaconScene` plants in the very next cut, and `cutToBeacon` forwards
   * `this.stopId` to it, so THIS is the id both screens agree on. The old
   * expression put "Destination: Pluto" on the screen immediately before
   * Neptune's beacon went into the ground.
   *
   * IT CANNOT BE NULL, AND THAT REMOVES TWO BRANCHES. The old one ran off the
   * end of the route at Pluto, so the last stop in the game showed no
   * destination row and no badge; `warp.prompt` and `warp.chargedLast` existed
   * only to cover that hole. Pluto now reads exactly like every other stop -
   * "Charging: Pluto Beacon", then "Beacon charged. Plant it at Pluto." - which
   * is true, because Pluto's beacon is the one that finishes the map.
   *
   * ID, NOT NAME, and they are different things: `copy.stopName` is translated,
   * so a badge keyed off it would look up "Saturne" in a palette table keyed by
   * "saturn" and quietly draw nothing in French.
   */
  private beaconStopId(): StopId {
    return this.stopId;
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
    paintPlate(
      this.meterFill,
      {
        x: METER.x + inset,
        y: METER.y + inset,
        w: Math.max(METER.h - inset * 2, w),
        h: METER.h - inset * 2,
      },
      {
        fill: this.lane.palette.accent,
        alpha: 0.95,
        corner: "pill",
        strokeWidth: 0,
        rhythm: "instrument",
      },
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

    // ============ THE CARD IS SIZED FOR HIM, NOT HE FOR THE CARD ============
    //
    // Every number here used to be a literal - `COACH.x + 120`, `COACH.h / 2`,
    // `scale: 0.66`, `COACH.x + 230`, `+ 22`, `+ 56`, `COACH.w - 290` - and the
    // comment that stood here reasoned from `SHADOW_HEIGHT`, which under-reads
    // the drawing by half a radius. Measured by screenshot difference in the
    // served build, Shadow came out 147 px tall in a 140 px card whose inner
    // box is 116, crossing the top edge by 9 px. `support/warpLayout.ts` now
    // owns all of it and derives the card's height from the figure; see the
    // note over `SHADOW_ABOVE_R` for the four coefficients and how they are
    // guarded against `render/shadow.ts` drifting.
    const stand = shadowOrigin();
    this.shadow = drawShadow(this, stand.x, stand.y, "pointing", {
      scale: SHADOW_SCALE,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("hud").depth,
    });

    const [speakerRow, noteRow] = coachRows(TYPE.body, TYPE.caption) as [Rect, Rect];

    made.push(
      label(this, speakerRow.x, speakerRow.y, this.lane.copy.text("warp.speaker"), {
        size: TYPE.caption,
        color: pal.accent,
        lang: this.lane.lang,
      }),
    );

    this.noteText = label(this, noteRow.x, noteRow.y, "", {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: noteRow.w,
      lang: this.lane.lang,
    });
    this.noteText.setAlpha(0);
    made.push(this.noteText);

    // ============ BOTH OF THE SCREEN'S INSTRUCTIONS, IN THIS CARD ============
    //
    // They were a banner at the top of the frame (`warp.beltCleared`) and a
    // hint at the foot (`warp.hint`), one at each end of a screen whose middle
    // was a coach card saying nothing until the note landed. They are one line
    // here, in Shadow's voice, because that is the one place on this screen a
    // child is already reading.
    //
    // AC-33 SURVIVES BECAUSE THIS IS A SECOND TEXT IN THE SAME RECTANGLE, not
    // a string swapped into the note's. Same row, same size, same wrap, both
    // created now, neither ever moved or resized: the note's own x, y, style
    // and wrap are byte-identical to what they were before this existed, which
    // is what `warp.spec.ts` compares field by field. The arrival is a
    // crossfade between two objects that occupy one box, so no geometry can
    // react to what the transport returned.
    this.introShownAtMs = this.time.now;
    this.typedSinceIntro = false;
    this.introText = label(
      this,
      noteRow.x,
      noteRow.y,
      this.lane.copy.text("warp.coachIntro"),
      {
        size: TYPE.body,
        color: INK.text,
        wrapWidth: noteRow.w,
        lang: this.lane.lang,
      },
    );
    made.push(this.introText);

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

    // `label` sets letterSpacing OUTSIDE `style`, so a ruler built from style
    // alone measures a narrower prefix and the accent word lands left of the
    // white one under it - the white fringe the owner saw (UR-156).
    const ruler = this.make.text(
      { text: "", style: this.noteText.style as unknown as object },
      false,
    );
    const spaced = this.noteText as unknown as { letterSpacing?: number };
    const rulerSpaced = ruler as unknown as {
      setLetterSpacing?: (v: number) => unknown;
    };
    if (typeof rulerSpaced.setLetterSpacing === "function") {
      rulerSpaced.setLetterSpacing(spaced.letterSpacing ?? 0);
    }
    for (const span of spans) {
      ruler.setText(prefixOf(lines, span));
      const t = label(this, this.noteText.x + ruler.width, this.noteText.y + span.line * lineStep, span.text, {
        size: TYPE.body,
        color: this.lane.palette.accent,
        lang: this.lane.lang,
      });
      // Same spacing as the run it sits on, for the same reason as the ruler.
      const tSpaced = t as unknown as { setLetterSpacing?: (v: number) => unknown };
      if (typeof tSpaced.setLetterSpacing === "function") {
        tSpaced.setLetterSpacing(spaced.letterSpacing ?? 0);
      }
      // UR-156 again: the accent word is drawn OVER the white run, so any
      // sub-pixel shortfall in the ruler leaves a white fringe. A knockout in
      // the card's own fill, stroked so it covers the antialiasing, erases the
      // glyph underneath instead of relying on the measurement being exact.
      const knockout = label(this, t.x, t.y, span.text, {
        size: TYPE.body,
        color: INK.panel,
        lang: this.lane.lang,
      });
      const kSpaced = knockout as unknown as { setLetterSpacing?: (v: number) => unknown };
      if (typeof kSpaced.setLetterSpacing === "function") {
        kSpaced.setLetterSpacing(spaced.letterSpacing ?? 0);
      }
      knockout.setStroke(INK.panel, 4);
      knockout.setDepth(this.noteText.depth + 1).setAlpha(0);
      this.panelRoot.add(knockout);
      this.namedWords.push(knockout);

      t.setDepth(this.noteText.depth + 2).setAlpha(0);
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
    this.settleSentence();
    // AFTER the composed sentence, never before: a live model's sentence is
    // built to contain this child's own hard words (gate 6 of `sentence.ts`),
    // so on the deployed path the promise is usually already kept and this is a
    // no-op. Running it first would have measured the promise against a
    // sentence that was about to be replaced.
    //
    // QUEUED, NOT DRAWN. `releaseCoachNote` puts it on screen once the
    // instruction has had the card for `COACH_INTRO_MIN_MS`; the rule is
    // resolved HERE, against the sentence that is on screen now.
    // UR-191: a perfect belt gets its own authored line. There is no missed
    // word for a live note to be about, and an authored one can be SPOKEN -
    // D98 only lets a rendered clip through the voice bus. `sentence: false`
    // is `composeContextFor`'s answer to "was anything practised".
    const clean =
      request.compose?.sentence === false
        ? cleanNoteFor(this.lane.lang, this.stopId)
        : undefined;
    this.pendingNote = {
      result,
      note: clean ?? this.applyRetryRule(result.note),
    };
  }

  /**
   * HOW LONG THE INSTRUCTION GETS THE CARD BEFORE SHADOW TAKES IT BACK.
   *
   * Without this the feature deletes itself. `MockCoach` is the default
   * transport (D47/AC-15.4) and it is SYNCHRONOUS - measured in the served
   * build, `coach.received` is already true 200 ms after boot - so a note that
   * replaced the instruction "on arrival" would replace it before a single
   * frame had drawn it, and the two lines this screen used to carry would be
   * gone rather than consolidated.
   *
   * TWO GATES, and the first is the one that matters: the child must have
   * typed a character. A clock alone took the instruction away at 3.2 s from a
   * child who had not started, which is exactly when they still needed it
   * (UR-163). `DUR.toast` stays as the floor underneath, so the line is also
   * never snatched away the instant the first key lands.
   *
   * It also makes AC-33 tighter rather than looser - live (instant) and
   * fallback (1500 ms timeout) both render the note at the same moment now.
   * The dwell is in gauntlet/escalations.md with its options and a lean.
   *
   * ON THE FRAME LOOP, NOT A `delayedCall`. The first version awaited a promise
   * resolved by `this.time.delayedCall` and the note never arrived at all in
   * the served build - `coach.calls` read 1 and `coach.received` stayed false
   * past six seconds. `update` is the clock this screen is already known to be
   * running, because the parallax and the caret are drawn from it.
   */
  private releaseCoachNote(): void {
    const pending = this.pendingNote;
    if (pending === null) return;
    if (!this.typedSinceIntro) return;
    if (this.time.now - this.introShownAtMs < COACH_INTRO_MIN_MS) return;
    this.pendingNote = null;
    this.showNote(pending.result, pending.note);
  }

  /**
   * UR-64 - THE OFFER AND THE SENTENCE ARE COMPARED BEFORE EITHER IS DRAWN.
   *
   * ================== THE DEFECT ==================
   * Shadow can say that a word took the pilot a moment and offer to type it
   * again together. The sentence handed over next is the stop's static
   * `warpSentence`, which is a different string chosen by a different thing at
   * a different time - at Pluto the note named a word the sentence did not
   * contain at all. Nothing anywhere compared the two, so the offer was broken
   * by construction rather than by accident.
   *
   * ================== WHERE THE RULE LIVES, AND WHY NOT HERE ==================
   * `engine/coach/retry.ts`, because it is a rule over two strings and this
   * file cannot be asserted without a browser. `resolveRetry` gets the note,
   * the sentence as laid out, and the stop's own shipped prose as candidates,
   * and returns the note to draw plus a replacement sentence when one exists.
   * This method is the wiring and the two judgement calls below, and nothing
   * else.
   *
   * WHEN THE SENTENCE MAY NOT BE SWAPPED. Two cases, and in both the offer is
   * withdrawn from the note instead of being kept by force:
   *
   *   the child has started typing   swapping the line under them invalidates
   *                                  the letters they have already typed and
   *                                  reads as the game taking something away,
   *                                  which D31 forbids more strongly than it
   *                                  wants this. Same rule, same reason, as
   *                                  `useComposedSentence`.
   *   a live model wrote this one    E-AI-1's marker is on screen standing for
   *                                  that exact string. Replacing it would
   *                                  leave the marker pointing at a sentence
   *                                  the model did not write, which is the one
   *                                  thing that marker may never do.
   */
  private applyRetryRule(note: string): string {
    const lang = this.lane.lang;
    const pool = hasStageBundle(this.stopId) ? stageBundle(this.stopId).pool : [];
    const resolution = resolveRetry({
      note,
      current: this.sentence.text,
      candidates: retryCandidatesFor(this.stopId),
      mayReplace:
        this.composedText === null &&
        !this.warping &&
        this.sentence.index === 0 &&
        this.sentence.typos === 0,
      // THE SAME SIX GATES a live composed sentence clears, with the same
      // allowlist and the same stage pool. Shipped prose gets no exemption:
      // the length band and the typeable-character set are about a child
      // TYPING the string, and a briefing line was written to be read.
      gate: {
        allowlist: coachAllowlist(lang),
        pool,
        sightWords: sightWordList(lang),
        practised: [
          ...(this.initData?.missed ?? []),
          ...(this.initData?.slow ?? []),
          ...this.blastedThisRun(),
        ],
      },
    });
    this.retry = resolution;
    if (resolution.sentence !== null) this.relayoutSentence(resolution.sentence);
    return resolution.note;
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
  /**
   * Draw the sentence, once, when it is the one the child will actually type.
   *
   * Reached from the coach result on every path - `gate.request` falls back
   * rather than rejecting - and from a safety timer, so a scene that loses its
   * request can never be left with an empty card.
   */
  private settleSentence(): void {
    if (this.sentenceSettled) return;
    this.sentenceSettled = true;
    // NOT `relayoutSentence`: that resets the meter, and the meter has been at
    // zero since create - an ease frame here is one AC-22.5 counts.
    if (this.letters.length === 0) {
      this.panelRoot.add(this.layoutLetters());
      this.paintLetters();
    }
    if (this.lane.reducedMotion) return;
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
    // Nothing else moves when a composed sentence wraps where the shipped one
    // did not: the plate, the meter and the coach area are byte-identical
    // either way, which is the load-bearing half of this method's contract.
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
  /**
   * UR-190: a note that would not fit the card is not drawn.
   *
   * `COACH.h` is derived from Shadow's figure, not from the text, and the word
   * cap is 20 - enough to wrap past the plate on a long one. The gates upstream
   * judge the words; this judges the LINES, which is the only thing that can
   * overflow, and it measures them after Phaser has wrapped rather than
   * guessing from the string. There is no retry: one call per break (AC-15.3),
   * and a note that does not fit is simply the shipped one instead.
   */
  private fitNote(note: string): string {
    this.noteText.setText(note);
    if (this.noteText.getWrappedText().length <= NOTE_MAX_LINES) return note;
    const byLang = DEFAULT_FALLBACK_BUNDLE.byLang[this.lane.lang];
    const shipped = byLang.byStop[this.stopId]?.note ?? byLang.base.note;
    this.noteText.setText(shipped);
    return shipped;
  }

  private showNote(result: CoachResult, note: string): void {
    this.coachResult = result;
    note = this.fitNote(note);
    const settle = (): void => {
      this.coachSettled = true;
    };

    const render = (display: { text: string }): void => {
      this.noteText.setText(display.text);
      const named = this.markNamedWords();
      if (this.lane.reducedMotion) {
        this.introText.setAlpha(0);
        this.noteText.setAlpha(1);
        for (const t of named) t.setAlpha(1);
        settle();
        return;
      }
      // One beat, two objects, one rectangle: the instruction leaves on the
      // same duration and ease the note arrives on, so the card reads as
      // Shadow starting to talk rather than as two things swapping places.
      this.tweens.add({
        targets: this.introText,
        alpha: 0,
        duration: DUR.panel,
        ease: EASE.arrive,
      });
      this.tweens.add({
        targets: [this.noteText, ...named],
        alpha: 1,
        duration: DUR.panel,
        ease: EASE.arrive,
        onComplete: settle,
      });
    };

    // `note`, NOT `result.note`. UR-64's rule may have withdrawn an offer the
    // sentence cannot keep, and the string the child HEARS has to be the string
    // the child READS - a spoken promise the screen does not make is the same
    // broken offer with a voice on it.
    const audio = audioFrom(this.registry);
    if (audio === null) {
      render({ text: note });
      return;
    }
    audio.speakNote({ note }, render, "warp.coachNote");
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
      // Not while the card is still arriving: see `entering`. The target is
      // the one this screen already has, so skipping the pop moves nothing.
      if (!this.entering) {
        this.ring.moveTo({ id: "warp-sentence", x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h });
      }
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();

    // UR-189: the coach takes 1.75-2.8 s and `useComposedSentence` will not
    // swap text under a reader, so a child who started in that window lost the
    // composed sentence for good. Early keys are dropped, not queued - they
    // would land on different letters. `typedSinceIntro` is set before the
    // gate because it means "a pilot is at the keyboard", which is what UR-166
    // hands Shadow's card back on.
    this.typedSinceIntro = true;
    if (!this.sentenceSettled) return;

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
      },
    });

    this.clearAndLaunch();
  }

  /**
   * Clear the screen, fly the ship out, and only then cut to Beacon.
   *
   * THE CUT IS OWNED BY THE SHIP, not by the world's acceleration tween, so it
   * cannot happen while the hull is still on screen. The fallback matters: if
   * there is no lantern to fly - the overlay path draws no ship of its own,
   * because the one on screen is Flight's - the exit still has to end, so the
   * timer below is what cuts and it is armed whether or not a ship exists.
   */
  private clearAndLaunch(): void {
    const reduced = this.lane.reducedMotion;

    const pending: Phaser.Tweens.Tween[] = [];

    pending.push(
      this.tweens.add({
        targets: this.panelRoot,
        alpha: 0,
        ...(reduced ? {} : { y: this.panelRoot.y - PANEL_CLEAR_LIFT_PX }),
        duration: PANEL_CLEAR_MS,
        ease: EASE.arrive,
      }),
    );

    /**
     * ============ THE FOCUS RING GOES WITH THE CARD IT IS AROUND ============
     *
     * THE DEFECT, MEASURED. The project owner reported a yellow outline that
     * "lazily stays behind for a bit" after the sentence is typed out, and it
     * is this ring. It is NOT a `rim` on the shared plate - the sentence card
     * is drawn with `corner: "bracket"` and no rim at all, deliberately, and
     * the note in `buildSentencePanel` says why: the ring IS this card's gold
     * line, so there is nothing else on screen that could be mistaken for one.
     *
     * The ring is created OUTSIDE `panelRoot`, at `layer("hud").depth + 1`, so
     * that it draws over the card rather than under it. Nothing was wrong with
     * that; what was wrong is that the tween above fades `panelRoot` and the
     * ring is not in it, so the ring was left painted at full alpha over an
     * empty frame until the scene was torn down. Sampled every animation frame
     * from the last keystroke, in the served build:
     *
     *            panelRoot.alpha   ring.graphics.alpha
     *   +135 ms       0.000               1.000
     *   +701 ms       0.000               1.000
     *   +1601 ms      0.000               1.000
     *
     * The ring outlived the card by the whole of the exit - 260 ms of launch
     * delay plus a 900 ms flight - and then vanished with the scene rather than
     * fading, which is exactly what "lingers, then disappears" looks like.
     *
     * SAME DURATION AND SAME EASE AS THE PANEL, on purpose: it is one beat, not
     * two things that happen to leave at about the same time. UR-82's
     * snap-and-fade teardown is not involved - that is `ui/chrome.FocusRing`,
     * which this screen does not use; the story lane's ring is
     * `scenes/lib/kit.createFocusRing`.
     *
     * ============ AND THE FADE BELONGS TO THE RING, NOT TO THIS SCREEN ============
     *
     * It was `this.tweens.add({ targets: this.ring.graphics, alpha: 0, ... })`
     * written here, and that FIXED NOTHING a player could see: `createFocusRing`
     * breathes the ring with a `repeat: -1` tween on the same `alpha`, so the
     * fade was a second tween on one property and the breath put the ring
     * straight back. Sampled every animation frame from the last keystroke, in
     * the served build, with that tween in place:
     *
     *              panelRoot.alpha   ring.graphics.alpha
     *     Pluto       0.000               1.000   (+1413 ms)
     *     Mars        0.000               0.856   (+1187 ms)
     *     Neptune     0.000               0.865   (+1323 ms)
     *
     * The owner reported it at Pluto; it was every stop. `ring.fadeOut` stops
     * the breath and then fades, because the pulse's handle is the component's
     * and no caller can reach it. Same duration and same ease as the panel, so
     * the beat this note was written about is unchanged.
     */
    this.ring.fadeOut(PANEL_CLEAR_MS, EASE.arrive);

    // UR-104's THIRD FADE IS GONE BECAUSE THE OBJECT IS. The hint line at the
    // foot of the frame was outside `panelRoot`, so the panel fade never
    // reached it and it sat at full alpha over an empty frame for the whole
    // exit. The screen has no hint line any more (`ui/hint.ts`), so there is
    // nothing left outside `panelRoot` but the ring above - which is a
    // stronger guarantee than fading it was.

    /**
     * THE ORDER IS THE POINT (UR-166): the page clears, THEN she cheers, THEN
     * the next screen. She is drawn at the hud depth, outside `panelRoot`, so
     * she is the one thing the panel's fade does not take with it - which is
     * what makes the beat possible rather than being the bug it used to be.
     *
     * Her fade starts once the card is gone and she has had `SHADOW_CHEER_HOLD_MS`
     * of the frame to herself. The cut waits on this tween like any other.
     */
    /**
     * THE CHEER IS A REAL ANIMATION NOW, and that is the whole fix.
     *
     * `setPose("cheering")` is a STATIC pose - sparks drawn once, plus the
     * ambient face-glow pulse - so "hold until she has finished" had nothing to
     * finish and the hold was a number standing in for one. She hops twice into
     * the cleared frame, and the cut waits on THAT tween.
     *
     * Reduced motion (D41) keeps the beat and drops the movement: the pose and
     * its sparks are the information, the hop is the decoration.
     */
    const hopY = this.shadow.root.y;
    if (!reduced) {
      pending.push(
        this.tweens.add({
          targets: this.shadow.root,
          y: { from: hopY, to: hopY - SHADOW_HOP_PX },
          delay: PANEL_CLEAR_MS,
          duration: SHADOW_HOP_MS,
          ease: "Sine.Out",
          yoyo: true,
        }),
      );
    }
    pending.push(
      this.tweens.add({
        targets: this.shadow.root,
        alpha: 0,
        delay: PANEL_CLEAR_MS + (reduced ? SHADOW_CHEER_HOLD_MS : SHADOW_HOP_MS * 2),
        duration: SHADOW_CHEER_EXIT_MS,
        ease: EASE.arrive,
      }),
    );

    const ship = this.lantern?.container ?? null;
    if (ship !== null) {
      pending.push(
        this.tweens.add({
          targets: ship,
          ...(reduced
            ? { alpha: 0 }
            : { y: -SHIP_EXIT_CLEARANCE_PX, scale: ship.scale * 0.72 }),
          delay: SHIP_LAUNCH_DELAY_MS,
          duration: SHIP_LAUNCH_MS,
          ease: reduced ? EASE.arrive : "Cubic.In",
        }),
      );
    }

    /**
     * ONE CUT, WHEN THE LAST THING ON SCREEN HAS ACTUALLY FINISHED.
     *
     * It was `delayedCall(SHIP_LAUNCH_DELAY_MS + SHIP_LAUNCH_MS)` - a number
     * that had to be kept equal to the longest tween by hand, and was not:
     * Shadow's exit was computed backwards off it, so changing either one
     * silently changed when she left. The cut now waits on the tweens
     * themselves, so "the cue plays, then the next page" is enforced by the
     * cue rather than restated as a constant (UR-166).
     *
     * The overlay path draws no ship, so the set is whatever this screen
     * actually started; an empty set cuts on the next frame rather than
     * hanging.
     */
    let waiting = pending.length;
    // ONE call site, so a guard can still say the cut belongs to the exit.
    const done = (): void => {
      waiting -= 1;
      if (waiting <= 0) this.cutToBeacon();
    };
    if (waiting === 0) this.time.delayedCall(0, done);
    else for (const tween of pending) tween.once("complete", done);
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
    this.releaseCoachNote();
    this.paintSentenceCaret();
    this.sampleDebris();
  }

  /**
   * THE PRE-FLIGHT PROMPT'S CARET, ON A LINE THAT WRAPS.
   *
   * `lib/typedWord.paintCaret` is the drawing, unchanged and unduplicated -
   * this project has shipped two cockpit windows, two `WINDOW` rects and two
   * skies, and a second caret would be the fourth. What the shared module
   * needed was not a multi-line mode but a PARAMETER: it used to read the
   * letter's position off a container offset it owned, and it now takes the
   * letter's box. This screen lays every character out at its own absolute
   * position (`layoutLetters` breaks on word boundaries), so a caret on line
   * two is the same call with a different box.
   *
   * Read off the drawn Text every frame rather than computed, so the completed
   * word's pulse (UR-26) carries the caret with it instead of leaving it
   * behind.
   */
  private paintSentenceCaret(): void {
    const letter = this.sentence.charged
      ? undefined
      : this.letters[this.sentence.index];
    paintCaret(
      this.caret,
      letter === undefined
        ? null
        : { x: letter.x, y: letter.y, w: letter.width },
      SENTENCE_PX,
      this.lane.palette.accent,
      this.time.now,
    );
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

  /**
   * UR-64's claim, measured off the two things that are on screen: if the note
   * as drawn offers to type a word again, the sentence as laid out contains
   * that word. True when no offer was made.
   */
  private retryPromiseKept(): boolean {
    const word = promisedWord(this.noteText.text);
    if (word === null) return true;
    return sentenceGives(this.sentence.text, word, this.lane.lang);
  }

  snapshot(): SceneSnapshot {
    const result = this.coachResult;
    return {
      scene: SCENE_KEYS.warp,
      stopId: this.stopId,
      /**
       * The stop whose beacon this charge fills - the row above the sentence
       * and the badge in the card's corner are both drawn from it.
       *
       * Reported so a spec can assert the two agree with EACH OTHER and with
       * the stop `cutToBeacon` forwards, which is the whole of the defect: the
       * screen used to name the stop after this one while the next scene
       * planted this one's beacon, and nothing compared them.
       */
      beaconStopId: this.beaconStopId(),
      // UR-48. The hull this screen draws. The standalone path drew the file
      // constants whoever was flying; the overlay path draws no ship at all and
      // reports null, because the one on screen is Flight's and Flight's was
      // already the pilot's. WHERE it is drawn is `ship.box` below, which this
      // screen already reported and which a spec can crop and look at.
      shipLivery: this.lantern === null ? null : playerLivery(this) ?? null,
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
      /**
       * UR-63. WHERE THE SHIP IS, IN DESIGN COORDINATES.
       *
       * `drawn` is this scene's own rig, which exists only on a standalone
       * boot; overlaid, the Lantern on screen is Flight's and this scene draws
       * nothing (D30). `box` is the same rectangle either way, because both
       * modes stand the ship at the same point at the same scale - which is the
       * property that makes a standalone capture evidence about the game.
       *
       * The box is reported so a spec can CROP IT AND LOOK. Coding standards
       * rule 7: a thing positioned correctly and rendering below the fold was
       * invisible to every assertion three times in one night, so "the ship is
       * on screen" is a claim about pixels and this is only where to find them.
       */
      ship: {
        drawn: this.lantern !== null,
        overlay: this.overlay,
        box: lanternBox(),
        bandTop: shipBandTop(),
        cards: WARP_CARDS.map((card) => ({ ...card })),
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
      /**
       * UR-64. THE INVARIANT, AS DATA.
       *
       * `promisedWord` is read off the note AS DRAWN, not off the note the
       * transport returned, so a test cannot be told the offer was withdrawn by
       * a variable that disagrees with the screen. `keptBySentence` is the
       * claim itself: when the drawn note offers a retry, the drawn sentence
       * contains the word. It is `true` on a screen that never made an offer,
       * because an offer that was not made cannot be broken.
       */
      retry: {
        outcome: this.retry?.outcome ?? null,
        promisedWord: promisedWord(this.noteText.text),
        keptBySentence: this.retryPromiseKept(),
        /** The note before the rule ran, so a test can see what was changed. */
        rawNote: this.coachResult?.note ?? "",
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
      /**
       * THE FOUR RECTANGLES THE REPORTED DEFECTS ARE ABOUT, read off the LIVE
       * objects rather than recomputed from `support/warpLayout.ts`.
       *
       * `warpLayout.test.ts` already asserts the arithmetic without a browser.
       * What it cannot see is the part every one of these four defects lived
       * in: how tall a 52 px sentence's ink really is at this letter spacing,
       * how tall Shadow is actually drawn, which side of the measured label the
       * bolt landed on, and whether the focus ring is still painted after the
       * panels have gone. All four are properties of the rendered frame, so
       * they are read from it.
       *
       * Cheap on purpose - four `getBounds()` calls and two numbers - so a spec
       * may sample it every animation frame while the exit plays, which is the
       * only way the ring's fade is measurable at all.
       */
      boxes: () => {
        const rect = (b: Phaser.Geom.Rectangle): Rect => ({
          x: b.x,
          y: b.y,
          w: b.width,
          h: b.height,
        });
        const letters = this.letters.map((l) => l.getBounds());
        const union = letters.reduce(
          (acc, b) => ({
            top: Math.min(acc.top, b.y),
            bottom: Math.max(acc.bottom, b.y + b.height),
          }),
          { top: Infinity, bottom: -Infinity },
        );
        return {
          panel: { ...PANEL },
          coach: { ...COACH },
          sentenceBand: sentenceRow(),
          sentenceInk:
            letters.length === 0
              ? null
              : { top: union.top, bottom: union.bottom, h: union.bottom - union.top },
          sentenceLines: this.sentenceLines,
          shadow: rect(this.shadow.root.getBounds()),
          chargeLabel: rect(this.chargeLabelText.getBounds()),
          // THE STRING, not just its box. The case a player sees is the table's
          // case put through `theme.chromeCase`, and only the drawn object
          // knows what came out the far end of that - a spec that read the
          // table would pass on a scene that hardcoded its own literal.
          chargeLabelText: this.chargeLabelText.text,
          bolt: { ...this.boltBox },
          ring: {
            alpha: this.ring.graphics.alpha,
            visible: this.ring.graphics.visible,
            active: this.ring.graphics.active,
          },
          panelAlpha: this.panelRoot.alpha,
        };
      },
      /**
       * Take Shadow off the frame, so his DRAWN height can be measured by
       * differencing two screenshots.
       *
       * He is eight `Graphics` in a `Container`, and a Phaser `Graphics` has no
       * meaningful `getBounds()` - the container's comes back as a zero-sized
       * rect at the origin, which is what the first attempt at this measurement
       * got and very nearly believed. The only honest source for how tall he is
       * actually drawn is the pixels, and the pixels can only be attributed to
       * him by turning him off and subtracting.
       */
      setShadowVisible: (visible: boolean) => {
        this.shadow.root.setVisible(visible);
      },
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
      parallaxOffsets: () => this.parallax.debugOffsets(),
      motion: () => this.parallax.debugMotion(),
    });
  }
}
