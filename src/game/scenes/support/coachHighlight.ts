/**
 * THE WORDS SHADOW NAMES (UR-24).
 *
 * ================== WHAT WAS REPORTED ==================
 * UR-24, raised against a Shadow line of the form
 *
 *   You had that one. Keep an eye on "solid" and "rock".
 *
 * asked for the two named words to be drawn in a colour that stands out from
 * the rest of the sentence. That is right, and it is more than taste: those
 * two words are the ones the child is about to meet again on the next belt, so
 * making them findable in the sentence is a LEARNING affordance rather than a
 * decoration. In a flat line they are carried by two straight quotes and
 * nothing else.
 *
 * ================== WHY THE QUOTES STAY ==================
 * That was the judgement call, and it went the other way from "colour replaces
 * quotes". D41 is explicit that colour is never allowed to be the only carrier
 * of a distinction, and the whole colourblind palette exists because of it. The
 * quotes are the non-colour encoding: keep them, and the word is marked twice,
 * which is the rule every other state in this game follows (the hull, the
 * trophies, the switch that says "on" beside its lamp). Belt and braces is the
 * house style, on purpose.
 *
 * ================== WHY THIS MODULE IS PURE ==================
 * Finding the spans is string arithmetic and mapping them onto a wrapped
 * paragraph is index arithmetic, and neither needs a canvas. What DOES need a
 * canvas - measuring how wide the text before a span is - stays in the scene.
 * So the part that can be wrong quietly is the part that is unit-tested.
 *
 * Nothing here imports Phaser or the DOM.
 */

/** A run of characters inside one wrapped line. */
export interface Span {
  /** 0-based index into the wrapped lines. */
  readonly line: number;
  /** Character index of the run's first character within that line. */
  readonly start: number;
  /** The run itself, exactly as it appears in the line. */
  readonly text: string;
}

/**
 * The quoted words in a note, in the order they appear.
 *
 * STRAIGHT QUOTES ONLY, which is not a simplification: `engine/coach/sentence`
 * restricts Shadow's vocabulary to the straight apostrophe and rejects curly
 * ones, so a curly quote in a note is already a note that never reaches a
 * child. Matching only what can ship keeps this from claiming a span that the
 * renderer would then draw in the wrong place.
 *
 * The quotes are NOT part of the span. They stay in the base ink, which is what
 * makes the coloured run read as the word rather than as a coloured phrase.
 */
export function quotedWords(note: string): string[] {
  const out: string[] = [];
  for (const m of note.matchAll(/"([^"\n]+)"/g)) {
    const word = m[1];
    if (word !== undefined && word.trim().length > 0) out.push(word);
  }
  return out;
}

/**
 * Where each quoted word lands once Phaser has wrapped the note.
 *
 * `lines` is what `Phaser.GameObjects.Text.getWrappedText()` returns, i.e. the
 * paragraph as it is actually drawn. Matching against THAT rather than against
 * the original string is the whole point: a word that wraps onto the next line
 * has a completely different x, and a highlight computed from the unwrapped
 * string would be drawn in the middle of nowhere.
 *
 * A word is only claimed once per occurrence, left to right, so a note that
 * names the same word twice highlights both and a word that also appears
 * unquoted earlier in the line is not stolen by the first match. A span that
 * cannot be found - because wrapping split the word, or the line array does not
 * match the note - is DROPPED rather than guessed: a missing highlight is a
 * flat line, and a wrong one is a coloured smear across the wrong word.
 */
export function highlightSpans(lines: readonly string[], words: readonly string[]): Span[] {
  const spans: Span[] = [];
  /** How far into each line we have already consumed, so repeats advance. */
  const consumed = new Map<number, number>();

  for (const word of words) {
    for (let line = 0; line < lines.length; line += 1) {
      const haystack = lines[line];
      if (haystack === undefined) continue;
      const from = consumed.get(line) ?? 0;
      const at = haystack.indexOf(word, from);
      if (at < 0) continue;
      spans.push({ line, start: at, text: word });
      consumed.set(line, at + word.length);
      break;
    }
  }
  return spans;
}

/** The text before a span on its own line: what the caller has to measure. */
export function prefixOf(lines: readonly string[], span: Span): string {
  return (lines[span.line] ?? "").slice(0, span.start);
}
