import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TABLES } from "@engine/i18n/strings";
import { LANE_COPY_EN, createLaneText } from "@game/scenes/support/copy";

/**
 * ============ THE SCREEN AFTER A BELT CHARGES A BEACON, NOT A WARP DRIVE ============
 *
 * THE DEFECT, IN THE FICTION RATHER THAN IN THE CODE. The belt is AT the
 * destination: clearing Mars' belt means the pilot is already at Mars, with
 * Mars-coloured rocks around them. A "warp drive" that charges afterwards is a
 * journey to a place you are standing in. The screen then named the stop AFTER
 * this one ("Destination: Pluto") while the very next scene planted NEPTUNE's
 * beacon - so the one line that pointed forward pointed at the wrong planet.
 *
 * The beat is in the right place; only its meaning was wrong. The words the
 * child blasted now charge the BEACON they are about to plant, so the meter's
 * output is a physical object in the next scene and the sentence stops being a
 * flourish.
 *
 * WHY THE COPY IS ASSERTED AND THE WIRING IS GREPPED. `support/copy.ts` and
 * `@engine/i18n/strings` are pure data and are resolved through the real
 * `createLaneText`, so what is asserted is the string a screen GETS.
 * `WarpScene.ts` extends a Phaser class and cannot be imported under vitest's
 * node environment, so its half is a source guard - the same binding
 * `warpExit.test.ts` and `warpChrome.test.ts` already use against the same
 * file, for the same reason. The pixels are `tests/e2e/warp-beacon.spec.ts`.
 *
 *   npx vitest run tests/unit/scenes/warpBeacon.test.ts --coverage.enabled=false
 */

const source = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/game/scenes/WarpScene.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const en = createLaneText({ lang: "en", shipName: "Lantern" });
const es = createLaneText({ lang: "es", shipName: "Lantern" });

/**
 * ================== WATCHED FAILING (rule 4) ==================
 * Real printed values from the red run, with the warp-drive copy in place:
 *
 *   nothing a player reads on this screen says "warp drive"
 *     the warp drive is still on screen: expected [ 'warp.heading',
 *     'warp.prompt', 'warp.beltCleared', 'warp.chargedNext',
 *     'warp.chargedLast' ] to deeply equal []
 *   nothing a player reads on this screen says "warp drive" (lane copy)
 *     expected [ 'warp.chargeLabel', 'warp.charged' ] to deeply equal []
 *   the header says the typing charges the beacon
 *     expected 'Asteroid belt cleared. Type the sentence below to charge the
 *     warp drive.' to contain 'charge the beacon'
 *   the meter's label names the beacon's charge
 *     expected 'Warp Drive' to be 'Beacon Charge'
 *   and in Spanish
 *     expected 'Motor de salto' to be 'Carga de baliza'
 */
