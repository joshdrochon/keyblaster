import { normalizeWord } from "../allowlist/normalize.js";
import { DEFAULT_CALIBRATION, type KeyboardLayout } from "../types.js";
import { type KeyInput, resolveChar } from "./layouts.js";

/**
 * An asteroid the player can currently type at. The lock machine keeps its own
 * registry of these (fed by `spawn`/`despawn`) so that the whole keystroke →
 * lock → blast path is a pure reducer and the Flight scene owns no matching
 * logic (architecture section 3).
 */
export interface LiveAsteroid {
  readonly id: string;
  /** The word on the plate, and the key words/ stores the WordRecord under. */
  readonly word: string;
  /**
   * What the player actually types, when that differs from what is displayed:
   * D46's default Hindi mode shows घर and is typed "ghar". Choosing the one
   * canonical romanization (or folding the variant spellings before they get
   * here) is i18n/'s job; the lock matches one string per asteroid.
   */
  readonly typedAs?: string;
  /** Epoch-ish ms the word became visible; first-key latency is measured from here. */
  readonly spawnedAtMs: number;
}

/**
 * How long a completed-but-ambiguous word waits before it fires (see
 * `ParkedEmit`). This is FR-8's `keystrokeBudget` — 1.5 x the player's median
 * inter-key interval — because that is already the engine's definition of "the
 * next keystroke should have arrived by now". The scene passes the calibrated
 * value; this is the default-calibration fallback.
 */
export const DEFAULT_PARK_GRACE_MS = 1.5 * DEFAULT_CALIBRATION.ikiMs;

// ---------------------------------------------------------------------------
// Emissions — what the scene renders and what words/, scoring/ and
// calibration/ consume. There is deliberately no "wrong" or "miss" emission:
// D31 says the player must always feel like the best typer in the world.
// ---------------------------------------------------------------------------

/** AC-3.1 / AC-2.2: the target resolved to exactly one asteroid. */
export interface LockedEmit {
  readonly type: "locked";
  readonly asteroidId: string;
  readonly word: string;
  readonly typed: string;
  readonly nowMs: number;
}

/** One correct keystroke. Carries the timing samples FR-7 stores per word. */
export interface AdvancedEmit {
  readonly type: "advanced";
  /** null while several candidates still share the typed prefix (D25). */
  readonly asteroidId: string | null;
  readonly candidateIds: readonly string[];
  readonly char: string;
  readonly typed: string;
  /** 0-based position of `char` in the word. */
  readonly index: number;
  /** Set only on the first keystroke of an unambiguous target. */
  readonly fkLatencyMs: number | null;
  /** null when this interval is not a clean sample (see LockState.lastKeyAtMs). */
  readonly ikiMs: number | null;
  readonly nowMs: number;
}

/**
 * AC-2.2: the typed prefix is a whole word, but a longer candidate is still
 * live ("flow" typed, "flower" still falling). The word is armed, not fired.
 *
 * The scene MUST render this — a charging beam, a ring closing on the rock —
 * because it is the only thing that tells the player their word landed and is
 * about to go. `firesAtMs` is when it fires if nothing else happens, so the
 * animation can be exact rather than guessed.
 */
export interface ParkedEmit {
  readonly type: "parked";
  readonly asteroidId: string;
  readonly word: string;
  readonly typed: string;
  /** The rival candidates keeping it ambiguous, for the "dual cannons" read (D25). */
  readonly rivalIds: readonly string[];
  readonly firesAtMs: number;
  readonly nowMs: number;
}

/**
 * AC-3.2: a wrong keystroke shakes and counts, and the lock survives it.
 * `shake` is a literal true so the scene contract is asserted in unit tests
 * rather than only in the visual rubric.
 */
export interface TypoEmit {
  readonly type: "typo";
  readonly asteroidId: string | null;
  readonly word: string | null;
  readonly typed: string;
  readonly actual: string;
  /** The characters that would have been correct, in candidate order. */
  readonly expected: readonly string[];
  /** Typos on this attempt so far. */
  readonly typos: number;
  readonly shake: true;
  readonly nowMs: number;
}

