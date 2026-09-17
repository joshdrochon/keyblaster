import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STOP_IDS } from "../../../src/engine/types.js";
import type { AudioBufferLike } from "../../../src/game/audio/context.js";
import { NullAudioContext, NullGain } from "../../../src/game/audio/nullContext.js";
import {
  MUSIC_LAYERS,
  MusicBus,
  TRACK_CROSSFADE_MS,
  layerTargetGains,
  type MusicTrackCatalog,
} from "../../../src/game/audio/music.js";
import { browserMusicTracks, manifestMusicStops } from "../../../src/game/audio/index.js";

const SR = 8000;
const FRAME_MS = 1000 / 60;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** A decoded piece: two seconds of a tone, so the loop preparation has material. */
const decodedTone = (ctx: NullAudioContext, hz: number, amplitude = 0.4): AudioBufferLike => {
  const n = SR * 2;
  const buffer = ctx.createBuffer(1, n, SR);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * hz * i) / SR) * amplitude;
  return buffer;
};

interface Rig {
  readonly ctx: NullAudioContext;
  readonly music: MusicBus;
  /** Stop ids `open` was called for, in order. */
  readonly opened: string[];
}

interface RigOptions {
  /** Ids the build shipped. */
  readonly ids?: readonly string[];
  /** Return null to simulate a 404 / offline / empty body. */
  readonly open?: (id: string) => Promise<ArrayBuffer | null>;
  readonly decode?: (data: ArrayBuffer) => Promise<AudioBufferLike>;
}

const rig = (options: RigOptions = {}): Rig => {
  const ctx = new NullAudioContext(SR);
  const opened: string[] = [];
  const ids = [...(options.ids ?? STOP_IDS)].sort();
  const tracks: MusicTrackCatalog = {
    ids: () => ids,
    open: async (id) => {
      opened.push(id);
      return options.open ? options.open(id) : new ArrayBuffer(8);
    },
  };
  const decode =
    options.decode ??
    (async (): Promise<AudioBufferLike> => decodedTone(ctx, 220));
  const music = new MusicBus(ctx, ctx.createGain(), {
    tracks,
    decode,
    // A short fold: these buffers are two seconds long, not forty.
    loop: { crossfadeMs: 40 },
  });
  return { ctx, music, opened };
};

/** Every live piece's own level, in creation order. */
const trackGains = (ctx: NullAudioContext): number[] =>
  ctx.labelledWith("music.track.").map((n) => (n as NullGain).gain.value);

const run = (music: MusicBus, frames: number): void => {
  for (let f = 0; f < frames; f++) music.advance(FRAME_MS);
};

// ---------------------------------------------------------------------------

describe("E-MUSIC-1: the composed piece for a stop actually plays", () => {
  it("UR-12: asks for THIS stop's track and plays it", async () => {
    const { ctx, music, opened } = rig();
    expect(music.sourceKind).toBe("silent");

    await music.setStop("mars");
    expect(opened).toEqual(["mars"]);
    expect(music.trackId).toBe("mars");
    expect(music.sourceKind).toBe("track");
    // The right FILE, named in the graph, not just the right promise resolving.
    expect(ctx.labelledWith("music.source.mars").length).toBe(1);
    expect(ctx.labelledWith("music.source.").length).toBe(1);
  });

  it("UR-12: every stop on the route selects its own piece", async () => {
    const { music, opened } = rig();
    for (const stop of STOP_IDS) {
      await music.setStop(stop);
      expect(music.trackId).toBe(stop);
      run(music, 80); // settle the swap before the next one
    }
    expect(opened).toEqual([...STOP_IDS]);
  });

  it("asking twice for the same stop does not fetch twice", async () => {
    const { music, opened } = rig();
    await music.setStop("saturn");
    await music.setStop("saturn");
    await music.setStop("saturn");
    expect(opened).toEqual(["saturn"]);
    expect(music.trackId).toBe("saturn");
  });

  it("AC-21.2: ONE looping source feeds THREE bands - three clips cannot stack", async () => {
    const { ctx, music } = rig();
    await music.setStop("earth");

    // The whole design decision, asserted. Three independently generated clips
    // would be in three keys at three tempos; one performance through three
    // filters cannot drift out of phase with itself.
    expect(ctx.created.filter((n) => n.kind === "bufferSource").length).toBe(1);
    expect(ctx.labelledWith("music.band.").length).toBe(MUSIC_LAYERS.length);
    for (const spec of MUSIC_LAYERS) {
      expect(ctx.labelledWith(`music.band.${spec.id}`).length).toBe(1);
    }
    // And no oscillators: the synthesised stack is not built when there is a track.
    expect(ctx.created.filter((n) => n.kind === "oscillator").length).toBe(0);
  });

  it("the three bands are three different slices, not three copies", () => {
    const kinds = new Set(MUSIC_LAYERS.map((l) => l.band));
    const hz = new Set(MUSIC_LAYERS.map((l) => l.bandHz));
    expect(kinds.size).toBe(3);
    expect(hz.size).toBe(3);
    // Low, mid, high in layer order, so the stack opens the piece UP as it
    // fills in rather than piling three copies of the bass on itself.
    expect(MUSIC_LAYERS.map((l) => l.band)).toEqual(["lowpass", "bandpass", "highpass"]);
    expect([...MUSIC_LAYERS].map((l) => l.bandHz).sort((a, b) => a - b)).toEqual(
      MUSIC_LAYERS.map((l) => l.bandHz),
    );
  });

  it("AC-21.2: attaching a track does not disturb the layer gains", async () => {
    const { music } = rig();
    music.setIndex(2);
    run(music, 200);
    const settled = music.layerGains().map((g) => g.gain.value);

    await music.setStop("pluto");
    run(music, 200);
    // The intensity index owns the layer gains and a track change is not an
    // intensity change. The piece fades ABOVE them.
    music.layerGains().forEach((gain, i) => expect(gain.gain.value).toBeCloseTo(settled[i]!, 9));
    music.layerGains().forEach((gain, i) =>
      expect(gain.gain.value).toBeCloseTo(layerTargetGains(2)[i]!, 9),
    );
  });
});

