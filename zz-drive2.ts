import { paletteAt, PALETTE_STOP_IDS } from "@game/render/palette";
import { contrastRatio, compositeOver, measureText } from "@engine/contrast/index.js";
import rawP from "../keyblaster/src/content/palettes.json?raw";
const J = JSON.parse(rawP) as any;
console.log("=== OLD PATH: colorblind.accent drawn as typed letter on plate ===");
for (const s of PALETTE_STOP_IDS) {
  const cbAcc = J[s].colorblind.accent;
  const plate = J[s].plate;
  const flat = contrastRatio(cbAcc, plate);
  const over92 = measureText({screen:s,id:"x",color:cbAcc,plateFill:plate,plateAlpha:0.92});
  console.log(s.padEnd(8), "cb.accent", cbAcc, "vs plate raw", flat.toFixed(2), "| plate@0.92 over white", over92.ratio);
}
console.log();
console.log("=== CURRENT paletteAt accent vs RAW plate (no compositing) ===");
for (const s of PALETTE_STOP_IDS) {
  const n = paletteAt(s,false), c = paletteAt(s,true);
  console.log(s.padEnd(8),"norm",n.accent,contrastRatio(n.accent,n.plate).toFixed(2),"| cb",c.accent,contrastRatio(c.accent,c.plate).toFixed(2),"| worldAccent cb",c.worldAccent,"debris cb",c.debris,"debris norm",n.debris);
}
