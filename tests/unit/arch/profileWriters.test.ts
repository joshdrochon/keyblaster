/**
 * THE "UNTESTED BY CONSTRUCTION" DETECTOR (P2d).
 *
 * Five defects in one night shared one shape: a module that was complete,
 * unit-tested and inside the 95% coverage gate, with nothing in the shipped
 * game able to reach it. The suite was green over a game that could not run
 * the code.
 *
 *   trophies never earned          nothing wrote `profile.trophies`
 *   StopProgress.cleared never set nothing wrote `profile.progress`
 *   calibration never ran          nothing wrote `profile.calibration`
 *   no ship or skin unlockable     nothing wrote `profile.unlockedShips/Skins`
 *   the word book never persisted  nothing wrote `profile.words`
 *
 * Five of the six are the SAME invariant violated five times:
 *
 *      every field of the persisted Profile must have a live writer in src/game
 *
 * That is what this file checks. It is deliberately narrow. Two wider checks
 * were measured first and rejected, with the numbers, so nobody re-proposes
 * them:
 *
 *   - "an engine module with no importer in src/game" — 0 hits today, and it
 *     would have caught 0 of the 4. `awards/`, `calibration/` and `progress/`
 *     all HAVE game-side importers; the import was there, the write was not.
 *   - "an engine export never named in src/game" — 302 of 453 public symbols
 *     flagged (67%). Most are constants, types and helpers a barrel re-exports
 *     on purpose. A check with 67% noise is not a check.
 *
 * The field-level check flagged 3 of 13 fields and all 3 were real defects. All
 * three are now closed and the allowlist is empty; what the check does from here
 * is keep it that way.
 *
 * WHY A WRITER, NOT A READ. `blankProfile` and `resetProfileProgress` assign
 * every field, so "is this field ever assigned" is always true and always
 * useless. Both are resets — they are how a field becomes empty, not how it
 * becomes earned — so both are excluded by name below.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Fields with no live writer TODAY, each with the reason it is still here.
 * This list may only ever shrink. The second test in this file fails if an
 * entry is stale, so a fix cannot leave the allowlist lying.
 *
 * IT IS EMPTY. Every field of the persisted Profile now has a live writer in
 * the shipped game. The last three entries were:
 *
 *   unlockedShips  four ships drawn, catalogued, and unreachable. Closed by
 *   unlockedSkins  `@engine/unlocks.applyUnlocks`, called from ResultsScene
 *                  after the clear is written. The same file's standalone
 *                  profile, which hardcoded both arrays to [] exactly as it
 *                  once hardcoded `trophies: []`, is now `blankProfile`.
 *   words          FlightScene built a WordBook on every blast and dropped it
 *                  at stage end; `book: {}` was the shipped default and the
 *                  whole spaced-repetition system restarted every session.
 *                  Closed by `@engine/words.withProfileBook`, loaded at stage
 *                  start and written back at stage end AND at a stall.
 *
 * Adding an entry back is allowed - a field can legitimately arrive before its
 * writer - but it is a claim that has to be made in writing, with the ticket
 * that owns the fix, and the stale check below will not let it rot.
 */
const KNOWN_ORPHANS: Readonly<Record<string, string>> = {};

// ---------------------------------------------------------------------------
// Static analysis
// ---------------------------------------------------------------------------

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Comments are stripped before anything is matched. Otherwise the long prose
 * comments this repo writes about a defect would themselves satisfy the check
 * that the defect is fixed — which is exactly the failure mode the ticket board
 * was found to have.
 */
function stripComments(source: string): string {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // `(?<!:)` keeps `https://` and other protocol-relative text intact;
      // a line comment in this repo is always preceded by whitespace or code.
      .replace(/(?<!:)\/\/.*$/gm, "")
  );
}

