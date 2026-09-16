# Escalations (morning review queue)
Items the loop could not resolve or that pass numerically but read flat. Never marked passed. See architecture §10.1 step 5.

## AC-10.2 — controller cannot reach the 85% band for weak typists

- **Escalated:** 2026-09-16 (build night 1)
- **Source:** PRD FR-10 / AC-10.2, D53, D17, D18
- **Attempts:** n/a — this is not a fix-and-retry item. The target is arithmetically unreachable with the documented knobs, so retrying cannot help.
- **Evidence:** `tests/unit/controller/convergence.test.ts` (200 stages x 50 seeds, mulberry32), plus the exhaustive-search diagnostic in the same file.

### What the check says

> AC-10.2 Given a simulated player with fixed true accuracy p, long-run measured
> hit rate converges to [0.80, 0.90] for p in [0.5, 0.99].

### What was measured

| p | long-run measured rate | best reachable | shortfall |
|---|---|---|---|
| 0.50 | 0.584 | 0.630 | 0.216 |
| 0.55 | 0.629 | 0.671 | 0.171 |
| 0.60 | 0.672 | 0.711 | 0.128 |
| 0.65 | 0.715 | 0.750 | 0.086 |
| 0.70 | 0.755 | 0.788 | 0.045 |
| 0.75 | 0.791 | 0.826 | 0.009 (4/50 seeds in band) |
| 0.80 - 0.99 | 0.820 - 0.841 | — | in band, 50/50 seeds |

### Why, and why it is structural rather than a bad simulation

The two knobs FR-10 gives the controller (`maxLive` 2-7, `lengthBias` -1..+1) change
**what the player is asked to do**. Neither changes **how well they type**. The best
reachable hit rate is therefore the player's accuracy on the shortest word at the
loosest asteroid count. For p below roughly 0.78 that ceiling is itself under 0.80,
so no rule built from these two knobs can land in the band. A diagnostic test proves
this by exhaustive search over all 18 knob states, independent of the controller.

Tightening authority is ample (a p=0.99 player is pushed below 0.80). Only loosening
authority is capped, and it is capped by the player, not by the rule.

The knob that would give the needed authority is **fall time** — but D19/FR-8 owns
fall time as a per-word, per-player value, and AC-10.4 explicitly forbids making
world speed a knob. So this cannot be fixed inside FR-10 without crossing a decision.

### Options (user decision — none taken)

| # | Option | Cost |
|---|---|---|
| A | Narrow AC-10.2's range to `p in [0.78, 0.99]` and document the ceiling | Honest and cheap. Admits the engine cannot rescue the very weakest typist through these knobs alone. |
| B | Let the controller scale the per-word `recognitionBudget` multiplier for struggling players | Crosses into D19's territory; needs a new decision and a collision entry. Gives real authority at the low end. |
| C | Add a documented warm-up/assist path for p < 0.78 (guaranteed-catch share rises, pool restricted to shortest words) | Closest to D22's existing guaranteed-catch idea; more design work, no collision. |

**Lean: C, then A as the fallback.** C keeps D19 intact, reuses a mechanism the PRD
already has (AC-9.2 guaranteed-catch), and targets exactly the population that needs
it — a grade-2 reader at p=0.6 is precisely the learner this game exists for, and
option A would define them out of scope rather than serve them.

### Status

NOT PASSED. The controller ships implementing the documented rules exactly; the
assertion remains in the suite, named as escalated, and will start failing loudly
again the moment the spec changes.

## AC-20.1 / FR-15 — `accuracy` mixes words and keystrokes

- **Escalated:** 2026-09-16 (build night 1)
- **Source:** PRD AC-3.2, AC-3.4, AC-20.1; D31
- **Found by:** independent critic review of `src/engine/scoring`
- **Attempts:** n/a — inherited from the PRD, not a code defect. Implemented as documented.

### The problem

`accuracy = hits / (hits + typos)` is the documented formula. But the two counters
are in different units:

- `hits` increments once per **word completed** (AC-3.4)
- `typos` increments once per **keystroke** (AC-3.2)

So the denominator adds words to keystrokes. A player who completes 19 words
(about 100 characters) with 1 wrong keystroke is reported at **95%**. Their
per-keystroke accuracy is about **99%**.

### Why it matters rather than being pedantic

This is the number printed on a child's results screen (AC-20.1). D31 is explicit
that the player should feel like the best typer in the world, and that measured
success near 85% should feel near 100%. A formula that reads roughly five times
harsher than the intuitive meaning of "accuracy" pushes in exactly the wrong
direction, and it does so more the *longer* the words are — penalising the
stronger readers the length knob is supposed to reward.

### Options (user decision — none taken)

| # | Option | Cost |
|---|---|---|
| A | Keep as documented. It matches Type Storm's own `hits/(hits+typos)`. | Free, but ships a misleading number to the learner. |
| B | Count keystrokes on both sides: `correctKeystrokes / (correctKeystrokes + typos)`. | Small change to FR-7/scoring; needs `correctKeystrokes` on the stage tally. Reads as an accuracy a child and a parent would recognise. |
| C | Keep `hits/(hits+typos)` for the engine's internal signal, display the keystroke figure. | Two numbers to keep straight; clearest split between "what tunes difficulty" and "what we tell the child". |

**Lean: B.** The engine does not actually need the word-level ratio — the
controller runs on HIT RATE (blasted / spawned, FR-10), which is a different
quantity and unaffected. So B changes only what is displayed, and makes the
displayed number mean what its label says.

### Status

NOT PASSED. Shipped as documented.

## PROCESS — the loop asked the user a blocking question (fixed)

- **Logged:** 2026-09-16 (build night 1)
- **Severity:** process defect, not a product defect

Twice during night one the run stopped and waited for a human: once for repo
visibility and branch naming, once for the overnight mechanism. A third
interruption came from a subagent that was instructed to fetch NASA/JPL
Horizons, which is a network call that was not pre-granted.

That is a failure of the loop regardless of how reasonable each question was.
An unattended run that halts at 3am has produced nothing overnight.

**Fixed by D94:** no blocking questions during an unattended run; decisions go
here with options and a lean, and the run continues on the documented
behaviour. Permissions pre-granted in `.claude/settings.json`, with the D87
guardrails written as deny rules so they cannot be relaxed by accident.

Nothing about the two decisions already taken changes — private repo, `main`
as the default branch, `/loop` as the mechanism. They are recorded here only so
the interruption itself is in the review queue.
