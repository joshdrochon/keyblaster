import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  blankProfile,
  createProfileStore,
  loadState,
} from "@engine/persistence/index.js";
import { STOP_IDS, type Profile, type StopProgress } from "@engine/types.js";
import { applyUnlocks, canEquipShip, equipShip } from "@engine/unlocks/index.js";
import { FakeClock, FakeStorage } from "../persistence/fixtures.js";

/**
 * UR-48: A HULL A CHILD EARNED CAN BE WORN, AND IT IS STILL WORN TOMORROW.
 *
 * ================== THE DEFECT ==================
 * Earning worked. Equipping was dead. `ResultsScene.persistUnlocks` ->
 * `applyUnlocks` -> store + flush genuinely grants ships at 1, 3, 5 and 7
 * beacons, and the ONLY writer of `profile.shipId` anywhere in `src/` outside
 * `blankProfile` / `decodeProfile` was `ProfileCreateScene`, at creation time -
 * where `unlocksForNewPilot()` grants `ship-1` and locks the other three tiles.
 * So `shipId` could only ever hold `ship-1` for any real pilot, and ships 2, 3
 * and 4 were drawn, catalogued, earnable and unwearable for the life of a save.
 *
 * That is coding-standards rule 2 - "every persisted field needs a live READER,
 * not just a writer" - and rule 2 names this field as its second instance. The
 * reader seam was closed by `scenes/lib/livery.ts`; without a writer it could
 * only ever report `ship-1`.
 *
 * ================== WHY THE ROUND TRIP AND NOT THE WRITE ==================
 * A test that asserts `equipShip(p, "ship-3").shipId === "ship-3"` proves the
 * spread works, which was never in doubt. What a child experiences is the
 * hull being there when they open the game tomorrow, and everything between the
 * press and tomorrow is store, debounce, encode, JSON, decode. `uppercase`
 * persisted PERFECTLY and did nothing; the mirror-image failure - a field that
 * changes in memory and does not survive the tab - is the same defect class and
 * is worse here, because the child earned this one.
 *
 * So the chain is run end to end: value -> store -> serialize -> SECOND store
 * over the same bytes -> read back. The second store is a real
 * `createProfileStore` over the bytes the first one wrote, which is what a
 * reload is.
 *
 * ================== WATCH IT FAIL (rule 4) ==================
 * Every value below was read off a red run, not predicted.
 *
 *   `equipShip` body replaced with `return profile;` - the state the game
 *   shipped in, where nothing anywhere could equip anything. Four cases red:
 *
 *     AC-6d.1b an earned hull can be equipped
 *       expected 'ship-1' to be 'ship-3'
 *     AC-6d.1b every hull the route opens can then be worn
 *       expected 'ship-1' to be 'ship-2'
 *     AC-19.1 an earned hull is worn, and survives a reload
 *       the equipped hull did not survive the reload: expected 'ship-1' to be
 *       'ship-3'
 *     AC-19.1 the load path is what reads it back, not a second decoder
 *       expected 'ship-1' to be 'ship-4'
 *
 *   The GUARD removed instead - `canEquipShip` forced to `return true`, so a
 *   locked hull can be worn. Three cases red, and they are DIFFERENT cases
 *   from the four above, which is what says the two halves are independent:
 *
 *     AC-6d.1b equipping refuses a hull this pilot does not hold
 *       expected true to be false
 *     AC-6d.1b a hull that does not exist at all is refused, not worn
 *       expected { id: 'p1', name: 'Ren', ...(12) } to be
 *       { id: 'p1', name: 'Ren', ...(12) }
 *     AC-19.1 a locked hull is refused, and the refusal survives too
 *       a locked hull was equipped: expected 'ship-4' to be 'ship-1'
 *
 *   `store.flush()` dropped from `App.equipShip` does NOT show up here - this
 *   file flushes for itself. That seam is `tests/e2e/hull-equip.spec.ts`, on a
 *   real reload.
 *
 *   npx vitest run tests/unit/unlocks/equip.test.ts --coverage.enabled=false
 */

/** A pilot with `n` beacons lit, which is what opens hulls (AC-6d.1b). */
function pilotWithBeacons(n: number): Profile {
  const base = blankProfile({ id: "p1", createdAt: 1_700_000_000_000, name: "Ren" });
  const progress: StopProgress[] = base.progress.map((p, i) =>
    i < n
      ? { ...p, cleared: true, stars: 3, beaconPlacedAt: 1_700_000_100_000 }
      : p,
  );
  // `applyUnlocks` is the real granter - the same call `ResultsScene` makes -
  // rather than a hand-written `unlockedShips` array. A fixture that grants
  // what no run can grant is a test of the fixture.
  return applyUnlocks({ ...base, progress });
}

