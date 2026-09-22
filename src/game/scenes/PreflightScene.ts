import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, paletteAt, type StopPalette } from "@game/render/palette";
import { EASE, buildParallax, skyAt, type Parallax } from "@game/render/parallax";
import { DUR, INK, SPACE, STEP, TYPE } from "@game/ui/theme";
import { PANEL, rivetPositions } from "@game/ui/panel";
import { paintPlate } from "@game/ui/plate";
import { drawShadow, type ShadowFigure, type ShadowPose } from "@game/render/shadow";
import {
  PREFLIGHT_ASSIST_GIVE_UP,
  RITUAL_BUDGET_MS,
  RITUAL_STEPS,
  type CalibrationStepId,
  type Keystroke,
  type LaunchFoldResult,
  type RitualPlan,
  type RitualStepInput,
  type RitualWordInput,
  computeCalibration,
  foldLaunchCeremony,
  measureStep,
  planLaunchCeremony,
  planRitual,
  promptAssistMs,
} from "@engine/calibration";
import { DEFAULT_CALIBRATION, STOP_IDS, type Calibration } from "@engine/types";
import {
  label,
  plate,
  skyText,
  drawBackChip,
  type PlatedText,
  visibleText,
  type SceneSnapshot,
  type Snapshotable,
} from "./lib/kit";
import { HIT_ZONE_PREFIX } from "@game/ui/focus";
import { createWordPrompt, type WordPrompt } from "./lib/typedWord";
import { ritualPool, stageBundle } from "./lib/content";
import {
  goTo,
  persistCalibration,
  profileNeedsCalibration,
  resolveInit,
  storedCalibration,
  type ResolvedInit,
  type StoryInit,
} from "./lib/init";
import type { SceneStringKey } from "./lib/strings";
import { audioFrom } from "@game/audio/wiring";
import { systemCheckSemitones } from "@game/audio/sfx";

/**
 * Screen inventory row 5 - Pre-flight (D51, D81, D99, PRD FR-11).
 *
 * The ship's startup sequence. It runs in one of three modes:
 *
 *   "full"   - D51's ~20 s measured ritual, D81's three steps, six or seven
 *              words since UR-101.3. Once per profile, for a pilot the game has
 *              never measured. UNCHANGED by D99.
 *   "launch" - D99's launch ceremony. Every LATER stop. The same steps and the
 *              same word counts (UR-57 delegated its planner to `planRitual`),
 *              and a real re-measurement that is BLENDED into the stored
 *              baseline rather than replacing it (`foldLaunchCeremony`).
 *   "none"   - the fallback, and now only the fallback: the rows light on a
 *              timer and nothing is typed. Reached when the stop's content pool
 *              cannot supply the ceremony's words (Earth ships an empty pool,
 *              D57), never as the ordinary case.
 *
 * "none" USED TO BE THE ORDINARY CASE, and UR-28 is what that cost. The ritual
 * was gated on `newProfile || profileNeedsCalibration`, both of which go false
 * for ever once a baseline is stored, so one stop consumed the ritual and stops
 * 2-7 mounted this screen with `plan = null`. The comment that stood here
 * described that state as a costume with nothing underneath, and that is
 * exactly what UR-28 reports: a Pre-flight screen with nothing to type, six
 * times.
 *
 * It was also a measurement defect. Calibration was taken once, at the coldest
 * moment a child will ever have, and never updated as they warmed up - the same
 * shape as the bug that left `ikiMs` pinned at 350 ms and made the belt
 * unsurvivable. The ceremony's samples now reach the profile by the same route
 * the full ritual's do.
 *
 * NEITHER MODE IS A GATE (D99, D100). Both typing phases used to be driven
 * entirely by keystrokes with nothing timing them out, so a child who could not
 * type the prompt never advanced - not after a retry, not eventually. For the
 * ceremony that was six locked doors on a route (`UR-28`); for the FULL ritual
 * it was worse (`UR-31`), because it is the first screen with typing a
 * brand-new player ever sees and it trapped precisely the seven-year-old this
 * game exists for.
 *
 * Both now carry `promptAssistMs`: a word that has been on the glass for three
 * times what the game estimates it costs this child is quietly dismissed, the
 * row lights, and the sequence continues. No message, no mark, no tally, no
 * "let's try that again" (D31, AC-22b.1). After
 * `PREFLIGHT_ASSIST_GIVE_UP` words in a row that nobody touched, the screen
 * stops asking entirely and the remaining rows light on their own - six
 * untouched windows would be 42 s of a child watching a word they cannot type,
 * and nothing after the second one tells the game anything new.
 *
 * AC-11.3 IS LOAD-BEARING and is enforced three ways, not promised once:
 *
 *  1. Structurally, by the engine: `@engine/calibration` takes a `Keystroke`
 *     with a position and a time and NO CHARACTER, so accuracy is not withheld
 *     during the ritual, it is uncomputable from what the measuring code is
 *     given. This scene can only hand it positions and timestamps.
 *  2. By what is drawn: three lamps that go from dark to lit, each over a bar
 *     that fills as the step runs. There is no counter, no tick-or-cross and no
 *     NUMBER anywhere on the screen - `snapshot().text` carries every string
 *     rendered so the e2e can assert that, rather than trusting this comment.
 *
 *     UR-101.2 ADDED THE FILL AND IT IS STILL NOT A GRADE, for a structural
 *     reason rather than an intention: the bar is `max(typed, elapsed)`
 *     (`preflightLayout.checkBarProgress`), so at the end of a step it is FULL
 *     for a child who typed every letter and FULL for a child who touched
 *     nothing. A drawing that cannot tell those two apart cannot be read as a
 *     mark on either of them. What it reports is how far through the ceremony
 *     the SHIP is, which is exactly what the lamp beside it already reported,
 *     at a resolution the lamp does not have.
 *  3. By what a mismatch does: the plate nudges and the letter stays unlit.
 *     Nothing is tallied, nothing turns red, nothing is called a mistake.
 *
 * The sequence is a real sequence and not a timer with a label on it: systems
 * light in D81's order (hull, systems, engines), the planet swings into the
 * window one leg per step, and Shadow changes pose as each system comes up.
 */

const LEAD_MS = 1400;
/** Equal air above the eyebrow and under the stop name (UR-160). */
/**
 * A masthead is the biggest type on the screen and the plate has to breathe
 * around it. `STEP.inset`, on the scale, not a bespoke number: 16 was cut so
 * close to the ink that the owner read it as too tight (UR-167).
 */
const HEADER_PAD = STEP.inset;

/** Phaser reports these when the font has loaded; the fallbacks are its own ratios. */
function metricsOf(t: Phaser.GameObjects.Text): { ascent: number; descent: number } {
  const m = (t.style as unknown as { metrics?: { ascent: number; descent: number } }).metrics;
  if (m === undefined) return { ascent: t.height * 0.8, descent: t.height * 0.2 };
  return m;
}

function descentOf(t: Phaser.GameObjects.Text): number {
  return Math.max(0, t.height - metricsOf(t).ascent);
}

