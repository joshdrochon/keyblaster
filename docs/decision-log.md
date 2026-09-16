# Decision Log — KEYBLASTER (Nerdy AI Hackathon)

Maintained across grill-me rounds. Every decision has an ID, a status, and a round reference.
**Collision rule:** if anything new in the conversation conflicts with a DECIDED item, it gets logged under Collisions with both versions side by side and stays unresolved until the user picks one. Nothing is silently overwritten.

Statuses: DECIDED · RECOMMENDED (my lean, not yet confirmed) · OPEN · SUPERSEDED (replaced by a later decision; kept for the record)

Last updated: Art direction v1 issued; roadmap set (D82). Next: build.

---

## Context

- **Name: KEYBLASTER** (D65, working title, user-approved "for now"). Folder: `keyblaster/`. Docs in `keyblaster/docs/`, retired material in `keyblaster/archive/`.

- Hackathon: Nerdy AI Hackathon, submissions close Fri Sep 18 2026 11:59 PM CDT. 2–3 min demo video required; repo and live demo recommended.
- Submitting under: **My own idea** (typing game; typing is not one of the three listed prompts).
- Origin: Type Storm (Varsity Tutors) has a good loop but the end-of-level sentence doesn't reuse the words just typed, and the narrative is disjointed. We fix both.
- Judges are Nerdy engineers who built the existing game catalog.

---

## Decisions

### Learner and outcome
- **D01 · DECIDED · R1** Learner is grades 2–5. Hackathon states no age range for own-idea entries; only cues are "elementary" (Prompt 01) and "young learners" (Prompt 03).
- **D02 · DECIDED · R1** It is a typing game. Primary outcome: typing WPM and accuracy. Reading fluency and vocabulary are deliberate side effects, measured but not the headline claim.
- **D03 · DECIDED · R2** Whole-word typing fluency only. No finger-placement or home-row instruction.

### Core frame
- **D04 · DECIDED · R3** Rocket, fixed on screen, world scrolls top-to-bottom (vertical scroller). The rocket has a phase blaster. Asteroids fall carrying words; typing the word blasts the asteroid. Misses strike the rocket.
- **D05 · SUPERSEDED · R2→R3** Fuel canister mechanic. Removed: aggregate/delayed feedback, constant low pressure. Replaced by D04.
- **D06 · SUPERSEDED · R1→R3** Balloon / words-escaping-the-page defensive frame. Replaced by D04.
- **D07 · DECIDED · R3** Planet-based blaster (Missile Command frame) rejected: it is a Type Storm reskin and loses forward motion.
- **D08 · DECIDED · R2** One story world, done well. No swappable skins.
- **D09 · DECIDED · R2** Asteroid words come from the current stage's story text. The end-of-stage sentence is built from the words the player just blasted.
- **D10 · DECIDED · R4** No v2. Everything decided ships. Time is not the constraint; spec quality is.

