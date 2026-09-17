/**
 * SILHOUETTE SEPARATION (AC-22.4, gauntlet item V-22.4).
 *
 * "With the colour taken away, can you still tell the rocket and the asteroids
 * from the background?"
 *
 * ---------------------------------------------------------------------------
 * TWO MEASURES LIVE HERE AND THE DIFFERENCE BETWEEN THEM IS THE POINT.
 *
 * `otsuRegionSeparation` is the measure this file replaces, kept ONLY so the
 * negative control can show what it misses. It desaturates the frame, picks a
 * global Otsu threshold, takes connected components in an object-sized area
 * band, and reports the weakest region-vs-surround luminance step. It has a
 * fatal property for this AC: **Otsu is adaptive**. Crush the play area to a
 * flat wash and Otsu simply re-splits what is left, finds its object-sized
 * regions somewhere else in the frame - terrain edges, sky banding, the HUD -
 * and reports a healthy number about parts of the picture nobody asked about.
 * The art lane measured a floor vignette that flattened the play area to a
 * 0.002 luminance step and this measure still scored it 0.239.
 *
 * The tempting fix is to move the threshold until 0.239 fails. That is how a
 * check becomes green and meaningless: it would then catch that one vignette
 * and nothing else, and it would fail healthy frames whose weakest terrain edge
 * happened to be soft. The defect is not the threshold. The defect is that the
 * measurement is free to wander to a different part of the image.
 *
 * `measureSilhouettes` is the replacement and it is POSITION-ANCHORED. It is
 * handed the coordinates the game itself reports for each rock and for the
 * ship, and it measures there: mean luminance in the object's core against mean
 * luminance in a ring just outside it. No threshold is chosen from the data, no
 * segmentation runs, nothing adapts. If the pixels where a rock is supposed to
 * be look like the pixels just outside it, the number is small - whatever the
 * rest of the frame is doing, and whatever the histogram looks like.
 *
 * It answers the AC's actual question, which the region count never could: not
 * "does this frame contain some shapes" but "is THIS ROCK visible".
 *
 * ---------------------------------------------------------------------------
 * PURE ON PURPOSE. Nothing here touches a browser, a canvas or the filesystem.
 * `tests/e2e/flight.spec.ts` feeds it a real frame and the live rock positions;
 * `tests/unit/gauntlet/silhouette.test.ts` feeds it synthetic frames including
 * a crushed one, and asserts the crushed one FAILS while `otsuRegionSeparation`
 * on the identical pixels still passes. That pair is the negative control, it
 * runs in vitest in milliseconds, and it needs no browser to re-run.
 */

/** ITU-R BT.601 luma, the same weights the frame grabber uses. */
export function toGrey(rgba, w, h) {
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < grey.length; i += 1) {
    grey[i] = Math.round(
      0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2],
    );
  }
  return grey;
}

/**
 * Geometry, as fractions of an object's radius. Fixed constants, not tuned
 * against any frame:
 *   CORE   the inner disc that is unambiguously the object, clear of its own
 *          antialiased edge.
 *   GAP    where the edge lives. Sampled by neither side, so a soft outline
 *          neither helps nor hurts the reading.
 *   RING   the background the eye compares the object against.
 */
export const CORE = 0.45;
export const RING_INNER = 1.15;
export const RING_OUTER = 1.75;
/** Below this many pixels on either side, the reading is noise, not a reading. */
export const MIN_SAMPLES = 24;

