import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SHIPS, SKINS, liveryForShip, skinForShip } from "@game/ui/catalog.js";
import { UI_EN, UI_TABLES } from "@game/ui/strings.js";

/**
 * AC-6d.1 and AC-6d.1b — the ship/skin catalogue (D79).
 *
 *   AC-6d.1   "Skins unlock only from mastery milestones defined in config;
 *              no time/purchase path exists."
 *   AC-6d.1b  "4 ships (unlock at 1/3/5/7 beacons), 1 skin each (unlock:
 *              first 3-star stop, 25-combo, 50-combo, 100% retention set)."
 *
 * Both were previously read as covered because `tests/unit/awards/awards.test.ts`
 * is full of titles reading `AC-6d.1c`, which is the TROPHY criterion and a
 * different one. Nothing asserted the ship table.
 *
 * ================== WHAT THIS FILE DOES NOT CLAIM ==================
 * AC-6d.1b's thresholds are asserted as CONFIG, because config is all they are.
 * Nothing in `src/` ever adds an id to `profile.unlockedShips` or
 * `profile.unlockedSkins`: `blankProfile` writes the starting ship and the
 * lists are then read-only for the life of the profile. So "unlocks at 3
 * beacons" describes a sentence on a locked tile, not an event that can happen.
 *
 * That is the trophy defect of `engine/awards/index.ts` ("twelve trophies, and
 * not one could ever be earned") repeated one table over, and it is filed in
 * `gauntlet/escalations.md` as `U-ships`. It is deliberately NOT papered over
 * here with a test that asserts the table and calls the criterion met: this
 * file covers the half that holds, and the escalation carries the half that
 * does not.
 * ===================================================================
 */

const REPO = resolve(__dirname, "../../..");

/** AC-6d.1b, in the PRD's words, as data. */
const BEACON_THRESHOLDS = [1, 3, 5, 7] as const;
const MILESTONE_KEYS = [
  "ui.create.unlockStars", // first 3-star stop
  "ui.create.unlockChain25", // 25-combo
  "ui.create.unlockChain50", // 50-combo
  "ui.create.unlockRetention", // 100% retention set
] as const;

describe("AC-6d.1b: four ships at 1/3/5/7 beacons, one skin each (D79)", () => {
  it("AC-6d.1b: there are exactly four base ships", () => {
    expect(SHIPS.map((s) => s.id)).toHaveLength(4);
    expect(new Set(SHIPS.map((s) => s.id)).size).toBe(4);
  });

  it("AC-6d.1b: the four ships unlock at 1, 3, 5 and 7 beacons, in that order", () => {
    expect(SHIPS.map((s) => s.unlockBeacons)).toEqual([...BEACON_THRESHOLDS]);
  });

  it("AC-6d.1b: the first ship is reachable on the first beacon, so a new pilot is never locked out", () => {
    // 1, not 0: the starting hull is `blankProfile`'s, and the ship AT the
    // first threshold must be the one a pilot already has.
    expect(SHIPS[0]?.unlockBeacons).toBe(1);
    expect(SHIPS[0]?.id).toBe("ship-1");
  });

  it("AC-6d.1b: exactly one skin per ship, and no skin belongs to a ship that does not exist", () => {
    expect(SKINS).toHaveLength(SHIPS.length);
    for (const ship of SHIPS) {
      expect(skinForShip(ship.id), `${ship.id} has no skin`).toBeDefined();
    }
    const shipIds = new Set(SHIPS.map((s) => s.id));
    for (const skin of SKINS) expect(shipIds.has(skin.shipId)).toBe(true);
    expect(new Set(SKINS.map((s) => s.shipId)).size).toBe(SKINS.length);
  });

  it("AC-6d.1b: the four skin milestones are the four the PRD names, one each", () => {
    expect([...SKINS].map((s) => s.unlockKey).sort()).toEqual(
      [...MILESTONE_KEYS].sort(),
    );
  });

  it("AC-6d.1b: the chain milestones say the numbers they are named after", () => {
    // The copy is the only thing a child ever sees of the rule, so a table
    // that says chain50 while the sentence reads "25" is the rule being wrong.
    expect(UI_EN["ui.create.unlockChain25"]).toContain("25");
    expect(UI_EN["ui.create.unlockChain50"]).toContain("50");
    expect(UI_EN["ui.create.unlockBeacons"]).toContain("{n}");
  });

  it("AC-6d.1b: the four ships are four COLOURWAYS, not four silhouettes (AC-24.3)", () => {
    const keys = ["hull", "stripe", "glass", "lens"] as const;
    for (const key of keys) {
      const values = SHIPS.map((s) => s.colors[key].toUpperCase());
      expect(new Set(values).size, `every ship shares one ${key}`).toBe(4);
    }
    // And a skin is a re-colour of its own ship, never a different ship.
    for (const skin of SKINS) {
      const base = SHIPS.find((s) => s.id === skin.shipId)!;
      expect(skin.colors.hull.toUpperCase()).not.toBe(base.colors.hull.toUpperCase());
    }
  });
});

