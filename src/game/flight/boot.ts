import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys.js";
import { FlightScene } from "@game/scenes/FlightScene.js";
import { HudScene } from "@game/scenes/HudScene.js";
import { StallScene } from "@game/scenes/StallScene.js";
import { type FlightConfig, flightConfigFrom } from "./stage.js";

/**
 * Launcher for the core loop.
 *
 * The Boot/Title lane owns `src/main.ts` and the real scene registry, so this
 * lane ships its own entry point rather than editing a file it does not own.
 * It is not a test fixture: it is the smallest correct way to start screen 6
 * with a profile's settings, and `main.ts` can call it unchanged.
 */
export interface BootFlightOptions extends Partial<FlightConfig> {
  readonly parent?: string;
  /**
   * WebGL keeps no back buffer unless asked to. Reading pixels back (the
   * AC-22.3 sky sample and the AC-22.4 desaturated frame) needs one, and it
   * costs frame time, so it is off unless a caller is measuring colour.
   */
  readonly pixelReadback?: boolean;
}

export function bootFlight(options: BootFlightOptions = {}): void {
  const { parent = "app", pixelReadback = false, ...rest } = options;
  const config = flightConfigFrom(rest);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#08111f",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: true,
      preserveDrawingBuffer: pixelReadback,
      powerPreference: "high-performance",
    },
    fps: { target: 60 },
    scene: [],
  });

  game.scene.add(SCENE_KEYS.flight, FlightScene, false);
  game.scene.add(SCENE_KEYS.hud, HudScene, false);
  game.scene.add(SCENE_KEYS.stall, StallScene, false);
  game.scene.start(SCENE_KEYS.flight, config);

  window.__kbGame = game;
}

declare global {
  interface Window {
    __kbGame?: Phaser.Game;
  }
}