describe("E-MUSIC-1: a louder piece does not arrive louder", () => {
  it("the bus trims each piece to one level, measured from its own buffer", async () => {
    const ctx = new NullAudioContext(SR);
    // Saturn is 4.7 LU hotter than Earth as rendered. Unnormalised, a warp is a
    // volume jump that has nothing to do with the game.
    const amplitude: Record<string, number> = { earth: 0.17, saturn: 0.31 };
    let next = "earth";
    const music = new MusicBus(ctx, ctx.createGain(), {
      tracks: { ids: () => ["earth", "saturn"], open: async () => new ArrayBuffer(8) },
      decode: async (): Promise<AudioBufferLike> => decodedTone(ctx, 220, amplitude[next] ?? 0.4),
      loop: { crossfadeMs: 40 },
    });

    await music.setStop("earth");
    const earthTrim = (ctx.labelledWith("music.level.earth")[0] as NullGain).gain.value;
    next = "saturn";
    await music.setStop("saturn");
    const saturnTrim = (ctx.labelledWith("music.level.saturn")[0] as NullGain).gain.value;

    // The quieter piece is trimmed up relative to the louder one, in inverse
    // proportion to the level it was rendered at.
    expect(earthTrim / saturnTrim).toBeCloseTo(0.31 / 0.17, 2);
    expect(earthTrim * 0.17).toBeCloseTo(saturnTrim * 0.31, 6);
  });
});

describe("E-MUSIC-1: a missing track is silence, never a broken scene", () => {
  it("a file that 404s degrades silently and resolves false", async () => {
    const { music } = rig({ open: async () => null });
    await expect(music.setStop("mars")).resolves.toBe(false);
    expect(music.trackId).toBeNull();
    expect(music.sourceKind).toBe("silent");
    // And the rest of the bus still works: the game runs, it is just quiet.
    expect(music.setFromState(9, 0)).toBe(2);
    run(music, 200);
    expect(music.index).toBe(2);
  });

  it("a fetch that REJECTS is caught, not propagated", async () => {
    const { music } = rig({
      open: async () => {
        throw new Error("network");
      },
    });
    await expect(music.setStop("mars")).resolves.toBe(false);
    expect(music.sourceKind).toBe("silent");
  });

  it("bytes that will not decode are caught too", async () => {
    const { music } = rig({
      decode: async () => {
        throw new Error("EncodingError");
      },
    });
    await expect(music.setStop("mars")).resolves.toBe(false);
    expect(music.sourceKind).toBe("silent");
  });

  it("a stop with no shipped track is not fetched at all", async () => {
    const { music, opened } = rig({ ids: ["earth"] });
    await expect(music.setStop("pluto")).resolves.toBe(false);
    expect(opened).toEqual([]);
    expect(music.sourceKind).toBe("silent");
  });

  it("a track that disappears mid-route fades the last one out rather than sticking", async () => {
    let fail = false;
    const { ctx, music } = rig({ open: async () => (fail ? null : new ArrayBuffer(8)) });
    await music.setStop("earth");
    run(music, 200);
    expect(music.sourceKind).toBe("track");

    fail = true;
    await music.setStop("mars");
    run(music, 200);
    // Earth's piece belongs to Earth. A failed fetch leaves the belt quiet, it
    // does not leave the last planet's music playing over the new one.
    expect(music.sourceKind).toBe("silent");
    expect(music.trackId).toBeNull();
    expect(trackGains(ctx).every((g) => g === 0)).toBe(true);
    expect(ctx.created.filter((n) => n.kind === "bufferSource" && n.stopped).length).toBe(1);
  });

  it("no catalog at all means the SYNTHESISED layers, which is a different thing", () => {
    const ctx = new NullAudioContext(SR);
    const music = new MusicBus(ctx, ctx.createGain());
    expect(music.sourceKind).toBe("synth");
    expect(music.trackIds()).toEqual([]);
    // The oscillator stack is still there; a build with no files is not silent.
    expect(ctx.created.filter((n) => n.kind === "oscillator").length).toBeGreaterThan(0);
  });

  it("a context that cannot decode falls back to the synthesised layers", () => {
    const ctx = new NullAudioContext(SR);
    // NullAudioContext has no `decodeAudioData`, and no decoder was injected.
    const music = new MusicBus(ctx, ctx.createGain(), {
      tracks: { ids: () => ["earth"], open: async () => new ArrayBuffer(8) },
    });
    expect(music.sourceKind).toBe("synth");
    expect(ctx.created.filter((n) => n.kind === "oscillator").length).toBeGreaterThan(0);
  });
});

