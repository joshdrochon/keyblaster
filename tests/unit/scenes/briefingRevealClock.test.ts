import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * UR-91 REGRESSION: THE REVEAL THAT WAS OVER BEFORE IT WAS DRAWN.
 *
 * The type-on was built, tested and shipped, and on screen the page was simply
 * present. Nothing was broken in `charsRevealedAt`, in `revealPerBlock`, or in
 * the audio - every one of those is pure and every one of them was green.
 *
 * The defect was the SEED. `startReveal` runs from `create`, and a scene's
 * `this.time.now` is written by the scene clock's `preUpdate`, which has not
 * run yet at that point. It therefore holds the PREVIOUS scene's last frame
 * time. `update` then computes `time - this.revealFrom` against the live game
 * loop and gets a number in the seconds-to-minutes range on frame one, so
 * `charsRevealedAt` returned the whole page immediately.
 *
 * `FlightScene.stageStartMs` had the identical bug, and there it corrupted the
 * words-per-minute figure on the stage report and opened the difficulty ramp at
 * full depth on second zero. Two scenes, one mistake, so it is worth a guard
 * that names the rule rather than two fixes that do not.
 *
 * THE RULE: a timestamp captured in `create` must come from `game.loop.time`.
 * `this.time.now` is only trustworthy once the scene has been updating.
 */
const SCENES = [
  { file: "src/game/scenes/BriefingScene.ts", field: "revealFrom" },
  { file: "src/game/scenes/FlightScene.ts", field: "stageStartMs" },
] as const;

describe("UR-91: a create-time clock reads the game loop, not the scene clock", () => {
  for (const { file, field } of SCENES) {
    it(`${field} is seeded from game.loop.time in ${file.split("/").pop()}`, () => {
      const src = readFileSync(file, "utf8");
      const assignment = new RegExp(`this\\.${field}\\s*=\\s*this\\.([A-Za-z.]+);`);
      const match = assignment.exec(src);
      expect(match, `no assignment to this.${field} found`).not.toBeNull();
      expect(
        match?.[1],
        `this.${field} is seeded from this.${match?.[1]}, which at create() holds ` +
          `the PREVIOUS scene's last frame - the reveal/belt starts already elapsed`,
      ).toBe("game.loop.time");
    });
  }
});
