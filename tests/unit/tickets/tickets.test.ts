import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - .mjs tooling module, no type declarations by design
import { STATE, buildTickets, citationStrength, rubricState, tally } from "../../../scripts/tickets.mjs";

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
    // REPRESENTATIVE FIXTURE, and the previous one was not. It used only
    // `it("AC-949 unrelated")`, which citationStrength rejects at the
    // `includes(id)` short-circuit before the regex ever runs - so the test
    // passed with the regex escaping REMOVED and never exercised the thing it
    // named. The literal id has to be present in the file for the escaping to
    // matter at all.
    const decoy = [
      { path: "d.test.ts", src: `// AC-9.9 was moved
it("AC-949 unrelated", () => {});` },
    ];
    expect(citationStrength("AC-9.9", decoy).level).toBe("WEAK");
  });

  it("an id that is a strict prefix of a longer id is not credited", () => {
    // Live false pass: AC-6d.1 was DONE on tests titled "AC-6d.1c ...", i.e.
    // certified by the exact tests a pessimism entry had flagged as measuring
    // nothing.
    const longer = [{ path: "e.test.ts", src: `it("AC-6d.1c trophies are earned", () => {});` }];
    expect(citationStrength("AC-6d.1", longer).level).toBe("NONE");
    expect(citationStrength("AC-6d.1c", longer).level).toBe("STRONG");
  });

  it("a skipped, todo or empty citation is not an assertion", () => {
    // CLAUDE.md: "No skipped tests on main." A skipped test is precisely a
    // citation with no assertion behind it, and an earlier revision of THIS
    // FILE advertised "test.skip variants are seen" as a correctness property.
    for (const src of [
      `it.skip("AC-9.9 pending", () => {});`,
      `it.todo("AC-9.9 later");`,
      `describe.skip("AC-9.9 group", () => { it("x", () => {}); });`,
    ]) {
      expect(citationStrength("AC-9.9", [{ path: "f.test.ts", src }]).level, src).not.toBe(
        "STRONG",
      );
    }
  });

  it("a commented-out test is WEAK, which is what WEAK means", () => {
    const src = `// it("AC-9.9 the hull drops by one", () => { expect(1).toBe(1); });`;
    expect(citationStrength("AC-9.9", [{ path: "g.test.ts", src }]).level).toBe("WEAK");
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
        // Find the parent by DECLARED ownership. Deriving it from the id -
        // `FR-${acId.split(".")[0]}` - is the exact bug this test used to
        // contain: it bound AC-22.4 to FR-22, which does not own it.
        const parent = (tickets as { kind: string; state: string; refs?: string[] }[]).find(
          (t) => t.kind === "fr" && (t.refs ?? []).includes(`KB-${acId}`),
        );
        expect(parent, `no requirement owns ${acId}`).toBeDefined();
        expect(parent?.state, `requirement above ${acId}`).toBe(STATE.FALSE_PASS);
      }
    }
  });

  it("an AC whose covering rubric item is stale is never DONE", () => {
    // The staleness pillar, asserted where it was previously discarded. An
    // earlier revision computed freshness for rubric items and then threw it
    // away at the AC boundary, so 105 of 184 DONE rows were certified by a
    // definition - "evidence fresher than the code" - whose second clause was
    // never evaluated for them.
    const all = tickets as { id: string; kind: string; state: string; refs?: string[] }[];
    const staleRubric = new Set(
      all.filter((t) => t.kind === "rubric" && t.state === STATE.UNVERIFIED).map((t) => t.id.replace(/^KB-/, "")),
    );
    if (staleRubric.size === 0) return; // nothing stale right now; vacuously fine
    for (const ac of all.filter((t) => t.kind === "ac")) {
      const coveredByStale = (ac.refs ?? []).some((r) => staleRubric.has(r));
      if (coveredByStale) {
        expect(ac.state, `${ac.id} is covered by a stale rubric item`).not.toBe(STATE.DONE);
      }
    }
  });

  it("NEGATIVE CONTROL: not everything is FALSE-PASS", () => {
    // A board that marks everything broken is as useless as one that marks
    // everything done, and would make the assertions above pass vacuously.
    const t = tally(tickets);
    expect(t[STATE.DONE]).toBeGreaterThan(50);
    expect(t[STATE.FALSE_PASS]).toBeLessThan(tickets.length / 4);
  });

  it("an escalation is BLOCKED unless its section says otherwise", () => {
    // This used to assert `every(BLOCKED)`, which was true only because
    // nothing could ever clear one - writing the decision into the file
    // changed nothing. That made zero-BLOCKED, the definition of 100%,
    // unreachable by construction. Resolution is now a readable marker;
    // the detailed cases live in the escalation describe block below.
    const esc = (tickets as { kind: string; state: string }[]).filter((t) => t.kind === "escalation");
    expect(esc.length).toBeGreaterThan(0);
    expect(esc.every((t) => t.state === STATE.BLOCKED || t.state === STATE.DONE)).toBe(true);
    expect(esc.some((t) => t.state === STATE.BLOCKED)).toBe(true);
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

describe("rubricState: the staleness branch can actually be exercised", () => {
  /**
   * These exist because a critic mutated `tickets.mjs` and found the suite
   * green at 20/20 with the staleness downgrade DELETED, and green again with
   * `newestSourceMtime()` stubbed to 0 so nothing is ever stale. The signal
   * credited in this file's own header as one of its three questions had zero
   * coverage. A check whose removal nothing notices is not a check.
   */
  const pass = { status: "PASS", title: "t", measurement: "measured 5 things" };

  it("a PASS with fresh evidence is DONE", () => {
    expect(rubricState({ result: pass, stale: false, ageMs: 0 }).state).toBe(STATE.DONE);
  });

  it("NEGATIVE CONTROL: the same PASS with stale evidence is NOT DONE", () => {
    // This is the mutation that went undetected. If the branch is removed,
    // this returns DONE and fails here.
    const r = rubricState({ result: pass, stale: true, ageMs: 3600e3 });
    expect(r.state).toBe(STATE.UNVERIFIED);
    expect(r.why).toMatch(/predates/);
  });

  it("a false-pass entry outranks a green report", () => {
    const r = rubricState({ result: pass, falsePass: { why: "measures the wrong thing" }, stale: false });
    expect(r.state).toBe(STATE.FALSE_PASS);
    expect(r.why).toBe("measures the wrong thing");
  });

  it("FAIL is OPEN and carries the measurement as its reason", () => {
    const r = rubricState({ result: { status: "FAIL", measurement: "1.02:1" }, stale: false });
    expect(r.state).toBe(STATE.OPEN);
    expect(r.why).toBe("1.02:1");
  });

  it("ESC! is BLOCKED — the token report.md actually writes", () => {
    // report.md writes `ESC!`; the parser only accepted `ESCALATED`, so this
    // branch was unreachable and both escalated items fell through to OPEN
    // with the reason "no row for this item", which was factually false.
    expect(rubricState({ result: { status: "ESC!" }, stale: false }).state).toBe(STATE.BLOCKED);
    expect(rubricState({ result: { status: "ESCALATED" }, stale: false }).state).toBe(STATE.BLOCKED);
  });

  it("a missing row is OPEN, and says so honestly", () => {
    const r = rubricState({ result: undefined, stale: false });
    expect(r.state).toBe(STATE.OPEN);
    expect(r.why).toMatch(/no row/);
  });

  it("NEGATIVE CONTROL: the states are not all the same", () => {
    // Guards against a mutation that collapses every branch to one value,
    // which would satisfy several of the assertions above individually.
    const states = new Set([
      rubricState({ result: pass, stale: false }).state,
      rubricState({ result: pass, stale: true, ageMs: 1 }).state,
      rubricState({ result: { status: "FAIL" }, stale: false }).state,
      rubricState({ result: { status: "ESC!" }, stale: false }).state,
    ]);
    expect(states.size).toBe(4);
  });
});

describe("requirement ownership is read from the document, not guessed", () => {
  const all = tickets as { id: string; kind: string; state: string; title: string; refs?: string[] }[];

  it("FR-22 owns the punishment criteria, not the visual ones", () => {
    // It previously owned nine AC-22.x visual criteria, because ownership was
    // inferred by string surgery on the id (AC-22.1 -> FR-22). FR-22 is
    // "Nothing reads as punishment" and owns AC-22b.1/.2.
    const fr22 = all.find((t) => t.id === "KB-FR-22");
    expect(fr22?.title).toMatch(/punishment/i);
    expect([...(fr22?.refs ?? [])].sort()).toEqual(["KB-AC-22b.1", "KB-AC-22b.2"]);
  });

  it("every AC has exactly one requirement parent", () => {
    // The silent-absence guard. AC-19.x, AC-20.x, all seven audio AC-21.x and
    // AC-22b.x previously had NO parent row, because the parser matched only
    // `**FR-n Title.**` and those sections use `### 3.x` headings. Nothing
    // reported it.
    const acIds = all.filter((t) => t.kind === "ac").map((t) => t.id);
    const parentOf = new Map<string, string[]>();
    for (const r of all.filter((t) => t.kind === "fr")) {
      for (const child of r.refs ?? []) {
        if (!parentOf.has(child)) parentOf.set(child, []);
        parentOf.get(child)!.push(r.id);
      }
    }
    const orphans = acIds.filter((id) => !parentOf.has(id));
    expect(orphans, `ACs with no requirement parent: ${orphans.join(", ")}`).toEqual([]);
    const shared = acIds.filter((id) => (parentOf.get(id) ?? []).length > 1);
    expect(shared, `ACs claimed by two requirements: ${shared.join(", ")}`).toEqual([]);
  });

  it("the audio criteria have a parent and it is not pretending to be done", () => {
    const audioParent = all.find(
      (t) => t.kind === "fr" && (t.refs ?? []).some((r) => r.startsWith("KB-AC-21.")),
    );
    expect(audioParent, "no requirement owns the audio ACs").toBeDefined();
    expect(audioParent?.refs?.length).toBeGreaterThanOrEqual(7);
  });
});

describe("escalations can be closed, and their ids are stable", () => {
  const esc = (tickets as { id: string; kind: string; state: string; why: string }[]).filter(
    (t) => t.kind === "escalation",
  );

  it("ids are derived from the heading, not from position", () => {
    // `KB-ESC-01` meant inserting one escalation at the top of the file
    // renumbered every other ticket. These are tracked across days.
    expect(esc.length).toBeGreaterThan(0);
    for (const t of esc) expect(t.id).not.toMatch(/^KB-ESC-\d+$/);
  });

  it("a section marked resolved is DONE, not BLOCKED", () => {
    // Previously every heading was BLOCKED unconditionally, so writing the
    // decision into the file changed nothing and only deleting the heading
    // closed it. Zero-BLOCKED is the definition of 100%, so 100% was
    // unreachable by construction.
    const resolved = esc.filter((t) => t.state === STATE.DONE);
    expect(resolved.length, "no escalation is marked resolved in the file").toBeGreaterThan(0);
    for (const t of resolved) expect(t.why).toMatch(/resolved/i);
  });

  it("NEGATIVE CONTROL: not every escalation is DONE", () => {
    expect(esc.some((t) => t.state === STATE.BLOCKED)).toBe(true);
  });

  it("an unresolved escalation says how to close it", () => {
    for (const t of esc.filter((x) => x.state === STATE.BLOCKED)) {
      expect(t.why).toMatch(/Resolved/);
    }
  });
});
