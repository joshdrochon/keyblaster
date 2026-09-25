import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPACE } from "@game/ui/theme";

/** UR-201: one corner in the product. `radiusCard` (26) is gone. */
const UI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("UR-201: one corner radius", () => {
  it("the theme declares exactly one", () => {
    expect(SPACE.radius).toBe(16);
    expect((SPACE as Record<string, unknown>)["radiusCard"]).toBeUndefined();
  });

  it("nothing still references the removed token", () => {
    const hits = walk(UI).filter((f) => /\bSPACE\.radiusCard\b/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
