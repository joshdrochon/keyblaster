# Definition of done — KeyBlaster

**Goal: 100%.** This file says exactly what 100% means, so that "done" is a
computed fact and not an opinion. Deadline: **Fri 2026-09-18 23:59 CDT**.

The user's assessment on the morning of Sep 16 was that the game was **~20% there,
visually and in every other facet**. That number is the baseline. This document is
what closing the remaining 80% consists of.

## The measure

`node scripts/tickets.mjs` builds one ticket per atomic commitment in the docs —
every acceptance criterion, functional requirement, decision, collision, rubric
item, screen-inventory row and open escalation — and computes each one's status
from evidence. Nothing in it accepts a typed status.

**100% = every ticket is `DONE` or `EXEMPT`.** Zero `OPEN`, zero `UNVERIFIED`,
zero `FALSE-PASS`, zero `BLOCKED`.

`npm run tickets:check` exits non-zero until that is true. That command is the
goal. There is no second opinion and no separate scoreboard.

What the states mean, because the difference is the whole point:

| State | Meaning |
|---|---|
| `DONE` | An assertion **names** it, and the evidence is fresher than the code it describes. |
| `EXEMPT` | Cannot produce a testable criterion, with the reason recorded. |
| `OPEN` | No test names it, or the check covering it is failing. |
| `UNVERIFIED` | Something claims it, but the citation is a comment or the evidence is stale. |
| `FALSE-PASS` | A check is green **and does not measure its claim.** Worst state. Read these first. |
| `BLOCKED` | Waiting on a human decision. Cannot be computed closed from this side. |

## Why the board is not the whole bar

A board of 315 green rows does not make a game good. Three things must also be true,
and none of them is a ticket:

1. **The game is completable.** `tests/e2e/playthrough.spec.ts` walks Earth→Pluto
   with real keystrokes and passes, at two different worker counts.
2. **A player agent finishes it.** `.claude/agents/game-mechanics` plays the game in
   a real browser and reports that the route completes and the mechanics hold.
3. **The world art passes a blind critic** against `design-reference/refs/world-bar.png`
   — a critic that did not build it and was given no framing. The commissioner's
   opinion does not count; that rule exists because it was already broken once.

## The two columns

Splitting this honestly matters, because a plan that quietly assumes someone else's
hour is a plan that misses.

### I can close these

- Every `OPEN`, `UNVERIFIED` and `FALSE-PASS` ticket.
- The 16 checks that are currently green and measure nothing.
- `src/game` coverage — 18.53% today, 50 of 72 files never executed.
- The playthrough spec, the belt, trophies, colourblind contrast.
- The world art work that is direction-independent: layer value ramp, atmospheric
  lift, hue shift with depth, dark framing foreground.

### Only the user can close these

- **30 `BLOCKED` tickets** — 26 escalations and 4 unresolved collisions (C10, C11,
  C12, C13). Each is written up in `gauntlet/escalations.md` with options, evidence
  and a lean. Most need a yes/no.
- **E-world-5** — the world-art direction call: terrain grammar with a horizon (A),
  space grammar with no ground plane (B), or palette re-baseline for hue (C). Lean
  B+C. This one gates how good the game can look.
- **Headed 60fps capture** for `P-22.9` and `L-6e.1`. Both are capped at 8 attempts
  and escalated. A headless renderer cannot produce this evidence.
- **The 2–3 minute demo video.** Hackathon requirement.
- **Deploy.** Never done from this side, ever.

Estimated user time: roughly one hour on the escalation queue, plus the capture and
the video.

**Therefore: 100% is reachable, but not by me alone.** The honest statement of the
goal is: every ticket I can close, closed; every ticket I cannot, written up and
waiting with a lean. If the escalation queue is still untouched at the deadline,
the board cannot reach 100% however much of the night is spent, and saying
otherwise would be the same false-green this project has spent two days digging out
of.

## Order of work

Set out in `gauntlet/queue.md`: P0 completable → P0.5 verified by playing → P1 feel
→ P2 the lying checks → P3 coverage → P4 everything else. Ordered so that stopping
at any point leaves the most valuable thing done.

## Gates before any commit

```
npx tsc --noEmit                                   # zero errors
npx vitest run tests/unit --coverage.enabled=false # all green
node scripts/trace-check.mjs                       # OK
node scripts/tickets.mjs                           # board regenerated
```

`scripts/precommit.sh` enforces these. Do not bypass it. No red merges.
