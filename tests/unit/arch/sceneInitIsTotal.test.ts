import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * UR-188: A SCENE'S `init` MUST ASSIGN EVERY FIELD IT READS FROM `data`.
 *
 * ================== THE DEFECT, AND WHY A GUARD ==================
 * Phaser REUSES the scene instance. `scene.start("Settings", {...})` runs
 * `init` again on the same object, so a field assigned only when its key is
 * present keeps the PREVIOUS visit's value:
 *
 *     if (data?.returnTo) this.returnTo = data.returnTo;   // stale
 *
 * The Title opened Settings and set `returnTo` to the Title. The map opens
 * Settings WITHOUT passing one - and inherited it, so the map drew the device
 * half of the settings screen under its own heading. The owner found it; two
 * screenshots, one per route, had passed, because each route is correct in
 * isolation and only the SEQUENCE is wrong.
 *
 * That is the shape of three separate bugs in one night - a scope that carried
 * over, a bob that kept its construction base, a focus that stayed on the stop
 * just flown. Each was verified in isolation and each was wrong on the second
 * visit. So the rule is enforced here rather than remembered:
 *
 *     this.x = data?.x ?? DEFAULT;      // total: every visit gets an answer
 *     if (data?.x) this.x = data.x;     // partial: the last visit leaks in
 *
 * Watch it fail: change any `init` below back to the conditional form.
 */

const SCENES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes");

function sceneFiles(): string[] {
  return readdirSync(SCENES).filter((f) => f.endsWith("Scene.ts"));
}

/**
 * The body of `init(...)`, or null when the scene does not define one.
 *
 * The parameter list is skipped by BALANCING ITS PARENS first: `data?: {
 * returnTo?: string }` contains a brace, and taking the next `{` after the
 * signature returns the type annotation instead of the body - which would make
 * the sweep below pass on text that cannot contain an assignment at all.
 */
function initBody(src: string): string | null {
  const start = src.search(/^\s{2}(?:override\s+)?init\s*\(/m);
  if (start < 0) return null;
  const paren = src.indexOf("(", start);
  let parens = 0;
  let afterParams = -1;
  for (let i = paren; i < src.length; i += 1) {
    if (src[i] === "(") parens += 1;
    else if (src[i] === ")") {
      parens -= 1;
      if (parens === 0) {
        afterParams = i;
        break;
      }
    }
  }
  if (afterParams < 0) return null;
  const open = src.indexOf("{", afterParams);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

describe("UR-188: every scene's init is total", () => {
  it("finds the scenes, so the sweep cannot go quietly empty", () => {
    const files = sceneFiles();
    expect(files.length, `scene files: ${files.join(", ")}`).toBeGreaterThanOrEqual(10);
    expect(files).toContain("SettingsScene.ts");
    expect(files).toContain("PauseScene.ts");
  });

  it("finds the scenes that actually HAVE an init, for the same reason", () => {
    const withInit = sceneFiles().filter((f) =>
      initBody(readFileSync(resolve(SCENES, f), "utf8")) !== null,
    );
    expect(withInit.length, `scenes with init: ${withInit.join(", ")}`).toBeGreaterThanOrEqual(3);
  });

  it("no scene assigns a field only when its key is present", () => {
    const offenders: string[] = [];
    for (const file of sceneFiles()) {
      const body = initBody(readFileSync(resolve(SCENES, file), "utf8"));
      if (body === null) continue;
      // `if (data?.x) this.y = ...` and `if (data.x) this.y = ...`, on one line
      // or wrapped - the shape that leaves the previous visit's value behind.
      const pattern = /if\s*\(\s*data\s*\??\.\s*\w+\s*\)\s*\{?\s*this\.\w+\s*=/g;
      for (const m of body.matchAll(pattern)) {
        offenders.push(`${file}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(
      offenders,
      `these leave the previous visit's value behind:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the two that caused it are written the total way", () => {
    // Named, because a sweep that passes on an empty set is not evidence.
    const settings = readFileSync(resolve(SCENES, "SettingsScene.ts"), "utf8");
    expect(initBody(settings)).toMatch(/this\.returnTo = data\?\.returnTo \?\?/);
    expect(initBody(settings)).toMatch(/this\.scope =/);
    const pause = readFileSync(resolve(SCENES, "PauseScene.ts"), "utf8");
    expect(initBody(pause)).toMatch(/this\.from = data\?\.from \?\?/);
  });
});
