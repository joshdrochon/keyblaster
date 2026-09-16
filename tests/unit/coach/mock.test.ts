import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_BUNDLE,
  createCoachValidator,
  createMockCoach,
  fallbackFor,
  hashRequest,
  mockNote,
  templateTablesAreUsable,
} from "@engine/coach/index.js";
import { allowlist, marsRequest } from "./fixtures.js";

/**
 * MockCoach is the default transport for dev, offline, the demo and the
 * gauntlet (D47, AC-15.4, architecture 10.1b). Two things must hold:
 * determinism, and AC-15.5's demo beat - two scripted misses produce a note
 * that names those exact words.
 */

const validator = createCoachValidator({ allowlist });
const coach = createMockCoach({ validator });

describe("AC-15.5: the note names the missed words", () => {
  it("AC-15.5: two scripted misses produce a note naming both words", async () => {
    // The demo script (PRD section on the 3-minute demo): the pilot
    // deliberately misses "rivers" and "empty" at Mars.
    const result = await coach.request({
      stopId: "mars",
      lang: "en",
      missed: ["rivers", "empty"],
      slow: [],
      hitRate: 0.82,
    });

    expect(result.source).toBe("live");
    expect(result.note).toContain("rivers");
    expect(result.note).toContain("empty");
  });

  it("AC-15.5: different misses name different words", async () => {
    const a = await coach.request({ ...marsRequest, missed: ["rivers", "empty"] });
    const b = await coach.request({ ...marsRequest, missed: ["dust", "beacon"] });

    expect(a.note).toContain("rivers");
    expect(b.note).toContain("dust");
    expect(b.note).toContain("beacon");
    expect(b.note).not.toContain("rivers");
  });

  it("AC-15.5: one miss is named on its own", async () => {
    const result = await coach.request({ ...marsRequest, missed: ["rust"], slow: [] });
    expect(result.note).toContain("rust");
    expect(result.source).toBe("live");
  });

  it("AC-15.5: with no misses, the slowest word is named instead", async () => {
    const result = await coach.request({
      ...marsRequest,
      missed: [],
      slow: ["across"],
    });
    expect(result.note).toContain("across");
  });

  it("a clean run gets a clean-run note and still names nothing false", async () => {
    const result = await coach.request({
      ...marsRequest,
      missed: [],
      slow: [],
      hitRate: 1,
    });
    expect(result.source).toBe("live");
    expect(result.note.length).toBeGreaterThan(0);
  });

  it("D34: an off-list missed word is filtered out before it can be named", async () => {
    const result = await coach.request({
      ...marsRequest,
      missed: ["zorblax", "rivers"],
      slow: [],
    });
    expect(result.note).not.toContain("zorblax");
    expect(result.note).toContain("rivers");
  });
});

describe("determinism (AC-15.4, D85)", () => {
  it("AC-15.4: the same request always produces the same result", async () => {
    const runs = await Promise.all(
      new Array(8).fill(null).map(() => coach.request(marsRequest)),
    );
    const first = runs[0];
    for (const run of runs) expect(run).toEqual(first);
  });

  it("a fresh MockCoach agrees with an old one", async () => {
    const other = createMockCoach({ validator });
    expect(await other.request(marsRequest)).toEqual(await coach.request(marsRequest));
  });

  it("the hash is stable and quantises hit rate, so it does not flap on noise", () => {
    const base = { stopId: "mars", lang: "en", missed: ["rivers"], slow: [], hitRate: 0.8231 } as const;
    expect(hashRequest(base)).toBe(hashRequest({ ...base, hitRate: 0.8234 }));
    expect(hashRequest(base)).not.toBe(hashRequest({ ...base, hitRate: 0.42 }));
    expect(hashRequest(base)).not.toBe(hashRequest({ ...base, stopId: "pluto" }));
  });

  it("the template tables are non-empty, which is what makes the pick total", () => {
    expect(templateTablesAreUsable()).toBe(true);
  });

  it("mockNote is a pure function of the sanitized request", () => {
    const req = { stopId: "mars", lang: "en", missed: ["rivers", "empty"], slow: [], hitRate: 0.5 } as const;
    expect(mockNote(req)).toBe(mockNote(req));
  });
});

describe("MockCoach is held to the same rules as the live path", () => {
  it("AC-15.2: its output goes through the validator", async () => {
    // A variant source that smuggles an off-list word must fall back, not ship.
    const bad = createMockCoach({
      validator,
      variants: () => ["Mars is zorblax.", "Its dust is full of rust."],
    });
    const result = await bad.request(marsRequest);
    expect(result.source).toBe("fallback");
    expect(result.failure).toBe("allowlist");
  });

  it("AC-25.3: every template for every stop is free of banned terms", async () => {
    const words = ["rivers", "empty", "dust", "rust", "beacon", "across"];
    for (const stopId of ["mars", "jupiter", "pluto"] as const) {
      for (let i = 0; i < words.length; i += 1) {
        for (const missed of [[], [words[i] ?? ""], words.slice(i, i + 2)]) {
          const result = await coach.request({
            stopId,
            lang: "en",
            missed: missed.filter((w) => w.length > 0),
            slow: ["across"],
            hitRate: i / words.length,
          });
          expect(result.note.toLowerCase()).not.toContain("wrong");
          expect(result.note.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("AC-15.4: it reports itself as the mock transport", () => {
    expect(coach.transport).toBe("mock");
  });

  it("variants default to the shipped bundle for the stop", async () => {
    const result = await coach.request(marsRequest);
    expect(result.variants).toEqual(
      fallbackFor(DEFAULT_FALLBACK_BUNDLE, "en", "mars").variants,
    );
  });

  it("an injected variant source is used when supplied", async () => {
    const custom = createMockCoach({
      validator,
      variants: () => ["Mars is the red planet.", "Its dust is full of rust."],
    });
    const result = await custom.request(marsRequest);
    expect(result.variants).toEqual([
      "Mars is the red planet.",
      "Its dust is full of rust.",
    ]);
  });
});
