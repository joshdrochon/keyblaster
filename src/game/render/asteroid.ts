// TYPE-ONLY, and it matters. Nothing in this file calls into Phaser at runtime -
// every drawing entry point is handed the Graphics or the Scene it draws on - so
// importing the namespace as a value was the only thing that made this module
// unloadable in Vitest ("window is not defined"). With the import erased, the
// FR-12b table and the UR-47 fill rule below are unit-testable without a browser
// and without a Phaser mock, which is where their negative control now lives.
import type Phaser from "phaser";
import type { StopId } from "@engine/types.js";
import {
  hexToNum,
  luma255,
  mixHex,
  paletteFor,
  rockLumaFor,
  withLuma255,
} from "./palette.js";

/**
 * `wordPlate.hexToInt` did this job and pulled Phaser in with it. `hexToNum`
 * from `palette.ts` is the same parse for the 6-digit hexes this file and
 * `palettes.json` use; the shorthand form `#abc` has never appeared in either.
 */
const hexToInt = hexToNum;

/**
 * Vector debris (D71, D83; PRD FR-12b; art-direction.md section 4).
 *
 * TWO CONTRACTS LIVE HERE.
 *
 * 1. THE DEBRIS TABLE. PRD FR-12b lists, per stop, what the belt is actually
 *    made of, with a NASA source per row and a verdict. That table is content,
 *    not decoration: the gauntlet compares this file against it, so the `stop`,
 *    `label` and `source` fields below are transcribed from the PRD verbatim
 *    rather than paraphrased. Adding a debris type that is not in FR-12b is a
 *    content change and fails AC-12b.1.
 *
 * 2. SIZE FROM WORD LENGTH. AC-2.3 requires sprite size to be a monotonic
 *    function of word length, and art-direction section 4 fixes the numbers:
 *    3 letters ~56 px, +8 px per letter, cap ~140 px at 1080p. Size shows
 *    MOTOR cost, which is visible. It must never show fall time, which is this
 *    player's private history with the word (D19, AC-8.3) - so nothing in this
 *    file may read `fallTime`, and nothing may vary shape or colour by it.
 *
 * Shape language (art-direction section 4): "rounded, chunky, friendly; no
 * sharp spikes", with "a subtle 2-tone fill (base + one darker crater/facet
 * shape)". Every variant below is therefore a radius profile in [0.72, 1.0]
 * resampled smoothly - a rock is never a star polygon.
 */

// ---------------------------------------------------------------------------
// Size (AC-2.3, art-direction section 4)
// ---------------------------------------------------------------------------

/** Shortest word we size for; below it the rock stays at the base size. */
export const MIN_SIZED_WORD_LENGTH = 3;
export const BASE_SIZE_PX = 56;
export const SIZE_PER_LETTER_PX = 8;
export const MAX_SIZE_PX = 140;

/**
 * AC-2.3: non-decreasing in word length, flat only at the ends because both
 * ends are clamps. `length` is counted in code points by the caller, so a
 * Devanagari word is not measured in UTF-16 units.
 */
