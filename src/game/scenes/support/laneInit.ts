import type Phaser from "phaser";
import { isStopId, type StopId } from "@engine/types";
import type { SceneContext } from "@game/sceneKeys";
import { paletteAt, type StopPalette } from "@game/render/palette";
import { services, type GameServices } from "@game/boot";
import { resolveInit, type ResolvedInit, type StoryInit } from "../lib/init";
import { createLaneText, type LaneText } from "./copy";

/**
 * One start-up path for the four screens in this lane.
 *
 * `resolveInit` already turns a `StoryInit` into defaults that let a scene boot
 * standalone. This adds the three things all four of these screens also need
 * and nobody else has to: the boot-time service bundle when it exists, the
 * stop palette (honouring the colourblind flag, D41), and this lane's copy
 * overlay.
 *
 * WHY IT READS THE URL. `boot.ts` starts `?scene=Warp` with no data, so a
 * screen opened directly by the e2e suite has no stop, no play date and no
 * fixture. Boot reads the URL for exactly the same reason. Everything read
 * here is a presentation knob or a test seam; nothing that affects a rule.
 */

export interface LaneInit extends ResolvedInit {
  readonly services: GameServices | null;
  readonly palette: StopPalette;
  readonly reducedMotion: boolean;
  /** This lane's copy, layered over the shared resolver. */
  readonly copy: LaneText;
  readonly params: URLSearchParams;
}

function tryServices(scene: Phaser.Scene): GameServices | null {
  try {
    return services(scene);
  } catch {
    // A scene booted standalone in a harness has no service bundle. That is a
    // supported way to run a screen, not an error.
    return null;
  }
}

function urlParams(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

export function laneInit(
  scene: Phaser.Scene,
  data: StoryInit | undefined,
  fallbackStop: StopId,
): LaneInit {
  const svc = tryServices(scene);
  const params = urlParams();

  const fromUrl = params.get("stop");
  const urlStop = fromUrl !== null && isStopId(fromUrl) ? fromUrl : null;

  const ctx: SceneContext | undefined = data?.ctx ?? svc?.context;
  const merged: StoryInit = {
    ...data,
    ...(ctx === undefined ? {} : { ctx }),
    ...(data?.lang === undefined && svc ? { lang: svc.t.lang } : {}),
    ...(data?.shipName === undefined && svc?.store.activeProfile()
      ? { shipName: svc.store.activeProfile()?.shipName }
      : {}),
    ...(data?.stopId === undefined && urlStop !== null ? { stopId: urlStop } : {}),
    ...(data?.progress === undefined && svc?.store.activeProfile()
      ? { progress: svc.store.activeProfile()?.progress }
      : {}),
  };

  const resolved = resolveInit(merged, fallbackStop);
  const reducedMotion = resolved.ctx.reducedMotion;

  return {
    ...resolved,
    services: svc,
    palette: paletteAt(resolved.stopId, resolved.ctx.colorblindPalette),
    reducedMotion,
    copy: createLaneText({ lang: resolved.lang, shipName: resolved.shipName }),
    params,
  };
}

/**
 * Every visible string with the colour it is drawn in.
 *
 * `visibleText` answers "what does the screen say"; AC-22b.1 and D74 also need
 * "and what colour is it in", because "no red failure state" is a claim about
 * ink, not about words. The e2e reads this and asserts no rendered text is in a
 * red-dominant colour anywhere on these four screens.
 */
export function textStyles(
  scene: Phaser.Scene,
): { text: string; color: string; alpha: number }[] {
  const out: { text: string; color: string; alpha: number }[] = [];
  const walk = (objects: Phaser.GameObjects.GameObject[]): void => {
    for (const obj of objects) {
      const container = obj as Phaser.GameObjects.Container;
      if (Array.isArray(container.list)) {
        walk(container.list);
        continue;
      }
      const text = obj as Phaser.GameObjects.Text;
      if (typeof text.text === "string" && text.style !== undefined) {
        if (text.visible && text.alpha > 0.02) {
          out.push({
            text: text.text,
            color: String(text.style.color ?? ""),
            alpha: text.alpha,
          });
        }
      }
    }
  };
  walk(scene.children.list);
  return out;
}

/** The e2e debug bag boot publishes. Scenes add one entry each. */
export function publishBag(name: string, value: Record<string, unknown>): void {
  const bag = (window as unknown as Record<string, Record<string, unknown>>)["__kb"];
  if (bag === undefined) return;
  bag[name] = value;
}
