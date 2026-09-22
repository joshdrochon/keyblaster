import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NO PILOT WITHOUT A NAME (UR-146).
 *
 * ================== THE DEFECT ==================
 * The owner cleared localStorage repeatedly and a pilot called "Pilot" kept
 * coming back within seconds, which read as the game seeding a profile by
 * itself. Nothing seeds one - `grep` finds exactly one `createProfile` caller
 * in the whole build. What happened is simpler and worse:
 *
 *   `createProfile` passes `name: this.draft.pilotName.trim()`, and the schema
 *   turns a blank name into `DEFAULT_PROFILE_NAME` ("Pilot"). The forward
 *   button OPENS FOCUSED. So one press of Enter, on a screen nobody has typed
 *   into, commits a pilot named after the placeholder.
 *
 * ================== WHY THE FALLBACK STAYS ==================
 * The blank-name fallback is deliberate and its comment says why: "no
 * validation dialog, because 'you did it not-right' is the one thing this game
 * never says." That reasoning is still right, and it is still right for a
 * profile restored from an older save. What was wrong is a BUTTON THAT LOOKED
 * READY when the screen was not - so the button is locked instead, which says
 * the same thing with no copy at all.
 *
 * `Control.locked` is the existing vocabulary: dim, keeps its label, refuses
 * Enter (`FocusList.activate` checks it), and still takes the focus ring so
 * nothing becomes unreachable (D73, AC-18.1).
 */

const SRC = readFileSync("src/game/scenes/ProfileCreateScene.ts", "utf8");

describe("UR-146: the create screen will not commit an unnamed pilot", () => {
  it("the forward button's locked state is derived from the typed name", () => {
    expect(SRC).toMatch(/button\.locked = this\.draft\.pilotName\.trim\(\)\.length < MIN_NAME_LENGTH;/);
  });

  it("typing re-evaluates it", () => {
    // The field's own onChange, so the button unlocks on the first letter
    // rather than on a blur or a re-render.
    expect(SRC).toMatch(
      /this\.draft\.pilotName = value;[\s\S]{0,60}this\.syncForward\(\);/,
    );
  });

  it("it is evaluated when the button is built, not only on change", () => {
    // Otherwise the very first paint is an unlocked button on an empty field,
    // which is the exact frame the defect lived in.
    expect(SRC).toMatch(/this\.forward = button;[\s\S]{0,40}this\.syncForward\(\);/);
  });

  it("only the beat that collects the name is gated", () => {
    // The ship and ship-name beats are off today (`ENABLED_CREATE_STEPS`), but
    // gating them on a pilot name would be wrong if they come back.
    expect(SRC).toMatch(/if \(this\.currentStep\(\) !== "pilot"\)[\s\S]{0,80}locked = false;/);
  });

  it("the handle is cleared on re-entry", () => {
    // Phaser builds a scene once and re-runs `create`; a handle from the last
    // visit points at a destroyed object.
    expect(SRC).toMatch(/this\.forward = null;/);
  });

  it("NEGATIVE CONTROL: the schema's blank-name fallback is untouched", () => {
    // The fix is the button, not the fallback. A change here would mean a
    // child with an older save could lose the name their profile already has.
    const schema = readFileSync("src/engine/persistence/schema.ts", "utf8");
    expect(schema).toContain('export const DEFAULT_PROFILE_NAME = "Pilot";');
    expect(SRC).toMatch(/name: this\.draft\.pilotName\.trim\(\),/);
  });

  it("a locked control genuinely refuses Enter", () => {
    // The claim the whole fix rests on, asserted where it lives rather than
    // assumed: `FocusList.activate` is the only path Enter takes.
    const focus = readFileSync("src/game/ui/focus.ts", "utf8");
    expect(focus).toMatch(/activate\(\): void \{[\s\S]{0,120}if \(c && !c\.locked\)/);
  });
});
