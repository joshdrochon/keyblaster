import Phaser from "phaser";
import { idleDriftPx, layer } from "@game/render/layers";
import { menuDebris, menuStars, type StarMote } from "./starfield.js";
import { starsMayTravel, twinkleAlpha } from "@game/render/starField";
import { particleSpec } from "@game/render/particles";
import { DUR, EASE, INK, SPACE } from "./theme.js";
import { focusArrive, focusPulse } from "./focusPop.js";
import type { TrophyGlyphId } from "./catalog.js";
import type { Rect } from "./layout.js";
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

// ---------------------------------------------------------------------------
// The lock mark
// ---------------------------------------------------------------------------

/**
 * A padlock, drawn to fill the box it is handed.
 *
 * ================== WHY IT EXISTS ==================
 * The Director map wrote the WORD "Locked" under six of its seven planet names.
 * Six copies of one word down a row is not a status - it is a column of the
 * same word - and it cost every caption a second line, which is what pushed the
 * name away from its disc and left the focus ring wrapping the disc alone.
 *
 * ================== WHY IT IS NOT A REFUSAL ==================
 * D31 / AC-22b.1: locked is "not yet", never "denied". There is no cross, no
 * bar and no red anywhere in this mark, and the caller passes the ink - the map
 * passes `INK.textDim`, the same token the name beside it is drawn in, so the
 * mark is the quiet half of one label rather than a warning stuck to it. The
 * shackle is CLOSED, which is what makes it a lock and not a hole; a padlock
 * hanging open would read as "you may go", which is the opposite of true.
 *
 * ================== THE BOX IS THE MARK'S INK BOX ==================
 * A painter and not a label, for the reason `plate.paintPromptGlyph` gives: a
 * glyph in a Text is a font's opinion about a shape, and this one has to sit
 * beside a 24 px word at a size read off the type scale. Every part is a
 * fraction of the box, so the same function draws a 20 px caption mark and a
 * 60 px one, and `lockGlyphParts` hands the geometry out so a test can say the
 * mark FILLS its box rather than merely fitting inside it.
 */
export interface LockGlyphParts {
  /** The lock's body: the full width of the box, sitting on its floor. */
  readonly body: Rect;
  /** The shackle: a half-circle standing on the body's top edge. */
  readonly shackle: {
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
    readonly lineW: number;
  };
  readonly radius: number;
}

export function lockGlyphParts(box: Rect): LockGlyphParts {
  // The stroke is a twelfth of the height, floored at 2 so the shackle does not
  // vanish at caption sizes - the same floor `drawTrophyMark` uses on its line.
  const lineW = Math.max(2, box.h * 0.12);
  const r = box.w * 0.27;
  const cx = box.x + box.w / 2;
  // The shackle's OUTER edge is the box's top edge, so the mark reaches it.
  const cy = box.y + lineW / 2 + r;
  return {
    body: { x: box.x, y: cy, w: box.w, h: box.y + box.h - cy },
    shackle: { cx, cy, r, lineW },
    radius: Math.max(2, box.w * 0.18),
  };
}

export function paintLockGlyph(
  g: Phaser.GameObjects.Graphics,
  box: Rect,
  ink: string,
  alpha = 1,
): void {
  const parts = lockGlyphParts(box);
  const tint = hexToNum(ink);
  g.lineStyle(parts.shackle.lineW, tint, alpha);
  g.beginPath();
  // Screen coordinates, so y grows downward: PI -> 2PI is the TOP half.
  g.arc(parts.shackle.cx, parts.shackle.cy, parts.shackle.r, Math.PI, Math.PI * 2, false);
  g.strokePath();
  g.fillStyle(tint, alpha);
  g.fillRoundedRect(parts.body.x, parts.body.y, parts.body.w, parts.body.h, parts.radius);
}