describe("E-MUSIC-1: one piece gives way to the next without a step", () => {
  it("crossfades between two stops and retires the old source", async () => {
    const { ctx, music } = rig();
    await music.setStop("earth");
    run(music, 200);
    await music.setStop("jupiter");

    expect(music.swapping).toBe(true);
    run(music, 20); // mid-fade
    const mid = trackGains(ctx);
    expect(mid.filter((g) => g > 0).length).toBe(2);

    run(music, 200);
    expect(music.swapping).toBe(false);
    expect(music.trackId).toBe("jupiter");
    const sources = ctx.created.filter((n) => n.kind === "bufferSource");
    expect(sources.length).toBe(2);
    expect(sources[0]!.stopped).toBe(true);
    expect(sources[1]!.stopped).toBe(false);
  });

  it("holds equal power across the swap, so the music never dips", async () => {
    const { ctx, music } = rig();
    await music.setStop("earth");
    run(music, 200);
    await music.setStop("mars");
    for (let f = 0; f < 80; f++) {
      music.advance(FRAME_MS);
      const power = trackGains(ctx).reduce((sum, g) => sum + g * g, 0);
      expect(power).toBeCloseTo(1, 6);
    }
  });

  it("UR-10 DISCIPLINE: interrupting a swap does not step a piece's level", async () => {
    // The same rule the layer crossfade learned the hard way. The bar is the
    // swap's OWN largest per-frame move, measured here rather than written
    // down: a level that never moves faster than its own smooth fade cannot
    // click. There is nothing to loosen.
    const measure = async (interrupt: boolean): Promise<number> => {
      const { ctx, music } = rig();
      await music.setStop("earth");
      run(music, 200);
      await music.setStop("mars");
      let prev = trackGains(ctx);
      let worst = 0;
      for (let f = 0; f < 120; f++) {
        if (interrupt && f === 30) await music.setStop("saturn");
        music.advance(FRAME_MS);
        const now = trackGains(ctx);
        for (let i = 0; i < now.length; i++) {
          worst = Math.max(worst, Math.abs((now[i] ?? 0) - (prev[i] ?? 0)));
        }
        prev = now;
      }
      return worst;
    };
    const bar = await measure(false);
    expect(await measure(true)).toBeLessThanOrEqual(bar);
  });

  it("a stop asked for while another is loading does not start the stale one", async () => {
    const ctx = new NullAudioContext(SR);
    const opened: string[] = [];
    let releaseEarth: (() => void) | null = null;
    const music = new MusicBus(ctx, ctx.createGain(), {
      tracks: {
        ids: () => ["earth", "mars"],
        open: async (id) => {
          opened.push(id);
          if (id === "earth") await new Promise<void>((r) => (releaseEarth = r));
          return new ArrayBuffer(8);
        },
      },
      decode: async () => decodedTone(ctx, 220),
      loop: { crossfadeMs: 40 },
    });

    const slow = music.setStop("earth");
    const fast = music.setStop("mars");
    await fast;
    expect(music.trackId).toBe("mars");

    (releaseEarth as unknown as () => void)();
    await expect(slow).resolves.toBe(false);
    // Earth arrived late and must NOT have started over the top of Mars.
    expect(music.trackId).toBe("mars");
    expect(ctx.labelledWith("music.source.earth").length).toBe(0);
    expect(opened).toEqual(["earth", "mars"]);
  });

  it("the swap crossfade is a real length, not an instant cut", () => {
    expect(TRACK_CROSSFADE_MS).toBeGreaterThan(500);
  });
});

