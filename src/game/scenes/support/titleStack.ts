import { GAME_HEIGHT } from "@game/sceneKeys";
import { HINT_TOP } from "@game/ui/grid";

/**
 * THE TITLE'S MENU COLUMN, AS A BUDGET (UR-68).
 *
 * ================== THE DEFECT, MEASURED ==================
 * UR-68: the continue button, the beacon status line and the settings control
 * were reported as jammed together with no air between them, reading as one
 * crowded block rather than a primary action with a quiet secondary under it.
 *
 * `TitleScene` spaced the column with three constants measured from the
 * WORDMARK - `PRIMARY_GAP` 92, `SETTINGS_GAP` 166, `LANG_GAP` 174 - and the
 * status line was placed at a fixed local offset inside the primary button
 * (`height + 18`) with no budget of its own. So the status line did not claim
 * space; it borrowed the settings control's. Every visible Text object's
 * bounds, read off the live scene tree at 1920x1080:
 *
 *   returning pilot, Neptune   primary plate 560..664
 *                              status plate  674..718   ->  10 px of air
 *                              settings plate 718..769  ->   0 px of air
 *   with the focus rings the screen actually draws (14 px outside a control):
 *                              primary ring bottom 678 vs status top 674
 *                                                       ->  -4 px, OVERLAP
 *                              status bottom 718 vs settings ring top 712
 *                                                       ->  -6 px, OVERLAP
 *   new pilot (no beacon)      primary plate 603..707
 *                              settings plate 761..812  ->  54 px of air
 *
 * The last row is the whole report in one line. WITHOUT a beacon the column has
 * 54 px between its two controls and looks fine - and a new profile is the only
 * state anybody ever screenshotted, which is the same blind spot that let the
 * Title accent bug live for months (`docs/verification-gaps.md`). WITH a beacon
 * the status line is dropped into that 54 px and needs 64, so it lands on the
 * settings control and spends the primary's air on the way down.
 *
 * ================== WHAT REPLACES THEM ==================
 * Every block gets a gap of its own and the ones below it are placed from the
 * block ABOVE, not from the wordmark. Adding a block therefore moves what
 * follows it instead of overlapping it, which is the property the fixed
 * constants could not have.
 *
 * The gaps are measured against the FOCUS RING's box rather than the plate's,
 * because the ring is 14 px outside a focusable control and is drawn every
 * frame (`TitleScene.drawFocusRing`). A gap that clears the plate and not the
 * ring is a gap the player never sees.
 *
 * ================== THE CLAMP IS GONE ==================
 * `PRIMARY_Y_MAX` was a 740 px ceiling on the primary button, there so a future
 * change to the sun or the lockup could not walk the menu off the bottom of the
 * frame. It could not do that job: it pinned the TOP of a stack whose HEIGHT it
 * did not know, so at a lockup pushed far enough down by the stop's light the
 * button was clamped ABOVE the wordmark's own tagline, and everything below it
 * still ran past the floor. What bounds the stack now is the stack's own
 * bottom: when it will not fit, the gap to the wordmark tightens first, down to
 * a floor, and if it STILL does not fit `overflow` reports how far past the
 * bottom it reaches instead of the screen quietly printing through itself.
 * Same order of concessions, and for the same reason, as `briefingLayout`.
 *
 * Pure: numbers in, tops out. No Phaser, no DOM, so `titleStack.test.ts` holds
 * the real budget without booting a scene.
 */

// ---------------------------------------------------------------------------
// The primary button's own box
// ---------------------------------------------------------------------------

/** The accent plate `TitleScene.buildPrimary` draws. */
export const PRIMARY_W = 460;
export const PRIMARY_H = 104;

/**
 * How far a focus ring reaches outside the control it is around.
 *
 * `TitleScene` strokes its ring at `root.x - pad, root.y - pad` with `pad` 14
 * and makes the pointer hit zone the same rectangle, so this is both what the
 * eye sees and what the mouse hits. Exported so the scene, this module and the
 * specs cannot each carry their own copy of it.
 */
