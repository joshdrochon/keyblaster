# KEYBLASTER — Architecture v1

Companion to `prd.md`. Decision IDs from `decision-log.md`.

---

## 1. Stack (D35, D36, D47, D48, D54, D55)

- **Client:** TypeScript, Vite, Phaser 3 (WebGL renderer). Single-page app.
- **Server:** one Vercel serverless function, `/api/coach`, proxying to the Anthropic Messages API. Rate-limited per IP. Keys in Vercel env only.
- **Build-time tools:** Node scripts for content generation (stage bundles), ElevenLabs rendering (voice, ambient beds), allowlist compilation, ephemeris fixture generation.
- **Tests:** Vitest (unit, property, simulation), Playwright (e2e, visual evidence, performance), a build-time secrets scan.
- **Hosting:** Vercel. Static assets + the one function.

## 2. Repository layout

```
keyblaster/
  docs/                    decision-log, prd, architecture, story, design brief
  src/
    engine/                PURE TypeScript, no Phaser imports (testable in isolation)
      words/               WordModel, ease updates, SRS eligibility
      selection/           weighted picker, guaranteed-catch, retention interleave, first-letter rule
      fallTime/            fall-time formula + clamps
      controller/          hit-rate window, knob state machine
      lock/                keystroke → lock/advance/typo state machine, IME handling, layout maps
      calibration/
      scoring/             WPM, accuracy, stars, results deltas
      allowlist/           compiled allowlist + blocklist filter
      ephemeris/           Keplerian elements → heliocentric ecliptic coords
      i18n/                string tables, transliteration table (hi)
      persistence/         versioned localStorage schema + migrations
      coach/               CoachClient interface + 3 transports (proxy, mock, direct-dev)
    game/                  Phaser scenes and presentation only
      scenes/              Title, Profile, Map, Briefing, Preflight, Flight, Warp, Beacon, Results, BeaconLog, Settings
      render/              parallax, particles, tweens (all eased), palettes, label plates
      audio/               Web Audio graph: beds, music layers, procedural SFX, ducking
    content/               stage bundles (en/es/hi), allowlist, palettes, voice/ambient assets
  api/coach.ts             Vercel function
  scripts/                 generate-content, render-voice, compile-allowlist, ephemeris-fixtures
  tests/                   unit/ (Vitest), e2e/ (Playwright), gauntlet/ (rubric runners)
```

**Rule:** `src/engine` never imports Phaser or DOM. Scenes call engine functions and render results. This is what makes D55 (strict unit tests) real: the entire learning system is testable without a browser.

## 3. Runtime data flow

```
keydown ──► lock/ (engine) ──► GameState delta ──► Flight scene renders
                 │
                 └─► words/ (update WordRecord) ──► persistence/ (debounced write)

spawn tick ──► controller/ (knobs) ──► selection/ (next word) ──► fallTime/ ──► Flight scene spawns asteroid

stage end ──► Warp scene ──► coach/ (one call, 1500 ms timeout, fallback) ──► Beacon scene ──► ephemeris/ ──► Map scene
```

State is a single serializable `GameState` object per stage; scenes are pure functions of it plus tweens. Every engine function is `(state, event) → state'` so tests are table-driven.

## 4. Key algorithms

### 4.1 Fall time (D19, PRD FR-8)
```
fallTime(word, player) = clamp(
  len(word) * 1.5 * player.ikiMs
  + 1200 * ease(word),
  2500, 14000)   // ms
```
Ease update: hit with fkLatency < 800 ms → ease *= 0.85; hit slow → ease *= 0.95; miss → ease *= 1.25; typo on word → ease *= 1.05. Clamp [0.25, 2.0]. New word ease 1.6.

### 4.2 Selection (D21, D22, PRD FR-9)
Weights: unknown 3.0 / weak (ease > 1.2) 2.0 / learning 1.0 / mastered (ease < 0.5) 0.3. Sample without replacement. Every 6th slot is forced guaranteed-catch if none occurred in the last 5. Retention interleave: 20% of slots from prior stops, eligible when `now − lastSeen ≥ interval(ease)` with interval = 1 stage (ease > 1.2), 2 stages (0.5–1.2), 4 stages (< 0.5). First-letter uniqueness enforced against live asteroids unless `sharedPrefixTier` unlocked (mastery: ≥ 80% of the stage pool with ease < 0.6).

### 4.3 Controller (D53, PRD FR-10)
Window = last 20 outcomes. At stage end: rate > 0.90 → tighten; < 0.80 → loosen; else hold. Tighten order: `maxLive` +1 (cap 7) else `lengthBias` +1 (cap +1). Loosen order: `lengthBias` −1 (floor −1) else `maxLive` −1 (floor 2). Exactly one change applied. Never tighten if rate < 0.85.

