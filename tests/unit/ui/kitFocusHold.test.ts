import { beforeEach, describe, expect, it, vi } from "vitest";
// TYPE-ONLY, so it is erased before `vi.mock("phaser")` matters. The VALUES
// come from the dynamic import below, after the mock is installed.
import type { FocusRing, FocusTarget, KeyboardMenu } from "@game/scenes/lib/kit";

/**
 * THE SEVEN STORY SCREENS GROW A FOCUSED CONTROL TOO (UR-111).
 *
 * ================== THE DEFECT ==================
 * UR-110 made "focused" mean "bigger, for as long as it is focused" - but only
 * in `ui/controls.ts`, which dresses five screens. The other seven (Map,
 * Briefing, Results, Beacon, Ending, Earth activation, Warp) are drawn by
 * `scenes/lib/kit.ts`, where a control is not an object at all: the scene draws
 * its own plate and its own label and hands `createKeyboardMenu` a bare
 * `{x, y, w, h}`. There was nothing to scale, so those screens had no focus
 * growth of any kind - focus was the ring's alpha and nothing else - and a
 * child walking Title -> Map -> Briefing met three different answers to "what
 * does focused look like" inside six seconds.
 *
 * This file is the kit half of `focusHold.test.ts`, and it asks the same
 * questions of the same state machine: at REST, which is the state a child
 * actually looks at, is the focused control bigger, is it still bigger once the
 * pointer has moved away, and is it the ONLY one.
 *
 * ================== WHY PHASER IS STUBBED ==================
 * Same reason as `focusHold.test.ts`: the claim is about two objects at one
 * moment, which no regex over the source can see, and `settle()` below is what
 * makes a held scale distinguishable from a yoyoed one - the fake tween engine
 * applies each tween's RESTING value, and a yoyo rests where it started.
 *
 * The scene the test draws is deliberately the real thing: `kit.plate` and
 * `kit.label`, exactly as Briefing, Ending, Beacon and the map's chips draw
 * their controls, so what is being proved is that the kit can FIND a control it
 * was only given a rectangle for.
 *
 * ================== WATCHED FAILING ==================
 * (printed values recorded in the report for this change)
 */

// ---------------------------------------------------------------------------
// A Phaser stand-in. Honest about two things: where a tween leaves its target,
// and what `getBounds` says after an origin has been set.
// ---------------------------------------------------------------------------

const RESERVED = new Set([
  "targets", "duration", "ease", "yoyo", "repeat", "delay", "hold",
  "onComplete", "onUpdate",
]);

const live: { config: Record<string, unknown>; removed: boolean }[] = [];

function settle(): void {
  for (const entry of live) {
    if (entry.removed) continue;
    const cfg = entry.config;
    const raw = cfg["targets"];
    const targets = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
    for (const target of targets) {
      for (const [key, value] of Object.entries(cfg)) {
        if (RESERVED.has(key)) continue;
        const spec = value as { from?: number; to?: number } | number;
        const isRange = typeof spec === "object" && spec !== null;
        const from = isRange ? spec.from : undefined;
        const to = isRange ? spec.to : (spec as number);
        if (cfg["yoyo"] === true) {
          if (from !== undefined) target[key] = from;
        } else if (to !== undefined) {
          target[key] = to;
        }
      }
    }
  }
  live.length = 0;
}

