import {
  DEFAULT_CALIBRATION,
  DEFAULT_SETTINGS,
  EASE_MAX,
  EASE_MIN,
  EASE_NEW,
  LANGS,
  STOP_IDS,
  type Calibration,
  type InputMethod,
  type KeyboardLayout,
  type Lang,
  type Profile,
  type Settings,
  type Stars,
  type StopProgress,
  type WordRecord,
  isLang,
  isStopId,
} from "../types.js";
import { SAMPLE_CAP } from "../words/index.js";
import {
  DEFAULT_KNOBS,
  asLengthBias,
  clampKnobs,
  type Knobs,
} from "../controller/knobs.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The one key this module owns (architecture section 7).
 *
 * NOTE the "v1" in the key is NOT the schema version - the schema version lives
 * inside the payload so that forward migrations can run without the key moving
 * (a key rename would strand every existing player's data, which is exactly
 * what migrations exist to avoid). See the report note in SCHEMA_VERSION.
 */
export const STORAGE_KEY = "kb:v1:profiles";

/**
 * Where an unreadable payload is parked before we write a fresh one.
 *
 * AC-18.4 demands a fresh profile on corruption. It does not demand that the
 * corrupt bytes be destroyed, and destroying them makes a future recovery path
 * (or a bug report) impossible. Quarantine is best-effort: if the write throws,
 * we carry on, because nothing here may block a child from playing.
 */
export const QUARANTINE_KEY = `${STORAGE_KEY}:quarantine`;

/**
 * Payload schema version.
 *
 * v1 - the original shape.
 * v2 - WordRecord gained `firstFkLatencyMs` (AC-20.3 needs the first-ever
 *      exposure, which the capped rolling window cannot answer) and
 *      StopProgress gained `lastWpm`/`lastAccuracy` (AC-20.1 compares against
 *      the previous stage's RESULT, not its all-time best).
 *
 * Adding v3 is one function in migrations.ts plus this number.
 */
export const SCHEMA_VERSION = 3;

/** Ship name default, fixed by C07 / AC-6b.1. */
export const DEFAULT_SHIP_NAME = "Lantern";

/**
 * Identity defaults. The avatar and ship id sets are owned by the game layer
 * (design brief screen 2); persistence only ever stores the chosen string, so a
 * new avatar never needs a migration.
 */
export const DEFAULT_AVATAR = "avatar-1";
export const DEFAULT_SHIP_ID = "ship-1";

/**
 * Name given to the profile handed back after corruption. Not user-facing text
 * in the i18n sense - the game is free to route the player to the profile
 * screen and rename it - but it must be a usable name if it is ever shown.
 */
export const DEFAULT_PROFILE_NAME = "Pilot";

/** Upper bound on a stored name. Long enough for any real name, short enough
 * that a fuzzed 10 MB string cannot be written back to a 5 MB quota. */
export const MAX_NAME_LENGTH = 24;

/** Upper bound on any stored opaque id (avatar, ship, skin, trophy, word). */
export const MAX_ID_LENGTH = 64;

/** Upper bound on collection sizes we will re-persist from a stored payload. */
export const MAX_COLLECTION = 512;

// ---------------------------------------------------------------------------
// The persisted state
// ---------------------------------------------------------------------------

/** Everything under STORAGE_KEY, decoded. */
export interface PersistedState {
  version: number;
  profiles: Profile[];
  /** null is legal and usable: it means "no profile selected yet". */
  activeProfileId: string | null;
}

/**
 * Every repair made while decoding. Bounded, because a deeply garbage payload
 * would otherwise produce a note per field and turn a notice into a memory leak.
 */
export interface RepairLog {
  count: number;
  paths: string[];
}

const MAX_REPAIR_PATHS = 16;

export function newRepairLog(): RepairLog {
  return { count: 0, paths: [] };
}

export function repaired(log: RepairLog, path: string): void {
  log.count += 1;
  if (log.paths.length < MAX_REPAIR_PATHS) log.paths.push(path);
}

// ---------------------------------------------------------------------------
// Coercion primitives. None of these throw; each takes a fallback.
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A number we are willing to persist. Rejects NaN and +/-Infinity explicitly:
 * JSON.parse("1e999") yields Infinity without error, and JSON.stringify turns
 * both back into `null`, so a single unchecked Infinity silently rewrites a
 * number field into a null on the next save.
 */
