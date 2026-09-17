# KEYBLASTER — Coverage audit

Posture: adversarial. The question asked of every green check was *what would have to
be true for this to pass while the thing it names is broken?*

**What was run.** `npx vitest run --coverage` with `--coverage.include='src/**/*.ts'`
(CLI override; the committed `vite.config.ts` was not edited, and the report was
written to a scratch directory so `coverage/` was not clobbered). 64 files, 2031 tests,
all green. Plus `node scripts/trace-check.mjs`, `npx tsc --noEmit`, and static analysis
of `tests/gauntlet/rubric.mjs`, `scripts/gauntlet.mjs`, `gauntlet/evidence/*` and the
24 Playwright specs. The Playwright suite and the gauntlet runner were **not** re-run.

**Disclosure — files this audit touched.** The vitest run rewrote
`gauntlet/evidence/audio-graph.json`, `deadtime.json`, `retention.json` and
`belt-survivability.json` (their generators are seeded test side-effects; contents are
deterministic, only mtimes moved). `docs/coverage-audit.md` is the only file written
deliberately. No git commands were run.

---

## 0. Headline

| # | Finding | Where |
|---|---|---|
| 1 | **`gauntlet/summary.md` reports `0 fail`. `gauntlet/report.md` reports `5 fail`.** The human-facing file is stale by 5 failures and one whole item (32 vs 33). | §4.1 |
| 2 | **The one end-to-end test is red**, and it is red for the belt bug a human already found twice: *"the belt stalled 5 times and never completed."* | §4.2 |
| 3 | **V-22.8 was fixed by adding a field to the JSON that no renderer reads.** Typed letters on Saturn and Pluto in colourblind mode are still **1.02:1**. The rubric now reports 6.71:1. | §4.3 |
| 4 | **No trophy can ever be earned.** `profile.trophies` has a reader and a schema and zero writers in `src/`. Every trophy test injects the trophy into the store first. | §4.4 |
| 5 | **`npx tsc --noEmit` fails with 2 errors** and no gate runs it. `npm test` is trace-check + vitest only. | §4.5 |

---

## 1. Measured coverage

`src/game` is **18.53%** of lines. **50 of its 72 files have never executed a single
line.** The 95% gate sees 4,680 of the 19,639 lines in `src/` — **23.8%** of the
product.

| directory | files | files at 0% | lines | line % |
|---|---:|---:|---:|---:|
| **src/engine (gated)** | **65** | **2** | **4,680** | **99.96%** |
| **src/game (ungated)** | **72** | **50** | **14,947** | **18.53%** |
| src/game/scenes | 27 | 25 | 6,951 | **1.6%** |
| src/game/ui | 15 | 14 | 2,560 | **2.9%** |
| src/game/render | 11 | 7 | 3,030 | 24.2% |
| src/game/flight | 5 | 2 | 330 | 45.5% |
| src/game/audio | 11 | 0 | 1,700 | **99.1%** |
| src/game/coach | 1 | 0 | 74 | 24.3% |
| src/game/boot.ts | 1 | 1 | 247 | **0%** |
| src/main.ts | 1 | 1 | 12 | 0% |

**Do not quote the branch/function percentages for `src/game`.** v8 emits a static stub
for a file it never loaded — `fn=1, br=1` — so the 86.94% branch figure is computed over
the 22 files that *did* run and excludes the 50 that did not. Lines is the only honest
column. Reproduce with:

```
npx vitest run --coverage --coverage.include='src/**/*.ts' \
  --coverage.reportsDirectory=/tmp/cov --coverage.thresholds.lines=0 \
  --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 \
  --coverage.thresholds.statements=0
```

**GAP — architecture §10.1's "game 70%" gate exists in no config.** `vite.config.ts:25`
sets `include: ["src/engine/**/*.ts"]`. Nothing else measures. Rubric item `G-coverage`
reads `coverage/coverage-summary.json.total` and passes at 99.95% — a number produced by
a config that excludes four fifths of the codebase. The rubric has no `src/game` coverage
item at all.

*Test that closes it:* a second vitest project (or a `G-coverage-game` rubric item)
reading a `src/game/**` summary with a threshold, set initially at the measured 18.53%
and ratcheted. A gate at today's number still fails the day someone deletes a test.

**Credit where due:** `src/game/audio` is at 99.1% with 0 files unexecuted, and the audio
rubric items now assert a *built* and a *wired* artifact separately (`rubric.mjs:464-479`).
That subsystem was the worst finding of the last audit and is now the best-covered part
of `src/game`. `src/engine` is genuinely at 99.96% with real tests behind it.

---

## 2. The untested surface, ranked by risk

Ranked by what breaks for a child, not by line count. The renderers are last on purpose:
`parallax.ts`, `lantern.ts`, `asteroid.ts`, `shadow.ts`, `wordPlate.ts`, `textures.ts`
(2,204 lines, all 0%) are covered indirectly by the pixel-evidence items and the two
byte-bound reference compares, and a wrong pixel is visible. A wrong rule is not.