/** The field names of `interface Profile` in src/engine/types.ts. */
export function profileFields(): string[] {
  const types = stripComments(readFileSync(path.join(ROOT, "src/engine/types.ts"), "utf8"));
  const block = /export interface Profile \{([\s\S]*?)\n\}/.exec(types);
  if (block === null) throw new Error("could not locate `interface Profile` in src/engine/types.ts");
  return [...block[1]!.matchAll(/^\s*([A-Za-z_$][\w$]*)\??\s*:/gm)].map((m) => m[1]!);
}

/**
 * Resets, not writers. These are how a field becomes empty. Counting them
 * would make every field trivially covered.
 */
const RESET_FUNCTIONS = new Set(["blankProfile", "resetProfileProgress", "emptyState"]);

export interface ProfileWriter {
  readonly name: string;
  readonly file: string;
  readonly fields: readonly string[];
}

/**
 * A profile writer is an exported function that takes a parameter called
 * `profile` or `p` and returns a spread of it with at least one Profile field
 * replaced — `return { ...profile, trophies: [...] }`. That is the shape every
 * pure updater in this repo uses.
 *
 * Requiring the parameter NAME is what keeps `laneInit` and `withStoredProgress`
 * out: both spread a `StoryInit` and reassign `progress` on it, which is a read
 * path dressed as a write and would otherwise certify `progress` as covered
 * even with `clearStopOnProfile` deleted.
 */
export function findProfileWriters(fields: readonly string[]): ProfileWriter[] {
  const writers: ProfileWriter[] = [];
  for (const file of tsFilesUnder(path.join(ROOT, "src"))) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const fn of text.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)[\s\S]*?\n\}/g,
    )) {
      const [whole, name, params] = [fn[0]!, fn[1]!, fn[2]!];
      if (RESET_FUNCTIONS.has(name)) continue;
      const profileParam = /(?:^|,)\s*(profile|p)\s*:/.exec(params)?.[1];
      if (profileParam === undefined) continue;
      const written = new Set<string>();
      for (const spread of whole.matchAll(
        new RegExp(`\\.\\.\\.\\s*${profileParam}\\s*,([\\s\\S]*?)\\n\\s*\\}`, "g"),
      )) {
        for (const key of spread[1]!.matchAll(/(?:^|[,{]\s*)\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
          if (fields.includes(key[1]!)) written.add(key[1]!);
        }
      }
      if (written.size > 0) {
        writers.push({ name, file: path.relative(ROOT, file), fields: [...written] });
      }
    }
  }
  return writers;
}

/** Every .ts under src/game plus src/main.ts, comments stripped. */
export function gameSource(): string {
  return [...tsFilesUnder(path.join(ROOT, "src/game")), path.join(ROOT, "src/main.ts")]
    .map((f) => stripComments(readFileSync(f, "utf8")))
    .join("\n");
}

/**
 * The two writes that go through the store API rather than a pure updater.
 * Both are asserted to be live below, so deleting the call site turns the
 * fields they cover into orphans rather than silently keeping them green.
 */
const STORE_WRITERS: ReadonlyArray<{ call: string; fields: readonly string[] }> = [
  { call: "createProfile", fields: ["id", "name", "avatar", "shipId", "shipName", "createdAt"] },
  { call: "updateSettings", fields: ["settings"] },
];

export function writersByField(source: string, fields: readonly string[]): Map<string, string[]> {
  // Stripped again here, not only in `gameSource()`. The first draft stripped
  // only at read time, so a mention of `awardTrophies(` in a COMMENT inside
  // src/game satisfied the check — the detector graded a defect fixed on the
  // strength of prose describing it, which is precisely the ticket-board bug
  // this repo already found once. The negative control below caught it.
  const game = stripComments(source);
  const cover = new Map<string, string[]>(fields.map((f) => [f, []]));
  for (const w of findProfileWriters(fields)) {
    if (!new RegExp(`\\b${w.name}\\s*\\(`).test(game)) continue;
    for (const f of w.fields) cover.get(f)?.push(`${w.name} (${w.file})`);
  }
  for (const s of STORE_WRITERS) {
    if (!new RegExp(`\\.${s.call}\\s*\\(`).test(game)) continue;
    for (const f of s.fields) cover.get(f)?.push(`store.${s.call}`);
  }
  return cover;
}

