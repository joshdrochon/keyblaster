import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSceneText } from "@game/scenes/lib/strings";
import { createLaneText } from "@game/scenes/support/copy";

/**
 * C27: `{pilotName}` IS BOUND WHEREVER `{shipName}` IS.
 *
 * ================== THE DEFECT ==================
 * `briefing.shipReady` was changed to address the pilot by name - the ship-name
 * beat of profile creation is switched off, so `{shipName}` there could only
 * ever render the default. The token was bound in `boot.ts` and in the MENU
 * translator (`ui/i18n.createMenuTranslator`), and the Briefing uses NEITHER:
 * the seven story screens read `scenes/lib/strings.createSceneText`, whose
 * defaults were `{ shipName }` alone.
 *
 * So the first screen of the game printed the literal text `{pilotName}, our
 * ship is fuelled and ready.` - reported from a screenshot, not caught here,
 * because the i18n suite tests the TABLE and this is about which defaults a
 * scene's translator was built with.
 *
 * ================== WHAT THIS ASSERTS ==================
 * That both scene-side text factories bind the token, and that an absent
 * profile degrades to "" rather than to a wrong name or the raw token. The
 * engine translator's own interpolation is `tests/unit/i18n/translate.test.ts`;
 * this file is only about what the SCENES hand it.
 */

const LINE = "briefing.shipReady" as const;

describe("C27: the scene text factories bind the pilot's name", () => {
  it("createSceneText interpolates a bound pilot name", () => {
    const t = createSceneText({ lang: "en", shipName: "Lantern", pilotName: "Rin" });
    expect(t.text(LINE)).toBe("Rin, ready to prepare the ship whenever you are.");
    expect(t.text(LINE)).not.toContain("{");
  });

  it("createLaneText interpolates it too", () => {
    const t = createLaneText({ lang: "en", shipName: "Lantern", pilotName: "Rin" });
    expect(t.text(LINE)).toBe("Rin, ready to prepare the ship whenever you are.");
  });

  it("no profile binds an empty name, never the raw token", () => {
    // THE DEFECT ITSELF, as an assertion. A caller that omits the name used to
    // leave `{pilotName}` on screen; it must now resolve, even to nothing.
    for (const t of [
      createSceneText({ lang: "en", shipName: "Lantern" }),
      createLaneText({ lang: "en", shipName: "Lantern" }),
    ]) {
      expect(t.text(LINE)).not.toContain("{pilotName}");
      expect(t.text(LINE)).not.toContain("undefined");
    }
  });

  it("binds the ship name at the same time, so C07 is not traded away", () => {
    const t = createSceneText({ lang: "en", shipName: "Faro", pilotName: "Rin" });
    expect(t.text("results.shipIntact")).toBe("The Faro came through without a scratch.");
  });

  it("the token survives into the other two languages", () => {
    for (const lang of ["es", "hi"] as const) {
      const t = createSceneText({ lang, shipName: "Lantern", pilotName: "Rin" });
      expect(t.text(LINE)).toContain("Rin");
      expect(t.text(LINE)).not.toContain("{pilotName}");
    }
  });
});

describe("UR-182: a scene never inherits the last payload", () => {
  it("starts with an object, so Phaser cannot keep the previous one", () => {
    /**
     * Measured in the served build. Josh had cleared earth and mars; a new
     * pilot was created and lit earth; selecting Josh again drew:
     *
     *   source PAYLOAD  payloadCleared [earth]  storeCleared [earth, mars]
     *
     * The picker starts the map with no payload, and Phaser only overwrites
     * `settings.data` when the value is truthy - so the map kept the NEW
     * pilot's route and Jupiter locked again. `withStoredProgress` is
     * payload-first, so the stale payload beat the store.
     */
    for (const file of ["src/game/scenes/lib/init.ts", "src/game/ui/MenuScene.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toMatch(/scene\.start\(key, data \?\? \{\}\)/);
      expect(src, file).not.toMatch(/scene\.start\(key, data\)/);
    }
  });
});
