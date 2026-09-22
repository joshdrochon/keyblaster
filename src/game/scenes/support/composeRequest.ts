import type { CoachRequest, ComposeContext } from "@engine/coach";
import type { Lang, StopId } from "@engine/types";
import { hasStageBundle, stageBundle } from "../lib/content";
import { coachAllowlist, sightWordList } from "./vocab";

/**
 * THE ONE PLACE THAT DECIDES WHAT THE COACH IS ASKED FOR (D09, D33, E-AI-1).
 *
 * `WarpScene` used to build its `CoachRequest` inline, five fields long. It now
 * also has to decide whether this break can ask for a warp sentence composed
 * from the run, and that decision has a real answer that a test needs to be
 * able to reach. So it lives here, as a pure function over plain data, and the
 * scene calls it. `tests/unit/coach/warpSentenceLive.test.ts` calls the same
 * function - which is what makes that file a test of the SHIPPED composition
 * rather than of a hand-made fixture.
 *
 * WHY THE REQUEST CAN COME BACK WITHOUT `compose`. Four reasons, all of which
 * mean the same thing on screen: the child types the stop's shipped sentence
 * and there is no marker.
 *
 *   no bundle / no sentence  Earth is the launchpad and has no belt (D57), so
 *                            it has no warp break to compose for.
 *   nothing practised        A run with no missed word, no slow word and no
 *                            blast history has nothing to build a sentence
 *                            OUT of. Asking anyway would buy a sentence about
 *                            the stop, which is the Type Storm defect D09
 *                            exists to fix, at the price of a live call.
 *   empty pool               AC-12.3 would be unsatisfiable.
 *   empty allowlist          Spanish and Hindi, until `compile-allowlist`
 *                            lands. Every gate would refuse the result, so
 *                            the call is not worth making.
 *
 * It is STILL ONE CALL either way (AC-15.3). `compose` selects the second
 * prompt shape at the one `/api/coach` call the break already makes; it never
 * adds a second.
 */

export interface RunSummary {
  readonly stopId: StopId;
  readonly lang: Lang;
  /** Words that got past the player. Shadow names these (AC-15.5). */
  readonly missed: readonly string[];
  /** Typed correctly, but slowly. */
  readonly slow: readonly string[];
  readonly hitRate: number;
  /** D09: what the player actually shot down this run. */
  readonly blasted: readonly string[];
}

/** The compose block for this run, or undefined when there cannot be one. */
export function composeContextFor(run: RunSummary): ComposeContext | undefined {
  if (!hasStageBundle(run.stopId)) return undefined;
  const bundle = stageBundle(run.stopId);
  // No shipped sentence means no warp break (Earth, D57) - and also means the
  // fallback this feature degrades to would not exist.
  if (bundle.warpSentence === null) return undefined;
  if (bundle.pool.length === 0) return undefined;
  if (coachAllowlist(run.lang).size === 0) return undefined;

  const practised =
    run.missed.length + run.slow.length + run.blasted.length > 0;

  return {
    pool: bundle.pool,
    sightWords: sightWordList(run.lang),
    blasted: run.blasted,
    // D09 still refuses to BUY a sentence with nothing to build it from; the
    // pool rides along anyway so the proxy can keep the variants on-list.
    sentence: practised,
  };
}

/**
 * UR-64. The sentences this stop is allowed to hand a child when Shadow's note
 * offers to type a word again, in preference order.
 *
 * ================== WHY THESE AND ONLY THESE ==================
 * They are the stop's OWN SHIPPED PROSE: its warp sentence first, because that
 * is the sentence the break is supposed to have, then its briefing, which the
 * child read four screens ago and which is about the same planet. Nothing is
 * generated. `engine/coach/retry.ts` says why at length, and the short version
 * is `mock.ts`'s own warning - a transport inventing sentences it cannot check
 * is the failure the allowlist exists to prevent (D34, AC-13.1/13.2).
 *
 * BEING SHIPPED PROSE IS NOT A PASS. Every candidate still goes through all six
 * gates in `engine/coach/sentence.ts` before it can be shown, and most briefing
 * lines fail: they were written to be READ, so they run long, and three of them
 * carry a moon's name that is readable-only (story note 4) or a colon, which is
 * not a character a child can type. The filtering is the gate's job and is done
 * at the moment of use, against this child's allowlist and this stage's pool.
 *
 * `{shipName}` LINES ARE DROPPED HERE. Earth's briefing interpolates the ship's
 * name (C07) and a raw "{shipName}" would fail the typeable-character gate
 * anyway, but dropping it at the source keeps the candidate list a list of
 * sentences rather than of templates.
 */
export function retryCandidatesFor(stopId: StopId): readonly string[] {
  if (!hasStageBundle(stopId)) return [];
  const bundle = stageBundle(stopId);
  const out: string[] = [];
  if (bundle.warpSentence !== null) out.push(bundle.warpSentence);
  for (const line of bundle.briefing) {
    if (line.includes("{")) continue;
    out.push(line);
  }
  return out;
}

/** The request the warp break sends. One call, note always, sentence if it can. */
export function coachRequestFor(run: RunSummary): CoachRequest {
  const compose = composeContextFor(run);
  const base: CoachRequest = {
    stopId: run.stopId,
    lang: run.lang,
    missed: run.missed,
    slow: run.slow,
    hitRate: run.hitRate,
  };
  return compose === undefined ? base : { ...base, compose };
}
