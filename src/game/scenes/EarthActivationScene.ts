import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { INK, SKY_PLATE, TYPE } from "@game/ui/theme";
import { HEADING_TOP, SUBHEADING_TOP } from "@game/ui/grid";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import {
  createFocusRing,
  createKeyboardMenu,
  label,
  plate,
  visibleText,
  type FocusTarget,
  type KeyboardMenu,
  type SceneSnapshot,
  type Snapshotable,
} from "./lib/kit";
import {
  SHADOW_SCALE,
  shadowOrigin,
  speechBox,
  speechRowBoxes,
  speechWrapWidth,
} from "./support/earthLayout";
import { createWordPrompt, type WordPrompt } from "./lib/typedWord";
import { stageBundle } from "./lib/content";
import { createLaneText } from "./support/copy";
import { goTo, persistStopCleared, resolveInit, type ResolvedInit, type StoryInit } from "./lib/init";
import { markStopCleared } from "@engine/progress/index.js";
import { audioFrom } from "@game/audio/wiring";

/**
 * Screen inventory row 2b - Earth activation (D57, AC-12.1).
 *
 * The launchpad at night. Earth's beacon is already built and it is DARK;
 * Shadow asks for one word, `launch`, and the light comes on. Earth has no
 * belt, so this is the only place in the game where one word is the whole
 * interaction - which is the point: it is the tutorial for the beacon moment
 * at screen 8, and the design brief asks it to look like a smaller version of
 * that screen.
 *
 * Two things carry "smaller version of screen 8" concretely:
 *   - the lamp, its bloom, its expanding rings and its column of light are the
 *     same drawing the beacon screen will use, at a smaller radius;
 *   - the word goes through `@engine/lock` (lib/typedWord.ts), so the keystroke
 *     feel is the same code path as flight rather than an imitation of it.
 *
 * The dark beacon is never drawn as broken: no red, no cross, no alarm (D31,
 * AC-22b.1). It is a lamp that is off, in a palette where off reads as waiting.
 */
/**
 * The beacon's x, READ AT DRAW TIME.
 *
 * This was `const BEACON_X = GAME_WIDTH * 0.5` at module top level. `GAME_WIDTH`
 * is now the window's own aspect at 1080 (D99, `sceneKeys` header), so a
 * top-level `const` captures the live binding at import time and freezes it at
 * 960 - which on a 21:9 window would put the mast, the lamp, its rings and its
 * column of light 320 px left of centre while the text above them stayed
 * centred. A function, called from the three methods that draw it.
 */
const beaconX = (): number => GAME_WIDTH * 0.5;
const BEACON_Y = GAME_HEIGHT * 0.46;
const BUTTON_W = 420;
const BUTTON_H = 88;
const BUTTON_Y = GAME_HEIGHT * 0.87;

/**
 * The header plate's padding. `SKY_PLATE`'s, because that is the padding
 * `ui/grid.headingText()` assumes when it says where a plated title's INK goes,
 * and a header that uses a different one lands its ink somewhere the grid did
 * not predict.
 */
const HEADER_PAD_X = SKY_PLATE.padX;
const HEADER_PAD_Y = SKY_PLATE.padY;

