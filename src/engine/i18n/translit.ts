import type { InputMethod } from "../types.js";

/**
 * Romanized Hindi -> Devanagari matching (AC-14.2, D46).
 *
 * D46: "Hindi typed content uses romanized transliteration by default (type
 * `ghar` to match घर; matches how most Indian kids actually type)."
 *
 * SHAPE OF THE PROBLEM. There is no single correct romanization. A child types
 * whatever their phone's keyboard taught them: "pani" or "paani", "ladka" or
 * "larka", "phool" or "fool", "namaste" or "namastey". So the table is not
 * char -> char. Every Devanagari unit owns a VARIANT SET of acceptable
 * romanizations, an ambiguous romanization is simply a string that appears in
 * more than one set, and matching asks "can the typed string be cut into one
 * variant per unit?".
 *
 * ALGORITHM. Segment the target into aksharas (consonant cluster + optional
 * nukta + optional matra + optional nasal/visarga sign), expand each into its
 * variant set, then run a forward reachability DP over
 * (akshara index, typed position). Deterministic, table-driven, no regex
 * guessing, and the same DP answers the prefix question the lock module needs
 * per keystroke (architecture section 4: "translit mode maps romanized buffer ->
 * target via table with variant sets").
 *
 * INHERENT 'a'. A bare consonant carries an inherent 'a'. Hindi deletes that
 * schwa word-finally and often medially - घर is "ghar", not "ghara" - so every
 * non-initial consonant akshara accepts both "Ca" and "C". The word-INITIAL
 * schwa is never deleted in Hindi, so the first akshara OF EACH WORD does not
 * get the empty variant; that one restriction is what stops "ghr" matching घर,
 * and it is applied per word so "mera ghr" fails too.
 *
 * ANUSVARA vs CHANDRABINDU. Both are accepted as n/m/ng. Only one of them may
 * also be dropped entirely, and the split is positional, not by sign:
 *   - word-finally (नहीं, मैं, हैं, चाँद) the sign writes a nasal VOWEL, which
 *     a typist routinely omits, so "" is accepted;
 *   - medially (हिंदी, अंदर, गंगा) it writes a homorganic nasal CONSONANT,
 *     which is always typed, so "" is not accepted and "hidi" stays rejected.
 * Chandrabindu accepts "" everywhere, since it only ever writes nasalisation.
 *
 * GEMINATES. A doubled consonant accepts its single form: कुत्ता takes "kuta"
 * as well as "kutta", बिल्ली takes "bili", अम्मा takes "ama". This is applied
 * by rule to every geminate rather than by hand to a few clusters.
 *
 * DELIBERATE OVER-PERMISSIVENESS. Where the choice is between rejecting a
 * spelling a child might reasonably produce and accepting one they probably
 * would not, this table accepts. A false accept costs a keystroke of leniency;
 * a false reject tells an eight-year-old their own language is wrong. The
 * documented cost is real and measurable: कल/काल, बल/बाल, दिन/दीन all share a
 * romanization. `findAmbiguousPairs` exists so the content pipeline and the
 * selection lane can assert a stage pool has no collisions, rather than
 * discovering one on a child's screen.
 *
 * NUKTA. NFC does NOT compose U+0915 + U+093C back into U+0958 (क़ is a Unicode
 * composition exclusion), so after normalisation every nukta letter in that
 * range is the two code points base + U+093C. U+0929/0931/0934 (ऩ ऱ ऴ) are NOT
 * exclusions and DO compose, so they are listed as single characters.
 *
 * KNOWN LIMITATION. गाँव -> "gaon" is not accepted. That spelling reorders the
 * nasal after the vowel of the following letter, and this matcher consumes
 * aksharas strictly left to right by design; supporting it would mean
 * metathesis, which would weaken every other guarantee here. "gaanv", "ganv",
 * "gaav" and "gav" are accepted.
 */

const NUKTA = "़";
const VIRAMA = "्";
const ANUSVARA = "ं";
const DANDA = "।";

