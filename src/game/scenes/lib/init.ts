import { clearStopOnProfile, type ClearInput } from "@engine/progress/index.js";
import type { Profile } from "@engine/types";
import type { ProfileStore } from "@engine/persistence/index.js";
import { services } from "@game/boot";
import Phaser from "phaser";
import { DEFAULT_SCENE_CONTEXT, type SceneContext } from "@game/sceneKeys";
import {
  DEFAULT_CALIBRATION,
  type Calibration,
  type Lang,
  type StopId,
  type StopProgress,
} from "@engine/types";
import { createSceneText, type SceneText } from "./strings";

/**
 * What every story screen is handed when it starts.
 *
 * Scenes are presentation only (CLAUDE.md), so none of them reads localStorage,
 * computes progress or decides what is unlocked: the caller passes the profile
 * slice in and the scene draws it. That is also what makes the design brief's
 * screen-inventory VARIANTS testable - "Mars only unlocked", "mid-run", "all
 * seven" are three different `progress` arrays into the same scene, not three
 * code paths.
 */
export interface StoryInit {
  readonly ctx?: SceneContext;
  readonly progress?: readonly StopProgress[];
  /** C07: interpolated into copy as `{shipName}`; never hard-coded. */
  readonly shipName?: string;
  readonly lang?: Lang;
  /** D51 / AC-11.2: true only for a profile that has never been calibrated. */
  readonly newProfile?: boolean;
  readonly calibration?: Calibration;
  /** Overrides `ctx.stopId` when a caller wants to be explicit. */
  readonly stopId?: StopId;
}

export interface ResolvedInit {
  readonly ctx: SceneContext;
  readonly progress: readonly StopProgress[];
  readonly shipName: string;
  readonly lang: Lang;
  readonly newProfile: boolean;
  readonly calibration: Calibration;
  readonly stopId: StopId;
  readonly text: SceneText;
}

/** Defaults that let any scene boot standalone (e2e, storybook-style harness). */
export function resolveInit(data: StoryInit | undefined, fallbackStop: StopId): ResolvedInit {
  const ctx: SceneContext = data?.ctx ?? { ...DEFAULT_SCENE_CONTEXT };
  // profile.shipNameDefault is the engine's own default; a caller that has a
  // profile passes the child's chosen name instead (C07).
  const shipName = data?.shipName ?? "Lantern";
  // SceneContext (sceneKeys.ts, which this lane may not edit) carries no
  // language, so the caller passes it; Settings owns the value.
  const lang: Lang = data?.lang ?? "en";
  return {
    ctx,
    progress: data?.progress ?? [],
    shipName,
    lang,
    newProfile: data?.newProfile ?? false,
    calibration: data?.calibration ?? DEFAULT_CALIBRATION,
    stopId: data?.stopId ?? (ctx.stopId as StopId | null) ?? fallbackStop,
    text: createSceneText({ lang, shipName }),
  };
}

/** Progress for one stop, or a blank record if the profile has never been there. */
export function progressFor(
  progress: readonly StopProgress[],
  stopId: StopId,
): StopProgress {
  const found = progress.find((p) => p.stopId === stopId);
  if (found !== undefined) return found;
  return {
    stopId,
    cleared: false,
    stars: 0,
    bestWpm: 0,
    bestAccuracy: 0,
    lastWpm: 0,
    lastAccuracy: 0,
    beaconPlacedAt: null,
  };
}

/**
 * Which stops the Director map may fly to (D56: Earth -> Mars -> ... -> Pluto).
 *
 * WHERE THIS BELONGS. It is a progression rule, and CLAUDE.md says rules live
 * in src/engine. There is no progression module in the engine today, and this
 * lane may not add one, so the derivation sits here, in one function, stated
 * once: Earth is always open, and a stop opens when the stop before it has been
 * cleared. If an engine module lands, this function becomes a call into it and
 * the map does not change.
 *
 * A locked stop is still drawn, still focusable and still readable. Locked
 * means "not yet", never "denied" (D31).
 */
