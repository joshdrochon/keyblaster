import type {
  Calibration,
  InputMethod,
  KeyboardLayout,
  Lang,
  StopId,
} from "@engine/types.js";
import { DEFAULT_CALIBRATION, DEFAULT_SETTINGS, stageIndexOf } from "@engine/types.js";
import type { Knobs } from "@engine/controller/index.js";
import type { WordBook } from "@engine/words/index.js";
import { hasStageBundle, stageBundle } from "@game/scenes/lib/content.js";
import { LAYERS, layer } from "@game/render/layers.js";

/**
 * Flight stage configuration: everything the core loop needs that is NOT a
 * rule (rules live in src/engine) and NOT a drawing (drawings live in
 * src/game/render).
 *
 * WHERE THE POOLS COME FROM. The content pipeline (D45, D67, FR-12) ships
 * `StageBundle { stopId, lang, briefing, pool[], preflight, warpSentence,
 * beaconText }` into src/content/<lang>/, and `stagePoolFor` reads it. This
 * module used to carry a hand-written stand-in table instead, and that table
 * was the mechanism of the D09 defect: the belt flew one list of words while
 * the warp break highlighted another, so "the sentence is made of the words
 * you blasted" was false by construction. The table is gone; the seam is the
 * same one function it always was.
 */

// ---------------------------------------------------------------------------
// Where the word plates draw (AC-22.8, UR-23)
// ---------------------------------------------------------------------------

/**
 * The Phaser depth of the word-plate container.
 *
 * Here rather than in `FlightScene` so it is a NUMBER UNDER THE UNIT GATE
 * instead of a constant inside a Phaser scene that only an e2e can reach. The
 * rule it encodes - nothing the world draws may reach a word - was true of the
 * gameplay rocks and false of the decorative ones for as long as this lived
 * next to the thing it was protecting. See the long note in `FlightScene` for
 * the five layers that were drawing over a plate at 4.5 and for what putting
 * the plate above the ship costs.
 *
 * Below `hud` because the HUD is a different scene on its own contrast plate
 * inside a keep-out no rock enters (layers.ts L7), so the two never meet.
 */
export const PLATE_LAYER_DEPTH = layer("hud").depth - 0.1;

/**
 * Every layer a word plate has to outrank, by name.
 *
 * `LAYERS` minus the HUD. Derived rather than listed, so a layer added to the
 * stack in front of the ship is covered by `tests/unit/flight/plateDepth` the
 * day it is added rather than the day a player reports it.
 */
export const LAYERS_BELOW_PLATES = LAYERS.filter((l) => l.id !== "hud");

/**
 * Keep-out at each edge of the playfield, px at the design width.
 *
 * The near plane carries near-black framing masses down both edges
 * (render/parallax.ts) which reach about 8.5% of the stage. A rock spawns clear
 * of them: a foreground that covers a word costs a child a rock, which is the
 * same defect as one rock covering another rock's plate.
 *
 * Moved here from `FlightScene` when the HUD gained the stop name (UR-21): the
 * HUD draws above everything, so a readout that reached into this corridor
 * would cover a falling word - the very defect UR-23 is about - and the check
 * that it does not (`tests/unit/flight/hudKeepOut`) needs the number without
 * importing Phaser.
 *
 * ================== IT IS THE PLATE THAT HAS TO CLEAR, NOT THE ROCK ==========
 * Writing that check found that a plate could already cross the HUD. The
 * longest word in any shipped pool is "spinning": its plate is 108.4 px to a
 * side against its rock's 48, so the leftmost such plate reached x=259.6 while
 * the HUD's left readout ends at x=260. Four tenths of a pixel - a hairline,
 * not the sixteen this note first claimed, and the claim is corrected here
 * rather than quietly deleted.
 *
 * The first fix was to widen this margin from 320 to 352. It is not the one
 * that shipped, because it moves every rock in the game to solve a problem
 * about one readout, and a margin is not where a plate-width mistake belongs.
 *
 * A NOTE ON WHAT DID NOT HAPPEN, because the first version of this comment got
 * it wrong: `V-22.4` was red on the 352 run and green on a 320 run, and that
 * was read as cause. Repeated three times each, with the UR-22 hull lamp
 * present and with it hidden, that item passes about one run in three either
 * way - the weakest object is a different one every time, and one reading was a
 * degenerate 0.0001 with the inside and the outside identical. It is flaky
 * independently of this lane. No margin, and no lamp, moved it.
 *
 * The defect was in `FlightScene.laneSpec`, which sized the spawn keep-out by
 * the ROCK's half-width on the stated grounds that "the plate is narrower than
 * the rock at every length". It is wider, at every length above one, by up to
 * 60 px a side. Fixing that keeps a plate inside this margin at every word and
 * leaves 60 px of daylight instead of minus four tenths, without moving the
 * margin at all.
 */
