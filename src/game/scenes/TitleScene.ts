/**
 * TITLE - screen 1 of the design brief's screen inventory.
 *
 * Variants the inventory asks for, all live here:
 *   first-time   -> the start action
 *   returning    -> "Continue" plus the furthest beacon (D13)
 *   reduced-motion -> no camera sway, ambient drift kept (D41, AC-19.3)
 *
 * This is the first thing a judge sees, so rubric item 2 ("nothing is ever
 * still") has to be visibly true here, and AC-22.2 measures it: two frames one
 * second apart must differ by more than 2% of pixels. The full eight-layer
 * stack from render/parallax.ts runs behind the Lantern for exactly that
 * reason - not a still backdrop with one tween on top.
 *
 * PRESENTATION ONLY. The rules live in src/engine; this file reads the profile
 * store and the translator through `services()` and decides nothing.
 *
 * KEYBOARD ONLY (D37, AC-18.1). Up/Down/Tab move focus, Enter/Space activate,
 * Left/Right switch language on the language row. Focus is always visible.
 */

import Phaser from "phaser";
import { SCENE_KEYS } from "../sceneKeys.js";
import { furthestBeacon, services } from "../boot.js";
import { EASE, buildParallax, type Parallax } from "../render/parallax.js";
import {
  hexToNum,
  isBrightStop,
  lightPositionOf,
  mixHex,
  paletteAt,
  type StopPalette,
} from "../render/palette.js";
import { TEX, ensureTextures } from "../render/textures.js";
import { LANTERN_DESIGN_HEIGHT, type LanternRig } from "../render/lantern.js";
import { drawPlayerLantern, playerLivery } from "./lib/livery.js";
import { LANGS, type Lang } from "../../engine/types.js";
import { SHIPPED_LANGS } from "../../engine/i18n/index.js";
import { HIT_ZONE_PREFIX, uiSoundBlip } from "@game/ui/focus";
import { INK, TYPE, chromeCase } from "@game/ui/theme";
import { skyText, skyTextSamples, type SceneSnapshot } from "./lib/kit.js";
import { WORDMARK_X, WORDMARK_Y, titleKeepClear } from "./support/titleLayout.js";
import {
  CHROME_PAD_Y,
  FOCUS_PAD,
  PRIMARY_H,
  PRIMARY_W,
  STATUS_GAP,
  titleStack,
} from "./support/titleStack.js";
import { typographyOf } from "./lib/typography.js";

/**
 * The wordmark's own face. Everything ELSE on this screen is now dressed from
 * the theme, because a title that uses one type stack for its chrome and the
 * rest of the game another is two designs; a logo is allowed its own face.
 */
const FONT = '"Avenir Next","Nunito","Trebuchet MS",system-ui,sans-serif';

/** Mark, accent rule and tagline, top to bottom. */
const LOCKUP_H = 218;

/**
 * THE MOON IN THE MIDDLE OF THE WORDMARK.
 *
 * The capture showed a hard-edged pale disc sitting inside the mark, eating the
 * tail of "KEY" and the bowl of the "B". It is not drawn here: it is the stop's
 * light source, from `render/parallax.ts`, which places it at
 * `lightPositionOf()` and sizes it 86 px on a bright stop and 48 on a dark one.
 * That is another lane's object, so the WORDMARK moves instead - down, because
 * the disc's centre is around y=300 to 330 at every stop and there is not enough
 * room above it for a 218 px lockup.
 *
 * The radii below mirror a constant `parallax.ts` does not export. They are only
 * ever used to move our own type out of the way, so if the sun is resized the
 * worst case is the wordmark sitting a few pixels closer to it than intended -
 * never type drawn on top of it, because the dodge is recomputed from the disc's
 * position every time the screen is built.
 */
const SUN_R_BRIGHT = 86;
const SUN_R_DIM = 48;
const SUN_GAP = 18;

/**
 * Ink for a label sitting on a filled accent surface. The same near-black the
 * stage report puts on its primary button, so "the filled one is the one you
 * meant" is one treatment across the game rather than two near-misses.
 */
const BUTTON_INK = INK.panelSunken;

