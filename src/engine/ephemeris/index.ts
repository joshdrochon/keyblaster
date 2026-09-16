import type { StopId } from "../types.js";
import {
  DAYS_PER_JULIAN_CENTURY,
  ELEMENTS,
  J2000_JD,
  TABLE_VALID_FROM_JD,
  TABLE_VALID_TO_JD,
  elementsAt,
  isWithinTableValidity,
} from "./elements.js";
import {
  DEG_TO_RAD,
  KEPLER_MAX_ITERATIONS,
  KEPLER_TOLERANCE_RAD,
  RAD_TO_DEG,
  solveKepler,
  wrapDeg180,
  wrapDeg360,
} from "./kepler.js";
import { NAVIGATION_PULSARS, pulsarDelays } from "./pulsars.js";

export type { ElementSet, KeplerianElements, KeplerianRates } from "./elements.js";
export {
  DAYS_PER_JULIAN_CENTURY,
  ELEMENTS,
  J2000_JD,
  TABLE_VALID_FROM_JD,
  TABLE_VALID_TO_JD,
  elementsAt,
  isWithinTableValidity,
} from "./elements.js";
export type { KeplerSolution } from "./kepler.js";
export {
  DEG_TO_RAD,
  KEPLER_MAX_ITERATIONS,
  KEPLER_TOLERANCE_RAD,
  RAD_TO_DEG,
  solveKepler,
  wrapDeg180,
  wrapDeg360,
} from "./kepler.js";
export type { Pulsar, PulsarDelay } from "./pulsars.js";
export {
  AU_LIGHT_SECONDS,
  NAVIGATION_PULSARS,
  OBLIQUITY_J2000_DEG,
  pulsarDelays,
  pulsarEclipticUnitVector,
} from "./pulsars.js";

/** Julian date of the Unix epoch, 1970-01-01T00:00:00Z. */
export const UNIX_EPOCH_JD = 2440587.5;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Failure policy
// ---------------------------------------------------------------------------

/**
 * Why the ephemeris refused to answer.
 *
 * - `invalid-date`   the caller passed an Invalid Date or a non-finite JD.
 * - `outside-table`  the date is outside the 1800-2050 fit window, where the
 *                    approximate elements return a confident wrong answer.
 * - `kepler-diverged` Newton hit its iteration cap.
 */
export type EphemerisFailure =
  | "invalid-date"
  | "outside-table"
  | "kepler-diverged"
  | "non-finite";

export class EphemerisError extends Error {
  readonly reason: EphemerisFailure;
  constructor(reason: EphemerisFailure, message: string) {
    super(message);
    this.name = "EphemerisError";
    this.reason = reason;
  }
}

/**
 * Classify a Julian date before it is used. Returns null when the date is
 * usable.
 *
 * `new Date("oops").getTime()` is NaN, which propagates silently all the way
 * to the screen as the literal text "NaN". A child must never see that, so it
 * is caught here, at the only place a bad clock can enter the module.
 */
export function classifyJd(jd: number): EphemerisFailure | null {
  if (!Number.isFinite(jd)) return "invalid-date";
  if (!isWithinTableValidity(jd)) return "outside-table";
  return null;
}

/**
 * Julian date for a calendar instant.
 *
 * Takes an explicit `Date` and never reads the wall clock: the game is played
 * "on the current date" (AC-17.1), but the clock is injected by the caller so
 * every test is deterministic (CLAUDE.md hard rules).
 *
 * UT is treated as TT here. The two differ by ~70 s in 2026, which moves the
 * fastest body in the table (Earth) by 0.0008° - four orders of magnitude
 * inside the ±1° AC-17.1 allows.
 */
export function julianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

/** Inverse of `julianDate`, for fixtures and round-trip tests. */
export function dateFromJulian(jd: number): Date {
  return new Date((jd - UNIX_EPOCH_JD) * MS_PER_DAY);
}

