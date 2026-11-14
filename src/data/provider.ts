/**
 * The only contract the UI depends on. Swap implementations (static files, live Horizons proxy,
 * Moon Trek services…) without touching features/.
 */
import type { AnalysisGrid } from "@/domain/grid/grid";
import type { SensorFields } from "@/domain/sensors/sensors";
import type { EphemerisSeries, Provenance, Site } from "@/domain/types";

export interface RasterLayerMeta {
  id: string;
  label: string;
  url: string;
  legend: { min: number; max: number; unit: string; stops: string[] } | null;
  provenance: Provenance;
  source: string;
}

export interface FeatureLabel {
  name: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  diameterKm: number;
}

export interface RegionMeta {
  id: string;
  name: string;
  projection: { code: string; proj4: string; radiusM: number };
  /** [minX, minY, maxX, maxY] in projected metres. */
  extentM: [number, number, number, number];
  layers: RasterLayerMeta[];
  features: FeatureLabel[];
  assumptions: { observerHeightM: number; horizonStepDeg: number; horizonRayKm: number };
  attribution: string[];
}

export interface LunarDataProvider {
  getRegion(): Promise<RegionMeta>;
  getSites(): Promise<Site[]>;
  getEphemeris(): Promise<EphemerisSeries>;
  /** Per-cell analysis grid (terrain stats + horizon masks). Safe to call from a Web Worker. */
  getAnalysisGrid(): Promise<AnalysisGrid>;
  /**
   * Per-cell sensor source fields (Diviner, Mini-RF, LP GRS). Implementations fall back to clearly
   * labelled synthetic fields when the real data cannot be loaded, so the demo always works offline.
   */
  getSensorFields(): Promise<SensorFields>;
}
