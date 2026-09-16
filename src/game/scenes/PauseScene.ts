import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { MenuScene } from "@game/ui/MenuScene";
import { type Control, MenuButton } from "@game/ui/controls";
import { plate, strokePlate } from "@game/ui/chrome";
import { SHADOW_HEIGHT, drawShadow } from "@game/render/shadow";
import { hexToNum } from "@game/render/palette";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";

/**
 * SCREEN 13 - PAUSE (design brief 13: "Esc during flight: asteroids freeze, dim
 * overlay, Resume / Settings / Quit to map. Quit asks once.").
 *
 * IT IS AN OVERLAY, NOT A SCREEN. It is launched over the flight scene and
 * PAUSES it rather than stopping it: `scene.pause` stops the update loop, so
 * the asteroids stop where they are, the world keeps its exact state, and
 * resuming drops the player back into the same frame rather than restarting the
 * belt. A pause that restarted the stage would be a punishment for pressing
 * Esc, which is the one thing this game never does (D31).
 *
 * THE CONFIRM IS DRAWN IN THE GAME. No `window.confirm` anywhere: a browser
 * dialog takes the keyboard away from the canvas, cannot be translated, and
 * cannot be drawn without the browser's own alert styling. `ConfirmDialog`
 * handles it in-scene, with the safe answer focused.
 *
 * WIRING. The flight lane opens this with `PauseScene.openFrom(flightScene)`.
 * If it is started on its own - a direct `?scene=Pause`, or before the flight
 * lane lands - it still works: there is simply nothing underneath to freeze.
 */
