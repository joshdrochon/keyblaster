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
import { STOP_IDS, isLang, type Lang, type StopId } from "../engine/types.js";

/** Registry key the service bundle is stored under. */
const SERVICES_KEY = "kb.services";

/**
 * Everything a scene needs from the game layer. Deliberately four members: a
 * scene that wants a fifth probably wants the engine instead.
 */
export interface GameServices {
  /** Presentation state shared across scenes (sceneKeys.ts). Mutable. */
  readonly context: SceneContext;
  /** Versioned local persistence (D43, D44). */
  readonly store: ProfileStore;
  /** UI copy. Never hard-code a string in a scene (D45). */
  t: Translator;
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

  const bundle: GameServices = {
    context,
    store,
    t: makeTranslator(pickLang(params, store)),
    setLang(lang: Lang): void {
      bundle.t = makeTranslator(lang);
      game.registry.set("kb.lang", lang);
      game.events.emit("kb.lang", lang);
    },
  };

  const discovered = await discoverScenes();

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
  };

  return game;
}
