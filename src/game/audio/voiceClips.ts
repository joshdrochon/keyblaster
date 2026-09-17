/**
 * Shadow's PRE-RENDERED voice, played through the game's own audio graph
 * (D63, D88, architecture section 6).
 *
 * ================== WHAT THIS BUYS THAT WEB SPEECH CANNOT ==================
 * `webSpeechTransport` has a long, honest comment explaining why it cannot fade
 * out: the browser renders the utterance straight to the output device, there is
 * no `GainNode` between Shadow and the speakers, and the best a graceful
 * interrupt can do is stop on a word boundary.
 *
 * A rendered file has none of that problem. It is routed
 *
 *     <audio> -> MediaElementSource -> clip gain -> voice bus -> master
 *
 * so it is inside the graph like every other sound in the game. Three things
 * follow, and all three are what the brief asked for:
 *
 *   1. the AC-21.4 music duck applies, because the voice bus is the sidechain
 *      trigger and this clip is ON that bus;
 *   2. the master fader and the settings volumes apply, because the path runs
 *      through `bus.master`;
 *   3. an interrupt is a REAL EASE-OUT - `fadeOut` schedules an exponential
 *      ramp on the clip gain, which is a fade a listener hears as a fade.
 *
 * ================== NO DOM TYPE CROSSES THIS FILE ==================
 * `VoiceMediaElement` is our own four-member interface, not `HTMLAudioElement`,
 * for exactly the reason `SpeechPort` is not `SpeechSynthesis`: a fake is a
 * dozen lines, this module is unit-testable in Node, and the one place that
 * knows what an `<audio>` element is stays `index.ts`.
 *
 * ================== NOTHING HERE FETCHES ==================
 * AC-21.5 forbids runtime network TTS, and this file does no network I/O of any
 * kind: it is handed a catalog that already knows how to open a clip, and the
 * bytes are a static asset the bundler emitted at build time. The renders were
 * produced by `scripts/render-voice.mjs` before the build, which is the whole
 * point of D63.
 */

import { clamp, type AudioContextLike, type AudioNodeLike, type GainNodeLike } from "./context.js";
import { label } from "./nullContext.js";
import type { CancelTimer, Scheduler, VoiceClipHandle, VoiceClipPlayer } from "./voice.js";

/**
 * The slice of a media element a clip needs. Deliberately OURS.
 *
 * `play()` may return a promise that REJECTS - that is how a browser reports
 * "you tried to make noise before the player touched anything" - so the return
 * type is wide enough to notice.
 */
