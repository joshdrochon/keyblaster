import { markStopCleared } from "@engine/progress/index.js";
import Phaser from "phaser";
import { beaconReadout, type BeaconResult } from "@engine/ephemeris";
import type { StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { headerText } from "@game/ui/grid";
import {
  SHADOW_SCALE,
  button as actionRect,
  BEACON_BASE_Y,
  BEACON_ICON_INSET,
  BEACON_HOLD_MS,
  BEACON_RISE_MS,
  BEACON_SPEECH_DELAY_MS,
  card,
  coachBand,
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
import { contrastRatio, mixToward } from "@game/render/wordPlateGeometry";
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
import { paintActionButton } from "@game/ui/plate";
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


const SHAFT_MIN_CONTRAST = 1.35;

function shaftInk(deep: string, accent: string): string {
  let ink = deep;
  for (let step = 0; step <= 20 && contrastRatio(INK.panel, ink) < SHAFT_MIN_CONTRAST; step += 1) {
    ink = mixToward(deep, accent, step * 0.05);
  }
  return ink;
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
      // UR-173: THE MAST IS THE ONLY THING ON `shipFx` HERE, AND IT IS A
      // STRUCTURE. `crossDrift: false` gates the decorative planes' advance and
      // nothing else, so the layer still took `idleDriftPx` (+/-6 px on a 12 s
      // sine, `speed` 1.00) plus camera sway (+/-2.5 px on a 6 s one) - up to
      // +/-8.5 px of horizontal wander on a tower planted in the ground. On
      // Flight that drift IS the camera being alive; here the only occupant is
      // scenery, so the layer is pinned. The comment two lines up has claimed
      // nothing travels on this screen since UR-50.5; this is what made it true.
      pin: ["shipFx"],
      seed: 0x8e11,
    });

    this.readout = beaconReadout(this.stopId, this.playDate());

    const hud = this.parallax.layerOf("hud").container;
    // PROTOTYPE: the planet's limb is off. The mast now stands against sky
    // rather than on a surface - see `drawPlanetLimb`, still here and unused.
    // this.drawPlanetLimb();
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

    this.ring = createFocusRing(this, layer("hud").depth + 1, this.lane.reducedMotion);
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
    // A stop with a written spoken line says THAT, and nothing else. Reading
    // the headline, the status chip and the flavour in turn is a machine
    // reading a form: "Mars Beacon. Placed. Rust and rivers."
    const spoken = hasStageBundle(this.stopId)
      ? (stageBundle(this.stopId).beaconSpoken ?? "")
      : "";
    const lines: readonly [string, string][] =
      spoken.trim().length > 0
        ? [[`${this.stopId}.beaconSpoken`, spoken]]
        : [
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
    // The title and its status line live in the card now - see `titleRowH` in
    // support/beaconLayout. `state` is still computed for the DOM mirror.
    this.headline();
    return [];
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
    const [titleRow, coordsRow, speakerRow, flavourRow] = cardRows(
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

    const { headline } = this.headline();
    made.push(
      // THE STOP'S OWN ACCENT, like the Stage Report's title. It is per-stop,
      // so this is Mars' orange here and Venus' gold at Venus - one line, every
      // planet. On the card it is reading against INK.panel, not against the
      // sky, which is what the two plates used to buy.
      label(this, (titleRow ?? box).x, (titleRow ?? box).y, headline, {
        size: TYPE.heading,
        color: pal.accent,
        lang: this.lane.lang,
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
  /**
   * THE BEACON AS A SIGNAL, INSIDE THE CARD.
   *
   * It used to be a 560 px tower standing on the planet's limb out in the
   * world, arriving with a drop and a scale pop. The owner asked for an icon
   * instead, placed in the card's empty right-hand region beside Shadow -
   * which is also the only part of this screen that was carrying nothing.
   *
   * THE PULSE STARTS WITH THE SOUND. `light()` plays AC-21.3's bell and starts
   * the halo in the same call, so the lamp begins breathing on the frame the
   * tone lands rather than on a timer of its own.
   */
  private buildBeacon(): void {
    const pal = this.lane.palette;
    const accent = hexToNum(pal.accent);
    // The shaft is the palette's deepest colour, which was chosen to stand
    // against the stop's SKY. On the card it stands against INK.panel instead,
    // and measured, seven of ten stops fell under 1.1:1 - Venus 1.01, Earth
    // 1.00, invisible rather than dim. So it is walked toward its own accent
    // until it clears the bar Mars already read at, which keeps each stop's hue
    // and fixes the ones that were lost.
    const deep = hexToNum(shaftInk(pal.colors[pal.colors.length - 1] ?? "#0E1116", pal.accent));

    // ON SHADOW'S LINE. The icon sits at the height of what he is saying, so
    // the two things in the band - the one speaking and the thing he is
    // speaking about - share a baseline rather than one floating above the
    // other. It overhangs that row top and bottom, which is why it is not
    // CONSTRAINED to it: the card's right column is empty full-height, the
    // coords row and his text both stopping well short of it.
    const box = card(this.flavourLines, this.coordsLines);
    const cx = box.x + box.w - BEACON_ICON_INSET;
    // THE FOOT OF THE BASE SITS ON THE BOTTOM OF HIS LINE, MEASURED OFF THE
    // TEXT AND NOT OFF ITS ROW. The flavour row's rect is 13 px taller than the
    // glyphs rendered inside it - a line box carries descent the letters do not
    // reach - so aligning to the rect put the base 13 px below the text it was
    // supposed to stand on. `flavourLabel` is already built and positioned by
    // `buildReadout`, which runs first, so this asks the object itself.
    const cy = this.flavourLabel.getBounds().bottom - BEACON_BASE_Y;

    const c = this.add.container(cx, cy);
    const g = this.add.graphics();
    // A short mast and a lamp, at icon scale - the same silhouette the map's
    // charted stops use, so the thing that means "beacon" looks the same in
    // both places.
    g.fillStyle(deep, 1);
    g.fillRoundedRect(-9, -10, 18, 84, 6);
    g.fillTriangle(-30, 80, 30, 80, 0, 54);
    g.fillStyle(accent, 1);
    g.fillCircle(0, -26, 13);
    g.fillStyle(accent, 0.22);
    g.fillCircle(0, -26, 27);
    c.add(g);

    const halo = this.add.graphics();
    halo.fillStyle(accent, 0.15);
    halo.fillCircle(0, -26, 70);
    halo.setAlpha(0);
    c.add(halo);

    this.mast = c;
    this.parallax.layerOf("hud").container.add(c);

    /**
     * THE LIGHT COMES UP WITH THE TONE, THEN BREATHES.
     *
     * It used to snap: `setAlpha(0)` and then a tween starting `from: 0.4`, so
     * the halo jumped to 0.4 in one frame and yo-yoed from there. There was no
     * rise for the sound to land against - the lamp was simply on, and the bell
     * fired at the same instant by coincidence rather than by arrangement.
     *
     * `beacon` is a 900 ms glide from 660 to 990 Hz (sfx.ts) - the charge the
     * owner is hearing - so the halo now rises over exactly that, from nothing,
     * and only starts its pulse once the tone has finished climbing. One event,
     * one envelope, in both senses.
     */
    const pulse = (): void => {
      this.tweens.add({
        targets: halo,
        alpha: { from: 1, to: 0.45 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: EASE.drift,
      });
    };

    const light = (): void => {
      this.lit = true;
      // THE TONE STARTS WITH THE BLOOM, ON THE SAME FRAME. This call and the
      // rise tween below are two synchronous statements in one callback, so
      // nothing can land between them.
      //
      // IT USED TO FIRE ON THE PULSE, which begins when the bloom COMPLETES.
      // Measured with an AnalyserNode on the sfx bus, sampled against the
      // halo's alpha on the same frames: the bell came 318 ms after the glow
      // started and 0 ms after it reached full. That quarter second is what
      // was heard.
      audioFrom(this.registry)?.play("beacon", "beacon-scene:lit");
      // SHADOW WAITS FOR THE TONE TO FINISH, ON THE WALL CLOCK.
      //
      // NOT `this.time.delayedCall`, which runs on the SCENE clock. The bell is
      // scheduled on the AudioContext's clock, and the two only agree while
      // frames are healthy - measured headless, 1250 ms of scene time became
      // about 7 s of real time and Shadow spoke seven seconds after the bell
      // instead of a quarter of one. "A beat after the sound ends" is a claim
      // about audio, so it is timed against the clock the audio is on.
      const speak = window.setTimeout(() => this.narrateBeacon(), BEACON_SPEECH_DELAY_MS);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.clearTimeout(speak));
      if (this.lane.reducedMotion) {
        halo.setAlpha(1);
        return;
      }
      this.tweens.add({
        targets: halo,
        alpha: { from: 0, to: 1 },
        duration: BEACON_RISE_MS,
        ease: EASE.drift,
        onComplete: pulse,
      });
    };

    // A BEAT OF STILLNESS FIRST. The screen arrives, the card settles, and only
    // then does the beacon come up - the owner asked for about a second before
    // anything happens, so the lamp is not already lighting while the player is
    // still reading the title.
    this.time.delayedCall(BEACON_HOLD_MS, light);
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
    // THE SHARED ACTION BUTTON (UR-112, `ui/plate.paintActionButton`).
    //
    // NOT A REPAINT. This is the control the owner named as the one that is
    // RIGHT - "the Continue button on the Beacon-placed screen has the right
    // yellow outline" - and `ACTION_INK.primaryFill` / `primaryEdge` are its
    // own `INK.panelRaised` / `INK.line`, so nothing here changes colour. What
    // changes is that the stage report now draws from the same two tokens
    // instead of from the stop accent, and a guard stops them drifting apart
    // again (`tests/unit/ui/actionButton.test.ts`).
    const buttonPlate = this.add.graphics();
    paintActionButton(buttonPlate, BUTTON, { primary: true });
    made.push(buttonPlate);
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