/**
 * THE MENU COLUMN'S SPACING LIVES IN `support/titleStack.ts` (UR-68).
 *
 * It used to be four constants here - `PRIMARY_Y_MAX` 740, `PRIMARY_GAP` 92,
 * `SETTINGS_GAP` 166, `LANG_GAP` 174 - every one of them measured from the
 * wordmark, plus a status line placed at a fixed local offset inside the
 * primary button with no gap of its own. A block that does not claim space
 * takes somebody else's: the status line landed 10 px under the primary's plate
 * and 0 px above the settings plate, and inside the focus rings this screen
 * draws it OVERLAPPED both by 4 and 6 px.
 *
 * `titleStack()` places each block from the one above it and carries the
 * numbers, so the gaps are a budget a test can hold rather than four literals
 * that happen to sum correctly in the one profile state anybody captures.
 */

/**
 * Endonyms for the language switch (D45). These are language TAGS, not UI copy:
 * a Spanish speaker looking for Spanish looks for "ES", in every locale. They
 * are deliberately not routed through the string table.
 */
const LANG_LABEL: Record<Lang, string> = { en: "EN", es: "ES", hi: "हिं" };

/** Where the world scrolls on the title. Slow: this is an idle, not a flight. */
const TITLE_WORLD_SPEED = 74;

interface MenuItem {
  readonly id: "primary" | "settings" | "lang";
  readonly root: Phaser.GameObjects.Container;
  readonly width: number;
  readonly height: number;
  /**
   * The item's PLATE box, which is what the eye measures a gap against and is
   * not the same rectangle as `height` (UR-68).
   *
   * `height` is the focusable ink the ring is drawn around; a quiet control's
   * plate is `CHROME_PAD_Y` taller at both ends and starts that far ABOVE
   * `root.y`. Placing the column from `root.y` is what let the status line's
   * plate and the settings plate touch while both items' rings looked clear.
   */
  readonly plateH: number;
  /** How far the plate's top sits above `root.y`. */
  readonly plateTop: number;
  readonly activate: () => void;
}

export class TitleScene extends Phaser.Scene {
  private parallax!: Parallax;
  private lantern!: LanternRig;
  /** Where the Lantern was drawn this build, for `snapshot()` (UR-48). */
  private lanternAt = { x: 0, y: 0, height: 0 };
  private items: MenuItem[] = [];
  /**
   * The beacon status line's measured plate height, or null when there is none
   * (UR-68).
   *
   * NULL IS THE STATE EVERY CAPTURE OF THIS SCREEN HAS BEEN IN. The line is
   * only drawn once a beacon has been placed (D13), so a fresh profile has no
   * such block and the column it crowds does not exist to be photographed. Held
   * on the scene because `buildPrimary` is what measures it and `titleStack`
   * is what needs it, one step later.
   */
  private statusPlateH: number | null = null;
  /** How far the column runs past the floor. 0 unless a stop's sun pushes it. */
  private stackOverflow = 0;
  private focusIndex = 0;
  private focusRing!: Phaser.GameObjects.Graphics;
  /**
   * THE CHROME ACCENT IS FIXED (UR-49, coding-standards rule 1).
   *
   * `readonly`, and that is the fix rather than a detail of it. This used to be
   * a mutable field seeded with the same literal, and `create` overwrote it
   * with `paletteAt(furthestBeacon).accent` - so a themed value reached the
   * wordmark tint, the "KEY" glyphs, the accent rule, the primary button plate
   * AND `drawFocusRing`. At Saturn that is pale blue on a bright beige sky.
   *
   * A theme may set the SKY and nothing else. `pal` still reaches
   * `buildParallax` below, which is the one seam it is allowed through; making
   * this field readonly means the compiler now refuses the assignment that
   * caused the defect, rather than a reviewer having to notice it again.
   *
   * It also restores something that was never meant to move: the focus ring is
   * specified as one gold for the whole menu system (`INK.accent`), and it had
   * been quietly wearing the stop's colour on every themed boot.
   */
  private readonly accent = INK.accent;
  private langIndex = 0;

  constructor() {
    super(SCENE_KEYS.title);
  }

