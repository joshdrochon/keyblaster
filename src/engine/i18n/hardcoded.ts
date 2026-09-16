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
 * each, fail if anything comes back. That wiring belongs with the first scene.
 *
 * HOW IT DECIDES: CALL-SITE POSITION, NOT CAPITALISATION.
 *
 * The first version of this file asked what a literal LOOKED like - capitalised,
 * spaced, non-ASCII. That is the wrong question for this codebase. D41 makes
 * lowercase the default letter case, so the copy this game actually contains
 * ("play", "score", "game over") looks exactly like a Phaser scene key, while
 * the PascalCase scene keys and ease names Phaser forces on us ("FlightScene",
 * "Cubic.easeOut") look exactly like copy. Shape-based classification gets both
 * backwards, and a lint everyone silences on day one is worse than no lint.
 *
 * So the scanner tracks the enclosing call and the enclosing object key, and
 * classification asks WHERE the literal sits:
 *
 *   copy position      `add.text(x, y, HERE)`, `setText(HERE)`, `.text = HERE`,
 *                      `{ label: HERE }`            -> flag, whatever its shape
 *   non-copy position  `load.image(HERE)`, `scene.start(HERE)`, `console.log(HERE)`,
 *                      `{ ease: HERE }`, `t(HERE)`, object KEY position -> ignore
 *   unknown position   flag only multi-word alphabetic prose, or a single
 *                      non-ASCII word (Devanagari or accented Latin is never a
 *                      technical token in this codebase)
 *
 * The residual false positive is a two-word Latin technical literal in an
 * unknown position - a bare font family, say. In real Phaser that arrives as
 * `{ fontFamily: ... }`, which is a known non-copy key; otherwise there is the
 * `i18n-ignore` marker.
 *
 * TEMPLATE LITERALS report their RAW source, `hull ${hp}%` rather than the
 * static chunks "hull %", so a finding is always a string you can grep for.
 */

/** Put this in a comment to exempt every literal on that line. */
export const HARDCODED_IGNORE_MARKER = "i18n-ignore";

export type HardcodedReason =
  /** A user-facing literal that should have come from a string table. */
  | "literal"
  /** The ship is named in copy. C07: copy uses {shipName}, never "Lantern". */
  | "ship-name";

export interface HardcodedFinding {
  /** The literal as written: raw template source for a template literal. */
  readonly value: string;
  /** 1-based line of the literal's opening quote. */
  readonly line: number;
  readonly reason: HardcodedReason;
}

interface RawLiteral {
  /** Static text, used for classification. */
  readonly value: string;
  /** What to show the developer; differs from `value` for templates. */
  readonly report: string;
  readonly start: number;
  readonly end: number;
  /** Nearest enclosing callee, e.g. "this.add.text". Empty if none. */
  readonly callee: string;
}

const WHITESPACE = /\s/;
const IDENT_CHAR = /[A-Za-z0-9_$.?]/;

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
  /** Enclosing callees, innermost last. */
  readonly callees: string[];
  lineOf(index: number): number;
}

function markIgnored(state: ScanState, from: number, to: number): void {
  const first = state.lineOf(from);
  const last = state.lineOf(Math.max(from, to - 1));
  for (let line = first; line <= last; line += 1) state.ignoredLines.add(line);
}

function currentCallee(state: ScanState): string {
  return state.callees.slice(-1).join("");
}

function scanTemplate(state: ScanState, from: number): number {
  const { src } = state;
  let i = from + 1;
  const start = i;
  let value = "";
  const callee = currentCallee(state);
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
  // Report the raw template, placeholders and all, so findings are greppable.
  const rawEnd = src.charAt(i - 1) === "`" ? i - 1 : i;
  state.literals.push({
    value,
    report: src.slice(start, rawEnd),
    start,
    end: i,
    callee,
  });
  return i;
}

