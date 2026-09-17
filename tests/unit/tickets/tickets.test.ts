import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { STATE, buildTickets, citationStrength, tally } from "../../../scripts/tickets.mjs";

/**
 * Tests for the ticket generator (scripts/tickets.mjs).
 *
 * The generator exists because three green artifacts lied in one night. A test
 * suite for it that only asserts "it produced some tickets" would be the fourth
 * lie, so every behavioural test below carries a NEGATIVE CONTROL: an input the
 * check must REJECT. A test that cannot fail is not evidence, and this file is
 * the last place that lesson should have to be relearned.
 */

const REPO = resolve(__dirname, "../../..");
const tickets = buildTickets();

describe("citationStrength grades the binding, not the mere presence of an id", () => {
  // The defect this replaces: trace-check.mjs asks `tests.includes(id)` over
  // every test file concatenated, so an AC named in a COMMENT counts as
  // covered. That is how 96/105 ACs came to look cited.
  const strong = [
    { path: "a.test.ts", src: `it("AC-9.9 the hull drops by one", () => { expect(1).toBe(1); });` },
  ];
  const weak = [
    { path: "b.test.ts", src: `// AC-9.9 used to be checked here\nit("something else", () => {});` },
  ];
  const none = [{ path: "c.test.ts", src: `it("unrelated", () => {});` }];

  it("STRONG when the id names a running assertion", () => {
    const r = citationStrength("AC-9.9", strong);
    expect(r.level).toBe("STRONG");
    expect(r.files).toEqual(["a.test.ts"]);
  });

  it("NEGATIVE CONTROL: WEAK when the id appears only in a comment", () => {
    // If this ever returns STRONG the grader has collapsed back into a
    // substring scan and the whole board reverts to trace-check's optimism.
    expect(citationStrength("AC-9.9", weak).level).toBe("WEAK");
  });

  it("NEGATIVE CONTROL: NONE when no test mentions it", () => {
    expect(citationStrength("AC-9.9", none).level).toBe("NONE");
    expect(citationStrength("AC-9.9", none).files).toEqual([]);
  });

  it("a dotted id is matched literally, not as a regex wildcard", () => {
    // "AC-9.9" must not match "AC-949". Without escaping, `.` matches any
    // character and the board silently credits the wrong ticket.
    const decoy = [{ path: "d.test.ts", src: `it("AC-949 unrelated", () => {});` }];
    expect(citationStrength("AC-9.9", decoy).level).toBe("NONE");
  });

  it("the id is found mid-title, not only at the start", () => {
    // REGRESSION. An earlier revision used a self-referential backreference,
    // which collapsed the "any characters before the id" clause to zero
    // characters. Every fixture above happens to put the id first, so all of
    // them still passed while real titles like "D27 / AC-4.4 ..." silently
    // dropped to WEAK. A correct test that is not representative reads like
    // coverage and is worse than no test.
    expect(
      citationStrength("AC-4.4", [
        { path: "g.test.ts", src: `it("D27 / AC-4.4 each charted stop shows its stars", () => {});` },
      ]).level,
    ).toBe("STRONG");
  });

  it("describe() titles count, and it.each / test.skip variants are seen", () => {
    expect(
      citationStrength("AC-9.9", [
        { path: "e.test.ts", src: `describe("AC-9.9 group", () => { it("x", () => {}); });` },
      ]).level,
    ).toBe("STRONG");
    expect(
      citationStrength("AC-9.9", [{ path: "f.test.ts", src: `it.each([1])("AC-9.9 %i", () => {});` }])
        .level,
    ).toBe("STRONG");
  });
});

