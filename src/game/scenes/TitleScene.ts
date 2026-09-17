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
import { LANTERN_DESIGN_HEIGHT, drawLantern, type LanternRig } from "../render/lantern.js";
import { LANGS, type Lang } from "../../engine/types.js";
import { SHIPPED_LANGS } from "../../engine/i18n/index.js";
import { HIT_ZONE_PREFIX, uiSoundBlip } from "@game/ui/focus";
import { INK, TYPE, chromeCase } from "@game/ui/theme";
import { skyText, skyTextSamples, type SceneSnapshot } from "./lib/kit.js";

/**
 * The wordmark's own face. Everything ELSE on this screen is now dressed from
 * the theme, because a title that uses one type stack for its chrome and the
 * rest of the game another is two designs; a logo is allowed its own face.
 */
const FONT = '"Avenir Next","Nunito","Trebuchet MS",system-ui,sans-serif';

/** Where the lockup sits when nothing is in the way of it. */
const WORDMARK_X = 200;
const WORDMARK_Y = 250;
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
 * The lowest the primary action is allowed to be pushed by that dodge.
 *
 * A guard, not a working number: the furthest the lockup ever moves is Mars'
 * sun at y=419, which puts the button at 729. It exists so that a future change
 * to either the sun or the lockup cannot walk the menu off the bottom of the
 * frame without anyone noticing.
 */
const PRIMARY_Y_MAX = 740;
/** Gaps down the menu column, preserved from the layout this screen shipped. */
const PRIMARY_GAP = 92;
const SETTINGS_GAP = 166;
const LANG_GAP = 174;
/** The language row is the last thing down the column and must stay on screen. */
const LANG_Y_MAX = 1000;

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
  readonly activate: () => void;
}

export class TitleScene extends Phaser.Scene {
  private parallax!: Parallax;
  private lantern!: LanternRig;
  private items: MenuItem[] = [];
  private focusIndex = 0;
  private focusRing!: Phaser.GameObjects.Graphics;
  private accent = "#FFC857";
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
    // opens the game somewhere they have already been (D13).
    const furthest = furthestBeacon(store);
    const pal = paletteAt(furthest ?? "earth", context.colorblindPalette);
    this.accent = pal.accent;

    this.parallax = buildParallax(this, {
      palette: pal,
      reducedMotion: context.reducedMotion,
      worldSpeed: TITLE_WORLD_SPEED,
      seed: 0x1a17e,
    });

    // --- the Lantern, idling in the ship plane ---------------------------
    this.lantern = drawLantern(this, W * 0.72, H * 0.58, {
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

    // The column follows the lockup down when the sun has pushed it, so the
    // relationship between the mark and the first action is the same picture
    // wherever the light happens to be for this pilot's furthest beacon.
    const primaryY = Math.min(mark.bottom + PRIMARY_GAP, PRIMARY_Y_MAX);
    const settingsY = primaryY + SETTINGS_GAP;
    const primary = this.buildPrimary(primaryLabel, primarySub, WORDMARK_X, primaryY);
    const settings = this.buildQuiet(t.t("title.settings"), WORDMARK_X, settingsY);
    // D95: the language row only exists when there is a choice to make. With a
    // single shipped language it is a one-option selector, which is noise on
    // the first screen a child sees - and it was still offering ES and हिं
    // after the content cut, which is worse than noise: it offers a language
    // the game will not switch to.
    const lang =
      SHIPPED_LANGS.length > 1
        ? this.buildLangRow(WORDMARK_X, Math.min(settingsY + LANG_GAP, LANG_Y_MAX))
        : null;
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
    const sub = skyText(this, 2, 178, chromeCase(tagline, false), {
      screen: "title",
      id: "title.tagline",
      size: TYPE.body,
      color: INK.textDim,
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
    const width = 460;
    const height = 104;
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
      skyText(this, width / 2, height / 2, chromeCase(label, false), {
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

    if (subline !== null) {
      // NOT lowercased: the subline names the planet the beacon is on, and a
      // planet name is a proper noun that keeps its capital (D41).
      const sub = skyText(this, 4, height + 18, subline, {
        screen: "title",
        id: "title.primarySub",
        size: TYPE.label,
        color: INK.textDim,
        lang: this.langOf(),
        depth: 1,
        padY: 8,
      });
      if (sub.plate !== null) root.add(sub.plate);
      root.add(sub.text);
    }

    return { id: "primary", root, width, height, activate: () => this.startGame() };
  }

  private buildQuiet(label: string, x: number, y: number): MenuItem {
    const root = this.add.container(x, y);
    const item = skyText(this, 4, 0, chromeCase(label, false), {
      screen: "title",
      id: "title.settings",
      size: TYPE.body,
      color: INK.text,
      lang: this.langOf(),
      depth: 1,
      padY: 8,
    });
    if (item.plate !== null) root.add(item.plate);
    root.add(item.text);
    return {
      id: "settings",
      root,
      width: item.text.width + 8,
      height: item.text.height,
      activate: () => this.goto(SCENE_KEYS.settings),
    };
  }

  /** D45: visible, but quiet. Left/Right moves along it; Enter applies. */
  private buildLangRow(x: number, y: number): MenuItem {
    const root = this.add.container(x, y);
    const { t } = services(this);
    this.langIndex = Math.max(0, SHIPPED_LANGS.indexOf(t.lang));
    let cursor = 4;
    SHIPPED_LANGS.forEach((lang, i) => {
      const on = i === this.langIndex;
      const item = skyText(this, cursor, 0, LANG_LABEL[lang], {
        screen: "title",
        id: on ? "title.lang.on" : "title.lang.off",
        size: TYPE.label,
        color: on ? this.accent : INK.textDim,
        lang: t.lang,
        depth: 1,
        padY: 6,
      });
      item.text.setName(`lang-${lang}`);
      if (item.plate !== null) root.add(item.plate);
      root.add(item.text);
      cursor += item.text.width + 26;
    });
    return {
      id: "lang",
      root,
      width: cursor,
      height: 34,
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
    const pad = 14;
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
    const pad = 14;
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
      parallaxOffsets: () => this.parallax.debugOffsets(),
      motion: () => this.parallax.debugMotion(),
    };
  }
}