// ---------------------------------------------------------------------------

describe("every persisted Profile field has a live writer in src/game (P2d)", () => {
  const fields = profileFields();
  const cover = writersByField(gameSource(), fields);

  it("finds the Profile fields at all", () => {
    // Guards the parse: if `interface Profile` is renamed or reshaped, this
    // whole file would otherwise pass vacuously on an empty field list.
    expect(fields.length).toBeGreaterThanOrEqual(10);
    expect(fields).toContain("trophies");
    expect(fields).toContain("progress");
    expect(fields).toContain("calibration");
  });

  it("has no orphan field outside the documented allowlist", () => {
    const orphans = fields.filter((f) => cover.get(f)!.length === 0);
    const undocumented = orphans.filter((f) => !(f in KNOWN_ORPHANS));
    expect(
      undocumented,
      `Profile field(s) ${undocumented.join(", ")} have no live writer in src/game. ` +
        `The field is persisted, the engine can produce it, and nothing in the shipped ` +
        `game ever does. This is the P2d defect class. Add the writer, or add the field ` +
        `to KNOWN_ORPHANS with the ticket that owns the fix.`,
    ).toEqual([]);
  });

  it("does not keep a stale entry in the orphan allowlist", () => {
    // The allowlist may only shrink. Without this, fixing `words` and leaving
    // the entry behind would hide the next regression of the same field.
    const stale = Object.keys(KNOWN_ORPHANS).filter((f) => (cover.get(f)?.length ?? 0) > 0);
    expect(
      stale,
      `${stale.join(", ")} now has a writer; remove it from KNOWN_ORPHANS.`,
    ).toEqual([]);
    const gone = Object.keys(KNOWN_ORPHANS).filter((f) => !fields.includes(f));
    expect(gone, `${gone.join(", ")} is no longer a Profile field.`).toEqual([]);
  });

  it("the fields that WERE this defect stay covered", () => {
    // Every one of these was the bug once. Naming them explicitly means a
    // revert is caught by a test that says so, rather than by the generic
    // orphan test months later.
    for (const field of [
      "trophies",
      "progress",
      "calibration",
      "unlockedShips",
      "unlockedSkins",
      "words",
    ]) {
      expect(cover.get(field), `${field} lost its writer — this was a shipped defect once`)
        .not.toEqual([]);
    }
  });
});

describe("negative control: the detector can be made to fail", () => {
  // A check that cannot be made to fail is not a check (queue.md, standing
  // rule 5). Each control removes a real writer from the analysed text and
  // asserts the field goes orphan.
  const fields = profileFields();

  it.each([
    ["awardTrophies", "trophies"],
    ["clearStopOnProfile", "progress"],
    ["applyCalibration", "calibration"],
    ["applyUnlocks", "unlockedShips"],
    ["applyUnlocks", "unlockedSkins"],
    ["withProfileBook", "words"],
  ])("without %s, %s is reported as an orphan", (fn, field) => {
    const sabotaged = gameSource().replaceAll(`${fn}(`, "__removed__(");
    expect(writersByField(sabotaged, fields).get(field)).toEqual([]);
  });

  it("without the createProfile call site, the identity fields go orphan", () => {
    const sabotaged = gameSource().replaceAll(".createProfile(", ".__removed__(");
    expect(writersByField(sabotaged, fields).get("name")).toEqual([]);
  });

  it("a comment naming a writer does not satisfy the check", () => {
    // The ticket board was found to grade a defect fixed on the strength of
    // prose describing it. Comments are stripped, so this must stay orphan.
    const sabotaged = `${gameSource().replaceAll("awardTrophies(", "__removed__(")}
      // awardTrophies(profile, award) is called from the results screen
      /* awardTrophies(profile, award) */`;
    expect(writersByField(sabotaged, fields).get("trophies")).toEqual([]);
  });
});