/**
 * AC-3.3, taken literally (collision C10): a keystroke that belongs to a
 * *different* live asteroid is ignored. It shakes, because AC-6e.2 wants a
 * visible response to every keystroke, but it is NOT a typo: it must not reach
 * scoring/'s combo reset or words/' `ease *= 1.05`, or brushing a key meant for
 * a rock the child is not typing would cost them their multiplier and speed up
 * their current word — the direction D31 forbids.
 *
 * Also used, with `shake: false` and an empty `ignoredTargetIds`, for a
 * keystroke that matches nothing at all while idle: there is no target to be
 * wrong against, so the scene gives a soft cue (AC-6e.2) and nothing counts.
 */
export interface IgnoredEmit {
  readonly type: "ignored";
  /** The locked target this keystroke did NOT move, if there is one. */
  readonly asteroidId: string | null;
  readonly word: string | null;
  readonly typed: string;
  readonly actual: string;
  /** Live asteroids this keystroke would have started, and did not (D24). */
  readonly ignoredTargetIds: readonly string[];
  readonly shake: boolean;
  readonly nowMs: number;
}

/** AC-3.4: the word is complete. words/ and scoring/ read the timing fields. */
export interface BlastEmit {
  readonly type: "blast";
  readonly asteroidId: string;
  readonly word: string;
  readonly typos: number;
  readonly fkLatencyMs: number;
  readonly ikiMs: readonly number[];
  /**
   * First accepted keystroke to last accepted keystroke. 0 for a one-keystroke
   * word and for a word delivered by a single IME commit (D46), so consumers
   * must never divide by it; it deliberately excludes any parked wait, so it
   * measures typing and not hesitation.
   */
  readonly typingMs: number;
  readonly nowMs: number;
}

export type LockEmit =
  | LockedEmit
  | AdvancedEmit
  | ParkedEmit
  | TypoEmit
  | IgnoredEmit
  | BlastEmit;

// ---------------------------------------------------------------------------
// Reducer input
// ---------------------------------------------------------------------------

export type LockEvent =
  | { readonly type: "key"; readonly input: KeyInput; readonly nowMs: number }
  /**
   * A committed IME composition: several characters arrive as one event
   * (D46). The scene sends this on `compositionend`, never per keystroke.
   */
  | { readonly type: "composition"; readonly text: string; readonly nowMs: number }
  | { readonly type: "spawn"; readonly asteroid: LiveAsteroid }
  | { readonly type: "despawn"; readonly id: string; readonly nowMs: number }
  | { readonly type: "layout"; readonly layout: KeyboardLayout }
  /**
   * The scene's frame tick. The engine owns no clock (CLAUDE.md), so this is
   * how a parked word fires when the player simply stops typing.
   */
  | { readonly type: "tick"; readonly nowMs: number }
  | { readonly type: "reset" };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface LockState {
  readonly layout: KeyboardLayout;
  readonly parkGraceMs: number;
  readonly live: readonly LiveAsteroid[];
  /** Characters accepted so far on this attempt. Empty means idle. */
  readonly typed: string;
  /** D25: narrows per keystroke; the lock resolves when exactly one remains. */
  readonly candidateIds: readonly string[];
  readonly lockedId: string | null;
  /** AC-2.2: the armed exact match, if any. See ParkedEmit. */
  readonly pendingExactId: string | null;
  /** When the park was armed or last refreshed; it fires `parkGraceMs` later. */
  readonly parkedAtMs: number | null;
  readonly typos: number;
  readonly firstKeyAtMs: number | null;
  readonly lastAdvanceAtMs: number | null;
  /**
   * Timestamp of the previous keystroke, or null when the next interval would
   * not be a clean inter-key sample (start of an attempt, or the previous key
   * was a typo or an ignored key). Detours break the chain rather than being
   * folded in: counting them would bias the median fast, and fall time budgets
   * off that median (architecture 4.1), so the error would make the game harder
   * after a mistake — exactly the direction D31 forbids.
   */
  readonly lastKeyAtMs: number | null;
  readonly ikiMs: readonly number[];
  /** Emissions produced by the most recent reduce, and only that one. */
  readonly emitted: readonly LockEmit[];
}

