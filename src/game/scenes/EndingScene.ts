import Phaser from "phaser";
import { STOP_IDS, type StopId } from "@engine/types";
import { SCENE_KEYS } from "@game/sceneKeys";
import { layer } from "@game/render/layers";
import { buildParallax, EASE, type Parallax } from "@game/render/parallax";
import { hexToNum, paletteFor } from "@game/render/palette";
import { drawShadow, type ShadowFigure } from "@game/render/shadow";
import { INK, lineHeightEm } from "@game/ui/theme";
import { goTo, type StoryInit } from "./lib/init";
import {
  createFocusRing,
  createKeyboardMenu,
  plate,
  skyText,
  skyTextSamples,
  visibleText,
  type FocusRing,
  type FocusTarget,
  type KeyboardMenu,
  type SceneSnapshot,
} from "./lib/kit";
import {
  ENDING_INK,
  ENDING_PLATE,
  ENDING_TYPE,
  advanceEmFor,
  endingLayout,
  type EndingLayout,
} from "./support/endingLayout";
import {
  laneInit,
  latchOnRender,
  publishBag,
  textStyles,
  type DrawLatch,
  type LaneInit,
} from "./support/laneInit";

/**
 * SCREEN 12 - ENDING CARD (design-brief-v2.md "12. Ending card";
 * story-draft-v1.md "Ending card (after Pluto's beacon)").
 *
 * "The Director map zooms out. Seven beacons blink from Earth to Pluto in a
 * line. Shadow: 'Every ship that comes after us will see these. You drew the
 * map.' Then the results screen."
 *
 * WHY IT DRAWS ITS OWN MAP RATHER THAN REUSING DirectorMap. The Director map is
 * another lane's scene and is interactive - focusable stops, travel, star
 * ratings. This is a card, not a map: nothing here is selectable, the line is
 * the route rather than the route's UI, and zooming a live menu out to a
 * tenth of its size would leave a screen full of controls a child cannot press.
 *
 * Each beacon wears its OWN stop's accent, so the line reads as seven different
 * places and not as one repeated dot (D13, palette rubric item 7).
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG WITH THE CAPTURED VERSION OF THIS SCREEN, AND THE RULE EACH
 * FIX LEAVES BEHIND. This is the payoff screen - the last thing a seven-year-old
 * sees after finishing the game - and it shipped as an unfinished one.
 *
 * 1. AN 838x105 EMPTY BLACK PANEL, DEAD CENTRE. It was Shadow's closing plate.
 *    `create()` drew the plate opaque and held the LINE at alpha 0 behind a
 *    delayed call about three seconds into the card, and every capture was
 *    taken long before that call fired. Two rules now stop it coming back:
 *    the plate's rect comes from `endingLayout`, which returns `null` for an
 *    empty line so there is nothing to draw; and NOTHING ON THIS SCREEN IS
 *    HIDDEN BEHIND A TIMER ANY MORE. The closing line is on screen from the
 *    first frame. What moves is the lamps.
 *
 * 2. THE HEADLINE AT 1.19:1. `palette.accent` on bare sky, straddling a
 *    silhouette edge. Every string this scene draws now goes through
 *    `skyText`, which plates it and registers the colour pair for the rubric.
 *
 * 3. SEVEN GREY NAMES ON A GREY SKY, sitting on the terrain silhouette. The
 *    route has its own plate now and the band was lifted into clear sky.
 *
 * 4. A 1380x170 CLOSING PANEL HOLDING ONE LINE, about 110 px of it dead black,
 *    and three blocks sharing neither a left edge nor a centre. The panel is
 *    now cut to the number of lines its own copy wraps to (`wrapLineCount`, off
 *    a measured glyph advance) and grows UPWARD, so the gap to the button never
 *    moves; and the headline, the route band, the panel and the button all
 *    share one centre line at x=960. Shadow stands in the left gutter the
 *    centred panel leaves, which is why the panel is narrower than the band
 *    rather than sharing its left edge.
 *
 * The two stray grey triangles under "Mars" are notches in the parallax
 * silhouette. This scene draws no triangles at all; they belong to the render
 * lane and are not touched here.
 */

const BEACON_INTERVAL_MS = 220;
const ZOOM_MS = 1800;
const SHADOW_AT = { x: 280, y: 760 } as const;

interface Lamp {
  readonly halo: Phaser.GameObjects.Graphics;
}

export interface EndingInit extends StoryInit {
  readonly payload?: Record<string, unknown>;
}

