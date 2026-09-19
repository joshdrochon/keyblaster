import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FOCUSED CONTROL STAYS GROWN UNTIL SOMETHING ELSE TAKES FOCUS (UR-110).
 *
 * ================== THE DEFECT ==================
 * `Control.setFocused` popped the container to 1.015 with `yoyo: true`. A yoyo
 * returns to where it started, so the button grew and shrank back inside
 * 2 x DUR.focus = 280 ms and the RESTING size of a focused control was
 * identical to the resting size of every unfocused one. The project owner
 * reported it as "buttons grow on hover, then shrink back immediately".
 *
 * Size was therefore not a focus signal at all - it was a transient flourish
 * fired at the moment focus arrived. Everything below is about the state at
 * REST, because rest is the state a child actually looks at.
 *
 * ================== WHY PHASER IS STUBBED ==================
 * `ui/controls.ts` imports Phaser and cannot load under vitest's node
 * environment, which is why several of its siblings are tested by regex over
 * the source. A regex cannot tell a held scale from a yoyoed one without
 * pinning the exact text of a tween config, and it can say nothing at all
 * about "two controls are never grown at once", which is a claim about two
 * objects at one moment. So Phaser is stubbed and the REAL classes are driven
 * through the REAL `FocusList`.
 *
 * `settle()` below is the whole trick: the fake tween engine applies each
 * tween's RESTING value, and a yoyoed tween rests where it started. That is
 * what makes the defect measurable instead of a matter of reading the config.
 *
 * ================== WATCHED FAILING ==================
 * (printed values recorded in the report for this change)
 */

vi.mock("phaser", () => ({ default: { GameObjects: {}, Tweens: {}, Scene: class {} } }));

// ---------------------------------------------------------------------------
// A Phaser stand-in small enough to read, honest about the one thing that
// matters here: where a tween LEAVES its target.
// ---------------------------------------------------------------------------

/** Keys of a tween config that are settings, not animated properties. */
const RESERVED = new Set([
  "targets",
  "duration",
  "ease",
  "yoyo",
  "repeat",
  "delay",
  "hold",
  "onComplete",
  "onUpdate",
]);

interface Tweenable {
  [key: string]: unknown;
}

const live: { config: Record<string, unknown>; removed: boolean }[] = [];

/**
 * Where a tween leaves its target.
 *
 * A yoyo goes out and comes BACK, so it rests at the value the property held
 * when the tween was created (or at `from`, when one was given). A one-way
 * tween rests at `to`. Nothing here interpolates: only the resting value is
 * ever asserted on.
 */
function settle(): void {
  for (const entry of live) {
    if (entry.removed) continue;
    const cfg = entry.config;
    const raw = cfg["targets"];
    const targets = (Array.isArray(raw) ? raw : [raw]) as Tweenable[];
    for (const target of targets) {
      for (const [key, value] of Object.entries(cfg)) {
        if (RESERVED.has(key)) continue;
        const spec = value as { from?: number; to?: number } | number;
        const isRange = typeof spec === "object" && spec !== null;
        const from = isRange ? spec.from : undefined;
        const to = isRange ? spec.to : (spec as number);
        if (cfg["yoyo"] === true) {
          if (from !== undefined) target[key] = from;
          // else: it rests exactly where it already was, so nothing to do.
        } else if (to !== undefined) {
          target[key] = to;
        }
      }
    }
  }
  live.length = 0;
}

function makeContainer(x: number, y: number): Record<string, unknown> {
  const c: Record<string, unknown> = {
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    depth: 0,
    name: "",
    list: [] as unknown[],
    add() {
      return c;
    },
    bringToTop() {
      return c;
    },
    setDepth(d: number) {
      c["depth"] = d;
      return c;
    },
    setPosition(nx: number, ny: number) {
      c["x"] = nx;
      c["y"] = ny;
      return c;
    },
    setName(n: string) {
      c["name"] = n;
      return c;
    },
    setScale(s: number) {
      c["scaleX"] = s;
      c["scaleY"] = s;
      return c;
    },
    destroy() {
      return c;
    },
  };
  // A real Container's `scale` writes both axes; the pop tween uses it.
  Object.defineProperty(c, "scale", {
    get() {
      return c["scaleX"];
    },
    set(s: number) {
      c["scaleX"] = s;
      c["scaleY"] = s;
    },
  });
  return c;
}

const graphicsStub = (): Record<string, unknown> => {
  const g: Record<string, unknown> = {};
  for (const m of [
    "clear",
    "fillStyle",
    "fillRoundedRect",
    "fillRect",
    "fillCircle",
    "lineStyle",
    "strokeRoundedRect",
    "strokeRect",
    "strokeCircle",
    "beginPath",
    "moveTo",
    "lineTo",
    "closePath",
    "strokePath",
    "fillPath",
    "setDepth",
    "setAlpha",
    "setPosition",
    "setName",
    "destroy",
    "setScale",
  ]) {
    g[m] = () => g;
  }
  return g;
};

