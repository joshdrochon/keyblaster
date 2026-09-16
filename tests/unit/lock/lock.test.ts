import { describe, expect, it } from "vitest";
import {
  LAYOUT_MAPS,
  type AdvancedEmit,
  type BlastEmit,
  type KeyInput,
  type LiveAsteroid,
  type LockEmit,
  type LockEvent,
  type LockState,
  type LockedEmit,
  type TypoEmit,
  createLockState,
  phaseOf,
  reduce,
  reduceAll,
} from "@engine/lock/index.js";

// ---------------------------------------------------------------------------
// Fixtures. Every event carries an explicit nowMs: the engine never reads a
// clock (CLAUDE.md), so every timing assertion below is exact, not tolerant.
// ---------------------------------------------------------------------------

/** char → physical code on QWERTY, so tests can spell words as keystrokes. */
const CODE_FOR_CHAR = new Map<string, string>(
  [...LAYOUT_MAPS.qwerty].map(([code, ch]) => [ch, code]),
);

function key(ch: string, mods: Partial<KeyInput> = {}): KeyInput {
  return {
    key: ch,
    code: CODE_FOR_CHAR.get(ch) ?? "Unidentified",
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

function press(ch: string, nowMs: number): LockEvent {
  return { type: "key", input: key(ch), nowMs };
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

/** Fixed-seed PRNG for the typo simulation (lane brief: no Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    const after = reduce(start, {
      type: "key",
      input: key("Enter"),
      nowMs: 10,
    });
    expect(after.emitted).toEqual([]);
    expect(phaseOf(after)).toBe("idle");
  });

  it("D31: an idle keystroke that matches nothing is dropped, not punished", () => {
    // There is nothing on screen to be wrong against, so it must not shake,
    // count a typo, or (via scoring/) break the combo.
    const { state, emitted } = run([spawn(rock("a1", "red")), press("z", 40)]);
    expect(emitted).toEqual([]);
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
    const typo = typos[0] as TypoEmit;
    expect(typo).toMatchObject({
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
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast.typos).toBe(3);
    expect(blast.word).toBe("red");
    expect(phaseOf(state)).toBe("idle");
  });

  it("AC-3.2 / D31: no failure emission exists in the vocabulary", () => {
    const { emitted } = run([
      spawn(rock("a1", "red")),
      spawn(rock("a2", "blue")),
      ...typeWord("rxexd", 100),
    ]);
    const kinds = new Set(emitted.map((e) => e.type));
    expect([...kinds].every((k) =>
      ["locked", "advanced", "typo", "blast"].includes(k),
    )).toBe(true);
  });

  it("AC-3.2: 200 seeded runs of random typos never drop the lock", () => {
    const rand = mulberry32(0x5eed);
    const pool = ["red", "planet", "dust", "rivers", "beacon", "sky"];
    const alphabet = [..."abcdefghijklmnopqrstuvwxyz"];

    for (let run_ = 0; run_ < 200; run_ += 1) {
      const word = pool[Math.floor(rand() * pool.length)] as string;
      const letters = [...word];
      let state = reduce(createLockState(), spawn(rock("a1", word, 0)));
      let nowMs = 100;
      let injected = 0;

      state = reduce(state, press(letters[0] as string, nowMs));
      expect(state.lockedId).toBe("a1");

      for (let i = 1; i < letters.length; i += 1) {
        const expectedChar = letters[i] as string;
        const bursts = Math.floor(rand() * 3);
        for (let b = 0; b < bursts; b += 1) {
          const wrong = alphabet.filter((c) => c !== expectedChar);
          const ch = wrong[Math.floor(rand() * wrong.length)] as string;
          nowMs += 90;
          state = reduce(state, press(ch, nowMs));
          injected += 1;
          // The load-bearing invariant of D31: still locked, still mid-word.
          expect(state.lockedId).toBe("a1");
          expect(state.typed).toBe(letters.slice(0, i).join(""));
        }
        nowMs += 90;
        state = reduce(state, press(expectedChar, nowMs));
      }

      const blast = only(state.emitted, "blast")[0] as BlastEmit;
      expect(blast.word).toBe(word);
      expect(blast.typos).toBe(injected);
      expect(state.live).toHaveLength(0);
    }
  });
});

describe("AC-3.3: no switching targets", () => {
  it("AC-3.3: a keystroke matching another live asteroid is ignored", () => {
    const { state, emitted } = run([
      spawn(rock("a1", "red")),
      spawn(rock("a2", "blue")),
      press("r", 100),
      press("b", 200),
    ]);
    const typo = only(emitted, "typo")[0] as TypoEmit;
    expect(typo.ignoredTargetIds).toEqual(["a2"]);
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
    expect((only(emitted, "blast")[0] as BlastEmit).asteroidId).toBe("a1");
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
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast).toMatchObject({
      asteroidId: "a1",
      word: "red",
      typos: 0,
      fkLatencyMs: 500,
      ikiMs: [120, 120],
      durationMs: 240,
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
    expect(phaseOf(state)).toBe("narrowing");
    expect(only(emitted, "locked")).toHaveLength(0);
    expect(only(emitted, "blast")).toHaveLength(0);
    // The exact match is parked, not thrown away.
    expect(state.pendingExactId).toBe("a1");
  });

  it("AC-2.2: typing 'e' locks 'flower'", () => {
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flowe", 100),
    ]);
    const locked = only(emitted, "locked");
    expect(locked).toHaveLength(1);
    expect(locked[0] as LockedEmit).toMatchObject({
      asteroidId: "a2",
      word: "flower",
      typed: "flowe",
    });
    expect(state.pendingExactId).toBeNull();
    expect(state.lockedId).toBe("a2");
  });

  it("AC-2.2: 'flower' then completes and 'flow' is still falling", () => {
    const { state, emitted } = run([...flowField, ...typeWord("flower", 100)]);
    expect((only(emitted, "blast")[0] as BlastEmit).asteroidId).toBe("a2");
    expect(state.live.map((a) => a.id)).toEqual(["a1"]);
  });

  it("AC-2.2 / D31: a parked exact match fires when the next key fits nothing", () => {
    // The player meant "flow". Charging a typo here would make AC-2.2 a trap
    // the player can only leave by being punished, which D31 forbids.
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flow", 100),
      press("z", 600),
    ]);
    expect(only(emitted, "typo")).toHaveLength(0);
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast).toMatchObject({ asteroidId: "a1", word: "flow", typos: 0 });
    expect(state.live.map((a) => a.id)).toEqual(["a2"]);
    expect(phaseOf(state)).toBe("idle");
  });

  it("AC-2.2: the key that resolves a parked match can start the next word", () => {
    const { state, emitted } = run([
      ...flowField,
      spawn(rock("a3", "sun", 0)),
      ...typeWord("flow", 100),
      press("s", 600),
    ]);
    expect(emitted.map((e) => e.type)).toEqual([
      "advanced", "advanced", "advanced", "advanced", // f l o w
      "locked", "blast", // flow resolves
      "locked", "advanced", // s starts "sun"
    ]);
    expect(state.lockedId).toBe("a3");
    expect(state.typed).toBe("s");
  });

  it("AC-2.2: losing the longer rival fires the parked match with no keystroke", () => {
    const { state, emitted } = run([
      ...flowField,
      ...typeWord("flow", 100),
      { type: "despawn", id: "a2", nowMs: 900 },
    ]);
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast).toMatchObject({ asteroidId: "a1", nowMs: 900 });
    expect(state.live).toEqual([]);
  });

  it("AC-2.2: losing the parked exact match hands the lock to the longer word", () => {
    // "flow" crosses the breach line while it is parked; "flower" is still a
    // live candidate, so the half-typed prefix carries straight on.
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
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast).toMatchObject({ word: "घर", fkLatencyMs: 600, ikiMs: [] });
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
    const decomposed = run([
      spawn(rock("a1", "क़र", 0)),
      { type: "composition", text: "क़र", nowMs: 500 },
    ]);
    expect(only(decomposed.emitted, "blast")).toHaveLength(1);
  });

  it("D46: transliterated Hindi is typed in Latin and blasts the Devanagari word", () => {
    const { emitted } = run([
      spawn(rock("a1", "घर", 0, "ghar")),
      ...typeWord("ghar", 400),
    ]);
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast.word).toBe("घर");
  });
});

describe("AC-19.2: the layout map is applied before matching", () => {
  it("AC-19.2: AZERTY physical keys type the AZERTY characters", () => {
    // "art" on AZERTY is the physical keys KeyQ, KeyR, KeyT.
    const events: LockEvent[] = [
      spawn(rock("a1", "art", 0)),
      { type: "key", input: { key: "a", code: "KeyQ", ctrl: false, alt: false, meta: false }, nowMs: 100 },
      { type: "key", input: { key: "r", code: "KeyR", ctrl: false, alt: false, meta: false }, nowMs: 200 },
      { type: "key", input: { key: "t", code: "KeyT", ctrl: false, alt: false, meta: false }, nowMs: 300 },
    ];
    const azerty = run(events, createLockState({ layout: "azerty" }));
    expect(only(azerty.emitted, "blast")).toHaveLength(1);

    // The same physical keys on QWERTY spell "qrt" and never lock.
    const qwerty = run(events, createLockState({ layout: "qwerty" }));
    expect(qwerty.emitted).toEqual([]);
  });

  it("AC-19.2: Dvorak physical keys type the Dvorak characters", () => {
    // "the" on Dvorak is KeyK, KeyJ, KeyD.
    const { emitted } = run(
      [
        spawn(rock("a1", "the", 0)),
        { type: "key", input: { key: "k", code: "KeyK", ctrl: false, alt: false, meta: false }, nowMs: 100 },
        { type: "key", input: { key: "j", code: "KeyJ", ctrl: false, alt: false, meta: false }, nowMs: 200 },
        { type: "key", input: { key: "d", code: "KeyD", ctrl: false, alt: false, meta: false }, nowMs: 300 },
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
      { type: "key", input: { key: "y", code: "KeyY", ctrl: false, alt: false, meta: false }, nowMs: 100 },
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
    const blast = only(emitted, "blast")[0] as BlastEmit;
    expect(blast.ikiMs).toEqual([140, 170, 120]);
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
    const advances = only(emitted, "advanced");
    expect(advances.map((a) => a.ikiMs)).toEqual([null, 100, null, 100]);
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
    const snapshot = structuredClone(before);
    reduce(before, press("r", 100));
    expect(before).toEqual(snapshot);
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
    const { state } = run([spawn(rock("a1", "---", 0))]);
    expect(state.live).toEqual([]);
  });

  it("AC-4.1: reset clears the belt and the attempt but keeps the layout", () => {
    const { state } = run(
      [
        spawn(rock("a1", "red")),
        press("r", 100),
        { type: "reset" },
      ],
      createLockState({ layout: "dvorak" }),
    );
    expect(state).toEqual(createLockState({ layout: "dvorak" }));
  });

  it("phaseOf reports idle, narrowing and locked", () => {
    let state = createLockState();
    expect(phaseOf(state)).toBe("idle");
    state = reduce(state, spawn(rock("a1", "cat")));
    state = reduce(state, spawn(rock("a2", "car")));
    state = reduce(state, press("c", 100));
    expect(phaseOf(state)).toBe("narrowing");
    state = reduce(state, press("a", 200));
    state = reduce(state, press("t", 300));
    expect(phaseOf(state)).toBe("idle");
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
