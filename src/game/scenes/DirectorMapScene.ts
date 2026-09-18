import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { hexToNum, paletteAt } from "@game/render/palette";
import { EASE, buildParallax, type Parallax } from "@game/render/parallax";
import { ensureTextures, fillShape, starPoints } from "@game/render/textures";
import { DUR, INK, SKY_PLATE, SPACE, TYPE } from "@game/ui/theme";
import { headerText } from "@game/ui/grid";
import { hintOrigin } from "@game/ui/hint";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { LANTERN_DESIGN_HEIGHT, type LanternLivery, type LanternRig } from "@game/render/lantern";
import {
  CAPTION_GAP,
  CHIP,
  LAMP_RISE,
  MAP_HEADER_PAD_Y,
  NODE_R,
  NODE_RIM,
  PANEL_PAD,
  PANEL_STAR_R,
  ROUTE_X0,
  ROUTE_Y,
  SHADOW_SCALE,
  SHIP_SCALE,
  SHIP_Y,
  STAR_R,
  STAR_ROW_GAP,
  chipX,
  mapKeepClear,
  nodeStep,
  nodeX,
  panelBox,
  panelInkLeft,
  panelInkRight,
  panelStarsY,
  routeX1,
  shadowAt,
  starsCentreForRight,
  type PanelBox,
} from "./support/mapLayout";
import { STOP_IDS, isBeltStop, type StopId, type StopProgress } from "@engine/types";
import {
  createFocusRing,
  createKeyboardMenu,
  label,
  plate,
  skyText,
  skyTextSamples,
  visibleText,
  type FocusTarget,
  type KeyboardMenu,
  type SceneSnapshot,
  type Snapshotable,
} from "./lib/kit";
import { litCount, routeView, type StopView } from "@engine/progress/index.js";
import { hasStageBundle, stageBundle } from "./lib/content";
import { hasPersonalBest, mapBoardLine } from "./support/mapBoard";
import {
  goTo,
  progressFor,
  resolveInit,
  withStoredProgress,
  type ResolvedInit,
  type StoryInit,
} from "./lib/init";
import { drawPlayerLantern, playerLivery } from "./lib/livery";

/**
 * Screen inventory row 3 - Director map (D13, D40, D27, D43).
 *
 * Earth to Pluto in a line, Destiny-style: a route, not a level select. The
 * screen's whole job is the sense of progress, so the blink is the design.
 *
 * WHY THE BLINK IS STAGGERED. A row of beacons all pulsing on the same beat
 * reads as decoration - a loading spinner with seven dots. Here each charted
 * beacon fires on the same period but phase-shifted by its distance from
 * Earth, so the light RUNS outward along the route and stops dead at the
 * furthest beacon the child has placed. The dark half of the line is visibly
 * waiting for the next one. That is what makes the blink feel earned, and it
 * costs one subtraction per node.
 *
 * Locked stops are drawn, not hidden, and stay focusable: a child can look at
 * Pluto from day one. Locked is "not yet", never "denied" (D31, AC-22b.1) -
 * there is no cross, no red and no lock icon that reads as a refusal.
 *
 * Entry points to the Beacon Log and Settings live here (design brief 3), and
 * so does the per-stop personal-best board (D43). The board is personal-best
 * only; no global rank is rendered anywhere on this screen (AC-18.3).
 *
 * ---------------------------------------------------------------------------
 * THE GEOMETRY LIVES IN `support/mapLayout.ts`, with no Phaser in it.
 *
 * It was here, as module-level constants, and three user reports against this
 * screen (UR-52 debris over the planets, UR-53 no ship above the current
 * planet, UR-54 nothing on the shared grid) could only be checked by looking at
 * a capture. Everything positional moved out so a unit test can hold it.
 *
 * Anything that depends on the world's width is a FUNCTION there, for the
 * reason `sceneKeys` gives (D99): a top-level `const` off `GAME_WIDTH` freezes
 * 1920 at import time, before `bootGame` has measured the window, which would
 * pin Pluto and the right edge of the board 320 px inside a 21:9 frame.
 */
