import { describe, expect, it } from "vitest";
import { STOP_IDS } from "@engine/types";
import {
  BADGE_TILT,
  RINGED_STOPS,
  badgeDisc,
  badgeLit,
  planetBadgeInk,
  planetBadgeSpec,
  ringArcPoints,
} from "@game/render/planetBadge";
import { mixHex, paletteFor } from "@game/render/palette";
import { INK } from "@game/ui/theme";
import { MARK, badgeBox } from "@game/ui/plateLayout";
import type { Rect } from "@game/ui/layout";

/**
 * THE DESTINATION BADGE (UR-70), AS GEOMETRY AND AS COLOUR.
 *
 * ================== WHAT IS BEING DEFENDED ==================
 * UR-70 asks for the destination planet's icon set inside the sentence
 * element's top right. Three things about it can be wrong in ways no capture of
 * one stop would show, so all three are asserted here:
 *
 *   1. IT STAYS INSIDE ITS SQUARE. The badge sits on the card's own padding, so
 *      a disc or a ring that ran past the box would cross the bracket arms or
 *      the rim - the two pieces of chrome the same ticket added.
 *   2. IT IS DIFFERENT PER STOP. A badge that draws the same disc at every stop
 *      is decoration, not a destination; Saturn has a ring and Mars does not.
 *   3. IT INVENTS NO COLOUR. AC-22.7: a frame's dominant colours are a subset
 *      of the stop palette. Both inks are the DESTINATION's own accent, mixed
 *      toward the plate it is drawn on, so a badge can never introduce an
 *      unmeasured ink.
 *
 * And it is DRAWN, not loaded (D83): this file only exists because the comp's
 * little planet had to become shapes.
 *
 * ================== WATCH THEM FAIL (rule 4) ==================
 * Read off real red runs.
 *
 *   `badgeDisc` ignoring `ringed`, i.e. one radius for every stop - which is
 *   what a first cut of this looks like:
 *
 *     a ringed planet's ring fits the square, not just its disc
 *       expected 18.919999999999998 to be less than 18.919999999999998
 *
 *   `badgeLit` with a fixed 0.8 radius instead of one derived from the light
 *   offset:
 *
 *     the lit face never hangs over the planet's edge
 *       expected 1.026274169979695 to be less than or equal to 0.96
 *
 *   `planetBadgeInk` shading toward black (`#000000`) instead of toward the
 *   plate:
 *
 *     shades toward the plate it is drawn on, not toward black
 *       expected '#48616C' to be '#4F6B78'
 */

const BOX: Rect = { x: 1740, y: 248, w: MARK.badge, h: MARK.badge };

describe("UR-70: the destination badge stays inside its square", () => {
  it("puts the disc in the middle of the box at every stop", () => {
    for (const id of STOP_IDS) {
      const disc = badgeDisc(BOX, planetBadgeSpec(id).ringed);
      expect(disc.x).toBe(BOX.x + BOX.w / 2);
      expect(disc.y).toBe(BOX.y + BOX.h / 2);
      expect(disc.r).toBeLessThanOrEqual(BOX.w / 2);
    }
  });

  it("a ringed planet's ring fits the square, not just its disc", () => {
    // THE ONE THAT ACTUALLY BITES. A ring is wider than the planet, so a badge
    // that sized the disc to the box and then drew a ring around it would hang
    // over the card's padding and cross a bracket arm.
    const spec = planetBadgeSpec("saturn");
    const disc = badgeDisc(BOX, spec.ringed);
    const ringW = (Math.min(BOX.w, BOX.h) / 2) * 0.98;
    const points = ringArcPoints(disc.x, disc.y, ringW, ringW * 0.3, spec.tilt, 0, Math.PI * 2);
    for (const p of points) {
      expect(Math.abs(p.x - disc.x)).toBeLessThanOrEqual(BOX.w / 2);
      expect(Math.abs(p.y - disc.y)).toBeLessThanOrEqual(BOX.h / 2);
    }
    expect(disc.r).toBeLessThan(badgeDisc(BOX, false).r);
  });

  it("the lit face never hangs over the planet's edge", () => {
    // Two circles rather than a gradient (a Graphics has none) or a clipped arc
    // (which hangs over on the lit side). The lit disc's radius is derived from
    // how far it is offset, so it is tangent at worst.
    for (const id of STOP_IDS) {
      const spec = planetBadgeSpec(id);
      const disc = badgeDisc(BOX, spec.ringed);
      const lit = badgeLit(disc, spec);
      const reach = Math.hypot(lit.x - disc.x, lit.y - disc.y) + lit.r;
      expect(reach / disc.r).toBeLessThanOrEqual(0.96);
      expect(lit.r).toBeGreaterThan(disc.r * 0.5);
    }
  });

  it("sits on the card's padding, where neither a bracket nor the rim reaches", () => {
    const card: Rect = { x: 96, y: 236, w: 1728, h: 265 };
    expect(badgeBox(card, MARK.badge, "card")).toEqual(BOX);
  });
});

