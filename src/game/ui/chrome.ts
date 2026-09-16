import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@game/sceneKeys";
import { idleDriftPx, layer } from "@game/render/layers";
import { particleSpec } from "@game/render/particles";
import { DUR, EASE, INK, SPACE } from "./theme.js";
import { type StopPalette, hexToNum } from "@game/render/palette";

/**
 * Vector menu chrome (D83: everything is drawn in code, no raster ships).
 *
 * Menus are built from the same materials as the world - gradients, flat
 * silhouettes, one accent - so Settings and the Beacon Log read as parts of the
 * ship rather than as a web form dropped on top of a game.
 */

/** Rounded plate. The one primitive every control is made of. */
export function plate(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  alpha = 1,
  radius: number = SPACE.radius,
): void {
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
}

export function strokePlate(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  width = 2,
  radius: number = SPACE.radius,
): void {
  g.lineStyle(width, color, 1);
  g.strokeRoundedRect(x, y, w, h, radius);
}

/**
 * The menu backdrop: a vertical gradient from the stop palette, a sparse star
 * field, and drifting motes.
 *
 * Rubric item 2 ("nothing is ever still") applies to menus too - a frozen
 * screen reads as a crashed game. Under reduced motion the drift slows and the
 * sway stops, but it never stops entirely (AC-19.3 removes shake and camera
 * sway, not the world being alive; layers.ts documents the same rule).
 */
export class Backdrop {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly motes: Phaser.GameObjects.Arc[] = [];
  private readonly midfield: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly palette: StopPalette,
    private readonly reducedMotion: boolean,
  ) {
    this.g = scene.add.graphics().setDepth(layer("sky").depth);
    this.midfield = scene.add.graphics().setDepth(layer("midField").depth);
    this.paintSky();
    this.paintStars();
    this.paintMidfield();
    this.spawnMotes();
  }

  private paintSky(): void {
    const top = hexToNum(INK.bgDeep);
    const bottom = hexToNum(this.palette.colors[5] ?? INK.bg);
    this.g.fillGradientStyle(top, top, bottom, bottom, 1);
    this.g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // A wide, very soft accent bloom at the top edge: the ship's own cabin
    // light. It is what stops the gradient reading as a flat web background.
    this.g.fillStyle(hexToNum(this.palette.accent), 0.06);
    this.g.fillEllipse(GAME_WIDTH * 0.5, -160, GAME_WIDTH * 1.2, 760);
  }

  private paintStars(): void {
    // Deterministic placement: a menu that reshuffles its stars on every
    // navigation flickers. Seeded from a fixed constant, not Math.random.
    let seed = 0x5eed;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < 90; i += 1) {
      const x = next() * GAME_WIDTH;
      const y = next() * GAME_HEIGHT;
      const r = 1 + next() * 2.2;
      this.g.fillStyle(hexToNum(INK.text), 0.1 + next() * 0.35);
      this.g.fillCircle(x, y, r);
    }
  }

  /** A single flat silhouette band, the menu's version of layer L3. */
  private paintMidfield(): void {
    const band = hexToNum(this.palette.colors[4] ?? INK.panel);
    this.midfield.fillStyle(band, 0.16);
    this.midfield.beginPath();
    this.midfield.moveTo(0, GAME_HEIGHT);
    this.midfield.lineTo(0, GAME_HEIGHT - 190);
    for (let x = 0; x <= GAME_WIDTH; x += 120) {
      const h = 190 + Math.sin(x / 260) * 46 + Math.cos(x / 97) * 22;
      this.midfield.lineTo(x, GAME_HEIGHT - h);
    }
    this.midfield.lineTo(GAME_WIDTH, GAME_HEIGHT);
    this.midfield.closePath();
    this.midfield.fillPath();
  }

  private spawnMotes(): void {
    const spec = particleSpec("dustMotes");
    const count = this.reducedMotion ? 10 : 18;
    for (let i = 0; i < count; i += 1) {
      const x = ((i * 137) % 100) / 100;
      const y = ((i * 71) % 100) / 100;
      const mote = this.scene.add
        .circle(
          x * GAME_WIDTH,
          y * GAME_HEIGHT,
          2 + (i % 3),
          hexToNum(this.palette.accent),
          0.28,
        )
        .setDepth(layer("nearField").depth);
      this.motes.push(mote);
      this.scene.tweens.add({
        targets: mote,
        y: mote.y - (60 + (i % 5) * 26),
        alpha: 0.06,
        duration: spec.lifespanMs[0] + (i % 6) * 420,
        ease: EASE.drift,
        yoyo: true,
        repeat: -1,
        delay: i * 190,
      });
    }
  }

  /** Called from the scene's update loop; keeps the midfield band alive. */
  update(elapsedMs: number): void {
    this.midfield.x = idleDriftPx(layer("midField"), elapsedMs, this.reducedMotion);
  }
}

