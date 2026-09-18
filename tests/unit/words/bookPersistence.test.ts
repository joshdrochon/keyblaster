import { describe, expect, it } from "vitest";
import {
  EASE_NEW,
  STOP_IDS,
  type Profile,
  type StopId,
  type WordRecord,
} from "@engine/types.js";
import {
  bookOf,
  isEligible,
  withProfileBook,
  type WordBook,
} from "@engine/words/index.js";
import { fallTimeMs } from "@engine/fallTime/index.js";
import {
  calibrationFromHistory,
  isDefaultCalibration,
} from "@engine/calibration/index.js";
import {
  STORAGE_KEY,
  createProfileStore,
  type ProfileStore,
} from "@engine/persistence/index.js";
import { DEFAULT_FLIGHT_CONFIG, retentionPoolFor, stagePoolFor } from "@game/flight/stage.js";
import { FakeClock, FakeStorage } from "../persistence/fixtures.js";
import {
  calibrationOf,
  mulberry32,
  simulateBelt,
  type BeltResult,
  type SimPlayer,
} from "../simulation/flight.js";

/**
 * FR-7 / FR-8 / FR-9 / AC-20.3 — THE WORD BOOK NOW SURVIVES THE SESSION.
 *
 * ================== WHY THIS FILE IS NEW ==================
 * `FlightScene` built a `WordBook` with `@engine/words.applyToBook` on every
 * blast, miss and typo, carried it through the stage, handed it to the warp
 * break - and dropped it. `book: {}` was the shipped default in
 * `src/game/flight/stage.ts`, nothing in `src/` read `profile.words` and
 * nothing wrote it.
 *
 * Every one of these ran, every session, on a book that was empty at launch:
 *
 *   FR-7    per-word memory                 exposures/hits/misses always 0
 *   FR-8    ease-based fall time            every word forever at EASE_NEW
 *   FR-9    selection weighting             a pool the picker knew nothing about
 *   AC-20.3 retention vs FIRST exposure     no first exposure to compare with
 *   D51     calibrationFromHistory          its only input is `profile.words`
 *
 * `tests/unit/words/words.test.ts` covers the arithmetic of one record, and it
 * was green throughout. What it could not see is that the structure the
 * arithmetic runs on was thrown away at the end of every belt.
 *
 * THE RULE FOR THIS FILE, taken from `tests/unit/awards/awards.test.ts`: no
 * test here may hand a profile a word record. Every book is flown by
 * `simulateBelt` - the real picker, the real fall times, the real hull - and
 * every reload goes through the real `ProfileStore` and the real schema, bytes
 * and all.
 * ==========================================================
 */

const PLAYER: SimPlayer = {
  accuracy: 0.9,
  ikiMs: 420,
  fkLatencyMs: 560,
  coldRecognitionMs: 1600,
};

const ROUTE: StopId[] = [...STOP_IDS.slice(1)];
const LANG = "en";

function flyResult(stop: StopId, book: WordBook, seed: number): BeltResult {
  return simulateBelt(
    {
      stopIndex: ROUTE.indexOf(stop) + 1,
      stagePool: stagePoolFor(stop),
      retentionPool: retentionPoolFor(ROUTE.slice(0, ROUTE.indexOf(stop))),
      spawnCount: DEFAULT_FLIGHT_CONFIG.stageWordCount,
      calibration: calibrationOf(PLAYER),
    },
    PLAYER,
    book,
    mulberry32(seed),
  );
}

function flyBelt(stop: StopId, book: WordBook, seed: number): WordBook {
  return flyResult(stop, book, seed).book;
}

/** A store over storage that already exists - i.e. the game opening again. */
function openStore(storage: FakeStorage): ProfileStore {
  return createProfileStore({ storage, clock: new FakeClock() });
}

/**
 * One whole session: open the game, fly a belt from whatever the profile
 * remembers, and (unless this is the control) write the book back the way
 * `FlightScene.checkStageEnd` does - through `withProfileBook`, then `flush`.
 *
 * `persist: false` IS the shipped defect, reproduced exactly: the belt is flown,
 * the book is built, and the write at the end simply does not happen.
 */
function session(
  storage: FakeStorage,
  stop: StopId,
  seed: number,
  { persist = true }: { persist?: boolean } = {},
): { profile: Profile; flown: WordBook } {
  const store = openStore(storage);
  const profile = store.activeProfile() ?? store.createProfile({ name: "Ada" });
  const flown = flyBelt(stop, bookOf(profile.words, LANG), seed);
  if (persist) {
    store.updateProfile(profile.id, (p: Profile) => withProfileBook(p, LANG, flown));
  }
  store.flush();
  return { profile: store.activeProfile() as Profile, flown };
}

