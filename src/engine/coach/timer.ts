import type { Timer, TimerHandle } from "./types.js";

/**
 * The one place in src/engine/coach that touches a host API, and it is opt-in.
 *
 * CLAUDE.md forbids the engine from reaching out to clocks; the rule's purpose
 * is that behaviour must be deterministic under test. So the module is written
 * against the `Timer` port and every test injects a controllable fake. This
 * factory exists so the composition root (the Warp scene) has something real
 * to pass in without inventing it, and it is the only function here that knows
 * `setTimeout` exists. Nothing imports it implicitly - a transport that is
 * handed no timer does not get one.
 *
 * `setTimeout` is a host timer, present in both node and the browser; it is not
 * a DOM API and needs no `window`.
 */
export function createRealTimer(): Timer {
  return (ms: number): TimerHandle => {
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;

    const expired = new Promise<void>((resolve) => {
      handle = setTimeout(() => {
        handle = null;
        if (!cancelled) resolve();
      }, ms);
    });

    return {
      expired,
      cancel(): void {
        cancelled = true;
        if (handle !== null) {
          clearTimeout(handle);
          handle = null;
        }
      },
    };
  };
}

/**
 * A timer that never fires. Handed to a transport whose deadline is enforced
 * elsewhere (or in a test that wants the wire to win every race).
 */
export function createNeverTimer(): Timer {
  return (): TimerHandle => ({
    expired: new Promise<void>(() => undefined),
    cancel: () => undefined,
  });
}