### Story and world
- **D66 · DECIDED · post-grill** Co-pilot robot name: **Shadow**. Replaces placeholder "Shadow" everywhere (story, coach notes, voice lines). Rejected: Flint, Ember, Sprocket, Crackle, Clank, Rivet, Toggle, Blip, Fizzle.
- **D65 · DECIDED · post-grill** Game name: **KeyBlaster** (keys fire the blaster). Replaces the interim "Keyfire". Rejected: Beacon Run, Star Charter, Warp Words, Keyfire. Alternates held: Firstlight, Lantern, Wordbreaker.
- **D11 · DECIDED · R5** Mission: charting the solar system for the first time. At each stop the player places a beacon that outputs warp coordinates so future ships can traverse easily (free-climber-pounds-the-stakes metaphor).
- **D12 · SUPERSEDED · R5→R8** Nine stops Mercury→Pluto. Claude's misreading; see C05 and D56.
- **D56 · DECIDED · R8** Route is Earth outward to Pluto: Earth, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto (Pluto included deliberately, not a planet).
- **D57 · DECIDED · R8** Earth is the launchpad. Its beacon already exists; the player types one word to activate it. This is the tutorial for the beacon mechanic so it's familiar when it matters at Mars. Six beacons are placed by the player (Mars→Pluto); Earth's is the seventh on the map.
- **D58 · DECIDED · R8** Type Storm is the reference for loop mechanics ONLY. Its graphics are explicitly not the bar.
- **D59 · DECIDED · post-grill** No Nerdy game is the visual bar; none are good-looking enough. Solar Voyager is noted only as the title judges will compare us to (3D solar system). The visual bar is external. OPEN: which reference games. Claude's proposal: Alto's Odyssey (parallax, lighting, living idle), Sky: Children of the Light (warmth, glow), Gris (color as narrative), Duolingo (UI animation/juice ceiling for consumer edtech). User checked them: **Alto's Odyssey is the primary visual bar.**
- **D60 · DECIDED · post-grill** The visual bar is enforced as an evidence-based rubric, not a judgment. Draft checks: ≥5 parallax layers at distinct speeds; idle frame never still (two screenshots 1 s apart differ); sky/background gradients shift across a stage; silhouettes readable when desaturated; zero linear tweens; distinct particle signature per event (blast/hit/warp); 5–7 color palette per stage plus one accent; word labels on a contrast plate meeting accessibility minimums; 60 fps by frame-time histogram. The gauntlet judge must produce evidence per line; no evidence = fail. Duolingo-style UI juice items to be added in the PRD.
- **D13 · DECIDED · R5** Overview map is a Destiny-style Director; charted planets show a blinking beacon.
- **D14 · DECIDED · R4** Claude drafts the story spine; user approves.
- **D15 · DECIDED · R6** Beacon outputs both real heliocentric ecliptic coordinates (J2000, computed for the play date) and a pulsar-navigation fix as flavor (NASA SEXTANT / Pioneer-Voyager pulsar map precedent).
- **D16 · DECIDED · R6** Story approval happens as one batch document, seven chapters.

- **D67 · DECIDED · post-grill** Story draft v1 approved as the spine. All planet facts verified against NASA primary sources Sep 15 2026 (PRD §6); D67 fully closed. Spanish and Hindi versions follow (D45).
- **D68 · DECIDED · post-grill** Design brief v2.1 (`docs/design-brief-v2.md`) is the current brief for Claude Design. v1 archived. v2.1 sweep added: scope block, Earth activation screen, stall state, ending card, trophies, leaderboards, multiplier HUD, star ratings on map, scored transitions, focus states, colorblind and reduced-motion variants, fallback states, `{shipName}`.

- **D69 · DECIDED · post-grill** `docs/prd.md` v1 decomposes every decision into ACs and tests; `docs/architecture.md` v1 defines stack, module boundaries (engine is Phaser-free), algorithms with numbers, content pipeline, deploy, and the Quality System (gauntlet loop, granularity rule, test policy, rubrics-as-code, collision rule, definition of done). Numeric constants in PRD FR-8/9/10 are first-pass and tunable; changing them is not a collision, changing the rules is.

- **D71 · DECIDED · post-grill** Debris is per-stop and scientifically correct: Earth→Mars rusty rocky regolith; Mars→Jupiter = the real main asteroid belt (carbonaceous, silicate, metallic types); Jupiter Trojans + ring dust; Saturn ring material = mostly water-ice chunks (dust to house-sized); Uranus dark icy ring particles; Neptune icy bodies + faint dusty rings (Trojans dropped from art set, weak kid-level source); Pluto/Kuiper Belt = ice chunks (water, nitrogen, methane) and small KBOs. All rows sourced against NASA in PRD FR-12b (Sep 15 2026); each stop's debris set is checked against the table by the gauntlet.

