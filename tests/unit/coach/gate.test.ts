import { describe, expect, it } from "vitest";
import {
  createCoachGate,
  createCoachValidator,
  createMockCoach,
  type CoachClient,
  type CoachRequest,
  type CoachResult,
} from "@engine/coach/index.js";
import { allowlist, marsRequest } from "./fixtures.js";

/**
 * AC-15.3: no AI call during flight; exactly one per warp break; zero on
 * Earth. The counter is the gate's `calls`.
 */

const validator = createCoachValidator({ allowlist });

/** A client that counts calls and can be made to hang. */
function countingClient(): CoachClient & {
  readonly calls: CoachRequest[];
  release(): void;
  hold(): void;
} {
  const calls: CoachRequest[] = [];
  let gateOpen = true;
  let release: () => void = () => undefined;
  const inner = createMockCoach({ validator });

  return {
    transport: "mock",
    calls,
    hold(): void {
      gateOpen = false;
    },
    release(): void {
      gateOpen = true;
      release();
    },
    async request(req: CoachRequest): Promise<CoachResult> {
      calls.push(req);
      if (!gateOpen) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return inner.request(req);
    },
  };
}

describe("AC-15.3: zero calls outside a warp break", () => {
  it("AC-15.3: a whole flight makes zero calls", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    gate.setPhase("flight");

    // Pretend the flight scene asks on every one of 120 frames. D32: the LLM
    // never touches the game loop, and the gate is what makes that structural.
    for (let frame = 0; frame < 120; frame += 1) {
      const result = await gate.request(marsRequest);
      expect(result.source).toBe("fallback");
      expect(result.failure).toBe("phase");
    }

    expect(gate.calls).toBe(0);
    expect(client.calls).toHaveLength(0);
    expect(gate.refusals).toBe(120);
  });

  it("AC-15.3: the default phase refuses before the game has started", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    expect(gate.phase).toBe("other");
    await gate.request(marsRequest);
    expect(gate.calls).toBe(0);
  });

  it("AC-15.3: zero calls on Earth, which has no belt (D57)", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    gate.setPhase("warp-break");

    const result = await gate.request({ ...marsRequest, stopId: "earth" });
    expect(gate.calls).toBe(0);
    expect(client.calls).toHaveLength(0);
    expect(result.failure).toBe("earth");
    expect(result.note.trim().length).toBeGreaterThan(0);
  });
});

describe("AC-15.3: exactly one call per warp break", () => {
  it("AC-15.3: the first request in a break calls, the rest do not", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    gate.setPhase("warp-break");

    const first = await gate.request(marsRequest);
    expect(gate.calls).toBe(1);
    expect(first.source).toBe("live");

    for (let i = 0; i < 5; i += 1) {
      const again = await gate.request(marsRequest);
      expect(gate.calls).toBe(1);
      // A re-render shows the same note, not a second one and not a fallback.
      expect(again).toEqual(first);
    }
    expect(gate.refusals).toBe(5);
  });

  it("AC-15.3: six belts produce exactly six calls across a whole run", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    const belts = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const;

    for (const stopId of belts) {
      gate.setPhase("flight");
      await gate.request({ ...marsRequest, stopId }); // flight: refused
      gate.setPhase("warp-break");
      await gate.request({ ...marsRequest, stopId });
      await gate.request({ ...marsRequest, stopId }); // duplicate: refused
      gate.setPhase("other"); // beacon, map
      await gate.request({ ...marsRequest, stopId });
    }

    // D92 budgets six calls per run; this is that number, enforced.
    expect(gate.calls).toBe(6);
    expect(client.calls).toHaveLength(6);
  });

  it("AC-15.3: re-entering the same phase does not buy a second call", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    gate.setPhase("warp-break");
    await gate.request(marsRequest);
    gate.setPhase("warp-break"); // no-op
    await gate.request(marsRequest);
    expect(gate.calls).toBe(1);
  });

  it("AC-15.3: two overlapping requests in one break still make one call", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client });
    gate.setPhase("warp-break");
    client.hold();

    const a = gate.request(marsRequest);
    // Second request arrives while the first is still in flight: the gate has
    // already disarmed, but has no memoised result to hand back yet.
    const b = await gate.request(marsRequest);
    expect(b.source).toBe("fallback");
    expect(b.failure).toBe("duplicate");

    client.release();
    expect((await a).source).toBe("live");
    expect(gate.calls).toBe(1);
  });

  it("a gate started in the warp-break phase is armed immediately", async () => {
    const client = countingClient();
    const gate = createCoachGate({ client, phase: "warp-break" });
    await gate.request(marsRequest);
    expect(gate.calls).toBe(1);
  });
});
