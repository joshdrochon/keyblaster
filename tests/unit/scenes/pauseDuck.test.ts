import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAUSE_DUCK_DB,
  PAUSE_DUCK_SOURCE,
  DUCK_ATTACK_MS,
  DUCK_RELEASE_MS,
} from "@game/audio/graph";
import { DUCK_DB } from "@game/audio/voice";

/**
 * UR-145 - PAUSING DUCKS, RESUMING RELEASES, AND SETTLING INTO SETTINGS DOES NOT.
 *
 * ================== WHAT WAS ASKED FOR ==================
 * The project owner: the in-game pause menu should make the music quieter; it
 * should STAY quieter if Settings is opened from inside that pause menu; and
 * coming out of pause should feel like dropping back into the action.
 *
 * ================== WHY A SOURCE GUARD ==================
 * `PauseScene` extends a Phaser class and cannot be imported under vitest's
 * node environment - the same reason `menuHeading.test.ts` and
 * `settingsDeadRows.test.ts` read their scenes as text. What this file can do
 * that a regex alone cannot is check the scene against the REAL exported
 * constants, so moving `PAUSE_DUCK_DB` moves the claim with it.
 *
 * The BEHAVIOUR of the duck is proved elsewhere, by execution:
 *   `tests/unit/audio/graph.test.ts`   the sidechain arithmetic and composition
 *   `tests/unit/audio/wiring.test.ts`  the service boundary, idempotence, dispose
 *   `tests/unit/audio/rendered.test.ts` the RENDERED SAMPLES, before/during/after
 *
 * ================== WATCH THEM FAIL ==================
 * Real messages, from red runs with the named line changed back:
 *
 *   `this.duckWorld()` removed from `build()`
 *     PauseScene never asks for the duck: expected false to be true
 *
 *   `openSettings` changed from `this.scene.sleep()` to `this.scene.stop()`
 *     expected 'private openSettings(): void {\n    i...' to contain
 *     'this.scene.sleep()'
 *     (the "must not SHUT THIS SCENE DOWN" assertion in the same case is the
 *     other direction of the same mutation)
 *
 *   the SHUTDOWN release changed to a SLEEP release
 *     the duck is released on SHUTDOWN, which is the event Resume and Quit
 *     both reach and Settings does not: expected false to be true
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game");
const read = (rel: string): string => readFileSync(resolve(SRC, rel), "utf8");
/** Source with comments stripped, so a comment can never satisfy a guard. */
const code = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const pause = code("scenes/PauseScene.ts");

