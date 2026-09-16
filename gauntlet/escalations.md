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

## C10 — AC-3.3 "ignored" vs typo (collision, user decision)

- **Logged:** 2026-09-16 (build night 1)
- **Source:** PRD AC-3.3, AC-3.2, AC-6e.2; D24, D31; architecture §4.1
- **Found by:** independent critic review of `src/engine/lock`

AC-3.3: "No switching: keystrokes matching other asteroids are ignored while
locked." The lock lane implemented "ignored" as a typo.

That is not a cosmetic difference. A typo has two downstream consequences:
`scoring/combo.ts` resets the combo to zero, and architecture §4.1 raises the
word's ease by 5%, which makes it fall faster next time. So under the shipped
reading, brushing a key that belongs to a rock the child is **not** typing costs
them their score multiplier and makes their current word harder. D31 forbids
exactly that direction.

| # | Option | Cost |
|---|---|---|
| A | Literal AC-3.3: shake, no count, no combo break, no ease change | Chosen for now. AC-6e.2 still satisfied — every keystroke gets visible feedback. Slightly inflates the FR-7 accuracy statistic, because a real mis-keystroke goes unrecorded. |
| B | Count it as a typo, as first built | Accurate statistics; punishes the child for a key that was never part of their word. |
| C | Count it in the FR-7 word record but do NOT break the combo or raise ease | Keeps the statistic honest and the felt experience kind. More state to thread; a third category of keystroke to explain. |

**Lean: C**, with A shipping until decided. C is the only option that serves both
the engine's need for an honest signal and D31's requirement that nothing read as
punishment. A is shipping now because it is what AC-3.3 literally says, and the
collision rule forbids silently overwriting a decided AC.

### Status

NOT PASSED. Build proceeds on A. C10 stays open in the decision log.

## AC-9.2 — no guaranteed-catch word can exist on a fresh profile

- **Escalated:** 2026-09-16 (build night 1)
- **Source:** PRD FR-9 / AC-9.2, D22, architecture §4.2; interacts with `EASE_NEW` in FR-8
- **Found by:** the selection lane, while implementing the rule as written
- **Attempts:** n/a — arithmetic, not a bug. Implemented as documented.

### The problem

AC-9.2 requires at least one guaranteed-catch word in every 6 consecutive
spawns. Guaranteed-catch is defined as:

> mastered, OR ≤4 letters with ease ≤ 1.0

A word the player has never seen starts at `EASE_NEW = 1.6` (PRD FR-8,
architecture §4.1). On a brand-new profile every word in the stage pool is
unseen, so **every word has ease 1.6** and none can qualify — not the mastered
branch, not the ≤4-letters branch.

So the first six asteroids a child ever sees are guaranteed to contain **no**
guaranteed-catch word. The rule is unsatisfiable exactly when it matters most:
D22 exists so that a struggling player always has something they can hit, and
the very first wave is when a 7-year-old decides whether this game is for them.

It self-corrects after a few hits pull some ease below 1.0, so it is invisible
in any test that starts from a warmed-up profile — which is why it survived
until someone implemented the predicate literally.

### Options (user decision — none taken)

| # | Option | Cost |
|---|---|---|
| A | Add a fallback: if no word qualifies, the shortest available word is the guaranteed catch | One clause. Makes AC-9.2 hold literally at all times. "Shortest available" is a reasonable proxy for "easiest" when nothing is known. |
| B | Lower `EASE_NEW` below 1.0 | Cheap, but wrong: it would also shorten every new word's fall time through FR-8, making the game harder for a beginner — the opposite of the intent. |
| C | Exempt the first stage from AC-9.2 | Honest but abandons D22 at the only moment it is load-bearing. |

**Lean: A.** It is the smallest change, it preserves the ease semantics FR-8
depends on, and "the shortest word you have" is exactly what a teacher would
pick when they know nothing about the child yet.

### Status

NOT PASSED. The selection lane implements the documented predicate, degrades
gracefully rather than stalling (it returns a normal word and flags
`relaxed: ["catch"]`), and exports `poolHasCatchWord()` so content tooling can
detect the state. Two tests pin the current behaviour.

## C11 — D92's coach model id is probably wrong (one-line fix)

- **Logged:** 2026-09-16 (build night 1)
- **Source:** D92; PRD FR-15, AC-15.1, AC-15.5; D52 (demo script)
- **Found by:** the coach lane, flagged as a doc concern; verified against the
  Anthropic API model table rather than from memory.

D92 specifies the model id `claude-haiku-4-5-20251001`.

The current API model table lists Claude Haiku 4.5 as the bare id
**`claude-haiku-4-5`**, and says current-generation ids are complete as written
and must never be given a date suffix — date-suffixed variants of current models
are a known training-data artifact. D92's pricing ($1 / $5 per MTok) matches the
table and is not in question; only the id string is.