/** What the bytes on disk actually say, with no store in the way. */
function storedBookBytes(storage: FakeStorage): Record<string, WordRecord> {
  const raw = storage.getItem(STORAGE_KEY);
  expect(raw, "nothing was written to storage at all").not.toBeNull();
  const state = JSON.parse(raw as string) as {
    profiles: { words: Record<string, Record<string, WordRecord>> }[];
  };
  return state.profiles[0]?.words?.[LANG] ?? {};
}

// ---------------------------------------------------------------------------
// It survives a reload
// ---------------------------------------------------------------------------

describe("FR-7: the word book outlives the session that built it", () => {
  it("THE DEFECT: the belt is flown either way; only one of them is remembered", () => {
    const kept = new FakeStorage();
    const dropped = new FakeStorage();

    const a = session(kept, "mars", 4242);
    // THE NEGATIVE CONTROL, run here rather than described. Identical belt,
    // identical seed, identical book built - and the one line at the end of
    // `checkStageEnd` removed. This is what shipped.
    const b = session(dropped, "mars", 4242, { persist: false });

    expect(Object.keys(a.flown).length, "the belt recorded nothing").toBeGreaterThan(0);
    expect(Object.keys(b.flown)).toEqual(Object.keys(a.flown));

    expect(Object.keys(storedBookBytes(kept)).length).toBe(Object.keys(a.flown).length);
    expect(
      Object.keys(storedBookBytes(dropped)),
      "the control must come back empty, or it is not the defect",
    ).toEqual([]);
  });

  it("FR-7: a reopened game reads back every word, exposure for exposure", () => {
    const storage = new FakeStorage();
    const { flown } = session(storage, "mars", 4242);

    // A SECOND store over the same bytes. Nothing is carried in memory: this
    // is the profile decoded from JSON by the real schema.
    const reopened = openStore(storage).activeProfile() as Profile;
    const back = bookOf(reopened.words, LANG);

    expect(Object.keys(back).sort()).toEqual(Object.keys(flown).sort());
    for (const [word, before] of Object.entries(flown)) {
      const after = back[word] as WordRecord;
      expect(after.exposures, `${word}.exposures`).toBe(before.exposures);
      expect(after.hits, `${word}.hits`).toBe(before.hits);
      expect(after.misses, `${word}.misses`).toBe(before.misses);
      expect(after.ease, `${word}.ease`).toBeCloseTo(before.ease, 10);
      expect(after.nextEligibleStage, `${word}.nextEligibleStage`).toBe(
        before.nextEligibleStage,
      );
      // AC-20.3 measures against the first exposure, and the rolling window
      // cannot answer that question, so this is the field that must not be
      // rebuilt from samples on the way back in.
      expect(after.firstFkLatencyMs, `${word}.firstFkLatencyMs`).toBe(
        before.firstFkLatencyMs,
      );
    }
  });

  it("FR-7: six belts of per-word memory stay well inside a storage quota", () => {
    // The book is the largest thing on a profile and it is the one that grows
    // with play, so the size is asserted rather than assumed.
    const storage = new FakeStorage();
    let book: WordBook = {};
    for (const stop of ROUTE) book = flyBelt(stop, book, 4242);
    const store = openStore(storage);
    const profile = store.createProfile({ name: "Ada" });
    store.updateProfile(profile.id, (p: Profile) => withProfileBook(p, LANG, book));
    store.flush();

    const bytes = (storage.getItem(STORAGE_KEY) as string).length;
    expect(Object.keys(book).length).toBeGreaterThan(50);
    // A 5 MB localStorage budget with room for several pilots.
    expect(bytes).toBeLessThan(250_000);
  });
});

// ---------------------------------------------------------------------------
// A word met in an earlier session changes a later one
// ---------------------------------------------------------------------------

