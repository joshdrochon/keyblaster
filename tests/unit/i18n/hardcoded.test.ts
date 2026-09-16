import { describe, expect, it } from "vitest";
import {
  HARDCODED_IGNORE_MARKER,
  findHardcodedStrings,
  scanSource,
} from "@engine/i18n/index.js";

/**
 * AC-14.3 fixtures.
 *
 * These are written as realistic Phaser scene source, not as English sentences
 * in quotes. That matters: D41 makes lowercase the default letter case, so the
 * copy this game contains ("play", "score", "game over") is shaped exactly like
 * a Phaser scene key, and the PascalCase keys and ease names Phaser forces on
 * us are shaped exactly like copy. A fixture set of capitalised English would
 * hide both failure modes.
 */

/** Everything user-facing goes through the translator. Nothing to report. */
const CLEAN_FLIGHT_SCENE = `
import Phaser from "phaser";
import { createTranslator } from "@engine/i18n/index.js";

export class FlightScene extends Phaser.Scene {
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super("FlightScene");
  }

  preload(): void {
    this.load.image("lantern", "assets/lantern.png");
    this.load.audio("blast", "audio/blast.mp3");
    this.load.json("palettes", "content/palettes.json");
  }

  create(): void {
    const t = createTranslator({ lang: "en", mode: "prod" });
    this.hud = this.add.text(16, 16, t.t("flight.hull"), {
      fontFamily: "Atkinson Hyperlegible",
      fontSize: "24px",
      color: "#f4e9d8",
    });
    this.tweens.add({ targets: this.hud, alpha: 1, ease: "Cubic.easeOut" });
    this.scene.launch("HudScene");
    this.input.keyboard?.on("keydown-ENTER", () => this.scene.start("MapScene"));
    console.log("FlightScene ready");
  }
}
`;

/** The same scene with three lowercase hard-coded strings. */
const DIRTY_FLIGHT_SCENE = `
export class FlightScene extends Phaser.Scene {
  create(): void {
    this.hud = this.add.text(16, 16, "score", {
      fontFamily: "Atkinson Hyperlegible",
      ease: "Cubic.easeOut",
    });
    this.add.text(320, 240, "play");
    this.scene.launch("HudScene");
    console.log("FlightScene ready");
  }

  private onDeath(): void {
    this.hud.setText("game over");
    this.scene.start("MapScene");
  }
}
`;

describe("AC-14.3: hard-coded UI strings are flagged", () => {
  it("AC-14.3: a realistic Phaser scene that uses i18n is clean", () => {
    expect(findHardcodedStrings(CLEAN_FLIGHT_SCENE)).toEqual([]);
  });

  it("AC-14.3: lowercase copy in a realistic Phaser scene is flagged", () => {
    // D41 default-lowercase copy is the miss class the shape-based classifier
    // had; all three of these are single lowercase tokens or two-word phrases.
    expect(findHardcodedStrings(DIRTY_FLIGHT_SCENE)).toEqual([
      "score",
      "play",
      "game over",
    ]);
  });

  it("AC-14.3: findings carry the line number and the reason", () => {
    const findings = scanSource(DIRTY_FLIGHT_SCENE);
    expect(findings[0]).toEqual({ value: "score", line: 4, reason: "literal" });
    expect(findings[2]).toEqual({
      value: "game over",
      line: 14,
      reason: "literal",
    });
  });

  it("AC-14.3: capitalised English copy is still flagged", () => {
    expect(
      findHardcodedStrings(`this.add.text(0, 0, "Nice flying, pilot!");`),
    ).toEqual(["Nice flying, pilot!"]);
  });

  it("AC-14.3: Spanish and Hindi copy is flagged too, not just English", () => {
    expect(findHardcodedStrings(`this.add.text(0, 0, "Pausa de salto");`)).toEqual(
      ["Pausa de salto"],
    );
    expect(findHardcodedStrings(`this.add.text(0, 0, "वार्प विराम");`)).toEqual([
      "वार्प विराम",
    ]);
  });

  it("AC-14.3: a single non-ASCII word is flagged even in an unknown position", () => {
    // Nothing in the Latin heuristics would catch these, so the script is the
    // signal: Devanagari and accented Latin are never technical tokens here.
    expect(findHardcodedStrings(`const s = "खेलो";`)).toEqual(["खेलो"]);
    expect(findHardcodedStrings(`const s = "ñandú";`)).toEqual(["ñandú"]);
  });

  it("AC-14.3: prose in an unknown position is flagged", () => {
    expect(findHardcodedStrings(`const msg = "ready to fly";`)).toEqual([
      "ready to fly",
    ]);
  });

  it("AC-14.3: duplicates collapse to one entry", () => {
    expect(
      findHardcodedStrings(`a.setText("play"); b.setText("play");`),
    ).toEqual(["play"]);
  });
});

