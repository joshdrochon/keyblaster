/**
 * Scene registry contract (D78, design-brief-v2.md "Screen inventory").
 *
 * trace-check enforces both directions: a scene file with no inventory row
 * fails, and an inventory row with no scene fails. This file is the single
 * place the two are reconciled, so parallel scene lanes agree on keys without
 * touching each other's files.
 *
 * The `inventoryRow` string must match the design brief's row text exactly.
 */

export const SCENE_KEYS = {
  boot: "Boot",
  title: "Title",
  profilePicker: "ProfilePicker",
  profileCreate: "ProfileCreate",
  earthActivation: "EarthActivation",
  map: "DirectorMap",
  briefing: "Briefing",
  preflight: "Preflight",
  flight: "Flight",
  stall: "Stall",
  warp: "Warp",
  beacon: "Beacon",
  results: "Results",
  beaconLog: "BeaconLog",
  settings: "Settings",
  ending: "Ending",
  pause: "Pause",
  hud: "Hud",
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

// ---------------------------------------------------------------------------
// The world's size (D81, D99)
// ---------------------------------------------------------------------------

/**
 * THE HEIGHT IS PINNED AND THE WIDTH IS NOT. Read this before using either.
 *
 * ================== WHY THE WIDTH MOVES ==================
 * The game was laid out at a fixed 1920x1080 and scaled with
 * `Phaser.Scale.FIT`, so every window that is not exactly 16:9 got a gap: on
 * the 2000x1010 window this was reported from, 102 px of bar on each side.
 * That defect was reported SIX times and fixed five times, and every one of
 * those fixes answered the question "what colour should the gap be" - the
 * stop's sky gradient, the outermost column stretched outward, the whole frame
 * drawn cover-scaled, that copy dimmed to 0.92. Each produced a different
 * visible artefact and none of them removed the gap, because the gap is made
 * by fitting a fixed 16:9 rect into a window that is not 16:9.
 *
 * So the rect is no longer fixed. `GAME_WIDTH` is the window's own aspect at
 * 1080 height, which leaves `FIT` with nothing to letterbox.
 *
 * ================== WHY THE HEIGHT DOES NOT ==================
 * FR-8's fall time is `len x keystrokeBudget + recognitionBudget` measured
 * against a FIXED fall distance. A taller world would hand the player more
 * seconds for the same word and the budget would stop meaning one thing.
 * Flexing the width touches none of that: a word falls the same 1080 px
 * whatever shape the window is.
 *
 * `Scale.ENVELOP` was the other way to fill the window, and it crops - about
 * 24% of the height at 21:9, which is exactly where the score, the hull marks
 * and every screen's hint line live. AC-18.1 wants every control reachable.
 *
 * ================== HOW TO USE `GAME_WIDTH` ==================
 * It is a LIVE BINDING. Importers see the current value, so:
 *
 *   OK      function draw() { g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); }
 *   OK      const x = GAME_WIDTH / 2   // inside create() / a method
 *   BROKEN  const RIGHT = GAME_WIDTH - 48   // at module top level
 *
 * A top-level `const` captures the value at module-init time, which is before
 * `bootGame` has measured the window, and freezes it at 1920 forever. Three of
 * those existed when this landed (`ui/layout.RIGHT_EDGE`,
 * `DirectorMapScene.ROUTE_X1`/`PANEL`, `EarthActivationScene.BEACON_X`) and
 * all three are now computed at draw time. `GAME_HEIGHT` is safe to capture at
 * any depth; it never changes.
 *
 * At runtime `GAME_WIDTH === scene.scale.width === camera.width`, by
 * construction, so a full-bleed background drawn to either is correct.
 */

/**
 * The art-direction artboard width (D81). This is what the comps in
 * `design-reference/ui/` are drawn at, and it is the width the world has on a
 * 16:9 window. It is the reference, NOT the runtime width - use `GAME_WIDTH`.
 */
export const DESIGN_WIDTH = 1920;

/** Pinned by FR-8. See the note above. */
export const GAME_HEIGHT = 1080;

/**
 * How far the world is allowed to flex, as window-aspect bounds.
 *
 * ================== THE FLOOR IS 16:9, AND IT IS MEASURED ==================
 * The world may get WIDER than the artboard. It may not get NARROWER, and
 * this is the one number in this file that was not a judgement call.
 *
 * A first cut let the world narrow to 4:3 so that a 4:3 window would also fill
 * edge to edge. Booted at that size and every visible object's bounds read off
 * the live scene tree, three screens ran off the right edge:
 *
 *   world 1440 (4:3)    Beacon Log +384 px   Results +272   Briefing +168
 *   world 1728 (16:10)  Beacon Log  +96 px   Results   +3
 *   world 1920 and up   nothing overflows
 *
 * The Beacon Log's trophy block is 3 x 340 + 2 x 24 starting at 708, so it
 * needs 1776 px whatever the window is; the block cannot be squeezed without a
 * real layout pass on that screen. Content off the right edge is CROPPED
 * content, which is precisely the failure `Scale.ENVELOP` was rejected for
 * under AC-18.1 - a control a child cannot reach is not reachable because the
 * cropping happened sideways instead of vertically.
 *
 * So below 16:9 the world stops narrowing and `FIT` letterboxes top and bottom
 * again, and `ui/viewportBackdrop.ts` paints the stop's sky there. That is the
 * right way round to fail: a bar at the top of a 4:3 window beats a trophy a
 * child cannot see. Raising this floor is a LAYOUT job on those three screens,
 * not a change to this constant - lowering it alone re-crops them, which
 * tests/e2e/aspect.spec.ts asserts against directly. Logged in
 * gauntlet/escalations.md.
 *
 * ================== THE CEILING ==================
 * 32:9 is a doubled 16:9, the widest monitor sold. Past it a menu column
 * pinned to one edge and Shadow pinned to the other stop being one
 * composition, and the world stops widening.
 */
export const MIN_ASPECT = 16 / 9;
export const MAX_ASPECT = 32 / 9;

/**
 * The world width for a window, in design px. Pure; unit-tested.
 *
 * A degenerate viewport (0, NaN, a hidden tab) falls back to the artboard
 * width rather than producing a 0-wide world nothing can be drawn in.
 */
export function designWidthFor(viewWidth: number, viewHeight: number): number {
  if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight)) return DESIGN_WIDTH;
  if (viewWidth <= 0 || viewHeight <= 0) return DESIGN_WIDTH;
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, viewWidth / viewHeight));
  return Math.round(GAME_HEIGHT * aspect);
}

