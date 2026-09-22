/**
 * WHAT ONE GLYPH IS ACTUALLY WIDE.
 *
 * ================== THE DEFECT THIS EXISTS TO END ==================
 * `wordPlateGeometry.cellWidthPx` used to answer that question with
 * `fontSizePx * 0.62 + letterSpacingPx` - ONE NUMBER FOR EVERY CHARACTER - and
 * `wordPlate.ts` laid its per-letter `Text` objects on that fixed grid. The
 * plate's face is proportional, so the grid was wrong for every glyph in it and
 * catastrophically wrong at both ends of the spread.
 *
 * Measured in headless Chromium at 30 px against the plate's own font stack
 * (`FlightScene.plateStyle.fontFamily`), the advance of `l` is 6.52 px and the
 * advance of `m` is 24.49 px on a cell of 19.6 px. So `ll` was drawn with 13.08
 * px of air between the two letters and `mp` was drawn with the two glyphs
 * OVERLAPPING by 1.08 px. A child reading "jump" saw `ju` spaced out and `mp`
 * fused.
 *
 * ================== WHY A MEASUREMENT AND NOT A TABLE ==================
 * The tempting fix is to ship a width table for "the font". There is no such
 * font. The plate's family is
 *
 *     'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif
 *
 * and NOTHING in this repo ships a @font-face for any of them - NFR-2 keeps the
 * game offline, so there is no webfont to bundle. Which face draws is therefore
 * decided by the machine: Segoe UI on Windows, Noto Sans on most Linux, and on
 * macOS all three names miss and the stack falls through to `system-ui`, i.e.
 * San Francisco. A table baked for one of those is silently wrong on the other
 * two, which is exactly the failure mode this lane was told not to ship. It is
 * worse for Hindi, where `ui/theme.FONT_STACK` names four Devanagari faces and
 * the winner is again whatever is installed.
 *
 * Advances are not even linear in font size on the faces that actually draw.
 * Measured on this machine, `adv(30)/30` and `adv(100)/100` differ by up to
 * 1.3e-2 em ("!"), because San Francisco carries optical size variants. So a
 * table of em ratios cannot be exact even for a face it was measured on.
 *
 * So the number comes from a MEASUREMENT of the real face, taken once per
 * (family, size, glyph) and cached - see `measureGlyphAdvances.ts` for the
 * canvas half and `boot.ts` for where it is installed. The measurement uses the
 * same `<size>px <family>` font string Phaser's `Text` builds, so the width the
 * layout reserves is by construction the width the renderer draws.
 *
 * ================== WHAT THIS COSTS: `plateSize` IS NO LONGER PURE ==========
 * Said plainly rather than buried. `wordPlateGeometry.ts` is still Phaser-free
 * and DOM-free and still loads under vitest's node environment, but `plateSize`
 * is no longer a function of its arguments alone: it reads the cache below, and
 * the cache's contents depend on whether a measurer has been installed in this
 * process. Two consequences, both deliberate:
 *
 *   1. IN NODE (unit tests, `scripts/`) no measurer is installed, so every
 *      answer comes from `SYSTEM_SANS_ADVANCE_EM` and is deterministic.
 *   2. IN THE BROWSER the real face is measured and the numbers will differ
 *      from the table by a per-machine amount.
 *
 * That difference cannot break the two guarantees that hang off `plateSize`,
 * because both are computed from `plateSize` itself at run time rather than
 * from a constant:
 *
 *   - the spawn column rule (`@engine/spawn.hasCleanColumn`) is fed plate
 *     half-widths by `FlightScene.laneSpec` / `livePlateTracks`, which call
 *     `plateSize`. Wider plates mean a wider keep-out in the same breath.
 *   - the HUD keep-out is `max(plateHalf - max(rockHalf, plateHalf), 0)`, which
 *     is 0 for ANY metrics - see `tests/unit/flight/hudKeepOut.test.ts`.
 *
 * The one thing that IS a baked constant is `ui/trophyToastLayout.WORD_PLATE_HALF_W`,
 * and it is now an explicit upper bound with a test that says so.
 *
 * ================== DEVANAGARI IS STILL WRONG, AND NOT BY THIS FILE =========
 * `wordPlate.ts` puts one `Text` per CODE POINT on the plate. A Devanagari word
 * is a sequence of grapheme clusters, so a matra rendered alone comes back as a
 * dotted-circle notdef - which is what the Devanagari rows of the table below
 * are, and they are labelled as such. Measuring makes that non-overlapping
 * instead of overlapping; it does not make it shaped. The real fix is grapheme
 * segmentation, which moves `WordPlate.letterCount` and therefore the typed
 * count `@engine/lock` drives, so it is raised in `gauntlet/escalations.md`
 * rather than smuggled into a spacing change.
 */

