/**
 * BOOT (D35 Phaser 3 WebGL, D81 1920x1080, architecture section 1).
 *
 * Small on purpose: five other scene lanes build on it. Everything it does:
 *
 *   1. builds the SceneContext from the URL, the OS and the saved profile
 *   2. creates the one game-layer service bundle scenes read (`services()`)
 *   3. DISCOVERS the scenes that exist and registers them under their
 *      SCENE_KEYS key, then starts one
 *   4. creates the Phaser.Game
 *
 * SCENE DISCOVERY, and why it is written this way. Scene lanes land in parallel,
 * so at any moment most of SCENE_KEYS has no file. `import.meta.glob` (lazy)
 * gives one dynamic import per file in `scenes/`, each awaited separately and
 * each failure caught, so a scene that does not exist YET - or one that throws
 * on import - costs that scene and nothing else. The title screen still boots.
 * A filename maps to a key by stripping `Scene.ts`: `TitleScene.ts` -> `Title`,
 * `DirectorMapScene.ts` -> `DirectorMap`. Anything that does not match a value
 * in SCENE_KEYS is skipped with a console warning rather than registered.
 *
 * THE PUBLIC SHAPE IS TWO THINGS: `bootGame()` and `services(scene)`.
 */

import Phaser from "phaser";
import {
  DEFAULT_SCENE_CONTEXT,
  GAME_HEIGHT,
  GAME_WIDTH,
  MIN_RENDER_SCALE,
  SCENE_KEYS,
  designWidthFor,
  renderScaleFor,
  setGameWidth,
  textResolutionFor,
  type SceneContext,
} from "./sceneKeys.js";
import { hexToNum, paletteFor } from "./render/palette.js";
import { WORLD_STOP_KEY } from "./render/parallax.js";
import { INK } from "./ui/theme.js";
import { LANTERN_SHOT_KEY, LanternShotScene } from "./render/lanternShot.js";
import { installCanvasGlyphMeasurer } from "./render/measureGlyphAdvances.js";
import { createTranslator, isShipped, type Translator } from "../engine/i18n/index.js";
import {
  DEFAULT_SHIP_NAME,
  createProfileStore,
  type ProfileStore,
} from "../engine/persistence/index.js";
import {
  DEFAULT_SETTINGS,
  STOP_IDS,
  isLang,
  isStopId,
  type Lang,
  type StopId,
} from "../engine/types.js";
import {
  AUDIO_REGISTRY_KEY,
  createAudioSystem,
  installAudio,
  stopIdFromSceneData,
  type AudioService,
} from "./audio/index.js";
import { setUiSound } from "./ui/focus.js";
import { installViewportBackdrop, type ViewportBackdrop } from "./ui/viewportBackdrop.js";
import { FLIGHT_EVENTS } from "./flight/stage.js";

/** Registry key the service bundle is stored under. */
const SERVICES_KEY = "kb.services";

/**
 * Everything a scene needs from the game layer. Deliberately small: a scene
 * that wants a sixth member probably wants the engine instead.
 */
export interface GameServices {
  /** Presentation state shared across scenes (sceneKeys.ts). Mutable. */
  readonly context: SceneContext;
  /** Versioned local persistence (D43, D44). */
  readonly store: ProfileStore;
  /** UI copy. Never hard-code a string in a scene (D45). */
  t: Translator;
  /**
   * The game's audio (D62, D88). Constructed ONCE here and reachable the same
   * way `store` and `t` are, because the previous arrangement - a complete,
   * fully tested audio package with no caller - is what made the game silent
   * while five rubric items stayed green (audit.md 1.2).
   *
   * Never null. `createAudioSystem` falls back to a null context when the
   * browser has no Web Audio, so a scene calls this without an `if`.
   */
  readonly audio: AudioService;
  /** Switch UI language; rebuilds `t` and re-emits `kb.lang` on the registry. */
  setLang(lang: Lang): void;
}

/** The service bundle for this game. Throws if called before `bootGame`. */
export function services(scene: Phaser.Scene): GameServices {
  const s = scene.registry.get(SERVICES_KEY) as GameServices | undefined;
  if (s === undefined) throw new Error("services() called before bootGame()");
  return s;
}

