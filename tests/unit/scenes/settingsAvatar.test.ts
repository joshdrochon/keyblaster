import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProfileStore } from "@engine/persistence/index.js";
import type { ProfileStore } from "@engine/persistence/index.js";
import { FakeClock, FakeStorage } from "../persistence/fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../../src");

/**
 * UR-124: A PILOT CAN CHANGE THEIR MARK, AND IT IS STILL THEIRS TOMORROW.
 *
 * ================== THE DEFECT ==================
 * `profile.avatar` had exactly ONE writer in the whole build -
 * `ProfileCreateScene`, at the moment the profile is made - and one reader,
 * `ProfilePickerScene:224`, which draws it on the pilot's card. So a child
 * picked their mark on the first screen they ever saw, before they had played
 * anything, and was that mark for the life of the save with nowhere in the
 * product to change it.
 *
 * That is `equip.test.ts`'s defect one field over, and its header names the
 * rule: "every persisted field needs a live READER, not just a writer" - here
 * the reader was fine and the second WRITER was missing.
 *
 * ================== WHY THE ROUND TRIP AND NOT THE WRITE ==================
 * Asserting `app.setAvatar("avatar-3")` returns `"avatar-3"` proves the spread
 * works, which was never in doubt. What a child experiences is the mark being
 * theirs when they open the game tomorrow, and everything between the press and
 * tomorrow is store, debounce, encode, JSON, decode. `uppercase` in this
 * codebase persisted PERFECTLY and did nothing; the mirror image - a value that
 * changes in memory and does not survive the tab - is the same defect class.
 *
 * So the chain runs end to end: row -> `App.setAvatar` -> store -> serialize ->
 * SECOND store over the same bytes -> read back, which is what a reload is.
 *
 * ================== WATCH IT FAIL (rule 4) ==================
 * Every string below was read off a red run, not predicted.
 *
 *   `App.setAvatar`'s body replaced with `return null;` - the state the game
 *   shipped in, where nothing could change a mark. Four cases red:
 *
 *     AC-19.1 a chosen mark reaches the profile
 *       expected null to be 'avatar-4'
 *     AC-19.1 a chosen mark survives a reload
 *       the mark did not survive the reload: expected 'avatar-1' to be
 *       'avatar-4'
 *     every mark the catalogue offers can actually be worn, not just the first
 *       avatar-2 did not persist: expected 'avatar-1' to be 'avatar-2'
 *     choosing the mark you already wear writes nothing
 *       expected null to be 'avatar-1'
 *
 *   `store.flush()` dropped from `App.setAvatar` does NOT show up here - this
 *   file flushes for itself where it has to. The debounce seam is the e2e's.
 */

vi.mock("phaser", () => ({
  default: {
    GameObjects: {},
    Tweens: {},
    Scene: class {},
    Math: { DegToRad: (deg: number) => (deg * globalThis.Math.PI) / 180 },
    Scenes: { Events: { SHUTDOWN: "shutdown" } },
  },
}));

let store: ProfileStore;
let storage: FakeStorage;
let clock: FakeClock;

/**
 * `services()` reads the bundle off the scene registry, which needs a booted
 * game. Mocked to hand back a bundle built on a REAL `createProfileStore` over
 * a fake storage - so the store, the encoder and the decoder under test are the
 * shipped ones and only the Phaser plumbing is stubbed.
 */
vi.mock("@game/boot", () => ({
  services: () => ({
    store,
    t: { lang: "en" },
    setLang: () => {},
    context: { reducedMotion: false, colorblindPalette: false },
  }),
}));

function freshStore(): void {
  storage = new FakeStorage();
  clock = new FakeClock();
  store = createProfileStore({ storage, clock });
  const created = store.createProfile({ name: "Ren" });
  store.selectProfile(created.id);
  store.flush();
}

beforeEach(() => {
  vi.resetModules();
  freshStore();
});

/** Read the bytes the store wrote back through a SECOND store. That is a reload. */
function reloadedAvatar(): string | null {
  const second = createProfileStore({ storage, clock: new FakeClock() });
  return second.activeProfile()?.avatar ?? null;
}

