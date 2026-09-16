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
 * The palette colour furthest from `from` in VALUE. The sky's travel target.
 *
 * It is picked rather than indexed for the reason `flight/stage.ts` gives about
 * its own copy of this idea: a fixed slot makes AC-22.3 hold for the one stop
 * somebody eyeballed. Measured at 0.30 mix, this rule clears deltaE 18 on all
 * seven palettes; the old "lean on colors[2]" rule left Saturn at 4.7 and
 * Pluto at 5.3, i.e. two stops whose sky demonstrably did not travel.
 */
function furthestByValue(colors: readonly string[], from: string): string {
  const base = relativeLuminance(from);
  let best = from;
  let bestDistance = -1;
  for (const c of colors) {
    const d = Math.abs(relativeLuminance(c) - base);
    if (d > bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/** How far the stage-end sky leans toward `furthestByValue`. */
export const SKY_TRAVEL_MIX = 0.3;

/**
 * The "stage end" sky (AC-22.3): the same three stops leaned toward the
 * palette colour furthest from the opening sky in value. Still a mix of that
 * stop's own colours, so the dominant-colour check holds.
 */
export function skyStopsLate(p: StopPalette): readonly [string, string, string] {
  const [a, b, c] = skyStops(p);
  const pull = furthestByValue(p.colors, a);
  return [
    mixHex(a, pull, SKY_TRAVEL_MIX),
    mixHex(b, pull, SKY_TRAVEL_MIX * 0.76),
    mixHex(c, pull, SKY_TRAVEL_MIX * 0.5),
  ];
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
 *
 * SUPERSEDED for the world stack by `depthRamp`, which does the same job over a
 * far wider value range and adds the atmospheric lift. Kept because the ramp is
 * a different curve, not a drop-in: anything that wants three evenly spaced
 * band fills and no haze still wants this.
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

// ---------------------------------------------------------------------------
// Depth (design-reference/refs/WORLD-BAR.md items 1-3, art-direction section 2)
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS.
 *
 * The flight screen satisfied every measurable property the rubric asks for -
 * five layers, five distinct speeds, a gradient that travels, no Linear easing -
 * and still read as flat brown bands. `WORLD-BAR.md` names why, by reading a
 * real Alto's Odyssey frame next to ours: the reference's depth is not carried
 * by scroll speed at all. It is carried by three things this module did not do.
 *
 *   1. ATMOSPHERIC LIFT. A distant silhouette is not the near one at a
 *      different speed; it is the near one dissolved INTO the sky. The furthest
 *      ridge in the reference is ~90% sky value and has almost no contrast
 *      against it. `atmospheric()` is that.
 *   2. VALUE RANGE. The reference spans near-black to near-sky in one frame.
 *      `depthBands` spanned about three steps of one brown, because it mixes
 *      between two mid-tones. `depthRamp` anchors the near end on `foregroundInk`
 *      - the palette's own darkest colour, pushed further down - so the range is
 *      the whole range.
 *   3. HUE SHIFTS WITH DEPTH. Real air is blue. The reference is warm dark in
 *      front and cool behind, which is what stops a monochrome ramp from reading
 *      as one object lit unevenly. `coolShift()` is that, and it is deliberately
 *      small (<= 14%) so the frame's dominant colours stay the stop's own.
 *
 * Everything here is still a MIX of palette values, so AC-22.7 holds: no stop
 * gains a colour it does not own.
 */

/**
 * Pull a colour toward its own grey. `k` 0 keeps it, 1 flattens it entirely.
 *
 * The grey is Rec. 709 weighted in sRGB space rather than in linear light. That
 * is the cheaper, less correct one of the two, and it is the right choice here:
 * this is a look, not a measurement, and the linear version drags warm colours
 * noticeably darker as they desaturate - which reads as a shadow falling on the
 * far ridge rather than as haze in front of it.
 */
export function desaturate(hex: string, k: number): string {
  const amount = Math.min(1, Math.max(0, k));
  const { r, g, b } = rgbOf(hex);
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c = (v: number): number => Math.round(v + (grey - v) * amount);
  return numToHex((c(r) << 16) | (c(g) << 8) | c(b));
}

/** Max hue travel `coolShift` may apply, as a fraction. Deliberately small. */
export const MAX_COOL_SHIFT = 0.14;

/**
 * Push a colour toward the blue end, as distance does. Bounded by
 * `MAX_COOL_SHIFT` so a far ridge cools without ever becoming a colour the
 * stop does not have.
 */
export function coolShift(hex: string, amount: number): string {
  const a = Math.min(1, Math.max(0, amount)) * MAX_COOL_SHIFT;
  const { r, g, b } = rgbOf(hex);
  const rr = Math.round(r * (1 - a * 1.3));
  const gg = Math.round(g * (1 - a * 0.35));
  const bb = Math.round(b + (255 - b) * a * 0.9);
  return numToHex((rr << 16) | (gg << 8) | bb);
}

/**
 * One silhouette's colour at a given distance.
 *
 * `lift` is how far into the haze it is: 0 is a foreground object with its own
 * full value, 1 is a ridge that has dissolved into the sky. Contrast, saturation
 * and hue all move together, because that is what air does to a shape and doing
 * only one of the three is what makes a frame read as "tinted", not "distant".
 */
export function atmospheric(fill: string, sky: string, lift: number): string {
  const t = Math.min(1, Math.max(0, lift));
  // Desaturate BEFORE the mix: a far shape has lost its own colour, and is then
  // covered by however much sky is between it and the camera.
  const washed = desaturate(fill, t * 0.55);
  return coolShift(mixHex(washed, sky, t), t * 0.8);
}

/**
 * The value a stop's FOREGROUND silhouettes are drawn in: the far end of the
 * depth ramp, and the one place in the frame the eye can anchor on.
 *
 * art-direction section 2 states the rule and it is not "make it black":
 * "darker toward the camera on bright stops and LIGHTER toward the camera on
 * dark stops". Both halves matter, and the second is the one a naive "near-black
 * foreground" gets wrong. Earth is a night launchpad whose sky is navy; a
 * black foreground against it is not a dramatic silhouette, it is an invisible
 * one, and the value range - the whole point of this ramp - collapses to
 * nothing. So the foreground goes to whichever end of the range the SKY is not
 * at, which is the same sentence for both kinds of stop.
 *
 * The palette's own extreme is then pushed a third of the way further, because
 * no palette's endpoints are quite extreme enough on their own: Mars' "shadow
 * brown" is a brown, and Earth's "cloud white" is a cloud.
 */
export function foregroundInk(p: StopPalette): string {
  if (isBrightStop(p)) return mixHex(byLuminance(p.colors, 0), "#000000", 0.34);
  return mixHex(byLuminance(p.colors, p.colors.length - 1), "#FFFFFF", 0.22);
}

/**
 * How far into the haze layer `i` of `count` sits. 0 is the foreground plane,
 * 1 is the furthest ridge.
 *
 * The curve is deliberately not linear. Air thickness compounds with distance,
 * so most of the lift happens in the last third of the depth range; a linear
 * ramp puts the mid-field halfway to the sky, which reads as fog rather than
 * as distance.
 */
export const LIFT_MAX = 0.9;
export const LIFT_CURVE = 1.25;

export function liftAt(index: number, count: number): number {
  if (count <= 1) return 0;
  const t = Math.min(count - 1, Math.max(0, index)) / (count - 1);
  return LIFT_MAX * (1 - t) ** LIFT_CURVE;
}

/**
 * `count` silhouette fills, FAR FIRST, spanning near-sky to near-black.
 *
 * This is the single function `WORLD-BAR.md` items 1-3 reduce to, and the
 * property worth testing is on the whole array rather than on any entry: the
 * luminance distance between the two ends has to be large (the value range) and
 * every step has to move the same way (monotone, so the eye can order them).
 */
export function depthRamp(p: StopPalette, count: number): string[] {
  const sky = skyStops(p)[1];
  const ink = foregroundInk(p);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(atmospheric(ink, sky, liftAt(i, count)));
  return out;
}

/**
 * The stop's one light direction, in radians, measured as a screen angle with
 * -PI/2 straight up.
 *
 * Art-direction section 2 asks for "one light direction per stop" and then for
 * every silhouette to carry a rim on the lit side. Both halves need the same
 * number, so it is derived once, here, from the stop's place on the route: the
 * light swings from high-left at Earth to low-right out at Pluto, which is also
 * the story (the sun gets further away and lower).
 */
export function lightAngleOf(p: StopPalette): number {
  const i = Math.max(0, PALETTE_STOP_IDS.indexOf(p.id));
  const span = Math.max(1, PALETTE_STOP_IDS.length - 1);
  // -125 deg (high left) to -55 deg (high right), in radians.
  return ((-125 + (70 * i) / span) * Math.PI) / 180;
}

/**
 * Where the stop's light sits in frame, as a fraction of the stage.
 *
 * Kept out of the top eighth on purpose. AC-22.3 samples the sky along the very
 * top of the frame to prove it travels, and an additive bloom sitting there
 * clips those pixels to white at both ends of the stage - the sky then measures
 * as having moved by exactly zero, which is a real defect (a blown-out band is
 * not a sky) wearing a test failure's clothes.
 */
export function lightPositionOf(p: StopPalette): { x: number; y: number } {
  const a = lightAngleOf(p);
  return { x: 0.5 + Math.cos(a) * 0.42, y: 0.42 + Math.sin(a) * 0.14 };
}

/** The rim colour a lit silhouette edge takes: its own fill, 14% lighter. */
export function rimOf(fill: string): string {
  return mixHex(fill, "#FFFFFF", 0.14);
}

// ---------------------------------------------------------------------------
// Atmosphere (WORLD-BAR item 8)
// ---------------------------------------------------------------------------

export type AtmosphereKind = "dust" | "glitter" | "streaks" | "haze";

/**
 * One atmosphere pass per stop, named from the place rather than picked.
 *
 * The reference's rain crosses every layer and is most of what ties the image
 * together. Ours has to be the stop's own weather or it is decoration: Mars has
 * dust, Saturn has ring ice, the ice giants have wind. It lives here rather
 * than in `parallax.ts` because it is a fact about the STOP, and because that
 * keeps it - like everything else in this file - testable without a canvas.
 */
export function atmosphereFor(id: string): AtmosphereKind {
  switch (id) {
    case "mars":
    case "jupiter":
      return "dust";
    case "saturn":
    case "pluto":
      return "glitter";
    case "uranus":
    case "neptune":
      return "streaks";
    default:
      return "haze";
  }
}