describe("UR-145: the pause menu holds the duck for exactly as long as it is up", () => {
  it("asks for the duck while building the overlay", () => {
    expect(/this\.duckWorld\(\)/.test(pause), "PauseScene never asks for the duck").toBe(
      true,
    );
    // ...and `setWorldDucked` is the scene's one route to the audio service,
    // so both the ask and the release go through the same idempotent call.
    expect(/setWorldDucked\(\s*true\s*\)/.test(pause)).toBe(true);
    expect(
      /private setWorldDucked\([\s\S]{0,200}?setPauseDuck\(active\)/.test(pause),
    ).toBe(true);
  });

  it("releases it on SHUTDOWN, which Resume and Quit both reach", () => {
    // `resumeFlight` and `quitToMap` both call `this.scene.stop()`, and stop is
    // what fires SHUTDOWN. Hanging the release there rather than on a "menu
    // closed" callback is what makes the two exits agree without either of
    // them naming the audio.
    const shutdown =
      /Phaser\.Scenes\.Events\.SHUTDOWN[\s\S]{0,400}?setWorldDucked\(\s*false\s*\)/.test(
        pause,
      );
    expect(
      shutdown,
      "the duck is released on SHUTDOWN, which is the event Resume and Quit both reach and Settings does not",
    ).toBe(true);
    for (const method of ["resumeFlight", "quitToMap"]) {
      const body = new RegExp(`private ${method}\\(\\)[\\s\\S]*?\\n  \\}`).exec(pause);
      expect(body, method).not.toBeNull();
      expect(body?.[0] ?? "", `${method} must stop this scene`).toContain(
        "this.scene.stop()",
      );
    }
  });

  it("opening Settings SLEEPS rather than stops, so the duck survives it", () => {
    // THE HALF THE OWNER CALLED OUT EXPLICITLY. Sleep does not fire SHUTDOWN.
    const body = /private openSettings\(\)[\s\S]*?\n  \}/.exec(pause)?.[0] ?? "";
    expect(body).toContain("this.scene.sleep()");
    expect(
      /this\.scene\.stop\(\)/.test(body),
      "opening Settings from Pause must not SHUT THIS SCENE DOWN - shutdown is what releases the duck",
    ).toBe(false);
    // ...and Settings comes back by WAKING this scene, not restarting it.
    expect(code("scenes/SettingsScene.ts")).toContain("this.scene.wake(SCENE_KEYS.pause)");
  });

  it("re-asserts on WAKE, and stops listening when it shuts down", () => {
    // `create` does not run again when Settings hands the scene back, so the
    // WAKE hook is the only place a duck released underneath it can be
    // noticed. The listener is removed on shutdown so a re-entered scene does
    // not stack a second one.
    expect(/Phaser\.Scenes\.Events\.WAKE, this\.onWake/.test(pause)).toBe(true);
    expect(/this\.events\.off\(Phaser\.Scenes\.Events\.WAKE, this\.onWake\)/.test(pause)).toBe(
      true,
    );
  });

  it("never writes a bus gain itself - that is the `setBase` note's whole point", () => {
    // A pause that wrote `buses.music.gain.value` would be undone by the next
    // voice release AND would clobber whatever the Music knob had been set to.
    expect(pause).not.toMatch(/setBusGain/);
    expect(pause).not.toMatch(/gain\.value/);
    expect(pause).not.toMatch(/\bducker\b/);
  });
});