/**
 * The menu backdrop: a vertical gradient from the stop palette, a sparse star
 * field, a drifting debris field, and a near plane of motes.
 *
 * NOTHING THAT READS AS A POINT OF LIGHT TRANSLATES HERE (UR-14). The stars are
 * redrawn at the places they were put and only their alpha varies; the motes
 * hold their places and breathe the same way. The debris is the one thing that
 * still drifts, because a rock is matter rather than light - see `spawnMotes`
 * and `render/tiles.TILE_DRAWS` for where that line is drawn and why.
 *
 * Rubric item 2 ("nothing is ever still") applies to menus too - a frozen
 * screen reads as a crashed game. Under reduced motion the drift slows and the
 * sway stops, but it never stops entirely (AC-19.3 removes shake and camera
 * sway, not the world being alive; layers.ts documents the same rule).
 *
 * ================== IT USED TO DRAW HILLS ==================
 * The midfield band was a rolling landform - `190 + sin(x/260)*46 +
 * cos(x/97)*22` - along the bottom of every menu screen. D97 dropped terrain
 * grammar for space grammar across the world screens; this was missed because
 * it lives in the UI kit rather than in `render/`, so the game spoke one visual
 * language while flying and another between flights, on five screens.
 *
 * It is DEBRIS now: the same thing the world draws at that depth, scattered
 * rather than joined, so nothing can read as a horizon. The placement is in
 * `starfield.ts`, away from Phaser, where "deterministic" and "scales with the
 * world" are assertable - see `tests/unit/ui/starfield.test.ts`.
 *
 * ================== SIZE IS READ FROM THE SCENE ==================
 * Every measurement below comes from `scene.scale`, not from a captured
 * constant. The world's width moves with the window (D99, sceneKeys.ts) and at
 * runtime `GAME_WIDTH === scene.scale.width` by construction, so asking the
 * scene is the same number without the chance of freezing it.
 */
export class Backdrop {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly motes: Phaser.GameObjects.Arc[] = [];
  private readonly midfield: Phaser.GameObjects.Graphics;
  /**
   * The stars get their OWN Graphics, one depth step above the sky gradient.
   *
   * Not an optimisation - a separation of what changes from what does not. The
   * gradient and its eight bloom contours are painted once; the stars are
   * cleared and refilled every frame so they can flicker (UR-14). Sharing one
   * Graphics would mean repainting nine ellipses a frame to move ninety alphas.
   * It is also never repositioned, which is the other half of the same rule.
   */
  private readonly starsG: Phaser.GameObjects.Graphics;
  private readonly stars: readonly StarMote[];

  /**
   * `skyBottom` overrides the stop's own sky colour (UR-135).
   *
   * A menu screen is dressed by `paletteStop()`, which returns `"earth"` for
   * all of them - so the one screen that has an identity of its own, the
   * settings console with its player-chosen dash colour, still wore Earth's
   * blue sky under it. The owner reported the colours adopting the planet
   * three times; the accent was only two thirds of it, and this was the rest.
   *
   * Optional, so the eight screens that ARE dressed by a stop are unchanged.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly palette: StopPalette,
    private readonly reducedMotion: boolean,
    private readonly skyBottom: string | null = null,
  ) {
    this.g = scene.add.graphics().setDepth(layer("sky").depth);
    this.starsG = scene.add.graphics().setDepth(layer("sky").depth + 0.1);
    this.midfield = scene.add.graphics().setDepth(layer("midField").depth);
    // Placement is `starfield.menuStars`: deterministic, because a menu that
    // reshuffles its stars on every navigation flickers, and sized to the scene
    // rather than to a constant.
    this.stars = menuStars(this.width, this.height);
    this.paintSky();
    this.paintStars(0);
    this.paintDebris();
    this.spawnMotes();
  }

  private get width(): number {
    return this.scene.scale.width;
  }

  private get height(): number {
    return this.scene.scale.height;
  }

  private paintSky(): void {
    const top = hexToNum(INK.bgDeep);
    const bottom = hexToNum(this.skyBottom ?? this.palette.colors[5] ?? INK.bg);
    this.g.fillGradientStyle(top, top, bottom, bottom, 1);
    this.g.fillRect(0, 0, this.width, this.height);
    // A wide, very soft accent bloom at the top edge: the ship's own cabin
    // light. It is what stops the gradient reading as a flat web background.
    //
    // NESTED, NOT ONE ELLIPSE. A single flat-alpha ellipse has an EDGE, and a
    // smooth curve across the top of a dark frame reads as the limb of
    // something rather than as light - which on a screen that had a rolling
    // hill band along its bottom edge was the second half of the same "is this
    // a landscape?" problem. Eight steps is enough falloff that no boundary is
    // visible, and it costs eight fills on a backdrop drawn once.
    // Eight contours from the outside in, each at the same small alpha, so the
    // pool of light keeps the SIZE the single ellipse had - it is what lifts
    // the top fifth of a menu screen off the floor - while the outermost
    // contour is faint enough that there is no boundary to see. The spacing is
    // bunched at the rim, which is where a hard edge would otherwise be.
    const RIM = [1, 0.97, 0.93, 0.88, 0.82, 0.74, 0.62, 0.44];
    for (const t of RIM) {
      this.g.fillStyle(hexToNum(this.palette.accent), 0.0085);
      this.g.fillEllipse(this.width * 0.5, -160, this.width * 1.3 * t, 900 * t);
    }
  }

  /**
   * THE MENU'S STARS: PINNED, AND FLICKERING (UR-14).
   *
   * Every star is redrawn at the x and y it was placed with - there is no
   * per-frame term on either, here or anywhere this Graphics is touched, and
   * `starsG` is never repositioned. The ONLY thing that varies with time is the
   * alpha, and it varies through `render/starField.twinkleAlpha`, the same
   * function the world's field uses, from parameters the same module hands out.
   *
   * These stars used to be painted once into the sky Graphics and never touched
   * again. That satisfied "stay put" and failed "flicker slowly at varying
   * intervals" on five screens, which is half of a report we have now had three
   * times. A field that never changes is not compliant, it is just not the part
   * that got noticed.
   */
  private paintStars(elapsedMs: number): void {
    const ink = hexToNum(INK.text);
    // Reduced motion slows the twinkle rather than stopping it, exactly as the
    // world's field does (D41: the world stays alive, it stops being busy).
    const scale = this.reducedMotion ? 2.2 : 1;
    this.starsG.clear();
    for (const star of this.stars) {
      this.starsG.fillStyle(
        ink,
        twinkleAlpha(star.alpha, star.swing, star.period * scale, star.phase, elapsedMs),
      );
      this.starsG.fillCircle(star.x, star.y, star.r);
    }
  }

