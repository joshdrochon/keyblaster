import type Phaser from "phaser";
import { SCENE_KEYS } from "@game/sceneKeys.js";
import { bootGame } from "@game/boot.js";
import { type FlightConfig, flightConfigFrom } from "./stage.js";

/**
 * START THE SHIPPING GAME ON SCREEN 6, WITH A STAGE CONFIGURATION.
 *
 * ================== UR-36: THIS FILE USED TO BE A SECOND GAME ==============
 * It built its own `new Phaser.Game`. The reasoning at the time was ownership -
 * the Boot/Title lane owned `src/main.ts` and the scene registry, so this lane
 * "shipped its own entry point rather than editing a file it does not own" -
 * and it was a reasonable decision that produced a second product.
 *
 * The two games diverged in five ways, every one of them a defect the shipping
 * path had already fixed:
 *
 *   1. `Phaser.AUTO` instead of `WEBGL`, so the harness may have been measuring
 *      the CANVAS renderer - a different rasteriser, different frame times
 *   2. `autoCenter: CENTER_BOTH`, the double-centring `boot.ts` documents at
 *      length as the bug that made the letterbox 3:1 and painted the backdrop
 *      against a rect the canvas had been pushed out of
 *   3. no `installPixelDensity`, so the buffer never followed the display and
 *      P-22.9's 60 fps evidence was gathered on a 1x buffer
 *   4. clear colour `#08111f` instead of `INK.panel` - one planet's palette on
 *      every other planet's screen, in the 1 px seam
 *   5. `setGameWidth(designWidthFor(...))` NEVER CALLED, so `GAME_WIDTH` stayed
 *      1920 and `Scale.FIT` letterboxed at any window that is not 16:9
 *
 * Number 5 is the one that matters most and it is not the perf spec. The edge
 * bars the player reported SIX TIMES, and which D99 removed at the source, were
 * still alive in here - so every spec on this path ran against a game that
 * still had the defect. `world-frame.spec.ts` produces `flight-frame.png`, the
 * image a HUMAN judges for the R-world rubric item, and its own docstring
 * claimed it rendered "the shipped Flight scene" honestly. The visual bar was
 * being set against a picture the game does not draw.
 *
 * It is instance 4 in `docs/verification-gaps.md`, whose whole subject is
 * checks that exercise something ADJACENT to the shipped thing, pass, and are
 * believed. Guard 3 in that file is "one boot path", and this is it.
 *
 * ================== WHY AN ADAPTER AND NOT A PATCH ==================
 * Fixing the five divergences one at a time would leave a second `Phaser.Game`
 * in `src/` that drifts again the first time anybody changes the real one -
 * and it drifted this far without anyone choosing it. So there is now exactly
 * one game in this repo. Everything below is arrangement: `bootGame` builds
 * it, and this asks the scene manager for screen 6 with a stage config, which
 * is the one thing a URL cannot carry.
 *
 * `pixelReadback` is GONE, deliberately. It set `preserveDrawingBuffer` so a
 * spec could read the live canvas, and reading a live WebGL canvas is itself
 * a documented near-miss in `verification-gaps.md`: without that flag it hands
 * back uniform garbage, and it has produced two wrong measurements here. The
 * specs decode a `page.screenshot()` PNG instead, which is what the shipping
 * renderer actually put on the screen and needs no render-config divergence to
 * obtain.
 *
 * `main.ts` still calls `bootGame` directly and is unchanged.
 */
export interface BootFlightOptions extends Partial<FlightConfig> {
  readonly parent?: string;
}

export async function bootFlight(options: BootFlightOptions = {}): Promise<Phaser.Game> {
  const { parent = "app", ...rest } = options;
  const config = flightConfigFrom(rest);

  // `?scene=Flight` is the shipping game's own seam for opening one screen;
  // it is how every other lane's spec boots a scene (`support/lane.bootScene`).
  // The URL cannot carry a `FlightConfig`, so the scene is restarted with one
  // below - which is also exactly what `PreflightScene` does on the real path.
  const game = await bootGame({ parent, search: "?scene=Flight" });

  const start = (): void => {
    game.scene.start(SCENE_KEYS.flight, config);
  };
  // `bootGame` starts the requested scene on READY with no data. Whether that
  // has happened yet depends on how long `discoverScenes` took, so this covers
  // both orders rather than assuming one: starting an already-started scene
  // restarts it, and starting it before READY is what the boot itself does.
  if (game.isRunning) start();
  else game.events.once("ready", start);

  window.__kbGame = game;
  return game;
}

declare global {
  interface Window {
    __kbGame?: Phaser.Game;
  }
}
