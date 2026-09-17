/**
 * FLAT-BASED MASS DETECTION (AC-22.10, D97).
 *
 * "No parallax layer renders a landform silhouette that terminates in a flat
 * base with sky visible beneath it."
 *
 * ---------------------------------------------------------------------------
 * WHY A SIGNATURE AND NOT A GREP
 *
 * The other half of AC-22.10 - "no terrain tile in the layer build" - is a
 * source check, and on its own it is weak: it only catches the thing spelled the
 * way somebody expected. `massifTile` is caught; `paintMidfield` is not, and
 * neither is a sine hill drawn inline in `parallax.ts` by a lane that never read
 * D97.
 *
 * A flat base is a SHAPE, and a shape has a measurable signature no matter what
 * the function that drew it is called: a long horizontal run of columns at which
 * a mass ends and brighter pixels begin, with the ending at the same row all the
 * way across. That is what a landform terminating in a flat base IS, and it is
 * what three generations of removed terrain in `tiles.ts` had in common.
 *
 * ---------------------------------------------------------------------------
 * THE HARD PART IS NOT DETECTING IT, IT IS NOT FIRING ON WHAT D97 ALLOWS
 *
 * D97 replaced terrain with ring planes seen near edge-on, a planet limb, nebula
 * bands and dust fields. A ring plane is a very wide, very shallow ellipse, and
 * the bottom of a shallow ellipse is nearly flat over a long run - so a naive
 * "long horizontal dark-to-bright edge" fires on exactly the forms the decision
 * was made to allow. Measured, on a real frame with each form composited in:
 *
 *   naive run detector, fixed row, +/-3 row sampling band
 *     flat-based mass   0.562 of frame width     <- the defect
 *     wide ring plane   0.420                    <- ALLOWED, and it fires
 *     planet limb       0.210                    <- ALLOWED, and it nearly fires
 *
 * The fix is to locate the edge PRECISELY per column instead of accepting any
 * row whose neighbourhood straddles a transition. `edgeRows` keeps only local
 * maxima of the step and suppresses non-maxima within +/-`NMS_ROWS`, so a curved
 * or soft edge yields ONE row per column rather than a band of them, and the
 * run then has to be straight to be long. Same three shapes, same frame:
 *
 *   this measure
 *     flat-based mass   0.562 of frame width
 *     wide ring plane   0.204
 *     planet limb       0.123
 *     real frames       0.055 - 0.084 (with the HUD masked and word plates in)
 *
 * WHAT IT DOES NOT CLAIM. A flat base NARROWER than the bar is not caught, and
 * the bar cannot go much lower without failing a ring plane, which is an allowed
 * form - the ellipse's 0.204 is the floor this signature has, not a number
 * chosen for comfort. The source half of AC-22.10 is the complement: between
 * them, a wide flat base is caught by the pixels and a named terrain painter is
 * caught by the build.
 *
 * PURE ON PURPOSE, like `silhouette.mjs`: no browser, no canvas, no filesystem,
 * so `tests/unit/gauntlet/flatBase.test.ts` can run the negative control in
 * milliseconds and the e2e can run the identical code on a real captured frame.
 */

/** Rows above and below the candidate edge that are averaged on each side. */
export const BAND_ROWS = 3;
/** Minimum luminance step across the edge for a column to count. */
export const MIN_STEP = 10;
/** Non-maximum suppression window, in rows. */
export const NMS_ROWS = 4;
/** How far the edge row may wander across a run and still be called flat. */
export const FLATNESS_ROWS = 1;
/** Frame margins skipped: the letterbox seam is not a silhouette. */
export const TOP_MARGIN = 0.02;
export const BOTTOM_MARGIN = 0.98;

