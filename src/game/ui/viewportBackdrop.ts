import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { hexToNum, mixHex, paletteAt, skyStops } from "@game/render/palette";
import type { StopId } from "@engine/types";

/**
 * THE LETTERBOX (AC-18.1, AC-22.9, FR-8).
 *
 * The game is laid out at 1920x1080 and scaled with `Phaser.Scale.FIT`, so on
 * any window that is not 16:9 the canvas is letterboxed. On a 21:9 monitor that
 * is two black columns either side of the game, which reads as a broken page
 * rather than as a deliberate frame.
 *
 * ================== WHY FIT STAYED ==================
 * Three ways out, and only one of them is safe:
 *
 *   Scale.RESIZE, laying every screen out from the real viewport. Correct in
 *   the abstract, and it breaks the two things the brief says must not move.
 *   The flight play-field would change size with the window, and FR-8's fall
 *   time is `len x keystrokeBudget + recognitionBudget` against a FIXED fall
 *   distance - a taller window would hand the player more seconds for the same
 *   word, so the budget would stop meaning one thing. Eight scenes also read
 *   `this.scale.width` meaning "1920", and `FlightScene` drives
 *   `cameras.main.setScroll` itself for the camera sway, which fights any
 *   centring the fitter would need to do.
 *
 *   Scale.ENVELOP, accepting overscan. One line, and it CUTS THE HUD OFF. At
 *   21:9 it scales to width and crops about 24% of the height, top and bottom
 *   - which is exactly where the score, the hull marks and every screen's
 *   hint line live. AC-18.1 wants every control reachable; a control scrolled
 *   off the top of the screen is not.
 *
 *   FIT, and put art where the bars are. The play-field is untouched, every
 *   scene's coordinates still mean what they meant, the HUD cannot be cropped
 *   because the whole design rect is always on screen - and the black columns
 *   become sky. That is this file.
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

  const schedule = (): void => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
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