export interface VoiceMediaElement {
  /**
   * The object the AUDIO CONTEXT has to be handed to route this clip.
   *
   * It is separate from the element itself because a real
   * `createMediaElementSource` accepts nothing but a genuine
   * `HTMLMediaElement` - hand it the adapter that wraps one and it throws,
   * the clip path silently returns null, and every line falls back to Web
   * Speech while looking perfectly wired. That is exactly what happened, and
   * `tests/e2e/shadow-clips.spec.ts` is what caught it, because it is the only
   * test that runs against a live AudioContext.
   *
   * For the browser adapter this is the `<audio>` element. For a fake it is
   * whatever the fake context will accept, usually the fake itself.
   */
  readonly source: unknown;
  play(): unknown;
  pause(): void;
  currentTime: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Which lines were rendered, and how to open one. Built by `index.ts`. */
export interface VoiceClipCatalog {
  /** Every rendered line id. Sorted, so a test can print a stable diff. */
  ids(): readonly string[];
  /** A fresh element for this id, or null when there is no such render. */
  open(id: string): VoiceMediaElement | null;
}

/**
 * The floor an exponential ramp may reach. `exponentialRampToValueAtTime`
 * cannot target zero - the curve is `a * (b/a)^t` and a `b` of zero has no
 * logarithm - so the fade lands here and the gain is then set flat to silence.
 * -80 dB is below the noise floor of any playback chain a child will use.
 */
export const FADE_FLOOR_GAIN = 0.0001;

/** One opened clip: the element, its source node, and the gain we fade. */
interface OpenClip {
  readonly element: VoiceMediaElement;
  readonly gain: GainNodeLike;
  /** Detaches the element listeners installed for the play in flight. */
  release: () => void;
}

/**
 * Build the player, or return null when this context cannot route a media
 * element at all.
 *
 * NULL IS A SUPPORTED ANSWER and it is the reason a build that ships rendered
 * files still runs on a machine that cannot play them: `graph.ts` simply does
 * not put `clips` in the voice environment, `adaptiveTransport` never consults
 * a clip path that is not there, and every line goes to the platform voice
 * exactly as it did before the files existed.
 */
export function createVoiceClipPlayer(
  ctx: AudioContextLike,
  destination: AudioNodeLike,
  catalog: VoiceClipCatalog,
  schedule: Scheduler,
): VoiceClipPlayer | null {
  const createSource = ctx.createMediaElementSource;
  if (typeof createSource !== "function") return null;

  /**
   * Opened clips, by id.
   *
   * A media element may be handed to `createMediaElementSource` ONCE - a second
   * call on the same element throws in every browser - so the element, its
   * source node and its gain are created together and kept. Caching them also
   * means the second time a stop is visited its lines start instantly instead
   * of re-opening the file.
   *
   * There is no eviction, and there does not need to be: the catalog is 28
   * entries and a session visits at most a handful.
   */
  const open = new Map<string, OpenClip>();

  const clipFor = (id: string): OpenClip | null => {
    const cached = open.get(id);
    if (cached !== undefined) return cached;
    const element = catalog.open(id);
    if (element === null) return null;
    let source: AudioNodeLike;
    try {
      source = createSource.call(ctx, element.source);
    } catch {
      // A context that has a method but refuses this element. Quieter game,
      // never a thrown error out of a scene's keystroke handler.
      return null;
    }
    const gain = label(ctx.createGain(), `voice.clip.${id}`);
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(destination);
    const clip: OpenClip = { element, gain, release: () => undefined };
    open.set(id, clip);
    return clip;
  };

  return {
    has: (id: string): boolean => catalog.ids().includes(id),

    play(id, callbacks): VoiceClipHandle | null {
      const clip = clipFor(id);
      if (clip === null) return null;

      // Whatever this clip was doing before, it is not doing it now.
      clip.release();

      let settled = false;
      /** Set once the element has reported that sound is actually coming out. */
      let sounded = false;
      let cancelFade: CancelTimer | null = null;

      const detach = (): void => {
        clip.element.removeEventListener("ended", onEnded);
        clip.element.removeEventListener("error", onError);
        clip.element.removeEventListener("playing", onPlaying);
        clip.release = (): void => undefined;
      };

      /** Report exactly one outcome, exactly once, and stop listening. */
      const settle = (outcome: "end" | "fail"): void => {
        if (settled) return;
        settled = true;
        detach();
        if (outcome === "end") callbacks.onEnd();
        else callbacks.onFail();
      };

      function onEnded(): void {
        settle("end");
      }
      function onPlaying(): void {
        sounded = true;
      }
      function onError(): void {
        // A file that never made a sound is a MISS, and a miss must degrade to
        // the platform voice rather than swallow the line. A file that broke
        // half way through already said most of itself, so it ends.
        settle(sounded ? "end" : "fail");
      }

      clip.element.addEventListener("ended", onEnded);
      clip.element.addEventListener("error", onError);
      clip.element.addEventListener("playing", onPlaying);
      clip.release = (): void => {
        if (cancelFade) cancelFade();
        cancelFade = null;
        detach();
        settled = true;
      };

      const now = ctx.currentTime;
      clip.gain.gain.cancelScheduledValues(now);
      clip.gain.gain.setValueAtTime(1, now);
      clip.gain.gain.value = 1;
      try {
        clip.element.currentTime = 0;
      } catch {
        // Some elements refuse a seek before metadata has loaded. Playing from
        // wherever it is beats not playing.
      }

      let refused = false;
      try {
        const started = clip.element.play();
        if (isThenable(started)) {
          started.then(
            () => undefined,
            () => {
              // The browser refused playback (no user gesture yet). Nothing was
              // heard, so this is a miss and the line goes to Web Speech.
              settle("fail");
            },
          );
        }
      } catch {
        refused = true;
      }
      if (refused) {
        settle("fail");
        return null;
      }

      const hardStop = (): void => {
        try {
          clip.element.pause();
        } catch {
          // An element that will not pause has already stopped.
        }
        const at = ctx.currentTime;
        clip.gain.gain.cancelScheduledValues(at);
        clip.gain.gain.setValueAtTime(0, at);
        clip.gain.gain.value = 0;
      };

      return {
        fadeOut(ms, done): void {
          if (settled) {
            done();
            return;
          }
          // The outcome is decided HERE: the bus has moved on, so the eventual
          // `ended` from this element must not reach anybody.
          settled = true;
          detach();

          const start = ctx.currentTime;
          const level = Math.max(clip.gain.gain.value, FADE_FLOOR_GAIN);
          const seconds = Math.max(clamp(ms, 0, 5000), 1) / 1000;
          clip.gain.gain.cancelScheduledValues(start);
          clip.gain.gain.setValueAtTime(level, start);
          // Exponential, not linear (see the header on `VoiceClipHandle`).
          clip.gain.gain.exponentialRampToValueAtTime(FADE_FLOOR_GAIN, start + seconds);

          cancelFade = schedule(() => {
            cancelFade = null;
            hardStop();
            done();
          }, ms);
        },
        stop(): void {
          if (cancelFade) cancelFade();
          cancelFade = null;
          settled = true;
          detach();
          hardStop();
        },
      };
    },
  };
}

function isThenable(value: unknown): value is { then(a: () => void, b: () => void): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
