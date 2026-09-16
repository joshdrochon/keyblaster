/**
 * PALETTES (D60 rubric item 7, AC-22.7, art-direction.md section 3).
 *
 * `src/content/palettes.json` is the rubric's own copy of the seven stop
 * palettes: V-22.7 reads that file and counts colours. This module is the ONLY
 * place the game reads it, and it never alters a value. Everything exported
 * here either returns a palette verbatim or derives a new colour by MIXING two
 * palette colours, which keeps a rendered frame inside "dominant colours are a
 * subset of the palette +/- tolerance".
 *
 * Why the file is read with `?raw` + JSON.parse instead of `import ... from
 * "*.json"`: `resolveJsonModule` is off in tsconfig.json and scene lanes may
 * not edit tsconfig. Vite's `?raw` suffix is typed by `vite/client`, so this
 * compiles and bundles with no config change and no runtime fetch.
 *
 * Colourblind variants (D41): the JSON ships a `colorblind` block per stop with
 * an accent and a debris fill separated by luminance. `colorblindVariant()`
 * substitutes those two and leaves plate contrast alone, exactly as the art
 * direction specifies.
 */

import { STOP_IDS, type StopId, isStopId } from "../../engine/types.js";
import rawPalettes from "../../content/palettes.json?raw";

// ---------------------------------------------------------------------------
// Shape of the JSON
// ---------------------------------------------------------------------------

interface RawColorblind {
  readonly accent: string;
  readonly debris: string;
}

interface RawPalette {
  readonly name: string;
  readonly colors: readonly string[];
  readonly colorRoles: Readonly<Record<string, string>>;
  readonly accent: string;
  readonly plate: string;
  readonly plateText: string;
  readonly colorblind: RawColorblind;
}

/**
 * One stop's palette as the renderer wants it: the JSON verbatim, plus two
 * derived conveniences (`debris`, `colorblindMode`) that carry the D41 signal
 * without every caller re-deriving it.
 */
export interface StopPalette {
  readonly id: StopId;
  /** Display name of the stop ("Mars"). A proper noun, not UI copy. */
  readonly name: string;
  /** 5-7 colours, declared light -> deep (AC-22.7). */
  readonly colors: readonly string[];
  readonly colorRoles: Readonly<Record<string, string>>;
  /** Exactly one accent (AC-22.7). */
  readonly accent: string;
  readonly plate: string;
  readonly plateText: string;
  /** The fill debris takes, so hue is never the only signal (D41). */
  readonly debris: string;
  /** True when this is the colourblind-safe variant. */
  readonly colorblindMode: boolean;
}

const PARSED = JSON.parse(rawPalettes) as Record<string, RawPalette>;

/** The nth-darkest colour in a palette, clamped. Defined before `build` uses it. */
function byLuminance(colors: readonly string[], rank: number): string {
  const sorted = [...colors].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  return sorted[Math.min(rank, sorted.length - 1)] ?? "#808080";
}

function build(id: StopId, colorblind: boolean): StopPalette {
  const raw = PARSED[id];
  if (raw === undefined) throw new Error(`palettes.json has no stop "${id}"`);
  return Object.freeze({
    id,
    name: raw.name,
    colors: Object.freeze([...raw.colors]),
    colorRoles: Object.freeze({ ...raw.colorRoles }),
    accent: colorblind ? raw.colorblind.accent : raw.accent,
    plate: raw.plate,
    plateText: raw.plateText,
    // Debris takes the third-darkest palette colour. Picked by LUMINANCE, not
    // by index: the JSON's colour order is a reading order, not a value ramp,
    // and taking a slot by position gives Earth white rocks on a night sky.
    // Third-darkest lands on rust for Mars, deep blue for Earth, ring shadow
    // for Saturn - a rock that reads as a rock at every stop.
    debris: colorblind ? raw.colorblind.debris : byLuminance(raw.colors, 2),
    colorblindMode: colorblind,
  });
}

const NORMAL = new Map<StopId, StopPalette>(STOP_IDS.map((id) => [id, build(id, false)]));
const COLORBLIND = new Map<StopId, StopPalette>(STOP_IDS.map((id) => [id, build(id, true)]));