const inBox = (x, y, b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/**
 * Measure each object where the game says it is.
 *
 * @param {object} input
 * @param {Uint8Array} input.grey      luma buffer, row-major
 * @param {number} input.w
 * @param {number} input.h
 * @param {{id:string,kind:string,cx:number,cy:number,r:number}[]} input.objects
 *        centres and radii IN BUFFER PIXELS
 * @param {{x0:number,y0:number,x1:number,y1:number}[]} [input.exclude]
 *        regions the ring must not sample - word plates, HUD, anything that is
 *        neither the object nor its background
 */
export function measureSilhouettes({ grey, w, h, objects, exclude = [] }) {
  const measured = [];
  const unmeasurable = [];

  for (const o of objects) {
    const core = o.r * CORE;
    const ringIn = o.r * RING_INNER;
    const ringOut = o.r * RING_OUTER;
    const x0 = Math.max(0, Math.floor(o.cx - ringOut));
    const x1 = Math.min(w - 1, Math.ceil(o.cx + ringOut));
    const y0 = Math.max(0, Math.floor(o.cy - ringOut));
    const y1 = Math.min(h - 1, Math.ceil(o.cy + ringOut));

    let inSum = 0;
    let inN = 0;
    let outSum = 0;
    let outN = 0;

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - o.cx;
        const dy = y - o.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const v = grey[y * w + x];
        if (d <= core) {
          inSum += v;
          inN += 1;
          continue;
        }
        if (d < ringIn || d > ringOut) continue;
        // The ring is BACKGROUND. Another object sitting in it is not
        // background, and neither is a word plate: letting either in would let
        // two rocks overlapping each other read as one rock against the sky.
        let blocked = false;
        for (const other of objects) {
          if (other === o) continue;
          const ox = x - other.cx;
          const oy = y - other.cy;
          if (Math.sqrt(ox * ox + oy * oy) <= other.r * RING_INNER) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          for (const b of exclude) {
            if (inBox(x, y, b)) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;
        outSum += v;
        outN += 1;
      }
    }

    if (inN < MIN_SAMPLES || outN < MIN_SAMPLES) {
      unmeasurable.push({ id: o.id, kind: o.kind, samplesIn: inN, samplesOut: outN });
      continue;
    }
    const inside = inSum / inN;
    const outside = outSum / outN;
    measured.push({
      id: o.id,
      kind: o.kind,
      at: { x: Math.round(o.cx), y: Math.round(o.cy) },
      r: Math.round(o.r),
      inside: Number(inside.toFixed(1)),
      outside: Number(outside.toFixed(1)),
      separation: Number((Math.abs(inside - outside) / 255).toFixed(4)),
      samplesIn: inN,
      samplesOut: outN,
    });
  }

  const separations = measured.map((m) => m.separation);
  return {
    objects: measured,
    unmeasurable,
    objectsMeasured: measured.length,
    minSeparation: separations.length === 0 ? 0 : Math.min(...separations),
    weakest: measured.reduce((a, b) => (a === null || b.separation < a.separation ? b : a), null),
  };
}

/**
 * Apply a floor vignette to a luma buffer: the exact regression the art lane
 * found, as a pure transform so the control can be re-run without a browser.
 *
 * `strength` 1 collapses the affected band onto its own mean, which is what a
 * heavy darkening wash does to a silhouette - everything in it becomes one
 * value and nothing reads. `fromY` is where the wash starts, as a fraction of
 * frame height.
 */
export function crushBand(grey, w, h, { fromY = 0.55, strength = 1 } = {}) {
  const out = Uint8Array.from(grey);
  const start = Math.floor(h * fromY);
  let sum = 0;
  let n = 0;
  for (let i = start * w; i < w * h; i += 1) {
    sum += grey[i];
    n += 1;
  }
  const mean = n === 0 ? 0 : sum / n;
  for (let y = start; y < h; y += 1) {
    // Ramped, like a real vignette: untouched at the top of the band, fully
    // crushed at the bottom edge of the frame.
    const t = (y - start) / Math.max(1, h - 1 - start);
    const k = Math.min(1, strength * t);
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      out[i] = Math.round(grey[i] * (1 - k) + mean * k);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The superseded measure, kept only so the control can show what it misses
// ---------------------------------------------------------------------------

/** Otsu's threshold: the split that maximises between-class variance. */
export function otsuThreshold(grey) {
  const hist = new Array(256).fill(0);
  for (const v of grey) hist[v] += 1;
  const total = grey.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * THE MEASURE V-22.4 USED TO RUN. Do not use it for anything but the control.
 *
 * Global Otsu, connected components in an object-sized area band, mean
 * luminance inside each region against a 6 px ring outside its bounding box.
 * Adaptive, and therefore free to answer about a different part of the frame
 * than the one that broke.
 */
export function otsuRegionSeparation({ grey, w, h, minArea = 250, maxArea = 9000, pad = 6 }) {
  const threshold = otsuThreshold(grey);
  const label = new Int32Array(w * h).fill(-1);
  const regions = [];
  const stack = [];
  for (let start = 0; start < w * h; start += 1) {
    if (label[start] !== -1) continue;
    const cls = grey[start] > threshold ? 1 : 0;
    const id = regions.length;
    const members = [];
    stack.length = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const p = stack.pop();
      members.push(p);
      const x = p % w;
      const y = (p - x) / w;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of neighbours) {
        if (q < 0 || label[q] !== -1) continue;
        if ((grey[q] > threshold ? 1 : 0) !== cls) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    regions.push(null);
    if (members.length < minArea || members.length > maxArea) continue;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let touchesEdge = false;
    for (const p of members) {
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (touchesEdge) continue;
    let insideSum = 0;
    for (const p of members) insideSum += grey[p];
    let outSum = 0;
    let outN = 0;
    for (let y = Math.max(0, minY - pad); y <= Math.min(h - 1, maxY + pad); y += 1) {
      for (let x = Math.max(0, minX - pad); x <= Math.min(w - 1, maxX + pad); x += 1) {
        const p = y * w + x;
        if (label[p] === id) continue;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
        outSum += grey[p];
        outN += 1;
      }
    }
    if (outN === 0) continue;
    const inside = insideSum / members.length;
    const outside = outSum / outN;
    regions[id] = {
      area: members.length,
      at: Number((((minY + maxY) / 2) / h).toFixed(3)),
      separation: Number((Math.abs(inside - outside) / 255).toFixed(4)),
    };
  }
  const kept = regions.filter((r) => r !== null);
  return {
    threshold,
    regions: kept,
    regionsMeasured: kept.length,
    minSeparation: kept.length === 0 ? 0 : Math.min(...kept.map((r) => r.separation)),
  };
}