  create(): void {
    ensureTextures(this);
    const { context, store, t } = services(this);
    const W = this.scale.width;
    const H = this.scale.height;

    // The title wears the palette of the furthest beacon, so a returning pilot
    // opens the game somewhere they have already been (D13). THE SKY, AND
    // NOTHING ELSE (UR-49): `pal` goes to `buildParallax` and stops there. It
    // used to be copied into `this.accent` on the next line, which is what put
    // a stop colour on the type, the button and the focus ring.
    const furthest = furthestBeacon(store);
    const pal = paletteAt(furthest ?? "earth", context.colorblindPalette);

    /**
     * UR-06: KEEP THE DEBRIS OFF OUR OWN TYPE.
     *
     * `LANE_GUARD` keeps decorative rocks out of the SHIP'S lane, which is the
     * centre of the frame — and this screen's whole left column of type sits in
     * the left band, which is exactly where the guard sends them. A rock landed
     * across the "K" of KEYBLASTER.
     *
     * The moon note above solved the same class of problem the other way round:
     * the sun is another lane's object so our TYPE moved. Decorative debris is
     * ours to place, so here the DEBRIS moves. `parallax.ts` cannot know where a
     * scene's text is; the scene can, so it says.
     *
     * THE ZONE ITSELF MOVED OUT OF THIS FILE (UR-52). It was assembled here, as
     * a rect literal, and the same defect then landed on the Director map's
     * planets because a paragraph in one scene is not a mechanism. It is now
     * `support/titleLayout.ts` -> `render/keepClear.ts`, which every screen
     * registers with and which a unit test can hold without booting Phaser.
     */
    const textKeepClear = titleKeepClear(W);

    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: context.reducedMotion,
      worldSpeed: TITLE_WORLD_SPEED,
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x1a17e,
      keepClear: textKeepClear,
    });

    // --- the Lantern, idling in the ship plane ---------------------------
    // THE PILOT'S OWN HULL (UR-48). This screen drew the ship in the file
    // constants, which meant the FIRST screen a returning pilot sees showed
    // them somebody else's ship - the one place a wrong hull is most visible.
    // `drawPlayerLantern` resolves it from the profile and delegates to the one
    // `drawLantern` (standards rule 3): there is no second drawing here.
    // Where the ship was actually put, reported in `snapshot()` so
    // `hull-livery.spec.ts` can clip a frame at the ship instead of at a
    // remembered constant - `GAME_WIDTH` is derived from the window (D99), so a
    // hardcoded clip measures the wrong part of a 21:9 frame and reports zero,
    // which reads as a defect rather than as a bad measurement.
    this.lanternAt = { x: W * 0.72, y: H * 0.58, height: H * 0.42 };
    this.lantern = drawPlayerLantern(this, W * 0.72, H * 0.58, {
      scale: (H * 0.42) / LANTERN_DESIGN_HEIGHT,
      reducedMotion: context.reducedMotion,
      idleBob: true,
      exhaust: true,
      beam: true,
      iris: 0.8,
    });
    this.parallax.layerOf("shipFx").container.add(this.lantern.container);

    // --- wordmark ---------------------------------------------------------
    const hud = this.parallax.layerOf("hud").container;
    const mark = this.buildWordmark(t.t("title.tagline"), pal);
    hud.add(mark.root);

    // --- menu -------------------------------------------------------------
    this.focusRing = this.add.graphics();
    hud.add(this.focusRing);

    const returning = furthest !== null;
    const primaryLabel = returning ? t.t("results.continue") : t.t("title.play");
    const primarySub = returning
      ? t.t("beacon.placed", { stop: paletteAt(furthest, false).name })
      : null;

    // BUILT FIRST, PLACED SECOND (UR-68). Every block is built at y=0 so its
    // plate can be MEASURED, and only then does `titleStack` decide where the
    // column sits. The heights are not knowable in advance - a control's plate
    // is its own type's line box plus padding, and Devanagari's line box is
    // 1.56 em against Latin's 1.3 (`ui/theme.LINE_HEIGHT`, measured) - so a
    // column placed from constants is a column that has guessed them.
    const primary = this.buildPrimary(primaryLabel, primarySub, WORDMARK_X, 0);
    const settings = this.buildQuiet(t.t("title.settings"), WORDMARK_X, 0);
    // D95: the language row only exists when there is a choice to make. With a
    // single shipped language it is a one-option selector, which is noise on
    // the first screen a child sees - and it was still offering ES and हिं
    // after the content cut, which is worse than noise: it offers a language
    // the game will not switch to.
    const lang = SHIPPED_LANGS.length > 1 ? this.buildLangRow(WORDMARK_X, 0) : null;

    // The column follows the lockup down when the sun has pushed it, so the
    // relationship between the mark and the first action is the same picture
    // wherever the light happens to be for this pilot's furthest beacon.
    const stack = titleStack({
      markBottom: mark.bottom,
      primaryH: PRIMARY_H,
      statusH: this.statusPlateH,
      settingsH: settings.plateH,
      langH: lang?.plateH ?? null,
    });
    primary.root.setY(stack.primaryY + primary.plateTop);
    settings.root.setY(stack.settingsY + settings.plateTop);
    if (lang !== null && stack.langY !== null) lang.root.setY(stack.langY + lang.plateTop);
    this.stackOverflow = stack.overflow;

    hud.add([primary.root, settings.root, ...(lang ? [lang.root] : [])]);
    this.items = lang ? [primary, settings, lang] : [primary, settings];

    this.bindKeyboard();
    this.bindPointers();
    this.setFocus(0);
    this.publishDebug();

    // Entrance: everything arrives, nothing slides linearly (AC-22.5).
    for (const [i, item] of this.items.entries()) {
      item.root.setAlpha(0);
      this.tweens.add({
        targets: item.root,
        alpha: 1,
        x: { from: item.root.x - 26, to: item.root.x },
        delay: 90 * i,
        duration: 420,
        ease: EASE.arrive,
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.lantern.destroy();
      this.parallax.destroy();
    });
  }

  override update(_time: number, delta: number): void {
    this.parallax.update(delta);
    // Redrawn every frame so the ring tracks the entrance and focus tweens
    // instead of sitting where the item used to be.
    this.drawFocusRing();
  }

  // -------------------------------------------------------------------------
  // Pieces
  // -------------------------------------------------------------------------

  /**
   * Where the lockup has to sit so the stop's sun is not inside the letters.
   *
   * `width` is the measured width of the mark, so a sun off to the side of it -
   * Neptune's and Pluto's both are - moves nothing at all and the screen keeps
   * the composition it was designed with.
   */
  private wordmarkY(pal: StopPalette, width: number): number {
    const at = lightPositionOf(pal);
    const cx = at.x * this.scale.width;
    const cy = at.y * this.scale.height;
    const r = isBrightStop(pal) ? SUN_R_BRIGHT : SUN_R_DIM;
    if (cx + r < WORDMARK_X || cx - r > WORDMARK_X + width) return WORDMARK_Y;
    return Math.max(WORDMARK_Y, cy + r + SUN_GAP);
  }

  private buildWordmark(
    tagline: string,
    pal: StopPalette,
  ): { root: Phaser.GameObjects.Container; bottom: number } {
    const c = this.add.container(WORDMARK_X, WORDMARK_Y);
    const cream = "#F7F2E6";

    const glow = this.add
      .image(250, 46, TEX.glow)
      .setDisplaySize(900, 360)
      .setTint(hexToNum(this.accent))
      .setAlpha(0.2)
      .setBlendMode(Phaser.BlendModes.ADD);
    c.add(glow);

    // THE ONE STRING ON THIS SCREEN THAT KEEPS ITS CAPITALS. D41 lowercases
    // chrome; a wordmark is a logo, not chrome, and it is drawn rather than
    // translated - it is the same six letters in every locale.
    const style = { fontFamily: FONT, fontSize: "128px", fontStyle: "900" };
    const key = this.add.text(0, 0, "KEY", { ...style, color: this.accent }).setLetterSpacing(2);
    const blaster = this.add
      .text(key.width + 6, 0, "BLASTER", { ...style, color: cream })
      .setLetterSpacing(2);
    key.setShadow(0, 6, "#00000066", 12, false, true);
    blaster.setShadow(0, 6, "#00000066", 12, false, true);
    c.add([key, blaster]);

    const markW = key.width + blaster.width + 6;

    // A drawn accent rule under the mark: the beacon beam, laid flat.
    const rule = this.add.graphics();
    rule.fillStyle(hexToNum(this.accent), 1);
    rule.fillRoundedRect(0, 152, 10, 8, 4);
    c.add(rule);
    this.tweens.add({
      targets: rule,
      scaleX: { from: 1, to: markW / 10 },
      duration: 700,
      delay: 140,
      ease: EASE.blast,
    });

    // The tagline is chrome, so it is lowercase (D41) and on a plate: on a
    // bright stop's sky - Saturn's is near ivory - cream type on open sky is
    // unreadable, and the Title wears the palette of the furthest beacon.
    const sub = skyText(this, 2, 178, chromeCase(tagline, typographyOf(this).uppercase), {
      screen: "title",
      id: "title.tagline",
      size: TYPE.body,
      // UR-65: gold, not the dim ink the menu chrome uses. At textDim on a
      // plate the tagline read as another button sitting under the wordmark,
      // which is what it looked like next to the settings control. A FIXED
      // token, never the loaded stop's accent - coding-standards rule 1: a
      // theme may change the background and nothing else, and this line is
      // type.
      color: INK.accent,
      lang: this.langOf(),
      depth: 1,
      padY: 8,
    });
    if (sub.plate !== null) c.add(sub.plate);
    c.add(sub.text);

    c.setY(this.wordmarkY(pal, markW));
    return { root: c, bottom: c.y + LOCKUP_H };
  }

  private langOf(): Lang {
    return services(this).t.lang;
  }

  private buildPrimary(
    label: string,
    subline: string | null,
    x: number,
    y: number,
  ): MenuItem {
    const width = PRIMARY_W;
    const height = PRIMARY_H;
    const root = this.add.container(x, y);

    const plate = this.add.graphics();
    plate.fillStyle(hexToNum(this.accent), 1);
    plate.fillRoundedRect(0, 0, width, height, 26);
    plate.fillStyle(hexToNum(mixHex(this.accent, "#FFFFFF", 0.35)), 0.5);
    plate.fillRoundedRect(4, 4, width - 8, height * 0.42, 22);
    root.add(plate);

    // The label is already ON a surface this screen drew, so it takes no plate
    // of its own - but it is still REGISTERED, with the accent it actually sits
    // on, because "it's on a panel, trust me" is how unreadable text ships.
    root.add(
      skyText(this, width / 2, height / 2, chromeCase(label, typographyOf(this).uppercase), {
        screen: "title",
        id: "title.primary",
        size: TYPE.heading,
        color: BUTTON_INK,
        align: "center",
        lang: this.langOf(),
        plated: true,
        plateFill: this.accent,
        depth: 1,
        originX: 0.5,
        originY: 0.5,
      }).text,
    );

    this.statusPlateH = null;
    if (subline !== null) {
      /**
       * THE STATUS LINE'S OWN GAP (UR-68).
       *
       * It used to hang at `height + 18`, which put its plate 10 px under the
       * button's and INSIDE the primary's focus ring - the ring reaches 14 px
       * below the plate, so the two were drawn through each other. It now
       * starts one ring plus `STATUS_GAP` below the button, which is the same
       * arithmetic `titleStack` uses to decide where the settings control goes.
       * The offset is a constant because it has to be: the line is built here
       * and measured after, so it cannot be positioned from its own height.
       */
      const plateTop = height + FOCUS_PAD + STATUS_GAP;
      // NOT lowercased: the subline names the planet the beacon is on, and a
      // planet name is a proper noun that keeps its capital (D41).
      const sub = skyText(this, 4, plateTop + CHROME_PAD_Y, subline, {
        screen: "title",
        id: "title.primarySub",
        size: TYPE.label,
        color: INK.textDim,
        lang: this.langOf(),
        depth: 1,
        padY: CHROME_PAD_Y,
      });
      if (sub.plate !== null) root.add(sub.plate);
      root.add(sub.text);
      this.statusPlateH = sub.text.height + CHROME_PAD_Y * 2;
    }

    return {
      id: "primary",
      root,
      width,
      height,
      plateH: height,
      plateTop: 0,
      activate: () => this.startGame(),
    };
  }

  private buildQuiet(label: string, x: number, y: number): MenuItem {
    const root = this.add.container(x, y);
    const item = skyText(this, 4, 0, chromeCase(label, typographyOf(this).uppercase), {
      screen: "title",
      id: "title.settings",
      size: TYPE.body,
      color: INK.text,
      lang: this.langOf(),
      depth: 1,
      padY: CHROME_PAD_Y,
    });
    if (item.plate !== null) root.add(item.plate);
    root.add(item.text);
    return {
      id: "settings",
      root,
      width: item.text.width + 8,
      height: item.text.height,
      // The plate is the padding taller at each end and starts that far above
      // `root.y`, because `skyText` cuts it from the text's own bounds.
      plateH: item.text.height + CHROME_PAD_Y * 2,
      plateTop: CHROME_PAD_Y,
      activate: () => this.goto(SCENE_KEYS.settings),
    };
  }

  /** D45: visible, but quiet. Left/Right moves along it; Enter applies. */
  private buildLangRow(x: number, y: number): MenuItem {
    const root = this.add.container(x, y);
    const { t } = services(this);
    this.langIndex = Math.max(0, SHIPPED_LANGS.indexOf(t.lang));
    const padY = 6;
    let cursor = 4;
    let inkH = 0;
    SHIPPED_LANGS.forEach((lang, i) => {
      const on = i === this.langIndex;
      const item = skyText(this, cursor, 0, LANG_LABEL[lang], {
        screen: "title",
        id: on ? "title.lang.on" : "title.lang.off",
        size: TYPE.label,
        color: on ? this.accent : INK.textDim,
        lang: t.lang,
        depth: 1,
        padY,
      });
      item.text.setName(`lang-${lang}`);
      if (item.plate !== null) root.add(item.plate);
      root.add(item.text);
      cursor += item.text.width + 26;
      // MEASURED, not the 34 that was here (UR-68). "हिं" is drawn in a
      // Devanagari face whose line box is 1.56 em against Latin's 1.3, so a
      // fixed row height is wrong by construction the moment the row is in the
      // language it exists to offer.
      inkH = Math.max(inkH, item.text.height);
    });
    return {
      id: "lang",
      root,
      width: cursor,
      height: inkH,
      plateH: inkH + padY * 2,
      plateTop: padY,
      activate: () => this.cycleLang(1),
    };
  }

  // -------------------------------------------------------------------------
  // Keyboard (AC-18.1)
  // -------------------------------------------------------------------------

  private bindKeyboard(): void {
    const kb = this.input.keyboard;
    if (kb === null || kb === undefined) return;
    kb.on("keydown", (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          this.moveFocus(1);
          break;
        case "ArrowUp":
          this.moveFocus(-1);
          break;
        case "Tab":
          event.preventDefault();
          this.moveFocus(event.shiftKey ? -1 : 1);
          break;
        case "ArrowRight":
          if (this.currentItem()?.id === "lang") {
            this.cycleLang(1);
            uiSoundBlip("nav");
          }
          break;
        case "ArrowLeft":
          if (this.currentItem()?.id === "lang") {
            this.cycleLang(-1);
            uiSoundBlip("nav");
          }
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          this.currentItem()?.activate();
          uiSoundBlip("activate");
          break;
        default:
          break;
      }
    });
  }

  /**
   * The pointer half of AC-18.1, on the one screen that predates the menu kit
   * and rolls its own list. Same three rules the kit uses (ui/focus.ts):
   * hover focuses, press focuses then activates, and the keyboard above is
   * untouched and still sufficient on its own.
   *
   * The hit area is the rectangle `drawFocusRing` strokes, padding included, so
   * what looks clickable and what is clickable are one box. Bound before the
   * entrance tweens run, while `root.x` still holds each item's final x - the
   * tween starts 26 px to the left of it and arrives back at it.
   */
  private bindPointers(): void {
    const pad = FOCUS_PAD;
    for (const [i, item] of this.items.entries()) {
      this.add
        .zone(item.root.x - pad, item.root.y - pad, item.width + pad * 2, item.height + pad * 2)
        .setOrigin(0, 0)
        .setName(`${HIT_ZONE_PREFIX}${item.id}`)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", () => {
          if (i === this.focusIndex) return;
          this.setFocus(i);
          uiSoundBlip("nav");
        })
        .on("pointerdown", () => {
          this.setFocus(i);
          item.activate();
          uiSoundBlip("activate");
        });
    }
  }

  private currentItem(): MenuItem | undefined {
    return this.items[this.focusIndex];
  }

  private moveFocus(step: number): void {
    if (this.items.length === 0) return;
    this.setFocus((this.focusIndex + step + this.items.length) % this.items.length);
    // D62 "UI sounds for every interaction" / AC-21.3 `uiNav`. This screen
    // predates the menu kit and rolls its own list, so it calls the kit's sound
    // hook directly rather than growing a fourth definition of a menu blip.
    // `setFocus` stays silent: it is also how the screen opens.
    uiSoundBlip("nav");
  }

  /** AC-18.1: focus is never invisible. One stroked ring, in the accent. */
  private drawFocusRing(): void {
    const item = this.items[this.focusIndex];
    this.focusRing.clear();
    if (item === undefined) return;
    const pad = FOCUS_PAD;
    this.focusRing.lineStyle(4, hexToNum(this.accent), 1);
    this.focusRing.strokeRoundedRect(
      item.root.x - pad,
      item.root.y - pad,
      item.width + pad * 2,
      item.height + pad * 2,
      item.id === "primary" ? 34 : 14,
    );
  }

  private setFocus(index: number): void {
    this.focusIndex = index;
    const item = this.items[index];
    this.drawFocusRing();
    if (item === undefined) return;
    this.tweens.add({
      targets: item.root,
      scale: { from: 0.985, to: 1 },
      duration: 220,
      ease: EASE.pop,
    });
    this.publishDebug();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private cycleLang(step: number): void {
    const next =
      SHIPPED_LANGS[(this.langIndex + step + SHIPPED_LANGS.length) % SHIPPED_LANGS.length];
    if (next === undefined) return;
    services(this).setLang(next);
    // Rebuilding is the honest way to re-flow copy that changes length by +25%
    // in Spanish and changes script entirely in Hindi.
    this.scene.restart();
  }

  private startGame(): void {
    // The route out of the Title depends on which lanes have landed. Each
    // candidate is tried in screen-inventory order and skipped if its scene is
    // not registered, so the Title never dead-ends on a half-built build.
    for (const key of [
      SCENE_KEYS.profilePicker,
      SCENE_KEYS.earthActivation,
      SCENE_KEYS.map,
    ]) {
      if (this.goto(key)) return;
    }
  }

  private goto(key: string): boolean {
    if (this.scene.get(key) === null) return false;
    this.cameras.main.fadeOut(260, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(key);
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Debug surface for the e2e suite (AC-22.1 overlay, AC-22.2, AC-18.1).
  // -------------------------------------------------------------------------

  /**
   * What `scripts/capture-screens.mjs` reads off this screen.
   *
   * It exists for its `skyText` field: AC-22.8's rubric measures the colour
   * pairs a scene REGISTERS, and a screen that registers nothing is a screen
   * nobody has measured. The Title is not in the rubric's required list, so
   * every row here is one more pair that cannot quietly go unreadable on a
   * bright stop - which this screen can be, because it wears the palette of the
   * pilot's furthest beacon.
   */
  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.title,
      // UR-48. The hull this screen is drawing, and where. The FIRST screen a
      // returning pilot sees used to draw the file constants regardless of
      // whose save was loaded; `shipLivery` is what says it no longer does, and
      // `ship` is what lets a spec point a camera at it.
      ship: { ...this.lanternAt },
      shipLivery: playerLivery(this) ?? null,
      focusIndex: this.focusIndex,
      items: this.items.map((i) => i.id),
      skyText: skyTextSamples(this),
    };
  }

  private publishDebug(): void {
    const { context, store, t } = services(this);
    const furthest = furthestBeacon(store);
    const bag = (window as unknown as Record<string, Record<string, unknown>>)["__kb"];
    if (bag === undefined) return;
    bag["title"] = {
      focusIndex: this.focusIndex,
      items: this.items.map((i) => i.id),
      primary: furthest === null ? "play" : "continue",
      furthestBeacon: furthest,
      lang: t.lang,
      reducedMotion: context.reducedMotion,
      /**
       * UR-68. How far the menu column runs past the floor, in px.
       *
       * Published rather than inferred because the column's height depends on
       * where this stop's light pushed the lockup, and a spec that re-derived
       * that would be agreeing with itself. Any value above 0 means the budget
       * ran out and something is drawn below where the product's hint line
       * starts - which is a layout failure the screen can state plainly
       * instead of a reader having to notice it in a capture.
       */
      stackOverflow: this.stackOverflow,
      parallaxOffsets: () => this.parallax.debugOffsets(),
      motion: () => this.parallax.debugMotion(),
    };
  }
}
