# Design Brief — Working title: *Fuel Words*

**Submission:** Nerdy AI Hackathon, Prompt 03 (English Reading Game). Deadline Sept 18.
**Format:** Single-page web app, desktop keyboard, landscape.
**Ask for Claude Design:** Explore the look, feel, and layout of the three core screens below. We want mockups and a visual direction, not code.

---

## The one-line pitch

A reading-fluency game for grades 2–5 where you keep a rocket flying by typing the words from its mission story. Every word you type is fuel. The story you're flying through is the story you're learning to read.

## The learner and the problem

Kids in grades 2–5 who can decode words but read slowly and effortfully. The goal is automaticity: recognizing story words fast enough that reading feels easy. Typing is the input, not the subject. WPM is shown, but reading fluency is what we're actually building.

## The core loop (what the screen is doing)

- The rocket sits fixed near the bottom-center of the screen. The world scrolls top to bottom past it; the scroll is the illusion of flight.
- Fuel canisters drift down the screen, each labeled with one word from the current mission's story.
- The player types a word. On the first correct keystroke the matching canister locks on (no clicking, no Enter). Finishing the word pulls the canister into the rocket and tops up the fuel gauge.
- The fuel gauge drains continuously. Catching canisters refills it. Missed canisters just scroll off the bottom.
- Empty gauge → the rocket sputters and sinks toward the bottom edge. Any catch relights it. Only several seconds of nothing ends the run. Failure is rare and clearly earned.
- **Stage finish:** once enough canisters are caught, the mission line appears — a real sentence from the story, built from the very words the player just typed. Typing it triggers stage separation and a boost into the next chapter. This is the reward moment.

## The invisible learning engine (design should not surface this)

- Difficulty targets roughly 85% catch success, tuned by fuel drain rate and canister density — never by making words scroll unreadably fast.
- Words the player is slow on appear faster (fluency pressure). Words the player has missed appear more often (mastery pressure). Mastered words become rare combo fodder.
- Every wave includes at least one easy, guaranteed-catch word so a struggling player always has something to grab.
- Misses never cost story progress; a missed word just comes back sooner.

**Design implication:** the player should feel like the best pilot in the world even when the engine is quietly working hard for them. A miss should read as "so close!" not "you're bad at this." No red X's, no lives counter, no "wrong" sounds.

## The three screens to design

### 1. Mission briefing (pre-flight)
A short story page (3–5 sentences, big friendly type) that the player reads before launch. This is the chapter they're about to fly through. The canister words come from it. Should feel like a picture-book page inside a cockpit, not a worksheet.

### 2. Flight (the main loop)
- Fixed rocket, scrolling starfield/planet-scape behind it.
- Canisters with clear, high-contrast word labels — legibility is the whole game.
- A fuel gauge that is instantly readable at a glance (peripheral vision, the player is looking at words).
- Live WPM and a combo/streak indicator, small and celebratory, never the focus.
- Typed-letter feedback on the locked canister (letters light up as typed; a wrong letter shakes, does not drop the lock).
- Room at the bottom for the mission-line prompt when the stage completes.

### 3. Stage separation (the sentence moment)
The mission sentence appears with the caught words highlighted. The player types it. On completion: separation, boost, brief celebration, next chapter title card. This should be the most satisfying 5 seconds in the game.

## Tone and art direction

- Warm, bright, hopeful sci-fi. Think picture-book space, not gritty space. Rounded shapes, generous color, soft glow.
- Legibility over decoration everywhere words appear. Words are the gameplay.
- Motion should communicate flight and fuel, not danger. Stall = sputter and dim, not alarms and flashing red.
- Kid-safe throughout. No weapons, no enemies, nothing gets "destroyed."

## Constraints

- Desktop browser, keyboard only.
- Must be demoable in a 2–3 minute video: briefing → flight → stage separation should land in under 90 seconds of play.
- Three-day build. Prefer a small number of strong screens over a large number of average ones.

## What we'd like back from Claude Design

1. Two or three visual directions for the flight screen, pushed far enough apart to actually choose between.
2. A mockup of the stage-separation moment.
3. A mockup of the mission briefing page.
4. Notes on the fuel gauge: what shape/placement stays readable in peripheral vision while typing.

## Still open (do not resolve in design, flag if it matters)

- Exact grade band within 2–5 and vocabulary level.
- One authored story world vs. swappable themes (leaning one world, done well).
- How the AI-generated content (vocab sets, sentence variants) is surfaced, if at all.
