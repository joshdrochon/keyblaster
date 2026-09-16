# KEYBLASTER — D76 Audit

Produced per D76: *"a full sweep of the PRD and architecture against (1) every D-item
and its shipped behaviour, (2) every learning-science claim and its citation, (3) every
gauntlet rubric item and its evidence artifact, (4) test coverage vs the granularity
rule, (5) the full collision history and its resolutions, (6) guardrail/allowlist and
COPPA posture, (7) anything else material to the submission claims. Findings are logged
as pass / gap / misstatement with a fix or a retraction."*

**Posture:** adversarial. Every "done" was treated as a claim to be disproven. For each
rubric item the question asked was *what would have to be true for this to pass while the
thing it names is broken?*

**What was run:** `npx vitest run --coverage` (1508 tests, 48 files, all green;
engine coverage 99.95/99.49/100/99.95), `node scripts/trace-check.mjs` and
`--strict`, `npx tsc --noEmit` (clean), plus static analysis of the whole tree.
The Playwright suite was **not** re-run to completion and the gauntlet runner was
**not** re-run, because both rewrite files outside `docs/audit.md`.

**Disclosure — files this audit touched.** `npx vitest run --coverage` regenerates
`coverage/` and, as a side effect of `tests/unit/audio/evidence.test.ts`,
`tests/unit/simulation/coreLoop.test.ts` and the beacon unit test, rewrites
`gauntlet/evidence/audio-graph.json`, `deadtime.json`, `retention.json` and
`beacon-readout.json`. These generators are seeded and deterministic, so the
contents are unchanged; only mtimes moved. A Playwright run was started and killed
before it wrote any evidence (the `gauntlet/evidence/*.json` produced by e2e still
carry their original 03:48–03:50 timestamps). Nothing else in the repo was modified.

---

## Headline — the five findings that change what can be said

| # | Finding | Where |
|---|---|---|
| 1 | **The game is silent.** `createAudioSystem()` has no caller outside tests; `kb.audio` is read and never set; `FLIGHT_EVENTS.cue` has zero listeners. Five rubric items (A-21.1…A-21.5) are green for a subsystem that is not connected to the product. | §3, §1 |
| 2 | **The warp sentence is not built from the words the player blasted.** Flight spawns from a placeholder pool in `src/game/flight/stage.ts`; Warp highlights the *content bundle's* pool. Different lists, and the highlight is pool membership, not blast history. This is D09 — the founding differentiator against Type Storm. | §1 |
| 3 | **There is no live AI.** `createProxyCoach` is never constructed in `src/`; every coach note comes from `createMockCoach`. `/api/coach` is unreachable from the shipped client. | §1, §7 |
| 4 | **Three citations are used to claim things their sources do not say** — Wilson 2019 (the 85% rule), Roediger & Karpicke 2006, Deci/Koestner/Ryan 1999 — and Deci actually cuts against the trophy layer. | §2 |
| 5 | **The 60 fps claim is unmeasured**, correctly escalated, and must not appear in the write-up. Its neighbour L-6e.1 still ships the exact measurement error that P-22.9 was fixed for. | §3, §8 |

---

## 1. Every D-item and its shipped behaviour

`scripts/trace-check.mjs` proves each D-id is *mentioned somewhere in the PRD*
(trace-check.mjs:111, :190) — not that it has an AC, and certainly not that the code
does what it says. What follows is the behavioural check.

### 1.1 MISSTATEMENT — D09: the end-of-stage sentence is not made of the words just blasted

D09: *"Asteroid words come from the current stage's story text. The end-of-stage
sentence is built from the words the player just blasted."* Decision-log "Origin"
names this as the specific defect in Type Storm that KeyBlaster exists to fix, and
PRD §8 tells the write-up to say so.

- `FlightScene.buildEngineState` (`src/game/scenes/FlightScene.ts:330`) spawns from
  `stagePoolFor(stop)` — a hard-coded stand-in table in
  `src/game/flight/stage.ts:201-241`, whose own header (lines 17-23) says it exists
  "until the content lane lands".
- `WarpScene.stageContent` (`src/game/scenes/WarpScene.ts:299-303`) reads
  `src/content/en/<stop>.json` and passes `blasted: bundle.pool`
  (`WarpScene.ts:261`).

Mars, side by side:

| Source | Pool |
|---|---|
| `src/content/en/mars.json` (used by Warp) | mars, red, planet, dust, rust, cold, dry, sky, pink, day, tiny, moons, spin, long, ago, rivers, run, across, surface, now, land, empty, first, pilot, place, beacon |
| `src/game/flight/stage.ts` (actually flown) | red, dust, rock, win, wind, cold, ice, land, moon, sky, water, rivers, empty, valley, storm, crater, planet, orbit, quiet, giant, north |

Half the sentence's words can never be spawned; a third of what the player types can
never appear in the sentence. **And even if the pools matched, the highlight would
still be wrong**: `blasted` is the whole pool, not the words hit this run
(`WarpScene.ts:261`), so a word the player missed is highlighted as "blasted"
identically to one they hit. `warpSentence.ts:33` documents the intended meaning
("the ones the player just blasted"); the caller does not supply it, and
`FlightScene.ts:1425` passes only `{ stopId, book }` to Warp, so the per-run hit
record is available and discarded.

**Fix.** (a) Point `stagePoolFor` at `stageBundle(stop).pool` — the seam is one
function, as its header says. (b) Pass the stage's hit list from `FlightScene` into
`WarpScene` and use it for `blasted`, falling back to the pool only when it is
absent. Until both land, the demo beat at PRD §7 1:45 is theatre.

### 1.2 GAP — D62 / D63 / D88: no audio reaches the player

The audio layer is built, tested and unwired.

- `createAudioSystem()` (`src/game/audio/index.ts:104`) is called only from
  `tests/unit/audio/graph.test.ts`.
- `SettingsScene.ts:352` reads registry key `"kb.audio"`; grep over `src/` finds no
  writer. `SettingsScene.ts:343` states the situation in a comment.
- `FlightScene.cue()` (`FlightScene.ts:1467-1471`) emits `FLIGHT_EVENTS.cue` "for
  the audio lane's hook". Nothing subscribes.

Consequences: AC-21.1–21.7 describe a disconnected module; **AC-6e.2** ("every
keystroke emits ≥ 1 visual and ≥ 1 audio response") is false; **AC-21.6** (spoken
coach notes) does not happen; two of AC-19.1's eleven settings (music volume, SFX
volume) change nothing a player can hear. D62's "Disneyland-level immersion" has
never been heard by anyone.

This was never escalated and never logged as a collision. C12 covers only bed
*provenance*, not wiring.

**Fix.** Register the graph in `boot.ts` next to `services`, subscribe it to
`FLIGHT_EVENTS.cue` and the scene-transition events, and set the `kb.audio`
registry key SettingsScene already reads. Until then, retract every audio claim.

### 1.3 MISSTATEMENT — D33 / D47 / D92: the LLM is not called

CLAUDE.md line 24: *"LLM is used exactly once per warp break via /api/coach."* It is
used zero times. `createProxyCoach` has no caller outside
`tests/unit/coach/proxy.test.ts`; `WarpScene.ts:487` is
`this.initData?.coach ?? createMockCoach({ validator })` and the only caller that
starts Warp (`FlightScene.ts:1425`) passes no `coach`. `api/coach.ts` is an
unreachable endpoint in the shipped client.

