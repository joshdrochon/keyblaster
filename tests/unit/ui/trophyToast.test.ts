import { describe, expect, it } from "vitest";
import { GAME_HEIGHT } from "@game/sceneKeys";
import { rectsOverlap, type Rect } from "@game/ui/layout";
import { hudRects } from "@game/flight/hudLayout";
import { SPACE } from "@game/ui/theme";
import {
  TROPHY_CHIP,
  TROPHY_CYCLE_MS,
  TROPHY_TIMING,
  WORD_BAND_BOTTOM,
  beltKeepOut,
  chipRect,
  chipWidth,
  chipWindow,
  queueDelays,
  wordBand,
} from "@game/ui/trophyToastLayout";
import {
  TROPHY_CUE,
  TROPHY_CUE_MS,
  TROPHY_CUE_PEAK_GAIN,
} from "@game/ui/trophyCue";
import {
  LIVE_TROPHY_THRESHOLDS,
  emitLiveTrophies,
  resetLiveTrophies,
  type TrophyEmitter,
} from "@game/ui/trophyToastLayout";
import { CHAIN_TROPHIES } from "@engine/awards";

/**
 * THE IN-FLIGHT TROPHY NOTIFICATION, AS GEOMETRY AND AS A CLOCK.
 *
 * A trophy earned mid-belt has to surface mid-belt, and the one thing it may
 * not do is cover the word the child is typing. `src/game/ui/toast.ts` has
 * claimed since it was written that it is for "during flight or at Results";
 * the negative control at the foot of this file measures its rest position
 * against the belt and shows that it is not, which is why this component
 * exists rather than a call to that one.
 */

const show = (r: Rect): string =>
  `x ${r.x.toFixed(1)}..${(r.x + r.w).toFixed(1)}  y ${r.y.toFixed(1)}..${(r.y + r.h).toFixed(1)}`;

/** 16:9 through the 32:9 ceiling. */
const WIDTHS = [1920, 2160, 2560, 3440, 3840] as const;

/** A short trophy name and the longest one in the catalogue. */
const INK_WIDTHS = [120, 240, 420, 900] as const;

describe("trophy toast - it never covers the belt", () => {
  it("clears every HUD plate and the whole falling-word band, at every width", () => {
    for (const width of WIDTHS) {
      for (const ink of INK_WIDTHS) {
        const chip = chipRect(width, ink);
        for (const zone of beltKeepOut(width)) {
          expect(
            rectsOverlap(chip, zone),
            `w=${width} ink=${ink}\n  chip ${show(chip)}\n  zone ${show(zone)}`,
          ).toBe(false);
        }
      }
    }
  });

  it("sits below the lowest ink a word plate can reach", () => {
    const chip = chipRect(1920, 240);
    expect(
      chip.y,
      `chip ${show(chip)}  word band bottom ${WORD_BAND_BOTTOM}`,
    ).toBeGreaterThanOrEqual(WORD_BAND_BOTTOM);
  });

  it("stays inside the frame", () => {
    for (const width of WIDTHS) {
      for (const ink of INK_WIDTHS) {
        const chip = chipRect(width, ink);
        const why = `w=${width} ink=${ink} chip ${show(chip)}`;
        expect(chip.x, why).toBeGreaterThanOrEqual(0);
        expect(chip.x + chip.w, why).toBeLessThanOrEqual(width);
        expect(chip.y + chip.h, why).toBeLessThanOrEqual(GAME_HEIGHT);
      }
    }
  });

  it("is anchored to the world's right edge, so it moves with a wider window", () => {
    const at1920 = chipRect(1920, 240);
    const at3440 = chipRect(3440, 240);
    expect(1920 - (at1920.x + at1920.w)).toBe(TROPHY_CHIP.insetX);
    expect(3440 - (at3440.x + at3440.w)).toBe(TROPHY_CHIP.insetX);
  });

  it("is bounded in width whatever it is asked to hold", () => {
    expect(chipWidth(0)).toBe(TROPHY_CHIP.minW);
    expect(chipWidth(10_000)).toBe(TROPHY_CHIP.maxW);
    expect(chipWidth(400)).toBeGreaterThan(chipWidth(200));
  });
});

describe("trophy toast - the clock", () => {
  it("is on screen long enough to read and short enough not to sit there", () => {
    // Four short words at a seven-year-old's ~2 words/second, plus a beat.
    expect(TROPHY_TIMING.holdMs).toBeGreaterThanOrEqual(2000);
    expect(TROPHY_TIMING.holdMs).toBeLessThanOrEqual(3000);
    expect(TROPHY_CYCLE_MS).toBeLessThan(3500);
  });

  it("holds the chip for longer than the cue rings", () => {
    expect(
      TROPHY_TIMING.holdMs,
      `hold ${TROPHY_TIMING.holdMs} cue ${TROPHY_CUE_MS}`,
    ).toBeGreaterThan(TROPHY_CUE_MS);
  });

  it("queues two trophies rather than stacking them", () => {
    const delays = queueDelays(3);
    expect(delays[0]).toBe(0);
    for (let i = 1; i < delays.length; i += 1) {
      const prev = chipWindow(i - 1);
      const next = chipWindow(i);
      expect(
        next[0],
        `chip ${i - 1} ends ${prev[1]}, chip ${i} starts ${next[0]}`,
      ).toBeGreaterThanOrEqual(prev[1]);
    }
  });

  it("never has two chips on screen at once", () => {
    const windows = [0, 1, 2, 3].map((i) => chipWindow(i));
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        const a = windows[i] as readonly [number, number];
        const b = windows[j] as readonly [number, number];
        expect(
          a[1] > b[0] && b[1] > a[0],
          `window ${i} ${a.join("..")} vs window ${j} ${b.join("..")}`,
        ).toBe(false);
      }
    }
  });
});

