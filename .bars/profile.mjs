import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const b = await chromium.launch(); const p = await b.newPage();
const r = await p.evaluate(async (x) => {
  const img = new Image(); img.src = `data:image/png;base64,${x}`; await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0,0,c.width,c.height).data;
  const lum = (px,py) => { const i=(py*c.width+px)*4; return 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; };
  const colMean = (x) => { let s=0; for (let y=0;y<c.height;y++) s+=lum(x,y); return s/c.height; };
  const prof = []; for (let x=0;x<220;x+=5) prof.push([x, Number(colMean(x).toFixed(1))]);
  const profR = []; for (let x=c.width-220;x<c.width;x+=5) profR.push([x, Number(colMean(x).toFixed(1))]);
  // Per-row step: biggest |d/dx| in the outer 18%, and where it is.
  const edge = Math.round(c.width*0.18);
  const steps = [];
  for (let y=0;y<c.height;y+=1) {
    let best=0,bx=0;
    for (let x=3;x<edge;x++){ const dv=Math.abs(lum(x+2,y)-lum(x-2,y)); if(dv>best){best=dv;bx=x;} }
    steps.push([bx,Number(best.toFixed(1))]);
  }
  const hist = {}; for (const [bx,m] of steps) if (m>6) hist[Math.round(bx/10)*10]=(hist[Math.round(bx/10)*10]||0)+1;
  return { size:[c.width,c.height], left: prof, right: profR,
    stepModes: Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,6) };
}, readFileSync(process.argv[2]).toString("base64"));
console.log("size", r.size);
console.log("left col means :", r.left.map(([x,v])=>`${x}:${v}`).join(" "));
console.log("right col means:", r.right.map(([x,v])=>`${x}:${v}`).join(" "));
console.log("left step x-histogram (mag>6):", JSON.stringify(r.stepModes));
await b.close();