  /**
   * The menu's version of layer L3: DEBRIS, drifting.
   *
   * Scattered discs rather than a joined band, so no horizon can emerge from
   * them - see this class's header and `starfield.ts`. Each rock gets a soft
   * lit crown on the side the cabin light comes from, which is the same
   * one-light rule the world's rocks are drawn under (art-direction s5).
   */
  private paintDebris(): void {
    const body = hexToNum(this.palette.colors[4] ?? INK.panel);
    const rim = hexToNum(INK.text);
    for (const rock of menuDebris(this.width, this.height)) {
      this.midfield.fillStyle(body, rock.alpha);
      this.midfield.fillCircle(rock.x, rock.y, rock.r);
      this.midfield.fillStyle(rim, rock.alpha * 0.35);
      this.midfield.fillCircle(rock.x - rock.r * 0.22, rock.y - rock.r * 0.26, rock.r * 0.58);
    }
  }

  /**
   * THE MENU'S NEAR-PLANE SPECKS: PINNED, AND BREATHING (UR-14).
   *
   * ================== WHAT THESE WERE DOING ==================
   * Eighteen discs of radius 2-4 in the stop's accent, at the near-field depth,
   * each tweened `60 + (i % 5) * 26` px up the frame and back on an endless
   * yoyo. Measured over one 2.5 s window of the game's clock, on all five menu
   * screens: 15 to 17 of them moving, up to 69.5 px.
   *
   * By the rule in `render/starField.ts` that is a point of light translating
   * on a screen with no flight, which is the thing UR-14 has now reported four
   * times. It is the FIFTH mechanism to produce that appearance - after
   * container drift, the sideways plane march, texture scroll and object
   * parallax - and the first one driven by a TWEEN, which is why no previous
   * guard could see it: all three stepped `scene.update` by hand, and Phaser
   * advances tweens from its own loop.
   *
   * ================== WHAT THEY DO NOW ==================
   * They hold their places and breathe. Only the alpha is animated, between
   * 0.28 and 0.06, and the durations and delays were already staggered, so the
   * field shimmers out of step exactly as the stars above it do. That keeps
   * what the drift was for - rubric item 2, nothing on a menu is ever
   * completely still - without anything crossing the frame.
   *
   * ================== AND IT ASKS, RATHER THAN DECIDING ==================
   * `starsMayTravel` is the one place this is settled, and it answers from the
   * scene key. There is no `menu.backdrop` entry in `TRAVELLING_LIGHT` and a
   * menu is by definition a screen the ship is not flying through, so the
   * answer is no on all five. The branch is kept rather than deleted because
   * this surface was the one that did not ask: its guard asserted that the star
   * Graphics is never repositioned, which was true, and said nothing about
   * eighteen tweened discs beside it. A surface that asks cannot drift away
   * from the rule in silence.
   */
  private spawnMotes(): void {
    const spec = particleSpec("dustMotes");
    const count = this.reducedMotion ? 10 : 18;
    const mayTravel = starsMayTravel("menu.backdrop", this.scene.scene.key);
    for (let i = 0; i < count; i += 1) {
      const x = ((i * 137) % 100) / 100;
      const y = ((i * 71) % 100) / 100;
      const mote = this.scene.add
        .circle(
          x * this.width,
          y * this.height,
          2 + (i % 3),
          hexToNum(this.palette.accent),
          0.28,
        )
        .setDepth(layer("nearField").depth);
      this.motes.push(mote);
      const travel: Record<string, number> = mayTravel
        ? { y: mote.y - (60 + (i % 5) * 26) }
        : {};
      this.scene.tweens.add({
        targets: mote,
        ...travel,
        alpha: 0.06,
        duration: spec.lifespanMs[0] + (i % 6) * 420,
        ease: EASE.drift,
        yoyo: true,
        repeat: -1,
        delay: i * 190,
      });
    }
  }