### 4.4 Lock state machine (D24, D25)
States: `idle` → (first unique keystroke) `locked(asteroid, typed)` → (match) advance → (complete) `blast` → `idle`; (mismatch) `typo` stays locked. With shared prefixes: `candidates` set narrows per keystroke; lock when `|candidates| == 1`. Keyboard layouts are pure key→char maps applied before matching. Devanagari: `compositionend` delivers the committed string; translit mode maps romanized buffer → target via table with variant sets.

### 4.5 Ephemeris (D15, PRD FR-17)
JPL approximate Keplerian elements (a, e, I, L, ϖ, Ω and rates; 1800–2050 table incl. Pluto). For date T (Julian centuries from J2000): compute elements, mean anomaly M = L − ϖ, solve Kepler E − e·sinE = M (Newton, 1e-6), heliocentric coords in orbital plane, rotate to ecliptic J2000, convert to λ, β, r. Fixtures generated once from a reference ephemeris and checked in.

### 4.6 Coach call (D33, D47)
```
POST /api/coach { stopId, lang, missed[], slow[], hitRate }
→ { note: string, variants: string[2] }
```
Client: 1500 ms timeout → fallback bundle. Validation pipeline: JSON schema → allowlist filter (D34) → banned-term scan → length. Any failure → fallback. Transports: `ProxyCoach` (prod), `MockCoach` (dev/offline/demo, deterministic), `DirectCoach` (dev flag only; tree-shaken out of prod builds and asserted absent by a build test).

## 5. Content pipeline (build time)

1. `scripts/generate-content` takes `story-draft` source → validates pools/sentences → emits `content/<lang>/<stop>.json`. Optionally calls the LLM to draft es/hi translations; output goes through the same allowlist and a human review step.
2. `scripts/compile-allowlist` merges Fry 1000 + pools + proper-noun (briefing-only) list → `allowlist.<lang>.json`; blocklist fixture test runs here.
3. `scripts/render-voice` (optional, only if `ELEVENLABS_API_KEY`) renders Shadow's scripted lines and ambient beds → `content/audio/`. Default: system voice at runtime (D88); ambient beds are procedural/composed if no key.
4. `scripts/ephemeris-fixtures` writes reference values for tests.

## 6. Audio graph (D62, D63)

Master → [Music bus (3 layer gains, crossfaded by intensity index)] + [Ambient bus (per-stop bed, crossfade on transition)] + [SFX bus (procedural nodes, variant rotation)] + [Voice bus (Web Speech API system voice by default; optional pre-rendered ElevenLabs files; sidechain ducks Music/Ambient −6 dB)]. UI sounds on SFX bus. Reduced-motion setting does not affect audio.

## 7. Persistence (D43, D44)

localStorage key `kb:v1:profiles`. Versioned schema with forward migrations. Writes debounced (250 ms) and on `visibilitychange`. Corrupt → fresh profile + non-blocking notice. No network sync.

## 8. i18n (D45, D46)

UI strings in `i18n/<lang>.json`; a test extracts all string literals in `src/game` and fails on any non-i18n user-facing text. Content language menu is filtered by input method. Fonts: Latin + Devanagari subsets; label plates size to glyph metrics.

## 9. Deployment (D48, D54) — run from the user's machine

```
npm i
npm test && npm run test:e2e && npm run gauntlet     # must be green
npx vercel login
npx vercel env add ANTHROPIC_API_KEY production
npx vercel env add ELEVENLABS_API_KEY production      # build-time only; can be omitted at deploy if audio is pre-rendered
npx vercel --prod
```
This container cannot reach Vercel; Claude Code on the user's machine runs these.

---

## 10. QUALITY SYSTEM — the gauntlet loop

This section exists because of D64. The build is not "done" when features exist; it is done when the gauntlet passes.

### 10.1 The gauntlet loop
Runs on every change and before every publish:
1. `npm test` — Vitest unit/property/simulation. Coverage gate: engine 95% lines/branches, game 70%. (D55)
2. `npm run test:e2e` — Playwright flows for every screen and setting.
3. `npm run gauntlet` — evidence runners:
   - **Visual rubric runner** (D60): produces screenshots and computes each metric in PRD §3.10, writing `gauntlet/report.md` with pass/fail and the image per item.
   - **Audio rubric runner** (D62): inspects the audio graph and variant tables; asserts ducking and variant rotation.
   - **Performance runner**: 60 s scripted flight in headless Chromium, frame-time histogram, p95 ≤ 16.7 ms.
   - **Reference compare**: for every asset with a file in `design-reference/refs/` (Lantern, Shadow, …), the report places the reference image and the rendered vector side by side at matched scale; the judge must either call the match or list concrete differences (silhouette, proportion, color, detail) as fix tasks.
   - **Secrets scan**: fails on any key-shaped string in `dist/`.
