import { describe, expect, it } from "vitest";
import {
  canonicalRomanization,
  findAmbiguousPairs,
  hasDevanagari,
  isTransliterationPrefix,
  matchesTransliteration,
  romanizationsOf,
  segmentDevanagari,
} from "@engine/i18n/index.js";
import { bundlesFor, sightWordsFor } from "./fixtures.js";

/**
 * ===========================================================================
 * VERIFICATION GAP - READ THIS BEFORE TRUSTING ANY GREEN TICK IN THIS FILE
 * ===========================================================================
 *
 * Nobody on this project reads Devanagari. There is no reviewer who can catch a
 * Hindi sentence that is grammatical but wrong for a seven-year-old, or subtly
 * off in register. Every assertion in this file is MECHANICAL. What a passing
 * run of tests/unit/content/ does and does not establish:
 *
 *   MACHINE-VERIFIED (these tests prove it):
 *     - schema: every bundle has every field, correctly typed (schema.test.ts)
 *     - allowlist: every Hindi pool word passes createAllowlist / checkWord,
 *       nothing is blocked, nothing exceeds MAX_WORD_LENGTH (allowlist.test.ts)
 *     - AC-12.3: every content word of every Hindi warp sentence is in that
 *       stage's pool (allowlist.test.ts)
 *     - AC-13.2: every word a child reads is in pool + sight words + proper
 *       nouns (allowlist.test.ts)
 *     - AC-14.2 / D46: every Hindi pool word round-trips through
 *       canonicalRomanization -> matchesTransliteration, and accepts a table of
 *       hand-written alternative spellings (below)
 *     - AC-14.2: findAmbiguousPairs reports no collision inside any pool (below)
 *     - segmentation: every pool word segments losslessly (below)
 *
 *   NOT VERIFIED BY ANYTHING, BY ANYONE:
 *     - MEANING. That the Hindi says what the English says. No back-translation
 *       was reviewed by a reader.
 *     - FACTUAL CARRY-OVER. The planet facts were verified in English against
 *       NASA sources (D67). Nothing checked that the Hindi restates them
 *       correctly rather than, say, inverting a comparison.
 *     - REGISTER. Whether this reads as a warm co-pilot talking to a child or
 *       as stiff textbook Hindi. `तुम` vs `आप` vs `तू` was chosen (तुम) without
 *       a native speaker confirming it is right for this narrator and audience.
 *     - AGE-APPROPRIATENESS. "Grade 2-3 reading level in that language" is a
 *       CLAIM, not a measurement. No Hindi readability metric was run; there is
 *       no Hindi equivalent of the Fry list on disk (architecture 5.2's
 *       compile-allowlist has not run), so sight-words.json for hi is a
 *       hand-made stand-in whose "high frequency" status is unverified.
 *     - NATURALNESS / IDIOM. Word choices such as दीपक for "beacon", यान for
 *       "ship", पट्टी for "belt", छल्ले for "rings" are plausible but unchecked.
 *     - PLANET NAMES. अरुण / वरुण / बृहस्पति / शनि / मंगल are the standard
 *       Hindi astronomical names, but प्लूटो (transliteration) was chosen over
 *       यम (the traditional name, which is also the god of death) on a judgement
 *       call about a children's game. That call had no native-speaker input.
 *     - PROPER-NOUN SPELLING. टाइटन, ट्राइटन, शैरन are transliterations chosen
 *       here, not sourced from a Hindi astronomy reference.
 *
 * The same gap applies to Spanish in kind, but not in degree: Spanish is
 * spot-checkable by more people and its script is Latin, so an error is visible
 * to a reviewer skimming the file. Hindi is not.
 *
 * Until a Hindi-reading reviewer signs off, treat hi/*.json as UNREVIEWED
 * CONTENT THAT PASSES ITS MACHINE GATES. That is a real and useful thing; it is
 * not the same thing as correct.
 */

const HI = bundlesFor("hi");
const BELT = HI.filter((b) => b.stopId !== "earth");
const ALL_POOL_WORDS = HI.flatMap((b) => b.pool);

