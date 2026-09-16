import type { Profile } from "@engine/types";
import type { MenuKey } from "./i18n.js";

/**
 * The ship, skin, avatar and trophy catalogue: what EXISTS and what UNLOCKS it,
 * as presentation data (D73, D74, D79, D80; AC-6d.1b, AC-6d.1c).
 *
 * WHAT THIS FILE IS NOT. It does not decide whether anything is unlocked. The
 * profile is the authority: `unlockedShips`, `unlockedSkins` and `trophies` are
 * persisted lists, and a screen only ever asks "is this id in that list?". The
 * `unlockKey` below is the SENTENCE a locked tile shows - "unlocks after 3
 * beacons" - not the rule that grants it. Awarding belongs in the engine
 * alongside the scoring and progress code that can see a stage end; if this
 * file ever grows an `if (beacons >= 3)` it has become game logic in a scene
 * and is in the wrong place.
 *
 * Ids are the ones `blankProfile` already writes (`ship-1`, `avatar-1`), so a
 * fresh profile lines up with this catalogue without a migration.
 */

export interface ShipDef {
  readonly id: string;
  readonly nameKey: MenuKey;
  /** Copy for the locked state, e.g. "unlocks after 3 beacons". */
  readonly unlockKey: MenuKey;
  /** Beacons required, substituted into `unlockKey` as {n} (D79). */
  readonly unlockBeacons: number;
  /** Hull, stripe, porthole glass, emitter lens. Vector only (D83). */
  readonly colors: {
    readonly hull: string;
    readonly stripe: string;
    readonly glass: string;
    readonly lens: string;
  };
}

/**
 * Four ships (D79/AC-6d.1b), unlocking at 1 / 3 / 5 / 7 beacons. They share the
 * Lantern silhouette family and differ in colourway - the four colourways of
 * `design-reference/refs` are the four base ships (AC-24.3).
 */
export const SHIPS: readonly ShipDef[] = [
  {
    id: "ship-1",
    nameKey: "ui.ship.ship-1",
    unlockKey: "ui.create.unlockBeacons",
    unlockBeacons: 1,
    colors: { hull: "#F2EDE3", stripe: "#FF6B4A", glass: "#9FD8F0", lens: "#FFC857" },
  },
  {
    id: "ship-2",
    nameKey: "ui.ship.ship-2",
    unlockKey: "ui.create.unlockBeacons",
    unlockBeacons: 3,
    colors: { hull: "#DCE6F2", stripe: "#3C7BD9", glass: "#F5D58A", lens: "#6FA8FF" },
  },
  {
    id: "ship-3",
    nameKey: "ui.ship.ship-3",
    unlockKey: "ui.create.unlockBeacons",
    unlockBeacons: 5,
    colors: { hull: "#E8E2F2", stripe: "#8A6BD9", glass: "#C8FFE8", lens: "#D6D3EA" },
  },
  {
    id: "ship-4",
    nameKey: "ui.ship.ship-4",
    unlockKey: "ui.create.unlockBeacons",
    unlockBeacons: 7,
    colors: { hull: "#F6EEDC", stripe: "#3E9DAF", glass: "#FFE29A", lens: "#9FD8F0" },
  },
];

export interface SkinDef {
  readonly id: string;
  readonly shipId: string;
  readonly nameKey: MenuKey;
  readonly unlockKey: MenuKey;
  readonly colors: ShipDef["colors"];
}

/**
 * One skin per ship (AC-6d.1b): first 3-star stop, a 25 chain, a 50 chain, and
 * a full retention set. Mastery only - there is no time-played path and no
 * purchase path, by construction: there is nowhere in this table to put one.
 */
export const SKINS: readonly SkinDef[] = [
  {
    id: "skin-1",
    shipId: "ship-1",
    nameKey: "ui.skin.ship-1",
    unlockKey: "ui.create.unlockStars",
    colors: { hull: "#FFD9B0", stripe: "#B5522A", glass: "#FFF3D6", lens: "#FF6B4A" },
  },
  {
    id: "skin-2",
    shipId: "ship-2",
    nameKey: "ui.skin.ship-2",
    unlockKey: "ui.create.unlockChain25",
    colors: { hull: "#9FB6E8", stripe: "#0B173F", glass: "#DDE7FF", lens: "#6FA8FF" },
  },
  {
    id: "skin-3",
    shipId: "ship-3",
    nameKey: "ui.skin.ship-3",
    unlockKey: "ui.create.unlockChain50",
    colors: { hull: "#FFFFFF", stripe: "#7ECBD8", glass: "#C8FFE8", lens: "#BFE7EE" },
  },
  {
    id: "skin-4",
    shipId: "ship-4",
    nameKey: "ui.skin.ship-4",
    unlockKey: "ui.create.unlockRetention",
    colors: { hull: "#F5E6D0", stripe: "#C97B3F", glass: "#FFE29A", lens: "#FFB3C7" },
  },
];

