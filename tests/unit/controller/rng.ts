/**
 * mulberry32 - a 32-bit deterministic PRNG.
 *
 * The lane brief forbids Math.random in tests: AC-10.2 is a 200-stage x 50-seed
 * simulation and a flaky simulation is worse than no simulation. Fixed seed in,
 * identical stream out, on every machine.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform pick from a non-empty list. Throws rather than return undefined. */
export function pick<T>(items: readonly T[], rng: () => number): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick() from an empty list");
  return item;
}