/** Julian centuries elapsed since J2000.0. */
export function centuriesSinceJ2000(jd: number): number {
  return (jd - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
}

/** A heliocentric position in the J2000 ecliptic frame (AC-17.1). */
export interface EclipticCoords {
  /** Ecliptic longitude λ, degrees, in [0, 360). */
  readonly lambdaDeg: number;
  /** Ecliptic latitude β, degrees, in [−90, 90]. */
  readonly betaDeg: number;
  /** Distance from the Sun, astronomical units. */
  readonly rAu: number;
  /** The same point as a rectangular vector, AU. Used by the pulsar fix. */
  readonly xyzAu: readonly [number, number, number];
  /** Newton passes the Kepler solve took, and whether it converged. */
  readonly keplerIterations: number;
  readonly keplerConverged: boolean;
}

/**
 * Heliocentric ecliptic coordinates of one stop's planet, by the JPL
 * approximate-elements method (D15, PRD FR-17, architecture section 4.5).
 *
 * The steps are exactly the ones the architecture lists, in order: propagate
 * the elements to T, take M = L − ϖ wrapped to [−180, 180), solve Kepler by
 * Newton to 1e-6 rad, place the body in its own orbital plane, rotate into the
 * J2000 ecliptic, and read off λ, β, r.
 */
export interface SolveOptions {
  /** Newton stopping step, radians. Defaults to KEPLER_TOLERANCE_RAD. */
  readonly toleranceRad?: number;
  /** Newton iteration cap. Defaults to KEPLER_MAX_ITERATIONS. */
  readonly maxIterations?: number;
}

export function heliocentricEclipticAtJd(
  planet: StopId,
  jd: number,
  options: SolveOptions = {},
): EclipticCoords {
  // Fail loudly rather than returning NaN: every caller inside the engine has
  // a real date, so a bad one here is a bug, not a state to render.
  const failure = classifyJd(jd);
  if (failure) {
    throw new EphemerisError(
      failure,
      failure === "invalid-date"
        ? `Julian date is not finite (got ${jd})`
        : `Julian date ${jd} is outside the 1800-2050 element table`,
    );
  }

  const t = centuriesSinceJ2000(jd);
  const el = elementsAt(planet, t);

  // Step 2. Mean anomaly. Wrapping to [−180, 180) keeps the Newton seed near
  // the root no matter how many revolutions L has accumulated.
  const meanAnomalyDeg = wrapDeg180(el.lDeg - el.varPiDeg);

  // Step 3. Kepler's equation. The options seam exists so a test can force
  // divergence; nothing in the game ever passes it.
  const solution = solveKepler(
    meanAnomalyDeg * DEG_TO_RAD,
    el.e,
    options.toleranceRad ?? KEPLER_TOLERANCE_RAD,
    options.maxIterations ?? KEPLER_MAX_ITERATIONS,
  );
  if (!solution.converged) {
    throw new EphemerisError(
      "kepler-diverged",
      `Kepler solve for ${planet} did not converge in ${solution.iterations} passes`,
    );
  }
  const eccentricAnomaly = solution.eccentricAnomalyRad;

  // Step 4. Position in the orbital plane, perifocal frame, AU.
  const xPerifocal = el.aAu * (Math.cos(eccentricAnomaly) - el.e);
  const yPerifocal =
    el.aAu * Math.sqrt(1 - el.e * el.e) * Math.sin(eccentricAnomaly);

  // Step 5. Rotate perifocal → J2000 ecliptic by ω (argument of perihelion),
  // then I (inclination), then Ω (ascending node). ω is not tabulated; it is
  // ϖ − Ω, which is why the table can carry ϖ instead.
  const argPeri = (el.varPiDeg - el.omegaDeg) * DEG_TO_RAD;
  const node = el.omegaDeg * DEG_TO_RAD;
  const inc = el.iDeg * DEG_TO_RAD;

  const cosW = Math.cos(argPeri);
  const sinW = Math.sin(argPeri);
  const cosO = Math.cos(node);
  const sinO = Math.sin(node);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);

  const x =
    (cosW * cosO - sinW * sinO * cosI) * xPerifocal +
    (-sinW * cosO - cosW * sinO * cosI) * yPerifocal;
  const y =
    (cosW * sinO + sinW * cosO * cosI) * xPerifocal +
    (-sinW * sinO + cosW * cosO * cosI) * yPerifocal;
  const z = sinW * sinI * xPerifocal + cosW * sinI * yPerifocal;

  // Step 6. Spherical form. λ is wrapped into [0, 360) and β falls out of asin
  // in [−90, 90], which is the range AC-17.1 states.
  const rAu = Math.sqrt(x * x + y * y + z * z);
  const lambdaDeg = wrapDeg360(Math.atan2(y, x) * RAD_TO_DEG);
  // Clamp guards asin against a |z/r| that floating point nudged past 1.
  const betaDeg = Math.asin(Math.min(1, Math.max(-1, z / rAu))) * RAD_TO_DEG;

  return {
    lambdaDeg,
    betaDeg,
    rAu,
    xyzAu: [x, y, z],
    keplerIterations: solution.iterations,
    keplerConverged: solution.converged,
  };
}

/**
 * Same computation, keyed off a calendar `Date`. This is the entry point the
 * Beacon scene calls with the play date.
 */
export function heliocentricEcliptic(
  planet: StopId,
  date: Date,
  options: SolveOptions = {},
): EclipticCoords {
  return heliocentricEclipticAtJd(planet, julianDate(date), options);
}