describe("UR-145: the numbers the pause duck is built on", () => {
  it("is shallower than Shadow speaking, which is a specification", () => {
    // AC-21.4 says the voice duck is at least 6 dB. A pause that ducked harder
    // would make the character's own line inaudible in the mix.
    expect(PAUSE_DUCK_DB).toBeGreaterThan(DUCK_DB);
    // ...and deep enough to be obvious: ~3 dB is where a level change on a
    // sustained bed stops being noticeable at all.
    expect(PAUSE_DUCK_DB).toBeLessThanOrEqual(-4);
    // ...and not a mute. The request is about the RETURN, and you cannot
    // return to something that was switched off.
    expect(PAUSE_DUCK_DB).toBeGreaterThan(-12);
  });

  it("reuses the existing ramps rather than inventing a second pair", () => {
    // `DUCK_RELEASE_MS`'s own reason for being slower than the attack is "the
    // world comes back rather than snapping back", which is the owner's
    // sentence for this ticket in different words.
    expect(DUCK_RELEASE_MS).toBeGreaterThan(DUCK_ATTACK_MS);
    const graph = read("audio/graph.ts");
    expect(graph).not.toMatch(/PAUSE_DUCK_ATTACK/);
    expect(graph).not.toMatch(/PAUSE_DUCK_RELEASE/);
  });

  it("has exactly one holder, named once", () => {
    expect(PAUSE_DUCK_SOURCE).toBe("pause");
    // One call site across the whole product. A second holder is how a duck
    // comes to be released by something that did not open it.
    const holders = ["audio/wiring.ts", "audio/graph.ts", "scenes/PauseScene.ts"]
      .map(code)
      .join("\n")
      .match(/setSource\(\s*PAUSE_DUCK_SOURCE/g);
    expect(holders?.length ?? 0, "more than one place holds the pause duck").toBe(1);
  });
});

describe("a menu does not move the ambient bed (UR-171)", () => {
  const menu = readFileSync("src/game/ui/MenuScene.ts", "utf8");
  const parallax = readFileSync("src/game/render/parallax.ts", "utf8");

  it("MenuScene declines to publish the world stop", () => {
    // It paints in Earth's palette for want of one of its own. Publishing that
    // switched the bed to Earth's, and it OUTLIVED the menu: resuming a paused
    // Flight does not rebuild its parallax, so nothing republished the real
    // stop and the map music played over the belt.
    expect(menu).toMatch(/publishStop: false/);
  });

  it("buildParallax publishes by default, and only skips when asked", () => {
    expect(parallax).toMatch(
      /if \(options\.publishStop !== false\) scene\.game\.registry\.set\(WORLD_STOP_KEY/,
    );
  });

  it("every scene that IS at a place still publishes", () => {
    for (const file of [
      "src/game/scenes/FlightScene.ts",
      "src/game/scenes/DirectorMapScene.ts",
      "src/game/scenes/BeaconScene.ts",
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/publishStop: false/);
    }
  });
});

describe("the map holds the bed back but keeps its music (UR-172)", () => {
  const map = readFileSync("src/game/scenes/DirectorMapScene.ts", "utf8");
  const wiring = readFileSync("src/game/audio/wiring.ts", "utf8");

  it("trims the ambient bus on entry and releases it on shutdown", () => {
    expect(map).toMatch(/setAmbientTrim\(true\)/);
    expect(map).toMatch(/SHUTDOWN[\s\S]{0,120}setAmbientTrim\(false\)/);
  });

  it("touches the ambient bus only - the hub theme is unchanged", () => {
    expect(wiring).toMatch(/graph\.ambient\.setTrim\(active \? AMBIENT_TRIM : 1\)/);
    expect(map).not.toMatch(/setBusGain\("music"/);
  });

  it("survives the Sound knob moving while the map is open", () => {
    // The trim lives on the BED now, so the Sound knob writes the bus plainly
    // and cannot undo it.
    expect(wiring).toMatch(/graph\.setBusGain\("ambient", volumes\.sfx\)/);
  });

  it("UR-174: the trim is a property of the bed, not of the bus", () => {
    // A bus attenuation has to be released at the moment of transition, and
    // any mismatch is the OLD bed getting louder on its way out - the blip on
    // entering a stop. Held per voice, an outgoing bed can only decrease.
    const ambient = readFileSync("src/game/audio/ambient.ts", "utf8");
    expect(ambient).toMatch(/voice\.trim = this\.trim;/);
    expect(ambient).toMatch(
      /outVoice\.gain\.gain\.value = outVoice\.spec\.level \* outVoice\.trim \* fade\.out/,
    );
    expect(wiring).not.toMatch(/AMBIENT_TRIM_RAMP_MS/);
  });
});

describe("the game opens on the bed for where the player actually is (UR-173)", () => {
  const boot = readFileSync("src/game/boot.ts", "utf8");

  it("does not open on Earth regardless of the saved profile", () => {
    // A pilot at Pluto heard Earth's bed on every refresh, then a crossfade to
    // their own. `furthestBeacon` is known before any scene loads.
    expect(boot).toMatch(/audio\.ambientFor\(openAt\)/);
    expect(boot).not.toMatch(/audio\.ambientFor\("earth"\)/);
  });

  it("falls back to Earth for a profile that has lit nothing", () => {
    expect(boot).toMatch(/furthestBeacon\(store\) \?\? "earth"/);
  });
});

describe("the chart screens hold the bed back, the ship screens do not (UR-172)", () => {
  const map = readFileSync("src/game/scenes/DirectorMapScene.ts", "utf8");
  const log = readFileSync("src/game/scenes/BeaconLogScene.ts", "utf8");
  const settings = readFileSync("src/game/scenes/SettingsScene.ts", "utf8");

  /**
   * Reported from play: the hum jumped on the way into the Beacon Log. The map
   * trimmed the bed and the log did not, so stepping between two views of the
   * same route changed how loud the world was. Measured in a browser, spying
   * on the real call: map -> log now reads [false, true] and ends trimmed,
   * because SHUTDOWN runs before the next scene's create.
   */
  it("the map and the log both trim, and both hand it back on the way out", () => {
    for (const [name, src] of [["map", map], ["log", log]] as const) {
      expect(src, `${name} does not trim the bed`).toMatch(/setAmbientTrim\(true\)/);
      expect(src, `${name} never hands the bed back`).toMatch(/setAmbientTrim\(false\)/);
    }
  });

  it("Settings does not: it is the inside of the ship, not a chart of the route", () => {
    expect(settings).not.toMatch(/setAmbientTrim/);
  });
});
