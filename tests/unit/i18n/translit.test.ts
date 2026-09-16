import { describe, expect, it } from "vitest";
import {
  EXACT_MATCHER,
  TRANSLIT_MATCHER,
  TRANSLIT_TABLE,
  canonicalRomanization,
  createWordMatcher,
  findAmbiguousPairs,
  hasDevanagari,
  isTransliterationPrefix,
  matchesTransliteration,
  matchesTypedWord,
  normalizeTyped,
  romanizationsOf,
  segmentDevanagari,
} from "@engine/i18n/index.js";

/**
 * AC-14.2 table. Kid vocabulary, each row listing romanizations a child
 * plausibly types and romanizations that must NOT match. Every string here is
 * hand-written; nothing is generated from the table it is testing, so the
 * REJECT column is real evidence rather than a restatement.
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
    feature: "nukta: ड़ accepts the d-, r- and dh- romanizations",
    target: "लड़का",
    accept: ["ladka", "larka", "ladkaa", "larkaa", "ladhka"],
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
    feature: "medial anusvara writes a nasal consonant and must be typed",
    target: "हिंदी",
    accept: ["hindi", "hindee", "himdi", "hindii"],
    reject: ["hidi", "hind", "hiddi"],
  },
  {
    feature: "medial anusvara, second case",
    target: "अंदर",
    accept: ["andar", "amdar", "andara", "andr"],
    reject: ["adar", "amdr ka"],
  },
  {
    feature: "word-final anusvara writes a nasal vowel and may be dropped",
    target: "नहीं",
    accept: ["nahin", "nahi", "nahim", "naheen", "nahee"],
    reject: ["nhi", "nahid"],
  },
  {
    feature: "word-final anusvara on a matra-bearing single akshara",
    target: "मैं",
    accept: ["main", "mai", "may", "mayn", "mein", "mei"],
    reject: ["mn", "man"],
  },
  {
    feature: "word-final anusvara, plural copula",
    target: "हैं",
    accept: ["hain", "hai", "hay", "hayn", "hein"],
    reject: ["hn", "ho"],
  },
  {
    feature: "chandrabindu is optional everywhere",
    target: "चाँद",
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
    feature: "chandrabindu on a long-u matra",
    target: "हूँ",
    accept: ["hoon", "hun", "hoo", "hu", "huun"],
    reject: ["hn", "ha"],
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
    feature: "geminate reduction: च्च",
    target: "बच्चा",
    accept: ["bachcha", "bacha", "baccha", "bachchaa"],
    reject: ["baha", "bcha"],
  },
  {
    feature: "geminate reduction: त्त",
    target: "कुत्ता",
    accept: ["kutta", "kuta", "kuttaa", "kutaa"],
    reject: ["kuda", "ktta"],
  },
  {
    feature: "geminate reduction: ल्ल",
    target: "बिल्ली",
    accept: ["billi", "bili", "billee", "bilee"],
    reject: ["bli", "bilii ki"],
  },
  {
    feature: "geminate reduction: क्क",
    target: "चक्कर",
    accept: ["chakkar", "chakar", "cakkar", "chakkara"],
    reject: ["chkar", "chakka"],
  },
  {
    feature: "geminate reduction: म्म",
    target: "अम्मा",
    accept: ["amma", "ama", "ammaa"],
    reject: ["ma", "amm"],
  },
  {
    feature: "geminate reduction: त्त after an initial akshara",
    target: "पत्ता",
    accept: ["patta", "pata", "pattaa"],
    reject: ["ptta", "pata ki"],
  },
  {
    feature: "e-matra accepts e, ay and the Hinglish ey",
    target: "नमस्ते",
    accept: ["namaste", "namastey", "namastay", "namste"],
    reject: ["namast", "namasti"],
  },
  {
    feature: "e-matra ey in an imperative",
    target: "खेलो",
    accept: ["khelo", "kheylo", "khaylo", "khelu"],
    reject: ["khlo", "kelo"],
  },
  {
    feature: "e-matra ey in a possessive",
    target: "मेरा",
    accept: ["mera", "meyra", "mayra", "meraa"],
    reject: ["mra", "mira"],
  },
  {
    feature: "independent ए accepts ai, because एक is written aik",
    target: "एक",
    accept: ["ek", "eyk", "ayk", "aik", "eka"],
    reject: ["k", "ik"],
  },
  {
    feature: "ai-matra accepts ay, mirroring e-matra",
    target: "तैयार",
    accept: ["taiyar", "tayyar", "teiyaar", "taiyaar"],
    reject: ["tyar", "tayar"],
  },
  {
    feature: "o-matra accepts u, because क्यों is written kyun",
    target: "क्यों",
    accept: ["kyon", "kyun", "kyo", "kyu", "kyum"],
    reject: ["kon", "kyn"],
  },
  {
    feature: "aspirated झ may lose its aspiration word-finally",
    target: "समझ",
    accept: ["samajh", "samaj", "samajha", "samjh", "samj"],
    reject: ["smaj", "samach"],
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
    feature: "e-matra plus nukta",
    target: "पेड़",
    accept: ["ped", "per", "pedh", "payd", "peyd", "peda"],
    reject: ["pd", "peer"],
  },
  {
    feature: "sibilant श collapses onto sh and s",
    target: "शेर",
    accept: ["sher", "ser", "shayr", "sheyr", "shera"],
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
    accept: ["mor", "mora", "mur"],
    reject: ["mr", "maur"],
  },
  {
    feature: "ai-matra",
    target: "पैसा",
    accept: ["paisa", "peisa", "paysa", "paisaa"],
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
    feature: "reph: र + virama before a consonant",
    target: "कर्म",
    accept: ["karm", "karma"],
    // A conjunct is one akshara, so no schwa may be inserted inside it.
    reject: ["krm", "kama", "karama"],
  },
  {
    feature: "conjunct with ra-phala",
    target: "मित्र",
    accept: ["mitra", "mitr"],
    reject: ["mtr", "mira", "mitara"],
  },
  {
    feature: "reph plus a matra",
    target: "गर्मी",
    accept: ["garmi", "garmee", "garmii"],
    reject: ["grmi", "gami", "garamee"],
  },
  {
    feature: "ya-phala conjunct",
    target: "सूर्य",
    accept: ["soorya", "surya", "suurya"],
    reject: ["srya", "sora", "sooraya"],
  },
  {
    feature: "two-word target keeps its space",
    target: "मेरा घर",
    accept: ["mera ghar", "meraa ghar", "mera ghara"],
    reject: ["meraghar", "mera gar"],
  },
  {
    feature: "initial-schwa protection applies per word, not per string",
    target: "मेरा घर",
    accept: ["meyra ghar"],
    // The leak this row exists for: "ghr" is rejected alone, so it must be
    // rejected as the second word too.
    reject: ["mera ghr", "mra ghar"],
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

describe("AC-14.2: the anusvara/chandrabindu asymmetry is positional", () => {
  it("AC-14.2: a word-final anusvara may be dropped", () => {
    expect(matchesTransliteration("nahi", "नहीं")).toBe(true);
    expect(matchesTransliteration("mai", "मैं")).toBe(true);
    expect(matchesTransliteration("hai", "हैं")).toBe(true);
  });

  it("AC-14.2: a medial anusvara may NOT be dropped", () => {
    expect(matchesTransliteration("hidi", "हिंदी")).toBe(false);
    expect(matchesTransliteration("adar", "अंदर")).toBe(false);
    expect(matchesTransliteration("gaga", "गंगा")).toBe(false);
  });

  it("AC-14.2: a chandrabindu may be dropped in either position", () => {
    expect(matchesTransliteration("chand", "चाँद")).toBe(true);
    expect(matchesTransliteration("hu", "हूँ")).toBe(true);
  });
});

describe("AC-14.2: ambiguous romanizations accept all listed variants", () => {
  it("AC-14.2: 'tamatar' matches a retroflex-initial target", () => {
    expect(matchesTransliteration("tamatar", "टमाटर")).toBe(true);
  });

  it("AC-14.2: 'sat' matches both श-initial and स-initial targets", () => {
    expect(matchesTransliteration("sat", "सत")).toBe(true);
    expect(matchesTransliteration("sat", "शत")).toBe(true);
  });

  it("AC-14.2: 'ek' and 'aik' both reach ए", () => {
    expect(matchesTransliteration("ek", "एक")).toBe(true);
    expect(matchesTransliteration("aik", "एक")).toBe(true);
  });

  it("AC-14.2: each ambiguous letter keeps every listed variant", () => {
    expect([...(TRANSLIT_TABLE.consonants["फ"] ?? [])]).toEqual(["ph", "f"]);
    expect([...(TRANSLIT_TABLE.consonants["व"] ?? [])]).toEqual(["v", "w"]);
    expect([...(TRANSLIT_TABLE.matras["ी"] ?? [])]).toEqual([
      "i",
      "ee",
      "ii",
    ]);
    expect([...(TRANSLIT_TABLE.matras["े"] ?? [])]).toEqual([
      "e",
      "ay",
      "ey",
    ]);
    expect([...(TRANSLIT_TABLE.matras["ै"] ?? [])]).toEqual([
      "ai",
      "ei",
      "ay",
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

  it("AC-14.2: covers the three precomposed nukta letters NFC produces", () => {
    for (const ch of "ऩऱऴ") {
      expect(TRANSLIT_TABLE.consonants[ch], ch).toBeDefined();
    }
  });

  it("AC-14.2: covers every independent vowel and its matra", () => {
    expect(Object.keys(TRANSLIT_TABLE.vowels).length).toBe(11);
    expect(Object.keys(TRANSLIT_TABLE.matras).length).toBe(10);
  });

  it("AC-14.2: covers anusvara, chandrabindu and visarga", () => {
    expect(TRANSLIT_TABLE.signs[TRANSLIT_TABLE.anusvara]).toBeDefined();
    expect(TRANSLIT_TABLE.signs["ँ"]).toBeDefined();
    expect(TRANSLIT_TABLE.signs["ः"]).toBeDefined();
  });

  it("AC-14.2: anusvara carries no empty variant; position adds it", () => {
    // The drop is positional, so it must NOT be baked into the table.
    expect(TRANSLIT_TABLE.signs[TRANSLIT_TABLE.anusvara]).not.toContain("");
    expect(TRANSLIT_TABLE.signs["ँ"]).toContain("");
  });

  it("AC-14.2: every consonant and vowel variant is non-empty", () => {
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

  it("a geminate akshara also accepts its single consonant", () => {
    const segments = segmentDevanagari("कुत्ता");
    expect(segments[1]?.variants).toContain("tta");
    expect(segments[1]?.variants).toContain("ta");
  });

  it("word-initial schwa is not deletable", () => {
    const segments = segmentDevanagari("घर");
    expect(segments[0]?.variants).toContain("gha");
    expect(segments[0]?.variants).not.toContain("gh");
    expect(segments[1]?.variants).toContain("r");
  });

  it("word-initial schwa protection restarts after a space", () => {
    const segments = segmentDevanagari("मेरा घर");
    const ghaSegment = segments[3];
    expect(ghaSegment?.source).toBe("घ");
    expect(ghaSegment?.variants).toContain("gha");
    expect(ghaSegment?.variants).not.toContain("gh");
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

  it("segments the NFC-composed nukta letters न + nukta folds into", () => {
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

  it("does not accept a spelling that reorders a nasal (documented limit)", () => {
    // गाँव -> "gaon" needs metathesis, which this matcher does not do.
    expect(matchesTransliteration("gaanv", "गाँव")).toBe(true);
    expect(matchesTransliteration("gaon", "गाँव")).toBe(false);
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

  it("every prefix of every accepted spelling is a prefix (the lock's rule)", () => {
    // If this failed, narrowing could evict a legal spelling mid-word.
    for (const row of ROWS) {
      for (const accepted of row.accept) {
        const typed = normalizeTyped(accepted);
        for (let n = 0; n <= typed.length; n += 1) {
          expect(
            isTransliterationPrefix(typed.slice(0, n), row.target),
            `${typed.slice(0, n)} -> ${row.target}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("AC-14.2: canonicalRomanization (D46's own example)", () => {
  /** Hand-written expectations. Nothing here is derived from the table. */
  const EXPECTED: readonly [string, string][] = [
    ["घर", "ghar"],
    ["कमल", "kamal"],
    ["लड़का", "ladka"],
    ["पानी", "pani"],
    ["किताब", "kitab"],
    ["हिंदी", "hindi"],
    ["मित्र", "mitra"],
    ["कर्म", "karma"],
    ["टमाटर", "tamatar"],
    ["एक", "ek"],
    ["नमस्ते", "namaste"],
    ["क्यों", "kyon"],
    ["नहीं", "nahin"],
    ["मैं", "main"],
    ["क्षमा", "kshama"],
    ["ज्ञान", "gyan"],
    ["स्कूल", "skool"],
    ["सूरज", "sooraj"],
    ["समझ", "samajh"],
    ["मेरा घर", "mera ghar"],
  ];

  for (const [target, expected] of EXPECTED) {
    it(`AC-14.2: ${target} -> "${expected}"`, () => {
      expect(canonicalRomanization(target)).toBe(expected);
    });
  }

  it("AC-14.2: D46 requires ghar, and the naive first-variant pick gives ghara", () => {
    expect(canonicalRomanization("घर")).toBe("ghar");
    expect(romanizationsOf("घर")[0]).toBe("ghara");
  });

  it("the canonical form is always one the matcher accepts", () => {
    for (const row of ROWS) {
      const canonical = canonicalRomanization(row.target);
      expect(
        matchesTransliteration(canonical, row.target),
        `${canonical} -> ${row.target}`,
      ).toBe(true);
    }
  });

  it("returns non-Devanagari input unchanged", () => {
    expect(canonicalRomanization("water")).toBe("water");
  });

  it("is documented as approximate: धड़कन is not yet dhadkan", () => {
    // Full Hindi schwa deletion is an open problem; matching accepts both.
    expect(canonicalRomanization("धड़कन")).toBe("dhadakan");
    expect(matchesTransliteration("dhadkan", "धड़कन")).toBe(true);
  });
});