describe("AC-14.3: position decides, not capitalisation", () => {
  const COPY: readonly [string, string, string][] = [
    ["add.text third argument", `this.add.text(0, 0, "score");`, "score"],
    ["setText", `this.hud.setText("score");`, "score"],
    [".text assignment", `this.hud.text = "score";`, "score"],
    ["label option", `this.make.text({ label: "score" });`, "score"],
    ["setTitle", `panel.setTitle("results");`, "results"],
    ["bitmapText", `this.add.bitmapText(0, 0, "font", "score");`, "score"],
  ];

  for (const [label, source, expected] of COPY) {
    it(`AC-14.3: flags a lowercase literal in a ${label}`, () => {
      expect(findHardcodedStrings(source)).toContain(expected);
    });
  }

  const NON_COPY: readonly [string, string][] = [
    ["scene key in super()", `super("FlightScene");`],
    ["scene.start", `this.scene.start("MapScene");`],
    ["scene.launch", `this.scene.launch("HudScene");`],
    ["load.image", `this.load.image("Lantern", "assets/Lantern.png");`],
    ["load.audio", `this.load.audio("Blast Off", "audio/blast.mp3");`],
    ["event name", `this.input.keyboard?.on("keydown-ENTER", go);`],
    ["console.log", `console.log("FlightScene is ready");`],
    ["fontFamily option", `t.setStyle({ fontFamily: "Atkinson Hyperlegible" });`],
    ["ease option", `this.tweens.add({ ease: "Cubic.easeOut" });`],
    ["i18n key", `this.add.text(0, 0, t.t("flight.hull"));`],
    ["module path", `import x from "@engine/i18n/index.js";`],
    ["object key position", `const m = { "Game Over": 1 };`],
    ["registry get", `this.registry.get("Ui Lang");`],
    ["sound.play", `this.sound.play("Blast Off");`],
  ];

  for (const [label, source] of NON_COPY) {
    it(`AC-14.3: does not flag a ${label}`, () => {
      expect(findHardcodedStrings(source)).toEqual([]);
    });
  }

  it("AC-14.3: the enclosing key beats the enclosing call", () => {
    // Inside add.text(), which is a copy call, fontFamily is still config.
    const source = `this.add.text(0, 0, "score", { fontFamily: "Atkinson Hyperlegible" });`;
    expect(findHardcodedStrings(source)).toEqual(["score"]);
  });

  it("AC-14.3: the innermost call wins", () => {
    // The i18n key sits inside t.t(), not inside add.text().
    expect(
      findHardcodedStrings(`this.add.text(0, 0, t.t("flight.hull"));`),
    ).toEqual([]);
  });
});

describe("AC-14.3: shape-based exemptions that survive", () => {
  const CASES: readonly [string, string][] = [
    ["camelCase identifier", `const k = "uiLang";`],
    ["kebab identifier", `const k = "map-scene";`],
    ["dotted identifier", `const k = "Cubic.easeOut";`],
    ["hex colour", `const c = "#1b2a4a";`],
    ["css length", `const w = "24px";`],
    ["css shorthand", `const b = "1px solid #1b2a4a";`],
    ["class list", `el.className = "hud hud-bar";`],
    ["constant case", `const m = "PROD";`],
    ["asset file", `const f = "ship.svg";`],
    ["absolute url", `const u = "https://example.test/api/coach";`],
    ["relative path", `const p = "./assets/ship.svg";`],
    ["number", `const n = "42";`],
    ["empty", `const s = "";`],
    ["single char", `const s = "x";`],
    ["punctuation only", `const s = "...";`],
  ];

  for (const [label, source] of CASES) {
    it(`AC-14.3: does not flag a ${label}`, () => {
      expect(findHardcodedStrings(source)).toEqual([]);
    });
  }
});