describe("the board's shape holds", () => {
  it("produces a ticket per atomic commitment across all seven sources", () => {
    const kinds = new Set(tickets.map((t: { kind: string }) => t.kind));
    expect([...kinds].sort()).toEqual([
      "ac",
      "collision",
      "decision",
      "escalation",
      "fr",
      "rubric",
      "screen",
    ]);
    // The PRD's own counts. If an AC is added to the PRD and the board does not
    // grow, the parser has silently stopped matching a line shape.
    expect(tickets.filter((t: { kind: string }) => t.kind === "ac")).toHaveLength(106);
    expect(tickets.filter((t: { kind: string }) => t.kind === "rubric")).toHaveLength(33);
  });

  it("every ticket id is unique", () => {
    const ids = tickets.map((t: { id: string }) => t.id);
    const dupes = ids.filter((id: string, i: number) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("every ticket carries a state from the enum and a non-empty reason", () => {
    const states = new Set(Object.values(STATE));
    for (const t of tickets as { id: string; state: string; why: string }[]) {
      expect(states.has(t.state), `${t.id} has state "${t.state}"`).toBe(true);
      expect(t.why?.length, `${t.id} has no reason`).toBeGreaterThan(0);
    }
  });

  it("the tally sums to the ticket count", () => {
    const t = tally(tickets);
    const counts = Object.values(t) as number[];
    expect(counts.reduce((a, b) => a + b, 0)).toBe(tickets.length);
  });
});

describe("status is computed, and the known lies stay marked", () => {
  const byId = (id: string) =>
    (tickets as { id: string; state: string; why: string }[]).find((t) => t.id === id);

  it("a rubric item that does not measure its claim is FALSE-PASS, not DONE", () => {
    // Structural, not pinned to one defect. An earlier revision hardcoded
    // V-22.8; when that was fixed at source the test failed, which made it a
    // tripwire on progress rather than a check on the mechanism. Every entry
    // in the pessimism list must reach the board as FALSE-PASS, whichever
    // entries the list currently holds.
    const entries = JSON.parse(
      readFileSync(resolve(REPO, "gauntlet/known-false-passes.json"), "utf8"),
    ) as { id: string }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(byId(`KB-${e.id}`)?.state, `${e.id} should be FALSE-PASS`).toBe(STATE.FALSE_PASS);
    }
  });

  it("FALSE-PASS propagates from a rubric item up through its AC to its FR", () => {
    // The point of the board: a broken check cannot leave the requirement
    // above it looking green. Asserted on whichever rubric item currently
    // carries the defect and cites an AC, so fixing one does not break this.
    const all = tickets as { id: string; kind: string; state: string; refs?: string[] }[];
    const broken = all.filter(
      (t) => t.kind === "rubric" && t.state === STATE.FALSE_PASS && (t.refs ?? []).some((r) => r.startsWith("AC-")),
    );
    expect(broken.length, "no FALSE-PASS rubric item cites an AC").toBeGreaterThan(0);

    for (const item of broken) {
      for (const acId of (item.refs ?? []).filter((r) => r.startsWith("AC-"))) {
        const ac = byId(`KB-${acId}`);
        if (!ac) continue; // the rubric may cite an AC the PRD has since renamed
        expect(ac.state, `${acId} via ${item.id}`).toBe(STATE.FALSE_PASS);
        const fr = byId(`KB-FR-${acId.replace(/^AC-/, "").split(".")[0]}`);
        if (fr) expect(fr.state, `FR above ${acId}`).toBe(STATE.FALSE_PASS);
      }
    }
  });

  it("a feature with no implementation is not DONE however green its tests are", () => {
    // Twelve trophies, zero writers to profile.trophies.
    expect(byId("KB-AC-6d.1c")?.state).toBe(STATE.FALSE_PASS);
  });

  it("NEGATIVE CONTROL: not everything is FALSE-PASS", () => {
    // A board that marks everything broken is as useless as one that marks
    // everything done, and would make the assertions above pass vacuously.
    const t = tally(tickets);
    expect(t[STATE.DONE]).toBeGreaterThan(50);
    expect(t[STATE.FALSE_PASS]).toBeLessThan(tickets.length / 4);
  });

  it("escalations are always BLOCKED - nothing on this side can clear them", () => {
    const esc = (tickets as { kind: string; state: string }[]).filter((t) => t.kind === "escalation");
    expect(esc.length).toBeGreaterThan(0);
    expect(esc.every((t) => t.state === STATE.BLOCKED)).toBe(true);
  });

  it("an unresolved collision is BLOCKED", () => {
    // C11, C12 and C13 all carry "Status: unresolved" in the decision log.
    expect(byId("KB-C13")?.state).toBe(STATE.BLOCKED);
  });

  it("an exempt decision states the reason it is exempt", () => {
    const d = byId("KB-D35"); // stack choice; nothing to build
    expect(d?.state).toBe(STATE.EXEMPT);
    expect(d?.why).toMatch(/Phaser/);
  });
});

describe("the false-pass list cannot rot silently", () => {
  const entries = JSON.parse(
    readFileSync(resolve(REPO, "gauntlet/known-false-passes.json"), "utf8"),
  ) as { id: string; why: string; cite: { file: string; quote: string } }[];

  it("every entry quotes text that is still present in the audit it cites", () => {
    // This is the guard that stops the list becoming another summary.md:
    // an entry whose evidence has been edited away fails here rather than
    // quietly continuing to mark a ticket broken (or, worse, being dropped).
    for (const e of entries) {
      const doc = readFileSync(resolve(REPO, e.cite.file), "utf8");
      expect(doc.includes(e.cite.quote), `${e.id}: quote missing from ${e.cite.file}`).toBe(true);
    }
  });

  it("every entry names a real rubric item or a real AC", () => {
    // The off-by-one that shipped in the first draft: "L-6e.2" matched nothing
    // and its finding stopped being tracked in silence.
    const known = new Set(
      (tickets as { id: string }[]).map((t) => t.id.replace(/^KB-/, "")),
    );
    for (const e of entries) {
      expect(known.has(e.id), `${e.id} matches no ticket`).toBe(true);
    }
  });

  it("every entry explains itself in more than a word", () => {
    for (const e of entries) expect(e.why.length).toBeGreaterThan(40);
  });
});
