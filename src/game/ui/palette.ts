import type { StopId } from "@engine/types";

/**
 * Stop palettes for the UI kit (art-direction.md section 3, rubric item 7).
 *
 * WHY THIS FILE EXISTS AND WHY IT IS A COPY.
 * The rubric's source of truth is `src/content/palettes.json` (G-V-22.7 reads
 * that file, not this one). `resolveJsonModule` is off in tsconfig.json and
 * this lane may not edit tsconfig, so a menu scene cannot import the JSON. The
 * render lane is expected to publish `paletteFor(stopId)` from
 * `src/game/render/`; at the time this lane ran, `src/game/render/` contained
 * only layers.ts and particles.ts, so this is the local stand-in with the same
 * signature. When render/paletteFor lands, delete this file and re-point the
 * two imports - the shape is deliberately identical.
 *
 * The values below are byte-for-byte the seven entries of palettes.json.
 */

export interface StopPalette {
  readonly name: string;
  /** 5-7 colours, back-to-front in the layer stack. */
  readonly colors: readonly string[];
  readonly colorRoles: Readonly<Record<string, string>>;
  /** Exactly one accent (rubric 7). */
  readonly accent: string;
  /** Word/label plate fill and its text colour (rubric 8, >= 4.5:1). */
  readonly plate: string;
  readonly plateText: string;
  /** D41 colourblind-safe variant: accent and debris separated by luminance. */
  readonly colorblind: { readonly accent: string; readonly debris: string };
}

export const PALETTES: Readonly<Record<StopId, StopPalette>> = {
  earth: {
    name: "Earth",
    colors: ["#0B1B3A", "#12315E", "#3C7BD9", "#F5D58A", "#E8EEF7", "#08111F"],
    colorRoles: {
      sky: "#0B1B3A",
      deep: "#12315E",
      atmosphere: "#3C7BD9",
      cityLight: "#F5D58A",
      cloud: "#E8EEF7",
      ground: "#08111F",
    },
    accent: "#FFC857",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#FFFFFF", debris: "#3C7BD9" },
  },
  mars: {
    name: "Mars",
    colors: ["#F1C79A", "#E9A46E", "#B5522A", "#7A2E17", "#D9A776", "#4A1F12"],
    colorRoles: {
      sky: "#F1C79A",
      dusk: "#E9A46E",
      rust: "#B5522A",
      deepRust: "#7A2E17",
      dust: "#D9A776",
      shadow: "#4A1F12",
    },
    accent: "#FF6B4A",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#FFFFFF", debris: "#B5522A" },
  },
  jupiter: {
    name: "Jupiter",
    colors: ["#F3E3C3", "#D9B58A", "#C97B3F", "#8A4B2B", "#B33A2E", "#4A2418"],
    colorRoles: {
      cream: "#F3E3C3",
      tan: "#D9B58A",
      orange: "#C97B3F",
      brown: "#8A4B2B",
      stormRed: "#B33A2E",
      deep: "#4A2418",
    },
    accent: "#FFE29A",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#FFFFFF", debris: "#C97B3F" },
  },
  saturn: {
    name: "Saturn",
    colors: ["#EFD9A8", "#F6EEDC", "#C9B48C", "#FFFFFF", "#A99C86", "#3E3226"],
    colorRoles: {
      sky: "#EFD9A8",
      ringIvory: "#F6EEDC",
      ringShadow: "#C9B48C",
      ice: "#FFFFFF",
      warmGray: "#A99C86",
      umber: "#3E3226",
    },
    accent: "#9FD8F0",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#111318", debris: "#C9B48C" },
  },
  uranus: {
    name: "Uranus",
    colors: ["#BFE7EE", "#7ECBD8", "#3E9DAF", "#1F5E6B", "#2A2F33", "#0F1416"],
    colorRoles: {
      paleCyan: "#BFE7EE",
      cyan: "#7ECBD8",
      teal: "#3E9DAF",
      deepTeal: "#1F5E6B",
      ringCharcoal: "#2A2F33",
      nearBlack: "#0F1416",
    },
    accent: "#C8FFE8",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#FFFFFF", debris: "#3E9DAF" },
  },
  neptune: {
    name: "Neptune",
    colors: ["#1E3FA3", "#122A6E", "#0B173F", "#DDE7FF", "#3B63C8", "#060C22"],
    colorRoles: {
      cobalt: "#1E3FA3",
      deepBlue: "#122A6E",
      stormIndigo: "#0B173F",
      windWhite: "#DDE7FF",
      midBlue: "#3B63C8",
      abyss: "#060C22",
    },
    accent: "#6FA8FF",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#FFFFFF", debris: "#0B173F" },
  },
  pluto: {
    name: "Pluto",
    colors: ["#F2F4F8", "#D6D3EA", "#F5E6D0", "#9A9BB0", "#4A4C63", "#14151F"],
    colorRoles: {
      frost: "#F2F4F8",
      paleLilac: "#D6D3EA",
      heartCream: "#F5E6D0",
      coldGray: "#9A9BB0",
      shadowSlate: "#4A4C63",
      void: "#14151F",
    },
    accent: "#FFB3C7",
    plate: "#0E1116",
    plateText: "#F7FAFF",
    colorblind: { accent: "#111318", debris: "#F5E6D0" },
  },
};

/**
 * The palette for a stop. `colorblind` swaps the accent for the D41 variant so
 * hue is never the only signal; everything else is unchanged, because the
 * colourblind variant must not alter word-plate contrast (art-direction s3).
 */
export function paletteFor(stopId: StopId, colorblind = false): StopPalette {
  const base = PALETTES[stopId];
  if (!colorblind) return base;
  return { ...base, accent: base.colorblind.accent };
}

/** "#1E3FA3" -> 0x1E3FA3, for Phaser's numeric colour arguments. */
export function rgb(hexColor: string): number {
  return Number.parseInt(hexColor.replace("#", ""), 16);
}

/** Relative luminance per WCAG 2.1, used by the contrast helper below. */
function luminance(hexColor: string): number {
  const v = rgb(hexColor);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((v >> 16) & 0xff) +
    0.7152 * channel((v >> 8) & 0xff) +
    0.0722 * channel(v & 0xff)
  );
}

/** WCAG contrast ratio. Menus hold themselves to the same 4.5:1 as AC-22.8. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
