/**
 * Which of Shadow's clips need re-rendering, and why.
 *
 * Extracted from `render-voice.mjs` so it can be swept by a test: that script
 * runs its work at import time and exits, so importing it from a test executes
 * the whole CLI. A decision this load-bearing needs to be exercised directly.
 */
import { createHash } from "node:crypto";

/** Short, stable fingerprint of the exact words a clip was rendered from. */
export function textFingerprint(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * WHY A CLIP IS RE-RENDERED, and why "the file exists" is not enough.
 *
 * This skipped on FILENAME alone. Two things therefore looked like success
 * while shipping the wrong audio, both on 2026-09-17:
 *
 *   - A VOICE CHANGE was a silent no-op. Every clip was skipped, and the
 *     manifest's voiceId was still rewritten to the requested voice, so for a
 *     few minutes the manifest claimed one voice over 44 clips of another.
 *   - A TEXT CHANGE was a silent no-op. A briefing line was reworded and the
 *     old audio stayed on disk saying the old words.
 *
 * `--force` existed for the first case and a comment said so, which is a
 * footgun wearing a label: it works only for whoever reads the comment, and
 * costs a full re-render of all 44 lines when one changed.
 *
 * So the decision now compares what the clip WAS made from against what is
 * being asked for. Cheap, exact, and it makes --force an optimisation rather
 * than a correctness requirement.
 */
export function needsRender({ line, priorRow, fileExists, voiceId, force }) {
  if (force === true) return "forced";
  if (priorRow === undefined) return "new line";
  if (!fileExists) return "audio file missing";
  if (priorRow.voiceId !== voiceId) {
    return `voice changed (${priorRow.voiceId ?? "unrecorded"} -> ${voiceId})`;
  }
  if (priorRow.textSha !== textFingerprint(line.text)) return "text changed";
  return null;
}