// ---------------------------------------------------------------------------
// The world's RESOLUTION (UR-18), which is not the world's SIZE
// ---------------------------------------------------------------------------

/**
 * THE BUFFER SCALES WITH THE SCREEN. THE DESIGN SPACE DOES NOT. Both halves.
 *
 * `designWidthFor` above answers "how many design pixels wide is the world".
 * This answers a different question that had never been asked: "how many REAL
 * pixels do we rasterise those design pixels into". They were the same number,
 * which is the whole defect - the canvas drew 1920x1080 whatever the display,
 * so on a 2x screen a 1440 CSS-px canvas covering 2880 physical pixels was fed
 * 1920 and the browser upscaled it ~1.5x. Every edge and every glyph soft.
 *
 * All the art here is vector drawn in code (D83), so it is pixel-perfect at
 * any resolution; nothing was ever asking for one.
 *
 * NOTHING ABOUT THE DESIGN SPACE MOVES. `GAME_WIDTH` and `GAME_HEIGHT` are
 * untouched by this, deliberately and by test: FR-8's fall distance, every
 * scene's constants and the MIN_ASPECT lane guards all measure in design px.
 * What changes is only the size of the drawing buffer those design px are
 * rasterised into - see `installPixelDensity` in boot.ts for the mechanism.
 *
 * ================== WHY NOT JUST `devicePixelRatio` ==================
 * DPR is the wrong number: it describes the SCREEN, not the canvas. `FIT`
 * fits the world into the window, so the canvas is usually smaller than the
 * world already - a 1920 world in a 1440 CSS-px box at DPR 1 is 1440 physical
 * pixels being handed 1920, which is downsampling and already sharp. Asking
 * for `dpr` there would render 2x the pixels for no visible gain.
 *
 * The number that matters is how many PHYSICAL pixels the canvas occupies:
 * `cssWidth * dpr`. We ask for exactly that and never more, which is also the
 * perf answer (see the cap below).
 *
 * ================== THE FLOOR IS 1 ==================
 * Never below 1. A world downsampled into a smaller canvas is already sharp,
 * and rendering BELOW the design size would be a new softness bug wearing this
 * fix's clothes.
 */
export const MIN_RENDER_SCALE = 1;

