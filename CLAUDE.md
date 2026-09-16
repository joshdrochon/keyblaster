# KEYBLASTER — instructions for the build agent

Read `docs/decision-log.md`, `docs/prd.md`, `docs/architecture.md`, `docs/art-direction.md`, and `docs/story-draft-v1.md` before writing code.

PRECEDENCE (highest first):
1. docs/decision-log.md      — what was decided; collisions must be logged as Cxx, never overwritten
2. docs/prd.md, docs/architecture.md — what to build and how
3. tests/gauntlet/            — the ONLY definition of "good enough" (visual + audio rubrics, perf, secrets, reference compare)
4. docs/art-direction.md      — how the world, debris, ship, Shadow, type, motion and particles are drawn (vector, in code)
5. design-reference/          — Claude Design interface comps (ui/) and reference images (refs/); NOT acceptance criteria; never loaded by the game
If a comp conflicts with the rubric, the rubric wins and you log a Cxx collision.
If a comp conflicts with the PRD, the PRD wins.
Palettes from design-reference are promoted into src/content/palettes.json and become part of the rubric.
Do not mark a rubric item passed without citing its evidence artifact.
A failed rubric item is a task: fix and re-run until green (D85). Never ship a known failure silently.

HARD RULES
- src/engine never imports Phaser or the DOM. Everything there is unit-tested (Vitest), 95% coverage gate.
- Tests are written with the feature, in the same commit. No red merges. No skipped tests on main.
- Every decision (Dxx) maps to ≥1 acceptance criterion; every AC maps to ≥1 test. `scripts/trace-check` enforces it.
- Every scene in src/game/scenes maps to a row in the design brief's screen inventory and vice versa.
- All art is vector drawn in code (D83). No raster is referenced from src/. Reference images in design-reference/refs are looked at, never loaded.
- No PII. No accounts. No analytics SDKs. No keys in the client bundle (secrets scan).
- LLM is used exactly once per warp break via /api/coach with a 1500 ms timeout and shipped fallback (D33). Never in the game loop.
- 60 fps: p95 frame time ≤ 16.7 ms in the scripted flight (P test).

OVERNIGHT GUARDRAILS (D87)
- Never deploy, never run `vercel`, never touch Vercel env.
- Paid APIs mocked unless `--live` with SPEND_CAP_USD.
- Commit after every green step on branch build/overnight-<date>; never force-push, rebase, or delete branches; main untouched.
- Write only inside this repo.
- Anything outside these rules goes to gauntlet/escalations.md, not performed.

GAUNTLET LOOP
`npm test` → `npm run test:e2e` → `npm run gauntlet` → judge step (cite evidence per item) → fix loop (8 attempts per item) → escalate to gauntlet/escalations.md → `npm run gauntlet:loop` for unattended runs → gauntlet/summary.md.

FIRST TASKS (in order)
1. Scaffold tooling: TypeScript, Vite, Phaser 3, Vitest, Playwright. `npm test` runs green on an empty suite.
2. Build src/engine with tests, module by module, in this order: allowlist, words, fallTime, selection, controller, lock, calibration, scoring, persistence, ephemeris, i18n, coach (3 transports).
3. scripts/trace-check.
4. Scenes, in the order of the screen inventory, each with e2e tests.
5. Art per docs/art-direction.md, with the reference-compare step for the Lantern and Shadow.
6. Audio graph (system voice stand-in, D88).
7. Gauntlet runners. Then the loop.
