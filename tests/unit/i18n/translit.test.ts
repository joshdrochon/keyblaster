import { describe, expect, it } from "vitest";
import {
  TRANSLIT_TABLE,
  hasDevanagari,
  isTransliterationPrefix,
  matchesTransliteration,
  matchesTypedWord,
  normalizeTyped,
  romanizationsOf,
  segmentDevanagari,
} from "@engine/i18n/index.js";

/** Deterministic PRNG for sampled checks (lane brief: fixed seeds, no Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * AC-14.2 table. Kid vocabulary, each row listing romanizations a child
 * plausibly types and romanizations that must NOT match.
 * `feature` records what the row is there to prove.
 */
interface Row {
  readonly feature: string;
  readonly target: string;
  readonly accept: readonly string[];
  readonly reject: readonly string[];
}

const ROWS: readonly Row[] = [
  {
    feature: "D46 worked example: final schwa deletion",
    target: "घर",
    accept: ["ghar", "ghara", "GHAR", " ghar "],
    reject: ["ghr", "gar", "ghor", "har"],
  },
  {
    feature: "long-a matra, both spellings",
    target: "पानी",
    accept: ["paani", "pani", "paanee", "panee", "paanii"],
    reject: ["pnee", "water", "paan"],
  },
  {
    feature: "matra chain across three aksharas",
    target: "किताब",
    accept: ["kitaab", "kitab", "kitaaba"],
    reject: ["kitap", "kitb", "ktab"],
  },
  {
    feature: "nukta: ड़ accepts both the r- and d- romanizations",
    target: "लड़का",
    accept: ["ladka", "larka", "ladkaa", "larkaa"],
    reject: ["laka", "ladki"],
  },
  {
    feature: "nukta: ज़ accepts z and j",
    target: "ज़मीन",
    accept: ["zameen", "jameen", "zamin", "jamin"],
    reject: ["samin", "zmn"],
  },
  {
    feature: "nukta: फ़ accepts f and ph",
    target: "फ़ोन",
    accept: ["fon", "phon", "fona"],
    reject: ["von", "fn"],
  },
  {
    feature: "anusvara before a consonant",
    target: "हिंदी",
    accept: ["hindi", "hindee", "himdi", "hindii"],
    reject: ["hidi", "hind"],
  },
  {
    feature: "chandrabindu is optional, because typists drop it",
    target: "चाँद",
    // "chad" is accepted on purpose: ा -> "a" and the bindu drops.
    accept: ["chaand", "chand", "chaanda", "caand", "chad"],
    reject: ["chaan", "chd", "chandr"],
  },
  {
    feature: "chandrabindu on an independent vowel",
    target: "आँख",
    accept: ["aankh", "ankh", "aakh", "akh", "aankha"],
    reject: ["ank", "kh", "aank"],
  },
  {
    feature: "conjunct with virama suppresses the inherent a",
    target: "स्कूल",
    accept: ["skool", "skul", "skoola", "skuul"],
    reject: ["school", "sakool", "skl"],
  },
  {
    feature: "cluster override ज्ञ is pronounced gy, not jn",
    target: "ज्ञान",
    accept: ["gyan", "gyaan", "gnan", "jnaan"],
    reject: ["gyn", "yaan"],
  },
  {
    feature: "cluster override क्ष accepts ksh and x",
    target: "क्षमा",
    accept: ["kshama", "ksama", "xama", "kshamaa"],
    reject: ["kshma", "kama"],
  },
  {
    feature: "cluster override च्छ down to the single-ch spelling",
    target: "अच्छा",
    accept: ["achchha", "achcha", "achha", "acha", "acchaa"],
    reject: ["aha", "achch"],
  },
  {
    feature: "geminate च्च",
    target: "बच्चा",
    accept: ["bachcha", "bacha", "baccha", "bachchaa"],
    reject: ["baha", "bcha"],
  },
  {
    feature: "aspirated labial फ accepts ph and f",
    target: "फूल",
    accept: ["phool", "fool", "phul", "ful", "phoola"],
    reject: ["pool", "phl"],
  },
  {
    feature: "medial schwa retained or deleted",
    target: "कमल",
    accept: ["kamal", "kamala", "kaml"],
    reject: ["kmal", "kamar"],
  },
  {
    feature: "long-u matra",
    target: "दूध",
    accept: ["doodh", "dudh", "duudh", "doodha"],
    reject: ["dood", "ddh"],
  },
  {
    feature: "independent vowel आ",
    target: "आम",
    accept: ["aam", "am", "aama"],
    reject: ["m", "aan"],
  },
  {
    feature: "e-matra accepts e and ay",
    target: "पेड़",
    accept: ["ped", "per", "payd", "peda"],
    reject: ["pd", "peer"],
  },
  {
    feature: "sibilant श collapses onto sh and s",
    target: "शेर",
    accept: ["sher", "ser", "shayr", "shera"],
    reject: ["shr", "cher"],
  },
  {
    feature: "v/w are the same letter to a typist",
    target: "वन",
    accept: ["van", "wan", "vana", "wana"],
    reject: ["vn", "ban"],
  },
  {
    feature: "retroflex/dental collapse: ट and त both accept t",
    target: "टमाटर",
    accept: ["tamatar", "tamaatar", "tamaatara"],
    reject: ["tmatar", "damatar"],
  },
  {
    feature: "ri for the vocalic ऋ matra",
    target: "कृपा",
    accept: ["kripa", "krupa", "kripaa"],
    reject: ["krpa", "kipa"],
  },
  {
    feature: "o-matra",
    target: "मोर",
    accept: ["mor", "mora"],
    reject: ["mr", "maur"],
  },
  {
    feature: "ai-matra",
    target: "पैसा",
    accept: ["paisa", "peisa", "paisaa"],
    reject: ["pasa", "pesa"],
  },
  {
    feature: "au-matra on an independent vowel",
    target: "और",
    accept: ["aur", "our", "aura"],
    reject: ["ar", "or"],
  },
  {
    feature: "visarga is optional",
    target: "दुःख",
    accept: ["duhkh", "dukh", "duhkha"],
    reject: ["dkh", "dukhi"],
  },
  {
    feature: "two-word target keeps its space",
    target: "मेरा घर",
    accept: ["mera ghar", "meraa ghar", "mera ghara"],
    reject: ["meraghar", "mera gar"],
  },
];