| # | File (line coverage) | Why it ranks here |
|---|---|---|
| 1 | `src/game/scenes/FlightScene.ts` (0%, 1203 lines) | The spawn scheduler (`:856-877`), hull/strike (`:1414-1434`) and stage end live here. The unsurvivable-belt bug was in this file; the proof that it is fixed runs a **613-line parallel implementation** in `tests/unit/simulation/flight.ts`, not this code. |
| 2 | `src/game/ui/catalog.ts` (0%) | `TROPHIES` (`:145`) has 12 entries and **no award rule anywhere in `src/`**. Also `beaconCount`, `furthestBeacon`, `liveryFor` — all read persisted progress, all untested. |
| 3 | `src/game/scenes/lib/init.ts` (0%) | `persistStopCleared` (`:178`) is the **only** path that writes a cleared stop to disk. The engine rule under it is now tested; this caller — where the regression actually lived — is not. |
| 4 | `src/game/boot.ts` (0%, 247 lines) | Service construction, profile bootstrap, the `kb.audio` registry key, and `window.addEventListener("pagehide", () => store.close())` at `:304` — the only thing that flushes a 250 ms-debounced save before a reload. A boot failure is a black screen. |
| 5 | `src/game/scenes/ResultsScene.ts` (0%, 538 lines) | Writes `stars`/`bestWpm`/`bestAccuracy` through `persistStopCleared`. `markStopCleared` is monotone, so a wrong value written here is **permanent** — no later run can lower it. |
| 6 | `src/game/scenes/lib/strings.ts` (0%) | `isShadowSafe(line)` (`:165`) and `SHADOW_VOICE_BANS` (`:170`) — a child-safety guard on what Shadow may say. **No caller and no test.** A safety rule nothing invokes is not a safety rule. |
| 7 | `src/game/scenes/support/warpSentence.ts` (0%) | D09's typing rule: `typeChar`, `chargeFraction`, `highlightRanges`. Pure, engine-shaped, and its own header (`:5-11`) says it belongs in `src/engine`. Zero tests. AC-16.2 ("a typo does not reset the sentence") is asserted by nothing. |
| 8 | `src/game/scenes/lib/content.ts` (79.3%) | `parseStageBundle` (`:99`) is the untrusted-JSON boundary for **all** shipped content. A throw here is a black screen at one stop only — the failure mode nobody sees until that stop. |
| 9 | `src/game/ui/focus.ts` (56.0%) | `FocusList` (`:125`) and `handleFocusKey` (`:262`). Keyboard is the *only* input method (D37). Half of the navigation code is unexecuted. |
| 10 | `src/game/scenes/StallScene.ts` (0%, 194 lines) | Restart is the only recovery from the failure a human hit twice. If restart is broken the child is stuck, and `clearTheBelt` in the playthrough would report it as "the belt stalled N times" — indistinguishable from the belt being hard. |
| 11 | `src/game/scenes/SettingsScene.ts` (0%, 322 lines) | Contains the one destructive path in the product: `store.resetProgress(profile.id); store.flush()` (`:407-408`). Nothing tests that it fires only behind both confirmations. |
| 12 | `src/game/flight/stage.ts` (33.5%) | `paletteFor` (`:55`) — the colourblind branch is a live accessibility bug (§4.3). Also the second of **two** `paletteFor` implementations; the audit asked for one to be deleted and both are still here (`render/palette.ts:102`). |
| 13 | `src/game/scenes/WarpScene.ts` (0%, 672 lines) | The coach call, the dedup gate and the warp-sentence wiring. §1.3 of the prior audit found the gate inert in this scene; nothing here has coverage that would notice if it still is. |
| 14 | `src/game/scenes/support/relativeBoard.ts` (0%) | `relativeWindow` (`:36`) decides what a child sees about other children. D43/D74 forbid a comparative standing; no test pins the shape. |
| 15 | `src/game/scenes/DirectorMapScene.ts` (0%, 381 lines) | The unlock display. `:373` `const hasRun = entry.cleared && isBeltStop(stop)`. This is the screen that lied to the player about Jupiter. |

Lower priority, stated once: `src/game/coach/transport.ts` is at 24.3% only because
`createCoachClient` and `browserFetch` touch `fetch`; the pure rules `chooseTransport`
and `sameOriginPath` **are** tested (`tests/unit/coach/transport.test.ts:38+`), and the
file says so. Not a gap.

---

## 3. Rubric items that pass for the wrong reason

All 33 items in `tests/gauntlet/rubric.mjs` were examined. Findings below; the rest are
noted as sound in §6.

### FALSE-PASS — V-22.8 "Word plate text contrast >= 4.5:1"
`rubric.mjs:292` reads `pal.colorblind?.plateAccent` from `src/content/palettes.json`.
**`plateAccent` is read by nothing except that line.** Grep the tree: the only hit
outside the JSON is `rubric.mjs:292`. Both palette accessors —
`src/game/flight/stage.ts:61` and `src/game/render/palette.ts:82` — set
`accent: raw.colorblind.accent`, and `src/game/render/wordPlate.ts:262` draws the typed
letters in `style.accent`. Measured against the plate:

| stop | what the rubric measures (`plateAccent`) | what is actually drawn (`colorblind.accent`) |
|---|---:|---:|
| saturn | 14.30:1 | **1.02:1** |
| pluto | 13.15:1 | **1.02:1** |

The item reports `worst contrast 6.71:1` (`gauntlet/report.md:39`). The letters a child
reads on Saturn and Pluto with the accessibility setting **on** are invisible, exactly as
`docs/audit.md §1.5` said, and the fix was applied to the checker's input rather than to
the renderer. `stage.ts:55` still carries the comment the last audit refuted: *"the
word-plate pair is unchanged, because it already clears AC-22.8 by 18:1."*

*Test that closes it:* a unit test over `paletteFor(stop, true).accent` (both accessors)
against `.plate`, asserting ≥4.5:1 for all seven stops. It must read the value the
renderer reads, not the JSON.

### FALSE-PASS — V-22.1b "Layer-debug overlay shows the five speeds actually moving"
Two specs write the same evidence file, last-writer-wins, and they do not measure the
same thing:

- `tests/e2e/flight.spec.ts:980` — `movingLayers: distinct` where `distinct` is the count
  of **distinct scroll rates** on the Flight scene.
- `tests/e2e/title.spec.ts:239` — `movingLayers: moved.length` where `moved` is layers
  that **moved at all**, on the **Title**.

