import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARK_GRACE_MS,
  LAYOUT_MAPS,
  type AdvancedEmit,
  type BlastEmit,
  type IgnoredEmit,
  type KeyInput,
  type LiveAsteroid,
  type LockEmit,
  type LockEvent,
  type LockState,
  type LockedEmit,
  type ParkedEmit,
  type TypoEmit,
  createLockState,
  phaseOf,
  reduce,
  reduceAll,
} from "@engine/lock/index.js";
import {
  EXACT_MATCHER,
  TRANSLIT_MATCHER,
  createWordMatcher,
} from "@engine/i18n/index.js";
import type { KeyboardLayout } from "@engine/types.js";

// ---------------------------------------------------------------------------
// Fixtures. Every event carries an explicit nowMs: the engine never reads a
// clock (CLAUDE.md), so every timing assertion below is exact, not tolerant.
// ---------------------------------------------------------------------------

const LAYOUTS: readonly KeyboardLayout[] = ["qwerty", "azerty", "qwertz", "dvorak"];

/** char → physical code, per layout, so tests can spell words as keystrokes. */
const CODE_FOR_CHAR: Readonly<Record<KeyboardLayout, ReadonlyMap<string, string>>> = {
  qwerty: new Map([...LAYOUT_MAPS.qwerty].map(([code, ch]) => [ch, code])),
  azerty: new Map([...LAYOUT_MAPS.azerty].map(([code, ch]) => [ch, code])),
  qwertz: new Map([...LAYOUT_MAPS.qwertz].map(([code, ch]) => [ch, code])),
  dvorak: new Map([...LAYOUT_MAPS.dvorak].map(([code, ch]) => [ch, code])),
};

function key(
  ch: string,
  mods: Partial<KeyInput> = {},
  layout: KeyboardLayout = "qwerty",
): KeyInput {
  return {
    key: ch,
    code: CODE_FOR_CHAR[layout].get(ch) ?? "Unidentified",
    ctrl: false,
    alt: false,
    meta: false,
    ...mods,
  };
}

function rock(
  id: string,
  word: string,
  spawnedAtMs = 0,
  typedAs?: string,
): LiveAsteroid {
  return typedAs === undefined
    ? { id, word, spawnedAtMs }
    : { id, word, typedAs, spawnedAtMs };
}

function spawn(asteroid: LiveAsteroid): LockEvent {
  return { type: "spawn", asteroid };
}

function press(
  ch: string,
  nowMs: number,
  layout: KeyboardLayout = "qwerty",
): LockEvent {
  return { type: "key", input: key(ch, {}, layout), nowMs };
}

/** Type a string, one key per step, starting at `startMs`. */
function typeWord(text: string, startMs: number, stepMs = 100): LockEvent[] {
  return [...text].map((ch, i) => press(ch, startMs + i * stepMs));
}

function run(
  events: readonly LockEvent[],
  initial: LockState = createLockState(),
): { state: LockState; emitted: readonly LockEmit[] } {
  const result = reduceAll(initial, events);
  return { state: result.state, emitted: result.emitted };
}

function only<T extends LockEmit["type"]>(
  emitted: readonly LockEmit[],
  type: T,
): Extract<LockEmit, { type: T }>[] {
  return emitted.filter((e): e is Extract<LockEmit, { type: T }> =>
    e.type === type,
  );
}

