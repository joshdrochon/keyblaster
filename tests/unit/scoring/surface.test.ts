import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as scoring from "@engine/scoring/index.js";
import { INITIAL_COMBO_STATE, computeStageResults } from "@engine/scoring/index.js";
import { profile, stopProgress, wordRecord } from "./fixtures.js";

/**
 * D31: "The player should always feel like the best typer in the world... No
 * red X's, no lives counter, no 'wrong' sound."
 *
 * That is usually read as a UI rule, but a UI can only render what the engine
 * hands it. If scoring/ ever exposes a lives count, a failure count or a wrong
 * count, the rule is one careless HUD binding away from being broken. So the
 * constraint is asserted structurally here, against the module's public surface
 * and its source, and it is a test rather than a comment so it survives edits.
 *
 * Typos and hull hits are *inputs* - the engine has to measure them (AC-3.2,
 * AC-4.2) - and accuracy is an output because it is the primary outcome in PRD
 * section 1. Neither is a failure score, so neither is banned.
 */

/** Identifiers that would give the module a failure-shaped concept (D31). */
const BANNED = [
  "lives",
  "life",
  "fail",
  "failure",
  "wrong",
  "wrongcount",
  "mistake",
  "error",
  "penalt",
  "deduct",
  "lost",
  "loss",
  "dead",
  "strike",
  "bad",
  "worse",
] as const;

function offendingToken(name: string): string | null {
  const lower = name.toLowerCase();
  return BANNED.find((b) => lower.includes(b)) ?? null;
}

/** Every key reachable from a value, so nested result objects are covered. */
function collectKeys(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    into.add(key);
    collectKeys(child, into, depth + 1);
  }
}

const SCORING_DIR = fileURLToPath(
  new URL("../../../src/engine/scoring/", import.meta.url),
);

/** Comments explain the ban; only code may be searched for it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("D31: the public surface has no failure-shaped concept", () => {
  it("D31: no export is named lives, failures, wrongCount or similar", () => {
    const offenders = Object.keys(scoring)
      .map((name) => [name, offendingToken(name)] as const)
      .filter(([, hit]) => hit !== null);
    expect(offenders).toEqual([]);
  });

  it("D31: the module exports something (the check above is not vacuous)", () => {
    expect(Object.keys(scoring).length).toBeGreaterThan(15);
    expect(Object.keys(scoring)).toContain("accuracy");
    expect(Object.keys(scoring)).toContain("starsForHullHits");
  });

  it("D31: no key of a produced results object is failure-shaped", () => {
    const results = computeStageResults({
      stopId: "jupiter",
      tally: {
        characters: 300,
        elapsedMs: 60_000,
        hits: 18,
        typos: 2,
        hullHits: 1,
      },
      exposures: [
        {
          word: "ice",
          fkLatencyMs: [500],
          hit: true,
          retention: true,
          prior: wordRecord({ fkLatencyMs: [900] }),
        },
      ],
      profile: profile([
        stopProgress("earth", { bestWpm: 10 }),
        stopProgress("mars", { bestWpm: 40, bestAccuracy: 0.8 }),
      ]),
    });

    const keys = new Set<string>();
    collectKeys(results, keys);
    collectKeys(INITIAL_COMBO_STATE, keys);
    collectKeys(scoring.scoreWordWithCombo(INITIAL_COMBO_STATE, 4), keys);

    expect(keys.size).toBeGreaterThan(10);
    const offenders = [...keys].filter((k) => offendingToken(k) !== null);
    expect(offenders).toEqual([]);
  });

  it("D31: no source identifier in the module introduces one either", () => {
    const files = readdirSync(SCORING_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(SCORING_DIR + file, "utf8"));
      for (const banned of BANNED) {
        if (new RegExp(banned, "i").test(code)) offenders.push(`${file}:${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("D31: typos and hull hits are accepted as inputs, not re-emitted", () => {
    // They are measured (AC-3.2, AC-4.2) and consumed here; what leaves the
    // module is accuracy and a star rating, never a running count of mistakes.
    const results = computeStageResults({
      stopId: "mars",
      tally: {
        characters: 100,
        elapsedMs: 60_000,
        hits: 5,
        typos: 5,
        hullHits: 2,
      },
      exposures: [],
      profile: profile([]),
    });
    expect(Object.keys(results)).not.toContain("typos");
    expect(Object.keys(results)).not.toContain("hullHits");
    expect(results.accuracy).toBe(0.5);
    expect(results.stars).toBe(1);
  });
});
