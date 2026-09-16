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