describe("AC-6d.1b: a ship id resolves to the colours the game draws with", () => {
  it("AC-6d.1b: every ship id resolves to its own colourway", () => {
    for (const ship of SHIPS) {
      expect(liveryForShip(ship.id)).toEqual(ship.colors);
    }
  });

  it("AC-6d.1b: an unlocked skin is what the ship WEARS; a locked one is not", () => {
    const skin = SKINS[0]!;
    const base = SHIPS.find((s) => s.id === skin.shipId)!;
    expect(liveryForShip(skin.shipId, [])).toEqual(base.colors);
    expect(liveryForShip(skin.shipId, [skin.id])).toEqual(skin.colors);
    // Another ship's skin does not repaint this one.
    expect(liveryForShip(skin.shipId, [SKINS[1]!.id])).toEqual(base.colors);
  });

  it("AC-6d.1b: an id nothing knows falls back to the first ship rather than to nothing", () => {
    // `FlightScene` hands this straight to `render/lantern.ts`, which would
    // throw on an undefined hex. A repaired profile can carry any string.
    expect(liveryForShip("ship-does-not-exist")).toEqual(SHIPS[0]!.colors);
  });
});

describe("AC-6d.1: skins unlock from mastery only — no time path, no purchase path", () => {
  it("AC-6d.1: every skin's unlock condition is a mastery milestone", () => {
    for (const skin of SKINS) {
      expect(MILESTONE_KEYS as readonly string[]).toContain(skin.unlockKey);
    }
  });

  it("AC-6d.1: a skin definition has nowhere to put a price or a play-time", () => {
    // The structural half of "no path exists": the shape itself refuses one.
    const allowed = ["id", "shipId", "nameKey", "unlockKey", "colors"];
    for (const skin of SKINS) {
      expect(Object.keys(skin).sort()).toEqual([...allowed].sort());
    }
  });

  it("AC-6d.1: no unlock sentence, in any shipped language, offers to sell or to wait", () => {
    const forbidden =
      /\b(buy|purchase|price|coins?|gems?|store|shop|premium|comprar|precio|tienda|monedas?)\b|\b(minutes?|hours?|days?|daily|minutos?|horas?|d[ií]as?)\b/i;
    for (const [lang, table] of Object.entries(UI_TABLES)) {
      for (const key of [...MILESTONE_KEYS, "ui.create.unlockBeacons"] as const) {
        const copy = (table as Record<string, string>)[key] ?? "";
        expect(forbidden.test(copy), `${lang}/${key}: "${copy}"`).toBe(false);
      }
    }
  });

  it("AC-6d.1: nothing anywhere in src/ implements a purchase or a play-time unlock", () => {
    // The scan half. A milestone table with no purchase field would still be
    // defeated by an unlock granted somewhere else, so the whole shipped tree
    // is checked for the machinery such a path needs.
    const forbidden =
      /\b(iap|inAppPurchase|checkout|stripe\.|paywall|entitlement|purchaseS|playTimeMs|secondsPlayed|minutesPlayed|totalPlayMs)\b/;
    const hits: string[] = [];
    for (const file of sourceFiles(join(REPO, "src"))) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (forbidden.test(src)) hits.push(file.replace(`${REPO}/`, ""));
    }
    expect(hits).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if ([".ts", ".mjs"].includes(extname(full))) out.push(full);
  }
  return out;
}