/** Walk code. `untilBrace` returns at the matching `}`. */
function scanCode(state: ScanState, from: number, untilBrace: boolean): number {
  const { src } = state;
  let i = from;
  let prev = "";
  let ident = "";

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
      state.literals.push({
        value,
        report: value,
        start: i,
        end,
        callee: currentCallee(state),
      });
      i = end;
      prev = '"';
      ident = "";
      continue;
    }

    if (c === "`") {
      i = scanTemplate(state, i);
      prev = "`";
      ident = "";
      continue;
    }

    if (c === "/" && REGEX_PRECEDERS.has(prev)) {
      i = skipRegex(src, i);
      prev = "/";
      ident = "";
      continue;
    }

    if (c === "(") {
      // Whatever identifier or member expression led here is the callee.
      state.callees.push(ident);
      ident = "";
      prev = "(";
      i += 1;
      continue;
    }

    if (c === ")") {
      state.callees.pop();
      ident = "";
      prev = ")";
      i += 1;
      continue;
    }

    if (c === "{") {
      i = scanCode(state, i + 1, true);
      prev = "}";
      ident = "";
      continue;
    }

    if (c === "}" && untilBrace) return i + 1;

    if (IDENT_CHAR.test(c)) ident += c;
    else if (!WHITESPACE.test(c)) ident = "";

    if (!WHITESPACE.test(c)) prev = c;
    i += 1;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