describe("FR-8 / FR-9 / D51: what was learned last time changes this time", () => {
  it("FR-8: a word met last session falls at its OWN speed, not at the newcomer's", () => {
    const storage = new FakeStorage();
    session(storage, "mars", 4242);
    const reopened = openStore(storage).activeProfile() as Profile;
    const book = bookOf(reopened.words, LANG);

    const moved = Object.entries(book).filter(([, r]) => r.ease !== EASE_NEW);
    expect(moved.length, "no word's ease moved at all").toBeGreaterThan(0);

    for (const [word, record] of moved) {
      const remembered = fallTimeMs({ word, ease: record.ease });
      const cold = fallTimeMs({ word, ease: EASE_NEW });
      // Not "different by chance": FR-8's recognition budget is 1200 * ease, so
      // a moved ease is a different deadline for that exact word, next session.
      expect(remembered, `${word} fell at the newcomer's speed`).not.toBe(cold);
    }
  });

  it("AC-9.3 / D23: the schedule a stop wrote is still binding at the next stop", () => {
    const storage = new FakeStorage();
    // TWO SESSIONS AT MARS, and the second one is the point of the file: it
    // opens the store, reads the book the first one wrote, and flies on top of
    // it. A word is scheduled past the next stop once its ease drops below
    // 1.2 (`intervalStages`), which takes four hits, and 58 spawns over a
    // 40-word pool give a given word four exposures only sometimes.
    //
    // IT USED TO BE ONE SESSION AND A LUCKY SEED, and that is what this change
    // replaces. Measured across ten seeds after UR-83 shifted the seeded
    // stream, ONE belt reaches four hits on 4 seeds of 10 (seed 4242, the one
    // this file has always used, now peaks at three) - so the old shape was a
    // coin flip that happened to be landing the right way up. Two sessions
    // reach it on every seed, and two sessions is also the more honest model of
    // the claim: it is about a book that outlives a session.
    session(storage, "mars", 4242);
    session(storage, "mars", 4242);
    const book = bookOf((openStore(storage).activeProfile() as Profile).words, LANG);

    // Mars is stage 1. A word answered well there writes `nextEligibleStage`
    // ahead of stage 2, and the whole point of persisting the book is that
    // Jupiter is still bound by it.
    const scheduled = Object.entries(book).filter(([, r]) => r.nextEligibleStage > 2);
    expect(scheduled.length, "nothing was scheduled forward at all").toBeGreaterThan(0);
    for (const [, record] of scheduled) {
      expect(isEligible(record, 1, 2)).toBe(false);
    }
    // And with the book dropped, as it shipped, every one of them is a word the
    // picker has never heard of and will serve again immediately.
    for (const [word] of scheduled) {
      expect(isEligible(({} as WordBook)[word], undefined, 2)).toBe(true);
    }
  });

  it("D51: a returning pilot's baseline can be rebuilt from the book, which is its only input", () => {
    const kept = new FakeStorage();
    const dropped = new FakeStorage();
    session(kept, "mars", 4242);
    session(dropped, "mars", 4242, { persist: false });

    const withBook = openStore(kept).activeProfile() as Profile;
    const without = openStore(dropped).activeProfile() as Profile;

    // `storedCalibration` uses this for a profile that never ran the ritual.
    // Until the book persisted it could only ever hand back FR-8's default,
    // whoever was holding the keyboard.
    expect(isDefaultCalibration(calibrationFromHistory(without))).toBe(true);
    expect(isDefaultCalibration(calibrationFromHistory(withBook))).toBe(false);
  });

  it("FR-9: the second session's belt is not the first session's belt", () => {
    // The end-to-end claim. Same stop, same seed, same child - one flown by a
    // pilot who has been here before and one by a pilot the game has never met.
    // If the book made no difference the picker would serve the same rocks.
    const storage = new FakeStorage();
    session(storage, "mars", 4242);
    const remembered = bookOf((openStore(storage).activeProfile() as Profile).words, LANG);

    const returning = flyResult("jupiter", remembered, 99);
    const stranger = flyResult("jupiter", {}, 99);

    // The rocks themselves. The picker weights by mastery (FR-9) and fall time
    // is `1200 * ease` on top of the motor budget (FR-8), so a belt flown with
    // memory is a different belt: different words, in a different order, on
    // different deadlines.
    const order = (r: BeltResult): string => r.spawns.map((s) => s.word).join(" ");
    expect(order(returning), "the returning pilot got the stranger's belt").not.toEqual(
      order(stranger),
    );

    const deadlines = (r: BeltResult): Map<string, number> =>
      new Map(r.spawns.map((s) => [s.word, s.fallMs]));
    const back = deadlines(returning);
    const cold = deadlines(stranger);
    const regraded = [...back.entries()].filter(
      ([word, ms]) => cold.has(word) && cold.get(word) !== ms,
    );
    expect(
      regraded.length,
      "every shared word fell on exactly the same deadline, so the book changed nothing",
    ).toBeGreaterThan(0);

    // And the history continues rather than starting over: a word met at Mars
    // is on its second, third or fourth exposure at Jupiter, not its first.
    const carried = Object.keys(remembered).filter((w) => w in returning.book);
    expect(carried.length).toBeGreaterThan(0);
    const continued = carried.filter(
      (w) =>
        (returning.book[w] as WordRecord).exposures >
        (remembered[w] as WordRecord).exposures,
    );
    expect(continued.length, "no word's history continued into the next stop").toBeGreaterThan(0);
    for (const w of continued) {
      expect((returning.book[w] as WordRecord).exposures).toBeGreaterThan(
        (stranger.book[w] as WordRecord | undefined)?.exposures ?? 0,
      );
    }
  });
});
