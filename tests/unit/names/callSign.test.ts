import { describe, expect, it } from "vitest";
import {
  CALL_SIGN_ADJECTIVES,
  CALL_SIGN_COUNT,
  CALL_SIGN_NOUNS,
  randomCallSign,
} from "@engine/names/index.js";
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from "@engine/persistence/schema.js";

/**
 * UR-187: a new pilot is offered a real name, not the words "Pilot Name".
 *
 * The list is swept rather than sampled: a name that cannot be stored, or that
 * a seven year old cannot read, must fail HERE rather than on a child's screen.
 */
describe("UR-187: every call sign is storable", () => {
  it("fits the name field, both halves, every pair", () => {
    for (const a of CALL_SIGN_ADJECTIVES) {
      for (const n of CALL_SIGN_NOUNS) {
        const name = `${a}${n}`;
        expect(name.length, `${name} is too long to store`).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        expect(name.length, `${name} is too short`).toBeGreaterThanOrEqual(MIN_NAME_LENGTH);
      }
    }
  });

  it("is plain letters, so it survives a trim and a slice unchanged", () => {
    for (const w of [...CALL_SIGN_ADJECTIVES, ...CALL_SIGN_NOUNS]) {
      expect(w, `${w} is not plain letters`).toMatch(/^[A-Z][a-z]+$/);
      expect(w.trim()).toBe(w);
    }
  });

  it("has no duplicates in either list", () => {
    expect(new Set(CALL_SIGN_ADJECTIVES).size).toBe(CALL_SIGN_ADJECTIVES.length);
    expect(new Set(CALL_SIGN_NOUNS).size).toBe(CALL_SIGN_NOUNS.length);
  });

  it("offers enough names that a classroom does not collide constantly", () => {
    expect(CALL_SIGN_COUNT).toBeGreaterThan(500);
  });
});

describe("UR-187: the generator is a pure function of its source", () => {
  it("is deterministic for a given source", () => {
    const seeded = () => {
      let i = 0;
      const values = [0.0, 0.0];
      return () => values[i++ % values.length] as number;
    };
    expect(randomCallSign(seeded())).toBe(randomCallSign(seeded()));
  });

  it("walks the whole space, not one corner of it", () => {
    let i = 0;
    const seen = new Set<string>();
    const rand = (): number => {
      i += 1;
      return (i * 0.6180339887) % 1;
    };
    for (let n = 0; n < 400; n += 1) seen.add(randomCallSign(rand));
    expect(seen.size, "the generator is stuck in a corner").toBeGreaterThan(50);
  });

  it("never returns an empty or unstorable name, whatever the source does", () => {
    for (const bad of [
      () => Number.NaN,
      () => Number.POSITIVE_INFINITY,
      () => -1,
      () => 1,
      () => 0.999999999,
    ]) {
      const name = randomCallSign(bad);
      expect(name.length).toBeGreaterThanOrEqual(MIN_NAME_LENGTH);
      expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(name).toMatch(/^[A-Za-z]+$/);
    }
  });
});
