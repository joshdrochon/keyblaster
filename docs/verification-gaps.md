# The check and the thing: twelve ways this codebase lied to itself

Written 2026-09-17, after a night in which twelve separate defects turned
out to be the same defect.

Nine had a green test, two had a red one, and one was a picture a person judged. None of the tests
were wrong about what they asserted. They were wrong about **what they were
asserting it against.**

This document exists because the thirteenth instance is cheaper to prevent
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

## The twelve

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

Every one of the twelve was ultimately found the same way: by someone looking at
the actual artifact — a screen, a waveform, a route, a rendered page — rather
than at a result. That is the cheapest available guard and the easiest to skip.