export type LockPhase = "idle" | "narrowing" | "parked" | "locked";

export function phaseOf(state: LockState): LockPhase {
  if (state.typed.length === 0) return "idle";
  if (state.pendingExactId !== null) return "parked";
  return state.lockedId === null ? "narrowing" : "locked";
}

export interface LockOptions {
  readonly layout?: KeyboardLayout;
  /** FR-8 keystroke budget: 1.5 x the player's median inter-key interval. */
  readonly parkGraceMs?: number;
}

export function createLockState(options: LockOptions = {}): LockState {
  return {
    layout: options.layout ?? "qwerty",
    parkGraceMs: options.parkGraceMs ?? DEFAULT_PARK_GRACE_MS,
    live: [],
    typed: "",
    candidateIds: [],
    lockedId: null,
    pendingExactId: null,
    parkedAtMs: null,
    typos: 0,
    firstKeyAtMs: null,
    lastAdvanceAtMs: null,
    lastKeyAtMs: null,
    ikiMs: [],
    emitted: [],
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Draft {
  layout: KeyboardLayout;
  parkGraceMs: number;
  live: LiveAsteroid[];
  typed: string;
  candidateIds: string[];
  lockedId: string | null;
  pendingExactId: string | null;
  parkedAtMs: number | null;
  typos: number;
  firstKeyAtMs: number | null;
  lastAdvanceAtMs: number | null;
  lastKeyAtMs: number | null;
  ikiMs: number[];
  emitted: LockEmit[];
}

/** Code points, not UTF-16 units: Devanagari and surrogates must not split. */
function chars(text: string): readonly string[] {
  return [...text];
}

/** The string the player must type for this asteroid (D46). */
function typedFormOf(asteroid: LiveAsteroid): string {
  return asteroid.typedAs ?? asteroid.word;
}

/**
 * Candidate ids are only ever taken from `live` and are pruned on despawn, so
 * this lookup cannot miss. The cast keeps that invariant out of every caller.
 */
function byId(live: readonly LiveAsteroid[], id: string): LiveAsteroid {
  return live.find((a) => a.id === id) as LiveAsteroid;
}

function candidatesOf(d: Draft): LiveAsteroid[] {
  return d.candidateIds.map((id) => byId(d.live, id));
}

function clearAttempt(d: Draft): void {
  d.typed = "";
  d.candidateIds = [];
  d.lockedId = null;
  d.pendingExactId = null;
  d.parkedAtMs = null;
  d.typos = 0;
  d.firstKeyAtMs = null;
  d.lastAdvanceAtMs = null;
  d.lastKeyAtMs = null;
  d.ikiMs = [];
}

function emitLocked(d: Draft, target: LiveAsteroid, nowMs: number): void {
  d.lockedId = target.id;
  d.emitted.push({
    type: "locked",
    asteroidId: target.id,
    word: target.word,
    typed: d.typed,
    nowMs,
  });
}

/** Emit `locked` the moment the candidate set collapses to one (D25). */
function resolveLock(d: Draft, nowMs: number): void {
  if (d.lockedId !== null) return;
  if (d.candidateIds.length !== 1) return;
  emitLocked(d, byId(d.live, d.candidateIds[0] as string), nowMs);
}

function blast(d: Draft, target: LiveAsteroid, nowMs: number): void {
  // A blast only ever resolves mid-attempt, so both stamps are set.
  const firstKeyAtMs = d.firstKeyAtMs as number;
  const lastAdvanceAtMs = d.lastAdvanceAtMs as number;
  // Normally the lock was announced on the keystroke that narrowed to one.
  // A parked word, and two live asteroids carrying the same word, never
  // collapse the candidate set, so the lock ring is announced here instead.
  if (d.lockedId !== target.id) emitLocked(d, target, nowMs);
  d.emitted.push({
    type: "blast",
    asteroidId: target.id,
    word: target.word,
    typos: d.typos,
    fkLatencyMs: firstKeyAtMs - target.spawnedAtMs,
    ikiMs: [...d.ikiMs],
    typingMs: lastAdvanceAtMs - firstKeyAtMs,
    nowMs,
  });
  d.live = d.live.filter((a) => a.id !== target.id);
  clearAttempt(d);
}

/** Keep the park alive while the player is demonstrably still at the keyboard. */
function refreshPark(d: Draft, nowMs: number): void {
  if (d.pendingExactId === null) return;
  d.parkedAtMs = nowMs;
}

/**
 * Decide what a fully- or partly-typed prefix means.
 *
 * The interesting case is AC-2.2. With "flow" and "flower" both live, typing
 * "flow" matches a whole word while a longer candidate is still falling. The
 * PRD's own example settles it: the next keystroke "e" must lock "flower", so
 * "flow" cannot blast here. It is armed instead, and resolves when the
 * ambiguity does — the player types "e" (the PRD case), the rival leaves the
 * field, or the player stops typing for one keystroke budget and the parked
 * word fires on a `tick`.
 *
 * What it must NOT do is treat the next non-matching key as proof the player
 * meant the short word. That key is far more often a typo, and reading it as
 * consent destroys a word the player never asked for while their real target
 * sails on — AC-3.2 promises a shake, a count and a surviving lock instead.
 */
function resolveCompletion(d: Draft, nowMs: number): void {
  // Only ever reached mid-attempt, so `typed` is non-empty and every candidate
  // carries it as a prefix.
  const typedLen = chars(d.typed).length;
  const cands = candidatesOf(d);
  const exact = cands.find((c) => chars(typedFormOf(c)).length === typedLen);
  if (exact === undefined) {
    d.pendingExactId = null;
    d.parkedAtMs = null;
    return;
  }
  const rivals = cands.filter((c) => chars(typedFormOf(c)).length > typedLen);
  if (rivals.length === 0) {
    blast(d, exact, nowMs);
    return;
  }
  // Already armed on this same word (a third candidate just despawned): keep
  // the clock running rather than restarting the animation.
  if (d.pendingExactId === exact.id) return;
  d.pendingExactId = exact.id;
  d.parkedAtMs = nowMs;
  d.emitted.push({
    type: "parked",
    asteroidId: exact.id,
    word: exact.word,
    typed: d.typed,
    rivalIds: rivals.map((c) => c.id),
    firesAtMs: nowMs + d.parkGraceMs,
    nowMs,
  });
}

/**
 * Apply one resolved character.
 *
 * `timed` is false for the 2nd..nth character of a committed IME composition:
 * they all arrive in one event, so there is no measured interval between them
 * and inventing one would poison the calibration medians (D46, FR-11).
 */
function applyChar(d: Draft, ch: string, nowMs: number, timed: boolean): void {
  if (d.typed.length === 0) {
    // AC-3.1: the first keystroke picks every live word starting with it.
    const starters = d.live.filter((a) => chars(typedFormOf(a))[0] === ch);
    if (starters.length === 0) {
      // Nothing on screen to be wrong against, so this is not a typo: it does
      // not count and (via scoring/) does not break the combo — D31. It still
      // reports, because AC-6e.2 wants a visible response to every keystroke.
      d.emitted.push({
        type: "ignored",
        asteroidId: null,
        word: null,
        typed: "",
        actual: ch,
        ignoredTargetIds: [],
        shake: false,
        nowMs,
      });
      return;
    }
    d.candidateIds = starters.map((a) => a.id);
    d.typed = ch;
    d.firstKeyAtMs = nowMs;
    d.lastAdvanceAtMs = nowMs;
    d.lastKeyAtMs = nowMs;
    resolveLock(d, nowMs);
    const single = starters.length === 1 ? (starters[0] as LiveAsteroid) : null;
    d.emitted.push({
      type: "advanced",
      asteroidId: d.lockedId,
      candidateIds: [...d.candidateIds],
      char: ch,
      typed: d.typed,
      index: 0,
      // With several candidates the target is unknown, so there is no word to
      // attribute the latency to yet; the blast carries it instead.
      fkLatencyMs: single === null ? null : nowMs - single.spawnedAtMs,
      ikiMs: null,
      nowMs,
    });
    resolveCompletion(d, nowMs);
    return;
  }

  const index = chars(d.typed).length;
  const next = candidatesOf(d).filter((a) => chars(typedFormOf(a))[index] === ch);

  if (next.length > 0) {
    d.candidateIds = next.map((a) => a.id);
    d.typed += ch;
    d.pendingExactId = null;
    d.parkedAtMs = null;
    const ikiMs = timed && d.lastKeyAtMs !== null ? nowMs - d.lastKeyAtMs : null;
    if (ikiMs !== null) d.ikiMs.push(ikiMs);
    d.lastKeyAtMs = nowMs;
    d.lastAdvanceAtMs = nowMs;
    resolveLock(d, nowMs);
    d.emitted.push({
      type: "advanced",
      asteroidId: d.lockedId,
      candidateIds: [...d.candidateIds],
      char: ch,
      typed: d.typed,
      index,
      fkLatencyMs: null,
      ikiMs,
      nowMs,
    });
    resolveCompletion(d, nowMs);
    return;
  }

  // The key moved no candidate. Two different things can be true here, and
  // they are NOT interchangeable (collision C10).
  const candidateSet = new Set(d.candidateIds);
  const ignoredTargetIds = d.live
    .filter((a) => !candidateSet.has(a.id) && chars(typedFormOf(a))[0] === ch)
    .map((a) => a.id);
  const locked = d.lockedId === null ? null : byId(d.live, d.lockedId);

  if (ignoredTargetIds.length > 0) {
    // AC-3.3: it belongs to another rock. The lock does not move (D24) and
    // nothing is charged to the player.
    d.emitted.push({
      type: "ignored",
      asteroidId: d.lockedId,
      word: locked === null ? null : locked.word,
      typed: d.typed,
      actual: ch,
      ignoredTargetIds,
      shake: true,
      nowMs,
    });
  } else {
    // AC-3.2: wrong key. Count it, shake, keep the lock — and keep any park,
    // because a fat finger is not consent to fire the short word.
    d.typos += 1;
    // No candidate can be exhausted here: an exact match is either blasted or
    // parked by resolveCompletion, and a parked word keeps its rivals.
    const expected = [
      ...new Set(candidatesOf(d).map((a) => chars(typedFormOf(a))[index] as string)),
    ];
    d.emitted.push({
      type: "typo",
      asteroidId: d.lockedId,
      word: locked === null ? null : locked.word,
      typed: d.typed,
      actual: ch,
      expected,
      typos: d.typos,
      shake: true,
      nowMs,
    });
  }

  // Still at the keyboard: give the parked word its full grace from here.
  refreshPark(d, nowMs);
  // The interval across a detour is not a clean sample; see LockState.lastKeyAtMs.
  d.lastKeyAtMs = null;
}

/**
 * Feed one input event's worth of text through the matcher.
 *
 * D46: a committed IME composition delivers several characters at once, and
 * auto-lock (D24) must still work, so each character runs exactly the same
 * path a keystroke would. Only the first character of the batch carries a
 * measured interval — the rest arrived in the same event. The commit time is
 * still a real event time, so the interval from it to the NEXT keystroke is a
 * clean sample and is kept.
 */
function applyText(d: Draft, text: string, nowMs: number): void {
  chars(text).forEach((ch, i) => {
    applyChar(d, ch, nowMs, i === 0);
  });
}

function despawn(d: Draft, id: string, nowMs: number): void {
  d.live = d.live.filter((a) => a.id !== id);
  if (!d.candidateIds.includes(id)) return;
  d.candidateIds = d.candidateIds.filter((x) => x !== id);
  if (d.pendingExactId === id) {
    d.pendingExactId = null;
    d.parkedAtMs = null;
  }
  if (d.candidateIds.length === 0) {
    // The target the player was typing left the field (missed, or crossed the
    // breach line). Silently back to idle: there is no failure emission (D31);
    // the hull hit is FR-4's business, not the lock's.
    clearAttempt(d);
    return;
  }
  // Losing a rival can itself resolve the lock, and can free a parked exact
  // match ("flower" is gone, so "flow" fires now).
  resolveLock(d, nowMs);
  resolveCompletion(d, nowMs);
}

/** AC-2.2: the armed word fires once the player has stopped typing. */
function tick(d: Draft, nowMs: number): void {
  if (d.pendingExactId === null) return;
  // parkedAtMs is set with pendingExactId and cleared with it.
  if (nowMs - (d.parkedAtMs as number) < d.parkGraceMs) return;
  blast(d, byId(d.live, d.pendingExactId), nowMs);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** `(state, event) → state'`, per architecture section 3. Never mutates input. */
export function reduce(state: LockState, event: LockEvent): LockState {
  const d: Draft = {
    layout: state.layout,
    parkGraceMs: state.parkGraceMs,
    live: [...state.live],
    typed: state.typed,
    candidateIds: [...state.candidateIds],
    lockedId: state.lockedId,
    pendingExactId: state.pendingExactId,
    parkedAtMs: state.parkedAtMs,
    typos: state.typos,
    firstKeyAtMs: state.firstKeyAtMs,
    lastAdvanceAtMs: state.lastAdvanceAtMs,
    lastKeyAtMs: state.lastKeyAtMs,
    ikiMs: [...state.ikiMs],
    emitted: [],
  };

  switch (event.type) {
    case "reset":
      // Stage start: the belt is empty and nothing is half-typed.
      return createLockState({
        layout: d.layout,
        parkGraceMs: d.parkGraceMs,
      });
    case "layout":
      // AC-19.1: a settings change takes effect without a reload.
      d.layout = event.layout;
      break;
    case "spawn": {
      const word = normalizeWord(event.asteroid.word);
      const typedAs = normalizeWord(typedFormOf(event.asteroid));
      // An unword cannot be typed, and a duplicate id would sit in the
      // candidate set twice and stop the lock resolving. Both are refused here
      // so the matcher stays total.
      const known = d.live.some((a) => a.id === event.asteroid.id);
      if (typedAs.length > 0 && !known) {
        d.live.push({ ...event.asteroid, word, typedAs });
      }
      break;
    }
    case "despawn":
      despawn(d, event.id, event.nowMs);
      break;
    case "tick":
      tick(d, event.nowMs);
      break;
    case "key": {
      const text = resolveChar(event.input, d.layout);
      // AC-3.5: a modifier combo or a non-character key is not typing at all,
      // so it produces nothing — it is not a keystroke event for AC-6e.2.
      if (text !== null) applyText(d, text, event.nowMs);
      break;
    }
    default:
      applyText(d, event.text.normalize("NFC").toLowerCase(), event.nowMs);
      break;
  }

  return {
    layout: d.layout,
    parkGraceMs: d.parkGraceMs,
    live: d.live,
    typed: d.typed,
    candidateIds: d.candidateIds,
    lockedId: d.lockedId,
    pendingExactId: d.pendingExactId,
    parkedAtMs: d.parkedAtMs,
    typos: d.typos,
    firstKeyAtMs: d.firstKeyAtMs,
    lastAdvanceAtMs: d.lastAdvanceAtMs,
    lastKeyAtMs: d.lastKeyAtMs,
    ikiMs: d.ikiMs,
    emitted: d.emitted,
  };
}

/**
 * Fold a list of events, collecting every emission along the way. `reduce`
 * clears `emitted` each step, so table-driven tests use this to assert on a
 * whole sequence.
 */
export function reduceAll(
  state: LockState,
  events: Iterable<LockEvent>,
): { readonly state: LockState; readonly emitted: readonly LockEmit[] } {
  let current = state;
  const emitted: LockEmit[] = [];
  for (const event of events) {
    current = reduce(current, event);
    emitted.push(...current.emitted);
  }
  return { state: current, emitted };
}