describe("romanizationsOf", () => {
  it("contains hand-written spellings a child would type", () => {
    const ghar = romanizationsOf("घर");
    expect(ghar).toContain("ghar");
    expect(ghar).toContain("ghara");
    expect(ghar).not.toContain("ghr");
  });

  it("returns the word itself for non-Devanagari", () => {
    expect(romanizationsOf("water")).toEqual(["water"]);
  });

  it("respects the cap", () => {
    expect(romanizationsOf("अच्छा", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("AC-14.2: WordMatcher, the port lock/ injects (D31, D46)", () => {
  it("translit mode routes through the variant table", () => {
    const matcher = createWordMatcher("translit");
    expect(matcher.isComplete("ghar", "घर")).toBe(true);
    expect(matcher.isComplete("ghara", "घर")).toBe(true);
    expect(matcher.isPrefix("gha", "घर")).toBe(true);
    expect(matcher.isPrefix("q", "घर")).toBe(false);
  });

  it("inscript mode compares the committed string only", () => {
    const matcher = createWordMatcher("inscript");
    expect(matcher.isComplete("घर", "घर")).toBe(true);
    expect(matcher.isComplete("ghar", "घर")).toBe(false);
    expect(matcher.isPrefix("घ", "घर")).toBe(true);
  });

  it("latin mode compares the committed string only", () => {
    const matcher = createWordMatcher("latin");
    expect(matcher.isComplete("Water", "water")).toBe(true);
    expect(matcher.isPrefix("wat", "water")).toBe(true);
    expect(matcher.isPrefix("wet", "water")).toBe(false);
  });

  it("latin and inscript share one exact matcher", () => {
    expect(createWordMatcher("latin")).toBe(EXACT_MATCHER);
    expect(createWordMatcher("inscript")).toBe(EXACT_MATCHER);
    expect(createWordMatcher("translit")).toBe(TRANSLIT_MATCHER);
  });

  it("D31: a translit lock accepts more than one spelling of the same word", () => {
    // This is the regression the port exists to prevent: a lock that compares
    // against canonicalRomanization alone would reject "ghara" and "ladka".
    const matcher = createWordMatcher("translit");
    const accepted = ["ghar", "ghara"].filter((s) =>
      matcher.isComplete(s, "घर"),
    );
    expect(accepted).toHaveLength(2);
  });

  it("matchesTypedWord agrees with the matcher it wraps", () => {
    for (const method of ["latin", "translit", "inscript"] as const) {
      expect(matchesTypedWord("ghar", "घर", method)).toBe(
        createWordMatcher(method).isComplete("ghar", "घर"),
      );
    }
  });
});

describe("AC-14.2: findAmbiguousPairs guards a stage pool", () => {
  /** Minimal pairs the collapses in this table genuinely merge. */
  const COLLIDING: readonly [string, string][] = [
    ["कल", "काल"],
    ["बल", "बाल"],
    ["दिन", "दीन"],
    ["मल", "माल"],
    ["तन", "तान"],
    ["सत", "शत"],
    ["बच्चा", "बचा"],
  ];

  for (const [a, b] of COLLIDING) {
    it(`AC-14.2: reports ${a} / ${b} as indistinguishable`, () => {
      const pairs = findAmbiguousPairs([a, b]);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.shared.length).toBeGreaterThan(0);
    });
  }

  it("AC-14.2: names the shared spellings", () => {
    const pairs = findAmbiguousPairs(["कल", "काल"]);
    expect(pairs[0]?.shared).toContain("kal");
  });

  it("AC-14.2: a pool of genuinely distinct words is clean", () => {
    expect(findAmbiguousPairs(["घर", "पानी", "किताब", "फूल", "दूध"])).toEqual(
      [],
    );
  });

  it("AC-14.2: one word alone can never collide", () => {
    expect(findAmbiguousPairs(["घर"])).toEqual([]);
    expect(findAmbiguousPairs([])).toEqual([]);
  });

  it("AC-14.2: reports each colliding pair once, deterministically ordered", () => {
    const pairs = findAmbiguousPairs(["काल", "कल", "बाल", "बल"]);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      ["कल", "काल"],
      ["बल", "बाल"],
    ]);
  });

  it("AC-14.2: three-way collisions become three pairs", () => {
    const pairs = findAmbiguousPairs(["सत", "शत", "सात"]);
    expect(pairs).toHaveLength(3);
  });

  it("AC-14.2: duplicate entries are not reported against themselves", () => {
    expect(findAmbiguousPairs(["घर", "घर"])).toEqual([]);
  });

  it("works on Latin words too, so one guard covers all three languages", () => {
    expect(findAmbiguousPairs(["cat", "dog"])).toEqual([]);
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
