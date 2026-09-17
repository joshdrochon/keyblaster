import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { hexToNum, mixHex, paletteAt, skyStops } from "@game/render/palette";
import type { StopId } from "@engine/types";

/**
 * THE PIXELS BEHIND THE GAME CANVAS (AC-18.1, AC-22.9, FR-8, D99).
 *
 * ================== READ THIS FIRST: THERE IS NO LETTERBOX ==================
 * This file was written to FILL a letterbox, and there is no longer one to
 * fill. The game used to lay out at a fixed 1920x1080 and scale with
 * `Phaser.Scale.FIT`, so any window that was not 16:9 got a gap. D99 removed
 * the condition instead of the colour: `GAME_WIDTH` is now the window's own
 * aspect at a pinned 1080 height (`sceneKeys`, which carries that reasoning),
 * so `FIT` has nothing left to letterbox.
 *
 * What this file still does, and why it was not deleted:
 *
 *   - the design width is ROUNDED to an integer, which can leave up to about
 *     one device-independent pixel of slack; this owns that pixel
 *   - during a window drag there is a moment between the browser resizing the
 *     canvas and `boot.followWindowSize`'s debounced relayout landing, and
 *     this is what is behind the canvas in that moment
 *   - it costs nothing per frame: it repaints on a stop change and on resize,
 *     never on a tick (AC-22.9)
 *
 * ================== THE FIVE FIXES THAT WERE NOT FIXES ==================
 * Kept because the reasoning is what stopped the sixth attempt repeating them.
 * The bars were reported six times. Each fix answered "what colour should the
 * gap be", which is the wrong question:
 *
 *   1. the game was centred twice, so the bars were 3:1 - a real bug, fixed,
 *      and the bars were then symmetric and still bars
 *   2. the gap was painted with the stop's sky gradient (below) - a bright bar
 *      beside a dark picture, rgb(16,41,80) against rgb(5,10,18) at y=300
 *   3. the frame's outermost 1px column was stretched outward - the seam
 *      closed to a delta of 1-2 and a 1px column stretched 100px wide is a
 *      flat band next to a textured picture
 *   4. the whole frame was drawn cover-scaled into the gap - the magnified
 *      copy has its OWN boundary, so a new vertical edge appeared at the join
 *   5. that copy was dimmed to 0.92 - the alpha step became the visible line
 *
 * ================== WHY NOT THE OTHER SCALE MODES ==================
 *   Scale.ENVELOP, accepting overscan. One line, and it CUTS THE HUD OFF. At
 *   21:9 it scales to width and crops about 24% of the height, top and bottom
 *   - which is exactly where the score, the hull marks and every screen's
 *   hint line live. AC-18.1 wants every control reachable; a control scrolled
 *   off the top of the screen is not. This is why the world could not simply
 *   be cropped to fill.
 *
 *   A TALLER world would break FR-8: the fall time is
 *   `len x keystrokeBudget + recognitionBudget` against a FIXED fall distance,
 *   so a taller world hands the player more seconds for the same word. This is
 *   why only the WIDTH flexes.
 *
 * ================== WHAT IT DRAWS ==================
 * A canvas behind the game canvas, filling the window, carrying the CURRENT
 * STOP'S sky: the same three gradient stops `render/parallax.ts` uses for the
 * `sky` layer, laid out against the SAME design rect, so the bar and the game
 * are the same colour where they meet. Over it, a seeded starfield tinted the
 * way the `celestial` layer tints its own.
 *
 * There is deliberately no vignette and no lightening of the dark end. The
 * first version had both, and the result was a clean seam down the side of the
 * play-field: the bars had stopped being black and started being a frame,
 * which is a different defect with the same cause. At 16:10 the bottom bar is
 * therefore nearly black - correctly, because the game's own sky ends in the
 * palette's void colour exactly there, and the bar is that void continuing.
 *
 * All of it is drawn in code (D83). No raster is referenced, here or anywhere.
 *
 * COSTS NOTHING PER FRAME (AC-22.9). It repaints on two events only - the stop
 * changed, or the window was resized - never on a tick. There is no animation
 * in the bars on purpose: something moving out at the edge of vision, beside a
 * play-field that is asking for the player's attention, is a distraction with a
 * frame budget attached.
 */