describe("AC-14.2: romanized transliteration matches Devanagari targets", () => {
  for (const row of ROWS) {
    for (const typed of row.accept) {
      it(`AC-14.2: "${typed}" matches ${row.target} (${row.feature})`, () => {
        expect(matchesTransliteration(typed, row.target)).toBe(true);
      });
    }
    for (const typed of row.reject) {
      it(`AC-14.2: "${typed}" does not match ${row.target} (${row.feature})`, () => {
        expect(matchesTransliteration(typed, row.target)).toBe(false);
      });
    }
  }

  it("AC-14.2: every table row covers a distinct mapping feature", () => {
    const features = ROWS.map((r) => r.feature);
    expect(new Set(features).size).toBe(features.length);
  });
});

describe("AC-14.2: ambiguous romanizations accept all listed variants", () => {
  // The dental/retroflex and sibilant collapses are the ambiguity the AC names:
  // one romanization, several legal Devanagari targets.
  it("AC-14.2: 'tamatar' matches a retroflex-initial target", () => {
    expect(matchesTransliteration("tamatar", "टमाटर")).toBe(true);
  });

  it("AC-14.2: 'sat' matches both श-initial and स-initial targets", () => {
    expect(matchesTransliteration("sat", "सत")).toBe(true);
    expect(matchesTransliteration("sat", "शत")).toBe(true);
  });

  it("AC-14.2: each ambiguous letter keeps every listed variant", () => {
    expect([...(TRANSLIT_TABLE.consonants["फ"] ?? [])]).toEqual(["ph", "f"]);
    expect([...(TRANSLIT_TABLE.consonants["व"] ?? [])]).toEqual(["v", "w"]);
    expect([...(TRANSLIT_TABLE.matras["ी"] ?? [])]).toEqual([
      "ee",
      "i",
      "ii",
    ]);
  });
});

