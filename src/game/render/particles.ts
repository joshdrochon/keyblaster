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
    //
    // The numbers moved once, after the explosions were reported as
    // unsatisfying, and they moved for a reason each. 8 shards at 90-220
    // px/s read as a puff: the count was below the art direction's own "6-10
    // shards" only at the low end of the roll, and the speed range was narrow
    // enough that they all left together, so there was no spray. 16 shards over
    // 140-420 px/s leave in a spread, the fast ones clear the frame and the slow
    // ones fall back through it, and the longer tail lets gravity actually be
    // seen doing something. Scale ends at 0.34 rather than 0.2 so a shard is
    // still a chunk of rock when it dies instead of a dot.
    //
    // `quantity` is now the SIZE OF THE POPULATION, not the size of one burst:
    // the fragments leave on `shardOnsetsMs()` over ~440 ms rather than all on
    // the fracture frame.
    //
    // It went 16 -> 12 when the schedule landed, as a cut taken on frame-time
    // grounds that could not be measured at the time, and it is back at 16 now
    // that they have been. P-22.9 was swept over both board depths on a
    // serialised run and the count is not what the budget is spent on; the
    // measured before/after is in the block comment on `shardOnsetsMs` below,
    // with the arithmetic and the ceiling that keeps it from drifting up again.
    id: "blastShards",
    quantity: 16,
    lifespanMs: [480, 900],
    speed: [140, 420],
    angle: [0, 360],
    gravityY: 420,
    scale: [1.15, 0.34],
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

/* ======================================================================== *
 *  WHEN EACH FRAGMENT LEAVES (UR-48, the visual half; UR-30; D31, AC-21.3)
 * ======================================================================== */

/**
 * THE BURST HAS A SHAPE IN TIME, AND IT IS THE SOUND'S SHAPE.
 *
 * UR-48's audio half shipped first: `audio/crumble.ts` builds the blast out of
 * 64 struck-stone grains scattered by a decaying density, and the audio lane
 * measured what it actually renders:
 *
 *     fracture        0 ms        the crack itself
 *     debris begins   15-22 ms    the first fragments detach - LATER than the crack
 *     density decays  150 ms      the emission rate has fallen by 1/e here
 *     last fragment   400-460 ms  something is still leaving this late
 *
 * The visual did not match it. Every shard was emitted on the fracture frame in
 * a single `emitParticleAt(x, y, quantity)`, so the picture was one instant of
 * debris and then 900 ms of the same debris falling, while the ear was hearing
 * a rock still coming apart. A population that arrives all at once reads as a
 * puff no matter how many members it has - which is why pushing the count from
 * 8 to 16 did not fix it, and why pushing it to 24 would not either. WHEN they
 * leave is the variable, not HOW MANY.
 *
 * SAME DISTRIBUTION AS THE SOUND, SAMPLED FEWER TIMES. `crumbleSamples` places
 * grain `g` at `-tau * ln(1 - u)` with `tau = CRUMBLE_SHAPE.densityTau` (0.15 s)
 * and a stratified `u`, clamped to 0.46 s. This is that, in milliseconds, with
 * 16 strata instead of 64. Stratified for the same reason the audio is: 16 free
 * draws clump badly by luck, and a burst that happened to put nine of its
 * sixteen fragments after 200 ms would read as a slide rather than a break.
 *
 * AND 16 IS THE ONE POPULATION WHOSE STRATA NEST INSIDE THE SOUND'S. The audio
 * cuts the distribution into 64 equal slices; 64 / 16 = 4, so visual stratum `i`
 * is exactly the union of audio grains 4i..4i+3 and its midpoint sits at the
 * centre of that block. No other count in the range divides 64 - at 12, 14 or 15
 * the two partitions cut the same curve at different places and the picture is
 * merely near the sound rather than a decimation of it. UR-48 is the claim that
 * they are the SAME distribution, so the count that makes that exactly true is
 * the one to hold.
 *
 * WHY THE FLOOR AND THE CEILING ARE EXPLICIT. At a population of 16 the raw
 * exponential puts the first stratum at 4.8 ms and the last at 520 ms, and both
 * are outside the measured window. Both ends run FURTHER out as the population
 * grows - they were 6.4 ms and 477 ms at 12 - which is why the two clamps are
 * constants taken from the sound rather than anything derived from the count.
 * Clamping to `SHARD_FIRST_DETACH_MS` keeps the first fragment off the
 * fracture frame - the point of the whole change - and clamping to
 * `SHARD_LAST_DETACH_MS` keeps the tail inside the sound it is matched to
 * instead of a fragment leaving after the crumble has finished.
 *
 * THE PERFORMANCE ARGUMENT, WHICH WAS MADE TWICE AND MEASURED ONCE. This landed
 * on a board that had just got much fuller (belts now climb to maxLive 7;
 * time-weighted occupancy went from ~1.0 rocks to 3.4-3.9), so the population
 * was cut 16 -> 12 on the reasoning below. All of that reasoning still holds
 * except its conclusion.
 *
 * Staggering on its own buys nothing: the minimum lifespan (480 ms) is longer
 * than the whole onset spread (440 ms), so every fragment is still alive when
 * the last one is born and the peak simultaneous count barely moves. Per-frame
 * particle cost is `population x lifespan`, and the only lever on it is the
 * population. 12 -> 16 is therefore a real 33% rise in per-destruction particle
 * work (12 x ~690 ms avg life = 8280 particle-ms, to 16 x ~690 = 11040), which
 * at the perf spec's ~8 blasts/s is about 66 shards alive on average against 88.
 *
 * AND IT DOES NOT SHOW UP. P-22.9 was swept over both board depths, one worker
 * at a time on an otherwise idle machine, twice per population. Per-frame work,
 * p95, in ms:
 *
 *                     maxLive 5        maxLive 7
 *     12 fragments    9.3, 9.2         9.2, 9.3
 *     16 fragments    9.7, 9.2, 9.3    9.6, 9.3, 9.2
 *
 * against a 16.7 ms bar. The arms differ by less than the harness differs from
 * itself between two runs of the SAME build, so what the sweep establishes is
 * not "16 is cheap" but "at this resolution the shard population is not what
 * this frame budget is spent on". The 25% that the cut bought back was real
 * arithmetic about particles and almost nothing about frames.
 *
 * READ THOSE ARTIFACTS WITH `frames` IN HAND. Headless Chromium rasterises in
 * software and shares the machine with whatever else is running, so a contended
 * run reports the box rather than the game - the same build gives ~9.2 ms over
 * ~410 frames idle and 12.1 ms over 122 frames while three other suites are
 * going. A 60 s window that collected barely 120 frames was not measuring this
 * code. The margin to 16.7 is left deliberately wide on top of that, because
 * every number here describes SwiftShader and not a player's GPU; a headed
 * capture is still owed and is on the escalation queue.
 *
 * The satisfaction comes from the schedule. The count is what the schedule has
 * to spend, and the budget turned out to be able to afford it.
 */

