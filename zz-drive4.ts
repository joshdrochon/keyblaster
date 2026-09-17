import { paletteAt, PALETTE_STOP_IDS, skyStops } from "@game/render/palette";
import { contrastRatio, compositeOver } from "@engine/contrast/index.js";
import { INK } from "@game/ui/theme";
const PANEL = compositeOver(INK.panel, 0.92, INK.bg);
const RAISED = compositeOver(INK.panelRaised, 0.92, INK.bg);
const SUNKEN = compositeOver(INK.panelSunken, 0.55, INK.bg);
console.log("surfaces: panel",PANEL,"raised",RAISED,"sunken",SUNKEN);
console.log("stop     mode  accent   onPanel onRaised onSunken");
for (const s of PALETTE_STOP_IDS) for (const cb of [false,true]) {
  const a = paletteAt(s,cb).accent;
  console.log(s.padEnd(8), (cb?"cb":"nm").padEnd(5), a,
   contrastRatio(a,PANEL).toFixed(2).padStart(7),
   contrastRatio(a,RAISED).toFixed(2).padStart(8),
   contrastRatio(a,SUNKEN).toFixed(2).padStart(8));
}
console.log("\nTitle wordmark 'BLASTER' cream #F7F2E6 on sky stops:");
for (const s of PALETTE_STOP_IDS) {
  const p = paletteAt(s,false); const sk = skyStops(p);
  console.log(s.padEnd(8), sk.map(c=>contrastRatio("#F7F2E6",c).toFixed(2)).join("  "), " skies:", sk.join(" "));
}
