import { SCENE_KEYS } from "@game/sceneKeys";
import { SHIPPED_LANGS, resolveContentLang } from "@engine/i18n";
import { type KeyboardLayout, type Lang, type Settings } from "@engine/types";
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
import { AVATARS, liveryForShip } from "@game/ui/catalog";
import { DASH_COLORS, dashHexOf } from "@game/ui/dash";
import { drawAvatar, drawDashSwatch } from "@game/ui/chrome";
import { equippedIndex, hullSlots } from "@game/ui/hulls";
import { contentWidth, pageInset } from "@game/ui/grid";
import { type ConsoleColumn, consoleColumns } from "@game/ui/controlSurfaceLayout";
import { SETTINGS_CONSOLE, bottomOf, fitPlan, flowColumn } from "@game/ui/layout";
import { INK, TYPE } from "@game/ui/theme";
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
 * AC-14.1: THE ROW IS GONE AND THE RULE IS NOT. The content-language and
 * input-method rows were removed from this screen because neither could change
 * anything a child can see - see the long note in `build`, and collision C14.
 * What AC-14.1 actually asserts survives in two better places: the input-method
 * RULE is exercised over all three languages by
 * `tests/unit/i18n/shippedLangs.test.ts` through `typeableContentLangs`, and
 * the stored-PAIR repair still runs on this screen, in `repairLanguagePair`,
 * because a profile can still carry a pair the engine can produce.
 *
 * UR-123 / UR-124: this screen is dressed in the pilot's own DASH COLOUR rather
 * than Earth's palette, and the pilot's MARK can be changed here rather than
 * only at profile creation. Both write to the profile and both are read back by
 * something that draws them - see `dashRow` and `avatarRow`.
 *
 * AC-22b.1 / D31: reset progress is the most destructive thing in the game and
 * it is drawn in exactly the same ink as everything else. No red, no warning
 * triangle, no shouting - it asks twice, in plain words, and the safe answer
 * has focus both times.
 */
/**
 * The two marks this screen draws in a selector's glyph bay.
 *
 * Both are well under `HULL_GLYPH` (72), which `cockpit.test.ts` measures as
 * the thing the right-hand column can least afford to grow: a mark that made a
 * row taller than the hull bay would push the reset key through the hint line
 * in Devanagari, and the frame has ~29 px of margin there.
 */
const DASH_SWATCH = 48;
const AVATAR_GLYPH = 52;

/**
 * Whether the flight deck shows the hull picker (UR-132).
 *
 * `false` on the owner's instruction. Everything behind it is intact - see the
 * note at its one call site for why it is a flag and not a deletion.
 */
