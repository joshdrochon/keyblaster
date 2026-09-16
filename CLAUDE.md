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

UNATTENDED RULE (D94) — THE LOOP NEVER BLOCKS ON A HUMAN
- NEVER ask the user a blocking question during an unattended run. No
  AskUserQuestion, no "should I?", no waiting. A run that stops for a human at
  3am has failed, however good its reasoning was.
- Every decision that would have been a question goes to gauntlet/escalations.md
  instead: the options, the evidence, and a lean. Then CONTINUE with the
  documented behaviour. That file is the morning review queue and it is the
  ONLY channel for a decision that needs the user (architecture 10.1 step 5).
- Permissions are pre-granted in .claude/settings.json, including the D87
  guardrails as explicit deny rules (no vercel, no force-push, no rebase, no
  branch delete, no push to main, no .env reads). Deny beats allow, so the
  guardrails hold even if a later allow rule is added carelessly.
- Subagents inherit this. A lane brief must never instruct an agent to do
  something that prompts; if a tool is not pre-granted, do not use it.

OVERNIGHT GUARDRAILS (D87)
- Never deploy, never run `vercel`, never touch Vercel env.
- Paid APIs mocked unless `--live` with SPEND_CAP_USD.
- Commit after every green step on branch build/overnight-<date>; never force-push, rebase, or delete branches; main untouched.
- Write only inside this repo.
- Anything outside these rules goes to gauntlet/escalations.md, not performed.

GAUNTLET LOOP
`npm test` → `npm run test:e2e` → `npm run gauntlet` → judge step (cite evidence per item) → fix loop (8 attempts per item) → escalate to gauntlet/escalations.md → `npm run gauntlet:loop` for unattended runs → gauntlet/summary.md.

BUILDER/CRITIC FAN-OUT (D93)
Work is split into the smallest independently judgeable pieces. Each piece gets a
builder subagent AND a separate harsh critic subagent with fresh context. The critic
inspects the real artifact against the bar - the rubric in tests/gauntlet/ for
measurable items, design-reference/refs/*.png for the two reference-compare items -
and names the single biggest remaining gap. The piece loops until the critic passes
it blind. Praise from a critic is not a result.
- Builders work DISJOINT file lanes and never run git. The lead agent owns the git
  index; concurrent git from parallel agents corrupts it.
- A critic never marks its own builder's work passed without citing the evidence
  artifact (D85). NOT-IMPLEMENTED is a valid status; "passed" without evidence is not.
- The 8-attempt cap and gauntlet/escalations.md still bound every item, so one stuck
  piece cannot eat an unattended night.

FIRST TASKS (in order)
1. Scaffold tooling: TypeScript, Vite, Phaser 3, Vitest, Playwright. `npm test` runs green on an empty suite.
2. Build src/engine with tests, module by module, in this order: allowlist, words, fallTime, selection, controller, lock, calibration, scoring, persistence, ephemeris, i18n, coach (3 transports).
3. scripts/trace-check.
4. Scenes, in the order of the screen inventory, each with e2e tests.
5. Art per docs/art-direction.md, with the reference-compare step for the Lantern and Shadow.
6. Audio graph (system voice stand-in, D88).
7. Gauntlet runners. Then the loop.
