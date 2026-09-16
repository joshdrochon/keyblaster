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
