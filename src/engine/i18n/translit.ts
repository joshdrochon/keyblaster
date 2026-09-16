import type { InputMethod } from "../types.js";

/**
 * Romanized Hindi -> Devanagari matching (AC-14.2, D46).
 *
 * D46: "Hindi typed content uses romanized transliteration by default (type
 * `ghar` to match घर; matches how most Indian kids actually type)."
 *
 * SHAPE OF THE PROBLEM. There is no single correct romanization. A child types
 * whatever their phone's keyboard taught them: "pani" or "paani", "ladka" or
 * "larka", "phool" or "fool". So the table is not char -> char. Every
 * Devanagari unit owns a VARIANT SET of acceptable romanizations, an ambiguous
 * romanization is simply a string that appears in more than one set, and
 * matching asks "can the typed string be cut into one variant per unit?".
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
 * schwa is never deleted in Hindi, so the first akshara does not get the empty
 * variant; that one restriction is what stops "ghr" from matching घर.
 *
 * DELIBERATE OVER-PERMISSIVENESS. Where the choice is between rejecting a
 * spelling a child might reasonably produce and accepting one they probably
 * would not, this table accepts. A false accept costs a keystroke of leniency;
 * a false reject tells an eight-year-old their own language is wrong. The
 * documented cost is that two pool words could in principle share a
 * romanization; selection/ already keeps the on-screen set small, and the lock
 * module narrows on candidates, so a tie degrades to a normal shared-prefix
 * lock rather than a failure.
 *
 * NUKTA. NFC does NOT compose U+0915 + U+093C back into U+0958 (क़ is a Unicode
 * composition exclusion), so after normalisation every nukta letter is the two
 * code points base + U+093C. The table is keyed that way and the segmenter
 * always pulls a following nukta into the consonant unit.
 *
 * COVERAGE. Kid-vocabulary level, per the brief: all 33 core consonants, the
 * seven nukta letters, independent vowels, all matras, anusvara, chandrabindu,
 * visarga, generic conjuncts, and explicit overrides for the four clusters
 * whose usual romanization is not the sum of their parts (क्ष, ज्ञ, च्छ, च्च).
 */

const NUKTA = "़";
const VIRAMA = "्";

/**
 * Consonant -> acceptable romanizations.
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
  "झ": ["jh"],
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
  [`ड${NUKTA}`]: ["r", "d"],
  [`ढ${NUKTA}`]: ["rh", "dh"],
  [`फ${NUKTA}`]: ["f", "ph"],
};

/** Independent vowels (word-initial position). */
const VOWELS: Readonly<Record<string, readonly string[]>> = {
  "अ": ["a"],
  "आ": ["aa", "a"],
  "इ": ["i"],
  "ई": ["ee", "i", "ii"],
  "उ": ["u"],
  "ऊ": ["oo", "u", "uu"],
  "ऋ": ["ri", "ru"],
  "ए": ["e", "ay"],
  "ऐ": ["ai", "ei"],
  "ओ": ["o"],
  "औ": ["au", "ou"],
};

/** Matras (dependent vowel signs). Same variant sets as their vowels. */
const MATRAS: Readonly<Record<string, readonly string[]>> = {
  "ा": ["aa", "a"], // ा
  "ि": ["i"], // ि
  "ी": ["ee", "i", "ii"], // ी
  "ु": ["u"], // ु
  "ू": ["oo", "u", "uu"], // ू
  "ृ": ["ri", "ru"], // ृ
  "े": ["e", "ay"], // े
  "ै": ["ai", "ei"], // ै
  "ो": ["o"], // ो
  "ौ": ["au", "ou"], // ौ
};

/**
 * Nasal and aspiration signs.
 * Chandrabindu accepts "" because nasalisation is the first thing a typist
 * drops: चाँद is far more often typed "chand" than "chaand".
 */
const SIGNS: Readonly<Record<string, readonly string[]>> = {
  "ं": ["n", "m", "ng"], // ं anusvara
  "ँ": ["n", "m", ""], // ँ chandrabindu
  "ः": ["h", ""], // ः visarga
};

/**
 * Clusters whose conventional romanization is not the concatenation of their
 * parts. Keyed by the exact `C + virama + C` source string.
 * These replace the consonant base only; matra and sign still apply.
 */
