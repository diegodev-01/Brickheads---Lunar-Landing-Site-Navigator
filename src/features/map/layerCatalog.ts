/**
 * Every map layer the switcher can show: static rasters from region.json and computed grid heatmaps.
 * Each one says in plain words what its colours mean and where the numbers come from.
 */
import type { RasterLayerMeta } from "@/data";
import type { Provenance } from "@/domain/types";
import { SENSOR_LABEL, type SensorId, type SensorLayer } from "@/domain/sensors/sensors";
import {
  EARTH_PALETTE,
  HAZARD_PALETTE,
  ICE_PALETTE,
  MINERAL_PALETTE,
  RADAR_PALETTE,
  SUNLIGHT_PALETTE,
  THERMAL_PALETTE,
  type Palette,
} from "./heatmap";

export type GridLayerId =
  "suitability" | "illumWindow" | "illumNow" | "earthWindow" | "relayWindow";

export interface LayerEntry {
  id: string;
  label: string;
  kind: "static" | "grid" | "sensor";
  /** Instrument group for sensor layers. */
  sensor?: SensorId;
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
    id: "suitability",
    kind: "grid",
    label: "Overall suitability",
    help: "How good each 500 m cell is for landing, for your dates and priorities. Hatched cells fail a safety or comms limit.",
    palette: { id: "suitability", stops: ["#d6604d", "#fee08b", "#1b7837"] },
    legend: {
      stops: ["#d6604d", "#fee08b", "#1b7837"],
      minLabel: "✗ poor",
      maxLabel: "✓ good",
      lowMeaning: "Red, dotted: poor (<55)",
      highMeaning: "Green: good (75+)",
    },
    provenance: "derived",
    source:
      "Two-stage model (docs/scoring-model.md): hard gates, then a weighted score of safety, science, comms and power.",
  },
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
  {
    id: "relayWindow",
    kind: "grid",
    label: "Relay contact (simulated)",
    help: "Share of the window a relay satellite in a halo orbit (NRHO) is above the local terrain and can pass data to Earth.",
    palette: MINERAL_PALETTE,
    legend: {
      stops: MINERAL_PALETTE.stops,
      minLabel: "0 %",
      maxLabel: "100 %",
      lowMeaning: "Dark: relay hidden by terrain",
      highMeaning: "Yellow: relay almost always reachable",
    },
    provenance: "simulated",
    source:
      "Simplified Keplerian proxy of a 9:2 southern NRHO (period 6.56 d) vs LOLA terrain horizons. Not a real relay ephemeris.",
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

/** How each sensor layer is drawn and what its colours mean. */
export interface SensorStyle {
  palette: Palette;
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
  lowMeaning: string;
  highMeaning: string;
}

const SENSOR_STYLE: Record<string, SensorStyle> = {
  "lidar.slope": {
    palette: HAZARD_PALETTE,
    min: 0,
    max: 25,
    minLabel: "0°",
    maxLabel: "25°+",
    lowMeaning: "Pale: flat",
    highMeaning: "Dark: steep",
  },
  "lidar.roughness": {
    palette: HAZARD_PALETTE,
    min: 0,
    max: 8,
    minLabel: "0°",
    maxLabel: "8°+",
    lowMeaning: "Pale: smooth",
    highMeaning: "Dark: bumpy",
  },
  "lidar.boulders": {
    palette: HAZARD_PALETTE,
    min: 0,
    max: 1,
    minLabel: "0",
    maxLabel: "1",
    lowMeaning: "Pale: few boulders",
    highMeaning: "Dark: many boulders",
  },
  "sar.cpr": {
    palette: RADAR_PALETTE,
    min: 0,
    max: 1.5,
    minLabel: "0",
    maxLabel: "1.5+",
    lowMeaning: "Dark: smooth / dry",
    highMeaning: "Bright: rough or icy",
  },
  "radiometer.tempMax": {
    palette: THERMAL_PALETTE,
    min: 30,
    max: 330,
    minLabel: "30 K",
    maxLabel: "330 K",
    lowMeaning: "Dark: always frozen",
    highMeaning: "Bright: hot in sunlight",
  },
  "radiometer.tempAvg": {
    palette: THERMAL_PALETTE,
    min: 30,
    max: 250,
    minLabel: "30 K",
    maxLabel: "250 K",
    lowMeaning: "Dark: cold",
    highMeaning: "Bright: warm",
  },
  "radiometer.tempNow": {
    palette: THERMAL_PALETTE,
    min: 30,
    max: 330,
    minLabel: "30 K",
    maxLabel: "330 K",
    lowMeaning: "Dark: cold now",
    highMeaning: "Bright: hot now",
  },
  "spectrometer.feo": {
    palette: MINERAL_PALETTE,
    min: 3,
    max: 7,
    minLabel: "3 %",
    maxLabel: "7 %",
    lowMeaning: "Lower iron",
    highMeaning: "Higher iron",
  },
  "spectrometer.tio2": {
    palette: MINERAL_PALETTE,
    min: 0,
    max: 1,
    minLabel: "0 %",
    maxLabel: "1 %",
    lowMeaning: "Lower titanium",
    highMeaning: "Higher titanium",
  },
  "spectrometer.hydrogen": {
    palette: ICE_PALETTE,
    min: 100,
    max: 250,
    minLabel: "100 ppm",
    maxLabel: "250 ppm",
    lowMeaning: "Dark: dry",
    highMeaning: "Bright: hydrogen-rich",
  },
  "derived.ice": {
    palette: ICE_PALETTE,
    min: 0,
    max: 1,
    minLabel: "0",
    maxLabel: "1",
    lowMeaning: "Dark: ice unlikely",
    highMeaning: "Bright: ice likely",
  },
};

export const sensorStyle = (id: string): SensorStyle | undefined => SENSOR_STYLE[id];

/** Layer-switcher entries for the sensor layers (provenance read from each layer once). */
export function sensorEntries(layers: SensorLayer[]): LayerEntry[] {
  return layers.map((l) => {
    const st = SENSOR_STYLE[l.id];
    const prov = l.getLayer(undefined, 0, {}).provenance;
    return {
      id: l.id,
      kind: "sensor" as const,
      sensor: l.sensor,
      label: l.label,
      help: `${SENSOR_LABEL[l.sensor]}: ${l.description}`,
      legend: st
        ? {
            stops: st.palette.stops,
            minLabel: st.minLabel,
            maxLabel: st.maxLabel,
            lowMeaning: st.lowMeaning,
            highMeaning: st.highMeaning,
          }
        : null,
      provenance: prov.kind,
      source: prov.verified ? prov.source : `${prov.source} (unverified)`,
    };
  });
}