/** Advance widths as a fraction of the em, keyed by single glyph. */
export type GlyphAdvanceEm = Readonly<Record<string, number>>;

/**
 * Measures real glyph advances. Injected so this module stays DOM-free.
 * Returns one px advance per glyph, in order, at `fontSizePx`.
 */
export type GlyphMeasurer = (
  fontFamily: string,
  fontSizePx: number,
  glyphs: readonly string[],
) => readonly number[];

/**
 * The advance used for a glyph no measurer answered for and the table below
 * does not carry.
 *
 * It is 0.62 on purpose: that is the ratio `cellWidthPx` used for EVERY
 * character, so an unmeasured, untabulated glyph lands exactly where the old
 * code would have put it and nothing gets worse than it already was.
 */
export const FALLBACK_ADVANCE_EM = 0.62;

/**
 * THE NODE-SIDE FALLBACK. Not a description of what will draw.
 *
 * Provenance, so it can be re-derived rather than trusted: headless Chromium
 * 1.63.0, macOS 14.6, `canvas.getContext("2d").measureText(ch).width` at
 * `30px 'Atkinson Hyperlegible', 'Noto Sans', 'Segoe UI', system-ui, sans-serif`,
 * divided by 30. On that machine every named face missed and the stack resolved
 * to San Francisco, so this is SF's metrics and is labelled as such rather than
 * as "the shipped font".
 *
 * The glyph set is every code point in every word list under `src/content/`
 * (both cases) plus ASCII letters, digits and the punctuation the pools use.
 *
 * WHAT IT IS FOR: unit tests and any other node context, where there is no
 * canvas to ask. Its exact values are load-bearing for nothing except its own
 * guard - the layout rule this file supports ("pack advance boxes, add
 * `letterSpacingPx` between them") produces even spacing for ANY table, which
 * is what `tests/unit/render/wordPlateSpacing.test.ts` sweeps.
 */
export const SYSTEM_SANS_ADVANCE_EM: GlyphAdvanceEm = {
  "!": 0.27979,
  "'": 0.26709,
  ",": 0.22803,
  "-": 0.44189,
  ".": 0.22803,
  "0": 0.61963,
  "1": 0.45654,
  "2": 0.57910,
  "3": 0.60498,
  "4": 0.61768,
  "5": 0.59814,
  "6": 0.63037,
  "7": 0.56006,
  "8": 0.61279,
  "9": 0.63037,
  "?": 0.50244,
  "A": 0.64844,
  "B": 0.61768,
  "C": 0.69922,
  "D": 0.69189,
  "E": 0.56543,
  "F": 0.54102,
  "G": 0.71973,
  "H": 0.71240,
  "I": 0.23779,
  "J": 0.50830,
  "K": 0.61377,
  "L": 0.53760,
  "M": 0.84424,
  "N": 0.71240,
  "O": 0.74463,
  "P": 0.59082,
  "Q": 0.74463,
  "R": 0.61230,
  "S": 0.60645,
  "T": 0.59424,
  "U": 0.70947,
  "V": 0.64404,
  "W": 0.93701,
  "X": 0.64795,
  "Y": 0.62549,
  "Z": 0.62988,
  "a": 0.51514,
  "b": 0.56689,
  "c": 0.51416,
  "d": 0.56689,
  "e": 0.52539,
  "f": 0.31689,
  "g": 0.56201,
  "h": 0.55225,
  "i": 0.21924,
  "j": 0.21826,
  "k": 0.49854,
  "l": 0.21729,
  "m": 0.81641,
  "n": 0.54004,
  "o": 0.54395,
  "p": 0.56250,
  "q": 0.56201,
  "r": 0.32129,
  "s": 0.47852,
  "t": 0.31445,
  "u": 0.54004,
  "v": 0.49609,
  "w": 0.72852,
  "x": 0.48145,
  "y": 0.49951,
  "z": 0.48096,
  "Á": 0.64844,
  "É": 0.56543,
  "Í": 0.23779,
  "Ñ": 0.71240,
  "Ó": 0.74463,
  "Ú": 0.70947,
  "á": 0.51514,
  "é": 0.52539,
  "í": 0.21924,
  "ñ": 0.54004,
  "ó": 0.54395,
  "ú": 0.54004,
  // DEVANAGARI, AND READ THE HEADER BEFORE USING THESE. Each of these was
  // measured as a LONE code point, which is not how Devanagari is read. The
  // combining marks below (0.66 / 0.933) are the dotted-circle notdef the
  // browser draws for an isolated matra, not the mark's own advance - which is
  // zero. They are here because that is what `wordPlate.ts` currently puts on
  // the screen, and a fallback that lies in the other direction would make the
  // plate narrower than its own ink.
  "ँ": 0.66000,
  "ं": 0.66000,
  "अ": 0.72500,
  "आ": 0.99700,
  "इ": 0.53100,
  "ई": 0.53100,
  "उ": 0.47500,
  "ऊ": 0.67500,
  "ए": 0.54800,
  "ऐ": 0.54800,
  "ओ": 0.99700,
  "औ": 0.99700,
  "क": 0.77000,
  "ख": 0.79200,
  "ग": 0.55700,
  "घ": 0.63500,
  "च": 0.64400,
  "छ": 0.67800,
  "ज": 0.74100,
  "झ": 0.77300,
  "ट": 0.50300,
  "ठ": 0.57400,
  "ड": 0.54400,
  "ढ": 0.52600,
  "ण": 0.75600,
  "त": 0.55600,
  "थ": 0.64500,
  "द": 0.52300,
  "ध": 0.63200,
  "न": 0.51300,
  "प": 0.56200,
  "फ": 0.79400,
  "ब": 0.56700,
  "भ": 0.58300,
  "म": 0.57900,
  "य": 0.60900,
  "र": 0.40200,
  "ल": 0.71300,
  "व": 0.54800,
  "श": 0.71800,
  "ष": 0.57200,
  "स": 0.68000,
  "ह": 0.50700,
  "़": 0.66000,
  "ा": 0.93300,
  "ि": 0.93300,
  "ी": 0.93300,
  "ु": 0.66000,
  "ू": 0.66000,
  "ृ": 0.66000,
  "े": 0.66000,
  "ै": 0.66000,
  "ो": 0.93300,
  "ौ": 0.93300,
  "्": 0.66000,};

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