export const SPAWN_MARGIN_PX = 320;

// ---------------------------------------------------------------------------
// Hit stop (UR-33)
// ---------------------------------------------------------------------------

/**
 * HOW LONG THE PICTURE HOLDS WHEN A ROCK IS DESTROYED.
 *
 * The player asked for Vlambeer's hit lag: freeze for a frame or three at the
 * moment of impact so the hit reads as something the ship had to push through,
 * rather than as a sprite being switched off.
 *
 * ================== WHY THE SHORT END OF THEIR RANGE ==================
 * They asked for 1-3 frames. In an action game hit stop punctuates OCCASIONAL
 * impacts; here it fires on every completed word - 58 times in a belt, about
 * once every two seconds (`flight/stage.stageWordCount`'s own arithmetic) -
 * while a seven-year-old is mid-word and still typing. A hold that lands well
 * once reads as the game stuttering by the twentieth time, and the thing a
 * typing game cannot afford to damage is flow.
 *
 * Two frames at the 60 fps target (AC-22.9). Long enough to be a beat, short
 * enough that it cannot be mistaken for a hitch.
 *
 * ================== WHAT IT IS NOT ==================
 * It is not a sleep and it does not touch the clock. Frames keep rendering and
 * the event loop is never blocked: `FlightScene.update` simply declines to
 * advance the WORLD for two frames. Input is on a `window` listener rather than
 * a per-frame poll, so a keystroke during the hold is handled the instant it
 * arrives - and `tests/e2e/hit-stop.spec.ts` types through the hold to prove it.
 * A blocking implementation would drop keystrokes in a typing game and no
 * headless assertion would ever see it.
 *
 * It also costs nothing on the perf budget, and in the direction people expect
 * to be surprised by: a held frame does LESS work, so P-22.9's p95 frame time
 * can only go down.
 */
export const HIT_STOP_FRAMES = 2;
export const HIT_STOP_MS = Math.round((HIT_STOP_FRAMES * 1000) / 60);

/**
 * The hold for a blast, in ms. Zero under reduced motion.
 *
 * REDUCED MOTION TAKES IT, and the call is not obvious - a hold is the absence
 * of motion, so there is a reading where D41 has nothing to say about it. The
 * reading that decides it is what the setting is FOR: a player who turns off
 * motion effects is commonly a player for whom sudden stop-start is the
 * problem, and a world that halts and lurches twice a second is stop-start.
 * Nothing about the belt's rules depends on it (AC-19.3: framing motion goes,
 * gameplay stays), so it is framing, and framing goes.
 *
 * ONLY A BLAST. A hull strike does not hold. Freezing the game on the player's
 * mistake is emphasis on the mistake, and D31 asks that a child always feel
 * like the best typer in the world; AC-22b.1 forbids the surface framing a run
 * as something lost. The strike already has its shake, its scorch and its lamp
 * (UR-22), and all three are about the ship rather than about the player.
 */