const BLINK_PERIOD_MS = 2600;
const BLINK_STAGGER = 0.085;

interface NodeView {
  readonly stopId: StopId;
  readonly x: number;
  readonly charted: boolean;
  readonly locked: boolean;
  readonly accent: string;
  readonly beacon: Phaser.GameObjects.Graphics;
}

export class DirectorMapScene extends Phaser.Scene implements Snapshotable {
  private story!: ResolvedInit;
  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private menu!: KeyboardMenu;
  private nodes: NodeView[] = [];
  private routeG!: Phaser.GameObjects.Graphics;
  /** The single route derivation every part of this screen draws from. */
  private view: readonly StopView[] = [];
  private panelTitle!: Phaser.GameObjects.Text;
  private panelChapter!: Phaser.GameObjects.Text;
  private panelBoard!: Phaser.GameObjects.Text;
  private panelAction!: Phaser.GameObjects.Text;
  private panelStars!: Phaser.GameObjects.Graphics;
  /** UR-53: the Lantern, hovering over whichever stop is selected. */
  private lantern: LanternRig | null = null;
  /**
   * UR-48 evidence: the four colours this screen DREW the ship with.
   *
   * THE SAME OBJECT that is handed to the drawing, resolved once, not a second
   * call to the resolver sitting beside the draw call. A parallel accumulator
   * reports the right answer while the drawing uses a hardcoded one, and that
   * is the exact shape of the defect this field exists to make visible
   * (`docs/verification-gaps.md`; `FlightScene.livery` says the same thing).
   * `undefined` in a standalone mount with no store - see `lib/livery.ts`.
   */
  private shipLivery: LanternLivery | undefined = undefined;
  private shipTween: Phaser.Tweens.Tween | null = null;
  private selected: StopId = "earth";
  /** How many star glyphs the screen has actually drawn (D27 evidence). */
  private starGlyphs = 0;

  constructor() {
    super(SCENE_KEYS.map);
  }

  init(data: StoryInit): void {
    // THE MAP IS THE SCREEN THE ROUTE IS READ OFF, so it reads the profile.
    //
    // It is reached with no payload from the Title, from Pause, from the Beacon
    // Log and - the case that reported this bug - from a reload. `resolveInit`
    // defaults a missing `progress` to `[]`, which renders a charted route as
    // seven locked stops and no lit beacons. `withStoredProgress` fills it from
    // the store when the caller supplied none, so what the map draws is what the
    // player actually did.
    //
    // A supplied payload still wins, which is what keeps the screen-inventory
    // variants ("Mars only unlocked", "mid-run", "all seven") mountable.
    this.story = resolveInit(withStoredProgress(this, data), "earth");
    this.nodes = [];
    this.starGlyphs = 0;
    this.lantern = null;
    this.shipLivery = undefined;
    this.shipTween = null;
  }