describe("D46 / AC-14.2: every Hindi pool word round-trips", () => {
  for (const b of HI.filter((x) => x.pool.length > 0)) {
    it(`AC-14.2: hi/${b.stopId} pool words are all Devanagari`, () => {
      for (const w of b.pool) {
        expect(hasDevanagari(w), `"${w}" is not Devanagari`).toBe(true);
        // Latin leaking into a Devanagari pool means the exact-match path
        // (inscript) and the variant path (translit) disagree about the word.
        expect(w, `"${w}" contains Latin letters`).not.toMatch(/[a-z]/i);
      }
    });

    it(`AC-14.2: hi/${b.stopId} pool words segment losslessly`, () => {
      for (const w of b.pool) {
        const aksharas = segmentDevanagari(w);
        expect(aksharas.length, `"${w}" produced no aksharas`).toBeGreaterThan(0);
        // If segmentation drops a code point the matcher is silently working
        // on a different word than the one on the asteroid.
        expect(aksharas.map((a) => a.source).join(""), `"${w}"`).toBe(
          w.normalize("NFC"),
        );
        for (const a of aksharas) {
          expect(a.variants.length, `"${w}" akshara ${a.source}`).toBeGreaterThan(0);
        }
      }
    });

    it(`D46: hi/${b.stopId} canonical hint is accepted by the matcher`, () => {
      // canonicalRomanization is DISPLAY-only (a typing hint). If the hint the
      // child is shown is not itself a spelling the lock accepts, the game is
      // telling them to type something that will not work.
      for (const w of b.pool) {
        const hint = canonicalRomanization(w);
        expect(hint.length, `"${w}" produced an empty hint`).toBeGreaterThan(0);
        expect(hint, `"${w}" hint is not romanized`).toMatch(/^[a-z]+$/);
        expect(
          matchesTransliteration(hint, w),
          `hint "${hint}" does not match "${w}"`,
        ).toBe(true);
        // Per-keystroke narrowing (architecture 4) must never cut off a legal
        // spelling before the child finishes it.
        for (let i = 0; i <= hint.length; i += 1) {
          expect(
            isTransliterationPrefix(hint.slice(0, i), w),
            `prefix "${hint.slice(0, i)}" of "${hint}" rejected for "${w}"`,
          ).toBe(true);
        }
      }
    });

    it(`AC-14.2: hi/${b.stopId} pool words accept the Devanagari itself (inscript)`, () => {
      // D46's second input method commits the target string directly.
      for (const w of b.pool) expect(matchesTransliteration(w, w)).toBe(true);
    });
  }

  for (const b of BELT) {
    it(`AC-14.2: every word of the hi/${b.stopId} warp sentence is typeable`, () => {
      // The warp sentence is typed in full, sight words included, so every
      // token of it must romanize - not just the pool words.
      const tokens = (b.warpSentence ?? "").split(/\s+/).filter((t) => t.length > 0);
      expect(tokens.length).toBeGreaterThan(2);
      for (const raw of tokens) {
        const word = raw.replace(/[,।?!]/gu, "");
        if (word.length === 0) continue;
        const hint = canonicalRomanization(word);
        expect(
          matchesTransliteration(hint, word),
          `"${word}" (hint "${hint}") is not typeable`,
        ).toBe(true);
      }
    });
  }

  it("AC-14.2: hi Earth's activation word is typeable in romanized Hindi", () => {
    const earth = HI.find((b) => b.stopId === "earth");
    const word = earth?.activationWord ?? "";
    expect(hasDevanagari(word)).toBe(true);
    expect(matchesTransliteration(canonicalRomanization(word), word)).toBe(true);
    expect(matchesTransliteration("chalo", word)).toBe(true);
  });
});

/**
 * Spellings a child might actually produce, written by hand rather than
 * generated, because the point is to test the TABLE against real typing habits
 * and a generator would only re-derive the table.
 *
 * Each row is a pool word plus spellings drawn from how the word appears in
 * everyday Hinglish: long/short vowel swaps (dhool/dhul), aspirate drops
 * (chhote/chote), f/ph (safed/saphed), the nukta d/r split (bada/bara),
 * geminate reduction (chattan/chatan) and schwa (letkar/letakar).
 */
