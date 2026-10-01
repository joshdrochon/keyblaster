/**
 * Shared engine types. Pure TypeScript: this file, and every file under
 * src/engine, must never import Phaser or touch the DOM (CLAUDE.md HARD RULES).
 */

// `Knobs` is the difficulty controller's state and lives with the controller
// (`controller/knobs.ts`, which imports nothing), so this is a leaf import and
// not a cycle. It is here because the knob is PERSISTED - see `Profile.knobs`.
import type { Knobs } from "./controller/knobs.js";

/** UI and content languages (D45). */
export type Lang = "en" | "es" | "hi";

export const LANGS: readonly Lang[] = ["en", "es", "hi"] as const;

export function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

/**
 * Every stop. The first seven are the main route, Earth outward to Pluto
 * (D56, D57); Venus and Mercury are the bonus pair, inward from Earth, and
 * they are LAST in this array rather than in orbital order.
 *
 * ORDER IS ROUTE ORDER, NOT DISTANCE. `nextStop` walks this array and
 * `STOP_IDS[0]` is where a new pilot launches, so putting the inner planets
 * where they physically belong would start the game at Mercury. Anything that
 * wants distance ranks by the ephemeris instead - see `render/sunScale`.
 */
export type StopId =
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto"
  | "venus"
  | "mercury"
  | "zoozve";

export const STOP_IDS: readonly StopId[] = [
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "venus",
  "mercury",
  "zoozve",
] as const;

/** The main route: what a pilot flies before anything is a bonus. */
export const ROUTE_STOP_IDS: readonly StopId[] = STOP_IDS.slice(0, 7);

/**
 * The bonus pair, in the order the inner run visits them.
 *
 * Earth -> Venus -> Mercury: outward-in, so the sun grows and the difficulty
 * climbs together. They unlock only once Pluto is lit.
 */
export const BONUS_STOP_IDS: readonly StopId[] = ["venus", "zoozve", "mercury"];

/**
 * The bonus stops that are DRAWN AS A PLANET ON THE BOARD.
 *
 * A stop and a node on the chart are not the same thing, and Zoozve is the
 * first place that shows. It is a 232 m rock that shadows Venus - a
 * quasi-satellite, not a world - so drawing it as a fourth disc in the row
 * would put it in the same visual class as Mercury and state something untrue.
 * It is a real stop in every other sense: it unlocks, it is flown, it has a
 * belt, a bed and a beacon. It just hangs off Venus instead of standing on the
 * line. See `SATELLITE_OF`.
 */
export const INNER_BOARD_STOP_IDS: readonly StopId[] = ["venus", "mercury"];

/**
 * Stops drawn attached to another stop rather than on the route line, and what
 * they are attached to. Empty for every stop on the board.
 */
export const SATELLITE_OF: Readonly<Partial<Record<StopId, StopId>>> = Object.freeze({
  zoozve: "venus",
});

/** The stop this one orbits, or null when it stands on the line itself. */
export function satelliteHost(value: StopId): StopId | null {
  return SATELLITE_OF[value] ?? null;
}

export function isSatelliteStop(value: StopId): boolean {
  return satelliteHost(value) !== null;
}

/**
 * The stops that come from JPL's major-planet table (D15, AC-17.1).
 *
 * Zoozve is a 236 m asteroid, not a planet: it has no row in Table 1, no
 * published reference coordinates, and AC-17.1's +/-1 deg / +/-0.05 AU
 * tolerance is a claim about that table. Every ephemeris check keys on THIS
 * list, so adding a non-planet stop can never silently weaken a planet's bar.
 */
export const MAJOR_PLANET_STOP_IDS = [
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "venus",
  "mercury",
] as const;

export type MajorPlanetStopId = (typeof MAJOR_PLANET_STOP_IDS)[number];

export function isMajorPlanet(value: StopId): value is MajorPlanetStopId {
  return (MAJOR_PLANET_STOP_IDS as readonly StopId[]).includes(value);
}

export function isBonusStop(value: StopId): boolean {
  return BONUS_STOP_IDS.includes(value);
}

export function isStopId(value: string): value is StopId {
  return (STOP_IDS as readonly string[]).includes(value);
}

/**
 * Stage index along the route. Earth is the launchpad and has no belt (D57),
 * so belt stages are 1..6.
 */
export function stageIndexOf(stop: StopId): number {
  return STOP_IDS.indexOf(stop);
}

// ---------------------------------------------------------------------------
// Shared records. These are the contract between engine modules; nothing here
// may reference Phaser, the DOM, or localStorage directly (CLAUDE.md).
// ---------------------------------------------------------------------------

/** Keyboard layouts offered in settings (D41). */
export type KeyboardLayout = "qwerty" | "azerty" | "qwertz" | "dvorak";

/** How Hindi content is typed (D46). */
export type InputMethod = "latin" | "translit" | "inscript";

/**
 * Per-player, per-word memory (PRD FR-7). One record per
 * (profile, language, word). `ease` is the recognition-difficulty multiplier
 * used by fall time (FR-8) and selection weighting (FR-9).
 */
export interface WordRecord {
  exposures: number;
  hits: number;
  misses: number;
  typos: number;
  /**
   * Rolling samples, newest last, CAPPED (see words/pushCapped). Median is what
   * the engine reads. Because the cap evicts the oldest entries, `fkLatencyMs[0]`
   * is NOT the first exposure once a word passes the cap - use
   * `firstFkLatencyMs` for that. Retention words are by construction the
   * high-exposure words (D21), so this distinction is load-bearing for AC-20.3.
   */
  fkLatencyMs: number[];
  ikiMs: number[];
  /**
   * First-key latency at the word's FIRST ever exposure, never evicted.
   * AC-20.3 compares retention against first exposure; the rolling window
   * cannot answer that question.
   */
  firstFkLatencyMs: number | null;
  /** Clamped to [EASE_MIN, EASE_MAX]; new words start at EASE_NEW. */
  ease: number;
  /** Epoch ms of the last exposure, or null if never seen. */
  lastSeen: number | null;
  /** Earliest stage index this word may be re-served (D23). */
  nextEligibleStage: number;
}

