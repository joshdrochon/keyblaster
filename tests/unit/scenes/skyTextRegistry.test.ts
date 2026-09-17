import { describe, expect, it } from "vitest";
import {
  SHUTDOWN,
  clearSkyText,
  recordSkyText,
  skyTextSamples,
  type SceneLike,
} from "@game/scenes/lib/skyTextRegistry";
import type { TextSample } from "@engine/contrast/index.js";

/**
 * THE LIFETIME OF THE CONTRAST EVIDENCE.
 *
 * A Phaser scene object survives `scene.restart()`. The Director map is
 * restarted three times inside one `capture-screens` run - once per progress
 * variant - so a registry that only ever appended would have shipped
 * `contrast-sky.json` with every row three times over, and the rubric's
 * anti-vacuity row count would have been satisfied by duplicates rather than by
 * coverage. That is the same class of mistake as the defect this whole change
 * exists to fix: a number that looks like evidence and is not.
 */

/** The smallest thing that behaves like a Phaser scene's event emitter. */
function fakeScene(): SceneLike & { shutdown(): void; listeners: number } {
  const once: (() => void)[] = [];
  return {
    events: {
      once(_event: string, fn: () => void) {
        once.push(fn);
        return this;
      },
    },
    shutdown() {
      const fired = once.splice(0, once.length);
      for (const fn of fired) fn();
    },
    get listeners() {
      return once.length;
    },
  };
}

const row = (id: string): TextSample => ({
  screen: "map",
  id,
  color: "#F7FAFF",
  plateFill: "#0E1116",
  plateAlpha: 0.97,
});

describe("sky-text registry", () => {
  it("records rows per scene and keeps them apart", () => {
    const a = fakeScene();
    const b = fakeScene();
    recordSkyText(a, row("a.1"));
    recordSkyText(a, row("a.2"));
    recordSkyText(b, row("b.1"));
    expect(skyTextSamples(a).map((r) => r.id)).toEqual(["a.1", "a.2"]);
    expect(skyTextSamples(b).map((r) => r.id)).toEqual(["b.1"]);
  });

  it("a scene that has drawn nothing reports nothing rather than throwing", () => {
    expect(skyTextSamples(fakeScene())).toEqual([]);
  });

  it("THE RESTART BUG: rows do not survive a shutdown", () => {
    const scene = fakeScene();
    recordSkyText(scene, row("first.mount"));
    scene.shutdown();
    expect(skyTextSamples(scene)).toEqual([]);

    recordSkyText(scene, row("second.mount"));
    expect(skyTextSamples(scene).map((r) => r.id)).toEqual(["second.mount"]);
  });

  it("three restarts leave three rows, not nine", () => {
    // The Director map's actual capture sequence: marsOnly, midRun, allSeven.
    const map = fakeScene();
    for (const variant of ["marsOnly", "midRun", "allSeven"]) {
      recordSkyText(map, row(`map.heading.${variant}`));
      expect(skyTextSamples(map)).toHaveLength(1);
      map.shutdown();
    }
  });

  it("arms exactly one shutdown listener per mount", () => {
    const scene = fakeScene();
    recordSkyText(scene, row("one"));
    recordSkyText(scene, row("two"));
    recordSkyText(scene, row("three"));
    expect(scene.listeners).toBe(1);
    scene.shutdown();
    expect(scene.listeners).toBe(0);
    recordSkyText(scene, row("four"));
    expect(scene.listeners).toBe(1);
  });

  it("clears on demand", () => {
    const scene = fakeScene();
    recordSkyText(scene, row("x"));
    clearSkyText(scene);
    expect(skyTextSamples(scene)).toEqual([]);
  });

  it("names the event Phaser actually emits", () => {
    // If Phaser's constant and this string ever diverge, the rows stop being
    // cleared and the duplication comes back silently.
    expect(SHUTDOWN).toBe("shutdown");
  });
});