export const FOCUS_PAD = 14;

/** The plate padding under the status line and the quiet controls. */
export const CHROME_PAD_Y = 8;

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * Wordmark to the primary action. Unchanged at 92: the relationship between the
 * mark and the first action is the one part of this column nobody reported.
 */
export const MARK_GAP = 92;

/**
 * How far that gap may be squeezed when the column runs out of frame.
 *
 * Not lower than 48, because `LOCKUP_H` (218) stops 3 px ABOVE the bottom of
 * the tagline's plate, so the last ~24 px of "air" under the mark is already
 * spoken for. 48 leaves a real gap after that.
 */
export const MARK_GAP_MIN = 48;

/**
 * Air between the primary action's focus ring and the status line's plate.
 *
 * Deliberately the SMALLEST gap in the column. The status line is the primary
 * action's caption - "Beacon placed at Neptune." explains what Continue will
 * resume - so it has to read as belonging to the button above it rather than
 * as a third item in a list. It was 10 px measured from the plate and -4 px
 * measured from the ring, which is not a small gap, it is no gap.
 */
export const STATUS_GAP = 20;

/**
 * Air between the primary block and the quiet control under it.
 *
 * More than twice `STATUS_GAP`, which is what makes the split visible: the
 * button and its caption group, then a clear break, then the secondary. 44
 * rather than the grid's `BLOCK_GAP` of 40 because this gap is measured ring to
 * ring and the grid's is measured plate to plate.
 */
export const SECONDARY_GAP = 34;

/**
 * Air between two QUIET controls - settings and the language row.
 *
 * Smaller than `SECONDARY_GAP` because those two are a list, not two groups.
 * The big break in this column is the one between the primary action and
 * everything else; repeating it between two peers says they are as unrelated to
 * each other as they are to the button, which is not true and reads as three
 * loose items rather than one action and a quiet pair.
 */
export const QUIET_GAP = 28;

/**
 * The smallest clear gap this column is allowed to show anywhere, ring to
 * plate. It is the assertion the specs make, and it is the floor of the budget
 * above rather than a number chosen next to it: if `STATUS_GAP` is ever edited
 * below this, `titleStack.test.ts` fails on its own constants.
 */
export const MIN_CLEAR = 20;

/**
 * The frame itself. Nothing may be drawn past it at any budget.
 *
 * `STACK_FLOOR` is where the column SHOULD stop; this is where it physically
 * must. The two differ, and the difference is what `overflow` is reported in:
 * a column that reaches into the hint band has a problem somebody should look
 * at, and a column that reaches past 1080 has a control a child cannot press
 * (AC-18.1), which is a different severity.
 */
export const FRAME_BOTTOM = GAME_HEIGHT;

/**
 * The lowest edge the column may reach.
 *
 * The product's hint line (`ui/grid.HINT_TOP`, 1004). The Title draws no hint -
 * its controls carry their own labels, which `grid-conformance` declares - so
 * nothing on this screen has any business below where a hint would start.
 */
export const STACK_FLOOR = HINT_TOP;

// ---------------------------------------------------------------------------
// The placement
// ---------------------------------------------------------------------------

export interface TitleStackInput {
  /** The bottom of the wordmark lockup, in world px. */
  readonly markBottom: number;
  /** The primary button's plate height. */
  readonly primaryH: number;
  /**
   * The status line's PLATE height, or null when there is none.
   *
   * NULL IS THE NEW-PILOT STATE AND IT IS HALF OF WHAT THIS MODULE IS FOR. The
   * line only exists once a beacon has been placed (D13), so a fresh profile
   * renders no such line at all - which is why the crowding never appeared in a
   * capture.
   */
  readonly statusH: number | null;
  /** The quiet control's plate height. */
  readonly settingsH: number;
  /** The language row's plate height, or null when it is not shipped (D95). */
  readonly langH: number | null;
  /** The lowest edge the column may reach. Defaults to `STACK_FLOOR`. */
  readonly floor?: number;
}

