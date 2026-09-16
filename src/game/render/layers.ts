/**
 * The parallax layer stack (art-direction.md section 2, D60 rubric item 1).
 *
 * Five distinct speeds is a HARD check (AC-22.1). The speeds below are the
 * doc's own numbers; they are the rubric, so changing one is an art-direction
 * edit, not a code edit.
 *
 * Depth here is built from value steps between layers, not from drawn shadows:
 * a flat silhouette at a distinct speed reads as distance, and it costs one
 * draw call (AC-22.9 - the effects budget is layers and gradients, never
 * post-processing).
 *
 * ---------------------------------------------------------------------------
 * L6.5 `foreVeil` IS AN ADDITION TO THE DOC'S TABLE, and here is why.
 *
 * Art-direction section 2 lists eight layers and every one of them is BEHIND
 * the ship: L5 nearField runs at 1.30, faster than anything else in the world,
 * and still draws behind L6 shipFx. The consequence is that the Lantern reads
 * as pasted on top of a moving picture rather than as being inside the scene -
 * nothing in the game has ever passed in FRONT of it.
 *
 * `foreVeil` is that slot: the stop's own atmosphere (Mars dust, Neptune's
 * methane clouds, Pluto's haze layers - see `tiles.ts`, VEIL_BY_STOP) and its
 * nearest, darkest silhouettes, crossing in front of the ship at 1.80. It sits
 * under the HUD at L7, which is absolute: nothing ever veils a readout.
 *
 * It raises AC-22.1's distinct-speed count from five to six, which is the
 * direction of travel rather than a problem - the AC is a floor.
 */

export type LayerId =
  | "sky"
  | "celestial"
  | "farField"
  | "midField"
  | "debris"
  | "nearField"
  | "shipFx"
  | "foreVeil"
  | "hud";

export interface LayerSpec {
  readonly id: LayerId;
  /** Scroll speed as a multiple of world speed (art-direction section 2). */
  readonly speed: number;
  /** Phaser depth; back to front. */
  readonly depth: number;
  /** True if the layer drifts even when the world is not scrolling (rubric 2). */
  readonly idleDrift: boolean;
  readonly note: string;
}

export const LAYERS: readonly LayerSpec[] = [
  { id: "sky",        speed: 0.00, depth: 0, idleDrift: false, note: "vertical gradient, shifts across the stage (rubric 3)" },
  { id: "celestial",  speed: 0.05, depth: 1, idleDrift: false, note: "the stop's planet, large and partially framed, soft radial glow" },
  { id: "farField",   speed: 0.15, depth: 2, idleDrift: false, note: "distant silhouette band, one flat palette colour" },
  { id: "midField",   speed: 0.35, depth: 3, idleDrift: true,  note: "second silhouette band plus drifting dust shapes" },
  { id: "debris",     speed: 1.00, depth: 4, idleDrift: false, note: "the rocks and their word plates; fall speed per D19" },
  { id: "nearField",  speed: 1.30, depth: 5, idleDrift: true,  note: "foreground motes and glints, blurred by size not filter" },
  { id: "shipFx",     speed: 1.00, depth: 6, idleDrift: true,  note: "the Lantern, beam, blast and strike; camera micro-sway" },
  { id: "foreVeil",   speed: 1.80, depth: 6.5, idleDrift: true, note: "the only world layer IN FRONT of the ship: the stop's own veil and its nearest silhouettes" },
  { id: "hud",        speed: 0.00, depth: 7, idleDrift: false, note: "own contrast plate, never over debris" },
];

/** Layers that actually scroll, i.e. the ones AC-22.1 counts. */
export const SCROLLING_LAYERS = LAYERS.filter((l) => l.speed > 0);

/** AC-22.1: at least five scrolling layers, all at distinct speeds. */
export function distinctSpeedCount(): number {
  return new Set(SCROLLING_LAYERS.map((l) => l.speed)).size;
}

export function layer(id: LayerId): LayerSpec {
  const found = LAYERS.find((l) => l.id === id);
  if (!found) throw new Error(`unknown layer: ${id}`);
  return found;
}

/**
 * Camera micro-sway (art-direction section 2): +/-2 px on a 6 s sine.
 * Returns 0 when reduced motion is on (D41, AC-19.3) - gameplay motion is
 * kept, framing motion is not.
 */
export function cameraSwayPx(elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.sin((elapsedMs / 6000) * Math.PI * 2) * 2;
}

/** Idle drift offset for a layer, so no frame is ever identical (rubric 2). */
export function idleDriftPx(spec: LayerSpec, elapsedMs: number, reducedMotion: boolean): number {
  if (!spec.idleDrift) return 0;
  // Drift continues under reduced motion: D41 removes shake and sway, not the
  // world being alive. A frozen starfield reads as a broken game, not a calm one.
  const period = reducedMotion ? 24000 : 12000;
  return Math.sin((elapsedMs / period) * Math.PI * 2) * (spec.speed * 6);
}