### Why it matters more than it looks

A wrong id returns 400. The client's 1500 ms timeout and shipped fallback
(AC-15.1) catch it perfectly — which is the problem. The failure is **silent**:
the game looks completely healthy and every coach note quietly comes from the
shipped bundle. D52's demo beat and AC-15.5 both depend on showing a coach note
that names the two words the player just missed. On camera, that would be the
fallback.

Nothing tonight is affected: the gauntlet and the demo default to `MockCoach`
(D87), and `/api/coach` is never deployed by this loop.

| # | Option | Cost |
|---|---|---|
| A | Change D92's id to `claude-haiku-4-5` | One line. What the API documents. |
| B | Keep the dated string | Live coach path is dead; every note is the fallback, undetectably. |

**Lean: A.** This is a fact, not a judgement — but D92 is a user decision and
the collision rule forbids silently overwriting one, so it is logged as C11 and
shipped as written.

### Status

NOT PASSED. `COACH_MODEL` carries D92's string verbatim; `options.model`
overrides it, so adopting A is a one-line change in one place.

## Design brief's flat "+25% Spanish" is wrong for short labels

- **Logged:** 2026-09-16 (build night 1)
- **Source:** docs/design-brief-v2.md "Languages"; D45
- **Found by:** the i18n lane, measuring real translations instead of trusting the number
- **Attempts:** n/a — a layout constant, not a bug. Implemented as written.

The brief tells designers to "design text containers for Spanish length (+25%)".
Measured against the 31 real UI strings now in the string tables, **6 exceed it**:

| Key | English | Spanish | Growth |
|---|---|---|---|
| Locked | `Locked` | `Bloqueado` | +50% |
| Pilot name | `Pilot name` | `Nombre del piloto` | +70% |
| Beacon Log | `Beacon Log` | `Registro de balizas` | +90% |

The pattern is the problem: growth is **inversely** related to length. Long
sentences average well under +25%; short labels blow past it, because Spanish
pays a fixed cost in articles and prepositions that a two-word English label
cannot amortise. Short labels are exactly where a fixed-width plate clips.

### Why it is time-sensitive

Five scene lanes are building UI against the +25% figure right now. A container
sized on it will clip `Registro de balizas` in Spanish and will not be caught by
an English-only screenshot.

| # | Option | Cost |
|---|---|---|
| A | Per-length budget: +90% under 12 chars, +50% to 25 chars, +25% above | Matches the measured data. Three numbers instead of one. |
| B | Containers size to content with a min width, never fixed-width labels | Most robust; more layout work per screen. |
| C | Keep +25% and shorten the Spanish strings | Cheapest, but distorts the translation to fit the box. |

**Lean: B, with A as the sizing sanity-check in tests.** `fit.test.ts` now pins
the exact over-budget list as a regression guard, so whichever is chosen the
list cannot silently grow.

### Status

NOT PASSED. Brief's number shipped as written; the scene lanes have been told to
size to content rather than to the constant.

## C12 — ambient beds are procedural, not pre-rendered (collision vs D63)

- **Logged:** 2026-09-16 (build night 1)
- **Source:** D63, D88; PRD AC-21.1
- **Found by:** the audio lane, which correctly refused to resolve it itself

D63 says the seven per-planet ambient beds are rendered by ElevenLabs at build
time and shipped as files. There is no `ELEVENLABS_API_KEY`, so the lane
synthesised all seven procedurally in Web Audio.

D88 already made exactly this substitution for Shadow's **voice** — system voice
as the stand-in, swap is one module — but D88 speaks only to voice. The beds
were never covered, so this is a real collision rather than a case already
decided.

The alternative was seven filenames that 404.

| # | Option | Cost |
|---|---|---|
| A | Keep procedural beds | Seven beds that actually play, today, with no key and no cost. Swap point is `buildBedVoice`, one module. |
| B | Pre-render with ElevenLabs when a key lands | Matches D63 as written; richer beds; needs the key, a build step, and shipped audio files. |

**Lean: A now, B if the key arrives before Friday.** AC-21.1 asks that a bed
exists per stop and crossfades on transition — it is silent on provenance, so A
satisfies the AC as written and B is an upgrade, not a fix.

### Status

NOT PASSED as D63 writes it. Shipping A; C12 stays open in the decision log.

## FOUNDATION lane (boot / render / Title) — decisions taken, review requested