export function finiteNumber(value: unknown, fallback: number, log: RepairLog, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  repaired(log, path);
  return fallback;
}

export function clampedNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  log: RepairLog,
  path: string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= min && value <= max) return value;
    repaired(log, path);
    return Math.min(max, Math.max(min, value));
  }
  repaired(log, path);
  return fallback;
}

/** Non-negative integer counter (exposures, hits, stage indices). */
export function counter(value: unknown, log: RepairLog, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const i = Math.floor(value);
    if (i === value) return i;
    repaired(log, path);
    return i;
  }
  repaired(log, path);
  return 0;
}

export function finiteOrNull(value: unknown, log: RepairLog, path: string): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  repaired(log, path);
  return null;
}

export function boundedString(
  value: unknown,
  max: number,
  fallback: string,
  log: RepairLog,
  path: string,
): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= max) return trimmed;
    if (trimmed.length > max) {
      repaired(log, path);
      return trimmed.slice(0, max);
    }
  }
  repaired(log, path);
  return fallback;
}

export function boolean(value: unknown, fallback: boolean, log: RepairLog, path: string): boolean {
  if (typeof value === "boolean") return value;
  repaired(log, path);
  return fallback;
}

/** Deduplicated list of short opaque ids (trophies, skins, ships). */
export function idList(value: unknown, log: RepairLog, path: string): string[] {
  if (!Array.isArray(value)) {
    repaired(log, path);
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_COLLECTION)) {
    if (typeof item !== "string") {
      repaired(log, path);
      continue;
    }
    const id = item.trim().slice(0, MAX_ID_LENGTH);
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (value.length > MAX_COLLECTION) repaired(log, path);
  return out;
}

/** Rolling timing sample window; keeps the NEWEST entries, like pushCapped. */
export function sampleList(value: unknown, log: RepairLog, path: string): number[] {
  if (!Array.isArray(value)) {
    repaired(log, path);
    return [];
  }
  const kept: number[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isFinite(item)) kept.push(item);
    else repaired(log, path);
  }
  if (kept.length <= SAMPLE_CAP) return kept;
  repaired(log, path);
  return kept.slice(kept.length - SAMPLE_CAP);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  log: RepairLog,
  path: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  repaired(log, path);
  return fallback;
}

const KEYBOARD_LAYOUTS: readonly KeyboardLayout[] = ["qwerty", "azerty", "qwertz", "dvorak"];
const INPUT_METHODS: readonly InputMethod[] = ["latin", "translit", "inscript"];

// ---------------------------------------------------------------------------
// Blank records
// ---------------------------------------------------------------------------

/** All seven stops in route order (D56, D57). Earth is index 0 and has no belt. */
export function blankProgress(): StopProgress[] {
  return STOP_IDS.map((stopId) => ({
    stopId,
    cleared: false,
    stars: 0 as Stars,
    bestWpm: 0,
    bestAccuracy: 0,
    lastWpm: 0,
    lastAccuracy: 0,
    beaconPlacedAt: null,
  }));
}

export interface NewProfileInput {
  id: string;
  createdAt: number;
  name?: string;
  avatar?: string;
  shipId?: string;
  shipName?: string;
  settings?: Partial<Settings>;
  calibration?: Calibration;
}

/**
 * A brand-new pilot (D43). Name + avatar + a ship they named: no email, no
 * birthday, no contact field of any kind, by construction (AC-18.2, NFR-3).
 */
export function blankProfile(input: NewProfileInput): Profile {
  const shipId = input.shipId ?? DEFAULT_SHIP_ID;
  return {
    id: input.id,
    name: (input.name ?? DEFAULT_PROFILE_NAME).trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_PROFILE_NAME,
    avatar: input.avatar ?? DEFAULT_AVATAR,
    shipId,
    shipName: input.shipName ?? DEFAULT_SHIP_NAME,
    createdAt: input.createdAt,
    calibration: { ...DEFAULT_CALIBRATION, ...input.calibration },
    // D18's cold start, and UR-51's safety floor, in one line. A fresh pilot
    // opens at `MAX_LIVE_MIN`, where `concurrencyTarget` is exactly 1: the fall
    // budget is FR-8's literal formula and the belt holds no standing queue.
    // Difficulty increases only as the player gets better, and on a first belt
    // the game has never watched them.
    knobs: DEFAULT_KNOBS,
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    progress: blankProgress(),
    trophies: [],
    unlockedShips: [shipId],
    unlockedSkins: [],
    words: {},
  };
}

