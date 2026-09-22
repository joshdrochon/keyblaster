# KeyBlaster

**[Play it → keyblaster.vercel.app](https://keyblaster.vercel.app)**

A typing game for kids in grades 2–5. You fly the *Lantern* from Earth to Pluto,
blasting word-asteroids by typing them, and leave a lit beacon at every stop so
the ships behind you can follow.

Desktop, keyboard only, no account, no sign-up, nothing to install. Built for the
Nerdy AI Hackathon.

---

## How to play

1. **Make a pilot.** Type a name, pick an avatar, press Enter.
2. **Light Earth's beacon.** One word switches it on.
3. **Pick a stop on the map** with ← and →, then press Enter on "Fly Here".
4. **Read the briefing**, press Enter to launch.
5. **Type the word on a falling rock to blast it.** The first letter locks the
   rock; finish the word and it's gone. A rock that reaches the bottom takes a
   hull mark.
6. **At the end of the belt, type one sentence** to charge the warp drive.
7. **Place the beacon.** Then on to the next planet. Seven beacons finishes the
   route.

| Key | Does |
|---|---|
| letters | type the word on a locked rock |
| ← → ↑ ↓ | move between controls on any menu |
| Enter | confirm |
| Esc | pause mid-flight, or go back on a menu |

Everything is reachable by keyboard alone. There is no mouse-only path and no
timed fail state — nothing on screen reads as failure.

## The adaptive part

Two loops run per player, both on-device:

- **Fall speed** is calibrated to how fast that child actually types, then
  re-tuned mid-belt per word. A word they keep missing falls slower next time.
- **A difficulty knob** moves once per stage to hold success near 85%.

Progress is saved to `localStorage` on the machine. No accounts, no PII, no
analytics.

## The AI part

At each warp break — six times per route — the game asks Claude
(`claude-haiku-4-5`) for one coaching line and one sentence built from the words
that child just practised, so the sentence they type back is made of their own
hard words rather than a canned string.

Every generated sentence passes seven gates before it reaches the screen
(allowlist, shape, length, word pool, banned content, reuse, absence). Anything
that fails any gate falls back to the shipped sentence for that stop, and the
screen looks identical either way. The model is never in the game loop — one
call per break, 1500 ms timeout, shipped fallback.

Without an API key the game plays exactly the same, on the shipped sentences.

## Run it locally

Node 18+ (Vite 5's floor; developed on 26). Then:

```bash
npm install
npm run dev          # http://localhost:5173
```

That is the whole game. The AI coach needs a key; without one it uses the
shipped fallbacks and nothing else changes.

To wire the coach up, set `ANTHROPIC_API_KEY` in the environment that serves
`api/coach.ts`, and point the client at it with `VITE_COACH_ENDPOINT=/api/coach`
at build time. The endpoint is forced same-origin — the request carries a
child's missed words, and only our own function is allowed to see them.

## Tests

```bash
npm test             # unit suite + traceability check, with coverage
npm run test:e2e     # Playwright, against a real browser
npm run typecheck
npm run gauntlet     # the visual/audio/perf rubric
```

`npm test` runs 4500+ unit tests behind a 95% coverage gate on `src/engine`, and
is enforced on every commit by `scripts/precommit.sh`. The e2e suite drives the
real game with real keystrokes, including a full Title-to-placed-beacon
playthrough. Paid APIs are mocked in both — a test run never spends.

## Built with

TypeScript, Phaser 3 (WebGL), Vite, Vitest, Playwright, and the Claude API on a
Vercel serverless function. All art is vector, drawn in code — no raster assets
are loaded by the game. Voice lines are pre-rendered audio files.

## Where things are

| | |
|---|---|
| `src/engine` | pure TypeScript game rules — no Phaser, no DOM, 95% covered |
| `src/game` | scenes, rendering, audio, UI kit |
| `src/content` | per-planet word pools, briefings, beacon copy |
| `api/coach.ts` | the one server function |
| `tests/` | unit, e2e and the gauntlet rubric |
| `docs/` | decisions, PRD, architecture, art direction, story |

Deeper reading: `docs/decision-log.md` (what was decided and why),
`docs/prd.md`, `docs/architecture.md`, `docs/art-direction.md`,
`docs/story-draft-v1.md`, and `CLAUDE.md` for how the build agent works.
