import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, mixHex, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { INK, TYPE } from "@game/ui/theme";
import { drawShadow, type ShadowFigure, type ShadowPose } from "@game/render/shadow";
import {
  RITUAL_BUDGET_MS,
  RITUAL_STEPS,
  type CalibrationStepId,
  type Keystroke,
  type RitualPlan,
  type RitualStepInput,
  type RitualWordInput,
  computeCalibration,
  measureStep,
  planRitual,
} from "@engine/calibration";
import { DEFAULT_CALIBRATION, STOP_IDS, type Calibration } from "@engine/types";
import { label, plate, visibleText, type SceneSnapshot, type Snapshotable } from "./lib/kit";
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
 * Screen inventory row 5 - Pre-flight (D51, D81, PRD FR-11).
 *
 * The ship's startup sequence, 5-20 seconds of it. On a NEW profile it is the
 * calibration ritual wearing a costume; on a returning profile it is the same
 * costume with nothing underneath (AC-11.2) - the rows still light, the planet
 * still swings into frame, Shadow still says his line, and nothing is measured
 * because history already did it.
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

const ROW = { x: 120, y: 300, w: 560, h: 116, gap: 26 };
const WINDOW = { x: 900, y: 170, w: 900, h: 600, r: 48 };

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
  private hintText!: Phaser.GameObjects.Text;
  private readyText!: Phaser.GameObjects.Text;

  private plan: RitualPlan | null = null;
  private calibrating = false;
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
    // (no typing history AND the untouched default baseline), so a returning
    // pilot is still skipped and still gets the costume with nothing underneath.
    // The payload flag is kept as an OVERRIDE so a harness can mount the ritual
    // deliberately; it is no longer what the real game depends on.
    this.calibration = storedCalibration(this) ?? this.story.calibration;
    const wantsRitual = this.story.newProfile || profileNeedsCalibration(this);
    this.plan = wantsRitual
      ? planRitual(ritualPool(stopId), rng(0x51_7a1 + STOP_IDS.indexOf(stopId) * 977))
      : null;
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
      seed: 0x51f1,
    });

    this.drawWindowAndPlanet(pal.accent, pal.colorRoles["sky"] ?? pal.colors[0] ?? INK.panel);
    this.drawRows();

    this.shadow = drawShadow(this, 200, GAME_HEIGHT - 230, "asleep", {
      scale: 0.86,
      reducedMotion: ctx.reducedMotion,
      depth: 20,
    });

    plate(this, 356, GAME_HEIGHT - 300, 700, 112, { alpha: 0.92 }).setDepth(19);
    this.lineText = label(this, 388, GAME_HEIGHT - 272, text.text("preflight.line.opening"), {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: 636,
      lang,
    }).setDepth(20);

    this.hintText = label(this, GAME_WIDTH / 2, GAME_HEIGHT - 96, text.text("preflight.hint"), {
      size: TYPE.caption,
      color: INK.textFaint,
      align: "center",
      lang,
    })
      .setOrigin(0.5)
      .setDepth(20)
      .setAlpha(0);

    this.readyText = label(this, ROW.x, ROW.y - 96, text.text("preflight.ready"), {
      size: TYPE.heading,
      color: INK.accentSoft,
      lang,
    })
      .setDepth(20)
      .setAlpha(0);

    this.startedAtMs = this.time.now;
    this.phaseUntil = this.startedAtMs + LEAD_MS;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private drawWindowAndPlanet(accent: string, body: string): void {
    const shape = this.make.graphics({}, false);
    shape.fillStyle(0xffffff, 1);
    shape.fillRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);
    const mask = shape.createGeometryMask();
    for (const l of this.parallax.layers) l.container.setMask(mask);

    // The planet, parked off the right edge of the glass. It arrives over the
    // whole sequence on Cubic.Out, so the ship reads as coming about.
    const r = 300;
    const disc = this.add.graphics();
    disc.fillStyle(hexToNum(accent), 0.1);
    disc.fillCircle(0, 0, r * 1.4);
    disc.fillStyle(hexToNum(body), 1);
    disc.fillCircle(0, 0, r);
    disc.fillStyle(hexToNum(mixHex(body, INK.text, 0.24)), 0.55);
    disc.fillCircle(-r * 0.26, -r * 0.28, r * 0.66);
    // The night side has to stay INSIDE the disc. An offset circle big enough
    // to read as a terminator spills past the limb and draws a second planet
    // beside the first, so the offset plus the radius is kept under 1.0.
    disc.fillStyle(hexToNum(INK.bgDeep), 0.4);
    disc.fillCircle(r * 0.22, r * 0.2, r * 0.66);
    this.planet = this.add
      .container(WINDOW.x + WINDOW.w + r * 1.2, WINDOW.y + WINDOW.h * 0.52, [disc])
      .setDepth(2);
    this.planet.setMask(mask);

    const frame = this.add.graphics().setDepth(14);
    const hull = this.add.graphics().setDepth(13);
    hull.fillStyle(hexToNum(INK.bg), 1);
    hull.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const cutout = shape.createGeometryMask();
    cutout.setInvertAlpha(true);
    hull.setMask(cutout);

    frame.lineStyle(14, hexToNum(INK.panelRaised), 1);
    frame.strokeRoundedRect(WINDOW.x - 7, WINDOW.y - 7, WINDOW.w + 14, WINDOW.h + 14, WINDOW.r + 7);
    frame.lineStyle(3, hexToNum(mixHex(accent, INK.text, 0.45)), 0.45);
    frame.strokeRoundedRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, WINDOW.r);
    frame.fillStyle(hexToNum(INK.panelRaised), 0.9);
    frame.fillRect(WINDOW.x + WINDOW.w * 0.38 - 8, WINDOW.y, 16, WINDOW.h);
  }

  private drawRows(): void {
    const { lang, text } = this.story;
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

  private beginStep(time: number): void {
    const spec = RITUAL_STEPS[this.stepIndex];
    const row = this.rows[this.stepIndex];
    if (spec === undefined || row === undefined) {
      this.beginFinale(time);
      return;
    }
    row.state = "active";
    this.say(STEP_LINE_KEY[spec.id], "pointing");
    this.wordIndex = 0;
    this.currentWords = [];
    this.phase = "intro";
    this.phaseUntil = time + STEP_INTRO_MS;
    // The planet arrives one leg per step, so the view is still coming about
    // when the last system lights.
    const legs = RITUAL_STEPS.length;
    this.tweens.add({
      targets: this.planet,
      x: WINDOW.x + WINDOW.w * 0.62 - (legs - 1 - this.stepIndex) * 260,
      duration: STEP_INTRO_MS + 900,
      ease: EASE.arrive,
    });
  }

  private nextWord(time: number): void {
    const planStep = this.plan?.steps[this.stepIndex];
    const word = planStep?.words[this.wordIndex];
    if (word === undefined) {
      this.finishStep(time);
      return;
    }
    const pal = paletteAt(this.story.stopId, this.story.ctx.colorblindPalette);
    this.currentKeys = [];
    this.prompt?.destroy();
    this.prompt = createWordPrompt(this, {
      word,
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT * 0.62,
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
        const shown = this.prompt?.shownAtMs ?? this.time.now;
        this.currentWords.push({ word, shownAtMs: shown, keystrokes: [...this.currentKeys] });
        this.wordIndex += 1;
        this.prompt?.destroy();
        this.prompt = null;
        this.nextWord(this.time.now);
      },
    });
    this.hintText.setAlpha(1);
    this.phase = "typing";
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
    this.phaseUntil = time + STEP_SETTLE_MS;
  }

  private beginFinale(time: number): void {
    this.phase = "finale";
    this.phaseUntil = time + FINALE_MS;
    if (this.calibrating) {
      this.calibration = computeCalibration(this.played).calibration;
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
      duration: FINALE_MS,
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
        // Driven entirely by the child's keystrokes; nothing times them out.
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
      preflightLine: stageBundle(this.story.stopId).preflightLine,
      text: visibleText(this),
    };
  }

  private promptWord(): string | null {
    const planStep = this.plan?.steps[this.stepIndex];
    return planStep?.words[this.wordIndex] ?? null;
  }

  private teardown(): void {
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
};