/** The furthest stop this profile has lit a beacon at, or null (D13). */
export function furthestBeacon(store: ProfileStore): StopId | null {
  const profile = store.activeProfile();
  if (profile === null) return null;
  let best: StopId | null = null;
  for (const entry of profile.progress) {
    if (entry.beaconPlacedAt === null) continue;
    if (best === null || STOP_IDS.indexOf(entry.stopId) > STOP_IDS.indexOf(best)) {
      best = entry.stopId;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function buildContext(params: URLSearchParams, store: ProfileStore): SceneContext {
  const profile = store.activeProfile();
  const settings = profile?.settings;
  const flag = (name: string, fallback: boolean): boolean => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    return raw !== "0" && raw !== "false";
  };
  return {
    ...DEFAULT_SCENE_CONTEXT,
    profileId: profile?.id ?? null,
    reducedMotion: flag("reducedMotion", settings?.reducedMotion ?? prefersReducedMotion()),
    colorblindPalette: flag("colorblind", settings?.colorblindPalette ?? false),
  };
}

function pickLang(params: URLSearchParams, store: ProfileStore): Lang {
  // D95: `isShipped`, not `isLang`. The URL parameter is a real entry point -
  // `?lang=es` brought the entire UI up in Spanish in the shipped build, past
  // a menu that no longer offers it. A saved `uiLang` gets the same treatment,
  // because a profile written before the cut still carries one.
  const fromUrl = params.get("lang");
  if (fromUrl !== null && isLang(fromUrl) && isShipped(fromUrl)) return fromUrl;
  const saved = store.activeProfile()?.settings.uiLang;
  return saved !== undefined && isShipped(saved) ? saved : "en";
}

// ---------------------------------------------------------------------------
// Scene discovery
// ---------------------------------------------------------------------------

type SceneClass = new (...args: never[]) => Phaser.Scene;

const KEY_BY_NAME = new Map<string, string>(
  Object.values(SCENE_KEYS).map((key) => [key, key]),
);

function sceneClassIn(module: unknown): SceneClass | null {
  if (typeof module !== "object" || module === null) return null;
  for (const value of Object.values(module as Record<string, unknown>)) {
    if (typeof value === "function" && value.prototype instanceof Phaser.Scene) {
      return value as SceneClass;
    }
  }
  return null;
}

interface Discovered {
  key: string;
  klass: SceneClass;
}

async function discoverScenes(): Promise<Discovered[]> {
  const modules = import.meta.glob("./scenes/*.ts") as Record<
    string,
    () => Promise<unknown>
  >;
  const found: Discovered[] = [];
  await Promise.all(
    Object.entries(modules).map(async ([path, load]) => {
      const file = path.split("/").pop() ?? "";
      const key = KEY_BY_NAME.get(file.replace(/Scene\.ts$/, "").replace(/\.ts$/, ""));
      if (key === undefined) {
        console.warn(`[kb] ${path} has no SCENE_KEYS entry; not registered`);
        return;
      }
      try {
        const klass = sceneClassIn(await load());
        if (klass === null) {
          console.warn(`[kb] ${path} exports no Phaser.Scene subclass; not registered`);
          return;
        }
        found.push({ key, klass });
      } catch (error) {
        // A half-written scene from another lane must never take the boot down.
        console.warn(`[kb] ${path} failed to load; not registered`, error);
      }
    }),
  );
  // SCENE_KEYS order is screen-inventory order, so index 0 is the natural entry.
  const order = Object.values(SCENE_KEYS) as string[];
  found.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return found;
}

// ---------------------------------------------------------------------------
// Audio, per frame
// ---------------------------------------------------------------------------

/**
 * The ambient bed's stop, read off whatever is on screen.
 *
 * Every scene that belongs to a PLACE is started with a data object carrying a
 * `stopId` - `FlightConfig`, `StoryInit`, the map's hand-off - so the bed can be
 * chosen generically here instead of each of the sixteen scenes having to
 * remember to ask for one. The top-most such scene wins, which is what makes
 * Flight's bed beat the HUD overlay sitting on top of it.
 *
 * A menu screen has no stop and returns null, which is READ AS "keep the bed you
 * have": pausing at Saturn must not drop you back to Earth's wind.
 */
function currentStop(game: Phaser.Game, context: SceneContext): StopId | null {
  // THE WORLD'S OWN ANSWER FIRST. `buildParallax` publishes the stop whose
  // palette it just drew the sky in, and that is the only source that cannot
  // disagree with the picture on screen.
  //
  // The scene-tree lookup below it can, and did. A scene opened straight from a
  // URL carries no `stopId` in its data - `?scene=Flight` boots with `data: {}` -
  // so the search found nothing and fell through to the shared `SceneContext`
  // default, which is Earth, while `FlightScene` had resolved Mars for itself.
  // At a 4:3 window the letterbox bars measured `#0b1b3a` over `#08111f`:
  // Earth's sky and Earth's ground, framing a Mars screen.
  const drawn = game.registry.get(WORLD_STOP_KEY) as unknown;
  if (typeof drawn === "string" && isStopId(drawn)) return drawn;
  let found: StopId | null = null;
  for (const scene of game.scene.getScenes(true)) {
    const stop = stopIdFromSceneData(scene.sys.settings.data);
    if (stop !== null) found = stop;
  }
  // `SceneContext.stopId` is the shared "where the player is travelling"
  // (sceneKeys.ts) and `laneInit` sets it from whatever the story lane resolved
  // - a scene opened straight from a URL included. It is the fallback rather
  // than the primary because a scene STARTED with a stop is the more specific
  // statement of the two.
  return found ?? stopIdFromSceneData(context);
}

/**
 * Hand the graph a clock and a place.
 *
 * `advance` is what moves the ambient crossfade and the music intensity ramp,
 * and it has to happen whether or not any particular scene remembered to call
 * it, so it hangs off the game's own step rather than off a scene's `update`.
 * AC-19.3 is untouched here on purpose: reduced motion is not reduced sound
 * (architecture 6, last line).
 */
function wireAudioToFrames(
  game: Phaser.Game,
  audio: AudioService,
  context: SceneContext,
  backdrop: ViewportBackdrop | null,
  openAt: StopId,
): void {
  let lastStop: StopId | null = null;

  game.events.on(Phaser.Core.Events.PRE_STEP, (_time: number, delta: number) => {
    audio.advance(delta);
    const stop = currentStop(game, context);
    if (stop !== null && stop !== lastStop) {
      lastStop = stop;
      audio.ambientFor(stop);
      // The letterbox wears the same sky as the stop the player is at, off the
      // SAME "where are we" answer the ambient bed uses - so the bars and the
      // bed can never disagree about where the ship is. `setStop` repaints only
      // on a change, so this costs nothing on the frames where nothing moved.
      backdrop?.setStop(stop);
    }
  });

  // UR-173: THE PROFILE ALREADY KNOWS WHERE THE PLAYER IS.
  //
  // This was `ambientFor("earth")` - "so the title screen is not silent while
  // it waits for a scene that knows where it is". The wait is real, but Earth
  // is not the only answer available during it: `furthestBeacon` reads the
  // saved profile and is known before any scene loads. A pilot at Pluto heard
  // Earth's bed on every refresh and then a crossfade to their own.
  audio.ambientFor(openAt);

  // Browsers refuse to start an AudioContext before a gesture. The context is
  // already built and already wired; it just has to be told it may run, and the
  // first key a child presses is the gesture. Duck-typed because
  // `AudioContextLike` has no `resume` - a null context has nothing to resume.
  const resume = (): void => {
    const ctx = audio.graph.ctx as { state?: string; resume?: () => unknown };
    if (ctx.state !== "suspended" || typeof ctx.resume !== "function") return;
    try {
      void ctx.resume();
    } catch {
      // A refused resume is silence, not a crash.
    }
  };
  try {
    window.addEventListener("keydown", resume);
    window.addEventListener("pointerdown", resume);
  } catch {
    // No window: nothing to resume.
  }

  game.events.once(Phaser.Core.Events.DESTROY, () => audio.dispose());
}

// ---------------------------------------------------------------------------
// The world follows the window (D99)
// ---------------------------------------------------------------------------

/** How long the drag has to stop before the world is resized. */
const RESIZE_SETTLE_MS = 180;

/** How often a deferred resize asks again whether it may land. */
const RESIZE_RETRY_MS = 900;

/** Below this the change is rounding, not a resize. */
const RESIZE_EPSILON_PX = 2;

/**
 * Scenes whose relayout would cost the player something they earned.
 *
 * Relayout is `scene.restart()`, which re-runs `create` against the new world
 * width - correct, and for these three it would also throw away the run in
 * progress: the belt, the score and the hull. A window drag mid-flight is not
 * worth a lost run, so the new size WAITS for the flight to end. Until it
 * does, the window keeps whatever letterbox the drag opened up, which is the
 * one place in the game where the old behaviour survives. Recorded in
 * gauntlet/escalations.md.
 */
const RESIZE_HOLD_KEYS: readonly string[] = [
  SCENE_KEYS.flight,
  SCENE_KEYS.hud,
  SCENE_KEYS.stall,
];

/**
 * Keep the world's width equal to the window's aspect, for the whole session.
 *
 * WHY A RESTART AND NOT JUST `setGameSize`. `setGameSize` alone removes the
 * letterbox and puts a different gap in its place: every scene builds its
 * parallax, its full-bleed plate and its right-anchored HUD in `create`, so a
 * window widened after that has a strip down the right with no sky in it,
 * showing the WebGL clear colour. That is the same defect wearing a different
 * hat, which is exactly how this bug survived five fixes. `create` is the code
 * that lays a screen out, so relayout means running it again.
 *
 * WHEN IT WAITS. Never mid-run (see `RESIZE_HOLD_KEYS`), and never while any
 * scene is paused or asleep - the Pause card pauses the scene underneath it
 * and Settings puts Pause to sleep, and restarting only the visible one would
 * leave the sleeper laid out for a window that no longer exists. A deferred
 * resize re-asks every `RESIZE_RETRY_MS` until it can land.
 */
function followWindowSize(game: Phaser.Game, backdrop: ViewportBackdrop | null): void {
  let timer = 0;
  let deferred: number | null = null;

  const suspended = (): boolean =>
    game.scene.scenes.some((s) => s.sys.isPaused() || s.sys.isSleeping());

  const midRun = (): boolean =>
    RESIZE_HOLD_KEYS.some((key) => {
      const scene = game.scene.getScene(key);
      return scene !== null && (scene.sys.isActive() || scene.sys.isPaused());
    });

  const apply = (width: number): void => {
    setGameWidth(width);
    game.scale.setGameSize(GAME_WIDTH, GAME_HEIGHT);
    backdrop?.refresh();
    for (const scene of game.scene.getScenes(true)) {
      const key = scene.sys.settings.key;
      if (key === SCENE_KEYS.boot) continue;
      // The same data the scene was started with, so a restart is a relayout
      // and not a different screen.
      scene.scene.restart(scene.sys.settings.data);
    }
    game.events.emit("kb.worldResize", GAME_WIDTH, GAME_HEIGHT);
  };

  const attempt = (): void => {
    timer = 0;
    const want = deferred ?? designWidthFor(window.innerWidth, window.innerHeight);
    if (Math.abs(want - GAME_WIDTH) < RESIZE_EPSILON_PX) {
      deferred = null;
      return;
    }
    if (midRun() || suspended()) {
      deferred = want;
      timer = window.setTimeout(attempt, RESIZE_RETRY_MS);
      return;
    }
    deferred = null;
    apply(want);
  };

  const onResize = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(attempt, RESIZE_SETTLE_MS);
  };

  window.addEventListener("resize", onResize);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener("resize", onResize);
    window.clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Pixel density (UR-18): the buffer follows the screen, the world does not
// ---------------------------------------------------------------------------

/**
 * WHAT WAS WRONG. The canvas drew 1920x1080 whatever the display. Probed on
 * the frozen build, `deviceScaleFactor` 1 and 2 gave an IDENTICAL 1920x1080
 * drawing buffer in an identical 1440x810 CSS box - so at 2x that canvas
 * covers 2880x1620 real pixels while being handed 1920x1080, and the browser
 * upscales it ~1.5x. Nothing in `src/` had ever read `devicePixelRatio`.
 *
 * All the art is vector drawn in code (D83), so it is pixel-perfect at any
 * resolution. We were simply never asking for one.
 *
 * ================== WHY THIS IS NOT `setGameSize` ==================
 * The obvious fix - size the game in device pixels - MOVES THE DESIGN SPACE,
 * and the design space is load-bearing. `scene.scale.width/height` is read at
 * 34 sites across the scene lane as design coordinates (`this.scale.width -
 * 260` anchors the HUD, `this.scale.height` IS FR-8's fall distance), and
 * `Phaser.Scale` hard-couples the drawing buffer to the game size:
 * `ScaleManager.setGameSize` sets `baseSize` from `gameSize` and `canvas.width`
 * from `baseSize`, and under `FIT` `updateScale` only ever touches
 * `style.width/height`. So a bigger buffer via the size is a bigger world, and
 * a bigger world is the letterbox defect's whole family of failures again.
 *
 * `scale.zoom` is not the lever either, and this was checked in the source
 * rather than assumed: under every mode except NONE, `updateScale` ignores
 * `zoom` completely. It scales the CSS box, never the buffer.
 *
 * Compensating with a camera zoom was the third shape and it collides with
 * scenes that already own their camera: `EndingScene` calls `setZoom(1.5)`,
 * tweens `zoom`, and REPORTS `cameras.main.zoom` in the snapshot the rubric
 * reads. A global camera zoom would be stomped by one screen and would change
 * another screen's evidence.
 *
 * ================== WHAT THIS DOES INSTEAD ==================
 * It separates the two things Phaser keeps welded together:
 *
 *   projection  stays DESIGN space  (renderer.width/height untouched, so
 *               cameras, pointer coordinates and `scene.scale.width` are all
 *               exactly what they were)
 *   viewport    becomes REAL pixels (canvas.width/height and gl.viewport)
 *
 * which is the ordinary HiDPI trick - rasterise logical units across a denser
 * buffer - and is what Phaser's own removed `resolution` config used to do.
 *
 * The cost of doing it from outside is that three renderer internals then
 * disagree about which space they are in, and all three are corrected here:
 *
 *   1. `setScissor` takes design px and writes `gl.scissor` directly.
 *      `preRenderCamera` pushes one for EVERY camera, so left alone the whole
 *      game clips to the bottom-left quarter of the buffer.
 *   2. `resetScissor` bypasses `setScissor` and calls `gl.scissor` itself.
 *   3. `setFramebuffer` restores `gl.viewport` and `drawingBufferHeight` to
 *      the DESIGN size when it unbinds.
 *
 * (3) never fires in this game today - there are no render textures, no
 * bitmap masks and no post-processing (AC-22.9); the only masks are
 * `createGeometryMask`, which is stencil and rides the same projection. It is
 * handled anyway because "currently unreachable" is not the same as "safe".
 *
 * KNOWN BRITTLENESS, stated rather than buried: this reaches into Phaser
 * internals that are not part of its public contract, so a Phaser upgrade must
 * re-check those three. `tests/e2e/dpi.spec.ts` asserts both halves - buffer
 * up, design space still - and will go red rather than quiet if it breaks.
 */

/** The renderer surface this reaches into. Narrow on purpose. */
interface HiDpiRenderer {
  gl: WebGLRenderingContext;
  width: number;
  height: number;
  drawingBufferHeight: number;
  currentScissor: number[] | null;
  setScissor(x: number, y: number, w: number, h: number, dbh?: number): void;
  resetScissor(): void;
  setFramebuffer(
    framebuffer: unknown,
    updateScissor?: boolean,
    setViewport?: boolean,
    texture?: unknown,
    clear?: boolean,
  ): unknown;
  /** Reached via `DynamicTexture.endDraw`. Restores the DESIGN viewport. */
  resetViewport(): void;
  /** `renderer.pipelines`. `rebind` restores the DESIGN viewport. */
  pipelines: { rebind(pipeline?: unknown): unknown };
}

/** Live read of the display's density, safe where there is no window. */
function devicePixelRatioNow(): number {
  try {
    const dpr = window.devicePixelRatio;
    return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  } catch {
    return 1;
  }
}

/**
 * Rasterise the design space into a buffer that matches the screen.
 *
 * Returns a getter for the scale in force, which is also what `Text` objects
 * are rendered at (see `sharpenText`).
 *
 * EXPORTED FOR THE OTHER ENTRY POINT (UR-36). `src/game/flight/boot.ts` builds
 * a SECOND `Phaser.Game` - it is what `flight.spec`, `world-frame.spec`,
 * `blast-history.spec` and `flight-perf.spec` drive, 24 tests between them -
 * and it does not come through `bootGame`, so it gets none of this. That is
 * why P-22.9's frame-time evidence was gathered on a 1x buffer.
 *
 * A game that wants the shipping renderer needs both of these and, separately,
 * `setGameWidth(designWidthFor(...))` for D99. Calling this alone sharpens the
 * buffer and leaves the other four divergences in place; see the UR-36 entry
 * in gauntlet/escalations.md for the full list, because the fix belongs to the
 * flight lane and a partial adoption would be worse than none.
 */
export function installPixelDensity(game: Phaser.Game): () => number {
  let scale = MIN_RENDER_SCALE;

  const renderer = game.renderer as unknown as Partial<HiDpiRenderer>;
  const gl = renderer.gl;
  const canvas = game.canvas;
  // The Canvas fallback renderer has no buffer to enlarge and no scissors to
  // correct. A soft canvas beats a crashed one.
  if (gl === undefined || canvas === undefined || typeof renderer.setScissor !== "function") {
    return () => MIN_RENDER_SCALE;
  }
  const r = renderer as HiDpiRenderer;

  // True while a framebuffer is bound: inside one, Phaser is already working
  // in that target's own pixels and must not be scaled a second time.
  let inFramebuffer = false;
  const scaleNow = (): number => (inFramebuffer ? 1 : scale);

  const baseSetScissor = r.setScissor.bind(r);
  r.setScissor = (x, y, w, h, dbh): void => {
    const s = scaleNow();
    baseSetScissor(x * s, y * s, w * s, h * s, dbh);
  };

  // Re-implemented rather than wrapped: the original calls `gl.scissor` itself
  // from `currentScissor`, so there is no argument to intercept.
  r.resetScissor = (): void => {
    gl.enable(gl.SCISSOR_TEST);
    const current = r.currentScissor;
    if (!current) return;
    const s = scaleNow();
    const x = current[0]! * s;
    const y = current[1]! * s;
    const w = current[2]! * s;
    const h = current[3]! * s;
    if (w > 0 && h > 0) gl.scissor(x, r.drawingBufferHeight - y - h, w, h);
  };

  const baseSetFramebuffer = r.setFramebuffer.bind(r);
  r.setFramebuffer = (fb, updateScissor, setViewport, texture, clear): unknown => {
    inFramebuffer = fb !== null && fb !== undefined;
    const out = baseSetFramebuffer(fb, updateScissor, setViewport, texture, clear);
    if (!inFramebuffer) {
      // Phaser has just restored both of these to the DESIGN size.
      r.drawingBufferHeight = gl.drawingBufferHeight;
      if (setViewport !== false) gl.viewport(0, 0, canvas.width, canvas.height);
      if (updateScissor === true) r.resetScissor();
    }
    return out;
  };

  /**
   * THE OTHER TWO VIEWPORT WRITERS (UR-37).
   *
   * Phaser writes a design-space viewport or scissor in six places. The three
   * above are the ones this game reaches today. These two it does not - and
   * the comment at the top of this block argues that "currently unreachable is
   * not the same as safe", so applying that to one path and not these was
   * simply inconsistent. Both are three lines.
   *
   * They matter because they are QUIET. The upgrade risk documented above is
   * loud: the game clips to a corner and `dpi.spec.ts` fails. These need no
   * upgrade at all - they arrive the first time anyone adds a RenderTexture, a
   * DynamicTexture bake or an FX pipeline, they corrupt the viewport MID-FRAME
   * where the per-frame re-statement below cannot help, and nothing would say
   * so.
   *
   * THE SIXTH WRITER NEEDS NO PATCH, and that is a measurement rather than an
   * assumption: `preRender` sets a design-space scissor when any camera has a
   * custom viewport, but Phaser's `Game.step` runs `renderer.preRender()`,
   * THEN emits `Events.PRE_RENDER`, THEN calls `scene.render()`
   * (core/Game.js). `apply` below is on `PRE_RENDER`, so it overwrites that
   * scissor before a single object is drawn, and each camera's own rect goes
   * through the scaling wrapper above.
   */
  const baseResetViewport = r.resetViewport.bind(r);
  r.resetViewport = (): void => {
    baseResetViewport();
    if (inFramebuffer) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    r.drawingBufferHeight = gl.drawingBufferHeight;
  };

  const pipelines = r.pipelines;
  if (pipelines !== undefined && typeof pipelines.rebind === "function") {
    const baseRebind = pipelines.rebind.bind(pipelines);
    pipelines.rebind = (pipeline?: unknown): unknown => {
      const out = baseRebind(pipeline);
      // Inside a framebuffer the target's own viewport is correct; only the
      // main buffer is in the wrong space.
      if (!inFramebuffer) gl.viewport(0, 0, canvas.width, canvas.height);
      return out;
    };
  }

  /**
   * Size the buffer to the pixels the canvas actually occupies, and re-state
   * the viewport, every frame, just before the scene is drawn.
   *
   * RE-STATED RATHER THAN SET ONCE, and this was a measured bug, not caution.
   * The first version set the viewport when the scale changed and guarded the
   * work behind "has anything I own changed". Phaser then called
   * `renderer.resize(1920, 1080)` during boot - `ScaleManager.refresh` emits
   * RESIZE and the renderer answers it by re-issuing `gl.viewport` at the
   * DESIGN size - so the buffer stayed 2880x1620 while the viewport went back
   * to 1920x1080 and the whole game drew into the bottom-left corner of it,
   * with the other three quadrants left as clear colour. The guard could not
   * see it, because the state it guarded was still correct.
   *
   * `gl.viewport` and `gl.scissor` are two of the cheapest calls in WebGL and
   * this issues them once per frame against the thousands Phaser already
   * makes. Paying that flat cost buys a version with no ordering assumption in
   * it at all: a window drag, a `setGameSize` from `followWindowSize`, a scene
   * restart, a DPR change from dragging onto another monitor, or any future
   * Phaser code path that resets the viewport, all self-heal on the next
   * frame. The buffer itself is only REALLOCATED when the size actually
   * changes - assigning `canvas.width` clears the drawing buffer even when the
   * value is identical, so that assignment stays behind a comparison.
   */
  const apply = (): void => {
    const design = game.scale.gameSize;
    const want = renderScaleFor(design.width, game.scale.displaySize.width, devicePixelRatioNow());
    const bw = Math.round(design.width * want);
    const bh = Math.round(design.height * want);
    scale = want;

    // `renderer.width/height` are deliberately NOT touched: they are what the
    // projection matrix is built from, and the projection stays in design
    // space. Only the buffer and the viewport move.
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    r.drawingBufferHeight = gl.drawingBufferHeight;
    // `defaultScissor` is deliberately LEFT in design units. `preRender` seeds
    // the scissor stack with it and `popScissor` restores from it, so it goes
    // back through the wrapper above and is scaled there. Writing buffer px
    // into it would scale it twice.
    gl.viewport(0, 0, bw, bh);
    // The cached rect is in design px and would make the next `setScissor` a
    // no-op against a box that has just been re-stated in buffer px.
    r.currentScissor = null;
    gl.scissor(0, 0, bw, bh);
  };

  apply();
  game.events.on(Phaser.Core.Events.PRE_RENDER, apply);
  return () => scale;
}

/**
 * Make the WORDS sharp, which is most of what a child is looking at.
 *
 * A `Text` object is not vector at draw time: it rasterises its string to a
 * private canvas texture at `style.resolution` (default 1) and the renderer
 * draws that texture at `width / resolution`. So a denser drawing buffer on
 * its own sharpens every shape in the game and leaves every letter exactly as
 * soft as it was - the glyph texture is still 1 design px per pixel and is
 * simply magnified across the bigger buffer.
 *
 * Done by intercepting the factory rather than by editing scenes: `add.text`
 * is the one door every string in the game goes through, and the scene and UI
 * lanes are live. Display size is unaffected (Phaser divides the texture back
 * out), so no layout moves - which is the property `dpi.spec.ts` asserts.
 */
function sharpenText(game: Phaser.Game, renderScale: () => number): void {
  type TextFactory = (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ) => Phaser.GameObjects.Text;

  /**
   * The wrapper is installed on the PROTOTYPE, so it is installed once per
   * process and not once per game. It therefore reads the resolution through a
   * mutable slot rather than closing over this particular `bootGame` call's
   * getter: a suite that boots a second game would otherwise leave every new
   * string rasterised at the DESTROYED game's density.
   */
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: TextFactory;
    __kbTextResolution?: () => number;
  };
  const alreadyWrapped = factory.__kbTextResolution !== undefined;
  factory.__kbTextResolution = () => textResolutionFor(renderScale());
  if (!alreadyWrapped) {
    const base = factory.text;
    factory.text = function (x, y, text, style): Phaser.GameObjects.Text {
      const made = base.call(this, x, y, text, style);
      const want = factory.__kbTextResolution?.() ?? 1;
      if (made.style.resolution !== want) made.setResolution(want);
      return made;
    };
  }

  /**
   * `make.text` as well as `add.text` (UR-37).
   *
   * `GameObjectCreator` is a SECOND door to the same object and it was left
   * unwrapped. Today the only caller is a measuring ruler in `WarpScene` that
   * is destroyed without being drawn, so nothing is visibly wrong - which is
   * exactly why it would have stayed missed until someone used `make.text` for
   * something on screen and got one soft string among sharp ones.
   */
  const creator = Phaser.GameObjects.GameObjectCreator.prototype as unknown as {
    text: (
      this: Phaser.GameObjects.GameObjectCreator,
      config: unknown,
      addToScene?: boolean,
    ) => Phaser.GameObjects.Text;
    __kbTextResolution?: () => number;
  };
  const creatorWrapped = creator.__kbTextResolution !== undefined;
  creator.__kbTextResolution = () => textResolutionFor(renderScale());
  if (!creatorWrapped && typeof creator.text === "function") {
    const baseMake = creator.text;
    creator.text = function (config, addToScene): Phaser.GameObjects.Text {
      const made = baseMake.call(this, config, addToScene);
      const want = creator.__kbTextResolution?.() ?? 1;
      if (made !== undefined && made.style !== undefined && made.style.resolution !== want) {
        made.setResolution(want);
      }
      return made;
    };
  }

  /**
   * The DPR can change without the window resizing - dragging the window to a
   * monitor of a different density is the ordinary case. The buffer heals
   * itself every frame (`installPixelDensity`), but Text objects already built
   * carry the old resolution in a texture, so they are re-rasterised once when
   * the number actually changes. Not on a tick: only on a change (AC-22.9).
   */
  let applied = textResolutionFor(renderScale());
  game.events.on(Phaser.Core.Events.PRE_STEP, () => {
    const want = textResolutionFor(renderScale());
    if (want === applied) return;
    applied = want;
    const walk = (children: Phaser.GameObjects.GameObject[]): void => {
      for (const child of children) {
        if (child instanceof Phaser.GameObjects.Text) {
          child.setResolution(want);
        } else if (child instanceof Phaser.GameObjects.Container) {
          walk(child.list);
        }
      }
    };
    for (const scene of game.scene.getScenes(false)) walk(scene.children.list);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export interface BootOptions {
  parent?: string;
  /** Overrides the URL; used by tests that boot the game directly. */
  search?: string;
}

export async function bootGame(options: BootOptions = {}): Promise<Phaser.Game> {
  // THE WORD PLATE HAS TO KNOW HOW WIDE A LETTER REALLY IS, and it has to know
  // BEFORE anything renders: `FlightScene` asks `plateSize` for a word's plate
  // while choosing the rock's spawn column, which is decided before the plate
  // exists. This is the one line that points the pure geometry at the real
  // face; without it the layout falls back to a shipped table and is
  // approximately, rather than exactly, right. See `render/glyphAdvance.ts`.
  installCanvasGlyphMeasurer();

  const params = new URLSearchParams(options.search ?? window.location.search);

  const store = createProfileStore({
    storage: window.localStorage,
    clock: {
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    },
  });
  window.addEventListener("pagehide", () => store.close());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") store.flush();
  });

  const context = buildContext(params, store);
  const misses: string[] = [];

  const makeTranslator = (lang: Lang): Translator =>
    createTranslator({
      lang,
      // "prod" on purpose. The dev mode throws on a missing key, and an
      // unattended overnight run must not lose a screen to a copy bug (D94).
      // Misses are still loud: they are logged AND collected, and the Title
      // e2e asserts the list is empty.
      mode: "prod",
      defaults: {
        shipName: store.activeProfile()?.shipName ?? DEFAULT_SHIP_NAME,
        pilotName: store.activeProfile()?.name ?? "",
      },
      onMissing: (key, missLang) => {
        const line = `${missLang}:${key}`;
        misses.push(line);
        console.error(`[kb] missing i18n string ${line}`);
      },
    });

  // The audio is built here, once, before any scene exists - see
  // `GameServices.audio`. The profile's saved volumes open it, so a child who
  // muted the music last session is muted before the first bed starts rather
  // than a second later, once Settings happens to be opened.
  const openingSettings = store.activeProfile()?.settings;
  let audioService: AudioService | null = null;

  const bundle: GameServices = {
    context,
    store,
    t: makeTranslator(pickLang(params, store)),
    get audio(): AudioService {
      if (audioService === null) {
        throw new Error("services().audio read before bootGame() finished");
      }
      return audioService;
    },
    setLang(lang: Lang): void {
      bundle.t = makeTranslator(lang);
      game.registry.set("kb.lang", lang);
      game.events.emit("kb.lang", lang);
    },
  };

  const discovered = await discoverScenes();

  /**
   * THE WORLD'S SIZE, MEASURED FROM THE WINDOW (D99).
   *
   * `sceneKeys` carries the full reasoning. In one line: the letterbox was
   * made by fitting a fixed 16:9 rect into a window that is not 16:9, so the
   * rect is no longer fixed. The width is the window's own aspect at a pinned
   * 1080 height, and `Scale.FIT` then has nothing left to letterbox - it only
   * scales the world up or down to the window, which is what it is for.
   *
   * This must run BEFORE `new Phaser.Game` and before any scene module is
   * asked for a coordinate, so that every `GAME_WIDTH` read in the game is the
   * real one. `discoverScenes()` above only IMPORTS the scene modules; none of
   * them lays anything out until `create`.
   */
  setGameWidth(designWidthFor(window.innerWidth, window.innerHeight));

  /**
   * The viewport backdrop (see ui/viewportBackdrop.ts).
   *
   * It no longer has a letterbox to fill - there isn't one. What it still does
   * is own the pixels behind the game canvas, which matters for the at most
   * one device-independent pixel of slack that rounding the design width to an
   * integer can leave, and for the instant during a window drag between the
   * browser resizing the canvas and the debounced relayout below catching up.
   * Cheap insurance: it repaints on a stop change and on resize, never on a
   * tick (AC-22.9).
   *
   * Installed BEFORE `new Phaser.Game`, so it is the first child of the parent
   * element and the game canvas is drawn over it.
   */
  const parentEl = document.getElementById(options.parent ?? "app");
  const backdrop =
    parentEl === null
      ? null
      : installViewportBackdrop(parentEl, {
          colorblind: () => context.colorblindPalette,
        });

  /**
   * The WebGL clear colour, and it belongs to no stop on purpose.
   *
   * This was `paletteFor("earth").colors[last]` - Earth's ground - on every
   * screen in the game, because the clear colour is fixed at construction and
   * the stop is not known then. The letterbox itself is painted by
   * `installViewportBackdrop`, which follows the stop, so this is only ever seen
   * in the sub-pixel seam at the canvas edge; a critic measuring a capture found
   * `#08111f` down a 1 px left column of a Mars frame and correctly called it a
   * leftover, because that is exactly what it looked like.
   *
   * `INK.panel` is the game's own near-black - the colour every word plate and
   * HUD panel is drawn in - so it is stop-neutral by construction and can never
   * read as one planet's palette leaking onto another's screen. Fixing it by
   * repainting the clear on every stop change would mean poking
   * `renderer.config.backgroundColor` at runtime, which is more machinery than a
   * one-pixel seam is worth.
   */
  const voidColor = INK.panel;
  // The reference-compare harness renders on alpha so the judge sees the
  // silhouette and nothing else. The game itself is never transparent (D35).
  const lanternShot = params.get("lantern") !== null;

  const game = new Phaser.Game({
    type: Phaser.WEBGL, // D35: "2D that feels 3D" is parallax + light, not 3D geometry.
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: options.parent ?? "app",
    backgroundColor: hexToNum(voidColor),
    transparent: lanternShot,
    pixelArt: false,
    antialias: true,
    roundPixels: false,
    // No post-processing anywhere: the effects budget is layers, gradients and
    // particles (AC-22.9).
    scale: {
      mode: Phaser.Scale.FIT,
      /**
       * NO_CENTER, and the CSS does the centring. Not a style preference — the
       * game was centred TWICE. It still matters with D99 in place: the world
       * matches the window's aspect to within a rounded pixel, so there is at
       * most ~1 px of slack, and centring that twice puts all of it on one
       * side where it reads as a hairline down one edge.
       *
       * `autoCenter: CENTER_BOTH` centres the canvas by setting a margin, and
       * `#app { display:grid; place-items:center }` in index.html then centres
       * the resulting margin box a second time. The two offsets add, so the
       * bars came out 3:1 instead of 1:1 at every window that is not exactly
       * 16:9: measured 144 px above the game and 48 below it at 1024x768, and
       * 375 left against 125 right at 2100x900.
       *
       * That also silently broke the letterbox. `viewportBackdrop.designRect`
       * paints the sky against `(w - rw) / 2` — where a correctly centred
       * canvas would be — so the gradient was being drawn for a rect the game
       * had been pushed out of, by half a bar.
       *
       * CSS wins over `autoCenter` because `#app`'s grid is the mechanism the
       * backdrop already documents itself against (see viewportBackdrop's
       * z-index note), and because the backdrop is `position:absolute` inside
       * that grid and so is unaffected by it either way.
       *
       * Invisible to the suite until now: 27 of 30 e2e specs run at 1280x720,
       * which is exactly 16:9 and therefore has no bar to be asymmetric.
       * `aspect.spec.ts` covers it now, 4:3 included.
       */
      autoCenter: Phaser.Scale.NO_CENTER,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [],
  });

  /**
   * UR-18: rasterise the design space at the screen's real pixel density.
   *
   * Installed HERE, before any scene has been started, for two reasons: the
   * `Text` factory has to be wrapped before the first string is built, and the
   * renderer's scissor overrides have to be in place before the first frame is
   * drawn. Neither reads or moves a design coordinate.
   */
  const renderScale = installPixelDensity(game);
  sharpenText(game, renderScale);

  game.registry.set(SERVICES_KEY, bundle);
  game.registry.set("kb.lang", bundle.t.lang);

  audioService = installAudio({
    // The voice language is fixed at construction. `setLang` does NOT rebuild
    // it: rebuilding the graph mid-session would drop the ambient bed and the
    // music with it, and the honest fix is a `setLang` on the voice transport
    // rather than a new graph. Known limitation, noted rather than hidden - a
    // child who switches language mid-run keeps the voice they booted with
    // until the next reload.
    /**
     * D98: the platform voice is OFF unless the URL asks for it.
     *
     * Web Speech was D88's stand-in for having no ElevenLabs key. That ended,
     * and the stand-in stayed wired as the fallback under every speak site, so
     * any line nobody remembered to render degraded silently to an OS voice
     * instead of failing loudly. D98 cut it: an unrendered spoken line is a
     * BUILD failure now, and silence is the runtime behaviour.
     *
     * It survives behind an opt-in for the one case D98 keeps it for — a live
     * `/api/coach` note, which is generated per child and can never be
     * pre-rendered. That case needs a switch reachable from a browser, so this
     * uses the same URL seam `?coach=proxy` already does. Off unless asked.
     */
    graph: createAudioSystem({
      lang: bundle.t.lang,
      allowSystemVoice: params.get("voice") === "system",
    }),
    events: game.events,
    registry: game.registry,
    // Read from the flight lane rather than restated, so the two can never
    // drift apart into a silent game that still passes its own tests.
    cueEvent: FLIGHT_EVENTS.cue,
    hudEvent: FLIGHT_EVENTS.hud,
    // Every screen advance in this game goes through `scenes/lib/init.goTo`,
    // which emits this on `game.events` before starting the next scene. It is
    // the one event that is always the PLAYER acting, which is why it is the
    // one event allowed to interrupt Shadow mid-line (AC-21.4, and the voice
    // bus header for what "interrupt" is allowed to sound like).
    transitionEvent: "story-transition",
    volumes: {
      music: openingSettings?.musicVolume ?? DEFAULT_SETTINGS.musicVolume,
      sfx: openingSettings?.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume,
    },
  });
  // `SettingsScene` has read this key since long before anything wrote it.
  game.registry.set(AUDIO_REGISTRY_KEY, audioService);
  // Architecture 6: "UI sounds on SFX bus". D62 asks for a sound on every
  // interaction, and this game has three keyboard menus - the UI kit's
  // `FocusList`, the story lane's `createKeyboardMenu`, and the title screen's
  // own list. All three call `uiSoundBlip` from ui/focus.ts, so installing the
  // hook once here makes every menu in the game audible, including any built
  // after this line runs.
  // UR-133: a knob detent is `uiNav` at a pitch, not a twelfth SFX event.
  setUiSound((kind, amount) =>
    kind === "detent"
      ? audioService?.uiDetent(amount ?? 0)
      : audioService?.uiNav(),
  );
  wireAudioToFrames(game, audioService, context, backdrop, furthestBeacon(store) ?? "earth");

  const registered = new Set<string>();
  for (const { key, klass } of discovered) {
    game.scene.add(key, klass, false);
    registered.add(key);
  }
  if (lanternShot) {
    game.scene.add(LANTERN_SHOT_KEY, LanternShotScene, false);
    registered.add(LANTERN_SHOT_KEY);
  }

  // Asked-for scene wins if it registered; otherwise the first key that exists
  // in SCENE_KEYS order. `game.scene.getScene` cannot answer this yet - scenes
  // added before READY sit in the manager's pending queue.
  const requested = lanternShot ? LANTERN_SHOT_KEY : params.get("scene");
  const startKey =
    requested !== null && registered.has(requested)
      ? requested
      : (discovered[0]?.key ?? null);

  game.events.once(Phaser.Core.Events.READY, () => {
    if (startKey !== null) game.scene.start(startKey);
  });

  // The debug surface the e2e suite reads. Game-layer only; nothing in
  // src/engine knows this exists.
  (window as unknown as Record<string, unknown>)["__kb"] = {
    game,
    services: bundle,
    scenes: discovered.map((d) => d.key),
    startKey,
    i18nMisses: misses,
    reducedMotion: context.reducedMotion,
    // The wiring evidence reads this. It is the LIVE service the game is
    // playing through, not a copy and not a rebuilt graph, which is the whole
    // difference between "the audio exists" and "the audio is connected".
    audio: audioService,
    // The aspect-ratio e2e reads this to say how much bar FIT left and what is
    // painted in it, rather than eyeballing a screenshot for black.
    backdrop,
    // UR-18. The e2e asserts BOTH halves off this: `renderScale` > 1 on a
    // high-DPI display (the buffer followed the screen) while `designWidth`
    // and `designHeight` are unmoved (the world did not).
    renderScale: (): number => renderScale(),
  };

  game.events.once(Phaser.Core.Events.DESTROY, () => backdrop?.destroy());

  // The window is draggable, so the world's width has to keep following it.
  followWindowSize(game, backdrop);

  return game;
}