const CHILD_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  "मंगल": ["mangal"],
  "लाल": ["lal", "laal"],
  "ग्रह": ["grah"],
  "धूल": ["dhool", "dhul"],
  "ठंडा": ["thanda", "thandaa"],
  "सूखा": ["sookha", "sukha"],
  "आसमान": ["aasman", "asman", "aasmaan"],
  "गुलाबी": ["gulabi", "gulaabi", "gulabee"],
  "छोटे": ["chhote", "chote"],
  "चाँद": ["chand", "chaand", "chad"],
  "घूमते": ["ghoomte", "ghumte"],
  "नदियाँ": ["nadiyan", "nadiya", "nadiyaan"],
  "धरती": ["dharti", "dhartee"],
  "खाली": ["khali", "khaali"],
  "दीपक": ["dipak", "deepak"],
  "बृहस्पति": ["brihaspati", "brihaspti"],
  "बड़ा": ["bada", "bara", "badaa"],
  "बाकी": ["baki", "baaki"],
  "नारंगी": ["narangi", "naarangi"],
  "सफेद": ["safed", "saphed"],
  "भूरे": ["bhure", "bhoore"],
  "तूफान": ["toofan", "tufan", "toophan"],
  "धब्बा": ["dhabba", "dhaba"],
  "सैकड़ों": ["saikdon", "saikadon", "saikron"],
  "साल": ["sal", "saal"],
  "शनि": ["shani", "sani"],
  "पास": ["pas", "paas"],
  "छल्ले": ["chhalle", "challe", "chhale"],
  "दूर": ["door", "dur"],
  "बर्फ": ["barf", "barph"],
  "चट्टान": ["chattan", "chatan", "chattaan"],
  "हल्का": ["halka", "halkaa"],
  "पानी": ["pani", "paani"],
  "झीलें": ["jhilen", "jheelen", "jhile"],
  "बीच": ["bich", "beech"],
  "निकलो": ["niklo", "nikalo"],
  "अरुण": ["arun"],
  "लेटकर": ["letkar", "letakar"],
  "लट्टू": ["lattu", "lattoo", "latu"],
  "सीधे": ["sidhe", "seedhe"],
  "तरफ": ["taraf", "taraph"],
  "सालों": ["salon", "saalon"],
  "मुश्किल": ["mushkil", "muskil"],
  "देखना": ["dekhna", "dekhana"],
  "वरुण": ["varun", "warun"],
  "सूरज": ["suraj", "sooraj"],
  "रोशनी": ["roshni", "roshani"],
  "चार": ["char", "chaar"],
  "तारा": ["tara", "taara"],
  "काले": ["kale", "kaale"],
  "प्लूटो": ["pluto", "plooto"],
  "छोटा": ["chota", "chhota"],
  "पाँच": ["panch", "paanch", "pach"],
  "आधा": ["aadha", "adha"],
  "जलाओ": ["jalao", "jalaao"],
  "पायलट": ["paylat", "payalat"],
};

describe("D46: the table accepts the spellings a child would type", () => {
  it("AC-14.2: every hand-written child spelling is accepted", () => {
    const failures: string[] = [];
    for (const [target, spellings] of Object.entries(CHILD_SPELLINGS)) {
      for (const typed of spellings) {
        if (!matchesTransliteration(typed, target)) {
          failures.push(`${target} <- "${typed}"`);
        }
      }
    }
    expect(failures, "child spellings the table refuses").toEqual([]);
  });

  it("AC-14.2: every spelling tested is for a word actually in a shipped pool", () => {
    // Stops the table rotting into a test of words nobody ships.
    const pool = new Set(ALL_POOL_WORDS);
    for (const target of Object.keys(CHILD_SPELLINGS)) {
      expect(pool.has(target), `"${target}" is not in any hi pool`).toBe(true);
    }
  });

  /**
   * FINDING (AC-14.2, D46): spellings a child plausibly types that the shipped
   * TRANSLIT_TABLE refuses. These are NOT content bugs and the words were kept
   * deliberately - dodging them by swapping in a different word would hide a
   * defect in the table behind a vocabulary choice (lane brief rule 5).
   *
   * Pinned as an exact list so that:
   *   - a NEW gap introduced by new content fails this test, and
   *   - a gap CLOSED by the i18n lane also fails it, forcing this list to
   *     shrink deliberately rather than drift.
   *
   * Root causes, for whoever fixes translit.ts:
   *   1. INHERENT-A BEFORE ह. In Hindi a consonant carrying the inherent 'a'
   *      before ह is pronounced /ɛ/ and is routinely written "eh": kehna,
   *      rehna, pehla, mehnga. The table offers only "a", so गहरा/गहरे/कहते/
   *      बहती/सतह refuse gehra/gehre/kehte/behti/sateh. This is the largest
   *      class: it is productive and hits ordinary vocabulary.
   *   2. ौ AND ो COLLAPSE. मौसम is written "mosam" at least as often as
   *      "mausam". ौ accepts only ["au","ou"], and ो accepts only ["o","u"],
   *      so neither spelling reaches the other.
   *   3. ै IN LOANWORDS. गैस is the Hindi spelling of English "gas"; a child
   *      who knows the English word types "gas". ै accepts only
   *      ["ai","ei","ay"].
   *   4. GLIDE INSERTION. आ + ए is pronounced with an intervening /j/ and
   *      typed that way: हवाएँ -> "hawayen". ए has no "ye" variant.
   *   5. SHORT ु DOES NOT ACCEPT "oo". ू accepts ["oo","u","uu"] but ु accepts
   *      only ["u"], so वरुण/अरुण refuse "varoon"/"aroon" while दूर accepts
   *      both "door" and "dur". The asymmetry is the bug, not either half.
   */
  const KNOWN_TABLE_GAPS: readonly (readonly [string, string])[] = [
    ["गहरा", "gehra"],
    ["गहरे", "gehre"],
    ["कहते", "kehte"],
    ["बहती", "behti"],
    ["सतह", "sateh"],
    ["मौसम", "mosam"],
    ["लोग", "loag"],
    ["गैस", "gas"],
    ["गैस", "gaes"],
    ["हवाएँ", "hawayen"],
    ["हवाएँ", "hawaein"],
    ["वरुण", "varoon"],
    ["अरुण", "aroon"],
  ];

  it("FINDING AC-14.2: the known TRANSLIT_TABLE gaps are exactly these", () => {
    const stillRejected = KNOWN_TABLE_GAPS.filter(
      ([target, typed]) => !matchesTransliteration(typed, target),
    );
    expect(
      stillRejected,
      "a listed gap was closed in translit.ts - shrink KNOWN_TABLE_GAPS",
    ).toEqual([...KNOWN_TABLE_GAPS]);
    for (const [target] of KNOWN_TABLE_GAPS) {
      expect(ALL_POOL_WORDS, `"${target}" left the pools`).toContain(target);
    }
  });
});

