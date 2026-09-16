import { DEFAULT_FALLBACK_BUNDLE, type FallbackBundle } from "./fallback.js";
import { fallbackResult } from "./pipeline.js";
import type { CoachClient, CoachRequest, CoachResult } from "./types.js";

/**
 * AC-15.3: no AI call during flight, exactly one per warp break, zero on Earth.
 *
 * D32 is the reason this exists as code rather than as a convention. "Never
 * touches the game loop" is a property of the whole program, and a property a
 * scene can break with one stray await. The gate makes it structural: the
 * Warp scene holds the gate, not the client, and the gate is the only thing
 * that can reach a transport.
 *
 * Three refusals, each returning the shipped fallback so the caller's UI path
 * is unchanged (AC-15.1):
 *
 *   phase     - the game is not in a warp break. Flight is the case that
 *               matters: a call there would be a network round trip inside a
 *               60 fps loop (D32, NFR: p95 frame time <= 16.7 ms).
 *   earth     - Earth is the launchpad and has no belt (D57), so there are no
 *               misses to coach on and no warp break to coach in.
 *   duplicate - the break already got its one call. The memoised result comes
 *               back, so a re-render cannot become a second call.
 *
 * `calls` counts transport invocations, and is the counter AC-15.3 asks for.
 */

export type GamePhase = "flight" | "warp-break" | "other";

export interface CoachGate {
  /** Transport calls actually made. AC-15.3's counter. */
  readonly calls: number;
  /** Requests refused without a call. */
  readonly refusals: number;
  readonly phase: GamePhase;
  /**
   * Entering "warp-break" from another phase arms exactly one call. Re-setting
   * the same phase does NOT re-arm: leaving and re-entering the break UI must
   * not buy a second call.
   */
  setPhase(phase: GamePhase): void;
  request(req: CoachRequest): Promise<CoachResult>;
}

export interface CoachGateOptions {
  readonly client: CoachClient;
  readonly fallback?: FallbackBundle;
  /** Starting phase. Default "other" - nothing may call before flight starts. */
  readonly phase?: GamePhase;
}

export function createCoachGate(options: CoachGateOptions): CoachGate {
  const client = options.client;
  const bundle = options.fallback ?? DEFAULT_FALLBACK_BUNDLE;

  let phase: GamePhase = options.phase ?? "other";
  let calls = 0;
  let refusals = 0;
  let armed = phase === "warp-break";
  let memo: CoachResult | null = null;

  return {
    get calls() {
      return calls;
    },
    get refusals() {
      return refusals;
    },
    get phase() {
      return phase;
    },

    setPhase(next: GamePhase): void {
      if (next === phase) return;
      if (next === "warp-break") {
        armed = true;
        memo = null;
      }
      phase = next;
    },

    async request(req: CoachRequest): Promise<CoachResult> {
      if (phase !== "warp-break") {
        refusals += 1;
        return fallbackResult(bundle, req, client.transport, "phase");
      }
      if (req.stopId === "earth") {
        refusals += 1;
        return fallbackResult(bundle, req, client.transport, "earth");
      }
      if (!armed) {
        refusals += 1;
        // Hand back what the one real call produced, so the screen is stable.
        return (
          memo ?? fallbackResult(bundle, req, client.transport, "duplicate")
        );
      }

      // Disarm BEFORE awaiting: two overlapping requests in the same break
      // must produce one call, not two.
      armed = false;
      calls += 1;
      const result = await client.request(req);
      memo = result;
      return result;
    },
  };
}
