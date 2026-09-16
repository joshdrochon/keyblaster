# KEYBLASTER — Art Direction Spec v1

For the build (Claude Code). Companion to `design-brief-v2.md` (interface screens), `prd.md`, `architecture.md`. Decision IDs from `decision-log.md`.

---

## 0. The bar, stated so it can be checked

The target is Alto's Odyssey-level craft (D59) delivered as a production-grade product that would hold up in an Apple feature (D85). "Production-grade" is not a feeling; it is the visual rubric (D60), the audio rubric (D62), the core-loop qualities (D77), and the interface inventory (D78), all passing with evidence. If any check fails, the build iterates until it passes. There is no "good enough" below the rubric (D85).

## 1. Medium: everything is vector, drawn in code (D83)

No raster art ships. World, debris, the Lantern, Shadow, briefing illustrations, icons, UI ornaments: all drawn with Phaser Graphics / generated textures / SVG-to-texture at build time. Reasons: one consistent visual language, resolution independence, every asset inspectable by the gauntlet, no licensing surface, and Alto's itself is built this way (silhouettes, gradients, light, particles).

**Reference-only image model (D84).** If a key is provided (`IMAGE_API_KEY`, e.g., OpenAI Images), `scripts/reference-images` may generate reference pictures for Shadow and the Lantern into `design-reference/refs/`. These are looked at while drawing vectors and are never loaded by the game; a build test fails if any raster file is referenced from `src/`. Without a key, the script is skipped and nothing changes.

## 2. World construction (per stop)

Every stop's Flight scene is assembled from the same layer stack, parameterized by that stop's palette and debris set:

| Layer (back→front) | Content | Scroll speed (× world) | Notes |
|---|---|---|---|
| L0 Sky | Vertical gradient, 3–4 stops, shifts across the stage (rubric 3) | 0.00 | Hue and value interpolate from `skyStart` to `skyEnd` over stage duration |
| L1 Celestial | Sun/planet disc with soft radial glow; distant stars/moons | 0.05 | The planet of the stop is large and partially framed |
| L2 Far field | Distant silhouette band (horizon, cloud deck, ring plane) | 0.15 | Silhouette only, one flat color from palette |
| L3 Mid field | Second silhouette band; drifting dust/cloud shapes | 0.35 | Continuous drift even when not scrolling (rubric 2) |
| L4 Debris | The asteroids/ice chunks with word plates | 1.00 | Fall speed per D19; size per word length |
| L5 Near field | Foreground particles (dust motes, ice glints) | 1.30 | Sparse, blurred by size not filter |
| L6 Ship & FX | The Lantern, blaster beam, blast particles, strike spark | 1.00 | Ship fixed; camera micro-sway ±2 px on a 6 s sine (off when reduced-motion) |
| L7 HUD | WPM, ×multiplier, combo, hull marks | 0 | Own contrast plate, never over debris |

Minimum five layers with distinct speeds is a hard check (rubric 1). Idle motion on L3 and L5 is a hard check (rubric 2).

**Light.** One light direction per stop (the sun/planet in L1). All silhouettes take a subtle rim highlight on the lit side (a second offset shape, 1 px, 10–15% lighter). Long shadows are not drawn; depth comes from value steps between layers, darker toward the camera on bright stops and lighter toward the camera on dark stops.

## 3. Palettes (starting values; promote to `content/palettes.json`)

Five to seven colors + one accent per stop (rubric 7). Grounded in the real planet's look. These are first-pass hex values; tune in-engine, keep the count.

- **Earth (launchpad, night):** navy #0B1B3A, deep blue #12315E, atmosphere blue #3C7BD9, city-light warm #F5D58A, cloud white #E8EEF7, ground #08111F. Accent: beacon gold #FFC857.
- **Mars:** butterscotch sky #F1C79A, dusk peach #E9A46E, rust #B5522A, deep rust #7A2E17, dust tan #D9A776, shadow brown #4A1F12. Accent: coral #FF6B4A.
- **Jupiter:** cream band #F3E3C3, tan band #D9B58A, orange band #C97B3F, brown band #8A4B2B, storm red #B33A2E, deep #4A2418. Accent: pale gold #FFE29A.
- **Saturn:** pale gold sky #EFD9A8, ring ivory #F6EEDC, ring shadow #C9B48C, ice white #FFFFFF, warm gray #A99C86, deep umber #3E3226. Accent: ice blue #9FD8F0.
- **Uranus:** pale cyan #BFE7EE, cyan #7ECBD8, teal #3E9DAF, deep teal #1F5E6B, ring charcoal #2A2F33, near-black #0F1416. Accent: mint #C8FFE8.
- **Neptune:** cobalt #1E3FA3, deep blue #122A6E, storm indigo #0B173F, wind white #DDE7FF, mid blue #3B63C8, abyss #060C22. Accent: electric blue #6FA8FF.
- **Pluto / Kuiper:** frost white #F2F4F8, pale lilac #D6D3EA, heart cream #F5E6D0, cold gray #9A9BB0, shadow slate #4A4C63, void #14151F. Accent: nitrogen pink #FFB3C7.

