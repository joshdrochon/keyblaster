import { it } from "vitest";
import { PALETTE_STOP_IDS, depthRamp, foregroundObjectInk, isBrightStop, lightness, paletteFor, rgbOf, skyStops } from "../../../src/game/render/palette.js";
/** The probe's own metric: Rec.601 luminance byte, 0..255. */
const luma = (h: string) => { const { r, g, b } = rgbOf(h); return 0.299 * r + 0.587 * g + 0.114 * b; };
it("collision", () => {
  for (const id of PALETTE_STOP_IDS) {
    const p = paletteFor(id);
    const bands = depthRamp(p, 4);
    const d = luma(p.debris);
    // A gameplay rock is on layer 4; only farField(2) and midField(3) are BEHIND it.
    const behind = bands.slice(0, 2).map((c) => Math.abs(luma(c) - d));
    console.log(
      id.padEnd(8), isBrightStop(p) ? "bright" : "dark  ",
      "debris", p.debris, `luma ${d.toFixed(0)} L*${lightness(p.debris).toFixed(0)}`,
      "| bands luma", bands.map((c) => luma(c).toFixed(0)).join("/"),
      "| gap-to-far/mid", behind.map((v) => v.toFixed(0)).join("/"),
      "| probe", (Math.min(...behind) / 255).toFixed(3),
      "| skyLuma", luma(skyStops(p)[1]).toFixed(0),
      "| objLuma", luma(foregroundObjectInk(p)).toFixed(0),
    );
  }
});
