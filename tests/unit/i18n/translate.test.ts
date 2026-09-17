import { describe, expect, it, vi } from "vitest";
import type { Lang } from "@engine/types.js";
import {
  EN,
  ES,
  HI,
  MissingParamError,
  MissingStringError,
  STRING_KEYS,
  TABLES,
  createTranslator,
  interpolate,
  placeholdersIn,
  type StringKey,
  type StringTable,
} from "@engine/i18n/index.js";

/** A table with a hole in it: the only way to exercise the missing-key policy. */
const PARTIAL: Readonly<Record<Lang, StringTable>> = {
  en: EN,
  es: { "title.play": "Jugar" },
  hi: {},
};

const MISSING = "title.settings" as StringKey;

describe("string tables (FR-14, D45)", () => {
  it("es and hi cover every en key", () => {
    for (const key of STRING_KEYS) {
      expect(ES[key], `es missing ${key}`).toBeTypeOf("string");
      expect(HI[key], `hi missing ${key}`).toBeTypeOf("string");
    }
  });

  it("no table has an empty string", () => {
    for (const lang of ["en", "es", "hi"] as const) {
      for (const key of STRING_KEYS) {
        expect((TABLES[lang][key] ?? "").length, `${lang}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("every language expects the same placeholders for a key", () => {
    for (const key of STRING_KEYS) {
      const expected = placeholdersIn(EN[key]).sort();
      expect(placeholdersIn(ES[key]).sort(), `es/${key}`).toEqual(expected);
      expect(placeholdersIn(HI[key]).sort(), `hi/${key}`).toEqual(expected);
    }
  });

  it("C07: no UI copy hard-codes the ship name", () => {
    for (const lang of ["en", "es", "hi"] as const) {
      for (const key of STRING_KEYS) {
        // The Profile screen's default value is the one legitimate place.
        if (key === "profile.shipNameDefault") continue;
        expect(TABLES[lang][key] ?? "", `${lang}/${key}`).not.toMatch(/Lantern/i);
      }
    }
  });

  it("C07: the ship is referred to as {shipName} where it is named at all", () => {
    expect(EN["briefing.shipReady"]).toContain("{shipName}");
    expect(ES["briefing.shipReady"]).toContain("{shipName}");
    expect(HI["briefing.shipReady"]).toContain("{shipName}");
  });
});

describe("interpolate (C07)", () => {
  it("substitutes {shipName}", () => {
    expect(interpolate("The {shipName} is ready.", { shipName: "Lantern" })).toBe(
      "The Lantern is ready.",
    );
  });

  it("substitutes numbers", () => {
    expect(interpolate("{wpm} wpm", { wpm: 42 })).toBe("42 wpm");
  });

  it("substitutes the same placeholder more than once", () => {
    expect(interpolate("{a} and {a}", { a: "x" })).toBe("x and x");
  });

  it("does not re-scan substituted values", () => {
    // A child may name their ship anything; it must not inject a placeholder.
    expect(
      interpolate("The {shipName} flies.", { shipName: "{wpm}", wpm: 99 }),
    ).toBe("The {wpm} flies.");
  });

  it("leaves unknown placeholders intact in prod", () => {
    expect(interpolate("The {shipName} flies.", {}, "prod")).toBe(
      "The {shipName} flies.",
    );
  });

  it("throws on an unknown placeholder in dev", () => {
    expect(() => interpolate("The {shipName} flies.", {}, "dev")).toThrow(
      MissingParamError,
    );
  });

  it("defaults to no params and prod behaviour", () => {
    expect(interpolate("plain")).toBe("plain");
    expect(interpolate("{x}")).toBe("{x}");
  });

  it("ignores unused params", () => {
    expect(interpolate("plain", { unused: 1 })).toBe("plain");
  });

  it("does not treat malformed braces as placeholders", () => {
    expect(interpolate("{ shipName }", { shipName: "L" })).toBe("{ shipName }");
    expect(interpolate("{1bad}", {})).toBe("{1bad}");
  });

  it("placeholdersIn lists names once, in order", () => {
    expect(placeholdersIn("{b} {a} {b}")).toEqual(["b", "a"]);
    expect(placeholdersIn("none")).toEqual([]);
  });
});

describe("createTranslator", () => {
  it("resolves in the selected language", () => {
    const t = createTranslator({ lang: "es", mode: "prod" });
    // D41 lowercase chrome: the button reads "jugar", not "Jugar". The
    // assertion is unchanged in kind - Spanish resolves to Spanish - only the
    // copy it names moved with the case convention.
    expect(t.t("title.play")).toBe("jugar");
    expect(t.lang).toBe("es");
    expect(t.mode).toBe("prod");
  });

  it("resolves Hindi and interpolates the ship name (C07)", () => {
    const t = createTranslator({ lang: "hi", mode: "dev" });
    expect(t.t("briefing.shipReady", { shipName: "दीप" })).toContain("दीप");
    expect(t.t("briefing.shipReady", { shipName: "दीप" })).not.toContain("{");
  });

  it("has() reports only own-language coverage", () => {
    const t = createTranslator({ lang: "es", mode: "prod", tables: PARTIAL });
    expect(t.has("title.play")).toBe(true);
    expect(t.has(MISSING)).toBe(false);
  });

  it("raw() returns the uninterpolated template, or null", () => {
    const t = createTranslator({ lang: "es", mode: "prod", tables: PARTIAL });
    expect(t.raw("briefing.shipReady")).toBe(EN["briefing.shipReady"]);
    expect(t.raw("nope.at.all" as StringKey)).toBeNull();
  });
});

describe("C07: {shipName} is bound once, not at every call site", () => {
  /** How the app builds a translator: the profile's ship name, bound once. */
  const forProfile = (shipName: string, lang: Lang = "en") =>
    createTranslator({ lang, mode: "dev", defaults: { shipName } });

  it("C07: every key that names the ship renders with no placeholder left", () => {
    // The critic's point: nothing asserted any caller supplies {shipName}.
    // Binding it on the translator is what makes that unmissable.
    for (const lang of ["en", "es", "hi"] as const) {
      const t = forProfile("Faro", lang);
      for (const key of STRING_KEYS) {
        // Supply every placeholder EXCEPT shipName; defaults must cover it.
        const params: Record<string, string> = {};
        for (const name of placeholdersIn(EN[key])) {
          if (name !== "shipName") params[name] = "x";
        }
        const rendered = t.t(key, params);
        expect(rendered, `${lang}/${key}`).not.toMatch(/\{[A-Za-z]/);
      }
    }
  });

  it("C07: the bound ship name reaches the copy", () => {
    expect(forProfile("Faro").t("briefing.shipReady")).toBe(
      "The Faro is fuelled and ready.",
    );
    expect(forProfile("Faro", "es").t("results.shipIntact")).toContain("Faro");
    expect(forProfile("दीप", "hi").t("briefing.shipReady")).toContain("दीप");
  });

  it("C07: a call-site param overrides the bound default", () => {
    expect(
      forProfile("Faro").t("briefing.shipReady", { shipName: "Lantern" }),
    ).toBe("The Lantern is fuelled and ready.");
  });

  it("C07: the default ship name is itself an i18n key, not a literal", () => {
    const t = createTranslator({ lang: "en", mode: "dev" });
    expect(t.t("profile.shipNameDefault")).toBe("Lantern");
  });

  it("dev still throws for a placeholder no default covers", () => {
    const t = createTranslator({
      lang: "en",
      mode: "dev",
      defaults: { shipName: "Faro" },
    });
    expect(() => t.t("map.stars")).toThrow(MissingParamError);
  });

  it("defaults apply to the English fallback path too", () => {
    const partial: Readonly<Record<Lang, StringTable>> = {
      en: EN,
      es: {},
      hi: {},
    };
    const t = createTranslator({
      lang: "es",
      mode: "prod",
      tables: partial,
      defaults: { shipName: "Faro" },
    });
    expect(t.t("briefing.shipReady")).toBe("The Faro is fuelled and ready.");
  });
});

describe("missing-key policy (FR-14)", () => {
  it("dev throws even when English has the key", () => {
    const t = createTranslator({ lang: "es", mode: "dev", tables: PARTIAL });
    expect(() => t.t(MISSING)).toThrow(MissingStringError);
  });

  it("dev throw names the key and the language", () => {
    const t = createTranslator({ lang: "hi", mode: "dev", tables: PARTIAL });
    try {
      t.t(MISSING);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingStringError);
      const e = error as MissingStringError;
      expect(e.key).toBe(MISSING);
      expect(e.lang).toBe("hi");
      expect(e.message).toContain("hi");
    }
  });

  it("prod falls back to English rather than throwing", () => {
    const t = createTranslator({ lang: "es", mode: "prod", tables: PARTIAL });
    expect(t.t(MISSING)).toBe(EN[MISSING]);
  });

  it("prod falls back to the key when English has no entry either", () => {
    const t = createTranslator({ lang: "es", mode: "prod", tables: PARTIAL });
    expect(t.t("nowhere.at.all" as StringKey)).toBe("nowhere.at.all");
  });

  it("an onMissing sink downgrades the dev throw to a report", () => {
    const onMissing = vi.fn();
    const t = createTranslator({
      lang: "hi",
      mode: "dev",
      tables: PARTIAL,
      onMissing,
    });
    expect(t.t(MISSING)).toBe(EN[MISSING]);
    expect(onMissing).toHaveBeenCalledWith(MISSING, "hi");
  });

  it("prod reports to onMissing as well", () => {
    const onMissing = vi.fn();
    const t = createTranslator({
      lang: "es",
      mode: "prod",
      tables: PARTIAL,
      onMissing,
    });
    t.t(MISSING);
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it("survives a table set with no entry for the language at all", () => {
    const empty = {} as Readonly<Record<Lang, StringTable>>;
    const t = createTranslator({ lang: "hi", mode: "prod", tables: empty });
    expect(t.t("title.play")).toBe("title.play");
    expect(t.raw("title.play")).toBeNull();
  });

  it("prod leaves an unsupplied placeholder readable, not 'undefined'", () => {
    const t = createTranslator({ lang: "en", mode: "prod" });
    expect(t.t("briefing.shipReady")).toContain("{shipName}");
    expect(t.t("briefing.shipReady")).not.toContain("undefined");
  });

  it("the English fallback is still interpolated", () => {
    const t = createTranslator({ lang: "es", mode: "prod", tables: PARTIAL });
    expect(t.t("briefing.shipReady", { shipName: "Lantern" })).toBe(
      "The Lantern is fuelled and ready.",
    );
  });
});