/** Ease bounds, shared by words/, fallTime/ and selection/ (arch section 4.1). */
export const EASE_MIN = 0.25;
export const EASE_MAX = 2.0;
export const EASE_NEW = 1.6;

/** Baseline typing measurements from the pre-flight ritual (D51, FR-11). */
export interface Calibration {
  /** Median inter-key interval, ms. Default 350 (PRD FR-8). */
  ikiMs: number;
  /** Median first-key latency, ms. */
  fkLatencyMs: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  ikiMs: 350,
  fkLatencyMs: 500,
};

/** Everything the player can change in Settings (D41, FR-19). */
export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  keyboardLayout: KeyboardLayout;
  uiLang: Lang;
  contentLang: Lang;
  inputMethod: InputMethod;
  /** Lowercase is the default (D41). */
  uppercase: boolean;
  increasedLetterSpacing: boolean;
  reducedMotion: boolean;
  colorblindPalette: boolean;
  /** Opt-in, default off (D43). */
  relativeBoard: boolean;
  /**
   * THE PILOT'S DASH COLOUR (UR-123): what Ship Controls is dressed in.
   *
   * An OPAQUE ID, never a hex. The engine may not import the game layer, and
   * the set of colours is a presentation table (`game/ui/dash.DASH_COLORS`) the
   * same way `avatar` and `shipId` are - so what is stored is a name the
   * catalogue resolves, and `decodeProfile` bounds it as an id like the other
   * two rather than validating a colour it has no list for.
   *
   * `"amber"` is `INK.accent` to the byte, which is what this screen already
   * wore before the control existed, so a save made before it opens on exactly
   * the colour it had. `tests/unit/ui/dash.test.ts` holds this string and the
   * game layer's `DEFAULT_DASH_COLOR` together.
   */
  dashColor: string;
}

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.7,
  sfxVolume: 0.8,
  keyboardLayout: "qwerty",
  uiLang: "en",
  contentLang: "en",
  inputMethod: "latin",
  uppercase: false,
  increasedLetterSpacing: false,
  reducedMotion: false,
  colorblindPalette: false,
  relativeBoard: false,
  dashColor: "amber",
};

/** Star rating for a cleared stage, from hull hits (D27, AC-4.4). */
export type Stars = 0 | 1 | 2 | 3;

/** What the player achieved at one stop. */
export interface StopProgress {
  stopId: StopId;
  cleared: boolean;
  stars: Stars;
  bestWpm: number;
  bestAccuracy: number;
  /**
   * The MOST RECENT run's figures, kept separately from the bests. AC-20.1 asks
   * for the delta "vs previous stage", which is that stage's result, not its
   * all-time best: comparing against a best turns steady improvement after one
   * lucky run into a negative delta, which is the D31 failure mode exactly.
   */
  lastWpm: number;
  lastAccuracy: number;
  beaconPlacedAt: number | null;
}

/**
 * Stops that have a belt, i.e. everything except the Earth launchpad (D57).
 * Earth is cleared by typing one word (AC-12.1) and has no flight, so it has
 * no WPM and no accuracy - it must never be used as a "previous stage" for a
 * results delta.
 */
export const BELT_STOP_IDS: readonly StopId[] = STOP_IDS.slice(1);

export const isBeltStop = (stop: StopId): boolean => stop !== "earth";

/**
 * A profile, not an account (D43). Name + avatar only: no email, no PII.
 * Persisted to localStorage by persistence/ behind an injected storage port.
 */
export interface Profile {
  id: string;
  name: string;
  avatar: string;
  shipId: string;
  /** Defaults to "Lantern"; substituted into story text as {shipName} (C07). */
  shipName: string;
  createdAt: number;
  calibration: Calibration;
  /**
   * The difficulty controller's state, carried between belts (FR-10, D20, D53).
   *
   * ================== WHY THIS FIELD EXISTS (UR-51) ==================
   * It did not, and the whole controller was inert because of it.
   * `FlightScene.checkStageEnd` called `endStage`, got the right knob, emitted
   * it on `FLIGHT_EVENTS.stageComplete` - and `grep -rn
   * "FLIGHT_EVENTS.stageComplete" src/` returned one hit, the emit. Nothing
   * listened, nothing stored it, and neither route into the flight screen
   * passed it, so `FlightConfig.knobs` was `{}` and `maxLive` was 2 on every
   * belt of every run for every child. The engine was raising a ceiling nobody
   * could ever reach; `docs/verification-gaps.md` instance 24 is the write-up.
   *
   * IT HAS TO BE PERSISTED AND NOT MERELY HANDED ALONG. A route is seven stops
   * and children do not fly it in one sitting. A knob that lives in a scene
   * hand-off resets when the tab closes, and a knob that resets never climbs -
   * which is the same "difficulty never adapts" the child reported, wearing a
   * different coat.
   *
   * IT IS EARNED, SO `resetProfileProgress` CLEARS IT, unlike `calibration`
   * next door: a baseline is a measurement OF the child and survives a reset,
   * while a difficulty step is something they worked up to.
   */
  knobs: Knobs;
  settings: Settings;
  progress: StopProgress[];
  trophies: string[];
  unlockedShips: string[];
  unlockedSkins: string[];
  /** words[lang][word] */
  words: Record<string, Record<string, WordRecord>>;
}