  create(): void {
    const { text, ctx, progress } = this.story;
    ensureTextures(this);
    this.cameras.main.setBackgroundColor(INK.bgDeep);

    // The chart's own sky: Earth's night palette, no planet framing and no
    // debris plane - this is a map, not a place.
    this.parallax = buildParallax(this, {
      palette: paletteAt("earth", ctx.colorblindPalette),
      reducedMotion: ctx.reducedMotion,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      decorate: ["sky", "farField", "midField", "nearField"],
      // NOTHING TRAVELS ON THIS SCREEN (UR-50.5). `worldSpeed: 0` never did
      // this on its own: `DRIFT_X` gives every decorative plane a px/s FLOOR
      // (+5, -8, +11, -15) that runs at any world speed, so the planes marched
      // across the frame while the comment next to them said they did not.
      crossDrift: false,
      seed: 0x0d13,
      // UR-52: decorative debris drew ACROSS the planets on this screen. The
      // planets, their lamps, their captions and this screen's chrome, as
      // shapes the debris planes are told to avoid. See `mapLayout.mapKeepClear`
      // for why the list is what it is, and `render/keepClear.ts` for why the
      // mechanism is shared with the Title rather than re-derived here.
      keepClear: mapKeepClear(),
    });

    // ONE DERIVATION FOR THE WHOLE SCREEN (D13, engine/progress `routeView`).
    //
    // The header used to count `isCharted` while the labels and discs read
    // `unlockedStops`. Two readers, two fields, and a capture that said
    // "7 of 7 beacons lit" over seven stops labelled "Locked". Everything
    // below - count, disc, label, lamp, route line, focus - now reads this one
    // array, so the header and the label under a planet cannot disagree.
    this.view = routeView(progress, STOP_IDS);
    const lit = litCount(progress);

    // THE HEADER SITS ON A PLATE (AC-22.8). Sky-borne chrome was the one place
    // the contrast rubric never looked, and five screens shipped at 1.2-1.7:1.
    const head = headerText(0, undefined, 14);
    skyText(this, head.x, head.y, text.text("map.heading"), {
      screen: "map",
      id: "map.heading",
      size: TYPE.heading,
      color: INK.text,
      lang: this.story.lang,
      depth: 10,
      padY: 14,
    });
    const sub = headerText(1, undefined, MAP_HEADER_PAD_Y);
    skyText(this, sub.x, sub.y, text.text("map.subheading"), {
      screen: "map",
      id: "map.subheading",
      size: TYPE.caption,
      // `textFaint` measures 3.4:1 even on the plate, so the subheading is
      // `textDim` and the hierarchy is carried by SIZE instead of by dimness.
      color: INK.textDim,
      lang: this.story.lang,
      depth: 10,
      padY: 8,
    });
    const third = headerText(2, undefined, MAP_HEADER_PAD_Y);
    skyText(
      this,
      third.x,
      third.y,
      text.text("map.progress", { lit, total: STOP_IDS.length }),
      {
        screen: "map",
        id: "map.progress",
        size: TYPE.caption,
        color: INK.lit,
        lang: this.story.lang,
        depth: 10,
        padY: 8,
      },
    );

    this.routeG = this.add.graphics().setDepth(3);
    this.buildNodes();

    // --- the personal-best board (D43) -----------------------------------
    //
    // UR-54: the board at the foot of the screen is to start on the same left
    // edge as the heading above it. It is the content column now
    // (`mapLayout.panelBox`), so
    // its plate starts where the heading's plate starts and ends where the
    // heading's column ends, and every line inside it hangs off ONE inset -
    // the title used 40 and the two lines under it 42.
    const PANEL = panelBox();
    const inkLeft = panelInkLeft();
    // Opaque: a card the size of this one shows the sky behind it as a SHAPE,
    // not a tint. See `lib/kit.plate`.
    plate(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h).setDepth(9);
    this.panelTitle = label(this, inkLeft, PANEL.y + 34, "", {
      size: TYPE.heading,
      color: INK.text,
      lang: this.story.lang,
    }).setDepth(10);
    this.panelChapter = label(this, inkLeft, PANEL.y + 96, "", {
      size: TYPE.caption,
      color: INK.textDim,
      lang: this.story.lang,
    }).setDepth(10);
    this.panelBoard = label(this, inkLeft, PANEL.y + 146, "", {
      size: TYPE.body,
      color: INK.textDim,
      lang: this.story.lang,
    }).setDepth(10);
    this.panelStars = this.add.graphics().setDepth(10);
    // UR-54: the travel label and the three stars did not share a right edge.
    // Both hang off ONE
    // right-hand ink line now; `drawStars` is given the centre that puts the
    // cluster's right EDGE on it (`starsCentreForRight`), which is the 42.4 px
    // the two were out by.
    this.panelAction = label(this, panelInkRight(), PANEL.y + 40, "", {
      size: TYPE.label,
      color: INK.accent,
      align: "right",
      lang: this.story.lang,
    })
      .setOrigin(1, 0)
      .setDepth(10);

    // UR-54 / UR-19: the hint is a GRID LINE, bottom-left, like every other
    // screen's. It was centred on the world at `GAME_HEIGHT - 66`, which is one
    // of the six different hint positions the blind critic measured.
    const hint = hintOrigin(SKY_PLATE.padX, MAP_HEADER_PAD_Y);
    skyText(this, hint.x, hint.y, text.text("map.hint"), {
      screen: "map",
      id: "map.hint",
      size: TYPE.caption,
      color: INK.textDim,
      lang: this.story.lang,
      depth: 10,
      padY: MAP_HEADER_PAD_Y,
    });

    const shadowAnchor = shadowAt();
    this.shadow = drawShadow(this, shadowAnchor.x, shadowAnchor.y, "idle", {
      scale: SHADOW_SCALE,
      reducedMotion: ctx.reducedMotion,
      depth: 11,
    });

    this.buildLantern(ctx.reducedMotion);

    // --- focus order: seven stops, then the two entry points --------------
    const targets: FocusTarget[] = this.nodes.map((n) => ({
      id: n.stopId,
      x: n.x - NODE_R - 14,
      y: ROUTE_Y - NODE_R - 14,
      w: (NODE_R + 14) * 2,
      h: (NODE_R + 14) * 2,
      locked: n.locked,
      activate: () => this.travel(n),
    }));
    targets.push(...this.buildChips());

    const ring = createFocusRing(this, 40);
    const startIndex = Math.max(
      0,
      this.nodes.findIndex((n) => !n.locked && !n.charted),
    );
    this.menu = createKeyboardMenu(this, ring, targets, {
      axis: "horizontal",
      startIndex: startIndex === -1 ? 0 : startIndex,
      // ESCAPE LEAVES THE MAP (UR-86). `onBack` is OPTIONAL on this kit, and
      // this screen never passed one, so Escape did nothing and the map was a
      // dead end: every route out of it goes deeper - a stop, the log, the
      // settings - and there was no way back to the title at all. AC-18.1 says
      // every screen is returnable by keyboard, and the map was not.
      //
      // Six of the seven screens on this kit pass no `onBack`. The other five
      // are deliberate: Warp is mid-jump, Results and Beacon would let a child
      // rewind story state that has already been written. The map is the hub,
      // so it is the one that was simply missed.
      onBack: () => {
        goTo(this, SCENE_KEYS.title, this.forward());
      },
    });
    this.events.on("kb-focus", (_index: number, target: FocusTarget | undefined) => {
      if (target !== undefined) this.select(target.id);
    });
    this.select(targets[this.menu.index]?.id ?? "earth");

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  /**
   * UR-53: the ship is to hover above the stop the screen is currently about.
   *
   * There was no ship on this screen at all - the map drew the route and the
   * Shadow and nothing that was the player. It hovers over the SELECTED stop;
   * `mapLayout` records why selection rather than furthest-beacon progress.
   *
   * ONE `drawLantern`, never a private copy of the drawing (coding-standards
   * rule 3: a private method in `FlightScene` is what the one-implementation
   * guard could not see, and it was the ship on screen for the entire game).
   *
   * `exhaust: false`, `beam: false`. A ship holding station is not burning, and
   * the plume would reach 152 design units past the nozzle - a third again as
   * tall - straight into the beacon lamp below it. `iris: 0.35` keeps the
   * instrument lit so it reads as the same object the Title and Flight draw.
   */
  private buildLantern(reducedMotion: boolean): void {
    // IT IS THE PILOT'S OWN HULL (UR-48). This screen drew the ship in the
    // file constants, deliberately, matching `WarpScene` - and that was
    // recorded at the time as coding-standards rule 2 in a different place,
    // owed its own ticket rather than smuggled into the one that put the ship
    // here. This is that ticket. `lib/livery.drawPlayerLantern` resolves
    // `profile.shipId` (and its earned skin) through the one seam, so the ship
    // hovering over the route is the ship the child chose and the ship they
    // fly. Resolved into a field first so what is REPORTED is the same object
    // that was DRAWN WITH, never a second computation beside it.
    this.shipLivery = playerLivery(this);
    this.lantern = drawPlayerLantern(this, nodeX(0), SHIP_Y, {
      scale: SHIP_SCALE,
      reducedMotion,
      livery: this.shipLivery,
      idleBob: true,
      exhaust: false,
      beam: false,
      iris: 0.35,
    });
    // The ship plane (depth 6), which is in FRONT of every debris plane this
    // screen decorates - so the ship needs no keep-clear zone of its own.
    this.parallax.layerOf("shipFx").container.add(this.lantern.container);
  }

  /** Move the ship to stop `i`. Eased, because a cursor that teleports reads
   *  as a redraw rather than as a ship (AC-22.5; D41 stills it). */
  private moveShipTo(i: number): void {
    const ship = this.lantern;
    if (ship === null) return;
    const x = nodeX(i);
    this.shipTween?.remove();
    this.shipTween = null;
    if (this.story.ctx.reducedMotion) {
      ship.container.setX(x);
      return;
    }
    this.shipTween = this.tweens.add({
      targets: ship.container,
      x,
      duration: DUR.panel,
      ease: EASE.arrive,
    });
  }

  private buildChips(): FocusTarget[] {
    const { text } = this.story;
    const logX = chipX(0);
    const settingsX = chipX(1);
    const make = (
      id: string,
      x: number,
      copy: string,
      onGo: () => void,
    ): FocusTarget => {
      plate(this, x, CHIP.y, CHIP.w, CHIP.h, { fill: INK.panelRaised }).setDepth(9);
      label(this, x + CHIP.w / 2, CHIP.y + CHIP.h / 2, copy, {
        size: TYPE.label,
        color: INK.text,
        align: "center",
        lang: this.story.lang,
      })
        .setOrigin(0.5)
        .setDepth(10);
      return { id, x, y: CHIP.y, w: CHIP.w, h: CHIP.h, activate: onGo };
    };
    return [
      make("beaconLog", logX, text.text("title.beaconLog"), () =>
        goTo(this, SCENE_KEYS.beaconLog, this.forward()),
      ),
      make("settings", settingsX, text.text("title.settings"), () =>
        goTo(this, SCENE_KEYS.settings, this.forward()),
      ),
    ];
  }

  private buildNodes(): void {
    const { progress, ctx } = this.story;

    this.view.forEach((stop, i) => {
      const { stopId, charted, locked } = stop;
      const x = nodeX(i);
      const pal = paletteAt(stopId, ctx.colorblindPalette);
      const entry = progressFor(progress, stopId);

      // The planet disc. A locked stop keeps its silhouette and loses its
      // colour: it is still recognisably Pluto, just not lit yet.
      const disc = this.add.graphics().setDepth(4);
      // The lit face of the planet. Earth's sky role is night navy, which on a
      // navy chart reads as a hole rather than a world, so its atmosphere role
      // wins where a palette defines one.
      const body = locked
        ? INK.locked
        : (pal.colorRoles["atmosphere"] ?? pal.colorRoles["sky"] ?? pal.colors[2] ?? INK.locked);
      const shade = locked ? INK.panelSunken : (pal.colors[pal.colors.length - 1] ?? INK.bgDeep);
      disc.fillStyle(hexToNum(INK.bgDeep), 1);
      disc.fillCircle(x, ROUTE_Y, NODE_R + NODE_RIM);
      disc.fillStyle(hexToNum(body), 1);
      disc.fillCircle(x, ROUTE_Y, NODE_R);
      // Offset + radius stays under 1.0 so the night side cannot spill past
      // the limb and draw a second, larger disc behind the planet.
      disc.fillStyle(hexToNum(shade), 0.55);
      disc.fillCircle(x + NODE_R * 0.22, ROUTE_Y + NODE_R * 0.2, NODE_R * 0.66);
      disc.lineStyle(3, hexToNum(locked ? INK.line : pal.accent), locked ? 0.7 : 0.95);
      disc.strokeCircle(x, ROUTE_Y, NODE_R);

      const beacon = this.add.graphics().setDepth(6);

      // THE CAPTION IS ONE BLOCK ON ONE PLATE, and its words come from the
      // same `routeView` entry as the disc above it.
      //
      // Both lines used to be INK.locked - the dimmest ink in the theme - on
      // open chart sky, measured at 1.4:1. A child aged seven cannot read that,
      // and "Locked" was the word they could not read under a lamp that said
      // they had finished. "Not yet" is still said by the DIMMER of two legible
      // inks, never by an illegible one (D31: not-yet, never denied).
      const status = locked
        ? this.story.text.text("map.locked")
        : charted
          ? this.story.text.text("map.charted")
          : "";
      skyText(
        this,
        x,
        ROUTE_Y + NODE_R + CAPTION_GAP,
        status === "" ? this.stopName(stopId) : `${this.stopName(stopId)}\n${status}`,
        {
          screen: "map",
          id: `map.stop.${stopId}`,
          size: TYPE.label,
          color: locked ? INK.textDim : INK.text,
          align: "center",
          lang: this.story.lang,
          depth: 7,
          originX: 0.5,
          padX: 16,
          padY: 8,
        },
      );

      if (!locked && charted && isBeltStop(stopId)) {
        // D27: each charted stop shows its star rating, right on the map.
        // Earth is exempt by construction: it has no belt, so it has no hull
        // hits and therefore no rating (types.ts, BELT_STOP_IDS). Drawing three
        // empty stars under Earth would invent a nought out of nothing.
        // BELOW the caption plate, not through it. The plate is two lines of
        // TYPE.label plus padding - about 78px - so the stars start after it.
        this.drawStars(
          this.add.graphics().setDepth(7),
          x,
          ROUTE_Y + NODE_R + STAR_ROW_GAP,
          STAR_R,
          entry.stars,
          pal.accent,
        );
      }

      this.nodes.push({ stopId, x, charted, locked, accent: pal.accent, beacon });
    });
  }

  /** Three stars, `earned` of them filled. Never a zero-score readout (D31). */
  private drawStars(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    earned: number,
    accent: string,
  ): void {
    const gap = r * 2.6;
    for (let i = 0; i < 3; i += 1) {
      this.starGlyphs += 1;
      const x = cx - gap + gap * i;
      const pts = starPoints(x, cy, r, r * 0.46);
      if (i < earned) {
        g.fillStyle(hexToNum(accent), 1);
        fillShape(g, pts);
      } else {
        // The empty star is an OUTLINE on open sky, so it is drawn in the same
        // dim-but-legible ink as the "not yet" caption rather than in
        // INK.locked, which disappears into the chart at 1.6:1. Three stars a
        // child cannot count is a rating that does not exist.
        g.lineStyle(2, hexToNum(INK.textDim), 0.75);
        g.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.closePath();
        g.strokePath();
      }
    }
  }

  private stopName(stopId: StopId): string {
    return hasStageBundle(stopId)
      ? stageBundle(stopId).planetName
      : paletteAt(stopId, false).name;
  }

  private select(stopId: string): void {
    if (!STOP_IDS.includes(stopId as StopId)) {
      // A chip is focused, not a stop: leave the board showing the last stop.
      return;
    }
    const stop = stopId as StopId;
    this.selected = stop;
    this.moveShipTo(STOP_IDS.indexOf(stop));
    const { text, progress } = this.story;
    const entry: StopProgress = progressFor(progress, stop);
    const bundle = hasStageBundle(stop) ? stageBundle(stop) : null;
    const locked = this.view.find((v) => v.stopId === stop)?.locked ?? true;

    this.panelTitle.setText(this.stopName(stop));
    this.panelChapter.setText(bundle?.chapterTitle ?? "");

    // Earth has no flight, so it has no WPM and no accuracy to be best at.
    //
    // The line moved to `support/mapBoard.ts` so it can be driven with the
    // values the STORE holds. `bestAccuracy` is a 0..1 fraction everywhere it
    // is produced and the schema clamps it to [0, 1] on load, but this line
    // used to render `Math.round(entry.bestAccuracy)` — so a 97% run read
    // "1% accurate". It stayed green because every map fixture injects
    // percent-scale progress as scene data (`story-lane.charted` passes 96)
    // and the one store-level seed helper leaves the rates at zero, so no test
    // in the repo had ever put a real accuracy on this screen.
    const hasRun = hasPersonalBest(entry, stop);
    this.panelBoard.setText(mapBoardLine(entry, stop, text));

    this.panelStars.clear();
    if (hasRun) {
      this.drawStars(
        this.panelStars,
        starsCentreForRight(panelInkRight(), PANEL_STAR_R),
        panelStarsY(),
        PANEL_STAR_R,
        entry.stars,
        paletteAt(stop, this.story.ctx.colorblindPalette).accent,
      );
    }

    this.panelAction.setText(
      locked ? text.text("map.locked") : text.text("map.travel"),
    );
    // The board is a plate, but INK.locked on INK.panel is 1.6:1 - the same
    // failure as the map labels, indoors. `textDim` is 7.9:1 on the panel.
    this.panelAction.setColor(locked ? INK.textDim : INK.accent);
  }

  private travel(node: NodeView): void {
    if (node.locked) {
      // Nothing happens, and nothing tells the child off for asking (D31).
      return;
    }
    if (node.stopId === "earth") {
      goTo(this, SCENE_KEYS.earthActivation, this.forward(node.stopId));
      return;
    }
    goTo(this, SCENE_KEYS.briefing, this.forward(node.stopId));
  }

  private forward(stopId?: StopId): StoryInit {
    return {
      ctx: stopId === undefined ? this.story.ctx : { ...this.story.ctx, stopId },
      progress: this.story.progress,
      shipName: this.story.shipName,
      lang: this.story.lang,
      newProfile: this.story.newProfile,
      calibration: this.story.calibration,
      ...(stopId === undefined ? {} : { stopId }),
    };
  }

  override update(time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(time);
    this.drawRoute(time);
    for (const node of this.nodes) this.drawBeacon(node, time);
  }

  /**
   * The route line. A segment between two charted stops is lit and carries a
   * pulse travelling outward; everything past the furthest beacon is a quiet
   * dotted guide, so the unlit half of the map reads as "still to draw".
   */
  private drawRoute(time: number): void {
    const g = this.routeG;
    g.clear();
    for (let i = 0; i < this.nodes.length - 1; i += 1) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      if (a === undefined || b === undefined) continue;
      const x0 = a.x + NODE_R + 10;
      const x1 = b.x - NODE_R - 10;
      const bothLit = a.charted && b.charted;
      if (bothLit) {
        g.lineStyle(4, hexToNum(a.accent), 0.55);
        g.lineBetween(x0, ROUTE_Y, x1, ROUTE_Y);
        const phase = ((time / BLINK_PERIOD_MS) - i * BLINK_STAGGER) % 1;
        const px = x0 + (x1 - x0) * ((phase + 1) % 1);
        g.fillStyle(hexToNum(INK.accentSoft), 0.9);
        g.fillCircle(px, ROUTE_Y, 6);
        g.fillStyle(hexToNum(INK.accentSoft), 0.25);
        g.fillCircle(px, ROUTE_Y, 14);
      } else {
        g.fillStyle(hexToNum(INK.line), 0.85);
        const dots = Math.floor((x1 - x0) / 26);
        for (let d = 0; d <= dots; d += 1) {
          g.fillCircle(x0 + d * 26, ROUTE_Y, 3);
        }
      }
    }
  }

