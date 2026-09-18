/**
 * `scripts/render-voice.mjs` decides which of Shadow's 44 clips to re-render.
 * It used to decide on FILENAME alone, and that shipped the wrong audio twice
 * in one afternoon on 2026-09-17:
 *
 *   - A VOICE CHANGE was a silent no-op. Every clip was skipped as "already on
 *     disk" and the run reported success, while the manifest's voiceId was
 *     rewritten to the newly requested voice. For several minutes the manifest
 *     claimed one voice over 44 clips recorded in another.
 *   - A TEXT CHANGE was a silent no-op. A briefing line was reworded and the
 *     old clip stayed on disk saying the old words. That one was caught only
 *     because a separate guard compares manifest text to content text.
 *
 * `--force` existed for the first case and the script even said so in a
 * comment — which is a footgun wearing a label. It works only for whoever
 * reads the comment, and it costs a full 44-line re-render when one line moved.
 *
 * The decision now compares what each clip WAS MADE FROM against what is being
 * asked for, which makes --force an optimisation rather than a correctness
 * requirement.
 *
 * RULE 4 (docs/coding-standards.md): each case below was watched failing
 * against the real implementation before it was kept.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error - voice-cache.mjs is plain JS on purpose: render-voice.mjs runs directly
// with node at build time, outside any compile step.
import { needsRender, textFingerprint } from "../../../scripts/lib/voice-cache.mjs";

const VOICE = "J1UkN5Wmr20DZIiLKXHI";
const OTHER = "TX3LPaxmHKxFdv7VOQHJ";

const line = { id: "mars.preflightLine", text: "Asteroid belt ahead, pilot." };

/** A manifest row describing `line`, rendered in VOICE. */
const row = {
  id: line.id,
  file: `${line.id}.mp3`,
  chars: line.text.length,
  bytes: 97846,
  voiceId: VOICE,
  textSha: textFingerprint(line.text),
};

const ask = (over: Record<string, unknown> = {}) =>
  needsRender({ line, priorRow: row, fileExists: true, voiceId: VOICE, force: false, ...over });

describe("a clip is re-rendered when what it was made from no longer matches", () => {
  it("skips a clip whose voice and words are both unchanged", () => {
    expect(ask()).toBeNull();
  });

  it("RE-RENDERS when the voice changed", () => {
    // The exact accident: brass-1 requested, Liam on disk, every line skipped.
    // Watched failing with `null` while the decision read the filename only.
    const why = ask({ voiceId: OTHER });
    expect(why).not.toBeNull();
    expect(why).toContain("voice changed");
  });

  it("RE-RENDERS when the words changed", () => {
    // The second accident: the Mars line gained ", pilot" and the old audio
    // stayed. Watched failing with `null`.
    const moved = { ...line, text: "Asteroid belt ahead. Ready when you are, pilot." };
    expect(needsRender({ line: moved, priorRow: row, fileExists: true, voiceId: VOICE, force: false })).toBe(
      "text changed",
    );
  });

  it("RE-RENDERS a row whose voice was never recorded", () => {
    // Manifests written before this change carry no voiceId. They must not be
    // trusted as matching - the whole point is that we cannot know.
    const legacy = { ...row, voiceId: undefined };
    const why = needsRender({ line, priorRow: legacy, fileExists: true, voiceId: VOICE, force: false });
    expect(why).toContain("unrecorded");
  });

  it("RE-RENDERS when the audio file is gone even though the row survives", () => {
    expect(ask({ fileExists: false })).toBe("audio file missing");
  });

  it("RE-RENDERS a line that has no row at all", () => {
    expect(ask({ priorRow: undefined })).toBe("new line");
  });

  it("still honours --force, so a full re-render is always available", () => {
    expect(ask({ force: true })).toBe("forced");
  });

  it("does not mistake equal-length text for equal text", () => {
    // `chars` was the only text-ish field the manifest carried, and a reword
    // often keeps the length. Fingerprinting is why this cannot pass.
    // Watched failing with `null` when the check compared `chars`.
    const sameLength = { ...line, text: "Asteroid belt ahead, scout." };
    expect(sameLength.text.length).toBe(line.text.length);
    expect(
      needsRender({ line: sameLength, priorRow: row, fileExists: true, voiceId: VOICE, force: false }),
    ).toBe("text changed");
  });
});

describe("textFingerprint", () => {
  it("is stable for the same words and different for a single character", () => {
    expect(textFingerprint("Asteroid belt ahead.")).toBe(textFingerprint("Asteroid belt ahead."));
    expect(textFingerprint("Asteroid belt ahead.")).not.toBe(textFingerprint("Asteroid belt ahead!"));
  });
});
