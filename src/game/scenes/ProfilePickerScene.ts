import { GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { isStopId } from "@engine/types";
import type { Profile } from "@engine/types";
import { CONTENT_TOP, MenuScene } from "@game/ui/MenuScene";
import { type Control, ListRow, MenuButton } from "@game/ui/controls";
import { drawAvatar, drawBeacon } from "@game/ui/chrome";
import { SHADOW_HEIGHT, drawShadow } from "@game/render/shadow";
import { furthestBeacon, liveryFor } from "@game/ui/catalog";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";
import type { MenuKey } from "@game/ui/i18n";

/** The avatar disc on a pilot row. */
const GLYPH_PX = 84;
/** Room reserved at a row's right edge for the lit-beacon mark. */
const BEACON_ROOM_PX = 112;

/**
 * SCREEN 1b - PROFILE PICKER (design brief screen inventory row "Profile
 * picker": 1 profile / several / none).
 *
 * "A list of existing pilots with furthest beacon; 'New pilot' leads to screen
 * 2." It should feel like walking into a hangar and picking who is flying,
 * which is why each row carries the pilot's own mark, their ship's livery and
 * the beacon they got furthest to (D13) rather than a row of form fields.
 *
 * D43: a profile is a name and a mark. THERE IS NO EMAIL FIELD, here or on the
 * create screen, or anywhere else in the game (AC-18.2) - and there is nowhere
 * for one to go, because the only text entry in the whole menu system is the
 * name field on screen 2.
 */
export class ProfilePickerScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.profilePicker;

  private rows: Control[] = [];
  private profileIds: string[] = [];

  constructor() {
    super({ key: SCENE_KEYS.profilePicker });
  }

  protected build(): void {
    this.addHeading("profile.heading");
    const profiles = this.app.services.store.profiles;

    if (profiles.length === 0) {
      this.buildEmpty();
    } else {
      this.buildList(profiles);
    }

    // THE HINT SITS ON THE BOTTOM LINE (UR-84).
    //
    // A second faint line used to hang under it naming the remove shortcut. It
    // was the least readable thing on the screen - measured at 2.82:1 against
    // the backdrop, under AC-22.8's 4.5:1 - and it explained a destructive
    // action to a child in the copy they were least likely to be able to read.
    // The shortcut itself is untouched; what is gone is the line about it.
    //
    // IT SITS ON `HINT_TOP` LIKE EVERY OTHER SCREEN'S, and no longer on
    // `scale.height - 44`. That override was this screen taking the removed
    // line's y so the page "ended where it used to", and it is what the owner
    // measured: the picker's hint at y 1036 against every sibling's 1004, the
    // largest of the three positions one line was being drawn at. The screen
    // ending 32 px higher is the correct outcome; a line is gone.
    this.addHint();
  }

  /**
   * The "none" variant. An empty hangar is a beginning, not an error: Shadow is
   * there, the line is an invitation, and the only control is the one that
   * starts a pilot.
   */
  private buildEmpty(): void {
    // `drawShadow` sizes by SCALE, not by pixels: SHADOW_HEIGHT is his drawn
    // height at scale 1, so a wanted height divides through it. Keeping the
    // arithmetic at the call site is deliberate - a helper that took a pixel
    // height is how the second Shadow implementation started.
    this.shadows.push(
      drawShadow(this, GAME_WIDTH * 0.72, 520, "idle", {
        scale: 260 / SHADOW_HEIGHT,
        reducedMotion: this.reducedMotion,
        facing: -1,
        depth: this.depth - 2,
      }),
    );
    uiText(this, SPACE.gutter, 300, this.t.t("ui.pick.none"), {
      size: TYPE.heading,
      color: INK.textDim,
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      wrapWidth: GAME_WIDTH * 0.52,
    }).setDepth(this.depth);

    const create = new MenuButton(
      this,
      this.uiStyle,
      "pick.new",
      SPACE.gutter,
      460,
      this.depth,
      {
        label: this.t.t("ui.pick.newPilot"),
        minWidth: 320,
        size: TYPE.heading,
        onPress: () => this.goTo(SCENE_KEYS.profileCreate),
      },
    );
    this.rows = [create];
    this.setControls(this.rows);
  }

  /**
   * How wide the list has to be to hold its own words, and no wider (UR-82).
   *
   * The rows were a flat 1180 px - the screen's whole column - for content that
   * is a name and four words of detail. A list whose rows are three times the
   * length of anything in them reads as an empty table, and the focus ring is
   * then a 1180 px rectangle drawn around a word.
   *
   * MEASURED, NOT ESTIMATED. The strings are a child's own pilot name in
   * whatever language the menu is in, so the only honest width is what the same
   * `uiText` call that draws them reports. The probes are destroyed before
   * anything is built; `TYPE.body` and `TYPE.caption` here are the two sizes
   * `ListRow` uses for a title and a detail, and `GLYPH` is its avatar.
   */
  private naturalRowWidth(labels: readonly string[], details: readonly string[]): number {
    const measure = (text: string, size: number): number => {
      const probe = uiText(this, -4000, -4000, text, {
        size,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      });
      const w = probe.width;
      probe.destroy();
      return w;
    };
    let widest = 0;
    for (const t of labels) widest = Math.max(widest, measure(t, TYPE.body));
    for (const t of details) widest = Math.max(widest, measure(t, TYPE.caption));
    const textLeft = SPACE.rowPadX + GLYPH_PX + SPACE.gap;
    return Math.ceil(textLeft + widest + SPACE.rowPadX);
  }

  private buildList(profiles: readonly Profile[]): void {
    const detailOf = (profile: Profile): string => {
      const stop = furthestBeacon(profile);
      return stop === null
        ? this.t.t("ui.pick.noBeacons")
        : this.t.t("ui.pick.furthest", { stop: this.t.t(`ui.stop.${stop}` as MenuKey) });
    };
    const newPilotLabel = this.t.t("ui.pick.newPilot");
    // THE BEACON NEEDS ITS OWN ROOM. It is drawn at the row's right edge, so on
    // a row sized to its text it would land on the words. Only paid for when a
    // profile actually has one.
    const anyBeacon = profiles.some((p) => furthestBeacon(p) !== null);
    const width = Math.min(
      GAME_WIDTH - SPACE.gutter * 2,
      this.naturalRowWidth(
        [...profiles.map((p) => p.name), newPilotLabel],
        profiles.map(detailOf),
      ) + (anyBeacon ? BEACON_ROOM_PX : 0),
    );
    // Shadow stands beside the list, not in it. The "several" variant is the
    // busiest this screen gets, so he moves out of the column.
    this.shadows.push(
      drawShadow(this, GAME_WIDTH - 260, 620, "pointing", {
        scale: 220 / SHADOW_HEIGHT,
        reducedMotion: this.reducedMotion,
        // He points back at the list, which is to his left.
        facing: -1,
        depth: this.depth - 2,
      }),
    );

    const controls: Control[] = [];
    this.profileIds = [];
    let y = CONTENT_TOP;

    // NEW PILOT IS THE FIRST ROW, NOT THE LAST (UR-82).
    //
    // It was under the list, which reads as an afterthought and puts the one
    // action a first-time visitor needs at the bottom of a column of things
    // that are not theirs. It is also the only row whose meaning does not
    // depend on reading the ones above it.
    //
    // SAME WIDTH AS THE ROWS, so the column has one right edge as well as one
    // left one - a button two thirds the width of the list above it is the
    // ragged edge this project has spent the night removing.
    const create = new MenuButton(
      this,
      this.uiStyle,
      "pick.new",
      SPACE.gutter,
      y,
      this.depth,
      {
        label: newPilotLabel,
        minWidth: width,
        onPress: () => this.goTo(SCENE_KEYS.profileCreate),
      },
    );
    controls.push(create);
    y += create.ringBounds().h + SPACE.gap;

    for (const profile of profiles) {
      const livery = liveryFor(profile);
      const stop = furthestBeacon(profile);
      const detail = detailOf(profile);

      const row = new ListRow(
        this,
        this.uiStyle,
        `pick.profile.${profile.id}`,
        SPACE.gutter,
        y,
        this.depth,
        {
          label: profile.name,
          detail,
          width,
          role: "listitem",
          glyphSize: GLYPH_PX,
          glyph: (scene, gx, gy) =>
            drawAvatar(scene, gx, gy, 84, profile.avatar, livery.stripe),
          onPress: () => this.fly(profile.id),
        },
      );
      controls.push(row);
      this.profileIds.push(profile.id);

      // The furthest beacon is drawn as a beacon, lit, at the right edge: the
      // row says "you got this far" in the game's own object, not in a number.
      if (stop !== null && isStopId(stop)) {
        const beacon = drawBeacon(
          this,
          SPACE.gutter + width - BEACON_ROOM_PX + 20,
          y + row.ringBounds().h / 2,
          72,
          this.app.palette(stop).accent,
          true,
          this.reducedMotion,
        );
        beacon.setDepth(this.depth + 1);
      }

      y += row.ringBounds().h + SPACE.gap;
    }

    this.rows = controls;
    this.setControls(controls);

    // Open on the pilot who last flew, so the common case is one key press.
    const active = this.app.profile();
    if (active) this.list.focus(`pick.profile.${active.id}`);
  }

  private fly(id: string): void {
    this.app.services.store.selectProfile(id);
    this.app.services.context.profileId = id;
    this.app.services.store.flush();
    this.goTo(SCENE_KEYS.map);
  }

  /**
   * Delete or Backspace on a pilot asks to remove them. Keyboard-only means a
   * destructive action needs a key, and it needs the same "ask once, in plain
   * words, with no red" treatment as everything else (design brief 13).
   */
  protected override extraKey(event: KeyboardEvent): boolean {
    if (event.key !== "Delete" && event.key !== "Backspace") return false;
    const focusId = this.list.focusId;
    if (focusId === null || !focusId.startsWith("pick.profile.")) return false;
    const id = focusId.slice("pick.profile.".length);
    const profile = this.app.services.store.getProfile(id);
    if (!profile) return false;

    this.openConfirm({
      message: this.t.t("ui.pick.removeAsk", { name: profile.name }),
      confirmLabel: this.t.t("ui.pick.removeYes"),
      cancelLabel: this.t.t("ui.pick.removeNo"),
      onConfirm: () => {
        this.app.services.store.deleteProfile(id);
        this.app.services.store.flush();
        this.scene.restart();
      },
    });
    return true;
  }

  /**
   * Esc returns to the Title. The picker is reached from there, and AC-18.1
   * requires every screen to be RETURNABLE by keyboard, not just reachable.
   */
  protected goBack(): void {
    this.goTo(SCENE_KEYS.title);
  }

  /** Extra facts the e2e asserts on top of the DOM mirror. */
  override snapshot(): Record<string, unknown> {
    return {
      ...super.snapshot(),
      profileCount: this.profileIds.length,
      profileIds: [...this.profileIds],
      rowCount: this.rows.length,
    };
  }
}