/** Fixed-seed PRNG for the simulations (lane brief: no Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

// ---------------------------------------------------------------------------

describe("FR-3 / AC-3.1: auto-lock on the first keystroke", () => {
  it("AC-3.1: the first keystroke matching a live word's first letter locks it", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red", 0)),
      press("r", 500),
    ]);
    expect(emitted.map((e) => e.type)).toEqual(["locked", "advanced"]);
    expect((emitted[0] as LockedEmit).asteroidId).toBe("a1");
    expect(state.lockedId).toBe("a1");
    expect(state.typed).toBe("r");
    expect(phaseOf(state)).toBe("locked");
  });

  it("AC-3.1: the lock picks the matching asteroid, not the first one on screen", () => {
    const { state } = run([
      spawn(rock("a1", "dust")),
      spawn(rock("a2", "rust")),
      press("r", 100),
    ]);
    expect(state.lockedId).toBe("a2");
  });

  it("D24: no Enter — the word fires as soon as its last letter lands", () => {
    const { emitted } = run([spawn(rock("a1", "red")), ...typeWord("red", 300)]);
    expect(only(emitted, "blast")).toHaveLength(1);
  });

  it("D24: Enter itself is not typing and changes nothing", () => {
    const start = reduce(createLockState(), spawn(rock("a1", "red")));
    const after = reduce(start, { type: "key", input: key("Enter"), nowMs: 10 });
    expect(after.emitted).toEqual([]);
    expect(phaseOf(after)).toBe("idle");
  });

  it("D31 / AC-6e.2: an idle keystroke matching nothing reports but never counts", () => {
    // There is nothing on screen to be wrong against, so it must not shake,
    // count a typo, or (via scoring/) break the combo — but AC-6e.2 still
    // wants a visible response to the keystroke.
    const { state, emitted } = run([spawn(rock("a1", "red")), press("z", 40)]);
    expect(emitted).toEqual([
      {
        type: "ignored",
        asteroidId: null,
        word: null,
        typed: "",
        actual: "z",
        ignoredTargetIds: [],
        shake: false,
        nowMs: 40,
      },
    ]);
    expect(state.typos).toBe(0);
    expect(phaseOf(state)).toBe("idle");
  });
});

describe("AC-3.2: a wrong keystroke never drops the lock", () => {
  it("AC-3.2: a wrong keystroke shakes, counts a typo, and keeps the lock", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      press("r", 100),
      press("q", 200),
    ]);
    const typos = only(emitted, "typo");
    expect(typos).toHaveLength(1);
    expect(typos[0] as TypoEmit).toMatchObject({
      asteroidId: "a1",
      word: "red",
      typed: "r",
      actual: "q",
      expected: ["e"],
      typos: 1,
      shake: true,
    });
    expect(state.lockedId).toBe("a1");
    expect(state.typed).toBe("r");
    expect(phaseOf(state)).toBe("locked");
  });

  it("AC-3.2: repeated typos accumulate and the word still blasts", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      press("r", 100),
      press("q", 200),
      press("w", 300),
      press("e", 400),
      press("z", 500),
      press("d", 600),
    ]);
    expect((only(emitted, "blast")[0] as BlastEmit).typos).toBe(3);
    expect(phaseOf(state)).toBe("idle");
  });

  it("AC-3.2 / D31: the emission vocabulary has no failure event", () => {
    const { emitted } = run([
      spawn(rock("a1", "red")),
      spawn(rock("a2", "blue")),
      ...typeWord("rxexd", 100),
    ]);
    const allowed = ["locked", "advanced", "parked", "typo", "ignored", "blast"];
    expect(emitted.every((e) => allowed.includes(e.type))).toBe(true);
  });
});

describe("AC-3.3: no switching targets (collision C10)", () => {
  it("AC-3.3: a keystroke matching another live asteroid is ignored, not charged", () => {
    // Literal AC-3.3: it shakes (AC-6e.2) but must not reach scoring/'s combo
    // reset or words/' ease bump, or brushing a rival's key would punish the
    // player for a word they are not typing (D31).
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      spawn(rock("a2", "blue")),
      press("r", 100),
      press("b", 200),
    ]);
    expect(only(emitted, "typo")).toHaveLength(0);
    const ignored = only(emitted, "ignored");
    expect(ignored).toHaveLength(1);
    expect(ignored[0] as IgnoredEmit).toMatchObject({
      asteroidId: "a1",
      word: "red",
      typed: "r",
      actual: "b",
      ignoredTargetIds: ["a2"],
      shake: true,
    });
    expect(state.typos).toBe(0);
    expect(state.lockedId).toBe("a1");
    expect(state.candidateIds).toEqual(["a1"]);
  });

  it("AC-3.3: the original target still completes, the other is untouched", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      spawn(rock("a2", "blue")),
      press("r", 100),
      press("b", 200),
      press("e", 300),
      press("d", 400),
    ]);
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast.asteroidId).toBe("a1");
    expect(blast.typos).toBe(0);
    expect(state.live.map((a) => a.id)).toEqual(["a2"]);
  });

  it("AC-3.3: an asteroid spawned mid-word cannot join the candidate set", () => {
    const { state } = run([
      spawn(rock("a1", "cat")),
      press("c", 100),
      spawn(rock("a2", "cap", 150)),
      press("a", 200),
    ]);
    expect(state.candidateIds).toEqual(["a1"]);
    expect(state.lockedId).toBe("a1");
  });
});

describe("AC-3.4: completing the word fires the blast", () => {
  it("AC-3.4: blast carries the word, typos and the timing samples", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red", 200)),
      ...typeWord("red", 700, 120),
    ]);
    expect(only(emitted, "blast")[0] as BlastEmit).toMatchObject({
      asteroidId: "a1",
      word: "red",
      typos: 0,
      fkLatencyMs: 500,
      ikiMs: [120, 120],
      typingMs: 240,
      nowMs: 940,
    });
    // AC-3.4 "marks asteroid dead": it leaves the live set. hits and combo are
    // scoring/'s to increment from this emission.
    expect(state.live).toEqual([]);
    expect(phaseOf(state)).toBe("idle");
  });

  it("AC-3.4: a one-letter word emits locked, advanced and blast in order", () => {
    const { emitted } = run([spawn(rock("a1", "a", 0)), press("a", 300)]);
    expect(emitted.map((e) => e.type)).toEqual(["locked", "advanced", "blast"]);
    // Nothing may divide by typingMs: a single keystroke has no duration.
    expect((only(emitted, "blast")[0] as BlastEmit).typingMs).toBe(0);
  });

  it("AC-3.4: two live asteroids carrying the same word blast one at a time", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "sun", 0)),
      spawn(rock("a2", "sun", 50)),
      ...typeWord("sun", 400),
    ]);
    const blasts = only(emitted, "blast");
    expect(blasts).toHaveLength(1);
    expect((blasts[0] as BlastEmit).asteroidId).toBe("a1");
    // The lock ring is still announced before the blast, even though the
    // candidate set never collapsed to one.
    expect(emitted.map((e) => e.type)).toContain("locked");
    expect(state.live.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("AC-2.2 / D25: shared-prefix tier", () => {
  const flowField: readonly LockEvent[] = [
    spawn(rock("a1", "flow", 0)),
    spawn(rock("a2", "flower", 0)),
  ];

  it("AC-2.2: 'flow'/'flower' both live — f,l,o,w leaves both candidates", () => {
    const { state, emitted } = run([...flowField, ...typeWord("flow", 100)]);
    expect(state.candidateIds).toEqual(["a1", "a2"]);
    expect(state.lockedId).toBeNull();
    expect(only(emitted, "locked")).toHaveLength(0);
    expect(only(emitted, "blast")).toHaveLength(0);
    expect(phaseOf(state)).toBe("parked");
  });

  it("AC-2.2: the parked word is emitted so the scene can render it", () => {
    // A state-only park is invisible: the player would have no way to tell
    // "your word landed and is about to fire" from "still ambiguous".
    const { emitted } = run([...flowField, ...typeWord("flow", 100)]);
    const parked = only(emitted, "parked");
    expect(parked).toHaveLength(1);
    expect(parked[0] as ParkedEmit).toMatchObject({
      asteroidId: "a1",
      word: "flow",
      typed: "flow",
      rivalIds: ["a2"],
      nowMs: 400,
      firesAtMs: 400 + DEFAULT_PARK_GRACE_MS,
    });
  });

  it("AC-2.2: typing 'e' locks 'flower'", () => {
    const { state, emitted } = run([...flowField, ...typeWord("flowe", 100)]);
    const locked = only(emitted, "locked");
    expect(locked).toHaveLength(1);
    expect(locked[0] as LockedEmit).toMatchObject({
      asteroidId: "a2",
      word: "flower",
      typed: "flowe",
    });
    expect(state.pendingExactId).toBeNull();
    expect(state.lockedId).toBe("a2");
    expect(phaseOf(state)).toBe("locked");
  });

  it("AC-2.2: 'flower' then completes and 'flow' is still falling", () => {
    const { state, emitted } = run([...flowField, ...typeWord("flower", 100)]);
    expect((only(emitted, "blast")[0] as BlastEmit).asteroidId).toBe("a2");
    expect(state.live.map((a) => a.id)).toEqual(["a1"]);
  });

  it("AC-2.2: the parked word fires on a tick once the grace window passes", () => {
    const before = run([...flowField, ...typeWord("flow", 100)]);
    const early = reduce(before.state, { type: "tick", nowMs: 400 + 100 });
    expect(early.emitted).toEqual([]);
    expect(phaseOf(early)).toBe("parked");

    const late = reduce(early, { type: "tick", nowMs: 400 + DEFAULT_PARK_GRACE_MS });
    expect(late.emitted.map((e) => e.type)).toEqual(["locked", "blast"]);
    expect((only(late.emitted, "blast")[0] as BlastEmit)).toMatchObject({
      asteroidId: "a1",
      word: "flow",
      typos: 0,
      // The wait is excluded: this measures typing, not hesitation.
      typingMs: 300,
    });
    expect(phaseOf(late)).toBe("idle");
    expect(late.live.map((a) => a.id)).toEqual(["a2"]);
  });

  it("AC-2.2: a tick with nothing parked does nothing", () => {
    const { state, emitted } = run([
      ...flowField,
      { type: "tick", nowMs: 5_000 },
      ...typeWord("fl", 100),
      { type: "tick", nowMs: 9_000 },
    ]);
    expect(only(emitted, "blast")).toHaveLength(0);
    expect(state.typed).toBe("fl");
  });

  it("AC-3.2: a wrong key while parked is a TYPO — it does not fire the park", () => {
    // The player is typing "flower" and fat-fingers. Reading that keystroke as
    // consent would destroy "flow", a word they never asked for, and leave
    // their real target untouched on screen.
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flow", 100),
      press("z", 600),
    ]);
    expect(only(emitted, "blast")).toHaveLength(0);
    const typo = only(emitted, "typo");
    expect(typo).toHaveLength(1);
    expect(typo[0] as TypoEmit).toMatchObject({
      typed: "flow",
      actual: "z",
      expected: ["e"],
      typos: 1,
      shake: true,
    });
    // AC-3.2's three promises: shake, count, and the attempt survives.
    expect(state.typed).toBe("flow");
    expect(state.pendingExactId).toBe("a1");
    expect(state.live.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(phaseOf(state)).toBe("parked");
  });

  it("AC-3.2: after the typo the player still finishes 'flower'", () => {
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flow", 100),
      press("z", 600),
      press("e", 700),
      press("r", 800),
    ]);
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast).toMatchObject({ asteroidId: "a2", word: "flower", typos: 1 });
    expect(state.live.map((a) => a.id)).toEqual(["a1"]);
  });

  it("AC-3.2: a typo while parked restarts the grace window", () => {
    // Evidence the player is still at the keyboard, so the parked word must
    // not fire out from under them on the very next frame.
    const typed = run([...flowField, ...typeWord("flow", 100), press("z", 600)]);
    const early = reduce(typed.state, {
      type: "tick",
      nowMs: 400 + DEFAULT_PARK_GRACE_MS,
    });
    expect(early.emitted).toEqual([]);
    const late = reduce(early, { type: "tick", nowMs: 600 + DEFAULT_PARK_GRACE_MS });
    expect(only(late.emitted, "blast")).toHaveLength(1);
  });

  it("AC-3.3: a rival's key while parked switches nothing and fires nothing", () => {
    const { state, emitted } = run([
      ...flowField,
      spawn(rock("a3", "water", 0)),
      ...typeWord("flow", 100),
      press("w", 600),
    ]);
    expect(only(emitted, "blast")).toHaveLength(0);
    expect(only(emitted, "typo")).toHaveLength(0);
    expect((only(emitted, "ignored")[0] as IgnoredEmit).ignoredTargetIds)
      .toEqual(["a3"]);
    expect(state.typed).toBe("flow");
    expect(state.pendingExactId).toBe("a1");
    expect(state.live.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("AC-2.2: losing the longer rival fires the parked match with no keystroke", () => {
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flow", 100),
      { type: "despawn", id: "a2", nowMs: 900 },
    ]);
    expect(only(emitted, "blast")[0] as BlastEmit).toMatchObject({
      asteroidId: "a1",
      nowMs: 900,
    });
    expect(state.live).toEqual([]);
  });

  it("AC-2.2: losing the parked match hands the lock to the longer word", () => {
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flow", 100),
      { type: "despawn", id: "a1", nowMs: 500 },
      ...typeWord("er", 600),
    ]);
    expect(state.pendingExactId).toBeNull();
    expect((only(emitted, "locked")[0] as LockedEmit).asteroidId).toBe("a2");
    expect((only(emitted, "blast")[0] as BlastEmit).word).toBe("flower");
  });

  it("AC-2.2: a third candidate leaving does not restart the park animation", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "flow", 0)),
      spawn(rock("a2", "flower", 0)),
      spawn(rock("a3", "flowing", 0)),
      ...typeWord("flow", 100),
      { type: "despawn", id: "a3", nowMs: 500 },
    ]);
    expect(only(emitted, "parked")).toHaveLength(1);
    expect(state.parkedAtMs).toBe(400);
  });

  it("D25: losing a rival resolves the lock mid-word", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "cat")),
      spawn(rock("a2", "car")),
      press("c", 100),
      press("a", 200),
      { type: "despawn", id: "a2", nowMs: 250 },
    ]);
    expect((only(emitted, "locked")[0] as LockedEmit).asteroidId).toBe("a1");
    expect(state.lockedId).toBe("a1");
    expect(state.typed).toBe("ca");
  });

  it("D25: three candidates narrow to one and blast on the same keystroke", () => {
    const { emitted } = run([
      spawn(rock("a1", "cat")),
      spawn(rock("a2", "car")),
      spawn(rock("a3", "cap")),
      ...typeWord("cat", 100),
    ]);
    expect(emitted.map((e) => e.type)).toEqual([
      "advanced", "advanced", "locked", "advanced", "blast",
    ]);
  });

  it("AC-3.2: a typo while still narrowing keeps every candidate", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "cat")),
      spawn(rock("a2", "car")),
      spawn(rock("a3", "cap")),
      ...typeWord("ca", 100),
      press("z", 300),
    ]);
    const typo = only(emitted, "typo")[0] as TypoEmit;
    expect(typo.asteroidId).toBeNull();
    expect(typo.word).toBeNull();
    expect(typo.expected).toEqual(["t", "r", "p"]);
    expect(state.candidateIds).toEqual(["a1", "a2", "a3"]);
    expect(phaseOf(state)).toBe("narrowing");
  });
});

describe("AC-3.5 / D46: composition and modifier handling", () => {
  it("AC-3.5: a ctrl combo never reaches the state machine", () => {
    const base = reduce(createLockState(), spawn(rock("a1", "red")));
    const after = reduce(base, {
      type: "key",
      input: key("r", { ctrl: true }),
      nowMs: 100,
    });
    expect(after.emitted).toEqual([]);
    expect(phaseOf(after)).toBe("idle");
  });

  it("AC-3.5: a modifier combo mid-word does not count as a typo", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      press("r", 100),
      { type: "key", input: key("s", { meta: true }), nowMs: 200 },
      { type: "key", input: key("e", { alt: true }), nowMs: 300 },
    ]);
    expect(only(emitted, "typo")).toHaveLength(0);
    expect(state.typos).toBe(0);
    expect(state.typed).toBe("r");
  });

  it("AC-3.5 / D46: a committed composition of several chars still auto-locks", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "घर", 100)),
      { type: "composition", text: "घर", nowMs: 700 },
    ]);
    expect(emitted.map((e) => e.type)).toEqual([
      "locked", "advanced", "advanced", "blast",
    ]);
    expect(only(emitted, "blast")[0] as BlastEmit).toMatchObject({
      word: "घर",
      fkLatencyMs: 600,
      ikiMs: [],
      typingMs: 0,
    });
    expect(state.live).toEqual([]);
  });

  it("D46: a composition that mismatches mid-string counts one typo and holds", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "घर", 0)),
      { type: "composition", text: "घट", nowMs: 500 },
    ]);
    expect(only(emitted, "typo")).toHaveLength(1);
    expect(state.lockedId).toBe("a1");
    expect(state.typed).toBe("घ");
  });

  it("D46: composed and decomposed Devanagari commits match the same word", () => {
    const { emitted } = run([
      spawn(rock("a1", "क़र", 0)),
      { type: "composition", text: "क़र", nowMs: 500 },
    ]);
    expect(only(emitted, "blast")).toHaveLength(1);
  });

  it("D46: transliterated Hindi is typed in Latin and blasts the Devanagari word", () => {
    const { emitted } = run([
      spawn(rock("a1", "घर", 0, "ghar")),
      ...typeWord("ghar", 400),
    ]);
    expect((only(emitted, "blast")[0] as BlastEmit).word).toBe("घर");
  });
});

describe("AC-19.2: the layout map is applied before matching", () => {
  it("AC-19.2: AZERTY physical keys type the AZERTY characters", () => {
    // "art" on AZERTY is the physical keys KeyQ, KeyR, KeyT.
    const events: LockEvent[] = [
      spawn(rock("a1", "art", 0)),
      ...["a", "r", "t"].map((ch, i) => press(ch, 100 + i * 100, "azerty")),
    ];
    const azerty = run(events, createLockState({ layout: "azerty" }));
    expect(only(azerty.emitted, "blast")).toHaveLength(1);

    // The same physical keys on QWERTY spell "qrt" and never lock.
    const qwerty = run(events, createLockState({ layout: "qwerty" }));
    expect(only(qwerty.emitted, "locked")).toHaveLength(0);
  });

  it("AC-19.2: 'maman' types correctly on AZERTY (Semicolon → m)", () => {
    const { emitted } = run(
      [
        spawn(rock("a1", "maman", 0)),
        ...[..."maman"].map((ch, i) => press(ch, 100 + i * 100, "azerty")),
      ],
      createLockState({ layout: "azerty" }),
    );
    expect((only(emitted, "blast")[0] as BlastEmit).word).toBe("maman");
  });

  it("AC-19.2: Dvorak physical keys type the Dvorak characters", () => {
    const { emitted } = run(
      [
        spawn(rock("a1", "the", 0)),
        ...[..."the"].map((ch, i) => press(ch, 100 + i * 100, "dvorak")),
      ],
      createLockState({ layout: "dvorak" }),
    );
    expect(only(emitted, "blast")).toHaveLength(1);
  });

  it("AC-19.1: changing the layout mid-stage takes effect without a reload", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "zoo", 0)),
      { type: "layout", layout: "qwertz" },
      // On QWERTZ the physical KeyY types "z".
      press("z", 100, "qwertz"),
    ]);
    expect(state.layout).toBe("qwertz");
    expect(only(emitted, "locked")).toHaveLength(1);
  });
});

describe("timing samples for words/ and calibration/", () => {
  it("FR-7: first-key latency is measured from spawn to the first keystroke", () => {
    const { emitted } = run([spawn(rock("a1", "red", 250)), press("r", 1000)]);
    const advanced = only(emitted, "advanced")[0] as AdvancedEmit;
    expect(advanced.fkLatencyMs).toBe(750);
    expect(advanced.ikiMs).toBeNull();
  });

  it("FR-7: first-key latency is withheld while the target is ambiguous", () => {
    const { emitted } = run([
      spawn(rock("a1", "flow", 0)),
      spawn(rock("a2", "flower", 40)),
      press("f", 500),
    ]);
    const advanced = only(emitted, "advanced")[0] as AdvancedEmit;
    expect(advanced.fkLatencyMs).toBeNull();
    expect(advanced.asteroidId).toBeNull();
    expect(advanced.candidateIds).toEqual(["a1", "a2"]);
  });

  it("FR-7: inter-key intervals are the gaps between correct keystrokes", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "dust", 0)),
      press("d", 500),
      press("u", 640),
      press("s", 810),
      press("t", 930),
    ]);
    expect((only(emitted, "blast")[0] as BlastEmit).ikiMs).toEqual([140, 170, 120]);
    expect(state.ikiMs).toEqual([]);
  });

  it("FR-7: a typo breaks the interval chain instead of poisoning the median", () => {
    // Folding the detour in would bias the median, and fall time (arch 4.1)
    // budgets off that median, so the error would punish the mistake twice.
    const { emitted } = run([
      spawn(rock("a1", "dust", 0)),
      press("d", 500),
      press("u", 600),
      press("q", 700),
      press("s", 3000),
      press("t", 3100),
    ]);
    expect(only(emitted, "advanced").map((a) => a.ikiMs))
      .toEqual([null, 100, null, 100]);
    expect((only(emitted, "blast")[0] as BlastEmit).ikiMs).toEqual([100, 100]);
  });

  it("FR-7: an ignored rival key breaks the chain the same way", () => {
    const { emitted } = run([
      spawn(rock("a1", "dust", 0)),
      spawn(rock("a2", "moon", 0)),
      press("d", 500),
      press("m", 600),
      press("u", 2000),
      press("s", 2100),
      press("t", 2200),
    ]);
    expect((only(emitted, "blast")[0] as BlastEmit).ikiMs).toEqual([100, 100]);
  });

  it("FR-7: nowMs is the only clock — identical scripts give identical output", () => {
    const script: LockEvent[] = [
      spawn(rock("a1", "red", 0)),
      ...typeWord("red", 100),
    ];
    expect(run(script).emitted).toEqual(run(script).emitted);
  });
});

describe("registry and reducer hygiene", () => {
  it("reduce never mutates the state it was given", () => {
    const before = reduce(createLockState(), spawn(rock("a1", "red")));
    // The matcher is a pair of functions, which structuredClone refuses; it is
    // injected config and is compared by identity instead.
    const { matcher, ...data } = before;
    const snapshot = structuredClone(data);
    reduce(before, press("r", 100));
    const { matcher: after, ...afterData } = before;
    expect(afterData).toEqual(snapshot);
    expect(after).toBe(matcher);
  });

  it("emitted holds only the last step's emissions", () => {
    const one = reduce(createLockState(), spawn(rock("a1", "red")));
    const two = reduce(one, press("r", 100));
    const three = reduce(two, press("e", 200));
    expect(two.emitted.map((e) => e.type)).toEqual(["locked", "advanced"]);
    expect(three.emitted.map((e) => e.type)).toEqual(["advanced"]);
  });

  it("AC-4.2: losing the locked asteroid returns to idle with no failure event", () => {
    // The hull hit belongs to FR-4; the lock just lets go, silently (D31).
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      press("r", 100),
      { type: "despawn", id: "a1", nowMs: 200 },
    ]);
    expect(emitted.map((e) => e.type)).toEqual(["locked", "advanced"]);
    expect(phaseOf(state)).toBe("idle");
    expect(state.live).toEqual([]);
    expect(state.typos).toBe(0);
  });

  it("despawning an asteroid that is not a candidate leaves the attempt alone", () => {
    const { state } = run([
      spawn(rock("a1", "red")),
      spawn(rock("a2", "blue")),
      press("r", 100),
      { type: "despawn", id: "a2", nowMs: 150 },
    ]);
    expect(state.lockedId).toBe("a1");
    expect(state.typed).toBe("r");
    expect(state.live.map((a) => a.id)).toEqual(["a1"]);
  });

  it("words are normalised on spawn so casing and punctuation cannot block a lock", () => {
    const { emitted } = run([
      spawn(rock("a1", "  Red.  ", 0)),
      ...typeWord("red", 100),
    ]);
    expect(only(emitted, "blast")).toHaveLength(1);
  });

  it("an untypeable entry is refused at spawn rather than jamming the matcher", () => {
    expect(run([spawn(rock("a1", "---", 0))]).state.live).toEqual([]);
  });

  it("a duplicate asteroid id is refused, so the lock can still resolve", () => {
    // Two entries under one id would sit in candidateIds twice and the
    // one-candidate test would never be true again.
    const { state, emitted } = run([
      spawn(rock("a1", "red", 0)),
      spawn(rock("a1", "red", 10)),
      ...typeWord("red", 100),
    ]);
    expect(state.live).toEqual([]);
    expect(only(emitted, "blast")).toHaveLength(1);
  });

  it("AC-4.1: reset clears the belt and the attempt but keeps the settings", () => {
    const options = { layout: "dvorak", parkGraceMs: 900 } as const;
    const { state } = run(
      [spawn(rock("a1", "red")), press("r", 100), { type: "reset" }],
      createLockState(options),
    );
    expect(state).toEqual(createLockState(options));
  });

  it("D46: the default matcher is exact, so Latin content is unchanged", () => {
    expect(createLockState().matcher).toBe(EXACT_MATCHER);
  });

  it("the park grace window defaults to FR-8's keystroke budget", () => {
    // 1.5 x the default median inter-key interval (350 ms).
    expect(DEFAULT_PARK_GRACE_MS).toBe(525);
    expect(createLockState().parkGraceMs).toBe(525);
  });

  it("phaseOf reports idle, narrowing, parked and locked", () => {
    let state = createLockState();
    expect(phaseOf(state)).toBe("idle");
    state = reduce(state, spawn(rock("a1", "cat")));
    state = reduce(state, spawn(rock("a2", "cattle")));
    state = reduce(state, press("c", 100));
    expect(phaseOf(state)).toBe("narrowing");
    state = reduce(state, press("a", 200));
    state = reduce(state, press("t", 300));
    expect(phaseOf(state)).toBe("parked");
    state = reduce(state, press("t", 400));
    expect(phaseOf(state)).toBe("locked");
  });

  it("reduceAll folds a script and collects every emission", () => {
    const result = reduceAll(createLockState(), [
      spawn(rock("a1", "a", 0)),
      press("a", 100),
    ]);
    expect(result.emitted.map((e) => e.type)).toEqual([
      "locked", "advanced", "blast",
    ]);
    expect(result.state.live).toEqual([]);
  });
});

describe("D46: the injected WordMatcher decides what counts as the word", () => {
  const translit = () =>
    createLockState({ matcher: createWordMatcher("translit"), parkGraceMs: 500 });

  it("D46: createWordMatcher('translit') is the port the lock takes", () => {
    expect(translit().matcher).toBe(TRANSLIT_MATCHER);
  });

  it.each([["ghar"], ["ghara"]])(
    "D46: '%s' blasts घर — every legal spelling is accepted, not one canonical",
    (romanization) => {
      // canonicalRomanization("घर") is "ghara", but D46's own example types
      // "ghar". Pinning either one is the failure the variant sets prevent.
      const { state, emitted } = run(
        [
          spawn(rock("a1", "घर", 0)),
          ...[...romanization].map((ch, i) => press(ch, 500 + i * 100)),
        ],
        translit(),
      );
      const blast = only(emitted, "blast")[0] as BlastEmit;
      expect(blast).toMatchObject({ asteroidId: "a1", word: "घर", typos: 0 });
      expect(blast.fkLatencyMs).toBe(500);
      expect(state.live).toEqual([]);
    },
  );

  it("D46: the first romanized keystroke auto-locks the Devanagari word", () => {
    const { state, emitted } = run(
      [spawn(rock("a1", "घर", 0)), press("g", 400)],
      translit(),
    );
    expect(emitted.map((e) => e.type)).toEqual(["locked", "advanced"]);
    expect((emitted[0] as LockedEmit).word).toBe("घर");
    expect(state.lockedId).toBe("a1");
  });

  it("AC-2.2 / D46: a romanized prefix parks the shorter word", () => {
    // "kal" completes कल and is still a prefix of कलम ("kalam"), so the
    // ambiguity is real on romanized input even though the Devanagari strings
    // are different lengths. Code-point length cannot detect this.
    const { state, emitted } = run(
      [
        spawn(rock("a1", "कल", 0)),
        spawn(rock("a2", "कलम", 0)),
        ...[..."kal"].map((ch, i) => press(ch, 500 + i * 100)),
      ],
      translit(),
    );
    expect(only(emitted, "blast")).toHaveLength(0);
    expect(only(emitted, "parked")[0] as ParkedEmit).toMatchObject({
      asteroidId: "a1",
      word: "कल",
      typed: "kal",
      rivalIds: ["a2"],
    });
    expect(phaseOf(state)).toBe("parked");
  });

  it("AC-2.2 / D46: typing on locks the longer Devanagari word", () => {
    const { state, emitted } = run(
      [
        spawn(rock("a1", "कल", 0)),
        spawn(rock("a2", "कलम", 0)),
        ...[..."kalam"].map((ch, i) => press(ch, 500 + i * 100)),
      ],
      translit(),
    );
    expect((only(emitted, "locked")[0] as LockedEmit).asteroidId).toBe("a2");
    expect((only(emitted, "blast")[0] as BlastEmit).word).toBe("कलम");
    expect(state.live.map((a) => a.id)).toEqual(["a1"]);
  });

  it("AC-2.2 / D46: stopping after 'kal' fires कल on the tick", () => {
    const parked = run(
      [
        spawn(rock("a1", "कल", 0)),
        spawn(rock("a2", "कलम", 0)),
        ...[..."kal"].map((ch, i) => press(ch, 500 + i * 100)),
      ],
      translit(),
    );
    const fired = reduce(parked.state, { type: "tick", nowMs: 700 + 500 });
    expect((only(fired.emitted, "blast")[0] as BlastEmit).word).toBe("कल");
    expect(fired.live.map((a) => a.id)).toEqual(["a2"]);
  });

  it("AC-3.2 / D46: a typo highlights the romanized characters that would advance", () => {
    // There is no "next letter" of कलम to read off the word; the expected set
    // is obtained from the matcher.
    const { state, emitted } = run(
      [
        spawn(rock("a1", "कल", 0)),
        spawn(rock("a2", "कलम", 0)),
        ...[..."ka"].map((ch, i) => press(ch, 500 + i * 100)),
        press("z", 800),
      ],
      translit(),
    );
    const typo = only(emitted, "typo")[0] as TypoEmit;
    expect(typo.expected).toEqual(["l"]);
    expect(typo.typos).toBe(1);
    expect(state.typed).toBe("ka");
    expect(state.candidateIds).toEqual(["a1", "a2"]);
  });

  it("D46: typedAs still pins a literal spelling under the exact matcher", () => {
    const { emitted } = run([
      spawn(rock("a1", "घर", 0, "ghar")),
      ...typeWord("ghar", 400),
    ]);
    expect((only(emitted, "blast")[0] as BlastEmit).word).toBe("घर");
  });
});

// ---------------------------------------------------------------------------
// Simulation. The point of this one is the D25 tier: shared prefixes are where
// the lock can actually be dropped, so every run has real rivals on screen,
// plus a second word family to supply AC-3.3 keystrokes and despawns.
// ---------------------------------------------------------------------------

/** Families with distinct first letters, so cross-family keys are never candidates. */
const FAMILIES: readonly (readonly string[])[] = [
  ["flow", "flower", "flows", "flowing"],
  ["cat", "car", "cart", "carts"],
  ["red", "read", "ready"],
  ["sun", "sung", "sunset"],
  ["moon", "moons"],
];

