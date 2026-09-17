# Coding standards

Rules this codebase follows, and the specific failure each one exists to
prevent. Every entry below cost something to learn — most of them are in
`docs/verification-gaps.md`, where twenty-three separate defects turned out to
be the same defect.

A rule with no failure attached is a preference. Those are not in this file.

---

## 1. A screen is a component. A theme is a skin.

**The rule.** A screen's layout, type colour, spacing and chrome are
invariant. A theme may change the *background* and nothing else. If a themed
value reaches the type, the buttons or the rules, that is a bug.

**The failure.** The Title screen wears the palette of the player's furthest
beacon — a good feature. But the stop's accent colour was assigned to
`this.accent` and then used to tint the wordmark, the rule beneath it and the
primary button plate. At Saturn that is pale blue on a bright beige sky, and it
reads badly. Nobody caught it because the default navy palette flatters the
accent, and every screenshot taken for months was of a new pilot.

**How to comply.** Themed values enter through one seam and stay there. If a
screen needs an accent, it takes a *fixed* one from the design tokens, not from
whatever palette happens to be loaded.

---

## 2. Every persisted field needs a live READER, not just a writer

**The rule.** A setting that can be changed must be read on the path it claims
to affect, and something must assert that.

**The failure.** `uppercase` and `increasedLetterSpacing` persisted correctly
across reloads and did nothing on any of the nine story screens. A child could
enable them, watch them stick, and read identical text. The existing guard
checked that persisted fields had a live *writer*; nothing checked that anyone
*read* them.

Same shape, different field: `profile.shipId` was chosen at profile creation
and reached nothing. Hulls could be earned and never equipped, and the flight
screen drew a hardcoded ship regardless.

---

## 3. One implementation per drawing, and the guard must see methods

**The rule.** Anything a reference compare judges has exactly one
implementation. The guard that enforces this must catch a `private` method and
an assigned arrow function, not only an exported function.

**The failure.** `G-one-shadow` asserted "exactly one drawLantern
implementation" using the regex `export\s+function\s+drawLantern`. A private
method in `FlightScene` slipped past it — and *that* was the ship on screen for
the entire game, while `R-lantern` judged a drawing the game never used. The
same blind spot hid a second Shadow on the stall card.

---

## 4. A test must be watched failing, with the real number recorded

**The rule.** Break the code, run the test, record the failing value in the
test file, restore. No exceptions, including for guards you are confident in.

**The failure.** `shardTint.test.ts` asserted
`expect(wordRockFill(type)).toBe(wordRockFill(type))` — `f(x) === f(x)`.
Reverting the fix it guarded changed nothing. It was written by a lane that had
spent the night hunting exactly this defect class, in the same change where it
fixed another instance of it. Knowing about the trap does not stop you falling
in; only reverting the code and watching red does.

---

## 5. A harness sweeps. It does not sample.

**The rule.** Any harness parameterised by stop, locale or screen runs the full
set, or declares in code why a subset is sufficient.

**The failure.** The screenshot harness booted Mars only. The briefing page
collided at five of seven stops, Earth overflowed its plate by 88px, and Mars
was the one stop that fit — so every capture looked clean. Later, the
acceptance gate for asteroid visibility also booted Mars only; run across six
stops with the defect reintroduced, **Uranus passed the defect**. A sampled
gate does not give a weaker answer. It gives a random one.

---

## 6. Wait for the thing, never for a clock

**The rule.** Poll for the state you need. `waitForTimeout` is not a
synchronisation primitive.

**The failure.** Three specs died on "nothing was blasted" because they typed a
word — destroying the rock — then waited 400ms and hoped a replacement had
spawned. A fourth read the board, took `rocks[0].word[0]`, and dispatched it a
round trip later, by which time a different rock was in that slot.

**Corollary.** Where a measurement must be taken at a known moment, stop the
world rather than racing it. Pausing the scene for the opening sample moved a
sky measurement from load-dependent (13.5 idle, 9.28 under load) to a stable
15.0.

---

## 7. Verify the page is showing what you think it is

**The rule.** At boot, assert exactly one game canvas, at most one backdrop,
and that it is on screen.

**The failure.** Three separate ways a page showed the wrong thing in one
night: a second `Phaser.Game` booted by the harness with a race over which one
was read; state and pixels sampled in different round trips describing
different moments; and the game canvas rendering **entirely below the fold**,
so every pixel measured was a clip to a canvas nobody could see. All three were
invisible to every assertion, because the scene booted and the state read fine.

---

## 8. Never move a bar to make a number pass

**The rule.** If a change cannot meet a threshold, escalate with options and a
lean. Do not adjust the threshold, re-baseline the floor, or widen a tolerance.

**In practice.** When a fix pushed the below-L\*40 floor from 28.9 to 28.7
against a bar of 28, the lane narrowed a specular band — the more correct
falloff anyway — rather than touch the bar, and reported the recovered number
"as measured, not as preferred".

---

## 9. An error message is not a measurement

**The rule.** When two causes produce identical output, run two controls.

**The failure.** `Expected: "true" / Received: ""` was read by two people as
"the attribute is empty, so the focus ring is missing". It meant the attribute
was **never read** — the test had timed out at 29.7s of a 30s budget and the
blame landed on whichever call was in flight. Forcing the real defect gives
`Received: "false"`. Forcing the timeout gives `Received: ""` byte-for-byte.
Only running both told them apart.

---

## 10. An escalation means a human must decide. It does not mean stop measuring.

**The rule.** A check that has escalated still runs. If the condition is later
met, say so.

**The failure.** The gauntlet short-circuited escalated items before calling
their check. `G-e2e-whole` reported ESCALATED while its own artifact recorded
274 passed and 0 failed, because nothing re-read it. The longer the project
ran, the more items froze into a status nobody was re-measuring.

---

## 11. Read the file before theorising about it

**The rule.** When something behaves oddly, read the code or config that
produces it before forming an explanation.

**The failure.** Four full green e2e runs wrote no JSON artifact, and the
explanation invented for it was "single-spec runs clobber the file". The real
cause was documented in `playwright.config.ts`, in a comment ending *"Three
full green runs produced no artifact before this was noticed"*: passing
`--reporter` on the CLI replaces the entire reporter array. Reading the file
first would have cost thirty seconds.
