/**
 * Shared engine types. Pure TypeScript: this file, and every file under
 * src/engine, must never import Phaser or touch the DOM (CLAUDE.md HARD RULES).
 */

/** UI and content languages (D45). */
export type Lang = "en" | "es" | "hi";

export const LANGS: readonly Lang[] = ["en", "es", "hi"] as const;

export function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

/** The seven stops, Earth outward to Pluto (D56, D57). */
export type StopId =
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto";

export const STOP_IDS: readonly StopId[] = [
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

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
  settings: Settings;
  progress: StopProgress[];
  trophies: string[];
  unlockedShips: string[];
  unlockedSkins: string[];
  /** words[lang][word] */
  words: Record<string, Record<string, WordRecord>>;
}
