import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://localhost:5184/?scene=Title");
await p.waitForFunction(() => window.__kb?.game);
await p.waitForTimeout(400);
await p.evaluate(() => {
  const s = window.__kb.game.scene.getScene("Title");
  window.__t = { delayed: false };
  s.time.delayedCall(600, () => { window.__t.delayed = true; });
  window.__p = () => ({ now: s.time.now, n: s.time._active.length, e: s.time._active[0] ? { elapsed: s.time._active[0].elapsed, delay: s.time._active[0].delay, paused: s.time._active[0].paused } : null });
});
await p.waitForTimeout(2500);
console.log(await p.evaluate(()=>window.__t), await p.evaluate(()=>window.__p()));
await b.close();