- **D72 · DECIDED · post-grill** At the start (Profile screen): choose pilot name/avatar, choose a ship, name the ship. See C07.
- **D73 · DECIDED · post-grill** Ship skins: cosmetic variants unlocked by mastery milestones only (never time-played, never purchase). Does not collide with D08 (see C08).
- **D74 · DECIDED · post-grill** Trophies: mastery-based, informational (e.g., first beacon, all seven, 50-word combo, 3★ stop). Displayed in the Beacon Log. Never comparative, never a lives/rank mechanic. Grounded in Deci, Koestner & Ryan 1999 (informational vs controlling rewards).
- **D75 · DECIDED · post-grill** Combo multiplier on score + a keystroke tone that steps up a musical scale on each successful keystroke and resets on typo. Reinforces D49/D63 procedural SFX.
- **D76 · DECIDED · post-grill** `docs/audit.md` is produced at the END of the build, last roadmap item before submission. Scope: a full sweep of the PRD and architecture against (1) every D-item and its shipped behavior, (2) every learning-science claim and its citation (source present, source says what we claim, claim used correctly), (3) every gauntlet rubric item and its evidence artifact, (4) test coverage vs the granularity rule, (5) the full collision history and its resolutions, (6) guardrail/allowlist and COPPA posture, (7) anything else material to the submission claims. Findings are logged as pass / gap / misstatement with a fix or a retraction.
- **D78 · DECIDED · post-grill** Screen completeness is enforced: the design brief carries a screen inventory derived from the scene state machine; `trace-check` fails if a scene exists without an inventory row or a row without a scene. Sweep added pause/quit, profile picker, Beacon Log empty state, unlock toasts, reset confirm, relative-board opt-in.
- **D82 · DECIDED · post-design** Roadmap: two parallel tracks. Track A (art/UI): art direction spec drives all world/character art in the build; Claude Design used for INTERFACE screens only (Title, Profile, Map, Briefing, Results, Beacon Log, Settings, Pause), not Flight or characters — its Flight directions were rejected as below bar. Track B (engine): Claude Code builds `src/engine` + tests first (no art needed). Wed: tracks meet, scenes + art. Thu: gauntlet, polish, demo video. Fri: write-up, `audit.md`, submit.
- **D83 · DECIDED · post-design** Everything is vector drawn in code: world, debris, the Lantern, Shadow, briefing illustrations, UI. No raster art ships. Effort is explicitly not a constraint; iteration is.
- **D84 · DECIDED · post-design** Image models are reference-only. If the user supplies `IMAGE_API_KEY`, a script may generate reference pictures into `design-reference/refs/` for drawing Shadow/Lantern; never loaded by the game; build test fails if any raster is referenced from `src/`.
- **D85 · DECIDED · post-design** Quality bar: production-grade, Apple-feature-worthy. Decomposed as: all rubric/quality checks pass with evidence; a rubric failure is a task that loops until green; a screen that passes checks but reads flat, or a check that fails 8 attempts, is written to `gauntlet/escalations.md` with screenshots, measurements, attempts, and a proposal, and the loop continues unattended (overnight mode). Escalated items are never marked passed. Nothing below the rubric ships.
- **D86 · DECIDED · post-design** `docs/art-direction.md` v1 is the art spec for the build (layer stack, light, starting palettes, debris shapes, Lantern, Shadow, type, motion curves, particles, iteration rule).
- **D87 · DECIDED · post-design** Overnight guardrails: no deploy, paid APIs mocked unless `--live` with a spend cap, commit-per-green-step on a build branch, no force-push/rebase/delete, writes confined to repo. Anything outside these is escalated, not performed. No one-way doors.
- **D88 · DECIDED · post-design (revised Sep 16)** ElevenLabs is PLANNED, not optional. System voice (Web Speech API) is the stand-in so the voice path (bus, ducking, timing, spoken coach notes) is built and tested before the key exists; swapping is one module. When `ELEVENLABS_API_KEY` lands: scripted lines pre-rendered via ElevenLabs. OPEN for tomorrow: runtime coach note voice = system voice (lean), text+chirp, or live ElevenLabs call (latency/cost/on-camera risk). Ducking (D62) unchanged.
- **D89 · DECIDED · art** The Lantern's beam emitter is engineered tech, not a headlight: large lens, iris aperture that opens on fire, three concentric focusing rings, finned heat housing, pivot mount that tracks the target. Still the single beam source; no gun barrel. The shared-prefix "dual cannons" tier (D25) is a visible twin-lens head upgrade to the same emitter. Ship reads as a rocket (pointed nosecone, three swept tail fins, engine nozzle), not a submarine. No text on the hull; `{shipName}` rendered dynamically if shown.
- **D90 · DECIDED · art** Lantern reference approved: top-down symmetrical rocket, nose up, emitter at nose, exhaust down, three fins, porthole, fin star, no text (`design-reference/refs/lantern-topdown.png`). Four colorways (coral, teal, gold, pink) become the four base ships (D79). This image is the complete reference, emitter included, as drawn (user approved the design as-is). The earlier emitter image is kept in refs/ for context only.
- **D79 · DECIDED · design Q&A** Four ships, each with a base look plus one unlockable skin (8 total). Base ships unlock at 1 / 3 / 5 / 7 beacons; skins unlock at first 3★ stop / 25-combo / 50-combo / 100% on a retention set. Names and looks by design.
- **D80 · DECIDED · design Q&A** Twelve trophies: First Light, Pathfinder, Belt Runner, Ring Weaver, Chain 25, Chain 50, Sharp Eye, Steady Hull, Long Memory, Map Maker, Dark Side, Last Light (definitions in PRD FR-6d).
- **D81 · DECIDED · design Q&A** Beacon coordinate display: "λ 214.6°  β −1.2°  r 1.52 AU" plus one pulsar-fix flavor line. Multiplier = combo count capped ×10, resets on typo or hull hit. Calibration ritual maps to steps: Hull check (1 short word → first-key latency), Systems check (3–4 short words → inter-key interval), Engines (1 long word). Artboards 1920×1080; Google Fonts with Devanagari support; directions diverge on rendering style + light mood only.
- **D77 · DECIDED · post-grill** Core loop must be addictive, responsive, rewarding, engaging, and learning-centric. Decomposed (D61): responsive = input-to-visual ≤ 1 frame (16.7 ms); rewarding = every keystroke yields visible + audible feedback; engaging = no dead time > 2 s during flight; learning = retention line improves across a run; addictive = the above plus playtest targets for session length and replay rate.

