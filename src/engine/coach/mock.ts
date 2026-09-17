import {
  DEFAULT_FALLBACK_BUNDLE,
  fallbackFor,
  type FallbackBundle,
} from "./fallback.js";
import { settle } from "./pipeline.js";
import type { CoachValidator } from "./validate.js";
import type {
  CoachClient,
  CoachPayload,
  CoachRequest,
  CoachResult,
  CoachVariants,
  SanitizedCoachRequest,
} from "./types.js";

/**
 * MockCoach - the DEFAULT transport for dev, offline and the demo (D47,
 * AC-15.4). The gauntlet runs on this one (architecture 10.1b: "paid APIs are
 * mocked by default in the loop"), and so does the 3-minute demo, so its
 * output is the output most people will ever see.
 *
 * DETERMINISM IS THE CONTRACT. Same request in, same note out, forever. No
 * clock, no Math.random: the template is chosen by an FNV-1a hash of the
 * request itself, which gives variety across stops and runs without giving up
 * reproducibility. A gauntlet screenshot that changed between runs would be
 * unjudgeable (D85: evidence, not vibes).
 *
 * AC-15.5 IS THE REASON THIS CLASS NAMES WORDS. The demo beat is: two scripted
 * misses ("rivers", "empty") produce a note that names those exact words. The
 * templates below always interpolate the missed words the request carries, and
 * they are drawn from the same Fry-tier vocabulary as the asteroid pools so
 * the note survives the allowlist gate it is then put through.
 *
 * Its output goes through the SAME validator as the live transports. A canned
 * note is still a note, and AC-15.2 says output is validated - not "output
 * from the model is validated".
 *
 * Variants come from the shipped fallback bundle for the stop. The mock has no
 * view of the next stage's pool, and inventing sentences it cannot check is
 * exactly the failure the allowlist exists to prevent.
 */

/** Templates keyed by how many missed words we can name. */
const TWO_MISSED: readonly string[] = [
  'Nice flying, pilot. Watch for "{a}" and "{b}" next time.',
  'Good run. Let us take "{a}" and "{b}" a little slower.',
  'You had that one. Keep an eye on "{a}" and "{b}".',
];

const ONE_MISSED: readonly string[] = [
  'Nice flying, pilot. Watch for "{a}" next time.',
  'Good run. Let us take "{a}" a little slower.',
];

const ONE_SLOW: readonly string[] = [
  'Clean run, pilot. "{a}" took a moment. Try it again with me.',
  'Every rock down. "{a}" was the slow one. Next time it is yours.',
];

const CLEAN: readonly string[] = [
  "That was a clean run, pilot. Every word on the first try.",
  "Not a rock past you. That is how the map gets drawn.",
];

/**
 * ============ WHAT SHADOW CAN SAY FROM THIS TRANSPORT (D63, D98) ============
 *
 * The mock is the DEFAULT transport (see `chooseTransport`: an unconfigured
 * build is a mock build), so these four tables are the notes a child actually
 * hears today - not the fallback bundle, and certainly not a live model. The
 * user heard "That was a clean run, pilot." in the system voice, and it came
 * from `CLEAN` below.
 *
 * TWO OF THE FOUR TABLES CANNOT BE RECORDED. `TWO_MISSED`, `ONE_MISSED` and
 * `ONE_SLOW` interpolate the child's own missed words (AC-15.5 is the reason
 * they exist), so each template stands for as many sentences as the allowlist
 * has words. `CLEAN` has no slots and is therefore a fixed, finite, renderable
 * pair. `mockNoteLines` states that split as data instead of leaving it to
 * whoever next writes a render script to notice - which is the mistake this
 * whole area keeps repeating.
 *
 * The pools are exported as a FROZEN TABLE rather than copied into the render
 * script, so an added template is an added render (or an added build failure
 * under D98) with nothing to keep in sync by hand.
 */
export const MOCK_NOTE_POOLS = Object.freeze({
  twoMissed: TWO_MISSED,
  oneMissed: ONE_MISSED,
  oneSlow: ONE_SLOW,
  clean: CLEAN,
});

export type MockNotePool = keyof typeof MOCK_NOTE_POOLS;

/** Clip ids for the mock's notes: `coach.mock.<pool>.<index>`. */
export const MOCK_CLIP_PREFIX = "coach.mock";

export interface MockNoteLine {
  /** `coach.mock.clean.0`. Null when the template has slots - see below. */
  readonly id: string | null;
  readonly pool: MockNotePool;
  readonly index: number;
  /** The template, verbatim. `{a}` / `{b}` are the missed-word slots. */
  readonly template: string;
  /** False when the template interpolates a word, which no file can hold. */
  readonly renderable: boolean;
}

