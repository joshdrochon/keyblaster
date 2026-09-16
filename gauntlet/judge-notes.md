# Judge notes (architecture §10.1 step 4)

An agent opens the artifact and either calls the match or lists concrete
differences as fix tasks. A reference-compare item is NEVER auto-passed.

---

## R-lantern — round 1 — REWORK

- **Reference:** `design-reference/refs/lantern-topdown.png` (D90)
- **Render:** `gauntlet/evidence/lantern-render.png`
- **Verdict:** does not match. Four colorways are present and the palette is
  right; the silhouette is wrong.

**The one-line gap:** the reference reads as a *friendly rounded rocket with an
instrument at its nose*; the render reads as a *torpedo with an oversized lamp
bolted on*. D89 is explicit that the ship must read as a rocket.

| # | Difference | Fix |
|---|---|---|
| 1 | **No nosecone.** The emitter housing sits straight on the fuselage, so the shoulder the reference shows above the stripe is gone entirely. This is the single biggest cause of the torpedo read. | Restore a rounded nosecone/shoulder above the top stripe; the emitter mounts *on* it, not *instead of* it. |
| 2 | **Emitter is ~2x oversized.** Reference emitter is roughly 15% of ship height; render is ~30%, and near-black rather than gunmetal, so it dominates the silhouette. | Scale to ~15%, lighten to mid-grey with warm highlights. |
| 3 | **Fuselage is too straight-sided.** Reference is a capsule/egg — fullest at the porthole, gently tapering. Render is a near-constant-width tube. | Widen the belly, soften the taper. art-direction §4's language is "rounded, chunky, friendly". |
| 4 | **Stripe livery differs.** Reference: one thick band with a thin band at the shoulder. Render: two separated bands floating mid-body. | Match the reference banding. |
| 5 | **Fins attach too low and are too pointed.** Reference fins are broad, softly curved, attached around porthole height, with a rounded outer edge. | Raise the attachment, broaden, round the outer edge. |
| 6 | **Three concentric focusing rings not distinct** (D89 names them explicitly). Render shows a bezel and a lens. | Draw three visible concentric rings. |
| 7 | **Iris aperture not evident.** D89 requires an iris that opens on fire. | Implement as a drawable state so the blast can animate it. |
| 8 | Nozzle reads as a flat grille; reference is a compact ribbed cylinder tucked between the fins. | Narrow and deepen it. |

Items 1-3 carry the silhouette. Fix those first and re-render before touching 6-8.

Attempt 1 of 8.

---

## R-lantern — round 2 — REWORK (close)

- **Render:** `gauntlet/evidence/lantern-render.png` (transparent, as asked)
- **Verdict:** the silhouette problem is fixed. Two proportions are now
  overcorrected in the opposite direction.

**Fixed from round 1, all confirmed by eye:** the nosecone shoulder is back and
the collar mounts onto it; the fuselage is a proper capsule, fullest at the
porthole; the emitter is gunmetal rather than near-black; the livery is a thin
shoulder band plus one thick band; the nozzle is a compact ribbed cylinder; the
three focusing rings now read as three; the background is transparent. It reads
as a rocket now, which was the whole of round 1.

| # | Difference | Target |
|---|---|---|
| 1 | **Fins overshot.** They now dominate the silhouette and read as wings. Measured tip-to-tip span is ~2.1x fuselage width; the reference is ~1.6x. They also attach a little high, so the body looks short. | Bring span to ~1.6x fuselage width; drop the attachment slightly so the tips finish level with the nozzle, as the reference does. |
| 2 | **Emitter undershot, and detached.** Round 1 was 2x too big; this is about 15% too small and, more noticeably, floats above the hull on a thin stalk. In the reference the head sits close on a short neck and reads as part of the ship. | Lens outer ring to ~0.44x fuselage width (round 2 measures ~0.39x). Close the neck gap to roughly one lens radius. |
| 3 | The side yoke arms cradling the lens head read as thin clutter rather than a mount. | Thicken them into a visible U-shaped cradle as in the reference. |
| 4 | Exhaust is a thin dart; the reference is a tapering cone with a brighter core. | Minor. Widen and add the core. |

Items 1 and 2 are single numbers. Nothing structural remains.

Attempt 2 of 8.

---

## R-shadow — round 1 — REWORK