/** Stars per million device-independent pixels. Sparse: this is peripheral. */
const STAR_DENSITY = 34;

/** mulberry32, same generator `render/parallax.ts` uses. Seeded, so the field
 * is identical across repaints and a screenshot test compares like with like. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ViewportBackdrop {
  /** Dress the bars in a stop's sky. Repaints only if the stop changed. */
  setStop(stopId: StopId): void;
  /** Repaint at the current window size. Called on resize; idempotent. */
  refresh(): void;
  /** What the bars are showing, for the aspect-ratio e2e. */
  debug(): {
    stopId: StopId;
    /** Device-independent px of bar on each side. 0 at exactly 16:9. */
    barX: number;
    barY: number;
    width: number;
    height: number;
  };
  destroy(): void;
}

export interface ViewportBackdropOptions {
  /**
   * Read LIVE, not captured. `SceneContext.colorblindPalette` is mutable and
   * the settings screen flips it mid-session; a boolean copied at boot would
   * leave the bars wearing the palette the game started in while the
   * play-field wore the new one, which is a seam with a two-hour fuse.
   */
  readonly colorblind?: () => boolean;
  /** Injected in tests. Defaults to the real window. */
  readonly view?: { innerWidth: number; innerHeight: number };
}

/**
 * Put a full-window sky behind the game canvas.
 *
 * Installed by `boot.ts` BEFORE Phaser creates its canvas, so the backdrop is
 * the first child of `#app`. DOM order is not enough on its own though - see
 * the z-index note below, which is the difference between a sky behind the
 * game and a sky on top of it.
 */
