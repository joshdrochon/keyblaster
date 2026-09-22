import { LANGS, STOP_IDS, type Lang, type StopId } from "../types.js";
import { SHADOW_BANNED_TERMS, scanForBanned } from "./banned.js";
import { parseCoachPayload, VARIANT_COUNT } from "./schema.js";
import { MAX_NOTE_WORDS } from "./validate.js";
import type { CoachPayload } from "./types.js";
import { tokenize } from "../allowlist/index.js";

/**
 * The SHIPPED fallback bundle (D33: "fails silently to the shipped bundle").
 *
 * Every failure mode in AC-15.1 and AC-15.2 lands here, so this is the text a
 * child actually reads whenever the network, the model, or the validator lets
 * us down - which, offline (NFR-2), is always. It is therefore authored
 * content, not filler, and it is held to Shadow's voice rules: short, warm,
 * never "wrong" (D31, D33, story note 6).
 *
 * IT MUST NEVER BE EMPTY. `fallbackFor` is total over (lang, stop): a missing
 * per-stop entry degrades to the language default, and the language table
 * covers all three languages in LANGS. There is no code path that returns an
 * empty note or fewer than two variants.
 *
 * THE BUNDLE IS NOT ITSELF RUN THROUGH THE RUNTIME VALIDATOR. It cannot be:
 * the validator's failure action is "use the fallback", so a fallback that
 * failed validation would leave nothing to show. Instead `fallbackIssues`
 * checks it statically and a unit test fails the build if this text ever drifts
 * out of the FR-15 rules. The allowlist check is deliberately not part of that
 * - the compiled allowlist is content-pipeline output (architecture section 5)
 * and does not exist inside src/engine.
 *
 * Variants are drawn from each stop's warp sentence and asteroid pool
 * (story-draft-v1.md), so they are typeable by construction.
 */

export interface LangFallback {
  /** Used when the stop has no entry. Never absent. */
  readonly base: CoachPayload;
  readonly byStop: Readonly<Partial<Record<StopId, CoachPayload>>>;
  /**
   * What Shadow says when the belt was PERFECT (UR-191).
   *
   * A clean run has no missed word for a live note to name, so the model has
   * nothing to say that is about this child - and a live note cannot be
   * spoken, because D98 only lets a rendered clip through the voice bus.
   * These are authored and rendered, so a perfect run is both personal and
   * heard. Optional: es and hi are cut (D95) and fall back to `byStop`.
   */
  readonly cleanByStop?: Readonly<Partial<Record<StopId, CoachPayload>>>;
}

export interface FallbackBundle {
  readonly byLang: Readonly<Record<Lang, LangFallback>>;
}

const EN: LangFallback = {
  base: {
    note: "Good flying, pilot. Let's take the next belt a little slower together.",
    variants: ["The map goes on from here.", "One more light on the way."],
  },
  byStop: {
    // Earth has no belt (D57), so this entry should be unreachable in play.
    // It exists so the table is total and a bug cannot produce an empty note.
    earth: {
      note: "Beacon is awake. Nice and steady, pilot. Now let's go draw the map.",
      variants: ["Earth already has a beacon.", "Every map starts with a home."],
    },
    mars: {
      note: "Good flying, pilot. Let's take the red dust a little slower next time.",
      variants: ["Mars is the red planet.", "Its dust is full of rust."],
    },
    jupiter: {
      note: "Nice run. Keep your eyes on the words, not on the big storm.",
      variants: [
        "Jupiter is the biggest planet of all.",
        "It has no ground to land on.",
      ],
    },
    saturn: {
      note: "Steady hands, pilot. We threaded the rings. Let's do that again.",
      variants: [
        "Saturn wears rings made of ice and rock.",
        "Fly between the rings, not through them.",
      ],
    },
    uranus: {
      note: "Everything out here is tilted. You read it anyway. Nice work, pilot.",
      variants: [
        "Uranus is a planet that spins on its side.",
        "It rolls like a ball on its side.",
      ],
    },
    neptune: {
      note: "Steady hands out here. The rocks come faster now. You kept up.",
      variants: [
        "Neptune is deep blue and very far from the Sun.",
        "Its winds blow faster than a jet plane.",
      ],
    },
    pluto: {
      note: "Last belt, last beacon. Everything you typed got us here, pilot.",
      variants: [
        "Pluto is small, cold, and far away.",
        "This is the last stop on the map.",
      ],
    },
  },
  cleanByStop: {
    earth: {
      note: "Beacon is awake and not one letter got away. Let's go draw the map.",
      variants: ["Earth already has a beacon.", "Every map starts with a home."],
    },
    mars: {
      note: "Not one word got past you, pilot. The red dust never even slowed you down.",
      variants: ["Mars is the red planet.", "Its dust is full of rust."],
    },
    jupiter: {
      note: "Every word, first try. The big storm never once took your eyes off the line.",
      variants: [
        "Jupiter is the biggest planet of all.",
        "It has no ground to land on.",
      ],
    },
    saturn: {
      note: "Clean the whole way through. You held the line while the rings went by.",
      variants: [
        "Saturn wears rings made of ice and rock.",
        "Fly between the rings, not through them.",
      ],
    },
    uranus: {
      note: "Not one word got past you. You flew a whole belt on its side with me.",
      variants: ["Uranus spins on its side.", "Everything out here is tilted."],
    },
    neptune: {
      note: "Every single word. Out here in the deep dark, that is real flying.",
      variants: ["Neptune is deep blue and very far.", "The wind out here is the fastest."],
    },
    pluto: {
      note: "The last belt, and not one word got past you. Look how far you have come.",
      variants: ["Pluto is small and very cold.", "This is the last stop on the map."],
    },
  },
};