/** Write a profile through a real store, then READ IT BACK THROUGH A NEW ONE. */
function reload(profile: Profile): Profile | null {
  const storage = new FakeStorage();
  const clock = new FakeClock();
  const first = createProfileStore({ storage, clock });
  const created = first.createProfile({ name: profile.name });
  first.updateProfile(created.id, () => ({ ...profile, id: created.id }));
  first.selectProfile(created.id);
  first.flush();

  // The bytes, as they are in storage. Not the in-memory object handed along:
  // the whole question is whether the field survives being turned into text.
  const bytes = storage.map.get(STORAGE_KEY);
  expect(bytes, "the store wrote nothing at all").toBeTruthy();
  expect(bytes).toContain(profile.shipId);

  const second = createProfileStore({
    storage: new FakeStorage({ [STORAGE_KEY]: bytes as string }),
    clock: new FakeClock(),
  });
  return second.activeProfile();
}

describe("UR-48: equipping an earned hull (AC-6d.1b, D73, D79)", () => {
  it("AC-6d.1b an earned hull can be equipped", () => {
    const pilot = pilotWithBeacons(5);
    expect(pilot.unlockedShips, "five beacons did not open ship-3").toContain("ship-3");
    expect(pilot.shipId, "the pilot starts on the shipped hull").toBe("ship-1");
    expect(equipShip(pilot, "ship-3").shipId).toBe("ship-3");
  });

  it("AC-6d.1b equipping refuses a hull this pilot does not hold", () => {
    const pilot = pilotWithBeacons(5);
    // Five beacons is ship-3. Ship-4 needs seven.
    expect(canEquipShip(pilot, "ship-4")).toBe(false);
    expect(equipShip(pilot, "ship-4").shipId).toBe("ship-1");
    // And the SAME object comes back, so a caller cannot tell a refusal apart
    // from "nothing changed" by accident and write a no-op to storage.
    expect(equipShip(pilot, "ship-4")).toBe(pilot);
  });

  it("AC-6d.1b a hull that does not exist at all is refused, not worn", () => {
    // A save from a future catalogue, or a hand-edited one. It must not put an
    // id nothing can draw into `shipId`, because `catalog.shipDef` would then
    // silently fall back to ship-1's colours and the profile would disagree
    // with the screen.
    const pilot = pilotWithBeacons(7);
    expect(equipShip(pilot, "ship-99")).toBe(pilot);
    expect(equipShip(pilot, "")).toBe(pilot);
  });

  it("AC-6d.1b re-equipping the hull already worn writes nothing", () => {
    const pilot = pilotWithBeacons(3);
    expect(equipShip(pilot, "ship-1")).toBe(pilot);
  });

  it("AC-6d.1b every hull the route opens can then be worn", () => {
    // Rule 5: a harness sweeps. Asserting ship-3 alone is exactly the shape of
    // the Mars-only screenshot harness - one case that happens to work.
    for (const [beacons, id] of [[1, "ship-1"], [3, "ship-2"], [5, "ship-3"], [7, "ship-4"]] as const) {
      const pilot = pilotWithBeacons(beacons);
      expect(canEquipShip(pilot, id), `${beacons} beacons did not open ${id}`).toBe(true);
      expect(equipShip(pilot, id).shipId).toBe(id);
    }
    expect(STOP_IDS.length, "seven beacons must be reachable on this route").toBe(7);
  });

  it("AC-19.1 an earned hull is worn, and survives a reload", () => {
    const worn = equipShip(pilotWithBeacons(5), "ship-3");
    const back = reload(worn);
    expect(back?.shipId, "the equipped hull did not survive the reload").toBe("ship-3");
    // The list it was chosen from survives with it. A hull that came back worn
    // but locked would render as a locked tile on the create and settings rows.
    expect(back?.unlockedShips).toContain("ship-3");
  });

  it("AC-19.1 a locked hull is refused, and the refusal survives too", () => {
    const pilot = pilotWithBeacons(5);
    const after = equipShip(pilot, "ship-4");
    const back = reload(after);
    expect(back?.shipId, "a locked hull was equipped").toBe("ship-1");
    expect(back?.unlockedShips).not.toContain("ship-4");
  });

  it("AC-19.1 the load path is what reads it back, not a second decoder", () => {
    // `loadState` is the total loader AC-18.4 is written about, and it is what
    // boot actually runs. Asserting through `createProfileStore` alone would
    // leave open the possibility that the store round-trips a field the real
    // load path repairs away.
    const worn = equipShip(pilotWithBeacons(7), "ship-4");
    const storage = new FakeStorage();
    const store = createProfileStore({ storage, clock: new FakeClock() });
    const created = store.createProfile({ name: "Ren" });
    store.updateProfile(created.id, () => ({ ...worn, id: created.id }));
    store.selectProfile(created.id);
    store.flush();

    const { state, notices } = loadState(
      new FakeStorage({ [STORAGE_KEY]: storage.map.get(STORAGE_KEY) as string }),
      { freshProfile: () => blankProfile({ id: "fresh", createdAt: 0 }) },
    );
    expect(
      notices.filter((n) => n.code === "repaired"),
      "the loader repaired the profile carrying an equipped hull",
    ).toEqual([]);
    // By ACTIVE id, not by index: a store over empty storage already holds the
    // fresh profile AC-18.4 hands back, so `profiles[0]` is that one and the
    // assertion would read a hull nobody equipped. Watched: `profiles[0]`
    // reported 'ship-1' against an expected 'ship-4'.
    const active = state.profiles.find((p) => p.id === state.activeProfileId);
    expect(active?.shipId).toBe("ship-4");
  });
});