export const hitStopMs = (reducedMotion: boolean, holdMs: number = HIT_STOP_MS): number =>
  reducedMotion ? 0 : Math.max(0, holdMs);

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
// Stage word pools - the shipped content bundles (D09, D45, D67)
// ---------------------------------------------------------------------------

/**
 * The words this stop's belt may spawn: the stage bundle's own asteroid pool,
 * which is also the pool the warp sentence is drawn from (AC-12.3 requires
 * every content word of the sentence to be in it).
 *
 * THIS IS THE D09 SEAM. Flight spawns from this list and the warp break
 * highlights from the run recorded while flying it (`blastHistory.ts`), so the
 * two are the same vocabulary by construction. A second, private table here -
 * which is what used to be here - makes the game's founding claim untrue
 * without anything failing.
 *
 * EARTH IS THE ONE SPECIAL CASE, and it is content, not a placeholder. Earth is
 * the launchpad and has no belt (D57), so its bundle ships `pool: []` and one
 * `activationWord` - the single word that lights the beacon (AC-12.1). Handing
 * back that word keeps `createSelectionState` buildable for anything that does
 * boot a belt there, and it is still a real content word rather than an
 * invented one.
 */
export function stagePoolFor(stop: StopId): readonly string[] {
  if (!hasStageBundle(stop)) return [];
  const bundle = stageBundle(stop);
  if (bundle.pool.length > 0) return bundle.pool;
  const activation = bundle.activationWord;
  return activation === null ? [] : [activation];
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
  /**
   * Words this stage will spawn before it ends (FR-6).
   *
   * WHY 58 AND NOT 18. A belt was over in about three quarters of a minute and
   * the player said so. The yardstick in the decision log's Origin section is
   * Type Storm: three waves plus a boss, 1.5-2.5 minutes. The target is
   * therefore 90-150 s for a median grade 3-5 typist.
   *
   * THE ARITHMETIC, because "make it longer" is not a number. It is checked by
   * `tests/unit/flight/stageLength.test.ts`, against the real word pool, so
   * this number cannot drift back without the estimate moving with it.
   *
   *   A belt is paced by the PLAYER, not by the spawner. `DEFAULT_CALIBRATION`
   *   puts a median child at ikiMs 350 and fkLatencyMs 500, and Mars' shipped
   *   pool averages 4.6 letters, so one word costs
   *       (500 + 3.6 x 350) / 1000 + 0.3 = 2.07 s
   *   where the 0.3 is choosing the next rock. That is the real clock: at
   *   `maxLive` 2-7 the board holds several words, but a child types them one
   *   at a time.
   *       58 x 2.07 s = 120 s   median
   *       58 x 1.75 s = 101 s   a quick child (iki -25%)
   *       58 x 2.38 s = 138 s   a slow one    (iki +25%)
   *   which sits inside the band at every speed, with the median in the middle
   *   of it rather than on the edge.
   *
   * AND WHY THE BOARD DOES NOT BECOME A WALL. The count is the only thing that
   * moved: `trySpawn` gates on `controller.knobs.maxLive` (2-7, FR-10), so the
   * number of rocks in the air at once is what it always was; there are simply
   * more of them over the stage.
   *
   * THAT GATE WAS NOT ENOUGH, AND THIS IS WHERE THIS NOTE USED TO BE WRONG. It
   * said the belt "still leaves 850 ms between spawns, so the number of rocks in
   * the air at once is exactly what it was". `maxLive` caps what is LIVE, not
   * what is FED, and a rock nobody is typing is still falling: at one word every
   * 850 ms against a child who clears one every two seconds, the surplus did not
   * queue, it landed, and three landings empty the hull (D27). The arithmetic
   * above is the arithmetic of a belt paced by the player, so the spawner now
   * has to be paced by the player too - `@engine/pacing`, driven from this
   * player's calibration and from what the last few rocks actually cost them.
   * At 18 words the stage ended before that caught up with it; at 58 it did not.
   */
  readonly stageWordCount: number;
  /** How long the sky takes to travel from start to end (AC-22.3). */
  readonly stageDurationMs: number;
  /** Constant per stage and never a knob (AC-10.4). */
  readonly worldSpeedPxPerSec: number;
  /**
   * UR-33's hold, ms. `HIT_STOP_MS` unless a caller says otherwise.
   *
   * A CONFIG FIELD AND NOT A CONSTANT READ IN THE SCENE, for a reason that is
   * about measurement rather than about tuning. The shipped hold is two frames
   * at 60 fps - 33 ms - and a headless page renders this scene at about 4.5 fps,
   * where 33 ms is a seventh of ONE frame. A spec asking "did the world stop"
   * there can never see a held frame, and would be green whether or not the
   * feature existed.
   *
   * So the length is a value the game carries, `tests/e2e/hit-stop.spec.ts`
   * lengthens it to span frames on a slow renderer, and
   * `tests/unit/flight/hitStop.test.ts` pins the shipped default. The alternative
   * - a test-only branch inside the scene - would mean the thing under test and
   * the thing that ships were different code.
   *
   * It is NOT a difficulty knob: the knob set is exactly {maxLive, lengthBias}
   * (AC-10.4) and nothing reads this to decide anything about the belt.
   */
  readonly hitStopMs: number;
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
  stageWordCount: 58,
  // The sky's travel is a felt duration and has to match the belt's: at 90 s
  // against a ~45 s belt the sky never arrived anywhere, which is half of why
  // AC-22.3 was true on paper and invisible in play. 105 s is comfortably under
  // the 120 s median belt, so the sky lands before the last rock does.
  stageDurationMs: 105_000,
  worldSpeedPxPerSec: 110,
  hitStopMs: HIT_STOP_MS,
  debug: false,
};

