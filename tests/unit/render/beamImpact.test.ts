import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SHOT HAS TO LEAVE FROM SOMEWHERE (UR-116).
 *
 * ================== THE DEFECT ==================
 * The project owner, playing Flight: the laser felt subtle, and it looked as
 * though it came out of nothing. Both were properties of the drawing.
 *
 *   - `fireBeam` drew ONE stroke. A laser is a hot core inside a soft bloom;
 *     one stroke can only ever be one of those.
 *   - The beam's Graphics never set a blend mode, while the rig's own standing
 *     light shaft is `BlendModes.ADD`. Light composited normally reads as paint.
 *   - Nothing was drawn at the lens at all, so the line started in mid air.
 *
 * The owner also noticed that the TITLE screen's ship looks different from the
 * one in Flight. It did, and that was the same bug seen from the other side:
 * `render/lantern` gives the standing shaft two tapered layers, an additive
 * blend and a breathing lens glow, and Flight - which turns the shaft off
 * because its beam is gameplay in the stop's accent - had reimplemented none
 * of it. The fix is the rig's vocabulary, not a fourth beam.
 *
 * ================== WHY THE FLASH IS A SECOND SPRITE ==================
 * `lensGlow` carries a permanent breathing tween on its alpha. Flashing it
 * would be two tweens writing one property, which is the bug `ui/chrome`
 * already documents for the focus ring, and which reads as the lamp stuttering
 * rather than pulsing. The muzzle is its own sprite, dark until fired. The
 * last test here is the one that would catch that regressing.
 */

vi.mock("phaser", () => {
  const BlendModes = { ADD: 1, NORMAL: 0 };
  return {
    default: {
      BlendModes,
      Math: {
        Clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
        DegToRad: (d: number) => (d * Math.PI) / 180,
      },
      GameObjects: {},
      Tweens: {},
      Geom: {
        Point: class {
          constructor(
            public x = 0,
            public y = 0,
          ) {}
        },
        Polygon: class {
          constructor(public points: unknown[] = []) {}
        },
      },
      Scene: class {},
      Scenes: { Events: { SHUTDOWN: "shutdown" } },
    },
  };
});

interface TweenEntry {
  readonly config: Record<string, unknown>;
  removed: boolean;
}
const tweens: TweenEntry[] = [];
const images: Record<string, unknown>[] = [];

function makeImage(texture: string): Record<string, unknown> {
  const o: Record<string, unknown> = {
    texture,
    alpha: 1,
    displayWidth: 0,
    displayHeight: 0,
    blend: 0,
    setDisplaySize(w: number, h: number) {
      o["displayWidth"] = w;
      o["displayHeight"] = h;
      return o;
    },
    setAlpha(a: number) {
      o["alpha"] = a;
      return o;
    },
    setBlendMode(m: number) {
      o["blend"] = m;
      return o;
    },
    setPosition: () => o,
    setDepth: () => o,
    setOrigin: () => o,
    setScale: () => o,
    setTint: () => o,
    destroy: () => o,
  };
  images.push(o);
  return o;
}

/**
 * A Graphics that answers ANY drawing call chainably.
 *
 * A hand-listed stub turns this file into whack-a-mole with the rig's drawing
 * vocabulary - `fillPoints`, then `fillEllipse`, then the next one somebody
 * adds - and none of those calls is what is being asserted here. The claims
 * are about TWEENS and SPRITES, so the pen is a proxy.
 */
function makeGraphics(): Record<string, unknown> {
  const state: Record<string, unknown> = { alpha: 1, x: 0, y: 0 };
  const g: Record<string, unknown> = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => g;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as Record<string, unknown>;
  return g;
}

function makeContainer(x = 0, y = 0): Record<string, unknown> {
  const c: Record<string, unknown> = {
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    list: [] as unknown[],
    add(child: unknown) {
      (c["list"] as unknown[]).push(child);
      return c;
    },
    setDepth: () => c,
    setName: () => c,
    setPosition: () => c,
    setScale: () => c,
    setAlpha: () => c,
    setVisible: () => c,
    destroy: () => c,
  };
  return c;
}

