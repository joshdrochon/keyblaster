import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldWarnVeil, veilFrom, veilWindowFor } from "@engine/veil/index.js";
import { STOP_IDS } from "@engine/types.js";
import { type RockHintView } from "@engine/hint/index.js";
import { VEIL_HINT_KEY, createFlightCopy, hintLead } from "@game/flight/copy.js";
import { estimateSpeechMs } from "@game/audio/voice.js";

/**
 * D109: Shadow names Venus's cloud once per run. Same mechanism as the
 * canister, nested and heat hints.
 *
 *   npx vitest run tests/unit/flight/veilHint.test.ts --coverage.enabled=false
 */

const SCENE = join(process.cwd(), "src/game/scenes/FlightScene.ts");
const scene = (): string => readFileSync(SCENE, "utf8");

const visible = (over: Partial<RockHintView> = {}): RockHintView => ({
  centreY: 300,
  sizePx: 120,
  viewportHeight: 1080,
  msToBreach: 5000,
  ...over,
});

describe("D109: only Venus has cloud", () => {
  it("fires at Venus", () => {
    expect(shouldWarnVeil({ stopId: "venus", saidThisRun: false, leadMs: 1200, veiled: visible() })).toBe(true);
  });

  it("fires nowhere else", () => {
    for (const stop of STOP_IDS.filter((s) => s !== "venus")) {
      expect(
        shouldWarnVeil({ stopId: stop, saidThisRun: false, leadMs: 1200, veiled: visible() }),
        stop,
      ).toBe(false);
      expect(veilWindowFor(stop), stop).toBeNull();
    }
  });
});

describe("D109: it waits for something to point at", () => {
  it("says nothing with no veiled word on the board", () => {
    expect(shouldWarnVeil({ stopId: "venus", saidThisRun: false, leadMs: 1200, veiled: null })).toBe(false);
  });

  it("says nothing twice", () => {
    expect(shouldWarnVeil({ stopId: "venus", saidThisRun: true, leadMs: 1200, veiled: visible() })).toBe(false);
  });

  it("waits until the word is WHOLLY in frame", () => {
    expect(
      shouldWarnVeil({ stopId: "venus", saidThisRun: false, leadMs: 1200, veiled: visible({ centreY: 20 }) }),
    ).toBe(false);
  });

  it("does not start a line the word will outlive", () => {
    expect(
      shouldWarnVeil({ stopId: "venus", saidThisRun: false, leadMs: 4000, veiled: visible({ msToBreach: 900 }) }),
    ).toBe(false);
  });

  it("the scene only points at a word long enough to HAVE a veiled letter", () => {
    const src = scene();
    expect(src).toContain("const minLength = veilFrom(0, veilWindowFor(this.cfg.stopId)) + 1;");
    expect(src).toContain("r.word.length >= minLength");
    // At Venus that is five letters: four clear, then cloud.
    expect(veilFrom(0, veilWindowFor("venus")) + 1).toBe(4);
  });
});

describe("D109: the line itself", () => {
  it("names the cloud and says what to do about it", () => {
    const line = createFlightCopy("en", { shipName: "Lantern" }).t(VEIL_HINT_KEY);
    expect(line).toContain("clouds");
    expect(line).toContain("first letters");
  });

  it("the clause that NAMES it fits the fall it is pointed at", () => {
    const copy = createFlightCopy("en", { shipName: "Lantern" });
    const lead = hintLead(copy.t(VEIL_HINT_KEY));
    expect(lead).toBe("The clouds are thick here!");
    expect(estimateSpeechMs(lead)).toBeLessThan(3000);
  });

  it("is claimed on the registry before the bus call", () => {
    const src = scene();
    expect(src).toContain('const VEIL_HINT_REGISTRY_KEY = "kb.flight.veilHintSaid";');
    const claim = src.indexOf("this.registry.set(VEIL_HINT_REGISTRY_KEY, true);");
    const speak = src.indexOf("id: VEIL_HINT_KEY", claim);
    expect(claim).toBeGreaterThan(0);
    expect(speak).toBeGreaterThan(claim);
  });

  it("ships as a rendered clip in Shadow's pinned voice", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "src/content/audio/voice/manifest.json"), "utf8"),
    ) as { lines: { id: string; voiceId: string }[] };
    const clip = manifest.lines.find((l) => l.id === VEIL_HINT_KEY);
    expect(clip).toBeDefined();
    expect(clip?.voiceId).toBe("J1UkN5Wmr20DZIiLKXHI");
  });
});
