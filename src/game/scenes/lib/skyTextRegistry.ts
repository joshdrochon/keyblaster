import type { TextSample } from "@engine/contrast/index.js";

/**
 * WHERE A SCENE'S SKY-BORNE TEXT IS RECORDED (AC-22.8).
 *
 * Every headline drawn over the world registers the ink and the plate behind
 * it; `snapshot()` publishes the list, `scripts/capture-screens.mjs` reads it
 * back off the frame it screenshots, and the rubric measures it. That is what
 * replaced a contrast check whose entire scope was one word plate.
 *
 * IT LIVES IN ITS OWN FILE, AWAY FROM PHASER, for one reason: the thing most
 * likely to go wrong here is the LIFETIME, not the drawing. A Phaser scene
 * object is REUSED across `scene.restart()`, so a registry keyed by scene that
 * never cleared would hand the capture the rows from every mount since boot -
 * the Director map alone is restarted three times in one capture run, and the
 * evidence file would have carried triplicates and called it coverage. A
 * registry that can be unit-tested is a registry whose clearing is checked.
 *
 * The scene is taken as the narrowest shape that does the job, so nothing here
 * needs a browser to test.
 */
export interface SceneLike {
  readonly events: {
    once(event: string, fn: () => void): unknown;
  };
}

/** Phaser's `Phaser.Scenes.Events.SHUTDOWN`, named here so this file is Phaser-free. */
export const SHUTDOWN = "shutdown";

const REGISTRY = new WeakMap<object, TextSample[]>();

/**
 * This scene's row list, created on first use.
 *
 * Creating it also arms a one-shot SHUTDOWN listener that drops the list.
 * `once` rather than `on`, and the entry is deleted rather than emptied, so the
 * next mount creates a fresh list and arms exactly one fresh listener: a
 * scene restarted forty times ends with one row set and one listener, not
 * forty of each.
 */
function rowsFor(scene: SceneLike): TextSample[] {
  const existing = REGISTRY.get(scene);
  if (existing !== undefined) return existing;
  const rows: TextSample[] = [];
  REGISTRY.set(scene, rows);
  scene.events.once(SHUTDOWN, () => REGISTRY.delete(scene));
  return rows;
}

/** Record one colour pair. */
export function recordSkyText(scene: SceneLike, sample: TextSample): void {
  rowsFor(scene).push(sample);
}

/** Every colour pair this mount has drawn over the sky. */
export function skyTextSamples(scene: SceneLike): readonly TextSample[] {
  return REGISTRY.get(scene) ?? [];
}

/** Drop this scene's rows. Exported for the tests and for an explicit rebuild. */
export function clearSkyText(scene: SceneLike): void {
  REGISTRY.delete(scene);
}
