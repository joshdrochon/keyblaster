import { chromium } from "@playwright/test"; import { readFileSync } from "node:fs";
const b = await chromium.launch(); const p = await b.newPage();
for (const f of process.argv.slice(2)) {
  console.log(f.replace(/.*\//,"").padEnd(22), await p.evaluate(async (x) => {
    const img = new Image(); img.src = `data:image/png;base64,${x}`; await img.decode();
    const c = document.createElement("canvas"); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(img,0,0);
    const d = g.getImageData(0,0,c.width,c.height).data;
    const L=(px,py)=>{const i=(py*c.width+px)*4;
      const lin=v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};
      const y=0.2126*lin(d[i])+0.7152*lin(d[i+1])+0.0722*lin(d[i+2]);
      return 116*(y>0.008856?Math.cbrt(y):7.787*y+16/116)-16;};
    const x0=Math.round(c.width*0.34),x1=Math.round(c.width*0.66);
    const rowMean=(y)=>{let s=0;for(let x=x0;x<x1;x++)s+=L(x,y);return s/(x1-x0);};
    // Biggest row-to-row jump anywhere, and specifically at h/2.
    let worst=0, at=0;
    for(let y=1;y<c.height;y++){const dv=Math.abs(rowMean(y)-rowMean(y-1)); if(dv>worst){worst=dv;at=y;}}
    const mid=Math.round(c.height/2);
    // Right-edge rule check.
    const col=(x)=>{let s=0;for(let y=0;y<c.height;y++)s+=L(x,y);return s/c.height;};
    return { worstRowJump:Number(worst.toFixed(2)), atY:at,
      atMidHalf:Number(Math.abs(rowMean(mid)-rowMean(mid-1)).toFixed(2)),
      rightEdge:Number((col(c.width-1)-col(c.width-2)).toFixed(2)) };
  }, readFileSync(f).toString("base64")));
}
await b.close();
