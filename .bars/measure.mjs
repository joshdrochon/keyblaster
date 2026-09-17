/** Edge-band fraction on the Title, from DECODED screenshots, at several aspects. */
import { chromium } from "@playwright/test";
const T = Number(process.env.T ?? 6);
const b = await chromium.launch();
const out = [];
for (const [w, h] of [[1280,720],[1440,900],[1920,900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.addInitScript(() => { class D extends EventTarget { readyState=3; send(){} close(){} } window.WebSocket = D; });
  await p.addInitScript((a) => { window.__kbAblate = a; }, (process.env.ABLATE ?? "").split(",").filter(Boolean));
  await p.goto("http://localhost:5183/?scene=Title", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__kb !== undefined, null, { timeout: 45000 });
  await p.waitForTimeout(2400);
  const shot = await p.screenshot({ type: "png" });
  const r = await p.evaluate(async ([x, t]) => {
    const img = new Image(); img.src = `data:image/png;base64,${x}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lum = (px, py) => { const i = (py*c.width+px)*4;
      return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; };
    const mean = (y, x0, x1) => { let s = 0; for (let x = x0; x < x1; x++) s += lum(x, y); return s/(x1-x0); };
    const band = Math.round(c.width * 0.07);
    let L = 0, R = 0;
    for (let y = 0; y < c.height; y++) {
      const mid = mean(y, Math.round(c.width*0.42), Math.round(c.width*0.58));
      if (Math.abs(mean(y, 0, band) - mid) > t) L++;
      if (Math.abs(mean(y, c.width-band, c.width) - mid) > t) R++;
    }
    return { left: Number((L/c.height).toFixed(3)), right: Number((R/c.height).toFixed(3)) };
  }, [shot.toString("base64"), T]);
  out.push(`${w}x${h} (${(w/h).toFixed(3)})  L ${r.left}  R ${r.right}`);
  await p.close();
}
await b.close();
console.log(`T=${T}  ` + (process.env.LABEL ?? "baseline"));
for (const line of out) console.log("   " + line);