export function installViewportBackdrop(
  parent: HTMLElement,
  options: ViewportBackdropOptions = {},
): ViewportBackdrop {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("data-testid", "viewport-backdrop");
  canvas.setAttribute("aria-hidden", "true");
  // `z-index:-1`, not 0. `#app` is a grid with `place-items:center` and the
  // game canvas is a plain grid item, so it has no z-index of its own - and a
  // POSITIONED element at z-index 0 paints above a non-positioned sibling.
  // At 0 this backdrop covered the entire game. `#app` is `position:fixed`,
  // which is its own stacking context, so -1 puts the sky behind the game and
  // still in front of the page background rather than behind the document.
  canvas.setAttribute(
    "style",
    "position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;",
  );
  parent.insertBefore(canvas, parent.firstChild);

  let stopId: StopId = "earth";
  let painted = "";
  let frame = 0;

  const view = options.view ?? window;
  const colorblind = (): boolean => options.colorblind?.() ?? false;

  const size = (): { w: number; h: number; dpr: number } => {
    const w = Math.max(1, Math.round(view.innerWidth));
    const h = Math.max(1, Math.round(view.innerHeight));
    // Capped: on a 3x phone-class DPR a full-window canvas is a lot of pixels
    // for something nobody looks at directly, and this must not cost frames.
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    return { w, h, dpr };
  };

  /**
   * Where `Scale.FIT` puts the design rect, in CSS pixels.
   *
   * The same arithmetic Phaser does: scale by whichever of the two ratios is
   * smaller, centre the result, and the slack in the other axis is the bar.
   * Exactly one axis has slack unless the window is exactly 16:9.
   */
  const designRect = (
    w: number,
    h: number,
  ): { x: number; y: number; w: number; h: number } => {
    const scale = Math.min(w / GAME_WIDTH, h / GAME_HEIGHT);
    const rw = GAME_WIDTH * scale;
    const rh = GAME_HEIGHT * scale;
    return { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh };
  };

  /** How much bar is left on each side. Zero at exactly 16:9. */
  const bars = (w: number, h: number): { x: number; y: number } => {
    const rect = designRect(w, h);
    return { x: Math.max(0, rect.x), y: Math.max(0, rect.y) };
  };

  const paint = (): void => {
    const { w, h, dpr } = size();
    const key = `${stopId}:${w}x${h}@${dpr}:${colorblind()}`;
    if (key === painted) return;
    painted = key;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const palette = paletteAt(stopId, colorblind());
    const [top, mid, deep] = skyStops(palette);

    /**
     * THE SKY, AND IT IS THE SAME SKY.
     *
     * The gradient is laid out against the DESIGN RECT, not the window, with
     * the three stops at 0 / 0.5 / 1 - which is exactly what
     * `render/parallax.ts`'s `gradient()` does for the `sky` layer inside the
     * game. So at the canvas edge the two are the same colour and the bar is a
     * continuation rather than a second, darker sky sitting next to the first.
     *
     * Getting this wrong is visible immediately: the first version used the
     * window height and added a vignette, and the result was a clean seam down
     * the side of the play-field - the bars had stopped being black and started
     * being a frame, which is a different defect with the same cause.
     *
     * A canvas gradient clamps outside its endpoints, so the bar beyond the
     * design rect holds the end colour and the join stays seamless.
     */
    const rect = designRect(w, h);
    const sky = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    sky.addColorStop(0, top);
    sky.addColorStop(0.5, mid);
    sky.addColorStop(1, deep);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /**
     * NO BLEED HERE ANY MORE, and the reason is worth keeping.
     *
     * Two versions were tried and both made it worse. Stretching the frame's
     * outermost COLUMN closed the seam (delta 1-2) and still read as a bar,
     * because a 1px column stretched 100px wide is a flat band next to a
     * textured picture. Drawing the whole frame COVER-scaled fixed the flatness
     * and introduced a new edge: the magnified copy has its own boundary where
     * it meets the real canvas, visible as a vertical line at the letterbox
     * join.
     *
     * Every one of those attempts — and the sky gradient below — answers the
     * question "what colour should the bar be". That is the wrong question. The
     * bar should not exist. See D99: the scale mode is what creates it, and
     * decorating it is how this defect survived five reports.
     */

    // Stars, tinted the way the `celestial` layer tints its own
    // (`mixHex(skyStops[0], white, 0.75)`), so the two fields are one field.
    // Seeded off the stop, so each planet's bars differ and a repaint is not a
    // twinkle - nothing out here moves (AC-22.9: this costs no frames).
    const random = rng(hexToNum(palette.accent) ^ 0x5bf03);
    const count = Math.round((w * h * STAR_DENSITY) / 1_000_000);
    const star = mixHex(top, "#FFFFFF", 0.75);
    ctx.fillStyle = star;
    for (let i = 0; i < count; i += 1) {
      const x = random() * w;
      const y = random() * h;
      const r = 0.5 + random() * 1.3;
      ctx.globalAlpha = 0.14 + random() * 0.42;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Repaints, and then repaints again once the game has actually drawn.
   *
   * The edge bleed copies the game canvas's outermost column, so it needs a
   * rendered frame to copy. A stop change fires the repaint BEFORE the new
   * scene's first frame exists, so a single rAF hop copies a blank canvas and
   * the bar falls back to plain sky — which is the defect, silently.
   *
   * `settleFrames` follow-up repaints cover the scene's own fade-in as well:
   * the edge column is still changing while a screen arrives, and the bar
   * should end up matching where it settles, not where it started.
   */
  const SETTLE_FRAMES = 6;
  let settle = 0;
  const schedule = (): void => {
    settle = SETTLE_FRAMES;
    if (frame !== 0) return;
    const step = (): void => {
      frame = 0;
      paint();
      if (settle > 0) {
        settle -= 1;
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
  };

  const onResize = (): void => schedule();
  window.addEventListener("resize", onResize);
  paint();

  return {
    setStop(next: StopId): void {
      if (next === stopId) return;
      stopId = next;
      schedule();
    },
    refresh(): void {
      schedule();
    },
    debug() {
      const { w, h } = size();
      const bar = bars(w, h);
      return { stopId, barX: bar.x, barY: bar.y, width: w, height: h };
    },
    destroy(): void {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) cancelAnimationFrame(frame);
      canvas.remove();
    },
  };
}