const CLUSTER_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  // क्ष: "ksha" by convention, "x" on phone keyboards.
  [`क${VIRAMA}ष`]: ["ksh", "ks", "x", "chh"],
  // ज्ञ: pronounced "gy" in Hindi; "gn"/"dny" come from Sanskrit and Marathi.
  [`ज${VIRAMA}ञ`]: ["gy", "gn", "dny", "jn"],
  // च्छ and च्च: the generic product misses the very common single-"ch"
  // spelling, so अच्छा is typed "achha" or even "acha" as often as "achchha".
  [`च${VIRAMA}छ`]: ["chchh", "chch", "cchh", "cch", "chh", "ch"],
  [`च${VIRAMA}च`]: ["chch", "cch", "chc", "cc", "ch"],
};

/** Inherent 'a' on a non-initial consonant: kept or deleted (schwa deletion). */
const INHERENT_A: readonly string[] = ["a", ""];
/** Word-initial schwa is never deleted in Hindi. */
const INHERENT_A_INITIAL: readonly string[] = ["a"];

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
} as const;

/** One orthographic syllable of the target, with everything it will accept. */
export interface Akshara {
  /** The exact Devanagari substring this came from. */
  readonly source: string;
  /** Every romanization accepted for it, lowercase. */
  readonly variants: readonly string[];
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

/** Normalise anything before it touches the table: NFC, trimmed, lowercased. */
export function normalizeTyped(text: string): string {
  return text.normalize("NFC").trim().toLowerCase();
}

const NO_VOWEL: readonly string[] = [""];

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

/**
 * Cut a Devanagari string into aksharas and expand each into its variant set.
 * Exported so tests can assert the segmentation itself, not just the verdict.
 */
export function segmentDevanagari(target: string): Akshara[] {
  const s = target.normalize("NFC");
  const out: Akshara[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s.charAt(i);
    const head = consonantAt(s, i);

    if (head !== null) {
      const isInitial = out.length === 0;
      const unitSources: string[] = [];
      const unitVariants: (readonly string[])[] = [];
      let trailingVirama = false;
      let current: ConsonantUnit = head;

      // Consonant cluster: C(+nukta) [ virama C(+nukta) ]*
      for (;;) {
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
      let signVariants: readonly string[] = NO_VOWEL;
      const signHit = SIGNS[s.charAt(i)];
      if (signHit !== undefined) {
        signSource = s.charAt(i);
        signVariants = signHit;
        i += 1;
      }

      const clusterKey = unitSources.join(VIRAMA);
      const override = CLUSTER_OVERRIDES[clusterKey];
      const base: readonly string[] = override ?? product(unitVariants);

      let vowel: readonly string[];
      if (trailingVirama) vowel = NO_VOWEL;
      else if (matraVariants !== undefined) vowel = matraVariants;
      else vowel = isInitial ? INHERENT_A_INITIAL : INHERENT_A;

      out.push({
        source:
          clusterKey + (trailingVirama ? VIRAMA : "") + matraSource + signSource,
        variants: dedupe(product([base, vowel, signVariants])),
      });
      continue;
    }

    const vowelHit = VOWELS[ch];
    if (vowelHit !== undefined) {
      i += 1;
      let signSource = "";
      let signVariants: readonly string[] = NO_VOWEL;
      const signHit = SIGNS[s.charAt(i)];
      if (signHit !== undefined) {
        signSource = s.charAt(i);
        signVariants = signHit;
        i += 1;
      }
      out.push({
        source: ch + signSource,
        variants: dedupe(product([vowelHit, signVariants])),
      });
      continue;
    }

    // Anything else - a space in a multi-word target, a danda, a Latin letter
    // in a mixed string - passes through as itself. Danda also accepts "." and
    // nothing, because no romanized keyboard offers it.
    i += 1;
    if (ch === "।") {
      out.push({ source: ch, variants: [ch, ".", ""] });
    } else {
      out.push({ source: ch, variants: [ch.toLowerCase()] });
    }
  }

  return out;
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
 * Every romanization this target accepts, capped. Used by the table-driven
 * tests and available to the UI as a typing hint. Capped because the product
 * of variant sets grows with akshara count and no caller needs thousands.
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

/**
 * Route a typed word by input method (D46). `latin` and `inscript` compare the
 * committed string directly; only `translit` runs the table.
 */
export function matchesTypedWord(
  typed: string,
  target: string,
  inputMethod: InputMethod,
): boolean {
  if (inputMethod === "translit") return matchesTransliteration(typed, target);
  return normalizeTyped(typed) === normalizeTyped(target);
}
