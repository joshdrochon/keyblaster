import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { beaconReadout } from "@engine/ephemeris";
import { STOP_IDS, type StopId } from "@engine/types";
import { MenuScene } from "@game/ui/MenuScene";
import { type Control, ListRow, Tile } from "@game/ui/controls";
import { drawBeacon, drawTrophy } from "@game/ui/chrome";
import { drawShadow } from "@game/ui/shadowPortrait";
import { TROPHIES } from "@game/ui/catalog";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";
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
 */
export class BeaconLogScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.beaconLog;

  private litCount = 0;
  private earnedCount = 0;
  private emptyLine: string | null = null;

  constructor() {
    super({ key: SCENE_KEYS.beaconLog });
  }

  protected override paletteStop(): StopId {
    // The log is dressed by how far you have got: it changes colour across a
    // run without changing layout.
    const profile = this.app.profile();
    let furthest: StopId = "earth";
    for (const p of profile?.progress ?? []) {
      if (p.beaconPlacedAt !== null) furthest = p.stopId;
    }
    return furthest;
  }

  protected build(): void {
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

    this.addHint();
    this.setControls(controls);
  }

  private buildBeacons(placed: Map<StopId, number>): Control[] {
    const colW = Math.min(980, GAME_WIDTH * 0.52);
    const controls: Control[] = [];

    uiText(
      this,
      SPACE.gutter,
      196,
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

    let y = 250;
    for (const stopId of STOP_IDS) {
      const at = placed.get(stopId);
      const lit = at !== undefined;
      // Real heliocentric ecliptic coordinates for the day the beacon was
      // placed (D15, AC-17.0/17.1), formatted by the engine so the log and the
      // beacon screen cannot drift apart. `ok: false` is the calibrating path -
      // a broken device clock must not print "NaN" at a child.
      const readout = lit ? beaconReadout(stopId, new Date(at)) : null;
      const hasCoords = readout !== null && readout.ok;
      const detail = hasCoords
        ? readout.coordsLine
        : this.t.t("ui.log.notLit");

      const row = new ListRow(
        this,
        this.uiStyle,
        `log.beacon.${stopId}`,
        SPACE.gutter,
        y,
        this.depth,
        {
          label: this.t.t(`ui.stop.${stopId}` as MenuKey),
          detail,
          width: colW,
          role: "listitem",
          detailChrome: !hasCoords,
          locked: !lit,
          glyphSize: 78,
          glyph: (scene, gx, gy) =>
            drawBeacon(
              scene,
              gx,
              gy,
              74,
              this.app.palette(stopId).accent,
              lit,
              this.reducedMotion,
            ),
        },
      );
      controls.push(row);
      y += row.ringBounds().h + 12;
    }
    return controls;
  }

  /** All twelve of D80, always, in AC-6d.1c's order. */
  private buildTrophies(earned: Set<string>): Control[] {
    const left = SPACE.gutter + Math.min(980, GAME_WIDTH * 0.52) + SPACE.gutter;
    const tileW = 230;
    const controls: Control[] = [];

    uiText(
      this,
      left,
      196,
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

    TROPHIES.forEach((trophy, i) => {
      const has = earned.has(trophy.id);
      const col = i % 3;
      const row = Math.floor(i / 3);
      const tile = new Tile(
        this,
        this.uiStyle,
        `log.trophy.${trophy.id}`,
        left + col * (tileW + SPACE.gap),
        250 + row * 190,
        this.depth,
        {
          label: this.t.t(trophy.nameKey),
          // The criterion shows whether or not it is earned. An unearned
          // trophy is an invitation, which only works if you can read it.
          detail: has ? this.t.t("ui.log.earned") : this.t.t(trophy.howKey),
          width: tileW,
          glyphHeight: 74,
          locked: !has,
          glyph: (scene, x, y) =>
            drawTrophy(scene, x, y, 68, this.uiStyle.accent, has),
        },
      );
      controls.push(tile);
    });
    return controls;
  }

  private buildEmptyState(): void {
    drawShadow(
      this,
      GAME_WIDTH * 0.5,
      GAME_HEIGHT - 210,
      // art-direction section 6 assigns the sleeping pose to the empty log.
      "sleeping",
      170,
      this.reducedMotion,
    );
    this.emptyLine = this.t.t("ui.log.emptyShadow");
    const line = uiText(
      this,
      0,
      GAME_HEIGHT - 116,
      this.emptyLine,
      {
        size: TYPE.body,
        color: INK.textDim,
        align: "center",
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
        wrapWidth: GAME_WIDTH * 0.6,
      },
    ).setDepth(this.depth);
    line.setX(Math.round((GAME_WIDTH - line.width) / 2));
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
    };
  }
}