/**
 * `stage` is DERIVED from `stopId` unless a caller states it.
 *
 * WHY THIS MATTERS NOW AND DID NOT BEFORE. `stage` is the clock D23's spacing
 * runs on: `nextEligibleStage` is written as "current stage + 1, 2 or 4", and
 * `isEligible` refuses a word until the route has moved that far. Nothing on
 * the real path ever set it - `PreflightScene` hands Flight a `StoryInit`, which
 * has no `stage` field - so every belt in the shipped game was stage 1.
 *
 * That was harmless only because the word book was thrown away at stage end:
 * `nextEligibleStage` never survived to be compared against anything. The
 * moment the book persists, a pinned stage index is a bug with teeth - a word
 * answered well at Mars writes `nextEligibleStage: 3`, and a permanently
 * stage-1 belt would then refuse it at Jupiter, at Saturn and for ever.
 *
 * The stage index is a pure function of the stop (`types.stageIndexOf`), so
 * this derives it rather than adding a seventh field to the hand-off chain that
 * a screen can forget. `DEFAULT_FLIGHT_CONFIG.stopId` is Mars and
 * `stageIndexOf("mars")` is 1, so every existing caller gets what it had.
 */
export function flightConfigFrom(partial: Partial<FlightConfig> = {}): FlightConfig {
  const merged = { ...DEFAULT_FLIGHT_CONFIG, ...partial };
  if (partial.stage !== undefined) return merged;
  return { ...merged, stage: stageIndexOf(merged.stopId) };
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
  /**
   * D30. The warp break is an OVERLAY on the live belt, not a different screen,
   * so the thing that accelerates at the end of it is Flight's own world. Warp
   * emits a multiplier on this channel and Flight scales its parallax by it.
   *
   * An event rather than a handle on purpose: Warp must work with NO Flight
   * behind it (every `?scene=Warp` boot in the e2e suite is exactly that), and
   * an emit into an empty room is the one form of coupling that degrades
   * correctly.
   */
  warpSpeed: "kb:flight:warp-speed",
} as const;

/** What `FLIGHT_EVENTS.warpSpeed` carries. */
export interface WarpSpeedPayload {
  /** Multiple of the stage's own world speed. 1 is the belt's normal pace. */
  readonly multiplier: number;
}

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