Secondary: `WarpScene.ts:488` builds a *fresh* gate pre-armed at `phase:
"warp-break"` on every call and `:499` assigns rather than accumulates
`gate.calls`, so the gate's dedup (`coach/gate.ts:82-105` — which is real and good)
is inert in the scene. "Exactly one call" holds only because `askShadow()` happens
to be called once from `create()`.

**Fix.** Construct `createProxyCoach` in `boot.ts` (or in the Flight→Warp handoff),
hoist the gate to the scene's lifetime, and apply C11's one-line model-id fix
before recording the demo. Otherwise retract "one AI call per warp break" and say
what is true: the AI ran at authoring time only.

### 1.4 GAP — D34: the allowlist check is circular in the flight path

`FlightScene.ts:333-336` constructs the allowlist **from the pool it is about to
filter**:

```ts
const allowlist = createAllowlist({ lang: this.cfg.contentLang, words: [...pool, ...retention] });
```

`selection/picker.ts:210` then checks pool words against that allowlist. Every word
passes by construction; the only rejections possible are blocklist and length.
AC-13.1's real content — "the graded Fry-1000 list does the real work" — is not
exercised, because no Fry list is loaded anywhere in the flight path.
`architecture.md §5.2`'s `scripts/compile-allowlist` **does not exist** (`scripts/`
holds three files). `src/content/en/sight-words.json` (149 words) is a hand-curated
stand-in and says so in its own `note`.

The blocklist layer is genuinely good (`allowlist/blocklist.ts`, two-tier
prefix/exact split, "liquor" present, `ammonia`/`methane` correctly not
prefix-eaten). It is the layer D34 calls the *backup*. The working layer is inert.

**Fix.** Ship a compiled Fry-1000 allowlist per language and load it in
`FlightScene` instead of deriving one from the pool. Until then, AC-13.1 should be
described as "blocklist enforced; allowlist not yet graded".

### 1.5 GAP — D41: colourblind mode changes word-plate contrast to 1.02:1

Two palette accessors exist with different colourblind behaviour:
`src/game/render/palette.ts:82-90` substitutes accent **and** debris;
`src/game/flight/stage.ts:53-59` substitutes accent only. Flight uses the latter
(`FlightScene.ts:278`). So in colourblind mode the debris fill is *not* separated by
luminance, which is what art-direction §3 asks for — and worse:

Typed letters are drawn in the accent (`render/wordPlate.ts:262`). The colourblind
accent for Saturn and Pluto is `#111318`; the plate is `#0E1116`. Contrast ratio
**1.02:1**. Typed letters are invisible at two of seven stops with the accessibility
setting on. `stage.ts:55` carries a comment asserting the opposite ("the word-plate
pair is unchanged, because it already clears AC-22.8 by 18:1") — the pair is
unchanged; the *typed letter colour* is not, and that is what the child reads.

**Fix.** Give each palette a `colorblind.plateAccent` that clears 4.5:1 against the
plate, and extend the V-22.8 evidence to cover accent-on-plate in both palette
modes (see §3, V-22.8). Delete the second accessor.

### 1.6 MISSTATEMENT — D17 / D18 / D53: AC-10.2 does not hold and the PRD still states it flatly

`tests/unit/controller/convergence.test.ts:133` uses `it.fails(...)`. The suite is
green **because** convergence fails. This is honest engineering — the escalation
(`gauntlet/escalations.md:4-61`) is detailed, the diagnostics prove the ceiling is
structural, and nothing was relaxed to force a pass. But PRD FR-10 still reads
"AC-10.2 … → U (simulation, 200 stages, 50 seeds)" as though it passes, and
`npm test` prints green.

**Fix.** Annotate AC-10.2 in the PRD as ESCALATED with the measured table, or take
option C from the escalation. Do not let a green `npm test` stand in for it.

### 1.7 Decisions verified as shipped (PASS, one line each)

- **D19 / FR-8** fall time. `fallTime/index.ts:34,39,42`: `len × 1.5 × iki + 1200 ×
  ease`, clamped [2500, 14000]; ease factors 0.85/0.95/1.25/1.05, threshold 800 ms,
  clamp [0.25, 2.0], `EASE_NEW` 1.6, iki default 350. Every constant matches.
- **D21 / D22 / FR-9** selection weights 3.0/2.0/1.0/0.3
  (`selection/weights.ts:17-22`), catch window 6 (`picker.ts:69,237`), retention 20%
  from stage 2 (`picker.ts:72,80`), SRS 1/2/4 (`words/srs.ts:15-17`), tier gate ≥80%
  at ease <0.6 (`selection/tier.ts:19-22`). Two narrow gaps noted in §4.
- **D24 / D25 / FR-3** lock. First-keystroke lock `machine.ts:448-474`; typo keeps
  the lock `:546-566`; shared-prefix narrowing and parking `:379-414`; modifier
  combos rejected `lock/layouts.ts:102`; IME `compositionend` handled `:682`.
- **D27 / AC-4.4** stars 0/1/2 hits → 3/2/1★, and 3 hits returns 0 meaning "not
  cleared, decline to render" (`scoring/stars.ts:39-46`) — a good call.
- **D28 / D31 / D29** no punishment framing. Stall copy is warm in all three
  languages (`flight/copy.ts:38-58`). No red, no lives, no "wrong".
- **D15 / FR-17** ephemeris. JPL 1800–2050 approximate elements incl. Pluto,
  correctly **without** the b/c/s/f terms (those belong to the 3000BC–3000AD table).
  The fixtures in `tests/unit/ephemeris/reference.ts:58-98` are genuinely
  independent: an from-scratch re-implementation reproduces the documented worst-case
  residual (dλ 0.1436° Saturn @ J2000) exactly, and that residual is the known
  Jupiter–Saturn great-inequality signature — a self-generated fixture would agree to
  1e-13. Tests assert at 0.3°/0.02°/0.03 AU, inside the AC's 1°/1°/0.05 AU.
- **D43 / D44** persistence: versioned schema, literal field enumeration, fuzzed
  corruption path (2400 mutations, none throw). See §6 for two real gaps.
- **D45 / D46** i18n: three languages, `hardcoded.test.ts` string-extraction lint,
  transliteration table with variant sets.
- **D83 / D84 / D89 / D90 / D91** all art vector, no raster referenced from `src/`,
  one `drawLantern` and one `drawShadow`, both judged against their references.
- **D79 / D80** four ships / eight skins / twelve trophies — defined in config and
  unit-tested, awarded once each.
- **D30 / AC-16.2 / AC-16.3** warp typing rule: no reset path, `index/length` is
  exactly 1.0 on the final character (`support/warpSentence.ts:126,142`).

---

## 2. Learning-science claims and citations

Every source named is **real and correctly attributed** — nothing is fabricated.
Two are used well. Three are used to claim something the source does not say, and one
is cited for the wrong specific. The PRD itself contains **no citations at all**;
they live only in `decision-log.md:202-211`, of which nine are still marked *"cited
from memory, links pending"*.

| Source | Real? | Supports the claim? | Verdict |
|---|---|---|---|
| Wilson et al. 2019 (85%) | Yes, *Nat Commun* 10:4646 | **No — overreach** | MISSTATEMENT |
| LaBerge & Samuels 1974 | Yes | Partially | GAP (wording) |
| Cepeda et al. 2006 | Yes | **No for spacing-in-events** | MISSTATEMENT |
| Bjork 1994 / Bjork & Bjork 2011 | Yes (**book chapters**, not articles) | Yes | PASS |
| Roediger & Karpicke 2006 | Yes | **No** | MISSTATEMENT |
| Ehri 2014 | Yes | Partially | GAP (wording) |
| Deci, Koestner & Ryan 1999 | Yes | **No — cuts the other way** | MISSTATEMENT |
| Hanus & Fox 2015 | Yes | Yes (and indicts trophies too) | PASS |
| Bai et al. 2021 | Yes | Partially (n=50, postgrads) | GAP (scope) |
| Zorzi et al. 2012 | Yes | Yes | PASS |
| Sweller 1988 | Yes | Cited for nothing | GAP (decorative) |
| Hattie & Timperley 2007 | Yes | Yes (conflicts with Deci use) | PASS |
| NASA SEXTANT | Yes | Yes, as flavour | PASS |

### 2.1 MISSTATEMENT — Wilson et al. 2019 does not say what D17/D53 say it says

The paper's own abstract: *"We derive conditions for this sweet spot for a broad
class of learning algorithms in the context of **binary classification tasks**. For
all of these **stochastic gradient-descent based** learning algorithms, we find that
the optimal error rate for training is around 15.87%."*

What that scopes to: SGD-family learners; two-alternative decisions with a decision
variable corrupted by zero-mean Gaussian noise; difficulty = distance from the
decision boundary. The 15.87% figure **is the Gaussian assumption** — the paper
gives ≈82% under Laplacian noise and ≈75% under Cauchy, and states that a Bayesian
learner with perfect memory has no sweet spot at all. Wilson's own public framing
limits it to "simple tasks in which there was a clear correct and incorrect answer,"
most likely perceptual learning, and he declines to extend it to students' grades.

Three specific problems with the use here:

1. **Hit rate is not a classification accuracy.** `blasted ÷ spawned` (FR-10) fails
   overwhelmingly on a *time budget* — typing speed against fall time — not on a
   categorisation under sensory noise. There is no decision variable, no threshold,
   no noise model. The mapping is a metaphor.
2. **There is no 80–90% band in the paper.** The optimum is a point (0.8413). A
   deadband is sound control engineering and a reasonable design choice; it is not
   something Wilson et al. support, and D17/D53 attribute it to them.
3. **A 20-outcome window cannot resolve those thresholds.** SE of a proportion at
   p=0.85, n=20 is ≈0.08 — the 0.80 and 0.90 edges sit inside one standard error.
   For a player exactly on target, Binomial(20, 0.85) gives P(read ≥0.90) ≈ 0.40 and
   P(read ≤0.80) ≈ 0.35, so the controller **holds only ~24% of windows and
   otherwise chases noise**. This compounds the AC-10.2 escalation rather than being
   separate from it.

**Fix / retraction.** In the write-up, say: *"we target ~85% success, a target
popularised by Wilson et al. (2019) for gradient-descent learners on binary
classification; we apply it as a design heuristic, not as a result transferred from
that paper."* Separately, widen the controller window to n≈100 or switch to an EMA
with hysteresis and a minimum dwell, or the band is measuring sampling noise.

### 2.2 MISSTATEMENT — Roediger & Karpicke 2006 does not cover typing a visible word

Their participants recalled prose **with the passage absent**, no feedback. In
KeyBlaster the word is on screen while it is typed: the retrieval cue and the answer
are the same object. That is transcription, not retrieval practice. The citation is
currently unattached to any D-item (it appears only in the source list), which
limits the damage — but it must not migrate into the write-up as "testing effect".

**Fix.** Either drop it, or earn it: a flash-then-hide or dictation round would make
it genuinely correct.

### 2.3 MISSTATEMENT — Deci, Koestner & Ryan 1999 argues against the trophy layer

Abstract: *"engagement-contingent, completion-contingent, and performance-contingent
rewards significantly undermined free-choice intrinsic motivation (d = −0.40, −0.36,
−0.28) … **Tangible rewards tended to be more detrimental for children than college
students.** Positive feedback enhanced both free-choice behavior (d = 0.33) and
self-reported interest."*

Trophies (D80) and star ratings (D27) are **expected, performance-contingent**
symbolic awards — inside the undermined category, for the age group flagged as most
at risk. The informational-vs-controlling distinction is **cognitive evaluation
theory**, not a finding of this meta-analysis, which tests it on four studies of
*verbal* rewards and essentially one on tangible ones. "Our trophies are
informational rather than controlling" is a label the design asserted and then cited
a paper for.

This also puts two of our own citations in conflict: Hattie & Timperley rank
self-level feedback (praise) least effective, and Hanus & Fox's gamified condition
bundled **a leaderboard and badges** — so that paper is evidence against our
trophies as much as against global leaderboards.

**Fix / retraction.** Cite Deci et al. for what it shows: *positive, non-contingent
feedback* helps and *expected performance-contingent rewards* hurt, especially with
children. Then either justify trophies on product grounds without the citation, or
make them non-contingent and descriptive.

### 2.4 MISSTATEMENT — Cepeda 2006 is cited for the wrong thing

The meta-analysis deliberately converted every lag to **time** ("Time intervals were
coded in days… When authors described lags in terms of… items intervening… an
estimate of the time interval was derived… otherwise the data were excluded"). It
therefore does not support spacing expressed in *stages*. It also covers **verbal
recall tasks only**, not motor or typing skill, and it is agnostic on expanding
schedules like our 1/2/4 ("expanding intervals either benefit learning or produce
effects similar to studying with fixed spacing… conclusions necessarily tentative").
The familiar 10–20%-of-retention-interval ratio is **Cepeda et al. 2008, Psych
Science 19(11)** — a different paper.

**Fix.** Cite Cepeda 2006 for "distributed practice beats massed practice, and the
optimal gap grows with the retention interval." Do not cite it for the 1/2/4-stage
schedule; call that an engineering choice.

### 2.5 Smaller corrections

- **LaBerge & Samuels 1974** defines automaticity as running *without attention*;
  latency is the standard operationalisation, not the definition. And a typing
  measurement confounds recognition with motor execution. Say "we use per-word
  first-key latency as a proxy for recognition fluency, after LaBerge & Samuels."
- **Ehri 2014** describes the *partial alphabetic phase* ("similarly spelled words
  may be confused"; readers "rely mainly on predicting words from initial letters").
  She neither proposes nor tests a shared-first-letter drill. Say "consistent with,"
  not "grounded in."
- **Bai et al. 2021** is 50 postgraduates in two online courses. It supports
  *relative > absolute* leaderboards; it does not establish "never show global rank,"
  and it says nothing about opt-in or about children.
- **Bjork 1994 / Bjork & Bjork 2011** are **book chapters** (Metcalfe & Shimamura,
  *Metacognition*, MIT Press; *Psychology and the Real World*, Worth, pp. 56–64).
  Cite them as chapters. This is the cleanest use in the set.
- **Sweller 1988** is attached to nothing. Its actual content is means-ends analysis
  consuming working memory in problem solving — not a general "keep the UI simple"
  paper. Cut it, or attach it to a specific mechanic.
- **Nine sources are still "cited from memory, links pending"**
  (`decision-log.md:211`): Csikszentmihalyi, Ryan/Rigby/Przybylski, Hattie &
  Timperley, Juul, Deci/Koestner/Ryan, Ehri, Sweller, Zorzi, SEXTANT. All nine are
  real and I have verified them; the log should be updated with the links rather
  than shipped with that disclaimer, and **Csikszentmihalyi, Ryan/Rigby/Przybylski
  and Juul ground no decision at all** and should be removed.

---

## 3. Gauntlet rubric items and their evidence artifacts

30 items. Reported: 29 pass, 1 escalated (`gauntlet/report.md:7`). My verdict: **16
pass, 13 gap/misstatement, 1 correctly escalated.**

### Guardrails (10)

| Item | Verdict | Settled by |
|---|---|---|
| G-secrets | **GAP — vacuous** | `dist/assets/index-CTxi1jDh.js` is **822 bytes**, dated 00:37, and contains nothing but Vite's modulepreload shim plus `app.dataset.booted = "true"`. It predates the entire game. "Scanned 2 bundle files" means `index.html` and that stub. The check would pass no matter what a real build contained. NFR-4 is unverified. **Fix:** run `npm run build` in the gauntlet before G-secrets, and fail the item if `dist/` is older than the newest file in `src/` or if the bundle is implausibly small. |
| G-raster | PASS | `rubric.mjs:507-524`; comment-stripped, string-literals kept — catches the thing it exists to catch. |
| G-pii | PASS (narrow) | Four regexes (`rubric.mjs:534-542`) — `type="email"`, GA, four SDK import patterns, four PII field names. It never inspects the serialized payload. The real verification is `tests/unit/persistence/pii.test.ts:76-148`, which is genuinely good. The rubric item is far narrower than the D43/NFR-3 claim it is filed against; see §6. |
| G-nored | PASS | Verified independently: stall, results and warp copy are warm in all three languages. Note the voice ban list is English-only (`coach/banned.ts:33` = `["wrong"]`), deliberately and defensibly. |
| G-engine-purity | PASS | 63 files, Phaser-free and DOM-free; the local-binding exemption (`rubric.mjs:613-619`) is correct, not a loophole. |
| G-trace | **MISSTATEMENT** | Marked PASS while its own printed measurement reads `AC->test: 94/105 cited by a real test (11 not yet)`. `--strict` turns that into a failure and `rubric.mjs:638` runs it **without** `--strict`, contradicting `trace-check.mjs:18` ("`--strict` … is what the gauntlet runs once the scenes exist"). Separately, relation 1 does **not** check "every D maps to ≥1 AC" — it checks whether the PRD *mentions the D-id anywhere*, including inside a section heading (`trace-check.mjs:111,190`). CLAUDE.md's hard rule is not enforced by the script CLAUDE.md names. **Fix:** add `--strict` to the gauntlet and let it fail; change relation 1 to require a D-id citation on an `AC-` line. |
| G-scenes | **GAP** | Reports "27 scenes present". There are **17**. `sceneFiles()` (`rubric.mjs:114`) walks *every* `.ts` under `src/game/scenes`, so the five `lib/` and five `support/` helpers are counted as screens. The item then asserts nothing itself and defers to G-trace, which passes non-strict. Two registered Phaser scenes live outside `scenes/` and escape D78 entirely (`LanternShotScene` in `render/lanternShot.ts`, registered at `boot.ts:269`). `SCENE_INVENTORY_ROW.Boot` maps to `""`, which `trace-check.mjs:223` explicitly skips. |
| G-one-shadow | PASS | `ui/shadowPortrait.ts` and `ui/palette.ts` are gone; one `drawShadow`, one `drawLantern`. But the check is name-based on exactly two functions, and the same duplicate-implementation failure exists today for **palette accessors** (`render/palette.ts` vs `flight/stage.ts`) with divergent colourblind behaviour — see §1.5. The generalised lesson from the two-Shadows escalation was not generalised. |
| G-e2e-whole | **GAP — evidence is hand-written** | `gauntlet/evidence/e2e-suite.json` has **no producer anywhere in the repo**; grep finds only `rubric.mjs:690` reading it. Playwright's configured reporters are `list` and `html` (`playwright.config.ts`) — neither emits that shape. The file is a JSON an agent typed, asserting that the suite it was auditing passed. **Fix:** add `["json", { outputFile: "gauntlet/evidence/e2e-suite.json" }]` to the reporter list and map the fields, so the artifact is produced by the run rather than about it. |
| G-coverage | **MISSTATEMENT** | Reads `.total` from `coverage/coverage-summary.json`, but `vite.config.ts:23` sets `coverage.include: ["src/engine/**/*.ts"]`. The summary contains 63 files, **zero** of them from `src/game`. 20,550 of 30,662 source lines are outside the gate. Architecture §10.1's "game 70%" gate **exists in no config**. Three rule files sit in `src/game` precisely because a lane could not write `src/engine` — `support/warpSentence.ts`, `support/relativeBoard.ts`, `flight/shield.ts` — and `shield.ts` (hull, stall, canister: D26/D27/D29) has **no test of any kind**. **Fix:** either add a second coverage project for `src/game` at 70%, or move the three rule files into `src/engine` as the escalation's own lean (option A) already recommends. |

### Visual (10)

| Item | Verdict | Settled by |
|---|---|---|
| V-22.1a | PASS | `render/layers.ts` — 6 scrolling layers, 5 distinct speeds. |
| V-22.1b | **GAP** | **Two different tests write `parallax-overlay.json`.** `tests/e2e/flight.spec.ts:914-946` measures *distinct rates* on Flight. `tests/e2e/title.spec.ts:211-247` measures *how many layers moved at all* on Title, and does not de-duplicate rates. The file in the repo is the Title one (`"scene": "Title"`, `"layers": [...]`). So the report line "layers observed moving at distinct rates in the debug overlay" is the Flight test's wording attached to the Title test's number, on the wrong scene, measuring a weaker property. Two tests racing for one artifact path is itself the defect. **Fix:** give them distinct filenames and point V-22.1b at the Flight one. |
| V-22.2 | PASS | Two real screenshots, decoded in-page, 12/255 channel tolerance; 8.83% > 2%. |
| V-22.3 | PASS | Median of six spread top-band patches at stage start and +17 s; ΔE 54.8. The median-of-patches design is the right answer to "a rock crossed my sample". |
| V-22.4 | **GAP** | Counts connected components of an Otsu binarisation and passes for any count in [3, 60] (`flight.spec.ts:820-912`). It never identifies the rocket or an asteroid. A frame with the Lantern failing to render and thirteen dust blobs passes with the identical number. AC-22.4 claims "rocket and asteroids identifiable by silhouette". **Fix:** assert on the largest component's area/centroid at the ship's known position, and that ≥ N components fall inside the debris band. |
| V-22.5 | PASS | Independently verified: all 64 `tweens.add` blocks in `src/game` carry an `ease`. Note the regex only matches `ease…:` keys, so a tween that *omits* `ease` — Phaser's default is Linear — would slip through; today none do. |
| V-22.6 | **GAP** | Checks that three identifier strings appear in `particles.ts` (`rubric.mjs:232-235`). It does not compare a single config field. AC-22.6 says "distinct particle configs"; three identical configs with three different names pass. **Fix:** hash each system's emitter config and assert the three hashes differ. |
| V-22.7 | **GAP — half the AC** | AC-22.7 has two halves: "≤ 7 colors + 1 accent in config" **and** "screenshot dominant colors ⊆ palette ± tolerance". Only the config half is implemented, and AC-22.7 is one of the 11 ACs with no test at all (§4). The precedent for splitting a two-claim AC into `a`/`b` was set for V-22.1 and not applied here. |
| V-22.8 | **GAP — and the thing it names is broken** | `contrast.json` reports **18.08 for all seven stops** because it measures one pair (`plate` vs `plateText`) that is byte-identical in every palette — it is one number reported seven times. Meanwhile typed letters render in the *accent* (`wordPlate.ts:262`) and the colourblind variant substitutes it (`flight/stage.ts:57`): Saturn and Pluto give accent `#111318` on plate `#0E1116`, **contrast 1.02:1**. The check passes at 18.08 while typed text is invisible on two of seven stops. **Fix:** measure `contrastRatio(plate, accent)` and `contrastRatio(plate, plateText)` in **both** palette modes, all seven stops, and assert the minimum of all 28 values. |
| P-22.9 | **ESCALATED — correctly** | `gauntlet/escalations.md:435-509`. The rubric now rejects any `frametime.json` whose `method` says headless and requires `p95FrameIntervalMs` + `observedFps` (`rubric.mjs:296-313`). Current evidence: p95 interval **144.7 ms, 8.5 fps observed**. This is the model of how the other items should have been written. Note the underlying e2e test still asserts `p95Work ≤ 16.7` (`flight-perf.spec.ts:206`) and is counted among the "159 passing". |

### Audio (5) — all five GAP, for one reason

**A-21.1, A-21.2, A-21.3, A-21.4, A-21.5 — GAP.** The evidence
(`gauntlet/evidence/audio-graph.json`) is honestly derived: `src/game/audio/evidence.ts`
builds the real graph on a recording context, walks all six transitions, plays 3,000
SFX, measures the duck in dB, and reads the transport back;
`tests/unit/audio/evidence.test.ts` judges it with the actual rubric functions
imported from `rubric.mjs` rather than a copy of the thresholds. As a test of the
audio *module*, it is among the best work in the repo.

It is not evidence about the game, because the module is not connected to the game
(§1.2). Five of thirty rubric items — one sixth of the bar — are green for a
subsystem a player cannot hear. Two further limits even once it is wired: the graph
is exercised on a `NullAudioContext`, so nothing has been *listened to*, and D62's
"scored transitions between every screen" has no AC and no rubric item at all.

**Fix:** wire the graph (§1.2), then add a `needsBrowser` audio item that asserts
against a live `AudioContext` in Playwright, and add an AC for scored transitions.

### Core loop (3)

| Item | Verdict | Settled by |
|---|---|---|
| L-6e.1 | **GAP — the P-22.9 error, one item later** | Measures `keydown` → the next Phaser `postrender` event (`flight-perf.spec.ts:213-232`) in the same harness whose `frametime.json` reports a **p95 frame interval of 144.7 ms**. A visual response cannot reach the player faster than the next presented frame, so a p95 of 5.1 ms is arithmetically impossible as a latency-to-visual. What it actually measures is per-frame work: median 2.9 ms against the same file's per-frame work p95 of 3.0 ms. Chromium dispatches coalesced input at the start of frame processing, so `postrender` fires a few ms later by construction regardless of frame rate. This is precisely the substitution `rubric.mjs:288-295` documents and rejects for P-22.9. **Fix:** measure keydown timestamp → the `requestAnimationFrame` callback *after* the frame that contains the visual change, headed, and hold it to the same headless rejection P-22.9 now applies. |
| L-6e.3 | PASS | 200 seeded stages, max gap 120 ms, and — importantly — `coreLoop.test.ts:86-95` includes a negative control proving the metric can be non-zero. |
| L-6e.4 | **MISSTATEMENT** | The item's title says "across a full Earth→Pluto run". The simulation runs **three stops** (Mars, Jupiter, Saturn — `coreLoop.test.ts:107-113`), not seven. More fundamentally, the simulated learner's recognition latency is *defined* to decay with exposure count (`tests/unit/simulation/flight.ts:70-77`: `floor + (cold − floor) × decay`), and the file says so: "Shrinks with exposure, which is the whole mechanism the retention line measures." So "retention trends upward" is an assumption of the harness, not a finding about the game. The test does include a negative control (`coreLoop.test.ts:138-148`), which is what makes it worth keeping: it legitimately proves the retention **plumbing** records and reports an improvement when one exists. It is not evidence that a child learns. **Fix:** rename the item to "the retention pipeline reports improvement for a learner who improves", run all seven stops, and stop treating it as a learning result. |

### Reference compare (2)

| Item | Verdict | Settled by |
|---|---|---|
| R-lantern | PASS, with a live staleness problem | `judge-verdicts.json` records `renderBytes: 167607`; the file on disk is **166,236** bytes — 0.82% drift. The verdict survives only because the tolerance was widened to 1%. The approved bytes and the shipped bytes are not the same bytes. The judge's own note says a genuine redraw moved 2.1% — but the residual it deferred ("a 20-line change in one function" for the exhaust cone) would plausibly land *under* 1% and keep a stale pass. **Fix:** bind the verdict to a content hash of the drawing code, not to PNG bytes. |
| R-shadow | PASS, on a guard the judge has declared broken | Bytes match exactly (117,938). But `judge-notes.md:176-198` records that the staleness mechanism no longer works for an animated subject — the glow pulse and hover bob now run off the scene clock, so every capture samples a different frame and the verdict expires on every render regardless of the art. The judge's diagnosis and proposed fix (pin the animation phase for the capture; do **not** widen the tolerance) are both correct, and both are deferred. The item is currently green on a mechanism its own judge says is not functioning. |

---

## 4. Test coverage vs the granularity rule (D61)

**MISSTATEMENT — `npm test` is green with 11 ACs untested.** `trace-check.mjs`
prints the number on every run, which is genuinely better than hiding it, but the
gauntlet's G-trace item marks it PASS. The eleven:

| AC | What is untested |
|---|---|
| AC-1.1 | ship position invariant across a stage |
| AC-1.2 | background layers advance at configured speeds |
| AC-5.1 | shield canister spawn rules (hull < 3, ≤ 1 live, word from pool) |
| AC-6e.5 | playtest targets — **never set** (still "N min / M%") |
| AC-12b.3 | NASA debris-source verification (research closure; legitimately exempt) |
| AC-13.3 | **AI outputs pass the allowlist filter before use** — a safety claim |
| AC-17.3 | beacon persists and blinks on the map |
| AC-22.7 | palette count + screenshot dominant colours |
| AC-23.1 | no raster referenced from `src/` (covered in practice by G-raster) |
| AC-24.1 | the emitter renders as engineered tech |
| AC-24.3 | four colourways = four base ships; no text on hull; `{shipName}` renders |

**MISSTATEMENT — relation 1 does not enforce what CLAUDE.md says it enforces.**
CLAUDE.md line 20: *"Every decision (Dxx) maps to ≥1 acceptance criterion … `scripts/trace-check` enforces it."*
`trace-check.mjs:111` collects `citedDecisions` by regexing `\b(D\d+)\b` across the
whole PRD, and `:190` only asks whether each DECIDED id appears in that set. A D-id
mentioned in a section heading — e.g. "### 3.1 Core loop — Flight (D04, D24, D25,
D26, D27, D28, D29)" — satisfies the check without any AC naming it. 36 of 88
DECIDED items are additionally exempted by name (`trace-check.mjs:40-77`); the
exemptions are individually reasoned and I found none abusive, but the combination
means the relation is much weaker than the rule it claims to enforce.

**MISSTATEMENT — the "game 70%" coverage gate does not exist.** See §3, G-coverage.
Engine coverage is real and excellent (99.95% lines, 99.49% branches, 100%
functions, 63 files). Two thirds of the codebase is measured at nothing.
`src/game/flight/shield.ts` — hull, stall and shield-canister rules for D26/D27/D29
— has no unit test and no e2e that names it.

**PASS — no skipped tests.** Grep finds no `.skip`, `.todo`, `xit` or `xdescribe`
anywhere in `tests/`. `it.fails` is used once, correctly and visibly (§1.6).

**GAP — two selection invariants pass by fixture choice.**

- AC-9.2 is best-effort in code: `picker.ts:286-298` falls through to
  `requireCatch: false` and flags `relaxed: ["catch"]`. On a fresh profile nothing
  can qualify (EASE_NEW 1.6 > CATCH_MAX_EASE 1.0), which the escalation documents
  well. But the "10,000 stages" test at `invariants.test.ts:126` hand-seeds six of
  fourteen pool words to ease 0.3 first, so it only ever runs on pools that can
  already supply a catch word.
- AC-9.4: `words/srs.ts:32` ANDs `nextEligibleStage` with the SRS interval, so a
  retention word at ease 0.8 missed at stage 2 is *not* eligible at stage 3 despite
  `nextEligibleStage = 3`. `words.test.ts:260-266` uses `blankRecord()` only (ease
  1.6 → 2.0 → interval 1), which is the one band where the bug cannot appear.

---

## 5. Collision history and resolutions

Thirteen collisions, C01–C13. **Nine resolved, four open.**

| C | Subject | Status | Audit note |
|---|---|---|---|
| C01 | Weapons | Resolved → D04 | PASS. The blaster is a light everywhere in the art spec and code. |
| C02 | Accounts | Resolved → D43 | PASS. |
| C03 | Fall speed | Resolved → D19 | PASS. R3 statement is void as stated. |
| C04 | Scope language | Resolved | Process. |
| C05 | Route | Resolved → D56 | PASS. `STOP_IDS` is the seven-stop route. |
| C06 | Audio source | Resolved → D63 | Superseded in practice by C12 and by §1.2. |
| C07 | Ship name | Resolved (a) | PASS. `{shipName}` on profile, default "Lantern". |
| C08 | Skins vs D08 | Resolved by clarification | PASS. |
| C09 | Voice source | Resolved → D88 | Moot: no voice plays (§1.2). |
| **C10** | AC-3.3 "ignored" vs typo | **OPEN** | Shipped option A exactly as recorded: `machine.ts:532-544` emits `ignored` with `shake: true`, no typo count, no combo break, no ease change. Correct behaviour, correct escalation, still needs a decision. |
| **C11** | D92 model id | **OPEN** | `COACH_MODEL = "claude-haiku-4-5-20251001"` (`coach/direct.ts:54`). The one-line fix is still unmade — and given §1.3, the live path is doubly dead. |
| **C12** | Ambient beds procedural vs pre-rendered | **OPEN** | Now partly moot: the beds are not played at all (§1.2). C12 debates provenance; the wiring gap was never logged. |
| **C13** | Planet names in the asteroid pool | **OPEN** | Shipped option A in the *content bundle*, but §1.1 makes it academic — the flown pool is a different list that does not contain "mars". |

**MISSTATEMENT against architecture §10.7.** The definition of done requires "the
decision log has no open collision touching it". Four open collisions touch the lock
(C10), the coach (C11), the audio (C12) and the content (C13). By the project's own
definition, four of its major subsystems are not done. The gauntlet reports 29/30
green anyway, because the rubric has no item that reads the collision list.

**GAP — two material conflicts were never logged as collisions at all.** The audio
wiring gap (§1.2) contradicts D62/D63/AC-21.x, and the pool divergence (§1.1)
contradicts D09. Both are larger than several logged Cxx entries. The collision rule
caught what lanes noticed and missed what no lane owned — which is the failure mode
of any per-lane convention.

**PASS on process.** `gauntlet/escalations.md` (15 entries) is the strongest
artifact in this repo. Several entries — AC-10.2, AC-22.9, AC-9.2, the "Two
Shadows" coverage finding — are exactly the kind of self-incriminating analysis an
audit hopes to find and usually does not. The AC-22.9 entry in particular catches
and corrects its own earlier overstatement ("headless cannot produce 60fps" →
"headless is capable for a trivial frame, so the fail is suggestive"), which is
rarer than the finding itself.

---

## 6. Guardrail / allowlist / COPPA posture

### 6.1 COPPA / PII

**PASS — no PII field exists, enforced structurally not by promise.**
`persistence/schema.ts:529-543` (`PROFILE_FIELDS`) and `:551-624` copy fields by
literal name, so an extra property on an in-memory object physically cannot reach
storage. `tests/unit/persistence/pii.test.ts:76-148` pollutes a profile and asserts
the serialized JSON omits it, and separately scans `types.ts` off disk for
PII-shaped declarations. Persisted set: id, name, avatar, shipId, shipName,
createdAt, calibration, eleven settings, progress, trophies, unlocks, per-word
records. No contact field of any kind.

**PASS — storage and network.** One `localStorage` touch point
(`boot.ts:186-195`); no IndexedDB, cookies, sessionStorage, Cache API or service
worker; `index.html` loads no remote asset, font or CDN. The coach payload is
`{stopId, lang, missed[], slow[], hitRate}` (`coach/validate.ts:131-139`) — no
name, no id, nothing traceable. `api/coach.ts` logs nothing.

**GAP — `name` is unvalidated free text.** `ProfileCreateScene.ts:135-152,370-372`
commits `pilotName.trim()`; `schema.ts:291` trims and slices to 24 chars. No
character filter, no redaction. A child can enter their full real name and it
persists verbatim. "No PII stored" (NFR-3) is literally false on that reading; what
is defensible is "no PII **field**, and nothing transmitted". **Fix:** say the
narrower thing, or cap the name at a first name's length with a gentle hint.

**MISSTATEMENT — architecture §7 names one storage key; there are two.**
`schema.ts:45` defines `kb:v1:profiles:quarantine`, and `load.ts:100-107` writes the
entire unparseable payload there on corruption. **Nothing ever deletes it** —
`removeItem` exists on `StoragePort` (`port.ts:19-23`) and has no caller, and
`store.ts:215-224`'s profile delete does not touch it. So "corrupt → fresh profile"
silently retains a second copy of the old profile, pilot name included, forever,
under a key no document mentions and no "delete my data" path clears. **Fix:**
clear the quarantine key on profile delete and on successful recovery, and document
it in architecture §7.

**GAP — the profile is published to the page's global scope in production.**
`boot.ts:288-295` sets `window.__kb = { game, services: bundle, … }` unconditionally,
so `window.__kb.services.store` exposes the child's name to any script on the page.
Contrast `FlightScene.ts:308-311`, which correctly gates `__kbFlight` behind
`this.cfg.debug`. There are no third-party scripts today, so nothing exfiltrates it
— but it is an ungated export that a future embed or extension would reach.
**Fix:** gate on `import.meta.env.DEV` or a debug flag, as the flight bag already
does.

**GAP — the system-voice path can make a network TTS call.**
`audio/voice.ts:157-178`: `selectVoice` filters to `localService` voices *only if at
least one exists* (`:168` — `if (local.length > 0) candidates = local;`), otherwise
`:177` returns a cloud voice and the platform sends the utterance off-device.
AC-21.5 claims zero runtime TTS network calls, and `runtimeTtsNetworkCalls: 0` in
the evidence is a `fetch` probe that cannot see a browser-internal TTS request. The
code *can* tell (`voice.ts:48-57`) and chooses to speak anyway, though silence is a
supported outcome (`:162`). Currently unreachable because no audio is wired.
**Fix:** when no local voice exists, render text only.

### 6.2 Allowlist

**GAP — see §1.4.** The blocklist layer is real and well-built. The graded allowlist
— which D34 says "does the real work" — is constructed from the pool it filters, so
it can only reject on blocklist or length. `scripts/compile-allowlist`
(architecture §5.2) does not exist. AC-13.3 (AI output passes the same filter) is
one of the 11 ACs with no test, though `coach/validate.ts:104-125` does run the
pipeline and `coach/banned.ts` correctly reuses the house blocklist rather than
forking it.

Note: `validate.ts:104-125` orders the gates schema → allowlist → **length →
banned**. Architecture §4.6 says "schema → allowlist → banned-term scan → length";
PRD AC-15.2 says "schema, allowlist, word count, banned-term scan". The code matches
the PRD; **architecture §4.6 is stale** and should be corrected.

### 6.3 D87 / D94 overnight guardrails

**PASS — five of six.** `.claude/settings.json:61-85` denies `vercel`, `npx vercel`,
`npm run deploy`, netlify/railway/render/fly, `gh release`, `git push --force`,
`git push -f`, `git push origin main|master`, `git rebase`, `git reset --hard`,
`git branch -D|-d`, `git push --delete`, `git checkout|switch main`. Deny beats
allow, as CLAUDE.md claims.

**MISSTATEMENT — `.env` reads are not blocked.** CLAUDE.md:37 claims "no `.env`
reads". The deny covers `Read(./.env)` / `Read(./.env.*)` / `Write(...)` — the
*Read tool* only. The allow list grants `Bash(cat:*)` (line 24), `Bash(head:*)`,
`Bash(tail:*)`, `Bash(sed:*)`, `Bash(grep:*)` and `Bash(python3:*)`. `cat .env` is
pre-approved. The hole is latent (no `.env` exists and `.gitignore:7-8` covers it),
but the claim as written is false. Three smaller holes in the same block:
`git push --force-with-lease` is not denied; the colon-refspec delete
`git push origin :branch` is not denied; `git checkout master` is not denied while
`git checkout main` is. **Fix:** add a `Bash` deny pattern matching `.env` in any
command, and close the three git variants.

**PASS — the runner asserts its own guardrails.** `scripts/gauntlet.mjs:49-69`
refuses `--live` without `SPEND_CAP_USD`, refuses to run with `VERCEL_TOKEN` set,
and routes every write through `writeInRepo`. The header's statement that the runner
measures and never repairs ("a script that both measures and repairs can always make
its own numbers go green") is correct and is honoured.

---

## 7. Anything else material to the submission claims

**GAP — `design-reference/ui/` is empty.** CLAUDE.md precedence level 5 and D82
Track A both rest on Claude Design interface comps. Only `.gitkeep` is there. The
interface screens were built without the direction they are specified to follow.
Not a defect in the screens; a dead precedence rule and a roadmap item that did not
land. Say so rather than implying a design-led interface pass.

**GAP — the Type Storm comparison has no artifact.** `decision-log.md:188-198`
records detailed numbers "read from its shipped bundle, Sep 15 2026" — wave configs,
fall speeds, the `liquor` pangram, the scoring formulas. PRD §8 makes that
comparison the write-up's opening. Nothing in the repo records the read: no saved
bundle, no excerpt, no screenshot. The claim may well be accurate; it is currently
unfalsifiable from inside the project. **Fix:** save the extracted evidence under
`docs/` or soften the write-up to "as observed in play".

**GAP — AC-6e.5 playtest targets were never set.** The AC still literally reads
"median session ≥ N min, replay rate ≥ M%". It is `M`-typed (manual), so it never
blocked anything. D77's "addictive" leg is therefore undecomposed — which D61 says
makes it UNDER-SPECIFIED, not passed.

**GAP — no headed run of the full game has been recorded.** Everything here is
static analysis plus headless e2e. The one thing that would settle several open
questions at once — does the whole Earth→Pluto loop play, at what frame rate, with
what on screen — has not been done and is a human-present action. Do it before the
demo.

**PASS — the `it.fails` / escalation / judge-verdict machinery.** Three mechanisms
in this repo are better than the industry norm: `it.fails` recording a known-false
assertion so it screams if it starts passing; the four-value rubric status vocabulary
with `not-implemented` explicitly not a pass; and judge verdicts bound to the bytes
of the render they approved. The first two work. The third needs the fix its own
judge proposed.

**MISSTATEMENT — `direct.ts:26` cites a test file that does not exist.**
`tests/unit/coach/tree-shake.test.ts` is named as the build-guard; the logic lives
in `direct.test.ts`, and `directCoachIssues` is only ever run against a synthetic
string (`direct.test.ts:106-114`), never against `dist/`.

**Scoring note, inherited rather than introduced.** `rates.ts:39-45` implements
`accuracy = hits / (hits + typos)` with `hits` counting words and `typos` counting
keystrokes, exactly as the PRD defines it, and flags the unit mismatch in-code. The
escalation (`escalations.md:63-106`) is correct and its lean (option B) is right.
This is the number printed on a child's results screen and it reads roughly five
times harsher than the word "accuracy" implies.

---

## What I would not claim in the submission

These are sentences the evidence does not support. Each is followed by what can be
said instead.

1. **"Runs at 60 fps."** Unmeasured. The only capture is headless at **8.5 fps
   observed / 144.7 ms p95 frame interval**, the rubric correctly refuses it, and
   P-22.9 is escalated. *Say:* nothing about frame rate until a headed capture on
   the demo machine exists. If pressed: "per-frame work measures 3 ms p95; wall-clock
   frame rate has not yet been measured on target hardware."

2. **"Input-to-visual latency is one frame (5.1 ms p95)."** The measurement is
   per-frame work wearing a latency label, taken in a harness rendering at 8.5 fps.
   *Say:* nothing, until it is re-measured headed against presented frames.

3. **"The end-of-stage sentence is built from the words the player just blasted —
   the thing Type Storm gets wrong."** This is the pitch and it is currently false:
   two different word pools, and the highlight is pool membership rather than blast
   history. *Say:* it after the two-line fix in §1.1, and not before.

4. **"One small AI call per warp break; the coach note names the words you just
   missed."** No live call is made; every note is `MockCoach`. *Say:* "the AI ran at
   authoring time; the runtime coach is wired behind a three-transport interface and
   currently runs the shipped mock." Or make the call real — it is a small change.

5. **"Disneyland-level audio: layered ambient beds, adaptive music, ducked voice,
   three variants per event."** The game plays no sound. *Say:* "an audio graph is
   built and unit-tested against its rubric; it is not yet connected to the scenes."

6. **"Shadow speaks the pre-flight lines and the coach notes."** He does not.

7. **"Difficulty is held at 85% success, per Wilson et al. (2019)."** Two problems:
   the paper is about gradient-descent learners on binary classification and does not
   transfer to a typing hit rate, and the controller demonstrably cannot reach the
   band below p≈0.78 (AC-10.2, escalated). *Say:* "we target ~85% success — a
   heuristic popularised by Wilson et al. for a different class of learner — and the
   controller holds strong typists in an 80–90% band; for the weakest typists the
   knobs cannot reach it, which is documented."

8. **"Trophies and stars are informational rather than controlling rewards, per
   Deci, Koestner & Ryan (1999)."** That meta-analysis found expected,
   performance-contingent rewards undermine intrinsic motivation, most of all in
   children. Do not cite it in support. *Say:* "rewards are non-comparative and
   never gate progress," and defend that on product grounds.

9. **"Grounded in test-enhanced learning (Roediger & Karpicke 2006)."** Typing a
   word displayed on screen is not retrieval practice. Drop it.

10. **"Spaced repetition per Cepeda et al. (2006)."** That paper codes spacing in
    *time* and excluded event-lag data it could not convert; our intervals are in
    stages, and the 10–20% ratio people quote is from Cepeda 2008. *Say:*
    "distributed practice, with earlier stops' words interleaved into later ones."

11. **"Every decision maps to an acceptance criterion and every criterion to a test,
    enforced by `trace-check`."** The script checks that the PRD *mentions* each
    D-id, and 11 of 105 ACs have no test. *Say:* "94 of 105 acceptance criteria are
    cited by a live test; the remaining 11 are listed in `docs/audit.md` §4."

12. **"95% test coverage."** Engine only — 99.95%, genuinely. Two thirds of the
    source (`src/game`, 20,550 lines) is measured at nothing, and the "game 70%"
    gate in architecture §10.1 exists in no config. *Say:* "the learning engine is
    at 99.95% line coverage under a 95% gate."

13. **"The whole e2e suite passes in one run."** It may well; the artifact asserting
    it was typed by hand, not emitted by Playwright. *Say it* after adding the JSON
    reporter.

14. **"No API key can reach the client bundle — verified by a secrets scan."** The
    scan ran against an 822-byte scaffold build that predates the game. *Say it*
    after running `npm run build` and re-running the gauntlet.

15. **"29 of 30 rubric items pass."** Thirteen of the passing items do not measure
    what their titles claim (§3). *Say:* "16 of 30 measure what they name; the
    remainder are documented in `docs/audit.md` §3 with a fix each."

16. **"Fully accessible: colourblind-safe palette."** In colourblind mode, typed
    letters sit at 1.02:1 on the plate at Saturn and Pluto. Fix before claiming.

17. **"No PII is stored."** No PII *field* is stored; the free-text pilot name is
    unvalidated, and a corrupted-storage event leaves an uncleared copy of the old
    profile in a second localStorage key. *Say:* "profiles are local-only, name and
    avatar, no accounts, no contact fields, nothing transmitted."

18. **"The retention line proves learning."** It proves the retention pipeline
    reports improvement for a simulated learner defined to improve, over three stops
    of seven. *Say:* "the results screen carries a delayed-retest retention line;
    its behaviour is verified in simulation, including a negative control."

---

*Audit performed 2026-09-16 against the tree at `91a29ee`. Findings: 16 rubric items
sound, 13 measuring something other than their claim, 1 correctly escalated; 4 open
collisions; 11 untested ACs; 4 citation misstatements; 3 subsystems (audio, live
coach, graded allowlist) built but not connected.*

---

# ADDENDUM — what changed after the audit ran

The audit above is a snapshot of the tree at `91a29ee` and its findings are left
untouched. This section records only what has been closed since, so the two are
never confused.

## Closed

| # | Finding | Now |
|---|---|---|
| 3 | **D09 — warp sentence not built from blasted words** | **FIXED.** Flight spawns from the real bundle and records an ordered blast history; Warp highlights that, with no pool fallback. The e2e deliberately breaches a word that is in both the pool and the sentence and asserts it is not highlighted — pool-membership highlighting cannot pass it. The old D30 test, which asserted the pool against itself, is rewritten. |
| 4 | **No live AI path** | **FIXED.** `chooseTransport` wired; mock is the explicit default and is pinned for automated runs per D87; endpoints forced same-origin. DirectCoach absence re-verified against a real `vite build`. |
| 13 | **e2e artifact typed by hand** | **FIXED.** `G-e2e-whole` now reads Playwright's own JSON reporter and rejects a run of under 100 tests. |
| 14 | **Secrets scan ran on a stale scaffold `dist/`** | **FIXED.** `dist/` rebuilt, and `G-secrets` now fails if `dist/` is older than the newest file in `src/` or `api/`. |
| 16 | **Colourblind typed letters at 1.02:1** | **FIXED.** Every palette gains `colorblind.plateAccent` clearing 4.5:1; worst case now 10.97:1 in colourblind mode. V-22.8 measures three pairs per palette — body, typed, typed-colourblind — instead of only the body pair it was reporting 18.08 from. |
| 2 | **L-6e.1 is per-frame work wearing a latency label** | **CHECK FIXED, MEASUREMENT STILL OWED.** It now rejects headless capture and requires the frame interval alongside. Like P-22.9 it needs a headed run. |
| 5, 6 | **§1.2 — no audio reaches the player; Shadow does not speak** | **FIXED.** `createAudioSystem()` is constructed in `bootGame()` and published on the services bundle. Flight cues route to SFX plus the D75 pitched layer, the HUD stream drives music intensity, ambient beds crossfade per stop, menus sound `uiNav`, settings sliders move real gains, and Shadow speaks the pre-flight lines and the coach note (text first, then speech, per AC-21.6). A second artifact, `audio-wiring.json`, is emitted from a real `bootGame()` in Chromium — real `AudioContext`, ten events tagged by their calling game code, master-bus RMS off an AnalyserNode, −6 dB duck sampled from the real `AudioParam`, zero external requests. A-21.1…A-21.5 now require **both** artifacts; every original predicate is verbatim and the wiring predicate is an added gate. Two disconnection drills, both pinned as unit tests: delete the artifact → all seven go `not-implemented`; comment out one line of boot wiring → the evidence run *fails*, so it can never be regenerated green. |
| — | **R-shadow staleness (not an audit finding; found while closing them)** | **FIXED AT SOURCE.** The verdict kept expiring because `shadow.spec.ts` ended with `waitForTimeout(900)` and the note "let the hover bob and the face-plate pulse settle somewhere flattering" — a wall-clock wait on a clock-driven animation, so every capture landed on a different phase. Widening the byte tolerance would have hidden a real redraw, so the capture now freezes the animation at a fixed `t`. Byte-identical across three consecutive runs. A reference compare is a controlled still, not a live frame. |

## Found after the audit, not in it

**`allowlist/normalize.ts` destroyed most Hindi words.** The edge-strip class
`[^\p{L}\p{N}]` deletes trailing Unicode Marks, and every Devanagari matra,
anusvara, chandrabindu, nukta and virama is a Mark. `गुलाबी`→`गुलाब`,
`है`→`ह` — 91 of 143 Hindi sight words. The allowlist gate never broke because
construction and lookup truncated identically, which is exactly why it survived;
every downstream consumer got a mutilated string. Found only by building real
Hindi content. Fixed, with a regression test.

**D25's parked-word tier is unreachable at Mars, Saturn and Pluto** — the real
pools contain no word that is a prefix of another, and the AC-2.2 e2e passes
because it debug-spawns the pair. Escalated; the fix needs a story edit.

## Still open, and why

Audio (5, 6) moved to Closed above.

- **60 fps and input latency** (1, 2) — need a headed capture on target hardware.
  A human-present action; cannot be closed by the overnight loop.
- **Citations** (7–10) — retraction or rework is a judgement call about what the
  submission claims. User decision.
- **`src/game` has no coverage gate** (12) — architecture §10.1's "game 70%"
  exists in no config, and two thirds of the source is measured at nothing.
- **11 ACs with no live test** (11) — listed in §4.
- **PII nuance** (17) — no PII *field*, but the pilot name is unvalidated free
  text and a corrupt-storage event leaves the old profile in a quarantine key.
- **Four open collisions** (C10–C13).

Nothing in the "What I would not claim" list should be treated as cleared unless
it appears in the Closed table above.