The artifact on disk is the Title's (`"scene": "Title"`, `movingLayers: 7`). AC-22.1 is a
claim about the flight world; the item's own `todo` string says *"Flight scene not built"*.
It is currently certified by the Title screen's background, counted by the wrong metric.
`playwright.config.ts` runs `fullyParallel` with 3 workers, so which spec wins is
nondeterministic between runs.

*Test that closes it:* give the two producers distinct filenames
(`parallax-overlay-flight.json`, `parallax-overlay-title.json`) and make the rubric read
the Flight one and assert `scene === "Flight"`.

### FALSE-PASS — G-scenes "Every scene has a screen-inventory row"
`rubric.mjs:1035-1044`. The function has no `bad()` branch. It returns `todo` on an empty
directory and `ok` otherwise; **there is no input on which it fails.** Its own detail
string admits it: *"row-matching is enforced by trace-check (G-trace)."* It is one of 33
items and it is a no-op that always reports PASS.

It is also inconsistent with the check it defers to: G-scenes counts **27** scenes
(`walk` recurses into `lib/` and `support/`), trace-check counts **17**
(`readdirSync`, top level only). Two rubric items disagree about what a scene is.

*Fix:* delete the item, or make it assert `scenes.length === declaredRows.length` itself.

### FALSE-PASS — G-trace "every AC a test"
`scripts/trace-check.mjs:238` links an AC to a test by **substring search over every test
file concatenated**: `!tests.includes(id)`. An AC is "covered" if its id appears anywhere —
in a comment, in a `describe` title with no assertions, in a disabled test.

Worse, the failure is not enforced. Line 248: `if (STRICT && unlinked.length)`. `npm test`
runs `node scripts/trace-check.mjs` with no flag, and `rubric.mjs:1028` runs
`runNode(["scripts/trace-check.mjs"])` — also no flag. The live output reads:

```
AC->test:   96/105 cited by a real test (9 not yet)
trace-check OK
```

**Nine acceptance criteria have no test citing them and the item is green.** The item's
title claims the opposite.

*Test that closes it:* run `--strict` in the gauntlet, and change the linkage from a
substring scan to a check that the id appears inside a `describe`/`it` **title string**.

### FALSE-PASS — G-e2e-whole ignores skips
`rubric.mjs:1092-1099` computes `failed = unexpected + flaky` and `passed = expected`,
requires `passed + failed >= 100`. `stats.skipped` is never read. A run that skips 90
tests and passes 101 reports as a whole-suite pass. (Currently `skipped: 0`, so this is a
latent hole, not a live one — but it is the hole this item exists to close.)

### FALSE-PASS (systemic) — evidence has no freshness or provenance gate
`scripts/gauntlet.mjs:79`: `has: (name) => existsSync(join(EVIDENCE_DIR, name))`. That is
the entire admission test. **Fourteen rubric items pass on a JSON file of any age,
produced by any means, including by hand.** `G-secrets` has an mtime check against `src/`
and the three reference compares are byte-bound to the render they judged — the doctrine
exists in this repo, it is just applied to 4 of 33 items.

Concretely: `gauntlet/evidence/desaturated-contours.json` is the two-byte-value file
`{"contours": 10}` — no source image, no method, no timestamp, no producer — and it
passes V-22.4 against a 3..60 window. `playwright.config.ts:41` states the rule this
violates: *"a number with no producer is an assertion, not evidence."*

*Fix:* require every JSON artifact to carry `producedBy` and `capturedAt`, and fail an
item whose artifact predates the newest file under `src/`.

### FALSE-PASS — V-22.5 "Zero Linear easing anywhere in tween configs"
`rubric.mjs:201-219`. The regex only matches an **explicit** `ease: "...Linear"`. Phaser's
default ease when the key is absent is `Power0`, which *is* linear. `src/game` has 72
`tweens.add(` calls and 88 `ease:` occurrences, so most are annotated — but the check
cannot distinguish "eased deliberately" from "no ease key, therefore linear", and the
item's title says *anywhere*.

*Test that closes it:* assert every `tweens.add({...})` object literal in `src/game`
contains an `ease` key, then keep the Linear-value scan as a second pass.

### FALSE-PASS — V-22.6 "Blast, hit and warp have distinct particle signatures"
`rubric.mjs:222-237`: `required.filter((n) => !src.includes(n))`. Three string literals in one
file. A comment naming them passes. Three functions with **identical bodies** pass. The
word *distinct* in the title is asserted by nothing.

*Test that closes it:* unit-test the three emitter configs and assert they differ on at
least two of {lifespan, speed, quantity, tint, scale}.

### WEAK, not a false pass — G-nored
`rubric.mjs:950-973` scans for the identifiers `lives:`, `"wrong"`, `redFlash|flashRed|gameOver`.
It would not catch `cameras.main.flash(200, 255, 0, 0)` or a `0xFF3B30` fill. I grepped
`src/game` and `src/content` for red-ish hex and found none, so the product is clean —
but the item is a vocabulary scan wearing the title of a behavioural claim.

### Sound as written
`P-22.9` and `L-6e.1` both correctly refuse a headless capture and are escalated, not
passed — `frametime.json` records `observedFps: 3.2` and the item says so. `A-21.1`–`A-21.8`
require a live `AudioContext`, per-event call-site tags, and a frame counter that advanced,
which a table cannot fake. `R-lantern`/`R-shadow` are byte-bound and currently fail as
stale, which is the mechanism working. `G-one-shadow` is a good check that closes a real
hole. `G-engine-purity` handles local shadowing of DOM names correctly.

---

## 4. Live defects the suite does not report

### 4.1 FALSE-PASS — the summary contradicts the report
`gauntlet/summary.md` (dated 12:46): `30 pass | 0 fail | 0 not-implemented | 2 escalated | 32 total`.
`gauntlet/report.md`: `26 | 5 | 0 | 2 | 33`. The failures the summary hides are
`G-e2e-whole`, `A-21.2`, `R-world`, `R-lantern`, `R-shadow`. The summary is the file a
human reads first and it is the only one that says the build is clean.