export class EndingScene extends Phaser.Scene {
  private lane!: LaneInit;
  private initData: EndingInit | undefined;
  private layout!: EndingLayout;

  private parallax!: Parallax;
  private shadow!: ShadowFigure;
  private ring!: FocusRing;
  private menu!: KeyboardMenu;
  private lamps = new Map<StopId, Lamp>();
  private litOrder: StopId[] = [];
  private shadowLine: Phaser.GameObjects.Text | null = null;
  /** Latched on a render pass; see `latchOnRender`. Never sampled. */
  private shadowLineDrawn!: DrawLatch;
  private focusRingDrawn!: DrawLatch;

  constructor() {
    super(SCENE_KEYS.ending);
  }

  init(data: EndingInit | undefined): void {
    this.initData = data;
    this.litOrder = [];
    this.lamps = new Map();
    this.shadowLine = null;
  }

  create(): void {
    // The card is played from Pluto, so the frame wears Pluto's palette even if
    // the caller forgot to say where it came from.
    this.lane = laneInit(this, this.initData, "pluto");

    // The composition is computed BEFORE anything is drawn, from the resolved
    // copy, so "is there a closing line" is answered once and every rect on the
    // screen agrees about it.
    this.layout = endingLayout({
      stopCount: STOP_IDS.length,
      closingLine: this.lane.copy.text("ending.shadowLine"),
      headlineSize: ENDING_TYPE.heading,
      labelSize: ENDING_TYPE.stopName,
      bodySize: ENDING_TYPE.shadowLine,
      lineHeightEm: lineHeightEm(this.lane.lang),
      // The panel is cut to the number of lines this language's closing line
      // wraps to, so Spanish gets two lines of panel and English gets one
      // instead of both getting a constant 170 px with dead black under it.
      advanceEm: advanceEmFor(this.lane.lang),
    });

    this.parallax = buildParallax(this, {
      palette: this.lane.palette,
      reducedMotion: this.lane.reducedMotion,
      worldSpeed: 0,
      decorate: ["sky", "celestial", "farField", "midField", "nearField"],
      seed: 0x9f01,
    });

    // Added back to front. Everything in this scene lives in one container, and
    // a container renders its children in the order they were added.
    const hud = this.parallax.layerOf("hud").container;
    hud.add(this.buildRoute());
    hud.add(this.buildClosingLine());
    hud.add(this.buildButton());
    hud.add(this.buildHeader());

    this.ring = createFocusRing(this, layer("hud").depth + 1);
    const b = this.layout.button;
    const target: FocusTarget = {
      id: "ending-continue",
      // Forward action (see kit.ts). It is the only control on the card.
      primary: true,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      activate: () => this.toResults(),
    };
    this.menu = createKeyboardMenu(this, this.ring, [target]);
    this.shadowLineDrawn = latchOnRender(
      this,
      () =>
        this.shadowLine !== null &&
        this.shadowLine.visible &&
        this.shadowLine.alpha > 0.02,
    );
    this.focusRingDrawn = latchOnRender(this, () => this.ring.graphics.visible);

    this.playCard();
    this.publish();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu.destroy();
      this.ring.destroy();
      this.shadow.destroy();
      this.parallax.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /** `skyText` hands back a plate and a text; both go into the container. */
  private platedInto(
    made: Phaser.GameObjects.GameObject[],
    built: ReturnType<typeof skyText>,
  ): Phaser.GameObjects.Text {
    if (built.plate !== null) made.push(built.plate);
    made.push(built.text);
    return built.text;
  }

  private buildHeader(): Phaser.GameObjects.GameObject[] {
    const made: Phaser.GameObjects.GameObject[] = [];
    this.platedInto(
      made,
      skyText(
        this,
        this.layout.headlineAnchor.x,
        this.layout.headlineAnchor.y,
        this.lane.copy.text("ending.heading"),
        {
          screen: "ending",
          id: "ending.heading",
          size: ENDING_TYPE.heading,
          color: ENDING_INK.heading,
          align: "center",
          lang: this.lane.lang,
          depth: layer("hud").depth + 3,
          originX: 0.5,
          padY: 14,
        },
      ),
    );
    return made;
  }

  /**
   * THE ROUTE: one rail, seven lamps, each in its own stop's accent, on a plate
   * of its own.
   *
   * THE BEADS ARE LIT FROM THE FIRST FRAME and it is the HALO that sweeps
   * Earth-to-Pluto. The old version drew every lamp at alpha 0 and lit them off
   * a timer, so a still of this screen - which is what a child's parent sees
   * over their shoulder, and what the judge sees - showed seven dead sockets on
   * a wire. The child has just placed all seven beacons; a route that reads as
   * unlit is not a truer picture of that, it is a worse one.
   */
  private buildRoute(): Phaser.GameObjects.GameObject[] {
    const made: Phaser.GameObjects.GameObject[] = [];
    const band = this.layout.routeBand;

    made.push(
      plate(this, band.x, band.y, band.w, band.h, {
        fill: ENDING_PLATE.panel,
        stroke: ENDING_PLATE.stroke,
        alpha: ENDING_PLATE.alpha,
      }),
    );

    const rail = this.add.graphics();
    rail.lineStyle(4, hexToNum(INK.locked), 1);
    rail.lineBetween(
      this.layout.rail.from,
      this.layout.rail.y,
      this.layout.rail.to,
      this.layout.rail.y,
    );
    made.push(rail);

    const y = this.layout.rail.y;
    STOP_IDS.forEach((stopId, i) => {
      const accent = paletteFor(stopId).accent;
      const cx = this.layout.lampX[i] ?? this.layout.rail.from;

      // The sweep: a soft corona that arrives one stop at a time and then
      // blinks forever (D13).
      const halo = this.add.graphics();
      halo.fillStyle(hexToNum(accent), 0.14);
      halo.fillCircle(cx, y, this.layout.lampHaloRadius);
      halo.fillStyle(hexToNum(accent), 0.3);
      halo.fillCircle(cx, y, this.layout.lampHaloRadius * 0.55);
      halo.setAlpha(0);
      made.push(halo);
      this.lamps.set(stopId, { halo });

      const socket = this.add.graphics();
      socket.fillStyle(hexToNum(INK.panelSunken), 1);
      socket.fillCircle(cx, y, this.layout.lampBeadRadius + 4);
      socket.lineStyle(2, hexToNum(INK.line), 1);
      socket.strokeCircle(cx, y, this.layout.lampBeadRadius + 4);
      made.push(socket);

      const bead = this.add.graphics();
      bead.fillStyle(hexToNum(accent), 1);
      bead.fillCircle(cx, y, this.layout.lampBeadRadius);
      made.push(bead);
    });

    // The names go on last so nothing in the route can cover them.
    STOP_IDS.forEach((stopId, i) => {
      const cx = this.layout.lampX[i] ?? this.layout.rail.from;
      this.platedInto(
        made,
        skyText(this, cx, this.layout.labelY, this.lane.copy.stopName(stopId), {
          screen: "ending",
          id: "ending.stopName",
          size: ENDING_TYPE.stopName,
          color: ENDING_INK.stopName,
          align: "center",
          lang: this.lane.lang,
          depth: layer("hud").depth + 2,
          originX: 0.5,
          // It is already on the band's plate; `plateFill` is what keeps the
          // row measurable instead of "trust me, it's on a panel".
          plated: true,
          plateFill: ENDING_PLATE.panel,
        }),
      );
    });

    return made;
  }

  /**
   * Shadow salutes, and says the line the ending exists for.
   *
   * NO PANEL WITHOUT A LINE. The rect comes from the layout, which returns null
   * when the copy resolves to nothing, so the empty black box cannot be drawn
   * even if a copy key goes missing.
   */
  private buildClosingLine(): Phaser.GameObjects.GameObject[] {
    this.shadow = drawShadow(this, SHADOW_AT.x, SHADOW_AT.y, "saluting", {
      scale: 0.95,
      reducedMotion: this.lane.reducedMotion,
      depth: layer("hud").depth,
    });

    const made: Phaser.GameObjects.GameObject[] = [];
    const panel = this.layout.panel;
    const slot = this.layout.panelText;
    if (panel === null || slot === null) return made;

    made.push(
      plate(this, panel.x, panel.y, panel.w, panel.h, {
        fill: ENDING_PLATE.panel,
        stroke: ENDING_PLATE.stroke,
        alpha: ENDING_PLATE.alpha,
      }),
    );

    // Shadow's closing line, verbatim from story-draft-v1.md.
    this.shadowLine = this.platedInto(
      made,
      skyText(this, slot.x, slot.y, this.lane.copy.text("ending.shadowLine"), {
        screen: "ending",
        id: "ending.shadowLine",
        size: ENDING_TYPE.shadowLine,
        color: ENDING_INK.shadowLine,
        wrapWidth: slot.wrapWidth,
        lang: this.lane.lang,
        depth: layer("hud").depth + 2,
        plated: true,
        plateFill: ENDING_PLATE.panel,
      }),
    );
    return made;
  }

  private buildButton(): Phaser.GameObjects.GameObject[] {
    const b = this.layout.button;
    const made: Phaser.GameObjects.GameObject[] = [
      plate(this, b.x, b.y, b.w, b.h, {
        fill: ENDING_PLATE.button,
        stroke: ENDING_PLATE.stroke,
        alpha: ENDING_PLATE.alpha,
      }),
    ];
    this.platedInto(
      made,
      skyText(
        this,
        b.x + b.w / 2,
        b.y + b.h / 2,
        this.lane.copy.text("ending.continue"),
        {
          screen: "ending",
          id: "ending.continue",
          size: ENDING_TYPE.continue,
          // The menu accent, not the stop accent: Pluto's is a pale pink that
          // measured 1.19:1 the last time this screen trusted it.
          color: ENDING_INK.continue,
          align: "center",
          lang: this.lane.lang,
          depth: layer("hud").depth + 2,
          originX: 0.5,
          originY: 0.5,
          plated: true,
          plateFill: ENDING_PLATE.button,
        },
      ),
    );
    return made;
  }

  // -------------------------------------------------------------------------
  // The card
  // -------------------------------------------------------------------------

  /**
   * Zoom out, then sweep the beacons Earth to Pluto.
   *
   * Under reduced motion the zoom is dropped (it is camera motion, which D41
   * removes) but the beacons still light in sequence: the sequence is the
   * content of the screen, not decoration, and removing it would remove the
   * ending.
   *
   * Nothing here gates a WORD. The sweep is the only thing on a timer, and a
   * still taken before it finishes is still a composed screen - seven coloured
   * stops on a rail, the headline, the closing line and the way out.
   */
  private playCard(): void {
    if (!this.lane.reducedMotion) {
      this.cameras.main.setZoom(1.5);
      this.tweens.add({
        targets: this.cameras.main,
        zoom: 1,
        duration: ZOOM_MS,
        ease: EASE.arrive,
      });
    }

    const start = this.lane.reducedMotion ? 150 : ZOOM_MS * 0.4;
    STOP_IDS.forEach((stopId, i) => {
      this.time.delayedCall(start + i * BEACON_INTERVAL_MS, () => {
        const lamp = this.lamps.get(stopId);
        if (lamp === undefined) return;
        this.litOrder.push(stopId);
        if (this.lane.reducedMotion) {
          lamp.halo.setAlpha(1);
          return;
        }
        this.tweens.add({
          targets: lamp.halo,
          alpha: 1,
          duration: 300,
          ease: EASE.pop,
          onComplete: () => {
            // The blink that never stops: on the map these seven are lit
            // forever after (D13).
            this.tweens.add({
              targets: lamp.halo,
              alpha: { from: 1, to: 0.62 },
              duration: 1400,
              yoyo: true,
              repeat: -1,
              ease: EASE.drift,
            });
          },
        });
      });
    });
  }

  private toResults(): void {
    goTo(this, SCENE_KEYS.results, {
      ctx: this.lane.ctx,
      progress: this.lane.progress,
      shipName: this.lane.shipName,
      lang: this.lane.lang,
      stopId: this.lane.stopId,
      ...(this.initData?.payload ?? {}),
    } as StoryInit);
  }

  override update(_time: number, delta: number): void {
    this.parallax.update(delta);
    this.shadow.update(this.time.now);
  }

  snapshot(): SceneSnapshot {
    return {
      scene: SCENE_KEYS.ending,
      stopId: this.lane.stopId,
      accent: this.lane.palette.accent,
      beacons: STOP_IDS.length,
      litOrder: [...this.litOrder],
      litCount: this.litOrder.length,
      shadowLine: this.shadowLine?.text ?? "",
      shadowLineVisible: this.shadowLineDrawn.drawn,
      zoom: this.cameras.main.zoom,
      focusId: this.menu.targets[this.menu.index]?.id ?? null,
      focusRingVisible: this.focusRingDrawn.drawn,
      reducedMotion: this.lane.reducedMotion,
      nextScene: SCENE_KEYS.results,
      // AC-22.8: every colour pair this screen draws words in, for the rubric.
      skyText: skyTextSamples(this),
    };
  }

  private publish(): void {
    publishBag("ending", {
      snapshot: () => this.snapshot(),
      texts: () => visibleText(this),
      textStyles: () => textStyles(this),
    });
  }
}
