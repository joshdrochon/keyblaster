import { paletteAt, PALETTE_STOP_IDS, skyStops, skyStopsLate } from "@game/render/palette";
import { measureText, compositeOver, WORST_CASE_SKY } from "@engine/contrast/index.js";
import { INK } from "@game/ui/theme";

const PANEL94 = compositeOver(INK.panel, 0.94, WORST_CASE_SKY);
const PANEL1 = INK.panel;
const RAISED94 = compositeOver(INK.panelRaised, 0.94, WORST_CASE_SKY);
const SUNKEN55 = compositeOver(INK.panelSunken, 0.55, WORST_CASE_SKY);

const out: any[] = [];
const m = (stop:string,cb:boolean,id:string,color:string,fill:string|null,alpha:number,behind:string,bn:string)=>{
  const r = measureText({screen:stop,id,color,plateFill:fill,plateAlpha:alpha,behind});
  out.push({stop,cb,id,color,backdrop:r.backdrop,behind:bn,ratio:r.ratio});
};
for (const stop of PALETTE_STOP_IDS) for (const cb of [false,true]) {
  const p = paletteAt(stop,cb);
  const sky = skyStops(p), late = skyStopsLate(p);
  // menu chrome, palette accent on menu surfaces (ui/controls.ts style.accent)
  m(stop,cb,"controls.toggle.state@panel", p.accent, PANEL94, 1, WORST_CASE_SKY,"white");
  m(stop,cb,"controls.readout@sunken", p.accent, SUNKEN55, 1, WORST_CASE_SKY,"white");
  // BeaconScene:432 continue button label
  m(stop,cb,"beacon.continue@panelRaised", p.accent, RAISED94, 1, WORST_CASE_SKY,"white");
  // BeaconScene:327 pulsar label (alpha 0.9 ink over INK.panel@0.94)
  m(stop,cb,"beacon.pulsar@panel(a0.9)", compositeOver(p.accent,0.9,PANEL94), null, 1, PANEL94,"panel");
  // WarpScene:814 speaker label on opaque INK.panel
  m(stop,cb,"warp.speaker@panel(a1)", p.accent, PANEL1, 1, WORST_CASE_SKY,"white");
  // FLIGHT +points floater: bare sky, no plate
  for (const [i,c] of sky.entries()) m(stop,cb,`flight.floater@skyStop${i}`, p.accent, null, 1, c, `sky${i}`);
  for (const [i,c] of late.entries()) m(stop,cb,`flight.floater@lateSky${i}`, p.accent, null, 1, c, `late${i}`);
  // TitleScene:264 "KEY" wordmark, bare sky
  for (const [i,c] of sky.entries()) m(stop,cb,`title.wordmark@skyStop${i}`, p.accent, null, 1, c, `sky${i}`);
}
const bad = out.filter(r=>r.ratio<4.5);
console.log("total",out.length,"below4.5",bad.length,"below3",out.filter(r=>r.ratio<3).length);
const byId: Record<string,any[]> = {};
for (const r of out) (byId[r.id] ||= []).push(r);
for (const [id,rs] of Object.entries(byId)) {
  const mn = rs.reduce((a,b)=>b.ratio<a.ratio?b:a), mx = rs.reduce((a,b)=>b.ratio>a.ratio?b:a);
  const nfail = rs.filter(r=>r.ratio<4.5).length;
  console.log(id.padEnd(34), "min", String(mn.ratio).padStart(6), `(${mn.stop}${mn.cb?"/cb":""})`.padEnd(14), "max", String(mx.ratio).padStart(6), "fail", nfail+"/"+rs.length);
}
console.log("\n--- FULL FAIL LIST (ratio<4.5) ---");
for (const r of bad) console.log(r.stop.padEnd(8), (r.cb?"CB":"nm").padEnd(3), r.id.padEnd(32), r.color, "on", r.backdrop, "=", r.ratio);
