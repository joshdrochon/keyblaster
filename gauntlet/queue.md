# Overnight work queue — Wed 2026-09-16 → deadline Fri 2026-09-18 23:59 CDT

Written when the user left for the night. This file is the ONLY durable record of
what is queued; if the session dies, the next agent reads this file and continues.
Nothing here is allowed to be "remembered" instead of written.

## Standing rules (D87, D94) — these do not change overnight

- **Never deploy.** No `vercel`, no Vercel env. The user deploys.
- **Never force-push, rebase, or delete branches. `main` is untouched.**
- Work on `fix/playable-path`. Commit only when `tsc --noEmit` is clean AND the
  unit suite is green. No red merges — this was violated once already tonight.
- **Never ask a blocking question.** Every decision that would have been a
  question goes to `gauntlet/escalations.md` with options, evidence and a lean,
  then CONTINUE with the documented behaviour.
- Builders work disjoint file lanes and never run git; the lead owns the index.
- A critic never passes its own builder's work without citing evidence (D85).
- `npm run tickets` after every landed change so `docs/tickets.md` stays current.

## STANDING RULE — nothing is done until a critic that did not build it says so

User instruction, Sep 16 evening: *"Critic agents for every piece of work,
against our known bar, generate images and run the critic agent against those
images knowing our bar"* and *"If it finishes soon it might not be done."*

So, for every lane that returns:

1. **A critic with fresh context reviews it.** Not the builder. Not me — I
   commissioned the work, and I have already once looked at my own commission
   and called it good, which the user caught.
2. **Do not hand the critic your conclusion.** I primed one critic with my own
   diagnosis and it spent its budget arguing with my premise instead of looking.
   The blind one was more useful. Give it the artifact and the bar, nothing else.
3. **For anything visual: capture PNGs and judge the PIXELS**, against
   `design-reference/refs/world-bar.png` and the three other Alto references.
   A description of a render is not a render. `scripts/capture-screens.mjs`
   (art lane) writes every screen to `gauntlet/evidence/screens/`.
4. **Praise without cited evidence is not a result** (D85). `NOT-IMPLEMENTED`
   and "still broken, here is why" are valid outcomes.
5. **A check that cannot be made to fail is not a check.** Every fix to a rubric
   item ships with a negative control: reintroduce the defect, watch it go red.

Finishing early is the warning sign, not the goal.

## Ordering principle

Depth before breadth, because the user's bar is Alto's Odyssey and that game is
one loop executed extremely well. If the night runs out, what must be finished
is a game that can be played start to finish and feels good — not seven stops
that each technically work. Items are therefore ordered so that stopping at any
point leaves the most valuable thing done.

The user asked that nothing be left out, so P4 exists and gets done if time
allows. It is last on purpose.

---

## P0 — the game must be completable. Nothing below matters until these are true.

| # | Item | Owner | Done means |
|---|---|---|---|
| 0.1 | Resolve the belt contradiction: `playthrough.spec.ts` says the belt stalled 5 times and never completed; `belt-survivability.json` says 0 stalls in 240 runs. The sim is a 613-line reimplementation sharing no code with `FlightScene`. | gameplay lane (in flight) | One of them is proven wrong with evidence. NOT by relaxing the e2e assertion. |
| 0.2 | `tests/e2e/playthrough.spec.ts` green: Earth→Pluto, real keys only, every seam. | gameplay lane | Playwright JSON reporter shows it passing, twice, at two different worker counts (ESC-20: the verdict is load-dependent at 3 workers). |
| 0.3 | Trophies earnable. 12 defined in `src/game/ui/catalog.ts`, 0 writers to `profile.trophies`; `ResultsScene.ts:237` hardcodes `[]`. | gameplay lane | A test EARNS one by driving scoring/results. Seeding the profile does not count. |
| 0.4 | `tsc --noEmit` clean across the tree. | lead | Zero errors. Currently red in `src/game/render/profiles.ts` (art lane mid-edit). |

### P0.5 — verification by playing (new)

