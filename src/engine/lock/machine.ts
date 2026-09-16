import { normalizeWord } from "../allowlist/normalize.js";
import type { KeyboardLayout } from "../types.js";
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
  /** AC-3.3: live asteroids this keystroke would have started, and did not. */
  readonly ignoredTargetIds: readonly string[];
  readonly shake: true;
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
  /** First keystroke to blast, ms. */
  readonly durationMs: number;
  readonly nowMs: number;
}

export type LockEmit = LockedEmit | AdvancedEmit | TypoEmit | BlastEmit;

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
  | { readonly type: "reset" };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface LockState {
  readonly layout: KeyboardLayout;
  readonly live: readonly LiveAsteroid[];
  /** Characters accepted so far on this attempt. Empty means idle. */
  readonly typed: string;
  /** D25: narrows per keystroke; the lock resolves when exactly one remains. */
  readonly candidateIds: readonly string[];
  readonly lockedId: string | null;
  /**
   * AC-2.2: a candidate whose word is exactly `typed` while a longer candidate
   * is still live ("flow" typed, "flower" still falling). Held, not blasted.
   */
  readonly pendingExactId: string | null;
  readonly typos: number;
  readonly firstKeyAtMs: number | null;
  /**
   * Timestamp of the previous keystroke, or null when the next interval would
   * not be a clean inter-key sample (start of an attempt, or the previous key
   * was a typo). Typos break the chain rather than being folded in: counting
   * them would bias the median fast, and fall time budgets off that median
   * (architecture 4.1), so the error would make the game harder after a
   * mistake — exactly the direction D31 forbids.
   */
  readonly lastKeyAtMs: number | null;
  readonly ikiMs: readonly number[];
  /** Emissions produced by the most recent reduce, and only that one. */
  readonly emitted: readonly LockEmit[];
}

export type LockPhase = "idle" | "narrowing" | "locked";

export function phaseOf(state: LockState): LockPhase {
  if (state.typed.length === 0) return "idle";
  return state.lockedId === null ? "narrowing" : "locked";
}

export function createLockState(
  options: { readonly layout?: KeyboardLayout } = {},
): LockState {
  return {
    layout: options.layout ?? "qwerty",
    live: [],
    typed: "",
    candidateIds: [],
    lockedId: null,
    pendingExactId: null,
    typos: 0,
    firstKeyAtMs: null,
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
  live: LiveAsteroid[];
  typed: string;
  candidateIds: string[];
  lockedId: string | null;
  pendingExactId: string | null;
  typos: number;
  firstKeyAtMs: number | null;
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
  d.typos = 0;
  d.firstKeyAtMs = null;
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
  // A blast only ever resolves from a non-empty `typed`, so the first
  // keystroke of the attempt has been stamped.
  const firstKeyAtMs = d.firstKeyAtMs as number;
  // Normally the lock was announced on the keystroke that narrowed to one.
  // Two live asteroids carrying the same word never collapse to one candidate,
  // so in that case the lock ring is announced here instead.
  if (d.lockedId !== target.id) emitLocked(d, target, nowMs);
  d.emitted.push({
    type: "blast",
    asteroidId: target.id,
    word: target.word,
    typos: d.typos,
    fkLatencyMs: firstKeyAtMs - target.spawnedAtMs,
    ikiMs: [...d.ikiMs],
    durationMs: nowMs - firstKeyAtMs,
    nowMs,
  });
  d.live = d.live.filter((a) => a.id !== target.id);
  clearAttempt(d);
}

/**
 * Decide what a fully- or partly-typed prefix means.
 *
 * The interesting case is AC-2.2. With "flow" and "flower" both live, typing
 * "flow" matches a whole word while a longer candidate is still falling. The
 * PRD's own example settles it: the next keystroke "e" must lock "flower", so
 * "flow" cannot blast here. It is parked in `pendingExactId` instead, and
 * resolves the moment the ambiguity does — either the player types "e" (the
 * PRD case), or the player types something that fits neither, which can only
 * mean they meant "flow" (see applyChar), or "flower" leaves the field.
 */
function resolveCompletion(d: Draft, nowMs: number): void {
  // Only ever reached mid-attempt, so `typed` is non-empty and every candidate
  // carries it as a prefix.
  const typedLen = chars(d.typed).length;
  const cands = candidatesOf(d);
  const exact = cands.find((c) => chars(typedFormOf(c)).length === typedLen);
  if (exact === undefined) {
    d.pendingExactId = null;
    return;
  }
  if (cands.some((c) => chars(typedFormOf(c)).length > typedLen)) {
    d.pendingExactId = exact.id;
    return;
  }
  blast(d, exact, nowMs);
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
      // not shake, count, or break the combo (D31). It is simply dropped.
      return;
    }
    d.candidateIds = starters.map((a) => a.id);
    d.typed = ch;
    d.firstKeyAtMs = nowMs;
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
    const ikiMs = timed && d.lastKeyAtMs !== null ? nowMs - d.lastKeyAtMs : null;
    if (ikiMs !== null) d.ikiMs.push(ikiMs);
    d.lastKeyAtMs = nowMs;
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

  if (d.pendingExactId !== null) {
    // "flow" was complete and "flower" was still live; this keystroke fits
    // neither, so the player meant "flow". Blasting it here (rather than
    // charging a typo) is what keeps AC-2.2 from becoming a dead end the
    // player can only escape by being punished — D31.
    const pending = byId(d.live, d.pendingExactId);
    blast(d, pending, nowMs);
    applyChar(d, ch, nowMs, timed);
    return;
  }

  // AC-3.2: wrong key. Count it, shake, keep the lock.
  d.typos += 1;
  const cands = candidatesOf(d);
  const locked = d.lockedId === null ? null : byId(d.live, d.lockedId);
  // No candidate can be exhausted here: an exact match would have been caught
  // as a blast or parked as pendingExactId above.
  const expected = [
    ...new Set(cands.map((a) => chars(typedFormOf(a))[index] as string)),
  ];
  const candidateSet = new Set(d.candidateIds);
  d.emitted.push({
    type: "typo",
    asteroidId: d.lockedId,
    word: locked === null ? null : locked.word,
    typed: d.typed,
    actual: ch,
    expected,
    typos: d.typos,
    // AC-3.3: these are the targets the keystroke would have started if the
    // player were idle. They are reported for rendering only; the lock never
    // moves (D24).
    ignoredTargetIds: d.live
      .filter((a) => !candidateSet.has(a.id) && chars(typedFormOf(a))[0] === ch)
      .map((a) => a.id),
    shake: true,
    nowMs,
  });
  // The interval across a typo is not a clean sample; see LockState.lastKeyAtMs.
  d.lastKeyAtMs = null;
}