export interface TitleStackTops {
  /** Top of the primary button's plate. */
  readonly primaryY: number;
  /** Top of the status line's plate, or null when there is none. */
  readonly statusY: number | null;
  /** Top of the quiet control's plate. */
  readonly settingsY: number;
  /** Top of the language row's plate, or null when it is not shipped. */
  readonly langY: number | null;
  /** The lowest edge the column reaches, focus ring included. */
  readonly bottom: number;
  /** How far the gap to the wordmark had to tighten. 0 when nothing was needed. */
  readonly tightenedBy: number;
  /** How far past the floor the column still reaches. 0 when it fits. */
  readonly overflow: number;
}

/**
 * Lay the column out from the bottom of the lockup and the measured blocks.
 *
 * ORDER OF CONCESSIONS: white space to the wordmark first, then the truth. The
 * gaps WITHIN the column are never squeezed - they are the thing UR-68 was
 * filed about, so trading them away to win a fit would reintroduce the defect
 * on exactly the windows nobody looks at.
 */
export function titleStack(input: TitleStackInput): TitleStackTops {
  const floor = input.floor ?? STACK_FLOOR;
  const place = (markGap: number): Omit<TitleStackTops, "tightenedBy" | "overflow"> => {
    const primaryY = input.markBottom + markGap;
    // The primary action's own block: the button, its ring, and the caption
    // that belongs to it.
    const ringBottom = primaryY + input.primaryH + FOCUS_PAD;
    const statusY = input.statusH === null ? null : ringBottom + STATUS_GAP;
    const blockBottom =
      statusY === null || input.statusH === null ? ringBottom : statusY + input.statusH;

    const settingsY = blockBottom + SECONDARY_GAP + FOCUS_PAD;
    const settingsBottom = settingsY + input.settingsH + FOCUS_PAD;

    const langY = input.langH === null ? null : settingsBottom + QUIET_GAP + FOCUS_PAD;
    const bottom =
      langY === null || input.langH === null ? settingsBottom : langY + input.langH + FOCUS_PAD;

    return { primaryY, statusY, settingsY, langY, bottom };
  };

  const full = place(MARK_GAP);
  if (full.bottom <= floor) return { ...full, tightenedBy: 0, overflow: 0 };

  const want = full.bottom - floor;
  const tightenedBy = Math.min(want, MARK_GAP - MARK_GAP_MIN);
  const tight = place(MARK_GAP - tightenedBy);
  return { ...tight, tightenedBy, overflow: Math.max(0, tight.bottom - floor) };
}

// ---------------------------------------------------------------------------
// What a spec measures
// ---------------------------------------------------------------------------

/**
 * The clear gaps between the column's blocks, ring to plate, top to bottom.
 *
 * ONE DEFINITION OF "THE GAP", shared by the unit test and the e2e sweep. The
 * e2e reads its boxes off the live scene tree and this function is handed those
 * numbers, so the two specs cannot disagree about what they are measuring -
 * which is how "the gap is fine" and "the gap is -4" were both true of this
 * screen at once, one counting plates and the other counting what was drawn.
 */
export function clearGaps(boxes: {
  readonly primaryTop: number;
  readonly primaryBottom: number;
  readonly statusTop: number | null;
  readonly statusBottom: number | null;
  readonly settingsTop: number;
}): number[] {
  const primaryRing = boxes.primaryBottom + FOCUS_PAD;
  const settingsRing = boxes.settingsTop - FOCUS_PAD;
  if (boxes.statusTop === null || boxes.statusBottom === null) {
    return [settingsRing - primaryRing];
  }
  return [boxes.statusTop - primaryRing, settingsRing - boxes.statusBottom];
}
