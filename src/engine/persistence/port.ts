/**
 * The injected ports persistence/ runs on.
 *
 * src/engine is DOM-free (CLAUDE.md HARD RULES), so this module never touches
 * localStorage, Date.now() or setTimeout. The game layer supplies thin adapters
 * over the real browser APIs; tests supply in-memory fakes. That is the whole
 * reason AC-18.4 can be fuzzed at all: corruption is just a string we hand in.
 */

/**
 * The narrow slice of the Web Storage API we depend on. Deliberately three
 * methods: anything wider (length, key(), clear()) would tempt this module into
 * owning keys it does not own.
 *
 * Every method may throw in the real world - private browsing rejects setItem,
 * a full quota rejects setItem, and a hostile extension can make getItem throw.
 * Callers inside this module must assume that.
 */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Cancels a pending scheduled callback. Calling it twice must be harmless. */
export type CancelTimer = () => void;

/**
 * Time, injected. `schedule` is the debounce timer (architecture section 7:
 * writes debounced 250 ms); the game wires it to window.setTimeout, tests to a
 * fake that only advances when told. No wall clock reaches this module.
 */
export interface Clock {
  now(): number;
  schedule(callback: () => void, delayMs: number): CancelTimer;
}

/**
 * Profile id generator, injected for the same reason as the clock: tests need
 * stable ids, and crypto.randomUUID is a DOM global. The default in store.ts is
 * derived from the clock plus a counter, so it is deterministic too.
 */
export type IdSource = () => string;
