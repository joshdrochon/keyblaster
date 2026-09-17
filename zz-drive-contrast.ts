import { paletteAt, PALETTE_STOP_IDS, skyStops, skyStopsLate } from "@game/render/palette";
import { measureText, contrastRatio, compositeOver, WORST_CASE_SKY } from "@engine/contrast/index.js";
import { INK, SKY_PLATE } from "@game/ui/theme";

const rows: any[] = [];
function add(stop: string, cb: boolean, pair: string, color: string, plateFill: string | null, plateAlpha: number, behind: string, behindName: string) {
  const r = measureText({ screen: stop, id: pair, color, plateFill, plateAlpha, behind });
  rows.push({ stop, cb, pair, color, plateFill, plateAlpha, behind: behindName, backdrop: r.backdrop, ratio: r.ratio });
}

for (const stop of PALETTE_STOP_IDS) {
  for (const cb of [false, true]) {
    const p = paletteAt(stop, cb);
    const skyTop = skyStops(p)[0];
    const skyMid = skyStops(p)[1];
    const skyLateTop = skyStopsLate(p)[0];
    const behinds: [string,string][] = [[WORST_CASE_SKY,"white(worstcase)"],[skyTop,"skyTop"],[skyMid,"skyMid"],[skyLateTop,"skyLateTop"]];
    for (const [behind, bn] of behinds) {
      // FLIGHT word plate: wordPlate.ts drawBacking alpha 0.92
      add(stop, cb, "flight.word.untyped", p.plateText, p.plate, 0.92, behind, bn);
      add(stop, cb, "flight.word.typed", p.accent, p.plate, 0.92, behind, bn);
      // typedWord.ts (warp/preflight/earth activation) plate alpha 0.96
      add(stop, cb, "typedWord.typed", p.accent, p.plate, 0.96, behind, bn);
      add(stop, cb, "typedWord.untyped", p.plateText, p.plate, 0.96, behind, bn);
      // HUD plate alpha 0.86
      add(stop, cb, "hud.value/plateText", p.plateText, p.plate, 0.86, behind, bn);
      add(stop, cb, "hud.label/accent", p.accent, p.plate, 0.86, behind, bn);
      // StallScene plate 0.96 plateText
      add(stop, cb, "stall.plateText", p.plateText, p.plate, 0.96, behind, bn);
      // BeaconScene label drawn with pal.accent on SKY_PLATE
      add(stop, cb, "beacon.label.accent@skyplate", p.accent, SKY_PLATE.fill, SKY_PLATE.alpha, behind, bn);
      // sky-borne text via skyText (palette-independent ink)
      add(stop, cb, "skyText.INK.text", INK.text, SKY_PLATE.fill, SKY_PLATE.alpha, behind, bn);
      // BARE SKY: any accent drawn directly on sky (world accent / beacon old style)
      add(stop, cb, "bareSky.worldAccent", p.worldAccent, null, 1, behind, bn);
      add(stop, cb, "bareSky.accent", p.accent, null, 1, behind, bn);
    }
  }
}
console.log(JSON.stringify(rows));