describe("UR-70: the badge is a destination, not a decoration", () => {
  it("gives three of the seven stops a ring and the rest none", () => {
    const ringed = STOP_IDS.filter((id) => planetBadgeSpec(id).ringed);
    expect([...ringed]).toEqual(["saturn", "uranus", "neptune"]);
    expect(RINGED_STOPS).toEqual(["saturn", "uranus", "neptune"]);
    // Jupiter has rings and they are invisible. Drawing them would make four of
    // the badges the same picture, which is the failure mode this guards.
    expect(planetBadgeSpec("jupiter").ringed).toBe(false);
  });

  it("tilts every ring the same way, so the badges read as one set", () => {
    for (const id of RINGED_STOPS) {
      expect(planetBadgeSpec(id).tilt).toBe(BADGE_TILT);
    }
    expect(BADGE_TILT).toBeLessThan(0);
  });

  it("walks a tilted ellipse rather than squashing the stroke", () => {
    // A Graphics scaled to squash a circle squashes its LINE WIDTH too - a 3 px
    // ring becomes a 0.9 px scratch. These are the points that let the ring be
    // stroked at its real width, and the tilt is in them rather than in a
    // canvas transform.
    const flat = ringArcPoints(0, 0, 10, 3, 0, 0, Math.PI * 2, 4);
    expect(flat[0]).toEqual({ x: 10, y: 0 });
    expect(flat[2]?.x ?? 0).toBeCloseTo(-10, 6);
    const tilted = ringArcPoints(0, 0, 10, 3, -0.32, 0, Math.PI * 2, 4);
    expect(tilted[0]?.y ?? 0).toBeLessThan(0);
    // Closed: the last point is the first.
    expect(tilted[4]?.x ?? 0).toBeCloseTo(tilted[0]?.x ?? 0, 6);
  });
});

describe("UR-70: the badge invents no colour", () => {
  it("takes the DESTINATION's accent, not the stop the player is leaving", () => {
    // The screen is at Jupiter and the badge is Saturn's - a badge keyed off
    // `this.lane.palette` would draw the belt the child has just cleared.
    for (const id of STOP_IDS) {
      expect(planetBadgeInk(id, INK.panel).disc).toBe(paletteFor(id).accent);
    }
    expect(planetBadgeInk("saturn", INK.panel).disc).not.toBe(
      planetBadgeInk("jupiter", INK.panel).disc,
    );
  });

  it("shades toward the plate it is drawn on, not toward black", () => {
    // A disc shaded to black on a near-black card loses its own edge, which is
    // the mistake `foregroundInk` exists to stop the debris making against a
    // dark sky.
    const ink = planetBadgeInk("saturn", INK.panel);
    expect(ink.shade).toBe(mixHex(paletteFor("saturn").accent, INK.panel, 0.55));
    expect(ink.shade).not.toBe(ink.disc);
    expect(ink.ring).not.toBe(ink.disc);
    const channel = (hex: string, i: number): number =>
      Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    // Every channel lands between the accent and the plate, which is what
    // "mixed toward" means and what keeps AC-22.7's subset claim true.
    for (let i = 0; i < 3; i += 1) {
      const lo = Math.min(channel(ink.disc, i), channel(INK.panel, i));
      const hi = Math.max(channel(ink.disc, i), channel(INK.panel, i));
      expect(channel(ink.shade, i)).toBeGreaterThanOrEqual(lo);
      expect(channel(ink.shade, i)).toBeLessThanOrEqual(hi);
    }
  });
});
