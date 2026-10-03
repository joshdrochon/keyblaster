import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * QUITTING A BELT LANDS ON THE BOARD IT WAS FLOWN FROM (UR-164's last gap).
 *
 * THE DEFECT. `quitToMap` started the map with no data, so the map derived its
 * stop from `context.stopId` - and only the Results, Warp and Beacon lanes
 * write that. `FlightScene` does not. So a belt you FINISH carries its stop
 * through Results and lands on the inner board, while a belt you QUIT halfway
 * never set it and the map fell back to the Earth-to-Pluto chart. The owner
 * reported exactly that: quit on Venus, come back to the route.
 *
 * Measured in a browser before the fix was written: the pause scene held no
 * stop at all, and the map resolved whatever stale value was lying about.
 * After: pause holds "venus", the map resolves "venus".
 *
 * WHY SOURCE. Both scenes extend Phaser classes, so importing either one
 * executes Phaser and dies under vitest's node environment - the same wall
 * `tests/unit/render/wordPlateOpacity.test.ts` documents. The e2e drives the
 * real path; this stops the three links being quietly unhooked.
 */
const read = (p: string): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes", p), "utf8");

describe("UR-164: quitting a belt carries the stop to the map", () => {
  const pause = read("PauseScene.ts");
  const flight = read("FlightScene.ts");

  it("the belt tells the pause menu which stop it is", () => {
    expect(flight).toContain("PauseScene.openFrom(this, this.cfg.stopId)");
  });

  it("the pause menu accepts it and launches with it", () => {
    expect(pause).toMatch(/static openFrom\([^)]*stopId\?: StopId/);
    expect(pause).toMatch(/launch\(SCENE_KEYS\.pause, \{ from: [^,]+, stopId \}\)/);
  });

  it("init assigns it unconditionally, so a later launch cannot inherit it (UR-188)", () => {
    // Phaser reuses the scene instance. `if (data?.stopId)` would keep the
    // PREVIOUS belt's stop when a later pause omits one, which is the bug class
    // that cost three sign-offs: a quit from Mars landing on Venus's board.
    expect(pause).toContain("this.stopId = data?.stopId ?? null;");
    expect(pause).not.toMatch(/if \(data\?\.stopId\)/);
  });

  it("and quitToMap forwards it rather than starting the map blind", () => {
    expect(pause).toMatch(/goTo\(SCENE_KEYS\.map, this\.stopId === null \? undefined : \{ stopId: this\.stopId \}\)/);
  });
});