### 4.2 GAP — the belt still stalls, and only the red test knows
`gauntlet/evidence/e2e-report.json` records `unexpected: 1`. The failing test is
`playthrough.spec.ts` — the single end-to-end route — with:

```
Error: the belt stalled 5 times and never completed. failed during "flight reached"
```

Against that, `gauntlet/evidence/belt-survivability.json` reports `stalls: 0` for all six
player×knob combinations across 40 seeds. The simulation and the game disagree completely.
The simulation is a **reimplementation**: `tests/unit/simulation/flight.ts` (613 lines)
duplicates the spawn/fall/hull loop that ships in `FlightScene.ts:856-877, 1402-1434`,
and `FlightScene.ts` has **zero** executed lines. The model also shows `meanHitRate: 1`
and `worstHull: 3` for the median player — a simulated child who never misses a rock
across 40 seeds is not a survivability model.

I am not claiming the belt is definitely still unsurvivable: headless software-GL steps
Phaser at ~3 fps while `page.keyboard.type()` round-trips at wall time, so the harness
could be the cause. **That is the point.** Nothing in the suite can tell those apart,
because nothing executes the shipped spawner.

### 4.3 See §3, V-22.8. The colourblind contrast bug is live.

### 4.4 FALSE-PASS — trophies are rendered and never awarded
`src/game/ui/catalog.ts:145` defines 12 `TrophyDef`s — `{id, nameKey, howKey}`. There is
**no predicate and no award function.** Grep for writers of `profile.trophies` across
`src/`: `engine/types.ts:186` (the type), `persistence/schema.ts:299,317,509,610`
(default `[]`, parse, clone), `ResultsScene.ts:237` (a fallback profile with `trophies: []`).
Readers: `BeaconLogScene.ts:63,67`. Nothing ever adds an id.

Every test that exercises a trophy injects it first:
`tests/e2e/beaconlog.spec.ts:44` `seed(page, [{ name: "Ana", trophies: ["firstLight"] }], LOG)`,
again at `:54`, `:68`, and `:155` with all twelve. AC-6d.1c passes on a game where no
trophy can be earned. This is the audio finding of the last audit, one layer over.

*Test that closes it:* a unit test of an `earnedTrophies(profile, run)` rule — which does
not exist yet — asserting `firstLight` after Earth is cleared and `mapMaker` after
`routeComplete`. Then an e2e that clears a stop and asserts `trophiesEarned` went from 0
to ≥1 with no seeding.

### 4.5 GAP — the typecheck is red and no gate runs it
```
$ npx tsc --noEmit ; echo $?
src/engine/selection/picker.ts(327,18): error TS2345: ... Property 'avoidLast' is missing
src/engine/selection/picker.ts(334,14): error TS2345: ... Property 'avoidLast' is missing
2
```
`npm test` = `trace-check && vitest run --coverage`. `npm run typecheck` exists and is
invoked by nothing. The rubric has no typecheck item. The last audit recorded `tsc` as
clean, so this is a regression that shipped unnoticed in `src/engine` — the *gated*
directory.

*Fix:* add `tsc --noEmit` to `npm test` and a `G-typecheck` rubric item.

### 4.6 FALSE-PASS — `contrast.json` still reports the discredited number
`tests/e2e/flight.spec.ts:771` writes `{"minRatio": 18.08}` for all seven stops — the
`plateText`-vs-`plate` pair only, which is the measurement `docs/audit.md §1.5` refuted
and `rubric.mjs:269-276` documents as insufficient. No rubric item reads it any more, so
a green spec keeps producing a number that says the accessibility bug does not exist.

---

## 5. Assertions that cannot fail

### VACUOUS — `deadtime.json` is quantised to its own tick
`tests/unit/simulation/coreLoop.test.ts:51` sets `spawnIntervalMs: 120`;
`tests/unit/simulation/flight.ts:242` advances the clock with `nowMs += cfg.spawnIntervalMs`.
Dead time can therefore only be a multiple of 120 ms, and exceeding 2000 requires **17
consecutive `pickNext` refusals**. The emitted artifact reads `"maxGapMs": 120` — one
tick, the floor of the measurable range. `L-6e.3` passes on it (`report.md:59`).

Worse, the artifact comes from `simulateStage`, whose own header
(`tests/unit/simulation/flight.ts:12-26`) says it *"resolves every live rock
independently, as if the player could answer them all at once"* and that *"that
assumption is exactly why this harness could not see the belt stall."* The serial-typist
harness (`simulateBelt`) exists and is not what feeds the rubric.

*Test that closes it:* produce `deadtime.json` from `simulateBelt`, and add a control
that asserts `maxDeadMs > 0` on a board engineered to go quiet.

### VACUOUS — `retention.json`'s "trends upward" is arithmetic
`tests/unit/simulation/flight.ts:118-122`:
```ts
const decay = 0.72 ** record.hits;
return floor + (player.coldRecognitionMs - floor) * decay;
```
The simulated child's recognition latency is a **strictly decreasing function of hit
count, by construction**. `retentionImprovementMs` takes `firstFkLatency - medianFkLatency`,
and `firstFkLatencyMs` is pinned to the first sample — the maximum of a decreasing
sequence. `expect(positive).toBe(improvements.length)` cannot fail for any player, any
seed, with the engine's SRS removed entirely. `L-6e.4` — "the retention line trends
upward", the learning claim of the whole product — is certified by this.

*Test that closes it:* a negative control with the SRS scheduler **disabled**, asserting
the trend does *not* hold. If it still holds, the measurement is of the model.

