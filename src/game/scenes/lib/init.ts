import { clearStopOnProfile, type ClearInput } from "@engine/progress/index.js";
import type { Profile } from "@engine/types";
import type { ProfileStore } from "@engine/persistence/index.js";
import {
  applyCalibration,
  calibrationFromHistory,
  isDefaultCalibration,
  needsCalibration,
  refineCalibration,
  type ObservedTimings,
} from "@engine/calibration/index.js";
import { bookOf, withProfileBook, type WordBook } from "@engine/words/index.js";
import { services } from "@game/boot";
import Phaser from "phaser";
import { DEFAULT_SCENE_CONTEXT, SCENE_KEYS, type SceneContext } from "@game/sceneKeys";
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

// ---------------------------------------------------------------------------
// Calibration: the seam between `@engine/calibration` and the profile (D51)
// ---------------------------------------------------------------------------

/**
 * THE DEFECT THIS SECTION EXISTS FOR.
 *
 * `@engine/calibration` is complete, tested and under the 95% gate, and NOTHING
 * IN `src/` CALLED IT. `PreflightScene` planned the ritual only when
 * `story.newProfile` was true, and nothing anywhere ever set that flag - Title,
 * ProfilePicker and ProfileCreate all pass `false`. So `computeCalibration`
 * never ran; and even when it did (a harness mount), its result was handed to
 * Flight as scene data and never written to the profile. `calibrationFromHistory`
 * and `applyCalibration` had no callers outside the engine at all.
 *
 * WHAT THAT COST A CHILD. `calibration.ikiMs` was permanently 350 ms, FR-8's
 * default, for every player. Fall time is `len * 1.5 * ikiMs + 1200 * ease`, so
 * a grade-2 typist at 600 ms between keys was given 3207 ms to read and type
 * "fit" when they need 3600, and 5595 ms for "jupiter" when they need 6000.
 * Every cold word breached; a real playthrough stalled on Jupiter at spawn 18 of
 * 58 with two words cleared. The belt was not too hard - the game had never
 * found out who was flying it.
 *
 * THE SHAPE OF THE FIX. Newness is asked of the PROFILE (`needsCalibration`),
 * never of a payload flag that nothing sets; the ritual's result is written
 * through the store; and a profile that has history but never ran the ritual is
 * calibrated from that history, which is D51's own second clause.
 */

/** The live profile, or null in a standalone harness mount. */
export function activeProfile(scene: Phaser.Scene): Profile | null {
  return storeOf(scene)?.activeProfile() ?? null;
}

/**
 * AC-11.2, asked of the profile rather than of a payload flag.
 *
 * `needsCalibration` is true only for a profile with no typing history AND the
 * untouched FR-8 default baseline - i.e. one that has never been measured by
 * either route. That is the same predicate the engine already documents; the
 * only change is that something finally calls it.
 *
 * WHY `needsCalibration` IS NOT ENOUGH ON ITS OWN. Its first clause is
 * `!hasTypingHistory`, and `hasTypingHistory` counts a CLEARED STOP as history.
 * Earth is cleared by typing one word (AC-12.1, D57) and it is cleared BEFORE
 * the first pre-flight the game ever shows, so by the time a brand-new pilot
 * reaches this screen the predicate already says "returning" - and the ritual
 * would still never run for anybody. Earth's single word is also not stored
 * anywhere, so it calibrates nothing; it only makes the profile look measured.
 *
 * The question that actually decides this is "does the game have any way of
 * knowing how fast this child types?", and it has exactly two: a stored
 * baseline that is no longer the shipped default, or per-word samples that
 * `calibrationFromHistory` can rebuild one from. When neither exists, measuring
 * is the only honest option, and D51's ritual is what measuring is. Once either
 * exists this is false for ever after, so the ~20 s is still a once-per-profile
 * event.
 *
 * Standalone mounts have no store, so they fall back to "no": a scene booted
 * directly by the e2e must not silently start a twenty-second ritual.
 */