/**
 * Route progression now lives in `@engine/progress` - it is a rule, it is
 * pure, and in the engine it sits under the 95% coverage gate. These two are
 * re-exported so existing scene imports keep working.
 */
export { isCharted, unlockedStops } from "@engine/progress/index.js";

/**
 * The service bundle, or null when this scene was booted standalone.
 *
 * `services()` throws before `bootGame()` has run, which is a supported way to
 * mount ONE screen in a harness. Every reader here wants "the store if there is
 * one", so the throw is answered once, in this file.
 */
function storeOf(scene: Phaser.Scene): ProfileStore | null {
  try {
    return services(scene).store;
  } catch {
    return null;
  }
}

/**
 * The stored profile's progress, or null when there is no store/profile.
 *
 * THIS IS THE FIX FOR THE STALE-PAYLOAD BUG. A `progress` array threaded
 * through Flight -> Warp -> Beacon -> Results -> Map is five chances to hand on
 * the array a scene was GIVEN instead of the one it just changed, and that is
 * exactly what happened: a cleared Mars never opened Jupiter. The store is the
 * one copy that cannot go stale, because every writer writes through it, so a
 * screen that is about to make a progression decision asks the store rather
 * than the payload it was handed.
 */
export function storedProgress(
  scene: Phaser.Scene,
): readonly StopProgress[] | null {
  return storeOf(scene)?.activeProfile()?.progress ?? null;
}

/**
 * Fill in `progress` from the store when the caller did not supply one.
 *
 * Payload-first is deliberate and is what keeps the screen-inventory VARIANTS
 * testable (init.ts header): "Mars only unlocked" / "mid-run" / "all seven" are
 * three payloads into the same scene. In the real game nothing hands the map a
 * payload - it is reached from the Title, from Pause and from a reload - so the
 * store is what it actually reads.
 */
export function withStoredProgress(
  scene: Phaser.Scene,
  data: StoryInit | undefined,
): StoryInit | undefined {
  if (data?.progress !== undefined) return data;
  const stored = storedProgress(scene);
  if (stored === null) return data;
  return { ...data, progress: stored };
}

/**
 * Write a cleared stop through to the stored profile and hand back the profile's
 * NEW progress array.
 *
 * Scene-to-scene init payloads carry progress for the CURRENT run; the store is
 * what makes it survive a reload (D44, AC-7.2). Returning the stored array is
 * what stops the two from disagreeing: the caller forwards what was actually
 * written rather than its own local copy of it.
 *
 * `input` carries the figures the calling screen happens to know.
 * `markStopCleared` is idempotent on `beaconPlacedAt` and monotone on the
 * bests, so Beacon may write the clear with no rates and Results may fold the
 * rates in afterwards without either undoing the other.
 *
 * Returns null when there is no store or no active profile - a standalone
 * harness mount - and the caller falls back to its own array.
 */
export function persistStopCleared(
  scene: Phaser.Scene,
  stopId: StopId,
  input: Partial<ClearInput> = {},
): readonly StopProgress[] | null {
  const store = storeOf(scene);
  if (store === null) return null;
  const profile = store.activeProfile();
  if (profile === null) return null;
  const updated = store.updateProfile(profile.id, (p: Profile) =>
    clearStopOnProfile(p, stopId, { atMs: Date.now(), ...input }),
  );
  store.flush();
  return updated?.progress ?? null;
}

/**
 * Start another scene if the registry has it, otherwise announce the
 * transition and stay put.
 *
 * The scene lanes land in parallel, so Briefing may exist before Flight does.
 * A `scene.start` on a key Phaser does not know throws and takes the screen
 * down; this degrades to an event, which is also what the e2e suite listens
 * for when it wants to assert a transition without booting the whole game.
 */
export function goTo(
  scene: Phaser.Scene,
  key: string,
  data?: StoryInit,
): boolean {
  scene.events.emit("story-transition", key, data);
  scene.game.events.emit("story-transition", key, data);
  if (scene.scene.manager.keys[key] === undefined) return false;
  scene.scene.start(key, data);
  return true;
}
