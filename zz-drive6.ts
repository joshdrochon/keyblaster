import { stagePoolFor, retentionPoolFor, mulberry32, DEFAULT_FLIGHT_CONFIG } from "@game/flight/stage.js";
import { createSelectionState, pickNext } from "@engine/selection/index.js";
import { createAllowlist } from "@engine/allowlist";
import { STOP_IDS } from "@engine/types";

for (const stop of ["mars","pluto"] as const) {
  const idx = STOP_IDS.indexOf(stop);
  const pool = stagePoolFor(stop);
  const retention = retentionPoolFor(STOP_IDS.slice(1, Math.max(1, idx)) as any);
  const al = createAllowlist({ lang: "en", words: [...pool, ...retention] });
  let s = createSelectionState({ stage: idx, stagePool: pool, retentionPool: retention, book: {}, allowlist: al });
  const rng = mulberry32(4242);
  const counts = new Map<string,number>(); let nopick = 0; let ok = 0;
  const seq: string[] = [];
  for (let i=0;i<58;i++){
    const o: any = pickNext(s, { live: [], book: {}, rng });
    if (o.ok !== true) { nopick++; s = o.state; seq.push("<none:"+o.reason+">"); continue; }
    ok++; counts.set(o.word,(counts.get(o.word)??0)+1); s = o.state; seq.push(o.word);
  }
  console.log(stop, "pool", pool.length, "retention", s.retentionPool.length, "| ok", ok, "nopick", nopick, "distinct", counts.size, "maxRepeat", Math.max(...counts.values()));
  console.log("  first 20:", seq.slice(0,20).join(" "));
  console.log("  last 20:", seq.slice(-20).join(" "));
}
// EARTH: a 1-word pool, 58 spawns
const al = createAllowlist({ lang: "en", words: stagePoolFor("earth") as string[] });
let s = createSelectionState({ stage: 0, stagePool: stagePoolFor("earth"), retentionPool: [], book: {}, allowlist: al });
const rng = mulberry32(7);
const out: string[] = []; let none = 0;
for (let i=0;i<10;i++){ const o:any = pickNext(s,{live:[],book:{},rng}); if(o.ok!==true){none++;out.push("<none:"+o.reason+">");} else out.push(o.word); s=o.state; }
console.log("\nEARTH 1-word pool, 10 picks:", out.join(" "), "| none:", none);
// and with the word live on screen
const o2:any = pickNext(s,{live:["launch"],book:{},rng});
console.log("EARTH pick while 'launch' is live ->", o2.ok===true?o2.word:"<none:"+o2.reason+">");
