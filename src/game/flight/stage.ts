import type {
  Calibration,
  InputMethod,
  KeyboardLayout,
  Lang,
  StopId,
} from "@engine/types.js";
import { DEFAULT_CALIBRATION, DEFAULT_SETTINGS } from "@engine/types.js";
import type { Knobs } from "@engine/controller/index.js";
import type { WordBook } from "@engine/words/index.js";

/**
 * Flight stage configuration: everything the core loop needs that is NOT a
 * rule (rules live in src/engine) and NOT a drawing (drawings live in
 * src/game/render).
 *
 * WHY THE POOLS ARE HERE AND NOT IN src/content. The content pipeline (D45,
 * D67, FR-12) ships `StageBundle { stopId, lang, briefing, pool[], preflight,
 * warpSentence, beaconText }` into src/content/<lang>/, and that lane owns
 * those files. Until it lands, the flight loop still has to fly, so this module
 * carries a small English pool per belt stop and builds an allowlist from it.
 * The seam is one function - `stagePoolFor` - so swapping in the real bundles
 * is a one-line change and nothing else in the scene moves.
 */

export interface PaletteColorblind {
  readonly accent: string;
  readonly debris: string;
}

export interface Palette {
  readonly name: string;
  readonly colors: readonly string[];
  readonly colorRoles: Readonly<Record<string, string>>;
  readonly accent: string;
  readonly plate: string;
  readonly plateText: string;
  readonly colorblind: PaletteColorblind;
}

/**
 * palettes.json, loaded through Vite rather than a static import: this repo
 * builds with `resolveJsonModule` off and tsconfig belongs to another lane, so
 * a glob import is the way to read content JSON without editing it.
 */
