import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE GOLD OUTLINE AROUND A FOCUSED CONTROL, AND IT BREATHES (UR-112).
 *
 * ================== THE DEFECT ==================
 * The project owner, looking at the profile picker: "there appear to be two
 * concentric yellow outlines around New Pilot ... a strange hollow double
 * line". `chrome.FocusRing` draws exactly one stroke and has since UR-82 took
 * its halo away for this same complaint, so the second line was not the ring's.
 *
 * It was the CONTROL'S OWN BORDER. `Control.paintPlate` stroked the plate in
 * `style.accent` at 3 px whenever the control was focused, and `FocusRing`
 * strokes `INK.accent` at `SPACE.focusRingWidth` px, `SPACE.focusRingOffset` px
 * outside the same box. On this screen `paletteStop()` is `earth` and Earth's
 * palette accent is `#FFC857`, which is `INK.accent` to the byte - so a focused
 * control was two identical gold outlines with a strip of sky between them.
 *
 * The plate keeps the quiet `INK.line` border it wears when it is not focused,
 * which is what the Director map's Beacon Log and Settings chips have always
 * done: their plate is `INK.panelRaised` with the default line, and the accent
 * belongs to the RING. Focus is still carried by three things - the ring, the
 * raised fill and the held 1.5% swell - and now by one gold line instead of two.
 *
 * ================== WHY PHASER IS STUBBED ==================
 * `ui/controls.ts` and `ui/chrome.ts` both import Phaser and cannot load under
 * vitest's node environment, which is why several of their siblings are tested
 * by regex over the source. A regex cannot COUNT the strokes two files make at
 * one moment, which is the whole claim here. So Phaser is stubbed and the REAL
 * classes are driven, the way `focusHold.test.ts` and `focusRingTravel.test.ts`
 * already do.
 *
 * ================== WATCHED FAILING ==================
 * (printed values recorded in the report for this change)
 */

