/**
 * Sensor simulation layers. We have no real LiDAR/SAR/radiometer/spectrometer flights, so each
 * "instrument" is a layer built from real lunar datasets where one was verified, and from a
 * clearly labelled SIMULATED model otherwise. Every layer exposes the same contract:
 *
 *   getLayer(roi?, timeMs?, ctx?) -> { grid, units, provenance, confidence }
 *
 * so a real dataset can replace a synthetic one without touching the UI.
 */
import {
  cellsInExtent,
  type AnalysisGrid,
  type Extent,
  type GridGeometry,
  type ScalarField,
} from "../grid/grid";
import { combineProvenance, type Confidence, type ProvenanceTag } from "../provenance";

export type SensorId = "lidar" | "sar" | "radiometer" | "spectrometer";

export const SENSOR_LABEL: Record<SensorId, string> = {
  lidar: "LiDAR",
  sar: "SAR (radar)",
  radiometer: "Radiometer",
  spectrometer: "Spectrometer",
};

/** Per-cell sensor source fields (from data/sensors, real or synthetic). */
export const SENSOR_FIELD_IDS = [
  "tempAvg",
  "tempMax",
  "iceDepth",
  "iceStableFraction",
  "cpr",
  "feo",
  "tio2",
] as const;
export type SensorFieldId = (typeof SENSOR_FIELD_IDS)[number];
export type SensorFields = Record<SensorFieldId, ScalarField>;

export interface LayerResult {
  geometry: GridGeometry;
  /** Per cell (grid order); NaN = no data or outside the ROI. */
  grid: Float32Array;
  units: string;
  provenance: ProvenanceTag;
  confidence: Confidence;
}

/** Inputs that only some layers use (time-dependent models). */
export interface LayerContext {
  /** Visible solar-disc fraction per cell at `timeMs` (from the illumination worker). */
  sunNow?: Float32Array;
}

export interface SensorLayer {
  id: string;
  sensor: SensorId;
  label: string;
  units: string;
  /** One plain-language sentence for non-experts. */
  description: string;
  /** Whether the layer changes with time (needs `ctx.sunNow`). */
  timeDependent: boolean;
  getLayer(roi?: Extent, timeMs?: number, ctx?: LayerContext): LayerResult;
}

const SIMULATED = (source: string, confidence: Confidence = "low"): ProvenanceTag => ({
  kind: "simulated",
  confidence,
  source,
  verified: false,
});

/** Applies an ROI mask (cells outside → NaN). Returns a new array. */
function clip(g: GridGeometry, values: Float32Array, roi?: Extent): Float32Array {
  if (!roi) return values.slice();
  const out = new Float32Array(values.length).fill(Number.NaN);
  for (const i of cellsInExtent(g, roi)) out[i] = values[i]!;
  return out;
}