describe("the warp break charges a beacon", () => {
  const SCREEN_KEYS = [
    "warp.heading",
    "warp.prompt",
    "warp.beltCleared",
    "warp.nextStop",
    "warp.chargedNext",
    "warp.chargedLast",
  ] as const;

  it("leaves no warp drive anywhere in the engine's table, in any language", () => {
    // The SWEEP, as an assertion rather than as a grep somebody ran once, and
    // in all three languages because the fiction is not an English property.
    const offenders: string[] = [];
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const key of SCREEN_KEYS) {
        const value = table[key];
        if (value === undefined) continue;
        if (/warp|salto|वार्प/iu.test(value)) offenders.push(`${lang}:${key}`);
      }
    }
    expect(offenders, "the warp drive is still on screen").toEqual([]);
  });

  it("leaves no warp drive anywhere in the lane's own table", () => {
    const offenders = Object.entries(LANE_COPY_EN)
      .filter(([, value]) => /\bwarp\b/i.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("says on the header that the typing charges the beacon", () => {
    const line = TABLES.en["warp.beltCleared"] ?? "";
    // UR-78's two halves are kept: WHICH belt, and WHAT the sentence is for.
    expect(line).toContain("Asteroid belt cleared");
    expect(line).toContain("Type the sentence below");
    expect(line).toContain("charge the beacon");
  });

  it("names the beacon being charged on the line above the sentence", () => {
    // The row is a LABEL, so Title Case, and it carries the stop it belongs to.
    const row = en.text("warp.nextStop", { stop: "Mars" });
    expect(row).toBe("Charging: Mars Beacon");
    expect(es.text("warp.nextStop", { stop: "Marte" })).toBe("Cargando: baliza de Marte");
  });

  it("hands the charge to the next scene: the charged line says PLANT IT", () => {
    // THE WHOLE POINT OF THE RECAST. The meter's output has to become the
    // object the next screen plants, so the line at 100% names that act and
    // names the place - and the place is the stop the child is standing at.
    const charged = en.text("warp.chargedNext", { stop: "Mars" });
    expect(charged).toBe("Beacon charged. Plant it at Mars.");
    expect(es.text("warp.chargedNext", { stop: "Marte" })).toBe(
      "Baliza cargada. Plántala en Marte.",
    );
  });

  it("labels the meter with the beacon's charge, in Title Case", () => {
    // Labels are Title Case, sentences are sentence case with one capital
    // (the owner's rule, `gauntlet/escalations.md`).
    expect(en.text("warp.chargeLabel")).toBe("Beacon Charge");
    // Spanish does not Title Case a common-noun phrase, so the rule there is
    // "the label carries a capital", which is one capital.
    expect(es.text("warp.chargeLabel")).toBe("Carga de baliza");
  });

  it("keeps the sentences to one capital, which is the other way to get this wrong", () => {
    for (const value of [
      TABLES.en["warp.beltCleared"] ?? "",
      TABLES.en["warp.chargedNext"] ?? "",
      TABLES.en["warp.prompt"] ?? "",
    ]) {
      const words = value.split(" ");
      expect(words[0]?.[0]).toBe(words[0]?.[0]?.toLocaleUpperCase());
      // Only a word that FOLLOWS a full stop, or a substituted proper noun,
      // may carry a capital. `{stop}` is a placeholder, not a word.
      const stray = words
        .slice(1)
        .filter((w, i) => /^[A-Z]/.test(w) && !/[.!?]$/.test(words[i] ?? ""));
      expect(stray, `${value} Title Cases a sentence`).toEqual([]);
    }
  });
});

/**
 * ================== WATCHED FAILING (rule 4) ==================
 *   the badge and the destination row are the CURRENT stop
 *     the destination is still the stop AFTER this one; the next scene plants
 *     the beacon for THIS one: expected true to be false
 */
describe("the beacon being charged is the stop the child is standing at", () => {
  it("does not walk the route forward to find it", () => {
    // `STOP_IDS[indexOf(current) + 1]` is the defect itself: it named Pluto on
    // the screen before the scene that planted Neptune's beacon, and it
    // returned null at Pluto so the last stop of the game had no row and no
    // badge at all.
    expect(
      /STOP_IDS\s*\[\s*STOP_IDS\.indexOf\(this\.stopId\)\s*\+\s*1\s*\]/.test(source()),
      "the destination is still the stop AFTER this one; the next scene plants " +
        "the beacon for THIS one",
    ).toBe(false);
  });

  it("draws the badge from the same stop the row names", () => {
    // ONE SOURCE FOR BOTH, so the picture and the word cannot disagree. The
    // badge needs the id and the row needs the NAME: `copy.stopName` is
    // translated, so a badge keyed off it would look up "Marte" in a palette
    // table keyed by "mars" and quietly draw nothing.
    const src = source();
    expect(/private beaconStopId\(\): StopId \{\s*return this\.stopId;/.test(src)).toBe(true);
    expect(src).toContain("planetBadgeSpec(beaconId)");
    expect(src).toContain("planetBadgeInk(beaconId,");
  });

  it("has no unreachable last-stop branch left behind", () => {
    // The current stop always exists, so the `null` arms that existed for
    // Pluto cannot be reached any more. A branch that cannot run is a branch
    // nobody maintains.
    const src = source();
    expect(/warp\.chargedLast/.test(src), "a dead Pluto branch is still wired").toBe(false);
    expect(/warp\.prompt/.test(src), "a dead Pluto branch is still wired").toBe(false);
  });
});

/**
 * ================== WATCHED FAILING (rule 4) ==================
 *   `lantern` survives a visit it was not drawn on
 *     a destroyed LanternRig is still on the field after an overlaid mount:
 *     expected false to be true
 *   `meterEaseFrames` survives a visit
 *     AC-22.5 reads "zero means it stepped"; a count carried in from the last
 *     visit makes that false in the direction that hides the defect:
 *     expected false to be true
 */
describe("nothing on this screen carries across mounts", () => {
  /**
   * Phaser builds a scene ONCE and re-runs `create` on the same instance, so a
   * class-field initialiser runs per PAGE LOAD and `init` runs per VISIT.
   * Anything a visit owns has to be cleared in `init`, and two fields were not.
   *
   * `lantern` is the one with teeth: `create` only assigns it on the standalone
   * path, and `SHUTDOWN` destroys the rig without clearing the field - so a
   * standalone mount followed by an overlaid one left a DESTROYED rig in place,
   * and `snapshot().ship.drawn` said a ship was on screen when none was.
   */
  const init = (): string => {
    const src = source();
    return src.slice(src.indexOf("init(data: WarpInit"), src.indexOf("create(): void"));
  };

  it("clears every field a visit owns in `init`, not in a class field", () => {
    for (const field of [
      "lantern",
      "meterEaseFrames",
      "meterShown",
      "chargeStage",
      "pulses",
      "warping",
    ]) {
      expect(init(), `this.${field} survives a second visit`).toContain(`this.${field} =`);
    }
  });

  it("does not leave a destroyed rig reported as a drawn ship", () => {
    // The claim `snapshot()` makes off that field, named so a future edit that
    // re-breaks the reset has something to fail against.
    expect(source()).toContain("drawn: this.lantern !== null");
    expect(init()).toContain("this.lantern = null;");
  });
});

/**
 * ================== WATCHED FAILING (rule 4) ==================
 *   the ring arrives with the card it is around
 *     the focus ring is not part of the panel's entrance, so it hangs in
 *     space until the card catches up: expected false to be true
 */
describe("the outline and its box appear together", () => {
  it("makes the ring part of the panel's ENTRANCE, as it is part of its exit", () => {
    // THE DEFECT. `slideIn` sets `panelRoot` to alpha 0 at y+150 and tweens it
    // in; the ring is created outside `panelRoot` (so it draws OVER the card)
    // and was never given that entrance, so it was painted at full alpha at
    // the card's FINAL position while the card was still transparent and 150 px
    // below. The exit already had the symmetric fix - this is the same object,
    // the other end of the screen's life.
    const src = source();
    const slide = src.slice(src.indexOf("private slideIn("), src.indexOf("private scrim("));
    expect(
      /this\.ring\.graphics/.test(slide),
      "the focus ring is not part of the panel's entrance, so it hangs in " +
        "space until the card catches up",
    ).toBe(true);
  });

  it("does not let a keystroke re-pop the ring mid-entrance", () => {
    // THE ONLY WAY THE DEFECT COULD COME BACK. `onKey` re-pops the focus ring
    // on Tab or Enter, and `createFocusRing.moveTo` plays its own 0.55 -> 1
    // arrival - which would replace the entrance's alpha and light the outline
    // around a card that has not arrived, on a keystroke. The target is the
    // one this screen already has, so the pop is skipped while it is arriving
    // and nothing moves.
    //
    // WATCHED FAILING, with the guard removed:
    //   a Tab during the slide re-lights the ring over a card that is not
    //   there: expected false to be true
    const src = source();
    const onKey = src.slice(src.indexOf("private onKey("), src.indexOf("private soundCharge("));
    expect(
      /if \(!this\.entering\)/.test(onKey),
      "a Tab during the slide re-lights the ring over a card that is not there",
    ).toBe(true);
    const slide = src.slice(src.indexOf("private slideIn("), src.indexOf("private scrim("));
    // Armed AND disarmed: a flag that is only ever set true would silence the
    // focus pop for the rest of the screen's life.
    expect(slide).toContain("this.entering = true;");
    expect(slide).toContain("this.entering = false;");
  });

  it("builds the ring before the entrance is armed, not after it", () => {
    // Ordering, so the ring cannot be created at full alpha for a frame and
    // then hidden: `create` has to have the ring in hand when `slideIn` runs.
    const src = source();
    expect(src.indexOf("this.ring = createFocusRing(")).toBeLessThan(
      src.indexOf("this.slideIn();"),
    );
  });
});
