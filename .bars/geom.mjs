import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const [w,h] of [[1280,720],[1440,900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.addInitScript(() => { class D extends EventTarget { readyState=3; send(){} close(){} } window.WebSocket = D; });
  await p.goto("http://localhost:5183/?scene=Title", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__kb !== undefined, null, { timeout: 45000 });
  await p.waitForTimeout(2000);
  console.log(w+"x"+h, await p.evaluate(() => {
    const cv = document.querySelector("canvas:not([data-testid])");
    const bd = document.querySelector('[data-testid="viewport-backdrop"]');
    const app = document.getElementById("app");
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return { inner: [innerWidth, innerHeight], app: r(app), gameCanvas: r(cv), backdrop: r(bd),
      appStyle: app ? getComputedStyle(app).cssText.slice(0,0) || { w: getComputedStyle(app).width, h: getComputedStyle(app).height, pos: getComputedStyle(app).position } : null,
      canvases: document.querySelectorAll("canvas").length };
  }));
  await p.close();
}
await b.close();