- **Reference:** `design-reference/refs/shadow-sheet.png` (D91)
- **Render:** `gauntlet/evidence/shadow-render.png`
- **Verdict:** recognisably Shadow, and the construction is right. The face is
  underweight, and the face is the character.

**Right already, keep it:** round charcoal body, cream face rim, dark plate with
pale-blue eyes, antenna with a glowing tip, side ear pods, stubby arms, round
flank port, hover glow, and all six poses present (idle, pointing, cheering,
worried, asleep, saluting). Bottom-row colourways correctly NOT used - Shadow
has one look, per D91.

| # | Difference | Fix |
|---|---|---|
| 1 | **Eyes too small.** The reference eyes are large rounded pills that fill most of the plate; they carry the whole expression. Combined eye width is ~55-60% of plate width in the reference, ~45% here, and the shape is narrower. | Enlarge and round them. This is the highest-value single change on the sheet. |
| 2 | **Face plate too narrow.** The reference plate is a rounded rectangle spanning most of the head width inside its cream rim; here there is too much dark body around it, which shrinks the face further. | Widen the plate toward the rim. |
| 3 | **Body reads flat.** The reference is a lighter charcoal with a clear highlight on the upper body, giving soft roundness. Here it is near-black and flat, so the silhouette loses its volume. | Lift the base value and add the upper highlight. |
| 4 | Arms are thin and hug the body; reference arms are chunkier and angle slightly outward. | Thicken, angle out. |
| 5 | Ear pods are small nubs; reference pods are larger with a visible blue ring. | Enlarge, add the ring. |
| 6 | Evidence quality: the six poses render very small, and the sheet is on a blue field. | Render the poses larger and on transparent, as the Lantern lane now does. |

Items 1-3 are the character. Do those and re-render before the rest.

Attempt 1 of 8.

---

## R-lantern — round 3 — PASS

- **Render:** `gauntlet/evidence/lantern-render.png` (165,037 bytes, transparent)
- **Verdict:** matches the reference. Recorded in `gauntlet/judge-verdicts.json`,
  bound to the render's byte size so a re-render invalidates it.

The lane stopped guessing and built a harness that decodes both PNGs and
measures ship 1 in each. Every ratio is to fuselage width at the porthole row:

| Measure | Reference | Round 2 | Round 3 |
|---|---|---|---|
| Fin span | 1.57x | 1.66x | **1.57x** |
| Fin-widest row (% ship height) | 72% | 76% | **70%** |
| Head assembly width | 0.565x | 0.492x | **0.570x** |
| Neck width below lens | 0.542x | 0.484x | **0.547x** |
| Lens bottom to hull top | 0.75 radii | 0.94 | **0.77** |

Silhouette, nosecone, capsule profile, livery, gunmetal emitter, three focusing
rings, nozzle and fin star all match. D89 satisfied: the emitter reads as
engineered tech - lens, iris, three rings, finned housing, pivot mount - and not
as a headlight, with no gun barrel anywhere.

**Residual, logged as a follow-up rather than a blocker:** the exhaust flame is
a sharp hollow chevron where the reference is a solid, soft-edged tapering cone.
It is a small change in one function and does not touch the ship silhouette this
item exists to check, so it should not hold the item at FAIL for a fourth round.

Passed at attempt 3 of 8.

---

## R-shadow — round 2 — PASS

- **Render:** `gauntlet/evidence/shadow-render.png` (transparent, larger scale)
- **Verdict:** matches. Recorded in `gauntlet/judge-verdicts.json`, bound to the
  render's byte size.

All three round-1 findings are closed, and they were the right three:

| Round 1 finding | Round 2 |
|---|---|
| Eyes ~45% of plate width, too narrow | Large rounded pills filling the plate, as the reference |
| Plate too small inside the cream rim | Spans most of the head width |
| Body flat near-black, no volume | Lifted charcoal with a rim highlight |

Also improved without being asked: arms chunkier and angled out, ear pods
enlarged with their blue ring, and raised arms now draw IN FRONT of the body so
the pointing and cheering gestures actually read.

Six poses present and correct - idle, pointing, cheering, worried, asleep,
saluting - and the sheet's bottom-row colourways remain unused, so Shadow has
one look per D91.

**Residual, logged not corrected:** the ear pods and flank port read a little
hotter in cyan than the reference, which is more muted there. At game size
Shadow is small on screen and the extra saturation arguably helps him read, so
this is a defensible departure rather than a miss.

Passed at attempt 2 of 8.
