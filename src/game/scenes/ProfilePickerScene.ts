import { GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { isStopId } from "@engine/types";
import type { Profile } from "@engine/types";
import { CONTENT_TOP, MenuScene } from "@game/ui/MenuScene";
import { type Control, ListRow } from "@game/ui/controls";
import { beaconBox, drawAvatar, drawBeacon, drawNewPilotMark } from "@game/ui/chrome";
import { paintPlate } from "@game/ui/plate";
import {
  drawSpeechCard,
  speechCardHeight,
  speechCardWrapWidth,
} from "@game/ui/speechCard";
import { audioFrom } from "@game/audio/wiring";
import { SHADOW_HEIGHT, drawShadow } from "@game/render/shadow";
import {
  NEW_PILOT_ID,
  SHADOW_DRAWN_HEIGHT,
  initialFocusId,
  shadowBox,
  shadowOrigin,
} from "./support/pickerLayout";
import { furthestBeacon, liveryFor } from "@game/ui/catalog";
import { INK, SPACE, STEP, TYPE } from "@game/ui/theme";
import { HEADING_TOP } from "@game/ui/grid";
import { uiText } from "@game/ui/text";
import type { MenuKey } from "@game/ui/i18n";

/** Phaser's line box for a Text is about 1.25x the font size. */
const LINE_FACTOR = 1.25;

/**
 * The top of Shadow's greeting plate: one `STEP.pad` under the heading.
 *
 * `HEADING_TOP` plus the heading's own line box is where the page's title
 * stops, and `STEP.pad` is the gap the grid puts between two blocks.
 */
const GREETING_TOP = HEADING_TOP + Math.round(TYPE.display * LINE_FACTOR) + STEP.pad;

/** The avatar disc on a pilot row. */
const GLYPH_PX = 84;
/** Room reserved at a row's right edge for the lit-beacon mark. */
const BEACON_ROOM_PX = 112;

/**
 * The lit-beacon stamp in a row's top-right corner (UR-141).
 *
 * `size` is less than half what it was: at 72 px it was hardware, at 34 it is
 * a badge. `inset` is one `STEP.unit` from both edges, so it sits on the same
 * corner rhythm the back chip and the panel rivets use rather than on a pair
 * of numbers picked for this one row.
 */
// `inset` is `SPACE.rowPadX`, the same padding the row's avatar keeps on all
// four sides since UR-143, so the two marks on a row are inset alike.
const BEACON_CORNER = { size: 34, inset: SPACE.rowPadX } as const;

/**
 * Shadow's greeting plate on the empty hangar (UR-142).
 *
 * `speakerGap` is the drop from the "Shadow" caption to his line, and it is
 * `STEP.unit` for the same reason the briefing's masthead closes up to
 * `STEP.tight`: a speaker and what they said are one block, not two.
 */
const GREETING = {
  /**
   * EVERY NUMBER HERE IS A `STEP` (UR-144, UR-69).
   *
   * The first pass used 36 and 30, which are on no scale - they were picked to
   * look right next to a plate whose own height was also picked to look right.
   * The owner asked for correct padding and margins, and on this project that
   * means the declared scale rather than a better guess.
   *
   *   y      the heading's baseline plus one `pad`, so the plate hangs off the
   *          page's own header line instead of a literal 280
   *   padX   `STEP.inset`, the inset the briefing card uses for its spine
   *   padY   the same, so the box is padded equally on all four sides - the
   *          defect UR-143 just fixed on the pilot rows' avatar
   *   gap    `STEP.unit` between the speaker's name and what he said: they are
   *          one block, which is the briefing masthead's reasoning exactly
   *
   * `h` is DERIVED rather than declared: padding, the caption, the gap, and
   * room for two wrapped lines of `TYPE.body`. A fixed height is how a plate
   * comes to clip its own text in a language that runs longer (ES is +25%).
   */
  y: GREETING_TOP,
  // Padding and the speaker gap are `PLATE_RHYTHM.card`'s now (UR-147), so
  // this card cannot drift from the one on Earth activation.
  // Earth's `SPEECH_TAIL_GAP` and `SPEECH_W`, so this card behaves like his.
  tailGap: 20,
  maxW: 560,
} as const;

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

  /** True when this entry came from removing a pilot, not from navigating in. */
  private silent = false;

  init(data?: { readonly silent?: boolean }): void {
    this.silent = data?.silent === true;
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
    //
    // UR-146: AND IT NOW NAMES THE REMOVE SHORTCUT AGAIN - ON THIS LINE.
    //
    // The owner could not remove a pilot and assumed the feature was missing.
    // `extraKey` below has taken Delete/Backspace since the screen landed and
    // nothing on it said so; this screen renders no Remove button either, so a
    // destructive keyboard-only action had no affordance at all.
    //
    // Both of UR-84's reasons for deleting the old second line are answered by
    // putting it HERE instead of bringing that line back: `drawHint` plates the
    // one hint line on `SKY_PLATE` in `INK.textDim`, which is the treatment
    // that clears AC-22.8's 4.5:1 (the old line measured 2.82:1), and there is
    // still exactly one line on the screen. See `ui/strings.ts`, `ui.pick.hint`.
    //
    // THE EMPTY HANGAR KEEPS THE SHARED LINE. With no pilots drawn there is
    // nobody to remove, and a hint that names a key which does nothing is the
    // defect `results.hint` is already annotated against.
    this.addHint(profiles.length === 0 ? "ui.common.hintKeys" : "ui.pick.hint");
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
    // BOTTOM-RIGHT, ON THE PRODUCT'S LINES (UR-112). He was at
    // `(GAME_WIDTH * 0.72, 520)` - the owner's "floating in the middle of
    // space" - and `support/pickerLayout.shadowOrigin` now puts his drawn
    // footprint's right edge on the right gutter and its foot on the same line
    // `grid.backCorner` sits a bottom-right control on, the way
    // `support/earthLayout.shadowOrigin` places him on Earth activation.
    const emptyScale = SHADOW_DRAWN_HEIGHT.empty / SHADOW_HEIGHT;
    const emptyAt = shadowOrigin(GAME_WIDTH, emptyScale);
    this.shadows.push(
      drawShadow(this, emptyAt.x, emptyAt.y, "idle", {
        scale: emptyScale,
        reducedMotion: this.reducedMotion,
        facing: -1,
        depth: this.depth - 2,
      }),
    );
    // UR-142: Shadow greets a first-time pilot on a fresh arrival only -
    // not when the hangar just emptied because a pilot was removed.
    if (!this.silent) {
      // UR-148: the card sits above Shadow, right-aligned to his column since
      // he stands on the right here. Clamped to clear the pilot list.
      const figure = shadowBox(GAME_WIDTH, emptyScale);
      const listRight = SPACE.gutter + this.newPilotWidth();
      const cardRight = figure.x + figure.w;
      const plateW = Math.min(
        GREETING.maxW,
        cardRight - (listRight + SPACE.gutter),
      );
      const wrapWidth = speechCardWrapWidth(plateW);

      // Measured, not reserved, so a longer translation grows the card.
      const probe = uiText(this, 0, 0, this.t.t("ui.pick.greeting"), {
        size: TYPE.body,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
        wrapWidth,
      });
      const lineCount = Math.max(1, probe.getWrappedText().length);
      probe.destroy();

      const cardH = speechCardHeight(lineCount);
      const plateBox = {
        x: cardRight - plateW,
        y: figure.y - GREETING.tailGap - cardH,
        w: plateW,
        h: cardH,
      };
      const { speaker: speakerRow, line: lineRow } = drawSpeechCard(
        this,
        plateBox,
        lineCount,
        this.depth,
      );
      uiText(this, speakerRow.x, speakerRow.y, "Shadow", {
        size: TYPE.caption,
        color: this.uiStyle.accent,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      }).setDepth(this.depth + 1);
      uiText(
        this,
        lineRow.x,
        lineRow.y,
        this.t.t("ui.pick.greeting"),
        {
          size: TYPE.body,
          color: INK.text,
          lang: this.uiStyle.lang,
          uppercase: this.uiStyle.uppercase,
          increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
          wrapWidth,
        },
      ).setDepth(this.depth + 1);

      // D98: the id must have a rendered clip; see spokenLines.test.ts.
      audioFrom(this.registry)?.speak({
        id: "ui.pick.greeting",
        text: this.t.t("ui.pick.greeting"),
        kind: "scripted",
      });
    }

    // The same row the list variant builds, so the control keeps its shape.
    const create = this.newPilotRow(this.newPilotWidth(), CONTENT_TOP);
    this.rows = [create];
    this.setControls(this.rows, NEW_PILOT_ID);
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
    // Shadow stands beside the list, not in it - and in the corner the product
    // reserves for the bottom-right of a screen rather than at the literal
    // `(GAME_WIDTH - 260, 620)`, which is the middle of the sky on a 1080 world
    // (UR-112; `support/pickerLayout.shadowOrigin` carries the reasoning).
    const listScale = SHADOW_DRAWN_HEIGHT.list / SHADOW_HEIGHT;
    const listAt = shadowOrigin(GAME_WIDTH, listScale);
    this.shadows.push(
      drawShadow(this, listAt.x, listAt.y, "pointing", {
        scale: listScale,
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
    const create = this.newPilotRow(width, y);
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

      /**
       * The furthest beacon, lit, in the row's TOP-RIGHT CORNER (UR-141).
       *
       * It was 72 px tall and vertically centred, which made it the second
       * biggest thing on the row after the avatar - it read as a piece of
       * hardware competing with the pilot's own mark rather than as a stamp
       * saying how far they got. The owner asked for it small and in the
       * corner, which is also how the rest of the product marks a row: a
       * badge, not an instrument.
       */
      if (stop !== null && isStopId(stop)) {
        // UR-145: inset by the DRAWING's box, glow included. Insetting by the
        // body's numbers put the blink's top edge on the row's border.
        const box = beaconBox(BEACON_CORNER.size);
        const beacon = drawBeacon(
          this,
          SPACE.gutter + width - BEACON_CORNER.inset - box.halfW,
          y + BEACON_CORNER.inset - box.top,
          BEACON_CORNER.size,
          this.app.palette(stop).accent,
          true,
          this.reducedMotion,
        );
        beacon.setDepth(this.depth + 1);
      }

      y += row.ringBounds().h + SPACE.gap;
    }

    this.rows = controls;
    // THE CARET OPENS ON "NEW PILOT" (UR-112).
    //
    // It used to open on the pilot who last flew - "so the common case is one
    // key press" - and the owner's brother, who had no such pilot, spent
    // several seconds working out that he could press Enter at all. The full
    // argument, and the one arrow key a returning pilot now pays, is written
    // out in `support/pickerLayout.initialFocusId`; it is a function so this
    // screen cannot quietly grow a second answer.
    this.setControls(
      controls,
      initialFocusId(profiles.length, this.app.profile()?.id ?? null),
    );
  }

  /**
   * How wide "new pilot" is when there is no list to line up with.
   *
   * The empty hangar has one control and nothing to match, so the row is
   * measured from its own label exactly the way `naturalRowWidth` measures a
   * list - same function, one string - rather than from a literal 320.
   */
  private newPilotWidth(): number {
    return Math.min(
      GAME_WIDTH - SPACE.gutter * 2,
      this.naturalRowWidth([this.t.t("ui.pick.newPilot")], []),
    );
  }

  /**
   * "NEW PILOT", AS A ROW OF THE SAME LIST (UR-112).
   *
   * ================== WHAT WAS REPORTED ==================
   * The owner: it "is visibly larger/different ... they should read as one
   * list". Measured on the served build, it was 466x112 for a pilot row and
   * 466x67 for this one: same width, 45 px shorter, because a `MenuButton` is
   * sized from `rowHeight(TYPE.body)` and a `ListRow` is sized around its 84 px
   * mark. Two different controls stacked in one column.
   *
   * ================== WHY THE SAME CLASS AND NOT A MATCHED HEIGHT ==========
   * A `minHeight` on `MenuButton` would have made the two boxes equal and left
   * the first row visibly empty on the left where every row below it has a
   * mark - the rows would MEASURE the same and still not read as one list. The
   * same class with the same glyph size gives the same box by construction,
   * which is a property that survives the next type-scale change instead of
   * being re-tuned by hand.
   *
   * It keeps `role: "button"` in the mirror, because it is one: a screen reader
   * must not be told the way to start a pilot is a list item (AC-18.1), and
   * `ListRow` uses the role to decide whether the label is chrome the letter
   * case setting may rewrite - a pilot's name is theirs, "new pilot" is ours.
   */
  private newPilotRow(width: number, y: number): ListRow {
    return new ListRow(this, this.uiStyle, NEW_PILOT_ID, SPACE.gutter, y, this.depth, {
      label: this.t.t("ui.pick.newPilot"),
      width,
      role: "button",
      glyphSize: GLYPH_PX,
      glyph: (scene, gx, gy) =>
        drawNewPilotMark(scene, gx, gy, GLYPH_PX, this.uiStyle.accent),
      onPress: () =>
        // UR-118: the one menu move that is the same place at two moments.
        this.goTo(SCENE_KEYS.profileCreate, { fadeIn: true }, { fade: true }),
    });
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
        this.scene.restart({ silent: true });
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
      // THE ROWS' MEASURED BOXES, so "new pilot is the same size as a pilot
      // row" is a claim a test can make against the SCREEN rather than against
      // two constructor calls in a unit test. These are `Control.ringBounds`,
      // i.e. the layout box the focus ring is struck around - the box a child
      // sees the edge of - and not the drawn box, which breathes with the pop.
      rowRects: this.rows.map((row) => {
        const b = row.ringBounds();
        return { id: row.id, x: b.x, y: b.y, w: b.w, h: b.h };
      }),
      // WHERE SHADOW WAS ACTUALLY PLACED, read off the figure rather than
      // recomputed, for the same reason: a `Graphics` carries no text, so
      // `grid-conformance.spec.ts` cannot see him and the owner's "floating in
      // the middle of space" was not assertable by anything.
      shadowOrigin: this.shadows.map((s) => ({
        x: Math.round(s.root.x),
        y: Math.round(s.root.y),
        scale: Math.abs(s.root.scaleY),
      })),
    };
  }
}
