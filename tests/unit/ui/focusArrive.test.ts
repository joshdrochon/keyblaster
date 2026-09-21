import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE ARRIVAL FOR EVERY FOCUS RING IN THE GAME (UR-113).
 *
 * ================== THE DEFECT ==================
 * The project owner, on the beacon screen's Continue button: "All buttons with
 * this ring should behave this way ... the home screen buttons didnt seem to
 * have it". They were right, and the sweep found four ring implementations
 * with three different answers:
 *
 *   scenes/lib/kit.createFocusRing   0.55 -> 1, DUR.focus, EASE.pop, then breathe
 *   ui/chrome.FocusRing              0    -> 1, DUR.focus, EASE.arrive, then breathe
 *   TitleScene.drawFocusRing         nothing. alpha was never touched at all
 *   StallScene.paintRing             nothing, plus one 0.5 -> 1 / 1100 ms breath
 *                                    started at create and never moved again
 *
 * So the HOME SCREEN - the first screen anybody sees - had no fade and no
 * breath, the stall card breathed on a schedule that ignored which of its two
 * buttons was focused, and Settings blinked its ring fully OUT and back every
 * time focus moved, because 0 is not a dim ring, it is no ring.
 *
 * ================== WHAT REPLACES THEM ==================
 * `ui/focusPop.focusArrive`, beside the `focusPulse` the same four sites
 * already shared. Both steps, in that order, everywhere. This file holds the
 * spec and then checks each of the four sites actually runs it - two by
 * driving the real class, two by reading the source, because a Scene subclass
 * cannot be constructed under vitest's node environment.
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

vi.mock("@game/boot", () => ({
  services: () => {
    throw new Error("no services in a unit test");
  },
}));

interface TweenEntry {
  readonly config: Record<string, unknown>;
  removed: boolean;
}

const tweens: TweenEntry[] = [];

function makeGraphics(): Record<string, unknown> {
  const g: Record<string, unknown> = {
    alpha: 1,
    depth: 0,
    visible: true,
    clear: () => g,
    lineStyle: () => g,
    strokeRoundedRect: () => g,
    fillStyle: () => g,
    fillRoundedRect: () => g,
    setDepth: (d: number) => {
      g["depth"] = d;
      return g;
    },
    setAlpha: (a: number) => {
      g["alpha"] = a;
      return g;
    },
    setScale: () => g,
    destroy: () => g,
  };
  return g;
}

const scene = {
  add: {
    graphics: () => makeGraphics(),
  },
  tweens: {
    add(config: Record<string, unknown>) {
      const entry: TweenEntry = { config, removed: false };
      tweens.push(entry);
      return {
        remove() {
          entry.removed = true;
        },
      };
    },
  },
} as unknown as import("phaser").Scene;

/** The one tween that is a finite alpha ramp - the arrival, never the breath. */
function arrivalTween(): TweenEntry | undefined {
  return tweens.filter((t) => !t.removed).find((t) => t.config["repeat"] !== -1);
}

const src = (path: string): string => readFileSync(path, "utf8");

beforeEach(() => {
  tweens.length = 0;
  vi.resetModules();
});

describe("focusArrive is the one arrival every ring runs", () => {
  it("starts dim rather than invisible, and lands on the breath's loud end", async () => {
    const { focusArrive, FOCUS_ARRIVE_FROM, FOCUS_ARRIVE_MS, focusPulse } = await import(
      "@game/ui/focusPop"
    );
    const { EASE } = await import("@game/ui/theme");

    const spec = focusArrive();
    expect(spec.alpha).toEqual({ from: FOCUS_ARRIVE_FROM, to: 1 });
    expect(spec.duration).toBe(FOCUS_ARRIVE_MS);
    expect(spec.ease).toBe(EASE.pop);

    // NEVER ZERO. A ring at alpha 0 is a frame of a screen with no focus on it,
    // which is the one thing AC-18.1 forbids.
    expect(FOCUS_ARRIVE_FROM).toBeGreaterThan(0);

    // The arrival hands over to the breath at exactly the alpha the breath
    // starts from, so there is no step between the two tweens.
    expect(focusPulse(false)?.alpha.from).toBe(spec.alpha.to);
  });

  it("is unconditional, unlike the breath: calm motion keeps the arrival", async () => {
    const { focusArrive, focusPulse } = await import("@game/ui/focusPop");
    // D41/AC-19.3: calm motion loses the idle animation and keeps every cue
    // that says where focus just went. `focusArrive` takes no flag at all,
    // which is what makes that impossible to get wrong at a call site.
    expect(focusPulse(true)).toBeNull();
    expect(focusArrive.length).toBe(0);
  });
});