const textStub = (content: string, size: number): Record<string, unknown> => {
  const t: Record<string, unknown> = {
    // Enough of a metric that `plateWidth`'s content-sizing is exercised.
    width: content.length * size * 0.52,
    height: size * 1.2,
    text: content,
    x: 0,
    y: 0,
  };
  for (const m of [
    "setColor",
    "setAlpha",
    "setText",
    "setOrigin",
    "setDepth",
    "setLetterSpacing",
    "setName",
    "destroy",
  ]) {
    t[m] = () => t;
  }
  t["setPosition"] = (x: number, y: number) => {
    t["x"] = x;
    t["y"] = y;
    return t;
  };
  return t;
};

/** Every hit zone the kit built, by the id it was named with. */
const zones = new Map<string, Map<string, () => void>>();
const containers: Record<string, unknown>[] = [];

const scene = {
  add: {
    container(x: number, y: number) {
      const c = makeContainer(x, y);
      containers.push(c);
      return c;
    },
    graphics: () => graphicsStub(),
    text: (_x: number, _y: number, content: string, style: { fontSize: string }) =>
      textStub(content, Number.parseFloat(style.fontSize)),
    rectangle: () => graphicsStub(),
    zone(_x: number, _y: number, _w: number, _h: number) {
      const handlers = new Map<string, () => void>();
      let id = "";
      const z: Record<string, unknown> = {
        on(event: string, fn: () => void) {
          handlers.set(event, fn);
          return z;
        },
      };
      for (const m of ["setOrigin", "setDepth", "setInteractive", "disableInteractive", "destroy"]) {
        z[m] = () => z;
      }
      z["setName"] = (n: string) => {
        id = n.replace("kb-hit:", "");
        zones.set(id, handlers);
        return z;
      };
      return z;
    },
  },
  tweens: {
    add(config: Record<string, unknown>) {
      const entry = { config, removed: false };
      live.push(entry);
      return {
        remove() {
          entry.removed = true;
        },
      };
    },
  },
};

const { Control, MenuButton } = await import("@game/ui/controls");
const { FocusList } = await import("@game/ui/focus");
const { SPACE } = await import("@game/ui/theme");

type AnyControl = InstanceType<typeof MenuButton>;

const STYLE = {
  lang: "en" as const,
  uppercase: false,
  increasedLetterSpacing: false,
  accent: "#FFC857",
};

/**
 * The box the control actually occupies on screen right now: its layout box
 * scaled by whatever the pop left the container at, about the control's centre.
 *
 * This is the measurement the whole file is about. `ringBounds()` deliberately
 * is NOT it - that one is the LAYOUT box and must never breathe, because six
 * scenes stack their rows off it.
 */
function drawnBox(control: AnyControl): { x: number; y: number; w: number; h: number } {
  const base = control.ringBounds();
  const pop = containers.find(
    (c) => c["name"] === `kb-pop:${(control as unknown as { id: string }).id}`,
  );
  const sx = (pop?.["scaleX"] as number | undefined) ?? 1;
  const sy = (pop?.["scaleY"] as number | undefined) ?? 1;
  const w = base.w * sx;
  const h = base.h * sy;
  return {
    x: base.x + (pop?.["x"] as number | undefined ?? 0),
    y: base.y + (pop?.["y"] as number | undefined ?? 0),
    w,
    h,
  };
}

const widthOf = (c: AnyControl): number => Number(drawnBox(c).w.toFixed(3));

function build(id: string, y: number, minWidth = 320): AnyControl {
  return new MenuButton(scene as never, STYLE as never, id, 100, y, 5, {
    label: id,
    minWidth,
    onPress: () => {},
  });
}

function hover(id: string): void {
  const handler = zones.get(id)?.get("pointerover");
  if (handler === undefined) throw new Error(`no hit zone named ${id}`);
  handler();
}