export class PauseScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.pause;

  /** The scene underneath, paused while this is up. */
  private from: string = SCENE_KEYS.flight;
  private frozen = false;
  /**
   * The overlay is opened BY a key and then closed by the same key, so the very
   * event that opened it must not also reach the menu. Nothing is accepted
   * until this scene has been stepped once; that is at most one frame, and it
   * is the difference between Esc opening the pause menu and Esc appearing to
   * do nothing at all.
   */
  private armed = false;

  constructor() {
    super({ key: SCENE_KEYS.pause });
  }

  /**
   * What the flight lane calls on Esc. One line, no knowledge of this class.
   *
   * Guarded, because Flight is also booted standalone by its own perf harness,
   * where only Flight itself is registered. An unregistered key would make
   * Phaser log a warning every time a child pressed Esc; here it is simply a
   * belt with no pause menu, which is what that harness is.
   */
  static openFrom(scene: Phaser.Scene): void {
    if (scene.scene.get(SCENE_KEYS.pause) === null) return;
    scene.scene.launch(SCENE_KEYS.pause, { from: scene.scene.key });
  }

  init(data?: { from?: string }): void {
    if (data?.from) this.from = data.from;
  }

  /** An overlay draws no sky: the frozen belt has to stay visible behind it. */
  protected override get wantsBackdrop(): boolean {
    return false;
  }

  protected build(): void {
    this.freezeBelow();

    // The dim overlay. Dark enough that the menu reads, light enough that the
    // player can still see where their ship was - it is a pause, not an exit.
    this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, hexToNum(INK.bgDeep), 0.66)
      .setOrigin(0, 0)
      .setDepth(this.depth - 1);

    const panelW = 720;
    const panelH = 560;
    const px = Math.round((GAME_WIDTH - panelW) / 2);
    const py = Math.round((GAME_HEIGHT - panelH) / 2);
    const g = this.add.graphics().setDepth(this.depth - 1);
    plate(g, px, py, panelW, panelH, hexToNum(INK.panel), 0.95, 26);
    strokePlate(g, px, py, panelW, panelH, hexToNum(INK.line), 2, 26);

    const heading = this.t.t("ui.pause.heading");
    this.setHeadingText(heading);
    const title = uiText(this, px + SPACE.gutter, py + 56, heading, {
      size: TYPE.heading,
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      wrapWidth: panelW - SPACE.gutter * 2,
    });
    title.setDepth(this.depth);

    this.shadows.push(
      // Inside the panel, so he sits ON the plate rather than under it.
      drawShadow(this, px + panelW - 110, py + 96, "idle", {
        scale: 120 / SHADOW_HEIGHT,
        reducedMotion: this.reducedMotion,
        facing: -1,
        depth: this.depth,
      }),
    );

    const rowW = panelW - SPACE.gutter * 2;
    let y = py + 180;
    const controls: Control[] = [];
    const add = (id: string, label: string, onPress: () => void): void => {
      const b = new MenuButton(this, this.uiStyle, id, px + SPACE.gutter, y, this.depth, {
        label,
        minWidth: rowW,
        onPress,
      });
      controls.push(b);
      y += b.ringBounds().h + SPACE.gap;
    };

    add("pause.resume", this.t.t("ui.pause.resume"), () => this.resumeFlight());
    add("pause.settings", this.t.t("title.settings"), () => this.openSettings());
    add("pause.quit", this.t.t("ui.pause.quit"), () => this.askQuit());

    this.setControls(controls);
  }

  /**
   * Freeze what is underneath. `pause` halts the scene's update loop, which is
   * what makes the asteroids stop; it leaves the display list intact, so the
   * belt is still drawn behind the overlay.
   */
  private freezeBelow(): void {
    const below = this.scene.get(this.from);
    if (below === null || below === this) return;
    if (this.scene.isActive(this.from)) {
      this.scene.pause(this.from);
      this.frozen = true;
    }
  }

  private resumeFlight(): void {
    if (this.frozen) {
      this.scene.resume(this.from);
      this.frozen = false;
      this.scene.stop();
      return;
    }
    // Nothing to go back to (opened standalone): fall back to the map, so Esc
    // is never a dead end (AC-18.1).
    this.scene.stop();
    this.goTo(SCENE_KEYS.map);
  }

  /**
   * Settings opens OVER the pause, and the pause sleeps rather than stopping,
   * so coming back lands on the same frozen frame. SettingsScene reads
   * `returnTo` and wakes this scene on Esc.
   */
  private openSettings(): void {
    if (this.scene.get(SCENE_KEYS.settings) === null) return;
    // Launch BEFORE sleeping: a sleeping scene's ScenePlugin no longer runs its
    // queued operations, so sleeping first swallows the launch.
    this.scene.launch(SCENE_KEYS.settings, { returnTo: SCENE_KEYS.pause });
    this.scene.sleep();
  }

  /**
   * "Quit asks once." Exactly once - not a confirm on the confirm - and in
   * plain words about what happens to the belt, with "keep flying" focused.
   */
  private askQuit(): void {
    this.openConfirm({
      message: this.t.t("ui.pause.quitAsk"),
      confirmLabel: this.t.t("ui.pause.quitYes"),
      cancelLabel: this.t.t("ui.pause.quitNo"),
      onConfirm: () => this.quitToMap(),
    });
  }

  private quitToMap(): void {
    // Whatever the belt was doing is over; stop it rather than leaving a paused
    // scene holding its state behind the map.
    if (this.scene.get(this.from) !== null && this.from !== this.scene.key) {
      this.scene.stop(this.from);
    }
    this.frozen = false;
    this.scene.stop();
    this.goTo(SCENE_KEYS.map);
  }

  override update(time: number, delta: number): void {
    super.update(time, delta);
    this.armed = true;
  }

  /** Swallow everything until the opening keystroke has certainly passed. */
  protected override extraKey(_event: KeyboardEvent): boolean {
    return !this.armed;
  }

  /** Esc on the pause menu is Resume: the least surprising thing it can be. */
  protected goBack(): void {
    this.resumeFlight();
  }

  override snapshot(): Record<string, unknown> {
    return {
      ...super.snapshot(),
      from: this.from,
      frozen: this.frozen,
      belowPaused: this.scene.isPaused(this.from),
    };
  }
}