// ---------------------------------------------------------------------------
// Display (AC-17.0, D81)
// ---------------------------------------------------------------------------

/** U+2212 MINUS SIGN. D81 prints a real minus, not a hyphen. */
export const MINUS_SIGN = "−";
/** U+00B0 DEGREE SIGN. */
export const DEGREE_SIGN = "°";
/** U+03BB GREEK SMALL LETTER LAMDA. */
export const LAMBDA_SIGN = "λ";
/** U+03B2 GREEK SMALL LETTER BETA. */
export const BETA_SIGN = "β";

/**
 * Fixed-decimal formatting with a typographic minus.
 *
 * `toFixed` can produce "-0.0" for a tiny negative; that would print as
 * "−0.0°", which reads as a measurement the beacon did not make. Zero is
 * normalised to unsigned before the sign swap.
 */
export function formatSigned(value: number, decimals: number): string {
  // `(NaN).toFixed(1)` is the string "NaN", which would render verbatim on the
  // Beacon screen. Refuse instead; beaconReadout turns this into a fallback.
  if (!Number.isFinite(value)) {
    throw new EphemerisError("non-finite", `Cannot format ${value}`);
  }
  const rounded = Number(value.toFixed(decimals));
  const normalised = rounded === 0 ? 0 : rounded;
  return normalised.toFixed(decimals).replace("-", MINUS_SIGN);
}

/**
 * λ, formatted. Rounding is the catch: λ = 359.97 renders as "360.0", which is
 * outside the [0, 360) range AC-17.1 states. Since 360.0 and 0.0 name the same
 * direction, the wrap is applied after rounding rather than before.
 */
export function formatLongitude(lambdaDeg: number): string {
  const text = formatSigned(lambdaDeg, 1);
  return text === "360.0" ? "0.0" : text;
}

/**
 * The beacon coordinate readout, exactly as AC-17.0 and D81 specify:
 * "λ 214.6°  β −1.2°  r 1.52 AU". One decimal on the angles, two on the
 * distance, two spaces between the three fields, U+2212 for negatives.
 */
export function formatBeaconCoords(coords: EclipticCoords): string {
  const lambda = formatLongitude(coords.lambdaDeg);
  const beta = formatSigned(coords.betaDeg, 1);
  const r = formatSigned(coords.rAu, 2);
  return (
    `${LAMBDA_SIGN} ${lambda}${DEGREE_SIGN}  ` +
    `${BETA_SIGN} ${beta}${DEGREE_SIGN}  ` +
    `r ${r} AU`
  );
}

/**
 * The one pulsar-fix flavor line that sits under the coordinates (AC-17.0,
 * D15). Each figure is the beacon's real light-travel delay along that
 * pulsar's line of sight, so the line changes with the planet and the date
 * rather than being decoration.
 */
export function formatPulsarFix(coords: EclipticCoords): string {
  const parts = pulsarDelays(coords.xyzAu, NAVIGATION_PULSARS).map((delay) => {
    // The sign goes through formatSigned so a non-finite delay is refused
    // here too, and so negatives use U+2212 like the rest of D81. The
    // catalogue name keeps its ASCII hyphen.
    const magnitude = formatSigned(Math.abs(delay.seconds), 1);
    const sign = delay.seconds < 0 ? MINUS_SIGN : "+";
    return `${delay.name} ${sign}${magnitude} s`;
  });
  return `pulsar fix  ${parts.join("  ·  ")}`;
}

/** Both display lines for one beacon. */
export interface BeaconReadout {
  readonly coordsLine: string;
  readonly pulsarLine: string;
}

/**
 * What the Beacon scene gets back.
 *
 * A discriminated union rather than a throw: the scene has to render
 * *something* even when the device clock is nonsense, and a try/catch around
 * a render call is the kind of thing that gets dropped. `ok: false` is the
 * "beacon calibrating" path (AC-17.0 still holds - there is simply no
 * coordinate line to print).
 */
export type BeaconResult =
  | ({ readonly ok: true } & BeaconReadout & EclipticCoords)
  | { readonly ok: false; readonly reason: EphemerisFailure; readonly message: string };

export function beaconReadout(planet: StopId, date: Date): BeaconResult {
  const jd = julianDate(date);
  const failure = classifyJd(jd);
  if (failure) {
    return {
      ok: false,
      reason: failure,
      message:
        failure === "invalid-date"
          ? "Beacon clock unreadable"
          : "Beacon date outside charted range",
    };
  }

  const coords = heliocentricEclipticAtJd(planet, jd);
  return {
    ok: true,
    ...coords,
    coordsLine: formatBeaconCoords(coords),
    pulsarLine: formatPulsarFix(coords),
  };
}