/** Every stop that has a palette, in route order (Earth -> Pluto). */
export const PALETTE_STOP_IDS: readonly StopId[] = STOP_IDS;

/** The stop's palette exactly as `palettes.json` declares it. */
export function paletteFor(stopId: string): StopPalette {
  if (!isStopId(stopId)) throw new Error(`unknown stop id: ${stopId}`);
  const p = NORMAL.get(stopId);
  if (p === undefined) throw new Error(`no palette built for ${stopId}`);
  return p;
}

/** The D41 colourblind-safe variant: accent and debris fill separated by luminance. */
export function colorblindVariant(stopId: string): StopPalette {
  if (!isStopId(stopId)) throw new Error(`unknown stop id: ${stopId}`);
  const p = COLORBLIND.get(stopId);
  if (p === undefined) throw new Error(`no colourblind palette built for ${stopId}`);
  return p;
}

/** One call for scenes that already hold the SceneContext flag. */
export function paletteAt(stopId: string, colorblind: boolean): StopPalette {
  return colorblind ? colorblindVariant(stopId) : paletteFor(stopId);
}

// ---------------------------------------------------------------------------
// Colour maths. Phaser wants 0xRRGGBB numbers; the rubric speaks in hex strings.
// ---------------------------------------------------------------------------

/** "#F1C79A" -> 0xF1C79A. Tolerates a missing "#". */
export function hexToNum(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16) || 0;
}

export function numToHex(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

export function rgbOf(hex: string): { r: number; g: number; b: number } {
  const n = hexToNum(hex);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Linear mix; t=0 is `a`, t=1 is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const A = rgbOf(a);
  const B = rgbOf(b);
  const c = (x: number, y: number): number => Math.round(x + (y - x) * k);
  return numToHex((c(A.r, B.r) << 16) | (c(A.g, B.g) << 8) | c(A.b, B.b));
}

/** WCAG relative luminance, 0..1. Used for the value-step depth rule. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const at = (colors: readonly string[], i: number, fallback: string): string =>
  colors[i] ?? fallback;

/**
 * Sky gradient stops, top -> bottom (art-direction L0: "3-4 stops").
 *
 * The palettes are declared light-to-deep, so the first two entries are the
 * sky and the last is the ground/void. Nothing is invented.
 */
export function skyStops(p: StopPalette): readonly [string, string, string] {
  const first = at(p.colors, 0, "#000000");
  return [first, at(p.colors, 1, first), at(p.colors, p.colors.length - 1, first)];
}

/**
 * The "stage end" sky (AC-22.3): the same three stops leaned toward the
 * palette's third colour, which is every palette's strongest mid-tone. Still a
 * mix of that stop's own colours, so the dominant-colour check holds.
 */
export function skyStopsLate(p: StopPalette): readonly [string, string, string] {
  const [a, b, c] = skyStops(p);
  const pull = at(p.colors, 2, b);
  return [mixHex(a, pull, 0.34), mixHex(b, pull, 0.26), mixHex(c, pull, 0.18)];
}

/** True when this stop reads as a bright-sky stop (Mars, Saturn, Pluto...). */
export function isBrightStop(p: StopPalette): boolean {
  return relativeLuminance(skyStops(p)[1]) > 0.22;
}

/**
 * `count` silhouette-band fills, far -> near.
 *
 * Art-direction section 2: "depth comes from value steps between layers,
 * darker toward the camera on bright stops and lighter toward the camera on
 * dark stops". This is that rule, computed instead of hand-picked, so it works
 * for all seven palettes without a per-stop table.
 */
export function depthBands(p: StopPalette, count: number): string[] {
  const [, skyMid, deep] = skyStops(p);
  const light = at(p.colors, 0, skyMid);
  const bright = isBrightStop(p);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const step = count === 1 ? 1 : (i + 1) / count;
    out.push(
      bright
        ? mixHex(skyMid, deep, 0.22 + 0.62 * step)
        : mixHex(skyMid, light, 0.08 + 0.3 * step),
    );
  }
  return out;
}
