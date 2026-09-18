import type Phaser from "phaser";
import {
  drawLantern,
  type LanternLivery,
  type LanternOptions,
  type LanternRig,
} from "@game/render/lantern";
import { liveryForShip } from "@game/ui/catalog";
import { activeProfile } from "./init.js";

/**
 * THE SEAM BETWEEN THE PROFILE'S HULL AND THE DRAWING (UR-48).
 *
 * ================== THE DEFECT ==================
 * `profile.shipId` is chosen at profile creation, `@engine/unlocks` can add
 * hulls to `profile.unlockedShips`, and the field reached NOTHING: every screen
 * that drew the ship drew a hardcoded one. That is coding-standards rule 2 -
 * "every persisted field needs a live READER, not just a writer" - and rule 2
 * names this field BY NAME as its second instance, beside `uppercase` and
 * `increasedLetterSpacing`, which persisted perfectly and did nothing on nine
 * screens.
 *
 * The flight screen was closed first, by reading the profile inline. Three more
 * screens draw the same ship (Title, Warp, the Director map) and none of them
 * did. Closing them the same way - four inline copies of "ask the profile, then
 * remember to pass `livery:`" - is an arrangement each screen must OPT INTO,
 * and that is precisely how `crossDrift` failed and how keep-clear failed
 * twice. So it is one call instead.
 *
 * ================== WHY THIS FILE IS HERE AND NOT IN render/ ==================
 * The obvious home is `render/lantern.ts` itself: have `drawLantern` default
 * the livery off the scene and no screen could forget. Rejected, twice over.
 *
 *   1. CYCLE. Resolving the profile means `services(scene)` from `@game/boot`,
 *      and `boot.ts` imports `render/lanternShot.ts`, which imports
 *      `render/lantern.ts`. A back-edge from the drawing to the boot file runs
 *      through the module that draws the ship.
 *   2. IT WOULD REPAINT THE REFERENCE SHEET. `lanternShot.ts` is the render
 *      `R-lantern` is judged against and it passes NO livery, which
 *      `render/lantern.ts` documents as meaning "the constants, byte for
 *      byte". `LanternShotScene` is registered on the real `Phaser.Game`, so
 *      `services(scene)` resolves inside it - a default-from-scene would put
 *      the active pilot's hull into the sheet a human already signed off.
 *
 * `scenes/lib/` is where every other profile-backed scene accessor already
 * lives - `activeProfile`, `storedKnobs`, `storedBook`, `storedCalibration` -
 * and `init.ts` states the rule they share: the hand-off chain is the mechanism
 * that lost this field, so a screen asks the STORE rather than the payload it
 * was handed.
 *
 * ================== WHAT MAKES IT RIGHT BY CONSTRUCTION ==================
 * `drawPlayerLantern` is the only entry point a screen needs, and it cannot be
 * called without resolving the livery - there is no argument for "skip it".
 * `tests/unit/arch/liveryReaders.test.ts` sweeps every scene file and fails one
 * that draws the Lantern without a profile-backed livery, so a new screen
 * cannot quietly reintroduce the hardcoded ship. Convention would be a comment
 * asking screens to remember; the guard is what makes it a rule.
 */

/**
 * The four colours the live pilot's ship is wearing, or `undefined` when there
 * is no store or no profile.
 *
 * UNDEFINED IS DELIBERATE AND IT IS NOT "THE DEFAULT HULL". `render/lantern.ts`
 * treats a missing livery as "the constants, byte for byte", which is the
 * contract the reference compare rests on. A standalone harness mount (every
 * e2e boot of a single screen) has no store, and it must draw the sheet's ship
 * rather than silently stand in ship-1's catalogue colours, which are NOT the
 * constants (`#F2EDE3` against `HULL_CREAM`, `#9FD8F0` against `GLASS`).
 *
 * The skin is applied here too, via `liveryForShip`: a pilot who has earned
 * `skin-1` is wearing it, which is the half of `@engine/unlocks` that shows up
 * on screen without anything being equipped.
 */
export function playerLivery(scene: Phaser.Scene): LanternLivery | undefined {
  const pilot = activeProfile(scene);
  if (pilot === null) return undefined;
  return liveryForShip(pilot.shipId, pilot.unlockedSkins);
}

/**
 * Draw the shared Lantern in the live pilot's colours.
 *
 * ONE `drawLantern`, never a second implementation (coding-standards rule 3):
 * this delegates, it does not draw. A private copy in `FlightScene` was the
 * ship on screen for the entire game while `R-lantern` judged a drawing nothing
 * used, and the guard that was supposed to catch it could not see a method.
 *
 * A stated `livery` still wins, so a screen with a reason to name a hull - a
 * catalogue tile, a spec that boots one ship on purpose - keeps that reason.
 */
export function drawPlayerLantern(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: LanternOptions = {},
): LanternRig {
  return drawLantern(scene, x, y, {
    ...options,
    livery: options.livery ?? playerLivery(scene),
  });
}
