/**
 * The evidence completeness classifier (tests/e2e/lib/evidenceCompleteness.ts).
 *
 * This exists because the classifier's interesting branch had never run. A
 * guard that reports a cause it has never actually distinguished is the same
 * shape of problem it was written to catch, and A-21.2 has now been red for
 * BOTH of the causes it separates - clobbered first, then never-written - so
 * both are real and both need to come out right.
 */

import { describe, expect, it } from "vitest";
import { missingEvidenceFields } from "../../e2e/lib/evidenceCompleteness.js";

const required = {
  music: { owner: "spec 3", fields: ["drivenBy", "hudSamples"] },
} as const;

describe("telling a clobbered field from one that was never written", () => {
  it("says nothing when the artifact is complete", () => {
    const missing = missingEvidenceFields({
      evidence: { music: { drivenBy: "hud", hudSamples: 42 } },
      everWritten: new Set(["music.drivenBy", "music.hudSamples"]),
      required,
    });
    expect(missing).toEqual([]);
  });

  /**
   * The A-21.2 failure as it stood for weeks: spec 3 wrote the fields and spec
   * 10 assigned over the key, so the write HAPPENED and the field is gone.
   */
  it("calls it CLOBBERED when the field was written and then removed", () => {
    const missing = missingEvidenceFields({
      evidence: { music: { stop: "earth", source: "track" } },
      everWritten: new Set(["music.drivenBy", "music.hudSamples"]),
      required,
    });
    expect(missing.map((m) => m.cause)).toEqual(["clobbered", "clobbered"]);
    expect(missing[0]?.detail).toContain("record()");
    // It must NOT send the reader to the owning spec: that spec did its job.
    expect(missing[0]?.detail).not.toContain("did not reach its write");
  });

  /**
   * The A-21.2 failure the day after: the clobbering was fixed, and spec 3
   * bailed on a precondition before writing anything at all.
   */
  it("calls it NEVER WRITTEN when the owning spec never got there, and names it", () => {
    const missing = missingEvidenceFields({
      evidence: {},
      everWritten: new Set<string>(),
      required,
    });
    expect(missing.map((m) => m.cause)).toEqual(["never-written", "never-written"]);
    expect(missing[0]?.detail).toContain("spec 3");
    expect(missing[0]?.detail).toContain("symptom, not the cause");
  });

  it("classifies each field on its own, because one key can suffer both", () => {
    // Spec A wrote `drivenBy` and a later writer removed it; `hudSamples` was
    // never written because the spec that owns it bailed first. One key, two
    // different causes, and a reader needs both named.
    const missing = missingEvidenceFields({
      evidence: { music: { stop: "earth" } },
      everWritten: new Set(["music.drivenBy"]),
      required,
    });
    expect(missing.map((m) => [m.path, m.cause])).toEqual([
      ["music.drivenBy", "clobbered"],
      ["music.hudSamples", "never-written"],
    ]);
  });

  it("a field written as undefined never counts as written", () => {
    // `record()` skips undefined values, so this is the state a spec that
    // computed nothing leaves behind. It is a missing field, not a clobbered one.
    const missing = missingEvidenceFields({
      evidence: { music: { drivenBy: "hud", hudSamples: undefined } },
      everWritten: new Set(["music.drivenBy"]),
      required,
    });
    expect(missing.map((m) => [m.path, m.cause])).toEqual([["music.hudSamples", "never-written"]]);
  });
});
