# The check and the thing: twenty-three ways this codebase lied to itself

Written 2026-09-17, after a night in which twenty-three separate defects
turned out to be the same defect.

Nine had a green test, two had a red one, and one was a picture a person judged. None of the tests
were wrong about what they asserted. They were wrong about **what they were
asserting it against.**

This document exists because the twenty-first instance is cheaper to prevent
than to find, and because "we have 2891 passing tests" stopped being reassuring at
about the third one.

---

## The shape

> A check exercises something adjacent to the shipped thing, passes, and is
> believed.

The adjacency is always plausible and usually the result of a reasonable
decision taken earlier for an unrelated reason. Nobody writes a test against
the wrong target on purpose. The target drifts, or the harness takes a
shortcut, or a module is built before its caller and the caller never arrives.

The failure is not in the assertion. It is in the **binding between the
assertion and the product**, and almost nothing in a normal test suite checks
that binding.

---

## The twenty-three

| # | What was green | What shipped | Found by |
|---|---|---|---|
| 1 | Six engine modules at 95% coverage — `StopProgress.cleared`, trophies, calibration, letterbox, `unlockedShips`, `words` | Nothing in the running game called any of them. Trophies could never be earned; calibration was never persisted, which made the belt 100% unsurvivable for a grade-2 typist | An audit asking "who calls this?" |
| 2 | 17/17 screens captured, every screenshot clean | The capture harness boots **Mars only**. The briefing page collided at five of seven stops and overflowed Earth's plate by 88px. Mars was the one stop that fit | A player opening Saturn |
| 3 | `belt.test.ts` reports zero stalls | It flies the **Mars pool at stopIndex 1** for every run — one stop measured seven times. The real route stalls 3 in 240 for a grade-2 pilot | A lane building a different simulation |
| 4 | `flight-perf.spec.ts` produces the 60fps evidence for P-22.9, and `world-frame.spec.ts` produces `flight-frame.png` — **the image a human judges for the R-world rubric item** | Both boot `src/game/flight/boot.ts`, a **second `Phaser.Game`** diverging from the shipping one in five ways: `Phaser.AUTO` not `WEBGL`, `CENTER_BOTH` double-centring, no pixel density, wrong clear colour, and `setGameWidth` never called — so the six-times-reported edge bars are **alive inside the harness**. 24 tests across 4 specs. The visual rubric has been judging a picture the game does not draw | A blind critic reading the spec, then the render lane reading it properly |
| 5 | Accessibility settings persist correctly across reload | `uppercase` and `increasedLetterSpacing` have **no consumer on any of the nine story screens**. A child can enable them and read identical text | A blind critic toggling them and measuring |
| 6 | `text-collision.spec.ts` covers Warp at all seven stops | D57 gives Earth no belt, so **no child can open Warp at Earth**. The spec asserts against an unreachable screen and counts it as coverage | A blind critic cross-reading the decision log |
| 7 | Two `plate-legibility` specs went **red**, and the red was believed to be the suite catching a real defect | Both failed *before asserting anything* — one on a Playwright strict-mode violation (a third canvas on the page), one collecting zero samples because a 7s CDP round trip outlasted a 3s rock fall. Neither encoded the bar. The defect was real, but it was found by reading the layer stack, not by these tests | A lane triaging its own red |

| 8 | `UR-30`'s headline fix: "five distinct tones across a hundred presses, word ten bit-identical to word one" | `keystrokeTone.reset()` runs once per **stage**, not per word. ~95% of a 58-word belt is the same 2217.5 Hz note, and the better a child types the worse it gets. **The harness that produced the "five tones" number reset per word; the shipping game does not.** The measurement and the claim shared a bug | A blind critic bundling the shipping code into a real `OfflineAudioContext` rather than reusing the builder's harness |
| 9 | `audio-graph.json` reports `duckDb: -6` as AC-21.4's evidence | `measureReductionDb()` reads `.value` immediately after scheduling a ramp, which returns **0 on a real context**. It reads −6 only because the test double sets `.value` synchronously. The duck itself is fine; only the evidence is fictional | The same critic, measuring the duck for real |
| 10 | `V-22.4` silhouette separation — currently **red**, and caught before it could lie | The probe finds **zero samples** inside *and* outside its object across 4 of 5 frames: it is not locating the canister at all. It bails at `unmeasurable > objectsMeasured / 4`, so the moment that ratio drops it flips to **PASS while still never having found the object**. Red today, silently green tomorrow, measuring nothing either day | The UI lane triaging a red that was not its own |