const PALETTE_MODULES = import.meta.glob("../../content/palettes.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const PALETTES = (Object.values(PALETTE_MODULES)[0] ?? {}) as Record<string, Palette>;

export function paletteFor(stop: StopId, colorblind = false): Palette {
  const base = PALETTES[stop];
  if (base === undefined) throw new Error(`no palette for stop: ${stop}`);
  if (!colorblind) return base;
  // D41: the colourblind variant separates accent and debris by luminance; the
  // word-plate pair is unchanged, because it already clears AC-22.8 by 18:1.
  return { ...base, accent: base.colorblind.accent };
}

export function allPalettes(): ReadonlyArray<readonly [string, Palette]> {
  return Object.entries(PALETTES);
}

// ---------------------------------------------------------------------------
// Colour distance. Used twice: to choose a sky that demonstrably travels, and
// by the e2e that measures whether it did (AC-22.3). One implementation.
// ---------------------------------------------------------------------------

function srgbChannelToLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0-255 per channel) to CIE L*a*b*, D65. */
export function rgbToLab(
  r: number,
  g: number,
  b: number,
): readonly [number, number, number] {
  const rl = srgbChannelToLinear(r);
  const gl = srgbChannelToLinear(g);
  const bl = srgbChannelToLinear(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): readonly [number, number, number] {
  const raw = hex.replace(/^#/, "");
  return rgbToLab(
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  );
}

/** CIE76 deltaE. AC-22.3 asks for > 10 between stage start and stage end. */
export function deltaE(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// Sky (art-direction section 2 L0, AC-22.3)
// ---------------------------------------------------------------------------

export interface SkyStops {
  readonly top: string;
  readonly middle: string;
  readonly bottom: string;
}

export interface SkyTravel {
  readonly start: SkyStops;
  readonly end: SkyStops;
}

/**
 * Where the sky starts and where it ends up.
 *
 * The end colour is not hand-picked per stop: it is the palette entry FURTHEST
 * from the starting colour in Lab. That is what makes AC-22.3 ("deltaE > 10 on
 * sampled sky") hold for all seven palettes by construction instead of holding
 * for the one stop somebody eyeballed - and it keeps the sky inside the stop's
 * own 5-7 colours, which AC-22.7 requires.
 */
export function skyTravelFor(palette: Palette): SkyTravel {
  const colors = palette.colors;
  const top = colors[0] as string;
  const middle = colors[1] ?? top;
  const bottom = colors[colors.length - 1] as string;
  const topLab = hexToLab(top);
  let farthest = middle;
  let best = -1;
  for (const c of colors.slice(1)) {
    const d = deltaE(topLab, hexToLab(c));
    if (d > best) {
      best = d;
      farthest = c;
    }
  }
  const midLab = hexToLab(middle);
  let endMiddle = bottom;
  let bestMid = -1;
  for (const c of colors) {
    if (c === farthest) continue;
    const d = deltaE(midLab, hexToLab(c));
    if (d > bestMid) {
      bestMid = d;
      endMiddle = c;
    }
  }
  return {
    start: { top, middle, bottom },
    end: { top: farthest, middle: endMiddle, bottom },
  };
}

/** The travel this stop's sky will actually show, in deltaE. */
export function skyTravelDeltaE(palette: Palette): number {
  const travel = skyTravelFor(palette);
  return deltaE(hexToLab(travel.start.top), hexToLab(travel.end.top));
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace(/^#/, "");
  const pb = b.replace(/^#/, "");
  const ch = (s: string, i: number): number =>
    Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  const out: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const v = Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t);
    out.push(Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"));
  }
  return `#${out.join("")}`;
}

export function skyAt(travel: SkyTravel, progress: number): SkyStops {
  const t = Math.max(0, Math.min(1, progress));
  return {
    top: mixHex(travel.start.top, travel.end.top, t),
    middle: mixHex(travel.start.middle, travel.end.middle, t),
    bottom: mixHex(travel.start.bottom, travel.end.bottom, t),
  };
}

// ---------------------------------------------------------------------------
// Stage word pools (placeholder for the content pipeline; see the note above)
// ---------------------------------------------------------------------------

const POOLS: Readonly<Record<StopId, readonly string[]>> = {
  earth: ["launch"],
  mars: [
    "red", "dust", "rock", "wind", "cold", "ice", "land", "moon", "sky",
    "water", "rivers", "empty", "valley", "storm", "crater", "planet",
    "orbit", "quiet", "giant", "north",
  ],
  jupiter: [
    "belt", "metal", "dark", "stone", "spin", "cloud", "storm", "moons",
    "huge", "ring", "iron", "gas", "field", "path", "lucky", "wide",
    "orbit", "deep", "junk", "trail",
  ],
  saturn: [
    "ice", "ring", "float", "dust", "moon", "titan", "lake", "pale",
    "gold", "wide", "shine", "cold", "glass", "chunk", "slow", "bath",
    "quiet", "edge", "north", "drift",
  ],
  uranus: [
    "side", "tilt", "dark", "ring", "cold", "green", "night", "long",
    "winter", "quiet", "faint", "icy", "spin", "pole", "thin", "blue",
    "years", "narrow", "shadow", "edge",
  ],
  neptune: [
    "wind", "storm", "blue", "deep", "fast", "dark", "moon", "cold",
    "triton", "back", "far", "hours", "light", "spot", "cloud", "ice",
    "quiet", "ring", "giant", "sea",
  ],
  pluto: [
    "heart", "frost", "small", "ice", "cold", "rock", "moon", "charon",
    "five", "far", "light", "slow", "plain", "edge", "quiet", "pink",
    "belt", "night", "snow", "dwarf",
  ],
};

export function stagePoolFor(stop: StopId): readonly string[] {
  return POOLS[stop];
}

/** Words from every earlier stop, for the AC-9.3 interleave. */
export function retentionPoolFor(stops: readonly StopId[]): readonly string[] {
  return stops.flatMap((s) => stagePoolFor(s));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface FlightConfig {
  readonly stopId: StopId;
  /** Stage index along the route (types.stageIndexOf). */
  readonly stage: number;
  readonly seed: number;
  readonly reducedMotion: boolean;
  readonly colorblindPalette: boolean;
  readonly uiLang: Lang;
  readonly contentLang: Lang;
  readonly inputMethod: InputMethod;
  readonly keyboardLayout: KeyboardLayout;
  readonly uppercase: boolean;
  readonly increasedLetterSpacing: boolean;
  /** C07: never hard-code "Lantern"; this is the profile's value. */
  readonly shipName: string;
  readonly calibration: Calibration;
  readonly book: WordBook;
  readonly knobs: Partial<Knobs>;
  /** Words this stage will spawn before it ends (FR-6). */
  readonly stageWordCount: number;
  /** How long the sky takes to travel from start to end (AC-22.3). */
  readonly stageDurationMs: number;
  /** Constant per stage and never a knob (AC-10.4). */
  readonly worldSpeedPxPerSec: number;
  /** Exposes the read-only debug surface the e2e measures through. */
  readonly debug: boolean;
}

export const DEFAULT_FLIGHT_CONFIG: FlightConfig = {
  stopId: "mars",
  stage: 1,
  seed: 20260916,
  reducedMotion: DEFAULT_SETTINGS.reducedMotion,
  colorblindPalette: DEFAULT_SETTINGS.colorblindPalette,
  uiLang: DEFAULT_SETTINGS.uiLang,
  contentLang: DEFAULT_SETTINGS.contentLang,
  inputMethod: DEFAULT_SETTINGS.inputMethod,
  keyboardLayout: DEFAULT_SETTINGS.keyboardLayout,
  uppercase: DEFAULT_SETTINGS.uppercase,
  increasedLetterSpacing: DEFAULT_SETTINGS.increasedLetterSpacing,
  shipName: "Lantern",
  calibration: DEFAULT_CALIBRATION,
  book: {},
  knobs: {},
  stageWordCount: 18,
  stageDurationMs: 90_000,
  worldSpeedPxPerSec: 110,
  debug: false,
};

export function flightConfigFrom(partial: Partial<FlightConfig> = {}): FlightConfig {
  return { ...DEFAULT_FLIGHT_CONFIG, ...partial };
}

/** Deterministic RNG; the engine never calls Math.random, and neither do we. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The scene-to-scene channel
// ---------------------------------------------------------------------------

export const FLIGHT_EVENTS = {
  hud: "kb:flight:hud",
  /** One entry per keystroke/blast/strike so the audio lane can hook it. */
  cue: "kb:flight:cue",
  stageComplete: "kb:flight:stage-complete",
  stall: "kb:flight:stall",
  restart: "kb:flight:restart",
} as const;

/** Everything the HUD draws. It computes nothing; scoring/ does (FR-6c). */
export interface HudSnapshot {
  readonly stopName: string;
  readonly wpm: number;
  readonly accuracy: number;
  readonly combo: number;
  /** hudMultiplierFor(combo): never "x0" on screen (AC-6c.1). */
  readonly multiplier: number;
  readonly score: number;
  readonly hull: number;
  readonly maxHull: number;
  readonly liveCount: number;
  readonly accent: string;
  readonly plate: string;
  readonly plateText: string;
}

/** Named cues, for the audio lane (AC-6e.2, AC-21.3). */
export type FlightCue =
  | "keystroke"
  | "lock"
  | "typo"
  | "ignored"
  | "blast"
  | "hit"
  | "shield"
  | "park"
  | "stall";