Colorblind-safe variants (D41): each palette gets a variant where the accent and the debris fill are separated by luminance ≥ 40% and hue is not the only signal; word-plate contrast is unchanged.

## 4. Debris (per stop, D71 table)

Shape language: rounded, chunky, friendly; no sharp spikes. Each debris type has ≥ 3 silhouette variants and a subtle 2-tone fill (base + one darker crater/facet shape).

- Mars: rounded rock, rust base, darker craters.
- Main belt / Jupiter: C-type (dark charcoal, matte), S-type (warm gray with lighter facets), M-type (rare, cool gray with a specular fleck).
- Saturn: ice chunks, white with ice-blue facets, faint inner glow; dust grains as particles.
- Uranus: dark icy shards, charcoal with mint rim.
- Neptune: icy bodies, deep blue with white rim.
- Pluto/Kuiper: frost-white ice with lilac facets; nitrogen-pink accent glint on the largest.

Size = word length (D19): 3 letters ≈ 56 px, +8 px per letter, max ≈ 140 px at 1080p. The word plate hangs below the rock, never over it.

## 5. The Lantern (ship)

Rocket silhouette: pointed nosecone, rounded cream fuselage, coral stripe band, three swept tail fins, engine nozzle with soft exhaust glow, a single large porthole. At the nose, the beam emitter (D89): an engineered lantern head with a large lens, an iris aperture that opens on fire, three concentric focusing rings, a finned heat housing, and a pivot mount that tracks the locked target. The beam always originates here. The dual-cannons tier (D25) swaps in a twin-lens head. No text on the hull; `{shipName}` may be rendered dynamically on the flank. Idle: gentle 2 px bob on a 3 s sine, exhaust particles low and soft. Dinged state: one scorch mark per hull hit, cleared at stage end. Four ships (D79) share the silhouette family and differ in proportion and fin shape; skins change palette and one detail (porthole shape, fin trim).

**Reference (D90):** `design-reference/refs/lantern-topdown.png` is the complete Lantern reference: silhouette, orientation, proportions, emitter as drawn, and the four colorways (= four base ships). Draw the vector to match it; simplify only where required for legibility at game size.

## 6. Shadow (co-pilot, D66)

Small, round, dark-bodied robot with a glowing face plate; reads against bright cockpits and bright skies by contrast. Face is a simple two-eye display capable of: neutral, happy, surprised, thinking, proud. Six poses minimum: idle, pointing, cheering, worried, sleeping (empty Beacon Log), saluting (Pluto). Every pose is vector; expressions are eye-shape changes plus a 1–2 px face-plate glow pulse. Never says "wrong."

## 7. Typography

Google Fonts with Devanagari support (D81). Wordmark: a rounded geometric display face. Word plates and UI: a highly legible humanist sans with a Devanagari companion at matched x-height. Word plate: dark plate, light text, 4.5:1 minimum (rubric 8), typed letters light to the accent color, the next letter carries a soft underline cue.

## 8. Motion principles

- Every tween eased; the only allowed curves: `Cubic.Out` (arrive), `Back.Out` (pop), `Sine.InOut` (drift), `Expo.Out` (blast). Zero `Linear` (rubric 5).
- Blast: beam 80 ms, rock fractures into 6–10 shards on `Expo.Out`, word plate dissolves upward, +score floats 400 ms.
- Strike: 120 ms shake (amplitude 6 px, decays), one spark burst in the accent, ship scorch appears. No flash, no red (D28).
- Warp: charge meter fills per character; on completion the whole stack accelerates (L2–L5 speeds ×4 over 1.2 s), streaks in accent, cut to Beacon.
- Reduced motion (D41): shake, sway, and streaks off; fades and scale-pops kept.

## 9. Particles (rubric 6)

Three named systems with distinct signatures: `blastShards` (rock-colored, gravity, spin), `strikeSpark` (accent, radial, short), `warpStreaks` (accent, vertical, long). Ambient: `dustMotes` per stop in palette colors. All particle textures are generated at boot from vector shapes.

## 10. Interface screens

Interface layout comes from Claude Design (interface only, D82) and lives in `design-reference/ui/`. It is direction, not acceptance (D70). All UI is re-drawn in vector in the engine's language above; nothing from Claude Design's HTML is embedded.

## 11. Iteration rule (D85)

The build agent runs the gauntlet after every visual change. A rubric failure is a task, not a note: fix and re-run until green. Subjective quality is checked against this spec's named properties (layer count, drift, gradient shift, silhouette read, eased curves, palette adherence, particle signatures, contrast, frame time). A screen that passes the rubric but reads as flat, or an item failing 8 attempts, is written to `gauntlet/escalations.md` with a screenshot and a specific proposal, and the loop continues; it is never shipped silently and never marked passed.