describe("UR-124 the avatar has a second writer, and it is on Ship Controls", () => {
  it("AC-19.1 a chosen mark reaches the profile", async () => {
    const { appFor, resetApp } = await import("@game/ui/app");
    resetApp();
    const app = appFor({} as never);

    expect(app.profile()?.avatar).toBe("avatar-1");
    expect(app.setAvatar("avatar-4")).toBe("avatar-4");
    expect(app.profile()?.avatar).toBe("avatar-4");
  });

  it("AC-19.1 a chosen mark survives a reload", async () => {
    const { appFor, resetApp } = await import("@game/ui/app");
    resetApp();
    const app = appFor({} as never);

    app.setAvatar("avatar-4");
    expect(reloadedAvatar(), "the mark did not survive the reload").toBe("avatar-4");
  });

  it("every mark the catalogue offers can actually be worn, not just the first", async () => {
    // One value passing is how `shipId` looked correct for a whole build.
    const { appFor, resetApp } = await import("@game/ui/app");
    const { AVATARS } = await import("@game/ui/catalog");
    resetApp();
    const app = appFor({} as never);

    for (const avatar of AVATARS) {
      app.setAvatar(avatar.id);
      expect(reloadedAvatar(), `${avatar.id} did not persist`).toBe(avatar.id);
    }
  });

  it("choosing the mark you already wear writes nothing", async () => {
    // Guarded on identity, the way `repairLanguagePair` is. A row that wrote on
    // every build would schedule a store write every time the screen opened.
    const { appFor, resetApp } = await import("@game/ui/app");
    resetApp();
    const app = appFor({} as never);

    const before = storage.getItem("kb:v1:profiles");
    expect(app.setAvatar("avatar-1")).toBe("avatar-1");
    expect(storage.getItem("kb:v1:profiles")).toBe(before);
  });

  it("no profile is a supported answer, not a crash", async () => {
    // A standalone harness mount of a screen, and any moment between profiles.
    //
    // The store is stubbed for THIS case only, and deliberately: a fresh
    // `createProfileStore` over empty storage does NOT leave you profileless -
    // AC-18.4 makes it mint a blank pilot - so the honest way to exercise the
    // guard is to hand `App` a store that answers null, which is the state the
    // guard is written for. (This was found by the test failing with
    // `expected 'avatar-2' to be null`: the first version of it asserted the
    // guard by way of a premise that is not true of this store.)
    const { appFor, resetApp } = await import("@game/ui/app");
    resetApp();
    const real = store;
    store = { ...real, activeProfile: () => null } as ProfileStore;
    const app = appFor({} as never);
    expect(app.setAvatar("avatar-2")).toBeNull();
    expect(app.profile()).toBeNull();
    store = real;
  });

  it("NEGATIVE CONTROL: the store really can report a mark that did not stick", () => {
    // Without this, "it persisted" could mean the reload is reading the same
    // in-memory object rather than the bytes.
    expect(reloadedAvatar()).toBe("avatar-1");
    store.updateProfile(store.activeProfile()?.id ?? "", (p) => ({ ...p, avatar: "avatar-6" }));
    // No flush: the write is still debounced, so the bytes have not moved.
    expect(reloadedAvatar()).toBe("avatar-1");
    store.flush();
    expect(reloadedAvatar()).toBe("avatar-6");
  });
});

describe("UR-124 the row is wired to that writer, and draws the mark", () => {
  const scene = readFileSync(path.join(SRC, "game/scenes/SettingsScene.ts"), "utf8");

  it("the row calls the writer rather than holding a local field", () => {
    expect(scene).toMatch(/this\.app\.setAvatar\(v\)/);
    expect(scene).toMatch(/"settings\.avatar"/);
  });

  it("it offers the SAME set the create screen does, not a second list", () => {
    // Two lists is how a child picks a mark on one screen that the other cannot
    // show. `AVATARS` is the catalogue both read.
    expect(scene).toMatch(/AVATARS\.map\(/);
    const create = readFileSync(path.join(SRC, "game/scenes/ProfileCreateScene.ts"), "utf8");
    expect(create).toMatch(/AVATARS\.forEach\(/);
  });

  it("it DRAWS the mark with the same pen the picker uses", () => {
    // `chrome.drawAvatar` - so the six marks read identically on the screen
    // that chooses them and the screen that shows them.
    expect(scene).toMatch(/drawAvatar\(scene, gx, gy, AVATAR_GLYPH, id/);
    const picker = readFileSync(path.join(SRC, "game/scenes/ProfilePickerScene.ts"), "utf8");
    expect(picker).toMatch(/drawAvatar\(scene, gx, gy, 84, profile\.avatar/);
  });

  it("the screen reports the mark actually WORN, read back off the profile", () => {
    // A snapshot echoing the row's own argument would say "avatar-4" for a
    // write that never reached the store - the same reason `shipId` is read
    // back rather than echoed.
    expect(scene).toMatch(/avatar: this\.app\.profile\(\)\?\.avatar \?\? null/);
  });
});
