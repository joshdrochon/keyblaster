import { describe, expect, it } from "vitest";
import {
  HARDCODED_IGNORE_MARKER,
  findHardcodedStrings,
  scanSource,
} from "@engine/i18n/index.js";

/**
 * AC-14.3 fixtures. These stand in for scene source: the real lint will run
 * this same function over every file in src/game once scenes exist.
 */

const CLEAN_SCENE = `
import Phaser from "phaser";
import { createTranslator } from "@engine/i18n/index.js";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("title-scene");
  }

  create(): void {
    const t = createTranslator({ lang: this.registry.get("uiLang"), mode: "prod" });
    this.add.text(0, 0, t.t("title.tagline"), { fontFamily: "kb-sans" });
    this.add.text(0, 40, t.t("title.play"));
    this.input.keyboard?.on("keydown-ENTER", () => this.scene.start("profile-scene"));
    this.load.json("palettes", "content/palettes.json");
  }
}
`;

const DIRTY_SCENE = `
export class ResultsScene extends Phaser.Scene {
  create(): void {
    this.add.text(0, 0, "Nice flying, pilot!");
    this.add.text(0, 20, "Continue");
    this.scene.start("map-scene");
  }
}
`;

describe("AC-14.3: hard-coded UI strings are flagged", () => {
  it("AC-14.3: a scene that reads every string from i18n is clean", () => {
    expect(findHardcodedStrings(CLEAN_SCENE)).toEqual([]);
  });

  it("AC-14.3: a scene with English baked in is flagged", () => {
    expect(findHardcodedStrings(DIRTY_SCENE)).toEqual([
      "Nice flying, pilot!",
      "Continue",
    ]);
  });

  it("AC-14.3: findings carry the line number and the reason", () => {
    const findings = scanSource(DIRTY_SCENE);
    expect(findings[0]).toEqual({
      value: "Nice flying, pilot!",
      line: 4,
      reason: "literal",
    });
  });

  it("AC-14.3: Spanish and Hindi copy is flagged too, not just English", () => {
    expect(findHardcodedStrings(`ui.label("Pausa de salto");`)).toEqual([
      "Pausa de salto",
    ]);
    expect(findHardcodedStrings(`ui.label("वार्प विराम");`)).toEqual([
      "वार्प विराम",
    ]);
  });

  it("AC-14.3: a single non-ASCII word is flagged even though it is lowercase", () => {
    // Nothing in the Latin heuristics would catch these, so the script itself
    // is the signal.
    expect(findHardcodedStrings(`ui.label("खेलो");`)).toEqual(["खेलो"]);
    expect(findHardcodedStrings(`ui.label("ñandú");`)).toEqual(["ñandú"]);
  });

  it("AC-14.3: C07 - a hard-coded ship name is its own finding", () => {
    const findings = scanSource(`this.add.text(0, 0, "The Lantern is ready.");`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe("ship-name");
  });

  it("AC-14.3: C07 - even a lone technical-looking 'lantern' is caught", () => {
    expect(findHardcodedStrings(`const ship = "lantern";`)).toEqual(["lantern"]);
  });

  it("AC-14.3: template literal copy is flagged", () => {
    expect(findHardcodedStrings("label(`Hull integrity`)")).toEqual([
      "Hull integrity",
    ]);
  });

  it("AC-14.3: code inside ${} is scanned, static chunks are the copy", () => {
    // The i18n key inside ${} is a key, not copy; the static text around it is
    // copy, and quotes inside a template are part of that text, not literals.
    const found = findHardcodedStrings(
      "label(`Score ${t.t(\"results.accuracy\")} and \"Bonus points\"`)",
    );
    expect(found).toEqual(['Score  and "Bonus points"']);
  });

  it("AC-14.3: a template whose only content is an i18n call is clean", () => {
    expect(findHardcodedStrings('label(`${t.t("results.accuracy")}`)')).toEqual(
      [],
    );
  });

  it("AC-14.3: duplicates collapse to one entry", () => {
    expect(findHardcodedStrings(`a("Play"); b("Play");`)).toEqual(["Play"]);
  });
});

describe("AC-14.3: technical literals are not flagged", () => {
  const CASES: readonly [string, string][] = [
    ["scene key", `this.scene.start("map-scene");`],
    ["event name", `this.input.on("pointerdown", go);`],
    ["camelCase key", `registry.get("uiLang");`],
    ["i18n key", `t.t("settings.contentLang");`],
    ["module path", `import x from "@engine/i18n/index.js";`],
    ["relative path", `const url = "./assets/ship.svg";`],
    ["absolute url", `fetch("https://example.test/api/coach");`],
    ["asset file", `this.load.audio("blast", "blast.mp3");`],
    ["hex colour", `g.fillStyle("#1b2a4a");`],
    ["css length", `el.style.width = "24px";`],
    ["constant case", `const MODE = "PROD";`],
    ["class list", `el.className = "hud hud-bar";`],
    ["number", `const n = "42";`],
    ["css shorthand", `el.style.border = "1px solid #1b2a4a";`],
    ["css selector", `document.querySelector("btn:hover");`],
    ["bare i18n key", `const key = "settings.contentLang";`],
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

describe("AC-14.3: the scanner understands JavaScript, not just quotes", () => {
  it("ignores copy inside a line comment", () => {
    expect(findHardcodedStrings(`// this says "Hello there" on screen\n`)).toEqual(
      [],
    );
  });

  it("ignores copy inside a block comment", () => {
    expect(findHardcodedStrings(`/* renders "Hello there" */ const a = 1;`)).toEqual(
      [],
    );
  });

  it("ignores a quote inside a regex literal", () => {
    expect(findHardcodedStrings(`const q = /["']/g; const n = 1;`)).toEqual([]);
  });

  it("handles an escaped delimiter inside a regex literal", () => {
    expect(findHardcodedStrings(`const p = /a\\/"b/; say("Ready to fly");`)).toEqual(
      ["Ready to fly"],
    );
  });

  it("does not mistake division for a regex", () => {
    expect(findHardcodedStrings(`const r = a / b; say("Ready to fly");`)).toEqual([
      "Ready to fly",
    ]);
  });

  it("handles escaped quotes inside a string", () => {
    expect(findHardcodedStrings(`say("She said \\"go\\" twice");`)).toEqual([
      'She said "go" twice',
    ]);
  });

  it("handles an escape inside a template literal", () => {
    expect(findHardcodedStrings("say(`Line \\` here`)")).toEqual(["Line ` here"]);
  });

  it("does not run past an unterminated string", () => {
    expect(findHardcodedStrings(`say("Ready to fly\nsay("ok")`)).toEqual([
      "Ready to fly",
    ]);
  });

  it("survives an unterminated regex", () => {
    expect(() => findHardcodedStrings(`const r = /abc\nconst n = 1;`)).not.toThrow();
  });

  it("survives an unterminated block comment", () => {
    expect(findHardcodedStrings(`/* "Hello there"`)).toEqual([]);
  });

  it("survives an unterminated template literal", () => {
    expect(findHardcodedStrings("say(`Ready to fly")).toEqual(["Ready to fly"]);
  });

  it("counts lines correctly deep in a file", () => {
    const source = `${"\n".repeat(30)}say("Ready to fly");`;
    expect(scanSource(source)[0]?.line).toBe(31);
  });
});

describe(`AC-14.3: the ${HARDCODED_IGNORE_MARKER} escape hatch`, () => {
  it("exempts a line via a trailing line comment", () => {
    expect(
      findHardcodedStrings(`const font = "Atkinson Hyperlegible"; // i18n-ignore`),
    ).toEqual([]);
  });

  it("exempts a line via a leading block comment", () => {
    expect(findHardcodedStrings(`/* i18n-ignore */ say("Ready to fly");`)).toEqual(
      [],
    );
  });

  it("exempts only the marked line", () => {
    const source = [
      `say("Ready to fly"); // i18n-ignore`,
      `say("Also ready");`,
    ].join("\n");
    expect(findHardcodedStrings(source)).toEqual(["Also ready"]);
  });

  it("exempts every line a multi-line block comment spans", () => {
    const source = `/* i18n-ignore\n*/ say("Ready to fly");`;
    expect(findHardcodedStrings(source)).toEqual([]);
  });
});