describe("UR-110: size is a state, not a flourish", () => {
  let list: InstanceType<typeof FocusList>;
  let a: AnyControl;
  let b: AnyControl;
  let baseA = 0;
  let baseB = 0;

  beforeEach(() => {
    live.length = 0;
    zones.clear();
    containers.length = 0;
    a = build("alpha", 200);
    b = build("bravo", 300);
    baseA = a.ringBounds().w;
    baseB = b.ringBounds().w;
    list = new FocusList();
    list.setItems([a, b]);
    settle();
  });

  it("holds the focused control grown once its tween has settled", () => {
    // `setItems` focuses index 0. After every tween has run to rest, alpha is
    // still bigger than it was and bravo is untouched.
    expect(
      widthOf(a),
      "the focused control is back at its unfocused size, so growing on focus " +
        "is a flourish rather than a state",
    ).toBeGreaterThan(baseA);
    expect(widthOf(b)).toBeCloseTo(baseB, 3);
  });

  it("keeps a hovered control grown after the pointer has left it", () => {
    // Hover bravo, then take the pointer off the screen entirely. Nothing else
    // asked for focus, so bravo still holds it - and therefore still holds its
    // size. There is no `pointerout` in this UI by design; this is the test
    // that says so in terms of what the player sees.
    hover("bravo");
    settle();
    const grown = widthOf(b);
    expect(grown).toBeGreaterThan(baseB);

    // The pointer is now somewhere with no control under it. No event fires,
    // time passes, tweens settle again.
    settle();
    expect(
      widthOf(b),
      "the control shrank back with the pointer gone even though it still has focus",
    ).toBeCloseTo(grown, 3);
  });

  it("shrinks a control back the moment another one takes focus", () => {
    hover("bravo");
    settle();
    expect(widthOf(b)).toBeGreaterThan(baseB);

    hover("alpha");
    settle();
    expect(
      widthOf(b),
      "the control that lost focus is still grown, so two controls read as active",
    ).toBeCloseTo(baseB, 3);
    expect(widthOf(a)).toBeGreaterThan(baseA);
  });

  it("never has two controls grown at once, however fast focus moves", () => {
    const grownCount = (): number =>
      [a, b].filter((c, i) => widthOf(c) > (i === 0 ? baseA : baseB) + 0.001).length;

    for (const id of ["bravo", "alpha", "bravo", "bravo", "alpha"]) {
      hover(id);
      settle();
      expect(grownCount(), `two controls are grown at once after hovering ${id}`).toBe(1);
    }
  });

  it("grows about its own centre, so the plate does not drift right", () => {
    // A container scales about its own origin, which is its TOP-LEFT. Held,
    // that puts all of the growth on the right and bottom and none on the left
    // and top - a focused row visibly out of line with the rows above it.
    // `beforeEach` leaves alpha focused, so take the base reading with focus
    // parked on bravo and the grown reading after alpha takes it back.
    list.focus("bravo");
    settle();
    const before = drawnBox(a);
    list.focus("alpha");
    settle();
    const after = drawnBox(a);
    const leftGrowth = before.x - after.x;
    const rightGrowth = after.x + after.w - (before.x + before.w);
    expect(
      leftGrowth,
      "the pop is anchored at the top-left, so the control drifts right instead of swelling",
    ).toBeCloseTo(rightGrowth, 3);
    expect(leftGrowth).toBeGreaterThan(0);
  });

  it("never swells across its own focus ring, at any control width", () => {
    // The ring is stroked `focusRingOffset` outside the layout box with
    // `focusRingWidth`, centred on the path - so there are
    // `offset - width / 2` px of clear air between plate and ring. A held pop
    // that is a flat PERCENTAGE crosses that on a wide control while barely
    // showing on a narrow one.
    const clearance = SPACE.focusRingOffset - SPACE.focusRingWidth / 2;
    for (const w of [220, 420, 640, 900, 1200]) {
      live.length = 0;
      zones.clear();
      containers.length = 0;
      const wide = build(`w${w}`, 400, w);
      const l = new FocusList();
      l.setItems([wide]);
      settle();
      const growthPerSide = (drawnBox(wide).w - wide.ringBounds().w) / 2;
      expect(growthPerSide).toBeGreaterThan(0);
      expect(
        growthPerSide,
        `a ${wide.ringBounds().w}px control swells ${growthPerSide.toFixed(2)}px past ` +
          `each edge, crossing the ${clearance}px gap to its own focus ring`,
      ).toBeLessThanOrEqual(clearance + 1e-6);
    }
  });

  it("leaves a locked control at its base size, focused or not", () => {
    // Locked is readable, focusable and NOT actionable (D73). Growing it would
    // promise an Enter that does nothing.
    const locked = build("locked", 500);
    (locked as unknown as { locked: boolean }).locked = true;
    const l = new FocusList();
    l.setItems([locked]);
    settle();
    expect(widthOf(locked)).toBeCloseTo(locked.ringBounds().w, 3);
  });

  it("keeps the layout box still while the drawn box grows", () => {
    // Six scenes stack their rows off `ringBounds().h`. If the pop fed back
    // into it, focusing a row would reflow the screen under the child.
    const before = { ...a.ringBounds() };
    list.focus("bravo");
    settle();
    list.focus("alpha");
    settle();
    expect(a.ringBounds()).toEqual(before);
  });

  it("exports the pop container's name so a probe can measure it", () => {
    // Same reason hit zones are named (`HIT_ZONE_PREFIX`): a browser probe has
    // to be able to find the thing it is measuring without guessing at the
    // scene graph's shape.
    expect(Control.POP_NAME_PREFIX).toBe("kb-pop:");
  });
});