/**
 * The focus ring (AC-18.1: "a visible focus state on every interactive
 * element").
 *
 * One ring for the whole screen, tweened between controls on Back.Out so the
 * eye can follow it. It sits OUTSIDE the control's plate, so it never covers a
 * label, and it is drawn in the menu accent, which is the only saturated colour
 * on screen.
 */
export class FocusRing {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly box = { x: 0, y: 0, w: 0, h: 0 };
  private visible = false;

  constructor(private readonly scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth);
    this.g.setAlpha(0);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    this.scene.tweens.add({
      targets: this.g,
      alpha: 0,
      duration: DUR.focus,
      ease: EASE.arrive,
    });
  }

  moveTo(x: number, y: number, w: number, h: number, instant = false): void {
    const o = SPACE.focusRingOffset;
    const target = { x: x - o, y: y - o, w: w + o * 2, h: h + o * 2 };
    const redraw = (): void => {
      this.g.clear();
      this.g.lineStyle(SPACE.focusRingWidth, hexToNum(INK.accent), 1);
      this.g.strokeRoundedRect(
        this.box.x,
        this.box.y,
        this.box.w,
        this.box.h,
        SPACE.radius + o,
      );
      // A second, softer ring outside the first: the state stays legible
      // against both the bright and the dark half of a gradient.
      this.g.lineStyle(SPACE.focusRingWidth + 6, hexToNum(INK.accent), 0.18);
      this.g.strokeRoundedRect(
        this.box.x - 3,
        this.box.y - 3,
        this.box.w + 6,
        this.box.h + 6,
        SPACE.radius + o + 3,
      );
    };

    this.visible = true;
    if (instant || this.box.w === 0) {
      Object.assign(this.box, target);
      redraw();
      this.g.setAlpha(1);
      return;
    }
    this.scene.tweens.add({
      targets: this.box,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
      duration: DUR.focus,
      ease: EASE.pop,
      onUpdate: redraw,
    });
    this.g.setAlpha(1);
  }
}

/**
 * The Lantern, drawn small for a picker tile (art-direction section 5).
 *
 * Simplified for legibility at ~200 px: pointed nosecone, rounded fuselage,
 * stripe band, three swept fins, nozzle, one porthole, and the engineered beam
 * emitter at the nose - large lens, three concentric focusing rings, finned
 * heat housing (D89, AC-24.1). No text on the hull; the name is drawn as a
 * label beside the tile, from `{shipName}` (C07, AC-24.3).
 */
export function drawShip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  colors: { hull: string; stripe: string; glass: string; lens: string },
  dim: boolean,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const s = size / 100;
  const hull = hexToNum(colors.hull);
  const stripe = hexToNum(colors.stripe);

  // Fins first, so the fuselage overlaps them.
  g.fillStyle(stripe, 1);
  g.fillTriangle(-16 * s, 26 * s, -40 * s, 52 * s, -14 * s, 50 * s);
  g.fillTriangle(16 * s, 26 * s, 40 * s, 52 * s, 14 * s, 50 * s);
  g.fillTriangle(-6 * s, 34 * s, 0, 62 * s, 6 * s, 34 * s);

  // Nozzle.
  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillRoundedRect(-11 * s, 44 * s, 22 * s, 16 * s, 5 * s);

  // Fuselage: rounded capsule with a pointed nose.
  g.fillStyle(hull, 1);
  g.fillRoundedRect(-18 * s, -22 * s, 36 * s, 70 * s, 16 * s);
  g.fillTriangle(-18 * s, -14 * s, 0, -52 * s, 18 * s, -14 * s);

  // Stripe band.
  g.fillStyle(stripe, 1);
  g.fillRoundedRect(-18 * s, 6 * s, 36 * s, 11 * s, 4 * s);

  // Porthole.
  g.fillStyle(hexToNum(colors.glass), 1);
  g.fillCircle(0, -4 * s, 8 * s);
  g.lineStyle(2.5 * s, hexToNum(INK.panelSunken), 0.8);
  g.strokeCircle(0, -4 * s, 8 * s);

  // Emitter head: finned housing, three focusing rings, iris, lens.
  g.fillStyle(hexToNum(INK.panelRaised), 1);
  g.fillRoundedRect(-13 * s, -46 * s, 26 * s, 16 * s, 5 * s);
  for (let i = 0; i < 4; i += 1) {
    g.fillStyle(hexToNum(INK.line), 1);
    g.fillRect((-11 + i * 6) * s, -46 * s, 2.4 * s, 16 * s);
  }
  for (let r = 3; r >= 1; r -= 1) {
    g.lineStyle(2 * s, hexToNum(colors.lens), 0.35 + r * 0.14);
    g.strokeCircle(0, -42 * s, (4 + r * 3) * s);
  }
  g.fillStyle(hexToNum(colors.lens), 1);
  g.fillCircle(0, -42 * s, 6 * s);
  g.fillStyle(hexToNum(INK.text), 0.85);
  g.fillCircle(-1.6 * s, -44 * s, 2 * s);

  c.add(g);
  if (dim) c.setAlpha(0.32);
  return c;
}