/** Six pilot marks. Silhouettes, not colour variants (see chrome.drawAvatar). */
export const AVATARS: readonly { id: string; nameKey: MenuKey }[] = [
  { id: "avatar-1", nameKey: "ui.avatar.avatar-1" },
  { id: "avatar-2", nameKey: "ui.avatar.avatar-2" },
  { id: "avatar-3", nameKey: "ui.avatar.avatar-3" },
  { id: "avatar-4", nameKey: "ui.avatar.avatar-4" },
  { id: "avatar-5", nameKey: "ui.avatar.avatar-5" },
  { id: "avatar-6", nameKey: "ui.avatar.avatar-6" },
];

export interface TrophyDef {
  readonly id: string;
  readonly nameKey: MenuKey;
  /** What earns it, shown whether or not it is earned. */
  readonly howKey: MenuKey;
}

/**
 * The twelve trophies of D80, in the order PRD AC-6d.1c lists them.
 *
 * D74: mastery-based, INFORMATIONAL, never comparative. So the Beacon Log shows
 * every trophy's name and how it is earned to every player, earned or not, and
 * shows nothing that could be read as a standing: no tier, no rarity, no count
 * of who else has it, no order by value. Grounded in Deci, Koestner & Ryan
 * (1999) - informational feedback supports motivation, controlling feedback
 * undermines it - which is also why an unearned trophy reads as an invitation
 * ("not yet") rather than an absence.
 */
export const TROPHIES: readonly TrophyDef[] = [
  { id: "firstLight", nameKey: "ui.trophy.firstLight", howKey: "ui.trophy.firstLight.how" },
  { id: "pathfinder", nameKey: "ui.trophy.pathfinder", howKey: "ui.trophy.pathfinder.how" },
  { id: "beltRunner", nameKey: "ui.trophy.beltRunner", howKey: "ui.trophy.beltRunner.how" },
  { id: "ringWeaver", nameKey: "ui.trophy.ringWeaver", howKey: "ui.trophy.ringWeaver.how" },
  { id: "chain25", nameKey: "ui.trophy.chain25", howKey: "ui.trophy.chain25.how" },
  { id: "chain50", nameKey: "ui.trophy.chain50", howKey: "ui.trophy.chain50.how" },
  { id: "sharpEye", nameKey: "ui.trophy.sharpEye", howKey: "ui.trophy.sharpEye.how" },
  { id: "steadyHull", nameKey: "ui.trophy.steadyHull", howKey: "ui.trophy.steadyHull.how" },
  { id: "longMemory", nameKey: "ui.trophy.longMemory", howKey: "ui.trophy.longMemory.how" },
  { id: "mapMaker", nameKey: "ui.trophy.mapMaker", howKey: "ui.trophy.mapMaker.how" },
  { id: "darkSide", nameKey: "ui.trophy.darkSide", howKey: "ui.trophy.darkSide.how" },
  { id: "lastLight", nameKey: "ui.trophy.lastLight", howKey: "ui.trophy.lastLight.how" },
];

export function shipDef(id: string): ShipDef {
  return SHIPS.find((s) => s.id === id) ?? (SHIPS[0] as ShipDef);
}

export function skinForShip(shipId: string): SkinDef | undefined {
  return SKINS.find((s) => s.shipId === shipId);
}

/** The colourway a profile's ship is currently wearing (base or its skin). */
export function liveryFor(profile: Profile): ShipDef["colors"] {
  const skin = skinForShip(profile.shipId);
  if (skin && profile.unlockedSkins.includes(skin.id)) return skin.colors;
  return shipDef(profile.shipId).colors;
}

/** Beacons placed, read straight off persisted progress (D44). */
export function beaconCount(profile: Profile): number {
  return profile.progress.filter((p) => p.beaconPlacedAt !== null).length;
}

/** The furthest stop with a beacon, or null. Route order is progress order. */
export function furthestBeacon(profile: Profile): string | null {
  let furthest: string | null = null;
  for (const p of profile.progress) {
    if (p.beaconPlacedAt !== null) furthest = p.stopId;
  }
  return furthest;
}