export function profileNeedsCalibration(scene: Phaser.Scene): boolean {
  const profile = activeProfile(scene);
  if (profile === null) return false;
  // Kept so the engine's own predicate still decides the case it was written
  // for; the second clause only widens it to the pilot Earth disguised.
  if (needsCalibration(profile)) return true;
  return (
    isDefaultCalibration(profile.calibration) &&
    isDefaultCalibration(calibrationFromHistory(profile))
  );
}

/**
 * The baseline this profile should actually fly with (D51).
 *
 * Three cases, in order:
 *   - a measured baseline is used as it stands;
 *   - an untouched default with stored per-word history is REBUILT from that
 *     history (`calibrationFromHistory`), which is D51's returning-player
 *     clause and was dead code until now;
 *   - an untouched default with no history stays the default, and the ritual
 *     (which `profileNeedsCalibration` has just agreed to) is what replaces it.
 *
 * Returns null only when there is no profile at all.
 */
export function storedCalibration(scene: Phaser.Scene): Calibration | null {
  const profile = activeProfile(scene);
  if (profile === null) return null;
  if (!isDefaultCalibration(profile.calibration)) return profile.calibration;
  return calibrationFromHistory(profile);
}

/**
 * Write a baseline through to the stored profile (AC-11.1 "stored on the
 * profile").
 *
 * `flush` rather than the 250 ms debounce, for the same reason ProfileCreate
 * flushes: the very next thing that happens after calibration is a belt, and a
 * child who closes the tab during it must not come back to a game that has
 * forgotten how fast they type.
 */
export function persistCalibration(
  scene: Phaser.Scene,
  calibration: Calibration,
): Calibration | null {
  const store = storeOf(scene);
  const profile = store?.activeProfile() ?? null;
  if (store === null || profile === null) return null;
  const updated = store.updateProfile(profile.id, (p: Profile) =>
    applyCalibration(p, calibration),
  );
  store.flush();
  return updated?.calibration ?? null;
}

/**
 * Fold a stage's observed timings into the stored baseline and hand back the
 * new one (D51's `refineCalibration`, at its documented per-stage alpha).
 *
 * This is the half that keeps working as the child changes. The ritual is a
 * once-per-profile event by design (AC-11.2); without this, a baseline measured
 * in October is still setting fall time in March, and a profile that predates
 * the ritual ever running is never measured at all.
 *
 * Returns null with no store, and leaves the baseline untouched when the stage
 * offered no usable sample (`refineCalibration`'s own rule).
 */
export function refineStoredCalibration(
  scene: Phaser.Scene,
  observed: ObservedTimings,
): Calibration | null {
  const store = storeOf(scene);
  const profile = store?.activeProfile() ?? null;
  if (store === null || profile === null) return null;
  const next = refineCalibration(profile.calibration, observed);
  return persistCalibration(scene, next);
}

// ---------------------------------------------------------------------------
// The word book: the seam between `@engine/words` and the profile (FR-7)
// ---------------------------------------------------------------------------

/**
 * THE DEFECT THIS SECTION EXISTS FOR.
 *
 * `FlightScene` built a `WordBook` and threw it away at stage end. `book: {}`
 * was the shipped default in `src/game/flight/stage.ts`, nothing read
 * `profile.words` and nothing wrote it, so FR-7's per-word memory, FR-8's
 * ease-based fall time, FR-9's selection weighting, AC-20.3's
 * retention-vs-first-exposure line and `calibrationFromHistory` all ran every
 * session on a book that was empty at launch.
 *
 * Same shape as the calibration seam above it, and for the same reason: the
 * ENGINE owns the rule (`applyToBook`, `withProfileBook`), this file owns the
 * two moments - stage start and stage end - and the scene owns neither.
 */

/**
 * The stored book for one content language, or null in a standalone mount.
 *
 * Returns `{}` rather than null for a profile that has one but has never met a
 * word in this language: that is an empty book, which is a real answer, and it
 * is different from "there is no profile".
 */
