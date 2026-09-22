import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STOP_IDS, type Lang } from "@engine/types";
import { TABLES } from "@engine/i18n/strings";
import {
  REVEAL_CEILING_MS,
  REVEAL_CPS,
  charsRevealedAt,
  msPerChar,
  revealDurationMs,
  revealPerBlock,
} from "@game/scenes/support/briefingTypewriter";

/**
 * UR-59 - THE BRIEFING TYPES ITSELF OUT, AND NEVER MAKES ANYBODY WAIT.
 *
 * The effect is two lines of arithmetic; the RISK is entirely in the numbers,
 * so the numbers are what is tested here. The behavioural half - any key
 * finishes it, it does not gate launch, reduced motion turns it off - is in
 * `tests/e2e/briefing.spec.ts`, because those are claims about a running screen
 * and a fake clock cannot make them.
 *
 * THE BAR THIS FILE HOLDS: no shipped briefing, in any language, may take
 * longer to reveal than the ceiling, and the cadence must stay far faster than
 * a seven-year-old reads. A typewriter slower than its reader is a metronome
 * the reader is tied to, and "too slow is worse than absent".
 *
 *   npx vitest run tests/unit/scenes/briefingTypewriter.test.ts --coverage.enabled=false
 */

const CONTENT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/content",
);
const LANGS: Lang[] = ["en", "es", "hi"];

/** The characters the reveal actually walks: the sentences plus the footer. */
function pageChars(lang: Lang, stop: string): number | null {
  const dir = resolve(CONTENT, lang);
  const footer = TABLES[lang]?.["briefing.shipReady"] ?? "";
  if (!readdirSync(dir).includes(`${stop}.json`)) return null;
  const raw = JSON.parse(readFileSync(resolve(dir, `${stop}.json`), "utf8")) as Record<
    string,
    unknown
  >;
  const briefing = raw["briefing"];
  const sentences = Array.isArray(briefing) ? briefing.map(String) : [];
  return sentences.join("").length + footer.length;
}

describe("the cadence is deliberate and bounded", () => {
  it("runs at the nominal rate until the ceiling takes over", () => {
    expect(REVEAL_CPS).toBe(160);
    expect(msPerChar(160)).toBeCloseTo(6.25, 5);
    expect(revealDurationMs(160)).toBe(1000);
    // Past the ceiling the cadence TIGHTENS rather than the page running long.
    expect(revealDurationMs(10_000)).toBe(REVEAL_CEILING_MS);
    expect(msPerChar(10_000)).toBeLessThan(1);
    expect(revealDurationMs(0)).toBe(0);
    expect(msPerChar(0)).toBe(0);
  });

  it("finishes EVERY shipped briefing inside the ceiling, in every language", () => {
    // Standards rule 5: the sweep, not Mars. The longest page in the product is
    // what the ceiling has to hold, and nobody has read Hindi Neptune out loud
    // with a stopwatch.
    //
    // WATCHED FAILING: set REVEAL_CEILING_MS to 4000 and drop REVEAL_CPS to 35
    // - the cadence of a console dialogue box - and all 21 combinations report
    // over the bar, every one of them pinned at the raised ceiling:
    // "expected [ 'en/earth: 4000ms', ...(20) ] to deeply equal []". Without
    // the ceiling Earth's 370 characters at 35 cps would run 10.6 s.
    const slow: string[] = [];
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const chars = pageChars(lang, stop);
        if (chars === null) continue;
        const ms = revealDurationMs(chars);
        if (ms > 2000) slow.push(`${lang}/${stop}: ${Math.round(ms)}ms`);
      }
    }
    expect(slow).toEqual([]);
  });

  it("stays far ahead of the child reading it, at every stop", () => {
    // WHY THE NUMBER IS WHAT IT IS. A seven-year-old reads around 90 words a
    // minute, which is about 8 characters a second. The reveal has to arrive
    // ahead of the eye that follows it or it becomes pacing, so the bar is an
    // order of magnitude, not a margin.
    //
    // WATCHED FAILING: at 35 cps with a 4 s ceiling this reports
    // "en/mars: expected 78.75 to be greater than 80" - a reveal under ten
    // times reading speed, which is the point at which a child starts waiting
    // for it.
    const CHILD_CPS = 8;
    for (const lang of LANGS) {
      for (const stop of STOP_IDS) {
        const chars = pageChars(lang, stop);
        if (chars === null) continue;
        const revealCps = chars / (revealDurationMs(chars) / 1000);
        expect(revealCps, `${lang}/${stop}`).toBeGreaterThan(CHILD_CPS * 10);
      }
    }
  });

  it("completes the page before a sweep settles on it", () => {
    // `text-collision.spec.ts` settles 2000 ms and then reads every Text box on
    // the screen. A reveal that can still be running at that moment is a flaky
    // sweep, and the tempting fix for a flaky sweep is a weaker assertion
    // (standards rule 6).
    expect(REVEAL_CEILING_MS).toBeLessThan(2000);
  });
});

