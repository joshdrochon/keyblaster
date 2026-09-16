/**
 * Kepler's equation and the angle bookkeeping around it.
 *
 * Kept separate from index.ts because the solver is the one part of the
 * ephemeris that can fail to converge, and it is the part AC-17.1 leans on
 * hardest at Pluto's eccentricity (e ≈ 0.2488, D15).
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Newton tolerance from architecture section 4.5: "solve E − e·sinE = M
 * (Newton, 1e-6)". Radians, i.e. ~0.2 arcseconds - far finer than the ±1°
 * AC-17.1 asks for, so the solver is never the limiting error term.
 */
export const KEPLER_TOLERANCE_RAD = 1e-6;

/**
 * Newton on a well-conditioned ellipse converges quadratically; at e = 0.2488
 * it lands in four or five passes. The cap exists so a hypothetical bad input
 * (e ≥ 1, NaN) ends the loop instead of hanging a child's game.
 */
export const KEPLER_MAX_ITERATIONS = 30;

/**
 * Wrap an angle in degrees to [0, 360), which is the range AC-17.1 states for
 * λ.
 *
 * The second `% 360` is not redundant. A hair-below-zero input such as
 * −1e−15 - exactly what `atan2` hands back for a point a whisker clockwise of
 * the vernal equinox - rounds to exactly 360 after `+ 360`, and the trailing
 * modulus is what folds that back to 0 instead of returning an out-of-range
 * 360.
 */
export function wrapDeg360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Wrap an angle in degrees to [−180, 180).
 *
 * The mean anomaly is reduced this way before the solve so the initial guess
 * is always near the root, which is what keeps the iteration count flat
 * across dates centuries apart.
 */
export function wrapDeg180(deg: number): number {
  return wrapDeg360(deg + 180) - 180;
}

export interface KeplerSolution {
  /** Eccentric anomaly E, radians. */
  readonly eccentricAnomalyRad: number;
  /** Newton passes actually taken. */
  readonly iterations: number;
  /** True when |ΔE| fell to the tolerance before the iteration cap. */
  readonly converged: boolean;
}

/**
 * Solve E − e·sinE = M for E by Newton's method.
 *
 * @param meanAnomalyRad M in radians, ideally already wrapped to [−π, π).
 * @param e eccentricity.
 * @param toleranceRad stop once the step |ΔE| is this small.
 */
export function solveKepler(
  meanAnomalyRad: number,
  e: number,
  toleranceRad: number = KEPLER_TOLERANCE_RAD,
  maxIterations: number = KEPLER_MAX_ITERATIONS,
): KeplerSolution {
  // E ≈ M + e·sin M is the standard first-order starting point; for e < 0.6 it
  // is close enough that Newton never wanders off the correct branch.
  let eccentricAnomalyRad = meanAnomalyRad + e * Math.sin(meanAnomalyRad);

  for (let iterations = 1; iterations <= maxIterations; iterations += 1) {
    const residual =
      eccentricAnomalyRad - e * Math.sin(eccentricAnomalyRad) - meanAnomalyRad;
    const derivative = 1 - e * Math.cos(eccentricAnomalyRad);
    const step = residual / derivative;
    eccentricAnomalyRad -= step;
    if (Math.abs(step) <= toleranceRad) {
      return { eccentricAnomalyRad, iterations, converged: true };
    }
  }

  return {
    eccentricAnomalyRad,
    iterations: maxIterations,
    converged: false,
  };
}
