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
export function unlockedStops(
  progress: readonly StopProgress[],
  order: readonly StopId[],
): ReadonlySet<StopId> {
  const open = new Set<StopId>();
  let previousCleared = true;
  for (const stop of order) {
    if (previousCleared) open.add(stop);
    previousCleared = progress.find((p) => p.stopId === stop)?.cleared ?? false;
  }
  return open;
}

/** A stop is charted once its beacon is placed (D13). */
export function isCharted(progress: readonly StopProgress[], stopId: StopId): boolean {
  const entry = progress.find((p) => p.stopId === stopId);
  return entry !== undefined && entry.beaconPlacedAt !== null;
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