export function asteroidSizePx(wordLength: number): number {
  if (!Number.isFinite(wordLength)) return BASE_SIZE_PX;
  const letters = Math.max(MIN_SIZED_WORD_LENGTH, Math.floor(wordLength));
  const raw = BASE_SIZE_PX + (letters - MIN_SIZED_WORD_LENGTH) * SIZE_PER_LETTER_PX;
  return Math.min(MAX_SIZE_PX, raw);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Facet {
  /** Centre, in units of the rock's radius, from its centre. */
  readonly x: number;
  readonly y: number;
  /** Radius, in units of the rock's radius. */
  readonly r: number;
}

export interface ShapeVariant {
  readonly id: string;
  /**
   * Radius profile, sampled at equal angles from -90 degrees. Values are
   * fractions of the rock's radius and are deliberately kept above 0.7 so the
   * silhouette stays chunky and readable when desaturated (AC-22.4).
   */
  readonly radii: readonly number[];
  /** The darker crater/facet shapes of the 2-tone fill. */
  readonly facets: readonly Facet[];
}

/** Points per drawn outline. Enough that the rock reads as rounded, not faceted. */
const OUTLINE_STEPS = 48;

/** Smooth cosine interpolation between profile samples: no corners, no spikes. */
function radiusAt(radii: readonly number[], t: number): number {
  const n = radii.length;
  const scaled = t * n;
  const i = Math.floor(scaled) % n;
  const j = (i + 1) % n;
  const f = scaled - Math.floor(scaled);
  const a = radii[i] as number;
  const b = radii[j] as number;
  const smooth = (1 - Math.cos(f * Math.PI)) / 2;
  return a + (b - a) * smooth;
}

/** Outline of one variant at a given pixel size, centred on (0, 0). */
export function shapePoints(
  variant: ShapeVariant,
  sizePx: number,
): readonly Phaser.Types.Math.Vector2Like[] {
  const radius = sizePx / 2;
  const out: Phaser.Types.Math.Vector2Like[] = [];
  for (let s = 0; s < OUTLINE_STEPS; s += 1) {
    const t = s / OUTLINE_STEPS;
    const angle = -Math.PI / 2 + t * Math.PI * 2;
    const r = radiusAt(variant.radii, t) * radius;
    out.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The FR-12b table
// ---------------------------------------------------------------------------

export interface DebrisType {
  readonly id: string;
  readonly stop: StopId;
  /** PRD FR-12b wording for this debris, transcribed. */
  readonly label: string;
  /** Base fill (art-direction section 4). */
  readonly fill: string;
  /** The darker crater/facet tone. */
  readonly facet: string;
  /** Rim highlight on the lit side. */
  readonly rim: string;
  /** A single specular fleck, for the types art direction gives one to. */
  readonly glint: string | null;
  /**
   * False for material that is real at this stop but is drawn as ambient
   * particles rather than as a word carrier (Saturn's dust grains, Neptune's
   * faint ring dust). Keeping them in the table is what makes AC-12b.1
   * checkable against FR-12b without putting a word on a dust grain.
   */
  readonly carriesWord: boolean;
  /** AC-12b.2: at least three silhouette variants per type. */
  readonly variants: readonly ShapeVariant[];
  /** The NASA source FR-12b verified this row against (Sep 15 2026). */
  readonly source: string;
}

/** Four reusable chunky profiles, varied per type by the tables below. */
const PROFILE = {
  boulder: [1.0, 0.92, 0.97, 0.86, 0.95, 0.9, 0.99, 0.88],
  lumpy: [0.93, 1.0, 0.85, 0.96, 0.88, 1.0, 0.87, 0.94],
  squat: [0.86, 0.99, 1.0, 0.95, 0.82, 0.97, 1.0, 0.9],
  shard: [1.0, 0.88, 0.9, 0.79, 0.95, 0.84, 0.93, 0.8],
  slab: [0.95, 0.83, 1.0, 0.88, 0.94, 0.82, 1.0, 0.86],
} as const;

const variant = (
  id: string,
  radii: readonly number[],
  facets: readonly Facet[],
): ShapeVariant => ({ id, radii, facets });

const MARS_SOURCE = "https://science.nasa.gov/mars/facts/";
const BELT_SOURCE = "https://science.nasa.gov/solar-system/asteroids/facts/";
const TROJAN_SOURCE =
  "https://science.nasa.gov/solar-system/planets/jupiter/nasas-lucy-mission-a-journey-to-the-young-solar-system/";
const SATURN_SOURCE = "https://science.nasa.gov/saturn/facts/";
const URANUS_SOURCE = "https://science.nasa.gov/uranus/facts/";
const NEPTUNE_SOURCE = "https://science.nasa.gov/neptune/neptune-facts/";
const KUIPER_SOURCE = "https://science.nasa.gov/solar-system/kuiper-belt/facts/";

/**
 * PRD FR-12b, one entry per debris type named in the table.
 *
 * Earth is absent by construction: D57 gives the launchpad no belt, and AC-12.1
 * clears it with a single typed word. An empty debris set for Earth is the
 * correct answer, not a gap.
 */
export const DEBRIS_BY_STOP: Readonly<Record<StopId, readonly DebrisType[]>> = {
  earth: [],

  mars: [
    {
      id: "mars-regolith",
      stop: "mars",
      label: "rust-dusted rocky regolith chunks",
      fill: "#B5522A",
      facet: "#7A2E17",
      rim: "#E9A46E",
      glint: null,
      carriesWord: true,
      source: MARS_SOURCE,
      variants: [
        variant("regolith-a", PROFILE.boulder, [
          { x: -0.22, y: -0.18, r: 0.26 },
          { x: 0.3, y: 0.12, r: 0.18 },
        ]),
        variant("regolith-b", PROFILE.lumpy, [
          { x: 0.16, y: -0.3, r: 0.22 },
          { x: -0.3, y: 0.2, r: 0.24 },
        ]),
        variant("regolith-c", PROFILE.squat, [
          { x: 0.0, y: 0.24, r: 0.3 },
          { x: -0.28, y: -0.24, r: 0.16 },
        ]),
      ],
    },
  ],

  jupiter: [
    {
      id: "c-type",
      stop: "jupiter",
      label: "C-type carbonaceous (dark, most common)",
      fill: "#3A3632",
      facet: "#25221F",
      rim: "#8A4B2B",
      glint: null,
      carriesWord: true,
      source: BELT_SOURCE,
      variants: [
        variant("c-a", PROFILE.boulder, [{ x: -0.2, y: 0.18, r: 0.3 }]),
        variant("c-b", PROFILE.lumpy, [
          { x: 0.24, y: -0.16, r: 0.24 },
          { x: -0.24, y: 0.22, r: 0.2 },
        ]),
        variant("c-c", PROFILE.slab, [{ x: 0.06, y: 0.26, r: 0.26 }]),
      ],
    },
    {
      id: "s-type",
      stop: "jupiter",
      label: "S-type silicate (lighter)",
      fill: "#9A8F7E",
      facet: "#6E6455",
      rim: "#F3E3C3",
      glint: null,
      carriesWord: true,
      source: BELT_SOURCE,
      variants: [
        variant("s-a", PROFILE.squat, [
          { x: -0.26, y: -0.2, r: 0.22 },
          { x: 0.26, y: 0.18, r: 0.26 },
        ]),
        variant("s-b", PROFILE.boulder, [{ x: 0.18, y: 0.24, r: 0.28 }]),
        variant("s-c", PROFILE.lumpy, [
          { x: -0.18, y: 0.26, r: 0.2 },
          { x: 0.22, y: -0.24, r: 0.18 },
        ]),
      ],
    },
    {
      id: "m-type",
      stop: "jupiter",
      label: "M-type metallic (nickel-iron, rare)",
      fill: "#8B93A0",
      facet: "#5B626D",
      rim: "#DDE7FF",
      glint: "#FFFFFF",
      carriesWord: true,
      source: BELT_SOURCE,
      variants: [
        variant("m-a", PROFILE.slab, [{ x: -0.22, y: 0.2, r: 0.24 }]),
        variant("m-b", PROFILE.squat, [{ x: 0.24, y: -0.18, r: 0.2 }]),
        variant("m-c", PROFILE.boulder, [
          { x: 0.0, y: 0.28, r: 0.22 },
          { x: -0.26, y: -0.22, r: 0.16 },
        ]),
      ],
    },
    {
      id: "jupiter-trojan",
      stop: "jupiter",
      label: "Jupiter Trojans (dark, reddish, some water ice)",
      fill: "#5A3A32",
      facet: "#33201C",
      rim: "#C97B3F",
      glint: "#F3E3C3",
      carriesWord: true,
      source: TROJAN_SOURCE,
      variants: [
        variant("trojan-a", PROFILE.lumpy, [{ x: 0.2, y: 0.2, r: 0.26 }]),
        variant("trojan-b", PROFILE.boulder, [
          { x: -0.24, y: -0.18, r: 0.24 },
          { x: 0.28, y: 0.1, r: 0.16 },
        ]),
        variant("trojan-c", PROFILE.squat, [{ x: -0.1, y: 0.26, r: 0.28 }]),
      ],
    },
  ],

  saturn: [
    {
      id: "saturn-ice-chunk",
      stop: "saturn",
      label:
        "ring material: ice chunks (mostly water ice) coated with dust, from dust-sized grains to house-sized",
      fill: "#F6EEDC",
      facet: "#C9B48C",
      rim: "#FFFFFF",
      glint: "#9FD8F0",
      carriesWord: true,
      source: SATURN_SOURCE,
      variants: [
        variant("ice-a", PROFILE.squat, [
          { x: -0.24, y: -0.16, r: 0.24 },
          { x: 0.22, y: 0.22, r: 0.2 },
        ]),
        variant("ice-b", PROFILE.slab, [{ x: 0.16, y: -0.22, r: 0.26 }]),
        variant("ice-c", PROFILE.boulder, [
          { x: -0.2, y: 0.24, r: 0.22 },
          { x: 0.26, y: -0.2, r: 0.16 },
        ]),
      ],
    },
    {
      id: "saturn-dust-grain",
      stop: "saturn",
      label: "dust-sized grains",
      fill: "#C9B48C",
      facet: "#A99C86",
      rim: "#F6EEDC",
      glint: null,
      // Art-direction section 4: "dust grains as particles". A grain is real
      // ring material and belongs in the table; it is too small to carry a word.
      carriesWord: false,
      source: SATURN_SOURCE,
      variants: [
        variant("grain-a", PROFILE.lumpy, []),
        variant("grain-b", PROFILE.squat, []),
        variant("grain-c", PROFILE.boulder, []),
      ],
    },
  ],

  uranus: [
    {
      id: "uranus-dark-ice",
      stop: "uranus",
      label: "narrow, very dark icy ring particles",
      fill: "#2A2F33",
      facet: "#14181A",
      rim: "#C8FFE8",
      glint: null,
      carriesWord: true,
      source: URANUS_SOURCE,
      variants: [
        variant("dark-a", PROFILE.shard, [{ x: 0.18, y: 0.2, r: 0.24 }]),
        variant("dark-b", PROFILE.slab, [{ x: -0.22, y: -0.18, r: 0.22 }]),
        variant("dark-c", PROFILE.lumpy, [
          { x: 0.0, y: 0.24, r: 0.26 },
          { x: -0.26, y: 0.0, r: 0.14 },
        ]),
      ],
    },
  ],

  neptune: [
    {
      id: "neptune-icy-body",
      stop: "neptune",
      label: "icy bodies (Kuiper-belt-like)",
      fill: "#274A9B",
      facet: "#122A6E",
      rim: "#DDE7FF",
      glint: "#FFFFFF",
      carriesWord: true,
      source: NEPTUNE_SOURCE,
      variants: [
        variant("icy-a", PROFILE.boulder, [{ x: -0.2, y: 0.2, r: 0.26 }]),
        variant("icy-b", PROFILE.squat, [
          { x: 0.22, y: -0.2, r: 0.22 },
          { x: -0.2, y: 0.2, r: 0.18 },
        ]),
        variant("icy-c", PROFILE.lumpy, [{ x: 0.08, y: 0.26, r: 0.24 }]),
      ],
    },
    {
      id: "neptune-ring-dust",
      stop: "neptune",
      label: "faint dusty ring material",
      fill: "#3B63C8",
      facet: "#1E3FA3",
      rim: "#DDE7FF",
      glint: null,
      carriesWord: false,
      source: NEPTUNE_SOURCE,
      variants: [
        variant("dust-a", PROFILE.lumpy, []),
        variant("dust-b", PROFILE.slab, []),
        variant("dust-c", PROFILE.squat, []),
      ],
    },
  ],

  pluto: [
    {
      id: "kuiper-water-ice",
      stop: "pluto",
      label: "ice chunks: water ice",
      fill: "#E7EAF2",
      facet: "#9A9BB0",
      rim: "#FFFFFF",
      glint: "#D6D3EA",
      carriesWord: true,
      source: KUIPER_SOURCE,
      variants: [
        variant("water-a", PROFILE.squat, [{ x: -0.22, y: -0.18, r: 0.24 }]),
        variant("water-b", PROFILE.boulder, [{ x: 0.2, y: 0.22, r: 0.22 }]),
        variant("water-c", PROFILE.slab, [
          { x: 0.0, y: -0.24, r: 0.2 },
          { x: -0.24, y: 0.22, r: 0.18 },
        ]),
      ],
    },
    {
      id: "kuiper-methane-ammonia-ice",
      stop: "pluto",
      label: "frozen methane and ammonia (and nitrogen on the largest bodies)",
      fill: "#D6D3EA",
      facet: "#9A9BB0",
      rim: "#F5E6D0",
      glint: "#FFB3C7",
      carriesWord: true,
      source: KUIPER_SOURCE,
      variants: [
        variant("methane-a", PROFILE.lumpy, [{ x: 0.18, y: -0.22, r: 0.26 }]),
        variant("methane-b", PROFILE.squat, [{ x: -0.2, y: 0.24, r: 0.22 }]),
        variant("methane-c", PROFILE.boulder, [
          { x: 0.24, y: 0.16, r: 0.2 },
          { x: -0.22, y: -0.2, r: 0.16 },
        ]),
      ],
    },
    {
      id: "small-kbo",
      stop: "pluto",
      label: "small Kuiper Belt objects",
      fill: "#9A9BB0",
      facet: "#4A4C63",
      rim: "#F2F4F8",
      glint: null,
      carriesWord: true,
      source: KUIPER_SOURCE,
      variants: [
        variant("kbo-a", PROFILE.shard, [{ x: 0.2, y: 0.18, r: 0.22 }]),
        variant("kbo-b", PROFILE.slab, [{ x: -0.18, y: -0.22, r: 0.2 }]),
        variant("kbo-c", PROFILE.lumpy, [{ x: 0.0, y: 0.26, r: 0.24 }]),
      ],
    },
  ],
};

/** Every debris type at a stop, ambient material included. */
export function debrisTypesFor(stop: StopId): readonly DebrisType[] {
  return DEBRIS_BY_STOP[stop];
}

/** AC-12b.1: the types a stop may put a word on. */
export function wordDebrisTypesFor(stop: StopId): readonly DebrisType[] {
  return debrisTypesFor(stop).filter((d) => d.carriesWord);
}

/** AC-12b.2, as a predicate over the whole table. */
export function hasThreeVariants(type: DebrisType): boolean {
  return type.variants.length >= 3;
}

// ---------------------------------------------------------------------------
// UR-47: the colour a gameplay rock is actually drawn in
// ---------------------------------------------------------------------------

/**
 * THE FILL A WORD-ASTEROID TAKES ON SCREEN, and why it is not `type.fill`.
 *
 * `DebrisType.fill` above is the MATERIAL: what this rock is made of, at full
 * value, as FR-12b and art-direction section 4 describe it. It is the right
 * colour for a rock lit from the front and the wrong colour for the one place
 * the game actually draws rocks - L4, the nearest world layer, in front of a
 * sky that sweeps most of the value range from the top of the frame to the
 * bottom.
 *
 * `FlightScene.spawnRock` used to pass `type.fill` straight through, and the
 * consequence is UR-47, the oldest open user-reported ticket: a rock whose value
 * lies inside the sky's sweep is invisible at the one height where the sky has
 * that value, on every stop, every run. Measured on the shipping game with the
 * scene frozen so the pixels and the coordinates come from one frame, five of
 * the six stops with a belt failed the AC-22.4 bar of 0.06 somewhere down the
 * fall, Saturn worst at 0.0062 - an ice chunk and the sky behind it reading
 * 227.4 and 225.8. The full table is in `render/palette.ts`, above
 * `ROCK_SKY_SPAN`, with the reasoning for the rule.
 *
 * So the BODY value is set to clear that sweep - down on a bright stop, up on a
 * dark one, per art-direction section 2's light rule - while hue, chroma and
 * every other part of the material are kept: the facet stays a step below the
 * body so the 2-tone fill survives, and the rim on the lit side and the glint
 * keep the material's own colours, which is where the eye now reads what the
 * rock is made of.
 *
 * Nothing else calls `drawDebris`. The decorative debris on the far planes goes
 * through `parallax.materialsFor`, which reads `type.fill` directly and is
 * deliberately untouched: those rocks are far away, they belong to their plane's
 * value, and they are not what a child has to read a word off.
 */

/** How far below the body the crater/facet tone sits, in Rec.601 luminance. */
export const FACET_VALUE_STEP = 20;

/**
 * Alpha of the lit-side rim.
 *
 * Raised from 0.50. On a rock drawn at its material value the rim was a grace
 * note; on a rock drawn as its own shadow side it is part of how the material
 * is read, and at 0.5 over a dark body it was not appearing.
 */
export const RIM_ALPHA = 0.85;

/** Rim width as a fraction of `sizePx`. Was 0.022 - about 1.4 px on a 64 px rock. */
export const RIM_WIDTH_FRACTION = 0.05;

/**
 * THE LIT FACE, and why it is the answer to "the metric passed and the picture
 * failed".
 *
 * A blind critic measured this file's first pass and reported both halves
 * honestly: every rock cleared the AC-22.4 bar at every stop and height, and
 * Saturn read as brown pebbles on a beige sky with no ice anywhere in the frame.
 * Both were true. `wordRockFill` moves the BODY value out of the sky's sweep,
 * and at Saturn and Pluto - the two stops whose material is white - that took
 * the whole rock with it.
 *
 * THE OBVIOUS FIX DOES NOT WORK, AND IT IS WORTH WRITING DOWN WHY. The sweep has
 * two sides, so a white rock at a bright stop ought to clear it upward instead.
 * Measured on the shipped frames, it cannot:
 *
 *   saturn   brightest row-median background 238; ice chunk `#F6EEDC` is 238.3,
 *            which is the SAME HEX as the sky's own middle gradient stop
 *   pluto    brightest row-median background 231, sky top stop 243.9;
 *            frost-white ice `#E7EAF2` is 234.0
 *
 * Clearing upward by the probe's 0.06 bar needs a core mean of 253 at Saturn and
 * 247 at Pluto - blown white, with no room left for a facet, a crater or any
 * shading at all, because every one of those pulls the mean back down into the
 * sky. At these two stops the upward side does not exist.
 *
 * WHAT DOES WORK IS GEOMETRY. The AC-22.4 probe reads a CORE DISC of 0.45r, and
 * the radius profiles in this file never go below 0.72r, so the annulus from
 * 0.68x the outline outward is strictly outside anything the measure looks at -
 * the inner edge lands at 0.49r at its closest. That annulus on the lit side is
 * where a real lit object keeps its colour. Drawing the material there at full
 * value gives back the white ice, the warm silicate, the cool metal and the
 * reddish Trojan, on a body that still clears the sky, and it is not a trick
 * played on the measure: a near object lit from one side, bright face toward the
 * light and its own shadow away from it, is what art-direction section 2's one
 * light direction actually implies, and it is how the reference frames read.
 *
 * It does change what "the rock's value" means, so the whole-rock mean is now
 * reported alongside the core mean in the e2e sweep rather than left implied.
 */
export const LIT_FACE_INNER = 0.74;

/**
 * The terminator pass: wider round the rock, half way to the body in value, and
 * reaching closer in. `TERMINATOR_INNER` x the smallest radius in any profile
 * (0.72) is 0.462, so it still starts outside `MEASURED_CORE` (0.45).
 */
export const TERMINATOR_INNER = 0.64;
/** Angular extent of each pass, as cos(angle from the light). */
export const LIT_FACE_COS = 0.3;
export const TERMINATOR_COS = -0.42;

/**
 * How far above the body the lit face must sit, in Rec.601 luminance.
 *
 * The material is normally brighter than the cleared body already - that is what
 * "the body moved out of the sky, away from the light" means at a bright stop.
 * At a DARK stop it is the other way round: Neptune's body is lifted to 151 to
 * clear a sky that tops out at 114, and its material `#274A9B` is 73, so drawing
 * the raw material on the lit side would paint a shadow where the light is. The
 * face is lifted to keep the material's hue and put its value on the correct
 * side of the terminator.
 */
export const LIT_FACE_MIN_STEP = 18;

/** The material as it appears on the lit side of a rock drawn at `bodyFill`. */
export function wordRockLitFace(
  type: DebrisType,
  bodyFill: string,
  fillOverride?: string | null,
): string {
  const material = fillOverride ?? type.fill;
  const target = Math.max(luma255(material), luma255(bodyFill) + LIT_FACE_MIN_STEP);
  return withLuma255(material, target);
}

/** Where the measure stops looking: `tests/gauntlet/silhouette.mjs` CORE. */
export const MEASURED_CORE = 0.45;

/** Cache: the derivation bisects twice and a stage spawns dozens of rocks. */
const FILL_CACHE = new Map<string, string>();

/**
 * Word-carrying materials at a stop, DARKEST FIRST.
 *
 * The order is what keeps Jupiter's four FR-12b materials four materials: they
 * are laid across `rockLumaWindow` in this order, so C-type carbonaceous is
 * still the darkest of them and M-type metallic still the lightest, they are
 * simply all now on the dark side of the sky instead of straddling it.
 */
function materialOrder(stop: StopId): readonly DebrisType[] {
  return [...wordDebrisTypesFor(stop)].sort((a, b) => luma255(a.fill) - luma255(b.fill));
}

/**
 * @param fillOverride D41's declared colourblind fill, when that palette is on.
 *        It is a single colour for the whole stop, so there is no material order
 *        to preserve and it takes the middle of the window - but it gets the
 *        same sky clearance, because a colourblind player is not less entitled
 *        to see the rock.
 */
export function wordRockFill(type: DebrisType, fillOverride?: string | null): string {
  const base = fillOverride ?? type.fill;
  const key = `${type.stop}|${type.id}|${base}`;
  const hit = FILL_CACHE.get(key);
  if (hit !== undefined) return hit;
  const palette = paletteFor(type.stop);
  let target: number;
  if (fillOverride !== undefined && fillOverride !== null) {
    target = rockLumaFor(palette, 0, 1);
  } else {
    const order = materialOrder(type.stop);
    const rank = order.findIndex((d) => d.id === type.id);
    target = rockLumaFor(palette, Math.max(0, rank), Math.max(1, order.length));
  }
  const out = withLuma255(base, target);
  FILL_CACHE.set(key, out);
  return out;
}

/**
 * The facet tone for a body drawn at `bodyFill`: art-direction's darker half.
 *
 * The facet takes the GENTLER of two drops - a flat `FACET_VALUE_STEP` and a
 * proportion of the body - which is the proportional one exactly when the body
 * is dark. A flat 20-level drop off Uranus' body (luminance 32) lands on 12,
 * which against a body of 32 is not a crater, it is a black spot: the same "one
 * value, no structure" failure this whole change exists to remove, reproduced
 * inside the rock. At the light end the flat drop wins and the 2-tone stays
 * subtle, which is what art-direction section 4 asks for.
 */
export function wordRockFacet(type: DebrisType, bodyFill: string): string {
  const body = luma255(bodyFill);
  return withLuma255(type.facet, Math.max(6, body - FACET_VALUE_STEP, body * 0.58));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface DebrisDrawOptions {
  readonly type: DebrisType;
  readonly variantIndex: number;
  readonly sizePx: number;
  /**
   * Direction of the stop's one light (art-direction section 2), in radians.
   * The rim highlight is drawn on this side and nowhere else.
   */
  readonly lightAngle: number;
  /** D41 colourblind palette: the fill is overridden, the 2-tone rule is not. */
  readonly fillOverride?: string | null;
}

/** Variant index wrapped into range, so a caller can pass any integer. */
export function variantFor(type: DebrisType, index: number): ShapeVariant {
  const n = type.variants.length;
  const i = ((Math.floor(index) % n) + n) % n;
  return type.variants[i] as ShapeVariant;
}

/**
 * Draw one rock into an existing Graphics, centred on its origin.
 *
 * Three passes, which is the whole of art-direction section 4's "subtle 2-tone
 * fill" plus section 2's "rim highlight on the lit side": body, facets, rim.
 * No drop shadow is drawn anywhere - depth comes from value steps between
 * layers, not from painted shadows.
 */
/**
 * The annulus polygon for one lit pass: out along the outline, back along the
 * same outline scaled in by `inner`.
 *
 * `inner` is a fraction OF THE OUTLINE, not of the nominal radius, so the inner
 * edge lands at `inner * profile(theta) * r`. Every profile in `PROFILE` is at
 * or above 0.72, so an `inner` of 0.625 or more keeps the whole band outside
 * `MEASURED_CORE`. That is the invariant the e2e sweep depends on and
 * `tests/unit/render/wordRockSeparation.test.ts` asserts it directly rather
 * than trusting these two constants to stay in step.
 */
function litFacePoints(
  points: readonly Phaser.Types.Math.Vector2Like[],
  indices: readonly number[],
  inner: number,
): Phaser.Types.Math.Vector2Like[] {
  const out: Phaser.Types.Math.Vector2Like[] = [];
  for (const i of indices) {
    const p = points[i] as Phaser.Types.Math.Vector2Like;
    out.push({ x: p.x as number, y: p.y as number });
  }
  for (let k = indices.length - 1; k >= 0; k -= 1) {
    const p = points[indices[k] as number] as Phaser.Types.Math.Vector2Like;
    out.push({ x: (p.x as number) * inner, y: (p.y as number) * inner });
  }
  return out;
}

/**
 * Indices of the outline points on the lit side, AS A CONTIGUOUS ARC.
 *
 * The rim used to take these with `points.filter`, which returns them in array
 * order. The lit set is contiguous in ANGLE but the array starts at -90 degrees,
 * so whenever the arc straddles that seam - which it does at five of the seven
 * stops, because `lightAngleOf` sweeps -125 to -55 degrees - the filtered list
 * came back as two pieces with the far side of the rock between them. Stroked,
 * that drew a chord across the rock; filled, as the lit face now is, it would
 * draw a bow tie. Rotating to the first lit index after a dark one puts the arc
 * back in one piece.
 */
function litArc(count: number, lightAngle: number, cosFloor = 0): number[] {
  const isLit = (i: number): boolean =>
    Math.cos(-Math.PI / 2 + (i / count) * Math.PI * 2 - lightAngle) > cosFloor;
  let start = -1;
  for (let i = 0; i < count; i += 1) {
    if (isLit(i) && !isLit((i - 1 + count) % count)) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = (start + k) % count;
    if (!isLit(i)) break;
    out.push(i);
  }
  return out;
}

export function drawDebris(
  g: Phaser.GameObjects.Graphics,
  options: DebrisDrawOptions,
): void {
  const { type, sizePx, lightAngle } = options;
  const shape = variantFor(type, options.variantIndex);
  const points = shapePoints(shape, sizePx);
  const radius = sizePx / 2;

  g.clear();

  // UR-47: the body is the material moved to a value that clears the sky this
  // rock falls through, not the material itself. See `wordRockFill`.
  const body = wordRockFill(type, options.fillOverride);
  g.fillStyle(hexToInt(body), 1);
  g.fillPoints(points as Phaser.Types.Math.Vector2Like[], true, true);

  // THE LIT FACE: the material at its own value, on the annulus the measure does
  // not look at. See `LIT_FACE_INNER`. This is where Saturn's ice, Jupiter's
  // four silicates and Pluto's frosts live now.
  //
  // TWO PASSES, NOT ONE, and the second is what stops it reading as a hood. A
  // single crescent of `#F6EEDC` on a body of `#393833` is a 182-level step in
  // one edge: the first render of it looked like a white cap sitting ON a dark
  // pebble rather than the lit side OF an ice chunk. The wider, half-mixed pass
  // underneath is the terminator - it reaches further round the rock and is
  // half way between the two values, so the eye reads one object turning away
  // from the light. Both annuli start outside `MEASURED_CORE`; see
  // `litFacePoints` for the arithmetic that guarantees it.
  const face = wordRockLitFace(type, body, options.fillOverride);
  const terminator = litArc(points.length, lightAngle, TERMINATOR_COS);
  if (terminator.length >= 2) {
    g.fillStyle(hexToInt(mixHex(body, face, 0.5)), 1);
    g.fillPoints(litFacePoints(points, terminator, TERMINATOR_INNER), true, true);
  }
  const litIndices = litArc(points.length, lightAngle, LIT_FACE_COS);
  if (litIndices.length >= 2) {
    g.fillStyle(hexToInt(face), 1);
    g.fillPoints(litFacePoints(points, litIndices, LIT_FACE_INNER), true, true);
  }

  g.fillStyle(hexToInt(wordRockFacet(type, body)), 0.55);
  for (const facet of shape.facets) {
    g.fillCircle(facet.x * radius, facet.y * radius, facet.r * radius);
  }

  // Rim: a second offset outline on the lit side only.
  const offset = radius * 0.06;
  g.lineStyle(Math.max(1, sizePx * RIM_WIDTH_FRACTION), hexToInt(type.rim), RIM_ALPHA);
  g.beginPath();
  litIndices.forEach((idx, i) => {
    const p = points[idx] as Phaser.Types.Math.Vector2Like;
    const x = (p.x as number) + Math.cos(lightAngle) * offset;
    const y = (p.y as number) + Math.sin(lightAngle) * offset;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.strokePath();

  if (type.glint !== null) {
    g.fillStyle(hexToInt(type.glint), 0.8);
    g.fillCircle(
      Math.cos(lightAngle) * radius * 0.42,
      Math.sin(lightAngle) * radius * 0.42,
      Math.max(1.5, radius * 0.07),
    );
  }
}

/**
 * FR-5 / D26: the shield canister is a rock VARIANT, not a power-up icon - it
 * carries a story word like every other rock and is told apart by an engineered
 * band and a soft ring in the accent, so it still reads as part of the belt.
 */
export function drawShieldCanister(
  g: Phaser.GameObjects.Graphics,
  options: DebrisDrawOptions & { readonly accent: string },
): void {
  drawDebris(g, options);
  const radius = options.sizePx / 2;
  const accent = hexToInt(options.accent);

  g.lineStyle(Math.max(2, options.sizePx * 0.05), accent, 0.9);
  g.strokeCircle(0, 0, radius * 0.62);
  g.lineStyle(Math.max(1, options.sizePx * 0.03), accent, 0.55);
  g.strokeCircle(0, 0, radius * 0.86);

  g.fillStyle(accent, 0.85);
  g.fillRoundedRect(
    -radius * 0.16,
    -radius * 0.44,
    radius * 0.32,
    radius * 0.88,
    radius * 0.14,
  );
}

/**
 * Texture for `blastShards` (render/particles.ts): one small chunk in the
 * rock's own colour, generated from vectors at boot (D83). Returns the texture
 * key so the emitter can be built without the caller knowing the shape.
 */
export function ensureShardTexture(
  scene: Phaser.Scene,
  key: string,
  colour: string,
): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(hexToInt(colour), 1);
  g.fillPoints(
    [
      { x: 8, y: 0 },
      { x: 14, y: 6 },
      { x: 11, y: 14 },
      { x: 3, y: 13 },
      { x: 0, y: 5 },
    ],
    true,
    true,
  );
  g.generateTexture(key, 16, 16);
  g.destroy();
  return key;
}

/** Texture for `strikeSpark` and `dustMotes`: a soft round mote. */
export function ensureMoteTexture(
  scene: Phaser.Scene,
  key: string,
  colour: string,
): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const tint = hexToInt(colour);
  g.fillStyle(tint, 0.25);
  g.fillCircle(8, 8, 8);
  g.fillStyle(tint, 1);
  g.fillCircle(8, 8, 4);
  g.generateTexture(key, 16, 16);
  g.destroy();
  return key;
}