vi.mock("phaser", () => ({
  default: {
    GameObjects: {},
    Tweens: {},
    Scene: class {},
    // `scenes/lib/kit` pulls in the Lantern, which reads `Phaser.Math` at
    // import time. Nothing below uses it; it only has to exist.
    Math: { DegToRad: (deg: number) => (deg * globalThis.Math.PI) / 180 },
    // The cockpit kit builds real point lists for the knob's pointer and the
    // avatar marks. A plain {x, y} is all any of it reads back.
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

// `lib/typography` reaches for the running game's store. Cut here for the same
// reason `kitFocusHold.test.ts` cuts it: the import chain would otherwise pull
// the whole of `boot.ts` into a unit test.
vi.mock("@game/boot", () => ({
  services: () => {
    throw new Error("no services in a unit test");
  },
}));

interface Stroke {
  readonly color: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface TweenEntry {
  readonly config: Record<string, unknown>;
  removed: boolean;
}

const tweens: TweenEntry[] = [];

/**
 * A Graphics that remembers every rounded rect it was asked to stroke, and
 * every ink it was ever set to.
 *
 * TWO LOGS, because the two claims need different evidence. `strokes` answers
 * "how many outlines are concentric with the control's box" - the defect. `inks`
 * answers "did the accent reach this control at all" - the negative control,
 * and it has to include fills and non-rectangular strokes because the knob's
 * detent arc is a `strokePath` and the switch's lamp is a `fillRoundedRect`.
 * Counting only rectangles would have made "the instruments keep their accent"
 * unprovable and the whole fix unfalsifiable in the too-far direction.
 */
function makeGraphics(): Record<string, unknown> {
  const strokes: Stroke[] = [];
  const inks: number[] = [];
  let pen = { color: 0, width: 0 };
  const g: Record<string, unknown> = {
    alpha: 1,
    depth: 0,
    x: 0,
    y: 0,
    strokes,
    inks,
    clear() {
      strokes.length = 0;
      inks.length = 0;
      return g;
    },
    fillStyle(color: number) {
      inks.push(color);
      return g;
    },
    fillRoundedRect() {
      return g;
    },
    fillCircle() {
      return g;
    },
    fillRect() {
      return g;
    },
    fillTriangle() {
      return g;
    },
    fillPoints() {
      return g;
    },
    closePath() {
      return g;
    },
    strokeEllipse() {
      return g;
    },
    lineStyle(width: number, color: number) {
      pen = { color, width };
      inks.push(color);
      return g;
    },
    strokeRoundedRect(x: number, y: number, w: number, h: number) {
      strokes.push({ color: pen.color, width: pen.width, x, y, w, h });
      return g;
    },
    strokeCircle() {
      return g;
    },
    setDepth(d: number) {
      g["depth"] = d;
      return g;
    },
    setAlpha(a: number) {
      g["alpha"] = a;
      return g;
    },
    setPosition() {
      return g;
    },
    setScale(v: number) {
      g["scaleX"] = v;
      g["scaleY"] = v;
      return g;
    },
    beginPath() {
      return g;
    },
    moveTo() {
      return g;
    },
    lineTo() {
      return g;
    },
    strokePath() {
      return g;
    },
    lineBetween() {
      return g;
    },
    destroy() {
      return g;
    },
  };
  return g;
}

function makeContainer(x: number, y: number): Record<string, unknown> {
  const c: Record<string, unknown> = {
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    depth: 0,
    name: "",
    add() {
      return c;
    },
    setDepth(d: number) {
      c["depth"] = d;
      return c;
    },
    setName(n: string) {
      c["name"] = n;
      return c;
    },
    setPosition(nx: number, ny: number) {
      c["x"] = nx;
      c["y"] = ny;
      return c;
    },
    setAlpha() {
      return c;
    },
    // The cockpit kit re-stacks its readout over the hardware it just drew.
    bringToTop() {
      return c;
    },
    remove() {
      return c;
    },
    destroy() {
      return c;
    },
  };
  return c;
}

/**
 * A Text stub that answers any `setX` the kit calls.
 *
 * The explicit methods are the ones whose EFFECT is measured (position, text,
 * and the width/height the row's own height is computed from). Everything else
 * - `setWordWrapWidth`, `setLetterSpacing`, `setResolution`, `setShadow` and
 * whatever `uiText` reaches for next - is answered by the Proxy and returns the
 * object for chaining.
 *
 * A PROXY RATHER THAN A LONGER LIST, deliberately. The cockpit kit measures
 * real text to decide a row's height, and a stub that throws on an unlisted
 * setter fails for a reason that has nothing to do with the claim under test -
 * which is how a guard ends up being narrowed to the kit that happens to work.
 * The width model is the same one `cockpit.test.ts` uses.
 */
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
    setText(next: string) {
      t["text"] = next;
      t["width"] = next.length * size * 0.5;
      return t;
    },
    destroy() {
      return t;
    },
  };
  return new Proxy(t, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (typeof key === "string" && key.startsWith("set")) return () => target;
      return undefined;
    },
  }) as Record<string, unknown>;
}

/** Every Graphics the scene handed out, newest last. */
const graphicsMade: Record<string, unknown>[] = [];

const scene = {
  add: {
    graphics() {
      const g = makeGraphics();
      graphicsMade.push(g);
      return g;
    },
    container(x: number, y: number) {
      return makeContainer(x, y);
    },
    text(x: number, y: number, content: string, style: { fontSize?: string }) {
      const size = Number.parseInt(style.fontSize ?? "24", 10);
      const t = makeText(content, size);
      t["x"] = x;
      t["y"] = y;
      return t;
    },
    zone() {
      const z: Record<string, unknown> = {
        setOrigin: () => z,
        setName: () => z,
        setDepth: () => z,
        setInteractive: () => z,
        disableInteractive: () => z,
        on: () => z,
        destroy: () => z,
      };
      return z;
    },
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

/** Fire the `onComplete` of every live tween, the way an arrival fade ends. */
function completeTweens(): void {
  for (const entry of [...tweens]) {
    if (entry.removed) continue;
    const done = entry.config["onComplete"];
    if (typeof done === "function") (done as () => void)();
  }
}

const live = (): TweenEntry[] => tweens.filter((t) => !t.removed);

beforeEach(() => {
  tweens.length = 0;
  graphicsMade.length = 0;
  vi.resetModules();
});

const ROW = { x: 96, y: 216, w: 466, h: 112 };

describe("a focused control wears exactly one gold outline", () => {
  it("the control's own plate border is never the accent, focused or not", async () => {
    const { MenuButton } = await import("@game/ui/controls");
    const { INK } = await import("@game/ui/theme");
    const { hexToNum } = await import("@game/render/palette");

    // Earth dresses this screen, and Earth's accent IS the chrome accent.
    const style = {
      lang: "en" as const,
      uppercase: false,
      increasedLetterSpacing: false,
      accent: INK.accent,
    };
    const button = new MenuButton(scene, style, "pick.new", ROW.x, ROW.y, 10, {
      label: "New Pilot",
      minWidth: ROW.w,
      onPress: () => {},
    });

    // The plate's Graphics is the first one this control asked for.
    const plate = graphicsMade[0] as { strokes: Stroke[] };
    const accent = hexToNum(INK.accent);

    expect(plate.strokes.filter((s) => s.color === accent)).toEqual([]);

    button.setFocused(true);
    expect(
      plate.strokes.filter((s) => s.color === accent).map((s) => ({
        width: s.width,
        w: s.w,
        h: s.h,
      })),
    ).toEqual([]);
  });

  it("one accent stroke total, counting the control and the screen's ring", async () => {
    const { MenuButton } = await import("@game/ui/controls");
    const { FocusRing } = await import("@game/ui/chrome");
    const { INK } = await import("@game/ui/theme");
    const { hexToNum } = await import("@game/render/palette");

    const style = {
      lang: "en" as const,
      uppercase: false,
      increasedLetterSpacing: false,
      accent: INK.accent,
    };
    const button = new MenuButton(scene, style, "pick.new", ROW.x, ROW.y, 10, {
      label: "New Pilot",
      minWidth: ROW.w,
      onPress: () => {},
    });
    const plate = graphicsMade[0] as { strokes: Stroke[] };

    const ring = new FocusRing(scene, 12, false);
    const ringG = graphicsMade[graphicsMade.length - 1] as { strokes: Stroke[] };

    button.setFocused(true);
    const box = button.ringBounds();
    ring.moveTo(box.x, box.y, box.w, box.h, true);

    const accent = hexToNum(INK.accent);
    const gold = [...plate.strokes, ...ringG.strokes].filter((s) => s.color === accent);

    // ONE. Not "one from each file".
    expect(gold.length).toBe(1);
    // And it is the RING's - outside the control, not on its edge.
    expect(gold[0]?.w).toBeGreaterThan(box.w);
  });
});

/**
 * ============ THE SAME CLAIM, ON THE OTHER KIT (UR-112, reaching Settings) ===
 *
 * ================== WHY THIS SECTION EXISTS ==================
 * The project owner reported the double gold outline AGAIN, on Ship Controls,
 * after the fix above shipped. The brief said to VERIFY the reason before
 * fixing rather than assume it, so it was verified: `ui/controls.Control`
 * subclasses draw their plate through `paintPlate`, which is the one method
 * UR-112 edited; `SettingsScene`'s rows are `ui/cockpit.PanelControl`s, which
 * extend `Control` but override the painting entirely and NEVER CALL
 * `paintPlate`. So the first fix was correct, was complete for the eight
 * screens it covered, and could not have reached the ninth. Settings is the
 * only screen in the build on the cockpit kit, which is why it was the only one
 * still wrong.
 *
 * Two places were stroking the control's own box in `style.accent` at 3 px
 * while focused - `PanelControl.paintBay` (every knob, switch, selector and
 * hull row) and `drawKey` (the reset key) - against a `FocusRing` stroking
 * `INK.accent` 6 px outside the same box.
 *
 * ================== WHY IT COUNTS CONCENTRIC STROKES AND NOT ALL OF THEM =====
 * The test above can demand ONE accent stroke in total because a menu button
 * has no accent hardware. A cockpit row does: the knob's burnt-in detent arc,
 * the switch's guard and lamp, the selector's chevrons and position lamps are
 * all legitimately in the accent, and they all come out of the SAME Graphics as
 * the plate. A blanket count would forbid the instruments, which is not the
 * defect and would be a worse screen.
 *
 * So it counts strokes CONCENTRIC WITH THE CONTROL'S RING BOX, which is what
 * "two concentric gold outlines with a strip of panel between them" actually
 * means. An accent stroke somewhere else on the row is hardware; an accent
 * stroke on the row's own edge is the second ring.
 */
describe("UR-112 reaches the cockpit kit too, which is the other kit", () => {
  const STYLE = {
    lang: "en" as const,
    uppercase: false,
    increasedLetterSpacing: false,
    // Ship Controls' accent is the pilot's dash colour, and AMBER is both the
    // default and `INK.accent` to the byte - so the shipped default is the
    // worst case for this defect and is what is measured.
    accent: "#FFC857",
  };
  const BOX = { x: 144, y: 216, w: 748 };

  /** A stroke concentric with `box`, i.e. an outline of the control itself. */
  const concentric = (
    s: Stroke,
    box: { x: number; y: number; w: number; h: number },
    slack: number,
  ): boolean =>
    Math.abs(s.w - box.w) <= slack && Math.abs(s.h - box.h) <= slack;

  async function kit(): Promise<Record<string, unknown>> {
    return (await import("@game/ui/cockpit")) as unknown as Record<string, unknown>;
  }

  for (const row of ["KnobRow", "SwitchRow", "SelectorRow", "PanelButton"] as const) {
    it(`${row}: one accent outline on the box, counting the control AND the ring`, async () => {
      const cockpit = await kit();
      const { FocusRing } = await import("@game/ui/chrome");
      const { hexToNum } = await import("@game/render/palette");
      const { SPACE } = await import("@game/ui/theme");

      const options: Record<string, unknown> = {
        label: "Music",
        width: BOX.w,
        minWidth: BOX.w,
        value: row === "SwitchRow" ? true : row === "SelectorRow" ? "qwerty" : 0.7,
        choices: [
          { value: "qwerty", label: "qwerty" },
          { value: "azerty", label: "azerty" },
        ],
        onLabel: "on",
        offLabel: "off",
        format: (v: number) => `${Math.round(v * 100)}%`,
        onChange: () => {},
        onPress: () => {},
      };
      const Ctor = cockpit[row] as new (
        ...args: unknown[]
      ) => import("@game/ui/controls").Control;
      const control = new Ctor(scene, STYLE, `settings.${row}`, BOX.x, BOX.y, 10, options);

      // The control's plate Graphics is the first one it asked for.
      const plate = graphicsMade[0] as { strokes: Stroke[] };
      const ring = new FocusRing(scene, 12, false);
      const ringG = graphicsMade[graphicsMade.length - 1] as { strokes: Stroke[] };

      control.setFocused(true);
      const box = control.ringBounds();
      ring.moveTo(box.x, box.y, box.w, box.h, true);

      const accent = hexToNum(STYLE.accent);
      // The ring is `focusRingOffset` outside the box on every side, so its own
      // stroke is `offset * 2` wider - well inside this slack, which is why the
      // slack has to be big enough to catch BOTH as concentric.
      const slack = SPACE.focusRingOffset * 2 + 4;
      const gold = [...plate.strokes, ...ringG.strokes].filter(
        (s) => s.color === accent && concentric(s, box, slack),
      );

      // WATCHED FAILING. With `paintBay`'s `this.focused ? this.style.accent`
      // and `drawKey`'s `focused ? accent` restored, this run read:
      //   KnobRow:     expected 2 to be 1
      //   SwitchRow:   expected 2 to be 1
      //   SelectorRow: expected 2 to be 1
      //   PanelButton: expected 2 to be 1
      // i.e. exactly the two concentric gold lines the owner described, on
      // every control class on the panel.
      expect(gold.length, `${row} wears ${gold.length} gold outlines`).toBe(1);
      // And the one that survives is the RING's - outside the control, never
      // on its edge.
      expect(gold[0]?.w).toBeGreaterThan(box.w);
    });
  }

  it("the instruments KEEP their accent: this forbids an outline, not a colour", async () => {
    // The negative half. If the fix had been "no accent anywhere in this file",
    // the knob's burnt-in detent arc and the switch's lamp would have gone with
    // the defect, and the panel would read as dead metal. So a focused knob
    // must still put the accent on the frame SOMEWHERE that is not its edge.
    const cockpit = await kit();
    const { hexToNum } = await import("@game/render/palette");

    const KnobRow = cockpit["KnobRow"] as new (
      ...args: unknown[]
    ) => import("@game/ui/controls").Control;
    const control = new KnobRow(scene, STYLE, "settings.music", BOX.x, BOX.y, 10, {
      label: "Music",
      width: BOX.w,
      value: 0.7,
      format: (v: number) => `${Math.round(v * 100)}%`,
      onChange: () => {},
    });
    const plate = graphicsMade[0] as { strokes: Stroke[]; inks: number[] };
    control.setFocused(true);

    const accent = hexToNum(STYLE.accent);
    const box = control.ringBounds();
    // The accent must still be on the FRAME somewhere - the burnt-in detent
    // arc, the pointer, the lit lamp.
    expect(
      plate.inks.filter((ink) => ink === accent).length,
      "a focused knob lost the accent entirely - the fix went too far",
    ).toBeGreaterThan(0);
    // And still nowhere near the control's own edge.
    expect(
      plate.strokes.filter((s) => s.color === accent && concentric(s, box, 16)),
    ).toEqual([]);
  });
});

describe("the focused outline breathes, slightly, unless motion is calm", () => {
  it("pulses on a repeating yoyo once it has arrived", async () => {
    const { FocusRing } = await import("@game/ui/chrome");
    const { FOCUS_PULSE } = await import("@game/ui/focusPop");

    const ring = new FocusRing(scene, 12, false);
    ring.moveTo(ROW.x, ROW.y, ROW.w, ROW.h, true);
    completeTweens();

    const pulse = live().find((t) => t.config["repeat"] === -1);
    expect(pulse, "no repeating tween was started on the ring").toBeDefined();
    expect(pulse?.config["yoyo"]).toBe(true);
    const alpha = pulse?.config["alpha"] as { from: number; to: number };
    expect(alpha.from).toBe(1);
    expect(alpha.to).toBe(FOCUS_PULSE.minAlpha);
    // SLIGHT. A menu, not an alarm: no more than a fifth of the ring's
    // strength, and a half cycle no faster than a second.
    expect(alpha.from - alpha.to).toBeLessThanOrEqual(0.2);
    expect(pulse?.config["duration"]).toBeGreaterThanOrEqual(1000);
  });

  it("is static at FULL strength under calm motion (D41, AC-19.3)", async () => {
    const { FocusRing } = await import("@game/ui/chrome");

    const ring = new FocusRing(scene, 12, true);
    ring.moveTo(ROW.x, ROW.y, ROW.w, ROW.h, true);
    completeTweens();

    expect(live().filter((t) => t.config["repeat"] === -1)).toEqual([]);
    // The cue that remains must be the LOUD end of the breath, never the dim
    // one: a calm-motion player loses the movement, not the selection.
    const g = graphicsMade[graphicsMade.length - 1] as { alpha: number; strokes: Stroke[] };
    expect(g.alpha).toBe(1);
    expect(g.strokes.length).toBe(1);
  });

  it("is the SAME breath the story kit's ring runs, from the same spec", async () => {
    // THE SHARED PATH, NOT A SECOND ONE. `scenes/lib/kit.createFocusRing`
    // dresses the seven story screens, including the Director map's Beacon Log
    // and Settings chips - the treatment the owner named as the standard. Both
    // rings read `focusPop.focusPulse`, so there is one answer to "what does
    // focused look like" and not two (UR-111's whole subject).
    const kit = await import("@game/scenes/lib/kit");
    const { FOCUS_PULSE } = await import("@game/ui/focusPop");

    const ring = kit.createFocusRing(scene, 40, false);
    ring.moveTo({ id: "beaconLog", x: 1180, y: 84, w: 300, h: 72 });
    completeTweens();

    const pulse = live().find((t) => t.config["repeat"] === -1);
    expect(pulse, "the story kit's ring never started breathing").toBeDefined();
    const alpha = pulse?.config["alpha"] as { from: number; to: number };
    expect(alpha).toEqual({ from: 1, to: FOCUS_PULSE.minAlpha });
    expect(pulse?.config["duration"]).toBe(FOCUS_PULSE.halfCycleMs);
  });

  it("the story kit's ring is static under calm motion too", async () => {
    const kit = await import("@game/scenes/lib/kit");

    const ring = kit.createFocusRing(scene, 40, true);
    ring.moveTo({ id: "beaconLog", x: 1180, y: 84, w: 300, h: 72 });
    completeTweens();

    expect(live().filter((t) => t.config["repeat"] === -1)).toEqual([]);
    expect(ring.graphics.alpha).toBe(1);
  });

  it("a story screen that has not opted in keeps the ring it always had", async () => {
    // The two-argument call is what eight of the nine callers still make. It
    // must not start moving on its own: a screen that has not handed over its
    // reduced-motion flag cannot be trusted to switch the pulse off.
    const kit = await import("@game/scenes/lib/kit");

    const ring = kit.createFocusRing(scene, 40);
    ring.moveTo({ id: "launch", x: 700, y: 900, w: 420, h: 88 });
    completeTweens();

    expect(live().filter((t) => t.config["repeat"] === -1)).toEqual([]);
  });

  it("stops breathing when the ring is hidden", async () => {
    const { FocusRing } = await import("@game/ui/chrome");

    const ring = new FocusRing(scene, 12, false);
    ring.moveTo(ROW.x, ROW.y, ROW.w, ROW.h, true);
    completeTweens();
    ring.hide();

    expect(live().filter((t) => t.config["repeat"] === -1)).toEqual([]);
  });
});