/** Time constant of the onset decay. Mirrors `CRUMBLE_SHAPE.densityTau`. */
export const SHARD_ONSET_TAU_MS = 150;

/** The first fragment detaches HERE, not on the fracture frame. */
export const SHARD_FIRST_DETACH_MS = 18;

/** The last fragment detaches here - inside the sound's 400-460 ms tail. */
export const SHARD_LAST_DETACH_MS = 440;

/** One moment in the burst: `count` fragments detach `atMs` after the fracture. */
export interface ShardWave {
  readonly atMs: number;
  readonly count: number;
}

function shardPopulation(count?: number): number {
  const n = count ?? particleSpec("blastShards").quantity;
  return Math.max(1, Math.floor(n));
}

/**
 * The detach time of every fragment, ascending, in ms after the fracture frame.
 * Deterministic: the burst's shape in time is a constant of the game, not a
 * per-blast roll, so a test can read it and a reviewer can count it.
 */
export function shardOnsetsMs(count?: number): readonly number[] {
  const n = shardPopulation(count);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    // One draw from each equal slice of the exponential, taken at the slice's
    // midpoint - the stratification `crumbleSamples` uses.
    const u = (i + 0.5) / n;
    const raw = -SHARD_ONSET_TAU_MS * Math.log(1 - u);
    const clamped = Math.min(SHARD_LAST_DETACH_MS, Math.max(SHARD_FIRST_DETACH_MS, raw));
    out.push(Math.round(clamped));
  }
  return out;
}

/**
 * The same schedule, collapsed so fragments sharing a detach time are emitted
 * together. The caller schedules one timer per wave rather than one per
 * fragment, and ties at the clamped ends cost nothing.
 */
export function shardWaves(count?: number): readonly ShardWave[] {
  const waves: ShardWave[] = [];
  for (const atMs of shardOnsetsMs(count)) {
    const last = waves[waves.length - 1];
    if (last !== undefined && last.atMs === atMs) {
      waves[waves.length - 1] = { atMs, count: last.count + 1 };
    } else {
      waves.push({ atMs, count: 1 });
    }
  }
  return waves;
}

/**
 * How many fragments have left by `atMs`. The cumulative form of the schedule,
 * which is what "the density has decayed by 150 ms" is a statement about.
 */
export function shardsDetachedBy(atMs: number, count?: number): number {
  return shardOnsetsMs(count).filter((t) => t <= atMs).length;
}
