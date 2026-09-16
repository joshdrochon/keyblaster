# KEYBLASTER — Design Brief v2.1

**For:** Claude Design. Visual direction and screen mockups. No code.
**Supersedes:** design-brief-v1 (archived; it described a fuel mechanic and a different route).
**Source of truth:** `keyblaster/docs/decision-log.md`. Decision IDs cited as (Dxx).

---

## Scope of this pass

One project, roughly a dozen artboards. Not seven levels.
- Every screen listed below, once, dressed as **Mars** (the worked example).
- The Flight screen a second time as **Saturn** (ice-chunk ring debris, different palette) to prove the system varies without changing layout.
- Seven palette swatches, one per stop (Earth, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto).
- Shadow and the Lantern as characters, a few poses each.
- Two or three distinct visual directions for the Flight screen before committing to one.
Do not produce all seven stops in full; the engine and palettes handle that.

## One line

A kid pilots the *Lantern* from Earth to Pluto, blasting word-asteroids by typing them, and leaves a lit beacon at every stop so the ships behind can follow.

## Who it's for

Grades 2–5, desktop, keyboard only (D01, D37). They should feel like the best pilot alive even when the engine is quietly working hard for them (D31). Nothing on screen may read as punishment: no red X's, no lives counter, no "wrong" sound (D31, D28).

## The visual bar

**Alto's Odyssey** is the bar (D59). Not any existing Nerdy game (D58, D59). Concretely, the design must satisfy this rubric, which the build will be checked against with evidence (D60):

1. Depth from at least five parallax layers moving at distinct speeds.
2. Nothing is ever still: idle frames have drifting dust, cloud motion, subtle camera sway.
3. Sky and background are gradients that shift across a stage.
4. Silhouettes carry readability; desaturated, everything still reads.
5. Every motion is eased; no linear movement anywhere.
6. Blast, hit, and warp each have their own particle signature.
7. Five to seven colors per stage plus one accent.
8. Word labels sit on a contrast plate and stay crisp against any layer.
9. 60 fps, so effects must be cheap: layers, gradients, particles, not post-processing.

"2D that feels 3D" (D35): Phaser WebGL, parallax and lighting for depth, not 3D geometry.

## Tone

Warm, bright, hopeful picture-book space. Rounded shapes, soft glow, generous color. The universe is big and friendly. Asteroids are rocks, never creatures; the blaster is a light, never a gun.

## Cast

- **The Lantern** — the ship. Fixed near bottom-center of the flight screen. Small, rounded, a visible lantern-like light at its nose that is the blaster's source.
- **Shadow** — the navigation robot (D66). Dark-bodied with a glowing face so he reads against a bright cockpit. Speaks the pre-flight lines and the coach notes. Small, expressive, never in the way.
- **Debris** — carries one word each. Size shows word length (D19). Never scary. Debris is scientifically correct per stop (D71): rusty rock near Mars; carbonaceous/silicate/metallic asteroids in the main belt before Jupiter; water-ice chunks in Saturn's rings; dark icy particles at Uranus; icy bodies and faint dusty ring material at Neptune; nitrogen/methane/water ice chunks in the Kuiper Belt at Pluto. Each stop needs its own debris set with ≥ 3 shape variants.
- **Beacons** — the reward object. Placed at each stop, they blink on the map forever after (D13).

## The route

Earth (launchpad, beacon already there, one word to activate it) → Mars → Jupiter → Saturn → Uranus → Neptune → Pluto (D56, D57). Each stop is a stage with its own palette, ambient bed, and story page.

## Screens to design