describe("AC-14.2: the mapping table itself", () => {
  it("AC-14.2: covers all 33 core consonants plus ळ", () => {
    const core = "कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहळ";
    for (const ch of core) {
      expect(TRANSLIT_TABLE.consonants[ch], ch).toBeDefined();
    }
  });

  it("AC-14.2: covers the seven nukta letters in decomposed form", () => {
    const nukta = TRANSLIT_TABLE.nukta;
    for (const base of "कखगजडढफ") {
      expect(TRANSLIT_TABLE.consonants[base + nukta], base).toBeDefined();
    }
  });

  it("AC-14.2: covers every independent vowel and its matra", () => {
    expect(Object.keys(TRANSLIT_TABLE.vowels).length).toBe(11);
    expect(Object.keys(TRANSLIT_TABLE.matras).length).toBe(10);
  });

  it("AC-14.2: covers anusvara, chandrabindu and visarga", () => {
    expect(TRANSLIT_TABLE.signs["ं"]).toBeDefined();
    expect(TRANSLIT_TABLE.signs["ँ"]).toBeDefined();
    expect(TRANSLIT_TABLE.signs["ः"]).toBeDefined();
  });

  it("AC-14.2: every variant is non-empty except the optional signs", () => {
    for (const [ch, variants] of Object.entries(TRANSLIT_TABLE.consonants)) {
      for (const v of variants) expect(v.length, ch).toBeGreaterThan(0);
    }
    for (const [ch, variants] of Object.entries(TRANSLIT_TABLE.vowels)) {
      for (const v of variants) expect(v.length, ch).toBeGreaterThan(0);
    }
  });

  it("AC-14.2: variant lists have no duplicates", () => {
    const groups = [
      TRANSLIT_TABLE.consonants,
      TRANSLIT_TABLE.vowels,
      TRANSLIT_TABLE.matras,
      TRANSLIT_TABLE.signs,
      TRANSLIT_TABLE.clusters,
    ];
    for (const group of groups) {
      for (const [ch, variants] of Object.entries(group)) {
        expect(new Set(variants).size, ch).toBe(variants.length);
      }
    }
  });

  it("word-initial schwa is not deletable, medial is", () => {
    expect([...TRANSLIT_TABLE.inherentAInitial]).toEqual(["a"]);
    expect([...TRANSLIT_TABLE.inherentA]).toEqual(["a", ""]);
  });
});

describe("segmentDevanagari", () => {
  it("splits घर into two aksharas", () => {
    const segments = segmentDevanagari("घर");
    expect(segments.map((s) => s.source)).toEqual(["घ", "र"]);
  });

  it("keeps a conjunct in one akshara", () => {
    // स + virama + क + ू is a single akshara: the virama kills the inherent a,
    // so the cluster and its matra are one unit, not three.
    const segments = segmentDevanagari("स्कूल");
    expect(segments.length).toBe(2);
    expect(segments[0]?.source).toBe("स्कू");
    expect(segments[0]?.variants).toContain("skoo");
    expect(segments[0]?.variants).toContain("sku");
  });

  it("a bare conjunct with no matra takes the inherent a", () => {
    const segments = segmentDevanagari("प्र");
    expect(segments.length).toBe(1);
    expect(segments[0]?.variants).toContain("pra");
  });

  it("pulls a nukta into its consonant", () => {
    const segments = segmentDevanagari("लड़का");
    expect(segments.length).toBe(3);
    expect(segments[1]?.variants).toContain("r");
    expect(segments[1]?.variants).toContain("d");
  });

  it("attaches a sign to the akshara it modifies", () => {
    const segments = segmentDevanagari("हिंदी");
    expect(segments.length).toBe(2);
    expect(segments[0]?.variants).toContain("hin");
  });

  it("word-initial schwa is not deletable", () => {
    const segments = segmentDevanagari("घर");
    expect(segments[0]?.variants).toContain("gha");
    expect(segments[0]?.variants).not.toContain("gh");
    expect(segments[1]?.variants).toContain("r");
  });

  it("a trailing virama leaves a half form with no vowel", () => {
    const segments = segmentDevanagari("क्");
    expect(segments.length).toBe(1);
    expect([...(segments[0]?.variants ?? [])]).toEqual(["k"]);
  });

  it("ignores a nukta on a letter that has no nukta form", () => {
    // प has no precomposed nukta form, so NFC leaves the two code points as
    // they are. Malformed content must not break segmentation.
    const segments = segmentDevanagari(`प${TRANSLIT_TABLE.nukta}र`);
    expect(segments.length).toBe(2);
    expect(segments[0]?.variants).toContain("pa");
  });

  it("segments the NFC-composed nukta letters न/र + nukta fold into", () => {
    // ऩ is not a composition exclusion, unlike क़, so NFC produces it.
    expect(`न${TRANSLIT_TABLE.nukta}`.normalize("NFC")).toBe("ऩ");
    expect(segmentDevanagari("ऩ")[0]?.variants).toContain("na");
  });

  it("does not treat a nukta after a vowel as a consonant", () => {
    const segments = segmentDevanagari(`अ${TRANSLIT_TABLE.nukta}`);
    expect(segments.length).toBe(2);
    expect(segments[0]?.variants).toContain("a");
  });

  it("a virama before a non-consonant still kills the inherent a", () => {
    const segments = segmentDevanagari(`क${TRANSLIT_TABLE.virama}आ`);
    expect(segments.length).toBe(2);
    expect([...(segments[0]?.variants ?? [])]).toEqual(["k"]);
  });

  it("passes non-Devanagari through unchanged", () => {
    const segments = segmentDevanagari("A1");
    expect(segments.map((s) => s.variants[0])).toEqual(["a", "1"]);
  });

  it("danda accepts a full stop or nothing", () => {
    const segments = segmentDevanagari("घर।");
    expect(segments[2]?.variants).toEqual(["।", ".", ""]);
  });
});

