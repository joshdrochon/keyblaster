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
