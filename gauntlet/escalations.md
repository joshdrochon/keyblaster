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