| # | Decision | Options | What I did and why |
|---|---|---|---|
| F1 | Title palette for a FIRST-TIME player | (a) Earth, (b) Mars (the design brief's worked example) | **(a) Earth.** Narratively you are on the launchpad and the gold beacon accent is the brand colour. (b) is warmer and would likely photograph better for a judge. One-line change in `TitleScene.create`. |
| F2 | Secondary actions on the Title | (a) primary only, (b) primary + Settings, (c) primary + Settings + Beacon Log | **(b).** The brief says "one primary action" and puts the Beacon Log and Settings entries on the Director map, but a title screen with nothing to Tab to reads unfinished. |
| F3 | i18n translator mode in the game layer | (a) `dev` (throws on a missing key), (b) `prod` + a loud miss log | **(b).** A missing string must not take a screen down at 3am (D94). Misses are pushed to `window.__kb.i18nMisses`, logged as console errors, and the Title e2e asserts the list is empty — so nothing is hidden. |
| F4 | Wordmark typeface | (a) system font stack, (b) load a Google Font (D81) | **(a).** No lane owns font loading and a webfont fetch would make the offline/headless runs flaky. D81 wants a rounded geometric display face; this is a real gap against art-direction section 7, not a finished answer. |
| F5 | `trace: "off"` in `tests/e2e/title.spec.ts` | (a) leave the config default, (b) disable traces for this file | **(b), as a workaround, not a fix.** All lanes share one `test-results/` directory; a concurrent run clears it mid-flight and `browserContext.close` dies on ENOENT *after* the assertions pass. The real fix is a per-run `outputDir` in `playwright.config.ts`, which this lane may not edit. |

## Warp / Beacon / Results / Ending lane — four decisions and one measurement

- **Escalated:** 2026-09-16 (build night 1)
- **Source:** screens 7, 8, 9, 12 of the design brief's screen inventory
- **Status:** all five SHIPPED with the documented behaviour; none blocked the loop (D94).

### 1. Two rules live in `src/game` because the lane could not write `src/engine`

`src/game/scenes/support/warpSentence.ts` (D30 / AC-16.2 / AC-16.3) and
`src/game/scenes/support/relativeBoard.ts` (D43's "up to two above and two
below") are RULES. CLAUDE.md says rules live in `src/engine`; the lane brief
says a scene lane may not write there. Both files are written to engine rules -
pure, no Phaser, no DOM, no clock - so moving them is a `git mv` plus an import
rewrite, and they then fall under the 95% coverage gate they currently escape.

| Option | Cost |
|---|---|
| A | Move both into `src/engine/warp/` and `src/engine/board/` and unit-test them | one commit; closes the coverage gap |
| B | Leave them in the scene lane | rules outside the tested engine, which is the thing the hard rule exists to prevent |

**Lean: A.** They are already engine-shaped; only the folder is wrong.

### 2. The relative board has no data source

D43 asks for "you and the nearest players". There are no accounts and no
network, so there is nothing to populate it with. `ResultsScene` takes the rows
as input, `relativeWindow` picks the window, and with none supplied the board
renders its empty-state line. The opt-in prompt, the two-above-two-below rule
and the no-rank guarantee are all built and tested; only the feed is missing.

### 3. A slower stage is still reported, in neutral ink

AC-20.1 asks for a delta against the previous stage, and a real delta is
sometimes negative. D74 says the screen must never read as a grade. The shipped
compromise: the line reads "down 4 from mars", in the panel's dim ink, with no
arrow, no colour change and no red anywhere (`tests/e2e/results.spec.ts` asserts
that no text on the screen is drawn in a red that is not the stage accent).
The alternative - hiding a negative delta - was rejected because a screen that
only reports good news stops being evidence.

### 4. "Not now" on the board prompt hides the panel

The brief says "one calm prompt the first time Results would show it". Re-asking
on the same screen after a decline is nagging, so declining removes the board
panel for that visit rather than re-rendering the prompt.

### 5. MEASUREMENT: headless Chromium runs the game at ~12 real frames/second

Measured with `game.loop.frame` sampled one wall second apart, on Title, Beacon,
Warp and Ending alike. Phaser's own `actualFps` reports ~47 because it is
computed from its smoothed delta, so the shortfall is invisible from inside the
game. Consequences:

- Scene-clock waits in e2e must be conditions, not sleeps. This lane's specs use
  `waitForSnapshot` / `waitForScene` / `waitForTweens` throughout for that reason.
- It is NOT yet evidence against AC-22.9 (p95 frame time <= 16.7 ms): headless
  WebGL with `ReadPixels` stalls is not the target environment. But the P test
  must be run headed, or it will measure the harness rather than the game.

## C13 — planet names in the asteroid pool (collision, user decision)

- **Logged:** 2026-09-16 (build night 1)
- **Source:** `docs/story-draft-v1.md` note 4 vs PRD AC-12.3
- **Found by:** the story lane, while building the stage bundles

Two rules that cannot both hold:

- **Story note 4:** proper nouns appear in briefings but are excluded from
  asteroid pools. Kids read them; they do not have to type them.
- **AC-12.3:** every content word in a warp sentence must exist in that stage's
  pool.

Every warp sentence in the story draft opens with the planet's name — "**Mars**
is the red planet", "**Saturn wears rings** made of **ice** and **rock**". So
the planet name is a content word of the warp sentence and therefore must be in
the pool, which note 4 forbids.

| # | Option | Cost |
|---|---|---|
| A | Planet's own name goes in the pool; moons stay readable-only | Shipped. A 4-7 letter proper noun the child has just read three times in the briefing. |
| B | Reword the warp sentences so they never open with the planet name | Costs the story's voice, and the beat is "name the place you just charted". |
| C | Exempt a sentence's first word from AC-12.3 | Cheapest in code, but it is a hole in the check that exists to stop unvetted words reaching the screen. |

**Lean: A.** It is the narrowest exception, the word is the most-rehearsed thing
on the screen by the time they type it, and typing the name of the place you
just charted is the point of the warp beat. Moons — Phobos, Deimos, Titan,
Triton, Charon — remain readable-only, so note 4's actual intent is preserved.

### Status

Shipped as A. C13 open in the decision log.

## AC-22.9 — the PRD names an instrument that cannot measure the claim

- **Logged:** 2026-09-16 (build night 1)
- **Source:** PRD AC-22.9, NFR-1, D60 item 9
- **Found by:** two independent lanes, measuring rather than assuming
- **Severity:** this was a FALSE PASS in the gauntlet until it was caught

### What happened

AC-22.9 reads: *"60 fps: p95 frame time ≤ 16.7 ms over a 60 s scripted flight in
headless Chromium."*

The first capture produced:

```json
{ "p95Ms": 3.5, "p95FrameIntervalMs": 416.2, "observedFps": 3.4, "frames": 204 }
```

The rubric read `p95Ms` and passed it. That number is **per-frame work** — how
long the game spends inside one frame. The claim is about **frame rate**, which
is the interval *between* frames. The game rendered 204 frames in 60 seconds and
the check called it 60fps.

Separately, the warp lane measured the same thing from a different angle and
found headless Chromium drives this game at **~12 real fps** while Phaser's own
`actualFps` reports ~47, because Phaser computes it from a smoothed delta — so
**the shortfall is invisible from inside the game**.

### Why the instrument is wrong — with one correction

Headless Chromium rasterises in software (SwiftShader), so the first reading of
this was "the harness cannot produce 60fps, therefore a headless capture is
meaningless in both directions."

**That was overstated, and a third lane produced the number that corrects it:**
a bare WebGL clear at 1920x1080 *does* hold 16.7 ms in this same headless
harness. So headless is not incapable of 60fps — it is capable for a trivial
frame. Which means the 92 ms p95 interval measured on the real Flight scene is
**not purely environmental**, and the scene may genuinely be heavy.

Three things are tangled in that 92 ms and they have not been separated:

1. software rasterisation,
2. a load average of 20-70 from six build lanes running concurrently,
3. the actual cost of the Flight scene.

Only (3) is the game's problem, and no measurement taken so far isolates it. A
headless **pass** is still meaningless (it can only pass by reading per-frame
work instead of interval), but a headless **fail** is now *suggestive* rather
than dismissible.

The rubric now rejects any `frametime.json` whose `method` says headless, and
requires `p95FrameIntervalMs` and `observedFps` alongside `p95Ms`. P-22.9 is
correctly FAILING rather than falsely passing.

| # | Option | Cost |
|---|---|---|
| A | Re-capture headed, with a real GPU, on the machine that will run the demo | Matches NFR-1 ("a 2019 laptop-class GPU"). Cannot run in a headless CI. Needs a human-present run, which is fine — the demo is recorded on this machine anyway. |
| B | Keep headless but change the claim to a per-frame WORK budget | Honest and CI-runnable, but it is no longer the 60fps claim D60 makes, and it would need AC-22.9 reworded. |
| C | Both: work budget in CI, frame-rate check headed before submission | Most work, strongest evidence. |

**Lean: C, with A as the minimum.** The 60fps claim is on the submission
write-up and in D60's rubric; it should be measured on real hardware at least
once. A cheap per-frame work budget in CI catches regressions between those runs.

**Do this before concluding anything about the game:** re-run the 60 s scripted
flight headed, on an idle machine, with no build lanes running. Until then the
only defensible statements are that per-frame work is 2.6 ms p95 and that the
frame-rate claim is unmeasured. Do not put "60 fps" in the submission write-up
on the strength of the numbers captured tonight.

### Status

NOT PASSED. The false pass is closed. Re-capture is blocked on a headed run,
which is a human-present action.