describe("matchesTransliteration edge cases", () => {
  it("accepts the Devanagari target typed directly (InScript, D46)", () => {
    expect(matchesTransliteration("घर", "घर")).toBe(true);
  });

  it("is NFC-stable across precomposed and decomposed nukta", () => {
    // U+0958 is a composition exclusion: both spellings are the same letter.
    expect(matchesTransliteration("क़र", "क़र")).toBe(
      true,
    );
    expect(matchesTransliteration("qar", "क़र")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchesTransliteration("  GhAr\n", "घर")).toBe(true);
  });

  it("falls back to equality for non-Devanagari targets", () => {
    expect(matchesTransliteration("Water", "water")).toBe(true);
    expect(matchesTransliteration("wter", "water")).toBe(false);
  });

  it("rejects an empty buffer against a real target", () => {
    expect(matchesTransliteration("", "घर")).toBe(false);
  });

  it("treats two empty strings as equal", () => {
    expect(matchesTransliteration("", "")).toBe(true);
  });
});

describe("isTransliterationPrefix (per-keystroke narrowing)", () => {
  it("an empty buffer is a prefix of anything", () => {
    expect(isTransliterationPrefix("", "घर")).toBe(true);
  });

  it("accepts every prefix of an accepted romanization", () => {
    for (const typed of ["g", "gh", "gha", "ghar"]) {
      expect(isTransliterationPrefix(typed, "घर"), typed).toBe(true);
    }
  });

  it("rejects a buffer that cannot grow into the target", () => {
    expect(isTransliterationPrefix("x", "घर")).toBe(false);
    expect(isTransliterationPrefix("ghax", "घर")).toBe(false);
    expect(isTransliterationPrefix("gharr", "घर")).toBe(false);
  });

  it("accepts a partial Devanagari commit (InScript)", () => {
    expect(isTransliterationPrefix("घ", "घर")).toBe(true);
  });

  it("falls back to string prefix for non-Devanagari targets", () => {
    expect(isTransliterationPrefix("wat", "water")).toBe(true);
    expect(isTransliterationPrefix("wet", "water")).toBe(false);
  });

  it("a full match is also a prefix", () => {
    expect(isTransliterationPrefix("ghar", "घर")).toBe(true);
  });
});

describe("romanizationsOf", () => {
  it("lists the canonical spelling of the D46 example", () => {
    expect(romanizationsOf("घर")).toContain("ghar");
  });

  it("returns the word itself for non-Devanagari", () => {
    expect(romanizationsOf("water")).toEqual(["water"]);
  });

  it("respects the cap", () => {
    expect(romanizationsOf("अच्छा", 3).length).toBeLessThanOrEqual(3);
  });

  it("AC-14.2: every romanization it produces is one the matcher accepts", () => {
    // Seeded sample so the assertion is deterministic and cheap.
    const rand = mulberry32(0x5eed);
    for (const row of ROWS) {
      const all = romanizationsOf(row.target, 64);
      expect(all.length).toBeGreaterThan(0);
      const sample = all.filter(() => rand() < 0.5).slice(0, 8);
      for (const candidate of sample.length > 0 ? sample : all.slice(0, 1)) {
        expect(
          matchesTransliteration(candidate, row.target),
          `${candidate} -> ${row.target}`,
        ).toBe(true);
      }
    }
  });
});

describe("matchesTypedWord (D46 input-method routing)", () => {
  it("translit runs the table", () => {
    expect(matchesTypedWord("ghar", "घर", "translit")).toBe(true);
  });

  it("inscript compares the committed string only", () => {
    expect(matchesTypedWord("घर", "घर", "inscript")).toBe(true);
    expect(matchesTypedWord("ghar", "घर", "inscript")).toBe(false);
  });

  it("latin compares the committed string only", () => {
    expect(matchesTypedWord("Water", "water", "latin")).toBe(true);
    expect(matchesTypedWord("ghar", "घर", "latin")).toBe(false);
  });
});

describe("helpers", () => {
  it("hasDevanagari detects the script", () => {
    expect(hasDevanagari("घर")).toBe(true);
    expect(hasDevanagari("ghar")).toBe(false);
  });

  it("normalizeTyped trims, lowercases and applies NFC", () => {
    expect(normalizeTyped("  GHAR ")).toBe("ghar");
    expect(normalizeTyped("क़")).toBe("क़");
  });
});