/**
 * D41 "reset progress". Keeps who the pilot is (id, name, avatar, ship, the
 * settings they chose) and their typing calibration, which is a measurement of
 * the child rather than a reward. Everything earned goes back to zero: map
 * progress, beacons, trophies, skins, the word book, and every ship except the
 * one they are flying.
 */
export function resetProfileProgress(profile: Profile): Profile {
  return {
    ...profile,
    progress: blankProgress(),
    // Earned, so it goes back to the cold start (UR-51). `calibration` above is
    // deliberately kept: a baseline is a measurement OF the child and is still
    // true after a reset, while a difficulty step is something they worked up
    // to and a reset is a request to work up to it again.
    knobs: DEFAULT_KNOBS,
    trophies: [],
    unlockedShips: [profile.shipId],
    unlockedSkins: [],
    words: {},
  };
}

// ---------------------------------------------------------------------------
// Decoding: unknown -> Profile. Nothing throws; bad fields are replaced.
// ---------------------------------------------------------------------------

function decodeCalibration(raw: unknown, log: RepairLog, path: string): Calibration {
  const o = isPlainObject(raw) ? raw : (repaired(log, path), {});
  return {
    // Fall time divides by iki (FR-8), so a zero or negative iki is not a
    // cosmetic defect: it produces Infinity fall times. Floor at 1 ms.
    ikiMs: clampedNumber(o["ikiMs"], 1, 60_000, DEFAULT_CALIBRATION.ikiMs, log, `${path}.ikiMs`),
    fkLatencyMs: clampedNumber(
      o["fkLatencyMs"],
      0,
      60_000,
      DEFAULT_CALIBRATION.fkLatencyMs,
      log,
      `${path}.fkLatencyMs`,
    ),
  };
}

/**
 * Difficulty knobs off a stored payload (UR-51).
 *
 * `clampKnobs` is the engine's own repair rule and it is reused rather than
 * reimplemented, so a corrupt knob can never mean two different things in two
 * places. What this adds is the REPAIR LOG: a knob outside FR-10's 2..7, or a
 * lengthBias that is not -1/0/+1, is a payload we changed, and the load notice
 * has to say so like every other repaired field.
 *
 * A missing block decodes to `DEFAULT_KNOBS` WITHOUT logging a repair - that is
 * what every profile written before this field existed looks like, and the v3
 * migration has already supplied it. Logging it would make every upgraded
 * profile report damage it did not take.
 */
function decodeKnobs(raw: unknown, log: RepairLog, path: string): Knobs {
  if (raw === undefined) return DEFAULT_KNOBS;
  if (!isPlainObject(raw)) {
    repaired(log, path);
    return DEFAULT_KNOBS;
  }
  // The RAW numbers, before any narrowing. Comparing the clamped pair against
  // an already-narrowed one is how the lengthBias repair went unreported: the
  // first draft ran `asLengthBias` here, so `wanted.lengthBias` was in range by
  // the time it was compared and the notice never fired. Coverage found it -
  // the branch was unreachable - and it was a real defect, not a missing test:
  // a stored lengthBias of 7 was silently rewritten and the child's load
  // reported nothing.
  const rawMaxLive = finiteNumber(raw["maxLive"], DEFAULT_KNOBS.maxLive, log, `${path}.maxLive`);
  const rawBias = finiteNumber(raw["lengthBias"], DEFAULT_KNOBS.lengthBias, log, `${path}.lengthBias`);
  const clamped = clampKnobs({ maxLive: rawMaxLive, lengthBias: asLengthBias(rawBias) });
  if (clamped.maxLive !== rawMaxLive) repaired(log, `${path}.maxLive`);
  if (clamped.lengthBias !== rawBias) repaired(log, `${path}.lengthBias`);
  return clamped;
}