describe("AC-14.3 / C07: the ship is never named in copy", () => {
  it("C07: a hard-coded ship name in copy is its own finding", () => {
    const findings = scanSource(
      `this.add.text(0, 0, "The Lantern is ready.");`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe("ship-name");
  });

  it("C07: a lone ship name in a copy position is caught", () => {
    const findings = scanSource(`this.hud.setText("lantern");`);
    expect(findings[0]?.reason).toBe("ship-name");
  });

  it("C07: prose naming the ship in an unknown position is caught", () => {
    const findings = scanSource(`const msg = "the lantern is ready";`);
    expect(findings[0]?.reason).toBe("ship-name");
  });

  it("C07: an asset path for the ship's own art is NOT a violation", () => {
    // architecture.md documents a Lantern reference asset; every load path for
    // the ship's art would otherwise be a permanent finding.
    expect(
      findHardcodedStrings(`this.load.image("lantern", "assets/lantern.png");`),
    ).toEqual([]);
  });

  it("C07: a constant name holding the ship id is NOT a violation", () => {
    expect(findHardcodedStrings(`const SPRITE = "LANTERN_SPRITE";`)).toEqual([]);
  });

  it("C07: an asset key in an unknown position is NOT a violation", () => {
    // `"lantern"` as a texture key is not copy, so C07 does not apply.
    expect(findHardcodedStrings(`const shipTexture = "lantern";`)).toEqual([]);
  });
});

describe("AC-14.3: the scanner understands JavaScript, not just quotes", () => {
  it("ignores copy inside a line comment", () => {
    expect(
      findHardcodedStrings(`// this renders "ready to fly" on screen\n`),
    ).toEqual([]);
  });

  it("ignores copy inside a block comment", () => {
    expect(
      findHardcodedStrings(`/* renders "ready to fly" */ const a = 1;`),
    ).toEqual([]);
  });

  it("ignores a quote inside a regex literal", () => {
    expect(findHardcodedStrings(`const q = /["']/g; const n = 1;`)).toEqual([]);
  });

  it("handles an escaped delimiter inside a regex literal", () => {
    expect(
      findHardcodedStrings(`const p = /a\\/"b/; label.setText("ready to fly");`),
    ).toEqual(["ready to fly"]);
  });

  it("does not mistake division for a regex", () => {
    expect(
      findHardcodedStrings(`const r = a / b; label.setText("ready to fly");`),
    ).toEqual(["ready to fly"]);
  });

  it("handles escaped quotes inside a string", () => {
    expect(
      findHardcodedStrings(`label.setText("she said \\"go\\" twice");`),
    ).toEqual(['she said "go" twice']);
  });

  it("stops an unterminated string at the line end and keeps scanning", () => {
    // Recovery matters more than the exact verdict: one typo must not make the
    // rest of the file invisible to the lint.
    expect(
      findHardcodedStrings(`label.setText("ready to fly\nsetText("ok")`),
    ).toEqual(["ready to fly", "ok"]);
  });

  it("survives an unterminated regex", () => {
    expect(() =>
      findHardcodedStrings(`const r = /abc\nconst n = 1;`),
    ).not.toThrow();
  });

  it("survives an unterminated block comment", () => {
    expect(findHardcodedStrings(`/* "ready to fly"`)).toEqual([]);
  });

  it("counts lines correctly deep in a file", () => {
    const source = `${"\n".repeat(30)}label.setText("ready to fly");`;
    expect(scanSource(source)[0]?.line).toBe(31);
  });
});

describe("AC-14.3: template literals report their raw source", () => {
  it("reports the template with its placeholders, so findings are greppable", () => {
    // "hull %" appears nowhere in the file and cannot be grepped for.
    expect(findHardcodedStrings("this.hud.setText(`hull ${hp}%`)")).toEqual([
      "hull ${hp}%",
    ]);
  });

  it("scans code inside ${} as code", () => {
    expect(
      findHardcodedStrings('this.hud.setText(`${t.t("flight.hull")}`)'),
    ).toEqual([]);
  });

  it("handles an escape inside a template literal", () => {
    // The report is the raw source, backslash included, because that is what
    // the developer will grep for.
    expect(findHardcodedStrings("this.hud.setText(`line \\` here`)")).toEqual([
      "line \\` here",
    ]);
  });

  it("survives an unterminated template literal", () => {
    expect(findHardcodedStrings("this.hud.setText(`ready to fly")).toEqual([
      "ready to fly",
    ]);
  });

  it("a template of only placeholders has no copy to report", () => {
    expect(findHardcodedStrings("this.hud.setText(`${a}${b}`)")).toEqual([]);
  });
});

describe(`AC-14.3: the ${HARDCODED_IGNORE_MARKER} escape hatch`, () => {
  it("exempts a line via a trailing line comment", () => {
    expect(
      findHardcodedStrings(`const font = "Atkinson Hyperlegible"; // i18n-ignore`),
    ).toEqual([]);
  });

  it("exempts a line via a leading block comment", () => {
    expect(
      findHardcodedStrings(`/* i18n-ignore */ this.hud.setText("score");`),
    ).toEqual([]);
  });

  it("exempts only the marked line", () => {
    const source = [
      `this.hud.setText("score"); // i18n-ignore`,
      `this.hud.setText("play");`,
    ].join("\n");
    expect(findHardcodedStrings(source)).toEqual(["play"]);
  });

  it("exempts every line a multi-line block comment spans", () => {
    const source = `/* i18n-ignore\n*/ this.hud.setText("score");`;
    expect(findHardcodedStrings(source)).toEqual([]);
  });
});