let measurer: GlyphMeasurer | null = null;

/**
 * Canonical CSS font string -> glyph -> what we know about it.
 *
 * The key is the same string the measurer sets on the canvas and the same one
 * Phaser's `TextStyle` builds, so two styles that draw identically share one
 * row and two that do not can never share one.
 *
 * The SOURCE is cached with the number rather than re-derived, because a
 * cached value cannot be told apart from a fresh one afterwards - a guard
 * asking "did this come from the font or from the table" got "measured" for a
 * table value purely because something had asked for it once already.
 */
interface CachedAdvance {
  readonly px: number;
  readonly source: AdvanceSource;
}

const measured = new Map<string, Map<string, CachedAdvance>>();

export function fontStringOf(fontFamily: string, fontSizePx: number): string {
  return `${fontSizePx}px ${fontFamily}`;
}

/**
 * Install the thing that knows how wide a glyph really is. Called ONCE, from
 * `boot.ts`, before any scene starts. Passing `null` removes it, which is what
 * a test that wants the table back does.
 */
export function installGlyphMeasurer(next: GlyphMeasurer | null): void {
  measurer = next;
  measured.clear();
}

/** Drop every measured advance. For tests; `installGlyphMeasurer` does it too. */
export function clearGlyphAdvanceCache(): void {
  measured.clear();
}

/** Where `glyphAdvancePx` got its answer. Exported so a guard can assert it. */
export type AdvanceSource = "measured" | "table" | "fallback";

/**
 * Where the answer for this glyph came from. Measures it if nothing has yet,
 * so the source and the number can never describe different lookups.
 */
export function glyphAdvanceSource(
  glyph: string,
  fontFamily: string,
  fontSizePx: number,
): AdvanceSource {
  return lookup(glyph, fontFamily, fontSizePx).source;
}

/**
 * How far the pen moves after drawing `glyph`, px.
 *
 * Measured on first ask and cached. A measurer that answers with anything that
 * is not a finite positive number is treated as no answer at all - a zero-width
 * result from a context that has not got a font yet would stack the whole word
 * on one point, and silently, which is the class of failure this file replaced.
 */
export function glyphAdvancePx(
  glyph: string,
  fontFamily: string,
  fontSizePx: number,
): number {
  return lookup(glyph, fontFamily, fontSizePx).px;
}

function lookup(glyph: string, fontFamily: string, fontSizePx: number): CachedAdvance {
  const key = fontStringOf(fontFamily, fontSizePx);
  let table = measured.get(key);
  if (table === undefined) {
    table = new Map<string, CachedAdvance>();
    measured.set(key, table);
  }
  const hit = table.get(glyph);
  if (hit !== undefined) return hit;

  let entry: CachedAdvance | null = null;
  if (measurer !== null) {
    const [raw] = measurer(fontFamily, fontSizePx, [glyph]);
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      entry = { px: raw, source: "measured" };
    }
  }
  if (entry === null) {
    const em = SYSTEM_SANS_ADVANCE_EM[glyph];
    entry =
      em === undefined
        ? { px: FALLBACK_ADVANCE_EM * fontSizePx, source: "fallback" }
        : { px: em * fontSizePx, source: "table" };
  }
  table.set(glyph, entry);
  return entry;
}