/** Ends the current word for the initial-schwa and word-final-nasal rules. */
const WORD_BREAK = /[\s।]/;

/**
 * Consonant -> acceptable romanizations, most likely spelling first.
 * Retroflex and dental rows collapse onto the same Latin letters on purpose:
 * no child types ṭ vs t. That is the main source of ambiguity, and it is the
 * ambiguity AC-14.2 asks us to accept all variants of.
 */
const CONSONANTS: Readonly<Record<string, readonly string[]>> = {
  // velar
  "क": ["k"],
  "ख": ["kh"],
  "ग": ["g"],
  "घ": ["gh"],
  "ङ": ["ng", "n"],
  // palatal
  "च": ["ch", "c"],
  "छ": ["chh", "ch"],
  "ज": ["j"],
  // समझ is written "samajh" and also "samaj": the final aspirate is dropped.
  "झ": ["jh", "j"],
  "ञ": ["ny", "n"],
  // retroflex
  "ट": ["t"],
  "ठ": ["th"],
  "ड": ["d"],
  "ढ": ["dh"],
  "ण": ["n"],
  // dental
  "त": ["t"],
  "थ": ["th"],
  "द": ["d"],
  "ध": ["dh"],
  "न": ["n"],
  // labial
  "प": ["p"],
  "फ": ["ph", "f"],
  "ब": ["b"],
  "भ": ["bh"],
  "म": ["m"],
  // approximants and sibilants
  "य": ["y"],
  "र": ["r"],
  "ल": ["l"],
  "व": ["v", "w"],
  "श": ["sh", "s"],
  "ष": ["sh", "s"],
  "स": ["s"],
  "ह": ["h"],
  "ळ": ["l"],
  // ऩ ऱ ऴ are NOT composition exclusions, so NFC folds न/र/ळ + nukta into
  // them. They must be in the table or normalised content stops segmenting.
  "ऩ": ["n"],
  "ऱ": ["r"],
  "ऴ": ["l", "zh"],
  // nukta letters, always stored decomposed (see NUKTA note above)
  [`क${NUKTA}`]: ["q", "k"],
  [`ख${NUKTA}`]: ["kh", "x"],
  [`ग${NUKTA}`]: ["gh", "g"],
  [`ज${NUKTA}`]: ["z", "j"],
  // "ladka"/"ped" dominate written Hinglish, so "d" leads; "pedh" is also real.
  [`ड${NUKTA}`]: ["d", "r", "dh"],
  [`ढ${NUKTA}`]: ["rh", "dh"],
  [`फ${NUKTA}`]: ["f", "ph"],
};

/**
 * Independent vowels (word-initial position).
 * ए carries "ai" because एक is written "aik" as often as "ek", which makes
 * ए and ऐ genuinely ambiguous with each other. That is accepted, not resolved.
 */
const VOWELS: Readonly<Record<string, readonly string[]>> = {
  "अ": ["a"],
  "आ": ["aa", "a"],
  "इ": ["i"],
  "ई": ["ee", "i", "ii"],
  "उ": ["u"],
  "ऊ": ["oo", "u", "uu"],
  "ऋ": ["ri", "ru"],
  "ए": ["e", "ay", "ey", "ai"],
  "ऐ": ["ai", "ei", "ay"],
  "ओ": ["o"],
  "औ": ["au", "ou"],
};

/**
 * Matras (dependent vowel signs), most likely spelling first.
 * "ey" on े is the standard Hinglish spelling (namastey, kheylo, meyra) and
 * "ay" on ै mirrors it (hay, tayyar, paysa). "u" on ो is there for क्यों,
 * which is written "kyun" far more often than "kyon".
 */
const MATRAS: Readonly<Record<string, readonly string[]>> = {
  "ा": ["a", "aa"], // ा
  "ि": ["i"], // ि
  "ी": ["i", "ee", "ii"], // ी
  "ु": ["u"], // ु
  "ू": ["oo", "u", "uu"], // ू
  "ृ": ["ri", "ru"], // ृ
  "े": ["e", "ay", "ey"], // े
  "ै": ["ai", "ei", "ay"], // ै
  "ो": ["o", "u"], // ो
  "ौ": ["au", "ou"], // ौ
};

