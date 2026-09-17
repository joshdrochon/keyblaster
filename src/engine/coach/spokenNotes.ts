import type { Lang } from "../types.js";
import {
  DEFAULT_FALLBACK_BUNDLE,
  fallbackNoteClipId,
  fallbackNoteLines,
  type FallbackBundle,
} from "./fallback.js";
import { mockNoteClipId, mockNoteLines } from "./mock.js";

/**
 * EVERY SENTENCE SHADOW CAN SAY AT A WARP BREAK, IN ONE PLACE (D63, D98).
 *
 * ==================== WHY THIS FILE EXISTS ====================
 * The coach note was excluded from the pre-render pass as "runtime LLM text,
 * unrenderable by construction". That was wrong twice over, and each time it
 * was wrong the diagnosis had to come from a player hearing the wrong voice:
 *
 *   1. `/api/coach` is behind a 1500 ms deadline with D33's SHIPPED FALLBACK
 *      BUNDLE behind it. With no proxy deployed the bundle plays every break.
 *   2. And the proxy is not even the default. `chooseTransport` gives an
 *      unconfigured build the MOCK, so the sentence a child hears today comes
 *      from `mock.ts` - which is where "That was a clean run, pilot." lives.
 *
 * Both were finite, authored sets classified as infinite. So the rule this
 * module encodes is: the set of speakable notes is enumerated FROM THE CODE
 * THAT PRODUCES THEM, and the render script, the runtime lookup and the D98
 * build guard all read that one enumeration. A list written by hand in any of
 * the three is how the first 28 renders came to target ids nothing ever spoke.
 *
 * ==================== THE PART THAT IS GENUINELY INFINITE ====================
 * `UNRENDERABLE_COACH_NOTES` is not an escape hatch, it is the honest residue:
 * three mock templates interpolate the child's own missed words (AC-15.5), and
 * a live model writes whatever it writes. Neither can be a file. Under D98
 * those notes are shown as TEXT and not spoken - silence, never an OS voice -
 * and the guard names them rather than letting a gap hide among them.
 */

/** Where a speakable note comes from. Both are shipped, authored strings. */
export type CoachNoteSource = "fallback" | "mock";

export interface SpokenCoachNote {
  /** The voice-clip id. Derived from the structure the text is authored in. */
  readonly id: string;
  readonly note: string;
  readonly source: CoachNoteSource;
  /** null for the mock, whose templates are English whatever the lang is. */
  readonly lang: Lang | null;
}

/** A sentence the game can say that no file can hold, and why. */
export interface UnrenderableCoachNote {
  readonly shape: string;
  readonly reason: string;
}

/**
 * Every fixed note the game can speak, with its id.
 *
 * Order is stable: the fallback bundle first (lang by lang, base then stop),
 * then the mock's slot-free pools. The render script renders this list and the
 * guard checks this list, so neither can drift from the other.
 */
export function coachNoteLines(
  bundle: FallbackBundle = DEFAULT_FALLBACK_BUNDLE,
): SpokenCoachNote[] {
  const lines: SpokenCoachNote[] = fallbackNoteLines(bundle).map((l) => ({
    id: l.id,
    note: l.note,
    source: "fallback" as const,
    lang: l.lang,
  }));
  for (const mock of mockNoteLines()) {
    if (mock.id === null) continue;
    lines.push({ id: mock.id, note: mock.template, source: "mock", lang: null });
  }
  return lines;
}

/**
 * The clip id for a note the game is about to speak, or null.
 *
 * THE LOOKUP IS ON THE LINE, NOT ON THE CALL SITE. `WarpScene` hands the audio
 * service the id `warp.coachNote`, which names a SCREEN; behind it are ten
 * fixed sentences and an open set of interpolated ones, so a file under that
 * name could only ever be one of them played over the text of another.
 *
 * Null is the correct answer for an interpolated mock note and for live model
 * text. Under D98 that means silence, not a system voice.
 */
export function coachNoteClipId(
  note: string,
  bundle: FallbackBundle = DEFAULT_FALLBACK_BUNDLE,
): string | null {
  return fallbackNoteClipId(note, bundle) ?? mockNoteClipId(note);
}

/**
 * The notes that can never be recorded, stated as data.
 *
 * The guard prints these when it fails so that "this line has no clip" always
 * comes with the question "is it one of these, or did someone forget to
 * render it" already answered.
 */
export function unrenderableCoachNotes(): UnrenderableCoachNote[] {
  const notes: UnrenderableCoachNote[] = mockNoteLines()
    .filter((l) => !l.renderable)
    .map((l) => ({
      shape: l.template,
      reason: `mock.${l.pool}[${l.index}] interpolates the child's own missed word (AC-15.5)`,
    }));
  notes.push({
    shape: "<live model text>",
    reason: "ProxyCoach / DirectCoach return whatever the model wrote (D32, D47)",
  });
  return notes;
}
