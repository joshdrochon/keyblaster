import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * D101: THE RETICULE COMES OFF WITH THE SHELL.
 *
 * `onLocked` cuts the ring to `rock.sizePx * 0.62` and parents it to
 * `rock.container`, beside the body rather than inside it. `crackShell` reuses
 * that container for the core, so the shell's ring - 104 px on a 168 px shell -
 * stayed on a 64 px core, pointing at a rock nobody is typing. Measured in the
 * browser: `container.list.length` was 2 for the whole life of the core.
 *
 * `FlightScene` imports Phaser, so the guard is on the source.
 */
const SRC = readFileSync("src/game/scenes/FlightScene.ts", "utf8");

function bodyOf(name: string, until: string): string {
  const start = SRC.indexOf(name);
  expect(start, `${name} has been renamed`).toBeGreaterThan(-1);
  const end = SRC.indexOf(until, start);
  return SRC.slice(start, end === -1 ? SRC.length : end);
}

describe("a cracked shell takes its reticule with it", () => {
  it("the ring is a sibling of the body, which is why it survives the crack", () => {
    const locked = bodyOf("private onLocked(", "private onAdvanced(");
    expect(locked).toMatch(/rock\.container\.addAt\(ring, 0\)/);
    expect(locked, "the radius is the SHELL's while the shell is on").toMatch(
      /strokeCircle\(0, 0, rock\.sizePx \* 0\.62\)/,
    );
  });

  it("crackShell clears everything the container holds except the body", () => {
    const crack = bodyOf("private crackShell(", "private retireAtBreachLine(");
    expect(
      crack,
      "the shell's ring is left on the core, cut to the wrong radius",
    ).toMatch(/for \(const child of \[\.\.\.rock\.container\.list\]\) if \(child !== rock\.body\)/);
    expect(crack).toMatch(/child\.destroy\(\)/);
  });

  it("clears it BEFORE the core's own spawn, so a fresh lock draws a fresh ring", () => {
    const crack = bodyOf("private crackShell(", "private retireAtBreachLine(");
    const cleared = crack.indexOf("rock.container.list");
    const respawn = crack.indexOf('type: "spawn"');
    expect(cleared).toBeGreaterThan(-1);
    expect(respawn).toBeGreaterThan(-1);
    expect(cleared).toBeLessThan(respawn);
  });
});
