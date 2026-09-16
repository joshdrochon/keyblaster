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
  SCENE_KEYS,
  type SceneContext,
} from "./sceneKeys.js";
import { hexToNum, paletteFor } from "./render/palette.js";
import { LANTERN_SHOT_KEY, LanternShotScene } from "./render/lanternShot.js";
import { createTranslator, type Translator } from "../engine/i18n/index.js";
import {
  DEFAULT_SHIP_NAME,
  createProfileStore,
  type ProfileStore,
} from "../engine/persistence/index.js";
import { DEFAULT_SETTINGS, STOP_IDS, isLang, type Lang, type StopId } from "../engine/types.js";
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
  const fromUrl = params.get("lang");
  if (fromUrl !== null && isLang(fromUrl)) return fromUrl;
  return store.activeProfile()?.settings.uiLang ?? "en";
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

  // Earth's bed opens the game so the title screen is not silent while it waits
  // for a scene that knows where it is.
  audio.ambientFor("earth");

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
// Boot
// ---------------------------------------------------------------------------

export interface BootOptions {
  parent?: string;
  /** Overrides the URL; used by tests that boot the game directly. */
  search?: string;
}

export async function bootGame(options: BootOptions = {}): Promise<Phaser.Game> {
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
      defaults: { shipName: store.activeProfile()?.shipName ?? DEFAULT_SHIP_NAME },
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
   * THE LETTERBOX (see ui/viewportBackdrop.ts for the full reasoning).
   *
   * `Scale.FIT` is kept deliberately: it is the only one of the three options
   * that keeps the flight play-field at exactly its design size on every window
   * (FR-8's fall-time budget is measured against a fixed fall distance) while
   * also keeping every HUD row on screen (AC-18.1 - `Scale.ENVELOP` would crop
   * about a quarter of the height at 21:9, and that is where the score and the
   * hint line live). What FIT leaves behind is two bars, so the bars get the
   * stop's own sky instead of black.
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

  const earth = paletteFor("earth");
  const voidColor = earth.colors[earth.colors.length - 1] ?? "#08111F";
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
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [],
  });

  game.registry.set(SERVICES_KEY, bundle);
  game.registry.set("kb.lang", bundle.t.lang);

  audioService = installAudio({
    // The voice language is fixed at construction. `setLang` does NOT rebuild
    // it: rebuilding the graph mid-session would drop the ambient bed and the
    // music with it, and the honest fix is a `setLang` on the voice transport
    // rather than a new graph. Known limitation, noted rather than hidden - a
    // child who switches language mid-run keeps the voice they booted with
    // until the next reload.
    graph: createAudioSystem({ lang: bundle.t.lang }),
    events: game.events,
    registry: game.registry,
    // Read from the flight lane rather than restated, so the two can never
    // drift apart into a silent game that still passes its own tests.
    cueEvent: FLIGHT_EVENTS.cue,
    hudEvent: FLIGHT_EVENTS.hud,
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
  setUiSound(() => audioService?.uiNav());
  wireAudioToFrames(game, audioService, context, backdrop);

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
  };

  game.events.once(Phaser.Core.Events.DESTROY, () => backdrop?.destroy());

  return game;
}