/**
 * Feed one input event's worth of text through the matcher.
 *
 * D46: a committed IME composition delivers several characters at once, and
 * auto-lock (D24) must still work, so each character runs exactly the same
 * path a keystroke would. Only the first character of the batch carries a
 * measured interval — the rest arrived in the same event.
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
  if (d.pendingExactId === id) d.pendingExactId = null;
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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** `(state, event) → state'`, per architecture section 3. Never mutates input. */
export function reduce(state: LockState, event: LockEvent): LockState {
  const d: Draft = {
    layout: state.layout,
    live: [...state.live],
    typed: state.typed,
    candidateIds: [...state.candidateIds],
    lockedId: state.lockedId,
    pendingExactId: state.pendingExactId,
    typos: state.typos,
    firstKeyAtMs: state.firstKeyAtMs,
    lastKeyAtMs: state.lastKeyAtMs,
    ikiMs: [...state.ikiMs],
    emitted: [],
  };

  switch (event.type) {
    case "reset":
      // Stage start: the belt is empty and nothing is half-typed.
      return createLockState({ layout: d.layout });
    case "layout":
      // AC-19.1: a settings change takes effect without a reload.
      d.layout = event.layout;
      break;
    case "spawn": {
      const word = normalizeWord(event.asteroid.word);
      const typedAs = normalizeWord(typedFormOf(event.asteroid));
      // An unword cannot be typed; dropping it here keeps the matcher total.
      if (typedAs.length > 0) d.live.push({ ...event.asteroid, word, typedAs });
      break;
    }
    case "despawn":
      despawn(d, event.id, event.nowMs);
      break;
    case "key": {
      const text = resolveChar(event.input, d.layout);
      if (text !== null) applyText(d, text, event.nowMs);
      break;
    }
    default:
      applyText(d, event.text.normalize("NFC").toLowerCase(), event.nowMs);
      break;
  }

  return {
    layout: d.layout,
    live: d.live,
    typed: d.typed,
    candidateIds: d.candidateIds,
    lockedId: d.lockedId,
    pendingExactId: d.pendingExactId,
    typos: d.typos,
    firstKeyAtMs: d.firstKeyAtMs,
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
