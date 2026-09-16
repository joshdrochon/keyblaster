import { GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { availableContentLangs, resolveContentLang } from "@engine/i18n";
import {
  type InputMethod,
  type KeyboardLayout,
  type Lang,
  LANGS,
  type Settings,
} from "@engine/types";
import { MenuScene } from "@game/ui/MenuScene";
import {
  type Control,
  type OptionChoice,
  MenuButton,
  OptionRow,
  SliderRow,
  ToggleRow,
} from "@game/ui/controls";
import { plate, strokePlate } from "@game/ui/chrome";
import { hexToNum } from "@game/render/palette";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";
import type { MenuKey } from "@game/ui/i18n";

/**
 * SCREEN 11 - SETTINGS (D41, D45; AC-19.1 to AC-19.4).
 *
 * "Settings should look like ship controls, not a form", so the screen is two
 * consoles - the sound desk and the flight deck - each on its own plate, with
 * the values as sliders, pips and readouts rather than as labelled inputs.
 *
 * AC-19.1: every setting PERSISTS and TAKES EFFECT WITHOUT A RELOAD. Both
 * halves are real work and they are done differently:
 *   - persist: `app.applySettings` writes through the profile store and flushes
 *     immediately, so the value survives the tab closing a second later;
 *   - take effect: anything that changes how text or motion is drawn restarts
 *     this scene in place (NOT the page) and restores the focused row, so the
 *     child sees the new letter case or language on the control they just
 *     touched. Volumes and layout need no redraw and are pushed straight at the
 *     thing that consumes them.
 *
 * AC-19.4: there is NO difficulty selector and NO dyslexia-font toggle. Both
 * are deliberate exclusions in D41, and the e2e asserts their absence rather
 * than trusting this comment.
 *
 * AC-14.1: the content-language row is filtered by input method. `hi` is only
 * offered when Hindi can actually be typed; when it is not, the row carries one
 * calm line saying which keyboard to pick.
 *
 * AC-22b.1 / D31: reset progress is the most destructive thing in the game and
 * it is drawn in exactly the same ink as everything else. No red, no warning
 * triangle, no shouting - it asks twice, in plain words, and the safe answer
 * has focus both times.
 */
export class SettingsScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.settings;

  /** Scene data: where to go on Esc, and which row to re-focus after a restart. */
  private returnTo: string = SCENE_KEYS.map;
  private restoreFocus: string | null = null;
  private resetStage = 0;

  constructor() {
    super({ key: SCENE_KEYS.settings });
  }

  init(data?: { returnTo?: string; focus?: string }): void {
    if (data?.returnTo) this.returnTo = data.returnTo;
    this.restoreFocus = data?.focus ?? null;
  }

  protected build(): void {
    this.addHeading("ui.settings.heading");
    this.repairLanguagePair();
    const s = this.app.settings();
    const colW = Math.min(820, (GAME_WIDTH - SPACE.gutter * 3) / 2);
    const leftX = SPACE.gutter;
    const rightX = SPACE.gutter * 2 + colW;

    this.panelPlate(leftX - 24, 190, colW + 48, 700);
    this.panelPlate(rightX - 24, 190, colW + 48, 760);

    const controls: Control[] = [];
    let y = 230;
    const advance = (c: Control): void => {
      controls.push(c);
      y += c.ringBounds().h + 14;
    };

    // --- sound desk --------------------------------------------------------
    advance(
      new SliderRow(this, this.uiStyle, "settings.music", leftX, y, this.depth, {
        label: this.t.t("ui.settings.music"),
        width: colW,
        value: s.musicVolume,
        format: (v) => this.t.t("ui.common.percent", { percent: Math.round(v * 100) }),
        onChange: (v) => {
          this.app.applySettings({ musicVolume: v });
          this.pushVolumes();
        },
      }),
    );
    advance(
      new SliderRow(this, this.uiStyle, "settings.sfx", leftX, y, this.depth, {
        label: this.t.t("ui.settings.sfx"),
        width: colW,
        value: s.sfxVolume,
        format: (v) => this.t.t("ui.common.percent", { percent: Math.round(v * 100) }),
        onChange: (v) => {
          this.app.applySettings({ sfxVolume: v });
          this.pushVolumes();
        },
      }),
    );

    // --- keyboard and language --------------------------------------------
    advance(
      new OptionRow<KeyboardLayout>(
        this,
        this.uiStyle,
        "settings.keyboardLayout",
        leftX,
        y,
        this.depth,
        {
          label: this.t.t("ui.settings.keyboardLayout"),
          width: colW,
          value: s.keyboardLayout,
          choices: (["qwerty", "azerty", "qwertz", "dvorak"] as const).map(
            (id) => ({
              value: id,
              label: this.t.t(`ui.settings.layout.${id}` as MenuKey),
            }),
          ),
          // AC-19.2: the layout is a key->char map the lock engine reads off
          // the profile, so storing it IS applying it - the very next keystroke
          // is matched through the new map with no reload and no restart.
          onChange: (v) => this.app.applySettings({ keyboardLayout: v }),
        },
      ),
    );
    advance(
      new OptionRow<InputMethod>(
        this,
        this.uiStyle,
        "settings.inputMethod",
        leftX,
        y,
        this.depth,
        {
          label: this.t.t("settings.inputMethod"),
          width: colW,
          value: s.inputMethod,
          choices: [
            { value: "latin", label: this.t.t("ui.settings.inputMethod.latin") },
            { value: "translit", label: this.t.t("settings.inputMethodTranslit") },
            { value: "inscript", label: this.t.t("settings.inputMethodInscript") },
          ],
          // Changing this can invalidate the content language (AC-14.1).
          // applySettings repairs the pair, so the screen has to redraw to show
          // what it was repaired to.
          onChange: (v) => this.applyAndRestart({ inputMethod: v }),
        },
      ),
    );
    advance(
      new OptionRow<Lang>(this, this.uiStyle, "settings.uiLang", leftX, y, this.depth, {
        label: this.t.t("settings.uiLang"),
        width: colW,
        value: s.uiLang,
        choices: this.langChoices(LANGS),
        onChange: (v) => this.applyAndRestart({ uiLang: v }),
      }),
    );

    const typeable = availableContentLangs(s.inputMethod);
    advance(
      new OptionRow<Lang>(
        this,
        this.uiStyle,
        "settings.contentLang",
        leftX,
        y,
        this.depth,
        {
          label: this.t.t("settings.contentLang"),
          width: colW,
          value: s.contentLang,
          // AC-14.1: only languages this input method can actually produce.
          choices: this.langChoices(typeable),
          note: typeable.length < LANGS.length
            ? this.t.t("settings.contentLangUnavailable")
            : undefined,
          onChange: (v) => this.app.applySettings({ contentLang: v }),
        },
      ),
    );

    // --- flight deck -------------------------------------------------------
    y = 230;
    const advanceRight = (c: Control): void => {
      controls.push(c);
      y += c.ringBounds().h + 14;
    };

    advanceRight(
      new OptionRow<"lower" | "upper">(
        this,
        this.uiStyle,
        "settings.letterCase",
        rightX,
        y,
        this.depth,
        {
          label: this.t.t("ui.settings.letterCase"),
          width: colW,
          // D41: lowercase is the default, so it is the first choice too.
          value: s.uppercase ? "upper" : "lower",
          choices: [
            { value: "lower", label: this.t.t("ui.settings.letterCaseLower") },
            { value: "upper", label: this.t.t("ui.settings.letterCaseUpper") },
          ],
          onChange: (v) => this.applyAndRestart({ uppercase: v === "upper" }),
        },
      ),
    );
    advanceRight(
      new ToggleRow(
        this,
        this.uiStyle,
        "settings.letterSpacing",
        rightX,
        y,
        this.depth,
        {
          label: this.t.t("ui.settings.letterSpacing"),
          width: colW,
          value: s.increasedLetterSpacing,
          onLabel: this.t.t("ui.common.on"),
          offLabel: this.t.t("ui.common.off"),
          onChange: (v) => this.applyAndRestart({ increasedLetterSpacing: v }),
        },
      ),
    );
    advanceRight(
      new ToggleRow(
        this,
        this.uiStyle,
        "settings.reducedMotion",
        rightX,
        y,
        this.depth,
        {
          label: this.t.t("ui.settings.reducedMotion"),
          width: colW,
          value: s.reducedMotion,
          onLabel: this.t.t("ui.common.on"),
          offLabel: this.t.t("ui.common.off"),
          // AC-19.3: shake and camera sway off, gameplay and ambient motion
          // kept. Restarting redraws this screen under the new rule.
          onChange: (v) => this.applyAndRestart({ reducedMotion: v }),
        },
      ),
    );
    advanceRight(
      new ToggleRow(
        this,
        this.uiStyle,
        "settings.colorblind",
        rightX,
        y,
        this.depth,
        {
          label: this.t.t("ui.settings.colorblind"),
          width: colW,
          value: s.colorblindPalette,
          onLabel: this.t.t("ui.common.on"),
          offLabel: this.t.t("ui.common.off"),
          onChange: (v) => this.applyAndRestart({ colorblindPalette: v }),
        },
      ),
    );

    advanceRight(
      new MenuButton(
        this,
        this.uiStyle,
        "settings.resetProgress",
        rightX,
        y + 40,
        this.depth,
        {
          label: this.t.t("ui.settings.resetProgress"),
          minWidth: colW,
          onPress: () => this.askReset(),
        },
      ),
    );

    this.addHint("ui.common.hintAdjust");
    this.setControls(controls);
    if (this.restoreFocus) this.list.focus(this.restoreFocus);
  }

  /**
   * AC-14.1 on the way IN, not only on the way out.
   *
   * A stored profile can carry { contentLang: "hi", inputMethod: "latin" } -
   * the engine can produce that pair and nothing else repairs it - so the first
   * screen that can see both fields fixes it. Guarded on identity, which is
   * what `resolveContentLang` returning the same value means, so opening
   * Settings on a healthy profile writes nothing.
   */
  private repairLanguagePair(): void {
    const s = this.app.settings();
    const repaired = resolveContentLang(s.contentLang, s.inputMethod, s.uiLang);
    if (repaired !== s.contentLang) this.app.applySettings({ contentLang: repaired });
  }

  /** The console plate behind a column: this is a panel, not a page. */
  private panelPlate(x: number, y: number, w: number, h: number): void {
    const g = this.add.graphics().setDepth(this.depth - 1);
    plate(g, x, y, w, h, hexToNum(INK.panelSunken), 0.55, 26);
    strokePlate(g, x, y, w, h, hexToNum(INK.line), 2, 26);
    // A row of indicator pips along the top edge, like a real desk. Decorative
    // and deliberately not a status: nothing here can read as an alarm.
    for (let i = 0; i < 6; i += 1) {
      g.fillStyle(hexToNum(this.uiStyle.accent), i % 2 === 0 ? 0.5 : 0.18);
      g.fillCircle(x + 28 + i * 20, y + 22, 5);
    }
  }

  private langChoices(langs: readonly Lang[]): OptionChoice<Lang>[] {
    return langs.map((lang) => ({
      value: lang,
      label: this.t.t(`ui.settings.lang.${lang}` as MenuKey),
    }));
  }

  /**
   * Push volumes at whatever is actually making sound.
   *
   * The audio lane publishes `createAudioSystem()` but nothing registers a live
   * graph yet, so this handles both: if a graph is on the registry its music
   * and sfx buses are set directly; otherwise Phaser's own sound manager takes
   * the effects level. Either way the change is audible immediately, which is
   * the half of AC-19.1 a storage assertion cannot prove.
   */
  private pushVolumes(): void {
    const s = this.app.settings();
    this.sound.volume = s.sfxVolume;
    const graph = this.registry.get("kb.audio") as
      | { buses?: Record<string, { gain?: { value: number } }> }
      | undefined;
    const music = graph?.buses?.["music"]?.gain;
    if (music) music.value = s.musicVolume;
    const sfx = graph?.buses?.["sfx"]?.gain;
    if (sfx) sfx.value = s.sfxVolume;
  }

  /**
   * Store the change, then redraw this screen under it. `scene.restart` is a
   * SCENE restart, not a page reload: the canvas never blanks, the profile is
   * already written, and the row the child was on comes back focused.
   */
  private applyAndRestart(patch: Partial<Settings>): void {
    this.app.applySettings(patch);
    const focus = this.list.focusId;
    this.scene.restart({ returnTo: this.returnTo, focus });
  }

  /**
   * Two steps, plain language, no red (D41, design brief 13).
   *
   * The two questions are DIFFERENT questions, not the same one twice: the
   * first says what will be cleared and what is kept, the second asks whether
   * to start the route again. A confirm that repeats itself trains a child to
   * press Enter twice.
   */
  private askReset(): void {
    const profile = this.app.profile();
    if (!profile) return;
    this.resetStage = 1;
    this.openConfirm({
      message: this.t.t("ui.settings.resetAsk1", { name: profile.name }),
      confirmLabel: this.t.t("ui.settings.resetProgress"),
      cancelLabel: this.t.t("ui.settings.resetNo"),
      onCancel: () => {
        this.resetStage = 0;
      },
      onConfirm: () => {
        this.resetStage = 2;
        this.openConfirm({
          message: this.t.t("ui.settings.resetAsk2"),
          confirmLabel: this.t.t("ui.settings.resetYes"),
          cancelLabel: this.t.t("ui.settings.resetNo"),
          onCancel: () => {
            this.resetStage = 0;
          },
          onConfirm: () => {
            const store = this.app.services.store;
            store.resetProgress(profile.id);
            store.flush();
            this.resetStage = 3;
            this.showResetDone();
          },
        });
      },
    });
  }

  /** The aftermath is one calm line, not a dialog and not a congratulation. */
  private showResetDone(): void {
    const line = uiText(
      this,
      SPACE.gutter,
      this.scale.height - 176,
      this.t.t("ui.settings.resetDone"),
      {
        size: TYPE.caption,
        color: INK.textDim,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
        wrapWidth: GAME_WIDTH - SPACE.gutter * 2,
      },
    ).setDepth(this.depth + 1);
    line.setAlpha(0);
    this.tweens.add({ targets: line, alpha: 1, duration: 260, ease: "Cubic.Out" });
    this.publish();
  }

  /**
   * AC-18.1: returnable by keyboard. Settings is opened from the map and from
   * Pause, and Esc goes back to whichever it was.
   */
  protected goBack(): void {
    if (this.returnTo === SCENE_KEYS.pause) {
      // Pause is an overlay that was slept, not stopped: waking it puts the
      // player back over their frozen belt rather than restarting the stage.
      this.scene.stop();
      this.scene.wake(SCENE_KEYS.pause);
      return;
    }
    this.goTo(this.returnTo);
  }

  override snapshot(): Record<string, unknown> {
    const s = this.app.settings();
    return {
      ...super.snapshot(),
      settings: { ...s },
      resetStage: this.resetStage,
      returnTo: this.returnTo,
      contentLangChoices: availableContentLangs(s.inputMethod),
    };
  }
}
