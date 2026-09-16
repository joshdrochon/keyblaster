/**
 * Scene registry contract (D78, design-brief-v2.md "Screen inventory").
 *
 * trace-check enforces both directions: a scene file with no inventory row
 * fails, and an inventory row with no scene fails. This file is the single
 * place the two are reconciled, so parallel scene lanes agree on keys without
 * touching each other's files.
 *
 * The `inventoryRow` string must match the design brief's row text exactly.
 */

export const SCENE_KEYS = {
  boot: "Boot",
  title: "Title",
  profilePicker: "ProfilePicker",
  profileCreate: "ProfileCreate",
  earthActivation: "EarthActivation",
  map: "DirectorMap",
  briefing: "Briefing",
  preflight: "Preflight",
  flight: "Flight",
  stall: "Stall",
  warp: "Warp",
  beacon: "Beacon",
  results: "Results",
  beaconLog: "BeaconLog",
  settings: "Settings",
  ending: "Ending",
  pause: "Pause",
  hud: "Hud",
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

/** Design-reference resolution; art-direction artboards are 1920x1080 (D81). */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/**
 * Every scene reads and writes this. It is deliberately NOT the engine's
 * GameState: scenes own presentation, the engine owns rules (architecture §2).
 */
export interface SceneContext {
  /** Active profile id, or null before one is chosen. */
  profileId: string | null;
  /** Stop the player is travelling to, for briefing/flight/warp/beacon. */
  stopId: string | null;
  /** Set by Settings; scenes must honour it (D41, AC-19.3). */
  reducedMotion: boolean;
  colorblindPalette: boolean;
}

export const DEFAULT_SCENE_CONTEXT: SceneContext = {
  profileId: null,
  stopId: null,
  reducedMotion: false,
  colorblindPalette: false,
};

/**
 * Scene -> screen-inventory row (D78). The row text must match
 * docs/design-brief-v2.md's "Screen inventory" table EXACTLY.
 *
 * This map exists because scene names are legitimately shorter than row labels
 * ("Warp" vs "Warp break") and one scene can serve a row it does not share a
 * name with. Fuzzy name matching either rejects correct scenes or accepts
 * anything; a declared map makes adding a scene force you to say which row it
 * satisfies, which is the whole point of D78.
 */
export const SCENE_INVENTORY_ROW: Record<SceneKey, string> = {
  Boot: "",
  Title: "Title",
  ProfilePicker: "Profile picker",
  ProfileCreate: "Profile create",
  EarthActivation: "Earth activation",
  DirectorMap: "Director map",
  Briefing: "Briefing",
  Preflight: "Pre-flight",
  Flight: "Flight",
  Stall: "Stall card",
  Warp: "Warp break",
  Beacon: "Beacon placement",
  Results: "Results",
  BeaconLog: "Beacon Log",
  Settings: "Settings",
  Ending: "Ending card",
  Pause: "Pause",
  // The HUD is an overlay scene layered on Flight (art-direction L7), not a
  // screen of its own. It satisfies row 6 alongside FlightScene.
  Hud: "Flight",
};

/**
 * Inventory rows that are deliberately NOT Phaser scenes. Each needs a reason:
 * an unexplained exemption is how a completeness check stops meaning anything.
 */
export const NON_SCENE_ROWS: Record<string, string> = {
  Toasts: "non-blocking overlay drawn by the UI kit over whatever scene is live",
  "Reset confirm": "modal drawn by the UI kit inside Settings",
  "Relative-board opt-in": "one-time prompt drawn inside Results",
  Transitions: "scored moments BETWEEN scenes; owned by the transition runner",
  Notices: "non-blocking line drawn by the UI kit; not a screen",
};
