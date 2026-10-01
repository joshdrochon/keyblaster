import { describe, expect, it } from "vitest";
import {
  BONUS_STOP_IDS,
  LANGS,
  ROUTE_STOP_IDS,
  STOP_IDS,
  isBonusStop,
  isLang,
  isStopId,
  stageIndexOf,
} from "@engine/types.js";

describe("languages (D45)", () => {
  it("carries exactly en, es, hi", () => {
    expect(LANGS).toEqual(["en", "es", "hi"]);
  });

  it("narrows a valid tag", () => {
    for (const l of LANGS) expect(isLang(l)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const l of ["fr", "EN", "", "english"]) expect(isLang(l)).toBe(false);
  });
});

describe("stops (D56, D57)", () => {
  it("runs Earth outward to Pluto, then the bonus pair", () => {
    expect(STOP_IDS).toEqual([
      "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
      "venus", "mercury", "zoozve",
    ]);
    expect(STOP_IDS).toHaveLength(10);
    expect(ROUTE_STOP_IDS).toEqual([
      "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
    ]);
  });

  // Mercury and Venus are stops now, but they are BONUS stops appended after
  // Pluto; C05 survives as "the main route starts at Earth", not "they do not exist".
  it("AC-27.1: keeps Mercury and Venus off the main route (C05)", () => {
    for (const id of BONUS_STOP_IDS) {
      expect(isStopId(id)).toBe(true);
      expect(isBonusStop(id)).toBe(true);
      expect(ROUTE_STOP_IDS).not.toContain(id);
    }
    expect(ROUTE_STOP_IDS[0]).toBe("earth");
    expect(ROUTE_STOP_IDS.some(isBonusStop)).toBe(false);
  });

  it("narrows a valid stop", () => {
    for (const s of STOP_IDS) expect(isStopId(s)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const s of ["moon", "", "Earth"]) expect(isStopId(s)).toBe(false);
  });
});

describe("stageIndexOf", () => {
  it("puts Earth at 0 as the launchpad (D57)", () => {
    expect(stageIndexOf("earth")).toBe(0);
  });

  it("numbers the nine belt stops 1..9", () => {
    expect(stageIndexOf("mars")).toBe(1);
    expect(stageIndexOf("jupiter")).toBe(2);
    expect(stageIndexOf("saturn")).toBe(3);
    expect(stageIndexOf("uranus")).toBe(4);
    expect(stageIndexOf("neptune")).toBe(5);
    expect(stageIndexOf("pluto")).toBe(6);
    expect(stageIndexOf("venus")).toBe(7);
    expect(stageIndexOf("mercury")).toBe(8);
    expect(stageIndexOf("zoozve")).toBe(9);
  });

  it("is strictly increasing along the route", () => {
    const idx = STOP_IDS.map(stageIndexOf);
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
    }
  });
});
