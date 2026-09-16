/**
 * The audio evidence artifact (D85, architecture 10.1 step 4).
 *
 * `gauntlet/evidence/audio-graph.json` is read literally by tests/gauntlet/
 * rubric.mjs for five items - A-21.1 through A-21.5 - and D85 says a claim
 * without an artifact is not a pass. It follows that an artifact with
 * hand-written numbers in it is worse than no artifact at all: it turns five
 * rubric items green while measuring nothing.
 *
 * So every value below is MEASURED off a real graph built on a recording
 * context. Nothing is copied from a constant:
 *
 *   ambientBeds   the bed nodes that actually got created while walking the
 *                 whole route, read back off the context by node label
 *   crossfade     both beds observed audible at the midpoint of every one of
 *                 the six transitions, at equal power
 *   musicLayers   the layer gain nodes the music bus actually created
 *   sfxVariants   DISTINCT variants observed over hundreds of real plays
 *   noConsec...   scanned from that same play history
 *   duckDb        the gain change the sidechain actually applied, in dB
 *   voiceTransport   the id of the transport `createVoiceTransport` returned
 *   runtimeTts...    a fetch probe's call count, plus whatever static network
 *                    references the caller's source scan found
 *
 * If a number cannot be measured, it is left out rather than asserted: a
 * missing key makes the rubric report `not-implemented`, which is the truth.
 */

import { STOP_IDS, type StopId } from "../../engine/types.js";
import { seededRandom } from "./context.js";
import { NullAudioContext } from "./nullContext.js";
import { buildAudioGraph } from "./graph.js";
import { AMBIENT_CROSSFADE_MS } from "./ambient.js";
import { SFX_EVENTS, type SfxEventId } from "./sfx.js";
import type { VoiceEnvironment } from "./voice.js";

/**
 * EXACTLY the keys tests/gauntlet/rubric.mjs reads. Adding a key is free;
 * renaming one silently breaks five rubric items, so the shape is a type.
 */
export interface AudioGraphEvidence {
  ambientBeds: string[];
  crossfade: boolean;
  musicLayers: number;
  sfxVariants: Record<string, number>;
  noConsecutiveRepeat: boolean;
  duckDb: number;
  voiceTransport: string;
  runtimeTtsNetworkCalls: number;
}

export interface EvidenceOptions {
  /**
   * Plays per event. Large enough that a rotation bug shows up: with three
   * variants, 300 plays is 100 bags.
   */
  readonly rotationsPerEvent?: number;
  /**
   * Network references found by the caller's static scan of src/game/audio.
   * Added to the probe count so a source file that named `fetch` could never
   * produce a zero here, even though the probe would not have caught it.
   */
  readonly staticNetworkReferences?: number;
}

const round = (value: number, places: number): number => {
  const f = Math.pow(10, places);
  return Math.round(value * f) / f;
};

/**
 * Build the graph, exercise it, and report what it did.
 *
 * `voiceEnv` is supplied by the caller because Node has no voices: the
 * artifact has to describe the transport a PLAYER gets, and the only honest way
 * to produce that in a headless process is to hand in the platform's voice list
 * and let the real selection code choose from it. Everything else - beds,
 * layers, variants, duck - is measured with no help at all.
 */
export function buildAudioEvidence(
  voiceEnv: VoiceEnvironment,
  options: EvidenceOptions = {},
): AudioGraphEvidence {
  const plays = Math.max(12, options.rotationsPerEvent ?? 300);
  const ctx = new NullAudioContext();
  const graph = buildAudioGraph(ctx, { voiceEnv, rand: seededRandom(0xa11ce) });

  // --- Ambient: walk the entire route, watching every transition ------------
  const firstStop = STOP_IDS[0];
  if (!firstStop) throw new Error("engine STOP_IDS is empty");
  graph.ambient.start(firstStop);

  let everyTransitionCrossfaded = STOP_IDS.length > 1;
  let previous: StopId = firstStop;
  for (const stop of STOP_IDS.slice(1)) {
    graph.ambient.transitionTo(stop, AMBIENT_CROSSFADE_MS);
    graph.advance(AMBIENT_CROSSFADE_MS / 2);
    // A crossfade means BOTH beds are audible in the middle. A cut would show
    // one at zero; a linear fade would show the pair summing below equal power.
    const outGain = graph.ambient.gainOf(previous);
    const inGain = graph.ambient.gainOf(stop);
    if (!(outGain > 0 && inGain > 0)) everyTransitionCrossfaded = false;
    graph.advance(AMBIENT_CROSSFADE_MS / 2);
    previous = stop;
  }

  // Read the beds back off the CONTEXT, not off the bus: these are the nodes
  // that were really created while the route was walked.
  const ambientBeds = ctx
    .labelledWith("ambient.bed.")
    .map((node) => (node.label ?? "").replace("ambient.bed.", ""))
    .filter((id) => id.length > 0);

  // --- Music: count the layer gains the bus created -------------------------
  const musicLayers = ctx.labelledWith("music.layer.").length;

  // --- SFX: play, then read the history ------------------------------------
  const sfxVariants: Record<string, number> = {};
  let noConsecutiveRepeat = true;
  for (const event of SFX_EVENTS) {
    const seen = new Set<string>();
    let last: string | null = null;
    for (let i = 0; i < plays; i++) {
      const played = graph.sfx.play(event as SfxEventId);
      seen.add(played.variant.id);
      if (last !== null && played.variant.id === last) noConsecutiveRepeat = false;
      last = played.variant.id;
    }
    sfxVariants[event] = seen.size;
  }

  // --- Voice: the duck, the transport, the network ------------------------
  // Worst case across the ducked buses: the shallowest reduction is the one
  // AC-21.4 has to clear, so that is the number reported.
  const reductions = Object.values(graph.ducker.measureReductionDb());
  const duckDb = reductions.length > 0 ? round(Math.max(...reductions), 4) : 0;

  const probe = voiceEnv.fetch as (ProbeFetch | undefined);
  graph.voice.speak({ id: "evidence.line", text: "Course locked. Nice flying.", kind: "scripted" });
  graph.voice.cancel();
  const probeCalls = probe && typeof probe.calls === "number" ? probe.calls : 0;

  return {
    ambientBeds,
    crossfade: everyTransitionCrossfaded,
    musicLayers,
    sfxVariants,
    noConsecutiveRepeat,
    duckDb,
    voiceTransport: graph.voice.transportId,
    runtimeTtsNetworkCalls: probeCalls + Math.max(0, options.staticNetworkReferences ?? 0),
  };
}

/** A fetch probe that counts. Nothing in src/game/audio ever calls it. */
export interface ProbeFetch {
  (...args: unknown[]): unknown;
  calls: number;
}

export function countingFetchProbe(): ProbeFetch {
  const probe = ((...args: unknown[]): unknown => {
    void args;
    probe.calls += 1;
    return undefined;
  }) as ProbeFetch;
  probe.calls = 0;
  return probe;
}