/**
 * es and hi carry the language default only. Per-stop translations are
 * content-pipeline output (architecture section 5: generated, allowlist-
 * checked, human-reviewed) and do not belong hard-coded in the engine. The
 * bundle is still total for those languages, which is what AC-15.1 needs.
 */
const ES: LangFallback = {
  base: {
    note: "Buen vuelo, piloto. Vamos a tomar el siguiente cinturon con mas calma.",
    variants: ["El mapa sigue desde aqui.", "Una luz mas en el camino."],
  },
  byStop: {},
};

const HI: LangFallback = {
  base: {
    note: "अच्छी उड़ान, पायलट। अगली पट्टी थोड़ा धीरे चलते हैं।",
    variants: ["नक्शा यहाँ से आगे बढ़ता है।", "रास्ते में एक और रोशनी।"],
  },
  byStop: {},
};

export const DEFAULT_FALLBACK_BUNDLE: FallbackBundle = {
  byLang: { en: EN, es: ES, hi: HI },
};

/**
 * Total lookup: (bundle, lang, stop) -> a payload, always. The per-stop entry
 * wins; otherwise the language default.
 */
export function fallbackFor(
  bundle: FallbackBundle,
  lang: Lang,
  stopId: StopId,
): CoachPayload {
  const forLang = bundle.byLang[lang];
  return forLang.byStop[stopId] ?? forLang.base;
}

// ---------------------------------------------------------------------------
// Shadow's RECORDED fallback notes (D63, D88; AC-21.5, AC-21.6)
// ---------------------------------------------------------------------------

/**
 * ============ THE COACH NOTE IS NOT ONE LINE, AND IT IS NOT INFINITE ============
 *
 * The pre-render pass skipped the coach note as "runtime LLM text, unrenderable
 * by construction". That is true of a LIVE note and false of the note a child
 * actually hears: `/api/coach` is behind a 4500 ms deadline with THIS BUNDLE
 * behind it (D33), and with no proxy deployed every warp break lands here. A
 * finite, authored, shipped set of strings was classified as infinite, so the
 * one line Shadow says every single break was the only one in the game spoken
 * by the system voice while the other 34 played as him.
 *
 * So these notes get rendered too, and the id space is THE BUNDLE'S OWN SHAPE -
 * `byLang[lang]` crossed with `base` and `byStop[stopId]` - because that is the
 * structure the text is authored in and inventing a second scheme on top of it
 * is how the first render pass produced 28 files nobody ever spoke.
 *
 * THE LOOKUP KEYS ON THE LINE, NOT ON THE CALL SITE. `WarpScene` hands the
 * voice path the id `warp.coachNote`, which is the id of a SITE - one screen -
 * and not of any particular sentence; a file named after it could only ever be
 * one of the eight. `fallbackNoteClipId` therefore resolves the TEXT back to
 * the bundle entry it came from, which has three consequences worth stating:
 *
 *   1. a note from the real LLM matches nothing and returns null, so it falls
 *      through to Web Speech - which is correct, because that text genuinely
 *      cannot be recorded in advance;
 *   2. nothing has to be threaded through `speakNote`, `CoachResult.source` or
 *      the scene, so no call site can forget to pass it and silently lose the
 *      clip - the defect this whole area keeps producing;
 *   3. it stays honest if the bundle is edited: change a word and the id stops
 *      resolving to the stale recording rather than playing the old sentence
 *      over the new text.
 */
export const FALLBACK_CLIP_PREFIX = "coach.fallback";

/** UR-191: the perfect-run lines live in their own id space. */
export const CLEAN_CLIP_PREFIX = "coach.clean";

/** The key the LANGUAGE DEFAULT is rendered under; `byStop` uses the stop id. */
export const FALLBACK_CLIP_BASE_KEY = "base";

