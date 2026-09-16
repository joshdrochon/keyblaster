/**
 * The keystroke → lock → advance → blast state machine (D24, D25, PRD FR-3).
 *
 * Everything here is a pure reducer over plain data: no DOM, no timers, no
 * clock. `nowMs` is always an explicit field on the event so that the whole
 * learning system is deterministic under test (CLAUDE.md HARD RULES).
 *
 * The shape the Flight scene uses:
 *
 *   let state = createLockState({
 *     layout: settings.keyboardLayout,
 *     parkGraceMs: 1.5 * profile.calibration.ikiMs,
 *   });
 *   state = reduce(state, { type: "spawn", asteroid });
 *   state = reduce(state, { type: "key", input, nowMs });
 *   state = reduce(state, { type: "tick", nowMs });   // every frame
 *   for (const emit of state.emitted) render(emit);
 */
export { LAYOUT_MAPS, resolveChar } from "./layouts.js";
export type { KeyInput } from "./layouts.js";
export {
  DEFAULT_PARK_GRACE_MS,
  createLockState,
  phaseOf,
  reduce,
  reduceAll,
} from "./machine.js";
export type {
  AdvancedEmit,
  BlastEmit,
  IgnoredEmit,
  LiveAsteroid,
  LockEmit,
  LockEvent,
  LockOptions,
  LockPhase,
  LockState,
  LockedEmit,
  ParkedEmit,
  TypoEmit,
} from "./machine.js";
