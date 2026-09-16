/**
 * mulberry32 - a 32-bit deterministic PRNG.
 *
 * The lane brief and CLAUDE.md both forbid Math.random anywhere near the
 * engine. AC-2.1 is a 10,000-spawn invariant and AC-9.2 is a 10,000-stage one;
 * a flaky invariant test is worse than no invariant test, because it teaches
 * the next person to re-run until green. Fixed seed in, identical stream out.
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

/** Integer in [0, n). */
export const randInt = (rng: () => number, n: number): number =>
  Math.min(n - 1, Math.floor(rng() * n));

/** Fisher-Yates on a copy, driven by the injected stream. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, i + 1);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
