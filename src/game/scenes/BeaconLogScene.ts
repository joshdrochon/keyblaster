import Phaser from "phaser";
import { GAME_HEIGHT, SCENE_KEYS } from "@game/sceneKeys";
import { audioFrom } from "@game/audio/wiring";
import { beaconReadout } from "@engine/ephemeris";
import { STOP_IDS, type StopId } from "@engine/types";
import { MenuScene } from "@game/ui/MenuScene";
import { type Control, ListRow, Tile } from "@game/ui/controls";
import { drawBeacon, drawTrophy } from "@game/ui/chrome";
import { SHADOW_HEIGHT, drawShadow } from "@game/render/shadow";
import { TROPHIES } from "@game/ui/catalog";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";
import {
  BEACON_LOG,
  type FitOptions,
  bottomOf,
  fitPlan,
  flowColumn,
  flowGrid,
} from "@game/ui/layout";
import type { MenuKey } from "@game/ui/i18n";

/**
 * SCREEN 10 - BEACON LOG (D40, D74, D80; inventory row "Beacon Log": empty /
 * partial / complete / trophies).
 *
 * The collection screen: every beacon placed, its coordinates, its planet - and
 * the trophy room (D40).
 *
 * TROPHIES ARE INFORMATIONAL, NEVER COMPARATIVE (D74). All twelve of D80 are
 * shown to every player, earned or not, in a fixed order, each with the thing
 * that earns it written underneath. There is no tier, no rarity, no percentage
 * of players, no total score and no ordering by value - nothing that turns a
 * record of what a child did into a standing against anyone. That is the
 * Deci/Koestner/Ryan 1999 distinction the decision cites: informational
 * feedback supports motivation, controlling feedback undermines it.
 *
 * EMPTY STATE (design brief 13): "only Earth lit, a line from Shadow about the
 * six to come." Shadow sleeps in the empty log per art-direction section 6, and
 * the six dark beacons are drawn as beacons - not as blanks - so the screen
 * reads as a route waiting to be flown.
 *
 * ================== NOTHING OVERLAPS ANYTHING ==================
 * The first version of this screen positioned by arithmetic and hoped:
 *
 *   - trophy tiles went at `250 + row * 190`, a FIXED pitch, while each tile
 *     measured its own height from wrapped text. A three-line criterion is
 *     237 px tall, so "scratch" printed inside the "chain 50" card, "the same"
 *     inside "steady hull", "back" inside "last light", and the bottom row ran
 *     off the frame entirely;
 *   - the empty-state line went at `GAME_HEIGHT - 116`, centred, straight
 *     across the pluto row;
 *   - the sleeping Shadow went at `GAME_HEIGHT - 210`, centred, on top of the
 *     neptune row;
 *   - the keyboard hint ran through the pluto label.
 *
 * Four separate versions of the same mistake: a position chosen without asking
 * what is already there. So every block on this screen is MEASURED and then
 * FLOWED by `ui/layout.ts`, the empty state has its own band in the header
 * rather than borrowing space from the beacon column, and the arrangement is
 * checked against the 1920x1080 frame in all three UI languages by
 * tests/unit/ui/layout.test.ts rather than by looking at a screenshot.
 */
/** UR-192: a mark rather than a word, so the criterion keeps the line. */
const EARNED_MARK = "\u2713";
const LOCKED_MARK = "\u2610";