function decodeSettings(raw: unknown, log: RepairLog, path: string): Settings {
  const o = isPlainObject(raw) ? raw : (repaired(log, path), {});
  return {
    musicVolume: clampedNumber(o["musicVolume"], 0, 1, DEFAULT_SETTINGS.musicVolume, log, `${path}.musicVolume`),
    sfxVolume: clampedNumber(o["sfxVolume"], 0, 1, DEFAULT_SETTINGS.sfxVolume, log, `${path}.sfxVolume`),
    keyboardLayout: oneOf(o["keyboardLayout"], KEYBOARD_LAYOUTS, DEFAULT_SETTINGS.keyboardLayout, log, `${path}.keyboardLayout`),
    uiLang: oneOf(o["uiLang"], LANGS, DEFAULT_SETTINGS.uiLang, log, `${path}.uiLang`),
    contentLang: oneOf(o["contentLang"], LANGS, DEFAULT_SETTINGS.contentLang, log, `${path}.contentLang`),
    inputMethod: oneOf(o["inputMethod"], INPUT_METHODS, DEFAULT_SETTINGS.inputMethod, log, `${path}.inputMethod`),
    uppercase: boolean(o["uppercase"], DEFAULT_SETTINGS.uppercase, log, `${path}.uppercase`),
    increasedLetterSpacing: boolean(o["increasedLetterSpacing"], DEFAULT_SETTINGS.increasedLetterSpacing, log, `${path}.increasedLetterSpacing`),
    reducedMotion: boolean(o["reducedMotion"], DEFAULT_SETTINGS.reducedMotion, log, `${path}.reducedMotion`),
    colorblindPalette: boolean(o["colorblindPalette"], DEFAULT_SETTINGS.colorblindPalette, log, `${path}.colorblindPalette`),
    relativeBoard: boolean(o["relativeBoard"], DEFAULT_SETTINGS.relativeBoard, log, `${path}.relativeBoard`),
  };
}

function decodeStars(raw: unknown, log: RepairLog, path: string): Stars {
  const n = clampedNumber(raw, 0, 3, 0, log, path);
  const i = Math.round(n);
  if (i !== n) repaired(log, path);
  return i as Stars;
}

/**
 * Progress is normalised to exactly one entry per stop, in route order. A
 * stored payload that is missing Mars, lists Mars twice, or carries a stop id
 * from a future build all decode to the same predictable seven rows, which is
 * what lets the Director map index by stage without defensive code.
 */
function decodeProgress(raw: unknown, log: RepairLog, path: string): StopProgress[] {
  const byStop = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const entry of raw.slice(0, MAX_COLLECTION)) {
      if (!isPlainObject(entry)) {
        repaired(log, path);
        continue;
      }
      const stopId = entry["stopId"];
      if (typeof stopId !== "string" || !isStopId(stopId)) {
        repaired(log, path);
        continue;
      }
      if (byStop.has(stopId)) repaired(log, `${path}.${stopId}`);
      byStop.set(stopId, entry);
    }
  } else if (raw !== undefined) {
    repaired(log, path);
  }

  return STOP_IDS.map((stopId) => {
    const o = byStop.get(stopId);
    if (o === undefined) {
      return {
        stopId,
        cleared: false,
        stars: 0 as Stars,
        bestWpm: 0,
        bestAccuracy: 0,
        lastWpm: 0,
        lastAccuracy: 0,
        beaconPlacedAt: null,
      };
    }
    const p = `${path}.${stopId}`;
    return {
      stopId,
      cleared: boolean(o["cleared"], false, log, `${p}.cleared`),
      stars: decodeStars(o["stars"], log, `${p}.stars`),
      // WPM has no meaningful ceiling in the PRD; 0..2000 is a sanity bound that
      // cannot be reached by a child and cannot be reached by a typo either.
      bestWpm: clampedNumber(o["bestWpm"], 0, 2000, 0, log, `${p}.bestWpm`),
      bestAccuracy: clampedNumber(o["bestAccuracy"], 0, 1, 0, log, `${p}.bestAccuracy`),
      lastWpm: clampedNumber(o["lastWpm"], 0, 2000, 0, log, `${p}.lastWpm`),
      lastAccuracy: clampedNumber(o["lastAccuracy"], 0, 1, 0, log, `${p}.lastAccuracy`),
      beaconPlacedAt: finiteOrNull(o["beaconPlacedAt"], log, `${p}.beaconPlacedAt`),
    };
  });
}