describe("all four rings run it", () => {
  it("the story kit's ring (beacon, results, warp, ending, briefing, map, earth)", async () => {
    const kit = await import("@game/scenes/lib/kit");
    const { focusArrive } = await import("@game/ui/focusPop");

    const ring = kit.createFocusRing(scene, 40, false);
    ring.moveTo({ id: "beacon-continue", x: 750, y: 960, w: 420, h: 88 });

    const spec = focusArrive();
    const arrival = arrivalTween();
    expect(arrival, "the kit ring never faded in").toBeDefined();
    expect(arrival?.config["alpha"]).toEqual(spec.alpha);
    expect(arrival?.config["duration"]).toBe(spec.duration);
    expect(arrival?.config["ease"]).toBe(spec.ease);
  });

  it("the menu ring (settings, beacon log, profiles, pause, confirm dialog)", async () => {
    const { FocusRing } = await import("@game/ui/chrome");
    const { focusArrive } = await import("@game/ui/focusPop");

    const ring = new FocusRing(scene, 40, false);
    // The FIRST move is the ring appearing on a screen that had none, which is
    // instant by design. The defect was the SECOND - moving between two
    // controls, where the ring used to blink out to 0 on the way.
    ring.moveTo(96, 216, 466, 112);
    tweens.length = 0;
    ring.moveTo(96, 380, 466, 112);

    const spec = focusArrive();
    const arrival = arrivalTween();
    expect(arrival, "the menu ring never faded onto the new control").toBeDefined();
    expect(arrival?.config["alpha"]).toBe(spec.alpha.to);
    expect(arrival?.config["duration"]).toBe(spec.duration);
    expect(arrival?.config["ease"]).toBe(spec.ease);
  });

  it("the home screen's ring, which had neither step", () => {
    const title = src("src/game/scenes/TitleScene.ts");
    expect(title).toContain("focusArrive()");
    expect(title).toContain("focusPulse(this.reducedMotion)");
    // The arrival is driven by FOCUS MOVING, not by `create` running once.
    expect(title).toMatch(/private setFocus\([\s\S]{0,200}this\.animateFocusRing\(\);/);
  });

  it("the stall card's ring, which breathed on its own schedule", () => {
    const stall = src("src/game/scenes/StallScene.ts");
    expect(stall).toContain("focusArrive()");
    expect(stall).toContain("focusPulse(this.params.reducedMotion)");
    // Driven by `paintRing`, which is what both buttons' focus changes call.
    expect(stall).toMatch(/paintFocusRing\(this\.focusRing[\s\S]{0,120}this\.animateRing\(\);/);
    // The bespoke numbers are gone, not merely unused. Comments are stripped
    // first: the note recording what was REMOVED necessarily quotes them.
    const code = stall
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toContain("1100");
    expect(code).not.toContain("Sine.InOut");
  });

  it("no ring site carries its own fade numbers any more", () => {
    for (const path of [
      "src/game/scenes/lib/kit.ts",
      "src/game/ui/chrome.ts",
      "src/game/scenes/TitleScene.ts",
      "src/game/scenes/StallScene.ts",
    ]) {
      const text = src(path);
      // THE LITERAL IS THE DRIFT. Four files each holding their own `0.55` is
      // how they got to three different answers in the first place; the number
      // lives in `focusPop` and nowhere else.
      expect(text, `${path} still hardcodes the arrival's from-alpha`).not.toMatch(
        /alpha:\s*\{\s*from:\s*0(\.\d+)?\s*,\s*to:\s*1\s*\}/,
      );
    }
  });
});