The existing control is broken: `coreLoop.test.ts:149` uses a "flat" learner with
`coldRecognitionMs: 260` against a `floor` of 220, so the maximum achievable delta is
**40 ms** and the assertion bound is `toBeLessThan(60)`.

### VACUOUS — the anti-vacuity control for dead time is itself vacuous
`tests/unit/simulation/belt.test.ts:194-206`, titled *"the measure can be non-zero, so
zero means something"*:
```ts
expect(r.spawned).toBeGreaterThan(0);
expect(r.maxDeadMs).toBeLessThanOrEqual(2000);   // :205
```
To show the metric can be non-zero this must assert `toBeGreaterThan(0)`. As written it
repeats the passing assertion from `:189`. The guard proves nothing.
(`coreLoop.test.ts:93` does the same job correctly — the pattern exists in the repo.)

### VACUOUS — `it.fails` is load-bearing for AC-10.2
`tests/unit/controller/convergence.test.ts:133` (known). The collateral is new: it is the
**only** test of AC-10.2, and the four green "diagnostics" that remain
(`convergence.test.ts:183-223`) assert properties of `hitProbability`/`expectedRate` —
functions defined in `tests/unit/controller/simulated-player.ts`, not in `src/`. The
monotonicity test at `:183-201` tests the test's own player model against itself and
touches no product code. No other `it.fails`/`skip`/`only`/`todo` exists under `tests/`.

### VACUOUS — self-comparison in place of determinism
Each of these is `f(x) === f(x)` on a function with no clock and no RNG:
`tests/unit/audio/keystrokeTone.test.ts:18` (100 iterations),
`tests/unit/audio/music.test.ts:68` (50 iterations),
`tests/unit/words/words.test.ts:172`,
`tests/unit/ephemeris/ephemeris.test.ts:830`,
`tests/unit/coach/mock.test.ts:114`,
`tests/unit/lock/lock.test.ts:733`.
`tests/unit/calibration/calibration.test.ts:293` shows the correct form — two independent
`mulberry32(7)` instances — so the pattern is known here too.

### VACUOUS — `shield.ts`'s tests restate its own constants
The file the brief names as having shipped with zero tests now has some, and they are thin:
- `tests/unit/flight/shield.test.ts:32` — `expect(MAX_HULL).toBe(HULL_HITS_PER_STAGE)` against
  `shield.ts:18` `export const MAX_HULL = HULL_HITS_PER_STAGE`. Literally `expect(X).toBe(X)`.
- `:65-69` — titled "monotonically non-increasing", asserts
  `hullAfterStrike(hull) <= hullMarksLit(hull)`. Given `hullAfterStrike(h) = max(0, clamp(h) - 1)`
  and `hullMarksLit(h) = clamp(h)`, one is the other minus one. True for every input by
  construction; monotonicity in `hull` is never asserted.
- `:58, :80, :81, :120, :133` — expected values written as `MAX_HULL - 1`, `MAX_HULL`.
  Change `HULL_HITS_PER_STAGE` to 5 and every one still passes while the game changes.
  Only `:33` pins the number.
- `:151` — `expect(maySpawnCanister.length).toBe(2)`, an arity check under the title
  "decides WHETHER, never WHAT".

### VACUOUS — a stub would pass
- `tests/unit/flight/blastHistory.test.ts:112-114, :190-197` — a `blastedWords` that always
  returns `[]` passes both, **and** passes the negative assertion at `:89`
  (`not.toContain("planet")`) that the file's header calls "the whole finding". This is
  the `visible === false` shape the brief names, in a different module.
- `tests/unit/persistence/migrations.test.ts:27` — `expect(MIGRATIONS[v]).toBeTypeOf("function")`.
  Any `() => {}` passes.
- `tests/unit/render/depth.test.ts:383` — `expect(atmosphereFor(id)).toBeTruthy()`.
- `tests/unit/flight/stageLength.test.ts:81-84` — under the title "length came from the COUNT",
  asserts `MAX_LIVE_MIN === 2`, `MAX_LIVE_MAX === 7`, a key is absent, and `knobs` equals `{}`.
  None of the four measures belt length. `:41-50`'s "90-150 s" bound is computed by a
  `secondsPerWord` helper **defined in the test file**; no product code runs.
- `tests/unit/controller/convergence.test.ts:179` — `expect(allKnobStates()).toHaveLength(18)`
  where the enumerator itself is `6 × 3` over the same imported constants.

### VACUOUS — guards that skip the assertion
`tests/unit/selection/deadlock.test.ts:168` `if (out.ok) expect(typeof out.word).toBe("string")`;
`:190` same guard with a length check.
`tests/unit/controller/controller.test.ts:416-419` — a controller that never tightens
satisfies the whole test; `:469` — a controller that never decides satisfies
"no decision produces an out-of-range knob", across a 300-stage loop.

### VACUOUS — "does not throw" as the only assertion
`tests/unit/persistence/pii.test.ts:61, :68` — `findPiiKeys` on a cyclic object. A function
that bails and returns `[]` passes, and `[]` is the **clean** verdict NFR-3 rests on.
`tests/unit/i18n/hardcoded.test.ts:292-294` — a lint that returns `[]` after an unterminated
regex passes, which is the exact failure the adjacent `:283` test guards against.
`tests/unit/selection/deadlock.test.ts:181-184` — a picker returning a live or
unallowlisted word passes "the picker is total".
`tests/unit/persistence/migrations.test.ts:62` — the return value is discarded for all five
corrupt payloads.
`tests/unit/audio/wiring.test.ts:130` — "no-op" is claimed; only "no crash" is checked.
`tests/unit/persistence/fuzz.test.ts:244-252` — `createProfile`/`resetProgress`/
`selectProfile`/`deleteProfile` wrapped in one `.not.toThrow()` with no assertion on what
any of them did. (The rest of that file is sound: `checkUsable` at `:30-65` asserts real
invariants.)