/**
 * The cap, and it is an AREA because the constraint is an area (UR-35).
 *
 * ================== THE RATIO THAT WAS HERE WAS WRONG ==================
 * This used to be `MAX_RENDER_SCALE = 2`, a ratio from design px to buffer px,
 * justified with "3 would buy nothing a child can see on any shipping
 * display". THAT SENTENCE WAS FALSE, and it is quoted here rather than quietly
 * deleted because it read as measured and was not. Measured since, against the
 * real pre-fix build, as 10-90% glyph edge rise in physical pixels:
 *
 *   FIXED    1440x810 DSF2   upscale 1.00   rise p25 0.83   <- native
 *   FIXED    1440x810 DSF1   upscale 0.75   rise p25 0.85   <- native reference
 *   FIXED    2560x1440 DSF2  upscale 1.33   rise p25 1.56   <- STILL BLURRED
 *   PRE-FIX  1440x810 DSF2   upscale 1.50   rise p25 1.60   <- the filed defect
 *
 * On a 5K Studio Display or a retina iMac, the capped build was as soft as the
 * build the user filed the complaint about. Going past 2 there buys exactly
 * the difference between the complaint and the fix.
 *
 * ================== WHY A RATIO CANNOT EXPRESS THIS ==================
 * The thing we are protecting is "how many fragments per frame", which is an
 * area. A ratio measured against a design width that itself grows with the
 * window is not that, and it produced an incoherent budget: at 32:9 a ratio of
 * 2 already permitted 7680x2160 = 16.6 Mpx, while refusing a 16:9 5K display
 * the 14.7 Mpx it needed. It was declining a SMALLER frame than it already
 * allowed, purely because of the shape of the window.
 *
 * ================== WHERE THE NUMBER COMES FROM ==================
 * It is that same 16.6 Mpx: the widest world (32:9 -> 3840 design px) at the
 * old ratio of 2. Taking the old rule's own theoretical maximum as the new
 * absolute budget means no window can now ask for a frame the previous code
 * would have rejected as too expensive - it can only ask for one the previous
 * code rejected for the wrong reason.
 *
 * BE PRECISE ABOUT WHAT THAT DOES AND DOES NOT CLAIM. It is a bound on the
 * theoretical worst case, not on the practically-reached one. In practice this
 * DOES increase fill on big displays, which is the entire point:
 *
 *   5K 16:9 @ DSF2       8.3 Mpx -> 14.7 Mpx   (and stops being blurry)
 *   6K XDR @ DSF2        8.3 Mpx -> 16.6 Mpx   (capped; 1.10x residual)
 *   32:9 5120x1440 DPR1  7.4 Mpx -> 7.4 Mpx    (unchanged, already 1:1)
 *   2x laptop @ 1440 CSS 4.7 Mpx -> 4.7 Mpx    (unchanged, already 1:1)
 *
 * WHAT WOULD FALSIFY THIS: a headed p95 capture of the SCRIPTED FLIGHT - warp
 * streaks plus a full rock population, the fill-heaviest moment in the game -
 * exceeding 16.7 ms at 14.7 Mpx on target hardware. That measurement does not
 * exist yet; the only real-GPU number we have is a critic's 6.8 ms median at
 * 11.1 Mpx on a default `?scene=Flight`, which is not the fill-heavy case and
 * is one machine. If it falsifies, this constant is the single thing to lower
 * and `worldSize.test.ts` already sweeps every aspect against it.
 * Logged in gauntlet/escalations.md.
 */
export const MAX_BUFFER_PIXELS = Math.round(GAME_HEIGHT * MAX_ASPECT) * GAME_HEIGHT * 4;

/**
 * How many real pixels per design pixel, for a canvas of `cssWidth` CSS px on
 * a display of `dpr`. Pure; unit-tested.
 *
 * Quantised UP to quarter steps. Two reasons, both measured rather than
 * stylistic: a window drag changes `cssWidth` by a pixel at a time and every
 * distinct value reallocates the WebGL drawing buffer, and rounding up can
 * only ever ask for more pixels than the screen has, never fewer - the
 * direction that cannot reintroduce softness.
 */
export function renderScaleFor(designWidth: number, cssWidth: number, dpr: number): number {
  if (!Number.isFinite(designWidth) || designWidth <= 0) return MIN_RENDER_SCALE;
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) return MIN_RENDER_SCALE;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const want = (cssWidth * ratio) / designWidth;
  const quantised = Math.ceil(want * 4) / 4;
  /**
   * The budget, as a scale. The world is `designWidth x GAME_HEIGHT` design
   * px, so a scale of `s` costs `designWidth * GAME_HEIGHT * s^2` fragments;
   * inverting that for the budget gives the largest `s` we can afford. Not
   * quantised: it is a function of the design width alone, which only changes
   * when the window's ASPECT changes, so it cannot churn the buffer during a
   * drag the way an unquantised `want` would.
   */
  const maxByArea = Math.sqrt(MAX_BUFFER_PIXELS / (designWidth * GAME_HEIGHT));
  // The floor wins over the budget. A buffer below the design size would be a
  // new softness bug wearing this fix's clothes, not a saving.
  return Math.max(MIN_RENDER_SCALE, Math.min(quantised, maxByArea));
}

