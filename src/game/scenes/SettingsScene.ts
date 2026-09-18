import { GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { SHIPPED_LANGS, availableContentLangs, resolveContentLang } from "@engine/i18n";
import {
  type InputMethod,
  type KeyboardLayout,
  type Lang,
  type Settings,
} from "@engine/types";
import { MenuScene } from "@game/ui/MenuScene";
import { type Control } from "@game/ui/controls";
import {
  type HullChoice,
  HullRow,
  KnobRow,
  PanelButton,
  type SelectorChoice,
  SelectorRow,
  SwitchRow,
  drawConsoleFace,
} from "@game/ui/cockpit";
import { liveryForShip } from "@game/ui/catalog";
import { equippedIndex, hullSlots } from "@game/ui/hulls";
import { SETTINGS_CONSOLE, bottomOf, fitPlan, flowColumn } from "@game/ui/layout";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";
import type { MenuKey } from "@game/ui/i18n";
import { audioFrom } from "@game/audio/wiring";

/**
 * SCREEN 11 - SETTINGS (D41, D45; AC-19.1 to AC-19.4).
 *
 * UR-11 asked for this screen to read as a ship's interior, with real hardware
 * - a knob was given as the example - in place of web widgets. The screen it
 * replaced was, in the 17-screen critic's words, "the cleanest UI in the
 * build" - which was true and was also
 * the problem: clean web UI, flat rows and a pill slider with a percentage, in
 * a game about flying a ship.
 *
 * So this is a DIEGETIC INTERFACE (tvtropes: Diegetic Interface; Kerbal Space
 * Program's modelled instrument panels; `20,000 Atmospheres`, where "the user
 * interface is also the world in which you play the game"). Not a menu the
 * player is shown - two console panels the PILOT is sitting at, bezelled,
 * screwed down and lit from above, with a rotary knob for a continuous value, a
 * lit toggle for a binary and a detented selector for a small set.
 * `ui/cockpit.ts` draws the hardware; `ui/panel.ts` holds the maths and the
 * inks; the shape vocabulary is traced from
 * design-reference/refs/cockpit/console-2.png, which is LOOKED AT and never
 * loaded (D83, D84).
 *
 * THREE THINGS OUTRANK THE FICTION and are asserted, not asserted-about:
 *   - AC-18.1. Every control is operated by Left/Right through the one focus
 *     list, and the gold ring lands on its box. `settings.spec.ts` walks the
 *     whole panel and checks the ring at every stop.
 *   - AC-22.8. Every label and value clears 4.5:1 on the charcoal, measured as
 *     a cross product in tests/unit/ui/cockpit.test.ts, with a negative control
 *     so "all green" cannot mean "nothing measured".
 *   - A SEVEN-YEAR-OLD CAN READ IT. Every knob keeps the "70%" the slider had,
 *     every switch keeps the word "on", every selector keeps the name of what
 *     it is set to - each printed behind glass, in the accent, at 12.8:1.
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

    // EVERY CONTROL IS BUILT AT THE TOP OF ITS COLUMN AND POSITIONED AFTERWARDS.
    // A control's height is not known until its label has been wrapped and
    // measured, and on this screen a label that wraps to two lines in Devanagari
    // adds 40 px to a row that is already half again the height of the one it
    // replaced. Stacking as we go is the fixed-pitch defect `layout.ts` exists
    // to prevent; `layoutColumn` flows the measured heights instead.
    const left: Control[] = [];
    const right: Control[] = [];
    const y = SETTINGS_CONSOLE.top;

    // --- sound desk --------------------------------------------------------
    left.push(
      new KnobRow(this, this.uiStyle, "settings.music", leftX, y, this.depth, {
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
    left.push(
      new KnobRow(this, this.uiStyle, "settings.sfx", leftX, y, this.depth, {
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
    left.push(
      new SelectorRow<KeyboardLayout>(
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
    left.push(
      new SelectorRow<InputMethod>(
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
    left.push(
      new SelectorRow<Lang>(this, this.uiStyle, "settings.uiLang", leftX, y, this.depth, {
        label: this.t.t("settings.uiLang"),
        width: colW,
        value: s.uiLang,
        // D95: only languages the build actually ships.
        choices: this.langChoices(SHIPPED_LANGS),
        onChange: (v) => this.applyAndRestart({ uiLang: v }),
      }),
    );

    const typeable = availableContentLangs(s.inputMethod);
    left.push(
      new SelectorRow<Lang>(
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
          // D95: compare against what this input method COULD type, not
          // against every language that exists. After the ship filter
          // `typeable` is always length 1 while LANGS.length is 3, so this
          // note rendered for every player on every input method - telling a
          // child to pick a Hindi keyboard under a row offering only English.
          // Unactionable, and settings.spec.ts:146 then passed for the wrong
          // reason.
          // Show it only when a SHIPPED language is blocked by this input
          // method. Comparing against LANGS made it permanent after D95 (3
          // languages exist, 1 is offered, so it always fired); comparing
          // against typeableContentLangs made it permanent too, for the
          // mirror-image reason. The note is actionable only if changing the
          // keyboard would actually unlock something the build ships.
          note:
            typeable.length < SHIPPED_LANGS.length
              ? this.t.t("settings.contentLangUnavailable")
              : undefined,
          onChange: (v) => this.app.applySettings({ contentLang: v }),
        },
      ),
    );

    // --- flight deck -------------------------------------------------------

    // THE HULL IS THE FIRST THING ON THE FLIGHT DECK, above the reading and
    // motion rows. It is the only control on this panel a child comes here
    // WANTING, and it is the reward the rest of the game is paying out.
    right.push(this.hullRow(rightX, y, colW));

    right.push(
      new SelectorRow<"lower" | "upper">(
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
    right.push(
      new SwitchRow(
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
    right.push(
      new SwitchRow(
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
    right.push(
      new SwitchRow(
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

    const resetKey = new PanelButton(
      this,
      this.uiStyle,
      "settings.resetProgress",
      rightX,
      y,
      this.depth,
      {
        label: this.t.t("ui.settings.resetProgress"),
        minWidth: colW,
        onPress: () => this.askReset(),
      },
    );

    // The one destructive action is set apart from the toggles by a wider gap
    // and is the last thing in the column (D31: it is not hidden, and it is not
    // shouted at either - it simply is not mixed in with the switches).
    const leftBottom = this.layoutColumn(left, leftX);
    const rightBottom = this.layoutColumn(
      right,
      rightX,
      [resetKey],
      SETTINGS_CONSOLE.keyGap,
    );

    this.consoleFace(leftX, leftBottom, colW);
    this.consoleFace(rightX, rightBottom, colW);

    this.addHint("ui.common.hintAdjust");
    this.setControls([...left, ...right, resetKey]);
    if (this.restoreFocus) this.list.focus(this.restoreFocus);
  }

  /**
   * THE EQUIP SURFACE (UR-48; D73, D79; AC-6d.1b, AC-18.1, AC-19.1).
   *
   * ================== THE DEFECT ==================
   * Hulls unlock at 1 / 3 / 5 / 7 beacons and nothing in the shipped game could
   * put one on. The only writer of `profile.shipId` outside the schema was
   * `ProfileCreateScene`, where a pilot who does not exist yet holds `ship-1`
   * and nothing else - so `shipId` could only ever hold `ship-1`, and ships 2,
   * 3 and 4 were drawn, catalogued, earnable and unwearable. A child could play
   * the whole route, earn three hulls and fly the same ship forever.
   *
   * ================== WHY HERE, AND NOT A NEW SCREEN ==================
   * This screen is already called "ship controls" and already reads as the
   * inside of the Lantern (UR-11). It is reached from the Director map AND from
   * Pause (`goBack` sends Esc back to whichever it was), so ONE row lands the
   * surface on both routes with one build and one set of assertions. A separate
   * hangar screen would need a row in the design brief's screen inventory, its
   * own Esc path, its own focus order and its own e2e - and `trace-check`
   * enforces the inventory in both directions, so it is not a small change.
   *
   * ================== WHAT IT COSTS, STATED ==================
   * Equipping from Pause does NOT repaint the ship mid-belt. `FlightScene`
   * resolves its hull in `create()`, so a hull chosen over a frozen belt is
   * flown from the next stage. That is the safe direction: the alternative is
   * swapping the livery of a rig that is mid-tween, and a half-repainted ship
   * during a run is worse than a reward that lands at the next launch.
   */
  private hullRow(x: number, y: number, width: number): HullRow {
    const profile = this.app.profile();
    const slots = hullSlots(profile);
    const choices: readonly HullChoice[] = slots.map((slot) => ({
      id: slot.ship.id,
      label: this.t.t(slot.ship.nameKey),
      locked: slot.locked,
      // Locked hulls SAY WHAT UNLOCKS THEM, in the same sentence the create
      // screen prints under the same tile (D73/D79) - the string and the number
      // both come from the catalogue, so the two screens cannot drift.
      detail: slot.locked
        ? this.t.t(slot.ship.unlockKey, { n: slot.ship.unlockBeacons })
        : this.t.t(slot.equipped ? "ui.settings.hullFlying" : "ui.settings.hullEquip"),
      // THE COLOURWAY THIS HULL IS ACTUALLY WEARING, skin included - the same
      // `liveryForShip` the flying ship resolves through. `slot.ship.colors`
      // would be the BASE look, so a pilot who earned the frost trim would be
      // offered a swatch that is not the ship they get, which is the equip
      // surface lying about its own reward. The create screen shows base and
      // skin as separate tiles because it has eight of them; this row has four.
      colors: liveryForShip(slot.ship.id, profile?.unlockedSkins ?? []),
    }));
    return new HullRow(this, this.uiStyle, "settings.hull", x, y, this.depth, {
      label: this.t.t("ui.settings.hull"),
      width,
      value: slots[equippedIndex(slots)]?.ship.id ?? "",
      choices,
      // Rebuild, because every hull's line changed: the one just equipped now
      // says "flying now" and the one that used to is back to offering itself.
      // `applyAndRestart`'s idiom - a SCENE restart, never a page reload - with
      // the focus restored to this row, so the child is still on the ship they
      // just chose and can see it is being flown.
      onEquip: (id) => {
        this.app.equipShip(id);
        this.scene.restart({ returnTo: this.returnTo, focus: "settings.hull" });
      },
    });
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

  /**
   * The console panel a column of controls is screwed to.
   *
   * Drawn BEHIND the controls, at `depth - 1`, and sized from the measured
   * stack rather than from a constant: every row on this screen is taller than
   * the flat row it replaced, and a fixed panel height would have ended
   * halfway through a knob.
   *
   * The row of indicator pips the old plate carried is gone. It was decorative,
   * and on a panel that now reads as real hardware a row of lights that means
   * nothing is a row of lights a child will try to interpret - which is the one
   * thing a console in a game for seven-year-olds must not do.
   */
  private consoleFace(x: number, stackBottom: number, w: number): void {
    const b = SETTINGS_CONSOLE.bezel;
    const g = this.add.graphics().setDepth(this.depth - 1);
    drawConsoleFace(g, {
      x: x - b,
      y: SETTINGS_CONSOLE.top - b,
      w: w + b * 2,
      h: stackBottom - SETTINGS_CONSOLE.top + b * 2,
    });
  }

  /**
   * Flow one column of already-built controls and return where it ends.
   *
   * The gap is chosen by `fitPlan`, which tightens the white space - and only
   * the white space, never the type - until the stack plus the console's bezel
   * clears the keyboard hint at the foot of the screen. `tail` is laid out
   * after a wider gap, which is how the reset key is set apart from the
   * switches without a hard-coded offset that a taller row would swallow.
   */
  private layoutColumn(
    controls: readonly Control[],
    x: number,
    tail: readonly Control[] = [],
    tailGap = 0,
  ): number {
    const heights = controls.map((c) => c.ringBounds().h);
    const tailHeights = tail.map((c) => c.ringBounds().h);
    const plan = fitPlan([...heights, ...tailHeights], {
      ...SETTINGS_CONSOLE,
      bottom: SETTINGS_CONSOLE.bottom - tailGap,
    });
    const rects = flowColumn(heights, {
      left: x,
      top: SETTINGS_CONSOLE.top,
      width: 0,
      rowGap: plan.rowGap,
    });
    controls.forEach((c, i) => c.node.setPosition(x, rects[i]?.y ?? 0));
    if (tail.length === 0) return bottomOf(rects);

    const tailRects = flowColumn(tailHeights, {
      left: x,
      top: bottomOf(rects) + tailGap,
      width: 0,
      rowGap: plan.rowGap,
    });
    tail.forEach((c, i) => c.node.setPosition(x, tailRects[i]?.y ?? 0));
    return bottomOf(tailRects);
  }

  private langChoices(langs: readonly Lang[]): SelectorChoice<Lang>[] {
    return langs.map((lang) => ({
      value: lang,
      label: this.t.t(`ui.settings.lang.${lang}` as MenuKey),
    }));
  }

  /**
   * Push volumes at what is actually making sound.
   *
   * `boot.ts` now publishes the LIVE audio service on `kb.audio`, so the two
   * sliders move the real music and SFX bus gains and the change is audible
   * before the key is released - which is the half of AC-19.1 a storage
   * assertion cannot prove.
   *
   * It goes through `setVolumes` rather than writing the gain nodes directly
   * because the music bus is a sidechain target: a raw write would be undone by
   * the next voice line's release ramp, and the child's choice would silently
   * revert the moment Shadow finished a sentence.
   *
   * `this.sound.volume` stays as well. Phaser's own sound manager plays nothing
   * in this game today, but it is the level any future Phaser-side sound would
   * use, and a screen that sets one of two mixers is a bug waiting for the
   * first `this.sound.play`. Null is a supported answer: a scene opened
   * standalone by the e2e harness has no boot and so no audio.
   */
  private pushVolumes(): void {
    const s = this.app.settings();
    this.sound.volume = s.sfxVolume;
    audioFrom(this.registry)?.setVolumes({ music: s.musicVolume, sfx: s.sfxVolume });
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
      // The hull actually WORN, read back off the profile rather than echoed
      // from the row: a row reporting its own argument would say "ship-4" for a
      // press `@engine/unlocks.equipShip` refused.
      shipId: this.app.profile()?.shipId ?? null,
      contentLangChoices: availableContentLangs(s.inputMethod),
    };
  }
}