### 1. Title
KeyBlaster wordmark, the Lantern idling with full parallax and motion behind it (rubric item 2 must be visible here, it's the first thing a judge sees). One primary action. Language switch visible but quiet (D45).

### 2. Profile pick
Pilot name and avatar, no email (D43). Then choose a ship and name it; default name "Lantern" (D72, C07). Ship skins (unlocked by mastery, D73) are chosen here; locked skins are visible but dim. Feels like choosing a pilot, not filling a form. Returning profiles show their furthest beacon.

### 2b. Earth — beacon activation (D57)
The launchpad. Earth's beacon already exists but is dark; Shadow asks the player to type one word (`launch`). The beacon lights, the map opens. This is the tutorial for the beacon moment and should look like a smaller version of screen 8.

### 3. Director map
Destiny-style solar map, Earth to Pluto in a line, charted stops blinking with their beacon (D13). Locked stops are dark but visible. This screen is the sense of progress; make the blink feel earned. Each charted stop also shows its star rating (D27). Entry to the personal-best board per stop lives here (D43). Entry points to the Beacon Log and Settings live here.

### 4. Briefing
The story page (3–5 sentences, big friendly type) read before flight. Picture-book page inside a cockpit, not a worksheet. Planet visible through a window. Shadow present. One button: launch.

### 5. Pre-flight
A 5–20 second narrative startup sequence with Shadow's line (D51). On a new profile this is calibration disguised as ritual. Design it as a real sequence: systems lighting up, the planet swinging into view.

### 6. Flight (the core loop)
- Fixed Lantern, scrolling world top-to-bottom, parallax layers behind (D04).
- Asteroids falling with word labels on contrast plates. Legibility is the game.
- Typed-letter feedback on the locked asteroid: letters light as typed, a wrong letter shakes the label and does not drop the lock (D24).
- Blast: a beam from the Lantern's light, asteroid breaks into particles, small combo bloom (D60 item 6).
- Hit: asteroid strikes the ship, shake and spark, ship looks dinged not broken (D28). Hull shown as three subtle marks that dim, never a red bar.
- Shield canister: an asteroid variant that carries a story word and repairs a hull mark when blasted (D26).
- Live WPM, combo count, and the score multiplier (D75), small and celebratory, off to a corner. Each successful keystroke also steps a tone up a scale; the combo readout should visibly "climb" with it.
- Later stages: two asteroids may share a first letter; the label must make the differing letter obvious (D25).

### 6b. Stall (mission fail, D29)
Hull at zero: the ship sputters, dims, and sinks toward the bottom edge over several seconds. No explosion, no red. A calm card: Shadow says one line, one button restarts the stage. The per-word history is kept, and the design should make that feel like "try again," not "you lost."

### 7. Warp break
Belt cleared, asteroids stop, everything calms. The stop's story sentence appears with the blasted words highlighted; the player types it to charge the warp drive (D30). Charging should be visible and satisfying. Shadow's coach note appears here as text with a chirp (D63); the area must look identical whether the note came from the AI or the shipped fallback (D33). This is the most important five seconds in the game.

### 8. Beacon placement
The beacon drops onto the planet and lights. It displays real coordinates (D15) and a short line of flavor text. Cut to the Director map with the new blink.

### 9. Results
WPM and accuracy vs last stage, per-word "faster than before" markers, and a retention line for words from earlier stops (D50). Stars from hull hits (D27). Personal best for this stop, and the opt-in relative board showing the player with up to two above and two below, never a global rank (D43). Informational, never a scoreboard shame moment. Replay and continue.

### 10. Beacon Log
Collection screen: every beacon placed, its coordinates, its planet. Trophies live here too (D74): mastery-based, informational, e.g., first beacon, all seven, 50-word combo, a 3★ stop. The trophy room (D40).

### 11. Settings
Music, SFX, keyboard layout, UI language, content language, letter case, letter spacing, reduced motion, colorblind palette, reset progress (D41, D45). Settings should look like ship controls, not a form. Include: colorblind-safe variants of all seven palettes; a reduced-motion variant of the Title and Flight idle (no shake, no camera sway, gameplay motion kept).

### 12. Ending card
After Pluto's beacon: the Director map zooms out, seven beacons blink in a line from Earth to Pluto, Shadow: "Every ship that comes after us will see these. You drew the map." Then Results.

### 13. Small screens and overlays (from the state-machine sweep)
- **Pause** (Esc during flight): asteroids freeze, dim overlay, Resume / Settings / Quit to map. Quit asks once.
- **Profile picker**: list of existing pilots with furthest beacon; "New pilot" leads to screen 2.
- **Beacon Log empty state**: only Earth lit, a line from Shadow about the six to come.
- **Unlock toasts**: trophy earned, skin unlocked; brief, celebratory, non-blocking, during flight or at Results.
- **Reset-progress confirm**: two-step, plain language, no red.
- **Relative-board opt-in**: one calm prompt the first time Results would show it; default off.

### 14. Transitions and states
- Every screen-to-screen transition is scored (D62), so design each one as a moment, not a cut: map → briefing, briefing → pre-flight, flight → warp, beacon → map.
- Keyboard focus states on every interactive element; the game is keyboard-only (D37).
- Corrupted-storage notice: one calm line, non-blocking (AC-18.4).
- Returning-player Title shows "Continue" with the furthest beacon.

## Screen inventory (completeness check)

Every state the game can be in, mapped to an artboard. If a state is added in code, it must be added here.

| # | State | Variants to show |
|---|---|---|
| 1 | Title | first-time; returning (Continue + furthest beacon); reduced-motion |
| 1b | Profile picker | 1 profile; several; none |
| 2 | Profile create | name/avatar; ship pick; ship name; skins (locked/unlocked) |
| 2b | Earth activation | dark beacon; lit beacon |
| 3 | Director map | Mars only unlocked; mid-run; all seven; star ratings; personal-best entry |
| 4 | Briefing | Mars; Saturn |
| 5 | Pre-flight | new profile (calibration ~20 s); returning (short ritual) |
| 6 | Flight | Mars; Saturn; shared-prefix tier active; shield canister live; hull 3/2/1; near-stall; reduced-motion; colorblind palette |
| 6b | Stall card | — |
| 7 | Warp break | typing; charged; coach note (AI and fallback look identical) |
| 8 | Beacon placement | coordinates + flavor line |
| 9 | Results | first stage (no delta); later stage (deltas, faster-than-before, retention line); stars; personal best; relative board (opted in / not) |
| 10 | Beacon Log | empty (Earth only); partial; complete; trophies |
| 11 | Settings | all controls; language switch incl. Devanagari layout |
| 12 | Ending card | — |
| 13 | Pause | flight paused; quit confirm |
| 13 | Toasts | trophy; skin |
| 13 | Reset confirm | — |
| 13 | Relative-board opt-in | — |
| 14 | Transitions | map→briefing; briefing→pre-flight; flight→warp; beacon→map |
| 14 | Notices | corrupted storage |

## Audio direction (for reference, not for design deliverables)

Disneyland-level immersion (D62): a layered ambient bed per planet, adaptive music intensity, scored screen transitions, distinct SFX with variants, Shadow's voice pre-rendered (D63). Design the screens knowing every transition will be scored.

## Languages

English, Spanish, Hindi for UI and content (D45). Design text containers for Spanish length (+25%) and Devanagari height. Word labels must accommodate Devanagari glyphs and romanized Hindi.

## What we want back

1. Two or three visual directions for the Flight screen, far enough apart to choose between, each meeting the rubric.
2. The Director map with beacons blinking.
3. The Warp break moment.
4. The Title screen with idle motion.
5. Shadow and the Lantern as characters, a few poses each.
6. A palette per planet (seven palettes, five to seven colors each plus accent).

## Do not

- Do not use Type Storm's look or any Nerdy game as reference.
- Do not add weapons that read as guns, enemies, or anything living that gets destroyed.
- Do not add difficulty selectors, lives counters, or red failure states.
- Do not resolve open decisions (see the log's Open items); flag them instead.
- Wherever the ship is named in text, use `{shipName}`; never hard-code "Lantern" in UI copy (C07).
