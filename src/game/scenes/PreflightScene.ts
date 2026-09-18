import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, paletteAt, type StopPalette } from "@game/render/palette";
import { EASE, buildParallax, skyAt, type Parallax } from "@game/render/parallax";
import { INK, SPACE, TYPE } from "@game/ui/theme";
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

/**
 * Screen inventory row 5 - Pre-flight (D51, D81, D99, PRD FR-11).
 *
 * The ship's startup sequence. It runs in one of three modes:
 *
 *   "full"   - D51's ~20 s measured ritual, D81's three steps, five or six
 *              words. Once per profile, for a pilot the game has never
 *              measured. UNCHANGED by D99.
 *   "launch" - D99's launch ceremony. Every LATER stop. Two short words on the
 *              systems row, about five seconds of typing, and a real
 *              re-measurement that is BLENDED into the stored baseline rather
 *              than replacing it (`foldLaunchCeremony`).
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
 *  2. By what is drawn: three lamps that go from dark to lit. There is no
 *     counter, no percentage, no tick-or-cross and no number anywhere on the
 *     screen - `snapshot().text` carries every string rendered so the e2e can
 *     assert that, rather than trusting this comment.
 *  3. By what a mismatch does: the plate nudges and the letter stays unlit.
 *     Nothing is tallied, nothing turns red, nothing is called a mistake.
 *
 * The sequence is a real sequence and not a timer with a label on it: systems
 * light in D81's order (hull, systems, engines), the planet swings into the
 * window one leg per step, and Shadow changes pose as each system comes up.
 */

const LEAD_MS = 1400;
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
  controlStrip,
  mullionHorizontalAt,
  planetCy,
  planetFill,
  planetLegX,
  planetParkX,
  planetRadius,
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
}

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
  private planet!: Phaser.GameObjects.Container;
  private lineText!: Phaser.GameObjects.Text;
  private hintText!: HintLine;
  /** Off-display-list Graphics backing the window mask. */
  private maskSource: Phaser.GameObjects.Graphics | null = null;
  /** UR-39: the Escape/Backspace listener, so shutdown can remove it. */
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private readyText!: Phaser.GameObjects.Text;

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
  private calibration: Calibration = DEFAULT_CALIBRATION;

  constructor() {
    super(SCENE_KEYS.preflight);
  }

  init(data: StoryInit): void {
    this.story = resolveInit(data, "mars");
    this.phase = "lead";
    this.stepIndex = 0;
    this.wordIndex = 0;
    this.played = [];
    this.currentWords = [];
    this.currentKeys = [];
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
    const seed = 0x51_7a1 + STOP_IDS.indexOf(stopId) * 977;
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
      // The stop's planet is drawn here, not by the parallax, because it has
      // to SWING IN; the parallax owns its celestial layer's position.
      decorate: ["sky", "farField", "midField", "nearField"],
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

    this.readyText = label(this, ROW.x, ROW.y - 96, text.text("preflight.ready"), {
      size: TYPE.heading,
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
     * THE PLANET: ONE FLAT DISC (UR-77 item 3).
     *
     * It was four overlapping translucent circles - an accent glow, a body, a
     * highlight and a terminator - at r=300, and it read as a grey-brown
     * thumbprint however the terminator's hue was adjusted, because stacking
     * translucent circles is what makes mud. The Briefing's planet is the
     * shared celestial body: one flat disc, a third the size, hazed into the
     * sky and separated from it by value. This is that, with the swing the
     * ritual needs. The arithmetic is in `preflightLayout.planetFill`, checked
     * against `render/parallax.ts`'s own lines by the unit test.
     */
    const r = planetRadius(GAME_WIDTH, GAME_HEIGHT);
    const cy = planetCy();
    const disc = this.add.graphics();
    disc.fillStyle(hexToNum(planetFill(pal, skyAt(pal, cy / GAME_HEIGHT))), 1);
    disc.fillCircle(0, 0, r);
    // Parked off the right edge of the glass. It arrives over the whole
    // sequence on Cubic.Out, so the ship reads as coming about.
    this.planet = this.add.container(planetParkX(r), cy, [disc]).setDepth(2);
    this.planet.setMask(win.glass);

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

    skyText(this, HEADING.x, HEADING.y, text.text("preflight.heading"), {
      screen: "preflight",
      id: "preflight.heading",
      size: TYPE.heading,
      color: INK.text,
      lang,
      depth: 20,
      padY: 14,
    });
    skyText(this, SUBHEADING.x, SUBHEADING.y, this.stopName(), {
      screen: "preflight",
      id: "preflight.stop",
      size: TYPE.body,
      color: accent,
      lang,
      depth: 20,
      padY: 8,
    });

    const chip = backChip();
    plate(this, chip.x, chip.y, chip.w, chip.h, { fill: INK.panelRaised }).setDepth(20);
    label(this, chip.x + chip.w / 2, chip.y + chip.h / 2, text.text("preflight.back"), {
      size: TYPE.label,
      color: INK.text,
      align: "center",
      lang,
    })
      .setOrigin(0.5)
      .setDepth(21);

    // A pointer target on the chip, so the mouse can leave by the same control
    // the keyboard does. `HIT_ZONE_PREFIX` is what the pointer e2e enumerates.
    this.add
      .zone(chip.x, chip.y, chip.w, chip.h)
      .setOrigin(0, 0)
      .setName(`${HIT_ZONE_PREFIX}preflight-back`)
      .setDepth(22)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.goBack());
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
      this.rows.push({ id: spec.id, lamp, state: "dark" });
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
    if (row.state === "lit") {
      g.fillStyle(hexToNum(pal.accent), 0.85);
      g.fillRoundedRect(ROW.x + 128, y + 16, ROW.w - 180, 8, 4);
    }
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
    this.phase = "intro";
    this.phaseUntil = time + this.introMs();
    // The planet arrives one leg per step, so the view is still coming about
    // when the last system lights.
    this.tweens.add({
      targets: this.planet,
      x: planetLegX(RITUAL_STEPS.length - 1 - this.stepIndex),
      duration: this.introMs() + 900,
      ease: EASE.arrive,
    });
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

  private finishStep(time: number): void {
    const spec = RITUAL_STEPS[this.stepIndex];
    const row = this.rows[this.stepIndex];
    if (spec !== undefined && row !== undefined) {
      row.state = "lit";
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
    this.hintText.setAlpha(0);
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
    this.tweens.add({
      targets: this.readyText,
      alpha: 1,
      y: { from: this.readyText.y + 12, to: this.readyText.y },
      duration: 420,
      ease: EASE.pop,
    });
    this.tweens.add({
      targets: this.planet,
      x: WINDOW.x + WINDOW.w * 0.62,
      duration: finaleMs,
      ease: EASE.arrive,
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

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
    this.prompt?.update(time);
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
