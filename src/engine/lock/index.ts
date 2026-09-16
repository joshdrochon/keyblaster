/**
 * The keystroke → lock → advance → blast state machine (D24, D25, PRD FR-3).
 *
 * Everything here is a pure reducer over plain data: no DOM, no timers, no
 * clock. `nowMs` is always an explicit field on the event so that the whole
 * learning system is deterministic under test (CLAUDE.md HARD RULES).
 *
 * The shape the Flight scene uses:
 *
 *   let state = createLockState({ layout: settings.keyboardLayout });
 *   state = reduce(state, { type: "spawn", asteroid });
 *   state = reduce(state, { type: "key", input, nowMs });
 *   for (const emit of state.emitted) render(emit);
 */
export { LAYOUT_MAPS, resolveChar } from "./layouts.js";
export type { KeyInput } from "./layouts.js";
export {
  createLockState,
  phaseOf,
  reduce,
  reduceAll,
} from "./machine.js";
export type {
  AdvancedEmit,
  BlastEmit,
  LiveAsteroid,
  LockEmit,
  LockEvent,
  LockPhase,
  LockState,
  LockedEmit,
  TypoEmit,
} from "./machine.js";
