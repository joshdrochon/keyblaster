import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as scoring from "@engine/scoring/index.js";
import { INITIAL_COMBO_STATE, computeStageResults } from "@engine/scoring/index.js";
import { profile, stopProgress, wordRecord } from "./fixtures.js";

/**
 * A guard on THIS module's public surface. It is not AC-22b.1.
 *
 * AC-22b.1 is a static scan of `src/game` for a red failure state, a lives
 * counter or a "wrong" label, and it belongs to whoever writes the game layer;
 * nothing here can discharge it. What this file does is narrower and upstream
 * of it: D31 ("no red X's, no lives counter, no 'wrong' sound") is usually read
 * as a UI rule, but a UI can only render what the engine hands it. If scoring/
 * ever exposes a lives count, a failure count or a wrong count, the rule is one
 * careless HUD binding away from being broken. So the constraint is asserted
 * structurally against this module's exports and source, as a test rather than
 * a comment, so it survives future edits.
 *
 * Typos and hull hits are *inputs* - the engine has to measure them (AC-3.2,
 * AC-4.2) - and accuracy is an output because it is the primary outcome in PRD
 * section 1. Neither is a failure score, so neither is banned.
 */

/**
 * Banned WORDS, matched against identifier words rather than raw substrings.
 *
 * Substring matching was the first attempt and it was wrong in both directions.
 * It banned the built-in `Error` (the house style has
 * `class AllowlistViolation extends Error`), it banned `strike`, which is the
 * PRD's own word for a hull hit in AC-4.2, and it would have flagged `badge`,
 * `lifetime` and `deadline`. A ban list that cries wolf gets deleted by the
 * next person to hit it, which is worse than no ban list.
 *
 * `error` and `strike` are deliberately absent: an error is not a failure score
 * and a strike is the spec's own vocabulary.
 */
const BANNED_WORDS: ReadonlySet<string> = new Set([
  "lives",
  "life",
  "fail",
  "failed",
  "failure",
  "failures",
  "wrong",
  "mistake",
  "mistakes",
  "penalty",
  "penalties",
  "deduct",
  "deduction",
  "loser",
  "losers",
  "lost",
  "dead",
  "bad",
  "worse",
]);

/**
 * Split an identifier into its constituent lowercase words: camelCase,
 * PascalCase, SCREAMING_SNAKE and kebab all reduce to the same word list, so
 * `wrongCount` -> ["wrong", "count"] is caught while `badge` -> ["badge"],
 * `lifetime` -> ["lifetime"] and `deadline` -> ["deadline"] are not.
 */
export function identifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function offendingWord(identifier: string): string | null {
  return identifierWords(identifier).find((w) => BANNED_WORDS.has(w)) ?? null;
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

describe("scoring surface guard (D31)", () => {
  it("matches identifier words, not substrings", () => {
    // The matcher itself is the part most likely to be quietly wrong, so it is
    // tested directly against the false positives that sank the first version.
    expect(offendingWord("wrongCount")).toBe("wrong");
    expect(offendingWord("livesRemaining")).toBe("lives");
    expect(offendingWord("FAILURE_COUNT")).toBe("failure");
    expect(offendingWord("badge")).toBeNull();
    expect(offendingWord("lifetime")).toBeNull();
    expect(offendingWord("deadline")).toBeNull();
    expect(offendingWord("Error")).toBeNull();
    expect(offendingWord("strikeCount")).toBeNull();
    expect(identifierWords("HTTPServerName")).toEqual(["http", "server", "name"]);
  });

  it("D31: no export is named lives, failures, wrongCount or similar", () => {
    const offenders = Object.keys(scoring)
      .map((name) => [name, offendingWord(name)] as const)
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
          prior: wordRecord({ firstFkLatencyMs: 900, fkLatencyMs: [900] }),
        },
      ],
      profile: profile([
        stopProgress("mars", { lastWpm: 40, lastAccuracy: 0.8 }),
      ]),
    });

    const keys = new Set<string>();
    collectKeys(results, keys);
    collectKeys(INITIAL_COMBO_STATE, keys);
    collectKeys(scoring.scoreWordWithCombo(INITIAL_COMBO_STATE, 4), keys);

    expect(keys.size).toBeGreaterThan(10);
    const offenders = [...keys].filter((k) => offendingWord(k) !== null);
    expect(offenders).toEqual([]);
  });

  it("D31: no identifier in the module source introduces one either", () => {
    const files = readdirSync(SCORING_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(SCORING_DIR + file, "utf8"));
      for (const identifier of code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) {
        const hit = offendingWord(identifier);
        if (hit !== null) offenders.push(`${file}: ${identifier} (${hit})`);
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