function decodeWordRecord(raw: unknown, log: RepairLog, path: string): WordRecord {
  const o = isPlainObject(raw) ? raw : (repaired(log, path), {});
  return {
    exposures: counter(o["exposures"], log, `${path}.exposures`),
    hits: counter(o["hits"], log, `${path}.hits`),
    misses: counter(o["misses"], log, `${path}.misses`),
    typos: counter(o["typos"], log, `${path}.typos`),
    fkLatencyMs: sampleList(o["fkLatencyMs"], log, `${path}.fkLatencyMs`),
    ikiMs: sampleList(o["ikiMs"], log, `${path}.ikiMs`),
    firstFkLatencyMs: finiteOrNull(o["firstFkLatencyMs"], log, `${path}.firstFkLatencyMs`),
    ease: clampedNumber(o["ease"], EASE_MIN, EASE_MAX, EASE_NEW, log, `${path}.ease`),
    lastSeen: finiteOrNull(o["lastSeen"], log, `${path}.lastSeen`),
    nextEligibleStage: counter(o["nextEligibleStage"], log, `${path}.nextEligibleStage`),
  };
}

/**
 * words[lang][word]. Only the three shipped languages survive decoding (D45):
 * an unknown top-level key is either garbage or data from a build that does not
 * exist yet, and in both cases carrying it forward would let a fuzzed payload
 * grow without bound.
 */
function decodeWords(raw: unknown, log: RepairLog, path: string): Record<string, Record<string, WordRecord>> {
  const out: Record<string, Record<string, WordRecord>> = {};
  if (!isPlainObject(raw)) {
    if (raw !== undefined) repaired(log, path);
    return out;
  }
  for (const lang of LANGS) {
    const book = raw[lang];
    if (book === undefined) continue;
    if (!isPlainObject(book)) {
      repaired(log, `${path}.${lang}`);
      continue;
    }
    const decoded: Record<string, WordRecord> = {};
    let n = 0;
    for (const [word, record] of Object.entries(book)) {
      if (word.length === 0 || word.length > MAX_ID_LENGTH) {
        repaired(log, `${path}.${lang}`);
        continue;
      }
      if (n >= MAX_COLLECTION * 8) {
        repaired(log, `${path}.${lang}`);
        break;
      }
      decoded[word] = decodeWordRecord(record, log, `${path}.${lang}.${word}`);
      n += 1;
    }
    out[lang] = decoded;
  }
  for (const key of Object.keys(raw)) {
    if (!isLang(key)) repaired(log, `${path}.${key}`);
  }
  return out;
}

/**
 * Decode one stored profile. Returns null only when the entry is not an object
 * at all or carries no usable id - a profile with a garbage settings block is
 * repaired, not dropped, because dropping it loses a child's word book.
 */
export function decodeProfile(raw: unknown, log: RepairLog, path: string): Profile | null {
  if (!isPlainObject(raw)) {
    repaired(log, path);
    return null;
  }
  const id = raw["id"];
  if (typeof id !== "string" || id.trim().length === 0) {
    repaired(log, `${path}.id`);
    return null;
  }
  const shipId = boundedString(raw["shipId"], MAX_ID_LENGTH, DEFAULT_SHIP_ID, log, `${path}.shipId`);
  const unlockedShips = idList(raw["unlockedShips"], log, `${path}.unlockedShips`);
  return {
    id: id.trim().slice(0, MAX_ID_LENGTH),
    name: boundedString(raw["name"], MAX_NAME_LENGTH, DEFAULT_PROFILE_NAME, log, `${path}.name`),
    avatar: boundedString(raw["avatar"], MAX_ID_LENGTH, DEFAULT_AVATAR, log, `${path}.avatar`),
    shipId,
    shipName: boundedString(raw["shipName"], MAX_NAME_LENGTH, DEFAULT_SHIP_NAME, log, `${path}.shipName`),
    createdAt: finiteNumber(raw["createdAt"], 0, log, `${path}.createdAt`),
    calibration: decodeCalibration(raw["calibration"], log, `${path}.calibration`),
    knobs: decodeKnobs(raw["knobs"], log, `${path}.knobs`),
    settings: decodeSettings(raw["settings"], log, `${path}.settings`),
    progress: decodeProgress(raw["progress"], log, `${path}.progress`),
    trophies: idList(raw["trophies"], log, `${path}.trophies`),
    // The ship you are flying is by definition unlocked; a payload that says
    // otherwise would render a locked ship on the profile screen.
    unlockedShips: unlockedShips.includes(shipId) ? unlockedShips : [shipId, ...unlockedShips],
    unlockedSkins: idList(raw["unlockedSkins"], log, `${path}.unlockedSkins`),
    words: decodeWords(raw["words"], log, `${path}.words`),
  };
}

