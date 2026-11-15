/**
 * The per-cell analysis grid (built offline by scripts/build_grid.py). Pure data + index math.
 * Row 0 is the TOP of the map (max y), matching the raster layers. Cell values are Float32 with NaN
 * for "no data"; horizons stay quantised (uint8) and are decoded on lookup to keep memory small.
 */
import { normalize360 } from "../geo/angles";
import { xyToLonLat } from "../geo/polarStereo";
import type { ProvenanceTag } from "../provenance";
import type { LonLat } from "../types";

export type Extent = [minX: number, minY: number, maxX: number, maxY: number];

export interface GridGeometry {
  cols: number;
  rows: number;
  cellSizeM: number;
  extentM: Extent;
}

export const GRID_FIELD_IDS = [
  "elevation",
  "slopeMean",
  "slopeP95",
  "roughness",
  "psrFraction",
  "psrDistance",
  "sunLongTerm",
  "earthLongTerm",
  "safeRadius5",
  "safeRadius8",
  "safeRadius10",
  "safeRadius15",
] as const;
export type GridFieldId = (typeof GRID_FIELD_IDS)[number];

export interface ScalarField {
  id: string;
  unit: string;
  data: Float32Array;
  provenance: ProvenanceTag;
}

export interface HorizonField {
  bins: number;
  binDeg: number;
  /** el_deg = offset + scale * q */
  offset: number;
  scale: number;
  /** cells × bins, row-major by cell. */
  data: Uint8Array;
  observerHeightM: number;
  provenance: ProvenanceTag;
}

export interface GridValidation {
  method: string;
  sunR: number;
  sunMeanAbsDiffPct: number;
  earthR: number;
  earthMeanAbsDiffPct: number;
}

export interface AnalysisGrid {
  geometry: GridGeometry;
  fields: Record<GridFieldId, ScalarField>;
  horizon: HorizonField;
  validation?: GridValidation;
}

export const cellCount = (g: GridGeometry): number => g.cols * g.rows;

/** Cell index containing (x, y), or null outside the grid. */
export function cellIndexAt(g: GridGeometry, x: number, y: number): number | null {
  const [x0, , , y1] = g.extentM;
  const col = Math.floor((x - x0) / g.cellSizeM);
  const row = Math.floor((y1 - y) / g.cellSizeM);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return null;
  return row * g.cols + col;
}

export function cellRowCol(g: GridGeometry, idx: number): { row: number; col: number } {
  return { row: Math.floor(idx / g.cols), col: idx % g.cols };
}

export function cellCenter(g: GridGeometry, idx: number): { x: number; y: number } {
  const { row, col } = cellRowCol(g, idx);
  return {
    x: g.extentM[0] + (col + 0.5) * g.cellSizeM,
    y: g.extentM[3] - (row + 0.5) * g.cellSizeM,
  };
}

export function cellLonLat(g: GridGeometry, idx: number): LonLat {
  const { x, y } = cellCenter(g, idx);
  return xyToLonLat(x, y);
}

/** Indices of cells whose centre lies inside `extent` (all cells when omitted). */
export function cellsInExtent(g: GridGeometry, extent?: Extent): Int32Array {
  if (!extent) return Int32Array.from({ length: cellCount(g) }, (_, i) => i);
  const [ex0, ey0, ex1, ey1] = extent;
  const out: number[] = [];
  for (let row = 0; row < g.rows; row++) {
    const y = g.extentM[3] - (row + 0.5) * g.cellSizeM;
    if (y < ey0 || y > ey1) continue;
    for (let col = 0; col < g.cols; col++) {
      const x = g.extentM[0] + (col + 0.5) * g.cellSizeM;
      if (x >= ex0 && x <= ex1) out.push(row * g.cols + col);
    }
  }
  return Int32Array.from(out);
}

/**
 * Terrain horizon (deg) at a cell for an azimuth: NEAREST bin. The bins are max-pooled offline, so
 * nearest-bin lookup stays conservative (it never reveals light the finer mask would block).
 */
export function cellHorizonAt(h: HorizonField, idx: number, azimuthDeg: number): number {
  const b = Math.round(normalize360(azimuthDeg) / h.binDeg) % h.bins;
  return h.offset + h.scale * h.data[idx * h.bins + b]!;
}

/** Full decoded horizon profile for one cell (for panoramas). */
export function cellHorizonProfile(h: HorizonField, idx: number): number[] {
  const out: number[] = new Array(h.bins);
  for (let b = 0; b < h.bins; b++) out[b] = h.offset + h.scale * h.data[idx * h.bins + b]!;
  return out;
}

/** Value of a field at a cell (NaN = no data). */
export const fieldAt = (grid: AnalysisGrid, id: GridFieldId, idx: number): number =>
  grid.fields[id].data[idx]!;