/** Nasal and aspiration signs. See the ANUSVARA vs CHANDRABINDU note above. */
const SIGNS: Readonly<Record<string, readonly string[]>> = {
  [ANUSVARA]: ["n", "m", "ng"], // ं - gains "" word-finally only
  "ँ": ["n", "m", ""], // ँ chandrabindu
  "ः": ["h", ""], // ः visarga
};

/**
 * Clusters whose conventional romanization is not the concatenation of their
 * parts. Keyed by the exact `C + virama + C` source string; the first entry is
 * the canonical spelling. These replace the consonant base; matra, sign and
 * the geminate rule still apply.
 */
const CLUSTER_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  // क्ष: "ksha" by convention, "x" on phone keyboards.
  [`क${VIRAMA}ष`]: ["ksh", "ks", "x", "chh"],
  // ज्ञ: pronounced "gy" in Hindi; "gn"/"dny" come from Sanskrit and Marathi.
  [`ज${VIRAMA}ञ`]: ["gy", "gn", "dny", "jn"],
  // च्छ: the generic product misses the single-"ch" spelling, so अच्छा is
  // typed "achha" or even "acha" as often as "achchha".
  [`च${VIRAMA}छ`]: ["chch", "chchh", "cchh", "cch", "chh", "ch"],
};

/** Inherent 'a' on a non-initial consonant: kept or deleted (schwa deletion). */
const INHERENT_A: readonly string[] = ["a", ""];
/** Word-initial schwa is never deleted in Hindi. */
const INHERENT_A_INITIAL: readonly string[] = ["a"];
/** No vowel at all: a half form, or the absence of a sign. */
const NONE: readonly string[] = [""];

/** The whole mapping, exposed so AC-14.2's tests can be table-driven. */
export const TRANSLIT_TABLE = {
  consonants: CONSONANTS,
  vowels: VOWELS,
  matras: MATRAS,
  signs: SIGNS,
  clusters: CLUSTER_OVERRIDES,
  inherentA: INHERENT_A,
  inherentAInitial: INHERENT_A_INITIAL,
  nukta: NUKTA,
  virama: VIRAMA,
  anusvara: ANUSVARA,
} as const;

/** One orthographic syllable of the target, with everything it will accept. */
export interface Akshara {
  /** The exact Devanagari substring this came from. */
  readonly source: string;
  /** Every romanization accepted for it, lowercase. */
  readonly variants: readonly string[];
}

/** Akshara plus what `canonicalRomanization` needs to pick one spelling. */
interface SegmentedAkshara extends Akshara {
  /** Canonical consonant or vowel part. */
  readonly head: string;
  /** Canonical explicit vowel; "" when the vowel slot is inherent or absent. */
  readonly vowelText: string;
  /** Canonical nasal/visarga part. */
  readonly tail: string;
  /** True when the vowel slot holds an unwritten inherent 'a'. */
  readonly inherent: boolean;
  /** True when this akshara carries a written vowel (matra or independent). */
  readonly hasWrittenVowel: boolean;
  /** True when the inherent 'a' is protected: the first akshara of a word. */
  readonly schwaProtected: boolean;
  readonly wordFinal: boolean;
  /** Consonants joined by virama in this akshara; 0 for pass-through. */
  readonly unitCount: number;
}