/** The empty band above a line's capitals, inside its own box. */
function leadingAbove(t: Phaser.GameObjects.Text): number {
  const size = Number.parseFloat(String(t.style.fontSize)) || t.height;
  return Math.max(0, metricsOf(t).ascent - size * CAP_HEIGHT_EM);
}

/** Avenir Next's cap height, measured. */
const CAP_HEIGHT_EM = 0.72;

const STEP_INTRO_MS = 900;
const STEP_SETTLE_MS = 620;
const FINALE_MS = 1500;
/** Returning profiles: no typing, so the rows are what sets the pace (D51). */
const RETURNING_ROW_MS = 1200;

/**
 * The launch ceremony's beats (D99, UR-57).
 *
 * Every one is shorter than the full ritual's equivalent, because this screen
 * is paid SIX times on a route out to Pluto and D51's ~20 s was priced as a
 * once-per-profile cost. What UR-57 changed is that ALL THREE steps now carry
 * words, so all three use these beats - there is no longer a "spectator" row
 * with a shorter one, and `LAUNCH_ROW_*` went with it rather than sitting in
 * the file as a branch nothing can reach.
 *
 * Total, excluding typing: 1000 + 3 x (760 + 520) + 1300 = 6.14 s. The words
 * cost 8.8-10.4 s at the shipped baseline and about 14 s for a grade-2 pilot.
 * `tests/unit/scenes/preflightAssist.test.ts` pins the worst cases to these
 * constants.
 */
const LAUNCH_LEAD_MS = 1000;
const LAUNCH_STEP_INTRO_MS = 760;
const LAUNCH_STEP_SETTLE_MS = 520;
const LAUNCH_FINALE_MS = 1300;

/**
 * What this mount of the screen is doing. See the file header.
 *
 * `calibrating` (the snapshot field the e2e has always read) stays true for
 * both measuring modes; this says WHICH, because "a ritual ran" and "the
 * baseline was replaced" are no longer the same statement.
 */
export type RitualMode = "full" | "launch" | "none";

/**
 * Geometry lives in `support/preflightLayout.ts` so it can be asserted without
 * a browser. The typed word used to be anchored to `GAME_WIDTH / 2` and the
 * window is a 900 px aperture at x=900, so at 16:9 the word plate straddled the
 * window frame - see that module's header.
 */
import {
  HEADER_PLATE,
  HEADER_SPINE,
  HEADING,
  BULKHEAD,
  LINE_PAD,
  LINE_PLATE,
  LINE_SHADOW,
  PROMPT,
  ROW,
  SHELF,
  SUBHEADING,
  WINDOW,
  backChip,
  checkBarProgress,
  controlStrip,
  mullionHorizontalAt,
  windowRect,
} from "./support/preflightLayout";
import { drawCockpitWindow } from "@game/ui/viewportWindow";
import { VIEWPORT_WINDOW } from "@game/ui/viewportWindowLayout";
import { drawControlSurface } from "@game/ui/controlSurface";
import { type HintLine, drawHint } from "@game/ui/hintLine";
import { typographyOf } from "./lib/typography";

const STEP_LABEL_KEY: Readonly<Record<CalibrationStepId, SceneStringKey>> = {
  hull: "preflight.step.hull",
  systems: "preflight.step.systems",
  engines: "preflight.step.engines",
};

const STEP_LINE_KEY: Readonly<Record<CalibrationStepId, SceneStringKey>> = {
  hull: "preflight.line.hull",
  systems: "preflight.line.systems",
  engines: "preflight.line.engines",
};

type Phase = "lead" | "intro" | "typing" | "settle" | "finale" | "done";

interface RowView {
  readonly id: CalibrationStepId;
  readonly lamp: Phaser.GameObjects.Graphics;
  state: "dark" | "active" | "lit";
  /**
   * UR-101.2. `target` is what the step is actually worth right now and only
   * ever rises; `shown` is what is drawn, easing toward it. Two numbers and not
   * one because the bar has to be BOTH honest and smooth, and a single value
   * lerped toward a raw reading is neither - it would retreat whenever the
   * reading dipped, which D31 forbids in the one place the child is looking.
   */
  barTarget: number;
  barShown: number;
}

/**
 * HOW FAST THE CHECK BAR CATCHES UP WITH ITS OWN VALUE (UR-101.2).
 *
 * `DUR.focus`, 140 ms, used as an exponential time constant: the shortest thing
 * on `theme.DUR`'s scale that is not a snap, and the one already named for "a
 * control responding to input". At the FR-8 default the child's keys land 350 ms
 * apart, so 140 ms delivers ~63% of a keystroke's step before the next key and
 * ~95% within 420 ms. The bar therefore MOVES ON THE FRAME THE KEY IS TYPED and
 * settles before the following one, which is what makes it read as caused by
 * the key rather than as an animation that happens to be running.
 *
 * Anything longer was rejected on the stated ground: if the bar lags, the child
 * stops connecting their typing to it, which is the entire point of the item.
 */
const BAR_EASE_MS = DUR.focus;

/**
 * How close to the target counts as arrived.
 *
 * Exponential easing is asymptotic, so without a snap the bar would sit at
 * 99.8% for ever and the "reaches exactly full when the step completes" claim
 * would be false by a fraction nobody can see and a test can. Half of one
 * pixel of a 404 px bar is ~0.0012; 0.002 is past that.
 */
const BAR_SNAP = 0.002;

