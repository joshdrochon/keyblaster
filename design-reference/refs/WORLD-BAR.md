# The world visual bar (D59) — Alto's Odyssey

`world-bar.png` is `alto-02_RainChasm.png`, from the official press kit at
https://altosodyssey.com/press/. Four screenshots are here; all are
REFERENCE ONLY (D84) — never loaded by the game, and `G-raster` fails the build
if anything in `src/` points at a raster file.

## Why this was missing until now

D59 named this game as the bar and nothing ever put a screenshot next to ours.
The reference-compare step iterates over files PRESENT in this folder, so an
absent reference meant an absent check — silently. The Lantern and Shadow look
right because they had references. The world did not.

## What our flight screen is missing, read off the reference

Our Mars screen is five layers at five distinct speeds with a shifting gradient
— every measurable property the rubric asks for — and it reads as flat brown
bands. These are the differences that actually make the depth:

1. **Atmospheric perspective.** Distant layers LIFT toward the sky colour and
   lose contrast, until the furthest mesas are nearly sky. Ours repeats the same
   mid-brown at every depth, so speed is the only depth cue and the eye does not
   read it as distance.
2. **Enormous value range.** Foreground silhouettes are near-black; the far
   ridge is ~90% sky value. Ours spans maybe three steps of one brown.
3. **Hue shifts with depth, not just value.** Warm dark in front, cool teal
   behind. Ours is monochrome.
4. **One light source, visibly placed.** The sun disc sits in frame and
   everything reads relative to it. art-direction §2 already says "one light
   direction per stop" — it is not being honoured.
5. **Silhouettes with character.** Angular mesas, agave plants, a temple face
   with an internal dot pattern. Ours are rounded blobs of one shape language
   repeated at three sizes.
6. **A genuinely dark, detailed foreground** that frames the scene. Ours has a
   bottom band in the same value as the middle.
7. **Sparse, high-contrast accents.** A bird, a flag, balloons, a few drifting
   diamonds. Tiny, few, and they carry enormous life.
8. **A unifying atmosphere pass.** Rain streaks cross every layer and tie the
   image together. Ours has no equivalent.

## How to use it

Do NOT copy the desert. Copy the SYSTEM: value range, atmospheric lift, hue
shift with depth, one light, characterful silhouettes, a dark framing
foreground, sparse accents, and one atmosphere pass per stop.

The rubric item `R-world` compares `gauntlet/evidence/flight-frame.png` against
`world-bar.png` and cannot be auto-passed — a judge has to look at both.