describe("AC-14.2: no Hindi pool contains an unresolvable lock", () => {
  /**
   * findAmbiguousPairs over EVERY pool. Two words in one pool that share a
   * romanization make a lock the child cannot resolve: they type a string that
   * spells both, and the picker's first-letter rule cannot see the collision
   * because both words start with the same letter by construction.
   */
  for (const b of HI.filter((x) => x.pool.length > 0)) {
    it(`AC-14.2: hi/${b.stopId} pool has no ambiguous pair`, () => {
      expect(findAmbiguousPairs(b.pool)).toEqual([]);
    });
  }

  /**
   * The picker draws a few sight words as filler (story-draft note: "plus a
   * few sight words from the allowlist for filler"), so the set actually on
   * screen is pool + filler, not pool alone. Two assertions, and the split
   * between them is the finding:
   *
   *   HARD: no POOL word collides with anything, filler included. That is
   *   content's responsibility and it holds.
   *
   *   FINDING (AC-14.2, for the selection lane): Hindi's high-frequency
   *   function words collide with EACH OTHER, unavoidably, because the table
   *   collapses short and long vowels (कि/की, पर/पार, यह/यहाँ, है/हैं) and the
   *   inherent 'a' against ा (लिख/लिखा). These are the six most common words
   *   in the language; they cannot be rewritten out of the sight list. So
   *   `selection/` must not be free to spawn two fillers that share a
   *   romanization at the same time. The content lane cannot fix this and did
   *   not try to.
   */
  const SIGHT_FILLER = sightWordsFor("hi").filter((w) => hasDevanagari(w));

  it("AC-14.2: no Hindi POOL word is ambiguous against a sight-word filler", () => {
    const poolWords = new Set(ALL_POOL_WORDS);
    const failures: string[] = [];
    for (const b of HI.filter((x) => x.pool.length > 0)) {
      const pairs = findAmbiguousPairs([...new Set([...b.pool, ...SIGHT_FILLER])]);
      for (const p of pairs) {
        if (poolWords.has(p.a) || poolWords.has(p.b)) {
          failures.push(`${b.stopId}: ${p.a} / ${p.b} (${p.shared.join(",")})`);
        }
      }
    }
    expect(failures, "a pool word collides with a filler word").toEqual([]);
  });

  it("FINDING AC-14.2: the Hindi sight-word list collides with itself, exactly here", () => {
    const pairs = findAmbiguousPairs(SIGHT_FILLER).map((p) => `${p.a}/${p.b}`);
    expect(pairs.sort()).toEqual([
      "कि/की",
      "पर/पार",
      "यह/यहाँ",
      "लिख/लिखा",
      "है/हैं",
    ]);
  });

  it("AC-14.2: findAmbiguousPairs is actually capable of firing on this data", () => {
    // Guards the three tests above against passing vacuously. कल / काल is the
    // worked example in translit.ts's own doc comment.
    expect(findAmbiguousPairs(["कल", "काल"]).length).toBeGreaterThan(0);
    const p = findAmbiguousPairs(["कल", "काल"])[0];
    expect(p?.shared.length ?? 0).toBeGreaterThan(0);
  });

  it("AC-14.2: every pool word has at least one romanization", () => {
    for (const w of ALL_POOL_WORDS) {
      expect(romanizationsOf(w).length, `"${w}"`).toBeGreaterThan(0);
    }
  });
});
