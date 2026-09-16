/**
 * Hard-coded-string checker (AC-14.3, architecture section 8).
 *
 * AC-14.3: "All UI strings come from i18n files; no hard-coded English in
 * scenes." Architecture section 8 says a test extracts string literals from
 * `src/game` and fails on any non-i18n user-facing text.
 *
 * WHAT THIS FILE IS. The reusable checker, as a pure function over source text.
 * It does not read the filesystem and it does not know src/game exists, which
 * is what lets it live in src/engine at all (CLAUDE.md: no DOM, no fs, no
 * ambient I/O) and what lets it be unit-tested against fixture snippets today.
 *
 * WHAT IS STILL OUTSTANDING. Nothing walks src/game/scenes yet, because there
 * are no scenes yet - src/game is a .gitkeep. The scene-level enforcement is a
 * thin later step: read every file under src/game, call findHardcodedStrings on
 * each, fail if anything comes back. That wiring belongs with the first scene,
 * not here.
 *
 * HOW IT DECIDES. A real parser is overkill and a naive regex is worse than
 * nothing, so this is a small hand-written scanner (comments, quoted strings,
 * template literals with nested `${}`, regex literals) feeding a heuristic
 * classifier. The classifier is tuned to be NOISY rather than quiet: a lint
 * that missed the word "Play" would not be worth running. The cost is that a
 * PascalCase technical literal - a scene key "Flight", a font family "Arial" -
 * is flagged too. Two answers: put those in a constants module, or mark the
 * line with `i18n-ignore` in a comment.
 */

/** Put this in a comment to exempt every literal on that line. */
export const HARDCODED_IGNORE_MARKER = "i18n-ignore";

export type HardcodedReason =
  /** A user-facing literal that should have come from a string table. */
  | "literal"
  /** The ship is named in copy. C07: copy uses {shipName}, never "Lantern". */
  | "ship-name";

export interface HardcodedFinding {
  readonly value: string;
  /** 1-based line of the literal's opening quote. */
  readonly line: number;
  readonly reason: HardcodedReason;
}

interface RawLiteral {
  readonly value: string;
  readonly start: number;
}

const WHITESPACE = /\s/;

/** Chars after which a `/` opens a regex rather than dividing. */
const REGEX_PRECEDERS = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "^",
  "~",
  "<",
  ">",
]);

function skipRegex(src: string, from: number): number {
  let i = from + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i; // unterminated: it was division after all
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i += 1;
      break;
    }
    i += 1;
  }
  while (i < src.length && /[a-z]/.test(src.charAt(i))) i += 1;
  return i;
}

function readQuoted(src: string, from: number): { value: string; end: number } {
  const quote = src.charAt(from);
  let i = from + 1;
  let value = "";
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === "\\") {
      value += src.charAt(i + 1);
      i += 2;
      continue;
    }
    if (c === quote) {
      i += 1;
      break;
    }
    if (c === "\n") break; // unterminated string; stop at the line end
    value += c;
    i += 1;
  }
  return { value, end: i };
}

interface ScanState {
  readonly src: string;
  readonly literals: RawLiteral[];
  readonly ignoredLines: Set<number>;
  lineOf(index: number): number;
}

function markIgnored(state: ScanState, from: number, to: number): void {
  const first = state.lineOf(from);
  const last = state.lineOf(Math.max(from, to - 1));
  for (let line = first; line <= last; line += 1) state.ignoredLines.add(line);
}

function scanTemplate(state: ScanState, from: number): number {
  const { src } = state;
  let i = from + 1;
  const start = i;
  let value = "";
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === "\\") {
      value += src.charAt(i + 1);
      i += 2;
      continue;
    }
    if (c === "`") {
      i += 1;
      break;
    }
    if (c === "$" && src.charAt(i + 1) === "{") {
      // The interpolated expression is code: scan it, keep the static text.
      i = scanCode(state, i + 2, true);
      continue;
    }
    value += c;
    i += 1;
  }
  state.literals.push({ value, start });
  return i;
}

