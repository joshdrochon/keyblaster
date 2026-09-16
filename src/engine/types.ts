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
  /** Samples, newest last. Median is what the engine reads. */
  fkLatencyMs: number[];
  ikiMs: number[];
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
  beaconPlacedAt: number | null;
}

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