function fromField(
  grid: AnalysisGrid,
  field: ScalarField,
  units = field.unit,
): (roi?: Extent) => LayerResult {
  return (roi) => ({
    geometry: grid.geometry,
    grid: clip(grid.geometry, field.data, roi),
    units,
    provenance: field.provenance,
    confidence: field.provenance.confidence,
  });
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------------------------
// Simulated models (documented in docs/scoring-model.md §Sensors). Pure functions, unit-tested.

/**
 * Boulder hazard index 0..1 (SIMULATED). No verified polar boulder/rock-abundance map exists in a
 * browser-ready form, so we model hazard from what we do measure: rough, steep terrain sheds more
 * boulders. index = 0.7·ramp(roughness, 1°→6°) + 0.3·ramp(slopeP95, 5°→25°).
 */
export function boulderIndex(roughnessDeg: number, slopeP95Deg: number): number {
  if (Number.isNaN(roughnessDeg) || Number.isNaN(slopeP95Deg)) return Number.NaN;
  return 0.7 * clamp01((roughnessDeg - 1) / 5) + 0.3 * clamp01((slopeP95Deg - 5) / 20);
}

/**
 * Surface temperature at time t (SIMULATED, K). Real Diviner gives annual mean and max per cell;
 * we interpolate between them with the instantaneous sunlit fraction f: T = Tavg + (Tmax − Tavg)·f.
 * This ignores thermal inertia (hours of lag) and is only meant to show day/night contrast.
 */
export function surfaceTempNow(tAvg: number, tMax: number, sunFraction: number): number {
  if (Number.isNaN(tAvg) || Number.isNaN(tMax)) return Number.NaN;
  return tAvg + (tMax - tAvg) * clamp01(sunFraction);
}

/**
 * Hydrogen abundance (SIMULATED, ppm H). Stand-in for LEND/LP-NS maps (not verified). Baseline polar
 * regolith ~100 ppm (Sanin et al. 2017), plus up to +150 ppm where Diviner says ice is stable.
 */
export function hydrogenPpm(iceStableFraction: number): number {
  if (Number.isNaN(iceStableFraction)) return Number.NaN;
  return 100 + 150 * clamp01(iceStableFraction);
}

export type IceLevel = "low" | "medium" | "high";

/**
 * Surface ice probability index 0..1 (SIMULATED model from measured/derived inputs):
 *  0.55 · iceStableFraction  (Diviner: share of the cell where ice is stable AT the surface)
 *  0.15 · ramp(ice-stability depth 0.5 m → 0 m)  (shallow buried ice)
 *  0.20 · psrFraction        (LOLA permanent shadow)
 *  0.10 · ramp(CPR 0.6 → 1.2) (radar: weak evidence, also high for rough rocky ground)
 * Missing inputs drop out and the remaining weights renormalise.
 */
export function iceProbability(p: {
  iceStableFraction: number;
  iceDepthM: number;
  psrFraction: number;
  cpr: number;
}): number {
  const terms: [number, number][] = [
    [0.55, p.iceStableFraction],
    [0.15, Number.isNaN(p.iceDepthM) ? Number.NaN : clamp01(1 - p.iceDepthM / 0.5)],
    [0.2, p.psrFraction],
    [0.1, Number.isNaN(p.cpr) ? Number.NaN : clamp01((p.cpr - 0.6) / 0.6)],
  ];
  let w = 0;
  let s = 0;
  for (const [wi, v] of terms) {
    if (Number.isNaN(v)) continue;
    w += wi;
    s += wi * clamp01(v);
  }
  return w === 0 ? Number.NaN : s / w;
}

/** Plain-language level: High ≥ 0.5, Medium ≥ 0.25, else Low. */
export const iceLevel = (p: number): IceLevel => (p >= 0.5 ? "high" : p >= 0.25 ? "medium" : "low");

// ---------------------------------------------------------------------------------------------

function mapCells(
  g: AnalysisGrid,
  roi: Extent | undefined,
  f: (i: number) => number,
): Float32Array {
  const out = new Float32Array(g.geometry.cols * g.geometry.rows).fill(Number.NaN);
  for (const i of cellsInExtent(g.geometry, roi)) out[i] = f(i);
  return out;
}

/** All sensor layers for a grid. Real fields are used as-is; gaps are filled by labelled models. */
export function createSensorLayers(grid: AnalysisGrid, s: SensorFields): SensorLayer[] {
  const gf = grid.fields;
  const layer = (
    l: Omit<SensorLayer, "getLayer" | "timeDependent"> & { timeDependent?: boolean },
    get: SensorLayer["getLayer"],
  ): SensorLayer => ({ timeDependent: false, ...l, getLayer: get });

  const boulderProv = combineProvenance(
    "Model: boulder hazard from LOLA roughness and slope (no verified polar boulder map)",
    gf.roughness.provenance,
    gf.slopeP95.provenance,
    SIMULATED(""),
  );
  const tempNowProv = combineProvenance(
    "Model: Diviner annual mean/max interpolated by the sunlit fraction at the scrubber time (no thermal inertia)",
    s.tempAvg.provenance,
    SIMULATED(""),
  );
  const hydrogenProv = SIMULATED(
    "Model: 100 ppm baseline + up to 150 ppm where Diviner ice is stable. LEND/LP-NS maps not verified.",
  );
  const iceProv = combineProvenance(
    "Model: Diviner ice stability + LOLA PSR + Mini-RF CPR (weighted index, see scoring-model.md)",
    s.iceStableFraction.provenance,
    gf.psrFraction.provenance,
    SIMULATED("", "medium"),
  );

  return [
    layer(
      {
        id: "lidar.slope",
        sensor: "lidar",
        label: "Slope (95th percentile)",
        units: "°",
        description: "How steep the steepest parts of each 500 m cell are.",
      },
      fromField(grid, gf.slopeP95, "°"),
    ),
    layer(
      {
        id: "lidar.roughness",
        sensor: "lidar",
        label: "Roughness",
        units: "°",
        description:
          "How much the slope varies inside the cell: bumpy ground is harder to land on.",
      },
      fromField(grid, gf.roughness, "°"),
    ),
    layer(
      {
        id: "lidar.boulders",
        sensor: "lidar",
        label: "Boulder hazard (simulated)",
        units: "index 0–1",
        description: "Estimated boulder hazard. Modelled from roughness and slope, not observed.",
      },
      (roi) => ({
        geometry: grid.geometry,
        grid: mapCells(grid, roi, (i) => boulderIndex(gf.roughness.data[i]!, gf.slopeP95.data[i]!)),
        units: "index 0–1",
        provenance: boulderProv,
        confidence: "low",
      }),
    ),
    layer(
      {
        id: "sar.cpr",
        sensor: "sar",
        label: "Radar CPR",
        units: "ratio",
        description:
          "Radar circular polarization ratio: high values can mean ice, but also rough, rocky ground.",
      },
      fromField(grid, s.cpr),
    ),
    layer(
      {
        id: "radiometer.tempMax",
        sensor: "radiometer",
        label: "Max temperature (annual)",
        units: "K",
        description:
          "Hottest surface temperature over a year. Below ~110 K, water ice can survive.",
      },
      fromField(grid, s.tempMax),
    ),
    layer(
      {
        id: "radiometer.tempAvg",
        sensor: "radiometer",
        label: "Mean temperature (annual)",
        units: "K",
        description: "Average surface temperature over a year.",
      },
      fromField(grid, s.tempAvg),
    ),
    layer(
      {
        id: "radiometer.tempNow",
        sensor: "radiometer",
        label: "Temperature now (simulated)",
        units: "K",
        description: "Rough surface temperature at the scrubber time, from sunlight now.",
        timeDependent: true,
      },
      (roi, _t, ctx) => ({
        geometry: grid.geometry,
        grid: mapCells(grid, roi, (i) =>
          surfaceTempNow(s.tempAvg.data[i]!, s.tempMax.data[i]!, ctx?.sunNow?.[i] ?? 0),
        ),
        units: "K",
        provenance: tempNowProv,
        confidence: "low",
      }),
    ),
    layer(
      {
        id: "spectrometer.feo",
        sensor: "spectrometer",
        label: "Iron oxide (FeO)",
        units: "wt%",
        description: "Iron oxide content from orbit. Very coarse here (~60 km pixels).",
      },
      fromField(grid, s.feo),
    ),
    layer(
      {
        id: "spectrometer.tio2",
        sensor: "spectrometer",
        label: "Titanium oxide (TiO₂)",
        units: "wt%",
        description: "Titanium oxide content from orbit. Very coarse here (~60 km pixels).",
      },
      fromField(grid, s.tio2),
    ),
    layer(
      {
        id: "spectrometer.hydrogen",
        sensor: "spectrometer",
        label: "Hydrogen (simulated)",
        units: "ppm",
        description:
          "Estimated hydrogen in the soil, a hint of water. Modelled, not measured here.",
      },
      (roi) => ({
        geometry: grid.geometry,
        grid: mapCells(grid, roi, (i) => hydrogenPpm(s.iceStableFraction.data[i]!)),
        units: "ppm",
        provenance: hydrogenProv,
        confidence: "low",
      }),
    ),
    layer(
      {
        id: "derived.ice",
        sensor: "spectrometer",
        label: "Ice probability",
        units: "index 0–1",
        description:
          "How likely water ice is near the surface, combining temperature, shadow and radar.",
      },
      (roi) => ({
        geometry: grid.geometry,
        grid: mapCells(grid, roi, (i) =>
          iceProbability({
            iceStableFraction: s.iceStableFraction.data[i]!,
            iceDepthM: s.iceDepth.data[i]!,
            psrFraction: gf.psrFraction.data[i]!,
            cpr: s.cpr.data[i]!,
          }),
        ),
        units: "index 0–1",
        provenance: iceProv,
        confidence: iceProv.confidence,
      }),
    ),
  ];
}