### Controls that do work
`tests/unit/simulation/belt.test.ts:145-153` asserts `s.stalls === SEEDS` on the 850 ms
regression — a real falsification test, and the reason the belt fix is credible at all.
`tests/unit/scoring/surface.test.ts:120-123` guards its own vacuity with an export count.
`tests/unit/audio/evidence.test.ts:34-38` imports the real rubric rather than copying its
thresholds.

---

## 5b. Assertions that cannot fail — Playwright

### VACUOUS — "the coach area is IDENTICAL for an AI note and the shipped fallback"
`tests/e2e/warp.spec.ts:317-371`. The test defines `const NOTE = "Good run. Let us take
rivers and empty a little slower."` and **never compares it to anything.** The identity
claims are:
```ts
expect(fallbackSnap.coach.note).toBe(liveSnap.coach.note);   // :339
expect(fallbackSnap.coachArea).toEqual(liveSnap.coachArea);  // :340
expect(diff).toBe(0);                                        // :370
```
If the note fails to render down **both** paths — the same renderer, so the likely case —
then `"" === ""`, the areas match, and two crops of an empty region diff to exactly 0.
Corroborating: `warp-coach-live.png` and `warp-coach-fallback.png` are both **11,802
bytes** on disk. (The provenance half at `:336-338` is real and does work.)

*Fix:* `expect(liveSnap.coach.note).toBe(NOTE)` before the comparison.

### VACUOUS — a missing debug key reads as a clean result
`tests/e2e/title.spec.ts:426-431`, "no UI string is missing from the active language table":
```ts
const misses = (window.__kb?.["i18nMisses"] as string[]) ?? [];
expect(misses).toEqual([]);
```
If the game stops publishing `i18nMisses` — renamed, unwired, or the scene crashed before
publishing — the test reads `[]` and passes. Missing and clean are the same value.

Same shape at `tests/e2e/story-lane.ts:177` — `transitions()` is
`[...(window.__kbTransitions ?? [])]`. Every `expect(await transitions(page)).not.toContain("X")`
in the suite (`map.spec.ts:193` and others) passes on a build that never publishes the array.

### VACUOUS — the reset-progress test passes on total data loss
`tests/e2e/settings.spec.ts:293-294`, under *"reset progress … keeps the pilot"*:
```ts
expect(profile?.["trophies"]).toEqual([]);
expect(progress.every((p) => p.beaconPlacedAt === null)).toBe(true);
```
`[].every()` is `true`. If reset wipes `progress` to `[]` — the destructive failure this
test exists to catch — it passes. And per §4.4, `trophies` is *always* `[]`, so that line
asserts nothing in any build.

### VACUOUS — a destroyed or absent object satisfies the negative
- `tests/e2e/pointer.spec.ts:217` — `expect(afterItems.find(i => i.id === toggleId)?.value).not.toBe(beforeValue)`,
  in a test literally titled "A CLICK CHANGES A VALUE". A click that *destroys* the row gives
  `undefined !== "Off"` → pass.
- `tests/e2e/settings.spec.ts:49`, `pause.spec.ts:130`, `profile.spec.ts:88` —
  `expect(await screen(page, X).getAttribute("data-focus")).not.toBe(first)`. `getAttribute`
  returns `null` when the attribute is dropped, so **losing focus entirely** satisfies "arrows
  move a visible focus".
- `tests/e2e/warp.spec.ts:140` — `expect(s.debris.count).toBe(0); expect(s.debris.moved).toBe(false);`
  A scene that never builds a debris layer reports exactly this. "Correctly still" and "does
  not exist" are indistinguishable.
- `tests/e2e/results.spec.ts:356-357` — `expect(stalled.starsRendered).toBe(false)` plus
  `expect(stalled.rendered).not.toContain("stars")`. Both come from the same `snapshot()` the
  scene publishes; they are two views of one publisher, and `not.toContain` on an empty
  `rendered` is free. This is the `visible === false` shape from the last audit, unchanged.
- `tests/e2e/beacon.spec.ts:169` — `expect(s.coordsLine).not.toContain("NaN")` with no
  length guard, while its sibling at `:151` has one. An empty readout passes.

### VACUOUS — passes on a screen that renders nothing
`tests/e2e/story-lane.ts:206-212`, `expectNoPunishment(text)`, is a loop over `text` with no
length guard: **zero assertions on `[]`**. Called from `map.spec.ts:59`, `map.spec.ts:196`,
`briefing.spec.ts`, `earth-activation.spec.ts:117`, `preflight.spec.ts`. Same shape at
`results.spec.ts:249, :532`, `beacon.spec.ts:254`, `warp.spec.ts:398`, and in the
"nothing comparative / no difficulty selector" checks at `settings.spec.ts:70, :75`,
`beaconlog.spec.ts:80`, `profile.spec.ts:268`, all of which read `textContent() ?? ""`.

D28/D31 — *no punishment framing* — is enforced across five scenes by assertions that a
blank screen satisfies.

### VACUOUS — the named claim sits inside an `if`
- `tests/e2e/beaconlog.spec.ts:210-220`, *"Esc leaves the log"*: `if (screen.count() > 0)`
  branch means Esc did nothing, the log is still up, and the test passes. The comment calls
  these "two correct outcomes"; one of them is the bug.
- `tests/e2e/flight.spec.ts:735`, *"reduced motion keeps the world moving and the rocks
  falling"*: `if (later !== undefined) expect(later.y).toBeGreaterThan(rock.y)`. Rocks that
  freeze and are then culled pass.
- `tests/e2e/playthrough.spec.ts:397-439` — the Earth-persistence block, including the three
  assertions the file's own comments call the reported bug, is inside
  `if (afterMap === "EarthActivation")`. And `:424`'s
  `expect(afterMap).not.toBe("EarthActivation")` reads `activeScenes(page)[0]`, which is
  `undefined` when **no scene is running** — a crashed game satisfies "not the dead-end loop".