/** Literals here are module paths or i18n keys, never copy. */
const NON_COPY_PRECEDER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*$/;
/** `this.hud.text = "..."` is copy. */
const TEXT_ASSIGNMENT = /\.(?:text|label|title|innerText|textContent)\s*=\s*$/;
/** The object key a literal is the value of, quoted or bare. */
const ENCLOSING_KEY = /(?:^|[,{(])\s*["']?([A-Za-z_$][A-Za-z0-9_$]*)["']?\s*:\s*$/;

/** Keys whose values are copy. */
const COPY_KEYS = new Set([
  "text",
  "label",
  "title",
  "message",
  "placeholder",
  "caption",
  "tooltip",
  "heading",
  "body",
  "description",
  "prompt",
]);

/** Keys whose values are configuration, however much they read like copy. */
const NON_COPY_KEYS = new Set([
  "font",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "ease",
  "key",
  "name",
  "id",
  "type",
  "event",
  "scene",
  "texture",
  "frame",
  "atlas",
  "url",
  "path",
  "src",
  "color",
  "backgroundColor",
  "stroke",
  "fill",
  "align",
  "blendMode",
  "origin",
  "shader",
  "lang",
  "mode",
]);

/** Final segment of a callee whose string arguments are copy. */
const COPY_CALLEES = new Set([
  "text",
  "setText",
  "addText",
  "appendText",
  "label",
  "setLabel",
  "setTitle",
  "setPlaceholder",
  "setDescription",
  "bitmapText",
  "dynamicBitmapText",
]);

/** Final segment of a callee whose string arguments are never copy. */
const NON_COPY_CALLEES = new Set([
  // i18n itself
  "t",
  "raw",
  "has",
  // asset loading
  "image",
  "spritesheet",
  "atlas",
  "audio",
  "json",
  "html",
  "bitmapFont",
  "video",
  "glsl",
  "pack",
  "script",
  "tilemapTiledJSON",
  // scene and state plumbing
  "start",
  "launch",
  "stop",
  "pause",
  "resume",
  "run",
  "sleep",
  "wake",
  "switch",
  "super",
  "get",
  "set",
  "play",
  "setEase",
  // events
  "on",
  "once",
  "off",
  "emit",
  "addEventListener",
  "removeEventListener",
  // logging and DOM lookup
  "log",
  "warn",
  "error",
  "info",
  "debug",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getAttribute",
  "setAttribute",
]);

const HAS_LETTER = /[A-Za-zÀ-ɏऀ-ॿ]/;
const NON_ASCII = /[^\x20-\x7E]/;
const ASSET_EXTENSION =
  /\.(?:png|jpe?g|webp|gif|svg|json|ts|tsx|js|mjs|cjs|css|woff2?|ttf|mp3|ogg|wav|html)$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const DOTTED_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const PATH_LIKE = /^(?:https?:\/\/|\/|\.{1,2}\/|@[a-z])/i;
const CONSTANT_CASE = /^[A-Z][A-Z0-9_]*$/;
const SHIP_NAME = /lantern/i;
/** One alphabetic word, optionally with trailing sentence punctuation. */
const PROSE_WORD = /^[A-Za-zÀ-ɏऀ-ॿ]+[.,!?;:'")]*$/;

/**
 * The fallback for a literal whose call site says nothing. Multi-word
 * alphabetic text, or a single non-ASCII word - Devanagari and accented Latin
 * are never technical tokens in this codebase.
 */
function looksLikeProse(trimmed: string): boolean {
  if (NON_ASCII.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return false;
  return tokens.every((token) => PROSE_WORD.test(token));
}

type Position = "copy" | "non-copy" | "unknown";

function positionOf(literal: RawLiteral, source: string): Position {
  const before = source.slice(Math.max(0, literal.start - 96), literal.start);
  const after = source.slice(literal.end, literal.end + 8);

  // A literal used as an object key is a key, not copy.
  if (/^\s*:/.test(after)) return "non-copy";
  if (NON_COPY_PRECEDER.test(before)) return "non-copy";

  // The key it is the value of wins over the enclosing call, so a style option
  // inside add.text({ fontFamily: ... }) is still configuration.
  const keyMatch = ENCLOSING_KEY.exec(before);
  const key = keyMatch?.[1];
  if (key !== undefined) {
    if (NON_COPY_KEYS.has(key)) return "non-copy";
    if (COPY_KEYS.has(key)) return "copy";
  }

  if (TEXT_ASSIGNMENT.test(before)) return "copy";

  // Last segment of the member expression: "this.add.text" -> "text".
  const tail = literal.callee.split(".").slice(-1).join("");
  if (literal.callee.startsWith("console.")) return "non-copy";
  if (COPY_CALLEES.has(tail)) return "copy";
  if (NON_COPY_CALLEES.has(tail)) return "non-copy";
  return "unknown";
}

function classify(literal: RawLiteral, source: string): HardcodedReason | null {
  const position = positionOf(literal, source);
  if (position === "non-copy") return null;

  const trimmed = literal.value.trim();
  if (trimmed.length < 2) return null;
  if (!HAS_LETTER.test(trimmed)) return null;

  // MAJOR 3: path-like and asset literals are exempt BEFORE the C07 ship-name
  // rule, so `load.image("lantern", "assets/lantern.png")` is silent.
  if (PATH_LIKE.test(trimmed)) return null;
  if (ASSET_EXTENSION.test(trimmed)) return null;
  if (HEX_COLOR.test(trimmed)) return null;
  if (CONSTANT_CASE.test(trimmed)) return null;
  if (DOTTED_IDENTIFIER.test(trimmed)) return null;

  if (position === "copy") {
    return SHIP_NAME.test(trimmed) ? "ship-name" : "literal";
  }

  // Unknown position: only prose, and only then does C07 apply. A bare
  // `"lantern"` used as an asset key is not copy and is not a C07 violation.
  if (!looksLikeProse(trimmed)) return null;
  return SHIP_NAME.test(trimmed) ? "ship-name" : "literal";
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
    callees: [],
    lineOf,
  };
  scanCode(state, 0, false);

  const findings: HardcodedFinding[] = [];
  for (const literal of state.literals) {
    const line = lineOf(literal.start);
    if (state.ignoredLines.has(line)) continue;
    const reason = classify(literal, source);
    if (reason !== null) findings.push({ value: literal.report, line, reason });
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