### Learning engine
- **D17 · DECIDED · R2** Difficulty targets ~85% success (Wilson et al. 2019), treated as the center of an ~80–90% band, tuned in playtest.
- **D18 · DECIDED · R2** Difficulty increases only as the player gets better. Cold start handled by a disguised calibration/warm-up wave.
- **D19 · DECIDED · R4** Size/fall-time split. Asteroid size shows word length (motor cost, visible). Fall time is computed per player: (letters × keystroke budget from measured typing speed) + (recognition budget from that player's history with the word). Never shown as a rule. Grounded in LaBerge & Samuels (fluency = recognition latency) and Wilson et al. (85%).
- **D20 · DECIDED · R3** Controller knobs migrate from Type Storm's structure. Working rule: adjust one knob per stage.
- **D21 · DECIDED · R2** Speed tracks fluency; frequency tracks mastery. Weak-but-known words get time pressure; unknown words get more frequency and more time; mastered words become rare combo fodder.
- **D22 · DECIDED · R2** Every wave contains at least one guaranteed-catch word.
- **D23 · DECIDED · R2** Misses never cost story progress; a missed word comes back sooner.
- **D24 · DECIDED · R3** Auto-lock on first keystroke, no Enter. Wrong letter shakes, does not drop the lock. No switching targets once locked.
- **D25 · DECIDED · R4** Shared-first-letter asteroids are a mastery-gated difficulty tier (skinned as "dual cannons"). Lock resolves when the typed prefix is unique. Grounded in orthographic mapping (Ehri 2014).
- **D26 · DECIDED · R4** Shield canister ships. It carries a story word; tradeoff is which story word to prioritize, never a utility word.
- **D27 · DECIDED · R3** Hull: three hits per stage, full repair at stage end. Hits feed the stage star rating (informational feedback, Deci/Koestner/Ryan 1999).
- **D28 · DECIDED · R3** A missed asteroid visibly strikes the rocket: shake and spark, no explosion, no red flash.
- **D29 · DECIDED · R3** Empty hull = engine stalls out, mission fail. Restart from stage start.
- **D30 · DECIDED · R3** End-of-stage sentence is typed in a calm break (belt cleared, asteroids stopped). Blasted words highlighted; typos re-highlight the letter. Completing it activates the warp drive.
- **D31 · DECIDED · R5** The player should always feel like the best typer in the world; measured success ~85%, felt success near 100%. No red X's, no lives counter, no "wrong" sound.

### AI and content
- **D32 · DECIDED · R4** LLM is the last possible option. Fast, efficient, token-cheap. Never touches the game loop. Game runs at 60 fps.
- **D33 · DECIDED · R5** AI runs in two places: (a) authoring time, all seven stops pre-generated to shipped JSON; (c) one small call per warp break using the player's misses to produce next-stage sentence variants and a one-line coach note. Fails silently to the shipped bundle. Demo shows the coach note changing with misses.
- **D34 · DECIDED · R4** Guardrails in three layers; the graded word allowlist (Fry/Dolch-style plus authored story vocab) does the real work. System prompt and post-filter are backups. No swearing, no alcohol, etc.

### Gauntlet and quality bars
- **D61 · DECIDED · post-grill** Granularity rule. No decision is considered spec'd until it is decomposed, recursively, into observable checks (tests, measurements, screenshots with criteria). The gauntlet loop runs the checks, never the decisions. Any decision that cannot be decomposed into evidence is flagged UNDER-SPECIFIED, not passed. The PRD carries the full decomposition for every D-item.
- **D62 · DECIDED · post-grill** Audio bar: Disneyland-level immersion. Draft rubric: a layered ambient bed per planet; adaptive music with intensity layers tied to player state; scored transitions between every screen; a distinct SFX per event with ≥3 variants (no repetition fatigue); music ducks under Shadow' voice; warp is a full stinger; UI sounds for every interaction. Each line becomes an evidence check under D61.

- **D64 · DECIDED · post-grill** The architecture doc (written in the PRD phase) must include a "Quality System" section that names the gauntlet loop explicitly and references D61 (granularity rule), D60 (visual rubric), D62 (audio rubric), D55 (test policy), and this log's collision rule. Architecture is not complete without it.

- **D70 · DECIDED · post-grill** Precedence for the build agent (goes verbatim into `CLAUDE.md`): decision-log → prd/architecture → `tests/gauntlet` rubrics → `design-reference/` (Claude Design output). Design comps are direction only, never acceptance criteria; the gauntlet is the only definition of done. Comp vs rubric conflict → rubric wins + Cxx logged. Comp vs PRD conflict → PRD wins. Exception: Claude Design's seven palettes are promoted into `content/palettes.json` and thereby become part of the rubric.

### Tech
- **D47 · DECIDED · R7** API key lives in a serverless function proxying to Anthropic. Nothing in the browser. Build three test paths behind one interface: serverless proxy (prod), local mock with canned coach notes (dev/offline demo), direct-to-API behind a dev flag (prompt testing).
- **D48 · SUPERSEDED · R7→R8** Vercel/Netlify recommendation. See D54.
- **D54 · DECIDED · R8** Host on **Vercel** (account confirmed active via Gmail: sign-ins May 2026, domain registered via Vercel, receipt Apr 2026). Railway account also exists but is on a paid team with an outstanding invoice email dated Sep 14 2026, and Railway has no permanently free tier ($5 one-time trial credit, then a $1/mo Free plan or $5/mo Hobby). Render account exists but shows failing services and an expired free Postgres. Netlify: no account found. Railway CLI is viable if the user prefers it, but it is not free and the invoice should be cleared first.
- **D55 · DECIDED · R7 (bonus)** Strict unit tests for everything built. Vitest, tests written alongside every module (learning engine, controller, allowlist filter, word picker, fall-time math, coordinate math, persistence). Coverage gate in CI; no feature merges without green tests. Rationale: cannot break existing features while adding others on a short deadline.
- **D49 · SUPERSEDED · R7** Procedural SFX + composed music. Refined by D63.
- **D63 · DECIDED · post-grill** Audio sourcing. ElevenLabs renders Shadow' scripted voice lines and the per-planet ambient beds **at build time, shipped as files**; no runtime ElevenLabs calls. Procedural Web Audio for all reactive SFX (blast pitch vs combo, hit intensity vs hull, UI). Music is composed files with intensity layers. Coach notes (runtime AI text) display as text with a short Shadow chirp, never live TTS, so the LLM call stays the only runtime dependency (D32).
- **D35 · DECIDED · R5** 2D, Phaser 3 with WebGL renderer, high fidelity: parallax depth, particles, lighting, screen-space effects. "2D that feels 3D." Three.js rejected as looks-over-mechanic.
- **D36 · DECIDED · R5** TypeScript + Vite + Phaser 3. Full-fidelity stack, not a trimmed one.
- **D37 · DECIDED · R1** Web, desktop, keyboard only.
- **D38 · DECIDED · R4** Solo build.

### Learning evidence and demo
- **D50 · DECIDED · R7** Results screen shows: WPM and accuracy this stage vs last; per-word faster-than-before markers; and a retention line from delayed retest (earlier stages' words interleaved into later stages, D21). Grounded in Bjork (performance ≠ learning), Cepeda (spacing), Hattie & Timperley (feedback model). See open item on presentation for young kids.
- **D51 · DECIDED · R7** Calibration: ~20 s pre-flight checks on a new profile only, framed as the ship's narrative startup sequence, measuring baseline keystroke speed and first-letter latency. Returning players calibrated by history.
- **D52 · DECIDED · R7** Demo video: user plays and narrates. Spine: briefing → play → miss two words → warp break coach note reacts to those exact misses → results show retention. Under three minutes.
- **D53 · DECIDED · R7** Controller mapping: HIT RATE (asteroids blasted ÷ spawned) drives simultaneous asteroid count and spawn density; rolling WPM drives word-length mix; per-word recognition budget (D19) drives individual fall time. One knob per stage. Band 80–90%, center 85 (Wilson et al.); above 90 tighten, below 80 loosen.
- **Terminology fix:** "hit rate" (balloon-era term) is replaced by "hit rate" everywhere.

### Menus, settings, persistence
- **D39 · DECIDED · R5** Full menu system; must feel like a complete, shipped experience.
- **D40 · DECIDED · R6** Flow: Title → Profile pick → Director map → Briefing → Play → Warp break → Results → back to map. Plus a Beacon Log (collection screen of all beacons with coordinates).
- **D41 · DECIDED · R6** Settings: music volume, SFX volume, keyboard layout (QWERTY/AZERTY/QWERTZ/Dvorak), UI language, letter case (lowercase default), increased letter spacing (Zorzi et al. 2012), reduced motion / screen-shake off, colorblind-safe palette, reset progress. Excluded: manual difficulty, dyslexia font toggle.
- **D42 · SUPERSEDED · R6** English + Spanish content, Hindi UI only. Replaced by D45.
- **D45 · DECIDED · R6** All three languages (English, Spanish, Hindi) for all three markets (US, LatAm, India), for both UI and typed content. UI language and content language are chosen independently. Content language is only offered if the selected keyboard/input method can type it.
- **D46 · DECIDED · R7** Hindi typed content uses romanized transliteration by default (type `ghar` to match घर; matches how most Indian kids actually type), with native Devanagari InScript as an option. IME composition events handled explicitly so auto-lock (D24) works.
- **D43 · DECIDED · R6** Profiles, not accounts: name + avatar, no email, no PII, local storage. Varsity Tutors sign-in documented as the production hook. Leaderboards: personal-best per stop, plus opt-in relative board (you and nearest players, never global rank). Grounded in COPPA and Hanus & Fox 2015 / Bai et al. 2021.
- **D44 · DECIDED · R4 (implied by R6)** Per-word history and map progress persist locally so the learning engine has memory across sessions.

---

## Collisions (unresolved until user picks)

- **C09 · Voice source.** D63 (ElevenLabs pre-rendered voice) vs user: use system voice, it's free. **Status: resolved, D88 supersedes the voice portion of D63.** Ambient beds and procedural SFX in D63 unchanged.

- **C07 · Ship name.** Story v1 fixes the ship as the *Lantern*; D72 lets the player name the ship. Options: (a) player names ship, default "Lantern", story uses `{shipName}`; (b) Lantern stays fixed, player names a callsign instead. **Status: resolved, (a). Story v2 uses `{shipName}`, default "Lantern".**
- **C08 · Skins vs D08.** D08 "no swappable skins" referred to world themes, not ship cosmetics. D73 ship skins do not collide. **Status: resolved by clarification.**

- **C06 · Audio source.** D49 says procedural SFX + composed music file. User introduced ElevenLabs. Proposed resolution: ElevenLabs for Shadow' voice lines (pre-flight, coach notes) and ambient beds where synthesis is thin; procedural stays for reactive SFX that vary with gameplay (blast pitch vs combo). ElevenLabs key lives in the serverless layer with the Anthropic key (D47). **Status: resolved, D63.**

- **C05 · Route.** D12 said Mercury→Pluto; user's intent was Earth→Pluto. Claude inferred Mercury from "entire solar system" without confirming. **Status: resolved, D56 supersedes.** Any "nine stops / seven chapters" references elsewhere in the log are void; the count is seven.

- **C01 · Weapons.** Earlier brief said "no weapons, nothing gets destroyed." R3 decided a phase blaster on asteroids. Resolution offered: blasting non-living rocks is inside Nerdy's own norms (Math Nova, Holo-Math, Type Storm). **Status: resolved in favor of blaster, D04.** Logged for the record.
- **C02 · Accounts.** R5 recommendation said no accounts. User disagreed ("a game should have accounts and leaderboards"). R6 recommendation is profiles + two leaderboard types (D43). **Status: resolved, profiles + two leaderboard types (D43).**
- **C03 · Fall speed.** R3 said "bigger falls slower, fall speed pinned to size and never touched." R4 replaced that with computed per-player fall time (D19). **Status: resolved, D19 supersedes.** The R3 statement is void.
- **C04 · Scope language.** User flags words like "honest" as scope-slimming signals. Clarified in R6: "honest" meant type-checked, not trimmed. **Status: resolved.** Standing rule: no recommendation is allowed to be a scope reduction unless labeled as one.

---

## Open items

- D88: coach-note voice source once ElevenLabs is wired (system voice lean).


- Deployment is run from the user's machine via Vercel CLI (Claude Code); this container cannot reach Vercel. Steps go in the PRD.

- Presentation of progress data to grades 2–5: no confirmed source yet on whether per-word "faster than before" markers help young kids or add noise. Logged as unverified; D50 ships them pending playtest.

- ~~Type Storm timing~~ RESOLVED: read directly from the game bundle (see Type Storm reference below).
- Which exact sentence per stage becomes the warp line (decided in story batch, D16).
- Exact calibration-wave design (D18).
- Controller signal → knob mapping in detail (D20): CONFIRMED (D53).

---

## Type Storm reference (read from its shipped bundle, Sep 15 2026)

Their loop, so we can mirror the proven structure and improve on it.
- **Shield:** 3. Third breach ends the run. Breach = drone reaches 80% of screen height.
- **Wave config** (wave index w from 0): count = min(8 + 2w, 22); speed multiplier = 1 + 0.12w (uncapped); spawn interval = max(0.9, 2.4 − 0.14w) s, jittered ×0.75–1.25. Every 4th wave (w = 3, 7, 11…) is a Storm Titan boss.
- **Fall speed:** vy = (26 + rand·14) px/s × speed multiplier. On a ~790px-tall viewport, wave 1 drones take ~16–25 s to breach; by wave 5 (speed 1.6) ~10–15 s.
- **Estimated wave lengths:** wave 1 ≈ 20–35 s (8 drones spawning over ~19 s), wave 2 ≈ 25–40 s (10), wave 3 ≈ 25–40 s (12), boss ≈ 10–20 s. Three waves + boss ≈ 1.5–2.5 min.
- **Word tiers:** waves 0–1 Home Row (as, ask, dad, fall, flask…), 2–3 Short Words (and, art, box, cat…), 4–5 Everyday (apple, brave, cloud…), 6+ Power Words (adventure, brilliant, challenge…). Pool = all tiers up to current, current tier weighted 3×. Consecutive picks never share a first letter.
- **Boss sentence:** picked at random from five pangrams unrelated to the waves: "the quick brown fox…", "pack my box with five dozen liquor jugs", "how vexingly quick daft zebras jump", "sphinx of black quartz judge my vow", "the five boxing wizards jump quickly". This confirms the original critique (sentence disconnected from the words typed) and, notably, ships the word "liquor" to grades 3–12 — the exact guardrail example in D34.
- **Scoring:** word = length × 20 × combo (combo capped ×10); boss = 250 × √(sentence length) × combo. WPM = chars/5 ÷ minutes. Accuracy = hits ÷ (hits + typos).
- **Speed is a single global knob, no per-player adaptation.** Our D19/D53 replace this.

## Sources cited so far

- Wilson, Shenhav, Straccia & Cohen (2019). The Eighty Five Percent Rule for optimal learning. *Nat Commun* 10:4646. https://www.nature.com/articles/s41467-019-12552-4
- Roediger & Karpicke (2006). Test-enhanced learning. *Psychol Sci* 17(3). https://doi.org/10.1111/j.1467-9280.2006.01693.x
- Cepeda et al. (2006). Distributed practice in verbal recall tasks. *Psychol Bull* 132(3). https://augmentingcognition.com/assets/Cepeda2006.pdf
- Bjork (1994). Memory and metamemory considerations in the training of human beings. https://gwern.net/doc/psychology/spaced-repetition/1994-bjork.pdf
- Bjork & Bjork (2011). Making things hard on yourself, but in a good way. https://burrell.edu/wp-content/uploads/2020/09/EBjorkRBjork_FABBSchapter2014-2nd-ed._WithCoverPage.pdf
- LaBerge & Samuels (1974). Toward a theory of automatic information processing in reading. *Cogn Psychol* 6. https://www.sciencedirect.com/science/article/abs/pii/0010028574900152
- Hanus & Fox (2015). Assessing the effects of gamification in the classroom. *Comput Educ* 80. https://doi.org/10.1016/j.compedu.2014.08.019
- Bai, Hew, Sailer & Jia (2021). From top to bottom: leaderboard positions. *Comput Educ* 173. https://doi.org/10.1016/j.compedu.2021.104297
- FTC COPPA rule. https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa
- Cited from memory, links pending: Csikszentmihalyi (1990) *Flow*; Ryan, Rigby & Przybylski (2006) *Motivation and Emotion*; Hattie & Timperley (2007) *Rev Educ Res*; Juul (2013) *The Art of Failure*; Deci, Koestner & Ryan (1999) *Psychol Bull*; Ehri (2014) *Sci Stud Reading*; Sweller (1988) *Cogn Sci*; Zorzi et al. (2012) *PNAS*; NASA SEXTANT pulsar navigation.
