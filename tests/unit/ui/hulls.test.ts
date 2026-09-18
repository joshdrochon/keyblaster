import { describe, expect, it } from "vitest";
import { blankProfile } from "@engine/persistence/index.js";
import { applyUnlocks } from "@engine/unlocks/index.js";
import type { Profile } from "@engine/types.js";
import { SHIPS } from "@game/ui/catalog";
import { equippedIndex, hullSlots, stepHull } from "@game/ui/hulls";

/**
 * UR-48: WHAT THE SETTINGS HULL ROW OFFERS, AND WHAT IT REFUSES.
 *
 * ================== WHY THESE ASSERTIONS ARE HERE ==================
 * `vite.config.ts` runs the unit suite in `environment: "node"`, so nothing
 * that touches Phaser can be asserted in it. The Settings hull row therefore
 * keeps every DECISION it makes in `src/game/ui/hulls.ts`, which is pure, and
 * `cockpit.HullRow` only holds the pen - the same split `panel.ts` and
 * `cockpit.ts` already use for the knob and the toggle.
 *
 * The alternative was to leave "a locked hull cannot be chosen" asserted only
 * by an e2e. The e2e suite on this box is the part that goes red under load -
 * 11 of 14 failures in one afternoon were contention - and that is the worst
 * possible home for the assertion that a child cannot wear a ship they have not
 * earned. The e2e (`tests/e2e/hull-equip.spec.ts`) still runs the real
 * keystrokes; this runs the rule.
 *
 * ================== WATCH IT FAIL (rule 4) ==================
 * Every value below was read off a red run, not predicted.
 *
 *   `hullSlots` filtered to held hulls only - the shape a row that offered
 *   only what you already own would have. Four cases red, on a 5-beacon pilot:
 *
 *     D73/D79 all four hulls are offered, locked ones included
 *       a hull vanished from the row - a child cannot play towards a ship the
 *       game never shows them: expected 3 to be 4
 *     D73/D79 a hull this pilot has not earned is locked
 *       ship-4 needs seven beacons and this pilot has five: expected undefined
 *       to be true
 *     D73/D79 a locked hull carries the beacon count that opens it
 *       expected [ 1 ] to deeply equal [ 1, 3, 5, 7 ]
 *     AC-18.1 the cursor reaches every hull, locked ones included, and wraps
 *       expected [ +0 ] to deeply equal [ +0, 1, 2, 3 ]
 *
 *   `locked` inverted - `canEquipShip(...)` with the `!` dropped, so held
 *   hulls read as locked and earned ones as open. Three cases red:
 *
 *     D73/D79 a hull this pilot has not earned is locked
 *       expected true to be false
 *     D73/D79 a locked hull carries the beacon count that opens it
 *       expected [ 'ship-1' ] to deeply equal [ 'ship-2', 'ship-3', 'ship-4' ]
 *     AC-6d.1b every hull opens at its own threshold, swept across the route
 *       expected [ 'ship-2', 'ship-3', 'ship-4' ] to deeply equal [ 'ship-1' ]
 *
 *   npx vitest run tests/unit/ui/hulls.test.ts --coverage.enabled=false
 */

/** A pilot with `n` beacons lit, unlocks granted by the real granter. */
function pilot(n: number, shipId = "ship-1"): Profile {
  const base = blankProfile({ id: "p1", createdAt: 1_700_000_000_000, name: "Ren" });
  const progress = base.progress.map((p, i) =>
    i < n
      ? { ...p, cleared: true, stars: 3 as const, beaconPlacedAt: 1_700_000_100_000 }
      : p,
  );
  return applyUnlocks({ ...base, progress, shipId });
}

