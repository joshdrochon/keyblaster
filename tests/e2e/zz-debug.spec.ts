import { expect, test } from "@playwright/test";
import { bootScene } from "./support/lane";

const fps = () => {
  const kb = (window as unknown as { __kb: Record<string, unknown> }).__kb;
  const game = kb["game"] as { loop: { frame: number; actualFps: number; delta: number } };
  return { frame: game.loop.frame, fps: game.loop.actualFps, delta: game.loop.delta };
};

for (const [scene, bag] of [["Title", "title"], ["Beacon", "beacon"], ["Ending", "ending"], ["Warp", "warp"]] as const) {
  test(`fps ${scene}`, async ({ page }) => {
    await bootScene(page, scene, bag, "&stop=pluto");
    const a = await page.evaluate(fps);
    await page.waitForTimeout(1000);
    const b = await page.evaluate(fps);
    console.log(`FPS-${scene}`, JSON.stringify({ frames: b.frame - a.frame, fps: b.fps, delta: b.delta }));
    expect(true).toBe(true);
  });
}