export function storedBook(scene: Phaser.Scene, lang: Lang): WordBook | null {
  const profile = activeProfile(scene);
  if (profile === null) return null;
  return bookOf(profile.words, lang);
}

/**
 * Write a stage's book through to the stored profile.
 *
 * `flush` rather than the 250 ms debounce, for the same reason the calibration
 * write flushes: what happens immediately after a belt is a warp break, a
 * beacon and a results screen, any of which a child may close the tab on, and
 * the belt they just flew is the only place those samples exist.
 *
 * Returns null with no store - a harness mount must not be able to write into a
 * real child's save.
 */
export function persistStageBook(
  scene: Phaser.Scene,
  lang: Lang,
  book: WordBook,
): WordBook | null {
  const store = storeOf(scene);
  const profile = store?.activeProfile() ?? null;
  if (store === null || profile === null) return null;
  const updated = store.updateProfile(profile.id, (p: Profile) =>
    withProfileBook(p, lang, book),
  );
  store.flush();
  return updated === null ? null : bookOf(updated.words, lang);
}

// ---------------------------------------------------------------------------
// Scene lifetime: one place at a time
// ---------------------------------------------------------------------------

/**
 * The scenes that are a PLACE. Exactly one of these may be live at a time.
 *
 * Everything else in SCENE_KEYS is an overlay that sits ON a place: the HUD and
 * the stall card sit on Flight, the warp break is drawn over the belt it just
 * finished (D30), and the pause menu can sit on anything.
 */
const PLACE_SCENES: readonly string[] = [
  SCENE_KEYS.title,
  SCENE_KEYS.profilePicker,
  SCENE_KEYS.profileCreate,
  SCENE_KEYS.earthActivation,
  SCENE_KEYS.map,
  SCENE_KEYS.briefing,
  SCENE_KEYS.preflight,
  SCENE_KEYS.flight,
  SCENE_KEYS.beacon,
  SCENE_KEYS.results,
  SCENE_KEYS.beaconLog,
  SCENE_KEYS.ending,
];

/** Overlays that exist only for the duration of a belt. */
const FLIGHT_OVERLAYS: readonly string[] = [
  SCENE_KEYS.hud,
  SCENE_KEYS.stall,
  SCENE_KEYS.warp,
];

/**
 * Stop every scene that has no business being alive once `target` is the place.
 *
 * WHY THIS IS NEEDED AT ALL. `ScenePlugin.start` stops only the scene that
 * called it, so a screen that is left by any other route - an overlay that
 * stops itself and then routes on, a scene whose transition fired from a tween
 * after something else had already moved - simply stays running, invisible
 * under whatever is drawn next. A real playthrough found two of them:
 * `["Briefing","Flight","Hud"]` after Results -> "fly it again", and
 * `["Preflight","Flight","Settings","Hud"]` on opening Settings from the pause
 * menu, where the leaked scenes were still holding the keyboard and Settings
 * answered nothing.
 *
 * Rather than patch each exit - there are a dozen, and the next one added is a
 * new leak - the invariant is enforced where every transition already passes.
 * A leak becomes a frame of double-drawing at worst instead of a dead keyboard.
 */
export function stopStaleScenes(scene: Phaser.Scene, target: string): void {
  const manager = scene.scene.manager;
  const alive = (key: string): boolean => {
    if (manager.keys[key] === undefined) return false;
    return (
      scene.scene.isActive(key) ||
      scene.scene.isPaused(key) ||
      scene.scene.isSleeping(key)
    );
  };
  for (const key of PLACE_SCENES) {
    if (key === target || key === scene.scene.key) continue;
    if (alive(key)) scene.scene.stop(key);
  }
  if (target === SCENE_KEYS.flight) return;
  for (const key of FLIGHT_OVERLAYS) {
    if (key === scene.scene.key) continue;
    if (alive(key)) scene.scene.stop(key);
  }
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
  // Before the new place is built, not after: a stale scene that is still
  // holding the keyboard must not get another frame of it.
  stopStaleScenes(scene, key);
  scene.scene.start(key, data);
  return true;
}