| 11 | **`flight-frame.png` — the image a human judges the whole world art against for the R-world rubric item** | It was **a picture of the Title screen**. KEYBLASTER, the tagline and the play button, on the navy Title sky. Its own JSON said so and nobody read it that way: 90% below L\*40, max luminance 0.177, and a sample grid identical across all nine columns of every row. **Every prior R-world judgement is void; the art lane was handed the wrong picture for the life of the project.** The real flight screen measures 28.6% below L\*40 against the Title's 90.0% | The flight lane, after deleting the parallel boot |
| 12 | `V-22.3` "the sky travels across a stage", green for months | It was sampling the **backdrop**, which by design never travels. On the real game it measured deltaE **0.00** against a bar of 10 | The same migration |

| 13 | `shadow-voice.spec.ts:251` asserted that Shadow's chirp fires | `playChirp` builds nodes on the **voice** bus and touches `graph.sfx.history()` not at all — so the assertion could neither see a chirp nor miss one. It was not stale; it was **an assertion with nothing behind it**, which is worse than no assertion, because it occupies the space where a real check would go | The audio lane, clearing what it thought was a stale artifact |

| 14 | `V-22.4`'s silhouette probe, reporting **passing** separations of 0.11-0.14 | The art lane pinned a rock's drawn luminance to a known constant, then replicated the spec's method: **3 of 5 frames had `inside` = 112.6 / 133.9 / 112.4 — pure sky, no rock in the core at all.** The probe screenshots, then reads coordinates in a *second* CDP round trip, while rocks fall on the wall clock. It was grading the sky against itself and calling it a pass. At the coordinate the failing run named, a frozen frame reads in 41.4 / out 108.1 / sep 0.2616; the run had reported `out 60.1`, a value the background never takes at that height | The art lane, after making the rock's colour predictable enough to catch the probe lying |

Instance 14 is the one to remember when someone says a test is flaky. It was
not flaky. It was sampling a moving world through two round trips and reporting
whatever it happened to land on, in both directions — false green and false red
from the same bug.

| 15 | `tests/unit/flight/shardTint.test.ts`, cited in the source as the check binding shard tint to rock colour | Its headline assertion is `expect(wordRockFill(type)).toBe(wordRockFill(type))` — **f(x) === f(x)** — followed by `void declared;`. Nothing in the file touches `fractureRock` or `setParticleTint`. Revert the fix it guards and all three tests still pass. **Produced by the very fix that diagnosed instance 5** | The blind critic on asteroid visibility, reverting the line to see if anything noticed |

Instance 18 is the plainest argument in this document for guard 2, and the
cheapest to act on: the sweep that caught it is four extra lines and one loop.
The reason it keeps happening is that a default parameter is invisible at the
call site — nothing in `bootFlight(page, { knobs: { maxLive: 4 } })` says
"mars", and nobody reviewing it sees a subset being chosen.

Instance 15 is the sharpest warning in this document, because of who wrote it
and when. It was written by a lane that had spent the night finding this exact
defect class, in the same change where it fixed another instance of it, hours
after the diagnostic "an assertion whose failure mode is unreachable" had been
articulated and recorded. Knowing about the trap does not stop you falling in.
Only reverting the code and watching the test fail does.