- `tests/e2e/playthrough.spec.ts:448` — `await waitForScene(page, "Preflight").catch(() => {})`
  then a conditional body. The Briefing→Preflight seam is unasserted in the one test that
  exists to walk the chain.
- `tests/e2e/flight.spec.ts:453` — `.catch(() => [])` on the stage-module import, falling back
  to a hardcoded `["win", "wind"]`. A broken `stagePoolFor` is invisible here.
- `tests/e2e/aspect.spec.ts:252-263` — `if (aspect.bar !== "none")` skips the opacity, seam
  and brightness checks entirely for the 16:9 run.

### VACUOUS — structural tests wearing a behavioural title
- `tests/e2e/shadow.spec.ts:126` — *"R-shadow / AC-25.2 renders all six poses"*. The only
  `expect` is `expect(poses).toEqual([...six strings])`, where `poses` is `mod.SHADOW_POSES`,
  an exported constant. Stub `drawShadow` to a no-op and this is green while
  `shadow-render.png` is blank.
- `tests/e2e/title.spec.ts:402-420` — *"AC-24.2 the vector Lantern renders for the reference
  compare"* contains **zero `expect` calls**. It navigates and writes a PNG.
- `tests/e2e/results.spec.ts:540-543` — `expect(STOPS).toHaveLength(7)` where `STOPS` is a
  literal declared at `:28` of the same file. No browser, no scene.
- `tests/e2e/lib/menus.ts:213-219`, `assertNoEmailField`, the entire body of three tests
  (`settings.spec.ts:59`, `beaconlog.spec.ts`, `profile.spec.ts`):
  `expect(page.locator("input, textarea, form, select")).toHaveCount(0)` on a **canvas** game
  that renders no DOM by construction. The `page.content()` substring check is marginally
  more than nothing; the locator counts cannot fail.
- `tests/e2e/flight.spec.ts:670-682` and `tests/e2e/briefing.spec.ts:94-105` — JSON shape and
  string-length assertions run through a browser. They would pass against a stub game.
- `tests/e2e/scaffold.spec.ts:4-8` — passes against an empty Vite app.

### VACUOUS — wait, then assert what the wait already proved
`tests/e2e/default-focus.spec.ts:264-273` waits on `snapshot().focusId === "continue"` and then
asserts it. The `waitForFunction` already throws if false. Same at
`earth-activation.spec.ts:61, :104` and `warp.spec.ts:~234`.

### VACUOUS — thresholds that cannot discriminate
- `tests/e2e/world-frame.spec.ts:252` — `toBeGreaterThan(0.01)` on a **sum of two**
  luminance deltas in 0..1, i.e. ~1.3/255 each. PNG dithering clears it. The claim is "the
  near plane must be distinguishable from the sky behind it".
- `tests/e2e/preflight.spec.ts:103-104` — `expect(cal.ikiMs).toBeGreaterThan(0)` under a
  comment claiming "physically plausible". A median of typing intervals is always ≥ 1.
- `tests/e2e/preflight.spec.ts:156-159` — *"the ritual lasts between 5 and 20 seconds"*
  measured against the scene's **self-reported** `elapsedMs`, not wall clock, in a harness
  the same file says runs the game clock at ~¼ speed. The child's experience (up to ~80 s)
  is exactly what is not measured.
- `tests/e2e/flight.spec.ts:640` — `expect(restarted.bookExposures).toBeGreaterThanOrEqual(exposures)`
  for "with the word history kept". A restart that wipes the book to 0 and re-exposes passes.
- `tests/e2e/title.spec.ts:286` — `expect(pixelDiff).toBeGreaterThan(0)` for "the focus ring
  is drawn, not implied", taken across 350 ms of a scene the same file proves drifts >2% in
  1 s from parallax alone. Delete the `ArrowUp` and it still passes.

### VACUOUS — the module's counter checked against the module's own log
`tests/e2e/audio-wiring.spec.ts:432-438`. `played` and `cuesRouted` both come from
`__kb.audio.snapshot()`. This is self-consistency, not "every keystroke got an audio answer".
The `masterRmsPeak` analyser reading that `A-21.8` also requires **is** independent, so the
rubric item survives this; the spec assertion does not.

### VACUOUS — content asserted against itself
`tests/e2e/blast-history.spec.ts:364` — `expect(flownPool).toEqual(bundlePool)` where
`flownPool = stagePoolFor("mars")` and `bundlePool = stageBundle("mars").pool`.
`src/game/flight/stage.ts:221-227` implements `stagePoolFor` as exactly that passthrough, so
this is `x === x`, and `:372`'s per-word loop reduces to asserting the content file against
itself. `tests/e2e/briefing.spec.ts:81,133` builds the allowlist from the same bundle whose
prose it then checks — partly circular.

### Mislabelled rather than vacuous
`tests/e2e/flight-perf.spec.ts:219` asserts `p95Work <= 16.7` inside a test named
*"P-22.9 / AC-22.9: p95 frame time"*. `p95Work` is prestep→postrender **work**, not frame
interval — the disease `rubric.mjs:300-320` was fixed for. The rubric now refuses the
artifact correctly, so the item is escalated, not falsely passed. The **spec name** still
claims AC-22.9 and is green. Both `p95()` helpers return `0` on an empty sample array
(`flight-perf.spec.ts:187, :265`), so "measured nothing" scores a perfect 0 ms.