4. **Judge step (autonomous, unattended):** an agent (Claude) reads `gauntlet/report.md`, opens every screenshot, and must cite the evidence line for every rubric item it marks passed. A pass without a cited artifact is invalid. It never marks a decision passed; it marks a check passed.
5. **Fix loop:** every failed check becomes a task; the agent fixes, re-runs the gauntlet, and repeats. Per-item cap: 8 attempts. After the cap, or when an item passes numerically but the judge reads it as flat against `art-direction.md`'s named properties, the agent writes an entry to `gauntlet/escalations.md` (item, screenshots, measurements, what was tried, a concrete proposal) and continues with the next item. The loop never blocks on a human and never marks an escalated item as passed. `escalations.md` is the morning review queue.
6. **Overnight mode:** `npm run gauntlet:loop` runs steps 1–5 continuously until all items pass or are escalated, then writes `gauntlet/summary.md` (pass / fail / escalated counts, elapsed, last commit).

### 10.1b Overnight guardrails (no one-way doors)
- The loop never deploys, never runs `vercel`, never edits Vercel env.
- Paid APIs are mocked by default in the loop (coach via `MockCoach`, ElevenLabs and image references skipped). Live calls require `--live` plus `SPEND_CAP_USD`; the loop stops calling when the cap is hit and logs it.
- Commit after every green step on a working branch (`build/overnight-<date>`); never force-push, rebase, or delete branches; `main` is untouched.
- Writes are confined to the repo directory; no deletion outside `gauntlet/` artifacts and build output.
- Any action outside these rules is written to `gauntlet/escalations.md` instead of performed.

### 10.2 Granularity rule (D61)
Every D-item in the log must map to ≥ 1 AC in the PRD, and every AC to ≥ 1 test with a T-prefix. Additionally, every scene/state in `src/game/scenes` must appear in the design brief's screen inventory (and vice versa); `scripts/trace-check` diffs the two. A script (`scripts/trace-check`) parses the log and PRD and fails CI if any D lacks an AC or any AC lacks a T. Decisions that cannot be decomposed are marked UNDER-SPECIFIED and block release.

### 10.3 Test policy (D55)
- Tests are written with the feature, in the same PR, never after.
- Engine is Phaser-free and DOM-free so unit tests run in milliseconds.
- Simulations (controller convergence, selection invariants) run with fixed seeds and 10k+ iterations.
- No feature merges on red. No skipped tests in `main`.

### 10.4 Rubrics as code
The visual rubric (D60) and audio rubric (D62) live in `tests/gauntlet/` as executable checks, not prose. The design brief cites them so Claude Design and the build agree on the same bar.

### 10.5 Collision rule
Any change that contradicts a DECIDED item in `decision-log.md` must be logged as a Cxx collision with both versions and resolved by the user before code lands. PRs reference D-ids; a PR touching a DECIDED behavior without a matching log entry is rejected. Nothing is silently overwritten.

### 10.6 Precedence and design references (D70)
Claude Design output lives in `design-reference/` with a README stating it is direction only. `CLAUDE.md` at repo root contains:

```
PRECEDENCE (highest first):
1. docs/decision-log.md      — what was decided; collisions must be logged, never overwritten
2. docs/prd.md, docs/architecture.md — what to build and how
3. tests/gauntlet/            — the ONLY definition of "good enough" (visual + audio rubrics, perf, secrets)
4. docs/art-direction.md      — how the world, debris, ship, Shadow, type, motion and particles are drawn (vector, in code)
5. design-reference/          — Claude Design interface comps (ui/) and optional reference images (refs/); NOT acceptance criteria; never loaded by the game
If a comp conflicts with the rubric, the rubric wins and you log a Cxx collision.
If a comp conflicts with the PRD, the PRD wins.
Palettes from design-reference are promoted into content/palettes.json and become part of the rubric.
Do not mark a rubric item passed without citing its evidence artifact.
A failed rubric item is a task: fix and re-run until green (D85). Never ship a known failure silently.
```

### 10.7 Definition of done
A stage, screen, or feature is done when: its ACs pass, its rubric items have evidence, coverage holds, the trace-check is green, and the decision log has no open collision touching it.