  /**
   * The beacon on a charted stop: a lamp on a short mast that pulses on the
   * shared period, phase-shifted by distance from Earth.
   */
  private drawBeacon(node: NodeView, time: number): void {
    const g = node.beacon;
    g.clear();
    if (!node.charted) return;
    const i = STOP_IDS.indexOf(node.stopId);
    const phase = ((time / BLINK_PERIOD_MS - i * BLINK_STAGGER) % 1 + 1) % 1;
    // Sharp attack, long decay: a lighthouse, not a sine.
    const strength = phase < 0.12 ? phase / 0.12 : Math.max(0, 1 - (phase - 0.12) / 0.88) ** 2;
    const lx = node.x;
    const ly = ROUTE_Y - NODE_R - LAMP_RISE;
    const c = hexToNum(node.accent);
    g.lineStyle(3, c, 0.8);
    g.lineBetween(lx, ROUTE_Y - NODE_R + 14, lx, ly + 6);
    g.fillStyle(c, 0.1 + 0.22 * strength);
    g.fillCircle(lx, ly, 34 + 16 * strength);
    g.fillStyle(c, 0.35 + 0.45 * strength);
    g.fillCircle(lx, ly, 15);
    g.fillStyle(hexToNum(INK.accentSoft), 0.5 + 0.5 * strength);
    g.fillCircle(lx, ly, 7);
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.map,
      selected: this.selected,
      focusIndex: this.menu.index,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      litCount: this.nodes.filter((n) => n.charted).length,
      // UR-53 evidence: where the ship IS, and where the selected planet is.
      // Two numbers taken in one read, so they describe one moment (rule 7).
      ship:
        this.lantern === null
          ? null
          : {
              x: this.lantern.container.x,
              y: this.lantern.container.y,
              targetX: nodeX(STOP_IDS.indexOf(this.selected)),
            },
      // UR-48 evidence: the hull the pilot is wearing, as this screen drew it.
      // Null in a standalone mount with no store, which is the case that must
      // keep the reference sheet's constants (`lib/livery.ts`).
      shipLivery: this.shipLivery ?? null,
      skyText: skyTextSamples(this),
      starGlyphs: this.starGlyphs,
      entryPoints: this.menu.targets
        .map((t) => t.id)
        .filter((id) => id === "beaconLog" || id === "settings"),
      stops: this.nodes.map((n) => ({
        stopId: n.stopId,
        charted: n.charted,
        locked: n.locked,
        stars: progressFor(this.story.progress, n.stopId).stars,
        bestWpm: progressFor(this.story.progress, n.stopId).bestWpm,
      })),
      text: visibleText(this),
    };
  }

  private teardown(): void {
    this.shipTween?.remove();
    this.shipTween = null;
    this.lantern?.destroy();
    this.lantern = null;
    this.shipLivery = undefined;
    this.menu.destroy();
    this.shadow.destroy();
    this.parallax.destroy();
  }
}

/**
 * Focus-ring geometry, exported so the e2e can assert it is on screen.
 *
 * A re-export of `support/mapLayout.ts` now, which is where the numbers live
 * and where the unit suite holds them. Getters for the two members that depend
 * on the world's width (D99): a plain object literal here would snapshot 1920
 * at import time and the e2e would be asserting against a map the game is not
 * drawing.
 */
export const MAP_GEOMETRY = {
  ROUTE_Y,
  ROUTE_X0,
  get ROUTE_X1(): number {
    return routeX1();
  },
  NODE_R,
  get STEP(): number {
    return nodeStep();
  },
  get PANEL(): PanelBox {
    return panelBox();
  },
  get SHIP_Y(): number {
    return SHIP_Y;
  },
  SPACE,
};
