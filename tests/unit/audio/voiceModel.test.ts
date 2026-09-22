import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * THE VOICE MODEL IS A DECISION, NOT A FLAG (UR-140, D88).
 *
 * ================== WHY THIS FILE EXISTS ==================
 * Shadow's clips were re-rendered twice by accident on one night. The first
 * time a manifest rewrite broke the script's "already on disk" check and all
 * 44 lines went again; the second, a request to warm ONE line was applied to
 * the whole set with `--model eleven_multilingual_v2 --stability 0.6`. The
 * originals were unrecoverable, and the owner asked for the right model to be
 * written down and guarded so it cannot happen a third time.
 *
 * ================== THE MODEL, AND WHY ==================
 * `eleven_flash_v2_5` at `stability 0.92`, voice `J1UkN5Wmr20DZIiLKXHI`.
 *
 * Flash is the one the owner keeps: it is crisper and less breathy on short
 * lines, which is what Shadow speaks - a beacon note is eight words, not a
 * paragraph. `multilingual_v2` at a low stability was tried and described as
 * warmer but wrong, and it is also the slower and dearer of the two for a set
 * that is entirely English (D95 cut ES and HI from the shipped menu).
 *
 * Stability near 1.0 flattens delivery; 0.92 keeps the reading even across a
 * set rendered over several sittings without going robotic. Below ~0.8 the
 * same line read twice drifts audibly in pace, which is what made the warm
 * pass sound like a different robot from one stop to the next.
 *
 * ================== WHAT IS ASSERTED, AND WHY THAT ==================
 * Two things that would each have caught the accident on their own:
 *
 *   1. the SCRIPT's defaults, so a bare `render-voice.mjs --live` renders the
 *      right thing - both accidents ran without an explicit `--model`;
 *   2. the MANIFEST's recorded model, so the clips ON DISK are known to have
 *      come from it. A default nobody used proves nothing about the audio.
 *
 * Changing the model is allowed - it is a decision, and this file is where it
 * is recorded - but it now takes an edit HERE, which is a place somebody has
 * to read the paragraph above before they touch.
 */

/** The model every shipped clip is rendered with. */
const MODEL = "eleven_flash_v2_5";
/** Stability, as a string because that is how the CLI default is written. */
const STABILITY = "0.92";
/** Shadow's voice. */
const VOICE_ID = "J1UkN5Wmr20DZIiLKXHI";

const SCRIPT = readFileSync("scripts/render-voice.mjs", "utf8");
const MANIFEST = JSON.parse(
  readFileSync("src/content/audio/voice/manifest.json", "utf8"),
) as { model?: string; voiceId?: string; lang?: string; lines?: { voiceId?: string }[] };

describe("AC-21.9 / D102: the voice model is pinned", () => {
  it("the render script defaults to the model we keep", () => {
    // WATCHED FAILING with the default set to `eleven_multilingual_v2`:
    // "expected 'eleven_multilingual_v2' to be 'eleven_flash_v2_5'".
    const found = SCRIPT.match(/const MODEL = value\("model", "([^"]+)"\)/)?.[1];
    expect(found, "render-voice.mjs no longer declares a default model").toBeDefined();
    expect(found).toBe(MODEL);
  });

  it("the render script defaults to the stability we keep", () => {
    const found = SCRIPT.match(/stability: Number\(value\("stability", "([^"]+)"\)\)/)?.[1];
    expect(found, "the stability default moved or was removed").toBeDefined();
    expect(found).toBe(STABILITY);
  });

  it("the clips ON DISK were rendered with it", () => {
    // The half a default cannot prove. Both accidents left a manifest that
    // said so plainly; nothing was reading it.
    expect(MANIFEST.model).toBe(MODEL);
    expect(MANIFEST.voiceId).toBe(VOICE_ID);
  });

  it("every clip came from the one voice", () => {
    // A set half in one voice and half in another is the shape a partial
    // re-render leaves behind, and it is audible between two stops.
    const voices = new Set((MANIFEST.lines ?? []).map((l) => l.voiceId));
    expect([...voices]).toEqual([VOICE_ID]);
  });

  it("the set is English, which is what makes flash the right choice", () => {
    // D95 cut ES and HI from the shipped menu. If that is ever reversed, the
    // multilingual model becomes a real question again - and this test is
    // where somebody will be standing when they find that out.
    expect(MANIFEST.lang).toBe("en");
  });

  it("the script still refuses to spend without a cap (D87)", () => {
    // Not about the model, but it is the other half of how the accident got
    // expensive: a live run with no ceiling.
    expect(SCRIPT).toMatch(/--cap-usd is required and must be > 0/);
  });
});