const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/** True if the string contains any Devanagari, i.e. needs this module at all. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI_RANGE.test(text);
}

/** Concatenate one choice from every group. Sets stay small: see COVERAGE. */
function product(groups: readonly (readonly string[])[]): string[] {
  let acc: string[] = [""];
  for (const group of groups) {
    const next: string[] = [];
    for (const prefix of acc) for (const part of group) next.push(prefix + part);
    acc = next;
  }
  return acc;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** First entry, or "" for an empty list. Branch-free so it stays testable. */
function primary(variants: readonly string[]): string {
  return variants.slice(0, 1).join("");
}

/** Normalise anything before it touches the table: NFC, trimmed, lowercased. */
export function normalizeTyped(text: string): string {
  return text.normalize("NFC").trim().toLowerCase();
}

interface ConsonantUnit {
  /** The source chars, base or base+nukta. */
  readonly unit: string;
  readonly variants: readonly string[];
  /** Index just past this unit. */
  readonly next: number;
}

/**
 * Read a consonant (plus a nukta it can actually take) at `i`, or null if
 * there is no consonant there. A nukta on a letter with no nukta form - which
 * malformed content can produce - is consumed and ignored rather than
 * breaking segmentation.
 */
function consonantAt(s: string, i: number): ConsonantUnit | null {
  const base = s.charAt(i);
  if (s.charAt(i + 1) === NUKTA) {
    const combined = CONSONANTS[base + NUKTA];
    if (combined !== undefined) {
      return { unit: base + NUKTA, variants: combined, next: i + 2 };
    }
    const plain = CONSONANTS[base];
    if (plain !== undefined) return { unit: base, variants: plain, next: i + 2 };
    return null;
  }
  const plain = CONSONANTS[base];
  if (plain !== undefined) return { unit: base, variants: plain, next: i + 1 };
  return null;
}

/** See the ANUSVARA vs CHANDRABINDU note: only a final anusvara may drop. */
function signVariantsFor(signChar: string, wordFinal: boolean): readonly string[] {
  const listed = SIGNS[signChar];
  if (listed === undefined) return NONE;
  if (signChar === ANUSVARA && wordFinal) return [...listed, ""];
  return listed;
}

function segment(target: string): SegmentedAkshara[] {
  const s = target.normalize("NFC");
  const out: SegmentedAkshara[] = [];
  let i = 0;
  let atWordStart = true;

  while (i < s.length) {
    const ch = s.charAt(i);
    const head = consonantAt(s, i);

    if (head !== null) {
      const unitSources: string[] = [];
      const unitVariants: (readonly string[])[] = [];
      let firstUnit: string | null = null;
      let geminate: readonly string[] | null = null;
      let trailingVirama = false;
      let current: ConsonantUnit = head;

      // Consonant cluster: C(+nukta) [ virama C(+nukta) ]*
      for (;;) {
        const isSecond = unitSources.length === 1;
        if (isSecond && current.unit === firstUnit) geminate = current.variants;
        if (firstUnit === null) firstUnit = current.unit;
        unitSources.push(current.unit);
        unitVariants.push(current.variants);
        i = current.next;
        if (s.charAt(i) !== VIRAMA) break;
        i += 1;
        const joined = consonantAt(s, i);
        if (joined === null) {
          // Virama with nothing to join to: a half form, so no inherent vowel.
          trailingVirama = true;
          break;
        }
        current = joined;
      }

      let matraSource = "";
      let matraVariants: readonly string[] | undefined;
      const matraHit = MATRAS[s.charAt(i)];
      if (matraHit !== undefined) {
        matraSource = s.charAt(i);
        matraVariants = matraHit;
        i += 1;
      }

      let signSource = "";
      if (SIGNS[s.charAt(i)] !== undefined) {
        signSource = s.charAt(i);
        i += 1;
      }

      const wordFinal = i >= s.length || WORD_BREAK.test(s.charAt(i));
      const signVariants = signVariantsFor(signSource, wordFinal);

      const clusterKey = unitSources.join(VIRAMA);
      const override = CLUSTER_OVERRIDES[clusterKey];
      const clusterBase = override ?? product(unitVariants);
      // Geminate reduction: कुत्ता takes "kuta", बिल्ली takes "bili".
      const base =
        geminate === null ? clusterBase : [...clusterBase, ...geminate];

      let vowel: readonly string[];
      if (trailingVirama) vowel = NONE;
      else if (matraVariants !== undefined) vowel = matraVariants;
      else vowel = atWordStart ? INHERENT_A_INITIAL : INHERENT_A;

      out.push({
        source:
          clusterKey + (trailingVirama ? VIRAMA : "") + matraSource + signSource,
        variants: dedupe(product([base, vowel, signVariants])),
        head: primary(base),
        vowelText: primary(vowel),
        tail: primary(signVariants),
        inherent: !trailingVirama && matraVariants === undefined,
        hasWrittenVowel: matraVariants !== undefined,
        schwaProtected: atWordStart,
        wordFinal,
        unitCount: unitSources.length,
      });
      atWordStart = false;
      continue;
    }

    const vowelHit = VOWELS[ch];
    if (vowelHit !== undefined) {
      i += 1;
      let signSource = "";
      if (SIGNS[s.charAt(i)] !== undefined) {
        signSource = s.charAt(i);
        i += 1;
      }
      const wordFinal = i >= s.length || WORD_BREAK.test(s.charAt(i));
      const signVariants = signVariantsFor(signSource, wordFinal);
      out.push({
        source: ch + signSource,
        variants: dedupe(product([vowelHit, signVariants])),
        head: primary(vowelHit),
        vowelText: "",
        tail: primary(signVariants),
        inherent: false,
        hasWrittenVowel: true,
        schwaProtected: atWordStart,
        wordFinal,
        unitCount: 0,
      });
      atWordStart = false;
      continue;
    }

    // Anything else - a space in a multi-word target, a danda, a Latin letter
    // in a mixed string - passes through as itself. Danda also accepts "." and
    // nothing, because no romanized keyboard offers it.
    i += 1;
    const isBreak = WORD_BREAK.test(ch);
    out.push({
      source: ch,
      variants: ch === DANDA ? [ch, ".", ""] : [ch.toLowerCase()],
      head: ch === DANDA ? "" : ch.toLowerCase(),
      vowelText: "",
      tail: "",
      inherent: false,
      hasWrittenVowel: false,
      schwaProtected: false,
      wordFinal: false,
      unitCount: 0,
    });
    atWordStart = isBreak;
  }

  return out;
}

/**
 * Cut a Devanagari string into aksharas and expand each into its variant set.
 * Exported so tests can assert the segmentation itself, not just the verdict.
 */
export function segmentDevanagari(target: string): Akshara[] {
  return segment(target);
}

interface Reachable {
  /** Row stride: typed.length + 1. */
  readonly width: number;
  /** bits[k * width + p] === 1 when k aksharas consume exactly p chars. */
  readonly bits: Uint8Array;
}

/**
 * Forward reachability over (akshara index, typed position). A flat bitmap
 * rather than a nested array so there are no possibly-undefined rows to guard.
 */
function reachability(aksharas: readonly Akshara[], typed: string): Reachable {
  const width = typed.length + 1;
  const bits = new Uint8Array((aksharas.length + 1) * width);
  bits[0] = 1;

  let base = 0;
  for (const akshara of aksharas) {
    const nextBase = base + width;
    for (let p = 0; p < width; p += 1) {
      if (bits[base + p] !== 1) continue;
      for (const variant of akshara.variants) {
        const q = p + variant.length;
        if (q < width && typed.startsWith(variant, p)) bits[nextBase + q] = 1;
      }
    }
    base = nextBase;
  }
  return { width, bits };
}

/**
 * AC-14.2: does this romanized (or Devanagari) input spell this target?
 *
 * Total over all content languages: when the target has no Devanagari it is a
 * normalised equality check, so callers do not have to branch on language.
 */
export function matchesTransliteration(typed: string, target: string): boolean {
  const t = normalizeTyped(typed);
  const g = normalizeTyped(target);

  // InScript / IME path (D46): the committed string is the target itself.
  if (t === g) return true;
  if (!hasDevanagari(g)) return false;

  const aksharas = segmentDevanagari(g);
  const { width, bits } = reachability(aksharas, t);
  return bits[aksharas.length * width + t.length] === 1;
}

/**
 * True if `typed` could still grow into `target`. This is what per-keystroke
 * lock narrowing needs (architecture section 4); an empty buffer is a prefix of
 * everything.
 */
export function isTransliterationPrefix(
  typed: string,
  target: string,
): boolean {
  const t = normalizeTyped(typed);
  const g = normalizeTyped(target);

  if (t.length === 0) return true;
  if (g.startsWith(t)) return true; // InScript / IME partial commit
  if (!hasDevanagari(g)) return false;

  const aksharas = segmentDevanagari(g);
  const { width, bits } = reachability(aksharas, t);

  let base = 0;
  for (const akshara of aksharas) {
    for (let p = 0; p < width; p += 1) {
      if (bits[base + p] !== 1) continue;
      // The untyped remainder must be the start of this akshara's
      // romanization. An empty remainder means everything typed landed on a
      // boundary, and every variant starts with "", so that case falls out.
      const rest = t.slice(p);
      if (akshara.variants.some((v) => v.startsWith(rest))) return true;
    }
    base += width;
  }
  // A full match always returns from the loop above: the last akshara's own
  // variant is the remainder at its boundary. Reaching here means the buffer
  // cannot be extended into this target.
  return false;
}

/**
 * ONE spelling of a Devanagari word: the form a child is most likely to type.
 *
 * WHAT THIS IS FOR. A consumer that can only hold a single string - an on-screen
 * typing hint, a debug label, a log line - needs a defensible default. The lock
 * must NOT use this as its only comparison string: doing that reinstates exactly
 * the single-spelling failure the variant sets exist to prevent (D31). Use
 * `createWordMatcher` for matching and this for display.
 *
 * SCHWA RULE. The inherent 'a' is written unless:
 *   - the akshara is the last of its word and is a single consonant (घर ->
 *     "ghar"), which is why मित्र stays "mitra" - Sanskrit-derived conjunct
 *     finals keep their vowel in writing; or
 *   - the next akshara is a SINGLE consonant carrying a written vowel
 *     (लड़का -> "ladka"). The single-consonant condition is what keeps नमस्ते
 *     at "namaste": deleting there would leave the cluster "mst", which Hindi
 *     does not do.
 * The first akshara of a word is always protected (टमाटर -> "tamatar").
 *
 * This is a good approximation, not the full Hindi schwa-deletion rule, which
 * is an open research problem. धड़कन comes out "dharakan", not "dhadkan".
 * Matching accepts both; only the displayed default is approximate.
 */
export function canonicalRomanization(target: string): string {
  const g = normalizeTyped(target);
  if (!hasDevanagari(g)) return g;

  const aksharas = segment(g);
  let out = "";
  for (const [k, akshara] of aksharas.entries()) {
    const next = aksharas[k + 1];
    let vowel: string;
    if (!akshara.inherent) vowel = akshara.vowelText;
    else if (akshara.schwaProtected) vowel = "a";
    else if (akshara.wordFinal && akshara.unitCount === 1) vowel = "";
    else if (next?.hasWrittenVowel === true && next.unitCount === 1) vowel = "";
    else vowel = "a";
    out += akshara.head + vowel + akshara.tail;
  }
  return out;
}

/**
 * Every romanization this target accepts, capped. Used by the table-driven
 * tests, by `findAmbiguousPairs`, and available to the UI as a typing hint.
 * Capped because the product of variant sets grows with akshara count and no
 * caller needs thousands. Truncation only ever loses spellings, so a caller
 * that searches this set is conservative, never wrong.
 */
export function romanizationsOf(target: string, limit = 256): string[] {
  const g = normalizeTyped(target);
  if (!hasDevanagari(g)) return [g];

  let acc: string[] = [""];
  for (const akshara of segmentDevanagari(g)) {
    const next: string[] = [];
    for (const prefix of acc) {
      for (const variant of akshara.variants) {
        next.push(prefix + variant);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    acc = dedupe(next);
  }
  return acc.filter((s) => s.length > 0).slice(0, limit);
}

// ---------------------------------------------------------------------------
// The port the lock module consumes (D31, D46, architecture section 4).
// ---------------------------------------------------------------------------

/**
 * The narrow interface `lock/` takes by injection. Two predicates, nothing
 * else: the lock owns candidate narrowing and auto-lock, i18n owns what
 * "matches" means. Injecting it rather than importing it keeps `lock/` free of
 * the transliteration table and keeps its tests synthetic.
 *
 * `isPrefix` must be true for every proper prefix of every string `isComplete`
 * accepts, or the lock can narrow its way out of a legal spelling.
 */
export interface WordMatcher {
  /** Could `typed` still grow into `target`? Empty buffer is always true. */
  isPrefix(typed: string, target: string): boolean;
  /** Is `typed` a complete, acceptable spelling of `target`? */
  isComplete(typed: string, target: string): boolean;
}

/** Committed-string comparison: `latin` layouts and `inscript` IME (D46). */
export const EXACT_MATCHER: WordMatcher = {
  isPrefix: (typed, target) =>
    normalizeTyped(target).startsWith(normalizeTyped(typed)),
  isComplete: (typed, target) => normalizeTyped(typed) === normalizeTyped(target),
};

/** Variant-set comparison: `translit` mode (D46). */
export const TRANSLIT_MATCHER: WordMatcher = {
  isPrefix: isTransliterationPrefix,
  isComplete: matchesTransliteration,
};

/** Pick the matcher for an input method. This is what Settings wires up. */
export function createWordMatcher(inputMethod: InputMethod): WordMatcher {
  return inputMethod === "translit" ? TRANSLIT_MATCHER : EXACT_MATCHER;
}

/**
 * Route a typed word by input method (D46). Convenience over
 * `createWordMatcher(...).isComplete`, kept for callers that hold no matcher.
 */
export function matchesTypedWord(
  typed: string,
  target: string,
  inputMethod: InputMethod,
): boolean {
  return createWordMatcher(inputMethod).isComplete(typed, target);
}

// ---------------------------------------------------------------------------
// Pool safety.
// ---------------------------------------------------------------------------

export interface AmbiguousPair {
  readonly a: string;
  readonly b: string;
  /** Romanizations both words accept, sorted. */
  readonly shared: readonly string[];
}

/**
 * Words in this list that cannot be told apart by what a child types.
 *
 * The collapses that make the table forgiving also make minimal pairs collide:
 * ा accepting "a" alongside the inherent 'a' merges every short/long pair
 * (कल/काल, बल/बाल), and the retroflex/dental collapse merges सत/शत. Two such
 * words on screen at once is a lock the player cannot resolve, so the content
 * pipeline and selection/ assert against this rather than trusting the table.
 *
 * Conservative by construction: `romanizationsOf` truncates at `limit`, and
 * truncation can only hide a collision, never invent one.
 */
export function findAmbiguousPairs(
  words: readonly string[],
  limit = 1024,
): AmbiguousPair[] {
  const byRomanization = new Map<string, Set<string>>();
  for (const word of words) {
    const normalized = normalizeTyped(word);
    for (const spelling of romanizationsOf(normalized, limit)) {
      const bucket = byRomanization.get(spelling);
      if (bucket === undefined) byRomanization.set(spelling, new Set([normalized]));
      else bucket.add(normalized);
    }
  }

  const shared = new Map<string, string[]>();
  for (const [spelling, bucket] of byRomanization) {
    if (bucket.size < 2) continue;
    const members = [...bucket].sort();
    for (const [index, a] of members.entries()) {
      for (const b of members.slice(index + 1)) {
        const key = `${a} ${b}`;
        const existing = shared.get(key);
        if (existing === undefined) shared.set(key, [spelling]);
        else existing.push(spelling);
      }
    }
  }

  const pairs: AmbiguousPair[] = [];
  for (const [key, spellings] of shared) {
    const [a = "", b = ""] = key.split(" ");
    pairs.push({ a, b, shared: [...spellings].sort() });
  }
  pairs.sort((x, y) => (x.a === y.a ? x.b.localeCompare(y.b) : x.a.localeCompare(y.a)));
  return pairs;
}
