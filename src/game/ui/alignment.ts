import { GUTTER, contentRight } from "./grid.js";
import { PLATE_RHYTHM } from "./plateLayout.js";
import { STEP, STEPS } from "./theme.js";

/**
 * THE ALIGNMENT MODEL: where an element's left edge is allowed to be (UR-69).
 *
 * ================== THE MEASUREMENT ==================
 * A census of the served build at 1920x1080, walking the real display list of
 * all nine screens, counted 164 DISTINCT LEFT EDGES app-wide:
 *
 *   DirectorMap 34 · Results 27 · Ending 27 · Title 23 · Briefing 20 ·
 *   Beacon 19 · Preflight 16 · Warp 16 · Settings 13
 *
 * On the Pre-flight, `GUTTER` is 96 and exactly TWO elements sat on it; the
 * rest landed at 0, 118, 224, 326, 400, 464, 650, 781, 826 and 993. None of
 * those is a decision. They are the arithmetic of a screen adding its own
 * number to its own anchor, nine times over.
 *
 * ================== WHY THIS IS NOT "ONE EDGE PER SCREEN" ==================
 * Some distinct edges are correct. A row indented inside a panel is not
 * misaligned; a centred Ending headline is not misaligned; a right-anchored
 * readout is not misaligned. The target is therefore not a number of edges, it
 * is that EVERY edge is on a named line or is explicitly outside the model with
 * a reason.
 *
 * ================== THE MODEL ==================
 * An element's left edge is legal when it is one of:
 *
 *   GUTTER                      the page margin. `ui/grid.ts` fixes it at 96
 *                               against the widest screen in the game.
 *   a plate's INNER LINE        `plate.x + rhythm.padX`, where the rhythm is
 *                               one of the four in `plateLayout.PLATE_RHYTHM`.
 *                               Since UR-69 every plate is drawn by one
 *                               component, so this is a closed set of four
 *                               offsets - 22, 28, 32, 40 - rather than whatever
 *                               each scene added.
 *   an INDENT                   an inner line plus a whole number of vertical
 *                               units (`STEP.unit`, 20). A row indented inside
 *                               a panel, bounded at three so "indented" cannot
 *                               come to mean "anywhere to the right".
 *   CENTRED                     the element's own centre on the world's, within
 *                               a pixel. Declared per screen, never inferred.
 *   RIGHT-ANCHORED              the element's RIGHT edge on `contentRight()` or
 *                               on a plate's right inner line. Its left edge is
 *                               then a function of its own width and is not a
 *                               line at all.
 *
 * ================== WHERE THIS BELONGS, AND WHY IT IS NOT THERE ==================
 * IN `ui/grid.ts`, beside `HEADER_CONTRACT` and `HINT_CONTRACT`, which are the
 * same kind of declaration about the same screens. It is here instead because
 * `ui/grid.ts` is being edited by the lane closing UR-19's header contract in
 * the same change, and two lanes in one file is how `crossDrift` was lost. This
 * module imports `GUTTER` and `contentRight` from there and adds nothing that
 * contradicts them, so folding it in is a move rather than a merge.
 *
 * Nothing here imports Phaser or the DOM, and `GAME_WIDTH` is read at call time
 * through `contentRight()` - the world widens with the window (D99).
 */

/**
 * Every inset a plate's content can start at: the four rhythms' `padX`.
 *
 * A CLOSED SET, and that is the point of UR-69. Before the plate was one
 * component, a screen's inner line was whatever the scene added to the panel's
 * x - the Beacon's readout used 48, the warp card 40, the Pre-flight's rows
 * their own - and there was no list to check an edge against.
 */
export const INNER_LINES: readonly number[] = [
  ...new Set(Object.values(PLATE_RHYTHM).map((r) => r.padX)),
].sort((a, b) => a - b);

/**
 * How many vertical units an indent may be. Three, so that "indented inside a
 * panel" stays a short ladder rather than a licence.
 */
export const MAX_INDENT_UNITS = 3;