class FakeObject {
  x = 0;
  y = 0;
  depth = 0;
  name = "";
  alpha = 1;
  scaleX = 1;
  scaleY = 1;
  parentContainer: FakeContainer | null = null;
  scene: unknown = null;
  setName(n: string): this { this.name = n; return this; }
  setDepth(d: number): this { this.depth = d; return this; }
  setAlpha(a: number): this { this.alpha = a; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setScale(s: number): this { this.scaleX = s; this.scaleY = s; return this; }
  destroy(): void {
    this.parentContainer?.remove(this);
    const i = display.indexOf(this as never);
    if (i >= 0) display.splice(i, 1);
  }
  /** Translation only, which is all any parent in this game applies. */
  getWorldTransformMatrix(): { transformPoint: (x: number, y: number) => { x: number; y: number }; applyInverse: (x: number, y: number) => { x: number; y: number } } {
    let dx = this.x;
    let dy = this.y;
    let p = this.parentContainer;
    while (p !== null) { dx += p.x; dy += p.y; p = p.parentContainer; }
    return {
      transformPoint: (x: number, y: number) => ({ x: x + dx, y: y + dy }),
      applyInverse: (x: number, y: number) => ({ x: x - dx, y: y - dy }),
    };
  }
}

class FakeContainer extends FakeObject {
  list: FakeObject[] = [];
  add(objs: FakeObject | FakeObject[]): this {
    for (const obj of Array.isArray(objs) ? objs : [objs]) {
      obj.parentContainer?.remove(obj);
      const i = display.indexOf(obj as never);
      if (i >= 0) display.splice(i, 1);
      obj.parentContainer = this;
      this.list.push(obj);
    }
    return this;
  }
  remove(obj: FakeObject): this {
    const i = this.list.indexOf(obj);
    if (i >= 0) this.list.splice(i, 1);
    if (obj.parentContainer === this) obj.parentContainer = null;
    return this;
  }
  override destroy(): void {
    for (const child of [...this.list]) child.destroy();
    super.destroy();
  }
}

class FakeGraphics extends FakeObject {
  clear(): this { return this; }
  fillStyle(): this { return this; }
  fillRoundedRect(): this { return this; }
  fillRect(): this { return this; }
  lineStyle(): this { return this; }
  strokeRoundedRect(): this { return this; }
  lineBetween(): this { return this; }
  setVisible(): this { return this; }
}

class FakeText extends FakeObject {
  width = 0;
  height = 0;
  text = "";
  originX = 0;
  originY = 0;
  setOrigin(x: number, y?: number): this { this.originX = x; this.originY = y ?? x; return this; }
  setLineSpacing(): this { return this; }
  setLetterSpacing(): this { return this; }
  setText(t: string): this { this.text = t; return this; }
  setColor(): this { return this; }
  getBounds(): { x: number; y: number; width: number; height: number } {
    const m = this.getWorldTransformMatrix().transformPoint(0, 0);
    return {
      x: m.x - this.width * this.originX,
      y: m.y - this.height * this.originY,
      width: this.width,
      height: this.height,
    };
  }
}

class FakeZone extends FakeObject {
  width = 0;
  height = 0;
  handlers = new Map<string, (...args: unknown[]) => void>();
  setOrigin(): this { return this; }
  setInteractive(): this { return this; }
  disableInteractive(): this { return this; }
  on(event: string, fn: (...args: unknown[]) => void): this {
    this.handlers.set(event, fn);
    return this;
  }
}

class FakeVector2 { x = 0; y = 0; }

vi.mock("phaser", () => ({
  default: {
    GameObjects: {
      Container: FakeContainer,
      Graphics: FakeGraphics,
      Text: FakeText,
      Zone: FakeZone,
      GameObject: FakeObject,
    },
    Math: { Vector2: FakeVector2 },
    Scenes: { Events: { SHUTDOWN: "shutdown" } },
    Tweens: {},
  },
}));

// `lib/typography` reaches for the running game's store; there is none here and
// it is documented never to throw, but the import chain would pull the whole of
// `boot.ts` into a unit test, so it is cut here.
vi.mock("@game/boot", () => ({
  services: () => {
    throw new Error("no services in a unit test");
  },
}));

const display: FakeObject[] = [];

const scene = {
  children: { list: display, add: (obj: FakeObject) => { display.push(obj); return obj; } },
  add: {
    container(x = 0, y = 0) {
      const c = new FakeContainer();
      c.x = x; c.y = y;
      display.push(c);
      return c;
    },
    graphics() { const g = new FakeGraphics(); display.push(g); return g; },
    text(x: number, y: number, content: string, style: { fontSize: string }) {
      const t = new FakeText();
      t.x = x; t.y = y; t.text = content;
      const size = Number.parseFloat(style.fontSize);
      // Enough of a metric to be a real box, and narrow enough to sit inside
      // the plates these screens draw.
      t.width = content.length * size * 0.5;
      t.height = size * 1.2;
      display.push(t);
      return t;
    },
    zone(x: number, y: number, w: number, h: number) {
      const z = new FakeZone();
      z.x = x; z.y = y; z.width = w; z.height = h;
      display.push(z);
      return z;
    },
  },
  tweens: {
    add(config: Record<string, unknown>) {
      const entry = { config, removed: false };
      live.push(entry);
      return { remove() { entry.removed = true; } };
    },
  },
  input: { keyboard: { on() {}, off() {} } },
  events: { emit() {} },
};

const kit = await import("@game/scenes/lib/kit");
const { SPACE, TYPE, INK } = await import("@game/ui/theme");
const { HIT_ZONE_PREFIX } = await import("@game/ui/focus");
const { FOCUS_POP } = await import("@game/ui/focusPop");

type Rect = { x: number; y: number; w: number; h: number };

/** A ring that records, standing in for the one every screen builds. */
function fakeRing(): FocusRing {
  const g = scene.add.graphics().setDepth(40);
  return {
    graphics: g as never,
    moveTo() {},
    fadeOut() {},
    destroy() {},
  };
}

/**
 * Draw a control the way the story screens do: a plate, and a label centred on
 * it. Neither is handed to the menu - only the rectangle is.
 */
function drawControl(r: Rect, label: string): void {
  kit.plate(scene as never, r.x, r.y, r.w, r.h, { fill: INK.panelRaised });
  kit
    .label(scene as never, r.x + r.w / 2, r.y + r.h / 2, label, {
      size: TYPE.label,
      color: INK.text,
      align: "center",
      lang: "en",
    })
    .setOrigin(0.5);
}

function popOf(id: string): FakeContainer | undefined {
  const found = display.find((o) => o.name === `kb-pop:${id}`);
  return found instanceof FakeContainer ? found : undefined;
}

/** The box the control actually occupies right now, after the pop. */
function drawnBox(target: FocusTarget): Rect {
  const pop = popOf(target.id);
  if (pop === undefined) return { ...target } as Rect;
  const s = pop.scaleX;
  const cx = pop.x;
  const cy = pop.y;
  return {
    x: cx + (target.x - cx) * s,
    y: cy + (target.y - cy) * s,
    w: target.w * s,
    h: target.h * s,
  };
}

const widthOf = (t: FocusTarget): number => Number(drawnBox(t).w.toFixed(3));

function hover(id: string): void {
  const zone = display.find((o) => o.name === `${HIT_ZONE_PREFIX}${id}`);
  if (!(zone instanceof FakeZone)) throw new Error(`no hit zone named ${id}`);
  const handler = zone.handlers.get("pointerover");
  if (handler === undefined) throw new Error(`hit zone ${id} does not answer the pointer`);
  handler();
}

function reset(): void {
  display.length = 0;
  live.length = 0;
}

const ALPHA: Rect = { x: 300, y: 200, w: 420, h: 88 };
const BRAVO: Rect = { x: 300, y: 340, w: 420, h: 88 };

function twoButtonScreen(): { menu: KeyboardMenu; a: FocusTarget; b: FocusTarget } {
  drawControl(ALPHA, "continue");
  drawControl(BRAVO, "fly it again");
  const a: FocusTarget = { id: "alpha", ...ALPHA, activate: () => {} };
  const b: FocusTarget = { id: "bravo", ...BRAVO, activate: () => {} };
  const menu = kit.createKeyboardMenu(scene as never, fakeRing(), [a, b], {
    onBack: () => {},
  });
  return { menu, a, b };
}

describe("UR-111: the story screens hold a focused control grown", () => {
  let a: FocusTarget;
  let b: FocusTarget;

  beforeEach(() => {
    reset();
    const built = twoButtonScreen();
    a = built.a;
    b = built.b;
    settle();
  });

  it("finds a control it was only given a rectangle for", () => {
    // The whole reason these screens had no growth: the scene draws loose
    // graphics and text and the kit is handed four numbers. If this is null
    // there is nothing to scale and every assertion below is vacuous.
    const pop = popOf("alpha");
    expect(pop, "the kit did not find the plate and label drawn at the target").toBeDefined();
    expect(pop?.list.length, "the label was left behind, so it would not grow with its plate").toBe(2);
  });

  it("holds the focused control grown once its tween has settled", () => {
    expect(
      widthOf(a),
      "the focused control is back at its unfocused size, so growing on focus " +
        "is a flourish rather than a state",
    ).toBeGreaterThan(a.w);
    expect(widthOf(b)).toBeCloseTo(b.w, 3);
  });

  it("keeps a hovered control grown after the pointer has left it", () => {
    hover("bravo");
    settle();
    const grown = widthOf(b);
    expect(grown).toBeGreaterThan(b.w);
    // The pointer is now somewhere with no control under it. No event fires,
    // time passes, tweens settle again. There is no `pointerout` in this game.
    settle();
    expect(
      widthOf(b),
      "the control shrank back with the pointer gone even though it still has focus",
    ).toBeCloseTo(grown, 3);
  });

  it("shrinks a control back the moment another one takes focus", () => {
    hover("bravo");
    settle();
    expect(widthOf(b)).toBeGreaterThan(b.w);
    hover("alpha");
    settle();
    expect(
      widthOf(b),
      "the control that lost focus is still grown, so two controls read as active",
    ).toBeCloseTo(b.w, 3);
    expect(widthOf(a)).toBeGreaterThan(a.w);
  });

  it("never has two controls grown at once, however fast focus moves", () => {
    const grownCount = (): number =>
      [a, b].filter((t) => widthOf(t) > t.w + 0.001).length;
    for (const id of ["bravo", "alpha", "bravo", "bravo", "alpha"]) {
      hover(id);
      settle();
      expect(grownCount(), `two controls are grown at once after hovering ${id}`).toBe(1);
    }
  });

  it("grows about its own centre, so the plate does not drift right", () => {
    const before = drawnBox(b);
    hover("bravo");
    settle();
    const after = drawnBox(b);
    const leftGrowth = before.x - after.x;
    const rightGrowth = after.x + after.w - (before.x + before.w);
    expect(
      leftGrowth,
      "the pop is anchored at the top-left, so the control drifts right instead of swelling",
    ).toBeCloseTo(rightGrowth, 3);
    expect(leftGrowth).toBeGreaterThan(0);
  });

  it("keeps the declared rectangle still while the drawn box grows", () => {
    // The ring is struck around the target and the hit zone is built from it.
    // If the pop fed back into either, the ring would swell with the control it
    // is a reference for and the button's edge would move under the cursor.
    const zone = display.find((o) => o.name === `${HIT_ZONE_PREFIX}alpha`) as FakeZone;
    const before = { x: zone.x, y: zone.y, w: zone.width, h: zone.height };
    hover("bravo");
    settle();
    hover("alpha");
    settle();
    expect({ x: zone.x, y: zone.y, w: zone.width, h: zone.height }).toEqual(before);
    expect({ x: a.x, y: a.y, w: a.w, h: a.h }).toEqual(ALPHA);
  });

  it("names the pop container so a probe can measure it", () => {
    expect(popOf("alpha")?.name).toBe("kb-pop:alpha");
  });
});

describe("UR-111: what never swells", () => {
  beforeEach(reset);

  it("never swells across its own focus ring, at any control width", () => {
    const clearance = SPACE.focusRingOffset - SPACE.focusRingWidth / 2;
    for (const w of [220, 420, 640, 900, 1200]) {
      reset();
      const r: Rect = { x: 200, y: 300, w, h: 88 };
      drawControl(r, "go");
      const t: FocusTarget = { id: `w${w}`, ...r, activate: () => {} };
      kit.createKeyboardMenu(scene as never, fakeRing(), [t], { onBack: () => {} });
      settle();
      const growthPerSide = (drawnBox(t).w - r.w) / 2;
      expect(growthPerSide).toBeGreaterThan(0);
      expect(
        growthPerSide,
        `a ${w}px control swells ${growthPerSide.toFixed(2)}px past each edge, ` +
          `crossing the ${clearance}px gap to its own focus ring`,
      ).toBeLessThanOrEqual(clearance + 1e-6);
    }
    expect(FOCUS_POP.maxGrowPx).toBe(clearance);
  });

  it("leaves a locked target at its base size, focused or not", () => {
    // Locked is readable, focusable and NOT actionable (D73). Growing it would
    // promise an Enter that does nothing - the same rule `ui/controls.ts` holds.
    const r: Rect = { x: 200, y: 300, w: 420, h: 88 };
    drawControl(r, "pluto");
    const t: FocusTarget = { id: "locked", ...r, locked: true };
    kit.createKeyboardMenu(scene as never, fakeRing(), [t], { onBack: () => {} });
    settle();
    expect(widthOf(t)).toBeCloseTo(r.w, 3);
  });

  it("leaves a target that opted out alone, and its neighbour untouched", () => {
    // The Director map's seven planets (`pop: false`). A disc, a beacon and a
    // glow are not plates, so the kit could only find the CAPTION - a name that
    // swelled while the world it names stayed put.
    const planet: Rect = { x: 120, y: 300, w: 240, h: 200 };
    const chip: Rect = { x: 900, y: 74, w: 262, h: 66 };
    drawControl(planet, "mars");
    drawControl(chip, "beacon log");
    const stop: FocusTarget = { id: "mars", ...planet, pop: false };
    const log: FocusTarget = { id: "beaconLog", ...chip, activate: () => {} };
    kit.createKeyboardMenu(scene as never, fakeRing(), [stop, log], { onBack: () => {} });
    settle();
    expect(popOf("mars"), "a stop was wrapped despite opting out").toBeUndefined();
    expect(widthOf(stop)).toBeCloseTo(planet.w, 3);
    hover("beaconLog");
    settle();
    expect(widthOf(log), "the chip beside it stopped growing too").toBeGreaterThan(chip.w);
  });

  it("does not claim the same drawing for two overlapping targets", () => {
    const outer: Rect = { x: 200, y: 200, w: 420, h: 88 };
    drawControl(outer, "one");
    const first: FocusTarget = { id: "first", ...outer, activate: () => {} };
    const second: FocusTarget = { id: "second", ...outer, activate: () => {} };
    kit.createKeyboardMenu(scene as never, fakeRing(), [first, second], { onBack: () => {} });
    settle();
    expect(popOf("first")?.list.length).toBe(2);
    expect(popOf("second"), "one plate was lifted into two containers").toBeUndefined();
  });
});

describe("UR-111: the way out is one control, and it answers the pointer", () => {
  beforeEach(reset);

  it("drops a second hit zone struck on the same rectangle", () => {
    // THE BRIEFING DREW TWO WAYS OUT OF ITSELF. `drawBackChip` owns a
    // `kb-hit:briefing-back` zone and the scene also declares a `back` target
    // on the identical rectangle, so the menu built a second zone over the
    // first: two hand cursors on one chip, and a screen whose hit areas are no
    // longer its focusable set - which is the only thing `pointer.spec.ts`
    // checks.
    kit.drawBackChip(scene as never, {
      depth: 21,
      label: "back to the map",
      lang: "en",
      hitId: "briefing-back",
      onPress: () => {},
    });
    const chip = kit.backChipTarget("back", () => {});
    kit.createKeyboardMenu(scene as never, fakeRing(), [chip], { onBack: () => {} });
    settle();
    const names = display
      .filter((o) => o.name.startsWith(HIT_ZONE_PREFIX))
      .map((o) => o.name);
    expect(names, "the chip still owns a duplicate hit area").toEqual([
      `${HIT_ZONE_PREFIX}back`,
    ]);
  });

  it("makes the chip a real focus target, not a click-only control", () => {
    // `ui/focus.ts`: "to be clickable you must be in the focus list". This chip
    // bound `pointerdown` and nothing else - the only control in the game the
    // pointer could press without the screen ever admitting it was there.
    kit.drawBackChip(scene as never, {
      depth: 21,
      label: "back to the map",
      lang: "en",
      hitId: "briefing-back",
      onPress: () => {},
    });
    const chip = kit.backChipTarget("back", () => {});
    const menu = kit.createKeyboardMenu(scene as never, fakeRing(), [
      { id: "launch", x: 700, y: 900, w: 420, h: 88, primary: true, activate: () => {} },
      chip,
    ], { onBack: () => {} });
    settle();
    expect(menu.index, "the screen did not open on its forward action").toBe(0);
    hover("back");
    settle();
    expect(menu.index, "hovering the way out did not move focus to it").toBe(1);
  });

  it("focuses the chip on hover when the screen has no menu of its own", () => {
    let focused = 0;
    kit.drawBackChip(scene as never, {
      depth: 20,
      label: "back to the map",
      lang: "en",
      hitId: "preflight-back",
      onFocus: () => { focused += 1; },
      onPress: () => {},
    });
    const zone = display.find(
      (o) => o.name === `${HIT_ZONE_PREFIX}preflight-back`,
    ) as FakeZone;
    zone.handlers.get("pointerover")?.();
    expect(focused, "hovering the chip did not ask the screen for focus").toBe(1);
  });
});