export class EarthActivationScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private prompt: WordPrompt | null = null;
  private menu: KeyboardMenu | null = null;
  private lampG!: Phaser.GameObjects.Graphics;
  private beamG!: Phaser.GameObjects.Graphics;
  private ringsG!: Phaser.GameObjects.Graphics;
  /** The screen's title, on the grid's heading line (UR-19). */
  private headingText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  /**
   * The plate behind the status line, kept because the line's COPY changes.
   *
   * `skyText`-style plates are cut from the text's own bounds, so a plate drawn
   * once for "offline" is the wrong width for the lit copy - a longer string
   * would hang off its own contrast plate, which is AC-22.8's failure with an
   * extra step. `setStatus` re-cuts it.
   */
  private statusPlate: Phaser.GameObjects.Graphics | null = null;
  private litText!: Phaser.GameObjects.Text;
  /**
   * The "type launch to wake the beacon" instruction. no-user-quotes-ok: that
   * string is shipped game copy (`earth.typePrompt` in src/content/en/ui.json),
   * not a report's wording - UR-17 screenshotted the screen that draws it, and
   * rewording it here would make this comment name a string the game does not
   * have.
   *
   * HELD IN A FIELD BECAUSE IT HAS TO BE REMOVED. It sits at exactly the same
   * y as `litText`, so once the beacon lights the two draw on top of each
   * other and the result is unreadable — UR-17 caught it in play and attached a
   * screenshot. It was a local, so nothing could reach it to take it
   * away: the overlap was structurally guaranteed, not a timing accident.
   */
  private hintText!: Phaser.GameObjects.Text;
  private continueText!: Phaser.GameObjects.Text;
  private continuePlate!: Phaser.GameObjects.Graphics;
  private lit = false;
  private litAtMs = 0;
  private word = "";

  constructor() {
    super(SCENE_KEYS.earthActivation);
  }

  init(data: StoryInit): void {
    this.story = resolveInit(data, "earth");
    this.lit = false;
    this.litAtMs = 0;
    this.prompt = null;
    this.menu = null;
    this.statusPlate = null;
  }

  /**
   * Back to the map, from anywhere on this screen (UR-86).
   *
   * One function, two callers: the Escape key below and the focus menu that
   * only exists after the ritual is finished.
   */
  private leaveToMap(): void {
    goTo(this, SCENE_KEYS.map, {
      ctx: this.story.ctx,
      progress: this.story.progress,
      shipName: this.story.shipName,
      lang: this.story.lang,
      newProfile: this.story.newProfile,
    });
  }

  create(): void {
    // ESCAPE WORKS DURING THE RITUAL, NOT ONLY AFTER IT (UR-86).
    //
    // The focus menu - and so the kit's Escape handling - is not built until
    // the beacon is lit, so for the whole typing phase this screen had no way
    // out at all. That is the same defect as UR-31, which found the ritual is a
    // HARD GATE with no timeout: a child who cannot type the prompt word never
    // reaches the belt. A timeout answered the stuck case; this answers the
    // child who simply wants to leave.
    //
    // Bound on the scene rather than through the menu because the menu does not
    // exist yet. `lib/typedWord.ts` already ignores Escape, so this takes a key
    // nothing else on the screen wants.
    this.input.keyboard?.on("keydown-ESC", () => {
      this.leaveToMap();
    });

    const { text, ctx } = this.story;
    const pal = paletteAt("earth", ctx.colorblindPalette);
    const bundle = stageBundle("earth");
    // AC-12.1's word is content, not a constant hiding in a scene.
    this.word = bundle.activationWord ?? "";

    this.cameras.main.setBackgroundColor(INK.bgDeep);
    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: ctx.reducedMotion,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      // No debris plane: Earth has no belt (D57).
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x3a12,
    });

    this.beamG = this.add.graphics().setDepth(4);
    this.ringsG = this.add.graphics().setDepth(5);
    this.drawMast(pal.accent);
    this.lampG = this.add.graphics().setDepth(7);
    this.paintLamp(pal.accent, 0);

    // --- header block, on the product's grid lines (UR-19) ----------------
    //
    // WHAT WAS HERE. One 24 px chip reading "earth beacon · offline", its plate
    // at y=76 and its ink at (837, 100) on a 1920 world. Measured against the
    // five screens that agree - a 44 px title whose plate corner is on
    // (GUTTER, HEADING_TOP) and a subline on SUBHEADING_TOP - it was the wrong
    // SIZE, on the wrong LINE, and carried two different things on one row. The
    // critic's reading of it was that this screen has no title at all, and that
    // was correct.
    //
    // It is now the same two-line header the Beacon screen uses, which is the
    // screen this one is explicitly a smaller version of: the place on line 0,
    // its state on line 1. Both on the grid's lines, at the grid's sizes.
    //
    // CENTRED, NOT ON THE GUTTER, and that is declared rather than overlooked.
    // `grid-conformance.spec.ts` declares this screen's anchoring "centred" and
    // measures it: every object here - the mast, the lamp, its rings, the
    // column of light, Shadow's line, the prompt and the button - is placed
    // from `GAME_WIDTH / 2` so the composition survives a 32:9 window. A header
    // pinned to the left gutter on a screen that must reflow from the centre is
    // the exact defect that file caught in Shadow's line, one object up. So the
    // header joins the grid on the axis a centred screen HAS - the line - and
    // the spec asserts the centring in place of the x.
    const headerCentre = GAME_WIDTH / 2;
    this.headingText = this.headerLine(
      text.text("earth.heading"),
      HEADING_TOP,
      TYPE.heading,
      INK.text,
      headerCentre,
    );
    this.statusText = this.headerLine(
      text.text("earth.status.dark"),
      SUBHEADING_TOP,
      TYPE.body,
      INK.textDim,
      headerCentre,
    );
    this.statusPlate = this.lastHeaderPlate;

    // --- Shadow and his line ---------------------------------------------
    //
    // ============ THE LINE IS HIS, AND IT IS NOT ON THE LAMP ============
    //
    // WHAT WAS HERE. A 760 x 156 plate at `GAME_WIDTH / 2 - 380`, i.e.
    // 580..1340 x 540..696 at the artboard, with the line set 36/32 inside it.
    // The lamp housing is 912..1008 x 461..539 and the mast runs to 827, so the
    // plate covered the lamp and the top of the tower - the one object this
    // screen exists to show a child - and it did so in BOTH states, dark and
    // lit. It also read as a caption: nothing on it said Shadow was speaking,
    // although he is drawn 280 px to its left.
    //
    // It is a dialogue box now, in Shadow's own column, sitting on his head,
    // with the speaker label the warp break already uses over the line. Its
    // right edge stops one gutter short of the mast. The geometry is in
    // `support/earthLayout.ts` so `tests/unit/scenes/earthSpeech.test.ts` can
    // measure it: this file imports Phaser, which is how a plate could sit on
    // the lamp through a green suite in the first place.
    //
    // HE IS PLACED FROM THE CENTRE TOO. `300` was a literal on a screen whose
    // own header note says every object here is placed from `GAME_WIDTH / 2`;
    // `grid-conformance.spec.ts` never caught it because a Phaser `Graphics`
    // has no text for it to measure. `shadowOrigin` draws him at 300 on a
    // 1920 world and keeps him under his own box on every other one.
    const stand = shadowOrigin(GAME_WIDTH);
    this.shadow = drawShadow(this, stand.x, stand.y, "pointing", {
      scale: SHADOW_SCALE,
      reducedMotion: ctx.reducedMotion,
      depth: 12,
    });

    // MEASURED, THEN PLACED. The box is sized to its content (one line in
    // English and Spanish, two in Hindi at this wrap), so the line has to be
    // built before the plate under it can be cut. `setPosition` afterwards
    // rather than a second Text object.
    const speechLine = label(this, 0, 0, bundle.preflightLine, {
      size: TYPE.body,
      color: INK.text,
      wrapWidth: speechWrapWidth(),
      lang: this.story.lang,
    }).setDepth(12);
    const box = speechBox(GAME_WIDTH, speechLine.getWrappedText().length);
    const [speakerRow, lineRow] = speechRowBoxes(
      GAME_WIDTH,
      speechLine.getWrappedText().length,
    ) as [typeof box, typeof box];
    // Opaque, like every other card: see `lib/kit.plate`. The stroke is the
    // coach card's, so the two places Shadow speaks are drawn the same way.
    plate(this, box.x, box.y, box.w, box.h, {
      fill: INK.panel,
      stroke: INK.line,
      alpha: 1,
    }).setDepth(11);
    // WHO IS SPEAKING (the warp break's `warp.speaker`, AC-33's speaker row).
    // The same key rather than a second one: it is the string "Shadow" in all
    // three languages and there is one Shadow (D91). A second key would be a
    // translation task for a word already translated.
    // `createLaneText`, not `story.text`: "Shadow" lives in the lane table
    // (`support/copy.ts`), which is the resolver that knows it in all three
    // languages. The shared one does not, by design.
    const laneText = createLaneText({ lang: this.story.lang, shipName: this.story.shipName });
    label(this, speakerRow.x, speakerRow.y, laneText.text("warp.speaker"), {
      size: TYPE.caption,
      color: pal.accent,
      lang: this.story.lang,
    }).setDepth(12);
    speechLine.setPosition(lineRow.x, lineRow.y);
    // SHADOW SAYS IT (D63, AC-21.6). The label above is built first and is the
    // source of truth; the voice is handed the SAME string, never a second copy
    // of the copy, so a player with no audio reads exactly what a player with
    // audio hears.
    //
    // The id is `${stopId}.preflightLine` because that is the key
    // `scripts/render-voice.mjs` writes into the manifest and the only key the
    // file transport will match. `stopId` rather than the literal "earth": this
    // screen is Earth's today, and an id built from the stop cannot drift if it
    // is ever reused. See `tests/unit/audio/voiceClips.test.ts`.
    const stopId = this.story.stopId;
    audioFrom(this.registry)?.speak({
      id: `${stopId}.preflightLine`,
      text: bundle.preflightLine,
      kind: "scripted",
    });

    // --- the one word -----------------------------------------------------
    this.hintText = label(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT * 0.76,
      text.text("earth.typePrompt", { word: this.word }),
      { size: TYPE.label, color: INK.textDim, align: "center", lang: this.story.lang },
    )
      .setOrigin(0.5)
      .setDepth(12);

    this.prompt = createWordPrompt(this, {
      word: this.word,
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT * 0.87,
      size: TYPE.display,
      accent: pal.accent,
      plateFill: pal.plate,
      plateText: pal.plateText,
      parkGraceMs: this.story.calibration.ikiMs * 1.5,
      reducedMotion: ctx.reducedMotion,
      depth: 13,
      onComplete: () => this.lightBeacon(pal.accent),
    });

    // --- the lit copy and the one button, hidden until the light ----------
    this.litText = label(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.76, text.text("earth.lit"), {
      size: TYPE.heading,
      color: INK.accentSoft,
      align: "center",
      lang: this.story.lang,
    })
      .setOrigin(0.5)
      .setDepth(14)
      .setAlpha(0);

    this.continuePlate = plate(
      this,
      GAME_WIDTH / 2 - BUTTON_W / 2,
      BUTTON_Y,
      BUTTON_W,
      BUTTON_H,
      { fill: INK.panelRaised, stroke: INK.accent },
    )
      .setDepth(14)
      .setAlpha(0);
    this.continueText = label(
      this,
      GAME_WIDTH / 2,
      BUTTON_Y + BUTTON_H / 2,
      text.text("earth.continue"),
      { size: TYPE.label, color: INK.text, align: "center", lang: this.story.lang },
    )
      .setOrigin(0.5)
      .setDepth(15)
      .setAlpha(0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  /**
   * One line of the header block: a centred label on a plate cut to its own
   * bounds, with the PLATE's top on the grid line (UR-19).
   *
   * The plate, not the ink, because that is what `ui/grid.ts` says the contract
   * is and what every other screen's `skyText` header does - putting the INK on
   * the line puts the plate one padding above it, which is the same half-pixel
   * class of error that made the stage report look like it was hugging the
   * corner. Sized from the measured text so a longer string or a taller
   * Devanagari line box grows the plate instead of overflowing it.
   */
  private headerLine(
    content: string,
    gridTop: number,
    size: number,
    color: string,
    centre: number,
  ): Phaser.GameObjects.Text {
    const text = label(this, centre, gridTop + HEADER_PAD_Y, content, {
      size,
      color,
      align: "center",
      lang: this.story.lang,
    })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.lastHeaderPlate = plate(
      this,
      centre - text.width / 2 - HEADER_PAD_X,
      gridTop,
      text.width + HEADER_PAD_X * 2,
      text.height + HEADER_PAD_Y * 2,
    ).setDepth(9);
    return text;
  }

  /** Where `headerLine` left the plate it just drew. */
  private lastHeaderPlate!: Phaser.GameObjects.Graphics;

  /** Change the state line without touching the screen's name above it. */
  private setStatus(content: string, color: string): void {
    this.statusText.setText(content);
    this.statusText.setColor(color);
    this.statusText.setX(GAME_WIDTH / 2);
    this.statusPlate?.destroy();
    this.statusPlate = plate(
      this,
      GAME_WIDTH / 2 - this.statusText.width / 2 - HEADER_PAD_X,
      SUBHEADING_TOP,
      this.statusText.width + HEADER_PAD_X * 2,
      this.statusText.height + HEADER_PAD_Y * 2,
    ).setDepth(9);
  }

  /** The launchpad mast. Drawn once; lighting the beacon never re-tints it. */
  private drawMast(accent: string): void {
    const g = this.add.graphics().setDepth(6);
    const x = beaconX();
    const y = BEACON_Y;
    const baseY = y + 330;
    g.fillStyle(hexToNum(INK.bgDeep), 1);
    g.fillTriangle(x - 104, baseY, x + 104, baseY, x, y + 26);
    g.fillStyle(hexToNum(INK.panelRaised), 1);
    g.fillTriangle(x - 84, baseY, x + 84, baseY, x, y + 40);
    g.lineStyle(3, hexToNum(INK.line), 1);
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const halfW = 84 * t;
      const yy = baseY - (baseY - (y + 40)) * (1 - t);
      g.lineBetween(x - halfW, yy, x + halfW, yy);
    }
    g.lineBetween(x - 84, baseY, x, y + 40);
    g.lineBetween(x + 84, baseY, x, y + 40);
    // Lamp housing: cold metal whether or not the lamp is lit.
    g.fillStyle(hexToNum(INK.panel), 1);
    g.fillRoundedRect(x - 48, y - 36, 96, 78, 14);
    g.lineStyle(3, hexToNum(accent), 0.35);
    g.strokeRoundedRect(x - 48, y - 36, 96, 78, 14);
  }

  /** `strength` 0 = dark, 1 = fully lit. The same drawing either way. */
  private paintLamp(accent: string, strength: number): void {
    const BEACON_X = beaconX();
    const g = this.lampG;
    const c = hexToNum(accent);
    g.clear();
    g.fillStyle(hexToNum(INK.locked), 1);
    g.fillCircle(BEACON_X, BEACON_Y, 26);
    if (strength > 0) {
      g.fillStyle(c, 0.1 * strength);
      g.fillCircle(BEACON_X, BEACON_Y, 220 * strength);
      g.fillStyle(c, 0.2 * strength);
      g.fillCircle(BEACON_X, BEACON_Y, 124 * strength);
      g.fillStyle(c, 0.45 * strength);
      g.fillCircle(BEACON_X, BEACON_Y, 58 * strength);
      g.fillStyle(hexToNum(INK.accentSoft), strength);
      g.fillCircle(BEACON_X, BEACON_Y, 26);
    }
    g.lineStyle(3, c, 0.3 + 0.7 * strength);
    g.strokeCircle(BEACON_X, BEACON_Y, 32);
  }

  private lightBeacon(accent: string): void {
    if (this.lit) return;
    this.lit = true;
    this.litAtMs = this.time.now;
    const { text } = this.story;

    // The STATE changes; the screen's name does not. It used to reset the whole
    // chip, which is how the title and the status came to be one string.
    this.setStatus(text.text("earth.status.lit"), INK.accentSoft);
    this.shadow.setPose("cheering");

    // Expo.Out - the blast curve: the light ARRIVES, it does not ramp up.
    const carrier = { v: 0 };
    this.tweens.add({
      targets: carrier,
      v: 1,
      duration: 900,
      ease: EASE.blast,
      onUpdate: () => this.paintLamp(accent, carrier.v),
    });

    // The instruction leaves BEFORE the result arrives. It is done being true
    // the moment the beacon lights, and it occupies the same line, so it has
    // to be gone rather than merely behind. Faded rather than destroyed on the
    // frame, so the beat reads as one thought replacing another; the delay is
    // under `litText`'s 650 so the line is clear before the new copy lands.
    this.tweens.add({
      targets: this.hintText,
      alpha: 0,
      duration: 280,
      ease: EASE.arrive,
      onComplete: () => this.hintText.setVisible(false),
    });

    this.tweens.add({
      targets: this.litText,
      alpha: { from: 0, to: 1 },
      y: { from: this.litText.y + 18, to: this.litText.y },
      delay: 650,
      duration: 520,
      ease: EASE.arrive,
    });

    this.time.delayedCall(1100, () => {
      this.prompt?.destroy();
      this.prompt = null;
      this.showContinue();
    });
  }

  private showContinue(): void {
    const target: FocusTarget = {
      id: "continue",
      // Forward action: the beacon is lit, the map is next (see kit.ts).
      primary: true,
      x: GAME_WIDTH / 2 - BUTTON_W / 2,
      y: BUTTON_Y,
      w: BUTTON_W,
      h: BUTTON_H,
      activate: () => {
        // AC-12.1: lighting Earth's beacon CLEARS the stop. Without this the
        // map's unlock rule never opens Mars, the map re-focuses Earth, and
        // the player bounces between the two forever.
        // Forward what was WRITTEN, not a parallel local derivation of it: the
        // store is the copy the map and a reload both read, so any disagreement
        // between the two is a bug waiting to surface one screen later.
        const progress =
          persistStopCleared(this, "earth") ??
          markStopCleared(this.story.progress, "earth", { atMs: Date.now() });
        goTo(this, SCENE_KEYS.map, {
          ctx: this.story.ctx,
          progress,
          shipName: this.story.shipName,
          lang: this.story.lang,
          newProfile: this.story.newProfile,
        });
      },
    };
    this.tweens.add({
      targets: [this.continuePlate, this.continueText],
      alpha: 1,
      duration: 380,
      ease: EASE.pop,
    });
    const ring = createFocusRing(this, 30);
    this.menu = createKeyboardMenu(this, ring, [target], {
      // Back to the map. The activation is a ritual a child can leave: nothing
      // has been written yet, so leaving costs them nothing (UR-86).
      onBack: () => {
        this.leaveToMap();
      },
    });
  }

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
    this.prompt?.update(time);
    if (!this.lit) return;

    const pal = paletteAt("earth", this.story.ctx.colorblindPalette);
    const elapsed = time - this.litAtMs;

    const BEACON_X = beaconX();
    // Rings expanding from the lamp: slow, confident, earned.
    this.ringsG.clear();
    for (let i = 0; i < 3; i += 1) {
      const phase = (elapsed / 2600 + i / 3) % 1;
      this.ringsG.lineStyle(4, hexToNum(pal.accent), (1 - phase) * 0.5);
      this.ringsG.strokeCircle(BEACON_X, BEACON_Y, 40 + phase * 480);
    }

    // The column of light. Sine breath, so nothing here is ever still.
    const breathe = 0.55 + Math.sin(elapsed / 1400) * 0.12;
    this.beamG.clear();
    this.beamG.fillStyle(hexToNum(pal.accent), 0.14 * breathe);
    this.beamG.fillTriangle(
      BEACON_X - 28, BEACON_Y,
      BEACON_X + 28, BEACON_Y,
      BEACON_X, -GAME_HEIGHT * 0.2,
    );
    this.beamG.fillStyle(hexToNum(pal.accent), 0.3 * breathe);
    this.beamG.fillTriangle(
      BEACON_X - 11, BEACON_Y,
      BEACON_X + 11, BEACON_Y,
      BEACON_X, GAME_HEIGHT * 0.04,
    );
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.earthActivation,
      beaconLit: this.lit,
      activationWord: this.word,
      typed: this.prompt?.typed ?? (this.lit ? this.word : ""),
      canContinue: this.menu !== null,
      focusId: this.menu ? (this.menu.targets[this.menu.index]?.id ?? null) : null,
      text: visibleText(this),
    };
  }

  private teardown(): void {
    this.prompt?.destroy();
    this.menu?.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}