/** mulberry32, seeded per stop so a screenshot compares like with like. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PreflightScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private prompt: WordPrompt | null = null;
  private rows: RowView[] = [];
  private lineText!: Phaser.GameObjects.Text;
  private hintText!: HintLine;
  /** Off-display-list Graphics backing the window mask. */
  private maskSource: Phaser.GameObjects.Graphics | null = null;
  /** UR-39: the Escape/Backspace listener, so shutdown can remove it. */
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private readyText!: Phaser.GameObjects.Text;
  /** The stop name, which steps aside for the ready line (UR-94). */
  private stopNamePlate: Phaser.GameObjects.Text | null = null;

  private plan: RitualPlan | null = null;
  private mode: RitualMode = "none";
  private calibrating = false;
  /** D99/D100: when the current prompt carries the child past it, in both modes. */
  private assistAtMs: number | null = null;
  /** D100: words carried past back to back. Reset by any completed word. */
  private assistedInARow = 0;
  /** D100: set once `PREFLIGHT_ASSIST_GIVE_UP` is hit; no further prompts. */
  private stoppedAsking = false;
  private launchFold: LaunchFoldResult | null = null;
  private phase: Phase = "lead";
  private stepIndex = 0;
  private wordIndex = 0;
  private startedAtMs = 0;
  private phaseUntil = 0;
  private played: RitualStepInput[] = [];
  private currentWords: RitualWordInput[] = [];
  private currentKeys: Keystroke[] = [];
  /** UR-101.2: accepted keystrokes so far in THIS step, across all its words. */
  private stepKeysTyped = 0;
  /** UR-101.2: what the step is worth in keystrokes. The plan already knows. */
  private stepKeysTotal = 0;
  /** UR-101.2: the current prompt's assist window, for the clock half of the bar. */
  private promptWindowMs = 0;
  private calibration: Calibration = DEFAULT_CALIBRATION;

  constructor() {
    super(SCENE_KEYS.preflight);
  }

  init(data: StoryInit): void {
    this.story = resolveInit(data, "mars", this);
    this.phase = "lead";
    this.stepIndex = 0;
    this.wordIndex = 0;
    this.played = [];
    this.currentWords = [];
    this.currentKeys = [];
    this.stepKeysTyped = 0;
    this.stepKeysTotal = 0;
    this.promptWindowMs = 0;
    this.rows = [];
    this.prompt = null;
    this.assistAtMs = null;
    this.assistedInARow = 0;
    this.stoppedAsking = false;
    this.launchFold = null;
    this.mode = "none";
    this.calibration = this.story.calibration;
  }

  create(): void {
    const { ctx, lang, text } = this.story;
    const stopId = this.story.stopId;
    const pal = paletteAt(stopId, ctx.colorblindPalette);

    // D51/AC-11.2: only a profile that has never been measured is measured -
    // and "never been measured" is now asked of the PROFILE.
    //
    // THIS LINE USED TO READ `this.story.newProfile`, AND THAT FLAG IS NEVER
    // SET. Title, ProfilePicker, ProfileCreate, the map and the briefing all
    // pass `false` (the briefing forwards what it was given, which is `false`),
    // so `calibrating` was false for every child who ever played, the ritual
    // never ran once, and `calibration.ikiMs` stayed on FR-8's 350 ms default
    // for ever. Fall time is set from that number, so a grade-2 typist at
    // 600 ms between keys was handed a belt tuned for a child who types nearly
    // twice as fast: every cold word breached. See `scenes/lib/init.ts`.
    //
    // `needsCalibration` is the engine's own predicate for the same question
    // (no typing history AND the untouched default baseline). The payload flag
    // is kept as an OVERRIDE so a harness can mount the full ritual
    // deliberately; it is no longer what the real game depends on.
    //
    // D99 / UR-28: what that predicate now chooses is WHICH ritual, not WHETHER
    // one runs. False used to mean "nothing to type"; it means "the short one".
    this.calibration = storedCalibration(this) ?? this.story.calibration;
    const wantsFullRitual = this.story.newProfile || profileNeedsCalibration(this);
    const pool = ritualPool(stopId);
    // A DIFFERENT RITUAL EVERY RUN. This was a pure function of the stop, so
    // the ceremony asked for the same words in the same order every time a
    // child launched from it. Nothing here is scored, so there is nothing that
    // needs to replay identically.
    const seed = (0x51_7a1 + STOP_IDS.indexOf(stopId) * 977) ^ (Date.now() >>> 4);
    if (wantsFullRitual) {
      this.plan = planRitual(pool, rng(seed));
      this.mode = this.plan === null ? "none" : "full";
    } else {
      // A different seed from the full ritual's, so a pilot who ran the ritual
      // at this stop is not handed the same first two words at the next visit.
      this.plan = planLaunchCeremony(pool, rng(seed ^ 0x1a17));
      this.mode = this.plan === null ? "none" : "launch";
    }
    this.calibrating = this.plan !== null;

    this.cameras.main.setBackgroundColor(INK.bgDeep);
    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: ctx.reducedMotion,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      // THE PLANET IS THE PARALLAX'S AGAIN (UR-96).
      //
      // This list excluded "celestial" and the scene drew its own disc, for one
      // stated reason: it had to SWING IN. It swung on entry and again on every
      // typed word, which is what was reported - a planet that jumps whenever
      // the child succeeds. With the swing gone the reason is gone, and the
      // Briefing's window next door has always shown a still planet from this
      // same layer. Two screens, one implementation, one position.
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      // UR-120: this stack is MASKED to the cockpit glass, so the light has to
      // be placed inside the aperture rather than at its full-frame position -
      // which for Earth through Saturn is behind the briefing card.
      lightBand: { x: WINDOW.x, w: WINDOW.w },
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x51f1,
    });

    this.drawWindowAndPlanet(pal.accent, pal);
    this.drawRows();
    this.drawHeader(pal.accent);

    // INSIDE the dialogue plate, the way the warp break's coach is
    // (`support/preflightLayout.LINE_SHADOW`). He stood at (200, 850) and the
    // plate moved to the gutter under him.
    this.shadow = drawShadow(this, LINE_SHADOW.x, LINE_SHADOW.y, "asleep", {
      scale: LINE_SHADOW.scale,
      reducedMotion: ctx.reducedMotion,
      depth: 20,
    });

    // ON THE GUTTER (UR-39). This plate was at x=356 and its text at 388, so
    // one frame carried four different left edges. Opaque, like every other
    // card: see `lib/kit.plate`.
    plate(this, LINE_PLATE.x, LINE_PLATE.y, LINE_PLATE.w, LINE_PLATE.h).setDepth(19);
    this.lineText = label(
      this,
      LINE_PLATE.x + LINE_PAD.x,
      LINE_PLATE.y + LINE_PAD.y,
      text.text("preflight.line.opening"),
      {
        size: TYPE.body,
        color: INK.text,
        wrapWidth: LINE_PLATE.w - LINE_PAD.x * 2,
        lang,
      },
    ).setDepth(20);

    // Under the glass, with the word it is about. `INK.textFaint` measured
    // 4.31:1 on the hull - below AC-22.8's 4.5:1 - and this is the line that
    // tells a child what to do, so it is drawn in the same dim ink the rest of
    // the chrome uses.
    // IN THE BAND EVERY SIBLING USES (UR-39). It floated at the window's centre
    // - which is where the WORD is, not where a child looks for instructions -
    // while every other screen puts its hint bottom-left on the gutter.
    // THE SHARED RENDERER (`ui/hintLine.ts`). It was `label` with the screen's
    // own `HINT` constant and no plate, which is the third of the three
    // treatments one line had; the constant is gone with it, because a screen
    // that cannot name a position cannot pick the wrong one.
    this.hintText = drawHint(this, text.text("preflight.hint"), {
      screen: "preflight",
      id: "preflight.hint",
      depth: 20,
      style: { lang, ...typographyOf(this) },
    });

    // THE READY LINE REPLACES THE STOP NAME (UR-94). It was drawn at
    // `ROW.y - 96` = 204 in `TYPE.heading` while the stop name's plate runs to
    // 211, so the two overlapped by seven pixels - and it sat on the GUTTER at
    // 96 while the name sat on the ink line at 118. Two defects from one magic
    // offset. It takes the name's own line now and the name steps aside.
    this.readyText = label(this, SUBHEADING.x, SUBHEADING.y, text.text("preflight.ready"), {
      size: TYPE.body,
      color: INK.accentSoft,
      lang,
    })
      .setDepth(20)
      .setAlpha(0);

    this.startedAtMs = this.time.now;
    this.phaseUntil =
      this.startedAtMs + (this.mode === "launch" ? LAUNCH_LEAD_MS : LEAD_MS);

    // ESCAPE WAS INERT (UR-39). This scene never installed a keyboard handler
    // at all, so the one key every other screen leaves by did nothing here -
    // the same defect as UR-27 one screen further on, and worse, because there
    // was no pointer control either. The typed prompt has its own listener
    // (`lib/typedWord`) and is untouched: this handles only the way out.
    this.onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" && event.key !== "Backspace") return;
      event.preventDefault();
      this.goBack();
    };
    this.input.keyboard?.on("keydown", this.onKey);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /**
   * THE COCKPIT, AND THE PLANET COMING ABOUT IN IT.
   *
   * ================== ONE WINDOW, NOT TWO (UR-77) ==================
   * This method used to hand-draw the whole cockpit: the aperture mask, the
   * gradient hull, the inverted cutout, two frame rings and a single vertical
   * strut. `BriefingScene.drawCockpit` did the same thing thirty lines at a
   * time, differently - a CROSS instead of one strut, at a different fraction,
   * in a slightly different ink. The owner noticed the missing crosshatch and
   * inferred the real fault from it: the window was never a shared component.
   *
   * So the window is `ui/viewportWindow.drawCockpitWindow` and both screens
   * call it. The strip under the glass is `ui/controlSurface.drawControlSurface`
   * and both screens call that too - it had exactly one caller in the whole
   * product before this, and it was not this screen, which is why Pre-flight
   * had no vents, no screws and no bezel under a 76 px plate with nine painted
   * dots on it.
   */
  private drawWindowAndPlanet(accent: string, pal: StopPalette): void {
    const win = drawCockpitWindow(this, {
      aperture: windowRect(),
      radius: WINDOW.r,
      accent,
      world: { w: GAME_WIDTH, h: GAME_HEIGHT },
      // The cross, with the horizontal strut lifted clear of the typed word -
      // the one thing about this window that is genuinely per-screen, and it is
      // derived from the plate rather than chosen (`preflightLayout`).
      mullions: {
        verticalAt: VIEWPORT_WINDOW.verticalAt,
        horizontalAt: mullionHorizontalAt(),
      },
      hullDepth: 13,
      frameDepth: 14,
    });
    // KEPT, so `teardown` can destroy it: a Graphics from `make.graphics` is
    // not on the display list and `scene.restart()` leaves it behind.
    this.maskSource = win.maskSources[0] ?? null;
    for (const l of this.parallax.layers) l.container.setMask(win.glass);

    /**
     * The window's furniture. The PLANET is not here: the parallax's
     * `celestial` layer draws it through this glass (UR-96), the same way the
     * Briefing's window has always shown it.
     */
    // NO PRIVATE DISC (UR-96). The parallax's `celestial` layer draws the stop's
    // planet through this same glass, exactly as the Briefing's window does, so
    // a second one here would be two planets and the drift that comes with two
    // implementations of one thing.

    // THE STRIP, AS THE BRIEFING'S OWN HARDWARE (UR-61 by way of UR-77).
    // Painted into the frame's Graphics rather than adding a second one.
    drawControlSurface(win.frame, controlStrip(), {
      lamps: SHELF.lamps,
      lit: STOP_IDS.indexOf(this.story.stopId),
      accent,
    });
  }

  /**
   * The header and the way out (UR-39).
   *
   * This screen had NOTHING above y=320 - the only story screen in the product
   * with no title, no stop name and no chrome at the top of the frame - and no
   * way back at all: unlike the Briefing it never installed a keyboard handler,
   * so Escape was inert and there was no pointer control either.
   *
   * The chip is the Director map's treatment, the same one the Briefing uses,
   * so the two cockpit screens offer the same way out in the same place.
   */
  private drawHeader(accent: string): void {
    const { lang, text } = this.story;

    // UR-124: one masthead, the Briefing's - accent spine, eyebrow, stop name.
    // UR-167: sized to the INK, not the text box. The box carries a descender
    // band under "Pluto", which has no descender, and internal leading above
    // the eyebrow's caps - so a plate cut to the box is padded unevenly.
    const eyebrow = label(this, HEADING.x, HEADING.y, text.text("preflight.heading"), {
      size: TYPE.caption,
      color: INK.textDim,
      lang,
    }).setDepth(20);
    this.stopNamePlate = label(this, SUBHEADING.x, SUBHEADING.y, this.stopName(), {
      size: TYPE.heading,
      color: INK.text,
      lang,
    }).setDepth(20);

    const inkTop = eyebrow.y + leadingAbove(eyebrow);
    const inkBottom = this.stopNamePlate.y + this.stopNamePlate.height - descentOf(this.stopNamePlate);
    const plate = {
      x: HEADER_PLATE.x,
      y: inkTop - HEADER_PAD,
      w: HEADER_PLATE.w,
      h: inkBottom - inkTop + HEADER_PAD * 2,
    };
    const header = this.add.graphics().setDepth(17);
    paintPlate(header, plate, {
      fill: INK.panel,
      radius: SPACE.radiusCard,
      strokeWidth: 0,
    });
    paintPlate(
      header,
      { x: HEADER_SPINE.x, y: plate.y + STEP.tight, w: HEADER_SPINE.w, h: plate.h - STEP.tight * 2 },
      { fill: accent, alpha: 0.85, corner: "pill", strokeWidth: 0 },
    );

    // ONE CHIP, SHARED WITH THE BRIEFING (UR-98). This screen drew a 262x66
    // plate in `INK.panelRaised` at `TYPE.label` where the Briefing drew a
    // 224x48 in `INK.panel` at `TYPE.caption` - two controls, one name, on two
    // screens a child walks straight between. The component owns all of it.
    drawBackChip(this, {
      depth: 20,
      label: text.text("preflight.back"),
      lang,
      hitId: "preflight-back",
      onPress: () => this.goBack(),
    });
  }

  /** The stop this ritual is for, named. */
  private stopName(): string {
    return stageBundle(this.story.stopId).planetName;
  }

  /**
   * Back to the Director map. One path, whichever input asked for it.
   *
   * Never mid-launch: once the veil is up the scene is leaving anyway, and a
   * child who presses Escape during the cut should not get two transitions.
   */
  private goBack(): void {
    if (this.phase === "done") return;
    this.phase = "done";
    goTo(this, SCENE_KEYS.map, {
      ctx: { ...this.story.ctx, stopId: this.story.stopId },
      progress: this.story.progress,
      shipName: this.story.shipName,
      lang: this.story.lang,
      newProfile: this.story.newProfile,
      calibration: this.calibration,
      stopId: this.story.stopId,
    });
  }

  private drawRows(): void {
    const { lang, text } = this.story;

    // THE RACK THE ROWS ARE BOLTED TO (UR-39). They floated on bare hull, and
    // three cards on a wall do not read as instruments. Milled charcoal with
    // screw heads at the corners - the console's own material and the same
    // `rivetPositions` the Settings panel uses.
    const bulkhead = this.add.graphics().setDepth(15);
    // A STEP LIGHTER THAN THE HULL, not darker. The first cut used
    // `faceShade`, which is below the hull's own value, so the rack read as a
    // hole cut in the wall rather than a plate bolted to it - `ui/panel.ts`
    // says exactly this about recesses and it applies here too.
    paintPlate(bulkhead, BULKHEAD, {
      fill: PANEL.face,
      alpha: 1,
      stroke: PANEL.lip,
      strokeAlpha: 0.7,
      rhythm: "card",
    });
    for (const rivet of rivetPositions(BULKHEAD, 22)) {
      bulkhead.fillStyle(hexToNum(PANEL.rivet), 1);
      bulkhead.fillCircle(rivet.x, rivet.y, 5);
      bulkhead.fillStyle(hexToNum(PANEL.rivetLit), 1);
      bulkhead.fillCircle(rivet.x - 1, rivet.y - 1.5, 2.4);
    }
    RITUAL_STEPS.forEach((spec, i) => {
      const y = ROW.y + i * (ROW.h + ROW.gap);
      plate(this, ROW.x, y, ROW.w, ROW.h, { fill: INK.panelSunken }).setDepth(16);
      label(this, ROW.x + 128, y + ROW.h / 2 - 20, text.text(STEP_LABEL_KEY[spec.id]), {
        size: TYPE.label,
        color: INK.textDim,
        lang,
      }).setDepth(18);
      const lamp = this.add.graphics().setDepth(17);
      this.rows.push({ id: spec.id, lamp, state: "dark", barTarget: 0, barShown: 0 });
    });
  }

  private paintRow(row: RowView, i: number, time: number): void {
    const pal = paletteAt(this.story.stopId, this.story.ctx.colorblindPalette);
    const y = ROW.y + i * (ROW.h + ROW.gap) + ROW.h / 2;
    const x = ROW.x + 64;
    const g = row.lamp;
    g.clear();
    // A lit system is cool instrument blue, not the stop accent. Three coral
    // rings in a column read as warning lamps however the palette justifies
    // the hue, and nothing on this screen may read as an alarm (D31).
    const colour =
      row.state === "lit" ? INK.lit : row.state === "active" ? INK.accentSoft : INK.locked;
    const breathe = row.state === "active" ? 0.6 + Math.sin(time / 260) * 0.35 : 1;
    if (row.state !== "dark") {
      g.fillStyle(hexToNum(colour), 0.18 * breathe);
      g.fillCircle(x, y, 44);
    }
    g.fillStyle(hexToNum(colour), row.state === "dark" ? 1 : breathe);
    g.fillCircle(x, y, 18);
    g.lineStyle(3, hexToNum(row.state === "dark" ? INK.line : colour), 1);
    g.strokeCircle(x, y, 26);
    // A row that is done gets a filled bar, not a tick: a tick has a partner
    // that AC-22b.1 forbids, and this screen must never imply its opposite.
    //
    // ================== UR-101.2: IT WAS BINARY ==================
    // This was `if (row.state === "lit")` and nothing else, so the bar went
    // from nothing to everything with no state in between - a progress bar with
    // two positions, on the one instrument the child is looking at while they
    // type. It fills as they type now; `stepProgress` owns the value and this
    // only draws `barShown`.
    //
    // THE TRACK IS ALWAYS THERE, lit or dark. A bar that appears when it starts
    // filling is a second object arriving; a bar that was always an empty
    // channel is an instrument reading. It also gives the rack something to
    // hold before the ritual starts, which is the "8.6% busy" problem UR-39
    // measured, answered with structure rather than decoration.
    const barX = ROW.x + 128;
    const barY = y + 16;
    const barW = ROW.w - 180;
    const barH = 8;
    g.fillStyle(hexToNum(INK.line), 0.55);
    g.fillRoundedRect(barX, barY, barW, barH, 4);
    if (row.barShown > 0) {
      // UR-178: the bar wears the LAMP's colour, not the stop's. Drawn in
      // `pal.accent` it read gold at Jupiter and blue at Neptune beside a lamp
      // that is blue at every stop - the rack is one instrument, so it does not
      // change colour by destination.
      g.fillStyle(hexToNum(row.state === "lit" ? INK.lit : INK.accentSoft), 0.85);
      // Floored at the bar's own height so the FIRST accepted keystroke moves
      // something visible rather than drawing a 3 px sliver of a rounded rect.
      g.fillRoundedRect(barX, barY, Math.max(barH, barW * row.barShown), barH, 4);
    }
  }

  /**
   * HOW FULL THE ACTIVE STEP'S BAR SHOULD BE, 0..1 (UR-101.2).
   *
   * ================== THE RULE ==================
   * `max(typed, elapsed)`. Not a sum, and not a switch between them.
   *
   *   TYPED    accepted keystrokes in this step / the step's total keystrokes,
   *            across ALL of its words, so a four-word step is one continuous
   *            fill and not four jumps. This is the half that makes the bar
   *            feel driven by the child's hands.
   *   ELAPSED  how far through the step the screen's own clock is - D100's
   *            `promptAssistMs` window, per word, plus the words already
   *            retired. This is UR-31's timeout, which until now had NO visible
   *            form at all.
   *
   * ================== WHY BOTH ==================
   * Nobody is forced to type and the ship cannot leave without pre-flight, so a
   * bar driven only by keystrokes sits at zero while the step completes
   * underneath it - the display and the truth would disagree, on the exact
   * screen D100 exists to stop trapping a child. And a bar driven only by the
   * clock ignores the child entirely.
   *
   * `max` is what makes typing only ever pull the bar AHEAD of the clock. A
   * quick typist fills it in a second; a child who types nothing watches it fill
   * on its own and still launches; a child typing slowly sees their own keys
   * outrunning the clock, which is the honest picture of what is happening.
   *
   * ================== WHAT IT MAY NEVER DO ==================
   * Go backwards. The caller keeps `barTarget` as a running maximum, so a typo -
   * which advances nothing - leaves the bar exactly where it was. D31 governs
   * that: a mistake is not punished, and a bar that retreats is a punishment
   * drawn in the one place the child is looking.
   */
  private stepProgress(time: number): number {
    const words = this.plan?.steps[this.stepIndex]?.words ?? [];
    // `assistAtMs` is the deadline `nextWord` armed, so the time already spent
    // is the window less what is left of it. Null between words, which reads as
    // a clean slot edge rather than as a word that has been on screen forever.
    const wordElapsedMs =
      this.assistAtMs === null ? 0 : this.promptWindowMs - (this.assistAtMs - time);
    return checkBarProgress({
      typedKeys: this.stepKeysTyped,
      totalKeys: this.stepKeysTotal,
      wordIndex: this.wordIndex,
      wordCount: words.length,
      wordElapsedMs,
      wordWindowMs: this.assistAtMs === null ? 0 : this.promptWindowMs,
    });
  }

  // -------------------------------------------------------------------------
  // The sequence
  // -------------------------------------------------------------------------

  /**
   * Shadow says a line.
   *
   * AC-21.6's ordering applies here too and for the same reason: the TEXT is
   * the line. It is set first, and the system voice is handed the string that
   * was drawn - not a second copy of the copy - so a player with no voices
   * installed reads exactly what a player with voices hears, and the screen is
   * identical either way. The voice bus ducks the music and the bed while he
   * talks (AC-21.4) and un-ducks itself when the utterance ends.
   *
   * `audioFrom` returning null is the standalone-harness case and is silent by
   * design; the line still renders.
   */
  private say(key: SceneStringKey, pose: ShadowPose): void {
    const line = this.story.text.text(key);
    this.lineText.setText(line);
    this.shadow.setPose(pose);
    this.tweens.add({
      targets: this.lineText,
      alpha: { from: 0.2, to: 1 },
      duration: 260,
      ease: EASE.arrive,
    });
    audioFrom(this.registry)?.speak({ id: key, text: line, kind: "scripted" });
  }

  /** Words this step will actually prompt for. Zero for a ceremony's spectators. */
  private plannedWordCount(index: number): number {
    return this.plan?.steps[index]?.words.length ?? 0;
  }

  private beginStep(time: number): void {
    const spec = RITUAL_STEPS[this.stepIndex];
    const row = this.rows[this.stepIndex];
    if (spec === undefined || row === undefined) {
      this.beginFinale(time);
      return;
    }
    row.state = "active";
    // D99: a ceremony speaks ONCE. Three of Shadow's lines inside four seconds
    // would overlap each other, which P1 item 1.6 forbids outright, and two of
    // the three rows have nothing to introduce. `preflight.line.returning` is
    // the copy written for a pilot who has done this before, so it is the one
    // the ceremony uses, and it lands on the row that actually asks for a word.
    if (this.mode === "launch") {
      // UR-57: three steps now, but still ONE spoken line - three of Shadow's
      // inside ten seconds would overlap each other, which P1 item 1.6 forbids.
      // `preflight.line.returning` is the copy written for a pilot who has done
      // this before, and it lands on the first step rather than on each.
      if (this.stepIndex === 0) this.say("preflight.line.returning", "pointing");
    } else {
      this.say(STEP_LINE_KEY[spec.id], "pointing");
    }
    this.wordIndex = 0;
    this.currentWords = [];
    // UR-101.2: the bar's denominator. The plan already knows every word this
    // step will ask for, so the total is a fact about the step rather than
    // something that has to be discovered as the child types - which is what
    // lets the bar be continuous across a step's words instead of per word.
    this.stepKeysTyped = 0;
    this.stepKeysTotal = (this.plan?.steps[this.stepIndex]?.words ?? []).reduce(
      (n, w) => n + [...w].length,
      0,
    );
    this.promptWindowMs = 0;
    this.phase = "intro";
    this.phaseUntil = time + this.introMs();
    // The planet arrives one leg per step, so the view is still coming about
    // when the last system lights.

  }

  /**
   * How long a step's intro beat lasts. Mode only, since UR-57: every step of
   * a ceremony carries words, so there is no shorter "spectator" beat left.
   * A step the child was carried past keeps its full beat - the sequence does
   * not speed up as a reward for not typing.
   */
  private introMs(): number {
    return this.mode === "launch" ? LAUNCH_STEP_INTRO_MS : STEP_INTRO_MS;
  }

  /** How long a step's settle beat lasts. Same rule. */
  private settleMs(): number {
    return this.mode === "launch" ? LAUNCH_STEP_SETTLE_MS : STEP_SETTLE_MS;
  }

  private nextWord(time: number): void {
    const planStep = this.plan?.steps[this.stepIndex];
    const word = planStep?.words[this.wordIndex];
    // D100: once the screen has stopped asking, every remaining prompt is
    // skipped in silence. Not "failed" and not "skipped" on screen - the rows
    // simply light the way they do for a profile with nothing to type.
    if (word === undefined || this.stoppedAsking) {
      this.finishStep(time);
      return;
    }
    const pal = paletteAt(this.story.stopId, this.story.ctx.colorblindPalette);
    this.currentKeys = [];
    this.prompt?.destroy();
    this.prompt = createWordPrompt(this, {
      word,
      // ON THE GLASS. Anchored to the WINDOW, never to the screen: the two
      // are not concentric and only the window is a fixed rectangle.
      x: PROMPT.x,
      y: PROMPT.y,
      size: TYPE.display,
      accent: pal.accent,
      plateFill: pal.plate,
      plateText: pal.plateText,
      parkGraceMs: this.calibration.ikiMs * 1.5,
      reducedMotion: this.story.ctx.reducedMotion,
      depth: 22,
      onAdvance: (index, nowMs) => {
        // Position and time. No character: AC-11.3 by construction.
        this.currentKeys.push({ charIndex: index, atMs: nowMs });
        // UR-101.2. A COUNT, not a score. It is the numerator of a fill and
        // never leaves this object - nothing derived from it is drawn as a
        // number and no comparison against the target word reaches it, so
        // AC-11.3 is as untouched here as it is in the engine.
        this.stepKeysTyped += 1;
      },
      onComplete: () => {
        // A word the child finished. D100: the give-up counter is about words
        // NOBODY touched, so any completion clears it.
        this.assistedInARow = 0;
        this.retireWord(word);
        this.nextWord(this.time.now);
      },
    });
    this.hintText.setAlpha(1);
    this.phase = "typing";
    // D99/D100: neither mode blocks. This used to be set only in "launch",
    // which left the full first-run ritual a hard gate (`UR-31`) - the one
    // screen where being stranded costs a child the whole game, because they
    // have not reached a single belt yet.
    this.assistAtMs = time + promptAssistMs(word, this.calibration);
    // UR-101.2 fills the bar's clock half from this window, and it is DERIVED
    // from the deadline that was just armed rather than taken from a second
    // call to `promptAssistMs`. Two reasons, and the second one is the real one:
    // the drawing and the timeout cannot disagree about how long the word had,
    // and the line above keeps the exact shape `preflightAssist.test.ts` greps
    // for. Writing this as `promptWindowMs = promptAssistMs(...)` and then
    // `assistAtMs = time + this.promptWindowMs` turned that guard RED -
    // "the scene never arms an assist window" - which is the guard doing its
    // job: it is the only thing standing between this screen and UR-31.
    this.promptWindowMs = this.assistAtMs - time;
  }

  /**
   * Bank whatever was typed for `word` and take the prompt off the glass.
   *
   * Used by both exits - the child finished it, or the assist window ran out -
   * because a PARTIAL word is still a measurement: `measureStep` reads the
   * intervals between the keys that did land and ignores the rest. There is no
   * third path in which anything is scored, marked or counted.
   */
  private retireWord(word: string): void {
    const shown = this.prompt?.shownAtMs ?? this.time.now;
    this.currentWords.push({ word, shownAtMs: shown, keystrokes: [...this.currentKeys] });
    this.wordIndex += 1;
    this.assistAtMs = null;
    this.prompt?.destroy();
    this.prompt = null;
  }

  /**
   * A CHECK ROW COMES UP: the bar lands full and the system sounds (UR-101).
   *
   * ================== THE BAR (UR-101.2) ==================
   * `barTarget = 1`, EXACTLY, and this is the only place it is set to a literal.
   * A child who typed everything is already there - the last keystroke put
   * `stepKeysTyped` equal to `stepKeysTotal` - so for them this line changes
   * nothing and the bar simply arrives. It matters for the two paths where the
   * step ends before the words run out: D100's give-up, which skips the rest of
   * the step in silence, and a step with no words at all. Without it the bar
   * would light a row at a third full, which is the one thing worse than a
   * binary bar - a row that says "done" over an instrument that says "not".
   *
   * ================== THE SOUND (UR-101.5) ==================
   * `lock`, transposed. The rows lit in silence before; the vocabulary that was
   * already in the game and already right is `SFX_VARIANTS.lock` - "a small
   * confident upward confirmation" - and `systemCheckSemitones` walks the three
   * rows up a major triad so the sequence reads as a system coming up rather
   * than as three identical beeps. Nothing new was sampled and the argument for
   * those three numbers is in `audio/sfx.ts` next to them.
   *
   * IT LANDS WITH THE FILL, NOT NEAR IT. This runs on the same call that sets
   * the bar to full, so the chime and the bar arriving are one event rather
   * than two things happening at about the same time - which is the seam that
   * would otherwise open between this item and the per-keystroke clack
   * (UR-101.4) now running underneath it.
   */
  private lightRow(row: RowView, index: number): void {
    row.barTarget = 1;
    audioFrom(this.registry)?.play("lock", "preflight:check-row", {
      pitchSemitones: systemCheckSemitones(index),
    });
  }

  private finishStep(time: number): void {
    const spec = RITUAL_STEPS[this.stepIndex];
    const row = this.rows[this.stepIndex];
    if (spec !== undefined && row !== undefined) {
      row.state = "lit";
      this.lightRow(row, this.stepIndex);
      if (this.calibrating) {
        const input: RitualStepInput = { id: spec.id, words: [...this.currentWords] };
        this.played.push(input);
        // measureStep is called per step (not only at the end) because it is
        // what lets Shadow react to a step the child actually attempted
        // without waiting for the whole ritual - and because it is timings
        // only, so reacting to it cannot become a grade.
        const outcome = measureStep(input);
        this.shadow.setPose(outcome.attempted ? "cheering" : "idle");
      } else {
        this.shadow.setPose("cheering");
      }
    }
    // THE HINT DOES NOT BLINK OUT WITH THE WORD (UR-97).
    //
    // It was hidden here, on the settle beat - which is the exact moment the
    // word leaves the glass - so the instructions vanished every time a child
    // succeeded and came back when the next word arrived. A keyboard hint that
    // flashes is worse than none: it draws the eye away from the window on the
    // one frame the child has just earned.
    //
    // It is shown for the whole ritual now. `setAlpha(1)` on the typing beat
    // below is kept because the line fades IN when the first word does, and
    // that entrance is still wanted.
    this.phase = "settle";
    this.phaseUntil = time + this.settleMs();
  }

  private beginFinale(time: number): void {
    this.phase = "finale";
    const finaleMs = this.mode === "launch" ? LAUNCH_FINALE_MS : FINALE_MS;
    this.phaseUntil = time + finaleMs;
    if (this.mode === "full") {
      // The full ritual REPLACES the baseline: five or six words measured from
      // scratch is the whole of what the game knows (AC-11.1).
      this.calibration = computeCalibration(this.played).calibration;
    } else if (this.mode === "launch") {
      // The ceremony BLENDS (AC-11.4/AC-11.5). Two words is a real sample and a
      // poor baseline; replacing on six intervals would let one fumbled word at
      // Neptune set the difficulty of Pluto. `foldLaunchCeremony` owns the rule
      // - minimum-sample gate, a smaller alpha than a stage of play earns, and
      // a rate limit on the direction that makes the next belt harder.
      const fold = foldLaunchCeremony(this.calibration, this.played);
      this.launchFold = fold;
      this.calibration = fold.calibration;
    }
    // AC-11.1 "stored on the profile". The ritual's answer used to travel to
    // Flight as scene data and nowhere else, so it was gone by the next stop
    // and gone entirely on reload - the twenty seconds bought one stage at
    // most. Written for the returning case too: `storedCalibration` may have
    // rebuilt a baseline from history (D51), and that is worth keeping.
    persistCalibration(this, this.calibration);
    this.say("preflight.line.done", "saluting");
    const name = this.stopNamePlate;
    if (name !== null) {
      // A plain Text since UR-124 put the masthead on one plate: the stop's
      // name no longer carries a plate of its own to fade with it.
      this.tweens.add({ targets: name, alpha: 0, duration: 260, ease: EASE.arrive });
    }
    this.tweens.add({
      targets: this.readyText,
      alpha: 1,
      y: { from: this.readyText.y + 12, to: this.readyText.y },
      duration: 420,
      ease: EASE.pop,
    });

  }

  private complete(): void {
    this.phase = "done";
    goTo(this, SCENE_KEYS.flight, {
      ctx: { ...this.story.ctx, stopId: this.story.stopId },
      progress: this.story.progress,
      shipName: this.story.shipName,
      lang: this.story.lang,
      newProfile: false,
      calibration: this.calibration,
      stopId: this.story.stopId,
    });
  }

  /**
   * Move every bar one frame toward what its step is worth (UR-101.2).
   *
   * TWO SEPARATE GUARANTEES, and they are why this is not one lerp:
   *
   *   MONOTONIC. `barTarget` is a running maximum, so nothing the child does or
   *   fails to do can lower it. A typo advances no keystroke, the clock has not
   *   moved backwards, and the bar therefore holds. D31.
   *
   *   SMOOTH BUT CAUSED. `barShown` eases toward the target on `BAR_EASE_MS`,
   *   framerate-independently, so a keystroke moves the bar on the frame it is
   *   typed without the bar lurching. `reducedMotion` takes the value straight
   *   (AC-19.3): the information is in the length, never in the animation.
   *
   * The snap at `BAR_SNAP` is what makes "exactly full" true rather than
   * asymptotically nearly true.
   */
  private advanceBars(time: number, delta: number): void {
    const active = this.rows[this.stepIndex];
    if (
      active !== undefined &&
      active.state === "active" &&
      (this.phase === "typing" || this.phase === "intro")
    ) {
      active.barTarget = Math.max(active.barTarget, this.stepProgress(time));
    }
    const k = this.story.ctx.reducedMotion
      ? 1
      : 1 - Math.exp(-Math.max(0, delta) / BAR_EASE_MS);
    for (const row of this.rows) {
      if (row.barShown === row.barTarget) continue;
      row.barShown += (row.barTarget - row.barShown) * k;
      if (Math.abs(row.barTarget - row.barShown) < BAR_SNAP) row.barShown = row.barTarget;
    }
  }

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
    this.prompt?.update(time);
    this.advanceBars(time, delta);
    this.rows.forEach((row, i) => this.paintRow(row, i, time));

    switch (this.phase) {
      case "lead":
        if (time >= this.phaseUntil) {
          this.shadow.setPose("idle");
          if (this.calibrating) {
            this.beginStep(time);
          } else {
            this.say("preflight.line.returning", "idle");
            this.phase = "settle";
            this.phaseUntil = time + RETURNING_ROW_MS;
          }
        }
        break;

      case "intro":
        if (time >= this.phaseUntil) this.nextWord(time);
        break;

      case "typing":
        // Driven by the child's keystrokes, until the assist window says the
        // child is not going to produce any. A prompt nobody can type must
        // never be a wall between a child and the belt, in either mode
        // (D99/AC-11.6, D100/AC-11.7).
        if (this.assistAtMs !== null && time >= this.assistAtMs) {
          const word = this.promptWord();
          this.assistAtMs = null;
          // Whatever was typed is banked first: a partial word is still a
          // measurement, and this must never be the branch where something is
          // thrown away for not being finished.
          if (word !== null) this.retireWord(word);
          this.assistedInARow += 1;
          if (this.assistedInARow >= PREFLIGHT_ASSIST_GIVE_UP) this.stoppedAsking = true;
          this.nextWord(time);
        }
        break;

      case "settle":
        if (time < this.phaseUntil) break;
        if (this.calibrating) {
          this.stepIndex += 1;
          if (this.stepIndex >= RITUAL_STEPS.length) this.beginFinale(time);
          else this.beginStep(time);
        } else {
          // Returning ritual: the rows light on their own, in D81's order.
          const next = this.rows.find((r) => r.state !== "lit");
          if (next === undefined) {
            this.beginFinale(time);
          } else {
            next.state = "lit";
            // UR-101: the "none" path lights rows on a timer with no plan
            // behind them, so it fills and sounds them here rather than through
            // `finishStep`. A returning pilot who is shown the sequence must
            // see and hear the same instrument a typing one does - that
            // divergence is the shape of UR-28 and it is not being rebuilt.
            this.lightRow(next, this.rows.indexOf(next));
            this.phaseUntil = time + RETURNING_ROW_MS;
          }
        }
        break;

      case "finale":
        if (time >= this.phaseUntil) this.complete();
        break;

      case "done":
        break;
    }
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.preflight,
      stopId: this.story.stopId,
      calibrating: this.calibrating,
      // D99: WHICH ritual this mount is running. `calibrating` alone can no
      // longer answer it, and "a word appeared" is the thing UR-28 is about.
      ritual: this.mode,
      /** Words this mount will ask the child to type. 0 only in "none". */
      promptedWords: this.plan?.steps.reduce((n, s) => n + s.words.length, 0) ?? 0,
      phase: this.phase,
      stepIds: this.rows.map((r) => r.id),
      rowStates: this.rows.map((r) => r.state),
      /**
       * UR-101.2: how full each check bar is drawn, 0..1.
       *
       * NOT RENDERED, and that distinction is the whole of AC-11.3's survival
       * here. The screen draws a LENGTH; this object carries the number that
       * length was computed from so an e2e can assert the bar moved on the
       * first keystroke, never retreated and landed at exactly 1 - none of
       * which is checkable from a screenshot. `snapshot().text` still contains
       * no number, and `visibleText` is what proves it.
       *
       * `barShown` rather than `barTarget`: the claim worth testing is about
       * what the child sees, not about what the scene intends.
       */
      rowProgress: this.rows.map((r) => Math.round(r.barShown * 1000) / 1000),
      /** The denominator the bar is filling against, for the same reason. */
      stepKeysTotal: this.stepKeysTotal,
      stepKeysTyped: this.stepKeysTyped,
      currentWord: this.prompt === null ? null : this.promptWord(),
      elapsedMs: Math.round(this.time.now - this.startedAtMs),
      budgetMs: RITUAL_BUDGET_MS,
      shadowPose: this.shadow.pose,
      // Timings in ms. Never rendered; here so the e2e can prove the ritual
      // measured something without the screen ever showing a number.
      calibration: this.calibration,
      stepsMeasured: this.played.length,
      /**
       * What each of D81's three steps actually CONTRIBUTED, step by step.
       *
       * `stepsMeasured: 3` and three lit rows are satisfied by a step that ran
       * and yielded nothing - which is the shape UR-31 reports, a sequence that
       * appears to complete while the measure behind it is still FR-8's
       * default. The counts here are what separates "the step ran" from "the
       * step measured the pilot", per step, so a test can name which one went
       * quiet instead of only seeing 350/500 at the end.
       *
       * Counts and durations only; no character and no comparison against the
       * target word ever reaches this object (AC-11.3). Never rendered.
       */
      stepSamples: this.played.map((input) => {
        const outcome = measureStep(input);
        return {
          id: outcome.id,
          words: input.words.length,
          keystrokes: outcome.keystrokeCount,
          ikiSamples: outcome.ikiSamplesMs.length,
          fkSamples: outcome.fkLatencySamplesMs.length,
          discarded: outcome.discardedSamples,
        };
      }),
      // D99 evidence: what the ceremony's fold actually did, so an e2e can
      // prove the re-measurement reached the baseline and prove the sample
      // gate held when it should. Never rendered (AC-11.3).
      launchIkiSamples: this.launchFold?.ikiSamples ?? 0,
      launchFkSamples: this.launchFold?.fkSamples ?? 0,
      launchFoldedIki: this.launchFold?.foldedIki ?? false,
      launchFoldedFkLatency: this.launchFold?.foldedFkLatency ?? false,
      launchTightenClamped: this.launchFold?.tightenClamped ?? false,
      // D100 evidence: how many prompts the screen carried the child past, and
      // whether it stopped asking. Never rendered (AC-11.3).
      assistedInARow: this.assistedInARow,
      stoppedAsking: this.stoppedAsking,
      preflightLine: stageBundle(this.story.stopId).preflightLine,
      text: visibleText(this),
    };
  }

  private promptWord(): string | null {
    const planStep = this.plan?.steps[this.stepIndex];
    return planStep?.words[this.wordIndex] ?? null;
  }

  private teardown(): void {
    if (this.onKey !== null) this.input.keyboard?.off("keydown", this.onKey);
    this.onKey = null;
    this.maskSource?.destroy();
    this.maskSource = null;
    this.prompt?.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}

export const PREFLIGHT_TIMING = {
  LEAD_MS,
  STEP_INTRO_MS,
  STEP_SETTLE_MS,
  FINALE_MS,
  RETURNING_ROW_MS,
  LAUNCH_LEAD_MS,
  LAUNCH_STEP_INTRO_MS,
  LAUNCH_STEP_SETTLE_MS,
  LAUNCH_FINALE_MS,
  /**
   * Everything the launch ceremony costs apart from the typing itself.
   *
   * UR-57 put words on all three steps, so all three now use the TYPED beats -
   * the two that used to be spectators cost `LAUNCH_ROW_*` and now cost
   * `LAUNCH_STEP_*`. `tests/unit/scenes/preflightAssist.test.ts` pins the
   * arithmetic to these constants so the worst case cannot drift silently.
   */
  LAUNCH_OVERHEAD_MS:
    LAUNCH_LEAD_MS +
    3 * (LAUNCH_STEP_INTRO_MS + LAUNCH_STEP_SETTLE_MS) +
    LAUNCH_FINALE_MS,
};