export class BeaconLogScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.beaconLog;

  private litCount = 0;
  private earnedCount = 0;
  private emptyLine: string | null = null;
  /** Measured bottoms, published for the layout e2e. */
  private beaconBottom = 0;
  private trophyBottom = 0;

  constructor() {
    super({ key: SCENE_KEYS.beaconLog });
  }

  protected build(): void {
    // UR-172, same reason as the map: the log is a chart of the route, not a
    // place on it. Stepping between the two must not change the bed.
    audioFrom(this.registry)?.setAmbientTrim(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      audioFrom(this.registry)?.setAmbientTrim(false);
    });

    this.addHeading("ui.log.heading");
    const profile = this.app.profile();
    const placed = new Map<StopId, number>();
    for (const p of profile?.progress ?? []) {
      if (p.beaconPlacedAt !== null) placed.set(p.stopId, p.beaconPlacedAt);
    }
    this.litCount = placed.size;
    this.earnedCount = (profile?.trophies ?? []).length;

    const controls: Control[] = [];
    controls.push(...this.buildBeacons(placed));
    controls.push(...this.buildTrophies(new Set(profile?.trophies ?? [])));

    // The empty state is "nothing beyond Earth", which includes a brand-new
    // profile with nothing at all. Either way the message is the same one.
    if (this.litCount <= 1) this.buildEmptyState();

    // UR-192: nothing moves and nothing is chosen here, and a hint that names
    // a key which does nothing is worse than no hint.
    this.addHint("ui.common.hintBack");
    // UR-192: nothing here has an `onPress`, so nothing takes focus. The rows
    // stay in the mirror; only the ring goes. Esc still leaves.
    this.setControls(controls, undefined, false);
  }

  /**
   * Build, MEASURE, and only then place.
   *
   * A control's height is not known until its text has wrapped in the language
   * that is actually selected, so it is built at the origin, measured, and
   * moved. When the measured block would leave the frame, `fitPlan` says what
   * to give up - white space first, the glyph second, the type never - and the
   * block is rebuilt once at the smaller glyph and measured again. Two passes,
   * bounded, with the second pass's numbers being the ones that are used.
   */
  private flowBlock<T extends Control>(
    make: (glyph: number) => T[],
    cfg: FitOptions & { left: number; width: number; colGap: number },
  ): { controls: T[]; bottom: number } {
    let glyph = cfg.glyph;
    let controls = make(glyph);
    let plan = fitPlan(
      controls.map((c) => c.ringBounds().h),
      { ...cfg, glyph },
    );
    if (plan.glyph !== glyph) {
      for (const c of controls) c.destroy();
      glyph = plan.glyph;
      controls = make(glyph);
      plan = fitPlan(
        controls.map((c) => c.ringBounds().h),
        { ...cfg, glyph },
      );
    }

    // UR-192: one height for the whole block, so a grid of cards reads as a
    // grid. `growTo` only grows, so the tallest card sets it.
    const tallest = Math.max(...controls.map((c) => c.ringBounds().h));
    for (const c of controls) {
      const growable = c as unknown as { growTo?: (h: number) => void };
      growable.growTo?.(tallest);
    }

    const heights = controls.map((c) => c.ringBounds().h);
    const rects =
      cfg.columns === 1
        ? flowColumn(heights, {
            left: cfg.left,
            top: cfg.top,
            width: cfg.width,
            rowGap: plan.rowGap,
          })
        : flowGrid(heights, {
            left: cfg.left,
            top: cfg.top,
            columns: cfg.columns,
            colWidth: cfg.width,
            colGap: cfg.colGap,
            rowGap: plan.rowGap,
          });
    controls.forEach((control, i) => {
      const rect = rects[i];
      if (rect) control.node.setPosition(rect.x, rect.y);
    });
    return { controls, bottom: bottomOf(rects) };
  }

  private buildBeacons(placed: Map<StopId, number>): Control[] {
    const cfg = BEACON_LOG.beacons;

    uiText(
      this,
      cfg.x,
      BEACON_LOG.captionY,
      `${this.t.t("ui.log.beacons")} · ${this.t.t("ui.log.lit", {
        n: this.litCount,
        total: STOP_IDS.length,
      })}`,
      {
        size: TYPE.body,
        color: INK.textDim,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      },
    ).setDepth(this.depth);

    const make = (glyph: number): ListRow[] =>
      STOP_IDS.map((stopId) => {
        const at = placed.get(stopId);
        const lit = at !== undefined;
        // Real heliocentric ecliptic coordinates for the day the beacon was
        // placed (D15, AC-17.0/17.1), formatted by the engine so the log and
        // the beacon screen cannot drift apart. `ok: false` is the calibrating
        // path - a broken device clock must not print "NaN" at a child.
        // UR-192: AC-17.0's readout lives on `BeaconScene`, where the beacon
        // is placed. Repeating it on every row made the list busy.
        const detail = `${lit ? EARNED_MARK : LOCKED_MARK}  ${this.t.t(
          lit ? "ui.log.lit.one" : "ui.log.notLit",
        )}`;
        const hasCoords = false;

        return new ListRow(
          this,
          this.uiStyle,
          `log.beacon.${stopId}`,
          cfg.x,
          cfg.top,
          this.depth,
          {
            label: this.t.t(`ui.stop.${stopId}` as MenuKey),
            detail,
            width: cfg.w,
            role: "listitem",
            detailChrome: !hasCoords,
            locked: !lit,
            glyphSize: glyph,
            glyph: (scene, gx, gy) =>
              drawBeacon(
                scene,
                gx,
                gy,
                glyph * 0.95,
                this.app.palette(stopId).accent,
                lit,
                this.reducedMotion,
              ),
          },
        );
      });

    const flowed = this.flowBlock(make, {
      ...cfg,
      left: cfg.x,
      width: cfg.w,
      colGap: 0,
    });
    this.beaconBottom = flowed.bottom;
    return flowed.controls;
  }

  /** All twelve of D80, always, in AC-6d.1c's order. */
  private buildTrophies(earned: Set<string>): Control[] {
    const cfg = BEACON_LOG.trophies;

    uiText(
      this,
      cfg.left,
      BEACON_LOG.captionY,
      `${this.t.t("ui.log.trophies")} · ${this.t.t("ui.log.trophyCount", {
        n: this.earnedCount,
        total: TROPHIES.length,
      })}`,
      {
        size: TYPE.body,
        color: INK.textDim,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      },
    ).setDepth(this.depth);

    const make = (glyph: number): Tile[] =>
      TROPHIES.map((trophy) => {
        const has = earned.has(trophy.id);
        return new Tile(
          this,
          this.uiStyle,
          `log.trophy.${trophy.id}`,
          cfg.left,
          cfg.top,
          this.depth,
          {
            label: this.t.t(trophy.nameKey),
            // UR-192: marking both states keeps them the same length (D41).
            detail: `${has ? EARNED_MARK : LOCKED_MARK}  ${this.t.t(trophy.howKey)}`,
            width: cfg.tileW,
            glyphHeight: glyph,
            // The mark beside the words, not above them: the criterion is what
            // a child is reading here, and a record card is a third shorter
            // than a gallery tile - which is what lets twelve of them fit.
            glyphSide: "left",
            locked: !has,
            glyph: (scene, x, y) =>
              drawTrophy(
                scene,
                x,
                y,
                glyph * 0.94,
                this.uiStyle.accent,
                has,
                trophy.glyph,
              ),
          },
        );
      });

    const flowed = this.flowBlock(make, {
      ...cfg,
      left: cfg.left,
      width: cfg.tileW,
      colGap: cfg.colGap,
    });
    this.trophyBottom = flowed.bottom;
    return flowed.controls;
  }

  /**
   * Shadow asleep, and his one line, IN THEIR OWN BAND.
   *
   * They used to be drawn low and centred, which put the line across the pluto
   * row and Shadow on top of neptune. The header band is the one region of this
   * screen no column reaches: the heading is left-aligned and never runs past
   * halfway, and both columns start below the section captions. So the empty
   * state sits up beside the title it is commenting on, and crosses nothing.
   */
  private buildEmptyState(): void {
    const a = BEACON_LOG.aside;
    const midY = a.top + a.h / 2;
    this.shadows.push(
      // art-direction section 6 assigns the sleeping pose to the empty log.
      drawShadow(this, a.right - a.shadow * 0.52, midY, "asleep", {
        scale: a.shadow / SHADOW_HEIGHT,
        reducedMotion: this.reducedMotion,
        depth: this.depth,
        facing: -1,
      }),
    );
    this.emptyLine = this.t.t("ui.log.emptyShadow");
    const textRight = a.right - a.shadow - SPACE.gap;
    const line = uiText(this, 0, 0, this.emptyLine, {
      size: TYPE.body,
      color: INK.textDim,
      align: "right",
      lang: this.uiStyle.lang,
      uppercase: this.uiStyle.uppercase,
      increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      wrapWidth: a.w - a.shadow - SPACE.gap,
    }).setDepth(this.depth);
    line.setPosition(
      Math.round(textRight - line.width),
      Math.round(midY - line.height / 2),
    );
  }

  /** The log is opened from the Director map (design brief screen 3). */
  protected goBack(): void {
    this.goTo(SCENE_KEYS.map);
  }

  override snapshot(): Record<string, unknown> {
    return {
      ...super.snapshot(),
      beaconsLit: this.litCount,
      trophiesShown: TROPHIES.length,
      trophiesEarned: this.earnedCount,
      empty: this.litCount <= 1,
      emptyLine: this.emptyLine,
      // The layout facts an e2e can assert instead of a human squinting at a
      // PNG: both blocks are inside the frame, and neither reaches the hint.
      beaconBottom: Math.round(this.beaconBottom),
      trophyBottom: Math.round(this.trophyBottom),
      frameHeight: GAME_HEIGHT,
      hintTop: BEACON_LOG.hintTop,
    };
  }
}
