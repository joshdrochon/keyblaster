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
| 1.3 | **Hue shift with depth** — WORLD-BAR item 3, never attempted. Every sampled point in our Mars frame falls in hue 12–28°, a 16° wedge. Needs a genuine cool in each warm palette. Re-baselines the rubric's dominant-colour check, which currently locks the monochrome in. | art lane | Hue spread across sampled depths > 40°, and the rubric's colour check updated rather than bypassed. |
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
