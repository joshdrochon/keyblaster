import type { Profile } from "@engine/types";
import { canEquipShip } from "@engine/unlocks/index.js";
import { SHIPS, type ShipDef } from "./catalog.js";

/**
 * WHAT THE HULL ROW OFFERS, as data (UR-48; D73, D79; AC-6d.1b).
 *
 * ================== WHY THIS FILE IS PURE ==================
 * `vite.config.ts` runs the unit suite in `environment: "node"`, so nothing
 * that touches Phaser can be unit-tested at all - which is why `panel.ts` holds
 * the console's maths and `cockpit.ts` only holds the pen. The hull row follows
 * the same split: everything it DECIDES is here, and `cockpit.HullRow` draws
 * what this returns.
 *
 * The decisions are small and they are exactly the ones that were wrong before:
 * which hulls appear (all four, always), which are refused, and where the
 * cursor starts. A row that computed those inside a Phaser class would have
 * them asserted only by an e2e - and the e2e suite is the part of this build
 * that goes red under load, which is the worst possible home for the assertion
 * that a locked ship cannot be worn.
 *
 * ================== ALL FOUR, ALWAYS ==================
 * D73/D79 and the create screen's existing treatment: locked hulls are VISIBLE,
 * dim, and say what unlocks them. `hullSlots` therefore never filters. A row
 * that offered only what you hold would be a row a child learns nothing from -
 * seeing the ship you are three beacons away from is the reward doing its work
 * before it has been earned (Deci, Koestner & Ryan 1999 on informational
 * rewards, the same reasoning `catalog.TROPHIES` is written under).
 */

export interface HullSlot {
  readonly ship: ShipDef;
  /** Held by this profile, so Enter may equip it. */
  readonly locked: boolean;
  /** The hull this profile is wearing right now. */
  readonly equipped: boolean;
}

/**
 * The four hulls as this pilot sees them.
 *
 * `locked` is asked of `@engine/unlocks.canEquipShip`, never recomputed from a
 * beacon count: the threshold lives in `SHIP_UNLOCKS` and a second copy of
 * "3 beacons" in the game layer is a copy that can disagree with the toast the
 * child was shown when they earned it.
 *
 * `null` is a profileless mount - every e2e boot of a single screen - and gets
 * the shipped starting hull marked as worn and everything else locked, which is
 * what a brand-new pilot sees.
 */
export function hullSlots(profile: Profile | null): readonly HullSlot[] {
  return SHIPS.map((ship) => ({
    ship,
    locked: profile === null ? ship.id !== SHIPS[0]?.id : !canEquipShip(profile, ship.id),
    equipped: profile === null ? ship.id === SHIPS[0]?.id : profile.shipId === ship.id,
  }));
}

/**
 * Where the cursor opens: on the hull being worn.
 *
 * Falls back to 0 rather than to -1 so a save carrying a `shipId` this build no
 * longer ships - an id from a future catalogue, or one `decodeProfile` bounded
 * down to something unknown - opens the row on a real hull instead of drawing
 * an empty readout.
 */
export function equippedIndex(slots: readonly HullSlot[]): number {
  const i = slots.findIndex((s) => s.equipped);
  return i < 0 ? 0 : i;
}

/**
 * Move the cursor one hull, wrapping.
 *
 * IT DOES NOT SKIP LOCKED HULLS, and that is the whole point of the row: a
 * cursor that stepped over ship-4 would hide the thing the child is playing
 * towards, and a locked tile that cannot be landed on cannot be read out by a
 * screen reader either (`focus.ts`: "locked changes what Enter does, not
 * whether you can look").
 */
export function stepHull(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}
