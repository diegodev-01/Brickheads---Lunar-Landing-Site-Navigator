/** Small synthetic grids and ephemerides for unit tests. Clearly SIMULATED; never used by the app. */
import type { ProvenanceTag } from "../../provenance";
import type { EphemerisSeries } from "../../types";
import { GRID_FIELD_IDS, type AnalysisGrid, type GridFieldId, type ScalarField } from "../grid";

export const TEST_TAG: ProvenanceTag = {
  kind: "simulated",
  confidence: "low",
  source: "unit-test fixture",
  verified: true,
};

/** Horizon encoding used by the real grid: el = -4 + 0.1 q. */
export const hzQ = (deg: number): number => Math.round((deg + 4) / 0.1);

export function syntheticGrid(opts: {
  cols: number;
  rows: number;
  cellSizeM?: number;
  /** Horizon (deg) per cell, same for all azimuths. Default 0°. */
  horizonDeg?: (idx: number) => number;
  fields?: Partial<Record<GridFieldId, (idx: number) => number>>;
}): AnalysisGrid {
  const cell = opts.cellSizeM ?? 500;
  const n = opts.cols * opts.rows;
  const halfW = (opts.cols * cell) / 2;
  const halfH = (opts.rows * cell) / 2;
  const bins = 90;
  const hz = new Uint8Array(n * bins);
  for (let i = 0; i < n; i++) hz.fill(hzQ(opts.horizonDeg?.(i) ?? 0), i * bins, (i + 1) * bins);
  const fields = {} as Record<GridFieldId, ScalarField>;
  for (const id of GRID_FIELD_IDS) {
    const f = opts.fields?.[id];
    fields[id] = {
      id,
      unit: "",
      data: Float32Array.from({ length: n }, (_, i) => (f ? f(i) : 0)),
      provenance: TEST_TAG,
    };
  }
  return {
    geometry: {
      cols: opts.cols,
      rows: opts.rows,
      cellSizeM: cell,
      extentM: [-halfW, -halfH, halfW, halfH],
    },
    fields,
    horizon: {
      bins,
      binDeg: 4,
      offset: -4,
      scale: 0.1,
      data: hz,
      observerHeightM: 2,
      provenance: TEST_TAG,
    },
  };
}

/** Constant-rate ephemeris: sub-solar point circles the Moon once per `periodDays` at latitude `sunLat`. */
export function syntheticEphemeris(opts: {
  hours: number;
  sunLat?: number | ((i: number) => number);
  periodDays?: number;
  startMs?: number;
}): EphemerisSeries {
  const period = (opts.periodDays ?? 29.53) * 24;
  const lat = (i: number) =>
    typeof opts.sunLat === "function" ? opts.sunLat(i) : (opts.sunLat ?? 1.5);
  const idx = Array.from({ length: opts.hours }, (_, i) => i);
  return {
    startMs: opts.startMs ?? Date.UTC(2027, 0, 1),
    stepMs: 3_600_000,
    subSolarLon: idx.map((i) => ((((360 * i) / period) % 360) + 360) % 360),
    subSolarLat: idx.map(lat),
    subEarthLon: idx.map(() => 0),
    subEarthLat: idx.map(() => 0),
    earthDistanceKm: idx.map(() => 384_400),
    provenance: "simulated",
    source: "unit-test fixture",
  };
}
