/**
 * CALL-SIGN NAMES FOR A NEW PILOT (UR-187).
 *
 * The name field used to be placeheld with the words "Pilot Name" - a label
 * standing in for a value - and a child who typed nothing got a profile called
 * "Pilot". Both are the game filling a blank with a shrug.
 *
 * So the placeholder is a real, usable name now, in the shape every shooter has
 * offered since forever: one adjective, one noun, run together. It is a
 * SUGGESTION the child can accept by doing nothing, which is the point - no
 * validation, no "you did it not-right" (D31), and nobody is ever called Pilot
 * by accident.
 *
 * Pure, and in the engine, so the list can be swept by a test: every pair has
 * to fit `MAX_NAME_LENGTH`, clear `MIN_NAME_LENGTH`, and be a word a seven year
 * old can read.
 */

/** Both halves stay short enough that any pair fits a 24-character field. */
export const CALL_SIGN_ADJECTIVES: readonly string[] = [
  "Astro", "Bold", "Brave", "Bright", "Calm", "Clever", "Cosmic", "Daring",
  "Eager", "Gentle", "Golden", "Happy", "Jolly", "Keen", "Lucky", "Merry",
  "Mighty", "Nimble", "Quick", "Rapid", "Shiny", "Silver", "Smooth", "Solar",
  "Speedy", "Steady", "Sunny", "Swift", "Turbo", "Zippy",
];

export const CALL_SIGN_NOUNS: readonly string[] = [
  "Beam", "Comet", "Compass", "Cosmo", "Dash", "Drifter", "Falcon", "Flyer",
  "Glider", "Jet", "Lantern", "Meteor", "Nebula", "Nova", "Orbit", "Pulsar",
  "Quasar", "Ranger", "Rocket", "Scout", "Sparrow", "Spark", "Starling",
  "Swallow", "Thruster", "Voyager", "Wing",
];

/** How many distinct names the two lists can make. */
export const CALL_SIGN_COUNT = CALL_SIGN_ADJECTIVES.length * CALL_SIGN_NOUNS.length;

/**
 * One call sign.
 *
 * `rand` is injected rather than reached for: the engine may not touch globals,
 * and a seeded source makes the generator assertable instead of merely
 * plausible. Values outside [0, 1) are tolerated - a broken source gives a
 * boring name, never a crash or an empty string.
 */
export function randomCallSign(rand: () => number): string {
  const pick = <T>(list: readonly T[]): T => {
    const raw = rand();
    const r = Number.isFinite(raw) ? Math.abs(raw) % 1 : 0;
    return list[Math.min(list.length - 1, Math.floor(r * list.length))] as T;
  };
  return `${pick(CALL_SIGN_ADJECTIVES)}${pick(CALL_SIGN_NOUNS)}`;
}