const inBox = (x, y, b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/**
 * Rows at which a mass ENDS, per column.
 *
 * A column contributes a row only when that row is a LOCAL MAXIMUM of
 * (mean of the `BAND_ROWS` below) - (mean of the `BAND_ROWS` above) and no
 * stronger step sits within `NMS_ROWS`. Without the suppression a shallow curve
 * registers at every row its soft edge passes through and any flatness test
 * downstream is measuring the sampling band rather than the shape.
 */
export function edgeRows({ grey, w, h, exclude = [], minStep = MIN_STEP }) {
  const y0 = Math.floor(h * TOP_MARGIN) + BAND_ROWS + 1;
  const y1 = Math.ceil(h * BOTTOM_MARGIN) - BAND_ROWS - 2;
  const cols = [];
  for (let x = 0; x < w; x += 1) {
    const step = new Map();
    for (let y = y0; y <= y1; y += 1) {
      let blocked = false;
      for (const b of exclude) {
        if (inBox(x, y, b)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      let above = 0;
      let below = 0;
      for (let k = 1; k <= BAND_ROWS; k += 1) {
        above += grey[(y - k) * w + x];
        below += grey[(y + k + 1) * w + x];
      }
      const d = below / BAND_ROWS - above / BAND_ROWS;
      if (d >= minStep) step.set(y, d);
    }
    const keep = new Set();
    for (const [y, d] of step) {
      let isMax = true;
      for (let k = -NMS_ROWS; k <= NMS_ROWS; k += 1) {
        if ((step.get(y + k) ?? -1) > d) {
          isMax = false;
          break;
        }
      }
      if (isMax) keep.add(y);
    }
    cols.push(keep);
  }
  return { cols, y0, y1 };
}

/**
 * The longest run of columns whose mass ends at the same row, +/- `FLATNESS_ROWS`.
 *
 * @returns {{ runPx:number, runFraction:number, atRow:number, fromX:number }}
 */
export function longestFlatBase({ grey, w, h, exclude = [], minStep = MIN_STEP, flatness = FLATNESS_ROWS }) {
  const { cols, y0, y1 } = edgeRows({ grey, w, h, exclude, minStep });
  let runPx = 0;
  let atRow = 0;
  let fromX = 0;
  for (let row = y0; row <= y1; row += 1) {
    let run = 0;
    let start = 0;
    for (let x = 0; x < w; x += 1) {
      let hit = false;
      for (let d = -flatness; d <= flatness; d += 1) {
        if (cols[x].has(row + d)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        if (run === 0) start = x;
        run += 1;
        if (run > runPx) {
          runPx = run;
          atRow = row;
          fromX = start;
        }
      } else {
        run = 0;
      }
    }
  }
  return { runPx, runFraction: Number((runPx / w).toFixed(4)), atRow, fromX };
}

/**
 * Composite a flat-based mass into a luma buffer: the shape D97 removed, as a
 * pure transform, so the negative control runs without a browser.
 */
export function paintFlatBase(grey, w, h, { x0, x1, yTop, yBase, value = 28 }) {
  const out = Uint8Array.from(grey);
  for (let y = Math.max(0, yTop); y < Math.min(h, yBase); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) out[y * w + x] = value;
  }
  return out;
}

/** Composite a ring plane seen near edge-on - a form D97 ALLOWS. */
export function paintRingPlane(grey, w, h, { cx, cy, halfWidth, halfHeight, value = 28 }) {
  const out = Uint8Array.from(grey);
  for (let y = Math.max(0, cy - halfHeight); y <= Math.min(h - 1, cy + halfHeight); y += 1) {
    const dy = (y - cy) / halfHeight;
    if (Math.abs(dy) > 1) continue;
    const half = halfWidth * Math.sqrt(Math.max(0, 1 - dy * dy));
    for (let x = Math.max(0, Math.round(cx - half)); x <= Math.min(w - 1, Math.round(cx + half)); x += 1) {
      out[y * w + x] = value;
    }
  }
  return out;
}

/** Composite a planet limb - a huge arc with its body off-frame. Also allowed. */
export function paintLimb(grey, w, h, { cx, cy, radius, value = 34 }) {
  const out = Uint8Array.from(grey);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) out[y * w + x] = value;
    }
  }
  return out;
}