/** Every offset from a plate's own left edge that content may start at. */
export function innerOffsets(): number[] {
  const out = new Set<number>();
  for (const pad of INNER_LINES) {
    for (let n = 0; n <= MAX_INDENT_UNITS; n += 1) out.add(pad + n * STEP.unit);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Every left edge a GUTTER-anchored screen may use, given the plates on it.
 *
 * `plateLefts` is the x of each plate the screen draws. A screen with no plates
 * has exactly one legal edge, which is the gutter.
 */
export function legalLefts(plateLefts: readonly number[] = []): number[] {
  const out = new Set<number>([GUTTER]);
  for (const left of [GUTTER, ...plateLefts]) {
    for (const off of innerOffsets()) out.add(left + off);
  }
  return [...out].sort((a, b) => a - b);
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** How far off the nearest legal line an edge is. 0 is on it. */
export function offGrid(x: number, legal: readonly number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of legal) best = Math.min(best, Math.abs(x - line));
  return best;
}

/**
 * A pixel of slack, and no more.
 *
 * Text bounds are measured off real glyph metrics, so an element laid out ON a
 * line reports its box within a pixel of it - never further. A wider tolerance
 * is how a guard comes to pass a screen that is visibly wrong, which is what
 * happened to `grid-conformance.spec.ts`: it measures drift across widths, the
 * header band, the hint band and the anchor model, and PASSES the Pre-flight,
 * because not one of its assertions asks whether two elements share a left
 * edge.
 */
export const EDGE_TOLERANCE = 1;

/** True when the element's own centre is on the world's, within a pixel. */
export function isCentred(box: Box, worldWidth: number): boolean {
  return Math.abs(box.x + box.w / 2 - worldWidth / 2) <= EDGE_TOLERANCE;
}

/**
 * True when the element's RIGHT edge is on the content column's right line, or
 * on one of the inner lines measured in from it.
 *
 * Right-anchoring is a real alignment - the warp drive's percentage is the
 * right end of its own row - and an element that has it is judged on its right
 * edge, because its left is a function of its width.
 */
export function isRightAnchored(box: Box, plateRights: readonly number[] = []): boolean {
  const right = box.x + box.w;
  for (const line of [contentRight(), ...plateRights]) {
    for (const off of innerOffsets()) {
      if (Math.abs(right - (line - off)) <= EDGE_TOLERANCE) return true;
    }
  }
  return false;
}


// ---------------------------------------------------------------------------
// Runs and rows: what counts as ONE element
// ---------------------------------------------------------------------------

/**
 * WHY A LEFT EDGE IS NOT A TEXT OBJECT'S x.
 *
 * The first cut of this model judged every visible Text and reported 20
 * off-model elements on the warp break. Nineteen of them were the letters
 * "a r s i s t h e r e d p l a n e t" - `WarpScene.layoutLetters` draws ONE
 * TEXT PER CHARACTER so a letter can light on its own (art-direction s7), and a
 * glyph inside a laid-out line has no left edge of its own to be wrong about.
 * The same shape put six entries on the Earth activation for the word "launch".
 *
 * A guard that reports nineteen letters is a guard nobody reads, and a budget
 * seeded from it would have been a number that says "one sentence" while
 * reading 20. So:
 *
 *   RUN   objects close enough together to be one laid-out line. Judged once,
 *         on the first one's left edge.
 *   ROW   runs that share a horizontal band. The first run is judged against
 *         the named lines; the rest are judged on their SPACING, because a row
 *         of stop chips distributed across the width is not misaligned.
 */

/**
 * A gap smaller than this means the two objects are one laid-out line.
 *
 * ONE VERTICAL UNIT, and it was `STEP.tight` first. At 12 the warp sentence
 * split into five runs, because the SPACE between two words of 52 px type
 * measures 15-16 px - so the guard reported "i", "t", "r" and "p" as four
 * elements that had drifted 15 px, which is the middle of a sentence. Anything
 * closer together than the product's own vertical unit is adjacency, not
 * alignment.
 */
export const RUN_GAP = STEP.unit;

/** Two objects are on one row when their vertical spans overlap at all. */
export function sameRow(a: Box, b: Box): boolean {
  return a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface Run {
  readonly x: number;
  readonly right: number;
  readonly y: number;
  readonly h: number;
  /** Every box that was coalesced into this run, in order. */
  readonly parts: readonly Box[];
}

/** Coalesce a row's boxes, left to right, into laid-out lines. */
export function runsOf(boxes: readonly Box[]): Run[] {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const out: Run[] = [];
  for (const box of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && box.x - last.right <= RUN_GAP) {
      out[out.length - 1] = {
        x: last.x,
        right: Math.max(last.right, box.x + box.w),
        y: Math.min(last.y, box.y),
        h: Math.max(last.y + last.h, box.y + box.h) - Math.min(last.y, box.y),
        parts: [...last.parts, box],
      };
      continue;
    }
    out.push({ x: box.x, right: box.x + box.w, y: box.y, h: box.h, parts: [box] });
  }
  return out;
}

/** Group a screen's boxes into rows by vertical overlap, top to bottom. */
export function rowsOf(boxes: readonly Box[]): Box[][] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Box[][] = [];
  for (const box of sorted) {
    const row = rows.find((r) => r.some((other) => sameRow(other, box)));
    if (row === undefined) rows.push([box]);
    else row.push(box);
  }
  return rows;
}

/**
 * True when a row's runs are EVENLY DISTRIBUTED across the frame: their centres
 * are on one pitch.
 *
 * This is the map's seven stop chips, the Ending's route band and the stage
 * report's stat columns. They sit under something - a planet disc, a tile - and
 * their left edges differ because their words differ ("Earth" against
 * "Jupiter"). Their CENTRES are the thing that is aligned, and a model that
 * insisted on their lefts would be demanding a defect.
 */
export function evenlyPitched(runs: readonly Run[], tolerance = 4): boolean {
  if (runs.length < 3) return false;
  const centres = runs.map((r) => (r.x + r.right) / 2);
  const pitches: number[] = [];
  for (let i = 1; i < centres.length; i += 1) {
    pitches.push((centres[i] as number) - (centres[i - 1] as number));
  }
  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  return pitches.every((p) => Math.abs(p - mean) <= tolerance);
}

/** True when the gap between two runs is a whole number of vertical units. */
export function gapOnScale(previous: Run, next: Run): boolean {
  const gap = next.x - previous.right;
  if (gap < 0) return false;
  return STEPS.some((step) => Math.abs(gap - step) <= EDGE_TOLERANCE)
    || Math.abs(gap % STEP.unit) <= EDGE_TOLERANCE;
}

export type Anchor = "gutter" | "centred";

export interface Verdict {
  /** Empty when the edge is on the model. */
  readonly reason: string;
  readonly ok: boolean;
}

/**
 * Judge one element's left edge.
 *
 * Takes the screen's anchoring, which is DECLARED per screen rather than
 * inferred - the same rule `grid-conformance.spec.ts` applies to its own anchor
 * model, and for the same reason: a screen that reflows and a screen that does
 * not are both correct, and which one a screen is cannot be read off one frame.
 */
export function judgeEdge(
  box: Box,
  options: {
    readonly anchor: Anchor;
    readonly worldWidth: number;
    readonly plateLefts?: readonly number[];
    readonly plateRights?: readonly number[];
  },
): Verdict {
  if (options.anchor === "centred" && isCentred(box, options.worldWidth)) {
    return { ok: true, reason: "" };
  }
  if (isRightAnchored(box, options.plateRights)) return { ok: true, reason: "" };
  const legal = legalLefts(options.plateLefts);
  const off = offGrid(box.x, legal);
  if (off <= EDGE_TOLERANCE) return { ok: true, reason: "" };
  return {
    ok: false,
    reason: `x=${box.x} is ${Math.round(off)}px off the nearest line`,
  };
}

export interface RowVerdict {
  /** One line per run that is off the model, with its x. */
  readonly off: string[];
}

/**
 * Judge one row.
 *
 * The FIRST run is judged against the named lines, because that is the row's
 * own left edge. The rest are judged on spacing - even pitch across the row, or
 * a gap on the scale - because a row distributed across the frame is a layout,
 * not a drift.
 */
export function judgeRow(
  row: readonly Box[],
  options: {
    readonly anchor: Anchor;
    readonly worldWidth: number;
    readonly plateLefts?: readonly number[];
    readonly plateRights?: readonly number[];
    readonly describe?: (box: Box) => string;
  },
): RowVerdict {
  const runs = runsOf(row);
  const off: string[] = [];
  const name = (run: Run): string =>
    options.describe?.(run.parts[0] as Box) ?? `x=${run.x}`;

  const first = runs[0];
  if (first === undefined) return { off };
  const head = { x: first.x, y: first.y, w: first.right - first.x, h: first.h };
  const verdict = judgeEdge(head, options);
  if (!verdict.ok) off.push(`${name(first)} ${verdict.reason}`);

  if (evenlyPitched(runs)) return { off };
  for (let i = 1; i < runs.length; i += 1) {
    const previous = runs[i - 1] as Run;
    const run = runs[i] as Run;
    const box = { x: run.x, y: run.y, w: run.right - run.x, h: run.h };
    if (gapOnScale(previous, run)) continue;
    if (isRightAnchored(box, options.plateRights)) continue;
    if (options.anchor === "centred" && isCentred(box, options.worldWidth)) continue;
    const legal = legalLefts(options.plateLefts);
    if (offGrid(run.x, legal) <= EDGE_TOLERANCE) continue;
    off.push(
      `${name(run)} x=${run.x} follows a run ending at ${previous.right}: ` +
        `gap ${run.x - previous.right} is not on the scale`,
    );
  }
  return { off };
}