describe("E-MUSIC-1: the files are imported, so the bundler emits them", () => {
  // THE FAILURE THIS PREVENTS. Vite emits an asset only if something imports
  // it. `dist/` contained zero mp3 for the VOICE clips until a `?url` glob was
  // added; a feature that looks wired and is inert has already happened twice
  // on this project. A unit test cannot run `vite build`, but it can pin the
  // two halves that have to agree: the glob pattern, and the directory the
  // render script writes to.
  const MUSIC_DIR = resolve(REPO, "src/content/audio/music");

  it("the glob in index.ts points at the directory render-music.mjs writes to", () => {
    const source = readFileSync(resolve(REPO, "src/game/audio/index.ts"), "utf8");
    expect(source).toContain('import.meta.glob("../../content/audio/music/*.mp3"');
    expect(source).toContain('query: "?url"');
    // Relative to src/game/audio, that IS src/content/audio/music.
    expect(resolve(REPO, "src/game/audio", "../../content/audio/music")).toBe(MUSIC_DIR);

    const script = readFileSync(resolve(REPO, "scripts/render-music.mjs"), "utf8");
    expect(script).toContain('join(REPO, "src/content/audio/music")');
  });

  it("one composed piece is on disk for every stop", () => {
    const files = readdirSync(MUSIC_DIR).filter((f) => f.endsWith(".mp3"));
    expect(files.sort()).toEqual(STOP_IDS.map((id) => `${id}.mp3`).sort());
  });

  it("and the manifest agrees with what is on disk", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(resolve(MUSIC_DIR, "manifest.json"), "utf8"),
    );
    expect(manifestMusicStops(manifest).sort()).toEqual([...STOP_IDS].sort());
  });
});

describe("E-MUSIC-1: the browser catalog", () => {
  const urls = Object.fromEntries(
    STOP_IDS.map((id) => [`../../content/audio/music/${id}.mp3`, `/assets/${id}-abc123.mp3`]),
  );
  const ok = (body: ArrayBuffer): { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> } => ({
    ok: true,
    arrayBuffer: async () => body,
  });

  it("offers exactly the stops that are in BOTH the glob and the manifest", () => {
    const catalog = browserMusicTracks({ fetch: async () => ok(new ArrayBuffer(4)) }, urls, [
      "earth",
      "mars",
    ]);
    expect(catalog?.ids()).toEqual(["earth", "mars"]);
  });

  it("an empty manifest means 'none shipped', not 'nothing rendered'", () => {
    const catalog = browserMusicTracks({ fetch: async () => ok(new ArrayBuffer(4)) }, urls, []);
    expect(catalog?.ids()).toEqual([...STOP_IDS].sort());
  });

  it("fetches the hashed URL the bundler produced", async () => {
    const asked: string[] = [];
    const catalog = browserMusicTracks(
      {
        fetch: async (url: string) => {
          asked.push(url);
          return ok(new ArrayBuffer(16));
        },
      },
      urls,
      ["neptune"],
    );
    const bytes = await catalog?.open("neptune");
    expect(asked).toEqual(["/assets/neptune-abc123.mp3"]);
    expect(bytes?.byteLength).toBe(16);
  });

  it("a 404 is null, not an exception", async () => {
    const catalog = browserMusicTracks(
      { fetch: async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) },
      urls,
      ["pluto"],
    );
    await expect(catalog?.open("pluto")).resolves.toBeNull();
  });

  it("a fetch that throws is null, not an exception", async () => {
    const catalog = browserMusicTracks(
      {
        fetch: async () => {
          throw new Error("offline");
        },
      },
      urls,
      ["pluto"],
    );
    await expect(catalog?.open("pluto")).resolves.toBeNull();
  });

  it("a stop the catalog does not have is null", async () => {
    const catalog = browserMusicTracks({ fetch: async () => ok(new ArrayBuffer(4)) }, urls, [
      "earth",
    ]);
    await expect(catalog?.open("pluto")).resolves.toBeNull();
  });

  it("no fetch, or no files, means no catalog at all", () => {
    expect(browserMusicTracks({}, urls, ["earth"])).toBeNull();
    expect(browserMusicTracks(null, urls, ["earth"])).toBeNull();
    expect(browserMusicTracks({ fetch: async () => ok(new ArrayBuffer(4)) }, {}, ["earth"])).toBeNull();
  });

  it("reads stop ids out of a real manifest shape and shrugs at a broken one", () => {
    expect(manifestMusicStops({ tracks: [{ stopId: "earth" }, { stopId: "mars" }] })).toEqual([
      "earth",
      "mars",
    ]);
    expect(manifestMusicStops(null)).toEqual([]);
    expect(manifestMusicStops({})).toEqual([]);
    expect(manifestMusicStops({ tracks: "no" })).toEqual([]);
    expect(manifestMusicStops({ tracks: [null, 3, { stopId: 7 }, { stopId: "pluto" }] })).toEqual([
      "pluto",
    ]);
  });
});