| 16 | `hull-feedback.spec.ts:361`, green, proving a child sees hull damage | The assertion is **area-weighted**: it compares `hitShip * 300 * 300` against `hitPips * 76 * 24 * 10`. The ship rect is **49x larger**, so a sub-JND change smeared over it beats a 200-level change on a pip, and its absolute floor of 0.002 linearised luminance is about half an sRGB level. Measured with a no-strike control in the DEFAULT configuration: one hull hit changes the ship **1.00x** at Mars and **0.97x** at Neptune — *no more than doing nothing does*. The test is green and the change is real. It is not evidence anyone can see it | The blind critic on the flight work, running a no-strike control |
| 17 | `UR-36` deleted the parallel `Phaser.Game`, and `tests/unit/arch/oneBootPath.test.ts` guards it | **The e2e harness re-creates it at runtime.** `flightBoot.ts:63` routes `**/src/main.ts`, but after any file in the graph is saved Vite serves `/src/main.ts?t=<timestamp>`, and Playwright's glob does not match a query string. Measured across 8 consecutive boots: `mainRouteHits = 0` every time, **four canvases on the page, two `Phaser.Game`s**, and which one `__kbGame` points at is a RACE — canvas at y=0 in four runs, y=720 in the other four. The guard greps source for `new Phaser.Game`; it cannot see a second game created at runtime | The same critic — whose own "Saturn flight screen" capture came back as **the Title screen**, reproducing instance 11 live, against itself |
| 18 | `V-22.4` in `flight.spec.ts` — **the acceptance check for AC-22.4**, the ticket about asteroids being invisible | Its `bootFlight` passed no `stopId`, so it took `DEFAULT_FLIGHT_CONFIG.stopId` — **mars** — and `"mars"` was written into the `expectedLuma` lookup as a literal. One stop of six, and the one where the fix was strongest and cost least; the other five had **no pixel coverage anywhere in the suite**. Instances 2 and 3 are both, verbatim, "the harness boots Mars only". This is the third time, inside the gate for the ticket about it. Swept across all six stops, the same one-line revert now reads 0.0047 / 0.0077 / 0.0090 / 0.0215 / 0.0228 — and **0.1400 at Uranus, which passes the defect**, because its material was already dark. "It passed on Mars" was never evidence about anywhere else | The debris lane, told by the coordinator to check its own gate |

Instance 17 is the one to be frightened of. It fires only when a file is saved
mid-run, which is the normal condition of a parallel overnight build — so the
evidence is trustworthy when nobody is working and unreliable exactly when
everybody is. A static guard could never catch it. The fix is one character
(`**/src/main.ts*`) plus a boot-time assertion that exactly one non-backdrop
canvas exists: the runtime half of a guard the repo only enforced statically.

| 18 | `V-22.4`, the acceptance gate for asteroid visibility, booting **Mars only** — the third verbatim recurrence of instances 2 and 3, inside the gate for the ticket about them | Rebuilt to sweep all six belted stops and to PLACE rocks down the fall rather than wait for luck: 73 objects, 24 frames, 38 readings in the bottom band. Then the negative control, same one-line revert, run through the sweep: mars 0.0047, jupiter 0.0077, pluto 0.0090, neptune 0.0215, saturn 0.0228 — and **uranus 0.1400, which PASSES the defect**. One stop in six does not reproduce the bug at all, so a single-stop verdict was never a weak signal; it was **a coin toss about the other five** | The art lane, rebuilding the gate rather than the fix |

Instance 18 is the cheapest lesson here. "The harness samples instead of
sweeping" sounds like a matter of thoroughness — a bit less coverage, a bit
more risk. It is not. Uranus would have reported the defect as *fixed* while
five stops were broken, with no hint that anything was wrong. A sampled gate
does not give you a weaker answer; it gives you a random one.

| 19 | `A-21.2`, "music has >= 3 intensity layers driven by live asteroids and combo", reporting the wiring dead | **The wiring was fine and the artifact was truncated.** Two specs both write `evidence["music"]`. One measures the index against the live HUD stream and writes `drivenBy`, `hudSamples`, `indicesObserved` — exactly the three fields the rubric reads. The other proves the composed track was fetched and **assigns over the whole key**. It runs later, so it deleted the first spec's fields before the file was written. The same clobber had already eaten the `voice` key once and been patched in place at that one call site, which is how the hazard survived to bite a second | The audio lane, checking whether the failure was in the feature or the evidence before touching any audio code |

**Instance 19 is a different animal from the eighteen above it, and worth
separating.** Every earlier instance is a check bound to the wrong thing: the
wrong screen, the wrong boot, the wrong stop, an assertion that could not fail.
This one is a **correct check, reading a correct artifact, that a later writer
silently truncated.** The binding was right the whole time and something
downstream destroyed it.