const scene = {
  // `drawLantern` bakes its textures on the way in. Nothing here reads a
  // pixel, so the cache only has to say "already have it".
  textures: { exists: () => true },
  make: { graphics: () => makeGraphics() },
  add: {
    graphics: () => makeGraphics(),
    container: (x: number, y: number) => makeContainer(x, y),
    image: (_x: number, _y: number, texture: string) => makeImage(texture),
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

const FLIGHT_SRC = readFileSync("src/game/scenes/FlightScene.ts", "utf8");
const fireBeamSrc = (): string => {
  const i = FLIGHT_SRC.indexOf("private fireBeam(");
  const j = FLIGHT_SRC.indexOf("\n  }", i);
  return FLIGHT_SRC.slice(i, j);
};

beforeEach(() => {
  tweens.length = 0;
  images.length = 0;
  vi.resetModules();
});

describe("the beam reads as light, not as a drawn line", () => {
  it("is composited additively, like the rig's own shaft", () => {
    // The rig sets ADD on its shaft (`render/lantern.paintShaft`); this is the
    // same claim for the gameplay beam, which used the default.
    expect(FLIGHT_SRC).toMatch(/this\.beam\.setBlendMode\(Phaser\.BlendModes\.ADD\)/);
  });

  it("draws three stacked strokes per frame, widest and faintest first", () => {
    const body = fireBeamSrc();
    const widths = [...body.matchAll(/lineStyle\(([^,]+),/g)].map((m) => m[1] ?? "");
    expect(widths.length, "a laser is a core inside a bloom, not one stroke").toBe(3);
    expect(body.match(/lineBetween\(/g)?.length).toBe(3);
    expect(widths[0]).toContain("bloom");
    expect(widths[1]).toContain("body");
    expect(widths[2]).toContain("core");
  });

  it("the falloff is a real falloff: each pass is wider than the one inside it", () => {
    const w = FLIGHT_SRC.match(
      /const BEAM_W = \{ bloom: (\d+(?:\.\d+)?), body: (\d+(?:\.\d+)?), core: (\d+(?:\.\d+)?) \}/,
    );
    expect(w, "BEAM_W is not declared in the shape this guard reads").not.toBeNull();
    const [bloom, body, core] = (w ?? []).slice(1).map(Number);
    expect(bloom).toBeGreaterThan(body ?? 0);
    expect(body).toBeGreaterThan(core ?? 0);
  });

  it("is on screen long enough to be seen, and overlaps its own muzzle flash", () => {
    const BEAM_MS = Number(FLIGHT_SRC.match(/const BEAM_MS = (\d+)/)?.[1]);
    const MUZZLE_MS = Number(
      readFileSync("src/game/render/lantern.ts", "utf8").match(/const MUZZLE_MS = (\d+)/)?.[1],
    );
    expect(Number.isFinite(BEAM_MS) && Number.isFinite(MUZZLE_MS)).toBe(true);
    // 80 ms was under five frames at 60 fps, and Expo.Out spends most of its
    // travel in the first third of them, so the beam was at width for about
    // one frame. It also has to land inside the flash, or the player sees two
    // events rather than a shot leaving a lamp.
    expect(BEAM_MS).toBeGreaterThanOrEqual(100);
    expect(BEAM_MS).toBeLessThanOrEqual(MUZZLE_MS);
  });

  it("fires the rig's flash, rather than drawing a fourth muzzle here", () => {
    expect(fireBeamSrc()).toMatch(/this\.lantern\.flash\(/);
    // The lens belongs to the rig, and the title screen's ship has the same
    // lens. A muzzle drawn in the scene would not be on that ship.
    expect(fireBeamSrc()).not.toMatch(/fillCircle\(origin/);
  });
});

describe("the muzzle flash does not fight the lamp's breath", () => {
  it("flashes a sprite that is not the one carrying the breathing tween", async () => {
    const { drawLantern } = await import("@game/render/lantern");
    const rig = drawLantern(scene, 0, 0, { beam: false, exhaust: false, idleBob: false });

    const breathing = tweens.filter((t) => t.config["repeat"] === -1);
    expect(breathing.length, "the lens should breathe").toBeGreaterThan(0);
    const breathingTargets = new Set(breathing.map((t) => t.config["targets"]));

    tweens.length = 0;
    rig.flash(1);

    const flash = tweens.find((t) => t.config["alpha"] === 0);
    expect(flash, "flash() started no tween").toBeDefined();
    expect(
      breathingTargets.has(flash?.config["targets"]),
      "the flash is animating the same object as the lamp's breath - two tweens, one alpha",
    ).toBe(false);
  });

  it("the muzzle is dark until it is asked for", async () => {
    const { drawLantern } = await import("@game/render/lantern");
    drawLantern(scene, 0, 0, { beam: false, exhaust: false, idleBob: false });
    // Every glow sprite the rig builds is either breathing or at zero. A muzzle
    // left visible would be a permanent flare on the lens on every screen.
    const dark = images.filter((i) => i["alpha"] === 0);
    expect(dark.length, "no sprite was built dark, so nothing is a muzzle").toBeGreaterThan(0);
  });

  it("a second shot replaces the live flash instead of stacking on it", async () => {
    const { drawLantern } = await import("@game/render/lantern");
    const rig = drawLantern(scene, 0, 0, { beam: false, exhaust: false, idleBob: false });
    tweens.length = 0;
    rig.flash(1);
    rig.flash(1);
    rig.flash(1);
    // A fast typist fires again inside the previous flash. Without the handle
    // the old tweens keep writing alpha and the lamp stutters.
    expect(tweens.filter((t) => t.removed).length).toBe(2);
  });

  it("is built even on a rig with no standing shaft, which is Flight's rig", async () => {
    // Flight passes `beam: false` (its beam is gameplay) and is the ONLY caller
    // that fires. Gating the muzzle on `options.beam` would leave the one
    // screen that shoots as the one screen with no muzzle.
    const { drawLantern } = await import("@game/render/lantern");
    const rig = drawLantern(scene, 0, 0, { beam: false, exhaust: false, idleBob: false });
    tweens.length = 0;
    rig.flash(1);
    expect(tweens.length).toBeGreaterThan(0);
  });
});
