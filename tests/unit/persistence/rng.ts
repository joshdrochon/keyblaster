/**
 * mulberry32 - a 32-bit deterministic PRNG.
 *
 * AC-18.4 is fuzzed, and a fuzz failure you cannot reproduce is not a bug
 * report, it is a rumour. Fixed seed in, identical mutation stream out, on
 * every machine. The lane brief forbids Math.random in tests for this reason.
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

/** Uniform integer in [0, n). */
export function int(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** Uniform pick. Throws rather than return undefined (noUncheckedIndexedAccess). */
export function pick<T>(items: readonly T[], rng: () => number): T {
  const item = items[int(rng, items.length)];
  if (item === undefined) throw new Error("pick() from an empty list");
  return item;
}
