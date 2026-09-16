import { describe, expect, it } from "vitest";
import {
  LANGS,
  STOP_IDS,
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
  it("runs Earth outward to Pluto, seven stops", () => {
    expect(STOP_IDS).toEqual([
      "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto",
    ]);
    expect(STOP_IDS).toHaveLength(7);
  });

  it("does not include Mercury or Venus (C05: the route starts at Earth)", () => {
    expect(isStopId("mercury")).toBe(false);
    expect(isStopId("venus")).toBe(false);
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

  it("numbers the six belt stops 1..6", () => {
    expect(stageIndexOf("mars")).toBe(1);
    expect(stageIndexOf("jupiter")).toBe(2);
    expect(stageIndexOf("saturn")).toBe(3);
    expect(stageIndexOf("uranus")).toBe(4);
    expect(stageIndexOf("neptune")).toBe(5);
    expect(stageIndexOf("pluto")).toBe(6);
  });

  it("is strictly increasing along the route", () => {
    const idx = STOP_IDS.map(stageIndexOf);
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
    }
  });
});
