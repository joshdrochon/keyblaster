import { createAllowlist, type Allowlist } from "@engine/allowlist";
import { STOP_IDS, type Lang } from "@engine/types";
import { hasStageBundle, stageBundle } from "../lib/content";

/**
 * The allowlist the coach validator is handed (D34, AC-15.2).
 *
 * `createCoachValidator` needs an `Allowlist`, and `scripts/compile-allowlist`
 * (architecture 5.2) has not run yet, so there is no compiled Fry-1000 on disk.
 * This builds the nearest honest thing out of content that IS shipped:
 *
 *   - every stage bundle's typeable pool, all seven stops
 *   - every stage bundle's `properNouns`, readable-only (story note 4)
 *   - `content/en/sight-words.json`, which the content lane describes as "a
 *     hand-curated stand-in for the Fry-1000 list that compile-allowlist will
 *     emit"
 *   - the words Shadow can say that are in neither: the vocabulary of
 *     `engine/coach/fallback.ts`'s shipped bundle and `engine/coach/mock.ts`'s
 *     templates, which live in the engine rather than in content
 *
 * WHEN `compile-allowlist` LANDS, delete this file and pass the compiled list.
 * Nothing else depends on it; `coachAllowlist` is handed to the validator and
 * nowhere else.
 *
 * A language with no compiled list gets an empty one, so its coach note fails
 * gate 2 and lands on the shipped fallback. That is AC-15.2 working, not a hole
 * in D34: an unchecked note is never shown.
 */

const SIGHT_MODULES = import.meta.glob("../../../content/en/sight-words.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function sightWords(): string[] {
  for (const value of Object.values(SIGHT_MODULES)) {
    if (typeof value !== "object" || value === null) continue;
    const words = (value as Record<string, unknown>)["words"];
    if (Array.isArray(words)) {
      return words.filter((w): w is string => typeof w === "string");
    }
  }
  return [];
}

/**
 * Words Shadow can say that no content file carries, because the coach's
 * shipped fallback bundle and its mock templates live in `src/engine/coach`.
 * Read out of those two files; a word missing here turns a good note into a
 * fallback for no reason.
 *
 * Six words were missing. "do" and "goes" are in the SHIPPED FALLBACK's own
 * Saturn and base notes, which is a contradiction the code could not detect:
 * the fallback bypasses the validator by necessity, so Shadow's safety net was
 * carrying words Shadow is not allowed to say.
 *
 * "an", "how", "let" and "take" were missing, and the cost was invisible until
 * the belt started handing the coach real missed words (D09): MockCoach's
 * one-missed template is `Good run. Let us take "{a}" a little slower.`, which
 * failed the allowlist gate on two ordinary Fry-100 words and silently became
 * the shipped fallback - so AC-15.5 ("a note that names those words") could
 * never hold. `tests/unit/coach/voice.test.ts` now pins the whole set, so the
 * next template edit fails a test instead of quietly degrading the note.
 */
const SHADOW_VOICE_EN: readonly string[] = [
  "again", "an", "anyway", "awake", "belt", "clean", "do", "down", "draw",
  "drawn", "everything", "eye", "eyes", "flying", "gets", "goes", "good",
  "got", "had", "hands", "here", "home", "how", "kept", "let", "let's",
  "little", "me", "moment", "next", "nice", "past", "read", "rocks", "slow",
  "slower", "starts", "steady", "take", "threaded", "tilted", "together",
  "took", "try", "typed", "us", "was", "watch", "way", "word", "words",
  "work", "your", "yours",
];

const CACHE = new Map<Lang, Allowlist>();

function buildEnglish(): Allowlist {
  const words = new Set<string>(sightWords());
  const properNouns = new Set<string>();
  for (const stopId of STOP_IDS) {
    if (!hasStageBundle(stopId)) continue;
    const bundle = stageBundle(stopId);
    for (const word of bundle.pool) words.add(word);
    for (const noun of bundle.properNouns) properNouns.add(noun);
  }
  for (const word of SHADOW_VOICE_EN) words.add(word);
  return createAllowlist({ lang: "en", words, properNouns });
}

export function coachAllowlist(lang: Lang): Allowlist {
  const cached = CACHE.get(lang);
  if (cached) return cached;
  const built =
    lang === "en" ? buildEnglish() : createAllowlist({ lang, words: [] });
  CACHE.set(lang, built);
  return built;
}
