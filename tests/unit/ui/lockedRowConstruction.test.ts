import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A LOCKED ROW MUST SURVIVE BEING BORN LOCKED (UR-188).
 *
 * `Control.locked` became an accessor so that locking a control at runtime also
 * repaints it and drops the hand cursor. `ListRow` and `Tile` assign it in
 * their constructors, BEFORE `this.title` exists, so the new setter's
 * `redraw()` reached a half-built row: `Cannot read properties of undefined
 * (reading 'setColor')`. Every screen that lists something locked - the Beacon
 * Log, the Director map's unlit stops, Settings' locked slots, the hull picker
 * - threw on create and never attached.
 *
 * It shipped because nothing constructed a LOCKED row. Both constructors end
 * in `redraw()` anyway, so the fix is to seed the backing field and let that
 * call do the painting.
 */

vi.mock("phaser", () => ({
  default: {
    GameObjects: {},
    Tweens: {},
    Scene: class {},
    Math: { DegToRad: (deg: number) => (deg * globalThis.Math.PI) / 180 },
    Geom: {
      Point: class {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
    Scenes: { Events: { SHUTDOWN: "shutdown" } },
  },
}));

vi.mock("@game/boot", () => ({
  services: () => {
    throw new Error("no services in a unit test");
  },
}));

function chainable(seed: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(seed, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (typeof key === "string" && key.startsWith("set")) return () => target;
      return undefined;
    },
  }) as Record<string, unknown>;
}

function makeText(content: string, size: number): Record<string, unknown> {
  const t: Record<string, unknown> = {
    text: content,
    width: content.length * size * 0.5,
    height: Math.round(size * 1.25),
    x: 0,
    y: 0,
    setPosition(x: number, y: number) {
      t["x"] = x;
      t["y"] = y;
      return t;
    },
    setY(y: number) {
      t["y"] = y;
      return t;
    },
    setColor(next: string) {
      t["color"] = next;
      return t;
    },
    destroy: () => t,
  };
  return chainable(t);
}

function makeContainer(x: number, y: number): Record<string, unknown> {
  const c: Record<string, unknown> = {
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    depth: 0,
    name: "",
    add: () => c,
    remove: () => c,
    bringToTop: () => c,
    destroy: () => c,
  };
  return chainable(c);
}

const scene = {
  add: {
    graphics: () =>
      chainable({
        clear: () => undefined,
        fillStyle: () => undefined,
        fillRect: () => undefined,
        fillRoundedRect: () => undefined,
        lineStyle: () => undefined,
        strokeRect: () => undefined,
        strokeRoundedRect: () => undefined,
        strokeCircle: () => undefined,
        fillCircle: () => undefined,
        beginPath: () => undefined,
        closePath: () => undefined,
        destroy: () => undefined,
      }),
    container: (x: number, y: number) => makeContainer(x, y),
    text: (x: number, y: number, content: string, style: { fontSize?: string }) => {
      const t = makeText(content, Number.parseInt(style.fontSize ?? "24", 10));
      t["x"] = x;
      t["y"] = y;
      return t;
    },
    zone: () => chainable({ on: () => undefined, destroy: () => undefined }),
  },
  tweens: { add: () => ({ remove: () => undefined }) },
} as unknown as import("phaser").Scene;

const style = {
  lang: "en" as const,
  uppercase: false,
  increasedLetterSpacing: false,
  accent: "#FFC857",
};

beforeEach(() => {
  vi.resetModules();
});

describe("a control constructed locked does not paint before it is built", () => {
  it("ListRow: an unlit beacon is the Beacon Log's whole empty state", async () => {
    const { ListRow } = await import("@game/ui/controls");

    const row = new ListRow(scene, style, "log.beacon.pluto", 96, 216, 10, {
      label: "Pluto",
      detail: "Not Lit Yet",
      width: 880,
      locked: true,
    });

    expect(row.locked).toBe(true);
    expect(row.toMirror().locked).toBe(true);
  });

  it("Tile: a locked hull is dim, not absent (D73, AC-6d.1b)", async () => {
    const { Tile } = await import("@game/ui/controls");

    const tile = new Tile(scene, style, "hull.ship-3", 96, 216, 10, {
      label: "Drifter",
      detail: "unlocks at a 25 chain",
      width: 320,
      glyphHeight: 120,
      glyph: (s, x, y) =>
        makeContainer(x, y) as unknown as Phaser.GameObjects.Container,
      locked: true,
    });

    expect(tile.locked).toBe(true);
  });

  it("the unlocked path is unchanged, so the guard is not vacuous", async () => {
    const { ListRow } = await import("@game/ui/controls");

    const row = new ListRow(scene, style, "log.beacon.earth", 96, 216, 10, {
      label: "Earth",
      width: 880,
      locked: false,
    });

    expect(row.locked).toBe(false);
  });

  it("locking after construction still repaints", async () => {
    const { ListRow } = await import("@game/ui/controls");

    const row = new ListRow(scene, style, "log.beacon.mars", 96, 216, 10, {
      label: "Mars",
      width: 880,
    });

    expect(row.locked).toBe(false);
    row.locked = true;
    expect(row.locked).toBe(true);
  });
});