const ALPHABET = [..."abcdefghijklmnopqrstuvwxyz"];

describe("AC-3.2 / AC-3.3 / D25: seeded flight simulation", () => {
  it("AC-3.2: 300 seeded runs with shared prefixes never drop the lock", () => {
    const rand = mulberry32(0xb1a57);
    let sawPark = 0;
    let sawIgnored = 0;
    let sawComposition = 0;
    let sawTickBlast = 0;

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const [famA, famB] = [...FAMILIES]
        .map((f) => ({ f, k: rand() }))
        .sort((x, y) => x.k - y.k)
        .slice(0, 2)
        .map((x) => x.f) as [readonly string[], readonly string[]];

      // 2-3 rivals sharing a prefix, plus 1-2 rocks from the other family.
      const rivals = famA.slice(0, 2 + Math.floor(rand() * 2));
      const others = famB.slice(0, 1 + Math.floor(rand() * 2));
      const layoutStart = pick(rand, LAYOUTS);

      let state = createLockState({ layout: layoutStart, parkGraceMs: 500 });
      let layout = layoutStart;
      const ids = new Map<string, string>();
      rivals.concat(others).forEach((word, i) => {
        const id = `r${i}`;
        ids.set(word, id);
        state = reduce(state, spawn(rock(id, word, i * 10)));
      });

      const target = pick(rand, rivals);
      const targetId = ids.get(target) as string;
      const letters = [...target];
      let nowMs = 1_000;
      let injectedTypos = 0;
      let injectedIgnored = 0;
      const emitted: LockEmit[] = [];

      const step = (event: LockEvent): void => {
        const lockedBefore = state.lockedId;
        const typedBefore = state.typed;
        state = reduce(state, event);
        emitted.push(...state.emitted);
        const blasted = only(state.emitted, "blast").length > 0;
        if (lockedBefore !== null && !blasted) {
          // The load-bearing invariant of D31: a lock is never handed to
          // another rock and never silently released.
          expect(state.lockedId).toBe(lockedBefore);
        }
        if (!blasted && typedBefore.length > 0) {
          expect(state.typed.startsWith(typedBefore)).toBe(true);
        }
      };

      for (let i = 0; i < letters.length; i += 1) {
        const expectedChar = letters[i] as string;

        // Characters that would legitimately advance some candidate: a
        // generator that used one of these would be testing nothing.
        const advancing = new Set(
          state.candidateIds
            .map((id) => state.live.find((a) => a.id === id) as LiveAsteroid)
            .map((a) => [...a.word][i]),
        );

        if (rand() < 0.35 && i > 0) {
          // A key that belongs to a rock the player is NOT typing: AC-3.3
          // says ignored, so it must not touch the typo count.
          const liveOther = state.live
            .filter((a) => !state.candidateIds.includes(a.id))
            .map((a) => [...a.word][0] as string)
            .filter((c) => !advancing.has(c));
          const ch = liveOther[0];
          if (ch !== undefined) {
            nowMs += 80;
            const typosBefore = state.typos;
            const parkBefore = state.pendingExactId;
            step(press(ch, nowMs, layout));
            expect(state.typos).toBe(typosBefore);
            expect(state.pendingExactId).toBe(parkBefore);
            injectedIgnored += 1;
            sawIgnored += 1;
          }
        }

        if (rand() < 0.4 && i > 0) {
          // A key that matches nothing at all: AC-3.2 typo.
          const liveFirsts = new Set(state.live.map((a) => [...a.word][0] as string));
          const ch = pick(
            rand,
            ALPHABET.filter((c) => !advancing.has(c) && !liveFirsts.has(c)),
          );
          nowMs += 80;
          const parkBefore = state.pendingExactId;
          const liveBefore = state.live.length;
          step(press(ch, nowMs, layout));
          injectedTypos += 1;
          expect(state.typos).toBe(injectedTypos);
          // A fat finger never fires the parked word and never kills a rock.
          expect(state.pendingExactId).toBe(parkBefore);
          expect(state.live).toHaveLength(liveBefore);
        }

        if (rand() < 0.15) {
          layout = pick(rand, LAYOUTS);
          step({ type: "layout", layout });
        }

        if (rand() < 0.12) {
          // A rock the player is not typing crosses the breach line.
          const doomed = state.live.find(
            (a) => !state.candidateIds.includes(a.id) && a.id !== targetId,
          );
          if (doomed !== undefined) {
            nowMs += 20;
            step({ type: "despawn", id: doomed.id, nowMs });
          }
        }

        nowMs += 120;
        if (rand() < 0.15 && i + 1 < letters.length) {
          // D46: the rest of the word arrives as one committed composition.
          step({
            type: "composition",
            text: letters.slice(i).join(""),
            nowMs,
          });
          sawComposition += 1;
          break;
        }
        step(press(expectedChar, nowMs, layout));
      }

      if (state.pendingExactId !== null) {
        sawPark += 1;
        expect(state.pendingExactId).toBe(targetId);
        nowMs += 500;
        step({ type: "tick", nowMs });
        sawTickBlast += 1;
      }

      const blasts = only(emitted, "blast");
      expect(blasts).toHaveLength(1);
      expect(blasts[0] as BlastEmit).toMatchObject({
        asteroidId: targetId,
        word: target,
        typos: injectedTypos,
      });
      expect(only(emitted, "ignored")).toHaveLength(injectedIgnored);
      expect(state.live.some((a) => a.id === targetId)).toBe(false);
      expect(phaseOf(state)).toBe("idle");
    }

    // The simulation is only worth anything if it reached the hard states.
    expect(sawPark).toBeGreaterThan(20);
    expect(sawTickBlast).toBeGreaterThan(20);
    expect(sawIgnored).toBeGreaterThan(50);
    expect(sawComposition).toBeGreaterThan(20);
  });
});
