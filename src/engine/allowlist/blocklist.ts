/**
 * Blocklist (D34, PRD FR-13 / AC-13.2).
 *
 * This is the BACKUP layer, not the working one. The graded allowlist does the
 * real work: a word only reaches the screen if it is explicitly on the list.
 * The blocklist exists so a bug in allowlist compilation cannot ship one of
 * these, and so AC-13.2 has something concrete to assert against.
 *
 * "liquor" is here on purpose: Type Storm ships it to grades 3-12 in its boss
 * pangram "pack my box with five dozen liquor jugs" (decision log, Type Storm
 * reference). It is the worked example in D34.
 *
 * TWO TIERS, because a naive prefix rule silently eats real vocabulary:
 *   - PREFIX stems are unambiguous, so inflections are caught ("drunken").
 *   - EXACT stems are mild, short, or share a prefix with an ordinary word,
 *     so they match whole words only.
 *
 * Words that forced the split, all of which a prefix rule would have wrongly
 * blocked: ammonia (ammo), methane (meth), hello (hell), stable (stab),
 * arsenic (arse), ginger (gin), heroine (heroin). Two of those - ammonia and
 * methane - are Pluto/Kuiper debris words in our own content (PRD FR-12b).
 */

/** Unambiguous stems: matched as a whole word or as a prefix. */
const BLOCKED_PREFIX: readonly string[] = [
  // alcohol
  "alcohol",
  "beer",
  "booze",
  "brandy",
  "cocktail",
  "drunk",
  "liquor",
  "tequila",
  "vodka",
  "whiskey",
  "whisky",
  "wine",
  // drugs
  "cigarette",
  "cocaine",
  "drug",
  "marijuana",
  "nicotine",
  "opioid",
  "tobacco",
  "vape",
  // weapons as violence (the blaster is a light, never a gun - design brief)
  "bullet",
  "kill",
  "knife",
  "murder",
  "pistol",
  "rifle",
  "shoot",
  "shotgun",
  "slaughter",
  "suicide",
  "sword",
  "weapon",
  // profanity and slurs
  "bastard",
  "bitch",
  "bollock",
  "crap",
  "cunt",
  "fuck",
  "nigg",
  "piss",
  "prick",
  "pussy",
  "retard",
  "shit",
  "slut",
  "twat",
  "whore",
];

/**
 * Whole-word-only stems. Each entry here exists because prefix matching it
 * would block an ordinary word; inflections are spelled out instead.
 */
const BLOCKED_EXACT: readonly string[] = [
  // "ammo" -> ammonia (Pluto debris, PRD FR-12b)
  "ammo",
  "ammos",
  // "meth" -> methane (Pluto debris, PRD FR-12b)
  "meth",
  "meths",
  // "hell" -> hello
  "hell",
  "hells",
  // "stab" -> stable
  "stab",
  "stabs",
  "stabbed",
  "stabbing",
  // "arse" -> arsenic, arsenal
  "arse",
  "arses",
  // "heroin" -> heroine
  "heroin",
  // "gin" -> ginger
  "gin",
  "gins",
  // short or ambiguous everyday words
  "ass",
  "asses",
  "damn",
  "damned",
  "dick",
  "dicks",
  "fag",
  "fags",
  "gun",
  "guns",
  "gunfire",
  "gunshot",
  "joint",
  "joints",
  "rum",
  "smoke",
  "smoked",
  "smoking",
  "weed",
  "weeds",
];

/** Minimum stem length before prefix matching is allowed at all. */
const PREFIX_MIN = 4;

const EXACT = new Set<string>([...BLOCKED_EXACT, ...BLOCKED_PREFIX]);
const PREFIXES = BLOCKED_PREFIX.filter((s) => s.length >= PREFIX_MIN);

/**
 * True if `normalized` is blocked. Expects an already-normalised word
 * (see `normalizeWord`); passing raw input will under-match.
 */
export function isBlocked(normalized: string): boolean {
  if (normalized.length === 0) return false;
  if (EXACT.has(normalized)) return true;
  return PREFIXES.some((stem) => normalized.startsWith(stem));
}

/** Every blocked stem, for tests and for the compile-allowlist script. */
export function blockedStems(): readonly string[] {
  return [...BLOCKED_EXACT, ...BLOCKED_PREFIX];
}

/** The prefix-matched subset, exposed so tests can assert the tier split. */
export function blockedPrefixStems(): readonly string[] {
  return BLOCKED_PREFIX;
}
