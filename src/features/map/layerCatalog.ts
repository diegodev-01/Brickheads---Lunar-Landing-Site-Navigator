/**
 * Every map layer the switcher can show: static rasters from region.json and computed grid heatmaps.
 * Each one says in plain words what its colours mean and where the numbers come from.
 */
import type { RasterLayerMeta } from "@/data";
import type { Provenance } from "@/domain/types";
import { EARTH_PALETTE, SUNLIGHT_PALETTE, type Palette } from "./heatmap";

export type GridLayerId = "illumWindow" | "illumNow" | "earthWindow";

export interface LayerEntry {
  id: string;
  label: string;
  kind: "static" | "grid";
  /** One sentence for a non-expert: what am I looking at? */
  help: string;
  legend: {
    stops: string[];
    minLabel: string;
    maxLabel: string;
    lowMeaning: string;
    highMeaning: string;
  } | null;
  provenance: Provenance;
  source: string;
}

export interface GridLayerDef extends LayerEntry {
  kind: "grid";
  id: GridLayerId;
  palette: Palette;
}

const HORIZON_SOURCE =
  "Computed in your browser from JPL Horizons Sun/Earth positions and terrain horizons ray-cast over the LOLA DEM (500 m cells).";

export const GRID_LAYERS: readonly GridLayerDef[] = [
  {
    id: "illumWindow",
    kind: "grid",
    label: "Sunlight over mission window",
    help: "Share of the selected window that the Sun is visible from each 500 m cell (more sunlight = more solar power, warmer).",
    palette: SUNLIGHT_PALETTE,
    legend: {
      stops: SUNLIGHT_PALETTE.stops,
      minLabel: "0 %",
      maxLabel: "100 %",
      lowMeaning: "Dark: no sunlight in this window",
      highMeaning: "Bright: sunlit the whole window",
    },
    provenance: "derived",
    source: HORIZON_SOURCE,
  },
  {
    id: "illumNow",
    kind: "grid",
    label: "Light & shadow at scrubber time",
    help: "Where the Sun is visible at the moment shown on the time scrubber. Press play to watch shadows sweep.",
    palette: SUNLIGHT_PALETTE,
    legend: {
      stops: SUNLIGHT_PALETTE.stops,
      minLabel: "shadow",
      maxLabel: "full Sun",
      lowMeaning: "Dark: in shadow now",
      highMeaning: "Bright: whole solar disc visible",
    },
    provenance: "derived",
    source: HORIZON_SOURCE,
  },
  {
    id: "earthWindow",
    kind: "grid",
    label: "Earth in view (direct comms)",
    help: "Share of the window that Earth is above the local terrain, so a direct radio link to Earth is possible.",
    palette: EARTH_PALETTE,
    legend: {
      stops: EARTH_PALETTE.stops,
      minLabel: "0 %",
      maxLabel: "100 %",
      lowMeaning: "Dark: Earth hidden, no direct link",
      highMeaning: "Bright: Earth always in view",
    },
    provenance: "derived",
    source: HORIZON_SOURCE,
  },
];

const STATIC_MEANING: Record<string, { help: string; low: string; high: string }> = {
  slope: {
    help: "How steep the ground is. Landers need gentle slopes to touch down safely.",
    low: "Green: gentle",
    high: "Dark red: steep",
  },
  sun: {
    help: "Average share of time in sunlight over 18.6 years (independent NASA product, not date-specific).",
    low: "Dark: rarely sunlit",
    high: "Pale yellow: almost always sunlit",
  },
  earth: {
    help: "Average share of time Earth is in view over 18.6 years (independent NASA product).",
    low: "Dark: Earth rarely visible",
    high: "Pale blue: Earth almost always visible",
  },
  psr: {
    help: "Permanently shadowed regions: never sunlit, extremely cold, possible water ice.",
    low: "",
    high: "Blue: permanent shadow",
  },
};

export function staticEntries(layers: RasterLayerMeta[]): LayerEntry[] {
  return layers
    .filter((l) => l.id !== "hillshade")
    .map((l) => {
      const m = STATIC_MEANING[l.id];
      return {
        id: l.id,
        label: l.label,
        kind: "static" as const,
        help: m?.help ?? l.label,
        legend: l.legend
          ? {
              stops: l.legend.stops,
              minLabel: `${l.legend.min}${l.legend.unit}`,
              maxLabel: `${l.legend.max}${l.legend.unit}`,
              lowMeaning: m?.low ?? "",
              highMeaning: m?.high ?? "",
            }
          : null,
        provenance: l.provenance,
        source: l.source,
      };
    });
}

export const isGridLayer = (id: string): id is GridLayerId => GRID_LAYERS.some((l) => l.id === id);
