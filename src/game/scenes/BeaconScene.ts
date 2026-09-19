import { markStopCleared } from "@engine/progress/index.js";
import Phaser from "phaser";
import { beaconReadout, type BeaconResult } from "@engine/ephemeris";
import type { StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { headerText } from "@game/ui/grid";
import {
  SHADOW_SCALE,
  button as actionRect,
  card,
  coordsWrapWidth,
  flavourWrapWidth,
  MAST_GROUND_Y,
  MAST_X,
  rows as cardRows,
  shadowOrigin,
} from "./support/beaconLayout";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum } from "@game/render/palette";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { DUR, INK, TYPE } from "@game/ui/theme";
import { hasStageBundle, stageBundle } from "./lib/content";
import { goTo, persistStopCleared, type StoryInit } from "./lib/init";
import {
  createFocusRing,
  createKeyboardMenu,
  label,
  plate,
  skyText,
  skyTextSamples,
  visibleText,
  type PlatedText,
  type FocusRing,
  type FocusTarget,
  type KeyboardMenu,
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
import { audioFrom } from "@game/audio/wiring";

/**
 * SCREEN 8 - BEACON PLACEMENT (design-brief-v2.md "8. Beacon placement";
 * D15, D81; PRD FR-17 / AC-17.0, AC-17.1, AC-17.3).
 *
 * The beacon drops onto the planet, lights, and says where it is - for real.
 * `@engine/ephemeris` computes heliocentric ecliptic coordinates for the play
 * date from the JPL approximate elements and is tested against live JPL
 * Horizons values. This scene computes nothing and formats nothing:
 * `formatBeaconCoords` and `formatPulsarFix` already produce the exact D81
 * strings, so the readout is printed verbatim. Re-rounding it here would be a
 * second, quieter definition of the same format.
 *
 * THE FAILURE BRANCH IS THE ONE THAT MATTERS. `beaconReadout` returns a
 * discriminated union, and `ok: false` happens for real - a device clock set to
 * 1776, or to nothing at all. The engine's own header says the union exists
 * because "the scene has to render *something* even when the device clock is
 * nonsense". So this scene branches on `ok` and, with no coordinates, says the
 * beacon is calibrating: same plate, same place, same colour, the stop's
 * flavour line still underneath. It is never an error, never a warning colour,
 * and the literal "NaN" cannot reach a child because no number is formatted in
 * this file at all.
 */

/**
 * WHERE EVERYTHING ON THIS SCREEN IS: `support/beaconLayout.ts`.
 *
 * It used to be four literals in this file - a 1728x268 card at y 664, a
 * 420x64 button on the LEFT gutter, three row offsets of 44/116/172, and
 * `drawShadow(this, 300, 470, ..., { scale: 0.9 })`. This file imports Phaser,
 * so not one of them could be measured by a node test; they are now derived,
 * and `tests/unit/scenes/beaconLayout.test.ts` measures them.
 */

export interface BeaconInit extends StoryInit {
  /**
   * The play date (AC-17.1). Injected rather than read off the wall clock, so
   * every test is deterministic; production passes nothing and gets `now`.
   */
  readonly date?: Date | string | number;
  readonly payload?: Record<string, unknown>;
}

export class BeaconScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: BeaconInit | undefined;
  private stopId: StopId = "mars";

  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;
  private menu!: KeyboardMenu;

  private readout!: BeaconResult;
  private coordsLabel!: Phaser.GameObjects.Text;
  private flavourLabel!: Phaser.GameObjects.Text;
  /** Measured wrap, not reserved: the card is sized to what is in it. */
  private flavourLines = 1;
  private coordsLines = 1;
  private mast!: Phaser.GameObjects.Container;
  private lit = false;
  /** Latched on a render pass; see `latchOnRender`. Never sampled. */
  private focusRingDrawn!: DrawLatch;

  constructor() {
    super(SCENE_KEYS.beacon);
  }

  init(data: BeaconInit | undefined): void {
    this.initData = data;
    this.lit = false;
  }

  create(): void {
    this.lane = laneInit(this, this.initData, "mars");
    this.stopId = this.lane.stopId;

    this.parallax = buildParallax(this, {
      palette: this.lane.palette,
      reducedMotion: this.lane.reducedMotion,
      // The ship has arrived. The world breathes; it does not travel.
      worldSpeed: 0,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x8e11,
    });

    this.readout = beaconReadout(this.stopId, this.playDate());

    const hud = this.parallax.layerOf("hud").container;
    this.drawPlanetLimb();
    hud.add(this.buildHeader());
    hud.add(this.buildReadout());
    this.buildBeacon();

    // SHADOW IS INSIDE THE CARD NOW, on the warp break's coach treatment: his
    // column on the left, the speaker caption and his line beside it. He was
    // standing loose on the sky at the literal (300, 470) - 200 px to the LEFT
    // of the box he was talking over, at a scale (0.9) nothing else in the
    // product uses.
    //
    // ADDED TO THE HUD CONTAINER, not depth-sorted against it. A container
    // renders its children in list order and IGNORES their depth, so a figure
    // left on the scene's display list at the same depth as the container is
    // ordered by whichever Phaser happened to sort first. `StallScene` puts him
    // in its card for the same reason.
    const stand = shadowOrigin(this.flavourLines, this.coordsLines);
    this.shadow = drawShadow(this, stand.x, stand.y, "saluting", {
      scale: SHADOW_SCALE,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("hud").depth,
    });
    hud.add(this.shadow.root);

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    const btn = actionRect();
    const target: FocusTarget = {
      id: "beacon-continue",
      // The only choice on this screen, and it is the forward one. Marked
      // primary so it STAYS the default if a second control is ever added.
      primary: true,
      x: btn.x,
      y: btn.y,
      w: btn.w,
      h: btn.h,
      activate: () => this.advance(),
    };
    hud.add(this.buildButton());
    this.menu = createKeyboardMenu(this, this.ring, [target], {
      // DELIBERATELY NOT ESCAPABLE (UR-86). The beacon is already placed and
      // the stop is already written to the profile; Escape here would read as
      // "undo that", and there is nothing to undo it to. Continue is the only
      // way on, and it is the only control on the screen.
      onBack: () => {},
    });
    this.focusRingDrawn = latchOnRender(this, () => this.ring.graphics.visible);

    this.publish();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu.destroy();
      this.ring.destroy();
      this.shadow.destroy();
      this.parallax.destroy();
    });
  }

  /**
   * A `Date` from whatever the caller (or the URL, for the e2e) had.
   *
   * An unparseable value yields an Invalid Date, which `beaconReadout`
   * classifies as `invalid-date` and turns into the calibrating branch. That is
   * the behaviour we want, so it is deliberately NOT guarded here: catching it
   * early would only move the same decision somewhere less tested.
   */
  private playDate(): Date {
    const given = this.initData?.date ?? this.lane.params.get("date");
    if (given instanceof Date) return given;
    if (typeof given === "number") return new Date(given);
    if (typeof given === "string") return new Date(given);
    return new Date();
  }

  // -------------------------------------------------------------------------
  // World
  // -------------------------------------------------------------------------

  /** The planet's limb across the bottom of the frame. */
  private drawPlanetLimb(): void {
    const pal = this.lane.palette;
    const W = this.scale.width;
    const H = this.scale.height;
    const g = this.add.graphics();
    const deep = pal.colors[pal.colors.length - 2] ?? pal.accent;
    const mid = pal.colors[2] ?? pal.accent;

    g.fillStyle(hexToNum(mid), 1);
    g.fillEllipse(W / 2, H + 430, W * 1.6, 1220);
    g.fillStyle(hexToNum(deep), 0.5);
    g.fillEllipse(W / 2 - 240, H + 360, W * 1.1, 1000);
    g.lineStyle(3, hexToNum(pal.accent), 0.3);
    g.strokeEllipse(W / 2, H + 430, W * 1.6, 1220);
    this.parallax.layerOf("farField").container.add(g);
  }

  private headline(): { headline: string; state: string; flavour: string } {
    if (!hasStageBundle(this.stopId)) {
      return { headline: this.lane.copy.stopName(this.stopId), state: "", flavour: "" };
    }
    const b = stageBundle(this.stopId);
    return { headline: b.beaconHeadline, state: b.beaconState, flavour: b.beaconFlavor };
  }

  /**
   * SHADOW READS THE BEACON (D63, AC-21.6).
   *
   * The beacon coming up is the emotional beat of the whole loop and it was
   * silent: the three lines were drawn and never spoken, so the pre-rendered
   * voice files for them - which existed - could never be reached by anything.
   *
   * THE IDS ARE THE CONTRACT. `${stopId}.beaconHeadline` is exactly the key
   * `scripts/render-voice.mjs` writes into the manifest, and the file transport
   * looks a line up by that id and nothing else. A scene that invented its own
   * id here would silently fall through to the system voice forever, which is
   * the bug this whole change exists to fix; `voiceClips.test.ts` asserts these
   * three strings for that reason.
   *
   * AC-21.6's ordering is structural: the labels are built in `create`, long
   * before the lamp lights, so the text is on screen before a word is said. The
   * three lines are QUEUED, not overlapped - `VoiceBus` hands the second to the
   * transport only when the first reports done - and `interruptFor` is never
   * called here because nothing the player did displaced anything.
   */
  private narrateBeacon(): void {
    const audio = audioFrom(this.registry);
    if (audio === null) return;
    const { headline, state, flavour } = this.headline();
    const lines: readonly [string, string][] = [
      [`${this.stopId}.beaconHeadline`, headline],
      [`${this.stopId}.beaconState`, state],
      [`${this.stopId}.beaconFlavor`, flavour],
    ];
    for (const [id, text] of lines) {
      if (text.trim().length === 0) continue;
      audio.speak({ id, text, kind: "scripted" });
    }
  }

  /**
   * THE HEADER SITS ON A PLATE (AC-22.8).
   *
   * "MARS BEACON" was `palette.accent` on Mars' ochre sky - 1.61:1 - and the
   * two lines under it were `plateText` at alpha 0.75 and 0.6, which is dimmer
   * still. This is the screen the child reaches by finishing a belt, and its
   * three lines were the least readable text in the build. `skyText` gives each
   * of them the plate the word plate has always had, and registers the colour
   * pair so the rubric measures it.
   *
   * The alphas are gone rather than reduced: a plate under text you then fade
   * to 60% is a plate doing 60% of its job. Hierarchy is size, not opacity.
   */
  private buildHeader(): Phaser.GameObjects.GameObject[] {
    const { headline, state } = this.headline();
    const made: Phaser.GameObjects.GameObject[] = [];
    // `objects` is plate-then-text: these go into a Container, which renders in
    // list order and ignores depth.
    const push = (p: PlatedText) => made.push(...p.objects);

    push(
      skyText(this, headerText(0, undefined, 14).x, headerText(0, undefined, 14).y, headline, {
        screen: "beacon",
        id: "beacon.headline",
        size: TYPE.heading,
        color: INK.text,
        lang: this.lane.lang,
        depth: 10,
        padY: 14,
      }),
    );
    // ONE STATUS LINE, NOT TWO (UR-83). The header used to carry a bare state
    // word - "placed" - on its own plate, and then a full sentence under it
    // that said the same thing with the stop's name in it. Two plates for one
    // fact, and the shorter one is the one that says less.
    //
    // The sentence takes the state's GOLD, because the gold was never about
    // that word: it is what this screen is announcing. `state` is still
    // computed above and still reaches the DOM mirror, so a screen reader and
    // the e2e both keep the machine-readable status they had.
    push(
      skyText(
        this,
        headerText(1, undefined, 10).x,
        headerText(1, undefined, 10).y,
        this.lane.copy.text("beacon.placed", { stop: this.lane.copy.stopName(this.stopId) }),
        {
          screen: "beacon",
          id: "beacon.placed",
          size: TYPE.body,
          color: INK.accent,
          lang: this.lane.lang,
          depth: 10,
          padY: 10,
        },
      ),
    );
    return made;
  }

  /**
   * ONE COORDINATE ROW, A SPEAKER CAPTION, AND SHADOW'S LINE (AC-17.0).
   *
   * ================== THE ROW THAT WAS CUT ==================
   * The engine hands this screen two strings and the card printed both:
   *
   *   coordsLine   "lam 62.5 deg  beta -0.2 deg  r 19.44 AU"
   *   pulsarLine   "pulsar fix  J0030+0451 +5752.2 s . J0218+4232 +8316.5 s
   *                 . J0437-4715 +3597.0 s . B1821-24 -8126.9 s"
   *
   * They are not two versions of one fact. `coordsLine` is a POSITION - where
   * the beacon is, in three numbers a child can read as a place. `pulsarLine`
   * is a CLOCK: timing residuals against four millisecond pulsars, which is
   * genuinely how a craft with no view of Earth fixes itself (NASA SEXTANT,
   * D15) and is also four signed numbers to one decimal place, in a row, on
   * the screen a seven-year-old reaches by finishing a belt. It was the better
   * physics and the worse copy, and it was spending a whole row of the only
   * box on the screen to say something nobody in the audience can parse.
   *
   * THE ENGINE STILL COMPUTES IT. `beaconReadout` is untouched,
   * `formatPulsarFix` is untouched, and both are still under
   * `tests/unit/ephemeris/`. The string is still on the snapshot, so the e2e
   * and the DOM mirror keep it. What changed is that the CARD does not print
   * it. See collision C23 in `docs/decision-log.md`: FR-17, AC-17.0, D15 and
   * D81 all name the pulsar-fix line as part of this screen, and cutting it
   * from the display is a collision with all four rather than a tidy-up.
   *
   * ================== AND THE FAILURE BRANCH ==================
   * With no coordinates the first row becomes the calibrating sentence, which
   * can wrap; `coordsLines` is measured rather than assumed, so the card grows
   * for it instead of printing through its own foot. The plate keeps its size,
   * its position and its colour, and nothing announces a failure.
   */
  private buildReadout(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const ok = this.readout.ok;

    // MEASURE, THEN PLACE. The card is sized to what is in it (the Earth
    // beacon screen's rule), so both lines are built at the origin, asked how
    // many rows they wrapped to, and only then is the plate cut and the rows
    // laid out. A reserved worst case is right on the warp break, where the
    // coach note ARRIVES later and AC-33 forbids the card moving when it does;
    // nothing on this screen is deferred.
    this.coordsLabel = label(
      this,
      0,
      0,
      ok ? this.readout.coordsLine : this.lane.copy.text("beacon.calibrating"),
      // TYPE.heading, NOT 42. A census of the served build found nine font
      // sizes app-wide and 42 was reached by exactly ONE call site, this one,
      // two pixels from the heading token every other screen uses.
      {
        size: TYPE.heading,
        color: INK.text,
        lang: this.lane.lang,
        wrapWidth: coordsWrapWidth(),
      },
    );
    this.flavourLabel = label(this, 0, 0, this.headline().flavour, {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: flavourWrapWidth(),
      lang: this.lane.lang,
    });
    this.coordsLines = Math.max(1, this.coordsLabel.getWrappedText().length);
    this.flavourLines = Math.max(1, this.flavourLabel.getWrappedText().length);

    const box = card(this.flavourLines, this.coordsLines);
    const [coordsRow, speakerRow, flavourRow] = cardRows(
      this.flavourLines,
      this.coordsLines,
    ).map((r) => r.rect);

    const made: Phaser.GameObjects.GameObject[] = [];
    // `objects` is plate-then-text: these go into a Container, which renders in
    // list order and ignores depth, so the plate has to be added first.
    made.push(
      plate(this, box.x, box.y, box.w, box.h, {
        fill: INK.panel,
        stroke: INK.line,
      }),
    );

    this.coordsLabel.setPosition(
      (coordsRow ?? box).x,
      (coordsRow ?? box).y,
    );
    made.push(this.coordsLabel);

    // THE SPEAKER CAPTION, IDENTICAL TO THE WARP BREAK'S AND EARTH'S. Same
    // key, same size, same ink. Two screens already name who is talking above
    // the line he says; a third way of doing it is a third thing to learn.
    made.push(
      label(
        this,
        (speakerRow ?? box).x,
        (speakerRow ?? box).y,
        this.lane.copy.text("warp.speaker"),
        { size: TYPE.caption, color: pal.accent, lang: this.lane.lang },
      ),
    );

    this.flavourLabel.setPosition((flavourRow ?? box).x, (flavourRow ?? box).y);
    made.push(this.flavourLabel);
    return made;
  }

  /** The beacon: a mast, a lamp, and a halo that comes up when it lights. */
  private buildBeacon(): void {
    const pal = this.lane.palette;
    const accent = hexToNum(pal.accent);
    const deep = hexToNum(pal.colors[pal.colors.length - 1] ?? "#0E1116");
    const groundY = MAST_GROUND_Y;
    const c = this.add.container(MAST_X, groundY - 560);

    const g = this.add.graphics();
    g.fillStyle(deep, 1);
    g.fillRoundedRect(-14, -58, 28, 152, 10);
    g.fillTriangle(-48, 98, 48, 98, 0, 56);
    g.fillStyle(accent, 1);
    g.fillCircle(0, -80, 22);
    g.fillStyle(accent, 0.22);
    g.fillCircle(0, -80, 48);
    c.add(g);

    const halo = this.add.graphics();
    halo.fillStyle(accent, 0.15);
    halo.fillCircle(0, -80, 140);
    halo.setAlpha(0);
    c.add(halo);

    this.mast = c;
    this.parallax.layerOf("shipFx").container.add(c);

    const light = (): void => {
      this.lit = true;
      // AC-21.3 `beacon`: a clear bell, the reward tone of the whole game, on
      // the frame the lamp comes up rather than when the scene opens.
      audioFrom(this.registry)?.play("beacon", "beacon-scene:lit");
      this.narrateBeacon();
      if (this.lane.reducedMotion) {
        halo.setAlpha(1);
        return;
      }
      this.tweens.add({
        targets: halo,
        alpha: { from: 0.4, to: 1 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: EASE.drift,
      });
    };

    if (this.lane.reducedMotion) {
      c.y = groundY;
      light();
      return;
    }
    this.tweens.add({
      targets: c,
      y: groundY,
      duration: 900,
      ease: EASE.arrive,
      onComplete: () => {
        this.tweens.add({
          targets: c,
          scale: { from: 0.94, to: 1 },
          duration: 320,
          ease: EASE.pop,
          onComplete: light,
        });
      },
    });
  }

  /**
   * THE FORWARD ACTION, ON THE PRODUCT'S LINE AND NOT THIS SCREEN'S.
   *
   * It was 420x64 on the LEFT GUTTER at y 966. The project owner reported the
   * action button as a control that lands somewhere different on every page,
   * naming Earth activation's launch button as the one the rest should match,
   * and `ui/grid.actionButton()` is now that position
   * for every screen with a single forward action. See its note for the census
   * of the five that disagreed.
   */
  private buildButton(): Phaser.GameObjects.GameObject[] {
    const pal = this.lane.palette;
    const BUTTON = actionRect();
    const made: Phaser.GameObjects.GameObject[] = [];
    made.push(
      plate(this, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, {
        fill: INK.panelRaised,
        stroke: INK.line,
      }),
    );
    const text = label(
      this,
      BUTTON.x + BUTTON.w / 2,
      BUTTON.y + BUTTON.h / 2,
      this.lane.copy.text("beacon.continue"),
      { size: TYPE.label, color: pal.accent, align: "center", lang: this.lane.lang },
    );
    text.setOrigin(0.5);
    made.push(text);
    /**
     * UR-56: the keyboard hint beside this button was reported as redundant
     * and asked to be removed outright.
     *
     * There WAS a hint here - `beacon.hint`, "enter to continue" - plated on
     * open sky 28 px to the right of this button, which reads "continue". One
     * button, opening with focus, with a visible ring on it, and a second piece
     * of text beside it saying the same word in the dimmest legible ink.
     *
     * It is not moved to the grid line, it is gone: there is nothing for a hint
     * to teach on a screen with a single focused control. `ui/hint.ts` holds
     * that as a rule for every screen rather than as this comment, because the
     * last two times a defect was fixed on the screen it was reported against
     * it came straight back on the next one (UR-06 -> UR-52, UR-14 -> UR-50.5).
     */
    return made;
  }

  /**
   * Pluto's beacon is the last one, so it hands over to the ending card; every
   * other stop goes straight to the stage report (design brief screens 9, 12).
   */
  private advance(): void {
    const next = this.stopId === "pluto" ? SCENE_KEYS.ending : SCENE_KEYS.results;
    // D13/AC-17.3: placing the beacon is what charts the stop and opens the
    // next one. Stars and rates are folded in by Results, which is the screen
    // that knows them; `markStopCleared` is idempotent on the placement date
    // and monotone on the bests, so the two writes compose.
    //
    // WRITTEN BEFORE THE FADE, not inside its callback: a fade that never
    // completes (a scene stopped mid-transition, a tab hidden at the wrong
    // moment) would otherwise swallow the one write that makes the route move.
    // AC-7.2/D44: the store is what survives a reload, and the array forwarded
    // below is the one the store actually holds, never a local re-derivation
    // that could disagree with it.
    const stored = persistStopCleared(this, this.lane.stopId);
    const progress =
      stored ??
      markStopCleared(this.lane.progress, this.lane.stopId, { atMs: Date.now() });
    const payload = this.initData?.payload;
    this.cameras.main.fadeOut(DUR.panel, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      goTo(this, next, {
        ctx: this.lane.ctx,
        progress,
        shipName: this.lane.shipName,
        lang: this.lane.lang,
        stopId: this.stopId,
        ...(payload ?? {}),
        ...(payload === undefined ? {} : { payload }),
      } as StoryInit);
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
    const coords = this.coordsLabel.text;
    // FROM THE ENGINE, NOT FROM A LABEL. The card no longer prints the
    // pulsar-fix line (C23), but `beaconReadout` still computes it and the
    // e2e still checks the D81 format, so the snapshot reports what the engine
    // produced rather than what happens to be on screen.
    const pulsar = this.readout.ok ? this.readout.pulsarLine : "";
    return {
      scene: SCENE_KEYS.beacon,
      stopId: this.stopId,
      /** Every colour pair this screen draws over the sky (V-22.8). */
      skyText: skyTextSamples(this),
      accent: this.lane.palette.accent,
      ok: this.readout.ok,
      reason: this.readout.ok ? null : this.readout.reason,
      coordsLine: coords,
      pulsarLine: pulsar,
      /** C23: computed, never drawn. */
      pulsarVisible: false,
      flavourLine: this.flavourLabel.text,
      /**
       * AC-17.0's own guard. Nothing rendered may contain "NaN", "Infinity" or
       * "undefined": those are the three ways a bad clock reaches a child.
       */
      poisoned: /NaN|Infinity|undefined/.test(`${coords} ${pulsar}`),
      lit: this.lit,
      beaconY: this.mast.y,
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusRingVisible: this.focusRingDrawn.drawn,
      reducedMotion: this.lane.reducedMotion,
      nextScene: this.stopId === "pluto" ? SCENE_KEYS.ending : SCENE_KEYS.results,
    };
  }

  private publish(): void {
    publishBag("beacon", {
      snapshot: () => this.snapshot(),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
      parallaxOffsets: () => this.parallax.debugOffsets(),
    });
  }
}