  /** Called from the scene's update loop; keeps the debris field alive. */
  update(elapsedMs: number): void {
    this.midfield.x = idleDriftPx(layer("midField"), elapsedMs, this.reducedMotion);
    // The stars do not get a line like the one above, and that is the point.
    this.paintStars(elapsedMs);
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
  /** The live fade, so a fast pointer sweep replaces it instead of stacking. */
  private moveTween: Phaser.Tweens.Tween | null = null;

  /** The live breath, so hiding or moving the ring can stop it. */
  private pulseTween: Phaser.Tweens.Tween | null = null;

  /**
   * `reducedMotion` is REQUIRED, not defaulted.
   *
   * A default of `false` is how a screen quietly gets a pulsing ring under calm
   * motion - the same failure mode `ui/focus.setUiSound`'s note describes for
   * audio, where threading a flag through fifteen screens leaves the sixteenth
   * wrong and silent about it. There are two constructors of this class
   * (`MenuScene` and `ui/dialog`), so making it an argument is cheap and making
   * it optional is not.
   */
  /**
   * `accent` is the RING'S OWN COLOUR, and it defaults (UR-131).
   *
   * The ring stroked `INK.accent` as a literal, so on the settings console -
   * the one screen with a player-chosen dash colour - every knob, lamp and
   * chevron turned Coral and the focus ring stayed gold. The owner reported
   * it as the colours not staying what was chosen, twice.
   *
   * Defaulted rather than required because the other eight menu screens and
   * `ui/dialog` have no accent of their own and must not change: passing
   * nothing is byte-identical to what they drew before.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    private readonly reducedMotion: boolean,
    private readonly accent: string = INK.accent,
    /**
     * How far outside the control the ring is struck (UR-143).
     *
     * `SPACE.focusRingOffset` (6) by default, which is the app-wide standoff
     * and what every other ring uses. The pilot picker asked for a ring FLUSH
     * to the row's outline, and this is a per-ring value rather than an edit to
     * the token because `blast-radius` names eleven source files and six suites
     * on it - the beacon screen's forward action is one of them, and the owner
     * has already called that ring correct.
     */
    private readonly ringOffset: number = SPACE.focusRingOffset,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
    this.g.setAlpha(0);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /**
   * Start the focused outline breathing (UR-112), or leave it at full strength
   * when the player has asked for calm motion.
   *
   * The spec is `ui/focusPop.focusPulse`, shared with `scenes/lib/kit`'s ring so
   * the map's Beacon Log and Settings chips - the treatment the owner named as
   * the standard - and these five menu screens cannot drift apart.
   */
  private startPulse(): void {
    this.pulseTween?.remove();
    this.pulseTween = null;
    const spec = focusPulse(this.reducedMotion);
    if (spec === null) {
      // FULL STRENGTH, never the low end of the breath. A calm-motion player
      // loses the movement and keeps every static cue there is.
      this.g.setAlpha(1);
      return;
    }
    this.pulseTween = this.scene.tweens.add({
      targets: this.g,
      alpha: { from: spec.alpha.from, to: spec.alpha.to },
      duration: spec.duration,
      ease: spec.ease,
      yoyo: spec.yoyo,
      repeat: spec.repeat,
    });
  }

  hide(): void {
    this.visible = false;
    this.moveTween?.remove();
    this.moveTween = null;
    this.pulseTween?.remove();
    this.pulseTween = null;
    this.scene.tweens.add({
      targets: this.g,
      alpha: 0,
      duration: DUR.focus,
      ease: EASE.arrive,
    });
  }

  /** UR-188: dim on a locked control - visible for AC-18.1, not an invitation. */
  setDimmed(dimmed: boolean): void {
    this.g.setAlpha(dimmed ? 0.4 : 1);
  }

  moveTo(x: number, y: number, w: number, h: number, instant = false): void {
    const o = this.ringOffset;
    const target = { x: x - o, y: y - o, w: w + o * 2, h: h + o * 2 };
    const redraw = (): void => {
      this.g.clear();
      this.g.lineStyle(SPACE.focusRingWidth, hexToNum(this.accent), 1);
      this.g.strokeRoundedRect(
        this.box.x,
        this.box.y,
        this.box.w,
        this.box.h,
        SPACE.radius + o,
      );
      // ONE RING (UR-82). There used to be a second, softer stroke 3 px outside
      // this one, added so the state stayed legible against both the bright and
      // the dark half of a gradient. On a dark panel the two are the same gold
      // at two alphas, 3 px apart, and they read as exactly what the project
      // owner called them: a double highlight. Legibility against a light
      // background is the RING WIDTH's job, not a second ring's.
    };

    const wasHidden = !this.visible || this.box.w === 0;
    /**
     * ALREADY HERE IS NOT AN ARRIVAL (UR-139).
     *
     * `moveTo` re-ran the whole arrival every time it was called, including
     * when it was called with the BOX IT IS ALREADY ON - which a click on the
     * focused row does, and which `FocusList.adjust` does on every turn of a
     * knob. Each one dropped the ring to `FOCUS_ARRIVE_FROM` and faded it back,
     * and clicking a row twice read as a yellow flicker. The owner reported it
     * on the Keyboard row, where turning the selector does it on every step.
     *
     * Returning early also leaves the BREATH running, which is the second half
     * of why the old behaviour looked wrong: the pulse was being killed and
     * restarted mid-cycle, so the ring jumped brightness as well as flashing.
     */
    if (
      this.visible &&
      this.box.x === target.x &&
      this.box.y === target.y &&
      this.box.w === target.w &&
      this.box.h === target.h
    ) {
      return;
    }
    this.visible = true;
    // ================== THE RING DOES NOT TRAVEL (UR-75) ==================
    // It used to tween `this.box` - x, y, w AND h - from the old control to
    // the new one, redrawing every frame, so the ring visibly slid across the
    // screen and stretched from one button's shape into the next. The project
    // owner reported it while moving the mouse between the pilot card and
    // "new pilot": focus is a STATE, not an object that walks, and animating
    // the journey says the opposite - it draws the eye to the gap between two
    // controls rather than to the one that is now focused.
    //
    // So the box SNAPS and only the alpha moves: the ring leaves the old
    // control at once and fades up on the new one. `scenes/lib/kit.ts`'s ring
    // already worked this way, which is why the two kits disagreed and the
    // behaviour depended on which screen you were on.
    //
    // ONE TWEEN, REPLACED NOT STACKED. A pointer swept across three buttons
    // fires this three times; without the handle the old alpha tweens keep
    // running and fight the new one, which reads as a flicker.
    Object.assign(this.box, target);
    redraw();
    this.moveTween?.remove();
    // The breath belongs to the control the ring is ON. It stops here and is
    // started again on arrival, so a ring moving between two controls is never
    // mid-exhale on the one it is leaving.
    this.pulseTween?.remove();
    this.pulseTween = null;
    if (instant || wasHidden) {
      this.moveTween = null;
      this.g.setAlpha(1);
      this.startPulse();
      return;
    }
    // THE SHARED ARRIVAL (UR-113, `ui/focusPop.focusArrive`). This was
    // `setAlpha(0)` then a fade to 1 on `EASE.arrive`, so the ring blinked
    // fully OUT and back every time focus moved between two buttons on the
    // same screen - a frame of Settings with no focus anywhere on it. The kit
    // the owner named as the standard never drops the ring below 0.55.
    const arrive = focusArrive();
    this.g.setAlpha(arrive.alpha.from);
    this.moveTween = this.scene.tweens.add({
      targets: this.g,
      alpha: arrive.alpha.to,
      duration: arrive.duration,
      ease: arrive.ease,
      onComplete: () => {
        this.moveTween = null;
        // ARRIVE FIRST, THEN BREATHE. Two tweens writing alpha at once is a
        // ring that flickers on every focus move; the fade owns the first
        // `DUR.focus` ms and hands over when it is done.
        this.startPulse();
      },
    });
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
/**
 * THE EMPTY SEAT: the mark on the profile picker's "new pilot" row (UR-112).
 *
 * ================== WHY THE ROW NEEDS A MARK AT ALL ==================
 * "New pilot" was a `MenuButton` sitting above three `ListRow`s. Measured on
 * the served build, its box was 466x67 against the rows' 466x112 - the owner
 * reported it as reading differently from the list under it, and 45 px of
 * height is why. It is a `ListRow` now, and a `ListRow` is sized around its
 * glyph, so the only way it is the same box as a pilot's row is to carry the
 * same 84 px mark in the same place.
 *
 * ================== WHY A DASHED RING AND A PLUS ==================
 * It is deliberately the SHAPE of an avatar with nothing in it yet - the same
 * disc, the same radius, the same left inset - broken into an open ring so it
 * reads as a slot rather than as a seventh pilot mark a child might think they
 * already own. The plus is drawn, not typed (D83), so no font is involved and
 * it is the same stroke weight at any row height.
 *
 * The ink is the caller's: the row's accent, so the one row that starts
 * something is the one row with colour in its mark.
 */
export function drawNewPilotMark(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  color: string,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = size / 2;
  const tint = hexToNum(color);

  // The same sunken disc every avatar sits on, so the two marks share a footing.
  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillCircle(0, 0, r);

  // An OPEN ring: twelve arcs with twelve gaps, drawn as short chords so no
  // rounded-rect painter is involved and the dashes stay even at any radius.
  const DASHES = 12;
  g.lineStyle(3, tint, 0.85);
  for (let i = 0; i < DASHES; i += 1) {
    const a0 = (i / DASHES) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / (DASHES * 2);
    g.beginPath();
    g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    g.strokePath();
  }

  // The plus. Two bars, not a glyph.
  const arm = r * 0.44;
  const bar = Math.max(3, r * 0.16);
  g.fillStyle(tint, 1);
  g.fillRect(-arm, -bar / 2, arm * 2, bar);
  g.fillRect(-bar / 2, -arm, bar, arm * 2);

  c.add(g);
  return c;
}

/** Six marks, six inks, one family. */
export const AVATAR_INK: Readonly<Record<string, string>> = {
  "avatar-1": "#7FB2F0",
  "avatar-2": "#8FA6F2",
  "avatar-3": "#A79BEE",
  "avatar-4": "#79C2E8",
  "avatar-5": "#6FD0DA",
  "avatar-6": "#8ADCC8",
};

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
  const tint = hexToNum(AVATAR_INK[avatarId] ?? color);

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
    case "avatar-4": { // ring
      // A closed path, not `strokeEllipse`: at this stroke width its start and
      // end overlap and the join reads as a blip on the right.
      g.lineStyle(r * 0.18, tint, 1);
      const rx = r * 0.62;
      const ry = r * 0.26;
      g.beginPath();
      for (let i = 0; i <= 48; i += 1) {
        const a = (i / 48) * Math.PI * 2;
        const px = Math.cos(a) * rx;
        const py = Math.sin(a) * ry;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.strokePath();
      g.fillCircle(0, 0, r * 0.22);
      break;
    }
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
 * THE DASH COLOUR'S SWATCH: a lamp behind glass, burning in that colour
 * (UR-123).
 *
 * ================== WHY A LAMP AND NOT A SQUARE OF PAINT ==================
 * This mark is mounted on the Lantern's console, and `ui/panel.ts`'s whole
 * subject is that the console is hardware rather than a web form. A flat filled
 * circle is a colour chip out of a settings dialog; the same colour behind a
 * milled glass recess with a glow spilling onto the metal is the instrument the
 * value describes. The glow is the same `fillStyle(accent, 0.18)` spill the
 * illuminated toggle already paints when it is on, so the two lit things on
 * this panel light the metal the same way.
 *
 * ================== WHAT KEEPS IT HONEST ==================
 * The colour here is never the only carrier: the row prints the colour's NAME
 * behind glass at 4.5:1 and the detent lamps say which of six positions it is
 * (D41, AC-22.8). So a child who cannot separate teal from lime still reads the
 * row, which is the same rule the avatar set follows by being six silhouettes.
 *
 * Vector, in code, no raster (D83).
 */
export function drawDashSwatch(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  hex: string,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = size / 2;
  const tint = hexToNum(hex);

  // The light this lamp throws on the metal it is screwed to.
  g.fillStyle(tint, 0.18);
  g.fillCircle(0, 0, r);
  g.fillStyle(tint, 0.09);
  g.fillCircle(0, 0, r * 1.22);

  // The recess: the darkest surface on the panel, so the lamp has something to
  // burn against.
  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillCircle(0, 0, r * 0.78);

  // The lamp.
  g.fillStyle(tint, 1);
  g.fillCircle(0, 0, r * 0.58);

  // A recess is DARK along its top edge and LIT along the bottom - the inverse
  // of the raised hardware beside it, which is the one rule every surface on
  // this console is drawn under (art-direction s5, `ui/panel.ts`).
  g.lineStyle(3, hexToNum(INK.line), 1);
  g.strokeCircle(0, 0, r * 0.78);

  c.add(g);
  return c;
}

/**
 * A beacon: the reward object (D13). Lit beacons carry a soft accent glow and a
 * slow pulse; unlit ones are the same silhouette in the locked ink, so the
 * collection reads as "six more to light", never as six failures.
 */
/**
 * The box `drawBeacon` actually paints in, relative to the point it is given.
 *
 * ================== WHY THIS IS NOT THE BODY'S BOX (UR-145) ==================
 * The mast and base span y -34..48 and x -22..22 in the drawing's own units,
 * and a caller that insets by THOSE numbers clips the beacon - which is what
 * happened on the pilot rows. The LIT GLOW is a circle at y -22 with radius 26
 * that the blink tween scales to 1.22, so the real top is -53.7 and the real
 * half-width is 31.7, half again as wide as the body.
 *
 * Exported so a caller positions by the drawing rather than by the parts of it
 * somebody remembered - the same reason `pickerLayout.shadowOrigin` exists and
 * the same class of bug it was written for ("the literal 620 came to look
 * centred in the sky").
 */
export function beaconBox(size: number): {
  readonly top: number;
  readonly bottom: number;
  readonly halfW: number;
} {
  const s = size / 100;
  const glowReach = (22 + 26 * 1.22) * s;
  return { top: -glowReach, bottom: 48 * s, halfW: 26 * 1.22 * s };
}

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
 * A trophy mark (D74, D80, D83). Informational, never comparative: no tier, no
 * rank, no number of players who also have it.
 *
 * TWELVE TROPHIES, TWELVE MARKS. The first version drew ONE mark - a small
 * beacon - for all twelve, dimmed to about 10% for the eleven a new player has
 * not earned. On the captured screen that is twelve identical smudges: the icon
 * column carried no information, and what little shape there was sat at 1.3:1
 * against the panel. An unearned trophy is an INVITATION (D31/D74), so each one
 * is now a picture of the thing being offered - the belt you cross, the ring
 * you weave, the eye you need - and the unearned state is DIM BUT PRESENT
 * rather than almost absent.
 *
 * EARNED vs UNEARNED IS NOT CARRIED BY COLOUR ALONE (D41). Earned adds a lit
 * ring and a soft halo behind the mark; unearned is the same silhouette in the
 * dim ink with an unlit ring, which still reads on a desaturated screenshot and
 * under the colourblind palette.
 */
export function drawTrophy(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  accent: string,
  earned: boolean,
  glyph: TrophyGlyphId = "beacon",
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = size / 2;
  // The unearned ink is the DIM TEXT ink, not the locked ink: #3A4656 on
  // #0E1116 is 1.6:1, which is a shape you have to already know is there.
  const tint = earned ? hexToNum(accent) : hexToNum(INK.textDim);

  g.fillStyle(hexToNum(INK.panelSunken), 1);
  g.fillCircle(0, 0, r);
  if (earned) {
    g.fillStyle(hexToNum(accent), 0.14);
    g.fillCircle(0, 0, r * 0.96);
  }
  g.lineStyle(Math.max(2, r * 0.07), tint, earned ? 1 : 0.55);
  g.strokeCircle(0, 0, r);

  drawTrophyMark(g, r * 0.62, tint, earned ? 1 : 0.82, glyph);
  c.add(g);
  return c;
}

/**
 * The twelve marks, inside a disc of radius `u` at the origin.
 *
 * Kept as one switch rather than twelve exported functions: they are read as a
 * SET - a child scans the column and tells them apart from each other, not from
 * some absolute idea of "belt" - so they have to be legible side by side at
 * ~34 px, which is a thing you only get right by writing them together.
 */
function drawTrophyMark(
  g: Phaser.GameObjects.Graphics,
  u: number,
  tint: number,
  alpha: number,
  glyph: TrophyGlyphId,
): void {
  const line = Math.max(2, u * 0.16);
  g.fillStyle(tint, alpha);
  g.lineStyle(line, tint, alpha);

  switch (glyph) {
    case "beacon": // first light: a beacon, lit
      g.fillTriangle(-u * 0.52, u * 0.62, 0, -u * 0.18, u * 0.52, u * 0.62);
      g.fillCircle(0, -u * 0.48, u * 0.26);
      break;

    case "path": { // pathfinder: a dotted route with an arrow head
      const pts: [number, number][] = [
        [-u * 0.8, u * 0.55],
        [-u * 0.3, u * 0.05],
        [u * 0.2, u * 0.35],
      ];
      for (const [px, py] of pts) g.fillCircle(px, py, u * 0.15);
      g.beginPath();
      g.moveTo(-u * 0.8, u * 0.55);
      g.lineTo(u * 0.2, u * 0.35);
      g.strokePath();
      g.fillTriangle(u * 0.28, -u * 0.72, u * 0.78, -u * 0.1, u * 0.1, -u * 0.12);
      break;
    }

    case "belt": // belt runner: a band of rocks with a gap cut through it
      g.lineStyle(line * 0.8, tint, alpha * 0.8);
      g.strokeEllipse(0, 0, u * 1.8, u * 0.72);
      g.fillCircle(-u * 0.78, u * 0.06, u * 0.2);
      g.fillCircle(u * 0.72, -u * 0.12, u * 0.16);
      g.fillCircle(-u * 0.1, -u * 0.34, u * 0.13);
      g.fillCircle(u * 0.24, u * 0.32, u * 0.11);
      break;

    case "ring": // ring weaver: a ringed planet
      g.fillCircle(0, 0, u * 0.42);
      g.lineStyle(line, tint, alpha);
      g.strokeEllipse(0, 0, u * 1.9, u * 0.62);
      break;

    case "chain": // chain 25: two links
      g.lineStyle(line, tint, alpha);
      g.strokeRoundedRect(-u * 0.82, -u * 0.3, u * 0.82, u * 0.6, u * 0.3);
      g.strokeRoundedRect(0, -u * 0.3, u * 0.82, u * 0.6, u * 0.3);
      break;

    case "chainLong": // chain 50: a longer chain, on the diagonal
      g.lineStyle(line * 0.85, tint, alpha);
      for (let i = 0; i < 3; i += 1) {
        const o = (i - 1) * u * 0.62;
        g.strokeRoundedRect(o - u * 0.3, o - u * 0.24, u * 0.62, u * 0.48, u * 0.24);
      }
      break;

    case "eye": // sharp eye: a lens with a pupil
      g.lineStyle(line, tint, alpha);
      g.beginPath();
      g.moveTo(-u * 0.92, 0);
      g.lineTo(0, -u * 0.58);
      g.lineTo(u * 0.92, 0);
      g.lineTo(0, u * 0.58);
      g.closePath();
      g.strokePath();
      g.fillCircle(0, 0, u * 0.26);
      break;

    case "hull": // steady hull: a shield, unbroken
      g.beginPath();
      g.moveTo(0, -u * 0.82);
      g.lineTo(u * 0.68, -u * 0.46);
      g.lineTo(u * 0.68, u * 0.18);
      g.lineTo(0, u * 0.84);
      g.lineTo(-u * 0.68, u * 0.18);
      g.lineTo(-u * 0.68, -u * 0.46);
      g.closePath();
      g.fillPath();
      break;

    case "spool": // long memory: a tape spool
      g.lineStyle(line, tint, alpha);
      g.strokeCircle(0, 0, u * 0.78);
      g.strokeCircle(0, 0, u * 0.42);
      g.fillCircle(0, 0, u * 0.14);
      g.fillRect(-u * 0.1, -u * 0.86, u * 0.2, u * 0.22);
      break;

    case "map": { // map maker: a folded chart with a marked stop
      g.lineStyle(line * 0.85, tint, alpha);
      g.beginPath();
      g.moveTo(-u * 0.86, -u * 0.5);
      g.lineTo(-u * 0.29, -u * 0.72);
      g.lineTo(u * 0.29, -u * 0.5);
      g.lineTo(u * 0.86, -u * 0.72);
      g.lineTo(u * 0.86, u * 0.6);
      g.lineTo(u * 0.29, u * 0.82);
      g.lineTo(-u * 0.29, u * 0.6);
      g.lineTo(-u * 0.86, u * 0.82);
      g.closePath();
      g.strokePath();
      g.fillCircle(u * 0.1, u * 0.02, u * 0.2);
      break;
    }

    case "eclipse": // dark side: one disc eating another
      g.fillCircle(-u * 0.16, 0, u * 0.7);
      g.fillStyle(hexToNum(INK.panelSunken), 1);
      g.fillCircle(u * 0.34, -u * 0.1, u * 0.62);
      break;

    case "lamp": // last light: the final lamp, hanging
      g.lineStyle(line * 0.8, tint, alpha);
      g.beginPath();
      g.moveTo(0, -u * 0.9);
      g.lineTo(0, -u * 0.52);
      g.strokePath();
      g.fillTriangle(-u * 0.62, u * 0.26, 0, -u * 0.52, u * 0.62, u * 0.26);
      g.fillRect(-u * 0.26, u * 0.26, u * 0.52, u * 0.3);
      g.fillStyle(hexToNum(INK.panelSunken), 1);
      g.fillCircle(0, u * 0.02, u * 0.16);
      break;
  }
}
