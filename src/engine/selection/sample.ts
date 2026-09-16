/**
 * Weighted sampling primitives (PRD FR-9, AC-9.1).
 *
 * All randomness is injected as `rng: () => number` returning [0, 1). The
 * engine never calls Math.random (CLAUDE.md: pure TypeScript, deterministic
 * tests), and every simulation in tests/unit/selection drives these with a
 * fixed-seed mulberry32.
 *
 * "Without replacement" is implemented by the CALLER holding a used-set and
 * shrinking the candidate list, not by mutating a bag here: the picker also has
 * to drop candidates for first-letter collisions (AC-2.1) and guaranteed-catch
 * forcing (AC-9.2), and one filter pipeline is easier to reason about than a
 * bag plus three exceptions.
 */

/**
 * Roulette-wheel pick. Returns `undefined` only for an empty list, which the
 * picker treats as "this tier is exhausted, try the next one" - it is never
 * surfaced to a caller.
 *
 * Non-positive total weight falls back to a uniform pick rather than dividing
 * by zero. That cannot happen with the FR-9 weights (all > 0) but a future
 * weight table edit must not be able to produce NaN on a child's screen.
 */
export function weightedPick<T>(
  items: readonly T[],
  weightFn: (item: T) => number,
  rng: () => number,
): T | undefined {
  if (items.length === 0) return undefined;

  let total = 0;
  const weights: number[] = [];
  for (const item of items) {
    const w = weightFn(item);
    const safe = Number.isFinite(w) && w > 0 ? w : 0;
    weights.push(safe);
    total += safe;
  }

  if (total <= 0) return uniformPick(items, rng);

  let threshold = rng() * total;
  // Default to the LAST item so floating-point residue - or an out-of-contract
  // rng() that returns exactly 1 - lands on a real word instead of undefined.
  let index = items.length - 1;
  let i = 0;
  for (const weight of weights) {
    threshold -= weight;
    if (threshold < 0) {
      index = i;
      break;
    }
    i += 1;
  }
  return items[index];
}

/** Uniform pick. Same contract: `undefined` only for an empty list. */
export function uniformPick<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(rng() * items.length)));
  return items[index];
}