That matters because the guard is different. "Is this check testing the right
object?" would never have caught it. Only "is the artifact still complete when
it lands?" does. The fix was structural — all fourteen writers now merge
through one helper, and the artifact writer asserts the fields the rubric reads
are present before writing — rather than the one-line spread that had patched
the previous occurrence and left the trap armed.

| 20 | Every pixel measurement in the flight harness — contrast, silhouette separation, sky travel, plate legibility | **The game canvas was entirely below the fold.** `flightCanvasBox` reported `{x:0, y:720, width:1280, height:720}` against a viewport 720 tall: the canvas's top edge exactly at the window's bottom. `#app` is `display:grid; place-items:center` with the backdrop absolutely positioned so it takes no row; when that goes wrong the two canvases become two ROWS and the game is pushed off screen. Every measurement in that run was a clip to a canvas nobody could see, and the only symptom was `page.screenshot` complaining the clipped area was empty | The flight lane, clamping a rect to the viewport — the clamp then failed loudly with the real condition |

Instance 20 completes a set worth naming, because all three arrived in one
night and all three are the same failure wearing different clothes:

1. **Two games.** The harness booted a second `Phaser.Game`, and which one the
   tests read was a race (instance 17).
2. **The wrong canvas.** State and pixels read in separate round trips, so the
   numbers described a different moment than the picture (instance 14).
3. **The canvas off the fold.** The right game, the right canvas, rendered
   entirely below the visible window.

Every one of them was **invisible to every assertion**, because in all three
cases the scene booted, the state read correctly, and the numbers came back
well-formed. Nothing in a test suite notices that the thing it is measuring is
not the thing on screen. The guard that catches all three is the same and it is
embarrassingly cheap: at boot, assert there is exactly one game canvas, at most
one backdrop, and that it is actually on screen.

| 21 | `settings.spec.ts:41` failing with `Expected: "true"` / `Received: ""` — read by two people, including the lead, as *the attribute is empty, so the focus ring is missing* | **The attribute was never read.** `Received: ""` is what Playwright reports for a call that did not complete; the log ends `Protocol error (Runtime.callFunctionOn): session closed`. The test hit its 30s timeout and the blame landed on whichever call was in flight. Settings publishes `data-focus-ring="true"` correctly. Measured cost under 3 workers: **29.7s against a 30.0s budget** | The UI lane, running TWO negative controls — forcing the attribute to `"false"` gives `Received: "false"`, while cutting the timeout on healthy code reproduces `Received: ""` byte-for-byte |

Instance 21 is the only one here where the misleading thing is **an error
message rather than a check**. Everything above it is a test bound to the wrong
object. This is a test bound to the right object, reporting a failure honestly,
in a format that reads as a measurement and is not one. `Received: ""` looks
exactly like a value. It is the absence of one.

The lesson generalises past this repo: **a number that arrives in the expected
format is not thereby a number.** The only thing that separated the two
readings was running both controls — forcing the real defect and forcing the
real timeout — and observing that only one of them matched the failure
byte-for-byte. Two causes that produce identical output need two controls, not
one.

| 22 | **The gauntlet itself.** `G-e2e-whole` reported ESCALATED while its own artifact recorded 274 passed and 0 failed | Once `state.escalated[id]` was set, `runPass` hit a `continue` **before ever calling `item.run()`**. The check stopped checking. An escalated item could never come back green however thoroughly the underlying problem was fixed, so the board permanently understated reality — and the longer a project ran, the more items froze into a status nobody was re-measuring | The lead, noticing a clean 274/0 artifact sitting under an ESCALATED row |

Instance 22 is the rubric doing the thing the rubric exists to catch. An
escalation means **a human needs to decide something**. It never meant the
world stopped moving. Escalated items are now re-measured every pass; a genuine
pass discharges the escalation and says so, so a reader knows to go and close
the write-up. Anything still failing stays escalated exactly as before.

| 23 | `G-one-shadow`, PASSING: "Exactly one drawShadow and one drawLantern implementation" | Its regex is `export\s+function\s+drawLantern`, which matches **only exported top-level functions**. `FlightScene.drawLantern` is a **private class method** with hardcoded hex literals (`#F3E7D3`, `#C9B79C`, `#FF6B4A`) that never reads the profile, never calls `render/lantern.ts`, and never consults the ship catalog. **It is the ship the player actually flies.** So `R-lantern` judges a drawing the game does not use, and `profile.shipId` — chosen at profile creation, and unlockable by earning hulls — changes nothing at all | The lead, checking whether an earned hull could be equipped |