/** One renderable fallback note, with the id derived from where it lives. */
export interface FallbackNoteLine {
  /** `coach.fallback.<lang>.<stopId|base>`. The voice-clip id. */
  readonly id: string;
  readonly lang: Lang;
  /** null for `byLang[lang].base` - the language default. */
  readonly stopId: StopId | null;
  readonly note: string;
}

/** The id for one slot of the bundle. The ONE place the shape becomes a string. */
export function fallbackClipId(lang: Lang, stopId: StopId | null): string {
  return `${FALLBACK_CLIP_PREFIX}.${lang}.${stopId ?? FALLBACK_CLIP_BASE_KEY}`;
}

/** UR-191: the clip for a perfect run at this stop. */
export function cleanClipId(lang: Lang, stopId: StopId): string {
  return `${CLEAN_CLIP_PREFIX}.${lang}.${stopId}`;
}

/** What Shadow says for a perfect belt here, or undefined if none is authored. */
export function cleanNoteFor(
  lang: Lang,
  stopId: StopId,
  bundle: FallbackBundle = DEFAULT_FALLBACK_BUNDLE,
): string | undefined {
  return bundle.byLang[lang].cleanByStop?.[stopId]?.note;
}

/**
 * Every note in the bundle, in a stable order, with its id.
 *
 * This is what the render script collects and what the id-space test checks the
 * manifest against, so the recordings and the runtime lookup are reading the
 * SAME structure rather than two copies of a list. Variants are absent on
 * purpose: Shadow speaks the note (`WarpScene.showNote`), the variants are
 * typed, and a rendered variant would be money spent on silence.
 */
export function fallbackNoteLines(
  bundle: FallbackBundle = DEFAULT_FALLBACK_BUNDLE,
): FallbackNoteLine[] {
  const lines: FallbackNoteLine[] = [];
  for (const lang of LANGS) {
    const forLang = bundle.byLang[lang];
    lines.push({ id: fallbackClipId(lang, null), lang, stopId: null, note: forLang.base.note });
    for (const stopId of STOP_IDS) {
      const entry = forLang.byStop[stopId];
      if (entry === undefined) continue;
      lines.push({ id: fallbackClipId(lang, stopId), lang, stopId, note: entry.note });
    }
    // UR-191: rendered like any other shipped line, so D98 holds for them too.
    for (const stopId of STOP_IDS) {
      const entry = forLang.cleanByStop?.[stopId];
      if (entry === undefined) continue;
      lines.push({ id: cleanClipId(lang, stopId), lang, stopId, note: entry.note });
    }
  }
  return lines;
}

/** Whitespace is display noise; the words are the line. */
const normalizeNote = (text: string): string => text.trim().replace(/\s+/g, " ");

/**
 * The clip id for a note, or null when this text was not written by us.
 *
 * Null is the COMMON, correct answer for a live note and the reason the voice
 * path still degrades to Web Speech exactly as it always has.
 */
export function fallbackNoteClipId(
  note: string,
  bundle: FallbackBundle = DEFAULT_FALLBACK_BUNDLE,
): string | null {
  if (typeof note !== "string") return null;
  const wanted = normalizeNote(note);
  if (wanted.length === 0) return null;
  for (const line of fallbackNoteLines(bundle)) {
    if (normalizeNote(line.note) === wanted) return line.id;
  }
  return null;
}

/**
 * Static audit of a bundle. Returns a list of human-readable problems; an
 * empty list means the bundle satisfies FR-15's shape, the 20-word note limit
 * and the banned-term rules. Used by the unit test that guards the shipped
 * text, and available to the content pipeline for authored bundles.
 */
export function fallbackIssues(
  bundle: FallbackBundle,
  maxNoteWords: number = MAX_NOTE_WORDS,
): string[] {
  const issues: string[] = [];

  const audit = (label: string, payload: CoachPayload, lang: Lang): void => {
    if (parseCoachPayload(payload) === null) {
      issues.push(`${label}: does not match the ${VARIANT_COUNT}-variant schema`);
      return;
    }
    const words = tokenize(payload.note, lang).length;
    if (words > maxNoteWords) {
      issues.push(`${label}: note is ${words} words, limit ${maxNoteWords}`);
    }
    for (const text of [payload.note, ...payload.variants]) {
      const hit = scanForBanned(text, lang, SHADOW_BANNED_TERMS);
      if (hit !== null) {
        issues.push(`${label}: "${hit.term}" (${hit.reason}) in "${text}"`);
      }
    }
  };

  for (const lang of LANGS) {
    const forLang = bundle.byLang[lang];
    audit(`${lang}.base`, forLang.base, lang);
    for (const stopId of STOP_IDS) {
      const entry = forLang.byStop[stopId];
      if (entry !== undefined) audit(`${lang}.${stopId}`, entry, lang);
    }
  }

  return issues;
}