### Structural: 21 of 24 specs never cross a scene seam
Only `playthrough`, `flight`, `flight-perf`, `world-frame` and `scaffold` start at `/`, and
`flight.spec.ts`, `flight-perf.spec.ts` and `world-frame.spec.ts:40-52` **stub out
`src/main.ts`** with `page.route("**/src/main.ts", → "export {};")` and call `bootFlight()`
directly — so they never execute the real `boot.ts` either. Every other spec pins one scene
with `?scene=X` (`tests/e2e/support/lane.ts:55`). Scene→scene handoffs outside
`playthrough.spec.ts` are covered only by `transitions()` — the **departing** scene's own
announcement (see above) — which never checks the arriving scene received or used its payload.

---

## 6. What a player would hit that no test covers

`playthrough.spec.ts` covers: Title → profile → Earth activation → map → Briefing →
Preflight → a full Mars belt with real keystrokes → warp sentence → beacon → Results →
map shows Jupiter unlocked → reload → store still has it. That is a real route test and
it found both reported bugs. What it does not cover:

| GAP | Evidence | Test that closes it |
|---|---|---|
| **Settings do not survive a reload — untested.** `tests/e2e/settings.spec.ts` contains **zero** `page.reload()`. `settings(page)` (`tests/e2e/lib/menus.ts:148-151`) reads `activeProfile().settings` from the **in-memory** store. Every test titled "persists" proves only that the registry changed. The write is a 250 ms trailing debounce (`store.ts:14`) flushed by a `pagehide` listener at `boot.ts:304` — in an untested file. | settings.spec.ts:80, 94, 108, 120 | Change music volume, `page.reload()`, assert the stored value survived. Then change it and reload within 250 ms. |
| **Stall → restart is never asserted.** `clearTheBelt` presses Enter on Stall and tolerates up to 4 (`playthrough.spec.ts:133-143`); it never asserts the restart worked. The current failure is *"stalled 5 times"* — indistinguishable from "restart is broken". | playthrough.spec.ts:133 | Force 3 hull hits, assert Stall opens, press Enter, assert Flight is live with `spawnedCount === 0` and the hull restored. |
| **A second playthrough on an existing profile.** Every route test starts from a fresh profile. `markStopCleared` is idempotent on `beaconPlacedAt` and monotone on bests (`progress/index.ts:70-74`) — replaying a cleared stop with a *worse* run is the path with the most ways to corrupt a profile, and no e2e walks it. | — | Clear Mars, re-fly it badly, assert `bestWpm` did not drop and `beaconPlacedAt` did not move. |
| **Language switch mid-run.** `settings.spec.ts:120` asserts `settings.uiLang === "es"` — it asserts the *stored value*, never that the screen is in Spanish, and never from inside Flight or Warp. | settings.spec.ts:120-132 | From Pause during a live stage, switch to `hi`, resume, assert HUD/plate text changed and the belt state did not reset. |
| **Trophies are never earned.** §4.4. | beaconlog.spec.ts:44 | See §4.4. |
| **The ending card is reached only synthetically.** `beacon.spec.ts:200-204` asserts `nextScene === "Ending"` from a seeded Pluto beacon; `:215` boots `?scene=Ending&stop=pluto` directly. Nothing walks seven stops. `EndingScene.ts` is 0%. | beacon.spec.ts:200-215 | Seed six cleared stops, fly Pluto for real, assert Ending opens with `routeComplete` true. |
| **The Beacon Log's real content.** `beaconlog.spec.ts` seeds every profile it renders. Nothing asserts the log reflects a run the test actually flew. | beaconlog.spec.ts:44 | After the playthrough's Mars clear, open the Beacon Log and assert Mars reads charted. |
| **21 of 24 specs boot one scene via `?scene=X`.** Only `flight-perf`, `flight`, `world-frame`, `scaffold` and `playthrough` start at `/`. The seams between scenes are exercised by exactly one test — the one that is currently red. | tests/e2e/support/lane.ts:55 | Not one test; the structural point: a single route test is a single point of failure for every transition in the product. |

---

## 7. The five tests I would write first

Ranked by the probability that the thing they cover is broken **right now**.

1. **Colourblind accent contrast, read from the renderer's own value.**
   `expect(ratio(paletteFor(stop, true).accent, palette.plate)).toBeGreaterThanOrEqual(4.5)`
   for all seven stops, against **both** `flight/stage.ts` and `render/palette.ts`.
   *P(broken) ≈ 1.0 — measured at 1.02:1 on Saturn and Pluto today.*

2. **A trophy is earned by playing.** Unit-test an `earnedTrophies(profile)` rule (it does
   not exist) and an e2e that clears one stop with no seeding and asserts
   `trophiesEarned >= 1`.
   *P(broken) ≈ 1.0 — `profile.trophies` has no writer in `src/`.*

3. **Survivability against the shipped spawner, not a copy of it.** Drive
   `FlightScene`'s own `update` loop headlessly with a scripted typist at median
   calibration and assert the hull survives 58 words. Any harness that does not execute
   `FlightScene.ts:856-877` cannot settle this.
   *P(broken) ≈ 0.6 — the sim says 0 stalls across 240 runs, the game stalled 5 times in a row.*

4. **Settings survive a reload.** Change music volume and keyboard layout, `page.reload()`,
   assert both came back; then repeat with the reload inside the 250 ms debounce window.
   *P(broken) ≈ 0.4 — the flush path runs entirely through `boot.ts`, which is at 0%.*

5. **Stall → restart returns a playable stage.** Force three hull hits, assert Stall, press
   Enter, assert Flight is live with a reset hull and `spawnedCount === 0`.
   *P(broken) ≈ 0.3 — it is the documented recovery from the one failure state, it lives in a
   0%-coverage scene, and the only test that touches it treats its own repeated firing as
   the symptom of a different bug.*

Below the line but cheap: add `tsc --noEmit` to `npm test` (§4.5 — red today), regenerate
`gauntlet/summary.md` (§4.1 — wrong today), and split `parallax-overlay.json` into two
filenames (§3 — mis-certifying today).
