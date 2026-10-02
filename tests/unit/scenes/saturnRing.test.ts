import { describe, expect, it } from "vitest";
import {
  GLOW_REACH,
  LAMP_RISE,
  NODE_R,
  RING_INNER,
  RING_RX,
  RING_RY,
  ringReachPx,
} from "@game/scenes/support/mapLayout";

/**
 * The map draws ONE ring, and the bar it has to clear is the halo.
 *
 * Selecting a node paints soft rings reaching `GLOW_REACH` past the disc. A
 * planetary ring drawn outside that puts a hard ellipse just beyond a soft
 * halo and reads as two rings - the defect recorded above the badge note,
 * which cost three bugs on the Title before it was understood.
 */
describe("Saturn's ring stays inside the node's own halo", () => {
  it("reaches less far than the selection glow does", () => {
    expect(ringReachPx()).toBeLessThan(NODE_R + GLOW_REACH);
  });

  it("the inner band is inside the outer, so the outer edge is the only bound", () => {
    expect(RING_INNER).toBeGreaterThan(0);
    expect(RING_INNER).toBeLessThan(1);
    expect(RING_RX * RING_INNER).toBeLessThan(ringReachPx());
  });

  it("clears the planet's limb, or it is a belt rather than a ring", () => {
    expect(RING_RX).toBeGreaterThan(NODE_R);
  });

  it("is shallow, so it extends sideways rather than into the beacon's mast", () => {
    expect(RING_RY).toBeLessThan(NODE_R + LAMP_RISE);
    expect(RING_RY).toBeLessThan(RING_RX / 2);
  });
});