/** True when a template is a whole sentence rather than a shape for one. */
const isRenderable = (template: string): boolean => !template.includes("{");

/**
 * Every note this transport can produce, with an id for the ones that are
 * fixed strings and `null` for the ones that are shapes. Both halves are
 * returned on purpose: D98's guard has to be able to say WHY a sentence the
 * game can speak has no recording, and "it names a word the child missed" is a
 * different answer from "nobody rendered it".
 */
export function mockNoteLines(): MockNoteLine[] {
  const lines: MockNoteLine[] = [];
  for (const pool of Object.keys(MOCK_NOTE_POOLS) as MockNotePool[]) {
    MOCK_NOTE_POOLS[pool].forEach((template, index) => {
      const renderable = isRenderable(template);
      lines.push({
        id: renderable ? `${MOCK_CLIP_PREFIX}.${pool}.${index}` : null,
        pool,
        index,
        template,
        renderable,
      });
    });
  }
  return lines;
}

/** The clip id for a mock note, or null when it was interpolated (or not ours). */
export function mockNoteClipId(note: string): string | null {
  if (typeof note !== "string") return null;
  const wanted = note.trim().replace(/\s+/g, " ");
  if (wanted.length === 0) return null;
  for (const line of mockNoteLines()) {
    if (!line.renderable) continue;
    if (line.template.trim().replace(/\s+/g, " ") === wanted) return line.id;
  }
  return null;
}

/**
 * FNV-1a, 32-bit. Small, dependency-free, and stable across engines - the
 * three things a deterministic fixture hash has to be.
 */
export function hashRequest(req: SanitizedCoachRequest): number {
  const source = [
    req.stopId,
    req.lang,
    req.missed.join(","),
    req.slow.join(","),
    // Quantised: a hit rate of 0.8231 and 0.8234 are the same run to a child,
    // and an unquantised float would make the template flap on noise.
    Math.round(req.hitRate * 100).toString(),
  ].join("|");

  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    // 32-bit FNV prime multiply, written as shifts to stay in int range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Pick deterministically. The tables above are compile-time constants and are
 * never empty, and the modulo keeps the index in range - neither fact is
 * visible to noUncheckedIndexedAccess, and a `?? fallback` here would be a
 * branch no test could ever reach. `templateTablesAreUsable` asserts the
 * precondition instead, and a unit test runs it.
 */
function pick(table: readonly string[], hash: number): string {
  return table[hash % table.length] as string;
}

/** The precondition `pick` relies on, exposed so a test can hold it. */
export function templateTablesAreUsable(): boolean {
  return [TWO_MISSED, ONE_MISSED, ONE_SLOW, CLEAN].every(
    (table) => table.length > 0 && table.every((entry) => entry.length > 0),
  );
}

/** Build the canned note for a request. Exported so the demo can assert it. */
export function mockNote(req: SanitizedCoachRequest): string {
  const hash = hashRequest(req);
  const [firstMissed, secondMissed] = req.missed;
  const [firstSlow] = req.slow;

  if (firstMissed !== undefined && secondMissed !== undefined) {
    return pick(TWO_MISSED, hash)
      .replace("{a}", firstMissed)
      .replace("{b}", secondMissed);
  }
  if (firstMissed !== undefined) {
    return pick(ONE_MISSED, hash).replace("{a}", firstMissed);
  }
  if (firstSlow !== undefined) {
    return pick(ONE_SLOW, hash).replace("{a}", firstSlow);
  }
  return pick(CLEAN, hash);
}

/** A caller-supplied source of variants, for demo scripts and content tests. */
export type MockVariantSource = (req: SanitizedCoachRequest) => CoachVariants;

export interface MockCoachOptions {
  readonly validator: CoachValidator;
  /** Default: the shipped bundle (also the default variant source). */
  readonly fallback?: FallbackBundle;
  /** Override the two sentence variants. */
  readonly variants?: MockVariantSource;
}

export function createMockCoach(options: MockCoachOptions): CoachClient {
  const bundle = options.fallback ?? DEFAULT_FALLBACK_BUNDLE;
  const variantsFor: MockVariantSource =
    options.variants ??
    ((req) => fallbackFor(bundle, req.lang, req.stopId).variants);

  return {
    transport: "mock",
    request(req: CoachRequest): Promise<CoachResult> {
      const safe = options.validator.sanitize(req);
      const payload: CoachPayload = {
        note: mockNote(safe),
        variants: variantsFor(safe),
      };
      // Same validator, same fallback, same result shape as the live paths.
      return Promise.resolve(
        settle(payload, req, options.validator, bundle, "mock"),
      );
    },
  };
}
