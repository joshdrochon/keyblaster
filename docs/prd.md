# KEYBLASTER — Product Requirements Document v1

**Source of truth for decisions:** `decision-log.md` (D-ids cited throughout). This PRD decomposes each decision into acceptance criteria (AC) and tests (T) per the granularity rule (D61). An AC without a T is a spec bug.
**Companion:** `architecture.md` (how it's built, Quality System, gauntlet loop).
**Deadline:** Submissions close Fri Sep 18 2026, 11:59 PM CDT.

Test ID prefixes: `U` unit (Vitest), `E` end-to-end (Playwright), `V` visual evidence (screenshot + criterion), `P` performance (measured), `M` manual playtest (only where no automated check is possible; must be minimized).

---

## 1. Summary

KeyBlaster is a 2D high-fidelity vertical scroller for grades 2–5 in which the player pilots the *Lantern* from Earth to Pluto, blasting word-asteroids by typing them and placing a beacon at each stop. A per-player learning engine keeps success near 85%. Submitted to the Nerdy AI Hackathon as an own-idea entry (D02).

**Primary outcome:** typing WPM and accuracy. **Side effects, measured:** reading fluency (recognition latency) and vocabulary retention (D02, D03).

## 2. Non-goals

- Touch typing / finger placement instruction (D03).
- Mobile or touch input (D37).
- Real accounts with PII, or global leaderboards (D43).
- Runtime LLM in the game loop (D32).
- Any Nerdy game as a visual reference (D58, D59).

---

## 3. Functional requirements

### 3.1 Core loop — Flight (D04, D24, D25, D26, D27, D28, D29)

**FR-1 Scroll and ship.** The Lantern is fixed at bottom-center; the world scrolls top-to-bottom.
- AC-1.1 Ship x/y do not change during a stage except for shake offsets. → U: ship position invariant across 600 simulated frames.
- AC-1.2 Background layers advance every frame at their configured speeds. → U: each layer's y advances by speed×dt; V: five distinct layer speeds visible with layer-debug overlay.

**FR-2 Asteroids.** Each carries exactly one word from the stage pool (or an interleaved retention word, §3.2).
- AC-2.1 No two live asteroids share a first letter unless the shared-prefix tier is unlocked (D25). → U: spawn 10,000 asteroids across randomized states; assert invariant.
- AC-2.2 When the tier is unlocked, live asteroids may share a prefix; the lock resolves on the first keystroke that makes the typed prefix unique. → U: "flow"/"flower" both live; typing "f","l","o","w" leaves both candidates; "e" locks "flower".
- AC-2.3 Asteroid sprite size is a monotonic function of word length (D19). → U: size(len) is non-decreasing; V: 3-letter vs 9-letter screenshot.

**FR-3 Input and lock.** Auto-lock on first unique keystroke, no Enter (D24).
- AC-3.1 First keystroke matching a live word's first letter locks that asteroid. → U.
- AC-3.2 A wrong keystroke while locked triggers shake, increments typo count, does not drop the lock. → U (state) + V (shake).
- AC-3.3 No switching: keystrokes matching other asteroids are ignored while locked. → U.
- AC-3.4 Completing the word fires the blast, marks asteroid dead, increments hits, advances combo. → U.
- AC-3.5 Keystrokes are handled via `keydown`, ignoring modifier combos; IME composition events are handled for Devanagari input (D46). → U with synthetic composition events.

**FR-4 Hull.** Three hits per stage, reset at stage start (D27, D29).
- AC-4.1 hull == 3 at every stage start. → U.
- AC-4.2 An asteroid crossing the breach line decrements hull by exactly 1 and plays strike (shake + spark, no explosion, no red) (D28). → U (state), V (screenshot at strike frame: no full-screen red flash; ship sprite = "dinged" variant).
- AC-4.3 hull == 0 → stall → mission fail → restart from stage start; per-word history is retained. → U + E.
- AC-4.4 Hits feed the stage star rating: 0 hits = 3★, 1 = 2★, 2 = 1★ (D27). → U.

**FR-5 Shield canister.** An asteroid variant carrying a story word; blasting it restores 1 hull (max 3) (D26).
- AC-5.1 Spawns only when hull < 3; at most one live at a time; its word is from the stage pool. → U.
- AC-5.2 Blasting it increments hull by 1, capped at 3. → U.

**FR-6 Stage end.** A stage ends when its spawn queue is empty and no asteroids are live. → U.

### 3.1b Feel, reward, and progression (D72–D75, D77)

**FR-6b Ship and pilot.** Profile screen: pilot name + avatar, ship choice, ship name.
- AC-6b.1 Ship name is stored on profile and substituted into story text via `{shipName}`, default "Lantern" (C07 resolved). → U.

**FR-6c Combo, multiplier, tone (D75).**
- AC-6c.1 Score multiplier = min(combo, 10); combo resets on typo or hull hit; HUD shows "×N". → U.
- AC-6c.2 Keystroke tone steps up a fixed scale (e.g., pentatonic) per successful keystroke, resets on typo; pitch index is a pure function of consecutive-correct count. → U + audio graph assertion.

**FR-6d Skins and trophies (D73, D74).**
- AC-6d.1 Skins unlock only from mastery milestones defined in config; no time/purchase path exists. → U.
- AC-6d.1b Ships/skins per D79: 4 ships (unlock at 1/3/5/7 beacons), 1 skin each (unlock: first 3★ stop, 25-combo, 50-combo, 100% retention set). → U.
- AC-6d.1c Trophies per D80: First Light (Earth lit), Pathfinder (first beacon), Belt Runner (main-belt stage 0 hits), Ring Weaver (Saturn 3★), Chain 25, Chain 50, Sharp Eye (first shared-prefix stage cleared), Steady Hull (3 consecutive 0-hit stages), Long Memory (100% retention set), Map Maker (all seven), Dark Side (Uranus 3★), Last Light (Pluto beacon). → U (each awarded exactly once).
- AC-6d.2 Trophy definitions are config; each is awarded exactly once per profile; Beacon Log renders them. → U + E.

**FR-6e Core loop qualities (D77).**
- AC-6e.1 Input-to-visual latency ≤ 16.7 ms measured keydown→render. → P.
- AC-6e.2 Every keystroke event emits ≥ 1 visual and ≥ 1 audio response. → U.
- AC-6e.3 During flight, no interval > 2 s with zero live asteroids and no pending spawn. → U (simulation).
- AC-6e.4 Retention line trends upward across a full Earth→Pluto run for a simulated learner. → U (simulation).
- AC-6e.5 Playtest targets (to set): median session ≥ N min, replay rate ≥ M%. → M.

### 3.2 Learning engine (D17, D18, D19, D21, D22, D23, D51, D53)

**FR-7 Per-player word model.** For each (profile, language, word): exposures, hits, misses, typos, median first-key latency, median inter-key interval, last-seen timestamp, ease.
- AC-7.1 Every blast/miss/typo updates the record deterministically. → U (snapshot tests).
- AC-7.2 Records persist across sessions (D44). → U (storage round-trip) + E (reload keeps history).

**FR-8 Fall time (D19).** `fallTime = clamp(len × keystrokeBudget + recognitionBudget(word), MIN, MAX)`.
- `keystrokeBudget = 1.5 × player median inter-key interval` (calibrated, default 350 ms).
- `recognitionBudget = BASE × ease(word)`; BASE = 1200 ms; ease ∈ [0.25, 2.0]; new word ease = 1.6; ease decreases on fast hits, increases on misses/slow hits.
- MIN 2.5 s, MAX 14 s.
- AC-8.1 Formula implemented exactly; clamps hold. → U (property tests).
- AC-8.2 A known long word can fall faster than an unknown short word. → U ("dinosaur" ease 0.3 vs "because" ease 1.8).
- AC-8.3 Fall time is never displayed as a rule; no UI element maps size to speed. → V (HUD contains no speed indicator).

**FR-9 Word selection (D21, D22).** Weights per word: unknown 3.0, weak (ease > 1.2) 2.0, learning 1.0, mastered (ease < 0.5) 0.3.
- AC-9.1 Weighted sampling without replacement within a stage; no repeats until pool exhausted. → U.
- AC-9.2 At least one guaranteed-catch word (mastered or ≤4 letters with ease ≤ 1.0) in every 6 consecutive spawns. → U over 10,000 stages.
- AC-9.3 From stage 2 on, 20% (±1) of spawns are retention words from earlier stops, spaced by the SRS rule: eligible if `now − lastSeen ≥ interval(ease)`. → U.
- AC-9.4 A missed word's next eligibility is set to "next stage" (D23). → U.

**FR-10 Controller (D53).** Rolling hit rate over the last 20 spawn outcomes.
- Above 0.90 → tighten; below 0.80 → loosen; else hold. Primary knob: max simultaneous asteroids (range 2–7). Secondary: word-length mix bias (−1/0/+1). One knob change per stage; knob choice alternates primary → secondary when primary is at its bound.
- AC-10.1 Never two knob changes in one stage. → U.
- AC-10.2 Given a simulated player with fixed true accuracy p, long-run measured hit rate converges to [0.80, 0.90] for p ∈ [0.5, 0.99]. → U (simulation, 200 stages, 50 seeds).
- AC-10.3 Difficulty never increases while hit rate < 0.85 (D18). → U.
- AC-10.4 Scroll speed of the world is constant per stage and not a knob. → U.

**FR-11 Calibration (D51).** New profile only; ~20 s pre-flight typing of high-frequency words framed as ship startup.
- AC-11.1 Produces median inter-key interval and first-key latency; stored on profile. Ritual steps: Hull check (1 short word), Systems check (3–4 short words), Engines (1 long word) (D81). → U.
- AC-11.2 Not shown on returning profiles. → E.
- AC-11.3 Feels like narrative, not a test: no score, no accuracy shown during it. → V.

### 3.2b Debris types (D71)

**FR-12b Per-stop debris.** Each belt uses scientifically correct debris; word labels sit on whatever the rock is. Sources verified Sep 15 2026.
| Stop | Debris set | Verdict | Source |
|---|---|---|---|
| Mars | rust-dusted rocky regolith chunks | TRUE (iron-oxide dust gives Mars its red color) | https://science.nasa.gov/mars/facts/ |
| Jupiter (belt en route = main asteroid belt) | C-type carbonaceous (dark, most common), S-type silicate (lighter), M-type metallic (nickel-iron, rare); plus Jupiter Trojans (dark, reddish, some water ice) | TRUE. NASA: most asteroids orbit between Mars and Jupiter; M-types are nickel-iron. Trojans per Lucy mission. | https://science.nasa.gov/solar-system/asteroids/facts/ · https://science.nasa.gov/solar-system/planets/jupiter/nasas-lucy-mission-a-journey-to-the-young-solar-system/ |
| Saturn | ring material: ice chunks (mostly water ice) coated with dust, from dust-sized grains to house-sized, a few mountain-sized | TRUE, NASA wording | https://science.nasa.gov/saturn/facts/ · https://science.nasa.gov/resource/saturns-rings-2/ |
| Uranus | narrow, very dark icy ring particles | TRUE. 13 faint rings; particles very dark. | https://science.nasa.gov/uranus/facts/ · https://www.asc-csa.gc.ca/eng/astronomy/solar-system/uranus.asp |
| Neptune | icy bodies (Kuiper-belt-like), faint dusty ring material | TRUE for rings and icy bodies; "Neptune Trojans" dropped from the art set (exist, but no clean NASA kid-level source) | https://science.nasa.gov/neptune/neptune-facts/ |
| Pluto / Kuiper Belt | ice chunks: water ice plus frozen methane and ammonia (and nitrogen on the largest bodies); small Kuiper Belt objects | TRUE. NASA: rock, water ice, plus ammonia and methane ices. | https://science.nasa.gov/solar-system/kuiper-belt/facts/ |

- AC-12b.1 Each stop's spawn config references only debris types listed for that stop. → U (config test).
- AC-12b.2 Each debris type has its own sprite set (≥ 3 shape variants) and palette entry. → U + V.
- AC-12b.3 Sources verified (above). Closed.

### 3.3 Content and story (D08, D09, D14, D34, D45, D46, D56, D57, D67)

**FR-12 Stops.** Earth (launchpad), Mars, Jupiter, Saturn, Uranus, Neptune, Pluto; content per `story-draft-v1.md`.
- AC-12.1 Earth has no belt; typing `launch` activates its beacon and advances to the Director map. → E.
- AC-12.2 Each of the six belt stops has: briefing, asteroid pool, pre-flight line, warp sentence, beacon text, in all three languages. → U (content schema validation).
- AC-12.3 Every content word in a warp sentence exists in that stage's asteroid pool. → U.

**FR-13 Allowlist (D34).** Graded list (Fry 1000 + stage pools + planet/moon proper nouns for briefings only).
- AC-13.1 Any word reaching the screen (asteroid or sentence) is in the allowlist; violations throw in dev and are dropped in prod. → U.
- AC-13.2 The blocklist (profanity, alcohol, drugs, weapons-as-violence) rejects, and the allowlist alone would already have rejected, every word on it. → U (fixture including "liquor").
- AC-13.3 AI outputs (§3.4) pass the same filter before use. → U.

**FR-14 Languages (D45, D46).** UI: en, es, hi. Content: en, es, hi. Independent selection.
- AC-14.1 Content language options are filtered by input method: Devanagari content is offered only if input is `inscript` or `translit`. → U.
- AC-14.2 Romanized transliteration matches Devanagari targets per a deterministic mapping table; ambiguous romanizations accept all listed variants. → U (table-driven).
- AC-14.3 All UI strings come from i18n files; no hard-coded English in scenes. → U (lint rule / string extraction test).

### 3.4 AI coach (D32, D33, D47)

**FR-15 One call per warp break.** Input: stage id, missed words, slow words, hit rate. Output (JSON): coach note (≤ 20 words, Shadow's voice, never "wrong"), 2 sentence variants for the next stage using only allowlisted pool words.
- AC-15.1 Timeout 1500 ms; on timeout/error/invalid JSON, fallback bundle is used and UI is identical. → U (mock all three failures) + E.
- AC-15.2 Output is validated: schema, allowlist, word count, banned-term scan. → U.
- AC-15.3 No AI call during flight; exactly one per warp break; zero on Earth. → U (call counter) + E.
- AC-15.4 Three transport paths behind one interface: serverless proxy, local mock, direct-with-dev-flag; direct path is unreachable in prod builds. → U + build test.
- AC-15.5 Demo: two scripted misses produce a coach note that names those words. → E (mock returns deterministic note; real path spot-checked M).

### 3.5 Warp break and beacons (D11, D13, D15, D30)

**FR-16 Warp sentence.** Calm break; blasted words highlighted; typos re-highlight the letter; completion charges warp.
- AC-16.1 No asteroids spawn or move during the break. → U.
- AC-16.2 Typo does not reset the sentence; the current letter re-highlights. → U.
- AC-16.3 Charge meter reaches 100% exactly on final character. → U.

**FR-17 Beacon.** Displays real heliocentric ecliptic coordinates for the play date and a pulsar-fix flavor line.
- AC-17.0 Display format: "λ 214.6°  β −1.2°  r 1.52 AU" + one pulsar-fix line (D81). → V.
- AC-17.1 Coordinates computed from Keplerian elements (JPL approximate elements, J2000) for the stop's planet on the current date; longitude in [0, 360), latitude in [−90, 90], distance in AU. → U (compare against known ephemeris values on 3 fixed dates within ±1° / ±0.05 AU).
- AC-17.2 Pluto uses the 1800–2050 element set. → U.
- AC-17.3 Beacon persists to profile and blinks on the Director map thereafter. → E.

### 3.6 Menus, profiles, persistence (D39, D40, D43, D44)

**FR-18 Flow.** Title → Profile → Director map → Briefing → Pre-flight → Flight → Warp → Beacon → Results → Map. Beacon Log and Settings from the map.
- AC-18.1 Every screen reachable and returnable via keyboard alone. → E.
- AC-18.2 Profiles: name + avatar; no email field exists anywhere. → E (DOM assertion).
- AC-18.3 Leaderboards: personal-best per stop; opt-in relative board shows the player and up to 2 above / 2 below; no global rank rendered. → U + E.
- AC-18.4 Local persistence via localStorage with versioned schema and migration; corrupted storage → fresh profile, never a crash. → U (fuzzed storage).

### 3.7 Settings (D41)

- AC-19.1 Each setting persists and takes effect without reload: music vol, SFX vol, keyboard layout (qwerty/azerty/qwertz/dvorak), UI lang, content lang, letter case, letter spacing, reduced motion, colorblind palette, reset progress. → E per setting.
- AC-19.2 Keyboard layout changes the key→char map used by the lock logic. → U.
- AC-19.3 Reduced motion disables screen shake and camera sway, keeps gameplay motion. → U + V.
- AC-19.4 No difficulty selector, no dyslexia-font toggle exists. → E.

### 3.8 Results and learning evidence (D50)

- AC-20.1 Shows WPM and accuracy for this stage and delta vs previous stage of the same profile. → U.
- AC-20.2 Per-word markers: "faster" if median first-key latency improved ≥ 15% vs prior exposure. → U.
- AC-20.3 Retention line: for retention words in this stage, % hit and mean latency delta vs first exposure. → U.
- AC-20.4 Stars per §3.1 AC-4.4. → U.

### 3.9 Audio (D62, D63, D88)

- AC-21.1 Per-planet ambient bed file exists and plays on that stop; crossfades on transition. → E (audio node graph assertion).
- AC-21.2 Music has ≥ 3 intensity layers; intensity index is a function of live asteroid count and combo. → U.
- AC-21.3 Every event (lock, keystroke, typo, blast, hit, shield, warp charge, warp, beacon, UI nav) has ≥ 3 SFX variants; consecutive plays never repeat a variant. → U.
- AC-21.4 Music ducks by ≥ 6 dB while a Shadow voice line plays. → U.
- AC-21.5 Shadow speaks via Web Speech API (system voice) with a per-platform voice preference list and fallback; no network TTS call at runtime unless `ELEVENLABS_API_KEY` is set at build time (then pre-rendered files replace system voice for scripted lines). → U (network mock asserts zero TTS calls) + build test.
- AC-21.6 Coach notes are spoken via system voice after the text renders; text remains the source of truth and the display is identical with or without speech. → E
- AC-21.7 The voice path is complete against the system-voice stand-in (D88): voice bus, ducking (AC-21.4) and spoken coach notes all work with no ElevenLabs key present, and the swap to pre-rendered files is confined to one module. → U (module boundary test) + build test..

### 3.10 Visual rubric (D60) — all V unless noted

- AC-22.1 ≥ 5 parallax layers at distinct speeds. → U (config) + V (debug overlay).
- AC-22.2 Idle frames differ: two title-screen screenshots 1 s apart have > 2% pixel difference. → E.
- AC-22.3 Stage start vs stage end background gradient differ (ΔE > 10 on sampled sky). → E.
- AC-22.4 Desaturated flight screenshot: rocket and asteroids identifiable by silhouette (checked by contour count within expected bounds). → E.
- AC-22.5 Zero `Linear` easing in tween configs. → U (grep test).
- AC-22.6 Blast, hit, warp emit distinct particle configs. → U.
- AC-22.7 Each stage palette ≤ 7 colors + 1 accent in config; screenshot dominant colors ⊆ palette ± tolerance. → U + E.
- AC-22.8 Word label contrast ratio ≥ 4.5:1 against its plate. → U.
- AC-22.9 60 fps: p95 frame time ≤ 16.7 ms over a 60 s scripted flight in headless Chromium. → P.

### 3.11 Craft and safety invariants (D31, D83, D89, D90, D91)

These decisions already have executable checks in `tests/gauntlet/rubric.mjs`; this
section is the acceptance criteria they were missing, so the trace holds (D61).

**FR-22 Nothing reads as punishment (D31, D28).**
- AC-22b.1 No red failure state, lives counter, or "wrong" label/sound exists anywhere in `src/game`. → U (static scan; gauntlet `G-nored`).
- AC-22b.2 A hull strike renders as shake + spark with no full-screen red flash (restates AC-4.2 as a rendering invariant). → V.

**FR-23 All art is vector drawn in code (D83, D84).**
- AC-23.1 No raster file is referenced from anywhere in `src/`; reference images in `design-reference/refs/` are looked at, never loaded. → U (static scan; gauntlet `G-raster`).

**FR-24 The Lantern (D89, D90).**
- AC-24.1 The beam emitter renders as engineered tech: large lens, iris aperture that opens on fire, three concentric focusing rings, finned heat housing, pivot mount that tracks the locked target. One beam source, no gun barrel. → V.
- AC-24.2 The rendered vector Lantern matches `design-reference/refs/lantern-topdown.png` in silhouette, orientation, proportion and emitter treatment, judged side by side at matched scale. → V (reference compare; gauntlet `R-lantern`).
- AC-24.3 The four colorways in that reference are the four base ships (D79); no text is drawn on the hull and `{shipName}` renders dynamically. → U + V.

**FR-25 Shadow (D91, D66).**
- AC-25.1 The rendered vector Shadow matches `design-reference/refs/shadow-sheet.png`: charcoal body, cream face rim, glowing pale-blue eyes and antenna tip, stubby arms, hover glow, round flank port. → V (reference compare; gauntlet `R-shadow`).
- AC-25.2 Six poses exist (idle, pointing, cheering, shy/worried, asleep, saluting) and the sheet's bottom-row colorways are NOT used - Shadow has one look (D91). → U (pose table) + V.
- AC-25.3 No Shadow line, scripted or generated, ever contains the word "wrong" (D31, story note 6). → U (line-table scan + coach output filter).

---

## 4. Data model (summary; full types in architecture.md)

`Profile { id, name, avatar, createdAt, calibration{ikiMs, fkLatencyMs}, settings, progress{stops[], beacons[]}, words: Record<lang, Record<word, WordRecord>> }`
`WordRecord { exposures, hits, misses, typos, fkLatencyMs[], ikiMs[], ease, lastSeen, nextEligibleStage }`
`StageBundle { stopId, lang, briefing, pool[], preflight, warpSentence, beaconText, variants[] }`

## 5. Non-functional

- NFR-1 60 fps on a 2019 laptop-class GPU (AC-22.9).
- NFR-2 Fully playable offline after first load except the coach call, which degrades silently (AC-15.1).
- NFR-3 No PII stored or transmitted (AC-18.2); no third-party analytics SDK.
- NFR-4 Keys only in serverless env; a build-time test fails if any `sk-`/API-key-shaped string appears in the client bundle.
- NFR-5 Initial load ≤ 3 s on a 10 Mbps connection (assets lazy-loaded per stop).

## 6. Story facts — verified (closed Sep 15 2026)

| Claim in story | Verdict | Primary source |
|---|---|---|
| Jupiter: "so many moons we are still counting" | TRUE. NASA lists 115 IAU-recognized moons as of Aug 2026, and notes thousands of small objects in orbit. | https://science.nasa.gov/jupiter/jupiter-moons/ |
| Saturn "would float in a bathtub" | TRUE as stated (average density 0.687 g/cm³ < water; NASA uses the bathtub line itself). | https://science.nasa.gov/saturn/facts/ |
| Saturn's moon Titan has lakes not made of water | TRUE (hydrocarbon lakes: methane/ethane). | https://science.nasa.gov/saturn/moons/titan/ (add to write-up) |
| Neptune: windiest; winds "faster than a jet plane" | TRUE. Voyager measured ~2,000 km/h near the Great Dark Spot; airliners cruise ~900 km/h. | https://science.nasa.gov/neptune/neptune-facts/ |
| Sunlight takes about four hours to reach Neptune | TRUE. NASA: 4 hours. | https://science.nasa.gov/neptune/neptune-facts/ |
| Triton orbits backward | TRUE. Only large moon in the solar system with a retrograde orbit. | https://science.nasa.gov/neptune/moons/triton/ |
| Pluto's heart is frozen nitrogen | TRUE. Tombaugh Regio / Sputnik Planitia is a nitrogen-ice glacier. | https://www.jhuapl.edu/news/news-releases/200714b-five-years-after-New-Horizons-10-things-learned-about-Pluto |
| Pluto has five moons; Charon about half its size | TRUE. NASA: five known moons; Charon ~half the size of Pluto. | https://science.nasa.gov/dwarf-planets/pluto/facts/ |
| Uranus spins on its side; seasons last years | TRUE. Tilt 97.77°; each pole gets ~21-year dark winter. | https://science.nasa.gov/uranus/facts/ |
| Uranus rings thin and dark | TRUE. 13 faint rings of very dark particles. | https://science.nasa.gov/uranus/facts/ |
| Mars: two tiny moons Phobos and Deimos; rust-red dust; ancient riverbeds | TRUE. | https://science.nasa.gov/mars/moons/ · https://science.nasa.gov/mars/facts/ |

One wording note for story v2: "Jupiter has so many moons that we are still counting" stays; do not print a number, it changes yearly.

## 7. Demo video script (D52), ≤ 3 min

0:00 Title with idle motion (rubric evidence on screen). 0:15 Profile pick. 0:25 Director map, Earth beacon blinking. 0:35 Mars briefing, launch. 0:45 Pre-flight (mention calibration). 1:00 Flight: blast several, deliberately miss "rivers" and "empty". 1:45 Warp break: type "Mars is the red planet"; Shadow's coach note names "rivers" and "empty". 2:10 Beacon placed with live coordinates; map blink. 2:25 Results: retention line, faster-than-before markers. 2:40 One line on the engine (85% band, per-word fall time). 2:55 End card.

## 8. Submission write-up outline

Real learner (grades 2–5 slow typists/readers) · real problem (typing practice that doesn't compound; Type Storm's disconnected sentence and unfiltered word list, cited) · what we built · learning-science grounding with links · the AI's exact role and why it's small · what's next.

## 9. Open items

- D76: `docs/audit.md` at end of build (roadmap final item): full sweep of PRD + architecture vs decisions, learning-science claims and citations, gauntlet evidence, coverage, collision history, guardrails/COPPA.


- Spanish/Hindi content drafts (D45) after English lock.
- Presentation of per-word markers to young kids: unverified, ships pending playtest (from log).