/**
 * The resolution a Phaser `Text` object should rasterise its own texture at.
 *
 * Text is NOT vector at draw time. Every `Text` renders its string to a
 * private canvas texture at `style.resolution` and the WebGL renderer then
 * draws that texture at `width / resolution` (Phaser's TextWebGLRenderer), so
 * the display size is resolution-independent and a bigger drawing buffer on
 * its own leaves every WORD exactly as soft as it was. Sharpening the canvas
 * without this fixes the edges of shapes and nothing a child reads.
 *
 * Rounded UP to a whole number rather than tracking the buffer scale exactly.
 * `canvas.width = w * resolution` truncates to an integer, so a fractional
 * resolution leaves the glyph texture and the frame's UVs disagreeing by up to
 * a pixel - a clipped right-hand column on some strings. A whole number cannot
 * do that, and the cost of supersampling text slightly past the buffer is a
 * few small textures.
 *
 * UR-35: this follows the buffer up to 3 now, because the buffer goes to 2.83
 * at the narrowest world. It has to follow, or a 5K display gets sharp SHAPES
 * and soft WORDS - which is most of what a child is actually looking at, and
 * would be the original complaint surviving in the half that matters most.
 */
export function textResolutionFor(renderScale: number): number {
  if (!Number.isFinite(renderScale) || renderScale <= 1) return 1;
  // The ceiling is what the area budget can actually produce, so this can
  // never ask for a texture density the buffer would not use.
  const maxScale = Math.sqrt(MAX_BUFFER_PIXELS / (DESIGN_WIDTH * GAME_HEIGHT));
  return Math.min(Math.ceil(maxScale), Math.ceil(renderScale));
}

/**
 * The world's width right now. Live binding - see the note above.
 *
 * Opens at the artboard width so anything that reads it before `bootGame` has
 * measured a window (a unit test, a scene constructed in Node) sees 1920.
 */
export let GAME_WIDTH: number = DESIGN_WIDTH;

/**
 * Set the world width. Called by `bootGame` and by nothing else in the game -
 * a scene that wants to change the world's size wants a different design.
 *
 * Returns the value actually applied, so the caller can hand the same number
 * to `Phaser.Scale.setGameSize` instead of rounding it a second time and
 * disagreeing by a pixel.
 */
export function setGameWidth(px: number): number {
  GAME_WIDTH = Math.max(1, Math.round(px));
  return GAME_WIDTH;
}

/**
 * Every scene reads and writes this. It is deliberately NOT the engine's
 * GameState: scenes own presentation, the engine owns rules (architecture §2).
 */
export interface SceneContext {
  /** Active profile id, or null before one is chosen. */
  profileId: string | null;
  /** Stop the player is travelling to, for briefing/flight/warp/beacon. */
  stopId: string | null;
  /** Set by Settings; scenes must honour it (D41, AC-19.3). */
  reducedMotion: boolean;
  colorblindPalette: boolean;
}

export const DEFAULT_SCENE_CONTEXT: SceneContext = {
  profileId: null,
  stopId: null,
  reducedMotion: false,
  colorblindPalette: false,
};

/**
 * Scene -> screen-inventory row (D78). The row text must match
 * docs/design-brief-v2.md's "Screen inventory" table EXACTLY.
 *
 * This map exists because scene names are legitimately shorter than row labels
 * ("Warp" vs "Warp break") and one scene can serve a row it does not share a
 * name with. Fuzzy name matching either rejects correct scenes or accepts
 * anything; a declared map makes adding a scene force you to say which row it
 * satisfies, which is the whole point of D78.
 */
export const SCENE_INVENTORY_ROW: Record<SceneKey, string> = {
  Boot: "",
  Title: "Title",
  ProfilePicker: "Profile picker",
  ProfileCreate: "Profile create",
  EarthActivation: "Earth activation",
  DirectorMap: "Director map",
  Briefing: "Briefing",
  Preflight: "Pre-flight",
  Flight: "Flight",
  Stall: "Stall card",
  Warp: "Warp break",
  Beacon: "Beacon placement",
  Results: "Results",
  BeaconLog: "Beacon Log",
  Settings: "Settings",
  Ending: "Ending card",
  Pause: "Pause",
  // The HUD is an overlay scene layered on Flight (art-direction L7), not a
  // screen of its own. It satisfies row 6 alongside FlightScene.
  Hud: "Flight",
};

/**
 * Inventory rows that are deliberately NOT Phaser scenes. Each needs a reason:
 * an unexplained exemption is how a completeness check stops meaning anything.
 */
export const NON_SCENE_ROWS: Record<string, string> = {
  Toasts: "non-blocking overlay drawn by the UI kit over whatever scene is live",
  "Reset confirm": "modal drawn by the UI kit inside Settings",
  "Relative-board opt-in": "one-time prompt drawn inside Results",
  Transitions: "scored moments BETWEEN scenes; owned by the transition runner",
  Notices: "non-blocking line drawn by the UI kit; not a screen",
};