Instance 23 is the guard failing at its own stated purpose. Its comment
explains that it exists because `R-shadow` judged one render and passed it
while four menu scenes drew a second, unjudged Shadow — "a reference compare is
only worth what it covers, and nothing was checking that it covered
everything." The fix caught exported duplicates and missed method duplicates,
and the duplicate it missed is the one on screen during the entire game.

It also has a user-facing consequence, which is how it was found: a child picks
a ship when they make a profile, and can earn more hulls by playing. Neither
does anything. The reward exists, the unlock fires, the catalog is correct, and
the flight screen draws the same hardcoded cream ship regardless.

Instance 11 is the worst thing in this document. The other ten are checks that
measured the wrong thing; this one is a **human** looking at the wrong thing,
carefully, repeatedly, and reaching conclusions about art they were never
shown. Automation did not fail here — it quietly substituted one picture for
another and every downstream judgement inherited it.

Instance 7 is the mirror image of the other six and worth stating separately:
**a green test that checks the wrong thing and a red test that fails for the
wrong reason are the same bug.** Both sever the binding between the assertion
and the product; one flatters you and the other wastes your time. A red result
deserves exactly as much scrutiny as a green one, and it rarely gets it,
because red feels like the system working.

Two near-misses from the same family, both measurement rather than testing:

- Reading pixels off a live WebGL canvas without `preserveDrawingBuffer`
  returns uniform garbage. A frame containing a bright rocket measured a
  uniform 32.85 everywhere and was believed twice. Caught only because a frame
  with a rocket in it **cannot** be uniform.
- A memory watcher parsed `top`'s "unused" figure and raised CRITICAL at
  1084 MB while 32.7 GB was actually available. macOS inactive pages are
  reclaimable; "unused" is not availability.

Same lesson in both: **a measurement that is easy to take is not the same as
the right measurement**, and a number that arrives in the expected format is
not thereby correct.

---

## Why the existing guards missed

The repo already had the right instinct in one place. `KNOWN_ORPHANS` is an
architectural test that fails when a persisted profile field has no live
writer, and it is what closed instance 1. It is now empty.

It did not catch instance 5, because it asks the wrong half of the question.

    KNOWN_ORPHANS asks:  does anything WRITE this field?
    Instance 5 needed:   does anything READ it, on the path that matters?

A setting with a writer and no reader is exactly as dead as a field with a
reader and no writer, and considerably more insulting — the user watches it
persist.

---

## Guards worth having

Ordered by the ratio of instances caught to effort.

1. **Consumers, not just writers.** Extend the orphan guard so a persisted
   setting must have a live reader on a rendering path. Catches 1 and 5.

2. **Harnesses must sweep, not sample.** Any harness that takes a `stopId`,
   a locale or a screen key must be driven across the full set, or must
   declare in code why a subset is sufficient. A default that happens to be
   the one passing case is how 2 and 3 survived. Catches 2, 3.

3. **One boot path.** Assert that every e2e spec boots the shipping entry
   point. A second `Phaser.Game` in `src/` is a second product. Catches 4.

4. **Reachability is part of coverage.** A spec that drives a screen state
   should assert the state is reachable by a player, or mark itself as
   testing an unreachable case deliberately. Catches 6.

5. **Negative controls, always.** Every one of these would have been caught
   the day it was written by breaking the thing and confirming the test goes
   red. Several lanes now do this by default and record the real failing
   number in the test. It is the single highest-value habit here.

---

## The part that generalises

The tests were not the problem. The tests were excellent — 2891 of them,
95% engine coverage, a rubric, a trace-check binding every decision to an
acceptance criterion and every criterion to a test.

All of that machinery verifies **internal consistency**. None of it verifies
that the thing being checked is the thing being shipped. That binding is
maintained by attention, and attention is exactly what a green suite spends.

Every one of the twenty-three was ultimately found the same way: by someone looking at
the actual artifact — a screen, a waveform, a route, a rendered page — rather
than at a result. That is the cheapest available guard and the easiest to skip.