/**
 * Pilot avatars: six vector marks, no faces (D43 - a profile is a name and a
 * mark, not a person). Each is a distinct SILHOUETTE, not a colour variant, so
 * the set survives the colourblind palette and a desaturated screenshot.
 */
export function drawAvatar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  avatarId: string,
  color: string,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = size / 2;
  const tint = hexToNum(color);

  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillCircle(0, 0, r);
  g.lineStyle(3, hexToNum(INK.line), 1);
  g.strokeCircle(0, 0, r);
  g.fillStyle(tint, 1);

  switch (avatarId) {
    case "avatar-2": // moon: crescent from two discs
      g.fillCircle(0, 0, r * 0.56);
      g.fillStyle(hexToNum(INK.panelSunken), 1);
      g.fillCircle(r * 0.26, -r * 0.16, r * 0.5);
      break;
    case "avatar-3": { // star: five points
      const pts: Phaser.Geom.Point[] = [];
      for (let i = 0; i < 10; i += 1) {
        const rad = i % 2 === 0 ? r * 0.62 : r * 0.26;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(new Phaser.Geom.Point(Math.cos(a) * rad, Math.sin(a) * rad));
      }
      g.fillPoints(pts, true);
      break;
    }
    case "avatar-4": // ring
      g.lineStyle(r * 0.18, tint, 1);
      g.strokeEllipse(0, 0, r * 1.24, r * 0.52);
      g.fillCircle(0, 0, r * 0.22);
      break;
    case "avatar-5": // spark: four-point burst
      g.fillTriangle(0, -r * 0.7, r * 0.2, 0, -r * 0.2, 0);
      g.fillTriangle(0, r * 0.7, r * 0.2, 0, -r * 0.2, 0);
      g.fillTriangle(-r * 0.7, 0, 0, r * 0.2, 0, -r * 0.2);
      g.fillTriangle(r * 0.7, 0, 0, r * 0.2, 0, -r * 0.2);
      break;
    case "avatar-6": // wave
      g.lineStyle(r * 0.16, tint, 1);
      g.beginPath();
      for (let i = 0; i <= 24; i += 1) {
        const px = -r * 0.66 + (i / 24) * r * 1.32;
        const py = Math.sin((i / 24) * Math.PI * 2) * r * 0.3;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();
      break;
    default: // avatar-1, comet: disc plus tail
      g.fillCircle(r * 0.2, -r * 0.14, r * 0.3);
      g.fillTriangle(-r * 0.7, r * 0.48, r * 0.06, -r * 0.34, r * 0.3, r * 0.06);
      break;
  }

  c.add(g);
  return c;
}

/**
 * A beacon: the reward object (D13). Lit beacons carry a soft accent glow and a
 * slow pulse; unlit ones are the same silhouette in the locked ink, so the
 * collection reads as "six more to light", never as six failures.
 */
export function drawBeacon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  accent: string,
  lit: boolean,
  reducedMotion: boolean,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const s = size / 100;
  const body = lit ? hexToNum(accent) : hexToNum(INK.locked);

  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillRoundedRect(-22 * s, 34 * s, 44 * s, 14 * s, 5 * s);
  g.fillStyle(body, lit ? 0.9 : 0.55);
  g.fillTriangle(-16 * s, 34 * s, 0, -12 * s, 16 * s, 34 * s);
  g.fillStyle(body, 1);
  g.fillCircle(0, -22 * s, 12 * s);

  c.add(g);

  if (lit) {
    const glow = scene.add.circle(0, -22 * s, 26 * s, hexToNum(accent), 0.22);
    c.addAt(glow, 0);
    scene.tweens.add({
      targets: glow,
      // The blink is the thing that makes progress feel earned (design brief
      // 3), so it is kept under reduced motion and only slowed.
      scale: reducedMotion ? 1.06 : 1.22,
      alpha: reducedMotion ? 0.3 : 0.4,
      duration: reducedMotion ? 2600 : 1400,
      ease: EASE.drift,
      yoyo: true,
      repeat: -1,
    });
  }
  return c;
}

/**
 * A trophy mark (D74, D80). Informational, never comparative: no tier, no
 * rank, no number of players who also have it. Earned reads bright; unearned
 * is the same shape dimmed, with the thing that earns it written underneath.
 */
export function drawTrophy(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  accent: string,
  earned: boolean,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = size / 2;
  const tint = earned ? hexToNum(accent) : hexToNum(INK.locked);

  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillCircle(0, 0, r);
  g.lineStyle(3, tint, earned ? 1 : 0.5);
  g.strokeCircle(0, 0, r);
  g.fillStyle(tint, earned ? 1 : 0.42);
  // A small lit beacon inside the disc: every trophy is a light you put
  // somewhere, which is the whole story of the game.
  g.fillTriangle(-r * 0.34, r * 0.4, 0, -r * 0.12, r * 0.34, r * 0.4);
  g.fillCircle(0, -r * 0.3, r * 0.2);
  c.add(g);
  return c;
}