describe("trophy toast - the cue", () => {
  it("is a reward, but not louder than the beacon bell", () => {
    // `beacon`'s quietest variant is 0.27 and it is the reward tone of the
    // whole loop. A trophy is a smaller thing that happens more often.
    expect(TROPHY_CUE_PEAK_GAIN).toBeLessThan(0.27);
    // And it clears D31's floor: `typo` is the quietest sound in the game at
    // 0.045, and everything else has to be louder than it.
    expect(TROPHY_CUE_PEAK_GAIN).toBeGreaterThan(0.045);
    // `sfx.test.ts`'s hard ceiling on any declared recipe.
    expect(TROPHY_CUE_PEAK_GAIN).toBeLessThanOrEqual(0.5);
  });

  it("gives every grain an attack, so nothing starts on an edge", () => {
    for (const g of TROPHY_CUE) {
      expect(g.attackMs, `${g.startHz}Hz grain`).toBeGreaterThan(0);
      expect(g.attackMs, `${g.startHz}Hz grain`).toBeLessThan(g.durationMs);
      expect(g.peakGain).toBeGreaterThan(0);
      expect(g.startHz).toBeGreaterThan(20);
      expect(g.endHz).toBeGreaterThan(20);
    }
  });

  it("is longer than a keystroke tick and shorter than the beacon bell", () => {
    // keystroke is 28-36 ms and must not be confused with this; `beacon` rings
    // for 900 ms and is the sound of a stop being charted.
    expect(TROPHY_CUE_MS).toBeGreaterThan(120);
    expect(TROPHY_CUE_MS).toBeLessThan(900);
  });

  it("keeps its grains within 6 dB of each other, like every other event", () => {
    const peaks = TROPHY_CUE.map((g) => g.peakGain);
    const spread = 20 * Math.log10(Math.max(...peaks) / Math.min(...peaks));
    expect(spread, `spread ${spread.toFixed(1)} dB`).toBeLessThan(12);
  });
});

describe("trophy toast - the negative controls", () => {
  it("the MENU toast's rest position would cover the HUD and the word band", () => {
    // `ui/toast.ts`: restX = GAME_WIDTH - w - SPACE.gutter, restY = 64,
    // h = text.height + rowPadY * 2, w floors at 280.
    const width = 1920;
    const menu: Rect = { x: width - 280 - SPACE.gutter, y: 64, w: 280, h: 59 };
    const zones = beltKeepOut(width);
    const hit = zones.filter((z) => rectsOverlap(menu, z));
    expect(
      hit.length,
      `menu toast ${show(menu)} clears the belt, so this component is unnecessary`,
    ).toBeGreaterThan(0);
  });

  it("a chip one row higher would be inside the falling-word band", () => {
    const chip = chipRect(1920, 240);
    const stacked: Rect = { ...chip, y: chip.y - (chip.h + 14) };
    expect(
      rectsOverlap(stacked, wordBand(1920)),
      `a stacked second chip at ${show(stacked)} must not be clear of the band`,
    ).toBe(true);
  });

  it("the HUD really is where this test thinks it is", () => {
    const rects = hudRects(1920);
    expect(rects.length).toBe(3);
    expect(Math.max(...rects.map((r) => r.y + r.h))).toBeLessThan(WORD_BAND_BOTTOM);
  });
});

describe("trophy toast - what the flight loop can announce", () => {
  /** A stand-in for `Phaser.Game`: the helper only ever touches `events`. */
  const fakeGame = () => {
    const seen: string[][] = [];
    return {
      seen,
      game: {
        events: { emit: (_n: string, ids: readonly string[]) => seen.push([...ids]) },
      } as TrophyEmitter,
    };
  };

  it("announces exactly the two trophies that can be known mid-belt", () => {
    // `@engine/awards` owns the numbers; this only owns WHEN they are said.
    expect(LIVE_TROPHY_THRESHOLDS.map((t) => t.id)).toEqual(
      CHAIN_TROPHIES.map((t) => t.id),
    );
    expect(LIVE_TROPHY_THRESHOLDS.map((t) => t.combo)).toEqual(
      CHAIN_TROPHIES.map((t) => t.combo),
    );
  });

  it("fires on the frame the chain crosses, and only once", () => {
    const { game, seen } = fakeGame();
    resetLiveTrophies(game);
    for (let combo = 1; combo <= 60; combo += 1) emitLiveTrophies(game, combo);
    expect(seen, `emitted ${JSON.stringify(seen)}`).toEqual([["chain25"], ["chain50"]]);
  });

  it("says nothing about a trophy the profile already holds", () => {
    const { game, seen } = fakeGame();
    resetLiveTrophies(game);
    for (let combo = 1; combo <= 60; combo += 1) {
      emitLiveTrophies(game, combo, ["chain25"]);
    }
    expect(seen, `emitted ${JSON.stringify(seen)}`).toEqual([["chain50"]]);
  });

  it("starts fresh on the next belt", () => {
    const { game, seen } = fakeGame();
    resetLiveTrophies(game);
    emitLiveTrophies(game, 25);
    resetLiveTrophies(game);
    emitLiveTrophies(game, 25);
    expect(seen).toEqual([["chain25"], ["chain25"]]);
  });

  it("emits nothing at all below the first threshold", () => {
    const { game, seen } = fakeGame();
    resetLiveTrophies(game);
    for (let combo = 0; combo < 25; combo += 1) emitLiveTrophies(game, combo);
    expect(seen).toEqual([]);
  });
});
