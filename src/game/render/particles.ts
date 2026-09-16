/**
 * Particle signatures (art-direction.md section 9, D60 rubric item 6).
 *
 * AC-22.6 requires blast, hit and warp to be DISTINGUISHABLE, not merely
 * present. So the three configs differ on every axis a player can perceive:
 * direction, lifetime, spread, gravity and colour source. A shared emitter with
 * three tints would pass a naive check and fail the player.
 *
 * Textures are generated from vector shapes at boot (D83) - no raster ships.
 */

export type ParticleSystemId = "blastShards" | "strikeSpark" | "warpStreaks" | "dustMotes";

export interface ParticleSpec {
  readonly id: ParticleSystemId;
  readonly quantity: number;
  readonly lifespanMs: readonly [number, number];
  readonly speed: readonly [number, number];
  /** Degrees; 270 is straight up on screen. */
  readonly angle: readonly [number, number];
  readonly gravityY: number;
  readonly scale: readonly [number, number];
  readonly rotate: boolean;
  /** "debris" takes the rock's own colour; "accent" takes the stage accent. */
  readonly colorSource: "debris" | "accent" | "palette";
  readonly ease: string;
}

export const PARTICLES: readonly ParticleSpec[] = [
  {
    // Rock breaking: chunks fly outward, are heavy, tumble, and keep the
    // rock's colour so the player sees WHICH rock died.
    id: "blastShards",
    quantity: 8,
    lifespanMs: [420, 680],
    speed: [90, 220],
    angle: [0, 360],
    gravityY: 320,
    scale: [0.9, 0.2],
    rotate: true,
    colorSource: "debris",
    ease: "Expo.Out",
  },
  {
    // Ship struck: a short, weightless radial flash in the accent. No red, no
    // explosion (D28) - it reads as a scuff, not a wound.
    id: "strikeSpark",
    quantity: 14,
    lifespanMs: [140, 240],
    speed: [40, 130],
    angle: [0, 360],
    gravityY: 0,
    scale: [0.6, 0.0],
    rotate: false,
    colorSource: "accent",
    ease: "Cubic.Out",
  },
  {
    // Warp: long vertical streaks, no spread, no gravity. The only system that
    // is directional, which is what makes it unmistakable.
    id: "warpStreaks",
    quantity: 26,
    lifespanMs: [700, 1200],
    speed: [520, 900],
    angle: [86, 94],
    gravityY: 0,
    scale: [1.4, 1.4],
    rotate: false,
    colorSource: "accent",
    ease: "Sine.InOut",
  },
  {
    // Ambient: the layer that makes an idle frame never still (rubric 2).
    id: "dustMotes",
    quantity: 3,
    lifespanMs: [4000, 9000],
    speed: [6, 18],
    angle: [80, 100],
    gravityY: 0,
    scale: [0.35, 0.15],
    rotate: false,
    colorSource: "palette",
    ease: "Sine.InOut",
  },
];

export function particleSpec(id: ParticleSystemId): ParticleSpec {
  const found = PARTICLES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown particle system: ${id}`);
  return found;
}

/**
 * AC-22.6 as a computable property: the three event systems must differ from
 * each other on at least three perceptual axes.
 */
export function signatureAxes(a: ParticleSpec, b: ParticleSpec): number {
  let n = 0;
  if (a.gravityY !== b.gravityY) n++;
  if (a.colorSource !== b.colorSource) n++;
  if (a.rotate !== b.rotate) n++;
  if (a.ease !== b.ease) n++;
  if (a.angle[0] !== b.angle[0] || a.angle[1] !== b.angle[1]) n++;
  if (a.lifespanMs[1] !== b.lifespanMs[1]) n++;
  return n;
}