/** Walk code. `untilBrace` returns at the matching `}`. */
function scanCode(state: ScanState, from: number, untilBrace: boolean): number {
  const { src } = state;
  let i = from;
  let prev = "";

  while (i < src.length) {
    const c = src.charAt(i);
    const next = src.charAt(i + 1);

    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      if (src.slice(i, stop).includes(HARDCODED_IGNORE_MARKER)) {
        markIgnored(state, i, stop);
      }
      i = stop;
      continue;
    }

    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      if (src.slice(i, stop).includes(HARDCODED_IGNORE_MARKER)) {
        markIgnored(state, i, stop);
      }
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      const { value, end } = readQuoted(src, i);
      state.literals.push({ value, start: i });
      i = end;
      prev = '"';
      continue;
    }

    if (c === "`") {
      i = scanTemplate(state, i);
      prev = "`";
      continue;
    }

    if (c === "/" && REGEX_PRECEDERS.has(prev)) {
      i = skipRegex(src, i);
      prev = "/";
      continue;
    }

    if (c === "{") {
      i = scanCode(state, i + 1, true);
      prev = "}";
      continue;
    }

    if (c === "}" && untilBrace) return i + 1;

    if (!WHITESPACE.test(c)) prev = c;
    i += 1;
  }
  return i;
}

/** Literals in these positions are module paths or i18n keys, never copy. */
const NON_COPY_POSITION =
  /(?:\bfrom|\bimport|\brequire\s*\(|\bt\s*\(|\.t\s*\(|\braw\s*\(|\bhas\s*\()\s*$/;

const HAS_LETTER = /[A-Za-zÀ-ɏऀ-ॿ]/;
const ASSET_EXTENSION =
  /\.(?:png|jpe?g|webp|gif|svg|json|ts|tsx|js|mjs|cjs|css|woff2?|ttf|mp3|ogg|wav|html)$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const I18N_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const PATH_LIKE = /^(?:https?:\/\/|\/|\.{1,2}\/|@[a-z])/i;
const SHIP_NAME = /lantern/i;

/** lowercase/camel/kebab identifiers, CONSTANT_CASE, numbers with units. */
function isTechnicalToken(token: string): boolean {
  if (HEX_COLOR.test(token)) return true;
  if (/^-?\d+(?:\.\d+)?[a-z%]*$/.test(token)) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(token)) return true;
  return /^[#.]?[a-z$_][A-Za-z0-9_$-]*$/.test(token);
}

function classify(value: string): HardcodedReason | null {
  // C07 first: the ship's name in copy is a finding whatever else it looks like.
  if (SHIP_NAME.test(value)) return "ship-name";

  const trimmed = value.trim();
  if (trimmed.length < 2) return null;
  if (!HAS_LETTER.test(trimmed)) return null;
  if (PATH_LIKE.test(trimmed)) return null;
  if (ASSET_EXTENSION.test(trimmed)) return null;
  if (HEX_COLOR.test(trimmed)) return null;
  if (I18N_KEY.test(trimmed)) return null;
  if (trimmed.split(/\s+/).every(isTechnicalToken)) return null;

  const isSentence = /\s/.test(trimmed);
  const isCapitalised = /^[A-Z]/.test(trimmed);
  const isNonAscii = /[^\x20-\x7E]/.test(trimmed);
  return isSentence || isCapitalised || isNonAscii ? "literal" : null;
}

/** Full detail: value, line and why. */
export function scanSource(source: string): HardcodedFinding[] {
  // Offset -> 1-based line. Linear because lint input is one source file at a
  // time, not a hot path.
  const lineOf = (index: number): number => {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
      if (source.charCodeAt(i) === 10) line += 1;
    }
    return line;
  };

  const state: ScanState = {
    src: source,
    literals: [],
    ignoredLines: new Set<number>(),
    lineOf,
  };
  scanCode(state, 0, false);

  const findings: HardcodedFinding[] = [];
  for (const literal of state.literals) {
    const line = lineOf(literal.start);
    if (state.ignoredLines.has(line)) continue;
    if (NON_COPY_POSITION.test(source.slice(Math.max(0, literal.start - 64), literal.start))) {
      continue;
    }
    const reason = classify(literal.value);
    if (reason !== null) findings.push({ value: literal.value, line, reason });
  }
  return findings;
}

/**
 * AC-14.3: user-facing string literals in one source file, deduplicated, in
 * order of first appearance. Empty means the file is clean.
 */
export function findHardcodedStrings(source: string): string[] {
  const seen = new Set<string>();
  for (const finding of scanSource(source)) seen.add(finding.value);
  return [...seen];
}