describe("UR-48: the hull row's offer (D73, D79, AC-6d.1b)", () => {
  it("D73/D79 all four hulls are offered, locked ones included", () => {
    // The motivational point of the whole row. A child three beacons from the
    // albatross has to be able to SEE the albatross.
    const slots = hullSlots(pilot(5));
    expect(
      slots.length,
      "a hull vanished from the row - a child cannot play towards a ship the game never shows them",
    ).toBe(4);
    expect(slots.map((s) => s.ship.id)).toEqual(SHIPS.map((s) => s.id));
  });

  it("D73/D79 a hull this pilot has not earned is locked", () => {
    const slots = hullSlots(pilot(5));
    const at = (id: string) => slots.find((s) => s.ship.id === id);
    expect(at("ship-1")?.locked).toBe(false);
    expect(at("ship-2")?.locked).toBe(false);
    expect(at("ship-3")?.locked).toBe(false);
    expect(
      at("ship-4")?.locked,
      "ship-4 needs seven beacons and this pilot has five",
    ).toBe(true);
  });

  it("D73/D79 a locked hull carries the beacon count that opens it", () => {
    // The row prints `unlockKey` with this number, which is the same sentence
    // the create screen prints under the same tile. Read off the catalogue so
    // the two screens cannot drift.
    const slots = hullSlots(pilot(1));
    expect(slots.map((s) => s.ship.unlockBeacons)).toEqual([1, 3, 5, 7]);
    expect(slots.filter((s) => s.locked).map((s) => s.ship.id)).toEqual([
      "ship-2",
      "ship-3",
      "ship-4",
    ]);
  });

  it("AC-6d.1b every hull opens at its own threshold, swept across the route", () => {
    // Rule 5: sweep. One beacon count is the Mars-only harness.
    const openAt = (n: number): string[] =>
      hullSlots(pilot(n)).filter((s) => !s.locked).map((s) => s.ship.id);
    // ZERO BEACONS STILL HOLDS SHIP-1, and that is right rather than a leak:
    // `blankProfile` writes `unlockedShips: [shipId]`, so the starting hull is
    // held before the first flight. Asserted here because the first draft
    // expected [] and the run said `expected [ 'ship-1' ] to deeply equal []` -
    // a pilot who could not fly their own starting ship would be the defect.
    expect(openAt(0)).toEqual(["ship-1"]);
    expect(openAt(1)).toEqual(["ship-1"]);
    expect(openAt(2)).toEqual(["ship-1"]);
    expect(openAt(3)).toEqual(["ship-1", "ship-2"]);
    expect(openAt(5)).toEqual(["ship-1", "ship-2", "ship-3"]);
    expect(openAt(7)).toEqual(["ship-1", "ship-2", "ship-3", "ship-4"]);
  });

  it("AC-6d.1b exactly one hull is marked as the one being flown", () => {
    const slots = hullSlots(pilot(7, "ship-3"));
    expect(slots.filter((s) => s.equipped).map((s) => s.ship.id)).toEqual(["ship-3"]);
    expect(equippedIndex(slots)).toBe(2);
  });

  it("AC-6d.1b a profileless mount shows the shipped starting hull, not a blank row", () => {
    // Every e2e boot of one screen has no profile. The row must still draw four
    // hulls with ship-1 worn, rather than an empty readout that reads as a bug.
    const slots = hullSlots(null);
    expect(slots.length).toBe(4);
    expect(slots.filter((s) => s.equipped).map((s) => s.ship.id)).toEqual(["ship-1"]);
    expect(slots.filter((s) => s.locked).length).toBe(3);
  });

  it("AC-6d.1b a save naming a hull this build does not ship still opens on a real one", () => {
    // `decodeProfile` bounds `shipId` to a string; it does not check it against
    // the catalogue. `equippedIndex` must not hand back -1 and leave the glass
    // empty. Watched with `findIndex` returned raw: expected -1 to be 0.
    const slots = hullSlots(pilot(7, "ship-99"));
    expect(slots.some((s) => s.equipped)).toBe(false);
    expect(equippedIndex(slots)).toBe(0);
  });

  it("AC-18.1 the cursor reaches every hull, locked ones included, and wraps", () => {
    // LOCKED IS NOT SKIPPED. `focus.ts`: "locked changes what Enter does, not
    // whether you can look" - and a hull the cursor cannot land on is a hull a
    // screen reader can never announce.
    const n = hullSlots(pilot(1)).length;
    const visited = new Set<number>();
    let i = 0;
    for (let k = 0; k < n; k += 1) {
      visited.add(i);
      i = stepHull(i, 1, n);
    }
    expect([...visited].sort()).toEqual([0, 1, 2, 3]);
    // Wrapping both ways: a row that stops dead at the last hull makes a child
    // think the keyboard broke (`FocusList.move` gives the same reason).
    expect(stepHull(3, 1, 4)).toBe(0);
    expect(stepHull(0, -1, 4)).toBe(3);
    expect(stepHull(0, 0, 0)).toBe(0);
  });
});