const SHOW_HULL_ROW = false;

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

  /**
   * THIS SCREEN'S ACCENT IS THE PILOT'S DASH COLOUR (UR-123).
   *
   * Not Earth's, which is what every menu wears and what the owner reported as
   * this screen having no identity of its own. See `MenuScene.accentOverride`
   * for why it is a hook rather than a ninth palette entry, and `ui/dash.ts`
   * for why the colour is the player's rather than a constant.
   *
   * It is read on EVERY build, including the `scene.restart` that
   * `applyAndRestart` runs, so turning the dash-colour row repaints the panel
   * under the child's hands - which is the "takes effect without a reload" half
   * of AC-19.1 for a value that changes how the screen is drawn.
   */
  protected override accentOverride(): string {
    return dashHexOf(this.app.settings().dashColor);
  }

  /**
   * ============ WHERE THIS SCREEN'S GEOMETRY COMES FROM (UR-121, UR-122) =====
   *
   * ================== WHAT IT WAS, AND WHY IT WAS WRONG ==================
   * Three lines of arithmetic here:
   *   `colW = min(820, (GAME_WIDTH - gutter * 3) / 2)`, `leftX = gutter`,
   *   `rightX = gutter * 2 + colW`
   * - the CONTROLS decided first and the console face derived from them by
   * subtracting a bezel. Measured on the served build at 1920, that put the
   * left face's ink at x=69 against a page padding of 96 and the right face's
   * at 1850 against a content right edge of 1824: BOTH panels outside the
   * margin, in opposite directions. That is the owner's report exactly, and the
   * second half of the report - "why isn't there one page-level padding rather
   * than each item being moved by hand" - is what those three lines are.
   *
   * ================== WHAT IT IS NOW ==================
   * `controlSurfaceLayout.consoleColumns(2)`, and the direction is reversed:
   * the FACES are laid out on `grid.pageBox()` and the CONTROLS are inset from
   * the faces. Neither number is this screen's any more, which is the point - a
   * panel cannot miss the margin when the margin is what it measures from, and
   * a row cannot reach the bolts when the console says how much of its own edge
   * is spoken for (`consoleContentInset()`, 48).
   *
   * The fix is deliberately NOT "nudge the panel 26 px right". A nudge is the
   * defect the report is about, and it would have taught the next screen
   * nothing.
   */
  protected build(): void {
    this.addHeading("ui.settings.heading");
    this.repairLanguagePair();
    const s = this.app.settings();
    const [leftCol, rightCol] = consoleColumns(2) as [ConsoleColumn, ConsoleColumn];
    const colW = leftCol.colW;
    const leftX = leftCol.controlX;
    const rightX = rightCol.controlX;

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
        icon: "music",
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
        icon: "sound",
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
        icon: "keyboard",
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
    /**
     * UR-185: HIDDEN WHILE ONE LANGUAGE SHIPS.
     *
     * `SHIPPED_LANGS` is `["en"]` (D95), so this drew a selector with one
     * choice - arrows that move nothing and a single dot. Kept rather than
     * deleted: it comes back the moment the list grows, and the row below is
     * the same shape for the same reason.
     */
    if (SHIPPED_LANGS.length > 1) {
      left.push(
        new SelectorRow<Lang>(this, this.uiStyle, "settings.uiLang", leftX, y, this.depth, {
          label: this.t.t("settings.uiLang"),
          icon: "language",
          width: colW,
          value: s.uiLang,
          // D95: only languages the build actually ships.
          choices: this.langChoices(SHIPPED_LANGS),
          onChange: (v) => this.applyAndRestart({ uiLang: v }),
        }),
      );
    }

    // ================== TWO ROWS THAT USED TO BE HERE, AND ARE NOT =========
    //
    // `settings.inputMethod` ("How You Type Hindi") and `settings.contentLang`
    // ("Typing Language") are GONE FROM THE SCREEN, and the persisted fields
    // are deliberately UNTOUCHED - `Settings.inputMethod` and
    // `Settings.contentLang` still exist, still decode, still migrate, and
    // `repairLanguagePair` below still repairs the pair on the way in. Only the
    // two CONTROLS are removed.
    //
    // WHY: neither could change anything a child can see. Measured against this
    // tree rather than taken from the report -
    //
    //   contentLang  `FlightScene` reads `cfg.contentLang`, but neither route
    //                into the belt carries it: `PreflightScene.complete` and
    //                `ResultsScene.replay` hand over `{ctx, progress, shipName,
    //                lang, stopId}`, and `lang` is not a `FlightConfig` key, so
    //                `flightConfigFrom` falls back to the default on every real
    //                launch. This is collision C14, logged before this lane.
    //   inputMethod  the same break, one field over. `FlightScene` builds
    //                `createWordMatcher(this.cfg.inputMethod)` and the lock
    //                DOES consume it now (`LockOptions.matcher` is live, so the
    //                "open seam" note beside that call is stale) - but
    //                `cfg.inputMethod` is `DEFAULT_SETTINGS.inputMethod` on
    //                every real launch for the identical reason. A reader fed a
    //                constant is not a reader of the setting.
    //
    // So both rows wrote a value that reached the save and nothing else. The
    // input-method row is additionally a control for typing a language D95 cut
    // from the shipped menu: turning it offered a child a Devanagari keyboard
    // for content the build does not load.
    //
    // AC-14.1's "pick a Hindi keyboard" note goes with them, and that is a
    // strict improvement: after D95 it fired for every player on every input
    // method, telling a child to change a keyboard to unlock a language the
    // build does not ship. It was already unactionable; now it is absent.
    //
    // WHAT THIS DOES NOT DO: it does not close C14. The promise D45 and FR-14
    // make is still unkept and the translated content still ships unreachable.
    // Removing a control that cannot act on a broken pipeline does not repair
    // the pipeline, and a future lane that widens the content globs and threads
    // `contentLang` into `FlightConfig` puts this row back with one call.

    left.push(this.dashRow(leftX, y, colW, s));
    left.push(this.avatarRow(leftX, y, colW));

    // --- flight deck -------------------------------------------------------

    /**
     * ================== THE HULL ROW IS HIDDEN (UR-132) ==================
     * The owner asked for this feature to be hidden for now.
     *
     * HIDDEN, NOT DELETED, and the distinction is load-bearing. `HullRow` is
     * the only input in the shipped game that can EQUIP an earned hull -
     * `ResultsScene` calls `applyUnlocks` at every stage end and `SHIP_UNLOCKS`
     * opens ship-2/3/4 at 3/5/7 beacons - so deleting it would re-create the
     * defect it was built for (rule 2: a field chosen, earned, persisted and
     * reaching nothing). The row, its builder and its tests all stay; one flag
     * decides whether the screen shows it, and flipping it back is one line.
     *
     * Unlocks keep accruing while it is hidden, so a pilot who comes back to a
     * restored row finds the hulls they earned already waiting.
     */
    if (SHOW_HULL_ROW) right.push(this.hullRow(rightX, y, colW));

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
        icon: "letterCase",
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
        icon: "spacing",
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
        icon: "motion",
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
        icon: "palette",
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
        // NO MARK ON THIS ONE (UR-138). `PanelButton` is a KEY - centred
        // text on a keycap, not a labelled row with a hardware column - so
        // it has no left gutter for a mark to sit in. Giving it one would
        // mean a second layout for a single control.
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

    this.consoleFace(leftCol.faceX, leftBottom, leftCol.faceW);
    this.consoleFace(rightCol.faceX, rightBottom, rightCol.faceW);

    this.addHint("ui.common.hintAdjust");
    // The id goes IN, so the list never paints at index 0 first. Restoring
    // afterwards left one frame of the ring on the music row (UR-73).
    this.setControls([...left, ...right, resetKey], this.restoreFocus ?? undefined);
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
   * THE DASH COLOUR (UR-123; D41, AC-18.1, AC-19.1, AC-22.8).
   *
   * ================== WHAT IT REPLACED, AND WHAT IT DID NOT ==============
   * This lane was asked to replace the hull row with this one, on the premise
   * that no hull other than `ship-1` is reachable because
   * `createFlow.ENABLED_CREATE_STEPS` is `["pilot"]`. THAT PREMISE DOES NOT
   * HOLD, and it was checked rather than taken: the create-time ship beat is
   * indeed off, but hulls are not granted there. `ResultsScene` calls
   * `@engine/unlocks.applyUnlocks` on the live profile at the end of every
   * stage, which adds `ship-2`/`ship-3`/`ship-4` to `profile.unlockedShips` at
   * 3 / 5 / 7 beacons, and `tests/unit/unlocks/equip.test.ts` already runs that
   * whole chain - grant, store, serialize, reload, equip. The hull row is the
   * ONLY input in the shipped game that can wear one.
   *
   * So the dash colour is ADDED and the hull row STAYS. Deleting a live reward
   * surface on a premise that measurement disproves is not the instruction's
   * intent - the instruction's reason was "do not ship a dead control", and the
   * hull row is not dead. The decision, the evidence and a lean are in
   * `gauntlet/escalations.md` under E-settings-hull (D94: escalate, then
   * continue with the documented behaviour, never block).
   *
   * ================== WHY IT IS NOT A DEAD CONTROL ITSELF =================
   * The bar this row had to clear is the one that removed two other rows from
   * this screen in the same change. Turning it does three visible things on the
   * frame it is turned: `accentOverride` makes it this screen's accent, so
   * every knob arc, detent lamp, chevron and value behind glass repaints in it;
   * `consoleFace` lights the console's cabin light and engraved seam with it;
   * and the swatch in this row's own glyph bay burns in it. It is persisted by
   * `applySettings` like every other row here, and `applyAndRestart` redraws
   * the screen under it without a reload (AC-19.1).
   */
  private dashRow(x: number, y: number, width: number, s: Settings): SelectorRow<string> {
    return new SelectorRow<string>(this, this.uiStyle, "settings.dashColor", x, y, this.depth, {
      label: this.t.t("ui.settings.dashColor"),
      icon: "dash",
      width,
      value: s.dashColor,
      choices: DASH_COLORS.map((c) => ({ value: c.id, label: this.t.t(c.nameKey) })),
      glyph: {
        size: DASH_SWATCH,
        draw: (scene, gx, gy, id) => drawDashSwatch(scene, gx, gy, DASH_SWATCH, dashHexOf(id)),
      },
      // A RESTART, not a bare write: this value decides how the whole panel is
      // drawn, so the screen has to be rebuilt under it. `applyAndRestart`
      // restores the focused row, so the child is still standing on the colour
      // they just chose and can keep turning.
      onChange: (v) => this.applyAndRestart({ dashColor: v }),
    });
  }

  /**
   * THE PILOT'S MARK (UR-124; D43, AC-18.1, AC-19.1).
   *
   * ================== THE DEFECT ==================
   * `profile.avatar` had ONE writer in the build - `ProfileCreateScene`, at the
   * moment the profile is made - and one reader, `ProfilePickerScene`, which
   * draws it on the pilot's card. A child picked their mark on the first screen
   * they ever saw, before they had played anything, and was that mark for the
   * life of the save. That is the hull defect one field over: a chosen thing
   * with no second input.
   *
   * ================== WHY HERE ==================
   * The same argument the hull row is here on, and it is stronger for this row:
   * Ship Controls is reached from the Director map AND from Pause, so one row
   * lands the surface on both routes, and `trace-check` enforces the screen
   * inventory in both directions so a new screen is not a small change. The
   * profile picker is the other candidate and is worse - it is the screen you
   * pass through to START, and putting an editor on it means a child changing
   * their mark has to leave the game to do it.
   *
   * ================== END TO END, AND ASSERTED AS SUCH ==================
   * The row writes through `app.setAvatar`, which is `store.updateProfile` plus
   * an immediate flush, and the value is read back by
   * `ProfilePickerScene`'s `drawAvatar(scene, gx, gy, 84, profile.avatar, ...)`.
   * `tests/unit/scenes/settingsAvatar.test.ts` runs that whole round trip
   * through a real store - write, serialize, second store, read back - rather
   * than asserting the in-memory value, because the in-memory half was never
   * the broken one.
   *
   * It does NOT restart the scene. Nothing about this screen's drawing depends
   * on the avatar except this row's own mark, and the row redraws itself.
   */
  private avatarRow(x: number, y: number, width: number): SelectorRow<string> {
    const worn = this.app.profile()?.avatar ?? AVATARS[0]?.id ?? "avatar-1";
    return new SelectorRow<string>(this, this.uiStyle, "settings.avatar", x, y, this.depth, {
      label: this.t.t("ui.settings.avatar"),
        icon: "mark",
      width,
      value: worn,
      choices: AVATARS.map((a) => ({ value: a.id, label: this.t.t(a.nameKey) })),
      glyph: {
        size: AVATAR_GLYPH,
        // The accent is the fallback ink only: `chrome.AVATAR_INK` gives each
        // mark its own colour, which is what the profile picker draws, so the
        // two screens show the same six marks in the same six inks.
        draw: (scene, gx, gy, id) =>
          drawAvatar(scene, gx, gy, AVATAR_GLYPH, id, this.uiStyle.accent),
      },
      onChange: (v) => {
        this.app.setAvatar(v);
        this.publish();
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
  private consoleFace(faceX: number, stackBottom: number, faceW: number): void {
    const b = SETTINGS_CONSOLE.bezel;
    const g = this.add.graphics().setDepth(this.depth - 1);
    // THE FACE'S X AND WIDTH ARE GIVEN, NOT DERIVED FROM A CONTROL (UR-121).
    // It used to take the COLUMN's x and subtract the bezel, which is how both
    // panels ended up outside the page padding - 69 on the left against a 96
    // margin, 1850 on the right against a 1824 content edge. The caller now
    // lays the faces out on the page box and the controls out inside them, so
    // this draws where it is told.
    //
    // The vertical bounds are still the stack plus the bezel: a panel that
    // ended at a constant would end halfway through a knob, which is what the
    // measured stack exists to prevent.
    drawConsoleFace(
      g,
      {
        x: faceX,
        y: SETTINGS_CONSOLE.top - b,
        w: faceW,
        h: stackBottom - SETTINGS_CONSOLE.top + b * 2,
      },
      // The cabin light on this dashboard burns in the pilot's colour (UR-123).
      // It is the same value `accentOverride` hands the control kit, so the
      // metal and the instruments cannot be lit by two different colours.
      this.uiStyle.accent,
    );
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
      // The page box, not `SPACE.gutter` plus arithmetic (UR-121). It was
      // `gutter` and `GAME_WIDTH - gutter * 2`, which is the same number by a
      // different route - and "the same number by a different route" is what
      // put the two console faces off the margin two methods up.
      pageInset(0),
      this.scale.height - 176,
      this.t.t("ui.settings.resetDone"),
      {
        size: TYPE.caption,
        color: INK.textDim,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
        wrapWidth: contentWidth(),
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
      // The MARK actually worn, read back off the profile rather than echoed
      // from the row - the same reason `shipId` is read back above. A row
      // reporting its own argument would say "avatar-4" for a write that never
      // reached the store, which is the half of AC-19.1 this lane is about.
      avatar: this.app.profile()?.avatar ?? null,
      // What this screen is DRESSED IN, so the accent is assertable rather than
      // describable (UR-123). It is the dash colour resolved to a hex, which is
      // what every instrument on the panel is actually drawn in.
      accent: this.uiStyle.accent,
      // `contentLangChoices` is gone with the row it described. The content
      // language itself is still in `settings` above, and is still repaired on
      // the way in - see `repairLanguagePair`.
    };
  }
}