// ---------------------------------------------------------------------------
// Encoding: Profile -> JSON. Field-by-field, and that is the point.
// ---------------------------------------------------------------------------

/**
 * The canonical persisted field list. AC-18.2 / NFR-3 hold BY CONSTRUCTION:
 * encoding copies these names one at a time, so a stray `email` property on an
 * in-memory object can never reach storage even if someone adds it to the type.
 * pii.ts scans this list and the encoded output; both tests go red if it grows
 * a contact field.
 */
export const PROFILE_FIELDS: readonly string[] = [
  "id",
  "name",
  "avatar",
  "shipId",
  "shipName",
  "createdAt",
  "calibration",
  "knobs",
  "settings",
  "progress",
  "trophies",
  "unlockedShips",
  "unlockedSkins",
  "words",
];

/**
 * Encode to a plain JSON-ready object with a FIXED key order, including sorted
 * word keys. Byte-identical round trips are a requirement, and object key order
 * is observable in JSON.stringify output, so the order is chosen here rather
 * than inherited from whatever order the game happened to mutate things in.
 */
function encodeProfile(profile: Profile): Record<string, unknown> {
  const words: Record<string, Record<string, unknown>> = {};
  for (const lang of LANGS) {
    const book = profile.words[lang];
    if (book === undefined) continue;
    const encoded: Record<string, unknown> = {};
    for (const word of Object.keys(book).sort()) {
      const r = book[word];
      if (r === undefined) continue;
      encoded[word] = {
        exposures: r.exposures,
        hits: r.hits,
        misses: r.misses,
        typos: r.typos,
        fkLatencyMs: [...r.fkLatencyMs],
        ikiMs: [...r.ikiMs],
        firstFkLatencyMs: r.firstFkLatencyMs,
        ease: r.ease,
        lastSeen: r.lastSeen,
        nextEligibleStage: r.nextEligibleStage,
      };
    }
    words[lang] = encoded;
  }

  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    shipId: profile.shipId,
    shipName: profile.shipName,
    createdAt: profile.createdAt,
    calibration: {
      ikiMs: profile.calibration.ikiMs,
      fkLatencyMs: profile.calibration.fkLatencyMs,
    },
    knobs: {
      maxLive: profile.knobs.maxLive,
      lengthBias: profile.knobs.lengthBias,
    },
    settings: {
      musicVolume: profile.settings.musicVolume,
      sfxVolume: profile.settings.sfxVolume,
      keyboardLayout: profile.settings.keyboardLayout,
      uiLang: profile.settings.uiLang,
      contentLang: profile.settings.contentLang,
      inputMethod: profile.settings.inputMethod,
      uppercase: profile.settings.uppercase,
      increasedLetterSpacing: profile.settings.increasedLetterSpacing,
      reducedMotion: profile.settings.reducedMotion,
      colorblindPalette: profile.settings.colorblindPalette,
      relativeBoard: profile.settings.relativeBoard,
    },
    progress: profile.progress.map((p) => ({
      stopId: p.stopId,
      cleared: p.cleared,
      stars: p.stars,
      bestWpm: p.bestWpm,
      bestAccuracy: p.bestAccuracy,
      lastWpm: p.lastWpm,
      lastAccuracy: p.lastAccuracy,
      beaconPlacedAt: p.beaconPlacedAt,
    })),
    trophies: [...profile.trophies],
    unlockedShips: [...profile.unlockedShips],
    unlockedSkins: [...profile.unlockedSkins],
    words,
  };
}

/** The exact object written under STORAGE_KEY. */
export function encodeState(state: PersistedState): Record<string, unknown> {
  return {
    version: SCHEMA_VERSION,
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map(encodeProfile),
  };
}

export function serializeState(state: PersistedState): string {
  return JSON.stringify(encodeState(state));
}

/** A state with no profiles: first run, or the last profile was deleted. */
export function emptyState(): PersistedState {
  return { version: SCHEMA_VERSION, profiles: [], activeProfileId: null };
}

/** `lang` is typed as string in Profile["words"]; keep the narrow view handy. */
export function bookFor(profile: Profile, lang: Lang): Record<string, WordRecord> {
  return profile.words[lang] ?? {};
}