`.claude/agents/game-mechanics.md` defines a reusable agent that drives the real
game in a browser, keyboard only, Earth→Pluto, and reports what actually works.
**Run it as soon as P0.1–P0.4 land and `tsc` is clean.** Do not run it while the
gameplay lane is mid-edit in `FlightScene.ts` — its findings would be stale on
arrival and it would collide with the lane that is already fixing the belt.

Its charter: every fix ships with a test in the same change; a test must be seen
to FAIL before the fix; never weaken an assertion to make one pass.

Invoke with the Agent tool, `subagent_type: "game-mechanics"`.

## P1 — it must feel good. This is what a judge actually experiences.

| # | Item | Owner | Done means |
|---|---|---|---|
| 1.1 | ~~Trace the generated silhouettes~~ **CANCELLED.** Both critics rejected the sheets and refuted the premise; the code already ships more shape variety than the sheets contain (`profiles.ts` 10 profiles, `asteroid.ts` 13 debris types). See D96 and escalation E-world-5. Instruction to the art lane retracted. | — | Done: cancelled in writing. |
| 1.2 | **Layer value ramp + atmospheric lift** — the thing both critics put first. Far layers must sit near sky value at low contrast; contrast is spent only on the near layers. This is what reads as depth; it is why Alto's far mesas can be plain trapezoids. | art lane, after profiles.ts lands | Measured value ramp across the 5 layers in `flight-frame.png`, far band within ~10% of sky value. |
| 1.3 | **Rewrite the depth ramp** — THE single highest-value visual change, per measurement. Bands currently lerp toward GREY (sky S43 → far band S30), so far mesas read as dirty smudges. Lerp toward the SKY COLOUR at constant chroma, and push the ladder down to ~L*52/38/18 from today's 61/54/34, leaving the sky alone. One function. Closes WORLD-BAR items 1, 2 and 6 at once. | art lane | Centre-68% L* spread ≥ 45 (today 32.4; bar 47.8). Far band saturation back to ~S45. Foreground median ≤ L*25 (today 38; bar 19.6–23.2). |
| 1.3b | **Render an actual sun.** WORLD-BAR item 4, untouched. There is no light source: brightest non-UI pixel in the frame is L*89, a 3px sparkle, with 1,457 pixels above L*82 in total; alto-03 puts 2.1% of frame above L*90. Our L1 celestial disc is L*59.8 against L*77 sky — darker than its background, ringed, no glow, despite art-direction §2 specifying "soft radial glow". | art lane | A disc above L*90 covering ≥1% of frame, with glow. If §2's "one flat colour from palette" blocks it, escalate rather than silently deviate. |
| ~~1.3c~~ | ~~Hue shift with depth~~ **DEPRIORITISED on measurement.** Ours: hue circular SD 5.2°, 98.6% of saturated pixels in H0–30. alto-03: SD 6.9°, 95.3% in H0–30. **Alto's own desert is as monohue as ours.** The earlier critic asserted monochrome was the gap; this one measured both sides. Flatness comes from value distribution, not hue. | — | Closed as a non-goal, in writing. |
| 1.4 | **Dark framing foreground** — WORLD-BAR item 6. The near frame still reads as two symmetric chrome strips; `profiles.ts` documents an earlier attempt with `WallProfile` gaps that did not land. | art lane | Critic sign-off against `world-bar.png`, blind. |
| 1.5 | Blast/impact feel. User: "not satisfying at all." | unassigned | Particles, screen-shake, sound on destruction. Judged by a critic, not asserted. |
| 1.6 | Audio: no overlapping speech; interrupted audio eases to silence rather than cutting. | unassigned | Drill test with two overlapping triggers. |
| 1.7 | Warp progress bar eases instead of jolting, and charges audibly. | unassigned | |
| 1.8 | **Play the rendered Shadow voice.** 29 mp3s are in `src/content/audio/voice/` with a manifest, rendered with Liam at stability 0.92 (male, light, mechanical — the user's brief). NOTHING in `src/` reads them; the game still uses the Web Speech stand-in (D88). Needs a file-playback `VoiceTransport` alongside `webSpeechTransport`/`adaptiveTransport` in `src/game/audio/voice.ts`, falling back to Web Speech when a file is missing. | unassigned | A test proves the file transport is selected when the manifest has the line, and that it falls back when it does not. Overlap and ease-to-silence rules (1.6) apply to it too. |

## P2 — checks that are currently lying. 16 tickets are FALSE-PASS.

| # | Item | Owner | Done means |
|---|---|---|---|
| 2.1 | Colourblind: `palette.ts:82` reads `colorblind.accent`; the fix added `plateAccent`, which only `rubric.mjs:292` reads. Typed letters at 1.02:1. | art lane | Unit test reads contrast from what `paletteAt(id, true)` RETURNS, asserts ≥4.5:1 for all 7 stops. |
| 2.2 | `V-22.1b`: two specs race for one `parallax-overlay.json`; the Title write clobbers Flight's, so the Flight claim is certified by the Title background. | unassigned | Split filenames, point the rubric at the Flight one. |
| 2.3 | `V-22.4` passes on `desaturated-contours.json`, a file whose whole content is a contour count. | unassigned | Real measurement of the silhouettes. |
| 2.4 | `G-scenes` has no failing branch and counts 27 scenes where there are 17. | unassigned | A negative control that makes it fail. |
| 2.5 | `G-trace`: `--strict` is never passed, so "every AC has a test" is unenforced. | unassigned | Decide whether to pass `--strict` in the gauntlet; escalate if it turns the board red. |
| 2.6 | `L-6e.3` (`deadtime.json` quantised to its own 120ms tick, control asserts `<=2000` where it needed `>0`) and `L-6e.4` (`retention.json` trend is arithmetic from `0.72 ** hits`). | unassigned | Both measure the engine, not the harness. |
| 2.7 | Systemic: `evidence.has()` is `existsSync`; 14 items pass on a JSON file of any age or provenance. | unassigned | Freshness + provenance gate, like `scripts/tickets.mjs` already does. |

## P0a — THE BELT IS STILL UNSURVIVABLE. The game never learns how fast the child types. (dispatched)

An independent playthrough refuted last round's hull fix with measurements. A
faithful grade-2 model — `ikiMs 600`, `coldRecognitionMs 2400`, the exact
`GRADE2` constants from `tests/unit/simulation/belt.test.ts:68` — **stalled at
spawn 18 of 58 on Jupiter, hull 0, 2 words cleared.** Clean 100%-accuracy
repeat: hull 1 at spawn 20, hit rate 35% against a required 84.5%.

Every cold word breaches; every warm word clears. Perfect correlation, no
exceptions. `fit` falls in 3207ms and needs 3600. `jupiter` falls in 5595 and
needs 6000.

**Root cause: `calibration.ikiMs` is ALWAYS 350, the default.**

1. `PreflightScene.ts:142` plans the calibration ritual only when
   `story.newProfile` is true. **Nothing in `src/` ever sets it true** —
   ProfileCreate, ProfilePicker and Title all pass `false`. `computeCalibration`
   never runs.
2. Even if it ran, the result goes to Flight as scene data and is **never
   written to the profile**. No `updateProfile` call touches `calibration`.
3. `calibrationFromHistory`, `applyCalibration`, `needsCalibration` have **zero
   callers outside the engine**.

**Same shape as the trophies bug:** a complete, tested, coverage-gated engine
module with no live caller. That is now the THIRD instance — trophies,
progression (`StopProgress.cleared`), and calibration. Worth treating as a
class of defect rather than three incidents: the 95% engine gate makes a module
look finished while nothing calls it, and no check in the repo asks "does
anything in `src/game` import this?".

**The simulation measures a game we do not ship.**
`tests/unit/simulation/flight.ts:222` computes fall time with
`calibration: { ...DEFAULT_CALIBRATION, ikiMs: player.ikiMs }` — it hands the
grade-2 player a game that already knows they type at 600ms. So
`belt-survivability.json` and `grade2-stall-rate.json` are both green about a
different program. Fixing the simulation to use the shipped path is part of the
job, or the next fix is validated by the same illusion.

At median speed the belt is comfortable (Pluto 58/58, hull 9/9). It is fine for
the player it was tuned for, and only for them.

## P0a2 — scenes leak and swallow input (dispatched)

After Results → "fly it again": `["Briefing","Flight","Hud"]` — Briefing still
active under the belt. Settings from the pause menu: `["Preflight","Flight",
"Settings","Hud"]`, HUD drawn over the Settings panel, and **Settings totally
unresponsive to Left/Right/Tab because the leaked Flight ate the keystrokes.**
From a clean Title → Settings every control works, so it is the leak.

## P0a3 — shield canisters erase the hull record (dispatched)

Stars come from `starsForHullHits(maxHull - hull, ...)` on the FINAL hull. A run
where the hull hit 0 twice, collected 20 canisters and finished 9/9 awarded
**3 of 3 stars at 63% accuracy** plus the `beltRunner` trophy, whose shipped
copy reads "cross the main belt without a scratch". Track hits TAKEN.

Also: Earth shows 0 stars on a 7/7 map. Trophies are awarded **silently** —
nine earned across a full route, Results never mentions one.

## P0b — FUNCTIONAL BUGS found by the 17-screen critic (dispatched)

Not style. These break the game.

| # | Bug | Evidence |
|---|---|---|
| 0b.1 | **A child who finishes the game is told it is locked.** `map-all-seven` header says "7 of 7 beacons lit" and every label still reads "Locked", every disc still grey. `map-mid-run` says "4 of 7" with Mars/Jupiter/Saturn still "Locked" under lit lamps. Label/disc state is not following progress — suspect the label reads a different source than the header | `map-*.png` |
| 0b.2 | **Beacon Log prints text on top of other text.** "scratch" inside the "chain 50" card, "the same" inside "steady hull", "back" inside "last light"; caption over the pluto row; sleeping Shadow over the neptune row; bottom card row clipped. Twelve trophy icons are all the same ~10%-alpha glyph | `beacon-log.png` |
| 0b.3 | **The payoff screen is empty.** 838×105 black panel dead centre of `ending` (x267–1105, y455–560, all 21 colours within 2 units of #12151a). Title at **1.19:1** straddling a silhouette edge. Timeline labels grey-on-grey, illegible | `ending.png` |
| 0b.4 | **A rock covers its own word plate** — "beacon" renders as "eacon" at x=230–310. The depth-4.5 fix did not cover this case | `flight.png` |
| 0b.5 | **No active-target indicator.** Two word plates on screen and nothing says which one is being typed | `flight.png` |
| 0b.6 | **Pause cuts to a void** — flat #060d18, the game is not visible behind the card at all. Pausing should dim the flight | `pause.png` |

## P0c — ACCESSIBILITY. Measured contrast failures on the target age (dispatched)

Sky-borne headlines are drawn with no plate. The word plates (17.4:1) and HUD
(18.4:1) are excellent — **the failure is entirely in text the rubric never
checked**, because `V-22.8` only ever measured the word plate. That is how five
screens of 1.2–1.7:1 text shipped green.

| text | measured | screen |
|---|---|---|
| "Belt cleared. Type this…" | **1.35:1** | warp |
| "MARS BEACON" / "PLACED" | 1.61–1.72:1 | beacon |
| Results headers | 1.59–1.72:1 | results |
| "the map is drawn" | **1.19:1** | ending |
| "Locked" stop labels | **≈1.4:1** | all maps |

Widening the contrast rubric to cover sky-borne text is part of the fix, with a
negative control proving it fails on today's values.

## P1b — the depth claim was 0.7% real where it matters (art lane, dispatched)

The 13.1% → 33.4% move below L*40 is real and almost entirely **below y=370**:
rows 500–720 are 92.6% below L*40; rows 0–370 are 5.9%, and **0.7% excluding
the HUD boxes**. The gain came from a bottom gradient wash that returns
identical values at x=150 and x=1000 — a vertical ramp, not a scene. I reported
it as progress without asking where in the frame it landed.

Worse, item 1 is **inverted**: far band `#835638` L*40.8, mid `#a4744e` L*52.9,
near `#7a4f33` L*37.8. The farthest band is 12 points darker than the middle.
Whole stack spans 15 L* against the bar's ~62. Hues 23°/26°/23°.

No horizon at all: columns x=150 (no landform) and x=1000 (landform) return
identical values from y=368 to y=719. The quadrant x=0–650, y=370–720 is empty
— a quarter of the frame.

**Two 1px edge remnants survive on flight, and only on flight** — the one screen
the "seamless" complaint was about. Left `#08111f` (the EARTH palette's ground
colour, on a Mars screen) for 592/720 rows; top `#393637` neutral grey for
1233/1280 columns.

Prescription: four continuous full-width bands, profiled bottom edges, values
~L*68/52/34/14 back-to-front, hue separated, a drawn foreground silhouette
replacing the wash, streak alpha ×3. Closes WORLD-BAR 1, 2, 3, 6, 8 plus the
edge regression plus the flat bases — one routine.

## P2b — the ticket board's own defects (from its critic). FIXED so far: D-1, D-2, D-3, D-10, D-11, D-18, D-21.

The board was reviewed by a critic that did not build it. Its verdict was **no,
do not trust this board**, and its central finding stands even after the fixes:
**FALSE-PASS and EXEMPT are 100% hand-typed, and DONE is the default when
nobody typed anything.** The board does not compute status so much as compute
*the absence of a human objection*. Deleting five lines from
`known-false-passes.json` flipped a ticket to DONE with no evidence change —
I did exactly that at 17:50, and it was only safe because I happened to verify
the feature by hand first. The mechanism does not require that.

| # | Defect | State |
|---|---|---|
| D-1 | Staleness computed for rubric items then DISCARDED at the AC boundary — 105 of 184 DONE rows never evaluated the freshness clause the DoD promises | **fixed** (DONE 184→169) |
| D-2 | `.skip` / `.todo` / `.fixme` / empty-body / commented-out citations all graded STRONG | **fixed** |
| D-3 | Prefix collision: `AC-6d.1` was DONE on tests titled `AC-6d.1c` | **fixed**, id now anchored |
| D-10 | The regex-escaping test was green for the wrong reason — `includes(id)` short-circuits before the regex runs, so it passed with escaping removed | **fixed**, representative fixture |
| D-11 | Propagation tests pinned to one defect, red the moment it was fixed | **fixed**, structural |
| D-18 | `report.md` writes `ESC!`; parser only accepted `ESCALATED`, so the branch was dead and escalated items fell to OPEN with the false reason "no row for this item" | **fixed** |
| D-21 | `tickets:check` exited 0 with 26 OPEN and 31 BLOCKED while the DoD names it the sole measure of 100% | **fixed**, now fails on anything not DONE/EXEMPT |
| D-4 | `AC-10.2` is DONE on an `it.fails` — a green test whose green comes from the assertion failing | open |
| D-6 | 54 decision tickets (29% of DONE) are DONE because `/\bD\d+\b/` matched anywhere in `prd.md`, including section headings and the NON-GOALS list. `D03` is DONE for being explicitly not built | open |
| D-7 | 16 screen tickets are DONE on `existsSync` — a one-line stub passes | open |
| D-8 | Collision DONE is absence-of-the-word-"unresolved" on a single line | open |
| D-13 | 11 of 33 rubric items name no AC, so their failures propagate nowhere. `AC-24.2` is DONE while `R-lantern` is OPEN, and `prd.md` states the edge in plain text (``gauntlet `R-lantern` ``) — parse it | open |
| D-15 | FR binding is string surgery: `AC-22.1`→`FR-22`, but FR-22 is "Nothing reads as punishment" and owns `AC-22b.1/.2`. Nine visual ACs roll up to the wrong FR; `AC-22b.x` roll up to nothing | open |
| D-16 | Four AC families have NO FR ticket — 19, 20, 21 (all of audio), 22b — because `parseFrs` only matches `**FR-n Title.**` and those sections use `### 3.x` headings. Silent | open |
| D-17 | Staleness is mtime-only: `touch report.md` converts 21 UNVERIFIED to DONE, and `git checkout` rewrites every mtime. Fix is a content hash of `src/` written into `report.md` at generation | open |
| D-19 | Escalation ids are positional (`KB-ESC-{i}`) — inserting a heading renumbers every one | open |
| D-20 | All BLOCKED tickets are unresolvable by anyone: every `## ` heading in `escalations.md` is BLOCKED unconditionally, so writing a resolution does not move the ticket, only deleting the heading does. Six of 27 are already not pending. **Zero-BLOCKED is the DoD's definition of 100%, so 100% is currently unreachable by construction** | open |
| — | Not covered at all: NFR-1..5, `architecture.md`, `art-direction.md`, CLAUDE.md's HARD RULES, and `summary.md`-vs-`report.md` agreement (which is failure #1 the board was built for) | open |

## P2c — C14: `contentLang` is a setting that reaches nothing

`scenes/lib/content.ts` globs `content/en/*.json`, `parseStageBundle` returns
`lang: "en"` as a literal, `support/vocab.ts` globs `content/en/`, and
`PreflightScene` passes `lang` in a payload that is not a `FlightConfig` key.
A child could select Spanish and type English words. **Predates D95 — the cut
exposed it.** Invisible because `tests/unit/content/` reads bundles with
`node:fs` rather than through the game's own loader, so the suite validated
content the game could never reach. Logged as C14; lean is to narrow FR-14 for
the hackathon. **Do not "fix" this by deleting the es/hi content.**

## P3 — coverage. `src/game` is 18.53%; 50 of 72 files never execute.

| # | Item | Done means |
|---|---|---|
| 3.1 | The five tests the coverage audit ranked by P(broken now): colourblind contrast from the renderer; a trophy earned by playing; survivability against `FlightScene`'s own loop; settings surviving a reload (`settings.spec.ts` has zero `page.reload()`); stall→restart. | All five written and green. |
| 3.2 | Architecture §10.1 specifies a "game 70%" gate that exists in no config. Either add it or escalate that we are not meeting our own documented bar. | Decided in writing. |

## P4 — breadth. Everything else, so nothing is left out.

- Spanish/Hindi are cut from the shipped menu (D95) but still built and tested. Do NOT delete the content; `SHIPPED_LANGS` in `src/engine/i18n/contentLang.ts` is the whole switch.
- Remaining OPEN tickets (26 at last generation) — `docs/tickets.md`, sorted worst-first.
- Remaining UNVERIFIED tickets (23) — each is a weak citation or stale evidence.
- Full gauntlet pass once `tsc` is clean and the machine is quiet; `P-22.9` and
  `L-6e.1` will still escalate (capped at 8 attempts, need a headed 60fps capture).

## Gates that must hold before any commit

```
npx tsc --noEmit                                   # zero errors
npx vitest run tests/unit --coverage.enabled=false # all green
node scripts/trace-check.mjs                       # OK
node scripts/tickets.mjs                           # board regenerated
```

`scripts/precommit.sh` enforces the first three plus the board. Do not bypass it.

## Left for the user (cannot be done from this side)

- 28 BLOCKED tickets: 24 escalations + 4 unresolved collisions (C10, C11, C12, C13).
- Headed 60fps capture for `P-22.9` and `L-6e.1`.
- The 2–3 minute demo video.
- Deploy.
- The depth-vs-breadth call. Not answered before they left; proceeding depth-first
  as documented above, per D94 (continue with a documented behaviour, never block).
- **E-world-5: the world-art direction call.** Terrain grammar with a horizon (A),
  space grammar with no ground plane (B), or palette re-baseline for hue range (C).
  Lean B+C. Proceeding meanwhile on the direction-independent part (1.2, 1.3).