describe("the reveal walks the page from the start to the end", () => {
  it("shows nothing at zero and everything at the end, and never overshoots", () => {
    const chars = 300;
    expect(charsRevealedAt(0, chars)).toBe(0);
    expect(charsRevealedAt(-50, chars)).toBe(0);
    expect(charsRevealedAt(revealDurationMs(chars), chars)).toBe(chars);
    expect(charsRevealedAt(10_000, chars)).toBe(chars);
    expect(charsRevealedAt(Number.NaN, chars)).toBe(0);
    expect(charsRevealedAt(500, 0)).toBe(0);
  });

  it("only ever moves forwards", () => {
    // A reveal that goes backwards for a frame deletes a word a child was
    // reading. Monotonic, checked rather than assumed.
    const chars = 370;
    let last = 0;
    for (let ms = 0; ms <= revealDurationMs(chars) + 50; ms += 7) {
      const now = charsRevealedAt(ms, chars);
      expect(now, `at ${ms}ms`).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBe(chars);
  });

  it("is halfway through the page halfway through the run", () => {
    const chars = 300;
    expect(charsRevealedAt(revealDurationMs(chars) / 2, chars)).toBe(150);
  });

  it("fills each block before it starts the next one", () => {
    // The page is ONE run, not five independent ones: that is what makes the
    // reveal walk down the page instead of five paragraphs growing at once.
    //
    // WATCHED FAILING: change `revealPerBlock` to
    // `lengths.map((l) => Math.min(l, revealed))` - every block typing at once
    // - and this reports "expected [ 7, 7, 7 ] to deeply equal [ 7, +0, +0 ]".
    expect(revealPerBlock([10, 10, 10], 7)).toEqual([7, 0, 0]);
    expect(revealPerBlock([10, 10, 10], 10)).toEqual([10, 0, 0]);
    expect(revealPerBlock([10, 10, 10], 14)).toEqual([10, 4, 0]);
    expect(revealPerBlock([10, 10, 10], 30)).toEqual([10, 10, 10]);
    // More revealed than there is page: every block is full and nothing throws.
    expect(revealPerBlock([10, 10, 10], 99)).toEqual([10, 10, 10]);
    expect(revealPerBlock([], 99)).toEqual([]);
    expect(revealPerBlock([10], -5)).toEqual([0]);
  });
});

/**
 * UR-126: THE ACCENT NAME IS PART OF THE LINE, NOT A LABEL OVER IT.
 *
 * The pilot's name is drawn as a second Text in the stop's accent, sitting
 * exactly over the first word of the closing line - Phaser's `Text` carries one
 * colour and this game has no rich-text renderer, so an overlay is how one word
 * in a wrapped sentence gets a different ink.
 *
 * THE DEFECT: it was drawn once and left alone, so the coloured name was on the
 * page before the sentence under it had typed a character. The owner: "it
 * appears first before the letters show up, so think you're building it wrong".
 *
 * `paintReveal` now slices the overlay by the SAME character count it slices
 * that block with. The name is the first thing in the line, so those counts are
 * the same number until the name runs out.
 */
describe("UR-126: the pilot's name reveals with the line it sits on", () => {
  const SRC = readFileSync("src/game/scenes/BriefingScene.ts", "utf8");

  it("the overlay starts empty under the typewriter", () => {
    // THE DEFECT ITSELF. Drawn at full text and never sliced is what put a
    // coloured word on an otherwise blank page.
    expect(SRC).toMatch(/if \(!this\.story\.ctx\.reducedMotion\) this\.nameOverlay\.setText\(""\)/);
  });

  it("paintReveal slices it by its own block's revealed count", () => {
    expect(SRC).toMatch(
      /const shown = counts\[this\.nameOverlayBlock\] \?\? 0;[\s\S]{0,120}nameOverlay\.setText\(\s*this\.nameOverlayText\.slice\(0, shown\)/,
    );
  });

  it("the block index is taken from the TYPED run, not the full block list", () => {
    // The header is filtered out before `armTypewriter` sees it, so indexing
    // into `blocks` would slice the name against the wrong sentence's count.
    expect(SRC).toMatch(
      /nameOverlayBlock = blocks[\s\S]{0,140}filter\(\(b\) => b\.row\.group !== "header"\)[\s\S]{0,80}findIndex/,
    );
  });

  it("skipping the reveal restores the whole name", () => {
    expect(SRC).toMatch(/this\.nameOverlay\?\.setText\(this\.nameOverlayText\)/);
  });

  it("re-entering the scene clears the handles", () => {
    // Phaser builds a scene once and re-runs `create`; a stale overlay from the
    // previous visit is an object on a dead display list.
    expect(SRC).toMatch(/this\.nameOverlay = null;[\s\S]{0,120}this\.nameOverlayBlock = -1;/);
  });
});
