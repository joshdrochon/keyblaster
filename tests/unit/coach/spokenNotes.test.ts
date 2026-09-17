import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_BUNDLE,
  MOCK_CLIP_PREFIX,
  MOCK_NOTE_POOLS,
  coachNoteClipId,
  coachNoteLines,
  fallbackFor,
  mockNoteClipId,
  mockNoteLines,
  unrenderableCoachNotes,
} from "@engine/coach/index.js";

/**
 * EVERY SENTENCE SHADOW CAN SAY AT A WARP BREAK (D63, D98; AC-21.8).
 *
 * The coach note was twice classified as unrenderable runtime text, and both
 * times the correction came from a player hearing the wrong voice rather than
 * from the suite: first D33's shipped fallback bundle, then `mock.ts`, which is
 * the DEFAULT transport and the source of "That was a clean run, pilot."
 *
 * So the enumeration is the unit under test here. `scripts/render-voice.mjs`
 * renders exactly what `coachNoteLines()` returns and `installAudio.speakNote`
 * looks up exactly what `coachNoteClipId()` resolves - one function, two
 * consumers, no list to keep in sync.
 */

describe("D98: the speakable notes are enumerated from the code that makes them", () => {
  it("covers both sources: the shipped fallback bundle and the mock's fixed notes", () => {
    const lines = coachNoteLines();
    expect(lines.some((l) => l.source === "fallback")).toBe(true);
    expect(lines.some((l) => l.source === "mock")).toBe(true);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    for (const l of lines) expect(l.note.trim().length).toBeGreaterThan(0);
  });

  it("resolves a fallback note and a mock note through the one lookup", () => {
    const fallbackNote = fallbackFor(DEFAULT_FALLBACK_BUNDLE, "en", "saturn").note;
    expect(coachNoteClipId(fallbackNote)).toBe("coach.fallback.en.saturn");
    expect(coachNoteClipId(MOCK_NOTE_POOLS.clean[0] as string)).toBe(
      `${MOCK_CLIP_PREFIX}.clean.0`,
    );
    expect(coachNoteClipId(MOCK_NOTE_POOLS.clean[1] as string)).toBe(
      `${MOCK_CLIP_PREFIX}.clean.1`,
    );
  });

  it("refuses an interpolated template, a live note, and anything that is not text", () => {
    // AC-15.5's templates name the child's own missed word, so the SHAPE is
    // shipped and the sentence is not. A clip for the shape would say "{a}".
    expect(coachNoteClipId(MOCK_NOTE_POOLS.oneMissed[0] as string)).toBe(null);
    expect(mockNoteClipId('Nice flying, pilot. Watch for "rivers" next time.')).toBe(null);
    expect(coachNoteClipId("Great work out there, pilot - that belt was quick.")).toBe(null);
    expect(coachNoteClipId("")).toBe(null);
    expect(mockNoteClipId("")).toBe(null);
    expect(coachNoteClipId(undefined as unknown as string)).toBe(null);
    expect(mockNoteClipId(undefined as unknown as string)).toBe(null);
  });

  it("marks exactly the templates with slots as unrenderable, and says why", () => {
    const lines = mockNoteLines();
    expect(lines.filter((l) => l.renderable).map((l) => l.id)).toEqual([
      "coach.mock.clean.0",
      "coach.mock.clean.1",
    ]);
    for (const l of lines) {
      expect(l.renderable, l.template).toBe(!l.template.includes("{"));
      expect(l.id === null, l.template).toBe(!l.renderable);
    }

    const excuses = unrenderableCoachNotes();
    expect(excuses.length).toBe(lines.filter((l) => !l.renderable).length + 1);
    // The live-model entry is the last one, and it is the only entry allowed to
    // have no slot in it.
    const withoutSlot = excuses.filter((e) => !e.shape.includes("{"));
    expect(withoutSlot).toHaveLength(1);
    expect(withoutSlot[0]?.shape).toBe("<live model text>");
  });
});
